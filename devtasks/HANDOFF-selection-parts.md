# Handoff: `selection-parts`, implemented on `claude/selection-parts`

**Contract:** `devtasks/PREBRIEF-selection-parts.md` FINAL Rev 2 (operator,
2026-11-08, 18:30 PT: "approve").
**Base:** `8ec887ce`, the pre-brief's FINAL commit on this branch. Its code is
`main`'s (`dd2071f9`, the SHA §2's facts were verified at), which is PROD's
and DEV's (`45e6cd00`, `release_status`, 2026-11-08); only `devtasks/`
differs. **Implemented by Claude in the fast lane** (SP-L7 (a)), no
OpenRouter. **Not yet checked** by a fresh agent or reviewed outside (§7).

The decisions it implements: SP-L1 (a) a double-click drills; SP-L2 (b) a
click stays at the working level; SP-L3 (b) Escape goes up first; SP-L4 (b) a
part's copy 1.5 m along world x; SP-L5 (a) groups compared canonically; SP-L6
(b) the depth measurement in four files; SP-L8 (a) a short press on a handle
is a click; SP-L9 (a) Escape mid-drag keeps the move; SP-L10 (a) a click from
a handle changes the selection only within the group; SP-L11 (a) a
double-click's second press never drags; SP-L12 (a) the stuck-handle PROD
bug fixed here.

