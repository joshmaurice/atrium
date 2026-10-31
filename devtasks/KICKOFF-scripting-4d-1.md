# Kickoff — Phase 3 step 4d-1, graphs beyond the templates (`scripting-4d-1`)

How to use this file:
- The **front-door note** is for the front door and the operator.
- Everything between the two rules is the **kickoff body**. **Nothing is
  posted on the kickoff card after it is created** (scripting-4c passdown
  §4.5: round 2's kickoff was claimed within a second, before its comments
  existed). So, before creating it, the front door fills the body's three
  placeholders:
  - `<SENTINEL_ID>`: the sentinel's id (the sentinel is created **first**,
    below);
  - `<SPEC_CHECK>`: the front door's own line confirming the spec's commit
    and hash (format below);
  - `<CANONICAL_REQUIREMENTS>`: the canonical worker-card requirements,
    **verbatim**, the same text as signin-sync's (comment 855 on
    `t_2d41531f`) and 4c's.

  Then it creates the card with the filled body in its **body field**, and
  reads it back whole.

**Front-door note (check before creating anything):**
- **Base:** `base_main_sha = 4f19b2533308ef0dc0fa3c3d8a5b4164eb389e82`.
  - Its runtime code is identical to the release on DEV, MAIN and PROD,
    `14ab0076`. `git diff --stat 14ab00768b692634d8b767c44eb22285d2a93045
    4f19b2533308ef0dc0fa3c3d8a5b4164eb389e82 -- packages apps tools
    package.json pnpm-lock.yaml pnpm-workspace.yaml` is empty.
  - Between the release and the base, **one commit touches `tests/`**:
    `e600905e344bd356cef39d9e95c1b3f0127580fd`, Claude's conformance fixtures and the Khronos subset
    (G-L11, G8), which the round reads and may not edit. Everything else is
    `devtasks/`.
  - Confirm it with a host fetch of `origin/main`. **Every commit after the
    base must touch only `devtasks/`.** This file is such a commit.
- **The base must carry `devtasks/PREBRIEF-scripting-4d.md`,** FINAL Rev 1.4,
  121,240 bytes, sha256
  `457e2ff0d018580e117bc0e3aac3ae6d4d4e90aa36a9c6dbf1106cdc10279458`.
  **Check the hash yourself.** Fill `<SPEC_CHECK>` with one line:
  `SPEC CHECK (front door): 4f19b2533308ef0dc0fa3c3d8a5b4164eb389e82:devtasks/PREBRIEF-scripting-4d.md sha256 <the hash you computed>, 121240 bytes, matches.`
  If it doesn't match, stop and tell the operator. The kickoff has only
  `kanban_*` tools and can't check it. The pre-brief's three outside
  reviews are beside it (`REVIEW-scripting-4d-rev0.md`, `-rev1.md`,
  `-rev1.1.md`).
- **The spec goes by git reference,** as for the last four rounds.
- **The sentinel first** (4c passdown §4.5). Create it with the same shape
  as 4c round 2's (`t_005810cc`), for this slug. With guard v1.2.0 a card
  created without a parent is created `blocked`, which is what a sentinel
  created before its kickoff wants: nothing can claim it. After creating
  the kickoff card, `kanban_link(parent_id=<kickoff id>, child_id=<sentinel
  id>)`, and read the sentinel back. It must end exactly as round 2's did
  (parented on the kickoff, never claimed, never completed).
- **`workflow/scripting-4d-1` doesn't exist yet.** Do a push dry run first,
  with a concrete refspec:
  `git -C /workspace/atrium push --dry-run origin 4f19b2533308ef0dc0fa3c3d8a5b4164eb389e82:refs/heads/workflow/scripting-4d-1`.
  Expect `* [new branch]`.
- **Card bodies go in the body field.** After every create, read the card
  back. If a body or field is still missing, post the missing text as that
  card's first comment while it's `todo`. **Never create a second card in
  its place.** The guard's `args` lines in
  `/root/.hermes/logs/atrium-kanban-guard.log` show which keys each
  `kanban_create` carried.
  - The implementation card's `max_runtime_seconds` must be **14400**. If
    it came out at the guard's default, raise it with the models-by-url
    passdown §5.3 recipe **before the brief-review gate releases it**.
