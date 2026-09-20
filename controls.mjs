import http from "node:http";
import https from "node:https";
import { WebSocketServer } from "ws";
import { Readable, pipeline } from "node:stream";
import { toWebRequest } from "@johnhenry/leserve/node-request";
import { URLPatternImpl } from "./urlpattern.mjs";

// A real EventTarget, not an EventEmitter wearing addEventListener/
// removeEventListener as aliases for .on()/.off(). Every event dispatched
// through it is a genuine Event (or a real, standard subclass like
// ErrorEvent) -- see the WinterTC Minimum Common Web API
// (https://min-common-api.proposal.wintertc.org/), which requires
// EventTarget/Event/CustomEvent/ErrorEvent as globals every conformant
// server-side runtime exposes. Node has provided all four natively since
// well before this package's own engines floor.
//
// This is a real, intentional breaking change from the previous
// EventEmitter-based dispatch: a handler registered for "error" used to
// receive the raw thrown Error directly; it now receives an ErrorEvent
// (with the same `.message`, plus `.error` holding the original Error).
// "start"/"stop"/"websocket" similarly now receive a real Event carrying
// the same property names previously destructured directly off a plain
// object (`.index`/`.port`/`.socket`), not the bare value itself.
// "fetch" is unchanged in shape -- it was already `.request`/
// `.respondWith()` on the object handed to the listener; that object is
// now a genuine FetchEvent instance instead of a plain object, but nothing
// a handler reads or calls needs to change.
const target = new EventTarget();

class FetchEvent extends Event {
  #response;
  #error;
  constructor(request) {
    super("fetch");
    this.request = request;
  }
  respondWith(response) {
    this.#response = response;
  }
  /** @private -- set by the addEventListener("fetch", ...) wrapper below, read by start()'s dispatch site. */
  reportError(error) {
    this.#error = error;
  }
  get response() {
    return this.#response;
  }
  get error() {
    return this.#error;
  }
}

class StartEvent extends Event {
  constructor(index, port) {
    super("start");
    this.index = index;
    this.port = port;
  }
}

class StopEvent extends Event {
  constructor(index) {
    super("stop");
    this.index = index;
  }
}

class WebSocketEvent extends Event {
  constructor(socket) {
    super("websocket");
    this.socket = socket;
  }
}

// "fetch" is the one event whose whole point is producing a return value
// (the response) that start()'s request handler is synchronously depending
// on -- every other event here (start/stop/websocket/error/custom) is a
// genuine fire-and-forget notification. But real EventTarget#dispatchEvent
// does *not* propagate a synchronously-thrown listener exception to its
// caller the way EventEmitter#emit does -- it reports it on the next tick
// instead (confirmed directly: a throwing listener crashes the process one
// tick later, dispatchEvent() itself returns normally). Without this
// wrapper, a throwing fetch handler would crash the whole server instead
// of producing a clean 500 the way it always has. Only "fetch" listeners
// are wrapped -- addEventListener/removeEventListener are the real,
// unmodified EventTarget methods for every other event name.
const fetchListenerWrappers = new WeakMap();

const addEventListener = (event, handler, options) => {
  if (event === "fetch" && typeof handler === "function") {
    if (!fetchListenerWrappers.has(handler)) {
      fetchListenerWrappers.set(handler, (fetchEvent) => {
        try {
          handler(fetchEvent);
        } catch (error) {
          fetchEvent.reportError(error);
        }
      });
    }
    target.addEventListener(event, fetchListenerWrappers.get(handler), options);
    return;
  }
  target.addEventListener(event, handler, options);
};

const removeEventListener = (event, handler, options) => {
  if (event === "fetch" && fetchListenerWrappers.has(handler)) {
    target.removeEventListener(event, fetchListenerWrappers.get(handler), options);
    return;
  }
  target.removeEventListener(event, handler, options);
};

// Node's EventTarget does *not* special-case "error" the way EventEmitter
// does (emitting to zero listeners there just throws) -- dispatchEvent()
// with no listeners registered is always a silent no-op, for every event
// name including "error". That's the correct behavior here (an
// unregistered error listener is optional, not a requirement -- see the
// "no crash with zero error listeners" test), so no permanent no-op
// listener is needed the way the old EventEmitter-based version required
// one.

const middlewares = [];
/** @type {{ method: string, pattern: InstanceType<typeof URLPatternImpl>, handler: Function }[]} */
const routes = [];

const servers = [];

