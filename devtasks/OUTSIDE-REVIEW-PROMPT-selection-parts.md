You are an outside reviewer for Atrium, an open-source multiplayer glTF browser
(Node.js + Three.js, ES modules, no build step, pnpm workspaces). Review the
DESIGN PRE-BRIEF for its next round, `selection-parts`. It changes what a
click selects in Edit mode and in Inspect mode: a click selects the top-level
group; a double-click goes one level deeper; Alt-click goes to the part; a
breadcrumb shows the path; Escape goes up a level. A short press on a move
handle becomes a click. It also lets a **part** of a group (a lamp's shade) be
duplicated in place, deleted and undone back into its group, and copied out
with its world placement. A first item splits a slow test file. Nothing is
implemented yet. Your job is to find what is wrong, missing or risky before
it is. Read-only: don't push, don't open PRs, don't touch any deployed site.

Repository: https://github.com/joshmaurice/atrium (public)
Branch: claude/selection-parts
Review commit: 3ccc1ad4581d6c6b5b10633b1b3915b7f01b7dc5
Document: devtasks/PREBRIEF-selection-parts.md (DRAFT Rev 1.2, every decision
taken by the operator, SP-L1 to SP-L8)
Its line numbers refer to code at dd2071f946dee5b55e01f56cd32a200dbd5e73d3
(main), whose code is the released code (PROD and DEV, 45e6cd00). The review
commit differs from it only in devtasks/.
What it builds on (all shipped): devtasks/PREBRIEF-subtree-add.md FINAL Rev 2.1
(T1–T12; its §9 drafted this round's T11, and you reviewed its code as
devtasks/REVIEW-subtree-add-code-fable.md). A fresh Claude agent has already
checked this draft (its §7, Rev 1.2); don't redo its findings, test what it
concluded and what was changed because of it.

Please put the reviewed 40-character SHA in the FIRST LINE of your review.

STEP 1 — GET THE CODE
  git clone https://github.com/joshmaurice/atrium && cd atrium
  git fetch origin claude/selection-parts && git checkout 3ccc1ad4581d6c6b5b10633b1b3915b7f01b7dc5
Say whether the clone worked. If it didn't, quote the error and read the files
at the pinned commit through
  https://raw.githubusercontent.com/joshmaurice/atrium/3ccc1ad4581d6c6b5b10633b1b3915b7f01b7dc5/<path>
A source-only review is still valuable; label it as one.

STEP 2 — IF YOU HAVE A CLONE (Node 22, pnpm 10)
  pnpm install --frozen-lockfile --ignore-scripts
  (cd node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 && npm run install)   # builds the native module; without it the database tests fail
  node devtasks/spike-selection-parts/m2-refs.mjs
  (cd packages/interaction && node --test)
  (cd apps/client && node --test tests/edit-selection.test.js tests/edit-undo.test.js tests/edit-duplicate.test.js tests/copy-paste.test.js tests/subtree-add-undo.test.js)
  (cd packages/server && timeout 180 node --test test/subtree-add.test.js)
  node devtasks/spike-selection-parts/depth-times.mjs packages/server   # about 2 minutes: per-file times under the depth recorder
Run server test files one at a time. Most valuable: a small probe of your own
that breaks a claim the design relies on, with its code and output. Two
places to start: the pure modules (`packages/interaction/src/selectionModel.js`,
`apps/client/src/edit-selection.js`, `edit-undo.js`, `edit-duplicate.js`,
`copy-paste.js`, `packages/som/src/world-matrix.js`) can be driven directly
from Node, with a real document from `tests/fixtures/atrium.gltf` or
`space.gltf`; and `devtasks/harness/` (its README) runs the real page and
world server locally for Playwright, if you have a browser.

THE FILES THAT MATTER (line numbers at dd2071f9)
  packages/interaction/src/selectionModel.js  the policy L13–47 (shared with tools/som-inspector and apps/playground)
  apps/client/src/edit-selection.js           isSelectClick L22, resolveEditSelection L47, pickEditSelection L133
  apps/client/src/app.js                      Escape L1617–1650; structural L1918; isEditExcluded L1960;
                                              Inspect L1973–2104 (inspectSelect L2024, renderInspectPanel L2046);
                                              handles L2202–2246 (onHandleDragging L2217, onHandleChange L2237);
                                              selectForEdit L2283; pickEditTarget L2326; the click L2372–2443;
                                              Duplicate L2970; Copy L2993; Paste L3008; Delete L3080;
                                              som:remove (Inspect) L3276; som:set → refreshEditPanel L1065
  apps/client/src/edit-gesture.js             createEditTracker L194, begin L377, throttleMs L198/L435, cancel L447
  apps/client/src/edit-undo.js                capture L309, registerDelete L343, acceptAdd L401,
                                              acceptDelete L416, checkEntry L567, completeAccepted L637,
                                              startEntry L725, sameDescriptor L81
  apps/client/src/edit-duplicate.js           buildDescriptor L453, duplicateRuleProblem L604,
                                              prepareDuplicate L721, prepareRestore L774, DUPLICATE_OFFSET_X L55
  apps/client/src/copy-paste.js               copyObject L208, preparePaste L365 (placement L393–395)
  packages/client/src/AtriumClient.js         addNode L1335, _onAdd L1635 (parent L1644), _onRemove (dispose L1737)
  packages/som/src/world-matrix.js            localMatrix L34, worldMatrix L60
  packages/server/src/session.js              isBlockedParent L136, the add's parent L1407, L1555–1580
  packages/server/src/world.js                addNode L589 (NODE_NOT_FOUND L595–598)
  packages/server/test/message-depth-measure.test.js   the file P0 splits
  apps/client/index.html                      the Edit panel L685–923, the Inspect panel L927–940

WHERE TO SPEND THE TIME, in order
1. T17 and T13 together, the gestures. A short press on a handle is now a
   click (SP-L8): is there a path where a press that should be a drag
   selects instead, or one that should be a click still moves or records
   something (the 100 ms throttle, the hold, the behaviour runner's drag
   rule, a remote set arriving during the press, Edit toggled mid-press)? Is
   T13's `resolveScopedSelection` right for every case in §5, and for ones it
   doesn't list (external content inside a group, avatars, hidden parts in
   Inspect, a duplicated name at any level, a selection removed by another
   tab)? Does a double-click ever start a drag of the top group?
