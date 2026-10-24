# Pre-brief: Phase 3 step 4b — behaviours, owner-present: the plan (4b-1, 4b-2), the engine spike, and 4b-1 (identity and the script host) in detail

Status: **Rev 0, DRAFT (2026-10-23), for the operator and an outside
review.** Decisions B1–B6 and E-L1–E-L6 are open, each with a
recommendation.
- **Drafted by Claude from `main` at `aa0702c8`.** Its code is identical to
  the released `147df814` (DEV, MAIN and PROD). Line numbers are at that
  commit. Claims marked *probe* were run against the real modules or the
  real engine with throwaway scripts (not committed).
- **Sources:**
  - the design, `docs/DESIGN-phase3-placement-scripting.md` Rev 1.2:
    - §4.9 (`objectId`);
    - §5.1–§5.5 (two layers, the script host, the API, storage,
      interpreter and templates);
    - §7 items 2 and 8;
    - §9 row 4;
    - §10 Q2, Q6 and Q7;
  - the step 4 pre-brief, `devtasks/PREBRIEF-scripting-4a.md` FINAL Rev 1.2:
    D1–D6 (approved 2026-10-23; D2 provisional on this spike, D5 as a
    direction only) and §9.1 (4b's sketch);
  - the 4a passdown, `devtasks/Atrium-Passdown-2026-10-23-scripting-4a.md`
    §6.1: five 4a items carried into 4b;
  - **the D2 spike (§2.2):** Claude ran the pinned engine against D2's four
    pass criteria and against Khronos's test assets, 2026-10-23.
- **Scope of this document:**
  - §1–§3 frame **all of 4b**, propose splitting it into two rounds, record
    the spike, and set the decisions that shape both rounds;
  - §4–§8 are **the contract for 4b-1 only**: stable object identity
    (`objectId`) and the script-host role. No behaviour runs in 4b-1.
  - **4b-2 gets its own pre-brief** after 4b-1 releases, as 4b–4d each do.
    §9 sketches it, with the adapter design the spike supports.
- **Out of scope for all of 4b:** visitors' `activate` (4c), graph import
  and the unsupported-node report beyond the templates (4d), the graphical
  editor (step 5), JavaScript (step 6), behaviours while the owner is away
  (design §7 item 2) and the world file's own animations (step 4 pre-brief
  §9.5).

## 1. Why 4b is two rounds

4a was one leaf, a clock and a panel row. It took three rounds: two after
reviews and one after DEV acceptance. 4b as sketched in the step 4
pre-brief §9.1 is several times that:
- the identity rule (`objectId`) across every add path, Duplicate and Undo;
- a new role in the protocol (`hello.scriptHost`, `hostGen`, `script-host`)
  with handover;
- a vendored third-party engine (about 540 KB with `gl-matrix`) and its
  adapter;
- the script API, events, write coalescing and resource limits;
- five templates, a behaviour form with a target picker, and D5's drag rule.

It splits along a clean seam:

| Round | What the owner gets | Server / protocol |
|---|---|---|
| **4b-1** | Nothing visible to visitors. Every new object gets a permanent id; the Edit panel tells an owner with two tabs which one runs behaviours | `objectId` rules on `add` and a set-once leaf; `hello.scriptHost` and `hostGen`; the `script-host` message with handover; schemas |
| **4b-2** | Behaviours: five templates in the Edit panel (on select show or hide, on select play or stop, on enter play and on exit stop, on select toggle a light, every N seconds play), run by the owner's script-host tab, saved with the world | `extras.atrium.behavior`: a writable leaf with a strict server check (size, op allowlist, `nodeMap`/`targets` ids) |

**4b-1 first** because:
- 4b-2's runner, `nodeMap` and `targets` all name objects by `objectId`
  (design §4.9, §5.3);
- the host role decides *where* 4b-2's runner starts;
- both are server and protocol work with no third-party code. They can be
  reviewed and accepted before the engine arrives.

## 2. What exists today, and what the spike showed

### 2.1 The code (at `aa0702c8`)

**P1. Names are the only identity.**
- The protocol addresses nodes by name. Rename (`renameNode`) is atomic and
  unique, but a name changes, and Duplicate, Undo and the palette all make
  new names.
- No node carries an id: there's no `objectId` anywhere in the code.
- `SOMDocument.allNodes` (L680) lists every node; there's no index other
  than by name.

**P2. Every client add path builds its own descriptor** (`apps/client/src/app.js`):

