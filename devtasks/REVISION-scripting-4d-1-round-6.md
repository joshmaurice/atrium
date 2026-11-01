# Revision — scripting-4d-1 round 6 (round 5 is on DEV, not accepted)

**Status: Rev 0, for the operator's approval (not approved).** Three items, R30–R32, continuing round 5's
numbering: the must-fix of **the outside review of round 5** (`REVIEW-scripting-4d-1-round-5-code.md`, in
`devtasks/`; NO-GO; its M1), **reproduced by Claude with the round-5 code, together with a sibling layout the
review didn't find**; the review's nit N1 (Claude's N4); and the suites and handoff. **No decision**: the fix is
mechanical. The review judged R26, R27 and R28 delivered and R25 partly (this M1). The kickoff body is §5.

- **Base:** round 5's reviewed tip `e536913011cc72bd6bad845f76d638bea843ddc1` on `workflow/scripting-4d-1`
  (published). DEV is its release merge `ddef0a31f3a484453d0ed5dd28353ffff35a4842`,
  `WAITING_FOR_HUMAN_DEV_ACCEPTANCE`; **it is not accepted.** Round 6 commits on top of `e5369130`, one commit,
  and redeploys DEV over round 5 (`set-dev` from waiting-for-acceptance).
- **Round 5's cards:** kickoff `t_d365902a`; steps `t_34652692`, `t_bdb742d4`; GLM review `t_2436e620`; gate
  `t_4dae5352`; sentinel `t_e7a9ca2c`; acceptance `t_52cc4953`. **`t_52cc4953` is not completed:** round 6
  supersedes it, as round 5 superseded `t_80abe650`.
- **The contract still governs:** `PREBRIEF-scripting-4d.md` FINAL Rev 1.4 at `4f19b253` (sha256
  `457e2ff0…9458`), with the Rev 1.5–1.7 notes on the branch; the kickoff at `1a26d8fa`; the revisions of rounds 2
  (`c89eb69c`), 3 (`025a2195`), 4 (`c4b87111`) and 5 (`7333cce2`). **This file adds R30–R32 and a Rev 1.8 note,
  and changes nothing else.** The R5 rules carry over unchanged.

## 1. What round 5's review found
**Its M1 → R30: R25 still splits one database into two locks when a dangling link's target is read as text.**
R25 follows a dangling last-component symlink with `resolve(dirname(path), readlink(path))` (`server-lock.js`
L102). `path.resolve` folds `..` *as text*, before the kernel has followed a symlinked directory in the path,
so the lock is computed for a different file than the one SQLite then creates. **Claude reproduced the review's
layout with the round-5 code** (`linkdir → real/child`, `real/child/alias.db → ../target.db`, the target
missing): the first server took `<root>/target.db.lock.db`, created the database at `<root>/real/target.db`
through the alias, and **a second server through the same alias then took `<root>/real/target.db.lock.db` while
the first held its lock.**

**The root cause is wider than that line, and a sibling layout splits too.** Node's `fs.realpathSync` (its
JavaScript implementation) also starts with `path.resolve`, so it folds `..` as text as well; only
`fs.realpathSync.native` (libc `realpath`) resolves the way the kernel does. Claude checked round 5 and a fix
against one invariant: **the lock path computed before the database exists must equal the one computed after
Atrium has created the database through the same configured path.** Round 5 breaks it in two of six layouts:

| Layout (the database missing at first) | Round 5 | The fix below |
|---|---|---|
| a plain dangling link (`a.db → real.db`) | OK | OK |
| **the review's:** a symlinked directory and a relative `../` target | **split** | OK |
| **an absolute target through a symlinked directory and `..`** (`a.db → /…/linkdir/../t.db`; not in the review) | **split** | OK |
| `..` in the configured path itself (`…/linkdir/../x.db`) | OK* | OK |
| a two-hop relative chain | OK | OK |
| no link, a missing file | OK | OK |

