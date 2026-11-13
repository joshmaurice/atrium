# Release package: `touch-nav`

- **What:** the round on `claude/touch-nav`, based on `b37c482` (grouping,
  now PROD and `main`). Code in 9 files (`git diff --stat b37c482 <tip> --
  . ':!devtasks'`): `NavigationController.js`, `touch-nav.js` (new),
  `app.js`, `index.html`, `edit-press.js`, and their tests. The last code
  commit is `6b249cf` (after the first DEV acceptance pass: handoff §8a);
  everything after it is `devtasks/`.
- **Status:**
  - a fresh-agent code check and three outside code reviews (Fable 5.2; the
    third, which ran the code, APPROVE WITH NITS at `c28064a`); every finding
    taken or written down (`HANDOFF-touch-nav.md` §5–§8);
  - the fixes after the third review (`7a5e59f`, `39c5a2c`, `2eb6ea1`) had a
    fresh-agent check (`7a5e59f`: OK; its two nits taken in `39c5a2c`) and
    the harness (`2eb6ea1`): `tn.py` **54/54**; selection-parts `c1`, `c3`,
    `c5` and grouping's `smoke.py` pass; the client app suite 1,870;
    `packages/client` 770. `2eb6ea1` (the desktop-site scroll fix: two
    lines of CSS and JS) was not reviewed by an outside reviewer.
- **State checked 2026-11-12, 10:50 PT** (`release_status`):
  - `COMPLETE`;
  - DEV and PROD on `b37c4823`, both healthy;
  - deploy lock free;
  - `main` (`b758f19e`, devtasks only past `b37c482`) is merged into the
    branch.
- **No protocol change, no stored-data change, no stale-tab refusal:** a tab
  opened before the deploy keeps working (it just has the old page until it
  reloads).

## 1. The DEV deploy
Ask Claude for the DEV command. Claude checks the branch tip, and that
nothing outside `devtasks/` changed since the last code commit
(`git diff <last code commit> <tip> -- . ':!devtasks'` is empty), then gives:
```bash
atrium-deploy-gate "dev <the 40-character tip SHA>"
```
After the deploy, Claude checks DEV's actual SHA with `release_status`
before the acceptance counts.

## 2. DEV acceptance
**On the phone (Android Chrome)**, the DEV site, hard-reloaded, signed in as
the owner, in a world with a teleporter pad (Home has them).

1. **The controls appear.** Touch the view once. A ring (the stick) and a
   **First person** button appear at the bottom left, and the hint at the
   bottom reads "Drag to look · Stick to walk · 👤 first person".
2. **Look.** Drag one finger across the view: it turns. Up and down: it tilts.
   *Feel:* is the speed right? (A drag across the screen is about 110°.)
3. **Walk.** Push the stick: you walk that way, faster the further you push.
   Let go: you stop. With both thumbs, walk with the left and turn with the
   right.
4. **Teleport.** Walk onto a teleporter pad: it takes you to its world.
5. **First person.** Tap the button: the view goes to your eyes; again: back.
6. **ORBIT.** Pick ORBIT in the mode menu: the stick hides; a drag orbits; a
   pinch zooms. Back to WALK: the stick returns.
7. **Taps in Edit.** Turn on Edit (swipe the top bar sideways to reach it, if
   it's off the edge: the bar scrolls, the page doesn't).
   1. Tap an object: it's selected. Tap 20 times quickly on objects: count
      any tap that turns the view instead of selecting.
   2. With the stick held by the left thumb, tap an object with the right: it
      is selected.
8. **Handles.** Select a cube.
   1. Drag its move handle (the centre): it moves. Undo puts it back.
   2. Tap the selected cube lightly a few times: it doesn't move.
   3. With the stick held, drag the handle with the other thumb: it moves.
   4. While dragging a handle, put a second finger on the view and move it:
      the cube doesn't jump.
9. **The page.**
   1. Turn the phone sideways: the saved-worlds list takes at most part of
      the height, and the view stays visible.
   2. In Chrome's "desktop site" mode, tap the view: the bars stay where
      they are.
10. **On a laptop (mouse):** drag to look, WASD, the wheel in ORBIT, Edit and
    a handle drag all work as before, and no stick appears.

Then MAIN and PROD (§3), then step 11.

11. **PROD.** On the phone, repeat steps 1–4.

**Known and written down** (pre-brief Rev 1.5, §4): with the stick held,
Edit panel buttons need the stick let go, a tap on a move handle does
nothing, and a double-tap can't go into a group. The Edit panel still covers
much of the view in portrait: that is the next round (handoff §9).

## 3. MAIN and PROD (after the acceptance)
Claude gives these with the deployed SHA filled in, after checking
`git diff 6b249cf <DEV SHA> -- . ':!devtasks'` is empty:
```bash
atrium-main-approve <SHA> && atrium-deploy-gate "main <SHA>"
```
Once MAIN has finished:
```bash
atrium-prod-approve <SHA> && atrium-deploy-gate "prod <SHA>"
```
**Never push to `main` between the DEV release merge and PROD `COMPLETE`.**

## 4. Release notes
**New on phones and tablets (touch screens):**
- **Look:** drag one finger on the view to look around, or to orbit in
  ORBIT mode.
- **Walk:** an on-screen stick at the bottom left. Push to walk, further for
  faster; let go to stop. It works with a look-drag at the same time.
- **Zoom:** pinch in ORBIT mode.
- **First person:** a button beside the stick (the V key's toggle), while
  connected.
- The stick and button are the same size on screen at any page zoom
  (Chrome's "desktop site" mode included), and the look turns by screen
  distance.
- The stick and button appear after the first touch, so mouse users never
  see them. They show in Edit and Inspect too, and hide in ORBIT.
- **Taps stay taps:** a tap selects, inspects or triggers a behaviour as
  before. A tap may roll up to 10 px; past that it's a look. With the stick
  held, a tap on the view still works (the page makes the click Chrome
  doesn't send).
- **Handles on touch:** a touch handle press becomes a drag after 10 px
  (the mouse keeps 4 px), and while a handle is dragged only the finger that
  grabbed it moves the object.

**The page on a phone:**
- The top bars scroll sideways inside themselves; the page is never wider
  than the screen.
- The saved-worlds list takes at most 40 % of the height, and scrolls inside.
- A tap on the view no longer scrolls the bars off the top of the screen.

**Fixed along the way:** leaving ORBIT puts the avatar back where it stood
(it used to stay at the height the orbit left it, floating in WALK).

**Stated limits:**
- With the stick held: Edit panel buttons need the stick let go; a tap on a
  move handle does nothing; a double-tap can't go into a group.
- Without the stick, a tap while another finger is looking makes a pinch,
  not a tap.
- In portrait the Edit panel covers much of the view (the next round).
- ORBIT starts where you stand, circling the world's origin, so switching
  to it shows no change until a drag (unchanged; a later round).

**Rollback:** to `b37c4823`. No stored data or protocol changed.
