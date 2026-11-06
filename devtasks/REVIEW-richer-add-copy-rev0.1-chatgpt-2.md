<!-- Outside review (ChatGPT) of PREBRIEF-richer-add-copy Rev 0.1 at 923bd444, source-only (clone failed on DNS).
     Pasted by the operator on 2026-11-05 evening. A SECOND review of Rev 0.1: it was given the old prompt
     (OUTSIDE-REVIEW-PROMPT-richer-add-copy.md), not OUTSIDE-REVIEW-PROMPT-richer-add.md. Triaged in
     PREBRIEF-richer-add.md Rev 1.3 §7 and PREBRIEF-richer-add-copy.md Rev 0.4 §9. -->

# Atrium — Richer Add & Copy Design Review

Reviewed target: `923bd444305be4067fc589f99c77276a35dbf6c0`\
Specification: `PREBRIEF-richer-add-copy.md`, DRAFT Rev 0.1\
Scope: Design review of add-check, richer add, and cross-world copying. Read-only.

### 1. Repository access

The clone failed. I attempted it first, as requested:

```
Cloning into '/mnt/data/atrium-richer-add-review'...
fatal: unable to access 'https://github.com/joshmaurice/atrium/':
Could not resolve host: github.com
```

The environment has Node.js `v22.16.0`, but `pnpm` is not installed.

I retrieved the review instructions through the GitHub connection. I'll use that connection to examine the pinned specification and source files. This is therefore a source-only review, not an executable checkout. I won't claim any tests passed unless I actually run them.

### 2. Verdict: CHANGES REQUESTED

The overall three-round approach is sound, and I would ship `add-check` independently before implementing `richer-add` or `copy-objects`.

However, the draft needs several changes before it becomes the implementation contract. In particular, the add-check must account for Float32 overflow and the cost of untrusted avatar geometry. The richer-add contract needs explicit rules for normalized vertex attributes. Copying behaviours across worlds needs a more precise rule for removing external references.

Findings below concern the design at the pinned commit. They are not defects in an already implemented richer-add or copy feature. Evidence labels distinguish source-confirmed behavior from proposed-code risks.

### 3. Must-fix findings

#### M1 — Finite geometry values can overflow during ingestion

Must-fix — REPRODUCED (conversion); downstream serialization impact INFERRED

