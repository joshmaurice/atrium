You are an outside reviewer for Atrium, an open-source multiplayer glTF browser
(Node.js + Three.js, ES modules, no build step, pnpm workspaces). Review the
DESIGN PRE-BRIEF for its next round, `copy-objects`: copying a single object
while visiting any world you can see, and pasting it into a world you can edit,
with credit, a rule for its behaviour, and a rule for URLs that mean "this
server". The round also fixes a missing 1 MiB message cap on the production
path (K0). Nothing is implemented yet. Your job is to find what is wrong,
missing or risky before it is. Read-only: don't push, don't open PRs, don't
touch any deployed site.

Repository: https://github.com/joshmaurice/atrium (public)
Review commit: 2746d6634db08501273f3bf68faf77aeda021e2f
Document: devtasks/PREBRIEF-copy-objects.md (DRAFT Rev 1.2)
Its line numbers refer to code at f286d283ac1cd6a8520192533c5bb6faaf177bba,
whose code is the released code (PROD, 3fcc296c). The review commit differs from
it only in devtasks/ and docs/.
What it builds on: devtasks/PREBRIEF-richer-add.md (FINAL Rev 2, shipped) and
devtasks/PREBRIEF-add-check.md (FINAL Rev 1.1, shipped). You reviewed an earlier
combined draft of this design twice (devtasks/REVIEW-richer-add-copy-rev0.1-chatgpt.md
and -chatgpt-2.md); the pre-brief cites those as GR and GR2.

STEP 1 — GET THE CODE (please try this first)
  git clone https://github.com/joshmaurice/atrium && cd atrium
  git checkout 2746d6634db08501273f3bf68faf77aeda021e2f
Say in your review whether the clone worked; if not, quote the error (it has
failed on DNS before) and read the files at the pinned commit through
  https://raw.githubusercontent.com/joshmaurice/atrium/2746d6634db08501273f3bf68faf77aeda021e2f/<path>
A source-only review is still valuable; label it as one.

STEP 2 — IF YOU HAVE A CLONE (Node 22, pnpm 10)
  pnpm install --frozen-lockfile --ignore-scripts
  (cd packages/server && timeout 180 node --test test/payload-cap.test.js)
  (cd packages/server && timeout 180 node --test test/script-host.test.js)
  (cd apps/client && node --test tests/edit-duplicate.test.js tests/behavior-form.test.js)
Run server test files one at a time. Most valuable: a small probe of your own
that breaks a claim the design relies on, with code and output. For K0, a probe
that sends a message over 1 MiB through `createWorldHost` (world-host.js) and
shows it accepted today.

THE FILES THAT MATTER (at the pinned commit)
  packages/server/src/world-host.js           the WebSocketServer L46 (K0)
  packages/server/src/session.js              MAX_PAYLOAD_BYTES L31, L306; hello L769–876
  packages/server/src/send-policy.js          checkAtriumExtras L166–207 (K3)
  packages/server/src/world-registry.js       address forms L101–157, home admission L268–281
  packages/protocol/src/schemas/hello.server.json                       (K1)
  packages/client/src/AtriumClient.js         signedIn's resets L640, L850, L908, L973 (K1)
  packages/client/src/model-spec.js           modelUrlProblem L76, resolveModelUrl L123 (K8)
  packages/behaviors/src/behavior-spec.js     EXECUTABLE L116, behaviorCheck L606–830, pointerBinding L910
  packages/behaviors/src/templates.js         mapsFor L63–67
  apps/client/src/edit-duplicate.js           atriumProblem L101, buildDescriptor L256, remapBehaviorTargets L362, prepareDuplicate L403
  apps/client/src/behavior-form.js            the target picker L926–933, matchesTemplate L164
  apps/client/src/graph-import.js             shouldPromptEnable L537, enablePromptText L550
  apps/client/src/wsUrl.js                    resolveWorldAddress L167 (K8)
  apps/client/src/app.js                      canEditNow L1582, the edit hit-test L2125–2148, pad resolution L586, onStructureAnswer L2869

WHERE TO SPEND THE TIME, in order
1. CP-L5 (c), the behaviour rule. It departs from what all three earlier
   reviews asked for (yours included: neutralise every foreign reference, or
   omit the behaviour). The rule: from another world, keep every id as it is
   EXCEPT those that match an object in the destination world or its Undo
   stack, which are replaced by fresh ids; the behaviour arrives disabled. The
   reasoning: ids are random and every add stamps a new one, so a foreign id
   reaches nothing in another world and can only match one of yours on purpose.
   Test that reasoning: is there any way a kept foreign id can come to name an
   object in the destination, now or later (Undo, Redo, a later paste, a
   restore, a world template, the commons seed, healing at load, a `send`)?
   Can a kept reference to nothing still do harm (reads, events, animations,
   the enable prompt)? Is "matches" checked against the right set, at the
   right time?
2. K0: is `maxPayload` on `createWorldHost`'s server the whole fix? Any other
   socket on the production path without it? What breaks when it lands
   (legitimate messages near 1 MiB, the client's 1,000,000-byte Duplicate cap)?
3. K1–K3, the credit: `hello`'s new `world` field against older and newer
   clients and servers (`additionalProperties`), test worlds with no database,
   a hostile server's values; K2's table and fill order; whether the server's
   form check and the client's mirror can disagree.
4. K6–K8, paste: the snapshot, the name and placement, which `extras` survive,
   URL resolution across servers (models and pad destinations), the refusal
   and no-answer paths, the size cap after the credit is added.
5. K4, Inspect: hidden objects, `activate`, pointer lock, avatars, and text
   from other users rendered safely.
6. §5's tests, proofs and §6's file list: complete for §4? Anything that can't
   be tested as written?

OUTPUT (the shape of your earlier reviews)
- Verdict: APPROVE / APPROVE WITH NITS / CHANGES REQUESTED, naming the
  reviewed 40-character SHA in your first lines.
- Findings, each with severity (must-fix / should-fix / nit), file:line at the
  reviewed commit, a concrete failure scenario, and how you know it:
  REPRODUCED (you ran it), CONFIRMED IN THE SOURCE, or INFERRED.
- What you ran, and what you couldn't. Never report something unrun as passing.
