# Pre-brief: Phase 3 step 4b — behaviours, owner-present: the plan (4b-1, 4b-2), the engine spike, and 4b-1 (identity and the script host) in detail

Status: **FINAL, Revision 2.1 (2026-10-24). Decisions B1–B6 and E-L1–E-L6
approved by the operator (2026-10-24 01:48 PT), all as recommended in Rev
2:**
- B1 (a): 4b is two rounds, 4b-1 then 4b-2;
- **B2 (a): the Khronos engine is confirmed as the choice,** with the OK to
  vendor it and `gl-matrix` in 4b-2 under N5's terms. Its production safety
  is 4b-2's acceptance gates (§9.2);
- B3 (a), B4 (a) as revised in Rev 1, B5 (a) as revised in Rev 1 and Rev 2,
  and B6 as listed;
- E-L1 (a), E-L2 as proposed, E-L3 (a), E-L4 (a), E-L5 (a) and E-L6 (a).
- **Rev 2.1 changes only this status line** (as 4a's Rev 1.2 did).
- **Rev 2 applies a second outside review, of Rev 1** ("not FINAL as Rev 1,
  but close"; no must-fix, 5 should-fix, 8 nits). Claude checked each code
  claim. All are taken.
  - **The reviewer's verdict:** with these applied, Rev 2 "can go FINAL
    without a further review round". Every recommendation stands.
  - **Changed in the contract:**
    - the sender's own echo of the id leaf is applied (E6);
    - the duplicate-id message no longer triggers the palette retry (E3);
    - the resolver also checks `getObjectByName` (E2);
    - the handover is keyed on the identity check (E4);
    - the identity-cleanup test uses a fake socket server (§5).
- **Rev 1 applied an outside review of Rev 0** (verdict: "revise before
  implementation"; 4 must-fix, 7 should-fix, 5 nits). Claude checked each
  finding against the code; M1 was also probed. All are taken. §10 lists
  them.
  - **The split (B1) and the engine (B2) stand.** The reviewer recommends
    (a) for all twelve decisions, several as modified here.
  - **Changed:**
    - B4 now drops a duplicated id from **every** node that shares it;
    - B5's lookup is split into a uniqueness check and a resolver, with
      external nodes excluded by identity;
    - E-L3's set-once leaf can create `extras.atrium`;
    - cleanup is identity-guarded;
    - the client signals loss of the role synchronously;
    - the host line's wording.
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
| **4b-1** | Nothing visible to visitors. Every new object gets a permanent id; the Edit panel tells an owner with two tabs which one is the script host | `objectId` rules on `add` and a set-once leaf; `hello.scriptHost` and `hostGen`; the `script-host` message with handover; schemas |
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
- **Avatar adds may not carry Atrium data** (K4/L5, L796–801; the check is
  `addCarriesAtriumExtras`, L113). The only `extras.atrium` an avatar may
  carry is the exact marker `{ ephemeral: true }`. So an avatar can never
  claim an `objectId`.
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
- **But `setPath` creates only the final key** (*probe*, review M1).
  `resolvePath` (L32) throws when an intermediate segment is missing.
  - On a node whose `extras` has no `atrium`:
    - `setPath(…, 'extras.atrium.animation', …)` fails with `Path segment
      "atrium" resolved to null/undefined`, even though that path is
      creatable;
    - so would an `objectId` leaf.
  - On a node with `extras.atrium = {}` or a model value, the animation
    leaf is created.
  - 4a never met this, because its leaf is allowed only on model nodes,
    which always carry `extras.atrium`. Most objects that would need a lazy
    id (B3) have no `extras.atrium` at all.

**P4b. External and shadowed nodes are in `allNodes`** (review M3).
- `allNodes` (L680) lists every node in the glTF document. That includes:
  - nodes copied in by `ingestExternalScene` (L930–945), whose extras are
    copied too (`node.setExtras(extras)`);
  - legacy nodes whose names are shadowed by an earlier node of the same
    name (K5: the first registered wins in `_nodesByName`).
- **The server tracks external nodes by identity** (`world.externalNodes`,
  `world.js` L335–341). The SOM itself has no such mark.
  - **Document worlds never ingest on the server** (`world.js` L446–461),
    but every client does (`AtriumClient` L1017). So the SOM mark matters
    most on the client.
- **Two name maps** (second review S-D):
  - `getNodeByName` reads `_nodesByName`;
  - `getObjectByName` reads `_objectsByName`. That's the map a `send`
    resolves through (`resolveSendTarget`, `send-policy.js` L582–585;
    `world.setField`).
  - They can disagree. `_takeOverName` (L386–402) moves a name in
    `_nodesByName`, but fills `_objectsByName` only where that slot is
    free. So a node can be the addressable node for its name while a mesh,
    material, animation or camera owns that name for `send`.

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
- **But cleanup isn't identity-safe** (review M2).
  - `cleanupSession` deletes `sessions` and `presence` entries **by id**.
  - The keepalive sweep (L1018) terminates a socket and cleans up at once.
    The socket's close handler (L1001) then cleans up the same session
    object again.
  - If a new connection took the same session id in between, the late
    second call deletes the *new* session's entries.
  - The first-party client never reuses an id: it makes a new UUID on every
    `connect`. But ids are client-chosen, and peers learn each other's ids
    from `join`.

**P6. The protocol is strict.**
- `hello.server.json` has `additionalProperties: false` (L35). A new
  `scriptHost` or `hostGen` field needs a schema change.
- The client ignores unknown message types: `AtriumClient`'s dispatch
  switch (L688–710) has no `default`. A `script-host` message therefore
  needs a case.
- `canEdit` is a client field (L185), reset on every disconnect path.
- **A superseded connection emits no `disconnected`** (review M4).
  - `connect()` while connected (L541) marks the old record stale, closes
    its socket and emits `connecting` (L609), but never `disconnected` for
    the old record.
  - **`disconnect()` defers its `disconnected` to a `setTimeout`,** and
    skips it entirely when a newer connection exists by then (L852–859).
    That's the stronger case: a disconnect followed at once by a connect
    never emits it (second review N8).
  - Listeners that stop work only on `disconnected` keep running.
- **The protocol is a tested contract, not a runtime guard** (second review
  N3).
  - The server doesn't validate its outgoing `hello` (L547–559). It
    validates only `join`, `leave` and `view`, and `world-done` has no
    schema at all.
  - The validator is `new Ajv({ strict: false })` (`protocol` `index.js`
    L24), which silently ignores a misspelled keyword. So a schema rule
    counts only if a test proves it refuses something.
- **The sender's own echo re-applies only two fields** (second review S-A).
  `_resolveOwnSetEcho` (L1307–1339) applies `name` and, since 4a,
  `extras.atrium.animation` from the broadcast. For every other field the
  echo only resolves the pending edit. A `send` of a new leaf therefore
  reaches the server and every *other* client, but not the sender's own
  SOM, unless the leaf gets its own echo case.
- **The palette's one retry matches its message by text** (second review
  S-B). `app.js` L2459–2463 retries a refused palette add once when the
  message matches `/already in use/`, which is the SOM's name collision
  (`name "X" is already in use`, `SOMDocument.js` L321).

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
- **Most failures look like the spike adapter's missing coverage,** but
  that's provisional (review N4). It holds until each case is reproduced
  with a fuller adapter in 4b-2.

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
      MIT code (review N5):
      - both packages' license texts kept beside the files, with `NOTICE`
        entries;
      - the versions pinned;
      - the sha256 of each vendored file recorded, so an update is
        auditable.
    - **It confirms the engine *choice*, not production safety** (review
      §2). The spike validated an integration approach, not Atrium's
      adapter. 4b-2's acceptance gates (§9.2) are what show the real
      adapter is safe on the browser's main thread.
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
  - **(a) Recommended (Rev 1, review S1): heal on load by dropping the id
    from *every* node that shares it,** with one log line per id giving the
    node count.
    - **No node keeps a duplicated id,** so nothing can silently become
      "the" object a reference meant.
    - A behaviour (4b-2) that named that id finds no object. It's disabled
      and reported, never retargeted.
    - The owner re-picks its target, and the set-once leaf gives each node
      a fresh id.
  - (b) Rev 0's rule: the first node in document order keeps the id.
  - (c) Refuse to load the world.

  (b) can redirect a saved behaviour's writes to an object its author never
  chose, and the healed document is saved, so the evidence is lost. (c)
  locks the owner out of their own world. (a) turns an ambiguity into a
  visible, recoverable break.
- **B5 — Where the identity rules live.**
  - **(a) Recommended (Rev 1, review M3): in the SOM, as two scans with two
    different jobs** (E2):
    - **`objectIdInUse(id)`, for uniqueness,** looks at every *saved* node,
      including shadowed duplicate-name nodes that a later rename or remove
      could make addressable;
    - **`resolveObjectId(id)`, for behaviours,** returns a node only when
      exactly one saved node has the id **and** that node is the one its
      name addresses. Otherwise it gives a reason (`not-found`,
      `ambiguous`, `unaddressable`).
    - **External nodes are excluded by identity:** the SOM records the
      nodes `ingestExternalScene` creates. A name prefix isn't used.
    - The server uses the first for `add` and the set-once leaf, and 4b-2's
      runner uses the second. One implementation for every side, with no
      index to keep in step. A world has hundreds of nodes, not millions.
  - (b) A maintained index (`Map`), updated at load, ingest, dispose and on
    the set-once leaf.

  (b) is faster but has five update points to get right. It can replace (a)
  later behind the same calls.
- **B6 — What 4b-2 decides, not 4b-1.** These are recorded so the 4b-1
  review doesn't reopen them:
  - D5's conflict rule (behaviours and the object being edited);
  - D4's "behaviour changes are saved" in practice;
  - the five templates' exact graphs;
  - the resource limit values;
  - the target picker;
  - the graph-to-animation mapping;
  - the review's carried items (§9.1): when the runner may start (S5),
    older clients holding the role (S6), and Duplicate remapping behaviour
    references (S7).

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
    - **It works on a node with no `extras.atrium`** (Rev 1, review M1). The
      SOM creates the `atrium` object for this one path, and generic path
      creation isn't widened (E2).
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
      starts again at 1, because every session reconnects. **It only ever
      increases:** a role is never reactivated under an old generation
      (review S2).
    - **Cleanup and handover are identity-safe** (review M2, E4). Only the
      session object that holds an id is ever removed under it, and the
      handover runs only after that exact session's removal.
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
    for an owner. Nothing runs in 4b-1, so it names the role, not behaviour
    (review N3):
    - "Script host: this tab" when this session is the host;
    - "Script host: another tab or device" for any other owner session (E8
      says why it can't be more exact);
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

### E2. The SOM: external nodes, two identity scans, and the set-once path
In `packages/som/src/SOMDocument.js`:
- **External nodes are recorded by identity** (review M3).
  - `ingestExternalScene`'s `copyNode` adds each node it creates to a
    private `WeakSet`.
  - **`isExternalNode(somNode)`** answers from that set, never from a name
    prefix.
  - The server's `world.externalNodes` is unchanged.
- **"A saved node"** is any node in `allNodes` that isn't external. That
  includes shadowed duplicate-name nodes (P4b).
- **A node's id** is its own `extras.atrium.objectId`, read with
  plain-object checks only. An `extras` or `atrium` that isn't a plain
  object, or an inherited `objectId`, gives no id.
- **`objectIdInUse(id)`** — true when any saved node has that id. Used for
  uniqueness (E3).
- **`resolveObjectId(id)`** returns `{ node }` or `{ problem }`:
  - `not-found`: no saved node has the id;
  - `ambiguous`: more than one saved node has it, which can happen only in
    a document loaded without E3's healing (a file opened by the SOM
    Inspector, say);
  - `unaddressable`: one saved node has it, but **either**
    `getNodeByName(node.name)` **or** `getObjectByName(node.name)` is
    something else. That's a shadowed name, or a mesh, material, animation
    or camera owning the name for `send` (P4b; second review S-D). A
    `send` addressed by that name would reach the other object.

  4b-1 has no caller. 4b-2's runner calls it every time it turns an id into
  a name to send, so a rename, remove or re-add is followed, and a stale or
  ambiguous mapping is refused.
- **`CREATABLE_PATHS = ['extras.atrium.animation', 'extras.atrium.objectId']`.**
  The 4a own-property rule is unchanged.
- **One narrow intermediate creation** (review M1). For exactly the path
  `extras.atrium.objectId`, when the node's `extras` is a plain object and
  has no own `atrium`, `setPath` first sets `extras.atrium = {}` on that
  same extras object, keeping every other key, then creates `objectId`.
  - **Refused:**
    - an `extras` that isn't a plain object;
    - an `atrium` that exists but isn't a plain object. **`atrium: null`
      counts as existing, and is refused** (second review N1), as
      `resolvePath`'s null check already does. Don't "fix" it into "absent".
  - **It must run before `resolvePath`,** which throws on the missing
    `atrium` before `setPath`'s creatable check is reached (L32–42,
    L993–1001).
  - **Every other path keeps today's rules,** `extras.atrium.animation`
    included. Generic path creation isn't widened.
  - The same SOM code runs on the server and in every client, so a
    broadcast `set` of the leaf applies everywhere.

### E3. The server
- **`add`** (non-avatar; avatars already refuse any `extras.atrium`, P3):
  `checkAtriumExtras` also checks `atrium.objectId` when the key is present.
  - The value must pass E1, or `INVALID_VALUE` with E1's message.
  - **`world.som.objectIdInUse(id)` must be false,** or `INVALID_VALUE`
    with **"objectId is already taken in this world"**.
    - Not "in use": the palette retries any refusal matching `/already in
      use/` (P6; second review S-B).
  - **Where:** `checkAtriumExtras` (pure) checks the form. **The `add`
    handler checks uniqueness,** because that needs the world: after
    `checkNewName` (`session.js` L819–823), before `world.addNode`.
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
  - **`authorizeSend` stays pure** (second review N2). It gets an
    `objectIdInUse` callback from the handler, the way it already gets
    `externalNames` and `avatarNames`.
- **`remove`, `rename` and every other field are unchanged.** A removed
  node's id is free again, because nothing indexes it (B5 (a)).
- **Load (B4 (a)), in both world kinds:** document worlds already run
  `healDocumentOnLoad` (`world.js` L439, in `createWorldFromDocument`), and
  file worlds (`createWorld`, L287) don't. The id step is one function
  called from both.
  - **It works on the glTF document, before the SOM is built,** as
    `healDocumentOnLoad` does (L265–285; second review N2).
  - So "saved node" there is simply every document node. External nodes
    are never in view: file worlds ingest them only later, in
    `resolveExternalReferences` (L308–333), and document worlds never do.
  - It counts each id over those nodes.
  - **Every id held by two or more nodes is removed from all of them**
    (B4 (a)).
  - **Log one line per id** (review N2): `[world] dropped duplicated
    objectId <id> from <n> nodes`. Names come from the document, so none
    are logged raw; when a name is logged, it's through `JSON.stringify`.
  - **An id that fails E1 is also removed on load,** with one line per
    node: `[world] dropped malformed objectId on node <index>`. A malformed
    id can't be repaired, only dropped, and a later set-once `send` can
    assign a fresh one.
  - **Nothing else is changed:** other `extras` keys stay, and an
    `extras.atrium` left empty stays as `{}`.

### E4. The script host (server, `session.js`)
- **State per world host:** `scriptHost = { sessionId: null, hostGen: 0 }`.
- **At `hello`:** after `canEdit` is computed, if `canEdit` is true and
  `scriptHost.sessionId` is null, then `hostGen += 1`, `sessionId =
  session.id`, and the `hello` carries `scriptHost: true` and `hostGen`.
  Every other `hello` carries `scriptHost: false` and no `hostGen`.
  - **Eligibility is recorded on the session** (`session.canEdit`), so
    handover doesn't recompute it.
- **`cleanupSession` becomes identity-safe** (review M2).
  - **It first checks `sessions.get(s.id) === s`.** Only then does it
    delete the `sessions` and `presence` entries and do the rest of its
    current work.
  - A second call for the same session object, or a call for an object an
    id no longer maps to, does nothing.
  - **This is a fix to existing behaviour,** and is tested on its own: a
    keepalive termination, a new connection that takes the same session
    id, then the first socket's late `close`. The new session must survive
    with its presence, avatar and role.
    - Today the late second call removes the new session's presence,
      broadcasts `remove` and `leave` under its id, and calls
      `onSessionRemoved` for it.
    - **`host.close()`** (`world-host.js` L75–91) clears `sessions` and then
      terminates the sockets. With the check, those late closes do nothing.
      Today they call `onSessionRemoved`, which is already a no-op once the
      world has no sessions (`world-registry.js` L486–501), so nothing
      regresses.
- **On `cleanupSession` of the host:**
  - **The handover is keyed on the identity check** (second review S-E).
    It runs when `sessions.get(s.id) === s` passed and that exact session
    has just been removed, never on whether `presence.remove` returned
    anything. Tying it to presence would couple the role to a second map
    that happens to be in step today.
  1. the role is cleared;
  2. the server picks the first session in `sessions` order with
     `session.canEdit` true, an open socket, and `missedPings` below the
     sweep's limit. A session the same keepalive sweep is about to
     terminate isn't chosen (second review N7);
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
- **`hello.server.json`** (review S2):
  - `scriptHost`, a boolean, is **required** in every server `hello`;
  - `hostGen`, an integer from 1 to 2^53 − 1;
  - **`scriptHost: true` requires `hostGen`, and `scriptHost: false`
    forbids it** (`if`/`then`/`else`, as the validator supports).
- **New `script-host.server.json`:**
  - `{ type: 'script-host', active: boolean, hostGen: integer 1 … 2^53 − 1 }`;
  - all three required, `additionalProperties: false`;
  - **registered as a `validators` entry under the key `'script-host'`**
    (the `som-dump` pattern), and added to `messageTypes` (second review
    N3).
- **Schema tests:** valid and invalid examples for both. This is the
  round's protocol change. Nothing else in the protocol changes.
  - **Proof (e2) is essential, not optional:** under `strict: false`, a
    misspelled `if`/`then`/`else` would be ignored silently (P6).

### E6. The client (`AtriumClient`)
- **`client.scriptHost`** is `{ active: boolean, hostGen: number | null }`,
  set from `hello`.
- **Every incoming role is checked with E5's rules** (review S2), in
  `hello` and in `script-host` alike:
  - `scriptHost`/`active` a boolean;
  - `hostGen` a safe integer ≥ 1 exactly when active;
  - absent when not active in `hello`.

  A `hello` that fails is treated as `active: false` and logged once.
- **`script-host` messages:** a new dispatch case,
  `this._onScriptHost(msg, record)`.
  - It ignores a stale or closing record (the existing `dispatch` guard,
    L680–681) and a malformed message.
  - **Per connection, generations only increase.** The high-water mark
    lives **on the connection record**, beside `pendingEdits` (second
    review N4), so a new connection starts from zero.
    - `active: true` is accepted only with a `hostGen` greater than any
      seen on this connection;
    - `active: false` only with a `hostGen` at least the current one.
    - Anything else is a late message from an earlier assignment, and is
      ignored.
  - Otherwise it sets `scriptHost` and emits **`script-host:changed`** with
    `{ active, hostGen }`.
- **`hello` also emits `script-host:changed`,** after `canEdit` is set, so
  one listener covers both.
- **Losing the role is signalled synchronously** (review M4). Whenever
  `scriptHost.active` is true and the connection that holds it is
  abandoned, the client sets `{ active: false, hostGen: null }` and emits
  `script-host:changed` **before** it does anything else on that path. The
  paths are:
  - `connect()` superseding the connection, before it emits `connecting`;
  - `disconnect()`, before it closes the socket;
  - a connect timeout;
  - the socket's close.
  - **The invariant:** once a connection is abandoned, nothing listening
    for the role still believes it holds it. That's 4b-2's guarantee that
    no runner of an old connection keeps ticking, scheduling or sending.
  - When the role wasn't active, these paths reset quietly, with no event.
  - **`canEdit` is reset together with the role,** before the event (second
    review N5). Otherwise a listener reading both in the same tick sees an
    owner without the role and computes the other-tab text.
- **The sender's own echo of `extras.atrium.objectId` is applied** (second
  review S-A).
  - `_resolveOwnSetEcho` gets a third case beside `name` and 4a's
    animation leaf. For a pending `send` of `extras.atrium.objectId`, it
    applies **the broadcast's `value`** with `setPath` inside
    `applyLocally`, then emits `som:set` for that field, then
    `edit:accepted`. That's 4a's Z2a pattern exactly.
  - A rejection or an unknown answer changes nothing.
  - **A client call, `client.setObjectId(name, id)`,** sends it, as
    `setModelAnimation` sends 4a's leaf. It tracks the edit with `type:
    'send'` and the field, and returns the seq.
  - 4b-1 has no UI caller. 4b-2's behaviour form is its first one.
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
  - Its text comes from a pure helper (`hostStatusText({ connected,
    canEdit, scriptHost })`), tested without a DOM.
- **A more exact text, such as "your other tab", would need to know another
  host exists,** and 4b-1 doesn't tell non-hosts who the host is.
  - **The host sees "Script host: this tab".**
  - **A non-host owner sees "Script host: another tab or device"** when
    `canEdit` is true and `scriptHost.active` is false.
  - **This includes the moment there's no host at all,** which an owner tab
    can only be in while another owner session has just left and the
    handover is under way.
  - **It also includes a dead predecessor** (second review N6). An owner
    whose only tab reconnects while the server still holds its old session
    sees "Script host: another tab or device" until the keepalive sweep
    drops the old session. That's up to two intervals, about 60 s at
    `KEEPALIVE_INTERVAL = 30_000`. The line then changes to "this tab"
    through the handover.
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
| E2 | som: **external and shadowed nodes:** an external node carrying an id is ignored by `objectIdInUse` and `resolveObjectId`, by identity (`isExternalNode`), and doesn't block a new id; a shadowed duplicate-name node's id **is** in use, but resolves `unaddressable`; **a saved node whose name is also a material's** (so `getObjectByName` gives the material) resolves `unaddressable` (S-D); after its predecessor is removed or renamed, the same id resolves to it. **Scans:** `not-found`, `ambiguous` (two saved nodes, loaded without healing), and a found node; never matching an inherited `objectId` or a non-plain `extras`/`atrium`. **`setPath` (M1):** creates `extras.atrium.objectId` on a node with no `atrium` (other `extras` keys kept), with `atrium: {}`, and with existing `atrium` data; refuses a non-plain `atrium`; still refuses `extras.atrium.other`, and still refuses `extras.atrium.animation` without `atrium` | (b) match by `in` instead of an own property; (b2) create intermediates for every listed path; (b3) treat external nodes by name; (b4) drop the `getObjectByName` clause |
| E3 | server, port 0: an owner `add` with a valid new id is accepted and broadcast with it; with a malformed id, `INVALID_VALUE`; with an id already in the world (including on a shadowed node), `INVALID_VALUE` and the "already taken" message, nothing added, **no broadcast and no autosave**; without an id, accepted. Set-once `send`: accepted on a node with `extras: {}`, with no `atrium`, and with existing `atrium` data, and broadcast; refused `INVALID_FIELD` on a node with one (including the same value); refused for a duplicate or malformed value; refused for a visitor and on an avatar; **a refused one causes no broadcast and no autosave**. **Two connections** sending the same id for two nodes: the first accepted, the second refused. After a `remove`, the id can be used again. **Load:** one id on three nodes (one of them shadowed) is dropped from all three, with one log line giving the count; a malformed id is dropped and logged, then a set-once `send` on that node is accepted; the healed document saves without the dropped ids | (c) skip the uniqueness check on `add`; (c2) allow the leaf when the node already has one; (c3) keep the id on the first of the duplicates |
| E4 | server, port 0, two and three owner sessions plus a visitor: the first owner `hello` has `scriptHost: true, hostGen: 1`; the second owner's and the visitor's have `scriptHost: false` and no `hostGen`. **Handover:** closing the host sends the second owner `script-host` `active: true, hostGen: 2`, and nothing to the visitor. **The former host reconnects:** its new `hello` has `scriptHost: false` while the second holds the role. **No eligible session:** closing the last owner leaves no host, and the next owner `hello` gets `hostGen` 3. **Read-only policy:** no session is ever host. **Two worlds:** each has its own host and its own `hostGen`. **Identity-safe cleanup (M2), with a fake `wss` and fake sockets, not port 0** (S-C: a real handshake can't land inside the race window). Drive `attachSessionHandlers` with an `EventEmitter` `wss` whose `connection` the test emits, and sockets with `on`, `send`, `ping`, `terminate`, `close` and `readyState`. Hello A (the host) and B (a second owner); set A's `missedPings` to 2 and run the sweep; emit a new connection whose `hello` takes A's session id; then emit A's `close`. The new session, its presence and the role assignment survive, exactly one handover happened, and `hostGen` is as expected. **And:** the sweep's handover skips a candidate at `missedPings ≥ 2` (N7) | (d) hand over to the first session in the map without the `canEdit` check (the visitor gets it); (d2) keep `hostGen` unchanged on handover; (d3) clean up by id without the identity check |
| E5 | protocol: valid and invalid `hello` (`scriptHost` missing refused; `scriptHost: true` without `hostGen` refused; `hostGen` with `scriptHost: false` refused; `hostGen` 0 and 2^53 refused) and `script-host` (each field missing, wrong type, out of range, extra field) | (e) drop `additionalProperties: false` from `script-host`; (e2) drop the `true`-requires-`hostGen` rule |
| E6 | client, fake socket: `scriptHost` from `hello`; a malformed `hello` role treated as inactive; `script-host:changed` on `hello` and on a `script-host` message; **generations:** `active: true` with a `hostGen` not greater than any seen is ignored, `active: false` below the current one is ignored; a malformed message ignored; `active: false` honoured. **Loss of role (M4), each emitting `active: false` synchronously, before `connecting` or the close:** `connect()` superseding an active host; `disconnect()` then an immediate `connect()`; a connect timeout; the socket closing; three rapid world switches; a delayed `script-host` for an old record ignored (its proof is removing `dispatch`'s stale-record guard, L680–681, not (f)); `canEdit` and the role both reset before the event. No event when the role wasn't active. **The own echo (S-A):** `setObjectId` sends the exact message and tracks it; nothing changes before the echo; the echo applies the broadcast's value to the sender's SOM, then `som:set` and `edit:accepted`; a rejection changes nothing | (f) accept a lower `hostGen`; (f2) reset the role on supersession without emitting; (f3) no own-echo case for the id leaf |
| E7 | `object-identity`: `withNewObjectId` adds an id without touching other keys, replaces an existing one, and doesn't mutate its input. `edit-duplicate`: `prepareDuplicate` gives a new id; `prepareRestore` keeps the node's id; a malformed id refuses with the new message. Wiring guard (`app.js`): the palette, Model form, teleporter form and library paths pass through `withNewObjectId`; the retry and the structural re-add don't. **Undo and redo of each form's add** (Model, teleporter, library), through the undo engine with a fake client: the re-added descriptor carries the original id. **A refused re-add:** another node took the id meanwhile (a raw `add`); the Undo re-add is refused, and the undo engine reports it as it does any refused re-add. **A palette add refused for its id** ("objectId is already taken…") is **not** retried (S-B) | (g) `prepareDuplicate` keeps the original's id; (g2) the structural re-add gets a new id; (g3) the server's message back to "already in use" (the palette retries) |
| E8 | `hostStatusText`: host ("Script host: this tab"), non-host owner ("Script host: another tab or device"), visitor and disconnected (nothing). Wiring guard: `refreshHostStatus` is called on `script-host:changed`, `connecting`, `disconnected` and Edit on | (h) show the host text to a non-host |

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
3. **The set-once leaf:** a raw `send` on a node of the harness world that has no
   `extras.atrium` (the floor), through `client.setObjectId`, is accepted.
   The id appears in **the sender's own SOM** and in another tab's. A second
   is refused with the server's message.
4. **Two owner tabs:** the first shows "Script host: this tab", the second
   "Script host: another tab or device". Close the first, and the second
   switches at once. Reopen the first, and it shows the other-tab text.
5. **Supersession:** the host tab switches worlds with a new connection.
   `script-host:changed` `active: false` fires before `connecting`, and the
   other owner tab becomes host.
6. **A visitor** sees no host line, and its `hello` has `scriptHost: false`.
7. **Saved:** restart the world server from its saved document. The ids are
   unchanged.
8. **Load healing:** a world document with one id on two nodes loads with
   the id on neither, and logs once.
9. **Regression:** §5.1 of scripting-4a (its checks 1–10 and round 2's and
   round 3's), library-sky's and edit-polish-3's.

## 6. DEV acceptance (operator, Firefox, hard reload, owner)
1. **Place a cube, a library model and a teleporter.** In the browser
   console, `atriumClient.som.getNodeByName('<name>').extras.atrium.objectId`
   shows an id for each, all different.
2. **Duplicate the cube:** the copy has a different id. **Delete the copy,
   Undo:** the same id as before the delete.
3. **Open the world in a second tab, signed in:**
   - the first tab's Edit panel says "Script host: this tab";
   - the second says "Script host: another tab or device";
   - close the first tab, and the second changes to "Script host: this
     tab".
   - **Expected:** an owner whose single tab reconnects quickly (say,
     after a laptop wakes) may see "another tab or device" for up to about
     60 s, until the server drops its old session. It then changes to
     "this tab" by itself.
4. **A private window, as a visitor:** no host line.
5. **Reload:** the ids are unchanged, and an animated model (4a) still plays.

## 7. Worker rules and release path
As scripting-4a (`devtasks/KICKOFF-scripting-4a.md`), with this round's
specifics:
- **Steps, one commit each:**
  1. E1 and the vectors file, E2 (the SOM) and E3 (the server's id rules
     and load healing);
  2. E4 and E5: identity-safe cleanup, the script host and the schemas;
  3. E6: the client's role state and its synchronous loss signal;
  4. E7 and E8: the add paths, Duplicate and the panel line;
  5. full suites, proofs (a)–(h) with (b2)–(b4), (c2), (c3), (d2), (d3),
     (e2), (f2), (f3), (g2) and (g3), and the handoff.
- **`--max-runtime 3h`.**
- **A protocol and server round:** DEV restarts at the deploy.
- **The front door, the kickoff and the release chain:** the scripting-4a
  passdown's §4.4–§4.5 rules:
  - build the whole chain at the review gate's APPROVE;
  - **nothing is pushed to `main` between the release merge and the MAIN
    push.**

## 8. Notes for the brief author
- **E4's handover runs inside `cleanupSession`, after the identity check
  and `sessions.delete`, keyed on the identity check, not on
  `presence.remove`'s return** (second review S-E). Read the function
  whole:
  - it's called from the close handler (L1001) and from the keepalive sweep
    (L1018), which terminates a socket whose close handler then calls it
    again;
  - with E4's identity check (`sessions.get(s.id) === s`) first, only the
    first call for a session object does anything, even if a new session
    has taken the same id in between;
  - so a handover placed after that check runs once per departure.
- **The M2 test needs a fake socket server** (§5 E4). Port 0 can't
  reproduce the race.
- **E2's intermediate creation is for one path only.** Put it beside
  `CREATABLE_PATHS`, as a separate list or an explicit check. Don't
  generalize `resolvesThroughPlainObjects`, and keep 4a's tests for the
  animation leaf unchanged.
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
- **Carried from the Rev 0 review:**
  - **Ambiguity never retargets (S1).** Every id → name step goes through
    E2's `resolveObjectId`. A behaviour whose `nodeMap` or `targets` entry
    resolves `not-found`, `ambiguous` or `unaddressable` is disabled and
    reported, never pointed at another object. B4 (a)'s healing makes a
    duplicated id `not-found`.
  - **The runner starts only when the world is ready (S5).** It's enabled
    only while **both** the connection that holds the role is the current
    one **and** that connection's world has loaded (`hello` arrives before
    the `som-dump`). It's re-evaluated on world load, role change and
    connection change.
  - **Older clients and the role (S6).** A tab still running 4b-1's code
    after 4b-2 deploys has no runner. 4b-2's server elects only sessions
    whose `hello` declares a runner (for example
    `capabilities.scriptRunner: 1`), so an old tab never holds the role.
    4b-1 needs no change for this.
    - It's a `hello.client.json` change, which also has
      `additionalProperties: false`.
    - It changes E-L4's eligibility to `canEdit` **and** a declared runner.
    - A DEV deploy restarts the server, so every session reconnects and the
      role is elected afresh under the new rule (second review §3).
  - **Duplicate remaps behaviour references (S7, design §4.9).** A copy
    with a behaviour gets new ids for the copied object, and its `nodeMap`
    and `targets` entries that named the original are rewritten to the
    copy. Grants to other objects are kept only where the 4b-2 pre-brief
    says so.
- **Decided here, not in the design** (second review §3). Design §4.9
  doesn't say what happens to a behaviour whose referenced object is
  removed, or whether Undo keeps ids. This pre-brief settles both:
  - a removed, renamed-away or ambiguous reference resolves through
    `resolveObjectId`, and the behaviour is disabled and reported;
  - Undo and redo keep ids (E-L2).

  4b-2 doesn't reopen them.
- **Already done in 4b-1, so 4b-2 only uses them:** the own echo of the id
  leaf (`setObjectId`, E6) and the resolver's `getObjectByName` clause
  (E2).

### 9.2 The adapter, as the spike supports it
**The 4b-2 pre-brief turns this into a testable contract** (review S4):
- **Exact limits, and what counts toward each:** steps per tick, pending
  delays, graph bytes, nodes, variables, queued events and adapter-held
  state.
- **The pending-delay cap is enforced before a timer is scheduled:** a
  budgeted `flow/setDelay` checks before calling the engine's own. The
  spike's `pushScheduledDelay` runs only after `setTimeout`.
- **An overrun disables the whole behaviour,** and its queued work and
  pending sends are discarded.
- **Cleanup covers everything a retired engine left:** event listeners,
  interpolation callbacks and pending coalesced sends, not only timers.
  Tests show every callback from a retired engine is inert.
- **The cycle check is precise:** it refuses or bounds *synchronous* flow
  cycles, and allows delayed or event-driven loops (an `every N seconds`
  template is one).
- **Acceptance gates:**
  - a browser smoke test of the vendored engine through the import map;
  - the malicious-loop probes (`devtasks/spike-4b/t1*.mjs`) against the
    real adapter;
  - teardown tests.

The measures it supports:
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
- **Rev 0** (2026-10-23, `0a8bff8e`): drafted by Claude from the design,
  the step 4 pre-brief, the 4a passdown, code reading at `aa0702c8`, and
  the D2 spike (§2.2). Open: B1–B6 and E-L1–E-L6.
- **Rev 1** (2026-10-24): an outside review of Rev 0 (read-only, against
  `0a8bff8e`; "revise before implementation"). Claude checked each finding
  against the code; M1 was also probed. All are taken.

| # | Finding | Severity | Where it went |
|---|---|---|---|
| M1 | The set-once leaf can't create `extras.atrium`, so it fails on most existing objects | Must-fix | **Confirmed by probe:** on a node with no `atrium`, `setPath` refuses even 4a's creatable animation path (`Path segment "atrium" resolved to null/undefined`). P4, E-L3, E2's one-path intermediate creation, tests and (b2) |
| M2 | `cleanupSession` isn't identity-safe if a session id is reused | Must-fix | Confirmed by reading (L387–417, L1001, L1018). P5, E-L4, E4's identity check (a fix to existing behaviour), its own test and (d3) |
| M3 | The lookup doesn't exclude external or shadowed nodes | Must-fix | Confirmed (`allNodes`; `copyNode` copies extras). P4b, B5 (a) rewritten into `objectIdInUse` and `resolveObjectId`, external nodes by identity, tests and (b3) |
| M4 | No synchronous loss-of-role signal; supersession emits no `disconnected` | Must-fix | Confirmed (`connect()` L541–609). P6, E6's synchronous `active: false`, its invariant, tests and (f2) |
| S1 | Healing can silently retarget a saved reference | Should-fix | **B4 (a) changed:** a duplicated id is dropped from every node that shares it, so a reference breaks loudly. §9.1 rule; (c3) |
| S2 | Tighten the host schema and client checks | Should-fix | E5 (`scriptHost` required; `true` ⇔ `hostGen`; safe-integer range), E6 (the same checks on receipt; generations only increase); (e2) |
| S3 | Identity tests at the real boundaries | Should-fix | E2–E3 and E7 tests: lazy ids on three `extras` shapes, concurrent ids, malformed then set-once, three-node duplicates with a shadowed name, no broadcast or autosave on refusal, Undo/redo per form, a refused re-add |
| S4 | §9.2 needs a testable execution and resource contract | Should-fix | §9.2's list and acceptance gates, for the 4b-2 pre-brief |
| S5 | The runner must wait for the world | Should-fix | §9.1 |
| S6 | Older clients holding the role in 4b-2 | Should-fix | §9.1 (a runner capability for election) |
| S7 | Duplicate must remap behaviour references | Should-fix | §9.1 |
| N1 | Avatars may carry `{ ephemeral: true }` | Nit | P3 |
| N2 | Log per id or per node; unescaped names | Nit | E3: one line per id with a count; names only through `JSON.stringify` |
| N3 | Nothing runs in 4b-1, so "Behaviours run in this tab" overstates it | Nit | E-L6, E8, §5.1, §6: "Script host: this tab" / "…another tab or device" |
| N4 | "Every failure but the last is adapter coverage" is too strong | Nit | S5 reworded as provisional |
| N5 | Vendoring: licenses, pins, hashes | Nit | B2 (a) |

The reviewer recommends (a) for all twelve decisions: B4, B5, E-L3 and E-L4
as modified here, and B2 as confirming the choice, not production safety.
- **Rev 2** (2026-10-24): a second outside review, of Rev 1 (`9e5d9930`),
  checked against the code ("not FINAL as Rev 1, but close"; no must-fix).
  Claude checked each code claim: the own echo (L1307–1339), the retry
  regex (`app.js` L2459–2463), `_takeOverName` (L386–402) and
  `disconnect()`'s deferred emit (L852–859). All are taken. The reviewer:
  with these, Rev 2 "can go FINAL without a further review round".

| # | Finding | Severity | Where it went |
|---|---|---|---|
| S-A | The sender's own echo of the id leaf isn't applied, so the sending tab's SOM lacks the id | Should-fix | **Done now, not deferred:** P6, E6 (`setObjectId` and a third own-echo case, Z2a's pattern), §5.1 check 3, tests and (f3) |
| S-B | "already in use" triggers the palette's one retry | Should-fix | P6; E3's message is now "objectId is already taken in this world"; E7 no-retry test; (g3) |
| S-C | The M2 test can't produce the race on port 0 | Should-fix | §5 E4: a fake `wss` and fake sockets; §8 |
| S-D | `resolveObjectId` must also require `getObjectByName(name) === node` | Should-fix | P4b (two name maps), E2, test and (b4) |
| S-E | Key the handover on the identity check, not `presence.remove` | Should-fix | E4, §8 |
| N1 | `atrium: null` is refused, not absent | Nit | E2 |
| N2 | Uniqueness is the handler's; `authorizeSend` gets a callback; healing is document-level | Nit | E3 |
| N3 | No "server-side message set"; `strict: false`; `hello` isn't validated on send | Nit | P6, E5 |
| N4 | Where the `hostGen` high-water mark lives | Nit | E6: on the connection record |
| N5 | Reset `canEdit` with the role, or the status line flickers in-tick | Nit | E6 |
| N6 | A dead predecessor shows "another tab or device" for up to 60 s | Nit | E8, §6 item 3 |
| N7 | The sweep's handover can choose a session it's about to terminate | Nit | E4 (skip `missedPings` at the limit); test |
| N8 | `disconnect()` also skips `disconnected` when superseded | Nit | P6 |
| §3 | The deferred items: S6 is a `hello.client.json` change; flag what's decided here, not in the design | — | §9.1 |

Every recommendation stands, and nothing changed a decision.
- **Rev 2.1** (2026-10-24 01:48 PT): the operator approved every decision as
  recommended. Only the status line changed. **4b-1's kickoff is written
  from the commit that carries this revision,** which is its base.
