# Pre-brief: DEV deploys without root (ops connector decision O10, option 1)

Status: **FINAL, Revision 3 (2026-10-14).** Approved for implementation by the outside review (0 must-fix); its four implementation should-fixes and test list are §12.

**Implemented and rolled out (DEV, 2026-10-15).**
- The code is `host/` at `6fda334`, after four code reviews; the last approved the supervised rollout.
- The migration and acceptance passed on the VPS, and the operator ran `--accept`.
- `--finish` waits for the next real pipeline DEV deploy.
- PROD (§10) and S22 remain. The run is recorded in `host/ROLLOUT.md`, "Result".
- **Rev 0** was written from host facts gathered through the ops connector
  and the operator's commands.
- **Rev 1** applied the first outside review (M1–M4, S1–S5) and new host
  facts: §1.3 and the Caddy admin API.
- **Rev 2** applied the second review (M5–M13, S6–S9).
- **Rev 3** applies the third review (M14–M16, S10–S13, N1–N3; §11). That
  review judged it ready to implement once those were fixed, with an
  independent code review before anything is applied.

Implemented in `host/` (branch `claude/least-privilege`); see host/README.md. **Decisions P1–P11 (§9) approved by the operator 2026-10-15.** Applied on
the host 2026-10-14:
- the symlink and submodule refusal;
- Caddy `hide`;
- Caddy's admin API on a Unix socket (D0).

**Scope:** the DEV deploy path, plus the parts of Caddy that serve DEV.
PROD follows in a second step (§10). Host infrastructure only: no Atrium
code changes.

## 1. Why

### 1.1 Every human gate is a root-owned file
- **MAIN:** `atrium-main-push` refuses unless `atrium-main-approve` wrote
  `/run/atrium-main-approval`: root 0600, the SHA plus a 15-minute expiry,
  consumed by one push.
- **PROD:** `atrium-deploy-gate prod` checks `/run/atrium-prod-approval` the
  same way.
- **The push token:** `/root/.git-credentials`, root 0600, via root's
  `credential.helper store`.

Board text and agent tools can't satisfy these. Any root process can.

### 1.2 DEV deploys run unreviewed code as root
- `atrium-deploy-gate dev <sha>` needs no human approval. Any commit
  reachable from any `origin/*` branch qualifies.
  - That includes the agents' `workflow/*` branches, which
    `atrium-publish-workflow` publishes with the host token, and `claude/*`
    branches.
  - The pipeline deploys to DEV before the operator accepts anything.
- `atrium-deploy` runs, as root:
  - `pnpm install`, including native builds for `better-sqlite3` and
    `argon2`;
  - every test suite.

  The DEV server runs as root, with no sandboxing.

### 1.3 Caddy serves the DEV checkout, following symlinks
**This is true today, root or not.**
- The DEV site serves `/srv/atrium-dev` with `file_server` for
  `/apps/client/*`, `/packages/*` and `/tools/*`.
- A branch that commits a symlink, such as
  `apps/client/x -> /var/lib/caddy/.local/share/caddy/...` (Caddy's TLS
  private keys, readable by `caddy`), would have that file served
  publicly.
- `atrium-deploy`'s `git ls-files | xargs chmod a+r` would also follow such
  a link as root (review M1).
- Once `node_modules` belongs to an unprivileged user (D2), a symlink planted
  there would be served the same way.

Interim fix: applied 2026-10-14 (§8). The full fix is D2.

### 1.4 What this round establishes
Narrowed per review S5. The rest of the host is §3 and §10.

**After this round:**
- the DEV deploy's install and test commands run as an isolated,
  unprivileged identity;
- the DEV server runs as another;
- neither can read `/root`, write `/run` or `.git`, touch PROD's files or
  database, or reconfigure Caddy (D0);
- root's remaining steps in a DEV deploy never follow anything that an
  untrusted commit or either identity controls.

## 2. Host facts (established 2026-10-14)

| Fact | Source |
|---|---|
| `atrium-dev.service`: `User=root`; `WorkingDirectory=/srv/atrium-dev/packages/server`; `ExecStart=/usr/local/bin/node src/index.js`; `PORT=3100`; `WORLD_PATH` inside the checkout; `ATRIUM_DB_PATH=/var/lib/atrium-dev/atrium.db`; no sandboxing. Uses about 150 MB | `systemctl cat`, `show` |
| `/srv/atrium-dev`, `.git`, `node_modules` root 755; `/var/lib/atrium-dev` root 700, DB root 600 | `stat` |
| Root's git config: only `user.name`/`user.email`; the repo config is stock (remote, branches); no filters, hooks, `hooksPath`, `fsmonitor`, includes; **no git-lfs** | `git config --show-origin -l` |
| Push token: `credential.helper store` → `/root/.git-credentials` (root 600) | same |
| pnpm 11.8.0, a global install under `/usr/local/lib/node_modules`; store `/root/.local/share/pnpm/store/v11`; default import method (no `.npmrc` setting) | `pnpm`, `.npmrc` grep |
| **DEV's package files are hard-linked, with 3 links each** (store, DEV, and presumably PROD) | `find -links +1`, `stat` |
| Kernel: `fs.protected_hardlinks=1`, `fs.protected_symlinks=1`, `fs.protected_regular=2`, `dev.tty.legacy_tiocsti=0` | `sysctl` |
| Localhost TCP listeners: Caddy admin **`127.0.0.1:2019`, open (200 on `/config/`)**; Hermes `127.0.0.1:9119` (302, a login redirect presumably); claude-ops `127.0.0.1:7801` (token); DEV `*:3100`, PROD `*:3000`; resolver 53; chrony 323 | `ss -lntup`, `curl` |
| Unix sockets outside `/root`: `docker.sock`, `containerd.sock`, the D-Bus system bus, `snapd.socket`, `lxd-installer.socket`, `/run/ssh-unix-local/socket`, systemd's varlink sockets, and others | `ss -lxp` |
| The DEV Caddy site serves `/srv/atrium-dev` (`/apps/client/*`, `/tools/*/*`, `/packages/*`) with plain `file_server`; `hermes.ewwb.dev` proxies to 9119 with no Caddy-side auth | Caddyfile |
| The server writes only its SQLite DB; the tests write only to the temp dir; no workspace `install`/`prepare` scripts | repo |
| **The repo has never tracked a symlink or a submodule** (current tree and the last 400 commits) | `git ls-tree` |

