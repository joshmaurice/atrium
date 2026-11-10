Reviewed commit: cba7f8b575f679404aad68c2db178aaec1023a4d — reviewer: Claude Fable 5.2 — **SOURCE-ONLY review: no test, harness check or probe was run**

<!-- Copied from the reviewing session's chat ("Touch nav outside code review",
2026-11-10, https://claude.ai/chat/203870ee-fdae-44f4-a1d6-e94e31b8b470),
the file it sent, with its two line-number edits applied. -->

# Outside code review: `touch-nav` (b37c482..cba7f8b)

## Verdict

**APPROVE WITH NITS — provisional, from reading only.** No must-fix found. Four
should-fix: one is a constant (S-1), two need the operator's choice between a
fix and a recorded limit (S-2, S-3), one is a test gap on the round's main risk
(S-4). S-1 and S-2 are INFERRED from how Chrome makes a click from a touch, and
only a phone (or a harness run) can settle them; I'd settle both before the DEV
acceptance rather than discover them there.

The clone worked. This session's permission check refused to execute the
repository's code, so STEP 2 was not run (see the last section). A second pass
that runs the suites and `tn.py` is still owed.

Scope: `git diff b37c482 cba7f8b -- apps packages` (6 files, +749/−22), the
contract (`PREBRIEF-touch-nav.md` §4 T1–T5), the handoff, `tn.py`/`tn_lib.py`,
and three's `TransformControls.js` at 0.163.0 (the version `index.html:632–633`
loads).

## Should-fix

### S-1. The look starts at the mouse's 4 px click slop, so a tap that wobbles 4 px or more turns the view and loses its click
INFERRED (the mechanism is CONFIRMED IN THE SOURCE; how often a thumb does it is not measured).

- `apps/client/src/touch-nav.js:35` (`slop = CLICK_SLOP_PX`, 4), `:99–103`
  (past the slop the finger is `live` and `used`), `:121` (a `used` finger
  swallows); `apps/client/src/app.js:4197–4203` (the click is dropped).
- Before this round a tap's travel didn't matter to the page: the
  compatibility `mousedown` arrives at the release (pre-brief §2.3), so
  `isSelectClick` saw zero travel and every tap Chrome accepted selected or
  activated. Now Chrome's opinion and the page's differ between 4 px and
  Chrome's own tap slop: in that band the finger looks (the first `look` is
  the whole travel) and its click is eaten.
- 4 CSS px is about 0.6 mm on a phone. Android's default touch slop is 8 dp,
  and as far as I know Chrome on Android uses it for its tap region (not
  verified here; desktop Chromium's is wider, which is why t3b's 6 px drag
  still clicked).
- Scenario: the operator, in Edit on his phone, taps a cube with a thumb; the
  contact rolls 5 px. The view turns about 1.4° and nothing is selected. Before
  the round that tap selected.
- The checks can't see it: `tn.py:83` taps with zero travel, and t3b
  (`tn.py:77–79`) asserts exactly this outcome for a 6 px press as the wanted
  one.
- Fix: a touch slop of its own (`TOUCH_LOOK_SLOP_PX`, 8–10), passed as `slop`.
  At or above Chrome's phone slop the swallow never drops a click Chrome would
  have sent. Add it to the handoff's §4.3 tuning list, update the "defaults"
  unit test, and add "20 quick thumb taps on an object, count the misses" to
  the phone acceptance.

