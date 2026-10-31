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

## 6. Update, 13:50 PT: round 4 on DEV (`1d4ccf17`), its checks run
- **Round 4** (`REVISION-scripting-4d-1-round-4.md`, approved 11:40 PT, R-L6–R-L8 (a)): tip `85669db0`, on DEV as
  release merge `1d4ccf17` (code identical to `85669db0`), `WAITING_FOR_HUMAN_DEV_ACCEPTANCE`. Cards (Hermes):
  steps `t_2eeb1557`, `t_343624e0`, `t_714ca3f2`, `t_e2f8a912`; GLM review `t_c728de60`; gate `t_76440821`;
  finalizer `t_485c5a5d`; acceptance `t_80abe650`; sentinel `t_bc296ffe` (the guard linked it to the gate and the
  finalizer itself, after §4's cleanup). Card bodies are empty by the kickoff's fallback (instructions in each
  card's first comment, canonical requirements summarised); cards 2–4's completion metadata dropped, and their
  handoffs are comments (card 3's R15 handoff on `t_714ca3f2`, card 4's on `t_e2f8a912`). Hermes's comment 1280
  supersedes 1275 on the review card.
- **Claude's checks on `1d4ccf17`:** R18, R22, R23, R24 hold; checks 1–8 and 11 pass (27/27 for 11, with the new
  lock cases); the review's M1 interleaving, rerun, is closed. Details: the checks README, "Results on DEV
  `1d4ccf17`". **One new finding, F7 (LOW):** the SIGTERM/SIGINT handlers exit 143/130, so systemd marks every
  clean stop `failed`, and Rev 1.6's §8 line expects `inactive`. Not yet fixed.
- **Host block, round 4: PASS** (14:55 PT; the README has the output).
- **Next:** the short outside review of `769825ce..85669db0`
  (the operator has the prompt); then F7's disposition and DEV acceptance (`t_80abe650`).
- **Harness lesson:** c2's 30 s form could click check 3's cube before the visitor's view resolved it; c2 now
  waits for the visitor's own pick. Don't edit the pre-brief on `main` while rounds edit it on the branch: the
  release merge would conflict (it lives at Rev 1.4 on `main`, Rev 1.6 on the branch).

## 7. Update, 16:50 PT: round 5 on DEV (`ddef0a31`)
- **Round 4's outside review** (`REVIEW-scripting-4d-1-round-4-code.md`): NO-GO on two lock flaws, both reproduced
  by Claude (a dangling symlink gives one database two locks; a root holder's crash leaves a journal that stops
  the service user). **Round 5** (`REVISION-scripting-4d-1-round-5.md`, approved 15:47 PT, R-L9 (a)): R25 the
  dangling symlink, R26 the journal in memory, R27 exit by the signal (F7), R28, R29. Tip `e5369130`, on DEV as
  `ddef0a31` (devtasks-only over the tip). Cards: kickoff `t_d365902a`; steps `t_34652692`, `t_bdb742d4`; GLM
  review `t_2436e620`; gate `t_4dae5352`; sentinel `t_e7a9ca2c` (title typo "4d1", cosmetic; the guard linked it).
- **Claude's checks on `ddef0a31`:** `probe_r5.sh` 11/11 (it fails 5 ways on round 4), c11 27/27, c1 34/34, c5
  pass. Results and the round-5 host block: the checks README.
- **Next:** the operator's round-5 host block (one DEV restart, to see the first clean stop); a short outside
  review of `85669db0..e5369130`; DEV acceptance. N4 (a symlink loop exits with a trace) is for a later round.
