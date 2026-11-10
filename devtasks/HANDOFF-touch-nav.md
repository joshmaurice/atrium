# Handoff: `touch-nav`, implemented on `claude/touch-nav`

**IMPLEMENTED; the fresh-agent code check (§5) taken (`c8dbbd0`); the outside code
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

## 1. What changed (6 files of code and tests)
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

## 5. The fresh-agent code check (at `4391460`)
A fresh Claude agent (general-purpose, no context from the building session)
read the contract and the diff, and ran scratch probes. Verdict **CHANGES
REQUESTED**: one should-fix, nits. Each finding was reproduced before it was
taken; the fixes are commit `c8dbbd0`.

| # | Finding | Reproduced | Fix (`c8dbbd0`) |
|---|---|---|---|
| F1 | should-fix: every look armed the click swallow for 500 ms, but Chrome sends no click after a drag past its tap slop, so the next tap within 500 ms on anything in `#viewport` (the First person button, the Edit panel) was eaten | `spike-touch-nav/probe6.py` on the real page at `4391460`: a 60 px touch look, then the button's click: `buttonWorked: False`. (probe 5's real-gesture try couldn't: the emulated page took 2.3 s between the look and the tap) | Only a click on the **canvas** is swallowed, and the next touch `pointerdown` disarms it. probe 6 after: `buttonWorked: True`, and the short drag's canvas click is still swallowed (`reached: 0`) |
| F2 | nit (inferred): a swallowed short look might count toward a double-tap and drill | `probe5.py`: a 6 px look on `Table-Center-Top`, then a tap 0.12 s later: two clicks, both `detail` 1, and the selection is `Furniture`, the same as a plain tap | Not reproduced; nothing changed. To watch at DEV on the phone |
| F3 | nit: the hint differed from T4's wording (WALK lacked "👤 first person"; Inspect differed) | read | `touchHint()` as the contract words it |
| — | note: a finger whose release is lost stays tracked, so the next finger pinches | the agent's probe 3 | `down({ primary })`: a primary touch (no other finger down) drops whatever is still tracked and stops the stick. Two unit tests |
| — | nit: on a touch laptop a tap on the button takes focus off the canvas, so WASD stop | read | the button gives focus back to the canvas |

Checked and found OK by the agent: load order (no TDZ at load), when the
stick shows (disconnect, ORBIT, a world whose first mode is ORBIT), pointer
capture and TransformControls, V and the button sharing
`toggleFirstPerson`, mouse/key/wheel unchanged, the controller's rules.

After the fixes: the T2 unit tests 20/20, the client app suite 1,856 pass,
the navigation tests 33, the harness `tn.py` 23/23.
