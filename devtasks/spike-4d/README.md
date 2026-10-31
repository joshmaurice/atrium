# The 4d probes (`PREBRIEF-scripting-4d.md` §2.5)

Throwaway probes run by Claude on 2026-10-30 for the 4d pre-brief. **Test
tooling, not product code:** nothing here is imported by Atrium. Unlike
`spike-4b`, these run **inside the repo**, against the workspace's real
adapter (`packages/behaviors/src/adapter.js`), its test fake world
(`packages/behaviors/tests/fake-world.mjs`) and the vendored engine
(`packages/gltf-interactivity-engine/`), so they measure what Atrium runs
today. `g.mjs` holds the shared imports.

## Running
From the repo root, after `pnpm install`:
```bash
timeout 60  node devtasks/spike-4d/p1.mjs    # the clock: lastTickTime shadowed on the instance
timeout 120 node devtasks/spike-4d/p2.mjs    # step cost in Node
timeout 120 node devtasks/spike-4d/p2-page.mjs   # step cost in Chromium (Playwright, import map)
timeout 60  node devtasks/spike-4d/p3.mjs    # the registry gate: deleted ops become NoOpNodes
timeout 30  node devtasks/spike-4d/p3b.mjs   # where a no-op'd value op throws (the first tick)
timeout 60  node devtasks/spike-4d/p4.mjs    # {ref} and wired [i] pointers, in and out of nodeMap
timeout 60  node devtasks/spike-4d/p5.mjs    # the engine's delay table never shrinks
KHRONOS_ASSETS=<assets>/Tests/Interactivity timeout 300 node devtasks/spike-4d/p6.mjs   # the conformance subset
timeout 60  node devtasks/spike-4d/p7.mjs    # loops through event/send
```
`p6` needs `glTF-Test-Assets-Interactivity` at `926bec45` (281 MB):
```bash
git init assets && cd assets && git remote add origin https://github.com/KhronosGroup/glTF-Test-Assets-Interactivity
git fetch --depth 1 origin 926bec45dfbe052bad4013ab5852ed2f4042bff5 && git checkout FETCH_HEAD
```

## Results (2026-10-30, Node 22.23.4, Chromium 153)
| Probe | Result |
|---|---|
| `p1` | onTick `timeSinceStart` 0, 0.5, 1.5, 3 at fake 1,000/1,500/2,500/4,000 ms; interpolate x 0, 2.5, 5, 10 at 0/250/500/1,000 ms; a 1 s throttle passes 0, 1,000, 2,050 ms only |
| `p2` | Node 0.28–0.36 µs per node start; Chromium 0.18–0.34 µs (7,504 and 5,604 steps a tick) |
| `p3` | keep-by-allowlist: 138 registry keys → the kept set; a deleted `flow/sequence` stops its flow; a deleted `math/add` or `math/combine3` read by a running node throws |
| `p3b` | that throw comes at the first tick, not at load |
| `p4` | `{r}` `"/nodes/1"`: set, get, interpolate node 1; `"/nodes/9"` and wired `[i] = 9`: `err` / `isValid: false`, no write; wired `[i] = 1`: writes |
| `p5` | 10,000 slots after 10,000 delays, all still there once fired; `dispose` empties it |
| `p6` | 156 indexed, 143 in the subset: 134 pass, 8 fail, `math/random` disposed `over-budget` (same in two runs) |
| `p7` | send → receive loop: 2 steps a tick for 30 ticks; doubling fan-out: 2 … 8,192, disposed on tick 14 |
