# Kickoff — step 3b: the starter library, the sky, and the sky loader (`library-sky`)

How to use this file: the **front-door note** is for the front door and the
operator. Everything between the two rules is the **kickoff body**, posted
verbatim on the kickoff card. Then post the canonical worker-card requirements as a
separate comment headed `WORKER-CARD REQUIREMENTS (canonical)`, and the sentinel's
id.

**Front-door note (check before creating the card):**
- **Base:** `base_main_sha = 61c520acaa0308fa756d7fb0f652b109d2f1b77a`. Confirm it
  with a host fetch of `origin/main`. Any later commit on `main` must touch only
  `devtasks/`.
- **The base must carry:**
  - `devtasks/PREBRIEF-library-sky.md`, FINAL Rev 1.1, 58,838 bytes, sha256
    `9c89ba58810db689788959f64364c6298aa578079366321a27e80590e12c31ee`;
  - `apps/client/library/catalog.json`, sha256
    `f18db4fabbba2b72165500c41600e5a6f93936e88c9428bd12babac444a0e54d`.
- **The spec goes by git reference, never as comments.** At 59 KB it is over
  the 40 KB limit (models-hardening passdown §4.1). Post no PART comments.
- **No open sentinel**, and `workflow/library-sky` does not exist yet. Do a
  push dry run first.
- **The `kanban_create` field-drop fault is still open** (passdown 10-21 §4.8).
  After the graph is built, check the implementation card's
  `max_runtime_seconds` is 10800. If it isn't, raise it while the card is
  `todo` (models-by-url passdown §5.3).
- **The host part is done:** library installed, Caddy serving
  `/assets/library/*` on both sites, catalog on `main`. Nothing on the host
  changes this round except DEV's restart.

---

### KICKOFF — Phase 3 step 3b: the starter library, the sky, and the sky loader. Slug: `library-sky`

You are the kickoff orchestrator for this workflow. Build the task graph
below, read it back, report, and stop. Do not implement, review or deploy
anything yourself.
- **Your tools:** only `kanban_*`.
- **`OPERATOR BLOCK:`** This body quotes that prefix for the gates it
  describes. **Never use it in a block or comment of your own.**
- **Blocking:** **never call `kanban_block` without an explicit `task_id`,
  and never block this card.** A bare block acts on your own card and strands
  the graph in triage (2026-10-19).
- **Titles and bodies:** use every title and body below **exactly as
  written**. Do not invent titles: the guard refuses them.

**Wait for the `WORKER-CARD REQUIREMENTS (canonical)` comment and the
sentinel id before building anything.** If you are dispatched before both are
on this card, block with `kind="needs_input"` and do nothing else.

#### Where the spec is: in git, by reference, checked by hash
The spec is too large to post (59 KB). Every card that needs it reads it from
the base commit and checks it first:

```
git -C /workspace/atrium fetch origin main
git -C /workspace/atrium show 61c520acaa0308fa756d7fb0f652b109d2f1b77a:devtasks/PREBRIEF-library-sky.md > /tmp/prebrief.md
sha256sum /tmp/prebrief.md   # must be 9c89ba58810db689788959f64364c6298aa578079366321a27e80590e12c31ee
```

If the hash differs, block with `kind="capability"` and quote both hashes. Do
not work from a different text.

- **The spec:** `devtasks/PREBRIEF-library-sky.md`, **FINAL Revision 1.1
  (2026-10-22)**, sha256 `9c89ba58…12c31ee`. §3 records the decisions, §4 is
  the contract, §5 the tests, §7 the worker rules. §12–§14 are review history:
  read them, but they add nothing to the contract.
- **The worker-card requirements** are a separate comment on this card,
  headed `WORKER-CARD REQUIREMENTS (canonical)`. Card bodies refer to that
  comment by its id; they never point at a host path.