| Path | Line | What it is |
|---|---|---|
| Palette add | L2294 | `buildPrimitiveDescriptor` |
| A palette add's one retry | L2480 | `{ ...request.descriptor, name }`, a new name for the same request |
| Duplicate | L2319 | `checkDuplicate` → `prepareDuplicate` (`edit-duplicate.js` L270); `buildDescriptor` copies the node's extras with `structuredClone` |
| Undo and redo re-adds | L1578 | `request.descriptor`, from `prepareRestore` (`edit-duplicate.js` L291): the node exactly as it was, extras included |
| Model form | L3075 | `addNode` dep |
| Teleporter form | L3115 | `addNode` dep |
| Library | L3238 | `addNode` dep |

- Duplicate's client-side rule `atriumProblem` (`edit-duplicate.js` L74)
  checks `extras.atrium` the way the server would. It knows `teleporter` and
  `model`, and since 4a `animation`.

**P3. The server's add handler** (`session.js`, from L770):
- **Avatar adds may not carry any `extras.atrium`** (K4/L5, L796–801). So an
  avatar can never claim an `objectId`.
- **Non-avatar adds:** the mutation gate, then the parent and name rules,
  then `checkAtriumExtras` (`send-policy.js` L159).
- **An `add` carries one node,** with no children (`add.client.json`,
  `additionalProperties: false`). A uniqueness check only ever sees one new
  node.

**P4. Node extras are writable only through an allowlist** (`send-policy.js`
`authorizeNodeSend`, L688): `TELEPORTER_LEAF` (L721) and, since 4a,
`ANIMATION_LEAF` (L729). `SOMDocument.CREATABLE_PATHS` (L30) is
`['extras.atrium.animation']`. The step 4 pre-brief planned that 4b's
set-once `objectId` leaf joins it (Z2).

**P5. Who may edit** (`session.js`):
- `isMutator` (L433): under the owner policy, `session.userId ===
  worldOwnerUserId`. A read-only policy (the degraded commons) refuses
  everyone.
- `canEdit` is computed once, at `hello` (L539–557): signed in, the world's
  owner, and a mutator.
- **Sessions are a `Map` in hello order** (L533). `cleanupSession` (L387)
  removes one on disconnect.
- **A duplicate live session id is refused** (`SESSION_CONFLICT`, L487), so
  a session is never replaced while connected. The role can only move on
  disconnect today (design §5.2).

**P6. The protocol is strict.**
- `hello.server.json` has `additionalProperties: false` (L35). A new
  `scriptHost` or `hostGen` field needs a schema change.
- The client ignores unknown message types: `AtriumClient`'s dispatch
  switch (L688–710) has no `default`. A `script-host` message therefore
  needs a case.
- `canEdit` is a client field (L185), reset on every disconnect path.

**P7. One world, one session set.** Each world host calls
`attachSessionHandlers` with its own `sessions` map and
`worldOwnerUserId`. A host role is per world, and two worlds on one server
have independent hosts.

### 2.2 The D2 spike (*probe*, 2026-10-23)
**Set-up:**
- `@khronosgroup/gltf-interactivity-engine` 1.1.0 from npm: one ES module
  of 353,583 bytes, importing only `gl-matrix` (3.4.4, ESM 186,002 bytes),
  in Node 22.
- Khronos's `glTF-Test-Assets-Interactivity` at `926bec45`: 160 test
  files, 1,142 sub-tests and 187 invalid-graph cases.
- A host written for the spike:
  - an `IEventBus` of its own on `EventTarget` (the engine's `DOMEventBus`
    needs `document`);
  - an `ADecorator` subclass over a small world of nodes, registering
    `/nodes/{i}/translation`, `rotation`, `scale` and
    `extensions/KHR_node_visibility/visible`;
  - every tick driven by hand (`executeEventQueueTick`), never by the
    engine's own `setTimeout` loop.
- **The spike ran in Node, not in a browser.** Loading the engine through
  the import map, in a page, is 4b-2's first step.

**S1. Bounded execution: passes, with two adapter measures.**
- **A step budget works through `processNodeStarted`.** The hook throws
  past N steps, and the adapter's tick wrapper catches it. The next tick
  runs normally.
  - Results at N = 10,000:
    - `while(true)` with a body: stopped in 8 ms;
    - `for 0..1e9` with a body: 12 ms;
    - an `onTick` with a `for 0..1e6` each frame: 13 ms per frame, stopped
      each frame.
  - **The hook must be set on the engine itself** (`engine.processNodeStarted
    = …`). `ADecorator.bridgeEngineHooks` doesn't carry it over, and with
    only the decorator's hook the count stayed 0.
