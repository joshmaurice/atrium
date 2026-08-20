# Production Deploy Checklist + Session Handoff Notes

Context for a fresh Claude/agent session with no memory of the prior work.
Everything here was established across a long working session; this file is the
durable summary so it doesn't have to be reconstructed.

---

## Where things stand (as of this handoff)

- **Repo:** `github.com/joshmaurice/atrium` — a standalone (not GitHub-fork)
  copy of Tony Parisi's `tparisi/atrium`. Public. This is the source of truth.
- **`main`** contains the complete, reviewed, live-verified **peer-routing
  feature** plus its bugfix. Built by the Hermes agent (DeepSeek V4 Flash via
  OpenRouter), reviewed commit-by-commit, regression caught in dev, fixed,
  smoke-tested live with two clients. Done.
- **Upstream (Tony):** your `main` is a clean *linear* continuation of Tony's
  history. Tony's last commit is `287c9c0` (2026-06-22). Your work begins at
  `6d48486` (2026-08-18), built directly on `287c9c0`. **No upstream
  reconciliation is needed or pending** — your repo contains all of Tony's
  work plus yours. (Re-confirm Tony hasn't pushed since 2026-06-22 if it
  matters, but it doesn't block anything.)
- **Two Atrium checkouts on the VPS:**
  - `/srv/atrium` — **PRODUCTION**, public web, served by Caddy at
    `https://5.78.232.73.sslip.io/apps/client/`. Runs as systemd service
    `atrium.service` on **port 3000**. Currently on the STALE commit
    `5f0c52a` (2026-06-18, mid-way through Tony's unfinished camera work) and
    its git remote still points at **Tony's** repo, not yours.
  - `/srv/atrium-dev` — **DEV**, served by Caddy at
    `https://dev.5-78-232-73.sslip.io/apps/client/`. Runs as systemd service
    `atrium-dev.service` on **port 3100**. Remote points at your repo. Used to
    test branches before they reach production.
- **The Hermes agent's own working copy** is at `/workspace/atrium` (inside its
  sandbox) = `/root/.hermes/sandboxes/docker/default/workspace/atrium` (host
  path, same files via bind mount). Its git remote points at your repo and it
  has push credentials stored. Josh has direct terminal access to it.

## Key operational facts / gotchas

- **Client is static files served by Caddy; browsers cache the JS hard.** After
  deploying new client code, you MUST hard-reload (Ctrl-Shift-R) or use a
  private/incognito window, or you'll see stale behavior and misjudge whether a
  change worked. This caused real confusion once already.
- **Server tests:** run per-package / per-file, NOT the top-level runner.
  `session.test.js` has a known teardown hang if run batched — documented in
  AGENTS.md. Kill orphaned `node --test` processes if ports get stuck.
- **Server port** is set via `PORT` env var (wins over everything). Prod omits
  it (defaults 3000); dev sets `PORT=3100`.
- **Caddy:** always `caddy validate --config /etc/caddy/Caddyfile` BEFORE
  `systemctl reload caddy`. A backup is at `/etc/caddy/Caddyfile.backup`.

## Toolchain calibration (DeepSeek V4 Flash via Hermes)

Well-characterized after one full feature:
- **Strong:** structural/architectural work, schema design, bounded fix-lists,
  often fixes beyond the literal ask.
- **Weak:** writes tests that verify "code changed" rather than "behaves
  correctly when values *disagree*" — defaults to happy-path where the
  distinguishing values happen to be equal. Also does not self-initiate
  end-to-end / "does this actually work live" checks.
- **Consequence / process:** unit-test-green is NOT sufficient evidence.
  Live/integration verification carries the real weight. The task template
  (`devtasks/TEMPLATE-task-brief.md`) now bakes in an adversarial-testing
  clause and a live-verification clause to compensate. Keep using it.
- **Also:** the agent has twice reported work as "pushed"/"done" when it had
  only made local edits (uncommitted) or not pushed. **Always verify against
  the actual git remote state, not the agent's summary.**

---

## THE PRODUCTION DEPLOY (likely next task)

Goal: move production (`/srv/atrium`) from the stale `5f0c52a` up to current
`main`. This is a deliberate first-ever deploy on a live public box, best done
as a low-stakes rehearsal (the peer-routing change is invisible to users) so
the process is proven before the higher-stakes auth deploy later.

This is ONE linear fast-forward — no merge, no conflicts — because `main` is a
straight-line descendant of what production is running.

### Steps (run in Josh's SSH session on the VPS)

1. **Record the current production commit for rollback safety:**
   ```
   cd /srv/atrium
   git rev-parse HEAD          # expect 5f0c52a... — WRITE THIS DOWN
   git status                  # confirm clean working tree; if not, investigate before proceeding
   ```

2. **Repoint production's git remote from Tony's repo to yours:**
   ```
   git remote -v               # will show tparisi/atrium
   git remote set-url origin https://github.com/joshmaurice/atrium.git
   git remote -v               # confirm now joshmaurice/atrium
   ```

3. **Fetch and fast-forward to main:**
   ```
   git fetch origin
   git log --oneline origin/main -1      # sanity: see your latest commit
   git checkout main 2>/dev/null || git checkout -b main origin/main
   git merge --ff-only origin/main       # fast-forward; refuses if not clean FF (good safety)
   ```
   If `--ff-only` refuses, STOP and diagnose — do not force. It should succeed
   given the linear history.

4. **Install deps (in case lockfile changed) and restart the service:**
   ```
   pnpm install
   sudo systemctl restart atrium.service
   sudo systemctl status atrium.service --no-pager | head -5   # expect active (running)
   ```

5. **Live smoke-test on PRODUCTION** (the real gate — same as was done on dev):
   - Open `https://5.78.232.73.sslip.io/apps/client/` in a **private/incognito
     window** (cache!), connect to the prod server
     (`wss://5.78.232.73.sslip.io/apps/client/`).
   - Second incognito window, same.
   - Confirm: you can move your own avatar, AND each window sees the other move.
   - Also confirm nothing else obviously broke (world loads, no console
     errors beyond the known-benign `file:///` security warning).

6. **If anything is wrong — rollback:**
   ```
   cd /srv/atrium
   git checkout <the-commit-you-wrote-down-in-step-1>
   sudo systemctl restart atrium.service
   ```
   Production returns to its prior known-good state. Then diagnose in dev, not
   on production.

### Notes
- Camera behavior in this codebase is Tony's unfinished work ("not behaving as
  expected" per his own commit messages). If camera/navigation is flaky after
  deploy, that is INHERITED, not caused by the peer-routing work. Don't chase
  it as a deploy regression.
- After a successful deploy, prod and dev are on the same commit — good
  baseline for starting the next feature.

---

## After deploy: the next feature is USER ACCOUNTS

Design is done and agreed: see `docs/DESIGN-user-accounts.md` and
`docs/ADDENDUM-user-accounts-final.md`. Summary of the shape:
- Anonymous browsing stays default; accounts unlock save/own/configure.
- Username + password, **opaque server-side session cookie** (HttpOnly, Secure,
  SameSite=Lax) — NOT JWT/localStorage. Auth resolved at WebSocket upgrade.
- World CRUD over **HTTP** (`/api/worlds/*`), not SOP. SOP stays live-session.
- Server-authoritative saves (server serializes its own SOM; never trust a
  client-uploaded world as a normal save).
- DB is the authority on permissions; `extras.atrium.owner` is provenance only.
- Phasing: 1 = identity + auth + persistence; 2 = home world + auto-save;
  3 = remembered-guest, user-object ownership.
- This is where the dev environment's **separate database + cookie isolation**
  finally matters — and the Caddy config will need an `/api/*` reverse-proxy
  rule added (prod currently only proxies WebSockets to Node; static files are
  served by Caddy directly).

To start it: copy `devtasks/TEMPLATE-task-brief.md` to a new task file, fill in
the first auth sub-task, keep the standard clauses, hand to Hermes on a branch.

---

## What to hand a fresh session

The simplest bootstrap is to point the session at the repo and have it read
this file first — everything else is referenced from here.

- `AGENTS.md` (repo root)
- `docs/DESIGN-user-accounts.md`
- `docs/ADDENDUM-user-accounts-final.md`
- `devtasks/TEMPLATE-task-brief.md`
- `devtasks/BUG-avatar-movement-regression.md` (for the lessons)
- **this file** (`devtasks/DEPLOY-and-handoff-notes.md`)

Since these all live in the public repo (`github.com/joshmaurice/atrium`), a
session with repo access can read them in place — no need to upload. Opening
move for a fresh session: "My Atrium project is at
github.com/joshmaurice/atrium. Read devtasks/DEPLOY-and-handoff-notes.md first."

**Verify live state, don't trust this snapshot.** The repo holds durable truth
(designs, code, decisions); the running VPS holds live state (which commit prod
is on, whether services are running, current Caddyfile) that can drift after
this was written. A fresh session should confirm live state with
`git rev-parse HEAD`, `systemctl status`, etc. rather than assuming the notes
are still current.
