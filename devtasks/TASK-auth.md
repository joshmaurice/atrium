# Task: Authentication — register/login/logout/me (Phase 1, step 2c)

## Context

Steps 1 (peer identity & routing), 2a (HTTP server restructure), and 2b
(persistence layer) are merged to `main`. This task adds the account layer:
registration, login, logout, a `me` endpoint, and the cookie-based session
that both the new HTTP routes and the WebSocket upgrade will trust. It's the
first task in the project with real authority boundaries — "can user A act
as user B" — so budget more review effort here than 2a and 2b combined.

The authoritative specification is in `docs/DESIGN-user-accounts.md`,
primarily the **Auth Flow** and **Security baseline** sections. Read it in
full before starting. Also read `AGENTS.md` for stack, conventions, and known
gotchas — in particular the test-port table and the server-test-hang gotcha.
This brief does not restate the spec — the design doc is authoritative.
**If anything here conflicts with the design doc, the design doc wins; flag
the conflict rather than guessing.**

## What to build

Implement the four auth endpoints and the cookie → userId resolution they
enable. The authoritative checklist is the **Security baseline** bullet list
and the auth-related bullets under **Phasing → Phase 1** in
`docs/DESIGN-user-accounts.md` — implement every item those list, not a fixed
number from this brief. If a summary here differs from either list, the
design doc is correct.

Two seams already exist for this work, built for exactly this purpose:

- `packages/server/src/http-routes.js` — `createRequestHandler()` already
  takes an options param for dependency injection. Add
  `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`,
  `GET /api/auth/me` here.
- `packages/server/src/session.js`, inside the `httpServer.on('upgrade', ...)`
  handler — the code comment there already names this as "the seam for later
  cookie and Origin validation at upgrade time." Cookie parsing and
  `authSessionId → userId` resolution happen here, before `wss.handleUpgrade`
  runs. Attach the resolved `userId` (or `null` for anonymous) to the
  server-side session object.

New module: `packages/server/src/auth.js` for hashing, session-row creation,
and cookie construction (see "`lib/` vs `src/`" below for why `src/`, not
`lib/`).

## How to work

- **Create a branch first.** Do not commit to `main`. Name it
  `feature/auth`. All work for this task lives on that branch.

- **One commit per checklist item.** Focused, independently reviewable
  commits — not one large one. Each commit should leave the test suite green.

- **Per AGENTS.md: schema, validator, and tests move together in the same
  commit.** A commit that changes a message/data shape without updating its
  schema and the associated tests is incomplete. Do not split those across
  commits.

- **Tests run against real implementations** (real server, real schemas, real
  database), per the repo convention — no mocks standing in for the real
  thing.

- **After each commit, run the affected package tests and confirm green**
  before moving on. Use the per-package test commands from AGENTS.md, not the
  top-level runner (known gltf-extension failure). Mind the server-test-hang
  gotcha and run server test files individually if needed.

- **Push the branch** to `origin` (`joshmaurice/atrium`) when done, for
  review before any merge to `main`. **Do not merge to `main` yourself.**

## Authority boundaries — test the disagreement case, not just the happy path

For any code in this task that enforces server authority — anywhere the
server assigns, validates, rejects, or overrides a value the client also
supplies — the tests **must** include at least one case where the client
sends a value that **conflicts** with what the server expects, and assert the
server's value wins.

A happy-path test (client sends the value the server would have assigned
anyway) does **not** satisfy this — it passes whether or not the check works,
because the two values are identical. The proving test is the one where they
differ. For each authority boundary, write a test that:

1. Puts the server in its authoritative state (it has assigned/decided the value).
2. Has the client send a **different** value for the same thing.
3. Asserts the server **rejects** (with the specific error code) or
   **overrides** with its own value — whichever the design specifies.
4. Asserts the server's authoritative state is **unchanged** by the attempt.

**Before considering the task done**, for every line where the server reads a
client-supplied value, ask: *"What happens if the client lied here?"* If a
test doesn't cover it, that test is missing. "It can't happen because the
client is well-behaved" is not an answer — server authority means not
depending on the client being well-behaved.

This task has several concrete instances of this pattern worth naming
explicitly (non-exhaustive — apply the question above everywhere else too):
a request with someone else's valid-looking `authSessionId` must not resolve
to the wrong `userId`; a login attempt against a real username with a wrong
password must not succeed or leak which part was wrong; an expired
`auth_sessions` row must not resolve to a valid `userId`; a WebSocket upgrade
with a tampered or unknown cookie value must land as anonymous, not error out
in a way that accidentally grants access.

## Points that are easy to get subtly wrong

1. **`lib/` vs `src/`.** The design doc's architecture diagram shows
   `lib/auth.js`, `lib/db.js`, `lib/session.js`. No `lib/` directory exists;
   `db.js` and `session.js` already live in `src/` from 2a/2b. Use
   `src/auth.js`, consistent with the existing layout — same resolution 2b
   used for `db.js`.

