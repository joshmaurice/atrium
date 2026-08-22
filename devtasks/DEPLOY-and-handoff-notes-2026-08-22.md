# Deploy & handoff notes — session of 2026-08-22

Supersedes nothing; read alongside `devtasks/DEPLOY-and-handoff-notes-2026-08-21.md`
and `devtasks/DEPLOY-and-handoff-notes-2026-08-21-pt2.md`. Where files
conflict, this one is newer.

## Where the project stands

**Phase 1 of user accounts, steps 1, 2a, 2b, 2c, and 2d are complete and
merged to `main`. Exactly one Phase-1 checklist item remains: client UI
(2e, unscoped as of this writing).**

| Step | What | Status |
|---|---|---|
| 1 | Peer identity & routing | Merged, deployed to prod |
| 2a | HTTP server restructure | Merged, running in dev |
| 2b | Persistence layer (SQLite) | Merged, running in dev |
| 2c | Auth (register/login/logout/me, Argon2id, cookies) | Merged, running in dev |
| 2d | World CRUD, session sweep, honeypot | Merged, running in dev, live-verified |
| 2e | Client auth + world-browser UI | **Next — no brief written yet** |

Task briefs for this session's work: `devtasks/TASK-world-crud.md`, followed
by `devtasks/REVISION-world-crud.md` (a second brief was needed — see below).

### Deployment state

- **prod** (`/srv/atrium`, port 3000) — still on `81bc709`, peer-routing
  only. Unchanged again this session; the gap between prod and dev is now
  three phases wide (2a–2d). Still deliberate — same reasoning as before,
  deploy the whole phase together — but worth a conscious decision at some
  point about whether that gap should keep growing through 2e too.
- **dev** (`/srv/atrium-dev`, port 3100) — on merged `main` (`e2c192e` at
  end of session), full stack including World CRUD running, database at
  `/var/lib/atrium-dev/atrium.db`. Migration 3 (`worlds.visibility` CHECK
  constraint) has run against this live database.

### What 2d actually landed

- `packages/server/src/world-store.js` — new module: CRUD functions for the
  `worlds` table (`listWorlds`, `getWorld`, `createWorld`, `updateWorld`,
  `deleteWorld`), following the `lib/`→`src/` resolution already established
  in 2b/2c. `http-routes.js` dispatches to it rather than inlining the SQL,
  a deliberate departure from how the auth routes are written (those do
  their queries inline) — made explicit in the brief given how much
  `http-routes.js` was already growing.
- `packages/server/src/http-routes.js` — `GET/POST /api/worlds`,
  `GET/PUT/DELETE /api/worlds/:id`; Origin validation extended to the new
  state-changing routes; honeypot check (`website` field) added to
  `POST /api/auth/register`.
- `packages/server/src/world.js` — `serialize({ excludeNodes })` option,
  generalizing the existing `externalNodeNames` filter rather than adding a
  second pass.
- `packages/server/src/db.js` — migration 3 (create-copy-drop-rename,
  `CHECK (visibility = 'private')`); `pruneExpiredAuthSessions()`.
- `packages/server/src/index.js` — `sessionsRef` mutable-reference wiring
  (the `sessions` Map from `createSessionServer` doesn't exist yet at the
  point `createRequestHandler` is constructed, so a ref container is
  threaded through and populated after); hourly sweep timer, `.unref()`'d.
- `packages/server/test/world-crud.test.js` — new, port 3017 (also fixed a
  stale doc: `AGENTS.md` had `http-integration.test.js` recorded as port
  3014; the file itself uses 3015 and always has).
- `packages/server/test/db.test.js` — extended for migration 3's expected
  count.

**This took two brief cycles, not one — worth being direct about that
rather than folding it quietly into "what landed."** The first
`feature/world-crud` submission reported `world-crud.test.js: 30/30 pass`.
Independently pulling the branch and running it gave `19/30`. Root cause was
two independent, stacking bugs:

1. `getLiveAvatarNodeNames()` in `http-routes.js` was defined at module
   scope, outside `createRequestHandler`'s closure, so it had no access to
   the local `sessionsRef` variable it needed — a `ReferenceError` on every
   call. In the shipped code as originally submitted, this meant **every
   real `PUT /api/worlds/:id` would 500** and every `POST /api/worlds`
   would silently persist an empty document. This was the actual
   server-authoritative-save feature — the core of the task — completely
   non-functional.
2. Separately, `world-crud.test.js`'s own server setup passed `worldRef`
   to `createRequestHandler`, which destructures `world` — so `world` was
   `undefined` throughout that entire test file, masking bug 1 behind a
   second, unrelated cause of the same symptom.