- **But a loop with no body never calls the hook.** `flow/while(true)` with
  no `loopBody` hung the process until it was killed at 10 s, and so does
  `for 0..1e9` with no body. A page would freeze.
  - **The fix, also probed:** subclass the registry's own `flow/while` and
    `flow/for` classes so that each re-evaluation of the condition or
    `endIndex` (`evaluateRequiredValues`, `evaluateAllValues`) counts as a
    step. No loop logic is copied, and `Class.init` is kept. Both stopped at
    10,001 steps in 6–7 ms, and a normal `for 0..5` still completes.
- **A flow cycle** (sequence → set → sequence) ends in `RangeError: Maximum
  call stack size exceeded` at about 4,000 steps. That's caught too, but
  depends on the stack size. A load-time cycle check in the adapter is
  cleaner.
- **An `onTick` behaviour over budget fails every frame.** The adapter must
  disable the behaviour after an overrun, not retry it each frame.
- **Value evaluation is finite:** `validateGraph` requires every value
  reference to point at an earlier node, so values form a DAG.

**S2. Cleanup: passes only if the adapter owns the lifetime.**
- `dispose()` cancels pending `flow/setDelay` timers (1 → 0), and nothing
  fires afterwards.
- **`loadBehaveGraph` on a live engine doesn't.** The old delay's timer
  stayed live after another graph was loaded. Its callback queues by node
  index, so it could act on the new graph.
- **A running `pointer/interpolate` keeps writing after `dispose()` and
  after a reload.** Its callbacks live on the event bus, which `dispose()`
  doesn't clear.
- **One tick can schedule 5,000 delays** (a `for` around a `setDelay`). All
  were cleared by `dispose()`, but nothing caps them.
- **So the adapter must:**
  - make a fresh engine for every load;
  - never tick an engine after `dispose()`;
  - clear its own bus's interpolation maps;
  - cap pending delays itself.
- **`flow/setDelay` uses the real `setTimeout` and `performance.now()`.**
  Tests need those injected.

**S3. Pointer authorization: passes through the adapter's setters.**
- **A setter that refuses (records and returns) blocks the write** for:
  - a literal path (`/nodes/2/translation`);
  - an index template (`/nodes/{n}/translation` with `n = 2`);
  - `pointer/interpolate`, which is refused on every frame.

  Writes to the behaviour's own node and its child applied.
- **A refused `pointer/set` continues on `out`, not `err`:** the graph can't
  tell. The owner has to hear about it from the adapter's log.
- **An index past the registered bound and an unregistered pointer take
  `err`.** The pointer trie bounds indices by the highest one registered.
- **A setter that throws aborts the whole tick.** Refusing and logging is
  the better design.

**S4. Rejection: passes.** All 187 invalid-graph cases were rejected: 46 by
`validateInteractivityExtension` and 141 by `loadBehaveGraph`
(`GraphRejectedError`). None was accepted.

**S5. Conformance with the minimal adapter: 141 of 156.**
- Core 26 of 40, math 115 of 116.
- **What failed:**
  - all six `animation/*` (the spike stubbed animations);
  - six `pointer/*` (pointers it didn't register: materials, cameras, morph
    targets, the read-only core set);
  - `ref/eq`, `Extras/Matrix_Updates` and `math/matDecomp-Shear`.
- Every failure but the last is the spike adapter's missing coverage, not
  the engine's.

**S6. Packaging.**
- `build/index.js` is plain ESM with one bare import (`gl-matrix`), so it
  vendors as two import-map entries and no build step. Apache-2.0 and MIT.
- **It touches the DOM only in `DOMEventBus`,** which Atrium won't use.
- The 1.1.0 changelog lists breaking interface changes against 1.0.0, so
  pin the version.

## 3. Decisions

### The whole of 4b (B1–B6)
- **B1 — Split 4b.**
  - **(a) Recommended: two rounds,** 4b-1 (identity and the script host)
    then 4b-2 (the runner and templates), each released before the next
    pre-brief is final (§1).
  - (b) One round, as the step 4 pre-brief's §9.1 sketched.

  (b) puts a protocol change, a vendored engine and a new panel section in
  one review. 4a's three rounds were for a much smaller change.
- **B2 — D2, the interpreter: confirm the Khronos engine.**
  - **(a) Recommended: confirm D2 (a),** vendoring
    `@khronosgroup/gltf-interactivity-engine` 1.1.0 and `gl-matrix` 3.4.4
    under `packages/` in 4b-2. The spike's four criteria pass with
    adapter-side measures (§2.2), and those measures become 4b-2's contract
    (§9.2).
    - **This is the operator's OK to vendor about 540 KB** of Apache-2.0 and
      MIT code, with `NOTICE` entries.
  - (b) Reconsider (c), a hand-written interpreter for the template subset.

  The spike found nothing (b) would avoid that the adapter can't handle.