- **Read the kickoff body back after creating the card.** If it's cut, post
  the rest as PART comments before the orchestrator runs (4b-1 passdown §3).
  It is longer than 4c's: it carries the canonical requirements too.
- **On the review gate's APPROVE, build the WHOLE release chain in one go:**
  - Publish, DEV deploy, DEV finalizer and the acceptance gate. Use the same
    four cards and bodies as scripting-4c round 2's (`t_76eac566`,
    `t_ee935235`, `t_16457b9b`, `t_0991f272`), with this slug and the new SHA,
    **each created with its parent**. This branch is new, so the publish is
    a **first push**, not a fast-forward.
  - Link the finalizer to this round's sentinel, and **only then** complete
    the review gate.
  - Report every id.
  - If the finalizer blocks because the release merge's `RELEASE_SHA`
    differs from the reviewed SHA by `devtasks/` only, your byte-for-byte
    check of the served files is the evidence to accept it (4c passdown
    §4.7).
- **A protocol, server and client round, with no dependency change:** DEV
  restarts at the deploy, and the deploy runs an install. **No
  `package.json`, `pnpm-lock.yaml` or import map should change.** Any change
  to them is a finding.
- **The DEV deploy runs eight test suites,** `behaviors` among them. With
  this round the `behaviors` suite also runs the checked-in Khronos subset
  (it used to be skipped).
- **Nothing is pushed to `main` between the DEV deploy's release merge and
  the MAIN push** (scripting-4a passdown §4.4).

**Before DEV acceptance (outside the pipeline):**
- **Claude runs the pre-brief's §6.1 browser checks** (eleven) on the
  published SHA. They include **two measured gates**: the frame-time stress
  check (5) and the 1 MiB world (10), whose numbers must meet Q7's
  thresholds (§5). They also include **the rollback rehearsal** (11) on a
  copy of PROD's database. These are Claude's work, not cards.
- **The acceptance card carries Q7's thresholds:** a visitor's join to
  `world:loaded` at most 1.5 s over the same world without behaviours; the
  server's serialize and heal of that world at most 250 ms together; a
  visitor tab's heap at most 50 MB larger. Three visitors, five runs, the
  median (§5).
- **The outside review of the whole round,** base to tip, after GLM's
  review, with the compare URL. The pre-brief's §8 requires it: the round
  runs world-supplied graphs far beyond the templates.
