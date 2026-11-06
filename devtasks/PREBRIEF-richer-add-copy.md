# Pre-brief: the `add` check, the richer `add`, and copying objects

Status: **DRAFT, Revision 0.4 (2026-11-05), the draft for `copy-objects`.**
Its first two rounds now have contracts of their own: **`add-check`**,
`PREBRIEF-add-check.md` FINAL Rev 1.1 (shipped to PROD as `cdfe88a8`, §4), and
**`richer-add`**, `PREBRIEF-richer-add.md` DRAFT Rev 1.4 (§5), which holds
RA-L2, RA-L3 and RA-L6. **Still open here: CP-L1–CP-L7,** each with a
recommendation. Decided (operator, 2026-11-05): RA-L1 (a), RA-L2 (c) modified (accessor and buffer names dropped, their `extras` refused), RA-L3 (a)
(with a revisit trigger), RA-L4 (a), RA-L5 (a), RA-L6 (a), RA-L7 (a), RA-L8 (a).
- **Rev 0.3 (against `cdfe88a8`):** §2.1, §2.2, §2.4 and §2.7 rechecked against
  the code (line numbers and facts changed with `add-check`); §2.3 marked closed;
  §3's RA-L2, RA-L3 and RA-L6 moved to `PREBRIEF-richer-add.md` §3 with their
  arguments; §5 and §7 now point there. CP-L1–CP-L7 and §2.8 are as in Rev 0.2,
  with §2.8's line numbers rechecked.
- **The reviews:** `REVIEW-richer-add-copy-rev0.1-claude.md` (a runtime review:
  cloned, ran every suite and `p1`–`p5`, wrote probes `q1`–`q4`) and
  `REVIEW-richer-add-copy-rev0.1-chatgpt.md` (source-only: its clone failed on
  DNS). Both agree with RA-L1 (a) and both say §4 was too narrow. They're cited
  below as **CR** and **GR** with their finding numbers (CR-M1, GR-S5 and so on).
- **Rev 0.2 is against `main` at `8fc82bb5` (PROD).** Since `f42b5fe` only
  undo-hold's client files changed (`app.js`, `edit-gesture.js`,
  `library-grid.js`, `sky-picker.js`). The server, the SOM, the protocol and
  `edit-duplicate.js` are byte-identical, so every line number below still
  holds, except in `app.js`.
- **How it was checked.** Rev 0.1: Claude read the code at `f42b5fe` and ran
  probes `p1`–`p6` (`devtasks/spike-richer-add/`, §2.9) against the real SOM, the
  real world module and the real session handler. Rev 0.2: Claude reran CR's `q2`
  at `8fc82bb5` (same results), ran a new `p7` for GR-M1 and GR-S1 through the
  real handler, re-read every source claim it relies on, and extended `p6`. The
  app itself still hasn't been opened in a browser.
- **Why now (operator, 2026-11-02):** "let's do the richer add and copy". This
  is the side track the 10-19 copy-objects passdown put between steps 3 and 4
  and later passdowns kept "in the operator's order" (10-23 edit-polish-3 §6.4).
  Step 4 has since shipped, so the copy step also has behaviours to handle.
- **One finding is a live defect on PROD (§2.3), wider than Rev 0.1 said:** an
  anonymous visitor's avatar `add` can stop everyone else joining the world,
  stall the whole server process for seconds, or make every later join download
  megabytes. An owner's `add` can save a world that then can't be loaded.
  RA-L1 asks whether to fix it alone first; both reviews say yes.
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
1. **`add-check`**: the server checks **the whole node** of every `add`, avatar
   `add`s included, against what `ingestNode` actually keeps and can store
   (Float32, Uint16). Avatars get a budget of their own, and `send` gets the
   same material ranges. This closes §2.3. Same fields as today; nothing new is
   carried.
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

## 2. Verified facts (at `f42b5fe`, Rev 0.1; §2.1, §2.2, §2.4 and §2.7 rechecked at `cdfe88a8`, Rev 0.3)

### 2.1 The `add` path (at `cdfe88a8`)
- **The schema types the mesh** since `add-check` (A8): `add.client.json`
  requires `node.name`, and `mesh`, each primitive, `attributes`, `material`
  and `pbrMetallicRoughness` are `additionalProperties: false`, with the
  fields `ingestNode` keeps. `format` is `{ "const": "gltf" }`. `add.server.json`
  has the same node shape, plus `requestSeq` and `session`.
- **The server checks the whole node** (`session.js` L1231–1458), in this
  order:
  1. `msg.id`, the avatar's name, and that an avatar has no parent;
  2. S2 (`source`), and K4/L5 (an avatar carries no `extras.atrium` but its
     `ephemeral` marker);
  3. the mutation gate (L1279–1285);
  4. for world adds: parent, name rules and `objectId` uniqueness;
  5. K6, with `translation` (L1315–1323), avatars included;
  6. `format` (L1325–1330);
  7. for avatars, `checkAddNode` with A5's budget, in a `try` of its own
     (L1332–1348); for world adds, `checkAddNode` first in the V9 `try`, then
     `checkAtriumExtras`, `checkModelHost` and the behaviour caps
     (L1355–1411).
