# Task: HTTP server restructure — WebSocket upgrade on a shared port (Phase 1, step 2a)

## Context

Phase 1 step 1 (peer identity & routing) is complete, reviewed, merged to `main`,
and deployed to production. This task begins Phase 1 step 2 (auth + persistence),
but deliberately lands **only the structural precondition** for it: turning the
server from a bare WebSocket listener into an HTTP server that serves `/api/*`
routes and handles the WebSocket upgrade on the same port.

This is being done first, and alone, because the design's cookie-based auth
requires the client, the account API, and the WebSocket endpoint to be **same
origin**. That is not possible while the server is a bare `WebSocketServer`
bound directly to a port. Every later piece of Phase 1 step 2 — auth endpoints,
`authSessionId → userId` resolution at upgrade, world CRUD — sits on top of this
restructure. Landing it separately means the auth work does not have to debug
the transport change at the same time as the credential logic.

**No authentication, no database, and no persistence code is in scope here.**

The authoritative specification is in `docs/DESIGN-user-accounts.md`, sections
"Architecture", "Auth Flow → Phase 1 assumption", and "Server Changes Summary"
(the `packages/server/src/index.js` row). Read it in full before starting. Also
read `AGENTS.md` for stack, conventions, and known gotchas. This brief does not
restate the spec — the design doc is authoritative. **If anything here conflicts
with the design doc, the design doc wins; flag the conflict rather than
guessing.**

## What to build

Restructure the server so that a single Node HTTP server owns the port, serves
HTTP routes under `/api/*`, and upgrades WebSocket connections on that same
port. Current state, for reference:

- `packages/server/src/session.js:38` — `createSessionServer({ port, maxUsers, world })`
  constructs `new WebSocketServer({ port })` directly, binding the port itself.
- `packages/server/src/index.js:63` — calls `createSessionServer({ port, world })`
  and logs `Atrium server listening on ws://localhost:${port}`.
- `createSessionServer` returns `{ wss, sessions, presence }` (session.js:366).

The change:

1. **Create an HTTP server** in the server entry path and let it own the port.
2. **Attach the WebSocket server to it** rather than letting `ws` bind the port.
   Use `new WebSocketServer({ noServer: true })` plus an explicit `upgrade`
   handler, **not** `new WebSocketServer({ server })`. Rationale: the design
   requires reading a cookie and validating `Origin` at upgrade time
   (`DESIGN-user-accounts.md`, "Session continuity" and "Security baseline").
   An explicit upgrade handler is where that logic will live in the next task.
   Do not implement the cookie or Origin logic now — just establish the seam.
3. **Add one trivial route: `GET /api/health`**, returning
   `200 application/json` with a minimal body (e.g. `{ "status": "ok" }`). Its
   only purpose is to prove HTTP routing and WS upgrade coexist on one port. Do
   not add any other route.
