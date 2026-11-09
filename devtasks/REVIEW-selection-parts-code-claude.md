5fe582c9303a8da77c673558804992e560bf464c

# Atrium `selection-parts`: outside code review of the implementation

**Verdict: APPROVE WITH NITS.** One should-fix, which **predates this round** (PROD has it today) and which this round narrowed but didn't close. It's four lines in `app.js`, already in §6's list, and I'd take it before the PROD deploy. There's no must-fix. The clone worked. Every listed test file passes, and so do the round's five harness checks (113/113). My own probes (the real page and server through Playwright, and the Undo engine on a real SOM) didn't break any claim in the handoff except the touch line in §4 item 11.

Reviewed: `claude/selection-parts` at `5fe582c9…` against base `8ec887ce` (`git diff 8ec887ce HEAD -- . ':!devtasks'`: 34 files, +2,834/−208). Contract: `PREBRIEF-selection-parts.md` FINAL Rev 2, §4 (P0, T11, T13–T18), §5 and §6. The reviewer is Claude (Opus 5.5), not Fable. I read the prompt as addressed to me.

## Findings

### S-1: Should-fix. On touch, a short drag on a handle moves the object and then selects whatever is behind the finger
REPRODUCED on the reviewed commit and on the base, and CONFIRMED IN THE SOURCE.

- `apps/client/src/app.js:2318–2340` (`onHandleDragging(false)`): `handleClick` is set only when the release is a click. A press that became a drag leaves it `null`.
- `app.js:2576–2584` (the click): a drag is refused only through `down?.onHandle`. On touch, `pressDown` comes from the compatibility `mousedown`, which arrives after the release (handoff §4 item 11), so `onHandle` is `false`. Chromium still delivers a tap `click` for a touch that travelled less than its tap slop.

Scenario: Edit mode in the commons, `lamp-01` selected, a finger drags its Y handle 6–14 px over the floor. T17 begins the gesture at 4 px, the lamp moves and "Move “lamp-01”" is recorded. Then the tap's `click` runs as an ordinary click: it selects `ground-plane`, or deselects when the release is over the sky, and SP-L10 isn't consulted because `fromHandle` is null. On mouse the same drag is correctly no selection.

