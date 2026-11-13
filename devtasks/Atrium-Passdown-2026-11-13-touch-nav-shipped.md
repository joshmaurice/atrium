# Passdown 2026-11-13: `touch-nav` shipped to PROD (`33df9ef6`)

This supersedes `Atrium-Passdown-2026-11-11-grouping-shipped.md` as the
starting point. Read this file first. That passdown's rules and lessons
still hold, and so do the host, connector and convention notes it points to
(`Atrium-Passdown-2026-11-06-richer-add-shipped.md` §3, §4). This file adds
to them.

**First instruction for the next session's Claude:**
1. **Get the repo.** Use `add_repo` on `joshmaurice/atrium` with access
   `push`, clone to `/home/claude/atrium`, and read this file.
2. **Nothing is in flight.** PROD, MAIN and DEV are all on `33df9ef6`,
   state `COMPLETE`. The next step is choosing the next round with the
   operator (§4).
3. **Use the `atrium-ops` connector** (read-only) for board, release, log and
   git state. Check DEV's actual SHA with `release_status` before reading an
   acceptance as done.
4. **These rules are unchanged:**
   - the release rule (push nothing to `main` between the DEV release merge
     and PROD `COMPLETE`);
   - the cost rule;
   - the host-command rule: no leading spaces, real 40-character SHAs, never
     placeholders;
   - the review-SHA rule.
5. **The operator's way of working** (this session):
   - **Ask in plain prose, not multiple-choice boxes,** so it can be
     discussed and read aloud by text-to-speech. Keep answers easy to hear:
     short sentences, no tables in spoken answers.
   - He tests on an **Android phone in Chrome**, often away from a laptop,
     and uses Chrome's **"desktop site"** mode too. Check both.
   - For layout calls: "whichever way will take the least time overall".

## 1. Where things stand
| | |
|---|---|
| **PROD, MAIN, DEV** | **`33df9ef630786596f87f7e4c5a0dfccd29f8ea7f`**, state `COMPLETE` (2026-11-13, about 12:00 PT). PROD serves the same `app.js` as DEV (`24e64a107879`). |
| **The round** | `touch-nav`: touch navigation on phones and tablets. A virtual stick to walk, a one-finger drag to look, a pinch to zoom in ORBIT, and a First person button. |
| **The record** | On `main` now: `devtasks/PREBRIEF-touch-nav.md` (Rev 1.5), `HANDOFF-touch-nav.md` (§1–§9), `RELEASE-touch-nav.md` (commands, acceptance steps, release notes), the reviews `REVIEW-touch-nav-code-fable{,-2,-3}.md`, and probes in `devtasks/spike-touch-nav/`. |

## 2. What the round added (code in 11 files, last code commit `4f24180`)
- **`apps/client/src/touch-nav.js`** (new, pure): the gesture state machine:
  the stick, the look, the pinch, taps (a 10 px slop and 500 ms), and a tap
  while the stick is held.
- **`NavigationController.js`:** a stick input (`setMoveInput`), touch look
  and pinch. **Leaving ORBIT puts the avatar back where it stood.** It used
  to float after an orbit; that bug predates this round.
- **`app.js` and `index.html`:**
  - the touch wiring: the stick and the button appear on the first touch,
    sized and placed in screen px at any page zoom;
  - a touch handle press needs 10 px before it drags (the mouse keeps 4);
  - only the finger that grabbed a handle moves it;
  - the top bars scroll sideways inside themselves;
  - the saved-worlds list is capped at 40 % of the height;
  - a tap no longer scrolls the page away (`100dvh` and a snap-back).
- **`Stage.js` (`renderer-three`):** the drawing buffer is at the screen's
  resolution: the device ratio × min(1, page zoom), clamped to the GPU's
  limits (`clampPixelRatio`). It is recomputed on zoom and on view size
  changes.
- **`edit-press.js`:** a per-press slop.

## 3. Lessons from this round
1. **Chrome's "desktop site" mode was where the DEV passes found problems.**
   Two DEV passes found four problems, all in that mode, and none of the
   reviews had found them:
   - the look too fast;
   - the stick tiny and against the edge;
   - the page scrolling away;
   - a drawing buffer 6 × too big: lag, taps landing low, animations that
     looked frozen.

   The mode lays the page out 980 px wide, zoomed out (`visualViewport.scale`
   about 0.4). `spike-touch-nav/probe12.py` emulates it (`desktop_site()`);
   `probe13.py` measures the buffer, the frame rate and the pick. **Run both
   modes before DEV on any round that touches the page or the view.**
2. **CDP touch emulation has limits** (HANDOFF §3, `tn_lib.py`). It withholds
   one finger's release while another is down. Use synthetic second fingers
   (`synth`, `synth_tap`, with the capture shim for ids ≥ 900, moves with
   `button` −1), and release real fingers together with `Touch.end_all()`.
3. **The harness server must be started with `run_in_background` and
   `timeout: 7200000`.** The default timeout kills it mid-run.
