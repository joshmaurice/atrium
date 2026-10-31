# Atrium scripting-4d pre-brief review

**Verdict: CHANGES REQUESTED.** The proposed operation-identity gate, delay-handle reuse, write-overlay protocol and clock test are not yet specified safely or consistently with the pinned engine/client; these should be resolved before the implementation kickoff.

**Reviewed:** `joshmaurice/atrium` at `2b6f7df095ee4b72d1052d3dd4d3ba3ec3c4297f`, `devtasks/PREBRIEF-scripting-4d.md` Rev 0 and the requested companion pre-briefs, passdown, design, adapter, runner, client, server rule, world healer and relevant vendored-engine implementation. **Cloned: NO.** Initial command attempted exactly `git clone https://github.com/joshmaurice/atrium`; it failed with:

```text
Cloning into 'atrium-4d-review'...
fatal: unable to access 'https://github.com/joshmaurice/atrium/': Could not resolve host: github.com
```

Fallback: fetched source at the **pinned commit** through GitHub's read-only fetch interface, including the 12,005-line engine. **Source-only review.** Node here is `v22.16.0`; `pnpm` is not installed. Thus `pnpm install`, the requested test suites, the seven repository probes, the optional Khronos probe and a browser run **were not executed**. The counts in §2.5 and the stated 176/122/255/etc. are the *author's reported results*, not my results. I did execute an original **static source probe** against the fetched files (code and actual output below), but not a runtime probe against a locally installed engine. No repository or deployment changes were made.

Source links below use immutable commit URLs. Finding status **INFERRED** means the failure sequence follows from source inspection, **not** that I ran the proposed 4d code (which does not yet exist). The source-probe facts are explicitly marked **SOURCE-CHECKED**.

## Must-fix

### M1 — An extension declaration can execute a registered core operation despite being unsupported

**References:** G-L3(a), G1, G3, Q1; `packages/gltf-interactivity-engine/build/index.js:8490–8511, 11905–11923`; `packages/behaviors/src/adapter.js:303–357`; `devtasks/PREBRIEF-scripting-4b-2.md` F-L4.

**Scenario:** The validator treats `{ op: 'flow/sequence', extension: 'EXT_probe' }` as an extension declaration, allowing it to define its own sockets rather than applying the core schema. The engine loader, however, looks up **only `nodeDeclaration.op`** in `engine.registry`; it does not key by `(extension, op)`. The proposed gate keeps `flow/sequence` because that *name* is allowlisted. The extension-declared node consequently instantiates the real `Sequence` class and runs its flow. The analogous issue applies to any allowlisted op with an unexpected extension. Merely asserting that the registry contains exactly the allowlisted *names* will not detect this. The optimized value/control compilers explicitly skip extension declarations (`index.js:36,233`), but that safeguard does **not** prevent interpreter execution via the loader. The exception for **exactly** `event/onSelect` with `KHR_node_selectability` needs to remain explicit.

This contradicts “an extension op not supported by Atrium is inert,” and the mismatch between validator and loader permits extension declarations to evade core-specific validation before reaching a core constructor.

**Recommendation:** Define the executable identity as `(op, extension)`; authorize bare core ops and the one specified `KHR_node_selectability/event/onSelect` identity. On the client, make every other identity inert **before** engine instantiation (e.g. transform to a known inert declaration / use an explicit factory guard, while retaining the standard validation semantics). Enforce the same identity in G1's static unsupported-value dependency check and in `graphReport`. A denylist of op names is not a fix.

**Proving test:** A valid graph with an extension-qualified `flow/sequence` and `event/onTick` whose names are on the allowlist must neither advance flow nor tick; a bare core `flow/sequence` must run; the exact supported `KHR_node_selectability` declaration must continue working. A value reader of an extension-qualified core-named op must be treated as a reader of an unsupported producer. Run with the **real** loader, not just a set-membership test.

**Status:** **INFERRED; SOURCE-CHECKED** (`registry.get(nodeType)` uses `op`, while the validator branches on `extension`). See probe below.

### M2 — `som:set` has no origin, so the overlay cannot distinguish the host's own echo from a conflicting session

**References:** G-L6(a), G4, §9 (latest-seq rule), Q5; `packages/behaviors/src/runner.js:354–459, 605–639`; `packages/client/src/AtriumClient.js:1634–1644, 1699–1710`.