- **B3 — Existing objects get ids lazily** (D6 as approved). 4b-1 provides
  the set-once leaf; 4b-2's form calls it the first time a behaviour names
  an object. Nothing writes ids into existing worlds by itself.
  - **(a) Recommended: as D6.**
  - (b) Assign ids to every node of a world the first time its owner enters
    Edit mode.

  (b) writes to worlds that may never use behaviours, which D6 rejected.
- **B4 — A duplicate id found in a loaded document.** Neither the first-party
  client nor the server can make one after 4b-1, but a hand-edited or
  imported document could.
  - **(a) Recommended: heal on load,** as `healDocumentOnLoad` does for
    other faults. The first node in document order keeps the id; each later
    one loses its `objectId`, with one log line per id.
  - (b) Refuse to load the world.

  (b) locks the owner out of their own world over a fault that's simple to
  repair.
- **B5 — Where the uniqueness rule lives.**
  - **(a) Recommended: in the SOM,** as `SOMDocument.getNodeByObjectId(id)`,
    a scan of `allNodes`.
    - The server uses it for the `add` and set-once checks.
    - 4b-2's runner uses the same call to resolve an id to a name.
    - One implementation for every side, and no index to keep in step. A
      world has hundreds of nodes, not millions.
  - (b) A maintained index (`Map`), updated at load, ingest, dispose and on
    the set-once leaf.

  (b) is faster but has five update points to get right. It can replace (a)
  later behind the same call.
- **B6 — What 4b-2 decides, not 4b-1.** These are recorded so the 4b-1
  review doesn't reopen them:
  - D5's conflict rule (behaviours and the object being edited);
  - D4's "behaviour changes are saved" in practice;
  - the five templates' exact graphs;
  - the resource limit values;
  - the target picker;
  - the graph-to-animation mapping.

### 4b-1 (E-L1–E-L6)
- **E-L1 — The id's form.**
  - **(a) Recommended: a lowercase RFC 4122 version-4 UUID,**
    `crypto.randomUUID()`, checked by
    `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`.
  - (b) Any string of 1–64 characters.

  (a) is what design §4.9 says, it's checkable, and it collides only by
  forgery, which the uniqueness check refuses anyway.
- **E-L2 — Which adds get a new id.** Recommended:
  - **every new object:** the palette (its retry keeps the first attempt's
    id), the Model form, the teleporter form, the library and Duplicate;
  - **Duplicate always replaces the copied id with a new one** (D6);
  - **Undo and redo keep the id:** they bring back the *same* object, so a
    behaviour that names it keeps working (P2's `prepareRestore` already
    copies extras exactly).
- **E-L3 — The set-once leaf.**
  - **(a) Recommended:** `send` of `extras.atrium.objectId` on a node that
    has none. The value must pass E-L1 and be unique.
    - A node that already has an id refuses any `send` of the leaf, the same
      value included.
    - `null` is refused.
    - It joins `CREATABLE_PATHS`.
  - (b) No leaf: ids only on `add`. An existing object would then need a
    remove and re-add, which loses its undo history.
- **E-L4 — Who is the script host.**
  - **(a) Recommended: the earliest-connected session that passed `canEdit`
    at its `hello`,** as design §5.2.
    - It gets `scriptHost: true` and `hostGen`.
    - Every other session gets `scriptHost: false` and no `hostGen`.
    - When the host disconnects, the earliest remaining `canEdit` session
      gets `{ type: 'script-host', active: true, hostGen: n + 1 }`.
    - With none left there's no host until an eligible `hello`, which then
      takes `hostGen + 1`.
    - `hostGen` starts at 1 per world host and isn't saved: a server restart
      starts again at 1, because every session reconnects.
  - (b) The most recent owner session.

  (b) moves the role on every new tab, the churn design §5.2 avoids.
- **E-L5 — Revocation in 4b-1.**
  - **(a) Recommended:** the message shape is defined and the client obeys
    `active: false` at once, but **the server has no code path that sends
    it**, because the role only moves on disconnect (P5).
  - The client half is tested with a fake socket. A server-side revoke
    comes with a reason to move the role (design §5.2 follow-up review A).
- **E-L6 — What the owner sees in 4b-1.**
  - **(a) Recommended: one status line in the Edit panel,** under the title,
    for an owner:
    - "Behaviours run in this tab" when this session is the host;
    - "Behaviours run in another tab or device" for any other owner session
      (E8 says why it can't be more exact);
    - nothing for a visitor or while disconnected.
  - (b) Nothing.

  (a) gives DEV acceptance something to see, and 4b-2 needs the line anyway.

## 4. The contract (4b-1)

### E1. One id rule, two implementations
- **`objectIdProblem(value)`** returns a reason code or null:
  - `object-id-type`: not a string;
  - `object-id-form`: not E-L1's lowercase UUID v4.
- **Where:**
  - the client's copy in `packages/client/src/object-id.js` (new,
    renderer-neutral), with **`newObjectId()`** (`crypto.randomUUID()`,
    injectable for tests);
  - the server's copy in `send-policy.js`.
