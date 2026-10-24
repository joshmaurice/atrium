# Kickoff — Phase 3 step 4a: model animations (`scripting-4a`)

How to use this file:
- The **front-door note** is for the front door and the operator.
- Everything between the two rules is the **kickoff body**. Post it
  verbatim on the kickoff card.
- Then post the canonical worker-card requirements as a separate comment
  headed `WORKER-CARD REQUIREMENTS (canonical)`, the spec's commit and hash,
  and the sentinel's id.

**Front-door note (check before creating the card):**
- **Base:** `base_main_sha = 100365758e75c8880897fa5ceb48693fdc810415` (the
  edit-polish-3 release, on DEV, MAIN and PROD). Confirm it with a host
  fetch of `origin/main`. Any later commit on `main` (this file's, and the
  edit-polish-3 passdown's) must touch only `devtasks/`.
- **The base must carry `devtasks/PREBRIEF-scripting-4a.md`,** FINAL Rev
  1.2, 56,588 bytes, sha256
  `9260df0bc259d64b55c0812aba0f735ffa3183e2db637dccf4359ca1c5d9667f`.
  **Check the hash yourself and post the commit and hash on the kickoff
  card.** The kickoff has only `kanban_*` tools and can't check it.
- **The spec goes by git reference** (56 KB, over the 40 KB limit). Post no
  PART comments.
- **No open sentinel,** and `workflow/scripting-4a` doesn't exist yet. Do a
  push dry run first.
- **After every create, read the card back.** If a body or field is missing,
  fix it on **that** card while it's `todo`, or post the missing text as its
  first comment. **Never create a second card in its place.** Check the
  implementation card's `max_runtime_seconds` is 10800.
- **On the review gate's APPROVE, build the WHOLE release chain in one go**
  (edit-polish-3 passdown §4.1, §5.2):
  - Publish, DEV deploy, DEV finalizer and the acceptance gate, from
    `devtasks/KICKOFF-library-sky.md`'s "Release chain";
  - link the finalizer to the sentinel;
  - **only then** complete the review gate;
  - report every id.
- **Server round:** DEV restarts at the deploy. Nothing on the host changes
  otherwise.

---

### KICKOFF — Phase 3 step 4a: model animations. Slug: `scripting-4a`

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
git -C /workspace/atrium show 100365758e75c8880897fa5ceb48693fdc810415:devtasks/PREBRIEF-scripting-4a.md > /tmp/prebrief.md
sha256sum /tmp/prebrief.md   # must be 9260df0bc259d64b55c0812aba0f735ffa3183e2db637dccf4359ca1c5d9667f
```

On a mismatch, the card blocks with `kind="capability"`, quotes both hashes,
and does not work from a different text.

- **The spec:** `devtasks/PREBRIEF-scripting-4a.md`, **FINAL Revision 1.2
  (2026-10-23)**.
  - §1–§3: the plan for step 4 and the decisions.
  - §4: 4a's contract, Z1–Z8.
  - §5: the tests and proofs.
  - §5.1: Claude's browser checks.
  - §7: the worker rules.
  - §9 sketches 4b–4d. **They are not in scope.**
  - §10: review history. Read it, but it adds nothing to the contract.
- **The worker-card requirements** are a separate comment on this card,
  headed `WORKER-CARD REQUIREMENTS (canonical)`. Card bodies refer to that
  comment by its id; they never point at a host path.

#### Settlement (operator) — do not reopen
- **Base:** `base_main_sha = 100365758e75c8880897fa5ceb48693fdc810415`.
  - Workflow branch: **`workflow/scripting-4a`**, created from that SHA.
  - Worktree: `/workspace/wt/scripting-4a`, made with
    `git -C /workspace/atrium worktree add -b workflow/scripting-4a /workspace/wt/scripting-4a 100365758e75c8880897fa5ceb48693fdc810415`.
- **Scope:** implement **§4, Z1–Z8, for 4a only,** per the approved
  decisions **D1** and **L1–L9**, as the spec's status line records them:
  - **L5 (b):** the server stamps `startedAt`;
  - **L8:** unique clip ids that keep their file index.

  Nothing from 4b–4d is in scope: no behaviours, no script host, no
  `activate`, no `objectId`, and no Khronos engine.
- **The base moved since the spec was drafted.** The spec's code was read at
  `1206a52`; this base adds edit-polish-3, which changed the Edit panel. The
  brief re-checks P7 (`refreshModelRow`) and Z6's `app.js` call sites
  against this base, and says where they now are.
- **Files:**
  - **`packages/som`:** `SOMDocument.js` (`CREATABLE_PATHS`, `setPath`),
    and tests.
  - **`packages/server`:** `send-policy.js` (the leaf and its value rule)
    and `session.js` (the stamp), and tests on port 0.
  - **`packages/client`:**
    - new `src/animation-spec.js`: the value rule, `clipTime` and
      `clipIds`;
    - its `package.json` export, `./animation-spec`;
    - `AtriumClient.js`: `setModelAnimation`, the own echo applying the
      broadcast value, and the clock;
    - tests.
  - **`tests/fixtures/animation-spec-vectors.json`** (new), read by the
    server and client tests.
  - **`packages/renderer-three`:**
    - new `src/model-animations.js`;
    - `model-bridge.js`: the three lifecycle callbacks;
    - `model-instances.js`: the animation names and file indices;
    - the export in `index.js`;
    - tests.
  - **`apps/client`:**
    - `app.js`: wiring;
    - `index.html`: the model row's clip select, Loop, Play and Stop, plus
      the import-map entry `@atrium/client/animation-spec`;
    - a new pure panel-state helper module;
    - tests.
  - **`tools/som-inspector/index.html`:** the same import-map entry, but
    only if anything it loads imports `animation-spec`.
- **No protocol schema change.** If the brief or the implementation finds
  one is needed, stop and ask.
- **Full pipeline round, with a DEV restart.** The operator's outside code
  review of the published SHA, and Claude's browser checks (§5.1), come
  **before DEV acceptance**.

#### Graph — build exactly this
1. **GLM brief** — assignee `atrium-glm`. Parent: this kickoff. Title:
   `GLM brief — scripting-4a`.
   - Its card carries:
     - (a) this kickoff body;
     - (b) the spec reference and hash check above, with the front door's
       commit and hash copied in;
     - (c) a reference to the worker-card requirements comment.
   - The brief it writes is the **self-contained contract** for the
     implementation:
     - every Z1–Z8 rule, written out;
     - the full §5 test table;
     - every proof with its sub-proofs;
     - the §5.1 checks;
     - the §7 step list;
     - the re-checked P7/Z6 call sites at this base.
   - It may refer to sections of the spec, but must not leave a rule only in
     the spec.
2. **Operator brief-review gate** — assignee `atrium-orchestrator`.
   - Title exactly `OPERATOR BLOCK: awaiting human brief review — scripting-4a`.
   - Created with `initial_status="blocked"`. Parent = the GLM brief.
   - Body exactly: `OPERATOR BLOCK: human brief-review gate. Only the operator completes this. An agent dispatched here must kanban_block(kind="needs_input") on this card and do nothing else.`
   - Read it back and confirm `status == "blocked"` with no runs.
3. **DeepSeek implementation** — assignee `atrium-deepseek`. Title:
   `Implement — scripting-4a`.
   - **Its parent MUST be the gate** (step 2), not the brief.
   - Create it with **`--max-runtime 3h`** (10800 s), passed explicitly.
   - Its body carries:
     - the spec reference and hash check;
     - the instruction to **read the GLM brief's card, comments included**,
       as the contract;
     - the worktree command above, with `-b`;
     - the requirements below;
     - the worker-card requirements reference.
4. **One GLM review** — assignee `atrium-glm`. Title:
   `GLM review — scripting-4a`. Parent: the implementation.
   - A **single** review.
   - Its body opens with the exact line `THIS RUN HAS TERMINAL, FILE AND GIT TOOLS. Use them for every step below.`
   - Then the spec reference and the requirements below.
5. **Review gate** — assignee `atrium-orchestrator`. Title:
   `Review gate — scripting-4a`. Parent: the review. It **creates nothing**.
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
7. **Nothing reaches MAIN or PROD.** Those are host-side, operator-approved
   steps.

#### Release chain (the front door builds it, whole, on the gate's APPROVE)
These are the same four cards as library-sky's
(`devtasks/KICKOFF-library-sky.md`, "Release chain"), with `library-sky`
replaced by `scripting-4a` and the new SHA.
- Every body carries the full 40-character reviewed SHA.
- The DEV deploy runs the host's automatic release merge, so DEV, MAIN and
  PROD may run a `RELEASE_SHA` that differs from the reviewed SHA.
- **The front door builds all four cards, links the DEV finalizer to the
  sentinel, and only then completes the review gate.**
- **The publish, DEV deploy and finalizer cards make one call each.** On
  any refusal, non-zero exit or unexpected message, they do not retry: they
  block with `kind="capability"` and the complete output verbatim.

#### Requirements for the implementation AND review cards (beyond the spec)
1. **Ordered steps, one commit per step** (spec §7):
   1. Z1, the vectors file, the SOM change and the server's half (Z2), with
      the stamp;
   2. Z2a and Z3: the client's send and the clock;
   3. Z4, the client's value rule, `clipTime` and `clipIds`;
   4. Z5, `model-animations.js` and the bridge's three callbacks;
   5. Z6–Z7: `app.js`, `index.html` and the panel helper;
   6. full suites, proofs and the handoff.

   **If a run stops partway:** block with `kind="needs_input"` once. Use a
   different kind for a second consecutive stop.
2. **The rules most likely to be missed:**
   - **The server stamps a playing send's `startedAt`** after the value
     check. `add` is never stamped. The client sends `startedAt: 0` (Z2).
   - **The own echo is matched by `requestSeq`** and applies **the
     broadcast's** value, never the value that was sent (Z2a).
   - **`setPath` creates only `extras.atrium.animation`** (`CREATABLE_PATHS`),
     using own-property checks. Every other missing key is still refused
     (Z2).
   - **The clock uses `performance.now()`.** Each ping's `clientTime` is a
     per-connection counter. The window is 10 samples, none older than
     5 minutes. A discontinuity clears the window without keeping its own
     sample, and is followed by a burst of five pings. No timer outlives its
     connection (Z3).
   - **Clip ids** come from GLTFLoader's names in file order: the first
     occurrence wins, with the smallest free ` (n)`, the stem cut to 250,
     and each id keeps its file index (L8, Z4).
   - **Every action is `LoopOnce` with `clampWhenFinished`,** with its time
     set from `clipTime` every frame and then `mixer.update(0)`. **Stop is
     `action.stop()` alone,** never reset with `update(0)` (Z5, P12).
   - **Mixers are keyed by the instance object.** There are three callbacks
     (created, re-hosted, disposing), and an event for a replaced instance
     is ignored. `set` with an unchanged value has no side effects (Z5).
   - **Play and Stop are two buttons.** A late answer for a model that is no
     longer selected touches nothing (L7, Z7).
   - **Import maps:** `@atrium/client/animation-spec` needs an entry in
     `apps/client/index.html` and a `package.json` export.
     `importmap-guard` must stay green. Round 1 of 3a failed on exactly
     this.
3. **The handoff includes every proof and sub-proof,** each with its failing
   test names, **and** what canonical requirement §2 asks:
   - the per-file counts, with their commands and exit codes;
   - the Node version and the skipped count.

   **Commit before running proofs. Restore each broken file from a saved
   copy, never with `git checkout`.**
4. **"Not reproducible" is not an acceptable proof result.**
   - Either the break is wrong (fix the break) or the test is weak
     (strengthen it).
   - **The reviewer reproduces every proof itself,** and checks that **every
     test in the spec's §5 table exists** (name each).
   - A missing test is a finding, never a pass.
5. **Test runs:**
   - server test files run one at a time, each under `timeout 180`;
   - `packages/client` runs **without `--test-force-exit`**;
   - every other package runs `node --test` on its own test directory;
   - read proof results from the `not ok` and `cancelled` lines, not from
     the fail count.
6. **The test environment:**
   - Tests run in the DEV deploy as `atrium-build` with no network. New
     server tests listen on port 0.
   - `apps/client` tests can't import three.js or touch the DOM.
   - renderer-three tests use real three.js clips on real `Object3D`s, and
     check **the object's own values**.
7. **Uploads during the round go under `devtasks/` only.** Anything else is
   refused at the DEV deploy.

#### Before DEV acceptance (operator and Claude)
- The operator runs an outside code review of the **published SHA**.
- Claude runs §5.1's browser checks with Khronos's `Fox.glb` and
  `CesiumMan.glb`.
- **No agent completes the acceptance gate.** Your chain stops at it.

#### Report back (completion summary)
Report every task id, and confirm each of the following:
- the brief, implementation and review cards each carry the spec commit and
  hash you copied from the front door's comment;
- the brief-review gate's parent, and its `blocked`/no-runs state;
- the implementation card's parent is the gate, and its `max-runtime` is
  10800 s;
- the review card's opening line;
- the review gate creates nothing and blocks on APPROVE;
- the review gate is linked to the sentinel.

Then complete this kickoff. Do not start any of the work.

---
