# Pre-brief: Edit mode UI, part 1 (Phase 3 step 1b-1) — select, handles, property panel

Status: **FINAL, Revision 2 (2026-10-13)**, with implementation notes (§12).
The operator approved decisions E1–E7 (§4) as recommended, on 2026-10-13.
§12 records where the build differs from Rev 2 and why; the contract text
below is otherwise unchanged.
- **Rev 0** was drafted by Claude from a clone of `main` at `dec8cc4`
  (runtime code identical to the released `a40d01a9`; `git diff a40d01a9
  dec8cc4` is only the edit-plumbing passdown).
- **Every "today the code does X" claim in §2 was checked against that
  clone.** Library claims (`@gltf-transform/view` 4.3.0 and 4.4.0,
  `@gltf-transform/core` 4.3.0, three r163 `TransformControls`) were checked
  against the published package sources.
- **Rev 1** applies an outside review of Rev 0 (ChatGPT, 2026-10-13). Each
  finding was checked against `dec8cc4`; §11 lists them. All six were
  accepted. The changes are in G4, G6, a new G13, E6, E7, B1, B2, B4, B5, B7,
  §7 and §8. E1–E5 are unchanged.
- **Step 1b is split in two** (E2). This file covers **1b-1**: editing nodes
  that already exist. **1b-2** (add palette, delete, duplicate) gets its own
  short pre-brief after 1b-1 ships, with the server cleanup round between
  them (§10).

**Inputs:**
- `devtasks/PREBRIEF-edit-mode.md` §6 (notes for 1b) and F13–F17;
- `docs/DESIGN-phase3-placement-scripting.md` §4.1, §4.6, §10 Q3 and Q7;
- `devtasks/Atrium-Passdown-2026-10-13-edit-plumbing.md` (the newest; what
  1a shipped and the outside-review lesson in §3.3).

**Code facts:**
- **Line numbers:** approximate.
- **Implementation base:** a freshly fetched `origin/main` at the start of
  the round.

## 1. What 1b-1 is

An owner-only **Edit** toggle in `apps/client` that lets the owner:
- **select** a world node in the viewport, with an outline;
- **move, rotate and scale** it with on-screen handles;
- **edit** its position, rotation, scale and name in a small panel;
- **see refused edits** as a message, with the node put back where the
  server has it.

Plus the fixes 1b needs to be correct:
- **F14:** the editor's own accepted edits update the teleporter trigger
  zones;
- **teleporter zones and labels use world positions,** so moving a group
  moves the zones of the pads inside it (G13);
- **one rule decides whether teleport triggers are active** (G6);
- `apps/client` reads **`client.canEdit`** instead of `canPlaceTeleporters`.

**`apps/client` only.** No server, protocol, SOM or `packages/client`
change, so the DEV deploy needs no server restart (fast-lane passdown §3).

## 2. What the code does today (verified at `dec8cc4`)

### G1. 1a gave the client everything 1b-1 needs
- `client.canEdit` from `hello` (`AtriumClient.js` ~L722).
- `client.applyLocally(fn)` (~L234): SOM changes inside it render but are
  not sent.
- `client.renameNode(oldName, newName)` (~L827): returns the `seq`; the
  local rename happens only on acceptance, then `som:rename`.
- `client.lastSendSeq` (~L1216): the `seq` of the send that the last SOM
  assignment caused.
- `edit:accepted`, `edit:rejected` (with `code`, `message`) and
  `edit:unknown`, each carrying `{seq, type, node, field, value}` as sent
  (~L854–890).
- `client.som.checkNewName(name, self)` (`SOMDocument.js` ~L258): the D3
  rules, usable for an instant check before asking the server.

### G2. Every SOM transform assignment sends, every time
- The `translation`, `rotation` and `scale` setters (`SOMNode.js` ~L53–74)
  dispatch a mutation **with no equality check**, and the node listener
  sends each one (`AtriumClient._onLocalMutation` ~L1210).
- **So the throttle has a simple shape:** write every frame inside
  `applyLocally` (renders, no send), and every ~100 ms write the current
  value again outside it (one send). No `packages/client` change is needed.
- The SOM inspector's drag (`tools/som-inspector/src/app.js` ~L144–184)
  sends on every mouse move. That's fine for a dev tool; Edit mode
  throttles.

### G3. Errors from refused edits
- An `error` from the server first resolves the pending edit
  (`edit:rejected`), then is emitted as `error` (~L466–475).
- `app.js`'s `error` handler (~L707) `console.error`s every error, so a
  refused edit also logs. Acceptable; the UI message is the panel's.
- `trackConnect` listens to `error` only until `session:ready`, so a refused
  edit can't fail a connect.
