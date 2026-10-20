# Design: Phase 3 — Object Placement and Scripting

Status: **Revision 1.2, 2026-10-19.**
- **Drafted 2026-10-11.** The operator settled all seven open questions on
  2026-10-12 (§10).
- **Revision 1** incorporates an outside review (ChatGPT, 2026-10-12) and
  Claude's checks of its claims against `main` `1f6d6f5`. §11 lists each
  finding and what was done with it. The decisions stand, with two
  refinements, to Q3 and Q4 (§10).
- **One finding was a live security issue.** It's split out as
  `devtasks/PREBRIEF-source-ref-guard.md` and **must ship before any Phase 3
  step** (§9, step 0).
- **Revision 1.1, same day:** applies a follow-up review (ChatGPT, verdict
  "architecturally ready for planning"). It covers cooperative script-host
  revocation, `.glb`-only pinning, a trust policy for `activate`, and
  rename error codes (§11.2). It also adds the Create-copies-commons fix
  (2026-10-09 passdown §4) as a prerequisite for step 1 (§9, step 0b).
- **Revision 1.2, 2026-10-19:** an operator decision changes §6's last
  paragraph. Copying objects from any world a visitor can see becomes its own
  step, with no `copyable` flag and with attribution on every copy
  (`devtasks/Atrium-Passdown-2026-10-19-copy-objects.md` §1). Nothing else
  changed.
- **Progress:** steps 0, 0b, 1 and 2 have shipped, followed by two Edit mode
  rounds (edit-tweaks and edit-polish-2, released at `229c4a87` on
  2026-10-19). **Next:** the step 3 pre-brief.

This doc scopes the next phase after Phase 2 (home worlds, the commons,
cross-server loading, teleporters), which finished with the Step 9 cleanup
release on 2026-10-03. It draws on four sources:

- **The 2026-10-10 brainstorm** of five future directions (§1).
- **The 2026-10-07/08 Teleport Studio comparison.** It tested live editing
  against `main` locally and on production (§2, §3).
- **The 2026-10-11 scripting discussion:** where scripts run, owner-only
  execution, sharing, and `KHR_interactivity`.
- **The 2026-10-12 review** and code checks (§11).

Read alongside `docs/DESIGN-user-objects.md`, which this doc partly
supersedes (§8), and `devtasks/ADDENDUM-user-accounts-phase2.md` §8
(teleporter placement, which is the pattern Part A generalises).

---

## 1. Where this sits

The 2026-10-10 brainstorm named five directions:

1. **Object placement, editing and movement.**
2. **Navigation history:** back, forward and rewind through a stored timeline
   of where a person has travelled.
3. **Scripting:** activating objects to run behavior, authored mainly
   graphically.
4. **Graphical context menus:** a right-click menu built out of objects and
   structures in the scene rather than flat text.
5. **Web data in worlds:** a browser surface in the scene at the modest end,
   automatic import of web data as scene objects at the ambitious end.

**Phase 3 covers 1 and 3.** Each depends on the other: scripts need objects
to attach to, and sharing scripted objects is the same job as sharing
objects. Items 2, 4 and 5 are recorded here so they aren't lost. Item 4
should reuse Part A's selection and Part B's event model when it's designed.