`devtasks/REVISION-world-crud.md` covered both plus two smaller ones (a
pre-existing `db.test.js` migration-count assertion left stale, and a
weak "avatar-like extras" test that didn't construct the thing it claimed
to test) and two non-blocking cleanups (a hardcoded honeypot sentinel id,
and a decision write-up that didn't match what the code actually did). All
six landed in one clean commit-per-item sequence, independently re-verified
afterward — `world-crud.test.js` 30/30, full server suite 133/133, no
teardown hang. A follow-up one-off commit (`d7506e3`) then removed a small
piece of now-dead fallback code the first fix had introduced.

## Operational gotchas discovered this session

### 1. Private browser windows do not give separate cookie jars — even across different windows

Refines gotcha #4 from the 2026-08-21 pt2 notes, which described this at
the tab level. It's broader: opening two *separate* private/incognito
windows, in either Firefox or Chrome, still shares one cookie jar for a
given site across all of them. (Confirmed against Mozilla's own
documentation — Firefox's Total Cookie Protection isolates cookies
*between different sites*, not between windows visiting the *same* site.)
Whichever identity registers or logs in most recently silently takes over
the one shared cookie; a script run in "the other window" a moment later
runs under that same, most-recent identity. Cost a full false-start this
session before being traced to the actual cause via `GET /api/auth/me`
returning the wrong user.

**The reliable fix for testing two identities against the same origin:
don't use browser windows at all.** Use `curl` with separate `-c`/`-b`
cookie-jar files per identity. Full manual control, no shared-state
ambiguity, and it's already the fallback both `TASK-world-crud.md` and
`REVISION-world-crud.md` named given there's no UI yet anyway.

### 2. A reported test-pass count is not evidence until it's independently reproduced

Not a new principle, but this session is the clearest example of it costing
real time: a detailed-looking, itemized report claiming `30/30` did not
match reality at all (`19/30`) on the exact committed commit. The gap
wasn't found by reading the report more carefully — the report read fine —
it was found by pulling the branch, installing dependencies, and running
`node --test` directly. The second revision round, asked explicitly to
paste raw TAP output rather than a summarized table, held up completely
under independent re-run. Worth treating "paste the raw output" as the
default ask going forward, not something reached for only after a prior
report didn't hold up.

### 3. `TASK-*.md` and `REVISION-*.md` briefs are committed differently

Worth writing down since it wasn't obvious going in and both patterns got
used this session. A new `TASK-*.md` (a fresh unit of work) is committed
directly to `main`, and a new branch is cut from that commit. A
`REVISION-*.md` (fixes on an already-reviewed branch) is committed onto the
*existing* feature branch itself, as its next commit — continuing that
branch, not starting fresh. Confirmed against git history for both
`TASK-auth.md`/`feature/auth` and
`REVISION-http-server-restructure.md`/`feature/http-server-restructure`,
and followed for `TASK-world-crud.md` → `main` and
`REVISION-world-crud.md` → `feature/world-crud` this session.

### 4. `git status` on `/srv/atrium-dev` was stale in a new way this time

Gotcha #2 from the pt2 notes ("`git status` can lie about being current")
recurred, but from a different cause than last time. `TASK-world-crud.md`'s
own brief commit had been pushed straight to `main` from the Hermes sandbox
checkout, well before any work began in `/srv/atrium-dev` — so by the time
the dev-checkout merge sequence started, `origin/main` was already one
commit ahead of what the last session's notes described. `git fetch origin`
before `git status`, still the rule, caught it immediately; a
`git merge --ff-only origin/main` was needed before checking out the
feature branch. The lesson isn't new, but the *source* of staleness this
time was an out-of-band push from a different checkout entirely, not a
locally cached ref — worth remembering both causes exist.

## Working with Hermes — new observations this session

- **The self-verification gap widened, not narrowed, on the first pass.**
  Prior sessions' notes describe "writes tests that cannot fail" — a weak
  but *technically passing* test. This session's first report went further:
  a pass count that simply didn't reproduce on the exact committed code.
  That's a different, more serious failure mode than a weak test, and it's
  the reason independent re-running (not just reading) is now the standing
  practice, not an occasional check.
- **Given a fully diagnosed, pre-verified revision brief, the fix landed
  clean.** Every item in `REVISION-world-crud.md` included the exact
  file/line and, for the two blocking bugs, a patch already applied and
  tested by the reviewer before being written into the brief. The resulting
  commits matched almost verbatim, with no scope creep and no unrequested
  rewrites — Item 4's rewritten test in particular now genuinely tests the
  property it claims to (verified by reading the diff, not just the
  report), a real improvement over the original's structural no-op.
- **A single well-specified small fix doesn't need the full brief
  machinery.** The `worldRef`/`resolveWorld()` dead-code cleanup was handed
  over as a short, direct, copy-pasteable instruction rather than another
  formal `REVISION-*.md`, and came back as a single, precisely-scoped
  commit touching nothing else. Worth reserving the full brief format for
  genuinely multi-item or judgment-requiring work.

## Next: step 2e (client auth + world-browser UI) — not yet scoped

Per `docs/DESIGN-user-accounts.md`'s Client Changes Summary table, this is
the only unchecked line left in the Phase 1 checklist:

- `apps/client/index.html` — register/login/logout UI overlay
- `apps/client/src/app.js` — auth state, UX for login/logout/register flows
- New client-side `auth.js` — HTTP client for `/api/auth/*`; cookie handling
  is automatic, so this is mostly fetch wrappers around the endpoints 2c/2d
  already built
- `apps/client/src/` — world browser panel (list, load, delete worlds)

No brief exists for this yet. **It's also the first Phase-1 task where
grounding means reading the client, not the server** —
`apps/client/src/app.js`, `index.html`, and `@atrium/client`'s
`_peerSessions` handling — a different part of the codebase than every
task since step 1.

### Known open questions for 2e

- **The honeypot field has no form to attach to yet.** 2d shipped it as a
  pure server-side check on an optional `website` field in the register
  body — deliberately, since there was no UI to attach it to and none of
  Phase 1's work up to now needed one. Whoever scopes 2e needs to actually
  wire that field into the real registration form as a hidden input. This
  is leftover work from 2d's own scope decision, not new work discovered
  now.
- **Phase 1 is explicit: no home world, no auto-save, no preferences UI.**
  A login UI naturally invites "what happens right after login" — worth
  guarding against 2e quietly growing into that scope. It's Phase 2.
- **Genuinely unresolved in the design doc, not just an implementation
  detail:** does the world-browser panel need to actually *load* a saved
  world back into the live 3D client, or only list/rename/delete? The
  design doc says loading a persisted world back into a live multiplayer
  runtime is Phase 2 work — but a "world browser" that can't open a world
  is a strange piece of UI to hand someone. Worth resolving explicitly
  before writing the brief, not discovering it mid-task.

## Merge checklist (carried forward, unchanged — worked cleanly this session)

1. `git fetch origin` **before** `git status` — don't trust a cached "up to
   date" on any of the four checkouts.
2. `git status` in the checkout you're standing in — confirm branch and
   clean tree.
3. `pnpm install` if the checkout hasn't seen this branch's dependencies
   yet.
4. `node --test packages/server/test/*.test.js` — all files, batched, on
   the host (Node 22).
5. Merge, then verify the push landed by fetching from the remote, not by
   trusting push output.
6. Restart the service, check `journalctl` for the full boot sequence
   (world loaded → database path → listening, no errors in between).
7. Live smoke test — for World CRUD or anything cross-user, use `curl` with
   separate cookie jars per identity (see gotcha #1), not separate browser
   windows.
8. Return dev to `main` afterward so it isn't stranded on a merged branch.

## Minor open items (carried forward, still unresolved)

- A second computer still can't load `dev.5-78-232-73.sslip.io` while prod
  loads fine — undiagnosed, suspect TLS. Not touched this session.
- `http-integration.test.js` still missing its trailing newline. Cosmetic.
- The upgrade-test 300ms fixed sleep — unchanged, still a latent flakiness
  risk under load, not a regression.
- No server-side introspection endpoint for confirming a live WebSocket
  connection's resolved `userId` from outside. `GET /api/auth/me` covers
  the HTTP-cookie case (and was used successfully this session to diagnose
  gotcha #1), but there's still no equivalent for an established WS
  session specifically. Not urgent unless 2e's connect-after-login flow
  makes it awkward to debug.
- The Hermes container `hermes-ba6047dd` is still on Node 20 and un-pinned.
  Not urgent unless it starts getting used for this project.

## New minor open items

- **Leftover test data in the dev database.** Six throwaway users
  (`smoketest-a`, `-a2`, `-a3`, `-b`, `-b2`, `-b3`) and their worlds
  (`smoke-test-world`, `-2`, `-3`), created while tracking down gotcha #1.
  Harmless — dev-only — but worth a cleanup pass before dev is treated as a
  clean baseline for 2e's UI testing, since a login screen with six
  half-named test accounts sitting in the list is a bit of noise to design
  against.
- **Watch for the param-name-mismatch class of bug again.** The
  `worldRef`/`world` mismatch that caused (part of) this session's biggest
  time sink wasn't a logic error — it was a destructured option silently
  being `undefined` because the caller used a different name than the
  callee expected, with no error at the call site to catch it. No action
  item, just a shape of bug worth having in mind, especially anywhere
  options objects get threaded through multiple layers (`createRequestHandler`'s
  growing `opts`, in particular).