4. **Fixes made after the last outside review were never reviewed by an
   outsider:** `2eb6ea1`, `8ddd85e`, `6b249cf`, `4f24180`. Each had the
   harness, the unit tests and a DEV pass. Worth knowing if anything odd
   turns up there.
5. **Check the code before naming things in acceptance steps.** A step said
   the teleporter pads animate; they don't (the operator caught it).

## 4. Next: the candidates, with what is already known
In the order Claude suggests. The operator hasn't chosen yet.

1. **A small round: two annoyances** (HANDOFF §9's list, items 1–2).
   - **The sign-in isn't followed until a reconnect.** Signing in can leave
     the page in Inspect, not Edit, until the world is disconnected and
     reconnected. Likely cause, from the code: this tab's own login calls
     `autoConnectToHomeWorld`, which returns at once when `client.connected`.
     So the old socket, which the server opened as a guest, is kept.
     signin-sync's `applyChange` does reconnect, but only for another tab's
     change or a `SIGNED_OUT`. The operator suggested reconnecting on login.
     To decide: reconnect to the **same** world (likely friendlier) or to the
     home world. Reproduce first.
   - **"Move to" flickers while a behaviour turns the selected object** (the
     `2-rotation.gltf` graph). Likely cause: the select's `disabled` follows
     `structuralBlock()`, whose `sending` (`editTracker.pendingCount > 0`)
     flips with every rotation the behaviour sends from the owner's tab.
     Group and Ungroup may flicker too. Not yet reproduced; undo-hold's
     `h5.py` (counting rebuilds in 2 s) is the pattern. The sky list's
     flicker (fixed in undo-hold r3) had a different cause: a rebuild on
     every `som:set`.
   - **An imported graph can't target an object that has no id yet**
     (the operator, 2026-11-13, with `2-rotation.gltf`: one `onTick` →
     `quatMul` → `pointer/set` on `/nodes/0/rotation`, 0.05 rad a tick about
     Y; it is the file attached in that session, from an earlier Claude).
     **Reproduced in node.** A group made by Group has no `objectId` until
     something gives it one. The import panel's target picker lists such a
     node by name (`name:<name>`, `graph-import-panel.js` `pickerValue`),
     and `mapping.nodes` passes that string straight into `convertGraph`'s
     `nodeMap`. The conversion is refused before Save with "the conversion
     produces a value the rule refuses: nodeMap or targets is malformed".
     The node in node.js: own without an id, targeting itself → that
     refusal; with an id → ok; targeting a model that has an id → ok.
     **Why it then "started working":** the operator retargeted to a model,
     and Save's stage 1 gave the group its id. After that, the group could
     target itself. **The template form doesn't have the bug:**
     `behavior-form.js` gives a `name:` target its id before sending (its
     stage for `snapshot.targetName`); the import panel only does that for
     its own node. **Fix:**
     - a target that is the own node maps to `mapping.own`;
     - another id-less target gets its id in a stage, as the form does;
     - the stand-in id is used for the preview until then;
     - a test: a group with no id, targeting itself and another id-less node.
   - **The group turned about one object's axis.** As designed: Group puts
     the new group's origin at the grouped object's position (GR-L1 (a),
     `edit-group.js`; that object goes in at translation 0), so a spin turns
     everything about that object's origin. A later round could offer
     "centre the group's origin on its parts" (a pivot), keeping every
     part's world placement.
2. **A phone layout** (HANDOFF §9). The aim the operator stated: not polish,
   since these panels may be superseded, but keep normal phone mode fairly
   usable:
   - the Edit panel covers much of the view in portrait;
   - **the saved-worlds list becomes a much slimmer drop-down** (it takes a
     lot of the screen with a few worlds or more);
   - landscape;
   - the top bar wraps or collapses instead of scrolling.

   Desktop-site mode is the workaround meanwhile. Start from screenshots of
   his phone, and `probe9` / `probe12`.
3. **ORBIT, its own round** (HANDOFF §8a.3, §9). Switching to ORBIT shows no
   change, on desktop and phone: it starts at the avatar's own position,
   circling the world's origin, and it moves the avatar's node itself. To
   decide:
   - what it orbits (the selection, the point looked at, the avatar);
   - where the camera starts;
   - whether the avatar stays put.
4. **The candidates the grouping session left**
   (`NOTE-2026-11-10-grouping-unreleased-next-round.md`):
   - **multi-select:** Shift-click, and Group of several objects;
   - **materials in the Edit panel:** a colour control, a notice that a
     material is shared, and "make this one unique";
   - **the texture limit:** unconfirmed, investigate before stating it.

## 5. Touch-nav's stated limits (in the release notes)
- With the stick held:
  - Edit panel buttons need the stick let go;
  - a tap on a move handle does nothing;
  - a double-tap can't go into a group.
- Without the stick, a tap while another finger is looking makes a pinch.

## 6. Cleanup (the operator, on the host)
`main` now carries this passdown (a fast-forward of devtasks-only commits
from `claude/touch-nav`). Then:
```bash
git -C /root/.hermes/sandboxes/docker/default/workspace/atrium push origin --delete claude/touch-nav
```
