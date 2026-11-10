# Code check: `grouping`, commits `de33cf8..9716caf`

- **SHA checked:** `9716caff4129acb0ffc9bb35e6bbbeb605a4b081` (`claude/grouping`)
- **Checked by:** a fresh agent, no prior context. It was given the contract
  (`devtasks/PREBRIEF-grouping.md` FINAL Rev 2.0) and the branch, and was told
  to read the handoff last.
- **About this file:** the agent could not write files, so it returned its
  report as a message. This file keeps that report's findings and
  reproductions, condensed but with nothing changed in substance. The
  scripts it names are beside this file; they first ran from
  `/tmp/grouping-code-check/`.
- **What happened to each finding:** see `devtasks/HANDOFF-grouping.md` §7.

## Findings, most severe first

### 1. must-fix: the Undo engine can stay "in flight" until a reconnect
- **Where:**
  - `app.js` L1964–1979: the engine's `structural` dependency ignores what
    `structure.begin` returns.
  - `edit-undo.js` `sendRemoveStep` and `sendAddStep`.
  - The trigger: the Model form's Save (`model-form.js` L304–329) has no
    `editDispatchBlocked()` gate.
- **Why it happens:**
  - A composite's later `remove` (Ungroup, Group's Undo, Group's cleanup) is
    sent a round trip after its check.
  - If another structural request takes the tracker's one slot in that time,
    `structure.begin` refuses the composite's request.
  - The tracker then never hands over the answer, so `inFlight` never clears.
- **What the user sees:** the whole Edit panel reads "Waiting for the server…"
  until a reconnect. An Ungroup the server applied is never recorded.
- **Reproduction:** `stuck_model.py`. Ungroup `lamp-01`, then Save the Model
  form in the same task.

  Result: `inFlight: True` 10 s later; the server has removed `lamp-01`.
- **Suggested fix:**
  - gate the Model form's Save;
  - in `structural`, send nothing while `structure.pending` is set;
  - make a later phase that sends nothing stop under GR-L7 (a), rather than
    dropping `inFlight` without a word.

### 2. should-fix: after an ask-first dialog, Ungroup and Move to send values computed before it
- **Why it happens:** `window.confirm` pauses the page, so another tab's
  messages land only after the handler returns. Ungroup's re-check runs
  synchronously, and Move to's value is computed before the dialog.
- **Reproduction:** `dialog_race.py`, with `big.gltf` (`space.gltf` plus a
  257-node group `big`).
  1. Tab A presses Ungroup on `big`; the question opens.
  2. Tab B moves `big` 4 m along z.
  3. A accepts.

  Result: every part goes back to its place from before B's move.
- **Suggested fix:** await `AFTER_DIALOG_MS` as Delete does, check again, and
  recompute the plan or value.

### 3. should-fix: Ungroup is offered for a group whose removal capture will fail
- **Why it happens:** `ungroupHint` uses `ownNodeProblem(node._node, { credit: false })`.
  The Delete capture's rule checks the credit.
- **What the user sees:** for a group with a malformed credit, Ungroup is
  offered. The group is deleted, nothing is recorded, and the message says
  "the object changed while it was being deleted".
- **Reproduction:** `credit.test.mjs`.

### 4. should-fix: a Delete in a tree just over a bound doesn't ask first, and its Undo is started and refused
- **Why it happens:** GR-L5 (a) and GR7 require the ask-first and the GR4
  check before sending, but neither the Delete handler nor `checkEntry`'s
  re-add branch runs GR4.
- **Reproduction:** `delete-bounds.test.mjs`.
  - Against a real server: the delete is accepted and its re-add is refused
    "too large to copy (nodes)".
  - Against the real engine: the Delete is recorded and its Undo is sent.

### 5. nit (tests): no test fails when the cycle check and the counts swap order
- **Reproduction:** `order.mjs` moves a 7-node chain into its own deepest part.
  - The original code answers "a node can’t go inside itself".
  - With steps 4 and 5 swapped it answers "too large to copy (depth)", and
    the suite stays green.

### 6. nit: `som:desync` has no listener, despite the comment at `AtriumClient.js` L1437
The agent's grep found only the places that emit it.

## Files outside §6's list
None, apart from `devtasks/`.

## Checked and found sound (the agent's summary)
- GR1's checks run before any change.
- GR2's value shape.
- GR3's order, codes and messages. The move is applied to the judged node
  and parent.
- GR4:
  - the rule;
  - the two copies are byte-identical;
  - the Undo predictions agree with the server's per-step verdicts.
- GR5 and GR-L12 (a):
  - the level;
  - the stale hello is refused after the `WORLD_FULL` check;
  - a stale `send` is refused before `authorizeSend`;
  - both places that elect the host;
  - the row hides below level 4.
- GR6: the order of events, the desyncs, `applied` and `landed`; no pending
  edit times out.
- Concurrent Group, Move to and Ungroup from two owner tabs keep the world
  placement.
- GR7:
  - the routing of answers;
  - Group's retry and cleanup;
  - "Ungroup (partly)" and "Undo stopped";
  - the re-pointing (r5), the capture window and the parent re-read (f2);
  - a disconnect clears the stacks.
- GR8:
  - the selection after each action;
  - the cancel on `som:reparent` (with its records marked remote first);
  - the hold release;
  - the Move to indices and their re-check;
  - what Empty groups leaves out;
  - the SOM Inspector's rebuild.
