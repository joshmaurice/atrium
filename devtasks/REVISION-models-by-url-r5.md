# Revision: models-by-url, round 5 (after Claude's browser checks of `a1847bb3`)

Status: **for the operator, 2026-10-20.**
- **Decision L20, made by the operator on 2026-10-20 (~08:54 PT): raise the world texture budget from 256 MiB to 512 MiB.** One must-fix (W5, A10's order) and that decision (W6).
- **Checked SHA:** `a1847bb374053d69cae5697ed8b2e7eb290c342f` (round 4, GLM APPROVE).
- **Round 4 works as specified for the budget's bookkeeping:**
  - Scripted checks: 30/30, and the SOM inspector and playground load.
  - The owner's Check charges the budget, and WaterBottle's Check is refused "this world has loaded its limit of textures".
  - The budget never exceeds its limit, and no template in use is evicted.
  - Deleting a model leaves its template idle and counted, and a later model evicts it.
  - A mid-load disconnect is clean.
- **Scope:** `packages/renderer-three/src/model-bridge.js`, `packages/renderer-three/src/model-parse.js` (the constant), and their tests.

## W5. Texture admission isn't in document order (must fix; A10)

**Seen:** four textured models were added to one world through the server, in this order: Avocado (64 MiB), BoomBox, Lantern, WaterBottle (85.3 MiB each). Only three fit in 256 MiB.

| Page | Refused `world-texture-budget` |
|---|---|
| Owner (models arrive one by one) | WaterBottle, the last in document order. Correct. |
| Visitor (all four load at once) | **BoomBox**, the second. Wrong. |

The visitor's parses ran in the order the downloads finished. BoomBox (10.6 MB) finished after WaterBottle (8.9 MB), so WaterBottle took the last space.

A10 says texture-budget admission happens in `som.allNodes` order: "a model is admitted only once every earlier model has been admitted or has failed (bounded by their own 30 s timeouts). So the same models win on every visitor's screen." The bridge admits in parse-completion order instead. No test covers it.

**Fix:**
- Fetches still run in parallel (A4's four transfers).
- A model node's **reservation** (the start of its serialized parse) waits until every model node **before it in the current `som.allNodes` order** has been admitted, has failed, or has been dropped (removed, or its world reset).
  - The wait is bounded by those models' own 30 s jobs, which end in a status either way.
  - A node added live is after every existing node.
  - Removing a node releases anything waiting on it.
- Templates already in the cache don't reserve again (W1/W3 unchanged), so a later instance of an admitted template is never blocked.
- The owner's Check (W4's `loadTemplate`) isn't a node. It goes after every model node that is loading.

**Tests (Node; a stub fetch whose responses complete in a controlled order, a stub loader, a counting budget sized for three):**
- Four nodes A, B, C, D in document order, downloads finishing D, C, B, A: A, B and C are admitted, D is refused. The same with downloads finishing A, B, C, D.
- B's download fails: A, C and D are admitted, if they fit.
- B is removed while A is still loading: C doesn't wait on B.
- A model added live after the world loaded waits for the earlier ones.
- A Check issued while nodes are loading reserves after them.

## W6. World texture budget: 512 MiB (decision L20)

- `MODEL_PARSE_LIMITS.worldTextureBytes` goes from `256 * 1024 * 1024` to `512 * 1024 * 1024` (`model-parse.js` ~L27).
- Every test that assumes 256 MiB is updated to read the constant rather than a literal, where it can.
- `PREBRIEF-models-by-url.md`'s L8 table and A5 say 256 MiB; this revision supersedes them. The passdown records the change.
- For scale (estimate w × h × 4 × 4⁄3): a world now fits about six typical 2048-px PBR models (four 2k textures each), or about twenty-four of the 1k-texture library items planned for 3b.

## Steps (one commit each, on `workflow/models-by-url` from `a1847bb3`)
1. W5, with its tests.
2. W6, with its test updates.
3. Full suites as in rounds 1–4 (every server file on its own under `timeout 180`, no force-exit, plus client, renderer-three, interaction and apps/client), then the proofs, then the handoff.

## Proofs (each caught by a named test; restore from a saved copy, never `git checkout`)
- (y) admit in arrival order again (drop the wait on earlier nodes);
- (z) the budget back at `256 * 1024 * 1024`. A W6 test asserts the 512 MiB limit and that six 85.3 MiB models fit and a seventh is refused.

## Notes
- Claude reruns the browser checks:
  - the scripted set;
  - an over-budget world where owner and visitor refuse the same model (seven 85.3 MiB models: the seventh in document order, on both pages);
  - the five-model run, where all five now fit.
- **The release chain:** creates from orchestrator and worker sessions are still losing `body`, `parents` and `max_runtime_seconds`. So **the front door builds the release chain from the templates** (publish, DEV deploy, DEV finalizer, the blocked acceptance gate) once GLM approves, rather than the review gate trying first. The review gate's job this round is only to check the verdict and report the SHA.
- Round 2–4 notes hold:
  - 300 calls;
  - the reviewer reproduces every proof;
  - the SHA goes in the summary and the metadata (the gate may take it from the summary).
