# Pre-brief: Phase 3 step 4b-2 — behaviours, owner-present: the vendored engine, the adapter and runner, the `behavior` leaf, and the five templates

Status: **DRAFT, Revision 1 (2026-10-24). Decisions F-L1–F-L12 approved by
the operator (2026-10-24 17:42 PT), all as recommended:**
- F-L1 (a) one round, seven steps; F-L2 (a) design §5.4 plus `animations`,
  `proximity` and `template`; F-L3 (a) form and limits on the server,
  existence at run time; F-L4 (a) the templates' ops only; F-L5 (a) drop
  sends to the edited subtree and its ancestors during a gesture, never
  replay; F-L6 (a) `hello.capabilities.scriptRunner`; F-L7 (a) custom
  events with occupancy semantics; F-L8 (a) hidden objects rendered, not
  clickable, still editable; F-L9 (a) the host's own clicks outside Edit
  mode; F-L10 (a) Duplicate remaps self-references and keeps grants;
  F-L11 (a) a workspace package per vendored module; F-L12 (a) 4a's items
  1, 2, 3 and 5 and GLM's NIT, item 4 deferred.
- **Rev 1 applies the outside review of Rev 0.1**
  (`devtasks/REVIEW-scripting-4b-2-rev0.1.md`; "revise before the
  kickoff": 4 must-fix, 10 should-fix, 10 nits). Claude checked every
  finding against the engine and the code, and reran the reviewer's two
  probes (`r1`, `r2`, now beside the spike with `t6`). **All are taken.**
  No decision changes; §10 lists them.
  - **The one fact under three of the must-fixes:** the server's check
    (F1) runs the engine's `validateInteractivityGraph`, which is far
    stricter than `loadBehaveGraph`, the only thing the spike ever called
    (§2.3). As Rev 0 wrote them, the validator refused every template.
  - **Changed in the contract:** pointer templates are `[n]` with an int
    literal (M1); the interval template is an adapter-dispatched
    `atrium/interval` event, and **`flow/setDelay` leaves this round**
    with its budgeted subclass, its pending-delay cap and the injected
    timers (M2, the reviewer's (a)); `select` is taken from the viewport
    click with the Edit-mode slop and button rules (M3); `variables` is
    absent and `events` present only when non-empty (M4); `event/onSelect`
    is declared with its extension (S9); the 64 cap counts other nodes
    (S1); healing drops a behaviour on a node with no id (S2);
    `loadBehaveGraph(graph, false)` is pinned (S3); every disable is a
    `dispose()` (S5); the send queue is keyed by id (S6); the clip check
    is gated on a loaded model (S7); forbidden keys and depth (S8); the hit
    filter takes the next hit (S10).
  - **Still DRAFT.** It goes FINAL on the operator's word.
- **Drafted by Claude from `main` at `a246f80c`.** Its code is identical to
  the released `8358b043` (DEV, MAIN and PROD): the two commits on top
  (`2db57dc`, `a246f80c`) touch only `devtasks/`. Line numbers are at that
  commit.
- **The D2 spike was rerun today** (§2.3): a fresh install of the pinned
  engine, every probe `t0`–`t5`, and one new probe `t6` for the event
  sources the templates need. Every result in `devtasks/spike-4b/RESULTS.md`
  reproduces.
- **Sources:**
  - `devtasks/PREBRIEF-scripting-4b.md` FINAL Rev 2.1: B1–B6 (approved
    2026-10-24, B6 lists what this document decides), §2.2 (the spike), §9
    (this round's sketch and the adapter's contract in §9.2), §10;
  - `devtasks/Atrium-Passdown-2026-10-24-scripting-4b-1.md` §2 (what
    shipped), §6.1 (the carried items), §6.3 (`KHR_animation_pointer`);
  - `devtasks/Atrium-Passdown-2026-10-23-scripting-4a.md` §6.1 (4a's five
    items);
  - the design, `docs/DESIGN-phase3-placement-scripting.md` Rev 1.2: §4.9,
    §5.2–§5.5, §7 item 2, §9 row 4, §10 Q1, Q2, Q4, Q6;
  - the step 4 pre-brief, `devtasks/PREBRIEF-scripting-4a.md` FINAL Rev 1.2:
    D2–D6 (D5 as a direction only), L8, §9.1 (what a graph's animation
    index means);
  - the GLM review of 4b-1 (`t_36827c97`): one NIT carried here (P12);
  - **the outside review of Rev 0.1** (`devtasks/REVIEW-scripting-4b-2-rev0.1.md`,
    2026-10-24) and its probes `devtasks/spike-4b/r1.mjs` (the validator)
    and `r2.mjs` (the runtime).
- **Scope of this document:** the contract for 4b-2, the last round of step
  4b. After it an owner can attach one of five behaviours to an object from
  the Edit panel, and the owner's script-host tab runs them for everyone.
- **Out of scope** (as the 4b pre-brief fixed): visitors' `activate` and
  the owner's clicks from a non-host tab (4c); graph import, the converter
  and the unsupported-node report beyond what the templates need (4d); the
  graphical editor (step 5); JavaScript (step 6); behaviours while the
  owner is away (design §7 item 2); the world file's own animations (step 4
  pre-brief §9.5); `KHR_animation_pointer` models (4b-1 passdown §6.3, for
  4d).

## 1. What 4b-2 delivers, and its shape

| Who | What they get |
|---|---|
| **The owner** | A **Behaviour** section in the Edit panel for the selected object: one of five templates, its few parameters, a target picker, Enabled, a status line and a short log. "Script host: this tab" now means "behaviours run here" |
| **Visitors** | They see the effects (an object appears, an animation plays, a light goes out) as ordinary `set` broadcasts. They can't trigger anything yet (4c) |
| **The server** | One new writable node leaf, `extras.atrium.behavior`, with a strict check on `send` and on `add`; the same check runs the engine's own graph validator in Node. `hello.capabilities.scriptRunner`, and the host election now requires it |
| **The repo** | The Khronos engine and `gl-matrix`, vendored and pinned (B2 (a)); the adapter (`@atrium/behaviors`); node visibility finally rendered |

**It is one round with seven steps** (F-L1), each a commit, in the order
that lets the server and the engine be reviewed before any UI exists. **It
is the round that runs world-supplied graphs,** so it keeps both outside
reviews (4b-1 passdown §3): this pre-brief, and the whole round from base
to tip.

## 2. What exists today, what the spike showed, and what the rerun showed

### 2.1 The code (at `a246f80c`)

**P1. 4b-1's pieces, waiting for their first caller.**
- `som.resolveObjectId(id)` → `{ node }` or `{ problem: 'not-found' |
  'ambiguous' | 'unaddressable' }` (`SOMDocument.js` L1116–1125); the
  comment at L1110 names this round's runner as the caller.
  `objectIdInUse(id)` (L1091–1096); `isExternalNode` (L1051).
- `client.setObjectId(name, id)` (`AtriumClient.js` L1255–1268), a tracked
  `send` whose own echo is applied (L1501). The comment at L1248 names this
  round's form as its first UI caller.
- `client.scriptHost` (`{ active, hostGen }`, L229), `script-host:changed`
  from `_releaseScriptHost` (L1013–1019, synchronous on every abandon path:
  L591, L779, L847, L879), `_onScriptHost` (L1033–1041) and the `hello`
  (L1088). `canEdit` is reset with the role (L1016).
- The server's role: `scriptHost = { sessionId, hostGen }` per world host
  (`session.js` L310), the election at `hello` (L619–626), `grantScriptHost`
  (L398–402), `handOverScriptHost` (L414–423: the first session with
  `canEdit`, an open socket and `missedPings < 2`), the identity-safe
  `cleanupSession` (L431, check at L440, handover at L477–479).
- The host line: `refreshHostStatus` (`app.js` L1637–1644) and
  `hostStatusText` (`host-status.js` L32).

**P2. The `behavior` leaf today.**
- **A `send` of `extras.atrium.behavior` is refused:** `authorizeNodeSend`
  (`send-policy.js` L766–826) allows `NODE_FIELDS` (`translation`,
  `rotation`, `scale`, `visible`; L50), `name`, the teleporter, animation
  and `objectId` leaves (L799–816) and the material chain; everything else
  is `PERMISSION_DENIED` "field is not writable on a node" (L825).
- **But an owner `add` carrying `extras.atrium.behavior` is accepted
  unchecked.** `checkAtriumExtras` (L159–194) checks `teleporter`, `model`,
  `animation` and `objectId` and then allows: there's no key allowlist.
  (`addCarriesAtriumExtras`, `session.js` L113–124, is the *avatar* rule
  and refuses everything but `{ ephemeral: true }`; it doesn't run for
  non-avatar adds, L943–948.) Duplicate (`prepareDuplicate`,
  `edit-duplicate.js` L277–286, copies extras) and Undo (`prepareRestore`,
  L300) are `add` paths, so the leaf must be checked there too.
- **`setPath` creates only listed leaves** (`CREATABLE_PATHS`,
  `SOMDocument.js` L30: the animation and `objectId` leaves), and the
  `extras.atrium` intermediate for the `objectId` path alone (L1016–1021).
  A `behavior` leaf needs its own entry, and most nodes that will carry one
  have `extras.atrium` already (every node 4b-1 gave an id, and every node
  the form touches gets one first, F2).
- **`setPath` on an `extras.atrium.*` path fires no mutation event**
  (L1034 assigns into the plain extras object). The sender's own SOM gets
  the value only through an own-echo case (`_resolveOwnSetEcho`,
  `AtriumClient.js` L1462–1505: `name`, the animation leaf, the `objectId`
  leaf). The `behavior` leaf needs a fourth.
- **No byte cap on a node `send`** (the only extras caps are the document
  root's: `MAX_EXTRAS_DEPTH = 8`, `MAX_EXTRAS_BYTES = 64 KiB`, L553–554,
  with `hasForbiddenKey` and `maxDepth` at L578–596), and **no
  `MAX_ADD_BYTES` on the server:** the 4b pre-brief's E7 named the
  client's (`edit-duplicate.js` L23, 1,000,000 UTF-8 bytes of the whole
  `add`). The server's only cap is the socket's `MAX_PAYLOAD_BYTES = 1
  MiB` (`session.js` L24). `send.json`'s `value` is `{}`, unconstrained.
  `add.client.json` forbids `children`, so an `add` carries at most one
  behaviour.

**P3. The server's `send` path** (`session.js` `case 'send'`, L727): no
world → `UNKNOWN_MESSAGE`; the avatar displayName guard; the `source` guard;
`isMutator`; `resolveSendTarget` (`getObjectByName`, `send-policy.js` L660)
and `authorizeSend` (L792–808, pure, with `avatarNames`, `externalNames`
and `objectIdInUse` callbacks); the animation `startedAt` stamp (L815–819);
`world.setField` (L821; any `setPath` throw → `INVALID_FIELD`, `world.js`
L448–452); the broadcast to everyone with `requestSeq` and `session`
(L826–835); `onSaveableMutation` (L838–840). **There is no per-session or
per-world message rate limit on the socket:** `RATE_LIMITED` is in
`error.json` but never sent. The only limiter is HTTP, per IP
(`http-routes.js` L69).

