# Outside review: pre-brief scripting-4b-2, Rev 0.1 (`28c7288`)

2026-10-24, evening PT. Read-only, against the clone, never DEV. Probes were throwaway, in a scratch folder with a fresh install of the pinned engine; nothing was pushed, and nothing on the board or the host was changed.

**Scope, as asked:** F-L1–F-L12 are approved; this is a review of the contract within them (F1–F12, §5, §5.1), whole document, every code claim. No finding below asks a decision to change. Two of them (M2, M4) change the *shape* a decision produces, which is the kind of thing the contract exists to pin.

## Access (step 0)
1. **Repository: OK.** Shallow clone of `https://github.com/joshmaurice/atrium` at `28c7288` (HEAD of `main`). `git diff --stat 8358b043 28c7288 -- . ':!devtasks'` is empty: the code is the released `8358b043`, so the pre-brief's line numbers (at `a246f80c`, the same code) apply unchanged. `git diff --stat b1e159ac 28c7288` is the one file, +20/−3 (the status line, as §10 says).
2. **The engine: OK.** `npm install --ignore-scripts @khronosgroup/gltf-interactivity-engine@1.1.0 gl-matrix@3` in a scratch folder, Node 22.23.4. `build/index.js` is 353,583 bytes, sha256 `23a4604c…2270b6`, one bare import of `gl-matrix`; `gl-matrix` resolved 3.4.4. All as §2.3.
3. **The spike: `t0`–`t3` reproduce `RESULTS.md`** (`t1b` killed by its timeout, as intended). `t4`/`t5` not rerun (the 281 MB assets; F11 makes them a test of the round). **`t6` isn't committed,** so items 1–5 of §2.3 were not rerun as written; my probes `r1`/`r2` (below, uncommitted beside the spike) cover items 4 and 5 and go one step further than `t6` did.

**Every `file:line` claim in P1–P12 was checked and holds.** The P-claims table at the end has the few that deserve a word.

