<!-- Outside code review (ChatGPT) of add-check round 2 at 302654c8, source-only (its clone failed on DNS).
     Pasted by the operator on 2026-11-05. Claude reproduced its M1 on the real coordinator and fixed M1, S1, N1 and N2
     in round 2.1 (REVISION-add-check-round-2.md section 8). -->

# Atrium `add-check` — Round 2 Outside Code Review

Reviewed commit: `302654c8bb990ef6a7674a693754d1cd9ec8f49d`\
Previous commit: `53764b767531044370cf91d5a5c47e2131b69090`\
Review type: Source-only review, supplemented by an isolated Node.js concurrency probe.

Clone: FAILED. The exact error was:

```
fatal: unable to access 'https://github.com/joshmaurice/atrium/': Could not resolve host: github.com
```

I obtained the pinned source using the GitHub connector instead. The comparison confirms two commits and six changed files: the server and client validation rules, autosave, two existing test/fixture files, and the new boundary test file.

I have independently examined the implementation, rather than relying on the revision author's reported test results. The full repository test suites could not be run.

## Verdict: CHANGES REQUESTED

The original `__proto__` bypass and several other round-1 defects appear correctly fixed. The shared validation rules are substantially improved.

However, I found one new autosave concurrency concern that I would resolve before production: a failed save can cause an unbounded retry chain, preventing `flushAndTeardown` from completing under certain timing conditions. I also identified a stop/re-registration race worth guarding against.

## Findings

### M1 — Must-fix: repeated save failures can prevent teardown from completing

Location: `packages/server/src/autosave.js:71–85`, `194–197`, `207–212`, `243–247`

Evidence: CONFIRMED IN THE SOURCE; REPRODUCED in an isolated Node.js simulation of the relevant promise-control flow. Not reproduced against the actual repository module.

The new `doSave` implementation returns a promise whose `.finally()` callback can return another `doSave` promise:

```
entry.inFlight = runSave(worldId, host, entry).finally(() => {
  if (worlds.get(worldId) !== entry) return
  entry.inFlight = null
  if (entry.again) {
    entry.again = false
    if (entry.dirty) return doSave(worldId, host)
  }
})
```

Returning the next save's promise means the original `inFlight` promise remains unresolved until the entire retry chain finishes.

Consider this sequence:

1. Autosave A starts and its read-back takes longer than the periodic interval.
2. The periodic timer fires while A is running, setting `again = true`.
3. A's read-back fails. The world remains dirty.
4. The `.finally()` callback immediately starts autosave B and returns B's promise.
5. Another periodic tick requests another save while B runs.
6. The pattern repeats.

If `flushAndTeardown` is awaiting the first `inFlight` promise, it cannot progress to its own bounded retry logic. Consequently, it never reaches the `CRITICAL` log or finishes teardown while the chain continues.

Isolated probe results

I reproduced the control flow locally with a 5 ms periodic request interval, a 20 ms failing read-back, and the same `.finally()` chaining behavior.

```
Node v22.16.0

After 160 ms:
  Save attempts: 7
  Initial inFlight settled: false
  Dirty: true
  Saving: true
  Again: true

After stopping periodic requests:
  Save attempts: 9
  Initial inFlight settled: true
```

This uses a deliberately short interval to expose the failure. The production default is 60 seconds, so an ordinary quick failure would not reproduce it. The risk arises when failures or read-backs take longer than the configured periodic interval.

Recommendation: Separate the completion of an individual save from scheduling its successor. During teardown, prevent periodic requests from extending the awaited chain indefinitely. Preserve serial execution and the generation counter, but guarantee that the flush's retry budget is finite.

This is a release blocker because the flush's bounded-failure guarantee does not hold for all supported timings.

### S1 — Should-fix: a stopped save can affect a replacement world entry

Location: `packages/server/src/autosave.js:132–152`, `271–277`

Evidence: CONFIRMED IN THE SOURCE; the complete failure sequence is INFERRED. Not reproduced against the live registry.

`runSave` correctly receives the original entry and captures its generation. However, after its asynchronous read-back, it looks up the current entry by world ID:

```
const e = worlds.get(worldId)
if (e) {
  if (e.gen === gen) e.dirty = false
  e.saving = false
}
```

