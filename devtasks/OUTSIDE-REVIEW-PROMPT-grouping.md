You are an outside reviewer for Atrium, an open-source multiplayer glTF browser
(Node.js + Three.js, ES modules, no build step, pnpm workspaces). Review the
DESIGN PRE-BRIEF for its next round, `grouping`. It lets the world's owner, in
the Edit panel, put the selected object into a new group (**Group**), take a
group apart (**Ungroup**), and move an object into or out of a group (**Move
to…**). Each keeps world placement and is undoable. It adds one new edit on
the wire: a `send` with `field: 'parent'`, whose value carries the new parent
and the exact local placement. It also stops unreloaded tabs from editing or
hosting behaviours, bounds the groups users make, and fixes a pending-delete
bug the design surfaced. Nothing is implemented yet. Your job is to find
what is wrong, missing or risky before it is. Read-only: don't push, don't
open PRs, don't touch any deployed site.

Repository: https://github.com/joshmaurice/atrium (public)
Branch: claude/grouping
Review commit: 34917de8fbaa1d027834619dc95d0a2ebace763c
Document: devtasks/PREBRIEF-grouping.md (DRAFT Rev 1.0, every decision taken by
the operator, GR-L1 to GR-L10)
Its line numbers refer to code at 172b816da778542f5a42a0a757f5b5c87d63b24d
(main), whose code is the released code (PROD and DEV, 331e4aed). The review
commit differs from it only in devtasks/.
What it builds on (all shipped): devtasks/PREBRIEF-selection-parts.md FINAL
Rev 2.1 and devtasks/PREBRIEF-subtree-add.md FINAL Rev 2.1. A fresh Claude
agent has already checked Rev 0.1 (the pre-brief's §7, Rev 0.2, and its probes
in devtasks/spike-grouping/fresh/). Don't redo its findings; test what it
concluded and what was changed because of it.

Please put the reviewed 40-character SHA in the FIRST LINE of your review, and
say which model you are.

STEP 1 — GET THE CODE
  git clone https://github.com/joshmaurice/atrium && cd atrium
  git fetch origin claude/grouping && git checkout 34917de8fbaa1d027834619dc95d0a2ebace763c
Say whether the clone worked. If it didn't, quote the error and read the files
at the pinned commit through
  https://raw.githubusercontent.com/joshmaurice/atrium/34917de8fbaa1d027834619dc95d0a2ebace763c/<path>
A source-only review is still valuable; label it as one.

STEP 2 — IF YOU HAVE A CLONE (Node 22, pnpm 10)
  pnpm install --frozen-lockfile --ignore-scripts
  (cd node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 && npm run install)   # builds the native module; without it the database tests fail
  node devtasks/spike-grouping/g1-reparent-facts.mjs
  node devtasks/spike-grouping/g3-order-and-save.mjs
  node devtasks/spike-grouping/fresh/f1-reparent-movevalue-bounds.mjs
  node devtasks/spike-grouping/fresh/f2-undo-parent-window.mjs
  (cd apps/client && node --test tests/edit-undo.test.js tests/part-transform.test.js tests/selection-parts-undo.test.js tests/selection-parts-wiring.test.js tests/subtree-add-undo.test.js)
  (cd packages/server && timeout 180 node --test test/subtree-add.test.js)
  (cd packages/server && timeout 180 node --test test/behavior-leaf.test.js)
Run server test files one at a time. Most valuable: a small probe of your own
that breaks a claim the design relies on, with its code and output. The pure
modules (`apps/client/src/edit-undo.js`, `part-transform.js`,
`edit-duplicate.js`, `packages/som/src/SOMDocument.js`, `world-matrix.js`,
`packages/server/src/send-policy.js`) can be driven from Node with a real
document from `tests/fixtures/space.gltf` or `atrium.gltf`.
`devtasks/harness/` (its README) runs the real page and world server locally
for Playwright, if you have a browser: `checks/grouping/g2.py` and
`spike-grouping/fresh/f3_drag_remote_reparent.py` are the design's two
browser probes.

