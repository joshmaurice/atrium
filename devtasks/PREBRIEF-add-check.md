# Pre-brief: the `add` check (`add-check`)

Status: **FINAL, Revision 1.1 (2026-11-05). Decisions RA-L1, RA-L4, RA-L5, RA-L7
and RA-L8 approved** (operator, 2026-11-05: RA-L1, L4, L7 and L8 chosen as
recommended; RA-L5 as recommended, on "ok go plz" after Claude said it would
take it so unless told otherwise).
- **Where this comes from.** It's carved out of `PREBRIEF-richer-add-copy.md`
  DRAFT Rev 0.2, which stays the draft for `richer-add` and `copy-objects`. This
  file is the whole contract for `add-check`: nothing here depends on that
  file's open decisions (RA-L2, RA-L3, RA-L6, CP-L1–CP-L7).
- **Two outside reviews** of the combined pre-brief's Rev 0.1 (at `923bd444`),
  both CHANGES REQUESTED, shaped this contract:
  `devtasks/REVIEW-richer-add-copy-rev0.1-claude.md` (**CR**, a runtime review)
  and `devtasks/REVIEW-richer-add-copy-rev0.1-chatgpt.md` (**GR**,
  source-only). Their finding numbers are cited (CR-M1, GR-S1 and so on). Every
  must-fix they raised for this round is in §4. **No third outside review:** the
  contract is the reviewers' own recommendations, and the round's code gets its
  outside review (§6).
- **Against `main` at `8fc82bb5`** (DEV = MAIN = PROD). Line numbers are at that
  commit. The server, the SOM, the protocol and `edit-duplicate.js` are
  byte-identical to `f42b5fe`, where the combined pre-brief's probes first ran.
- **How it was checked.** Claude read every cited line at `8fc82bb5`, reran CR's
  `q2` there, and ran `p7`, the measurements in §2.4 and §2.5, and `p6` on a
  scratch database. The operator ran `p6` on PROD (§2.6). The app wasn't opened
  in a browser for this pre-brief.