Probe (`touchdrag.py`, Playwright, `has_touch`, CDP `Input.dispatchTouchEvent`, the point found with `sp.py`'s `point_over(..., behind='ground-plane')`):

```
reviewed 5fe582c9            selected       lamp-01          undo
touch drag  2 px           lamp-01        [3, 0, 0]        []                 ← the round fixed the tap
touch drag  6 px           ground-plane   [3, 0.0094, 0]   ['Move “lamp-01”']
touch drag 10 px           ground-plane   [3, 0.0157, 0]   ['Move “lamp-01”']
touch drag 14 px           None           [3, 0.0218, 0]   ['Move “lamp-01”']
touch drag 30 px           lamp-01        [3, 0.046, 0]    ['Move “lamp-01”']  (no click: past the tap slop)
base 8ec887ce: 2 px → ground-plane and a Move; 6, 10, 14, 30 px as above
```

So it isn't a regression. But handoff §4 item 11's "T17 and SP-L10 hold on touch (c5)" is true for a tap only, and c5 tests only taps. Fix: keep a drag's verdict too, for the click that may follow.

```js
// onHandleDragging(false), in the `if (activeGesture)` branch, after hold.clear():
if (released.handle) handleClick = { drag: true }
// the viewport click, right after `handleClick = null`:
if (fromHandle?.drag) return
```

I applied exactly this in the harness worktree. The probe then keeps `lamp-01` selected at every travel, with one Move each, and c1 (29), c2 (16) and c5 (6) still all pass. A T18-ended drag isn't affected (its `release()` has `handle: false`), and on mouse it duplicates what `onHandle` already does. `selection-parts-wiring.test.js:218` pins the click handler's text and needs that one line added. Worth a c5 case: a 6 px and a 10 px touch drag on a handle over the floor, expecting the selection kept and one Move.

### N-1: Nit. The put-back of rotation and scale (T17 in rotate and scale modes) has no committed test
REPRODUCED. I removed the `quaternion` and `scale` lines from `putBackHandle` (`app.js:2300–2305`). The whole `apps/client` suite still passed (1,759, 0 fail), and none of c1–c5 uses rotate or scale mode. The lifted-handler tests (`selection-parts-wiring.test.js:105`, `move()`) only ever move `position`. The behaviour itself is right: my `modes.py` (crate-01, Rotate and Scale, snaps off and on) shows a 2 px press drawing nothing mid-press or after and recording nothing. A 40 px drag records one Rotate or Scale, with drawn equal to the SOM, and the snaps applied (15°, 0.1). The fresh agent ran a `modes.py` too (§7), but it isn't in `checks/selection-parts/`. Committing it, or adding a quaternion and a scale move to `move()`, would pin it.

### N-2: Nit. DEV acceptance step 2's "drag its up arrow a little" can now read as a failure
CONFIRMED IN THE SOURCE (`PREBRIEF-selection-parts.md:912`). Under 4 px a handle press is a click and nothing moves (T17, stated). An operator who drags "a little" may see no move and no "Undo Move". Suggest "drag its up arrow a few centimetres on screen".

## What I checked, in the order asked

1. **The press and the drag's end (T17, T18, SP-L8–L12).**
   - Read against r163's `TransformControls.js`:
     - `dragging` goes true at the canvas `pointerdown` even when the plane misses.
     - `objectChange` fires on every drag move.
     - `onPointerUp` returns early when disabled, which is SP-L12's mechanism.
     - translate, rotate and scale all recompute from `_positionStart`, `_quaternionStart` and `_scaleStart`, so the put-back is idempotent and never accumulates.
     - The viewport's capture-phase `pointerdown` and `pointermove` run before the canvas's own listeners, and still see moves under the control's pointer capture.
   - **T18:**
     - Re-entrancy is safe: `dragging` is already false when `dragging-changed` fires, so the nested `syncGizmoEnabled` → `endHandleDrag` returns.
     - After Escape mid-drag, the still-attached `_onPointerMove` can't move the new object (`dragging === false`), and the real release fires no event.
     - The click that follows is refused by `pressDown.onHandle`.
     - A rename committed by the field's blur at `mousedown` now ends the press instead of stranding it.
   - **Undo during a press:** `isDragging` (`app.js:1973`) refuses an undo during any press, so no undo starts mid-press.
   - **A removal mid-drag:** the drag rule's hold is released through `nodeRemoved` → `maybeIdle` → `hold.released`.
   - **A blocked drag:** a drag held by a block all the way to its release falls to `isSelectClick`'s travel test, so it doesn't select.
2. **Undo and Redo of parts.**
   - `handleFor` is memoized per node and `repoint` re-keys it, so a part's parent handle is the same object as the group's own entry handle and its members' handles. It follows a rename, the group's own Delete and Undo, and a grandparent's restore.
   - Probes (node, real `space.gltf` and `atrium.gltf`, the test file's server stand-in), all passing:
     - Part Delete, group Delete, then Undo, Undo, Redo, Redo, Undo, Undo: the shade ends under the third lamp object, with no message.
     - `Bench-NE` (a sub-group) deleted, `Furniture` renamed by another tab, then Undo: it goes back under `Furniture-2` with its members.
     - `trees: false`: a leaf part restores under its group, and a sub-group's capture fails, so its Delete asks.
   - `failEntry`'s `NODE_NOT_FOUND` matches the server's text (`session.js:1559`).
   - Duplicate's add is never retried through the palette path, so it can't lose its `parent`.
   - I re-ran proofs (p13) (exactly the lamp's older-entry test fails) and (p9d) (10 of 19 fail). I found no path that restores a part at the top level or into the wrong node.
3. **Policy, breadcrumb and Escape.**
   - `resolveScopedSelection` follows T13's four steps.
   - External content goes to the policy as the leaf, so Alt and drilling stop at the container.
   - Every result lies on the hit's ancestor chain, so the avatar check on the hit and its ancestors covers it.
   - E7 is checked on the hit and on the result (`pickEditSelection`), on a crumb (before identity) and on Escape.
   - The crumb names are set through `shownText` and `textContent`.
   - The canvas has `tabindex="0"` (`Stage.js:71`), so focus returns after a crumb click.
4. **Copy and Duplicate of a part.**
   - `decomposeTRS` uses the standard row and column convention, and the mirror negates x before dividing.
   - The shear test compares the recomposed 3×3 relative to each column, and the members below keep their local TRS (correct once the root's world matrix is reproduced).
   - A top-level node is kept verbatim (`parentWorld` null).
   - `parentFrameOffset` = `inv(L)·[1.5, 0, 0]`, so the copy lands at world + [1.5, 0, 0].
   - `partRules` matches glTF nodes through `n._node === g`.
5. **P0.**
   - The four shards: 48, 54, 32 and 61 s here, deepest 27, 11, 7 and 3, so 27 overall (`subtree-add`'s add), as before.
   - The guard lists `test/` itself and names every exclusion literally.
   - A stray `message-depth-measure-5.test.js` or `-01` would be dropped by the helper's regex but appear in the guard's `expected`, so the guard fails.
   - The four files are identical text.
   - No server test lives in a subdirectory (the deploy's glob is `test/*.test.js`).
6. **Tests and proofs.**
   - §5's T11, T13–T15 and T17 items each have a test (the Inspect removal and the behaviour-ref cases included).
   - c3 runs six of its ten listed parts, the ones on screen, as the handoff says.
   - The DEV steps name a control and a gesture throughout, apart from N-2.

## What I ran (Node v22.23.4, pnpm 10.28.0, Chromium 153 headless through Playwright)

Clone: worked (`git clone`, checkout `5fe582c9…`). `pnpm install --frozen-lockfile --ignore-scripts`, then `npm run install` in better-sqlite3: OK.

| Command | Result |
|---|---|
| `packages/interaction` `node --test` | 23 pass |
| `packages/client` `selection-parts-client.test.js` | 3 pass |
| `apps/client` `tests/*.test.js` | 1,759 pass, 1 skip (richer-add R7), 0 fail |
| server `selection-parts.test.js` | 4 pass |
| server `message-depth-shards.test.js` | 6 pass |
| server `message-depth-measure-1` / `-2` / `-3` / `-4` (each alone) | pass: 48, 54, 32, 61 s; deepest 27, 11, 7, 3 |
| harness `c1`–`c5` (`setup.sh 5fe582c9`) | 29, 16, 30, 32, 6 = **113 PASS, 0 FAIL** |
| my `touchdrag.py`, reviewed and base | S-1 on both (above) |
| my `touchdrag.py` + c1, c2, c5 with S-1's fix | all pass, S-1 gone |
| my `modes.py` (rotate and scale, snaps off and on) | 20 PASS |
| my `undo-probe.test.mjs` (3 tests) | 3 pass |
| breaks: put-back without rotation and scale (N-1); (p13); (p9d) | 0 fail; 1 fail; 10 fail |

Not run: a physical mouse or touchscreen (every press was Playwright's or CDP's); Firefox and Safari; pen; DEV and PROD; the full server suite beyond the files above; the host's shard timings. I'm not reporting any of those as passing. Every break and fix was restored (`git diff` clean in both trees). The probes were kept outside the repo, and nothing was committed or pushed.
