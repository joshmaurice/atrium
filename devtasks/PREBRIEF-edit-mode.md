# Pre-brief: Edit mode (Phase 3 step 1)

Status: **FINAL, Revision 2 (2026-10-13).**
- **Rev 0** was drafted by Claude from a clone of `main` at `aa55b87`
  (runtime code identical to the released `9312e5ee`).
- **Every "today the code does X" claim in §2 was checked against that
  clone.** The ones marked *probe* were also run against the real server and
  SOM with throwaway scripts (not committed).
- **Rev 1:** the operator approved decisions D1–D8 (§4) as recommended, on
  2026-10-13. No other changes.
- **Rev 2:** applies an outside review of Rev 1 (ChatGPT, 2026-10-13),
  each finding checked against `aa55b87`. §11 lists them. Decisions D1–D8
  are unchanged; the contract changes are in A3, A4, A6, A7, A8, a new
  A10, §8 and §9.
- **This round implements 1a only** (§3, §5). 1b gets its own pre-brief
  after 1a ships.

**Inputs:**
- `docs/DESIGN-phase3-placement-scripting.md` §4.1, §4.2, §4.6, §4.7, §4.8,
  §9 (step 1), §10 Q3 and Q7, §11.2;
- `devtasks/PREBRIEF-send-field-allowlist.md` (the step 0c contract this
  step grows);
- `devtasks/Atrium-Passdown-2026-10-12-send-field-allowlist.md` §3–§4 (its
  lessons: grep every test that exercises a changed handler; check every
  "no client does X" claim, including peer paths; DEV checks must use tools
  DEV serves);
- `devtasks/Atrium-Passdown-2026-10-13-teleport-rearm.md` (the newest).

This is input for the brief-writing step. It is not the brief itself.

**Code facts:**
- **Line numbers:** approximate.
- **Implementation base:** a freshly fetched `origin/main` at kickoff,
  supplied from the host.

## 1. What step 1 is

From design §9, row 1:
- **Edit mode** in `apps/client`: select, move/rotate/scale handles, a
  property panel, delete, duplicate;
- **a primitives palette** (cube, plane, sphere, cylinder, ramp);
- **edit confirmation and refused-edit feedback** (`requestSeq`, §4.6);
- **atomic rename** (§4.8);
- **`hello.canEdit`** (§4.7);
- **avatars and externally loaded nodes excluded** from editing.

Server and protocol: `hello.canEdit`; `requestSeq` and `session` on the
`set`/`add`/`remove` broadcasts; rename uniqueness; refuse owner edits to
other visitors' avatars.

**That's two different kinds of work.** About half is server, protocol, SOM
and client-library plumbing that can be tested headless with real servers.
The other half is browser UI that only a person can accept. §3 proposes
splitting them (D1).

## 2. What the code does today (verified at `aa55b87`)

### F1. The client numbers its messages with two separate counters
- `send` uses `++this._sendSeq` (`AtriumClient._onLocalMutation` ~L1001).
- `add`, `remove` and `view` share `++this._viewSeq` (`addNode` ~L750,
  `removeNode` ~L767, `setView`).
- **So two outstanding requests can carry the same `seq`.** An `error`
  echoes only `seq`, so the client can't tell which request it refers to.
- **This already matters:** `app.js` ~L1383 closes the teleporter form on
  any `error` whose `seq` equals the pending add's. A refused `send` with the
  same number would be shown as a teleporter failure. Edit mode will send a
  lot more, so the collision becomes likely.
- `_onLocalMutation` doesn't return or expose the `seq` it used.

### F2. Success broadcasts can't be matched to requests (design §3.7, confirmed)
- `set` (`session.js` ~L613): fresh server `seq`, carries `session`, no
  request `seq`.
- `add` (~L703) and `remove` (~L764): fresh server `seq`, **no** `session`,
  no request `seq`.
- **Schemas** (`packages/protocol/src/schemas/`): `set.json` is server-only.
  `add.json` and `remove.json` are **one schema for both directions**
  (validator keys `add`, `remove`), all with `additionalProperties: false`.
  Adding `requestSeq` there would also let clients send it.
- **The disconnect broadcast `{type:'remove', seq, id}`** (`session.js`
  ~L299) doesn't match `remove.json` (it requires `node` and forbids `id`).
  The server never validates its outbound `remove`, so nothing notices
  today.

### F3. A mutator can `remove` another visitor's live avatar (*probe*)
- `case 'remove'` (~L749) runs only the mutation gate, then
  `world.removeNode(msg.node)`.
- **Probe:** open world, two clients. A sent `remove avatar-bbbbbbbb`; the
  node was disposed and the `remove` broadcast went to everyone.
- In an owner world the owner can do the same. Step 0c covered `send` only.

### F4. `add` accepts a live avatar as the parent (*probe*)
- **Probe:** B added `{name:'hat'}` with `parent: 'avatar-aaaaaaaa'`;
  accepted and broadcast.
