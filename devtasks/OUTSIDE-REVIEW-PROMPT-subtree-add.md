You are an outside reviewer for Atrium, an open-source multiplayer glTF browser
(Node.js + Three.js, ES modules, no build step, pnpm workspaces). Review the
DESIGN PRE-BRIEF for its next round, `subtree-add`: an `add` message that
carries a node **and its children**, so a top-level group (a lamp with a shade
and a stand, say) can be duplicated, deleted and undone, and copied between
worlds, with shared materials kept within one message. Nothing is implemented
yet. Your job is to find what is wrong, missing or risky before it is.
Read-only: don't push, don't open PRs, don't touch any deployed site.

Repository: https://github.com/joshmaurice/atrium (public)
Branch: claude/subtree-add
Review commit: 2fbba08f7c7cc7562ca2f7d0c8760b25f06608c3
Document: devtasks/PREBRIEF-subtree-add.md (DRAFT Rev 1.8, every decision
taken by the operator)
Its line numbers refer to code at 70a30bd2e86f2d7d91d6b9f8e02b2d44f0f5f9e6
(main), whose code is the released code (PROD, 42aa56ff). The review commit
differs from it only in devtasks/.
What it builds on (all shipped): devtasks/PREBRIEF-add-check.md (A1–A10),
devtasks/PREBRIEF-richer-add.md (R1–R10; RA-L3 is the single-object sharing
rule) and devtasks/PREBRIEF-copy-objects.md (K0–K10; you reviewed it at Rev
1.2). Two fresh Claude agents have already checked this draft (its §7, Rev
1.2 and Rev 1.7); don't redo their findings, test what they concluded.
**Out of scope:** §9 (parts inside a group, moved to the next round). Comment
on it only if something there bears on this round.

STEP 1 — GET THE CODE (please try this first)
  git clone https://github.com/joshmaurice/atrium && cd atrium
  git checkout 2fbba08f7c7cc7562ca2f7d0c8760b25f06608c3
Say in your review whether the clone worked; if not, quote the error (it has
failed on DNS before) and read the files at the pinned commit through
  https://raw.githubusercontent.com/joshmaurice/atrium/2fbba08f7c7cc7562ca2f7d0c8760b25f06608c3/<path>
A source-only review is still valuable; label it as one.

STEP 2 — IF YOU HAVE A CLONE (Node 22, pnpm 10)
  pnpm install --frozen-lockfile --ignore-scripts
  node devtasks/spike-subtree-add/p10-groups.mjs tests/fixtures/*.gltf devtasks/harness/group.gltf
  (cd packages/server && timeout 180 node --test test/richer-add.test.js)
  (cd packages/server && timeout 180 node --test test/copy-objects.test.js)
  (cd packages/som && node --test)
  (cd packages/protocol && node --test)
  (cd apps/client && node --test tests/edit-undo.test.js tests/edit-duplicate.test.js tests/copy-paste.test.js)
Run server test files one at a time. Most valuable: a small probe of your own
that breaks a claim the design relies on, with code and output.

THE FILES THAT MATTER (line numbers at 70a30bd2)
  packages/protocol/src/schemas/add.client.json, add.server.json    node schema (T8, T12)
  packages/protocol/src/schemas/hello.client.json, hello.server.json  capabilities (T7)
  packages/protocol/src/index.js              the Ajv setup
  packages/server/src/session.js              case 'add' L1282–1517, case 'remove' L1548–1610,
                                              isStaleEditor L189–194, the hello L899
  packages/server/src/send-policy.js          checkAddNode L2380, checkAtriumExtras L166,
                                              behaviorCountIn L1461, behaviorBytesIn L764
  packages/server/src/world.js                addNode (two copies) L573–590 and L721–738,
                                              removeNode L745, healDocumentObjectIds L338
  packages/som/src/SOMDocument.js             ingestNode L781–873, removeSubtree L429–456,
                                              checkNewName L315, objectIdInUse L1112
  packages/client/src/add-spec.js             checkAddNode L386 (the client copy)
  packages/client/src/AtriumClient.js         hello capabilities L816–825, _onAdd L1621–1670,
                                              _onRemove L1672, addNode L1321
  packages/server/src/message-depth.js        MAX_MESSAGE_DEPTH L25 (and its measure test)
  apps/client/src/edit-duplicate.js           duplicateRuleProblem L480, buildDescriptor L414,
                                              hasSharedMaterial L395, prepareDuplicate L563,
                                              prepareRestore L593
  apps/client/src/edit-undo.js                capture L289, registerDelete L307, reCapture L344,
                                              acceptAdd L360, checkEntry L524–573,
                                              completeAccepted L594
  apps/client/src/copy-paste.js               copyObject L187, preparePaste L270
  apps/client/src/app.js                      som:add L1083, L2712; som:remove L1094, L2684,
                                              L3210; Delete L3016; retryPaste L2999
  packages/interaction/src/selectionModel.js  nearestNonMeshAncestor L13

WHERE TO SPEND THE TIME, in order
1. T2, the server's handling of a tree. Can a tree bypass any check today's
   `add` makes for one node (S2's `source`, the name rules, object-id
   uniqueness, K6, the model rule, the behaviour caps, `isBlockedParent`), or
   reach a world change before a refusal? Is the order (the shape pass first,
   then one id set per message) enough to bound the cost of a hostile tree
   from any signed-in user in their own home world? Anything in the
   broadcast, autosave or the two `addNode` copies that still assumes one
   node?
2. T7, version skew both ways. A tab that wasn't reloaded (`addFields: 2`)
   on the new server; a new tab (`addFields: 3`) on a rolled-back server,
   which now reads the server's level from `hello.capabilities`. Is there a
   path that still silently stores a group without its parts, or deletes one
   permanently without asking?
3. T12, shared materials by `{ "ref": i }` within one message: the pre-order
   numbering shared by the rule, the ingest and the builder; backwards-only
   refs; the atomic ingest; the schema's `oneOf` (with `required: ["ref"]`);
   the fixed point `prepareRestore(ingest(d)) == d` live and after a save and
   reload; the narrowed Undo note; what happens below server level 3. Is
   there a message the server accepts that a client ingests differently?
4. T4 and T5, the client and the Undo engine: one `som:add` per member (root
   first) against every listener; one re-capture per message; the new
   re-capture on `som:remove`; `checkEntry` comparing trees; Delete asking
   nothing for a restorable group (SA-L4); member renaming on Duplicate.
5. T6, Copy and Paste of a tree: per-member credit, the behaviour rule with
   one map for the tree (a member's reference to another member stays one),
   the hidden marker removed from the root only, the retry re-choosing names
   only.
6. T1, T8 and SA-L2: the recursive schema under this repo's Ajv; the bounds
   (256 members, 8 generations, the 1,000,000-byte cap) against the message
   depth ceiling; where each refusal surfaces (schema vs `checkAddNode`).
7. §5's tests, proofs and DEV acceptance, and §6's file and commit list:
   complete for §4? Would each proof fail for the reason it states? Does each
   acceptance step name a screen that really shows it?

OUTPUT (the shape of your earlier reviews)
- Verdict: APPROVE / APPROVE WITH NITS / CHANGES REQUESTED, naming the
  reviewed 40-character SHA in your first lines.
- Findings, each with severity (must-fix / should-fix / nit), file:line at the
  reviewed commit, a concrete failure scenario, and how you know it:
  REPRODUCED (you ran it), CONFIRMED IN THE SOURCE, or INFERRED.
- What you ran, and what you couldn't. Never report something unrun as passing.
