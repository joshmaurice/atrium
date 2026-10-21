# Revision: models-hardening, round 2 (after Claude's checks and the outside code review of `a6b93610`)

Status: **for the operator, 2026-10-21.** Three must-fixes, all in this round's shared dependency downloads, all regressions: R1, R7 and R8. Four test weaknesses, where the code is correct but the tests can't catch a regression. One should-fix (R9) and four nits (R10). No decision changes: L1a–L6a stand, and the contract is §4 of `PREBRIEF-models-hardening.md` (Rev 3) as amended here.
- **Two independent sources:**
  - Claude's proof re-runs and browser checks;
  - the outside code review of `a6b93610`: **NO-GO**, M1–M3, S1–S2, nits.

  They agree on R1, the weak tests and p2. The outside review found R7, R8 and R9. Each finding below says where it came from.
- **Reviewed SHA:** `a6b93610512b57bae1cf18dd23a817f7cd42d38e` (implementation `t_3d23e0ea`; GLM APPROVE `t_6f8c33b2`). It is on DEV now, healthy.
- **Base for this revision:** that SHA, on `workflow/models-hardening`.
- **How the findings were made:**
  - each proof was re-run in a clean worktree at `a6b93610`, with throwaway probes in Node;
  - the §5.1 browser checks ran in headless Chromium against the real client page, over https, with a local world server and a model server that counts and delays requests.

  Nothing was committed.

## 1. Must fix

### R1. A stalled dependency download never times out, and it freezes every model after it (regression)
**What happens.** Every `.gltf` dependency goes through `depend` (`model-fetch.js` ~L732–760), because the bridge always passes `sharedTransfers`. On that path nothing enforces the job's deadline:
- `request()`'s timer (`armTimer`, ~L618) only covers the model's own file and is cleared when that request ends;
- `runTransfer` (~L688) has no timer, by design (§4 Z3: "a shared transfer has no timer of its own");
- but the other half of that design, "each consumer's deadline makes that consumer leave the transfer when it reaches zero", was never built.

So a dependency whose host sends headers and then stalls keeps the job waiting forever. At `3a71e855` (released), one timer covered the whole `fetchModel`, so this is new in this round.

**Reproduced:**
- **Node, the real `fetchModel` with stub fetches:**
  - a `.gltf` whose one buffer stalls, deadline 300 ms: without `sharedTransfers` it returns `timeout` after 306 ms; with `sharedTransfers` it was still running after 3 s;
  - four such models under one limiter: after 2 s all **4 of 4 slots were still held**, and a fifth request never got one.
- **Browser, the real client page:**
  - a model whose texture stalls, then a small unrelated `.glb` placed after it;
  - after **40 s both were still `loading`**. The stalled one should fail `timeout` at 30 s. The second waits for it because admission is in document order (W5).

  So one stalled texture in a public world freezes every later model, for every visitor, until a world change.

**Why the tests missed it.** §5's Z3 row asks for this exact test: "job Y with 1 s left starts a transfer, job X joins fresh, Y times out → X completes". It wasn't written.

The outside review found the same thing independently (its M1). It reproduced it at fetch and bridge level, with the same scenario ending `failed/timeout` at the base `d328a1d`.

