# Pre-brief: walking and looking on a phone (`touch-nav`)

Status: **DRAFT, Revision 0.2 (2026-11-10).** Written by Claude for the
operator's decisions (§3). Not reviewed yet. **No implementation until
`grouping` is `COMPLETE` on PROD and the operator says go**, unless the
operator decides otherwise (TN-L0).

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

## 3. Decisions (for the operator)

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

## 4. The contract (sketch, for the recommendations)
To be written in full after the decisions. Its parts:
- **T1 `NavigationController`:** `setMoveInput(x, z)` (each −1…1, the
  stick's vector, magnitude clamped to 1), read by `tick` beside the keys
  (keys win when both are held; analog speed per TN-L4); `onLookDrag(dx,
  dy)` = `onMouseMove` with a touch sensitivity of its own (to tune on the
  phone); `onPinch(ratio)` for ORBIT. Unit tests in
  `packages/client/tests/`.
- **T2 `apps/client/src/touch-nav.js` (new, pure):** the gesture state
  machine over pointer events: which `pointerId` owns the stick, which owns
  the look, two fingers as a pinch, the 4 px slop so a tap stays a tap,
  `pointercancel` and a lost pointer ending a gesture, a handle drag (B3)
  taking the pointer. No DOM; tested in node with event sequences, including
  touch's order (selection-parts lesson 4).
- **T3 `index.html`:** `touch-action: none` on the canvas; the stick
  (TN-L2); the first-person button (TN-L6); no layout change (TN-L5 (c)).
- **T4 `app.js` wiring** in the navigation section: pointer listeners for
  `pointerType` `touch` only (mouse paths unchanged); the hint text for
  touch; the stick hidden in ORBIT and while disconnected.
- **T5 the move's `setView`:** `move` and `velocity` carry the analog values,
  so other viewers' avatar animation sees walking (check what peers do with
  `velocity` before FINAL).

## 5. Tests and checks (sketch)
- Unit: T1, T2 as above; every gesture asserts the outcome (selection-parts
  lesson 2): yaw, pitch, position, selection, Undo stack.
- Harness (Chromium, mobile emulation, CDP touch): t1 a drag looks; t2 the
  stick walks onto a teleporter pad in `atrium.gltf` and the teleport
  happens; t3 a tap still activates and selects; t4 a pinch zooms ORBIT;
  t5 a stick push plus a look-drag at once (two pointers); t6 a handle
  drag in Edit on touch is unchanged; t7 a mouse session is unchanged (the existing harness checks still
  pass).
- **A gesture design needs a real-browser probe before it is approved**
  (selection-parts lesson 1): before FINAL, a prototype on the harness, and
  the operator tries it on his phone at DEV acceptance.

## 6. Process
As every round (selection-parts passdown §4): this pre-brief; a fresh-agent
check; an outside review (Fable, SHA-pinned prompt); the operator's
decisions; FINAL. Probes in `devtasks/spike-touch-nav/`.

## 7. Review log
- Rev 0.1 (2026-11-10): first draft, probes 1 and 2.
- Rev 0.2 (2026-11-10): the operator's report of his phone (§2.2): only
  navigation is missing; TN-L5 now recommends (c), TN-L8 notes Edit on a
  phone is in use.
