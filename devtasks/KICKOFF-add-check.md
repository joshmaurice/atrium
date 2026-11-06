# Kickoff — the `add` check (`add-check`)

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
    **verbatim**, the same text as undo-hold's kickoff carried.

  Then it creates the card with the filled body in its **body field**, and
  reads it back whole.

**Front-door note (check before creating anything):**
- **Base:** `base_main_sha = 25f6b08328b60cf44cf7a71c8f5f7ebef51805a9`.
  - Its runtime code is identical to the release on DEV, MAIN and PROD,
    `8fc82bb5`. `git diff --stat 8fc82bb5203ecbbf6f862d7d5839c111f916e77f
    25f6b08328b60cf44cf7a71c8f5f7ebef51805a9 -- packages apps tools tests package.json pnpm-lock.yaml
    pnpm-workspace.yaml` is empty: every commit between them touches only
    `devtasks/`.
  - Confirm it with a host fetch of `origin/main`. **Every commit after the
    base must touch only `devtasks/`.** This file is such a commit.
- **The base must carry `devtasks/PREBRIEF-add-check.md`,** FINAL Rev 1.1,
  28535 bytes, sha256
  `759111ceaedf2c7909e9424b2e73d3820e84a110246209b1f17ce6baf8af8ed4`.
  **Check the hash yourself.** Fill `<SPEC_CHECK>` with one line:
  `SPEC CHECK (front door): 25f6b08328b60cf44cf7a71c8f5f7ebef51805a9:devtasks/PREBRIEF-add-check.md sha256 <the hash you computed>, 28535 bytes, matches.`
  If it doesn't match, stop and tell the operator. The pre-brief has no
  outside review of its own; its contract comes from the two outside reviews
  of `PREBRIEF-richer-add-copy.md` Rev 0.1, and the round's code gets one.
- **The spec goes by git reference,** as for the last rounds.
- **The sentinel first.** Create it with the same shape as undo-hold's, for
  this slug. A card created without a parent is created `blocked`, which is
  what a sentinel created before its kickoff wants. After creating the kickoff
  card, `kanban_link(parent_id=<kickoff id>, child_id=<sentinel id>)`, and read
  the sentinel back: parented on the kickoff, never claimed, never completed.
  **Archive any earlier round's open sentinel first** (4d-1 passdown §3): with
  exactly one open sentinel, the guard links it to new review gates and
  finalizers itself.
- **`workflow/add-check` doesn't exist yet.** Do a push dry run first:
  `git -C /workspace/atrium push --dry-run origin 25f6b08328b60cf44cf7a71c8f5f7ebef51805a9:refs/heads/workflow/add-check`.
  Expect `* [new branch]`.
