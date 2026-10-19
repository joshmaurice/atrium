# Pre-brief: Edit mode tweak round (after Phase 3 step 2)

Status: **FINAL, Revision 1.1 (2026-10-19). Decisions K1–K4 approved by
the operator.**
- **Rev 1.1** applies an outside review of Rev 1 (ChatGPT, 2026-10-19: one
  must-fix, two should-fix, one optional), each checked against `9d5a17f`
  (§10): a repeated shortcut is still consumed (K3, Z4, Z5); `addBackFace`
  copies every attribute (Z1); browser checks for blocked shortcuts (§5.1,
  §6).
- **Rev 0** (2026-10-18, `claude/prebrief-undo-tweaks` @ `5f54de3`, branch
  since deleted) was probed at `09da28c`, before step 2's revision R1. It
  was called the "undo tweak round" and had six items and J1–J7.
- **Rev 1** re-probes against the released code and applies the operator's
  decisions (voice session 2026-10-18 evening, lane on 2026-10-19):
  - **Items 1–3 of Rev 0 shipped in step 2's R1** (passdown 2026-10-18
    §5.2): Undo/Redo in their own row (`#ep-history`), the undo-rename
    lockup (R2: `renameAccepted` clears `inFlight`), and W10's selection on a
    removal. **J1–J3 are void. J7 is void too:** R2 kept
    `OUT_OF_STEP_MESSAGE` as Rev 0 recommended.
  - **What's left:** back faces (now planes **and teleporter pads**), the
    Delete and Duplicate keys, and retiring the teleporter delete mode. Rev
    0's J4–J6 are K2–K4 here.
  - **Lane changed to the full pipeline** (K1).
- **Drafted by Claude from a clone of `main` at `9d5a17f`.** Its runtime code
  is identical to the released `c2b8301d` (DEV, MAIN record and PROD):
  `git diff --stat c2b8301d 9d5a17f` shows only the undo-redo passdown.
  Claims marked *probe* were run against the real modules with throwaway
  scripts (not committed).
- **Board and host at drafting** (ops connector, 2026-10-18 evening and
  2026-10-19): release `COMPLETE`, nothing ready, running or blocked, DEV and
  PROD healthy, deploy lock free. The only warning is the MAIN record vs
  `origin/main`: the passdown upload above.
- **Scope:** `packages/renderer-three` and `apps/client` only. No server,
  protocol, SOM or `packages/client` change, so no DEV restart.
- **Out of scope:** E7; duplicating nested nodes; public SOM geometry
  getters; `objectId`; migrating existing planes and pads; one-sided
  surfaces in imported or legacy content; touch controls for phones (a
  roadmap idea from the same session, not this round).
- Line numbers are approximate, at `9d5a17f`.

## 1. What this round is
Three small Edit mode fixes, now that undo exists:
1. **Back faces.** Palette planes and teleporter pads are one-sided, so they
   vanish when seen from below: a plane overhead, or a pad raised above eye
   level in Edit mode (operator report). They become visible and clickable
   from both sides.
2. **Delete and Duplicate keys** (1b-2 J9): Delete/Backspace and
   Ctrl/Cmd+D in Edit mode.
3. **Retire the teleporter delete mode** (1b-2 J7): Edit mode deletes pads,
   and Undo brings them back.

## 2. What the code does today (at `9d5a17f`)

### P1. Planes are one-sided
`primitiveGeometry('plane')` (`packages/renderer-three/src/geometry-utils.js`
~L131) is `PlaneGeometry(2, 2)` turned to face +Y. *Probe:* 4 vertices, 2
triangles, every normal +Y. The material is single-sided (glTF default;
Duplicate refuses `doubleSided`, 1b-2 N3). Test `plane: lies flat, facing
+Y` (`primitive-descriptor.test.js` ~L92) asserts every normal is +Y.

