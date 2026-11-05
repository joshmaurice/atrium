<!-- Outside review (ChatGPT) of PREBRIEF-richer-add-copy Rev 0.1 at 923bd444, source-only (clone failed on DNS).
     Pasted by the operator on 2026-11-05. Its attachments (p7-add-boundary-probe.mjs, the Float32 proof) were not
     copied; Claude's devtasks/spike-richer-add/p7-float32-extensions.mjs runs its M1 and S1 through the real handler. -->

# Atrium — richer-add / copy-objects pre-brief review

CHANGES REQUESTED

Reviewed: `joshmaurice/atrium` at `923bd444305be4067fc589f99c77276a35dbf6c0`, `devtasks/PREBRIEF-richer-add-copy.md`, DRAFT Rev 0.1.

Clone: FAILED. I attempted the clone first. Git returned:

```
fatal: unable to access 'https://github.com/joshmaurice/atrium/': Could not resolve host: github.com
```

I continued through GitHub's read-only interface, fetching the pre-brief and pinned source files. This is a source-only review, supplemented by an independently executed Node.js conversion probe—not a repository-runtime review. Node is `v22.16.0`; `pnpm` is unavailable.

I also compared the commits: the changes from `84542c73` (PROD) and `f42b5fe` to the reviewed commit are confined to `devtasks/`. The application code is unchanged.

## Overall assessment

I would ship `add-check` as a separate, urgent first round, exactly as RA-L1(a) proposes—but I would revise its acceptance rules before implementation.

The most serious issue is that A2's finite-number check is insufficient to guarantee finite stored geometry. There is also an important resource-amplification question for anonymous avatar adds. In the copy round, the proposed treatment of behavior grants is not yet safe enough to implement without changing behavior graphs incorrectly.

The richer-add concept and the three-round split are otherwise reasonable. The two proposed D5 exceptions—dropping accessor metadata and breaking material sharing—deserve narrower treatment, particularly for Undo, whose semantic expectations differ from Copy.

## Must-fix

### M1 — A2 permits finite JSON numbers that become non-finite geometry

References: `devtasks/PREBRIEF-richer-add-copy.md:414–429`; `packages/som/src/SOMDocument.js:806–825`.

Severity: must-fix\
Status: REPRODUCED for the numeric conversion; downstream serialization/join impact INFERRED, not run.

Scenario: A malicious `add` supplies a POSITION array containing `1e39`. The proposed A2 checks accept it because it is a finite JavaScript number, the array has a multiple-of-three length, and it has at least three vertices. But `ingestNode` converts the array to `Float32Array`; that coordinate becomes `Infinity`.

I ran this isolated proof under Node 22:

```
const values = [0, 0, 0, 1e39, 0, 0, 0, 1, 0];
const a2Accepts =
  values.length >= 9 &&
  values.length % 3 === 0 &&
  values.every(Number.isFinite);

const stored = new Float32Array(values);

console.log(a2Accepts);
console.log(stored[3]);
console.log([...stored].every(Number.isFinite));
console.log(JSON.stringify([...stored]));
```

Actual output:

```
true
Infinity
false
[0,0,0,null,0,0,0,1,0]
```

This defeats the intended guarantee that an accepted `add` stores valid finite POSITION data. I have not demonstrated that this particular payload reproduces §2.3's `RangeError`; that requires running the real writer and session handler. But it already contradicts the specified storage invariant.

Recommendation: Check representability after conversion or check every numeric geometry component against `[-Number.MAX_VALUE_FOR_FLOAT32, +Number.MAX_VALUE_FOR_FLOAT32]`, preferably with a stricter operational coordinate limit appropriate for Atrium. Apply the same rule to NORMAL, and to richer-add UV and color components where float conversion occurs. Test that an accepted descriptor still contains only finite values after `ingestNode`, then serialize and reload it.

Proving test: Through the real `attachSessionHandlers`, send a valid-shape avatar and world `add` with POSITION `1e39`; both must be refused before mutation, and subsequent joins and saves must succeed.

