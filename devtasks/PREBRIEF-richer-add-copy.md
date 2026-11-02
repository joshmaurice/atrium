# Pre-brief: the `add` check, the richer `add`, and copying objects

Status: **DRAFT, Revision 0 (2026-11-02). Decisions RA-L1–RA-L6 and CP-L1–CP-L7
are the operator's; none is decided yet.** Each has a recommendation.
- **Drafted by Claude from `main` at `f42b5fe`.** Its code is the same as the
  released `84542c73` (DEV, MAIN and PROD): the commits on top change only
  `devtasks/`. Line numbers are at that commit.
- **How it was checked.** Claude read the code at `f42b5fe` and ran probes
  `p1`–`p6` (`devtasks/spike-richer-add/`, §2.9) against the real SOM, the real
  world module and the real session handler. The app itself wasn't opened in a
  browser for this draft.
- **Why now (operator, 2026-11-02):** "let's do the richer add and copy". This
  is the side track the 10-19 copy-objects passdown put between steps 3 and 4
  and later passdowns kept "in the operator's order" (10-23 edit-polish-3 §6.4).
  Step 4 has since shipped, so the copy step also has behaviours to handle.
- **One finding is a live defect on PROD (§2.3):** a visitor's avatar `add` can
  stop everyone else joining the world. RA-L1 asks whether to fix it alone first.
- **Sources:**
  - `devtasks/Atrium-Passdown-2026-10-18-undo-redo.md` §4.6 and §5.1 item 1
    (the richer `add`: what it carries, "before step 7 at the latest", widen
    Duplicate's and Undo's rules with it);
  - `devtasks/Atrium-Passdown-2026-10-19-copy-objects.md` (decisions C1–C4,
    and the questions it left for this pre-brief);
  - `devtasks/PREBRIEF-models-by-url.md` L12 and P7 (the "visitors can copy"
    note lands with copy; a root-relative model URL may need making absolute);
  - `devtasks/PREBRIEF-library-sky.md` §9 item 1 (library items carry no
    `origin`; the copy step recognises `/assets/library/` URLs);
  - `devtasks/PREBRIEF-scripting-4b-2.md` F10 (Duplicate remaps a behaviour's
    self-references and keeps its grants);
  - the design, `docs/DESIGN-phase3-placement-scripting.md`: §4.5 (undo), §5.4
    (`origin: "local"`, or the URL a behaviour was imported from), §6 (sharing,
    and its 2026-10-19 change), §7 item 7 (the subtree `add`, deliberately
    later), §10 Q6 (visitors may read scripts);
  - `devtasks/PREBRIEF-edit-mode-ui-1b-2.md` N3 and D5 (Duplicate's lossless
    rule).

## 1. What this delivers
Three rounds, in this order (RA-L6):
1. **`add-check`**: the server checks the geometry and material of every
   `add`, avatar `add`s included, against what `ingestNode` actually keeps. This
   closes §2.3. Same fields as today; nothing new is carried.
2. **`richer-add`**: `add` carries material names, emissive, alpha, double-sided
   and the rest of RA-L2, so Duplicate and Undo work on most legacy content
   (the commons' ground plane and crate, `atrium.gltf`'s floors).
3. **`copy-objects`**: Copy while visiting any world you can see, Paste in your
   own world, with C4's credit, behaviours arriving disabled, and C2's plain
   note.