### P2. Teleporter pads are one-sided
`buildTeleporterDescriptor` (~L180) is a `RingGeometry(0.45, 0.75, 48, 1)`
turned to face +Y and lifted 5 cm. *Probe:* 98 vertices, 96 triangles, every
normal +Y, descriptor ~9.3 KB as JSON. Placement forces y = 0, but an Edit
mode move can raise a pad, and from below it's invisible.
- **The trigger zone doesn't read geometry:** `rebuildPads()` (`app.js`
  ~L485) feeds `derivePads()` (position and destination) to the trigger, so
  the geometry change can't move or resize it.
- `threeGeometryToGltfPrimitive` (~L17) copies POSITION, NORMAL and the index
  array from a three.js geometry; no UVs.
- **Restore and Duplicate limits** (`apps/client/src/edit-duplicate.js`):
  indices ≤ 65535 (L30), POSITION + NORMAL only (~L125), `add` ≤ 1 MB (L19).
  A back-faced pad (196 vertices, 192 triangles, ~19 KB) and plane (8, 4)
  stay well inside them.

### P3. Keys today
- **Undo keys** (W9, R9): their own document listener (`app.js` ~L2231).
  Edit mode only; Ctrl/Cmd required, Alt refused; skipped when the target
  is a text-entry field (`input` other than checkbox/radio/button,
  `textarea`, `select`); `preventDefault` on a handled key. It's registered
  **before** the canvas navigation listener (~L2541).
- **The navigation listener** handles keys whose target is the canvas, and
  passes `e.code` to navigation, modifiers or not; `KeyD` strafes right. So
  Ctrl+D on the canvas today strafes **and** opens Firefox's bookmark
  dialog; if that dialog takes the keyup, the avatar keeps strafing.
- **The Escape listener** (~L1276) handles teleporter modes, then Edit mode
  (B2). It reads `modes.delete`.
- **Browser defaults:** Ctrl/Cmd+D bookmarks the page in Firefox and isn't a
  reserved shortcut, so `preventDefault` stops it. Backspace doesn't go back
  in current Firefox or Chrome; Delete has no default. **On a Mac keyboard
  the "delete" key sends `Backspace`**; forward Delete is fn+delete.
- **The Duplicate and Delete clicks** (~L2276, ~L2302) return silently when
  blocked; `refreshEditActions()` (~L2188) disables the buttons and sets
  their tooltip to the reason. The Delete click does W6: capture → no dialog
  if restorable; `window.confirm(… This can’t be undone.)` if not, then the
  50 ms pause and the identity re-check.

### P4. The teleporter delete mode
- Toolbar `#tp-delete-btn` (`index.html` ~L517); `tpDeleteBtn` (`app.js`
  ~L1170) and its click (~L1488); a viewport click handler that raycasts for
  a pad and confirms with its destination (~L1499); `pendingDeleteSeq` /
  `deleteTargetName` (~L1184) in `resetTeleporterUi` (~L1134),
  `updateTeleporterControls` (~L1229), `exitTeleporterMode` (~L1249), the
  edit-error path (~L1477), the `som:remove` echo (~L1552), the
  teleporter-busy check (~L1711) and the Escape listener.
- `edit-modes.js` holds `'delete'` as a teleporter mode (`modes.delete`,
  L28–55); `edit-modes.test.js` uses it (~L50, ~L61).
- **A pad is restorable** (Rev 0 *probe*: a `buildTeleporterDescriptor` pad
  added to a real `createWorldFromDocument` world passes `prepareRestore`).
  So an Edit-mode delete of a pad asks nothing and Undo restores it (W6).

### P5. Test baseline at `9d5a17f`
Node 22.22.0, clean `pnpm install --frozen-lockfile`:

| Suite | Command | Count |
|---|---|---|
| `apps/client` | `cd apps/client && node --test tests/*.test.js` | **475** |
| renderer-three | `cd packages/renderer-three && node --test tests/*.test.js` | **86** |
| `packages/client` | `cd packages/client && node --test --test-force-exit tests/*.test.js` | 169 |
| interaction | `cd packages/interaction && node --test tests/*.test.js` | 9 |

