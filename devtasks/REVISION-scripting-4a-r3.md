# Revision — scripting-4a round 3 (after the operator's DEV acceptance of `11f1757f`)

**Status:** approved by the operator (2026-10-23 20:23 PT), Rev 0 as
drafted.
- **Base:** round 2's reviewed tip `159b22354f9821c0ededb8d18c1e5e876335a6ca`
  on `workflow/scripting-4a`. Round 3 commits on top of it, on the same
  branch, in the existing worktree `/workspace/wt/scripting-4a`.
- **DEV runs `11f1757f`** (round 2's re-merge with `main`). That is **not
  accepted**: the acceptance gate `t_4abec9df` stays blocked and is
  superseded by round 3's.
- **The contract still governs:** `devtasks/PREBRIEF-scripting-4a.md`, FINAL
  Rev 1.2, at `100365758e75c8880897fa5ceb48693fdc810415` (sha256
  `9260df0b…667f`), with the operator's corrections (the comment on
  `t_4954c617`) and `devtasks/REVISION-scripting-4a.md` (round 2, at
  `999372ea`, sha256 `578b8891…b8cc`). This file adds W1–W3 and nothing
  else.

## 1. What DEV acceptance found
The operator's acceptance on DEV (Firefox, 2026-10-23 evening) passed §6
steps 1–8. Step 9 couldn't be done by hand: the model loads too fast to
select it mid-load. That case passed in Claude's harness with the fetch
held. **Two problems were reported.** Claude reproduced both in the browser
harness on `11f1757f`.

| # | Problem | Where (at `159b2235`) | Claude's check |
|---|---|---|---|
| W1/W2 | **After a page reload, a Duplicate or an Undo-restored rigged model gets a wrong selection box and can't be clicked.** On DEV the duplicate CesiumMan's outline lay on its side, rotated 90°, overlapping the original. Later the outline was gone and the copy couldn't be selected, and the restored walking fox couldn't be selected either. Edit off and on didn't help; a reconnect did. **This predates 4a:** the same steps fail identically on the base `10036575` (so on PROD too). It only affects models with a skeleton (`SkinnedMesh`), which is why the static library never showed it. | `model-bridge.js` `attach` (L776–791) and the instance path (L635–649); `app.js` `attachSelected` (L1769–1786) | **Reproduced on `11f1757f` and on `10036575`.** After a reload, the copy's outline was `[1.52, −2.91, −1.27]–[2.98, −2.05, −0.81]` (on its side, below the floor) while the model's true box was `[1.22, 0.02, −2.86]–[1.69, 1.49, −2.12]`. Three clicks on the copy each hit the ground plane. The Undo-restored fox's outline collapsed to a point, and three clicks hit the ground. The originals stayed correct. Before a reload, both cases were correct |
| W3 | **The Stop button runs past the Edit panel's right edge.** The panel is 250 px wide, and the Animation row is one unwrapped flex line: label, the clip select (as wide as its longest id), Loop, Play and Stop. | `index.html` `#ep-anim-row` (L697–704), `#edit-panel .ep-row` (L418) | **Measured** in Chromium at a 1280 px window: the panel ends at x = 1268. For the fox, Stop spans 1259–1309, so 9 px are visible. For CesiumMan (`animation_0`), Stop spans 1290–1340, past the panel and the window. Firefox's wider controls showed a little more of the fox's button |

**Why W1/W2 happens** (read from three r163, confirmed by the harness
numbers):
- `SkinnedMesh` caches `boundingBox` and `boundingSphere` the first time
  they're needed. It computes them from the **current** bone and bind
  matrices (`getVertexPosition` → `applyBoneTransform`, then
  `bindMatrixInverse`). The cache is kept until something sets it back to
  `null`, and `raycast` and `Box3.setFromObject` (so the `BoxHelper`
  outline) both use it.
- `bindMatrixInverse` is refreshed only in `SkinnedMesh.updateMatrixWorld`,
  which the renderer calls each frame. `Box3.expandByObject` calls
  `updateWorldMatrix` instead, which doesn't refresh it.
- **Duplicate and Undo select the new node at once** (`selectAddedNode`).
  When its template is already parsed, the instance is built and attached
  in the same task, **before the first render**. The outline then caches a
  box computed from the template's stale matrices. That box is wrong in
  orientation and position, and click tests against it miss.
- **Before a reload the bug is hidden:** the Model form's Check measures the
  template, which leaves its matrices current. After a reload, the bridge
  parses the template itself, and nothing updates it.

## 2. The contract (round 3)