- **Answers arrive in request order:** one socket, and the server handles a
  session's messages in turn. So among the sends for one field, the one
  with the highest `seq` that was accepted holds the server's value.

### G4. Mapping SOM nodes to three.js objects
- **By name**, as delete mode (`app.js` ~L1448–1476) and the inspector's
  drag (`sceneGroup.getObjectByName(node.name)`) already do.
- `DocumentView.listViews` / `getProperty` exist in both 4.3.0 (browser,
  via esm.sh) and 4.4.0 (local tests), but **only cover values returned by
  `view()`** (`findValues` reads `_outputValues`), i.e. the scene group, not
  the nodes inside it. Don't use them for this.
- **`NodeSubject.update()`** copies name, translation, rotation and scale
  from the glTF node to the three object **only when they differ**
  (view 4.4.0 `dist/index.js` ~L1133–1138). So a `TransformControls`
  attached to the DocumentView object, whose changes are copied straight
  into the SOM node, shouldn't fight DocumentView. **The prototype confirms
  this;** it hasn't been run yet.
- **Rename timing (Rev 1, from the code):** the update is synchronous.
  `setName` → `property-graph` `set()` dispatches `change` at once
  (`property-graph` 4.0.0 `dist/index.mjs` ~L400–405) → the view's
  `onChange` calls `update()` at once (view 4.3.0 `view.modern.js`
  ~L367–372, 4.4.0 ~L335–339). `SOMDocument.renameNode` returns, and
  `som:rename` is emitted, only after that. **So inside a `som:rename`
  listener the three object already has its new name.** B3 still re-looks it
  up there, and §8 checks it.

### G5. three r163 `TransformControls` (checked in the 0.163.0 package)
- `class TransformControls extends Object3D`, `constructor(camera,
  domElement)`. **The control itself is added to the scene** (no
  `getHelper()` until r169).
- `camera` is a plain property: it must be reassigned when the app switches
  cameras (Space cycles world cameras, `app.js` ~L1633).
- Events: `dragging-changed`, `objectChange`, `mouseDown`, `mouseUp`.
- `setMode`, `setSpace`, `setTranslationSnap`, `setRotationSnap`,
  `setScaleSnap`.
- It listens for `pointerdown` on the canvas and sets `dragging` there,
  **before** the browser fires `mousedown`.
- `three/addons/` is already mapped in `apps/client/index.html` (~L410).

### G6. Things in `app.js` that Edit mode must work around
- **Look-drag:** `viewportEl` `mousedown` sets `dragging = true`
  unconditionally (~L1591); `mousemove` then turns the camera (~L1597).
  A handle drag would also turn the camera.
- **A click fires after a look-drag too.** Placement and delete modes act
  on any `click` (~L1263, ~L1448). For selection that would reselect after
  every look-around.
- **Pointer lock:** the M key toggles `usePointerLock` (~L1609), and every
  viewport click requests the lock while it's on (~L1587). With the pointer
  locked, every click lands at the centre of the view.
- **Teleport triggers are switched on and off by several handlers (Rev 1):**
  `setActive(false)` when entering place or delete mode (~L1254, ~L1439);
  `setActive(true)` unconditionally in `exitTeleporterMode()` (~L1216) and
  `resetTeleporterUi()` (~L1112). Entering Edit mode and then exiting a
  teleporter mode would switch triggers back on mid-edit.
- **Keys:** `nav` gets keys only when the canvas has focus (~L1605), so
  typing in a panel field doesn't walk. **But the Escape handler is on
  `document`** (~L1232), so Escape in a text field would reach it.
- **`sceneGroup` is replaced on every `world:loaded`** (~L608). Anything
  attached to it goes with it.
- **The capability gate** is `client.canPlaceTeleporters` in three places
  (~L1192, ~L1251, ~L1436).