4. **Return the HTTP server alongside the existing handles** so callers and tests
   can shut it down — extend the return value rather than replacing it (see
   "Points that are easy to get subtly wrong" #1).
5. **Update the startup log** in `index.js` to reflect that the port now serves
   both HTTP and WebSocket, rather than only `ws://`.

Route dispatch should be plain Node `http` — do not add Express or another
framework. The repo is ES modules, no build step, no TypeScript (`AGENTS.md`).

## How to work

- **Create a branch first.** Do not commit to `main`. Name it
  `feature/http-server-restructure`. All work for this task lives on that branch.

- **One commit per checklist item.** Focused, independently reviewable
  commits — not one large one. Each commit should leave the test suite green.

- **Per AGENTS.md: schema, validator, and tests move together in the same
  commit.** (This task is not expected to change any SOP schema — see "Out of
  scope". If you find yourself needing to, stop and flag it.)

- **Tests run against real implementations** (real server, real HTTP requests,
  real WebSocket clients), per the repo convention — no mocks standing in for
  the real thing.

- **After each commit, run the affected package tests and confirm green** before
  moving on. Use the per-package test commands from AGENTS.md, not the top-level
  runner (known gltf-extension failure). Mind the server-test-hang gotcha and run
  server test files individually — this task touches teardown directly, so that
  gotcha is especially live here.

- **Push the branch** to `origin` (`joshmaurice/atrium`) when done, for review
  before any merge to `main`. **Do not merge to `main` yourself.**

## Authority boundaries — test the disagreement case, not just the happy path

For any code in this task that enforces server authority — anywhere the server
assigns, validates, rejects, or overrides a value the client also supplies — the
tests **must** include at least one case where the client sends a value that
**conflicts** with what the server expects, and assert the server's value wins.

A happy-path test (client sends the value the server would have assigned anyway)
does **not** satisfy this — it passes whether or not the check works, because the
two values are identical. The proving test is the one where they differ. For each
authority boundary, write a test that:

1. Puts the server in its authoritative state (it has assigned/decided the value).
2. Has the client send a **different** value for the same thing.
3. Asserts the server **rejects** (with the specific error code) or **overrides**
   with its own value — whichever the design specifies.
4. Asserts the server's authoritative state is **unchanged** by the attempt.

**Before considering the task done**, for every line where the server reads a
client-supplied value, ask: *"What happens if the client lied here?"* If a test
doesn't cover it, that test is missing. "It can't happen because the client is
well-behaved" is not an answer — server authority means not depending on the
client being well-behaved.

If this task has **no** authority boundary (pure client-side work, a mechanical
refactor with no trust decision), **say so explicitly in your report** rather
than omitting this section silently — so the absence is a recorded decision, not
an oversight.

> Note for this task specifically: this restructure is expected to introduce **no
> new authority boundary** — it moves transport plumbing and adds no trust
> decision. The trust decisions (cookie resolution, `Origin` validation) arrive
> in the next task. Confirm this explicitly in your report. If you find yourself
> adding a validation or rejection path, that is scope drift — stop and flag it.

## Points that are easy to get subtly wrong

1. **Teardown and the return contract.** `createSessionServer` currently returns
   `{ wss, sessions, presence }` and existing tests rely on that shape to shut
   the server down. Once an HTTP server owns the port, closing `wss` alone no
   longer releases it — the HTTP server must be closed too, or ports leak between
   test files. This repo **already has a documented teardown hang** in
   `session.test.js` (AGENTS.md); a partial close here will make it worse and
   look like a flaky test rather than a bug. Extend the return value (e.g. add
   `httpServer`, and/or provide a `close()` that closes both in the correct
   order) and make sure existing callers and tests still work.

2. **Open WebSocket connections keep the HTTP server alive.** `server.close()`
   stops accepting new connections but waits for existing ones. Live sockets and
   the keepalive interval (`session.js:350`) must be cleaned up as part of
   shutdown, or tests hang at exit rather than failing loudly.

3. **The keepalive `clearInterval` is wired to `wss.on('close')`**
   (`session.js:362`). Confirm that still fires under the new construction —
   with `noServer: true`, `wss.close()` behaves differently than when `ws` owns
   the port. If that hook no longer fires, the interval leaks and tests hang.

4. **Port resolution must not change.** `PORT` env var wins over everything, then
   `.atrium.json` `world.server`, then default 3000 (`index.js:25-48`). Dev runs
   on 3100 and prod on 3000 via this exact path — a regression here breaks both
   deployments. Do not refactor this logic; it is out of scope.

5. **Upgrade path must reject non-WebSocket traffic cleanly.** An HTTP request to
   an unknown path should get a 404, not hang or get treated as an upgrade
   attempt. Conversely an upgrade request should not fall through to the HTTP
   router.

6. **Test ports.** AGENTS.md documents which ports the existing test files use
   (3001–3006, 3008). Any new test must not collide with those.

## Out of scope

Do not touch any of the following. If you find yourself needing to, **stop** —
something has drifted:

- **No authentication of any kind** — no cookie parsing, no `Origin` validation,
  no session resolution, no Argon2id, no rate limiting. The upgrade handler is a
  seam for that work, left empty in this task.
- **No database** — no SQLite, no schema, no migrations, no new dependencies for
  storage.
- **No world CRUD, no persistence, no `/api/worlds/*` routes.** `/api/health` is
  the only route.
- **No changes to `world.serialize()`** or any persistence-serialization option.
- **No SOP protocol or schema changes.** Message handling inside
  `createSessionServer` stays as-is; only how the server is constructed changes.
- **No changes to the peer identity/routing work** landed in step 1.
- **No static file serving.** Caddy continues to serve `apps/client` — the
  same-origin requirement is satisfied at the reverse-proxy layer, and the Caddy
  `/api/*` rule is a separate operational task handled outside this brief.
- **No port resolution changes** (see #4 above).

## Live verification

A green unit suite is **not** sufficient evidence that this works. The regression
this project has already hit (avatar movement broke while every unit test passed,
because the tests exercised handlers in isolation and never ran the full "client
resolves its own avatar node and starts sending view updates" path) must not
recur.

This task changes how WebSocket connections are established — the transport
underneath the entire connect/hello/add sequence. Unit tests that exercise
message handlers in isolation will not catch a broken upgrade path.

Therefore "done" requires **both**:

- an **integration test** that stands up the real server and asserts, against one
  running instance on one port: (a) `GET /api/health` returns 200, (b) a real
  WebSocket client connects and completes the full hello → som-dump → add
  sequence, and (c) with two connected clients, a `view` sent by one is received
  by the other. That last assertion is the one that proves the restructure did
  not break live multiplayer; and
- a note in the report that this needs a **live two-client smoke-test in the dev
  environment** before merge — the reviewer will run it (two browser tabs on
  `https://dev.5-78-232-73.sslip.io/apps/client/`, confirm avatars move and see
  each other) as a merge gate.

State explicitly in the report what the untested residual risk is. Do not claim
the task is verified on unit tests alone.

## When done

Report: the branch name, the commit messages (one per checklist item), and the
test output showing each affected package green — including the integration test
above. Explicitly confirm the authority-boundary note (that this task introduces
none). Report how live verification is satisfied and what residual risk remains.

**Do not merge.** The diff will be reviewed and the change will be
live-smoke-tested in dev before anything reaches `main`.

---

## Operational notes — OWNER ONLY, NOT PART OF THIS TASK

> **Implementing agent: this section is not work for you.** It records ops
> sequencing for the repo owner so it isn't lost between tasks. Do not perform
> these steps, do not edit any Caddy configuration, and do not treat them as
> acceptance criteria for the branch. The branch is complete without them.

These are live-VPS changes the owner performs during the review window for this
branch, before merge.

### Caddy `/api/*` reverse-proxy rule (dev first)

The design's cookie auth requires the browser to see the client, the account
API, and the WebSocket endpoint as the **same origin**
(`DESIGN-user-accounts.md`, "Auth Flow → Phase 1 assumption"). Caddy currently
serves `apps/client` statically and proxies only WebSockets to Node, so `/api/*`
has no route. That assumption is therefore currently unverified.

Add the dev rule while this branch is in review, so the same-origin path is
proven by a trivial endpoint rather than being debugged later underneath auth
logic. Rough shape — check the existing Caddyfile first, since path matchers are
order-sensitive and the current block already handles the WS proxy plus static
files:

```
handle /api/* {
    reverse_proxy localhost:3100
}
```

Per AGENTS.md and the deploy notes: run
`caddy validate --config /etc/caddy/Caddyfile` **before**
`systemctl reload caddy`. Backup lives at `/etc/caddy/Caddyfile.backup`.

Prod gets the equivalent rule (port 3000) when this work is eventually deployed —
not before.

### `/api/health` exposure

Exposing the health endpoint through the proxy is intended: it provides an uptime
check once there is an HTTP surface, and it is what actually verifies the proxy
rule end-to-end from a browser.

The constraint is the **body**: status only. No version string, no uptime, no
build info, no dependency or environment detail — those are useful for
reconnaissance and there is no reason to publish them. If the endpoint's response
grows beyond a bare status during implementation or review, trim it back.
