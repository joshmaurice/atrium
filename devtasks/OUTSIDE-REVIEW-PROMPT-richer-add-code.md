You are an outside code reviewer for Atrium, an open-source multiplayer glTF
browser (Node.js + Three.js, ES modules, no build step, pnpm workspaces). Review
the IMPLEMENTATION of its `richer-add` round against the contract you reviewed
as a design (devtasks/REVIEW-richer-add-rev1.2-chatgpt.md was your review).
Read-only: don't push, don't open PRs, don't touch any deployed site.

Repository: https://github.com/joshmaurice/atrium (public)
Branch: claude/richer-add
Reviewed commit (the tip): 4b3393db219db1d02e1d04a915350a02b57fb4fe
Its base (main, code identical to PROD cdfe88a8): 8df8907
The contract: devtasks/PREBRIEF-richer-add.md, FINAL Rev 2 (§4 R1–R10, §5, §6).
The implementer's notes: devtasks/HANDOFF-richer-add.md (§3 lists where the code
differs from the contract's wording, and why: check those, don't take them on
trust).

STEP 1 — GET THE CODE
  git clone https://github.com/joshmaurice/atrium && cd atrium
  git fetch origin claude/richer-add && git checkout 4b3393db219db1d02e1d04a915350a02b57fb4fe
  git diff 8df8907 HEAD
Say whether the clone worked; if not, quote the error and use
  https://github.com/joshmaurice/atrium/compare/8df8907...4b3393db219db1d02e1d04a915350a02b57fb4fe
and raw files at https://raw.githubusercontent.com/joshmaurice/atrium/4b3393db219db1d02e1d04a915350a02b57fb4fe/<path>

STEP 2 — IF YOU HAVE A CLONE (Node 22, pnpm 10)
  pnpm install --frozen-lockfile --ignore-scripts
  (cd packages/som && node --test test/richer-add-ingest.test.js)
  (cd packages/server && timeout 180 node --test test/richer-add.test.js)
  (cd packages/server && timeout 180 node --test test/add-node-vectors.test.js)
  (cd apps/client && node --test tests/richer-add-restore.test.js tests/edit-duplicate.test.js tests/edit-undo.test.js)
  (cd packages/renderer-three && node --test tests/richer-add-render.test.js)
Quote the counts. Most valuable: a probe of your own that breaks a claim, with
code and output (packages/server/test/richer-add.test.js has the harness: the
real attachSessionHandlers on port 0).

THE CHANGED FILES
  packages/server/src/send-policy.js     checkAddNode and helpers (end of file)
  packages/client/src/add-spec.js        the client copy; must behave identically
  tests/fixtures/add-node-vectors.json   the vectors both copies read
  packages/som/src/SOMDocument.js        ingestNode (one buffer per call)
  packages/server/src/session.js         isStaleEditor, the add and remove handlers (R6)
  packages/client/src/AtriumClient.js    the hello's addFields
  packages/protocol/src/schemas/add.client.json, add.server.json, hello.client.json
  apps/client/src/edit-duplicate.js      the D5 rules, materialDescriptor, hasSharedMaterial, prepareRestore
  apps/client/src/edit-undo.js           the shared-material note
  and their tests

WHAT TO CHECK, in order
1. The rule: does the server accept exactly what ingestNode keeps AND what a
   save keeps? Adversarial inputs: prototype tricks, getters, sparse or holey
   arrays, -0, deep or huge extras, COLOR_0 lengths, TEXCOORD_1 alone. Can an
   anonymous avatar add carry anything new? Are the two copies identical in
   behaviour?
2. R6: can a reloaded first-party tab ever be refused, or an unreloaded one get
   a world add or a remove through? Any other message a stale tab can use to
   lose data?
3. R4: does anything assume one buffer per primitive (prune on delete,
   serialize with excluded avatars, autosave, the renderer)?
4. R7/R8: the canonical form's fixed point; hasSharedMaterial; the Undo note
   across delete, undo, redo and re-capture; anything Duplicate or Undo now
   sends that the server refuses.
5. The tests: would they catch a regression, and does any pass for the wrong
   reason?

OUTPUT
- Verdict: APPROVE / APPROVE WITH NITS / CHANGES REQUESTED, naming the
  reviewed 40-character SHA.
- Findings with severity (must-fix / should-fix / nit), file:line, a concrete
  failure scenario, and how you know: REPRODUCED, CONFIRMED IN THE SOURCE, or
  INFERRED.
- What you ran, and what you couldn't. Never report something unrun as passing.