## Verdict
| Item | Verdict |
|---|---|
| **Pre-brief Rev 0.1** | **Revise before the kickoff.** Four must-fixes. Three of them come from one fact the spike never exercised: **`validateInteractivityGraph` — the function F1 runs on the server — is far stricter than `loadBehaveGraph`,** which is what `t0`–`t6` used. As F1 and F8 are written, the server refuses **every one of the five templates** (M4), three of them for a second reason too (M1), and the interval template for a third that no spelling fixes (M2). The fourth (M3) is a click rule. None of the twelve decisions needs to change; M2 removes one piece of F4 and probably moves `flow/setDelay` to 4d, which F-L4 (a)'s own principle asks for. |
| F2, F5, F6, F9, F10 | Sound against the code, with the should-fixes below. E6's invariant does make "dispose synchronously on `active: false`" sufficient: the server never sends `active: false` (no such send in `session.js`), so the role is lost only on the four abandon paths, each of which calls `_releaseScriptHost()` first (L591, L779, L847, L879). |
| §5 proofs | (d2) proves nothing once M2 is taken (the cut edge can't exist); §5.1 check 7's cycle case is wrong as written (M2). The rest hold. |

## Must-fix

### M1. F1/F8: `{n}` is a `ref` socket in this engine; the index socket is `[n]`. As written, the validator refuses `select-visibility`, `select-light` and every `pointer/*` vector
- **Where:** F1 `behavior-pointer` (the three regexes and "the node's literal `n` value for a `{n}` template"); F8 rows 1 and 4 (`n = 1`, an int); F-L4 "every pointer index … is a literal".
- **The engine:** `parsePathTemplate` (`build/index.js` L533–583): a segment `[id]` is `kind: 'index'`, a segment `{id}` is a `ref` socket. The validator (L11974–11986) then does `requireType(socket.id, [kind === 'index' ? 'int' : 'ref'])`. So `/nodes/{n}/…` with `n` an int literal fails with `invalid or missing pointer/set input n`, and `/nodes/[n]/…` with an int passes.
- **Reproduced (`r1`):** the five templates built exactly as F8 says, through `validateInteractivityGraph`: with `{n}` + int, `select-visibility` (hide and toggle) and `select-light` are **REJECTED**; with `[n]` + int, all three are **accepted**; with `{n}` + a `ref` literal `/nodes/1`, also accepted.
- **Why the spike didn't see it:** the runtime is lenient. `r2` loads the hide template in all four spellings (`[n]`+int, `{n}`+int, `{n}`+ref, literal `/nodes/1`) and every one writes `visible=false` to node 1. `t0` and `t3` use `{n}` + int (`t6` presumably too) and only ever call `loadBehaveGraph`.
- **Fix:** F1's regexes become `^/nodes/(\[n\]|\d+)/(translation|rotation|scale)$`, `^/nodes/(\[n\]|\d+)/extensions/KHR_node_visibility/visible$`, `^/extensions/KHR_lights_punctual/lights/(\[n\]|\d+)/intensity$`; the `n` socket is a literal **int**; F8 writes `[n]`. Refuse `{…}` (a `ref` socket) outright — the decorator never registers a ref-shaped pointer. The vectors file gets one `{n}` case (refused) so the two copies can't drift back.

### M2. F8 row 5 / F1 / F4 / §5.1 item 7: the validator forbids every back edge, so the interval template's delayed self-loop can never reach the world, and the cycle check is unreachable
- **Where:** F8 `interval-animation` ("`animation/start --out--> the same setDelay`, the delayed self-loop, `t6` item 4"); F4 "The cycle check, at load" and its cut rule; §2.3 item 5 ("the load-time cycle check stays in the contract"); §5 F4 proof (d2); §5.1 check 7 ("a graph with a `sequence → sequence` cycle … is accepted by the server (it passes F1) and disabled by the runner with `cycle`"); F7's `setDelay` row.
- **The engine:** `validateInteractivityGraph` L11931–11934: `for (const flow of Object.values(node.flows ?? {})) { index(flow.node, nodes.length, …); if (flow.node <= nodeIndex) fail("output flow must point to a later node") }`, and value inputs must reference an **earlier** node (L11923). A graph that passes F1 is a DAG in index order. `loadBehaveGraph` has no such rule (L8446–8536), which is why `t1`'s cycle and `t6`'s items 4 and 5 loaded.
- **Reproduced (`r1`):** the self-loop and the `sequence → sequence` cycle: **REJECTED: output flow must point to a later node**; `loadBehaveGraph` of the same graphs: ok.
- **Consequences:**
  - The interval template as F8 writes it is refused by `authorizeNodeSend`, by `checkAtriumExtras` and by healing; §6 step 2 and §5.1 check 1 can't pass.
  - F4's cycle check and the `done`-socket cut can never fire on a graph the server accepted; proof (d2) is a test of dead code; §5.1 check 7's cycle graph is refused by the server with the validator's text, never "disabled by the runner with `cycle`". The stack-overflow catch in the tick wrapper (t1 case 3, `t6` item 5) is still right as defence in depth, but as a catch, not a check.
- **Fix, the template:** two shapes pass the validator and the F-L4 principle; pick one and write it into F8, F1, F4 and F7.
  - **(a) An adapter event, F-L7's pattern:** `interval: { seconds }` beside `proximity` (F-L2's "Atrium parts beside the graph"), the graph declares `events: [{ id: 'atrium/interval' }]` and is `event/receive → animation/start` (accepted, `r1`); the adapter dispatches `KHR_INTERACTIVITY:atrium/interval` on its own injected timer, first fire after `seconds`, nothing after `dispose()`. F1: `behavior-event` admits `atrium/interval`; `behavior-interval` (present ⇔ the graph declares it; `seconds` finite in 1–3600). **Then no template uses `flow/setDelay`, and under F-L4 (a) it leaves the allowlist with its whole apparatus** — the budgeted subclass, the 64-pending cap, the injected timers, F7's two delay rows, S4 below — to 4d, where `t1c`'s subclasses already wait. F4 keeps the step budget and the tick wrapper.
  - **(b) Standard nodes:** `event/onTick → flow/throttle(duration: seconds) → animation/start`. `flow/throttle` (L1419–1478) passes its first `in` and then one per `duration` seconds measured on `lastTickTime`; the runner ticks every frame, so this is "every N seconds" at two node starts per frame per behaviour. It adds `event/onTick` and `flow/throttle` to F-L4's list and needs no storage change, but it puts a per-frame node into every world that has one, and `flow/setDelay` leaves the allowlist here too.
  - I'd take (a): it is thirty lines next to the thirty F-L7 already asked for, it keeps every timer in the adapter where the tests can fake it, and it leaves the graph a plain DAG. Either way, `t6` item 4's "a delayed self-loop runs" is a fact about `loadBehaveGraph`, not about anything the server will ever store, and §2.3 should say so.