### G7. Avatars on the client
- `AvatarController.getPeerNode(name)` (~L44) returns a peer's avatar node.
  Peers enter that map from `peer:join` (the server's `join.avatar.nodeName`)
  and, for avatars already in the `som-dump`, from a scan of nodes carrying
  `extras.displayName` (~L119–127). That flag is client-supplied, so a world
  node with a `displayName` would also be treated as a peer: over-exclusion,
  the safe direction.
- The local avatar is `avatar.localNode`, with a child camera node
  `__local_camera-child`.
- **The server is the authority:** since 0c and 1a it refuses every edit to
  a live avatar. Client-side exclusion is for the UI only.

### G8. Externally loaded nodes
No list on the client. A node is external when it, or an ancestor, carries
`extras.atrium.source` (pre-brief F11). The server refuses edits to them
(A4). Since step 0 only operator file worlds have them.

### G9. `visible` is stored but never rendered
- `SOMNode.visible` lives in `extras.__atrium_visible` (`SOMNode.js`
  ~L76–84), and the server allows sending it (`send-policy.js` ~L356).
- **Nothing in `renderer-three`, `packages/client` or `apps/client` reads
  it** (grep for `__atrium_visible` and `visible` finds only the setter, the
  inspector's checkbox and `app.js`'s V key).
- **So a "visible" checkbox would save a value nobody sees.** The V key's
  `avatar.localNode.visible = false` (~L1623) is a no-op too; it's unnoticed
  because the first-person camera sits above the capsule.
- See E3.

### G10. Transform values the server accepts
- `send-policy.js` ~L357–358: rotation must be 4 finite numbers, the others
  3. **Zero or negative scale and non-unit quaternions are accepted.**
- The client must keep scale positive and quaternions normalized itself.
  (A server-side check could join the cleanup round, §10.)

### G11. Saves
`packages/server/src/autosave.js` debounces saves 30 s after the last
mutation (~L15), and flushes when a world host closes. Throttled drag sends
are cheap for the server. **DEV checks of persistence must wait ~35 s, or
close every window, before reloading.**

### G12. Test baseline at `dec8cc4`
Node 22.22.0, clean install:

| Suite | Command | Count |
|---|---|---|
| `apps/client` | `cd apps/client && node --test tests/*.test.js` | **200** |
| `packages/client` | `cd packages/client && node --test --test-force-exit tests/*.test.js` | 169 |
| renderer-three | `cd packages/renderer-three && node --test tests/*.test.js` | 64 |
| interaction | `cd packages/interaction && node --test tests/*.test.js` | 9 |

All `fail 0`, `skipped 0`. Only `apps/client` should change.

`apps/client` tests can't import three.js or touch the DOM (`pad-labels`
used a stand-in overlay for that reason). **Logic that needs tests goes in
small pure modules** under `apps/client/src/`, as `teleport-trigger.js` and
`pad-labels.js` do; `app.js` wires them.

### G13. Teleporter zones use local positions (Rev 1, pre-existing)
- `derivePads()` takes each pad's position from `node.translation`
  (`app.js` ~L395): the local translation, not the world position.
- The `som:set` handler rebuilds pads only when the changed node is itself
  a teleporter (~L751).
- **So a pad inside a group** keeps its trigger zone and label where the
  group was, if the group moves, on every client. Rebuilding alone wouldn't
  fix it.
- **Reachable today only through a crafted `add` with a `parent`** or a file
  world that nests pads; the app places pads at the root. Edit mode makes it
  reachable by moving any group that holds one.

## 3. Why split 1b

- **1b-1 edits what exists:** it is the hard part (handles, throttling,
  refusal handling, F14) and has no new content.
- **1b-2 adds and removes:** primitives, delete, duplicate. It makes delete
  a one-click action, so it should follow the server cleanup round that
  prunes deleted meshes and materials from saved worlds (edit-plumbing
  passdown §3.8).
- Each round stays small enough for a readable review and a focused DEV
  acceptance.

## 4. Decisions (operator, 2026-10-13)

All seven were approved as recommended in Rev 1.

