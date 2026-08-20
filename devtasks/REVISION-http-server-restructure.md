# Revision: HTTP server restructure — review fixes

## Context

This is a follow-up to `devtasks/TASK-http-server-restructure.md`. The branch
`feature/http-server-restructure` (4 commits, `352436f`..`b062525`) has been
reviewed. **The core restructure is correct and is not being redone.** The
`noServer: true` upgrade seam, the `close()` teardown ordering, the `tickStop`
cleanup, and the two-client view integration test are all good and should be
left alone.

Four items need fixing before this can merge. Continue on the **same branch**,
one commit per item.

Do not re-litigate the design. If any item below appears to conflict with
`docs/DESIGN-user-accounts.md`, the design doc wins — flag the conflict rather
than guessing.

## Item 1 — `non-WebSocket upgrade request is rejected` does not test rejection

`packages/server/test/http-integration.test.js:212`

The test named `'non-WebSocket upgrade request is rejected'` performs a plain
`GET /api/health` and asserts `200`. It never sends an upgrade request. It is a
duplicate of the first test under a different name, and it passes whether or not
the rejection logic in the upgrade handler exists at all.

The branch it is supposed to cover is `session.js`:

```js
const upgrade = request.headers['upgrade']
if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
  socket.destroy()
  return
}
```

Replace the test with one that actually drives that branch: open a raw socket or
issue an HTTP request to the shared port carrying `Connection: Upgrade` and an
`Upgrade` header whose value is **not** `websocket` (e.g. `h2c`), and assert the
connection is destroyed / closed without being handed to the WebSocket server.

**Verification requirement:** this test must **fail** if the `socket.destroy()`
branch is removed, and pass with it present. Confirm you have checked that by
temporarily removing the branch and observing the failure. Report that you did.

A test that passes in both states is not a test of this behavior.

While here: the second test is named `'GET /api/health returns 404 for unknown
path'` but requests `/api/unknown`. Rename it to describe what it does.

## Item 2 — the shipped `/api/health` route has no test coverage

`packages/server/src/index.js:65` and
`packages/server/test/http-integration.test.js:86`

The integration test constructs its own `createServer(...)` with a hand-copied
duplicate of the route dispatcher. The real dispatcher in `index.js` is an inline
closure inside the module's top-level startup path, so it cannot be imported and
is never executed by any test. The suite is currently green against a **copy** of
the routing code, not the code that runs in production.

This is low-stakes for a health endpoint and high-stakes immediately afterward:
per `docs/DESIGN-user-accounts.md`, the auth endpoints (register / login /
logout / me) land in exactly this dispatcher in the next task. They must not be
written into an untestable closure.

Extract the route dispatcher into its own module — e.g.
`packages/server/src/http-routes.js` — exporting a factory that returns the
request handler:

```js
export function createRequestHandler({ /* future deps */ } = {}) {
  return (req, res) => { /* dispatch */ }
}
```

Then:

- `index.js` imports it and passes the result to `createServer(...)`. `index.js`
  should contain no route logic of its own.
- `http-integration.test.js` imports the **same** function instead of
  re-declaring a dispatcher. The duplicate route code in the test must be
  deleted, not left alongside.

Behavior must not change: `GET /api/health` → `200 application/json`
`{"status":"ok"}`; everything else → `404`. Keep the health response body to
status only — no version, uptime, build, or environment detail.

## Item 3 — remove the dead backward-compatibility path

`packages/server/src/session.js:41`

`createSessionServer` retains an `else` branch constructing
`new WebSocketServer({ port })` when no `httpServer` is passed. This was not
requested and should be removed:

- **It is unreachable.** Every call site now passes `httpServer` —
  `index.js`, all 11 constructions in `session.test.js`, `avatar.test.js`, and
  `http-integration.test.js`. Nothing constructs by port. It is dead and
  untested code.
- **It is a security footgun for the next task.** That branch registers no
  `upgrade` handler, so it is the one construction path where the cookie
  resolution and `Origin` validation added in the next task would silently not
  apply. A future call site that omits `httpServer` would get an unauthenticated
  upgrade path that looks identical from the outside.

Make `httpServer` a required option. If it is absent, throw immediately with a
clear message rather than falling back. The `port` parameter should be removed
from `createSessionServer` entirely if nothing else reads it — the HTTP server
owns the port now. **Do not** touch the port-resolution logic in `index.js`
(`PORT` → `.atrium.json` `world.server` → `3000`); that stays exactly as is.

## Item 4 — remove the unused import

`packages/server/src/session.js:5`

`import { createServer } from 'node:http'` is never used in that file. Remove it.

## How to work

- **Same branch** (`feature/http-server-restructure`). Do not open a new one and
  do not merge to `main`.
- **One commit per item**, in order. Each commit leaves the suite green.
- Run the affected package tests after each commit, per-package (not the
  top-level runner — known gltf-extension failure). Run server test files
  individually if the teardown gotcha resurfaces.
- Re-run the **full** server suite at the end and confirm the teardown hang has
  not returned. The previous run reported all 28 server tests passing together
  with no hang — that should still hold after Item 3 changes the construction
  path.
- **Push the branch when done.** Note: pushing failed from the sandbox last time
  (no credentials available in the container). If it fails again, say so
  explicitly and stop — do not report the work as pushed. The push will be
  completed host-side.

## Out of scope

Unchanged from the original brief. Specifically, still **no** auth, no cookie
parsing, no `Origin` validation, no database, no world CRUD, no additional
routes beyond `/api/health`, no SOP/schema changes, no static file serving, no
Caddy configuration, and no changes to port resolution.

Item 2 creates the *place* where auth routes will live. It does not add them.

## When done

Report per item: the commit, what changed, and the test output. For Item 1,
explicitly report the result of removing the `socket.destroy()` branch and
confirming the test fails without it. Confirm the full server suite runs green
with no teardown hang. State plainly whether the push succeeded.

The live two-client dev smoke-test remains a merge gate and will be run by the
reviewer after these fixes land.
