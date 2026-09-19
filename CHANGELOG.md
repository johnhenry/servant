# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project will adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once it reaches 1.0.0.

## 0.0.0

Initial release. `servant` is extracted from
[`leserve`](https://github.com/johnhenry/serve-cold)'s `controls.mjs` and
`event.mjs`: a self-contained, event-driven HTTP/HTTPS server (its own
`http`/`https` server loop, its own `WebSocketServer`, its own
middleware/route arrays, and an `EventEmitter`-based
`addEventListener`/`removeEventListener` API with a service-worker-style
`fetchEvent.respondWith()` fallback) that had been living alongside
`leserve`'s actively-maintained `serve()` implementation in the same
package despite sharing nothing with it except the Node
`IncomingMessage` → Web `Request` conversion (`leserve/node-request`).

`leserve`'s own README and CHANGELOG had already been framing this as a
"separate, incompatible" API distinct from the recommended `serve()` for
several releases; this package makes that split real at the package
boundary instead of just the documentation.

Behavior is unchanged from `leserve@0.0.0`'s `controls.mjs`/`event.mjs` —
this is a pure extraction, not a rewrite. `leserve` is a real (non-optional)
dependency on the published `@johnhenry/leserve`, not a `file:` path --
`servant` genuinely can't function without `leserve/node-request`, so this
was never meant to be optional the way `servable`'s peer dependency on
`leserve` is.
