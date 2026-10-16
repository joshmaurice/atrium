# Pre-brief: server cleanup round (Phase 3, between 1b-1 and 1b-2)

Status: **FINAL, Revision 5 (2026-10-15).**
- **Rev 1:** the operator approved decisions K1–K8 (§4) as recommended, on
  2026-10-15. No other changes.
- **Rev 2:** applies an outside review of Rev 1 (ChatGPT, 2026-10-15,
  24 findings). Each was checked against `6e2e0b6`, several with new
  probes; §11 lists them. Changes: H2 wording; new H12–H14; **K2 narrowed**
  (no node healing); L1–L7 tightened; new L10 (audit script); §3, §7, §9
  and §10 extended.
- **Rev 3:** the operator approved K2's narrowing, on 2026-10-15. No other
  changes.
- **Rev 4:** applies a second outside review (ChatGPT, of the Rev 1 → Rev 3
  changes, 12 findings), each checked against `6e2e0b6`; §11.2 lists them.
  **New H15 (security, probed): one visitor can move and delete another
  visitor's avatar,** and a new decision K9 to fix it. Also L1, L2, L3,
  L6, L7 and L10 tightened, new L11, §7, §9 and the proofs extended.
- **Rev 5:** the operator approved K9, on 2026-10-15. No other changes.
- **Drafted by Claude from a clone of `main` at `6e2e0b6`.** Its runtime code
  is identical to the released `6447082b`; the only later commits are
  passdown and pre-brief uploads under `devtasks/`.
- **Every "today the code does X" claim in §2 was checked against that
  clone.** The ones marked *probe* were also run against the real server,
  SOM and glTF-Transform with throwaway scripts (not committed).
- **The round is a full-pipeline round** (`PREBRIEF-edit-mode-ui-1.md` §10
  item 2; 1b-1 passdown §6.1): it changes `packages/som` and
  `packages/server`, and its DEV deploy is the real pipeline deploy that the
  DEV least-privilege `--finish` waits for (ops passdown §5).

**Inputs:**
- `devtasks/Atrium-Passdown-2026-10-13-edit-plumbing.md` §3.8 (the
  pre-existing issues this round fixes) and §5.3;
- `devtasks/PREBRIEF-edit-mode-ui-1.md` §10 item 2, E7 and G10;
- `devtasks/PREBRIEF-edit-mode.md` A4–A8 and F5/F7 (the 1a contracts this
  round extends);
- `devtasks/Atrium-Passdown-2026-10-13-edit-mode-ui-1.md` §6.1 and §7;
- `devtasks/Atrium-Passdown-2026-10-14-ops-connector.md` (the newest; host
  state, least-privilege DEV);
- `devtasks/BRIEF-STANDARD-adversarial-testing.md`.

This is input for the brief-writing step. It is not the brief itself.

## 1. What the round is

The scope agreed on 2026-10-13 (1b-1 pre-brief §10 item 2):
1. **Prune deleted meshes, materials and accessors**, on remove or on save.
2. **Validate a non-string teleporter destination on `add`.**
3. **Fix `external-refs.test.js`** and bring it into the suite.
4. **The `SOMNode` name-setter identity check (E7)**, with a test that
   renames in a world holding duplicate legacy names.
5. **Optionally,** positive scale and unit quaternions on the server (G10).

Checking the code for item 1 found that **the leak is much bigger than
deletes** (H1–H4): every visitor whose avatar is added and then removed
leaves the avatar's mesh behind, and saves write it. The review of Rev 1
found that **saves drop texture images** (H13). Item 2 found that **any visitor
can make their own avatar a teleporter** (H6). Both are folded in below,
with decisions in §4.

**No SOP message structure changes.** Every new refusal uses an existing
error code, so AGENTS rule 1 (schema, validator and tests in one commit)
isn't triggered.

## 2. What the code does today (verified at `6e2e0b6`)

### H1. Removing a node leaves its resources in the document (*probe*)
- `SOMDocument._disposeNode` (~L363) disposes only the glTF node, then
  drops the node's own map entries. The mesh, its primitives, accessors,
  material and buffer stay in the glTF root and in the SOM's `_meshMap`,
  `_primitiveMap` and `_materialMap`.
- **glTF-Transform keeps them:** after the node is disposed, the mesh's
  only parent is `Root` (*probe*), so `writeJSON` still writes it.
- **Probe, file world `space.gltf`** (5 nodes, 4 meshes, 12 accessors, 1
  buffer; 11.8 KB serialized):

  | After | Nodes | Meshes | Materials | Accessors | Buffers | Serialized |
  |---|---|---|---|---|---|---|
  | load | 5 | 4 | 4 | 12 | 1 | 11.8 KB |
  | one avatar joins and leaves | 5 | 5 | 5 | 15 | 2 | 20.0 KB |
  | then a pad is placed and deleted | 5 | 6 | 6 | 18 | 3 | 24.6 KB |
  | reload of that save | 5 | 6 | 6 | 18 | 3 | — |