- **Card bodies go in the body field.** After every create, read the card
  back. If a body or field is still missing, post the missing text as that
  card's first comment while it's `todo`. **Never create a second card in
  its place.**
  - The implementation card's `max_runtime_seconds` must be **7200**. If it
    came out at the guard's default, raise it **before the brief-review gate
    releases it** (the enforced value is the `tasks.max_runtime_seconds`
    column, not the card's notes: undo-hold passdown §3.3).
- **Parents, read back one card at a time** (undo-hold passdown §3.1: round
  3's kickoff landed two cards parentless, and the review was claimed while
  the implementation still ran). The kickoff body below says so too. When you
  check its report, confirm each card's `parents` from a read of your own.
- **On the review gate's APPROVE, build the WHOLE release chain in one go:**
  - Publish, DEV deploy, DEV finalizer and the acceptance gate, with the
    same four cards and bodies as undo-hold's chain, with this slug and the
    new SHA, **each created with its parent, and its parent read back before
    the next is created**. The branch is new, so the publish is a **first
    push**.
  - Link the finalizer to this round's sentinel, and **only then** complete
    the review gate.
  - Report every id.
  - If the finalizer blocks because the release merge's `RELEASE_SHA`
    differs from the reviewed SHA by `devtasks/` only, your byte-for-byte
    check of the served files is the evidence to accept it.
  - **The review's APPROVE counts only if** its SHA equals the
    implementation's `tip_sha` and its run started after the implementation
    completed (undo-hold passdown §3.1).
- **A server, protocol and client round with no dependency change.** The only
  `package.json` change is `packages/client`'s `./add-spec` export, and the
  only import-map change is its one line in `apps/client/index.html` (spec
  §6). Any other `package.json`, `pnpm-lock.yaml` or import-map change, or any
  stored-data migration, is a finding. The deploy runs its install step (a
  `package.json` changed) and restarts DEV (it changes `packages/server` and
  `packages/protocol`).
- **Nothing is pushed to `main` between the DEV deploy's release merge and
  the MAIN push** (scripting-4a passdown §4.4).

**Before DEV acceptance (outside the pipeline):**
- **Claude runs the checks in spec §5** on the published SHA: `p3`, `p4`, `p7`
  and `review-q/q2` turned round (every malformed `add` refused, every later
  join reads its dump), and the regression set `h1`–`h6` and `c2`.
- **DEV acceptance needs a hard reload in every tab.** The operator's own
  case: in an owned world, place a palette object and a pad, Duplicate the
  object, delete it and Undo; open the world in a second tab and see both
  objects and the other tab's avatar. Nothing about this round should be
  visible in normal use.

---

### KICKOFF — the `add` check. Slug: `add-check`

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
  `kanban_create` call), **then read that card back and check its `parents`
  before you create the next one.** A card created without one is created
  `blocked` by the guard and can be claimed out of order. If that happens,
  link its parent with `kanban_link` at once, read it back again, and only
  then go on. Never create a second card in its place.

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
git -C /workspace/atrium show 25f6b08328b60cf44cf7a71c8f5f7ebef51805a9:devtasks/PREBRIEF-add-check.md > /tmp/prebrief.md
sha256sum /tmp/prebrief.md   # must be 759111ceaedf2c7909e9424b2e73d3820e84a110246209b1f17ce6baf8af8ed4
```

On a mismatch, the card blocks with `kind="capability"`, quotes both hashes,
and does not work from a different text.

- **The spec:** `devtasks/PREBRIEF-add-check.md`, **FINAL Revision 1.1
  (2026-11-05)**:
  - §1: what the round delivers, and what it doesn't;
  - §2: verified facts, with the defect's cases (§2.3) and PROD's survey
    (§2.6);
  - §3: **decisions RA-L1, RA-L4, RA-L5, RA-L7 and RA-L8** (approved);
  - §4: **the contract, A1–A10**;
  - §5: tests and proofs (p1)–(p6), and Claude's checks;
  - §6: worker rules, **the four commits** and the files.
- **The worker-card requirements** are the last section of this body,
  headed `WORKER-CARD REQUIREMENTS (canonical)`. Card bodies copy them or
  refer to this card's body; they never point at a host path.

#### Settlement (operator) — do not reopen
- **Base:** `base_main_sha = 25f6b08328b60cf44cf7a71c8f5f7ebef51805a9`.
  - Workflow branch: **`workflow/add-check`**, created from that SHA.
  - Worktree: `/workspace/wt/add-check`, made with
    `git -C /workspace/atrium worktree add -b workflow/add-check /workspace/wt/add-check 25f6b08328b60cf44cf7a71c8f5f7ebef51805a9`.
- **Decisions (operator, 2026-11-05), all as recommended:** RA-L1 (a) this
  check is its own round, first; RA-L4 (a) avatars get their own budget; RA-L5
  (a) the bounds; RA-L7 (a) `send` shares the material ranges; RA-L8 (a)
  autosave reads back, and the server and client say when a world can't be
  loaded (`WORLD_UNREADABLE`).
- **Scope:** A1–A10 as written in the spec's §4, with §5's tests and proofs.
  **Not in scope:** the richer `add`, copying objects, a server-built avatar,
  any other change to what Duplicate and Undo accept, and anything else in
  `PREBRIEF-richer-add-copy.md`.
- **Files:** exactly the spec's §6 list. **No other file.** If the brief or
  the implementation finds that another file must change, stop and ask.
- **A server, protocol and client round, full pipeline.** Claude's checks
  come before DEV acceptance.

#### Graph — build exactly this
1. **GLM brief** — assignee `atrium-glm`. Parent: this kickoff. Title:
   `GLM brief — add-check`.
   - Its card carries:
     - (a) the spec reference and hash check above, with the commit and
       hash copied in;
     - (b) the Settlement above, whole;
     - (c) the requirements section below, whole;
     - (d) the canonical worker-card requirements, whole.
   - The brief it writes is the **self-contained contract** for the
     implementation: A1–A10 written out, with every number in them; the
     reason codes; the vectors file's shape; every §5 test and proof (p1)–
     (p6); and the step list below. It may refer to sections of the spec, but
     must not leave a rule only in the spec.
2. **Operator brief-review gate** — assignee `atrium-orchestrator`.
   - Title exactly `OPERATOR BLOCK: awaiting human brief review — add-check`.
   - Created with `initial_status="blocked"`. Parent = the GLM brief.
   - Body exactly: `OPERATOR BLOCK: human brief-review gate. Only the operator completes this. An agent dispatched here must kanban_block(kind="needs_input") on this card and do nothing else.`
   - Read it back and confirm `status == "blocked"`, its parent, and no runs.
3. **DeepSeek implementation** — assignee `atrium-deepseek`. Title:
   `Implement — add-check`.
   - **Its parent MUST be the gate** (step 2), not the brief. Read it back
     and confirm that before step 4.
   - Create it with **`--max-runtime 2h`** (7200 s), passed explicitly.
   - Its body carries:
     - the spec reference and hash check;
     - the instruction to **read the GLM brief's card, comments included**,
       as the contract;
     - the worktree command above, with `-b`;
     - the requirements below;
     - the canonical worker-card requirements.
4. **One GLM review** — assignee `atrium-glm`. Title:
   `GLM review — add-check`. **Parent: the implementation.** Read it back and
   confirm that before step 5.
   - A **single** review.
   - Its body opens with the exact line `THIS RUN HAS TERMINAL, FILE AND GIT TOOLS. Use them for every step below.`
   - Then the spec reference, the requirements below and the canonical
     worker-card requirements.
   - It also says: **put the verdict, the reviewed 40-character SHA and the
     findings in the completion summary itself** (undo-hold passdown §3.2).
5. **Review gate** — assignee `atrium-orchestrator`. Title:
   `Review gate — add-check`. Parent: the review. It **creates nothing**.
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
These are the same four cards as undo-hold's, with this slug and the new SHA.
- Every body carries the full 40-character reviewed SHA.
- The DEV deploy runs the host's automatic release merge, so DEV, MAIN and
  PROD may run a `RELEASE_SHA` that differs from the reviewed SHA.
- **The publish, DEV deploy and finalizer cards make one call each.** On any
  refusal, non-zero exit or unexpected message, they do not retry: they block
  with `kind="capability"` and the complete output verbatim.

#### Requirements for the implementation AND review cards (beyond the spec)
1. **Ordered steps, one commit per step, every commit runnable** (spec §6):
   1. **The rule:** `tests/fixtures/add-node-vectors.json`, `checkAddNode`
      and A9's range predicates in `send-policy.js`, `translation` in
      `checkTransformValues`, and `packages/client/src/add-spec.js`, with both
      suites reading the vectors.
   2. **The server:** the handler (A2's `format`, A6), `materialValueOk` (A9),
      the schemas (A8), the protocol tests, and the new server test file.
      **Its join tests are first run on the base and seen failing;** keep that
      output for the handoff.
   3. **A10:** `readBackProblem` in `world.js`, autosave, the join's
      `WORLD_UNREADABLE`, `_onSomDump`, the app's panel and
      `teleport-failure.js`, with their tests.
   4. **The client's Duplicate and Undo (A7),** the full suites, proofs
      (p1)–(p6) and the handoff.

   **Each step's report lists the suites run.** **If a run stops partway:**
   block with `kind="needs_input"` once; use a different kind for a second
   consecutive stop.
2. **The rules most likely to be missed:**
   - **"Finite" means finite as a Float32:**
     `Number.isFinite(Math.fround(v))`. `1e39` is a finite double and must be
     refused.
   - **Lengths and key sets before any per-element work.** A 20,000-primitive
     avatar is refused from `primitives.length` alone; the server test bounds
     the reply at 500 ms.
   - **The whole node, not just the mesh:** `translation` (in K6, with the
     `isVec3` predicate `send` uses), `extensions` (empty or absent), non-Atrium
     `extras` (16 KiB of UTF-8), and the message's `format` (`"gltf"` or
     absent).
   - **Avatars have their own budget:** exactly 1 primitive, ≤ 1,024
     vertices, ≤ 6,144 indices, `extras` only `displayName` (≤ 256) and
     `atrium`, which is K4's: **every real avatar carries
     `extras.atrium.ephemeral`, and must be accepted.** The check runs
     **before** the server overwrites `displayName`.
   - **Placement:** after K6, before the first world change; for world adds
     first inside the V9 `try`; for avatars in a `try` of their own. Fail
     closed. **A refused `add` is broadcast to no one.**
   - **Acceptance checks read back.** A joiner's `som-dump` is read with the
     client's own `WebIO` and `KHRONOS_EXTENSIONS`; a world `add` goes
     `serialize` → `createWorldFromDocument` → `serialize`. "The dump arrived"
     is not a pass (`POSITION []` sends one).
   - **The schema refuses some shapes first,** as `UNKNOWN_MESSAGE`. Those
     server tests assert "refused, nothing changed, nothing broadcast"; the
     vectors test `checkAddNode` and `add-spec.js` alone.
   - **`WORLD_UNREADABLE` is a new code** in `error.json`, and the exact
     reason sentence is `That world can't be loaded right now.`
   - **A test of a seam uses the real collaborator:** descriptors from the
     real builders (`buildAvatarDescriptor`, `buildTeleporterDescriptor`,
     `buildPrimitiveDescriptor`, `prepareDuplicate`), sent through the real
     `attachSessionHandlers`.
