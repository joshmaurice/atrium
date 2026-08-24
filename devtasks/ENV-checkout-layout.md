# Environment: on-disk checkouts and deploy layout (dev box)

> Quick reference so a session doesn't re-derive this the hard way. Recorded
> 2026-08-23. Verify with the commands at the bottom before trusting — trees
> and commits drift.

The dev box (`ubuntu-4gb-hil-1`) has **four** separate `atrium` trees. They
were confused for one another during a debugging session; three of them are
*not* where you edit code. Know which is which before branching, editing, or
pushing.

## The four trees

| Path | Role | Origin | Edit here? |
|---|---|---|---|
| `/root/.hermes/sandboxes/docker/default/workspace/atrium` | **Active working checkout** — Hermes codes here (bind-mounted into the sandbox). Commits originate here and push to origin; `main` deploys to `/srv/atrium-dev`. Observed 2026-08-23 on branch `feature/client-ui` @ `ea4e062` — i.e. on a feature branch, *behind* deployed `main`. Branches lag `main` normally; **`git fetch && git checkout main && git pull` before branching new work** so you don't fork off stale code. | `joshmaurice/atrium` (yours) | **Yes** (after syncing) |
| `/srv/atrium-dev` | **Deployed dev tree.** `atrium-dev.service` runs `node src/index.js` from here → `localhost:3100`; Caddy dev vhost (`dev.5-78-232-73.sslip.io`) proxies to it. | `joshmaurice/atrium` (yours) | No — deploy target |
| `/srv/atrium` | **Deployed prod tree.** Prod vhost (`5.78.232.73.sslip.io`) → `localhost:3000`. Older `main` commit than dev. | `joshmaurice/atrium` (yours) | No — deploy target |
| `/root/atrium` | **Upstream mirror — NOT yours.** Clean clone of Tony Parisi's repo, sits on his `main`. | `https://github.com/tparisi/atrium.git` | No — reference only |

## Gotchas that actually bit

- **`/root/atrium` is the trap.** It looks like a working checkout (in `root`'s
  home, named `atrium`) but its `origin` is **upstream** (`tparisi`), not yours.
  Its HEAD `5f0c52a` ("Work in progress activeCamera…", authored by Tony
  Parisi, 2026-06-18) is *his* WIP, not lost local work. It is already folded
  into your line (your tree carries `287c9c0` on top). **Do not push from here
  and do not treat its HEAD as unbacked-up work.**

- **Deploy ≠ checkout.** A commit appearing in `/srv/atrium-dev`'s history only
  means it reached your deployed `main`. It does not tell you which tree it was
  *authored* in — that's the Hermes bind mount.

- **Upstream vs. yours.** Parisi's repo is upstream; your fork/repo is
  `joshmaurice/atrium`. To check whether upstream work is folded in, compare
  his tip (`/root/atrium` HEAD) against your `main` history by commit subject.

- **Branch, not just HEAD, matters.** The working checkout was observed on
  `feature/client-ui` @ `ea4e062`, *behind* `main`. Commits like `287c9c0`
  (SOMCamera work past Parisi's tip) live on `main` / other refs, not
  necessarily on the currently-checked-out branch — earlier diagnosis found it
  only via `git log --all`. Sync to `main` before assuming a commit is present.

- **Deployed commits (observed 2026-08-23):** dev (`/srv/atrium-dev`) @
  `e0ff7e0` (current `main`); prod (`/srv/atrium`) @ `81bc709` (older `main`,
  peer-routing-only per handoff notes). Prod deliberately trails dev.

## Re-check if you suspect drift

The layout above was confirmed against the box on 2026-08-23 (origins, HEADs,
running service, and proxy ports all verified). You don't need to re-run these
routinely — only if a redeploy, branch move, or remote re-point may have made
this note stale.

```sh
# Which tree is which — origin tells you whose repo it tracks
for d in \
  /root/.hermes/sandboxes/docker/default/workspace/atrium \
  /srv/atrium-dev /srv/atrium /root/atrium; do
  echo "== $d =="
  git -C "$d" remote get-url origin 2>/dev/null
  git -C "$d" log --oneline -1 2>/dev/null
done

# What the running dev service actually executes
systemctl status atrium-dev.service --no-pager | grep -E 'Loaded|Active|CGroup|node'

# Which local ports the vhosts proxy to
sudo grep -n 'reverse_proxy' /etc/caddy/Caddyfile
```

Expected: the Hermes bind mount and both `/srv` trees show
`joshmaurice/atrium`; `/root/atrium` shows `tparisi/atrium`. If `/root/atrium`
ever shows *your* origin, someone re-pointed it and this note is stale.