### W1. The bridge leaves every instance it places with fresh transforms and no early bounds
In `packages/renderer-three/src/model-bridge.js`:
- **After `attach` puts an instance's wrapper in its host** (every path:
  the first attach, a re-attach and a re-host on `attachView`), the bridge
  calls **`refreshPlacedInstance(wrapper)`**, a new exported helper (in
  `model-instances.js` or the bridge):
  1. `wrapper.updateWorldMatrix(true, false)`, so the host chain above it
     is current;
  2. `wrapper.updateMatrixWorld(true)`, which refreshes every descendant,
     including bones and each `SkinnedMesh`'s `bindMatrixInverse`;
  3. for every `SkinnedMesh` under the wrapper, `boundingBox = null` and
     `boundingSphere = null`, so the next use recomputes them from fresh
     matrices.
- **The bridge's call order is unchanged** (`setStatus`, `settle`,
  `onInstanceCreated`, `attachOrWait`). The animation layer's first pose is
  set in `onInstanceCreated`, before the attach, so the attach's refresh
  computes from that pose.
- **Placeholders and meshes without a skeleton** are untouched apart from
  steps 1–2. Their bounds come from their geometry and were never wrong.
- **Nothing else in the bridge changes:** loading, limits, cache, keys,
  disposal and the three lifecycle callbacks.

### W2. The selection outline is built from fresh transforms
In `apps/client/src/app.js` `attachSelected`, **before** `new
THREE.BoxHelper(selectedObj, …)`:
- `selectedObj.updateWorldMatrix(true, false)`;
- `selectedObj.updateMatrixWorld(true)`.

This covers any object selected before its first render, a model or not.
`outline.update()` per frame is unchanged.

**Stated limit, recorded rather than fixed:** a rigged model's box is
computed once, from the pose it has when first needed. While it animates,
its limbs can move outside that box, so a click on an outstretched limb can
miss. Fixing that needs per-frame or per-clip bounds, which is a separate
change, recorded for 4b in this step's passdown.

### W3. The clip controls always fit the panel
In `apps/client/index.html`:
- **The Animation row keeps its label and the clip select.** The select gets
  `flex: 1 1 auto; min-width: 0; max-width: 100%`, so a long id is cut
  short by the control and never widens the row. Each option keeps its full
  id as `textContent`, and `title` on the select shows the chosen id in
  full.
- **Loop, Play and Stop move to a second row,** `#ep-anim-actions`, aligned
  under the select (an empty 58 px label cell, as other rows use). It's
  shown and hidden together with `#ep-anim-row`.
- `renderAnimationRow` sets the select's `title` and shows both rows
  together. Nothing else in the panel logic changes.
- **The rule, tested in the browser:** for every clip id up to Z1's 300
  characters, each of the select, Loop, Play and Stop lies entirely inside
  `#edit-panel`'s box, in a 1280 × 800 window.

### What doesn't change
Everything else in Z1–Z8, the operator's corrections and round 2's V1–V8.

## 3. Tests and proofs (round 3)

| Item | New tests |
|---|---|
| W1 | renderer-three, real three.js, **no render:** a skinned template built in code (a root rotated −90° about X like a Z-up file, an armature, two bones, a `SkinnedMesh` bound to them), cloned through `buildInstance`, then attached by the bridge under a host translated to `(2, 0, −3)` and scaled 0.5. (a) `Box3.setFromObject(host)` right after the attach, with no render, equals within 1e-4 the precise box from `setFromObject(host, true)` after `host.updateMatrixWorld(true)`. (b) A ray through the model's true centre hits it (`Raycaster.intersectObject(host, true)` is non-empty). (c) A `SkinnedMesh` whose `boundingBox` was set to a wrong value **before** the attach has it recomputed correctly after. (d) A static mesh's geometry bounds are untouched. (e) The re-host path (`detachView` / `attachView`) gives the same result |
| W2 | `app.js` wiring guard: in `attachSelected`, `updateWorldMatrix(true, false)` and `updateMatrixWorld(true)` on `selectedObj` come before `new THREE.BoxHelper` |
| W3 | `index.html` guard: `#ep-anim-actions` exists and holds `#ep-anim-loop-label`, `#ep-anim-play` and `#ep-anim-stop`; `#ep-anim-row` holds no button; the select's rule has `min-width: 0`. `app.js` guard: `renderAnimationRow` shows and hides both rows and sets the select's `title` |

**Proofs** (each break fails named tests; "not reproducible" is not an
acceptable result):
- **(s1)** `attach` without `refreshPlacedInstance` (W1 (a) and (b) fail);
- **(s2)** `refreshPlacedInstance` without clearing the skinned bounds (W1
  (c) fails);