2. **`password_hash` should become `NOT NULL` in this task.** It's currently
   nullable (`db.js` migration 1, with a comment saying so "until auth task
   (2c)") specifically because no code wrote to it yet — every registration
   path now always sets it. SQLite can't `ALTER COLUMN`, so this needs a
   migration 2 that rebuilds the `users` table (create a new table with the
   constraint, copy rows, drop the old one, rename — inside the existing
   migration-runner pattern in `db.js`). This is a recommendation, not a
   spec requirement pulled from the design doc — override it if you disagree,
   but decide deliberately and say so in the report, don't leave the column
   loosely typed by default.

3. **Argon2 bindings are ABI-sensitive too.** Whatever Argon2id library gets
   added (e.g. `argon2`, `@node-rs/argon2`) is a native module — the same
   category that just cost a full session to debug with `better-sqlite3`.
   Before relying on it: confirm it installs with a prebuilt binary for this
   Node version rather than compiling from source; if it does compile from
   source, expect the same container/host split and the same
   `pnpm-workspace.yaml` `allowBuilds` requirement `better-sqlite3` needed.
   Verify it actually loads inside Hermes's container (now pinned to Node
   22) — don't assume parity with the host just because both now claim
   Node 22.

4. **Duplicate username is a client-facing error, not a raw exception.**
   `idx_users_username_ci` already enforces case-insensitive uniqueness at
   the DB layer (from 2b). A colliding registration will throw a SQLite
   constraint error from `better-sqlite3` — catch it and return a proper 4xx
   with a generic message, not a 500 or a leaked stack trace.

5. **Generic failure messages cut both ways.** "Invalid credentials" for
   login (per the design doc) should cover both unknown username and wrong
   password. Apply the same discipline to registration's uniqueness check —
   don't confirm or deny that a specific username exists via response timing
   or wording differences either.

6. **`Origin` validation belongs in two separate places**, both required by
   the design doc's security baseline: on the WebSocket upgrade, and on
   state-changing HTTP routes (register/login/logout — not `GET /api/auth/me`
   or `GET /api/health`). It's easy to add one and consider CSRF handled.

7. **Rate limiting, Origin validation, and CSRF ship in this task**, per the
   design doc and the prior session's explicit note — do not split them into
   a follow-up. An endpoint that merely works, with these protections
   deferred, is not "done" for this task.

8. **The design doc leaves the CSRF custom-header requirement optional**
   ("may require an Atrium-specific request header"). Decide either way and
   record the decision in a code comment and the report — don't leave it
   implicit with no note on why `Origin` + `SameSite=Lax` alone was judged
   sufficient (or wasn't).

9. **The password blocklist needs an actual data source, not a stub.** The
   design doc asks for a check against "common, expected, or
   known-compromised passwords" but doesn't specify a list. A small bundled
   list (a few thousand common passwords, checked case-insensitively, no
   live network call — keeps tests deterministic and offline) satisfies the
   requirement without over-building. Source and licensing of whatever list
   is used should be noted in the commit.

10. **New test file(s) need new ports.** Current allocation (`AGENTS.md`)
    runs through 3014. Pick fresh, non-overlapping ports and update the
    `AGENTS.md` port table in the same commit — this exact kind of drift
    caused a real collision during 2a/2b.

11. **Cookie `Secure` needs HTTPS to actually stick in a browser.** The dev
    Caddy proxy already terminates TLS and forwards `/api/*` to
    `localhost:3100` (verified end-to-end last session), so browser testing
    against `https://dev.5-78-232-73.sslip.io` will work. A bare
    `node src/index.js` reached directly over plain HTTP will not set the
    cookie in a real browser — expected, not a bug, if it comes up while
    poking at the server directly.

## Out of scope

No World CRUD (`/api/worlds/*`) — that's 2d. No honeypot field and no
periodic `auth_sessions` sweep job — both are explicitly deferred to 2d per
the current task table in `devtasks/DEPLOY-and-handoff-notes-2026-08-21.md`,
even though the design doc's security-baseline list mentions them alongside
this task's items. The `expires_at` *column* already exists from 2b and this
task's login/register code should set it correctly on every new session row
— only the background sweep that deletes expired rows is deferred. Also out
of scope: the `worlds.visibility` CHECK constraint (2d's problem), home
world, preferences UI, remembered-guest identity.

## Live verification (protocol-touching work only)

This task doesn't change the live SOP protocol — no message types change.
It does touch the WebSocket **upgrade path** (cookie resolution before
`handleUpgrade`), which is exactly the kind of surface that broke silently
once before while unit tests stayed green. "Done" requires:

- An integration test that performs a real upgrade with a valid session
  cookie and asserts `session.userId` is populated server-side; one with no
  cookie and one with a garbage/expired cookie, asserting both resolve to
  anonymous (`userId = null`) rather than erroring or granting access.
- A note in the report that a **live two-client smoke test** in dev
  (register, log in, confirm the cookie round-trips through Caddy, connect
  over WS, confirm both anonymous and authenticated connections still work)
  is required before merge — this is the first time cookies flow through the
  reverse proxy for anything beyond static assets.

State explicitly in the report which of these covers the change, and what
the untested residual risk is.

## When done

Report: the branch name, the commit messages (one per checklist item), and
the test output showing each affected package green — **including the
disagreement/authority tests**, which should fail against the pre-change code
and pass after. Also report: the `password_hash NOT NULL` decision made (or
overridden) and why, which CSRF approach was chosen, and the source of the
password blocklist. State how the live verification above is satisfied. Do
not merge; the diff will be reviewed, and the WebSocket-upgrade change will
be live-smoke-tested in dev, before anything reaches `main`.