- **The server stores what `ingestNode` keeps and broadcasts the message as
  sent** (`world.js` L573–591 and L721–739; `session.js` L1431–1451), and since
  `add-check` those are the same set. Every client applies the broadcast with
  the **same** `SOMDocument.ingestNode` (`AtriumClient.js` L1547–1571). So
  widening `ingestNode` widens the server and every client at once.
- **Limits that exist:** `maxPayload` is 1 MiB (`session.js` L31, L281); message
  depth is at most 64 (`message-depth.js`); A1–A5's bounds
  (`PREBRIEF-add-check.md` §4); the client caps a Duplicate or Restore at
  `MAX_ADD_BYTES` 1,000,000 (`edit-duplicate.js` L26).

### 2.2 What `ingestNode` keeps (`SOMDocument.js` L781–852, unchanged at `cdfe88a8`)
- **Kept:** the node's name, TRS and `extras`; the mesh name; POSITION and
  NORMAL as float VEC3; indices as `Uint16Array`; per primitive, a **new**,
  unnamed material with three factors: `baseColorFactor`, `metallicFactor`,
  `roughnessFactor`; one buffer per primitive (L804).
- **Dropped:** every other attribute, the material's name, emissive and every
  other material field, mesh, primitive and material `extras`, and
  `node.extensions` (`PREBRIEF-richer-add.md` `p8` (c)). **Since `add-check`
  none of these reach it:** the schema and `checkAddNode` refuse them first.
- **Taken without checks,** as before: wrong lengths, non-numbers, indices past
  the end or above 65535, Float32 overflow. **Since `add-check` none of these
  reach it either** (A3), and `translation` is in K6 (A2,
  `checkTransformValues`, `send-policy.js` L115–130).
- First-party adds send exactly what is kept: the avatar capsule
  (`buildAvatarDescriptor`, `geometry-utils.js` L119), the palette and pads
  (`PRIMITIVE_MATERIAL` L151; `buildPrimitiveDescriptor` L237,
  `buildTeleporterDescriptor` L262), and Duplicate and Undo (`buildDescriptor`,
  `edit-duplicate.js` L185–218).

### 2.3 The live defect: one malformed `add` stops joins (`p3`, `p4`). **Closed by `add-check` (`cdfe88a8`).**
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
- **The owner's version:** a world `add` with the same mesh stops joins **and**
  autosave (`autosave.js` L73–82) until the node is deleted.

