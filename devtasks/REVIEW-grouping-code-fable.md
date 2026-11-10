Reviewed commit: 98f916c64550ccda3a99d163aa227c33e37ed190 — reviewer: Claude Fable 5.2 — **SOURCE-ONLY review: no test, proof or probe was run**

<!-- Kept on the branch by the implementing session (Opus 5.5), copied from
the reviewing session's chat (claude.ai chat 43ca22a6). Rev 2, which ran the
tests, is REVIEW-grouping-code-fable-r2.md. Disposition:
devtasks/HANDOFF-grouping.md §8. -->

# Outside code review: `grouping` (de33cf8..98f916c)

## Verdict

**APPROVE WITH NITS — provisional, from reading only.** No must-fix found in
the source. Two should-fix, six nits.

None of this was reproduced. The session that wrote this review was not
allowed to execute the repository's code (see "What I ran"). A verdict that
rests on reading alone does not replace the probes the prompt asks for: treat
every finding below as CONFIRMED IN THE SOURCE or INFERRED, never REPRODUCED.

The clone worked (`git clone`, `git fetch origin claude/grouping`, checkout of
the pinned SHA). `pnpm install --frozen-lockfile --ignore-scripts` worked.

## Should-fix

### S-1. A Move to inside one tree can have an Undo that GR4 refuses, with no ask-first
- **Where:** `apps/client/src/edit-group.js` L344–349 (`moveUndoProblem`).
- **What the code does:** it returns `null` whenever the target is in the
  same top-level tree, with the comment "not within one tree (the counts
  don't grow back)". That holds for nodes and primitives, but not for depth.
- **Scenario:** a seed tree 9 generations deep (already past the bound of 8),
  where the selected part is the only thing below generation 8.
  1. Move to a shallower group in the same tree. The server accepts it: the
     tree goes from depth 9 to 8.
  2. Undo. `checkComposite` (`edit-undo.js` L828) runs
     `treeBoundsProblem(moveCounts(node, oldParent))`: after 9, before 8. So
     it answers "Can’t undo: … the group would be too large to copy", and the
     entry is dropped. The server would refuse the same move
     (`session.js` L175).
- **Why it matters:** GR-L5 (a) says every action whose Undo the rule would
  refuse asks first. Ungroup and Delete do ask in the equivalent depth case
  (`ungroupUndoProblem` computes the lifted depth); Move to doesn't.
- **Size:** narrow. It needs a tree already over the depth bound, which only
  seed content can be.
- **Fix:** for the same-tree case, compare the tree after the move with the
  tree now: `treeBoundsProblem({ before: moveCounts(node, target).after, after: treeCounts(oldTop) })`.
- **How I know:** CONFIRMED IN THE SOURCE, by tracing `moveCounts` and
  `treeBoundsProblem` by hand. Not run.

### S-2. The Empty groups scan and the Ungroup plan run on every `som:set` in Edit mode
- **Where:** `apps/client/src/app.js`:
  - L3893 (`som:set` → `refreshEditActions`);
  - L3156 (`refreshGroupActions`);
  - L3635–3653, L3602 (`refreshEmptyGroups`).
- **What the code does:** every `som:set` in Edit mode calls
  `refreshEditActions`, which now also runs:
  - `refreshEmptyGroups` → `bareNodes(client.som)`: a walk of every node,
    allocating each node's `children` array;
  - `groupHint` → `regroupCounts`: a walk of the selection's whole top-level
    tree;
  - `ungroupHint`, when a group is selected: `isGrantedTarget` (every node),
    then `ungroupPlan` (`moveValue` per part, with matrices unless the group
    is a plain frame).
