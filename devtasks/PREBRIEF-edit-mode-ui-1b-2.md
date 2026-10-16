# Pre-brief: Edit mode UI, part 2 (Phase 3 step 1b-2) — add palette, delete, duplicate

Status: **DRAFT, Revision 0 (2026-10-16).** Decisions J2–J9 (§4) are open for
the operator. J1 (the lane) was set by the operator when the round was
started.
- **Drafted by Claude from a clone of `main` at `4f798eb`.** Its runtime code
  is identical to the released `27486bdf` (DEV, MAIN record and PROD); the
  only later commits are the 10-16 passdown and its connector note
  (`git diff --stat 27486bdf 4f798eb`: one file under `devtasks/`).
- **Every "today the code does X" claim in §2 was checked against that
  clone.** The ones marked *probe* were also run against the real server
  world, SOM, glTF-Transform and three.js 0.163.0 with throwaway scripts (not
  committed).
- **Board and host at drafting** (ops connector): release `COMPLETE`, every
  card done, DEV and PROD healthy, deploy lock free.

**Inputs:**
- `devtasks/PREBRIEF-edit-mode-ui-1.md` §3, §6, §10 item 3 and §12 (1b-1,
  which this round extends);
- `devtasks/PREBRIEF-edit-mode.md` §6 (notes for 1b), D2, D3, D5 and F10;
- `docs/DESIGN-phase3-placement-scripting.md` §4.1, §4.2 and §4.5;
- `devtasks/PREBRIEF-server-cleanup.md` L2, L5, L6, L7, L9 (what the server
  now prunes and refuses);
- `devtasks/Atrium-Passdown-2026-10-16-server-cleanup.md` (the newest;
  §4.1's lesson on claims, §4.2's cached modules, §6.2 item 1).

**Code facts:**
- **Line numbers:** approximate.
- **Implementation base:** a freshly fetched `origin/main` at the start of
  the round.

## 1. What 1b-2 is

Three actions in the owner's Edit panel (1b-1), the ones 1b-1 left out (its
E2):
- **Add:** a palette of five primitives (cube, plane, sphere, cylinder,
  ramp), placed in front of the avatar and selected once the server accepts.
- **Delete** the selected node, after a confirmation that says it can't be
  undone and, for a node with children, how many go with it.
- **Duplicate** the selected node, for nodes whose content survives an `add`
  (D5, tightened in N3), placed beside the original and selected.

Plus one fix the new delete makes reachable (J8): **the view leaves a world
camera whose host was removed.**

**Client only** (the exact packages depend on J2 and J4; the recommended
answers keep it to `apps/client` and `packages/renderer-three`). No server,
protocol or SOM change. The server cleanup round made delete cheap: a removed
node's mesh, materials and accessors are pruned on remove (L2).

## 2. What the code does today (verified at `4f798eb`)

### I1. The client calls 1b-2 needs exist, with two gaps
- `client.addNode(descriptor)` (`AtriumClient.js` ~L783) sends a
  non-avatar `add` and returns its `seq`. **It takes no `parent`**: every
  `add` the client API can send lands at the scene root. The server and
  every client already honour `add.parent` (1a A4, A7), but only a crafted
  `_wsSend` can set it.
- `client.removeNode(name)` (~L801) returns its `seq`.
- Both are tracked (`_trackEdit`, `{type: 'add'|'remove', node: name}`) and
  resolve as `edit:accepted`, `edit:rejected` or `edit:unknown`. **Neither
  sets `lastSendSeq`** (only `renameNode` and the node listener do).
- **Order on the requesting client:** `_onAdd` emits `som:add` (~L933)
  *before* `_resolveAccepted` (~L936); `_onRemove` emits `som:remove`
  (~L964) before it too. So when `edit:accepted` for an add arrives, the node
  is already in the SOM; when `som:remove` for an own delete arrives, the
  edit is still pending.
- Both throw `World not loaded` before `world:loaded`.

### I2. What `add` can carry (F10, re-checked)
`SOMDocument.ingestNode` (~L728) rebuilds:
- the node's name, translation, rotation, scale and `extras` (all of it);
- per primitive: `POSITION` and `NORMAL` as `Float32Array`, `indices` as
  **`Uint16Array`** (~L772: an index over 65 535 wraps silently), and one
  new material with only `baseColorFactor`, `metallicFactor` and
  `roughnessFactor`;
