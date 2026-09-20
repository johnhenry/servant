# servant

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

## License

This project is licensed under the MIT License.
