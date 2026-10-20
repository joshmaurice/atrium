# Pre-brief: Edit mode polish 2 (after the edit-tweaks round)

Status: **FINAL, Revision 1 (2026-10-19). Decisions L1–L6 approved by the
operator, all as recommended in Rev 0 (§10).**
- **Drafted by Claude from a clone of `main` at `906ee05`.** Its runtime code
  is identical to the released `ab32f9b8` (DEV, MAIN record and PROD):
  `git diff --stat ab32f9b 906ee05` shows only the edit-tweaks passdown.
  Claims marked *probe* were run against the real modules with throwaway
  scripts (not committed).
- **Board and host at drafting** (ops connector, 2026-10-19 ~18:00 PT):
  release `COMPLETE` at `ab32f9b8`, nothing ready, running or blocked, DEV
  and PROD healthy, deploy lock free. The only warning is the MAIN record vs
  `origin/main`: the passdown upload above.
- **Source:** passdown 2026-10-19 (edit-tweaks) §5.1, items 1–3, from §4.2
  (outside code review) and §4.3 (operator DEV acceptance).
- **Scope:** `apps/client` and `packages/renderer-three` only. No server,
  protocol, SOM or `packages/client` change, so no DEV restart.
- **Out of scope:** touch controls; a richer `add`; migrating existing pads
  (old `teleporter-<uuid>` names stay as they are); pads on surfaces other
  than y = 0; duplicating pads (Duplicate's rules are unchanged); Ctrl+D on
  non-Latin layouts (passdown §4.2 nit, same as the undo keys).
- Line numbers are approximate, at `906ee05`.

## 1. What this round is
1. **Teleporters move into Edit mode.** A **Teleporter** button in Edit
   mode's Add palette opens the destination form; Save adds the pad through
   the palette's path (structure tracker, `undo.registerAdd`), so Undo
   removes it and Redo brings it back. The toolbar's **Place Teleporter**,
   its Cancel and the placement mode go. Teleporters then live entirely in
   Edit mode: added from the palette, moved with the handles, deleted with
   Delete.
2. **A committed guard for the Edit-mode key wiring** (outside review
   should-fix): today only throwaway browser checks catch a wrong order in
   `app.js`.
3. **Three cleanups:** the stale comment at `app.js:477`; the `edit-modes`
   arbitrary-string case (but see L6: item 1 removes the function it tests);
   `addBackFace` throwing on non-indexed geometry.

One consequence of "through the palette path" to know before deciding: a
pad no longer goes **where you click**. Like a cube, it lands 2.5 m in front
of you on y = 0 (`palettePlacement`), and you move it with the handles. The
form's spawn warning stays.

## 2. What the code does today (at `906ee05`)

### P1. Placement is a toolbar mode, outside Edit mode
- `index.html` L516–517: `#tp-place-btn` and `#tp-cancel-btn` in the
  toolbar. L539–551: `#tp-form`, absolutely positioned bottom-left of the
  viewport, titled "Place Teleporter" (world select, destination input,
  spawn warning, error line, Save, Cancel).
- `app.js` L1297: the Place click enters `modes.setTeleporterMode('placement')`
  (refused while Edit is on, E6), shows Cancel and a crosshair. L1307: a
  canvas click raycasts to y = 0 (`projectRayToPlane`, imported L15 and used
  only here), sets `pendingPosition` and opens the form (`openPlacementForm`
  L1331: world list from `/api/worlds` when same origin, spawn warning via
  `nearSpawn`).
- **Save** (L1394): validates (`isValidDestination`, `resolveWorldAddress`),
  names the pad `'teleporter-' + crypto.randomUUID()`, builds it with
  `buildTeleporterDescriptor` and sends `client.addNode`. Its own state:
  `pendingSeq` / `pendingName` / `pendingPosition` (L1182–1184). The form
  closes on the `som:add` echo (L1446); an `error` with its seq shows in the
  form (L1458). **Nothing reaches the undo engine**: this is passdown §4.3.
- Around it: `resetTeleporterUi` (L1135, from `connecting` L722 and
  `disconnected` L732), `updateTeleporterControls` (L1228, also from
  `avatar:local-ready` L761), `exitTeleporterMode` (L1247), the overlay flag
  `teleporterOverlayActive` / `showTeleporterOverlay` (L1190–1195),
  `teleporterRequestPending()` (L1624) feeding `hasPendingStructural`
  (L1606) and disabling the Edit toggle (L1620), and `setEditMode` closing
  the placement mode (L1632).
- The Escape listener (L1271): failure panel, then (ignored while saving)
  placement or form, then Edit mode (B2).

### P2. The palette path (what a teleporter add will use)
`epPalette` click (L2196): only in Edit mode and not `editDispatchBlocked()`;
name from `paletteName`; position and yaw from `palettePlacement(origin,
forward)` (`edit-palette.js` L35: 2.5 m along the view, y = 0);
`client.addNode`; `structure.begin('add', seq, { name, primitive, descriptor })`;
`undo.registerAdd(seq, { name, duplicate: false })`. The answer goes through
`onStructureAnswer` (L2286): the undo engine first; then an `already in use`
rejection retries once with the next palette name (`retryAdd` L2326, keyed
on `request.primitive`); any other rejection shows in the edit error line;
an accepted add is selected (`selectAdded`, J6).
- `epPaletteBtns` is `#ep-palette button[data-kind]` (L1496), enabled in
  `refreshEditActions` (L2117) as `!blocked && modes.edit`.
- **A `data-kind="teleporter"` button would break this handler:**
  `paletteName` and `buildPrimitiveDescriptor` both throw on an unknown kind.
- The undo tooltip is `Undo Add “<name>”` (`edit-undo.js` L339, L487); with today's
  names that reads `Undo Add “teleporter-<36-character uuid>”`.

### P3. Undo and redo of an add, and the pad rebuilds (already decided: verify)
- **Undo of an add** sends a remove (`edit-undo.js` ~L656); **redo** re-adds
  the descriptor captured at the undo (~L664). The capture keeps the node's
  extras (`edit-duplicate.js` L167–168), so `extras.atrium.teleporter`
  survives; a pad is restorable (edit-tweaks P4, and the operator's DEV
  acceptance there: a pad deleted in Edit mode comes back with Undo).
- **Our own add arrives as the server's broadcast:** `AtriumClient` emits
  `som:add` (L933) before it resolves the request as accepted (L936).
- `app.js` `som:add` (L800) calls `rebuildPads()` when the node
  `isTeleporter`; `som:remove` (L811) always calls it. `rebuildPads()`
  (L486) feeds `trigger.setPads` and `syncPadLabels`. **So undo removes the
  pad's label and trigger zone, and redo rebuilds both, with no new code.**
  The same handlers already serve an undone Edit-mode delete of a pad.

### P4. A pad restored under the avatar (L3)
`teleport-trigger.js`:
- `setPads` (L40) keeps `armed`/`wasInside` only for a pad whose name,
  position and destination are all unchanged **and already present**; any
  pad new to the list starts **disarmed**. After an undo the pad is gone from
  the list, so its redo is new: disarmed.
- `update` (L95) arms a disarmed pad only once the avatar is **outside** it;
  it fires on an outside → inside move of an armed pad.
- `setActive(true)` after an editing mode (L62) disarms every pad (1b-1
  review finding 4).
- **So today a pad restored under the avatar does not fire when Edit is
  turned off; it fires after the avatar steps off and back on.** Two
  independent mechanisms give this. No existing test covers "removed, then
  re-added under the avatar" (tests at L13–343 cover a fresh list, rearm on
  reactivation and reconnect).