### M2 — The anonymous avatar allowance remains too expensive even after A2/A3

References: pre-brief §3 RA-L4, §4 A2/A3; `packages/server/src/session.js:1226–1420`; `packages/server/src/world.js:151–165`; `packages/server/src/session.js:917–937`.

Severity: must-fix\
Status: INFERRED from the admission and serialization paths.

Scenario: RA-L4(a) correctly prevents visitors from using the richer fields, but `add-check` still permits them to submit an arbitrary mesh conforming to A2/A3. A legal message can approach the 1 MiB socket cap. An avatar is then included in each newcomer's world serialization and dump. With several visitors, accepted geometry amplifies the CPU, memory, serialized document size and join latency, even if all coordinates are valid.

This is distinct from the currently reported crash: rejecting malformed data does not by itself limit the cost of valid untrusted data. The server currently uses a client-supplied avatar descriptor rather than generating a fixed server-side capsule.

Recommendation: Make avatar geometry a deliberately narrow, separately bounded subset. Ideally generate the avatar server-side; otherwise enforce a first-party-compatible avatar profile (one primitive, a suitably small vertex/index budget, minimal material, tightly limited extras, and a small message-byte ceiling). Measure the actual generated capsule first rather than guessing its counts.

Proving test: At the maximum allowed simultaneous anonymous sessions, send the largest admissible avatar from each, repeatedly join newcomers, and measure p95 serialization time, dump bytes and memory. Existing palette/owner adds should retain their separate limits.

### M3 — CP-L5's “drop external grants” can invalidate or retarget the pasted behavior

References: pre-brief `CP-L5` at lines 383–393; `apps/client/src/edit-duplicate.js:289–309`; `packages/behaviors/src/behavior-spec.js:773–835, 910–940`.

Severity: must-fix\
Status: CONFIRMED IN THE SOURCE for the indexed-reference model; the particular paste failure is INFERRED because copy is not implemented.

Scenario: Existing behavior graphs refer to objects through an indexed `nodeMap`. For example:

```
source nodeMap = [self, door, light]
pointer       = /nodes/2/rotation
```

If paste remaps `self` and then simply drops the grants for `door` and `light`, the new `nodeMap` has fewer entries. The pointer still refers to index 2, which is now out of range. `behaviorCheck` rejects literal references outside the new map. In other cases, deleting intermediate entries can silently make an old index refer to a different object.

The same problem extends to `targets`, `animations[].object`, and template parameters. Merely setting `enabled: false` prevents execution, but does not make the graph internally valid.

Recommendation: Define CP-L5 as a graph-aware transformation, not an array filter. My preferred initial behavior is:

- If every reference is to the copied object, remap it and preserve the disabled behavior.
- If external grants or references exist, refuse copying the behavior (or copy the object without its behavior with a clear, explicit warning). Preserve the mesh/object itself if possible.
- Later, add a dedicated grant-rebinding UI and a complete graph remapper.

Do not keep unresolved grants unless the user explicitly chooses an inert representation and the server checker accepts it safely.

Proving test: Cover `nodeMap` references at indices 0, 1 and 2, literal and wired pointers, animation references, template targets and `targets`. The destination graph must either pass the real behavior validator with correct bindings or be explicitly omitted/refused—never silently retargeted.

## Should-fix

### S1 — `add-check` is not yet a complete no-silent-loss contract

References: pre-brief §4 A1–A6; `packages/protocol/src/schemas/add.client.json:13–57`; `packages/som/src/SOMDocument.js:781–852`.

Severity: should-fix\
Status: CONFIRMED IN THE SOURCE.

The protocol accepts `node.extensions` as an object, but `ingestNode` never reads it. An owner can therefore send an `add` with node extensions, receive an accepted/broadcast `add`, and have that data silently disappear from the stored SOM.

A2/A3 validate mesh and material, but do not address this existing node-level lossy field. It matters to the stated D5 discipline even if extensions are not yet first-party input.

