# The 4b engine spike (step 4 pre-brief D2)

Throwaway probes that tested `@khronosgroup/gltf-interactivity-engine` 1.1.0
against D2's four pass criteria, run by Claude on 2026-10-23. The results
are in `RESULTS.md` and summarized in `devtasks/PREBRIEF-scripting-4b.md`
§2.2. **This is test tooling, not product code:** nothing here is imported
by Atrium, and 4b-2 writes its own adapter.

## Set-up (about a minute)
Work outside the repo, so nothing lands in the workspace's `node_modules`:
```bash
W=/tmp/spike-4b && mkdir -p $W && cd $W
npm init -y >/dev/null
npm install --ignore-scripts @khronosgroup/gltf-interactivity-engine@1.1.0 gl-matrix@3
cp <repo>/devtasks/spike-4b/*.mjs .
# Khronos's test assets (281 MB; only t4 and t5 need them):
git clone --depth 1 https://github.com/KhronosGroup/glTF-Test-Assets-Interactivity.git assets
```
The spike used assets commit `926bec45`.

## Running
Each probe prints what it saw. Run them under `timeout`: `t1b` hangs on
purpose.
```bash
timeout 20  node t0.mjs                                   # pointer/set through the adapter
timeout 60  node t1.mjs                                   # S1: step budget on loops with a body, a flow cycle, onTick
timeout 10  node t1b.mjs; echo "exit=$? (124 = hung: expected)"   # S1: while(true) with no body
timeout 30  node t1c.mjs                                  # S1: budgeted flow/while and flow/for subclasses
timeout 30  node t2.mjs                                   # S2: dispose, reload, interpolation, many delays
timeout 30  node t3.mjs                                   # S3: pointer authorization
timeout 120 node t4.mjs  assets/Tests/Interactivity       # S4: the 187 invalid graphs
timeout 120 node t5.mjs  assets/Tests/Interactivity       # S5: the 156 conformance assets
# Added for the 4b-2 pre-brief (2026-10-24):
timeout 30  node t6.mjs                                   # onSelect, event/receive, animation/*, the delayed self-loop, a sync cycle (loader only)
timeout 60  node r1.mjs                                   # the VALIDATOR probe (review of Rev 0.1): the five templates, spellings, loops, empty arrays
timeout 30  node r2.mjs                                   # the RUNTIME probe: every pointer-template spelling resolves once loaded
```
**The lesson of `r1`:** `validateInteractivityGraph` (what the server runs) is
far stricter than `loadBehaveGraph` (what `t0`–`t6` call). `[n]` is the int
index socket and `{n}` a `ref` socket; flows must point to a later node;
`variables`/`events` can't be empty arrays; `event/onSelect` needs its
`extension`. See `devtasks/PREBRIEF-scripting-4b-2.md` §2.3.

## Files
- **`host.mjs`:** the spike's host:
  - `NodeEventBus` (an `IEventBus` on `EventTarget`; the engine's own
    `DOMEventBus` needs `document`);
  - `SpikeDecorator`, an `ADecorator` over a tiny world, with an `allowed(i)`
    authority check and a per-tick step budget;
  - `makeEngine`.

  Note the line that sets `engine.processNodeStarted`:
  `bridgeEngineHooks()` doesn't carry that hook over.
- **`g.mjs`:** a small graph builder (`graph`, `lit`, `to`, the type table).
- **`t0`–`t5`:** the probes, as listed above.
- **`t6`:** the 4b-2 pre-brief's event-source probe (2026-10-24).
- **`r1`, `r2`:** the outside review's probes (`devtasks/REVIEW-scripting-4b-2-rev0.1.md`).
- **`RESULTS.md`:** what each probe printed, in short.
