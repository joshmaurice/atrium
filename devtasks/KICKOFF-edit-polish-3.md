# Kickoff — Edit mode polish 3 (`edit-polish-3`)

How to use this file:
- The **front-door note** is for the front door and the operator.
- Everything between the two rules is the **kickoff body**. Post it
  verbatim on the kickoff card.
- Then post the canonical worker-card requirements as a separate comment
  headed `WORKER-CARD REQUIREMENTS (canonical)`, then the sentinel's id.

**Front-door note (check before creating the card):**
- **Base:** `base_main_sha = dcd5fa6e4625bf9d483fe8ce3e7cc3c79bfb38bd`.
  Confirm it with a host fetch of `origin/main`. Any later commit on `main`
  (this file's, for one) must touch only `devtasks/`.
- **The base must carry** `devtasks/PREBRIEF-edit-polish-3.md`, FINAL Rev
  1.1, 36,371 bytes, sha256
  `031b140d1115ffe6d6fd20bcd50c8d302694440043b78c5820951f8a04cc1dec`.
  **Check the hash yourself and post the commit and hash on the kickoff
  card.** The kickoff has only `kanban_*` tools and can't check it
  (library-sky passdown §4.3).
- **The spec goes by git reference,** as library-sky's did. Post no PART
  comments.
- **No open sentinel,** and `workflow/edit-polish-3` doesn't exist yet. Do a
  push dry run first.
- **The `kanban_create` field-drop fault is still open.** After **every**
  create, read the card back.
  - If the body or any field is missing, post the missing text as the first
    comment on **that** card, or fix the field while the card is `todo`.
  - **Never create a second card in its place** (library-sky passdown §4.2:
    three duplicate kickoffs and 14 stray cards).
  - Check the implementation card's `max_runtime_seconds` is 10800.
- **Client-only round:** no server, protocol, SOM or `packages/client`
  change. Nothing on the host changes.

---

### KICKOFF — Edit mode polish 3. Slug: `edit-polish-3`

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
git -C /workspace/atrium show dcd5fa6e4625bf9d483fe8ce3e7cc3c79bfb38bd:devtasks/PREBRIEF-edit-polish-3.md > /tmp/prebrief.md
sha256sum /tmp/prebrief.md   # must be 031b140d1115ffe6d6fd20bcd50c8d302694440043b78c5820951f8a04cc1dec
```

On a mismatch, the card blocks with `kind="capability"`, quotes both hashes,
and does not work from a different text.

- **The spec:** `devtasks/PREBRIEF-edit-polish-3.md`, **FINAL Revision 1.1
  (2026-10-22)**.
  - §3: the decisions.
  - §4: the contract, Z1–Z8.
  - §5: the tests and proofs.
  - §5.1: Claude's browser checks.
  - §7: the worker rules.
  - §11: review history. Read it, but it adds nothing to the contract.
- **The worker-card requirements** are a separate comment on this card,
  headed `WORKER-CARD REQUIREMENTS (canonical)`. Card bodies refer to that
  comment by its id; they never point at a host path.

#### Settlement (operator) — do not reopen
- **Base:** `base_main_sha = dcd5fa6e4625bf9d483fe8ce3e7cc3c79bfb38bd`.
  - Workflow branch: **`workflow/edit-polish-3`**, created from that SHA.
  - Worktree: `/workspace/wt/edit-polish-3`, made with
    `git -C /workspace/atrium worktree add -b workflow/edit-polish-3 /workspace/wt/edit-polish-3 dcd5fa6e4625bf9d483fe8ce3e7cc3c79bfb38bd`.
- **Scope:** implement **§4, Z1–Z8,** per the approved decisions **S1, S2
  and L1–L6** (all (a)).
  - Everything the status block and §9 list as out of scope stays out.
  - The decisions are not to be re-derived or re-argued in the brief.
- **Files:**
  - **`packages/renderer-three`:** `load-background.js` (Z4) and its tests.
  - **`apps/client/src`:**
    - new `teleporter-form.js` (Z3);
    - `model-form.js`: `createFormGate().closeCurrent()`, and the input
      mirroring `state.url` (Z2);
    - `sky-picker.js` (Z5);
    - `teleport-trigger.js`: `padNearSpawn` only (Z7);
    - `app.js`: wiring (Z1, Z2, Z3, Z7);
    - `index.html`: only `#ep-spawn-note`.
  - **`apps/client/tests`:**
    - new `teleporter-form.test.js` and `app-wiring.test.js`;
    - `model-form`, `sky-picker`, `teleport-trigger` and `edit-key-wiring`
      tests.
- **No server, protocol, SOM or `packages/client` change.** If the brief or
  the implementation finds one is needed, stop and ask.
- **Full pipeline round.** The operator's outside code review of the
  published SHA, and Claude's browser checks (§5.1), come **before DEV
  acceptance**.

#### Graph — build exactly this
1. **GLM brief** — assignee `atrium-glm`. Parent: this kickoff. Title:
   `GLM brief — edit-polish-3`.
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
     - the §7 step list.
   - It may refer to sections of the spec, but must not leave a rule only in
     the spec.
2. **Operator brief-review gate** — assignee `atrium-orchestrator`.
   - Title exactly `OPERATOR BLOCK: awaiting human brief review — edit-polish-3`.
   - Created with `initial_status="blocked"`. Parent = the GLM brief.
   - Body exactly: `OPERATOR BLOCK: human brief-review gate. Only the operator completes this. An agent dispatched here must kanban_block(kind="needs_input") on this card and do nothing else.`
   - Read it back and confirm `status == "blocked"` with no runs.
3. **DeepSeek implementation** — assignee `atrium-deepseek`. Title:
   `Implement — edit-polish-3`.
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
   `GLM review — edit-polish-3`. Parent: the implementation.
   - A **single** review.
   - Its body opens with the exact line `THIS RUN HAS TERMINAL, FILE AND GIT TOOLS. Use them for every step below.`
   - Then the spec reference and the requirements below.
5. **Review gate** — assignee `atrium-orchestrator`. Title:
   `Review gate — edit-polish-3`. Parent: the review. It **creates nothing**.
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

#### Release chain (the front door builds it on the gate's APPROVE)
These are the same four cards as library-sky's
(`devtasks/KICKOFF-library-sky.md`, "Release chain"), with `library-sky`
replaced by `edit-polish-3` and the new SHA.
- Every body carries the full 40-character reviewed SHA.
- The DEV deploy runs the host's automatic release merge, so DEV, MAIN and
  PROD may run a `RELEASE_SHA` that differs from the reviewed SHA.
- The front door links the DEV finalizer to the sentinel as a parent, then
  completes the review gate.
- **The publish, DEV deploy and finalizer cards make one call each.** On
  any refusal, non-zero exit or unexpected message, they do not retry: they
  block with `kind="capability"` and the complete output verbatim.

#### Requirements for the implementation AND review cards (beyond the spec)
1. **Ordered steps, one commit per step** (spec §7):
   1. Z4 (renderer-three);
   2. Z5 (`sky-picker.js`);
   3. Z3 (`teleporter-form.js` and its tests), plus Z2's `closeCurrent()`
      and input mirroring in `model-form.js`, with their tests;
   4. the `app.js` wiring for Z1, Z2, Z3 and Z7, `#ep-spawn-note`,
      `padNearSpawn`, and `app-wiring.test.js`;
   5. Z6;
   6. full suites, proofs and the handoff.

   **If a run stops partway:** block with `kind="needs_input"` once. Use a
   different kind for a second consecutive stop.
2. **The rules most likely to be missed:**
   - **Edit off:** `modelGate.closeCurrent()`, **then**
     `modelForm.reset()`, replacing the direct `closeTeleporterForm()` call.
     The Model form's `render()` writes the input box from `state.url`
     unless it has focus (Z2).
   - **Owned versus not-owned answers:**
     - each form handles its own answers completely, including selecting
       its accepted node;
     - a `request.model` or `request.teleporter` answer the form doesn't own
       **never** reaches `selectAdded` (Z2, Z3);
     - the generic branch stays for palette and Duplicate adds only.
   - **The teleporter form's `wire()` owns all four of its listeners.** A
     fresh `open()` empties the fields and sets the list's loading or
     manual-only state **before** `listWorlds()` resolves, and a late list
     is dropped (Z3).
   - **Save hides the old error** when it dispatches (Z3).
   - **The sky picker's `change(value)` returns early when `value` equals
     the current value,** before computing any URL (Z5).
   - **The key guard finds the third argument exactly,** splitting at
     top-level commas. It never searches the handler's body for `true` or
     `capture` (Z6).
   - **`padNearSpawn` checks each pad's own world position** through
     `worldPositionOf`. `refreshSpawnNote()` is called from every site Z7
     lists, including `onHandleChange` and descendants' `som:set`.
   - **New `apps/client` modules are imported relatively** from `app.js`, so
     they need no import-map entry. `importmap-guard` must stay green.
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
   - `apps/client` and `packages/renderer-three` run with
     `node --test tests/*.test.js` in each package.
   - Read proof results from the `not ok` and `cancelled` lines, not from
     the fail count.
   - Run the other suites too, to show they're unchanged. Server test files
     run one at a time, each under `timeout 180`, and `packages/client` runs
     **without `--test-force-exit`**.
6. **The test environment:**
   - Tests run in the DEV deploy as `atrium-build` with no network.
   - `apps/client` tests can't import three.js or touch the DOM. The forms
     take fake elements, and `padNearSpawn` takes plain values.
7. **Uploads during the round go under `devtasks/` only.** Anything else is
   refused at the DEV deploy.

#### Before DEV acceptance (operator and Claude)
- The operator runs an outside code review of the **published SHA**.
- Claude runs §5.1's browser checks.
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
