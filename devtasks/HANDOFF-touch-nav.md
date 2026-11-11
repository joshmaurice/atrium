# Handoff: `touch-nav`, implemented on `claude/touch-nav`

**IMPLEMENTED; the fresh-agent code check (§5) and three outside code
reviews (§6 source-only, §7 and §8 running the code; the third APPROVE WITH
NITS) taken; released only after `grouping` is `COMPLETE` on PROD**
(TN-L0 (a)). This file is also the working note: if a session loses its
context, start here, then `git log` on the branch.

**Contract:** `devtasks/PREBRIEF-touch-nav.md` Rev 1.5. Every decision was
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
   `TOUCH_LOOK_SLOP_PX` (10), `TAP_MAX_MS` (500), `STICK_RADIUS_PX` (48) and
   `STICK_DEAD_ZONE` (0.12): constants, no design change. For the feel:
   the first look sends the whole 10 px at once, a 2.9° step (N-12).
4. At the phone acceptance, besides the feel (the review's list): 20 quick
   thumb taps on an object, counting the misses (S-1); a tap on an object and
   on First person with the stick held (S-2); a second finger during a
   handle drag (S-3); tap the World field, close the keyboard, get the view
   back (N-3); the button with a tall Edit panel open (N-4); a thumb on the
   ring's left rim, where Android's edge swipe-back begins. From the second
   review: the stick held, then a tap and a drag on a move handle with the
   other hand (S-5); a handle drag interrupted by a system gesture, then a
   look and a tap (S-6); First person tapped while a world is still loading
   models (S-7); a thumb resting on the view while walking, then lifted
   (S-8); `visualViewport.scale` (N-8); and **whether Chrome really sends no
   click for a second finger's tap** (the made-up tap rests on it; no
   harness can show it).

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