**Scenario:** Graph writes key K: `v1` is sent/in flight, then the next frame queues `v2`. When `v1` is accepted, `AtriumClient` applies its own echoed `v1`, emits `som:set { nodeName, path, value }`, and **only then** emits `edit:accepted {seq}`. A remote session's set emits the **same** `som:set` shape. G4 says “another session's `som:set`” must clear the overlay while an older local echo must *not* clear `v2`. With those current events, the runner has no reliable way to tell them apart. Clearing on every `som:set` loses `v2`; declining to clear allows a conflicting remote edit to be overwritten by stale speculative state. Matching the value is insufficient (two sessions can send equal values). A rejection/unknown for an earlier in-flight sequence also must not discard a newer queued write.

**Recommendation:** Extend the **local client event API** (not necessarily the wire protocol) with an unambiguous origin and, on local echoes, a request sequence; distinguish the three paths `own-echo`, `remote-set`, `local-edit`. Maintain an overlay revision per key for queued and in-flight writes; only an answer for the latest applicable revision can clear it, and remote sets win according to a documented deterministic ordering. Apply identical rules across node fields, lights and animation keys. On disable, role loss, queue drops, 100-key overflow and disposal, remove only entries belonging to the disposed producer; account for two behaviours writing the same key.

**Proving test:** Real `AtriumClient` event seam: send `v1`, queue `v2`, receive own echo and `edit:accepted(v1)`, then read K; it must still be `v2`. Repeat with remote `som:set(v3)` between these steps and prove remote precedence; include equal-valued remote writes, out-of-order acceptance, rejection/unknown, edit gesture, a second producer and engine disposal. Assert all event shapes the runner consumes, not a fake invented `source` property.

**Status:** **INFERRED; SOURCE-CHECKED** (both `som:set` forms omit source; own echo precedes `edit:accepted`).

### M3 — The proposed “no `performance.now()` left” test cannot pass with the pinned engine unchanged

**References:** G3 clock bullet; §6 G3 tests and proof (c2); P12; `packages/gltf-interactivity-engine/build/index.js:8667–8670, 8204–8206`; `packages/behaviors/src/adapter.js:268–273, 396–402`.

**Scenario:** Shadowing the instance's `lastTickTime` getter with the injected `now` does make the **operations' reads** deterministic. It does **not** prevent `BasicBehaveEngine.executeEventQueue()` from unconditionally evaluating `performance.now()` at the start of **every** tick. Replacing `performance.now` with a throwing stub, as required by G3's own test, therefore makes the adapter catch an engine exception and dispose the behaviour. Keeping the vendored engine hash unchanged and merely redefining the getter cannot satisfy both requirements.

**Recommendation:** Either (a) accurately narrow the contract to “the operation's observable clock is injected, although the engine still calls `performance.now()` internally,” retaining `performance.now` in tests and asserting operation outputs are controlled by `now`; or (b) implement a genuinely injected engine tick clock, explicitly permitting a reviewed vendored-engine change and updating the hash rule. Do **not** claim a global-clock-free path while keeping that call.

**Proving test:** With injected `now = () => 1000`, tick twice while changing the real `performance.now()` and verify `timeSinceStart`, throttle and interpolations depend only on `now`. If the stronger requirement is retained, stub `performance.now` to throw and demonstrate `tick()` still works on the *real* engine.

**Status:** **INFERRED; SOURCE-CHECKED** (unconditional global clock call). This is a contradiction in the proposed contract, not a defect introduced in 4d code.

### M4 — Reusing delay slots can let a stale `lastDelay` handle cancel the wrong timer

**References:** G3 delays, G7, G-L7, §6 G3 tests; `packages/gltf-interactivity-engine/build/index.js:4367–4425, 4427–4445, 8352–8382`.

**Scenario:** G3 asks the subclass to reuse delay-table slots to avoid the engine's never-shrinking array, while keeping `/extensions/KHR_interactivity/delays/<index>` `lastDelay` references valid for `flow/cancelDelay`. Delay A occupies slot 0 and returns handle `/.../0`; A fires and frees the slot. Delay B reuses slot 0. If a graph still retains A's handle (a variable or earlier output), `cancelDelay(A-handle)` now cancels **B**. The vendor's monotonic indices avoid this aliasing, at the cost of an unbounded historical table. A 16-pending cap alone does not solve stale-handle identity.