- **Fix, the rest:** drop F4's cycle check and the cut rule (or keep one sentence: "F1's validator makes a graph a DAG; the tick wrapper still catches a stack overflow"); drop proof (d2); rewrite §5.1 check 7's third case as "is refused by the server with the validator's message" (and keep the `flow/while` case, which F1's `behavior-op` refuses before the validator runs).

### M3. F5 `select`: a SOM `click` has no distance or button rule, so every look-drag that starts and ends on the same object triggers the behaviour
- **Where:** F5 "`select`: the runner listens for `click` on every saved node's SOM events … and calls that engine's `select(0)`"; P6; §8's note; §5 F5 "select" tests.
- **The code:** outside Edit mode the look is a canvas mouse-drag (`app.js` L2661–2679: `dragging = true` on `mousedown` L2668, `nav.onMouseMove` while dragging L2678) unless pointer lock is on. `PointerInputBridge` fires `pointerdown` on `mousedown` and `pointerup` on `mouseup` (L174–195), and `dispatchPointerEvent` fires `click` whenever the up lands on the node that got the down (`AtriumClient.js` L319) — any button, any distance. The Edit-mode selection has exactly this problem and solves it with `pressDown` + `isSelectClick` (`CLICK_SLOP_PX = 4`, `edit-selection.js` L11–26) on the DOM `click`, which is button 0 only.
- **What goes wrong:** the owner turns the camera with a cube under the cursor at press and release → the cube's `select-light` toggles. With a behaviour on a large object (a wall, the ground), every look that doesn't cross its edge fires it. A right-click fires it too.
- **Fix:** the runner takes its click from `app.js`, not from the SOM: the viewport `click` handler's sibling for `!modes.edit` — `pressDown`, `isSelectClick`, `e.target === canvas`, `pickEditTarget`-style resolution or the bridge's last `click` detail — and calls `runner.select(somNode)`. That also answers two gaps in F5 as written: the runner (in `packages/behaviors`, renderer-neutral) has no way to know Edit mode, and nothing adds the `click` listener to nodes that arrive by `som:add` or external refs after enable. Test: a press-and-release 10 px apart on the behaviour node triggers nothing; a right-click triggers nothing.

### M4. F-L2's `graph` shape fails the Khronos JSON schema: `variables` and `events` have `minItems: 1`, so an empty array is refused
- **Where:** F-L2 (a)'s shape `graph: { types, variables, events, declarations, nodes }`; F1 `behavior-size` ("any `variables` at all"); F8 ("`types` is the engine's standard table").
- **The engine:** `graph.KHR_interactivity.schema.json` (L9341–9393): `variables`, `events`, `declarations`, `nodes`, `types` each `minItems: 1`; `dependentRequired: { variables: ['types'], nodes: ['declarations'] }`. `validateInteractivityGraph`'s first line is the schema match (L11857).
- **Reproduced (`r1`):** a template accepted with the arrays absent is **REJECTED: graph does not match the Khronos JSON schema** with `variables: [], events: []` added.
- **Fix:** F-L2's comment and F1: `variables` is **absent** (F1 `behavior-size`: "a `variables` key at all"); `events` is present only when non-empty (`proximity-animation`, and the interval template under M2 (a)); `types` is non-empty for every template. One vector each way.

## Should-fix

