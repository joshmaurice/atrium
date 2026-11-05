# Pre-brief: a behaviour stops after Undo (`undo-hold`)

Status: **DRAFT, Revision 0 (2026-11-04). Decisions UH-L1–UH-L3 are the
operator's; none is decided yet.** Each has a recommendation.
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

## 4. The contract (as recommended)
- **H1, the tracker** (`edit-gesture.js`):
  - `createEditTracker` takes `onNodeIdle = () => {}`;
  - it calls `onNodeIdle(node)` exactly once each time the node goes from
    having an open record or active gesture to having none, **after** any
    revert has been written and any batch has been reported;
  - it never calls it while a gesture on that node is active.
- **H2, the wiring** (`app.js`):
  - `onNodeIdle: (node) => { if (runner?.gestureName === node.name) runner?.setGesture(null) }`
    (or the runner gains `clearGestureIf(name)`; the worker picks one and
    tests it);
  - `onTransformsSettled` no longer calls `setGesture(null)`;
  - the drag's own set and clear stay.
- **H3, the runner:** at most the small read or conditional clear that H2
  needs. Nothing else changes.

## 5. Tests
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
- **The wiring:**
  - `behavior-wiring.test.js` gains the `onNodeIdle` site, and the absence of
    the clear in `onTransformsSettled`;
  - a DOM-free test of the branch: an idle for another node leaves the hold.
- **The browser check:** `h1.py`, with checks 3 and 4 turned round. After the
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
- **One commit, or two** (the tracker with its tests, then the wiring with the
  browser check). Each is runnable.
- **A new check must fail on today's code** before its PASS counts.
- **The code review is enough:** this pre-brief doesn't need its own outside
  review unless the operator wants one. The change is small and client-only,
  and the reproduction is in the repo.
- **Never push to `main` between the release merge and PROD `COMPLETE`.**

## 7. Review log
- **Rev 0** (2026-11-04, evening PT, `8ff7000`): drafted by Claude from the
  operator's report. Reproduced with `h1.py`. Not yet reviewed.