**Recommendation:** Reclaim memory without recycling externally observable identities: assign monotonically increasing safe-integer delay IDs and keep only live IDs in a `Map`, with an invalid/stale ID acting as a no-op. Alternatively use generation-bearing handles, but then define a reference syntax and `cancelDelay` resolver that actually validates the generation. Ensure `cancel` on an individual delay node cannot cancel a newer timer after its earlier slot is reused.

**Proving test:** Schedule A, save its `lastDelay`, let A fire, schedule B, cancel using A's saved ref; B must still complete. Also test cancelling B's live ref, same-node replacement, 17th pending `err`, 10,000 sequential fired delays with bounded live memory, role loss and disposal using **injected** timers.

**Status:** **INFERRED** from the proposed reuse rule and current delay-reference/resolution semantics.

## Should-fix

### S1 — Explicitly handle unsupported pointer reads and non-finite values, not just unsupported **operations**

**References:** G-L3/G1, G-L4, G3, Q4; `build/index.js:13–26, 41–48, 1566–1645, 1103–1151, 7827–7876`; `adapter.js:155–175, 177–190`.

**Scenario:** A supported `pointer/get` can target an unsupported path (e.g. `/materials/0/...`) or a missing wired index. Its engine output is **not absent**: it returns the configured type's default plus `isValid: false`. For floats/vectors that default can be `NaN`; another supported op may read it and propagate that through math to an allowed `pointer/set`. Likewise, the first `onTick.timeSinceLastTick` and unavailable `onSelect.selectionPoint` / `selectionRayOrigin` carry `NaN` defaults. `math/NaN` and `math/Inf` are deliberately included in G-L2. G1's “supported reader cannot read unsupported op” test does not cover any of these paths. The client setter currently just enqueues through `world.set`; the server may reject a non-finite write, but by then an overlay could have reported the invalid value as a successful local write.

**Recommendation:** Preserve spec-correct typed defaults, but validate finite values and shape at the **adapter/runner write boundary**, before enqueue/overlay; log and discard invalid writes (or activate `err` where the operation exposes it). Document `pointer/get.isValid` as the graph-side guard. Test all the value sources above, `null` refs, division by zero, incorrect vector dimensions and zero-duration interpolation. Do not describe an unsupported pointer as a universally inert node: `get` still produces a default.

**Proving test:** Supported `pointer/get` of an unregistered float3 path feeding `math/add`/`pointer/set` must not enqueue NaN or null; a valid path still works; first-tick `timeSinceLastTick` and unset selection rays must cause no invalid outgoing sends. Check the actual server refusal, if any, rather than assuming it.

**Status:** **INFERRED** from vendor output-default and adapter enqueue paths. I do **not** claim unsupported pointer reads invariably throw; the vendor code shows they usually return defaults.

### S2 — The frame budget is a count budget, not a reliable latency or CPU budget

**References:** G4/G7, G-L7(a), P4/P13, §6 G4; `adapter.js:352–354, 396–409`; `runner.js:461–501`; `build/index.js:8579–8615, 8687–8705`.

**Scenario:** The cited 0.18–0.36 µs per node start is for particular probe graphs and hardware. A `math/mat*`, nested matrix computation, pointer read through the SOM, or expensive logging can cost much more than a simple flow node. Moreover, interpolation callbacks are processed once per tick **outside** the ordinary `processNodeStarted` accounting; active interpolations are bounded by registrations but are not zero-cost. A tick just under 10,000 starts can make a slow owner's tab miss frames even when the rotating world budget works as designed.

**Recommendation:** Keep the 10,000 ceiling as a safety limit, but call it a *node-start* budget, not a guaranteed 4–7 ms bound. Add stress benchmarks for matrix-heavy graphs, 64 engines, maximum interpolations, background/foreground transitions and constrained hardware. Report overruns (and consider an elapsed-time soft throttling guard) rather than assuming performance from `p2`.

**Proving test:** Profile a worst-case 256-node graph with many matrix ops and interpolations plus 63 other active graphs; measure p95 frame time and per-engine skip counts. Show the frame scheduler preserves progress under load.

**Status:** **INFERRED**; no performance run available.

### S3 — Treat network-sampled motion and lost terminal writes as an explicit compatibility limitation

**References:** G-L5(a), G4/G9, §7 DEV check 2–4; `runner.js:320–399, 461–501`; design §5.3.