- **E1 — How 1b-1 runs. Recommended: the prototype lane.** Claude builds
  and tests it in a cloud session and pushes `claude/edit-mode-ui-1`; a GLM
  review card (tint passdown §7.2); **an outside review by a separate Claude
  session** given only the SHA and this pre-brief (the author's own checks
  don't count as outside review; edit-plumbing §3.3 is why it matters). The
  outside review is mandatory, not optional. Then operator DEV acceptance.
  Why not the full pipeline: the work is UI that only eyes can accept, the
  open question (G4) is answered by a prototype in its first hour, and the
  GLM brief step added little last round (edit-plumbing §3.2).
- **E2 — 1b-1 scope: as §1.** Delete, duplicate and the primitives
  palette move to 1b-2; undo stays step 2.
- **E3 — `visible` (G9). Recommended: leave it out of the panel** in
  1b-1. Rendering it means a renderer hook DocumentView doesn't have, and
  deciding whether hidden nodes stay selectable. Log it as its own item. The
  alternative is to add rendering support here, which brings in
  `renderer-three`.
- **E4 — Avatar exclusion. Recommended: in `apps/client`,** using
  `avatar.localNode` (and its subtree) and `avatar.getPeerNode(name)`, with
  the server as the authority (G7). The alternative is a public
  `client.isLiveAvatar(name)` built from the server's `join` data, which
  touches `packages/client`.
- **E5 — Snapping. Recommended:** off by default; toggles for a 0.25 m grid,
  15° rotation steps and 0.1 scale steps.
- **E6 — Edit mode changes the session. Recommended:**
  - **teleport triggers:** active only when no editing mode is on (B1's
    rule), whatever order the modes are entered and left in;
  - the teleporter place and delete modes exit, and their buttons are
    disabled, while Edit mode is on;
  - **pointer lock:** entering Edit mode exits any lock and saves the M
    preference; M is ignored and no click requests the lock while Edit mode
    is on; leaving Edit mode restores the saved preference.
- **E7 — The client name-setter identity check** (edit-plumbing §3.8).
  It lives in `SOMNode`'s `name` setter (`SOMNode.js` ~L28 calls
  `renameNode(this.name, v)` without a target), which is `packages/som`,
  shared with the server. **Recommended: fix it in the server cleanup
  round**, so 1b-1 stays client-only. **Until then (Rev 1):** the panel's
  name field is disabled for a node whose name another node also has (a
  legacy world can contain duplicates; new names can't), with the reason as
  its tooltip. That keeps 1b-1 off the path where the wrong object could be
  renamed.

## 5. The 1b-1 contract

### B1. The Edit toggle, and one rule for teleport triggers
- A button in the bar with the teleporter controls. **Shown and enabled
  only when** `client.canEdit && avatarReady && client.connected`.
- `updateTeleporterControls()` and the place/delete handlers read
  `client.canEdit` (G6). `canPlaceTeleporters` stays on the wire for its one
  release; nothing in `apps/client` reads it after this round.
- **Teleport trigger activity is derived, not set (Rev 1).** One function
  computes it from the modes:
  `active = !editMode && !placementMode && !deleteMode`, and every place
  that changes one of those modes calls it. The direct `trigger.setActive(…)`
  calls in the place/delete handlers, `exitTeleporterMode()` and
  `resetTeleporterUi()` (G6) are replaced by that call. The mode flags and
  the derived value live in a pure module (e.g.
  `apps/client/src/edit-modes.js`) so the sequences can be tested.
  `setReady` (the avatar-ready gate) is unchanged and separate.
- **On:** E6; a hint line ("Click to select · Alt-click selects a part ·
  Esc to deselect").
- **Off:** ends any gesture (B4), clears the selection, detaches the
  handles, restores E6.
- **Edit mode turns itself off** on `connecting`, `disconnected`,
  `world:loaded`, and whenever the gate in the first bullet becomes false.

### B2. Selection
- **A click selects only if the pointer moved less than ~4 px since
  `mousedown`, and no handle gesture is under way or just ended** (G6). Other
  clicks are look-drags.
- **Hit test:** the same raycast and name walk as delete mode, against
  `sceneGroup` only (the handles live outside it, B3).
- **Excluded** (the click selects nothing):
  - the hit node or any ancestor is `avatar.localNode`, or a peer avatar
    (`avatar.getPeerNode(name)`), per E4.
  - *Built differently (§12.1):* the local avatar is see-through instead;
    the click selects what is behind it.
- **External nodes:** if the hit node or an ancestor carries
  `extras.atrium.source`, select the outermost such ancestor (G8).
- **Otherwise** `resolveSelectionRoot(hit, { descend: altKey })` from
  `@atrium/interaction`.
- **Click on empty space** deselects. **Escape** deselects; a second Escape
  turns Edit mode off. The teleporter Escape handling (~L1232) keeps its
  priority when a teleporter form or the failure panel is open. **Escape
  inside a panel field** is B5's, not this one's.
- **Outline:** a `BoxHelper` on the selected object, updated each frame,
  added to the three scene (not `sceneGroup`).
- **The selection is held as the `SOMNode` object,** not its name, so a
  rename keeps it.
- **When the selected node goes away (Rev 1):** after any `som:remove`, and
  after a reconnect, check `client.som.getNodeByName(selected.name) ===
  selected`. If not, the node (or an ancestor) was removed: cancel its
  gesture (B4), detach the handles, clear the selection, and show "This
  object was removed."

### B3. Handles
- `TransformControls` from `three/addons/controls/TransformControls.js`,
  r163 API (G5), **added to the three scene, not `sceneGroup`** (G6).
- **Attached to** `sceneGroup.getObjectByName(selected.name)`; looked up
  again inside the `som:rename` listener (the object is already renamed
  there, G4) and after any world reload.
- **On-screen mode buttons:** Move, Rotate, Scale (no W/E/R, F17). A
  local/world space toggle for Move and Rotate (default world).
- **Snap toggles** per E5.
- **Camera:** `controls.camera` follows `stage.camera` whenever it changes.
- **No camera turn while dragging:** the `mousedown` look-drag (~L1591)
  ignores a press that started a handle drag (`controls.dragging` is already
  true), and `mousemove` skips `nav.onMouseMove` while `controls.dragging`.
- **Selection is frozen during a drag:** the click that ends a gesture
  doesn't select (B2).
- **Scale stays positive:** each axis is clamped to at least 0.01 before
  it's written (G10).
- **Prototype check (G4):** attaching to the DocumentView object and
  copying its TRS into the SOM node renders without jitter or snap-back. If
  it doesn't, attach to a proxy `Object3D` placed at the node's world
  transform and convert with `computeParentInverse` (as the inspector does).
  The handoff says which was used and why.

### B4. Gestures, confirmation and revert
In a pure module (e.g. `apps/client/src/edit-gesture.js`) with an injected
clock and SOM-write functions, so it can be tested without three.js.

**Gestures and sends:**
- **A gesture** is one handle drag, or one committed panel field (B5).
- **During a drag,** on every `objectChange`: copy the object's local
  translation, rotation (normalized) and scale into the SOM node **inside
  `client.applyLocally`** (renders; nothing sent).
- **Sends:** at most one every 100 ms per gesture, by writing the current
  value of each changed field **outside** `applyLocally` (G2); and one final
  send on release for each field whose value differs from the last one sent.
  After each write, record `client.lastSendSeq`.

**Confirmation and revert (Rev 1: one record per node and field, across
gestures):**
- **The record** is keyed by the node **object** (not its name) and the
  field. It holds: the **confirmed value** (the field's value when the
  record was created, then the value of the highest-`seq` accepted send);
  the set of **pending** `seq`s; a **rejected** flag; and whether a gesture
  on this field is **active**.
- **Every send of every gesture** on that node and field adds to the same
  record. A gesture never reverts on its own.
- **`edit:accepted`:** if its `seq` is higher than the last accepted `seq`
  for the record, the confirmed value becomes the sent value. Remove it from
  pending.
- **`edit:rejected`:** set the flag, remove it from pending, show the
  server's message (B6).
- **Reconcile** when the record has nothing pending **and** no active
  gesture: if the flag is set, write the confirmed value to the node inside
  `applyLocally`, then clear the flag. Answers arrive in request order (G3),
  so the confirmed value is the server's value; a late rejection from an
  older gesture can't overwrite a newer accepted edit, and nothing is
  written while a newer gesture is still under way.
- **`edit:unknown`:** remove it from pending without changing the confirmed
  value. On a reconnect, drop every record: the fresh `som-dump` is the
  truth.
- **Drop a record** once it has reconciled with nothing pending.

**When the node goes away (Rev 1, B2):**
- cancel the active gesture: no more local writes, no further sends, no
  final send;
- mark the node's records **dead**. Sends already in flight still resolve
  (so the pending sets empty), but a dead record **never writes to the
  node**: there is nothing to restore on the server, and the local object is
  detached;
- a rejection on a dead record (typically `NODE_NOT_FOUND`) shows "This
  object was removed." instead of the server's text.

**Other ends:** a selection change, or Edit mode turning off, mid-drag ends
the gesture with its final send.

### B5. Property panel
- **Fields:** position (x, y, z), rotation (x, y, z degrees, Euler XYZ),
  scale (x, y, z), name. No `visible` (E3).
- **Rotation conversion** quaternion ↔ degrees in a pure module (e.g.
  `apps/client/src/rotation-degrees.js`), normalizing on the way out.
- **Commit on Enter or blur,** not per keystroke. One commit is one gesture
  (B4). Non-numeric input restores the field and sends nothing; scale
  clamps per B3.
- **Keys in fields (Rev 1):** typing never reaches navigation (the canvas
  has no focus, G6). **Escape in a field restores its last displayed value,
  blurs it and sends nothing; it does not deselect.** Only an Escape with no
  field focused reaches B2.
- **Live values:** the panel follows the selected node during a drag, after
  a revert, and on `som:set` for that node from another client. A field
  being typed in isn't overwritten until it loses focus.
- **Name:**
  - check with `client.som.checkNewName(value, selected)` first; on failure
    show its message and send nothing;
  - otherwise `client.renameNode(selected.name, value)`; the field shows
    "Renaming…" until `edit:accepted` (the panel updates from `som:rename`)
    or `edit:rejected` (show the message, restore the old name);
  - **disabled** for a node with a camera or light (`selected.camera` /
    `selected.light`) (D4), and for a node whose name another node also has
    (E7), each with the reason as its tooltip.

### B6. Messages
- Refusals show in the panel's error line: "Couldn't save: <server
  message>", or B4's removal message. The line clears on the next accepted
  edit or selection change.
- The overlay isn't used for Edit mode, so teleporter messages keep it.

### B7. Teleporters: world positions and rebuilds (F14, G13)
- **Pad positions are world positions (Rev 1).** `derivePads()` uses a pure
  helper (e.g. `apps/client/src/world-position.js`) that composes
  translation, rotation and scale up the SOM parent chain. Labels take the
  same position. A root-level pad gives exactly its translation, so nothing
  changes for today's pads.
- **Rebuild pads** (`rebuildPads()`) after:
  - **the editor's own accepted transform edit** (`edit:accepted` with a
    `translation`, `rotation` or `scale` field) **on a node that is a
    teleporter or has one among its descendants**, resolving the node from
    the B4 record (by object), not the name sent;
  - **a remote `som:set`** of one of those fields on such a node (the
    existing handler, ~L751, widened from "is a teleporter");
  - a rename (already done by `som:rename`, A10).
- Destinations are still edited only through the teleporter form.

### B8. What does not change
- No edits to the document (World Info), cameras, lights or animations.
- The teleporter form, place and delete modes behave as today when Edit mode
  is off.
- Visitors (`canEdit` false) see no new UI.

## 6. Out of scope (1b-1)

- Add palette, delete, duplicate (1b-2). Undo and redo (step 2).
- Rendering `visible` (E3).
- Multi-select; editing a node's parent; snapping to other objects.
- Two editors in one world, or the owner's two tabs fighting over a node.
  (One tab's own overlapping gestures *are* in scope: B4.)
- Server-side scale and quaternion checks (G10; candidate for the cleanup
  round).

## 7. Tests

**Pure modules, real logic, no mocks of the module under test.** The `app.js`
wiring is DOM code and is accepted on DEV (§8).

### 7.1 New
- **Gestures (`edit-gesture`):**
  - a drag of 1 s at 60 `objectChange`s/s produces ~10 sends plus one
    final send, all through the non-local path; local writes happen every
    change;
  - no final send when the value equals the last one sent;
  - all accepted → no revert;
  - **the last send rejected after earlier ones were accepted → reverts to
    the latest accepted value, not the start value;**
  - all rejected → reverts to the start value;
  - `edit:unknown` → no revert;
  - two fields in one gesture resolve independently;
  - a node renamed mid-gesture is still matched (identity, not name);
  - a panel commit is a one-send gesture with the same rules;
  - scale is clamped to 0.01; quaternions are normalized;
  - **(Rev 1) overlapping gestures:** a drag to X=5 whose final send is
    still pending, then a panel commit of X=10; X=10 accepted, then the
    drag's send rejected → the node ends at X=10, with no write in between;
  - **(Rev 1) no revert during a newer gesture:** a rejection for an older
    send arrives while a new drag on the same field is under way → nothing
    is written until that drag ends and its sends resolve;
  - **(Rev 1) node removed mid-drag:** after the cancel, further
    `objectChange`s write nothing and send nothing, there's no final send,
    and a later `NODE_NOT_FOUND` rejection writes nothing and yields the
    "removed" message.
- **Modes (`edit-modes`, Rev 1):**
  - entering Edit mode from plain navigation → triggers inactive;
  - entering Edit mode while place mode is open, then that mode exiting
    (the `exitTeleporterMode` path) → still inactive;
  - the `resetTeleporterUi` path while Edit mode is on → still inactive;
  - leaving Edit mode with no other mode → active;
  - disconnect while editing → every mode off, triggers active again
    (subject to `setReady`, which the connection lifecycle already handles);
  - pointer lock: entering Edit mode with the lock preference on → lock off;
    M during Edit mode → no change; leaving → the preference is restored.
- **Selection (`edit-selection`, with plain stand-in nodes):**
  - own avatar, its camera child and a peer avatar select nothing;
  - a part under an external container selects the outermost container;
  - default policy picks the nearest mesh-less ancestor; Alt returns the
    hit node;
  - a click that moved ≥4 px, or that ended a handle gesture, selects
    nothing.
- **World position (`world-position`, Rev 1):** a root node → its
  translation; a child of a translated, rotated and scaled parent → the
  composed position, checked against hand-computed values; three levels.
- **Rotation (`rotation-degrees`):** round trips at known angles, ±90°
  pitch, negative angles, normalization of a non-unit input.
- **`import-guard.test.js`** picks up the new imports automatically.

### 7.2 Expected count
`cd apps/client && node --test tests/*.test.js` → **200 + the new tests**
(the handoff gives the exact number with the command). Every other suite
unchanged (G12).

### 7.3 Proofs of failure
Each must fail the named tests and exit nonzero; restore afterwards.

| Proof | Break | Must fail |
|---|---|---|
| (a) | Revert to the start value instead of the latest accepted | the "last rejected after earlier accepted" test |
| (b) | Send on every `objectChange` (no throttle) | the ~10 sends per second test |
| (c) | Drop the peer-avatar exclusion | the peer-avatar selection test |
| (d) | Match pending sends by name instead of node identity | the rename-mid-gesture test |
| (e) | Keep a record per gesture instead of per node and field | the overlapping-gestures test |
| (f) | `exitTeleporterMode` sets triggers active directly again | the "place mode exits during Edit mode" test |
| (g) | The world-position helper returns `node.translation` | the child-of-a-transformed-parent test |

### 7.4 End to end (Claude, throwaway script, not committed)
A real server and two real `AtriumClient`s, driving `edit-gesture` against
client A's SOM:
- B sees the throttled moves and the final value;
- **(Rev 1) node removed mid-drag:** B removes the node while A drags it. A
  loses the selection, stops sending, and nothing is written to the
  disposed node; both clients end without the node.
- **A refusal on a node that still exists:** drive the module's send path
  with a non-finite value, injected below its clamp and normalization (JSON
  sends `NaN` as `null`, which the server refuses). A reverts to the
  server's value; B sees no change.

## 8. DEV acceptance (operator)

**No PROD baseline:** Edit mode doesn't exist there. The F14 and G13
symptoms can't be shown on PROD either, since no PROD client moves a pad or
a group.

**Setup:** an owned world on `https://dev.ewwb.dev` with at least two
teleporter pads and some world content; a second window as a visitor
(another account, or `hermes-devcheck`). **For step 6,** a group with a
pad inside it: the handoff supplies the console snippet that creates one
(an `add` of a mesh-less group, then a pad `add` with `parent`).

1. **Gate:** the owner sees Edit; the visitor and a logged-out window
   don't.
2. **Select:** click a world node → outline. Alt-click a part of a group →
   the part. Click the visitor's avatar → nothing. Click your own avatar →
   whatever is behind it (or nothing), never the avatar (§12.1). Look
   around with a drag → selection unchanged.
3. **Handles:** move, rotate and scale a node. The camera doesn't turn
   during a handle drag. The visitor sees the node move smoothly enough
   and land exactly where the owner left it.
4. **Panel:** type a position and a rotation; both windows agree. Type
   "wasd" into a field → the avatar doesn't walk. Escape in a field → the
   field restores and the selection stays. Rename a node, **then move it
   at once without reselecting** → the handles stay on it. Rename another
   onto the same name → a message, name unchanged.
5. **F14:** move a pad, turn Edit off, walk onto its new spot → teleports;
   its old spot → nothing. Label count still equals pad count
   (edit-plumbing §7.6).
6. **G13:** move the group that holds a pad. Turn Edit off; the pad's
   label is over the pad; walking onto the pad teleports, its old spot
   doesn't. **In the visitor's window too.**
7. **Mode coordination:** open the teleporter place mode, then turn Edit
   on (place mode closes); walk over a pad → nothing fires. Press M →
   no pointer lock. Turn Edit off → pads fire again, and M works as
   before.
8. **Removal mid-edit:** select a pad in the owner's window, then delete it
   from a second owner tab with the teleporter delete mode (the only delete
   the UI has before 1b-2). The first window's selection and handles clear
   with "This object was removed."; no console errors beyond that.
9. **Persistence:** wait ~35 s (or close both windows), reload → the
   edits are there.
10. **Regression:** place and delete a teleporter; teleport and come back;
    peers see each other move; M and V keys; Space camera cycling with a
    node selected (handles follow the camera).
11. **Console:** no errors beyond the deliberate refusals.

## 9. Before the round

- Edit-plumbing §7.7 check (worker-card requirements say nothing about
  tools).
- **Upload this pre-brief before the base fetch.** No GitHub web edits to
  `main` from then until PROD (teleport-rearm §3.1).
- Claude needs push access in its session (`add_repo` with
  `access: "push"`); the branch is `claude/edit-mode-ui-1`.
- The GLM card follows tint §7.2 and needs the host fetch first
  (teleport-rearm §3.4). Give every count next to its command.

## 10. Where this sits

1. **1b-1** (this file).
2. **Server cleanup round:** prune deleted meshes, materials and accessors
   on remove or save; the non-string teleporter destination on `add`; fix
   `external-refs.test.js` and bring it into the suite; the `SOMNode` name
   setter identity check (E7), with a test that renames in a world holding
   duplicate legacy names; optionally positive scale and unit quaternions
   (G10).
3. **1b-2:** add palette (primitives with A5-valid generated names), delete
   with confirmation and the "includes N children" warning, duplicate per
   D5.
4. **Step 2:** undo and redo, built on B4's gesture records (one gesture,
   one entry; confirmed edits only).

## 11. Review log

### 11.1 Outside review of Rev 0 (ChatGPT, 2026-10-13)
Verdict: keep the direction and the split; revise before approving E1–E7.
Each finding was checked against `dec8cc4`.

| # | Finding | Check | Disposition |
|---|---|---|---|
| 1 | `exitTeleporterMode()` and `resetTeleporterUi()` re-enable triggers unconditionally, so E6 in the order written would leave triggers on while editing | Confirmed: `setActive(true)` at ~L1216 and ~L1112 | New G6 bullet; B1 derives trigger activity from the modes in one function; `edit-modes` tests; proof (f) |
| 2 | Two gestures on one field can overlap; a late rejection from the first could overwrite a newer accepted edit | Confirmed against Rev 0's wording, which kept state per gesture | B4 rewritten: one record per node and field across gestures, highest accepted `seq` wins, reconcile only when nothing is pending and no gesture is active (G3: answers arrive in order). Two tests; proof (e) |
| 3 | A node removed mid-drag: the gesture must stop, and a revert must not touch the disposed object | Accepted. Rev 0 cleared the selection but didn't stop the gesture, and §7.4 relied on a revert to a removed node | B2 and B4: cancel the gesture, dead records never write, a "removed" message. §7.4 rewritten; test and DEV step 8 |
| 4 | Teleporter zones use local `translation`; moving a parent leaves them behind | Confirmed: `derivePads()` ~L395; `som:set` rebuilds only for teleporters ~L751. Pre-existing (G13) | B7: world positions through a pure helper; rebuild when a teleporter or an ancestor of one moves, own or remote. Test, proof (g), DEV step 6 |
| 5 | M can re-enable pointer lock during Edit mode; Escape in a text field would deselect | Confirmed: M ~L1609, click lock ~L1587, Escape handler on `document` ~L1232. Typing doesn't reach `nav` (canvas-only keydown, ~L1605) | E6 and B5: M ignored and the preference saved and restored; Escape in a field restores and blurs. Tests and DEV steps 4, 7 |
| 6 | The three object might not be renamed yet inside a `som:rename` listener | Checked in the libraries: the rename reaches the three object synchronously, before `som:rename` (G4). The review says the prototype confirmed the lookup; no prototype has run yet, Rev 0 said the prototype *would* confirm it | G4 records the timing; B3 re-looks up in the listener; DEV step 4 (rename, then move at once) |
| — | E7: test renaming in worlds with legacy duplicate names | Accepted | E7: rename disabled in the panel for a duplicated name until the cleanup round's fix, which carries the duplicate-name test (§10) |

## 12. Implementation notes (prototype, 2026-10-13)

What the build does differently from Rev 2, or adds, and why.

### 12.1 The local avatar is see-through (B2)
In third person the avatar sits in the middle of the view, so "selects
nothing" blocked a large part of the scene (found in the headless browser
run). Clicks pass through the local avatar to the next hit. Peer avatars in
front still select nothing, and the local avatar itself can never be
selected. The outside review accepted this.

