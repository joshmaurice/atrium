# Kickoff — Phase 3 step 4c, visitors' `activate` (`scripting-4c`)

How to use this file:
- The **front-door note** is for the front door and the operator.
- Everything between the two rules is the **kickoff body**. Post it
  verbatim **in the kickoff card's body field** (not as a comment).
- Then post three comments on the kickoff card:
  - the canonical worker-card requirements, headed `WORKER-CARD REQUIREMENTS
    (canonical)` (the same text as signin-sync's, comment 855 on
    `t_2d41531f`);
  - the spec's commit and hash;
  - the sentinel's id.

**Front-door note (check before creating the card):**
- **Base:** `base_main_sha = 53f68ba99b28a3d8805986f132b9726db313fb9c` (the
  commit that carries the FINAL pre-brief).
  - Its runtime code is identical to the release on DEV, MAIN and PROD,
    `ab02239b`. `git diff --stat ab02239befbd68082e0027664e6a93407bed48f7
    53f68ba99b28a3d8805986f132b9726db313fb9c -- packages apps tools
    package.json pnpm-lock.yaml pnpm-workspace.yaml` is empty.
  - Confirm it with a host fetch of `origin/main`. Every later commit on
    `main` must touch only `devtasks/`. The host round's brief and drafts,
    and this file, are such commits.
- **The base must carry `devtasks/PREBRIEF-scripting-4c.md`,** FINAL Rev 1.3,
  69,279 bytes, sha256
  `07e3ecb7e34f4ccef2d30945c9061f6bc67b55a12be9bf66addbf52feb6d6cd4`.
  **Check the hash yourself and post the commit and hash on the kickoff
  card.** The kickoff has only `kanban_*` tools and can't check it. The
  pre-brief's two outside reviews are beside it
  (`REVIEW-scripting-4c-rev0.md`, `REVIEW-scripting-4c-rev1.1.md`).
- **The spec goes by git reference,** as for the last three rounds.
- **The guard is v1.2.0 since 2026-10-30** (`devtasks/BRIEF-host-round-2026-10-30.md`):
  - **A card created without a parent is created `blocked`,** with a line in
    its operating notes that says so. The first `kanban_link` that gives it
    a parent releases it to `todo`. The kickoff card is exempt (its title
    starts with `Kickoff`).
  - **Create the sentinel with `parents=[<this kickoff's id>]`** rather than
    creating it and linking it afterwards. If it comes out `blocked` with
    that line anyway (the parent was dropped), link it to the kickoff, and
    it is released.
  - **The guard now logs the argument keys** of every `kanban_create` and
    `kanban_complete` (never their values). After the kickoff's run, the
    operator pastes those lines to Claude (the host-round brief's step D).
    That settles where bodies and caps have been going missing.
- **No open sentinel.** signin-sync's last one, `t_ed021448`, is done. Create
  a new one for this slug and post its id.
- **`workflow/scripting-4c` doesn't exist yet.** Do a push dry run first,
  with a concrete refspec:
  `git -C /workspace/atrium push --dry-run origin 53f68ba99b28a3d8805986f132b9726db313fb9c:refs/heads/workflow/scripting-4c`.
  Expect `* [new branch]`.
- **Card bodies go in the body field.** **After every create, read the card
  back.** If a body or field is still missing (the known `kanban_create`
  field drop), post the missing text as that card's first comment while it's
  `todo`. **Never create a second card in its place.**
  - Check that the implementation card's `max_runtime_seconds` is **14400**.
    If it came out at the guard's default (90 minutes), raise it with the
    models-by-url passdown §5.3 recipe **before the brief-review gate
    releases it**. signin-sync's `t_0149264e` was raised that way.
- **Read the kickoff body back after posting.** If it's cut, post the rest as
  PART comments before the orchestrator runs (4b-1 passdown §3).
- **Post the three comments right after creating the card.** If the
  orchestrator is dispatched first, it blocks the kickoff card with its own
  id, as the body allows in that one case. Post the missing comments, then
  ask the operator to unblock it with an explicit reason.
- **On the review gate's APPROVE, build the WHOLE release chain in one go:**
  - Publish, DEV deploy, DEV finalizer and the acceptance gate. Use the same
    four cards and bodies as signin-sync round 2's (`t_4d192108`,
    `t_1c3551ce`, `t_d4bcfc78`, `t_2127b2dc`), with this slug and the new SHA,
    **each created with its parent**. This branch is new, so the publish is
    a **first push**, not a fast-forward.
  - Link the finalizer to this round's sentinel, and **only then** complete
    the review gate.
  - Report every id.
  - If `kanban_complete` drops `task_id` again, stop and tell the operator.