Consider an explicit stop/re-registration:

1. World A begins saving with generation 1.
2. `stop(worldId)` removes A's entry while the read-back is in progress.
3. A new host for the same world ID calls `markDirty`, creating entry B with generation 1.
4. A's original read-back completes.
5. A writes its older document, then looks up entry B.
6. Because the generations coincide, A clears B's dirty flag.

The newer host's unsaved edit can now be skipped.

There is also no active-entry identity check before the old asynchronous operation calls `worldStore.updateWorld`, so a stopped save can still perform a database write.

The important qualification is that normal registry teardown awaits `flushAndTeardown` before calling `stop` (`world-registry.js:593–607`). That protects the standard disconnect path. I have not established that the replacement-entry sequence is reachable through normal production operation.

Still, a modest defensive change would close it: before writing and before changing save state, require `worlds.get(worldId) === entry`. Never use the current entry's generation to finish an operation belonging to an earlier entry.

### N1 — Nit: the new debounce race test depends on elapsed-time guesses

Location: `packages/server/test/autosave.test.js:728–746`

Evidence: CONFIRMED IN THE SOURCE.

The first R2 test correctly uses a deferred promise to hold read-back open. However, after the second edit it relies on:

```
await new Promise((r) => setTimeout(r, 80))
held.release()
await new Promise((r) => setTimeout(r, 150))
```

The initial read-back barrier is deterministic, but the 80 ms and 150 ms waits are not completion barriers. On an overloaded CI runner, a correct implementation can take longer than expected.

The test should ideally await an observable second save or database result, with an outer timeout for failures.

The second R2 test is better: it releases the read-back and directly awaits `flushAndTeardown`.

Both tests appear constructed to fail on the original lost-edit behavior, but I could not independently run the base-versus-tip comparison.

### N2 — Nit: read-back log suppression resets before a successful database write

Location: `packages/server/src/autosave.js:115–145`

Evidence: CONFIRMED IN THE SOURCE. Pre-existing from round 1.

`entry.readBackLogged` becomes `false` as soon as read-back succeeds, before `worldStore.updateWorld` succeeds.

If one read-back fails, the next read-back succeeds but the database write fails, and a subsequent read-back fails, two read-back failure lines can be emitted without any successful intervening save.

The contract says suppression lasts until a save succeeds. Move the reset into the successful write branch.

This is a small, pre-existing logging issue, not a new R2 data-loss defect.

## Earlier findings: disposition

| Round-1 finding                     | Result       | Assessment                                                                                      |
| ----------------------------------- | ------------ | ----------------------------------------------------------------------------------------------- |
| M1: `__proto__` bypass              | Fixed        | Prototype-less copy measures the property correctly                                             |
| M2: Lost edit during autosave       | Partly fixed | Generation tracking and in-flight saves repair the original race; M1 above remains              |
| S1: Standalone null/type validation | Fixed        | Explicit null/non-object values are refused                                                     |
| S2: Lengths-before-values           | Fixed        | Geometry shapes and lengths are checked across all primitives before scanning geometry elements |
| S3: Missing boundary vectors        | Fixed        | Requested exact boundaries now covered                                                          |
| N1: Fixed port 9016                 | Fixed        | Changed to port 0                                                                               |

### R1 — Extras protection

Files: `send-policy.js:1973–1987`, `add-spec.js:130–144`

The prototype-less object is the correct fix. I ran a separate isolated Node.js probe of the copy-and-measure algorithm, using JSON-parsed values.

| Input containing 17,000-character string | Measured bytes | Result     |
| ---------------------------------------- | -------------- | ---------- |
| `__proto__`                              | 17,016         | Over limit |
| `constructor`                            | 17,018         | Over limit |
| `prototype`                              | 17,016         | Over limit |
| `toJSON`                                 | 17,013         | Over limit |
| Nested `__proto__`                       | 17,026         | Over limit |

A callable getter or `toJSON` function could alter direct JavaScript-object behavior, but these cannot arrive as functions through the JSON WebSocket message path. Circular references or unserializable values cause `jsonBytes` to return `Infinity`, which the checker refuses.

The `atrium` key remains deliberately excluded from this calculation. In the handler, `checkAtriumExtras` continues to check it separately (`session.js:1355–1382`). The avatar's permitted `{ ephemeral: true }` marker remains compatible.