**Not in these rounds:** groups (a subtree `add`, design §7 item 7; §2.5 shows
it's the other half of what blocks legacy content); textures in `add` (models
by URL carry textured content); lights, cameras, skins and animation on `add`;
editing emissive, alpha or double-sided in the Edit panel; a licence label
(C4's "later, optionally"); a clipboard that survives a reload (CP-L2).

## 2. Verified facts (at `f42b5fe`)

### 2.1 The `add` path
- **The schema accepts almost any mesh.** `add.client.json` requires
  `node.name`. Under `mesh.primitives[]`, `attributes` is any object,
  `indices` is anything and `material` is any object. Array items aren't typed.
  `add.server.json` has the same node shape, plus `requestSeq` and `session`.
- **The server checks the add, but not its mesh** (`session.js` L1226–1420), in
  this order:
  1. `msg.id`, the avatar's name, and that an avatar has no parent;
  2. S2 (`source`), and K4/L5 (an avatar carries no `extras.atrium`);
  3. the mutation gate;
  4. for world adds: parent, name rules and `objectId` uniqueness;
  5. K6 (transform values, avatars included);
  6. for world adds: `checkAtriumExtras`, `checkModelHost` and the behaviour
     caps.
  
  Nothing in that list looks at `node.mesh`.
- **The server stores what `ingestNode` keeps and broadcasts the message as
  sent** (`world.js` L573–591; `session.js` L1394–1413). Every client applies
  the broadcast with the **same** `SOMDocument.ingestNode`
  (`AtriumClient.js` L1533–1557). So widening `ingestNode` widens the server
  and every client at once.
- **Limits that exist:** `maxPayload` is 1 MiB (`session.js` L31, L281); message
  depth is at most 64 (`message-depth.js`); the client caps a Duplicate or
  Restore at `MAX_ADD_BYTES` 1,000,000 (`edit-duplicate.js` L25).

### 2.2 What `ingestNode` keeps (`SOMDocument.js` L781–852)
- **Kept:** the node's name, TRS and `extras`; the mesh name; POSITION and
  NORMAL as float VEC3; indices as `Uint16Array`; per primitive, a **new**
  material with three factors: `baseColorFactor`, `metallicFactor`,
  `roughnessFactor`.
- **Dropped without a word:** every other attribute (`p3`: `TEXCOORD_0`), the
  material's name, emissive and every other material field (`p3`), and mesh,
  primitive and material `extras`.
- **Taken without checks:** wrong-length arrays, non-numbers (`new
  Float32Array(['a'])` is `NaN`), indices past the end, and indices above 65535,
  which `Uint16Array` silently wraps (70000 becomes 4464).
- First-party adds send exactly what is kept: the avatar capsule
  (`geometry-utils.js` L120–143), the palette and pads (`PRIMITIVE_MATERIAL`
  L152; L265–282), and Duplicate and Undo (`buildDescriptor`,
  `edit-duplicate.js` L183–216).

### 2.3 The live defect: one malformed `add` stops joins (`p3`, `p4`)
- **`p3` (world module).** An `add` whose POSITION has 4 numbers passes the
  schema and is accepted. The next `serialize()` then throws `RangeError:
  Offset is outside the bounds of the DataView`. Every other malformed case
  `p3` tried is accepted, saved and reloaded without complaint:
  - an index past the end;
  - index 70000;
  - strings in POSITION;
  - NORMAL of another length;
  - a `baseColorFactor` of length 2;
  - `metallicFactor: "x"`.
- **`p4` (the real `attachSessionHandlers`, the real presence).**
  1. An **anonymous** visitor joins a world they don't own and sends their
     avatar `add` with that 4-number POSITION. **The server accepts it.**
  2. The next visitor's join fails: `som-dump serialize failed: RangeError …`.
     The join's `som-dump` serializes the whole world, avatars included
     (`session.js` L917–937), so they never get the world.
  3. When the first visitor disconnects, their avatar goes with them, and joins
     work again.
  
  So any visitor can keep a public world, the commons included, closed to
  newcomers for as long as they stay connected.
- **The owner's version is worse:** a world `add` with the same mesh stops
  joins **and** autosave (`autosave.js` L73–82) until the node is deleted.
- **What it isn't:** world documents already saved are not affected. A world
  whose saved document couldn't serialize would already fail every join today.
  `p6` counts unreadable documents for the operator's survey (§2.9).
- **Not probed:** what a malformed broadcast does to the clients already
  present (their `ingestNode` and three.js). The fix stops it at the server
  either way.

### 2.4 Duplicate's and Undo's rules (`edit-duplicate.js`)
- **D5 is lossless (N3):** a node can be duplicated or restored only if
  everything it has survives an `add`. Anything else is refused with a reason
  (`DUPLICATE_REASONS` L39–50, rules L247–275).
- **The mesh rules refuse:** a named or `extras`-carrying material or
  accessor; extensions; textures; emissive; any alpha mode but `OPAQUE`;
  double-sided; attributes other than POSITION and NORMAL; morph targets; any
  mode but triangles; an index above 65535 (`materialProblem` L124–136,
  `meshProblem` L138–165).
- **`prepareRestore` (L346–353) is Undo's canonical form.** It uses the same
  rules and builder as Duplicate, with the node's own name and translation.
- **Planes get a back face in their geometry** (`addBackFace`,
  `geometry-utils.js` L57) **because Duplicate refuses `doubleSided`**
  (K2). That stays as it is. Changing it isn't part of these rounds.

### 2.5 What content copies today (`p1`, `p2`)
`p1` runs `duplicateRuleProblem` over every top-level node of the fixture
worlds. Of 35 top-level nodes, Duplicate accepts **1** (`group.gltf`'s Floor,
a palette-style mesh). The rest are refused for:

| Reason | Count |
|---|---|
| a named material | 13 |
| children (groups: walls, columns, furniture, fountain, lamps) | 13 |
| a camera or light | 4 |
| animated | 2 |
| externally loaded | 2 |

The counts are per file, and the `space-*` variants repeat `ground-plane`,
`crate-01` and `lamp-01`, so they measure kinds of content, not distinct
objects.

`p2` lists **everything** each mesh node would lose, top level and inside
groups, across `atrium`, `crate`, `lamp`, `space`, `space-lights`,
`space-cameras` and `space-anim`:

| What it would lose | Mesh nodes |
|---|---|
| a material name | 62 |
| a material shared with other nodes | 40 |
| emissive | 2 |
| `alphaMode BLEND` | 1 |

**No fixture has UVs, vertex colours, textures, or accessor or mesh extras.**

So:
- A richer `add` that carries the material's name, emissive, alpha and
  double-sided makes **all 13 named-material top-level nodes** copyable and
  undoable.
- The 13 groups need the subtree `add`.
- Palette objects and placed models already copy. A placed model is a node
  plus `extras.atrium.model` (10-18 §5.1 item 1).
- A new world starts from `newWorldDocument` (`http-routes.js` L632–638), not
  from legacy content. So owners' own worlds are mostly palette, pads and
  models, which copy today. Legacy content is mainly the commons, which is
  seeded from `space.gltf` (`PREBRIEF-worldload-address-sync.md`).
- **PROD's real mix isn't measured.** `p6` is the operator's survey for it
  (§2.9).

### 2.6 Shared materials (`p5`)
- In `atrium.gltf`, `Column-1` and `Column-2` share one material, "Marble",
  which is used by 9 primitives. **Today, setting `Column-1`'s colour turns
  all nine red** (`world.setField`, the `send` path). That's how glTF sharing
  works, and nothing in Atrium says so.
- `ingestNode` gives every added primitive its own material. So a copy or a
  restore through `add` **never shares**, whatever the richer `add` carries
  (RA-L3).

### 2.7 Other edits and extras
- **`send` can already write `emissiveFactor`, `alphaMode`, `alphaCutoff` and
  `doubleSided`** on a material (`send-policy.js` L57–68). The SOM Inspector
  can make an object emissive, and Duplicate then refuses it. The Edit panel
  doesn't expose these fields.
- **`checkAtriumExtras` accepts unknown `extras.atrium` keys without looking
  at them** (`send-policy.js` L160–203). An `origin` or `copiedFrom` would pass
  today with any value, up to the 1 MiB message.
- **`send` can't write node `extras`** except the named leaves (`NODE_FIELDS`
  L51 and the teleporter, model, animation, `objectId` and behaviour leaves).
  So a value set at `add` time can only change by deleting the node and adding
  it again.