**Rev 0.2: what the reviews added.** Each was reproduced through the real
`attachSessionHandlers` by CR, and rerun by Claude at `8fc82bb5`.
- **A world that saves but can't be read back (CR-M1).** An `add` whose
  primitive has `POSITION: []`:
  - `serialize()` **succeeds**, so the join's `som-dump` is sent and nothing is
    logged;
  - the joining client's `WebIO.readJSON` throws (`Cannot read properties of
    undefined (reading 'buffer')`), and `_onSomDump` (`AtriumClient.js` L1191)
    has no catch: the newcomer's world never loads;
  - **the owner's version is the worst case in this pre-brief.** Autosave
    writes the document without reading it back. The world then fails in
    `createWorldFromDocument` at the next boot, or as soon as it empties and is
    torn down. Nobody can enter it to delete the node: it takes a hand fix to
    the database.
  - `POSITION [0,0]` is §2.3's DataView case. `POSITION [] + indices [0,1,2]`,
    `NORMAL []` and `indices []` all save and read back.
- **One message stalls the whole server (CR-M2).** An anonymous avatar `add` of
  20,000 one-triangle primitives is 938 KiB, under the 1 MiB cap. `world.addNode`
  is synchronous on the message path (`session.js` L1383) and took **3.8 s**
  here (4.2 s for CR). Every world on that Node process stops for that time. The
  `som-dump` grows to 6.7 MiB, because `ingestNode` makes one buffer per
  primitive (`SOMDocument.js` L804).
- **Avatar size multiplies into every join (CR-M3, CR-S2, GR-M2).** K4 forbids
  only `extras.atrium` on an avatar. 900 KB of avatar `extras` is accepted and
  kept, and every later join's `som-dump` carries it: 20 such visitors make
  each newcomer download **17.3 MiB** (CR `q3`). A world allows 100 sessions
  (`maxUsers`, `session.js` L270, `world-host.js` L55). The real avatar is
  **1 primitive, 162 vertices, 22 KB** (`buildAvatarDescriptor`, measured).
- **Non-finite geometry is stored (GR-M1; `p7`).** `1e39`, `-1e39` and `3.5e38`
  in POSITION are accepted and stored as ±Infinity. Unlike `POSITION []`, saves,
  joins and reloads all still work, so this one is an invariant break (the
  object's bounds are infinite), not a second way to stop joins. Its effect in
  three.js (culling, picking) wasn't run.
- **Dropped fields are still forwarded (CR-M3; `p7`).** A 600 KB
  `node.extensions` is dropped by `ingestNode` and still broadcast in full to
  every present client, because the handler broadcasts `msg.node` as sent.
- **Clients already present (CR-N6, GR).** They receive the malformed
  broadcast and run the same `ingestNode` (`AtriumClient.js` L1557). CR found
  no schema-valid input that makes it throw. Not run in three.js or a browser.

**What it isn't:**
- World documents saved **before** today are not affected by the
  serialize-throws class. A world whose saved document couldn't serialize would
  already fail every join.
- **But CR-M1's class saves cleanly**, so PROD was surveyed for it: **no
  unreadable world** (operator's `p6`, 2026-11-05, §2.5).

### 2.4 Duplicate's and Undo's rules (`edit-duplicate.js`, at `cdfe88a8`)
- **D5 is lossless (N3):** a node can be duplicated or restored only if
  everything it has survives an `add`. Anything else is refused with a reason
  (`DUPLICATE_REASONS` L40–52, which gained `add` with A7; rules
  `duplicateRuleProblem` L249–277).
- **The mesh rules refuse:** a named or `extras`-carrying material, accessor or
  buffer; extensions; textures; emissive; any alpha mode but `OPAQUE`;
  double-sided; attributes other than POSITION and NORMAL; morph targets; any
  mode but triangles; an index above 65,534 (`accessorProblem` L109–124,
  `materialProblem` L126–138, `meshProblem` L140–167).
- **The "`alphaCutoff` hole" (CR-S4) loses nothing a save keeps** (corrected in
  Rev 0.3, `PREBRIEF-richer-add.md` §2.4): `materialProblem` never checks the
  cutoff, so an opaque material whose cutoff was set through `send` duplicates
  and restores without it, but glTF-Transform's writer writes a cutoff only
  with `MASK`, so a save, a joiner's `som-dump` and a reload drop it too.
  `richer-add` carries the cutoff with `MASK`.
- **CR-N1's off-by-one is closed:** `MAX_INDEX` (L37) is 65,534 (A7).
- **A7 is in:** `prepareDuplicate` (L332–346) and `prepareRestore` (L360–369)
  run `add-spec.js` on the built descriptor (`addSpecProblem`, L309–312).
- **`prepareRestore` is Undo's canonical form.** It uses the same rules and
  builder as Duplicate, with the node's own name and translation. Undo compares
  captures with `sameDescriptor` (`edit-undo.js` L68–84), exact on keys and
  values but **not** on key order.
- **Sharing is already lost today for an unnamed material** (Rev 0.3,
  `PREBRIEF-richer-add.md` §2.3, `p8` (f)): `materialProblem` doesn't look at
  sharing, so only the name stops the fixtures' shared materials.
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
- **PROD's real mix, measured (operator's `p6` run, 2026-11-05, at `1e36f42`):**
  23 worlds, **none unreadable**; 437 top-level objects.
  
  | Duplicate's verdict today | Top-level objects |
  |---|---|
  | copies today | 410 |
  | a named material | 18 |
  | children (groups) | 9 |
  
  | What a mesh would lose, at any depth | Primitives |
  |---|---|
  | a material name | 36 |
  | emissive | 1 |
  
  - **No shared materials, no alpha, no double-sided, no attributes beyond
    POSITION and NORMAL, no textures** on PROD;
  - **nothing that `add-check` or RA-L7's ranges would refuse** in saved
    content: the list was empty.

### 2.6 Shared materials (`p5`)
- In `atrium.gltf`, `Column-1` and `Column-2` share one material, "Marble",
  which is used by 9 primitives. **Today, setting `Column-1`'s colour turns
  all nine red** (`world.setField`, the `send` path). That's how glTF sharing
  works, and nothing in Atrium says so.
- `ingestNode` gives every added primitive its own material. So a copy or a
  restore through `add` **never shares**, whatever the richer `add` carries
  (RA-L3).

### 2.7 Other edits and extras (at `cdfe88a8`)
- **`send` can already write `emissiveFactor`, `alphaMode`, `alphaCutoff` and
  `doubleSided`** on a material (`MATERIAL_PROPS`, `send-policy.js` L59–67).
  The SOM Inspector can make an object emissive, and Duplicate then refuses it.
  The Edit panel doesn't expose these fields.
- **`send` checks material ranges since `add-check` (A9, RA-L7):**
  `materialValueOk` (L1411–1423) uses the shared predicates (L1888–1907):
  every factor and `emissiveFactor` finite and in [0, 1], `alphaCutoff` finite
  and 0 or more, `alphaMode` one of the three, `doubleSided` a boolean. It
  doesn't relate the cutoff to the mode (a cutoff on an `OPAQUE` material is
  accepted, and not saved, `PREBRIEF-richer-add.md` §2.4). Saved materials out
  of range keep working; PROD had none (`p6`).
- **`checkAtriumExtras` accepts unknown `extras.atrium` keys without looking
  at them** (`send-policy.js` L166–206). A2's 16 KiB bound covers `extras`
  **other than** `atrium` (`worldExtrasProblem` L1974–1987), so an `origin` or
  `copiedFrom` would still pass today with any value, up to the 1 MiB message.
- **`send` can't write node `extras`** except the named leaves (`NODE_FIELDS`
  L51 and the teleporter, model, animation, `objectId` and behaviour leaves).
  So a value set at `add` time can only change by deleting the node and adding
  it again.
- **The behaviour leaf's `origin` must be `"local"`** (`BEHAVIOR_KEYS`
  `behavior-spec.js` L86–88, the check at L621). The design meant `origin` for
  the URL an imported behaviour came from (§5.4).

### 2.8 Facts for the copy step
- **Visitors can't select anything.** Selection is Edit mode, gated by
  `canEditNow()` (`app.js` L1582). Outside Edit mode, a click on an object
  whose behaviour listens for `select` sends `activate`
  (`activate-click.js`; `app.js` L55, L2192).
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
  self-references and keeps its grants (F10, `remapBehaviorTargets` and `withRemappedBehavior`, `edit-duplicate.js` L291–321).
  Pasted into another world, a grant names an object id that doesn't exist
  there.
  - **Grants are positional (CR-S5, GR-M3).** `nodeMap` is a unique list whose
    entry 0 must be the object's own id (`behavior-spec.js` L775–780), and
    graph pointers bind to it **by index** (L812–819, `pointerBinding` L910–920), as do
    `/animations/<i>` references. Removing an entry shifts every later index,
    or puts it out of range so `behaviorCheck` refuses the paste.
  - **An owner chooses their objects' ids,** and any visitor can read every id
    in a public world's `som-dump`. So a hostile world can publish a behaviour
    whose grants name objects in the paster's own world (CR-S5).
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
| `p6-db-survey.mjs <db copy>` | **the operator's host survey**: §2.5's two tables for every saved world in a copy of the database. It prints counts only, and was tested on a scratch database holding two fixtures and one bad row. **Rev 0.2:** it also counts what `add-check` and RA-L7's ranges would newly refuse in saved content, flags unreadable worlds (CR-M1), and falls back to Node's built-in `node:sqlite` if `better-sqlite3` isn't built. Retested on a scratch database with an out-of-range material and a `POSITION []` world: both found |
| `p7-float32-extensions.mjs` | **Rev 0.2:** GR-M1's Float32 overflow and `node.extensions`, through the real handler and save/reload; the later joiner's `som-dump` is read with the client's own `WebIO.readJSON` |
| `review-q/q1-…`, `review-q/q2-…` | **Rev 0.2:** CR's probes, unchanged. `q2` was rerun at `8fc82bb5` (CR-M1, CR-M2, the wire `1e999`) |
| `p8-richer-add-facts.mjs`, `p9-render-mapping.mjs` | **Rev 0.3:** the facts behind `PREBRIEF-richer-add.md` (its §2.8) |

**The operator's survey** ran on PROD at `1e36f42` before `add-check`'s release
(§2.5). Its next run, with the counters `richer-add` added, is a release step of
that round: the host commands, with real paths, are in `PREBRIEF-richer-add.md`
§6.

## 3. Decisions (for the operator)

**RA-L1. The live defect (§2.3).** **Decided (operator, 2026-11-05): (a).**
- **(a) Recommended: its own small round first (`add-check`),** as the design split
  out step 0, its live security issue (design status notes; §9 step 0).
  §4 is its whole contract: the strict check of **today's** fields on every `add`, avatars included. The richer
  `add` then widens a tested check rather than writing one.
- (b) Fold it into the richer `add` round. One round fewer, but the fix waits
  for the larger change and its review.
- **Reviews:** both (a). CR: "Agree, strongly. PROD is public and §2.3 is live."
  Rev 0.2's §4 takes in both reviews' must-fixes for this round.

**RA-L2. What the richer `add` carries.** **Moved (Rev 0.3) to
`PREBRIEF-richer-add.md` §3,** with the reviews' arguments and Rev 0.3's facts
(no fixture has an accessor or buffer label; PROD's are counted by the next
`p6`). **Decided (operator, 2026-11-05): (c),** with a revisit trigger.

**RA-L3. Shared materials (§2.6).** **Moved (Rev 0.3) to
`PREBRIEF-richer-add.md` §3.** **Decided (operator, 2026-11-05): (a),** with a
revisit trigger (step 7's import, material identity, or labels or sharing found
by `p6`). New
in Rev 0.3: today's Duplicate and Undo already lose sharing for an unnamed
shared material, and PROD has no shared materials.

**RA-L4. Avatars.** **Decided (operator, 2026-11-05): (a), with these numbers.**
- **(a) Recommended (amended in Rev 0.2):** avatar `add`s get `add-check`'s
  rules, **a budget of their own**, and **none of the richer fields**. Avatars
  aren't copied or restored, so the new fields would only widen what an
  anonymous visitor can send. The budget (CR-S2, GR-M2), from the measured
  avatar (1 primitive, 162 vertices, 22 KB):
  - exactly 1 primitive;
  - at most 1,024 vertices (more than 6× the real one's 162);
  - at most 6,144 indices (the real one has 816);
  - `extras`: only `displayName`, a string of at most 256 characters (the
    server overwrites it anyway, `session.js` L1378–1381);
  - no `extensions`.
  
  The largest avatar that passes is then about 148 KB (measured, with
  worst-case 17-digit numbers), so 100 of them are about 15 MB in a join's
  `som-dump`, against about 100 MB today.
- (b) The same rules as world adds.
- (c) The server builds the avatar itself (GR-M2's "ideally"). Visitors then
  send nothing but a name. It's the strongest fix, but it changes the connect
  sequence and the identity coupling (AGENTS rule 2), so not in this round.
- **Reviews:** both (a), with a budget like this one.

**RA-L5. Bounds** (4c passdown §4.1: bound every stored or forwarded string). **Decided (operator, 2026-11-05): (a), as recommended, with Rev 0.2's additions.**
- **(a) Recommended, provisional:**
  - names (mesh and material): at most 256 characters, as `NAME_MAX`;
  - each mesh, primitive or material `extras`: at most 16 KiB of JSON, and no
    `atrium` key (Atrium's data lives on the node);
  - at most 64 primitives per mesh;
  - `alphaMode`: one of `OPAQUE`, `MASK` or `BLEND`;
  - `alphaCutoff`: a finite number of 0 or more;
  - every colour and factor: finite and within [0, 1].
  
  **Rev 0.2 adds** (CR-N1, CR-N2, GR-M1, GR-N2):
  - every geometry number must be finite **as a Float32**
    (`Number.isFinite(Math.fround(v))`), POSITION, NORMAL and the new
    attributes alike;
  - an indexed primitive has at most 65,535 vertices, so no index is 65535;
  - `indices`, when present, has at least 3 entries;
  - "16 KiB" means the UTF-8 bytes of `JSON.stringify(value)`;
  - every length is checked **before** any per-element work (CR-M2).
- (b) Other numbers. Nothing else in the design depends on them.

**RA-L6. Rounds and order.** **Moved (Rev 0.3) to
`PREBRIEF-richer-add.md` §3,** since its first round has shipped: it now orders
`copy-objects` and the subtree `add` after `richer-add`. **(a),** `copy-objects`
first (operator: "no preference", so the recommendation; both reviews (a)).

**RA-L7. The [0, 1] material ranges on `send` (new in Rev 0.2; CR-S1, GR-S2).**
**Decided (operator, 2026-11-05): (a).**
- **(a) Recommended: in `add-check`, one shared predicate for `add` and
  `send`,** as K6 did for transforms. Otherwise `add-check` itself creates
  objects that can't be duplicated or undo-deleted (§2.7). glTF requires the
  ranges anyway. Saved materials already out of range keep working where they
  are; `p6` counts them.
- (b) A separate audit round for `send` and the world loaders (GR-S2's
  framing). `add-check` stays smaller, but ships the regression until then.

**RA-L8. Defence in depth for documents that can't be read back (new in
Rev 0.2; CR-M1).** **Decided (operator, 2026-11-05): (a).** `add-check` closes every way in that the reviews found, and
`richer-add` widens `ingestNode` next. These two make the next miss fail
loudly instead of quietly:
- **(a) Recommended: both in `add-check`:**
  - **autosave reads back** what it serialized (`readJSON`, as
    `createWorldFromDocument` does) and keeps the previous row if that fails,
    logging it once. A world can't be saved into a state it can't load from;
  - **a failed join says so:** when the join's serialize fails
    (`session.js` L935–937), the joiner gets `error` `WORLD_UNAVAILABLE` (an
    existing code, sent today by the refusal server, `world-registry.js` L78,
    and shown by `teleport-failure.js` L23) instead of silence;
  - **the client says so too:** `_onSomDump` (`AtriumClient.js` L1191) catches
    a `readJSON` failure and reports it the same way, rather than leaving the
    newcomer on a world that never loads.
  - **Corrected in `PREBRIEF-add-check.md` §2.5:** the join message's code is
    `WORLD_UNREADABLE`, not `WORLD_UNAVAILABLE`, and the app gains a panel for
    it.
- (b) Only the two join messages. Smaller, but leaves CR-M1's persistence path open to
  a future `ingestNode` bug.
- (c) Neither, as Rev 0.1.

**CP-L1. How a visitor copies.**
- **(a) Recommended: a read-only Inspect mode** for anyone who can't edit,
  beside the Edit toggle:
  - it selects with Edit mode's rules (`edit-selection.js`);
  - it shows a read-only panel with **Copy**, the object's credit (CP-L3), its
    behaviour if it has one (design Q6: visitors may read scripts), and C2's
    note;
  - clicks in Inspect mode don't send `activate`;
  - **Rev 0.4 (second ChatGPT review, CP-L1 note): Inspect doesn't select
    hidden objects.** Edit mode deliberately keeps them selectable
    (`visibleHits(…, { includeHidden: true })`, `app.js` L2134–2138, F-L8, so
    the owner can un-hide one); "Edit mode's rules" must not carry that over, so
    Inspect picks with `includeHidden: false`, as `PointerInputBridge` does
    outside Edit mode. (A hidden object is already in every visitor's
    `som-dump`, so this is about what a visitor is offered, not exposure.)
  
  Owners get Copy and Paste in Edit mode.
- (b) A Copy item on right-click, with no mode. It's smaller, but it needs a
  pointer gesture the client doesn't have yet, and it shows nothing before
  copying.
- **Reviews:** both (a). Graphs are already in every visitor's `som-dump`, so
  Inspect adds UI, not exposure (CR). The panel renders other users' names,
  prose and graph labels, so it uses the existing `textContent` / `escHtml`
  rule (`graph-import-panel.js`, `app.js`) (CR-N5, GR).

**CP-L2. The clipboard.**
- **(a) Recommended:** in memory, one object at a time. It survives teleports
  but not a reload (§2.8). Paste puts the copy at the palette's spot ahead of
  you.
- (b) `localStorage`, so it survives a reload and works across tabs. It would
  be the client's first stored state, with the questions that come with that
  (a stale copy, size, other worlds' tabs).
- **Reviews:** both (a). **GR-S8 adds:** build and deep-clone the descriptor
  **at Copy**, with the source world's id and base URL, holding no live SOM
  objects (a teleport replaces the SOM). At Paste, apply the new name,
  `objectId`, credit and behaviour change, then recount the message's bytes. A
  failed paste leaves the clipboard as it was.
- **Rev 0.4 (second ChatGPT review, S6): the paste's lifecycle.** A paste is an
  ordinary `add`, so it reuses the structure tracker and Undo's request and
  answer handling (`edit-structure.js`, `edit-undo.js`), as Duplicate does: a
  refused paste shows the server's text and records nothing; a teleport while a
  paste is pending is the tracker's existing "the world did not answer" case;
  a change to the original after Copy doesn't reach the clipboard (it's a
  snapshot). The copy revision checks each against the tracker's code.

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
- **(c) New in Rev 0.2 (CR-S6's choice): store both,** the address and username
  for display and the ids as stable keys, with no name route and no new
  `hello` fields this round. That's (b)'s zero server work with (a)'s ids kept
  for a later rename. It still needs `hello` to carry the world's and owner's
  ids, or the ids are left out until it does; the copy revision settles which.
- **Reviews:** both flag that the credit is **claimed, not verified** (CR-S6,
  GR-S6): a modified client can stamp any user's id, and a panel showing that
  user's current name makes the claim look authoritative. So, whatever the
  shape, the panel's wording says it: "says it was made by …", or "copied from
  <address>". **If a name route is built** (a), it answers only for worlds the
  caller can see ("a private world" otherwise) and is rate-limited. CR prefers
  (c); GR accepts (a) with that wording. **Claude now recommends (c)** for this
  round, as the smaller and less exposed choice, pending what the copy revision
  finds about `hello`.

**CP-L4. What the server checks on the credit.**
- **(a) Recommended:** form and bounds only (ids in the server's id form, a
  date, nothing else). It can't verify where an object came from (C4: "credit,
  not proof"). Once checked, the credit can't be changed by `send` (§2.7).
  Both reviews agree, with CP-L3's wording. CR notes that same-server
  provenance could later be made verifiable (the server stamps `origin` when it
  first creates an object).
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
- **Rev 0.2: "dropped" can't mean removed.** Both reviews found it (CR-S5,
  GR-M3): grants are positional (§2.8), so removing entries retargets or breaks
  the graph. And (b) is unsafe, not just untidy: a hostile world can aim grants
  at ids in the paster's world (§2.8). The reviews differ on the fix, and the
  copy revision chooses:
  - **(a1) CR:** replace each foreign grant with a **fresh, unused object id**.
    Indices stay valid, the graph passes `behaviorCheck`, and the grant points
    at nothing. The same for every `animations[].object` and
    `template.params.target` that isn't the object itself; `targets` to be
    specified;
  - **(a2) GR:** if the behaviour refers only to its own object, remap and keep
    it (disabled). If it refers to anything else, copy the object **without**
    its behaviour, with a plain warning, until a rebinding UI exists.
  
  **Claude leans to (a2)** for the first copy round: it's simpler to prove, and
  a disabled graph with dead grants is a graph nobody can make work without the
  rebinding UI anyway. Either way, the test covers `nodeMap` indices 0, 1 and
  2, literal and wired pointers, animation and template references, and
  `targets`, and the result either passes the real validator with correct
  bindings or is omitted, never silently retargeted.

**CP-L6. Models.**
- **(a) Recommended:**
  - a root-relative model URL is made absolute against the source world's
    server when it's copied, so a paste on another server still loads it;
  - pinned `sha256` and `bounds` travel unchanged;
  - a library URL's credit is "Library", not a user (library-sky §9 item 1).
- (b) Refuse to copy a root-relative model to another server.
- **Rev 0.2 amendments (CR-S7, GR-S7):**
  - **resolve at Paste, not Copy:** the clipboard keeps the source base, and the
    URL is made absolute only when the destination's origin differs. A
    same-server paste stays root-relative, and survives a domain move;
  - **"Library" credit only when the resolved origin is the destination's
    own,** or `https://evil.example/assets/library/x.glb` would be labelled as
    Atrium's library;
  - **an `http://` source (a DEV server) gives an absolute URL that the model
    rules refuse** (`url-scheme`). The paste says so plainly, rather than
    failing silently or rewriting against the destination;
  - **another host is shown before it's fetched** (GR-S7): pasting makes the
    owner's browser fetch from that host. CR notes a hostile world can already
    make every visitor fetch any `https` URL today, so this is disclosure, not
    a new exposure;
  - **Rev 0.4 (second ChatGPT review, S4):** the resolved absolute URL goes
    through `modelUrlProblem` again at Paste, never around it; the fetch keeps
    today's protections (`model-fetch.js`: `credentials: 'omit'`,
    `referrerPolicy: 'no-referrer'`, the per-model and per-world budgets,
    confirmed in the source); and **the source base comes from the live
    connection at Copy** (the world the client is in), never from a credit
    field the object carries.