THE FILES THAT MATTER (line numbers at 172b816d)
  packages/server/src/send-policy.js   authorizeSend L1784, authorizeNodeSend L1828 (name L1853, the deny L1892)
  packages/server/src/session.js       isBlockedParent L136; STALE_CLIENT_MESSAGE L177; ADD_FIELDS_LEVEL L186;
                                       isStaleEditor L201; canRunBehaviors L598; the send case L1173;
                                       the hello's host election L874; the add case L1310 (stale L1370,
                                       parent L1407, subtree checks L758/L1383); remove (stale L1638)
  packages/server/src/world.js         setField L568 and L723; addNode L589 and L737 (treeNameTaken L591)
  packages/som/src/SOMDocument.js      renameNode L358 (the pattern GR1 copies)
  packages/som/src/SOMNode.js          parent getter L133, addChild L139
  packages/client/src/AtriumClient.js  hello capabilities L830; dispatch L846; addNode L1339; renameNode L1384;
                                       sendField L1497; _onAdd L1640; _onSet L1759; _resolveOwnSetEcho L1820
  packages/behaviors/src/runner.js     isOwnOrDescendant L274; writes L604
  apps/client/src/edit-undo.js         FIELD_VERB L73; registerDelete L468 (the parent read L475); openRemovalWindow L488;
                                       reCapture L510; onAccepted L571 (field === null L578); onStructureAnswer L625 (complete L641);
                                       reason L677; startEntry L883
  apps/client/src/edit-structure.js    structuralBlockReason L21; the tracker L84 (removalSeen L96)
  apps/client/src/part-transform.js    decomposeTRS L76, partWorldTRS L113
  apps/client/src/app.js               TRANSFORM_FIELDS branch L1060; selectForEdit L2411; syncGizmoEnabled L2253;
                                       renderPath L2652; isNameFree L3005; checkDuplicate L3012;
                                       the structural answer L3375ff
  apps/client/index.html               the Edit panel L690–930
  tools/som-inspector/src/app.js       its edits L495

WHERE TO SPEND THE TIME, in order
1. GR7, the Undo engine. Three new composite entries (`move`, `group`,
   `ungroup`) that mix structural requests with sends, wait for an `add`
   before a move, and record partial outcomes (GR-L7 (a)). Is the accounting
   implementable in edit-undo.js as it stands? Trace each entry against
   every existing entry type and against another tab's rename, delete,
   move, regroup and transform of the same nodes, before and during the
   step. Is the claim that exact local values keep older entries undoable
   right? Does the pending-delete fix (re-reading the parent in reCapture
   and the removal window) cover every path that restores a node under a
   remembered parent?
2. GR3–GR5 on the server: the order of the checks, the bounds rule ("past a
   count after AND larger than before", on moves and on parented adds), the
   behaviour rule (same behaviour-carrying ancestors before and after), and
   the stale-tab change (no `send`, never the host). Is there a way to make
   a cycle, an oversized group, an external or avatar parent, or a silent
   behaviour grant? Does the stale-host rule hold at the hello and at
   every later hand-over of the role? What else sends `send` that the level
   bump could break?
3. GR6 and GR8 on the client: applying only on the server's answer, the
   events and their order (including the transform `som:set`s that end
   another tab's drag), blocking everything while a move is pending, the
   enable rules, `moveTargets`' exclusions, the selection afterwards, the
   breadcrumb refresh. Any path where an object visibly jumps, for this tab
   or another?
4. GR-L6, GR-L8, GR-L9, GR-L10's definitions: what counts as a group "with
   nothing of its own", an emptied group deleted inside Move to's step,
   visibility, behaviours. Are any of them wrong for content that already
   exists (atrium.gltf's groups, the commons' lamp, group.gltf, models,
   teleporter pads, cameras and lights, hidden parts)?
5. §5's tests, proofs, harness checks and DEV acceptance, and §6's file and
   commit list: complete for §4? Would each proof fail for the reason it
   states? Does each acceptance step name a control and a gesture that
   really show it?

OUTPUT (the shape of earlier reviews)
- Verdict: APPROVE / APPROVE WITH NITS / CHANGES REQUESTED, naming the
  reviewed 40-character SHA and your model in your first lines.
- Findings, each with severity (must-fix / should-fix / nit), file:line at the
  reviewed commit, a concrete failure scenario, and how you know it:
  REPRODUCED (you ran it), CONFIRMED IN THE SOURCE, or INFERRED.
- What you ran, and what you couldn't. Never report something unrun as passing.
