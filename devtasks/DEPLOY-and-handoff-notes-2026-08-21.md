# Deploy & handoff notes — session of 2026-08-21

Supersedes nothing; read alongside `devtasks/DEPLOY-and-handoff-notes.md`
(the earlier notes). Where the two conflict, this file is newer.

## Where the project stands

**Phase 1 of user accounts, steps 1, 2a, and 2b are complete and merged to
`main`.**

| Step | What | Status |
|---|---|---|
| 1 | Peer identity & routing | Merged, deployed to prod |
| 2a | HTTP server restructure | Merged, running in dev |
| 2b | Persistence layer (SQLite) | Merged, running in dev |
| 2c | Auth (register/login/logout/me, Argon2id, cookies) | **Next** |
| 2d | World CRUD, session sweep, honeypot | Not started |

Task briefs for completed work are in `devtasks/`:
`TASK-http-server-restructure.md`, `REVISION-http-server-restructure.md`,
`TASK-persistence-layer.md`.

### Deployment state

- **prod** (`/srv/atrium`, port 3000) — still on `81bc709`, i.e. peer-routing
  only. Deliberately not updated: 2a and 2b are invisible to users, and prod is
  better deployed once the auth phase is complete than incrementally through a
  half-built feature.
- **dev** (`/srv/atrium-dev`, port 3100) — on merged `main`, full stack running,
  database live at `/var/lib/atrium-dev/atrium.db`.

### What 2a and 2b actually landed

- `packages/server/src/http-routes.js` — extracted route dispatcher,
  `createRequestHandler()`. `GET /api/health` → 200 `{"status":"ok"}`;
  everything else 404. **This is where auth routes go in 2c.**
- `createSessionServer` now **requires** an `httpServer` option and throws
  without it. WebSocket upgrade uses `noServer: true` with an explicit upgrade
  handler — that handler is the **empty seam** where cookie resolution and
  `Origin` validation belong in 2c.
- `packages/server/src/db.js` — `createDb()`, versioned migration runner,
  five tables (`users`, `auth_sessions`, `worlds`, `preferences`,
  `schema_migrations`). Timestamps are ISO 8601 UTC strings.

## Operational gotchas discovered this session

These were all expensive to find. Read before touching the VPS.

### 1. Four checkouts, and they drift

The repo exists in four places on the VPS:

| Path | Purpose |
|---|---|
| `/srv/atrium` | prod deploy |
| `/srv/atrium-dev` | dev deploy |
| `/root/.hermes/sandboxes/docker/default/workspace/atrium` | Hermes's working copy (host side of bind mount) |
| `/root/atrium` | **dead** — leftover from June manual testing, nothing runs from it, ignore |

**A commit or merge made in one is invisible to the others until pushed.**
This caused the single biggest time sink of the session: a merge commit was
made in `/srv/atrium-dev`, its push failed on a credential prompt, and a
subsequent push from the bind-mount checkout pushed *that* checkout's `main` —
which didn't contain the merge. `main` on GitHub silently lacked 2a for hours,
and a branch cut from it appeared to have "reverted" work that had in fact never
landed.

**Rule: run `git status` and `git log --oneline -1` in the checkout you are
actually acting in, before branching, merging, or pushing.** Confirm a push
landed by fetching a file from the remote, not by trusting the push output.

### 2. Node version mismatch between container and host

- Hermes's container image is `python3.11-nodejs20` → **Node 20**
  (`NODE_MODULE_VERSION 115`)
- VPS host and both `/srv` checkouts → **Node 22.22.3**
  (`NODE_MODULE_VERSION 127`)

`better-sqlite3` is a native module compiled against the Node ABI. **A build
made in the container will not load on the host, and vice versa.** The bind
mount shares `node_modules`, so whichever side ran `pnpm install` last wins.

Symptom: `NODE_MODULE_VERSION 115. This version of Node.js requires 127` and
`Module did not self-register`.

Fix (rebuild in place for whichever Node is running):

```bash
cd <checkout>/node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3
npm run build-release
```

Note `pnpm rebuild better-sqlite3` did **not** work — it silently no-ops on the
nested `.pnpm` path. The in-place `npm run build-release` does work. It compiles
SQLite from source and takes 2–5 minutes with no output; that is not a hang.

**Implication for reviewing Hermes's work: "tests pass" from the container only
proves they pass on Node 20.** Anything touching a native module must be re-run
on the host before it can be considered verified.

**Worth fixing before 2c:** pin Hermes's container to a Node 22 image so both
sides match. Auth work will lean on the database heavily.

### 3. `pnpm approve-builds` / `allowBuilds`

pnpm blocks dependency install scripts by default (supply-chain protection).
`better-sqlite3` needs its build script to compile at all.

