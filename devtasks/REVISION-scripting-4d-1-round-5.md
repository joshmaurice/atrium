# Revision — scripting-4d-1 round 5 (round 4 is on DEV, not accepted)

**Status: Rev 0, approved by the operator (2026-10-31 15:47 PT): R-L9 (a), the lock database's journal in memory.** Five items, R25–R29, continuing round 4's
numbering: the two findings of **the outside review of round 4** (`REVIEW-scripting-4d-1-round-4-code.md`, in
`devtasks/`; NO-GO; its M1 and M2), **both reproduced by Claude with the round-4 code**; Claude's F7 from the
round-4 browser checks, which the review assessed and agreed with; and the stale comment Hermes noted. One
decision, **R-L9** (§2), decided (a). The kickoff body is §5. Everything else in round 4 held: the review
judged R18, R20, R23 and R24 delivered, and R19 and R22 delivered except for these two findings.

- **Base:** round 4's reviewed tip `85669db0f8a9c97f98a1c3b54293f7d7105cf642` on `workflow/scripting-4d-1`
  (published). DEV is its release merge `1d4ccf17e62e9a94bb577d9c8ee694439a57c44b`,
  `WAITING_FOR_HUMAN_DEV_ACCEPTANCE`; **it is not accepted.** Round 5 commits on top of `85669db0` on the same
  branch, one commit per step, and redeploys DEV over round 4 (`set-dev` from waiting-for-acceptance).
- **Round 4's cards:** steps `t_2eeb1557`, `t_343624e0`, `t_714ca3f2`, `t_e2f8a912`; GLM review `t_c728de60`
  (APPROVE `85669db0`); gate `t_76440821`; chain `t_59fd393c`, `t_07d3e664`, `t_485c5a5d` (finalizer, PASS
  under R-L7 (a)); acceptance `t_80abe650`; sentinel `t_bc296ffe` (done; the guard linked it). **`t_80abe650` is
  not completed:** round 5 supersedes it, as round 4 superseded `t_b6db79eb`.
- **The contract still governs:** `PREBRIEF-scripting-4d.md` FINAL Rev 1.4 at `4f19b253` (sha256
  `457e2ff0…9458`), with the Rev 1.5 and Rev 1.6 notes on the branch; `KICKOFF-scripting-4d-1.md` at `1a26d8fa`;
  `REVISION-scripting-4d-1.md` (R1–R5) at `c89eb69c`; `REVISION-scripting-4d-1-round-3.md` (R6–R17) at
  `025a2195`; `REVISION-scripting-4d-1-round-4.md` (R18–R24, R-L6–R-L8 (a)) at `c4b87111`. **This file adds
  R25–R29 and Rev 1.7 notes, and changes nothing else** except, under R-L9 (a), one line of R22's mechanism (the
  lock database's journal mode). The R5 rules carry over unchanged.

## 1. What round 4's review and checks found
Claude's checks on `1d4ccf17` (the checks README, "Results on DEV `1d4ccf17`"): R18, R22, R23, R24 hold; checks
1–8 and 11 pass; the operator's host block passes. The outside review (source-based; it couldn't clone or run
`pnpm`) reproduced two lock flaws at the SQLite level. **Claude reproduced both with the round-4 code**
(`acquireLock` from `packages/server/src/server-lock.js` at `85669db0`, its own `better-sqlite3`):

- **Its M1 → R25 (LOW in practice, a correctness hole): a dangling database symlink at first boot gives one
  database two locks.** `canonicalDbPath` (L60–73) calls `realpathSync(dbPath)`; for a symlink whose target
  doesn't exist yet that throws, and the fallback canonicalises the *link's* directory and keeps the *link's*
  name. Reproduced: `alias.db → real.db` (missing). The first server took `alias.db.lock.db` and created
  `real.db` by opening the database through the alias; a second server given the same alias then resolved it to
  `real.db` and **took `real.db.lock.db` while the first still held its lock.** It needs a brand-new database
  configured through a symlink; the host's databases exist and aren't symlinks, but the identity rule must not
  depend on that.