**CP-L7. Where C2's note goes** (models-by-url L12 (b) put it here). "Visitors
can see and copy anything in this world."
- **(a) Recommended:** in the Inspect panel, and beside the world's visibility
  setting where it is made public.
- (b) Only in the Inspect panel.
- **Reviews:** both (a).

## 4. The contract for `add-check`: moved
**`add-check`'s contract is now `devtasks/PREBRIEF-add-check.md`, FINAL Rev 1.1
(2026-11-05).** It was carved out of this file's Rev 0.2 §4, with the operator's
decisions (RA-L1, L4, L5, L7, L8), so that its round can be kicked off while
`richer-add`'s and `copy-objects`' decisions stay open here. Read that file, not
this one, for anything in the round. It also corrects two things this file's
Rev 0.2 §4 said:
- the message's `format` is forwarded as sent and needs pinning, as
  `node.extensions` does;
- RA-L8's join message is a new code, `WORLD_UNREADABLE`, with an app panel,
  because `WORLD_UNAVAILABLE` would show the wrong text and the app shows
  nothing for it after `session:ready`.

`richer-add` (§5) widens that file's A1–A4 and keeps its A5 for avatars.

## 5. The contract for `richer-add`: moved
**`richer-add`'s contract is now `devtasks/PREBRIEF-richer-add.md`, DRAFT
Rev 1.2 (2026-11-05),** written out from this section's Rev 0.2 sketch against
`cdfe88a8`, with RA-L2, RA-L3 and RA-L6. It widens `PREBRIEF-add-check.md`'s
A1–A4 and keeps A5. It also corrects two things the sketch said:
- **`alphaCutoff` is carried only with `MASK`,** because a save keeps it
  nowhere else; the "hole" lost nothing a save keeps (§2.4);
