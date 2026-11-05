<!-- Outside review (Claude, claude.ai) of PREBRIEF-richer-add-copy Rev 0.1 at 923bd444, 2026-11-04.
     Copied from the reviewer's chat "Atrium richer-add design review" on 2026-11-05. Its probes q1 and q2 are in
     devtasks/spike-richer-add/review-q/; q3 and q-ajv are inlined below. -->

# Atrium richer-add / copy pre-brief review

**Verdict: CHANGES REQUESTED.** The plan is sound and I agree with RA-L1 (a): ship `add-check` alone, and soon. But §4's check stops at `node.mesh`, while the live defect it is meant to close is wider than §2.3 says. Three things a newcomer-blocking or server-stalling `add` can still do are either missed by A2/A3 or missing from the facts and tests: a mesh that saves but can't be read back, a many-primitive avatar that stalls the whole process, and node-level fields (`translation`, `extensions`, avatar `extras`) that no rule looks at. All three are reproduced below through the real `attachSessionHandlers`. The copy step needs two design corrections before its own revision: grants can't be "dropped" from a positional `nodeMap`, and the credit route needs limits.

**Reviewed:** `joshmaurice/atrium` at `923bd444305be4067fc589f99c77276a35dbf6c0`, `devtasks/PREBRIEF-richer-add-copy.md` (DRAFT Rev 0.1), against the code it cites. `git diff f42b5fe 923bd444 -- . ':!devtasks'` and `git diff 84542c73 923bd444 -- . ':!devtasks'` are both empty, so line numbers below hold for f42b5fe and PROD too.

**Cloned: YES.** `git clone https://github.com/joshmaurice/atrium` and `git checkout 923bd444…` both worked, with no DNS problem. **This is a runtime review, not source-only.**

**One deviation:** plain `pnpm install` was refused by this environment's command policy (an automatic safety check, not an install error). I ran `pnpm install --frozen-lockfile --ignore-scripts` instead: 69 packages from the lockfile, no lifecycle scripts. Every suite and probe below ran on that install.

Statuses: **REPRODUCED** = I ran it; **CONFIRMED IN THE SOURCE** = I read it at the pinned commit; **INFERRED** = follows from the source, not run. Nothing here is "verified": no fix exists yet.

---

## Must-fix

### M1 — A malformed `add` can save cleanly and leave a document that neither the client nor the server can read back. §2.3 and the planned tests miss this.

**References:** §2.3 ("Every other malformed case … saved and reloaded", "until the node is deleted", "What it isn't"), §4 Tests, §8; `packages/server/src/autosave.js:80–83`; `packages/server/src/world-registry.js:661`; `packages/server/src/world.js:638–651`; `packages/client/src/AtriumClient.js:1191–1198`; `packages/server/src/session.js:918–937`.

**Scenario:** an `add` whose primitive has `POSITION: []`.
- The server accepts it.
- `serialize()` **succeeds**: the join's som-dump is sent, and nothing is logged.
- The joining client's `WebIO.readJSON` throws `Cannot read properties of undefined (reading 'buffer')`. The dispatch path (`_onSomDump`) has no catch, so the newcomer sits on a world that never loads.
- **Owner's version:** autosave writes the document (it never reads it back). The next `registerWorldFromDocument` fails in `createWorldFromDocument`, the same error, before any healer runs. That happens on the next boot, or as soon as the world empties and is torn down (`world-registry.js:600–606`).
- From then on the world can't be entered, so the owner can't delete the node. The fix is hand surgery on the database.

So §2.3's "the owner's version stops joins and autosave until the node is deleted" is not the worst case, and "rolling back loses nothing" (§4 Release) is only true once nothing like this is already saved. A2's "at least 9" does refuse this case, so the code fix is fine. What's wrong is the facts, and a planned test that would still pass while this class of failure exists:
- §4's `p4` test checks that "a later visitor's join **gets** its som-dump". Here it gets one, and still fails.

**Recommendation:**
1. Correct §2.3: add this case and its persistence.
2. Make every acceptance check end-to-end:
   - the later joiner **reads** the som-dump with the client's own `WebIO.readJSON` (KHRONOS_EXTENSIONS);
   - a world `add` is followed by `serialize` → `createWorldFromDocument` → `serialize`.
3. Defence in depth, since `richer-add` widens `ingestNode` next:
   - autosave reads the serialized JSON back with `readJSON` and keeps the previous row if that fails;
   - the join path sends the joiner an error instead of silence (`session.js:935–937`).
4. Have p6 report which rows are unreadable (it already counts them), so the operator knows whether PROD holds one today.

