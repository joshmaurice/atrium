# Handoff: `richer-add`, implemented on `claude/richer-add`

**Contract:** `devtasks/PREBRIEF-richer-add.md` FINAL Rev 2 (operator, 2026-11-05).
**Base:** `main` at `8df8907` (code identical to PROD `cdfe88a8`). **Implemented
by Claude in the fast lane** (§6.1), no OpenRouter. **Checked by a fresh Claude
agent** (§6; no must-fix; its should-fix and nits taken in commit 5). Not yet
reviewed outside; not published or deployed.

## 1. The four commits
| Commit | What (contract items) |
|---|---|
| 1 `efbcfae` | the widened rule in both copies, identical (`send-policy.js`, `add-spec.js`; R1–R3); vectors 60 → 112 (32 accepted), two flipped; boundary tests |
| 2 `c2c10b9` | `ingestNode` keeps every R1 field, one buffer per call (R4); the add schemas (R5); `richer-add-ingest.test.js` (SOM) and `richer-add.test.js` (server, port 0, real handler) |
| 3 `8251156` | the version-skew check (R6): `addFields: 2` beside `scriptRunner`; the server refuses a stale tab's world `add` **and** `remove`; hello schema; two test files' hellos; the 4d harness's `c1.py` |
| 4 `3a41693` | Duplicate and Undo (R7, R8): rules narrowed, canonical builder, `hasSharedMaterial`, the Undo title's note; real-document tests; the render test; proofs; this file |
| 5 (see §6) | the fresh check's fixes: the Undo note after a Redo, the real client lifecycle test, three nits |

Files touched are exactly §6's list, plus `devtasks/harness/checks/scripting-4d/c1.py` (§6 names the harness checks).

## 2. Tests
- **All suites, each server file alone under `timeout 180`:** 60 suites,
  **4,056 passing, 0 failing, 1 named skip** (R7's stated limit, below), at
  commit 5 (4,048 at commit 4). Baseline at `8df8907`: 59 suites, 3,874 passing. (`better-sqlite3`
  was built natively in this session, so the database suites ran too.)
- **New tests fail on today's code** (the code reverted, the tests kept):
  - commit 1: the vectors and boundaries, server 80 failing, client 47;
  - commit 2: `richer-add.test.js` 5 of 5, `richer-add-ingest.test.js` 4 of 7,
    protocol 1;
  - commit 3: with R6's checks stubbed out, `richer-add.test.js` 3 of 9 (the
    stale-session tests);
  - commit 4: the proofs below break each piece and see its tests fail.
- **New test files:** `packages/client/tests/richer-add-lifecycle.test.js`
  (commit 5), `packages/som/test/richer-add-ingest.test.js`,
  `packages/server/test/richer-add.test.js`,
  `apps/client/tests/richer-add-restore.test.js`,
  `packages/renderer-three/tests/richer-add-render.test.js`. Extended:
  `add-node-boundaries.test.js`, `validate.test.js`, `edit-duplicate.test.js`,
  `edit-undo.test.js`, `packages/client/tests/activate.test.js`, and the two
  test files whose hellos gained `addFields: 2`.

### 2.1 The proofs (each break made, the named tests seen failing, the file restored)
| Proof | Break | Failed |
|---|---|---|
| (p1) | `ingestNode` back to one buffer per primitive | the one-buffer and prune SOM tests (2); the server's R1/R4 end-to-end test |
| (p2) | `alphaCutoff` emitted whatever the mode | 22 Duplicate tests (every descriptor with a material now refused by A1), the canonical-form test, the fixed point and the fixture tests (4) |
| (p3a) | R6's `add` check removed | the two stale-session server tests |
| (p3b) | R6's `remove` check removed | the same two (the review's M1 sequence) |
| (p4) | R2 removed: avatars allowed the new fields | 10 `avatar-fields` vectors, in both suites |
| (p5) | `COLOR_0`'s range check removed | the two out-of-range vectors, in both suites |
| (p6) | `ingestNode` stops keeping the material name | the server end-to-end test; the fixed point and both `COLOR_0` round trips |

### 2.2 The probes, on the branch
- `p1` (fixtures, `tests/fixtures/*.gltf devtasks/harness/group.gltf`): **14
  top-level objects copy (was 1)**; the rest are 13 groups, 4 cameras or
  lights, 2 animated, 2 external, as the contract expects.
- `p3`, `p4`, `p7`, `review-q/q2`: every malformed case still refused through
  the handler, joins still read back. `q2` (b), calling `world.addNode`
  directly: **a 20,000-primitive add now ingests in 382 ms with 2 buffers**
  (3.8 s and 20,001 buffers on `cdfe88a8`): R4's one buffer per call. Through
  the handler it's refused anyway.
