# Revision: models-by-url, round 3 (after Claude's browser checks of `83ee8afe`)

Status: **for the operator, 2026-10-20.** One must-fix and one spec gap. No new decision.
- **Checked SHA:** `83ee8afe170b487460622da82bd83c8754eebac5` (round 2, GLM APPROVE, deploying to DEV).
- **Round 2 itself passes:** the scripted browser checks pass 30/30, the SOM inspector and playground load, and V1–V5 are confirmed fixed. Five real CC0 Khronos models (AnimatedMorphCube, Avocado, BoomBox, Lantern, WaterBottle) Check, Save and render with textures for the owner and for a visitor. A disconnect in the middle of a 27.6 MB download leaves no page error.
- **Scope:** `packages/renderer-three/src/model-parse.js` and its tests only. No other file needs to change.

## W1. The world texture budget is never charged (must fix)

**Seen:** placing AnimatedMorphCube, Avocado, BoomBox, Lantern and WaterBottle in one world, through Check and Save, then opening it as a visitor. A debug hook in a scratch copy read `modelBridge.textureBudget.taken`, and it stayed **0.0 MiB** on both pages. All five models loaded. By A5's estimate (w × h × 4 × 4⁄3), the four textured ones need 64 + 85.3 + 85.3 + 85.3 ≈ 320 MiB against the 256 MiB budget, so the last one should have been refused `world-texture-budget`.

**Cause:** `preflightFor` (~L564) returns `{ problem: preflightProblem(...) }` in both branches. On success, `preflightProblem` returns `{ reason: null, message: null, textureBytes }`, so the byte count lands at `preflight.problem.textureBytes`. `parseTemplate` (~L483–493) reads `preflight.textureBytes`, which is `undefined`, so it reserves nothing. Refusals are unaffected, because they carry a `reason`, which is why every preflight refusal test passes.

**Why it matters:** this is the A5/M8 limit on what a hostile public world can make every visitor's GPU hold. PNG compresses blank images enormously (a 4096² texture can be tens of KB), so the 150 MiB download ledger alone doesn't bound decoded texture memory.

**Fix:** `preflightFor` returns `{ problem: null, textureBytes }` on success and `{ problem }` on failure, in both branches.

**Tests** (Node, no image decoding; inject `loader` with a stub whose `parseAsync` resolves a minimal gltf):
- `parseTemplate` on a GLB whose buffer view holds a PNG header-only image of 2048 × 2048 calls `reserveTexture` once, with `estimateTextureBytes(2048, 2048)`.
- With a budget of 1 byte, it returns `world-texture-budget`.
- At bridge level, with a counting budget: two such models fit a budget sized for two, and a third distinct one is refused `world-texture-budget`. The same URL placed twice reserves once.

## W2. Images embedded as `data:` URIs aren't checked (spec gap, fix in the same round)

A5 lists images "from the GLB's buffer views or from A3's fetched bytes". It omits a `.gltf`'s `data:` image URIs, and `preflightFor` skips them. Such an image's bytes count toward the download, but its **format and dimensions are never checked and its texture memory is never reserved**.

**Fix:**
- For each `images[].uri` starting with `data:`, decode the base64 payload (only `;base64,` forms; anything else is `unsupported-image`).
- Pass it to `preflightProblem` with the other images.
- An `images[]` entry with a `bufferView` in a `.gltf` is read from the buffer bytes, the same way the GLB branch does it.

**Test:** a `.gltf` with a `data:image/png;base64,…` image whose header says 8192 × 8192 is refused `texture-too-large` before parsing.

## Steps (one commit each, on `workflow/models-by-url` from `83ee8afe`)
1. W1, with its tests.
2. W2, with its test.
3. Full suites as in rounds 1–2 (every server file on its own under `timeout 180`, no force-exit, plus client, renderer-three, interaction and apps/client), then the proofs, then the handoff.

## Proofs (each caught by a named test; restore from a saved copy, never `git checkout`)
- (t) restore `return { problem: preflightProblem(glb.json, images) }` in the GLB branch;
- (u) skip `data:` images again.

## Notes
- Round 2's lessons hold:
  - the worker has 300 calls;
  - the reviewer reproduces every proof itself and puts the SHA in the summary and the metadata.
- **If the review gate's `kanban_create` fails again, the front door creates the release chain.** In round 2, the gate's calls failed before reaching the guard (no `block` in `atrium-kanban-guard.log`), and the gate misreported them as guard refusals.
- Claude reruns the browser checks, including the five-model budget run, on the new SHA before acceptance.