- **Both read `tests/fixtures/object-id-vectors.json`** (the
  `model-spec-vectors.json` pattern): accepted and refused values with
  their codes. It includes:
  - an uppercase UUID (refused);
  - a v1 UUID (refused);
  - `''`;
  - a 37-character string;
  - a valid id with a trailing newline (refused).
- **`packages/client/package.json`** exports `./object-id`. **The import
  map** in `apps/client/index.html` gets `@atrium/client/object-id`, and so
  does `tools/som-inspector/index.html` only if anything it loads imports
  it. `importmap-guard` stays green.

### E2. The SOM: lookup, and a second creatable path
In `packages/som/src/SOMDocument.js`:
- **`getNodeByObjectId(id)`** returns the first node in `allNodes` order
  whose own `extras.atrium.objectId === id`, or null (B5 (a)).
  - Externally loaded nodes are skipped. They aren't saved world content,
    and never carry ids.
  - **Plain-object checks only,** as `CREATABLE_PATHS` uses: an `extras` or
    `atrium` that isn't a plain object, or an inherited `objectId`, never
    matches.
- **`CREATABLE_PATHS = ['extras.atrium.animation', 'extras.atrium.objectId']`.**
  The existing own-property rule is unchanged (4a Z2).

### E3. The server
- **`add`** (non-avatar; avatars already refuse any `extras.atrium`, P3):
  `checkAtriumExtras` also checks `atrium.objectId` when the key is present.
  - The value must pass E1, or `INVALID_VALUE` with E1's message.
  - **`world.som.getNodeByObjectId(id)` must be null,** or `INVALID_VALUE`
    with "objectId is already in use in this world".
  - The order: after the name rules, before any change to the world.
  - **No id is required:** an `add` without one is accepted as today, for
    old clients, tools and the SOM Inspector.
- **`send` of `extras.atrium.objectId`** in `authorizeNodeSend` (E-L3):
  - the node must not already have an own `objectId`, or `INVALID_FIELD`
    with "objectId is already set";
  - the value must pass E1 (`INVALID_VALUE`) and be unique (`INVALID_VALUE`,
    the same message as `add`);
  - the owner gate, live-avatar refusal, external-node refusal and
    everything else as for any `send`.
  - No stamping, no `null`.
- **`remove`, `rename` and every other field are unchanged.** A removed
  node's id is free again, because nothing indexes it (B5 (a)).
- **Load (B4 (a)), in both world kinds:** document worlds already run
  `healDocumentOnLoad` (`world.js` L439, in `createWorldFromDocument`), and
  file worlds (`createWorld`, L287) don't. The id step is one function
  called from both. It walks the document's nodes in order. Every `objectId` seen
  before keeps the first node's claim and is removed from each later node,
  with `[world] healed duplicate objectId <id> on "<name>"` logged once per
  node.
  - **An id that fails E1 is also removed on load,** with its own log line.
    A malformed id can't be repaired, only dropped, and a later set-once
    `send` can assign a fresh one.

### E4. The script host (server, `session.js`)
- **State per world host:** `scriptHost = { sessionId: null, hostGen: 0 }`.
- **At `hello`:** after `canEdit` is computed, if `canEdit` is true and
  `scriptHost.sessionId` is null, then `hostGen += 1`, `sessionId =
  session.id`, and the `hello` carries `scriptHost: true` and `hostGen`.
  Every other `hello` carries `scriptHost: false` and no `hostGen`.
  - **Eligibility is recorded on the session** (`session.canEdit`), so
    handover doesn't recompute it.
- **On `cleanupSession` of the host:**
  1. the role is cleared;
  2. the server picks the first session in `sessions` order with
     `session.canEdit` true and an open socket;
  3. it sets the role and `hostGen += 1`;
  4. it sends that session `{ type: 'script-host', active: true, hostGen }`.

  With none, `sessionId` stays null.
  - **The handover happens after the departed session is removed,** so
    the departing session can never be chosen.
  - **It also happens when a session is cleaned up by eviction**
    (`evictNonOwners`) or a keepalive failure, since every path goes
    through `cleanupSession`.
- **A reconnecting former host** is a new session with a new `hello`. It
  doesn't take the role while another session holds it.
- **Nothing else changes:** the mutation gate, `canEdit`, and every message
  that isn't `hello`. `activate` is 4c's.

