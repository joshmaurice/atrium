# Revision — scripting-4d-1 round 4 (round 3 is on DEV, not accepted)

**Status: Rev 0 DRAFT, not approved.** It holds the two findings from Claude's §6.1 checks on round 3 (F5, F6)
and two process items. **The second outside review of `3cfeeed9..769825ce` is running**; its findings go into
§2.5 before this is offered for approval, and the kickoff (§5) is not run before then. Items R18–R21 continue
round 3's numbering. Decisions for the operator: R-L6, R-L7 (§2.2, §2.4).

- **Base:** round 3's reviewed tip `769825ce3781b5bb4de03f4d7687b37cd9f0d46a` on `workflow/scripting-4d-1`
  (published). DEV is its release merge `5eebe09fd5b000e70d50a36a9c926e6263d86e80`,
  `WAITING_FOR_HUMAN_DEV_ACCEPTANCE`; **it is not accepted.** Round 4 commits on top of `769825ce` on the same
  branch, one commit per step, and redeploys DEV over round 3 (`set-dev` from waiting-for-acceptance, as round 3
  did over round 2).
- **Round 3's cards:** kickoff `t_2e18372a`; steps `t_c461f16c`, `t_81e24585`, `t_d6659dcf`, `t_6c9b8c2f`,
  `t_35a69aed`; GLM review `t_093266a3` (APPROVE `769825ce`); gate `t_06f75ed0`; chain `t_40c2e44b`,
  `t_313aec4f`, `t_7e0acd73` (finalizer, completed by the operator), `t_b6db79eb` (acceptance); sentinel
  `t_7e8edf61` (done). **`t_b6db79eb` is not completed:** round 4 supersedes it, as round 3 superseded
  `t_f56db644`.
- **The contract still governs:** `PREBRIEF-scripting-4d.md` FINAL Rev 1.4 at `4f19b253` (sha256
  `457e2ff0…9458`), with round 3's Rev 1.5 notes on the branch; `KICKOFF-scripting-4d-1.md` at `1a26d8fa`;
  `REVISION-scripting-4d-1.md` (R1–R5, R-L1 (a)) at `c89eb69c`; `REVISION-scripting-4d-1-round-3.md` (R6–R17,
  R-L2–R-L5 (a)) at `025a2195`. **This file adds R18–R21, the review's items, and Rev 1.6 notes to the
  pre-brief, and changes nothing else.** The R5 rules (one card per step, every item answered, never complete
  with an item undone, check the predecessor first) carry over unchanged.