- Redo needs Edit mode (Y4), but its answer can land after Edit is off (Y7):
  still a new pad, still disarmed.

### P5. The key wiring (item 2)
- Three `document` `keydown` listeners, in this order: Escape (L1271), the
  Edit-mode key listener (L2155) and navigation (L2488, `e.target === canvas`,
  `nav.onKeyDown(e.code)` at L2528 with no modifier check). None uses
  capture.
- The Edit-mode listener: `editKeyAction(...)`; `if (!result) return`;
  `e.preventDefault()`; `e.stopImmediatePropagation()`; `if (!result.run)
  return`; then the action.
- **Nothing committed checks either the order or the consume-before-run
  sequence.** The outside review found four `app.js` mutations (the 4.1 bug
  among them) passing all 506 tests.
- `import-guard.test.js` already reads `app.js` as text (L15–16) and
  parses it with regexes. No lifted-listener harness is in the repo (the
  reviewer's was scratch).
- *Probe* (a throwaway source check, §4 Z6's rule): passes at `906ee05`;
  fails on each of (i) the run check moved before the two consume calls,
  (ii) `stopImmediatePropagation` removed, (iii) the Edit-mode listener moved
  below the navigation listener.

### P6. The cleanups (item 3)
- `app.js` L476–478: "only when no editing mode (Edit, teleporter place,
  teleporter delete) is on". After this round only Edit remains.
- `edit-modes.js` L58: `setTeleporterMode` refuses anything but
  `'placement'`/`null`; its tests use only `'delete'` (`edit-modes.test.js`
  L69–92). **Item 1 retires `'placement'`, which leaves the function with
  nothing to do** (L6).
- `addBackFace` (`geometry-utils.js` L52) handles the index only when there
  is one. *Probe* on `PlaneGeometry(2, 2).toNonIndexed()`: positions 6 → 12,
  normals of the copies negated, index still `null`, **and the copied
  triangle keeps its original winding** (face normal +Z, stored normal −Z).
  So it is worse than silent: it adds a second front face with inverted
  normals. Both callers (plane, ring) are indexed, so nothing ships wrong
  today.

### P7. Test baseline at `906ee05`
Node 22.22.0, clean `pnpm install --frozen-lockfile --prefer-offline`:

| Suite | Command | Count |
|---|---|---|
| `apps/client` | `cd apps/client && node --test tests/*.test.js` | **506** |
| renderer-three | `cd packages/renderer-three && node --test tests/*.test.js` | **98** |
| `packages/client` | `cd packages/client && node --test --test-force-exit tests/*.test.js` | 169 |
| interaction | `cd packages/interaction && node --test tests/*.test.js` | 9 |

`apps/client` and renderer-three re-run for this draft, `fail 0`,
`skipped 0`; the other two are the passdown's figures and don't change.
**`apps/client` tests can't import three.js or touch the DOM.**

## 3. Decisions

### Settled (operator, before drafting)
- **S1 — Undo of a placed pad removes its label and trigger; redo brings
  them back.** They rebuild from the world's add/remove events (P3).
  Verified in code, not redesigned; a pure trigger test (Z5) and §5.1 make
  it checkable.

### Approved (operator, 2026-10-19 18:16 PT, all as recommended)
- **L1 — Lane: full pipeline.** Kickoff, GLM brief, brief gate, DeepSeek
  implementation, GLM review, publish, DEV, outside code review, operator
  acceptance, MAIN, PROD. A client-only round of edit-tweaks' size with a
  written contract; last round ran kickoff → DEV in about 25 minutes with no
  intervention after the brief gate. (Not taken: the prototype lane.)
- **L2 — The destination form sits inside the Edit panel,** right under the
  Add row: the same `#tp-form` element and ids, moved into `#edit-panel` and
  restyled as a panel section (no absolute positioning), titled "New
  teleporter". It opens next to the button that opened it and hides with
  the panel when Edit mode turns off, so there is no orphan form. The panel
  grows taller while it is open. (Not taken: leaving it bottom-left of the
  viewport.)
- **L3 — A pad that redo restores under the avatar waits:** turning Edit off
  doesn't fire it; it fires after the avatar steps off and back on. This is
  today's behaviour (P4), the same rule as spawning on a pad and leaving any
  editing mode; nothing changes but a new test. (Not taken: firing when Edit
  turns off, which needs a trigger change the rearm round deliberately
  avoided and would let leaving Edit mode teleport you away.)
- **L4 — New pads are named `Teleporter`, `Teleporter 2`, …,** like the
  palette's `Cube`, `Cube 2`: readable in the Name field and in the Undo
  tooltip (P2). A pure `teleporterName(isFree)` in `edit-palette.js` built on
  `firstFreeName`; `PALETTE_LABELS` unchanged. Labels and triggers key on
  the node name, not a prefix (`rebuildPads` comment L481–483), and
  `isTeleporter` reads extras, so nothing depends on the `teleporter-`
  prefix. Existing `teleporter-<uuid>` pads keep their names. (Not taken:
  keeping `teleporter-<uuid>` for new pads.)
- **L5 — The key-wiring guard is a source-level test,**
  `apps/client/tests/edit-key-wiring.test.js`, reading `app.js` as
  `import-guard` does (Z6). Cheap, no refactor, and it catches the three
  mutations in P5. It can't check the listener's behaviour after the run
  check (the disabled-button reason, nothing selected); §5.1 keeps covering
  those. (Not taken: lifting the listener into a module with a fake-event
  harness.)
- **L6 — `setTeleporterMode` and the `placement` getter are removed:**
  `triggerActive = !edit`. Item 3's arbitrary-string test becomes "the
  teleporter-mode API is gone" (like edit-tweaks' "the delete getter is
  gone"): with nothing to call, no string can change a mode. (Not taken:
  keeping a `null`-only `setTeleporterMode` as dead code for a test.)