- `p8`, `p9`: as the contract records (they describe the base and the
  renderer, not the change).

## 3. Where the code differs from the contract's wording, and why
1. **Material scalars are checked in the shape phase, the `extras` walks in the
   values phase.** add-check's lengths-first test expects a later primitive's
   bad `metallicFactor` refused before an earlier primitive's POSITION is read,
   so the material's scalar checks stay where add-check put them. Only the
   `extras` walks (the one unbounded-depth read) wait for every shape.
2. **`buildDescriptor` reads the primitive's own `listSemantics()`** rather than
   asking for each semantic by name. add-check's server test builds a stand-in
   node whose `getAttribute` answers every name with the NORMAL accessor; asking
   by name emitted a `TEXCOORD_0` it doesn't have. Reading the list is the
   correct builder for any node.
3. **The render test uses `@gltf-transform/view`'s `DocumentView` directly**
   (§5 allows this). `initDocumentView` can't run headless: it calls
   `new DocumentView(renderer)`, passing the renderer where the constructor
   expects the document and giving no config, so the default image provider
   (which needs `document`) is always used. **Pre-existing, unchanged, and worth
   a look later:** it works in the browser only because the first argument is
   unused for viewing.
4. **An `extras` too deep for `JSON.stringify` is refused** (`part-extras`), not
   walked: the size check fails closed first. The wire's depth cap is 64.
5. **`prepareRestore` adds `sharedMaterial: true` only when it's true,** so every
   other result keeps today's shape. `edit-undo.js` reads it from the node at
   `registerDelete` (`hasSharedMaterial`, cheap), because `app.js` passes only
   the descriptor and isn't in the file list.

## 4. Not done here, by the contract
- Node `extras` still has add-check's rule (no finiteness walk), and `send` can
  still set a cutoff on a non-`MASK` material: recorded for a later audit
  (R1, R8).
- The browser checks (§5's DEV acceptance) and Claude's `h1`–`h6` and `c2` runs
  need a published SHA.

## 5. Next
1. A fresh Claude agent checks the code against the contract.
2. Push `claude/richer-add`; one outside code review (ChatGPT), pinned to the
   tip, with `devtasks/OUTSIDE-REVIEW-PROMPT-richer-add-code.md`.
3. Publish and deploy to DEV from the host (the passdown's §4 commands, with the
   real SHA); the operator's DEV acceptance (§5): Duplicate `crate-01`, delete
   and Undo `ground-plane`, an emissive, `BLEND`, double-sided cube through
   Duplicate, Undo and a reload, and an unreloaded tab refused with R6's text.
4. **Before PROD: the operator reruns `p6`** (§6's commands). Nonzero labels,
   shared materials or shared meshes reopen RA-L2 and RA-L3.

## 6. The fresh agent's check (after commit 4), and commit 5
A Claude agent that hadn't written the code checked `8df8907..3a41693` against
the contract: adversarial probes of both copies of the rule (42 cases, identical
verdicts), the fixed point over the fixtures and hand-made edges, R6's senders,
a full run of every suite, and proofs (p3b) and (p6) reproduced in a copy.
**No must-fix.** Claude reproduced each finding before taking it:
- **S1, should-fix, taken:** the client-side stale-Delete test fed a mocked
  refusal and passed with or without R6. New
  `packages/client/tests/richer-add-lifecycle.test.js`: the real AtriumClient
  against the real handler, with the real `edit-undo.js` and `prepareRestore`
  wired as `app.js` wires them. A stale tab (its hello stripped of `addFields`
  on the wire, as a `cdfe88a8` page sends it) has its Delete refused with the
  reload text, records nothing, and the object stays on the server and in the
  tab; a current tab's Delete and Undo restore `crate-01` exactly. **With R6's
  `remove` check removed the stale test fails** (it first hung waiting for the
  refusal; the wait is now bounded at 3 s so it fails cleanly).
- **N1, taken (a real bug):** after Delete, Undo, Redo the Undo title still said
  "(it comes back with its own material)" though the restored object shares
  nothing: `openRemovalWindow` captured the flag but didn't give it to the
  entry. Fixed; two tests (the Redo case, and a re-capture during a pending
  delete), both failing without the fix.
- **N2, taken:** R6's block had been inserted between `addCarriesAtriumExtras`
  and its JSDoc.
- **N4, taken:** a lengths-first case for `TEXCOORD_1`.
- **N5, taken:** accessor sharing between primitives is now stated in the D5
  comment (each copy gets its own accessors; the same values).
- **N3, not changed:** three inputs JSON can't carry (an own `undefined`
  attribute, a holey `emissiveFactor`, a `toJSON` that hides bytes) are accepted
  by both copies alike; none can come off the wire or out of `buildDescriptor`.