### E5. The protocol (`@atrium/protocol`)
- **`hello.server.json`** gains:
  - `scriptHost`: boolean;
  - `hostGen`: integer, minimum 1;
  - a rule that `hostGen` is present only when `scriptHost` is true
    (`if`/`then`, or `dependentRequired` and a `not`, as the validator
    supports).
- **New `script-host.server.json`:**
  - `{ type: 'script-host', active: boolean, hostGen: integer ≥ 1 }`;
  - all three required, `additionalProperties: false`;
  - registered with the server-side message set.
- **Schema tests:** valid and invalid examples for both. This is the
  round's protocol change. Nothing else in the protocol changes.

### E6. The client (`AtriumClient`)
- **`client.scriptHost`** is `{ active: boolean, hostGen: number | null }`:
  - set from `hello` (`active: msg.scriptHost === true`, `hostGen:
    msg.hostGen ?? null`);
  - **reset to `{ active: false, hostGen: null }`** on every path that
    resets `canEdit` (connecting, disconnected, a connect timeout, a
    superseded connection).
- **`script-host` messages:**
  - a new dispatch case, `this._onScriptHost(msg, record)`. It ignores a
    stale or closing record and a malformed message (not a boolean
    `active`, not an integer `hostGen`);
  - **it ignores a `hostGen` lower than the current one** (a late message
    from an earlier assignment);
  - otherwise it sets `scriptHost` and emits **`script-host:changed`** with
    `{ active, hostGen }`.
- **`hello` also emits `script-host:changed`,** after `canEdit` is set, so
  one listener covers both.
- **The client never decides the role itself.**

### E7. Ids on the client's add paths (`apps/client`)
- **One helper,** `withNewObjectId(descriptor, newId = newObjectId)` in a
  new pure module `apps/client/src/object-identity.js`. It returns a copy
  of the descriptor whose `extras.atrium.objectId` is a new id, creating
  `extras` and `atrium` if needed. Every other key is kept as it is.
- **Where it's used (E-L2):**
  - the palette add (L2294);
  - the Model form's, the teleporter form's and the library's `addNode`
    deps (L3075, L3115, L3238);
  - **Duplicate:** `prepareDuplicate` (`edit-duplicate.js` L270) applies
    it to the built descriptor, so the copy never carries the original's
    id. `prepareRestore` doesn't.
- **Not used:**
  - the palette retry (L2480): it reuses `request.descriptor`, so it keeps
    the first attempt's id;
  - Undo and redo re-adds (L1578): they bring back the same object.
- **Duplicate's rule** (`atriumProblem`, L74) also checks an existing
  `objectId` against E1, and refuses with "its object id is malformed"
  rather than send a value the server would refuse.
  - Unique-in-world isn't checked there. The copy gets a new id anyway, and
    the original's id is the original's.
- **`MAX_ADD_BYTES`** still applies. An id adds about 56 bytes.

### E8. The Edit panel's host line (E-L6)
- **`#ep-host-status`**, a status line under the Edit panel's title, written
  only by `refreshHostStatus()` in `app.js`.
  - It's called on `script-host:changed`, on `connecting`, on
    `disconnected` and when Edit mode turns on.
  - Its text comes from a pure helper (`hostStatusText({ canEdit,
    scriptHost, otherOwnerTabs })`), tested without a DOM.
- **"Behaviours run in your other tab" needs to know another host exists.**
  4b-1 doesn't tell non-hosts who the host is.
  - **The text for a non-host owner is "Behaviours run in another tab or
    device"** when `canEdit` is true and `scriptHost.active` is false.
  - **This includes the moment there's no host at all,** which an owner tab
    can only be in while another owner session has just left and the
    handover is under way.
  - It's accurate enough for Phase 3, and needs no new message.
- **Visitors see nothing:** the panel is the owner's.

### E9. What doesn't change
- Names stay the protocol's identifiers. Every message still addresses
  nodes by name.
- The undo engine, the structure tracker and every rule of Duplicate except
  the new id.
- The model, teleporter, animation and sky leaves.
- The SOM Inspector and the playground, apart from an import-map entry if
  E1's guard needs it.

## 5. Tests

