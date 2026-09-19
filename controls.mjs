import http from "node:http";
import https from "node:https";
import { WebSocketServer } from "ws";
import { EventEmitter } from "node:events";
import { Readable, pipeline } from "node:stream";
import { toWebRequest } from "leserve/node-request";

const eventEmitter = new EventEmitter();

// Node's `EventEmitter` special-cases the "error" event: emitting it with
// zero listeners *throws* the error instead of silently dropping it.
// `start()`'s request handler emits "error" on every caught exception
// purely to notify anyone who opted in via `addEventListener("error", ...)`
// — that's optional, not a requirement for using this server. Without this
// no-op default listener, literally any thrown route/middleware/fetch-event
// error crashes the entire process unless the consumer happens to have
// registered an error listener. A permanent no-op listener neutralizes
// that footgun; user-registered listeners still fire normally alongside it.
eventEmitter.on("error", () => {});

const middlewares = [];
const routes = [];

const addEventListener = (event, handler) => {
  eventEmitter.on(event, handler);
};

const removeEventListener = (event, handler) => {
  eventEmitter.off(event, handler);
};

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
      const request = toWebRequest(req);

      for (const middleware of middlewares) {
        const result = await middleware(request, response);
        if (result instanceof Response) {
          response = result;
          break;
        }
      }

      if (!response) {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const route = routes.find((r) => {
          if (r.method !== req.method) return false;
          const pathParts = r.path.split("/");
          const urlParts = url.pathname.split("/");
          if (pathParts.length !== urlParts.length) return false;
          const params = {};
          for (let i = 0; i < pathParts.length; i++) {
            if (pathParts[i].startsWith(":")) {
              params[pathParts[i].slice(1)] = urlParts[i];
            } else if (pathParts[i] !== urlParts[i]) {
              return false;
            }
          }
          request.params = params;
          return true;
        });

        if (route) {
          response = await route.handler(request, request.params);
        } else {
          const fetchEvent = {
            request,
            respondWith: (r) => {
              response = r;
            },
          };
          eventEmitter.emit("fetch", fetchEvent);
          if (!response) {
            response = new Response("Not Found", { status: 404 });
          }
        }
      }

      if (!response) {
        response = new Response("Not Found", { status: 404 });
      }
    } catch (error) {
      eventEmitter.emit("error", error);
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
          eventEmitter.emit("error", err);
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
    eventEmitter.emit("websocket", ws);
  });

  return new Promise((resolve) => {
    server.listen(options.port, () => {
      const index = servers.length;
      servers.push(server);
      eventEmitter.emit("start", { index, port: options.port });
      resolve(index);
    });
  });
};

const stop = (index) => {
  const server = servers[index];
  return new Promise((resolve) => {
    if (server?.listening) {
      server.close(() => {
        eventEmitter.emit("stop", { index });
        delete servers[index];
        resolve();
      });
    } else {
      resolve();
    }
  });
};

const emit = (event, ...args) => {
  return eventEmitter.emit(event, ...args);
};

const use = (middleware) => {
  middlewares.push(middleware);
};

const route = (method, path, handler) => {
  routes.push({ method, path, handler });
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
