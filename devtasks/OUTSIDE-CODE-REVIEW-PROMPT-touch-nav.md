You are an outside reviewer for Atrium, an open-source multiplayer glTF browser
(Node.js + Three.js, ES modules, no build step, pnpm workspaces). Review the
IMPLEMENTATION of a small round, `touch-nav`, before it is released.

**What it adds:** walking and looking on a phone. Before it, a touch drag
did nothing (the browser took it for panning, and the look-drag listened to
`mousemove` only), so a phone user could see a world but not move through it
or walk onto a teleporter pad. Now, on a touch screen:
- a one-finger drag on the view looks (WALK) or orbits (ORBIT);
- an on-screen stick at the bottom left walks, faster the further it is
  pushed (analog, with a dead zone);
- a two-finger pinch zooms ORBIT;
- a tap stays a tap (select in Edit, `activate` outside it), and a drag that
  looked swallows the click Chrome may still send;
- a "First person" button does what the V key does;
- the stick shows only after the first touch, with an avatar, outside ORBIT;
  in Edit and Inspect too.
Mouse, keyboard and wheel are meant to be unchanged. No protocol change.

**Your job** is to find what is wrong, missing or risky in the code, before
release. It is read-only: don't push, don't open PRs, and don't touch any
deployed site.

Repository: https://github.com/joshmaurice/atrium (public)
Branch: claude/touch-nav
Review commit: 5dba62f453da4067e05b5788c51a6086c4ea7712
Contract: devtasks/PREBRIEF-touch-nav.md (Rev 1.3, §4 T1–T5; every decision
taken by the operator; built before an outside review, by the operator's
choice).
Base: b37c482 (the tip of claude/grouping, an unreleased round; review only
the touch-nav diff: `git diff b37c482 5dba62f453da4067e05b5788c51a6086c4ea7712 -- apps packages`).
devtasks/HANDOFF-touch-nav.md is the implementer's record. Read it, but test
its claims rather than trusting them.

**What has already been done:**
- A fresh Claude agent code-checked the work (the handoff's §5).
- **A first outside review** (Claude Fable 5.2, `devtasks/REVIEW-touch-nav-code-fable.md`)
  read the code at cba7f8b5 but **was not allowed to run it**. Its four
  should-fix and six nits were reproduced and taken (the handoff's §6).
  **This pass should RUN the code:** STEP 2's tests and, if you can, the
  harness's `tn.py`. Test the fixes (a 10 px look slop, the made-up click
  for a tap with the stick held, one finger driving a handle, the reset
  checks) and whether they introduced anything new.

**Please put the reviewed 40-character SHA in the FIRST LINE of your review,
and say which model you are.**

STEP 1 — GET THE CODE
  git clone https://github.com/joshmaurice/atrium && cd atrium
  git fetch origin claude/touch-nav && git checkout 5dba62f453da4067e05b5788c51a6086c4ea7712
Say whether the clone worked. If it didn't, read the files at the pinned
commit through
  https://raw.githubusercontent.com/joshmaurice/atrium/5dba62f453da4067e05b5788c51a6086c4ea7712/<path>
A source-only review is still valuable; label it as one.

STEP 2 — IF YOU HAVE A CLONE (Node 22, pnpm 10)
  pnpm install --frozen-lockfile --ignore-scripts
  node --test packages/client/tests/navigation-touch.test.js packages/client/tests/navigation-controller.test.js
  (cd apps/client && node --test tests/touch-nav.test.js tests/import-guard.test.js)
  (cd apps/client && node --test tests/*.test.js)     # the whole client app suite (1,860 pass)
  HARNESS_ROOT=/tmp/atrium-harness devtasks/harness/setup.sh $(git rev-parse HEAD)
  HARNESS_ROOT=/tmp/atrium-harness node /tmp/atrium-harness/harness/server.mjs &   # then:
  HARNESS_ROOT=/tmp/atrium-harness python3 devtasks/harness/checks/touch-nav/tn.py   # 35 checks; exit 1 on a FAIL
devtasks/harness/ (see its README) runs the real page and a world server
locally for Playwright. devtasks/harness/checks/touch-nav/tn.py is this
round's browser check: Chromium at 390 × 844 with real CDP touch events
(tn_lib.py has the multi-finger helper).

THE FILES THAT MATTER
  packages/client/src/NavigationController.js   setMoveInput, tick's stick branch, onTouchLook, onPinch
  apps/client/src/touch-nav.js                  the whole file (pure)
  apps/client/src/app.js                        the touch state beside hudHintEl; updateHintText;
                                                toggleFirstPerson; the touch section after the wheel
                                                listener; teardownWorld; the mode switcher
  apps/client/index.html                        touch-action, #touch-stick, #touch-fp

WHERE TO SPEND THE TIME, in order
1. **Pointer ownership on a real phone** (Android Chrome is the target):
   can the stick stay pushed after the finger lifts (a lost `pointerup`, a
   `pointercancel`, a pointer captured elsewhere, the page hidden, a
   teleport mid-walk)? Can two fingers confuse stick, look and pinch?
2. **TransformControls and the tap paths:** a touch drag on a move handle
   must move the object, not look (B3); a tap must still select, Inspect and
   activate; the click swallow must not eat a real tap.
3. **Load order and state:** the touch state is declared near the top of
   app.js because `updateHintText` reads it; is there any path that runs
   before a declaration, or shows the stick with no avatar, in ORBIT, or
   after a disconnect?
4. **The mouse and keys:** is anything changed for a desktop user?
5. **The tests:** is any test green whatever the code does?

OUTPUT (the shape of earlier reviews)
- **Verdict:** APPROVE / APPROVE WITH NITS / CHANGES REQUESTED, with the
  reviewed 40-character SHA and your model in your first lines.
- **Findings,** each with severity (must-fix / should-fix / nit),
  file:line at the reviewed commit, a concrete failure scenario, and how you
  know it: REPRODUCED (you ran it), CONFIRMED IN THE SOURCE, or INFERRED.
- **What you ran, and what you couldn't.** Never report something unrun as
  passing.
