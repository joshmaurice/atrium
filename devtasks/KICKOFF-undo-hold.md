# Kickoff — a behaviour stops after Undo (`undo-hold`)

How to use this file:
- The **front-door note** is for the front door and the operator.
- Everything between the two rules is the **kickoff body**. **Nothing is
  posted on the kickoff card after it is created** (scripting-4c passdown
  §4.5). So, before creating it, the front door fills the body's three
  placeholders:
  - `<SENTINEL_ID>`: the sentinel's id (the sentinel is created **first**,
    below);
  - `<SPEC_CHECK>`: the front door's own line confirming the spec's commit
    and hash (format below);
  - `<CANONICAL_REQUIREMENTS>`: the canonical worker-card requirements,
    **verbatim**, the same text as scripting-4d-1's kickoff carried
    (signin-sync's comment 855 on `t_2d41531f`).

  Then it creates the card with the filled body in its **body field**, and
  reads it back whole.

**Front-door note (check before creating anything):**
- **Base:** `base_main_sha = 8bed4521afa50a8340d8fbe97ad1575993848811`.
  - Its runtime code is identical to the release on DEV, MAIN and PROD,
    `84542c73`. `git diff --stat 84542c73156546d82d63cbb202325dd8bb24a487
    8bed4521afa50a8340d8fbe97ad1575993848811 -- packages apps tools tests
    package.json pnpm-lock.yaml pnpm-workspace.yaml` is empty: every commit
    between them touches only `devtasks/`.
  - Confirm it with a host fetch of `origin/main`. **Every commit after the
    base must touch only `devtasks/`.** This file is such a commit.
- **The base must carry `devtasks/PREBRIEF-undo-hold.md`,** FINAL Rev 1,
  12,249 bytes, sha256
  `327957b56b8bd4200c024f90272220d1dd4565558c6f5479e77ac51bee9d299f`.
  **Check the hash yourself.** Fill `<SPEC_CHECK>` with one line:
  `SPEC CHECK (front door): 8bed4521afa50a8340d8fbe97ad1575993848811:devtasks/PREBRIEF-undo-hold.md sha256 <the hash you computed>, 12249 bytes, matches.`
  If it doesn't match, stop and tell the operator. The pre-brief has no
  outside review of its own (UH-L3 (a)); the round's code review stands.
- **The spec goes by git reference,** as for the last rounds.
- **The sentinel first.** Create it with the same shape as scripting-4d-1's,
  for this slug. A card created without a parent is created `blocked`, which
  is what a sentinel created before its kickoff wants. After creating the
  kickoff card, `kanban_link(parent_id=<kickoff id>, child_id=<sentinel
  id>)`, and read the sentinel back: parented on the kickoff, never claimed,
  never completed. **Archive any earlier round's open sentinel first** (4d-1
  passdown §3): with exactly one open sentinel, the guard links it to new
  review gates and finalizers itself.
- **`workflow/undo-hold` doesn't exist yet.** Do a push dry run first:
  `git -C /workspace/atrium push --dry-run origin 8bed4521afa50a8340d8fbe97ad1575993848811:refs/heads/workflow/undo-hold`.
  Expect `* [new branch]`.
- **Card bodies go in the body field.** After every create, read the card
  back. If a body or field is still missing, post the missing text as that
  card's first comment while it's `todo`. **Never create a second card in
  its place.**
  - The implementation card's `max_runtime_seconds` must be **7200**. If it
    came out at the guard's default, raise it **before the brief-review gate
    releases it**.
- **On the review gate's APPROVE, build the WHOLE release chain in one go:**
  - Publish, DEV deploy, DEV finalizer and the acceptance gate, with the
    same four cards and bodies as scripting-4d-1's chain, with this slug and
    the new SHA, **each created with its parent**. The branch is new, so the
    publish is a **first push**.
  - Link the finalizer to this round's sentinel, and **only then** complete
    the review gate.
  - Report every id.
  - If the finalizer blocks because the release merge's `RELEASE_SHA`
    differs from the reviewed SHA by `devtasks/` only, your byte-for-byte
    check of the served files is the evidence to accept it.
- **A client-only round with no dependency change.** No protocol, server,
  stored-data, `package.json`, `pnpm-lock.yaml` or import-map change; any is
  a finding. The deploy serves the new `app.js`.
- **Nothing is pushed to `main` between the DEV deploy's release merge and
  the MAIN push** (scripting-4a passdown §4.4).