\* Not a split: Atrium opens `path.resolve(ATRIUM_DB_PATH)` (`db.js` `resolveDbPath`), so the server, the scripts
and the lock all read a `..` in the *configured* path the same textual way. Only link *targets* are followed by
the kernel, so only they must be resolved the kernel's way.

The host is not exposed: its databases exist and are configured as plain paths. The rule must still hold.

**Its N1 → R31 (nit):** a symlink loop makes the server exit through `legacyLockExists` (`index.js` L72, before
the guarded `acquireLock`) with Node's uncaught-error trace instead of `Atrium server refuses to start: …`.
Fail-closed (no lock is taken, nothing is opened), so it's cosmetic.

## 2. The contract (round 6)

### R30. Link targets are resolved the way the kernel resolves them (its M1, and the sibling)
- `canonicalDbPath` **starts from `resolve(dbPath)`**, exactly the path Atrium opens (unchanged: `db.js` and the
  scripts already use it), and then **never folds `..` as text again**:
  - existence is tested with **`realpathSync.native`**, never the JavaScript `realpathSync`;
  - a dangling link's next path is built **by string concatenation**: an absolute target is taken as it is; a
    relative one becomes `dirname(path) + '/' + target`. Never `resolve` or `join` on a path that may still
    contain `..` after a symlink;
  - at the end, `join(realpathSync.native(dirname(path)), basename(path))`; when that directory is missing too,
    the path as it stands. The hop cap (40) and the loop error stay.
  - **The same function** serves the server and both scripts, as now; no other code computes the lock path.
- **Tests (`server-lock.test.js`):**
  1. **The invariant, table-driven, over the six layouts above** (in a temp directory): for each, the lock path
     before the database exists equals the one after it is created through `resolve(configured path)`, and
     equals `realpathSync.native(<the created file>) + '.lock.db'`.
  2. **End to end, for the review's layout and the absolute-target layout:** a server through the alias creates
     the database; a second server through the same alias and one on the real path both refuse; both scripts
     refuse through either spelling.
  3. Round 5's R25 tests and every R19/R22/R26/R27 test unchanged and green.
- **Proof (r30):** restore round 5's `resolve(dirname(path), target)` and its JavaScript `realpathSync`; tests 1
  (two layouts) and 2 fail.

### R31. A loop refuses with the server's own message (its N1)
- In `index.js`, the legacy-lock diagnostic moves **inside** the guarded start (or is guarded itself), so any
  error from `canonicalDbPath` prints `Atrium server refuses to start: <reason>` and exits 1, before anything is
  opened.
- **Test:** a server on a looping path (`a.db → b.db → a.db`) exits 1, its output starts with `Atrium server
  refuses to start:` and names the loop, and carries no stack trace.
- **Proof (r31):** move the diagnostic back above the `try`; the test fails (a trace, no prefix).

### R32. A Rev 1.8 note, full suites, proofs, the handoff
- On the branch, `PREBRIEF-scripting-4d.md` §0.8 "Revision 1.8 (after FINAL, round 6)", the status line naming
  Rev 1.8: **G10** — the lock path follows link targets the way the kernel does (`realpathSync.native`, no
  textual `..` folding after a symlink), and the invariant "the same lock before and after the database is
  created" is the test of it. No decision changes.
- Every suite, 0 skipped (per package; the server's test files one at a time under `timeout 180`); proofs (r30)
  and (r31), each quoted both ways (break, the named test fails; restore from a saved copy, never `git
  checkout`; green); the Khronos subset on the build host; the tip in both the summary and the metadata
  (`tip_sha`, `step`); the handoff also as a `R32 HANDOFF — round 6 step 1` comment before completing.

## 3. The cards, their steps and their items
R5's rules hold. **The card's body says: "The review is a single GLM review; Nemotron is benched (F-8)."**
Commit subject: `scripting-4d-1 round 6 step 1 (<items>): …`.

### Card 1: the lock path and the start message, notes, suites, proofs, the handoff — R30, R31, R32
Precondition: `HEAD` = `e536913011cc72bd6bad845f76d638bea843ddc1`, worktree clean. Files:
`packages/server/src/server-lock.js`, `packages/server/src/index.js`, `packages/server/test/server-lock.test.js`,
`devtasks/PREBRIEF-scripting-4d.md`. Then every suite as R32 says; proofs (r30), (r31).

### Card 2: the GLM review of round 6 (`4f19b253..<tip>`), cap 14400 s
A single GLM review: round 6's commit read closely, rounds 2–5 for regressions; it reproduces (r30) and (r31).
Then the gate, publish, DEV (`set-dev` over the unaccepted round 5), the finalizer (R-L7 (a)), acceptance.

### Before DEV acceptance
1. **Claude's checks on the new DEV SHA:** `probe_r5.sh` with both split layouts added (the review's and the
   absolute-target one), `c11.py`, and `c1.py` as a quick regression.