**Scenario:** A 2-second transform interpolation may generate many host-local values but only sampled sends. With six keys, each gets roughly a 300 ms opportunity under the proposed queue. On abrupt host handover or producer disposal, the final sample can still be queued and then dropped; “the last value **always** goes out” is too strong. Visitors can stop at the last accepted sample; the next host restarts against a SOM value that may lag the completed interpolation. This is distinct from the intentional cosmetic stepping.

**Recommendation:** I can accept (a) for 4d-1 **as an explicit deviation**, but document that final arrival is conditional on the host remaining active until the queued final value is acknowledged. Add a regression for interruption at 1.99s and immediately after completion, and a per-key rate/fairness benchmark. If exact final state is a hard acceptance requirement, add a reliable terminal-set path or defer transform interpolation until the synced-transition design (b). Do not silently treat sampled movement as equivalent to synchronized animation.

**Proving test:** Interpolate two objects with competing 20-Hz traffic; close the host while the last value is pending, elect a new host, and compare actual persisted/visitor states and eventual convergence. Repeat with a steady host to prove the final value does reach visitors.

**Status:** **INFERRED** from queue coalescing and lifecycle disposal.

### S4 — Import size and reference conversion need adversarial, not only happy-path tests

**References:** G-L8(a), G6, §6 G6 tests; `behavior-spec.js:344–363, 455–482`; validator `build/index.js:11930–12000`.

**Scenario:** A 4 MiB `.glb` can claim a corrupt JSON chunk length; a nominally 4 MiB source can have deeply nested JSON or a large array of many graphs that expands during parsing/conversion. Permuting only pointer `[x]` literals but missing a `{ref}` literal in variables, event values or arbitrary value sockets silently retargets an object; a supplied file index can be a light host or an animation index and needs its own table. Rejection of *wired* sockets is right, but all dynamic-reference forms must be enumerated before the form can enable Save. Reporting a lossy conversion without refusing it does not satisfy G6's loss-aware promise.

**Recommendation:** Verify GLB magic/version/total length/chunk alignment/chunk bounds and refuse a missing/duplicate JSON chunk. Bound source *bytes before decoding*, then enforce JSON depth, node and graph counts before conversion; catch parsing errors without leaving the panel stuck. Traverse **all** typed ref literals in the graph, not just pointer configurations, and either remap every known node/light/animation reference or refuse it with a precise reason. Verify own-first permutation, uniqueness, grants and `onSelect` node restrictions at the real `behaviorCheck` boundary. Restrict HTML rendering via `textContent` and DOM nodes, including diagnostic/log sinks.

**Proving test:** Truncated/mismatched GLB headers; over-cap UTF-8 source; 4 MiB deeply nested JSON; mapping permutation with `[x]`, `{ref}`, variable initial ref and event value; a hidden wired ref; two different `onSelect` targets; duplicate names; and a malicious filename/op/diagnostic string. Save must either be a valid, disabled leaf or a clear refusal, never a silently changed target.

**Status:** **INFERRED** (importer is not implemented).

### S5 — The per-world storage and visitor download expansion needs a measured release gate

**References:** G-L7(a), G7, P17, G8; `packages/server/src/world.js:422–451`.

**Scenario:** 64 leaves × 65,536 UTF-16 code units can approach 4 MiB in stored JSON, before glTF framing, SOM metadata and other scene objects. `JSON.stringify` characters are **not** a socket-byte limit, and malicious non-ASCII content can amplify transmitted UTF-8 size. Every visitor receives the world. A server accepting one valid leaf need not mean a many-leaf world is cheap to serialize, persist, load, heal or distribute. The proposed 4 MiB figure is a rough character-based lower-order estimate, not a measured transport maximum.

**Recommendation:** Measure the actual compressed/uncompressed `som-dump` byte size, validation and serialization time, and browser memory with 64 maximum-size behaviours. Add a **total world behaviour payload budget** (bytes), not only per-leaf and count limits; use a real-socket oversized-string test as the 4c passdown requires. Make 4 MiB source import independent of the 64 KiB saved leaf limit.

**Proving test:** Persist/reload 64 max-size graphs (including multi-byte strings), admit a visitor and report real wire bytes/latency/memory, plus fail-closed cap behavior on `add`, `send` and healing.

**Status:** **INFERRED**; no runtime measurements here.

### S6 — A 4c rollback must not silently erase 4d graphs or discard unrelated post-release edits