**Fix** (in `model-fetch.js`, `depend` and `runTransfer`, together with R8's one bag per task):
1. **Each consumer enforces its own deadline while it waits on a shared transfer.** From the moment the transfer has its limiter slot, the consumer arms a timer for `deadline.remainingMs()`. When it fires, that consumer aborts its own controller with the `TIMEOUT` reason, so `depend` returns `timeout` and the consumer leaves. The transfer goes on for the others, and it is aborted when its last consumer leaves (L3a, already implemented). The timer is cleared when the consumer settles in any way.
2. **The wait for a slot is waiting for every consumer, not just the starter.** Today `runTransfer` pauses and resumes only the deadline of the job that started the transfer (the closure's `deadline`). The transfer's bag (one per task, R8) carries a `granted` promise, resolved when the transfer gets its slot. Each consumer pauses its own deadline from joining until `granted`, then resumes it and arms its timer. A consumer that joins a transfer already running does this at once. The outside review reproduced the current fault: after 20 s in the queue, the starter's clock showed 0 ms and the joiner's 20,000 ms.
3. **The slot is released when the transfer ends for any reason.** `runTransfer`'s `finally` already does this; a test pins it.
4. **The consumer's timeout must come back as `timeout`, not as `aborted`.** The shared-tasks join answers a requester whose signal aborted with a plain `{ ok: false, reason: 'aborted' }`. So item 1's abort needs R7's mapping, or the bridge would park the node invisibly.

**Tests** (each must fail on `a6b93610`):
- **(t1)** A `.gltf` whose only dependency stalls (headers, then a reader that never resolves), deadline 300 ms, real `createSharedTasks` and limiter → `timeout` within about 300 ms (allow up to 1 s), and the stalled reader's signal is aborted.
- **(t2)** Four such models under one limiter of 4 → after their deadlines the limiter's `active` is back to 0, and a fifth model's request starts and completes.
- **(t3)** §5's S1 test: job Y with 1 s left starts a shared dependency transfer that takes 3 s; job X joins with a fresh 30 s deadline → Y fails `timeout` at about 1 s, X completes, and there is one request.
- **(t4)** A consumer whose shared transfer is queued behind four busy slots for 20 s (controlled clock) is not charged that wait: `deadline.elapsedMs` stays below 1 s.
- **(t5) Bridge:** a model whose dependency stalls, then a model placed after it → the first ends `failed`/`timeout`, and the second ends `loaded`. Use a controlled clock or a short deadline through the `newDeadline` hook.

**Proof (p9):** remove the consumer's timer (item 1) → (t1), (t3) and (t5) fail. Give each test its own `node:test` timeout, so a hang shows up as a named failure and not as a stuck run.

### R7. An abort during a shared dependency download comes back as plain `aborted`, and the bridge then hides the node (outside review M2; reproduced there)
**What happens:**
1. The world's 150 MiB ledger is crossed while any `.gltf` is fetching a dependency. This can be the crossing transfer itself, or another job waiting on its own dependency.
2. The ledger aborts the job controllers.
3. The shared-tasks join resolves `{ ok: false, reason: 'aborted' }`, with no `aborted: true` flag. So `fetchModel` (~L770) skips `abortOrTimeout` and returns `reason: 'aborted'`.
4. The bridge's `load` (~L428) treats that as "nobody wants this" and calls `drop`. The node ends `loading/aborted`, with no placeholder and no model, for good.

The same scenario at the base ends `failed/world-download-budget`. R1's timeout would arrive by the same route.

**Fix:**
- In `depend`, when this consumer's own controller is aborted, return `abortOrTimeout(controller, signal)`, which names `timeout`, `world-download-budget` or `aborted`. Never return the join's bare result.
- In `runTransfer` (~L722), map an abort whose `transfer.signal.reason === 'over-budget'` to `world-download-budget`.
- **Defence in depth, in the bridge's `load`:** `drop` only when the record's own controller is aborted or `!stillWanted(record)`. Any other `aborted` from the task is a `fail` with its reason. So a task-level abort can never park a node that's still wanted.

**Tests:**
- **(t6)** Fetch-level: a dependency transfer crosses the ledger → the crossing job and a bystander job waiting on its own dependency both end `world-download-budget`.
- **(t7)** Bridge-level: the same → the node ends `failed/world-download-budget`, with a placeholder.
- **(t8)** Bridge-level: a task that reports `aborted` while its requester still wants it → the node ends `failed`, never `loading/aborted`.

**Proof (p10):** return the join's result unmapped again → (t6) and (t7) fail.

### R8. A stale byte count is charged to a model joining a shared download, so a valid model is refused `too-large` (outside review M3; reproduced there)
**What happens.** `bagFor` and `TRANSFER_BAGS` (~L794–803) keep one bag per **key**, not per task, and bags outlive their transfer. `received` is reset only when a new transfer gets its slot (~L701). The sequence:
1. Model P loads `tex.png`. The bag's `received` is now `tex.png`'s size.
2. Later, while all four slots are busy, models X and Y (two `.gltf` files that name `tex.png`) load.
3. X starts a new transfer, which queues for a slot.
4. Y joins it and is charged P's whole `tex.png` at once (~L746–747).
5. When the transfer runs, Y is charged the same bytes again, chunk by chunk.

The reviewer reproduced Y refused `too-large` with 1,054 real bytes against a 1,554-byte cap. By reading, there's a second route: a late chunk from an abandoned transfer is charged to the new task's consumers.

**Fix:** one bag per **task**, created in the task's `start` and reached through the joined task. The `received` charged to a late joiner is that task's only. Drop the key-level `TRANSFER_BAGS`.

**Test (t9):** the sequence above, with a 25 MiB cap and a 14 MiB texture → Y loads, and its budget is charged 14 MiB once. **Proof (p11):** key the bag by URL again → (t9) fails.

## 2. Should fix: tests that can't catch a regression (R2–R6), and two smaller code fixes (R9, R10)
In R2–R6 the code is correct; only the tests change. R9 and R10 change code.

### R2. p3c (Z2, delete-while-queued then Undo): the shipped test never reaches the case
`model-bridge.test.js` "a node deleted and re-added (Undo) while its parse waits still loads" holds the second node at **admission** (W5), not in the serialized parse queue. When it's removed there, its job ends at once, so even a reintroduced per-key `parses` map would be empty again before the Undo. Claude reintroduced one: the test still passes.

The outside review reached the same conclusion with the same kind of test. Because admission is in document order, two node parses never queue behind each other. A node's job can only wait in the parse queue behind a **Check's** parse. Add this test (it passes at `a6b93610` and fails with a per-key `parses` map reintroduced; Claude ran both):

```js
test('Z2/L3a: a node deleted while its parse is queued behind a Check, then re-added, still loads', async () => {
  let releaseCheck = null
  const checkGate = new Promise((resolve) => { releaseCheck = resolve })
  const h = harness({
    parseHook: async (args) => {
      if (args.bytes?.[0] === 9) await checkGate      // the Check's parse is slow
      args.reserveTexture?.(0)
      return { ok: true, template: { scene: new Group(), animations: [], textureBytes: 0 }, textureBytes: 0 }
    },
    fetchModel: async ({ url }) => ({
      ok: true, kind: 'glb', bytes: new Uint8Array([url.includes('checked') ? 9 : 1]), json: null,
      dependencies: new Map(), effectiveUrl: url, totalBytes: 1,
    }),
  })
  const checked = h.bridge.loadTemplate({ url: 'https://h/checked.glb' })   // its parse runs, gated
  await settle()
  h.addNode(somNode('X', { url: 'https://h/x.glb' }))   // admitted at once; its parse queues behind the Check's
  await settle()
  assert.equal(h.bridge.status('X').status, MODEL_STATUS.loading, 'X waits behind the Check')
  h.removeNode('X')                                      // abandoned while its parse is QUEUED
  h.addNode(somNode('X', { url: 'https://h/x.glb' }))   // Undo: same URL, a new task
  await settle()
  releaseCheck()
  await checked
  await settle(); await settle()
  assert.equal(h.bridge.status('X').status, MODEL_STATUS.loaded, `X ended ${JSON.stringify(h.bridge.status('X'))}`)
})
```
Keep the shipped test too: it covers the admission-time removal.

### R3. p4 (a Check waits for a transfer slot): no bridge test exists
§5's "a Check while four transfers run waits for a slot" wasn't written. `loadTemplate` does pass the bridge's limiter (correct by reading), but nothing pins it. With the Check given `limiter: null`, every suite passed. Add this test (passes at `a6b93610`, fails with that break):

```js
test('Z3/L4a: a Check takes its transfers through the same limiter as the model nodes', async () => {
  const seen = []
  const h = harness({
    fetchModel: async (args) => {
      seen.push({ url: args.url, limiter: args.limiter })
      return { ok: true, kind: 'glb', bytes: new Uint8Array([1]), json: null, dependencies: new Map(), effectiveUrl: args.url, totalBytes: 1 }
    },
  })
  h.addNode(somNode('A', { url: 'https://h/a.glb' }))
  await h.bridge.loadTemplate({ url: 'https://h/checked.glb' })
  await settle()
  const node = seen.find((s) => s.url.endsWith('a.glb'))
  const check = seen.find((s) => s.url.endsWith('checked.glb'))
  assert.ok(node?.limiter, 'the node passes a limiter')
  assert.equal(check?.limiter, node.limiter, 'the Check passes the SAME limiter')
})
```
A behavioural version is wanted **in addition**, not instead: a real limiter of 4, four gated transfers running, the Check queued until a slot frees, and parsing models holding 0 slots. The outside review wrote one that passes on `a6b93610` and fails under the break.

### R4. p5b (no clock while queued for a slot): the shipped test can't fail (both reviews)
In `model-shared-transfers.test.js`, "the job's clock stops while it waits for a limiter slot" advances the clock 20 s past a 15 s deadline during the queue wait. It then only checks `result.ok`. The stub fetch resolves before the 0 ms re-armed timer can fire, so the job succeeds even when the wait is charged. Add one assertion at the end (passes at `a6b93610`; with the pause and resume around `limiter.acquire` removed, it fails with "elapsed 20000 ms"):

```js
  assert.ok(deadline.elapsedMs < 1000, `the 20 s queue wait was not charged (elapsed ${deadline.elapsedMs} ms)`)
```

### R5. The other §5 tests that weren't written
Each of these is in §5's Z3 row and was missing from `a6b93610`:
- **grant, then abort in the same tick** → no slot leaked, and the next waiter starts;
- **priority through the bridge:** with every slot busy, a later node's file queues first, then an earlier node's dependency → the earlier node's request starts first;
- **three models waiting to parse hold no slots:** `limiter.active` is 0 while they wait for admission or the parse queue;
- **S1's shared-transfer timer:** this is R1's (t3);
- **the second review's M3 per-chunk scenario:** two models share a 20 MiB dependency, and X also names a second 20 MiB file → X fails `too-large` as soon as its own bytes pass 25 MiB; Y loads; the ledger is about 40 MiB;
- **the 31 s timeout:** a job with 31 s of its own transfer and parse time ends `timeout`.

The outside review wrote throwaway versions of most of these. On the shipped code, grant-then-abort (on both the file slot and the dependency slot) and the per-chunk scenario both hold. So these tests pin behaviour that's already right, and they belong in the suite.

### R6. p2: the proof is reproducible; the workers' breaks were wrong (both reviews)
Neither worker could make p2 fail. With the break written as `wanted = () => … && stillWanted(firstRecord)` (the first requester's view, threaded in from `load`), "removing the FIRST of two requesters leaves the shared load alone" fails. The outside review found a second test fails too: "a Check and a node share one job; ending the Check leaves the node loading". **No code or test change.** The handoff reports p2 with this break and both failing tests.

### R9. A job's transfer priority is fixed at job start (outside review S2)
`model-bridge.js` ~L538 computes `priority: jobPriority(key)` once, when the job starts. §4 Z3 says a job's priority is its earliest requester's `allNodes` index **when it asks**. So a node that joins a Check-started job keeps the Check's after-every-node priority for every transfer.
- **Fix:** pass `fetchModel` a `priority()` **function**, called at each `limiter.acquire`. A plain number stays accepted, for the existing tests.
- **Test:** a Check starts a job for a URL; a node with that URL joins; the job's next transfer (a dependency) queues with the node's priority. With every slot busy, it starts before a later node's file.

### R10. Nits (outside review)
- **The redirect-policy key** (`model-fetch.js` ~L736) uses the literal `'world'` for a root-relative model. Use the world's origin, as Z3 says. It's harmless today, because `worldBaseUrl` is fixed per generation.
- **`useEntry`** (`model-bridge.js` ~L586–592) builds the instance before checking `stillWanted`, and never disposes it on the unwanted branch. That branch is unreachable today, because nothing awaits in between. Dispose `built` there with `disposeInstance` anyway, so a future await can't leak a skeleton.
- **The sign-in `.catch`** (`app.js` ~L2594) also catches errors thrown inside the `.then` body, such as from `autoConnectToHomeWorld`, and labels them "sign-in check failed". Catch only `me()`'s rejection: `me().then(onUser, onSessionCheckFailed)`, or a `.catch` placed before the `.then`.
- **Out of scope, recorded:** a SOM node replaced by identity, with the same name and spec, while it loads ends `loading/aborted`, because `reconcile` keeps the stale record. The reviewer reproduced it at the base too, so it isn't this round's. Note it against Z2's invariant for a later round.

## 3. Browser checks at `a6b93610` (Claude, §5.1)
Headless Chromium, the real `apps/client/index.html`, with esm.sh imports served locally at the same versions. A local https world server ran with the owner session, and a model server counted, delayed and stalled requests. Khronos samples: Box, Duck, RiggedSimple and BoxTextured.

| Check | Result |
|---|---|
| A placed model renders; no page errors throughout | pass |
| **S1:** a `.gltf` naming one image two ways renders, with one image request | pass |
| **S8:** two nodes share a slow load; delete the first mid-load → the second renders, with one request and no abort | pass |
| Deleting the only node of a slow download aborts its request | pass |
| **S6:** eight models and a Check → the limiter's `active` never exceeds 4 (browser resource timing: at most 3 overlapping); the Check waits its turn | pass |
| **S6:** two `.gltf` files sharing a slow texture and buffer, loaded together → one request each | pass |
| **S4:** 30 add/delete cycles of a skinned model → `renderer.info.memory` geometries 19 → 19, textures 14 → 14 | pass |
| **Z5:** a 502 from `/api/auth/me` → no page error | pass |
| **R1:** a stalled texture, then a small model placed after it → **both still `loading` after 40 s** | **FAIL** |

R7 and R8 weren't exercised in the browser. They need the 150 MiB ledger crossed, or a texture reused across a slot queue. The outside review reproduced both at fetch and bridge level.

## 4. Steps (one commit each, on `workflow/models-hardening` from `a6b93610`)
1. R1, R7 and R8 in `model-fetch.js` (one bag per task with `granted`; the consumer deadline; the abort mapping), with tests (t1)–(t4), (t6) and (t9).
2. The bridge's half of R1 and R7 (`load` fails rather than drops a wanted node), with tests (t5), (t7) and (t8).
3. R9 (priority as a function) and R10 (the nits), with R9's test.
4. R2–R5: the tests above (R2's and R3's code as given; R3's behavioural version; R4's assertion; R5's tests).
5. Full suites (`packages/client` **without** `--test-force-exit`; every server file individually under `timeout 180`), then the proofs, then the handoff.

## 5. Proofs (all of them, every round)
Report **every** mandated proof with the named tests that fail: (p1)–(p8), (p3b), (p3c), (p5b), (p5c), (p5d) from the pre-brief, plus **(p9)** (R1), **(p10)** (R7) and **(p11)** (R8). p2 uses R6's break; p3c and p4 use the new tests from R2 and R3; p5b uses R4's assertion. As before, restore from a saved copy, never with `git checkout`.

**"Not reproducible" is not an acceptable result for a mandated proof.** If a break doesn't fail any test, either the break is wrong (fix the break, as in R6) or the test is weak (strengthen it, as in R2–R4). Say which. The GLM review must reproduce every proof itself, and list any it couldn't, with why.

## 6. Notes
- **This is a larger revision than its first draft.** With 300 calls it may need a continuation: commit at every step, and use the continuation rule.
- **The release chain for `a6b93610`:** the DEV finalizer (`t_7a6efd4f`) and the acceptance gate (`t_7dca7780`) are superseded by this revision's chain. The operator archives them when the new chain exists.
- **The DEV deploy card's handoff** quoted only the end of the deploy output, with no `REVIEWED_SHA=`, `RELEASE_SHA=` or `SMOKE OK` lines. The gate patch is installed. Claude's working guess is that the deployer's tool returns only the tail of a long output; the operator is checking the host journal. If that's confirmed, H4's handoff rule needs the deployer to search the whole output, or the gate to print those lines last.
- **A note for later:** node parses never queue behind each other, because W5 admission settles each node before the next is admitted. Only a Check's parse can hold a node's job in the parse queue. Tests of "queued" cases need a Check in front.