### S1. F2's 64-behaviour cap on `send` must not count the target node
`behaviorCount` as written counts "saved nodes with a behaviour". A `send` to a node that **already** carries one — Enabled toggling (F9 rewrites the value), Save over an existing behaviour, a 4d edit — is refused "already has 64" at exactly 64. Count other nodes, or state the rule as "the cap refuses only a `send` that would add a behaviour node". The §5 F2 test should include "the 64th node's behaviour can be rewritten and toggled".

### S2. F2 healing: a behaviour on a node with no own id is not dropped by F1 as written
F1's `behavior-map` compares `nodeMap[0] !== ownId` only "when `ownId` is given"; F2's healing passes "the node's id, or no id". So a behaviour whose node lost its id to `healDocumentObjectIds` (`world.js` L337–369) passes F1 and is kept, while F2's text says it is "malformed by this rule and dropped". The `send` and `add` paths have their own explicit rule ("give the object an id first" / "a behaviour needs an object id"); give healing one too: no own id → `null`, with the log line.

### S3. F4: `loadBehaveGraph(graph, false)`, pinned
`loadBehaveGraph(graph, runGraph = true)` queues the `onStart` events and, with `runGraph` true, calls `executeEventQueue()` (L8533–8535), which after the first pass schedules the engine's **own** `setTimeout` loop at `1000/fps` (L8712). Every spike probe passes `false`; F4 never says so. One sentence, and proof (d4): load with `true` and the fake-timer test sees the engine tick itself.

