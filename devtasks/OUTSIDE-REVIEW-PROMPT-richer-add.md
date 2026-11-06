You are an outside reviewer for Atrium, an open-source multiplayer glTF browser
(Node.js + Three.js, ES modules, no build step, pnpm workspaces). Review the
DESIGN PRE-BRIEF for its next round, `richer-add`: a world `add` message that
carries more of a mesh and material (names, extras, emissive, alpha, double-
sided, UVs and vertex colours), and the client's Duplicate and Undo widened to
use it. Nothing is implemented yet. Your job is to find what is wrong, missing
or risky before it is. Read-only: don't push, don't open PRs, don't touch any
deployed site.

Repository: https://github.com/joshmaurice/atrium (public)
Review commit: cf844b8c3697ad6a27c4f41172d2eef9e5fe04d1
Document: devtasks/PREBRIEF-richer-add.md (DRAFT Rev 1.2)
Its line numbers refer to code at cdfe88a876cf3388a84de69aea6872407eb032c7
(the released code, PROD), which is identical to the review commit outside
devtasks/.
The baseline it widens: devtasks/PREBRIEF-add-check.md (FINAL Rev 1.1, shipped).
You reviewed that round's code three times (devtasks/REVIEW-add-check-code-*-chatgpt.md),
and an earlier draft of this design (devtasks/REVIEW-richer-add-copy-rev0.1-chatgpt.md):
the pre-brief's §3 records where it disagreed with you and why.

STEP 1 — GET THE CODE (please try this first)
  git clone https://github.com/joshmaurice/atrium && cd atrium
  git checkout cf844b8c3697ad6a27c4f41172d2eef9e5fe04d1
Say in your review whether the clone worked; if not, quote the error (it has
failed on DNS before) and read the files at the pinned commit through
  https://raw.githubusercontent.com/joshmaurice/atrium/cf844b8c3697ad6a27c4f41172d2eef9e5fe04d1/<path>
A source-only review is still valuable; label it as one.

STEP 2 — IF YOU HAVE A CLONE (Node 22, pnpm 10)
  pnpm install --frozen-lockfile --ignore-scripts
  node devtasks/spike-richer-add/p8-richer-add-facts.mjs
  node devtasks/spike-richer-add/p9-render-mapping.mjs
  node devtasks/spike-richer-add/p1-fixtures.mjs tests/fixtures/*.gltf devtasks/harness/group.gltf
  (cd apps/client && node --test tests/edit-duplicate.test.js tests/edit-undo.test.js)
  (cd packages/server && timeout 180 node --test test/add-node-vectors.test.js)
Quote anything that disagrees with the document. Most valuable: a small probe
of your own that breaks a claim the design relies on, with code and output.

THE FILES THAT MATTER (at the pinned commit)
  packages/som/src/SOMDocument.js            ingestNode L781–852, removeSubtree L429–455
  packages/server/src/send-policy.js          checkAddNode and its helpers L1860–2124, materialValueOk L1411–1423
  packages/client/src/add-spec.js             the client copy of the same rule
  tests/fixtures/add-node-vectors.json        the vectors both copies read
  packages/server/src/session.js              the add handler L1231–1458, hello L725–946, isMutator L646–664
  packages/client/src/AtriumClient.js         hello capabilities L740–767, _onAdd L1547–1595
  apps/client/src/edit-duplicate.js           the D5 rules, buildDescriptor, prepareRestore
  apps/client/src/edit-undo.js                sameDescriptor L68–84, capture L283–289, label L493–498
  apps/client/src/app.js                      scriptRunner L1241–1248
  packages/protocol/src/schemas/add.client.json, add.server.json, hello.client.json
  node_modules: @gltf-transform/core 4.3.0 (the writer's material block), @gltf-transform/view 4.4.0

WHERE TO SPEND THE TIME, in order
1. R1 against R4 and the writer: is what the server ACCEPTS exactly what
   `ingestNode` KEEPS and what a SAVE keeps (glTF-Transform writes alphaCutoff
   only with MASK, and omits defaults)? Any field kept live and lost at save or
   in a joiner's som-dump, or the reverse? Anything an anonymous avatar `add`
   can now send (R2)?
2. R7's canonical form and "fixed point": prepareRestore of the node rebuilt
   from its own descriptor must equal that descriptor, also after a save and a
   reload. Does it hold with Float32 storage, defaults, empty extras, COLOR_0
   VEC3 vs VEC4, an empty material name? Where would Undo report "changed
   elsewhere" for an object nobody changed?
3. R6, the version-skew refusal: a world `add` is refused when the session's
   hello carried `scriptRunner` but not `addFields: 2`. Is that exactly an
   unreloaded first-party tab? Can a reloaded tab ever be refused, or a stale
   one get through? What does the stale tab show its user?
4. R4's one buffer per ingestNode call: anything that assumes one per
   primitive (pruning on delete, serialize with excluded avatars, the renderer)?
5. The two stated D5 exceptions (RA-L2 (c): accessor and buffer labels dropped;
   RA-L3 (a): a restore gets its own material), now decided by the operator
   with a revisit trigger. Not to re-argue: is the trigger enough, and is
   anything else lost that the document doesn't state?
6. §5's tests and §6's file list: complete for §4? Anything that can't be
   tested as written?

OUTPUT (the shape of your earlier reviews)
- Verdict: APPROVE / APPROVE WITH NITS / CHANGES REQUESTED, naming the
  reviewed 40-character SHA.
- Findings, each with severity (must-fix / should-fix / nit), file:line at the
  reviewed commit, a concrete failure scenario, and how you know it:
  REPRODUCED (you ran it), CONFIRMED IN THE SOURCE, or INFERRED.
- What you ran, and what you couldn't. Never report something unrun as passing.