## 3. Non-goals (this round)
- **PROD:** §10.
- **The Hermes sandbox container,** which runs as root in Docker. A separate
  risk; next.
- **Moving root's git into its own identity** (review S1, S8). The interim
  instead is a hardened root git with a controlled environment (D7), which
  the facts support: no filters, hooks or lfs.
- **Which SHAs may deploy to DEV.**

## 4. Design

### D0. Prerequisites: Caddy's admin API closed (review M5); Hermes checked (S13)
- This comes before anything else, and before any code runs under the new
  identities, because the install profile and the DEV server keep host
  networking. It's also urgent on its own, since today any local user can
  rewrite Caddy's config. The steps are D9.
- **Test:** `atrium-build`, `atrium-dev` and `claude-ops` each fail to read or
  change Caddy's config, both over TCP 2019 and via the socket.
- **Status: done 2026-10-14.**
  - TCP 2019 is closed.
  - `/run/caddy/admin.sock` (0600, in a 0700 `caddy` directory) answers root
    and refuses `claude-ops`.
  - Sites serve, and `systemctl reload caddy` works.
  - Backup: `Caddyfile.bak-admin-*`; drop-in `caddy.service.d/admin-socket.conf`.
- **Hermes (`127.0.0.1:9119`, public as `hermes.ewwb.dev`)** is checked before
  any install runs under the new profile, because the install profile has
  host networking (review S13):
  - every API route Hermes serves (listed from its docs or source, not
    guessed) must refuse an unauthenticated request with 401, 403 or a login
    redirect, both from localhost and through `hermes.ewwb.dev`;
  - a route that answers without authentication blocks the migration until
    it's closed.
  - **Checked 2026-10-15, passed:**
    - the dashboard is bound to `127.0.0.1:9119` with login on deliberately
      (`auth_required: true`, provider `basic`);
    - 26 documented `/api/` routes were tried without credentials, from
      localhost and through `hermes.ewwb.dev`; all refused with 401, and
      the `/api/pty` WebSocket with 403 or 401;
    - three answer 200 without login, all read-only:
      - `/api/status`, documented as public;
      - `/api/config/defaults`: the built-in default settings, not live
        config, with no key, token or password fields;
      - `/api/model/info`: model name, provider and capabilities.

      All three are accepted.

### D1. Two unprivileged users
| User | Runs | May write |
|---|---|---|
| `atrium-build` | `pnpm install` and every test command | the checkout's `node_modules` directories, `/var/lib/atrium-build` (pnpm store, caches, home) |
| `atrium-dev` | `atrium-dev.service` and DEV's DB backup (D6) | `/var/lib/atrium-dev` |

Both are system users with the `nologin` shell, no supplementary groups and
no sudo.

### D2. What a root checkout accepts; the checkout's ownership
**Tree checks** (`host/lib/tree-check`). Root runs them on **every** SHA it's
about to check out in `/srv/atrium-dev`: the deploy target, and the
rollback target before a rollback checkout. If a rollback target fails, the
rollback stops and leaves DEV stopped.
- They read `git ls-tree -r -z --full-tree <sha>`, NUL-separated and parsed
  by mode.
- **They refuse:**
  - any entry of mode `120000` (a symlink) or `160000` (a submodule);
  - any path with a `node_modules` component at any depth (review M9:
    `git add -f` can track files there);
  - any path with a `.git` component.

  The repo has never had any of these (§2).

**Ownership:**
- `/srv/atrium-dev`, every directory and tracked file, and all of `.git`:
  root-owned, unwritable by either user.
- The `node_modules` directories, at the repo root and in each workspace
  package (`packages/*`, `apps/*`, `tools/*`, from `pnpm-workspace.yaml`
  parsed by root), belong to `atrium-build`.
  - Root creates them with `mkdirat` and chowns them with `fchown`, each
    relative to an `O_DIRECTORY|O_NOFOLLOW` descriptor of the package
    directory. It refuses one that already exists as anything but a
    directory owned by `atrium-build`.
  - Root never enters one.
  - Since no tracked path is inside one (above), `git checkout` never writes
    inside one either.