| Item | Tests | Proof of failure |
|---|---|---|
| E1 | The vectors file read by both the server and the client tests: every accepted and refused case with its code. `newObjectId()` returns values that pass, 100 distinct | (a) accept uppercase in one copy only |
| E2 | som: `getNodeByObjectId` finds a node, returns null for an unknown id, skips an external node, never matches an inherited `objectId` or a non-plain `atrium`; `setPath` creates `extras.atrium.objectId` when missing and still refuses `extras.atrium.other` | (b) match by `in` instead of an own property |
| E3 | server, port 0: an owner `add` with a valid new id is accepted and broadcast with it; with a malformed id, `INVALID_VALUE`; with an id already in the world, `INVALID_VALUE` and the "in use" message, and nothing added; without an id, accepted. Set-once `send`: accepted on a node without an id and broadcast; refused `INVALID_FIELD` on a node with one (including the same value); refused for a duplicate or malformed value; refused for a visitor; refused on an avatar. After a `remove`, the id can be used again. **Load:** a document with one id on two nodes loads, keeps it on the first and logs once; a malformed id is dropped and logged; the healed document saves without the dropped ids | (c) skip the uniqueness check on `add`; (c2) allow the leaf when the node already has one |
| E4 | server, port 0, two and three owner sessions plus a visitor: the first owner `hello` has `scriptHost: true, hostGen: 1`; the second owner's and the visitor's have `scriptHost: false` and no `hostGen`. **Handover:** closing the host sends the second owner `script-host` `active: true, hostGen: 2`, and nothing to the visitor. **The former host reconnects:** its new `hello` has `scriptHost: false` while the second holds the role. **No eligible session:** closing the last owner leaves no host, and the next owner `hello` gets `hostGen` 3. **Read-only policy:** no session is ever host. **Two worlds:** each has its own host and its own `hostGen` | (d) hand over to the first session in the map without the `canEdit` check (the visitor gets it); (d2) keep `hostGen` unchanged on handover |
| E5 | protocol: valid and invalid `hello` (with `hostGen` and without; `hostGen` with `scriptHost: false` refused) and `script-host` (each field missing, wrong type, extra field) | (e) drop `additionalProperties: false` from `script-host` |
| E6 | client, fake socket: `scriptHost` from `hello`; `script-host:changed` on `hello` and on a `script-host` message; a lower `hostGen` ignored; a malformed message ignored; `active: false` honoured; reset on disconnect, on a connect timeout and on a superseded connection; a stale record's message ignored | (f) accept a lower `hostGen` |
| E7 | `object-identity`: `withNewObjectId` adds an id without touching other keys, replaces an existing one, and doesn't mutate its input. `edit-duplicate`: `prepareDuplicate` gives a new id; `prepareRestore` keeps the node's id; a malformed id refuses with the new message. Wiring guard (`app.js`): the palette, Model form, teleporter form and library paths pass through `withNewObjectId`; the retry and the structural re-add don't | (g) `prepareDuplicate` keeps the original's id; (g2) the structural re-add gets a new id |
| E8 | `hostStatusText`: host, non-host owner, visitor, disconnected. Wiring guard: `refreshHostStatus` is called on `script-host:changed`, `connecting`, `disconnected` and Edit on | (h) show the host text to a non-host |

**Proofs:** commit first; break the file, run, record the failing test
names, restore the file **from a saved copy, never with `git checkout`**,
re-run green. "Not reproducible" is not an acceptable result.

### 5.1 Claude's browser checks (after publish, before DEV acceptance)
In the local harness (`devtasks/harness/`):
1. **New objects get ids:** palette, Model form (`Fox.glb`), teleporter and
   library. Each new node has a valid, distinct `extras.atrium.objectId` in
   the client's SOM and on the server.
2. **Duplicate gets a new id; Undo of a delete keeps it;** redo of an
   undone add keeps it. Repeat after a page reload (the 4a lesson).
3. **The set-once leaf:** a raw `send` on a node without an id is accepted;
   a second is refused with the server's message.
4. **Two owner tabs:** the first shows "Behaviours run in this tab", the
   second "Behaviours run in another tab or device". Close the first: the
   second switches at once. Reopen the first: it shows the other-tab text.
5. **A visitor** sees no host line, and its `hello` has `scriptHost: false`.
6. **Saved:** restart the world server from its saved document. The ids are
   unchanged.
7. **Load healing:** a world document with a duplicated id loads, keeps the
   first, and logs once.