### S4. F4 delays: the engine's `flow/setDelay` uses the global `setTimeout`, and `dispose()` the global `clearTimeout`, so "injected timers" needs more than a subclass
(Moot if M2 (a) takes `flow/setDelay` out of this round; then it is 4d's note.) `SetDelay.processNode` calls the global `setTimeout` (L4409) and pushes the id with `pushScheduledDelay`; `clearScheduledDelays` (L8331–8343) calls the global `clearTimeout` on those ids. A subclass that calls `super.processNode` schedules on the global clock whatever the adapter injected; a subclass that reimplements the scheduling with the injected `setTimeout` pushes **fake** ids that the engine's own `dispose()` then hands to the global `clearTimeout` (a no-op), so a fake-timer test of "dispose cancels every timer" passes against nothing. Say which: the subclass reimplements L4404–4423 with the injected pair, keeps its own id list, and the adapter's `dispose()` clears that list with the injected `clearTimeout` before `engine.dispose()`.

### S5. F4 `over-budget`: dispose, don't park
"Disables the behaviour … and never ticks it again until a re-enable" leaves the engine object alive with its state mid-throw (the hook threw out of `processNode` inside `executeEventQueue`'s loop, L8680–8687; the rest of that tick's queue and the `onTick` pass never ran) and its scheduled delays live. Every disable should be a `dispose()`; a re-enable is a reload (dispose-then-create, which F5 already says for `som:set`). Same for `over-send-cap` and `target-not-found`.

### S6. F5's coalescing map is keyed by `(node name, field)`; F12 says every write is "resolved from an id at the moment of sending"
A rename between enqueue and flush (up to 50 ms, or longer under the cap) sends to the old name → `NODE_NOT_FOUND` → logged as a rejection, and the value is lost. Key the map by `(objectId, kind, field)` (kind: node / light / animation) and resolve the name — and the light's qualified name — at flush through `resolveObjectId`. F5's "a rename changes nothing: ids are the key" then holds for the queue too.

### S7. F4 `animation/start`: the clip check against `clipIds` refuses legitimately while the host's model is still loading
`clipIds` exist only once `model-bridge` has built the instance (asynchronous, 4a passdown §4.7). An `interval-animation` whose first fire precedes the host's `Fox.glb` load, or a host whose model `failed`, refuses a write the server would accept and every visitor would play. The server's rule is 4a's (a string of 1–300), and a stale clip is already the viewer's `clip-missing` state. Either drop the check or gate it on `status === 'loaded'`; and the form's picker is the place that guarantees a real clip.

### S8. F1 should reuse the document-extras hygiene: forbidden keys and depth
`authorizeDocumentSend` refuses `__proto__`/`prototype`/`constructor` anywhere in the value and depth over 8 (`send-policy.js` L553–555, L578–596). The behaviour value is copied by spread (`SOMNode.visible`'s setter, `prepareDuplicate`), stringified, saved and handed to a third-party engine; F1 lists no key rule below the top level (`template.params`, `graph.nodes[].configuration`). One line: "`hasForbiddenKey` and `maxDepth(value) ≤ 8`, as the document's extras". Also say "characters" for the 16,384: `JSON.stringify(...).length` counts UTF-16 units, which is fine, but it isn't the socket's bytes.

### S9. F1/F8: `event/onSelect` must be declared with its extension, and its `nodeIndex` pinned
The validator treats a core op that has an `extension` in its schema as unknown unless the declaration carries it (L11908): `{ op: 'event/onSelect' }` → **REJECTED: unknown core operation event/onSelect**; `{ op: 'event/onSelect', extension: 'KHR_node_selectability' }` → accepted (`r1`). For an extension declaration the validator takes the sockets from the declaration itself (L11949, L11952), so the template declares `outputValueSockets` only if a later node reads them (none does). F1's `behavior-op` must say: declarations are `{ op }` for the core ops and exactly `{ op: 'event/onSelect', extension: 'KHR_node_selectability' }` for that one; the uniqueness key is `(op, extension)`. While there: pin `event/onSelect.configuration.nodeIndex` to the literal 0 (F5 calls `select(0)`; any other index never fires) and `stopPropagation` to `false`.

### S10. F6: "drop hits whose object is invisible" must take the next hit, and the first-person capsule becomes a visible change
`_hitTest` returns `hits[0]` (`PointerInputBridge.js` L102–104); the rule is "filter the hit list, then take the first". And `app.js` L2701 sets `avatar.localNode.visible = false` in first person: today a no-op, after F6 the own capsule (and anything `isSeeThrough` relied on) really disappears, and a third-person switch brings it back through the SOM. Probably right; add it to §5.1 check 9 so the regression run looks.

## Nits
- **N1.** F1's light pointer `/extensions/KHR_lights_punctual/lights/[n]/intensity` indexes **`nodeMap`** (the light on `nodeMap[n]`'s node), not a lights table. Standard files index the lights array. Write that into F-L2's shape comment, for 4d's converter.
- **N2.** F1's pointer allowlist admits `translation`, `rotation` and `scale`, which no template uses. The server's `authorizeNodeSend` bounds them (unit quaternion, non-zero scale), so they are safe; but F-L4 (a) says "exactly what the five templates use". Keep them with a sentence, or drop them to 4d.
- **N3.** F2 "A `send` of the leaf on a node with no `atrium` is therefore refused … `INVALID_FIELD`" is unreachable: the own-id check runs first and a node with an id has an `atrium`. Reword.
- **N4.** P2 "no `MAX_ADD_BYTES`": true of the server; the client has one (`edit-duplicate.js` L23, 1,000,000). Say "on the server".
- **N5.** Autosave (`autosave.js` L15–28): the 30 s debounce restarts on every mutation, so an interval behaviour at N ≤ 30 s never lets it settle and the 60 s periodic path saves once a minute for as long as the host tab is open (the animation leaf's `startedAt` changes each fire). Harmless; worth a line in §8 so nobody reads a save-per-minute as a bug.
- **N6.** "Saved nodes" in the SOM's sense (`_savedNodes`, `SOMDocument.js` L1080–1082) includes live avatars (ingested into the document, not external). The runner's scan and its listeners should skip `extras.atrium.ephemeral`, as `model-listeners.js` L46 does.
- **N7.** A toggle's `pointer/get` reads the host SOM, which the echo updates: two clicks within one round trip collapse to one state change (both read the old value; the coalesced send wins). Correct; say it in the template help so DEV acceptance doesn't double-click.
- **N8.** §2.3's cycle depth: my run overflowed at 3,975 steps, the pre-brief's at 3,976; it depends on the stack. "About 4,000" (as §2.2 says) is the honest number.
- **N9.** F6 and `model-bridge`: the wrapper is a child of the host node's view object (`attach`, `model-bridge.js` L799), so three's inheritance already hides instances; "applies the host node's visibility to each instance" matters only for a re-host after a view change. Say so, so the brief author doesn't build a second visibility path.
- **N10.** Commit `t6` (with the README table) before the kickoff, as §8 says; and the two review probes `r1`/`r2` beside it if they're useful — `r1` is the test F8's "passes `validateInteractivityGraph`" row will become.

## P-claims (P1–P12)
Every line number checked at `28c7288`. Notes:
| Claim | Verdict |
|---|---|
| P1 `resolveObjectId` L1116–1125, the comment at L1110, `objectIdInUse`, `isExternalNode`; `setObjectId` L1255–1268 and its own echo L1501; `_releaseScriptHost` and the four abandon paths; the server's election, `handOverScriptHost`, identity-safe `cleanupSession` | Hold |
| P2 the four leaves in `authorizeNodeSend`; `checkAtriumExtras` has no key allowlist; `addCarriesAtriumExtras` is the avatar rule; `CREATABLE_PATHS`; the one-path intermediate; no node byte cap | Hold. `add.client.json` forbids `children` on a node, so an `add` carries at most one behaviour — worth a word in F2 |
| P3 the `send` case; no `RATE_LIMITED` ever sent | Hold (`RATE_LIMITED` appears only in `error.json`) |
| P4 lights: no on/off field; no client path creates one; `intensity` is any finite number (`isFiniteNumber`, L886), negatives included | Hold; the template's `I ≥ 0.01` and `0` are both accepted |
| P5 nothing in `renderer-three` reads `visible`; three r163's `Raycaster.intersect` tests `layers` only (`Raycaster.js` L102–108) | Hold, re-verified on three@0.163.0 |
| P6 `click` on up-over-the-down-node; events don't bubble; the Edit-mode click handler | Hold — and it is where M3 lives |
| P7 the trigger's `hypot(dx, dz) ≤ 0.75 && |dy| ≤ 2.0`; local avatar only; peers via `_onView` | Hold |
| P9 the Edit panel applies first; `_resolveOwnSetEcho`'s three cases; light listeners skip `_applyingRemote` | Hold. Note the node listener (`_attachNodeListeners` L1602) has no `_applyingRemote` check of its own; `_onLocalMutation` L1691 does, so a `sendField` echo applied under `applyLocally` is never re-sent |
| P10 `hello.client.json` `additionalProperties: false` at both levels | Hold |
| P11 `world:loaded` per external ref (L1804) | Hold |
| P12 `clipIds` is `packages/client/src/animation-spec.js` L138 (not `apps/client`); `space-lights.gltf` has `Sun` and `LampGlow` | Hold |

## Appendix: what was run
- Clone and diffs as in Access.
- `npm install --ignore-scripts @khronosgroup/gltf-interactivity-engine@1.1.0 gl-matrix@3`; `three@0.163.0` for P5.
- `t0`, `t1`, `t1b` (timeout 10 → killed), `t1c`, `t2`, `t3` from a copy of `devtasks/spike-4b/` — all as `RESULTS.md`.
- `r1.mjs` — the validator probe: the five F8 templates in both pointer spellings, the delayed self-loop, the two interval alternatives of M2 (both accepted), the `sequence → sequence` cycle, empty `variables`/`events`, `event/onSelect` with and without its extension, each through `validateInteractivityGraph` and `loadBehaveGraph`. Output: 15 template cases (5 refused as written, 10 accepted), self-loop and cycle refused, empty arrays refused, bare `onSelect` refused.
- `r2.mjs` — the runtime probe: the hide template in four pointer spellings through the spike's decorator; all four write.
- Engine reads: `parsePathTemplate` L533; `SetDelay` L4367–4424 (`processNode` L4383–4423); `OnSelect.setUpOnSelect` L7866–7891 (queues `out`; `select()` L8263–8281 walks `getParentNodeIndex`); `clearScheduledDelays`/`dispose` L8331–8352; `loadBehaveGraph` L8446–8536; `executeEventQueue` L8667–8724; the graph schema L9341–9393; the operation schemas (`animation/start` takes a `ref`, `event/onSelect` has `extension: "KHR_node_selectability"`); `validateInteractivityGraph` L11856–11990 (the pointer block L11974–11986).