**P4. Lights.**
- A light is a `SOMLight` on its host node (`somNode.light`), addressed for
  `send` by its qualified name `<node>.light` (`SOMDocument.js` L240,
  L255–256; `authorizeLightSend` requires it, `send-policy.js` L870–871).
  Writable: `color`, `intensity`, `type`, `range`, `innerConeAngle`,
  `outerConeAngle` (L74). **There is no on/off field;** off is
  `intensity: 0`.
- **No client path creates a light:** the palette has primitives only
  (`index.html` L608–612), the library's "Lighting" category is lamp
  models, `ingestNode` handles TRS, extras and mesh only (`SOMDocument.js`
  L781), and Duplicate refuses a light host (`edit-duplicate.js` L242).
  Lights come from world files, and a light host can't be renamed
  (`SOMDocument.js` L375). The fixture `space-lights.gltf` has `Sun` and
  `LampGlow`.
- The light's mutation listener sends under the qualified name
  (`AtriumClient.js` L1655–1666).

**P5. Node visibility is stored and synced but never rendered.**
- `SOMNode.visible` lives in `extras.__atrium_visible` (`SOMNode.js`
  L76–84) and is a server-writable node field (P2). The first-party client
  even writes it (`avatar.localNode.visible = false` in first person,
  `app.js` L2701).
- **Nothing in `packages/renderer-three` reads it.** `initDocumentView`
  (`document-view.js` L19–26) hands the scene to `@gltf-transform/view`,
  which mirrors glTF-Transform properties and knows nothing of an `extras`
  key; placed models are rendered by `model-bridge.js` and
  `model-instances.js` outside DocumentView. A hidden node draws exactly as
  a visible one.
- `PointerInputBridge` raycasts the whole scene root (`intersectObject(root,
  true)`, L102) with no visibility filter, and `pickEditTarget` (`app.js`
  L1822–1846) raycasts the same way. **Three's `Raycaster` doesn't skip
  invisible objects,** so once `visible` is honoured, hidden objects stay
  hit-testable unless the bridge filters.
- The Edit panel has no Visible control.

**P6. Clicks and selection.**
- **Every user's clicks reach the SOM** as DOM-style events on the node:
  `PointerInputBridge` calls `client.dispatchPointerEvent(somNode, type,
  detail)` (`AtriumClient.js` L291–323) for `pointerdown`, `pointerup`,
  `pointermove`, `pointerover`, `pointerout` and `click` (a `pointerup` on
  the node that got the `pointerdown`, L319). The node is the default
  walk-up to the nearest SOM node (`PointerInputBridge.js` L63–66). Events
  don't bubble (`_dispatchOnNode`, L1853–1858) and fire only on a node with
  listeners.
- **The owner's selection is the viewport `click` handler** (`app.js`
  L1865–1875), which returns at once unless `modes.edit`, then
  `pickEditTarget` → `pickEditSelection` with `resolveSelectionRoot`
  (`@atrium/interaction`, `nearestNonMeshAncestor`) → `selectForEdit`
  (L1779). **So in Edit mode a click selects; outside it, a click reaches
  only the SOM listeners** — exactly D5 (a)'s split.
- **There is no `select` event on the client.** The only subscriber of SOM
  pointer events is the diagnostic logger (`model-listeners.js` L34–38).

**P7. Proximity.** `teleport-trigger.js` is the only proximity code:
`update(avatarPos)` (L97–159) tests `hypot(dx, dz) ≤ 0.75 && |dy| ≤ 2.0`
against each pad, with `armed` / `wasInside` flags and an enter-only
transition. It's polled every frame with **the local avatar only**
(`app.js` L2758–2760), using the avatar's local translation. Peers' positions
arrive through `view` into their SOM nodes (`_onView`, `AtriumClient.js`
L1507); the server keeps its own copy (`session.js` L1012). **The host sees
every avatar's position in its SOM,** which is what design §5.2 relies on
for `enter` and `exit`.

**P8. The frame loop** (`app.js` `tick(now)`, L2744–2761):
`modelAnimations?.update()`, `stage.tick(dt)`, `labels.update()`,
`tickEditMode()`, `trigger.update(…)`. A runner tick goes in here, once per
rendered frame (design §5.3).

**P9. How owner edits are sent, and why the runner can't use that path.**
- The Edit panel assigns SOM properties (`node[field] = value`, `writeSend`
  L1527–1530) and the per-node mutation listeners send them
  (`_attachNodeListeners` L1602; `_onLocalMutation` L1690–1699: a tracked
  edit, `type: 'send'`). **The value is applied locally first, then sent;**
  the own echo isn't re-applied except for `name` and the two leaves (P2).
- There is no generic `client.send(name, field, value)`. The leaf methods
  (`setModelAnimation` L1224–1237, `setObjectId` L1255–1268) are the
  pattern: `++_sendSeq`, `_trackEdit`, the wire message, the seq returned.
