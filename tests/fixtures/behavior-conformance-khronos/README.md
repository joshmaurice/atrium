# The Khronos conformance subset (4d)

The graphs of the Khronos interactivity conformance assets that fit Phase 3
step 4d's op allowlist and size limits (`devtasks/PREBRIEF-scripting-4d.md`
G-L2 (a), G7 and G8), checked in so the conformance run happens on every
build, not only where `KHRONOS_ASSETS` points at a checkout.

- **Source:** `KhronosGroup/glTF-Test-Assets-Interactivity` at
  `926bec45dfbe052bad4013ab5852ed2f4042bff5`, the 156 assets of its
  `test-index.json` and `mathtests-index.json`; **143** fit.
- **Licence:** CC-BY-4.0 (`LICENSE-CC-BY-4.0.txt`, copied from the assets'
  `LICENSES/`). Each graph is extracted unchanged from the asset's
  glTF-Binary JSON chunk.
- **Each file** in `graphs/` is `{ asset, graph, nodes }`: the
  `KHR_interactivity` graph and the asset's nodes (name, translation,
  rotation, scale, children, `KHR_node_visibility`), which the run's fake
  world is seeded from.
- **`manifest.json`** lists every file with its sha256 and its **`p6`
  baseline result**: today's adapter with only the op filter widened, run in
  real time (`devtasks/spike-4d/p6.mjs`). **134 pass, 8 fail, 1 disposed**
  (`math:math/random`, `over-budget`). The round regenerates the results with
  its own adapter; a fail that becomes a pass needs its reason in the
  handoff, and a pass that becomes a fail is a finding.
- **Regenerate** (Claude's tooling, not the round's):
  ```bash
  KHRONOS_ASSETS=<assets>/Tests/Interactivity P6_JSON=/tmp/p6.json node devtasks/spike-4d/p6.mjs
  KHRONOS_ASSETS=<assets>/Tests/Interactivity node devtasks/spike-4d/khronos-extract.mjs /tmp/p6.json
  ```
