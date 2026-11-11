# Handoff: `touch-nav`, implemented on `claude/touch-nav`

**IMPLEMENTED; the fresh-agent code check (§5) and the outside code review
(§6, source-only) taken; a second, running review pass is still owed; released only after `grouping` is `COMPLETE` on PROD**
(TN-L0 (a)). This file is also the working note: if a session loses its
context, start here, then `git log` on the branch.

**Contract:** `devtasks/PREBRIEF-touch-nav.md` Rev 1.3. Every decision was
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
  `updateTouchUI` and gives the touch hint; V's body moved into
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
   `TOUCH_LOOK_SLOP_PX` (10), `STICK_RADIUS_PX` (48) and `STICK_DEAD_ZONE`
   (0.12): constants, no design change.
4. At the phone acceptance, besides the feel (the review's list): 20 quick
   thumb taps on an object, counting the misses (S-1); a tap on an object and
   on First person with the stick held (S-2); a second finger during a
   handle drag (S-3); tap the World field, close the keyboard, get the view
   back (N-3); the button with a tall Edit panel open (N-4); a thumb on the
   ring's left rim, where Android's edge swipe-back begins.

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

## 6. The outside code review (Fable 5.2, source-only, at `cba7f8b5`)
- **The review:** `devtasks/REVIEW-touch-nav-code-fable.md`, copied from the
  reviewing session's chat. Verdict **APPROVE WITH NITS, provisional**: no
  must-fix, four should-fix, six nits. **Source-only:** that session wasn't
  allowed to run the code, so a second pass that runs the suites and `tn.py`
  is still owed (the prompt, re-pinned, is
  `OUTSIDE-CODE-REVIEW-PROMPT-touch-nav.md`).
- **Process:** each finding reproduced on the real page before it was taken
  (`spike-touch-nav/probe7.py`, `dbg` runs recorded below), then a harness
  check that fails at `cba7f8b5` for it.

| # | Finding | Reproduced | Fix (`c091256`..`31b538a`) |
|---|---|---|---|
| S-1 | should-fix: the look began at the mouse's 4 px, so a tap that rolls 5 px turned the view and its click was swallowed | probe 7: a 5 px rolling tap on the cube in Edit: nothing selected, Δyaw −0.025, Chrome's click sent and swallowed | `TOUCH_LOOK_SLOP_PX` = 10, above Chrome on Android's 8 dp tap slop. t3d: a 5 px roll selects and doesn't look; t3b: a 12 px drag looks, Chrome's click (1 sent) is swallowed (0 seen) |
| S-2 | should-fix: with a thumb on the stick, Chrome sends no click for a tap, so select, Inspect, activate and First person did nothing | probe 7: 0 clicks for a tap on the cube and on the button with the stick held | `up()` returns `{ type: 'tap' }` for a view finger that never looked while the stick was held; the page makes the compatibility mousedown, mouseup and click (and drops a real click if one follows). The button acts on a touch `pointerup`. t3e, t3f, t3g. **Limit (recorded):** Edit panel buttons still need the stick let go |
| S-3 | should-fix: a second finger during a handle drag steered the object | `dbg11` at `cba7f8b5`: the cube jumped **1.90** while a second finger moved on the view (first finger settled) | While a handle drags, the canvas hears only the finger that pressed it before the drag began (T17's 4 px means `dragging` isn't set at the press); the handle press ignores non-primary touches. t6b: jump 0.0000, and the first finger drags on (0.143) after the second lifts |
| S-4 | should-fix: no check that the stick lets go | read | t10 (after the teleport), t10a cancel, t10b ORBIT, t10c blur, t10d hidden page, t10e disconnect. **Proof:** with `pointercancel`, `blur` and the hidden-page listener removed from the served `app.js`, t10a, t10c and t10d FAIL (32/35); ORBIT and disconnect each have a second path that lets go |
| N-1 | the stick and First person show in a static world | read | the stick stays (a static world walks by it, as by WASD); First person and its hint only while connected. t11 |
| N-2 | tests green whatever the code does | read | the pinch's bad ratios at radius 10; the up/cancel loop is one honest test; t8 is a touch tap and asserts "back"; t3b counts clicks sent against clicks seen; a FAIL makes `tn.py` exit 1 |
| N-3 | the canvas can't pan the page back | — | a phone acceptance item (§4) |
| N-4 | the First person button can sit under a tall Edit panel at 390 px | — | a phone acceptance item (§4); move it if it does |
| N-5 | only a touch press disarmed the swallow | read | any `pointerdown` disarms it |
| N-6 | records | read | the revisions and counts here and in the pre-brief |

**Harness notes (for anyone extending `tn.py`):**
- On this page Chromium's CDP touch emulation often withholds one finger's
  release until every finger lifts (`dbg10`: two fingers on the canvas,
  Edit on or off). That left touches stuck and broke later checks. So a
  **second** finger is sent as in-page PointerEvents (`tn_lib.synth`), with
  the first finger real. A synthetic move needs `button` −1, as TransformControls
  ignores any other; synthetic ids (900+) can't be captured, so `synth`
  shims pointer capture for them.
- A real finger's moves reach the page a frame late: read positions after it
  settles (probe 7's 0.048 "jump" was the first finger's own lag).
- t5 strafes through the atrium's wall; t3 starts back at the spawn point,
  and the pad check starts 6 m from it (a pad near spawn stays disarmed).

**After the fixes** (`31b538a`): `tn.py` **35/35**; the client app suite
1,860 pass; `packages/client` 770 pass; the T2 tests 23, the T1 tests 10;
selection-parts `c1` (29), `c3` (30), `c5` (10) and grouping's `smoke.py` (7)
all pass.