I found no remaining network-reachable bypass of the 16 KiB non-Atrium extras limit.

### R3 — Fail-closed shapes and first-party compatibility

The new `isPlainObject` checks reject non-object nodes, extras, mesh, material, and PBR material values. Explicit `null` indices are also rejected.

The first-party descriptor path remains compatible based on source inspection:

- `buildDescriptor` omits a missing mesh, indices or material rather than inserting `null`.
- The real avatar, palette primitive and teleporter descriptor are exercised by `add-check.test.js`.
- Duplicate and Undo's restore pass built descriptors through the client checker.
- The server's avatar marker allowance is unchanged.

I found no first-party sender that newly transmits one of the forbidden explicit-null shapes. This is a source-based finding, not a new browser or integration test run.

### R4 — Structural checks before geometry scans

Both copies now use two passes through the mesh's primitives:

1. `primitiveShapeProblem` for every primitive.
2. `primitiveValuesProblem` for every primitive.

This fixes the original problem: a malformed later primitive's keys or lengths are found before the earlier primitive's POSITION, NORMAL or indices values are scanned.

The relevant algorithms in the server and client files match.

One narrow qualification: material validation is part of the shape pass, so a material's four-element `baseColorFactor` can be scanned before a later primitive's keys. That is bounded work and does not reopen the original potentially large geometry-scan problem. If the contract literally prohibits any element read before every key check, material validation would need a further shape/value split. I do not consider this a blocker for the original S2 finding.

### R5 — Boundary coverage

The fixture now has 60 vectors. The new boundary test file defines 21 tests, applied to both implementations where appropriate.

| Boundary            | Acceptance     | Refusal |
| ------------------- | -------------- | ------- |
| Mesh name           | 256 characters | 257     |
| Primitive count     | 64             | 65      |
| Avatar vertices     | 1,024          | 1,025   |
| Avatar indices      | 6,144          | 6,147   |
| World vertices      | 65,535         | 65,536  |
| Highest valid index | 65,534         | 65,535  |
| Extras size         | 16,384 bytes   | 16,385  |

The fixture additionally includes multibyte UTF-8 cases and `__proto__` cases.

These test definitions cover the requested edges. Their passing results remain unverified by me.

## What I ran

Local environment: Node v22.16.0; pnpm unavailable.

| Activity                             | My result                              |
| ------------------------------------ | -------------------------------------- |
| Clone and checkout                   | Failed — DNS resolution                |
| GitHub commit comparison             | Succeeded — 2 commits, 6 changed files |
| `node --version`                     | `v22.16.0`                             |
| `pnpm --version`                     | `command not found`                    |
| Isolated extras measurement          | 6 cases executed                       |
| Isolated autosave control-flow probe | 1 scenario executed                    |

Requested repository tests — not run:

| Test file                     | Measured result |
| ----------------------------- | --------------- |
| `add-node-vectors.test.js`    | Not run         |
| `add-node-boundaries.test.js` | Not run         |
| `autosave.test.js`            | Not run         |
| `add-check.test.js`           | Not run         |
| `value-rules.test.js`         | Not run         |
| `avatar.test.js`              | Not run         |
| `visitor-leak.test.js`        | Not run         |
| Client `add-spec.test.js`     | Not run         |

The base-versus-tip test comparison was also not run. Accordingly, I cannot independently confirm the revision's reported 67/67 server vectors, 65/65 client tests, 21/21 boundaries, 13/13 autosave tests, or 3,861-test aggregate.

## Release recommendation

CHANGES REQUESTED for `302654c8bb990ef6a7674a693754d1cd9ec8f49d`.

I would make one additional correction before approving:

1. Ensure that a failing autosave cannot keep a flush's awaited promise pending indefinitely through chained retries.
2. Guard asynchronous save completion against replacement entries after `stop()`, preferably in the same change.
3. Strengthen the first R2 race test to await observable completion instead of fixed sleeps.

The `add` validation changes themselves look ready from source inspection. The remaining concern is concentrated in autosave's asynchronous lifecycle, rather than geometry validation or first-party descriptor compatibility.

After addressing M1 and rerunning the real autosave tests, I would expect a much shorter follow-up review to be sufficient.