- **Its M2 → R26 (LOW on the host, real elsewhere): a root script killed mid-lock can stop the service from
  starting.** With `journal_mode = DELETE`, `BEGIN EXCLUSIVE` on the empty lock database makes SQLite create a
  512-byte `<db>.lock.db-journal` (seen on the host: `atrium.db.lock.db-journal`, 512 B, `-rw-r--r--`).
  `matchDatabaseOwnership` covers the lock database and the sidecar, not the journal. Reproduced: a root
  `reconcile` holder `kill -9`'d in a root-owned sticky directory (`1777`) leaves a root-owned journal, and the
  service user's acquire then fails with **`could not lock …: disk I/O error`** (it can't delete or roll back
  root's journal). In a service-owned `0700` directory the same sequence recovers, which is the host's layout,
  so the host isn't exposed today.
- **F7 → R27 (LOW; operations): the SIGTERM/SIGINT handlers exit 143/130, and systemd marks every clean stop
  `failed`.** `packages/server/src/index.js` L91–92 (round 3's R8, kept in round 4). DEV's journal: round 2's
  server `Deactivated successfully` on both stops (10:59, 14:35 UTC); round 3's `status=143 … Failed with result
  'exit-code'` (20:25). Rev 1.6's §8 line ("check `systemctl is-active atrium` reports `inactive`") would read
  `failed`. Under R22 the OS releases the kernel lock on any exit, so the handlers do nothing the OS doesn't;
  they are the only signal or exit listeners in `packages/server/src` besides the `exit` hook. The review
  agrees: "dropping both SIGTERM/SIGINT handlers is appropriate."
- **N3 (Hermes, on `t_80abe650`):** `packages/server/src/db.js` L19–21 still says the scripts and the lock agree
  on `<db>.lock`.

The review's other observations need no item: the sidecar decides nothing; `BEGIN EXCLUSIVE` on an empty
database does take the lock; `testLockHoldHook` is inert without its variable; SQLite's locks are as good as the
filesystem's (local disks yes, NFS no; R-L6 (a) already scopes hard links and other mounts out).

## 2. The contract (round 5)

### R25. A dangling symlink resolves to its target (its M1)
- `canonicalDbPath` follows symlinks in the **last component even when the target doesn't exist yet**: while
  `lstat` says the path is a symlink, `readlink` it (a relative target resolves against the link's directory),
  at most 40 hops, then a loop error; the final path's directory is canonicalised with `realpathSync` and its
  basename kept. A path that exists still goes through `realpathSync`. A missing path that isn't a symlink keeps
  today's rule (canonical directory + basename, or the `resolve()`d path when the directory is missing too).
- **Tests (`server-lock.test.js`, child processes):** (1) the review's sequence: `alias.db → real.db` with
  `real.db` missing; a server starts through the alias and creates the database; **a second server through the
  alias, and one on `real.db`, both refuse**; both scripts refuse through either spelling; (2) a relative
  dangling link (`alias.db → real.db`, no directory); (3) a two-hop chain (`a → b → real.db`, `real.db`
  missing); (4) a loop (`a → b → a`) refuses with a clear message instead of hanging. `canonicalDbPath`'s unit
  test gains the dangling, relative and chained cases.
- **Proof (r25):** drop the dangling-link branch (round 4's shape); test (1) fails, with two servers running.

### R26. The lock database keeps no journal on disk (its M2; R-L9)
Under **R-L9 (a)**:
- `acquireLock` sets **`journal_mode = MEMORY`** on the lock database instead of `DELETE`, before `BEGIN
  EXCLUSIVE`, and checks the mode it gets back is `memory`, refusing with the reason if not. The lock database
  holds no data and nothing is ever written in it, so an in-memory journal loses nothing, and **no
  `<db>.lock.db-journal` file is ever created**, so none can be left behind, owned by anyone. The kernel lock
  itself is unchanged. Claude checked this with `better-sqlite3`: with `journal_mode = MEMORY` no journal file
  exists while the lock is held; a second process gets `SQLITE_BUSY`; and after `kill -9` of a root holder in a
  `1777` directory, the service user (`nobody`) acquires at once.
- **A journal left by round 4** (a crash of a round-4 holder) is SQLite's to roll back on the next open, as
  today. The release note says so; on the host it is service-owned in a service-owned directory, which recovers.
- **Tests:** (1) while a holder holds the lock, and after it is `kill -9`'d, **no `<lock db>-journal` file
  exists**, for the server and for each script; (2) `journal_mode` reads back `memory`; (3) round 4's exclusion,
  `kill -9`, sidecar and ownership tests unchanged and green; (4) a leftover 512-byte service-owned journal (made
  the round-4 way, `journal_mode = DELETE` and `kill -9`) doesn't stop the next acquire. These need no second
  user, so they run in the build sandbox; **the cross-user case (a root holder `kill -9`'d in a `1777` directory,
  then the service user) is Claude's §6.1 check**, run as root.
- **Proof (r26):** restore `journal_mode = DELETE`; test (1) fails (the journal file appears).

#### R-L9. How the lock database avoids a journal file (operator decision)
- **(a) Recommended: `journal_mode = MEMORY` on the lock database.** One line; no file to own, clean up or race
  on; no first-start initialisation.
- (b) The review's suggestion: initialise the lock database to a non-empty SQLite database once (a table), so
  `BEGIN EXCLUSIVE` with no writes creates no journal. It needs a race-safe first initialisation (two first
  starts at once), and a journal can still appear if anything ever writes there.
- (c) Keep `DELETE` and `chown` the journal to the database's owner after acquiring. It doesn't help after a
  crash between creation and `chown`, which is the failing case.

**Decided: (a).**

### R27. The server ends by the signal, so systemd records a clean stop (F7)
- `packages/server/src/index.js` **drops the SIGINT and SIGTERM handlers** (`process.exit(130)` /
  `process.exit(143)`). The `exit` hook may stay; it does nothing harmful. The kernel lock is released by the OS
  when the process ends by the signal.
- **Tests (`server-lock.test.js`, a real server child):** after `SIGTERM` the child's exit is **`code === null`,
  `signal === 'SIGTERM'`** (what systemd records as a clean stop); the same for `SIGINT`; and the lock is free at
  once afterwards (a script acquires). Round 4's tests that `SIGTERM` a child stay green.
- **Proof (r27):** restore the SIGTERM handler; the exit test fails (`code 143`, signal `null`).

### R28. Rev 1.7 notes and the stale comment
- `packages/server/src/db.js` L19–21: the comment names `<canonical db>.lock.db` (R22) and R19's canonical path.
- On the branch, `PREBRIEF-scripting-4d.md` §0.7 "Revision 1.7 (after FINAL, round 5)", the status line naming
  Rev 1.7. **No decision changes.**
  1. **§8, step 3** (and §0.6's copy of it): "…check `systemctl is-active atrium` reports anything but `active`
     (`inactive` after a clean stop; `failed` only if it crashed) first."
  2. **G10, the offline check:** a dangling symlink resolves to its target (R25); the lock database's journal is
     in memory, so no journal file exists (R26, R-L9); the server ends by the signal (R27).

### R29. Full suites, proofs, the handoff (as R21)
Every suite, 0 skipped (per package; the server's test files one at a time under `timeout 180`); proofs (r25),
(r26), (r27), each quoted both ways (break the code, the named test fails; restore from a saved copy, never
`git checkout`; green); the Khronos subset on the build host; the tip in both the summary and the metadata
(`tip_sha`, `step`).

## 3. The cards, their steps and their items
R5's rules hold: **one card per step**, the items listed in the body, the handoff answers each one with files
and test names, never complete with an item undone, check the predecessor first, progress comments. **Each
card's body says: "The review is a single GLM review; Nemotron is benched (F-8)."** Commit subjects:
`scripting-4d-1 round 5 step <N> (<items>): …`.

### Card 1: the server — R25, R26 (as R-L9), R27, R28's `db.js` comment
Precondition: `HEAD` = `85669db0f8a9c97f98a1c3b54293f7d7105cf642`, worktree clean. Files:
`packages/server/src/server-lock.js`, `packages/server/src/index.js`, `packages/server/src/db.js`,
`packages/server/test/server-lock.test.js` (and `behaviors-rollback.test.js` only if a script's behaviour
changes). Run those test files and the server's start/stop test, each alone under `timeout 180`; proofs (r25),
(r26), (r27).

### Card 2: the pre-brief notes, full suites, proofs, the handoff — R28's notes, R29
`PREBRIEF-scripting-4d.md` Rev 1.7 (§0.7, the §8 step-3 line and §0.6's copy, the G10 note, the status line);
then R29.

### Card 3: the GLM review of round 5 (`4f19b253..<tip>`), cap 14400 s
A single GLM review: round 5's commits read closely, rounds 2–4 for regressions; it reproduces (r25), (r26) and
(r27). Then the gate, publish, DEV (`set-dev` over the unaccepted round 4), the finalizer (R-L7 (a), as round
4), acceptance.

### Before DEV acceptance
1. **Claude's checks on the new DEV SHA:** `c11.py`, plus two cases added: the review's dangling-symlink
   sequence, and **the cross-user crash**: a root `reconcile` holder `kill -9`'d in a `1777` directory, then the
   service user's server starts. `c1.py` and `c5.py` as a quick regression of the client and runner.
2. **The operator's host block** (it changes little): the copies and the lock as for round 4, **no
   `atrium.db.lock.db-journal`** beside DEV's live lock, and one `systemctl restart atrium-dev` whose journal
   line reads `Deactivated successfully`, the first clean stop recorded by a 4d server.
3. **A short outside review of round 5's delta** (`85669db0..<tip>`), by the same reviewer.
4. DEV acceptance (§7 of the pre-brief), then MAIN.

## 4. Cleanup
None. No sentinel is open (round 4's `t_bc296ffe` is done), so the guard links round 5's sentinel to its review
gate and DEV finalizer itself, as it did in round 4.

## 5. Kickoff body for round 5

**For the front door.** Do these before creating anything:
1. Confirm no sentinel on the board is open (`todo`, `ready`, `running` or `blocked`). If one is, stop and tell
   the operator.
2. Check that this file's commit is on `origin/main`, and compute its sha256.
3. Create **round 5's sentinel first**: the same shape as `t_bc296ffe`, titled
   `Scripting-4d-1 r5 sentinel (scripting-4d-1)`. It names round 5's revision (commit, sha256, bytes) beside the
   earlier ones; its parents are round 5's review gate and DEV finalizer; it keeps the dependency-hold clause
   ("If you are dispatched before round 5's review gate is linked and this card has no parent, do not complete:
   kanban_block(kind="dependency", …) with an explicit task_id, and stop"); never reuse `t_bc296ffe`,
   `t_80abe650`, `t_b6db79eb` or `t_f56db644`.
4. Fill the body's three placeholders:
   - `<REVISION_CHECK>`:
     `REVISION CHECK (front door): <commit>:devtasks/REVISION-scripting-4d-1-round-5.md sha256 <hash>, <bytes> bytes, matches.`
   - `<SENTINEL_ID>`: the new sentinel's id.
   - `<CANONICAL_REQUIREMENTS>`: the canonical worker-card requirements, verbatim, the same text as rounds 1–4.
     The doc supplies the `#### WORKER-CARD REQUIREMENTS (canonical)` heading; don't paste a second one.
5. Create the kickoff card with the filled body **in its body field**, and read it back whole.
6. **The sentinel's links:** the guard links it to round 5's review gate when the kickoff creates it, and to the
   DEV finalizer when you do. Read the sentinel back after the kickoff completes and again after the finalizer
   is created; link any that's missing yourself (gate → sentinel, finalizer → sentinel, never the reverse).
   Create the finalizer and confirm its link **before** completing the review gate.
7. **The finalizer's rule** is round 4's (R-L7 (a)): pass on success (`DEV DEPLOY SUCCESS`, or `success: true`
   with `exit_code: 0`), the local and public health lines ok, `reviewed_sha` equal to round 5's reviewed tip,
   and `TARGET_SHA` a full lowercase 40-character SHA; otherwise block with `kind="capability"` quoting the
   handoff. Don't ask for `RELEASE_SHA=` or `SMOKE OK:` lines.

Keep in mind: round 4's acceptance card `t_80abe650`, round 3's `t_b6db79eb` and round 2's `t_f56db644` stay
blocked by design; round 5's chain redeploys DEV over round 4 (`set-dev` from waiting-for-acceptance). **The DEV
deploy that installs round 5 stops round 4's server, which still exits 143, so that one stop is still recorded as
`failed`;** R27 shows from the next stop on.

---

### KICKOFF — scripting-4d-1 revision round 5. Slug: `scripting-4d-1`

You are the kickoff orchestrator for round 5 of `scripting-4d-1`. Build the graph below, read it back, report,
and stop. Do not implement, review or deploy anything yourself.
- **Your tools:** only `kanban_*`.
- **Everything you need is in this body.** Nothing will be posted on this card afterwards, so don't wait for
  comments, and **never block this card.**
- **Blocking:** never call `kanban_block` without an explicit `task_id`.
- **Titles:** use them exactly as written, character for character.
- **Card bodies:** write each card's body from the bullets under its title; don't copy this kickoff's
  instructions to you into any card. The references block, the hash checks and the canonical requirements are
  copied whole. Bodies go in the body field when you create the card; read each back, and if a body is empty
  post it as the card's first comment while it's `todo`, **with the canonical requirements whole, not
  summarised**. Never create a second card in its place.
- **Create every card with its parent** (`parents=[…]`).
- **Do not create or link any sentinel.** The guard and the front door do that.

**The front door's spec check:** `SPEC CHECK (front door): 4f19b2533308ef0dc0fa3c3d8a5b4164eb389e82:devtasks/PREBRIEF-scripting-4d.md sha256 457e2ff0d018580e117bc0e3aac3ae6d4d4e90aa36a9c6dbf1106cdc10279458, 121240 bytes, matches.`

**The front door's revision check:** <REVISION_CHECK>

**The sentinel (for your report only; don't link it):** `<SENTINEL_ID>`

#### The references block (copy it whole into cards 1–3)
**The contract is in git.** Before anything else, read and check all six:

```
git -C /workspace/atrium fetch origin main
git -C /workspace/atrium show 4f19b2533308ef0dc0fa3c3d8a5b4164eb389e82:devtasks/PREBRIEF-scripting-4d.md > /tmp/prebrief.md
sha256sum /tmp/prebrief.md   # 457e2ff0d018580e117bc0e3aac3ae6d4d4e90aa36a9c6dbf1106cdc10279458
git -C /workspace/atrium show 1a26d8faba708c7784d1ae283670921d4608ae3b:devtasks/KICKOFF-scripting-4d-1.md > /tmp/kickoff-r1.md
sha256sum /tmp/kickoff-r1.md   # 426626027d62a624296d0c4971f179bd4d26c67688fae63f35a87e35d2132b5c
git -C /workspace/atrium show c89eb69c:devtasks/REVISION-scripting-4d-1.md > /tmp/revision-r2.md
sha256sum /tmp/revision-r2.md   # f3a73cd37502b49197a03490feedf7e4014088d3522f809669de4c00a4f5b514
git -C /workspace/atrium show 025a2195a5bca7fbc72f81e1090ef82f1f313f1b:devtasks/REVISION-scripting-4d-1-round-3.md > /tmp/revision-r3.md
sha256sum /tmp/revision-r3.md   # 71171bedff8d315c5409e71838bf3ca3cfe2758271655e29f9404d3a40159541
git -C /workspace/atrium show c4b87111923a065aa4e1e93c59e2864abca14cf6:devtasks/REVISION-scripting-4d-1-round-4.md > /tmp/revision-r4.md
sha256sum /tmp/revision-r4.md   # 6434df5c3e6b30740f925ae7e1c409e090f135f600227640ce1c000765a251f2
git -C /workspace/atrium show <revision commit>:devtasks/REVISION-scripting-4d-1-round-5.md > /tmp/revision-r5.md
sha256sum /tmp/revision-r5.md   # <revision hash>
```

(Fill the two `<revision …>` values from the front door's revision check above.) On any mismatch, block with
`kind="capability"`, quote both hashes, and do not work from a different text.

- **The round-5 revision is this round's contract:** its §2 (R25–R29, with R-L9 decided (a)) and its §3, which gives **your card's** items and handoff.
- **Also binding:** the pre-brief (FINAL Rev 1.4, with the Rev 1.5 and 1.6 notes on the branch); the round-1
  kickoff's Settlement and its "Requirements for the implementation AND review cards (beyond the spec)", items
  1–7; the round-2 revision (R1–R5, R-L1 (a)); the round-3 revision (R6–R17, R-L2–R-L5 (a)); the round-4 revision
  (R18–R24, R-L6–R-L8 (a)); the GLM brief, run 1148's summary on `t_255de53b`.
- **The review is a single GLM review; Nemotron is benched (F-8).**

#### Graph — build exactly this
Cards 1–2 are assigned to `atrium-deepseek` and created with `max_runtime_seconds=14400`. Card 1's parent is
this kickoff, card 2's is card 1.

**Every implementation card's body** carries: the references block; the line
`Your items: the round-5 revision's §3, "<card heading>".` with that card's heading as below; the worktree rule;
the step rule; the canonical requirements.

**The worktree rule:** work in the existing persistent worktree `/workspace/wt/scripting-4d-1`, on
`workflow/scripting-4d-1`. Before changing anything:

```
cd /workspace/wt/scripting-4d-1
git status --porcelain                                            # must print nothing
git rev-parse HEAD                                                # must equal the tip your parent card reported (card 1: 85669db0f8a9c97f98a1c3b54293f7d7105cf642)
git log --format='%h %s' 4f19b2533308ef0dc0fa3c3d8a5b4164eb389e82..HEAD   # round 2's eight commits, round 3's five, round 4's four, then one `round 5 step <N>` commit per earlier card
pnpm install --frozen-lockfile --prefer-offline
readlink -f packages/server/node_modules/@atrium/protocol          # must resolve inside this worktree
```

On any mismatch, block with `kind="needs_input"`, quote what you saw, and touch nothing. Commit locally and
never push. Commit subjects: `scripting-4d-1 round 5 step <N> (<items>): …`, one commit per card.

**The step rule:** do **your card's items and no other**; your handoff (the completion summary **and** metadata
`tip_sha`, `step`) marks **every item** done with its files and test names, plus the round-2 revision's §3
handoff list; **never complete with an item undone**: block with `kind="needs_input"` naming what is left; a
progress comment after each item group and each commit. **If the completion's summary or metadata doesn't take,
post the whole handoff as a comment headed `R29 HANDOFF — round 5 step <N>` before completing.**

1. `Implement r5 step 1 — scripting-4d-1`. Heading: "Card 1: the server — R25, R26 (as R-L9), R27, R28's
   `db.js` comment".
2. `Implement r5 step 2 — scripting-4d-1`. Heading: "Card 2: the pre-brief notes, full suites, proofs, the
   handoff — R28's notes, R29".
3. `GLM review r5 — scripting-4d-1`. Assignee `atrium-glm`, parent: card 2, `max_runtime_seconds=14400`.
   - The body opens with the exact line
     `THIS RUN HAS TERMINAL, FILE AND GIT TOOLS. Use them for every step below.`
   - Then: the references block; "Your review: the round-5 revision's §3, 'Card 3: the GLM review of round 5'";
     the range is `4f19b253..<tip card 2 reported>`, with round 5's commits read closely and rounds 2–4 for
     regressions; review in your own detached worktree at `/workspace/wt/review-<your task id>` at that tip,
     never in the persistent one; reproduce (r25), (r26) and (r27); the canonical requirements.
   - The verdict is APPROVE or CHANGES_REQUIRED, with the exact lowercase 40-character SHA when approving, and
     metadata `verdict`, `reviewer_role`, `review_round: round-5`, `findings_count` and the maximum severity.
4. `Review gate r5 — scripting-4d-1`. Assignee `atrium-orchestrator`, parent: card 3. It creates nothing. Its
   body says: **"A single GLM review is the whole review; Nemotron is benched (F-8). Do not ask for another."**
   - **On a valid APPROVE of the exact 40-character SHA,** it blocks with `kind="needs_input"` and the reason
     `APPROVE <SHA40>: front door, build the release chain`.
   - **Otherwise,** it blocks for the operator with the verdict quoted.
5. **The release chain is the front door's:** publish, DEV (`set-dev` over the unaccepted round 4), the
   finalizer, acceptance, at card 4's APPROVE. Nothing reaches MAIN or PROD.

#### Report back
- the four ids, each with its parent;
- each implementation card's and the review's `max_runtime_seconds` (14400);
- that cards 1–3 each carry the references block with the filled revision commit and hash, and the canonical
  requirements whole, in their body fields or first comments;
- the review's opening line, and the gate's F-8 line;
- that you created and linked **no** sentinel.

Then complete this card.

#### WORKER-CARD REQUIREMENTS (canonical)
<CANONICAL_REQUIREMENTS>