- **A protocol, server and client round, with a dependency change:** DEV
  restarts at the deploy, and the deploy runs an install. `apps/client`
  gains `"@atrium/som": "workspace:*"` and `pnpm-lock.yaml` follows (the
  pre-brief's M2). **Any other `package.json` or lockfile change is a
  finding.**
- **The DEV deploy now runs eight test suites:** `behaviors` joined the list
  in the host round, before `apps-client`.
- **Nothing is pushed to `main` between the DEV deploy's release merge and
  the MAIN push** (scripting-4a passdown §4.4).

**Before DEV acceptance (outside the pipeline):**
- **Claude runs the pre-brief's §6.1 browser checks** (thirteen) on the
  published SHA. That includes a second, older world server on another
  origin, built from the base (check 13), and a stale 4b-2 owner tab
  (check 10). This is Claude's work, not a card's.
- **The outside review of the whole round,** base to tip, after GLM's
  review, with the compare URL. The pre-brief's §8 requires it: this round
  opens a new input path for anonymous visitors.
- **DEV acceptance needs a hard reload in every tab** (the pre-brief's §7).
  An unreloaded owner tab is a 4b-2 page and is never the host.

---

### KICKOFF — Phase 3 step 4c, visitors' `activate`. Slug: `scripting-4c`

You are the kickoff orchestrator for this workflow. Build the task graph
below, read it back, report, and stop. Do not implement, review or deploy
anything yourself.
- **Your tools:** only `kanban_*`.
- **`OPERATOR BLOCK:`** This body quotes that prefix for the gates it
  describes. **Never use it in a block or comment of your own.**
- **Blocking:** **never call `kanban_block` without an explicit `task_id`.**
  **Never block this card, with one exception:** the missing-comments case
  below. There, and only there, you block this card, passing **its own id**
  as `task_id`.
- **Exact wording:** these are copied **character for character**:
  - every card title;
  - every text shown in backticks or quoted as "Body exactly";
  - the review card's opening line;
  - the gate's block reason.

  Do not invent titles: the guard refuses them.
  **Everything else under a card is a list of what its body must contain.**
  Write it in full, leaving nothing out, but the wording is yours. The spec
  reference, the hash check and the requirements section are copied whole.
- **Bodies go in each card's body field when you create it,** never only in a
  comment. Read each card back; if its body is empty, post the body as its
  first comment while it's `todo`, and never create a second card in its
  place.
- **Create every card with its parent** (`parents=[…]` in the
  `kanban_create` call). A card created without one is created `blocked` by
  the guard, and its operating notes say so. If that happens, link its
  parent with `kanban_link`: that releases it. Never create a second card in
  its place.

**Wait for three comments before building anything:**
- the front door's spec commit and hash;
- the `WORKER-CARD REQUIREMENTS (canonical)` comment;
- the sentinel id.

If you are dispatched before all three are on this card, call
`kanban_block(task_id=<this card's id>, kind="needs_input", reason="waiting for: <the missing comments>")`
and do nothing else. This is the only time you block this card.

#### Where the spec is: in git, by reference
**You don't read or check the spec.** You have no shell. The front door has
already checked it and posted its commit and sha256 on this card. **Do not
try to fetch or hash anything, and do not block for lack of a shell.** Copy
the front door's commit and hash into the brief, implementation and review
cards. Those cards have terminal, file and git tools, and each checks the
spec first with:

```
git -C /workspace/atrium fetch origin main
git -C /workspace/atrium show 53f68ba99b28a3d8805986f132b9726db313fb9c:devtasks/PREBRIEF-scripting-4c.md > /tmp/prebrief.md
sha256sum /tmp/prebrief.md   # must be 07e3ecb7e34f4ccef2d30945c9061f6bc67b55a12be9bf66addbf52feb6d6cd4
```

On a mismatch, the card blocks with `kind="capability"`, quotes both hashes,
and does not work from a different text.

- **The spec:** `devtasks/PREBRIEF-scripting-4c.md`, **FINAL Revision 1.3
  (2026-10-30)**: §0 the two reviews' changes; §1 what 4c delivers; §2
  facts P1–P23 and probes; §3 **decisions AC-L1–AC-L8** (approved as
  recommended); §4 **the contract, AC1–AC7**; §5 questions (settled); §6
  tests, proofs (a)–(j) and §6.1 Claude's browser checks; §7 DEV
  acceptance; §8 worker rules and **the step list** (AC-L1 says "§7"; it's
  §8); §9 notes.
- **The worker-card requirements** are a separate comment on this card,
  headed `WORKER-CARD REQUIREMENTS (canonical)`. Card bodies refer to that
  comment by its id; they never point at a host path.

#### Settlement (operator) — do not reopen
- **Base:** `base_main_sha = 53f68ba99b28a3d8805986f132b9726db313fb9c`.
  - Workflow branch: **`workflow/scripting-4c`**, created from that SHA.
  - Worktree: `/workspace/wt/scripting-4c`, made with
    `git -C /workspace/atrium worktree add -b workflow/scripting-4c /workspace/wt/scripting-4c 53f68ba99b28a3d8805986f132b9726db313fb9c`.
- **Scope:** AC1–AC6 as written in the spec's §4, with every Revision 1 and
  1.2 addition (§0), and AC-L1–AC-L8 as recommended (§3). Also §6's tests
  and proofs.
  **Not in scope:** §4's AC7 list, §10, and every open follow-up in the
  scripting-4b-2 and signin-sync passdowns.
- **Where the shared pieces go** (settled here, so the brief doesn't invent
  a new module path):
  - `listensForSelect`, `selectTargetFor`, `ACTIVATE_MAX_DISTANCE` and
    `withinActivateDistance` go in `packages/behaviors/src/behavior-spec.js`
    (already exported as `@atrium/behaviors/behavior-spec` and in the page's
    import map). No new `@atrium/behaviors` subpath.
  - The server's copies of `listensForSelect` and the distance rule go in
    `packages/server/src/send-policy.js`, beside its copy of the behaviour
    rule.
  - `worldPosition` moves to a new `packages/som/src/world-position.js`,
    exported from `packages/som/src/index.js`.
    `apps/client/src/world-position.js` re-exports it and keeps
    `subtreeSome`.
  - `behaviorAim` and `activateNoticeText` go in **one new module**,
    `apps/client/src/activate-click.js`.
- **Files:**
  - `packages/protocol`: `src/index.js`; `src/schemas/activate.client.json`,
    `activate.server.json`, `script-ready.client.json` (new);
    `hello.client.json`, `error.json`; tests;
  - `packages/server`: `src/session.js`, `src/send-policy.js`; tests;
  - `packages/som`: `src/world-position.js` (new), `src/index.js`; tests;
  - `packages/behaviors`: `src/behavior-spec.js`, `src/runner.js`; tests;
  - `packages/client`: `src/AtriumClient.js`; tests;
  - `apps/client`: `src/app.js`, `src/world-position.js`,
    `src/behavior-form.js` (the `otherTab` text only),
    `src/activate-click.js` (new); `index.html` (`#activate-notice` and its
    style only); `package.json` (the one dependency); tests under
    `apps/client/tests/`;
  - `pnpm-lock.yaml`, **updated by `pnpm install`, never by hand**;
  - `tests/fixtures/behavior-vectors.json`;
  - `tests/fixtures/protocol-compat/` (new): the two frozen `hello` schemas
    and their README (spec §6, AC4 row).

  **No other file.** Nothing under the vendored engine's packages changes.
  If the brief or the implementation finds that another file must change,
  stop and ask.
- **A UI round with a protocol and server change, full pipeline, with a DEV
  restart and an install.** Claude's browser checks (§6.1) and the outside
  review of the whole round come before DEV acceptance.

#### Graph — build exactly this
1. **GLM brief** — assignee `atrium-glm`. Parent: this kickoff. Title:
   `GLM brief — scripting-4c`.
   - Its card carries:
     - (a) this kickoff body;
     - (b) the spec reference and hash check above, with the front door's
       commit and hash copied in;
     - (c) a reference to the worker-card requirements comment.
   - The brief it writes is the **self-contained contract** for the
     implementation:
     - AC1–AC6 written out, **with AC3's ten checks in their order**, and
       the readiness and eligibility rules;
     - **every text exactly as the spec writes it, character for
       character:** the four notices in AC-L6's table, the `otherTab`
       status (AC6), every refusal's code and message in AC-L5's table,
       and the log lines (AC3's `[activate] rate limited …`, AC5's `select
       from …` and `select dropped — …`);
     - every §6 test and proof, with every sub-proof;
     - the step list below.

     It may refer to sections of the spec, but must not leave a rule only in
     the spec.
2. **Operator brief-review gate** — assignee `atrium-orchestrator`.
   - Title exactly `OPERATOR BLOCK: awaiting human brief review — scripting-4c`.
   - Created with `initial_status="blocked"`. Parent = the GLM brief.
   - Body exactly: `OPERATOR BLOCK: human brief-review gate. Only the operator completes this. An agent dispatched here must kanban_block(kind="needs_input") on this card and do nothing else.`
   - Read it back and confirm `status == "blocked"` with no runs.
3. **DeepSeek implementation** — assignee `atrium-deepseek`. Title:
   `Implement — scripting-4c`.
   - **Its parent MUST be the gate** (step 2), not the brief.
   - Create it with **`--max-runtime 4h`** (14400 s), passed explicitly.
   - Its body carries:
     - the spec reference and hash check;
     - the instruction to **read the GLM brief's card, comments included**,
       as the contract;
     - the worktree command above, with `-b`;
     - the requirements below;
     - the worker-card requirements reference.
4. **One GLM review** — assignee `atrium-glm`. Title:
   `GLM review — scripting-4c`. Parent: the implementation.
   - A **single** review.
   - Its body opens with the exact line `THIS RUN HAS TERMINAL, FILE AND GIT TOOLS. Use them for every step below.`
   - Then the spec reference and the requirements below.
5. **Review gate** — assignee `atrium-orchestrator`. Title:
   `Review gate — scripting-4c`. Parent: the review. It **creates nothing**.
   - **On a valid APPROVE** naming the exact 40-character SHA, it blocks with
     `kind="needs_input"` and the reason
     `APPROVE <SHA40>: front door, build the release chain`.
   - **On a missing, malformed or non-APPROVE verdict,** it blocks for the
     operator with the verdict quoted.
6. **Sentinel** — the front door creates it, parented on this kickoff, and
   posts its id here.
   - **Before you complete,** link the review gate to the sentinel as an
     additional parent: `kanban_link(parent_id=<review gate id>, child_id=<sentinel id>)`.
   - The front door later adds the DEV finalizer as a further parent.
   - Do not create a second sentinel, and never complete it.
   - **Never link to any other workflow's sentinel.**
7. **Nothing reaches MAIN or PROD.** Those are host-side, operator-approved
   steps.

#### Release chain (the front door builds it, whole, on the gate's APPROVE)
These are the same four cards as signin-sync round 2's, with this slug and
the new SHA.
- Every body carries the full 40-character reviewed SHA.
- The DEV deploy runs the host's automatic release merge, so DEV, MAIN and
  PROD may run a `RELEASE_SHA` that differs from the reviewed SHA.
- **The publish, DEV deploy and finalizer cards make one call each.** On any
  refusal, non-zero exit or unexpected message, they do not retry: they block
  with `kind="capability"` and the complete output verbatim.

#### Requirements for the implementation AND review cards (beyond the spec)
1. **Ordered steps, one commit per step, every commit runnable** (spec §8):
   1. **Protocol (AC1):** the three new schemas, `scriptRunner`'s
      `enum: [1, 2]`, the direction list and `messageTypes` (`script-ready`
      compiled `:client` only), `NO_SCRIPT_HOST`; the schema tests.
   2. **The shared rule (AC2):** `listensForSelect`, `selectTargetFor`, the
      distance rule (both copies where the spec says two), the vectors,
      `worldPosition` into `@atrium/som` with the re-export,
      `apps/client/package.json` and `pnpm-lock.yaml`.
   3. **Server (AC3):** eligibility in both places, readiness, the
      `activate` case's ten checks in order, the two buckets on an injected
      clock, forwarding, the log line; tests. The client still sends
      `scriptRunner: 1` here, so the server's tests use raw sockets with `2`,
      and the report says a page from this commit is never the host.
   4. **Client and runner (AC4, AC5):** the `scriptRunner` connect option
      (off by default), `activate()`, `scriptReady()`, the inbound
      `activate`, the runner's readiness call, `select` and the forwarded
      select; the frozen-schema fixtures; tests.
   5. **App (AC6):** `connectNow`'s option, the click branch unlocked and
      pointer-locked (`behaviorAim`), the notices (`activateNoticeText`,
      `#activate-notice`), the `otherTab` text; tests and wiring guards.
   6. **Full suites, proofs (a)–(j)** with every sub-proof (b2, c2, c3, e2,
      g2's two halves, g3, j2), and the handoff.

   **Each step's report lists the suites run** and names any test deferred
   to a later step. **If a run stops partway:** block with
   `kind="needs_input"` once; use a different kind for a second consecutive
   stop.
2. **The rules most likely to be missed:**
   - **Readiness is the delivery contract** (spec M1, §9). Forward only to
     the host session that sent `script-ready` for the **current**
     `hostGen`; every grant clears it. "The host's socket is open" was Rev
     0's gap. No ready host means `NO_SCRIPT_HOST`, never silence.
   - **The host role needs `scriptRunner === 2` in both places that decide
     it** (P22; proof (g2) in two halves). The schema still accepts 1: a
     4b-2 page connects and edits, and is never the host.
   - **A cross-origin hello has no `scriptRunner` key at all** (P23). Only
     `connectNow` sets the option, from `sameOriginAsAccount`. The two frozen
     schemas are copied **byte for byte** from `9e8b1e4^` and `71b6e40b`
     (commits and sha256 in their README), and must accept the client's real
     cross-origin hello.
   - **AC3's check order is the contract.** The session bucket is charged
     for every schema-valid `activate` before the node lookup; the world
     bucket only at the forward. The server never walks ancestors.
     Distance uses `worldPosition`, never `getNodeTranslation` (P7), from
     the sender's own avatar node (none: `PERMISSION_DENIED`).
   - **The distance check is not a security boundary** (spec §8, N2): never
     describe it, in code, comments or the handoff, as stopping a
     determined visitor.
   - **`activate()` sends nothing before both `session:ready` and
     `world:loaded`** (three states, proof (j2)). A refusal never fails a
     pending connect (P15). Its seq map is `record.pendingActivations` on the
     connection record (P21), and it never reaches the edit paths.
   - **An inbound `activate` is emitted only while this client holds the
     role,** with its own `hostGen` and `event: 'select'`.
   - **One select rule for every tab, `selectTargetFor`,** the runner's
     `select` included. A forwarded select runs in Edit mode too, is never
     re-checked for distance, and a dropped one is logged once per node per
     generation.
   - **Pointer lock** (P17, probe `p3`): a locked click's `target` is
     `#viewport` and `clientX/Y` are stale. `behaviorAim` aims at the centre.
     Unlocked, a click off the canvas is still ignored.
   - **Logs:** no line per accepted `activate`; no node names, user names,
     cookies, or ids beyond 8 characters of a session id.
   - **No test seam in `src`:** the held-load test wraps the real world's
     `serialize` (spec §6, AC5 row, five steps, visitor first).
   - **A test of a seam uses the real collaborator or the exact value
     production passes** (signin-sync §4.1). Spec §8 names them: real
     sockets for AC3, the real rule for AC5, the real runner and
     `client.activate` for AC6.
   - **`pnpm-lock.yaml` changes only through `pnpm install`,** for the one
     `@atrium/som` dependency.
   - **App tests use the strict DOM fake;** `dataset` is never assigned.
3. **The handoff includes:**
   - every proof, (a)–(j) with every sub-proof, each with its failing test
     names, and whether each file exited on its own;
   - what canonical requirement §2 asks: the per-file counts with their
     commands and exit codes, and the Node version;
   - **`packages/behaviors` and `packages/som` results** as well as the
     packages the requirement names (the DEV deploy now runs `behaviors`);
   - the `pnpm-lock.yaml` diff's summary (what changed and why).

   **Commit before running proofs. Restore each broken file from a saved
   copy, never with `git checkout`.** **Run the proofs one at a time:**
   the agents' container is capped at 2,600 MiB, and signin-sync's first
   proof batch was OOM-killed.
4. **"Not reproducible" is not an acceptable proof result.** Either the
   break is wrong (fix it) or the test is weak (strengthen it).
   - **The reviewer reproduces every proof itself,** and also:
     - **writes its own readiness check** (spec M1): hold a host's world load
       at the server, expect `NO_SCRIPT_HOST` for a visitor's `activate`,
       release, and expect the next `activate` to run;
     - **checks the cross-origin hello itself** against the two frozen
       schemas, re-derived from git (`9e8b1e4^`, `71b6e40b`) and compared
       byte for byte with the fixtures;
     - **greps** every place the host role is decided (two, both
       `=== 2`), every `client.connect`, and every `scriptRunner` in
       `apps/client/src` (only `connectNow` sets it);
     - **reads the `activate` case** against AC3's order, and every new log
       line for names and ids.
   - A missing test is a finding, never a pass.
5. **Test runs:**
   - server test files run one at a time, each under `timeout 180`;
   - `packages/client` runs **without `--test-force-exit`**;
   - every other package runs `node --test` on its own test directory;
   - read proof results from the `not ok` and `cancelled` lines, not from
     the fail count.
6. **The test environment:** tests run in the DEV deploy as `atrium-build`
   with no network. New tests listen on port 0.
7. **What the deploy refuses:** no symlinks and no `node_modules` path
   component anywhere in the tree. Uploads during the round go under
   `devtasks/` only.

#### Before DEV acceptance (operator and Claude)
- Claude runs the spec's §6.1 browser checks against the published SHA.
- The outside review of the whole round, base to tip.
- **No agent completes the acceptance gate.** Your chain stops at it.

#### Report back (completion summary)
Report every task id, and confirm each of the following:
- the brief, implementation and review cards each carry the spec commit and
  hash you copied from the front door's comment, **in their body fields**;
- every card was created with its parent, and none is `blocked` except the
  brief-review gate (say so if the guard held one and you linked it);
- the brief-review gate's parent, and its `blocked`/no-runs state;
- the implementation card's parent is the gate, and its `max-runtime` is
  14400 s;
- the review card's opening line;
- the review gate creates nothing and blocks on APPROVE;
- the review gate is linked to this round's sentinel.

Then complete this kickoff. Do not start any of the work.

---
