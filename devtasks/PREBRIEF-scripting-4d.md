# Pre-brief: Phase 3 step 4d — graphs beyond the templates: the wider runtime and the graph importer

Status: **DRAFT, Revision 1 (2026-10-30, night PT). Decisions G-L1–G-L12
are open; each has a recommendation.**
- **Rev 1 applies the outside review of Rev 0**
  (`devtasks/REVIEW-scripting-4d-rev0.md`, CHANGES REQUESTED: 4 must-fix,
  7 should-fix, 2 nits; source-only, because the reviewer's environment
  couldn't resolve `github.com`). The reviewer agreed with every
  recommendation, four of them with conditions that this revision meets.
  Claude checked each finding at the code and ran the reviewer's prepared
  probe for M1 and a new one for M3 and S1 (`r1`, `r2`, §2.5): **M1, M2, M3
  and S1 are now verified by running code**, not only by reading it. **All
  are taken.** No decision changes. §0 lists what changed, and §11 maps
  each finding.
- **Drafted by Claude from `main` at `41acd2ff`.** Its code is identical to
  the released `14ab0076` (DEV, MAIN and PROD): the commits on top touch
  only `devtasks/`. Line numbers are at that commit. The vendored engine is
  `packages/gltf-interactivity-engine/build/index.js` (12,005 lines, sha256
  `23a4604c…70b6`, as `VENDORED.md` records).
- **How it was checked.** Claude read the code at `41acd2ff`, surveyed the
  Khronos assets' JSON at the pinned `926bec45` (§2.4; the scripts are in
  `devtasks/spike-4d/survey/`), and ran probes `p1`–`p7`, `r1` and `r2`
  (§2.5; `devtasks/spike-4d/`) and the suites nearest this round at the
  base: `@atrium/behaviors` 176 pass and the one named `KHRONOS_ASSETS`
  skip; protocol 122; som 255; server `activate` 24, `behavior-leaf` 27,
  `behavior-walk` 9, `script-host` 11, all pass. The app itself wasn't
  opened in a browser; `p2-page` used a minimal page with the app's import
  map.
- **Order (scripting-4c passdown, first instruction 3):** 4d needs this
  pre-brief and **both outside reviews** (of this pre-brief, and of the
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
    production passes);
  - **the outside review of Rev 0** (`devtasks/REVIEW-scripting-4d-rev0.md`).
- **Scope:** the runtime for graphs beyond the templates (the wider op and
  pointer allowlists, variables, `event/onStart`, `event/onTick`,
  `event/send`, `flow/setDelay` with timers the adapter owns,
  `pointer/interpolate`, the limits that make them safe); what an
  unsupported operation does and how the owner is told; an importer that
  puts one standard graph onto the selected object; the conformance
  fixtures; a rehearsed rollback.
- **Out of scope** (as recommended, G-L1): `KHR_animation_pointer` models
  (their own round, 4d-2: it is renderer work with no graph in it); material
  pointers (G-L4, recorded first in §10); whole-file and whole-world
  conversion (design §7 item 6; §2.4 explains why it can't work for placed
  models today); the graphical editor (step 5); JavaScript (step 6);
  behaviours while the owner is away (design §7 item 2); `hover` and
  visitor-side `change` (4c §10); a per-behaviour distance (G-L10, unless
  the operator picks (b)); a synced transition leaf (G-L5 (b)).

## 0. Changes

### 0.1 Revision 1 (the review of Rev 0)
- **M1, an extension can run a core op:** **verified** (`r1`). A
  declaration that names an allowlisted op **and** any extension runs the
  real core class (`flow/sequence` ran as `Sequence`; an extension-qualified
  `event/onTick` was still ticked), because the loader looks up the op name
  alone (P19). **The gate is now by executable identity, `(op,
  extension)`** (G-L3, G1, G3): bare core ops on the allowlist, plus exactly
  `(event/onSelect, KHR_node_selectability)`. The adapter loads a **copy**
  of the graph in which every other declaration is renamed to an inert op,
  so the engine never builds a class for it. The value-read rule and
  `graphReport` use the same identities. The registry key-set test stays as
  a second line, and the reviewer's probe becomes a test through the real
  loader.
- **M2, the overlay can't tell its own echo from another session's set:**
  **verified** (P20). The host's own echo emits `som:set` in exactly the
  shape of a remote set, just before `edit:accepted`. **`som:set` gains
  `origin` (`'own'` or `'remote'`) and, on own echoes, `requestSeq`** (a
  local event change, not a wire change; G5). The overlay keeps a revision
  per key, and only the answer for that key's latest revision clears it. A
  remote set clears the entry and drops this host's not-yet-sent write for
  that key (G-L6, G4).