- **The behaviour leaf's `origin` must be `"local"`** (`behavior-spec.js` L88,
  L621). The design meant `origin` for the URL an imported behaviour came from
  (§5.4).

### 2.8 Facts for the copy step
- **Visitors can't select anything.** Selection is Edit mode, gated by
  `canEditNow()` (`app.js` L1567). Outside Edit mode, a click on an object
  whose behaviour listens for `select` sends `activate`
  (`activate-click.js`; `app.js` L55, L980).
- **The client uses no browser storage at all** (no `localStorage` or
  `sessionStorage` anywhere in `apps/client/src` or `packages/client/src`).
  **Moving between worlds happens in the page**: `app.js` never changes
  `location`. So a clipboard held in memory survives a teleport, but not a
  reload or another tab.
- **What the client knows about the world it's in:**
  - its address, `/worlds/<username>/<slug>` (`world-registry.js` L33, L126);
  - its own `userId`, from `hello` (`hello.server.json`).
- **What it doesn't know:**
  - **`hello` doesn't carry the world's owner or the world's id.**
  - No endpoint resolves a user id to a username.
- **No route renames a user** (the auth routes are `register`, `login`,
  `logout` and `me`). So today a username in an address is permanent. C4 chose
  ids because usernames "may change".
- **Behaviours in another world:** Duplicate remaps the copy's
  self-references and keeps its grants (F10, `edit-duplicate.js` L289–309).
  Pasted into another world, a grant names an object id that doesn't exist
  there.
