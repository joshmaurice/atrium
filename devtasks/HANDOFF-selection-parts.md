# Handoff: `selection-parts`, implemented on `claude/selection-parts`

**Contract:** `devtasks/PREBRIEF-selection-parts.md` FINAL Rev 2 (operator,
2026-11-08, 18:30 PT: "approve").
**Base:** `8ec887ce`, the pre-brief's FINAL commit on this branch. Its code is
`main`'s (`dd2071f9`, the SHA §2's facts were verified at), which is PROD's
and DEV's (`45e6cd00`, `release_status`, 2026-11-08); only `devtasks/`
differs. **Implemented by Claude in the fast lane** (SP-L7 (a)), no
OpenRouter. **Checked by a fresh Claude agent** (§7: one must-fix, three
should-fix, two nits; all taken in commit 6, `a1037f0`). **Reviewed outside**
at `5fe582c9` (§8: APPROVE WITH NITS; the reviewer was Claude, Opus 5.5, given
the Fable prompt; its should-fix and two nits taken in commit 8).

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
| 6 `a1037f0` | the fresh-agent code check's findings (§7): an unnamed group not addressable; the handle release's verdict kept apart from the mouse press (touch); the part glue run in tests; N-4 tested; the crumb's order; `escapeTarget` pure; harness c3–c5 |
| 7 `5fe582c`, `2c69b04` | `devtasks/` only: this file's §7, c3's start; the outside code-review prompt |
| 8 (this commit) | the outside code review's fixes (§8): a touch drag's verdict kept for the tap's click (S-1); rotate and scale put-back tested (N-1); harness c5's touch drags and c6; the pre-brief's Rev 2.1 wording (N-2) |

Code files touched are exactly §6's list (34 files, +2,684 −208), plus the
comment in `test/helpers/depth-recorder.mjs`, a test file under
`packages/server/test/`. No `package.json` or lockfile change.

## 2. Tests
- **All suites, each server file alone under `timeout 180`** (at commit 4,
  `/tmp/sel/full-suites.sh` in the cloud session): **70 suites, 4,591
  passing, 0 failing, 1 named skip** (`apps/client`'s richer-add R7 stated-limit
  test, unchanged). Commit 5 added five tests (the guard's sixth, four T11);
  each touched suite was rerun: **4,596** passing; commit 6 added ten more to
  `apps/client` (1,759, its whole suite rerun): **4,606**. Baseline at
  `45e6cd00`: 65 suites, 4,463.
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
| (p18a) | `partRules` handing glTF nodes straight through, every parent addressable (commit 6) | the lifted `partRules` and `checkDuplicate` tests fail | all |
| (p18b) | `checkDuplicate` without the parent-frame offset | the turned-group Duplicate test fails | all |
| (p18c) | `parentWorldOf` returns null | its lifted test fails | all |
| (p19) | `capture` accepting an unnamed parent | the unnamed-group test fails | all |
| (p20a) | `acceptAdd`'s N-4 note removed | the Duplicate-into-a-replaced-group test fails | all |
| (p20b) | the re-add not re-pointed to where it landed | the Undo-and-Redo-into-the-newer-group test fails | all |

### 2.2 The harness checks (`devtasks/harness/checks/selection-parts/`, on `f0fa9d8`; rerun on `a1037f0`: c1 29, c2 16, c3 30, c4 32, c5 6, **113 PASS, 0 FAIL**)
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
10. **(commit 6) A parent must have a non-empty name** to be addressable, as
    well as being the node of its name: `parent: ''` is dropped by `addNode`
    and read as "no parent" by the server, though the SOM registers an
    unnamed node under `''`. §9.5 S6's "as the server resolves it".
11. **(commit 6, 8) Touch.** The handle release's verdict (`handleClick`: a
    click, or since commit 8 a drag) is kept apart from `pressDown`, because on
    touch the compatibility `mousedown` comes after the release; T17 and SP-L10
    hold on touch for a tap and for a short drag (c5), and Chromium
    counts taps, so a double-tap drills. **SP-L11 on touch is not delivered:**
    the click count arrives only after the release, so a second tap that
    travels 4 px or more could drag. Stated; not in the contract.
