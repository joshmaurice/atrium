# Pre-brief: Phase 3 step 4d — graphs beyond the templates: the wider runtime and the graph importer

Status: **DRAFT, Revision 0 (2026-10-30, evening PT). Not reviewed.
Decisions G-L1–G-L12 are open; each has a recommendation.**
- **Drafted by Claude from `main` at `41acd2ff`.** Its code is identical to
  the released `14ab0076` (DEV, MAIN and PROD): the two commits on top
  (`c7f58f50`, `41acd2ff`) touch only `devtasks/`. Line numbers are at that
  commit. The vendored engine is `packages/gltf-interactivity-engine/build/index.js`
  (12,005 lines, sha256 `23a4604c…70b6`, as `VENDORED.md` records).
- **How it was checked.** Claude read the code at `41acd2ff`, surveyed the
  Khronos assets' JSON at the pinned `926bec45` (§2.4), and ran probes
  `p1`–`p7` (§2.5; scripts in `devtasks/spike-4d/`) and the suites nearest
  this round at the base: `@atrium/behaviors` 176 pass and the one named
  `KHRONOS_ASSETS` skip; protocol 122; som 255; server `activate` 24,
  `behavior-leaf` 27, `behavior-walk` 9, `script-host` 11, all pass. The
  app itself wasn't opened in a browser; `p2-page` used a minimal page with
  the app's import map.
- **What the probes changed in this draft:** `p3` found that a no-op'd
  **value** op crashes the behaviour that reads it (P9), so G-L3 and G1 now
  refuse that shape. `p2` set the per-frame budget at 10,000 node starts
  (G7). `p6` gave the conformance baseline: 134 of 143 assets pass (G8).
- **Order (scripting-4c passdown, first instruction 3):** 4d needs this
  pre-brief, and **both outside reviews** (of this pre-brief, and of the
  round from base to tip), because it widens what world-supplied graphs can
  do in the owner's browser far beyond the five templates.