## 1. The commits
| Commit | What (contract items) |
|---|---|
| 1 `f5a80e3` | P0: `test/helpers/depth-measure.mjs` (the old test body as `measureFiles`, `serverTestFiles`, `shard`, `listFor`), `message-depth-measure-{1,2,3,4}.test.js` (one identical file each, its list from its own name), the guard `message-depth-shards.test.js`, the old file removed, two comments (`message-depth.js`, `depth-recorder.mjs`) |
| 2 `4cf3c3a` | T13: `topLevelAncestor`, `childToward`, `resolveScopedSelection` in `@atrium/interaction` (the default policy unchanged); `resolveEditSelection` hands external content to the policy as the leaf and passes `current` and `drill`; T14's pure `selectionPath` and `breadcrumbItems` |
| 3 `3d6d54e` | T17's `edit-press.js`; T13's, T14's, T15's, T17's and T18's `app.js` and `index.html` glue (the click handler, the breadcrumb rows and their writer, Escape, `endHandleDrag` in `selectForEdit` and `syncGizmoEnabled`, the hint lines, Inspect's identity-based removal and its rename re-render); the two wiring tests §5 named |
| 4 `f0fa9d8` | T11: `addNode(d, { parent })`; `part-transform.js`; the `ancestors`, `group` and `shear` reasons and the offset vector (`edit-duplicate.js`); parent handles, the parent checks and messages, `sameCanonical` (`edit-undo.js`); Copy's world placement and `partCopyProblem` (`copy-paste.js`); their `app.js` glue; the server test with `parent`; three more wiring tests that pinned today's calls |
| 5 `c3a83f0` | the harness checks (`devtasks/harness/checks/selection-parts/`); the guard's identical-files rule (for proof (p14c)); three more T11 tests §5 listed |

Code files touched are exactly §6's list (34 files, +2,684 −208), plus the
comment in `test/helpers/depth-recorder.mjs`, a test file under
`packages/server/test/`. No `package.json` or lockfile change.

## 2. Tests
- **All suites, each server file alone under `timeout 180`** (at commit 4,
  `/tmp/sel/full-suites.sh` in the cloud session): **70 suites, 4,591
  passing, 0 failing, 1 named skip** (`apps/client`'s richer-add R7 stated-limit
  test, unchanged). Commit 5 added five tests (the guard's sixth, four T11);
  each touched suite was rerun: **4,596** passing. Baseline at `45e6cd00`: 65
  suites, 4,463.
- **The depth measurement (P0), cloud times, each file alone under `timeout
  180`:** at commit 1, 44.7, 50.1, 39.9 and 61.4 s (deepest 11, 8, **27**, 3:
  the overall deepest is 27, `subtree-add.test.js`'s add, as before); at
  commit 4, with the round's new suites in the shards, 53, 62, 35 and 62 s.
  The host ran the old single file in 134.6 s against the cloud's 122.7 s
  (about 10% slower): every shard stays well inside 180 s. The deploy's
  server suite now runs every suite once more under the recorder: about 80 s
  longer than before (§6 of the pre-brief).
- **First failures on today's code** (each new check before its code):
  `message-depth-shards.test.js` (`ERR_MODULE_NOT_FOUND`: no helper);
  `scopedSelection.test.js` (no `childToward` export); `selection-parts-selection.test.js`
  (no `BREADCRUMB_MAX_LEVELS`); `edit-press.test.js` (no module);
  `part-transform.test.js` (no module); `selection-parts-client.test.js` (2
  of 3 failed: `parent` not on the wire, the echo not under the parent);
  `selection-parts-undo.test.js` (no `GROUP_NOT_ADDRESSABLE`);
  `selection-parts-copy.test.js` (no `partCopyProblem`); the lifted-handler
  wiring tests (no `endHandleDrag`, `putBackHandle`). The server test
  `selection-parts.test.js` passes on today's server, as T16 says it must
  (`parent` already travels; it is a test of that, not a change).
- **Wiring tests rewritten with the code, not kept green** (they pinned
  today's call text; §5 named the first two): `app-wiring.test.js`
  (`pickEditTarget(e, { current: selected })`; the structural re-add's and
  Duplicate's `addNode` with `parent`), `copy-objects-wiring.test.js`
  (Inspect's `current: inspected`, `pickEditTarget`'s defaults, `copyHint`
  and `copyNode` with the part rules), `subtree-add-wiring.test.js`
  (`prepareDuplicate`'s `offset` and part rules). And three rule tests §4
  named: `edit-duplicate.test.js` rules 2 and Y2, and
  `subtree-add-duplicate.test.js`'s "a part is still refused parent".

### 2.1 The proofs (each break made from a saved copy, the named tests seen failing, the file restored; `/tmp/sel/proofs/run.py`)
| Proof | Break | Named tests under the break | Restored |
|---|---|---|---|
| (p9) | Copy ignores `parentWorld` | `selection-parts-copy`: 4 of 7 fail (the world placement, Paste's 3×3 and y, the mirrored case, the shear) | 7/7 |
| (p9b) | every re-add sends `parent: null` | `selection-parts-undo`: 8 of 15 fail (the shade back at the top level, the Redo, the rename…) | 15/15 |
| (p9c) | `acceptAdd` records no parent | the Redo-of-Duplicate test fails | 15/15 |
| (p9d) | a Delete's parent read in `acceptDelete` | 9 of 15 fail (the dispose comes first: `null`) | 15/15 |
| (p11) | a single click drills | "a single click inside the current selection keeps it" fails | 14/14 |
| (p12) | step 4 back to `nearestNonMeshAncestor` | 3 policy tests and `resolveEditSelection`'s Furniture test fail | all |
| (p13) | the remove check back to `sameDescriptor` | the lamp's older-entry test fails | 15/15 |
| (p14a) | the shard rule drops a file | the guard's coverage test fails | 6/6 |
| (p14b) | `serverTestFiles()` widened to drop `activate.test.js` | the guard's coverage test fails | 6/6 |
| (p14c) | `-3` names `-1`'s list | the guard's identical-files test fails | 6/6 |
| (p15) | `edit-press.js` begins at the first change | `edit-press`: 7 of 14 fail; the lifted-handler tests: 4 of 20 fail; **harness `c1.py`: 14 FAIL** (each jitter double-click records "Move “lamp-01”" and doesn't drill) | all |
| (p16) | `endHandleDrag` returns at once | the T18 wiring tests fail (2); **harness `c2.py`: the removal and disconnect checks fail** (the handles stranded); see §4 item 1 | all |
| (p16b) | (p16) and a begun press allowed to begin again | **harness `c2.py`: Fable's M-1 exactly**: Escape mid-drag moves `lamp-01` to `[0, 1.6107, 0]`, on the server too, and records "Move “lamp-01”" | all |
| (p17) | SP-L10's line removed | its wiring test fails; **harness `c1.py`**: a short press on the handle over the floor selects `ground-plane` | all |

### 2.2 The harness checks (`devtasks/harness/checks/selection-parts/`, on `f0fa9d8`)
Real mouse events through Playwright (Chromium, SwiftShader), `click_count`
on every press. **c1: 29 PASS** (the lamp's gestures, jitter 0/1/2 px, 6 px,
Escape ×3, SP-L10 over the floor and empty space, a 25 px and a one-move 30
px drag recording one Move each, S-2). **c2: 16 PASS** (T18: Escape
mid-drag, lamp-01 unmoved in the SOM, on screen and on `/__doc`, one Move of
the shade; a remote removal and a disconnect mid-drag, the next click
selecting). **c3: 21 PASS** (Furniture: a click, a triple-click, the
breadcrumb, six double-clicks drilling one level each and moving nothing;
Inspect as a visitor, the hidden stand unreachable). **c4: 27 PASS** (the
shade's and Bench-NE's Duplicate, Undo, Redo, Delete, Undo, Redo through the
panel's buttons, each on `/__doc` under its parent; the copy 1.5 m along
world x; the stand's Copy and Paste at the top level at its world height).
An earlier smoke on commit 3 showed the same for the gestures.

## 3. What was built, where
- **`packages/interaction/src/selectionModel.js`**: `topLevelAncestor`,
  `childToward`, `resolveScopedSelection` (T13's four steps); `index.js`
  exports them. The SOM Inspector and the playground keep
  `resolveSelectionRoot`.
- **`apps/client/src/edit-selection.js`**: `resolveEditSelection` (avatars
  first, external content as the leaf, `current`/`drill` through);
  `selectionPath`, `breadcrumbItems` (`BREADCRUMB_MAX_LEVELS` 7,
  `BREADCRUMB_NAME_MAX` 32).
- **`apps/client/src/edit-press.js`** (new): `createHandlePress()` with
  `down`, `grab`, `count`, `move`, `grabbed`, `change` (`'put-back' | 'begin'
  | 'drag'`), `begin`, `release` (`{ click, handle, forced? }`), `reset`.
- **`apps/client/src/part-transform.js`** (new): `multiply`, `linear`,
  `inverse3`, `apply3`, `decomposeTRS`, `partWorldTRS` (`shear`,
  `transform`), `parentFrameOffset`, `SHEAR_TOLERANCE` 1e-5.
- **`apps/client/src/edit-duplicate.js`**: `parent` reason gone; `ancestors`,
  `group`, `shear` added; `duplicateRuleProblem`'s `isExcluded` and
  `parentAddressable`; `buildDescriptor`'s `offset` (0, a number, or a
  vector); `prepareDuplicate`'s `offset`.
- **`apps/client/src/edit-undo.js`**: `GROUP_NOT_ADDRESSABLE`; `sameCanonical`
  (exported); `registerAdd`'s `expectParent`; every structural entry's
  `parent` handle; `checkEntry`'s parent check ("removed", "replaced
  elsewhere"); `failEntry`'s `NODE_NOT_FOUND` ("renamed or removed");
  `completeAccepted`'s N-4 note.
- **`apps/client/src/copy-paste.js`**: `copyObject`'s `parentWorld` and part
  rules; `partCopyProblem` for the hint.
- **`packages/client/src/AtriumClient.js`**: `addNode(descriptor, { parent })`.
- **`apps/client/src/app.js`**: the scoped pick in both modes; the handle
  press (`handlePress`, `putBackHandle`, `endHandleDrag`, the capture-phase
  `pointerdown`/`pointermove`); SP-L10 in the click; the breadcrumb
  (`renderPath`, `wireCrumbs`); `escapeTarget` and Escape's two modes;
  `partRules()`, `parentWorldOf()`; Duplicate's `parent`, offset and
  `expectParent`; the hint lines; Inspect's removal by identity and its
  rename re-render. **`apps/client/index.html`**: `#ep-path`, `#ip-path`, the
  crumb styles.

## 4. Choices the contract left open, and where the code differs from its words
1. **(p16)'s harness half doesn't move the lamp on its own.** §5 says T18
   removed makes the Escape-mid-drag check move the lamp. It doesn't: once a
   press has begun a gesture, `edit-press.js` answers `'drag'`, never
   `'begin'`, for the rest of that press, so when the handles move to
   `lamp-01` mid-drag (T18 gone) its changes are put back and nothing is
   sent. Two layers (the passdown's lesson 5); (p16b) breaks both and shows
   M-1 exactly. T18 is still what keeps the handles from being stranded
   (SP-L12): (p16) fails those checks.
2. **`edit-press.js`'s method names** differ from §4's sketch (`press`,
   `pointer`): the press's position comes from a capture-phase `pointerdown`
   (`down`), because the handles start their drag on `pointerdown`, before
   `mousedown`; the click count from `mousedown` (`count`), because
   `pointerdown`'s `detail` is 0 in Chromium. The first handle change comes
   after both.
3. **The `ancestors` reasons:** a part of externally loaded content is
   refused with `external`'s text, as §4 says; one under an excluded ancestor
   with "Parts of an avatar can’t be duplicated" (the contract named no text).
4. **The breadcrumb's separator** is a `›` in an `aria-hidden` span between
   items; the current item is a span with `aria-current="location"` and its
   own title. A crumb's click blurs the button and focuses the canvas (the
   movement keys need `e.target === canvas`).
5. **Inspect's click re-renders only when the selection changes** (`if (node
   !== inspected) inspectSelect(node)`): a click inside the current selection
   is a no-op, as in Edit. The Inspect status line is cleared either way.
6. **Escape in Inspect with a duplicated-name parent** writes the message to
   `#ip-status` (Inspect has no error line).
7. **The guard gained an identical-files rule** (the four measure files are
   the same text) so that (p14c), "one shard file pointed at another's list",
   has something to fail: the file name decides the list, so a file can only
   run another's by naming it literally.
8. **`sameCanonical` falls back to `sameDescriptor`** for anything that isn't
   a descriptor object; a ref out of range is left unresolved (the server's
   rule refuses those, so a capture never has one).
9. **N-4's note** is shown for a Duplicate in place only when `expectParent`
   was given (the app gives it for every Duplicate: the original's parent or
   null), and for a re-add when the entry has a parent.

## 5. Not done, or not checked
- **A physical double-click** (the browser's own click counting on a real
  mouse): every press in the harness is Playwright's with `click_count`.
  DEV acceptance is the first real one.
- **Firefox and Safari**; the host's shard timings (estimated from the
  cloud's, ×1.1).
- **An old server** (T7) with a part's Duplicate and Undo: by reading, a
  part with no children uses only `parent`, which every server since
  edit-plumbing honours; the pure tests run with `trees: false` too.
- **The fresh-agent code check and the Fable code review** (SP-L7 (a)): next.

## 6. Release
- A client round with server **test** files: **DEV restarts** at the deploy
  (files under `packages/server/`), so acceptance needs a hard reload in
  every tab. No `package.json` or lockfile change; no stored data changes
  shape; no `p6` run is needed (§6 of the pre-brief).
- **The release notes name SP-L12's fix:** Escape, another tab's removal or a
  disconnect during a handle drag no longer leaves the handles stuck until a
  reload.
- **A rollback** stores nothing to undo: a part added in place is an ordinary
  node under its parent.
- The deploy's server suite takes about 80 s longer (the four measure files).
- DEV acceptance: §5 of the pre-brief, steps 1–7, and step 8 on PROD.