**References:** P17, §8 rollback; `packages/server/src/world.js:422–451`.

**Scenario:** Rollback to the 4c binary and loading a 4d world makes healing replace every 4d-only behaviour with `null`; an autosave makes the loss durable. The pre-brief recognizes this, but “restore the pre-release PROD backup” also discards legitimate changes made after the release. In an emergency, an operator can correctly roll back code and still irreversibly erase data unless the precise restore/reconciliation sequence is prepared.

**Recommendation:** Make the release gate include a **non-destructive rollback plan**: preflight all loaded worlds and stop before opening a newer database with the old binary, or offer a maintenance-mode export/migration that retains 4d leaves while an older server is running. At minimum, rehearse rollback with a copy of production data, a post-upgrade edit and a 4d graph, with explicit restore and reconciliation steps. `scriptRunner: 3` should never be sent same-origin to an older server (or clearly document that page/server combinations are unsupported and require synchronized reload).

**Proving test:** Add a 4d-only graph and an unrelated edit after upgrading; simulate failed deployment and rollback; prove neither is silently lost and that reconnect/version refusal is comprehensible.

**Status:** **INFERRED; SOURCE-CHECKED** for the destructive healing path. The backup policy is documented, not tested here.

### S7 — `onStart` side effects and unsupported select outputs need a sharper owner-facing contract

**References:** P14, Q3–Q4, G3 `graphReport`, G6 importer; `build/index.js:8521–8528, 7827–7889`; `adapter.js:411–415`.

**Scenario:** `onStart` repeats on reload/handover, so “set door closed on start” can undo a real user interaction. Initial `onSelect.selectionPoint` and selection-ray values are `[NaN,NaN,NaN]`, **not ordinary safe zeros**; `controllerIndex` is 0 for Atrium's click, while point/ray are unavailable. A graph that reads the ray can enqueue invalid data or generate surprising math.

**Recommendation:** Show a prominent “runs again on owner reconnection, handover and re-enable; variables and timers reset” note at import and enable. Mark the exact `onSelect` socket outputs Atrium doesn't provide in `graphReport` and visibly warn if they feed downstream nodes. Consider an explicit confirmation for `onStart` graphs that mutate state. Continue to dispatch with the documented absent point/ray, not fabricated coordinates.

**Proving test:** Import a door-closing `onStart`, open the door manually, hand over the host and assert the UI warning matches the observed reset; run a graph using select rays and verify warning and no invalid network write.

**Status:** **INFERRED** from vendor defaults and adapter's `select` arguments.

## Nits

### N1 — Use one precise term for “bytes,” characters and wire size

**References:** G7, G1, §2.4, §6 G2. Current `BEHAVIOR_BYTES_MAX` is enforced as `JSON.stringify(...).length` (UTF-16 code units), not encoded bytes. Specify that exact quantity in the rule, and use a separate unit for transport bytes. Boundary tests must distinguish 65,536 units from 65,536 UTF-8 bytes. **Test:** ASCII vs multi-byte strings at the boundary. **Status: INFERRED.**

### N2 — Make the source/fixture baseline an explicit reproducibility record

**References:** §2.4, §2.5, G8. The static asset counts (178, 171, 143, 134) and probe timings were not independently reproducible in this environment. Keep the exact survey script, asset SHA, node version, machine/browser and generated fixture manifest in the kickoff/handoff; label the eight failures and one disposed case explicitly, so a future green count cannot hide a changed subset. **Test:** Recreate the manifest and counts from pinned assets on the build host. **Status: INFERRED.**

## Decisions: G-L1–G-L12