- **Sources:**
  - `devtasks/PREBRIEF-scripting-4c.md` FINAL Rev 1.3: §10 (this step's
    list), AC-L2 (b) (a per-behaviour distance, recorded for 4d), §8 (the
    worker rules this round keeps);
  - `devtasks/PREBRIEF-scripting-4b-2.md` FINAL Rev 2.1: §9 (4d's sketch),
    §2.3 (the engine facts, including the `flow/setDelay` timer rule), F-L2
    (the leaf), F-L3 (what the server checks), F-L4 (the allowlist this
    round widens), F1, F4, F5, F7, F11;
  - the design, `docs/DESIGN-phase3-placement-scripting.md` Rev 1.2: §5.3
    (the script API, "continuous motion never goes over the network", the
    resource limits), §5.4 (storage and the converter), §5.5 ("unsupported
    operations are reported, not hidden"), §6 item 3 (an import arrives
    disabled, with its `targets` shown), §7 item 6 (whole-world import,
    deliberately later);
  - `devtasks/Atrium-Passdown-2026-10-30-scripting-4c.md` §4.1 (count
    limits aren't size limits: bound every stored or forwarded string),
    §4.3 (the outside reviewer can't clone), §6.1–§6.3;
  - `devtasks/Atrium-Passdown-2026-10-29-scripting-4b-2.md` §6.6 (the
    conformance fixtures, item 1; `KHR_animation_pointer`, item 4);
  - `devtasks/Atrium-Passdown-2026-10-24-scripting-4b-1.md` §6.3
    (`KHR_animation_pointer` models);
  - `devtasks/Atrium-Passdown-2026-10-30-signin-sync.md` §4.1 (the seam
    rule: a test of a seam uses the real collaborator or the exact value
    production passes).
- **Scope:** the runtime for graphs beyond the templates (the wider op and
  pointer allowlists, variables, `event/onStart`, `event/onTick`,
  `event/send`, `flow/setDelay` with timers the adapter owns,
  `pointer/interpolate`, the limits that make them safe); what an
  unsupported operation does and how the owner is told; an importer that
  puts one standard graph onto the selected object; the conformance
  fixtures.
- **Out of scope** (as recommended, G-L1): `KHR_animation_pointer` models
  (their own round, 4d-2: it is renderer work with no graph in it); material
  pointers (G-L4, recorded first in §10); whole-file and whole-world
  conversion (design §7 item 6; §2.4 explains why it can't work for placed
  models today); the graphical editor (step 5); JavaScript (step 6);
  behaviours while the owner is away (design §7 item 2); `hover` and
  visitor-side `change` (4c §10); a per-behaviour distance (G-L10, unless
  the operator picks (b)); a synced transition leaf (G-L5 (b)).

## 1. What 4d delivers

| Who | What they get |
|---|---|
| **The owner** | In the Behaviour section, **"Import a graph…"**: paste a `KHR_interactivity` graph (or open a `.gltf`/`.glb` that carries one), map each object, light and animation the graph refers to onto this world's objects, see what Atrium can't run, review the grants, and save it **disabled**. Enable it like any behaviour. A saved graph that uses operations Atrium doesn't run says **"Partially supported"** and lists them. Graphs can now keep state (variables), start on load, run every frame, wait (delays) and animate a value over time |
| **Visitors** | The effects, as ordinary `set` broadcasts, exactly as today. Values a graph changes every frame or over time reach them **as steps** (at most 20 sends per second for the whole world), not smooth motion (G-L5) |
| **The server** | A wider `behavior` rule (both copies): variables, more events, `{ref}` and wired pointer sockets, operations it stores but the page never runs (G-L3), and the new size limits (G7). `scriptRunner: 3` in `hello` (G-L9). No new message |
| **The repo** | The adapter's own delay and clock (no engine timer, no `performance.now()` left in the path), the allowlist enforced by the engine's own registry, a per-frame step budget for the world, the importer (a pure module and its panel), independently written conformance fixtures and the Khronos subset checked in |

**As recommended, it is one round (4d-1) with seven steps** (G-L1), and
`KHR_animation_pointer` models are a separate small round (4d-2). 4d-1 runs
far more kinds of world-supplied graph than 4b-2 did, so it keeps both
outside reviews.

## 2. Verified facts (by reading the code at `41acd2ff`)

### 2.1 The rule, the adapter and the runner today
**P1. The op allowlist is exactly the templates'.** `BEHAVIOR_OPS`
(`packages/behaviors/src/behavior-spec.js` L64–67) is ten ops: `event/onSelect`,
`event/receive`, `flow/branch`, `pointer/get`, `pointer/set`, `math/not`,
`math/gt`, `animation/start`, `animation/stop`, `debug/log`. The server's
copy is `send-policy.js` L537. A declaration outside it is `behavior-op`
(L388), and every declaration but `event/onSelect` must be exactly `{ op }`
(L393–395).

**P2. What else the rule refuses today**, each one a thing 4d needs:
- **any `variables` key** (`behavior-spec.js` L376; server L731);
- **any event id but the three Atrium ones** (L411–418, `BEHAVIOR_EVENTS`
  L70), and any event entry with `values`;
- **every `{…}` pointer template** (the patterns at L86–90 match only
  `[n]` or a literal index) and **every socket-connected index**
  (`pointerIndex` L554);
- **more than 64 nodes, 32 declarations, 16 types or 8 events, or a value
  over 16,384 characters** (L30–34, L362, L373–381).

The engine's validator still runs last (L524–528), after every Atrium rule.

**P3. The pointers the page registers.** `registerKnownPointers`
(`adapter.js` L155–175) registers, **for each `nodeMap` index only**,
`translation`, `rotation`, `scale` and `KHR_node_visibility/visible`, plus
`KHR_lights_punctual/lights/<i>/intensity` when that node hosts a light. Any
other path resolves nowhere, and the engine takes `err` (4b-2 F4). Every
setter passes `mayWrite` (L327–342: the own node, a descendant in the SOM,
or a granted id).

**P4. The step budget is per behaviour per tick.** `engine.processNodeStarted`
(L352–354) throws past 10,000 node starts in one `tick()`. The tick wrapper
disposes the engine (L397–409). **Nothing bounds the total across
behaviours, or over time:** a behaviour that does 9,999 steps every frame
is never stopped. Today no allowed op runs every frame, so that can't
happen. With `event/onTick` it can, 64 times over.

**P5. The adapter owns one timer today, and the engine none.** The interval
timer uses the injected `setTimeout`/`clearTimeout` (L376–384), cleared in
`dispose` (L389). `loadBehaveGraph(graph, false)` (L361) keeps the engine's
own tick loop off. Each engine has its own `NodeEventBus` (L303), so a
custom event never crosses from one behaviour to another.

**P6. The runner's reads lag its own writes.** `world.get` reads the host's
SOM node (`runner.js` L190–193), and a behaviour's write is only queued
(`set` → `enqueue`, L194, L323–368). The host applies it **when the server
echoes it** (4b-2 F5, `sendField`). So a graph that reads a value it wrote
earlier in the same frame, or a few frames ago, reads the old value until
the echo lands, one send opportunity plus a round trip later. 4b-2 accepted
this for the toggle template (its F8 note N7: two clicks within one round
trip collapse to one change). For a graph that does `get → add → set` every
frame, the value only advances when an echo arrives.

**P7. The send budget is per world.** One send opportunity every 50 ms
(`SEND_FRAME_MS`, L38), FIFO by a key's first enqueue, at most 100 keys
(L40). A key rewritten while queued keeps its place and takes the new value
(L364–366). So a key written every frame goes out once per lap of the queue:
with one such key, at most 20 times a second; with six, about every 300 ms
each.

**P8. The runner is ticked by `requestAnimationFrame`** (`app.js` L3246,
L3268). A host tab in the background gets no frames, so its behaviours
don't run, and the interval template's events wait for the next frame. 4d's
`onTick`, delays and interpolations inherit this.

### 2.2 The engine (`packages/gltf-interactivity-engine/build/index.js`)
**P9. An op the registry doesn't have becomes a no-op.** `loadBehaveGraph`
builds a `NoOpNode` for any op missing from `engine.registry` (L8506–8510).
A `NoOpNode` (L6604–6624) does nothing when its input flows are activated,
never activates an output flow, and outputs the type's default for every
socket its declaration defines. That is the spec's rule (§2.6). The engine's
value compiler skips any node whose constructor isn't the standard class
(L36, L233), so a no-op'd math node isn't computed behind the registry's
back either. **`p3` confirmed both halves, and found the catch:**
- deleting an op from `engine.registry` before load makes that node a
  `NoOpNode`; for a **flow** op (`flow/sequence`) nothing downstream runs,
  and nothing throws;
- but **a core op has no declared output sockets, so a no-op'd value op
  has no outputs at all.** When a node that runs reads one (`math/combine3`
  reading a deleted `math/add`), the graph **loads, then the first tick that
  evaluates it throws** ("… depends on output socket "value" of "NoOp
  (unsupported op "math/add")" …", `p3b`). The adapter's tick wrapper
  turns that into `engine-error` and disposes the whole behaviour. So "the
  rest runs" holds only when nothing that runs reads an unsupported node's
  values (G1).

**P10. The validator accepts any op that names an extension.** A
declaration with no `extension` must be a known core op ("unknown core
operation", L11908). One **with** an extension takes its value sockets from
the declaration itself (L11918), so a graph can carry ops from extensions
the engine doesn't know. Flows must still point to a later node (L11933).
**Stored graphs stay DAGs, but they can now loop at run time:** an
`event/send` to an `event/receive` earlier in the graph runs on the **next**
tick (events queued during a tick wait, L8677), and a delay's `done` does
the same after its timer. So loops become possible, at no more than one lap
per tick or per delay, and the per-tick budget (P4) still caps each tick.
**`p7`:** a send → earlier receive loop runs exactly one lap per tick (2
steps a tick for 30 ticks), and a doubling fan-out (one receive, two sends)
doubles each tick (2, 4, … 8,192) and is disposed `over-budget` on its 14th
tick.

**P11. `flow/setDelay` uses the global timers and a table that only
grows.** `SetDelay.processNode` (L4367–4424) calls the global `setTimeout`
(L4409) and `pushScheduledDelay` (L8356): **one array slot per delay ever
scheduled**. A fired or cancelled delay's slot is set to `undefined`
(`removeScheduledDelay`, L8374–8381), never reused. `dispose` (L8344) clears
the table with the global `clearTimeout` (L8331–8343). Durations that are
NaN, infinite, negative or over 2^31 ms take `err`. **There is no limit on
pending delays.** A graph doing `onTick → setDelay` adds 60 slots a second
for as long as it runs. **`p5`:** after 10,000 ticks of `onTick →
setDelay(0.001)` the table has 10,000 slots and 10,000 pending timers; once
they've fired it still has 10,000 slots, none pending; only `dispose`
empties it. 4b-2 §2.3 already set the rule: a subclass that
owns its timers keeps its own id list and clears it itself, or a
fake-timer test of "dispose cancels every timer" passes against nothing.

**P12. The engine's clock is `performance.now()`, read in the tick.**
`executeEventQueue` sets `_lastTickTime = performance.now()` (L8669).
`lastTickTime` is a getter on the class (L8204–8206). `event/onTick`'s
`timeSinceStart` and `timeSinceLastTick` (L1103–1152), `flow/throttle`
(L1456) and every interpolation (L8581–8616, L6578) read it. The adapter's
injected `now` (`adapter.js` L270) reaches none of them, so today a test
can't fake time for any of these ops. **`p1`: shadowing the getter on the
instance works** (`Object.defineProperty(engine, 'lastTickTime', { get })`):
with fake ticks at 1,000, 1,500, 2,500 and 4,000 ms, `onTick`'s
`timeSinceStart` wrote 0, 0.5, 1.5 and 3; an interpolation to x = 10 over
1 s wrote 0, 2.5, 5 and 10 at 0, 250, 500 and 1,000 ms; a 1 s
`flow/throttle` let through the ticks at 0, 1,000 and 2,050 ms only.

**P13. Interpolation runs once per tick, one per pointer.**
`pointer/interpolate` (L5231–5291) reads the start value through the
registered getter, then `animateCubicBezier` (L8581) **replaces any running
interpolation on the same path** (L8582) and registers a callback that
`executeEventQueue` runs every tick (L8689–8695), writing through the
registered setter, and so through `mayWrite` and the runner's queue.
`variable/interpolate` does the same per variable. **Both are naturally
bounded:** there can't be more active interpolations than registered
pointers plus declared variables. The adapter's `dispose` already clears
both maps (`adapter.js` L392–393).

**P14. `event/onTick` runs at the end of every tick** (L8697–8705), after
the queue and the interpolations. `event/onStart` is queued at load
(L8521–8528) and so runs on the engine's **first** tick. An engine is
created on every enable, reload, world load and host handover, so **a
graph's `onStart` runs again each time, and its variables start over.**
The design accepts the restart ("the runner starts fresh on handover", §5.2).

**P15. Pointer templates:** `[x]` is an **int** socket and `{x}` a **ref**
socket (`parsePathTemplate`, L533; the validator's check, L11977–11986).
At run time a ref value such as `"/nodes/2"` is spliced into the path, so
`/nodes/{r}/translation` with `r = "/nodes/2"` resolves to the registered
`/nodes/2/translation` (4b-2's `r2`: "every spelling writes"). **`p4`, with
`nodeMap` indices 0 and 1 registered:** a `{r}` ref `"/nodes/1"` sets,
gets and interpolates node 1; a ref `"/nodes/9"` takes `err` on `set` and
`interpolate` and gives `isValid: false` on `get`, writing nothing; a wired
`[i]` of 1 writes node 1, and a wired `[i]` of 9 takes `err`.

### 2.3 The client and the server
**P16. `scriptRunner`.** `hello.client.json` accepts `1` and `2` (L35).
Election and handover require `2` (`session.js` L554–555, L815), and
`AtriumClient.connect` sends `2` only when asked, which `connectNow` does
only same-origin (`AtriumClient.js` L595, L757). This is 4c's S2 pattern,
which 4d repeats (G-L9).

**P17. Load healing drops what the current rule refuses.** At world load,
a behaviour that fails F1 is replaced by `null` and logged
(`world.js` L422–451), and the next autosave writes the `null`. **So a
rollback from 4d to 4c deletes every behaviour that only 4d's rule accepts,
on each world's next load.** The PROD backup made before each release
(4c passdown §1) is the way back. Recorded for the release path (§8).

**P18. The light fields.** `LIGHT_FIELDS` (`send-policy.js` L75) includes
`color`, so a light-colour write needs no server change. Material writes
exist on the server (the chain at L56–67, L1368–1398: `baseColorFactor`,
`emissiveFactor`, …) but address a node's `mesh.primitives[N].material`,
not a glTF `/materials/<i>` index (G-L4).

### 2.4 The Khronos assets: a static survey (`glTF-Test-Assets-Interactivity` @ `926bec45`)
Claude fetched the assets at the commit the repo pins and read every graph's
JSON with a script outside the repo (no engine, no repo code). Each asset
ships as `.glb` and `.gltf`, so it was counted once: **178 distinct assets
carry a graph, 161 under `Tests/` and 17 sample models under `Models/`**.
These are mostly test graphs, so they show what the standard's own authors
write, not what Atrium owners will.
- **4b-2's allowlist runs 0 of 178.** That is why the checked-in
  conformance list (`tests/fixtures/behavior-conformance.json`) is empty,
  and the run is skipped on the build host anyway (no assets there).
- **G-L2 (a)'s allowlist (134 of the engine's registered ops) covers the
  ops of 171 of 178** (tests 156/161, models 15/17), checked against the
  engine's own registry list (L8138). The seven left use hover (3
  assets), `animation/stopAt` (2), `event/stopPropagation` (1), or one of
  the assets' deliberate unsupported or misnamed-op tests (2).
- **Without variables: 2 of 178.** Without `onTick` and both interpolates:
  156. **Variables aren't optional for real graphs.**
- **Size:** median 84 nodes and about 13,000 characters. **56 of 178 fit 4b-2's
  64 nodes and 16,384 characters; 154 fit 256 nodes and 65,536** (with the
  ops). Variables reach 32 and events 8 among those 154.
- **Pointers:** of the 179 assets with a pointer node, 176 address
  `/nodes/…`, 13 `/materials/…`, 5 `/animations/…`. 21 use `{ref}`
  templates, and their literal ref values are paths like `"/nodes/7"` or
  `"/materials/3"`. **12 compute an index or a ref at run time** (a wired
  socket, from `math/add`, `flow/for`, `pointer/get`, …).
- **The 17 sample models** (TrafficLight, WhackAMole, Puzzle, …): 15 use
  only G-L2 (a) ops, but **none uses only node transform and visibility
  pointers**. They also use materials (`baseColorFactor`, texture
  transforms), `globalMatrix`, morph weights, the active camera, or
  animations' `maxTime`. **And every one drives its own inner nodes.** In
  Atrium a placed model's inner nodes are the page's own, not SOM nodes
  (4c AC-L7), so no `nodeMap` can name them. **No sample model's graph can
  run against a placed copy of that model in 4d.** That would be a
  different feature, recorded in §10. 4d serves graphs written for a
  world's own objects.

### 2.5 Probes `p1`–`p7` (2026-10-30, `devtasks/spike-4d/`)
Run by Claude from the repo root against the workspace's real adapter and
vendored engine (Node 22.23.4; Chromium 153 through Playwright for
`p2-page`). The README there says how to run each.
- **`p1` the clock: works.** Shadowing `lastTickTime` on the engine
  instance drives `onTick`, both interpolations and `flow/throttle` from
  an injected clock (P12). G3 uses it.
- **`p2` step cost.** Through the real adapter, one node start costs
  **0.28–0.36 µs in Node and 0.18–0.34 µs in Chromium** on this machine
  (a flow-heavy graph at 7,504 steps a tick, a math-heavy one at 5,604),
  so 10,000 steps take about 2–3.5 ms here. An owner's laptop may be
  several times slower. G7's per-frame budget is set from this: **10,000
  node starts across the world**. A frame can then cost at most that plus
  one behaviour's tick (another 10,000, because a tick isn't cut short),
  about 4–7 ms here.
- **`p3`/`p3b` the registry gate.** Keep-by-allowlist takes the registry
  from 138 ops to exactly the kept set. A deleted flow op stops its flow
  quietly; **a deleted value op that a running node reads throws at that
  node's first evaluation** (P9). G1 refuses that shape.
- **`p4` refs: as P15 says**, eight cases: `set`, `get` and `interpolate`
  through `{r}` refs, wired `[i]` inside and outside `nodeMap`, and `err` /
  `isValid: false` for every miss.
- **`p5` the delay table leaks** as P11 says (10,000 slots kept after
  10,000 delays fired).
- **`p6` the Khronos subset through today's adapter.** Of the 156 indexed
  conformance assets, **143 fit G-L2 (a)'s ops and G7's sizes**. Each was run
  through the real adapter (today's: the engine's own timers and clock;
  only the op filter is 4d's), with a fake world seeded from the asset's
  nodes. **134 pass, 8 fail, 1 is disposed**, the same in two runs:
  - fail: `animation/start`, `animation/state`, `animation/stop` (the fake
    world plays nothing; Atrium's animations are 4a's leaf),
    `pointer/get_set_morphtargets` (weights aren't registered, G-L4),
    `Extras/Matrix_Updates` (matrix pointers aren't registered yet; G-L4 (a)
    adds the read-only ones), `pointer/set_edge_cases`, `ref/eq`,
    `math/matDecomp-Shear` (not yet looked into: for the brief author);
  - **disposed `over-budget`: `math/random`.** A legitimate test graph runs
    past 10,000 steps in one tick (Q6).
  This is G8's baseline, not its expected list: the round's adapter
  regenerates the list, and the handoff explains every change from it.
- **`p7` loops through events: as P10 says**, one lap per tick, and a
  doubling fan-out disposed on its 14th tick.

### 2.6 The spec
The `KHR_interactivity` text at `KhronosGroup/glTF` `main` gives its status as
complete and ratified. Fetched in part (the operation sections past the math
ops weren't reachable), it says:
- **an unsupported operation is a no-op**: activating it does nothing, its
  output flows never activate, and its outputs are type defaults (P9 is the
  engine doing exactly this);
- **implementations set static limits** (graph size, variables, events,
  declarations, nodes), and a graph past them **must be rejected**;
- **and dynamic limits** (simultaneous delays, animations, interpolations,
  events per frame), and going past one is a **run-time error the graph
  can handle through `err`**.

G7's limits follow that split. **For the reviewer:** the `flow/setDelay`,
`event/onTick` and `pointer/interpolate` sections weren't read from the spec
itself; the engine is the reference here.

## 3. Decisions (for the operator)

- **G-L1 — The round's shape.**
  - **(a) Recommended: 4d-1, one round with seven steps** (§8): the rule
    (both copies), the adapter's runtime, the runner's budgets and reads,
    the importer, the capability, then the fixtures, suites and proofs.
    **`KHR_animation_pointer` models are 4d-2,** a separate small round
    with its own short pre-brief: it is renderer work with no graph in it
    (§10).
  - (b) Three rounds: the runtime (console-only acceptance), the importer,
    then 4d-2.
  - (c) One round for everything, including animation pointers.

  (b)'s first round ships nothing an owner can use without the console,
  the shape 4b-2's F-L1 rejected. (c) mixes a three.js loader change (and
  probably a three.js upgrade or a vendored plugin, §10) into the round
  that most needs a narrow review. (a) keeps the importer with the runtime,
  so DEV acceptance is the owner's own flow.

- **G-L2 — Which ops run.**
  - **(a) Recommended: the core set the survey needs** (§2.4: 171 of 178):
    - **flow:** `sequence`, `branch`, `switch`, `doN`, `multiGate`,
      `waitAll`, `throttle`, `for`, `while` (the budgeted subclasses,
      `adapter.js` L102–113), `setDelay`, `cancelDelay` (G3's subclasses);
    - **events:** `onStart`, `onTick`, `onSelect` (with
      `KHR_node_selectability`), `receive`, `send`;
    - **`variable/get`, `variable/set`, `variable/interpolate`;**
    - **`pointer/get`, `pointer/set`, `pointer/interpolate`;**
    - **every `math/*` and `type/*` op the engine registers, and
      `ref/eq`;**
    - **`animation/start`, `animation/stop`, `debug/log`.**
    - **Not run:** `event/onHoverIn`/`onHoverOut` (hover isn't in Phase 3,
      design §5.2); `event/stopPropagation` (a click already resolves to
      exactly one behaviour node, 4c AC2, so there is nothing to stop); `animation/stopAt` (4a's leaf has no end time,
      4b-2 F4). Under G-L3 (a) these are stored and inert.
  - (b) Event-driven only: (a) without `onTick` and the two interpolates.
  - (c) Everything the engine registers.

  (b) covers 156 of 178 and keeps every behaviour off the per-frame path,
  but `onTick` is the design's `frame` event (§5.3), and the per-frame
  world budget (G4) is what makes it safe. (c) includes hover and `stopAt`,
  which would run with the wrong meaning in Atrium.

- **G-L3 — What an unsupported operation does.**
  - **(a) Recommended: stored, inert, and reported.** The server's rule
    accepts any declaration the engine's validator accepts (within G7's
    limits and G1's string rules). **The page runs only the allowlist:**
    the adapter deletes every other op from the engine's registry before
    `loadBehaveGraph`, so each one is a `NoOpNode` (P9). That is the spec's
    own rule (§2.6), and the design's "partially supported" (§5.5). A
    pointer outside G-L4's families is the same: nothing registers it, so
    the engine takes `err`. **The form and the importer list both** (G6),
    and the behaviour's status says "Partially supported". **One shape is
    still refused (`p3`, P9):** a node the page runs may not read a value
    output of a node it doesn't run. For a core op the engine throws at
    that read and the whole behaviour is disposed. For an op from an
    extension, whose declaration lists its sockets, the reader gets the
    type's default, which can be `null` (`p3b`, through the loader only),
    so a write would carry it. So an unsupported node may only end flows,
    never feed values.
  - (b) Refused, as 4b-2 does: the server refuses every declaration and
    pointer outside the allowlists, and the importer refuses the graph,
    with its report.

  The survey shows what (b) costs: none of the 17 sample models has only
  supported pointers, so under (b) any graph that touches a material
  anywhere is refused whole. **What (a) costs:** the server no longer
  guarantees that a stored graph is one Atrium runs completely. The
  guarantee that remains is the one that matters: **the page runs nothing
  outside the allowlist.** That rests on the adapter's registry, so G3
  deletes by **allowlist** (keep these ops, delete everything else), never
  by denylist, and a test pins the registry's exact key set after setup. A
  later engine upgrade that adds an op can't then run it without an
  allowlist change. The reviewer should look hardest here.

- **G-L4 — Which pointers are written and read.**
  - **(a) Recommended:**
    - **node `translation`, `rotation`, `scale` and
      `KHR_node_visibility/visible`**, spelled `/nodes/<i>/…`,
      `/nodes/[x]/…` or `/nodes/{x}/…`, with the index or ref either a
      literal or wired (P15). The decorator registers each for `nodeMap`
      indices only, so a wired value outside `nodeMap` takes `err` (P3,
      `p4`);
    - **read-only `/nodes/…/matrix` and `/nodes/…/globalMatrix`**, from
      the SOM, through a new `worldMatrix` in `@atrium/som` beside
      `worldPosition` (one implementation for every caller, as 4c's AC2
      did). The survey's models read `globalMatrix` often;
    - **light `intensity` and `color`**, addressed as 4b-2's F-L2 does
      (the index is the `nodeMap` index of the light's host node, not a
      lights table). `color` needs no server change (P18).
    - **Not in 4d:** `/materials/…`, morph `weights`, the active camera,
      `/animations/…/extensions/KHR_interactivity/…`, `children`, `mesh`,
      the `*.length` pointers. Under G-L3 (a) they are inert and reported.
  - (b) (a) plus **material `baseColorFactor` and `emissiveFactor`**
    through a third table beside `animations` (`materials: [{ object,
    primitive }]`), written through the server's existing material chain
    (P18).
  - (c) 4b-2's families only.

  (b) is the most-used missing family (13 assets, and most sample models),
  but **a glTF material can be shared** by primitives on several objects.
  A behaviour writing one would change objects outside its own subtree,
  the "resources it shares" clause of the step 4 pre-brief's D5, which
  4b-2 F-L5 left with nothing to cover. That needs its own authority rule, a mapping UI and Duplicate
  remapping. Recorded first in §10.

- **G-L5 — Values written every frame, or over time.**
  - **(a) Recommended: the host samples, and the existing queue sends.**
    `onTick` and both interpolations write through the setters every tick,
    and the runner's queue coalesces per field and sends one value per
    opportunity (P7), **so visitors see steps**, at most 20 a second for
    the whole world, shared round-robin by every key in the queue. Because
    a queued key takes each newer value in place, **the last value an
    interpolation writes is always the one that goes out**, so motion ends
    where it should. The importer warns when a graph writes on `onTick` or
    interpolates (G6).
  - (b) A **synced transition**: the host sends one message per
    interpolation (target value, duration, easing, a server-stamped start,
    like 4a's animation leaf), and every client animates locally. Smooth
    for everyone, one send per transition; a new leaf or message, renderer
    work, and its own round.
  - (c) Interpolations send only their final value; `onTick` writes as in
    (a).

  **(a) departs from the design's "continuous motion never goes over the
  network" (§5.3)** for these two ops, bounded by the world's send budget,
  which is why the importer says so. Smooth motion is still the design's
  way: start a glTF animation. (b) is the right long-term answer and is
  recorded in §10. (c) makes `pointer/interpolate` jump for everyone,
  including the host.

- **G-L6 — A graph reads its own writes.**
  - **(a) Recommended: an overlay in the runner.** `world.get` returns the
    host's **latest write to that key** while it is queued or in flight,
    and the SOM value otherwise. An entry leaves the overlay when the
    server answers that write (the echo applies the same value, or a
    rejection), when it is dropped (the drag rule, authority at the
    opportunity, a disposed producer), or when **another session's** `set`
    for that field arrives. The other session wins.
  - (b) No change: reads lag until the echo (P6).

  Under (b), any graph that does `get → math → set` on `onTick` advances
  only when an echo lands, so its speed depends on the network. (a) also
  makes the toggle template's double click (4b-2 N7) work. It never
  touches the SOM, so Undo and the drag rule are unchanged.

- **G-L7 — The limits.**
  - **(a) Recommended: G7's table:** 65,536 characters, 256 nodes, 64
    declarations, 32 variables, 16 events, `nodeMap` still 1–16, 16
    pending delays per behaviour, delays of 0–3,600 s, the per-tick budget
    still 10,000, and **a per-frame budget for the world of 10,000 node
    starts** (`p2`: about 2–3.5 ms on the probe machine).
  - (b) Keep 4b-2's sizes (16,384 characters, 64 nodes, 32 declarations)
    and add only variables, events and the dynamic limits.

  (b) fits 56 of 178 surveyed graphs and (a) fits 154 (§2.4). The cost of
  (a) is storage and download: 64 behaviours of 64 KiB is 4 MiB in the SOM
  and in every visitor's `som-dump`, against 1 MiB under 4b-2. The
  per-frame budget is new with `onTick` (P4). At `p2`'s cost, 10,000 node
  starts take 2–3.5 ms on the probe machine, and a frame's worst case is
  about twice that (§2.5).

- **G-L8 — The importer.**
  - **(a) Recommended: one graph, onto the selected object, mapped by
    hand.** The source is pasted JSON, or a file: a bare graph, a
    `KHR_interactivity` extension object (`{ graphs, graph }`), or a
    `.gltf`/`.glb` carrying one (the owner picks the graph when there are
    several). The importer lists **every node, light and animation the
    graph refers to by a literal** (pointer indices, `"/nodes/<i>"` ref
    literals, `onSelect`'s `nodeIndex`, `/animations/<i>`), with the
    file's own names when the source has them. The owner maps each one to
    an object in this world (an animation to a model and a clip), and one
    of them, or none, to **this object**. The importer rewrites the
    graph, in order to fit `nodeMap` (own first), and **refuses** what it
    can't translate: **a wired index or ref** (it holds a file index the
    importer can't rewrite; 12 of 179 surveyed assets), `event/onSelect`
    on two different nodes, more than 16 objects. **It saves `enabled:
    false`**, with the grant list shown and every grant named (design §6
    item 3), and the owner enables it.
  - (b) (a) plus **automatic mapping by name** when a world object has
    the file node's name.
  - (c) No importer: graphs only through the console.

  (b) is a convenience that can silently pick the wrong object of a common
  name ("Cube"); it can follow once (a) exists. (c) leaves no owner path.
  Whole-file conversion (every graph in a file, split per object) needs the
  file's nodes to be world objects: that is whole-world import (design §7
  item 6), not this round (§2.4).

- **G-L9 — A 4c tab must not be the host.**
  - **(a) Recommended: `scriptRunner: 3`** ("runs 4d graphs"). Election
    and handover require 3, in both places (P16). The schema keeps 1 and
    2, so an unreloaded 4c page still connects, keeps its Edit panel, and
    is never the host. The cross-origin rule is unchanged: no
    `scriptRunner` key at all.
  - (b) Keep 2: a 4c host runs the templates, and refuses 4d graphs as
    `invalid: behavior-op` until it reloads.

  4c's Q3 settled the same question the same way: one rule for which tab
  runs behaviours. With (b) the world's behaviours depend on which tab the
  server picked. **Consequence, accepted as in 4c:** after the deploy,
  until an owner tab reloads, visitors get "Nothing happens: this world's
  owner isn't here right now."

- **G-L10 — A per-behaviour distance (4c AC-L2 (b)).**
  - **(a) Recommended: not in 4d.** The 10 m rule stays a constant.
  - (b) An optional `maxDistance` key, both rule copies, the server's
    `activate` check reading it, and a form field.

  Nobody has asked for it, and standard graphs have no such concept, so
  the importer has nothing to fill it from. It touches 4c's check order,
  which is the security-facing part of `activate`. A small round can add
  it when an owner needs it.

- **G-L11 — The conformance fixtures.**
  - **(a) Recommended: written before the kickoff, by Claude, not by the
    implementer.** Twelve to twenty small graphs under
    `tests/fixtures/behavior-conformance-4d/`, each with a README line and
    an expected **write log** (the setter calls in order, with values, on
    a fake world with an injected clock). One per new op family, plus the
    limit cases: a delay cancelled, a delay over the pending cap taking
    `err`, an interpolation replaced mid-way, `onStart` with variables,
    `onTick` for N frames, a send/receive loop, an unsupported op stopping
    a flow. They land in a `tests/`-only commit the kickoff names as part
    of its base. **The implementer may not edit them**, and a disagreement
    is a reported finding. **And the Khronos subset is checked in:** the
    graphs (JSON only) of the surveyed assets that fit G7, with the
    CC-BY-4.0 notice (as `tests/fixtures/behavior-invalid/` already does),
    so the run happens on every build, not only where `KHRONOS_ASSETS`
    points. `p6` is its baseline: 143 assets, 134 passing through today's
    adapter.
  - (b) The Khronos subset only.
  - (c) The implementer writes the fixtures with the code.

  (c) is the gap 4b-2 round 5's S3 named: fixtures written by whoever
  writes the code test what they meant, not what the standard says. (b)
  leaves Atrium's own semantics (the overlay, the budgets, the inert ops)
  without an independent check.

- **G-L12 — Carried items.**
  - **(a) Recommended:** the 4c re-review's **N1** (`logCheckFailure`,
    `session.js` L104–106, through `logId`; one line), and nothing else.
  - (b) Also the deferred same-tab sign-in (4c passdown §6.3).

  §6.3 is a sign-in fix with its own real-sign-in browser check, and
  nothing to do with graphs. It is small enough for its own round, before
  or after 4d-1.

## 4. The contract (as recommended; adjust with §3)

### G1. The rule (`behavior-spec.js` and the server's copy, one vector file)
- **Variables:** `graph.variables` is allowed: 1–32 entries (absent when
  none, as the Khronos schema refuses an empty array, 4b-2 M4).
- **Events:** 1–16 entries (absent when none). An id is 1–64 characters of
  `[A-Za-z0-9_./:-]`, unique. The prefix `atrium/` is reserved for the
  three Atrium ids, which keep their rules (`proximity`, `interval`, F-L7).
  Entries may carry `values` (the validator types them). **An `event/send`
  may not target an `atrium/*` event** (`behavior-event`): those are the
  adapter's to dispatch.
- **Declarations:** 1–64, unique by `(op, extension)` (as now). **Any op the
  validator accepts is stored** (G-L3 (a)). `op` is 1–64 characters of
  `[A-Za-z0-9_/]` and `extension`, when present, 1–64 of `[A-Za-z0-9_]`
  (4c passdown §4.1: every stored string gets its bound and its character
  set). **A node whose op is in the allowlist may not take a value input
  from a node whose op isn't** (`behavior-op`, "a node reads a value from
  an operation Atrium doesn't run"; `p3`). Both copies read the allowlist
  from the same constant they already share with the adapter.
  `event/onSelect` keeps its exact declaration, and its node keeps
  `nodeIndex` the literal `0` and `stopPropagation` `false` (4b-2 S9). The
  server's `listensForSelect` is unchanged.
- **Pointers in G-L4's families** (whatever the op, supported or not): a
  **literal** index (`/nodes/<i>/…` or an `[x]` socket's literal) must be
  an integer in `0 … nodeMap.length - 1`, and a **literal ref** for a
  `{x}` socket must be the string `"/nodes/<i>"`, with the same bound
  (`behavior-pointer`). For a light pointer it is
  `"/extensions/KHR_lights_punctual/lights/<i>"`, with `<i>` a `nodeMap`
  index. **Wired sockets are allowed** (P15, `p4`: the registry bounds them
  at run time). Pointers outside the families aren't checked beyond the
  validator and the byte limit (G-L3 (a)).
- **Sizes:** G7. The forbidden-key and depth walk still runs first, and the
  validator last (4b-2 §8).
- **`template`, `proximity`, `interval`, `animations`, `nodeMap`,
  `targets`, `kind`, `origin`, `enabled`:** unchanged. An imported graph has
  no `template`, so the form shows it as a custom graph.
- **The vectors** (`tests/fixtures/behavior-vectors.json`, regenerated by
  `gen-vectors.mjs`): every new limit at its boundary and one past it; an
  event id of 65 characters and one with a space; `event/send` to
  `atrium/enter`; a `{x}` ref `"/nodes/16"` with a 16-entry `nodeMap`; a
  literal ref `"/nodes/1"` accepted; a wired index accepted; an unknown
  extension op accepted (G-L3 (a)); a bare unknown core op refused (by the
  validator); a `variables: []`; a `__proto__` key inside a variable's
  value; and **every 4b-2 vector that 4d now accepts, moved to the accepted
  side with its reason**, so a reviewer can see each widening on its own
  line.

### G2. The server
- The wider rule, through the existing paths (`send`, `add`, healing); the
  `hello` schema's `scriptRunner` enum gains `3`; `canRunBehaviors` and the
  `hello` election require `3` (P16, both places, each alone tested as 4c's
  P22 required). N1 (G-L12).
- **Nothing else changes:** no new message, no new error code, `activate`
  and its check order untouched.

### G3. The adapter (`packages/behaviors/src/adapter.js`)
- **The registry gate (G-L3):** after the engine is created and the
  budgeted subclasses installed, every registry key **not in the
  allowlist** is deleted, then the graph is loaded. A test compares the
  registry's key set with the allowlist exactly, so an engine upgrade that
  adds an op fails it.
- **The clock:** the engine's `lastTickTime` reads the injected `now`
  (`p1`'s route). Afterwards **no op in the allowlist reads
  `performance.now()` or a global timer**, and a test that deletes both
  globals during a run proves it.
- **Delays:** `flow/setDelay` and `flow/cancelDelay` are subclasses that
  schedule with the injected `setTimeout`/`clearTimeout`, keep **their own
  table** (slots reused, P11), and enqueue `done` through the engine's work
  queue, so it runs on the next tick, as now. A 17th pending delay in one
  behaviour takes `err`, as the spec's dynamic-limit rule says (§2.6).
  `lastDelay` refs stay valid for `cancelDelay` and `cancel`. `dispose()`
  clears the table with the injected `clearTimeout` before
  `engine.dispose()`.
- **Pointers (G-L4):** the decorator registers, per `nodeMap` index, the
  four node fields (as now), read-only `matrix` and `globalMatrix`
  (`world.matrix(i)`, `world.worldMatrix(i)`), and light `intensity` and
  `color` for a light host. **`world` gains exactly those reads and
  `setLightColor`**, total like the rest (4b-2 S4).
- **Interpolation:** unchanged engine behaviour (one per path, P13), now on
  the injected clock. Disposal already clears both maps.
- **Events:** the adapter alone dispatches `atrium/*` (as now). A graph's
  own `event/send` reaches only its own engine (P5).
- **The report:** a pure `graphReport(value)` returns `{ unsupportedOps:
  [{ op, extension, count }], unsupportedPointers: [{ pointer, count }],
  perFrame: bool, interpolates: bool, startsOnLoad: bool, keepsState: bool
  }`, for the form, the importer and the runner's status. One function, so
  they can't disagree.
- `skipRules` stays test-only.

### G4. The runner (`packages/behaviors/src/runner.js`)
- **The per-frame world budget:** each frame, engines are ticked in a
  rotating order starting after the last one ticked. Once the frame's node
  starts across all engines reach the budget, the rest **skip this frame**
  (their events wait; `onTick`'s `timeSinceLastTick` just grows). A skip
  isn't a disable. One log line per behaviour per minute while it's being
  skipped. The per-tick budget (P4) still disposes a single runaway tick.
- **The overlay (G-L6):** `get` reads the latest queued or in-flight value
  for that key. Entries are removed by the answer for the **last** seq sent
  for the key, by any drop, or by a `som:set` from another session. Every
  path that empties the queue (`disposeEngine`, `disableEngine`,
  `disposeAll`) empties that behaviour's overlay entries with it.
- **Status:** "Partially supported" when `graphReport` lists anything, with
  the list. A `debug/log` line, a refused write, a delay over the cap and a
  skipped frame each reach the log as now.
- **Unchanged:** the queue's rate, keys and FIFO, the drag rule, authority
  at the opportunity, `select`, forwarded `activate`, the 10 m rule.

### G5. The client
`connectNow` passes `scriptRunner: sameOriginAsAccount(…)` as now, and
`AtriumClient.connect` sends `3` instead of `2`. The frozen-schema test
from 4c (the hello without `scriptRunner` accepted by the two frozen
server schemas) stays green. **A new frozen fixture is added:**
`hello.client.14ab0076.json`, so a 4d client's cross-origin hello is also
proven acceptable to the 4c server now on PROD.

### G6. The importer (`apps/client/src/graph-import.js`, pure, and its panel)
- **`parseGraphSource(text | ArrayBuffer)`** → `{ graphs: [graph, …],
  fileNodes: [{ index, name }], fileLights, fileAnimations }` or `{ problem
  }`. A `.glb` is read from its JSON chunk only (no buffers). Sources over
  4 MiB are refused before parsing.
- **`referencesOf(graph)`** → `{ nodes, lights, animations }`, each the set
  of literal indices, and `wired: [{ node, socket }]`.
- **`convertGraph(graph, mapping)`** → `{ value, report }` or `{ problem }`:
  `value` is a complete behaviour leaf (`kind: 'graph'`, `origin: 'local'`,
  `enabled: false`, `nodeMap` own-first, `targets` = every mapped object
  outside the own subtree, `animations` from the mapping), and it **must
  pass `behaviorCheck`** before the panel offers Save. The `report` is
  `graphReport` plus the grants.
- **The panel** (in the Behaviour section; "Import a graph…" beside the
  template list): the source, the graph picker, the mapping table (each
  reference with its file name and a target picker, filtered by kind), the
  report, the grants, Save. Save is one `sendField` of the leaf (the node
  gets its `objectId` first, as F9 does). After Save it is the custom-graph
  state: Enabled, Remove, the report.
- **Every string from a graph or a file reaches the DOM as text, never as
  HTML** (op names, extension names, event ids, file node names, `debug/log`
  messages), and a wiring guard checks the panel has no `innerHTML` with
  graph data.

### G7. Limits (the numbers)
| What | 4b-2 | 4d (recommended) | Kind |
|---|---|---|---|
| Behaviour characters (`JSON.stringify`) | 16,384 | 65,536 | static, F1 |
| Graph nodes / declarations / types | 64 / 32 / 16 | 256 / 64 / 16 | static, F1 |
| Variables / events | 0 / 8 | 32 / 16 | static, F1 |
| String fields (`op`, `extension`, event ids) | — | 1–64, a character set each | static, F1 |
| `nodeMap` / `targets` / `animations` | 1–16 / 0–16 / 0–8 | unchanged | static, F1 |
| Behaviour nodes per world | 64 | unchanged | server |
| Steps per tick per behaviour | 10,000 | unchanged | adapter |
| **Steps per frame, the whole world** | — | **10,000** (`p2`), plus at most one tick past it | runner |
| Pending delays per behaviour | — | 16 (the 17th takes `err`) | adapter |
| Delay duration | — | 0–3,600 s (outside takes `err`) | adapter |
| Interpolations | — | one per pointer or variable (P13) | engine |
| Sends per world / pending keys | 20 per second / 100 | unchanged | runner |
| Import source | — | 4 MiB | importer |

### G8. The conformance fixtures and the Khronos subset (G-L11)
- `tests/fixtures/behavior-conformance-4d/` (Claude's, before the kickoff):
  each fixture a graph, a `nodeMap` of fake ids, a frame count, a clock
  step and the expected write log. Run through the **real** adapter with a
  fake world and fake timers.
- `tests/fixtures/behavior-conformance-khronos/`: the graphs of the subset
  (JSON, one file per asset), the CC-BY-4.0 text, a README with the source
  commit and each file's sha256, and the expected results, regenerated
  with the round's adapter. **Against `p6`'s baseline** (134 pass, 8
  fail, `math/random` disposed): a fail that becomes a pass needs its
  reason (for example `Extras/Matrix_Updates` with G-L4's read-only
  matrices), and a pass that becomes a fail is a finding.
  `conformance.mjs` reads these instead of `KHRONOS_ASSETS` (the variable
  stays as a way to regenerate). **The run is no longer skipped on the
  build host.**

### G9. What doesn't change
`activate`, the server's checks and buckets, `script-ready`, the templates
and their form, the drag rule, Undo (behaviour writes aren't undone, D4),
Duplicate (an imported graph's references are all in `nodeMap`, `targets`
and `animations`, which F-L10 already remaps), the send queue, the vendored
engine's files (nothing in `packages/gltf-interactivity-engine` is edited;
every change is a subclass or an instance property in the adapter).

## 5. Open questions for the reviewer
- **Q1. G-L3 (a)'s trust shift.** The server stops refusing ops it doesn't
  run, and the page's registry becomes the only gate. Is "delete by
  allowlist, pinned by an exact key-set test" enough, or should the server
  keep refusing a short denylist (for example any op whose name says
  `network`, `fetch` or `js`) as defence in depth?
- **Q2. G-L5 (a) against design §5.3.** Is stepped motion for visitors an
  acceptable first cut, with the importer's warning, or should 4d-1 refuse
  `pointer/interpolate` on transforms until (b) exists?
- **Q3. `onStart` re-running** on every host change (P14). An `onStart`
  that sets a door closed re-closes it whenever the owner opens a tab. Is
  the importer's "starts on load" note enough?
- **Q4. `onSelect`'s outputs.** A select from the runner or a forward
  passes no selection point or ray (4b-2 F4: `select(index, 0, undefined,
  undefined)`). A graph that reads them gets the engine's defaults. Should
  the importer flag a graph that reads them?
- **Q5. The per-frame budget's fairness.** A rotating start keeps one heavy
  behaviour from starving the rest, but it lets every behaviour run slower
  together. Is that the right failure, or should a behaviour that is
  skipped for N seconds be disabled?
- **Q6. The per-tick budget against real graphs.** `p6`'s `math/random`
  conformance graph is disposed `over-budget`: one tick runs past 10,000
  node starts. The budget was set in 4b-2 for templates and for runaway
  loops. Keep 10,000 and accept that such graphs are refused at run time,
  or raise it with the frame budget to match?

## 6. Tests

| Item | Tests | Proof of failure |
|---|---|---|
| G1 | the vectors through **both copies and the validator**; each new limit at its boundary and one past; the string rules; `event/send` to `atrium/*`; literal and wired refs; an unknown extension op accepted; **a `math/combine3` reading an `event/onHoverIn` output refused, and a hover node that only ends a flow accepted** (`p3`); each 4b-2 vector that moves sides | (a) accept `event/send` to `atrium/interval` in one copy only; (a2) skip the ref bound in the server copy; (a3) drop the value-read rule in one copy |
| G2 | server, port 0, real sockets (signin-sync §4.1): a 4d graph accepted, broadcast, saved and **re-read through healing**; a 65,537-character one refused with nothing broadcast; **election:** `scriptRunner: 2` never elected, `3` elected; each of the two places alone (4c's P22 pattern); N1's line has a `logId` | (b) elect on `2` in the `hello` path only; (b2) in `canRunBehaviors` only |
| G3 | the real engine, a fake world, fake timers **and a fake `now`**: **the registry's key set equals the allowlist exactly**; an unsupported flow op is a `NoOpNode` and its downstream never runs; **with the rule bypassed (`skipRules`), a running node reading an unsupported value op disposes the engine `engine-error` at its first tick** (`p3b`, the reason G1's rule exists); **with `performance.now` and the global `setTimeout` replaced by throwing stubs**, every G-L2 op runs; delays: `done` after the injected time, `cancel`, `cancelDelay` by `lastDelay`, the 17th `err`, the table reused (`p5`), `dispose` clears every timer with the injected `clearTimeout`; `onTick`'s `timeSinceStart` follows the fake clock; an interpolation replaced mid-way; `globalMatrix` of a nested node matches `worldMatrix`; light colour; a send/receive loop runs once per tick; a doubling fan-out disposes `over-budget` (`p7`) | (c) delete by a denylist (the key-set test fails after adding a fake op to the engine's registry); (c2) schedule with the global `setTimeout` (the stub throws); (c3) leave `dispose` to the engine's own `clearTimeout` (a fake timer still fires) |
| G4 | the runner with a fake client: **the frame budget:** three engines each doing 6,000 steps per tick, with the 10,000 budget, tick two per frame and all make progress over three frames in rotation, and none is disabled; one doing 10,001 in a tick is disposed as now; **the overlay:** `get → add → set` on `onTick` for 30 frames with **no echo** advances 30 times; an echo for an older seq doesn't clear a newer value; a rejection clears it; another session's `som:set` replaces it; a drag drop clears it; "Partially supported" for a graph with a hover op | (d) clear the overlay on any echo for the key (the older-seq test fails); (d2) a fixed tick order (the third engine starves) |
| G5 | the hello with `scriptRunner: true` carries `3`; without it no key; **the captured hello accepted by the three frozen schemas** (pre-4b-2, `71b6e40b`, `14ab0076`) | (e) send `scriptRunner` cross-origin |
| G6 | the pure importer: each source shape; a `.glb`'s JSON chunk; a 4 MiB + 1 source refused; references found for literal indices, literal refs, `nodeIndex` and animations; **a wired index refused with its node named**; two `onSelect` nodes refused; the conversion of a survey asset that fits (the graph from G8's set) **passes `behaviorCheck`** and keeps its write log when run with the mapping (`nodeMap` permuted, results equal); `enabled: false`; the grants list; **the panel through the strict DOM fake:** a graph whose op name is `<img src=x onerror=…>` shows as text | (f) don't permute `[x]` literals (the write log differs); (f2) render op names as HTML (the guard fails) |
| G8 | every fixture's write log matches exactly; the Khronos subset's pass list matches exactly, **on the build host** | (g) widen the allowlist by one op in the adapter only (a fixture's log changes) |

**Proofs:** commit first; break the file, run, record the failing test
names, restore the file **from a saved copy, never with `git checkout`**,
re-run green. "Not reproducible" is not an acceptable result. **Each proof
claim quotes the output of both runs** (4c passdown §4.4). One proof at a
time on the 4 GB host.

### 6.1 Claude's browser checks (after publish, before DEV acceptance)
In the harness (`devtasks/harness/`, new `checks/scripting-4d/`), with the
real sign-in:
1. **Import a fixture graph** (on select: a delay, then hide a target, then
   show it after 2 s) onto a cube through the panel: the mapping table, the
   grant, saved disabled; enable; a click hides and shows it in a visitor's
   tab.
2. **`onTick` rotation:** a graph that adds to a cube's rotation every
   frame. In the host it turns at a speed that doesn't depend on the echo
   (the overlay); in the visitor it steps, at most 20 times a second (the
   socket log).
3. **`pointer/interpolate`** of a translation over 2 s: the visitor's last
   value equals the target.
4. **"Partially supported":** a graph with `event/onHoverIn` and a
   `/materials/…` pointer: the list, and the rest runs.
5. **The frame budget:** eight heavy `onTick` graphs; the host's frame time
   stays bounded (the log's skip lines), nothing is disabled, and a light
   graph still runs.
6. **A stale owner tab** (a 4c page, `scriptRunner: 2`): never the host; a
   4d tab takes over (G-L9).
7. **XSS:** a graph whose op and event names are HTML shows them as text.
8. **Restart from the saved document:** every imported graph is back and
   runs; healing logged nothing.
9. **Regression:** 4c's checks 1–13, 4b-2's `r7.py`, `f3.py`,
   signin-sync's `c.py` and `c4b.py`, the regression set with a baseline
   (`reg4c.sh`, `regdiff.py`).

## 7. DEV acceptance (operator, Firefox, hard reload in every tab)
1. **Import** the "on select: wait, then hide" fixture onto a cube, map its
   target to a library model, review the grant, Save. It shows disabled.
   Enable it; click the cube: after the delay the model hides; a private
   window sees the same.
2. **Import the rotation graph** onto another cube. It turns in the owner's
   window, and in the visitor's window it turns in visible steps (as
   expected: G-L5 (a)).
3. **A graph with an unsupported op:** "Partially supported" with the op
   named; the rest of it works.
4. **Reload the owner's tab:** the rotation restarts from where the cube
   is; nothing else changes.
5. **A second owner tab** takes over when the first closes, and the
   imported graphs keep running there.

## 8. Worker rules and release path
As scripting-4c, with this round's specifics:
- **Steps, one commit each, every commit runnable:**
  1. G1: both copies of the rule, the vectors and `gen-vectors.mjs`, the
     schema's `scriptRunner: 3`;
  2. G3: the adapter (registry gate, clock, delays, pointers, report), with
     `worldMatrix` in `@atrium/som` and its re-export;
  3. G4: the runner (frame budget, overlay, status);
  4. G2 and G5: election on `3`, the client's `3`, the frozen fixture, N1;
  5. G6: the importer module, its panel and its wiring guards;
  6. G8: `conformance.mjs` on the checked-in subset, the expected list;
  7. full suites (server files each on its own), proofs (a)–(g) with every
     sub-proof, and the handoff.
- **Each commit's report lists the suites run at that step** and names any
  test deferred to a later step.
- **The seam rule (signin-sync §4.1):** G3's tests use the real engine;
  G4's the real adapter; G6's conversion test runs the converted value
  through the real adapter.
- **The fixtures are the operator's, not the implementer's** (G-L11): the
  round may not edit `tests/fixtures/behavior-conformance-4d/`. A fixture
  the code can't pass is a finding in the handoff.
- **Every stored or displayed string from a graph has its bound and
  character set in the rule, and reaches the DOM as text** (4c passdown
  §4.1; G6).
- **Nothing in `packages/gltf-interactivity-engine/` changes;** the hash
  test stays green.
- **`--max-runtime 4h`**, and check the implementation card's cap after
  creation.
- **A protocol and server round:** DEV restarts at the deploy. **Acceptance
  needs a hard reload in every tab** (G-L9).
- **Rollback (P17):** a rollback to 4c deletes every 4d-only behaviour at
  each world's next load. If a rollback is ever needed, restore from the
  pre-release PROD backup, don't redeploy over the live database.
- **Kickoff cards (4c passdown §4.5):** the front door creates the sentinel
  first and puts the base commit, this file's hash, the operator's
  decisions and the sentinel id **in the kickoff card's body**. "Write each
  card's body from the bullets under its title; don't copy this kickoff's
  own instructions into any card."
- **Both outside reviews.** The reviewer can't clone (4c passdown §4.3):
  send them the compare URL and the files, ask them to run what they can,
  and keep Claude's own real-server reproductions of their findings.
- **Never push to `main` between the release merge and the MAIN push.**

## 9. Notes for the brief author
- **The validator still makes every stored graph a DAG; loops are now run
  time** (P10): through `event/send`, through a delay's `done`, through
  `onTick`. The per-tick budget catches a runaway tick, the pending-delay
  cap a runaway timer tree, and the frame budget a sustained load. Name all
  three in the brief; none replaces another.
- **The registry gate is the security boundary for ops** (G-L3 (a)). Put
  the key-set test in step 2, and make the brief say "delete everything
  not in the allowlist" in those words.
- **A forward isn't a run, and now a run isn't a send** (4c N3; G-L5): a
  value written every frame is sampled, and only the last one is certain.
- **The overlay's clear rule is the subtle part** (G4). Each seq records
  the value it carried, and only the answer for the newest seq on a key
  clears it.
- **Variables and pending delays don't survive** a reload, a host change
  or a world load (P14; design §5.2). The importer's report says
  "keeps state", and the help text says when it resets.
- **The survey (§2.4) is a static count; `p6` is a run** of the indexed
  subset through today's adapter. Use `p6` for what passes, and §2.4 for
  sizes and shapes.
- **An unsupported value op crashes its reader** (P9, `p3b`). G1's static
  rule is what keeps "partially supported" true; test it from both sides
  (the rule refuses, and with the rule bypassed the engine disposes).

## 10. Next rounds
- **4d-2 — `KHR_animation_pointer` models** (4b-1 passdown §6.3): three.js
  r163's `GLTFLoader` skips those channels. This draft found no support in
  core three.js (the long-standing PR, #24108, was unmerged in every source
  it found; the reviewer should confirm); Needle
  publishes a `GLTFLoader` plugin, `@needle-tools/three-animation-pointer`
  (1.1.2, June 2026). Its own short pre-brief: which three.js versions the
  plugin supports, vendoring it the way the engine was (B2 (a)), and the
  panel's "has animations, none playable here" text in the meantime.
- **Material pointers** (G-L4 (b)), with an authority rule for shared
  materials.
- **A synced transition** (G-L5 (b)), so interpolations are smooth for
  every client.
- **Embedded graphs in placed models** (§2.4): a model's own graph run
  against its own instance. Per client, or by the host with the inner
  nodes made addressable; a design question first.
- **Automatic mapping by name** (G-L8 (b)); **a per-behaviour distance**
  (G-L10 (b)); **whole-world import** (design §7 item 6).
- Carried, unchanged: the 4c passdown §6.3–§6.5.

## 11. Review log
- **Rev 0** (2026-10-30, evening PT): drafted by Claude from the 4c
  pre-brief §10 and AC-L2, the 4b-2 pre-brief §9, §2.3, F-L2–F-L4, F1,
  F4, F5, F7 and F11, the design §5.3–§5.5, §6 and §7, the 4b-1, 4b-2,
  signin-sync and 4c passdowns, code reading at `41acd2ff`, and a static
  survey of the Khronos assets at `926bec45` (§2.4), probes `p1`–`p7`
  (§2.5; `devtasks/spike-4d/`) and the base suites (status). The probes
  changed three things before anyone read the draft: G1's value-read rule
  (`p3`), the frame budget of 10,000 (`p2`), and G8's baseline (`p6`).
  Open: G-L1–G-L12, Q1–Q6.