- When A leaves, the avatar is disposed and `hat` is orphaned (F5).
- **Avatar adds can carry a `parent` too** (Rev 2, from the code): an
  avatar `add` skips the mutation gate (`isMutator(session, true)`), and
  `world.addNode(msg.node, msg.parent)` honours the parent. So any visitor
  can attach their own avatar under a world node.

### F5. Removing a node with children orphans the children (*probe*)
- `SOMNode.dispose()` (~L145) disposes only the glTF node. glTF-Transform
  detaches the children but doesn't dispose them.
- **Probe:** add `P`, add `C` under `P`, remove `P`. Afterwards:
  - `C` still resolves by name, with no parent;
  - `C` is written to the serialized document, outside the scene — so it
    **is saved, invisibly, forever**;
  - adding a new `C` fails with "name already exists".
- The client's `_onRemove` (~L803) disposes the same way, so clients orphan
  the same nodes.
- Design §4.1 allows deleting a node with children (with a warning). As the
  code stands, that delete leaks.

### F6. Clients ignore `add.parent`
- `_onAdd` (~L778) always does `this._som.scene.addChild(node)`.
- So a node the server parented appears at the scene root on every client
  until they reload and get a `som-dump`.

### F7. The dispose callback can unregister a different object (*probe*)
- `world.addNode` (~L104) checks only `som.getNodeByName`, i.e. other
  **nodes**. `_registerObject` (SOMDocument ~L225) then logs a warning and
  leaves the existing object in `_objectsByName`.
- `_registerNodeDispose` (~L240) deletes `_objectsByName[name]`
  unconditionally, whatever is registered there.
- **Probe:** add a node named `__document__` (accepted), then remove it.
  `getObjectByName('__document__')` no longer returns the document, so every
  World Info edit gets `NODE_NOT_FOUND` until the world reloads.
- The same happens with a node named like an animation, or like a camera or
  light alias (`X.camera`).
- **Camera and light aliases** (`<host>.camera`, `<host>.light`,
  ~L140–198) are registered at load from the host node's name and are never
  unregistered when the host is disposed.

### F8. Rename (design §3.8, confirmed, plus three more places)
- **Confirmed (*probe*):** after `node.name = 'Renamed'` the old name still
  resolves and the new one doesn't.
- `send` with `field: 'name'` is refused today (step 0c D4), so this isn't
  reachable over the wire yet.
- **Not in the design doc:**
  1. **`_attachNodeListeners` (~L931) captures `nodeName` when it attaches.**
     After a rename, that client's edits to the node go out under the *old*
     name. Camera and light listeners (~L982) capture the alias the same
     way.
  2. **Camera and light aliases are built from the host's name at load**
     and stored in `_qualifiedName`. Renaming the host leaves the alias
     pointing at the old name.
  3. **App code keys things by name:** teleporter pads, labels, and the
     `som:set` handler (`app.js` ~L742), which re-resolves by the old name.

### F9. `setField` maps every error to `INVALID_FIELD` (design §4.8 and §11.2, confirmed)
`world.js` ~L93 (file worlds) and ~L250 (document worlds).

### F10. `add` can't carry most of what a world node can hold
`SOMDocument.ingestNode` (~L418) rebuilds only:
- `POSITION`, `NORMAL`, and `indices` — as a `Uint16Array`, so an index above
  65535 **wraps silently**;
- `baseColorFactor`, `metallicFactor`, `roughnessFactor`.

No UVs, textures, emissive, alpha mode, double-sided, vertex colours,
primitive mode, skins or children. **There's no SOM-node-to-descriptor
helper.** So duplicating an arbitrary world node through `add` would be
lossy. Geometry built with `threeGeometryToGltfPrimitive`
(`renderer-three/src/geometry-utils.js` ~L17), as teleporter pads are,
round-trips fine.

### F11. Externally loaded nodes
- **Server:** `world.externalNodeNames`, names `<container>/<child>`. Not
  saved; still writable by `send` and `remove` (open follow-up from 0c §6.1).
- **Client:** no list. Recognisable by an ancestor carrying
  `extras.atrium.source`.
- Since step 0, only operator file worlds have them.

### F12. The capability flag
- `canPlaceTeleporters` (`session.js` ~L434) = signed in **and** world owner
  **and** `isMutator`. An ownerless (`open`) world gives `false`, although
  every session there passes `isMutator`.
- `hello.server.json` has `additionalProperties: false`, so `canEdit` needs
  a schema change.
- Used by: `AtriumClient` ~L692, `app.js` ~L1162/1221/1406,
  `teleporter.test.js` (3 tests), `source-ref-guard.test.js` ~L384.

### F13. three.js and handles
- `three@0.163.0` through the esm.sh import map, with `three/addons/`
  mapped (`apps/client/index.html` ~L406).
- `TransformControls` ships in 0.163. Its API there is the older one: the
  control is itself an `Object3D` added to the scene (`getHelper()` arrived
  in r169).
