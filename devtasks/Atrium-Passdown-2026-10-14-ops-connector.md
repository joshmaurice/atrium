# Atrium Passdown — 2026-10-14/15 — ops connector Pass A live; DEV now runs without root

**Predecessor:** `devtasks/Atrium-Passdown-2026-10-13-edit-mode-ui-1.md`. Its
§6–§7 product follow-ups still hold: the server cleanup round, then 1b-2,
then undo. This round was host and infrastructure work only. No Atrium code
changed.

**First instruction for the next session's Claude:**
1. Clone the repo and read `devtasks/`.
2. If the `atrium-ops` connector's tools are listed (`release_status`,
   `kanban_show`…), use them instead of asking the operator to paste host
   output.

## 1. Status at handoff

| Item | State |
|---|---|
| Atrium release | **COMPLETE.** DEV and PROD at `6447082b`; `origin/main` at `0124724` (passdown uploads) |
| Ops connector | **Pass A v0.2.1 installed and accepted** on the host. Repo `joshmaurice/atrium-ops` (private), branch `claude/pass-a`, commit `1f7407e`. Added in claude.ai as custom connector `atrium-ops`, URL `https://ops.ewwb.dev/mcp`, header `authorization: Bearer <token>` |
| Pass B (writes) | Not built. Gated on O10, which is the DEV least-privilege work below |
| DEV least-privilege | **Migrated and accepted 2026-10-15.** Installs and tests run as `atrium-build` in systemd sandboxes; the DEV server runs as `atrium-dev`. Code: `atrium-ops` branch `claude/least-privilege` at `6fda334`, after four code reviews (final: approved for supervised rollout). On the VPS: probe 121/121; migration steps 0–9; acceptance all green; `--accept` done. **`--finish` waits for the next real pipeline DEV deploy.** P1–P11 approved |
| Interim host fixes | **Applied:** `atrium-deploy` refuses symlinks and submodules; Caddy hides `node_modules`/`.git`/`.env*`/`.npmrc`; Caddy's admin API is on a root/caddy-only Unix socket (§4) |

## 2. The ops connector (Pass A)

**What it is:** a small remote MCP server on the VPS, so Claude reads host
state itself.
- Path: `claude-ops` service on `127.0.0.1:7801`, behind Caddy at
  `ops.ewwb.dev`, which only lets Anthropic's range (`160.79.104.0/21`)
  through, and only to `/mcp`.
- It holds a bearer token.
- Each tool is one root-owned wrapper, run through an exact sudo rule.

**Tools (16, all read-only):**
- `release_status`, `deploy_status`, `health`, `system`, `logs`
  (atrium, atrium-dev, caddy);
- `kanban_show` (`full_summary` gives the whole verdict), `kanban_list`;
- `agent_run_stats`: counts only. Its `run` region spans a card's whole run.
- `git_*` (7), on the connector's own anonymous mirror;
- `read_file`, for exactly these:
  - `worker-card-requirements`, `kanban-guard`;
  - `atrium-deploy`, `-deploy-gate`, `-main-approve`, `-main-push`,
    `-prod-approve`, `-release-status`;
  - `devtasks/*.md`.

**Boundaries:**
- No shell, no writes, no release path.
- Git runs as `claude-ops-git`, hardened, with no credential.
- Files are opened with `O_NOFOLLOW` component by component.
- The audit log is one append-only file per identity in `/var/log/claude-ops/`.
- The service journal logs each call and refusal, never arguments.
- sudo's own journal line does include the JSON argument (validated values).

**Reviews:** four rounds of outside review on the code (`5fb30d5` →
`7321233` → `615e3a4` → `cb32afa`), then the lock fix `98862f0`. Then:
- sudo-rs compatibility (`c5347db`): the host's sudo is sudo-rs 0.2.13, and
  it rejects `requiretty`;
- v0.2.1 (`1f7407e`).

The final review conditionally approved a supervised install.

**Tests:**
- 55 wrapper, 16 service, 13 facts;
- container e2e: 41 checks, under both sudo-rs 0.2.13 and sudo 1.9.15;
- installer e2e: 133 checks.

These cover rollback at every step, signals, stale leftovers, two installers
at once, audit-log quiescing and systemd state. The wrapper suite was rerun
on the host, Python 3.14.4 and git 2.53: 50/50 at the time.

**Install or update recipe (operator):**
1. Download the zip Claude sends.
2. On your computer: `scp ~/Downloads/<zip> root@5.78.232.73:/root/`.
3. On the VPS:
   - verify `sha256sum` and `unzip -z` (the commit);
   - `rm -rf /root/atrium-ops && unzip -q <zip> -d /root && cd /root/atrium-ops`;
   - `bash install/install.sh`.

The installer stages, validates, stops, swaps, verifies, and rolls back on
failure. It never deletes leftovers of an interrupted run; it refuses
instead. Config is kept; new entries are merged in and printed.