This is now recorded in `pnpm-workspace.yaml` (`allowBuilds: better-sqlite3:
true`), committed to `main`, so fresh checkouts should no longer prompt. If a
checkout predates that commit, the symptom is
`[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: better-sqlite3@11.10.0` and
the fix is `pnpm approve-builds` (interactive) or pulling the config.

**This will come up on the prod deploy.**

### 4. Database paths are set via systemd drop-ins

Not in the unit files themselves:

- `/etc/systemd/system/atrium-dev.service.d/db.conf` →
  `ATRIUM_DB_PATH=/var/lib/atrium-dev/atrium.db`
- `/etc/systemd/system/atrium.service.d/db.conf` →
  `ATRIUM_DB_PATH=/var/lib/atrium/atrium.db`

Prod's is **already set** even though prod doesn't run db code yet — it's simply
unread until 2b deploys there, so it's correct in advance rather than something
to remember mid-deploy.

Directories are `chmod 700`; the dev db file is `chmod 600`. **Do the same for
prod's db file once it exists** — it will hold password hashes and session
tokens.

`db.js`'s default path is CWD-relative. Do not rely on it; always set the env
var explicitly. Without it, databases would land inside the git working trees,
one stray `git clean` from deletion.

### 5. Caddy

Config is `/etc/caddy/Caddyfile`, **one file containing both prod and dev site
blocks** — a syntax error plus a reload takes down prod too. Always:

```bash
caddy validate --config /etc/caddy/Caddyfile   # before
systemctl reload caddy
```

Dev now has an `/api/*` reverse-proxy rule to `localhost:3100`, placed after the
websocket handle and before the catch-all `handle { respond 404 }`. Verified
end-to-end over HTTPS — this proves the **same-origin** assumption the cookie
auth design depends on.

**Prod needs the equivalent rule (→ `localhost:3000`) when 2b/2c deploy there.**
It does not have one yet, and prod's `/api/health` correctly 404s today.

### 6. Test ports

`AGENTS.md`'s port list was wrong in three places and caused a real collision
(`presence.test.js` and `http-integration.test.js` both on 3007). Now corrected
in `AGENTS.md`. Current allocation: 3001–3006 and 3009–3013 `session.test.js`,
3007 `presence.test.js`, 3008 `avatar.test.js`, 3014
`http-integration.test.js`.

Also: **`presence.test.js` and `world.test.js` were never in any of Hermes's
test reports.** Its reports only ever covered the files it touched, which is how
`presence.test.js` stayed broken on `main` for a while after 2a. Always run
`node --test packages/server/test/*.test.js` (all files, batched) before
merging, not just the ones the report mentions.

### 7. Hermes GitHub credentials — fixed, but fragile

The container was missing `~/.git-credentials` (the file lives outside the bind
mount, so the host's copy doesn't help it). `credential.helper=store` was set in
the shared `.git/config`, pointing at a file that didn't exist in the container —
hence `could not read Username`.

