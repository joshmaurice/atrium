You are an outside reviewer for Atrium, an open-source multiplayer glTF browser
(Node.js + Three.js, ES modules, no build step, pnpm workspaces). Review the
IMPLEMENTATION of a small round, `small-fixes`, before it is released.

**What it changes** (four separate items, no protocol change):
1. **SF-1:** signing in or registering in a tab that is connected to a world
   as a guest now reconnects to the SAME world as the signed-in user. Before,
   the tab kept the guest socket: the top bar showed the user, but the world
   still treated the tab as anonymous (no Edit) until a reconnect.
2. **SF-2:** the Edit panel's refresh runs on every `som:set`, and a
   behaviour that turns an object sends one a frame. Every control was
   rewritten about 35 times a second with unchanged values (the operator saw
   "Move to" flicker). Now properties are written only when they change.
3. **SF-3:** the graph import panel could not target an object without an
   `objectId` (a group made by Group), not even the object it was imported
   onto: the conversion was refused before Save. Now the own node maps to
   `mapping.own`, other id-less targets use stand-ins for the preview, and
   Save gives each one an id in its own stage before sending the leaf.
4. **SF-4:** the saved-worlds list is one row: a drop-down of the worlds,
   then the Public switch, Load and Delete for the chosen one.

**Your job** is to find what is wrong, missing or risky in the code, before
release. It is read-only: don't push, don't open PRs, and don't touch any
deployed site.

Repository: https://github.com/joshmaurice/atrium (public)
Branch: claude/small-fixes
Review commit: 163c12743c8f779dea845cf2c97f0ba36c130cfd
Contract: devtasks/PREBRIEF-small-fixes.md (Rev 1.0, §3 R1–R15; the
operator's decisions in §6; built before an outside review, by the
operator's way of working).
Base: b639d81 (main; PROD runs 33df9ef6, which differs only in devtasks/).
Review the diff: `git diff b639d81 163c12743c8f779dea845cf2c97f0ba36c130cfd -- apps packages`.
devtasks/HANDOFF-small-fixes.md is the implementer's record. Read it, but
test its claims rather than trusting them.

**Please put the reviewed 40-character SHA in the FIRST LINE of your review,
and say which model you are.**

STEP 1 — GET THE CODE
  git clone https://github.com/joshmaurice/atrium && cd atrium
  git fetch origin claude/small-fixes && git checkout 163c12743c8f779dea845cf2c97f0ba36c130cfd
Say whether the clone worked. If it didn't, read the files at the pinned
commit through
  https://raw.githubusercontent.com/joshmaurice/atrium/163c12743c8f779dea845cf2c97f0ba36c130cfd/<path>
A source-only review is still valuable; label it as one.

STEP 2 — RUN IT (Node 22, pnpm 10)
  pnpm install --frozen-lockfile --ignore-scripts
  # then build better-sqlite3 as AGENTS.md says
  (cd apps/client && node --test tests/small-fixes.test.js tests/graph-import-panel.test.js tests/signin-sync.test.js)
  (cd apps/client && node --test tests/*.test.js)     # the whole client app suite
The browser harness (devtasks/harness/, see its README) runs the real page
and the REAL server with real sign-in (checks/signin-sync/authserver.mjs)
for Playwright. If you can, run this round's probes and check:
  HARNESS_ROOT=/tmp/atrium-harness devtasks/harness/setup.sh $(git rev-parse HEAD)
  HOOKS=1 HARNESS_ROOT=/tmp/atrium-harness node devtasks/harness/checks/signin-sync/authserver.mjs &
  HARNESS_ROOT=/tmp/atrium-harness python3 devtasks/spike-small-fixes/r1_signin.py --expect-fixed
  HARNESS_ROOT=/tmp/atrium-harness python3 devtasks/spike-small-fixes/r2_flicker.py --expect-fixed
  HARNESS_ROOT=/tmp/atrium-harness python3 devtasks/spike-small-fixes/r3_target.py --expect-fixed
  HARNESS_ROOT=/tmp/atrium-harness python3 devtasks/harness/checks/small-fixes/w1.py
Start servers with a long-lived background process; a short command
timeout kills them mid-run.

THE FILES THAT MATTER
  apps/client/src/auth-sync.js           ownLoginPlan
  apps/client/src/app.js                 handleAuthSubmit, reconnectSignedIn;
                                         refreshEditActions, refreshGroupActions;
                                         renderWorldList and wbSyncChoice
  apps/client/src/dom-write.js           setIfChanged (new)
  apps/client/src/behavior-form.js       show/text helpers, renderList, render
  apps/client/src/graph-import-panel.js  heldNode, normaliseHeld, idForHeld,
                                         idlessTargets, mappingFor, save,
                                         nextStage, cancelSave, sendLeaf, onAnswer

WHERE TO SPEND THE TIME, in order
1. **SF-3's Save sequence.** Can a stand-in id ever reach a send? Can a
   refused, superseded or cancelled stage leave the panel stuck saving, or
   leave a row holding an id the server never gave? The panel closed or the
   selection changed mid-sequence; the own node removed; two rows on the
   same id-less node; a node that gets an id from another tab between
   stages; two nodes with the same name.
2. **SF-1's reconnect.** Could it loop, or race the I4 change handling (a
   BroadcastChannel message from this tab's own login, `applyChange`, the
   `session:ready` backstop)? A cross-origin world, a static (file) world,
   an unknown `signedIn` (an older server). A failed reconnect: what does
   the user see?
3. **SF-2.** Any write now skipped that must happen: a property changed by
   another code path between two refreshes; a comparison that is wrong for
   a property's type. Whether `renderList`'s cache can disagree with the DOM.
4. **SF-4.** The toggle, Load and Delete acting on the right world when the
   choice changes while a request is in flight; names reaching the DOM as
   text; the reset on sign-out; the choice rules (R13).

REPORT
A verdict (APPROVE, APPROVE WITH NITS, CHANGES REQUESTED), then numbered
findings tagged MUST-FIX / SHOULD-FIX / NIT, each with file:line, what goes
wrong, and how you know (a test or probe you ran, or "inferred from the
source"). Then what you checked and found sound, and what you could not
check. Save it as REVIEW-small-fixes-code-<model>.md.
