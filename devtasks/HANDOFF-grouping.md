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
| 2 | GR2–GR5 and the server tests, the existing hellos | |
| 3 | GR6 and the client tests | |
| 4 | `edit-group.js`, GR7 and their tests | |
| 5 | GR8's glue and the wiring tests | |
| 6 | the full suites, the proofs, the harness checks, this file | |

## 2. Notes for the record
- §6's release-notes bullet "disconnected at the first regroup" predates
  GR-L12 (a)'s change: the release note is **refused at Connect** (GR5's
  hello refusal). To be fixed in the pre-brief's Rev 2.1 wording, as
  selection-parts did.