| Decision | Review recommendation |
|---|---|
| **G-L1** | **Agree with (a)**: keep runtime and owner importer together; isolate `KHR_animation_pointer` renderer work in 4d-2. |
| **G-L2** | **Conditional (a)**: the broad core math/flow set is reasonable if every admitted op is tested and the executable identity includes extension; a per-frame cost count is not sufficient performance proof. |
| **G-L3** | **Revise (a), not (b)**: storing unknown ops inert and reporting them is useful, but `(op, extension)` must be gated, with dependency checks covering the same identities. No name-based denylist. |
| **G-L4** | **Agree with (a)**: no writable material family until shared-resource authority and remapping are specified. Add unsupported-read/default warnings and write-value validation. |
| **G-L5** | **Conditional (a)**: sampled motion is tolerable in a first cut only as an explicit temporary design deviation with no unconditional final-write guarantee; (b) remains the proper synced-motion solution. |
| **G-L6** | **Agree with (a) in purpose; revise mechanism**: overlay needs source/seq metadata and monotonic per-key revisions, not just `som:set` and “last seq” clearing. |
| **G-L7** | **Conditional (a)**: 256 nodes / 64 Ki UTF-16 units may be acceptable, but add a total-world wire-size cap, safe non-reused delay handles and worst-case CPU tests. |
| **G-L8** | **Agree with (a)**: manual mapping and declining wired/dynamic indices are the correct conservative importer seam; fully enumerate refs and refuse lossy remaps. |
| **G-L9** | **Agree with (a)**: `scriptRunner: 3` is necessary to prevent stale 4c hosts. Document same-origin downgrade/rollback behavior explicitly. |
| **G-L10** | **Agree with (a)**: defer per-behaviour distance. |
| **G-L11** | **Agree with (a)**: independently authored fixtures plus a pinned checked-in Khronos subset; ensure the tests exercise the actual client/engine seams. |
| **G-L12** | **Agree with (a)**: carry only `logCheckFailure` through `logId`; keep same-tab sign-in separate. |

## Questions: Q1–Q6

**Q1 — Registry as the only run gate?** **Not as drafted.** A keep-only registry is necessary, and the static compiler checks currently skip deleted/extension nodes, but the loader resolves runtime classes by `op` alone. Gate extension-qualified identities as M1 requires. A short server denylist based on words such as `fetch` or `js` is brittle: unknown ops should be admitted as inert under validated type/size/depth constraints. Use a positive *executable identity* allowlist and test the entire loader/compile path against every pinned engine upgrade.

**Q2 — Stepped transform motion?** **Acceptable as a consciously limited 4d-1 feature**, not as an exact implementation of design §5.3. Show a warning and test interference and handover; do not guarantee an unsent terminal sample. If smooth synchronized motion or exact final convergence is an acceptance criterion, defer transform interpolation or implement G-L5(b).

**Q3 — `onStart` on every handover?** This is consistent with the stated fresh-runner semantics, but “starts on load” understates it. Say *“runs again on every owner-tab handover, reload and re-enable and may overwrite saved state”*, with an owner-visible confirmation for mutating graphs. Persistent one-time initialization would need a separate feature, not a disguised special case.

**Q4 — Select outputs?** **Yes, flag them.** Specifically flag downstream reads of `selectionPoint` and `selectionRayOrigin` (unavailable / NaN in Atrium), and any semantics dependent on controller/ray values; display available `selectedNode`/event references accurately. A generic “partially supported” label is not enough to explain non-finite input.

**Q5 — Fairness?** Rotating the start is preferable to fixed-order starvation. Do **not** automatically disable solely for N elapsed seconds skipped: background tabs and heavy worlds make wall-time thresholds nondeterministic. Add per-engine skips, a visible sustained-throttling status and possibly a configurable budget/slow-graph diagnosis. Retain per-tick hard disposal for runaway work.

**Q6 — 10,000 per tick?** **Keep it initially**, document that some valid Khronos stress graphs (notably `math/random`) exceed Atrium's execution ceiling, and treat a run-time `over-budget` as explicit incompatibility. Do not raise both the tick and frame budgets simply to make a conformance counter green; first profile that asset and establish a safe worst-case workload.

## Audit of every claimed P fact in §2

These are **source checks**, not reproduced runtime claims. “Holds” means the specific stated mechanism is present in the pinned files; author-probe output is not independently confirmed.

