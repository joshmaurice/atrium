<!-- Outside code review (ChatGPT) of add-check round 1 at 53764b76, source-only (its clone failed on DNS).
     Pasted by the operator on 2026-11-05. Its attachment (probe-extras.js) was not copied; Claude reproduced M1
     through the real handler and M2 with the real coordinator: REVISION-add-check-round-2.md. Its links carried a
     utm_source parameter, removed here. -->

# Atrium `add-check` — Outside Code Review

Reviewed commit: `53764b767531044370cf91d5a5c47e2131b69090`\
Base: `25f6b08328b60cf44cf7a71c8f5f7ebef51805a9`\
Review type: Source review with isolated Node.js reproduction; not a full integration-test review.

Clone: FAILED. The exact error was:

```
fatal: unable to access 'https://github.com/joshmaurice/atrium/': Could not resolve host: github.com
```

I obtained the pinned source through the GitHub connector instead. Node.js `v22.16.0` is available, but pnpm is unavailable in this environment.

Verdict: CHANGES REQUESTED.

I found a concrete bypass of A2's 16 KiB world-extras limit. Because the public server accepts world adds from owners rather than anonymous visitors, this particular bypass does not establish an anonymous-visitor exploit. It nevertheless violates the approved validation contract.

## Findings

### M1 — Must-fix: `__proto__` bypasses the extras-byte budget