Recommendation: Either refuse nonempty `node.extensions` at the server and client boundary or explicitly support a subset. Apply the same audit to every other schema-accepted field not consumed by `ingestNode`. Do not let an accepted broadcast imply persistence of fields the SOM discards.

Proving test: Schema-valid `add` carrying `{extensions:{EXT_probe:{...}}}` must get an explicit refusal, unless the round intentionally adds a supported preservation path. Check server SOM, broadcast, and reload, not only validator status.

### S2 — `add` is the critical public hole, but not the only path to questionable material/world state

References: `packages/server/src/send-policy.js:57–68, 1405–1416, 1727–1758`; `packages/server/src/world.js:480–495, 638–655`; `packages/server/src/http-routes.js:699–763`.

Severity: should-fix\
Status: CONFIRMED IN THE SOURCE.

`send` already permits material edits. Its value policy checks shapes and finiteness, but not glTF-compatible ranges. For example, it accepts finite values outside `[0,1]` for `metallicFactor`, `roughnessFactor` and color components. That is primarily an owner-writable path, not the anonymous `add` bypass, and I have not shown it crashes serialization.

`createWorld` and `createWorldFromDocument` also load geometry and materials through their glTF readers without a corresponding A2/A3 validation stage. Their existing healers focus on other data (including IDs and behaviors), not mesh values. Bad legacy/imported data may therefore require its own defensive load policy.

One useful correction: PUT `/api/worlds/:id` does not accept a client-supplied whole glTF document. It serializes the live server-authoritative world, excluding avatars. That route is not the raw-document injection path suggested in the review questions.

Recommendation: Keep Round 1 tightly focused on the anonymous/public `add` defect, but record a separate invariant audit for `send` and both world loaders. Share material-range helpers where appropriate and test malformed persisted documents fail safely at load rather than poisoning active sessions.

### S3 — RA-L2(c)'s accessor/buffer metadata exception is risky for Undo

References: pre-brief `RA-L2` lines 269–299; `apps/client/src/edit-duplicate.js:106–122, 183–216, 334–353`.

Severity: should-fix\
Status: CONFIRMED IN THE SOURCE for the current lossless gate; future impact INFERRED.

Accessor and buffer names/extras are not currently displayed by Atrium. But they may contain provenance or pipeline metadata that later export, import or tooling expects. The proposed exception allows a user to delete an object and Undo it while quietly removing those fields.

That is a different contract from copying a visible mesh into a new world. Copy can reasonably offer a lossy conversion; Undo ordinarily means restoring what was removed.

Recommendation: Choose RA-L2(a) initially, or split semantics: permit explicitly lossy Copy/Duplicate with a warning, but make Undo restore refuse deletion of an object whose metadata it cannot preserve. I would not describe metadata loss as costing “nothing.” Keep the decision explicit and measurable with fixture cases that carry names and extras.

### S4 — RA-L3(a)'s material-sharing exception changes Undo semantics

References: pre-brief `RA-L3` lines 301–311; `packages/som/src/SOMDocument.js:834–844`; `apps/client/src/edit-duplicate.js:183–216`.

Severity: should-fix\
Status: CONFIRMED IN THE SOURCE.

The current `ingestNode` creates a fresh material per primitive. A duplicate being independent is fine; a pasted object being independent is desirable. Restoring a deleted object is more delicate.

Consider two columns sharing the material `Marble`. Delete one column, edit the remaining column's shared material, then Undo the deletion. The restored column uses a newly created material with the old color, and future shared edits no longer affect it. Even within one node, multiple primitives that shared one material lose that sharing.

The pre-brief recognizes the loss, but a note alone does not maintain the meaning of Undo.

Recommendation: Allow fresh materials for Copy and Duplicate. For Undo, either preserve the original material relationship through a reviewed identity mechanism, or refuse Undo-eligible deletion where a shared material cannot be faithfully restored. RA-L3(b) is safer than (a) for the current D5 contract, though less convenient.

### S5 — Richer attribute support needs type/normalization semantics, not just a wider allowlist