## 4. The contract

### Z1. `edit-modes.js` (L6)
`createEditModes` keeps `edit`, `triggerActive`, `usePointerLock`,
`setEdit`, `togglePointerLock`, `reset`. `setTeleporterMode`, `placement`
and the `teleporter` variable go; `triggerActive` and the sync are
`!edit`. Doc comment: Edit is the only editing mode; teleporters are added,
moved and deleted in it.

### Z2. `addBackFace` refuses what it can't do (`geometry-utils.js`)
Before changing anything, throw an `Error` naming the problem when the
geometry has **no index**, or when any attribute is **interleaved**
(`isInterleavedBufferAttribute`). The geometry is left untouched. Doc
comment updated. Plane and pad output unchanged (their tests stay green).

### Z3. A Teleporter button in the Add palette (`index.html`, `app.js`; L2, L4)
- `index.html`: `<button id="ep-teleporter" title="Add a teleporter pad in
  front of you">Teleporter</button>` last in `#ep-palette`, **with no
  `data-kind`** (P2). `#tp-form` moves into `#edit-panel` right after
  `#ep-palette`, ids unchanged, inline absolute positioning removed, title
  "New teleporter"; its controls fit the panel's 250 px.
- The button's enabled state follows the palette's: `!blocked && modes.edit`
  in `refreshEditActions`.