- **Sources:**
  - `devtasks/PREBRIEF-richer-add-copy.md` Rev 0.2: §2.1–2.3, §2.7, §2.9, §3
    (RA-L1, RA-L4, RA-L5, RA-L7, RA-L8), §4;
  - the two reviews above;
  - `devtasks/PREBRIEF-edit-mode-ui-1b-2.md` K6 (one transform check shared by
    `add` and `send`) and N3/D5 (Duplicate's lossless rule);
  - `devtasks/PREBRIEF-models-by-url.md` (the `model-spec.js` pattern: one rule
    in two places, pinned by shared vectors).

## 1. What this delivers
**Every `add` the server accepts can be stored, saved, read back and sent to a
joiner, and costs a bounded amount.** Concretely:
- an anonymous visitor can no longer stop joins, stall the server process, or
  make every join download megabytes (§2.3);
- an owner can no longer save a world that can't be loaded again;
- `add` and `send` share one transform check and one set of material ranges;
- if a world ever does fail to serialize or read back, the save keeps the last
  good document, and the joiner is told instead of left waiting.

Same fields as today; **nothing new is carried.** First-party senders are
unchanged and all pass (§2.2).

**Not in this round:** the richer `add` and copying objects
(`PREBRIEF-richer-add-copy.md`); a server-built avatar (RA-L4 (c), later); an
audit of the world loaders beyond A10's read-back (GR-S2); any change to what
Duplicate and Undo accept other than A7.

## 2. Verified facts (at `8fc82bb5`)

### 2.1 The `add` path
- **The schema accepts almost any mesh** (`add.client.json`; `add.server.json`'s
  `node` is identical). `node` allows exactly `name`, `translation`, `rotation`,
  `scale`, `extras`, `extensions` and `mesh` (`additionalProperties: false`).
  Under `mesh.primitives[]`, `attributes` is any object, `indices` is anything
  and `material` is any object. Numbers are `type: number`, and Ajv accepts
  `Infinity` (a wire `1e999` after `JSON.parse`; CR `q-ajv`).
- **The message's `format`** is any string, and the handler broadcasts it as
  sent (`format: msg.format ?? 'gltf'`, `session.js` L1398, L1407). Only the
  protocol inspector sends it, as `'gltf'` (`tools/protocol-inspector/index.html`
  L299).
- **The handler's order** (`session.js` L1226–1420):
  1. `msg.id`, the avatar's name, and that an avatar has no parent;
  2. S2 (`source`), and K4/L5 (an avatar carries no `extras.atrium`);
  3. the mutation gate;
  4. for world adds: parent, name rules and `objectId` uniqueness;
  5. K6, `checkTransformValues` (L1314), avatars included;
  6. for world adds, inside the V9 `try` (L1329): `checkAtriumExtras`,
     `checkModelHost` and the behaviour caps;
  7. the avatar's `extras.displayName` is overwritten (L1378–1381);
  8. `world.addNode` (L1383), synchronous;
  9. the broadcast of `msg.node` as sent (L1394–1413).
  
  **Nothing looks at `node.mesh`, `node.extensions`, `translation` or `format`.**
  The server validates the schema before the handler runs (L712–716): a schema
  failure is `UNKNOWN_MESSAGE` with Ajv's text.
- **Every client applies the broadcast with the same `SOMDocument.ingestNode`**
  (`AtriumClient.js` L1533–1557).
- **Limits that exist:** `maxPayload` 1 MiB (`session.js` L31, L281); message
  depth 64 (`message-depth.js`); 100 sessions per world (`maxUsers`,
  `session.js` L270, `world-host.js` L55); the client's `MAX_ADD_BYTES`
  1,000,000 for Duplicate and Restore (`edit-duplicate.js` L25).

### 2.2 What `ingestNode` keeps (`SOMDocument.js` L781–852)
- **Kept:** the node's name, TRS and `extras`; the mesh name; POSITION and
  NORMAL as `Float32Array` VEC3; indices as `Uint16Array`; per primitive, a new
  material with `baseColorFactor`, `metallicFactor` and `roughnessFactor`; **one
  buffer per primitive** (L804).
- **Dropped without a word:** `node.extensions`, every other attribute, every
  other material field, and mesh, primitive and material `extras`.
- **Taken without checks:** wrong-length arrays, non-numbers, indices past the
  end, indices above 65535 (wrapped by `Uint16Array`), and numbers that are
  finite as doubles but overflow Float32 (`1e39` is stored as `Infinity`).
- **The avatar on the wire carries a marker:** `AtriumClient.connect`
  (L652–660) adds `extras.atrium = { ephemeral: true }` to every avatar
  descriptor, and K4 allows exactly that and nothing else in an avatar's
  `extras.atrium` (`addCarriesAtriumExtras`, `session.js` L169–200). So a real
  avatar's `extras` is `{ displayName?, atrium: { ephemeral: true } }`.
- **First-party adds send exactly what is kept** (CR `q1(1)`, built with the
  real builders): the avatar (`buildAvatarDescriptor`), the teleporter pad, and
  the five palette kinds (`cube`, `plane`, `sphere`, `cylinder`, `ramp`);
  Duplicate and Undo (`buildDescriptor`, `edit-duplicate.js` L183–216). Library
  and model placements carry no mesh. Redo resends a recorded descriptor.

### 2.3 The defect, live on PROD
All reproduced through the real `attachSessionHandlers` (probes in §2.7).

| What is sent | Who can send it | What happens |
|---|---|---|
| a primitive whose POSITION has 4 numbers (or 2) | any visitor (avatar `add`) or the owner | `serialize()` throws, so **every later join gets no `som-dump`**. For a visitor's avatar, until they leave; for an owner's object, autosave fails too, until the node is deleted (`p3`, `p4`) |
| a primitive with `POSITION: []` | the owner | `serialize()` succeeds and the `som-dump` is sent, but **the client's `readJSON` throws** and `_onSomDump` has no catch: the world never loads. Autosave writes it, so **the world can't be loaded again** at the next boot or teardown, and nobody can enter to delete the node (CR-M1). For a visitor's avatar, joins fail the same way while they stay |
| an avatar of 20,000 one-triangle primitives (938 KiB) | any visitor | `world.addNode` blocks the process for **3.8 s** (4.2 s for CR): every world on the server stops. The `som-dump` grows to 6.7 MiB (CR-M2) |
| an avatar with 900 KB of `extras` | any visitor | kept, and in every later join's `som-dump`: 20 such visitors make each join **17.3 MiB** (CR `q3`). With no budget, 100 visitors approach **100 MB** |
| `translation: [1e999, 0, 0]` | any visitor or the owner | accepted; the live node holds `Infinity`, clients see `null`, and a reload moves the object to x = 0. `send` refuses the same value (CR-M3) |
| POSITION or NORMAL with `1e39` | any visitor or the owner | stored as ±Infinity. Saves, joins and reloads still work: the object's bounds are infinite (GR-M1; `p7`) |
| `node.extensions` of 600 KB, or a long `format` | any visitor or the owner | dropped (or never stored), and **forwarded in full** to every present client (CR-M3; `p7`; §2.1) |
| any of the above | — | **present clients** get the broadcast and run the same `ingestNode`; CR found no schema-valid input that makes it throw (CR-N6). Not run in a browser |

**The real avatar is 1 primitive, 162 vertices, 816 indices, 22 KB**
(`buildAvatarDescriptor`, measured at `8fc82bb5`).

### 2.4 The two checks this round shares between `add` and `send`
- **K6 (`checkTransformValues`, `send-policy.js` L115–124)** checks an `add`'s
  rotation and scale; its only caller is the `add` handler (L1314). `send`
  checks its transforms inline with the same predicates (L1677–1687), and also
  requires `translation` to be 3 finite numbers (`isVec3`, L1687). `add`
  doesn't check `translation` at all.
- **`materialValueOk` (`send-policy.js` L1405–1416)** checks shape and
  finiteness, not range: `send` accepts `metallicFactor: 7` or
  `baseColorFactor: [2, 0, 0, 1]`. glTF requires [0, 1]. Without RA-L7, A4
  would make such an object impossible to duplicate or undo-delete.
- **Duplicate's `materialProblem`** (`edit-duplicate.js` L124–136) never looks at
  `alphaCutoff`, and `MAX_INDEX` (L36) is 65535, which glTF forbids in an
  unsigned-short accessor (CR-N1).

### 2.5 How a failed join reaches the user today
- The join's serialize is in a `try`; on failure it logs `som-dump serialize
  failed` and sends **nothing** (`session.js` L917–937).
- **`session:ready` fires at `hello`, before the `som-dump`**
  (`AtriumClient.js` L1171). So the connect has already succeeded when the dump
  fails: an `error` after it doesn't fail the connect (`app.js` `connectNow`,
  L1230).
- `_onSomDump` (`AtriumClient.js` L1191) awaits `readJSON` with no catch.
- **The app shows a panel for only two errors after `session:ready`:**
  `WORLD_NOW_PRIVATE` (the eviction panel) and `SIGNED_OUT` (`app.js` L951–967).
  Any other code is only logged.
- `WORLD_UNAVAILABLE`'s text is "That world doesn't exist, or it isn't public."
  (`teleport-failure.js` L24), which would be wrong for a damaged world. **So
  RA-L8's join message gets a code of its own (A10),** a correction to the
  combined pre-brief's wording, not a new decision.
- **Autosave** serializes and writes without reading back (`autosave.js`
  L80–90). `createWorldFromDocument` reads with `world.js`'s private `createIO()`
  (L17–18, L638–641).

### 2.6 PROD (operator's `p6`, 2026-11-05, at `1e36f42`)
- 23 worlds, **none unreadable**. 437 top-level objects; 410 copy today.
- **Nothing saved that this round would refuse, of what that `p6` checked:**
  no node extensions, no extras over 16 KiB, no non-finite values, no
  out-of-range materials, no mesh over 64 primitives, no indices count that
  isn't a positive multiple of 3.
- **Not checked by that run** (found by the pre-brief's own check): an index of
  65535 or past the vertex count, a mesh with no primitives, a mesh name over
  256 characters, a NORMAL count that differs from POSITION's, an unindexed
  vertex count that isn't a multiple of 3, more than 65,535 vertices in an
  unindexed primitive, and extras measured in UTF-8 bytes. **`p6` at this
  file's commit counts all of them; its rerun is a release step (§6).** Until
  then, "no Duplicate or Undo that works today stops working" holds only for
  the cases above.

### 2.7 The probes (`devtasks/spike-richer-add/`, run from the repo root)
| Probe | What it shows |
|---|---|
| `p3-malformed.mjs` | malformed `add`s through the validator, `addNode`, save and reload |
| `p4-avatar-dump.mjs` | an anonymous visitor's 4-number POSITION avatar stops joins |
| `p6-db-survey.mjs <db copy>` | the PROD survey (§2.6) |
| `p7-float32-extensions.mjs` | GR-M1 and `node.extensions` through the real handler; the joiner's dump read with the client's `readJSON` |
| `review-q/q1-addcheck-gaps.mjs` | CR's 13 cases through the real handler, and the first-party builders against the rule |
| `review-q/q2-empty-accessor-and-cost.mjs` | CR-M1, CR-M2 and the wire `1e999` |

## 3. Decisions (approved)
- **RA-L1 (a): its own round, first.** Both reviews agreed.
- **RA-L4 (a): avatars get a budget of their own** (A5), and none of the
  richer fields when they come. The largest avatar that passes is about 148 KB
  (measured with worst-case 17-digit numbers), so 100 visitors make a join's
  `som-dump` about 15 MB rather than about 100 MB.
- **RA-L5 (a): the bounds:** names up to 256 characters; at most 64 primitives
  per mesh; non-Atrium `extras` up to 16 KiB; every colour and factor finite
  and in [0, 1]; `alphaCutoff` finite and 0 or more; every geometry number
  finite **as a Float32**; every primitive has at most 65,535 vertices (so no
  index is 65535);
  `indices` at least 3; lengths checked before any per-element work. "16 KiB"
  is the UTF-8 bytes of `JSON.stringify(value)`.
- **RA-L7 (a): `send` gets the same material ranges,** through one shared
  predicate.
- **RA-L8 (a): defence in depth,** all three: autosave reads back, the server
  says when a join's serialize fails, and the client says when it can't read a
  dump. The code is `WORLD_UNREADABLE`, not `WORLD_UNAVAILABLE` (§2.5).

## 4. The contract (approved)
- **A1, one rule in two places, pinned by vectors.**
  - **On the server:** `checkAddNode(node, { avatar })` in `send-policy.js`.
    **On the client:** `packages/client/src/add-spec.js`, built like
    `model-spec.js` (pure, renderer-neutral, no DOM). Both return `null` or
    `{ code, message }`.
  - **Both read `tests/fixtures/add-node-vectors.json`,** shaped like
    `model-spec-vectors.json`: `{ note, nodes: [ { label, avatar, node, ok,
    reason } ] }`, where `reason` is the shared code. **Every node-level case
    in §2.3, `p3`, `p7` and CR's `q1`/`q2` is a vector**, and so is every
    acceptance in the tests below. Two cases are not, because another check
    owns them: `translation` (K6, A2) and `format` (the handler, A2). The
    server test file covers both.
  - **The reason codes** (exported, as `MODEL_REASONS` is): `extensions`, `extras-size`, `avatar-extras`, `mesh-keys`, `mesh-name`,
    `primitives-count`, `primitive-keys`, `attribute-keys`, `position-length`,
    `position-value`, `normal-length`, `normal-value`, `indices-length`,
    `indices-value`, `material-keys`, `material-value`, `avatar-primitives`,
    `avatar-vertices`, `avatar-indices`. The brief may add one where a case
    needs it, and says so.
  - **A1 is complete on its own.** It never relies on the schema (A8), and the
    vectors test A1 alone.
  - **Lengths first:** every array's length and every key set is checked
    before any per-element work.
  - A node with no `mesh` is still checked at the node level (A2).
- **A2, the node and the message:**
  - `translation`, when present: 3 finite numbers. **It goes into
    `checkTransformValues`** (K6), using `isVec3`, the predicate `send` already
    uses for it (L1687), with `send`'s text, `translation must be 3 finite
    numbers`. K6 runs before `checkAddNode` (A6), so a bad `translation` is
    refused there, as `INVALID_VALUE` with that text;
  - `extensions`, when present, is an empty object;
  - world adds: `extras` other than its `atrium` key at most 16 KiB.
    `extras.atrium` keeps its own checks (`checkAtriumExtras`);
  - avatars: A5;
  - **the message's `format`, when present, is exactly `"gltf"`** (§2.1). That
    check is in the handler, beside the call to `checkAddNode`.
- **A3, the mesh:**
  - `mesh` is an object with only `name` (a string, at most 256 characters) and
    `primitives` (an array of 1–64 entries);
  - each primitive is an object with only `attributes`, `indices` and
    `material`;
  - `attributes` has `POSITION`, and optionally `NORMAL`, and nothing else;
  - POSITION is an array whose length is a multiple of 3, at least 9 and at
    most 3 × 65,535;
  - NORMAL, when present, is an array of POSITION's length;
  - **every POSITION and NORMAL entry is a number finite as a Float32:**
    `typeof v === 'number' && Number.isFinite(Math.fround(v))`;
  - `indices`, when present, is an array of at least 3 integers, its length a
    multiple of 3, each 0 ≤ i < the vertex count (so never 65535). Without
    indices, the vertex count is a multiple of 3.
- **A4, the material**, when present: an object with at most
  `pbrMetallicRoughness`, itself an object with at most:
  - `baseColorFactor`: 4 finite numbers in [0, 1];
  - `metallicFactor`, `roughnessFactor`: each a finite number in [0, 1].
  
  So `material: {}` and `pbrMetallicRoughness: {}` pass: `ingestNode` keeps
  them as glTF's default factors (L834), which is what they mean. No
  first-party sender emits one. The range predicates are the ones A9 exports.
- **A5, avatars:** A2–A4, and:
  - exactly 1 primitive, at most 1,024 vertices, at most 6,144 indices;
  - `extras`: absent, or an object with at most two keys: `displayName`, a
    string of at most 256 characters (the server then overwrites it, §2.1 step
    7), and `atrium`, which A5 leaves to K4 (it allows exactly `{ ephemeral:
    true }`, §2.2). **Every real avatar carries that marker;** A5 must accept
    it;
  - no `extensions` (A2).
- **A6, where it runs:**
  - in the `add` handler, **after K6 (L1314) and before step 7's overwrite and
    the first world change (L1383)**, for avatar and world adds alike;
  - for world adds, **inside the V9 `try` (L1329), first in that block**, so a
    model node with a malformed mesh gets the mesh's reason;
  - for avatars, in a `try` of its own;
  - it fails closed, as V9 does: an exception refuses the `add` with
    `INVALID_VALUE`;
  - **a refusal by `checkAddNode` is `INVALID_VALUE`, message `<reason code>:
    <plain text>`;** K6's and `format`'s keep their own texts.
    A refused `add` changes nothing and is broadcast to no one.
- **A7, the client's Duplicate and Undo:**
  - `edit-duplicate.js` imports it as `@atrium/client/add-spec`, as it imports
    `model-spec` and `object-id`: that needs an `exports` entry in
    `packages/client/package.json` and an import-map entry in
    `apps/client/index.html` (L567–570), one line each, and nothing else in
    either file;
  - `prepareDuplicate` and `prepareRestore` (`edit-duplicate.js` L320–353) run
    `add-spec.js` on the **descriptor they built**, at click time, and refuse
    with its reason. A node the server would refuse is never sent;
  - the hint's document-form rules (`duplicateRuleProblem`) stay as they are,
    except `MAX_INDEX` becomes 65,534;
  - the avatar's own `add` (with its `ephemeral` marker) and the palette and
    pad adds are unchanged (they pass).
- **A8, the schemas (AGENTS rule 1):** `add.client.json` and `add.server.json`
  type the mesh to match A3 and A4 where JSON Schema can say it (keys, types,
  array lengths); `format` becomes `{ "const": "gltf" }`; `error.json` gains
  `WORLD_UNREADABLE` (A10). The value rules stay in A1. **Which layer refuses
  what:** a shape the schema catches arrives as `UNKNOWN_MESSAGE`; that's
  expected, and the server tests for those cases assert "refused, nothing
  changed, nothing broadcast", whatever the code.
- **A9, the shared ranges (RA-L7):** `send-policy.js` exports the range
  predicates. `materialValueOk` uses them: `baseColorFactor`,
  `metallicFactor`, `roughnessFactor` and `emissiveFactor` finite and in
  [0, 1]; `alphaCutoff` finite and 0 or more. `add-spec.js` has the same
  predicates, pinned by vectors of their own in the same file.
- **A10, defence in depth (RA-L8):**
  - **autosave reads back:** `world.js` exports `readBackProblem(json)`,
    which reads with the same `createIO()` as `createWorldFromDocument` and
    returns `null` or the error's message. Autosave calls it on the document it
    serialized; on a problem it **keeps the previous row**, logs
    `[autosave] read-back failed <logId>: <message>` once per world until a save
    succeeds, and tries again at the next save;
  - **the server says so:** when the join's serialize fails (L935–937), the
    joiner gets `error` `WORLD_UNREADABLE`, message `world could not be
    loaded`. The socket stays open;
  - **the client says so:** `_onSomDump` catches a `readJSON` failure, logs it,
    builds no SOM, and emits `error` with `code: 'WORLD_UNREADABLE'`, its
    `sessionId` and `url`, as a server error is emitted (L792–804);
  - **the app shows it:** `client.on('error')` (`app.js` L951) handles
    `WORLD_UNREADABLE` when `err.sessionId === readySessionId`, beside
    `WORLD_NOW_PRIVATE`: `showTeleportFailurePanel(teleportFailureMessage(err.url,
    {}, 'WORLD_UNREADABLE'), { showGoBack: false })`. With
    `codeToReason('WORLD_UNREADABLE')` exactly `That world can't be loaded right
    now.`, the panel reads `Couldn't open <destination>. That world can't be
    loaded right now.` (`teleport-failure.js` L150–151). Go back is hidden, as
    for eviction: there may be no previous world.

## 5. Tests and proofs
- **Run on today's code first, and keep the failure in the handoff:** the new
  server test file's join tests (below) on `8fc82bb5`.
- **The vectors,** in the server suite (`checkAddNode`) and the client suite
  (`add-spec.js`), every case.
- **A new server test file, port 0, through the real `attachSessionHandlers`**
  (the seam rule). **Every acceptance check ends with a read-back:** the later
  joiner reads its `som-dump` with the client's own `WebIO` and
  `KHRONOS_EXTENSIONS`, and a world `add` is followed by `serialize` →
  `createWorldFromDocument` → `serialize`. "The `som-dump` arrives" isn't
  enough (CR-M1):
  - `p4`'s 4-number POSITION avatar and CR-M1's `POSITION []` (avatar and world
    add): refused; a later joiner reads its dump;
  - CR-M2's 20,000-primitive avatar: refused, **with the reply under 500 ms**
    (today 3,800 ms);
  - CR `q3`'s 900 KB avatar `extras`, a 1,025-vertex avatar, a 2-primitive
    avatar, `1e39` and a wire `1e999` in POSITION, `translation: [1e999,0,0]`
    sent as raw text, a 600 KB `node.extensions`, and a 600 KB `format`: each
    refused, and **a present client receives no broadcast**;
  - the real avatar **as `AtriumClient.connect` sends it** (with
    `extras.atrium.ephemeral`), pad and palette descriptors and a real Duplicate
    descriptor (built by `buildAvatarDescriptor`, `buildTeleporterDescriptor`,
    `buildPrimitiveDescriptor` and `prepareDuplicate`): accepted, broadcast, and
    read back. `visitor-leak.test.js`'s first-party visitor cycle still passes;
  - `send` with `metallicFactor: 7`: refused. A material at each range's edges
    (0 and 1) is accepted by both `send` and `add`.
- **A10:**
  - autosave: with a test seam that makes the serialized document unreadable,
    the previous row is kept and the log line appears once; the next good save
    writes;
  - a join whose serialize throws sends `WORLD_UNREADABLE`;
  - `packages/client`: a `som-dump` the client can't read emits `error`
    `WORLD_UNREADABLE` and builds no SOM; a readable one behaves as today;
  - `apps/client`: `codeToReason('WORLD_UNREADABLE')` is the exact sentence.
- **The client's Duplicate and Undo** (`apps/client`): a node whose built
  descriptor A1 refuses (for example a material with `metallicFactor` 2, set as
  `send` allowed before this round) is refused by `prepareDuplicate` and
  `prepareRestore` with A1's reason; everything the existing tests accept still
  is.
- **The protocol tests** change with A8.
- **Proofs** (each break made, the named tests seen failing, the file restored
  from a saved copy):
  - (p1) A3's Float32 test reduced to `Number.isFinite`: the `1e39` vectors fail
    in both suites;
  - (p2) A5 removed: the avatar-budget vectors and the 20,000-primitive server
    test fail;
  - (p3) `translation` taken out of `checkTransformValues`: K6's unit test for
    it and the raw-text server test fail;
  - (p4) A9's ranges taken out of `materialValueOk`: the `send` range test
    fails;
  - (p5) autosave's read-back skipped: the A10 autosave test fails;
  - (p6) `_onSomDump`'s catch removed: the client's unreadable-dump test fails.
- **Claude's checks before DEV acceptance (outside the pipeline):** on the
  published SHA, `p3`, `p4`, `p7` and `review-q/q2` turned round (all refused,
  joins read back), and the regression set: `h1`–`h6` and 4d-1's `c2`, which
  exercise Duplicate, Undo and placement.

## 6. Worker rules and release path
As scripting-4d-1 (`PREBRIEF-scripting-4d.md` §8), with these specifics:
- **Four commits, each runnable:**
  1. the vectors, `checkAddNode`, `add-spec.js` and A9's predicates, with
     `translation` in K6, and their unit tests;
  2. the handler (A2's `format`, A6), `materialValueOk` (A9), the schemas (A8)
     and the new server test file;
  3. A10: `readBackProblem`, autosave, the join message, `_onSomDump`, the app
     and `teleport-failure.js`, with their tests;
  4. the client's Duplicate and Undo (A7), with the `exports` and import-map
     lines, the full suites, proofs (p1)–(p6) and the handoff.
- **Files:**
  - `packages/server/src/send-policy.js`, `session.js`, `autosave.js`,
    `world.js`;
  - `packages/protocol/src/schemas/add.client.json`, `add.server.json`,
    `error.json`;
  - `packages/client/src/add-spec.js` (new), `AtriumClient.js`;
  - `packages/client/package.json`: the `./add-spec` export only;
  - `apps/client/src/edit-duplicate.js`, `app.js`, `teleport-failure.js`;
  - `apps/client/index.html`: the `@atrium/client/add-spec` import-map line
    only;
  - `tests/fixtures/add-node-vectors.json` (new);
  - test files under `packages/*/test/`, `packages/*/tests/` and
    `apps/client/tests/`.
  
  **No other file.** If the brief or the implementation finds that another
  must change, stop and ask.
- **A new check must fail on today's code** before its PASS counts.
- **Server test files run one at a time** (AGENTS.md gotcha), each under
  `timeout 180`, and new tests use port 0.
- **One outside review of the round's code,** with `p3`, `p4`, `p7` and
  `review-q/q2` to run at the pinned commit.
- **Release:** a server, protocol and client round. DEV restarts at the deploy,
  and acceptance needs a hard reload in every tab. **`package.json` changes
  (an `exports` entry, no dependency), so the deploy's install step runs;**
  the lockfile doesn't change. Rolling back stores nothing to undo, but reopens
  §2.3.
- **Before the PROD deploy, the operator reruns `p6`** (§2.6) at this file's
  commit or later. A nonzero "would refuse" count is shown to Claude before
  PROD: those objects keep working where they are, but Duplicate and Undo will
  refuse them.
- **Never push to `main` between the release merge and PROD `COMPLETE`.**

## 7. Review log
- **Rev 1.1, FINAL** (2026-11-05): a fresh check of Rev 1 against the code at
  `8fc82bb5` (a Claude agent that hadn't written it) found two must-fixes,
  both taken: **A5 would have refused every real avatar,** which carries
  `extras.atrium.ephemeral` (now accepted, left to K4); and **`add-spec.js`
  needs an `exports` entry and an import-map line** (now in §6). Also taken:
  `send` doesn't call `checkTransformValues` (A2 now says K6 owns
  `translation`, and it's not a vector); the 65,535-vertex cap applies to
  every primitive; A10's panel call and text are pinned; `material: {}` passes;
  §2.6 says exactly what PROD's `p6` checked, `p6` now counts the rest (in UTF-8
  bytes), and its rerun is a release step. No decision changed.
- **Rev 1, FINAL** (2026-11-05): carved out of `PREBRIEF-richer-add-copy.md`
  Rev 0.2 (§2.1–2.3, §2.9, §3, §4), after the two outside reviews of its
  Rev 0.1, with the operator's decisions. Changes from that §4, all found while
  writing this file at `8fc82bb5`:
  - **`format`** is forwarded as sent, like `node.extensions`; A2 and A8 pin it
    to `"gltf"`;
  - **A10's code is `WORLD_UNREADABLE`:** `session:ready` comes before the
    dump, the app shows nothing for `WORLD_UNAVAILABLE` after it, and that
    code's text would be wrong (§2.5). A10 gains the app's panel, the exact
    reason sentence, and `readBackProblem` in `world.js`;
  - **the reason codes** are listed (A1), the vectors' shape is pinned, and
    §5's timing bound is 500 ms rather than 50 ms, for test-runner headroom.
