# Passdown 2026-11-08: `selection-parts` shipped to PROD (`331e4aed`)

This supersedes `Atrium-Passdown-2026-11-08-subtree-add-shipped.md` as the
starting point. Read this file first. That passdown's lessons (§3), and the
host, connector and convention notes of `Atrium-Passdown-2026-11-06-richer-add-shipped.md`
(§3, §4), still hold; this file adds to them.

**First instruction for the next session's Claude:**
1. Clone the repo (`add_repo` `joshmaurice/atrium` with access `push`, clone to
   `/home/claude/atrium`) and read this file.
2. **There is no decided next round.** §5 lists the candidates; the operator
   picks. The natural next one is grouping and ungrouping in the Edit panel
   (a `parent` change on a live node), which this round's parts make useful.
3. **Use the `atrium-ops` connector** for board, release, log and git state
   (read-only). Check DEV's actual SHA with `release_status` before reading an
   acceptance as done.
4. The release rule, cost rule, host-command rule (no leading spaces, real
   paths) and the review-SHA rule are unchanged.

## 1. Where things stand
| | |
|---|---|
| PROD, MAIN, DEV | **`331e4aed287fba4543cf4a203d73cbaecb71aa9c`**, state `COMPLETE` (2026-11-08, 21:09 PT). PROD serves the same `app.js` as DEV (`d8a71eb2d8d6`). MAIN fast-forwarded `dd2071f..331e4ae`; the DEV gate merged nothing |
| The round | `selection-parts`: a click selects the top-level object, a double-click goes one level deeper, a click stays at the working level, Alt goes to the part, a breadcrumb in the Edit and Inspect panels, Escape goes up a level. A short press on a move handle is a click; a handle drag ends before the selection changes. A **part** can be duplicated in place, deleted and undone back into its group, redone, and copied out with its world placement. The depth measurement is four files |
| The contract | `devtasks/PREBRIEF-selection-parts.md` FINAL **Rev 2.1** (Rev 2 approved 18:30 PT; 2.1 one DEV step's wording after the code review) |
| The record | `devtasks/HANDOFF-selection-parts.md`: commits, tests, first fails, the proofs (§2.1), the harness checks (§2.2), departures (§4), the fresh check (§7), the outside review (§8), the release (§9) |
| Reviews | design: a fresh-agent check of Rev 1.1 (2 must-fix), **Fable** of Rev 1.2 (`REVIEW-selection-parts-rev1.2-fable.md`, CHANGES REQUESTED: 1 must-fix, 7 should-fix); code: a fresh-agent check (1 must-fix, 3 should-fix), an outside review of `5fe582c9` (`REVIEW-selection-parts-code-claude.md`, **APPROVE WITH NITS**; **the reviewer was Claude (Opus 5.5), not Fable**, given the Fable prompt). Every finding taken, each reproduced first |
| Tests | 70 suites, **4,609 passing, 0 failing, 1 named skip** (richer-add R7, unchanged); 4,463 at `45e6cd00`. 21 proofs (handoff §2.1). Harness `checks/selection-parts/c1`–`c6`: **135 PASS** on `dbf9338` |
| DEV acceptance | §5 steps 1–7 passed on `331e4aed` (the operator, 20:58 PT: "All looks good"), the first real-mouse double-clicks. **Step 8 (PROD): passed** (21:09) |

### 1.1 Facts found this round
- **The move handles cover a group's parts on screen** (the group's origin is at
  its base): with `lamp-01` selected its Y arrow lies over the stand. A press on
  a handle is a drag at once and its first send goes after 100 ms, so before
  SP-L8 a shaky double-click moved the group (0.1 m, recorded).
- **`TransformControls` (r163) keeps its drag across `attach()`**, and its
  `onPointerUp` returns when disabled, so a selection cleared mid-drag left the
  handles stuck until a reload. **That was on PROD**; fixed here (T18, SP-L12).
- **Chromium's event order:** the handles start their drag on `pointerdown`,
  whose `detail` is 0; `mousedown` carries the click count. **On touch the
  compatibility `mousedown` comes after the release**, and a tap's `click`
  still follows a short drag.
- **Playwright's `mouse.down()` sends `detail` 1** unless given `click_count`.
- **An unnamed node is registered under `''`** in the SOM, but `''` can't travel
  as `parent` (the client drops it, the server reads it as none).
- **The deploy picks up new `packages/server/test/*.test.js` files with no host
  change**, and any file under `packages/server/` restarts DEV.
