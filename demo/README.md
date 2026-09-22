# servant demo

A single manually-run demo, not a numbered example set — it starts a real
HTTP server and stays running, so it doesn't fit the family's
run-once-and-assert `examples/` convention. `servant`'s automated test
coverage lives in [`test.mjs`](../test.mjs) at the repo root, not here.

| File | Demonstrates |
| --- | --- |
| [`events.mjs`](./events.mjs) | The minimum viable server: `start({ port })`, then a `"fetch"` listener wired up via a dynamically-imported handler module (`_events.mjs`). |
| [`_events.mjs`](./_events.mjs) | The actual `addEventListener("fetch", ...)` handler `events.mjs` loads — returns a static `"World!"` response, kept in its own file to show that the fetch handler doesn't have to live in the same module that calls `start()`. |

## Running

```bash
npm run demo:events
# then, in another terminal:
curl http://localhost:8081/
# World!
```

The server keeps running until you stop it (Ctrl-C) — there's nothing to
assert here beyond "it responds," which is why this isn't wired into
`npm test`.