Phase 2 explicitly deferred both items ("General object placement beyond
teleporters" and "Any general visitor-interaction or scripting system").

---

## 2. What already exists (verified)

| Capability | Evidence |
|---|---|
| Live `add`, `send`/`set`, `remove`, broadcast to every visitor | Protocol schemas; tested end to end 2026-10-07 |
| Owner-only mutation gate (`open` / `owner` / `read-only`) | `session.js`; a non-owner and an anonymous visitor were both refused in the 2026-10-07 test |
| Autosave of owned worlds (30 s debounce, 60 s periodic, on owner disconnect) | `autosave.js`; edits were confirmed persisted locally and on production |
| A working property editor | `tools/som-inspector`; on production since 2026-10-08 (a Caddy `handle /tools/som-inspector/*` block was added) |
| A server-computed "may edit" flag | `hello.canPlaceTeleporters` = signed in **and** world owner **and** mutator (`session.js` ~L360) |
| Owner-facing placement UI pattern | Teleporter place/delete: `client.addNode(descriptor)`, metadata in `extras.atrium.teleporter` |
| Inline geometry on `add` | `add.node.mesh.primitives` (attributes, indices, material), ingested by `SOMDocument.ingestNode` |
| **Model references (limited)** | `extras.atrium.source` on a container node; `SOMDocument.ingestExternalScene` copies the referenced file's nodes into the SOM; the copies aren't saved. See §3.3 for the limits |
| Click → logical object | `@atrium/interaction` `nearestNonMeshAncestor` (the "lamp heuristic") |
| Synced animation playback state | `SOMAnimation.playback` (`playing`, `paused`, …), persisted in `extras.atrium.playback` |
| Error correlation | `error` messages carry the request `seq`; codes include `PERMISSION_DENIED`, `RATE_LIMITED`. Successful broadcasts don't (§3.7) |
| Other avatars' positions | `view` messages reach every client, including the owner's |
| A clock | `tick` message, 1000 ms default interval |

**The conclusion from 2026-10-08 still holds.** Owner-only live editing with
saving works end to end. Placement is mostly interface work, plus the small
protocol and SOM fixes in §3. Scripting needs a runtime, one new message
pair (§5.2) and very little other server machinery.

---

## 3. Findings that shape the design

1. **Unknown glTF extensions are dropped on load and save.** The server
   reads and writes worlds with `new NodeIO().registerExtensions([KHRLightsPunctual])`.
   - A test on 2026-10-11 confirmed it: a node carrying
     `extensions.ATRIUM_test` comes back without it ("Missing optional
     extension"), while `extras.atrium` survives.
   - `ingestNode` ignores `descriptor.extensions` even though the `add`
     schema allows it.

   **Consequence:** Phase 3 metadata goes in `extras.atrium.*`, as
   teleporters already do. Moving to real extensions (`ATRIUM_user_object`,
   `KHR_interactivity`) means writing glTF-Transform `Extension` classes and
   registering them in both the server and client IO, as a separate step
   (§6.4).
2. **`add` carries one node, not a subtree.** The schema has no `children`.
   This limits multi-part objects (§4.3) and undoing a delete (§4.5).
3. **`extras.atrium.source` exists, but it can't serve Phase 3's models.**
   This corrects the draft, which said there was no way to reference a
   model.
   - **Server side, it's a security hole.** In document worlds the server
     fetches owner-supplied `source` URLs with no limits (blind request
     forgery and memory exhaustion; verified 2026-10-12). The fix is
     `PREBRIEF-source-ref-guard.md`: document worlds never fetch, and **no
     client may set `source`**. From then on, `source` is reserved for
     operator-controlled file worlds.
   - **Client side, it's too limited:**
     - it's resolved only when a world first loads, not on a live `add` or
       `set` (`AtriumClient.resolveExternalReferences` ~L1044);
     - `ingestExternalScene` copies nodes, meshes and material colour
       factors only. There are **no textures, animations or skins**, so a
       textured library model would render flat, and a model's built-in
       animations couldn't play.

   **Consequence:** Phase 3 models use their own field,
   `extras.atrium.model`, resolved only by clients and rendered through a
   full glTF loader (§4.3).
4. **A refused edit looks accepted.** In the inspector, a refused change
   stays on screen, and the error only appears in the developer console.
5. **glTF-Transform 4.3.0 supports `KHR_node_visibility` but not
   `KHR_interactivity`.** Behavior graphs need our own `Extension` class (or
   storage in `extras`) and our own interpreter.
6. **`canPlaceTeleporters` is really "can edit this world".** It should be
   generalised rather than duplicated.
7. **Successful mutations can't be matched to their request.** The `set`,
   `add` and `remove` broadcasts get a fresh server `seq` (`nextSeq()`). `set`
   carries the sender's `session`, but nothing identifies *which* request
   succeeded. Errors do carry the request `seq`. (Review, confirmed.)
8. **Renaming a node corrupts SOM lookups.**
   - `SOMNode.name`'s setter renames the glTF node but doesn't update
     `_nodesByName` or `_objectsByName`.
   - The node's dispose callback captured the old name, so after a rename
     the delete cleans up the wrong key.
   - The server's `setField` doesn't check that the new name is unique.

   (Review, confirmed.)
9. **Externally loaded nodes aren't saved.** Nodes created by
   `ingestExternalScene` exist in the SOM but are filtered out of the
   `som-dump` and out of saves (`externalNodeNames`). Edits to them would
   silently not persist. (Review, confirmed.)

---

## 4. Part A — Placement and editing

### 4.1 Edit mode in the main client

An owner-only **Edit** toggle in `apps/client`, shown when `hello.canEdit`
is true. The inspector stays a developer tool. Edit mode offers:

- **Select:** click resolves through `nearestNonMeshAncestor`, and the
  selection is outlined.
- **Move, rotate, scale with on-screen handles.** three.js `TransformControls`
  is the obvious candidate, used in `renderer-three` or the app shell, not in
  `@atrium/interaction` (which stays mechanism-free).
  - Grid and angle snapping.
  - While dragging, update locally. Send `send` at most about 10 per second,
    plus once on release.
- **A small property panel** for position, rotation, scale, visibility and
  name, reusing the inspector's `PropertySheet` logic where practical.
  Renaming needs the fix in §4.8 first.
- **Delete and duplicate.**

**Every world node is editable** (decided 2026-10-12, §10 Q3). That
includes nodes that came with the world (ground, default scene) and
teleporters, as well as objects placed in Edit mode. There are two
exceptions:

- **Avatars.** Avatars are live visitors, not world content, so Edit mode
  can't select them. The server currently accepts an owner's `send` to
  another visitor's avatar node (only `extras.displayName` is protected,
  `session.js` ~L473). The edit would fight the visitor's own movement
  updates, so the server should also refuse owner mutations of avatar nodes
  that aren't the owner's own.
- **Externally loaded nodes** (§3.9), and the parts inside a model placed
  through `extras.atrium.model` (§4.3). They aren't saved world content.
  Selecting one selects the object that references it.

Also:

- **Teleporters** can be moved, rotated and deleted like anything else.
  Their destination is still edited through the teleporter form, which
  keeps its validation (Phase 2 §8).
- **Deleting a node the world came with** (the ground, say) asks for
  confirmation. Deleting a node that has children also warns that the
  delete can't be undone yet (§4.5).

### 4.2 Primitives first (no server changes)

An **Add** palette with a cube, plane, sphere, cylinder and ramp, generated
as inline `mesh` descriptors with a default material. These work today
through `add`, exactly like a teleporter pad. This gives "build something"
before any model loading exists.

### 4.3 Models by URL

```
extras.atrium.model = {
  url:    "/assets/library/chair-01.glb",   // server-relative or https://
  sha256: "…",                              // optional: pins the content (below)
  bounds: [x, y, z]                         // optional, for placement before load
}
```

- **A separate field from `source`.** After the security fix, clients can
  never set `extras.atrium.source` (§3.3), and the server never fetches
  `extras.atrium.model`. Keeping the two apart keeps that guard simple and
  permanent.
- **The client fetches the model and renders it as that node's visual,
  through a full glTF loader** (three.js `GLTFLoader` or
  `@gltf-transform/view` over the whole file). That gives textures,
  animations and skins.
  - The model is **not** ingested into the world's SOM or saved in the
    world document. That keeps world documents small, lets fixes to a model
    file reach every world that uses it, and avoids the single-node `add`
    limit (§3.2).
  - The existing `source` loader's fetch and stale-world handling
    (`_worldGen`) can be reused, but not `ingestExternalScene`.
  - **Resolution is live:** on world load, and whenever an `add` or `set`
    creates or changes `extras.atrium.model`.
- **Parts inside a model** (decided 2026-10-12, §10 Q4):
  - **Phase 3:** scripts address the placed object as a whole, and can
    play the model's own built-in animations by name (a door that opens, a
    lid that lifts). Play state is stored on the placed node, for example
    `extras.atrium.model.playback`, and synced the way
    `SOMAnimation.playback` is. Each client renders the frames itself.
  - **Later, if needed: named-part overrides.** The placed node stores
    small changes to parts, for example
    `extras.atrium.model.overrides = { "Door": { rotation: [...] } }`, and
    each client applies them after loading the model.
  - **Ingesting models into the world's SOM is rejected** (bloat, stale
    copies, subtree `add`).
  - Trade-off: in Phase 3, a model with no built-in animations can only be
    moved or animated as a whole.
