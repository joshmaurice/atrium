<!-- Outside review (ChatGPT) of PREBRIEF-richer-add.md DRAFT Rev 1.2 at cf844b8c, source-only (clone failed on DNS).
     Pasted by the operator in chat on 2026-11-05 at 20:04 PT. Its attachment (the R6 decision probe) was not copied.
     Every finding was reproduced in the source by Claude before it was taken: PREBRIEF-richer-add.md Rev 1.4 §7. -->

# Atrium `richer-add` — Outside Design Review

Verdict: CHANGES REQUESTED

Reviewed commit: `cf844b8c3697ad6a27c4f41172d2eef9e5fe04d1`
Document: `devtasks/PREBRIEF-richer-add.md`, DRAFT Rev 1.2
Review type: Source-only, with independent Node.js probes. Read-only.

## 1. Repository access and scope
The clone failed (`Could not resolve host: github.com`). Files were read at the
pinned commit through the GitHub connection. Node.js `v22.16.0`; `pnpm` not
installed; the repository's suites and `p8`/`p9` were not run.

## 2. Must-fix
### M1 — R6 allows a stale tab to delete an object it cannot restore
CONFIRMED IN THE SOURCE; consequence shown by a contract-level probe.
References: PREBRIEF-richer-add.md L408–434; session.js L1489–1538; app.js
L2740–2776; edit-undo.js L603–609, L682–686.

R6 refuses world `add` from an unreloaded first-party tab (`scriptRunner`
without `addFields >= 2`) but leaves `remove` unaffected. Sequence:
1. An owner has an older client tab open when the new server deploys.
2. It reconnects with `scriptRunner: 3` and no `addFields`.
3. The owner deletes an ordinary palette cube.
4. The client captures a restore descriptor, so it asks no confirmation.
5. The server accepts `remove`; the object disappears.
6. Undo sends an `add` with the saved descriptor.
7. R6 refuses it.
8. `edit-undo.js` drops the rejected entry; a reload clears the history.

Probe output (a model of the gate, not Atrium's server):
```
stale session: {"scriptRunner":3}
world add permitted: false
remove permitted: true
object present after delete: false
undo re-add permitted: false
object present after Undo attempt: false
```
Required: apply the stale-client restriction to `remove` too (or to structural
editing generally), with an integration test through the real session and Undo
lifecycle: the stale session's delete is refused with the reload text and the
object remains. "This is the only must-fix I found in Rev 1.2."

## 3. Should-fix
### S1 — R6's pre-4b-2 tab assumption is weaker than the claimed protection
INFERRED. "None can still be open" is a deployment assumption, not a protocol
guarantee: such a tab has neither capability and bypasses the check, and could
restore a poorer descriptor. Strengthen enforcement for authenticated editing
sessions, or record it as an accepted limitation.

### S2 — The stated D5 exceptions omit index accessor component types
CONFIRMED IN THE SOURCE; persistence difference INFERRED. References:
edit-duplicate.js L109–124, L157–162, L197–203; SOMDocument.js L822–827.
`accessorProblem()` doesn't check an index accessor's component type, so a
`Uint32Array` index with small values passes; `buildDescriptor()` emits plain
numbers and `ingestNode()` rebuilds a `Uint16Array`.
```
original accessor array: Uint32Array 0,1,2
restore descriptor: [0,1,2]
restored accessor array: Uint16Array 0,1,2
values preserved: true
component type preserved: false
```
An existing limitation. Document it and add a regression test (or refuse
non-Uint16 indices); don't widen the round for it.

### S3 — Add a regression for both `COLOR_0` forms through save/reload
INFERRED. VEC3 and VEC4 `COLOR_0`, each with a material, through
`prepareRestore → ingestNode → serialize → reload → prepareRestore`, asserting
the type and descriptor equality.

## 4. Nits
- N1 — Keep the version-skew message visible: a UI regression that the exact
  reload-required text reaches the user for Duplicate, palette and restore
  (and, after M1, delete). `onStructureAnswer()` (app.js L2869–2877) shows it in
  Edit mode.
- N2 — The near-default base-colour skip must be specific and reported, not
  hidden in a blanket PASS.

## 5. Checks that appear sound
Float32 overflow and the avatar budget (shipped in add-check); R1's avatar
field restriction; FLOAT-only UVs and colours; VEC3/VEC4 `COLOR_0` by length;
`alphaCutoff` with `MASK` only; R7's default canonicalization with the writer
tolerance; R4's one buffer per call (no conflict with candidate-based pruning);
RA-L2 (c) and RA-L3 (a) as decided, with their revisit conditions ("I would not
reopen RA-L2 or RA-L3 in this round"); keeping copy and the subtree add
separate. The rendering claims are properly qualified as headless.

## 6. Test coverage and file list
The four-commit sequence is reasonable. The main missing test is the stale
Delete → Undo sequence (M1), in R6's server tests and ideally the browser
acceptance. `session.js` is already listed, so M1's fix needs no other
production file. The `world-total`/`behavior-leaf` hello updates are necessary.

## 7. What was run
Clone failed; Node `v22.16.0`; pnpm unavailable; `p8`, `p9`, `p1`, the
Duplicate/Undo and vector suites not run (0 tests executed). Two independent
probes executed (the R6 decision model, the index type conversion).

## 8. Final assessment
CHANGES REQUESTED — one must-fix, three should-fixes, two nits. "Correct that
by refusing structural deletions from the same stale sessions, add the
corresponding regression, and I would consider the design suitable to
finalize, subject to the implementation review."