- **Models:** library URLs are root-relative (`/assets/library/…`) and mean
  the server they were placed on. `storedUrl` (`library-catalog.js` L309)
  already resolves such a path against a world's base.

### 2.9 The probes (`devtasks/spike-richer-add/`, run from the repo root)
| Probe | What it shows |
|---|---|
| `p1-fixtures.mjs <files…>` | Duplicate's first refusal per top-level node (§2.5; run on `tests/fixtures/*.gltf devtasks/harness/group.gltf`) |
| `p2-losses.mjs <files…>` | everything each mesh node would lose, at any depth (§2.5; run on the seven files named there) |
| `p3-malformed.mjs` | malformed `add`s through the validator, `addNode`, save and reload (§2.3) |
| `p4-avatar-dump.mjs` | the real session handler: an anonymous visitor's malformed avatar stops joins (§2.3) |
| `p5-shared-material.mjs` | a colour edit on one column changes all nine (§2.6) |
| `p6-db-survey.mjs <db copy>` | **the operator's host survey**: §2.5's two tables for every saved world in a copy of the database. It prints counts only, and was tested on a scratch database holding two fixtures and one bad row |

**The operator's survey (optional, before deciding RA-L2 and RA-L6).** On the
host, against a backup made with `sqlite3 <db> ".backup /tmp/atrium-survey.db"`
(never a plain file copy):
```bash
cd <a checkout at f42b5fe or later, after pnpm install>
node devtasks/spike-richer-add/p6-db-survey.mjs /tmp/atrium-survey.db
rm /tmp/atrium-survey.db
```

## 3. Decisions (for the operator)

**RA-L1. The live defect (§2.3).**
- **(a) Recommended: its own small round first (`add-check`),** as the design split
  out step 0, its live security issue (design status notes; §9 step 0).
  §4 is its whole contract: the strict check of **today's** fields on every `add`, avatars included. The richer
  `add` then widens a tested check rather than writing one.
- (b) Fold it into the richer `add` round. One round fewer, but the fix waits
  for the larger change and its review.

