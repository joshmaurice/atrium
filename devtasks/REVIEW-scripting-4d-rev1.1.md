# Atrium scripting-4d pre-brief review — Rev 1.1

**Verdict: APPROVE WITH NITS.** Rev 1.1 takes every Rev 1 finding, and each fix is sound at the seam it names: the send opportunity is now total and every seq it records is settleable (the server answers every `send`, and the client resolves the rest as `edit:unknown` at every connection end), the runner's write check is the server's own value rule, the rollback restore is an offline, non-overwriting reconcile, and the interpolation wrapper sits at the one seam that sees every action. Nothing needs a new mechanism or a decision change before FINAL. Two should-fixes are one-paragraph text edits that close real ambiguities an implementer would otherwise resolve the wrong way (G10's equal-leaf case, and where the overlay write lives relative to `enqueue`); I would fold them into FINAL without another review round. No must-fix.

**Reviewed:** `joshmaurice/atrium` at `3a689eb4db23ada36a4e50da446b90b1f6191e45` (`devtasks/PREBRIEF-scripting-4d.md` **Rev 1.1**, §0.2 and the Rev 1.1 table in §11 first, then the whole file), my `REVIEW-scripting-4d-rev1.md`, `REVIEW-scripting-4d-rev0.md` where needed, `devtasks/spike-4d/r3-interpolation-rejection.mjs` and `README.md`, and the unchanged code at the cited lines (`41acd2ff` is the code base of this commit; `git diff --stat 41acd2ff 3a689eb4` touches only `devtasks/`, so line numbers hold). **Cloned: YES**, this time:

```text
$ git clone https://github.com/joshmaurice/atrium && cd atrium && git checkout 3a689eb4…
HEAD is now at 3a689eb Pre-brief scripting-4d Rev 1.1: the second outside review, all findings taken
Node v22.23.4, pnpm 10.28.0; pnpm install: Done in 2.2s (better-sqlite3 and argon2 built)
```

**What I ran** (from the repo root, as the brief asks):

```text
$ timeout 30 node devtasks/spike-4d/r3-interpolation-rejection.mjs
(a) no wrapper: disposed false; caught by the wrapper []; unhandled so far ["setPathValue threw (forced)","setPathValue threw (forced)"]
(b) wrapper on the bus: disposed false; caught by the wrapper ["setPathValue threw (forced)","setPathValue threw (forced)"]; unhandled so far []

$ timeout 30 node devtasks/spike-4d/r1-extension-collision.mjs
bare core flow/sequence: validator valid; node 1 class Sequence; writes [[7,8,9]]
flow/sequence with extension EXT_probe: validator valid; node 1 class Sequence; writes [[7,8,9]]
event/onTick with extension EXT_probe: validator valid; class OnTickNode; onTick indices [0]; writes 2

$ timeout 30 node devtasks/spike-4d/r2-clock-and-defaults.mjs
M3: tick with a throwing performance.now → disposed true engine-error | writes [[0,0,0]]
M3 narrowed: real clock jumping, injected 1000 → 1250 → timeSinceStart [0,0.25]
S1a: get of an unregistered float3 path → set writes [[null,null,null]] disposed false
S1b: onTick timeSinceLastTick on ticks 1 and 2 → writes [[null,0,0],[0.016000000000000014,0,0]]

$ (cd packages/behaviors && node --test tests/*.test.js)
# tests 177 / # suites 32 / # pass 176 / # fail 0 / # skipped 1
  ok 2 - the subset recomputes against the checked-in list, and every asset runs # SKIP KHRONOS_ASSETS is not set …
```

All four agree with §2.5, P25 and the README (`r2`'s `[NaN, …]` prints as `[null, …]` because the probe serializes the write, exactly as P21 says it does on the wire). I also ran one probe of my own, `x1` (appendix), to test a P25 claim rather than infer it. **VERIFIED** below means I ran code at this commit; **INFERRED** means the planned mechanism was read against the source. The 4d code does not exist yet, so every statement about G1–G10 is about the contract, not an implementation.

## Rev 1 findings: closed / partly / not closed

| Rev 1 | Status in Rev 1.1 | Basis |
|---|---|---|
| **M1** Overlay keeps a value no send was made for | **CLOSED** | §0.2, G4 "the send opportunity is total", G5 `canSend()`, the invariant in G4 and §9, proof (d5). The other leg of the invariant holds at the transport today: every `send` the server receives is answered with its seq (`session.js:695–712` for the depth guard and schema, `:1075–1199` for every branch of `case 'send'`, the broadcast carrying `requestSeq` at `:1198`), and every pending seq becomes `edit:unknown` at every connection end (`AtriumClient.js:1505–1513`, called at `:617`, `:844`, `:902`, `:969`). `pendingEdits` is always a `Map` on a record (`:688`), so a tracked seq can't be silently untracked. **VERIFIED** at the code; the opportunity itself is INFERRED. See S2 for one spec-level hazard around `enqueue`'s return value. |
| **M2** Finite but invalid transforms enter the overlay | **CLOSED** | G4 writes the server's rule in full (P23: unit quaternion within 1e-3, scale ≥ 1e-6, three/four finite numbers, boolean `visible`, the light fields as `send-policy.js:1419–1437` checks them — colour is now 3 finite numbers, harmonised rather than stricter). Shared vectors pin the copy; proof (d4). The rotation demo multiplies by a unit quaternion (N2). `math/quatMul` works in doubles (`index.js` "plain number arrays … spec floats are doubles"), so drift over two minutes is ~1e-13, far inside 1e-3: "never normalise" is the right call (§2b below). **INFERRED; server rules SOURCE-CHECKED.** |
| **M3** Rollback restore not conflict-safe or authorized | **CLOSED in design** | G10 export and reconcile run offline by the operator with the server stopped (P24: `db.js:50–61`, `world-store.js:37, 79`), dry-run by default, restore only on world + unique `objectId` + healed leaf, everything else a reported conflict, one transaction per world, rehearsed with two offline owners (§6.1 check 11, §8 steps 1–5), proof (h). The authority question is answered correctly. One rule is missing from the text and matters on most worlds: the equal-leaf case, **S1**. |
| **S1** `listensForSelect` judges by op name | **CLOSED** | G1 states the exception to G-L3 (a) explicitly: any `event/onSelect` declaration that isn't exactly the Khronos identity is refused, as today (`behavior-spec.js:389–393`), and both `listensForSelect` copies (`:267–276`, `send-policy.js:901–910`) and `selectTargetFor` (`:291–299`) judge by identity as belt and braces. Vectors for both. |
| **S2** World total lacks add/Duplicate/Undo coverage | **CLOSED** | G2: one pure `behaviorBytesIn(som, excludeNode)` on `send`, `add` and healing; Duplicate, Undo and Redo reach it through `add`, and a refused Undo drops its entry with the server's text (`edit-undo.js:273`, `failEntry` at `:604`). Boundary tests on each path, proof (b3). I checked for any other document write: the HTTP update path's document is always server-generated from the live host (`http-routes.js:724–762`, `:824`), so there is no fourth path. **VERIFIED.** |
| **S3** `other` refs presumed harmless | **CLOSED** | G6: an unmapped ref stays only when every consumer, followed through variables and event values, is a node Atrium doesn't run or an unsupported pointer; otherwise refused naming ref and consumer; the iterative depth check precedes any walk. Sound as a conservative rule (§2f); N4 asks for two test cases. |
| **S4** Interpolation rejection test doesn't prove containment | **CLOSED** | **Reproduced** by `r3` (I ran it: two unhandled rejections and no disposal without the wrapper; none with it). G3 wraps every pointer and variable action where the adapter's bus registers it (P25: `index.js:8736–8741` → `adapter.js:85–90`), and the test forces the rejection in `setPathValue` (`:8425`) before any setter. See §2g and N1 for the sync/async timing detail. **VERIFIED** (r3) / INFERRED (the wrapper). |
| **N1** "Verified" overstated | **CLOSED** | Status, §0.1 and §11 now say *reproduced* / *confirmed in the source*; the round's tests verify the fixes. |
| **N2** The rotation demo | **CLOSED** | §6.1 check 2 and §7 step 2: `math/quatFromAxisAngle` × `math/quatMul`, two minutes without `INVALID_VALUE`. |

## New findings

### Must-fix

None. Nothing in Rev 1.1 is a bug, a security hole, or a contract the code can't meet.

### Should-fix

#### S1 — G10 must say what the reconcile does with a leaf that is *already* the exported leaf

**References:** G10 (`behaviors-reconcile.mjs`: "restores only when … that node's behaviour is now `null` or absent", "a different leaf on the node … conflict", "run twice, the second run does nothing"); §8 steps 3–4; P17; [`world.js:383–386`](https://github.com/joshmaurice/atrium/blob/3a689eb4db23ada36a4e50da446b90b1f6191e45/packages/server/src/world.js#L383-L386), [`:470`](https://github.com/joshmaurice/atrium/blob/3a689eb4db23ada36a4e50da446b90b1f6191e45/packages/server/src/world.js#L470), [`:627`](https://github.com/joshmaurice/atrium/blob/3a689eb4db23ada36a4e50da446b90b1f6191e45/packages/server/src/world.js#L627); [`autosave.js:84`](https://github.com/joshmaurice/atrium/blob/3a689eb4db23ada36a4e50da446b90b1f6191e45/packages/server/src/autosave.js#L84); [`world-registry.js:631`](https://github.com/joshmaurice/atrium/blob/3a689eb4db23ada36a4e50da446b90b1f6191e45/packages/server/src/world-registry.js#L631).

**Scenario:** G10's rules name two states for the node — healed (`null`/absent → restore) and "a different leaf" (→ conflict) — and are silent on the third, which is the most common one: **the current leaf equals the exported leaf.** It arises two ways. (1) After `--apply`, every restored node is in this state, so the second run, which "does nothing", must classify it; read as an if/else, "not null → conflict" turns the idempotence run into a conflict report naming every restored world. (2) More importantly, 4c's healing is **in memory**: `healDocumentBehaviors` runs at load (`:470`, `:627`) and sets the leaf to `null` on the loaded document (`:383–386`), but that `null` reaches the database only through the autosave coordinator, which saves on a saveable mutation (`world-registry.js:631`, `autosave.js:84`). A world that nobody edited during the rollback — most worlds, and every world whose owner was offline — still holds its intact 4d leaf in `worlds.document`. The rehearsal as written (two offline owners) will meet this on its first world. The report then tells the operator to tell owners (§8 step 5) about leaves that were never lost.

**Recommendation:** Add the third rule to G10: *if the node's current leaf has the exported leaf's sha256, it is `unchanged`: no write, not a conflict, counted separately in the report.* State the three outcomes as a table (restore / unchanged / conflict, with the reasons under conflict). Make "the second run does nothing" mean exactly: zero writes and zero conflicts, every row `unchanged` or the same conflict as the first run. While there: re-check caps cumulatively per world in document order, and run the restored document through the server's own `healDocumentBehaviors` (import it, don't copy it) before the write, so what the reconcile writes is what the next load keeps; note that file-backed worlds (`world.js:462–470`) are out of scope because they are never autosaved and so never hold a persisted 4d leaf.

**Proving test:** In G10's scratch-database test, add a world the rollback never touched (the 4d leaf intact in `document`), and assert the dry run and `--apply` both report it `unchanged` with no write; assert the second `--apply` reports zero conflicts and zero writes, not merely "no change to the file". **VERIFIED** that healing is not persisted without a mutation (code read at the lines above, and the autosave coordinator's only `updateWorld` call); the reconcile is INFERRED.

#### S2 — Put the overlay write inside `enqueue`, after `queue.set`, and write down the remote `som:set` → key mapping

**References:** G-L6 (a) "latest accepted-for-queueing write", G4 "Each accepted write gets the next revision", the invariant; [`runner.js:323–368`](https://github.com/joshmaurice/atrium/blob/3a689eb4db23ada36a4e50da446b90b1f6191e45/packages/behaviors/src/runner.js#L323-L368) (`enqueue`), especially `:345–351`; [`adapter.js:177–182`](https://github.com/joshmaurice/atrium/blob/3a689eb4db23ada36a4e50da446b90b1f6191e45/packages/behaviors/src/adapter.js#L177-L182); [`AtriumClient.js:1634–1643`](https://github.com/joshmaurice/atrium/blob/3a689eb4db23ada36a4e50da446b90b1f6191e45/packages/client/src/AtriumClient.js#L1634-L1643), `:1702–1708`; `runner.js:417–421`.

**Scenario:** (a) Today `enqueue` returns `true` on the drag-rule drop (`:345–351`: the value is **not** queued, one line is logged, and `true` comes back), and the adapter's `write` treats `=== true` as success (`adapter.js:181`). G4 says a write goes into the overlay when it is "accepted for queueing", and the natural implementation — `if (enqueue(...)) overlay.set(...)` in the setter — creates an overlay entry with neither a queued key nor a seq behind it on every drag drop. That is precisely the invariant G4 states, broken on a path G-L6 already lists ("a drop (the drag rule …) clears an entry"), but by the *creation* side, which the clear rule can't repair. The 100-key cap path returns `false` and is safe. (b) The clear rule for a **remote** set is keyed by `(nodeName, path)` from `som:set`, while the overlay is keyed by `(objectId, kind, field)`. For a light the runner sends `node: "X.light"` (`runner.js:420`) and the server echoes that name back, so a remote light set arrives as `{ nodeName: "X.light", path: "intensity" }` (`AtriumClient.js:1643`); an animation set arrives as `{ nodeName: "X", path: "extras.atrium.animation" }`. G4 says "the same rules hold for node fields, lights and animation keys" without saying how those two spellings become keys. The G4 test ("the same for a light key") would catch a miss, but the brief should not leave the mapping to be discovered by a failing test.

**Recommendation:** (a) Specify that the overlay entry is written **inside `enqueue`, immediately after `queue.set`**, in the same function, so no caller can create one without a queued key; have the gesture drop return `false` (it is a refused write for the graph too) or make the setter's result independent of the overlay. Say the producer is `(behaviourId, generation)`. (b) Add one sentence: a remote `som:set` is mapped to a key by resolving `nodeName` (stripping a `.light` suffix to `kind: 'light'`), reading the node's `objectId`, and mapping `extras.atrium.animation` to `('animation', 'play')`; a `som:set` with `path: 'name'` touches no key (the overlay is by `objectId`). Note that animation reads (`clipStatus`) should keep reading the SOM, since the server stamps `startedAt` and the overlay's copy would be wrong.

**Proving test:** With a gesture set on the target, a write from `onTick`: the queue has no entry, the overlay has no entry, the next `get` reads the SOM, and one line is logged (the existing drag test extended by two assertions). For (b): a remote light `som:set` and a remote animation `som:set` each clear the matching overlay entry and drop the queued write; a remote rename clears nothing. **INFERRED; the `true` return VERIFIED at `runner.js:350`.**

### Nits

**N1 — The wrapper's two paths have different timing; say which, and dispose at the start of the next tick.** `pointer/interpolate`'s action is `async` (`index.js:8584`), so its throw is a rejection; `variable/interpolate`'s is a plain function (`:6579–6595`), so its throw is synchronous and today aborts the tick through the adapter's wrapper (`adapter.js:397–409`). A bus wrapper with `try/catch` turns the second into "the rest of this tick runs, disposal next tick". Either rethrow a synchronous throw after recording it (keeps today's same-tick disposal) or state the change. Also say that the marked disposal happens *before* `executeEventQueueTick` on the next tick, that the mark is idempotent (the failing action stays registered until then, so it fires once more), and that a handler arriving after disposal is a no-op. **References:** G3 "Interpolation", P25, §6 G3. **Test:** force a sync throw in a variable action and a rejection in a pointer action; assert one log line and one `engine-error` disposal each, at the stated tick. **INFERRED.** (Related, VERIFIED by my `x1` probe: an interpolation's `done` flow is enqueued to the work queue, `index.js:5283–5285`, so an over-budget `done` flow throws in the *next* tick synchronously and is disposed `over-budget` as today — P25's "no action is known to reject" holds even there; worth one sentence in P25.)

**N2 — Two wordings overstate the value check.** §9 says "the overlay never holds a value the server will refuse"; G4 checks the server's **value** rules, and the server can still refuse for authority or target reasons (`send-policy.js:1309–1313` live avatars, external nodes via `externalNames`, `NODE_NOT_FOUND` from `world.setField`), which `edit:rejected` then clears. Say "a value the server's value rules will refuse". G2 says `behaviorBytesIn` is used "as `behaviorCountIn` is today" by `send`, `add` and healing; healing counts inline (`world.js:445–451`), not through `behaviorCountIn`. Say the new helper is used by all three, and that it iterates exactly as `behaviorCountIn` does (`send-policy.js:950–959`: `allNodes`, external nodes skipped). **INFERRED; lines VERIFIED.**

**N3 — §8's procedure, four small additions.** (1) Take the database copy with SQLite's backup (`sqlite3 db ".backup copy"` or `VACUUM INTO`), not a file copy, so a WAL can't be left behind; (2) take a second copy right before `--apply` (the reconcile is the only risky write); (3) have both scripts refuse to run unless they get an exclusive lock (`BEGIN IMMEDIATE`) and nothing else holds the file, so "with the server stopped" is checked, not assumed; (4) for the stated limit (a node the owner deliberately left empty), the export already records the world's `updated_at`: report restores in two classes, *world untouched since export* and *world edited during the rollback*, so step 5 knows which owners to ask. **References:** G10, §8 steps 1–5, §6.1 check 11. **INFERRED.**

**N4 — Two test cases and two log lines.** G6: name `math/select` and `math/switch` in the tests — they are the two `math/*` ops typed on `ref` (`index.js:10216–10253`) and are running consumers, so the rule refuses a ref through them; state that `variable/set`, `variable/get`, `event/send` and `event/receive` are the only transparent carriers, every other running consumer refuses. Q7: the 250 ms serialize-and-heal threshold needs the server to log both times (one line each, with a `logId`); add them to G2 so the harness can read them. **INFERRED.**

## The new mechanisms (§2 of the brief's checklist)

**a. G4/G5 and the invariant.** I walked each named path against the runner as it stands. *A send whose seq is never answered:* not reachable — see M1 above (every server branch answers, the client resolves the rest at every connection end; `canSend()`'s two conditions, `_worldReady` and `readyState === OPEN`, are exactly what `sendField` and `_wsSend` test, `AtriumClient.js:1373`, `:2067`, and they can't change between the check and the send within one synchronous call). *Reconnect:* `connect()` resolves the old record's seqs as unknown before `connecting` (`:617`), `_sendSeq` restarts per connection, and `disposeAll` clears `sendSeqs` (`runner.js:167`); G4 must say the seq map is cleared with the overlay (it does, by "in the same call"). *Role loss / world change:* `script-host:changed`, `connecting`, `disconnected` → `evaluate` → `disposeAll` (`:620–624`, `:608`). *A throw partway through a frame:* each engine tick is caught (`:492`), the opportunity is to be total, and the overlay write (S2) sits inside the caught region; a throw after `queue.set` leaves a queued key without an overlay entry, which the invariant permits. *Two producers:* the queue entry's producer is the latest writer (`:366` replaces the whole entry); disposing A keeps B's entry and B's revision; disposing B removes both (`:125`, and G-L6's "latest revision is that producer's"); a forgotten in-flight seq of A (`:133–138`) belongs to an entry already cleared. *Light and animation keys:* own echoes emit `som:set` with `requestSeq` for both (`AtriumClient.js:1680–1686`, `:1702–1708`); remote spellings are S2(b). **No breach found; S2(a) is the one place the text lets an implementer create one.**

**b. G4's write check.** Everything the server's *value* rules refuse is now refused before the queue (P23 complete for the fields the decorator writes: `translation`, `rotation`, `scale`, `visible`, light `intensity` and `color`); what the server can still refuse is authority and target state, which the answer clears (N2). "Never normalise" is right: a normalised value would differ from what the graph computed and reads back, hide a component-addition bug, and change what visitors see from what the graph produced; the engine's quaternion math is in doubles, so a well-written graph never drifts near 1e-3. The E1 shared-vector pattern is the right pin given `packages/behaviors` must not import the server.

**c. G10 and §8.** Restore and conflict rules are correct for world, `objectId`, duplicates, deletions, a replaced leaf, a refused leaf, one transaction per world. Missing: the equal-leaf outcome (S1) and the cumulative cap order (S1). The "deliberately left empty" limit is acceptable as stated; `updated_at` sharpens it (N3). The offline operator authority is sound: the database is the system of record, no server authorization is bypassed because the server's own rule is re-applied, and the report is the audit trail — add the lock check (N3).

**d. G1's `onSelect` exception** is the right resolution of my S1: refusing at the rule keeps the stored graph's selectability unambiguous, and the by-identity predicates stop a future widening from reopening it. `graphNodes` / `behaviorNodes` need to yield the declaration's `extension` for that; the vectors will show it.

**e. G2's `behaviorBytesIn`** covers every path that writes a leaf (VERIFIED: `send`, `add`, healing; the HTTP update never accepts a client document). The Undo refusal through `failEntry` with the server's text is already how a refused undo surfaces (`edit-undo.js:273`).

**f. G6's `other` rule** cannot miss a consumer *as a conservative rule*: any running node that reads the ref refuses, and only variables and events are followed through. The two ref-typed `math/*` ops are the cases to name (N4).

**g. G3's wrapper** contains every rejection: both registrations go through the adapter's bus (`index.js:8736–8741`), the engine calls each stored `action` once per tick (`:8690–8695`) and never reads its result, and `clearPointerInterpolation` deletes by path, so a wrapper object is cleared like the original. Timing and idempotence are N1.

## Anything the code contradicts

Nothing Rev 1.1 asserts about the code is wrong at `3a689eb4`; every cited line was checked (`AtriumClient.js:1372–1373`, `:2066–2070`; `runner.js:417–421`; `app.js:3245`, `:3258`; `send-policy.js:1316–1330`; `behavior-spec.js:389–392`, `:267–276`; `db.js:50–61`; `world-store.js:37`, `:79`; `index.js:8425`, `:8591–8609`, `:8613`, `:8736–8740`; `adapter.js:85–90`, `:392–393`). Two implicit assumptions are contradicted and are the substance of S1 and S2: healing's `null` is not persisted without a mutation (`world.js:470`, `:627`; `autosave.js:84`), and `enqueue` returns `true` for a drag drop (`runner.js:350`).

## Q3 and Q7

**Q3 — confirm once at Enable: sound, with one widening to consider.** Asking when the owner turns Enabled on for a custom graph with `startsOnLoad` and a write, naming the grants outside its subtree, and never on reload or handover, is the right shape: it is tied to the one deliberate act and costs nothing afterwards. Two edits. (1) "Once" and "nothing is stored" conflict only in wording: say it asks on every Enable in the form for such a graph (a re-enable is deliberate), not "the first time". (2) The condition names `startsOnLoad` but the graph that overwrites visitors' changes hardest is the `perFrame` one (`onTick` writes from the first frame, every frame, on every host); I'd ask for `startsOnLoad || perFrame` with a write, using the same text. Testable: a unit test on the predicate from `graphReport`, and a panel test through the strict DOM fake that the dialog appears for the four combinations and not for a template.

**Q7 — the thresholds are sound and testable, with instrumentation named.** 1.5 s extra join time on the harness's loopback is generous (1 MiB of JSON parses in tens of milliseconds) but that is what a gate should be: it catches a pathological cost, not noise. Specify the A/B: the same world with and without the 1 MiB of leaves, three visitors joining concurrently, five runs, the median. 250 ms serialize-and-heal is measurable only if the server logs both (N4). 50 MB of visitor heap is measurable in the Chromium harness through CDP (`HeapProfiler.collectGarbage` then `Performance.getMetrics` `JSHeapUsedSize`), as a delta against the no-behaviour world on the same page; Firefox (DEV acceptance) can't measure it, so say the number is the harness's. The multi-byte requirement is right: at 3 bytes a character a leaf of 65,536 units is ~192 KiB, so the 1 MiB total, not the leaf cap, is what bounds the world. Keep the cap provisional as §5 says; lowering it reruns the boundary, healing and join tests.

---

**Bottom line:** Rev 1.1 closes Rev 1 completely and the fixes hold at the seams. S1 and S2 are text edits of a paragraph each — an outcome table for the reconcile, and the overlay write pinned to `enqueue` with the remote-set key mapping — and the nits are sentences. With those folded in, this pre-brief can go FINAL.

## Appendix — the reviewer's probe `x1` (run at `3a689eb4`)

Tests P25's claim that no interpolation action is known to reject today, on the one path I thought might: a `done` flow that runs over the step budget. Result: the `done` flow is enqueued, not run inside the action, so the budget throw is synchronous on the next tick and the adapter disposes `over-budget` as today; no unhandled rejection.

```text
$ timeout 30 node x1-done-flow-rejection.mjs
after the done tick: disposed=false reason=null steps=0 unhandled=[]
last translation write: [10,0,0]
next tick: disposed=true reason=over-budget steps=10001
```

```js
// x1 — onStart → pointer/interpolate (1 s); done → flow/for 0..20000 → flow/sequence
import { createBehaviorEngine, graph, lit, to, T, openWorld } from './devtasks/spike-4d/g.mjs'
const unhandled = []
process.on('unhandledRejection', (e) => unhandled.push(String(e?.message ?? e)))
const g = graph([
  { op: 'event/onStart', flows: { out: to(1) } },
  { op: 'pointer/interpolate', configuration: { pointer: { value: ['/nodes/0/translation'] }, type: { value: [T.float3] } },
    values: { value: lit(T.float3, [10, 0, 0]), duration: lit(T.float, 1), p1: { type: 6, value: [0, 0] }, p2: { type: 6, value: [1, 1] } },
    flows: { done: to(2) } },
  { op: 'flow/for', configuration: { initialIndex: { value: [0] } }, values: { startIndex: lit(T.int, 0), endIndex: lit(T.int, 20000) }, flows: { loopBody: to(3) } },
  { op: 'flow/sequence' },
]); g.types.push({ signature: 'float2' })
const world = openWorld(1); world.state.fields.set('0:translation', [0, 0, 0])
const e = createBehaviorEngine({ graph: g, nodeMap: world.state.ids, world, setTimeout: () => 0, clearTimeout: () => {} })
let now = 0; Object.defineProperty(e.engine, 'lastTickTime', { get: () => now, configurable: true })
now = 0; e.tick(); now = 500; e.tick(); now = 1000; e.tick()
await new Promise((r) => setTimeout(r, 50))
console.log(`after the done tick: disposed=${e.disposed} reason=${e.reason ?? null} steps=${e.steps} unhandled=${JSON.stringify(unhandled)}`)
console.log(`last translation write: ${JSON.stringify([...world.state.fields.get('0:translation')])}`)
now = 1016; e.tick()
console.log(`next tick: disposed=${e.disposed} reason=${e.reason ?? null} steps=${e.steps}`)
```