**The blanket `chmod` is removed** (review M8).
- The checkout already runs with umask 022, so files git writes are 0644 or
  0755.
- Readability is normalized only for **tracked regular files**: entries of
  mode `100644`/`100755` from `git ls-files -z -s`, after the tree checks
  above.
  - That means no symlinks, nothing under `node_modules` or `.git`, and every
    parent directory root-owned, so no other user can swap a path between
    listing and `chmod`.
  - Untracked files and `.git` are never touched.
- **Test:** an untracked 0600 file and `.git/config` 0600 stay 0600.

### D3. `atrium-build-run`: install and tests in transient units
**Its contract** (review M7, S4):
- It's root-owned and takes only `<install|test-N>`, where `test-N` indexes
  a fixed list of test commands in the helper itself. There are no
  caller-supplied commands, paths or environment.
- The working directory and writable paths are always the live checkout's
  (`/srv/atrium-dev` and its `node_modules` directories). There's no
  staging mode: D10 builds in place while DEV is stopped.

**The run:**
```
set -o pipefail
systemd-run --quiet --wait --pipe --collect --service-type=exec \
  --unit="atrium-build-$STAMP-$N" --property=… (below) \
  -- <fixed command>  </dev/null 2>&1 | cat
status=${PIPESTATUS[0]}      # systemd-run's status, never cat's (review M10)
exit "$status"
```
- **Environment:** only `HOME=/var/lib/atrium-build`,
  `PATH=/usr/local/bin:/usr/bin:/bin`, `LANG=C.UTF-8`, and
  `pnpm_config_verify_deps_before_run=false`. The caller's environment never
  passes (`systemd-run` doesn't forward it; the helper also starts with
  `env -i`).
- **pnpm settings are command-line flags,** not environment (review M11: pnpm
  11 stopped reading `npm_config_*`). The install is:
  `pnpm install --frozen-lockfile --store-dir /var/lib/atrium-build/pnpm-store --package-import-method copy`.
  - The effective values are checked inside the sandbox with
    `pnpm config get` on the first run.
  - The result is checked by inode: a sample of DEV's package files must
    have link count 1 and a different (device, inode) from PROD's and from
    root's store.

**Build profile properties:**
- `User=atrium-build`, `Group=atrium-build`, `WorkingDirectory=/srv/atrium-dev`.
- `ProtectSystem=strict`, `ProtectHome=yes`, `PrivateTmp=yes`, `PrivateDevices=yes`.
- `ProtectKernelTunables=yes`, `ProtectKernelModules=yes`, `ProtectKernelLogs=yes`, `ProtectControlGroups=yes`.
- `ProtectProc=invisible`, `ProcSubset=pid`, `ProtectHostname=yes`, `ProtectClock=yes`.
- `LockPersonality=yes`, `RestrictRealtime=yes`, `RestrictSUIDSGID=yes`, `NoNewPrivileges=yes`, `CapabilityBoundingSet=`, `RestrictNamespaces=yes`.
- `ReadWritePaths=/var/lib/atrium-build <each node_modules dir>`.
- **Build profile `InaccessiblePaths`:**
  - data: `/var/lib/atrium-dev`, `/var/lib/atrium`, `/srv/atrium`;
  - Caddy: `/var/lib/caddy`, `/etc/caddy`, `/run/caddy`;
  - the connector: `/etc/claude-ops`, `/var/log/claude-ops`, `/var/lib/claude-ops`;
  - `/var/backups`;
  - sockets: `/run/docker.sock`, `/run/containerd`, `/run/snapd.socket`,
    `/run/snapd-snap.socket`, `/run/lxd-installer.socket`,
    `/run/ssh-unix-local`.
- `MemoryMax=1536M`, `MemorySwapMax=0`, `TasksMax=512`, `RuntimeMaxSec=<per command>`.

**Network:**
- **`install`:** host network,
  `RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK`. It can reach
  localhost services: Caddy admin is closed by D0, claude-ops needs its
  token, Hermes needs its login (P8).
- **`test-N`:** `PrivateNetwork=yes`, its own loopback;
  `RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX`. The tests start their
  own listeners and never use DEV's port (§2; checked in §5).

**Failures:**
- The deploy's `set -Eeuo pipefail` and the helper's own exit status both
  propagate a non-zero result: an ordinary failure, `RuntimeMaxSec`, OOM
  kill, or failure to create the unit.
- **Every unit is named exactly** (`atrium-build-<stamp>-<n>`). The helper
  appends each name to the deploy's state before launching it (review S10).
- Each unit has `KillMode=control-group`, so no descendant outlives it.
- The rollback trap stops each recorded name explicitly, then verifies each
  is `inactive` or `failed` with no remaining processes in its cgroup. A
  wildcard is used only as a final sweep.

### D4. The DEV server as `atrium-dev`: its own profile (review M6)
A drop-in, `/etc/systemd/system/atrium-dev.service.d/least-privilege.conf`:
- `User=atrium-dev`, `Group=atrium-dev`.
- The same hardening set as D3 (from `PrivateTmp` through
  `RestrictNamespaces`).