2. T11's Undo and Redo of parts: the parent handle recorded on every
   structural entry (a Delete's at the click), `checkEntry`'s parent check,
   and the messages. Trace a part through: its group renamed, deleted,
   deleted and restored by this tab, replaced by another tab; Redo of a
   Duplicate in place; a sub-group (a tree) as the part; an older server
   (T7). Is there still a path that restores a part at the top level, or into
   the wrong node?
3. SP-L5 (a), `sameCanonical`: refs resolved, children matched by name,
   sharing compared as a partition. Is it equal exactly when the group is
   unchanged? Can it call two different groups equal (two members swapping
   names, a material changed in one of two sharers)?
4. T11's Copy: the world transform baked into the root (`decomposeTRS`), the
   mirrored case, the shear refusal and its relative tolerance, a top-level
   node kept verbatim; and Duplicate's world-x offset (SP-L4 (b)).
5. P0: does the split still measure every legitimate message every server
   suite sends, and can its guard be fooled? Each shard inside the deploy's
   180 s per file on a slower host?
6. T14 and T15: the breadcrumb (other users' names shown, rebuilds, clicks,
   ARIA, depth) and Escape.
7. §5's tests, proofs, harness checks and DEV acceptance, and §6's file and
   commit list: complete for §4? Would each proof fail for the reason it
   states? Does each acceptance step name a control and a gesture that
   really show it, on the commons' lamp?

OUTPUT (the shape of your earlier reviews)
- Verdict: APPROVE / APPROVE WITH NITS / CHANGES REQUESTED, naming the
  reviewed 40-character SHA in your first lines.
- Findings, each with severity (must-fix / should-fix / nit), file:line at the
  reviewed commit, a concrete failure scenario, and how you know it:
  REPRODUCED (you ran it), CONFIRMED IN THE SOURCE, or INFERRED.
- What you ran, and what you couldn't. Never report something unrun as passing.