- **Undo's comparison ignores key order:** what the canonical form needs is a
  fixed point, `prepareRestore(ingest(d))` equal to `d`.

`copy-objects` (§6) builds on `richer-add`'s descriptor.

## 6. The sketch for `copy-objects` (its own revision after CP-L1–CP-L7)
- The client: Inspect mode (CP-L1); the clipboard (CP-L2); Paste through
  Duplicate's builder with a new `objectId` (as `prepareDuplicate`); the credit
  stamped by the client (CP-L3); behaviours (CP-L5); model URLs (CP-L6); the
  note (CP-L7).
- The server: the credit's form check in `checkAtriumExtras` (CP-L4). If
  CP-L3 (a): `hello`'s world and owner ids, and the name route, limited to
  visible worlds and rate-limited.
- A paste is an ordinary `add`, so Undo removes it.
- **Rev 0.2:** the clipboard is a deep-cloned descriptor built at Copy (CP-L2);
  the credit is worded as claimed (CP-L3); foreign grants per CP-L5 (a1) or
  (a2), never removed; model URLs resolved at Paste (CP-L6).

## 7. Worker rules and release path
`add-check`'s are in `PREBRIEF-add-check.md` §6 and `richer-add`'s in
`PREBRIEF-richer-add.md` §6. `copy-objects`' come with its own revision, on the
same pattern: the seam rule, a new check failing on today's code before its
PASS counts, server test files one at a time on port 0, one outside review of
the pre-brief and one of the code, and nothing pushed to `main` between a
release merge and PROD `COMPLETE`.