- **The four depth-measure files** took 53, 62, 35 and 62 s in the cloud with this
  round's suites; on the host each passed the deploy's 180 s per file (exact
  host times aren't in the service logs). Deepest message still 27.

## 2. What the round changed (for the next pre-brief's author)
- **Selection** (`packages/interaction/src/selectionModel.js`):
  `resolveScopedSelection(leaf, { current, drill, descend })`, `topLevelAncestor`,
  `childToward`. The SOM Inspector and the playground keep the old default
  (`resolveSelectionRoot`, nearest meshless ancestor). `resolveEditSelection`
  hands external content to the policy **as the leaf**.
- **`edit-selection.js`:** `selectionPath`, `breadcrumbItems` (7 levels, 32
  characters), `escapeTarget`.
- **The handle press** (`apps/client/src/edit-press.js`): one press, a click
  until 4 px (`'put-back'` / `'begin'` / `'drag'`), never a drag from a
  `detail` ≥ 2 press. In `app.js`: `handlePress`, `putBackHandle` (from the
  live SOM node), `endHandleDrag` (in `selectForEdit` and `syncGizmoEnabled`),
  `handleClick` (the release's verdict for the click that follows: a click,
  `forced`, or `drag`).
- **Parts:** `AtriumClient.addNode(descriptor, { parent })`. In
  `edit-duplicate.js` the `parent` rule is gone; `ancestors` (external or an
  excluded ancestor) and `group` (the parent addressable by a non-empty name)
  replace it; `buildDescriptor`/`prepareDuplicate` take an `offset` vector.
  `part-transform.js`: `partWorldTRS` (Copy's world placement, `shear`
  refused), `parentFrameOffset` (1.5 m along world x). `copyObject`'s
  `parentWorld`. `app.js`'s `partRules()` (glTF nodes mapped to SOM nodes) and
  `parentWorldOf()`.
- **Undo:** every structural entry records its parent's **handle** (a Delete's
  read at the click: `_onRemove` disposes the node before the engine hears);
  re-adds send `parent`; `checkEntry` refuses a gone or replaced group;
  `NODE_NOT_FOUND` reads "renamed or removed"; N-4 notes a landing in a newer
  group. **`sameCanonical`** compares groups with refs resolved, children by
  name and sharing as a partition (a part re-added last no longer makes its
  group "changed elsewhere").
- **P0:** `test/helpers/depth-measure.mjs`, `message-depth-measure-{1..4}.test.js`
  (identical files, each list from its own name), the guard
  `message-depth-shards.test.js` (lists `test/` itself). Every legitimate suite
  is measured now.
- **Harness:** `devtasks/harness/checks/selection-parts/` (`sp.py`'s in-page
  handle search, `c1`–`c6`).

## 3. Lessons
1. **A gesture design needs a real-browser probe before it is approved.** The
   pre-brief's "moves are made with the handles, never by pressing on the
   object" was wrong on the first content tried: the handles sat over the
   parts. Only the fresh agent's Playwright run on the released code showed
   it, and it reshaped the round (SP-L8). Next time a round changes a
   gesture, run it on the current page before writing the contract.
2. **A check that doesn't assert the outcome passes when the feature fails.**
   "Ten double-clicks move nothing" passed with every drill failing. Every
   gesture check now asserts the selection, the transforms and the Undo stack.
3. **Fixtures without transforms hide transform bugs.** The part glue (the
   offset, the parent's world matrix, the rule mapping) could be broken with
   every test green, because no fixture group is rotated or scaled. Test
   transform code on a turned, scaled group, in the unit tests and the harness.
4. **State tied to one event type breaks on another pointer type.** The
   release's verdict rode on the mouse press record, which on touch is made
   after the release: fixed for the tap (fresh check), then for the short drag
   (outside review). When a rule depends on event order, test touch.
5. **An unexpected pass can be a second layer** (the subtree-add lesson
   again): with T18 removed, the press's own guard still kept Escape mid-drag
   from moving the group. Breaking both reproduced the bug exactly; record
   both proofs.
6. **Names are optional in glTF.** `''` passed every "addressable by name"
   check and then couldn't travel. Any rule that sends a name must refuse an
   empty one.
7. **The outside code review came from Claude, not Fable.** It executed
   everything and found the touch drag. Check the reviewer's identity in the
   first lines, as the reviewed SHA is checked.

## 4. Release notes
- No `package.json` or lockfile change; no stored data changes shape (a part
  added in place is an ordinary node under its parent). No `p6` run was needed.
- **Fixed on PROD:** Escape, another tab's removal or a disconnect during a
  handle drag no longer leaves the handles stuck until a reload.
- **Changed for everyone in Edit and Inspect:** a click selects the top-level
  object (so a click and Delete removes the whole group, undoably); a
  double-click goes deeper; Escape goes up first; a handle drag under 4 px no
  longer moves anything.
- **A rollback to `45e6cd00`:** nothing stored to undo; the old client handles
  parts as before (Duplicate refused, Delete asks).

## 5. Follow-ups
1. **Candidates for the next round** (the operator picks):
   - **grouping and ungrouping** in the Edit panel, and moving a part into
     another group (a `parent` change on a live node: a new message or a
     `send` leaf), then SA-L2's bounds against created content;
   - several objects selected at once (Shift-click), the breadcrumb showing
     their common ancestor;
   - showing material sharing in the Edit panel (subtree-add §8).
2. **From this round:**
   - **SP-L11 on touch:** a second tap that travels 4 px or more can still
     drag (the click count arrives after the release); stated, not promised;
   - a keyboard route down a level (Alt-click and double-click need a
     pointer);
   - Escape mid-drag could cancel the drag instead (SP-L9 (b)) if the kept
     move surprises anyone;
   - pen input, Firefox and Safari: not tried;
   - `source: null`: selection treats it as not external, the `ancestors`
     rule as external (handoff §4 item 12);
   - `measureFiles` checks each list's recording is non-empty, not each
     file's (17 suites send no message, as before).
3. **Carried from the subtree-add passdown §5:** the SOM Inspector's tree
   rebuild per member; a group over 1,000,000 bytes can't be restored; its
   kept nits (the K7 note's wording, the paste notes naming a part by its
   pasted name, the T2-order and S6 test variants; "Undo re-points parts by
   name" is now by design); and its carried list from copy-objects §5.

## 6. Cleanup (operator, on the host)
```bash
git -C /root/.hermes/sandboxes/docker/default/workspace/atrium push origin --delete claude/selection-parts claude/selection-parts-passdown
```
The only branches on GitHub but `main` (checked 2026-11-08, 21:10 PT): the
round's, and the one this passdown was pushed on. They go only after this
passdown is on `main`.
