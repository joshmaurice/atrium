# Atrium Passdown — 2026-10-13 (evening) — Phase 3 step 1b-1, Edit mode UI (prototype lane)

**Predecessor:** `devtasks/Atrium-Passdown-2026-10-13-edit-plumbing.md`
(the same morning). Its §6 follow-ups still hold, except where this file says
otherwise.

**First instruction for the next session's Claude: clone the repo and read
`devtasks/` before advising.** List `devtasks/` by date and read every
passdown newer than the one you think is latest.

## 1. Status at handoff

| Item | State |
|---|---|
| Release state | **COMPLETE** (2026-10-13 evening PT) |
| DEV / MAIN / PROD | all at `6447082b02f9489a5e94b401cb23704b3fb7645d` |
| Base | `76f3dfb33d4f69ff9df1e15d7abe71493e805240` (`main` plus the uploaded pre-brief) |
| Commits | `ccad2704` feature · `ce0a2ec9` outside-review fixes · `7e9b311c` import-map fix · `6447082b` Firefox canvas-drag fix |
| Spec | `devtasks/PREBRIEF-edit-mode-ui-1.md`, FINAL Rev 2, plus §12 implementation notes (added on the branch, now on `main`) |
| Branch | `claude/edit-mode-ui-1`: deleted by the operator after PROD |

**Board:**
- `t_4c368fca` GLM review of `ccad2704`: **no review performed** (§4.4). A
  comment points to the final card.
- `t_ec9d89e4` GLM review of the final SHA: **APPROVE**. All counts and all
  eleven proofs matched.
- PROD gate and deploy for `6447082b`: done. The IDs weren't captured; the
  host state confirms them.

## 2. What shipped

**An owner-only Edit mode in `apps/client`**, per the pre-brief's B1–B8. It
is `apps/client` only, with no server, protocol, SOM or `packages/client`
change.
- **Edit toggle,** gated on `client.canEdit`. `apps/client` no longer reads
  `canPlaceTeleporters`.
- **Selection:**
  - by click, never after a look-drag;
  - Alt descends to a part;
  - external content selects its container;
  - `BoxHelper` outline;
  - the local avatar is see-through (§12.1); peer avatars select nothing;
  - nodes with a duplicated name can't be selected yet.
- **Handles:** three r163 `TransformControls`, attached to the DocumentView
  node object.
  - The camera doesn't turn during a handle drag.
  - The handles follow camera switches.
  - They're enabled only in Edit mode, with a selection, and with no rename of
    it unanswered.
- **Gestures** (`edit-gesture.js`):
  - local writes on every change;
  - sends throttled to about 10/s, plus a final send;
  - one record per node object and field, across gestures; a refused edit
    reverts to the server's value;
  - a removed node is never written.
- **Panel:**
  - position, rotation in degrees (Euler XYZ), scale, name;
  - per-axis commits from full-precision values;
  - Escape in a field restores it and keeps the selection;
  - rename applies on acceptance; it's disabled for camera/light hosts and
    duplicated names.
- **One rule for teleport triggers** (`edit-modes.js`): active only with no
  editing mode on.
  - Pointer lock is off while editing and M is ignored.
  - Reactivating the trigger disarms every pad (`teleport-trigger.js`), so
    turning Edit off while standing on a pad doesn't teleport.
- **Teleporter zones and labels use world positions** (`world-position.js`).
  Pads rebuild when a pad or an ancestor moves, whether the edit was your own
  or another client's. This fixed F14 and G13.

**Tests:**
- `apps/client` 200 → **294**. New pure modules, each with tests:
  `edit-gesture` 26, `edit-modes` 11, `edit-selection` 21, `rotation-degrees` 7,
  `world-position` 8; `teleport-trigger` 13 → 15; `import-guard` 27 → 46.
- Other suites unchanged: `packages/client` 169, renderer-three 64,
  interaction 9.
- **Eleven proofs of failure, (a)–(k).** Each fails its named tests. They're
  listed in the final review card, `/root/review-edit-mode-ui-1-final.txt` on
  the host.

**Verified:**
1. **Claude:** unit tests and proofs.
2. **A headless-browser run** against a real local server, with real
   `three@0.163.0` and `@gltf-transform` files served in place of esm.sh: 57/57
   checks. Plus an end-to-end script with two real `AtriumClient`s.
3. **Outside review** (a separate session) of `ccad2704`: three must-fixes,
   three should-fixes and nits, all fixed in `ce0a2ec9` (§12.2 of the spec).