### 12.2 Outside review of the prototype (`ccad2704`, 2026-10-13)
Fixed in the next commit:

| # | Finding | Fix |
|---|---|---|
| 1 | The E7 duplicate-name guard could never fire: `som.nodes` comes from a name-keyed map | Names are counted in the glTF node list (`isDuplicatedName`) |
| 2 | Name lookups could reach a mesh `Group` named like another node, or the wrong one of two duplicates, so handles could drive a different object | Lookups consider only DocumentView node objects (`Object3D`/`Bone`), both for clicks and for attaching handles; a node whose name is duplicated can't be selected yet (message shown) |
| 3 | `nodeRemoved` (and `reset`) cancelled gestures before marking records dead, so a rejected drag could write to a removed node | Records are marked dead first; two tests |
| 4 | Turning Edit off while standing on an armed pad teleported at once (`wasInside` was stale) | `trigger.setActive(true)` after inactivity disarms every pad, as on a fresh load; a pad fires only after the avatar has been outside it |
| 5 | A press or wheel over the Edit panel turned or zoomed the camera | Look-drag and wheel act only on the canvas |
| 6 | Entering Edit mode could abandon a pending teleporter save | The Edit button is disabled while a teleporter save or delete is unanswered |
| nit | A Move drag sent a stray rotation when the stored quaternion was unit only to rounding | Quaternions within 1e-9 of unit length aren't renormalized |
| nit | A panel commit re-sent the other axes rounded to the display | Only the axes whose text changed are replaced, from full-precision values |
| nit | Escape typed in the sign-in or world-browser fields affected Edit mode | The Edit-mode Escape ignores keys typed in text fields |
| nit | A move sent before a rename's answer used the old name and was refused | Handles and transform fields are held while a rename of the selected node is unanswered |

Not changed: delete mode's own name walk (pre-existing; it only deletes
teleporters) is left as it was.