## 8. Notes for the brief author
- **The check is about what `ingestNode` keeps, not what glTF allows.** A field
  that would be silently dropped is refused, so the server never holds less
  than the sender meant, and Duplicate's lossless rule (D5) is enforced at the
  server too.
- **For world adds, size is bounded** by the 1 MiB message and the
  64-primitive cap; vertex and index counts by what `Uint16Array` can address.
  Don't add a second byte limit there.
- **For avatars, that's not enough** (Rev 0.1 said it was; CR-S2, GR-M2): one
  anonymous connection's cost is multiplied into every join. A5's budget is the
  limit.
- **"Kept" means representable, not just present:** a double that becomes
  `Infinity` in a `Float32Array` isn't kept (GR-M1).
- **Check whole nodes, not just meshes:** `translation`, `extensions` and
  `extras` all reach `ingestNode` or the broadcast (CR-M3).
- **Write `p4` into the round's tests first, on today's code**, and keep its
  failure in the handoff.

## 9. Review log
- **Rev 0.4** (2026-11-05, evening): a second ChatGPT review of Rev 0.1
  (`REVIEW-richer-add-copy-rev0.1-chatgpt-2.md`; it was given the old prompt).
  Most of it was already taken (`add-check`, `richer-add`'s FLOAT rule, Rev
  0.2's CP-L2/L3/L5/L6). New, taken: Inspect skips hidden objects (CP-L1); the
  paste's lifecycle (CP-L2); revalidation, fetch protections and the live
  source base (CP-L6); and, for `richer-add`, its S5 (RA-L2 modified, decided by
  the operator). **Recorded for later, not in these rounds:** its M2's
  per-world resource budget. The 1 MiB message cap doesn't bound a world's
  total size or its `som-dump`, and copy makes filling a world easier, though
  only for its owner (CR-S2 said the same).
- **Rev 0.3** (2026-11-05, against `cdfe88a8`, after `add-check` shipped):
  `richer-add`'s contract written out as `PREBRIEF-richer-add.md` DRAFT Rev 1.2;
  RA-L2, RA-L3 and RA-L6 moved there and decided ((c), (a), (a)); §2.1, §2.2, §2.4, §2.7 and §2.8's line
  numbers rechecked against the code; §2.3 marked closed; §2.4's `alphaCutoff`
  hole corrected; §2.9's survey block, which had placeholders, now points at
  that file's real host commands; §5 and §7 point at the two contracts. This
  file stays the draft for `copy-objects` (CP-L1–CP-L7).
- **Rev 0.2, `add-check` split out** (2026-11-05): §4 moved to
  `PREBRIEF-add-check.md` FINAL Rev 1 (then 1.1), with RA-L5 (a) confirmed; that file adds
  the `format` rule and `WORLD_UNREADABLE`. This file stays a draft for
  `richer-add` and `copy-objects`.
- **Rev 0.2, PROD survey** (2026-11-05): the operator ran `p6` at `1e36f42`.
  23 worlds, none unreadable; 410 of 437 top-level objects copy today; nothing
  saved that `add-check` would refuse; no shared materials. Recorded in §2.3,
  §2.5, RA-L3 and §4's release note.
- **Rev 0.2, decisions recorded** (2026-11-05): the operator chose RA-L1 (a),
  RA-L4 (a) with A5's numbers, RA-L7 (a) and RA-L8 (a). §4's other limits come
  from RA-L5 (a), still open; the brief for `add-check` takes them as
  recommended unless the operator says otherwise.
- **Rev 0.2** (2026-11-05, against `8fc82bb5`): after two outside reviews of
  Rev 0.1 at `923bd444`, both **CHANGES REQUESTED**:
  `REVIEW-richer-add-copy-rev0.1-claude.md` (runtime) and
  `REVIEW-richer-add-copy-rev0.1-chatgpt.md` (source-only).
  - **Taken:** §2.3 rewritten with CR-M1, CR-M2, CR-M3 and GR-M1; §4 widened
    to `checkAddNode` with Float32, avatar and `translation` rules, `send`'s
    ranges (new RA-L7), defence in depth (new RA-L8), layered refusals and
    end-to-end tests; RA-L4's budget; RA-L5's additions; §5's encoding,
    canonical-form, buffer and version-skew items; CP-L2's snapshot, CP-L3's
    claimed wording and option (c), CP-L5's positional grants, CP-L6's
    resolve-at-paste; `p6` extended, `p7` added, CR's `q1`/`q2` copied.
  - **Not taken, with reasons in place:** GR's RA-L2 (a) and RA-L3 (b) (Claude
    keeps (c) and (a), for the operator to decide); GR's server-built avatar,
    recorded as RA-L4 (c) for later; GR-S2's separate audit of the world
    loaders, partly covered by RA-L8's read-back and otherwise left for later.
  - **Recommendation changed:** CP-L3 now (c). CP-L5 is open between (a1) and
    (a2), Claude leaning (a2).
  - **Verified by Claude at `8fc82bb5`:** CR's `q2` (same results; the
    20,000-primitive add took 3.8 s); `p7` (GR-M1: stored ±Infinity, but
    saves, joins and reloads still work; `node.extensions` forwarded); the
    source claims behind K6, `materialValueOk`, the `alphaCutoff` hole, schema
    order and `nodeMap`; the avatar's size; `p6` on a scratch database.
- **Rev 0.1** (2026-11-04): RA-L2's recommendation is now (c), dropping
  accessor and buffer labels, after talking it through with the operator
  (2026-11-02 to 11-03). RA-L2 is restated as a table, because Rev 0's wording
  read as if UVs and vertex colours were refused under (a). Nothing else
  changed. Still not reviewed.
- **Rev 0** (2026-11-02, morning PT, `f42b5fe`): drafted by Claude from the
  operator's "let's do the richer add and copy". Probes `p1`–`p6` run. Not yet
  reviewed.
