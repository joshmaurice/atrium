# Pre-brief: walking and looking on a phone (`touch-nav`)

Status: **Revision 1.4 (2026-11-10), decisions taken; built (HANDOFF-touch-nav.md).** The
operator, by voice (about 14:10 PT): "I'm using Android and Chrome browser.
And uh, we can build this now, I'm thinking, and go with your
recommendations otherwise"; then in text, 14:15 PT: "Okay go ahead with that
please". So **TN-L0 (a)** (build now on this branch, release only after
`grouping` is `COMPLETE` on PROD), **TN-L9: Android, Chrome**, and every
other decision as recommended: **TN-L1 (a)**, **TN-L2 (a)**, **TN-L3 (a)**,
**TN-L4 (a)**, **TN-L5 (c)**, **TN-L6 (a)**, **TN-L7 (a)**, **TN-L8 (a)**.

**Not yet reviewed.** Building before the outside review is the operator's
choice (TN-L0 (a)); the fresh-agent check and the outside review read this
contract and the code together, before any release (§6).

**Branch:** `claude/touch-nav`, made from `origin/claude/grouping` at
`b37c482` (grouping's release candidate plus `devtasks/` notes). Grouping is
not released: DEV and PROD are on `331e4aed` (`selection-parts`), state
`COMPLETE` (`release_status`, 2026-11-10 10:10 PT).

**Chosen by the operator** (2026-11-10, 11:36 PT, "Maybe a good time to do the
phone navigation implementation"), after a review of the deferred lists in
every passdown since 2026-10-20. It was picked as a round that stays mostly
clear of grouping's code (§2.5).

## 1. What this delivers
Today a phone can show a world but can't move through it: a touch drag
neither turns the view nor walks (§2.2, probe 1). "No touch movement: you
can't walk onto a teleporter on mobile" has been a recorded limit since
models-by-url (10-20 passdown §6.2).

This round, for a visitor or an owner on a touch screen:
- **look:** a one-finger drag on the view turns it (WALK) or orbits (ORBIT);
- **walk:** an on-screen stick moves the avatar, with speed by how far it is
  pushed (TN-L1, TN-L4), so a teleporter pad can be walked onto;
- **zoom:** a pinch zooms in ORBIT, as the wheel does (TN-L3);
- **a tap stays a tap:** it still selects in Edit and Inspect, and still
  sends `activate` outside them (§2.3: this already works);
- the hint text says what touch does.

**Not in this round** (unless a decision says so): editing on a phone beyond
what works today (handles, Edit panel layout); a full phone layout of the
panels; keyboard-free routes for M (pointer lock, meaningless on touch), V
(first person) and Space (world cameras), except as TN-L6 decides; FLY's
vertical movement (there is none today, §2.1); pen input; gyroscope look;
WebXR.

## 2. Verified facts (at `b37c482`)

### 2.1 Navigation today
- `packages/client/src/NavigationController.js` (203 lines, no Three.js):
  `onMouseMove(dx, dy)` turns yaw and pitch (WALK, FLY) or azimuth and
  elevation (ORBIT), at `mouseSensitivity` 0.002 rad per pixel; pitch is
  clamped to ±π/2.5, elevation to ±π/2.2. `onWheel(deltaY)` zooms ORBIT by
  ×1.1 or ×0.9, radius 0.5–100. `onKeyDown/Up(code)` keep a key set.
- `tick(dt)` moves on the XZ plane from WASD or the arrows: a **digital**
  direction, normalised, at `_speed` (the world's `navigation.speed.default`,
  else 1.4 m/s). FLY moves exactly like WALK (y is kept at ≥ 0.7, nothing
  moves it up or down). `setView` sends position, look, move and velocity.
- Allowed modes come from the world's `navigation.mode` (default
  `['WALK', 'FLY', 'ORBIT']`); `atrium.gltf` offers WALK and ORBIT (probe 1).
- `apps/client/src/app.js` L4024–4119 wires it: a `mousedown` on the canvas
  starts a look-drag unless a handle is dragging (B3); `mousemove` with a
  drag (or pointer lock) calls `onMouseMove`; `keydown`/`keyup` on the canvas
  feed the keys, M, V and Space; `wheel` on the canvas zooms. **Every path is
  a mouse or key event.** The nav object is `stage.nav`.
- Teleporters fire on the avatar's position (`teleport-trigger.js`,
  `TELEPORT_TRIGGER_RADIUS`), so walking is all a pad needs.