## 1. What round 3's checks found
Claude's eleven §6.1 checks on `5eebe09f`: **ten pass; check 1 passes except its R16 line.** Check 11 passed
locally (20/20) and on the host (a copy of PROD's database; a copy of DEV's, with 9 real template leaves; the
lock refusing against DEV's live database). Q7's gates pass with a wide margin (join +0.543 s, heal + serialize
28 ms, heap +2.5 MB). Evidence: `devtasks/harness/checks/scripting-4d/README.md`, "Results on DEV `5eebe09f`",
and the passdown `Atrium-Passdown-2026-10-31-scripting-4d-1-round-3-checks.md` (at `8fadf87`).

- **F5 (LOW; R16 not delivered, and the Q3 prompt never named objects).** `apps/client/src/app.js` L3222 (the
  Behaviour form's `nodeName`, which the Q3 Enable prompt uses) and L3268 (the import panel's) are both
  `(id) => (client.som?.resolveObjectId?.(id)?.name ?? id)`. `resolveObjectId` returns `{ node }` or
  `{ problem }` (`packages/som/src/SOMDocument.js` L1116), never a node, so `.name` is always undefined and both
  texts show the raw id. Seen in the browser (`probe_r16.py`): grant line `It can change: 163c3b30-…`, prompt
  `It can also change: 163c3b30-…`. **Why the tests passed:** every unit test injects its own `nodeName`, and
  `apps/client/tests/behavior-wiring.test.js` L226 pins the wrong expression as text. L3222 was the same in
  round 2. The other callers read the shape correctly (`runner.js` L157 and L272 `?.node`; `behavior-clips.js`
  L60 `resolved?.node ?? resolved`).
- **F6 (LOW; the lifetime lock's reach).**
  - **(a)** The 4c server a rollback runs (`14ab0076`) predates R8 and creates no `<db>.lock`, so while it runs
    the scripts can't tell. Rehearsed: a reconcile dry run with 4c up exits 0. §8's procedure never runs a
    script while 4c is up (step 2 is on the copy, step 4 is after the fix is redeployed), so this needs a line
    in the procedure, not code.
  - **(b)** The lock path is the path *string* (`resolveDbPath` and the scripts use `resolve()`, and
    `lockPathFor` appends `.lock`). With a server on `/tmp/lk/link.db`, export refused through that spelling
    and **proceeded through a symlink to the same file**. The server's own refusal to start a second server on
    one database has the same gap.

## 2. The contract (round 4)

### R18. Objects are named through the SOM's real return shape (F5)
- **One helper**, exported from a client module the tests can import (suggested:
  `apps/client/src/behavior-form.js` or a new `apps/client/src/object-name.js`):
  `objectNameOf(som, id)` → `som?.resolveObjectId?.(id)?.node?.name` when it's a non-empty string, otherwise
  `id`. Every `{ problem }` (`not-found`, `ambiguous`, `unaddressable`) gives the id.
- **`app.js` L3222 and L3268 both call it** (`nodeName: (id) => objectNameOf(client.som, id)`); no other copy
  of the expression remains in `apps/client/src/`.
- **Tests, against a real `SOMDocument`** (AGENTS.md: real implementations, no throwaway fakes): a node with
  an `objectId` and a name gives the name; an unknown id gives the id; two nodes sharing an id (`ambiguous`)
  give the id; a nameless node gives the id. Then the two texts end to end through the real helper:
  `enablePromptText(leaf, { nameOf: (id) => objectNameOf(som, id) })` names the target, and the import panel's
  grant line (`graph-import-panel.test.js`, with `deps.nodeName` built from the helper over a real SOM) reads
  `It can change: <name>`.
- **`behavior-wiring.test.js` L226** pins that both `deps` objects call `objectNameOf(client.som, id)`, not the
  old expression.
- **Proof (r18):** restore `?.name` in the helper; the real-SOM tests fail. Restore the file from a saved copy.

### R19. The lock is keyed on the database's canonical path (F6 (b); R-L6)
- **`lockPathFor(dbPath)` canonicalises first:** when the file exists, `realpathSync(dbPath)`; when it doesn't
  (the server's first start), `join(realpathSync(dirname(dbPath)), basename(dbPath))`; when the directory
  doesn't exist either, the `resolve()`d path, as today. The server (`acquireServerLock`) and both scripts
  (`assertServerStopped`) derive the lock through it, so all three agree on one file for one database. The lock
  file's JSON also records the canonical `db` path, and the refusal message names it.
- **Tests (`server-lock.test.js`, child processes, port 0):** a server started on the real path → export and
  reconcile through a **symlink to the file** both refuse; a server started through the symlink → the scripts on
  the real path refuse; a **symlinked directory** (`<tmp>/alias → <tmp>/real`, the database under it) → refuse
  both ways; a second server through the symlink refuses to start. The existing three lock tests are unchanged.
- **Proof (r19):** make `lockPathFor` skip canonicalising; the symlink tests fail (the export proceeds).
- **Limit, stated in the code and in Rev 1.6:** a hard link to the database, or the same file reached through
  another mount, is not the same path after `realpath`. Out of scope.

#### R-L6. How far the offline check reaches (operator decision)
- **(a) Recommended: canonical path (R19) plus a runbook line (R20).** It closes the symlink gap in code. The
  4c window (F6 (a)) is closed by the procedure, which never runs a script there.
- (b) (a), plus a Linux-only second check: before opening the database, both scripts scan `/proc/*/fd` for
  any process holding the database's inode (`stat` device and inode, so hard links and mounts are caught too)
  and refuse naming its pid; elsewhere they warn that the check is skipped. It catches a pre-R8 server and any
  other process. About 40 more lines and two tests. The scripts run as root on the host, so `/proc` is
  readable.
- (c) The runbook line only; no code. The symlink gap stays.

### R20. Pre-brief Rev 1.6 notes (F6 (a), R19's limit)
On the branch, in `PREBRIEF-scripting-4d.md`: §0.6 "Revision 1.6 (after FINAL, round 4)" with the notes below;
the status line names Rev 1.6. **No decision changes.**
1. **§8, the procedure, step 3:** "The 4c server you roll back to holds no lifetime lock (it predates R8), so
   the scripts can't detect it. Don't run either script until step 4, after the fixed server has been deployed
   and stopped again; check `systemctl is-active atrium` reports `inactive` first."
2. **G10:** the offline check keys on the database's canonical path (R19); hard links and other mounts aren't
   covered (under R-L6 (b): "…are covered on Linux by the `/proc` check").
3. **G6/Q3:** objects in the grant line and the Enable prompt are named through `objectNameOf` (R18).

### R21. Full suites, proofs, the handoff (as R15)
Every suite, 0 skipped (per package, as AGENTS.md says; the server files one at a time under `timeout 180`);
proofs (r18) and (r19), plus any the review's items add, each quoted both ways; the Khronos subset on the build
host; the tip in both the summary and the metadata (`tip_sha`, `step`).

### 2.4 R-L7. The DEV finalizer's criterion (passdown N2; operator decision)
The finalizer's pass rule asks for `TARGET_SHA` equal to `RELEASE_SHA` "from the handoff". `atrium-deploy-gate
dev` prints `RELEASE_SHA=` (the release merge) and then deploys exactly that SHA, exiting 70 without a deploy if
it has none, so a successful deploy's `TARGET_SHA` is the release SHA by construction. But the board's handoff
keeps only the tail of the output, so the finalizer can never see the line, and it has blocked every round
(round 3's `t_7e0acd73`). The finalizer is a front-door card (the release chain), not one of the kickoff's.
- **(a) Recommended: the front door writes the finalizer's rule as what the handoff can show:**
  `DEV DEPLOY SUCCESS` (or `success: true`, `exit_code: 0`), both health lines ok, `reviewed_sha` = the reviewed
  tip, and `TARGET_SHA` a 40-character SHA. The card says why `TARGET_SHA` is the release SHA (the gate script's
  construction) and names `release/<reviewed 12 hex>` as the cross-check for the operator. `SMOKE OK` stays a
  host-journal fact the operator can read.
- (b) Keep the rule; the operator clears the finalizer each round with the one-line command (status quo).
- (c) Have the deployer's handoff carry `release_sha`. That needs the deploy tool to return the gate's first
  lines; it's a host change (atrium-ops), not this repository.

### 2.5 The second outside review's findings
*(To be added when the review of `3cfeeed9..769825ce` returns: each finding checked by Claude against the
source, given an item number from R22 on with its tests and proof, and placed on a card in §3.)*

## 3. The cards, their steps and their items
R5's rules hold: **one card per step**, the items listed in the body, the handoff answers each one with files
and test names, never complete with an item undone, check the predecessor first, progress comments. **Each
card's body says: "The review is a single GLM review; Nemotron is benched (F-8)."** Commit subjects:
`scripting-4d-1 round 4 step <N> (<items>): …`. *(The review's items may add or extend cards.)*

### Card 1: the client — R18
Precondition: `HEAD` = `769825ce3781b5bb4de03f4d7687b37cd9f0d46a`, worktree clean. Files: the helper's module,
`apps/client/src/app.js`, their tests (`behavior-wiring.test.js`, `graph-import-panel.test.js`,
`behavior-form.test.js` or the helper's own test file). Run `apps/client` and `packages/som`; proof (r18).

### Card 2: the lock — R19 (and, under R-L6 (b), the `/proc` check)
Files: `packages/server/src/server-lock.js`, `packages/server/src/index.js` (only if the start needs it),
`packages/server/scripts/behaviors-export.mjs`, `behaviors-reconcile.mjs`, `server-lock.test.js`,
`behaviors-rollback.test.js`. Run those two test files and the server's start/stop test, each alone under
`timeout 180`; proof (r19).

### Card 3: the pre-brief notes, full suites, proofs, the handoff — R20, R21
`PREBRIEF-scripting-4d.md` Rev 1.6 (§0.6, the §8 step-3 line, the G10 and G6/Q3 notes, the status line); then
R21.

### Card 4: the GLM review of round 4 (`4f19b253..<tip>`), cap 14400 s
A single GLM review: round 4's commits read closely, rounds 2–3 for regressions; it reproduces every proof
including (r18) and (r19). Then the gate, publish, DEV (`set-dev` over the unaccepted round 3), the finalizer
(under R-L7), acceptance.

### Before DEV acceptance
1. **Claude's §6.1 checks on the new DEV SHA:** `c1.py` (its R16 line must now pass), `probe_r16.py`, `c11.py`
   with a symlink case added (the script refuses through a symlink while the server is up), and the quick set
   `c2.py`, `c5.py`. Checks 9 and 10 again only if the review's items touch their areas.
2. **A short outside review of round 4's delta** (`769825ce..<tip>`), by the same reviewer.
3. DEV acceptance (§7 of the pre-brief), then MAIN.

## 4. Cleanup — do it before this round's kickoff
Archive round 1's sentinel `t_adf3ee2b` first, then its gate `t_d0639e09` (the sentinel first: archiving a
parent promotes its children).
```bash
hermes kanban --board atrium archive t_adf3ee2b
hermes kanban --board atrium archive t_d0639e09
```
**Why before:** `t_adf3ee2b` is now the board's **only** open sentinel (round 2's and round 3's are done). The
guard links "the workflow's single open sentinel" to every new review gate and DEV finalizer
(`atrium-kanban-guard` `_link_sentinel`), so if it is still open while round 4's sentinel doesn't exist yet,
round 4's gate could be linked to round 1's sentinel. With it archived, round 4's sentinel is the only open one,
and the guard makes round 4's two links itself.

## 5. Kickoff body for round 4
*(Written once the review's items are in §2.5, from round 3's §5 with these changes. Listed now so they're
decided together.)*
- **Front door, before creating anything:** confirm §4's cleanup is done (`t_adf3ee2b` and `t_d0639e09`
  archived); check this file's commit is on `origin/main` and compute its sha256; create **round 4's sentinel
  first** (`Scripting-4d-1 r4 sentinel (scripting-4d-1)`, `t_7e8edf61`'s shape).
- **Sentinel links:** with one open sentinel, the guard links it to round 4's review gate and DEV finalizer when
  they're created. The front door **reads the sentinel back after each** and links any that's missing (gate →
  sentinel, finalizer → sentinel, never the reverse). Never link it to a human gate (the guard refuses).
- **The references block** adds round 3's revision (`025a2195`, `71171bed…`, 33,040 bytes) and this file.
- **Titles:** `Implement r4 step <N> — scripting-4d-1`, `GLM review r4 — scripting-4d-1`,
  `Review gate r4 — scripting-4d-1`; `review_round: round-4`.
- **Card 1's precondition** is `769825ce`; the range check lists round 2's eight commits, round 3's five, then
  one `round 4 step <N>` commit per earlier card.
- **The finalizer's rule:** under R-L7.
- Round 3's acceptance card `t_b6db79eb` and round 2's `t_f56db644` stay blocked: never complete, block or reuse
  them.
