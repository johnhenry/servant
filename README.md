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
They are otherwise plain wrappers around an internal `EventEmitter`.

Available events:

| Event     | Description                                            |
| --------- | ------------------------------------------------------ |
| fetch     | Emitted for handling HTTP requests                     |
| start     | Emitted when the server starts                         |
| stop      | Emitted when the server stops                          |
| error     | Emitted when a server error occurs                     |
| websocket | Emitted when a new WebSocket connection is established |

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

Registers a middleware, run in registration order before routing/dispatch:

```javascript
use(async (req, res) => {
  console.log(`[Middleware] ${req.method} ${req.url}`);
  return req;
});
```

### `route(method, path, handler)`

Registers a route. `path` segments prefixed with `:` are captured as params:

```javascript
route("GET", "/hello/:name", async (req, params) => {
  return new Response(`Hello, ${params.name}!`, { status: 200 });
});
```

### `emit(event, ...args)`

Emits a custom event on the internal `EventEmitter`.

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
addEventListener("websocket", (ws) => {
  ws.on("message", (message) => {
    ws.send(`Echo: ${message}`);
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
