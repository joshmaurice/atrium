<!-- Copied from the reviewing session's chat ("Touch-nav code review", 2026-11-10/11,
https://claude.ai/chat/3caa8333-08c9-437e-af75-4a6a86460a35), the file it sent. Its probes were in a zip not in the chat. -->

Reviewed commit: c28064a54e6a25296df6d0304c941941cccc268a — reviewer: Claude Fable 5.2 — **third pass, RAN the code** (the STEP 2 suites, `tn.py`, the earlier rounds' Edit checks, and probes of my own)

# Outside code review, third pass: `touch-nav` (b37c482..c28064a)

## Verdict

**APPROVE WITH NITS.** No must-fix. I found no defect in the code against the contract (Rev 1.4), and nothing changed for the mouse or the keys.

- **The second review's four fixes hold** (S-5 to S-8), and so do the first review's. I found nothing new that they introduced, apart from the nit N-13.
- **Two should-fix items, both decisions for the operator.** Neither is a fault in the diff, and both will show in the phone acceptance:
  - **S-9:** a tap that rolls 5–9 px on a move handle moves the object and sends the edit. The 10 px tap slop was given to the view only.
  - **S-10:** the page can now be panned only from the top bar, and Edit, Connect and the mode switcher are off the right edge at 390 px. This is the first review's N-3, now reproduced and measured.
- **Three nits:** N-13 (First person), N-14 and N-15 (checks that don't see the code).

**Limit of this pass:** Chromium on Linux with emulated touch, not Android Chrome. This Chromium cannot lift one of two real fingers (I tried five ways, `pA`, `pA2`), so a second finger that lifts alone is still in-page `PointerEvent`s, as in `tn.py`.

Scope: `git diff b37c482 c28064a -- apps packages` (7 files, +922/−25), the contract, the handoff, both earlier reviews, `tn.py`/`tn_lib.py`, and three's `TransformControls.js` 0.163.0. The branch tip (`7231fe8`) differs from the pinned commit only in the review prompt.

## The fixes this pass was asked to test

| Fix | Result | How |
|---|---|---|
| 10 px look slop (S-1), scaled by the page zoom (N-8) | **Holds.** At zoom 1 a 9 px move doesn't look and 11 px does. At zoom 2 the slop is 5 px, at zoom 0.6 it is 16.7 px. | REPRODUCED (t3b, t3d; `pD`) |
| The made-up click with the stick held (S-2) | **Holds** for select, First person and, new in this pass, `activate` outside Edit: a tap on an object with a behaviour ran it, twice, and a 12 px look on it didn't. The second finger is synthetic. | REPRODUCED (t3e–t3g; `pE`) |
| One finger drives a handle (S-3, S-5) | **Holds.** A handle drag, then the stick pressed mid-drag, both fingers real: the object moves and the avatar walks. A view finger moved 60 px while another finger dragged the handle: Δyaw 0.000. | REPRODUCED (t6b, t12a–c; `pC` C3, `pI` I2) |
| The reset checks (S-4) | **Pass.** | REPRODUCED (t10, t10a–e) |
| A cancelled or lost handle drag ends (S-6) | **Holds** on all four routes: `pointercancel`, a primary touch after a lost release, blur, a hidden page. After each, a look and a handle drag work, and the server's copy has the final position. | REPRODUCED (t13; `pC` C1, C2, C4) |
| Flags, not clocks (S-7) | **Holds.** A tap on an object straight after a 60 px look selects it. | REPRODUCED (t14a; `pB45` B4) |
| No made-up tap after a cancel or a long press (S-8) | **Holds.** | REPRODUCED (t15) |

## Should-fix

### S-9. A thumb-roll tap on a move handle moves the object and sends the edit
REPRODUCED (`pH`, a real CDP finger). Not a regression: the 4 px is selection-parts' T17, unchanged by this round.

- `apps/client/src/edit-selection.js:11` (`CLICK_SLOP_PX = 4`), `apps/client/src/edit-press.js:29` and `:69–70`, `apps/client/src/app.js:2346`. The handle press uses the mouse's click slop for every pointer type.
- Measured, the cube selected, one finger pressed on its handle, rolled, lifted:

| Roll | Object | Server's copy |
|---|---|---|
| 3 px | put back | unchanged |
| 6 px | **moved 0.072 m** | **moved 0.072 m** |
| 9 px | **moved 0.108 m** | **moved 0.108 m** |

- The same 6 px roll on the view is a tap (t3d). The first review's S-1 gave the reason: a thumb rolls more than 4 px.
- Scenario: in Edit on the phone, the handles sit on the selected object's centre. The operator taps it again (to go into a group, as the new hint tells him) and his thumb rolls 6 px. The object shifts 7 cm, the edit is sent, and nothing new is selected.
- Fix (a sketch, not run): give the handle press the touch slop when the pressing pointer is a touch (`10 / visualViewport.scale`, as `app.js:92` does for the look). The cost: a touch handle drag begins after 10 px, not 4.
- If the operator would rather leave it: add "20 taps on a selected object, counting the ones that move it" to the acceptance list.

### S-10. The page pans only from the top bar now, and what it must pan to reach is off the screen (the first review's N-3, measured)
REPRODUCED in the emulated page (`pJ`, `pK`); on the phone INFERRED (the harness serves the production `index.html`).

- `apps/client/index.html:328` (`touch-action: none` on the canvas). The canvas fills the screen below the top bar.
- At 390 px, in page coordinates: the World field is at x 432–612, the Edit button 607–654, Connect 636–722, the mode switcher 730–795. All are off the right edge.
- Measured:
  - With the canvas's `touch-action` set back to `auto` (as before the round), a 200 px drag on the view pans the page 185 px, and a drag back returns it.
  - At `c28064a` the same drag turns the view and the page stays put. A 240 px drag on the top bar pans it 225 px.
  - Panned that far, the stick is at x −205 to −109: **off the screen.** A 270 px drag on the view does not bring the page back; the same drag on the top bar does.
- Scenario: the operator pans right to tap Edit or the mode switcher. He now has to do that on the top bar strip. To walk he has to pan back, again on the top bar, because the stick has left the screen. A pinch to zoom the page out works only with both fingers on the top bar or a panel.
- TN-L5 (c) ("leave layout alone") was decided on the report that everything but navigation works on the phone. That report was made while a drag on the view still panned the page.
- Fix (not run): TN-L5 (a), the top bar wraps or scrolls inside itself, so the document is no wider than the screen and nothing needs panning. Or leave it and try it first at acceptance: reach Edit, then get the stick back.

## Nits

- **N-13. With the stick held, a finger that presses First person and slides off still toggles it.** REPRODUCED with two real fingers (`pB2b`): the stick held, the second finger pressed the button and slid 120 px away, both lifted: camera y 2 → 1.6. Without the stick the same slide is cancelled by Chromium and nothing toggles (`pB` B2a). `app.js:4322–4326` acts on any touch `pointerup` the button receives, and a touch stays captured by the element it pressed. Fix (not run): act only if the release point is still inside the button.
- **N-14. `tn.py` is green with five behaviours removed.** REPRODUCED: with all eight changes below applied together to the served `app.js`, `tn.py` passed **42/42**. My probes fail on that build, so each of the first five is a real gap:

| Removed | Line | What breaks (my probe on the mutated build) |
|---|---|---|
| the swallow's disarm at a new press | `app.js:4239` | a tap after a 60 px look selects nothing (`pB45`) |
| S-6: a primary touch ends a stale handle drag | `app.js:4244` | `dragging` stays on; a look turns 0.000; a handle drag moves 0.000 (`pC` C2) |
| S-6: blur and a hidden page end a handle drag | `app.js:4288` | `dragging` stays on (`pC` C1, C4) |
| `primary` passed to the gesture machine | `app.js:4264` | a stick whose release was lost never stops (`pI` I1) |
| no look while a handle drags | `app.js:4194` | the view turns −0.300 during a handle drag (`pI` I2) |
| `resetTouch()` at a disconnect and at a mode change | `app.js:907`, `:4128` | nothing I could show: each has a second path, as the handoff says |
| `fpTouched` cleared at a new press | `app.js:4240` | only a mouse click on the button after a touch, on a touch laptop |

  t13a covers S-6's `pointercancel` route only. `pB45`, `pC` and `pI` can be lifted into `tn.py` as they are.
- **N-15. Unit-test gaps in the two pure modules.** REPRODUCED by a mutation run: 199 mutants, 154 killed, 45 survived. Most survivors are equivalent or in older code. The real gaps:
  - `touch-nav.js:59`: the pinch distance can ignore y. Every pinch test is horizontal.
  - `touch-nav.js:65` and `:70`: the clamp of `dy` past the rim, and the scaling of `vx` for a part push. No test pushes the stick diagonally or part-way sideways.
  - `touch-nav.js:100`: a primary press with only a stale stick, or only a stale view finger. The one test has both.
  - `NavigationController.js:105`: the length clamp with x not 0.

## What I checked by running, and found sound

1. **The suites.** Navigation tests 33 pass. `touch-nav.test.js` and `import-guard.test.js` 289 pass. The client app suite 1,866 pass, 0 fail, 1 skipped. `packages/client` 770 pass.
2. **`tn.py`:** 42/42, exit 0, on both unmutated runs. No flake.
3. **No regression in the mouse-driven Edit checks:** selection-parts `c1` (29), `c3` (30), `c5` (10) and grouping's `smoke.py` (7) all pass. After touches on the same page, a mouse drag turns 0.002 rad/px, a mouse click selects and a mouse handle drag moves the object (`pB45` B5).
4. **Pointer ownership.** The view finger first and the stick second, both real: the view turns −0.300 and the avatar walks (`pB` B1). The stick with three view fingers: no look, no stuck input, and a plain look works after (`pB` B3).
5. **Random multi-finger sequences** (`pM2`): 94 sequences of presses, moves, releases and cancels on the stick, the view, a handle and the button, with blur, a hidden page and mode changes mixed in. After each, with every finger lifted: the stick input was (0, 0), no handle drag was left on, and a look, the stick and a handle drag all worked. A weak check: on a build with the cancel listener and the primary rule removed it flagged nothing either, though 15 of 20 sequences there could not be set up (0 of 94 on the pinned build).
6. **Double-tap by touch.** On a lighter rendering of the page (device scale 0.4) a real double tap, 169 ms apart, on the table went from `Furniture` into `Table-Center` (`click` `detail` 2). The canvas's `touch-action: none` doesn't take the tap count away in Chromium.
7. **Load order, by reading and by running:** `app.js` has no top-level `await`, so no listener can run before a later `let`. No page error in any run.
8. **The mouse and keys, by reading:** `_look` is the same arithmetic; `tick` has `scale` 1 with no stick input; the handle press's new pointer guard (`app.js:2363–2372`) is a no-op for one mouse; every new listener returns unless `pointerType` is `touch`, except the two flag clears.

## Harness notes

- **The phone page is too slow for anything Chromium times.** At device scale 2, two taps sent back to back arrive 1.4–2.6 s apart, so no check can make a double tap. At device scale 1 with the small `space` world a frame is 16 ms and taps are 80 ms apart. `tn.py` took 6 min 16 s.
- **A drag that starts on the First person button pans the page** (`touch-action: manipulation`), which puts later CDP touches off by the pan. Check `home()` after any such gesture.

## For the phone acceptance (Android Chrome)

- Reach Edit and the mode switcher, then get the stick back on screen (S-10). I would try this first.
- 20 taps on a selected object in Edit, counting the ones that move it (S-9).
- The stick held, First person pressed and slid off (N-13).
- A double-tap on a group in Edit. Android counts taps itself, and I could not check that here.
- Still open from the second pass: whether Chrome sends no click for a second finger's tap. This Chromium can't lift one of two fingers, so it can't be shown here.

## What I ran, and what I couldn't

- **Ran** (Node v22.23.4, pnpm 10.28.0, Python 3.13 with Playwright, Chromium on SwiftShader):
  - the clone and the checkout of `c28064a5` (they worked);
  - `pnpm install --frozen-lockfile --ignore-scripts`, then better-sqlite3's own install script;
  - every `node --test` command in STEP 2, and `packages/client/tests/*.test.js`;
  - `devtasks/harness/setup.sh` and `server.mjs`;
  - `tn.py` twice unmutated and once with the eight changes of N-14;
  - selection-parts `c1`, `c3`, `c5` and grouping `smoke.py`;
  - 18 probes of my own (`pA` to `pM2`), three of them (`pB45`, `pC`, `pI`) also against the mutated build;
  - a 199-mutant run over `touch-nav.js` and `NavigationController.js`.
- **Could not run:**
  - a real phone, Android Chrome or iOS Safari;
  - a real second finger lifting while the first stays down;
  - a double tap on the page at the harness's own device scale (2).
- **Not reported as passing:** the fix sketches in S-9, S-10 and N-13 were not run.
- **Interruption:** the session was interrupted once, after the last random-sequence run, and resumed. The harness server stayed up; nothing was rerun because of it.
- The mutations were made in the harness worktree (`/tmp/atrium-harness/wt`) and put back each time; it is clean at `c28064a5`. Nothing was committed or pushed, and no deployed site was touched. The clone's tree is clean at `c28064a5`.