**Before DEV acceptance (outside the pipeline):**
- **Claude runs the browser check** (spec §5) on the published SHA:
  `devtasks/harness/checks/undo-hold/h1.py` turned round, with Redo, the
  rotation refusal and the drag rule during a drag. On `8ff7000` the same
  steps showed the bug.
- **DEV acceptance needs a hard reload in every tab.** The operator's own
  case: a model spinning with an imported graph, moved, Undo; it keeps
  spinning.

---

### KICKOFF — a behaviour stops after Undo. Slug: `undo-hold`

You are the kickoff orchestrator for this workflow. Build the task graph
below, read it back, report, and stop. Do not implement, review or deploy
anything yourself.
- **Your tools:** only `kanban_*`.
- **Everything you need is in this body.** The spec's commit and hash, the
  sentinel's id and the worker-card requirements are below. **Nothing will
  be posted on this card afterwards, so don't wait for comments, and never
  block this card.**
- **`OPERATOR BLOCK:`** This body quotes that prefix for the gates it
  describes. **Never use it in a block or comment of your own.**
- **Blocking:** never call `kanban_block` without an explicit `task_id`.
- **Exact wording:** these are copied **character for character**:
  - every card title;
  - every text shown in backticks or quoted as "Body exactly";
  - the review card's opening line;
  - the gate's block reason.

  Do not invent titles: the guard refuses them.
  **Everything else under a card is a list of what its body must contain.**
  **Write each card's body from the bullets under its title; don't copy this
  kickoff's own instructions into any card.** The spec reference, the hash
  check, the requirements section and the canonical requirements are copied
  whole.
- **Bodies go in each card's body field when you create it,** never only in
  a comment. Read each card back; if its body is empty, post the body as its
  first comment while it's `todo`, and never create a second card in its
  place.
- **Create every card with its parent** (`parents=[…]` in the
  `kanban_create` call). A card created without one is created `blocked` by
  the guard. If that happens, link its parent with `kanban_link`: that
  releases it. Never create a second card in its place.

**The front door's spec check:** <SPEC_CHECK>

**The sentinel:** `<SENTINEL_ID>`

#### Where the spec is: in git, by reference
**You don't read or check the spec.** You have no shell. The front door has
already checked it (the line above). **Do not try to fetch or hash
anything.** Copy the commit and hash into the brief, implementation and
review cards. Those cards have terminal, file and git tools, and each checks
the spec first with:

```
git -C /workspace/atrium fetch origin main
git -C /workspace/atrium show 8bed4521afa50a8340d8fbe97ad1575993848811:devtasks/PREBRIEF-undo-hold.md > /tmp/prebrief.md
sha256sum /tmp/prebrief.md   # must be 327957b56b8bd4200c024f90272220d1dd4565558c6f5479e77ac51bee9d299f
```

On a mismatch, the card blocks with `kind="capability"`, quotes both hashes,
and does not work from a different text.

- **The spec:** `devtasks/PREBRIEF-undo-hold.md`, **FINAL Revision 1
  (2026-11-04)**:
  - §1: what the round delivers, and what it doesn't;
  - §2: verified facts, with the reproduction (§2.3);
  - §3: **decisions UH-L1–UH-L3** (approved as recommended);
  - §4: **the contract, H1–H4**;
  - §5: tests and proofs (p1)–(p4), and Claude's browser check;
  - §6: worker rules, **the two commits** and the files.
- **The worker-card requirements** are the last section of this body,
  headed `WORKER-CARD REQUIREMENTS (canonical)`. Card bodies copy them or
  refer to this card's body; they never point at a host path.

#### Settlement (operator) — do not reopen
- **Base:** `base_main_sha = 8bed4521afa50a8340d8fbe97ad1575993848811`.
  - Workflow branch: **`workflow/undo-hold`**, created from that SHA.
  - Worktree: `/workspace/wt/undo-hold`, made with
    `git -C /workspace/atrium worktree add -b workflow/undo-hold /workspace/wt/undo-hold 8bed4521afa50a8340d8fbe97ad1575993848811`.
- **Decisions (operator, 2026-11-04 20:17 PT), all as recommended:** UH-L1 (a)
  the hold ends when the edit tracker has nothing in flight for that node
  (`onNodeIdle`); UH-L2 (a) no Behaviour panel change in this round; UH-L3 (a)
  the usual pipeline, client only.