References: pre-brief `RA-L2(c)`, §5; `apps/client/src/edit-duplicate.js:106–165, 183–216`; `packages/som/src/SOMDocument.js:806–828`.

Severity: should-fix\
Status: CONFIRMED IN THE SOURCE for the current assumptions; richer-add behavior INFERRED.

The existing accessor checker is specialized for FLOAT `VEC3` POSITION/NORMAL. `TEXCOORD_0/1` require `VEC2`; `COLOR_0` can be `VEC3` or `VEC4`, and loaded glTF files can use normalized integer color accessors. Copying raw normalized bytes as Float32 without interpreting normalization would change colors (for example, `255` versus `1.0`).

Likewise, the current index checker doesn't fully constrain the source accessor's scalar/type semantics; the proposed client mirror must catch anything that a richer server would refuse.

Recommendation: Specify each attribute's accepted source type, array shape, normalized handling and wire representation. Either convert normalized data deliberately (with documented numerical fidelity) or refuse it; never silently reinterpret it. Update `buildDescriptor`, `materialProblem`, `meshProblem`, and `prepareRestore` together.

Rendering: The upstream `@gltf-transform/view` implementation has paths for emissive, BLEND, double-sided and vertex colors. That is encouraging, but I did not run Atrium's pinned version in a browser. §5's four render checks remain necessary; emissive should be described as self-illuminated, not automatically a bloom/glow effect.

### S6 — CP-L3/L4 must not present client-claimed provenance as authenticated credit

References: pre-brief `CP-L3` lines 362–375, `CP-L4` lines 377–381; `packages/server/src/send-policy.js:160–203` (current extras checks).

Severity: should-fix\
Status: INFERRED.

The proposed `origin.creator` and `origin.world` values are set by a client. A destination server that checks only UUID/date syntax cannot know whether the creator actually made that object. A malicious world or paste client can claim any valid user ID.

C4 calls this “credit, not proof,” which is a valid product choice, but a panel displaying a resolved person's name without qualification could imply verification.

Recommendation: Treat these as claimed attribution in both data and UI. Preserve and display any trusted source information the server itself can establish separately; never overwrite a verified field with a claimed one. Keep the new ID-resolution route narrowly scoped to information already public, and ensure it does not reveal private world metadata.

### S7 — CP-L6 needs a cross-origin safety and compatibility policy

References: pre-brief `CP-L6` lines 394–400; `packages/server/src/send-policy.js:250–275, 1379–1384`; `packages/client/src/model-spec.js:76–136`; `packages/renderer-three/src/model-bridge.js:94–103`.

Severity: should-fix\
Status: CONFIRMED IN THE SOURCE for URL acceptance/resolution; future fetch scenario INFERRED.

Turning `/assets/library/model.glb` into an absolute URL against the source world's origin preserves its meaning. But a hostile source world can supply a model pointing to an arbitrary HTTPS host that passes the current URL-form checks. Pasting can then trigger a request from the destination owner's browser, potentially disclosing that browser's network presence to the remote host or failing due to CORS.

There is also a compatibility issue: a root-relative URL on an HTTP-only development origin becomes an `http://` absolute URL, which the existing model URL rules refuse.

Recommendation: Capture the source origin when copying, revalidate the resolved URL before paste, clearly display the external host and require confirmation for cross-origin fetches. Keep existing model-fetch budgets and redirect/dependency checks. If the source cannot produce a permitted HTTPS URL, refuse with a clear explanation. Do not silently rewrite it against the destination server.

### S8 — CP-L2 must snapshot the clipboard completely at Copy time

References: pre-brief `CP-L2` lines 354–360, §6; `apps/client/src/edit-duplicate.js:183–216, 320–353`; `packages/client/src/AtriumClient.js:1533–1562`.

Severity: should-fix\
Status: INFERRED.

When a visitor copies an object and teleports, the client's SOM and model URL base change. If the clipboard retains a node/SOM object and calls `buildDescriptor` only at Paste time, it could use stale or disposed state or resolve the model URL against the wrong world.