- one buffer per primitive; no mesh name is read from glTF (it uses
  `descriptor.mesh.name`).

Everything else is dropped: UVs, textures, emissive, alpha mode,
double-sided, vertex colours, primitive mode, morph targets, skins, cameras,
lights, children and extensions on the node, mesh, primitive or material.

The client `add` schema (`add.client.json`) allows `name` (required),
`translation`, `rotation`, `scale`, `extras`, `extensions` and `mesh`, with
`additionalProperties: false` on the node.

### I3. A palette primitive round-trips exactly (*probe*)
- An `add` of a `BoxGeometry` primitive and of a teleporter pad into a real
  document world (`createWorldFromDocument` of `DEFAULT_HOME_DOCUMENT`), then
  `serializeSomDocument` and a reload (what a save, the next load and every
  client's `som-dump` go through):
  - semantics `POSITION,NORMAL`; mode 4; indices `Uint16Array`; positions
    `Float32Array`; no morph targets;
  - material: not double-sided, `OPAQUE`, emissive `[0,0,0]`, no textures,
    no extensions; mesh name `""`, no weights;
  - `Array.from` of the reloaded `POSITION` equals the original descriptor's
    array exactly.
- **So a duplicate of anything the palette or the teleporter form made is
  lossless.** Content from a file world or a crafted `add` may not be (I2).

### I4. Sizes against the 1 MiB cap (*probe*)
`L9` closes the connection with **1009** on any message over
`MAX_PAYLOAD_BYTES = 1048576` (`session.js` ~L23, ~L203). Whole `add`
messages, as `JSON.stringify` lengths, built with
`threeGeometryToGltfPrimitive`:

| Primitive | Vertices | `add` bytes |
|---|---|---|
| `BoxGeometry(1,1,1)` | 24 | 805 |
| `PlaneGeometry(2,2)` | 4 | 458 |
| `SphereGeometry(0.5)` (32×16) | 561 | 73 588 |
| `CylinderGeometry(0.5,0.5,1)` (32) | 196 | 11 034 |
| teleporter pad | 98 | 9 426 |

- `Array.from(Float32Array)` writes each value as a full double
  (`0.12345670163631439`), about 19 characters. With normals that's roughly
  120 bytes a vertex, so **about 8 500 vertices fill 1 MiB.**
- **D5's "under 65 536 vertices" is far looser than the transport cap.** A
  duplicate the client sends at, say, 20 000 vertices wouldn't be refused:
  it would **disconnect the owner** (1009). The size has to be checked
  before sending (N3).

### I5. What 1b-1's panel does on a remove
- `som:remove` (`app.js` ~L1974–1986): every pending gesture on a node that
  is no longer alive is cancelled and its records marked dead
  (`editTracker.pruneRemoved`); if the selection went, it's cleared and the
  panel shows **"This object was removed."** (`REMOVED_MESSAGE`,
  `edit-gesture.js` ~L37).
- **An own delete would show that message too,** since `som:remove` arrives
  before `edit:accepted` (I1). N2 handles this.
- Pads: `som:remove` rebuilds pads on any remove (~L800); `som:add` rebuilds
  them when the added node is a teleporter (~L790). **So a duplicated pad
  and a deleted group holding a pad already rebuild the pads,** own or
  remote.

### I6. The teleporter modes (1b-1 E6)
- Place mode adds a pad with `client.addNode` (~L1423), named
  `'teleporter-' + crypto.randomUUID()` (~L1415). Delete mode (~L1477–1537)
  deletes **teleporters only**, after `confirm(...)` (~L1523).
- Both are closed and disabled while Edit mode is on
  (`updateTeleporterControls` ~L1218). Edit mode can't be entered while a
  teleporter save or delete is unanswered (`teleporterRequestPending`
  ~L1611).

### I7. Names (D3, A5)
- `client.som.checkNewName(name)` (`SOMDocument.js` ~L262): non-empty, at
  most 256 characters, not `__document__`, not ending in `.camera`/`.light`,
  no `/`, not already in `_objectsByName`. The server runs the same check on
  every non-avatar `add` (`session.js` ~L811) and refuses with
  `INVALID_VALUE` ("name "X" is already in use").
- The palette and the duplicate must generate names that pass it.

### I8. What the server checks on a non-avatar `add` (after cleanup)
In order (`session.js` ~L744–885): S2 (`extras.atrium.source` →
`PERMISSION_DENIED`), the mutation gate, the A4 parent checks, the D3 name,
**K6 transforms** (unit quaternion within 1e-3, every scale component
`|s| ≥ 1e-6`), **L5 extras** (`extras.atrium` an object; a `teleporter` an
object with a string destination of at most 2048). A refusal changes nothing
and echoes `seq`.

**So a duplicate of an external container (it carries `source`) is refused
by the server,** and a duplicate must send its rotation and scale as they
are (it can't create a value the server refuses unless the original already
holds one; values in saved worlds aren't checked, L7).

### I9. Deleting what the world came with
- New worlds and home worlds start from `DEFAULT_HOME_DOCUMENT`
  (`home-world.js`): one node, **`Ground`, with no mesh.** A mesh-less node
  can't be hit by the raycast, so Edit mode can't select it. Nothing in a
  new world can be deleted by accident; everything visible was added.
- The commons and older worlds can hold anything.

### I10. The SOM doesn't expose geometry arrays
- `SOMPrimitive` has `material`, `mode` and `extras` (`SOMPrimitive.js`
  ~L17–39); no attributes, indices or morph targets. `SOMMaterial` has every
  factor, texture, `alphaMode` and `doubleSided` getter. `SOMMesh` has
  `primitives` and `weights`. `SOMNode` has `mesh`, `camera`, `light`,
  `skin`, `children`, `parent`, `extras`.
- The glTF-Transform objects sit behind `_primitive`, `_mesh` and `_node`.
  `apps/client` already reads the glTF document directly for E7
  (`isDuplicatedName`, `app.js` ~L1781, `client.som.document`).
- See J4.

### I11. Removing the active camera's host
- Space cycles `client.som.cameras` (`app.js` ~L2126–2134) through
  `stage.setActiveCamera`, which keeps the SOM camera in `nav.activeCamera`.
- **Nothing resets it when its host node is removed.** Before 1b-2 only a
  crafted `remove` could do that; the Edit-mode delete makes it one click.
  `SOMCamera.node` returns the host (`SOMCamera.js` ~L20).
- See J8.

### I12. Peer avatars by `extras.displayName`
`AvatarController` treats any node in a `som-dump` with `extras.displayName`
as a peer (~L119–127), so it's never selectable (E4). The server accepts a
non-avatar `add` carrying `displayName` (*probe*: `world.addNode` accepts
it; no check exists). A duplicate can't reach such a node, since it can't be
selected; noted so nobody relies on that check.

### I13. Test baseline at `4f798eb`
Node 22.22.0, clean `pnpm install --frozen-lockfile`:

| Suite | Command | Count |
|---|---|---|
| `apps/client` | `cd apps/client && node --test tests/*.test.js` | **294** |
| `packages/client` | `cd packages/client && node --test --test-force-exit tests/*.test.js` | 169 |
| renderer-three | `cd packages/renderer-three && node --test tests/*.test.js` | **64** |
| interaction | `cd packages/interaction && node --test tests/*.test.js` | 9 |
| som | `cd packages/som && node --test test/*.test.js` | 224 |
| protocol | `cd packages/protocol && node --test test/*.test.js` | 71 |

All `fail 0`, `skipped 0`; they match the 10-16 passdown. Server: 492 over 32
files per that passdown (not rerun here; this round doesn't touch it).

`apps/client` tests can't import three.js or touch the DOM (1b-1 G12), so
logic that needs tests goes in small pure modules; `app.js` wires them.
renderer-three's tests do import three.js.

## 3. Decisions already made

- **J1 — Lane: the prototype lane** (operator, 2026-10-16), as 1b-1's E1:
  Claude builds and tests it in a cloud session on
  `claude/edit-mode-ui-1b-2`; a GLM review card; **an outside review by a
  separate Claude session** given only the SHA and this pre-brief (mandatory,
  1b-1 §4.3); operator DEV acceptance in Firefox.
- **From earlier rounds, unchanged:** D2 (delete removes the subtree), D3
  (names), D5 (duplicate only what round-trips; tightened below), design
  §4.1 (confirm deletes, warn about children), §4.2 (five primitives through
  `add`), §4.5 (no undo yet).

## 4. Decisions (open)

- **J2 — Where the primitive builders live. Recommended: `renderer-three`,**
  as `buildPrimitiveDescriptor({ kind, name, position, rotation })` beside
  `buildTeleporterDescriptor` in `geometry-utils.js`, with tests there (they
  can import three.js). The alternative is building them inline in
  `app.js`, untested.
- **J3 — Duplicate of a nested node. Recommended: root-level nodes only in
  1b-2;** the button is disabled for a node with a parent, with the reason
  as its tooltip. Nothing in the UI creates nested nodes (palette and pads
  add at the root, I1), so this costs nothing today and keeps
  `packages/client` untouched. The alternative is an `addNode(descriptor,
  { parent })` option in `packages/client` so the copy is a sibling.
- **J4 — Reading geometry for a duplicate. Recommended: one adapter in
  `app.js`** that reads the glTF-Transform objects behind the SOM wrappers
  (`_node`, `_mesh`, `_primitive`) and hands plain values to a pure module;
  marked in the code as a debt for public read-only SOM getters. The
  alternative is adding those getters to `packages/som` now, which is shared
  with the server and so brings a server deploy into the round.
- **J5 — Generated names. Recommended: readable,** `Cube`, `Cube 2`, `Cube
  3`… for the palette, `<name> copy`, `<name> copy 2`… for a duplicate: the
  first that passes `checkNewName`, truncated to fit 256 characters. The
  alternative is `cube-<8 hex>` like the pads. Readable names show in the
  panel's name field, and they can be renamed anyway.
- **J6 — After an add or a duplicate is accepted, select the new node.**
  Recommended. The handles land on it, ready to move.
- **J7 — The teleporter delete mode stays as it is** in 1b-2. Recommended.
  Edit mode can delete pads too, but retiring the old mode is a separate,
  visible change; log it for after 1b-2.
- **J8 — The removed active camera (I11). Recommended: fix it here,** small:
  on every `som:remove`, if `nav.activeCamera` is set and its host is no
  longer alive, `stage.setActiveCamera(null)` and update the hint. The
  alternative is to disable Delete for camera hosts.
- **J9 — Keys. Recommended: on-screen buttons only;** no Delete or Backspace
  key, and no Ctrl-D. The keys would need focus rules and would make a
  one-way delete easy to hit by accident until undo exists (step 2).

## 5. The 1b-2 contract

### N1. Add palette
- **Where:** a row of five buttons in the Edit panel, visible whenever Edit
  mode is on (with or without a selection): Cube, Plane, Sphere, Cylinder,
  Ramp.
- **Shapes** (J2), each through `threeGeometryToGltfPrimitive` and so
  indexed, with `POSITION`, `NORMAL` and `indices` only:
  - cube: 1 m (`BoxGeometry(1,1,1)`);
  - plane: 2 m × 2 m, lying flat (`PlaneGeometry(2,2)` rotated −90° about X);
  - sphere: radius 0.5 m, 32 × 16;
  - cylinder: radius 0.5 m, height 1 m, 32 segments;
  - ramp: a wedge 1 m wide, 1 m deep, 0.5 m high, built as an indexed
    `BufferGeometry` with flat per-face normals (unit length), rising
    toward −Z in its own frame.
- **Material:** `baseColorFactor` `[0.8, 0.8, 0.8, 1]`, metallic 0,
  roughness 0.8.
- **Placement** (a pure helper with tests, e.g.
  `apps/client/src/edit-palette.js`):
  - 2.5 m in front of the local avatar along its horizontal facing (its
    rotation applied to −Z, Y dropped, normalized; −Z if it has none);
  - **resting on y = 0:** the node's translation Y is the shape's half
    height (cube, sphere, cylinder 0.5; ramp 0; plane 0.01 to avoid
    z-fighting with a ground at 0). That matches the teleporter placement,
    which uses the y = 0 plane (`projectRayToPlane(ray, 0)`);
  - rotated to the avatar's yaw only (a unit quaternion about Y), so the ramp
    rises away from the owner.
- **Name:** per J5. The descriptor carries no `extras`.
- **Request:** `client.addNode(descriptor)`; record it (N4). The palette is
  disabled while any structural request is pending (N4), so a double click
  makes one node.
- **Accepted** (`edit:accepted` with that `seq`): select the node (J6),
  found with `client.som.getNodeByName(name)` (it's already in the SOM, I1).
  If it can't be found or selected (another tab removed it first), do
  nothing.
- **Rejected:** "Couldn't add: <server message>" in the panel's error line.
- **Prototype check:** the DocumentView object exists when `edit:accepted`
  arrives, so `attachSelected()` finds it. If it doesn't, select on the next
  frame. The handoff says which.

### N2. Delete
- **A Delete button** in the panel, enabled with a selection and no
  structural request pending, no rename of the selection unanswered, and no
  handle drag under way.
- **Confirmation,** `window.confirm` as the pad delete does:
  - always: `Delete "<name>"? This can't be undone.`
  - with descendants: `Delete "<name>" and the N objects inside it? This
    can't be undone.` **N counts every descendant** (`countDescendants` in
    N4's module) in the SOM subtree
    (`children`, recursively; the probe's `G → G-a → G-b` gives 2), since
    D2 removes them all.
- **Request:** `client.removeNode(selected.name)`; record `{ seq, node }`
  (N4) **before sending**, so the `som:remove` that arrives first (I1) can
  tell the delete was this tab's.
- **When the node goes** (`som:remove`): the existing 1b-1 handling runs
  (gestures cancelled, records dead), but **an own delete clears the
  selection without "This object was removed."** Pads rebuild as today (I5).
- **Rejected:** "Couldn't delete: <server message>"; the selection stays.
  `edit:unknown` (connection lost): the selection and the session end with
  Edit mode anyway (1b-1 B1).
- **J8:** after any `som:remove`, own or remote, if the active world camera's
  host is no longer alive, return to the default camera.
- **Cancel** in the dialog sends nothing and changes nothing.

### N3. Duplicate
- **A Duplicate button** in the panel. **Eligibility,** in a pure module with
  tests (e.g. `apps/client/src/edit-duplicate.js`), each failing rule giving
  the button's tooltip and keeping it disabled:
  1. no children;
  2. no parent (J3);
  3. no camera, light or skin on the node;
  4. no `extras.atrium.source` anywhere in `extras` (the server refuses it,
     I8);
  5. either no mesh, or a mesh whose every primitive has:
     - mode 4 (triangles);
     - attributes exactly `POSITION`, or `POSITION` and `NORMAL`, both
       `VEC3` float, not normalized, not sparse;
     - no morph targets;
     - indices absent, or with every index ≤ 65 535 (I2);
     - a material that is absent, or has no textures, no extensions,
       emissive `[0,0,0]`, `alphaMode` `OPAQUE` and is not double-sided;
     and the mesh has no morph weights and no extensions;
  6. no extensions on the node;
  7. **the whole `add` message, serialized, is at most 1 000 000 bytes**
     (UTF-8, `TextEncoder`), safely under the 1 MiB cap (I4). This replaces
     D5's vertex count as the binding limit; the index check in rule 5 stays
     because it is about correctness, not size.
- **Eligibility is computed when the selection changes** and after a
  `som:set` on it, not every frame. Rule 7 needs the descriptor, so it's
  built once then and reused by the click.
- **The descriptor** (built by the module from plain values the J4 adapter
  supplies): the original's translation **plus 1.5 m on world X** (J3: the
  parent is the scene), its rotation and scale as they are, a deep copy of
  its `extras`, and for each primitive `POSITION`, `NORMAL` and `indices` as
  plain arrays plus the three material factors. A mesh-less node duplicates
  as a node with no mesh.
- **Name:** per J5, from the original's current name.
- **Request, acceptance and refusal** as N1 ("Couldn't duplicate: …"); the
  copy is selected on acceptance (J6).
- **A duplicated pad** keeps its destination; the server checks it again
  (L5). Pads rebuild through `som:add` (I5).

### N4. Structural requests (one at a time)
In a pure module with tests (e.g. `apps/client/src/edit-structure.js`):
- **One pending structural request** at a time: `{ kind: 'add' | 'duplicate'
  | 'delete', seq, name, node? }`. While one is pending, the palette,
  Delete and Duplicate are disabled. Transform and name edits are not
  blocked (1b-1 B4 handles those).
- **Outcomes:** `edit:accepted`, `edit:rejected` and `edit:unknown` with
  that `seq` end it; any other `seq` is ignored.
- **`isOwnDelete(node)`:** true while the pending request is a delete of that
  node object (N2).
- **Reset** on everything that ends the edit session (1b-1 `endEditSession`):
  disconnect, connecting, `world:loaded`, Edit mode off.
- **Edit mode can be turned off** with a structural request pending; its
  answer is then ignored (except as `edit:*` events for the tracker), and a
  refusal message isn't shown. The teleporter rule that blocks Edit mode
  while a pad save is pending (I6) is unchanged.

### N5. What does not change
- Transform handles, the panel's fields, rename, selection rules, gestures
  (1b-1 B2–B5).
- The teleporter place and delete modes (J7) and the form's validation.
- Visitors (`canEdit` false) see no new UI.
- Server, protocol and SOM.
- **E7 (1b-1):** a node whose name another node shares still can't be
  selected, so it can't be deleted or duplicated in Edit mode. Lifting that
  needs a three object found by identity, not name; it isn't in this round.

## 6. Out of scope (1b-2)

- Undo and redo (step 2). Delete is final until then; the dialog says so.
- Duplicating nested nodes (J3's alternative), subtrees, or anything with
  textures (needs a subtree `add` or models by URL, design §4.3).
- Colour or material editing; a scene outliner (which would make mesh-less
  nodes like `Ground` selectable, I9).
- Retiring the teleporter delete mode (J7).
- Keyboard shortcuts (J9).
- Public SOM geometry getters (J4's alternative).
- `Cache-Control` on `/apps` and `/packages` (10-16 passdown §6.1 item 1),
  though §8 depends on working around it.

## 7. Tests

**Pure modules, real logic, no mocks of the module under test.** `app.js`
wiring is DOM code and is accepted on DEV (§8).

### 7.1 New
- **renderer-three, `buildPrimitiveDescriptor`** (J2):
  - each of the five kinds: indexed; `POSITION` and `NORMAL` the same
    length, a multiple of 3; every index in range; every normal of unit
    length (±1e-5);
  - the lowest vertex Y is −half height for cube, sphere and cylinder, and 0
    for the ramp and plane (so N1's translation rests them on y = 0);
  - the ramp: every face's normal points away from the wedge's centroid
    (outward winding);
  - each kind's whole `add` message is under 100 000 bytes;
  - an unknown kind throws.
- **`edit-palette`:**
  - placement at yaw 0, 90°, 180° and a non-axis yaw: 2.5 m along the
    horizontal facing; a pitched avatar rotation still gives a horizontal
    offset; no rotation gives −Z;
  - the rotation is a unit quaternion about Y;
  - names: `Cube` when free; `Cube 2` when `Cube` is taken; skips taken
    numbers; never returns a name `checkNewName` refuses (a stand-in with the
    real rules); a 256-character original still yields a valid copy name.
- **`edit-duplicate`:**
  - one test per eligibility rule (§N3 1–7), each with the reason text;
  - a palette primitive (plain values captured from a real
    `buildPrimitiveDescriptor` output) is eligible, and its duplicate equals
    the original except name and translation;
  - a pad is eligible; its copy keeps `extras.atrium.teleporter` and is a
    deep copy (changing the copy doesn't change the original's object);
  - a mesh-less, childless node is eligible and its copy has no mesh;
  - **the size rule:** a synthetic primitive of 9 000 vertices with normals
    is refused by rule 7; one of 1 000 is accepted; the boundary is measured
    in UTF-8 bytes (a name of 4-byte characters counts four each);
  - an index of 65 536 is refused by rule 5.
- **`edit-structure`:**
  - one pending request; a second is refused while it's pending;
  - accepted, rejected and unknown each end it; another `seq` doesn't;
  - `isOwnDelete` true only for the pending delete's node object, false
    after it ends and for another object with the same name;
  - reset clears it;
  - `countDescendants` (N2's N): 0 for a leaf; 2 for `G → G-a → G-b`; 3
    for a node with two children, one of which has a child.
- **`import-guard.test.js`** picks up the new imports.

### 7.2 Expected counts
- `apps/client`: **294 + the new tests.**
- renderer-three: **64 + the new tests.**
- Every other suite unchanged (I13). The handoff gives each exact number
  next to its command.

### 7.3 Proofs of failure
Each must fail the named tests and exit nonzero; restore afterwards.

| Proof | Break | Must fail |
|---|---|---|
| (a) | Drop rule 7 (no size check) | the 9 000-vertex test |
| (b) | `countDescendants` counts only direct children | the `G → G-a → G-b` test |
| (c) | `isOwnDelete` matches by name | the same-name-other-object test |
| (d) | Allow a second pending structural request | the one-at-a-time test |
| (e) | Duplicate copies `extras` by reference | the deep-copy test |
| (f) | Allow a double-sided material | its eligibility test |
| (g) | Palette names skip `checkNewName` (use the bare kind) | the "`Cube` taken" test |
| (h) | The ramp built with one face's winding reversed | the outward-normal test |

### 7.4 End to end (Claude, throwaway script, not committed)
A real server (owned document world) and two real `AtriumClient`s, A the
owner:
- A adds each palette kind; B sees each node with the same geometry
  (positions equal as Float32), and both survive a save and reload;
- A duplicates a cube and a pad; B sees both; B's pad list (by
  `isTeleporter`) grows by one;
- A deletes a group holding two descendants (built with `_wsSend` and
  `parent`); B's SOM no longer has any of the three, and B's mesh and
  accessor counts are back to before the group was built (L2);
- **A's duplicate of a 20 000-vertex node** (built with `_wsSend`) is
  refused by the client's rule 7 before anything is sent: A stays
  connected, B sees nothing;
- A deletes a node B holds selected with a pending gesture (B is a second
  owner tab): B's selection clears with "This object was removed."; A's
  doesn't show it.

## 8. DEV acceptance (operator, Firefox)

**First, in each window: hard-reload and check the new code is running**
(10-16 passdown §4.2): `!!document.getElementById('ep-palette')` is `true`
in the browser console (the handoff confirms the id).

**Setup:** an owned world on `https://dev.ewwb.dev` with at least one pad;
a second window as a visitor (another account, or `hermes-devcheck`); a
second owner tab for step 7.

1. **Gate:** the visitor and a logged-out window see no palette, Delete or
   Duplicate.
2. **Add:** each of the five shapes appears about 2.5 m ahead, resting on
   the ground, selected with handles; the ramp rises away from you. The
   visitor sees each one. Click Cube twice quickly → one cube at a time
   (the second click waits). Names read `Cube`, `Cube 2`.
3. **Duplicate:** duplicate a cube → a copy 1.5 m along X, selected. Move
   the copy → the original stays. Duplicate a pad → the copy teleports to
   the same place (turn Edit off, walk onto it); labels equal pads.
4. **Ineligible:** in a world with nested content (`pad-in-grp` inside
   `grp-test`, from the 1b-1 passdown's §8.3 console snippet), select the pad
   with Alt-click → Duplicate is disabled
   and its tooltip gives the reason.
5. **Delete:** delete a cube → the dialog names it and says it can't be
   undone; Cancel → nothing happens; OK → it's gone in both windows, with no
   "This object was removed." in your panel. Delete `grp-test` → the dialog
   says 1 object inside; both go; the pad's label goes too.
6. **Camera (J8):** in a world with a camera, Space to it, select its host
   and delete it → the view returns to the default camera.
7. **Removal from elsewhere:** select a node in tab 1, delete it from tab 2 →
   tab 1 shows "This object was removed." (1b-1 behaviour, unchanged).
8. **Persistence:** wait ~35 s (or close every window), reload → adds,
   duplicates and deletes are kept.
9. **Regression:** move, rotate, scale and rename still work (1b-1 §8
   steps 3–4); the teleporter place and delete modes work with Edit off;
   teleporting works.
10. **Console:** no errors beyond deliberate refusals.

Optional, the heal check: run the 10-16 passdown recipe §8.2 on the world
after step 5; the audit shows no orphan meshes.

## 9. Before the round
- **Upload this pre-brief before the base fetch.** No GitHub web edits to
  `main` from then until PROD (teleport-rearm §3.1).
- Claude's session needs push access; the branch is
  `claude/edit-mode-ui-1b-2`.
- The GLM card follows tint §7.2 with the 1b-1 §8.1 additions (the "THIS RUN
  HAS TERMINAL, FILE AND GIT TOOLS" first line; the host fetch first; every
  count next to its command).
- **The GitHub PAT expires 2026-10-29.** The round should finish well
  before; if it doesn't, renew first.

## 10. Where this sits
1. 1b-1 (shipped `6447082b`), the server cleanup round (shipped
   `27486bdf`).
2. **1b-2** (this file).
3. **Step 2:** undo and redo, on 1b-1's gesture records plus N4's structural
   requests (an add's inverse is a remove; a delete's is the N3 descriptor,
   only for a childless node, design §4.5).

## 11. Review log
None yet. An outside review of Rev 0 is recommended before J2–J9 are
approved, as for 1b-1 and the cleanup round.
