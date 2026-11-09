3ccc1ad4581d6c6b5b10633b1b3915b7f01b7dc5

# Atrium `selection-parts` — outside review of the design pre-brief (DRAFT Rev 1.2)

**Verdict: CHANGES REQUESTED** — one must-fix in the contract (T15's Escape during a handle press moves the wrong object, and saves it), six should-fixes, and nits. The clone worked and every listed command passes. The rest of the design held up: T13's policy, T11's Undo and Redo, `sameCanonical`, the Copy math and P0's split survived my probes.

Reviewed: `devtasks/PREBRIEF-selection-parts.md` at `3ccc1ad4…`, against the code at `dd2071f9…` (the review commit differs from it in `devtasks/` only: 3 files, +959). Line numbers are at the reviewed commit; `TC:` is `three@0.163.0/examples/jsm/controls/TransformControls.js`.

**How the gesture findings were reproduced.** I built `devtasks/harness` for `dd2071f9` and drove the real page with real mouse events (Playwright, Chrome for Testing 153, SwiftShader). For T13, T15 and T17 I wrote a prototype of 64 lines in the harness worktree's `app.js` and `edit-selection.js`, following §4's text, switched on by `?proto`. It is my reading of the text, not the round's code. Where a result could depend on a choice I made, I say so, and M-1 is also shown on the released code with no prototype.

## Findings

### M-1 — Must-fix: Escape during a handle press or drag of a part moves its group, and the move is sent and recorded (T15 with T17)
REPRODUCED (prototype, real browser; and on the released code with T15's one call).

- `PREBRIEF` L460–463 (T15): "a selection with a parent → `selectForEdit(parent)`". `app.js:2283–2292`: `selectForEdit` ends `activeGesture` and re-attaches the handles. `TC:573–580`: `attach()` swaps the object and leaves `dragging`, `axis` and `_positionStart` as they are. `TC:328`: each later pointer move sets `object.position = offset + _positionStart`, the **old** object's start on the **new** object.
- Today Escape always selects nothing (`app.js:1646`), which detaches. T15 is the first path that puts the handles on another object while the mouse is still down.

Scenario: Alt-click the lamp's shade, drag its handle, press Escape (the natural "cancel"), keep moving, release.
```
B1 20 px into the drag: shade SOM [0.1618, 1.6, -0.0] | gesture True
B2 Escape -> lamp-01 | gizmo {'dragging': True, 'axis': 'XYZ', 'enabled': True, 'attached': 'lamp-01'}
B3 20 px more, released: lamp-01 SOM [0.6353, 1.4963, -0.3741] three [0.6353, 1.4963, -0.3741] | undo ['Move “lamp-shade”', 'Move “lamp-01”']
B4 the server's lamp-01: [[0.6353007058038846, 1.4963313599177557, -0.37408283997943903]]
```
The lamp went from `[3, 0, 0]` to the shade's local position plus the drag. Escape before any travel does the same (`B'2 … lamp-01 SOM [0.4584, 1.4963, -0.3741] | undo ['Move “lamp-01”']`).

It does not depend on my T17: on the released code, calling `__ep().selectForEdit(selected.parent)` mid-drag leaves `lamp-01 SOM [3, 0, 0] drawn at [0.6353, 1.4963, -0.3741]`, the hidden offset `app.js:2826–2829` warns about. T17 as written turns that offset into a sent Move, because its "first change past 4 px begins the gesture" runs on whatever is selected then.

Fix (tried, see S-1): `selectForEdit` ends the control's own drag before it changes anything: `if (gizmo?.dragging) gizmo.pointerUp({ button: 0 })`. With it: `Escape during a drag of the shade -> selected lamp-01 | lamp-01 SOM [3, 0, 0] drawn [3, 0, 0] | shade SOM [0.1618, 1.6, -0.0] drawn [0.1618, 1.6, -0.0] | undo ['Move “lamp-shade”'] | gizmo.dragging False`. T15 should also say what Escape during a drag means (commit and go up, as this does and as today's deselect does, or cancel the drag). Add a harness check and a proof for it.

### S-1 — Should-fix (already on PROD, not from this round): a selection cleared during a handle drag leaves Edit mode unusable until a reload
REPRODUCED on the released code, three ways (output condensed).

- `app.js:2205`: `syncGizmoEnabled` turns the control off when nothing is selected. `TC:730–732`: `onPointerUp` returns at once when disabled, so `dragging` is never cleared. `TC:244`: no later press starts. `app.js:2373` then marks every press `onHandle`, so `app.js:2439` refuses every click; `app.js:3452, 3459` stop the look-drag; `app.js:1950` gives Undo "Finish moving the object first".
- Triggers: Escape mid-drag (`app.js:1646`), another tab removing the dragged object (`app.js:2745–2748`), a disconnect mid-drag (`app.js:2173–2174`).
```
4 Escape    -> selected None | gizmo {'dragging': True, 'axis': None, 'enabled': False, 'attached': None}
6 click the lamp shade -> selected None        7 click the crate -> selected None
8 look-drag 100 px on empty space: camera turned? False
9 Edit off/on, click crate -> selected None
G2 (removed by tab B mid-drag) released; click the lamp shade -> selected None
D2 (disconnected mid-drag) reconnected, Edit on, click the lamp shade -> selected None
```
It belongs in this round because T15 rewrites that Escape line, T17's "mark" relies on the same `dragging-changed(false)` that never arrives, and M-1's one line fixes it: with it, Escape mid-drag and the remote removal both end with `gizmo.dragging False` and the next click selects (run on the released handlers and on the prototype). I did not rerun the disconnect case with the fix; it goes through the same `selectForEdit(null)`.

### S-2 — Should-fix: T17 puts the object back from a press-time record, so another tab's change during a short press is undone on screen only
REPRODUCED (prototype). `PREBRIEF` L470–475, L478: "records the selected node's translation, rotation and scale … puts the three.js object back to those values".

Scenario: press on `crate-01`'s handle; another tab moves the crate; 2 px of travel; release.
```
C  put back from the press-time record (as T17 reads): crate SOM [1, 0.25, -2] | drawn at [1, 0.25, 0]
C  put back from the live SOM node:                    crate SOM [1, 0.25, -2] | drawn at [1, 0.25, -2]
```
The crate stays drawn where it was until its next change, and the next drag starts from the stale position. A behaviour running on the node does the same each tick, because the drag rule's hold now starts 4 px later. Fix: record nothing. Before the gesture begins the SOM node is never written, so it is the record: put back from `selected.translation`, `rotation`, `scale` as they are then.

### S-3 — Should-fix: a short press on a handle selects whatever is behind the handle, the ground or nothing included
REPRODUCED (prototype). `PREBRIEF` L344–347 (SP-L8): "is handled as a click (it selects…)". Today a click on a handle changes nothing (`app.js:2439`).
```
D  short press on the X handle with ground-plane behind it: selected lamp-01 -> ground-plane
D  short press on the Y handle with None behind it:         selected lamp-01 -> None
```
From a walking camera the floor is behind much of every handle, so a press that doesn't travel 4 px (a hesitant grab) now drops the selection or selects the floor. §4's "Stated" list doesn't mention it. Suggested rule, for the operator: a click that began on a handle changes the selection only when what it picks is inside the current selection's top-level object; otherwise it changes nothing. That keeps every case SP-L8 was made for (drilling and siblings through a handle). State whichever rule is chosen, and add it to the harness checks.

### S-4 — Should-fix: T17 doesn't say where "the pointer" is read, and one natural choice loses fast drags
REPRODUCED (prototype, both readings). `PREBRIEF` L473: "while the pointer is within 4 px of the press". `onHandleChange` gets no pointer event; `TC` moves the object from a `pointermove`, and `mousemove` fires after it.
```
F  pointer read in a capture-phase pointermove: one 30 px move then release -> crate SOM [1.2618, 0.25, 0] | undo ['Move “crate-01”']
F  pointer read in a capture-phase mousemove:   one 30 px move then release -> crate SOM [1, 0.25, 0]    | undo []
```
Read in `mousemove`, the position is one event late: a drag that arrives as one move is put back and lost (it isn't a click either). Say it in T17: a capture-phase `pointermove` on `#viewport`, as the `mousedown` at `app.js:2372`. Add the one-move drag to (p15)'s unit test and to the harness.

### S-5 — Should-fix: DEV acceptance step 2 expects the shade to move after the stand was selected
REPRODUCED (prototype). `PREBRIEF` L743–746: "Click the stand once: `lamp-stand` … Drag that arrow up a little: the shade moves, and Undo's tooltip reads “Undo Move “lamp-shade””".
```
S2 "Click the stand once" there -> lamp-stand | gizmo now on lamp-stand
S2 "Drag that arrow up a little" -> shade [0, 1.6, 0] stand [-0.0, 1.0006, -0.0627] | undo ['Move “lamp-stand”']
```
The click moves the handles to the stand, so a correct build fails the step as written. Either drag first, or expect `lamp-stand`.

### S-6 — Should-fix: P0's guard checks the helper's rule, not what the four files run
INFERRED from the text (nothing is implemented). `PREBRIEF` L383–395.

- A shard file that calls the wrong shard (`-3` running `shard(1, 3)`) leaves 17 suites unmeasured with the guard green: the guard compares `shard()`'s outputs with the directory.
- A measure file deleted or renamed does the same: its name is removed from the listing "literally" either way.

Fix: each file takes its list from its own name (`listFor(basename(import.meta.url))`, no literal `k`), and the guard asserts the five measure files exist. Then (p14) gets a third break: one shard file pointed at another's list.

### S-7 — Should-fix: T17 is in no commit and no testable file of §6
CONFIRMED IN THE SOURCE (the pre-brief). `PREBRIEF` L776–785: commit 3 is "T13's and T14's and T15's `app.js` … glue"; commit 5 lists "proofs (p9)–(p14)", without (p15). T17 came in with Rev 1.2 and §6 wasn't updated.

T17 is a small state machine (press, within 4 px, gesture begun, release, selection changed underneath) and the riskiest item here: four of this review's findings are in it. As planned it lives only in `app.js`, testable as lifted text or in the harness. Put it in a pure module (for example `apps/client/src/edit-press.js`), add it to §6's files, and unit-test: no travel, 2 px, one 30 px move, Escape and a removal mid-press, a block starting mid-press.

### Nits
- **N-1, a double-click whose second press travels 4 px or more drags the group.** REPRODUCED: `E double-click, 6 px on the second press -> lamp-01 | lamp SOM [3, 0.0118, 0] | undo ['Move “lamp-01”']`. That is SP-L8 (a) as decided, and it answers "does a double-click ever start a drag of the top group": yes. A cheap guard: a press whose `mousedown` has `detail >= 2` never begins a handle gesture (the `mousedown` fires before the first `objectChange`).
- **N-2, Escape with a duplicated-name parent** (`PREBRIEF` L462–463): "nothing selected" should read `selectForEdit(null)` plus the message. If it meant "unchanged", Escape could never leave that part.
- **N-3, T17 drops today's guard.** `app.js:2221` begins a gesture only when `selected && !editDispatchBlocked()`; L476 should carry it to the new place. A press that is blocked then puts the object back at release, which also closes the hidden offset `app.js:2826` describes.
- **N-4, a re-add or a Duplicate in place under a group replaced by another tab** between the check and the server's answer lands in the new node of that name (the parent is a name on the wire). Narrow. On the accept, check `getNodeByName(name).parent === entry.parent.node` and say so if it isn't.
- **N-5, §4 items with no line in §5:** the `NODE_NOT_FOUND` text; Inspect's Escape; Inspect following a removed part (should-fix 4); the breadcrumb's 7-level cap and whether 7 names of 32 characters fit the panel. A pure `breadcrumbItems(path)` would make the cap testable.
- **N-6, the on-screen hint** (`app.js:652`): "Click to select · Alt-click selects a part · Esc to deselect" is wrong once Escape goes up a level, and never mentions the double-click. No test pins it.
- **N-7, P0 wording.** "Every legitimate message every server suite sends" leaves out messages sent to a child process (`world-total.test.js:547`: the recorder isn't loaded there; they are shallow). "About 200 s longer" (L801): the four files take about 215 s on the host by §2.1's numbers, and the old file's 135 s goes, so about 80 s longer. Each shard could print its elapsed time and fail above a stated budget, so drift shows before the deploy's 180 s does.
- **N-8, a consequence T13 doesn't state:** click and Delete now removes the whole top-level group with no question (W6). In `atrium.gltf` that is `Furniture`, 33 nodes, where it was one bench. Undo brings it back.
- **N-9, small:** `aria-current="location"` fits a path better than `"true"`; the Inspect panel isn't re-rendered on `som:rename` (true of `#ip-name` today, and now of the path row).

## What I checked, in the order asked

1. **T17 and T13.** Findings M-1, S-1 to S-5, N-1 to N-3. What held: the happy path (`A2 double-click on the stand at a Y-handle point, 2 px jitter -> lamp-stand | lamp SOM [3, 0, 0] | undo []`, clicks `detail` 1 then 2); a real drag past 4 px records one Move; the 100 ms throttle only delays the first send and the release still flushes; the look-drag never starts on a handle press (`app.js:3452`). T13 by reading, with the lamp's cases run through the prototype: every §5 case; external content inside a group (the container is the leaf, so Alt and drilling stop at it and a click takes the group); avatars first; Inspect can't reach a hidden part, because `visibleHits` drops any hit with an invisible ancestor (`visibility.js:37–40`) and every level T13, T14 or T15 can select is an ancestor of a visible hit; a duplicated name at a middle level refuses the drill, and Alt still reaches the leaf.
2. **T11's Undo and Redo.** Traced on `edit-undo.js`, not prototyped. The parent handle is the same object as the group's own entry handle and its `members` handle (`handleFor`, L161–165), so the re-pointing at L650–665 carries it through the group's delete and Undo, through a grandparent's, and through Redo of the group's Add. Rename follows by identity. A group removed, or replaced by another tab, refuses. Redo of a Duplicate in place and a sub-group as the part go the same way. Duplicate has no retry (`app.js:3224` is the palette's, 3153 the paste's), so no path re-sends without `parent`. The one way into a wrong node is N-4's race.
3. **`sameCanonical`.** By reading: with refs resolved, children matched by name and the partition compared, two captures are equal exactly when a re-add of either gives the same group apart from child order. Two members swapping names differ (each name's node, id and material are compared). A material changed in one of two sharers differs by value or by partition. I found no false equal.
4. **Copy and the offset.** `/tmp/probes/trs.mjs`, the decomposition as §4 words it on the real `world-matrix.js`: 200,000 unsheared chains (uniform ancestors 1e-3 to 1e3, 30% mirrored, depth 1 to 4), none refused, worst relative miss 1.75e-15; a 90° turn under scale `[2, 1, 0.5]` is accepted; a 1% shear is refused at sizes 1e-6 to 1e3; the smallest shear that passes (ancestor `[1.00002, 1, 1]` over 45°) puts a point 1 m out 1e-5 m off. SP-L4 (b)'s offset over 20,000 sheared, mirrored parents: worst 3.8e-10 m from 1.5 m along world x.
5. **P0.** My timings match §2.1: 51 files 124.0 s, deepest 27 (`subtree-add`); the three left out 61.3, 5.3 and 5.1 s, depth 3. The planned shards from them: 45.3, 50.0 and 39.1 s, `SOLO` 61.3 s. A host would have to be about three times slower to reach 180 s. Finding S-6, nit N-7.
6. **T14 and T15.** Not prototyped (T14), by reading: `textContent` and `shownText` on every name, the rebuild only on a path change, the identity check on a crumb. M-1 and N-2 are T15's.
7. **§5 and §6.** S-5, S-7, N-5. By reading, I found nothing wrong in steps 1 and 3 to 7.

## What I ran (Node v22.23.4, pnpm 10.28.0)

Clone: worked (`git clone`, fetch of `claude/selection-parts`, checkout `3ccc1ad4…`). `pnpm install --frozen-lockfile --ignore-scripts`: 1.1 s. The `better-sqlite3` step: exit 0.

| Command | Result |
|---|---|
| `node devtasks/spike-selection-parts/m2-refs.mjs` | `c:1` before, `c:0` after; `same JSON? false`, as §2.6 |
| `packages/interaction`, `node --test` | 9 pass |
| `apps/client`, the five listed files | 203 pass |
| server `subtree-add.test.js` (alone, `timeout 180`) | 30 pass |
| `depth-times.mjs packages/server` | 51 files, 124.0 s, every status 0, deepest 27 |
| the three left-out suites under the recorder, by hand | 61.3, 5.3, 5.1 s; status 0; depth 3 |
| `devtasks/harness/setup.sh dd2071f9…`, `server.mjs` | built and served; the page boots, no page errors |
| my browser probes `p1`–`p5` (released code and prototype) | as quoted above |
| `trs.mjs` | as item 4 |

Not run: DEV or PROD; Firefox or Safari; a physical double-click (every press was Playwright's, with `click_count` given, so the browser's own counting of `detail` on a pointer-captured handle is untested); the full suites; the fresh agent's probes (not in the repository); the deploy's 180 s rule on the host. Not prototyped: T14, T11's engine changes, `sameCanonical` (items 2, 3 and 6 are by reading). Nothing was pushed or committed; the prototype and probes live in `/tmp` of this session only (attached as an archive).