- **The runner needs a different shape:** sends **coalesced and
  rate-limited** (design §5.3: at most 20 per second per world), and
  **applied to the host's own SOM only when the server answers**, so the
  host's view and every visitor's agree, and the undo engine (which
  ignores writes that aren't a gesture, step 4 pre-brief D5) never sees a
  local SOM mutation it didn't make.
- The model-animation panel's "one write at a time per node"
  (`model-animation-panel.js` L113–201) is the panel's rule, not the
  client's.

**P10. The protocol.** `hello.client.json`: `type`, `id`, `ticket`,
`displayName`, `capabilities` = `{ tick, physics, chat }` with
`additionalProperties: false` at both levels. **A new capability key fails
validation today,** so S6's `scriptRunner` is a schema change. The server
reads `msg.capabilities?.tick?.interval` (`session.js` L544) and stores
`msg.capabilities ?? {}` (L581). `send.json` and `set.json` carry `value:
{}`.

**P11. World load on the client.** `_onSomDump` builds the SOM, attaches
listeners, sends the avatar `add`, sets `_worldReady` and emits
`world:loaded` (`AtriumClient.js` L1108–1142, L1850); it fires again per
external ref (L1804). `hello` (with the role) comes first, then the dump:
§9.1's S5 rule ("the runner starts only when the world is ready") binds
the runner to **both** `script-host:changed` and `world:loaded` of the same
connection.

**P12. Small facts for the contract.**
- `_scriptHostRoleWarned` is never reset (GLM's NIT on 4b-1): the
  malformed-`hello` warning logs once per page, not once per connection.
- `clipIds(names)` → `[{ id, index }]` (`animation-spec.js` L138; L8 (a)):
  the id is the clip's name with ` (n)` for duplicates, and the index is
  the file index. The play value is `{ clip, playing: true, loop, speed:
  1, startedAt: 0 }` and Stop is `null` (`model-animation-panel.js` L36,
  L41); the server stamps `startedAt`. `ANIMATION_CLIP_MAX = 300`.
- `atriumProblem` (`edit-duplicate.js` L76–95) knows `objectId`,
  `teleporter` and `model`; not `animation`, not `behavior`.
- The importmap guard (`apps/client/tests/importmap-guard.test.js`) walks
  the static import graph of three pages; every bare specifier must be a
  key of each page's map. Third-party modules come from esm.sh today;
  `@atrium/*` are local paths. The harness serves local copies of the
  esm.sh modules (`devtasks/harness/README.md`).
- No third-party code is vendored under `packages/` today.
- `space.gltf` nodes: `ground-plane`, `crate-01`, `lamp-01`, `lamp-stand`,
  `lamp-shade`. No lights.

### 2.2 What the spike showed (the 4b pre-brief §2.2, unchanged)
S1–S6 stand: a step budget through `processNodeStarted` on the engine
itself plus budgeted `flow/while` and `flow/for` subclasses; a flow cycle
overflows the stack at about 4,000 steps; `dispose()` clears timers but not
interpolation callbacks, and `loadBehaveGraph` in place leaves old timers
live; a refusing setter blocks writes and continues on `out`; all 187
invalid graphs rejected; 141 of 156 conformance assets with the minimal
adapter; one ESM file with one bare import.

### 2.3 The rerun (*probe*, 2026-10-24)
- **Set-up, as `devtasks/spike-4b/README.md`:** a fresh `npm install
  --ignore-scripts` of `@khronosgroup/gltf-interactivity-engine@1.1.0` and
  `gl-matrix@3` (resolved 3.4.4) in a scratch folder, Node 22.23.4, the
  assets at `926bec45`.
- **The engine file is byte-identical in size** (`build/index.js`, 353,583
  bytes), sha256
  `23a4604c0b7621e08bba8c115d9815b403abc9f517406c2b19d624c20f2270b6`. Its
  one bare import is `import * as glMatrix from 'gl-matrix'`.
- **`gl-matrix` 3.4.4's "ESM 186,002 bytes" is a folder, not a file:**
  `esm/index.js` (436 bytes) re-exporting twelve sibling modules
  (`common.js`, `mat2.js` … `vec4.js`), 186,002 bytes in all. The single
  `gl-matrix.js` (207,221 bytes) is the UMD build, not ESM. Vendoring takes
  the `esm/` folder (F11).
- **`t0`–`t5` reproduce `RESULTS.md` line for line:** `t1` stops at 10,001
  steps in 9–14 ms and the cycle overflows at about 4,000 steps (3,976
  here, 3,975 in the review's run; it depends on the stack); `t1b` hangs
  (exit 124); `t1c` stops both body-less loops at 10,001 steps in 5 ms and
  completes `for 0..5`; `t2` (a) 1 → 0 timers, (b) the old timer stays
  live after a reload, (c) interpolation keeps writing after `dispose()` and
  after a reload, (d) 5,000 delays in one tick, all cleared; `t3` the same
  eight lines; `t4` 187/187 rejected (46 + 141); `t5` 141/156 with the same
  fifteen failures.
- **`t6`, new today** (not committed; it's in this session's scratch
  folder), the event sources the templates need:
  1. **`event/onSelect` fires through `engine.select(index)`,** and
     `select` walks up `getParentNodeIndex` to the listener: a select on
     the behaviour node's child reached its `onSelect` (config `nodeIndex:
     0`); a select on an unrelated node did nothing.
  2. **`event/receive` fires for a declared event id** when the host calls
     `dispatchCustomEvent('KHR_INTERACTIVITY:atrium/enter', {})`. The
     channel prefix is the engine's (`getCustomEventChannel`, L1715); an
     unprefixed dispatch does nothing.
  3. **`animation/start` and `animation/stop` reach the decorator's
     `startAnimation` / `stopAnimation`** with the index resolved from the
     `/animations/{i}` ref, **provided `getWorld().animations` has that
     many entries** (`AnimationStart.processNode` reads its `length`,
     L7917; that's why `t5`'s six `animation/*` cases threw). An index past
     the end takes `err` and calls nothing.
  4. **A delayed self-loop runs under `loadBehaveGraph`:** `onStart →
     setDelay(0.05) --done--> animation/start --out--> setDelay` fired five
     starts in 300 ms with ticks every 10 ms, and nothing after
     `dispose()`. **It is a fact about `loadBehaveGraph` only:** the
     validator refuses it (below), so no world will ever store it.
  5. **A synchronous cycle** (`sequence → sequence`) overflows the stack
     (3,694 steps) under `loadBehaveGraph`, caught by the tick wrapper;
     the validator refuses it at load.
- **`r1` and `r2`, the review's probes (2026-10-24, rerun by Claude):
  the validator is not the loader.** `validateInteractivityGraph`, which
  F1 runs on the server, refuses what `loadBehaveGraph` accepts:
  - **pointer templates:** `{n}` makes `n` a **`ref`** socket and `[n]`
    an **int** socket (`parsePathTemplate`, L533–583; the check at
    L11974–11986). With `{n}` and an int literal, `select-visibility` and
    `select-light` are refused ("invalid or missing pointer/set input n");
    with `[n]` and an int, all five templates pass. The runtime resolves
    every spelling (`r2`: `[n]`+int, `{n}`+int, `{n}`+ref and a literal
    path all write), which is why `t0`, `t3` and `t6` never saw it;
  - **flows must point to a later node** (L11933) and value inputs to an
    earlier one (L11923): a graph that passes is a DAG in index order.
    The delayed self-loop and the `sequence → sequence` cycle are both
    refused ("output flow must point to a later node");
  - **the Khronos JSON schema** (L9341–9393) has `minItems: 1` on
    `types`, `variables`, `events`, `declarations` and `nodes`: a graph
    with `variables: []` or `events: []` is refused;
  - **`event/onSelect` must be declared with its extension**
    (`{ op: 'event/onSelect', extension: 'KHR_node_selectability' }`,
    L11908); bare, it is "unknown core operation";
  - **`event/receive` of an `atrium/interval` event** and `event/onTick →
    flow/throttle` both pass.
- **Two engine facts read from the build for the contract:**
  - `flow/setDelay` schedules with the global `setTimeout` (L4409) and
    `clearScheduledDelays` cancels with the global `clearTimeout`
    (L8331–8343); the engine keeps one array slot per delay ever scheduled
    (`pushScheduledDelay` L8356, `removeScheduledDelay` L8379). **Rev 1
    takes `flow/setDelay` out of this round (M2),** so this is 4d's note:
    a budgeted subclass that reimplements the scheduling with injected
    timers must keep its own id list and clear it itself, or a fake-timer
    test of "dispose cancels every timer" passes against nothing (review
    S4).
  - `loadBehaveGraph(graph, runGraph = true)` queues the `onStart` events
    and, with `runGraph` true, runs the queue and **schedules the engine's
    own `setTimeout` loop** at `1000 / fps` (L8533–8535, L8712). Every
    probe passes `false`; the adapter must too (F4).
  - `setExecutionErrorListener` only covers the engine's own `setTimeout`
    loop (L8712); with manual ticks (`executeEventQueueTick`) a throwing
    node throws out of the tick, which is what the adapter's wrapper
    catches. `processDebugLog(node, message, severity)` (L8555) is the hook
    for `debug/log`.

## 3. Decisions (F-L1–F-L12)

- **F-L1 — One round, seven steps.**
  - **(a) Recommended: one round,** in the step order of §7 (server and SOM
    → vendoring and the adapter in Node → the runner → the renderer →
    the form and panel → tests and conformance), each step a commit, with
    `--max-runtime 4h`.
  - (b) Two rounds: 4b-2a (steps 1–4: everything but the form; behaviours
    attachable only from the console) and 4b-2b (the form and panel).

  (a) is about twice 4b-1, which passed in one go after its two pre-brief
  reviews. (b) ships nothing an owner can see for a whole round and makes
  the DEV acceptance of 4b-2a a console exercise. The seven steps already
  give the review the seams of (b).
- **F-L2 — The storage shape.**
  - **(a) Recommended: design §5.4, plus three keys this round needs:**

    ```
    extras.atrium.behavior = {
      kind: 'graph',
      graph: { types, events?, declarations, nodes },   // standard KHR_interactivity; no `variables` in 4b-2,
                                                        // `events` only when non-empty (the schema's minItems: 1)
      nodeMap: ['<objectId>', …],      // graph node index → objectId; nodeMap[0] is this node's own id.
                                       // A light pointer /extensions/KHR_lights_punctual/lights/[n]/… indexes
                                       // nodeMap too (the light on that node), not a lights table (4d's converter)
      targets: ['<objectId>', …],      // grants beyond this node's subtree (design §5.3)
      animations: [{ object: '<objectId>', clip: '<clip id>', loop: bool }, …],   // graph /animations/{i}
      proximity: { radius: number },   // only when the graph receives atrium/enter or atrium/exit
      interval: { seconds: number },   // only when the graph receives atrium/interval
      template: { id: '<template id>', params: { … } },   // what the form wrote; absent for a graph it didn't
      enabled: bool,
      origin: 'local'
    }
    ```
    - **`animations` is the second index translation,** beside `nodeMap`
      (design §5.4 says node references are the one translation; a graph's
      `animation/start` refers to `/animations/{i}` by index, and 4a's clips
      live on placed models, not in the world file). The step 4 pre-brief
      §9.1 asked for exactly this mapping: index → (object, clip) → 4a's
      leaf.
    - **`proximity` and `interval` hold what the graph can't:** `enter`
      and `exit` are evaluated by the adapter against avatar positions
      (design §5.2), and the interval is the adapter's own timer (M2): the
      validator makes every stored graph a DAG, so a graph can't loop on
      itself, and the graph has no parameter outside its own literals that
      the adapter could read without parsing it.
    - **`template` lets the form reopen a behaviour** with its parameters
      filled in, without reverse-engineering the graph. The graph is the
      authority: the runner never reads `template`.
    - `kind` is `'graph'` only; `js` is step 6's. `origin` is `'local'`
      only; an import (4d) sets a URL.
  - (b) Design §5.4 exactly, with the animation table and the radius
    encoded as extra graph `variables` the adapter reads by name.

  (b) puts Atrium meaning into standard-shaped fields that an exporter
  would carry as plain variables. (a) keeps the graph standard and the
  Atrium parts beside it, where 4d's converter can see them.
- **F-L3 — What the server checks, and what it doesn't.**
  - **(a) Recommended: form and limits on the server, existence at run
    time.** The server checks the shape, every limit in F7, the op and
    pointer allowlists, that every `nodeMap`, `targets` and
    `animations[].object` entry passes E1, that `nodeMap[0]` is the node's
    own `objectId`, and runs `validateInteractivityGraph`. **It does not
    check that a referenced id exists in the world.** The runner resolves
    every id when it runs (`resolveObjectId`), and a `not-found` disables
    the behaviour with a reason (§9.1 S1).
  - (b) The 4b pre-brief §9.1's sketch: the server also refuses an id that
    doesn't exist.

  (b) breaks Undo: deleting a behaviour's target and then the behaviour
  node, and undoing the second delete, would be refused ("target not
  found") and the undo engine would drop the entry (`failEntry`,
  `edit-undo.js` L594–599). It also buys no safety: authority is enforced
  in the owner's browser (design §5.2, "cooperative"), and the server's
  owner gate accepts any owner write regardless. (a) keeps every add path
  working and reports the dangling reference where it matters, in the
  runner's log.
- **F-L4 — Which graphs 4b-2 runs: the templates' ops only.**
  - **(a) Recommended: the op allowlist is exactly what the five templates
    use, plus `debug/log`:** `event/onSelect` (declared with
    `extension: 'KHR_node_selectability'`), `event/receive`,
    `flow/branch`, `pointer/get`, `pointer/set`, `math/not`, `math/gt`,
    `animation/start`, `animation/stop`, `debug/log`. **No `flow/while`,
    no `flow/for`, no `flow/setDelay`, no `pointer/interpolate`, no
    `variable/*`, no `event/onTick`** (Rev 1: the interval template is an
    adapter event, M2, so no template needs a delay or a tick, and
    `event/onStart` goes with them). Every pointer index is an int
    literal. The step budget still applies (defence in depth, not the
    first line), and the validator's own rules make every stored graph a
    DAG (§2.3).
  - (b) The engine's core set with the budgeted loop subclasses from the
    spike (`t1c`).

  (a) means the only graphs this round accepts from a world file are the
  shapes the templates produce or small variations of them, which is what
  the templates' tests cover. (b) is 4d's job (graphs beyond the
  templates), where the conformance subset grows with it, and where
  `flow/setDelay` returns with the spike's budgeted subclasses (`t1c`) and
  the timer rule of §2.3.
- **F-L5 — The drag rule (D5) and D4 in practice.**
  - **(a) Recommended: while the host owner has a gesture in progress,
    behaviour sends to the edited node, its descendants and its ancestors
    are dropped, logged once per gesture, and not replayed.** A gesture is
    a drag, a handle drag or a form write in flight (the Edit panel's own
    "one write at a time" rule). Behaviours keep running (D5 (a)); only
    those sends are lost. **The animation leaf and light fields are
    dropped too** when their node is in that set: one rule, no exceptions.
    When the gesture ends, nothing is replayed; the next event sends fresh
    values.
    - **D4 in practice:** a behaviour's writes are saved like any owner
      write (autosave, P3). The form says so: "Behaviour changes are saved
      with the world." The Behaviour section's **Undo note** says the undo
      engine doesn't undo them.
  - (b) Pause every behaviour whose `nodeMap` includes the edited node for
    the gesture, and replay the last value per field when it ends.

  (b) replays a value the owner just overrode, which is the surprise the
  rule exists to prevent. Dropping is predictable, and the step 4
  pre-brief's own expectation. Shared resources (a material under two
  objects) aren't writable by a behaviour in 4b-2 (F-L4: no material
  pointers), so the "resources it shares" clause of D5 has nothing to
  cover yet.
- **F-L6 — Election needs a runner (§9.1 S6).**
  - **(a) Recommended: `hello.capabilities.scriptRunner: 1`,** a schema
    change to `hello.client.json`; the server elects only a session with
    `canEdit` **and** `capabilities.scriptRunner === 1`, at `hello` and at
    handover. A 4b-1 tab (no capability) keeps `canEdit` and its panel but
    never holds the role. A DEV deploy restarts the server, so every
    session reconnects under the new rule.
  - (b) No capability: a stale tab can be elected and nothing runs until
    it closes.

  (b) is a silent outage of every behaviour in the world for as long as an
  old tab is open. (a) is one schema field and one `&&`.
- **F-L7 — `enter` and `exit`: custom events, occupancy semantics.**
  - **(a) Recommended: the graph declares `events: [{ id: 'atrium/enter'
    }, { id: 'atrium/exit' }]` and listens with `event/receive`;** the
    adapter dispatches them (`t6` item 2). **Occupancy, not per-avatar:**
    `enter` fires when the first avatar comes within `proximity.radius` of
    the behaviour node's world position (horizontal distance, with the
    teleporter's 2 m height band, P7) while none was inside; `exit` fires
    when the last one leaves. Every avatar counts, the host's own included.
    The radius is 0.5–50 m, default 3.
  - (b) Evaluate proximity inside the graph (`event/onTick`, avatar
    pointers, `math/length`, a variable for the inside flag).

  (b) needs avatar nodes in `nodeMap` (they come and go), runs a graph
  every frame for every proximity behaviour, and widens the op allowlist to
  do it. (a) is thirty lines in the adapter and matches design §5.2 ("the
  host evaluates proximity itself"). The template's "on enter play, on exit
  stop" then does what it says with one visitor or ten. **Rev 1 gives the
  interval template the same shape** (`atrium/interval`, M2): the adapter's
  injected timer dispatches it, and every timer in the round lives where
  the tests can fake it.
- **F-L8 — Hidden objects: rendered, not clickable, still editable.**
  - **(a) Recommended:** the renderer honours `visible` (P5) for nodes
    and placed models (`Object3D.visible` on the node's view object and
    on each instance). **Outside Edit mode a hidden object is skipped by
    hit-testing** (the pointer bridge filters invisible hits), so visitors
    and the owner can't click what they can't see. **In Edit mode hidden
    objects stay hit-testable,** so the owner can select one; the selection
    outline shows where it is, and the Edit panel gets one new control, a
    **Visible** checkbox, so the owner can un-hide it by hand. A hidden
    node's descendants are hidden with it (three's visibility is
    inherited), and a hidden model's animations keep their state.
  - (b) Rendered and never hit-testable; the owner un-hides through the
    behaviour or by reloading the world after disabling it.
  - (c) A ghost (a translucent copy) in Edit mode.

  (b) can lock an owner out of an object for good: the hide is a behaviour
  write, which Undo doesn't track, and disabling the behaviour changes
  nothing (D4). (c) is renderer work on shared materials and model
  instances for a case the outline already covers. (a) is the smallest
  rule that leaves the owner in control.
- **F-L9 — `select` in 4b-2: the host's own clicks, outside Edit mode.**
  - **(a) Recommended:** a `click` on a node (P6) in the host session,
    with Edit mode off, fires `select` on the nearest behaviour whose own
    node is the clicked node or one of its ancestors (the engine's own
    walk, `t6` item 1, with `nodeMap` parents). Clicks in Edit mode select
    (D5 (a)). Clicks in a visitor's tab or a non-host owner tab do nothing
    until 4c's `activate`.
  - (b) Also fire `select` from a non-host owner tab by sending a
    `script-host`-style message to the host.

  (b) is 4c's `activate` by another name, without its schema, checks or
  rate limits. 4b-2 says so in the status line of a non-host owner tab:
  "Behaviours run in another tab; clicks here don't trigger them."
- **F-L10 — Duplicate remaps the copy's self-references and keeps its
  grants (§9.1 S7).**
  - **(a) Recommended:** `prepareDuplicate` rewrites every `nodeMap`,
    `targets` and `animations[].object` entry equal to the original's id to
    the copy's new id, and keeps every other entry. `prepareRestore`
    changes nothing (Undo brings back the same object, E-L2).
  - (b) Drop grants on copy: `targets` and the entries that name other
    objects are removed, and the behaviour is disabled until the owner
    re-grants.

  The grants are the owner's own, made for the owner's own objects. (b)
  would be right for an import (4d, "disabled-until-enabled with a
  `targets` review", design §9 row 7), not for the owner copying their own
  switch.
- **F-L11 — Vendoring: a workspace package per vendored module.**
  - **(a) Recommended:** `packages/vendor/gltf-interactivity-engine/`
    (`package.json` named `@khronosgroup/gltf-interactivity-engine`,
    version 1.1.0, `"type": "module"`, `exports` → `build/index.js`,
    `dependencies: { "gl-matrix": "workspace:*" }`) and
    `packages/vendor/gl-matrix/` (named `gl-matrix`, 3.4.4, `exports` →
    `esm/index.js`, the twelve `esm/*.js` files). Each keeps its `LICENSE`;
    a `NOTICE` at the repo root lists both; `packages/vendor/VENDORED.md`
    records the upstream version, the npm tarball, and **the sha256 of
    every vendored file** (B2 (a)'s terms). The two names are added to the
    `pnpm-workspace.yaml` globs (`packages/vendor/*`). **The server
    imports the engine by its bare name** (for `validateInteractivityGraph`,
    F3) through the workspace link, and the browser through two import-map
    entries pointing at the local paths. The engine's `build/index.js` is
    not edited: the budgeted loop subclasses and the event bus live in the
    adapter.
  - (b) Copy the two modules into `packages/behaviors/vendor/` with
    relative imports, rewriting the engine's one bare import.

  (b) edits a vendored file, which the recorded hash then can't verify
  against upstream. (a) edits nothing and resolves the same way in Node
  and in the page.
- **F-L12 — Which carried items this round takes.**
  - **(a) Recommended: take 4a's items 1, 2, 3 and 5, and GLM's NIT; defer
    4a's item 4.**
    1. **The clip select in a second owner tab** (4a §6.1 item 1): the
       select follows another session's playing value, and a pick lasts only
       until its own write is answered. With behaviours writing the same
       leaf, every tab is "a second tab" now.
    2. **Per-frame work for stopped models** (item 2): `update()` skips
       stopped entries.
    3. **Stop on a model with no clips** (item 3): Stop is enabled whenever
       a saved playing value exists.
    5. **The clock tests** (item 5): a lost recovery pong, overlapping
       bursts, a steady ping between `sent.clear()` and the burst.
    - **The NIT:** `_scriptHostRoleWarned` resets per connection.
    - **Deferred, 4a's item 4** (selection bounds from one pose): it's a
      hit-testing feature with no behaviour in it, and it needs per-clip
      bounds the renderer doesn't keep. Recorded for 4d or a polish round.
  - (b) Take all five.

## 4. The contract

### F1. The leaf's rule, in two copies (the E1 pattern)
- **`behaviorProblem(value, { ownId })`** returns a reason code or `null`.
  The codes, each with a text in `BEHAVIOR_MESSAGES`:
  - `behavior-type`: not a plain object, or a key outside `kind`, `graph`,
    `nodeMap`, `targets`, `animations`, `proximity`, `interval`,
    `template`, `enabled`, `origin`; **or, anywhere in the value,** a key
    in `FORBIDDEN_KEYS` (`__proto__`, `prototype`, `constructor`) or a
    depth over 8 — the document extras' `hasForbiddenKey` and `maxDepth`
    (S8);
  - `behavior-kind`: `kind !== 'graph'`; `behavior-origin`: `origin !==
    'local'`; `behavior-enabled`: not a boolean;
  - `behavior-bytes`: `JSON.stringify(value).length > 16384` (UTF-16
    units, not the socket's bytes);
  - `behavior-graph`: `graph` not a plain object, or
    `validateInteractivityGraph(graph)` throws (its message is appended);
  - `behavior-size`: more than 64 `nodes`, 32 `declarations`, 16 `types`,
    8 `events`; **a `variables` key at all** (F-L4; M4: the schema refuses
    an empty array, so the key is absent); an `events` key that is an empty
    array (M4);
  - `behavior-op`: a declaration whose `op` is outside F-L4's list, or
    whose shape isn't `{ op }` — **except `event/onSelect`, which is
    exactly `{ op: 'event/onSelect', extension: 'KHR_node_selectability' }`**
    (S9: bare, the validator calls it an unknown core op; with the
    extension, the validator takes its sockets from the declaration, and
    no template declares any). Declarations are unique by `(op,
    extension)`. An `event/onSelect` node's configuration is `nodeIndex`
    the literal `0` and `stopPropagation` the literal `false`;
  - `behavior-event`: an `events` entry whose `id` isn't `atrium/enter`,
    `atrium/exit` or `atrium/interval`, or carries `values`;
  - `behavior-pointer`: a `pointer/get` or `pointer/set` whose pointer
    doesn't match one of
    `^/nodes/(\[n\]|\d+)/(translation|rotation|scale)$`,
    `^/nodes/(\[n\]|\d+)/extensions/KHR_node_visibility/visible$`,
    `^/extensions/KHR_lights_punctual/lights/(\[n\]|\d+)/intensity$`
    (M1: `[n]` is the engine's **int** index socket; `{n}` is a `ref`
    socket, which the decorator never registers, so any `{…}` is refused
    outright), or whose index (the literal in the path, or the node's
    literal int `n` value for `[n]`) isn't an integer below
    `nodeMap.length`. A socket-connected index is refused. The three
    transform fields are kept for 4d (N2): no template writes them, and
    `authorizeNodeSend` bounds them (a unit quaternion, a non-zero scale);
  - `behavior-literal`: an `animation/start` or `animation/stop` whose
    `animation` isn't a literal `/animations/<i>` with `i` below
    `animations.length`, or an `animation/start` whose `speed` isn't a
    literal in 0.1–10;
  - `behavior-map`: `nodeMap` or `targets` not an array of 1–16 (resp.
    0–16) strings that each pass E1; a duplicate within an array;
    `nodeMap[0] !== ownId` when `ownId` is given;
  - `behavior-animations`: not an array of 0–8 `{ object, clip, loop }`
    with `object` passing E1, `clip` a string of 1–300 characters and
    `loop` a boolean; or an `animation/*` op present with an empty table;
  - `behavior-proximity`: present but not `{ radius }` with a finite
    radius in 0.5–50; or absent while the graph declares `atrium/enter` or
    `atrium/exit`; or present while it declares neither;
  - `behavior-interval`: present but not `{ seconds }` with a finite
    `seconds` in 1–3600; or absent while the graph declares
    `atrium/interval`; or present while it doesn't;
  - `behavior-template`: present but not `{ id, params }` with `id` one of
    the five template ids and `params` a plain object of at most 1 KiB.
- **Where:** the client's copy in `packages/behaviors/src/behavior-spec.js`
  (renderer-neutral, imports the vendored validator), the server's in
  `send-policy.js`. **Both read `tests/fixtures/behavior-vectors.json`:**
  the five templates' canonical outputs (accepted), each limit at its
  boundary and one past it, each allowlist with one op or pointer outside
  it, **a `{n}` pointer (refused)**, a socket-connected index,
  `variables: []`, `events: []`, a bare `event/onSelect`, `nodeMap[0]` not
  the own id, `atrium/enter` without `proximity`, `atrium/interval`
  without `interval`, a `__proto__` key inside `template.params`, and
  `kind: 'js'`. **The validator runs last**, after every rule above, so a
  vector's reason code is the rule's, not the validator's.
- **`null` is the "no behaviour" value,** as `null` is 4a's "stopped":
  accepted on `send`, it removes the leaf's effect; the runner disposes
  that behaviour.

### F2. The SOM and the server
- **`CREATABLE_PATHS` gains `'extras.atrium.behavior'`.** The one-path
  intermediate creation stays the `objectId` path's alone: **the form
  gives a node its `objectId` first** (`setObjectId`, awaited through
  `edit:accepted`) and only then writes the behaviour. A node with an own
  id has an `extras.atrium` by construction, and the own-id rule below
  runs first, so the leaf never meets a missing intermediate (N3).
- **`authorizeNodeSend`:** a fourth leaf case, `BEHAVIOR_LEAF =
  'extras.atrium.behavior'`:
  - the node must carry an own `objectId` (`INVALID_FIELD`, "give the
    object an id before a behaviour");
  - `null` is allowed;
  - the value must pass F1 with `ownId` = the node's id (`INVALID_VALUE`,
    the F1 text);
  - **the world may hold at most 64 behaviour nodes:** a `send` that
    would make this node the 65th is refused (`INVALID_VALUE`, "this world
    already has 64 behaviours"); **a `send` to a node that already carries
    one is never refused by the cap** (S1: Enabled toggles and Save rewrite
    the value), so the count is of *other* saved nodes with a non-null
    behaviour, through a `behaviorCount(excludeNode)` callback the handler
    passes, as it passes `objectIdInUse` (`authorizeSend` stays pure);
  - the owner gate, the live-avatar and external-node refusals as for any
    `send`.
- **`checkAtriumExtras` checks `behavior` when the key is present** (P2):
  `null` or a value passing F1 with `ownId` = the add's own `objectId`
  (absent id → `INVALID_VALUE`, "a behaviour needs an object id"). **The
  `add` handler applies the 64 cap** after the name rules, before
  `world.addNode`, as E3 placed the uniqueness check.
- **Load healing (both world kinds, after `healDocumentObjectIds`):** a
  node's `behavior` is replaced by `null`, one log line per node, when
  **the node has no own `objectId`** (S2: `[world] dropped behavior on
  node <index>: no object id` — this is how a behaviour whose node lost
  its id to B4 (a)'s healing goes) or when the value fails F1 with `ownId`
  = the node's id (`[world] dropped malformed behavior on node <index>:
  <code>`). Beyond the 64th behaviour node in document order, `behavior`
  is set to `null` with `[world] dropped behavior on node <index>: over
  the world limit`.
- **The election rule (F-L6):** at `hello` and in `handOverScriptHost`,
  a candidate needs `canEdit` **and** `session.capabilities.scriptRunner
  === 1`. `hello.client.json`: `capabilities.scriptRunner`, an integer
  `const 1`, optional. Nothing else in E4 changes; `hostGen` rules stand.
- **Nothing is rate-limited on the server in this round.** The runner's
  cap (F5) is the limit; `RATE_LIMITED` stays unsent. (4c adds the server's
  limits with `activate`.)

### F3. The vendored engine, in Node and in the page (F-L11)
- The two packages, `NOTICE`, `VENDORED.md` with hashes, the workspace
  globs; `pnpm install` links them. `apps/client/index.html`'s import map
  gains `@khronosgroup/gltf-interactivity-engine` and `gl-matrix` (local
  paths); `tools/som-inspector` and `apps/playground` only if the guard
  needs it (nothing they load imports the engine). `importmap-guard` stays
  green. **The harness's `setup.sh` needs no change:** the entries are
  local paths.
- **A test imports the engine in Node and in a jsdom-free way:**
  `validateInteractivityExtension`, `validateInteractivityGraph`,
  `BasicBehaveEngine`, `ADecorator`, `GraphRejectedError` resolve, and the
  spike's `t4` result (187/187) is reproduced as a test over a checked-in
  copy of the Khronos `invalid` index **of the 4b-2 subset only** (F11).
- **A browser smoke test** (§5.1 check 1): the engine loads through the
  import map and runs the "every N seconds" template in a page.

### F4. The adapter (`packages/behaviors`, renderer-neutral)
`createBehaviorEngine({ graph, nodeMap, animations, proximity, interval,
world, now, setTimeout, clearTimeout, log })` returns `{ tick(),
select(index), proximity(positions), dispose() }` and owns **one engine
per behaviour per load** (§9.2). **It loads with `loadBehaveGraph(graph,
false)`** (S3): `true` would run the queue at once and start the engine's
own `setTimeout` loop (§2.3). `world` is the adapter's view of the SOM: `get(index,
field)`, `set(index, field, value)` (returns `false` when refused),
`lightIntensity(index)` / `setLightIntensity(index, value)`,
`play(object, clip, loop, speed)`, `stop(object, clip)`, `worldPosition(index)`.
- **The event bus** is the spike's `NodeEventBus` shape on `EventTarget`
  (the engine's `DOMEventBus` needs `document`), owned by the adapter, with
  `dispose()` clearing its interpolation maps and listeners after the
  engine's own `dispose()`.
- **The decorator:** registers pointers **only for `nodeMap` indices**
  (translation, rotation, scale, visibility per node index; light
  intensity per index whose node hosts a light — the adapter asks
  `world.hasLight(index)`), so any other pointer resolves nowhere and
  takes `err` (S3). `getParentNodeIndex(i)` returns the `nodeMap` index of
  the SOM parent when the parent is in `nodeMap`, else `undefined`.
  `getWorld()` returns `{ nodes: nodeMap.length entries, animations:
  animations.length entries }` so `animation/*` resolves (`t6` item 3).
- **Authority (design §5.3):** every setter checks that the target index's
  object is the behaviour's own node or a descendant of it **in the SOM**,
  or that its id is in `targets`; otherwise it **refuses, logs once per
  (behaviour, index, field) and returns** — never throws (S3). The check
  is by `objectId` through `resolveObjectId`, so a rename is followed and
  a shadowed or ambiguous target is refused as `unaddressable` /
  `ambiguous`. A refused `pointer/set` continues on `out` (S3): the log
  line is what tells the owner.
- **`animation/start` → `world.play(object, clip, loop, speed)`** with the
  table entry at the resolved index and the graph's literal `speed`; the
  graph's `startTime` and `endTime` are ignored (4a's leaf has no end time;
  `done` never fires in 4b-2, documented in the template form's help).
  `animation/stop` → `world.stop(object, clip)`. The object must be the
  own node or in `targets`, by the same check. **The clip is checked
  against the model's `clipIds` only when the host's instance is
  `loaded`** (S7: `clipIds` exist once `model-bridge` has built the
  instance, asynchronously; before that, or on a `failed` model, the write
  goes out as the server's rule allows, and a stale clip is the viewers'
  `clip-missing` state as in 4a). The form's picker is what guarantees a
  real clip.
- **The step budget:** `engine.processNodeStarted` set **on the engine**
  (S1) throws past **10,000 steps per tick**; the tick wrapper catches it
  and **disposes the engine** with reason `over-budget` (S5: a parked
  engine would keep its mid-throw state and whatever it scheduled); the
  runner drops the behaviour's pending sends and reports the reason. A
  re-enable is a reload (dispose-then-create). The budgeted `flow/while`
  and `flow/for` subclasses (`t1c`) are installed on every engine even
  though F-L4 refuses those ops, with their own test.
- **No cycle check** (Rev 1): F1's validator refuses every back edge, so a
  stored graph is a DAG in index order (§2.3). The tick wrapper still
  catches a stack overflow as it catches any throw, and disposes.
- **No `flow/setDelay`** (Rev 1, M2): the only timers in the round are the
  adapter's own. **`interval`:** with `interval.seconds` in the value, the
  adapter schedules one timer with the injected `setTimeout`, first firing
  after `seconds`, then every `seconds`, each firing dispatching
  `KHR_INTERACTIVITY:atrium/interval` so the graph runs on the next tick;
  `dispose()` clears it with the injected `clearTimeout` before
  `engine.dispose()`. Tests use fakes.
- **Ticks:** `tick()` runs `executeEventQueueTick()` once; nothing in the
  adapter schedules a tick, and a disposed engine is never ticked (S2).
- **`select(index)`** calls `engine.select(index, 0, undefined,
  undefined)`. **`proximity(positions)`** takes the avatar world
  positions for this frame, keeps the occupancy flag, and dispatches
  `KHR_INTERACTIVITY:atrium/enter` / `atrium/exit` on the transitions
  (F-L7); with no `proximity` in the value it does nothing.
- **`debug/log`** goes to `log(severity, message)`; the message is cut to
  200 characters.
- **Rejection is a reason, not a throw:** `GraphRejectedError` from
  `loadBehaveGraph`, a failed `validateInteractivityGraph` and F1 all
  surface as `{ problem, message }` from a pure `loadBehavior(value)` the
  runner and the form share.

### F5. The runner (`AtriumClient` and `packages/behaviors`)
- **`client.sendField(name, field, value)`** (new, `AtriumClient`): a
  tracked `send` (`type: 'send'`, `applyEcho: true`) with **no local
  apply**, returning the seq; **its own echo applies the broadcast value**
  through `applyLocally` + `setPath`, then `som:set`, then
  `edit:accepted` — the Z2a pattern, generalized to edits that ask for it
  (P9). A rejection changes nothing. The Edit panel's path (P9) is
  untouched.
- **The runner** (`createBehaviorRunner({ client, now, frame })`) lives in
  `packages/behaviors` and is wired in `app.js`:
  - **It is enabled only while all three hold:** `client.scriptHost.active`,
    `client.canEdit`, and the current connection's world has loaded
    (`world:loaded` seen after the `hello` that granted the role, P11). It
    re-evaluates on `script-host:changed`, `world:loaded`, `connecting`
    and `disconnected`. **On `active: false` it disposes every engine
    synchronously** in the same tick — E6's invariant is what makes that
    enough — and drops every pending send.
  - **One engine per behaviour node per load:** it scans saved nodes with a
    `behavior` on enable, and follows `som:set` of the leaf, `som:add`,
    `som:remove` and `som:rename` (a rename changes nothing: ids are the
    key) to load, reload or dispose. A reload is dispose-then-create,
    never `loadBehaveGraph` in place (S2).
  - **A behaviour is disabled** (its engine disposed, S5, with a reason
    the panel shows) when: `enabled: false`; F1 fails (`invalid:
    <code>`); the engine rejects it (`rejected: <message>`); `nodeMap[0]`
    doesn't resolve to the node (`not-found`, `ambiguous`,
    `unaddressable`); the budget is exceeded (`over-budget`); the send cap
    is hit (`over-send-cap`). Other `nodeMap`, `targets` or `animations`
    entries that don't resolve disable it with `target-not-found: <index>`
    **at load**, and a write whose target stops resolving later is refused
    and logged (F4). **Every disable is a `dispose()`; a re-enable is a
    reload.** The scan and the listeners skip avatars
    (`extras.atrium.ephemeral`, N6: live avatars are saved nodes in the
    SOM's sense).
  - **Ticks:** once per rendered frame from `app.js`'s `tick()` (P8),
    after `modelAnimations.update()` and before `stage.tick`. The
    proximity pass runs first, with the local avatar's world position and
    every peer avatar node's.
  - **Sends are coalesced per `(objectId, kind, field)`** — kind: node,
    light or animation — in one map for the world, and flushed **at most
    20 per second per world** (a 50 ms interval; the newest value per key
    wins). **The name is resolved at flush** through `resolveObjectId`
    (the light's qualified name from the host node's name), so a rename
    between enqueue and flush is followed (S6; F12's "resolved from an id
    at the moment of sending"); a key that no longer resolves is dropped
    and logged. The map holds **at most 100 keys**; a behaviour whose
    write would add the 101st is disabled with `over-send-cap`. Each flush
    calls `sendField` (node fields, light fields under the qualified name)
    or `setModelAnimation` (play/stop).
  - **The drag rule (F-L5):** `app.js` tells the runner the edited node
    (`setGesture(nodeName | null)`); while set, a send whose target is that
    node, a descendant or an ancestor is dropped and logged once per
    gesture.
  - **`select` comes from the viewport, not the SOM** (M3): `app.js`'s
    viewport `click` handler gets a sibling branch for `!modes.edit` —
    `e.target === canvas`, `pressDown` and `isSelectClick` (the 4 px slop
    and button 0 of `edit-selection.js` L11–26), the same hit resolution
    as `pickEditTarget` — which calls `runner.select(somNode)`. The runner
    resolves the node up its SOM ancestors to the first behaviour node and
    calls that engine's `select(0)`. A SOM `click` (P6) fires on any
    button and any distance (a look-drag that starts and ends on the same
    object), so it isn't used; and the runner, renderer-neutral, never
    knows Edit mode itself.
  - **The log:** a ring of the last 50 lines per world (`[time] [node]
    message`), exposed as `runner.log` and an `entry` event; the panel
    shows the selected node's lines and the console gets them all.

### F6. The renderer honours `visible` (F-L8)
- `renderer-three`: on a node's `visible` mutation and at view creation,
  the node's view object gets `Object3D.visible`. **A placed model's
  wrapper is a child of the host node's view object** (`model-bridge.js`
  `attach`, L799), so three's inheritance hides it with the node (N9); the
  bridge re-applies the host's visibility only on a re-host after a view
  change, not through a second path. `PointerInputBridge._hitTest` and
  `pickEditTarget` **filter the hit list** to objects with no invisible
  ancestor and take the first that remains (S10: `hits[0]` today, L102–104)
  **unless** the caller passes `includeHidden: true`, which `pickEditTarget`
  does in Edit mode.
- **A visible change the regression run must look at:** first person sets
  `avatar.localNode.visible = false` (`app.js` L2701), a no-op today; after
  F6 the own capsule really disappears in first person and comes back in
  third (through the SOM). That's the intent; §5.1 check 9 watches it.
- The Edit panel's **Visible** checkbox (`#ep-visible`): writes `visible`
  through `writeSend` like any node field, disabled while a write to that
  node is in flight.

### F7. Limits (the numbers)
| What | Limit | Counted where |
|---|---|---|
| Behaviour bytes | 16,384 (`JSON.stringify`) | server and client (F1) |
| Graph nodes / declarations / types / events / variables | 64 / 32 / 16 / 8 / 0 | F1 |
| `nodeMap` / `targets` / `animations` | 1–16 / 0–16 / 0–8 | F1 |
| Behaviour nodes per world | 64 | server (F2), healing |
| Steps per tick per behaviour | 10,000 | adapter |
| Interval | 1–3,600 s, one adapter timer per behaviour | F1, adapter |
| Sends per world | 20 per second, coalesced per field | runner |
| Pending send keys per world | 100 | runner |
| Log lines kept | 50 per world | runner |
| Proximity radius | 0.5–50 m | F1 |

### F8. The five templates (D3: standard graphs)
Each template is a pure function `templateGraph(id, params) → { graph,
nodeMap, targets, animations, proximity, interval, template }` in
`packages/behaviors/src/templates.js`, and the form's only way to write a
behaviour. **`nodeMap[0]` is always the own node.** `types` is the
engine's standard table for the types used (`bool`, `int`, `float`,
`ref`), never empty; `variables` is absent; `events` is present only in
the two templates that declare one. **`event/onSelect` is declared with
`extension: 'KHR_node_selectability'`** and configured `nodeIndex: 0`,
`stopPropagation: false` (S9). Pointer templates are `[n]` with `n` an int
literal (M1). Sockets and `configuration` names are the engine's; `r1`
runs every template through the validator and is the test F8's row
becomes.

| Id | Params | Graph (declarations in flow order) | Maps |
|---|---|---|---|
| `select-visibility` | `target` (objectId), `action`: `show` / `hide` / `toggle` | `event/onSelect` → for `show`/`hide`: `pointer/set` `/nodes/[n]/extensions/KHR_node_visibility/visible`, `n = 1` (int), the literal; for `toggle`: `pointer/get` the same pointer → `math/not` → `pointer/set` | `nodeMap = [own, target]`; `targets = [target]` unless the target is in the own subtree |
| `select-animation` | `target` (a model: own or another), `clip`, `action`: `play` / `stop`, `loop` | `event/onSelect` → `animation/start` (`/animations/0`, `startTime 0`, `endTime 3600`, `speed 1`) or `animation/stop` (`/animations/0`) | `nodeMap = [own]` (+ `target` when not own); `animations = [{ object: target, clip, loop }]`; `targets` as above |
| `proximity-animation` | `target`, `clip`, `loop`, `radius` | `event/receive` (`atrium/enter`) → `animation/start`; `event/receive` (`atrium/exit`) → `animation/stop` | as above, plus `proximity: { radius }` and `events: [{ id: 'atrium/enter' }, { id: 'atrium/exit' }]` |
| `select-light` | `target` (a light host) | `event/onSelect` → `pointer/get` `/extensions/KHR_lights_punctual/lights/[n]/intensity`, `n = 1` (int) → `math/gt` (`b = 0`) → `flow/branch` → true: `pointer/set` intensity `0`; false: `pointer/set` intensity `I` (the light's intensity when the form saved, a literal, at least 0.01) | `nodeMap = [own, target]`; `targets = [target]` |
| `interval-animation` | `target`, `clip`, `loop`, `seconds` (1–3600) | `event/receive` (`atrium/interval`) → `animation/start` (M2 (a): the adapter's timer dispatches the event every `seconds`) | as `select-animation`, plus `interval: { seconds }` and `events: [{ id: 'atrium/interval' }]` |

- **The own node as a target** (`select-animation` on a model that is the
  behaviour node itself): `nodeMap = [own]`, `animations[0].object =
  own`, no grant needed.
- **The light template needs a world with a light** (P4). DEV acceptance
  uses a saved world made from `space-lights.gltf`; the form's target picker
  lists only light hosts for this template, and says "This world has no
  lights" when there are none.
- **A toggle reads the host's SOM, which the echo updates:** two clicks
  within one round trip both read the old value and collapse to one
  change (the coalesced send wins). Correct, and the template's help says
  "one click per change" so nobody double-clicks (N7).

### F9. The Edit panel's Behaviour section (the owner's view)
- **Markup** in `index.html` under the animation rows, inside `#ep-fields`:
  `#ep-behavior-row` (a `<select>` of "None" and the five templates by
  their display names: "On select: show or hide", "On select: play or
  stop an animation", "On enter: play; on exit: stop", "On select: toggle
  a light", "Every N seconds: play"), `#ep-behavior-params` (the template's
  fields), `#ep-behavior-actions` (Enabled, Save, Remove),
  `#ep-behavior-status`, `#ep-behavior-log` (a `<details>` with the last
  lines for this node), and `#ep-visible` (F6) on the transform rows.
- **A pure module** `apps/client/src/behavior-form.js`,
  `createBehaviorForm({ elements, deps, gate })` in the model-form pattern
  (P-fact: `createModelForm` returns `wire/open/close/render/save/onAnswer`),
  with deps `selected`, `status`, `write` (the two client calls),
  `targets()` (the saved, addressable nodes with their ids and kinds —
  models with their `clipIds`, light hosts), `render`, `showError`,
  `clearError`, and `log`.
  - **The target picker** is a `<select>` of node names (ids never appear,
    design §4.9), filtered per template (any node; models; light hosts).
    A node without an id is listed too: **Save gives it one first**
    (`setObjectId`, awaited), then the own node, then writes the leaf.
    Three writes at most, one at a time, each through `edit:accepted`;
    a refusal stops the sequence and shows the server's text.
  - **Save writes `templateGraph(id, params)`;** Remove writes `null`;
    Enabled toggles `enabled` by rewriting the value with the flag
    flipped. A behaviour without `template` (4d's imports) shows "Custom
    graph" with Enabled and Remove only.
  - **The status line:** "Running" / "Disabled: <reason text>" / "Not
    running: this tab isn't the script host" / "Behaviours run in another
    tab; clicks here don't trigger them" (a non-host owner tab, F-L9) /
    "Saving…". **Under it, once:** "Behaviour changes are saved with the
    world and aren't undone by Undo." (D4, F-L5.)
  - **The host line (E8) changes for the host only:** "Script host: this
    tab (behaviours run here)". The other-tab text is unchanged.
- **Answers** go through the `edit:accepted` / `edit:rejected` /
  `edit:unknown` handlers (`app.js` L2534–2550) as the animation controls'
  do; the form resets on `connecting`, `disconnected` and `beginNewWorld`;
  `refreshModelRow`'s neighbour `refreshBehaviorRow` renders it on
  selection and on `som:set` of the leaf.

### F10. Duplicate and Undo (F-L10)
- `prepareDuplicate` remaps the copy's self-references (every
  `nodeMap`/`targets`/`animations[].object` entry equal to the original's
  id → the new id) and keeps the rest. `atriumProblem` checks `behavior`
  with F1 (`ownId` = the node's id) and refuses "its behaviour is
  malformed". `prepareRestore` changes nothing.
- A re-add refused by F2's checks is reported as any refused re-add
  (`failEntry`).

### F11. Conformance (S5) and the probes as tests
- **The Khronos assets, restricted to the subset:** a script
  (`packages/behaviors/scripts/conformance.mjs`, run by a test when
  `KHRONOS_ASSETS` points at a checkout at `926bec45`) runs every
  conformance asset whose declarations are all in F-L4's list through
  the real adapter with a fake world and reports pass/fail; the expected
  list is checked in and must match exactly. The invalid-graph index is
  run the same way (F3).
- **The malicious-loop probes against the real adapter** (§9.2's gate):
  `t1`'s four cases, `t1b`, `t1c` and `t2` (a), (c) and (d) rewritten as
  tests of `createBehaviorEngine` with the op allowlist and the validator
  **bypassed** (a test-only option), so the budget, the subclasses and the
  cleanup are proven on their own; `t2` (b) becomes the reload test (F5).
  `r1` is F8's validator test; `r2` pins that `[n]` is what the runtime
  resolves for an int.

### F12. What doesn't change
- Names stay the protocol's identifiers; every runner write is a `send`
  by name, resolved from an id at the moment of sending.
- 4b-1's E1–E9, except the election rule (F2) and the host line's text for
  the host (F9).
- The undo engine, the structure tracker, the model and teleporter forms,
  the library, the sky, the SOM Inspector and the playground, apart from
  import-map entries if the guard needs them.
- `activate`, rate limits on the server, `hover`, `change`.

## 5. Tests

| Item | Tests | Proof of failure |
|---|---|---|
| F1 | The vectors file read by both copies: every template's canonical output accepted **by both copies and by `validateInteractivityGraph`**; every code with a boundary pair; a `{n}` pointer refused; a socket-connected index; `variables: []`; `events: []`; a bare `event/onSelect`; a disallowed op; a pointer with an index at `nodeMap.length`; `atrium/interval` without `interval`; a `__proto__` key in `template.params`; depth 9; `kind: 'js'`; a 16,385-character value | (a) accept `flow/while` in one copy only; (a2) accept `{n}` in one copy only |
| F2 | server, port 0: an owner `send` of a valid leaf on a node with an id is accepted, broadcast, saved; refused `INVALID_FIELD` on a node without an id; refused `INVALID_VALUE` with F1's text for each code (a sample of six); `null` accepted; the 65th behaviour node refused and **nothing changed, no broadcast, no autosave**; **at 64, the 64th node's behaviour can be rewritten and toggled** (S1); `add` with a valid behaviour and id accepted, with a malformed one refused, with a behaviour and no id refused; **load:** a malformed behaviour dropped to `null` with the log line, a behaviour on a node with no id dropped (including one whose id was healed away), the 65th dropped; the saved document has the `null`s. **Election:** an owner `hello` without `scriptRunner` gets `scriptHost: false` and is never handed the role; with it, the E4 tests still pass; a `hello` with `scriptRunner: 2` is refused by the schema | (b) skip the own-id check; (b2) drop the 64 cap; (b3) elect without the capability |
| F3 | The engine resolves in Node by its bare name; the hashes in `VENDORED.md` match the files (a test computes them); the invalid index subset is 100% rejected; the import map has both entries and the guard is green | (c) change one byte of the vendored file (the hash test fails) |
| F4 | `createBehaviorEngine` with a fake world and fake timers: **authority:** a write to the own node, a descendant and a granted target applies; to an ungranted node, a renamed-away target (through a fake `resolveObjectId` returning `unaddressable`) and an index past `nodeMap` it is refused, logged once, and the graph continues on `out`; a throwing world setter is wrapped (the tick survives); **animations:** `animation/start` calls `play` with the table entry and the literal speed, `stop` calls `stop`, an index past the table takes `err`, a clip not in `clipIds` is refused; **budget:** `t1`'s three bounded cases dispose the engine at 10,001 with `over-budget`, and a tick afterwards throws; `t1b`'s and `t1c`'s cases stop through the subclasses (allowlist bypassed); a `sequence → sequence` cycle loaded with the allowlist and validator bypassed overflows and is caught and disposed; **interval:** with fake timers, `atrium/interval` is dispatched first after `seconds` then every `seconds`, the graph runs on the next tick, and `dispose()` clears the timer with the injected `clearTimeout` before `engine.dispose()`; `dispose()` also clears interpolation maps and listeners, and a tick after dispose throws; `t2` (b)'s reload leaves nothing live because a reload is dispose-then-create; `loadBehaveGraph` is called with `false`; **events:** `select(1)` on a child reaches `onSelect` on index 0; `proximity` fires `enter` once for two avatars inside and `exit` once when both leave; `debug/log` reaches `log` cut to 200 characters | (d) set the hook on the decorator, not the engine (the budget counts 0); (d2) park the engine on `over-budget` instead of disposing (the timer still fires); (d3) refuse by throwing (the tick dies); (d4) load with `runGraph` true (the fake-timer test sees the engine tick itself) |
| F5 | client, fake socket: `sendField` sends the exact message, tracks the edit, changes nothing before the echo, applies the broadcast value on the echo then `som:set` and `edit:accepted`; a rejection changes nothing; the Edit panel's mutation path is unchanged (an existing test still passes). **The runner** with a fake client: enabled only with the role, `canEdit` and a loaded world, in each order; `active: false` disposes every engine before the test's next line; a reload on `som:set` of the leaf is dispose-then-create; disabled reasons for each case; **coalescing:** 30 writes to one field in one frame send once; 25 distinct keys in one frame send 20 then 5 at the next flush; the 101st key disables its behaviour; **a rename between enqueue and flush** sends to the new name (S6); **the drag rule:** with `setGesture('crate')`, sends to `crate`, its child and its parent are dropped and logged once, others pass, and nothing is replayed on `setGesture(null)`; **select:** `runner.select` on a model's inner node reaches the behaviour on the placed object; avatars are never scanned or listened to; **three rapid world switches** leave no engine alive (E6's test, extended). **In `app.js` (wiring guard and a DOM-free test of the branch):** a press-and-release 10 px apart on the behaviour node triggers nothing, a right-click triggers nothing, a 2 px click with Edit mode off calls `runner.select`, and with Edit mode on selects instead (M3) | (e) tick after `active: false` (the engine is still alive); (e2) apply the value locally before the echo; (e3) replay dropped sends after the gesture; (e4) take `select` from the SOM `click` (the 10 px case fires) |
| F6 | renderer-three: a `visible: false` mutation hides the node's object and a placed instance (through the wrapper's parent); `true` shows them; **a hit on a hidden object in front of a visible one returns the visible one** unless `includeHidden` (S10); the Visible checkbox writes `visible` through `writeSend` and is disabled in flight | (f) ignore `visible` in the bridge; (f2) filter hidden hits in Edit mode too; (f3) return `null` instead of the next hit |
| F8 | `templateGraph` for each id and each `action`/`loop` variant passes F1 **and `validateInteractivityGraph`** (`r1`'s cases, as a test), and **runs**: through `createBehaviorEngine` with a fake world, `select-visibility` hides, shows and toggles; `select-animation` plays and stops; `proximity-animation` plays on `enter` and stops on `exit`; `select-light` sets 0 then `I`; `interval-animation` plays every `seconds` with fake timers and stops on dispose | (g) drop `nodeMap[0]`'s own id (the server refuses every template); (g2) spell a pointer `{n}` (the validator refuses it) |
| F9 | `behavior-form` without a DOM: Save on a node without an id sends `setObjectId` first and the leaf only after `edit:accepted`; a refused id stops the sequence; Remove sends `null`; Enabled rewrites with the flag; a `template`-less value shows "Custom graph"; the status texts for each runner state; the picker filters per template; the light template with no lights. Wiring guards in `app.js` for the answer routing, the resets and `refreshBehaviorRow` | (h) write the leaf before the id is answered |
| F10 | `edit-duplicate`: a copy's self-references are remapped and a grant to another object is kept; a malformed behaviour refuses with the new text; `prepareRestore` keeps the value | (i) keep the original's id in the copy's `nodeMap` |
| F11 | the conformance subset's expected list matches; the probes-as-tests pass | (j) widen the allowlist in the subset filter (new assets appear and the list mismatches) |
| F-L12 | 4a's items 1, 2, 3 and 5 each get the test the 4a passdown §6.1 describes; `_scriptHostRoleWarned` resets on a second `hello` | (k) keep the pick after another session's playing value changes |

**Proofs:** commit first; break the file, run, record the failing test
names, restore the file **from a saved copy, never with `git checkout`**,
re-run green. "Not reproducible" is not an acceptable result.

### 5.1 Claude's browser checks (after publish, before DEV acceptance)
In the harness (`devtasks/harness/`, new `checks/scripting-4b-2/`):
1. **The engine loads through the import map** in the page, no console
   error; `interval-animation` on a placed `Fox.glb` plays every 2 s (the
   animation leaf is seen in another tab's SOM at each start).
2. **Each template, in the host tab with Edit mode off:** a click on a cube
   hides a second cube, and visitors' tabs stop drawing it; a click plays
   and stops the Fox; walking into a 3 m radius plays, walking out stops
   (with a second avatar inside, leaving doesn't stop it); a click toggles
   `Sun` in the lights world.
3. **The owner's own tab in Edit mode:** a click selects and triggers
   nothing; the hidden cube is selectable and its outline shows; the
   Visible checkbox brings it back.
4. **Two owner tabs:** the non-host tab shows "Behaviours run in another
   tab; clicks here don't trigger them" and its clicks do nothing; closing
   the host tab moves the role and the behaviours resume in the other
   within one frame of `script-host:changed`; the old tab's runner
   disposed before `connecting` (E6's invariant, observed through the log).
5. **A 4b-1-style tab** (a `hello` without `scriptRunner`, sent through
   the page's console) never becomes host while a 4b-2 tab is open, and the
   next 4b-2 `hello` does.
6. **The drag rule:** dragging the target cube while a behaviour toggles
   it drops the behaviour's send (the log line), and the cube stays where
   it was dropped.
7. **Limits on DEV code:** the 65th behaviour is refused with the message,
   and the 64th can still be toggled; a hand-made graph with `flow/while`
   is refused by the server with F1's `behavior-op` text; a graph with a
   `sequence → sequence` cycle, written through `sendField` from the
   console, is refused by the server with the validator's message ("output
   flow must point to a later node"); a `{n}` pointer is refused with
   `behavior-pointer`.
8. **Saved:** restart the world server from its saved document; the
   behaviours are there and run; a hidden cube is still hidden.
9. **Regression:** 4b-1's §5.1 checks, 4a's, library-sky's and
   edit-polish-3's; **and first person:** the own capsule now disappears
   on `V` and returns on the second `V` (F6's one visible change to
   existing behaviour).

## 6. DEV acceptance (operator, Firefox, hard reload, owner)
1. **In an owned world with a placed cube and a library model:** select the
   cube, Behaviour → "On select: show or hide", target the model, action
   "toggle", Save. Leave Edit mode. Click the cube twice: the model
   disappears and comes back. Open a private window as a visitor: it sees
   the same.
2. **Select the model, "Every N seconds: play", clip, 3 seconds, Save.** It
   plays every 3 s in both windows.
3. **"On enter: play; on exit: stop" on the model, radius 3.** Walk the
   avatar up to it and away. With the visitor window's avatar left inside,
   walking away doesn't stop it.
4. **The lights world** (a saved world from `space-lights.gltf`): a cube
   with "On select: toggle a light" on `Sun`. Click: dark; click: light.
5. **Edit mode on:** the model that is hidden by step 1's toggle can be
   selected; its outline shows; the Visible checkbox shows it. Dragging the
   cube while clicking does nothing surprising.
6. **A second signed-in tab:** its Behaviour section says behaviours run in
   another tab; its clicks don't trigger. Close the first tab: the second
   takes over and step 2's interval continues.
7. **Reload:** everything is as left; the hidden model stays hidden until
   step 5 is repeated.

## 7. Worker rules and release path
As scripting-4b-1 (`devtasks/KICKOFF-scripting-4b-1.md`), with this round's
specifics:
- **Steps, one commit each:**
  1. F1 (both copies and the vectors), F2 (the SOM path, the server's leaf
     and `add` checks, healing, the election rule and the schema);
  2. F3: vendoring, `NOTICE`, `VENDORED.md`, the Node and hash tests, the
     import-map entries;
  3. F4: the adapter and its tests, the probes as tests (`t1`, `t1b`,
     `t1c`, `t2` (a), (c), (d), `r1`, `r2`), the conformance subset (F11);
  4. F5: `sendField`, the runner, its tests;
  5. F6: visibility in the renderer and the Visible checkbox;
  6. F8–F10: the templates, the form and panel, Duplicate;
  7. F-L12's items, full suites, proofs (a)–(k) with every sub-proof, and
     the handoff.
- **`--max-runtime 4h`.**
- **A protocol and server round:** DEV restarts at the deploy.
- **Both outside reviews:** this pre-brief (done once, on Rev 0.1; Rev 1
  applies it), and the whole round from base to tip after the GLM review,
  with the compare URL and any correction comments (4a passdown §4.2).
- **The front door, the kickoff and the release chain:** the 4a passdown's
  §4.4–§4.5 rules; build the whole chain at the review gate's APPROVE;
  **nothing is pushed to `main` between the release merge and the MAIN
  push.**

## 8. Notes for the brief author
- **The server imports the vendored engine.** `validateInteractivityGraph`
  is a pure function over JSON; it doesn't touch the DOM. Import it from
  the bare name in `send-policy.js`'s F1 copy (the workspace link resolves
  it). Keep the import at the top, so a broken vendoring fails every server
  test at load, not at the first behaviour.
- **F1 runs before `setPath`** in both the `send` and `add` paths, like
  the animation and `objectId` checks, and F2's 64 cap is the handler's.
  **F1's own rules run before the validator** (the forbidden-key and
  depth walk first of all), so the validator never sees a value F1
  refuses, and a vector's reason code is deterministic.
- **The validator, not the loader, is the gate** (§2.3). Every template
  test and every vector must go through `validateInteractivityGraph`; a
  test that only calls `loadBehaveGraph` proves nothing about what the
  server accepts.
- **Autosave with an interval behaviour:** the 30 s debounce restarts on
  every mutation (`autosave.js` L15–28), so an interval at N ≤ 30 s never
  lets it settle and the 60 s periodic path saves once a minute for as
  long as the host tab is open (the animation leaf's `startedAt` changes
  each fire). That's expected, not a bug (N5).
- **`getParentNodeIndex` is what makes `select` reach a behaviour from a
  click on its child object,** and `nodeMap` rarely holds the parent. The
  runner does the SOM ancestor walk (F5) and calls `select(0)`; the
  engine's own walk is only a second safety net.
- **The own echo for `sendField`** is a flag on the tracked edit, read in
  `_resolveOwnSetEcho` beside the three field cases. Don't widen the
  generic mutation path (P9): the Edit panel relies on applying first.
- **The runner must not keep an engine across `script-host:changed
  active: false`,** not even for a re-grant in the same tick. Dispose,
  then create on the next grant. E6's tests show the order of events; F5's
  tests pin it for the runner.
- **Visibility and models:** `model-bridge` creates instances
  asynchronously (4a passdown §4.7). Apply the host node's `visible` on
  every attach, and again on `refreshPlacedInstance`.
- **The light template's literal `I`** is read from the SOMLight at save
  time. A light saved at `intensity: 0` gets `I = 1`: the form says so in
  its help text.
- **`t6` isn't committed.** If the brief wants it beside the spike, it goes
  into `devtasks/spike-4b/` with the README's table updated (a `devtasks/`
  only commit, before the kickoff).

## 9. Next rounds
- **4c — visitors' `activate`:** the message and schema, the server's
  checks (an enabled behaviour that listens for `select`, distance,
  5 per second per session and 20 per world, a host present), forwarding
  to the current `hostGen` only, the visitor's click path, and the
  non-host owner tab's clicks through the same route (F-L9). The runner's
  `select` already takes an index; 4c adds the forwarded source.
- **4d — graphs beyond the templates:** the op allowlist widens (F-L4 (b))
  with the budgeted loops already in place; `flow/setDelay` returns with
  a subclass that owns its timers (§2.3's rule) and a pending-delay cap;
  `event/onTick`; `pointer/interpolate` with the interpolation-map cleanup
  the spike demanded; the converter (which rewrites `[n]` indices against
  `nodeMap` and the lights-pointer convention of F-L2) and the
  unsupported-node report; `KHR_animation_pointer` models (4b-1 passdown
  §6.3); 4a's item 4 if a polish round hasn't taken it.

## 10. Review log
- **Rev 0** (2026-10-24, `b1e159ac`): drafted by Claude from the 4b
  pre-brief §9 and B6, the design, the step 4 pre-brief, the two passdowns,
  code reading at `a246f80c`, the spike rerun (§2.3) and the new probe
  `t6`. Open: F-L1–F-L12.
- **Rev 0.1** (2026-10-24 17:42 PT, `28c7288`): the operator approved
  F-L1–F-L12 as recommended. Only the status line changed.
- **Rev 1** (2026-10-24, evening PT): an outside review of Rev 0.1
  (`devtasks/REVIEW-scripting-4b-2-rev0.1.md`, read-only against the
  clone at `28c7288`; "revise before the kickoff"). Claude checked each
  finding against the engine (`parsePathTemplate` L533, the flow rule
  L11933, the schema L9341–9393, L11908, L8533–8535) and the code
  (`app.js` L2661–2679, `edit-selection.js` L11–26, `send-policy.js`
  L553–596, `edit-duplicate.js` L23, `SOMDocument.js` L1080–1082,
  `model-bridge.js` L799, `PointerInputBridge.js` L102–104, `autosave.js`
  L15–28), and reran `r1` and `r2`. All are taken.

| # | Finding | Severity | Where it went |
|---|---|---|---|
| M1 | `{n}` is a `ref` socket; the int index socket is `[n]`; F1/F8 as written refuse three templates | Must-fix | **Confirmed by `r1`/`r2`.** §2.3; F1 `behavior-pointer` (`[n]`, `{…}` refused outright); F8; vectors; proofs (a2), (g2) |
| M2 | The validator forbids every back edge; the interval self-loop can never reach a world; the cycle check is unreachable | Must-fix | **Confirmed by `r1`.** The reviewer's (a): F-L2 `interval`, F-L4 (no `flow/setDelay`, no `event/onStart`), F-L7, F1 `behavior-interval`, F4 (no cycle check, the adapter's one timer), F7, F8 row 5, §5.1 check 7, §9 (4d) |
| M3 | A SOM `click` has no slop or button rule: a look-drag or a right-click triggers the behaviour | Must-fix | Confirmed (`app.js` L2661–2679; `AtriumClient.js` L319; `edit-selection.js`). F5 `select` from the viewport click with `isSelectClick`; tests and proof (e4) |
| M4 | `variables`/`events` have `minItems: 1`; F-L2's shape with empty arrays fails the schema | Must-fix | **Confirmed by `r1`.** F-L2's shape; F1 `behavior-size`; F8; vectors |
| S1 | The 64 cap refuses a rewrite or toggle at 64 | Should-fix | F2 (count other nodes); test |
| S2 | Healing doesn't drop a behaviour on a node with no own id | Should-fix | F2 healing (no id → `null`, its own log line); test |
| S3 | `loadBehaveGraph(graph, false)` must be pinned | Should-fix | §2.3, F4; proof (d4) |
| S4 | The engine's `setDelay` uses the global timers; "injected" needs more than a subclass | Should-fix | Moot after M2 (a); recorded in §2.3 and §9 for 4d |
| S5 | `over-budget` must dispose, not park | Should-fix | F4, F5 (every disable is a dispose); proof (d2) |
| S6 | Coalescing keyed by name contradicts resolve-at-send | Should-fix | F5 (keyed by `(objectId, kind, field)`, resolved at flush); test |
| S7 | The clip check refuses while the host's model is loading | Should-fix | F4 (gated on `loaded`) |
| S8 | Forbidden keys and depth, as the document's extras | Should-fix | F1 `behavior-type`; "characters"; vectors; §8 |
| S9 | `event/onSelect` must carry its extension; pin `nodeIndex` and `stopPropagation` | Should-fix | **Confirmed by `r1`.** F-L4, F1 `behavior-op`, F8; vectors |
| S10 | "Drop hidden hits" must take the next hit; first person becomes a visible change | Should-fix | F6; §5.1 check 9; test and proof (f3) |
| N1 | The light pointer indexes `nodeMap`, not a lights table | Nit | F-L2's shape comment; §9 (4d) |
| N2 | Transform pointers aren't used by any template | Nit | F1: kept, with the reason |
| N3 | The "missing intermediate" refusal is unreachable | Nit | F2 reworded |
| N4 | `MAX_ADD_BYTES` exists on the client | Nit | P2 |
| N5 | Autosave never settles under an interval ≤ 30 s | Nit | §8 |
| N6 | Saved nodes include live avatars | Nit | F5 (skip `ephemeral`) |
| N7 | Two clicks in one round trip collapse to one change | Nit | F8 (the help text) |
| N8 | The cycle depth depends on the stack | Nit | §2.3 ("about 4,000") |
| N9 | Model instances inherit the host's visibility | Nit | F6 |
| N10 | Commit `t6`, `r1`, `r2` beside the spike | Nit | Done with this revision (`devtasks/spike-4b/`, README table) |

The P-claims table of the review found every `file:line` holding at
`28c7288`. Nothing changed a decision.
