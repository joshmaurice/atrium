You are an outside reviewer for Atrium, an open-source multiplayer glTF browser
(Node.js + Three.js, ES modules, no build step, pnpm workspaces). Review the
IMPLEMENTATION of its next round, `grouping`, before it is released.

**What it adds:** the world's owner, in the Edit panel, can:
- put the selected object into a new group (**Group**);
- take a group apart (**Ungroup**);
- move an object into or out of a group (**Move to…**);
- reach groups with no shape through an **Empty groups** dropdown.

Each action keeps world placement and is undoable.

**On the wire:** one new edit, a `send` with `field: 'parent'`. Its value
carries the new parent and the exact local placement. The server:
- applies it atomically;
- bounds the groups users make;
- refuses changes that would alter which behaviours may move a node;
- refuses an unreloaded tab at Connect.

**Your job** is to find what is wrong, missing or risky in the code, before
release. It is read-only: don't push, don't open PRs, and don't touch any
deployed site.

Repository: https://github.com/joshmaurice/atrium (public)
Branch: claude/grouping
Review commit: e9886572d173af5960af4898c77df35b73722b3e
Contract: devtasks/PREBRIEF-grouping.md (FINAL Rev 2.0, every decision taken by
the operator, GR-L1 to GR-L12). Its line numbers refer to 172b816d (main, the
released code). The line numbers below refer to the review commit.
The implementation: commits de33cf8..e988657 (seven; `git log de33cf8..e988657`).
devtasks/HANDOFF-grouping.md is the implementer's record: the commits, the
harness checks, the proofs, the suites. Read it, but test its claims rather
than trusting them.

