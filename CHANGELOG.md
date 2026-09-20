# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project will adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once it reaches 1.0.0.

## Unreleased

### Changed (breaking)

- **Raised `engines.node` to `>=26.0.0`** (was `>=18.19`). Found while
  building the `EventTarget`/`URLPattern` conformance work below: `Event`/
  `EventTarget`/`CustomEvent` have been real Node globals for years, but
  `ErrorEvent` is genuinely recent -- confirmed directly still missing on
  Node 24, only landing as a real global on Node 26. Targeting 26+ let
  every one of these ship as a plain native-global usage with no fallback
  code or polyfill dependency anywhere in this package.
- **`route`'s path matching now uses the native `URLPattern` global**
  directly (no `urlpattern-polyfill` dependency -- Node 26 has it
  natively, confirmed directly), replacing a hand-rolled colon-parameter
  splitter. `URLPattern` is also on the WinterTC Minimum Common Web API's
  required list.
- **`addEventListener`/`removeEventListener` are now the real, standard
  `EventTarget` methods, not wrappers around an internal `EventEmitter`.**
  Motivated by the [WinterTC Minimum Common Web
  API](https://min-common-api.proposal.wintertc.org/), which requires
  `EventTarget`/`Event`/`CustomEvent`/`ErrorEvent` as globals every
  conformant server-side runtime exposes -- all four are real, native Node
  globals on this package's engines floor (see the `engines.node` bump
  above), so this was a real, fixable gap, not a missing platform feature.
  Every listener now receives a real `Event` (or a real
  standard subclass) instead of a plain object or bare value:
  - `"error"` listeners now receive a real `ErrorEvent` (`.message`,
    `.error` holding the original thrown value) instead of the raw
    `Error` directly.
  - `"start"`/`"stop"` listeners now receive an `Event` with `.index`/
    `.port` instead of a plain `{index, port}` object -- destructuring
    (`({index, port}) => ...`) still works unchanged, since those are
    still own properties, just now on a real `Event` instance.
  - `"websocket"` listeners now receive an `Event` with `.socket` (the
    `ws` library socket) instead of the raw socket directly.
  - `"fetch"` listeners are unchanged in shape -- `.request`/
    `.respondWith()` already worked this way; the object handed to the
    listener is now a genuine `FetchEvent` instance instead of a plain
    object carrying the same two members.
  - `emit(name, ...args)` is now `emit(name, detail)`, dispatching a real
    `CustomEvent`; listeners read the payload via `event.detail` instead
    of receiving it as a direct argument.

  A real semantic difference from `EventEmitter` had to be handled
  carefully: `EventTarget#dispatchEvent()` does **not** propagate a
  synchronously-thrown listener exception to its caller the way
  `EventEmitter#emit()` does -- confirmed directly, a throwing listener
  crashes the process on the next tick instead, with `dispatchEvent()`
  itself returning normally. Without accounting for this, a throwing
  `"fetch"` handler would have crashed the whole server instead of
  producing the clean 500 response it always has. `"fetch"` listeners are
  now wrapped (transparently, at `addEventListener("fetch", ...)`
  registration) to catch a synchronous throw and surface it back to
  `start()`'s own dispatch site, which re-throws it inside its existing
  try/catch -- every other event name goes through the real, unmodified
  `EventTarget` methods.

- Existing `route(method, "/hello/:name", handler)` registrations need no
  syntax changes from the `URLPattern` switch above -- `:name` is valid
  `URLPattern` syntax too -- but **the handler signature changed**:
  `route`'s handler and `use`'s middleware both now receive `(request,
  ctx)` instead of `(request, params)` / `(request, response)`
  respectively. `ctx` is `{ params,
  state, remoteAddress, raw }`, matching `leserve`'s own `serve()` context
  shape for consistency across the family; `use`'s old second argument
  (`response`) was already dead in practice -- the middleware loop
  `break`s the instant one middleware returns a `Response`, so no later
  middleware ever actually observed a prior one's result.

  Deliberately **not** adopting a Cloudflare-Workers-style `(request, env,
  ctx)` three-argument signature: `env` is a real concept there (runtime-
  injected bindings -- KV namespaces, secrets, service bindings) with no
  equivalent in this Node-based server; adding an unused `env` parameter
  would copy the shape of that convention without the substance behind
  it.

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