### 2.2 What touch does today (probe 1, probe 2: Chromium, 390 × 844, mobile, real CDP touch events)
`devtasks/spike-touch-nav/probe1.py`, `probe2.py`, on the harness at `b37c482`:
- **A one-finger drag of 160 px, horizontal or vertical, changes nothing:**
  yaw 0, pitch 0, position `[0, 0.7, 0]` after each. A two-finger drag the
  same.
- **Why:** a touch drag fires `pointerdown`, one `pointermove`, then
  `touchmove`s only: the browser takes the gesture for panning
  (`touch-action: auto` on the canvas) and no `mousemove` is ever sent.
  The look-drag listens to `mousemove` only.
- **A tap** fires `pointerdown`, `pointerup`, then the compatibility
  `mousemove`, `mousedown`, `mouseup` and `click` (pointerType `touch`), so
  the click paths (select, Inspect, `activate`) already work on a tap.
- **The page at phone width:** the top bar is **780 px wide** at a 390 px
  screen (`scrollWidth`), so Chromium's mobile emulation lays the page out at
  `innerWidth` 780. The screenshots show the World field, Connect, the mode
  switcher and the Edit button off the right edge or shifted
  (`shots/touch-0*.png`). **On a real phone this is not a problem:** the
  operator (2026-11-10, 14:04 PT): "You can currently do pretty much
  everything except navigate on mobile, you can use edit mode." The
  emulation's layout is not evidence of the real page.
- The hint reads "Drag to look · WASD to move · [M] mouse lock · [V] first
  person".

### 2.3 Touch paths that exist and must keep working
- `app.js` L2339: `pointerdown`/`pointermove` capture listeners on the
  viewport feed `handlePress` (selection-parts T17): a press on a move handle
  is a click until 4 px (`CLICK_SLOP_PX`). Fresh-check and review findings of
  that round were about touch order (selection-parts lesson 4): on touch the
  compatibility `mousedown` comes **after** the release.
- `TransformControls` (r163) takes its own pointer events on the canvas.
- SP-L11 on touch: a second tap that travels 4 px or more can still drag
  (stated, not promised).

### 2.4 Pointer Events are the route
Every current mobile browser Atrium would meet (iOS Safari 13+, Android
Chrome) sends Pointer Events for touch. With `touch-action: none` on the
canvas the browser stops claiming the gesture, so `pointermove` arrives for
every finger with its own `pointerId`. That is the mechanism this round uses;
the probes will check it on the harness before FINAL (§5, t1).