- **Scope:** H1–H4 as written in the spec's §4, with §5's tests and proofs.
  **Not in scope:** Undo's "changed elsewhere" rule, the Behaviour panel,
  the runner, the hold's one-node limit (§2.4), and anything in
  `PREBRIEF-richer-add-copy.md`.
- **Files:** `apps/client/src/edit-gesture.js`, `apps/client/src/app.js`,
  `apps/client/tests/edit-gesture.test.js`,
  `apps/client/tests/behavior-wiring.test.js`. **No other file.** Nothing
  under `packages/` changes. If the brief or the implementation finds that
  another file must change, stop and ask.
- **A small client round, full pipeline.** Claude's browser check comes
  before DEV acceptance.

#### Graph — build exactly this
1. **GLM brief** — assignee `atrium-glm`. Parent: this kickoff. Title:
   `GLM brief — undo-hold`.
   - Its card carries:
     - (a) the spec reference and hash check above, with the commit and
       hash copied in;
     - (b) the Settlement above, whole;
     - (c) the requirements section below, whole;
     - (d) the canonical worker-card requirements, whole.
   - The brief it writes is the **self-contained contract** for the
     implementation: H1–H4 written out, with H1's three timing rules (once
     per idle transition; after any revert and any reported batch; never
     while a gesture on that node is active); every §5 test and proof (p1)–
     (p4); and the step list below. It may refer to sections of the spec,
     but must not leave a rule only in the spec.
2. **Operator brief-review gate** — assignee `atrium-orchestrator`.
   - Title exactly `OPERATOR BLOCK: awaiting human brief review — undo-hold`.
   - Created with `initial_status="blocked"`. Parent = the GLM brief.
   - Body exactly: `OPERATOR BLOCK: human brief-review gate. Only the operator completes this. An agent dispatched here must kanban_block(kind="needs_input") on this card and do nothing else.`
   - Read it back and confirm `status == "blocked"` with no runs.
3. **DeepSeek implementation** — assignee `atrium-deepseek`. Title:
   `Implement — undo-hold`.
   - **Its parent MUST be the gate** (step 2), not the brief.
   - Create it with **`--max-runtime 2h`** (7200 s), passed explicitly.
   - Its body carries:
     - the spec reference and hash check;
     - the instruction to **read the GLM brief's card, comments included**,
       as the contract;
     - the worktree command above, with `-b`;
     - the requirements below;
     - the canonical worker-card requirements.
4. **One GLM review** — assignee `atrium-glm`. Title:
   `GLM review — undo-hold`. Parent: the implementation.
   - A **single** review.
   - Its body opens with the exact line `THIS RUN HAS TERMINAL, FILE AND GIT TOOLS. Use them for every step below.`
   - Then the spec reference, the requirements below and the canonical
     worker-card requirements.
5. **Review gate** — assignee `atrium-orchestrator`. Title:
   `Review gate — undo-hold`. Parent: the review. It **creates nothing**.
   - **On a valid APPROVE** naming the exact 40-character SHA, it blocks with
     `kind="needs_input"` and the reason
     `APPROVE <SHA40>: front door, build the release chain`.
   - **On a missing, malformed or non-APPROVE verdict,** it blocks for the
     operator with the verdict quoted.
6. **Sentinel** — the front door created it before this card and linked it
   here; its id is above.
   - **Before you complete,** link the review gate to the sentinel as an
     additional parent: `kanban_link(parent_id=<review gate id>, child_id=<SENTINEL_ID>)`.
   - The front door later adds the DEV finalizer as a further parent.
   - Do not create a second sentinel, and never complete it.
   - **Never link to any other workflow's sentinel.**
7. **Nothing reaches MAIN or PROD.** Those are host-side, operator-approved
   steps.

#### Release chain (the front door builds it, whole, on the gate's APPROVE)
These are the same four cards as scripting-4d-1's, with this slug and the
new SHA.
- Every body carries the full 40-character reviewed SHA.
- The DEV deploy runs the host's automatic release merge, so DEV, MAIN and
  PROD may run a `RELEASE_SHA` that differs from the reviewed SHA.
- **The publish, DEV deploy and finalizer cards make one call each.** On any
  refusal, non-zero exit or unexpected message, they do not retry: they block
  with `kind="capability"` and the complete output verbatim.

