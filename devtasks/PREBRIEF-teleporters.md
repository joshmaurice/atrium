# Pre-brief: Teleporter placement (addendum Step 7, §8)

Status: **FINAL, Revision 4. All decisions are confirmed by the human:**
T0 on 2026-09-29 (re-confirmed the same day with the cookie disclosure
added), and T1–T13 on 2026-09-29. Ready for the brief/critic pipeline once
this file is uploaded to `devtasks/`, together with the updated
`ADDENDUM-user-accounts-phase2.md`, which records T0 in §8.

Revision 4 (2026-09-29): T5 gains a spawn-point warning at the human's
request, and the human confirmed T1–T13. The open questions in §5 remain
the brief author's and critic's to settle within these decisions.

This is input for the brief-writing step (brief author, then critic). It is
not the brief itself.

Revision 3 also adds **T13** at the human's request: each pad shows a
destination label derived from its destination, reusing `LabelOverlay`.

Revision 3 (2026-09-29), second external review:
- **T3:** `addNode` and `removeNode` require the current world to be
  fully loaded (after `som-dump`), not merely `session:ready`. The editing
  UI is enabled on local-avatar readiness, like T4, and disabled on the
  next `connecting`.
- **T2 is settled:** `hello.canPlaceTeleporters` = owner and the policy
  permits the owner to mutate. The read-only case is no longer left to the
  brief author, and matches the checklist. `Q-readonly-owner` is removed.
- **T0:** the cookie sentence is made precise. The source server's Atrium
  cookie never reaches another host; a destination Atrium server's own
  cookie may, and is ignored.

Revision 2 (2026-09-29) folds in external review. Each point was verified
against `fb5fec8` before being adopted:
- **T3 is redesigned.** The server now echoes successful non-avatar `add`
  and `remove` to the sender too, so the sender's SOM changes only through
  that echo. There's no optimistic local change, no rollback and no
  timeout. `Q-pending` is removed.
- **T2 becomes `isOwner`** (renamed `canPlaceTeleporters` in Revision 3), not a generic `canEdit`. Placement is
  owner-only, including in `'open'` worlds, and the flag resets at the
  start of every `connect()`. That also removes T5's cross-origin
  dropdown case (`Q-open-dropdown` is removed).
- **T4 goes live later:** on the current session's local avatar being
  ready, not on `session:ready`, which fires before `som-dump`.
- **T7 now specifies the `AtriumClient` change it needs.** The client
  itself falls back to `User-xxxx` and always sends it.
- **T8:** `trackConnect` reports supersession as a distinct outcome, so a
  superseded caller can't run success-side UI cleanup.
- **T9:** the duplicate-name check covers every `add`, avatar re-adds
  included.
- **T0:** the disclosure list now includes destination cookies, which the
  `WebSocket` API can't suppress, plus what that does and doesn't let a
  world owner do. The human re-confirmed T0 with this added.

Inputs:
- `devtasks/ADDENDUM-user-accounts-phase2.md` §7 and §8 (as on `main`, plus
  the T0 edit);