Location: [packages/server/src/send-policy.js:1972–1980](https://github.com/joshmaurice/atrium/blob/53764b767531044370cf91d5a5c47e2131b69090/packages/server/src/send-policy.js#L1972-L1980), mirrored in [packages/client/src/add-spec.js:129–137](https://github.com/joshmaurice/atrium/blob/53764b767531044370cf91d5a5c47e2131b69090/packages/client/src/add-spec.js#L129-L137).

Evidence: REPRODUCED against the exact checker logic in an isolated Node.js probe. Not yet reproduced through the real WebSocket handler.

Both implementations construct a temporary object using:

```
const rest = {}
for (const key of Object.keys(extras)) {
  if (key === 'atrium') continue
  rest[key] = extras[key]
}
```

For an own JSON property named `__proto__`, assignment to an ordinary object does not create the expected own property. The subsequent `Object.keys(rest)` and `JSON.stringify(rest)` therefore omit it from the measured payload.

I tested a 900,000-character value encoded as an ordinary JSON property. The probe produced:

| Property    | Actual extras bytes | Checker result    |
| ----------- | ------------------- | ----------------- |
| `payload`   | 900,014             | `extras-size`     |
| `__proto__` | 900,016             | `null` (accepted) |

The full message was approximately 900 KiB, below the server's 1 MiB WebSocket payload limit.

Failure scenario: A world owner can submit an `add` containing approximately 900 KB of non-Atrium extras under `__proto__`, despite A2's 16 KiB limit. The schema permits arbitrary extras keys, so it does not close this gap. The same problem exists in the client copy.

Fix: Construct the filtered object with `Object.create(null)`, or build the filtered JSON representation without writing user-controlled keys into an ordinary object. Add matching regression vectors for `__proto__`, including one-byte-below, at-limit, and over-limit cases.

This is also an example of why passing shared vectors does not establish security completeness: both implementations contain the same defect.

### M2 — Must-fix: a mutation during autosave read-back can be lost

Location: [packages/server/src/autosave.js:66–129](https://github.com/joshmaurice/atrium/blob/53764b767531044370cf91d5a5c47e2131b69090/packages/server/src/autosave.js#L66-L129), particularly lines 85–114; also lines 154–164.

Evidence: CONFIRMED IN THE SOURCE. The concurrency sequence has not been reproduced against a running Atrium coordinator.

The new read-back adds another asynchronous interval between capturing the world document and marking it clean.

A concrete failure sequence:

1. Autosave A serializes the world to string S1.
2. A awaits `readBack(S1)` at line 93.
3. The owner changes an object. `markDirty()` sets `entry.dirty = true`.
4. A finishes read-back and writes the older S1.
5. A clears `entry.dirty = false` at line 113, despite the newer modification.
6. The subsequent debounce sees a clean world and does nothing. If the owner disconnects, the flush also skips saving.

The serialized document can therefore omit an acknowledged edit. This race had a possible window during the pre-existing asynchronous serialization, but A10 adds a further window in which it can occur.

Fix: Maintain a monotonically increasing mutation generation for each world. Capture the generation before serializing; clear `dirty` only if the generation is still unchanged when the database write completes. Otherwise leave it dirty for another save.

Add a deterministic test using A10's injected `readBackProblem` seam: block read-back, mutate and mark dirty again, release the read-back, then verify the newer change is ultimately persisted. This should be a release blocker because the consequence is potential data loss.

Security-scope clarification for M1: The mutation gate has an important exception: [session.js:645–665](https://github.com/joshmaurice/atrium/blob/53764b767531044370cf91d5a5c47e2131b69090/packages/server/src/session.js#L645-L665) allows anyone to perform world adds when the resolved mutation policy is `open` (the default for a world without an owner). Thus M1 is potentially exploitable by an anonymous visitor in an open world, not just by an owner. I have not verified whether PROD currently hosts such a writable world.

### S1 — Should-fix: A1 still relies on the schema for several shape checks

Location: [send-policy.js:1984–1986, 2028–2029, 2078–2096](https://github.com/joshmaurice/atrium/blob/53764b767531044370cf91d5a5c47e2131b69090/packages/server/src/send-policy.js#L1984-L2096), and corresponding client code.

Evidence: CONFIRMED IN THE SOURCE.

The internal review correctly noticed that this returns acceptance:

```
checkAddNode(null) // null — accepted
```

The issue is slightly broader. The standalone checker also accepts explicit `mesh: null`, `material: null`, and `indices: null`, although the A3/A4 rules describe objects or arrays when those fields are present.

The current wire schema rejects these shapes, so I do not consider this a demonstrated server bypass. However, §4 A1 explicitly promises that its checker never relies on the schema.

Fix: Either make A1 genuinely standalone and reject these shapes, or revise that guarantee to state exactly which shape requirements A8 owns. I prefer failing closed in the standalone checker, particularly since the client directly invokes it.

### S2 — Should-fix: indices lengths are checked after per-element work

Location: [send-policy.js:2013–2039](https://github.com/joshmaurice/atrium/blob/53764b767531044370cf91d5a5c47e2131b69090/packages/server/src/send-policy.js#L2013-L2039).

Evidence: CONFIRMED IN THE SOURCE.

The checker correctly verifies POSITION and NORMAL lengths before scanning those arrays. But it scans their elements before checking whether `indices` has a valid length:

```
for (const v of position) if (!isFloat32(v)) return 'position-value'
// ... NORMAL scan ...
if (indices !== undefined && indices !== null) {
  if (!Array.isArray(indices) || indices.length < 3 || indices.length % 3 !== 0)
    return 'indices-length'
}
```

A message can therefore force substantial Float32 checking even though its indices length alone already makes it invalid.

This does not establish an unacceptable runtime; the WebSocket's 1 MiB cap still bounds the work. But it violates A1's explicit lengths-before-elements requirement.

Fix: Perform every primitive-level structural, key-set, array-length, and avatar-budget check before scanning POSITION, NORMAL or indices values. Add a test that would fail if the indices-length check were moved back after the Float32 scan.

### S3 — Should-fix: boundary vectors are incomplete

Location: [tests/fixtures/add-node-vectors.json](https://github.com/joshmaurice/atrium/blob/53764b767531044370cf91d5a5c47e2131b69090/tests/fixtures/add-node-vectors.json) and [packages/server/test/add-node-vectors.test.js:42–93](https://github.com/joshmaurice/atrium/blob/53764b767531044370cf91d5a5c47e2131b69090/packages/server/test/add-node-vectors.test.js#L42-L93).

Evidence: CONFIRMED IN THE SOURCE.

I inspected and enumerated the fixture through the GitHub connector.

# 42

Shared cases

# 13

Acceptances

# 29

Refusals

All 19 defined refusal reason codes are represented. The real avatar's `extras.atrium.ephemeral` marker is also covered.

However, several important exact-boundary acceptance cases are missing:

| Boundary                          | Fixture coverage |
| --------------------------------- | ---------------- |
| 256-character mesh name           | Accepted         |
| 257-character mesh name           | Rejected         |
| Exactly 64 primitives             | Missing          |
| 65 primitives                     | Rejected         |
| Exactly 1,024 avatar vertices     | Missing          |
| 1,025 avatar vertices             | Rejected         |
| Exactly 6,144 avatar indices      | Missing          |
| 6,147 avatar indices              | Rejected         |
| Exactly 65,535 world vertices     | Missing          |
| Index 65,534 with 65,535 vertices | Missing          |
| Index 65,535                      | Rejected         |
| Exactly 16,384 UTF-8 extras bytes | Missing          |

Fix: Add these acceptance boundaries and their immediate rejection counterparts where applicable. They are valuable because the same fixture pins both implementations.

### N1 — Nit: new autosave test still uses a fixed port

Location: [packages/server/test/autosave.test.js:625–628](https://github.com/joshmaurice/atrium/blob/53764b767531044370cf91d5a5c47e2131b69090/packages/server/test/autosave.test.js#L625-L628).

Evidence: CONFIRMED IN THE SOURCE.

The new A10 test calls `httpServer.listen(9016)`, rather than selecting port 0. The new `add-check.test.js` correctly uses port 0.

The fixed port can collide with another local process. It also conflicts with the pre-brief's new-test guidance. Use port 0 for the appended autosave test.

## What looks correct

Several important elements appear sound from source inspection.

Inbound validation coverage: I searched all 18 files under `packages/server/src/` for calls to `.addNode()` and `.ingestNode()`. The only server-source call into `world.addNode` is at `session.js:1421`, and both avatar and world adds pass through the new checker first. The two world implementations then call `SOMDocument.ingestNode`.

Direct calls to the exported `world.addNode` remain unchecked. That is a separate internal trust boundary, not a demonstrated network bypass.

The two implementations: The server and client A1–A5 implementations match in their relevant algorithms, constants, and reason messages. Unfortunately, both share M1.

The avatar path: K4 accepts the real `{ ephemeral: true }` marker, and the checker runs before displayName is overwritten. The schema and the handler both restrict `format` to `"gltf"`.

Geometry and materials: The source correctly checks Float32 finiteness, POSITION/NORMAL lengths, index ranges, the 65,535-vertex cap, and material ranges. The shared [A9 predicates](https://github.com/joshmaurice/atrium/blob/53764b767531044370cf91d5a5c47e2131b69090/packages/server/src/send-policy.js#L1888-L1907) are used by the server's `send` material rules.

A7: `prepareDuplicate` and `prepareRestore` check their built descriptors using the client implementation and return the checker's reason. `MAX_INDEX` is correctly 65,534.

A10: A failed read-back leaves the database update uncalled and the dirty flag set. The server emits `WORLD_UNREADABLE` on serialization failure; the client catches `readJSON` failures before building a new SOM; and the app handles the error for the matching ready session. The required panel sentence is correct.

These are source confirmations, not claims of passing integration tests.

## Internal review: five findings

| GLM finding                         | Assessment                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1. Proof p2 could pass without A5   | Confirmed. The added end-to-end tests for two primitives and 1,025 vertices strengthen coverage.        |
| 2. K6 unit test added late          | Confirmed in source, `value-rules.test.js:115–120`.                                                     |
| 3. Test cleanup hang fixed          | Cleanup paths are present; runtime fix unverified.                                                      |
| 4. Two additional test-only commits | Confirmed. Six commits total: four implementation rounds followed by `760e90b6616a` and `53764b767531`. |
| 5. Non-object nodes accepted by A1  | Confirmed and disputed as non-blocking against the written A1 contract. Covered by S1.                  |

## What I ran

| Activity                                          | Result                                 |
| ------------------------------------------------- | -------------------------------------- |
| `git clone https://github.com/joshmaurice/atrium` | Failed: DNS resolution                 |
| GitHub comparison, base → tip                     | Succeeded: 6 commits, 26 changed files |
| `node --version`                                  | `v22.16.0`                             |
| `pnpm --version`                                  | Not installed                          |
| Isolated `worldExtrasProblem` reproduction        | Ran: 2 inputs, results reported in M1  |
| Protocol tests                                    | Not run                                |
| Client package tests                              | Not run                                |
| App client tests                                  | Not run                                |
| Server tests (all nine specified files)           | Not run                                |
| p3, p4, p7 and q2, tip and base                   | Not run                                |
| Real `attachSessionHandlers` WebSocket probe      | Not run                                |
| p1–p6 mutation proofs                             | Not independently run                  |

The isolated M1 reproduction is available here:

Download probe-extras.js

It reproduces the checker algorithm, not a live server. In particular, I cannot provide a measured worst-case runtime for the full checker or confirm whether the specified base-vs-tip probes reversed as intended. Likewise, I cannot independently verify the new tests' failures on the base.

## Release recommendation

CHANGES REQUESTED for `53764b767531044370cf91d5a5c47e2131b69090`.

I recommend fixing M1 and M2 before production. M1 defeats an explicit size budget and can be reached anonymously where world mutation is open. M2 creates a possible lost-save condition through the new asynchronous read-back window.

The other findings are smaller and can be addressed in the same correction round. The existing implementation has a sensible validation boundary, but it needs those two fixes and a real integration-test run before an outside reviewer can approve the release.