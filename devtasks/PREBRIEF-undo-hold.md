# Pre-brief: a behaviour stops after Undo (`undo-hold`)

Status: **FINAL, Revision 1 (2026-11-04). Decisions UH-L1–UH-L3 approved as
recommended** (operator, 2026-11-04 20:17 PT: "ok approved"). Rev 1 also
settles where the hold is kept (§4 H2), which Rev 0 left to the worker.
- **Drafted by Claude from `main` at `8ff7000`.** Its code is the same as the
  released `84542c73` (DEV, MAIN and PROD). Line numbers are at that commit.
- **The report (operator, 2026-11-04):** "when i have the model rotating, and
  then move it and undo, it undoes the move but then it stops rotating, even
  though the button still says 'Enabled'. … i add another of the same model to
  the scene, and the moment i move that new model sideways, the previous one
  starts rotating again".
- **Reproduced in the browser harness** on `8ff7000`, through the real panel
  and the real runner: `devtasks/harness/checks/undo-hold/h1.py` (§2.3).
- **Order:** the operator chose to do this round before `add-check`
  (`PREBRIEF-richer-add-copy.md`). The two don't touch each other's code.
- **Sources:**
  - `devtasks/PREBRIEF-scripting-4b-2.md` F-L5 (the drag rule: while the owner
    has "a drag, a handle drag or a form write in flight", behaviour sends to
    that node, its descendants and its ancestors are dropped, not replayed);
  - `devtasks/PREBRIEF-undo-redo.md` (Undo's sends are `commit(…, { record:
    false })` and never part of a reported batch);
  - `devtasks/PREBRIEF-scripting-4a.md` D4 and D5 (behaviour changes are
    ordinary saved edits; behaviours keep running in Edit mode).

## 1. What this delivers
After an Undo or a Redo of a move, rotate or scale, the object's behaviour
carries on. More generally, the drag rule's hold lasts exactly as long as the
owner's edit to that object is in flight, on every path, and never longer.

**Not in this round:**
- Undo still refuses to undo a field that a behaviour has written since
  ("changed elsewhere"). That's by design (4a D4).
- Showing an imported graph's targets in the Behaviour panel (UH-L2).
- Making the hold track node identity rather than a name, or more than one
  node (§2.4).

## 2. Verified facts (at `8ff7000`)

### 2.1 The hold
- **The runner holds back behaviour sends while `setGesture(name)` names the
  edited node** (`runner.js` L432–439 `isInGesture`, L472–482 the drop). A
  dropped send logs one line per hold: "a behaviour send was dropped: the
  owner has an edit in progress". For the graph it counts as a refused
  write, so the adapter also logs "refused write to <id>.<field>" once.
- **`setGesture` holds one name** (`runner.js` L872–876), so a new hold
  replaces the old one.

### 2.2 Where `app.js` sets and clears it
- **Set** in two places:
  - when a handle drag begins (`onHandleDragging`, L1995);
  - in the edit tracker's `writeSend`, which every send of the tracker goes
    through: panel edits, the Visible checkbox, and **Undo's and Redo's
    transform sends** (L1775–1777; `sendTransform` L1817 is
    `editTracker.commit(…, { record: false })`).
- **Cleared** in two places:
  - when a handle drag ends (L2000);
  - in `onTransformsSettled` (L1791), which the tracker calls when a
    **recorded** batch settles.
- **Undo's and Redo's sends are never recorded** (`edit-gesture.js` L47–49,
  L354–366), so `onTransformsSettled` never runs for them. **Nothing clears
  the hold after an Undo or a Redo.**
- **Two other paths also never call `onTransformsSettled`** (`reportBatch`,
  `edit-gesture.js` L184–185), so the hold stays after them too:
  - a batch whose node was removed mid-edit;
  - a batch whose session ended (`edit:unknown`).
  
  After a removal the hold names a node that's gone, so it does nothing (L434),
  **until a node with that name returns**. Undo's restore of a deleted object
  keeps its name.
- **A panel edit to the value the field already holds sends nothing and sets
  no hold** (`commit` returns at L351, before `writeSend`). That's `h1` check 5.
- `behavior-wiring.test.js` L84–86 checks only that the three wiring sites
  exist, not that every set is matched by a clear.

### 2.3 The reproduction (`h1.py`, `8ff7000`)
A cube with an imported `onTick` rotation graph, enabled, in Edit mode,
selected. All six checks pass, so the bug is reproduced:

| # | Step | Seen |
|---|---|---|
| 0 | baseline | 28 rotation sends in 1.5 s, turning |
| 1 | a recorded panel move | still 27 sends in 1.5 s, turning |
| 2 | Undo | the position goes back; the button says Enabled; the engine is live |
| 3 | 3 s after the Undo | **0 sends, 0° turned**; the log line above |
| 4 | a panel move of **another** cube | the first cube sends and turns again |
| 5 | a panel edit to the value it already has | still turning (not part of the bug) |

Redo wasn't reproduced separately: any edit that would clear the hold also
clears the redo stack. Redo goes through the same `sendTransform` as Undo, so
the round's tests cover it at the unit level.

### 2.4 Known, not in this round
- **The hold names a node, not an object**, and holds only one. A panel edit
  to object A followed at once by one to object B leaves A without the hold
  while A's edit is still in flight. That's 4b-2's design. Nobody has
  reported it.

## 3. Decisions (for the operator)

**UH-L1. How the hold ends.**
- **(a) Recommended: the tracker says when a node has nothing in flight, and
  the hold ends then.** The edit tracker gains a callback, `onNodeIdle(node)`,
  called when the last open record for a node closes (in `reconcile`, after
  `dropRecord`) and no gesture on it is active. That covers:
  - accepted, refused and unknown sends;
  - removed nodes;
  - recorded and unrecorded sends alike.
  
  `app.js` clears the hold if it still names that node. The handle drag keeps
  its own clear at drag end. `onTransformsSettled` stops clearing it, so a
  settle for one node can't release another node's hold.
- (b) Clear the hold when an Undo or a Redo finishes (the undo engine's
  accepted, refused and failed paths). It's smaller, but it leaves the removed
  and ended-session paths of §2.2 as they are.

**UH-L2. The imported graph's targets in the Behaviour panel.**
- **(a) Recommended: not in this round.** Show them in `copy-objects`, where
  the panel already changes (CP-L5's "came from another world" line). The
  design's §6 item 3 "with its `targets` shown" is met at import time today.
- (b) In this round. The behaviour's stored `targets` already have what's
  needed. It would make the round bigger (a panel change, its DOM tests and a
  browser check) for something unrelated.

**UH-L3. Release.**
- **(a) Recommended:** the usual pipeline, client only. There's no protocol,
  server or stored-data change. Rolling back loses nothing. Acceptance needs a
  hard reload.
- (b) Fold it into `add-check`'s release. It would wait for the larger round.

## 4. The contract (approved)
- **H1, the tracker** (`edit-gesture.js`):
  - `createEditTracker` takes `onNodeIdle = () => {}`;
  - it calls `onNodeIdle(node)` exactly once each time the node goes from
    having an open record or active gesture to having none, **after** any
    revert has been written and any batch has been reported;
  - it never calls it while a gesture on that node is active.
- **H2, the hold, kept by node object** (settled in Rev 1). A new pure
  export in `edit-gesture.js`:
  - `createBehaviorHold({ setGesture })` returns `{ hold(node), released(node),
    clear() }`;
  - `hold(node)` remembers that node **object** and calls
    `setGesture(node.name)`;
  - `released(node)` does nothing unless `node` is the object it holds. If
    it is, it forgets it and calls `setGesture(null)`;
  - `clear()` forgets the node and calls `setGesture(null)`.
  
  Keeping the object, not a name, means that an idle for one object can't
  release another object's hold, even when their names match (a restored
  object).
- **H3, the wiring** (`app.js`), with `setGesture: (n) => runner?.setGesture(n)`:
  - `writeSend` calls `hold.hold(node)` where it calls `runner?.setGesture(node.name)`
    today (L1777);
  - a handle drag's begin calls `hold.hold(selected)` (L1995), and its end
    calls `hold.clear()` (L2000), as today. A drag that changed nothing sends
    nothing, so no idle would come for it;
  - `onNodeIdle: (node) => hold.released(node)`;
  - `onTransformsSettled` no longer calls `setGesture(null)` (L1791).
  
  **Nothing else in `app.js` calls `runner?.setGesture`.**
- **H4, the runner:** no change.

## 5. Tests
- **`createBehaviorHold` unit tests** (`edit-gesture.test.js`):
  - `released` of the held object clears the hold, once;
  - `released` of another object, **including one with the same name**,
    changes nothing;
  - `hold` of a second object replaces the first; `released` of the first
    then changes nothing;
  - `clear` always clears.
- **Tracker unit tests** (`edit-gesture.test.js`):
  - `onNodeIdle` fires once after:
    - a recorded commit accepted;
    - a recorded commit refused;
    - an unrecorded commit (Undo's) accepted;
    - an unrecorded commit refused;
    - an `edit:unknown`;
    - a node removed mid-send;
  - it doesn't fire while a handle gesture on that node is active, nor for a
    commit that sent nothing;
  - two overlapping commits on one node fire it once, after the second.
- **The wiring** (`behavior-wiring.test.js`; its L84–86 guards change):
  - `writeSend` and the drag's begin call `hold.hold(…)`; the drag's end
    calls `hold.clear()`;
  - `onNodeIdle` calls `hold.released(node)`;
  - `onTransformsSettled`'s body has no `setGesture`;
  - `runner?.setGesture(` appears exactly once in `app.js`, inside
    `createBehaviorHold`'s argument.
- **Proofs** (each break made, the named tests seen failing, the file
  restored from a saved copy):
  - (p1) remove the `onNodeIdle` call from the tracker: the tracker tests
    fail;
  - (p2) call `onNodeIdle` while a gesture on the node is active: the
    gesture test fails;
  - (p3) make `released` clear for any node: the other-object test fails;
  - (p4) put `runner?.setGesture(null)` back in `onTransformsSettled`: the
    wiring guard fails.
- **The browser check (Claude's, on the published SHA, before DEV
  acceptance):** `h1.py`, with checks 3 and 4 turned round. After the
  Undo the spinner sends and turns within 1 s. Add:
  - the same after a Redo;
  - an Undo of a **rotation** while it spins is refused as "changed
    elsewhere" (unchanged, by design);
  - the drag rule still holds **during** a handle drag (4b-2's check).
  
  **Run the new checks on `8ff7000` first and keep their failure in the
  handoff.**
- The regression set: 4b-2's and 4d-1's browser checks that use the drag rule
  (the README in `checks/scripting-4b-2/` lists them).

## 6. Worker rules and release path
As scripting-4d-1 (`PREBRIEF-scripting-4d.md` §8), with these specifics:
- **Two commits, each runnable:**
  1. `edit-gesture.js`: `onNodeIdle` and `createBehaviorHold`, with their
     tests;
  2. `app.js` and `behavior-wiring.test.js`, the full suites, proofs
     (p1)–(p4) and the handoff.
- **Files:** `apps/client/src/edit-gesture.js`, `apps/client/src/app.js`,
  `apps/client/tests/edit-gesture.test.js`,
  `apps/client/tests/behavior-wiring.test.js`. **No other file.** The browser
  check (`devtasks/harness/checks/undo-hold/`) is Claude's, run before DEV
  acceptance.
- **A new check must fail on today's code** before its PASS counts.
- **The code review is enough:** this pre-brief doesn't need its own outside
  review unless the operator wants one. The change is small and client-only,
  and the reproduction is in the repo.
- **Never push to `main` between the release merge and PROD `COMPLETE`.**

## 7. Review log
- **Rev 0** (2026-11-04, evening PT, `8ff7000`): drafted by Claude from the
  operator's report. Reproduced with `h1.py`.
- **Rev 1, FINAL** (2026-11-04, 20:17 PT): UH-L1 (a), UH-L2 (a) and UH-L3 (a)
  approved. §4 settles the hold as a pure `createBehaviorHold` kept by node
  object (H2), so the runner doesn't change (H4). §5 gains its tests and
  proofs (p1)–(p4); §6 lists the files and the two commits. No outside review
  of the pre-brief (UH-L3); the round's code review stands.