- **Click:** `pendingPosition` from `palettePlacement(origin, forward)`
  exactly as a palette add (only x and z matter; the descriptor forces
  y = 0); then open the form (today's `openPlacementForm`: world list, spawn
  warning for that position, fields cleared). A click while the form is
  already open (not saving) takes a fresh position and spawn warning and
  keeps what was typed.
- **Save:** today's validation unchanged. Name from
  `teleporterName(isNameFree)` (`isNameFree` as the palette uses it); no free
  name → the form's error line. Refused unless Edit is on and nothing
  blocks (`editDispatchBlocked()`). Then `client.addNode(descriptor)`,
  `structure.begin('add', seq, { name, descriptor, teleporter: true })`,
  `undo.registerAdd(seq, { name, duplicate: false })`, the form shows
  "Saving…" with Save and Cancel disabled, `refreshEditActions()`.
- **The answer** (in `onStructureAnswer`, after the undo engine and after
  the `request.undo` branch): for `request.teleporter`, accepted → close the
  form, then the usual J6 selection; rejected → if the form is still waiting
  on this seq, the message in the form's error line and Save/Cancel enabled
  again, otherwise the usual edit error line; unknown → close the form, as
  a palette add. No `retryAdd` for a pad (it has no `primitive`); a name
  taken meanwhile shows in the form and the next Save picks a fresh name.
- **Closing the form:** its Cancel; Escape (the existing listener, still
  before the Edit-mode branch, still ignored while saving); Edit mode off;
  `connecting` / `disconnected`. Closing while saving forgets the form's
  wait only: the request's answer is still recorded by undo (Y7), exactly as
  a palette add whose answer lands after Edit is off.
- Triggers are off throughout, because Edit mode is on.

### Z4. Retire Place Teleporter (`index.html`, `app.js`)
Remove: `#tp-place-btn`, `#tp-cancel-btn`; `tpPlaceBtn`, `tpCancelBtn` and
their listeners; the canvas placement click (L1307) and the
`projectRayToPlane` import; `pendingSeq` / `pendingName` (the structure
tracker holds the pending add); the `som:add` echo and `error` listeners
for placement (L1446, L1458); `teleporterRequestPending()` (so
`hasPendingStructural` is `!!structure.pending` and the Edit toggle is no
longer disabled by a pad save); `updateTeleporterControls` (callers use
`updateEditControls`); `showTeleporterOverlay` / `teleporterOverlayActive`
(nothing sets the overlay for teleporters any more);
`exitTeleporterMode` / `resetTeleporterUi` become one `closeTeleporterForm()`.
`setEditMode` no longer touches a placement mode. The comment at L476–478
says triggers are active only when Edit mode is off; the T5 banner comment
(L1164–1169) says pads are added from the palette. **Grep after Z4, in
`apps/client`:** `tpPlaceBtn`, `tpCancelBtn`, `tp-place-btn`,
`tp-cancel-btn`, `setTeleporterMode`, `modes.placement`, `pendingSeq`,
`projectRayToPlane`, `teleporterOverlayActive`, `teleporter place`,
`teleporter delete`: none may remain.