**Kill switch:**
- `systemctl stop claude-ops`;
- or remove the `ops.ewwb.dev` Caddy block;
- or `install/uninstall.sh`.

## 3. Host facts established this round

| Fact | |
|---|---|
| Ubuntu **26.04**, kernel 7.0, **sudo-rs 0.2.13** (`sudo.ws` 1.9.17 also installed), git 2.53, Python 3.14.4, Node 22.22.3 (`/usr/local/bin/node`), pnpm 11.8.0 (global in `/usr/local/lib/node_modules`) | |
| `atrium`, `atrium-dev`: **`User=root`, no sandboxing**. DEV about 150 MB | facts script |
| `atrium-deploy` runs `pnpm install` (native builds: `better-sqlite3`, `argon2`) and every test **as root**. `atrium-deploy-gate dev` needs **no human approval**: any `origin/*` SHA | `read_file` |
| MAIN/PROD human gates: root-owned `/run/atrium-{main,prod}-approval` (SHA plus a 15-minute expiry, single use), written only by `atrium-main-approve`/`atrium-prod-approve`. **They don't read the board** | `read_file` |
| Push token: root's `credential.helper store` → `/root/.git-credentials` | `git config` |
| **Kanban guard** (plugin v1.1.4, identical in all five profiles): a human gate counts as approved when any comment starting `HUMAN APPROVAL:` is newer than the gate. Text only, no author check; errors fail open. It runs only in agents' own tool calls, not the `hermes` CLI | `read_file kanban-guard` |
| `hermes kanban comment --author` is free text | facts |
| DEV's pnpm package files are hard-linked with root's store and PROD (3 links) | `stat` |
| Caddy serves `/srv/atrium-dev` and `/srv/atrium` with `file_server` (it follows symlinks). **The admin API is open on `127.0.0.1:2019`.** `hermes.ewwb.dev` proxies `127.0.0.1:9119` with no Caddy auth (302 to a login) | Caddyfile, `curl` |
| `fs.protected_hardlinks/symlinks=1`, `protected_regular=2`, `legacy_tiocsti=0`; root git has no filters, hooks or lfs | `sysctl`, `git config` |
| Root SSH logins accept a password | `scp` prompt |

## 4. Host changes made this round
1. **Memory (earlier):** a 2 GB swap file, swappiness 10, `OOMScoreAdjust=-500`
   for `atrium.service` (drop-in `oom.conf`).
2. **DNS:** an A record for `ops.ewwb.dev` → `5.78.232.73` (Namecheap).
   **Caddy:** an `ops.ewwb.dev` block appended. Backup:
   `/etc/caddy/Caddyfile.bak-claude-ops`.
3. **claude-ops installed:**
   - users `claude-ops` and `claude-ops-git`;
   - `/etc/sudoers.d/claude-ops`;
   - `claude-ops.service`;
   - `/usr/local/lib/claude-ops`, `/opt/claude-ops`, `/etc/claude-ops`,
     `/var/lib/claude-ops`, `/var/log/claude-ops`.
4. **`atrium-deploy`:** refuses a target tree with a symlink or a submodule,
   which the repo has never had. Backup: `atrium-deploy.bak-symlink-guard-*`.
   `atrium-deploy-prod` is **not yet** guarded (unread).
5. **Caddyfile:** every `file_server` (8) has
   `hide node_modules .git .env* .npmrc`. Verified: a `node_modules` file
   returns 404 on DEV and PROD; the client pages return 200. Backup:
   `/etc/caddy/Caddyfile.bak-hide-*`.
6. **Caddy admin API → Unix socket (D0):** drop-in
   `/etc/systemd/system/caddy.service.d/admin-socket.conf`
   (`RuntimeDirectory=caddy`, mode 0700), and a global block at the top of
   the Caddyfile: `admin unix//run/caddy/admin.sock|0600`. Backup:
   `Caddyfile.bak-admin-*`. Verified:
   - TCP 2019 is closed;
   - the socket answers root and refuses `claude-ops`;
   - sites serve, `systemctl reload caddy` works, and the connector is
     healthy.
7. **Node outside `/root` (2026-10-15):** a root-owned copy of Hermes's Node 22.22.3
   at `/usr/local/lib/nodejs/node-v22.22.3`. `/usr/local/bin/{node,npm,npx}`
   point there; Hermes keeps its own copy. Undo:
   `ln -sfn /root/.hermes/node/bin/node /usr/local/bin/node`.
8. **The DEV least-privilege migration (2026-10-15):**
   - users `atrium-build` and `atrium-dev`;
   - helpers in `/usr/local/lib/atrium-host`;
   - a new `/usr/local/sbin/atrium-deploy`;
   - the drop-in `/etc/systemd/system/atrium-dev.service.d/least-privilege.conf`;
   - recovery storage `/var/lib/atrium-ops-host`;
   - the DEV DB owned by `atrium-dev`.

   The old script is kept in the recovery storage; the new one keeps the
   symlink and submodule refusal. See §5.

