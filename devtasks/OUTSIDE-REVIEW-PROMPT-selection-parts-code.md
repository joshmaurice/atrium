You are an outside code reviewer for Atrium, an open-source multiplayer glTF
browser (Node.js + Three.js, ES modules, no build step, pnpm workspaces).
Review the IMPLEMENTATION of its `selection-parts` round against the contract
you reviewed as a design (devtasks/REVIEW-selection-parts-rev1.2-fable.md is
your review of Rev 1.2; Rev 1.3 took every finding and FINAL Rev 2 recorded the
operator's approval). The round changes what a click selects in Edit and
Inspect mode (top-level first, a double-click goes deeper, Alt to the part, a
breadcrumb, Escape up a level), makes a short press on a move handle a click,
ends a handle drag before the selection changes (which also fixes stuck
handles on PROD), and lets a PART of a group be duplicated in place, deleted
and undone back into its group, and copied with its world placement.
Read-only: don't push, don't open PRs, don't touch any deployed site.

Repository: https://github.com/joshmaurice/atrium (public)
Branch: claude/selection-parts
Reviewed commit (the tip): 5fe582c9303a8da77c673558804992e560bf464c
Its base: 8ec887ce, the pre-brief's FINAL commit on this branch, whose code is
main's (dd2071f9), which is PROD's and DEV's (45e6cd00); only devtasks/ differs.
The contract: devtasks/PREBRIEF-selection-parts.md, FINAL Rev 2 (§4 P0, T11,
T13–T18; §5; §6).
The implementer's notes: devtasks/HANDOFF-selection-parts.md. Its §4 lists
where the code differs from the contract's words, and why: check those, don't
take them on trust. A fresh Claude agent that didn't write the code checked it
first; its findings and what was done about them are in the handoff's §7
(commit 6, a1037f0).

Please put the reviewed 40-character SHA in the FIRST LINE of your review.

STEP 1 — GET THE CODE
  git clone https://github.com/joshmaurice/atrium && cd atrium
  git fetch origin claude/selection-parts && git checkout 5fe582c9303a8da77c673558804992e560bf464c
  git diff 8ec887ce HEAD -- . ':!devtasks'
Say whether the clone worked. If it didn't, quote the error and use
  https://github.com/joshmaurice/atrium/compare/8ec887ce...5fe582c9303a8da77c673558804992e560bf464c
and the raw files at https://raw.githubusercontent.com/joshmaurice/atrium/5fe582c9303a8da77c673558804992e560bf464c/<path>

STEP 2 — IF YOU HAVE A CLONE (Node 22, pnpm 10)
  pnpm install --frozen-lockfile --ignore-scripts
  (cd node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 && npm run install)   # builds the native module; without it the database tests fail
  (cd packages/interaction && node --test)
  (cd packages/client && node --test tests/selection-parts-client.test.js)
  (cd apps/client && node --test tests/*.test.js)
  (cd packages/server && timeout 180 node --test test/selection-parts.test.js)
  (cd packages/server && timeout 180 node --test test/message-depth-shards.test.js)
  (cd packages/server && timeout 180 node --test test/message-depth-measure-1.test.js)   # about 50 s; -2, -3, -4 likewise, one at a time
Run server test files one at a time (they share fixed ports). Most valuable:
a small probe of your own that breaks a claim the code relies on, with its code
and output. Two harnesses to start from:
  - the pure modules, driven from Node with a real document from
    tests/fixtures/space.gltf (lamp-01) or atrium.gltf (Furniture), as
    apps/client/tests/selection-parts-undo.test.js does;
  - devtasks/harness/ (its README): the real page and world server, local,
    for Playwright. The round's own checks are
    devtasks/harness/checks/selection-parts/c1.py–c5.py (sp.py has the
    helpers; give Playwright `click_count` on every press, or the browser sees
    `detail` 1 and no double-click).

THE FILES THAT MATTER (line numbers at the reviewed commit; check them)
  apps/client/src/edit-press.js               the press on a handle (T17): down, grab, count, move, change, begin, release, reset
  apps/client/src/app.js                      syncGizmoEnabled / endHandleDrag / handlePress / handleClick / putBackHandle,
                                              onHandleDragging, onHandleChange (search "selection-parts T17", "T18");
                                              the viewport click handler (SP-L10, SP-L11); renderPath, wireCrumbs (T14);
                                              the Escape listener (T15); partRules, parentWorldOf (T11);
                                              checkDuplicate, the Duplicate click, the undo engine's structural
  apps/client/src/edit-selection.js           resolveEditSelection, selectionPath, breadcrumbItems, escapeTarget
  packages/interaction/src/selectionModel.js  topLevelAncestor, childToward, resolveScopedSelection
  apps/client/src/edit-undo.js                capture, registerAdd/registerDelete, acceptAdd/acceptDelete,
                                              checkEntry, completeAccepted, failEntry, startEntry, sameCanonical
  apps/client/src/edit-duplicate.js           duplicateRuleProblem (ancestors, group), buildDescriptor's offset, prepareDuplicate
  apps/client/src/part-transform.js           decomposeTRS, partWorldTRS (shear), parentFrameOffset
  apps/client/src/copy-paste.js               copyObject's parentWorld, partCopyProblem
  packages/client/src/AtriumClient.js         addNode(descriptor, { parent })
  packages/server/test/helpers/depth-measure.mjs, message-depth-measure-{1..4}.test.js, message-depth-shards.test.js   P0
  node_modules/.pnpm/three@0.163.0/node_modules/three/examples/jsm/controls/TransformControls.js   the handles

WHERE TO SPEND THE TIME, in order
1. The press on a handle and the drag's end (T17, T18, SP-L8–SP-L12). Can a
   press that should be a click move, send or record anything, or one that
   should be a drag select? The 100 ms send throttle, the drag rule's hold, a
   remote set or removal during a press, Edit toggled or an undo started
   mid-press, rotate and scale modes, snaps, touch (handoff §4 item 11), the
   click after a T18-ended press, the real order of pointerdown, mousedown,
   pointermove, pointerup and click against r163's TransformControls.
2. Undo and Redo of parts: the parent handles (a Delete's read at the click),
   `checkEntry`'s parent check, the messages, N-4, an unnamed group (commit
   6), `sameCanonical`. Trace a part through its group renamed, deleted,
   deleted and restored by this tab, replaced by another tab; a sub-group as
   the part; an older server (`trees` false). Any path that restores a part
   at the top level or into the wrong node?
3. The selection policy, the breadcrumb and Escape (T13–T15): external
   content as the leaf, avatars, hidden parts in Inspect, duplicated names at
   any level, a selection removed elsewhere, other users' names in the
   breadcrumb.
4. Copy and Duplicate of a part: the decomposition, the shear tolerance, a
   top-level node kept verbatim, the offset, `partRules` handing glTF nodes.
5. P0: still every legitimate message measured; can the guard be fooled?
6. The tests and proofs (handoff §2.1): would each fail for the reason it
   states? Anything in §5 of the pre-brief with no test? Does each DEV
   acceptance step (§5) name a control and a gesture that really show it?

OUTPUT (the shape of your earlier reviews)
- Verdict: APPROVE / APPROVE WITH NITS / CHANGES REQUESTED, naming the
  reviewed 40-character SHA in your first lines.
- Findings, each with severity (must-fix / should-fix / nit), file:line at the
  reviewed commit, a concrete failure scenario, and how you know it:
  REPRODUCED (you ran it), CONFIRMED IN THE SOURCE, or INFERRED.
- What you ran, and what you couldn't. Never report something unrun as passing.