### Z5. The trigger after an undo and redo (S1, L3): test only
`teleport-trigger.js` does not change. New tests pin P4: a pad that leaves
the list and returns at the same place with the avatar inside it does not
fire, then fires after the avatar leaves and re-enters; the same when
`setActive(false)` / `setActive(true)` (Edit on, off) brackets the return.

### Z6. The key-wiring guard (L5)
New `apps/client/tests/edit-key-wiring.test.js`, reading `app.js` as text:
- Find every `document.addEventListener('keydown', …)`; the Edit-mode
  listener is the one whose body calls `editKeyAction(`, navigation the one
  whose body calls `nav.onKeyDown(`. Both exist exactly once, neither passes
  a capture argument, and **the Edit-mode listener is registered first**.
- In the Edit-mode listener's body, in this order: `if (!result) return`,
  `e.preventDefault()`, `e.stopImmediatePropagation()`,
  `if (!result.run) return`. **Both consume calls come before the run
  check.**
- A failure message says which rule broke and points at passdown
  2026-10-19 §4.1. The test tolerates whitespace and formatting, not a
  rewrite; a deliberate rewrite updates the test with it.

### Z7. What does not change
Undo/redo rules and labels' wording; W6 dialogs; Duplicate rules; the key
map (`edit-keys.js`); the trigger module; `buildTeleporterDescriptor`; pad
labels; navigation. No server, protocol, SOM or `packages/client` change:
if one seems needed, stop and ask (AGENTS rule 1).

## 5. Tests

| Item | New or changed tests | Proof of failure |
|---|---|---|
| Z1 | `edit-modes`: `setTeleporterMode` and `placement` are not on the object; `triggerActive` is `!edit` through on/off/reset; the tests that used `'placement'` or `'delete'` are rewritten or removed (count stated in the handoff) | (a) put back a placement mode that switches triggers off |
| Z2 | renderer-three `geometry-utils`: a non-indexed geometry throws, and its attributes are unchanged afterwards; an interleaved one throws; plane and ring as before | (b) drop the non-indexed check |
| Z3 | `apps/client` `edit-palette`: `teleporterName` gives `Teleporter`, then `Teleporter 2`, `Teleporter 3` as names are taken; respects the 256 limit as `firstFreeName` does; `PALETTE_LABELS` still has exactly the five kinds | (c) return `Teleporter` without checking `isFree` |
| Z5 | `apps/client` `teleport-trigger`: removed-then-restored under the avatar doesn't fire until left and re-entered; the same with `setActive(false/true)` around the return | (d) make a pad new to the list start armed |
| Z6 | `apps/client` `edit-key-wiring` (new) as Z6 | (e) run check before the consume calls; (e2) no `stopImmediatePropagation`; (e3) the Edit-mode listener moved below navigation |

**Expected counts:** `apps/client` 506 + new − removed; renderer-three
98 + new; the rest unchanged. The handoff gives each exact number next to
its command.

**Proofs:** commit first; break the file, run, record the failing test
names, restore the file **from a saved copy, never with `git checkout`**,
re-run green.

### 5.1 Claude's checks (after publish, throwaway, not committed)
On the published SHA, with the passdown's harness (10-19 §6.3; **a fresh
server per run**, §4.4):
- `#tp-place-btn` and `#tp-cancel-btn` absent; `#ep-teleporter` **visible**
  in Edit mode and hidden with the panel.
- Teleporter → the form opens inside the panel; Save with a manual
  destination: **one** `add` sent, named `Teleporter`, at y = 0 about 2.5 m
  ahead; the pad is selected; one `.pad-label`.
- Ctrl+Z: one `remove`, the label gone; Undo's tooltip read before it says
  `Undo Add “Teleporter”`. Ctrl+Shift+Z: one `add` of the same name, the
  label back.
- **L3:** with the avatar on the pad's spot, undo then redo, turn Edit off:
  no teleport (no new connection) over several frames; walk off and back
  on: the connection to the destination starts.
- Escape closes the open form and leaves Edit on; Edit off closes it; a
  rejected Save (a stubbed rejection) shows in the form and Save works again.
- Keys typed in the destination input stay the field's (Backspace edits,
  Delete doesn't delete the selection).

