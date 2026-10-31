# Passdown 2026-10-31: scripting-4d-1 is on DEV (round 2), awaiting checks

Follows `Atrium-Passdown-2026-10-30-scripting-4d-prebrief.md`.

## 1. Where things stand

| What | State |
|---|---|
| Reviewed tip | `3cfeeed9a8bf91bc407d796030ea5508d706ccaa` on `workflow/scripting-4d-1` (published, first push). Base `4f19b253` plus eight commits: step 1 (`880b0f1a`), the fix `step 1 fix (R1–R4)`, then steps 2–7 |
| DEV | `7a60dbb8050df481efc40b6e0eb41dac4bc1d108`, the release merge of `main` `c89eb69c` (only `devtasks/` differs) into the tip. Healthy; `atrium-release-status` says `WAITING_FOR_HUMAN_DEV_ACCEPTANCE` |
| MAIN / PROD | `c89eb69c` / `14ab0076`. Untouched |
| Contract | `PREBRIEF-scripting-4d.md` FINAL Rev 1.4 (`457e2ff0…`, at `4f19b253`); `KICKOFF-scripting-4d-1.md` (`42662602…`, at `1a26d8fa`); `REVISION-scripting-4d-1.md` Rev 0, approved with R-L1 (a) (25,845 bytes, `f3a73cd3…`, at `c89eb69c`) |
| Not yet done | Claude's §6.1 browser checks on DEV `7a60dbb8`; the outside review of `4f19b253..3cfeeed9`; round 3's revision (§3); DEV acceptance |

## 2. How the round ran

| Round | Cards | What happened |
|---|---|---|
| Brief | GLM brief `t_255de53b`; run 1147 implemented instead (stray `c2d2153`, reset, evidence kept at `/root/atrium-evidence/scripting-4d-1-stray-20261031T044849Z/`); run 1148 wrote the brief | Previous passdown §4.6 |
| 1 | brief gate `t_e0f3e8d7`, impl `t_70443b8b`, GLM `t_64414bde`, gate `t_d0639e09` (superseded, never completed), sentinel `t_adf3ee2b` (parked) | DeepSeek did step 1 of 7 and completed. CHANGES_REQUIRED: the `scriptRunner` enum, and the two rule copies' event entries |
| 2 | kickoff `t_724972d4`; steps 2–7 `t_9be88969`, `t_9a75fd9b`, `t_248c384c`, `t_ede92a07`, `t_1530a5fd`, `t_085355ef`; GLM `t_9ae89c40`; gate `t_0c3c0e08`; early sentinel `t_3110fe0d` | One card per step, every item checked off. **GLM APPROVE `3cfeeed9`** (runs 1161 timed out at 300 iterations; 1162 resumed from its comments): every reproducible proof reproduced, server 699, `packages/client` 570, `apps/client` 1345, 0 skipped, 21/21 fixtures, Khronos subset 135/6/1/1 = `expected-4d.json` |
| Chain | Publish `t_df0f5c25`, DEV `t_ba9e3f27`, finalizer `t_8f2c1046`, acceptance `t_f56db644`; release sentinel `t_f93034ca` | The gate blocked asking for a Nemotron review; the operator ruled none is needed (F-8). The finalizer blocked on the missing banner line (known); verified and completed by the operator |

## 3. For round 3 (to be fixed before DEV acceptance)
From GLM's review and the step handoffs; add the browser checks' and the
outside review's findings:
1. **(b3) coverage gap:** the send path's use of `behaviorBytesIn`'s
   exclusion has no test (the replacement test starts with no leaf). The
   function's own row exists.
2. **(f) coverage gap:** `convertGraph`'s rewrite of a variable's initial
   `/nodes/<i>` literal has no test (`referencesOf`'s finding is pinned).
3. **(d3) coverage gap (new):** nothing tells the write check before the
   queue from one after it; the overlay's `nextRevision` would.
4. **(b2) harness:** with (b2)'s break, `world-total.test.js` hangs to the
   180 s timeout after the failing assert (a teardown skipped on failure).
5. **`core:flow/setDelay_and_cancelDelay`:** pass → no result (the 16-delay
   cap, and the delay subclass not registering the engine's
   `/extensions/KHR_interactivity/delays/<n>` path). Decide: accept, or fix.
6. **`[world] healed` logs `-`,** because `world-registry.js` was outside the
   file list.
7. **Card 4's finding: the engine validator refuses a bare
   `event/onHoverIn`.** If so, G-L3's "stored and inert" is false for hover
   graphs, and P-facts in the pre-brief are wrong. **Claude checks this
   first** (`packages/gltf-interactivity-engine/build/index.js`'s validator).
8. Cards 4 and 6 put their handoffs in comments, not in the completion
   summary and metadata (canonical §2).

## 4. Lessons
- **DeepSeek stops after one step on a seven-step card.** It completed, with
  no error, 38 minutes into four hours, and called the rest "later steps".
  **One card per step**, each with its item list, a "never complete with an
  item undone" rule and a check of its predecessor's commits, worked: six
  cards, every item delivered.
- **The kickoff reversed a written-out `kanban_link`** (sentinel → gate
  instead of gate → sentinel), and the early sentinel was claimed. **The
  front door makes sentinel links itself and reads them back.**
- **A gate invented a requirement** (a second, Nemotron, review). Gate
  bodies should say "a single GLM review; Nemotron is benched (F-8)".
- **Review cards need an explicit cap.** Round 1's review got the guard's
  45-minute default; round 2's 14400 s review needed a retry even so.
- **With two open sentinels the guard skips its automatic link,** and with
  one it links whichever is open: it attached round 1's `t_adf3ee2b` to the
  DEV finalizer (harmless, still parked behind `t_d0639e09`).

## 5. Next
1. A fresh session: Claude checks §3 item 7, then runs the pre-brief's §6.1
   browser checks on DEV `7a60dbb8`, with Q7's measured gates and the
   rollback rehearsal.
2. The operator's outside review of `4f19b253..3cfeeed9a8bf91bc407d796030ea5508d706ccaa`.
3. Round 3's revision from §3 and both results; then DEV acceptance.
4. Cleanup: archive the sentinel `t_adf3ee2b` first, then the gate
   `t_d0639e09`. Archiving a card promotes its children (4b-2 passdown
   §4.5), so the gate must go after its sentinel.
