# Revision: models-by-url, round 6 (after the operator's outside code review of `ee8d39f5`)

Status: **for the operator, 2026-10-20.** Five must-fixes and four should-fixes from the outside review (NO-GO). No new decision; this round carries out A1–A5 and A9 as written.
- **Reviewed SHA:** `ee8d39f5e9e858bfde9f9b5cb0318f0de045c3f2` (round 5, GLM APPROVE; Claude's browser checks all passed).
- **How the findings were confirmed:**
  - The outside reviewer ran M4, M5, S1, S3 and S5 against the committed modules, and found the rest by reading.
  - Claude confirmed M1 in headless Chromium: a `.glb` whose JSON declares `images[0].uri = "/models/probe.png"` made the page fetch `probe.png` itself, with a `Referer` header, outside `fetchModel`, its budget and its preflight. Check reported "Loaded".
  - Claude confirmed M2 and S5 in the code: `readBody` returns `{ ok, bytes }` with no URL, and its non-streaming branch returns `ok` without checking either limit.
- **Deferred to a follow-up round (should-fix, not security):**
  - S1, aliased dependency URIs rejected;
  - S4, placeholder and instance disposal;
  - S6, Check outside the four-transfer queue, and dependency dedupe across `.gltf` files;
  - S8, a shared load's lifetime;
  - N1, a timer left running.

  The passdown carries them.

## 1. Must fix

### M1. A `.glb` can make the browser fetch anything (A2, A3, A5)
The fail-closed `LoadingManager` URL modifier is installed only for `.gltf` (`model-parse.js` ~L628–655). For a `.glb`, `GLTFLoader` follows any `uri` in its JSON chunk with its own loaders:
- outside the 25 MiB cap and the world ledger;
- outside A2's request policy (the browser test saw a `Referer`);
- outside the redirect check;
- outside A5's image checks and the texture reservation.

A hostile public world can therefore make every visitor's browser request any URL, and load textures of any size.

**Fix:**
- **Preflight (both formats):** a `.glb`'s `images[]` must each have a `bufferView` or a `data:` URI. Its `buffers[]` must be the GLB binary chunk (no `uri`) or `data:` URIs. Anything else is refused as `bad-dependency` before parsing. A `.gltf` keeps A3.
- **Loader (both formats):** one URL modifier for every parse that passes only `data:` and `blob:` URLs. `blob:` URLs are page-local, and both this code and GLTFLoader create them for embedded images. Anything else fails the load with `unexpected-request`, and the modifier returns an empty `blob:` URL, so nothing reaches the network. GLTFLoader must be given that manager for `.glb` too.
- **Tests:** a GLB with an external image URI and one with an external buffer URI are refused before any loader call. The modifier refuses an `https:` URL and a root-relative path, and passes `data:` and `blob:`. A GLB with embedded images still parses.
- **Claude reruns the browser probe:** no request for `probe.png`.

### M2. A redirected `.gltf` resolves its dependencies against the wrong URL (A3)
`fetchOne` checks `response.url` after a redirect, but `readBody` returns no URL. So `first.url` is always undefined, and `effectiveUrl` falls back to the pre-redirect URL (`model-fetch.js` ~L364, L373, L395).

**Fix:** `fetchOne` returns the validated final `response.url` with the bytes, and `fetchModel` uses it as `effectiveUrl` everywhere.

**Tests:**
- A root-relative `/models/a.gltf` redirected on the same origin to `/lib/chair/model.gltf` resolves `textures/d.png` to `/lib/chair/textures/d.png`.
- An absolute `https` redirect does the same, across origins.
- The cache alias (W3) uses the final URL.

### M3. The 30 s limit doesn't span the job (A3 step 7)
The fetcher's timer stops when `fetchModel` returns. `parseTemplate` then starts its own 30 s (`model-parse.js` ~L605–610). So one model can take about 60 s of its own work.

**Fix:**
- **One deadline per job,** set at its first request. Its remaining time passes into the fetch, the preflight and the parse.
- **Waiting doesn't count.** Time spent waiting for earlier models' admission (W5) or for the serialized parse queue is excluded: those waits are bounded because each earlier job has its own deadline. Each stage checks the deadline before it starts.
- **A parse past its deadline can't be stopped.** Mark the job `timeout` at once. When the parse settles later, dispose its result and release its reservation per M4.

**Tests:** a slow fetch plus a slow parse that together exceed 30 s time out. A job that waited 20 s in the queue still gets its full 30 s of work.

### M4. A parse that finishes after a world reset corrupts the next world's budget (A9)
`resetWorld()` resets the one budget object in place. A parse from the old world that finishes later calls `releaseTexture(textureBytes)` on that same object, lowering the new world's total. Its template is never disposed. The reviewer reproduced it: old reservation 64, new world 100, after the late parse 36, and no dispose.

**Fix:**
- Each world generation has **its own budget object**, and every reservation and release captures the budget of the generation it started in.
- A result that finishes after its generation ended releases against that old budget (a no-op for the new world) and **disposes its template once**.

**Test:** reset during a parse, reserve in the new world, then let the old parse finish. The new world's `taken` is unchanged, and the old template is disposed exactly once.

### M5. The image preflight accepts truncated headers (A5)
`imageHeader` checks for at least 16 bytes, then reads fields beyond them (`model-parse.js` ~L70–116). A truncated PNG was accepted as 0 × 0 and charged nothing; a truncated WebP `VP8X` as 1 × 1. Declared images that yield no bytes can also drop out of the preflight list.

**Fix:**
- For each format, check every field's offset is in range before reading it:
  - **PNG:** the IHDR chunk with length 13.
  - **JPEG:** walk the segments with length checks to a SOF marker.
  - **WebP:** `VP8 `, `VP8L` and `VP8X` with their own minimum lengths.
- Refuse a zero width or height as `unsupported-image`.
- **Every declared image must yield bytes that pass,** or the model is refused. None is silently skipped.

**Tests:** truncated fixtures at every field boundary of each format; a declared image with no bytes is refused.

## 2. Should fix in this round (small, and on the same paths)

- **S2. Validate dependencies with A1 itself.** A root-relative model's dependencies are checked only for the same origin (`model-fetch.js` ~L282–288). Apply `modelUrlProblem` to every non-`data:` resolved dependency, then the same-origin rule. **Test:** a dependency with `user:pw@` in its URL is refused.
- **S3. A late Check result must not land on a different URL.**
  - The Check uses a generation number. Editing the URL, Cancel, closing the form and a world change all end it.
  - A late result is ignored, and any template reference it took is released (`model-form.js` ~L184–242, `app.js` ~L2717–2740).
  - **Test** (the reviewer's sequence): check `old.glb`, change to `new.glb`, then the old result arrives. Save stays disabled, and no reference is held.
- **S5. The non-streaming body path must apply the limits.** After `arrayBuffer()`, apply the 25 MiB cap and the world ledger, and check the abort signal, before returning success (`model-fetch.js` ~L155–162). **Test:** a 26 MiB non-streaming response is refused as `too-large`.
- **S7. An invalid model node shows its reason.** A node that declares a model the spec rejects gets a failed placeholder with `bad-spec`, and nothing is fetched, as A6 says. A node with no model is still skipped (`model-bridge.js` ~L586–640). **Test:** a node with `extras.atrium.model = { url: 'http://x' }` gets the `bad-spec` placeholder.

## 3. Steps (one commit each, on `workflow/models-by-url` from `ee8d39f5`)
1. M1
2. M2
3. M3
4. M4
5. M5
6. S2 and S5 (the fetcher)
7. S3 (the Check)
8. S7
9. Full suites as before, then the proofs, then the handoff.

**This is the largest revision so far.** With 300 calls it may need a continuation: commit at every step, and use the continuation rule.

## 4. Proofs (each caught by a named test; restore from a saved copy, never `git checkout`)
- (p1) install the URL modifier for `.gltf` only again;
- (p2) let a `.glb`'s external image `uri` pass preflight;
- (p3) drop the final URL from `fetchOne` again;
- (p4) restart the timer for the parse;
- (p5) release a stale parse against the current budget;
- (p6) read a PNG width without the length check;
- (p7) the non-streaming path returns without the limit check;
- (p8) apply a late Check result after a URL edit.

## 5. Notes
- **The reviewer's "REVISION files not found"** happened because they live on `main`, not on the workflow branch. That's expected.
- **Claude's browser checks for this round add three things** to the scripted set, the five-model run and the seven-model order run:
  - the external-image GLB (no request may escape);
  - a truncated-PNG GLB;
  - a world reset while a model parses.
- The front door builds the release chain as in round 5. Rounds 2–5 notes hold.
- **Then a final outside review**, scoped to M1–M5 and the four should-fixes, before DEV acceptance.