- **Any `https://` URL is allowed** (decided 2026-10-12, §10 Q5), as well
  as server-relative paths, which are resolved against the world's own
  server as teleporter destinations are. `http://` and other schemes are
  rejected.
  - **Visitor privacy:** each visitor's browser fetches the model directly,
    so its host sees visitors' IP addresses and visit times, as with images
    on a web page. Document this for owners and visitors. A server-side
    fetch-and-cache is a possible later option. It would need the address
    and size rules the security fix lacked, so it isn't an open proxy.
  - Model content is the owner's responsibility, as teleporter destinations
    are.
- **Limits** (required, because any URL is allowed and public worlds load
  models automatically):
  - **Download:** a size cap (proposed 25 MB per model), enforced by
    aborting the download partway rather than trusting `Content-Length`.
    The cap counts everything a `.gltf` pulls in (its separate buffers and
    textures).
  - **Decoded** (review §9): a compressed file can expand far beyond its
    download size, so check after parsing and before upload to the GPU.
    Proposed caps:
    - a vertex count (500k per model);
    - texture dimensions (4096 px per side);
    - a total estimated texture memory per world (256 MB).

    Exact GPU memory can't be measured, so these are proxies.
  - **Per world:** a total download budget and a load timeout.
  - **Failure:** a visible placeholder when a load fails or is refused,
    with the reason in the owner's view.
- **Mutable vs pinned models** (review §9):
  - **Without `sha256`, the model is mutable.** It shows whatever the URL
    serves, so visitors loading at different times can see different
    versions.
  - **With `sha256`, it's pinned.** A mismatch is refused, and the
    placeholder says so.
  - **In Phase 3, only self-contained `.glb` files can be pinned** (follow-up
    review B). A `.gltf` that references separate buffers or textures could
    keep the same root-file hash while those files change.
    - `sha256` on a multi-file `.gltf` is refused when it's set.
    - A manifest that hashes every dependency is a possible later addition.
  - Library items are self-contained `.glb` files and are pinned. Pasted URLs
    default to mutable, with a "pin current version" action for `.glb`
    files.
  - Caching follows the browser's HTTP cache. Pinned content may also be
    cached by hash.
- **CORS:** cross-origin models load only if their host sends CORS headers.
  Hosting copies on our own server (§4.4) avoids this for the library.
- **No server change is needed beyond persistence.** `extras` already
  round-trips. Optionally, the server could check the URL scheme of
  `extras.atrium.model.url` on `add` and `send`, mirroring teleporter
  destination checks.

### 4.4 Starter library

A static catalogue, for example `assets/library/catalog.json`, listing name,
thumbnail, model URL, `sha256`, licence and attribution, with the files
themselves hosted by us:

- **Poly Haven** models, plus HDRI images for sky backgrounds, are all
  CC0. Host copies rather than linking to their URLs.
- The **Hubs/Spoke architecture kit**'s licence is unverified. Check it
  before including anything from it.
- Start with 20 to 30 hand-picked items. Upload and API-driven browsing come
  later.

Skies need a world-level setting, such as `extras.atrium.environment`,
that the renderer reads. This is small, but it's new.

### 4.5 Undo and redo

A client-side stack in the owner's session.

- **Only confirmed edits enter the stack** (§4.6). A refused edit is
  reverted, not recorded.
- **One gesture is one entry.** A drag records its start and end values,
  not every intermediate `send`.
- **Each entry records its inverse:**
  - for `set`, the previous value;
  - for `add`, a `remove`;
  - for `remove`, the descriptor to re-add, **only for a node without
    children**. Deleting a node with children isn't undoable in Phase 3,
    because `add` can't restore a subtree (§3.2). The UI warns before such
    a delete (§4.1). A subtree `add` is a possible later protocol change.
- **The stack is cleared on reconnect or world change.** After a reconnect
  the client reconciles against the fresh `som-dump` instead of guessing.

Undo sends the inverse through the normal pipeline. No server history is
kept. A world-level edit history is a possible later feature, related to the
navigation-history idea (§1 item 2) but separate from it.

### 4.6 Edit confirmation (`requestSeq`)

Matching results to requests needs a small protocol addition (§3.7):

