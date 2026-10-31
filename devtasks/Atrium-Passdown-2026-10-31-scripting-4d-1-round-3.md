# Passdown 2026-10-31: scripting-4d-1 round 3 approved, kickoff ready; round 2 stays on DEV, unaccepted

Follows `Atrium-Passdown-2026-10-31-scripting-4d-1-on-dev.md`. Its host,
connector and convention notes still hold.

**First instruction for the next session's Claude:**
1. Clone the repo and read `devtasks/`, newest first: this file, then
   `REVISION-scripting-4d-1-round-3.md` (the contract for round 3, approved,
   with the kickoff body in its §5).
2. Use the `atrium-ops` connector for board, release, log and git state. It
   is read-only. Pushing `devtasks/` to `main` works from the session's
   clone once the repo is attached with push access (`add_repo`,
   `joshmaurice/atrium`); the clone at `/home/claude/work/atrium` is
   per-session, so re-clone.
3. **If the operator hasn't run round 3's kickoff:** give them the front
   door's steps from the revision §5 and the filled check line (§2 below).
4. **When round 3 is on DEV:** run the eleven §6.1 checks on its SHA with
   `devtasks/harness/checks/scripting-4d/` (its README has the commands);
   write the scripts for 9, 10 and 11 first (§4). Then the second outside
   review of `3cfeeed9..<tip>`, then DEV acceptance.
5. **The repo's code runs in this environment** (previous passdown, first
   instruction 4): the harness, Playwright and the suites all ran this
   session. The proxy refuses `dev.ewwb.dev`; "on DEV" means the harness
   at the DEV SHA, as always.
6. **Never push to `main` between a DEV deploy's release merge and the MAIN
   push** of the release you mean to ship. `devtasks/`-only commits are the
   established exception (this session's `025a219`, the previous session's
   `bf3c490`).

## 1. Where things stand

| What | State |
|---|---|
| Round 2 | Tip `3cfeeed9a8bf91bc407d796030ea5508d706ccaa` on `workflow/scripting-4d-1`, GLM APPROVE. **On DEV as `7a60dbb8`, `WAITING_FOR_HUMAN_DEV_ACCEPTANCE`, not accepted and not to be accepted:** round 3 redeploys over it (`set-dev` from waiting-for-acceptance) |
| Round 3 | **`devtasks/REVISION-scripting-4d-1-round-3.md` at `025a2195a5bca7fbc72f81e1090ef82f1f313f1b`** (33,040 bytes, sha256 `71171bedff8d315c5409e71838bf3ca3cfe2758271655e29f9404d3a40159541`), **approved by the operator 2026-10-31 05:12 PT, all decisions as recommended** (R-L2–R-L5 (a)). Twelve items R6–R17, five implementation cards, a GLM review, a gate. **Kickoff not yet run** |
| MAIN / PROD | `025a219` (devtasks/ only, ahead of the released code) / `14ab0076`. Lock free, both healthy |
| Board | Nothing running. Blocked: `t_d0639e09` (round 1's gate, parked by design), `t_f56db644` (round 2's acceptance, stays blocked). Open sentinels: `t_adf3ee2b` (round 1), `t_f93034ca` (round 2) |
| Contract | `PREBRIEF-scripting-4d.md` FINAL Rev 1.4 (`457e2ff0…`, at `4f19b253`); `KICKOFF-scripting-4d-1.md` (`42662602…`, at `1a26d8fa`); `REVISION-scripting-4d-1.md` Rev 0 (`f3a73cd3…`, 25,845 bytes, at `c89eb69c`); the round-3 revision above |
| §6.1 checks | **Short pass done on `7a60dbb8`** (§3): 2, 3, 5, 6, 7 pass; 1 and 8 fail on F1; 4 blocked by F2; 9, 10, 11 not run. **All eleven rerun on round 3's SHA** |
| Outside review | `REVIEW-scripting-4d-1-code.md` (source-based, NO-GO; not in the repo — the operator holds it). M1, M2, S1, S2 confirmed by Claude; all in round 3. A second review of `3cfeeed9..<round-3 tip>` is due before acceptance |

## 2. For the front door (round 3's kickoff)
The revision's §5 says it whole. The filled check line:

```
REVISION CHECK (front door): 025a2195a5bca7fbc72f81e1090ef82f1f313f1b:devtasks/REVISION-scripting-4d-1-round-3.md sha256 71171bedff8d315c5409e71838bf3ca3cfe2758271655e29f9404d3a40159541, 33040 bytes, matches.
```