2. **The operator's host block** (as round 5's; no restart needed this time).
3. **A short outside review of round 6's delta** (`e5369130..<tip>`), by the same reviewer.
4. **DEV acceptance:** the operator's §7 run on round 5's DEV carries over unless it finds something, since
   round 6 changes only `server-lock.js`, `index.js`'s start and their tests. A quick repeat of §7 step 1 on round
   6's DEV, then MAIN.

## 4. Cleanup
None. No sentinel is open (round 5's `t_e7a9ca2c` is done), so the guard links round 6's sentinel to its review
gate and DEV finalizer itself.

## 5. Kickoff body for round 6

**For the front door.** As round 5's §5, steps 1–7, with these values:
- the sentinel is titled exactly `Scripting-4d-1 r6 sentinel (scripting-4d-1)`, in `t_e7a9ca2c`'s shape, naming
  round 6's revision beside the earlier ones, with the dependency-hold clause; never reuse `t_e7a9ca2c`,
  `t_52cc4953`, `t_80abe650`, `t_b6db79eb` or `t_f56db644`;
- `<REVISION_CHECK>`: `REVISION CHECK (front door): <commit>:devtasks/REVISION-scripting-4d-1-round-6.md sha256 <hash>, <bytes> bytes, matches.`;
- the finalizer's rule is round 4's (R-L7 (a)), with `reviewed_sha` equal to round 6's reviewed tip;
- round 5's acceptance card `t_52cc4953`, and rounds 2–4's, stay blocked by design.

---

### KICKOFF — scripting-4d-1 revision round 6. Slug: `scripting-4d-1`

You are the kickoff orchestrator for round 6 of `scripting-4d-1`. Build the graph below, read it back, report,
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

#### The references block (copy it whole into cards 1–2)
**The contract is in git.** Before anything else, read and check all seven:

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
git -C /workspace/atrium show 7333cce2dec5cae544708af185dd340e5585c453:devtasks/REVISION-scripting-4d-1-round-5.md > /tmp/revision-r5.md
sha256sum /tmp/revision-r5.md   # 4aaa4187ed68606309e9ce3aaa6211072ec3c68b8f4440fbfc8d52792ef92bec
git -C /workspace/atrium show <revision commit>:devtasks/REVISION-scripting-4d-1-round-6.md > /tmp/revision-r6.md
sha256sum /tmp/revision-r6.md   # <revision hash>
```

(Fill the two `<revision …>` values from the front door's revision check above.) On any mismatch, block with
`kind="capability"`, quote both hashes, and do not work from a different text.

- **The round-6 revision is this round's contract:** its §2 (R30–R32; no new decision) and its §3, which gives **your card's** items and handoff.
- **Also binding:** the pre-brief (FINAL Rev 1.4, with the Rev 1.5–1.7 notes on the branch); the round-1
  kickoff's Settlement and its "Requirements for the implementation AND review cards (beyond the spec)", items
  1–7; the round-2 revision (R1–R5, R-L1 (a)); the round-3 revision (R6–R17, R-L2–R-L5 (a)); the round-4 revision
  (R18–R24, R-L6–R-L8 (a)); the round-5 revision (R25–R29, R-L9 (a)); the GLM brief, run 1148's summary on `t_255de53b`.
- **The review is a single GLM review; Nemotron is benched (F-8).**

#### Graph — build exactly this
Card 1 is assigned to `atrium-deepseek` and created with `max_runtime_seconds=14400`; its parent is this kickoff.

**Every implementation card's body** carries: the references block; the line
`Your items: the round-6 revision's §3, "<card heading>".` with that card's heading as below; the worktree rule;
the step rule; the canonical requirements.

**The worktree rule:** work in the existing persistent worktree `/workspace/wt/scripting-4d-1`, on
`workflow/scripting-4d-1`. Before changing anything:

```
cd /workspace/wt/scripting-4d-1
git status --porcelain                                            # must print nothing
git rev-parse HEAD                                                # must equal the tip your parent card reported (card 1: e536913011cc72bd6bad845f76d638bea843ddc1)
git log --format='%h %s' 4f19b2533308ef0dc0fa3c3d8a5b4164eb389e82..HEAD   # round 2's eight commits, round 3's five, round 4's four, round 5's two, then one `round 6 step <N>` commit per earlier card
pnpm install --frozen-lockfile --prefer-offline
readlink -f packages/server/node_modules/@atrium/protocol          # must resolve inside this worktree
```

On any mismatch, block with `kind="needs_input"`, quote what you saw, and touch nothing. Commit locally and
never push. Commit subjects: `scripting-4d-1 round 6 step <N> (<items>): …`, one commit per card.

**The step rule:** do **your card's items and no other**; your handoff (the completion summary **and** metadata
`tip_sha`, `step`) marks **every item** done with its files and test names, plus the round-2 revision's §3
handoff list; **never complete with an item undone**: block with `kind="needs_input"` naming what is left; a
progress comment after each item group and each commit. **If the completion's summary or metadata doesn't take,
post the whole handoff as a comment headed `R32 HANDOFF — round 6 step <N>` before completing.**