#### Settlement (operator) — do not reopen
- **Base:** `base_main_sha = 61c520acaa0308fa756d7fb0f652b109d2f1b77a`.
  - Workflow branch: **`workflow/library-sky`**, created from that SHA.
  - Worktree: `/workspace/wt/library-sky`, made with
    `git -C /workspace/atrium worktree add -b workflow/library-sky /workspace/wt/library-sky 61c520acaa0308fa756d7fb0f652b109d2f1b77a`.
- **Scope:** implement **§4's code part, Z1–Z5**, per the approved decisions
  **L13–L15 and L21–L31** (§3).
  - **H1–H3 are done** on the host. **Nothing under `scripts/`** is part of
    this round.
  - Everything listed as out of scope in the status block stays out.
  - The decisions are not to be re-derived or re-argued in the brief.
- **Files:**
  - **`packages/server`:** `send-policy.js` (Z5), and tests.
  - **`packages/client`:** `model-spec.js` (`skyUrlProblem`, `resolveSkyUrl`)
    and `model-fetch.js` (`fetchImage`), and tests.
  - **`packages/renderer-three`:** `load-background.js` (the sky controller,
    Z3) and its export in `index.js`, and tests.
  - **`apps/client`:**
    - new `src/library-catalog.js`, `src/library-grid.js` and
      `src/sky-picker.js`;
    - `app.js`, wiring only, including `beginNewWorld()` and the `request.library`
      branch;
    - `index.html`: the Library button and grid, the World row and Sky select,
      the import-map entries;
    - and tests.
  - **`tools/som-inspector/src/app.js`:** the controller and `resetWorld` calls
    (Z3), plus its import map if needed.
  - **`tests/fixtures/`:** `generate-atrium.js` writes
    `/tests/fixtures/skyboxtest1.png`; `atrium.gltf` is regenerated.
- **`apps/client/library/catalog.json` is data. Do not edit it.** If a test
  fails on it, block with `kind="capability"`: it is a host-side problem.
- **No protocol or SOM change.** If the brief or the implementation finds one
  is needed, stop and ask.
