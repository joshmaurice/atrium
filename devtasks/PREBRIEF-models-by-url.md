# Pre-brief: Phase 3 step 3 — models by URL (3a), then the starter library and sky (3b)

Status: **FINAL, Revision 2 (2026-10-20). Decisions L1–L19 approved by the
operator, all as recommended (§3, §12 A15, §11). Revision 2 adds §12, the
binding amendments from the operator's outside review: where §12 differs
from §2–§8, §12 governs.**
- **Drafted by Claude from a clone of `main` at `c6482bb0`.** Its runtime
  code is identical to the released `229c4a87` (DEV, MAIN record and PROD):
  the three commits since add only the edit-polish-2 passdown, design
  Revision 1.2 and the copy-objects passdown. Claims marked *probe* were run
  against the real modules (three r163, glTF-Transform 4.3, the server's
  `createWorld`) with throwaway scripts, not committed.
- **Board and host at drafting** (ops connector, 2026-10-19 ~23:05 PT):
  release `COMPLETE` at `229c4a87`, nothing ready, running or blocked, DEV and
  PROD healthy, deploy lock free. The only warning is the MAIN record vs
  `origin/main`: the uploads above.
- **Sources:** design `docs/DESIGN-phase3-placement-scripting.md` §4.3
  (models), §4.4 (starter library), §9 row 3, §10 Q4 and Q5; passdown
  2026-10-19 (copy objects) §1 C1–C4, §2 and §3.
- **Scope (L1):** this round is **3a**: models by URL in
  Edit mode (`extras.atrium.model`, a full glTF loader, live resolution,
  download and decoded limits, pinned or mutable, a placeholder with the
  reason) and the server's check of the model field on `add`. **3b** (the
  starter library, the sky, the Caddy and library host steps) is sketched in
  §9 with its decisions, for a short pre-brief of its own.
- **Out of scope:** playing a model's built-in animations and
  `extras.atrium.model.playback` (step 4); named-part overrides (later);
  the richer `add` and the copy step (passdown C1–C4, next in order);
  editing a placed model's URL (L3); Draco, meshopt and KTX2 (L7); the SOM
  Inspector and playground rendering models; a server-side fetch-and-cache.
- Line numbers are approximate, at `c6482bb0`.

## 1. What this round is

An owner in Edit mode presses **Model**, pastes an `https://` URL (or a
server path such as `/assets/library/chair.glb`), sees it checked, and saves.
The model appears 2.5 m ahead on y = 0, like a palette cube. It can be moved,
rotated, scaled, renamed, duplicated, deleted, undone and redone like any
node, because in the world it **is** an ordinary mesh-less node carrying
`extras.atrium.model = { url, sha256?, bounds? }`. Every visitor's browser
fetches the file and renders it as that node's visual. Nothing about the
model's content enters the world document.

Three things make this harder than a palette add, and most of this pre-brief
is about them:
1. **Any URL is allowed** (design Q5), and public worlds load models for
   every visitor automatically. So the loader needs limits it enforces
   itself, a timeout, cancellation, and a visible failure.
2. **Model content lives inside the scene graph that the client searches by
   name.** A part called `Door` inside a chair currently hijacks clicks, Edit
   selection and animations meant for a world node called `Door` (P4, *probe*).
3. **Everything else in the scene is rebuilt from the SOM by DocumentView**;
   a model is not in the SOM, so something has to attach it, keep it attached
   across DocumentView rebuilds, and dispose of it (P3).

## 2. What the code does today (at `c6482bb0`)

### P1. The only model loading is `source`, and it's the wrong tool
- `AtriumClient.resolveExternalReferences` (L1303) and `_loadExternalRef`
  (L1320): for every node with `extras.atrium.source`, fetch the URL
  (resolved against `worldBaseUrl`), parse it with glTF-Transform and
  **ingest it into the SOM** (`som.ingestExternalScene`). It reads `.glb` by
  extension, else JSON with **no resources**, so a multi-file `.gltf` loses
  its buffers; no size cap, no timeout, no abort. Staleness is `_worldGen`
  (bumped by connect, disconnect and both `loadWorld`s): a stale result is
  dropped.
- It runs after `som-dump` (L774) and after a file-world load (L1300). Since
  step 0 (S1/S2), clients can't set `source` and document worlds never carry
  it; it remains for operator file worlds.
- Each external ref that loads emits `world:loaded` again (L1351), and the
  app's `world:loaded` handler (`app.js` L624) **rebuilds DocumentView and
  `sceneGroup`** each time (and ends the edit session). Anything attached to
  the old `sceneGroup` is gone. Today that only matters for Stage's cameras,
  which `stage.setSceneGroup` rebuilds.
- **Design §4.3 is right that this can't be reused for models**: ingesting
  means no textures or animations through the SOM path, and model content
  would become world content. Only the pattern (resolve against the world's
  base, drop stale results) carries over.

### P2. A model node already round-trips everywhere (*probe*)
- **Server `add`** (`session.js` L744): a mesh-less node with
  `extras.atrium.model = { url, bounds }` passes every guard today. S2 looks
  only for `source`; `checkAtriumExtras` (`send-policy.js` L153) checks only
  `teleporter`; the schema (`add.client.json`) allows any `extras` object and
  no `mesh`. *Probe:* `createWorld(space.gltf)`, `addNode` of such a node,
  `serialize`, `createWorldFromDocument`: the extras survive unchanged.
- **So today any owner can already plant any value there**, e.g.
  `{ model: { url: "javascript:…" } }` (*probe*: `checkAtriumExtras` returns
  ok) or a string up to the 1 MiB message cap. Nothing reads it yet;
  once this round's loader does, every visitor's browser would act on it. The
  server check (L4, Z8) closes that before the loader ships.
