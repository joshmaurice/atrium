# Handoff: `touch-nav`, implemented on `claude/touch-nav`

**IMPLEMENTED; the fresh-agent code check (§5) taken; the outside code
review not yet run; released only after `grouping` is `COMPLETE` on PROD**
(TN-L0 (a)). This file is also the working note: if a session loses its
context, start here, then `git log` on the branch.

**Contract:** `devtasks/PREBRIEF-touch-nav.md` Rev 1.1. Every decision was
taken by the operator on 2026-11-10 (voice, about 14:10 PT, then text at
14:15 PT, "Okay go ahead with that please"): build now, Android Chrome, and
every other TN-L as recommended. **Not a FINAL pre-brief reviewed before
building:** the operator chose to build first (TN-L0 (a)); the outside
review reads the contract and the code together.
**Base:** `b37c482`, the tip of `claude/grouping` (grouping's release
candidate `98f916c6` plus `devtasks/` notes). **Rebase onto grouping's final
tip before release** if grouping's DEV acceptance changes anything.
**Implemented by Claude** (Opus 5.5), 2026-11-10.

## 1. What changed (6 files of code and tests, +710/−22 at `4391460`)
- `packages/client/src/NavigationController.js` (T1): `setMoveInput`
  (analog, a held key wins), `onTouchLook` (0.005 rad/px), `onPinch`
  (ORBIT), `moveInput`; `onMouseMove` now calls a shared `_look`.
- `apps/client/src/touch-nav.js` (T2, new, pure): the gesture machine.
- `apps/client/index.html` (T3): `touch-action: none` on the canvas;
  `#touch-stick` (96 px ring with a knob) and `#touch-fp` at the bottom left.
- `apps/client/src/app.js` (T4): the touch state beside `hudHintEl` (L86–92,
  because `updateHintText` reads it); `updateHintText` calls
  `updateTouchUI` and gives the touch hint (L651–667); V's body moved into
  `toggleFirstPerson()` (L4129); the touch wiring after the wheel listener
  (L4150–4240: `touchHint`, `updateTouchUI`, `applyTouch`, the click
  swallow, `resetTouch`, the pointer listeners, blur and hidden-page resets,
  the button); `teardownWorld` resets touch; the mode switcher resets it.
  None of grouping's hunks are in these ranges.
- Tests: `packages/client/tests/navigation-touch.test.js`,
  `apps/client/tests/touch-nav.test.js`.

## 2. Found while building
- **A short drag also clicked** (pre-brief T2's last item): Chrome sends a
  `click` for a touch drag inside its own tap slop, so a 6 px look-drag on a
  cube in Edit selected it. Fixed by swallowing the next click on the
  viewport after a finger that looked or pinched (harness t3b).
- **The emulated page pans sideways** when a field in the 795 px top bar is
  focused; every touch then lands 211 px off. A harness matter only (the
  operator's phone works), handled in `tn_lib.py`'s `home()`.
- **At 390 px the Edit panel covers the middle of the view.** Editing
  works on the operator's phone; t6 aims left of the panel.

## 3. Checks
See the pre-brief §5: unit tests (T1 10, T2 18; client app suite 1,853
pass), the harness `checks/touch-nav/tn.py` 23/23 PASS, selection-parts
`c1`, `c3`, `c5` and grouping's `smoke.py` pass. Probes 1–4 in
`devtasks/spike-touch-nav/`.

To run the harness checks:
```
HARNESS_ROOT=/tmp/atrium-harness devtasks/harness/setup.sh $(git rev-parse HEAD)
HARNESS_ROOT=/tmp/atrium-harness node /tmp/atrium-harness/harness/server.mjs   # background
HARNESS_ROOT=/tmp/atrium-harness python3 devtasks/harness/checks/touch-nav/tn.py
```

## 4. Next
1. The outside code review (`devtasks/OUTSIDE-CODE-REVIEW-PROMPT-touch-nav.md`).
2. After `grouping` is `COMPLETE` on PROD: rebase onto it if needed, rerun
   §3, then the release path (DEV deploy; acceptance on the operator's
   Android Chrome: the feel of the stick and look speed, a pad walked onto,
   Edit taps and a handle drag, two thumbs; then MAIN and PROD).
3. Tuning on the phone may change `touchSensitivity` (0.005),
   `STICK_RADIUS_PX` (48) and `STICK_DEAD_ZONE` (0.12): constants, no design
   change.

## 5. The fresh-agent code check
(pending)
