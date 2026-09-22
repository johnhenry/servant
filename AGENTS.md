# Agent playbook

`@johnhenry/servant` — a self-contained HTTP/HTTPS/WebSocket server,
dispatched through a service-worker-style `addEventListener("fetch", ...)`
API. Single package, Node >= 26, `node --test` for tests, ships source (no
build step). It owns its own server loop end to end — the only external
`@johnhenry` dependency is `@johnhenry/leserve/node-request`'s
`toWebRequest()`; see [Family](README.md#family) before assuming any other
sibling-package interop exists.

`CLAUDE.md` in this directory is a symlink to this file.

## The verification loop (before every push)

1. `npm test` — `node --test --test-concurrency=1 test.mjs` (concurrency is
   pinned to 1 because the suite starts real servers on real ports;
   parallel runs would collide).
2. Manually exercise `npm run demo:events` against a `curl` if the change
   touches `start()`/routing/WebSocket dispatch — there's no automated
   examples smoke test here (see `demo/README.md` for why: it's a
   long-running server, not a run-once assertion).
3. A genuinely fresh clone:
   `git clone . /tmp/servant-verifyN && cd $_ && npm ci && npm test`.
   This is the only way to catch a `files` entry in `package.json` that
   doesn't actually ship `urlpattern.mjs` or `demo/`.
4. Commit, push, close the issue with a comment naming the commit SHA.

CI (`.github/workflows/ci.yml`) runs `npm ci && npm test` on the Node 26
floor; match it locally.

## Repo-specific gotchas

- **`addEventListener`/`removeEventListener` are the real, standard
  `EventTarget` methods, not a wrapper around an internal `EventEmitter`.**
  `EventTarget#dispatchEvent()` does **not** propagate a synchronously-thrown
  listener exception to its caller the way `EventEmitter#emit()` does — a
  throwing `"fetch"` listener would crash the process on the next tick
  instead of producing a clean 500, if it weren't for the wrapping `start()`
  does at `addEventListener("fetch", ...)` registration time to catch and
  re-surface synchronous throws. Any change to event dispatch has to
  preserve that wrapping, or fetch-handler exceptions stop producing 500s
  and start crashing the process. See CHANGELOG's `0.1.0` entry.
- **`request.url`/`.host` is built from the unvalidated, client-supplied
  `Host` header**, in both `controls.mjs`'s own routing and the shared
  `toWebRequest()` it depends on. This is documented as a real, unclosed
  gap in the README's [Security model](README.md#security-model) — don't
  "fix" it by adding validation without updating that section, and don't
  treat `request.url` as trustworthy in new code without a reverse-proxy
  assumption stated explicitly.
- **`leserve/node-request` is a real, non-optional dependency, not a
  `file:` path.** Unlike `servable`'s peer dependency on `leserve`, this
  package genuinely can't function without it — don't "simplify" it away
  or make it optional without replacing what `toWebRequest()` provides.

## Definition of done

A change is done when all of the following hold, not just when tests pass:
- A regression test exists for any bug fixed.
- Anything the feature does **not** do is stated in the README's
  [Security model](README.md#security-model) "still yours" list, not only
  in an issue comment — a gap that isn't documented there will get assumed
  away by the next reader.
- `CHANGELOG.md` has an entry citing the commit.
- If the change affects `demo/events.mjs`'s behavior, `demo/README.md`
  stays accurate.

## Releases

Bump `version` in `package.json` in a PR, add the `CHANGELOG.md` entry, merge,
then `gh release create v<version>` — the release event triggers
`.github/workflows/publish.yml`, which is idempotent (skips if the version is
already on npm).