Order: sentinel first (`Scripting-4d-1 r3 sentinel (scripting-4d-1)`,
`t_f93034ca`'s shape); fill the three placeholders; create the kickoff with
the body in its body field; read it back. **After the kickoff completes,
the front door links gate → sentinel itself and reads the sentinel back**
(round 2's kickoff reversed that link; the kickoff body now forbids it from
touching sentinels). Two sentinels are open by design, so the guard's
automatic link is skipped.

## 3. What this session found (details: the revision §1)

| # | Finding | Severity | Where it goes |
|---|---|---|---|
| F1 | **Every `flow/setDelay` kills its behaviour in a real browser.** `adapter.js` L273 calls the injected `setTimeout` as a method of the delay table (`table.setT(…)`); Chrome throws `TypeError: Illegal invocation` for a receiver other than `window`; Node ignores `this`, so every suite, fixture and the Khronos subset passed. Seen as `the graph threw: Illegal invocation` → `behaviour disabled — engine-error` on check 1's first click | HIGH | R6, proof (c5), `this`-sensitive fakes |
| F2 | §6.1 check 4's graph is refused by the importer (G6's S3 consumer rule), not accepted and refused at run time as the check expected | spec vs check | R-L4 (a): keep the code, rewrite the check |
| F3 | Item 7: the validator refuses a *bare* `event/onHoverIn` (`unknown core operation`); with `KHR_node_hoverability` it is stored, inert, "Partially supported". G-L3 holds; G-L2's wording was wrong | spec wording | R17 (Rev 1.5 note) |
| F4 | The importer's grant line shows raw ids; the Q3 prompt names objects | LOW | R16 |
| M1 | The importer conflates light-table and node indices (`fileLights` by host node; `node:i` and `light:i` share `mapping.nodes[i]`) | HIGH | R7 |
| M2 | `BEGIN IMMEDIATE` is not an offline check (an idle server connection doesn't hold it) | HIGH | R8, R-L2 (a): a lifetime lock file |
| S1 | Graph object keys are unbounded: a 1,000-char or control-character socket key passes both rule copies | MEDIUM | R9, R-L3 (a) |
| S2 | The panel reads the whole file before the 4 MiB check | MEDIUM | R10 |
| N1 | The CLI prints node names raw | LOW | R11 |

**Measured on `7a60dbb8`** (SwiftShader, 1280×800): check 5 with 64
behaviours (8 heavy at ~3,000 node starts a tick) — host p95 frame time 116
ms (p50 92, max 139), ~54 of 64 engines skipped per frame in rotation,
nothing disabled, light graphs still turn, "Throttled" on all 64. Check 2 —
the host turns every frame independent of the echo (56 frames → 160.4°,
exactly as predicted); the visitor steps at 13.7/s. Check 3 — the host
closed at 1.96 s: visitor, saved document and the new host all hold the same
last sent value. Check 6 — a `scriptRunner: 2` tab is never elected.

## 4. What is left for the checks (round 3's SHA)
- **Scripts to write** in `devtasks/harness/checks/scripting-4d/`:
  - **check 9**, the regression set: `../scripting-4c/reg4c.sh` on the base
    root (`/tmp/ah-base` at `14ab0076`) and the round-3 root, `regdiff.py`;
    plus 4c's `c1.py`–`c3.py` against the round-3 server (they need
    `harness/server.mjs` or `authserver.mjs` as their READMEs say);
  - **check 10**, Q7's measured gates: a world filled to 1 MiB of leaves with
    multi-byte strings; A/B against the same world without them; three
    visitors joining at once; five runs, the median; join → `world:loaded`
    ≤ 1.5 s over the baseline; the server's `[world] serialized … in <ms>
    ms (<bytes> bytes)` and `[world] healed <logId> in <ms> ms` lines (via
    `/__log`) ≤ 250 ms together; a visitor tab's heap delta ≤ 50 MB through
    CDP (`HeapProfiler.collectGarbage`, `Performance.getMetrics`
    `JSHeapUsedSize`); a `send` past the total refused;
  - **check 11**, the rollback rehearsal: locally first (two owners' worlds
    on a 4d database, the 4c server at `14ab0076` over the same database to
    heal, the changes, upgrade, export/reconcile dry-run/apply/apply), then
    the operator's command block for a PROD copy on the host. Under R-L2
    (a) the scripts now refuse while the lock file's pid is alive: the
    rehearsal must show that refusal too.
- **Check 4's new graph** (R-L4 (a)): hover with `KHR_node_hoverability` and
  a `/materials/…` `pointer/set` that nothing reads → listed, the rest
  runs; the same pointer read by a running node → refused at import.
- `c2.py` with `ROT_SECONDS=120` for the full two minutes.

## 5. Lessons
- **The suites run in Node, where `setTimeout` ignores `this`.** A browser's
  doesn't. Every injected host function is called unbound, and its fake is
  `this`-sensitive. One browser run of a delay graph found what 699 server
  tests, 21 fixtures and 143 Khronos graphs could not.
- **Run the browser checks before the outside review is finished, not
  after.** The short pass (checks 2, 3, 5, 6 take ~15 minutes with the
  scripts written) found F1 and F2 while the review was still being read;
  both went into the same revision. The long checks (9, 10, 11, the
  two-minute run) wait for a SHA that will stand.
- **A check that fails may be the spec's fault** (F2): read the contract
  before filing the code.
- **The wire message is `{ type: 'set', node, field, value }`**, not the
  client's `som:set` event; the harness scripts filter on the former.
- **Sample motion over ≥ 4 s under load:** with 64 engines in rotation a
  light engine ticks every ~6 frames at the harness's ~11 fps.
- **A server started by a check script dies with the script**, and a
  `nohup` one with the reply. Start the harness server with the Bash tool's
  `run_in_background`; after check 8's restart, start it again that way.
- **Playwright's `page.evaluate` can't take a Python function as `arg`**
  (the `lines` helper); pass the name and call the helper.

## 6. Next
1. The operator runs round 3's kickoff (§2).
2. Round 3's five cards, the GLM review, the gate, the chain: DEV over the
   unaccepted round 2.
3. A fresh session: the eleven §6.1 checks on round 3's DEV SHA (§4), the
   rollback rehearsal's command block for the operator.
4. The second outside review of `3cfeeed9..<tip>`.
5. DEV acceptance (pre-brief §7), with check 1's fixture and the rotation
   graph as its first two items.
6. Cleanup: archive the sentinel `t_adf3ee2b` first, then the gate
   `t_d0639e09`.