#### Requirements for the implementation AND review cards (beyond the spec)
1. **Ordered steps, one commit per step, every commit runnable** (spec §6):
   1. **`edit-gesture.js`:** the tracker's `onNodeIdle` (H1) and
      `createBehaviorHold` (H2), with §5's tracker and hold unit tests.
   2. **`app.js` and its guards:** H3's wiring, `behavior-wiring.test.js`'s
      changed guards, the full suites, proofs (p1)–(p4) and the handoff.

   **Each step's report lists the suites run.** **If a run stops partway:**
   block with `kind="needs_input"` once; use a different kind for a second
   consecutive stop.
2. **The rules most likely to be missed:**
   - **`onNodeIdle` fires on every path that closes a node's last record:**
     accepted, refused and unknown sends, a removed node, **recorded and
     unrecorded commits alike**. Undo's and Redo's sends are unrecorded
     (`commit(…, { record: false })`); that is the bug.
   - **It fires once per transition to idle, after any revert is written
     and any batch reported, and never while a gesture on that node is
     active.** A commit that sent nothing (the same value) opens no record
     and fires nothing.
   - **The hold is kept by node object, not by name.** `released` of another
     object with the same name changes nothing (a restored object keeps its
     name).
   - **`onTransformsSettled` no longer clears the hold.** The drag's end
     still calls `hold.clear()`: a drag that changed nothing sends nothing,
     so no idle comes for it.
   - **`runner?.setGesture(` appears exactly once in `app.js`,** inside
     `createBehaviorHold`'s argument. The runner doesn't change.
   - **A test of a seam uses the real collaborator:** the tracker tests drive
     the real `createEditTracker` with its real `commit`, `begin`,
     `accepted`, `rejected`, `unknown` and `nodeRemoved`, as
     `edit-gesture.test.js` already does.
3. **The handoff includes:**
   - every proof, (p1)–(p4), **quoting the output of both runs** (failing
     and green), with its failing test names;
   - what canonical requirement §2 asks: the per-file counts with their
     commands and exit codes, and the Node version.

   **Commit before running proofs. Restore each broken file from a saved
   copy, never with `git checkout`.**
4. **"Not reproducible" is not an acceptable proof result.** Either the
   break is wrong (fix it) or the test is weak (strengthen it).
   - **The reviewer reproduces every proof itself,** and also:
     - **greps `app.js`** for every `setGesture` and every `hold.` call, and
       checks each against H3;
     - **reads every path in `edit-gesture.js` that closes a record**
       (`reconcile`, `dropRecord`, `nodeRemoved`, `pruneRemoved`, `reset`)
       and says, for each, whether `onNodeIdle` fires and why;
     - **writes its own test,** through the real tracker and the real
       `createBehaviorHold` wired as H3 wires them: a commit on node B, then
       an unrecorded commit on node A (the hold moves to A, §2.4); B's
       answer arrives first and must leave A held; A's answer then releases
       it.
   - A missing test is a finding, never a pass.
5. **Test runs:**
   - `apps/client` runs `node --test` on `apps/client/tests/`;
   - every other package runs `node --test` on its own test directory, and
     server test files run one at a time, each under `timeout 180`;
   - `packages/client` runs **without `--test-force-exit`**;
   - read proof results from the `not ok` and `cancelled` lines, not from
     the fail count.
6. **The test environment:** tests run in the DEV deploy as `atrium-build`
   with no network.
7. **What the deploy refuses:** no symlinks and no `node_modules` path
   component anywhere in the tree. Uploads during the round go under
   `devtasks/` only.

#### Before DEV acceptance (operator and Claude)
- Claude runs the spec's §5 browser check against the published SHA.
- **No agent completes the acceptance gate.** Your chain stops at it.

#### Report back (completion summary)
Report every task id, and confirm each of the following:
- the brief, implementation and review cards each carry the spec commit and
  hash, **in their body fields**, and the canonical worker-card
  requirements;
- every card was created with its parent, and none is `blocked` except the
  brief-review gate (say so if the guard held one and you linked it);
- the brief-review gate's parent, and its `blocked`/no-runs state;
- the implementation card's parent is the gate, and its `max-runtime` is
  7200 s;
- the review card's opening line;
- the review gate creates nothing and blocks on APPROVE;
- the review gate is linked to the sentinel `<SENTINEL_ID>`.

Then complete this kickoff. Do not start any of the work.

#### WORKER-CARD REQUIREMENTS (canonical)
<CANONICAL_REQUIREMENTS>

---