- **Successful broadcasts carry `requestSeq` and `session`.** Each `set`,
  `add` and `remove` broadcast that results from a client request carries
  the request's `seq` as `requestSeq`, plus the requester's `session`
  (`add` and `remove` don't carry `session` today). The server's own `seq`
  is unchanged. This needs schema updates in `@atrium/protocol`, since the
  schemas set `additionalProperties: false`.
- **The client tracks each edit as one of four states:**
  - *pending*;
  - *accepted*: a broadcast with its own `session` and `requestSeq`;
  - *rejected*: an `error` with the matching `seq`. The client reverts the
    change and shows a message;
  - *unknown*: the connection was lost before an answer. The client
    reconciles against the next `som-dump`.
- **This applies to the inspector too.**

### 4.7 Capability flag

`hello` gains `canEdit`, with the same computation as `canPlaceTeleporters`.
`canPlaceTeleporters` is kept as an alias for one release, then removed.

### 4.8 Atomic rename

Before Edit mode allows renaming (§3.8):

- `SOMDocument` gains a `renameNode(oldName, newName)` that:
  - checks uniqueness;
  - renames the glTF node;
  - moves the `_nodesByName` and `_objectsByName` entries;
  - updates the dispose callback, which must look up the node's *current*
    name rather than one captured at registration.
- `SOMNode.name`'s setter goes through it.
- The server refuses a duplicate name with `INVALID_VALUE`.
  - **This takes an explicit path** (follow-up review, §3). Today `setField`
    catches every error from `som.setPath` and returns `INVALID_FIELD`
    (`world.js` ~L93–101, ~L271–276), so a thrown "duplicate name" would
    come out as the wrong code.
  - Either `setField` handles the `name` field itself, through
    `renameNode`'s return value, or `renameNode` throws a typed error that
    `setField` maps to `INVALID_VALUE`.
  - The step 1 brief must pick one and test the code that reaches the
    client.
- **Regression tests:** rename then mutate, rename then delete, rename then
  save and reload, and rename to an existing name.

### 4.9 Object identity

Names are the protocol's identifiers today. They're unique, but they change
on rename and collide on duplicate or import (review §3). Behaviors need
something stabler:

- **`extras.atrium.objectId`:** a UUID per object, assigned on `add` by the
  placing client, and assigned lazily to existing nodes the first time a
  behavior references them.
  - The server refuses an `add` or `set` that would duplicate an existing
    `objectId`.
- **Behaviors refer to objects by `objectId`.** The script runner resolves
  an id to the current name when it sends, because the wire protocol stays
  name-based.
- **Duplicate and import assign new ids** and remap every reference inside
  the copied behaviors.
- **The UI shows names.** Ids never appear to owners.

This must be settled before step 4 (scripting) and step 7 (sharing). It can
be implemented in step 4.

---

## 5. Part B — Scripting

### 5.1 Two layers, one engine

| Layer | For | Shareable? |
|---|---|---|
| **Behavior graphs** (a subset of `KHR_interactivity`) | Graphical authoring; the main, portable format | Yes. No arbitrary code. Authority is scoped (§5.3) |
| **JavaScript** | Owners who want real code in their own worlds | Not until the sandbox is hardened (§7) |

Both drive the same **script API** (§5.3). The engine is written once.

**Order (decided 2026-10-12, §10 Q1): graphs first, then the graphical
editor, with JavaScript last.** This fits the graphical-authoring goal and
puts the layer that can't run arbitrary code first. To make behaviors
usable before the editor exists, step 4 ships a few ready-made behavior
templates (§5.5).

`KHR_interactivity` and its companions `KHR_node_selectability`,
`KHR_node_hoverability` and `KHR_node_visibility` are ratified by Khronos
(listed as ratified in the glTF extension registry, checked 2026-10-11).
Babylon.js and the Khronos glTF Sample Viewer play them back. three.js
isn't listed, which matters little, because Atrium interprets graphs against
the SOM rather than the renderer.

### 5.2 Where scripts run: owner-only, in the owner's browser

- **Scripts run only in the script host** (below), an owner session whose
  `hello` says `canEdit`. Their effects go out as ordinary `send`, `add`
  and `remove` messages, pass the owner gate, and reach every visitor.
  - No server sandbox is needed in Phase 3.
  - The protocol additions are the script-host messages and `activate`,
    both below.
- **Visitors' clients never execute scripts.** They do receive the source
  in the `som-dump`, so script text in a public world is visible to its
  visitors. This is accepted (decided 2026-10-12, §10 Q6), in the same
  spirit as a web page's JavaScript being readable. Document it for
  owners, so nobody puts secrets in a script.
- **Visitors can trigger behaviors while the owner is present** (review §1).
  Without this, a visitor couldn't press a scripted switch even with the
  owner online.
  - **`activate`, client to server:**
    `{ "type": "activate", "seq", "node", "event": "select" }`. Any session
    may send it, including anonymous visitors.
  - **The server validates it** and grants no edit rights:
    - the node exists;
    - it has an enabled `extras.atrium.behavior` that listens for `select`;
    - the sender is close enough (the trust policy below);
    - the session and the world are within their rate limits;
    - a script host exists.

    Otherwise it answers with an `error`.
  - **Trust policy: what `select` means** (follow-up review C; proposed,
    confirm in the step 4 pre-brief). Without a rule, any client could
    activate any scripted object, even one it isn't near.
    - **`select` means "a visitor standing near this object asked to
      activate it."** It isn't proof of a real click, since the server can't
      know what the visitor's screen showed.
    - **The server enforces distance.** It refuses `activate` unless the
      sender's avatar is within the behavior's `maxDistance` of the object.
      The default is 10 m, and an owner can set it per behavior, including
      "any distance".
      - The server already keeps each avatar node's position up to date
        from `view` messages (`session.js` ~L625).
      - The world API has `getNodeTranslation`.
    - **Two rate limits.** 5 per second per session, and a world-wide cap
      (proposed 20 per second), because many sessions could multiply a
      per-session limit. Over the cap, the server returns `RATE_LIMITED`.
    - **Line of sight isn't checked.**
  - **The server forwards it** to the script host, as
    `{ "type": "activate", "node", "event", "from": <session id> }`. The
    host runs the behavior, and its effects go out as the owner's normal
    mutations.
  - **`enter` and `exit` need no message.** The script host already receives
    every avatar's position through `view`. It evaluates proximity itself,
    at the precision of those updates.
  - **Only `select` is forwarded in Phase 3.** `hover` and visitor-side
    `change` events aren't.
  - **The owner's own clicks** stay local when the owner is the script
    host. From another owner tab, they go through `activate` like a
    visitor's.
- **One runner per world: the server assigns a script host** (decided
  2026-10-12, §10 Q2). If the owner has two tabs or devices connected,
  only one session may run scripts, or every behavior would happen twice.
  - **Assignment:** the earliest connected owner session (one that passes
    `isMutator` and is the world owner) gets `scriptHost: true` and a
    `hostGen` number in `hello`. Every other session gets `false`.
  - **Handover:** when the script host disconnects and another owner
    session remains, the server increments `hostGen` and sends that session
    `{ "type": "script-host", "active": true, "hostGen": n }`. That session
    starts the runner. This needs a new schema in `@atrium/protocol`.
  - **Revocation:** if the server ever moves the role away from a connected
    session, it sends that session `{ "active": false, "hostGen": n }`. The
    runner **stops immediately**: it cancels timers and drops queued
    writes.
    - Today the role only moves on disconnect. The server rejects a
      duplicate live session id (`SESSION_CONFLICT`, `session.js` ~L310)
      rather than replacing the old session. Revocation is specified now so
      that later operator or failover moves can't leave two runners active.
    - The server forwards `activate` only to the session holding the
      current `hostGen`.
    - **Revocation is cooperative in Phase 3** (follow-up review A). Script
      writes are ordinary owner `send`, `add` and `remove` messages without
      `hostGen`. So the owner gate would still accept writes from a revoked
      runner that ignored the revocation. That's acceptable while the role
      only moves on disconnect and the runner is the owner's own browser.
    - **Server-enforced revocation would need script-originated writes to
      be marked** (for example a `hostGen` field the server checks), so it
      can refuse stale ones without affecting manual edits. That's needed
      before any non-disconnect role move ships.
  - **Crashed or stalled runners** in a connected session aren't detected in
    Phase 3. A heartbeat isn't worth it while the host is the owner's own
    browser. The owner reloads.
  - **No duplicate on reconnect:** the role is held by session, so a
    second owner tab that connects later never receives it while the first
    is connected.
  - The runner starts fresh on handover. Pending timers from the old host
    are lost, which is acceptable in Phase 3.
  - **Tests:** two tabs, handover on close, the host reconnecting (it must
    not get the role back while another owner session holds it), and an
    `activate` arriving during handover.
  - This becomes unnecessary once scripts can run on the server (§7,
    item 2).
- **Accepted limitation: behavior runs only while the owner is present.**
  With no script host, `activate` is refused and nothing runs. Lifting this
  is §7, item 2.
  - This is most visible in **the commons**, which is shared and public but
    scripted only while its operator-owner is connected. Server-side
    execution matters most there.

### 5.3 Script API (the stable contract)

Scripts never touch `AtriumClient`, the SOM or the DOM directly. The
proposed surface:

```
get(object, field)            → value
set(object, field, value)     → goes out as `send`; rate-limited
add(descriptor) / remove(object)
play(animation) / stop(animation) / pause(animation)   → SOMAnimation.playback
play(object, modelAnimationName) / stop(…)             → a referenced model's own animations (§4.3)
on(event, object?, handler)   // 'select', 'enter', 'exit', 'change', 'frame'
after(ms, fn) / every(ms, fn)
log(...args)                  → the owner's diagnostics view
```

- **Objects are referenced by `objectId`** (§4.9). References are
  path-ready: `objectId` alone now, `objectId/Part` later for named-part
  overrides (§4.3). Phase 3 refuses subpaths.
- **Events:**
  - `select` comes from a local click or a forwarded `activate` (§5.2). It
    corresponds to `KHR_node_selectability`.
  - `enter` and `exit` generalise `teleport-trigger.js`, evaluated by the
    host against avatar positions.
  - `change` uses SOM `mutation` events.
  - `frame` runs at most once per rendered frame on the script host. This
    matches `KHR_interactivity`'s `event/onTick` ("at most one tick per
    rendered frame", spec §event/onTick; review §8).
  - For slower logic, use `every(ms)`. The server's `tick` message isn't a
    script clock.
- **Writes are rate-limited and coalesced.** Per-frame logic can't stream
  motion to visitors: the runner coalesces writes per field and sends at
  most 20 per second per world. The server's `RATE_LIMITED` error remains
  the backstop.
- **Continuous motion never goes over the network.** For smooth motion,
  scripts start and stop glTF animations, which syncs only the `playback`
  state, while each client renders the frames itself.
- **Authority is scoped** (review §7). "Can't run arbitrary code" isn't the
  same as "can't do harm". A behavior can still move, hide or delete
  things within its allowed operations. So:
  - **By default, a behavior may only write to its own object and that
    object's descendants.**
  - **Other targets must be granted** in
    `extras.atrium.behavior.targets` (a list of `objectId`s). The owner
    grants them in the template form or the editor, and sees the list
    before enabling an imported behavior (§6).
  - `add` and `remove` are limited to the behavior's own subtree.
  - **Resource limits apply to every behavior:** steps per event, pending
    delays, writes per second and variable memory. Graphs and JS alike.
- **This API is the permission boundary later on.** Server-side execution,
  shared objects and visitor-only triggers (§7) all reuse it unchanged.

### 5.4 Storage and the graph format

```
extras.atrium.behavior = {
  kind:    "graph" | "js",
  graph:   { … },        // a standard KHR_interactivity graph object (kind "graph")
  nodeMap: ["<objectId>", …],  // standard node index → Atrium objectId
  js:      "…",          // JS text (kind "js")
  targets: ["<objectId>", …],  // granted write targets beyond its own subtree (§5.3)
  enabled: true,
  origin:  "local"       // or the URL it was imported from (§6)
}
```

- **The standard representation is kept as-is** (review §8). `graph`
  holds one graph in `KHR_interactivity`'s own JSON shape: `types`,
  `variables`, `events`, `declarations` and `nodes`, with their sockets and
  configuration. It isn't an Atrium-specific format "inspired by" the
  standard. In a standard file these graphs sit in a root-level
  `extensions.KHR_interactivity.graphs` array.
- **Node references are the one translation.** A standard graph refers to
  scene nodes by index, through JSON-pointer templates such as
  `/nodes/{index}/translation`, where `index` is a value supplied at
  runtime. Atrium resolves index *i* through `nodeMap[i]` to an `objectId`,
  and then to the current name. On import and export, the converter
  rewrites between file indices and `nodeMap`.
- **Converting a whole standard file is loss-aware.** It splits the file's
  graphs into per-object behaviors and **reports** anything it can't map,
  such as pointers to materials or cameras outside the subset. It never
  silently drops them.
  - Graphs exported from Unity with Needle's exporter come in through this
    converter, not by pasting into a per-object field.
- **Per node, in `extras`,** so it persists and syncs with no format work
  (§3.1). Moving to a real `KHR_interactivity` extension is §6.4.

### 5.5 Behavior-graph interpreter and templates (step 4)

- **Evaluate before writing.** Khronos's
  **glTF-InteractivityGraph-AuthoringTool** (React, Apache-2.0) has a
  behavior engine that's separate from its editor, plus tests run against
  the Khronos test assets. Before writing an interpreter from scratch,
  check whether its engine can run against Atrium's script API instead of
  Babylon. The answer decides how big step 4 is.
- **Implement a subset of `KHR_interactivity`:**
  - events: `event/onStart`, `event/onTick` (mapped to `frame`), and
    `event/onSelect` from the companion `KHR_node_selectability`;
  - flow: sequence, branch, delay;
  - math;
  - pointer get and set, mapped onto the script API through `nodeMap`.
- **Unsupported operations are reported, not hidden** (review §8). When a
  behavior is loaded or enabled, the owner sees a list of its unsupported
  nodes, and the behavior is marked *partially supported*.
  - At runtime, an unsupported node does nothing, as the spec's graceful
    degradation allows.
  - Owners always know when that's happening.
- **The interpreter runs on the main thread, not in a Worker.** Graphs
  can't run arbitrary code. The resource limits in §5.3 stop runaway graphs.
- **Test against the Khronos `glTF-Test-Assets-Interactivity` files,**
  restricted to the subset.
- **Behavior templates** make step 4 usable before the editor exists. They
  are a handful of ready-made graphs with a few parameters, attached
  through a simple form in the Edit mode property panel. The form also sets
  `targets`. For example:
  - on select, show or hide a target;
  - on select, play or stop an animation (the object's own, or a
    referenced model's);
  - on enter, play an animation; on exit, stop it;
  - on select, toggle a light;
  - every N seconds, play an animation.

  A template is stored as an ordinary graph, so the editor (step 5) can
  open and extend it later.
- **Advanced owners can import graph JSON** through the converter in §5.4.

### 5.6 Graphical editor (step 5)

A node-and-wire editor for behavior graphs is the end goal, and it's what
"presented primarily graphically" asks for. It's the largest single piece
of work in this doc. It needs:

- a palette of the supported node types;
- wiring and parameter fields;
- a `targets` view;
- the unsupported-node report;
- a log or trace view for debugging.

**The Khronos authoring tool (§5.5) is the first candidate to adapt** before
building one. Needle's Unity exporter and Amazon's prototype tool are prior
art too. Whether the editor itself should be in-world, built from scene
objects as context-menu idea §1.4 suggests, is an open question.

### 5.7 JavaScript runner (step 6)

- Runs in a **Web Worker** created from a blob, with the API bridged over
  `postMessage`. A buggy or looping script can't freeze the page, and the
  runner can terminate it after a CPU-time budget.
- **Network access is removed before any user code runs:** `fetch`,
  `XMLHttpRequest`, `WebSocket`, `importScripts`, `EventSource`, plus a
  restrictive CSP if workers inherit it in practice.
  - Deleting globals is **not airtight**. It's acceptable for an owner's own
    code. It isn't enough for other people's code: that needs a real
    interpreter boundary such as QuickJS compiled to WebAssembly (§7).
- The same authority scoping and resource limits apply (§5.3).
- An owner-facing code editor (a code area, a log pane, enable/disable)
  sits in the Edit mode property panel. It's the escape hatch for
  behaviors that graphs can't express.

---

## 6. Part C — Sharing objects (the bridge)

1. **Two export modes** (review §10):
   - **Atrium object package:** a compact `.gltf` with the object's node,
     its `extras.atrium.model` reference (not the model itself), primitives,
     behaviors with their `nodeMap` and `targets`, and instance properties.
     It's small, and other Atrium worlds can use it directly. Other viewers
     won't fetch the referenced model.
   - **Portable glTF:** a `.glb` that embeds the model's geometry,
     materials and textures, plus behaviors as a standard
     `KHR_interactivity` extension (§6.4). It's larger, and other glTF
     viewers can use it.
2. **Import by URL or file** into your own world, through the same placement
   flow as a library item. Imported objects get new `objectId`s, with every
   reference remapped (§4.9).
3. **Behavior arrives disabled.** The owner sees:
   - that the object has a behavior, and can read it;
   - its granted `targets`, which on import are limited to the object's own
     subtree until the owner widens them;
   - any unsupported operations.

   Then the owner can enable it:
   - graphs under §5.3's authority and resource limits;
   - JS from elsewhere only once the hardened sandbox exists (§7, item 1).
4. **Real extensions:** at this point, writing glTF-Transform `Extension`
   classes for `KHR_interactivity` (and `ATRIUM_user_object`, §8) becomes
   worthwhile. Portable exports are then readable by other viewers, and
   imported standard files readable by Atrium.

"Copy this object" while visiting someone else's world: **changed by the
operator on 2026-10-19** (`devtasks/Atrium-Passdown-2026-10-19-copy-objects.md`
§1). Copying from any world a visitor can see becomes its own step, likely
after step 3 and the richer `add`, with **no `copyable` flag**: a visitor
already holds everything a flag would protect, so the UI says plainly that
visitors can copy, and visibility is the real control. Copies carry
attribution: an `origin` fixed at the first copy, plus the most recent
`copiedFrom`.

---

## 7. Deliberately later

1. **A hardened JS sandbox** (QuickJS in WebAssembly, or an iframe with a
   separate origin), before imported JS can run.
2. **Behavior while the owner is away.** The server runs behaviors itself,
   with the owner's authority, in a server-side sandbox, and `activate` is
   handled there instead of being forwarded. Graphs first, since they can't
   run arbitrary code. (Visitor `activate` while the owner is present is
   now in step 4.)
3. Model **upload** and storage quotas; a restricted server-side model
   cache (§4.3).
4. A shared or community object library.
5. Collaborative editing (several editors in one world) and per-world
   editor roles.
6. Whole-world import (a world document from outside).
7. A subtree `add`, which would make deleting multi-part objects undoable
   (§4.5).
8. Script-host health checks and heartbeat (§5.2).

---

## 8. Relationship to `DESIGN-user-objects.md`

That brief predates `KHR_interactivity`'s ratification and findings §3.1 to
§3.3. Recommended revisions:

- **Keep** `ATRIUM_user_object` for what's Atrium-specific: typed objects,
  instance properties, multiplayer authority and instancing. The behavior
  authority model (§5.3, `targets`) should fit into its authority design.
- **Replace** its `onchange` script handlers with behavior graphs and the
  script API (§5). Its open question 3 ("script execution context") is
  answered for Phase 3 by §5.2.
- **Note** that it requires a registered glTF-Transform `Extension` class
  before it can survive a save (§3.1). Until then, Phase 3 uses `extras`.

---

## 9. Proposed step sequence

Each step ships on its own and is useful by itself.

| Step | Scope | Server / protocol change |
|---|---|---|
| **0** | **Security fix: `devtasks/PREBRIEF-source-ref-guard.md`.** Document worlds never fetch `source`; clients can't set it | Server only |
| **0b** | **Create stops copying the live commons** (2026-10-09 passdown §4; operator decision pending, option B recommended there: start new worlds from a fixed template). Needed before step 1, because Edit mode on the commons (§10 Q7) would push every commons edit into every world created afterwards | Server only (`POST /api/worlds`) |
| 1 | Edit mode (select, handles, property panel, delete, duplicate); primitives palette; edit confirmation and refused-edit feedback (§4.6); atomic rename (§4.8); `canEdit`; avatars and external nodes excluded | `hello.canEdit`; `requestSeq` and `session` on `set`/`add`/`remove` broadcasts (schemas); rename uniqueness; refuse owner edits to other visitors' avatars |
| 2 | Undo and redo (confirmed edits only, gesture = one entry, no undo for deleting nodes with children) | None |
| 3 | Models by URL (`extras.atrium.model`, full loader, live resolution, download and decoded limits, pinned or mutable); starter library (CC0, pinned); sky setting | Optional URL scheme check; static hosting of `assets/library` (Caddy) |
| 4 | Script API and engine; `objectId` (§4.9); authority scoping and resource limits; events `select`, `enter`/`exit`, `frame`, `change`; animation play/stop; behavior-graph interpreter (`KHR_interactivity` subset, standard representation, `nodeMap`, unsupported-node report), after evaluating the Khronos engine; templates; graph import converter | `hello.scriptHost` and `hostGen`; `script-host` message (handover and revocation); `activate` (visitor → server → host; distance check, per-session and world-wide rate limits); `objectId` uniqueness; schemas for all three |
| 5 | Graphical behavior editor (evaluate adapting the Khronos authoring tool first) | None |
| 6 | Owner-only JavaScript in a Web Worker, with a code editor | None |
| 7 | Object export (Atrium package and portable glTF) and import; id remapping; disabled-until-enabled behavior with a `targets` review; glTF-Transform extension classes | IO registration |

Steps 0 and 0b are prerequisites. Steps 1 to 3 are placement and 4 to 6 are
scripting. Step 7 is the bridge into sharing, and §7's items are candidates
for a Phase 4.

---

## 10. Decisions

All seven were decided by the operator on 2026-10-12. Revision 1 refines
Q3 and Q4 without changing their intent.

1. **Graphs or JS first. Decided:** graphs first, with templates to make
   them usable before the editor (step 4). Then the graphical editor
   (step 5), then owner-only JavaScript (step 6). JS-first would have
   shipped a usable behavior sooner, but only for owners who write code
   (§5.1).
2. **One script runner per world. Decided:** the server assigns a script
   host, with handover when it leaves (§5.2). Revision 1 adds `hostGen`,
   revocation, and forwarding `activate` only to the current host.
3. **What's editable in Edit mode. Decided:** every world node, avatars
   excepted (§4.1). *Refined in Revision 1:* externally loaded nodes and
   the parts inside placed models are also excluded, since they aren't
   saved world content. Selecting one selects its object.
4. **Model internals. Decided:** in Phase 3, scripts address the whole
   placed object and can play the model's built-in animations. Named-part
   overrides come later if needed, and models are never ingested into the
   world's SOM (§4.3). The API is path-ready (§5.3). *Refined in
   Revision 1:* models use `extras.atrium.model`, rendered by a full glTF
   loader, not the existing `source` mechanism. That mechanism copies no
   textures or animations, and clients can't set it after step 0 (§3.3).
5. **Model hosting. Decided:** any `https://` URL is allowed, with size,
   time and per-world limits and the visitor-privacy note (§4.3).
   Revision 1 adds decoded-size limits and pinned vs mutable models.
6. **Script source visibility. Decided:** visitors to a public world may
   read its scripts. Scripts stay in the `som-dump` (§5.2).
7. **Commons. Decided:** Edit mode and scripting are available to the
   commons' operator-owner.
   - No server change is needed: in its normal `owned` mode the commons is
     owner-gated, so the operator already passes `isMutator` and would get
     `canEdit`.
   - In a degraded read-only boot (`commons.js`), `isMutator` refuses every
     edit, so Edit mode stays off.
   - The owner-presence limitation applies (§5.2).

---

## 11. Review log (2026-10-12)

### 11.1 First review

The outside review's findings, checked against `main` `1f6d6f5`:

| # | Finding | Check | Disposition |
|---|---|---|---|
| 1 | Visitors can't trigger behaviors even with the owner present | Design gap; no code to check | Accepted: `activate` in step 4 (§5.2). `enter`/`exit` computed by the host from `view`, so no message |
| 2 | Success broadcasts can't be matched to requests | **Confirmed** (`nextSeq()` on `set`/`add`/`remove`) | Accepted: `requestSeq` and `session`, step 1 (§4.6) |
| 3 | Names aren't stable identities | Confirmed by design | Accepted: `objectId` (§4.9), before step 4 |
| 4 | Rename leaves SOM lookups stale; no uniqueness check | **Confirmed** (`SOMNode.name` setter, the dispose closure, `setField`) | Accepted: atomic rename, step 1 (§4.8) |
| 5 | Subtree delete can't be undone; generated nodes aren't saved | **Confirmed** (`add` schema; `externalNodeNames`) | Accepted (§4.1, §4.5). **Checking it found the `source` security issue** (step 0) and the loader's missing textures and animations (§3.3) |
| 6 | Script-host generation and revocation | Partly: the role only moves on disconnect today, and duplicate sessions are rejected rather than replaced (`SESSION_CONFLICT`). Still cheap insurance for future moves | Accepted: `hostGen`, revocation, tests. Heartbeat deferred (§7) |
| 7 | Graph safety ≠ graph authority | Accepted; the draft overstated "safe by construction" | Accepted: `targets` scoping and resource limits (§5.3) |
| 8 | Standard graph format; tick semantics; existing tooling | Confirmed: standard graphs use index-based JSON pointers, and `onTick` is per frame. The Khronos authoring tool exists (Apache-2.0, separate engine) | Accepted (§5.3–§5.6) |
| 9 | Decoded memory limits; pinned vs mutable | Accepted | Accepted (§4.3) |
| 10 | Package vs portable export | Accepted | Accepted (§6) |

### 11.2 Follow-up review (verdict: approve S1–S5; Phase 3 architecturally ready)

| Item | Disposition |
|---|---|
| Security A: test the reported path in an owner-gated world as the authenticated owner | Done. The prototype has a 12th test, and proofs (b) and (c) fail it (pre-brief §6) |
| Security B: the `LIKE` search over-matches and the `JOIN` drops ownerless worlds | Done. A JSON-aware `json_tree` query with a `LEFT JOIN`, tested against a planted reference and decoys (pre-brief §7.1) |
| Security C: separate cleanup from the fix | Done. A post-release `json_remove` procedure, tested; the world still loads (pre-brief §7.3) |
| A. `hostGen` doesn't stop writes from a revoked runner | Accepted. Revocation is stated as cooperative in Phase 3; server-checked marking of script writes is required before any non-disconnect role move (§5.2) |
| B. `sha256` doesn't pin a multi-file `.gltf` | Accepted. Phase 3 pins self-contained `.glb` only; a manifest maybe later (§4.3) |
| C. `activate` needs a trust policy | Accepted as a proposal: a distance check (default 10 m, per-behavior) plus a world-wide rate limit; confirm in the step 4 pre-brief (§5.2) |
| Step 1: a duplicate-name rename would surface as `INVALID_FIELD` | **Confirmed** (`setField` maps every `setPath` error to `INVALID_FIELD`); the brief must pick an explicit path (§4.8) |

The 2026-10-09 passdown, which arrived with the 2026-10-11 upload and was read
during this pass, added step 0b (§9). It also means the PROD commons has been
a document world since 2026-10-09, so step 0 covers it. New hostnames:
`ewwb.dev` and `dev.ewwb.dev`.

---

## References

- glTF extension registry (ratified list):
  https://github.com/KhronosGroup/glTF/blob/main/extensions/README.md
- Khronos, "glTF Interactivity Extension Submitted for Ratification"
  (2026-07-16):
  https://www.khronos.org/news/press/gltf-interactivity-extension-submitted-for-ratification
- Khronos glTF Interactivity Graph Authoring Tool:
  https://github.com/KhronosGroup/glTF-InteractivityGraph-AuthoringTool
- Poly Haven licence (CC0): https://polyhaven.com/license
- Teleport scene format and Studio content library: the 2026-10-08
  comparison, which recorded `scene.json` objects pointing at models by URL
  (`"components": [{ "type": "mesh", "url": "/Tree.glb" }]`).
- `devtasks/PREBRIEF-source-ref-guard.md` (step 0).