- `devtasks/PREBRIEF-cross-server-connect.md`, Rev 5 (decisions referred to
  as X#1–X#12);
- `devtasks/Atrium-Passdown-2026-09-28-cross-server-connect-shipped.md`,
  including its 2026-09-29 addendum.

Code facts were verified on `main` at `fb5fec8`. Line numbers are
approximate. Tests were **not** re-run for this pre-brief. The shipped
passdown reports 15 server files and 272 tests passing at `2fbcaf4`. Since
`42fa2a85`, the deploy requires every server test file to exit on its own
within 180 s, with no force-exit exceptions.

## 1. Goal

Implement addendum §8. An owner places teleporter pads in their own world,
each with a destination: another world on this server, the commons, or a
world on another server. Anyone who walks onto a pad is reconnected in
place to the destination. Owners can delete pads. There's no repositioning
and no general object placement (§8 and the addendum's out-of-scope list).

Step 6 provides the machinery:
- `connect()` in place, with superseding and stale-event suppression (W#9,
  W#11);
- the connect-outcome helper `trackConnect` (X#5);
- visible failure messages that name the host (X#5, X#6);
- anonymous-on-arrival identity (X#2), and B-assigned names (X#9).

This step adds:
- the pads themselves, as nodes;
- the owner's placement and deletion UI;
- the proximity trigger;
- the fixes and small server changes those need (§2).

## 2. Verified facts

### 2.1 Nothing teleporter-shaped exists yet

- No code mentions teleporters. The only match for "teleport" is a camera
  test name.
- The addendum's §8 is the spec, with the T0 edit.

### 2.2 What `add` and the SOM can carry

- **`add.json`:** `{ type, seq, id?, format?, parent?, node }`, where
  `node` has `name` (required), `translation`, `rotation`, `scale`,
  `extras` (any object), `extensions`, and an inline `mesh` with
  `primitives[{ attributes, indices, material }]`. Additional properties
  aren't allowed.
- **`SOMDocument.ingestNode`** (~L418) builds a node with an inline mesh:
  - `POSITION` and `NORMAL` from plain arrays;
  - indices as `Uint16Array`, so a primitive can have at most 65,535
    vertices;
  - a material from `pbrMetallicRoughness` (`baseColorFactor`,
    `metallicFactor`, `roughnessFactor`).
- **Existing helpers in `renderer-three/src/geometry-utils.js`:**
  - `threeGeometryToGltfPrimitive(geometry, material)` turns a Three.js
    geometry into exactly such a primitive;
  - `buildAvatarDescriptor()` uses it for the capsule avatar.

  A pad descriptor is the same pattern with a flat ring or disc.
- **`world.serialize()`** writes the full glTF JSON, with buffers embedded
  as data URIs. Meshes and `extras` of added nodes survive a save and
  reload.
- **Autosave** (`autosave.js` ~L61–100) persists everything except live
  sessions' avatar nodes (and external-reference nodes). A non-avatar
  `add` or a `remove` calls `onSaveableMutation` → `markDirty`
  (`session.js` ~L517, ~L574) in owned worlds.

### 2.3 Server handling of `add` and `remove` (`session.js`)

- **`add`** (~L463–520):
  - an `add` with `msg.id` is the avatar add. `id` must match the session,
    and `node.name` must equal the session's `avatarNodeName`;
  - non-avatar adds go through `isMutator(session, false)`, which is
    owner-only in `'owner'` worlds, everyone in `'open'` worlds, and nobody
    in `'read-only'` ones;
  - on success the node is broadcast with `broadcastExcept`, so **the
    sender gets no echo and no acknowledgement**.
- **There's no duplicate-name check.** `world.addNode` → `ingestNode` →
  `_nodesByName.set(name, …)` silently shadows an existing node with the
  same name. `remove`-by-name then removes one of them, and the saved
  document contains both.
- **`world.addNode` ingests before checking the parent** (`world.js`
  ~L268): with a missing `parent` it returns `NODE_NOT_FOUND`, but the node
  is already registered in the SOM's name maps, unattached. That's a small
  pre-existing bug.
- **`remove`** (~L551–577) is gated by `isMutator(session, false)` and
  broadcast with `broadcastExcept`. Same no-echo behavior.
- **`error.json`'s `code` is a closed enum:** `PERMISSION_DENIED`,
  `NODE_NOT_FOUND`, `INVALID_FIELD`, `INVALID_VALUE`, `WORLD_FULL`,
  `AUTH_FAILED`, `RATE_LIMITED`, `UNKNOWN_MESSAGE`.
- **Step 6's avatar-name guard** (X#9) protects only avatar nodes'
  `extras.displayName`. Nothing validates the contents of `extras` on
  other nodes.

### 2.4 The client can't send a non-avatar `add` or `remove`

- `AtriumClient` sends `add` only for its own avatar (~L665, after
  `hello`). It has no public `addNode` or `removeNode`.
- `_onAdd` and `_onRemove` (~L680, ~L705) apply *other* sessions' changes
  and emit `som:add { nodeName }` and `som:remove { nodeName }`. `set`
  changes flow out through `_attachMutationListeners` and in as `som:set`.
- Because of `broadcastExcept`, whoever adds or removes a node must also
  apply the change to its own SOM. There's no server acknowledgement to
  wait for. Only a failure produces a message (`error`, which carries
  `code` since X#4).
- **T3 changes this:** successful non-avatar `add` and `remove` will be
  echoed to the sender, so the sender applies them through the normal
  receive path.

### 2.5 The client doesn't know whether it can edit

- `hello.server.json` has `id`, `seq`, `serverTime`, `worldStartTime`,
  `avatarNodeName`, `displayName` (X#9) and `capabilities.tick`, with
  `additionalProperties: false`. There's nothing about permissions.
- Neither `AtriumClient` nor `app.js` has any notion of ownership or edit
  rights.
- The server decides edit rights per session from `session.userId`, the
  world's owner and its policy (`isMutator`). Since X#2, a cross-origin
  session is anonymous, so an owner who visits their own world from
  another server's page can't edit it.

### 2.6 Spawn and the avatar

- **Every avatar spawns at the world origin.** `buildAvatarDescriptor()`
  sets `translation: [0, 0.7, 0]`, and nothing mentions a spawn point, so
  every connect, including every teleport arrival, lands at the origin.
- The local avatar is `stage.avatar.localNode` (a SOM node), and
  `AvatarController` emits `avatar:local-ready` when it's set up.
  `Stage.tick(dt)` (~L307) advances navigation and animation, syncs the
  camera and renders. `app.js` calls it from its `requestAnimationFrame`
  loop (~L947–956).
- In static mode (not connected), `AvatarController` creates a bare
  `__local_camera` node instead of an avatar.

### 2.7 Placement helpers

- **`projectRayToPlane(ray, planeY)`** (`renderer-three/src/drag-math.js`
  ~L24) intersects a ray with the horizontal plane `y = planeY`. It returns
  `null` when the ray is parallel to the plane or the hit is behind the
  origin. It's already used for dragging.
- **`PointerInputBridge`** and `hit-test.js`'s `walkUpToSOMNode` map
  pointer hits to SOM nodes. That's usable for selecting a pad to delete.

### 2.8 Step 6 helpers teleporters depend on

- **`trackConnect(wsUrl, connectOpts, { onError })`** (`app.js` ~L645) is
  used by My Worlds Load (~L206) and manual Connect (~L771). It:
  - resolves on the matching `session:ready`;
  - rejects on a matching `error` or `disconnected`;
  - settles quietly when superseded.

  **A brittleness:** it registers its `session:ready` listener with
  `client.once`, so the first `session:ready` for *any* session removes it,
  even when the `sessionId` doesn't match. Stale-event suppression (W#11)
  makes that unreachable today. Rapid teleports would be the first thing
  to stress it.
- **`resolveWorldAddress(str, origin)`** (`apps/client/src/wsUrl.js` ~L96)
  is **exported and tested, but never called**; `app.js` imports it
  unused. Verified behavior at `fb5fec8`:

  | input | origin | result |
  |---|---|---|
  | `/worlds/josh/garden` | `wss://b.example` | `wss://b.example/worlds/josh/garden` ✓ |
  | `/worlds/josh/garden` | `wss://b.example/worlds/ann/home` | `wss://b.example/worlds/ann/home/worlds/josh/garden` ✗ |
  | `/` | `wss://b.example/worlds/ann/home` | `wss://b.example/worlds/ann/home/` ✗ (the current world, not the commons) |
  | `/worlds/josh/garden` | `https://b.example` | `ws://b.example/…` ✗ (downgrade; an `https:` page blocks it) |
  | `/worlds/josh/garden?x=1` | `wss://b.example` | query dropped |
  | `wss://c.example/…` | any | passed through ✓ |

  So it's correct only when given a **bare `ws(s)` origin**. It strips the
  path's leading `/` and resolves the rest against the whole `origin`
  string, so an origin that carries a path gets it prepended.
- **`hello.client` sends `displayName`** (`AtriumClient.js` ~L385) to every
  server, including cross-origin ones. Atrium servers ignore it (X#9 / F1:
  "server never adopts client-sent hello displayName"). A non-Atrium
  server receives it. The app passes the account name on Load (~L208) and
  auto-connect (~L412).
- **`GET /api/worlds`** (`http-routes.js` ~L519) returns the logged-in
  user's worlds as `{ id, slug, name, visibility, updated_at }`, newest
  first. `currentUser.username` supplies the `<user>` part of
  `/worlds/<user>/<slug>`.

### 2.8a Facts verified for Revision 2

- **Server errors lose their `seq` on the client.** `AtriumClient`'s
  `case 'error'` (~L411) emits an `Error` with `sessionId`, `url` and
  `code`, but not the message's `seq`.
- **The client always sends a name.** `connect()` sets
  `this._displayName = displayName || \`User-${shortId}\`` (~L313). It
  writes that into the avatar descriptor's `name` and
  `extras.displayName`, and `onOpen` always sends
  `displayName: this._displayName` in `hello` (~L385). An app that omits
  `displayName` still transmits `User-xxxx`, and a caller-supplied name is
  always transmitted.
- **Manual Connect transmits the account name to any server.** It passes
  `currentUser.displayName || currentUser.username` whenever someone is
  logged in, including for cross-server URLs (`app.js` ~L768).
- **Order on connect:**
  1. `hello` arrives, and `_onServerHello` emits `session:ready` (~L633).
  2. `som-dump` arrives as a separate, later message. `_onSomDump` (~L647)
     calls `_initSom`, which **replaces the SOM**, then adds the local
     avatar and emits `world:loaded` (~L1057).
  3. `AvatarController` reacts to `world:loaded` and emits
     `avatar:local-ready`.

  So at `session:ready` there's no current SOM and no local avatar.
- **`_onAdd` ingests at the scene root and ignores `msg.parent`** (~L680).
  It's pre-existing, and harmless for pads, which are root-level (T1).
- **Nothing but the avatar sends `add` or `remove` today.** The only
  senders outside tests are the client's own avatar `add` and the
  server's broadcasts. So echoing non-avatar changes to their sender (T3)
  can't make any existing client apply a change twice.
- **Supersession looks like success to `trackConnect`'s callers.** When
  superseded, `trackConnect` resolves with `null`. My Worlds Load then
  continues after its `await` to `showOverlay('')` (~L217), and manual
  Connect's `.then` does the same (~L774). Both clear the "Connecting…"
  overlay that now belongs to the *newer* connect.
- **Avatar adds aren't checked for duplicates.** They require
  `msg.id === session.id` and `node.name === session.avatarNodeName`, but
  not that the name is absent from the SOM. A client that sends its avatar
  `add` twice ingests a second node with the same name.
- **The `WebSocket` API has no credentials option.** The constructor takes
  only a URL and optional subprotocols. The opening handshake carries
  whatever cookies the browser's rules attach for the *destination*, and
  page code can't prevent that.

### 2.9 Browser and deployment facts that shape behavior

- **An `https:` page can't open `ws://` connections** (mixed content). The
  constructor throws synchronously, and X#4's constructor-throw path turns
  that into a visible failure. So §8's "`ws://` is accepted so that
  localhost and dev teleporters work" only helps on `http:` pages (local
  development). On DEV and PROD, a `ws://` destination always fails,
  visibly.
- **A cross-server teleport can be tested with only DEV deployed.** PROD
  (Step 6) already admits cross-origin connections anonymously, so a pad
  on DEV pointing at a PROD world works as soon as DEV has Step 7.
- **Tools for testing:** `acctest1` and `acctest2` exist on DEV (shipped
  passdown §4.2), and Hermes's browser tool works for multi-session
  checks. Cross-origin cookie checks stay human.

## 3. Decisions (all confirmed by the human, 2026-09-29)

**T0. Every teleporter triggers automatically, including cross-server ones
(confirmed by the human on 2026-09-29, and re-confirmed the same day after
the cookie disclosure below was added).**
- There's no confirmation step for any destination.
- **What an automatic cross-server teleport discloses to the destination
  server:**
  - the visitor's IP address, arrival time and browser type;
  - the `Origin` of the visitor's *page*, which is their account server;
  - the name their client sends. T7 removes this for other servers.
  - **Cookies applicable to the destination host or site** (§2.8a). The
    `WebSocket` API has no way to omit them.
    - The account (source) server's Atrium cookie is host-only, so it's
      never sent to a different destination host.
    - If the destination is itself another Atrium server for which the
      browser holds an Atrium cookie, that destination's cookie may
      accompany the handshake. Step 6 ignores it on a cross-origin
      connection (X#2).
    - For a destination on the *same site* as the visitor's page (every
      `*.sslip.io` host is one site, per X §2.3), ordinary (`Lax`) cookies
      are sent.
    - For a cross-site destination, only cookies marked `SameSite=None`
      are sent, and some browsers block or partition even those.
    - An Atrium destination ignores cookies on cross-origin connections
      (X#2), so visitors arrive anonymous.
- **What this does and doesn't let a world owner do.** The owner chooses
  only the address. Atrium's client opens the connection, sends only its
  fixed messages (`hello`, avatar `add`, `view`), and discards anything it
  doesn't understand in reply. The owner never sees the reply. That makes
  the owner strictly weaker than the owner of any website the visitor
  opens. Realistic consequences, most significant first:
  1. **The destination learns the visitor arrived:** IP, time, originating
     Atrium site. If the destination's own site set a cross-site-usable
     cookie earlier, it can link this arrival to the visitor's other
     visits. This is the main one.
  2. **A badly built third-party WebSocket service** (it trusts cookies,
     doesn't check `Origin`, and receives the visitor's cookies) might see
     a connection authenticated as the visitor. It would receive only
     Atrium's fixed messages, and the owner can't read its replies. The
     harm is limited to side effects of connecting. Any web page can
     already exploit such a service.
  3. **Probing a visitor's local network mostly fails:** `https:` pages
     can't open `ws://`, internal hosts rarely have valid `wss://`
     certificates, browsers increasingly block public pages from reaching
     private networks, and the owner never learns the outcome.
  4. **Nuisance:** dead-end destinations disconnect the visitor (T8's "Go
     back" softens this), or misleading content on the destination.
- **The alternative weighed** was asking before any cross-server
  destination ("This leads to b.example. Go?"). The same connection
  happens once the visitor clicks Go, so asking wouldn't stop any of the
  above technically. It would only add consent for #1. The human chose
  automatic triggering, accepting that visitors can be handed to another
  server, and seen by it, without choosing to go.
- Recorded in addendum §8, including the cookie point.

The rest were confirmed by the human on 2026-09-29:

**T1. A teleporter is an ordinary node with a marker in `extras`.**
- **Name:** `teleporter-<uuid>`, generated by the client. It's never
  reused.
- **Marker:** `extras.atrium.teleporter = { destination: "<string>" }`. A
  node is a teleporter exactly when
  `extras.atrium.teleporter.destination` is a non-empty string.
- **Stored destination:** exactly as saved by the UI (T5): a
  server-relative path from the dropdown, or the free-text value after
  trimming.
- **Visual:** a flat ring or disc, built by a new
  `buildTeleporterDescriptor({ name, position, destination })` in
  `geometry-utils.js`, next to `buildAvatarDescriptor`, using
  `threeGeometryToGltfPrimitive`. The color, size and vertex budget are the
  brief author's call; keep it well under the 65,535-vertex limit. The
  visual radius matches the trigger radius (T4).
- **Placement:** always a child of the scene root (no `parent`), so its
  `translation` is in world space, which T4 relies on. No rotation or
  scale.
- **Recognition:** by the marker alone, wherever the node came from: the
  initial `som-dump`, a peer's `add`, the local add (T3), or a saved
  document. A `set` that removes or changes the marker is honored the
  next time T4 checks.

**T2. The server tells each session whether it may place teleporters:
`hello.canPlaceTeleporters`.**
- **Formula (server-side):** `canPlaceTeleporters = session.userId !== null
  && session.userId === worldOwnerUserId && isMutator(session, false)`.
  That's the owner of the world, where the world's policy permits the
  owner to mutate.
  - **Not a generic "can edit":** `isMutator` alone is true for *everyone*
    in `'open'` worlds, and §8 makes placement owner-only.
  - **Not ownership alone:** the owner of a `'read-only'` world would see
    controls that are guaranteed to fail. Don't show them.
  - Ownerless worlds (all current `'open'` worlds are ownerless) give
    `false`.
  - A general `isOwner` fact isn't sent, because nothing needs it yet. Add
    it later if something does.
- **Protocol:** add an optional boolean `canPlaceTeleporters` to
  `hello.server.json`. Add protocol tests: it validates, and unknown
  properties are still rejected.
- **Client:**
  - `AtriumClient` exposes `client.canPlaceTeleporters` and includes it
    in `session:ready`;
  - it resets to `false` **at the start of every `connect()`**, in the
    existing per-connection reset block (~L302), and on `disconnect()`.
    Step 6 suppresses a superseded connection's `disconnected` (W#9), so a
    reset on `disconnected` alone would leave a stale `true` across a
    world change;
  - an old server that omits the field means `false`.
- **The app never infers permission** from the URL, the username or the
  page origin. When the UI is enabled is defined in T3.
- **Consequences:** a cross-origin visitor never gets it, even when they
  own the world on that server (X#2); nobody gets it in ownerless worlds;
  the owner of a `'read-only'` world doesn't get it.
- **It's a hint, not a permission.** The server's gate still decides every
  `add` and `remove`.

**T3. Server-authoritative add and remove: the server echoes successful
non-avatar changes to the sender too.**
- **Server:** for a successful **non-avatar** `add`, and for every
  successful `remove`, send the broadcast to *every* session in the world,
  including the sender, instead of `broadcastExcept`. The avatar `add`
  keeps `broadcastExcept`, because the sender creates its own avatar
  locally. The departure `remove` (`session.js` ~L190) already goes to
  everyone.
- **Client:** add `client.addNode(descriptor)` and
  `client.removeNode(name)` to `@atrium/client`. They're renderer-neutral
  and know nothing about teleporters.
  - **Each requires the current world to be fully loaded,** not merely
    `session:ready`. `AtriumClient` tracks a per-connection "world ready"
    flag: set when `_onSomDump` has finished building the current SOM
    (where it emits `world:loaded`), and cleared at the start of every
    `connect()` and on `disconnect()`. Otherwise the method refuses
    (throws or returns false; brief author's call).
  - **Why:** `canPlaceTeleporters` arrives in `hello`, before `som-dump`
    (§2.8a). A pad placed in that window would be echoed back before
    there's a current SOM to apply it to, and could race the server's
    serialization of the initial dump.
  - Each **only sends** the request (`add` with no `id` and no `parent`,
    or `remove`) with a fresh `seq`, and returns that `seq`.
  - **They never change the local SOM.** The change arrives through the
    existing `_onAdd` / `_onRemove` when the server's broadcast comes
    back, exactly as for any peer's change. A refused request changes
    nothing locally.
- **Correlating outcomes:**
  - *success* is the echoed `som:add` or `som:remove` for the node name.
    The client generates unique names (T1), so the name identifies the
    request;
  - *failure* is an `error` carrying the request's `seq`. **`AtriumClient`
    now copies the server message's `seq` onto the emitted `Error`**
    (`err.seq`, next to `code`; §2.8a);
  - if the connection drops or is superseded first, the UI treats the
    request as abandoned. There are no timers.
- **Why this design:** no optimistic ingest, so a rejected duplicate name
  can never shadow an existing node, even briefly. No rollback and no
  subtree restore. No timeout window that a late rejection could slip
  past. Every client, sender included, sees the same authoritative order.
- **Cost:** the owner sees their pad appear after a round trip, not
  instantly. The placement form shows a pending state until the echo or
  error arrives.
- **When the placement and delete UI is enabled:** only when
  `canPlaceTeleporters` is true **and** the current connection's local
  avatar is ready (`avatar:local-ready`, the same boundary as T4). It's
  disabled immediately on the next `connecting`, and any open placement
  form is closed then. So editing and triggering share one readiness
  rule.

**T4. Proximity trigger: an arming rule, one teleport at a time, active
only while connected.**
- **Pure logic:** put it in a small pure module (e.g.
  `apps/client/src/teleport-trigger.js`) with no DOM, so it can be
  unit-tested. `app.js` calls it once per frame after `stage.tick(dt)`,
  passing the local avatar's position and the current pads.
- **Active only when** the current connection has a **ready local
  avatar**: `avatar:local-ready` has fired for the current session, after
  `som-dump` has built the current SOM (§2.8a). `session:ready` alone
  isn't enough, because it fires before `som-dump`. Also, no teleport or
  other connect may be in flight. Pads are inert in static mode, while
  connecting, and between `session:ready` and the avatar being ready.
- **Trigger state is rebuilt whenever the SOM is replaced** (every
  `som-dump`), from the pads present in the new SOM. The pad list also
  follows `som:add`, `som:remove` and `som:set`, which covers the
  marker.
- **Geometry:** a pad at `p` contains the avatar at `a` when the
  horizontal distance `|a.xz − p.xz| ≤ R` and `|a.y − p.y| ≤ H`. `R` is
  about 0.75 m and `H` about 2 m; the exact values are the brief author's
  call, as named constants.
- **Arming rule, which prevents bounce loops:** every pad starts
  **disarmed**: pads found in the initial `som-dump`, pads added later,
  and every pad again after each world change. A pad arms when the
  avatar is observed *outside* it, and triggers on the next
  outside→inside transition.
  - Every arrival is at the origin (§2.6), and so is a pad placed under
    the owner's feet. With this rule, landing on a pad never fires it:
    you step off and back on.
  - The same rule covers a newly added pad, which starts disarmed.
- **One at a time:** triggering sets "teleport in flight", and all pads
  are inert until the new connection's local avatar is ready, or the
  teleport fails. If two pads
  contain the avatar at the same moment, the nearest one wins.
- **Suspended during editing:** triggering is suspended while the owner's
  placement or delete mode is open (T5).

**T5. Owner placement and deletion UI.**
- **Entry point:** a toolbar control ("Teleporters" or "Place Teleporter"),
  enabled only under T2 and T3's readiness rule.
- **Placing:**
  1. The owner enters placement mode.
  2. The next viewport click is projected onto the plane `y = 0` with
     `projectRayToPlane`. A `null` result (parallel ray, or behind the
     camera) is ignored. `y = 0` is the ground plane for v1; worlds whose
     floor is elsewhere are out of scope.
  3. A small form opens with:
     - **a dropdown of the owner's worlds** from `GET /api/worlds`. Each
       entry saves `/worlds/<currentUser.username>/<slug>` (server-relative,
       per §8). It shows the world's name and a "(private)" hint for
       private worlds, since visitors won't be able to follow those. It
       also offers "The commons" (`/`).
     - **a free-text field** for a server-relative path, or a full `ws://`
       or `wss://` URL.
  4. **Spawn-point warning.** If the chosen position is within the
     trigger radius `R` (T4) plus a small margin (e.g. 0.5 m) of the spawn
     point, measured horizontally, the form shows a warning such as
     "Visitors arrive here and will land on this pad." The owner can still
     save.
     - **A warning, not a ban.** T4's arming rule already prevents
       teleport loops, since arriving on a pad never fires it. The warning
       is about usability: every arrival would land on the pad, and a stray
       step would trigger it. Some owners will want a pad there anyway, for
       example a hub world with a central portal.
     - **The spawn point is the world origin** for now (§2.6). If spawn
       points are added later, the check follows the world's spawn point.
  5. **Save** validates syntax only: `resolveWorldAddress` (T6) must return
     a non-null URL against the current world's origin. There's no
     existence check (§8). Then `client.addNode(buildTeleporterDescriptor(…))`.
  6. **Esc** or **Cancel** exits without adding anything.
- **Deleting:** in the same mode, clicking a pad (via the pointer
  bridge's SOM hit, walking up to the node carrying the T1 marker)
  selects it and offers **Delete**, which calls `client.removeNode(name)`.
  There's no editing of destination or position (§8: delete and
  re-place).
- **The dropdown lists the account server's worlds** (`GET /api/worlds`
  is page-relative) and saves server-relative paths that resolve against
  the *world's* server (T6). Those are only the same server when the
  world's server is the account server.
  - T2 guarantees that: `canPlaceTeleporters` requires an authenticated same-origin
    session, so the page's origin *is* the world's server.
  - **As defense in depth, the app also hides the dropdown whenever the
    current world's origin differs from the account server's origin**,
    leaving free-text only. A dropdown pointing at the wrong server is
    never acceptable, even in dev.

**T6. Fix `resolveWorldAddress` and use it for every destination.**
- **Reduce `origin` to scheme and host** (`protocol//host`) before
  resolving. Callers may pass the connected world's full URL.
- **Map `http:`→`ws:` and `https:`→`wss:`.** It currently downgrades
  `https:` to `ws:` (§2.8).
- **A path starting with `/` is absolute from the root.** A path without a
  leading `/` is treated the same, as today.
- **Keep:** full `ws(s)://` URLs pass through, and `http(s)://` URLs,
  other schemes, empty input and garbage give `null`. Dropping the query
  is fine, since world addresses have none.
- **Update the existing tests,** and add the §2.8 table's cases as tests.
- **Teleports resolve against the current world's URL** (the connected
  record's `url`, reduced per the first bullet), never `accountWsBase`.
  So `/` on a pad in a world on B leads to B's commons, including for a
  visitor whose page came from A (§8).

**T7. Don't send the account display name to other servers.**
- **`AtriumClient` change (required, §2.8a):** separate the client's
  *local provisional name* from a *name to transmit*.
  - If `connect()` receives a `displayName`, behavior is unchanged: it's
    transmitted in `hello` and in the avatar's `extras.displayName`.
  - **If it receives none,** the client still uses `User-xxxx` internally
    (for logs and the avatar node's provisional name), but **omits
    `displayName` from `hello`** and puts **no** `extras.displayName` in
    the avatar descriptor before the server's `hello`.
  - After `hello`, `_onServerHello` adopts the server's name and writes it
    into the descriptor, as Step 6's F5 already does. So the avatar `add`,
    which is sent after `som-dump`, carries the server's name.
- **App rule:** the app passes `displayName` only when the destination's
  origin, converted to `http(s)` as in X#1/X#3, equals the account
  server's origin.
  - **Teleports:** by that rule.
  - **Manual Connect:** by that rule. That changes today's behavior, which
    transmits the account name to any server (§2.8a).
  - **Load and auto-connect:** always the account server, so unchanged.
- **Why:** Atrium servers already ignore the client's name (X#9 / F1), so
  nothing visible changes on them. A non-Atrium server reached by an
  automatic teleport (T0) or a manual connect never learns it.

**T8. Teleport execution and failure.**
- **Connect:** `trackConnect(url, { avatar: buildAvatarDescriptor(),
  displayName? per T7 })`.
- **Superseding:** a manual Connect, a Load or another teleport started
  meanwhile supersedes it quietly (X#5).
- **On failure,** the client is disconnected (X#6: no automatic return).
  It shows §7's message, which names the destination host without
  claiming a cause.
- **Add a one-click "Go back"** to that message. It reconnects to the
  world the teleport left (the URL captured when triggering) through the
  same `trackConnect` path. It's never automatic. X#6's reasons for no
  automatic return still hold; a button the user presses isn't automatic.
  If "Go back" fails too, show the ordinary failure message, without a
  second "Go back".
- **Harden `trackConnect`, two fixes:**
  1. Use `on` plus explicit cleanup for `session:ready` instead of `once`
     (§2.8), so a non-matching `session:ready` can't consume the
     listener.
  2. **Report supersession as a distinct outcome.** Resolve with
     `{ status: 'ready', … }` or `{ status: 'superseded' }` (or an
     equivalent), and **update every caller** (Load, manual Connect,
     teleports and "Go back") so a superseded operation does **no**
     success-side UI work: no clearing the overlay, and no re-enabling
     another operation's controls (§2.8a).

**T9. Server: reject duplicate node names, and check the parent before
ingesting.**
- **Duplicates, for every `add`:** any `add`, avatar or not, whose
  `node.name` already exists in the world gets `INVALID_VALUE` ("node name
  already exists"). Reusing an existing code avoids a change to
  `error.json`.
  - For avatar adds, the check runs after the identity checks
    (`msg.id`, `avatarNodeName`) and before ingesting. A session's first
    avatar `add` succeeds; a repeat is refused (§2.8a).
  - It also covers a non-avatar `add` using a live avatar's name, closing
    Step 6's noted gap.
- **Parent check:** `world.addNode` checks for the parent before
  `ingestNode`, so a failed `add` leaves nothing in the SOM.
- **Tests** for both, and for a teleporter node surviving an autosave, a
  teardown and a reload with its mesh and marker intact.

**T10. Server validation of the teleporter marker: none.**
- The server doesn't interpret or validate
  `extras.atrium.teleporter.destination`. Only owners can add or `set` it
  (in owned worlds), and every client validates at trigger time
  (`resolveWorldAddress` returning `null` means the pad is inert, and a
  warning is logged once).
- **Rejected alternative:** have the server check the syntax on `add` and
  `set`, e.g. a string of at most 2,048 characters that's a path or a
  `ws(s)://` URL. It would add a server copy of the rules for a modest
  gain.
- **Allowed:** the brief author may include a **length cap** alone, which
  is cheap and bounds document bloat (Q-length-cap).

**T11. Addendum §8 is completed as a doc commit in this task.**
- **Record in §8:**
  - T1's representation;
  - T2's `canPlaceTeleporters`;
  - T3's server echo;
  - T4's arming rule, and spawn at the origin;
  - T5's `y = 0` placement;
  - T7's name rule;
  - T8's "Go back";
  - T13's derived destination labels;
  - T5's spawn-point warning;
  - T0 (already recorded).
- **Adjust wording:** §8's "the existing worlds-list endpoint already
  supports this" stays true.
- **Status line:** mark Step 7 done at the end of the task, or in the
  shipped passdown, as for Step 6.

**T13. Each pad shows a destination label, derived from its destination.**
- **Purpose:** visitors can see where a pad leads *before* stepping on it.
  That gives an informed choice for cross-server pads without a prompt,
  complementing T0.
- **Text is derived from the stored destination, never written by the
  owner,** so a label can't misrepresent where a pad goes. It's computed
  by a pure helper, e.g. `teleporterLabel(destination, currentWorldUrl)`,
  using T6's resolution:
  - `/` → `Commons`;
  - a same-server path such as `/worlds/josh/garden` → `josh / garden`;
  - another server, such as `wss://b.example/worlds/ann/home` →
    `b.example · ann / home`. **The host is always shown for other
    servers.** "Other server" means the resolved destination's origin
    differs from the current world's;
  - another server's `/` → `b.example · Commons`;
  - anything T6 can't resolve → `invalid destination`, and the pad is inert
    (T4).

  The destination world's display *name* isn't fetched: that would need a
  request to the destination server, cross-origin for other servers.
  Slugs suffice. An optional owner caption could come later, but only
  shown *alongside* the derived text, never replacing the host.
- **Rendering: reuse `LabelOverlay`** (`apps/client/src/LabelOverlay.js`),
  which positions a DOM tag over a node each frame at a fixed 2.2 m
  above it:
  - add a **per-label height offset**, about 1–1.5 m for flat pads, with
    avatars staying at 2.2 m;
  - add a **distinct style** for pad labels (e.g. another color or a
    leading arrow), so a pad isn't mistaken for a person;
  - **middle-truncate** long labels to a maximum length, always keeping
    the host visible;
  - **keep `textContent`.** Destination strings are owner-controlled, so a
    label must never be inserted as HTML.
- **Lifecycle:** the same as T4's pad list. Labels are rebuilt from each
  new SOM (`som-dump`), follow `som:add`, `som:remove` and `som:set` of
  the marker, and are cleared on a world change, as avatar labels
  already are (`labels.clear()`, `app.js` ~L482). They show in static mode
  too, since they're informational, even though pads are inert there.
- **Distance fading or culling** is out of scope for now (§4).

**T12. Commit order (suggested).**
1. T6 and T8's `trackConnect` hardening: pure, with tests.
2. T9, server-side.
3. T2: protocol, then server, then client.
4. T3: the server echo, then `err.seq`, then the client's `addNode` and
   `removeNode`.
5. T1: the descriptor builder and the marker helper (`isTeleporter(node)`,
   `teleporterDestination(node)`), pure and tested.
6. T4: the trigger module and its wiring.
7. T7: the name rule.
8. T5: the UI.
9. T8: "Go back".
10. T13: the label helper (pure and tested), then the `LabelOverlay`
    changes, then wiring.
11. T11: the addendum.

## 4. Out of scope

- Repositioning or editing a placed pad (§8), and any general object
  placement or scripting (addendum out-of-scope list).
- Spawn points or arrival positions other than the origin. The arming
  rule (T4) makes the origin safe. A world-level spawn setting could be
  added later.
- Ground detection other than `y = 0`: terrain, multi-level worlds, or
  raycasting against world geometry.
- A destination directory or search (§8).
- Pre-flight checks that a destination exists or is reachable (§8: no
  upfront validation).
- Visual feedback for disarmed versus armed pads, and arrival effects.
  Nice to have, not required.
- Distance fading or culling of pad labels (T13), owner-written captions,
  and fetching destination world names for labels.
- The open pipeline follow-ups F-8, F-10 to F-14. F-12 (connect UX) is
  adjacent: teleports call `connect()` directly and don't use the Connect
  button.

## 5. Open questions for the brief author / critic

- **Q-radius:** `R`, `H` and the pad's visual size (T4, T1).
- **Q-length-cap:** whether to add T10's server-side length cap.
- **Q-harness:** as in Step 6, `apps/client` has no DOM harness. Keep T4's
  trigger, T6, T7's origin comparison and T1's helpers pure, so they're
  unit-testable. The UI goes on the manual and browser checklist.

## 6. Test expectations

Automated:

- **T6 `resolveWorldAddress`:**
  - every row of the §2.8 table gives the correct result: a bare origin, an
    origin with a path, `/`, and `https:` becoming `wss:`;
  - an `http:` origin becomes `ws:`;
  - an origin with a port keeps the port;
  - an IPv6 origin works;
  - full `ws(s)` URLs pass through;
  - `http(s)` URLs, empty input and garbage give `null`, without throwing.
- **T8 `trackConnect`:**
  - two tracked connects in quick succession: the first settles with
    `status: 'superseded'`, the second resolves `ready` on its own
    `session:ready`, and neither listener is consumed by the other's
    event;
  - rejection still happens on a matching `error` or `disconnected`;
  - **caller behavior:** a superseded Load or manual Connect doesn't clear
    the overlay or re-enable controls that the newer connect owns.
    Extract the caller logic into a testable function, or cover it on the
    manual checklist.
- **T9, server, per file and exiting on its own:**
  - a non-avatar `add` with an existing node name gets `INVALID_VALUE`, and
    nothing changes or is broadcast;
  - the same with a live avatar's name;
  - a session's second avatar `add` gets `INVALID_VALUE`, and the first
    avatar node is untouched;
  - an `add` with a missing parent gets `NODE_NOT_FOUND`, and the node isn't
    in the SOM afterwards;
  - a teleporter node survives an autosave, then a teardown and reload,
    with its mesh, its translation and `extras.atrium.teleporter`.
- **T2:**
  - protocol: `hello` with `canPlaceTeleporters` validates, and unknown properties are
    still rejected;
  - server: `canPlaceTeleporters` is true for the owner (same-origin,
    authenticated) of an owned world whose policy lets the owner mutate.
    It's false for an anonymous or other user, false for a cross-origin
    session carrying the owner's cookie (X#2), **false for the owner of a
    `'read-only'` world**, and false in ownerless worlds (the current
    `'open'`-world fixture is ownerless);
  - client: `canPlaceTeleporters` is exposed after `hello`, false when the server
    omits it, and **reset to false at the start of a replacement
    `connect()`**, before any event of the new connection. Test with owner
    world A, then a non-owner world B, where A's `disconnected` is
    suppressed.
- **T3, server:**
  - a successful non-avatar `add` reaches **the sender and** its peers;
  - a successful `remove` reaches the sender and its peers;
  - the avatar `add` still isn't echoed to its sender;
  - a refused `add` or `remove` produces only an `error` to the sender,
    carrying the request's `seq`, and no broadcast.
- **T3, client, with an injected socket:**
  - `addNode` sends `add` with no `id`, returns the `seq`, and **doesn't
    touch the local SOM**;
  - the echoed `add` then ingests it and emits `som:add` once;
  - `removeNode` works the same way;
  - an `error` for that `seq` leaves the SOM unchanged, and the emitted
    `Error` has `seq` and `code`;
  - both refuse before the current world is fully loaded: after
    `session:ready` but before `som-dump` is processed. They're accepted
    after it, and refused again right after a new `connect()` starts.
- **T1:** the descriptor validates against `add.json`. `isTeleporter` and
  `teleporterDestination` handle a missing, empty or non-string
  destination.
- **T4, pure trigger module:**
  - arriving inside a pad doesn't fire it; leaving and re-entering does;
  - a new pad under the avatar doesn't fire until it has been left and
    re-entered;
  - with two overlapping pads, the nearest fires;
  - after a trigger, nothing fires until reset;
  - it's inactive while "not ready" or "editing". "Ready" is the local
    avatar being ready, not `session:ready`;
  - the pads from a new SOM (after a world change) all start disarmed,
    including one containing the arrival point;
  - a pad added later starts disarmed;
  - an unresolvable destination is inert, with one warning;
  - boundary cases at exactly `R` and exactly `H`.
- **T5 spawn warning,** as a pure check, e.g. `nearSpawn(position, R)`:
  true at the origin and just inside `R` plus the margin; false just
  outside it; height ignored.
- **T13 `teleporterLabel`:**
  - `/` → `Commons`;
  - a same-server `/worlds/u/s` → `u / s`;
  - another server's URL → the host plus `u / s`, and another server's
    `/` → `host · Commons`;
  - a relative path in a world on B resolves against B (same-server
    label, no host);
  - a different port or scheme counts as another server;
  - unresolvable or garbage input → `invalid destination`;
  - truncation keeps the host;
  - it never throws.
- **T7:**
  - the app's origin comparison: same origin keeps the name; a different
    host, port or scheme omits it;
  - `AtriumClient` without `displayName`: `hello` has no `displayName`
    key, and the avatar descriptor has no `extras.displayName` before
    `hello`. After a `hello` carrying a name, the descriptor has the
    server's name, and so does the avatar `add` sent afterwards;
  - with an explicit `displayName`: behavior is unchanged.

Manual or browser acceptance on DEV. Use two separate browsers or profiles
for the multi-user checks (shipped passdown §3.9). `acctest1` and
`acctest2` are available for Hermes's browser tool.

- **Owner placement:**
  - as the owner (logged in, same-origin), the placement UI appears;
  - as another user, as anonymous, and as the owner of a read-only world,
    it doesn't;
  - while a world is still loading (between connecting and your avatar
    appearing), the control stays disabled;
  - place a pad pointing at another of your worlds, and one at `/`. Both
    appear for a second browser already in the world;
  - they survive a reload of the world, which exercises autosave.
- **Arming:** after arriving at the origin, place a pad under yourself.
  It doesn't fire until you step off and back on.
- **Spawn warning:** placing a pad near the origin shows the warning, and
  saving still works. Placing one farther away shows no warning.
- **Same-server teleport:** walk onto the pad and arrive in the destination
  world at the origin. The old world's occupants see you leave, and there's
  no flash of the disconnected UI. There's no bounce if the destination
  has a pad at its origin.
- **Commons:** a pad with `/` in a DEV world leads to DEV's commons.
- **Cross-server teleport** (needs only DEV deployed): a pad on DEV
  pointing at a PROD public world.
  - You arrive anonymous on PROD, as `User-xxxx`.
  - PROD saw no `displayName` in `hello` (T7). A PROD-side log line or a
    test hook confirms this. If that's impractical, rely on the automated
    test.
- **Visitor from another server:** from the PROD page, connect to a DEV
  world that has a pad with `/`, and walk onto it. You land in **DEV's**
  commons (T6), not PROD's.
- **Failures:**
  - a pad pointing at a missing world shows the message naming the host,
    plus "Go back", which returns you to the world you left;
  - a pad pointing at an unreachable host shows the same after the
    timeout;
  - on DEV (an `https:` page), a `ws://` pad fails immediately with a
    visible message (mixed content, §2.9).
- **Labels:**
  - each pad shows its derived label: `Commons`, `u / s`, or the host for
    other servers;
  - pad labels are visually distinct from avatar labels;
  - a label follows a pad being deleted, and is rebuilt after a world
    change;
  - a pad with a destination string containing HTML-like text shows it as
    literal text.
- **Deletion:** as the owner, delete a pad. It disappears for everyone, and
  it stays gone after a reload.
- **Refusal:** a non-owner can't add or remove pads through the UI. A
  forged `add` or `remove` from devtools is refused, and nothing changes
  locally or for peers (T3).
- **Owner status across world changes:** as the owner, go from your world
  to a non-owned world by teleport. The placement UI disappears
  immediately and doesn't flash back.
- **Superseded overlay:** start a Load, and immediately start another
  connect (a teleport or manual Connect). The second connect's
  "Connecting…" overlay stays until it's ready.
- **Regression:** Step 6's cross-server checks, and the worldload
  checklist, as a smoke test.