Fixed by writing the fine-grained PAT to
`/root/.hermes/sandboxes/docker/default/home/.git-credentials` **from the host**
(so the token never entered Hermes's context).

Key mapping, which is not obvious and took a while to find:

- `sandboxes/docker/default/home` → container's `/root`
- `sandboxes/docker/default/workspace` → container's `/workspace`
- there is a second container, `hermes-...` / `prompt-backend-probe`, with an
  empty workspace — **not** the Atrium one. The Atrium container is the
  `default` one (`hermes-c7b007fd` at time of writing).

**The PAT expires.** When it does, pushes will fail exactly as before. Note the
expiry date somewhere. Also: if the container is rebuilt, the credentials file
goes with it, since it's outside the workspace mount.

Host-side git identity is now set globally (`/root/.gitconfig`), along with
`credential.helper store`, so `/srv/atrium` and `/srv/atrium-dev` can push too.

## Working with Hermes (DeepSeek V4 Flash) — calibration

Consistent with the earlier notes, plus new observations from two task cycles.

**Strengths, confirmed:** structural and architectural refactors. The 2a
restructure (`noServer` seam, `close()` teardown ordering, `tickStop` cleanup)
and the 2b schema were both correct on the first pass. Revision briefs were
executed accurately and without scope drift.

**Weaknesses, confirmed and specific:**

1. **Writes tests that cannot fail.** In 2a it produced a test named
   `'non-WebSocket upgrade request is rejected'` that sent a plain GET and
   asserted 200 — a duplicate of another test under a different name, passing
   whether or not the rejection logic existed.
   **Countermeasure that works: demand falsification.** Require it to remove the
   code under test, observe the test fail, restore it, and report the failure
   message. It did this correctly in 2a when asked, and the reported message
   matched the real assertion string.
   Note in 2b it **substituted** a second test for the destructive experiment
   rather than performing it — adequate evidence in that instance, but not what
   was asked. Check whether the report describes an *experiment* or just another
   test.

2. **Invents plausible details.** The 2b report stated prod's database would be
   at `/opt/atrium/atrium.db`. Prod is `/srv/atrium`. Nothing prompted
   `/opt/atrium`; it was fabricated. Verify any concrete path, version, or
   figure in a report against the actual system.

3. **Documents behavior it didn't implement.** `db.js` carried a comment saying
   the runner "sorts by version on apply"; the loop had no sort. Harmless with
   one migration, wrong with two.

4. **Reports pushes it hasn't made.** Now less of an issue with credentials
   fixed, but it under-reported correctly twice this session (said "couldn't
   push" and hadn't). Still verify against the remote:
   `git ls-remote --heads origin <branch>`.

**Also — do not assume its errors are its fault.** The apparent "reverted 2a"
in the 2b branch was entirely an unpushed-merge problem on the human side.
Hermes had branched from `origin/main` correctly. Check the remote's actual
state before attributing a regression to the agent.

## Brief-writing patterns that worked

Worth reusing for 2c and 2d. The template is
`devtasks/TEMPLATE-task-brief.md`.

- **State what is *not* being redone.** Revision briefs that open with a list of
  complaints invite the agent to "improve" already-correct code. The 2a revision
  brief opened by naming the four things that were good and off-limits.
- **Long, explicit out-of-scope sections.** The agent fixes beyond the literal
  ask — a virtue elsewhere, a liability when the adjacent work is auth.
- **Demand falsification for anything security-relevant** (see above).
- **Resolve design-doc conflicts in the brief rather than passing them through.**
  Two were resolved for 2b: `lib/` vs `src/` (the doc says
  `packages/server/lib/db.js`; no `lib/` exists — use `src/`), and the
  `preferences` table (create it, write no code against it). Left ambiguous,
  these become silent guesses.
- **Split security-critical work from structural work**, so credential handling
  isn't debugged simultaneously with transport or schema setup. This is why 2b
  landed alone with no auth in it.

## Next: step 2c (auth)

Scope, per `docs/DESIGN-user-accounts.md`:

- `POST /api/register`, `/api/login`, `/api/logout`, `GET /api/me` — added to
  `http-routes.js` via `createRequestHandler()`, which already takes an options
  param for dependency injection
- Argon2id password hashing
- HttpOnly session cookies
- `authSessionId → userId` resolution **in the upgrade handler seam** in
  `session.js`
- **Keep the protections in this task, not deferred:** login rate limiting,
  `Origin` validation at upgrade, CSRF. Splitting them out means deliberately
  shipping an unprotected login endpoint, even if only for one review cycle.

If the brief looks bloated, the natural seam is credentials
(register/login/logout/me) versus session consumption (cookie → userId at
upgrade).

### Known decisions to make in 2c

- **`password_hash` is currently nullable**, and SQLite cannot `ALTER COLUMN`.
  Making it `NOT NULL` requires a table rebuild migration. Decide deliberately
  rather than discovering it mid-task.
- **`worlds.visibility` has no CHECK constraint** — any string is currently
  accepted. Design implies `private`/`public`. Probably 2d's problem, but note
  it.
- **This is the first task with real authority boundaries.** "Can user A act as
  user B" is exactly what the template's disagreement-case testing exists for.
  Expect to spend more review effort here than on 2a or 2b combined.

## Merge checklist (learned the hard way)

1. `git status` in the checkout you're standing in — confirm branch and clean
   tree
2. `node --test packages/server/test/*.test.js` — **all** files, batched, on the
   **host** (Node 22)
3. Merge, then **verify the push landed on the remote** by fetching a file, not
   by trusting output
4. Deploy to dev, `pnpm install`, restart, check `journalctl` (allow a second —
   log lines lag the restart), confirm `/api/health`
5. Live two-client smoke test in **incognito** windows at
   `https://dev.5-78-232-73.sslip.io/apps/client/` — required whenever the live
   connect path changes; skippable when nothing user-visible changed (as in 2b)
6. Return dev to `main` afterward so it isn't stranded on a merged branch

## Minor open items

- A second computer cannot load `dev.5-78-232-73.sslip.io` while prod loads
  fine; DNS resolves correctly, so **suspect TLS**, not the dashed hostname.
  Undiagnosed. Will matter when testing login from that machine.
- `http-integration.test.js` lost its trailing newline. Cosmetic.
- The new `createSessionServer` throw (missing `httpServer`) has no test.
  Trivial; the throw is unmissable in practice.
- Caddy warns the Caddyfile isn't formatted (`caddy fmt --overwrite`). Cosmetic.
- The upgrade-test timing uses a fixed 300ms sleep; may go flaky under load.
  That's the cause if it ever does, not a real regression.