- **Probe, document world, 20 visitor sessions** (avatar `add`, then the
  disconnect's `removeNode`): **11.8 KB → 175.6 KB**, 24 meshes for 5 nodes.
- **`ingestNode` (~L602) creates one glTF `Buffer` per primitive** (~L625),
  so each leaked primitive is also its own `data:` URI buffer in a save.

### H2. Visitors leak, not just deletes
- **The disconnect path:** `cleanupSession` (`session.js` ~L316) calls
  `world.removeNode(avatarNodeName)` (~L327), the same path as H1.
- **So every avatar add followed by its removal leaves one capsule mesh**
  (about 8 KB serialized: one mesh, one material, three accessors, one
  buffer) in the live document. A visitor who disconnects before their
  avatar `add` leaves nothing.
- **It's sent to every newcomer:** the `som-dump` is `world.serialize()`
  (~L543), which writes the orphans.
- **It's saved:** autosave (`autosave.js` ~L61) writes the same document
  after the next owner edit, and a reload carries the orphans forever
  (H1 table, last row).
- **The commons is the root world, which is never torn down:** when its
  last session leaves, `onSessionRemoved` (`world-registry.js` ~L486)
  flushes it instead of scheduling a teardown. So its in-memory leak grows
  with every visitor until a restart, and the first save after any owner
  edit persists it (saves are dirty-gated).
- **Clients leak the same way:** `AtriumClient._onRemove` (~L943) disposes
  through the same SOM path, so a long-lived tab keeps every departed peer's
  mesh. DocumentView frees GPU resources when a property is disposed
  (`@gltf-transform/view` 4.4.0 subscribes every subject to `dispose`), so
  pruning would free them too.

### H3. Saves write the meshes of the nodes they exclude (*probe*)
`serialize({ excludeNodes })` (`world.js` ~L141 and ~L304) filters excluded
nodes out of `json.nodes` after `writeJSON`, but not the resources they used.
- **Live avatars at save time:** autosave excludes them by name (~L82), and
  their meshes are written anyway (H1 probe: with an avatar present, the
  save wrote the world's 5 nodes and 5 meshes; the fifth is the avatar's,
  and no written node uses it).
- **External content in file worlds:** every `som-dump` of a file world
  carries the external nodes' meshes without their nodes. *Probe,*
  `space-ext.gltf`: 3 nodes written, 4 meshes written, 1 of them referenced;
  12.1 KB instead of about 2.3 KB.
- **The commons seed** is `fileWorld.serialize()` after resolving external
  references (`commons.js` ~L122), so a seed from a file with external
  references stores their meshes as orphans.

### H4. Removing a camera or light host leaves the glTF camera or light (*probe*)
- 1a's `_disposeHostedCamera` / `_disposeHostedLight` (~L387, ~L411) clean
  up the SOM wrappers and aliases but don't dispose the glTF camera or light.
- **Probe:** removing `MainCamera` from `space-cameras.gltf` still writes 4
  cameras with 3 referenced; removing `Sun` from `space-lights.gltf` still
  writes 2 lights with 1 referenced.
- A light has no `Root` parent: once its host is disposed it has no parents
  at all, but the extension still writes it until `light.dispose()`
  (*probe*).

### H5. `add` accepts any teleporter destination value (*probe*)
`case 'add'` (`session.js` ~L665) checks only a string longer than 2048
(~L737–747); C4 left the add path unchanged in 1a.
- **Probe, non-avatar adds,** all accepted and stored: `destination: 42`,
  `{ x: 1 }`, `['a']`, `true`, and `teleporter: 'not-an-object'`.
- `send` already refuses these with D8's messages (`send-policy.js`
  ~L371–378: "destination must be a string", "destination exceeds 2048
  characters").
- **No client misbehaves on them today:** `isTeleporter`
  (`apps/client/src/teleporter-marker.js`) requires a non-empty string. It's
  junk in the world, and a second definition of "valid" next to `send`'s.
- **A test asserts the current behaviour:** `edit-plumbing.test.js` ~L906
  "C4: a non-string destination on add is accepted".

### H6. Any visitor can make their avatar a teleporter (*probe*)
- **Avatar adds skip the length cap** (`!isAvatar`, ~L741) and every other
  `extras.atrium` check except S2's `source` guard (~L699).
- **Probe:** an avatar `add` with `extras.atrium.teleporter.destination` of
  5,024 characters (`wss://elsewhere.example/…`) was accepted, stored and
  broadcast to the other client.
- **By reading `apps/client`:** `derivePads` (`app.js` ~L400) builds a pad
  for every node in `client.som.nodes` that passes `isTeleporter`, peer
  avatars included, at the node's position when the pads were last rebuilt.
  So in an owner world where a visitor can't place teleporters
  (`canEdit: false`), they can still make themselves one, pointing at any
  server. Not exercised in a browser.
- **`send` can't do this:** sends to a live avatar are refused for everyone
  (`send-policy.js` `authorizeSend`, ~L323).
- **Design §5.4 puts scripts in `extras.atrium.behavior`** on nodes, so
  avatar-carried `extras.atrium` will matter more in step 4.

### H7. Duplicate names: three lookups, three answers (*probe*)
A world saved before D3 can hold two nodes with the same name. At load,
`_buildObjectGraph` (~L127) **overwrites** `_nodesByName` (the last node
wins) while `_registerObject` (~L225) **refuses** the second entry in
`_objectsByName` (the first wins). Probe, two nodes named `Dup`
(`first`, `second`):
- `getObjectByName('Dup')` → `first`; `getNodeByName('Dup')` → `second`.
- **E7, confirmed:** `SOMNode`'s `name` setter (`SOMNode.js` ~L28) calls
  `renameNode(this.name, v)` with no target, which resolves through
  `_nodesByName`. Setting `first.name = 'Renamed'` renamed **`second`**.
- **The client reaches that setter** for another client's rename
  (`AtriumClient._onSet` ~L994–996: `getObjectByName`, then
  `setPath(target, 'name', …)`). Its own accepted rename calls
  `renameNode(edit.node, edit.value)` without a target (~L1037).
- **The server refuses every rename of a duplicated name:** `setField`
  passes the `getObjectByName` target (R3), which never matches
  `_nodesByName`'s, so the result is `INVALID_VALUE` "rename target is not
  the named node". So E7 needs a client whose SOM disagrees with the
  server's; it's defence in depth.
- **`send` and `remove` reach different nodes:** `send Dup translation`
  moved `first` (`setField` → `getObjectByName`); `remove Dup` deleted
  `second` (`removeNode` → `getNodeByName`).
- **After that remove, `first` is stranded:** `getNodeByName('Dup')` →
  null, so a second `remove Dup` is `NODE_NOT_FOUND`, while `send` still
  reaches it.
- `apps/client` 1b-1 disables selection and rename for duplicated names
  (`isDuplicatedName`), so the UI can't reach any of this today.

### H8. Transform values (G10)
- `send-policy.js` ~L354–357: rotation must be 4 finite numbers, translation
  and scale 3. **Zero or negative scale and non-unit quaternions are
  accepted.** The `add` schema (`add.client.json`) types them as numbers
  with fixed lengths only.
- **The module's own rule:** its header (~L23) says value checks are "type /
  length / enum / finite only. No new ranges." G10 is a new range, so it
  needs a decision (K6).
- **glTF 2.0 requires a unit quaternion** for `rotation`; it allows any
  scale, including negative (mirroring) and zero.
- 1b-1 clamps scale to at least 0.01 and normalizes quaternions on the
  client; a third-party client or the protocol inspector doesn't.

### H9. `packages/server/tests/external-refs.test.js` (*run*)
- **Outside the suite:** the package script runs `test/*.test.js`; this file
  is in `tests/`.
- **Run at `6e2e0b6`: 3 of 6 fail.** Tests 3, 4 and 6 call
  `createSessionServer({ port, world })`, which has required `httpServer`
  since the HTTP restructure.
- **Tests 3 and 4 also contradict 1a:** they assert that a `send` to an
  external node (`Crate/Crate`) is accepted and broadcast. A4 refuses that
  with `PERMISSION_DENIED`, and `edit-plumbing.test.js` ~L567 tests the
  refusal. Fixing only the setup would make them fail on their assertions.
- **Fixed ports 4301–4303,** not in AGENTS.md's port list.
- Tests 1, 2 and 5 pass: prefixed ingest names, the dump's node
  filtering, and a failed reference being non-fatal.

### H10. The WebSocket server has no payload cap
`new WebSocketServer({ noServer: true })` (`session.js` ~L161) takes `ws`'s
default `maxPayload` of **100 MiB**. Any visitor can send an avatar `add`
that large; the server ingests and broadcasts it. The largest legitimate
client message today is an avatar or teleporter `add` of a few KB; 1b-2's
primitives will be tens of KB. With H2 fixed, memory comes back when the
visitor leaves; without a cap, one message can still cost the box
(3.8 GB RAM) hundreds of MB. Out of scope in step 1 (§7 there); K7 asks
whether to fold in a cap.

### H11. The two world kinds duplicate their code
`createWorld` and `createWorldFromDocument` (`world.js`) each carry their
own `setField`, `addNode`, `serialize` and `removeNode`, identical but for
formatting. Every fix in this round lands in both, or in one shared helper.

### H12. Shared cameras and lights leave stale entries (*probe*, from review #5)
1a's cleanup is right for one host per camera or light, not for shared ones.
Probe: one camera and one light, each used by nodes `A` and `B`; remove `A`,
then `B`:
- **Camera:** `_cameras` has one entry per host (by design: "one entry per
  host node", `som-subtree.test.js` ~L187). `_disposeHostedCamera` splices
  only when no host is left, so after both removals **one stale entry
  remains** (`som.cameras.length` 1).
- **Light:** `_buildObjectGraph` makes a new `SOMLight` per host (~L177) but
  `_lightMap` keeps only the last. Cleanup compares against `_lightMap`'s
  wrapper, so **`A.light` stays registered, one stale entry stays in
  `som.lights`, and the bare name stays**, after both hosts are gone.

### H13. `serialize` drops texture images (*probe*, found while checking review #6)
- Both `serialize` functions embed `json.buffers` as `data:` URIs but leave
  `json.images` alone. glTF-Transform writes images as separate resources
  (`uri: "baseColor.png"`), which `serialize` discards.
- **Probe:** a document world with one textured material; `serialize()`
  wrote `images: [{ uri: "baseColor.png" }]` with no data. **A save, a
  `som-dump` and the commons seed lose every texture image.**
- No first-party flow adds textures today, so it shows only for worlds that
  arrived with them (a template, the commons seed file). Pre-existing; fixed
  here because L3 rewrites `serialize`.

### H14. Client listeners follow `som.nodes` (review #10)
- `_attachMutationListeners` (`AtriumClient.js` ~L1106) attaches node
  listeners for `this._som.nodes`, which is `_nodesByName`'s values. A node
  whose name is shadowed by another gets **no listener**, so local edits to
  it are never sent. Today that's the *first* of two duplicates; after K5(b)
  it's the second, and a take-over (L6) would expose a node with no listener.
- The same loop attaches camera listeners per `som.cameras` entry, so a
  shared camera (H12) gets one listener per host.

### H15. A visitor can take over another visitor's avatar (*probe*, review 2 #1)
- **The avatar name comes from the client's id:** `hello` sets
  ``avatarNodeName: `avatar-${sessionId.slice(0, 8)}` `` (`session.js` ~L449),
  and `sessionId` is whatever the client sent (`hello.client.json` accepts
  any non-empty string). Only an identical full id is refused
  (`SESSION_CONFLICT`, ~L413). Every visitor's id is broadcast in `join`.
- **Probe:** visitor A (`aaaaaaaa-…-01`) added their avatar. Visitor B sent
  `hello` with `aaaaaaaa-…-02` and was assigned the same `avatar-aaaaaaaa`.
  - B's avatar `add` was refused ("node name already exists"), but B stayed
    connected;
  - **B's `view` moved A's avatar on the server** to `[42, 0, 42]`
    (`case 'view'` ~L790 moves `world.getNode(session.avatarNodeName)`);
  - **when B disconnected, the server deleted A's avatar**
    (`cleanupSession` ~L327 removes by name) and broadcast a `remove`; A
    stayed connected, without an avatar.
- **The same names drive** `liveAvatarNames` (A4's avatar protection),
  autosave's exclusions (~L71–78) and L3's step 1. A permanent node named
  `avatar-xxxxxxxx` would be reachable the same way (removed on a colliding
  visitor's disconnect, and excluded from saves while they're connected).
- **Clients take the name from the server:** `AtriumClient` uses
  `hello.avatarNodeName` (~L698), and peers learn it from `join`'s
  `nodeName`. Nothing outside tests recomputes it from the id.
- **Tests assume the formula:** `edit-plumbing.test.js` ~L115, ~L487,
  ~L504; `session.test.js` ~L412; `client.test.js` ~L414, ~L485, ~L565. And
  several tests connect concurrent sessions whose ids share 8 characters
  (`test-${Date.now()}-…` in `avatar.test.js` ~L69, `presence.test.js`
  ~L70), so refusing a collision at `hello` would break them.

## 3. What this round isn't
- **Not 1b-2:** no add palette, delete UI or duplicate. This round makes
  delete cheap to offer.
- **No `apps/client` change.** The fixes in `packages/som` reach clients
  because they load the same SOM, so clients prune too (H2). **One
  `packages/client` change:** listener attachment (L6, H14). The 1b-1
  duplicate-name restriction stays.
- **K7 isn't a resource budget.** A 1 MiB `add` can still describe a lot of
  geometry; geometry limits stay out of scope (§6).

## 4. Decisions (operator, 2026-10-15)

K1–K8 were approved as recommended in Rev 0 (K2 as narrowed in Rev 2); K9 in Rev 5.

- **K1 — Where to prune. Recommended: all three,** because each covers a
  leak the others don't:
  1. **On remove (live, in `packages/som`):** `removeSubtree` also disposes
     every resource the removed subtree used that nothing else still uses.
     One shared path, so the server, every client and the inspector get it.
     Fixes H1, H2 and H4.
  2. **On serialize with exclusions:** a written document contains only
     what its written nodes use. Fixes H3 (live avatars at save time,
     external content in dumps and the commons seed).
  3. **On load of a document world:** heal worlds saved by older versions
     (K2).

  The alternative, prune on save only, leaves the live leak, the growing
  `som-dump` and the client-side leak.
- **K2 — Healing existing saved worlds. Recommended: yes, document worlds
  only, persisted on the next save.**
  - **Rev 2: narrowed; approved by the operator in Rev 3.** Rev 1 also removed
    detached node subtrees (pre-1a leftovers, F5). The review showed that
    rule can delete a detached root whose descendant an animation or skin
    uses, and that glTF allows nodes outside every scene on purpose
    (findings 1–2). **Nodes are never deleted by healing;** the heal log
    reports how many detached roots it saw, so a later round can decide.
  - On load (`createWorldFromDocument`), before the SOM is built: **prune
    unreferenced resources** across the whole document (L1's rule). A
    resource a detached node uses is referenced, so it stays.
  - **Why resources are safe to prune here:** document worlds are written
    only by Atrium (a template or seed, then protocol edits), and the
    protocol can't attach an existing mesh, material or texture to a node.
    An unreferenced resource in one can never be used. The pre-deploy DB
    backup that every DEV deploy takes is the recoverable original; for
    PROD, check that `atrium-deploy-prod` takes one too (it hasn't been
    read).
  - **Log counts only,** never names (S1's logging rule).
  - **Not saved by itself:** the healed document is written by the next
    save, after an owner edit. The alternative is to mark the world dirty
    after a heal that changed something; that saves without an edit and
    bumps `updated_at`.
  - **File worlds aren't healed:** they're the operator's files, re-read at
    every boot.
- **K3 — No new dependency. Recommended.** `@gltf-transform/functions`
  4.3.0 has `prune()` and `cloneDocument()`, but it depends on
  `ndarray-pixels`, which depends on `sharp` (native, with prebuilt
  binaries), a heavy addition to a sandboxed install. The rule needed here
  is small (L1); write it in `packages/som`. `Document.clone()` doesn't
  exist in core 4.3, so the serialize copy (L3) is a `writeJSON` →
  `readJSON` round trip.
- **K4 — Teleporter extras on `add`. Recommended:**
  - **non-avatar adds:** if `extras.atrium.teleporter` is present it must be
    a plain object, and its `destination` a string of at most 2048
    characters, with `send`'s D8 messages. One checker shared with
    `send-policy.js`, so `add` and `send` can't drift;
  - **avatar adds: refuse any own `extras.atrium`, even `{}`** → `PERMISSION_DENIED`,
    "avatar nodes cannot carry extras.atrium", before the gate with the
    other avatar-add checks (after S2, which keeps its own message for
    `source`). The first-party avatar descriptor carries only
    `extras.displayName` (`buildAvatarDescriptor`, `AtriumClient.connect`).
    The narrower alternative refuses only `extras.atrium.teleporter`, and
    leaves `behavior` and future keys open on avatars.
- **K5 — Duplicate names. Recommended (b); approved.**
  - **(a) E7 only:** the setter passes itself as the rename target, and the
    client's own-echo rename passes the node it resolved. A test shows the
    wrong node is never renamed. Lookups stay inconsistent (H7).
  - **(b) (a) plus one node per name, consistently:** `_nodesByName` keeps
    the *first* node registered for a name, as `_objectsByName` already
    does, at every registration site (`_buildObjectGraph`, `createNode`,
    `ingestNode`, `ingestExternalScene`). So `send`, `remove` and rename
    reach the same node. **When that node is removed or renamed, the next
    node with that name in document order takes the name over** in both
    maps (in `_objectsByName` only if the slot is free). An owner can then
    untangle a legacy world one rename at a time, and nothing is stranded.
    In a world with duplicates, `remove Dup` deletes the first node instead
    of the second; today's behaviour is the inconsistent one.
- **K6 — Transform values (G10). Recommended: unit quaternions, non-zero
  scale,** on `send` and `add` (avatar adds included, after the gate):
  - rotation: `|‖q‖ − 1| ≤ 1e-3`, else `INVALID_VALUE` "rotation must be a
    unit quaternion";
  - scale: every component with `|s| ≥ 1e-6`, else `INVALID_VALUE` "scale
    components must be non-zero";
  - negative scale stays allowed (valid glTF, and mirroring is legitimate);
  - refused, never corrected (the adversarial standard: the server rejects,
    it doesn't fix up);
  - the `send-policy.js` header is updated to say so.

  Alternatives: positive scale only (refuses legitimate mirrored nodes); or
  leave G10 out and keep the no-ranges rule.
- **K7 — A WebSocket payload cap. Recommended: fold in, 1 MiB.**
  `maxPayload: 1048576` on the `WebSocketServer`; `ws` closes an oversized
  connection with 1009. One line and one test. The alternative is a
  separate fast-lane item.
- **K8 — How the round runs. Recommended: the full pipeline**, with the
  outside review before DEV acceptance (edit-plumbing §3.3) and a DEV
  acceptance that includes the DB checks in §9.
- **K9 — Avatar ownership (H15). New in Rev 4; approved by the operator
  in Rev 5.** Two parts, both server-side, no protocol change:
  1. **Unique avatar names:** at `hello`, the server keeps
     `avatar-<first 8 of id>` when that name is free, and otherwise appends
     `-2`, `-3`, … until it is. Free means: no live session holds it, and no
     object in the world's namespace (`_objectsByName` or `_nodesByName`)
     has it. Clients already use `hello.avatarNodeName`, so nothing else
     changes, and existing tests whose sessions don't collide keep their
     names.
  2. **Ownership by identity:** a session records the node its accepted
     avatar `add` created (`session.avatarNode`). `view`, disconnect
     cleanup, `liveAvatarNames`, autosave's exclusions and L3 all use that
     node, never a lookup by name; a session whose avatar `add` was refused
     owns nothing, so its `view` moves nothing and its disconnect removes
     nothing.

  The alternative, refusing a colliding `hello` with `SESSION_CONFLICT`, is
  simpler but breaks the concurrent-session tests (H15) and would refuse an
  honest visitor whose random id happens to collide.


## 5. The contract

### L1. One prune rule (`packages/som`, e.g. `src/prune.js`)
- **A pure function over a glTF-Transform `Document`.** Input: candidate
  properties. It disposes each candidate that **has no parent other than
  `Root`**, and repeats until nothing more can go. It returns what it
  disposed, and has a **dry-run mode** for L10 (review 2 #4): it runs the
  real prune on an independent copy (the L3 round trip) and reports counts
  per type. A dry run that only reads current parents would miss the chain
  under an orphan mesh, so it isn't allowed.
- **Collect before disposing** (review #3). Disposal severs edges, so the
  dependencies of a property are read before it's disposed: a mesh's
  primitives; a primitive's attribute, index and morph-target accessors and
  its material; a morph target's accessors; a material's textures; a skin's
  inverse-bind-matrix accessor; an accessor's buffer. Each of those becomes
  a candidate in the next pass, and is disposed only if, by then, it too has
  no non-`Root` parent.
- **Prunable types:** `Mesh`, `Primitive`, `PrimitiveTarget`, `Material`,
  `Texture`, `Accessor`, `Buffer`, `Skin`, `Camera`, and KHR_lights_punctual
  `Light`. **Never pruned:** `Node`, `Scene`, `Animation` (and its channels
  and samplers), `Root`, the document's extras.
- **"Used" means any non-`Root` parent,** whoever it is: a node (attached
  to a scene or not), primitive, morph target, animation sampler, skin,
  material or extension property. A material shared with a surviving
  primitive survives; an animation sampler's accessors survive; a mesh
  instanced by another node survives.
- **A buffer goes only when no accessor uses it.**
- **Whole-document mode** (for L4 and L10) enumerates candidates from
  `root.listMeshes()`, `listMaterials()`, `listTextures()`,
  `listAccessors()`, `listBuffers()`, `listSkins()`, `listCameras()`; the
  primitives of every mesh and the morph targets of every primitive; and
  lights from the KHR_lights_punctual extension's `listProperties()`. A
  light has no `Root` parent, so the root lists never show it (*probe*:
  after its host is disposed, the extension lists it with no parents).

### L2. Live pruning on remove (K1.1)
- `removeSubtree` collects the mesh, skin, camera and light of every node in
  the subtree before disposing anything, disposes the nodes (as today), then
  runs L1 on those candidates.
- **SOM maps** follow by identity: each disposed property's entry in
  `_meshMap`, `_primitiveMap`, `_materialMap`, `_textureMap`, `_skinMap`,
  `_cameraMap` and `_lightMap` goes only if it still points at that
  property's wrapper.
- **Cameras and lights, one host at a time** (H12):
  - **Per host,** always, when that host goes: its alias (`<host>.camera`,
    `<host>.light`), and **one** entry for that host in `_cameras` /
    `_lights` (one entry per host stays the design).
  - **A light's per-host wrapper is the host's own** (`somNode._light`),
    not `_lightMap`'s: cleanup uses it.
  - **Shared entries** (the bare name; `_cameraMap` / `_lightMap`): if
    another host still uses the glTF camera or light, they're moved to that
    host's wrapper when they pointed at the departing one; when the last
    host goes, they go, and the glTF camera or light is disposed (L1).
  - **A shared camera's wrapper is one object for all hosts** (review 2 #2).
    Its `_qualifiedName` and `_hostNode` name one host; when that host goes
    and another remains, they move to the surviving host (first in document
    order).
  - **Every alias deletion is identity-guarded,** as in 1a: an alias string
    is deleted only while it still points at the departing host's wrapper.
- **One `remove` broadcast and one save notification,** as today. Pruning
  isn't a protocol event.

### L3. Serialize (K1.2, H3, H13)
- **One `serialize` for both world kinds** (H11), with `removeNode` shared
  the same way, so this round can't fix one kind and miss the other.
- **Binary resources are kept** (H13, review #6): every buffer **and every
  image** in `writeJSON`'s `resources` is embedded as a `data:` URI. The
  same `NodeIO`, with KHR_lights_punctual registered, is used throughout.
- **No exclusions** (`som-dump` of a document world): written from the live
  document, as today apart from the images.
- **With exclusions** (saves with visitors present; `som-dump` of a file
  world with external content; the commons seed):
  1. Resolve the excluded nodes **to node identities** in the live document
     (avatars: each session's `avatarNode`, K9; external content: the nodes
     `ingestExternalScene` created), then to their **indices in
     `root.listNodes()`**. Never by name: a permanent node can share a name
     with an external one (review #8) or with a session's avatar name
     (H15).
  2. Write the live document (`writeJSON`), and read it back with **its
     `resources` map** (`readJSON({ json, resources })`). The round trip
     keeps node order (*probe*). **Check it before disposing anything**
     (review 2 #5): the copy has as many nodes as the live document, and
     each excluded index has the same name in both. A mismatch throws
     `SERIALIZE_INDEX_MISMATCH` and writes nothing.
  3. **Refuse a structural break** (review #7): if a node in an excluded
     subtree is the target of a channel, or a joint or skeleton of a skin,
     that the copy keeps, `serialize` throws a typed error
     (`SERIALIZE_EXCLUDED_REFERENCED`) and writes nothing. No first-party
     path can produce this: avatars can't be parented or be parents (A4),
     external ingest copies no animations or skins, and saved channels and
     skins point at saved nodes. A test builds the case directly.
     (*Probe:* glTF-Transform writes a channel whose target was disposed
     with no `node`, which is valid glTF but silently changes the
     animation.)
  4. Dispose the excluded subtrees in the copy, run L1 on the resources they
     used (collected first), and write the copy with images and buffers
     embedded.
- **The live document is never touched by a serialize.**
- **Cost** (review #9): the copy path runs per newcomer for file worlds with
  external content. The worker records, in the handoff, the time and peak
  heap for 20 consecutive dumps of `space-ext.gltf` and of the largest
  fixture, against the same numbers at the base. Not a gate; it's for
  deciding whether a cached dump is needed later.

### L4. Heal on load (K2, as narrowed in Rev 2)
- In `createWorldFromDocument`, after `readJSON` and before
  `new SOMDocument(...)`: L1 in whole-document mode. **No node is removed.**
- **Log** `[world] healed document: M meshes, A accessors, … removed;
  D detached root nodes kept` when anything was removed or any detached root
  was seen. Counts only.
- **Not in `createWorld`** (file worlds).

### L5. Atrium extras on `add` (K4)
- **Avatar adds:** after S2 and before the gate, refuse any own
  `extras.atrium` (including `{}`) → `PERMISSION_DENIED`.
- **Non-avatar adds,** after the gate and the A4/A5 checks, where the
  length cap is today:

  | `node.extras.atrium` / `teleporter` | Result |
  |---|---|
  | no `extras`, no `atrium`, or no `teleporter` key | accepted (not a teleporter) |
  | `extras.atrium` present and not a plain object | `INVALID_VALUE` "extras.atrium must be an object" |
  | `teleporter: null`, `[]`, `'x'`, `42` | `INVALID_VALUE` "teleporter must be an object" |
  | `teleporter: {}` (no destination) | `INVALID_VALUE` "destination must be a string" |
  | `destination: 42`, `{}`, `[]`, `true`, `null` | `INVALID_VALUE` "destination must be a string" |
  | `destination: ""` | accepted, as on `send` (`isTeleporter` treats it as not a pad) |
  | a string of 2048 | accepted |
  | 2049 or longer | `INVALID_VALUE` "destination exceeds 2048 characters" (as today) |

- **One exported checker** for the destination, used by both `session.js`
  and `send-policy.js`.
- **Every refusal comes before the first world change** (the
  `displayName` overwrite and `addNode`).
- A non-owner's non-avatar `add` still gets the gate's `PERMISSION_DENIED`
  first (`commons.test.js`).

### L6. Duplicate names (K5)
- **(a) The setter:** `SOMNode`'s `name` setter calls
  `renameNode(this.name, v, this)`; `_resolveOwnSetEcho` (~L1037) passes
  `getObjectByName(edit.node)` as the target. A mismatch is the existing
  `INVALID_VALUE` and changes nothing.
- **(b) One node per name:** first-registered wins in `_nodesByName` at
  every registration site (`_buildObjectGraph`, `createNode`, `ingestNode`,
  `ingestExternalScene`).
- **Take-over:** when the addressable node for a name is removed or
  renamed, scan `root.listNodes()` in order for the next node with that
  name that has a SOM wrapper; it takes `_nodesByName`, and `_objectsByName`
  if that slot is free.
- **Scope of the guarantee** (review #12): `send`, `remove` and rename agree
  when the global slot belongs to a node. When a legacy node's name collides
  with a non-node object (`__document__`, an animation, a `.camera` /
  `.light` alias), the node stays reachable only through `getNodeByName`
  (`remove`), and `send` and rename resolve the other object, as today. New
  names can't collide (D3).
- **Client listeners** (H14, review #10): `_attachMutationListeners`
  attaches node listeners to **every node in the document**, not only
  `som.nodes`. Nodes added later keep today's path
  (`_attachNodeListenersRecursive`).
- **One addressability guard for every callback a node owns** (review 2
  #3): the node's own listener and its mesh, primitive and material
  listeners (`_attachNodeListeners` ~L1132–1178) all send through one check:
  the node is the object the server would resolve for its current name,
  `getObjectByName(node.name) === node`. So edits to a shadowed node, or to
  a node whose name a non-node object holds, are never sent under a name
  that reaches something else; a node that takes over starts sending.
- **Camera listeners** attach once per camera wrapper, not once per
  `som.cameras` entry (H14), and **read the wrapper's qualified name when
  they send** (review 2 #2), not the alias captured at attach (~L1192).

### L7. Transform values (K6)
- In `send-policy.js` for `rotation` and `scale`, and in `case 'add'` for the
  descriptor's `rotation` and `scale`, **avatar adds included**: after the
  gate (which avatar adds pass) and before the first world change.
- Rotation: `|‖q‖ − 1| ≤ 1e-3`; a zero quaternion is refused. Scale: every
  component with `|s| ≥ 1e-6`; negative allowed.
- **Numerical policy** (review 2 #9): the comparisons are plain IEEE
  doubles with no extra allowance. A value computed to land exactly on a
  boundary (e.g. `[0, 0, 0, 0.999]`, whose `|‖q‖ − 1|` is a little over
  `1e-3` in doubles) may fall either side; tests use values clearly inside
  or outside.
- Constants named in one place (`UNIT_TOLERANCE = 1e-3`,
  `MIN_SCALE = 1e-6`). Values already in saved worlds aren't checked or
  changed.

### L8. `external-refs.test.js` (item 3)
- **Move it to `packages/server/test/`,** so the package script and the DEV
  deploy pick it up.
- **Port 0 with an `httpServer`,** full teardown.
- **Tests 3 and 4 assert A4:** a `send` to `Crate/Crate` gets
  `PERMISSION_DENIED`, the other client receives nothing, and the node's
  translation is unchanged.
- **Test 2 also asserts L3:** the dump contains no mesh, material or
  accessor that only external nodes used.
- Tests 1, 5 and 6 keep their assertions.

### L9. Payload cap (K7)
`maxPayload: 1048576` on the `WebSocketServer` in `session.js`, as a named
constant. The test uses **an established, authorized connection** (the
owner, after `hello`): an `add` of 1 MiB + 1 byte closes the connection with
1009, the node isn't added, and no other client receives anything.

### L10. A read-only document audit (review #20)
- `packages/server/scripts/audit-document.js`: reads **exactly one** glTF
  JSON document from stdin (it exits nonzero on zero or several) and prints
  counts per resource type, what L1's whole-document dry run would remove,
  detached root nodes, and dangling references (a channel with no target
  node, a primitive with no `POSITION`, an index out of range). It writes
  nothing.
- **Worlds are picked by id** (review 2 #11): slugs are unique only per
  owner (`UNIQUE (owner_user_id, slug)`).
- Run on the host as an unprivileged user, fed by `sqlite3 -readonly`
  (§8). It's how DEV acceptance shows the heal worked beyond mesh counts.

### L11. Avatar ownership (K9)
- **Name at `hello`:** as K9 part 1. The `hello` response, `join`'s
  `nodeName` and the avatar-`add` name check all use the allocated name.
- **Ownership:** `session.avatarNode` is set only by an accepted avatar
  `add`. `case 'view'` moves only that node; `cleanupSession` removes only
  that node (by identity, through `removeSubtree`); `liveAvatarNames`,
  autosave's exclusions and L3 come from sessions' `avatarNode`s.
- **The disconnect `remove { id }` broadcast** is sent only when the session
  owned an avatar; a session that never had one sends `leave` only.

### Errors

| Case | Code |
|---|---|
| Avatar `add` carrying `extras.atrium` | `PERMISSION_DENIED` |
| Non-avatar `add`: `extras.atrium` or `teleporter` not an object | `INVALID_VALUE` |
| Non-avatar `add`: non-string destination | `INVALID_VALUE` ("destination must be a string") |
| Non-avatar `add`: destination over 2048 | `INVALID_VALUE` (unchanged) |
| `send` or `add` with a non-unit or zero rotation (K6) | `INVALID_VALUE` |
| `send` or `add` with a scale component under `1e-6` in magnitude (K6) | `INVALID_VALUE` |
| Rename whose target isn't the named node | `INVALID_VALUE` (unchanged) |
| `serialize` finds an excluded node a kept channel or skin uses | `SERIALIZE_EXCLUDED_REFERENCED` thrown; nothing written |
| `serialize`'s copy doesn't line up with the live node list | `SERIALIZE_INDEX_MISMATCH` thrown; nothing written |
| A message over 1 MiB (K7) | connection closed, 1009 (transport, not an SOP error) |

Every **SOP error message** echoes `seq` (review 2 #12); a connection close
can't. A refusal changes nothing, broadcasts nothing and saves nothing.

## 6. Out of scope
- 1b-2 (palette, delete UI, duplicate) and step 2 (undo).
- Lifting 1b-1's duplicate-name restriction in `apps/client`.
- **Deleting detached nodes** (K2 as narrowed). The heal log counts them.
- Geometry limits on `add` beyond K7's message cap (review #16).
- One shared buffer for `ingestNode`'s primitives (H1); with pruning, the
  per-primitive buffers no longer accumulate.
- The 65 535-index wrap in `ingestNode` (F10); 1b-2's D5 avoids it.
- A cached file-world `som-dump` (L3's cost numbers decide later).
- Healing operator file worlds, or rewriting saved worlds outside the
  normal save path.
- The `ephemeral` flag on non-avatar adds.

## 7. Tests

**Real servers, real SOM, real glTF-Transform; no mocks.** Every server is
on port 0 with full teardown. **Tests run in the DEV deploy as
`atrium-build` with no network** (ops passdown §5): loopback only. Fixtures
for skins, morph targets and textures are built in the test with
glTF-Transform; none of the repo fixtures has them.

**Every refusal test asserts the side effects** (review #19): the world's
node and resource counts and the relevant values before and after, no
`add`/`set`/`remove` at a second client, and no save notification (count
`onSaveableMutation` calls where the harness exposes them).

**Every "survives" test also serializes, reloads and checks the content**
(review #17): accessor arrays, image bytes, and that channels and skins
still point at the right nodes, not only counts.

### 7.1 New
- **Prune rule (`packages/som`):**
  - a removed node's mesh, primitives, accessors, material and buffer are
    gone from the glTF root, from `som.meshes` / `som.materials`, and from
    `serialize`'s output;
  - survives: a mesh used by two nodes; a material shared with a surviving
    primitive; **a texture used by two materials** when one material goes;
    **morph-target accessors** shared with kept geometry; **a skin's joints
    and inverse-bind-matrix accessor** while a node still uses the skin; **an
    animation output accessor shared by two samplers**; a resource whose only
    surviving parent is an extension property (if the registered extensions
    can make one; say so if not);
  - goes: an orphan morph target and its accessors; an unattached light
    (whole-document mode);
  - a removed subtree's resources all go, children's included;
  - wrapper identity: a surviving node's `node.mesh` is still the same
    instance as its `som.meshes` entry.
- **Dry run (L1, review 2 #4):** an orphan mesh → primitive → accessor →
  buffer chain; the dry run's counts per type equal those of a real prune of
  a copy, and the original document serializes byte-identically before and
  after the dry run.
- **Cameras and lights (H12):** a camera and a light each shared by hosts
  `A` and `B`; remove `A`, then `B`. After each step check `som.cameras`,
  `som.lights`, both aliases, the bare names, `_cameraMap` / `_lightMap`, and
  the serialized document. After `A`: `B.light` and the bare name still
  write the shared light. After `B`: nothing left anywhere. **Also remove
  first the host that the shared camera's `qualifiedName` names**, then
  change the camera through a real client: the server accepts and
  broadcasts it under the surviving host's alias (review 2 #2).
- **Server, over both world kinds:**
  - **the visitor test:** 20 avatar joins and leaves, then a save; the saved
    document has the same resource counts as before the first join;
  - **a save with two visitors still connected** writes no avatar node and
    no avatar mesh, material, accessor or buffer, while both avatars stay in
    the live world;
  - `som-dump` to a third client, after visitors left, has no resource no
    node uses;
  - **file world with external content:** `som-dump` has no external-only
    resources (L8 test 2); a permanent node named like an external one
    (`Crate/Crate`) is still written (identity, not name);
  - **the commons seed** from `space-ext.gltf` stores no external-only
    resources;
  - **textures (H13):** a textured document world survives save → reload
    with byte-identical image data, with and without exclusions;
  - **L3 step 3:** an excluded node that a kept channel targets (built
    through the SOM) makes `serialize` throw
    `SERIALIZE_EXCLUDED_REFERENCED`, and nothing is written;
  - **L3 step 2, index correspondence** (review 2 #5): the round trip maps
    every node to the same index in documents with duplicate names,
    detached nodes, nested subtrees and two scenes; and a copy whose node
    list is made not to line up (a test hook) throws
    `SERIALIZE_INDEX_MISMATCH` and writes nothing;
  - **heal on load:** a document with orphan meshes, an orphan light and an
    orphan morph target loads without them and logs counts only; **a
    detached root whose descendant an animation targets, and a detached
    root used as a skin joint, are both kept** with their resources and
    still referenced after a reload (review #1); a clean document loads
    unchanged and logs nothing;
  - **file worlds aren't healed.**
- **K4:** the L5 table, row by row, as refusal or acceptance tests; avatar
  `add` with `extras.atrium.teleporter`, with `extras.atrium.behavior` and
  with `extras.atrium: {}` → `PERMISSION_DENIED`, the avatar not created;
  a first-party-shaped avatar `add` (`extras: { displayName }` only) still
  accepted.
- **K5:**
  - **(a), with injected divergence** (review #13): a SOM whose
    `_nodesByName` and `_objectsByName` are made to disagree on purpose;
    setting the name of the `_objectsByName` node never renames the other;
  - **(b):** a legacy document with two nodes named `Dup`: `send`, `remove`,
    `getNodeByName` and `getObjectByName` all reach the first; after
    removing it, the second is addressable and removable; after renaming the
    first to `Dup-1` over the wire, the second takes `Dup` and can be
    renamed too, and a reload shows two unique names;
  - **cross-type collision:** a legacy node named like an animation: `send`
    reaches the animation, `remove` the node, as today;
  - **client, end to end** (review #10): two real `AtriumClient`s on the
    `Dup` world; A renames the first `Dup`; then A moves the node that took
    over `Dup`; B and the server see the move on that node;
  - **every callback is guarded** (review 2 #3): before the rename, a
    material change on the shadowed `Dup` sends nothing; after it, the same
    change on the node that took over is sent and applied to *its*
    material; a legacy node named like an animation sends nothing for a
    transform or material change.
- **K6:** quaternions of norm `1 ± 5e-4` (accepted), `1 ± 2e-3` and 0
  (refused); scale components `±1e-6` and `-1` (accepted), `±9e-7` and 0
  (refused). Each on `send`, non-avatar `add` and avatar `add`, with the
  side-effect checks (L7's numerical policy: no test sits on a computed
  boundary).
- **K9 (H15):**
  - A, then B with A's 8-character prefix: B is assigned
    `avatar-aaaaaaaa-2`, and its avatar `add` under that name is accepted;
    B's `view` moves only B's avatar; B's disconnect leaves A's avatar and
    broadcasts a `remove` for B only;
  - a world holding a permanent node `avatar-aaaaaaaa`: a visitor with that
    prefix gets `-2`; while they're connected an autosave still writes the
    permanent node; after they disconnect it still exists;
  - a session whose avatar `add` was refused (a forged name): its `view`
    moves nothing, its disconnect removes nothing and broadcasts no
    `remove`;
  - `join` and the `hello` response carry the allocated name, and a real
    `AtriumClient` peer routes B's `view`s to B's avatar.
- **K7:** L9's test.
- **L10:** the audit script on a healed and an unhealed document gives the
  expected counts and writes nothing.
- **End to end** (real server, two real `AtriumClient`s): B joins and leaves
  10 times; A's SOM has as many meshes, materials and accessors as before
  B's first join.

### 7.2 Authority (the disagreement cases)
Each with the side-effect checks above:
- a visitor's avatar `add` that claims to be a teleporter, or carries any
  `extras.atrium`;
- an owner's `add` with a non-string destination or a malformed
  `extras.atrium`;
- a non-unit rotation and a zero scale, from the owner and in an avatar
  `add`;
- an oversized message from the owner;
- a client whose SOM has diverged sends nothing that makes the server rename
  the wrong node.

### 7.3 Existing tests that change (checked at `6e2e0b6`)
- **`edit-plumbing.test.js` ~L906** "C4: a non-string destination on add is
  accepted" becomes a refusal test; its 2049-character half is unchanged.
- **`edit-plumbing.test.js` ~L744** "R3: a rename whose resolved target is
  not the named node" (review #11): it builds the disagreement with two
  `ingestNode` calls, which under K5(b) agree, so the rename would succeed.
  It becomes two tests: the K5(b) rename of `r3-dup` succeeds and renames
  the first node; and the R3 refusal, with the disagreement injected
  directly into the maps, still gets `INVALID_VALUE` "not the named node".
- **`tests/external-refs.test.js`** moves and changes per L8.
- **K9:** tests that compute `avatar-<first 8>` (`edit-plumbing.test.js`
  ~L115, ~L487, ~L504; `session.test.js` ~L412; `client.test.js` ~L414,
  ~L485, ~L565) keep passing when their sessions don't collide. A test whose
  concurrent sessions share a prefix (`test-${Date.now()}-…` ids in
  `avatar.test.js`, `presence.test.js`) and asserts the second session's
  name by the formula changes to read it from `hello`. No server test was
  found that expects a disconnect `remove` from a session without an
  avatar.
- **Unchanged, must stay green:** the A6 shared-camera test
  (`som-subtree.test.js` ~L183, still "one entry per host node");
  `som-camera` / `som-light` length assertions; `teleporter.test.js` (the
  add-path length cap, ~L167–264); `commons.test.js` (gate first);
  `send-field-allowlist.test.js` (its rotations are unit or wrong-length,
  ~L408, ~L686, ~L955); `autosave.test.js`; the SOM subtree tests.

**Report each changed assertion and why** in the handoff.

### 7.4 Baseline at `6e2e0b6`
Node 22.22.0, clean `pnpm install --frozen-lockfile`, each file run on its
own:

| Suite | Command | Count |
|---|---|---|
| server, 21 files | `cd packages/server && node --test test/<file>` per file | **427** |
| protocol | `cd packages/protocol && node --test test/*.test.js` | 71 |
| som | `cd packages/som && node --test test/*.test.js` | 200 |
| `packages/client` | `cd packages/client && node --test --test-force-exit tests/*.test.js` | 169 |
| `apps/client` | `cd apps/client && node --test tests/*.test.js` | 294 |
| renderer-three | `cd packages/renderer-three && node --test tests/*.test.js` | 64 |
| interaction | `cd packages/interaction && node --test tests/*.test.js` | 9 |

Server files: auth 17, autosave 10, avatar 7, commons 19, db 11, edit-e2e 6,
edit-plumbing 41, home-world 15, http-integration 51, multi-world-mutation 9,
origin 17, presence 6, rate-limit 5, reconnect-session 5,
send-field-allowlist 44, session 19, source-ref-guard 21, teleporter 16,
world-crud 75, world-visibility 24, world 9. All `fail 0`, `skipped 0`.
`tests/external-refs.test.js` (not in the suite): 3 pass, 3 fail.

Give every expected count **next to the exact command** (tint passdown
§4.5).

### 7.5 Proofs of failure
Each must fail the named tests, exit nonzero and stop on its own. Restore
afterwards. Review #18 asked for narrow breaks, so each targets one clause.

| Proof | Break | Must fail |
|---|---|---|
| (a) | `removeSubtree` doesn't call the prune | SOM prune tests; the 20-visitor test |
| (b) | The prune ignores non-`Root` parents | shared mesh, material, texture, sampler accessor |
| (c) | Live removal skips `PrimitiveTarget` dependencies only (review 2 #7) | a live node with morph targets is removed: its target accessors must go |
| (d) | The prune disposes a shared texture regardless of its other material | the shared-texture test |
| (e) | `serialize` with exclusions back to filtering `json.nodes` only | visitors-connected save; file-world dump; commons seed |
| (f) | The L3 read-back without `resources` | the texture round trip with exclusions |
| (g) | Images no longer embedded | the texture round trip without exclusions |
| (h) | Exclusion by name instead of identity | the `Crate/Crate` permanent-node test |
| (i) | Drop L3 step 3's check | the excluded-but-referenced test |
| (j) | Heal removes detached roots | the animated-descendant and skin-joint heal tests |
| (k) | Drop the heal | the orphan-resource load tests |
| (l) | Light cleanup back to `_lightMap`'s wrapper | the shared-light steps |
| (m) | Drop the avatar `extras.atrium` refusal | the avatar refusals |
| (n) | Drop the non-string check on `add` | the K4 destination rows |
| (o) | The name setter without a target | K5 (a) with injected divergence |
| (p) | `_nodesByName` last-wins again | K5 (b) consistency |
| (q) | First-wins kept, take-over removed | the take-over tests |
| (r) | Client listeners back to `som.nodes` | the client end-to-end `Dup` test |
| (s) | Scale check on `send` only | the K6 `add` scale tests (and the reverse break fails the `send` ones) |
| (t) | Drop `maxPayload` | the oversized-message test |
| (u) | The camera listener captures the alias at attach again | the shared-camera client test |
| (v) | The guard on the node's own listener only, not material callbacks | the shadowed-node material test |
| (w) | Rotation check on `send` only (and, separately, on `add` only) | the K6 rotation tests on the other path |
| (x) | The dry run reads current parents instead of pruning a copy | the dry-run equivalence test |
| (y) | Drop L3's index check | the index-mismatch test |
| (z) | Avatar names back to the plain formula | the K9 collision tests |
| (aa) | `view` and disconnect back to lookup by name | B moves or deletes A's avatar; the refused-avatar test |

## 8. Worker rules and operator checks

**Workers:** as the last full round (edit-plumbing):
- `pnpm install --frozen-lockfile --prefer-offline` in their own worktree,
  with a `readlink` check;
- the full handoff (40-char SHA, per-file counts and exit codes, Node
  version, skipped count, proofs, L3's cost numbers);
- progress comments; no output redirects in card commands.

**Kickoff and cards:**
- the kickoff carries the spec as text, never "go read the repo"
  (edit-plumbing §3.1);
- hand-made review cards open with "THIS RUN HAS TERMINAL, FILE AND GIT
  TOOLS. Use them for every step below." (1b-1 §4.4);
- check every code reference the GLM brief makes (edit-plumbing §3.2).

**Before kickoff:**
- no open sentinel; a push dry run; the base SHA from a host fetch;
- **upload this pre-brief before the base fetch.** No GitHub web edits to
  `main` from then until PROD (teleport-rearm §3.1);
- **confirm the DEV deploy picks up a new server test file:**
  `atrium-build-run list-tests` should list 28 suites after this round
  (27 today: 21 server files plus 6 packages). It isn't readable through the
  ops connector;
- **the GitHub PAT expires 2026-10-29.** Renew it first if the round could
  reach PROD after that.

**Before the DEV deploy (read-only, DEV and PROD):** the quick look, for the
"before" numbers. It counts orphan meshes only; L10's audit is the full
check once it exists (review #20).
```
sqlite3 -readonly /var/lib/atrium/atrium.db "SELECT slug, length(document) AS bytes,
  json_array_length(document,'$.nodes') AS nodes,
  json_array_length(document,'$.meshes') AS meshes,
  json_array_length(document,'$.meshes') - (SELECT count(DISTINCT json_extract(n.value,'$.mesh'))
    FROM json_each(document,'$.nodes') AS n) AS orphan_meshes
FROM worlds WHERE json_valid(document) ORDER BY bytes DESC LIMIT 20"
```
DEV's database is `/var/lib/atrium-dev/atrium.db`. The query was checked
against a sample row, not against the host. If the commons shows hundreds of
orphan meshes, H2 has been happening on PROD.

**The L10 audit on the host,** after the deploy, as an unprivileged user
(the script is reviewed code, but nothing of the repo's runs as root):
```
sqlite3 -readonly /var/lib/atrium-dev/atrium.db "SELECT document FROM worlds WHERE id='<world id>'" \
  | sudo -u atrium-dev /usr/local/bin/node /srv/atrium-dev/packages/server/scripts/audit-document.js
```

## 9. DEV acceptance (`https://dev.ewwb.dev`)

1. **Fresh load** (review #21). The deploy restarts DEV, since
   `packages/server` and `packages/som` change, so every world is loaded by
   the new code on its first join; the commons at boot. Check the heal log
   with the ops connector's `logs` tool (atrium-dev): one `healed document`
   line per world with orphans, counts only. **Find the world ids** for
   the audits (slugs aren't unique across owners):
   `sqlite3 -readonly /var/lib/atrium-dev/atrium.db "SELECT id, slug, owner_user_id FROM worlds"`.
2. **Before any edit:** the §8 query shows the DB unchanged. That's
   expected (K2 persists on the next save) and proves nothing yet
   (review #24).
3. **A world with orphans, as the owner:** make one edit, wait about 35 s
   (1b-1 pre-brief G11). Run the audit on its row: nothing left to prune, no
   dangling references, and the counts the heal log reported are gone.
   Reload the world: it looks the same and the edit is there. (Don't
   compare the browser's SOM with the saved row: the browser also holds the
   avatars, which saves leave out; review 2 #10.)
4. **Visitors leave** (L2): a second browser joins and leaves five times;
   then an owner edit and a wait. The audit shows no growth.
5. **Visitor stays** (L3, review #22): a second browser stays connected while
   the owner edits and the save runs. The audit of the saved row shows no
   avatar node and no avatar resources, while the visitor is still visible
   in the owner's window. Then, with only the owner left, a third browser
   joins and its avatar has appeared in the owner's window: in the third
   browser, `atriumClient.som.meshes.length` equals the saved row's mesh
   count plus 2 (its own avatar and the owner's).
6. **Client memory** (review #23): in the owner's window, note
   `atriumClient.som.meshes.length`, `.materials.length`, and
   `atriumClient.som.document.getRoot().listAccessors().length`; have the
   second browser join and leave three times; the three numbers return to
   where they were, without a reload.
7. **Protocol inspector, as a non-owner:** an avatar `add` with
   `extras.atrium.teleporter` → `PERMISSION_DENIED`.
7a. **Avatar ownership (K9):** with the owner's window open, connect the
   protocol inspector with a `hello` whose id starts with the owner's first
   8 characters (the owner's id is in the inspector's `join` messages). Its
   `hello` shows an `avatar-…-2` name. Send a `view` from the inspector,
   then disconnect it: the owner's avatar doesn't move and is still there
   for a second window.
8. **Protocol inspector, as the owner:** `add` with `destination: 42` →
   "destination must be a string"; `send` rotation `[0, 0, 0, 2]` and scale
   `[0, 1, 1]` → `INVALID_VALUE`.
9. **Regression in `apps/client`** (Firefox):
   - Edit mode: move, rotate and scale a node; reload; it stays;
   - place and delete a teleporter, then take one and come back;
   - two windows see each other move, and a departing avatar disappears
     with no console errors.
10. **Then `--finish`:** this deploy is the real pipeline DEV deploy that
    `$H/migrate-least-privilege --finish` waits for (ops passdown §5,
    `host/ROLLOUT.md`).

**PROD:** after release, the restart heals in memory; run the audit on the
commons row after its next owner edit.

## 10. Notes for the brief author

- **H2 is the headline.** The agreed item was "prune deleted meshes";
  the code says every visitor leaks, saves write live avatars' meshes, and
  dumps carry external content. The 20-visitor test is what proves the fix.
- **The review's main warning: deleting too much is worse than leaking.**
  Every "survives" case in §7.1 is a data-loss case if it fails. They come
  before the "goes" cases in importance.
- **Collect dependencies before disposing** (L1). After `dispose()` the
  edges you need are gone.
- **Don't touch the live document during a serialize** (L3). Exclusions are
  by identity, mapped to node indices; the round trip keeps the order.
- **K5(b) reaches the client** (L6): listeners on every node, sending only
  while addressable. Without that, a node that takes over a name can't send
  edits.
- **R3 changes meaning** (§7.3): keep the refusal test, but build its
  disagreement directly.
- **H15 is the round's security fix.** Every place that turns a session
  into a node goes through `session.avatarNode` (L11); grep for
  `avatarNodeName` and check each use.
- **No protocol change.** If the brief finds one is needed, stop and ask
  (AGENTS rule 1).

## 11. Review log

### 11.1 Outside review of Rev 1 (ChatGPT, 2026-10-15)
Verdict: the diagnosis holds and K1–K8 stand; revise the contracts before
implementation. ChatGPT read the repo at `6e2e0b6` through GitHub and
verified H1–H11 in code; it couldn't rerun the probes. Each finding was
checked against `6e2e0b6`.

| # | Finding | Check | Disposition |
|---|---|---|---|
| 1 | Healing detached roots can delete descendants an animation or skin uses | Confirmed by reading: Rev 1's rule tested the root only | **K2 narrowed:** healing deletes no node; tests keep both cases |
| 2 | A node outside every scene isn't necessarily garbage | Accepted (glTF allows it) | Same; detached roots are counted in the heal log |
| 3 | Collect dependencies before disposing | Confirmed (*probe*: edges are gone after dispose) | L1 rewritten |
| 4 | Whole-document mode needs an enumeration; lights have no `Root` parent | Confirmed (*probe*: the extension's `listProperties()` lists them) | L1 enumeration; orphan light and morph-target tests |
| 5 | Shared camera/light cleanup leaves stale entries | Confirmed (*probe*), now H12 | L2 per-host rule; two-step test; proof (l) |
| 6 | The serialize copy must keep binary resources | Confirmed, and worse: today's `serialize` already drops images (*probe*), now H13 | L3: `resources` through the round trip; images embedded; proofs (f), (g) |
| 7 | Excluding nodes can break animations and skins | Confirmed (*probe*: a disposed target leaves a channel with no `node`) | L3 step 3: refuse with a typed error; unreachable from first-party paths; test and proof (i) |
| 8 | Name-based exclusion can drop a permanent node | Confirmed by reading (`externalNodeNames` is a name set) | Exclusion by identity, mapped to indices (*probe*: order kept); proof (h) |
| 9 | The copy runs per join for file worlds | Confirmed (`session.js` ~L543) | Cost numbers in the handoff; caching out of scope |
| 10 | A node that takes over a name has no client listeners | Confirmed (`_attachMutationListeners` iterates `som.nodes`), now H14 | L6 client listeners; end-to-end test; proof (r); §3 updated |
| 11 | K5(b) breaks the existing R3 test | Confirmed (`edit-plumbing.test.js` ~L744) | §7.3: split into a K5(b) success and an injected-divergence refusal |
| 12 | Cross-type collisions aren't covered by K5(b) | Confirmed | L6 scope; cross-type test |
| 13 | Proof (g) needs injected divergence | Accepted | K5 (a) test with injected divergence; proof (o) |
| 14 | The validator's cases and order need spelling out | Accepted | L5 table; `extras.atrium` shape; refusals before any change |
| 15 | Test the K6 boundaries on every path | Accepted | §7.1 K6 boundary list |
| 16 | The payload cap isn't a resource budget; test it on an authorized connection | Accepted | §3 note, §6; L9 test on an owner connection |
| 17 | Missing reference-sharing cases | Accepted | §7.1: texture, morph targets, skin, shared sampler output, extension parent; content checked after reload |
| 18 | Narrower proofs | Accepted | §7.5 rewritten, (a)–(t) |
| 19 | Assert side effects, not only codes | Accepted | §7 preamble |
| 20 | The DB query isn't a full audit | Accepted | New L10 audit script; the query stays the quick look |
| 21 | Prove a fresh load ran the healer | Accepted; the deploy restarts DEV | §9 step 1, heal log through the ops connector |
| 22 | Five visits then an edit doesn't test L3 | Accepted | §9 step 5 |
| 23 | Avatar disappearing doesn't prove client pruning | Accepted | §9 step 6, SOM counts in the console |
| 24 | H2 wording; an unchanged DB proves nothing | Accepted | H2 reworded; §9 step 2 |

### 11.2 Second outside review, of Rev 1 → Rev 3 (ChatGPT, 2026-10-15)
Verdict: close to implementation-ready; one must-fix. It verified H12–H14 in
the code. Each finding was checked against `6e2e0b6`.

| # | Finding | Check | Disposition |
|---|---|---|---|
| 1 | Avatar exclusion by name can hit a permanent node; disconnect removes by name | Confirmed and **worse** (*probe*): any visitor can move and delete another visitor's avatar. New H15 | **New K9** (unique names at `hello`, ownership by identity), L11, L3 step 1; tests; proofs (z), (aa); §9 step 7a |
| 2 | A shared camera's qualified name and the client listener's captured alias go stale | Confirmed (`_attachCameraListeners` ~L1192 captures it) | L2: wrapper moves to the surviving host; L6: alias read at send time; test; proof (u) |
| 3 | The addressability guard must cover mesh, primitive and material callbacks; use the server's resolution | Confirmed (`_attachNodeListeners` ~L1148–1178) | L6: one guard, `getObjectByName(node.name) === node`; test; proof (v) |
| 4 | A dry run that reads parents misses the chain under an orphan mesh | Accepted | L1: dry run prunes a copy; equivalence test; proof (x) |
| 5 | Index correspondence is an assumption | Accepted | L3 step 2: checked before disposing; `SERIALIZE_INDEX_MISMATCH`; shape tests; proof (y) |
| 6 | Proofs for the camera alias and material-only guard | Accepted | Proofs (u), (v) |
| 7 | Proof (c) can pass through whole-document enumeration | Accepted | Proof (c) now targets live removal |
| 8 | No rotation-specific proof | Accepted | Proof (w) |
| 9 | The exact quaternion boundary is a rounding question | Confirmed (`Math.abs(0.999 - 1) <= 1e-3` is false) | L7 numerical policy; test values moved inside and outside |
| 10 | Browser SOM counts include avatars; saved rows don't | Accepted | §9 steps 3 and 5 rewritten |
| 11 | Slugs aren't unique; the audit needs one document | Confirmed (`UNIQUE (owner_user_id, slug)`) | L10: by id, exactly one document; §8 and §9 commands |
| 12 | A 1009 close can't echo `seq` | Accepted | Errors section |