## 6. DEV acceptance (operator, Firefox, hard reload, owner)
Marker: `document.getElementById('tp-place-btn') === null &&
!!document.getElementById('ep-teleporter')` is `true`.
1. **Add a pad:** Edit on, Teleporter: the form opens in the panel. Pick a
   world, Save: a pad appears ahead of you, selected, named "Teleporter",
   with its label. Move it with the handles.
2. **Undo and redo:** Ctrl+Z: the pad and its label go. Ctrl+Shift+Z: both
   come back. Edit off, walk onto it: it teleports.
3. **Restored under you:** stand on a pad's spot in Edit mode, undo its add,
   redo it, Edit off: nothing happens until you step off and back on.
4. **The form:** Cancel and Escape close it; turning Edit off closes it;
   near the spawn point it warns; typing in it doesn't move or delete
   anything.
5. **Gone:** the toolbar has no Place Teleporter; Edit mode and its keys
   behave as in the last round.

## 7. Worker rules and release path
**Workers** (as edit-tweaks §7):
- `pnpm install --frozen-lockfile --prefer-offline` in their own worktree;
- the full handoff: 40-character SHA, per-file counts with commands and exit
  codes, Node version, skipped count, proofs (a)–(e) plus (e2) and (e3),
  with failing test names, and the Z4 grep output;
- **an ordered step list, one commit per step:**
  1. `edit-modes.js` without the teleporter mode, and its tests (Z1);
  2. `addBackFace` refusing non-indexed and interleaved input, and its tests
     (Z2);
  3. `teleporterName` and the trigger tests (Z3 pure part, Z5);
  4. `app.js` and `index.html`: the Teleporter button and form, the
     palette-path add, Place Teleporter removed, comments (Z3, Z4);
  5. the key-wiring guard (Z6), written against step 4's `app.js`;
  6. full suites, proofs, handoff;
- **`--max-runtime 3h`** at creation; a second consecutive stop blocks with a
  different kind than the first (10-16 §3.5).

Step 1 leaves `app.js` calling the removed `setTeleporterMode` until step 4
(bisect only, as edit-tweaks' `742a605`); the suites stay green because no
test loads `app.js` as code.

**Release path** (S22): publish, DEV deploy and finalizer cards make **one
call each**; on any refusal, non-zero exit or unexpected message they block
with the full output, never retry. The operator answers with
`atrium-deploy recover` or a host fix, never `atrium-release-state` by hand
during a deploy.

**Cards** (10-18 §4.2–4.3, kept in 10-19): titles exactly as the kickoff
gives them; every stage card's body carries the full 40-character SHA; the
review gate's body carries the four release-card templates; the sentinel
hangs off the DEV finalizer, never the review gate; hand-made review cards
open with "THIS RUN HAS TERMINAL, FILE AND GIT TOOLS. Use them for every
step below."; check every code reference the GLM brief makes.

**Before kickoff:** upload this pre-brief (final revision) to `main`, then
take the base SHA from a host fetch; no GitHub web edits to `main` from then
until PROD; no open sentinel; a push dry run.

**Outside code review** of the published SHA by a separate Claude session,
alongside §5.1, before DEV acceptance.

## 8. Notes for the brief author
- **No `data-kind` on the Teleporter button** (P2): the palette handler
  would throw on it. It has its own handler and joins the enable rule.
- **The pad's add is a structural request like any other** (Z3): one at a
  time, recorded by `undo.registerAdd`, answered through
  `onStructureAnswer`. No second pending-seq bookkeeping.
- **Don't touch `teleport-trigger.js`** (Z5): L3's behaviour is already
  there; the new tests pin it.
- **The guard reads text** (Z6): find listeners by what their bodies call,
  not by line number; check order within the body, not exact formatting.
- **Grep after Z4** for the names listed there: none may remain.
- **`apps/client` tests can't import three.js or the DOM:** geometry tests
  live in renderer-three; `teleporterName` and the trigger take plain values.

## 9. Where this sits
1. Edit-tweaks (`ab32f9b8`, released 2026-10-19).
2. **This round.**
3. Next, in the operator's order: Pass B (connector writes, `atrium-ops`) and
   step 3 (models by URL, starter library, sky).

## 10. Review log
- **Rev 0** (2026-10-19 evening, `claude/prebrief-edit-polish-2` @
  `97cd7afe`): drafted from probes at `906ee05`, with L1–L6 open.
- **Rev 0 → Rev 1:** the operator took every recommendation (2026-10-19
  18:16 PT). §3 records them as approved; the contract (§4) was already
  written for them and is unchanged. No outside review of the pre-brief.

## 11. Open for the operator
None.