12. **`source: null`:** the selection rule treats content as external when
    `source != null` (unchanged, released); the new `ancestors` rule when
    `source` is an own key (the server's S2 refuses any own `source`). A
    container with `source: null` can be drilled into but its parts are
    refused Duplicate as external. Stated, unchanged.

## 5. Not done, or not checked
- **A physical double-click** (the browser's own click counting on a real
  mouse): every press in the harness is Playwright's with `click_count`.
  DEV acceptance is the first real one.
- **Firefox and Safari**; the host's shard timings (estimated from the
  cloud's, ×1.1).
- **An old server** (T7) with a part's Duplicate and Undo: by reading, a
  part with no children uses only `parent`, which every server since
  edit-plumbing honours; the pure tests run with `trees: false` too.
- **Pen input** (touch and mouse were run); SP-L11 on touch (§4 item 11).
- **A Fable code review:** the outside review was by Claude (Opus 5.5), which
  executed everything (§8); the passdown's preference was Fable.

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

## 7. The fresh-agent code check (of `8ec887ce..a983b613`)
A fresh Claude agent that hadn't written the code read the whole diff against
§4–§6 and r163's `TransformControls.js`, ran the suites in a scratch copy
(`apps/client` 1,749, `packages/client` 753, `interaction`, the server's new
and measure files alone; the shards 48, 55, 33, 61 s, deepest 27), ran
harness c1–c4 (all pass), wrote browser probes (`modes.py`, `touch.py`,
`turned.py`) and node probes (`unnamed-group.mjs`), and made 17 breaks in its
copy, each rerun and restored. Claude reproduced each finding before taking
it. **All taken, in commit 6:**
- **must-fix 1:** a part of an unnamed group passed every check, but `''`
  can't travel as `parent`: Undo restored it at the top level, Duplicate put
  the copy there. Reproduced with the real engine, client and server
  (`unnamed-group.mjs`). The parent must have a non-empty name (`partRules`,
  `capture`, `checkEntry`); proof (p19); the test harness's server now
  follows `if (parentName)` as `world.addNode` does.
- **should-fix 2:** on touch the compatibility `mousedown` comes after the
  release, so SP-L10's flags on `pressDown` were lost: a tap on a handle over
  the floor selected `ground-plane`. Reproduced (`touch.py`); fixed by
  `handleClick` (§4 item 11); harness c5.
- **should-fix 3:** `partRules`, `parentWorldOf` and the offset in
  `checkDuplicate` could be broken with every test green (the fixtures'
  groups have no rotation or scale). Now lifted and run on a turned, scaled
  group; proofs (p18a)–(p18c); c4 gains the turned lamp (the copy 1.5 m along
  world x, the stand pasted at world height 1.5 with the lamp's rotation and
  scale).
- **should-fix 4:** neither half of N-4 was tested; two tests, proofs (p20a),
  (p20b).
- **nits:** a crumb checks E7 before identity and, when stale, re-renders the
  current selection's path; `escapeTarget` moved to `edit-selection.js`,
  pure and tested; c3 is a real gesture run (Escape back up between
  double-clicks) and its hidden-part check expects the ground exactly; the
  `source: null` inconsistency stated (§4 item 12).

**Confirmed sound by the check:** T17 in rotate and scale modes; Escape
mid-press within the slop; c1–c4; ten more breaks the tests catch (the
canonical traversal order, the partition, `forced`, (p15), the travel on x
only, Inspect's `current`, Inspect's removal by name, the crumb's identity,
`renderPath` rebuilding every call, SP-L10 comparing nodes); P0's guard and
55 suites measured; the handoff's §4 items against the code; the parent
handle through a rename, the group's and a grandparent's Delete and Undo.
**Not checked by it:** pen, Firefox, Safari, a physical mouse, a double-tap
on touch, c4 against a broken worktree, the server's hostile suites, the
untouched packages' suites, the host's timings.

## 8. The outside code review (of `5fe582c9`)
`devtasks/REVIEW-selection-parts-code-claude.md`: **APPROVE WITH NITS**, the
reviewed SHA in its first line. **The reviewer was Claude (Opus 5.5)**, given
the prompt written for Fable; it says so. It cloned, ran every listed test
file (1,759 in `apps/client`, the server's files alone, the four shards: 48,
54, 32, 61 s, deepest 27), built the harness for `5fe582c9` and ran c1–c5
(113/113), and wrote its own probes: `touchdrag.py` (CDP touch events),
`modes.py` (rotate and scale, snaps), an Undo probe on a real SOM. It
re-ran proofs (p13) and (p9d). Claude reproduced S-1 with a probe of its own
(`/tmp/sel/probes2/touchdrag.py`) before taking it. **Taken, in commit 8:**
- **S-1, should-fix (on PROD today, narrowed but not closed by commit 6):** on
  touch a 6–14 px drag on a handle moved the object (correct) and then the
  tap's `click` selected the floor or nothing, because a drag left no verdict
  and the touch `pressDown` comes after the release. Reproduced: 6 and 10 px
  → `ground-plane`, 14 px → nothing, each with a Move. Fixed by the
  reviewer's two lines (a drag's verdict, `{ drag: true }`, and the click
  returning on it); after it every travel keeps `lamp-01` with one Move. A
  lifted test and proof (p22); c5's 6 and 10 px touch drags, which fail
  without the fix (rerun on the harness worktree, then restored).
- **N-1, nit:** the put-back of rotation and scale had no test (removing it
  left every test green). Three lifted tests in rotate and scale modes; proof
  (p21); harness c6 (rotate and scale, snaps off and on: a 2 px press draws
  and records nothing, a 40 px drag records one Rotate or Scale, drawn as the
  SOM, snapped to 15° with the snap on).
- **N-2, nit:** DEV step 2's "drag its up arrow a little" could be a click
  now; the pre-brief's Rev 2.1 says "a few centimetres on screen".

Not taken: nothing. **Confirmed sound by the review:** T17 against r163's
TransformControls (the put-back idempotent, the capture listeners first); T18's
re-entrancy and the click after it; no undo during a press; the hold released
on a removal; Undo of parts through repeated part and group deletes, a
sub-group under a renamed `Furniture`, `trees: false`; `NODE_NOT_FOUND`'s text;
the policy, E7 at every level, the breadcrumb's text handling; the
decomposition and the offset; P0's guard (a stray `-5` or `-01` file fails
it). **Not run by it:** a physical mouse or touchscreen, Firefox, Safari, pen,
DEV, PROD, the full server suite, the host's timings.
