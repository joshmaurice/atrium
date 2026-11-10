# Handoff: `grouping`, implemented on `claude/grouping`

**IMPLEMENTED; the fresh-agent code check (§7) and the outside code review
(§8) taken; awaiting the operator's go for the release** (this file is also the
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
| 7 | The fresh-agent code check's findings 1–5, each reproduced first and fixed with tests that fail without the fix (§7); finding 6 not taken | done |
| 8 | With the operator's go (2026-11-10, 03:21 PT): the Model form's Save waits for an edit in flight (`model-form.js`, outside §6's list; §7). Harness `c6.py` | done |
| 9 | The outside code review (Fable 5.2, Rev 1 and Rev 2, at `98f916c6`): S-1 and the nits N-0 (S-2), N-1, N-2, N-4, N-5, N-6, each reproduced first with a test that fails on `98f916c6`; N-3 stated (§8) | done |

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
| 20 | code check 5: the cycle before the counts (steps 4 and 5 swapped) | `grouping.test.js` 1 (the new order test) |
| 21 | code check 1: `structural` sends while the slot is taken | `grouping-wiring.test.js` 1 |
| 22 | code check 1: an unsent later step drops `inFlight` silently | `grouping-undo.test.js` 2 |
| 23 | code check 2: Ungroup's wait after the dialog | `grouping-wiring.test.js` 2 |
| 24 | code check 2: Move to's value recomputed after the dialog | `grouping-wiring.test.js` 1 |
| 25 | code check 3: Ungroup's rule without the credit | `grouping-wiring.test.js` 1 |
| 26 | code check 4: Delete's ask-first at a bound | `grouping-wiring.test.js` 1 |
| 27 | commit 8: the Model form's Save gated (`canSave` without `dispatchAllowed`) | `model-form.test.js` 1 |
| 28 | commit 8: `refreshEditActions` re-renders the open form | `grouping-wiring.test.js` 1 |
| 29 | code check 4: `checkEntry`'s GR4 on a parented re-add | `grouping-undo.test.js` 1 |
| 30 | review S-1: a same-tree Move to predicts its Undo | `grouping-undo.test.js` 1 |
| 31 | review S-2: Empty groups rescanned only when its key is cleared | `grouping-wiring.test.js` 1 |
| 32 | review N-1: the engine refuses a move into a model | `grouping-undo.test.js` 1 |
| 33 | review N-1: a part of a model can't be moved out | `grouping-wiring.test.js` 1 |
| 34 | review N-2: no remove while something is inside | `grouping-undo.test.js` 1 |
| 35 | review N-4: the moved parts are the accepted ones | `grouping-undo.test.js` 1 |
| 36 | review N-6: an unsent moves phase names every part | `grouping-undo.test.js` 1 |
| 37 | review N-5: the Move to header acts on nothing | `grouping-wiring.test.js` 1 |

Test C's route: the Undo of a moved Duplicate, or a Redo of a Delete after
a move, is refused "changed elsewhere" when the local values changed; the
re-read at the window's opening matters when another tab moved the node
into a group at the origin (same local values). Test C does that.

## 5. The full suites
At commit 6: SOM 296; protocol 155; interaction 23; behaviors 263;
renderer-three 318; client 760; app 1,812 pass, 1 skip; every one of the 64
server files alone under `timeout 180`, 1,067 pass. All 0 fail.

At commit 7: the same, except app 1,823 pass, 1 skip, and server 1,069. All
0 fail. The harness checks smoke and c1–c5 all pass on commit 7's page.

At commit 9: the same, except app 1,833 pass, 1 skip. All 0 fail. The
harness checks smoke and c1–c6 all pass on commit 9's page, and so do the 38
proofs.

## 6. Next
1. The operator's go, then the release path (§6 of the pre-brief): DEV
   acceptance steps 1–8; the release note says a stale tab is **refused at
   Connect** (§2's note).

## 7. The fresh-agent code check (`9716caf`)
A fresh agent with no prior context, given the contract and the branch.
Its report and scripts are in `devtasks/spike-grouping/code-check/`.
I reproduced every finding myself before taking it, by running its scripts
against the harness at `9716caf` and the repository.

| # | Finding | Reproduced | Taken | Fix (commit 7) |
|---|---|---|---|---|
| 1 | must-fix: Ungroup, then the Model form's Save within a round trip, leaves the Undo engine in flight until a reconnect (the panel says "Waiting for the server…") | yes, `stuck_model.py` | yes | `app.js`'s `structural` sends nothing while `structure.pending` is set. A later composite step that can't be sent stops the composite as a refusal would (`runPhase`), so GR-L7 (a)'s rules apply: Ungroup records "Ungroup (partly)" and keeps the empty group; an Undo stops and says so. Afterwards `stuck_model.py` passes: idle, "Ungroup (partly)" recorded. |
| 2 | should-fix: Ungroup and Move to use values from before an ask-first dialog, so another tab's move made during it is overwritten | yes, `dialog_race.py` | yes | Both handlers wait `AFTER_DIALOG_MS` after the dialog (as Delete does), check identity, the selection and the rules again, and plan or compute from the values as they are then. `dialog_race.py` passes. |
| 3 | should-fix: Ungroup's own-node rule skipped the credit that the Delete capture checks | yes, `credit.test.mjs` | yes | `ownNodeProblem(node._node)`, credit on (GR-L6 (a): "the Delete capture's own rule"). The script hard-codes the old call, so it still fails; the wiring test runs `app.js`'s own `ungroupHint`. |
| 4 | should-fix: a Delete in a tree just over a bound neither asks first (GR-L5 (a)) nor has its Undo checked by GR4 (GR7) | yes, `delete-bounds.test.mjs` | yes | Delete asks "This can’t be undone: the group would be too large to copy." and registers no descriptor (W5); `edit-group.js`'s `deleteUndoProblem`. `checkEntry` runs GR4 on a parented re-add with a client copy of `descriptorCounts` in `add-spec.js`; `grouping-counts.test.js` holds it to the server's answers. `subtree-add-wiring.test.js`'s SA-L4 text match now names the new condition. |
| 5 | nit: no test pinned the cycle (step 4) before the counts (step 5) | yes, `order.mjs` | yes | A new order test in `grouping.test.js`. It passes on the code, as a guard; proof 20 swaps the steps and it turns red. |
| 6 | nit: no listener for `som:desync` | **no** | no | `apps/client/src/app.js` L1145 listens and reconnects (A7/C7), so the comment at `AtriumClient.js` L1437 is right. The agent's grep missed it. |

**Outside §6's file list, with the operator's go (commit 8):** the check also
suggested gating the Model form's Save on `editDispatchBlocked()`. The fix
above already made the collision safe: the composite stops cleanly and says
so. I asked rather than change `model-form.js`. The operator said go
(2026-11-10, 03:21 PT: "making it unavailable to be added if there's a
pending edit").

- `model-form.js` takes an optional `dispatchAllowed` dep, as the teleporter
  form does. `canSave` requires it, and Save's tooltip reads "Wait for the
  edit in progress to finish".
- `app.js` passes `modes.edit && !editDispatchBlocked()`, and
  `refreshEditActions` re-renders the open form, so Save comes back when the
  edit lands.
- This also covers an Undo or a Redo in flight, which predates this round.
- Tests: `model-form.test.js` (1) and `grouping-wiring.test.js` (1), both
  failing without the change; proofs 27 and 28.
- Harness `c6.py` uses real clicks. Ungroup, then Save at once: Save is
  disabled with its reason; the Ungroup completes and is recorded whole; then
  Save is offered again and adds the model.
- App suite 1,825 pass (1 skip); client 760; smoke and c1–c6 pass.

**Tests added (each fails on `9716caf`'s sources, except two named guards):**
- `grouping-undo.test.js`:
  - an unsent later step, for Ungroup and for a Group's Undo;
  - a re-add over a bound, refused before sending;
  - guard: a Delete in a 256-node tree still undoes.
- `grouping-wiring.test.js`:
  - the two re-plans after the dialog, and a selection change during it;
  - the credit;
  - Delete's ask-first;
  - guard: no question in a 256-node tree;
  - the `structural` guard (a text test).
- `grouping.test.js`: the order (a guard; proof 20).
- `grouping-counts.test.js`: `descriptorCounts` (fails without the client
  copy).

## 8. The outside code review (Fable 5.2, at `98f916c6`)
- **The reviews:** `devtasks/REVIEW-grouping-code-fable.md` (Rev 1, source
  only: that session wasn't allowed to run the code) and
  `devtasks/REVIEW-grouping-code-fable-r2.md` (Rev 2, a second session).
  Both are copied from the reviewing sessions' chats, and their first lines
  name the SHA and the model.
- **Rev 2's verdict:** **APPROVE WITH NITS**, no must-fix. It ran:
  - the prompt's tests: 138 of 138 pass;
  - the 30 proofs: all red when broken;
  - a probe reproducing S-1 and N-1, and timing S-2.
- **Process:** I reproduced each finding with a test against `98f916c6`
  before taking it. Every test below fails there and passes at commit 9.

| # | Finding | How I reproduced it | Fix (commit 9) |
|---|---|---|---|
| S-1 | should-fix: a Move to within one tree already past the depth bound (seed content) is recorded with no question, and its Undo is then refused | `grouping-undo.test.js`: a chain 9 deep; `moveUndoProblem(n9 → n3)` was null | `moveUndoProblem` compares the tree after the move with the tree now (the reviewer's formula), so the panel asks first "This can’t be undone: the group would be too large to copy" |
| N-0 (S-2) | nit: the Empty groups scan ran on every `som:set` through `refreshEditActions` (measured 0.04 ms at 56 nodes, 3.3 ms at 2,000) | `grouping-wiring.test.js`: three refreshes, three scans | `refreshGroupActions` rescans only when `emptyKey` was cleared. A structural event, a bareness `som:set` (which now clears the key first) or hiding the row clears it. Not taken: caching `ungroupHint`'s plan, measured at 0.1 ms in atrium.gltf and about 1 ms at 249 rotated parts; a follow-up if worlds grow |
| N-1 | nit: a part of a model-carrying node could be grouped or moved out, but its Undo is refused ("a model can’t hold objects") | `grouping-undo.test.js`: the Undo was sent and refused. `grouping-wiring.test.js`: Group was enabled | Group and Move to say "It is part of a model" for a child of one, and Ungroup says "It is inside a model" for a group inside one. The engine's `moveRuleProblem` refuses a move into a model before sending, for older entries |
| N-2 | nit: the group's `remove` was sent even with a newcomer inside (another tab moved it in during the moves) | `grouping-undo.test.js`: the remove was sent | `sendRemoveStep` sends nothing while the group has children, and the composite stops: Ungroup records "Ungroup (partly)", saying "something else is inside it now". The newcomer is kept |
| N-3 | nit: a custom graph that writes an object's transform makes its Group entry "changed elsewhere" | not run (the reviewer's inference; the engine's `isAt` is bitwise by design) | Stated here as a limit of GR-L10: the five templates write no transform |
| N-4 | nit: a half-sent moves phase counted as sent | `grouping-undo.test.js`: a part's send fails (the harness's `move` returns null). Before: the group was removed with the part inside | The moved parts are the accepted ones (`acceptedNodes`), in Ungroup's do path and in `movesDone` |
| N-5 | nit: `Number('')` is 0, so a `change` with the header selected acted on the first entry | `grouping-wiring.test.js`: the lifted handler started a Move to | Both select handlers return on `''` |
| N-6 | nit: an Undo of an Ungroup whose moves couldn't be sent named no part | `grouping-undo.test.js`: the message named no part | With N-4's fix, every part not accepted is named |

**Not run by the reviewer, and run here:** the harness checks smoke and
c1–c6, and the full suites (§5).