## 7. The outside code review, second pass (Fable 5.2, ran the code, at `5dba62f4`)
- **The review:** `devtasks/REVIEW-touch-nav-code-fable-2.md` (copied from
  its chat); its probes p1–p4 in `spike-touch-nav/fable-2-probes/` (p5–p9
  were not in the chat). Verdict **CHANGES REQUESTED**: no must-fix, four
  should-fix (two of them, S-5 and S-6, introduced by §6's S-3 fix), six
  nits. It confirmed §6's other fixes, the suites (1,860; 770) and the
  regressions; `tn.py` passed 35/35, then 33/35 twice in a slower
  environment (S-7).
- Each finding reproduced at `5dba62f` before it was taken (Fable's own
  probes, rerun here, and `probe8.py`), fixed in `6f7f7de` (checks in `7e56f24`), and a `tn.py` check added that **fails at `5dba62f`** (run there:
  35/42, the failures t12a, t12c, t13a, t14a, t15, plus S-7's t3b and t8).

| # | Finding | Reproduced at `5dba62f` | Fix | Check |
|---|---|---|---|---|
| S-5 | with the stick held first, a handle press by another finger was measured by the stick thumb (a 2 px tap moved the object and sent; a 40 px drag moved nothing), and the next stick-held tap was eaten | Fable's p3: moved 0.0239 and sent; the 40 px drag 0.000 | the handle press is **the pointer that pressed**: a touch pressed while a handle drags is not a new press (`gizmo.dragging` is set at the press, before 4 px); only the pressing pointer's moves count; every new press clears the old verdict | t12a (0.0000), t12c (moves 0.46), t12b. p3 after: 0.0000, 0.0000, 0.4774 |
| S-6 | a cancelled handle-drag finger left `dragging` set, and the S-3 filter then kept every touch from the canvas: Edit dead for touch until Edit off | Fable's p4: dragging stays true through three taps; a look Δyaw 0.000 | a `pointercancel` of the handle finger ends the drag (`endHandleDrag`, its final send); so does a primary touch while a drag is under way (no other finger can be down), blur and a hidden page | t13a. p4 after: dragging false, a look −0.500 |
| S-7 | the 500 ms windows (the click swallow, the First person button) were timed from the handlers, so one slow frame defeated them; `tn.py` flaked | `probe8.py`: a 650 ms task after the release: one tap toggled First person twice | **flags, not clocks**: armed at the release, consumed by the click, cleared by the next press of any kind | t14a (a forced slow frame); `tn.py` 42/42 twice |
| S-8 | with the stick held, a cancelled finger, or one held seconds, made a click | Fable's p2: a cancel selected (1 click); a 2 s hold selected | no tap for a `pointercancel`, or for a finger down longer than `TAP_MAX_MS` (500 ms, the events' `timeStamp`s) | t15; unit tests. p2 after: 0 clicks each |
| N-7 | a touch tap on First person left focus on the button | read | both paths give focus back to the canvas | — |
| N-8 | the look slop is in CSS px; zoomed out it shrinks on screen | read | the page passes `slop` as `10 / visualViewport.scale` | unit test |
| N-9 | limits not written down | — | recorded in the pre-brief §4 (limits) | — |
| N-10 | checks blind to the code | Fable's mutations A1, A2 | t12 catches A1; t2a now timed in the page with a ceiling (1.40 m/s); unit tests for the long press, the cancel, the stick let go first, the zoom, ratio 1, and both pinch fingers swallowing; the dead store removed | — |
| N-11 | records | read | comments; the prompt's STEP 2 names the better-sqlite3 build | — |
| N-12 | the first look is a 2.9° step | — | the feel list (§4) | — |

**Harness notes added:**
- **Use real fingers for any handle press** (`Touch.end_all()` lifts them
  all at once, which CDP delivers). After a synthetic finger has grabbed a
  handle, a later synthetic press misses it while a real press at the same
  point grabs (`dbg13`; the same at `5dba62f`, so not this round's).
- A synthetic tap is one evaluate (`synth_tap`): separate round trips on a
  slow page could make it longer than `TAP_MAX_MS`.
- Earlier drags push the cube right, under the Edit panel: `aim()` turns
  until it is on open canvas.
- Speeds are read inside an animation frame (a slow frame made a plain
  sample read 1.12 m/s for 1.40).
- The harness server needs a long background timeout (`7200000`): the
  default 30 min stopped it mid-run once.

**After the fixes:** `tn.py` 42/42 (twice); the client app suite 1,866
pass; `packages/client` 770; the T2 tests 28; selection-parts `c1`, `c3`,
`c5` and grouping's `smoke.py` all pass (at `7e56f24`'s code).

## 8. The outside code review, third pass (Fable 5.2, ran the code, at `c28064a5`)
- **The review:** `devtasks/REVIEW-touch-nav-code-fable-3.md` (copied from
  its chat; its probes were in a zip, not in the chat). Verdict **APPROVE
  WITH NITS**: no must-fix, no defect against the contract; the second
  review's fixes hold; `tn.py` 42/42 twice; the suites and the earlier
  rounds' checks pass. Two should-fix, both the operator's call, and three
  nits.
- **The operator's phone report** (2026-11-11, 11:30 PT, PROD before this
  round): in portrait the Edit panel covers most of the view, a new object
  included; in landscape the saved-worlds list leaves no view and nothing
  scrolls; in "desktop site" mode a touch on the view hides the top bar.
  Reproduced in emulation with `probe9.py` (the Edit panel 250 × 556 over
  the new cube; eight saved worlds at 800 × 330: the view 0 px tall,
  `body { overflow: hidden }`), except the desktop-site one. **The operator:
  "whichever way you think will take the least time overall"** (11:34 PT):
  so the small fixes here, and **a phone layout as the next round**.

