# Pre-brief: the richer `add` (`richer-add`)

Status: **DRAFT, Revision 1.3 (2026-11-05). Decided (operator, 2026-11-05):
RA-L2 (c) modified (names dropped, extras refused) and RA-L3 (a), with a revisit trigger (§3); RA-L6 and how the round
runs, "no preference", so Claude's recommendations: RA-L6 (a) and the fast lane
(§6.1).** The contract for the second of the three rounds in
`PREBRIEF-richer-add-copy.md`, written out from that file's §5 sketch, as
`add-check` was carved out into `PREBRIEF-add-check.md`. A fresh Claude agent
checked Rev 1.1 against the code (§7). **Next: one outside review of this file
(ChatGPT),** then FINAL.
- **What it widens.** `PREBRIEF-add-check.md` FINAL Rev 1.1 is the rule this
  round widens: its A1–A4 widen for world adds, its A5 (avatars) stays exactly
  as it is, and A6–A10 are unchanged. Read that file first.
- **Against `main` at `cdfe88a8`** (DEV = MAIN = PROD, `add-check` shipped).
  Every line number below is at that commit. The combined pre-brief's facts
  were at `8fc82bb5`; `add-check` moved most of them (§2).
- **How it was checked.** Claude read every cited line at `cdfe88a8`, reran
  `p1`, `p2` and `p5` (same results as Rev 0.2 of the combined file), and ran
  two new probes, `p8` and `p9` (§2.8). `p6` was extended for this round's
  questions and tested on a scratch database; it hasn't been run on PROD since
  `1e36f42`. The app wasn't opened in a browser.
- **The outside reviews folded in** (of the combined pre-brief's Rev 0.1, at
  `923bd444`): `REVIEW-richer-add-copy-rev0.1-claude.md` (**CR**) and
  `REVIEW-richer-add-copy-rev0.1-chatgpt.md` (**GR**). Taken here: FLOAT
  attributes only (CR-S4, GR-S5), `COLOR_0`'s type (CR-S4), `alphaCutoff`
  carried (CR-S4, corrected in §2.4), canonical defaults (CR-S4), one buffer
  per `ingestNode` call (CR-M2), the version-skew capability (CR-S4), and
  "emissive renders self-lit", not "glows" (GR-N1, GR-S5). Their RA-L2 and
  RA-L3 views are in §3.