## 5. DEV least-privilege (O10, option 1): the open work
**Why:** every human gate and the push token are only root's. DEV deploys run
any branch's install scripts, tests and server as root, without human
approval of the SHA.

**Pre-brief:** `PREBRIEF-deploy-least-privilege.md`, **FINAL Rev 3**, also in
`atrium-ops/docs/`.
- Four outside reviews: Rev 0, 1, 2, 3.
- The final verdict: approved for implementation, 0 must-fix.
- Its S14–S17 are §12 there.

**Design:**
- `atrium-build` runs install and tests in `systemd-run` sandboxes; the tests
  get no network.
- `atrium-dev` runs the server under a drop-in.
- The checkout and `.git` stay root's; the build owns only `node_modules`.
- DB backups run as `atrium-dev`, then root copies by descriptor.
- Root's git is hardened (D7).
- The migration is a recorded transaction. Preserved trees go to
  `/var/lib/atrium-ops-host/` (root 0700, outside Caddy).
- Any root restart passes `verify_root_mode()`.
- Rollback and `--reverse` only to PROD's SHA. They leave an emergency
  legacy mode, in which DEV deploys are refused.

**Built:** `atrium-ops/host/` on branch `claude/least-privilege`.
`host/README.md` has the layout, operator steps, and deviations from the
pre-brief. Tests:
- unit tests;
- a container suite with real systemd as PID 1 (Ubuntu 24.04 stand-in for
  the VPS), covering:
  - the full migration with `probe-sandbox`;
  - deploys, refusals, rollbacks;
  - accept, finish, reverse;
  - a fault and SIGKILL matrix at every step and restore step;
  - proof-of-failure tests.

**Code reviews:** four rounds after the pre-brief.
- `18a23e3` → M17, M18, S18–S22.
- `ce303ef` → M19, M20, S23, S24.
- `9d075ba` → M21, S25.
- `2428126` → S26 only. Approved for the supervised rollout.
- Container suite on the final code: 171/171; unit tests: 25.

**Rollout, 2026-10-15** (`host/ROLLOUT.md`):
- **First VPS probe:** every security check passed, but the sandboxed install
  failed. `/usr/local/bin/node` pointed to Hermes's Node in `/root/.hermes`,
  which the sandbox hides.
  - **Fixed:** a root-owned copy at `/usr/local/lib/nodejs/node-v22.22.3`.
    `node`, `npm` and `npx` in `/usr/local/bin` now point there, for PROD as
    well.
  - The dry run now refuses a Node under `/root`.
- **Then:**
  - probe 121/121;
  - dry run clean;
  - migration steps 0–9 (old trees in
    `/var/lib/atrium-ops-host/trees/20261015T232312Z/pre`; DB backup
    `atrium-20261015T232312Z-pre-migration.db`);
  - `dev-force`: every suite passed as `atrium-build`;
  - DEV runs as `atrium-dev`;
  - `probe-sandbox --as-built` 99/99;
  - Caddy admin refuses `atrium-build`, `atrium-dev` and `claude-ops`;
  - the browser check passed;
  - `--accept` done.
- **The run lives in `/root/atrium-lp/atrium-ops/host/sbin`** (`H=` in the
  commands below).

**Next:**
1. **`$H/migrate-least-privilege --finish`** after the next real DEV deploy
   from the pipeline (not `dev-force`). Until then `--reverse --sha <PROD's>`
   restores root DEV from the kept trees.
2. **If a DEV deploy is interrupted** (killed, OOM, reboot):
   `atrium-deploy recover`.
3. **S22 before Pass B:** `atrium-main-push`'s D7 git hardening.
4. Then:
   - connector Pass B;
   - PROD, the second step (§10 of the pre-brief; read
     `atrium-deploy-prod` first);
   - P10, a separate static tree for Caddy.
5. **Small follow-ups:**
   - merge `claude/least-privilege` (and `claude/pass-a`) into `atrium-ops`
     `main` when convenient;
   - add `ServerAliveInterval` to the laptop's SSH config;
   - run long host jobs detached (`setsid nohup … &`).

## 6. Other findings and follow-ups
- **Root SSH accepts a password.** Recommend key-only logins once the
  operator's key is confirmed.
- **`hermes.ewwb.dev` is public, behind Hermes's own login only** (P8).
- **The Hermes Docker sandbox runs as root;** a separate isolation item after
  DEV.
- **The board's human gates are text** (the guard). Real authority is the
  host approval files, which is why nothing unreviewed may run as root.
- **The connector on the host is installed from a zip.** `claude/pass-a` isn't
  merged to `atrium-ops` `main`. Fine for now; merge when convenient.
- **Carried from 2026-10-13:**
  - the server cleanup round, 1b-2, undo;
  - M/Escape;
  - unused `addons/` import maps;
  - the §7.7 grep;
  - the `sslip.io` health checks;
  - **the GitHub PAT expires 2026-10-29.**
