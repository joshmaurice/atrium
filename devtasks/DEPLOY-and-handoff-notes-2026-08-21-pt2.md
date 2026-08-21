# Deploy & handoff notes — session of 2026-08-21 (part 2)

Supersedes nothing; read alongside `devtasks/DEPLOY-and-handoff-notes-2026-08-21.md`
(this same day's earlier notes). Where the two conflict, this file is newer.

## Where the project stands

**Phase 1 of user accounts, steps 1, 2a, 2b, and 2c are complete and merged
to `main`.**

| Step | What | Status |
|---|---|---|
| 1 | Peer identity & routing | Merged, deployed to prod |
| 2a | HTTP server restructure | Merged, running in dev |
| 2b | Persistence layer (SQLite) | Merged, running in dev |
| 2c | Auth (register/login/logout/me, Argon2id, cookies) | Merged, running in dev, live-verified |
| 2d | World CRUD, session sweep, honeypot | **Next** |

Task brief for this session's work: `devtasks/TASK-auth.md`.

### Deployment state

- **prod** (`/srv/atrium`, port 3000) — still on `81bc709`, peer-routing only.
  Unchanged this session; deliberately not updated (same reasoning as
  before — better to deploy the whole auth phase together than
  incrementally).
- **dev** (`/srv/atrium-dev`, port 3100) — on merged `main` (`e6cec76` at end
  of session), full stack including auth running, database at
  `/var/lib/atrium-dev/atrium.db`. Migration 2 (`password_hash NOT NULL`) has
  run against this live database.

### What 2c actually landed

- `packages/server/src/auth.js` — new module: Argon2id hashing (`argon2`
  package, prebuilt binary, no compilation needed — confirmed via ~146ms
  install), password validation (15-char minimum + ~1000-entry blocklist at
  `packages/server/src/password-blocklist.txt`, sourced from SecLists),
  username normalization.
- `packages/server/src/http-routes.js` — `POST /api/auth/register`,
  `/login`, `/logout`, `GET /api/auth/me`. Origin validation on all
  state-changing routes. Per-IP rate limiting (20 req/min) on register and
  login.
- `packages/server/src/session.js` — the `httpServer.on('upgrade', ...)` seam
  now resolves `authSessionId → userId` from the cookie before
  `wss.handleUpgrade` runs; `session.userId` is `null` for anonymous
  connections. **This is where 2d's ownership checks will read from.**
- `packages/server/src/db.js` — migration 2: rebuilds `users` with
  `password_hash NOT NULL` (SQLite can't `ALTER COLUMN`; used the
  create-copy-drop-rename pattern inside the existing migration runner).
- Test files: `auth.test.js` (new, no fixed ports — pure functions, no
  server), `rate-limit.test.js` (new, port 3016 — recorded in `AGENTS.md`),
  `http-integration.test.js` and `db.test.js` extended.

## Operational gotchas discovered this session

### 1. The Node container/host mismatch from last session's notes — fixed, with one nuance

Pinned `terminal.docker_image` (and the three sibling `*_image` keys) in
`~/.hermes/config.yaml` to `nikolaik/python-nodejs:python3.11-nodejs22`.
Because `terminal.container_persistent: true`, editing the config alone
didn't touch the already-running container — had to `docker rm` the old one
(`hermes-c7b007fd`) and let Hermes build a fresh one on next use. Confirmed
via `NODE_MODULE_VERSION 127` matching on both sides, and a clean 103/103
test run in both places.

**Argon2 turned out to be the same category of risk, flagged in the 2c
brief.** It resolved cleanly — the `argon2` npm package installs via
prebuilt binary, no compilation, no ABI drama. But it's worth remembering
for any *future* native dependency: check this before assuming
Node-22-everywhere means ABI parity is automatic.

**There's a second `hermes-*` container** (`hermes-ba6047dd`) still on
`nodejs20`, same `default` profile config. Not touched this session since it
isn't bound to the Atrium workspace mount — but if it's ever pressed into
use for this project, it'll need the same pin.

### 2. `/srv/atrium-dev` git status can lie about being current

`git status` said "up to date with origin/main" while actually sitting one
commit behind — because that check only compares against the last-fetched
local ref, not a live look at the remote. `git fetch origin` before trusting
`git status` on any of the four checkouts, not just the two that get
merged/pushed from directly.

### 3. `/srv/atrium-dev` needed its own `pnpm install`

Bind-mount `node_modules` sharing only applies within Hermes's
container/host pair. `/srv/atrium-dev` is a fully separate checkout with its
own `node_modules` — new dependencies (`argon2`) had to be installed there
independently before tests or the service itself would work. Expect the
same for `/srv/atrium` when 2c eventually deploys to prod.

### 4. Private browser windows share one cookie jar until every window in that session closes

Not isolated per-tab, and not "no cookies" the way plain incognito
assumptions might suggest — a private session keeps one shared jar across
all its tabs, and only clears when the *last* window in that session closes.
Cost some back-and-forth while trying to get one authenticated and one
anonymous tab open side by side. The reliable way to force a clean anonymous
state: delete the specific cookie in devtools Storage/Application, or fully
close out of private browsing and reopen.

### 5. `git push` showing few "objects" transferred isn't a sign anything's wrong

Pushing the `main`+`feature/auth` merge from `/srv/atrium-dev` showed only
"Enumerating objects: 1" — looked suspicious at a glance, but correct: git
already had all of `feature/auth`'s blobs/trees from the earlier branch
push; only the new merge commit itself was novel.

## Working with Hermes — new observations this session

Confirms the "writes tests that cannot fail" pattern from before, in a fresh
instance: the `password_hash NOT NULL` migration got a test asserting the
migration's *description string* matched, not one that actually inserted a
NULL and checked for rejection — passed regardless of whether the constraint
worked. Caught by comparing it against the structurally-identical
`auth_sessions.expires_at is NOT NULL` test from 2b, which does it right.

**The falsification countermeasure worked cleanly on request.** Asked Hermes
to revert the constraint, run the new test, and report the exact failure —
it did, reported `Missing expected exception.` verbatim, restored the
constraint, reran clean. No resistance, no substitution this time (contrast
with 2b's "substituted a second test rather than performing the destructive
experiment" from last session's notes).

**One report omission worth noting for next time:** the original 2c report
didn't mention the Argon2 ABI verification at all, despite the brief
explicitly asking for it (point 3) — the underlying work turned out to be
fine, but the report simply didn't say so. Worth spot-checking
specifically-requested verification steps against the report even when
everything else checks out, since an omission looks identical to "not done"
from the outside.

## Brief-writing patterns that worked

- **Grounding the brief in the actual current source** (reading
  `http-routes.js`, `db.js`, `session.js` directly before writing, not just
  the design doc) caught a real discrepancy before Hermes ever saw the
  brief — `lib/` vs `src/` needed the same resolution 2b already
  established, and would've been a silent guess otherwise.
- **Making a call on an open design question inside the brief**
  (`password_hash NOT NULL`, migration approach) rather than leaving it for
  Hermes to discover mid-task — flagged as overridable, but decided by
  default. Reduced ambiguity without removing the human's ability to
  disagree.
- **Naming the specific instances of the authority-boundary pattern**, not
  just the generic template language — e.g. spelling out "a login with
  someone else's `authSessionId`" instead of only the abstract instruction.
  Seemed to correlate with genuinely thorough disagreement tests in the
  result, though that's one data point.
- **Kept both sides of the credentials/session-consumption "seam"**
  (mentioned as a possible split point in the prior notes) in one brief
  rather than two. Turned out fine at this scope — the two sides share one
  trust primitive (`authSessionId`) and there wasn't much to gain from
  sequencing them separately.

## Next: step 2d (World CRUD, session sweep, honeypot)

Scope, per `docs/DESIGN-user-accounts.md`:

- `GET/POST /api/worlds`, `GET/PUT/DELETE /api/worlds/:id` — added to
  `http-routes.js`, reading `session.userId` established by 2c for ownership
  checks
- Server-authoritative saves via `world.serialize({ excludeNodes })`,
  excluding avatars (the `excludeNodes` option itself doesn't exist yet —
  needs building, fed from the server's tracked `session.avatarNodeName`
  values, not any client-supplied marker)
- Periodic sweep of the `auth_sessions` table (expired rows) — the
  `expires_at` column and its NOT NULL constraint already exist from 2b/2c;
  only the background job is new
- Honeypot field on the registration form — this is client-side
  (`apps/client`), so it's the first task in Phase 1 that touches the
  client, not just the server

### Known decisions to make in 2d

- **`worlds.visibility` has no CHECK constraint** — any string is currently
  accepted; design implies `private`/`public`. Flagged in 2c's notes as
  "probably 2d's problem" — it is.
- **This task has the same authority-boundary weight as 2c**, arguably more
  surface area: "can user A load/edit/delete user B's world" is the whole
  point of World CRUD. Expect similar review depth.
- **No client auth UI exists yet.** 2d's honeypot field needs *a*
  registration form to attach to — worth deciding whether building a
  minimal one is in 2d's scope or whether it's better split into its own
  task, since the design doc lists client UI as a separate line item from
  World CRUD.

## Merge checklist (carried forward, one addition)

1. `git fetch origin` **before** `git status` — don't trust a cached "up to
   date" on any of the four checkouts.
2. `git status` in the checkout you're standing in — confirm branch and
   clean tree.
3. `pnpm install` if the checkout hasn't seen this branch's dependencies yet
   (new native deps need this even with a shared `node_modules` bind mount
   elsewhere).
4. `node --test packages/server/test/*.test.js` — all files, batched, on the
   host (Node 22).
5. Merge, then verify the push landed by fetching from the remote, not by
   trusting push output.
6. Restart the service, check `journalctl` for the full boot sequence
   (world loaded → database path → listening, no errors in between — a
   migration failure would appear as a crash before "listening").
7. Live smoke test in incognito/private windows — for anything touching auth
   or the upgrade path, that means actually registering/logging in via
   devtools console (no UI yet), not just connecting anonymously.
8. Return dev to `main` afterward so it isn't stranded on a merged branch.

## Minor open items (carried forward, still unresolved)

- A second computer still can't load `dev.5-78-232-73.sslip.io` while prod
  loads fine — undiagnosed, suspect TLS. More relevant now than before,
  since it'll block testing login from that machine specifically.
- `http-integration.test.js` still missing its trailing newline. Cosmetic.
- The upgrade-test 300ms fixed sleep — unchanged, still a latent flakiness
  risk under load, not a regression.

## New minor open items

- No server-side introspection endpoint for confirming a live connection's
  resolved `userId` from outside. Verified this session via test coverage +
  external cookie evidence instead — sufficient for 2c, but if 2d's
  ownership checks misbehave in a way that's hard to reproduce, this gap
  will make debugging harder. Worth a cheap addition (a debug-only endpoint,
  or a permanent low-noise log line) if it comes up again.
- The Hermes container `hermes-ba6047dd` (see gotcha #1) is still on Node 20
  and un-pinned. Not urgent unless it starts getting used for this project.
