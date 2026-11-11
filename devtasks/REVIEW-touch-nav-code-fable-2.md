<!-- Copied from the reviewing session's chat ("Touch-nav code review", 2026-11-10,
https://claude.ai/chat/48067af5-9739-4a34-9209-61db25d14861), the file it sent, with its one edit applied.
Its probes p1-p4 are in devtasks/spike-touch-nav/fable-2-probes/ (p5-p9 were not in the chat). -->

Reviewed commit: 5dba62f453da4067e05b5788c51a6086c4ea7712 — reviewer: Claude Fable 5.2 — **second pass, RAN the code** (the STEP 2 suites, `tn.py`, and probes of my own)

# Outside code review, second pass: `touch-nav` (b37c482..5dba62f)

## Verdict

**CHANGES REQUESTED.** No must-fix. Four should-fix, all reproduced on the real page in the harness:

- **S-5 and S-6 were introduced by the fix for the first review's S-3.** With the stick held first, another finger's handle press loses its click slop or can't drag at all. A handle drag whose finger is cancelled now leaves Edit stuck for touch.
- **S-7 makes `tn.py` unreliable.** It passed 35/35 on my first run and 33/35 on two later unmutated runs in a slower environment (t3b and t8).
- **S-8:** a cancelled or long-held finger makes a click while the stick is held.

None of these touches the mouse, the keys or the protocol, and none loses data. I'd fix them before the DEV acceptance, because S-5 sits inside the acceptance's own list ("a handle drag, two thumbs").