**RA-L2. What the richer `add` carries.**
- **(a) Recommended: 10-18's list, without accessor or buffer names:**
  - **the material:** `name`, `extras`, `emissiveFactor`, `alphaMode`,
    `alphaCutoff`, `doubleSided`, plus today's three factors;
  - **the mesh and primitive:** `extras`;
  - **the attributes:** `TEXCOORD_0`, `TEXCOORD_1` and `COLOR_0`.
  
  Accessor and buffer names and `extras` stay refused (none in any fixture).
  UVs and vertex colours are in no fixture either (§2.5). They're for step 7's
  import and export, and for textures later, and they cost the round little.
- (b) Only what content uses today: the material's name, emissive, alpha and
  double-sided. UVs and colours come with textures or step 7.
- (c) (a), plus accessor and buffer names treated as droppable (not content).
  This relaxes D5, which so far has never dropped anything.

**RA-L3. Shared materials (§2.6).**
- **(a) Recommended: a copy, a duplicate and a restore each get their own
  material.** D5 gains one stated exception: "material sharing isn't kept".
  The Undo note says that a restored object no longer shares its material's
  edits. Copies being independent is what Copy should mean anyway.
- (b) Copies are independent, but Undo refuses to restore an object whose
  material is shared, keeping D5 strict for Undo. Deleting a column then can't
  be undone.
- (c) Carry the sharing (a reference to an existing material). That needs
  material identity: the same authority question as material pointers (4d-1
  passdown §5.1). Not now.

**RA-L4. Avatars.**
- **(a) Recommended:** avatar `add`s get `add-check`'s geometry and material
  rules, and **none of the richer fields**. An avatar `add` carrying any of them
  is refused. Avatars aren't copied or restored, so the new fields would only
  widen what an anonymous visitor can send.
- (b) The same rules as world adds.