**What has already been done:**
- **A fresh Claude agent code-checked the work at 9716caf.** Its report and
  reproduction scripts are in devtasks/spike-grouping/code-check/. Commit 7
  (e988657) took findings 1–5 (the handoff's §7). Don't redo those findings:
  test the fixes, and whether they introduced anything new.
- **The design's earlier probes** are in devtasks/spike-grouping/{fresh,review,review2}/.

**Please put the reviewed 40-character SHA in the FIRST LINE of your review,
and say which model you are.**

STEP 1 — GET THE CODE
  git clone https://github.com/joshmaurice/atrium && cd atrium
  git fetch origin claude/grouping && git checkout e9886572d173af5960af4898c77df35b73722b3e
Say whether the clone worked. If it didn't, quote the error and read the files
at the pinned commit through
  https://raw.githubusercontent.com/joshmaurice/atrium/e9886572d173af5960af4898c77df35b73722b3e/<path>
A source-only review is still valuable; label it as one.

STEP 2 — IF YOU HAVE A CLONE (Node 22, pnpm 10)
  pnpm install --frozen-lockfile --ignore-scripts
  (cd node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 && npm run install)   # the native module; without it the database tests fail
  node --test packages/som/test/reparent.test.js
  (cd packages/server && timeout 180 node --test test/grouping.test.js)
  (cd packages/server && timeout 180 node --test test/grouping-counts.test.js)
  node --test packages/client/tests/grouping-move.test.js
  (cd apps/client && node --test tests/grouping-edit-group.test.js tests/grouping-undo.test.js tests/grouping-wiring.test.js)
  python3 devtasks/harness/checks/grouping/proofs.py      # breaks 28 mechanisms one at a time; each should turn its test red (restores every file)

**Run server test files one at a time, under `timeout 180`.** Never compare two
glTF-Transform objects with assert.equal (AGENTS.md says why).

**Most valuable:** a small probe of your own that breaks a claim the code
relies on, with its code and output. These modules can be driven from Node
with a real document from tests/fixtures/space.gltf:
- apps/client/src/edit-group.js, edit-undo.js, edit-duplicate.js;
- packages/som/src/SOMDocument.js;
- packages/server/src/send-policy.js and session.js (attachSessionHandlers
  on port 0, as packages/server/test/grouping.test.js does).

devtasks/harness/ (see its README) runs the real page and a world server
locally for Playwright. devtasks/harness/checks/grouping/ holds smoke.py and
c1.py–c5.py: real mouse, two tabs, the DEV acceptance steps.

THE FILES THAT MATTER (line numbers at e9886572)
  packages/som/src/SOMDocument.js      reparentNode L421, reparentProblem L440
  packages/server/src/send-policy.js   checkParentValue L2616; treeCounts L2670, moveCounts L2693,
                                       treeBoundsProblem L2715, descriptorCounts L2730;
                                       inSourceContainer L2750, behaviorAncestorsChange L2767
  packages/server/src/session.js       parentChangeProblem L163 (GR3's order); STALE_HELLO_MESSAGE L221;
                                       isStaleEditor L247; canRunBehaviors L650; the stale hello L846;
                                       the hello's host election L944; the stale send L1292;
                                       a parented add's bounds L1523
  packages/server/src/world.js         the parent branch and reparent(), both world kinds: L573, L597, L602, L744
  packages/client/src/AtriumClient.js  hello addFields L834; moveNode L1416; _applyReparent L1442
  packages/client/src/add-spec.js      the client's copies: treeCounts L596, descriptorCounts L658
  apps/client/src/edit-group.js        moveValue L67, groupPlan L120, ungroupPlan L135, bareNodes L173,
                                       moveProblem L268, moveTargets L293, deleteUndoProblem L357
  apps/client/src/edit-undo.js         openRemovalWindow L516, reCapture L542, onAccepted L607,
                                       onStructureAnswer L678, checkComposite L815, runPhase L928,
                                       moveTo L1014, group L1040, ungroup L1105, startCompositeEntry L1165,
                                       checkEntry L1291
  apps/client/src/app.js               som:desync L1145; the engine's structural dep L1962;
                                       AFTER_DIALOG_MS L3360, Delete L3361; the GR8 block L3402ff
                                       (refreshGroupActions L3633, som:reparent L3661)
  apps/client/src/edit-structure.js    reparentSeen L122
  tools/som-inspector/src/app.js       its som:reparent L315

WHERE TO SPEND THE TIME, in order
1. **The Undo engine's composites** (GR7): `move`, `group`, `ungroup` and
   their Undo and Redo.
   - Trace each against another tab's rename, delete, move, regroup and
     transform of the same nodes, before and during each phase, and against
     answers in unusual orders, refusals mid-composite and a disconnect.
   - Can the engine be left in flight, record a wrong entry, or write a
     wrong-frame value?
   - Commit 7's runPhase change stops a composite whose later step can't be
     sent. Is every composite's onPhase right for that stand-in refusal?
2. **The server's rules** (GR3–GR5): the check order, the bounds on moves and
   on parented adds, the behaviour rule, and the stale-tab refusals (at
   hello, send, add, remove, and both places that elect the host).
   - Is there a way to make a cycle, an oversized group, an external or
     avatar parent, or a silent behaviour grant?
3. **The client** (GR6 and GR8):
   - Changes apply only on the server's answer, and the event order is
     `som:reparent`, then a `parent` `som:set`, then three transform
     `som:set`s marked remote.
   - Another tab's drag is cancelled on `som:reparent`, its records marked
     remote first.
   - Also check the enable rules, the Move to list and its re-check, the
     ask-first questions and the wait after them, Empty groups, the
     selection afterwards and the breadcrumb.
   - Any path where an object visibly jumps, for this tab or another?
4. **Existing content:** atrium.gltf's groups, the commons, models, teleporter
   pads, cameras and lights, hidden parts, animated nodes, external
   containers. Does anything behave wrongly?
5. **The tests and proofs:** would each proof fail for the reason it states?
   Is any test green whatever the code does? Does every new test fail on
   172b816d (or is it named as a guard)?

OUTPUT (the shape of earlier reviews)
- **Verdict:** APPROVE / APPROVE WITH NITS / CHANGES REQUESTED. Put the
  reviewed 40-character SHA and your model in your first lines.
- **Findings,** each with:
  - severity (must-fix / should-fix / nit);
  - file:line at the reviewed commit;
  - a concrete failure scenario;
  - how you know it: REPRODUCED (you ran it), CONFIRMED IN THE SOURCE, or
    INFERRED.
- **What you ran, and what you couldn't.** Never report something unrun as
  passing.
