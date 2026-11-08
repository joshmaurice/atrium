# Atrium `subtree-add` — Outside Design Review

CHANGES REQUESTED

Reviewed commit: `2fbba08f7c7cc7562ca2f7d0c8760b25f06608c3`

Document: `devtasks/PREBRIEF-subtree-add.md`, DRAFT Rev 1.8

Code baseline: `70a30bd2e86f2d7d91d6b9f8e02b2d44f0f5f9e6`

Review type: Source-only, with independent Node.js payload probes.

The design is substantially developed, and I agree with its central architectural choices: one atomic tree message, version negotiation in both directions, message-local material references, and keeping the selection/parts work in the following round.

I found two must-fix resource-bound issues, plus several smaller contract and test issues. Neither must-fix requires reversing an operator decision. Both concern making the chosen limits effective against hostile inputs.

## Findings

### M1 — Must-fix: The 256-node shape check happens after recursive schema validation

CONFIRMED IN THE SOURCE — performance consequence INFERRED

References: [PREBRIEF:646–700](https://github.com/joshmaurice/atrium/blob/2fbba08f7c7cc7562ca2f7d0c8760b25f06608c3/devtasks/PREBRIEF-subtree-add.md?utm_source=chatgpt.com#L646-L700), [session.js:724–744](https://github.com/joshmaurice/atrium/blob/70a30bd2e86f2d7d91d6b9f8e02b2d44f0f5f9e6/packages/server/src/session.js?utm_source=chatgpt.com#L724-L744).

T2 places `subtreeShapeProblem` early in the `add` handler, before the per-member world lookups. That addresses the previous review's O(N × world-size) concern.

But the real inbound order is:

1. JSON parsing.
2. `messageDepth`.
3. Ajv schema validation.
4. The `add` handler, including permission checks.
5. T2's proposed 256-node shape check.

T8 makes the schema recursive through `$ref`. Consequently, a tree exceeding 256 members can force Ajv to visit tens of thousands of nodes before T2 refuses it.

Concrete input: I constructed a tree with 60,001 nodes, all at one generation below the root. Its serialized message is only 780,058 bytes, below both byte limits. Duplicate names mean T1 should eventually refuse it, but they do not prevent recursive schema validation.

This isn't proof of an unacceptable execution time; Ajv was unavailable for benchmarking. It does establish that the promised cheap first pass cannot protect the schema-validation work.

It also applies before the mutation gate, so a sender need not own a world to trigger that parsing and validation work.

Required change: Put a minimal, iterative subtree-count/depth preflight in `session.js`, after the existing message-depth guard but before recursive Ajv validation. It should stop as soon as it sees member 257 or generation 9. Keep T1's richer validation in the handler.

Add a test that instruments whether Ajv is reached for an oversized tree, not merely whether `objectIdInUse` is called.

### M2 — Must-fix: The limits permit 16,320 mesh primitives in one message

REPRODUCED payload construction — server resource impact INFERRED

References: [PREBRIEF:498–514](https://github.com/joshmaurice/atrium/blob/2fbba08f7c7cc7562ca2f7d0c8760b25f06608c3/devtasks/PREBRIEF-subtree-add.md?utm_source=chatgpt.com#L498-L514), [send-policy.js:2033–2035](https://github.com/joshmaurice/atrium/blob/70a30bd2e86f2d7d91d6b9f8e02b2d44f0f5f9e6/packages/server/src/send-policy.js?utm_source=chatgpt.com#L2033-L2035), [SOMDocument.js:781–873](https://github.com/joshmaurice/atrium/blob/70a30bd2e86f2d7d91d6b9f8e02b2d44f0f5f9e6/packages/som/src/SOMDocument.js?utm_source=chatgpt.com#L781-L873).

SA-L2 limits the tree to 256 nodes and 1,000,000 bytes. But R1 permits 64 primitives per mesh, and T2 doesn't specify an aggregate primitive budget.

A root plus 255 mesh children, each containing 64 minimal valid primitives, gives:

Nodes

# 256

Primitives

# 16,320

Message bytes

# 793,508

Each primitive has nine finite POSITION values, requiring one accessor. The tree respects the node count, generation limit, message-byte limit, per-mesh primitive limit, and geometry shape rules.

The proposed SOM implementation would create more than 16,000 primitives and accessors in response to one message. The client would likewise process that tree, and T4 adds repeated event-driven scans.

I couldn't measure the actual glTF-Transform allocation or processing time, so I am not claiming a demonstrated server stall. But this amplification is sufficiently large that the near-empty-node timing test in §5 is not an adequate resource proof.

Required change: Set an explicit aggregate per-message primitive/accessor budget, independently of member count and message bytes. Choose its value using a benchmark of the worst permitted density on the target hardware, and refuse it before `ingestNode`.

This is a per-message safety limit, not the deferred per-world resource budget.

### The independent probe

The following reproduces the two payload shapes, using Node 22 without repository dependencies:

```

const wide = {
  type: 'add', seq: 1,
  node: {
    name: 'root',
    children: Array.from({ length: 60000 },
      () => ({ name: 'x' }))
  }
}

const prim = {
  attributes: { POSITION: Array(9).fill(0) }
}

const dense = {
  type: 'add', seq: 1,
  node: {
    name: 'root',
    children: Array.from({ length: 255 },
      (_, i) => ({
        name: `p${i}`,
        mesh: {
          primitives: Array.from(
            { length: 64 }, () => prim
          )
        }
      }))
  }
}

for (const [name, message] of [
  ['wide', wide], ['dense', dense]
]) {
  console.log(
    name,
    Buffer.byteLength(JSON.stringify(message))
  )
}

```

Actual output:

```
wide 780058
dense 793508
```

These are payload-generation results, not tests of server acceptance or measured processing times.

### S1 — Should-fix: Reconcile S2's pre-gate source guard with the new validation order

CONFIRMED IN THE SOURCE — implementation hazard INFERRED

References: [session.js:165–169](https://github.com/joshmaurice/atrium/blob/70a30bd2e86f2d7d91d6b9f8e02b2d44f0f5f9e6/packages/server/src/session.js?utm_source=chatgpt.com#L165-L169), [session.js:1315–1345](https://github.com/joshmaurice/atrium/blob/70a30bd2e86f2d7d91d6b9f8e02b2d44f0f5f9e6/packages/server/src/session.js?utm_source=chatgpt.com#L1315-L1345), [PREBRIEF:677–700](https://github.com/joshmaurice/atrium/blob/2fbba08f7c7cc7562ca2f7d0c8760b25f06608c3/devtasks/PREBRIEF-subtree-add.md?utm_source=chatgpt.com#L677-L700).

The existing `addSetsAtriumSource(msg.node)` is invoked before the mutation gate. T2 moves the shape check to after the gate and says S2 must walk the tree.

If the worker simply makes `addSetsAtriumSource` recursive, the existing early call will inspect an unbounded tree before the shape check. That reintroduces preflight work T2 is meant to prevent, including for non-owners.

Specify the split explicitly: retain the cheap root/avatar S2 check in its existing early position, but defer the world subtree's recursive S2 check until after the cheap shape preflight. Verify that a child carrying `source`, including `null`, is still refused before mutation.

M1's proposed pre-Ajv count check would also reduce the risk, but the S2 call ordering should be unambiguous.

### S2 — Should-fix: The server does not enforce the stated 1,000,000-byte message cap

CONFIRMED IN THE SOURCE — future acceptance INFERRED

References: [PREBRIEF:364–368](https://github.com/joshmaurice/atrium/blob/2fbba08f7c7cc7562ca2f7d0c8760b25f06608c3/devtasks/PREBRIEF-subtree-add.md?utm_source=chatgpt.com#L364-L368), [session.js:30–33](https://github.com/joshmaurice/atrium/blob/70a30bd2e86f2d7d91d6b9f8e02b2d44f0f5f9e6/packages/server/src/session.js?utm_source=chatgpt.com#L30-L33).

The first-party client enforces 1,000,000 bytes. The server WebSocket enforces 1,048,576 bytes. T1/T2's new checks specify node count and depth, but not a separate server-side message-byte check.

I generated a legal-shaped, two-node geometry payload of 1,000,240 bytes—greater than the client limit but less than the server's socket limit.

Unless T2 adds a server-side byte check, a custom client can submit it.

The difference is only about 4.9%, so this is not by itself a significant new DoS claim. It is nevertheless a mismatch with SA-L2's stated contract.

Either explicitly enforce 1,000,000 bytes server-side or describe 1,000,000 as a first-party client limit and 1,048,576 as the server's actual ceiling. Test the boundary chosen.

### S3 — Should-fix: Proof (p1b) does not actually prove the shape-pass ordering

CONFIRMED IN THE SOURCE

Reference: [PREBRIEF:1008–1012, 1123–1125](https://github.com/joshmaurice/atrium/blob/2fbba08f7c7cc7562ca2f7d0c8760b25f06608c3/devtasks/PREBRIEF-subtree-add.md?utm_source=chatgpt.com#L1123-L1125).

Proof (p1b) proposes moving the shape pass after the per-member checks and expecting the test to fail because `objectIdInUse` gets called.

But T2 explicitly replaces per-member calls to `objectIdInUse` with a single Set of world IDs.

Moving the shape check later does not require calling `objectIdInUse` at all. Thus the spy may still report zero and the proof may remain green despite the deliberate regression. The wall-clock threshold might fail, but that is not a deterministic ordering assertion.

Fix: Have the test spy on the proposed world-ID-set construction, `checkNewName`, and another per-member check. Assert none run before rejection of an oversized tree. Include Ajv instrumentation for M1.

### N1 — Nit: The `som:remove` cleanup deserves a descendant-specific assertion

CONFIRMED IN THE SOURCE; user-visible consequence not reproduced

References: [PREBRIEF:721–734](https://github.com/joshmaurice/atrium/blob/2fbba08f7c7cc7562ca2f7d0c8760b25f06608c3/devtasks/PREBRIEF-subtree-add.md?utm_source=chatgpt.com#L721-L734), [app.js:2684–2710](https://github.com/joshmaurice/atrium/blob/70a30bd2e86f2d7d91d6b9f8e02b2d44f0f5f9e6/apps/client/src/app.js?utm_source=chatgpt.com#L2684-L2710).

T4 sends `som:add` per member but leaves `som:remove` as one root event.

Most remove listeners handle that correctly: pads rebuild globally, the runner rescans, and the model bridge reconciles.

However, `app.js` clears `modelAnimations`' wanted state only for `goneName`, while `model-animations.js` retains wanted values by node name until explicitly changed or the world is reset. Removing a group with a model child therefore doesn't clear that child's wanted state immediately.

A future add event normally updates it, so I haven't demonstrated a visible defect. Add a lifecycle assertion that deleting a group with a model descendant leaves no stale animation intention, or document why the existing later update is sufficient.

### N2 — Nit: Qualify the fixed-point claim as applying to canonical descriptors

INFERRED from current builder and ingest contracts

Reference: [PREBRIEF:931–937](https://github.com/joshmaurice/atrium/blob/2fbba08f7c7cc7562ca2f7d0c8760b25f06608c3/devtasks/PREBRIEF-subtree-add.md?utm_source=chatgpt.com#L931-L937).

`prepareRestore(ingest(d)) == d` is too broad if `d` means any schema-valid wire descriptor. For example, a sparse node containing only a name ingests with default TRS but `buildDescriptor` emits explicit translation, rotation and scale.

The intended invariant appears to be that a canonical descriptor produced by the builder survives ingest, save/reload, and reconstruction, including its material refs and child order. That's the useful invariant. Say so explicitly; keep the corresponding test.

## What looks sound in the design

These are source-informed design assessments, not implementation passes:

| Area                 | Assessment                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1/T8 tree schema    | Recursive draft-07 `$ref` is a reasonable approach. The plan correctly distinguishes schema refusals from semantic check refusals.                                        |
| T2 per-member safety | The planned checks cover names, IDs, transforms, source, models, extras, behavior count/bytes, and blocked root parents. M1/M2 concern the work surrounding those checks. |
| T3 atomic ingest     | A preflight for material refs before registering any names is the right fix for the identified partial-registration hazard.                                               |
| T4 client events     | All members are inserted before root-first events, and `edit:accepted` follows them. One Undo re-capture per message is sensible.                                         |
| T5 Undo              | Tree comparisons, remove-triggered re-capture, and descendant-handle re-pointing directly address the previously found loss scenarios.                                    |
| T6 Copy/Paste        | One member-ID map, per-member credit and refs, root-only hidden-marker removal, and name-only retry are coherent.                                                         |
| T7 version skew      | Server-advertised `addFields: 3` closes the rollback hazard, provided the client gates all tree-destructive paths as written.                                             |
| T12 shared materials | Pre-order numbering, backwards-only refs, `required: ["ref"]` in the schema, and old-server inlining are internally consistent.                                           |
| §9 parts/selection   | Correctly separated. No objection to its being out of scope here.                                                                                                         |

T12 is especially worth retaining: making the message its own sharing boundary avoids cross-world authority problems without needlessly destroying material sharing among copied members.

## Tests, proofs, and release path

The §5 test plan is broadly comprehensive for functional behavior. It covers both world implementations, lifecycle, save/reload, Undo timing, behavior target remapping, cross-world paste, and material identity. Most proofs are designed to break the actual property being asserted; p1b is the exception identified above.

I would add a resource-bound test using the dense 16,320-primitive payload (or a revised just-over-budget version), a wide pre-Ajv rejection test, and server-side message-byte boundary assertions. The proposed near-empty 256-node timing test is not a substitute for dense geometry.

The DEV acceptance steps refer to plausible existing screens: the Edit panel, Inspect, Undo button title, shade Alt-click, Copy/Paste and credit rows. The old-tab scenario correctly distinguishes reconnection from reload. I found no clear screen-name error.

The five-commit sequence is reasonable for development, though an intermediate runnable commit should not be treated as deployable. M1's early gate and the other resource checks fit the existing planned `session.js`, `send-policy.js`, schema and test-file scope; no new application feature file is inherently required. §6's strict file list should be updated if an implementation actually needs one.

## What I ran

Clone attempt: failed.

Command attempted:

```
git clone https://github.com/joshmaurice/atrium
```

Exact error:

```
fatal: unable to access 'https://github.com/joshmaurice/atrium/':
Could not resolve host: github.com
```

I used the GitHub connector to read the document at the reviewed SHA and relevant source at the specified baseline. GitHub's commit comparison confirmed that the review commit differs from the baseline only under `devtasks/` (three changed/added files).

Ran successfully: Two independent payload-construction probes under Node.js `v22.16.0`, with the byte counts reported above.

Not run: `pnpm install`, `p10`, the server test files, SOM and protocol suites, the client tests, repository Ajv validation, glTF-Transform ingest benchmarks, or live server/client probes. Repository dependencies weren't installed locally and the clone wasn't available. I am not reporting those suites as passing.

## Final recommendation

CHANGES REQUESTED, with a focused revision rather than an architectural redesign.

I would close M1 (pre-schema resource gate) and M2 (aggregate primitive/resource budget) before implementation. S1 and S2 should be resolved in the same T2 wording pass, and S3 should be fixed so the ordering proof actually catches a regression.

The rest of Rev 1.8 is a defensible implementation plan. The two earlier Claude reviews appear to have substantially strengthened the protocol, material sharing, skew handling and Undo semantics. The main remaining weakness is that a one-message tree can multiply work in ways that neither its node count nor its serialized byte count captures.

With those protections specified and tested, I'd be comfortable advancing this design to implementation.