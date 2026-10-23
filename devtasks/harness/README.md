# Claude's browser-check harness

This is test tooling, not product code. Claude uses it to run a round's
"§5.1 browser checks" against a **published** commit, before the operator's
DEV acceptance.
- **Why it exists:** the session's proxy refuses `dev.ewwb.dev`, so Claude
  can't test DEV directly. The harness runs the real code locally instead.
- **It was built** for library-sky (2026-10-22) and extended for
  edit-polish-3 (2026-10-23).
- **It was committed so a new session doesn't have to rebuild it.**

## What it is
- **`server.mjs`:** one Node process serving the checkout over HTTPS on two
  origins, `https://127.0.0.1:8443` and `:8444`. It also serves:
  - the real world server (`attachSessionHandlers` + `createWorld`), with
    WebSocket worlds at `wss://127.0.0.1:8443/w/<key>`;
  - local copies of the import map's esm.sh modules (`/vendor/…`);
  - generated libraries at `/assets/library/…`.
- **`h.py`:** Playwright (Python, sync API) helpers. `Page(browser, origin,
  ws_routes=…)` waits for the client to boot; it also has `connect`,
  `edit_on`, `ev`, `wait`, and `http`/`ctl`/`counts` for the server's
  controls.
- **`gen.mjs`:** generates two libraries in the production format, using
  `scripts/library-build` and its fake Poly Haven:
  - `small`: 8 models in 5 categories and 3 skies;
  - `heavy`: 30 models with 2048 textures, to reach the 512 MiB budget.
- **`group.gltf`:** a world with a rotated group whose child teleporter
  lands on spawn, for the `grp*` worlds.
- **`setup.sh <sha>`:** builds everything for one commit (below).
- **`checks/`:** the scripts each round ran. Each prints what it saw; the
  round's passdown says what was expected.
  - `checks/library-sky/c*.py`: the 14 library-sky checks, plus a few
    variants;
  - `checks/edit-polish-3/{a..f}.py`: edit-polish-3's checks 1–10 and its
    round-2 V1/V2;
  - `checks/scripting-4a/`: step 4a's §5.1 checks, with shared helpers in
    `anim.py`. `c1.py` is checks 1, 2, 2b and 3; `c4.py` is 4 and 5;
    `c6.py` is 6; `c7.py` is 7 and 8; `c8b.py` is the row right after
    placing a model; `c9.py` is 9; `clockprobe.py` prints each session's
    clock window and frame time; `r2.py` is round 2's four checks (Played, selected while loading, missing clip, discontinuity) and the two-owner-tab select.

## Setup (about 2 minutes)
```bash
cd /home/claude/atrium            # the clone; the commit must be fetched into it
# (a clone elsewhere: set ATRIUM_REPO=<its path> for setup.sh and server.mjs)
git fetch origin refs/heads/workflow/<slug>:refs/remotes/origin/workflow/<slug>
devtasks/harness/setup.sh <published SHA>   # HARNESS_ROOT defaults to /tmp/atrium-harness
```
**Then start the server with the Bash tool's `run_in_background`** (a
`nohup … &` server dies when the reply ends):
```bash
HARNESS_ROOT=/tmp/atrium-harness node /tmp/atrium-harness/harness/server.mjs
```
**Run a check:**
```bash
HARNESS_ROOT=/tmp/atrium-harness python3 devtasks/harness/checks/edit-polish-3/a.py
```
**For a new commit,** run `setup.sh <new sha>` again (it moves the worktree)
and restart the server. Worlds live only in the server process, so a restart
gives fresh worlds.

## Worlds, controls and hooks
- **Worlds, by the key's prefix:**
  - `atr…`: `tests/fixtures/atrium.gltf` (it has a sky);
  - `ext…`: `space-ext.gltf` (external references);
  - `rel…`: `atrium.gltf` with a document-relative sky, which is refused by
    rule;
  - `grp…`: `group.gltf`;
  - anything else: `space.gltf`.
- **Visitors:** every socket is the owner unless the URL has `?visitor`.
- **`/__ctl?…` sets:**
  - `catalog=small|heavy|committed`;
  - `flaky=0|1` (`/skies/flaky.png` is 404 until set);
  - `missing=<path>` (that path returns 404);
  - `worldsDelay=<ms>` (`/api/worlds` answers after a delay).
- **`/__save?key=<world key>`** serializes that world as autosave does
  (avatars excluded) and keeps the document. **`/__restart?key=…`** does the
  same, then closes every socket of that world. The next connect builds the
  world from the saved document, as a server restart does (scripting-4a
  check 6).
- **`/khronos/<file>`** serves `$HARNESS_ROOT/khronos/` (`Fox.glb`,
  `CesiumMan.glb`; `setup.sh` fetches them).
- **Counters:** `/__counts` gives request counts per path, and `/__reset`
  clears them.
- **The `app.js` it serves is patched** to expose:
  - `window.__mb` (the model bridge);
  - `window.__sky` (the sky loader);
  - `__lib()` (grid, picker, catalog, undo);
  - `__ep()` (forms, gate, `selected`, `selectedObj`, `gizmo`,
    `selectForEdit`, `modes`);
  - `__anim()` (`modelAnimations`, `animationControls`, `selected`), from
    scripting-4a on.

  **If a later `app.js` renames those lines, the patch silently misses** and
  `Page()` times out waiting for `window.__lib`. Update the `replace`
  strings in `server.mjs`.
- **Images:** `/skies/ok.png` is 2048 × 1024, and `/skies/big.png` is
  8192 × 4096, which is too large.

## Lessons (edit-polish-3 passdown §4.5, and scripting-4a)
- **Keep the viewport small for timing checks** (`anim.py`'s `SPage` uses
  480 × 360). SwiftShader takes about 150 ms a frame for two skinned models
  at 1280 × 800. A pong waits behind the frame, so the clock estimate is
  off by half that wait. That's a harness artifact; real hardware is
  around 60 fps.
- **Ground truth for clip time** is `performance.timeOrigin +
  performance.now()` in the page. A page's `Date.now` override doesn't
  touch it, and the harness server runs on the same machine.
- **Use a fresh world key per run** (`anim.fresh()`): worlds live as long as
  the server process, so a reused key keeps the last run's models.
- **Any check that stubs or holds WebSocket messages
  (`page.route_web_socket`) must wait with `page.wait_for_timeout(ms)`, not
  `time.sleep`.** The sync API forwards routed messages only during its own
  calls.
- **A structural request in flight blocks other adds** (1b-2), so add the
  other objects first.
- **WebGL runs on SwiftShader:** launch Chromium with `--use-gl=swiftshader
  --enable-unsafe-swiftshader --ignore-gpu-blocklist`. The scripts already
  do.
- **The real Poly Haven assets can't be fetched from the session;** the
  operator checks them on DEV. For animated models (step 4), Khronos's
  sample models can be fetched with a sparse `git clone` of
  `KhronosGroup/glTF-Sample-Assets` (`Models/Fox`, `Models/CesiumMan`) and
  served from the checkout.