- **(s3)** `attachSelected` without the two updates (W2's guard fails);
- **(s4)** Play and Stop put back in `#ep-anim-row`, or the select's
  `min-width: 0` removed (two breaks, each failing its guard).

**And the whole round still passes:**
- full suites, with the same rules as rounds 1 and 2: server files one at a
  time under `timeout 180`, `packages/client` without
  `--test-force-exit`, `importmap-guard` green;
- **round 2's proofs (r1)–(r6)** and **round 1's renderer-three proofs (e),
  (e2), (e3), (e4)**, re-run against the round-3 tip.

**Steps, one commit each:**
1. W1 and its tests (`renderer-three`);
2. W2 and W3 and their guards (`app.js`, `index.html`);
3. suites, proofs and the handoff.

**Before DEV acceptance:** Claude re-runs §5.1 checks 1–10, round 2's
browser checks, and these new ones in the browser:
- **after a page reload,** Duplicate CesiumMan and Undo a deleted fox: each
  outline matches the model's true box within 0.05 m, and three clicks on
  each select it (the harness's `sel.py`);
- the same on a static library model, as a regression check;
- **every clip control inside the panel** at 1280 × 800, for the fox,
  CesiumMan, and a 300-character clip id.

The operator then re-runs §6 steps 5–8 in Firefox, plus: reload, Duplicate
CesiumMan, click the copy (it selects, and the outline stands upright around
it); and both Play and Stop are fully visible for both models.

## 4. Kickoff body for round 3 (post it verbatim as the revision kickoff card's text)

---

### KICKOFF — scripting-4a revision round 3. Slug: `scripting-4a`

You are the kickoff orchestrator for round 3 of `scripting-4a`. Build the
graph below, read it back, report, and stop. Do not implement, review or
deploy anything yourself.
- **Your tools:** only `kanban_*`.
- **Blocking:** never call `kanban_block` without an explicit `task_id`, and
  never block this card.
- **Titles:** use them exactly as written.

**The contract is in git; you don't read it.** It is
`devtasks/REVISION-scripting-4a-r3.md` on `main`, together with
`devtasks/PREBRIEF-scripting-4a.md` at `100365758e75c8880897fa5ceb48693fdc810415`
(sha256 `9260df0bc259d64b55c0812aba0f735ffa3183e2db637dccf4359ca1c5d9667f`),
`devtasks/REVISION-scripting-4a.md` at `999372ea3b3e3aedafdcd9586ee85be6bb8b7f64`
(sha256 `578b889116bd7cebf8203cf73b694aff6b1bd90010cb3cfa54f63ec85883b8cc`)
and the operator's corrections (the comment on `t_4954c617`).
- **The front door has already checked the round-3 revision** and posted
  its commit and sha256 on this card. **You have only `kanban_*` tools: do
  not try to fetch or hash anything, and do not block for lack of a shell.**
- Copy that commit and sha256 into cards 1 and 2. **They** have terminal,
  file and git tools. Each reads the revision with
  `git -C /workspace/atrium fetch origin main && git -C /workspace/atrium show <commit>:devtasks/REVISION-scripting-4a-r3.md > /tmp/revision-r3.md && sha256sum /tmp/revision-r3.md`,
  and blocks with `kind="capability"` on a mismatch.

#### Graph
1. **`Implement r3 — scripting-4a`.** Assignee `atrium-deepseek`, parent:
   this kickoff, `--max-runtime 2h` (7200 s).
   - **Body:**
     - the revision reference and hash check;
     - continue `workflow/scripting-4a` from
       `159b22354f9821c0ededb8d18c1e5e876335a6ca` in the existing worktree
       `/workspace/wt/scripting-4a` (`git -C /workspace/wt/scripting-4a
       status` must be clean at that SHA, or block `needs_input`);
     - the revision's §2 contract and §3 steps, tests and proofs;
     - round 2's revision and the operator's corrections, still binding;
     - the WORKER-CARD REQUIREMENTS comment (779 on `t_92bd68f0`).
   - **The handoff** carries proofs (s1)–(s4), **and** round 2's (r1)–(r6)
     and round 1's (e), (e2), (e3), (e4) re-run, with per-file counts and
     exit codes.
2. **`GLM review r3 — scripting-4a`.** Assignee `atrium-glm`, parent:
   card 1.
   - Its body opens with
     `THIS RUN HAS TERMINAL, FILE AND GIT TOOLS. Use them for every step below.`
   - The reviewer reproduces every proof itself and checks that every test
     in the revision's §3 table exists.
3. **`Review gate r3 — scripting-4a`.** Assignee `atrium-orchestrator`,
   parent: card 2. It creates nothing.
   - **On a valid APPROVE of the exact 40-character SHA,** it blocks with
     `APPROVE <SHA40>: front door, build the release chain`.
   - **Otherwise,** it blocks for the operator with the verdict quoted.
4. **Before you complete,** link card 3 to **round 3's sentinel** as a
   parent. The front door creates it and posts its id on this card. Round
   1's `t_6ad50332` and round 2's `t_c1d6e517` must not be used. Do not
   create a sentinel yourself.
5. **The release chain** is the front door's: the same four cards as round
   2 (Publish, DEV deploy, DEV finalizer, acceptance gate), with the new SHA.
   The DEV deploy restarts DEV. Nothing reaches MAIN or PROD.

#### Report back
- the three ids;
- the implementation's parent and its 7200 s cap;
- the hash line copied into cards 1 and 2;
- the review's opening line;
- the gate linked to round 3's sentinel.

Then complete this card.

---