1. `Implement r6 step 1 — scripting-4d-1`. Heading: "Card 1: the lock path and the start message, notes, suites, proofs,
   the handoff — R30, R31, R32".
2. `GLM review r6 — scripting-4d-1`. Assignee `atrium-glm`, parent: card 1, `max_runtime_seconds=14400`.
   - The body opens with the exact line
     `THIS RUN HAS TERMINAL, FILE AND GIT TOOLS. Use them for every step below.`
   - Then: the references block; "Your review: the round-6 revision's §3, 'Card 2: the GLM review of round 6'";
     the range is `4f19b253..<tip card 1 reported>`, with round 6's commit read closely and rounds 2–5 for
     regressions; review in your own detached worktree at `/workspace/wt/review-<your task id>` at that tip,
     never in the persistent one; reproduce (r30) and (r31); the canonical requirements.
   - The verdict is APPROVE or CHANGES_REQUIRED, with the exact lowercase 40-character SHA when approving, and
     metadata `verdict`, `reviewer_role`, `review_round: round-6`, `findings_count` and the maximum severity.
3. `Review gate r6 — scripting-4d-1`. Assignee `atrium-orchestrator`, parent: card 2. It creates nothing. Its
   body says: **"A single GLM review is the whole review; Nemotron is benched (F-8). Do not ask for another."**
   - **On a valid APPROVE of the exact 40-character SHA,** it blocks with `kind="needs_input"` and the reason
     `APPROVE <SHA40>: front door, build the release chain`.
   - **Otherwise,** it blocks for the operator with the verdict quoted.
4. **The release chain is the front door's:** publish, DEV (`set-dev` over the unaccepted round 5), the
   finalizer, acceptance, at card 3's APPROVE. Nothing reaches MAIN or PROD.

#### Report back
- the three ids, each with its parent;
- the implementation card's and the review's `max_runtime_seconds` (14400);
- that cards 1–2 each carry the references block with the filled revision commit and hash, and the canonical
  requirements whole, in their body fields or first comments;
- the review's opening line, and the gate's F-8 line;
- that you created and linked **no** sentinel.

Then complete this card.

#### WORKER-CARD REQUIREMENTS (canonical)
<CANONICAL_REQUIREMENTS>
