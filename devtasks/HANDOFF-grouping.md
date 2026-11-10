# Handoff: `grouping`, implemented on `claude/grouping`

**IN PROGRESS** (this file is also the working note: if a session loses its
context, start here, then `git log` on the branch).

**Contract:** `devtasks/PREBRIEF-grouping.md` FINAL Rev 2.0 (operator,
2026-11-10, 00:05 PT, "Go ahead, please"; approved by voice before it).
**Base:** `de33cf8`, the FINAL commit. Its code is `main`'s `172b816d`, PROD's
and DEV's `331e4aed`; only `devtasks/` differs. **Implemented by Claude.**
Started 2026-11-10, 00:09 PT ("Yes, please").

## 1. The commits
| Commit | What (contract items) | State |
|---|---|---|
| 1 | GR1: `SOMDocument.reparentNode`, `reparentProblem`; `packages/som/test/reparent.test.js` (9 tests: 0 of 9 pass on `172b816d`'s `SOMDocument.js`, 9 of 9 after; SOM suite 296 pass, 0 fail) | done |
| 2 | GR2: `checkParentValue`, the `parent` node field (`send-policy.js`). GR3: `parentChangeProblem` in the contract's order (`session.js`), `world.setField`'s `parent` branch on the judged node in both world kinds (`world.js`). GR4: `treeCounts`, `moveCounts`, `treeBoundsProblem`, `descriptorCounts` (server copy), on moves and parented adds. GR5: `ADD_FIELDS_LEVEL` 4, the stale hello refused (`STALE_HELLO_MESSAGE`), a stale `send` refused, never the host (both election places), the client's hello `addFields: 4`, the two schema descriptions. `refuseStaleHello` (default true) lets tests reach the second layer. New `packages/server/test/grouping.test.js` (26 tests; on `172b816d`'s server code 25 fail, 1 passes: the non-owner gate, a guard). Existing hellos updated (§5's list plus `copy-objects-e2e.test.js` L483 and the scriptRunner-3-only hellos in `world-total` and `script-host`); R6's and AC3/S2's stale-tab tests now run as the second layer. Every server file alone: all pass; client 754, app 1,762 (1 skip), protocol 155, interaction 23, behaviors 263, renderer-three 318 | done |
| 3 | GR6 and the client tests | |
| 4 | `edit-group.js`, GR7 and their tests | |
| 5 | GR8's glue and the wiring tests | |
| 6 | the full suites, the proofs, the harness checks, this file | |

## 2. Notes for the record
- **`refuseStaleHello`** (commit 2) is an option of `attachSessionHandlers`,
  default true, that no product caller sets. With GR-L12 (a) a stale tab never
  gets past its hello, so the second layer behind it (R6's `add`/`remove`
  refusal, GR5's `send` refusal and host rule) is unreachable through a real
  socket; tests set it false to prove that layer (selection-parts lesson 5).
- **Historical harness checks** that play a stale tab
  (`checks/scripting-4b-2/rt2.py`, `checks/scripting-4c/c3.py` §10) describe
  earlier rounds' rule (a stale tab joins); on this code its hello is
  refused. They are outside §6's file list and were not changed.
- §6's release-notes bullet "disconnected at the first regroup" predates
  GR-L12 (a)'s change: the release note is **refused at Connect** (GR5's
  hello refusal). To be fixed in the pre-brief's Rev 2.1 wording, as
  selection-parts did.