- `ReadWritePaths=/var/lib/atrium-dev`.
- **`InaccessiblePaths`** is the server profile's own: D3's list **minus**
  `/var/lib/atrium-dev`, **plus** `/var/lib/atrium-build`.
- `RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX`, `MemoryMax=384M`.

**Positive tests** (review S7), under this profile:
- the server opens its DB, writes, creates and checkpoints its `-wal` and
  `-shm`;
- it accepts Caddy's proxied HTTP and WebSocket connections;
- login, connect and edit work in the browser.

**Negative tests:** it can't reach `/var/lib/atrium`, `/srv/atrium`,
`/root`, `/run/caddy`, `/run/atrium-*-approval` or `.git`.

### D5. `atrium-deploy`: what changes
1. **Before checkout:** the D2 tree checks on the target.
2. **After checkout:** the tracked-regular-files readability step (D2)
   replaces `ls-files | chmod`.
3. **Before install:** ensure the `node_modules` directories (D2).
4. **Install and the test list** go through `atrium-build-run`. The
   `timeout` wrappers become `RuntimeMaxSec`.
5. **The DB backup and restore** follow D6.
6. **Rollback:**
   - the tree checks on `OLD_SHA` before checking it out;
   - stop `atrium-build-*` units;
   - on any rollback-step failure, leave DEV **stopped**, keep every backup,
     and print the recovery steps.
7. **Every root `git` call** uses D7.

Unchanged:
- the SHA checks, fetch, health checks and release-state calls;
- `atrium-deploy-gate`, `atrium-main-approve`, `atrium-prod-approve`.

`atrium-main-push` gets only D7's git invocation.

### D6. DEV's database: backups as `atrium-dev`, root works by descriptor (review M3, M12)
**Backup:**
1. `atrium-dev` runs `sqlite3 .backup` (the online backup API, consistent
   while DEV runs) in the D4 profile, into
   `/var/lib/atrium-dev/backup-<stamp>.db`.
2. Root opens `/var/lib/atrium-dev` as `O_DIRECTORY|O_NOFOLLOW`, then the file
   with `openat(…, O_RDONLY|O_NOFOLLOW|O_NONBLOCK)`.
3. It checks with `fstat`: a regular file, owner `atrium-dev`, link count 1,
   size ≤ the limit.
4. It copies from the descriptor into `/var/backups/atrium-dev` (root 700).
   It **counts bytes while copying** and aborts past the limit, since the
   source can change after the `fstat`.
5. It runs `PRAGMA integrity_check` on root's copy, then unlinks the staging
   file by `unlinkat` on the directory descriptor.

**Restore** (DEV stopped):
1. Move the live `atrium.db`, `-wal` and `-shm` into
   `/var/backups/atrium-dev/failed-<stamp>/`, with `renameat` relative to
   directory descriptors (no path following).
2. Create the DB with
   `openat(dirfd, "atrium.db", O_CREAT|O_EXCL|O_NOFOLLOW|O_WRONLY, 0600)`,
   copy the backup in, and `fchown` it to `atrium-dev`.

**Ownership changes** (migration and reverse) are by descriptor too:
1. Open the directory `O_DIRECTORY|O_NOFOLLOW`.
2. Open each of `atrium.db`, `-wal`, `-shm` (if present) with
   `O_NOFOLLOW|O_NONBLOCK`.
3. Require: a regular file, link count 1, the expected current owner.
4. `fchown` the descriptor.
5. Then `fchown` the directory descriptor itself.

**Order:**
- **Migration:** files first, then the directory. DEV is stopped and the
  directory is still root 700, so nothing else can change it.
- **Reverse:** the directory first, to root 700, closing it to `atrium-dev`;
  then the files. DEV is stopped.

The connector's `safeopen` pattern is reused, in a small root-owned Python
helper. Every descriptor it opens is `O_CLOEXEC` (review N2), and it starts
no subprocess while holding one.

### D7. Root's git: configuration and environment (review S1, S8)
Every root `git` in `atrium-deploy`, and `atrium-main-push`'s use of
`/srv/atrium-dev`, runs as:
```
env -i HOME=/root PATH=/usr/bin:/bin LANG=C.UTF-8 GIT_CONFIG_NOSYSTEM=1 \
  git -c core.hooksPath=/dev/null -c core.fsmonitor=false \
      -c protocol.allow=never -c protocol.https.allow=always …
```
- **`HOME=/root`** keeps root's global config, which is only `user.*` and
  `credential.helper store`, which the push needs.
- **`env -i`** drops caller-provided `GIT_*`, including `GIT_CONFIG_*`,
  `GIT_DIR` and `GIT_EXEC_PATH`.
- **Before rollout,** `git config --show-origin -l` under exactly that
  environment is recorded. It must show no `filter.*`, `core.hooksPath`
  other than the override, `core.fsmonitor`, `include*` or `alias.*`.

### D8. The scripts are versioned
These live in `atrium-ops/host/`:
- `atrium-deploy`, `atrium-build-run`, `tree-check` and the DB helper;
- the drop-ins and the Caddy changes;
- the migration.