- Nothing in the repo uses it yet. No `EffectComposer`, so an outline pass
  would mean adding post-processing; `BoxHelper` doesn't.

### F14. The owner's own edits produce no `som:set`
- `_onSet` (~L830) returns early on its own echo. App code that reacts to
  `som:set` (`rebuildPads` for teleporters, the background reload) doesn't
  run for the editor's own edits.
- Latent today, because no client moves a teleporter. In Edit mode, moving
  a pad would leave the owner's own trigger zones where they were.

### F15. SOM mutation events carry only the new value
So `AtriumClient` can't revert a refused edit on its own. The code that made
the edit has to remember the previous value.

### F16. Avatars on the client
- Each client marks **its own** avatar `extras.atrium.ephemeral: true`
  (~L349). That flag is client-supplied: any `add` could set it.
- Peers' avatar node names arrive in `join.avatar.nodeName`, from the
  server.

### F17. Keys and rate
- `NavigationController` uses `KeyW` and the arrow keys; `app.js` binds
  `KeyM`, `KeyV`, `Escape`. The usual `TransformControls` shortcuts
  (W/E/R) would clash with walking.
- No WebSocket rate limit on `send`. About 10 sends per second during a drag
  is fine for one editor.

## 3. Proposal: two rounds (D1)

### 1a — edit plumbing (full pipeline round)
Server, protocol, SOM and `AtriumClient`. No new UI: only the inspector's
error line (D6) and the minimum rename sync in both apps (A10). All of it
testable with real servers and real clients: §5 contract A1–A10.

### 1b — Edit mode UI
`apps/client` only, on top of 1a. Its own short pre-brief after 1a ships,
built from §6 below.

**Why split:**
- 1a is security-relevant (F3, F4, F7) and protocol-touching. It deserves
  the full pipeline and proofs, and it's useful on its own: the client API
  (and the protocol inspector) get rename, and errors match their requests.
- 1b is a lot of UI that unit tests can't accept. Keeping it apart keeps
  each review readable and each DEV acceptance focused.

## 4. Decisions (operator, 2026-10-13)

All eight were approved as recommended in Rev 0.

- **D1 — Split into 1a and 1b: yes** (§3). This round is 1a. How 1b runs
  (full pipeline, or a Claude-built prototype with a GLM review card and DEV
  acceptance) is decided after 1a ships.
- **D2 — Deleting a node with children: remove the whole subtree** on the
  server and every client (A6), since design §4.1 allows the delete.
- **D3 — Name rules for new names** (`add` and rename, A5): a non-empty
  string of at most 256 characters; not `__document__`; not ending in
  `.camera` or `.light`; no `/`; not already a name in `_objectsByName`.
  Existing names in saved worlds aren't touched.
- **D4 — Renaming a node that hosts a camera or light: refused** in step 1
  (`INVALID_VALUE`, "rename not supported for camera or light hosts").
  Moving the aliases can come later if needed.
- **D5 — Duplicate: only nodes whose content round-trips through `add`**
  (F10): no children, a mesh with only `POSITION`/`NORMAL`/indices under
  65 536 vertices, factor-only materials, no textures. In practice Edit-mode
  primitives and teleporters; the button is disabled otherwise. This is a
  1b rule; 1a needs no change for it.
- **D6 — Refused edits in the inspector: shown next to the field, not
  reverted** (F15). The inspector is a developer tool, and DEV doesn't serve
  it. This narrows design §4.6 ("applies to the inspector too") for step 1.
- **D7 — One client counter for every outgoing message,** `view` included.
  A validation error echoes `seq` for any message type.
- **D8 — The teleporter message fix is folded in:** a non-string
  destination gets its own message instead of "destination exceeds 2048
  characters", with one test per message. The code stays `INVALID_VALUE`.

## 5. The 1a contract

### A1. `hello.canEdit`
- Same computation as `canPlaceTeleporters` (F12). Owner-gated commons in
  `owned` mode gets it; the degraded read-only boot doesn't (design §10 Q7).
- `canPlaceTeleporters` stays as an alias with the same value for one
  release (design §4.7). Schema: add `canEdit` to `hello.server.json`.
- `AtriumClient` exposes `canEdit`. `apps/client` may keep reading
  `canPlaceTeleporters` until 1b.

