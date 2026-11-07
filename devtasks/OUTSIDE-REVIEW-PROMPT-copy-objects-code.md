You are an outside code reviewer for Atrium, an open-source multiplayer glTF
browser (Node.js + Three.js, ES modules, no build step, pnpm workspaces). Review
the IMPLEMENTATION of its `copy-objects` round against the contract you
reviewed as a design (devtasks/REVIEW-copy-objects-rev1.2-chatgpt.md is your
review of Rev 1.2; Rev 1.3 took every finding and FINAL Rev 2 changed no text).
Read-only: don't push, don't open PRs, don't touch any deployed site.

Repository: https://github.com/joshmaurice/atrium (public)
Branch: claude/copy-objects
Reviewed commit (the tip): __SHA__
Its base (main, code identical to PROD 3fcc296c): ace29de
The contract: devtasks/PREBRIEF-copy-objects.md, FINAL Rev 2 (§4 K0–K10, §5, §6).
The implementer's notes: devtasks/HANDOFF-copy-objects.md (§4 lists where the
code differs from the contract's wording, and why: check those, don't take them
on trust). A fresh Claude agent that didn't write the code checked it first;
its findings and what was done about them are in the handoff's §7.

Please put the reviewed 40-character SHA in the FIRST LINE of your review.

STEP 1 — GET THE CODE
  git clone https://github.com/joshmaurice/atrium && cd atrium
  git fetch origin claude/copy-objects && git checkout __SHA__
  git diff ace29de HEAD
Say whether the clone worked; if not, quote the error and use
  https://github.com/joshmaurice/atrium/compare/ace29de...__SHA__
and raw files at https://raw.githubusercontent.com/joshmaurice/atrium/__SHA__/<path>

STEP 2 — IF YOU HAVE A CLONE (Node 22, pnpm 10)
  pnpm install --frozen-lockfile --ignore-scripts
  (cd packages/server && timeout 180 node --test test/world-host-payload-cap.test.js)
  (cd packages/server && timeout 180 node --test test/credit-check.test.js)
  (cd packages/server && timeout 180 node --test test/copy-objects.test.js)   # needs better-sqlite3 built
  (cd packages/protocol && node --test test/copy-objects-schema.test.js)
  (cd packages/client && node --test tests/copy-objects-hello.test.js tests/copy-objects-e2e.test.js)
  (cd apps/client && node --test tests/copy-paste.test.js tests/edit-duplicate-credit.test.js tests/copy-objects-wiring.test.js)
Quote the counts. Server test files one at a time (a batched server run hangs).
Most valuable: a probe of your own that breaks a claim, with code and output.
packages/client/tests/copy-objects-e2e.test.js has the harness: two real
servers on port 0 (two origins), real AtriumClients, the real Undo engine and
the real behaviour runner.

THE CHANGED FILES
  packages/server/src/world-host.js, world-registry.js   K0: the 1 MiB cap
  packages/server/src/session.js        K1: hello.world (the owner lookup)
  packages/server/src/send-policy.js    K3: creditProblem, in checkAtriumExtras
  packages/protocol/src/schemas/hello.server.json   K1's schema
  packages/client/src/AtriumClient.js   K1: worldFromHello, client.world and its resets
  apps/client/src/edit-duplicate.js     K3: the client's creditProblem, atriumProblem's { credit: false }
  apps/client/src/copy-paste.js (new)   K2, K5–K8: copyObject, preparePaste, the panels' text
  apps/client/src/graph-import.js       K7: the Enable question's text
  apps/client/src/behavior-form.js      K7: the record, the question's inWorld
  apps/client/src/edit-modes.js         K4: Inspect
  apps/client/src/app.js, index.html    K4, K6, K9: the glue
  tests/fixtures/credit-vectors.json    the vectors both credit checks read
  devtasks/spike-richer-add/p6-db-survey.mjs   the host survey's counters
  and their tests

WHAT TO CHECK, in order
1. K7, your M1: can any foreign object id survive a paste into another world,
   in nodeMap (from entry 1), targets, animations[].object or
   template.params.target? Can a hostile source make a paste count as "the
   same world" when it isn't (another server can send any hello and any
   som-dump)? Does every index still bind to the entry it did? The record and
   its chains.
2. K8: model URLs and pad destinations across origins; the other-host question
   whatever the origins (your S3); the Library rule; the source base from the
   live connection, never the File box.
3. K2/K3: are the server's and the client's credit checks identical in
   behaviour (prototype keys, non-plain objects, lone surrogates, null vs
   absent)? K2's fill order at Paste; a malformed credit not stopping Copy
   (your M2); `at` the Copy's day (your S4).
4. K1: the field-by-field client check and every reset; the owner lookup never
   refusing a hello.
5. K0: any WebSocketServer on the registry path without the cap.
6. The page glue (it has only been read, never run in a browser): Inspect's gate
   both ways, no `activate` from an Inspect click, hidden objects not picked,
   textContent only; Paste's own answer branch; anything in app.js that would
   throw at load or on a click.
7. The tests: would they catch a regression, and does any pass for the wrong
   reason?

OUTPUT
- First line: the reviewed 40-character SHA.
- Verdict: APPROVE / APPROVE WITH NITS / CHANGES REQUESTED.
- Findings with severity (must-fix / should-fix / nit), file:line, a concrete
  failure scenario, and how you know: REPRODUCED, CONFIRMED IN THE SOURCE, or
  INFERRED.
- What you ran, and what you couldn't. Never report something unrun as passing.
- Please give the review as text in your reply (not only as a download), so it
  can be pasted whole.