3. **The handoff includes:**
   - step 2's join tests failing on the base, quoted;
   - every proof, (p1)–(p6), **quoting the output of both runs** (failing
     and green), with its failing test names;
   - what canonical requirement §2 asks: the per-file counts with their
     commands and exit codes, and the Node version.

   **Commit before running proofs. Restore each broken file from a saved
   copy, never with `git checkout`.**
4. **"Not reproducible" is not an acceptable proof result.** Either the
   break is wrong (fix it) or the test is weak (strengthen it).
   - **The reviewer reproduces every proof itself,** and also:
     - **runs `devtasks/spike-richer-add/p3-malformed.mjs`, `p4-avatar-dump.mjs`,
       `p7-float32-extensions.mjs` and `review-q/q2-empty-accessor-and-cost.mjs`**
       on the base and on the round's SHA, from the repo root, and quotes both
       outputs: every malformed case accepted on the base is refused on the
       round's SHA, and every later join reads its dump;
     - **greps for every caller of `world.addNode` and `ingestNode`** on the
       server and says, for each, whether its input has passed `checkAddNode`,
       and why that's enough if not;
     - **compares `checkAddNode` and `add-spec.js` line by line** against
       A2–A5 and A9, and against each other, and lists any difference;
     - **runs the real avatar through the real `AtriumClient.connect` path**
       (or `visitor-leak.test.js`'s first-party cycle) and confirms it's
       accepted with its `ephemeral` marker;
     - **writes its own tests,** through the real handler: (i) a world add
       carrying a valid `extras.atrium.model` and a mesh whose POSITION holds
       `3.5e38` is refused with the mesh's reason, broadcasts nothing and
       triggers no autosave; (ii) an avatar `add` of exactly 1,024 vertices and
       6,144 indices is accepted, and a joiner reads its dump.
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
- Claude runs the spec's §5 checks against the published SHA.
- **No agent completes the acceptance gate.** Your chain stops at it.

#### Report back (completion summary)
Report every task id, and confirm each of the following:
- the brief, implementation and review cards each carry the spec commit and
  hash, **in their body fields**, and the canonical worker-card
  requirements;
- **every card's `parents`, as you read them back,** and that none is
  `blocked` except the brief-review gate (say so if the guard held one and you
  linked it);
- the brief-review gate's parent, and its `blocked`/no-runs state;
- the implementation card's parent is the gate, and its `max-runtime` is
  7200 s;
- the review card's opening line, and its parent is the implementation;
- the review gate creates nothing and blocks on APPROVE;
- the review gate is linked to the sentinel `<SENTINEL_ID>`.

Then complete this kickoff. Do not start any of the work.

#### WORKER-CARD REQUIREMENTS (canonical)
<CANONICAL_REQUIREMENTS>

---