**Status:** **REPRODUCED** (q1, q2(a)). `POSITION [0,0]` throws at `serialize` (the DataView case §2.3 has). `POSITION [] + indices [0,1,2]`, `NORMAL []` and `indices []` all save and read back.

### M2 — One anonymous avatar `add` stalls the whole server process for seconds. That's also part of the live defect.

**References:** §2.3, RA-L5, §8 ("Size is already bounded by the 1 MiB message"); `packages/som/src/SOMDocument.js:802–804` (a new buffer per primitive); `session.js:1383` (`world.addNode` is synchronous on the message path).

**Scenario:** an anonymous visitor sends an avatar `add` of 20,000 primitives, each one triangle. The message is 938 KiB, under the 1 MiB cap.
- `world.addNode` takes **4.2 s** of synchronous work. Every world on that Node process stops for that time.
- The som-dump grows to **6.7 MiB**, because each primitive gets its own buffer (20,001 buffers).
- Cost is superlinear: 40,000 primitives took 24.7 s, though that message is over the cap.
- Ingest also slows as the **document** grows (q4): one 64-primitive add takes 2.6 ms in a fresh world and 62 ms once ~19,000 buffers are in it.

A2's 1–64 primitive cap closes the 4.2 s case. But §2.3 doesn't list it, and no test pins it.

**Recommendation:**
1. Record it in §2.3.
2. Add it to the vectors and the server test: a 20,000-primitive avatar is refused, quickly.
3. In A1, check `primitives.length` (and every array length) **before** any per-element work.
4. When `richer-add` reworks `ingestNode` (§5), make one buffer per `ingestNode` call instead of one per primitive (`SOMDocument.js:804`).

**Status:** **REPRODUCED**: q1 through the real handler (accepted; 6,678 KiB som-dump); q2(b) and q4 timing `world.addNode` directly, which is the call the handler makes.

### M3 — A2/A3 check only `node.mesh`. `ingestNode` also reads `translation` and `extras`, and silently drops `extensions`.

**References:** §4 A1–A3, §8 ("a field that would be silently dropped is refused"), §2.1 item 5 ("K6 (transform values, avatars included)"); `SOMDocument.js:781–787`; `send-policy.js:115–124` (`checkTransformValues`: rotation and scale only) vs `send-policy.js:1687` (`send` requires `translation` to be 3 finite numbers); `packages/protocol/src/schemas/add.client.json` (`node.extensions: {type: object}`, numbers untyped beyond `number`); `session.js:1394–1413` (broadcasts `msg.node` as sent).

**Scenarios** (all through the real handler, anonymous avatar `add`):
- **`translation: [1e999, 0, 0]` on the wire.** `JSON.parse` turns it into `Infinity`, and Ajv `type: number` accepts that. The add is accepted: the live node holds `Infinity`, while present clients and joiners see `[null, 0, 0]`. As a world `add`, a save writes `null` and a reload drops it, so the object moves to x = 0. `send` refuses the same value (L1687). This is the add/send drift K6 was meant to prevent.
- **`node.extensions` of 600 KB.** Accepted. `ingestNode` drops it, and the server still forwards all 600 KB to every present client.
- **Avatar `extras` of 900 KB.** Accepted and kept (K4 only forbids `extras.atrium`). Every later join's som-dump carries it. With 20 such visitors, each newcomer downloads **17.3 MiB** (q3). There's no WebSocket connection limit; the per-IP limiter covers only the HTTP auth routes (`http-routes.js:58–150`).

