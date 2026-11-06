<!-- Outside code review (ChatGPT) of claude/richer-add at 4b3393db, source-only (clone failed on DNS).
     Pasted by the operator on 2026-11-05 at 21:40 PT. Verdict APPROVE WITH NITS. Claude reproduced N1 (a holey
     factor array passes only when checkAddNode is called directly; off the wire it is null and refused).
     Neither nit is taken in this round: DEV and PROD get the reviewed SHA. N1 is a follow-up (an indexed check
     in both copies' isUnitRangeVec3/Vec4, with a unit test); N2 (-0 becomes +0 in JSON) needs no change. -->

# Atrium `richer-add` — Implementation Review

Reviewed commit: `4b3393db219db1d02e1d04a915350a02b57fb4fe`\
Base: `8df89073961c7a8f018ba65b220c4cd18f6231bf`\
Scope: Five commits, 25 changed files, read-only.

## 1. Repository access

The clone was attempted first, as requested, but failed:

```
Cloning into 'repo'...
fatal: unable to access 'https://github.com/joshmaurice/atrium.git/': Could not resolve host: github.com
CLONE_EXIT=128
```

The GitHub connection worked, however. It confirmed the exact base and tip, retrieved the final pre-brief, implementer's handoff, and earlier design review, and identified all 25 changed files.

The local environment has Node.js `v22.16.0`, but `pnpm` is not installed. Consequently, repository test results claimed in the handoff cannot be treated as independently verified here.

## 2. Confirmed implementation results

### Server/client parity — source-identical

CONFIRMED IN THE SOURCE. I compared the complete richer-add validation sections of `packages/server/src/send-policy.js` and `packages/client/src/add-spec.js`.

```
Richer implementation identical: true
Server section length: 14965
Client section length: 14965
```

The fixture contains 112 vectors. This establishes exact source parity for the richer-add checking logic, rather than merely relying on matching expected test results. It does not establish runtime parity for the surrounding protocol or session handling.

### R4 — one buffer per ingest

CONFIRMED IN THE SOURCE. `packages/som/src/SOMDocument.js:803–841` creates a lazily initialized buffer outside the primitive loop and shares it among the accessors constructed during that call.

The existing candidate-based disposal design is compatible with this approach: each `ingestNode` call owns its newly created buffer, and deleting the associated mesh makes that buffer eligible for pruning. The server integration test also checks allocation and pruning, although I couldn't execute it.

### R6 — stale-tab protection

CONFIRMED IN THE SOURCE. `packages/server/src/session.js:187–192, 1312–1318, 1527–1539` implements the specified capability predicate and refuses both world additions and removals after the authorization gate.

`packages/client/src/AtriumClient.js:753–769` sends `addFields: 2` beside `scriptRunner: 3`, using the same connection condition. This addresses the specific Delete/Undo data-loss scenario from the earlier design review.

The two explicitly accepted limitations remain: tabs predating `scriptRunner`, and stale cross-origin clients editing open worlds.

## 3. Findings

No must-fix found

### N1 — Holey material-factor arrays pass the direct validator

Severity: Nit — defense in depth\
Status: REPRODUCED (isolated Node probe), CONFIRMED IN THE SOURCE

Locations: `packages/server/src/send-policy.js:1889–1898` and `packages/client/src/add-spec.js:48–57`.

Both validators use `Array.prototype.every()` for `baseColorFactor` and `emissiveFactor`. JavaScript's `every()` skips missing array elements, allowing a holey array to satisfy the check despite not containing every required number.

Independent probe:

```
const isUnitRange = v =>
  typeof v === 'number' &&
  Number.isFinite(v) &&
  v >= 0 && v <= 1;

const isUnitRangeVec3 = v =>
  Array.isArray(v) &&
  v.length === 3 &&
  v.every(isUnitRange);

const factor = [, 0, 0];

console.log(isUnitRangeVec3(factor));
console.log(JSON.stringify(factor));
console.log(isUnitRangeVec3(JSON.parse(JSON.stringify(factor))));
```

Output:

```
true
[null,0,0]
false
```

Impact: The direct checker accepts an array that cannot be faithfully serialized as a valid factor. However, this is not an exploitable WebSocket bypass: the actual wire format turns holes into `null`, and the numeric schema and validator reject that value. Duplicate's builder also emits dense arrays.

The handoff acknowledges this under §6 N3. I agree it is not a production blocker.

Suggested change: Eventually replace `.every()` with an indexed check that requires every position to contain a valid number, updating both copies together. Add a direct unit regression. This is inexpensive hardening, not a reason to hold the round.

### N2 — The `-0` edge is not bitwise lossless across the wire

Severity: Nit / documented behavior\
Status: REPRODUCED (isolated Node probe)

For an explicitly transmitted `-0`, the parser retains the negative zero; a Float32 accessor also retains it. JSON serialization, however, converts it to positive zero.

```
wire -0 parsed sign: -0
server Float32 sign: -0
broadcast JSON sign: +0
```

The same applies to the newly supported UV coordinates and material factors.

This does not represent a meaningful geometry or appearance loss in the scenarios covered by the contract. The protocol is JSON-based, and ordinary JSON serialization already canonicalizes signed zero. I would not change the implementation for this case.

Independent probe source: isolated-probe.mjs

## 4. Other reviewed areas

| Area                       | Assessment                                                  | Evidence                |
| -------------------------- | ----------------------------------------------------------- | ----------------------- |
| R1 — New fields and bounds | No blocker identified                                       | Source review           |
| R2 — Avatar restrictions   | All added key classes explicitly rejected                   | Source review           |
| R3 — Reason codes          | Same definitions in both copies                             | Exact source comparison |
| R4 — Ingestion and buffers | Correct construction and pruning approach                   | Source review           |
| R5 — Protocol schemas      | Client/server node schemas structurally identical           | Programmatic comparison |
| R6 — Stale tabs            | Both `add` and `remove` guarded; current-page hello correct | Source review           |
| R7 — Duplicate/Restore     | Builder and material canonicalization align with contract   | Source review           |
| R8 — Sharing and Undo note | Sharing predicate and note propagation appear correct       | Source review           |
| R9/R10 — Compatibility     | No contrary behavior identified                             | Limited source review   |

### Handoff §3 discrepancies

I checked the implementer's five explanations against the source.

The placement of material scalar checks before geometry-value checks preserves the earlier lengths-first structure; the expensive `extras` walk is deferred. The use of `listSemantics()` in `buildDescriptor` is appropriate and avoids manufacturing attributes not actually present. The headless `DocumentView` test is allowed by §5, although the pre-existing `initDocumentView` constructor issue deserves separate attention later.

The fail-closed treatment of deeply nested `extras` and the omission of `sharedMaterial` when false are likewise reasonable.

### Duplicate, Undo and sharing

The `materialDescriptor()` implementation at `edit-duplicate.js:209–226` correctly omits the new fields when they are defaults or when the glTF writer would omit them.

`hasSharedMaterial()` at lines 237–249 checks multiple node users of a mesh and multiple live primitive users of a material. The Undo engine copies the sharing flag onto delete entries, updates it on re-capture, and limits the note to Undo of Delete.

The tests include fixture-based fixed points, VEC3 and VEC4 color round trips, shared mesh/material cases, and a Delete → Undo → Redo note lifecycle. Those are appropriately targeted regressions. I found no source-level evidence that the new descriptors are systematically refused by the server.

## 5. Test execution and coverage

| Check                                             | Independently executed? | Result              |
| ------------------------------------------------- | ----------------------- | ------------------- |
| Clone and checkout                                | Attempted               | DNS failure         |
| `pnpm install --frozen-lockfile --ignore-scripts` | No                      | No local repository |
| SOM richer-add suite                              | No                      | Not verified        |
| Server richer-add suite                           | No                      | Not verified        |
| Server add-node vectors suite                     | No                      | Not verified        |
| Client Restore/Duplicate/Undo suites              | No                      | Not verified        |
| Renderer richer-add suite                         | No                      | Not verified        |
| Shared-validator source comparison                | Yes                     | Exact match         |
| Client/server add-node schema comparison          | Yes                     | Exact match         |
| Independent JS edge-case probe                    | Yes                     | Completed           |

Repository tests executed: 0. I cannot independently quote passing test counts.

The handoff reports 4,056 passing, zero failing, one named skip across 60 suites at the reviewed tip. This is a report from the implementer, not a result I reproduced.

The test source itself is stronger than a superficial happy-path suite. The server exercises the real session handler on port zero; the new client lifecycle test uses the real `AtriumClient`, real server handler, and Undo implementation; and the fixture tests perform save/reload round trips. The failure-injection results described in the handoff are plausible, but I did not repeat them.

## 6. Release conditions

I would retain the following acceptance requirements from the contract:

- Run the branch tests in the repository environment, including the six requested test commands.
- Complete the browser acceptance checks on DEV, especially the actual unreloaded-tab error experience and material rendering.
- Rerun `p6` before PROD. If it finds accessor/buffer labels or shared meshes/materials, reopen RA-L2/RA-L3 as the contract requires.

These are existing release conditions, not new code-review blockers.

## Final verdict

APPROVE WITH NITS — source-only review

Reviewed SHA: `4b3393db219db1d02e1d04a915350a02b57fb4fe`

The earlier R6 must-fix is implemented on both structural operations. The shared checker copies are identical. The new ingestion, descriptor construction, version negotiation and Undo-note mechanisms appear consistent with FINAL Rev 2.

I found no must-fix or should-fix implementation defect in the source inspected. The two edge observations above do not justify holding the round.

My approval is limited by the unavailable clone and unexecuted integration suites. It is not a substitute for the specified runtime and DEV acceptance checks.