4. **GLM `t_ec9d89e4`:** APPROVE on the final SHA, Node 22.23.2.
5. **The DEV deploy's own test runs** for each SHA: 27 suites, all
   `fail 0` / `skipped 0`.
6. **Operator DEV acceptance** in Firefox, §8 steps 1–11, on `6447082b`.

## 3. How the round ran (the prototype lane, E1)

1. **Pre-brief** Rev 0 → outside review (ChatGPT, six findings, all accepted)
   → Rev 1 → E1–E7 approved → Rev 2. Uploaded before the base fetch.
2. **Prototype** in a Claude cloud session: pure modules first, then `app.js`
   wiring. Pushed `ccad2704`.
3. **DEV deploy, then outside review** in parallel. The review found the
   duplicate-name guard could never fire, wrong-object attachment, and dead
   records writing (§12.2). Fixed in `ce0a2ec9`.
4. **DEV on `ce0a2ec9`: nothing worked** (no login, no connect). esm.sh
   doesn't serve `addons/` (§4.1). Fixed in `7e9b311c`.
5. **DEV acceptance in Firefox** found the canvas being dragged as an image
   (§4.2). Fixed in `6447082b`.
6. **GLM:** the first run did no review (§4.4). A fresh card on the final SHA
   approved it.
7. **MAIN, then PROD** with the guarded recipe (teleport-rearm §7.2).

**Timing:** prototype pushed about 11:15 PT; PROD COMPLETE in the evening.
Most of the elapsed time was the DEV acceptance walk and the two
browser-specific fixes, not the pipeline.

## 4. Findings

### 4.1 esm.sh doesn't serve `three@0.163.0/addons/…`
- **The import map** mapped `three/addons/` to
  `https://esm.sh/three@0.163.0/addons/`. Nothing had imported through it
  before this round.
  - esm.sh errors on that path.
  - `…/examples/jsm/…` works, and re-exports the same
    `/three@0.163.0/es2022/three.mjs`, so there's still one three.js instance.
- **One failed import stops the whole `app.js` module,** so no handler is
  attached: login, connect, everything looks dead.
- **Fixed in `apps/client/index.html`.** `tools/som-inspector` and
  `apps/playground` carry the same mapping, unused; they were left alone
  (§6.2).
- **Why the prototype missed it:** the browser harness served the module
  locally and mapped `addons/` itself. **Lesson: a test harness that stands in
  for a CDN must refuse what the CDN refuses.** The harness now fails
  `addons/` the way esm.sh does.
- **The deploy health check didn't catch it either:** it fetches asset files,
  not the module graph. See §6.3.

### 4.2 Firefox drags a `<canvas>` as an image
- **Symptom:** after Edit mode had been used, a look-drag showed the
  viewport's dashed drop outline and a small floating copy of the scene, and
  the camera barely turned.
- **Cause:** `TransformControls` calls `setPointerCapture` on every press
  while enabled, even with nothing attached, and it stayed enabled after Edit
  mode was turned off. In Firefox that turned a drag into a native image drag.
- **Fix:**
  - the canvas is `draggable = false`, and `dragstart` on it is cancelled;
  - the handles are enabled only while editing a selection
    (`syncGizmoEnabled`).
- **Chromium doesn't drag canvases,** so the headless run couldn't show this.
  Firefox acceptance remains necessary.

### 4.3 The outside review earned its place again
Its three must-fixes were real bugs, each with a failing test once found:
- the E7 guard was dead, because `som.nodes` collapses duplicate names;
- clicks and attachment could reach a mesh `Group` named like another node;
- `nodeRemoved` cancelled before marking records dead.

GLM later confirmed all of them. **Keep an independent outside review in the
prototype lane.**

### 4.4 The first GLM run "lost" tools it had
- **`t_4c368fca`'s summary** reported a tool-surface fault: only
  `kanban_show` callable, and `kanban_complete` sent with empty arguments
  14 times.
- **Its `agent.log` shows 15 `tool terminal completed`, 10 `read_file`,
  2 `write_file`.** The tools worked; the run lost track of them. This differs
  from edit-plumbing §3.6, where the card text caused it.
- **The §3.6 fix is intact:** sections §1–§6, and the grep returns 0.
- **But the §7.7 grep misses one sentence.** The requirements file's §6 says
  "Take board state from the `` `kanban_*` `` tools". The pattern
  `kanban_\* tools` doesn't match it, because of the backtick. It's about
  reading board state, not a claim about missing tools, so it's probably
  harmless.
- **The final card opened with "THIS RUN HAS TERMINAL, FILE AND GIT TOOLS.
  Use them for every step below."** and ran cleanly. Keep that line in
  hand-made cards.