**Limit of this pass:** Chromium on Linux with emulated touch, not Android Chrome. A second finger had to be in-page `PointerEvent`s, as in `tn.py` (the harness note on CDP withholding one finger's release). What Chrome on Android does with a real second finger is still unverified.

Scope: `git diff b37c482 5dba62f -- apps packages` (7 files, +846/−25), the contract (Rev 1.3), the handoff, the first review, `tn.py`/`tn_lib.py`, and three's `TransformControls.js` 0.163.0. The branch tip (`2348d4d`) differs from the pinned commit only in the review prompt.

## The four fixes this pass was asked to test

| Fix | Result | How |
|---|---|---|
| 10 px look slop (first review's S-1) | **Holds.** Drags of 4, 8 and 9 px click and don't look. 10 and 12 px look, and Chromium's click is swallowed. From 16 px Chromium sends no click. A 6 px rolling tap inspects for a visitor. | REPRODUCED (`p1`, `p7`; t3b–t3d) |
| The made-up click with the stick held (S-2) | **Works for select and Inspect**, with a synthetic second finger. New problems: S-8 here, and N-7. | REPRODUCED (t3e–t3g, `p7`) |
| One finger drives a handle (S-3) | **The steering is fixed** (t6b: jump 0.0000). **But it introduced S-5 and S-6.** | REPRODUCED (`p3`, `p4`, `p8`; `p3` and `p4` also run at `cba7f8b`) |
| The reset checks (S-4) | **Pass:** t10 and t10a–e. The stick let go on every route I tried. | REPRODUCED (first run) |

## Should-fix

### S-5. With the stick held first, a handle press by another finger is measured by the stick thumb
REPRODUCED. Introduced by `c091256` (S-3's fix); correct at `cba7f8b`.

- `apps/client/src/app.js:2358–2366`: `handlePress.down` and `.move` now ignore non-primary touches. If the stick is pressed first, its thumb is the primary pointer and the stick is inside `#viewport`. So `handlePress` holds the **stick's** press, and its travel is the **thumb's**. The handle finger is never recorded.
- Measured (`p3`: a real finger on the stick, a synthetic second finger on the cube's handle):

| Case | At `5dba62f` | At `cba7f8b` |
|---|---|---|
| Control: no stick, a 2 px press on the handle | put back, nothing sent | the same |
| Stick thumb travelled 5 px (inside the dead zone), second finger 2 px on the handle | **object moved 0.024, the SOM changed** | put back |
| The same again, stick still held | **moved 0.024, sent** | put back |
| Stick thumb still, second finger drags the handle 40 px | **moved 0.000: the handle can't be dragged** | moved 0.477 |

- Scenario 1: the operator walks up to an object in Edit with his left thumb still on the stick, and taps a part through the move handles. T17's "a click until 4 px" is gone for that press. The object shifts and an edit is sent.
- Scenario 2: the thumb rests on the stick without having moved 4 px. The handle doesn't drag.
- A further symptom (`p8`): after such a handle press the verdict in `handleClick` stays set, because non-primary presses no longer clear it (`app.js:2359` returns before `:2360`). **The next stick-held tap on another object selects nothing; the one after it works.**
- The order matters: handle first and stick second is fine.
- No check covers it. With the guard at `:2359` and `:2364` removed, `tn.py` still passes 35/35 (mutation A1).
- Fix (a sketch, not run): key the press on the pointer, not on `isPrimary`. Skip a touch `pointerdown` while `gizmo.dragging` (TransformControls sets it at the press, so this covers a press still inside its slop). Otherwise remember `e.pointerId` and take `handlePress.move` only from that pointer. That is the same pointer `handlePointerId` at `:4281` already tracks. Add a harness check: stick held, then a handle tap and a handle drag.

### S-6. A cancelled handle-drag finger leaves `gizmo.dragging` true, and no touch can end it any more
REPRODUCED. The stuck flag predates the round; that touch can't clear it is new with `c091256`/`036e78c`.

- `TransformControls.js` (0.163.0) listens for `pointerdown`, `pointermove` and `pointerup` only (lines 175–177). A `pointercancel` never ends its drag.
- `app.js:4282–4289`: while `dragging`, every touch pointer on the canvas other than `handlePointerId` is stopped before the canvas. After a cancel no pointer has that id again, so no later touch reaches TransformControls.
- Measured (`p4`: a real touch drag on the handle, then CDP `touchCancel`):

| After the cancel | At `5dba62f` | At `cba7f8b` |
|---|---|---|
| Three taps on the view | `dragging` stays **true** | the first tap clears it |
| A 100 px look drag | **Δyaw 0.000** (`:4188` blocks the look) | Δyaw −0.500 |
| A new 40 px drag on the handle | **moved 0.000** | — |
| The stick | walks | walks |
| Edit off | clears it | — |

- Scenario: in Edit on the phone a handle drag is cancelled (a system gesture, a palm, a third finger). The view no longer turns, taps select nothing and handles are dead. The gesture is never ended, so its drag-rule hold stays too. Only leaving Edit recovers, and nothing tells the user that.
- How often Android Chrome cancels a touch on a `touch-action: none` canvas I can't measure here. The prompt's first question is whether a lost or cancelled pointer can leave state stuck, and this one does.
- Fix (a sketch, not run): on a `pointercancel` of `handlePointerId` while `gizmo.dragging`, call `endHandleDrag()` (`app.js:2335`). Also call it on a **primary** touch `pointerdown` while `gizmo.dragging`: a primary touch means no other finger is down, the same rule touch-nav.js already uses for stale fingers. Consider it on `blur` and the hidden page too. Add a harness check like `p4`.

### S-7. The 500 ms windows are timed from the handler, so one slow frame defeats them, and `tn.py` flakes
REPRODUCED.

- `app.js:4190`, `:4207`, `:4223` (the canvas click swallow) and `:4299`, `:4303` (the First person button) compare `performance.now()` at the release's handler with `performance.now()` at the click's handler.
- Chromium's click is handled one frame after the `pointerup`. Measured (`p9`) with frames of about 405 ms: 451 to 522 ms later. The two events' own `timeStamp`s were 0 ms apart.
- When the gap passes 500 ms:
  - the button toggles on `pointerup` and back on the click (`p9`: camera y 1.6 → 1.6 on two taps of three);
  - a short look-drag's click is not swallowed, so it selects or activates as well as turning.
- **The round's own check shows it.** `tn.py` unmutated: 35/35 on the first run; 33/35 on two later runs after the session's environment restarted slower (t3b: "clicks sent/seen 1/1", `Cube` selected; t8).
- On a phone it needs one long task between the release and the click (a model or texture load). The effect there: the button seems dead, or a short drag activates something.
- Fix (a sketch, not run): don't use the clock. `:4235` already disarms the swallow at the next `pointerdown`, so a flag cleared there is enough for both, with no timeout. Or compare `e.timeStamp`.

### S-8. A cancelled finger, or one held for seconds, makes a click while the stick is held
REPRODUCED (`p2`; the second finger synthetic).

- `apps/client/src/touch-nav.js:118–133`: `up()` serves `pointerup` and `pointercancel` alike (`app.js:4264–4269`). A view finger that never looked, with `withStick` set, returns `tap` whatever ended it and however long it was down. The page then dispatches `mousedown`, `mouseup` and `click` (`app.js:4201–4208`).
- Measured, each with the stick held: a `pointercancel` after 0.2 s selected the cube (1 click made); a finger held 2 s then lifted selected (1 click); the stick let go first, then the finger cancelled, selected too.
- Scenario: walking with the left thumb, the right thumb rests on the view. A system gesture cancels the touches, or the thumb lifts after a few seconds. The object under it is selected, or `activate`d outside Edit. A cancel should never act, and Chrome itself makes no click after a long press.
- Fix (a sketch, not run): the page passes `cancelled` for `pointercancel`, and `up()` returns no `tap` for it; a `tap` only when the finger was down less than about 500 ms (the two events' `timeStamp`s).

## Nits

- **N-7. A touch tap on First person leaves the focus on the button.** REPRODUCED (`p6`): the focus goes from `CANVAS` to `touch-fp`, and W held for 1 s then walks 0.00 m. The fresh check's focus fix (`app.js:4305`) is behind the `return` at `:4303`, so the touch path never reaches it. It only matters on a touch laptop.
- **N-8. The look slop is in CSS px, Chrome's tap slop in screen px.** INFERRED. The emulated page is at scale 1 (`visualViewport.scale` 1; the stick 96 × 96 px), but its layout is 795 px wide on a 390 px screen. If the operator zooms out to reach the top bar, 10 px is about 5 dp and the first review's S-1 comes back between 5 and 8 dp. At acceptance, read `visualViewport.scale` on the phone; divide the slop by it if it isn't 1.
- **N-9. Limits not written down.** With the stick held:
  - a tap on a move handle does nothing: the press is classed `'handle'` and Chrome sends no click (INFERRED);
  - a double-tap can't go into a group: the made-up click always has `detail: 1`, `app.js:4202` (CONFIRMED IN THE SOURCE).

  Without the stick, a tap while another finger is looking does nothing: the second view finger makes a pinch (CONFIRMED IN THE SOURCE).
- **N-10. Checks that don't see the code.**
  - `tn.py` is as green as the unmutated code with each of these changes: no non-primary guard on `handlePress` (A1, 35/35); `primary: false` always (A2, 35/35); no swallow after the made-up click (A4) and no disarm at a new press (A8), both 33/35 with the same two timing failures as the unmutated runs in that environment.
  - t2a has a floor and no ceiling ("walked 5.59 m in 3.39 s" passes). The speed itself is right, timed in the page (`p5`): 1.46 m/s at full push in a 1.4 m/s world, 0.60 at half the radius (input 0.43), 0 in the dead zone.
  - No check for a tap outside Edit and Inspect (`activate`), for a cancel during a handle drag, or for the stick with a handle.
  - The unit tests are strong: 34 of 38 mutations of the two pure modules are caught. The survivors: a dead store (`touch-nav.js:127`, `x0`/`y0` are never read once `live` is set); a ratio-1 pinch being sent; and two choices no test pins (a tap after the stick is let go; the second pinch finger marking both `used`).
- **N-11. Records.**
  - `app.js:4212` still says "wider than our 4 px"; it is 10 now.
  - `app.js:4276` says the object "jumped 0.05"; the handoff says 1.90.
  - The prompt's STEP 2 as written (`--ignore-scripts`) gives 1,849 pass and 1 fail: `auth.test.js` needs better-sqlite3 built. After AGENTS.md's build step it is 1,860 pass, 0 fail, 1 skipped.
- **N-12. For the feel list:** the first look sends the whole 10 px at once, a 2.9° step (CONFIRMED IN THE SOURCE, `touch-nav.js:112`; the contract asks for it).

## What I checked by running, and found sound

1. **The suites.** Navigation tests 33 pass. `touch-nav.test.js` and `import-guard.test.js` 283 pass. The client app suite 1,860 pass, 0 fail, 1 skipped. `packages/client` 770 pass.
2. **`tn.py`:** 35/35, exit 0, on the first run (but see S-7).
3. **No regression in the mouse-driven Edit checks:** selection-parts `c1`, `c3`, `c5` and grouping's `smoke.py` all passed. t7: a 100 px mouse drag turns 0.2000 rad, and a mouse page never shows the stick.
4. **The stick's speed and dead zone** (N-10).
5. **Inspect by touch as a visitor** (`p7`): a tap and a 6 px rolling tap inspect, a 12 px drag looks and inspects nothing, and a tap with the stick held inspects.
6. **The First person button:** a finger that presses it and slides away doesn't toggle it (`p2`).
7. **When the stick shows** (`p2`): a touch before any world is loaded shows no stick (hint "Drag to look"); after Connect the stick and the button show with no further touch; t11 after a disconnect.
8. **Load order:** no page error in any run. By reading, `swallowClickUntil` and `SWALLOW_CLICK_MS` (`app.js:4220–4221`) are only read by listeners and by `up()`'s effects; the first `updateHintText()` is at `:4546`.
9. **Mouse and keys, by reading:** `_look` is the same arithmetic; `tick` with no stick input has `scale` 1; every new listener returns unless `pointerType` is `touch`, except the swallow's disarm (a write of 0) and the resets (no effects without a touch).

## For the phone acceptance (Android Chrome)

- The stick held, then a tap and a drag on a move handle with the other hand (S-5).
- A handle drag interrupted by a system gesture, then a look and a tap (S-6).
- First person tapped while a world is still loading models (S-7).
- A thumb resting on the view while walking, then lifted (S-8).
- `visualViewport.scale` (N-8).
- Whether Chrome really sends no click for a second finger's tap: the made-up click rests on that, and this harness can't show it.

## What I ran, and what I couldn't

- **Ran** (Node v22.23.4, pnpm 10.28.0, Python 3.13 with Playwright, Chromium on SwiftShader):
  - the clone and the checkout of `5dba62f4`;
  - `pnpm install --frozen-lockfile --ignore-scripts`, then better-sqlite3's own install script (AGENTS.md);
  - every `node --test` command in STEP 2, and `packages/client/tests/*.test.js`;
  - `devtasks/harness/setup.sh` and `server.mjs`;
  - `tn.py` three times unmutated (35/35, then 33/35 twice), and once each with A1, A2, A4 and A8;
  - selection-parts `c1`, `c3`, `c5` and grouping `smoke.py`;
  - nine probes of my own (`p1`–`p9`), with `p3` and `p4` also run against `cba7f8b` in the harness worktree;
  - a 38-mutation run over `touch-nav.js` and `NavigationController.js` in a scratch worktree.
- **Could not run:**
  - a real phone, Android Chrome or iOS Safari;
  - a real second finger lifting while the first stays down (CDP withholds the release, so the second finger in `p2`, `p3`, `p7` and `p8` is synthetic; the stick finger, and both the drag and the cancel in `p4`, are real CDP touches);
  - an `activate` by tap outside Edit (no world with a behaviour was set up);
  - the mutation with the two `resetTouch()` calls removed (A11): it was not finished, so nothing is reported for it.
- **Interruptions:** the harness server was stopped once by the session's background time limit and once by an environment restart. I restarted it each time and reran what was cut off. The second restart left the environment slower, which is how S-7 showed.
- Nothing was committed or pushed, and no deployed site was touched. The clone's tree is clean at `5dba62f4`.