8. **Regression:** §5.1 of scripting-4a (its checks 1–10 and round 2's and
   round 3's), library-sky's and edit-polish-3's.

## 6. DEV acceptance (operator, Firefox, hard reload, owner)
1. **Place a cube, a library model and a teleporter.** In the browser
   console, `atriumClient.som.getNodeByName('<name>').extras.atrium.objectId`
   shows an id for each, all different.
2. **Duplicate the cube:** the copy has a different id. **Delete the copy,
   Undo:** the same id as before the delete.
3. **Open the world in a second tab, signed in:**
   - the first tab's Edit panel says "Behaviours run in this tab";
   - the second says "…in another tab or device";
   - close the first tab, and the second changes to "…in this tab".
4. **A private window, as a visitor:** no host line.
5. **Reload:** the ids are unchanged, and an animated model (4a) still plays.

## 7. Worker rules and release path
As scripting-4a (`devtasks/KICKOFF-scripting-4a.md`), with this round's
specifics:
- **Steps, one commit each:**
  1. E1 and the vectors file, E2 (the SOM) and E3 (the server's id rules
     and load healing);
  2. E4 and E5: the script host and the schemas;
  3. E6: the client's role state;
  4. E7 and E8: the add paths, Duplicate and the panel line;
  5. full suites, proofs (a)–(h) with (c2), (d2) and (g2), and the handoff.
- **`--max-runtime 3h`.**
- **A protocol and server round:** DEV restarts at the deploy.
- **The front door, the kickoff and the release chain:** the scripting-4a
  passdown's §4.4–§4.5 rules:
  - build the whole chain at the review gate's APPROVE;
  - **nothing is pushed to `main` between the release merge and the MAIN
    push.**

## 8. Notes for the brief author
- **E4's handover runs inside `cleanupSession`, after `sessions.delete`,
  inside its `if (removed)` block.** Read the function whole:
  - it's called from the close handler (L1001) and from the keepalive sweep
    (L1018), which terminates a socket whose close handler then calls it
    again;
  - only the first call finds the session in `presence`;
  - so a handover placed inside that block runs once per departure.
- **E3's uniqueness check reads the world as it is at the moment of the
  `add`.** Two `add`s with the same id in flight are serialized by the
  server's single message loop: the second sees the first.
- **E7 touches the forms through their `addNode` deps, not their modules,**
  so the forms' own tests don't change.
- **The SOM Inspector** places objects through its own code. Without an id
  that's still accepted (E3). Note it for 4b-2.

## 9. The next round (a sketch for its own pre-brief)

### 9.1 4b-2 — behaviours, owner-present
- **Storage:** `extras.atrium.behavior` as design §5.4 (`kind: 'graph'`,
  `graph`, `nodeMap`, `targets`, `enabled`, `origin`).
  - A writable leaf, with a strict server check:
    - a byte limit;
    - an op allowlist for 4b's templates;
    - `nodeMap` and `targets` entries that are E1 ids existing in the
      world;
    - `validateInteractivityGraph` (the engine runs in Node, S6).
  - A behaviour node also needs an `objectId` (E-L3's leaf).
- **The runner,** only in the session whose `scriptHost.active` is true.
  It starts on `script-host:changed` and stops at once on `active: false`
  or a disconnect. Visitors never run it.
- **The script API (design §5.3) as far as the templates need it:**
  - pointer get and set through `nodeMap`;
  - play and stop writing 4a's leaf;
  - `select`, `enter`, `exit` and `frame`;
  - delays;
  - `log`;
  - **writes coalesced per field, at most 20 sends per second per world.**
- **Templates (D3, as standard graphs):** the five in §1's table. The form
  sets `targets` with a target picker.
- **D5's rule and D4's in practice;** the 4a items in the 4a passdown §6.1;
  the "refused write continues on `out`" consequence (S3) surfaced in the
  owner's log.

### 9.2 The adapter, as the spike supports it
- **One engine per behaviour per load.** A change, a disable, a world reset
  or losing the host role disposes it and drops it; it's never ticked again
  (S2).
- **Atrium's own event bus,** with its interpolation maps cleared on
  dispose (S2).
- **Ticks driven from the frame loop,** at most one per rendered frame
  (design §5.3), never the engine's own timer. The engine's `setTimeout` and
  `performance.now()` are injected in tests (S2).
- **A step budget per tick:**
  - `processNodeStarted` set on the engine itself;
  - plus budgeted `flow/while` and `flow/for` subclasses;
  - plus a load-time flow-cycle check;
  - a behaviour that overruns is disabled with a logged reason (S1).
- **A cap on pending delays per behaviour** (S2).
- **Pointers registered only for `nodeMap` indices,** so anything else
  takes `err`. Each setter checks that the object is the behaviour's own
  subtree or in `targets`, and refuses with a log line, never a throw (S3).
- **`validateInteractivityExtension` / `loadBehaveGraph` rejection** is
  shown to the owner (S4).
- **The Khronos test assets,** restricted to the subset the adapter
  supports, as a conformance test (S5).

## 10. Review log
- **Rev 0** (2026-10-23): drafted by Claude from the design, the step 4
  pre-brief, the 4a passdown, code reading at `aa0702c8`, and the D2 spike
  (§2.2). Open: B1–B6 and E-L1–E-L6.