### 4.5 Host: no swap, and OOM kills this morning
- **`dmesg`** shows the kernel killing two `node` processes inside the
  Hermes Docker sandbox at **12:27 UTC (05:27 PT)**, about 2.5 GB RSS each.
  That was during the 1a pipeline round.
- **The box has 3.8 GB RAM and no swap.** A runaway test process in the
  sandbox could just as well get PROD's `atrium.service` killed.
- **Recommended host change:** a 2 GB swap file, and/or a memory cap on the
  sandbox container (`docker update --memory 2g --memory-swap 2g <container>`).
  Do it before the next full pipeline round.

### 4.6 The "Unable to connect" on PROD was a network blip
- **About 21:23 UTC:** Firefox couldn't connect to `ewwb.dev` for a moment.
- **Server side was fine:** `atrium.service` had been up since 15:08 UTC with
  0 restarts, and Caddy since July with 0 restarts.
- **The log** shows the world torn down at the drop (no sessions left) and
  reloaded two minutes later.
- **DNS:** there's an A record only, no AAAA, so IPv6 isn't involved.
- **The host clock is UTC:** use UTC times in `journalctl --since`.

### 4.7 Console snippets: import by path in Firefox
`await import('@atrium/renderer-three')` in Firefox's DevTools console
doesn't use the page's import map: it fails, and the console just shows
`undefined`. Import by path instead:
`await import('/packages/renderer-three/src/index.js')`. Modules loaded that
way still resolve their own bare imports through the import map. Recipe in
§8.3.

### 4.8 Pre-existing, noticed during acceptance
- **M then Escape:** Escape releases pointer lock but leaves click-to-lock
  mode on, so the next click locks again. To return to drag-to-look, press M
  again. Unchanged by this round; fast-lane candidate (§6.2).
- **Delete mode's name walk** (teleporter delete) still matches by name
  through mesh objects. It only deletes teleporters, so the risk is low; left
  as is.

## 5. Claude cloud session notes
- **Push:** `add_repo(access: "push")` clones to `/home/claude/atrium`. After
  pushing, add a fetch refspec for the branch so the session sees its own
  push (tint §4.1).
- **Headless browser harness** (not committed; scratch in the session):
  - Playwright Chromium at `/opt/pw-browsers/chromium-1194`;
  - routes `https://esm.sh/**` to `node_modules` copies of the same versions:
    `three@0.163.0`, `@gltf-transform/core` 4.3.0, `@gltf-transform/view` 4.3.0
    from `npm pack`, `property-graph`, `ktx-parse`;
  - rewrites bare imports to pinned esm.sh URLs, so there's one three.js
    instance;
  - serves `/apps`, `/packages`, `/tests`, `/tools` from the checkout, against
    a local server
    (`PORT=3600 ATRIUM_DB_PATH=… WORLD_PATH=tests/fixtures/space.gltf`).
  - **Limits:** it can't reach the real esm.sh or `dev.ewwb.dev`, it has no
    Firefox, and swiftshader is slow (a drag runs about 8 sends/s).
- **The session's shell can't reach esm.sh or DEV.** WebFetch can read
  esm.sh stubs; that's how the `addons/` problem was confirmed.

## 6. What's next

### 6.1 In sequence
1. **Server cleanup round** (spec §10): one full-pipeline round; it changes
   server and SOM.
   - Prune deleted meshes, materials and accessors, on remove or on save.
   - Validate a non-string teleporter destination on `add`.
   - Fix `external-refs.test.js` and bring it into the suite.
   - The `SOMNode` name-setter identity check (E7), with a test that renames
     in a world holding duplicate legacy names.
   - Optionally: positive scale and unit quaternions on the server.
   - **Before the round:** the host memory fix (§4.5).
2. **1b-2:** add palette (primitives with A5-valid names), delete with
   confirmation and the "includes N children" warning, duplicate per D5. Same
   prototype lane, after the cleanup round.
3. **Step 2:** undo and redo, built on `edit-gesture`'s records.

### 6.2 Small, fast-lane sized
- **M/Escape:** have Escape (pointer-lock exit) return to drag-to-look mode
  (§4.8).
- **Import maps** in `tools/som-inspector/index.html` and
  `apps/playground/index.html`: point `three/addons/` at `…/examples/jsm/` too,
  before anything imports through them.
- **Carried:** the static-world fallback 404 (the `JSON.parse` noise), the
  double slash in a pasted `wss://` address, the `add`-path non-string
  destination (or fold it into 6.1.1).