The installer:
- takes `.bak-<stamp>` copies;
- validates (`bash -n`, `systemd-analyze verify`, `caddy validate`);
- swaps atomically, under a lock, with per-component state (the connector
  installer's design);
- keeps `--reverse` (D10).

### D9. Caddy
**The admin API moves to a Unix socket** (the D0 prerequisite). Facts:
Caddy v2.11.4, `User=caddy`, `ExecReload=caddy reload --config … --force`,
and the Caddyfile has no global options block. The steps:
1. A drop-in `caddy.service.d/admin-socket.conf`: `RuntimeDirectory=caddy`,
   `RuntimeDirectoryMode=0700`.
2. A new global options block at the top of the Caddyfile:
   `{ admin unix//run/caddy/admin.sock|0600 }`.
3. Validate, then **one** `systemctl restart caddy`.
   - `reload` sends the new config to the admin address named in that
     config, which the running process isn't listening on yet.
   - Later reloads work as before, because `ExecReload` runs as `caddy`,
     which owns the socket.
4. Checks:
   - TCP 2019 doesn't listen;
   - the socket answers root and refuses `claude-ops` (and, after
     migration, `atrium-build` and `atrium-dev`);
   - all sites serve;
   - `systemctl reload caddy` succeeds.

**`hide node_modules .git .env* .npmrc`** in every `file_server` is in place
since 2026-10-14 (§8). Per the review (S6) it's defense in depth, not the
boundary.

Until P10, the served checkout **does** contain build-written files: the
`node_modules` directories under served paths (review N1). What protects
them:
- `hide`, verified by HTTP tests;
- no tracked symlinks anywhere (the D2 tree checks);
- nothing else build-written: preserved and failed trees live outside every
  served root (D10).

P10 removes the build-owned tree from what Caddy reads at all.
- **Follow-up (P10):** serve DEV's static files from a separate root-built
  copy of just the served tracked paths (`git archive` of `apps/client`,
  `packages/*/src`, `tools/*`). Caddy then never reads the build-owned
  checkout at all.

### D10. Migration: one transaction, DEV stopped while it builds (review M4, M7, M12–M16, S9, S11)
DEV is a development server, so the operator accepts downtime. Its length
varies with the network, the native builds and the full test list: likely
minutes, not guaranteed (review N3). That removes the staging-build mode Rev 1
needed.

**The migration** is `host/migrate-least-privilege.sh`:
- `--dry-run` prints every step;
- it runs under the install lock.

**State and storage:**
- **Recovery storage, outside every served root** (review M14):
  `/var/lib/atrium-ops-host/`, root 0700. It must be on the same filesystem
  as `/srv/atrium-dev`, so moves are atomic `rename`s. Step 1 checks this
  (equal `st_dev`) and refuses otherwise, rather than copying. It holds:
  - `trees/<stamp>/pre/<relpath>/node_modules`: the old root-owned trees;
  - `trees/<stamp>/failed/<relpath>/node_modules`: build trees from a failed
    attempt;
  - `backups/`: scripts and units;
  - `migrate.state`.
- **`migrate.state`** (review S11) records, after each step:
  - `trusted_sha` (below);
  - the service identity in force;
  - the DB owner;
  - where each `node_modules` tree is;
  - the backups made;
  - `last_completed_step`.

  Recovery reads it to tell an incomplete migration from a later reverse.

**The trusted SHA** (review M15): the migration starts only if DEV's checked-out
SHA equals PROD's recorded SHA. At the last check both were `6447082b`. That
SHA was operator-approved for PROD, and the old root-owned trees were built
for it. It's recorded as `trusted_sha`. If DEV has moved on by migration day,
the operator first deploys DEV back to PROD's SHA under the current scheme.

**Order** (review M16). Each step is recorded before and after.
0. **Install the helpers first:**
   - `atrium-build-run`, `tree-check`, the DB helper, the shared
     sandbox-properties file;
   - into `/usr/local/lib/atrium-host/`, root 0755/0644, under the installer
     lock;
   - and create the recovery storage, root 0700.

   They're inert until called. `atrium-deploy` and the unit are not touched
   yet.
1. **Check:**
   - D0 is done (Caddy admin closed, Hermes checked);
   - no deploy is running (the deploy lock);
   - DEV's SHA is `trusted_sha`, and passes the tree checks;
   - `probe-sandbox.sh` passes (§5);
   - an online DB backup (root, the last time) verifies;
   - the recovery storage and `/srv/atrium-dev` share a filesystem.
2. **Users and directories:** create `atrium-build`, `atrium-dev`,
   and `/var/lib/atrium-build`.
3. **Stop DEV.** Verify no process runs as `atrium-dev` or `atrium-build`.
4. **Move each root-owned `node_modules`** to `trees/<stamp>/pre/…`, by
   `renameat`. Never chown.
5. **Create the fresh `node_modules` directories,** build-owned, by the D2
   descriptor procedure, at every path the workspace defines. They must
   exist before step 6, since `ReadWritePaths` names them and `atrium-build`
   can't create them in root-owned package directories.
6. **Build in place:** `atrium-build-run install`, then the inode check (D3),
   then every `test-N`.
7. **DB ownership** to `atrium-dev`, by descriptor (D6).
8. **Activate:** install the new `atrium-deploy` (D5) and the DEV drop-in,
   each backed up, then `daemon-reload`.
9. **Start DEV; verify:**
   - health;
   - `User=atrium-dev`;
   - the D4 positive tests;
   - `probe-sandbox.sh --as-built` with the real users;
   - HTTP tests that `trees/` content is not reachable (it's outside every
     served root, by construction);
   - `hide` holds.

**A failure at steps 3–9 rolls back, never into unapproved root execution**
(review M15):
1. Stop DEV.
2. Restore `atrium-deploy`, the unit and the drop-in from `backups/`.
3. **Make the checkout `trusted_sha`.**
   - Run the tree checks, then `git checkout --detach trusted_sha` with D7's
     git.
   - That's a no-op when DEV never moved, but required if anything changed
     it.
4. **Quarantine every build-owned tree.** Move each `node_modules` whose
   directory `atrium-build` owns (checked by `lstat` on an opened parent) to
   `trees/<stamp>/failed/…`, as a whole directory by `renameat`. No root
   process reads inside it again.
5. Move the `pre/` trees back. They were built by root for `trusted_sha`.
6. DB ownership back to root, by descriptor (the reverse order, D6).
7. Start DEV, as root, on `trusted_sha` with its own trees.

If any step fails, DEV stays **stopped**, everything is kept, the state
records where it stopped, and recovery steps are printed.

**After success:**
- `migrate --accept` writes the acceptance marker, after §5's host
  acceptance.
- **`--finish`** refuses unless the marker exists and at least one DEV
  deploy has succeeded under the new scheme. Then it deletes `trees/*/pre`
  and the script backups.

**`--reverse`** (going back to a root DEV, on purpose):
- It **always requires an explicit `--sha <40-hex>`.** That SHA must equal
  PROD's recorded SHA at the time; otherwise it refuses.
- **Before `--finish`:** the same rollback as above, with that SHA.
  - If the SHA differs from `trusted_sha`, the `pre/` trees were built for a
    different commit, so they aren't reused.
  - Instead it builds fresh root-owned trees from that SHA, as below.
- **After `--finish`,** or when the SHA differs:
  1. Stop DEV.
  2. Quarantine every build-owned tree to `trees/<stamp>/failed/` (review
     M15: no build-controlled file becomes input to a root install).
  3. Tree checks, then check out the SHA.
  4. Create fresh root-owned `node_modules` directories.
  5. `pnpm install --frozen-lockfile` as root, from that SHA's lockfile, with
     a fresh root store directory under `/var/lib/atrium-ops-host/`. That's
     the same trust as PROD's own installs.
  6. Restore DB ownership. Reinstall the root-scheme `atrium-deploy` and
     unit, from `backups/` if they still exist, otherwise from
     `host/legacy/` in atrium-ops (D8), with no drop-in. Start DEV.
- If anything can't be done safely, DEV stays stopped.

**What's kept, and until when:**

| Artifact | Kept until |
|---|---|
| `trees/<stamp>/pre`, script and unit backups, the pre-migration DB backup | `--finish` |
| `trees/<stamp>/failed`, `failed-*` DB copies | the operator deletes them |

## 5. Verification

**Container** (no systemd as init):
- the shell and helper logic:
  - the tree checks (symlink, submodule, a tracked file under
    `node_modules`, a `.git` component);
  - the `node_modules` directory checks (pre-existing symlink, wrong owner);
  - the readability step (an untracked 0600 file and `.git/config` stay
    0600);
  - the DB helper (a symlinked DB, a hard-linked DB, growth past the limit
    during copy, rename-by-descriptor restore);
  - `atrium-build-run`'s status propagation (exit 0, exit 3, a killed child,
    unit creation failing, with `systemd-run` stubbed);
  - the migration's state machine, with failure injected at each step,
    including rollback-step failure (DEV left stopped).