| Fact | Result and pinned source evidence |
|---|---|
| **P1** | **Holds.** Ten-op list in `behavior-spec.js:64–67`, mirrored by `send-policy.js:537–540`; `behavior-spec.js:383–399` rejects others. |
| **P2** | **Holds.** `behavior-spec.js:373–380, 411–418, 455–464, 546–560`; `send-policy.js:725–735` mirrors the variables refusal. The final validator call is `behavior-spec.js:524–528`. |
| **P3** | **Holds.** Pointers are registered only for `nodeMap` entries in `adapter.js:155–175`; write authority is at `:327–342`. |
| **P4** | **Holds.** Per-engine `steps` reset and throw in `adapter.js:352–354, 397–409`; existing runner `runner.js:461–501` ticks all active engines with no world-wide step sum. |
| **P5** | **Holds with intended qualification.** `adapter.js:376–394` owns/clears the interval timer, loads engine with `false` (`:361`), creates a new event bus (`:303`). The engine's *manual tick* still reads `performance.now()`, which matters for P12. |
| **P6** | **Holds.** `runner.js:187–197, 325–369` queues writes while `get` reads the SOM, and `AtriumClient.js:1699–1710` applies echoed values later. |
| **P7** | **Holds.** `runner.js:38–40, 338–369, 491–501` documents and implements one 50-ms opportunity and FIFO coalescing. |
| **P8** | **Holds from source.** `apps/client/src/app.js:3246,3268` drives runner tick through the render loop; background throttling is a browser inference, not a reproduced browser test. |
| **P9** | **Holds, with warning.** `index.js:8499–8511` instantiates `NoOpNode`; `:6604–6624` supplies declared defaults; the two compiled paths skip extension/nonstandard constructors at `:36,233`. Missing *core* outputs can throw when read; `p3/p3b` results not rerun. |
| **P10** | **Holds from code.** Extension declarations bypass the core-schema lookup (`index.js:11905–11923`), value inputs only reference earlier nodes and flows point later (`:11927–11937`); the tick snapshots queued events before processing (`:8673–8685`). This does **not** validate the stated exact p7 tick counts here. |
| **P11** | **Holds.** `SetDelay` uses global `setTimeout` (`index.js:4409–4419`); `pushScheduledDelay` appends (`:8356–8362`), removal leaves holes (`:8374–8382`), and engine disposal clears them (`:8328–8345`). The 10,000-case p5 measurement was not rerun. |
| **P12** | **Partly holds; design implication overstated.** Getter is `index.js:8204–8206`; `onTick` reads it (`:1126–1149`); however `executeEventQueue()` **still unconditionally calls** `performance.now()` (`:8667–8670`). The reported injected-clock outputs were not rerun. **M3.** |
| **P13** | **Holds with caution.** `PointerInterpolate` resolves the pointer and starts cubic-bezier (`:5231–5291`); callback replacement by pointer path is `:8581–8616`. The interpolation callback is declared `async` but invoked without `await` (`:8687–8695`), so future errors in it need explicit rejection handling. Distinct pointer targets and variables are bounded by registration, not node-start accounting. |
| **P14** | **Holds.** `onStart` is queued on graph load (`:8521–8528`), `onTick` dispatched each tick after interpolations (`:8697–8705`); runner recreates engines on enable/world/behaviour reload (`runner.js:207–275, 599–639`). |
| **P15** | **Holds from parser/validator and pointer registry.** `parsePathTemplate` and wired-ref validation in `index.js:533ff,11977–11986`; adapter registers only mapped targets (`adapter.js:155–175`). The eight p4 runtime examples were not rerun. |
| **P16** | **Holds.** `session.js:554–555,815` checks current runner capability; client connects with the advertised capability via `packages/client/src/AtriumClient.js:595,757`, with app's same-origin choice. Changing to 3 needs all call sites. |
| **P17** | **Holds, serious operational consequence.** `world.js:422–451` drops a behaviour whose old rule rejects it. Rolling back on upgraded data is destructive, as the document says. **S6.** |
| **P18** | **Holds.** Light field set includes `color` (`send-policy.js:75`); material mutation uses per-node primitive chain (`:1368–1398`), unlike a glTF global material index. |

The static Khronos survey in §2.4 (asset counts, coverage and reference patterns), Chromium timings, and all p1–p7 outputs are **not independently verified** because no repository checkout/assets were available.

## Original source probe (executed) and runtime probe (prepared, not executed)

I ran an original read-only source probe against the **full pinned text** of `adapter.js`, `AtriumClient.js`, and the vendored engine returned by GitHub. Its checks were equivalent to the following reproducible Node script once the clone is available:

```js
// devtasks/spike-4d/reviewer-static-probe.mjs — run from repository root
import { readFileSync } from 'node:fs'
const read = p => readFileSync(p, 'utf8')
const engine = read('packages/gltf-interactivity-engine/build/index.js')
const adapter = read('packages/behaviors/src/adapter.js')
const client = read('packages/client/src/AtriumClient.js')
const checks = [
  ['runtime lookup ignores declaration.extension',
    /const nodeType = nodeDeclaration\.op;[\s\S]{0,250}this\.registry\.get\(nodeType\)/.test(engine)],
  ['validator treats extension declarations as opaque',
    /if \(!declaration\.extension\) \{[\s\S]{0,190}unknown core operation/.test(engine)],
  ['optimized compilers explicitly skip extension declarations',
    (engine.match(/node\.declaration\.extension \|\| node\.constructor !== standard\.get\(op\)/g) || []).length === 2],
  ['engine tick calls performance.now despite injected getter',
    /executeEventQueue = \(manualStep = false\) => \{[\s\S]{0,100}this\._lastTickTime = performance\.now\(\)/.test(engine)],
  ['adapter getter injection not implemented yet',
    !/Object\.defineProperty\(engine,\s*['"]lastTickTime['"]/.test(adapter)],
  ['own echo emits som:set before edit:accepted',
    /if \(edit\.type === 'send' && edit\.applyEcho === true\)[\s\S]{0,400}this\.emit\('som:set', \{ nodeName: edit\.node, path: edit\.field, value: msg\.value \}\)[\s\S]{0,120}this\.emit\('edit:accepted'/.test(client)],
  ['local and remote som:set omit source/session',
    (client.match(/this\.emit\('som:set', \{ nodeName: (?:edit\.node|msg\.node), path: (?:edit\.field|msg\.field), value: msg\.value \}\)/g) || []).length >= 2],
]
for (const [name, yes] of checks) console.log(`${yes ? 'CONFIRMED' : 'NOT CONFIRMED'}: ${name}`)
```

**Actual source-check output** (using the fetched pinned texts, not an installed checkout):

```text
CONFIRMED: runtime lookup ignores declaration.extension
CONFIRMED: validator treats extension declarations as opaque
CONFIRMED: optimized compilers explicitly skip extension declarations
CONFIRMED: engine tick calls performance.now despite injected getter
CONFIRMED: adapter getter injection not implemented yet
CONFIRMED: own echo emits som:set before edit:accepted
CONFIRMED: local and remote som:set omit source/session
```

A **runtime falsification probe** for M1, suitable for saving next to `p3.mjs`, is below. It deliberately creates an extension declaration whose op name collides with a registered core op. The `p3` helper already validates the equivalent bare-core graph; this changes the declaration, not the graph's flow or target.

```js
// devtasks/spike-4d/reviewer-extension-collision.mjs
// PREPARED; NOT RUN here (the clone failed).
import { BasicBehaveEngine, NodeEventBus, graph, lit, to, T,
         validateInteractivityGraph } from './g.mjs'

const g = graph([
  { op: 'event/onStart', flows: { out: to(1) } },
  { op: 'flow/sequence', flows: { a: to(2) } },
  { op: 'pointer/set',
    configuration: {
      pointer: { value: ['/nodes/0/translation'] },
      type: { value: [T.float3] },
    },
    values: { value: lit(T.float3, [7, 8, 9]) },
  },
])
g.declarations.find(d => d.op === 'flow/sequence').extension = 'EXT_probe'
validateInteractivityGraph(g)
const eng = new BasicBehaveEngine(60, new NodeEventBus())
const allow = new Set(['event/onStart', 'flow/sequence', 'pointer/set'])
for (const op of [...eng.registry.keys()]) if (!allow.has(op)) eng.registry.delete(op)
const writes = []
eng.registerJsonPointer('/nodes/0/translation', () => [0, 0, 0],
  (_p, value) => writes.push(value), 'float3', false)
eng.loadBehaveGraph(g, false)
console.log('flow node class:', eng.idToBehaviourNodeMap.get(1).constructor.name)
eng.executeEventQueueTick()
console.log('writes:', JSON.stringify(writes))
eng.dispose()
```

**Runtime output:** **Not available**; this probe could not be run with the pinned engine and dependencies in this environment. From source, the expected discriminating observation is that the extension-qualified flow node is `Sequence`, **not** `NoOpNode`, and reaches the setter. The exact output must be captured on a real checkout before marking M1 VERIFIED. An implementation passing only the registry-key-set test would miss this case.

---

**Release/re-review gate:** Resolve M1–M4 in the revised brief; add the corresponding negative fixtures, exact local-event seam tests and rollback drill; have the implementer run the named suites and p1–p7, plus the two reviewer probes, on the pinned checkout. Preserve the generated logs rather than treating the baseline counts quoted in Rev 0 as independently witnessed results.
