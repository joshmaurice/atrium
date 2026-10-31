# Passdown 2026-10-31: scripting-4d-1 round 3 on DEV (`5eebe09f`), the eleven §6.1 checks run

Follows `Atrium-Passdown-2026-10-31-scripting-4d-1-round-3.md`. Its host, connector and convention notes
still hold.

**First instruction for the next session's Claude:**
1. Read `devtasks/harness/checks/scripting-4d/README.md`, "Results on DEV `5eebe09f`": every check's
   numbers, the two findings (F5, F6), the pipeline note (N2) and the operator's host block for check 11.
2. Everything here was measured in the harness at `5eebe09fd5b000e70d50a36a9c926e6263d86e80` (the release
   merge of `769825ce` + `main`), against PROD's `14ab0076` as the base; the proxy still refuses
   `dev.ewwb.dev`.
3. This session could not push (`add_repo` with push access was refused): this file, the README and the new
   scripts reached `main` as a patch the operator applied, or are still waiting for that. `git log -- devtasks/
   harness/checks/scripting-4d/c11.py` tells you which.

## 1. Where things stand

| What | State |
|---|---|
| Round 3 | tip `769825ce`, on DEV as **`5eebe09f`** (release merge, zero code delta: `main`'s `devtasks/` only), `WAITING_FOR_HUMAN_DEV_ACCEPTANCE`, DEV and PROD healthy, lock free |
| Board | `t_7e0acd73` (DEV finalizer) **blocked `capability`**: the handoff has no `RELEASE_SHA` line (N2: the line is printed, but cut from the tail-only handoff). Hermes verified the criterion from the release ref (card comment 1259). Behind it: acceptance gate `t_b6db79eb`, r3 sentinel `t_7e8edf61`. **The operator's call** |
| MAIN / PROD | `621dd62c` / `14ab0076`; nothing merged or deployed beyond DEV |
| §6.1 checks | **all eleven run on `5eebe09f`**: 2–11 PASS (check 11 locally, 20/20, and on the host: PROD copy 23 worlds, 0 leaves, all zeros; a DEV copy, 9 real template leaves, `unchanged 9, writes 0` three times; the lock refused against DEV's live database); 1 PASS except its R16 line (F5) |
| Outside review | the second review of `3cfeeed9..769825ce` is still due before acceptance |

## 2. Findings (details and evidence: the checks README)
| # | Finding | Severity | Suggested home |
|---|---|---|---|
| F5 | **R16 isn't delivered in a browser, and the Q3 prompt never named objects:** `app.js` L3222 and L3268 read `resolveObjectId(id)?.name`, but it returns `{ node }`; both texts show the raw id. Unit tests inject their own `nodeName` | LOW | one-token fix (`?.node?.name`) + a test on the real return shape |
| F6 | **The lifetime lock's reach:** (a) the 4c server a rollback runs creates no lock, so the scripts can't see it (rehearsed: a dry run proceeds with 4c up) — a runbook line, §8 already stops the server first; (b) the lock is keyed on the path string: through a symlink to the same file the export proceeds with the server up | LOW | (a) the runbook; (b) `realpathSync` both sides |
| N2 | `atrium-deploy-gate dev` prints `RELEASE_SHA=` first (the release merge) and then deploys exactly that SHA, so `TARGET_SHA` = `RELEASE_SHA` by construction; the board's handoff keeps only the output's tail, so the finalizer's criterion can never see it and blocks every round | process | the deployer's handoff metadata carries `release_sha`, or the card's criterion names the release ref and `atrium-release-status` |

Confirmed in a browser or on a real database: F1 (the unbound timers, checks 1 and 8), F2 (R-L4 (a), check 4),
M2 (the lock refuses a live 4d server, check 11). M1, S1, S2 and N1 aren't in the §6.1 checks' scope: they
rest on the round's unit tests and the second outside review.

## 3. Q7, measured (the acceptance card carries these)
World at 1,047,001 B of multi-byte leaves vs the same world without; three visitors at once; median of five:
join +0.543 s (slowest of three; gate 1.5 s), heal + serialize 28 ms (gate 250 ms), visitor heap +2.5 MB
(gate 50 MB). Check 5: host p95 frame time 130.8 ms with 64 behaviours (SwiftShader). **Q7's 1 MiB stands.**

## 4. Lessons
- **A unit test that injects the dependency it is testing can't catch a wrong call shape** (F5: every test
  passed a `nodeName` fake; the app's real one read a field the SOM never returns). Probe the real
  composition once in the browser.
- **A lock keyed on a path is only as good as the path's spelling** (F6 b). Canonicalise first.
- **`pkill -f <pattern>` from the Bash tool kills the tool's own shell** (exit 144) when the pattern is in
  the command line. Kill by pid (`ps -eo pid,args | grep '[a]uthserver'`).
- **Never edit a running bash script** (c9.sh was edited while running): bash reads by byte offset.
- **`server.mjs` needs `ATRIUM_REPO` pointing at the clone `setup.sh` installed `scripts/library-build` in**;
  a bare worktree has no sharp, and every script then fails on a refused connection in seconds.
- **A 4c template leaf is `{ template: { id, params }, … }`**, not `{ template: '<id>' }`.
- **Q7 needs an unloaded world per run** (the registry tears down 3 s after the last session), or no heal
  line is logged; and **no pass-through socket route on the measured visitors** (it adds per-byte latency).

## 5. Next
1. The operator: decide `t_7e0acd73` (N2). (Check 11's host block: run 10:30 PT, PASS; the README has the output.)
2. F5 and F6 (b): a small round 4, or folded into the next round, before MAIN. F6 (a): one line in §8.
3. The second outside review of `3cfeeed9..<tip>`.
4. DEV acceptance (pre-brief §7), with check 1's fixture and the rotation graph first.
5. Cleanup: archive sentinel `t_adf3ee2b` first, then gate `t_d0639e09`.

**Agreed order (operator, 10:44 PT):** clear `t_7e0acd73`; send the outside review of `3cfeeed9..769825ce` now
(prompt: the operator has it); hold round 4 until the review returns, so one round carries F5, F6 (b), the §8
runbook line for F6 (a) and the review's findings; then a short review of round 4's delta; then DEV acceptance
and MAIN.