References: [PREBRIEF §4 A2, L419–424](https://github.com/joshmaurice/atrium/blob/923bd444305be4067fc589f99c77276a35dbf6c0/devtasks/PREBRIEF-richer-add-copy.md?utm_source=chatgpt.com#L419-L424), [SOMDocument.js:803–817](https://github.com/joshmaurice/atrium/blob/923bd444305be4067fc589f99c77276a35dbf6c0/packages/som/src/SOMDocument.js?utm_source=chatgpt.com#L803-L817)

A2 requires finite numbers for POSITION and NORMAL, but `ingestNode` converts them into `Float32Array`. A finite JavaScript double can overflow during conversion.

I ran this independent Node.js probe:

```
const floats = [0, 0, 0, 1e100, 0, 0, 0, 1, 0];
const allowed = floats.length >= 9 &&
  floats.length % 3 === 0 &&
  floats.every(Number.isFinite);
const converted = new Float32Array(floats);

console.log('A2 position allowed:', allowed);
console.log('Float32 position[3]:', converted[3]);
console.log('Converted floats all finite:',
  converted.every(Number.isFinite));
console.log('Array JSON:',
  JSON.stringify(Array.from(converted)));
```

Output:

```
A2 position allowed: true
Float32 position[3]: Infinity
Converted floats all finite: false
Array JSON: [0,0,0,null,0,0,0,1,0]
```

Thus, a descriptor satisfying the proposed A2 numerical rule can become non-finite inside the document.

The exact effect on `NodeIO.writeJSON()` and a subsequent join requires an integration test. I did not reproduce a full-world serialization failure for this case.

Required: Validate the values after Float32 conversion, or explicitly require finite Float32-representable values. Include boundary vectors and a real `add → serialize → reload → join` test.

#### M2 — The avatar exception still permits expensive anonymous geometry

Must-fix — CONFIRMED IN THE SOURCE

References: [session.js:29–31](https://github.com/joshmaurice/atrium/blob/923bd444305be4067fc589f99c77276a35dbf6c0/packages/server/src/session.js?utm_source=chatgpt.com#L29-L31), [session.js:1265–1281](https://github.com/joshmaurice/atrium/blob/923bd444305be4067fc589f99c77276a35dbf6c0/packages/server/src/session.js?utm_source=chatgpt.com#L1265-L1281), [PREBRIEF RA-L4/L5](https://github.com/joshmaurice/atrium/blob/923bd444305be4067fc589f99c77276a35dbf6c0/devtasks/PREBRIEF-richer-add-copy.md?utm_source=chatgpt.com#L313-L329)

Although RA-L4 excludes richer fields from avatars, A2 still allows up to 64 primitives and substantial geometry per `add`. The only overall message ceiling is 1 MiB.

An anonymous visitor is allowed to add an avatar without owner permission. Multiple visitors could therefore populate a world with individually valid but expensive meshes, forcing later joins to serialize and transfer them.

The normal first-party capsule is much smaller. There is no reason to grant anonymous avatars the same geometry budget as owner-created world objects.

Required: Add an avatar-specific budget: ideally a single primitive, small vertex/index limits, and a total geometry byte ceiling based on the actual capsule. Test rejection of large but otherwise valid avatar adds.

Also establish a longer-term per-world resource budget. The 1 MiB inbound message cap is not a bound on accumulated world size or outbound `som-dump` cost.

#### M3 — RA-L2 can corrupt normalized UVs and vertex colours

Must-fix for richer-add — INFERRED from the proposed widening and current builder

References: [PREBRIEF RA-L2, L269–299](https://github.com/joshmaurice/atrium/blob/923bd444305be4067fc589f99c77276a35dbf6c0/devtasks/PREBRIEF-richer-add-copy.md?utm_source=chatgpt.com#L269-L299), [edit-duplicate.js:115–165](https://github.com/joshmaurice/atrium/blob/923bd444305be4067fc589f99c77276a35dbf6c0/apps/client/src/edit-duplicate.js?utm_source=chatgpt.com#L115-L165), [edit-duplicate.js:183–216](https://github.com/joshmaurice/atrium/blob/923bd444305be4067fc589f99c77276a35dbf6c0/apps/client/src/edit-duplicate.js?utm_source=chatgpt.com#L183-L216)

glTF permits UV and colour attributes stored as normalized integer accessors, as well as floating-point accessors.

The current descriptor builder uses `Array.from(acc.getArray())`, which returns the accessor's underlying values. Simply adding `COLOR_0`, `TEXCOORD_0` and `TEXCOORD_1` to that path, then reconstructing Float32 accessors, would not preserve normalized integer values.

For example, a normalized unsigned-byte colour `[128,64,32,255]` represents approximately `[0.502,0.251,0.125,1]`, not `[128,64,32,255]`.

I confirmed that numerical distinction with a standalone Node probe; no proposed richer-add implementation exists to execute.

Required: Specify accepted accessor types, component types, normalization and dimensions. Either convert normalized integer values to their intended floating-point values, or refuse attributes whose representation cannot be preserved. Test VEC3 and VEC4 colours, UVs, and normalized integer accessors.

The browser acceptance tests in §5 are necessary but should cover these cases explicitly.

#### M4 — Dropping behaviour grants can invalidate the graph

Must-fix for copy-objects — CONFIRMED IN THE SOURCE (index dependency); failure scenario INFERRED

References: [PREBRIEF CP-L5, L383–392](https://github.com/joshmaurice/atrium/blob/923bd444305be4067fc589f99c77276a35dbf6c0/devtasks/PREBRIEF-richer-add-copy.md?utm_source=chatgpt.com#L383-L392), [behavior-spec.js:773–828](https://github.com/joshmaurice/atrium/blob/923bd444305be4067fc589f99c77276a35dbf6c0/packages/behaviors/src/behavior-spec.js?utm_source=chatgpt.com#L773-L828), [behavior-spec.js:910–940](https://github.com/joshmaurice/atrium/blob/923bd444305be4067fc589f99c77276a35dbf6c0/packages/behaviors/src/behavior-spec.js?utm_source=chatgpt.com#L910-L940)

CP-L5 proposes dropping grants to other objects when a behaviour is pasted into another world.

The problem is that graph pointers refer to indices in `nodeMap`; animation operations also index the animations table.

Example:

```
nodeMap = [self, otherObject]
graph pointer = /nodes/1/translation
```

Removing `otherObject` from `nodeMap` leaves `/nodes/1` out of range. If entries are removed from the middle of a larger table, existing indices can also change meaning.

Simply filtering grants therefore isn't sufficient.

Required: Define an actual graph transformation. It must either remove or repair dependent operations, preserve necessary indices, or refuse to paste behaviours whose external dependencies cannot safely be transformed.

The behaviour must pass `behaviorCheck()` with the new object ID after transformation. Test external pointer targets, animation targets, template parameters and mixed self/external references.

A disabled but malformed behaviour should not be stored merely because it will not immediately run.

### 4. Should-fix findings

#### S1 — `send` accepts material values that the proposed `add` refuses

Should-fix — CONFIRMED IN THE SOURCE

References: [send-policy.js:1405–1417](https://github.com/joshmaurice/atrium/blob/923bd444305be4067fc589f99c77276a35dbf6c0/packages/server/src/send-policy.js?utm_source=chatgpt.com#L1405-L1417), [PREBRIEF A3, L425–429](https://github.com/joshmaurice/atrium/blob/923bd444305be4067fc589f99c77276a35dbf6c0/devtasks/PREBRIEF-richer-add-copy.md?utm_source=chatgpt.com#L425-L429)

`materialValueOk()` checks numeric finiteness, but not the proposed `[0,1]` limits for metallic, roughness or colour factors.

For example, a `send` with `metallicFactor: 7` passes that source predicate, while the proposed A3 refuses it on `add`.

Consequently, a property edited through the existing `send` path may make an object impossible to restore through the stricter `add` path.

Recommendation: Align material value ranges across `send`, `add`, Duplicate and Undo, with tests for legacy out-of-range values. The load healers should have an explicit policy for them as well.

#### S2 — `node.extensions` remains silently discardable

Should-fix — CONFIRMED IN THE SOURCE

References: [add.client.json:17–52](https://github.com/joshmaurice/atrium/blob/923bd444305be4067fc589f99c77276a35dbf6c0/packages/protocol/src/schemas/add.client.json?utm_source=chatgpt.com#L17-L52), [SOMDocument.js:781–852](https://github.com/joshmaurice/atrium/blob/923bd444305be4067fc589f99c77276a35dbf6c0/packages/som/src/SOMDocument.js?utm_source=chatgpt.com#L781-L852)

The existing node schema permits an `extensions` object, but `ingestNode` doesn't consume it. The proposed A2/A3 mesh checker does not address that node-level field.

That leaves a case in which the server accepts an `add` while storing less information than the sender supplied—contrary to the broad losslessness claim in §8.

Recommendation: Reject node-level extensions until the protocol can carry them faithfully. Also restrict `format` to the supported representation rather than leaving it as an arbitrary string.

#### S3 — The credit is not reliable attribution

Should-fix — INFERRED from CP-L3/CP-L4

References: [PREBRIEF CP-L3/CP-L4, L362–381](https://github.com/joshmaurice/atrium/blob/923bd444305be4067fc589f99c77276a35dbf6c0/devtasks/PREBRIEF-richer-add-copy.md?utm_source=chatgpt.com#L362-L381)

The server accepts client-claimed origin IDs and dates after checking only their form. A client can therefore attach another person's ID as the claimed creator. Once copied onward, that claim propagates.

The document explicitly calls this credit rather than proof, which is an important distinction. But the proposed `creator` label still risks implying verified authorship.

Also, a world's owner may not be the author of the mesh it contains.

Recommendation: Use terminology such as claimed source world or copied from, and show the attribution as unverified. Distinguish the original creator, when actually known, from the owner of the source world.

The proposed public ID-resolution endpoint must also avoid exposing information about private worlds merely because someone supplies their IDs.

#### S4 — Cross-world model URL trust needs a complete rule

Should-fix — CONFIRMED IN THE SOURCE (current URL policy); proposed paste behavior INFERRED

References: [PREBRIEF CP-L6, L394–400](https://github.com/joshmaurice/atrium/blob/923bd444305be4067fc589f99c77276a35dbf6c0/devtasks/PREBRIEF-richer-add-copy.md?utm_source=chatgpt.com#L394-L400), [model-spec.js:76–136](https://github.com/joshmaurice/atrium/blob/923bd444305be4067fc589f99c77276a35dbf6c0/packages/client/src/model-spec.js?utm_source=chatgpt.com#L76-L136), [model-fetch.js:55–62](https://github.com/joshmaurice/atrium/blob/923bd444305be4067fc589f99c77276a35dbf6c0/packages/client/src/model-fetch.js?utm_source=chatgpt.com#L55-L62)

Making root-relative URLs absolute against the source server is the correct default, but the contract should cover:

- Revalidate the resolved absolute URL under `modelUrlProblem`; don't bypass the existing model restrictions.
- Keep the current credential-free, no-referrer and transfer-budget protections.
- Define how an HTTP development world behaves when conversion produces a non-HTTPS URL.
- Make it clear that pasting a model can initiate a fetch from a third-party source.
- Recognize library content as such only with appropriate catalog/source validation. A matching `/assets/library/…` path by itself is not proof of official library origin.

The source server should be derived from the live connection context, not from an untrusted credit field.

#### S5 — Accessor and buffer metadata is not necessarily disposable

Should-fix — INFERRED

References: [PREBRIEF RA-L2, L278–299](https://github.com/joshmaurice/atrium/blob/923bd444305be4067fc589f99c77276a35dbf6c0/devtasks/PREBRIEF-richer-add-copy.md?utm_source=chatgpt.com#L278-L299)

The document is correct that accessor and buffer names usually have no rendering effect. But arbitrary `extras` can carry application-specific metadata.

That data might matter to downstream export, asset processing, or future tools even when Atrium doesn't currently display it.

This is particularly consequential for Undo: restoring a deleted object is ordinarily expected to recover its original data, not merely its visible appearance.

Recommendation: I'd accept the proposed exception for nonessential names, but not automatically for nonempty accessor/buffer extras. Either preserve them, refuse such objects, or give the user an explicit lossy-operation warning.

#### S6 — Copy needs a snapshot and failure lifecycle

Should-fix — INFERRED from §6

References: [PREBRIEF §6, L474–481](https://github.com/joshmaurice/atrium/blob/923bd444305be4067fc589f99c77276a35dbf6c0/devtasks/PREBRIEF-richer-add-copy.md?utm_source=chatgpt.com#L474-L481), [edit-undo.js:280–350](https://github.com/joshmaurice/atrium/blob/923bd444305be4067fc589f99c77276a35dbf6c0/apps/client/src/edit-undo.js?utm_source=chatgpt.com#L280-L350)

The clipboard should hold an immutable, plain-data descriptor captured at Copy time—not a reference to a live SOM node that may be disposed when the user teleports.

The copy contract should also define what happens if a paste is refused, if the world changes during a pending paste, or if the original object changes after copying.

Existing structure tracking and Undo have established request/answer lifecycles that should be reused.

### 5. Nits and test gaps

N1 — The avatar test must use what the client actually transmits. `buildAvatarDescriptor()` alone isn't the complete first-party avatar message. `AtriumClient.connect()` adds `extras.atrium.ephemeral = true`, and the server permits that exact marker. Test the connection-level descriptor as well as the builder. See [AtriumClient.js:595–670](https://github.com/joshmaurice/atrium/blob/923bd444305be4067fc589f99c77276a35dbf6c0/packages/client/src/AtriumClient.js?utm_source=chatgpt.com#L595-L670) and [session.js:170–190](https://github.com/joshmaurice/atrium/blob/923bd444305be4067fc589f99c77276a35dbf6c0/packages/server/src/session.js?utm_source=chatgpt.com#L170-L190).

N2 — Add an already-connected-client malformed-broadcast regression. The client receives `add` and calls the same `ingestNode`; the current path has no local validation before that call. Server rejection should prevent the situation, but test two already-connected clients to establish that malformed content is never broadcast. See [AtriumClient.js:1533–1557](https://github.com/joshmaurice/atrium/blob/923bd444305be4067fc589f99c77276a35dbf6c0/packages/client/src/AtriumClient.js?utm_source=chatgpt.com#L1533-L1557).

### 6. Decisions RA-L1–RA-L6 and CP-L1–CP-L7

| Decision | My choice        | Rationale                                                                                                              |
| -------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| RA-L1    | (a)              | Ship the live security fix by itself.                                                                                  |
| RA-L2    | Modified (c)     | Carry UVs/colours, but define normalization; preserve or refuse meaningful metadata.                                   |
| RA-L3    | (a), with caveat | Independent materials are appropriate for copies. Undo must warn that sharing changes, and this must be tested.        |
| RA-L4    | (a)              | Avatars get no richer fields; additionally impose a smaller geometry budget.                                           |
| RA-L5    | Modified (a)     | Add Float32 checks, avatar limits, safer cutoff bounds and resource-accounting rules.                                  |
| RA-L6    | (a)              | Keep the three-round split. Describe the single-object copy limitation prominently.                                    |
| CP-L1    | (a)              | Inspect mode is appropriate. Avoid accidentally treating hidden Edit-mode objects as normally visible visitor objects. |
| CP-L2    | (a)              | In-memory clipboard, storing a snapshot captured at Copy time.                                                         |
| CP-L3    | Modified (a)     | IDs are useful, but attribution is claimed rather than verified.                                                       |
| CP-L4    | (a)              | Form/bounds validation is sufficient for explicitly unverified credit.                                                 |
| CP-L5    | Modified (a)     | Disable behaviours and strip unsafe cross-world authorities, but repair or refuse affected graphs.                     |
| CP-L6    | Modified (a)     | Resolve against the actual source origin; revalidate and disclose external fetches.                                    |
| CP-L7    | (a)              | Put the notice in Inspect and beside visibility controls.                                                              |

I would not put subtree add into the same implementation as richer-add. The 13 fixture groups demonstrate a real limitation, but a subtree add changes identity, authorization, atomicity and rollback behavior enough to deserve its own contract.

### 7. What was verified about the other ingress paths

There are useful existing protections that the next revision should preserve.

The HTTP PUT route does not accept an arbitrary replacement world document. It serializes the server's live SOM; the client supplies only permitted metadata. That means PUT is not currently a second direct route for malicious geometry injection. See [http-routes.js:708–764](https://github.com/joshmaurice/atrium/blob/923bd444305be4067fc589f99c77276a35dbf6c0/packages/server/src/http-routes.js?utm_source=chatgpt.com#L708-L764).

`createWorldFromDocument()` reads saved glTF and applies ID/behaviour healing, but does not geometrically revalidate every stored mesh. That is a separate load-boundary limitation, not evidence of another public geometry-write endpoint.

For new network-supplied geometry, the primary path I confirmed remains `session.js → world.addNode → SOMDocument.ingestNode`. The placement described by A4—after transform checking and before `world.addNode`—is appropriate.

### 8. What I ran

Environment: Node.js `v22.16.0`; `pnpm` unavailable; repository clone failed on GitHub DNS resolution.

| Requested suite or probe     | Tests executed |
| ---------------------------- | -------------- |
| Protocol package             | 0              |
| SOM package                  | 0              |
| Client Duplicate/Undo        | 0              |
| Server avatar/edit-plumbing  | 0              |
| Original p1–p5 probes        | 0              |
| Independent numerical probes | 2 executed     |

Both independent probes ran successfully, but they are not substitutes for tests against the real Atrium packages. The results establish the Float32 conversion discrepancy and the risk of naïve normalized-colour copying; the proposed integration behavior still needs testing.

You can inspect or run the two small probes:

- Float32 validation probe
- Vertex normalization and behaviour-index probe

### 9. Release recommendation

Approve the overall architecture, request changes to the specification. I would make these the gates:

1. For `add-check`: address M1 and M2, reconcile S1, and test the real avatar/session path before releasing.
2. For `richer-add`: specify component types and normalized attribute conversion before coding; make metadata and material-sharing exceptions explicit.
3. For `copy-objects`: define the behaviour graph transformation, honest attribution semantics, model URL policy and clipboard lifecycle before implementation.

The strongest part of this pre-brief is the order: contain the publicly reachable defect first, widen the data representation second, and introduce cross-world copying only after the underlying `add` contract is dependable.

Final verdict: CHANGES REQUESTED. The split itself does not need a redesign, but the proposed contracts need the corrections above before implementation.