**RA-L5. Bounds** (4c passdown §4.1: bound every stored or forwarded string).
- **(a) Recommended, provisional:**
  - names (mesh and material): at most 256 characters, as `NAME_MAX`;
  - each mesh, primitive or material `extras`: at most 16 KiB of JSON, and no
    `atrium` key (Atrium's data lives on the node);
  - at most 64 primitives per mesh;
  - `alphaMode`: one of `OPAQUE`, `MASK` or `BLEND`;
  - `alphaCutoff`: a finite number of 0 or more;
  - every colour and factor: finite and within [0, 1].
- (b) Other numbers. Nothing else in the design depends on them.

**RA-L6. Rounds and order.**
- **(a) Recommended:** `add-check`, then `richer-add`, then `copy-objects`
  (single objects only). The subtree `add` is recorded as the next placement
  round: the evidence is §2.5's 13 groups, and it would also make deleting a
  group undoable (design §4.5).
- (b) The subtree `add` before `copy-objects`, so copying the commons' lamps
  and furniture works from the start. That's a larger protocol change, with a
  pre-brief of its own.

**CP-L1. How a visitor copies.**
- **(a) Recommended: a read-only Inspect mode** for anyone who can't edit,
  beside the Edit toggle:
  - it selects with Edit mode's rules (`edit-selection.js`);
  - it shows a read-only panel with **Copy**, the object's credit (CP-L3), its
    behaviour if it has one (design Q6: visitors may read scripts), and C2's
    note;
  - clicks in Inspect mode don't send `activate`.
  
  Owners get Copy and Paste in Edit mode.
- (b) A Copy item on right-click, with no mode. It's smaller, but it needs a
  pointer gesture the client doesn't have yet, and it shows nothing before
  copying.

**CP-L2. The clipboard.**
- **(a) Recommended:** in memory, one object at a time. It survives teleports
  but not a reload (§2.8). Paste puts the copy at the palette's spot ahead of
  you.
- (b) `localStorage`, so it survives a reload and works across tabs. It would
  be the client's first stored state, with the questions that come with that
  (a stale copy, size, other worlds' tabs).

**CP-L3. The credit's shape (C4).**
- **(a) Recommended, keeping C4's ids:**
  - `extras.atrium.origin = { creator: <user id>, world: <world id>, at:
    <ISO date> }` is set at the first copy and never changed after;
  - `extras.atrium.copiedFrom = { world: <world id>, at }` is replaced by each
    copy.
  
  The server work this needs: `hello` gains the world's id and its owner's id,
  and a small public route resolves user and world ids to the current names
  shown in the panel.
- (b) Store the addresses the client already has: `/worlds/<user>/<slug>`,
  and the username. There's no server change, and usernames can't change
  today (§2.8). This is a change to C4, though: if renames ever arrive, old
  credits would show old names.

**CP-L4. What the server checks on the credit.**
- **(a) Recommended:** form and bounds only (ids in the server's id form, a
  date, nothing else). It can't verify where an object came from (C4: "credit,
  not proof"). Once checked, the credit can't be changed by `send` (§2.7).
- (b) Nothing, as today (§2.7). Unbounded, so not this.

**CP-L5. Behaviours on paste.**
- **(a) Recommended (design §6 item 3):**
  - the behaviour arrives with `enabled: false`;
  - self-references are remapped to the copy (F10);
  - **grants to other objects are dropped**, because they name objects in
    another world (§2.8);
  - the panel shows that it came from another world and needs enabling.
  
  `origin` stays `"local"` until step 7 gives it a URL form.
- (b) Disabled, with the grants kept as ids that point nowhere.

**CP-L6. Models.**
- **(a) Recommended:**
  - a root-relative model URL is made absolute against the source world's
    server when it's copied, so a paste on another server still loads it;
  - pinned `sha256` and `bounds` travel unchanged;
  - a library URL's credit is "Library", not a user (library-sky §9 item 1).
- (b) Refuse to copy a root-relative model to another server.

**CP-L7. Where C2's note goes** (models-by-url L12 (b) put it here). "Visitors
can see and copy anything in this world."
- **(a) Recommended:** in the Inspect panel, and beside the world's visibility
  setting where it is made public.
- (b) Only in the Inspect panel.

## 4. The contract for `add-check` (as recommended)
- **A1, one rule in two places, pinned by vectors.** On the server,
  `checkAddMesh(node, { avatar })` in `send-policy.js`. On the client,
  `packages/client/src/add-spec.js`, built like `model-spec.js`. Both read
  `tests/fixtures/add-mesh-vectors.json`: every accepted and refused case, with
  its reason. A node with no `mesh` passes.
- **A2, the mesh:**
  - `mesh` is an object with only `name` (a string, at most 256 characters)
    and `primitives` (an array of 1–64 entries);
  - each primitive has only `attributes`, `indices` and `material`;
  - `attributes` has `POSITION`, and `NORMAL` optionally, and nothing else;
  - POSITION is an array of finite numbers whose length is a multiple of 3,
    at least 9, at most 3 × 65,536;
  - NORMAL, when present, has POSITION's length and only finite numbers;
  - `indices`, when present, is an array of integers, each 0 ≤ i < the vertex
    count, with a length that's a multiple of 3. Without indices, the vertex
    count is a multiple of 3.
- **A3, the material:** an object with only `pbrMetallicRoughness`, which
  holds only:
  - `baseColorFactor`: 4 finite numbers in [0, 1];
  - `metallicFactor` and `roughnessFactor`: each a finite number in [0, 1].
  
  Every first-party add already sends exactly this (§2.2).
- **A4, where it runs:** in the `add` handler, after K6 (transform values)
  and before the first world change, for avatar and world adds alike. It fails
  closed, as V9 does: an exception refuses the `add` with `INVALID_VALUE`. The
  refusal is `INVALID_VALUE` with `mesh: <reason>`.
- **A5, the client:**
  - Duplicate and Undo run the client copy as part of `duplicateRuleProblem`,
    so a legacy node the server would refuse is refused with its reason,
    rather than sent and refused;
  - the avatar's own `add` is unchanged (it already passes).
- **A6, the schema (AGENTS rule 1):** `add.client.json` and `add.server.json`
  type the mesh to match A2 and A3 where JSON Schema can say it (keys, types,
  lengths). The value rules stay in A1. The protocol tests change with it.
- **Tests:**
  - the vectors in both suites;
  - `p4` as a server test on port 0. A visitor's malformed avatar `add` is
    refused, and a later visitor's join gets its `som-dump`. **Run it on
    today's code first and see it fail** (4d-1 passdown §3);
  - `p3`'s cases as refusals;
  - the palette, pad, avatar and Duplicate descriptors as acceptances, built by
    the real builders (the seam rule).
- **Release:** a server and protocol round. DEV restarts at the deploy, and
  acceptance needs a hard reload in every tab. Rolling back loses nothing
  (there's no new stored data).

## 5. The contract sketch for `richer-add` (written out in Rev 1, after RA-L2–RA-L5)
- **A1's rule widens** by RA-L2 and RA-L5. Avatar adds keep `add-check`'s set
  (RA-L4).
- **`ingestNode` keeps the new fields**, on the server and every client
  (§2.1).
- **`buildDescriptor` emits them;** `materialProblem` and `meshProblem` narrow
  to what's still refused. Undo's canonical form (`prepareRestore`) changes
  shape: undo entries live only in memory, so nothing is migrated.
- **Checks that matter:**
  - `p1` and `p2` rerun: the 13 named-material nodes copy;
  - the commons' `ground-plane` and `crate-01` can be deleted and restored
    (10-18 §4.6);
  - in the browser: an emissive copy glows, a `BLEND` copy is transparent, a
    double-sided copy shows its back, and a `COLOR_0` copy is coloured.
  
  All of these on a duplicate, a restore and a reload.
- **RA-L3's note** goes into the Undo text, and into the D5 comment in
  `edit-duplicate.js`.

## 6. The sketch for `copy-objects` (its own revision after CP-L1–CP-L7)
- The client: Inspect mode (CP-L1); the clipboard (CP-L2); Paste through
  Duplicate's builder with a new `objectId` (as `prepareDuplicate`); the credit
  stamped by the client (CP-L3); behaviours (CP-L5); model URLs (CP-L6); the
  note (CP-L7).
- The server: the credit's form check in `checkAtriumExtras` (CP-L4). If
  CP-L3 (a): `hello`'s world and owner ids, and the name route.
- A paste is an ordinary `add`, so Undo removes it.

## 7. Worker rules and release path
As scripting-4d-1 (`PREBRIEF-scripting-4d.md` §8), with these specifics:
- **`add-check` in three commits, each runnable:**
  1. the vectors and both copies of the rule;
  2. the handler and the schema;
  3. the client (Duplicate and Undo) and the full suites, with the handoff.
- **The seam rule:** acceptance tests build descriptors with the real
  builders (`threeGeometryToGltfPrimitive`, `prepareDuplicate`) and send
  them through the real `attachSessionHandlers`.
- **A new check must fail on today's code** before its PASS counts.
- **Server test files run one at a time** (AGENTS.md gotcha), and new tests
  use port 0.
- **One outside review of this pre-brief and one of each round's code.** The
  reviewer gets the files at a pinned commit and runs `p3` and `p4` if they
  can.
- **Never push to `main` between a round's release merge and PROD
  `COMPLETE`.**

## 8. Notes for the brief author
- **The check is about what `ingestNode` keeps, not what glTF allows.** A field
  that would be silently dropped is refused, so the server never holds less
  than the sender meant, and Duplicate's lossless rule (D5) is enforced at the
  server too.
- **Size is already bounded** by the 1 MiB message; vertex and index counts
  are bounded by what `Uint16Array` can address. Don't add a second byte
  limit.
- **Write `p4` into the round's tests first, on today's code**, and keep its
  failure in the handoff.

## 9. Review log
- **Rev 0** (2026-11-02, morning PT, `f42b5fe`): drafted by Claude from the
  operator's "let's do the richer add and copy". Probes `p1`–`p6` run. Not yet
  reviewed.