Recommendation: Build and deep-clone the permitted descriptor at Copy, capture source world ID/base URL then, and retain no live SOM references. At Paste, apply a new name/objectId, credit and behavior transformation, then recompute the complete outgoing message byte count. Treat a failed paste as not consuming the clipboard.

## Nits

N1 — “Emissive copy glows” is too strong. In `devtasks/PREBRIEF-richer-add-copy.md:467`, call it “renders emissive/self-illuminated” unless the scene has a separately tested bloom effect. Status: CONFIRMED IN THE SOURCE for the document wording; rendering untested.

N2 — Specify byte units and defaults precisely. In `RA-L5`, define 16 KiB as UTF-8 `JSON.stringify` bytes; say whether omitted material factors/defaults are accepted, and whether the maximum applies before or after clipboard credit insertion. Status: CONFIRMED IN THE SOURCE for current underspecification.

## Decision recommendations

| Decision | My choice                                  | Reason                                                                                                                      |
| -------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| RA-L1    | (a)                                        | Fix public `add` first; don't wait for richer-add.                                                                          |
| RA-L2    | (a), or (c) only for explicitly lossy Copy | Keep D5 strict for Undo; avoid silent accessor/buffer metadata loss.                                                        |
| RA-L3    | (b) for now                                | Independent copies are fine; Undo should not silently destroy material sharing.                                             |
| RA-L4    | (a), with tighter avatar budgets           | Correct least-privilege direction, insufficient resource cap by itself.                                                     |
| RA-L5    | (a) with amendments                        | Define UTF-8 byte measurement, numeric conversion representability and attribute typing.                                    |
| RA-L6    | (a)                                        | Three rounds is a sensible review boundary; subtree copying deserves its own brief.                                         |
| CP-L1    | (a)                                        | Inspect is clearer than introducing a right-click-only gesture; suppress `activate` and render graph text safely.           |
| CP-L2    | (a)                                        | In-memory clipboard is simple and appropriate; snapshot at Copy time.                                                       |
| CP-L3    | (a), qualified                             | IDs are useful, but call them claimed attribution unless independently verified.                                            |
| CP-L4    | (a), qualified                             | Validate form/bounds, but explicitly preserve the “not proof” distinction.                                                  |
| CP-L5    | Modify (a)                                 | Disabled is right; naive grant deletion is unsafe. Refuse/omit behavior with external refs until complete remapping exists. |
| CP-L6    | (a), with host confirmation                | Absolute source URLs preserve semantics, but need CORS/HTTPS/error and hostile-origin handling.                             |
| CP-L7    | (a)                                        | Put the notice both in Inspect and at the public-visibility setting.                                                        |

## First-party `add` and ingress audit

I checked the relevant constructors and source paths against the proposed initial A2/A3 rules. These are source compatibility assessments, not runtime acceptances.

| Sender/path                     | A2/A3 expectation                                                                                  | Relevant source                                         |
| ------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Avatar capsule                  | Should pass ordinary geometry/material rules; separate low-budget avatar profile needed            | `packages/renderer-three/src/geometry-utils.js:119–143` |
| Palette primitives              | Should pass; POSITION/NORMAL/indices and three material factors                                    | `geometry-utils.js:17–27, 150–157`                      |
| Teleporter pad                  | Should pass; generated ring with POSITION/NORMAL/indices and allowed material                      | `geometry-utils.js:262–288`                             |
| Duplicate                       | Existing eligible objects should pass; legacy edge cases need client mirror and explicit rejection | `apps/client/src/edit-duplicate.js:138–165, 320–332`    |
| Undo restore                    | Existing eligible objects should pass; D5 fidelity issues remain                                   | `edit-duplicate.js:334–353`                             |
| Library placement               | No inline mesh, so A1 should allow it                                                              | `apps/client/src/library-catalog.js` and placement path |
| Models-by-URL placement         | No inline mesh, so A1 should allow it                                                              | `send-policy.js:1379–1384`                              |
| Protocol Inspector              | The default add template is meshless; user-edited raw input must face server validation            | `tools/protocol-inspector/index.html`                   |
| Direct WebSocket/console client | Must be treated as arbitrary untrusted `add` input                                                 | `session.js:1226–1420`                                  |