`apps/client` and renderer-three re-run for this revision, `fail 0`,
`skipped 0`; the other two are the passdown's figures and don't change.
**`apps/client` tests can't import three.js or touch the DOM.**

## 3. Decisions (operator)

- **K1 — Lane: full pipeline** (2026-10-19). Kickoff, GLM brief, brief
  gate, DeepSeek implementation, GLM review, publish, DEV, outside code
  review by a separate Claude session, operator DEV acceptance, MAIN, PROD.
  Chosen to save Claude usage on a small, well-specified round.
- **K2 — Back faces, planes and pads** (Rev 0 J4, extended by the operator
  to pads). The back face is **in the geometry**, not a double-sided
  material, so Duplicate and Undo still accept the node. **Existing planes
  and pads are not migrated**; a duplicate of an old one copies its old
  geometry.
- **K3 — Delete and Duplicate keys** (Rev 0 J5, as recommended):
  - **Delete:** `Delete` and `Backspace`, with no Ctrl, Cmd or Alt.
    **Duplicate:** Ctrl+D or Cmd+D, either modifier on any platform, as
    the undo keys already accept (no platform detection).
  - **The undo keys' focus rule** (P3): Edit mode on, and the target not a
    text-entry field. A checkbox, radio or button doesn't swallow them
    (R9). Outside Edit mode every key stays the browser's.
  - **In Edit mode, Ctrl/Cmd+D is always taken** (`preventDefault`), even
    when Duplicate isn't available, so the bookmark dialog never opens
    there.
  - **Handled keys don't reach navigation** (`stopImmediatePropagation`).
  - **A key does exactly what its button's click does,** through the same
    handler: so a delete that can't be undone still confirms (W6), the
    pause and identity re-check stay, and every block applies. With nothing
    selected the key does nothing (no message). With a selection but the
    button disabled, the key shows the button's tooltip text in the edit
    error line instead.
  - **Auto-repeat runs nothing for Delete and Duplicate, but the key is
    still consumed** (Rev 1.1, review #1): a repeated Ctrl/Cmd+D,
    Delete or Backspace gets `preventDefault` and
    `stopImmediatePropagation` like the first press, so holding Ctrl+D makes
    one duplicate, no strafing and no bookmark dialog. (The undo keys keep
    today's behaviour: each repeat runs.)
- **K4 — Retire the teleporter delete mode** (Rev 0 J6, as recommended).
  Place Teleporter and the destination form don't change.

## 4. The contract

### Z1. A shared back-face helper (`geometry-utils.js`; K2)
`addBackFace(geometry)`: for the indexed, non-interleaved geometries this
round uses (the plane and the ring; its doc comment says so), append a copy
of every vertex in **every** attribute (`position`, `normal` **and `uv`**,
which both three.js geometries carry), negating only the normal; and for
every triangle `(a, b, c)` append `(c', b', a')` on the copies. Every
attribute ends with the same count, so the geometry stays consistent even
though `threeGeometryToGltfPrimitive` only serialises POSITION, NORMAL and
indices (Rev 1.1, review #2, #4). Returns the same geometry. Not exported
from the package index (tests import `src/geometry-utils.js`).

### Z2. Planes (`primitiveGeometry('plane')`)
`addBackFace` after the rotation: 8 vertices, 4 triangles, 4 normals +Y and
4 −Y. Size 2 m × 2 m and `PRIMITIVE_REST_Y.plane` unchanged.

### Z3. Pads (`buildTeleporterDescriptor`)
`addBackFace` after the rotation and lift: 196 vertices, 192 triangles. Inner
and outer radius, the 5 cm lift, the material, `translation` (y forced to 0)
and `extras.atrium.teleporter` unchanged. Every vertex still has y > 0.025
(the existing test).

### Z4. The key map (new pure `apps/client/src/edit-keys.js`; K3)
`editKeyAction(e, { editOn })` → `null`, or `{ action, run }` with `action`
one of `'undo' | 'redo' | 'delete' | 'duplicate'`, from `key`, `ctrlKey`,
`metaKey`, `shiftKey`, `altKey`, `repeat` and whether the target is a
text-entry field. **Recognising a shortcut is separate from running it**
(Rev 1.1, review #1): a repeated Delete, Backspace or Ctrl/Cmd+D still
returns its action, with `run: false`; every other case has `run: true`. The text-entry test (P3) is a
separate pure function of a small target description (`tagName`, `type`),
and `app.js` builds that description from `e.target` (for an element inside
a field, from `closest(…)`), so the tests need no DOM. Undo and redo map
exactly as today (Ctrl/Cmd+Z; Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y). Duplicate is
Ctrl/Cmd+D without Shift or Alt.

### Z5. One key listener (`app.js`; K3)
The undo listener (~L2231) is replaced by one listener using `editKeyAction`.
For any non-null result: `preventDefault()`, `stopImmediatePropagation()`;
stop there if `run` is false; otherwise:
- `undo` / `redo`: `undo.run(…)` and `refreshEditActions()` as today;
- `delete` / `duplicate`: nothing selected → nothing more (the key is still
  taken, so Ctrl/Cmd+D never opens the bookmark dialog in Edit mode); the
  button disabled → `showEditError(button.title)`; otherwise the button's
  own click handler (a shared named function, or `button.click()`).

The listener stays registered before the navigation listener.

### Z6. Retire the delete mode (K4)
Remove: `#tp-delete-btn`, `tpDeleteBtn`, its click and viewport handlers,
`pendingDeleteSeq`, `deleteTargetName`, the delete-mode branches in
`resetTeleporterUi`, `updateTeleporterControls`, `exitTeleporterMode`, the
edit-error path, the `som:remove` echo, the teleporter-busy check and the
Escape listener. In `edit-modes.js`, `setTeleporterMode` accepts only
`'placement'` or `null` (anything else returns `false` with no change), and
`modes.delete` goes. Comments that list "teleporter delete" as a mode are
updated.

### Z7. What does not change
Undo/Redo behaviour; W6 dialogs; Duplicate rules; Place Teleporter;
triggers; labels; navigation keys other than handled Ctrl/Cmd+D. No server,
protocol, SOM or `packages/client` change: if one seems needed, stop and ask
(AGENTS rule 1).

## 5. Tests

| Item | New or changed tests | Proof of failure |
|---|---|---|
| Z1–Z2 | renderer-three `primitive-descriptor`: the plane has 8 vertices and 4 triangles; 4 normals +Y and 4 −Y; **each triangle's winding agrees with its normal** (cross product of its edges); still rests 1 cm up and spans 2 m × 2 m. Test `lies flat, facing +Y` is rewritten to say "top face" | (a) build the plane without `addBackFace` |
| Z1 | `addBackFace` on a two-triangle fixture with `position`, `normal` and `uv`: every attribute's count doubles and they stay equal; every index is below that count; copied positions and UVs equal; normals negated; winding reversed. Also on the real plane and ring geometries: equal attribute counts | (b) append triangles unreversed; (b2) leave `uv` undoubled |
| Z3 | renderer-three `geometry-utils`: the pad has 196 vertices and 192 triangles; half +Y, half −Y; winding agrees with normals; every vertex y > 0.025; extras and translation unchanged | (c) build the pad without `addBackFace` |
| Z2–Z3 | **size and restore limits**: the new plane's and pad's indices ≤ 65535, only POSITION and NORMAL, JSON under 1 MB (renderer-three side, since `apps/client` can't import three.js) | (d) covered by (a)/(c) |
| Z4 | `apps/client` `edit-keys`: Delete and Backspace → delete; Ctrl+D and Cmd+D → duplicate; Ctrl/Cmd+Shift+D and Alt+D → null; Edit off → null for every key; a text-entry target → null for every key; checkbox/radio/button targets → the action; Alt+Delete and Ctrl/Cmd+Backspace → null; `repeat` on Delete, Backspace and Ctrl/Cmd+D → **the action with `run: false`** (not null), and on undo/redo `run: true`; every existing undo-key case | (e) allow keys in text fields; (f) run repeats; (f2) return null for a repeat |
| Z6 | `edit-modes`: `setTeleporterMode('delete')` → `false`, no mode change, triggers unchanged; placement unchanged; no `delete` getter. The two tests that used `'delete'` rewritten | (g) accept `'delete'` again |

**Expected counts:** `apps/client` 475 + new; renderer-three 86 + new; the
rest unchanged. The handoff gives each exact number next to its command.

**Proofs:** commit first; break the file, run, record the failing test
names, restore the file **from a saved copy, never with `git checkout`**,
re-run green.

### 5.1 Claude's checks (after publish, throwaway, not committed)
On the published SHA, in a headless browser with a real server (the 10-18
passdown's harness, §5.1 item 4): a palette plane and a raised pad are hit
by a ray from below; Delete with a cube selected removes it with no dialog
and Ctrl+Z restores it; Ctrl+D duplicates and the avatar doesn't move;
keys in the name field do nothing to the scene; `#tp-delete-btn` is absent.
**Check buttons are visible, not only enabled** (10-18 §4.5).

Rev 1.1 (review #1, #3), because the pure `edit-keys` tests can't prove
the DOM wiring:
- **Held Ctrl+D** on the canvas (a keydown, then several with `repeat:
  true`): one duplicate, one `add` sent, the avatar doesn't move, every
  event `defaultPrevented`. The same for a held Delete: one `remove`.
- **Blocked:** select a node Duplicate refuses (a group), Ctrl+D: the
  button's reason in the error line, no `add` sent. While a structural
  request is pending, Delete and Ctrl+D send nothing.
- **Nothing selected:** Delete and Ctrl+D send nothing and show no message;
  Ctrl+D is still `defaultPrevented`.
- **Not restorable:** Delete on a group opens the confirm (stubbed);
  answering cancel sends nothing and the group stays.

## 6. DEV acceptance (operator, Firefox, hard reload, owner)
Marker: `document.getElementById('tp-delete-btn') === null` is `true`.
1. **Planes:** add a plane, raise it above eye level, walk or fly under it:
   visible from below and clickable; Duplicate and Undo still work on it.
2. **Pads:** Place Teleporter, then in Edit mode raise the pad above eye
   level: visible from below and clickable. Lower it again: its trigger
   still works with Edit off.
3. **Keys:** select a cube: Delete removes it (no dialog), Ctrl+Z restores
   it; Backspace the same; Ctrl+D duplicates it with no bookmark dialog and
   no drift. **Hold Ctrl+D for a few seconds: one duplicate, no movement,
   no bookmark dialog.** Hold Delete on a cube: one delete. Select a group
   and press Ctrl+D: the reason appears, nothing is added. Type in the name field:
   Backspace edits text, Ctrl+D is the browser's. A node that can't be
   undone (a group, or legacy content) still asks. With nothing selected,
   Ctrl+D does nothing and shows no dialog. Edit off: Ctrl+D bookmarks as
   usual.
4. **Delete mode gone:** the toolbar has no teleporter Delete; Place
   Teleporter and Escape out of placement work; a pad is deleted in Edit
   mode with Delete and comes back with Undo.

## 7. Worker rules and release path
**Workers** (as step 2, 10-18 passdown and pre-brief §9 there):
- `pnpm install --frozen-lockfile --prefer-offline` in their own worktree;
- the full handoff: 40-character SHA, per-file counts with commands and exit
  codes, Node version, skipped count, proofs (a)–(g) plus (b2) and (f2), with failing test
  names;
- **an ordered step list, one commit per step:**
  1. `addBackFace`, planes and pads, and their renderer-three tests (Z1–Z3);
  2. `edit-modes.js` without `'delete'`, and its tests (Z6, module part);
  3. `edit-keys.js` and its tests (Z4);
  4. `app.js` and `index.html`: the one key listener and the delete mode's
     removal (Z5, Z6);
  5. full suites, proofs, handoff;
- **`--max-runtime 3h`** at creation; a second consecutive stop blocks with a
  different kind than the first (10-16 §3.5).

**Release path** (S22, accepted 2026-10-18): publish, DEV deploy and
finalizer cards make **one call each**; on any refusal, non-zero exit or
unexpected message they block with the full output, never retry
(10-18 §4.1). The operator answers with `atrium-deploy recover` or a host
fix, never `atrium-release-state` by hand during a deploy.

**Cards** (10-18 §4.2–4.3):
- titles exactly as the kickoff gives them;
- **every stage card's body carries the full 40-character SHA**;
- **the review gate's body carries the four release-card bodies as
  templates**, so the gate builds the chain itself;
- the sentinel hangs off the DEV finalizer, never the review gate;
- hand-made review cards open with "THIS RUN HAS TERMINAL, FILE AND GIT
  TOOLS. Use them for every step below.";
- check every code reference the GLM brief makes.

**Before kickoff:** upload this pre-brief to `main`, then take the base SHA
from a host fetch; no GitHub web edits to `main` from then until PROD; no
open sentinel; a push dry run.

**Outside code review** of the published SHA by a separate Claude session,
alongside §5.1, before DEV acceptance.

## 8. Notes for the brief author
- **The back face is geometry, not material** (K2). Don't touch
  `PRIMITIVE_MATERIAL`, the pad's material or `doubleSided`.
- **Winding:** each appended triangle is reversed, or its front faces the
  wrong way and is culled from both sides. The tests check winding against
  the normal, not only counts.
- **(Rev 1.1) Ignoring a repeat must not mean ignoring the event** (K3,
  Z4): a repeated shortcut is consumed and not run. Returning `null` for it
  lets `KeyD` through to navigation and the browser.
- **One listener, registered before navigation** (Z5): if it's added later,
  the canvas listener sees `KeyD` first.
- **Keys call the buttons' handlers** (K3): no second copy of the delete or
  duplicate logic in the listener.
- **Grep for `modes.delete`, `tpDeleteBtn`, `pendingDeleteSeq` and
  `deleteTargetName` after Z6:** none may remain.
- **`apps/client` tests can't import three.js or the DOM:** the geometry
  tests live in renderer-three; `edit-keys` takes plain objects.

## 9. Where this sits
1. Step 2, undo and redo (`c2b8301d`, released 2026-10-18).
2. **This round.**
3. Next, in the operator's order: Pass B (connector writes, `atrium-ops`) and
   step 3 (models by URL, starter library, sky).

## 10. Review log
- **Rev 0 → Rev 1:** operator decisions in a voice session (2026-10-18
  evening): J4 approved and extended to pads; J5 and J6 approved; J1–J3 and
  J7 void (shipped in R1). Lane changed to the full pipeline on 2026-10-19.

- **Rev 1 → Rev 1.1:** outside review of Rev 1 (ChatGPT, 2026-10-19),
  verdict "approve, subject to #1"; each finding checked against `9d5a17f`:
  1. **Must-fix, accepted.** A repeated Ctrl+D returning `null` would skip
     the listener, and the canvas listener passes `KeyD` to
     `nav.onKeyDown` with no modifier check (`app.js` ~L2581), so holding
     Ctrl+D would strafe and could open the bookmark dialog. Now recognised
     and consumed, not run (K3, Z4, Z5, tests (f)/(f2), §5.1, §6).
  2. **Should-fix, accepted.** Checked: `PlaneGeometry` and `RingGeometry`
     both carry `uv` (4 and 98 entries). `addBackFace` copies every
     attribute (Z1, test (b2)).
  3. **Should-fix, accepted.** Browser checks for blocked, empty, held and
     non-restorable cases (§5.1, §6).
  4. **Optional, taken** in Z1's wording: the helper's doc comment states
     its intended inputs.

## 11. Open for the operator
None. The reviewer saw no need for another review cycle after these
changes.