- **Why it matters:**
  - GR8 says the Empty groups key is recomputed "on structural events and on
    any `som:set` that can change bareness".
  - It also says the heavy lists are never rebuilt on every `som:set`,
    because a running behaviour produces those constantly.
  - The dedicated listener at L3689 does what GR8 says, and the call through
    `refreshEditActions` makes it redundant.
  - `duplicateHint` already caches its expensive part per selection for this
    reason (the earlier review's S2).
- **Fix:**
  - drop `refreshEmptyGroups()` from `refreshGroupActions`, except when
    `emptyKey` was cleared;
  - cache `ungroupHint`'s plan on `(selected, structureStamp)`, plus the
    transform sets of the group and its parts.
- **How I know:** CONFIRMED IN THE SOURCE. The cost is **not measured**; it
  may be small in today's worlds.

## Nits

### N-1. A part of a model-carrying node can leave but not come back
- **Where:** GR3 step 3 (`session.js` L171) refuses any move under a node
  that carries a model. `groupHint` and `checkComposite` (`edit-undo.js` L845)
  don't look at it.
- **What happens:** for a child of a model node, Group succeeds (the `add`
  path has no model rule). Its Undo's move back is then refused: "Undo
  stopped". The same holds for Move to out of such a node.
- **Size:** only authored content or a hand-made `add` puts a child under a
  model.
- CONFIRMED IN THE SOURCE.

### N-2. The group is removed even when this tab already sees something new inside it
- **Where:** `sendRemoveStep` (`edit-undo.js` L907) is sent unconditionally
  in Ungroup's phase 1, the Group's Undo and the Ungroup's Redo.
- **What happens:** if another tab moved or duplicated a node into the group
  during phase 0, this tab knows before it sends the `remove`, and deletes the
  newcomer with the group.
- **Why it's a nit:** the capture window keeps the newcomer restorable, as the
  contract asks. Stopping as "Ungroup (partly)" when
  `group.children.length > 0` would lose nothing.
- CONFIRMED IN THE SOURCE.

### N-3. An object whose behaviour writes its transform can be grouped but never ungrouped by Undo
- **Where:** `isAt` (`edit-undo.js` L794) compares all three vectors bitwise.
- **What happens:** one rotation write by a custom graph after the move makes
  the entry read "changed elsewhere".
- **Size:** the five templates write no transform, so this is custom graphs
  only. Worth a line in GR-L10's stated limits.
- INFERRED.

### N-4. A half-sent phase counts as sent
- **Where:** Ungroup's phase 0 and `moveAll` (`edit-undo.js` L1118, L1223)
  return `every(...) || bySeq.size > 0`.
- **What happens:** if a later part's send failed after an earlier one went,
  the phase would complete on the answers it has. The next phase would then
  remove the group with the unsent parts inside.
- **Size:** I found no route to it today: `client.moveNode` only throws when
  the world isn't loaded, which can't change inside the loop. So it is a trap
  for a later change. Comparing `outs.length` with the parts in `onPhase`
  closes it.
- CONFIRMED IN THE SOURCE.

### N-5. `Number('')` is 0 in both select handlers
- **Where:** `app.js` L3564 and L3627 index `moveOptions` and `emptyList`
  with `Number(select.value)`. The header option's value is `''`.
- **What happens:** a `change` event with the header selected would act on
  the first entry.
- **Size:** I found no route to one. An explicit
  `if (select.value === '') return` costs a line.
- CONFIRMED IN THE SOURCE.

### N-6. An unsent moves phase gives a message with no names
- **Where:** when the moves of an Ungroup's Undo can't be sent, `movesDone`
  (`edit-undo.js` L1224) maps the stand-in outcome's `node: null` to no part.
- **What happens:** the panel reads "Undo stopped:  changed elsewhere
  (another request was still waiting for the server)".
- INFERRED.

## What I checked by reading, and found sound
- **GR1:** `reparentProblem` runs every check before any change, and the
  cycle walk is by identity.
- **GR2 and GR3:**
  - the value's shape;
  - the six steps, in the contract's order;
  - the move is applied to the judged node and the checked parent, in both
    world kinds;
  - a refusal applies and broadcasts nothing.
- **GR4:**
  - the rule;
  - the exclusion for a move inside one tree;
  - the depth formula;
  - the client's and the server's copies are the same text, apart from
    `isPlainObject`;
  - `regroupCounts` and `ungroupUndoProblem` agree with the server's
    step-by-step verdicts in the cases I worked through.
- **GR5 and GR-L12 (a):**
  - the hello is refused after `WORLD_FULL` and before the session exists;
  - the stale `send` is refused after the mutation gate;
  - both host elections.
- **GR6:** nothing is applied before the echo; the event order; the three
  desyncs; `applied` and `landed`.
- **GR7:**
  - answers are routed by seq;
  - the handle re-pointing uses one handle object per node, so older entries
    follow;
  - the removal window and its parent re-read;
  - a stand-in refusal reaches a sensible branch in every composite's
    `onPhase` (but see N-6).
- **Commit 8:**
  - `save()` is synchronous, so no `await` separates the gate from the send;
  - `modelForm` is declared before `refreshEditActions` can run.

## What I ran, and what I couldn't
- **Ran:**
  - the clone and checkout;
  - `pnpm install --frozen-lockfile --ignore-scripts`;
  - `git diff`, `sed` and `grep`;
  - a text `diff` of the two bounds copies.
- **Could not run** (this session's permission check refused to execute the
  repository's code):
  - the `better-sqlite3` install script;
  - every command in STEP 2, including `proofs.py`;
  - any probe of my own, in Node or in the harness.
- **Not reviewed:** the test files themselves (area 5), beyond the proof
  runner's patterns and the wiring test's setup. I can't say which tests fail
  on `172b816d`, or whether any is green whatever the code does.
- Nothing was committed or pushed. The clone's tree is clean.