- **M3, the "no `performance.now()`" test can't pass:** **verified** (`r2`):
  `executeEventQueue` calls it on every tick (L8669), so a throwing stub
  disposes the engine. **The contract is narrowed** (the reviewer's (a)):
  what every op *observes* is the injected clock. The engine still reads
  `performance.now()` internally, and the vendored file stays unedited. The
  test now changes the real clock and checks that op outputs follow only
  `now` (G3).
- **M4, reused delay slots let a stale handle cancel the wrong timer:**
  accepted. **Delay ids are monotonic** and never reused; only live ones
  are kept (a `Map`), and a stale id is a no-op (G3).
- **S1, defaults that aren't numbers reach writes:** **verified** (`r2`): a
  `pointer/get` of an unregistered path writes `[NaN, NaN, NaN]`, and
  `onTick`'s first `timeSinceLastTick` writes `NaN`, both `null` on the wire
  (P21). **Every write is checked at the runner's boundary** (finite
  numbers, the field's shape) before it is queued or put in the overlay; a
  bad one is refused and logged once (G4).
- **S2, a count isn't a time:** the per-frame budget is now **10,000 node
  starts or 8 ms of the runner's clock, whichever comes first** (G4, G7).
  A stress check measures the frame time with 64 behaviours (§6.1), and a
  behaviour that keeps being skipped says "throttled" (Q5). The
  interpolation callbacks run outside the node count (P13) and are covered
  by the time limit. Being `async`, they need their own error test (G3).
- **S3, the last value isn't certain:** G-L5 (a) no longer says it always
  goes out. It does **while the host stays the host until it is sent**, and
  a test interrupts an interpolation at 1.99 s (G4, §6.1).
- **S4, the importer's adversarial inputs:** GLB header and chunk checks,
  byte and depth limits before conversion, **every typed ref literal in the
  graph** remapped or refused (not just pointer configurations), and a
  conversion that would retarget anything silently is refused (G6).
- **S5, the world's total:** a **per-world limit of 1 MiB (UTF-8) of stored
  behaviour**, checked on `send`, `add` and healing, and a measured
  `som-dump` at that limit in the browser checks (G2, G7, §6.1).
- **S6, rollback:** roll forward by default. A **rehearsed rollback** on a
  copy of PROD's data is part of the release gate, with an export tool that
  keeps every 4d-only behaviour so it can be restored. Unreloaded 4d pages
  are refused by a rolled-back 4c server (its schema doesn't know
  `scriptRunner: 3`), and that is documented (§8).
- **S7, `onStart` and `onSelect`'s missing outputs:** the warning text says
  what really happens ("runs again on every owner reconnection, handover and
  re-enable, and may overwrite what visitors changed"), shown at import and
  at Enable. `graphReport` names reads of `selectionPoint` and
  `selectionRayOrigin` (G3, G6).
- **N1, units:** a leaf's limit is in UTF-16 code units (`JSON.stringify`
  length, as 4b-2's); the world total and the import source are in UTF-8
  bytes. Boundary tests use multi-byte strings (G7).
- **N2, reproducibility:** the survey scripts are in
  `devtasks/spike-4d/survey/`, and G8's checked-in subset carries a manifest
  (asset commit, sha256 per file, the baseline result per asset).

## 1. What 4d delivers

| Who | What they get |
|---|---|
| **The owner** | In the Behaviour section, **"Import a graph…"**: paste a `KHR_interactivity` graph (or open a `.gltf`/`.glb` that carries one), map each object, light and animation the graph refers to onto this world's objects, see what Atrium can't run, review the grants, and save it **disabled**. Enable it like any behaviour. A saved graph that uses operations Atrium doesn't run says **"Partially supported"** and lists them. Graphs can now keep state (variables), start on load, run every frame, wait (delays) and animate a value over time |
| **Visitors** | The effects, as ordinary `set` broadcasts, exactly as today. Values a graph changes every frame or over time reach them **as steps** (at most 20 sends per second for the whole world), not smooth motion (G-L5) |
| **The server** | A wider `behavior` rule (both copies): variables, more events, `{ref}` and wired pointer sockets, operations it stores but the page never runs (G-L3), the new size limits and a per-world total (G7). `scriptRunner: 3` in `hello` (G-L9). No new message |
| **The repo** | The adapter's own delays and the ops' injected clock, an executable-identity gate on what the engine may build, a per-frame budget for the world, write checks at the runner's boundary, the importer (a pure module and its panel), independently written conformance fixtures and the Khronos subset checked in, a rollback export tool |

**As recommended, it is one round (4d-1) with seven steps** (G-L1), and
`KHR_animation_pointer` models are a separate small round (4d-2). 4d-1 runs
far more kinds of world-supplied graph than 4b-2 did, so it keeps both
outside reviews.

## 2. Verified facts (at `41acd2ff`)

### 2.1 The rule, the adapter and the runner today
**P1. The op allowlist is exactly the templates'.** `BEHAVIOR_OPS`
(`packages/behaviors/src/behavior-spec.js` L64–67) is ten ops: `event/onSelect`,
`event/receive`, `flow/branch`, `pointer/get`, `pointer/set`, `math/not`,
`math/gt`, `animation/start`, `animation/stop`, `debug/log`. The server's
copy is `send-policy.js` L537. A declaration outside it is `behavior-op`
(L388), and every declaration but `event/onSelect` must be exactly `{ op }`
(L393–395), so today no stored declaration can carry a stray extension.

**P2. What else the rule refuses today**, each one a thing 4d needs:
- **any `variables` key** (`behavior-spec.js` L376; server L731);
- **any event id but the three Atrium ones** (L411–418, `BEHAVIOR_EVENTS`
  L70), and any event entry with `values`;
- **every `{…}` pointer template** (the patterns at L86–90 match only
  `[n]` or a literal index) and **every socket-connected index**
  (`pointerIndex` L554);
- **more than 64 nodes, 32 declarations, 16 types or 8 events, or a value
  over 16,384 characters** (L30–34, L362, L373–381). The 16,384 is
  `JSON.stringify(value).length`, UTF-16 code units.

The engine's validator still runs last (L524–528), after every Atrium rule.

**P3. The pointers the page registers.** `registerKnownPointers`
(`adapter.js` L155–175) registers, **for each `nodeMap` index only**,
`translation`, `rotation`, `scale` and `KHR_node_visibility/visible`, plus
`KHR_lights_punctual/lights/<i>/intensity` when that node hosts a light. Any
other path resolves nowhere: a `set` or `interpolate` takes `err`, and a
`get` returns the type's default with `isValid: false` (P21). Every setter
passes `mayWrite` (L327–342: the own node, a descendant in the SOM, or a
granted id).

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
`onTick`, delays and interpolations inherit this. (From the source; the
browser's background throttling wasn't tested here.)

### 2.2 The engine (`packages/gltf-interactivity-engine/build/index.js`)
**P9. An op the registry doesn't have becomes a no-op.** `loadBehaveGraph`
builds a `NoOpNode` for any op missing from `engine.registry` (L8506–8510).
A `NoOpNode` (L6604–6624) does nothing when its input flows are activated,
never activates an output flow, and outputs the type's default for every
socket **its declaration** defines. That is the spec's rule (§2.6). The
engine's value and control compilers skip extension declarations and any
node whose constructor isn't the standard class (L36, L233). **`p3`/`p3b`
found the catch:**
- for a **flow** op (`flow/sequence`) deleted from the registry, nothing
  downstream runs, and nothing throws;
- but **a core declaration defines no sockets, so a no-op'd core value op
  has no outputs at all.** When a node that runs reads one (`math/combine3`
  reading a deleted `math/add`), the graph **loads, then the first tick that
  evaluates it throws** ("… depends on output socket "value" of "NoOp
  (unsupported op "math/add")" …"), and the adapter disposes the behaviour
  (`engine-error`). An extension declaration that lists its sockets gives
  defaults instead, which can be `NaN` (P21). So "the rest runs" holds only
  when nothing that runs reads an unsupported node's values (G1).

**P10. The validator accepts any op that names an extension.** A
declaration with no `extension` must be a known core op ("unknown core
operation", L11908). One **with** an extension takes its value sockets from
the declaration itself (L11918), whatever its op is called. Flows must still
point to a later node (L11933). **Stored graphs stay DAGs, but they can now
loop at run time:** an `event/send` to an `event/receive` earlier in the
graph runs on the **next** tick (events queued during a tick wait, L8677),
and a delay's `done` does the same after its timer. So loops become
possible, at no more than one lap per tick or per delay, and the per-tick
budget (P4) still caps each tick. **`p7`:** a send → earlier receive loop
runs exactly one lap per tick (2 steps a tick for 30 ticks), and a doubling
fan-out (one receive, two sends) doubles each tick (2, 4, … 8,192) and is
disposed `over-budget` on its 14th tick.

**P11. `flow/setDelay` uses the global timers and a table that only
grows.** `SetDelay.processNode` (L4367–4424) calls the global `setTimeout`
(L4409) and `pushScheduledDelay` (L8356): **one array slot per delay ever
scheduled**. A fired or cancelled delay's slot is set to `undefined`
(`removeScheduledDelay`, L8374–8381), never reused, which is also what keeps
an old `lastDelay` handle from ever naming a newer delay. `dispose` (L8344)
clears the table with the global `clearTimeout` (L8331–8343). Durations that
are NaN, infinite, negative or over 2^31 ms take `err`. **There is no limit
on pending delays.** **`p5`:** after 10,000 ticks of `onTick →
setDelay(0.001)` the table has 10,000 slots and 10,000 pending timers; once
they've fired it still has 10,000 slots, none pending; only `dispose`
empties it. 4b-2 §2.3 already set the rule: a subclass that owns its timers
keeps its own ids and clears them itself, or a fake-timer test of "dispose
cancels every timer" passes against nothing.

**P12. The engine's clock is `performance.now()`, read in the tick.**
`executeEventQueue` sets `_lastTickTime = performance.now()` at the start of
**every** tick (L8669). `lastTickTime` is a getter on the class
(L8204–8206). `event/onTick`'s `timeSinceStart` and `timeSinceLastTick`
(L1103–1152), `flow/throttle` (L1456) and every interpolation (L8581–8616,
L6578) read the getter. **`p1`: shadowing the getter on the instance works**
(`Object.defineProperty(engine, 'lastTickTime', { get })`): with fake ticks
at 1,000, 1,500, 2,500 and 4,000 ms, `onTick`'s `timeSinceStart` wrote 0,
0.5, 1.5 and 3; an interpolation to x = 10 over 1 s wrote 0, 2.5, 5 and 10
at 0, 250, 500 and 1,000 ms; a 1 s `flow/throttle` let through the ticks at
0, 1,000 and 2,050 ms only. **`r2` (the review's M3):** the tick itself
still calls `performance.now()`, so with it replaced by a throwing stub the
engine is disposed `engine-error`; with the real clock jumping by 777 ms a
call and the injected clock moving 1,000 → 1,250, `timeSinceStart` wrote 0
and 0.25. Op outputs follow the injected clock; the engine's own call
stays.

**P13. Interpolation runs once per tick, one per pointer.**
`pointer/interpolate` (L5231–5291) reads the start value through the
registered getter, then `animateCubicBezier` (L8581) **replaces any running
interpolation on the same path** (L8582) and registers a callback that
`executeEventQueue` runs every tick (L8689–8695), writing through the
registered setter, and so through `mayWrite` and the runner's queue.
`variable/interpolate` does the same per variable. **Both are bounded in
number:** there can't be more active interpolations than registered
pointers plus declared variables. **But they cost outside the node count**
(the callbacks don't call `processNodeStarted`), and **the callback is an
`async` function called without `await`** (the review's note on P13): a
throw inside it is a rejected promise, not a throw out of the tick, so the
tick wrapper never sees it. The adapter's `dispose` already clears both
maps (`adapter.js` L392–393).

**P14. `event/onTick` runs at the end of every tick** (L8697–8705), after
the queue and the interpolations. `event/onStart` is queued at load
(L8521–8528) and so runs on the engine's **first** tick. An engine is
created on every enable, reload, world load and host handover, so **a
graph's `onStart` runs again each time, its variables start over, and its
pending delays are gone.** The design accepts the restart ("the runner
starts fresh on handover", §5.2).

**P15. Pointer templates:** `[x]` is an **int** socket and `{x}` a **ref**
socket (`parsePathTemplate`, L533; the validator's check, L11977–11986).
At run time a ref value such as `"/nodes/2"` is spliced into the path, so
`/nodes/{r}/translation` with `r = "/nodes/2"` resolves to the registered
`/nodes/2/translation` (4b-2's `r2`: "every spelling writes"). **`p4`, with
`nodeMap` indices 0 and 1 registered:** a `{r}` ref `"/nodes/1"` sets,
gets and interpolates node 1; a ref `"/nodes/9"` takes `err` on `set` and
`interpolate` and gives `isValid: false` on `get`, writing nothing; a wired
`[i]` of 1 writes node 1, and a wired `[i]` of 9 takes `err`.

**P19. The loader builds a class from the op name alone (the review's M1).**
`loadBehaveGraph` takes `nodeType = nodeDeclaration.op` and asks
`this.registry.get(nodeType)` (L8503–8510); the declaration's `extension`
plays no part. The `onTick` and `onStart` lists are built from the op name
too (L8520–8521). **`r1`:** a graph whose `flow/sequence` declaration
carries `extension: 'EXT_probe'` passes the validator, builds a `Sequence`
and writes, exactly like the bare core op; an `event/onTick` with
`extension: 'EXT_probe'` builds an `OnTickNode` and is ticked. **So a
registry that holds only allowlisted names doesn't stop an extension
declaration that borrows one of those names.**

**P21. Default values that aren't numbers (the review's S1).** A
`pointer/get` of a path nothing registers outputs the type's default and
`isValid: false`; for a float type the default is `NaN`. `onTick`'s first
`timeSinceLastTick`, and `onSelect`'s `selectionPoint` and
`selectionRayOrigin` when the select passes none (Atrium's `select(index, 0,
undefined, undefined)`, `adapter.js` L411–415), are `NaN` too, and so are
`math/NaN`'s and `math/Inf`'s outputs by design. **`r2`:** a get of
`/materials/0/…/baseColorFactor` fed straight to a `pointer/set` of a
translation wrote `[NaN, NaN, NaN]`; `onTick`'s first `timeSinceLastTick`
wrote `[NaN, 0, 0]`. Both are `[null, …]` once serialized. Today's setters
pass them to `world.set`, which queues them (`runner.js` L194).

### 2.3 The client and the server
**P16. `scriptRunner`.** `hello.client.json` accepts `1` and `2` (L35).
Election and handover require `2` (`session.js` L554–555, L815), and
`AtriumClient.connect` sends `2` only when asked, which `connectNow` does
only same-origin (`AtriumClient.js` L595, L757). This is 4c's S2 pattern,
which 4d repeats (G-L9). A server's schema refuses a value it doesn't know,
so after a rollback to 4c, a 4d page's same-origin `hello` (`3`) is refused
until the page reloads (§8).

**P17. Load healing drops what the current rule refuses.** At world load,
a behaviour that fails F1 is replaced by `null` and logged
(`world.js` L422–451), and the next autosave writes the `null`. **So a
rollback from 4d to 4c deletes every behaviour that only 4d's rule accepts,
on each world's next load.** Restoring the pre-release backup would also
throw away every edit made since the release (the review's S6), so §8 adds
a rehearsed export-and-restore instead.

**P18. The light fields.** `LIGHT_FIELDS` (`send-policy.js` L75) includes
`color`, so a light-colour write needs no server change. Material writes
exist on the server (the chain at L56–67, L1368–1398: `baseColorFactor`,
`emissiveFactor`, …) but address a node's `mesh.primitives[N].material`,
not a glTF `/materials/<i>` index (G-L4).

**P20. `som:set` doesn't say where it came from (the review's M2).** A
remote set emits `som:set { nodeName, path, value }` (`AtriumClient.js`
L1643; L1630 for a rename). The host's own echo of a tracked send emits the
**same shape** (L1677, L1685, L1696 and, for `sendField`, L1707), applied
before the `edit:accepted { seq, requestSeq, … }` that follows it on L1710.
So a listener can't tell at `som:set` whether the value is this tab's own
write coming back or another session's write.

### 2.4 The Khronos assets: a static survey (`glTF-Test-Assets-Interactivity` @ `926bec45`)
Claude fetched the assets at the commit the repo pins and read every graph's
JSON with the scripts in `devtasks/spike-4d/survey/` (no engine, no repo
code). Each asset ships as `.glb` and `.gltf`, so it was counted once: **178
distinct assets carry a graph, 161 under `Tests/` and 17 sample models under
`Models/`**. These are mostly test graphs, so they show what the standard's
own authors write, not what Atrium owners will.
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
- **Size:** median 84 nodes and about 13,000 characters. **56 of 178 fit
  4b-2's 64 nodes and 16,384 characters; 154 fit 256 nodes and 65,536**
  (with the ops). Variables reach 32 and events 8 among those 154.
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

### 2.5 Probes (2026-10-30, `devtasks/spike-4d/`)
Run by Claude from the repo root against the workspace's real adapter and
vendored engine (Node 22.23.4; Chromium 153 through Playwright for
`p2-page`). The README there says how to run each.
- **`p1` the clock: works** for every op that reads the getter (P12).
- **`p2` step cost.** Through the real adapter, one node start costs
  **0.28–0.36 µs in Node and 0.18–0.34 µs in Chromium** on this machine
  (a flow-heavy graph at 7,504 steps a tick, a math-heavy one at 5,604),
  so 10,000 steps take about 2–3.5 ms here. **This is a count, not a time**
  (the review's S2): heavier ops (matrices, SOM reads) and the
  interpolation callbacks cost more and partly outside the count, and an
  owner's laptop may be several times slower. G4's frame limit is
  therefore both a count and a time.
- **`p3`/`p3b` the registry gate.** Keep-by-allowlist takes the registry
  from 138 ops to exactly the kept set. A deleted flow op stops its flow
  quietly; **a deleted core value op that a running node reads throws at
  that node's first evaluation** (P9).
- **`p4` refs: as P15 says**, eight cases.
- **`p5` the delay table leaks** as P11 says.
- **`p6` the Khronos subset through today's adapter.** Of the 156 indexed
  conformance assets, **143 fit G-L2 (a)'s ops and G7's sizes**. Each was
  run through the real adapter (today's: the engine's own timers and clock;
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
  This is G8's baseline, not its expected list.
- **`p7` loops through events: as P10 says.**
- **`r1` (the review's M1 probe, with two controls): as P19 says.**
- **`r2` (M3 and S1): as P12 and P21 say.**

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
    (both copies), the adapter's runtime, the runner's budgets, reads and
    write checks, the importer, the capability, then the fixtures, suites
    and proofs. **`KHR_animation_pointer` models are 4d-2,** a separate
    small round with its own short pre-brief: it is renderer work with no
    graph in it (§10).
  - (b) Three rounds: the runtime (console-only acceptance), the importer,
    then 4d-2.
  - (c) One round for everything, including animation pointers.

  (b)'s first round ships nothing an owner can use without the console,
  the shape 4b-2's F-L1 rejected. (c) mixes a three.js loader change (and
  probably a three.js upgrade or a vendored plugin, §10) into the round
  that most needs a narrow review. (a) keeps the importer with the runtime,
  so DEV acceptance is the owner's own flow. *Review: agreed.*

- **G-L2 — Which ops run.**
  - **(a) Recommended: the core set the survey needs** (§2.4: 171 of 178),
    **each as a bare core declaration** (G-L3):
    - **flow:** `sequence`, `branch`, `switch`, `doN`, `multiGate`,
      `waitAll`, `throttle`, `for`, `while` (the budgeted subclasses,
      `adapter.js` L102–113), `setDelay`, `cancelDelay` (G3's subclasses);
    - **events:** `onStart`, `onTick`, `onSelect` (exactly with
      `KHR_node_selectability`), `receive`, `send`;
    - **`variable/get`, `variable/set`, `variable/interpolate`;**
    - **`pointer/get`, `pointer/set`, `pointer/interpolate`;**
    - **every `math/*` and `type/*` op the engine registers, and
      `ref/eq`;**
    - **`animation/start`, `animation/stop`, `debug/log`.**
    - **Not run:** `event/onHoverIn`/`onHoverOut` (hover isn't in Phase 3,
      design §5.2); `event/stopPropagation` (a click already resolves to
      exactly one behaviour node, 4c AC2, so there is nothing to stop);
      `animation/stopAt` (4a's leaf has no end time, 4b-2 F4). Under G-L3
      (a) these are stored and inert.
  - (b) Event-driven only: (a) without `onTick` and the two interpolates.
  - (c) Everything the engine registers.

  (b) covers 156 of 178 and keeps every behaviour off the per-frame path,
  but `onTick` is the design's `frame` event (§5.3), and the per-frame
  world limit (G4) is what makes it safe. (c) includes hover and `stopAt`,
  which would run with the wrong meaning in Atrium. *Review: agreed, on
  condition that every admitted op is tested and the identity includes the
  extension (done: G1, G3, G8).*

- **G-L3 — What an unsupported operation does.**
  - **(a) Recommended: stored, inert, and reported.** The server's rule
    accepts any declaration the engine's validator accepts (within G7's
    limits and G1's string rules). **The page builds only executable
    identities** (Rev 1, M1): a bare core op on the allowlist, or exactly
    `(event/onSelect, KHR_node_selectability)`. Every other declaration,
    **including an allowlisted op name with any other extension** (P19), is
    renamed in the copy the adapter loads, so the engine builds a
    `NoOpNode` for it (P9). That is the spec's own rule (§2.6), and the
    design's "partially supported" (§5.5). A pointer outside G-L4's families
    is the same: nothing registers it. **The form and the importer list
    both** (G6), and the behaviour's status says "Partially supported".
    **One shape is still refused (`p3`, P9):** a node the page runs may not
    read a value output of a node it doesn't run. For a core op the engine
    throws at that read and the whole behaviour is disposed; for an
    extension op the reader gets a default that can be `NaN`. So an
    unsupported node may only end flows, never feed values.
  - (b) Refused, as 4b-2 does: the server refuses every declaration and
    pointer outside the allowlists, and the importer refuses the graph,
    with its report.

  The survey shows what (b) costs: none of the 17 sample models has only
  supported pointers, so under (b) any graph that touches a material
  anywhere is refused whole. **What (a) costs:** the server no longer
  guarantees that a stored graph is one Atrium runs completely. The
  guarantee that remains is the one that matters: **the page builds nothing
  that isn't an executable identity.** It rests on the adapter, in two
  layers: the renamed copy (by identity, M1) and the registry kept by
  allowlist (by name), each with its own test through the real loader. A
  later engine upgrade that adds an op can't run it without an allowlist
  change. *Review: revise (a), not (b), with the identity gate and no name
  denylist (done).*

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
      the `*.length` pointers. Under G-L3 (a) they are inert and reported;
      **a `get` of one still outputs a default** (`NaN` for floats, P21),
      which is why every write is checked (G4).
  - (b) (a) plus **material `baseColorFactor` and `emissiveFactor`**
    through a third table beside `animations` (`materials: [{ object,
    primitive }]`), written through the server's existing material chain
    (P18).
  - (c) 4b-2's families only.

  (b) is the most-used missing family (13 assets, and most sample models),
  but **a glTF material can be shared** by primitives on several objects.
  A behaviour writing one would change objects outside its own subtree,
  the "resources it shares" clause of the step 4 pre-brief's D5, which
  4b-2 F-L5 left with nothing to cover. That needs its own authority rule,
  a mapping UI and Duplicate remapping. Recorded first in §10. *Review:
  agreed.*

- **G-L5 — Values written every frame, or over time.**
  - **(a) Recommended: the host samples, and the existing queue sends.**
    `onTick` and both interpolations write through the setters every tick,
    and the runner's queue coalesces per field and sends one value per
    opportunity (P7), **so visitors see steps**, at most 20 a second for
    the whole world, shared round-robin by every key in the queue. A
    queued key takes each newer value in place, so **the last value an
    interpolation writes goes out as long as this tab is still the host
    when that key's turn comes** (Rev 1, S3). If the host closes, loses
    the role or disables the behaviour first, visitors keep the last value
    that was sent, and the next host starts from the SOM. The importer and
    the status line say so whenever a graph writes on `onTick` or
    interpolates (G6).
  - (b) A **synced transition**: the host sends one message per
    interpolation (target value, duration, easing, a server-stamped start,
    like 4a's animation leaf), and every client animates locally. Smooth
    for everyone, one send per transition; a new leaf or message, renderer
    work, and its own round.
  - (c) Interpolations send only their final value; `onTick` writes as in
    (a).

  **(a) is an explicit, temporary departure from the design's "continuous
  motion never goes over the network" (§5.3)** for these two ops, bounded
  by the world's send budget. Smooth motion is still the design's way:
  start a glTF animation. (b) is the right long-term answer and is recorded
  in §10. (c) makes `pointer/interpolate` jump for everyone, including the
  host. *Review: acceptable as a stated deviation without an unconditional
  final-write promise (done).*

- **G-L6 — A graph reads its own writes.**
  - **(a) Recommended: an overlay in the runner, keyed by revision** (Rev
    1, M2). `world.get` returns the host's **latest accepted-for-queueing
    write to that key** while it is queued or in flight, and the SOM value
    otherwise. Each write to a key gets the next revision. **Only the
    server's answer for the key's latest revision clears it** (the own echo
    with that `requestSeq`, or a rejection or unknown for it). An older
    revision's answer changes nothing. **Another session's set** (a
    `som:set` with `origin: 'remote'`, G5) clears the entry and drops this
    host's not-yet-sent write for that key: the remote write wins over
    anything this host hasn't sent, and the server orders anything it has.
    A drop (the drag rule, authority at the opportunity, the 100-key cap)
    or a disposal clears an entry only if its latest revision is that
    producer's. The same rules hold for node fields, lights and animation
    keys.
  - (b) No change: reads lag until the echo (P6).

  Under (b), any graph that does `get → math → set` on `onTick` advances
  only when an echo lands, so its speed depends on the network. (a) also
  makes the toggle template's double click (4b-2 N7) work. It never
  touches the SOM, so Undo and the drag rule are unchanged. *Review: agreed
  in purpose; mechanism revised to origin and revisions (done).*

- **G-L7 — The limits.**
  - **(a) Recommended: G7's table:** a leaf of 65,536 UTF-16 code units,
    256 nodes, 64 declarations, 32 variables, 16 events, `nodeMap` still
    1–16; **1 MiB (UTF-8) of stored behaviour per world** (Rev 1, S5); 16
    pending delays per behaviour, delays of 0–3,600 s; the per-tick budget
    still 10,000; and **a per-frame limit for the world of 10,000 node
    starts or 8 ms, whichever comes first** (Rev 1, S2).
  - (b) Keep 4b-2's sizes (16,384 units, 64 nodes, 32 declarations) and add
    only variables, events and the dynamic limits.

  (b) fits 56 of 178 surveyed graphs and (a) fits 154 (§2.4). Without a
  world total, (a) would allow 64 × 64 Ki units, about 4 MiB of JSON and
  more on the wire for non-ASCII text, in the SOM and in every visitor's
  `som-dump`. 1 MiB keeps a world at about 16 maximum-size graphs, or 64 of
  16 KiB. The browser checks measure the real `som-dump` at the limit
  (§6.1). The per-frame limit is new with `onTick` (P4). At `p2`'s cost,
  10,000 node starts take 2–3.5 ms on the probe machine; the 8 ms is what
  bounds a slower machine or heavier ops. *Review: agreed, on condition of
  a world total, safe delay handles and worst-case tests (done).*

- **G-L8 — The importer.**
  - **(a) Recommended: one graph, onto the selected object, mapped by
    hand.** The source is pasted JSON, or a file: a bare graph, a
    `KHR_interactivity` extension object (`{ graphs, graph }`), or a
    `.gltf`/`.glb` carrying one (the owner picks the graph when there are
    several). The importer lists **every node, light and animation the
    graph refers to by a literal, wherever the literal is** (pointer
    indices, `{ref}` and other typed ref literals in node values, variable
    initial values and event values, `onSelect`'s `nodeIndex`,
    `/animations/<i>`), with the file's own names when the source has them.
    The owner maps each one to an object in this world (an animation to a
    model and a clip), and one of them, or none, to **this object**. The
    importer rewrites the graph to fit `nodeMap` (own first) and **refuses**
    what it can't translate: **a wired index or ref** (it holds a file
    index the importer can't rewrite; 12 of 179 surveyed assets), a node
    reference the owner left unmapped, `event/onSelect` on two different
    nodes, more than 16 objects. **It never saves a conversion that would
    retarget anything silently** (Rev 1, S4). It saves `enabled: false`,
    with the grant list shown and every grant named (design §6 item 3),
    and the owner enables it.
  - (b) (a) plus **automatic mapping by name** when a world object has
    the file node's name.
  - (c) No importer: graphs only through the console.

  (b) is a convenience that can silently pick the wrong object of a common
  name ("Cube"); it can follow once (a) exists. (c) leaves no owner path.
  Whole-file conversion (every graph in a file, split per object) needs the
  file's nodes to be world objects: that is whole-world import (design §7
  item 6), not this round (§2.4). *Review: agreed.*

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
  owner isn't here right now." **And after a rollback** (§8), a 4d page is
  refused by the 4c server until it reloads (P16). *Review: agreed; document
  the rollback case (done).*

- **G-L10 — A per-behaviour distance (4c AC-L2 (b)).**
  - **(a) Recommended: not in 4d.** The 10 m rule stays a constant.
  - (b) An optional `maxDistance` key, both rule copies, the server's
    `activate` check reading it, and a form field.

  Nobody has asked for it, and standard graphs have no such concept, so
  the importer has nothing to fill it from. It touches 4c's check order,
  which is the security-facing part of `activate`. A small round can add
  it when an owner needs it. *Review: agreed.*

- **G-L11 — The conformance fixtures.**
  - **(a) Recommended: written before the kickoff, by Claude, not by the
    implementer.** Twelve to twenty small graphs under
    `tests/fixtures/behavior-conformance-4d/`, each with a README line and
    an expected **write log** (the setter calls in order, with values, on
    a fake world with an injected clock). One per new op family, plus the
    limit cases: a delay cancelled, a stale `lastDelay` handle that must
    not cancel a newer delay (M4), a delay over the pending cap taking
    `err`, an interpolation replaced mid-way, `onStart` with variables,
    `onTick` for N frames, a send/receive loop, an unsupported op stopping
    a flow, an extension-qualified core op that must not run (M1), and a
    `NaN` that must not be written (S1). They land in a `tests/`-only
    commit the kickoff names as part of its base. **The implementer may not
    edit them**, and a disagreement is a reported finding. **And the
    Khronos subset is checked in:** the graphs (JSON only) of the surveyed
    assets that fit G7, with the CC-BY-4.0 notice (as
    `tests/fixtures/behavior-invalid/` already does), so the run happens on
    every build, not only where `KHRONOS_ASSETS` points. `p6` is its
    baseline: 143 assets, 134 passing through today's adapter.
  - (b) The Khronos subset only.
  - (c) The implementer writes the fixtures with the code.

  (c) is the gap 4b-2 round 5's S3 named: fixtures written by whoever
  writes the code test what they meant, not what the standard says. (b)
  leaves Atrium's own semantics (the overlay, the budgets, the inert ops)
  without an independent check. *Review: agreed.*

- **G-L12 — Carried items.**
  - **(a) Recommended:** the 4c re-review's **N1** (`logCheckFailure`,
    `session.js` L104–106, through `logId`; one line), and nothing else.
  - (b) Also the deferred same-tab sign-in (4c passdown §6.3).

  §6.3 is a sign-in fix with its own real-sign-in browser check, and
  nothing to do with graphs. It is small enough for its own round, before
  or after 4d-1. *Review: agreed.*

## 4. The contract (as recommended; adjust with §3)

### G1. The rule (`behavior-spec.js` and the server's copy, one vector file)
- **Executable identities** (Rev 1, M1): `EXECUTABLE` is the set of bare
  core ops of G-L2 (a) plus exactly `(event/onSelect,
  KHR_node_selectability)`. One shared constant, read by both rule copies
  and by the adapter. A declaration is **supported** exactly when its
  `(op, extension)` is in it: `flow/sequence` with any extension is not.
- **Variables:** `graph.variables` is allowed: 1–32 entries (absent when
  none, as the Khronos schema refuses an empty array, 4b-2 M4).
- **Events:** 1–16 entries (absent when none). An id is 1–64 characters of
  `[A-Za-z0-9_./:-]`, unique. The prefix `atrium/` is reserved for the
  three Atrium ids, which keep their rules (`proximity`, `interval`, F-L7).
  Entries may carry `values` (the validator types them). **An `event/send`
  may not target an `atrium/*` event** (`behavior-event`): those are the
  adapter's to dispatch.
- **Declarations:** 1–64, unique by `(op, extension)` (as now). **Any
  declaration the validator accepts is stored** (G-L3 (a)). `op` is 1–64
  characters of `[A-Za-z0-9_/]` and `extension`, when present, 1–64 of
  `[A-Za-z0-9_]` (4c passdown §4.1: every stored string gets its bound and
  its character set). **A node whose declaration is supported may not take
  a value input from a node whose declaration isn't** (`behavior-op`, "a
  node reads a value from an operation Atrium doesn't run"; `p3`), judged
  by identity, not name. `event/onSelect` keeps its exact declaration, and
  its node keeps `nodeIndex` the literal `0` and `stopPropagation` `false`
  (4b-2 S9). The server's `listensForSelect` is unchanged.
- **Pointers in G-L4's families** (whatever the op, supported or not): a
  **literal** index (`/nodes/<i>/…` or an `[x]` socket's literal) must be
  an integer in `0 … nodeMap.length - 1`, and a **literal ref** for a
  `{x}` socket must be the string `"/nodes/<i>"`, with the same bound
  (`behavior-pointer`). For a light pointer it is
  `"/extensions/KHR_lights_punctual/lights/<i>"`, with `<i>` a `nodeMap`
  index. **Wired sockets are allowed** (P15, `p4`: the registry bounds them
  at run time). Pointers outside the families aren't checked beyond the
  validator and the size limit (G-L3 (a)).
- **Sizes:** G7. The leaf's limit is `JSON.stringify(value).length` in
  UTF-16 code units, as now (N1). The forbidden-key and depth walk still
  runs first, and the validator last (4b-2 §8).
- **`template`, `proximity`, `interval`, `animations`, `nodeMap`,
  `targets`, `kind`, `origin`, `enabled`:** unchanged. An imported graph has
  no `template`, so the form shows it as a custom graph.
- **The vectors** (`tests/fixtures/behavior-vectors.json`, regenerated by
  `gen-vectors.mjs`): every new limit at its boundary and one past it, with
  a multi-byte string at the size boundary; an event id of 65 characters
  and one with a space; `event/send` to `atrium/enter`; a `{x}` ref
  `"/nodes/16"` with a 16-entry `nodeMap`; a literal ref `"/nodes/1"`
  accepted; a wired index accepted; an unknown extension op accepted (G-L3
  (a)); **`flow/sequence` with `extension: 'EXT_probe'` accepted as
  unsupported, and a supported node reading its value refused**; a bare
  unknown core op refused (by the validator); a `variables: []`; a
  `__proto__` key inside a variable's value; and **every 4b-2 vector that
  4d now accepts, moved to the accepted side with its reason**, so a
  reviewer can see each widening on its own line.

### G2. The server
- The wider rule, through the existing paths (`send`, `add`, healing); the
  `hello` schema's `scriptRunner` enum gains `3`; `canRunBehaviors` and the
  `hello` election require `3` (P16, both places, each alone tested as 4c's
  P22 required). N1 (G-L12).
- **The world total** (Rev 1, S5): a `send` or `add` that would bring the
  world's stored behaviours over 1 MiB (the UTF-8 bytes of each non-null
  leaf's `JSON.stringify`, summed) is refused (`INVALID_VALUE`, "this
  world's behaviours would exceed 1 MiB"). As with the 64 cap (4b-2 S1),
  the count is of **other** nodes plus the new value, so rewriting a leaf
  is judged by its new size. Healing drops, in document order, any
  behaviour past the total, with a log line, as it does past the 64th.
- **Nothing else changes:** no new message, no new error code, `activate`
  and its check order untouched.

### G3. The adapter (`packages/behaviors/src/adapter.js`)
- **The identity gate (G-L3, Rev 1 M1):** the adapter loads **a copy** of
  the graph in which every declaration that isn't an executable identity
  has its `op` replaced by `atrium/inert/<declaration index>` (its
  `extension` and declared sockets kept). Nothing registers those names, so
  the engine builds a `NoOpNode`, and no op-name list (`onTick`, `onStart`,
  P19) ever sees the original name. The stored value isn't touched. **Then
  the registry is kept by allowlist** (every key not in `EXECUTABLE`'s op
  names deleted), as a second layer, before `loadBehaveGraph`. Tests:
  through the **real loader**, the review's probe (`r1`) must neither
  advance a flow nor tick; the bare op must; the exact `onSelect`
  declaration must still work; the registry's key set equals the allowlist.
- **The clock (Rev 1, M3, narrowed):** the engine's `lastTickTime` is
  shadowed on the instance and reads the injected `now` (`p1`). **What
  every op observes is the injected clock;** the engine's tick still reads
  `performance.now()` for its own bookkeeping (L8669), and the vendored
  file stays unedited. The test changes the real `performance.now()`
  between ticks and checks that `onTick`, `flow/throttle` and both
  interpolations follow only `now` (`r2`). **No allowlisted op calls the
  global `setTimeout`:** the test replaces it with a throwing stub for a
  whole run.
- **Delays (Rev 1, M4):** `flow/setDelay` and `flow/cancelDelay` are
  subclasses that schedule with the injected `setTimeout`/`clearTimeout`
  and give each delay **a new id from a counter that never repeats**. Only
  live delays are kept (a `Map` from id to timer), so memory follows the
  pending count, not the history (`p5`). `lastDelay` is
  `/extensions/KHR_interactivity/delays/<id>`, and `cancelDelay` or a
  node's `cancel` with an id that isn't live does nothing, so a stale
  handle can never cancel a newer delay. `done` is enqueued through the
  engine's work queue, so it runs on the next tick, as now. A 17th pending
  delay in one behaviour takes `err` (§2.6's dynamic limit). `dispose()`
  clears every live delay with the injected `clearTimeout` before
  `engine.dispose()`.
- **Pointers (G-L4):** the decorator registers, per `nodeMap` index, the
  four node fields (as now), read-only `matrix` and `globalMatrix`
  (`world.matrix(i)`, `world.worldMatrix(i)`), and light `intensity` and
  `color` for a light host. **`world` gains exactly those reads and
  `setLightColor`**, total like the rest (4b-2 S4).
- **Interpolation:** unchanged engine behaviour (one per path, P13), on the
  injected clock. **Because the callback is `async`** (P13), a failure in
  it is a rejected promise: the adapter's setters stay total (no throw can
  start there), and a test with a throwing world during an interpolation
  checks that no unhandled rejection reaches the process and the refusal is
  logged. Disposal already clears both maps.
- **Events:** the adapter alone dispatches `atrium/*` (as now). A graph's
  own `event/send` reaches only its own engine (P5).
- **The report:** a pure `graphReport(value)` returns `{ unsupported:
  [{ op, extension, count }], unsupportedPointers: [{ pointer, count }],
  missingSelectOutputs: ['selectionPoint', …], perFrame, interpolates,
  startsOnLoad, keepsState }` (Rev 1, S7), judged by identity, for the
  form, the importer and the runner's status. One function, so they can't
  disagree.
- `skipRules` stays test-only.

### G4. The runner (`packages/behaviors/src/runner.js`)
- **Writes are checked at the boundary** (Rev 1, S1), before anything is
  queued or put in the overlay: `translation` and `scale` three finite
  numbers, `rotation` four finite numbers, `visible` a boolean, light
  `intensity` a finite number ≥ 0, light `color` three finite numbers
  ≥ 0. A value that fails is refused: the setter returns `false`, the
  adapter logs it once per (behaviour, index, field) as it logs a refused
  write, and the graph continues on `out`. Animation writes keep their
  existing shape check. **`pointer/get`'s `isValid` is the graph's own
  guard**, and the importer's help says so.
- **The per-frame world limit** (Rev 1, S2): each frame, engines are ticked
  in a rotating order starting after the last one ticked. **Once the
  frame's node starts across all engines reach 10,000, or 8 ms have passed
  on the runner's clock since the first engine's tick began, the rest skip
  this frame** (their events wait; `onTick`'s `timeSinceLastTick` just
  grows). A skip isn't a disable. A behaviour skipped in more than half the
  frames of the last two seconds shows **"Throttled: this world's
  behaviours are using all their time"** in its status, and the log gets
  one line per behaviour per minute while it lasts (Q5). The per-tick
  budget (P4) still disposes a single runaway tick.
- **The overlay (G-L6, Rev 1 M2):** per key, `{ value, revision, producer,
  sentSeq? }`. Each accepted write gets the next revision. An opportunity
  that sends a key records `seq → (key, revision)`. **`som:set` with
  `origin: 'own'` and that `requestSeq`, or `edit:rejected` /
  `edit:unknown` for that seq, clears the entry only if its revision is
  still the key's latest and the key isn't queued.** `som:set` with
  `origin: 'remote'` clears the entry and drops the key's queued entry. A
  drop or disposal clears it only if the latest revision is that
  producer's. Two behaviours writing the same key share one entry: the
  latest write wins, as in the queue.
- **Status:** "Partially supported" when `graphReport` lists anything, with
  the list; "Throttled" as above; the `onStart` and sampled-motion notes
  (G6). A `debug/log` line, a refused write, a refused value, a delay over
  the cap and a skipped frame each reach the log as now.
- **Unchanged:** the queue's rate, keys and FIFO, the drag rule, authority
  at the opportunity, `select`, forwarded `activate`, the 10 m rule.

### G5. The client
- `connectNow` passes `scriptRunner: sameOriginAsAccount(…)` as now, and
  `AtriumClient.connect` sends `3` instead of `2`. The frozen-schema test
  from 4c (the hello without `scriptRunner` accepted by the two frozen
  server schemas) stays green. **A new frozen fixture is added:**
  `hello.client.14ab0076.json`, so a 4d client's cross-origin hello is also
  proven acceptable to the 4c server now on PROD.
- **`som:set` says where it came from** (Rev 1, M2; a local event, not a
  wire change): every emit site (P20) adds `origin: 'own'` with
  `requestSeq`, or `origin: 'remote'`. Existing listeners ignore the new
  keys. A test through the real client checks every site's shape.

### G6. The importer (`apps/client/src/graph-import.js`, pure, and its panel)
- **`parseGraphSource(bytes)`** → `{ graphs: [graph, …], fileNodes:
  [{ index, name }], fileLights, fileAnimations }` or `{ problem }`
  (Rev 1, S4):
  - the source is at most **4 MiB of bytes, checked before decoding**;
  - a `.glb` must have the magic, version 2, a total length equal to the
    bytes, 4-byte-aligned chunks inside the bounds, and exactly one JSON
    chunk first; only that chunk is read (no buffers);
  - JSON is parsed in a `try`, then its depth is checked (at most 64) and
    its counts (at most 16 graphs, each within G7) **before** any
    conversion. Every failure is a `problem` the panel shows; the panel is
    never left waiting.
- **`referencesOf(graph)`** → `{ nodes, lights, animations, other }`: every
  literal reference, wherever it sits (pointer indices, typed ref literals
  in node values, variable initial values and event value defaults,
  `onSelect`'s `nodeIndex`, `/animations/<i>`), each with where it was
  found, and `wired: [{ node, socket }]`. `other` holds refs to families
  Atrium doesn't map (materials, meshes, …).
- **`convertGraph(graph, mapping)`** → `{ value, report }` or `{ problem }`:
  every node, light and animation reference is rewritten through the
  mapping, **or the conversion is refused naming the reference**; `other`
  refs are left as they are and listed (they only reach unsupported
  pointers). `value` is a complete behaviour leaf (`kind: 'graph'`,
  `origin: 'local'`, `enabled: false`, `nodeMap` own-first and unique,
  `targets` = every mapped object outside the own subtree, `animations`
  from the mapping), and it **must pass `behaviorCheck`** before the panel
  offers Save. The `report` is `graphReport` plus the grants.
- **The panel** (in the Behaviour section; "Import a graph…" beside the
  template list): the source, the graph picker, the mapping table (each
  reference with its file name and a target picker, filtered by kind), the
  report, the grants, Save. Save is one `sendField` of the leaf (the node
  gets its `objectId` first, as F9 does). After Save it is the custom-graph
  state: Enabled, Remove, the report.
- **The notes the owner sees, at import and beside Enable** (Rev 1, S7):
  for `startsOnLoad`, "This graph runs again whenever the owner reconnects,
  the host tab changes or it is re-enabled. It may overwrite what visitors
  changed, and its variables and timers start over."; for `perFrame` or
  `interpolates`, "Visitors see this motion in steps, not smoothly. If the
  host tab closes mid-way, they keep the last step they saw."; for
  `missingSelectOutputs`, "Atrium's clicks have no selection point or ray.
  Those outputs read as not-a-number."
- **Every string from a graph or a file reaches the DOM as text, never as
  HTML** (op names, extension names, event ids, file names, file node
  names, `debug/log` messages, problem texts), through `textContent` and
  created nodes, and a wiring guard checks the panel and the log view have
  no `innerHTML` with graph data.

### G7. Limits (the numbers)
| What | 4b-2 | 4d (recommended) | Unit and kind |
|---|---|---|---|
| A behaviour leaf | 16,384 | 65,536 | UTF-16 code units of `JSON.stringify`; static, F1 |
| **All behaviours in a world** | — | **1 MiB** | UTF-8 bytes; server (`send`, `add`, healing) |
| Graph nodes / declarations / types | 64 / 32 / 16 | 256 / 64 / 16 | static, F1 |
| Variables / events | 0 / 8 | 32 / 16 | static, F1 |
| String fields (`op`, `extension`, event ids) | — | 1–64, a character set each | characters; static, F1 |
| `nodeMap` / `targets` / `animations` | 1–16 / 0–16 / 0–8 | unchanged | static, F1 |
| Behaviour nodes per world | 64 | unchanged | server |
| Steps per tick per behaviour | 10,000 | unchanged | node starts; adapter |
| **Per frame, the whole world** | — | **10,000 node starts or 8 ms**, then at most one tick past it | runner |
| Pending delays per behaviour | — | 16 (the 17th takes `err`) | adapter |
| Delay duration | — | 0–3,600 s (outside takes `err`) | adapter |
| Interpolations | — | one per pointer or variable (P13) | engine |
| Sends per world / pending keys | 20 per second / 100 | unchanged | runner |
| Import source | — | 4 MiB, JSON depth 64, 16 graphs | bytes; importer |

### G8. The conformance fixtures and the Khronos subset (G-L11)
- `tests/fixtures/behavior-conformance-4d/` (Claude's, before the kickoff):
  each fixture a graph, a `nodeMap` of fake ids, a frame count, a clock
  step and the expected write log. Run through the **real** adapter with a
  fake world and fake timers.
- `tests/fixtures/behavior-conformance-khronos/`: the graphs of the subset
  (JSON, one file per asset), the CC-BY-4.0 text, and **a manifest** (Rev
  1, N2): the assets commit, the survey scripts' commit, each file's
  sha256, and each asset's `p6` baseline result (134 pass, 8 fail by name,
  `math/random` disposed). The expected results are regenerated with the
  round's adapter. **Against the baseline,** a fail that becomes a pass
  needs its reason (for example `Extras/Matrix_Updates` with G-L4's
  read-only matrices), and a pass that becomes a fail is a finding.
  `conformance.mjs` reads these instead of `KHRONOS_ASSETS` (the variable
  stays as a way to regenerate). **The run is no longer skipped on the
  build host.**

### G9. What doesn't change
`activate`, the server's checks and buckets, `script-ready`, the templates
and their form, the drag rule, Undo (behaviour writes aren't undone, D4),
Duplicate (an imported graph's references are all in `nodeMap`, `targets`
and `animations`, which F-L10 already remaps), the send queue, the wire
protocol apart from `scriptRunner: 3`, and the vendored engine's files
(nothing in `packages/gltf-interactivity-engine` is edited; every change is
a subclass, an instance property or a loaded copy in the adapter).

## 5. Open questions
The review answered Q1–Q6 (§11). What follows is what each answer settled,
and what is still open for the operator.
- **Q1 (registry as the gate):** settled by M1: the identity gate, the
  registry kept by allowlist, no name denylist.
- **Q2 (stepped motion):** accepted as a stated deviation (G-L5).
- **Q3 (`onStart`):** the stronger note at import and at Enable (G6). **Open
  for the operator:** should enabling a graph that both `startsOnLoad` and
  writes ask for confirmation? Recommended: no, the note is beside Enable.
- **Q4 (select outputs):** flagged (`missingSelectOutputs`, G3 and G6).
- **Q5 (fairness):** no automatic disable; a visible "Throttled" status
  (G4).
- **Q6 (the per-tick budget):** keep 10,000. `math/random`'s conformance
  graph is recorded as an expected `over-budget`, and profiled by the brief
  author before anyone proposes a change.
- **Q7 (new): the world total's number.** 1 MiB is a judgement, not a
  measurement. If §6.1 check 10 measures a `som-dump` at the limit that is
  slow to load, the brief should lower it before DEV.

## 6. Tests

| Item | Tests | Proof of failure |
|---|---|---|
| G1 | the vectors through **both copies and the validator**; each new limit at its boundary and one past, with multi-byte strings; the string rules; `event/send` to `atrium/*`; literal and wired refs; an unknown extension op accepted; **an extension-qualified `flow/sequence` judged unsupported, and a supported node reading its value refused**; a `math/combine3` reading an `event/onHoverIn` output refused, and a hover node that only ends a flow accepted (`p3`); each 4b-2 vector that moves sides | (a) accept `event/send` to `atrium/interval` in one copy only; (a2) skip the ref bound in the server copy; (a3) judge support by op name only in one copy (the extension vector fails) |
| G2 | server, port 0, real sockets (signin-sync §4.1): a 4d graph accepted, broadcast, saved and **re-read through healing**; a 65,537-unit one refused with nothing broadcast; **the world total:** a `send` that crosses 1 MiB refused, a rewrite of an existing leaf judged by its new size, healing past the total; **an oversized and a multi-byte value over a real socket** (4c passdown §4.1); **election:** `scriptRunner: 2` never elected, `3` elected; each of the two places alone (4c's P22 pattern); N1's line has a `logId` | (b) elect on `2` in the `hello` path only; (b2) in `canRunBehaviors` only; (b3) count the world total with the leaf being replaced included twice |
| G3 | the real engine and loader, a fake world, fake timers and a fake `now`: **the identity gate:** `r1`'s graph neither advances a flow nor ticks; the bare core op does; the exact `onSelect` declaration works; the registry's key set equals the allowlist; an unsupported flow op's downstream never runs; with `skipRules`, a running node reading an unsupported core value op disposes `engine-error` at its first tick (`p3b`); **the clock:** with the real `performance.now()` jumping between ticks, `onTick`, throttle and both interpolations follow only `now` (`r2`), and a throwing global `setTimeout` is never called; **delays:** `done` after the injected time, `cancel`, `cancelDelay` by `lastDelay`, **a stale `lastDelay` (A fired, B scheduled) cancels nothing and B completes**, the 17th `err`, 10,000 sequential delays leave one live entry, `dispose` clears every live delay with the injected `clearTimeout`; an interpolation replaced mid-way; **a throwing world during an interpolation: no unhandled rejection, a log line**; `globalMatrix` of a nested node matches `worldMatrix`; light colour; a send/receive loop once per tick; a doubling fan-out `over-budget` (`p7`); `graphReport` for each flag | (c) gate by op name (the `r1` test runs `Sequence`); (c2) schedule with the global `setTimeout` (the stub throws); (c3) reuse delay ids (the stale-handle test cancels B); (c4) leave `dispose` to the engine's own `clearTimeout` (a fake timer still fires) |
| G4 | the runner with **the real `AtriumClient`** on a fake socket, and the real adapter: **write checks:** `[NaN, 0, 0]`, `[null, 0, 0]`, a two-element translation and a non-boolean `visible` are refused before the queue and the overlay, logged once, and a valid write still goes; **the frame limit:** three engines each doing 6,000 steps per tick tick two per frame and all progress over three frames in rotation; with a fake clock, an engine whose tick takes 9 ms stops the frame; "Throttled" after two seconds of skips; one doing 10,001 in a tick is disposed as now; **the overlay** (the review's sequence): send `v1`, queue `v2`, receive the own echo and `edit:accepted` for `v1`, read `v2`; a remote `som:set(v3)` between those steps wins and drops the queued `v2`; an equal-valued remote write still counts as remote; answers out of order; a rejection or unknown for the older seq keeps `v2`; a drag drop; a second producer on the same key; disposal of one producer; the same for a light and an animation key; `get → add → set` on `onTick` for 30 frames with no echo advances 30 times; **an interpolation interrupted at 1.99 s by `active: false`:** nothing more is sent, and the last value sent is what the SOM shows | (d) clear the overlay on any echo for the key (the `v1`/`v2` test reads `v1`); (d2) a fixed tick order (the third engine starves); (d3) check writes after the overlay (the overlay reports a `NaN`) |
| G5 | the hello with `scriptRunner: true` carries `3`; without it no key; **the captured hello accepted by the three frozen schemas** (pre-4b-2, `71b6e40b`, `14ab0076`); **every `som:set` site's shape** (`origin`, and `requestSeq` on own echoes) | (e) send `scriptRunner` cross-origin; (e2) emit an own echo without `origin` |
| G6 | the pure importer: each source shape; **a `.glb` with a bad magic, a total length that doesn't match, a JSON chunk length past the end, an unaligned chunk and two JSON chunks, each refused**; a source of 4 MiB + 1 byte (multi-byte text) refused before decoding; depth 65 and 17 graphs refused; references found in pointer indices, `{ref}` literals, **a variable's initial ref, an event value default** and `nodeIndex`; **an unmapped node reference refused, naming where it is**; a wired index refused; two `onSelect` nodes refused; duplicate file names; a survey asset that fits converts, **passes `behaviorCheck`** and keeps its write log under the mapping (`nodeMap` permuted, results equal); `enabled: false`; the grants list; the three notes; **the panel through the strict DOM fake:** a file name, an op name and a problem text of `<img src=x onerror=…>` all show as text | (f) leave a variable's ref literal unmapped (the write log differs); (f2) render op names as HTML (the guard fails); (f3) skip the GLB length check (the truncated file parses) |
| G8 | every fixture's write log matches exactly; the Khronos subset's results match the regenerated list exactly, **on the build host**, and the manifest's hashes match the files | (g) widen the allowlist by one op in the adapter only (a fixture's log changes) |

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
3. **`pointer/interpolate`** of a translation over 2 s with a steady host:
   the visitor's last value equals the target. **Then again, closing the
   host tab at about 1.9 s** with a second owner tab open: the visitor and
   the saved document show the same last sent value, and the new host
   starts from it.
4. **"Partially supported":** a graph with `event/onHoverIn` and a
   `/materials/…` pointer: the list, and the rest runs; a material `get`
   feeding a translation writes nothing (the log's refused value).
5. **The frame limit, stressed:** 64 behaviours, eight of them heavy
   `onTick` graphs with matrix ops and interpolations; **record the host's
   p95 frame time** and the skip counts; nothing is disabled, a light graph
   still runs, and "Throttled" appears.
6. **A stale owner tab** (a 4c page, `scriptRunner: 2`): never the host; a
   4d tab takes over (G-L9).
7. **XSS:** a graph and a file whose names, op names and event ids are HTML
   show them as text.
8. **Restart from the saved document:** every imported graph is back and
   runs; healing logged nothing.
9. **Regression:** 4c's checks 1–13, 4b-2's `r7.py`, `f3.py`,
   signin-sync's `c.py` and `c4b.py`, the regression set with a baseline
   (`reg4c.sh`, `regdiff.py`).
10. **The world total, measured** (Q7): a world filled to 1 MiB of
    behaviours with multi-byte strings; a visitor joins; record the
    `som-dump`'s bytes on the wire, its load time, and the server's
    serialize and heal times. A `send` past the total is refused.
11. **The rollback rehearsal** (§8): on a copy of PROD's database, with a
    4d-only graph and an unrelated edit made after the upgrade.

## 7. DEV acceptance (operator, Firefox, hard reload in every tab)
1. **Import** the "on select: wait, then hide" fixture onto a cube, map its
   target to a library model, review the grant, Save. It shows disabled.
   Enable it; click the cube: after the delay the model hides; a private
   window sees the same.
2. **Import the rotation graph** onto another cube. It turns in the owner's
   window, and in the visitor's window it turns in visible steps (as
   expected: G-L5 (a)); the note says so.
3. **A graph with an unsupported op:** "Partially supported" with the op
   named; the rest of it works.
4. **Reload the owner's tab:** the rotation restarts from where the cube
   is; nothing else changes.
5. **A second owner tab** takes over when the first closes, and the
   imported graphs keep running there.

## 8. Worker rules and release path
As scripting-4c, with this round's specifics:
- **Steps, one commit each, every commit runnable:**
  1. G1: both copies of the rule, `EXECUTABLE`, the vectors and
     `gen-vectors.mjs`, the schema's `scriptRunner: 3`;
  2. G3: the adapter (the identity gate and the registry, the clock, the
     delays, the pointers, the report), with `worldMatrix` in `@atrium/som`
     and its re-export;
  3. G4 and G5's `som:set` origin: the runner (write checks, frame limit,
     overlay, status) and the client's event;
  4. G2 and the rest of G5: the world total, election on `3`, the client's
     `3`, the frozen fixture, N1;
  5. G6: the importer module, its panel and its wiring guards;
  6. G8: `conformance.mjs` on the checked-in subset, the regenerated list
     against the baseline;
  7. full suites (server files each on its own), proofs (a)–(g) with every
     sub-proof, and the handoff.
- **Each commit's report lists the suites run at that step** and names any
  test deferred to a later step.
- **The seam rule (signin-sync §4.1):** G3's tests use the real engine and
  loader; G4's the real adapter **and the real `AtriumClient`'s events**
  (never a fake `origin` the client doesn't emit); G6's conversion test
  runs the converted value through the real adapter.
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
- **Rollback (P17, Rev 1 S6). Roll forward by default.** A rollback to 4c
  deletes every 4d-only behaviour at each world's next load, and restoring
  the pre-release backup would lose every edit made since. So:
  - **before PROD,** Claude writes `devtasks/harness/tools/behaviors-export.mjs`
    (every stored behaviour leaf with its world, node `objectId` and
    sha256, read from a copy of the database) and its counterpart
    `behaviors-restore.mjs` (puts the leaves back by `objectId` through the
    server's own `send` path, once the 4d code is running again);
  - **the rehearsal** (§6.1 check 11): on a copy of PROD's database, add a
    4d-only graph and an unrelated edit, export, roll back to `14ab0076`,
    see the graph dropped and the edit kept, upgrade again, restore, and
    see both;
  - **if a rollback is ever needed for real:** stop the server, export,
    roll back, and tell owners to reload every tab (a 4d page is refused by
    the 4c server, P16); restore after the fix is deployed.
- **The measured gate** (Rev 1, S5): §6.1 checks 5 and 10 must have their
  numbers in the handoff before DEV acceptance.
- **Kickoff cards (4c passdown §4.5):** the front door creates the sentinel
  first and puts the base commit, this file's hash, the operator's
  decisions and the sentinel id **in the kickoff card's body**. "Write each
  card's body from the bullets under its title; don't copy this kickoff's
  own instructions into any card."
- **Both outside reviews.** The reviewer couldn't clone this time either
  (4c passdown §4.3): send them the files at a pinned commit, ask them to
  run what they can, and keep Claude's own reproductions of their findings
  (as `r1` and `r2` here).
- **Never push to `main` between the release merge and the MAIN push.**

## 9. Notes for the brief author
- **The validator still makes every stored graph a DAG; loops are now run
  time** (P10): through `event/send`, through a delay's `done`, through
  `onTick`. The per-tick budget catches a runaway tick, the pending-delay
  cap a runaway timer tree, and the frame limit a sustained load. Name all
  three in the brief; none replaces another.
- **The identity gate is the security boundary for ops** (G-L3, P19). The
  engine looks up op names only, so the brief must say "build only `(op,
  extension)` identities in `EXECUTABLE`; rename everything else in the
  loaded copy" in those words, and put `r1` in step 2 as a test.
- **A forward isn't a run, and a run isn't a send** (4c N3; G-L5): a value
  written every frame is sampled, and the last one goes out only if this
  tab is still the host.
- **The overlay's clear rule is the subtle part** (G4). Write the brief's
  version as the review's sequence (`v1` in flight, `v2` queued, own echo,
  remote set) and test exactly that, with the real client's events.
- **`NaN` is a normal value inside a graph** (P21: missing pointers, the
  first tick, `math/NaN`). The runner checks only what leaves.
- **Variables and pending delays don't survive** a reload, a host change
  or a world load (P14; design §5.2); the importer's note says so.
- **The survey (§2.4) is a static count; `p6` is a run** of the indexed
  subset through today's adapter. Use `p6` for what passes, and §2.4 for
  sizes and shapes. `math/matDecomp-Shear`, `pointer/set_edge_cases` and
  `ref/eq` failed in `p6` without a diagnosis: look at them before the
  brief, so the round's list starts from known reasons.

## 10. Next rounds
- **4d-2 — `KHR_animation_pointer` models** (4b-1 passdown §6.3): three.js
  r163's `GLTFLoader` skips those channels. This draft found no support in
  core three.js (the long-standing PR, #24108, was unmerged in every source
  it found; not yet confirmed by a reviewer); Needle publishes a
  `GLTFLoader` plugin, `@needle-tools/three-animation-pointer` (1.1.2, June
  2026). Its own short pre-brief: which three.js versions the plugin
  supports, vendoring it the way the engine was (B2 (a)), and the panel's
  "has animations, none playable here" text in the meantime.
- **Material pointers** (G-L4 (b)), with an authority rule for shared
  materials.
- **A synced transition** (G-L5 (b)), so interpolations are smooth for
  every client and their end is certain.
- **Embedded graphs in placed models** (§2.4): a model's own graph run
  against its own instance. Per client, or by the host with the inner
  nodes made addressable; a design question first.
- **Healing that keeps what it drops,** so a future rollback isn't
  destructive (S6): a refused leaf moved aside rather than replaced by
  `null`. It can't help a rollback to 4c, whose healing is already shipped.
- **Automatic mapping by name** (G-L8 (b)); **a per-behaviour distance**
  (G-L10 (b)); **whole-world import** (design §7 item 6).
- Carried, unchanged: the 4c passdown §6.3–§6.5.

## 11. Review log
- **Rev 0** (2026-10-30, evening PT, `2b6f7df0`): drafted by Claude from
  the 4c pre-brief §10 and AC-L2, the 4b-2 pre-brief §9, §2.3, F-L2–F-L4,
  F1, F4, F5, F7 and F11, the design §5.3–§5.5, §6 and §7, the 4b-1, 4b-2,
  signin-sync and 4c passdowns, code reading at `41acd2ff`, a static survey
  of the Khronos assets at `926bec45` (§2.4), probes `p1`–`p7` and the base
  suites. Open: G-L1–G-L12, Q1–Q6.
- **Rev 1** (2026-10-30, night PT): an outside review of Rev 0
  (`devtasks/REVIEW-scripting-4d-rev0.md`, CHANGES REQUESTED, source-only
  through GitHub at `2b6f7df0`; the clone failed on DNS, and no code was
  run). Claude checked every finding at the code (`index.js` L8503–8510,
  L8520–8521, L8669, L4367–4445, L8356–8382; `AtriumClient.js` L1630,
  L1643, L1677–1710; `adapter.js` L411–415; `runner.js` L194;
  `world.js` L422–451) and ran the reviewer's prepared M1 probe as `r1` and
  a new `r2` for M3 and S1. **All are taken.** The reviewer agreed with
  every recommendation (G-L2, G-L3, G-L5, G-L6 and G-L7 with conditions,
  all now met) and answered Q1–Q6 (§5).

| # | Finding | Severity | Where it went |
|---|---|---|---|
| M1 | An extension declaration runs a registered core op | Must-fix | **Verified** (`r1`, P19: `Sequence` built and written; an extension `onTick` ticked). `EXECUTABLE` identities (G1), the renamed load copy and the registry by allowlist (G3), `graphReport` and the value-read rule by identity, tests and proof (c), fixture (G-L11) |
| M2 | `som:set` has no origin, so the overlay can't tell its own echo from a remote set | Must-fix | **Verified** (P20). `som:set` gains `origin` and `requestSeq` (G5); the overlay by revision with the review's clear rules (G-L6, G4); the review's sequence as tests through the real client; proof (d), (e2) |
| M3 | "No `performance.now()`" can't pass with the engine unedited | Must-fix | **Verified** (`r2`: a throwing stub disposes). Contract narrowed to the ops' observed clock (G3, the review's (a)); the test changes the real clock instead |
| M4 | Reused delay slots let a stale handle cancel the wrong timer | Must-fix | Accepted. Monotonic ids and a `Map` of live delays; a stale id is a no-op (G3); the stale-handle test, proof (c3), fixture (G-L11) |
| S1 | Defaults that aren't numbers reach writes | Should-fix | **Verified** (`r2`, P21). Write checks at the runner's boundary before the queue and the overlay (G4); `isValid` documented; tests; proof (d3); fixture |
| S2 | The frame budget is a count, not a time | Should-fix | Accepted. 10,000 node starts **or 8 ms** (G4, G7); "Throttled" status; the async interpolation callback's error test (G3); the stress check with p95 (§6.1 check 5) |
| S3 | "The last value always goes out" is too strong | Should-fix | Accepted. G-L5 reworded; the importer's note; the 1.99 s interruption test (G4) and check (§6.1 check 3) |
| S4 | The importer needs adversarial input handling | Should-fix | Accepted. GLB checks, byte and depth limits before conversion, every typed ref literal remapped or refused, no silent retarget (G-L8, G6); tests; proof (f), (f3) |
| S5 | No total for a world's behaviours | Should-fix | Accepted. 1 MiB UTF-8 per world on `send`, `add` and healing (G2, G7); real-socket multi-byte test; the measured `som-dump` (§6.1 check 10, Q7) |
| S6 | A rollback silently erases 4d graphs, and a backup restore loses later edits | Should-fix | **Confirmed** (P17). Roll forward by default; export and restore tools and a rehearsal on a copy of PROD's data (§8, §6.1 check 11); the 4d page refused by a 4c server documented (P16, G-L9); non-destructive healing recorded for later (§10) |
| S7 | `onStart` and `onSelect`'s missing outputs need a sharper contract | Should-fix | Accepted. The notes at import and Enable (G6); `missingSelectOutputs` in `graphReport` (G3); a confirmation left to the operator (Q3) |
| N1 | One term for characters and bytes | Nit | G7's unit column; the rule says UTF-16 code units; multi-byte boundary vectors (G1) |
| N2 | Make the baseline reproducible | Nit | The survey scripts in `devtasks/spike-4d/survey/`; G8's manifest with per-asset baseline results |