- A full install with `--package-import-method copy` and the full test list
  as an unprivileged user with `setpriv`. This checks the native builds and
  the permission model, and that no test uses port 3100 or the host network.

**On the host, before migration: `host/probe-sandbox.sh`.** It's a separate,
root-only test tool, not the production helper (review S12).
- It reads the **same sandbox-properties file** the helper and the drop-in
  are generated from, so the property sets are identical.
- It applies them, through `systemd-run -p DynamicUser=yes`, around a
  root-created disposable fixture under `/var/lib/atrium-ops-host/probe/<stamp>`:
  a `git archive` of the current SHA, with its own `node_modules`
  directories.
- The production helper still accepts only the live checkout.
- **Negative:** each must fail:
  - read `/root/.git-credentials`;
  - create `/run/atrium-main-approval`;
  - write `/srv/atrium-dev/.git/hooks/x`;
  - write a tracked file;
  - read `/var/lib/atrium-dev` (build profile);
  - read `/var/lib/atrium` and `/srv/atrium`;
  - read `/var/lib/caddy`;
  - talk to Caddy admin, TCP and socket;
  - connect to `docker.sock`;
  - `sudo -n true`;
  - gain privileges from a setuid binary.
- **Limits:**
  - 2 GB of allocation is OOM-killed;
  - a `sleep` past `RuntimeMaxSec` is stopped, with no descendant left;
  - each makes the helper return non-zero.
