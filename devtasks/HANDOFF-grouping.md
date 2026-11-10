# Handoff: `grouping`, implemented on `claude/grouping`

**IMPLEMENTED; awaiting the fresh-agent code check** (this file is also the
working note: if a session loses its context, start here, then `git log` on
the branch).

**Contract:** `devtasks/PREBRIEF-grouping.md` FINAL Rev 2.0 (operator,
2026-11-10, 00:05 PT, "Go ahead, please"; approved by voice before it).
**Base:** `de33cf8`, the FINAL commit. Its code is `main`'s `172b816d`, PROD's
and DEV's `331e4aed`; only `devtasks/` differs. **Implemented by Claude.**
Started 2026-11-10, 00:09 PT ("Yes, please").

## 1. The commits
| Commit | What (contract items) | State |
|---|---|---|
| 1 | GR1: `SOMDocument.reparentNode`, `reparentProblem`; `packages/som/test/reparent.test.js` (9 tests: 0 of 9 pass on `172b816d`'s `SOMDocument.js`, 9 of 9 after; SOM suite 296 pass, 0 fail) | done |
| 2 | GR2: `checkParentValue`, the `parent` node field (`send-policy.js`). GR3: `parentChangeProblem` in the contract's order (`session.js`), `world.setField`'s `parent` branch on the judged node in both world kinds (`world.js`). GR4: `treeCounts`, `moveCounts`, `treeBoundsProblem`, `descriptorCounts` (server copy), on moves and parented adds. GR5: `ADD_FIELDS_LEVEL` 4, the stale hello refused (`STALE_HELLO_MESSAGE`), a stale `send` refused, never the host (both election places), the client's hello `addFields: 4`, the two schema descriptions. `refuseStaleHello` (default true) lets tests reach the second layer. New `packages/server/test/grouping.test.js` (26 tests; on `172b816d`'s server code 25 fail, 1 passes: the non-owner gate, a guard). Existing hellos updated (§5's list plus `copy-objects-e2e.test.js` L483 and the scriptRunner-3-only hellos in `world-total` and `script-host`); R6's and AC3/S2's stale-tab tests now run as the second layer. Every server file alone: all pass; client 754, app 1,762 (1 skip), protocol 155, interaction 23, behaviors 263, renderer-three 318 | done |
| 3 | GR6: `AtriumClient.moveNode`; `_applyReparent` on the own echo and on another session's `set` (inside `applyLocally`; `som:reparent`, `som:set` for `parent`, then the three transform `som:set`s with `origin: 'remote'`, `reparent: true`); desyncs `parent-not-found`, `node-not-found`, `reparent-refused`; `edit:accepted` carries `applied` and `landed`. GR4's client copy in `add-spec.js` (`treeCounts`, `moveCounts`, `treeBoundsProblem`, `topLevelOf`, `generationBelow`, `TREE_BOUNDS_MESSAGE`). New `packages/client/tests/grouping-move.test.js` (6 tests, all 6 fail on commit 2's `AtriumClient.js`) and `packages/server/test/grouping-counts.test.js` (3 tests: the two copies agree on 736 nodes and 184 moves). `behavior-origin.test.js`'s site count 6 → 9 (G5's literal origins kept). Client 760 pass, app 1,762 (1 skip) | done |
| 4 | `apps/client/src/edit-group.js` (new): `inverseAffine`, `moveValue` (the exact path one level up out of, or down into, a plain group; else the matrices, refusing a shear and a computed scale under 0.01 or negative), `groupPlan`, `groupName`, `ungroupPlan`, `isBareNode`, `bareNodes`, `bareNodesKey`, `breadcrumbText`, `behaviorAncestorsChange` (client copy), `visibilityChange`, `moveProblem`, `moveTargets`, `regroupCounts`. `edit-duplicate.js` exports `ownNodeProblem` and `isReferenced`. GR7 in `edit-undo.js`: `move`, `group`, `ungroup` entries; the composite runner (phases, every seq answered; a move's `applied: false` is out of step); `moveTo`, `group`, `ungroup` starters (`record: false` for an asked-first action); Group's one "already in use" retry; a refused Group move removes the empty group; "Ungroup (partly)"; GR-L7 (a)'s "Undo stopped"; re-adds re-point the group's handle (r5); the group's removal through the capture window; GR4 and GR-L10 in the checks; the pending-delete parent re-read (f2). Tests: `grouping-edit-group.test.js` (12), `grouping-undo.test.js` (19: 0 of 19 pass on commit 3's `edit-undo.js`). App 1,795 pass, 1 skip | done |
| 5 | GR8's glue: `index.html` (`#ep-group-actions` with Group and Ungroup, `#ep-move-row`'s Move to select and `#ep-move-note`, `#ep-empty-row`'s Empty groups select beside the sky row, both selects width-capped); `app.js` (the enable rules `groupHint`, `ungroupHint`, `movableProblem`; ask-first `askUnundoable` with `ungroupUndoProblem`/`moveUndoProblem`, added to `edit-group.js`; the Move to list built on open or key change, indices into `moveOptions`, a choice checked again; the Empty groups list keyed on its labels, waiting while this tab's request is in flight; `som:reparent` cancels the node's gesture then ends the drag, refreshes the panel, both breadcrumbs and the lists; the engine's `move`, `freeName`, `holdNode` deps; `edit:accepted` passes `applied`/`landed`; a composite original counts as pending, not undoing; the hold released by the answer; the row hidden below level 4). `edit-structure.js`: `reparentSeen` (the review's nit). `edit-undo.js`: the composite's `holdNode` and `doing()`. `tools/som-inspector/src/app.js`: the tree rebuilds on `som:reparent`. New `grouping-wiring.test.js` (13 tests; 0 of 13 pass on commit 4's `app.js`); `app-wiring.test.js`'s `undo.onAccepted(seq` match loosened. App 1,808 pass, 1 skip | done |
| 6 | The harness checks (§3), with three findings they turned up, each fixed in `app.js` with a wiring test that fails without the fix (§3); a new pending-delete test C in `grouping-undo.test.js` for the parent re-read when the removal window opens (the proof of `openRemovalWindow`'s re-read turned nothing red before it, §4); `grouping.test.js`'s sockets closed by the closers and its two `c.closed` waits bounded, so a red stale-hello test fails instead of hanging the file (§4). The proofs (§4), the full suites (§5), this file | done |

## 2. Notes for the record
- **`refuseStaleHello`** (commit 2) is an option of `attachSessionHandlers`,
  default true, that no product caller sets. With GR-L12 (a) a stale tab never
  gets past its hello, so the second layer behind it (R6's `add`/`remove`
  refusal, GR5's `send` refusal and host rule) is unreachable through a real
  socket; tests set it false to prove that layer (selection-parts lesson 5).
- **Historical harness checks** that play a stale tab
  (`checks/scripting-4b-2/rt2.py`, `checks/scripting-4c/c3.py` §10) describe
  earlier rounds' rule (a stale tab joins); on this code its hello is
  refused. They are outside §6's file list and were not changed.
- §6's release-notes bullet "disconnected at the first regroup" predates
  GR-L12 (a)'s change: the release note is **refused at Connect** (GR5's
  hello refusal). To be fixed in the pre-brief's Rev 2.1 wording, as
  selection-parts did.

## 3. The harness checks (`devtasks/harness/checks/grouping/`)
Real mouse through Playwright (`sp.py`), helpers in `gp.py`. Run against a
harness built at the commit under test (`devtasks/harness/setup.sh`;
`HARNESS_ROOT=/tmp/atrium-harness-g`), one at a time: `python3 c1.py`.
Each asserts the selection, the world positions (in every tab), the drawn
parent, the server's copy (`/__doc`) and the Undo stack. All pass on
commit 6's page, three runs of c1 in a row.

| Check | What |
|---|---|
| `smoke.py` | level 4; the row shows in Edit mode; Group enabled and Ungroup disabled ("It has nothing inside to take out") for `crate-01` |
| `c1.py` | DEV acceptance steps 1–6 in an owner tab with a visitor watching: Group, Move to, a click and a double-click into the group, a handle drag of the group, Undo ×3, Redo ×3, Ungroup and its Undo; 5a: both parts out, **Empty groups (1)**, pick `group-01` (handles attach, a real drag moves it: g4 extended), Move a cube back (the row hides), out again, Delete from the dropdown's selection, Undo |
| `c2.py` | `group.gltf`'s turned `Group` (90° about y): Child Pad through Empty groups; Move to → Top level (the matrix path; world place and turn kept in both tabs), Undo (the file's exact local values), Redo, Move to → Group; Ungroup the turned group and its Undo (back at its place and turn); Group Child Pad at the top level, Undo, Redo |
| `c3.py` | f3: tab A is mid-drag on `crate-01` when tab B presses Group on it: no jump in either tab, A's later moves and release send nothing, the server agrees, and the cancelled drag is not in A's Undo stack |
| `c4.py` | g5 against the real server: a hello without `addFields` shows "Connect failed: PERMISSION_DENIED: this page is older than the server: reload it", no avatar joins; reloaded, it connects at level 4 and Group lands |
| `c5.py` | r6: Group and Move to disabled for `space-anim.gltf`'s `crate-01` ("an animation moves it in local values"), enabled for `lamp-01` (loaded through `/__put?kind=file`). r9: with two tabs in `space-ext`, no avatar, avatar camera or source container (`Crate`, `Light`) is listed; a bare node is listed in both tabs at once; given a behaviour through the form (On select: show or hide, saved) it stays listed. Another tab's list follows a group's last part being deleted, the group's Delete, and its Undo |

**Findings (each fixed in `apps/client/src/app.js`, each with a wiring test
that fails without the fix; proofs 17–19 in §4):**
1. **c1: a stale Move to list.** The select keeps the focus after a choice,
   so it gets no new `focus` or `mousedown` before the keyboard's next
   choice; it still listed the old targets (no "Top level" for a node just
   moved into a group). A choice is checked again, so nothing wrong was
   sent, but the list was wrong. Fix: `refreshGroupActions` rebuilds a
   focused select when its key changed.
2. **c3: a cancelled drag recorded.** When every send of A's drag had been
   answered before B's regroup arrived, no record was open for the
   following transform `som:set`s to mark as another session's, so the
   cancel reported the drag as A's own: a "Move “crate-01”" entry whose
   Undo is refused ("was changed elsewhere"; no wrong-frame write). Fix:
   the `som:reparent` handler marks the gesture's records as another
   session's (`editTracker.remoteSet`, the new frame's values) before the
   cancel, so nothing is recorded and nothing written back.
3. **c5: Empty groups waited for this tab.** Another tab's add, remove or
   rename (a group whose last part was deleted elsewhere, an undone Delete
   of an empty group) reached the list only at this tab's next own refresh.
   Fix: those events refresh the list (the scan is a cheap name walk).

## 4. The proofs
Each mechanism broken alone (a one-line change, then restored), its test
file run alone under `timeout 180`:

| # | Broken | Red |
|---|---|---|
| 0 | the cycle check (`reparentProblem`) | `reparent.test.js` 2; `grouping.test.js` 1 (step 4) |
| 1 | the bounds (`treeBoundsProblem` skipped) | `grouping.test.js` 5 |
| 2 | the behaviour rule (GR-L10) | `grouping.test.js` 1 (step 6) |
| 3 | the stale `send` refusal | `grouping.test.js` 1 |
| 4 | the stale host refusal at the hello's election | `grouping.test.js` 1 |
| 5 | the stale host refusal in `canRunBehaviors` | `grouping.test.js` 1 |
| 6 | the stale hello refusal | `grouping.test.js` 2 (before commit 6's closers, the file hung instead) |
| 7 | the exact Undo values (`valueFor` + 1e-9) | `grouping-undo.test.js` 12 |
| 8 | the parent re-read when the removal window opens | `grouping-undo.test.js` 1 (the new test C; nothing before it) |
| 9 | the parent re-read in `reCapture` | `grouping-undo.test.js` 1 (test A) |
| 10 | the wait for the group's add (the retry goes on) | `grouping-undo.test.js` 1 |
| 11 | the handle re-pointing (r5) | `grouping-undo.test.js` 1 |
| 12 | the group's delete through the capture window | `grouping-undo.test.js` 5 |
| 13 | the cancel (an end instead) on `som:reparent` | `grouping-wiring.test.js` 1 |
| 14 | the hold released by the answer | `grouping-wiring.test.js` 1 |
| 15 | the drag's end on `som:reparent` | `grouping-wiring.test.js` 1 |
| 16 | the breadcrumb refresh on `som:reparent` | `grouping-wiring.test.js` 2 |
| 17 | finding 2's `remoteSet` before the cancel | `grouping-wiring.test.js` 1 |
| 18 | finding 1's focused rebuild | `grouping-wiring.test.js` 1 |
| 19 | finding 3's refresh on add/remove/rename | `grouping-wiring.test.js` 1 |

Test C's route: the Undo of a moved Duplicate, or a Redo of a Delete after
a move, is refused "changed elsewhere" when the local values changed; the
re-read at the window's opening matters when another tab moved the node
into a group at the origin (same local values). Test C does that.

## 5. The full suites at commit 6
SOM 296; protocol 155; interaction 23; behaviors 263; renderer-three 318;
client 760; app 1,812 pass, 1 skip; every one of the 64 server files alone
under `timeout 180`, 1,067 pass, 0 fail. All 0 fail.

## 6. Next
1. The fresh-agent code check of `de33cf8..` (commits 1–6); its findings
   reproduced before they are taken.
2. The outside code review, its prompt pinned to the reviewed SHA.
3. The operator's go, then the release path (§6 of the pre-brief): DEV
   acceptance steps 1–8; the release note says a stale tab is **refused at
   Connect** (§2's note).