- **Sources:** `PREBRIEF-richer-add-copy.md` Rev 0.3 (§1, §2.4–2.7, §3, §5);
  `PREBRIEF-add-check.md` Rev 1.1; the two reviews; `Atrium-Passdown-2026-10-18-undo-redo.md`
  §4.6 and §5.1 item 1 (what the richer `add` carries, and that Duplicate's and
  Undo's rules widen with it); `PREBRIEF-edit-mode-ui-1b-2.md` N3/D5
  (Duplicate's lossless rule).

## 1. What this delivers
**Most legacy content can be duplicated, and deleted and undone, without losing
anything a save keeps.** Concretely:
- a world `add` can carry a material's name, `extras`, emissive, alpha mode and
  cutoff, and double-sided; mesh and primitive `extras`; and (RA-L2) UVs and
  vertex colours;
- the server and every client keep all of it, through the same
  `SOMDocument.ingestNode`, and a save, a join and a reload keep it too;
- Duplicate and Undo stop refusing the 13 named-material top-level objects in
  the fixtures (the commons' `ground-plane` and `crate-01`, `atrium.gltf`'s
  floors), and PROD's 18 (§2.5);
- avatars are unchanged: an anonymous visitor can send nothing new;
- an unreloaded tab can't silently restore a poorer copy (§2.7).

**Not in this round:** groups (the subtree `add`); textures; lights, cameras,
skins, morph targets and animation on `add`; editing emissive, alpha or
double-sided in the Edit panel; copying between worlds (`copy-objects`);
anything about `send` (it already writes these material fields, §2.4).

## 2. Verified facts (at `cdfe88a8`)

### 2.1 The `add` path after `add-check`
- **The schema types the mesh** (`add.client.json`; `add.server.json`'s `node`
  is identical): `mesh`, each primitive, `attributes`, `material` and
  `pbrMetallicRoughness` are `additionalProperties: false`. A world `add` with
  `TEXCOORD_0` or `alphaMode` is refused by the schema today (`UNKNOWN_MESSAGE`).
- **One rule in two places:** `checkAddNode` in `send-policy.js` (L2104–2124,
  with `materialAddProblem` L1990–2006 and `primitiveShapeProblem` L2013–2043)
  and `packages/client/src/add-spec.js` (L257–274, the same functions at
  L146–200). Both read `tests/fixtures/add-node-vectors.json`: **60 vectors,
  16 accepted.** The reason codes are `ADD_REASONS` (L1910–1932; `add-spec.js`
  L68–90).
- **A9's shared ranges** are `isUnitRange`, `isUnitRangeVec4`,
  `isUnitRangeVec3`, `isNonNegativeFinite` and `isFloat32`
  (`send-policy.js` L1888–1907, mirrored in `add-spec.js` L46–65).
  `materialValueOk` (L1411–1423) uses them, so `send` already refuses an
  emissive or a factor outside [0, 1] and an `alphaMode` outside the three
  values. They're tested inline in each suite, not as JSON vectors.
- **The handler** (`session.js` L1231–1458): the mutation gate (L1279–1285);
  K6 with `translation` (L1315–1323); `format` (L1325–1330); the avatar's own
  `checkAddNode` in a `try` (L1332–1348); for world adds, `checkAddNode` first
  in the V9 `try` (L1359–1377); `world.addNode` (L1421); then the broadcast of
  `msg.node` as sent (L1431–1451). **Since `add-check`, what is broadcast is
  exactly what A1 accepts,** so "the rule" and "what's forwarded" are the same
  set. This round must keep them so.
- **The session keeps its `hello` capabilities** (`capabilities: msg.capabilities ?? {}`,
  L776), and the server already gates on one: the script host must have
  `scriptRunner === 3` (L560, L821).

### 2.2 What `ingestNode` keeps (`SOMDocument.js` L781–852, unchanged by `add-check`)
- **Kept:** the node's name, TRS and `extras`; the mesh name; POSITION and
  NORMAL as VEC3 `Float32Array`; indices as `Uint16Array`; per primitive, a new,
  **unnamed** material with `baseColorFactor`, `metallicFactor` and
  `roughnessFactor`.
- **Everything this round adds is dropped today** (`p8` (c)): sent with
  `TEXCOORD_0`, `COLOR_0`, mesh and primitive `extras` and a material with a
  name, `extras`, emissive, `BLEND`, a cutoff and `doubleSided`, the node comes
  out with POSITION only and a default, unnamed material. (The schema refuses
  such an `add` before `ingestNode` today; `p8` calls `ingestNode` directly.)
- **One buffer per primitive** (L804; `p8` (e): a 3-primitive call adds 3).
  `ingestExternalScene` already shares one buffer per call (L881–882).
- **Deleting a node prunes what it used:** `removeSubtree` (L429–455) collects
  the mesh and disposes, through `pruneCandidateProperties`, whatever nothing
  else still uses, buffers included. A buffer shared by one call's accessors is
  pruned with its node.
- **Four callers:** the server's two world builders (`world.js` L583 in
  `createWorld`, L731 in `createWorldFromDocument`) and the client's two
  (`AtriumClient.js` L1217, its own avatar; L1571, `_onAdd`). **The client
  doesn't validate incoming messages** (no `validate` in `AtriumClient.js`), so
  an older client ingests a richer broadcast with its older `ingestNode`
  (§2.7).
- **Material names aren't in the SOM's name space.** `_registerObject`
  (L282) is called for nodes, animations and camera and light aliases only, and
  nothing looks a material up by name (`grep`). So a copy's material can keep
  the original's name, as glTF allows.

### 2.3 Duplicate and Undo today (`apps/client/src/edit-duplicate.js`)
- **D5's mesh rules:** `accessorProblem` (L109–124) refuses an accessor or
  buffer with a name, `extras` or extensions, a sparse accessor, and a non-VEC3,
  non-FLOAT or normalized POSITION or NORMAL. `materialProblem` (L126–138)
  refuses a material with a name, `extras`, extensions, textures, emissive, any
  alpha mode but `OPAQUE`, or double-sided. `meshProblem` (L140–167) refuses
  morph weights and targets, mesh and primitive extensions and `extras`, any
  mode but triangles, attributes other than POSITION and NORMAL, and an index
  above 65,534 (`MAX_INDEX`, L37: CR-N1 is closed).
- **A7 is in:** `prepareDuplicate` (L332–346) and `prepareRestore` (L360–369)
  run `add-spec.js` on the descriptor they built (`addSpecProblem`, L309–312),
  as reason `add`.
- **`buildDescriptor` (L185–218)** always emits the three factors, and the mesh
  name only when it isn't empty. `sendableArray` (L176–178) is
  `Array.from(acc.getArray())`: **raw values**, so a normalized-integer
  attribute would go out as 0–255 (CR-S4).
- **How Undo compares.** `sameDescriptor` (`edit-undo.js` L68–84) is exact on
  every key and number, **but not on key order** (it compares key sets with
  `Object.keys` and `hasOwn`; `prepareRestore`'s comment says "key order
  included", which overstates it). An add's entry is a capture of the node
  **after** it was ingested (`acceptAdd`, L342–354), and an undo checks a fresh
  capture against it (L547–550). So what matters is that `prepareRestore` is
  deterministic and a fixed point: `prepareRestore(ingest(d))` equals `d` for
  every `d` it emits.
- **Sharing is already lost today, silently (`p8` (f)).** `materialProblem`
  never looks at sharing: an **unnamed** material used by two nodes passes,
  and a restore gives the node its own copy. The fixtures' shared materials are
  all named, so today they're refused for the name, not the sharing.
- **So is a shared mesh (`p8` (g)):** nothing looks at a mesh's node users, so
  a node whose mesh is also another node's duplicates and restores today, and
  the restore gets its own mesh. No fixture has one; `p6` now counts them.

### 2.4 What a save keeps of a material (`p8` (b))
glTF-Transform's writer (`@gltf-transform/core` 4.3.0, `index.modern.js`
L5463–5482) writes `alphaMode` only when it isn't `OPAQUE`, **`alphaCutoff`
only when `alphaMode` is `MASK`**, `doubleSided` only when true, and each factor
only when it isn't glTF's default. Measured:

| Live material | Written | Read back |
|---|---|---|
| `OPAQUE`, cutoff 0.3 | nothing | cutoff 0.5 |
| `BLEND`, cutoff 0.3 | `alphaMode: BLEND` | cutoff 0.5 |
| `MASK`, cutoff 0.3 | `alphaMode: MASK, alphaCutoff: 0.3` | cutoff 0.3 |
| `MASK`, cutoff 0.5 | `alphaMode: MASK, alphaCutoff: 0.5` | cutoff 0.5 |

- **So the combined pre-brief's "`alphaCutoff` hole" (CR-S4) is narrower than
  it said.** `send` can set a cutoff on an `OPAQUE` material (`materialValueOk`
  doesn't look at the mode), and Duplicate drops it today. But a save, a
  joiner's `som-dump` and a reload drop it too, and three.js ignores it outside
  `MASK` (`@gltf-transform/view` 4.4.0 L899–914 sets `alphaTest` only for
  `MASK`). Today it can't arise at all for `MASK`, because Duplicate refuses
  every mode but `OPAQUE`. **This round carries the cutoff where a save keeps
  it, with `MASK`, and nowhere else** (R1, R7).
- **The writer's tolerance (`p8` (h)):** a vector factor within 1e-5 of its
  default (`MathUtils.eq`, `index.modern.js` L891, used for `baseColorFactor`
  and `emissiveFactor`) isn't written: `emissiveFactor [5e-6, 0, 0]` and
  `baseColorFactor [1, 1, 1, 0.999995]` both read back as the default. Scalar
  factors and booleans are compared exactly. This is true today for
  `baseColorFactor`.
- **"Lossless" in D5 therefore means: everything a save keeps.** A value only
  the live document holds, that no joiner or reload ever sees, isn't a loss.

### 2.5 What content copies (`p1`, `p2`, `p8` (a), PROD's `p6`)
- **The fixtures (`p1` on `tests/fixtures/*.gltf devtasks/harness/group.gltf`,
  `p2` on the seven files `atrium`, `crate`, `lamp`, `space`, `space-lights`,
  `space-cameras`, `space-anim`; rerun at `cdfe88a8`, unchanged):** of 35
  top-level nodes Duplicate accepts 1; 13 are refused for a material name and
  13 for children. Across seven files, mesh nodes would lose: a material name
  (62), a shared material (40), emissive (2), `BLEND` (1).
- **No fixture has any label this round would decide on** (`p8` (a): 8 files,
  195 accessors, 8 buffers): no accessor or buffer name or `extras`, no
  normalized or sparse accessor, no mesh, primitive or material `extras`. No
  fixture has UVs or vertex colours (`p2`).
- **PROD (operator's `p6`, 2026-11-05, at `1e36f42`):** 23 worlds, 437
  top-level objects: 410 copy today, 18 are refused for a material name, 9 for
  children. Primitives with a material name: 36; emissive: 1. **No shared
  materials, no alpha, no double-sided, no attributes beyond POSITION and
  NORMAL, no textures.**
- **Not counted on PROD then:** accessor and buffer labels, mesh, primitive and
  material `extras`, non-FLOAT attributes, and `MASK` cutoffs. **`p6` counts
  them now** (tested on a scratch database with a labelled accessor, buffer
  `extras` and mesh `extras`: all found). By construction PROD probably has
  none: new worlds start from `newWorldDocument` (`home-world.js` L52) and
  `ingestNode` never writes a label. The rerun is a release step (§6).

So, under every RA-L2 option, the 13 fixture objects and PROD's 18 copy and
restore: RA-L2 and RA-L3 differ only for content not seen yet.

### 2.6 How the new fields render (`p9`, and `@gltf-transform/view` 4.4.0's source)
`p9` builds a triangle with VEC4 `COLOR_0` and a material with emissive,
`BLEND` and `doubleSided`, and views it through `DocumentView`, headless (a stub
image provider, no WebGL). The three.js material comes out
`MeshStandardMaterial` with `vertexColors: true`, `transparent: true`,
`side: DoubleSide` and the emissive colour, and the geometry's colour attribute
has item size 4. The source agrees: L154 (`useVertexColors` from `COLOR_0`),
L196, L897–914 (side, `BLEND` with `depthWrite = false`, `MASK` with
`alphaTest`), L923–924 (emissive). **An emissive object renders self-lit:**
Atrium has no bloom, so it doesn't glow (GR-N1). Nothing has been seen in a
browser.

### 2.7 Version skew
- **The case (CR-S4):** after this round deploys, a tab that hasn't reloaded
  still runs `cdfe88a8`'s client. When the server restarts every tab reconnects
  and reads the whole world from the `som-dump` with `readJSON`, which keeps
  everything; but an object another tab adds or restores **after** that reaches
  the stale tab as an `add` broadcast, and its older `ingestNode` drops the new
  fields (§2.2). Its old D5 rules then see a plain material and accept it.
  Deleting that object and pressing Undo in the stale tab re-adds the poorer
  copy, and the new server accepts it, because poorer is still valid. **The
  loss is silent and saved.**
- **The tool exists:** the `hello` capabilities, as the script host uses them
  (§2.1). **But `capabilities` is `additionalProperties: false`**
  (`hello.client.json`; `p8` (d): `{ scriptRunner: 3 }` passes, an unknown
  capability fails), so an older server refuses a client that announces a new
  one. That's why `scriptRunner` is sent only on a same-origin connection
  (`AtriumClient.js` L750–757; `app.js` L1241–1248): a cross-origin connection
  is always anonymous, so it never edits a world with an owner (signin-sync I1).
  The new capability can ride exactly where `scriptRunner` does.
- **Not every editing session is the app:** with no owner, a world's mutation
  policy is `open` and anyone may edit (`isMutator`, `session.js` L646–664),
  which is how most server tests and the protocol inspector send world adds,
  with `hello`s that carry no `scriptRunner`. A rule that required the new
  capability of every world `add` would break all of them; R6 keys on the
  stale app's own signature instead.
- **Two server test files do carry `scriptRunner` and send world adds**
  (fresh-agent check, reproduced): `world-total.test.js` (its `hello` helper,
  L82, `scriptRunner: 3`) and `behavior-leaf.test.js` (L327, `scriptRunner:
  2`). Under R6 four of their tests would be refused; their `hello`s gain
  `addFields: 2` (§5). `activate.test.js`, `script-host.test.js` and
  `behavior-walk.test.js` also carry it, with no world `add` that R6 refuses.
- **The harness asserts the exact `hello`:** `devtasks/harness/checks/scripting-4d/c1.py`
  L53 expects `{ tick, scriptRunner: 3 }`, so it updates with R6.
- **A hard-reload note doesn't prevent it** (CR-S4): nothing tells a stale tab
  it's stale.

### 2.8 The probes (`devtasks/spike-richer-add/`, run from the repo root)
| Probe | What it shows |
|---|---|
| `p1-fixtures.mjs <files…>`, `p2-losses.mjs <files…>` | Duplicate's first refusal per top-level node, and everything each mesh node would lose (§2.5) |
| `p5-shared-material.mjs` | a colour edit on one column changes all nine sharing "Marble" |
| `p6-db-survey.mjs <db copy>` | the PROD survey. **New for this round:** per primitive, accessor and buffer names and `extras` (RA-L2), mesh, primitive and material `extras`, attributes that aren't plain FLOAT, `MASK` cutoffs other than 0.5, and meshes shared by several nodes |
| **`p8-richer-add-facts.mjs`** (new) | (a) labels in the fixtures; (b) what the writer keeps of a material; (c) what `ingestNode` keeps of the richer fields today; (d) the `hello` schema and an unknown capability; (e) buffers per `ingestNode` call; (f) an unnamed shared material and (g) a shared mesh through today's Duplicate and Undo; (h) the writer's 1e-5 tolerance |
| **`p9-render-mapping.mjs`** (new) | the new fields through `DocumentView`, headless (§2.6) |

## 3. Decisions
Decided in the combined pre-brief and `PREBRIEF-add-check.md`, and binding
here: RA-L1 (a), RA-L4 (a) (avatars get none of the richer fields), RA-L5 (a)
(the bounds, which R1 applies to the new fields), RA-L7 (a), RA-L8 (a).

**RA-L2. What the richer `add` carries.** **Decided (operator, 2026-11-05):
(c), modified in Rev 1.3: accessor and buffer names are dropped, their `extras`
are refused** (a second ChatGPT review, S5: `extras` can carry application data;
names are labels). It costs nothing today: no fixture has either, and nothing
Atrium writes makes one. Every option carries the material's
`name`, `extras`, `emissiveFactor`, `alphaMode`, `alphaCutoff` (with `MASK`,
§2.4) and `doubleSided`, and mesh and primitive `extras`.

| | (a) | (b) | **(c) Recommended** |
|---|---|---|---|
| UVs (`TEXCOORD_0`, `TEXCOORD_1`) and vertex colours (`COLOR_0`), FLOAT only | carried | refused | carried |
| Accessor and buffer names and `extras` | refused | refused | **dropped**, a stated D5 exception |

- **Claude (c), before the modification:** the labels are on the containers, not the geometry. `add`
  sends no accessors (the receiver builds new ones from plain arrays), a buffer
  can't be carried faithfully anyway (a file's buffer holds many meshes, and
  `ingestNode` makes its own, §2.2), nothing in Atrium or three.js reads them,
  and step 7's export doesn't need them. Refusing them stops a delete being
  undone for something nobody can see or change. A restored object loses them
  for good (CR-N3: after an Undo it's the only copy).
- **GR (a):** they may hold provenance or pipeline metadata that later tools
  expect, and Undo "ordinarily means restoring what was removed"; or (c) for
  Copy and Duplicate only, with Undo refusing.
- **CR:** agrees with (c).
- **What's at stake today: nothing measured.** No fixture has a label (§2.5),
  and PROD probably has none (the `p6` rerun will say). The choice decides
  what happens to content imported later, by step 7 or a hand-made file.
- **UVs and vertex colours** are in no fixture and not on PROD. They're for
  step 7's import and export and for textures later, and they cost this round
  one attribute rule each. (b) leaves them to those rounds.
- **Encoding (not a decision; CR-S4, GR-S5):** FLOAT only, never normalized,
  never sparse. A normalized-integer `COLOR_0` (Blender's usual export) or
  `TEXCOORD_*` is refused by Duplicate's rules with a reason; models by URL
  carry such files untouched.

**RA-L3. Shared materials.** **Decided (operator, 2026-11-05): (a), as
recommended, with the revisit trigger below.** `ingestNode` gives every primitive its own
material, so a copy, a duplicate or a restore never shares (§2.2).
- **(a) Recommended: each gets its own material,** as a stated D5 exception.
  The Undo button says so for that object (R8).
- (b) Copies and duplicates are independent, but Undo refuses to restore an
  object any of whose materials is shared (with another node, or between its
  own primitives). Deleting it then can't be undone.
- (c) Carry the sharing (a reference to an existing material). That needs
  material identity, the authority question of material pointers (4d-1
  passdown §5.1). Not now.
- **Claude (a):** under (b), deleting `atrium.gltf`'s `FloorAccent` (one
  material, "DarkStone", on 6 primitives) or `Ceiling` ("StoneWall", 5) can't be
  undone, and what (a) loses is that one recolour reaches every primitive using
  the material, which nothing in Atrium shows or explains (`p5`). **And D5
  already loses sharing today** for an unnamed shared material or a shared mesh
  (§2.3, `p8` (f), (g)): (b) would make Undo newly refuse objects it restores
  now. **Corrected in Rev 1.2:** Rev 1.1 (and the question put to the operator)
  said deleting an `atrium.gltf` **column** couldn't be undone under (b). The
  columns are children of the `Columns` group, which Duplicate and Undo refuse
  under every option (`edit-duplicate.js` L252), so that example was wrong; the
  two top-level objects above are the real ones.
- **GR (b):** delete one of two objects sharing a material, recolour the other, Undo: the
  restored column has the old colour and no longer follows shared edits. A
  note doesn't keep Undo's meaning; refuse until identity exists.
- **CR:** agrees with (a).
- **PROD has no shared materials** (§2.5), so (a) and (b) differ only for the
  fixtures and content added later.

**RA-L6. What comes after this round.** **(a), as recommended** (operator,
2026-11-05: "no preference"). (`add-check`, the first of RA-L6's three rounds,
has shipped.)
- **(a) Recommended:** `copy-objects` next (single objects, CP-L1–CP-L7 in the
  combined file), and the subtree `add` recorded as the next placement round
  after it: §2.5's 13 fixture groups and PROD's 9 are the evidence, and it would
  also make deleting a group undoable.
- (b) The subtree `add` before `copy-objects`, so copying the commons' lamps
  and furniture works from the start. A larger protocol change, with a
  pre-brief of its own.
- **Reviews:** both (a). This decision doesn't change this round's contract.

**The revisit trigger for RA-L2 and RA-L3** (operator, 2026-11-05: "can we make
changes later to address ChatGPT's concerns?"). Yes: switching RA-L3 to (b) is
one rule in `prepareRestore`, refusing labels is one in `accessorProblem`, and
carrying sharing is RA-L3 (c), which needs material identity. Neither concern
can arise on PROD today: it has no shared materials, and nothing in Atrium can
create one (every `add` gets its own material, and `send` can't link them);
adds never write a label, and no fixture or seed has one. The one lasting cost
is that an object restored meanwhile keeps its own material. **Reopen both
decisions when any of these happens:** step 7's import lands (the first way
labelled or shared content can arrive); material identity is designed (4d-1
passdown §5.1); or the pre-PROD `p6` run (§6) finds accessor or buffer labels,
a shared material or a shared mesh.

## 4. The contract
R1–R10 extend `PREBRIEF-add-check.md`'s A1–A10. Where this file says nothing,
that file holds.

- **R1, A1–A4 widen, for world adds only.** Each new field is optional. Every
  bound is RA-L5's.
  
  | Where | New field | Rule |
  |---|---|---|
  | `mesh` | `extras` | a plain object, no `atrium` key, at most 16 KiB (UTF-8 of `JSON.stringify`), and every number in it finite (a wire `1e999` is `Infinity` after `JSON.parse`, held live, saved as `null`); the size is checked before the walk |
  | each primitive | `extras` | the same |
  | `attributes` | `TEXCOORD_0`, `TEXCOORD_1` | an array of exactly 2 × the vertex count, each a number finite as a Float32; `TEXCOORD_1` only with `TEXCOORD_0` (glTF: set indices start at 0 and are consecutive) |
  | `attributes` | `COLOR_0` | an array of exactly 3 × or 4 × the vertex count, each finite and in [0, 1] (`isUnitRange`, like every colour) |
  | `material` | `name` | a string of at most 256 characters |
  | `material` | `extras` | as mesh `extras` |
  | `material` | `emissiveFactor` | `isUnitRangeVec3` |
  | `material` | `alphaMode` | `OPAQUE`, `MASK` or `BLEND` |
  | `material` | `alphaCutoff` | `isNonNegativeFinite`, **and only when `alphaMode` is `MASK`** (§2.4: a save keeps it nowhere else, so it would be dropped) |
  | `material` | `doubleSided` | a boolean |
  
  - The vertex count is POSITION's length ÷ 3, as today. **Lengths and key sets
    first** (add-check round 2's R4): every new array's length is checked in
    `primitiveShapeProblem`, before any primitive's values.
  - Explicit defaults (`alphaMode: "OPAQUE"`, `doubleSided: false`,
    `emissiveFactor: [0, 0, 0]`) are accepted: they're kept, as the default.
  - Node `extras` keep `add-check`'s rule (no finiteness walk): out of scope
    here, and recorded for a later audit.
  - Unknown keys are refused as today, with today's codes (`TANGENT`,
    `occlusionTexture`, `mode` and so on).
- **R2, avatars: A5 unchanged.** An avatar `add` carrying any R1 field is
  refused with a new code, **`avatar-fields`**: "an avatar carries only
  POSITION, NORMAL, indices and the three material factors". A key that isn't
  an R1 field keeps today's code. So every avatar vector in the file keeps its
  verdict and its reason.
- **R3, the reason codes.** New: `avatar-fields`, `part-extras` (a mesh,
  primitive or material `extras` that isn't a plain object, carries `atrium`,
  is over 16 KiB, or holds a number that isn't finite), `material-name`, `texcoord-length`, `texcoord-value`,
  `color-length`, `color-value`. Widened text: `attribute-keys`, `material-keys`
  (the new allowed sets) and `material-value` (the new values, including a
  cutoff without `MASK`). Both copies' `ADD_REASONS` stay identical. The brief
  may add a code where a case needs it, and says so.
- **R4, `ingestNode` keeps every R1 field,** on the server and every client
  (one function, §2.2):
  - mesh `extras` (`mesh.setExtras`), primitive `extras`;
  - `TEXCOORD_n` as VEC2 FLOAT; `COLOR_0` as VEC3 if its length is 3 × the
    vertex count, else VEC4 (unambiguous for any count ≥ 1);
  - the material: `createMaterial(name ?? '')`, `extras`, `emissiveFactor`,
    `alphaMode`, `alphaCutoff`, `doubleSided`, as given;
  - **one buffer per `ingestNode` call,** created on the first accessor and
    shared by every accessor of that call (CR-M2; CR `q4`: ingest cost grows
    with the document's buffer count). A node with no mesh creates none;
  - nothing else changes: an absent field leaves glTF-Transform's default.
  
  `ingestNode` still doesn't check: `checkAddNode` runs first on the server,
  and a client ingests only what the server broadcast.
- **R5, the schemas (AGENTS rule 1).** `add.client.json` and `add.server.json`
  gain R1's keys and types where JSON Schema can say them (types, the enum,
  `maxLength` 256, `minItems`/`maxItems` 3 for `emissiveFactor`); the value
  rules stay in R1. `hello.client.json`'s `capabilities` gains R6's
  `addFields`: `{ "type": "integer", "minimum": 1 }`, so a later page with
  `addFields: 3` still connects to this server (unlike `scriptRunner`'s enum). The protocol tests change with them.
- **R6, the version-skew capability (CR-S4).**
  - **The client** sends `capabilities.addFields = 2` in `hello`, **on exactly
    the connections that send `scriptRunner`** (the same `connect` option's
    condition, `AtriumClient.js` L756–757), and never elsewhere: an older
    server refuses an unknown capability (§2.7). "2" names the field set: 1 was
    `add-check`'s, never sent.
  - **The server** refuses a **world** `add` from a session whose
    capabilities carry `scriptRunner` (any value) **and not** `addFields` of 2
    or more,
    after the mutation gate (L1279–1285) and before the non-avatar checks:
    `INVALID_VALUE`, message `this page is older than the server: reload it to
    keep editing`. (It doesn't contain "already in use", which the palette
    retries on.) That pair is exactly an unreloaded first-party tab:
    every app tab since 4b-2 sends `scriptRunner` on every connection that can
    edit (§2.7), and the new one adds `addFields`. **A session with neither is
    left alone:** the server tests' own `hello`s (16 files send world adds as an
    owner or in an open world), the protocol inspector, and a cross-origin
    client in an `open` world (`isMutator`, `session.js` L659–664) keep working
    unchanged, and their adds pass R1 like any other. **Not caught:** a pre-4b-2
    tab (no `scriptRunner`; none can still be open), and a stale tab on a
    cross-origin connection to an `open` world (no `scriptRunner` there).
    Every PROD world has an owner (the commons' policy is `owner` or
    `read-only`), so the second is theoretical, on DEV or a test server only.
  - **Avatar adds are never refused for it**, so a stale tab still joins and
    is still seen.
  - `send`, `remove` and everything else are unaffected: only an `add` can
    restore a poorer copy.
- **R7, Duplicate and Undo (`edit-duplicate.js`).**
  - **The rules narrow to what's still lost.** `materialProblem` drops its
    name, `extras`, emissive, alpha-mode and double-sided refusals and keeps
    extensions and textures. `meshProblem` allows mesh and primitive `extras`
    and the R1 attributes, each FLOAT, not normalized, not sparse, with
    `TEXCOORD_n` VEC2 and `COLOR_0` VEC3 or VEC4; everything else it refuses
    today it still refuses. `accessorProblem` stops checking accessor and
    buffer **names** (RA-L2 (c), modified), and keeps every other check,
    `extras` included.
  - **`buildDescriptor` emits the new fields canonically** (CR-S4): mesh
    `extras`, primitive `extras`, material `name` and `extras` only when not
    empty; `emissiveFactor` only when the writer would write it (not within
    1e-5 of `[0, 0, 0]`, the writer's own `MathUtils.eq` rule, §2.4); `alphaMode` only when not
    `OPAQUE`; `alphaCutoff` only when `alphaMode` is `MASK` and the cutoff isn't
    0.5; `doubleSided` only when true; the attributes when present. Today's
    three factors stay always emitted, so a descriptor built today and one built
    after this round differ only where the object has a new field. `extras`
    are deep-cloned, as the node's are.
  - **The fixed point:** for every node the rules accept, `prepareRestore` of
    the node that `ingestNode` builds from `prepareRestore`'s descriptor is
    `sameDescriptor`-equal to that descriptor, and so is `prepareRestore` after
    a save and a reload. **One stated limit:** `baseColorFactor` stays always
    emitted (today's form), so a base colour within 1e-5 of `[1, 1, 1, 1]`
    but not equal to it matches live and not after a reload; it's invisible
    and true today. The test for the save-and-reload half skips that case and
    says so.
  - A7 stays: the built descriptor goes through `add-spec.js` at click time.
- **R8, the stated exceptions.** The D5 comment (`edit-duplicate.js` L15–19)
  lists what an `add` doesn't keep, so the rule stays honest:
  - accessor and buffer names (RA-L2 (c), modified): a restored object loses them for good (CR-N3). Their `extras` are refused, not dropped;
  - material sharing (RA-L3 (a)): **the Undo button's title for that entry
    adds "(it comes back with its own material)"**. `prepareRestore` returns
    `sharedMaterial: true` when the node's mesh has more than one node user, or
    any of its materials has more than one primitive user, counting only
    primitives of meshes some node still uses (a file world isn't healed, so an
    orphan mesh's primitive mustn't count); `edit-undo.js` keeps it on the delete's entry (and on every
    re-capture) and `label('undo')` appends the text. Redo needs no text.
  - **not an exception:** a cutoff outside `MASK`, which no save keeps (§2.4),
    and a vector factor within 1e-5 of its default, which no save keeps
    either. (`send` can still make present clients and a later joiner
    disagree: `MASK` 0.3, then `BLEND`, a save, then `MASK` again. That's
    `send`'s, out of scope, and recorded for the same audit as node `extras`.)
- **R9, nothing is migrated.** Undo entries live only in memory (a reload clears
  them); saved worlds are untouched, and documents written before this round
  read as they do today. A world written after it reads in `cdfe88a8` too
  (every field is plain glTF), so a rollback stores nothing to undo.
- **R10, what doesn't change:** A5's numbers; A6–A10; `send` and its material
  ranges; the Edit panel; the palette, pad and avatar builders (they emit none
  of the new fields, and still pass); models and library placements (no mesh).

## 5. Tests and proofs
- **Run on today's code first, and keep the failures in the handoff:** the new
  end-to-end tests below on `cdfe88a8` (the schema refuses every richer `add`).
- **The vectors,** in both suites, every case, with these changes:
  - two existing world vectors flip to accepted: "attributes with an extra
    attribute" (`TEXCOORD_0`) and "material with an extra key"
    (`alphaMode: BLEND`). Each gets a
    replacement refusal with a key that stays unknown (`TANGENT`,
    `occlusionTexture`);
  - per R1 field: an accepted world vector, an avatar vector refused with
    `avatar-fields`, and each refusal (wrong type, wrong length, a value just
    outside, `atrium` in an `extras`, 16 KiB + 1, a cutoff with `BLEND`,
    `TEXCOORD_1` without `TEXCOORD_0`, `COLOR_0` of 5 × the vertex count);
  - `add-node-boundaries.test.js`: the exact 16 KiB edges for the new
    `extras`, and the lengths-first proxy for each new array.
- **A new server test file, port 0, through the real `attachSessionHandlers`**
  (the seam rule). For a world `add` carrying every R1 field:
  - accepted and broadcast; a present client's `ingestNode` keeps every field;
  - a later joiner reads its `som-dump` with the client's own `WebIO` and
    `KHRONOS_EXTENSIONS` and finds every field;
  - `serialize` → `createWorldFromDocument` → `serialize` keeps every field;
  - the document gains **one** buffer, and deleting the node removes it;
  - an avatar `add` with any R1 field: refused, nothing broadcast;
  - R6: a world `add` from a session whose `hello` had `{ scriptRunner: 3 }`
    without `addFields`: refused with R6's text, nothing broadcast, and that
    session's avatar `add` accepted; with `{ scriptRunner: 3, addFields: 2 }`:
    accepted; with `addFields: 3`: accepted; with neither (`{ tick: … }`
    only): accepted;
  - **existing tests:** `world-total.test.js`'s and `behavior-leaf.test.js`'s
    `hello`s gain `addFields: 2` (§2.7), in commit 3, and every other server
    file still passes unchanged.
- **`packages/som`:** `ingestNode` keeps each field; `COLOR_0` VEC3 and VEC4;
  one buffer for a 64-primitive call; a call without a mesh creates none.
- **`apps/client`:**
  - the existing tests that refuse `TEXCOORD_0` (`edit-duplicate.test.js`
    L200–206), emissive, `BLEND` and double-sided (L226–236), and mesh,
    primitive and material `extras` and a material name (L239–252) change to
    accept and emit them; their extensions and textures cases stay refused, and
    in the accessor-label cases (L253–263), the name cases (the vertex and the
    index accessor's) change to "dropped" (the name isn't in the descriptor and
    the copy is accepted) and the `extras` and extensions cases stay refused;
    a buffer with a name is accepted and one with `extras` refused. Normalized and integer
    `COLOR_0`/`TEXCOORD_0`, a VEC3 `TEXCOORD_0`, a sparse one, textures and
    extensions are still refused;
  - **the fixed point (R7)** over every top-level node of every fixture world
    that the rules accept, and over a hand-made node with every new field;
  - `p1` as a test: the 13 named-material fixture nodes now pass
    `duplicateRuleProblem`; the commons' `ground-plane` and `crate-01` through
    `prepareRestore`;
  - RA-L3 (a): `atrium.gltf`'s `FloorAccent` and `Ceiling` restore, the Undo
    title carries R8's text, and the restored node's primitives each have their
    own material; a node whose mesh another node uses gets the text too; an
    orphan mesh's primitive doesn't make a material count as shared;
  - the canonical form: an `OPAQUE` material with cutoff 0.3 emits no cutoff; a
    `MASK` one emits it.
- **`packages/renderer-three`:** `p9` as a test, through the real
  `document-view.js` if it can run headless, otherwise through
  `DocumentView` as `p9` does.
- **`packages/client`:** `hello` carries `addFields: 2` exactly when it carries
  `scriptRunner`.
- **Proofs** (each break made, the named tests seen failing, the file restored
  from a saved copy):
  - (p1) `ingestNode` back to one buffer per primitive: the one-buffer tests
    fail;
  - (p2) `alphaCutoff` emitted whatever the mode: the canonical-form test and
    the fixed point fail;
  - (p3) R6's server check removed: the stale-session test fails;
  - (p4) R2 removed (avatars allowed the new fields): the `avatar-fields`
    vectors fail in both suites;
  - (p5) `COLOR_0`'s range check removed: its value vectors fail in both suites;
  - (p6) `ingestNode` stops keeping material `name`: the end-to-end and
    fixed-point tests fail.
- **Claude's checks before DEV acceptance (outside the pipeline):** on the
  published SHA, `p1`, `p2` and `p8` rerun (the 13 copy, the richer fields
  kept); `add-check`'s `p3`, `p4`, `p7` and `review-q/q2` still refused; the
  browser regression set `h1`–`h6` and `c2`.
- **The operator's DEV acceptance:** in the commons, Duplicate `crate-01`,
  then delete and Undo `ground-plane`; through the SOM Inspector make a palette
  cube emissive, `BLEND` with alpha 0.5, and double-sided, then Duplicate it,
  delete and Undo it, and reload: it renders self-lit, transparent and with its
  back face each time. An unreloaded second tab, opened before the deploy:
  Duplicate is refused with R6's text, and a reload fixes it.

## 6. Worker rules and release path
As `add-check` (`PREBRIEF-add-check.md` §6), with these specifics:
- **Four commits, each runnable:**
  1. the vectors, both copies of the widened rule and their unit tests (R1–R3);
  2. `ingestNode` (R4) with the SOM tests, the schemas (R5) and the new server
     test file;
  3. the capability (R6): `AtriumClient.js`, the handler, the hello schema,
     their tests;
  4. Duplicate and Undo (R7, R8), the renderer test, the full suites, proofs
     (p1)–(p6) and the handoff.
- **Files:**
  - `packages/server/src/send-policy.js`, `session.js`;
  - `packages/som/src/SOMDocument.js`;
  - `packages/protocol/src/schemas/add.client.json`, `add.server.json`,
    `hello.client.json`;
  - `packages/client/src/add-spec.js`, `AtriumClient.js`;
  - `apps/client/src/edit-duplicate.js`, `edit-undo.js`;
  - `tests/fixtures/add-node-vectors.json`;
  - `devtasks/harness/checks/`: the checks that assert the exact `hello`
    (`scripting-4d/c1.py` L53, and any other the brief finds by searching for
    `scriptRunner`), updated to expect `addFields: 2`;
  - test files under `packages/*/test/`, `packages/*/tests/` and
    `apps/client/tests/`.
  
  **No other file.** If the brief or the implementation finds another must
  change, stop and ask. (`app.js` needn't change: it already passes the
  `scriptRunner` option R6 reuses, and the Undo title comes from `label`.)
- **A new check must fail on today's code** before its PASS counts.
- **Server test files run one at a time,** each under `timeout 180`, new tests
  on port 0.
- **One outside review of this pre-brief and one of the round's code** (§6.1).
- **Release:** a server, SOM, protocol and client round. DEV restarts at the
  deploy, and acceptance needs a hard reload in every tab. No `package.json` or
  lockfile change. **A rollback** stores nothing to undo (R9), but a tab loaded
  on the new client then can't connect to the old server (its `hello` carries
  `addFields`, §2.7) until it's hard-reloaded, as at 4d's `scriptRunner: 3`.
- **Before the PROD deploy, the operator reruns `p6`** at this file's commit or
  later (§2.5). Its new counters say whether RA-L2's labels or non-FLOAT
  attributes exist on PROD: nonzero counts are shown to Claude before PROD.
  Those objects keep working where they are; Duplicate and Undo drop their
  labels (RA-L2 (c)) or refuse what's still refused, and labels or shared
  materials reopen RA-L2 and RA-L3 (§3). On the host:
  ```bash
  sqlite3 /var/lib/atrium/atrium.db ".backup /tmp/atrium-survey.db"
  rm -rf /root/tmp-survey && git clone -q --depth 1 https://github.com/joshmaurice/atrium /root/tmp-survey && cd /root/tmp-survey
  git log -1 --oneline
  pnpm install --frozen-lockfile --ignore-scripts
  node devtasks/spike-richer-add/p6-db-survey.mjs /tmp/atrium-survey.db
  rm /tmp/atrium-survey.db
  cd ~ && rm -rf /root/tmp-survey
  ```
- **Never push to `main` between the release merge and PROD `COMPLETE`.**

### 6.1 How the round runs (the passdown's §4: cost matters)
Decided (operator, 2026-11-05: "no preference" on the implementation, so
Claude's recommendation):
1. **One outside review of this pre-brief** (ChatGPT, pinned to a SHA, source
   only). Claude reproduces every finding before taking it.
2. **Implementation in Claude's fast lane:** Claude implements on
   `claude/richer-add` in the four commits of §6, no OpenRouter credit, and a
   fresh Claude agent that didn't write it checks the code against this file
   before the outside review. Why not the GLM pipeline: this contract names
   every rule, file and test, so an independent implementer adds little, and
   the independence that found real bugs last round was the outside review's
   (passdown §3.1). The cost of the fast lane is that Claude reviews nothing it
   wrote: the fresh agent and the outside review do.
3. **One outside code review** (ChatGPT) of the published SHA, and a follow-up
   only if it requests changes.
4. **Publish and deploy from the host,** with the passdown §4's commands
   (`atrium-deploy-gate` for DEV, `atrium-main-approve` and
   `atrium-prod-approve` with it for MAIN and PROD, guarded on
   `atrium-release-status`). No finalizer or acceptance-gate cards. Claude
   gives the commands with the real SHA once it exists.

## 7. Review log
- **Rev 1.3** (2026-11-05, evening): a second ChatGPT review arrived, of the
  combined draft's Rev 0.1 at `923bd444` (it had been given the old prompt), so
  not a review of this file: `REVIEW-richer-add-copy-rev0.1-chatgpt-2.md`. Its
  M1, M2, S1, S2, N1 and N2 are `add-check`'s and shipped; M3 is this file's
  FLOAT rule; M4, S3, S4 and S6 are the copy round's (the combined file's
  Rev 0.4). **Taken here: its S5,** by the operator: RA-L2 (c) modified, names
  dropped and `extras` refused (§3, R7, R8, §5). Its RA-L3 caveat ("Undo must
  warn that sharing changes, and this must be tested") is R8 and §5 already.
  Its "safer cutoff bounds" isn't taken: glTF allows any cutoff ≥ 0, and a
  cutoff above 1 is a fully cut-out `MASK`, which a save keeps. Its M2's
  longer-term per-world resource budget is recorded in the combined file's §9,
  for later. **This file's own outside review is still to come.**
- **Rev 1.2** (2026-11-05): a fresh Claude agent checked Rev 1.1 against the
  code (it hadn't written it: emulated R4, R6 and R7 in a scratch copy, ran
  every server file that sends `add`, and wrote six probes). Claude reproduced
  each finding before taking it. Taken:
  - **must-fix:** two server test files' `hello`s carry `scriptRunner` and send
    world adds, so R6 would refuse four tests: they gain `addFields: 2` (§2.7,
    §5);
  - **must-fix:** `atrium.gltf`'s columns are inside a group, so RA-L3's
    example and §5's test were wrong: now `FloorAccent` and `Ceiling` (§3, §5);
  - the writer's 1e-5 tolerance (§2.4, R7, R8); a shared mesh loses its
    sharing too (§2.3, R8, the trigger, `p6`, `p8` (g)); non-finite numbers in
    the new `extras` (R1); the stale cross-origin `open`-world gap stated (R6);
    `addFields`'s schema type (R5); the harness's exact-`hello` check (§6);
    `p1`/`p2`'s file sets named (§2.5).
  
  Confirmed correct by that check: every cited line, the vectors, the schemas,
  R4's one buffer per call against prune, serialize-with-exclusions and the
  renderer, R2 (nothing new for avatars), R6's first-party senders (all through
  `connectNow`), the files list, and R7's fixed point for the 14 restorable
  fixture top-level nodes and hand-made edge cases.
- **Rev 1.1** (2026-11-05): the operator's decisions recorded (RA-L2 (c),
  RA-L3 (a) with the revisit trigger, RA-L6 (a), the fast lane), and the
  branches for the options not taken removed from R1, R7, R8 and §5. R6 now
  keys on the stale app's signature (`scriptRunner` without `addFields`), not
  on the capability alone: requiring it of every world `add` would have broken
  16 server test files' `hello`s, the protocol inspector, and `open` worlds
  (§2.7).
- **Rev 1, DRAFT** (2026-11-05, against `cdfe88a8`): written out from the
  combined pre-brief's §5 sketch after `add-check` shipped. New facts found
  while writing it:
  - **`alphaCutoff` is saved only with `MASK`** (§2.4), so "carried" means
    carried with `MASK`, R1 refuses it elsewhere, and the combined file's
    "hole" loses nothing a save keeps;
  - **sharing is already lost today** for an unnamed shared material (§2.3),
    which bears on RA-L3;
  - **no fixture has any label** RA-L2 decides on (§2.5); `p6` now counts them
    on PROD;
  - **an unknown capability fails `hello`** on an older server (§2.7), so R6
    rides where `scriptRunner` does;
  - **Undo's comparison ignores key order** (§2.3): the requirement is a fixed
    point, not an order;
  - the rendering mapping was run headless (`p9`).
  
  Reviews folded in: CR-M2 (one buffer per call), CR-S4 (encoding, `COLOR_0`'s
  type, `alphaCutoff`, canonical defaults, version skew), CR-N3 (a restored
  object loses its labels), GR-S5 (FLOAT only), GR-N1 (self-lit).