### A2. `requestSeq` and `session` on success broadcasts
- Every `set`, `add` and `remove` broadcast that results from a client
  request carries `requestSeq` (the request's `seq`) and `session` (the
  requester's id). The server's own `seq` is unchanged.
- **Avatar adds** (`broadcastExcept`) and the **disconnect remove** carry
  neither: they don't answer a request the receiver made.
- **Schemas** (AGENTS rule 1: schema, validator and tests in one commit):
  - make `add` and `remove` direction-specific, as `hello` and `view` are:
    `add:client`/`add:server`, `remove:client`/`remove:server`;
  - `validate()` in `packages/protocol/src/index.js` maps only `hello` and
    `view` to directional keys today (~L54); `add` and `remove` join them.
    The only other callers are `session.js` (`'client'` for every inbound
    message; `'server'` for `join`, `leave`, `view`) and three `hello`
    checks in `http-integration.test.js`;
  - the client forms stay exactly as today — **a client may not send
    `requestSeq`**. The existing `validate('client', add/remove)` tests in
    `validate.test.js` keep passing;
  - `remove:server` covers both `{node, requestSeq, session}` and the
    disconnect form `{id}` (F2);
  - `set.json` gains `requestSeq`.
- **Test that every broadcast the server emits validates** against its
  server schema, including the disconnect `remove`.

### A3. Client edit tracking
- **One counter** for every outgoing message (D7).
- **Pending map** keyed by `seq`: `{type, node, field?, value?}` for `send`,
  `add` and `remove`. **It lives on the connection record**
  (`this._connectionRecord`), not on the client, so it belongs to one
  server session.
- **The avatar announcement is not tracked.** The server sends avatar adds
  to everyone *except* their sender, so it would never resolve.
- **Outcomes,** emitted as events:
  - `edit:accepted` — a broadcast with this client's `session` and a
    matching `requestSeq`;
  - `edit:rejected` — an `error` with a matching `seq`, carrying `code` and
    `message`;
  - `edit:unknown` — the connection ended with the edit still pending.
- **When a connection ends, every pending edit becomes `edit:unknown`
  at once,** whichever way it ends:
  - `disconnect()`, a socket close, a timeout;
  - **and `connect()` replacing the connection.** `connect()` (~L304) marks
    the old record `stale` and closes its socket *without* emitting
    `disconnected`, so this can't hang off the `disconnected` event. It
    happens in `connect()` itself, before the new socket opens.
- **A late answer from a superseded connection is ignored.** `dispatch`
  (~L431) already drops messages whose record isn't current; keeping the
  pending map on the record makes this hold for edits too.
- **Own `set` echoes are still not re-applied** (they already are, locally),
  but they now emit `edit:accepted`.
- `addNode`/`removeNode` keep returning the `seq`. The `send` path exposes
  it too: either `_onLocalMutation` records it where the caller can read it
  (`client.lastSendSeq`), or a public `client.edit(node, field, value)`
  returns it. The brief picks one.
- `app.js`'s teleporter form keeps working: it can switch to the events or
  keep its `seq` match, which is now unambiguous.

### A4. Avatar and external-node protection on `add` and `remove`
In `case 'remove'`:
- refuse a target that is a **live avatar** (`liveAvatarNames`, never a
  name prefix), for everyone including the owner → `PERMISSION_DENIED`;
- refuse a target that is an **externally loaded node** → `PERMISSION_DENIED`;
- refuse a target whose **subtree contains a live avatar** (defence in depth
  once A4's `add` rule exists) → `PERMISSION_DENIED`.

In `case 'add'`:
- **Avatar adds may not carry a `parent`** → `PERMISSION_DENIED`. Avatar
  adds skip the mutation gate, so today any visitor can attach their avatar
  under a world node. This check runs where the other avatar-add checks
  run, before the gate. The first-party client never sends one (its avatar
  `add` at ~L728 has no `parent`), so nothing legitimate breaks.
- **Non-avatar adds:** refuse a `parent` that is, **or has an ancestor
  that is,** a live avatar or an externally loaded node →
  `PERMISSION_DENIED`. After the avatar-add rule nothing can be under an
  avatar, so the ancestor walk is defence in depth; it's cheap.

In `send-policy.js`:
- refuse every `send` whose resolved node is externally loaded →
  `PERMISSION_DENIED` (closes 0c §6.1's carried item).

**Order: after the mutation gate,** as 0c ended up (its §3.1).
`commons.test.js` ~L243/~L273 send `remove` as a non-owner and expect the
gate's `PERMISSION_DENIED`. An unknown node reached by a permitted session
still gets `NODE_NOT_FOUND`, with its `seq` echoed (`teleporter.test.js`
~L396 checks the `seq`).

The server's own cleanup (`cleanupSession` → `world.removeNode`) is
internal and unaffected.

### A5. Names for new nodes (D3)
- One shared validator, used by `add` (non-avatar) and by rename.
- Uniqueness is checked against **`_objectsByName`**, not just nodes (F7).
- Failure → `INVALID_VALUE` with a message naming the rule, not internals.
- **Avatar adds are exempt** (their name is server-assigned and checked
  already).

### A6. Dispose and remove (D2)
- **SOM:** one method removes a node and its whole subtree, children first.
  For each disposed node:
  - its `_nodesByName`, `_objectsByName` and `_nodeMap` entries are
    deleted **only if they still point at that node** (fixes F7);
  - **a hosted camera or light is cleaned up completely:** its qualified
    alias (`<host>.camera`, `<host>.light`), its bare-name entry if it has
    one (~L155, ~L188), its entry in `_cameras` / `_lights`, and its
    `_cameraMap` / `_lightMap` entry. **Every map deletion is guarded by
    object identity.**
  - **Shared resources survive.** A glTF camera can be referenced by more
    than one node. The camera object, its bare name and its place in
    `_cameras` go only when no surviving node references it; the deleted
    host's own alias always goes.
- `SOMNode.dispose()` goes through it, so the server and clients share one
  path.
- **Server:** one `remove` broadcast for the root, one save notification.
  Names in the subtree that were in `externalNodeNames` are dropped from it.
- **Client:** `_onRemove` uses the same SOM method, so clients drop the
  same subtree. `som:remove` fires for the root; the brief decides whether
  it also lists the descendants (`apps/client` rebuilds pads on any remove,
  so either works).

### A7. Clients honour `add.parent` (F6)
- **No `parent` (or `null`):** add at the scene root, as today.
- **`parent` given and found:** add under it.
- **`parent` given but not found locally:** the client has missed state.
  **Don't insert the node anywhere.** Emit `som:desync { reason, node,
  parent }`. `apps/client` handles it by reconnecting to the same world
  through `trackConnect` (`app.js` ~L883), as Go Back does, which brings a
  fresh `som-dump`. The inspector logs it.
- The server adds the parent before any child and messages arrive in order
  on one socket, so this shouldn't happen; it's a recovery path, not a
  normal one.

### A8. Atomic rename (design §4.8)
- **`SOMDocument.renameNode(oldName, newName)`** returns `{ ok, code }`:
  - checks the A5 rules;
  - refuses camera and light hosts (D4);
  - renames the glTF node;
  - moves the `_nodesByName` and `_objectsByName` entries;
  - the dispose path looks up the node's **current** name (A6 deletes by
    identity, which covers this).
- **`SOMNode.name`'s setter** goes through `renameNode`. On failure it throws
  a typed error and changes nothing.
- **Server, explicit path** (design §4.8 asks the brief to pick):
  recommended — `world.setField` handles `field === 'name'` itself through
  `renameNode`'s return value and returns `INVALID_VALUE`, instead of going
  through `setPath`'s catch-all.
- **Allowlist:** `name` becomes allowed on a `SOMNode` only (not on avatars,
  externally loaded nodes, cameras, lights, animations or `__document__`).
  The value must be a string; the rest is A5.
- **The wire request names the node by its *old* name:**
  `{type:'send', node:'Crate', field:'name', value:'Box'}`. The server
  resolves `Crate`, renames it, and broadcasts the same `node`/`field`/
  `value` with `requestSeq` and `session`.
- **The requesting client renames only after the server accepts** (not
  optimistically):
  - a new public `client.renameNode(oldName, newName)` sends the request
    and returns its `seq`. It changes nothing locally;
  - on `edit:accepted` for that `seq`, the client applies the rename through
    `SOMDocument.renameNode` inside `applyLocally`, then emits
    `som:rename`. (The own-echo rule in `_onSet` would otherwise skip it.)
  - on `edit:rejected` or `edit:unknown` there is nothing to undo: local
    names and maps never changed.
- **The generic node listener never sends `name`.** A mutation event with
  `property: 'name'` is ignored by `_attachNodeListeners`; renames go only
  through `client.renameNode`. (Today a direct `node.name = x` would send
  under the captured old name, which happened to be right for the rename
  but wrong for every later edit.)
- **Other clients** apply the broadcast through `renameNode` (via `setPath`
  and the `name` setter, under `_applyingRemote`), then emit `som:rename`.
- **Node listeners read the node's current name when they send,** not a
  name captured at attach (F8.1), so the first edit after a rename goes out
  under the new name.
- **`som:rename { from, to }`** fires on every client, the requester
  included, once the rename is applied. `som:set` is still emitted for the
  `name` field, with `nodeName` set to the old name, for compatibility.

### A9. How the allowlist grows
Exactly one addition to `send-policy.js`: `name` on nodes (A8), plus the
external-node refusal (A4) and, with D8, the teleporter message split.
**Canonical path matching is not loosened.**

### A10. Rename consumers in 1a (the minimum, not Edit mode)
After 1a a rename can arrive from the protocol inspector or the client API,
so the two apps that key things by name must keep up:
- **`apps/client`:** on `som:rename`, call `rebuildPads()` (the `som:set`
  handler at ~L742 re-resolves by the old name and misses it). Peer labels
  are keyed by avatar names, which can't be renamed, so they need nothing.
- **`tools/som-inspector`:** on `som:rename`, `treeView.rebuild(client.som)`
  and, if the selected node was `from`, re-select it as `to` (the property
  sheet matches by name, `PropertySheet.js` ~L59). The inspector still shows
  names read-only; it gets no rename field in 1a.

### Errors

| Case | Code |
|---|---|
| `remove` of a live avatar, an external node, or a subtree holding an avatar | `PERMISSION_DENIED` |
| `add` under a live avatar or an external node, or under a descendant of one | `PERMISSION_DENIED` |
| Avatar `add` carrying a `parent` | `PERMISSION_DENIED` |
| `send` to an external node | `PERMISSION_DENIED` |
| A new name that breaks A5, or duplicates any registered name | `INVALID_VALUE` |
| Rename of a camera or light host (D4) | `INVALID_VALUE` |
| Unknown node, for a session past the gate | `NODE_NOT_FOUND`, as today |

Every error echoes `seq`. A refusal changes nothing, broadcasts nothing and
saves nothing.

## 6. Notes for 1b (Edit mode UI), from the code

For the later pre-brief; not part of 1a.

- **Toggle:** shown when `client.canEdit && avatarReady && client.connected`
  (the same gate as `updateTeleporterControls`, `app.js` ~L1161). Turning
  it on calls `trigger.setActive(false)` (no teleporting while editing) and
  exits the teleporter modes.
- **Selection:** raycast as delete mode does (`app.js` ~L1420), then
  `resolveSelectionRoot` from `@atrium/interaction` (Alt to descend).
  - Exclude avatars by name: the own avatar plus `join.avatar.nodeName`,
    not the client-supplied `ephemeral` flag (F16).
  - An externally loaded node selects its container.
  - Outline with `BoxHelper` (F13).
- **Handles:** `three/addons/controls/TransformControls.js`, r163 API (F13).
  - Mode buttons on screen, not W/E/R (F17).
  - Suspend camera drag while the handle is dragged (`dragging-changed`).
  - Grid and angle snapping toggles.
  - During a drag: update locally inside `applyLocally`, send at most about
    10 per second, and send once on release. Remember the gesture's start
    value; on `edit:rejected`, put it back with `applyLocally` (F15).
  - **Check in the prototype** how a `TransformControls` attached to a
    DocumentView object interacts with DocumentView's own updates; copying
    the object's local TRS into the SOM node is the expected pattern.
- **Property panel:** position, rotation (degrees in the UI, quaternion on
  the wire), scale, visible, name. Name changes go through
  `client.renameNode` and show only once accepted (A8). A small panel in `apps/client`; the
  inspector's `PropertySheet` isn't importable without import-map work.
- **Delete:** confirm every delete (there's no undo until step 2), with the
  extra "can't be undone, includes N children" warning.
- **Duplicate:** per D5.
- **Primitives:** `threeGeometryToGltfPrimitive` on `BoxGeometry`,
  `PlaneGeometry`, `SphereGeometry`, `CylinderGeometry` and a hand-built
  ramp; placed a couple of metres in front of the avatar; generated names
  that pass A5.
- **Refused edits:** a visible message with the server's text, then revert.
- **Teleporters:** after an accepted edit to a teleporter (move, delete,
  duplicate, rename), call `rebuildPads()` (F14). Destinations are still
  edited through the teleporter form.
- **Anything that reacted to `som:set` must also react to the editor's own
  `edit:accepted`** (F14).

## 7. Out of scope (1a)

- Edit-mode UI (1b).
- Undo and redo (step 2); models, the library and skies (step 3);
  `objectId` (step 4).
- A subtree `add`; extending the `add` descriptor (unless D5 picks (b)).
- Several editors in one world, or conflict handling between an owner's two
  tabs.
- WebSocket payload size limits; the client-supplied `ephemeral` flag on
  non-avatar adds.
- Renaming existing nodes whose names break A5. A5 applies to new names
  only.

## 8. Tests (1a)

**Run the existing suites with real servers; no mocks for the server or
SOM.** Every server is on port 0 with full teardown.

### 8.1 New
- **Protocol** (`validate.test.js`): `hello:server` with `canEdit`;
  `add:server`/`remove:server` accept `requestSeq` and `session`;
  `add:client`/`remove:client` **refuse** `requestSeq`; the disconnect
  `remove {id}` validates as server.
- **SOM:** subtree remove (all names gone, nothing serialized outside the
  scene); dispose deletes by identity (the `__document__`, animation-name
  and `X.camera` cases); **deleting a camera host and a light host** leaves
  no alias, no bare-name entry and no entry in `cameras` / `lights`; a
  camera shared by two nodes survives the deletion of one of them, keeps
  its bare name, and loses only the deleted host's alias;
  `renameNode` (rename then mutate, rename then delete, rename then
  serialize and reload, rename to an existing name, rename to each D3
  forbidden form, rename of a camera host).
- **Server**, a new file such as `edit-plumbing.test.js`, over **both world
  types**:
  - `canEdit` matrix: anonymous, non-owner, owner, open world, read-only
    commons;
  - `requestSeq` and `session` on `set`, `add`, `remove` broadcasts, **and
    every server-emitted broadcast validates** against its schema;
  - the A4 refusals, each asserting nothing changed, no broadcast, no save,
    including **an avatar `add` with a `parent`** and **an `add` under a
    descendant of an avatar** (build that descendant through the SOM
    directly, since the wire now refuses it);
  - the A5 refusals on `add`;
  - rename over the wire: accepted, broadcast, persisted after save and
    reload; duplicate → `INVALID_VALUE` (not `INVALID_FIELD`); avatar,
    external node, camera host refused;
  - remove of `P` with child `C`: `C` is gone, its name is free again, and
    the saved document doesn't contain it;
  - D8: a non-string destination and a 2049-character destination each get
    `INVALID_VALUE` with their own message.
- **Client** (`packages/client`):
  - one counter across `send`, `add`, `remove` and `view`;
  - `edit:accepted`, `edit:rejected`, `edit:unknown`;
  - the avatar announcement never enters the pending map;
  - **`connect()` replacing a connection with edits pending:** each becomes
    `edit:unknown` immediately, and a late `set` or `error` from the old
    connection resolves nothing;
  - `add.parent`: absent → root; present and found → under it; present and
    missing → not inserted, `som:desync` emitted;
  - a remote subtree remove drops the subtree.
- **Rename** (client and end to end; the review's four cases plus two):
  1. `client.renameNode('Crate', 'Box')` sends `node: 'Crate', field:
     'name', value: 'Box'`, and nothing changes locally before the answer;
  2. accepted: both clients resolve `Box`, neither resolves `Crate`, both
     emit `som:rename { from: 'Crate', to: 'Box' }`;
  3. rejected (rename onto an existing name): the requester's local names
     and maps are unchanged, and the server's too;
  4. after the rename, a translation edit on either client goes out with
     `node: 'Box'`;
  5. a direct `node.name = x` sends nothing (A8);
  6. a remotely renamed teleporter node is found under its new name after
     `som:rename` (the data `apps/client`'s `rebuildPads` reads). The
     `app.js` wiring itself has no unit tests (it's DOM code) and is
     checked on DEV (§9).
- **End to end** (real server, two real `AtriumClient`s): A renames, moves
  and deletes; B sees each; A gets `edit:accepted` for each; a refused edit
  gives A `edit:rejected` with the right `seq` and B sees nothing.

### 8.2 Authority (the disagreement cases)
For each, the client sends something the server must refuse, and the test
asserts the server's state is unchanged:
- the owner removes a **peer's** avatar, and their **own**;
- the owner adds under a peer's avatar;
- the owner renames onto an existing name, onto `__document__`, onto an
  animation's name;
- a client sends `requestSeq` itself (refused by the client schema);
- a **non-owner** sends an avatar `add` with a `parent` (avatar adds skip
  the gate, so this is the one a visitor can try).

### 8.3 Existing tests that change (checked against `aa55b87`)
- **`send-field-allowlist.test.js`:**
  - ~L268: the "must be refused" loop drops `name` for nodes; a separate
    assertion covers `name` with an invalid value;
  - ~L899: the `['name', 'renamed', 'PERMISSION_DENIED']` row becomes an
    accepted rename (or moves to a rename test), and ~L924's "no rename"
    assertion moves with it;
  - ~L909: it builds a node named `X.light` through `add`. Under D3 that
    `add` is refused, so the test must create the node another way (for
    example through the SOM directly) and keep its classification check;
  - camera and animation `name` (~L299, ~L1105) stay refused.
- **Unchanged, and must stay green:** `teleporter.test.js` `canPlaceTeleporters`
  matrix; `commons.test.js` non-owner `remove` (gate first);
  `teleporter.test.js` ~L396 unknown-node remove; `session.test.js` ~L327
  (removes `crate-01`, a leaf).

**Report each changed assertion and why** in the handoff.

### 8.4 Baseline at `aa55b87`
Node 22.22.0, clean install, each file run on its own:
- **server:** 19 files, 380 pass, 0 skipped;
- **protocol** 60; **som** 176; **`packages/client`** 145 (with
  `--test-force-exit`); **`apps/client`** 193; **renderer-three** 64;
  **interaction** 9. All `fail 0`, `skipped 0`.

Give every expected count **next to the exact command** (tint passdown
§4.5).

### 8.5 Proofs of failure
Each must fail with the named tests, exit nonzero and stop on its own. Restore
afterwards.

| Proof | Break | Must fail |
|---|---|---|
| (a) | Drop the A4 avatar check in `remove` | peer-avatar remove |
| (b) | Dispose callback back to deleting by name | the `__document__` / animation-name dispose tests |
| (c) | `SOMNode.dispose` back to the single-node dispose | subtree remove (server and SOM) |
| (d) | `setField` handles `name` through `setPath` again | duplicate rename → expects `INVALID_VALUE` |
| (e) | Client back to two counters | the one-counter test and the end-to-end rejection test |
| (f) | Drop `requestSeq` from the `set` broadcast | `edit:accepted` tests |
| (g) | Node listeners use the name captured at attach again | rename case 4 (the next edit goes out under `Box`) |
| (h) | Don't clear pending edits in `connect()` | the connection-replacement test |
| (i) | Drop the avatar-add `parent` check | the avatar-add-with-parent refusal, owner and non-owner |

## 9. Worker rules and operator checks

**Workers:** as in the last full round (send-field-allowlist passdown §3.3):
`pnpm install --frozen-lockfile --prefer-offline` in their own worktree and
a `readlink` check; the full handoff (40-char SHA, per-file counts and exit
codes, Node version, skipped count, proofs); progress comments. **No output
redirects in card commands** (the sandbox scanner blocks them, tint
passdown §4.5).

**Before kickoff:** no open sentinel; a push dry run; the base SHA from a
host fetch. **No GitHub web edits to `main` from the base fetch until PROD**
(teleport-rearm passdown §3.1). Upload this pre-brief before the round.

**DEV acceptance for 1a** (`https://dev.ewwb.dev`; the inspector isn't
served there, so use the protocol inspector, send-field-allowlist passdown
§7.2):
1. **No "before" on PROD.** The old behaviour (F3, F4) was shown on a local
   server by the Rev 0 probes, and proofs (a) and (i) show the new tests
   catch it. Don't exercise a known hole on production.
2. **DEV, as the owner:**
   - `hello` shows `canEdit: true` and `canPlaceTeleporters: true`;
   - a `send` of `translation` comes back as `set` with `requestSeq` equal
     to the request's `seq`, and `session`;
   - rename a node; the `set` echoes; a reload shows the new name;
   - rename onto an existing name → `INVALID_VALUE`;
   - `remove` a second visitor's avatar → `PERMISSION_DENIED`;
   - add a parent and child, remove the parent; after a reload neither is
     there;
   - with an `apps/client` window open in the same world, rename a
     teleporter pad from the protocol inspector; in that window, walking
     off and back onto the pad still teleports, without a reload (A10).
3. **DEV, as a non-owner:** `hello` shows `canEdit: false`; a `remove` gets
   the gate's `PERMISSION_DENIED`.
4. **Regression in `apps/client`:** place and delete a teleporter; take it
   and come back; two windows still see each other move.

## 10. Notes for the brief author

- **Design §4.1 says the server should refuse owner edits to other
  visitors' avatars.** 0c did that for `send`; F3/F4 are what's left, for
  `remove` and `add`.
- **Design §3.8 lists three rename problems.** F8 adds three more (client
  listeners, camera/light aliases, app keying). A rename that passes the
  server tests but leaves a client sending under the old name is the
  likeliest subtle failure here; the end-to-end test in §8.1 is what
  catches it.
- **F5 and F7 aren't in the design doc.** They came from probing the code
  while checking §4.1's delete and §4.8's dispose callback.
- **Rename crosses four layers:** SOM identity, how the request names the
  node, server validation, and client sync. Rev 1 specified each layer but
  not how a rename crosses them; A8 now does. If anything in A8 looks
  ambiguous while writing the brief, ask rather than resolve it in the
  brief.

## 11. Review log

### 11.1 Outside review of Rev 1 (ChatGPT, 2026-10-13)
Verdict: keep the split and D1–D8; revise before implementation. Each
finding was checked against `aa55b87`.

| # | Finding | Check | Disposition |
|---|---|---|---|
| 1 | A8: a listener reading the current name would send the rename itself as `node: 'Box'`, which the server can't resolve | Confirmed by reading: the `name` setter dispatches after `setName` (`SOMNode.js` ~L23) | A8 rewritten: request by old name, apply on acceptance, generic listener never sends `name`. Six rename tests |
| 2 | `connect()` replaces a connection without `disconnected`; pending edits must not carry over. Don't track the avatar add | Confirmed: `connect()` ~L304 marks the record `stale` and closes it; `dispatch` drops stale-record messages | A3: pending map on the connection record, cleared in `connect()`; avatar add untracked. Tests and proof (h) |
| 3 | Disposing a camera or light host must also clear `_cameras`/`_lights`, maps and bare names, keeping shared resources | Confirmed: `_cameras`/`_lights` (~L67), bare-name registration (~L155, ~L188) | A6 extended, identity-guarded; shared-camera test |
| 4a | Avatar adds can carry a `parent` and skip the gate | Confirmed from the code; the first-party avatar `add` (~L728) sends none | A4: refused; ancestors of a non-avatar `add`'s parent checked too. Proof (i) |
| 4b | A7's root fallback hides a missing explicit parent | Accepted | A7: not inserted, `som:desync`, `apps/client` reconnects via `trackConnect` |
| 5 | `som:rename` needs consumers in 1a | Confirmed: `app.js` ~L742 re-resolves by the old name; the inspector matches selection by name | New A10: minimal handling in `apps/client` and the inspector; DEV check |
| 6 | Don't exercise the avatar hole on PROD as a baseline | Accepted | §9 step 1 replaced |
