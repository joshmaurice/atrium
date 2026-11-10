# Handoff: `grouping`, implemented on `claude/grouping`

**IN PROGRESS** (this file is also the working note: if a session loses its
context, start here, then `git log` on the branch).

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
| 6 | the full suites, the proofs, the harness checks, this file | |

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