const start = async (options) => {
  const handler = async (req, res) => {
    let response;

    try {
      // Converting the raw request can itself throw (e.g. a malformed
      // request-target that Node's HTTP parser lets through but isn't a
      // valid URL). This must happen *inside* the try block — previously
      // it ran before it, so a single malformed request threw an uncaught
      // exception that crashed the whole process.
      const request = toWebRequest(req, { attachRaw: true });
      const ctx = {
        params: {},
        state: new Map(),
        remoteAddress: req.socket?.remoteAddress,
        raw: req,
      };

      for (const middleware of middlewares) {
        const result = await middleware(request, ctx);
        if (result instanceof Response) {
          response = result;
          break;
        }
      }

      if (!response) {
        const url = new URL(req.url, `http://${req.headers.host}`);
        let matchedRoute;
        let match;
        for (const candidate of routes) {
          if (candidate.method !== req.method) continue;
          match = candidate.pattern.exec(url);
          if (match) {
            matchedRoute = candidate;
            break;
          }
        }

        if (matchedRoute) {
          ctx.params = { ...match.pathname.groups };
          response = await matchedRoute.handler(request, ctx);
        } else {
          const fetchEvent = new FetchEvent(request);
          target.dispatchEvent(fetchEvent);
          // Re-throw synchronously here (inside this function's own
          // try/catch, below) rather than at the point the listener itself
          // threw -- see the wrapper in addEventListener() above for why.
          if (fetchEvent.error) throw fetchEvent.error;
          response = fetchEvent.response;
          if (!response) {
            response = new Response("Not Found", { status: 404 });
          }
        }
      }

      if (!response) {
        response = new Response("Not Found", { status: 404 });
      }
    } catch (error) {
      target.dispatchEvent(new ErrorEvent("error", { error, message: error?.message }));
      // Prefer a tagged status from the error (e.g. the 400 thrown by
      // `toWebRequest()` for a malformed URL, or a 413 thrown by
      // `body.mjs`'s `json()`/`text()` for an oversized payload) so those
      // don't get flattened into a generic 500.
      const status =
        Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599
          ? error.status
          : 500;
      response = new Response(
        status === 500 ? "Internal Server Error" : error.message || "Error",
        { status }
      );
    }

    // `Headers` iteration yields one [name, value] pair per occurrence for
    // headers that aren't combined (notably `Set-Cookie`, which the Fetch
    // spec deliberately keeps distinct instead of comma-joining). Passing
    // that straight through `Object.fromEntries()` collapses duplicate
    // keys, silently dropping all but the last Set-Cookie header. Collect
    // same-named values first and hand Node an array so it emits one
    // header line per value.
    const headersByName = new Map();
    for (const [key, value] of response.headers) {
      if (headersByName.has(key)) {
        headersByName.get(key).push(value);
      } else {
        headersByName.set(key, [value]);
      }
    }
    const headObject = {};
    for (const [key, values] of headersByName) {
      headObject[key] = values.length === 1 ? values[0] : values;
    }
    res.writeHead(response.status, headObject);

    if (response.body instanceof ReadableStream) {
      // `.pipe()` does not forward source errors to the destination — if
      // the stream errors mid-response, the unhandled 'error' event on the
      // Readable crashes the whole process. `pipeline()` wires up error
      // propagation and destroys both sides for us.
      pipeline(Readable.fromWeb(response.body), res, (err) => {
        if (err) {
          target.dispatchEvent(new ErrorEvent("error", { error: err, message: err.message }));
          res.destroy(err);
        }
      });
    } else {
      res.end(response.body);
    }
  };

  const server = options.https
    ? https.createServer(options.https, handler)
    : http.createServer(handler);

  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws, req) => {
    target.dispatchEvent(new WebSocketEvent(ws));
  });

  return new Promise((resolve) => {
    server.listen(options.port, () => {
      const index = servers.length;
      servers.push(server);
      target.dispatchEvent(new StartEvent(index, options.port));
      resolve(index);
    });
  });
};

const stop = (index) => {
  const server = servers[index];
  return new Promise((resolve) => {
    if (server?.listening) {
      server.close(() => {
        target.dispatchEvent(new StopEvent(index));
        delete servers[index];
        resolve();
      });
    } else {
      resolve();
    }
  });
};

// Generic escape hatch for consumer-defined event names, e.g.
// `emit("customEvent", payload)`. `CustomEvent`'s own `.detail` is the
// standard place for an arbitrary payload on a generic event -- unlike
// "fetch"/"start"/"stop"/"websocket"/"error" above, there's no fixed shape
// to flatten onto named properties here, since the payload can be
// anything.
const emit = (event, detail) => {
  return target.dispatchEvent(new CustomEvent(event, { detail }));
};

const use = (middleware) => {
  middlewares.push(middleware);
};

const route = (method, path, handler) => {
  // URLPattern's `:name` colon-parameter syntax is a superset of what this
  // package's own hand-rolled matcher already supported, so every existing
  // `route(method, "/hello/:name", ...)` call keeps working unchanged --
  // only the *matching engine* underneath changed, along with what a
  // handler receives the params through (see below).
  const pattern = new URLPatternImpl({ pathname: path });
  routes.push({ method, pattern, handler });
};

const createServerSentEvent = (data, event, id) => {
  let sseData = "";
  if (event) {
    sseData += `event: ${event}\n`;
  }
  if (id) {
    sseData += `id: ${id}\n`;
  }
  sseData += `data: ${JSON.stringify(data)}\n\n`;
  return sseData;
};

export {
  servers,
  addEventListener,
  removeEventListener,
  start,
  stop,
  emit,
  use,
  route,
  createServerSentEvent,
};