- **`send`** can't write it: the allowlist (`send-policy.js`) has one node
  extras leaf, `extras.atrium.teleporter.destination` (L69); everything else
  is default deny. *Probe:* `authorizeSend` on `extras.atrium.model.url`,
  `extras.atrium.model` and `extras` all return `PERMISSION_DENIED` ("field is
  not writable on a node").
- **Duplicate and restore** (`edit-duplicate.js`): `prepareDuplicate` and
  `prepareRestore` on a mesh-less node with model extras return
  `ok: true` with the extras copied whole (*probe*, 290 bytes). So
  **Duplicate, Delete + Undo and Redo work for model nodes with no change**;
  `atriumProblem` (L69) mirrors the server's L5 check and would need the new
  rule too (Z8).

### P3. How a visual gets onto a node (DocumentView)
- `initDocumentView` (`document-view.js`): `new DocumentView(...)`,
  `docView.view(scene)` → `sceneGroup`, added to the three.js scene. The
  browser loads `@gltf-transform/view@4.3.0` from esm.sh (`index.html`
  importmap L466); `node_modules` holds 4.4.0. Both have
  `listViews(nodeDef) → Object3D[]` and the same `NodeSubject`.
- `NodeSubject` keeps **one `Object3D` per node** for the view's life
  (`_outputSingleton`) and updates name and transform in place. Its children
  sync removes only the objects it added, so **a foreign child survives**:
  Stage already parents its cameras this way (`Stage.js` L169,
  `getObjectByName(hostNode.name)` then `hostObj.add(camera)`).
- **One trap:** `detachMesh()` removes **the first child with `isGroup`**.
  `GLTFLoader`'s `gltf.scene` is a `Group`. If a mesh ever changed on a model
  node, DocumentView would remove the model instead of its own mesh group. A
  plain `Object3D` wrapper (`isGroup` false) avoids it (*probe*), and L4
  refuses a mesh on a model node anyway.
- A new node's `Object3D` may appear a frame after its `som:add`
  (`selectAddedNode`, `app.js` ~L2294, J6).

### P4. Every scene lookup is by name, and model parts would hijack them (*probe*)
A probe put a chair model (one part named `Door`) under world node `Chair`,
next to a world node `Door`, all under `sceneGroup`:

| Lookup | Where | Result today |
|---|---|---|
| `walkUpToSOMNode(part)` | `PointerInputBridge` (non-Edit pointer events), `hit-test.js` | resolves to world node **`Door`** |
| `nodeForHitObject` | Edit-mode click, `edit-selection.js` | same: the walk stops at the first `Object3D` whose name is a SOM node; GLTFLoader's empty nodes are `Object3D` |
| `getObjectByName('Door')` / `findNodeObject` | Stage cameras; the selected object (`app.js` ~L1681) | the **model part** (depth-first) |
| `AnimationMixer(sceneGroup)` clip `Door.position` | `AnimationBridge` (actions created on play, L129) | moves the **model part**, not the world node |

So without isolation, clicking a chair in Edit mode could select and drag
the world's `Door`, and the world's animations could drive the chair's
parts. Palette names (`Cube`, `Plane`, `Sphere`…) are common mesh names in
exported models, so this isn't hypothetical.

**What fixes all four (*probe*):** per placed instance, retarget the model's
clip tracks from node names to node **uuids** (three's `PropertyBinding`
matches `name || uuid`), then clear every name inside the model (keep the
original in `userData`). With that, all four lookups resolved to the world
nodes, a click on the part walked up to `Chair`, and the model's own clip
still drove its part. `SkeletonUtils.clone` maps bones by reference, not
name, so skinned models survive it.

### P5. GLTFLoader works in the test runner, without textures (*probe*)
`import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'` (the same
specifier the browser's importmap serves) resolves in Node 22 with three
r163, and `parseAsync` of a glTF-Transform-written `.glb` gives meshes,
`Object3D` empties and clips (`open: Lid.position`). Images can't load in
Node (no `createImageBitmap`, no DOM), so **texture checks must be pure
functions over measured sizes**, tested with stand-ins.

### P6. The sky already exists, under another name
- `extras.atrium.background = { type: 'equirectangular', texture }` at the
  document root is read by `loadBackground` (`load-background.js`, a
  `TextureLoader`: JPG/PNG, not `.hdr`) on `world:loaded` (`app.js` L641) and
  on any `__document__` set (L779). The server's World Info allowlist already
  permits `atrium.background.type` and `.texture` (`send-policy.js` L205), and
  the SOM Inspector edits them. `loadBackground` has no size or dimension
  limit.
- So design §4.4's "a world-level setting such as `extras.atrium.environment`
  … new" is **already built** as `background`. 3b needs UI and limits, not a
  new field (L14). Clearing a sky is `texture: ''` (a removed key is a
  refused change under A3).

### P7. Hosting and the library
- Caddy serves `/srv/atrium-dev` and `/srv/atrium` with `file_server` for
  `/apps/client/*`, `/tools/protocol-inspector/*` and `/packages/*`, with
  `hide node_modules .git …` and `Cache-Control: no-cache` (passdowns 09-28
  §4.1 and 10-14 §4). No `/assets/*` handler exists; there is no `assets/`
  directory and no `.glb` anywhere in the repo.
- `atrium-deploy` is a git checkout of the tree plus tests with no network:
  anything committed deploys; nothing is fetched. Claude's workspace can't
  reach `polyhaven.com` or `dl.polyhaven.org` (allowlist); the host can.
- Poly Haven assets are CC0 (their FAQ); attribution is suggested, not
  required. Their API is free, asks for a distinct `User-Agent`, and asks
  services that use the **live** API to credit Poly Haven.
- A page served by one Atrium server can visit a world on another
  (cross-server connect). A server path then resolves against the **world's**
  origin, so that server's `/assets/*` needs CORS headers for the visitor's
  page (3b host step).

### P8. The Edit-mode add pattern to copy
The Teleporter round (edit-polish-2) set the pattern this round follows: a
button in the Add row **with no `data-kind`** (`ep-teleporter`, `index.html`
L572; the palette handler throws on an unknown kind), its own form inside
the Edit panel, Save as a structural add (`structure.begin('add', …)`,
`undo.registerAdd`) answered through `onStructureAnswer` (`app.js` L2213),
with a form-scoped rejection (`formWaitSeq`, L1140) and the form closing on
Cancel, Escape, Edit off and reconnect. A model form is the same shape with a
check step in the middle.

## 3. Decisions for the operator

**All sixteen were approved by the operator on 2026-10-19 (~23:18 PT), each
as recommended (the option in bold).** The other options are kept as the
record of what was weighed; they are not to be reopened in the brief. L13–L15
(3b) are settled now and carry into 3b's own pre-brief.

**L1. Split step 3.** (a) One round, everything in §9 row 3. (b) **3a: models
by URL (this pre-brief), then 3b: the library, sky and host steps.** 3a is the
risky code (loader, limits, isolation, server check); 3b is mostly content,
host work and two small UI pieces that reuse 3a's loader and limits. Neither
blocks the other's review.

**L2. Where model content goes in the scene.** (a) **Under the host node's
`Object3D`, inside an unnamed plain `Object3D` wrapper, with names isolated
(P4).** Transforms, parenting, Edit handles and selection boxes follow for
free. (b) A separate layer outside `sceneGroup`, copying the host's world
matrix each frame: no name collisions, but picking needs a second raycast
and every transform path needs care.

**L3. Can a placed model's URL be changed?** (a) **No `send` of model fields
in 3a.** To change a model, delete it and add another; pinning happens in the
form at add time (L9). The server's default deny already refuses these sends;
a test pins that. (b) Allowlist `extras.atrium.model.url`, `.sha256` and
`.bounds` for `send`, with live re-resolution on `set`. Adds a server path, a
client path and a second undo shape for little gain now.

**L4. The server's check of `extras.atrium.model` on `add`.** (a) **Strict**:
a plain object with **exactly** the keys `url` (required), `sha256` and
`bounds` (optional), the rules of Z1, and **no `mesh`** on the same node.
Later steps extend the checker (step 4 adds `playback`). (b) Loose: check
`url` only, pass other keys. (c) None (design's "optional"). P2 shows why
(c) leaves today's gap open.

**L5. URL forms.** (a) **`https://…` and root-relative paths `/…` (not
`//…`)**, at most 2048 characters. `http:`, `data:`, `blob:`, `javascript:`,
`wss:` and document-relative paths (`chair.glb`) are refused, by the server
and the client alike. A root-relative path resolves against the world's
origin (`worldBaseUrl`), so in local development it may be `http://localhost`;
the rule is about what's stored. (b) Also allow document-relative paths:
their meaning would differ between file worlds and server worlds.

**L6. Multi-file `.gltf`.** (a) **Supported:** the loader fetches the
`.gltf`, then each external buffer and image itself, all against one byte
budget, and hands them to `GLTFLoader` as `blob:` URLs. Pinning a `.gltf` with
external files is refused (design follow-up B). (b) `.glb` and self-contained
`.gltf` (data URIs) only in 3a. (b) is simpler; (a) is what design §4.3's cap
("counts everything a `.gltf` pulls in") assumed.

**L7. Compressed glTF (Draco, meshopt, KTX2).** (a) **Refused in 3a with a
clear reason** ("uses Draco compression, which Atrium doesn't load yet"),
decided from `extensionsRequired`/`extensionsUsed` before parsing. Draco and
KTX2 need decoder files from a CDN; decoded limits would apply after
decompression. (b) Support meshopt only (its decoder ships with three). (c)
All three.

**L8. The limits** (design §4.3, numbers proposed):

| Limit | Proposed | Applies to |
|---|---|---|
| Download per model | **25 MB**, counted while streaming; abort when crossed | the file plus every buffer and image a `.gltf` pulls in |
| Load time per model | **30 s** from first request to parsed | per model |
| Concurrent model fetches | **4** | per page |
| Vertices per model | **500,000** after parsing | per model file |
| Texture size | **4096 px** per side | each texture |
| Texture memory per world | **256 MB**, estimated as Σ w × h × 4 × 4⁄3 | unique textures across the world's models |
| Download per world | **150 MB** | unique model files |
| Model instances per world | **256** | model nodes rendered |

A model used by several nodes is fetched and parsed **once** (keyed on the
resolved URL plus `sha256`) and counted once against the world budgets; each
node gets a clone that shares geometry and textures.

**L9. The Model form checks before it adds.** (a) **Yes:** Check loads the
URL through the real loader and limits, shows the result ("Loaded: 12,400
vertices, 3.1 MB" or the reason), measures `bounds`, and enables Save only on
success. For a `.glb`, a **Pin this version** box (off by default, design
§4.3) stores the `sha256` of the bytes it loaded. (b) Add at once and let the
placeholder report problems. (a) spends one download per check and puts
problems where the owner is looking.

**L10. A model's own animations in 3a.** (a) **Not played** (rest pose); its
clips are kept, retargeted per instance (P4), ready for step 4. (b) Autoplay
the first clip. Design Q4 makes playback a step 4 script feature with synced
state; autoplay would be per-visitor and unsynced.

**L11. Who sees a failure.** (a) **Everyone sees the placeholder** (a
wireframe box of `bounds`, or 1 m, resting on y = 0 of the node); **the
reason shows in the Edit panel** when the owner selects the node, and in the
console for everyone. (b) Placeholder for the owner only, nothing for
visitors. (a) matches design §4.3 and keeps a broken model selectable and
deletable.

**L12. The plain-language notes.** (a) **The visitor-privacy note goes in
the Model form now** ("Visitors' browsers download this file from its host,
which sees their IP addresses."); C2's "visitors can see and copy anything"
lands with the copy step, next to it. (b) Wait and add both with the copy
step.

**L13 (3b). Where the library's files live.** (a) **Outside git**: a host
directory (for example `/srv/atrium-library`) that Caddy serves at
`/assets/library/` for DEV and PROD, with CORS; `assets/library/catalog.json`
in the repo is the source of truth and pins each file's `sha256`. A repo
script, run by the operator on the host, downloads the chosen Poly Haven
assets (1k textures), packs each into a `.glb`, and writes the catalog
entries. (b) The files in git (roughly 50–150 MB for 20–30 items, permanent
repo growth; deploys carry them). (c) Git LFS (the host's git has no LFS).

**L14 (3b). The sky.** (a) **Reuse `extras.atrium.background`** (P6): a Sky
picker in Edit mode (None + the library's skies) writing the two existing
World Info leaves; library skies as equirectangular **JPG** (≤ 4096 × 2048);
`loadBackground` gets the 3a fetch limits and a dimension check. Not undoable
(document extras aren't in the undo engine). (b) A new
`extras.atrium.environment` as the design sketched, with `.hdr` support.

**L15 (3b). Credit for library items.** (a) **Don't stamp C4's `origin` on
placement.** The catalog already holds licence and attribution, and the copy
step can recognise a library URL; its key names belong to that step's
pre-brief. (b) Stamp `origin` as the library item now.

**L16. Lane.** **Full pipeline** for 3a: client, renderer and server, with a
DEV restart (the server's `add` check). Claude's headless checks (§5.1) and
the operator's outside code review come before DEV acceptance. 3b: full
pipeline for its client parts; the library build and Caddy as operator host
steps.

## 4. Contract (3a, per the approved decisions; amended by §12)

### Z1. The model spec (one rule set, two implementations)
- `extras.atrium.model` is a plain object with exactly these keys:
  - `url` (required): a string of 1–2048 characters that starts with
    `https://` (and parses as a URL) or with a single `/` (not `//`). Nothing
    else (L5).
  - `sha256` (optional): 64 lowercase hex characters.
  - `bounds` (optional): three finite numbers, each > 0 and ≤ 1000.
- A node carrying `extras.atrium.model` has **no `mesh`** (L4).
- **Server:** `checkModelExtras` in `send-policy.js`, called from
  `checkAtriumExtras` so `add` gets it with the teleporter check, before the
  first world change, with code `INVALID_VALUE` and a message naming the rule.
  The mesh rule needs the descriptor, so the add handler calls it with the
  node (`session.js` ~L828). Live-avatar adds are untouched (K4 already
  refuses any `extras.atrium` on them).
- **Client:** a pure `parseModelSpec(extras)` (renderer-neutral) returning
  `{ ok: true, spec }` or `{ ok: false, reason }`. The loader acts only on
  `ok` specs; anything else renders a placeholder with the reason (a legacy
  value the new server check would refuse).
- `edit-duplicate.js` `atriumProblem` applies the same rules, so Duplicate and
  Undo report an invalid legacy value instead of sending an `add` the server
  refuses.
- **No drift:** one JSON file of test vectors (valid and invalid specs, each
  with its expected verdict) under `tests/fixtures/`, read by the server's,
  the client's and Duplicate's tests.
- **`send` is unchanged:** every write to `extras.atrium.model` or beneath it
  stays refused by the default deny (L3). A test pins it.

### Z2. Fetching with limits (renderer-neutral)
A module that, given a resolved URL, an optional `sha256` and an
`AbortSignal`, returns the model's bytes or a reason. Pure enough to test in
Node with a stub `fetch`.
- Streams the body and counts bytes; **aborts the request** as soon as the
  running total, across the file and all its dependencies, passes 25 MB.
  `Content-Length` is never trusted, only used to refuse early.
- Detects the format by content (the `glTF` magic for binary), not by
  extension. For JSON `.gltf` (L6): parses it, refuses external URIs that are
  not relative or `https:`, fetches each external buffer and image under the
  same budget and timeout, and returns a map of original URI → bytes.
- Refuses before parsing when `extensionsRequired` or `extensionsUsed`
  names Draco, meshopt or KTX2 (L7).
- With `sha256`: refuses a `.gltf` that has external files; for a `.glb`,
  hashes the bytes (`crypto.subtle.digest`) and refuses a mismatch.
- 30 s timeout from the first request; an aborted signal (world change, node
  removed) resolves quietly with no warning.
- Reasons are a fixed set of codes with plain text: `bad-spec`, `http`
  (with status), `network` (CORS or offline: the browser can't tell them
  apart), `too-large`, `timeout`, `hash-mismatch`, `pin-needs-glb`,
  `unsupported` (with the extension), `parse`, `too-many-vertices`,
  `texture-too-large`, `world-texture-budget`, `world-download-budget`,
  `world-instance-limit`.

### Z3. Parsing and decoded checks (renderer-three)
- `GLTFLoader.parseAsync` on the bytes. For a `.gltf`, a `LoadingManager`
  URL modifier maps each original URI to a `blob:` URL of the fetched bytes;
  `blob:` URLs are revoked after parsing.
- **Before anything is attached or rendered** (so before GPU upload): count
  vertices (sum of `position.count` over meshes, skinned meshes included) and
  measure each texture's `image.width`/`height`. The checks are a pure
  function over those numbers (P5), applying L8's per-model and per-world
  limits. A refused model is disposed at once.
- The parsed result is the **template**, cached per world on
  (resolved URL, `sha256`) with its counts, and disposed (geometries,
  materials, textures) when no node uses it or the world changes.

### Z4. Instances and name isolation (renderer-three)
For each model node, an instance is built from the template:
1. `SkeletonUtils.clone(template.scene)` (shares geometry and textures; maps
   bones by reference).
2. Clone each clip and retarget every track from the part's name to the
   instance part's `uuid` (`PropertyBinding.findNode` inside the instance).
3. Clear `name` on every object in the instance; keep the original as
   `userData.atriumModelName`.
4. Put it in a plain `Object3D` wrapper (not a `Group`, P3) with no name,
   `userData.atriumModel = true`, and add the wrapper to the host node's
   `Object3D`.

**Invariant (tested):** with a model whose parts are named like world nodes,
`walkUpToSOMNode` and `nodeForHitObject` on a hit model part resolve to the
host node (or its selection root), `getObjectByName`/`findNodeObject` of a
world node's name return the world node, and a world clip on `sceneGroup`
moves the world node and no model part. The model's retargeted clip still
moves its own part.

### Z5. The model bridge (renderer-three; wired in `app.js`)
One object that keeps the scene's model instances matching the SOM.
- **Reconcile** = for every SOM node with a spec, make sure it has the right
  instance (or placeholder); remove instances whose node is gone or whose
  spec changed. Runs on `world:loaded` (every one, including an external
  ref's: DocumentView was rebuilt, so instances are re-attached from the
  cache without refetching), `som:add`, `som:remove` (a removed parent takes
  its subtree) and `som:rename`. Avatars and externally loaded nodes are
  never model hosts.
- The host `Object3D` comes from `docView.listViews(somNode._node)` (by
  identity, never by name). If it doesn't exist yet (P3), retry on the next
  frame, a bounded number of times.
- A new world (a different `client.som`) aborts every in-flight fetch and
  disposes every template and instance. A late result for an old world or a
  removed node is dropped.
- Status per node, readable by the app: `loading`, `loaded`, `failed` (with
  reason code and text). A change of status raises one event the Edit panel
  listens to.
- Fetches queue at 4 at a time (L8); the instance limit counts model nodes
  in document order, so the same nodes win on every visitor's screen.

### Z6. The placeholder
- While loading and after a failure, the host shows a wireframe box: size
  `bounds` (or 1 m cube when absent), its base at the node's origin (models
  rest on their origin, like palette shapes on y = 0), muted grey while
  loading, amber after a failure. It's an unnamed mesh in the same kind of
  wrapper, so a click on it selects the host (Z4's invariant covers it).
- Removed when the model attaches, or with the node.

### Z7. Edit mode: the Model button and form
- A **Model** button at the end of the Add row, **with no `data-kind`**
  (P8), enabled by the palette's rule (`!blocked && modes.edit`).
- It opens a form inside the Edit panel, under the Add row, titled "New
  model": a URL field, the privacy note (L12), **Check**, a status line, the
  **Pin this version** box (shown only after a `.glb` checks out), Save and
  Cancel. Only one of the Teleporter and Model forms is open at a time.
- **Check** runs Z2–Z3 on the URL (client-side spec rules first), shows
  "Loaded: N vertices, X MB" or the reason, and measures `bounds` from the
  parsed scene (a Box3 of the model at rest, rounded up to 1 mm). Editing the
  URL clears the result and disables Save.
- **Save** adds the node through the structural path: name from the URL's
  file name without extension (`Model` if none), made free and cut to the
  name rules by `firstFreeName`; position and yaw from `palettePlacement`;
  descriptor `{ name, translation, rotation, extras: { atrium: { model:
  { url, bounds, sha256? } } } }`; `structure.begin('add', seq, { name,
  descriptor, model: true })`; `undo.registerAdd(seq, { name, duplicate:
  false })`. Accepted: the form closes and the node is selected (J6). A
  rejection waiting on this form shows in it (as `formWaitSeq` does for
  teleporters); a taken name gets no automatic retry (as for pads). The
  checked template seeds the cache, so the new node renders without a second
  download.
- Cancel, Escape (B2 order), Edit off and a reconnect close it.
- **The Edit panel's fields for a selected model node** gain one read-only
  row: "Model", the URL (middle-truncated, full text in the title),
  "pinned" or "follows the URL", and the status or reason (L11).
- No change to the palette handler, `retryAdd`, Duplicate, Delete or the
  undo engine (P2).

### Z8. Server
- Z1's check in `add`, DEV restart. No schema change (the schema already
  admits the shape). No change to `send`, persistence, `som-dump` or the
  avatar guards.

### Z9. What stays the same
- `source` and `resolveExternalReferences`, `loadBackground`, the World Info
  allowlist, and every existing `add` rule.
- Undo, redo, Duplicate and Delete of a model node go through today's paths;
  the re-added node resolves its model from the cache.

## 5. Tests

**Server** (`packages/server/tests`, new test port if a session test is
added; update `AGENTS.md`'s port table):
- Every vector of the shared file through `checkAtriumExtras` (Z1).
- `add` over a real session: a valid model node is accepted, broadcast and
  saved; each invalid kind is refused with nothing applied, broadcast or
  saved; a model node with a `mesh` is refused; an avatar add with a model is
  still refused by K4.
- `send` to `extras.atrium.model.url`, `extras.atrium.model`,
  `extras.atrium` and `extras` with a model value: all refused, nothing
  changed.

**Client, renderer-neutral** (`packages/client/tests` or `apps/client/tests`):
- `parseModelSpec` over the shared vectors.
- The fetcher with a stub `fetch`: cap crossed mid-stream aborts the request
  (the stub sees the abort) and reports `too-large`; a lying
  `Content-Length`; a multi-file `.gltf` whose images push the total past the
  cap; timeout; abort on signal (no reason, no warning); `http` status;
  format sniffed from content with a misleading extension; Draco/meshopt/KTX2
  refused before parse; `sha256` match, mismatch, and on a multi-file
  `.gltf`.
- `atriumProblem` (Duplicate/restore) over the shared vectors.

**Renderer** (`packages/renderer-three/tests`, fixtures written in-test with
glTF-Transform, no textures, P5):
- The decoded-limit function: vertex cap, texture side cap, world texture
  budget, world download budget, instance limit (pure, with stand-in sizes).
- Z4's invariant with a real GLTFLoader parse: parts named like world
  nodes, a world clip, a model clip, both walks and both by-name lookups.
- Template sharing: two nodes with the same URL fetch once; removing one
  keeps the other's instance; removing both disposes the template.
- The bridge with stub DocumentView views: reconcile on add, remove, rename
  and `world:loaded`; a rebuilt view re-attaches without a fetch; a new SOM
  aborts in-flight fetches and drops late results; a missing host object
  retries next frame; the wrapper is an `Object3D`, never a `Group`.
- Placeholder: present while loading and after failure, sized by `bounds`,
  removed on attach, and resolving to its host.

**App** (`apps/client/tests`, the form's logic as a pure module with a fake
element harness, which also answers edit-polish-2 §4.5's request for
form-state tests):
- Check → result → Save enabled; URL edit clears; pin box only for a checked
  `.glb`; Save's descriptor (name, placement, bounds, optional `sha256`);
  accepted, rejected (shown in the form), unknown; Cancel, Escape, Edit off,
  reconnect; the Teleporter and Model forms exclude each other.
- The key-wiring guard and import guard still pass with the new listeners.

### 5.1 Claude's headless checks (before DEV acceptance)
In headless Chromium against a fresh server, as edit-polish-2 §6.5 (scratch,
not committed), with fixture `.glb` files served by the static server:
1. Add a model; it renders; Undo removes it; Redo brings it back with **no
   second fetch**.
2. Two nodes, one URL: one fetch. Delete one: the other stays.
3. Model parts named `Cube`/`Door` next to world nodes of those names: Edit
   clicks select the host; world animations move world nodes only.
4. Each refusal: too large (and the request was aborted, not completed),
   timeout, 404, CORS, Draco, hash mismatch, too many vertices, oversized
   texture. Placeholder visible, reason in the panel.
5. Teleport away mid-load: no warning, nothing attached in the new world.
6. A second tab (visitor) sees the model; a refused model shows the
   placeholder there too.
7. A server `add` with `javascript:` / `http:` / extra keys / a mesh,
   sent by hand: refused.

## 6. DEV acceptance (operator)
1. In your world, Edit → Model → paste a CC0 `.glb` URL (Claude will supply
   two with CORS) → Check → Save. It appears ahead of you; move, rotate,
   scale, rename, duplicate, delete, undo and redo it.
2. Paste a URL that's too big or not a model: Check says why; Save stays
   off.
3. Check a `.glb` with **Pin this version** on and save. (Claude can show the
   stored `sha256` in the console.)
4. Open the world as a visitor in another browser: the models render.
5. A model you know has textures and animations looks right (rest pose).
6. Teleport away and back: models come back; no console errors.

## 7. Worker rules and the release path
- Ordered steps, one commit each:
  1. The shared vectors and the server check (Z1 server side, Z8), with the
     server tests.
  2. `parseModelSpec` and `atriumProblem` (Z1 client side), with tests.
  3. The limited fetcher (Z2), with tests.
  4. Parse, decoded checks, template cache (Z3), with tests.
  5. Instances and isolation (Z4), with the invariant test.
  6. The bridge and placeholder (Z5, Z6), with tests.
  7. `app.js`/`index.html`: the Model button, form, panel row, bridge wiring
     (Z7), with the form tests.
  8. Full suites, proofs, handoff.
- **Proofs** (each a deliberate break that a named test must catch, restored
  from a saved copy, never with `git checkout`): (a) drop the server's model
  check; (b) allow `http:`; (c) stop counting dependency bytes in the cap;
  (d) skip the hash check; (e) skip clearing names (Z4 invariant fails);
  (f) make the wrapper a `Group`; (g) skip the abort on world change.
- `apps/client` and renderer tests can't touch the DOM or load images (P5).
- Tests run in the DEV deploy as `atrium-build` with no network: fixtures are
  built in-test; nothing fetches the internet.
- A server change: DEV restarts on deploy.
- The standard kickoff (edit-polish-2 passdown Appendix A), with its
  §4.1–§4.3 lessons and the review-gate line about taking the SHA from the
  GLM verdict.

## 8. Notes for the brief author
- `app.js` is 2,527 lines. Keep new logic in modules (`model-form.js`, the
  bridge, the fetcher) and leave `app.js` only wiring, as the edit rounds did.
- Where the renderer-neutral parts live (`packages/client` vs
  `apps/client/src`) is the brief's call; `@atrium/client` must not import
  three (AGENTS.md).
- `SkeletonUtils` is `three/addons/utils/SkeletonUtils.js`; GLTFLoader is
  `three/addons/loaders/GLTFLoader.js`. Both resolve in Node and in the
  browser's importmap.
- The model's own lights and cameras: GLTFLoader creates them. A model's
  lights should be dropped in 3a (a world's lighting is the owner's), and its
  cameras must never become selectable SOM cameras (they aren't in the SOM,
  so they won't). Say so in the brief.
- `crypto.subtle` needs a secure context (https or localhost): DEV and PROD
  are https.
- The copy step will meet a server-relative URL that means something else on
  another server (P7). Note it for that pre-brief: a copy may need to
  absolutise it.

## 9. Step 3b sketch (for its own pre-brief; L13–L15 already decided)
- **Library:** `assets/library/catalog.json` (name, thumbnail, model URL,
  `sha256`, `bounds`, licence, attribution, source page); 20–30 hand-picked
  CC0 items (Poly Haven; the Hubs/Spoke kit only after its licence is
  checked); a **Library** button in the Add row opening a thumbnail grid;
  placing an item is Z7's Save with the catalog's pinned URL and bounds, no
  Check. A "Models from Poly Haven (CC0)" credit in the grid.
- **Build script** (repo, run on the host by the operator, L13):
  `tools/library/build.mjs` with a distinct `User-Agent`, downloading chosen
  asset ids at 1k, packing each to one `.glb` (gltf-transform), checking it
  against 3a's limits, writing catalog entries and thumbnails.
- **Host steps:** the library directory, a Caddy `handle /assets/library/*`
  on both sites with `file_server`, CORS (`Access-Control-Allow-Origin: *`),
  long caching for pinned files, and the `hide` list.
- **Sky** (L14): a Sky picker (None + library skies) writing
  `atrium.background.type` and `.texture`; `loadBackground` through 3a's
  fetch limits and a 4096 × 2048 check.

## 10. References
- Design §4.3, §4.4, §9, §10 Q4/Q5; §3.2 (single-node `add`).
- Passdowns: 2026-10-19 copy objects (C1–C4, §3), 2026-10-19 edit-polish-2
  (form pattern, §4.5 form-state tests, Appendix A kickoff), 2026-10-18 §5.1
  item 1 (the richer `add`, not needed here), 2026-10-14 ops connector (Caddy
  state), 2026-09-28 (Caddy cache headers).
- Code: `AtriumClient.js` L1303–1360; `app.js` L624, L779, L1140, L2213;
  `session.js` L744–L860; `send-policy.js` L69, L153, L205; `Stage.js` L169;
  `hit-test.js`; `edit-selection.js`; `edit-duplicate.js` L69.

## 11. Revision log
- **Rev 0 (2026-10-19, ~23:10 PT):** drafted from probes at `c6482bb0`.
- **Rev 1 (2026-10-19, ~23:18 PT):** the operator approved L1–L16, all as
  recommended. Status, §3's preamble and the §4 and §9 headings updated;
  nothing else changed. No outside review of the pre-brief.
- **Rev 2 (2026-10-20, ~00:00 PT):** an outside review of Rev 1 (must-fix
  M1–M9, should-fix S1–S4, nits N1–N3) after the kickoff and the GLM brief,
  before the brief gate was completed. Every finding is taken in §12
  (A1–A14), with three new decisions L17–L19 (A15), approved as
  recommended. The status line and §4's heading point to §12; §1–§10 are
  otherwise unchanged.

## 12. Revision 2 amendments (binding; they supersede §2–§8 wherever they differ)

From the operator's outside review of Rev 1 (2026-10-19, ~23:56 PT: must-fix
M1–M9, should-fix S1–S4, nits N1–N3). Claude checked the concrete claims
against the code: M1 *probe* (`new URL('/\\evil.example/m.glb', base)` and
`'/\t/evil.example/m.glb'` both resolve to `https://evil.example/…`;
`'/%2F%2Fevil…'` stays on the base origin), M9 (`connecting` is emitted at
`AtriumClient.js` L376, long before the next `som-dump`), S2 (`som.nodes` is
name-map order; `som.allNodes` is glTF node-index order), S4 (`app.js`
L650–658), M6 *probe* (template and `SkeletonUtils.clone` objects have
different uuids, so a uuid track bound to the template can't address a
clone). L1–L16 stand. L17–L19 (A15) are new; the operator approved them as
recommended on 2026-10-20 (~00:00 PT). Each item names the step (§7) it belongs to.

### A1. URL rule, exact (M1; replaces Z1's `url` bullet; step 1 and 2)
A stored `url` is valid only if **all** of these hold:
1. A string of 1–2048 characters with **no** character below U+0021, no
   U+007F and no backslash (`\`). (Spaces must be percent-encoded.)
2. Either:
   - it starts with `https://` (lowercase), `new URL(url)` succeeds, the
     result's `protocol` is `https:`, `hostname` is non-empty, and
     `username` and `password` are empty; **or**
   - its first character is `/` and its second is not `/`, and
     `new URL(url, 'https://atrium.invalid').origin === 'https://atrium.invalid'`.
3. Nothing else is valid.

The server (`checkModelExtras`) and the client implement exactly this. The
shared vectors gain adversarial cases: backslash variants (`/\host/x`,
`/\\host/x`), tab, CR, LF, NUL, a raw space, `//host/x`, `https:/x`,
`https:x`, `HTTPS://h/x`, `https://user:pw@h/x`, `https://` with an empty
host, percent-encoded slashes and backslashes (`/%2F%2Fh/x`, `/%5Ch/x`:
valid, they stay paths), and one at 2048 and one at 2049 characters.

**Client, before fetching a root-relative URL:** resolve it against
`worldBaseUrl` and require the result's origin to equal
`new URL(worldBaseUrl).origin`. With no usable `worldBaseUrl` (a world
dropped in as a file), the reason is `no-base`, and nothing is fetched. A
root-relative URL is never resolved against the page's own origin.

### A2. Request policy (M3; step 3)
Every request for a model or a dependency uses exactly:
`{ method: 'GET', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'follow', signal }`.
- No cookies or HTTP authentication are ever sent, including to the world's
  own origin, and the referring page isn't sent.
- **Redirects (L17):** followed, then checked before the body is read. If
  `response.redirected`, `response.url` must pass A1's absolute-`https`
  rule. For a root-relative spec it must also stay on the world's origin.
  Otherwise the body is cancelled and the reason is `redirect`.
- Tests assert these options on **every** request, dependencies included,
  and the redirect rule's three cases: off-scheme, off-origin for a
  root-relative spec, and an allowed `https` hop.

### A3. Dependencies of a `.gltf`, fail-closed (M4; replaces Z2's `.gltf` bullet and Z3's URL-modifier bullet; steps 3–4)
1. Parse the `.gltf` JSON and list every `buffers[].uri` and `images[].uri`
   **before** `GLTFLoader` sees anything.
2. Resolve each non-`data:` URI with `new URL(uri, effectiveUrl)`, where
   `effectiveUrl` is the `.gltf`'s final `response.url`. The result must pass
   A1's absolute-`https` rule, or for a root-relative model, A1's
   root-relative origin check. Otherwise the model fails `bad-dependency`.
3. Deduplicate by the canonical `href`. Each distinct URL is fetched once
   (A2 policy), and its bytes count against the model's 25 MiB and the
   world's ledger (A4).
4. **Rewrite the JSON** so each such URI is the `blob:` URL of its fetched
   bytes, then parse the rewritten JSON. `data:` URIs are left as they are
   (their bytes are already in the counted file).
5. Give `GLTFLoader` a `LoadingManager` whose URL modifier passes **only**
   the `blob:` URLs this load created and `data:` URLs. Any other request
   fails the load with `unexpected-request`; the modifier returns a `blob:`
   URL of an empty blob so nothing reaches the network.
6. Revoke every `blob:` URL this load created, on success and on failure.
7. The 30 s timer covers the whole job: the first request, every
   dependency, preflight (A5) and parsing.

Tests: a `.gltf` with `textures/../images/a.png`; with duplicate URIs (one
fetch); with an `http:` dependency and with one whose host differs on a
root-relative model; with a URL modifier receiving an absolute URL that's not
in the map (refused, no fetch); and a stubbed `GLTFLoader` that asks for an
unexpected URL.

### A4. One world transfer ledger (M7; replaces L8's "unique model files" wording; step 3)
- One running total per world generation (A9), charged **as each chunk
  arrives**, for every model and dependency request, including those that
  later fail, time out, are aborted, mismatch their hash, or are refused.
  Never refunded, including when a node is removed. When the total passes
  150 MiB, every in-flight request is aborted and every queued or later
  model fails `world-download-budget`.
- Fetches are deduplicated by canonical URL for the whole world: two nodes
  with one URL download once.
- **The concurrency limit of 4 counts HTTP transfers**, dependencies
  included, per page. Queued transfers start in A10's order.
- Test: several downloads, each under 25 MiB and some failing to parse,
  whose sum passes 150 MiB. The one that crosses is aborted mid-stream, and
  later ones never start.

### A5. Preflight before parsing (M8; L18; step 4)
After all bytes are in and before `GLTFLoader` runs, these checks run on the
JSON (and the GLB's JSON chunk) and the image bytes. All are pure and
testable in Node:

| Check | Limit | Reason |
|---|---|---|
| `nodes.length` | ≤ **10,000** | `too-many-nodes` |
| Σ `POSITION` accessor `count` over every primitive | ≤ **500,000** (the vertex cap, checked early; the post-parse count still applies) | `too-many-vertices` |
| Σ over accessors of `count × element bytes` (sparse accessors at full `count`) | ≤ **64 MiB** | `too-much-data` |
| Each image's format, from its bytes | **PNG, JPEG or WebP** only | `unsupported-image` |
| Each image's width and height, from its header | ≤ 4096 | `texture-too-large` |
| Σ estimated texture memory (w × h × 4 × 4⁄3) | reserved against the world's 256 MiB **before** parsing | `world-texture-budget` |

- An image whose header can't be read is `unsupported-image`. Images come
  from the GLB's buffer views or from A3's fetched bytes.
- **Parsing is serialised:** one `GLTFLoader` parse at a time per page.
- A reservation is released if the model fails, and replaced by the measured
  figures after parsing. The post-parse checks of Z3 still run.

### A6. Node-level validation (M5; steps 1–2, 6)
- `parseModelSpec(extras)` keeps the value rules (A1 plus Z1's `sha256` and
  `bounds`). A new **`validateModelHost(node)`** checks the spec **and**
  that the node has no mesh. The bridge calls `validateModelHost` before any
  fetch or attach; a failure renders the placeholder with the reason
  `bad-spec`.
- The shared vectors file has two arrays: `specs` (extras values) and
  `nodes` (whole node descriptors, including a valid model with a mesh,
  which is invalid). The server's `add` test, `validateModelHost` and
  Duplicate's `atriumProblem` all use `nodes`; the value-level tests use
  `specs`.

### A7. Animation retargeting by identity; imported lights and cameras (M6, S1; replaces Z4 steps 2–3; step 5)
For each instance:
1. Clone with `SkeletonUtils.clone(template.scene)`, then build a
   template-object → instance-object map by walking both trees in parallel,
   **before** any name is cleared.
2. For each track of each clip: `PropertyBinding.parseTrackName`; resolve the
   node part against the **template** with `PropertyBinding.findNode` (which
   matches name or uuid, including bones); map it to the instance object;
   rewrite only the node part to that object's `uuid`. The rest of the path
   (`objectName`, `objectIndex`, `propertyName`, `propertyIndex`) is kept.
3. A track whose target can't be resolved to exactly one template object is
   **dropped**, and the instance's status records the count ("2 animation
   tracks couldn't be bound"). It is never bound to a guess.
4. Then clear every name (Z4 step 3).
5. **Remove the model's own lights and cameras** from the instance (an
   imported light would light the world, L10's spirit; an imported camera
   must never become a world camera).

Tests (with a real `GLTFLoader` parse): an unnamed animated node; a skinned
model; a morph-target track (`…morphTargetInfluences[…]`); **two instances
of one template**, each clip moving only its own instance; a model with a
light and a camera (both gone). **The camera test runs `Stage.setSceneGroup`
itself** (with an injected renderer) on a world camera whose host name
collides with a model part: the camera lands on the world node.

### A8. Template cache: active references and an idle cache (M2; replaces Z3's last bullet; step 4)
- A template whose last instance goes away becomes **idle**; it is not
  disposed. Idle templates stay until the world changes (A9) and still count
  against the world texture budget.
- When a new model would exceed the texture budget, idle templates are
  evicted least-recently-used first, before refusing anything.
- **A successful Check holds its template** (and its bytes' hash) until Save
  (it becomes the node's cache entry), Cancel, a URL edit, the form closing,
  or a world change.
- Tests, with fetch counts: delete the only instance then Redo (0 new
  fetches); Check then Save (0 new fetches); Check then Cancel then Check
  the same URL (1 new fetch); idle eviction under budget pressure.

### A9. Two lifetimes: world and view (M9, S3; replaces Z5's world-change bullet; steps 6–7)
- **World generation:** the bridge's `resetWorld()` aborts every request and
  parse, drops the ledger (A4), and disposes every template and instance. It
  runs on the client's `connecting` and `disconnected` events, and the app
  calls it immediately before `loadWorld`/`loadWorldFromData`. It does
  **not** wait for a new `client.som`.
- **View generation:** in the app's `world:loaded` handler, `bridge.detachView()`
  runs **before** `initDocumentView` (removing every wrapper from its host),
  and `bridge.attachView(docView, sceneGroup)` runs after `stage.setSceneGroup`.
  A view change keeps the cache.
- **Every attach re-checks, at the moment of attaching:**
  - the world generation it started in;
  - that the SOM node is still in `client.som` (by identity);
  - that the node's spec key is unchanged;
  - and the current view.

  It then takes the host from `docView.listViews(node._node)`, keeping only
  an object whose ancestor chain reaches the current `sceneGroup`. A host
  captured before an `await` is never used.
- No host after **10** frames: status `failed`, reason `no-host`, never
  stuck in `loading`.
- Disposing an instance removes its wrapper and cloned skeleton only; the
  template's geometries, materials and textures are disposed only with the
  template.
- Tests:
  - a fetch that completes after an external-ref `world:loaded` rebuilt the
    view with the same SOM attaches only in the new view;
  - repeated same-SOM rebuilds;
  - `connecting` mid-fetch aborts it, and it never attaches;
  - removing one of two instances keeps the other's geometry and textures.

### A10. Order (S2; step 6)
- Order is `som.allNodes` order (glTF node index), never `som.nodes`.
- The **instance limit** counts model nodes in that order.
- **Texture-budget admission** happens in that order: a model is admitted
  only once every earlier model has been admitted or has failed (bounded by
  their own 30 s timeouts). So the same models win on every visitor's screen.
- The **download ledger** (A4) is first-come by arriving bytes. That is the
  one network-dependent limit; it is an abuse ceiling that ordinary worlds
  never reach.

### A11. The diagnostic listeners (S4; L19; step 7)
`app.js` L650–658 adds five pointer listeners to every SOM node on **every**
`world:loaded`. External-ref loads repeat that event on the same SOM, so the
listeners pile up. Register them **once per SOM node** (a `WeakSet` in a
small helper module), with a test that repeated calls on one SOM attach once.

### A12. Clarifications (N1–N3)
- `bounds` is an array of exactly three finite numbers, each in
  [0.001, 1000]. Check clamps each measured dimension into that range (a
  flat model gets 0.001).
- MB in L8 means MiB (× 1,048,576 bytes).
- World budgets include idle templates (A8). Duplicate dependency URLs in
  one `.gltf` are fetched once (A3).
- **Pin this version** depends on the **detected** binary glTF format, not
  the URL's suffix. A `.gltf` with external files can't be pinned
  (`pin-needs-glb`).

### A13. Reason codes added
`redirect`, `bad-dependency`, `unexpected-request`, `unsupported-image`,
`too-many-nodes`, `too-much-data`, `no-base`, `no-host`.

### A14. Proofs added (to §7's (a)–(g))
- (h) accept a backslash in a root-relative URL;
- (i) drop `credentials: 'omit'`;
- (j) let the URL modifier pass an unmapped URL;
- (k) refund a failed download's bytes;
- (l) skip the image-header dimension check;
- (m) attach to a host captured before an `await`, across a view rebuild;
- (n) bind an unresolvable track instead of dropping it.

Each must be caught by a named test.

### A15. New decisions (approved as recommended, 2026-10-20)
- **L17. Redirects:** (a) **follow, then check the final URL (A2)**: many
  ordinary model links redirect (GitHub "raw" links, CDNs), and with
  credentials omitted a redirect reaches nothing the owner couldn't name
  directly; or (b) refuse every redirect (`redirect: 'error'`).
- **L18. Preflight limits (A5)**, which extend L8: 10,000 nodes, 64 MiB of
  accessor data, PNG/JPEG/WebP images with header-checked dimensions, and
  serialised parsing. **Yes.**
- **L19. Fix the listener pile-up (A11) in this round.** **Yes**: it's in
  the same handler this round changes.