- **DEV acceptance needs a hard reload in every tab** (the pre-brief's §7).
  An unreloaded owner tab is a 4c page and is never the host (G-L9).

---

### KICKOFF — Phase 3 step 4d-1, graphs beyond the templates. Slug: `scripting-4d-1`

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
  kickoff's own instructions into any card** (4c passdown §4.5). The spec
  reference, the hash check, the requirements section and the canonical
  requirements are copied whole.
- **Bodies go in each card's body field when you create it,** never only in
  a comment. Read each card back; if its body is empty, post the body as its
  first comment while it's `todo`, and never create a second card in its
  place.
- **Create every card with its parent** (`parents=[…]` in the
  `kanban_create` call). A card created without one is created `blocked` by
  the guard, and its operating notes say so. If that happens, link its
  parent with `kanban_link`: that releases it. Never create a second card in
  its place.

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
git -C /workspace/atrium show 4f19b2533308ef0dc0fa3c3d8a5b4164eb389e82:devtasks/PREBRIEF-scripting-4d.md > /tmp/prebrief.md
sha256sum /tmp/prebrief.md   # must be 457e2ff0d018580e117bc0e3aac3ae6d4d4e90aa36a9c6dbf1106cdc10279458
```

On a mismatch, the card blocks with `kind="capability"`, quotes both hashes,
and does not work from a different text.

- **The spec:** `devtasks/PREBRIEF-scripting-4d.md`, **FINAL Revision 1.4
  (2026-10-30)**: §0 the three reviews' changes and P26; §1 what 4d-1
  delivers; §2 facts P1–P26 and probes; §3 **decisions G-L1–G-L12**
  (approved as recommended); §4 **the contract, G1–G10**; §5 the questions,
  settled, with **Q3's confirmation and Q7's thresholds**; §6 tests, proofs
  (a)–(h) with every sub-proof, and §6.1 Claude's browser checks; §7 DEV
  acceptance; §8 worker rules and **the step list**; §9 notes.
- **The worker-card requirements** are the last section of this body,
  headed `WORKER-CARD REQUIREMENTS (canonical)`. Card bodies copy them or
  refer to this card's body; they never point at a host path.

#### Settlement (operator) — do not reopen
- **Base:** `base_main_sha = 4f19b2533308ef0dc0fa3c3d8a5b4164eb389e82`.
  - Workflow branch: **`workflow/scripting-4d-1`**, created from that SHA.
  - Worktree: `/workspace/wt/scripting-4d-1`, made with
    `git -C /workspace/atrium worktree add -b workflow/scripting-4d-1 /workspace/wt/scripting-4d-1 4f19b2533308ef0dc0fa3c3d8a5b4164eb389e82`.
- **Decisions (operator, 2026-10-30 20:57 PT), all as recommended:** G-L1 (a)
  4d-1, seven steps, animation-pointer models out (4d-2); G-L2 (a) the core
  op set as bare core declarations; G-L3 (a) unsupported ops stored, inert,
  reported, gated by `(op, extension)` identity; G-L4 (a) node transforms
  and visibility, read-only matrices, light intensity and colour, no
  materials; G-L5 (a) sampled motion, a stated deviation; G-L6 (a) the
  overlay by revision; G-L7 (a) G7's limits; G-L8 (a) one graph onto the
  selected object, mapped by hand; G-L9 (a) `scriptRunner: 3`; G-L10 (a) no
  per-behaviour distance; G-L11 (a) the operator's fixtures; G-L12 (a) N1
  only; Q3 the confirmation as §5 and G6 say; Q7 1 MiB with §5's thresholds.
- **Scope:** G1–G10 as written in the spec's §4, with every revision's
  addition (§0.1–§0.4), and §6's tests and proofs. **Not in scope:** G9's
  list, §10, `KHR_animation_pointer` models, material pointers, and every
  open follow-up in the scripting-4c passdown.
- **Where the pieces go** (settled here, so the brief doesn't invent a new
  path):
  - `EXECUTABLE`, the rule's widening, the value-read rule and the
    by-identity `listensForSelect` / `selectTargetFor` go in
    `packages/behaviors/src/behavior-spec.js`, with the server's copies in
    `packages/server/src/send-policy.js`, as today.
  - **The write check's value rules** (G4): a renderer-neutral copy in
    `packages/behaviors/src/value-rules.js` (new), imported by the runner
    with a relative path (no new package subpath, so no `package.json` or
    import-map change), pinned to the server's `send-policy.js` rules by
    `tests/fixtures/value-vectors.json` (new), which both read.
  - `graphReport` goes in `packages/behaviors/src/adapter.js` and is
    exported from the package's index.
  - `worldMatrix` goes in a new `packages/som/src/world-matrix.js`, exported
    from `packages/som/src/index.js` beside `worldPosition`. **The runner
    takes it (and a local `matrix`) as injected functions, as it takes
    `position` today** (`createBehaviorRunner({ …, position })`); `app.js`
    passes them. `packages/behaviors` gains no dependency.
  - `behaviorBytesIn` goes in `packages/server/src/send-policy.js` beside
    `behaviorCountIn`.
  - The importer: `apps/client/src/graph-import.js` (new, pure) and its
    panel in **one new module**, `apps/client/src/graph-import-panel.js`.
  - The rollback scripts: `packages/server/scripts/behaviors-export.mjs` and
    `behaviors-reconcile.mjs` (new).
- **Files:**
  - `packages/behaviors`: `src/behavior-spec.js`, `src/adapter.js`,
    `src/runner.js`, `src/value-rules.js` (new), `src/index.js`,
    `scripts/conformance.mjs`, `scripts/gen-vectors.mjs`; tests;
  - `packages/server`: `src/send-policy.js`, `src/session.js`, `src/world.js`,
    `scripts/behaviors-export.mjs`, `scripts/behaviors-reconcile.mjs` (new);
    tests;
  - `packages/som`: `src/world-matrix.js` (new), `src/index.js`; tests;
  - `packages/protocol`: `src/schemas/hello.client.json` (`scriptRunner`'s
    enum gains 3); tests;
  - `packages/client`: `src/AtriumClient.js` (`scriptRunner: 3`, `som:set`'s
    `origin` and `requestSeq`, `canSend()`); tests;
  - `apps/client`: `src/app.js`, `src/behavior-form.js`,
    `src/graph-import.js` and `src/graph-import-panel.js` (new),
    `index.html` (the import panel's markup and style only; the import map
    doesn't change); tests under `apps/client/tests/`;
  - `tests/fixtures/behavior-vectors.json` (regenerated by
    `gen-vectors.mjs`), `tests/fixtures/value-vectors.json` (new);
  - `tests/fixtures/protocol-compat/hello.client.14ab0076.json` (new) and
    that folder's README;
  - `tests/fixtures/behavior-conformance-khronos/expected-4d.json` (new: the
    round's regenerated results, G8) and `tests/fixtures/behavior-conformance.json`
    (4b-2's empty list, which may be retired with a note).

  **Read-only:** `tests/fixtures/behavior-conformance-4d/` and everything
  already in `tests/fixtures/behavior-conformance-khronos/` (G-L11: a
  fixture the code can't pass is a finding, never an edit). **No other
  file.** Nothing under `packages/gltf-interactivity-engine/` or
  `packages/gl-matrix/` changes. If the brief or the implementation finds
  that another file must change, stop and ask.
- **A UI round with a protocol, server and client change, full pipeline,
  with a DEV restart.** Claude's browser checks (§6.1), with their measured
  gates, and the outside review of the whole round come before DEV
  acceptance.

#### Graph — build exactly this
1. **GLM brief** — assignee `atrium-glm`. Parent: this kickoff. Title:
   `GLM brief — scripting-4d-1`.
   - Its card carries:
     - (a) the spec reference and hash check above, with the commit and
       hash copied in;
     - (b) the Settlement above, whole;
     - (c) the requirements section below, whole;
     - (d) the canonical worker-card requirements, whole.
   - The brief it writes is the **self-contained contract** for the
     implementation:
     - G1–G10 written out, with **G1's identity rule and value-read rule,
       G3's identity gate, registration (P26), clock, delays and wrapper
       timing, G4's write check, total send, frame limit and overlay
       invariant**, and G10's three outcomes;
     - **every text exactly as the spec writes it, character for
       character:** G1's `behavior-op` message ("a node reads a value from
       an operation Atrium doesn't run"); G2's refusal ("this world's
       behaviours would exceed 1 MiB") and its two timing lines; G4's
       "Throttled: this world's behaviours are using all their time" and
       "Partially supported"; G6's three notes and the Enable
       confirmation;
     - every §6 test and proof, with every sub-proof;
     - the step list below.

     It may refer to sections of the spec, but must not leave a rule only in
     the spec.
2. **Operator brief-review gate** — assignee `atrium-orchestrator`.
   - Title exactly `OPERATOR BLOCK: awaiting human brief review — scripting-4d-1`.
   - Created with `initial_status="blocked"`. Parent = the GLM brief.
   - Body exactly: `OPERATOR BLOCK: human brief-review gate. Only the operator completes this. An agent dispatched here must kanban_block(kind="needs_input") on this card and do nothing else.`
   - Read it back and confirm `status == "blocked"` with no runs.
3. **DeepSeek implementation** — assignee `atrium-deepseek`. Title:
   `Implement — scripting-4d-1`.
   - **Its parent MUST be the gate** (step 2), not the brief.
   - Create it with **`--max-runtime 4h`** (14400 s), passed explicitly.
   - Its body carries:
     - the spec reference and hash check;
     - the instruction to **read the GLM brief's card, comments included**,
       as the contract;
     - the worktree command above, with `-b`;
     - the requirements below;
     - the canonical worker-card requirements.
4. **One GLM review** — assignee `atrium-glm`. Title:
   `GLM review — scripting-4d-1`. Parent: the implementation.
   - A **single** review.
   - Its body opens with the exact line `THIS RUN HAS TERMINAL, FILE AND GIT TOOLS. Use them for every step below.`
   - Then the spec reference, the requirements below and the canonical
     worker-card requirements.
5. **Review gate** — assignee `atrium-orchestrator`. Title:
   `Review gate — scripting-4d-1`. Parent: the review. It **creates
   nothing**.
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
These are the same four cards as scripting-4c round 2's, with this slug and
the new SHA.
- Every body carries the full 40-character reviewed SHA.
- The DEV deploy runs the host's automatic release merge, so DEV, MAIN and
  PROD may run a `RELEASE_SHA` that differs from the reviewed SHA.
- **The publish, DEV deploy and finalizer cards make one call each.** On any
  refusal, non-zero exit or unexpected message, they do not retry: they block
  with `kind="capability"` and the complete output verbatim.

#### Requirements for the implementation AND review cards (beyond the spec)
1. **Ordered steps, one commit per step, every commit runnable** (spec §8):
   1. **The rule (G1):** both copies, `EXECUTABLE`, the value-read rule, the
      `onSelect` exception, the by-identity predicates, the string rules and
      sizes, the vectors and `gen-vectors.mjs`, `scriptRunner`'s `enum: [1,
      2, 3]`.
   2. **The adapter (G3):** the identity gate (the renamed load copy) and
      the registry kept by allowlist; **pointer registration once per
      family, the index read from the path (P26)**; the clock; the delay
      subclasses with monotonic ids and the cap; the interpolation wrapper
      on the bus; `graphReport`; `worldMatrix` in `@atrium/som`.
   3. **The runner and the client's event (G4, G5's `som:set`):** the write
      check through `value-rules.js` and its vectors; the total send
      opportunity; the frame limit; the overlay by revision, written inside
      `enqueue`; the status lines; `som:set`'s `origin` and `requestSeq`.
   4. **Server and client (G2, the rest of G5, G10):** `behaviorBytesIn` on
      every path; the two timing lines; election on `3` in both places;
      `AtriumClient`'s `3` and `canSend()`; the frozen `14ab0076` hello; N1;
      the export and reconcile scripts.
   5. **The importer (G6):** `graph-import.js`, its panel, the notes and
      the confirmation, the wiring guards.
   6. **Conformance (G8):** `conformance.mjs` on the checked-in subset and
      the operator's fixtures; `expected-4d.json` regenerated, **against the
      baseline in the manifest** (134 pass, 8 fail, `math/random`
      disposed): every change explained.
   7. **Full suites (server files each on its own), proofs (a)–(h)** with
      every sub-proof (a2, a3, b2, b3, c0, c, c2, c3, c4, d–d5, e, e2, f–f3,
      g, h, h2), and the handoff.

   **Each step's report lists the suites run** and names any test deferred
   to a later step. **If a run stops partway:** block with
   `kind="needs_input"` once; use a different kind for a second consecutive
   stop.
2. **The rules most likely to be missed:**
   - **The gate is by `(op, extension)`, not by name** (P19). An allowlisted
     op name with any other extension is renamed in the loaded copy and is
     inert; `event/onSelect` is the one exception (refused unless exact).
     The stored graph is never edited. The `r1` probe
     (`devtasks/spike-4d/r1-extension-collision.mjs`) becomes a test
     through the real loader.
   - **Register each pointer family once and read the index from the path**
     (P26). The engine's trie keeps one index node per level: a closure per
     index reaches only the last. The three-entry `nodeMap` test (fixture
     21) is the proof.
   - **The overlay's invariant:** every entry has a queued entry or an
     unanswered seq behind it. The entry is written inside `enqueue`, right
     after `queue.set`; the drag drop returns `false`; a send that didn't
     happen (`canSend()` false, a throw, a non-number) clears it; every path
     that empties the queue empties the overlay in the same call.
   - **The write check is the server's value rules,** shared by vectors: a
     unit quaternion within 1e-3, scale components at least 1e-6. Nothing is
     normalised.
   - **The ops observe the injected clock;** the engine's own
     `performance.now()` call stays (M3). No allowlisted op calls the global
     `setTimeout`.
   - **Delay ids never repeat;** a stale id cancels nothing (fixture 06);
     the 17th pending delay takes `err` (fixture 07).
   - **A sync throw in an interpolation action is rethrown** (same-tick
     disposal); **a rejection disposes at the start of the next tick**, once.
   - **A running node may not read a value from an unsupported node** (P9):
     the rule refuses it, and the importer says so.
   - **`scriptRunner: 3` in both places that decide the host** (P16); a
     cross-origin hello still has no `scriptRunner` key at all.
   - **Every string from a graph or a file reaches the DOM as text** (G6),
     the log view included; a wiring guard checks there's no `innerHTML`
     with graph data.
   - **The rollback scripts run offline, take an exclusive lock, dry-run by
     default, and have three outcomes** (G10's table); the second run writes
     nothing.
   - **The operator's fixtures are read-only.** Run them through the real
     adapter under their README's harness rules; a fixture the code can't
     pass is a finding.
   - **A test of a seam uses the real collaborator or the exact value
     production passes** (signin-sync §4.1): the real engine and loader for
     G3, the real adapter and the real `AtriumClient`'s events for G4, the
     real adapter for G6's conversion.
   - **No `package.json`, import-map or lockfile change.** `value-rules.js`
     is imported relatively; `worldMatrix` comes from `@atrium/som`, which
     `apps/client` already depends on.
   - **Logs:** no ids beyond `logId`, no user names, no cookies; graph
     strings cut as the runner's log cuts them.
   - **App tests use the strict DOM fake;** `dataset` is never assigned.
3. **The handoff includes:**
   - every proof, (a)–(h) with every sub-proof, **quoting the output of both
     runs** (failing and green), with its failing test names, and whether
     each file exited on its own (4c passdown §4.4);
   - what canonical requirement §2 asks: the per-file counts with their
     commands and exit codes, and the Node version;
   - **the fixtures' results** (all 21) and **the Khronos subset's results
     against the manifest's baseline,** every change named with its reason;
   - `packages/behaviors`, `packages/som` and `packages/client` results as
     well as the packages the requirement names.

   **Commit before running proofs. Restore each broken file from a saved
   copy, never with `git checkout`.** **Run the proofs one at a time:** the
   agents' container is capped at 2,600 MiB.
4. **"Not reproducible" is not an acceptable proof result.** Either the
   break is wrong (fix it) or the test is weak (strengthen it).
   - **The reviewer reproduces every proof itself,** and also:
     - **runs the operator's 21 fixtures and the Khronos subset itself,**
       and compares with the handoff;
     - **writes its own P26 check:** a graph that writes `/nodes/0` and
       `/nodes/2` of a three-entry `nodeMap`, through literal, `[x]` and
       `{x}` pointers;
     - **runs `r1`'s graph** through the round's adapter: the extension
       `flow/sequence` must not run;
     - **reads the overlay code against the invariant** (every create, every
       clear) and the send opportunity against `canSend()`;
     - **greps** every place the host role is decided (two, both `=== 3`),
       every `scriptRunner` in `apps/client/src`, and every `innerHTML` in
       the new modules;
     - **runs the reconcile on a scratch database** with an `unchanged`, a
       `restore` and a `conflict` world, twice.
   - A missing test is a finding, never a pass.
5. **Test runs:**
   - server test files run one at a time, each under `timeout 180`;
   - `packages/client` runs **without `--test-force-exit`**;
   - every other package runs `node --test` on its own test directory;
   - read proof results from the `not ok` and `cancelled` lines, not from
     the fail count.
6. **The test environment:** tests run in the DEV deploy as `atrium-build`
   with no network. New tests listen on port 0. The Khronos subset is in the
   repo; nothing fetches the assets.
7. **What the deploy refuses:** no symlinks and no `node_modules` path
   component anywhere in the tree. Uploads during the round go under
   `devtasks/` only.

#### Before DEV acceptance (operator and Claude)
- Claude runs the spec's §6.1 browser checks against the published SHA,
  with the two measured gates against Q7's thresholds, and the rollback
  rehearsal.
- The outside review of the whole round, base to tip.
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
  14400 s;
- the review card's opening line;
- the review gate creates nothing and blocks on APPROVE;
- the review gate is linked to the sentinel `<SENTINEL_ID>`.

Then complete this kickoff. Do not start any of the work.

#### WORKER-CARD REQUIREMENTS (canonical)
<CANONICAL_REQUIREMENTS>

---