A4 placement is right in principle: after the existing authorization and transform rules, and before the avatar displayName overwrite and `world.addNode`, with a caught checker exception refusing the message. An accepted `add` should have no remaining path for `ingestNode` to throw on attacker-controlled fields. M1 and S1 are examples of why the checker must be specified against the actual conversion and actual stored fields, not only a JSON shape.

A malformed broadcast also reaches already-connected clients through `_onAdd` → `SOMDocument.ingestNode` (`AtriumClient.js:1533–1562`). I did not run a browser/Three.js reproduction; it should be included in the Round 1 regression suite to confirm no client crash or desync.

## Independent probe

I wrote a further local-only integration probe in the style of `devtasks/spike-richer-add/`. It imports the real `attachSessionHandlers`, `createWorld` and `SOMDocument`, constructs an ephemeral localhost WebSocket server, sends a Float32-overflow mesh, attempts serialization and another join, and checks whether a node-level extension survives ingestion.

Download p7-add-boundary-probe.mjs

The file is 78 lines and passed `node --check`. Its integration body was not run because the repository and dependencies could not be installed here; I am not presenting predicted results as observed results.

For the reproducible dependency-free arithmetic part, I executed:

```
node /mnt/data/atrium-float32-proof.mjs
```

Output:

```
A2 shape + finite: true
Float32 POSITION[3]: Infinity
stored all finite: false
JSON of array after conversion: [0,0,0,null,0,0,0,1,0]
U16 truncates 65536: 0
```

Download the isolated proof

The last line is an independent illustration of why index range checking matters; A2's proposed index bounds already address that particular Uint16 wrap case.

## What I ran and could not run

| Item                                 | Result                                                    |
| ------------------------------------ | --------------------------------------------------------- |
| `git clone` and pinned checkout      | Failed: DNS resolution for github.com                     |
| Pinned source retrieval              | Succeeded through GitHub read-only fetches                |
| Commit comparison                    | Succeeded; changed files since PROD are under `devtasks/` |
| Node version                         | `v22.16.0`                                                |
| `pnpm install`                       | Not run; `pnpm` unavailable and no clone                  |
| `packages/protocol` tests            | 0 executed; pass/fail count unknown                       |
| `packages/som` tests                 | 0 executed; pass/fail count unknown                       |
| `apps/client` Duplicate/Undo tests   | 0 executed; pass/fail count unknown                       |
| `packages/server` avatar test        | 0 executed; pass/fail count unknown                       |
| `packages/server` edit-plumbing test | 0 executed; pass/fail count unknown                       |
| `p1`–`p5` requested probes           | Not run; no actual output to quote                        |
| Independent Float32 arithmetic probe | Executed, output quoted above                             |
| Independent real-package p7 probe    | Written and syntax-checked; not executed                  |
| Browser rendering acceptance         | Not run                                                   |
| PROD/DEV access, pushes, PRs         | None                                                      |

The pre-brief reports that its author ran p1–p6, including the existing anonymous-avatar join failure. I inspected those probe sources, but their reported fixture counts and p4 failure are not my test results.

## Release recommendation

I would revise §4 and proceed with Round 1 (`add-check`) independently, treating it as a security fix. The release gate should include an actual failing-before/passing-after p4, the new Float32 counterexample, a malformed broadcast client check, an anonymous-avatar size/load test, and real first-party descriptor acceptance tests.

Round 2 should settle the D5 distinction between Copy/Duplicate and Undo before broadening the descriptor. Round 3 should settle CP-L5's graph-reference policy and CP-L6's source-host fetching policy before introducing visitor copying.

Bottom line: The planned order is sound, and the reported PROD defect merits prompt repair. But A2 currently accepts data that `ingestNode` cannot keep finite, and the copy/Undo semantics need tighter guarantees. I would not approve Rev 0.1 unchanged for implementation.