| # | Finding | Fix (`7a5e59f`, `39c5a2c`) | Check |
|---|---|---|---|
| S-9 | a 6 px thumb-roll tap on a move handle moved the object 0.072 and sent it (T17's mouse 4 px) | a touch handle press gets the touch slop (`handlePress.down({ slop })`, 10 px on screen); the mouse keeps 4 px | t16a (0.0000), t16b (a 14 px drag moves 0.152); unit test |
| S-10 | only the top bar could pan the page; at 390 px Edit, Connect and the mode switcher were off the right edge, and panned that far the stick was off the screen | `.toolbar` and `#subbar` scroll sideways inside themselves: the page is never wider than the screen | t22a (the page 390 wide; 795 at `c28064a`), t22b (a drag on the bar scrolls the bar; the page stays put) |
| landscape | the operator's report | `#world-browser` capped at 40vh, scrolling inside; under 500 px high, the list inside doesn't scroll separately (the fresh check's N-a) | t23 (the view keeps ≥ 100 px with eight worlds; 0 at the base) |
| N-13 | with the stick held, First person pressed and slid off still toggled | only a release still on the button toggles; the "ignore the next click" flag only when it toggles (N-b) | t21 |
| N-14 | `tn.py` was green with five behaviours removed | checks lifted from Fable's probes: the swallow disarmed by a new press (t17), blur and a hidden page end a handle drag (t18), no look while a handle drags (t19), a lost stick release stopped by a primary touch (t20) | t17–t20 |
| N-15 | unit gaps | a vertical pinch, a diagonal push past the rim, a part push sideways, a primary press with only a stale stick or only a stale view finger, the length clamp with x not 0 | unit tests |

- **A fresh-agent check of the fix diff** (`c28064a..7a5e59f`): **OK**. It
  checked per-press slop leakage (none), the drag after 10 px (it catches
  up in one step, as the mouse's after 4), the release check's coordinates,
  and the CSS at desktop sizes (no visible change at 1920, 1280 and 1024
  wide; nothing clipped; no stray scrollbar). Its nits N-a and N-b were
  taken (`39c5a2c`); N-c, a pen gets the mouse's 4 px, is as intended.

**After the fixes** (`39c5a2c`): the client app suite 1,870 pass;
`packages/client` 770; `tn.py` **53/53** (at `7a5e59f` and again at
`39c5a2c`); selection-parts `c1`, `c3` and grouping's `smoke.py` pass.
**Selection-parts `c5` changed on purpose:** it asserted a 6 px touch drag
on a handle is a move (that round's S-1, at the mouse's 4 px); with S-9 a
6 px touch press is a tap, so `c5` now asserts it moves nothing, and still
that 10 px is one move. With that, `c5` passes.

**The desktop-site report, explained and fixed** (`2eb6ea1`):
the operator's screenshots (2026-11-11 12:36, Android Chrome, desktop site)
show a touch on the view scrolling the bars and the saved-worlds list off
the top. Cause: the canvas has `tabindex` 0 (for the keys), so a tap
focuses it, and the browser scrolls a focused element fully into view;
`body` was `100vh`, which on a phone is the height with the address bar
hidden, so the canvas ran past the screen; and `body { overflow: hidden }`
leaves the user no way to scroll back. Reproduced with `probe10.py` (a
120 px gap made by a taller body: the tap scrolled 120 px). Fixed: `body`
is `100dvh` (the visible height) where the browser has it, and the page is
put back at once if anything scrolls it. `probe10` after: scrollY 0; check
t24. At `2eb6ea1`: `tn.py` **54/54**; selection-parts `c1`, `c3`, `c5` and
grouping's `smoke.py` pass; the client app suite 1,870.

## 9. Next: a phone layout (its own round)
From the operator's report (§8) and the reviews' N-3/N-4/S-10, for a
pre-brief: the Edit panel on a phone (a collapsible bottom sheet, or
narrower, so the selected object stays in view); landscape (the bars and
the world browser take less height); "desktop site" mode (the scroll-away
is fixed here, §8; the rest of it, at 980 px zoomed out, is the layout's);
whether the top bar should wrap or collapse into a menu rather
than scroll. Start with screenshots from the operator's phone and a probe
like `spike-touch-nav/probe9.py`.