- **Full pipeline round, with a DEV restart** (the server's sky check).
  - The operator's outside code review of the published SHA, and Claude's
    browser checks (§5.1), come **before DEV acceptance**.
  - The outside review focuses on Z3 and Z1.

#### Graph — build exactly this
1. **GLM brief** — assignee `atrium-glm`. Parent: this kickoff. Title:
   `GLM brief — library-sky`.
   - Its card carries (a) this kickoff body, (b) the spec reference and hash
     check above, and (c) a reference to the worker-card requirements comment.
   - The brief it writes is the **self-contained contract** for the
     implementation:
     - every Z1–Z5 rule, written out;
     - the full §5 test table;
     - every proof (p1)–(p15);
     - the §5.1 checks;
     - the §7 step list.
   - It may refer to sections of the spec, but must not leave a rule only
     in the spec.
2. **Operator brief-review gate** — assignee `atrium-orchestrator`.
   - Title exactly `OPERATOR BLOCK: awaiting human brief review — library-sky`.
   - Created with `initial_status="blocked"`. Parent = the GLM brief.
   - Body exactly: `OPERATOR BLOCK: human brief-review gate. Only the operator completes this. An agent dispatched here must kanban_block(kind="needs_input") on this card and do nothing else.`
   - Read it back and confirm `status == "blocked"` with no runs.
3. **DeepSeek implementation** — assignee `atrium-deepseek`. Title:
   `Implement — library-sky`.
   - **Its parent MUST be the gate** (step 2), not the brief.
   - Create it with **`--max-runtime 3h`** (10800 s), passed explicitly.
   - Its body carries:
     - the spec reference and hash check;
     - the instruction to **read the GLM brief's card, comments included**,
       as the contract;
     - the worktree command above, with `-b`;
     - the requirements below;
     - the worker-card requirements reference.
4. **One GLM review** — assignee `atrium-glm`. Title: `GLM review — library-sky`.
   - Parent: the implementation.
   - A **single** review. A re-review after a revision is also a single GLM
     review.
   - Its body opens with the exact line `THIS RUN HAS TERMINAL, FILE AND GIT TOOLS. Use them for every step below.`
   - Then the spec reference and the requirements below.
5. **Review gate** — assignee `atrium-orchestrator`. Title:
   `Review gate — library-sky`. Parent: the review. It **creates nothing**.
   - **On a valid APPROVE** naming the exact 40-character SHA, it blocks with
     `kind="needs_input"` and the reason
     `APPROVE <SHA40>: front door, build the release chain`.
   - **On a missing, malformed or non-APPROVE verdict**, it blocks for the
     operator with the verdict quoted.
   - The front door then builds the release chain (below) and completes the
     gate (models-by-url passdown §4.4).
6. **Sentinel** — the front door creates it and posts its id here; it is
   parented on this kickoff.
   - **Before you complete,** link the review gate to the sentinel as an
     additional parent: `kanban_link(parent_id=<review gate id>, child_id=<sentinel id>)`.
   - The front door later adds the **DEV finalizer** as a further parent.
   - Do not create a second sentinel, and never complete it.
7. **Nothing reaches MAIN or PROD.** Those are host-side, operator-approved
   steps.

#### Release chain (the front door builds it on the gate's APPROVE)
Every body carries the full 40-character reviewed SHA; the guard refuses a
stage card without it. The DEV deploy runs the host's **automatic release
merge** (models-hardening passdown §2.1), so DEV, MAIN and PROD may run a
`RELEASE_SHA` that differs from the reviewed SHA.

1. **`Publish workflow — <sha8>`** — assignee `atrium-deployer`, parent = the
   review gate. Body:
   `Publish the GLM-approved SHA <SHA40> to workflow/library-sky with exactly one call: atrium_deploy(action="publish", sha="<SHA40>", branch="workflow/library-sky"). On any refusal, non-zero exit or unexpected message: do not retry and do not try a workaround; kanban_block(kind="capability") with the complete output verbatim.`
2. **`DEV deploy — <sha8>`** — assignee `atrium-deployer`, parent = card 1.
   Body:
   `Deploy SHA <SHA40> to DEV with exactly one call: atrium_deploy(action="dev", sha="<SHA40>"). On any refusal, non-zero exit or unexpected message (including exit 77, NOT ROLLING BACK, REFUSING, COULD NOT CONFIRM, or a held lock): do not retry and do not run recover; kanban_block(kind="capability") with the complete output verbatim. Your handoff must quote verbatim the lines REVIEWED_SHA=, RELEASE_SHA=, TARGET_SHA=, local:, public:, SMOKE OK: and === DEV DEPLOY SUCCESS ===. DEPLOY_OK <sha> alone is not a handoff.`
3. **`DEV finalizer — <sha8>`** — assignee `atrium-orchestrator`, parent =
   card 2. Body:
   `Pass only if the parent DEV deploy's handoff shows === DEV DEPLOY SUCCESS ===, healthy local and public lines, SMOKE OK, REVIEWED_SHA=<SHA40>, and TARGET_SHA equal to RELEASE_SHA; complete naming both SHAs. If the handoff shows DEV ALREADY AT TARGET_SHA, or lacks any of these lines, kanban_block(kind="capability") for the operator. Do not create any sentinel card: the round's sentinel already exists and this card is linked to it as a parent.`
4. **`Awaiting DEV acceptance / main merge approval — <sha8>`** — assignee
   `atrium-orchestrator`, parent = card 3, `initial_status="blocked"`. Body:
   `OPERATOR BLOCK: awaiting DEV acceptance / main merge approval — <sha8> (reviewed SHA <SHA40>). MAIN and PROD use RELEASE_SHA: confirm it against atrium-release-status's DEV and REVIEWED lines before atrium-main-approve. Only the operator completes this; an agent dispatched here must kanban_block(kind="needs_input") and do nothing else.`

The front door links card 3 to the sentinel as a parent, then completes the
review gate.

**Release path:** the publish, DEV deploy and finalizer cards make one call
each. On any refusal, non-zero exit or unexpected message, they do not retry
and do not try a workaround: they block with `kind="capability"` and the
complete output verbatim, for the operator.

#### Requirements for the implementation AND review cards (beyond the spec)
1. **Ordered steps, one commit per step** (spec §7):
   1. Z5, plus the shared sky-URL vectors used by the server and the client;
   2. Z3 `fetchImage` and `resolveSkyUrl`, plus the regenerated fixture;
   3. Z3's sky controller, with `app.js` (including `beginNewWorld()`) and
      the SOM Inspector moved onto it;
   4. Z1, the catalog module, plus the test that reads the committed catalog;
   5. Z2, the Library grid, with the `request.library` answer branch;
   6. Z4, the Sky picker, with the Retry button;
   7. full suites, proofs and handoff.

   **If a run stops partway:** block with `kind="needs_input"` once. Use a
   different kind for a second consecutive stop: two `needs_input` blocks in
   a row send the card to triage.
2. **The rules most likely to be missed:**
   - **The sky controller alone writes `scene.background` and
     `scene.environment`.** `app.js` L639–641 and the Inspector's L217–218
     are removed (Z3).
   - **The newest value wins.** A differing pending request is cancelled
     before the loaded-URL and failed-URL shortcuts (Z3 step 3).
   - **`resetWorld()` is called from `beginNewWorld()`, `connecting` and
     `disconnected`,** and before each of the Inspector's five `loadWorld`
     calls.
   - **The picker's rollback goes through `client.applyLocally` and is never
     sent** (Z4).
   - **Catalog paths match Z1's exact patterns,** never a prefix test.
   - **Every new browser-imported module path has an import-map entry,** in
     `apps/client/index.html` and the SOM Inspector's page. Round 1 of 3a
     failed on exactly this.
3. **The handoff includes every proof (p1)–(p15),** each with its failing
   test names, **and** what canonical requirement §2 asks:
   - the per-file counts, with their commands and exit codes;
   - the Node version and the skipped count.
   **Commit before running proofs. Restore each broken file from a saved
   copy, never with `git checkout`.**
4. **"Not reproducible" is not an acceptable proof result** (models-hardening
   passdown §4.3).
   - Either the break is wrong (fix the break) or the test is weak
     (strengthen it).
   - **The reviewer reproduces every proof itself,** and checks that **every
     test in the spec's §5 table exists** (name each).
   - A missing test is a coverage gap, reported as a finding, never a pass.
5. **Test runs:**
   - Run `packages/client` **without `--test-force-exit`**: it truncates at
     random (models-hardening §4.5).
   - Read proof results from the `not ok` and `cancelled` lines, not from the
     fail count.
   - Server test files run one at a time, each under `timeout 180`.
6. **The test environment:**
   - Tests run in the DEV deploy as `atrium-build` with no network: loopback
     only.
   - New tests listen on port 0.
   - `apps/client` tests can't import three.js or touch the DOM. Grid,
     picker and catalog logic take plain values.
7. **Uploads during the round go under `devtasks/` only.** Anything else is
   refused at the DEV deploy.

#### Before DEV acceptance (operator and Claude)
- The operator runs an outside code review of the **published SHA**.
- Claude runs §5.1's browser checks against the real library files.
- **No agent completes the acceptance gate.** Your chain stops at it.

#### Report back (completion summary)
Report every task id, and confirm each of the following:
- the brief card carries the spec reference, the hash check and the
  requirements reference;
- the brief-review gate's parent, and its `blocked`/no-runs state;
- the implementation card's parent is the gate, and its `max-runtime` is
  10800 s;
- the review card's opening line;
- the review gate creates nothing and blocks on APPROVE;
- the review gate is linked to the sentinel.

Then complete this kickoff. Do not start any of the work.

---
