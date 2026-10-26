# Kickoff — security hotfix: a depth bound on every WebSocket message (`message-depth-guard`)

How to use this file:
- The **front-door note** is for the front door and the operator.
- Everything between the two rules is the **kickoff body**. Post it
  verbatim on the kickoff card.
- Then post three comments on the kickoff card:
  - the canonical worker-card requirements, headed `WORKER-CARD REQUIREMENTS
    (canonical)` (the same text as scripting-4b-2's, comment 855 on
    `t_2d41531f`);
  - the spec's commit and hash;
  - the sentinel's id.

**Front-door note (check before creating the card):**
- **Base:** `base_main_sha = 380a2db74e675a8c67c2314bff86ce2c863268c4` (the
  commit that carries the FINAL pre-brief).
  - Its runtime code is identical to PROD's release `8358b043`: `git diff
    --stat 8358b043 380a2db7 -- packages apps tools pnpm-lock.yaml
    pnpm-workspace.yaml` is empty.
  - Confirm it with a host fetch of `origin/main`. Any later commit on
    `main` (this file's) must touch only `devtasks/`.
- **The base must carry `devtasks/PREBRIEF-message-depth-guard.md`,** FINAL
  Rev 0, 11,179 bytes, sha256
  `a079fe03fd016aafecb0b13e21d7c4d86f32ee5bd3fab9e99fa4ecc6184416c4`.
  **Check the hash yourself and post the commit and hash on the kickoff
  card.** The kickoff has only `kanban_*` tools and can't check it.
- **The spec goes by git reference,** as 4b-2's did.
- **`workflow/message-depth-guard` doesn't exist yet.** Do a push dry run
  first.
- **The sentinel:** create a new one for this slug and post its id. The only
  open sentinel on the board, `t_e7333c23`, belongs to scripting-4b-2's round
  5 and must not be used or completed.
- **After every create, read the card back.** If a body or field is missing
  (the known `kanban_create` field drop), post the missing text as that card's
  first comment while it's `todo`. **Never create a second card in its
  place.** Check that the implementation card's `max_runtime_seconds` is
  **7200**.
- **On the review gate's APPROVE, build the WHOLE release chain in one go:**
  Publish, DEV deploy, DEV finalizer and the acceptance gate. Use the same
  four cards and bodies as scripting-4b-2 round 5's (`t_271332b8`,
  `t_52e0c377`, `t_78ba2e7f`, `t_fbb089d1`), with this slug and the new SHA.
  Link the finalizer to this round's sentinel, and **only then** complete the
  review gate. Report every id. If `kanban_complete` drops `task_id` again,
  stop and tell the operator.
- **DEV:** this deploy **replaces scripting-4b-2's round 5 release on DEV**
  (`e3d9ab14`, not accepted; the host allows `set-dev` from
  `WAITING_FOR_HUMAN_DEV_ACCEPTANCE`). 4b-2's blocked cards (`t_78ba2e7f`,
  `t_fbb089d1`) are not touched, completed or reused. DEV restarts at the
  deploy.
- **Nothing is pushed to `main` between the DEV deploy's release merge and
  the MAIN push** (scripting-4a passdown §4.4).
- **After PROD, 4b-2 must merge `main`** (the pre-brief's G4). The operator
  hands the front door round 6's Rev 0.1, which starts with that merge.

**Operator checks before the release** (the pre-brief's G5, on the host):
- `systemctl show atrium -p Restart -p RestartSec`, and the same for
  `atrium-dev`;
- whether a PROD public world admits signed-out visitors.

---

### KICKOFF — security hotfix: a depth bound on every WebSocket message. Slug: `message-depth-guard`

You are the kickoff orchestrator for this workflow. Build the task graph
below, read it back, report, and stop. Do not implement, review or deploy
anything yourself.
- **Your tools:** only `kanban_*`.
- **`OPERATOR BLOCK:`** This body quotes that prefix for the gates it
  describes. **Never use it in a block or comment of your own.**
- **Blocking:** **never call `kanban_block` without an explicit `task_id`,
  and never block this card.**
- **Titles and bodies:** use every title and body below **exactly as
  written**. Do not invent titles: the guard refuses them.

**Wait for three comments before building anything:**
- the front door's spec commit and hash;
- the `WORKER-CARD REQUIREMENTS (canonical)` comment;
- the sentinel id.

If you are dispatched before all three are on this card, block with
`kind="needs_input"` and do nothing else.

#### Where the spec is: in git, by reference
**You don't read or check the spec.** You have no shell. The front door has
already checked it and posted its commit and sha256 on this card. **Do not
try to fetch or hash anything, and do not block for lack of a shell.** Copy
the front door's commit and hash into the brief, implementation and review
cards. Those cards have terminal, file and git tools, and each checks the
spec first with:

```
git -C /workspace/atrium fetch origin main
git -C /workspace/atrium show 380a2db74e675a8c67c2314bff86ce2c863268c4:devtasks/PREBRIEF-message-depth-guard.md > /tmp/prebrief.md
sha256sum /tmp/prebrief.md   # must be a079fe03fd016aafecb0b13e21d7c4d86f32ee5bd3fab9e99fa4ecc6184416c4
```

On a mismatch, the card blocks with `kind="capability"`, quotes both hashes,
and does not work from a different text.

- **The spec:** `devtasks/PREBRIEF-message-depth-guard.md`, **FINAL Revision
  0 (2026-10-25)**:
  - §1: the problem and the two reproductions;
  - §2: verified facts;
  - §3: **the operator's decisions G1–G5, the contract**;
  - §4: out of scope;
  - §5: settled questions;
  - §6: the tests and proofs.
- **The worker-card requirements** are a separate comment on this card,
  headed `WORKER-CARD REQUIREMENTS (canonical)`. Card bodies refer to that
  comment by its id; they never point at a host path.

#### Settlement (operator) — do not reopen
- **Base:** `base_main_sha = 380a2db74e675a8c67c2314bff86ce2c863268c4`.
  - Workflow branch: **`workflow/message-depth-guard`**, created from that
    SHA.
  - Worktree: `/workspace/wt/message-depth-guard`, made with
    `git -C /workspace/atrium worktree add -b workflow/message-depth-guard /workspace/wt/message-depth-guard 380a2db74e675a8c67c2314bff86ce2c863268c4`.
- **Scope:** G1 (the depth bound, `MAX_MESSAGE_DEPTH = 64`, before the
  schema check, iterative) and G2 (the handler's one `try/catch`), with §5's
  log line and §6's tests and proofs.
  **Not in scope:** breadth or size bounds, outbound messages, client
  changes, process-level error handlers, and anything in scripting-4b-2.
- **Files:** `packages/server/src/session.js`; one new helper module for the
  walk (for example `packages/server/src/message-depth.js`); new tests under
  `packages/server/test/` (port 0, and the server in a child process for the
  crash cases). **No protocol schema change, no client change, no other
  file.** If the brief or the implementation finds that another file must
  change, stop and ask.
- **Small server round, full pipeline, with a DEV restart.** Claude's harness
  reproductions come before DEV acceptance (G5).

#### Graph — build exactly this
1. **GLM brief** — assignee `atrium-glm`. Parent: this kickoff. Title:
   `GLM brief — message-depth-guard`.
   - Its card carries:
     - (a) this kickoff body;
     - (b) the spec reference and hash check above, with the front door's
       commit and hash copied in;
     - (c) a reference to the worker-card requirements comment.
   - The brief it writes is the **self-contained contract** for the
     implementation: G1 and G2 written out, the refusal texts exactly, §5's log
     line, every §6 test and proof, and the step list below. It may refer to
     sections of the spec, but must not leave a rule only in the spec.
2. **Operator brief-review gate** — assignee `atrium-orchestrator`.
   - Title exactly `OPERATOR BLOCK: awaiting human brief review — message-depth-guard`.
   - Created with `initial_status="blocked"`. Parent = the GLM brief.
   - Body exactly: `OPERATOR BLOCK: human brief-review gate. Only the operator completes this. An agent dispatched here must kanban_block(kind="needs_input") on this card and do nothing else.`
   - Read it back and confirm `status == "blocked"` with no runs.
3. **DeepSeek implementation** — assignee `atrium-deepseek`. Title:
   `Implement — message-depth-guard`.
   - **Its parent MUST be the gate** (step 2), not the brief.
   - Create it with **`--max-runtime 2h`** (7200 s), passed explicitly.
   - Its body carries:
     - the spec reference and hash check;
     - the instruction to **read the GLM brief's card, comments included**,
       as the contract;
     - the worktree command above, with `-b`;
     - the requirements below;
     - the worker-card requirements reference.
4. **One GLM review** — assignee `atrium-glm`. Title:
   `GLM review — message-depth-guard`. Parent: the implementation.
   - A **single** review.
   - Its body opens with the exact line `THIS RUN HAS TERMINAL, FILE AND GIT TOOLS. Use them for every step below.`
   - Then the spec reference and the requirements below.
5. **Review gate** — assignee `atrium-orchestrator`. Title:
   `Review gate — message-depth-guard`. Parent: the review. It **creates
   nothing**.
   - **On a valid APPROVE** naming the exact 40-character SHA, it blocks with
     `kind="needs_input"` and the reason
     `APPROVE <SHA40>: front door, build the release chain`.
   - **On a missing, malformed or non-APPROVE verdict,** it blocks for the
     operator with the verdict quoted.
6. **Sentinel** — the front door creates it and posts its id here; it is
   parented on this kickoff.
   - **Before you complete,** link the review gate to the sentinel as an
     additional parent: `kanban_link(parent_id=<review gate id>, child_id=<sentinel id>)`.
   - The front door later adds the DEV finalizer as a further parent.
   - Do not create a second sentinel, and never complete it.
   - **`t_e7333c23` is another workflow's sentinel:** never link to it.
7. **Nothing reaches MAIN or PROD.** Those are host-side, operator-approved
   steps.

#### Release chain (the front door builds it, whole, on the gate's APPROVE)
These are the same four cards as scripting-4b-2 round 5's, with this slug and
the new SHA.
- Every body carries the full 40-character reviewed SHA.
- The DEV deploy runs the host's automatic release merge, so DEV, MAIN and
  PROD may run a `RELEASE_SHA` that differs from the reviewed SHA.
- **The publish, DEV deploy and finalizer cards make one call each.** On any
  refusal, non-zero exit or unexpected message, they do not retry: they block
  with `kind="capability"` and the complete output verbatim.

#### Requirements for the implementation AND review cards (beyond the spec)
1. **Ordered steps, one commit per step, every commit runnable:**
   1. G1: the walk module, the guard in the handler before the schema check,
      the refusal and §5's log line; §6.1 (a)–(f) and the walk's own tests;
   2. G2: the handler's `try/catch`, its log line and reply; §6.1 (g);
   3. §6.2: the measurement of the deepest legitimate message, with the
      number in the commit message;
   4. full suites, proofs (p1)–(p4) and the handoff.

   **Each step's report lists the suites run.** **If a run stops partway:**
   block with `kind="needs_input"` once. Use a different kind for a second
   consecutive stop.
2. **The rules most likely to be missed:**
   - **Order:** the guard runs **after `JSON.parse` and before `validate`**,
     for every message, a pre-`hello` one included. The schema check, the
     switch and every handler see only messages within the limit.
   - **The walk is iterative,** with an explicit stack and no recursion, and
     **stops as soon as it passes the limit**. Depth counts the top-level
     object as 1; arrays and objects alike; scalars and strings aren't
     walked.
   - **The refusal:** `UNKNOWN_MESSAGE`, "message nested too deeply", the
     message's `seq` only if its top-level `seq` is a number. **The socket
     stays open,** and nothing else happens: no world change, broadcast or
     save.
   - **The `try/catch` wraps the whole listener body,** `JSON.parse` to the
     end of the switch. Its reply is `UNKNOWN_MESSAGE` "the message could not
     be processed" with the `seq`, and its log line is the spec's.
   - **No `process.on('unhandledRejection' | 'uncaughtException')`, no
     schema change, no client change.**
   - **The crash tests run the server in a child process,** so a crash shows
     as the child's exit, and each checks the child is still serving
     afterwards (the same socket, and a second session).
3. **The handoff includes every proof,** (p1)–(p4), each with its failing
   test names, **and** what canonical requirement §2 asks:
   - the per-file counts, with their commands and exit codes;
   - the Node version;
   - **§6.2's number** and the message type that has it.

   **Commit before running proofs. Restore each broken file from a saved
   copy, never with `git checkout`.**
4. **"Not reproducible" is not an acceptable proof result.**
   - Either the break is wrong (fix the break) or the test is weak
     (strengthen it).
   - **The reviewer reproduces every proof itself.**
   - **The reviewer reads the listener for any code path outside the `try`,**
     and any read of the message before the guard other than `JSON.parse`.
   - **The reviewer sends hostile values itself to a child server:** arrays
     and objects 6,500, 100,000 and 1,000,000 deep, mixed nesting, and a deep
     avatar `add` from a non-owner session. It confirms each is refused and
     the child keeps serving.
   - A missing test is a finding, never a pass.
5. **Test runs:**
   - server test files run one at a time, each under `timeout 180`;
   - `packages/client` runs **without `--test-force-exit`**;
   - every other package runs `node --test` on its own test directory;
   - read proof results from the `not ok` and `cancelled` lines, not from
     the fail count.
6. **The test environment:** tests run in the DEV deploy as `atrium-build`
   with no network. New server tests listen on port 0.
7. **What the deploy refuses:** no symlinks and no `node_modules` path
   component anywhere in the tree. Uploads during the round go under
   `devtasks/` only.

#### Before DEV acceptance (operator and Claude)
- Claude repeats the pre-brief's two reproductions (§1) against the
  published SHA in the harness.
- The operator runs G5's host checks.
- **No agent completes the acceptance gate.** Your chain stops at it.

#### Report back (completion summary)
Report every task id, and confirm each of the following:
- the brief, implementation and review cards each carry the spec commit and
  hash you copied from the front door's comment;
- the brief-review gate's parent, and its `blocked`/no-runs state;
- the implementation card's parent is the gate, and its `max-runtime` is
  7200 s;
- the review card's opening line;
- the review gate creates nothing and blocks on APPROVE;
- the review gate is linked to this round's sentinel.

Then complete this kickoff. Do not start any of the work.

---
