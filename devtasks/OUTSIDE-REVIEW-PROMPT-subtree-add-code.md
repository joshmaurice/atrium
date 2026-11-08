You are an outside code reviewer for Atrium, an open-source multiplayer glTF
browser (Node.js + Three.js, ES modules, no build step, pnpm workspaces).
Review the IMPLEMENTATION of its `subtree-add` round against the contract you
reviewed as a design. That round lets an `add` message carry a node **and its
children**, so a top-level group can be duplicated, deleted and undone, and
copied between worlds, with shared materials kept within one message as
`{ ref: n }`. devtasks/REVIEW-subtree-add-rev1.8-chatgpt.md is your review of
Rev 1.8; Rev 1.9 took its findings and FINAL Rev 2 recorded the operator's
approval. Read-only: don't push, don't open PRs, don't touch any deployed site.

Repository: https://github.com/joshmaurice/atrium (public)
Branch: claude/subtree-add
Reviewed commit (the tip): 02b5554bb9e7bccb57bc5ed1829976108abab300
Its base: 99ed7a81, the pre-brief's FINAL commit on this branch. Its code is
main's (70a30bd2), which is PROD's and DEV's (42aa56ff); only devtasks/ differs.
The contract: devtasks/PREBRIEF-subtree-add.md, FINAL Rev 2 (§4 T1–T12,
§5, §6). **Out of scope:** T11 and the rest of §9 (parts inside a group,
the next round).
The implementer's notes: devtasks/HANDOFF-subtree-add.md. Its §4 lists where
the code differs from the contract's wording, and why: check those, don't take
them on trust. A fresh Claude agent that didn't write the code checked it
first; its findings and what was done about them are in the handoff's §7.

Please put the reviewed 40-character SHA in the FIRST LINE of your review.

STEP 1 — GET THE CODE
  git clone https://github.com/joshmaurice/atrium && cd atrium
  git fetch origin claude/subtree-add && git checkout 02b5554bb9e7bccb57bc5ed1829976108abab300
  git diff 99ed7a81 HEAD
Say whether the clone worked. If it didn't, quote the error and use
  https://github.com/joshmaurice/atrium/compare/99ed7a81...02b5554bb9e7bccb57bc5ed1829976108abab300
and the raw files at https://raw.githubusercontent.com/joshmaurice/atrium/02b5554bb9e7bccb57bc5ed1829976108abab300/<path>

STEP 2 — IF YOU HAVE A CLONE (Node 22, pnpm 10)
  pnpm install --frozen-lockfile --ignore-scripts
  (cd packages/server && timeout 180 node --test test/subtree-add.test.js)
  (cd packages/server && timeout 180 node --test test/add-node-boundaries.test.js)
  (cd packages/server && timeout 180 node --test test/add-node-vectors.test.js)
  (cd packages/protocol && node --test test/subtree-add-schema.test.js)
  (cd packages/som && node --test test/subtree-add-ingest.test.js)
  (cd packages/client && node --test tests/add-spec.test.js tests/subtree-add-hello.test.js tests/subtree-add-client.test.js tests/copy-objects-e2e.test.js)
  (cd packages/renderer-three && node --test tests/subtree-add-render.test.js)
  (cd apps/client && node --test tests/subtree-add-duplicate.test.js tests/subtree-add-undo.test.js tests/subtree-add-wiring.test.js tests/subtree-add-paste.test.js tests/copy-objects-wiring.test.js)
Quote the counts. Run server test files one at a time: a batched server run
hangs.

The most valuable thing you can send is a probe of your own that breaks a
claim, with its code and output. Two harnesses to start from:
- `packages/server/test/subtree-add.test.js`: the real
  `attachSessionHandlers` on port 0, both world kinds;
- `packages/client/tests/copy-objects-e2e.test.js`: two real servers, real
  AtriumClients, the real Undo engine.

A pitfall the implementer hit: a failing `assert.equal` on two
glTF-Transform objects can exhaust memory (its message inspects the document
graph). Compare identity with `assert.ok(a === b)`.

THE CHANGED FILES
  packages/protocol/src/schemas/add.client.json, add.server.json   T8, T12: the recursive node, { ref }
  packages/protocol/src/schemas/hello.client.json, hello.server.json  T7: addFields
  packages/server/src/send-policy.js    T1 (the tree rule, the server copy), T2 step 0 (subtreeCountProblem)
  packages/server/src/session.js        T2: the order of checks for a tree; T7: ADD_FIELDS_LEVEL, isStaleEditor, the hello
  packages/server/src/world.js          both addNode copies (treeNameTaken)
  packages/som/src/SOMDocument.js       T3, T12: ingestNode (pre-order, the ref pre-pass, one buffer), savedObjectIds
  packages/client/src/add-spec.js       T1 (the client copy)
  packages/client/src/AtriumClient.js   T4: _onAdd, _onRemove; T7: addFields, serverAddFields
  apps/client/src/edit-duplicate.js     T5, T12: buildDescriptor's numbering, Duplicate of a tree
  apps/client/src/edit-undo.js          T5: capture of a tree, member handles, reCapture
  apps/client/src/copy-paste.js         T6: Copy and Paste of a tree
  apps/client/src/app.js                the glue: treesAllowed, the re-captures, the Delete question, Inspect, Paste
  tests/fixtures/add-node-vectors.json  the vectors both copies of T1 read
  devtasks/harness/checks/scripting-4d/c1.py   T7's moved level
  and their tests

WHAT TO CHECK, in order
1. T2 and your M1: can a hostile tree (any signed-in user, in a world they own)
   reach a world change, a broadcast or an autosave before a refusal? Can it
   cost more than the bounds allow before step 0 or the shape pass refuses
   it? Does every per-node check today's single `add` makes (S2's `source`,
   the name rules, object-id uniqueness, K6, the model rule, the behaviour
   caps, `isBlockedParent`) run for every member? Is anything left that
   assumes one node?
2. T12: is the material numbering the same in all three places (the client's
   `buildDescriptor`, the rule `materialRefsProblem` in both copies, and
   `ingestNode`)? Look at primitives with no material, `material: {}`, and a
   ref across branches. Is a bad ref refused before anything is created? Does
   a save and reload keep the sharing?
3. T7, version skew both ways:
   - a tab from before the deploy against this server;
   - this page against a server below level 3 (a group is refused; a single
     object's refs are inlined);
   - every place `serverAddFields` is reset.
4. T5: Undo and Redo of a group across two tabs. Consider a part added,
   removed or changed elsewhere; the member handles re-pointed by name; the
   `som:add` re-capture once per message; the `som:remove` re-capture. And
   SA-L4: no question for a group that can come back.
5. T6, Copy and Paste of a group into another world:
   - the member id map and the one foreign map;
   - every behaviour reference bound as before;
   - the credit on every member;
   - the hidden marker removed from the root only;
   - URLs resolved against the source;
   - the retry that re-chooses names only.
6. The page glue (read, never run in a browser): anything in app.js that
   would throw at load or on a click.
7. The tests: would they catch a regression, and does any pass for the wrong
   reason? The handoff's §2.1 lists each proof and what it broke.

OUTPUT
- First line: the reviewed 40-character SHA.
- Verdict: APPROVE / APPROVE WITH NITS / CHANGES REQUESTED.
- Findings with:
  - severity (must-fix / should-fix / nit);
  - file:line;
  - a concrete failure scenario;
  - how you know it: REPRODUCED, CONFIRMED IN THE SOURCE, or INFERRED.
- What you ran, and what you couldn't. Never report something unrun as
  passing.
- Please give the review as text in your reply (not only as a download), so
  it can be pasted whole.
