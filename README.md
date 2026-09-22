# servant

Full documentation: [opensource.johnhenry.me/servant](https://opensource.johnhenry.me/servant/)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A self-contained, batteries-included HTTP/HTTPS server for Node.js with
built-in routing, middleware, and WebSocket support, dispatched through a
service-worker-style `addEventListener("fetch", ...)` API (see
[WinterJS](https://github.com/wasmerio/winterjs)).

`servant` owns its own raw `http`/`https` server loop, its own
`WebSocketServer` wiring, and its own middleware/route arrays — it doesn't
interoperate with any other server in this family (don't `start()` a
`servant` server alongside another and expect them to share middleware or
state). The one exception is `toWebRequest` (the Node `IncomingMessage` →
Web `Request` conversion), a real, load-bearing `dependency` on
`@johnhenry/leserve/node-request` — everything else here is self-contained.
See [`CHANGELOG.md`](./CHANGELOG.md) for how this package came to exist, if
you're curious.

## Installation

```bash
npm install @johnhenry/servant
```

## Usage

```javascript
import "@johnhenry/servant/event";
import { start } from "@johnhenry/servant";

start({ port: 3000 });

addEventListener("fetch", (event) => {
  event.respondWith(new Response("Hello, World!", { status: 200 }));
});
```

See `demo/` for a working example — run it with `npm run demo:events`.

## API

### `addEventListener` / `removeEventListener`

Imported as a side effect from `@johnhenry/servant/event` — importing that
module attaches `addEventListener`/`removeEventListener` onto `globalThis`.
These are the **real, standard `EventTarget` methods** (see the [WinterTC
Minimum Common Web API](https://min-common-api.proposal.wintertc.org/),
which requires `EventTarget`/`Event`/`CustomEvent`/`ErrorEvent` as globals
every conformant server-side runtime exposes) — not wrappers around an
internal `EventEmitter`. Every listener receives a real `Event` (or a real,
standard subclass), not a plain object:

| Event     | Handler receives                                                      |
| --------- | ------------------------------------------------------------------------ |
| fetch     | A `FetchEvent` — `.request` (the `Request`), `.respondWith(response)`    |
| start     | An `Event` with `.index`, `.port`                                       |
| stop      | An `Event` with `.index`                                                |
| error     | A real `ErrorEvent` — `.message`, `.error` (the original thrown value)   |
| websocket | An `Event` with `.socket` (the `ws` library socket)                     |

`emit(name, detail)` dispatches a real `CustomEvent`; listeners read the
payload via `event.detail`.

### `start(options)`

Starts an HTTP (or, with `options.https`, HTTPS) server and returns a
Promise that resolves to that server's index (used by `stop()`).

```typescript
type ServerOptions = {
  port: number;
  https?: {
    key: string;
    cert: string;
  };
};
```

### `stop(index)`

Stops the server started with the given index.

### `use(middleware)`

Registers a middleware, run in registration order before routing/dispatch.
Both `use` and `route` (below) take the same `(request, ctx)` shape — `ctx`
is `{ params, state, remoteAddress, raw }` (`state` is a fresh `Map` per
request, for passing data between middlewares/handlers; `params` is `{}`
until a route actually matches):

```javascript
use(async (req, ctx) => {
  console.log(`[Middleware] ${req.method} ${req.url} from ${ctx.remoteAddress}`);
  return req;
});
```

### `route(method, path, handler)`

Registers a route. `path` is compiled with
[`URLPattern`](https://developer.mozilla.org/en-US/docs/Web/API/URLPattern)
(via `urlpattern-polyfill` where the runtime has no native global) --
segments prefixed with `:` are captured into `ctx.params`:

```javascript
route("GET", "/hello/:name", async (req, ctx) => {
  return new Response(`Hello, ${ctx.params.name}!`, { status: 200 });
});
```

### `emit(name, detail)`

Dispatches a real `CustomEvent(name, { detail })` on the same `EventTarget`
`addEventListener` listens on.

### `createServerSentEvent(data, event?, id?)`

Formats a single `text/event-stream` frame:

```javascript
addEventListener("fetch", (event) => {
  if (!event.request.url.endsWith("/sse")) return;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(createServerSentEvent({ hello: "world" }, "update"));
    },
  });
  event.respondWith(
    new Response(stream, { headers: { "Content-Type": "text/event-stream" } })
  );
});
```

### WebSockets

```javascript
addEventListener("websocket", (event) => {
  event.socket.on("message", (message) => {
    event.socket.send(`Echo: ${message}`);
  });
});
```

## Exports

| Export                    | Description                                                                |
| -------------------------- | --------------------------------------------------------------------------- |
| `@johnhenry/servant` or `@johnhenry/servant/controls` | `start`, `stop`, `use`, `route`, `emit`, `createServerSentEvent`, `addEventListener`, `removeEventListener` |
| `@johnhenry/servant/event` | Side-effecting module; attaches `addEventListener`/`removeEventListener` to `globalThis` |

## Security model

servant is a thin, self-contained HTTP/WebSocket server loop — it does not
add any request-level security controls beyond what raw Node `http`/`https`
gives you. Specifically:

- **No authentication or authorization.** `start()`/`use()`/`route()` dispatch every request that reaches the process to your middleware/handler chain. Access control, session/cookie validation, and API-key checks are entirely your responsibility to add via `use()`.
- **`request.url` is built from the client-supplied `Host` header, unvalidated.** Both `controls.mjs`'s own routing (`new URL(req.url, \`http://${req.headers.host}\`)`) and the shared `toWebRequest()` it depends on (`@johnhenry/leserve/node-request`) construct the request's URL/origin straight from `req.headers.host`, falling back to `"localhost"` only if the header is absent entirely — there is no allowlist or validation otherwise. A client can send any `Host` value it wants. If a handler reads `request.url` (or its `.host`/`.origin`) to build absolute links, redirects, password-reset URLs, or a CORS decision, that value is attacker-controlled input, not a trustworthy one — unless a reverse proxy in front of servant strips/overwrites the inbound `Host` header before the request reaches it.
- **Thrown errors with a tagged `.status` return `error.message` verbatim as the response body.** Only errors without a valid 400–599 `.status` fall back to the generic `"Internal Server Error"`; anything else (including a `413` from an upstream body-size check, or any error a middleware throws with a `.status` set) sends `error.message` directly to the client. Don't put internal detail — stack fragments, file paths, query values — into a thrown error's `.message` unless you intend for it to be public.
- **No built-in CORS, rate limiting, or request body size limit.** All of that is left to middleware you write with `use()`; nothing here imposes a ceiling on request size or concurrency by default.
- **WebSocket connections are accepted with no `Origin` check by default.** `wss.on("connection", ...)` dispatches every incoming WebSocket handshake to your `"websocket"` listener regardless of the connecting page's origin — the Same-Origin Policy does not apply to WebSocket handshakes, so any web page can open a connection to a servant server the same way a legitimate client would (cross-site WebSocket hijacking) unless you check for it yourself. `WebSocketEvent` exposes both `.socket` (the raw `ws` connection) and `.request` (the handshake converted to a real `Request`) — read `event.request.headers.get("origin")` and `event.socket.close(1008, "origin not allowed")` if a connecting origin isn't one you trust; servant itself enforces nothing by default.

None of the above is a defect specific to servant — it is what "a thin
wrapper around Node's `http`/`https`/`ws`" means. If you need any of these
protections, add them yourself in `use()` middleware or in front of servant
(a reverse proxy), the same way you would for Express or any other
minimal Node HTTP framework.

## License

This project is licensed under the MIT License.