- **Positive** (review S7), in that fixture:
  - `pnpm install … --package-import-method copy` builds both native
    modules under the build profile;
  - the full test list passes under the test profile (`PrivateNetwork`);
  - the server, under the server profile with a scratch DB, starts, writes
    its DB and WAL, and answers health.

**Migration tests** (container, then the host dry-run):
- starting from a root-owned checkout with **no** `atrium-build-run`
  installed, the migration installs its helpers (step 0) and builds without
  any root-run package install (review M16);
- HTTP requests for paths under the old and failed trees return 404 during
  the migration, after success, and after a rollback. The trees aren't under
  any served root, which a fixture with a symlink to a readable outside file
  checks (review M14);
- rollback with DEV moved to a newer SHA mid-migration: it returns to
  `trusted_sha` before starting the root service;
- `--reverse --sha <not PROD's>` refuses;
- after `--finish`, `--reverse` never reads a build-owned file.

**Host acceptance:**
1. `atrium-deploy dev-force <current SHA>`: every suite, health green.
2. `User=atrium-dev`; DEV works in the browser.
3. `probe-sandbox.sh --as-built` with the real users.
4. Caddy's admin API refuses all three identities.
5. The inode check: DEV's package files are independent of PROD's.
6. The next real DEV deploy goes through. Then `migrate --accept` and
   `--finish`.

## 6. Order of work
1. **D0:** Caddy's admin API was closed 2026-10-14. The Hermes route check is
   still to do, before the migration.
2. **Done 2026-10-14:**
   - the `atrium-deploy` symlink and submodule refusal;
   - Caddy `hide`.

   The refusal is extended by D2 (`node_modules` and `.git` components,
   NUL-safe parsing, rollback targets) when `host/` is installed.
3. **Build** `atrium-ops/host/` and the container tests.
4. **Outside review** of the code.
5. **Operator:**
   - `probe-sandbox.sh`;
   - `migrate --dry-run`;
   - the migration;
   - acceptance;
   - `--accept`, then `--finish` after a real deploy.
6. **Then:** connector Pass B `deploy_dev`; PROD (§10); P10.

## 7. Effect on the connector
Pass B's `deploy_dev` still runs the unchanged `atrium-deploy-gate dev <sha>`
as root. After this round, nothing that deploy runs from the branch is root.

## 8. Interim fixes
**Applied 2026-10-14:**
1. `atrium-deploy` refuses a target with a symlink or submodule (backup
   `atrium-deploy.bak-symlink-guard-*`). It parses the mode field of
   `git ls-tree -r` output. Paths with special characters are quoted by git,
   so the mode field stays intact. D2 later makes it NUL-safe and extends it.
   `atrium-deploy-prod` is not yet guarded.
2. Caddy: `hide node_modules .git .env* .npmrc` in all 8 `file_server`s.
   Verified with real requests: `node_modules` files return 404, client
   pages 200.

**Recommended now:** D9's admin socket (D0).

## 9. Decisions for the operator
| # | Question | Recommended |
|---|---|---|
| P1 | Two unprivileged users | **Yes** (review: agree) |
| P2 | `systemd-run` sandbox | **Yes,** with status propagation and real-systemd probes (review: agree) |
| P3 | Fresh build store, `copy` import, old tree replaced | **Yes,** using pnpm 11 command-line flags, checked by inode (review: agree) |
| P4 | Network | **Install: host. Tests: `PrivateNetwork`. Server: host**, after D0 (review: agree, conditionally on D0) |
| P5 | Memory | **Build 1536M, no swap; DEV 384M**; OOM and timeout handling tested |
| P6 | PROD | **After DEV** |
| P7 | Versioned host scripts, atomic installer, `--reverse` that never builds unreviewed code as root | **Yes** |
| P8 | Hermes on 9119 / `hermes.ewwb.dev` | **Verify every API route refuses unauthenticated requests,** a D0 prerequisite (review S13) |
| P9 | Caddy admin API | **A Unix socket,** now (D0/D9) |
| P10 | Serve DEV's static files from a separate root-built copy | **Yes, as the follow-up** after this round (D9) |
| P11 | DEV downtime during migration | **Accept it, variable in length** (build in place, D10) instead of a staging build |

## 10. PROD, the second step
- The same D4 drop-in for `atrium.service` (user `atrium`,
  `/var/lib/atrium`), D2, D6 and D10.
- The same D3 treatment for any install or test `atrium-deploy-prod` runs.
  That script is read first.
- PROD's tree is rebuilt the same way, since it shares the hard-linked store
  today (§2).

## 11. Review history
**Rev 0 → Rev 1** (outside review 1):

| Finding | Where |
|---|---|
| M1 (`chmod` follows a symlink) | D2 refusal; §8 |
| M2 (`chown` through hard links) | D3 `copy`, a fresh store; D10 replaces |
| M3 (root backup follows a path) | D6 |
| M4 (migration order) | D10 |
| S1 (root git) | §2 plus D7 |
| S2 (sockets and network) | §2, D3, D4, D9 |
| S3 (systemd protections) | D3, D4, §5 |
| S4 (environment and fds) | D3 |
| S5 (invariant scope) | §1.4 |