**Recommendation:** make A1 `checkAddNode`, not `checkAddMesh`, and cover:
- `translation`: 3 finite numbers, folded into K6 (`checkTransformValues`) so `add` and `send` share it;
- non-empty `node.extensions`: refused (nothing keeps it);
- avatar `extras`: only `displayName` (the server overwrites it anyway, `session.js:1378–1381`), at most `NAME_MAX`;
- world-add `extras` outside `extras.atrium`: bounded (RA-L5's 16 KiB is a reasonable number).

Avatar numbers are in S2.

**Status:** **REPRODUCED** (q1, q2(c), q3).

---

## Should-fix

### S1 — A3's [0, 1] ranges on `add` aren't on `send`. After `add-check`, some objects can't be duplicated or undo-deleted.

**References:** §4 A3, RA-L5; `send-policy.js:1405–1416` (`materialValueOk`: `isVec4` / `isFiniteNumber` only, no range); `edit-duplicate.js:124–136`.

**Scenario:** today `send` accepts `metallicFactor: 7` or `baseColorFactor: [2, 0, 0, 1]`, and so would the SOM Inspector and a behaviour writing a material. After `add-check`, A5 refuses to Duplicate or restore that object, so deleting it can't be undone. The regression comes from `add-check` itself.

**Recommendation:** put the same range predicates on `send` in the same round (one shared predicate, as K6 did). glTF requires [0, 1] for these anyway. Also have p6 count saved materials with any factor outside [0, 1], to size this on PROD.

**Status:** **CONFIRMED IN THE SOURCE**; the effect is **INFERRED**.

### S2 — RA-L4 and RA-L5: A2's numbers leave avatars bounded only by the 1 MiB message.

**References:** RA-L4, RA-L5, §8; `packages/renderer-three/src/geometry-utils.js:120–143`.

**The numbers:**
- The first-party avatar is **one primitive, 162 vertices, max index 161** (q1(1) builds it).
- A2 allows 64 primitives of up to 65,536 vertices each, so for an anonymous sender the 1 MiB message is the only real limit.
- What one anonymous connection costs is multiplied into every join (q3; M2).

I disagree with §8's "don't add a second byte limit" for avatars.

**Recommendation:** RA-L4 (a), plus avatar-specific bounds:
- at most 1 primitive (or 2);
- at most 1,024 vertices;
- `extras` as in M3.

That leaves first-party headroom of more than 6×.

For world adds, the 64-primitive cap and the 1 MiB message are adequate. RA-L5's extras (3 × 16 KiB per primitive) fit under the message cap. Worlds still have no total size limit, which this round doesn't change; copy makes filling one easier, but only for the owner.

**Status:** **REPRODUCED** (q1, q3); the bounds are a recommendation.

### S3 — The seams between A1, A4, A5 and A6 aren't specified.

**References:** §4 A1, A4–A6; `session.js:712–716`; `edit-duplicate.js:247–282, 320–353`.

**The gaps:**
- **A6 changes A4's error code.** The server runs the schema before the handler, and a schema failure is `UNKNOWN_MESSAGE` with Ajv's text, not `INVALID_VALUE mesh: <reason>`. Once A6 types the mesh, most shape refusals arrive with that code. Say which layer refuses which case, and keep the vectors to A1 alone: A1 must be complete without the schema.
- **A5's form is unclear.** A1's vectors are wire descriptors, but `duplicateRuleProblem` reads glTF-Transform nodes and runs on every hint refresh (outside review S2: kept cheap on purpose). Recommendation:
  - run A1 on the **built descriptor** inside `prepareDuplicate` / `prepareRestore`, which run at click time and are exactly what the server will see;
  - keep the document-form rules for the hint.
- **A4 placement.** "After K6, before the first world change" is right (`session.js:1314` → `1383`). For world adds, call it inside the existing V9 `try` (L1329); avatars need their own `try`, because the V9 block is world-only. Also say whether a model node that carries a malformed mesh gets the mesh reason or the model's (`checkModelHost` runs in the same block).

**Status:** **CONFIRMED IN THE SOURCE.**

### S4 — §5's sketch misses how the new attributes are encoded, one D5 hole, and stale tabs.

**References:** §5, RA-L2; `edit-duplicate.js:124–136, 174–176, 183–216`.

- **Normalized-integer attributes.** `sendableArray` is `Array.from(acc.getArray())`, which gives **raw** integers. A `COLOR_0` stored as normalized `UNSIGNED_BYTE`/`UNSIGNED_SHORT` (Blender's usual export) would go out as 0–255 or 0–65535, and the receiver's `Float32Array` would treat those as colour values. The copy renders blown out, or RA-L5's [0, 1] refuses it. Decide one of:
  - convert to floats (a componentType change; name it as a D5 exception);
  - refuse non-float attributes.
- **`COLOR_0` type.** It can be VEC3 or VEC4. `ingestNode` has to set the type, from the wire or from the POSITION count (unambiguous, but specify it).
- **A D5 hole today.** `materialProblem` never checks `alphaCutoff`. An opaque material whose cutoff was set through `send` (allowed, L1411) duplicates and restores **without** it. `richer-add` fixes this by carrying it; state it.
- **Canonical form.** `prepareRestore` is compared "key order included". Emit material fields only when they differ from the glTF default: glTF-Transform can't tell an explicit default from an absent one, so that's the only canonical choice.
- **Version skew.** During the deploy window, an owner's tab that hasn't reloaded ingests a richer `add` without the new fields. If it then deletes and undoes that object, it re-adds the poorer copy: silent loss. A protocol or `hello` capability bump (as `scriptRunner` does) would let the server refuse a stale client's `add`. A hard-reload note doesn't prevent this.
- **Rendering: yes, with no other changes.** `@gltf-transform/view` 4.4.0 maps `COLOR_0` to `vertexColors` (L154, L196), `doubleSided` to `side`, `BLEND` to `transparent` with `depthWrite = false`, `MASK` to `alphaTest`, and `emissiveFactor` to `emissive` (L894–924). **CONFIRMED IN THE SOURCE** of the installed package; not run in a browser.

**Status:** **CONFIRMED IN THE SOURCE**; the effects are **INFERRED** (no fixture has `COLOR_0`, §2.5).

### S5 — CP-L5's "grants to other objects are dropped" can't be done by removing entries. Keep (a) for its security, not its tidiness.

**References:** CP-L5; `packages/behaviors/src/behavior-spec.js:775–780` (`nodeMap` unique, `nodeMap[0]` must be the object's own id), `:814–819, 910–919` (graph pointers bind to `nodeMap` **by index**), `:789–828` (`/animations/<i>` by index); `edit-duplicate.js:289–309`.

**Removing entries breaks the graph.** Every pointer past the removed index shifts to a different entry, or goes out of range so that `behaviorCheck` refuses the paste.

**Recommendation:** replace each grant with a **fresh, unused object id**: indices stay valid, the form passes, and the grant points at nothing. Do the same for every `animations[].object` and `template.params.target` that isn't the object itself. Say what happens to `targets`.

**The reason to keep (a):** a world's owner chooses their objects' ids (only the form and per-world uniqueness are checked), and a visitor can read every object id in a public world's som-dump. A hostile source world can therefore publish a behaviour whose grants name the ids of objects in the paster's own world. Under (b), once the paster enables it, the graph controls those objects.

**Status:** **CONFIRMED IN THE SOURCE**; the attack is **INFERRED**.

### S6 — CP-L3 and CP-L4: forged credit and the name-resolving route.

**References:** CP-L3, CP-L4, §2.8.

- **Forged credit.** A modified client can stamp any user's id as `origin.creator`. With CP-L3 (a), the panel then shows that person's **current** name, resolved by the server, which makes a forged claim look authoritative (pinning content on someone, or claiming someone else's work). "Credit, not proof" (C4) needs to show in the wording: "says it was made by", or "copied from" with the address.
- **The route.** As sketched, it would map any world id to its name, private worlds included, and any user id to a username, which no endpoint does today. Limit it to worlds the caller can see. Answer "a private world" otherwise. Rate-limit it.
- **My choice differs from the recommendation.** For this round I'd store **both** the address and username the client already has (for display) and the ids (as stable keys). That's (b)'s zero server work, with (a)'s ids kept for a later rename. The route and `hello`'s new fields can wait until renames exist.
- **Where real proof is possible.** Same-server provenance could later be made verifiable: the server stamps `origin` when it first creates an object, and checks it on same-server pastes.

**Status:** **INFERRED** (design review).

### S7 — CP-L6: where to resolve model URLs, and the "Library" credit.

**References:** CP-L6; `packages/client/src/model-spec.js:66–103`; `apps/client/src/library-catalog.js:309`.

- **Resolve at paste time, not copy time.** If a root-relative URL is made absolute when copied, a same-server paste also becomes absolute and breaks if the domain moves. Keep the source base in the clipboard; resolve when pasting, and only when the destination's origin differs.
- **"Library" credit.** Model URLs may name any `https` host; there's no host allowlist, and `checkModelHost` is only the node-level half. So absolute URLs give a hostile world nothing it lacks today: it can already make every visitor fetch any `https` URL. But a credit of "Library" for any `/assets/library/` path would label `https://evil.example/assets/library/x.glb` as Atrium's library. Give that credit only when the resolved origin is the destination server's own.
- **DEV servers on `http://`.** Absolutizing there produces a URL that A1 refuses (`url-scheme`), so the paste fails. Say so, or fall back to (b) in that case.

**Status:** **CONFIRMED IN THE SOURCE**; the effects are **INFERRED**.

---

## Nits

- **N1 — Index 65535.** WebGL 2 always enables primitive restart for `drawElements`, and glTF forbids an index of 65535 in an unsigned-short accessor. For indexed primitives, bound vertices at 65,535 (so indices ≤ 65,534); `MAX_INDEX` in `edit-duplicate.js:36` has the same off-by-one. **INFERRED** (spec), not run.
- **N2 — `indices: []` passes A2 as written** (0 is a multiple of 3). Require at least 3. Today it's accepted, saved and read back (**REPRODUCED**, q2(a)), but glTF requires accessor count ≥ 1.
- **N3 — RA-L2 (c)'s wording.** "The original keeps them" isn't true for an Undo restore: the restored node is the only copy, so its accessor and buffer labels are gone from the saved world. Say "a restored object loses them".
- **N4 — p6.** Also count non-finite or short accessors, and materials outside [0, 1] (S1), so the operator learns what `add-check` would newly refuse on PROD.
- **N5 — Inspect panel.** Name the existing rule (`textContent` / `escHtml`, as in `graph-import-panel.js` and `app.js:285`): the panel renders another user's names, prose and graph labels.
- **N6 — Present clients (§2.3 "not probed").** Through the real handler, present clients do receive the malformed broadcast (q2(c)). The client runs the same `ingestNode` (`AtriumClient.js:1557`), and I found no schema-valid input that makes it throw. So a present client most likely draws nothing or garbage for that node and keeps working until it reconnects, when M1's unreadable som-dump applies. **INFERRED**; I didn't run three.js or a browser.

---

## Decisions: RA-L1–RA-L6, CP-L1–CP-L7

| Decision | Recommendation | My view |
|---|---|---|
| RA-L1 | (a) `add-check` first | **Agree, strongly.** PROD is public and §2.3 is live. Include M1–M3, S1 and S2 in it. |
| RA-L2 | (c) | **Agree**, with S4's encoding decisions and N3's wording. |
| RA-L3 | (a) own material | **Agree.** (b) makes deleting any `atrium.gltf` column permanent; sharing would only matter if Atrium ever showed it. |
| RA-L4 | (a) no richer fields | **Agree, plus S2's tighter avatar numbers and M3's extras rule.** |
| RA-L5 | (a) | **Agree** for world adds; add the avatar numbers, put the ranges on `send` too (S1), and N1. |
| RA-L6 | (a) | **Agree.** |
| CP-L1 | (a) Inspect mode | **Agree.** Graphs are already in every visitor's som-dump (Q6), so Inspect adds UI, not exposure. N5. |
| CP-L2 | (a) in memory | **Agree.** |
| CP-L3 | (a) ids + route | **Differ: store address/username and ids, no route this round** (S6). |
| CP-L4 | (a) form and bounds | **Agree**; wording per S6. |
| CP-L5 | (a) | **Agree, but replace grants with fresh ids, don't remove them** (S5). |
| CP-L6 | (a) | **Agree, resolving at paste time, with S7's Library check.** |
| CP-L7 | (a) | **Agree.** |

## Answers to the brief's questions

1. **Is A2–A6 complete?**
   - **Fields `ingestNode` reads:** `name`, `translation`, `rotation`, `scale` and `extras` on the node; `mesh.name`; `primitives[]`; POSITION, NORMAL, indices; three `pbrMetallicRoughness` factors (`SOMDocument.js:781–852`). A2/A3 miss `translation` and `extras` (M3), and `node.extensions` is dropped without a rule (M3).
   - **Can schema-valid input make `ingestNode` throw?** I found none: the schema forces primitives to be objects in an array. So the half-registered node it would leave behind (it registers the node before the mesh loop, L787–802) isn't reachable today. Keep A4's fail-closed `try` regardless.
   - **First-party senders: none refused.** I checked the avatar, the teleporter pad and all five palette kinds (`cube`, `plane`, `sphere`, `cylinder`, `ramp`), built by the real builders, against a literal reading of A2/A3 (**REPRODUCED**, q1(1)). Library and models-by-URL placements carry no mesh. Redo and other structural re-adds resend a recorded descriptor (`app.js:1838`). `tools/protocol-inspector`'s sample `add` has no mesh, and `tools/som-inspector` sends no `add`. The only first-party refusals `add-check` creates are S1's out-of-range materials.
   - **Other paths:**
     - `send` reaches materials only, by `MATERIAL_PATH_RE`, with finite, shape-checked values. It can't reach geometry and can't break `serialize`, but see S1.
     - PUT is server-authoritative: it serializes the live SOM, and the body supplies only metadata (`http-routes.js:751`).
     - Server-side external content comes only from `extras.atrium.source`, which S2 forbids clients to set, and is excluded from every serialize.
     - The healers run after `readJSON` and don't look at geometry, so they can't repair M1.
     - So `add` is the only way in for clients. **CONFIRMED IN THE SOURCE.**
   - **Present clients:** N6.
   - **A4's placement:** right; S3 has the details.
2. **RA-L4/L5 numbers:** S2 and N1.
   - Against the 1 MiB cap: 3 × 65,536 floats is about 1.5 MB at 8 bytes per number, so the message is what actually limits a full mesh.
   - Against Uint16: one off, for indexed meshes (N1).
   - Left unbounded: avatar `extras`, `node.extensions`, world-add non-Atrium `extras`, and `translation` values (M3).
3. **The two D5 exceptions:** both are better than refusals.
   - Labels: nothing Atrium or three.js reads, and step 7's export doesn't need them. Fix N3's wording.
   - Sharing: the user loses only "editing one column recolours the others", which nothing in Atrium explains today (p5).
   - Add a third stated exception if S4 converts integers to floats.
4. **§5:** S4. The rendering answer is yes, as covered there.
5. **Copy:** S5, S6 and S7. Inspect mode exposes nothing new (CP-L1 row).
6. **Order:** ship `add-check` alone first, with this review's must-fixes.

---

## Audit of §2's facts (at 923bd444, same code as f42b5fe)

| Claim | Result |
|---|---|
| §2.1 schema accepts almost any mesh | **Confirmed** (`add.client.json`), and Ajv accepts `Infinity` from `1e999` (q-ajv) |
| §2.1 server check order, nothing reads `node.mesh` | **Confirmed** (`session.js:1226–1383`); but K6 doesn't cover `translation` (M3) |
| §2.1 `maxPayload` 1 MiB; `MAX_ADD_BYTES` 1,000,000 | **Confirmed** |
| §2.2 kept / dropped / unchecked | **Confirmed** (`SOMDocument.js:781–852`); add `node.extensions` to "dropped" |
| §2.2 first-party adds send exactly what's kept | **Reproduced** (q1(1)) |
| §2.3 p3, p4 | **Reproduced**, output identical. Incomplete: M1, M2, M3 |
| §2.3 "world documents already saved are not affected" | **Holds only for the serialize-throws class**; M1 is a class that saves |
| §2.4 D5 rules | **Confirmed**, plus a hole: `alphaCutoff` isn't checked (S4) |
| §2.5 p1 35 top-level, 1 accepted, 13/13/4/2/2 | **Reproduced** |
| §2.5 p2 62/40/2/1 | **Reproduced** (p2 also prints camera 4 and `KHR_lights_punctual` 2, which aren't mesh nodes, so the table is right to omit them) |
| §2.6 p5, nine primitives turn red | **Reproduced** |
| §2.7 `send` writes emissive/alpha/double-sided | **Confirmed**: shape-checked, no range (S1) |
| §2.8 PUT/route facts, storage, `storedUrl` | **Confirmed** where checked (`library-catalog.js:309`); browser storage not re-grepped |

---

## What I ran

**Environment:** Node `v22.23.4`, pnpm `10.28.0`. Clone and checkout OK. Install: `pnpm install --frozen-lockfile --ignore-scripts` (plain `pnpm install` was refused by this environment's command policy).

**Suites, all passing:**

| Suite | Tests |
|---|---|
| `packages/protocol` | **123 / 123** (26 suites) |
| `packages/som` | **266 / 266** (3 suites) |
| `apps/client` (`edit-duplicate`, `edit-undo`) | **88 / 88** (10 suites) |
| `packages/server` `avatar.test.js` | **7 / 7** |
| `packages/server` `edit-plumbing.test.js` | **42 / 42** |

Server files were run one at a time with `timeout 180`; none hung.

**The pre-brief's probes:**

| Probe | Result |
|---|---|
| p1, p2, p3, p4, p5 | Run as §2.9 gives them; output matches the document, including p4's `som-dump serialize failed: RangeError: Offset is outside the bounds of the DataView` and its recovery after the visitor leaves |
| p6 | **Not run**: it needs a copy of the PROD database |

**My probes** (code in the appendix; run from the repo root):

| Probe | What it does |
|---|---|
| `q-ajv` | the schema accepts `Infinity` |
| `q1-addcheck-gaps` | first-party builders against A2/A3; 13 cases through the real handler, plus save and reload |
| `q2-empty-accessor-and-cost` | which accessors produce unreadable documents; ingest cost; raw-wire `1e999` through the real handler |
| `q3-avatar-amplification` | N anonymous avatars with 900 KB `extras`, and what each later join costs |
| `q4-ingest-scaling` | ingest cost against the document's buffer count |

## What I couldn't do

- **No browser.** Rendering (S4, N6) is from `@gltf-transform/view`'s source, not seen.
- **No three.js or WebGL run** for present clients (N6).
- **p6 not run:** no database. PROD's real mix and whether PROD holds an unreadable row today (M1) are unknown.
- **N1 (primitive restart) not tested**: it's from the WebGL 2 and glTF specs.
- **No deployed site touched**, nothing pushed, no PR opened. Nothing was changed in the clone apart from `node_modules`; the probes live outside it.

---

## Appendix: probe code and output

### q-ajv

```js
import path from 'node:path'
const { validate } = await import(path.resolve('packages/protocol/src/index.js'))
const m = JSON.parse('{"type":"add","seq":1,"node":{"name":"x","translation":[1e999,0,0],"mesh":{"primitives":[{"attributes":{"POSITION":[1e999,0,0,1,0,0,0,1,0]}}]}}}')
console.log('translation', m.node.translation, JSON.stringify(validate('client', m)))
```
```text
translation [ Infinity, 0, 0 ] {"valid":true,"errors":[]}
```

### q1-addcheck-gaps.mjs (output)

The code is in the attached `q1-addcheck-gaps.mjs`. It is a literal reading of A2/A3 as `checkAddMeshDraft`, plus the real-handler harness from p4.

Caveat: in q1, the three `1e999` cases were sent with `JSON.stringify`, which turns Infinity into `null`. The `translation` avatar case was therefore refused by the schema, and the other two sent `null`. **Use q2(c) for the wire result.** The `world add` lines for those cases did use real Infinity (passed directly to `world.addNode`).

```text
== (1) the real first-party builders against A2/A3 read literally
  avatar: accepted
  pad: accepted
  cube: accepted
  plane: accepted
  sphere: accepted
  cylinder: accepted
  ramp: accepted

== (2) each case: A2/A3 draft verdict | schema | anonymous avatar add | later join | owner world add → save → reload
- translation [1e999,0,0], no mesh
    draft: accepted | schema pass | avatar: refused UNKNOWN_MESSAGE
    later join: som-dump 12 KiB, client reads it
    world add: saved translation [null,0,0]; reload ok; re-save ok, translation null
- mesh {} (no primitives)
    draft: primitives 1–64 | schema pass | avatar: accepted (301 ms)
    later join: som-dump 12 KiB, client reads it
    world add: saved translation null; reload ok; re-save ok, translation null
- primitives [{}] (no attributes)
    draft: attribute keys | schema pass | avatar: accepted (301 ms)
    later join: som-dump 12 KiB, client reads it
    world add: saved translation null; reload ok; re-save ok, translation null
- POSITION [] 
    draft: POSITION | schema pass | avatar: accepted (301 ms)
    later join: som-dump 12 KiB, client readJSON THROWS: Cannot read properties of undefined (reading 'buffer')
    world add: THROWS: Cannot read properties of undefined (reading 'buffer')
- indices [] (A2: 0 is a multiple of 3)
    draft: accepted | schema pass | avatar: accepted (301 ms)
    later join: som-dump 12 KiB, client reads it
    world add: saved translation null; reload ok; re-save ok, translation null
- POSITION has 1e999
    draft: POSITION | schema pass | avatar: accepted (301 ms)
    later join: som-dump 12 KiB, client reads it
    world add: saved translation null; reload ok; re-save ok, translation null
- NORMAL length 4
    draft: NORMAL | schema pass | avatar: accepted (301 ms)
    later join: som-dump 12 KiB, client reads it
    world add: saved translation null; reload ok; re-save ok, translation null
- baseColorFactor {}
    draft: baseColorFactor | schema pass | avatar: accepted (303 ms)
    later join: som-dump 12 KiB, client reads it
    world add: saved translation null; reload ok; re-save ok, translation null
- baseColorFactor "abcd"
    draft: baseColorFactor | schema pass | avatar: accepted (300 ms)
    later join: som-dump 12 KiB, client reads it
    world add: saved translation null; reload ok; re-save ok, translation null
- metallicFactor 1e999
    draft: metallicFactor | schema pass | avatar: accepted (301 ms)
    later join: som-dump 12 KiB, client reads it
    world add: saved translation null; reload ok; re-save ok, translation null
- node.extensions 600 KB (not mesh)
    draft: accepted | schema pass | avatar: accepted (305 ms)
    later join: som-dump 12 KiB, client reads it
    world add: saved translation null; reload ok; re-save ok, translation null
- node.extras 900 KB (avatar)
    draft: accepted | schema pass | avatar: accepted (306 ms)
    later join: som-dump 891 KiB, client reads it
    world add: saved translation null; reload ok; re-save ok, translation null
- 20,000 primitives [{POSITION tri}]
    draft: primitives 1–64 | schema pass | avatar: accepted (3736 ms)
    later join: som-dump 6678 KiB, client reads it
    world add: saved translation null; reload ok; re-save ok, translation null
```

(Avatar times include the probe's fixed wait of 300 ms, or 3,000 ms for the last case. "translation null" means the node has no translation, i.e. the default.)

### q2-empty-accessor-and-cost.mjs

Code: the attached `q2-empty-accessor-and-cost.mjs`. Its (b) "64 primitives" row is over the 1 MiB cap as sized, so it shows only that ingest cost is per primitive, not per number.

```text
== (a) short / empty accessors: serialize | client reads som-dump | createWorldFromDocument
  POSITION []: serialize ok | client THROWS "Cannot read properties of undefined (reading 'buffer')" | reload THROWS "Cannot read properties of undefined (reading 'buffer')"
  POSITION [] + indices [0,1,2]: serialize ok | client reads | reload ok
  POSITION [0,0] (2 numbers): serialize THROWS Offset is outside the bounds of the DataView
  POSITION tri + NORMAL []: serialize ok | client reads | reload ok
  POSITION tri + indices []: serialize ok | client reads | reload ok

== (b) cost of one ~1 MiB avatar-sized add (world.addNode + serialize, no network)
  20,000 primitives x 1 triangle: message 938 KiB; ingest 4239 ms; serialize 282 ms; som-dump 6678 KiB; buffers 20001
  40,000 primitives x 1 triangle: message 1875 KiB; ingest 24692 ms; serialize 570 ms; som-dump 13378 KiB; buffers 40001
  64 primitives (A2 cap), ~1 MiB of numbers: message 5691 KiB; ingest 7 ms; serialize 34 ms; som-dump 1833 KiB; buffers 65

== (c) raw-wire 1e999 through the real session handler (anonymous avatar add)
  translation [1e999,0,0]: accepted; live translation [null,0,0] (has Infinity: true); present client got the broadcast: true (as text: [null,0,0]); later join som-dump: true, node translation [null,0,0]
  POSITION has 1e999: accepted; live translation [0,0,0] (has Infinity: false); present client got the broadcast: true (as text: [null,0,0]); later join som-dump: true, node translation null
```

(In (c), "live translation [null,0,0]" is the probe printing the live array with `JSON.stringify`; the next field shows the live value is `Infinity`.)

### q3-avatar-amplification.mjs

Code: the attached `q3-avatar-amplification.mjs`. Each visitor sends the real 162-vertex capsule plus `extras.pad` of 900,000 characters, which A2/A3 and RA-L4 (a) would accept.

```text
0 visitors holding a 900 KB avatar: a later join's som-dump 0.0 MiB, hello→som-dump 7 ms; server: serialized default in 3 ms (11820 bytes)
5 visitors holding a 900 KB avatar: a later join's som-dump 4.3 MiB, hello→som-dump 63 ms; server: serialized default in 2 ms (4553285 bytes)
10 visitors holding a 900 KB avatar: a later join's som-dump 8.7 MiB, hello→som-dump 135 ms; server: serialized default in 1 ms (9094774 bytes)
20 visitors holding a 900 KB avatar: a later join's som-dump 17.3 MiB, hello→som-dump 249 ms; server: serialized default in 6 ms (18177767 bytes)
```

### q4-ingest-scaling.mjs

```js
import path from 'node:path'
const { createWorld } = await import(path.resolve('packages/server/src/world.js'))
const log = console.log; console.log = () => {}
const tri = [0, 0, 0, 1, 0, 0, 0, 1, 0]
const node = (name) => ({ name, mesh: { primitives: Array.from({ length: 64 }, () => ({ attributes: { POSITION: tri } })) } })
const w = await createWorld(path.resolve('tests/fixtures/space.gltf'))
let i = 0
for (const target of [0, 64 * 50, 64 * 150, 64 * 300]) {
  while (w.som._document.getRoot().listBuffers().length < target) w.addNode(node(`n${i++}`), null)
  const t0 = performance.now(); w.addNode(node(`probe${target}`), null)
  log(`buffers already in the document ≈${target}: one 64-primitive add takes ${(performance.now() - t0).toFixed(1)} ms`)
}
```
```text
buffers already in the document ≈0: one 64-primitive add takes 2.6 ms
buffers already in the document ≈3200: one 64-primitive add takes 4.3 ms
buffers already in the document ≈9600: one 64-primitive add takes 5.3 ms
buffers already in the document ≈19200: one 64-primitive add takes 62.0 ms
```