### 2.5 Overlap with grouping (why this round now)
Grouping's files (HANDOFF-grouping §1): `app.js`, `index.html`, `edit-*.js`,
`model-form.js`, `AtriumClient.js`, `add-spec.js`, server files, the SOM
Inspector's `app.js`. This round touches `NavigationController.js` (not in
grouping), a new pure module `apps/client/src/touch-nav.js`, `app.js`'s
navigation section (L4024–4119, which grouping didn't change) and
`index.html` (a stick element and CSS). Grouping's DEV acceptance could still
change `app.js` and `index.html`; this round's changes there are additive and
in other sections, so a rebase is expected to be mechanical.

## 3. Decisions (all taken 2026-11-10, as recommended: see Status)

**TN-L0. When to build.**
- (a) **Recommended:** pre-brief and reviews now; build now on
  `claude/touch-nav` (low overlap, §2.5), rebased on grouping's final tip;
  release only after grouping is `COMPLETE` on PROD.
- (b) Pre-brief only until grouping ships (the standing rule).

**TN-L1. How you walk.**
- (a) **Recommended: an on-screen stick** at the bottom left: put a thumb
  down there and push; the avatar walks in that direction, faster the
  further you push, and stops when you let go. A drag anywhere else on the
  view looks. The common pattern in phone 3D games and in Mozilla Hubs.
- (b) **Tap the floor to walk there** (as Matterport and many web viewers
  do): simple, but a tap already selects and activates (§2.3), so it would
  need a rule for what a tap on the floor means versus a tap on an object.
- (c) **Hold to walk forward** where you look, drag to steer. One finger,
  but no backing up or sidestep.
- (d) (a) now, (b) as a later addition.

**TN-L2. Where the stick lives.**
- (a) **Recommended: a fixed stick** (a ring at the bottom left, always
  visible on a touch screen while connected).
- (b) **A floating stick:** wherever the thumb lands in the left third of the
  view, the stick appears there. Friendlier for thumbs, but the left third
  then can't look by dragging, only the rest.

**TN-L3. ORBIT on touch.**
- (a) **Recommended:** a one-finger drag orbits (as the mouse drag does), a
  two-finger pinch zooms (as the wheel does); the stick is hidden in ORBIT
  (it has no movement to give).
- (b) Leave ORBIT mouse-only this round.

**TN-L4. Speed.**
- (a) **Recommended:** analog, from zero up to the world's speed
  (`navigation.speed.default`), by how far the stick is pushed, with a small
  dead zone in the middle.
- (b) Digital, like the keys: any push walks at full speed.

**TN-L5. The page at phone width.** The top bar is twice a phone's width
in emulation (§2.2), but the operator reports everything but navigation
works on his phone, Edit mode included.
- (c) **Recommended now: nothing:** leave layout alone this round.
- (a) The minimum: the top bar wraps onto more lines (or
  scrolls sideways inside itself) so World, Connect, the mode switcher and
  Edit are all reachable at 390 px, with nothing else redesigned.
- (b) A compact phone top bar (a menu button that opens the rest).


**TN-L6. V (first person) and Space (world cameras) on touch.**
- (a) **Recommended:** one small on-screen button for first person, shown on
  a touch screen; world cameras stay keyboard-only.
- (b) Both as buttons.
- (c) Neither this round.

**TN-L7. When the touch controls show.**
- (a) **Recommended:** from the first touch on the page (a `pointerdown`
  with `pointerType` `touch`), so a laptop with a touch screen shows them
  only once touched, and a mouse never does.
- (b) Whenever the device reports a coarse pointer (`(pointer: coarse)`).

**TN-L8. Edit mode on a phone.**
The operator uses Edit mode on his phone today (§2.2), so this matters.
- (a) **Recommended:** the stick and drag-look work in Edit and Inspect too;
  a drag that starts on a move handle drags the handle (B3, as the mouse
  does), and taps select as today. No Edit panel layout work.
- (b) Touch navigation outside Edit only.

**TN-L9. Which phone the acceptance uses.** The operator's phone and browser
(iOS Safari or Android Chrome, and which). The harness can emulate touch in
Chromium only; Safari's touch is checked on the real phone at DEV.

## 4. The contract
**T1 `NavigationController`** (`packages/client/src/NavigationController.js`):
- `setMoveInput(x, z)`: the stick's vector, x to the right, z backwards (as
  the keys' `dz`: forward is −1); its length is clamped to 1. `(0, 0)` stops.
- `tick` in WALK/FLY: **any movement key held wins** and moves exactly as
  today. Otherwise a stick input of length m > 0 moves in its direction at
  `speed × m` (TN-L4 (a)), and `setView` sends `move` = the unit direction,
  `velocity` = `speed × m`. ORBIT ignores the stick.
- `onTouchLook(dx, dy)`: `onMouseMove`'s rule at `touchSensitivity`
  (constructor option, default **0.005 rad per CSS pixel**, so a drag across
  a 390 px screen turns about 112°; tuned on the phone at DEV).
- `onPinch(ratio)`: ORBIT only: `radius /= ratio`, clamped to 0.5–100 as the
  wheel's. A ratio ≤ 0 or not finite does nothing.
- Nothing else changes: keys, mouse and wheel paths are as they were.

**T2 `apps/client/src/touch-nav.js`** (new, pure, no DOM): `createTouchNav(
{ slop = TOUCH_LOOK_SLOP_PX (10), stickRadius = 48, deadZone = 0.12 })`
(Rev 1.3: 10 px, not the mouse's 4, above Chrome on Android's tap slop;
the outside review's S-1), fed pointer
events of `pointerType` `touch` and returning effects:
- `down({ id, x, y, on, stickCentre })`, `on` is `'stick'`, `'view'`,
  `'handle'` (a press TransformControls took: B3) or `'other'`;
  `move({ id, x, y })`; `up({ id })` (also for `pointercancel`); `reset()`.
- Effects: `{ type: 'move', x, z }`, `{ type: 'knob', dx, dy }` (the knob's
  offset in px), `{ type: 'look', dx, dy }`, `{ type: 'pinch', ratio }`.
- **Stick:** one pointer owns it. Its offset from the centre is clamped to
  `stickRadius`; the vector is offset / radius; below `deadZone` it is
  (0, 0), above it is rescaled so the edge of the dead zone is 0 and the rim
  is 1. Up, cancel or `reset()` sends `move (0, 0)` and `knob (0, 0)`.
  A second press on the stick while it is owned is ignored.
- **Look:** the first `'view'` pointer. It sends nothing until it has
  travelled `slop` from its press (so **a tap stays a tap**: no look, and the
  browser's click follows as today); then it sends the whole travel since
  the press, then each move's delta.
- **Pinch:** a second `'view'` pointer while one is down: look stops; every
  move sends `pinch` with the ratio of the fingers' distance to their last
  distance. When one lifts, the other goes on looking from where it is,
  without a jump. A third `'view'` pointer is ignored.
- `'handle'` and `'other'` pointers are never tracked.
- **Swallow the click after a look** (found while building, Rev 1.1): Chrome
  still sends a `click` for a touch drag inside its own tap slop, which is
  wider than ours, and on touch the compatibility `mousedown` arrives at the
  release (selection-parts lesson 4), so `isSelectClick` can't see the
  travel. A `'view'` finger that looked or was part of a pinch returns
  `{ type: 'swallow-click' }` on release; the page then drops the next
  `click` **on the canvas** within 500 ms (a capture listener on the
  viewport, `stopImmediatePropagation`), and the next touch press disarms
  it (Rev 1.2, the fresh check's F1). Otherwise a 6 px drag would turn the
  view **and** select or activate.
- `down({ primary })` (Rev 1.2): a primary touch means no other finger is
  down, so anything still tracked lost its release; it is dropped and the
  stick stops.
- **A tap with the stick held** (Rev 1.3, the outside review's S-2): Chrome
  sends no click for a tap while another finger is down, so a `'view'`
  finger that never looked, lifted while the stick was held, returns
  `{ type: 'tap', x, y }`, and the page makes the compatibility `mousedown`,
  `mouseup` and `click` at that point (a real click that follows is
  dropped). The First person button acts on a touch `pointerup`. **Limit:**
  Edit panel buttons need the stick let go.
- **One finger drives a handle** (Rev 1.3, S-3; Rev 1.4, S-5 and S-6):
  while a handle drags, the canvas hears only the touch pointer that last
  pressed it before the drag began. The handle press (T17) is the pointer
  that pressed: a touch pressed while a handle drags is not a new press,
  and only the pressing pointer's moves count. A `pointercancel` of the
  handle finger, a primary touch during a drag, blur and a hidden page end
  the drag.
- **No clocks** (Rev 1.4, S-7): the click swallow and the First person
  button's "ignore the click after a touch" are flags, armed at the release
  and cleared by the click or the next press.
- **A made-up tap** (Rev 1.4, S-8) needs a release, not a `pointercancel`,
  and a finger down at most `TAP_MAX_MS` (500 ms).
- **The slop on screen** (Rev 1.4, N-8): the page passes `slop` as
  `TOUCH_LOOK_SLOP_PX / visualViewport.scale`.
- **Limits** (Rev 1.4, N-9): with the stick held, Edit panel buttons need
  the stick let go; a tap on a move handle does nothing (it is a handle
  press, and Chrome sends no click); a double-tap can't go into a group
  (the made-up click is a single click). Without the stick, a tap while
  another finger is looking makes a pinch, not a tap.
- `releaseStick()`: lets the stick go and leaves a look or pinch in progress
  alone (the page calls it when the stick hides, e.g. on entering ORBIT
  mid-pinch); `reset()` drops everything.

**T3 `apps/client/index.html`:**
- `#viewport canvas { touch-action: none }`, so the browser doesn't take a
  drag for panning (§2.2).
- `#touch-stick` (a ring, 2 × `stickRadius` across, with a knob) at the
  bottom left of the viewport, above the hint; `#touch-fp` (a small
  "first person" button) beside it. Both `hidden` until shown (T4), below
  the panels in stacking order, `touch-action: none`.
- No other layout change (TN-L5 (c)).

**T4 `apps/client/src/app.js`**, the navigation section:
- `pointerdown` on the viewport (bubble phase, after TransformControls'
  own listener has set `dragging`), `pointerType` `touch` only: classify it
  (on the stick, on the canvas with a handle dragging = `'handle'`, on the
  canvas = `'view'`, else `'other'`); `pointermove`, `pointerup` and
  `pointercancel` on `document`. Apply effects: `look` → `nav.onTouchLook`
  unless a handle is dragging; `move` → `nav.setMoveInput`; `pinch` →
  `nav.onPinch`; `knob` → the knob's transform.
- **Shown** (TN-L7 (a)): from the first touch `pointerdown` on the page,
  `#touch-stick` shows while there is an avatar (a static world's camera
  too: Rev 1.3, the review's N-1) and the mode is not ORBIT (TN-L3 (a)); in
  Edit and Inspect too (TN-L8 (a)). `#touch-fp` and its hint only while
  connected.
- The touch state resets (stick released) on a mode change, on disconnect,
  on `blur` and when the page is hidden.
- `#touch-fp` does what V does: V's body moves into one function
  `toggleFirstPerson()` that both call.
- The hint, once a touch has been seen: WALK "Drag to look · Stick to walk
  · 👤 first person"; ORBIT "Drag to orbit · Pinch to zoom"; Edit and Inspect
  "Tap to select · Double-tap goes into a group · Drag to look · Stick to
  walk" after the mode's name. Mouse hints are unchanged.
- Mouse, key and wheel listeners are unchanged.

**T5** `setView` carries the analog `move` and `velocity` (T1). Peers only
pass these on (`AtriumClient` L2004, L2205); nothing animates from them, so
no peer change and no schema change (`velocity` is already a number).

## 5. Tests and checks (Rev 1.4: the handoff's §7 has the latest counts; below, as at `31b538a`)
- **Unit:** `packages/client/tests/navigation-touch.test.js` (T1, 10) and
  `apps/client/tests/touch-nav.test.js` (T2, 23). The client app suite:
  1,860 pass, 0 fail; `packages/client`: 770 pass.
- **Harness:** `devtasks/harness/checks/touch-nav/tn.py` (helpers in
  `tn_lib.py`), Chromium at 390 × 844, mobile, CDP touch events, **35/35
  PASS**, exit status 1 on any FAIL. Besides Rev 1.1's t0–t9: t3b–t3g taps
  (S-1, S-2), t6b a second finger during a handle drag (S-3), t10–t10e the
  stick lets go on every route (S-4, with a proof), t11 a static world
  (N-1). The handoff's §6 lists them.
- **No regression:** selection-parts `c1` (29), `c3` (30), `c5` (10) and
  grouping's `smoke.py` (7) all pass at `31b538a`.
- **On the phone (DEV acceptance, Android Chrome):** the handoff's §4.
**Harness gotcha:** at 390 px the top bar is 795 px wide, and focusing a
  field there pans the visual viewport sideways (`visualViewport.pageLeft`
  211), which puts every CDP touch about 210 px off. The checks set fields
  from script and assert the page isn't panned (`home()`). At 390 px the
  Edit panel covers the middle of the view; t6 turns until the cube is left
  of it (probe 4: the same drag by mouse and by touch moves it 0.573).
- **On the phone (DEV acceptance, Android Chrome):** the feel: stick size
  and place, look speed (0.005 rad/px), the dead zone; a pad walked onto;
  Edit taps and a handle drag; two thumbs at once.

## 6. Process
As every round (selection-parts passdown §4): this pre-brief; a fresh-agent
check; an outside review (Fable, SHA-pinned prompt); the operator's
decisions; FINAL. Probes in `devtasks/spike-touch-nav/`.

## 7. Review log
- Rev 0.1 (2026-11-10): first draft, probes 1 and 2.
- Rev 1.4 (2026-11-10): the second outside review's fixes (HANDOFF §7): the handle press is the pointer that pressed; a cancelled handle drag ends; flags, not clocks; no made-up tap after a cancel or a long press; the slop on screen; the limits written down.
- Rev 1.3 (2026-11-10): the outside review's fixes (HANDOFF §6): a 10 px look slop; a tap with the stick held; one finger drives a handle; the stick in a static world, First person only connected.
- Rev 1.2 (2026-11-10): the fresh-agent check's fixes (HANDOFF §5): the swallow only eats a canvas click and is disarmed by the next press; `primary`; the hint as T4 words it.
- Rev 1.1 (2026-11-10): swallow the click after a look; `releaseStick`; §5's results.
- Rev 1.0 (2026-11-10): the decisions (Status), the full contract (§4).
- Rev 0.2 (2026-11-10): the operator's report of his phone (§2.2): only
  navigation is missing; TN-L5 now recommends (c), TN-L8 notes Edit on a
  phone is in use.