**Rev 1 → Rev 2** (outside review 2):

| Finding | Where |
|---|---|
| M5 (Caddy admin is a prerequisite) | D0, D9; §6 step 1 |
| M6 (DEV profile contradiction) | D4's own `InaccessiblePaths`; positive DB tests |
| M7 (staging build not in the helper contract) | Staging removed; build in place with DEV stopped (D10, P11); the helper takes no paths |
| M8 (the replacement `chmod` too broad, and the `.git` prune wrong) | D2: tracked regular files only; untracked and `.git` untouched; test |
| M9 (tracked files under `node_modules`) | D2 tree checks, on targets and rollback targets |
| M10 (pipeline hides failures) | D3: `pipefail` and `PIPESTATUS[0]`; status tests |
| M11 (pnpm 11 ignores `npm_config_*`) | D3: command-line flags; `pnpm config get`; inode check |
| M12 (DB ownership by path) | D6: by descriptor, checked, ordered; the copy counts bytes |
| M13 (`--reverse` would build as root from the current checkout) | D10: preserved trees, or a trusted PROD SHA only; failed rollback leaves DEV stopped |
| S6 (`hide` is defense in depth) | D9; P10 |
| S7 (positive tests) | D4; §5 positive probes |
| S8 (git environment) | D7: `env -i`, recorded effective config |
| S9 (migration state, artifacts) | D8, D10: lock, state file, artifact table, `--accept` and `--finish` |

**Rev 2 → Rev 3** (outside review 3: "ready to implement after M14–M16"):

| Finding | Where |
|---|---|
| M14 (preserved and failed trees inside the served checkout) | D10: recovery storage `/var/lib/atrium-ops-host/trees`, outside every served root, same filesystem; HTTP tests (§5) |
| M15 (reverse could run root on unapproved code or build-owned deps) | D10: `trusted_sha` = PROD's (a migration precondition); rollback checks it out first; build-owned trees quarantined before any root step; `--reverse --sha` must be PROD's; fresh root trees from that SHA only; otherwise DEV stays stopped |
| M16 (helper used before it's installed; directories not created) | D10 step 0 installs the helpers first; step 5 creates the build-owned directories by descriptor before the build; test from a system without the helper |
| S10 (wildcard unit stop) | D3: exact names recorded, `KillMode=control-group`, per-unit verification |
| S11 (state contents) | D10: `migrate.state` fields |
| S12 (positive probes vs the helper's fixed paths) | §5: a separate probe tool using the shared properties file, around a root-created fixture |
| S13 (Hermes before install networking) | D0, P8 |
| N1 (wording) | D9 |
| N2 (`O_CLOEXEC`) | D6 |
| N3 (downtime) | D10, P11 |

## 12. Implementation requirements (final review, S14–S17)

The final review approved Rev 3 for implementation, "subject to independent
code review before deployment". These are binding on the `host/` code:

- **S14, probe fixture:** the probe derives its properties from the same
  policy definition. Only the fixture's working directory, writable paths and
  identity mapping are substituted, and a test asserts every other property
  is identical. The fixture lives under a world-traversable (0755) root-owned
  parent, `/var/lib/atrium-ops-probe/<stamp>`, not inside the 0700 recovery
  storage, so a positive test can't fail just by being unable to enter it.
- **S15, workspace paths:** every package directory derived from
  `pnpm-workspace.yaml` must:
  - resolve inside `/srv/atrium-dev` and match an explicit allowlist of
    workspace roots (`packages/*`, `tools/*`, `apps/*` today, from
    `pnpm-workspace.yaml`; anything else there refuses);
  - have no `..` component, no absolute path, and no glob beyond one `*`
    segment;
  - be walked by descriptor, `O_NOFOLLOW` at every component, each
    root-owned and a real directory.

  Otherwise the build refuses.
- **S16, rename preflight:** besides equal `st_dev`, step 1 does a real
  `renameat` of a disposable directory from the checkout to the recovery
  storage and back. `EXDEV`, or any error, refuses before DEV is stopped.
  An atomic move that fails is never replaced by a copy or a delete.
- **S17, root restart gate:** one function, `verify_root_mode()`, is the only
  path to starting DEV as root. It checks all of these together, against the
  filesystem rather than the state file:
  - HEAD equals the authorized SHA;
  - every dependency tree is root-owned and came from `pre/` or a fresh root
    install;
  - no build-owned tree is at any dependency path;
  - DB ownership and unit configuration are root mode;
  - no failed step or unresolved backup is outstanding.

  `migrate.state` is written to a temporary file, `fsync`ed, renamed, and the
  directory `fsync`ed. Recovery reconciles the record with what's actually on
  disk, since a crash can fall between any two steps.
- **Legacy mode:** a root DEV restored by rollback or `--reverse` is an
  emergency legacy mode. The new `atrium-deploy dev` refuses while the legacy
  marker exists. The operator clears it by re-running the migration.

**Tests for the code review:** the review's §3 table is adopted as is,
plus two proof-of-failure tests:
- remove the build-tree quarantine before the root install;
- skip the trusted-SHA check before root start.

Each must make its corresponding security test fail.
