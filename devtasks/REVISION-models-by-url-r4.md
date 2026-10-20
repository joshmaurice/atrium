# Revision: models-by-url, round 4 (after Claude's browser checks of `d1db9ad1`)

Status: **for the operator, 2026-10-20.** Two must-fixes in the texture budget's bookkeeping. No new decision.
- **Checked SHA:** `d1db9ad1a6fbbb1a64919a82088935dbe1a6d713` (round 3).
- **Round 3 works as specified:** the scripted checks pass 30/30, and the SOM inspector and playground load. A visitor's budget is now charged (W1), and `data:` and buffer-view images are checked (W2).
- **Remaining gap:** the budget can still be exceeded. Placing five real CC0 models (AnimatedMorphCube, Avocado, BoomBox, Lantern, WaterBottle; textured estimates 64 + 85.3 × 3 MiB) loads all five. The 256 MiB limit should refuse the last textured one.
- **Scope:** `packages/renderer-three/src/model-parse.js` (the template cache), `packages/renderer-three/src/model-bridge.js`, the Check path in `apps/client/src/app.js`, and their tests.

## W3. Eviction removes templates that are in use (must fix)

**Seen** (visitor page, every `reserve` and `release` on `modelBridge.textureBudget` traced):
```
reserve 64   → 64      (Avocado)
reserve 85.3 → 149.3   (BoomBox)
reserve 85.3 → 234.7   (Lantern)
release 85.3 → 149.3   ← "evicted" BoomBox or Lantern, whose instance is on screen
reserve 85.3 → 234.7   (WaterBottle)
```
All five models stay rendered with their textures. three.js re-uploads a disposed texture on its next use, so the GPU holds about 320 MiB while the books say 234.7.

**Cause:**
- `cache.set` creates an entry with `refs: 0, idle: true`.
- The bridge acquires it only after `templateFor` resolves (`model-bridge.js` ~L261), on a later microtask.
- The serialized parse chain starts the next model's parse, and its `reserveTexture` → `evictIdleFor`, before that acquire. So `evictIdleFor`, which trusts `idle`, evicts and disposes an entry that is about to be, or already is, in use.
- Separately, on a redirect (~L250), the bridge stores the same template a second time under the effective URL's key, as a **separate entry with the same `textureBytes`**. Evicting both would release its bytes twice and dispose one template twice.

**Fix:**
- An entry created for a load is created **already acquired by that load** (`refs: 1`, not idle), inside the serialized parse. The load then doesn't acquire it again.
- `evictIdleFor` skips any entry with `refs > 0`, and never disposes one (defence in depth).
- A redirect's second key is an **alias** of the same entry: one entry, one byte count, one dispose.

**Tests** (Node; inject `loader` and a counting budget):
- Budget sized for three textured models, four distinct models requested back to back: the fourth is refused `world-texture-budget`, `taken` never exceeds the limit, and no entry with `refs > 0` is ever disposed.
- The same with the fourth's request issued before the third's load has continued past its parse (the race above).
- A redirect alias: `taken` counts the bytes once; removing the last instance and evicting releases them once.

## W4. The owner's Check bypasses the budget and the parse queue (must fix)

**Seen:** on the owner's page, `textureBudget.taken` stays at **0.0 MiB** through all five Check-then-Save cycles.

**Cause:**
- The Check path in `app.js` (~L2742) calls `parseTemplate` itself, without `reserveTexture` or `releaseTexture`, and outside the bridge's serialized parse.
- `holdCheckedTemplate` then puts the result in the cache with its `textureBytes`.
- So Save adopts an entry that was never charged. `releaseHeldCheck` releases bytes that were never reserved, which `release` clamps at 0, hiding it.

**Fix:**
- Give the bridge one entry point for loading a template by URL, for example `bridge.loadTemplate({ url, sha256 })`. It does the cache and in-flight lookup, the fetch, the serialized parse with reservation, and returns an acquired entry. The Check path uses it and holds that reference; `app.js` no longer calls `fetchModel` or `parseTemplate` for Check.
- Cancel, a URL edit, closing the form or a world change release the reference: the template goes idle and is kept, per A8.
- Save hands the reference over to the new node's instance, so it's counted once.
- A Check whose model doesn't fit shows `world-texture-budget` in the form, and Save stays disabled.

**Tests:**
- Check reserves the model's estimate.
- Check, then Cancel, leaves the template idle and still counted.
- Check, then Save, counts once (`taken` unchanged by Save), with 0 new fetches (round 2's V4 test still holds).
- A Check that doesn't fit is refused, and nothing is held.
- The form test suite still passes, with the bridge stubbed where it was.

## Steps (one commit each, on `workflow/models-by-url` from `d1db9ad1`)
1. W3, with its tests.
2. W4, with its tests.
3. Full suites as in rounds 1–3, then the proofs, then the handoff.

## Proofs (each caught by a named test; restore from a saved copy, never `git checkout`)
- (v) `evictIdleFor` ignores `refs` again;
- (w) the redirect key stored as a separate entry again;
- (x) the Check path parses without reserving again.

## Notes
- Claude reruns the five-model run on owner and visitor pages. Expected:
  - `taken` ≤ 256 MiB on both pages;
  - exactly one textured model refused `world-texture-budget` (WaterBottle, last in document order), shown as a placeholder with the reason;
  - the owner's Check for it refused in the form.
- **For the operator, not this round:** at 256 MiB, three typical 2048-px PBR models fill a world. The 1k-texture starter library (3b) fits about twelve. If that's too tight, it's a one-constant change (`MODEL_PARSE_LIMITS.worldTextureBytes`). Decide after DEV.
- Round 2's and 3's notes hold: 300 calls; the reviewer reproduces every proof; and if the review gate's `kanban_create` fails, the front door creates the release chain.