### S-2. While a finger holds the stick, nothing that waits for a `click` works: the First person button, select, Inspect, `activate`
INFERRED (from Chromium's gesture detection as I know it: a second pointer going down cancels tap detection for the whole touch sequence, and a touch `click` only comes from a tap). Not run.

- `app.js:4246` (`#touch-fp` listens to `click`), `app.js:2576` (select,
  Inspect and `activate` are all in the viewport's `click` listener).
- Scenario: walking with the left thumb on the stick, the right thumb taps a
  door that has a behaviour, or the First person button. No `click` is sent,
  so nothing happens until the stick is let go. Pre-brief §1 says "a tap stays
  a tap"; with two thumbs it doesn't.
- Look and a handle drag are fine with the stick held: they run on pointer
  events (t5, t6).
- Two-minute check: in the harness, `t.down` on the stick, then a second
  finger down and up on the cube in Edit; on the phone, hold the stick and tap
  the button.
- If confirmed, the operator's choice: (a) record it as a limit ("let go of
  the stick to tap"), or (b) have the button act on `pointerup`, and have
  `up()` return `{ type: 'tap', x, y }` for a view finger that was never
  `used` while another finger was down, with the page running the same pick
  path. (a) is acceptable for a release if it is written down.

### S-3. A second finger on the canvas during a handle drag steers the object and ends the drag
INFERRED (the handlers are CONFIRMED IN THE SOURCE; the effect was not run).

- `TransformControls.js:705–720`: any `pointerdown` on the canvas adds
  `_onPointerMove`; `:722–739`: neither move nor up checks `pointerId`;
  `:292`: a move only needs `dragging`. `app.js:4229` classes the second
  finger `'handle'`, so touch-nav ignores it, but TransformControls does not.
- Scenario A: in Edit, drag a handle with one finger, then put another on the
  view to look around (the hint now says "Drag to look"). The object jumps
  under the second finger; lifting it ends the drag while the first finger is
  still down, and the jumped position is the gesture's final send.
- Scenario B: looking with one finger, grab a handle with another. The look
  stops (`app.js:4179`) and the looking finger's moves now drive the object.
- Stick plus handle is safe: the stick's pointer never targets the canvas.
  That is the two-thumb case that matters most, and it holds.
- Related, `app.js:2355–2359`: `handlePress.down` runs for every press in the
  viewport, the stick and the button included. A second press while a handle
  press is still inside its slop replaces it (new origin, `grabbed: false`),
  so the first finger's next 1 px move begins a gesture (T17's "a click until
  4 px" is lost for that press).
- The mechanism predates this round, but until now a second finger had no
  purpose. Fix: remember the pointer that grabbed the handle and keep other
  touch pointers from the canvas's listeners while `gizmo.dragging` (touch-nav's
  own `pointermove`/`pointerup` listeners would then need the capture phase so
  a tracked finger's release still arrives); let `handlePress` ignore
  non-primary touches. Or record it as a limit.

### S-4. T4's reset rules have no check, so the answer to "can the stick stay pushed" rests on reading alone
CONFIRMED IN THE SOURCE (by reading `tn.py` and both test files end to end; no mutation was run).

- The unit tests cover `touch-nav.js` only. The page's half is in `tn.py`,
  which never sends a `touchCancel`, never changes mode, disconnects, blurs or
  hides the page with the stick pushed. As far as I can read, removing any of
  `app.js:905`, `:4115`, `:4169`, `:4243`, `:4244`, or `'pointercancel'` at
  `:4237`, leaves every test and all 23 checks green.
- t2d (`tn.py:139–146`) holds the stick through the teleport and asserts only
  the URL.
- Add, each with the stick at full push first: a CDP `touchCancel`; the mode
  switcher to ORBIT; a disconnect; a hidden page; and after t2d's arrival. Each
  asserts `moveInput` is `[0, 0]`, the knob is home, and the position stops
  changing.

## Nits

- **N-1. The stick and the button show in static mode** (before Connect, and
  again after a disconnect once the static reload finishes), because
  `avatar.localNode` is then `__local_camera` (`AvatarController.js:102–116`;
  `app.js:4167`; `app.js:955–979`). So prompt area 3's "after a disconnect" is
  a yes. Walking a static world by stick matches WASD and seems right, but
  TN-L2 (a) says "while connected": say which. The button there does what V
  already does in static mode: it lifts the camera child to 1.6 m on a node
  already at 1.6 m, then to the third-person offset (`app.js:4131–4138`).
  Hiding `#touch-fp` unless `client.connected` would do. CONFIRMED IN THE SOURCE.
- **N-2. Tests that are green whatever the code does.** CONFIRMED IN THE SOURCE.
  - `navigation-touch.test.js:164–169`: the bad ratios are tried at radius
    0.5, the clamp. −1 gives −0.5 and `Infinity` gives 0, both clamped back to
    0.5, so only `0` and `NaN` can fail. Set the radius to 10 first.
  - `touch-nav.test.js:57–67`: the `['up', 'cancel']` loop calls `t.up` both
    times.
  - `tn.py:121–123` (t8): a scripted `.click()`, not a touch tap on the
    button, and "and back" is not asserted.
  - `tn.py:77–79` (t3b): the selection was `None` before the drag, so a
    swallowed click and no click at all look the same. Count clicks at a
    document capture listener against a viewport bubble listener.
  - `tn_lib.py:11–12`, `tn.py:163`: a FAIL doesn't change the exit status.
- **N-3. The canvas is no longer a place to pan or zoom the page from**
  (`index.html:328`). The handoff's §2 notes that focusing a top-bar field pans
  the 795 px page sideways. On a phone, the way back is now a drag on the top
  bar or a panel. INFERRED; try it at acceptance: tap the World field, close
  the keyboard, get the view back.
- **N-4. `#touch-fp` starts at 130 px** (`index.html:355–357`), and at a
  390 px layout the Edit panel spans 128–378 px with `z-index` 10
  (`index.html:502`), so a tall panel covers the button. INFERRED from the CSS,
  and only if the phone's layout really is 390 px wide.
- **N-5. Only a touch press disarms the swallow** (`app.js:4209–4211`). On a
  touch laptop a mouse click on the canvas within 500 ms of a long touch look
  is dropped. Disarm on any `pointerdown`. CONFIRMED IN THE SOURCE.
- **N-6. Records.** The handoff and the review prompt name the contract
  Rev 1.1; the pre-brief's header says Rev 1.2, and its §5 still gives Rev 1.0's
  counts (18 tests; 1,853). The handoff cites `updateHintText` at L651–667; it
  is 657–667. `_down` is public on the returned object (`touch-nav.js:74`).

## What I checked by reading, and found sound

1. **The stick lets go.** Every release route ends in `setMoveInput(0, 0)`:
   `pointerup` and `pointercancel` on `document` (`app.js:4237–4241`; nothing
   in `apps/client/src` or TransformControls stops a pointer event's
   propagation); the stick hiding (`:4169`); the mode switcher (`:4115`);
   `teardownWorld` (`:905`), which `connecting` and `disconnected` both call,
   so a teleport mid-walk resets; blur and the hidden page (`:4243–4244`). A
   finger still down after a reset is untracked, so the avatar doesn't walk
   off its arrival point.
2. **`primary`.** Chrome makes a touch primary only when no other touch
   pointer is active, so anything tracked at a primary press is stale. The
   rule is sound, and `this.reset()` is bound as the page calls it.
3. **The F1 fix.** Canvas clicks only, disarmed in `document`'s capture phase
   before the new press's own click can exist. A drag's click follows its
   `pointerup` before any new `pointerdown`. I found no new way for the window
   to eat a tap (S-1 is the slop, not the window). A swallowed click leaves
   `pressDown` and `handleClick` unconsumed; both are reset at the next press
   (`:2355`, `:2570`).
4. **B3 on touch.** TransformControls' canvas listener runs before the
   viewport's bubble listener, and its `onPointerDown` hovers then presses
   (`:717–718`), so `dragging` is set for a touch with no hover. A handle press
   is never tracked, and `:4179` guards the look.
5. **Load order.** The touch state is at `app.js:86–92`. `updateHintText`
   first runs at `:4489`; every other call is inside a handler.
   `swallowClickUntil` (`:4195–4196`) is read only by its own listener and by
   a `swallow-click` effect, which only `up()` returns. No path runs before a
   declaration.
6. **When the stick shows.** It needs a touch seen, `localNode`, and a mode
   other than ORBIT. AvatarController clears `localNode` and
   NavigationController reads the world's modes in listeners registered before
   the page's, so a disconnect hides it and a world that starts in ORBIT never
   shows it.
7. **Mouse and keys.** `_look` is the same arithmetic; `tick` with no stick
   input is unchanged (`scale` 1); V's guard is the same and calls
   `toggleFirstPerson`. Every new listener returns unless `pointerType` is
   `touch`, except the click capture (unarmed without a touch) and the two
   resets (no effects without a stick).
8. **T1–T5 line by line** against §4: the vector, the dead zone's rescale, the
   clamps, `velocity` and `move`. No difference found. The test counts match
   the handoff (10 and 20).

## For the phone acceptance

Thumb taps that roll (S-1); a tap with the stick held (S-2); a second finger
during a handle drag (S-3); the page panned or zoomed (N-3); and a thumb that
lands on the ring's left rim, 20 px from the edge, where Android's
edge-swipe-back begins.

## What I ran, and what I couldn't

- **Ran:** the clone and the checkout of `cba7f8b5`; `pnpm install
  --frozen-lockfile --ignore-scripts` (Node v22.23.4, pnpm 10.28.0; done in
  1.2 s); `git diff`, `sed` and `grep`.
- **Could not run** (this session's permission check refused to execute the
  repository's code): every `node --test` command in STEP 2; the harness and
  `tn.py`; any probe of my own. Nothing here is reported as passing.
- Nothing was committed or pushed. The clone's tree is clean.