### 6.3 Process proposals
- **Automated DEV acceptance:** commit the browser scenario as
  `tools/dev-acceptance/`, run it against DEV itself (real esm.sh) from the
  host or Hermes's sandbox with Playwright, signed in as `hermes-devcheck` in
  `ep-check`. It covers the mechanical §8 steps; the operator keeps the "looks
  and feels right" checks and Firefox.
- **A module-graph smoke check in `atrium-deploy`:** after deploy, load
  `apps/client` headless, or at least fetch every import-map URL the client
  uses, and fail if `app.js` doesn't finish loading. This would have caught
  §4.1 at deploy time.

## 7. Follow-ups

### 7.1 Closed this round
- **Edit-plumbing §5.2 "Phase 3 step 1b":** 1b-1 done; 1b-2 next (§6.1).
- **`claude/label-tracking` deleted** (seen in the DEV fetch).
- **Edit-plumbing §3.6 re-check:** still fixed (§4.4).

### 7.2 New
- **Host memory:** swap or a container cap (§4.5).
- **The §7.7 grep pattern** misses backticked `kanban_*` (§4.4).
- **M/Escape UX** and **the unused `addons/` mappings** (§6.2).
- **The dev-acceptance automation and deploy smoke-check proposals** (§6.3).
- **DEV leftovers:** `grp-test` and `pad-in-grp` in `BevOnDev/home`, plus
  whatever else acceptance left there. Keep them or delete them.
- **The outside reviewer's re-check of `ce0a2ec9`:** not received before
  release. GLM's final review covered every §12.2 row.

### 7.3 Carried over (still open)
- **From edit-plumbing §6.2:**
  - the sentinel isn't wired into revision rounds;
  - `docker_forward_env` tidy;
  - `hermes-devcheck` and `ep-check` on DEV.
- **From the tint and rearm passdowns:**
  - `atrium-deploy` health checks still use `sslip.io`;
  - the `file:///` warning after a peer joins.
- **From create-template §6.2–6.3:**
  - the stale `/workspace/atrium` checkout;
  - the 2026-10-09 `ewwb.dev` items;
  - the Step 9 §6.3 list.
- **The GitHub PAT expires 2026-10-29** (16 days from this passdown).

## 8. Recipes

`$SC` = `/root/.hermes/sandboxes/docker/default/workspace/atrium`

### 8.1 Hand-made GLM review card (as run, final)
As tint §7.2, with three additions:
- the first body line: `THIS RUN HAS TERMINAL, FILE AND GIT TOOLS. Use them for every step below.`;
- a host fetch of the branch before creating the card;
- every count next to its exact command.

The body used is `/root/review-edit-mode-ui-1-final.txt` on the host.

### 8.2 Did a GLM run really lack tools?
```
LOG=/root/.hermes/profiles/atrium-glm/logs/agent.log
L=$(grep -n "<t_id>" $LOG | head -1 | cut -d: -f1)
sed -n "${L},\$p" $LOG | grep -o -E "tool [a-z_]+ (completed|failed|started)" | sort | uniq -c
```
`tool terminal completed` lines mean the tools were there.

### 8.3 Console: a teleporter inside a group (owner, DEV)
```js
(async () => {
  const c = atriumClient
  const R = await import('/packages/renderer-three/src/index.js')
  const errs = []; const onErr = (e) => errs.push(`${e.code}: ${e.message}`); c.on('error', onErr)
  if (!c.som.getNodeByName('grp-test')) c.addNode({ name: 'grp-test', translation: [0, 0, -6] })
  await new Promise(r => setTimeout(r, 500))
  if (!c.som.getNodeByName('pad-in-grp')) c._wsSend({ type: 'add', seq: ++c._sendSeq, parent: 'grp-test',
    node: R.buildTeleporterDescriptor({ name: 'pad-in-grp', position: [0, 0, 0], destination: '/' }) })
  await new Promise(r => setTimeout(r, 500)); c.off('error', onErr)
  console.log('grp-test:', c.som.getNodeByName('grp-test')?.translation,
              '| pad parent:', c.som.getNodeByName('pad-in-grp')?.parent?.name,
              '| labels:', document.querySelectorAll('.pad-label').length, '| errors:', errs)
})().catch(e => console.error('snippet failed:', e))
```

### 8.4 Read a GLM verdict
```
hermes kanban --board atrium show <t_id> --json > /root/<t_id>.json
python3 -c "import json;d=json.load(open('/root/<t_id>.json'));print(d['runs'][-1]['summary'])"
```

### 8.5 Host memory check
```
free -m; dmesg -T | grep -i -E "oom|killed process" | tail -10
```
`dmesg -T` and `journalctl` times are UTC on this host.
