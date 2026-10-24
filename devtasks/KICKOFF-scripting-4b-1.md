# Kickoff — Phase 3 step 4b-1: object identity and the script host (`scripting-4b-1`)

How to use this file:
- The **front-door note** is for the front door and the operator.
- Everything between the two rules is the **kickoff body**. Post it
  verbatim on the kickoff card.
- Then post the canonical worker-card requirements as a separate comment
  headed `WORKER-CARD REQUIREMENTS (canonical)`, the spec's commit and hash,
  and the sentinel's id.

**Front-door note (check before creating the card):**
- **Base:** `base_main_sha = da28c0cb6ad0da4764ed418c0d787abe33400009` (the
  commit that carries the FINAL pre-brief).
  - Its code is identical to the scripting-4a release `147df814` (DEV, MAIN
    and PROD); only `devtasks/` differs.
  - Confirm it with a host fetch of `origin/main`. Any later commit on
    `main` (this file's) must touch only `devtasks/`.
- **The base must carry `devtasks/PREBRIEF-scripting-4b.md`,** FINAL Rev
  2.1, 66,498 bytes, sha256
  `8d057ebc0f5f910428f865b24eb30b5660da8c4c8ce6c44c1c7339f1abd7427d`.
  **Check the hash yourself and post the commit and hash on the kickoff
  card.** The kickoff has only `kanban_*` tools and can't check it.
- **The spec goes by git reference** (66 KB, over the 40 KB limit). Post no
  PART comments.
- **No open sentinel,** and `workflow/scripting-4b-1` doesn't exist yet. Do
  a push dry run first.
- **After every create, read the card back.** If a body or field is missing,
  fix it on **that** card while it's `todo`, or post the missing text as its
  first comment. **Never create a second card in its place.** Check the
  implementation card's `max_runtime_seconds` is 10800.
- **On the review gate's APPROVE, build the WHOLE release chain in one go**
  (scripting-4a passdown §4.5; edit-polish-3 passdown §5.2):
  - Publish, DEV deploy, DEV finalizer and the acceptance gate, the same
    four cards and bodies as scripting-4a's (`t_dfded901`, `t_33450b2f`,
    `t_f9d42d20`, `t_9e16eb50`) with the new SHA;
  - link the finalizer to the sentinel;
  - **only then** complete the review gate;
  - report every id.
- **Server and protocol round:** DEV restarts at the deploy. Nothing on the
  host changes otherwise.
- **Nothing is pushed to `main` between the DEV deploy's release merge and
  the MAIN push** (scripting-4a passdown §4.4). `main` refuses force-pushes.

---

### KICKOFF — Phase 3 step 4b-1: object identity and the script host. Slug: `scripting-4b-1`

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
git -C /workspace/atrium show da28c0cb6ad0da4764ed418c0d787abe33400009:devtasks/PREBRIEF-scripting-4b.md > /tmp/prebrief.md
sha256sum /tmp/prebrief.md   # must be 8d057ebc0f5f910428f865b24eb30b5660da8c4c8ce6c44c1c7339f1abd7427d
```

On a mismatch, the card blocks with `kind="capability"`, quotes both hashes,
and does not work from a different text.

- **The spec:** `devtasks/PREBRIEF-scripting-4b.md`, **FINAL Revision 2.1
  (2026-10-24)**.
  - §1–§3: the plan for 4b (two rounds), the D2 engine spike, and the
    decisions.
  - §4: **4b-1's contract, E1–E9.**
  - §5: the tests and proofs.
  - §5.1: Claude's browser checks.
  - §7: the worker rules.
  - §9 sketches 4b-2. **It is not in scope.**
  - §10: review history. Read it, but it adds nothing to the contract.
- **The worker-card requirements** are a separate comment on this card,
  headed `WORKER-CARD REQUIREMENTS (canonical)`. Card bodies refer to that
  comment by its id; they never point at a host path.

#### Settlement (operator) — do not reopen
- **Base:** `base_main_sha = da28c0cb6ad0da4764ed418c0d787abe33400009`.
  - Workflow branch: **`workflow/scripting-4b-1`**, created from that SHA.
  - Worktree: `/workspace/wt/scripting-4b-1`, made with
    `git -C /workspace/atrium worktree add -b workflow/scripting-4b-1 /workspace/wt/scripting-4b-1 da28c0cb6ad0da4764ed418c0d787abe33400009`.
- **Scope:** implement **§4, E1–E9, for 4b-1 only,** per the approved
  decisions B1–B6 and E-L1–E-L6, as the spec's status line records them:
  - stable `objectId`s: the id rule (E1), the SOM's two scans and the one
    set-once path (E2), the server's rules and load healing (E3), and ids
    on the client's add paths (E7);
  - the script-host role: identity-safe cleanup and the handover (E4), the
    schemas (E5), the client's role state with its synchronous loss signal
    and the id leaf's own echo (E6), and the Edit panel's host line (E8).

  **Nothing from 4b-2 is in scope:** no behaviours, no runner, no
  `extras.atrium.behavior`, no engine, no templates, no runner capability.
- **The spec's line numbers are at `aa0702c8`.** Its code is identical to
  this base, so they hold. The brief cites them as they are.
- **Files:**
  - **`packages/som`:** `SOMDocument.js` (the external-node `WeakSet` and
    `isExternalNode`, `objectIdInUse`, `resolveObjectId`, the second
    `CREATABLE_PATHS` entry and the one-path intermediate creation), and
    tests.
  - **`packages/server`:**
    - `send-policy.js`: the id rule, `checkAtriumExtras`, the set-once leaf
      in `authorizeNodeSend`, and an `objectIdInUse` callback for
      `authorizeSend`;
    - `session.js`: the `add` uniqueness check, identity-safe
      `cleanupSession`, and the script host;
    - `world.js`: the document-level id healing for both world kinds;
    - tests: on port 0, except E4's identity-cleanup test, which uses a fake
      `wss` and fake sockets (§5).
  - **`packages/protocol`:** `hello.server.json` (`scriptHost`, `hostGen`),
    new `script-host.server.json`, its `validators` entry and
    `messageTypes`, and tests.
  - **`packages/client`:**
    - new `src/object-id.js` (`objectIdProblem`, `newObjectId`) and its
      `package.json` export `./object-id`;
    - `AtriumClient.js`: `scriptHost`, `_onScriptHost`, the synchronous
      loss signal, `setObjectId` and its own-echo case;
    - tests.
  - **`tests/fixtures/object-id-vectors.json`** (new), read by the server
    and client tests.
  - **`apps/client`:**
    - new `src/object-identity.js` (`withNewObjectId`);
    - `edit-duplicate.js` (`prepareDuplicate`, `atriumProblem`);
    - `app.js`: the add paths, `refreshHostStatus`, and the
      `hostStatusText` helper's wiring;
    - `index.html`: `#ep-host-status`, and the import-map entry
      `@atrium/client/object-id`;
    - a pure `hostStatusText` helper module;
    - tests.
  - **`tools/som-inspector/index.html`:** the same import-map entry, only
    if anything it loads imports `object-id`.
- **This round changes the protocol** (E5: `hello`, and the new
  `script-host` message). No other schema changes. If the brief or the
  implementation finds another is needed, stop and ask.
- **Full pipeline round, with a DEV restart.** The operator's outside code
  review of the published SHA (base to tip, the whole round), and Claude's
  browser checks (§5.1), come **before DEV acceptance**.

#### Graph — build exactly this
1. **GLM brief** — assignee `atrium-glm`. Parent: this kickoff. Title:
   `GLM brief — scripting-4b-1`.
   - Its card carries:
     - (a) this kickoff body;
     - (b) the spec reference and hash check above, with the front door's
       commit and hash copied in;
     - (c) a reference to the worker-card requirements comment.
   - The brief it writes is the **self-contained contract** for the
     implementation:
     - every E1–E9 rule, written out;
     - the full §5 test table;
     - every proof with its sub-proofs;
     - the §5.1 checks;
     - the §7 step list.
   - It may refer to sections of the spec, but must not leave a rule only in
     the spec.
2. **Operator brief-review gate** — assignee `atrium-orchestrator`.
   - Title exactly `OPERATOR BLOCK: awaiting human brief review — scripting-4b-1`.
   - Created with `initial_status="blocked"`. Parent = the GLM brief.
   - Body exactly: `OPERATOR BLOCK: human brief-review gate. Only the operator completes this. An agent dispatched here must kanban_block(kind="needs_input") on this card and do nothing else.`
   - Read it back and confirm `status == "blocked"` with no runs.
3. **DeepSeek implementation** — assignee `atrium-deepseek`. Title:
   `Implement — scripting-4b-1`.
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
   `GLM review — scripting-4b-1`. Parent: the implementation.
   - A **single** review.
   - Its body opens with the exact line `THIS RUN HAS TERMINAL, FILE AND GIT TOOLS. Use them for every step below.`
   - Then the spec reference and the requirements below.
5. **Review gate** — assignee `atrium-orchestrator`. Title:
   `Review gate — scripting-4b-1`. Parent: the review. It **creates nothing**.
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
These are the same four cards as scripting-4a's, with `scripting-4a`
replaced by `scripting-4b-1` and the new SHA.
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
   1. E1 and the vectors file, E2 (the SOM) and E3 (the server's id rules
      and load healing);
   2. E4 and E5: identity-safe cleanup, the script host and the schemas;
   3. E6: the client's role state, its synchronous loss signal, and
      `setObjectId` with its own echo;
   4. E7 and E8: the add paths, Duplicate and the panel line;
   5. full suites, proofs and the handoff.

   **If a run stops partway:** block with `kind="needs_input"` once. Use a
   different kind for a second consecutive stop.
2. **The rules most likely to be missed:**
   - **The one-path intermediate creation** (E2): for exactly
     `extras.atrium.objectId`, `setPath` creates a missing `extras.atrium`
     **before `resolvePath` runs**, keeping every other `extras` key.
     - `atrium: null` and a non-plain `atrium` are refused.
     - Every other path keeps today's rules, `extras.atrium.animation`
       included. Generic path creation is not widened.
   - **Two scans** (E2):
     - `objectIdInUse` counts every saved node, shadowed duplicate-name
       nodes included;
     - `resolveObjectId` returns a node only when exactly one saved node has
       the id **and** both `getNodeByName(name)` and `getObjectByName(name)`
       are that node;
     - **external nodes are excluded by identity** (a `WeakSet` filled in
       `copyNode`), never by name.
   - **Uniqueness is checked by the `add` handler** after `checkNewName` and
     before `addNode`. The refusal message is **"objectId is already taken
     in this world"**, never "already in use", which the palette retries
     (E3).
   - **Load healing is document-level, before the SOM:**
     - an id held by two or more nodes is dropped from **all** of them;
     - a malformed id is dropped;
     - one log line per id, with a count, and no raw names.
   - **`cleanupSession` first checks `sessions.get(s.id) === s`** and does
     nothing otherwise. The handover is keyed on that check, never on
     `presence.remove`'s return. It skips candidates the keepalive sweep is
     about to terminate (E4).
   - **The schemas:**
     - `scriptHost` is required in `hello`;
     - `true` requires `hostGen` and `false` forbids it;
     - `hostGen` is 1 to 2^53 − 1;
     - `script-host` is registered as a `validators` entry.
     - **Proof (e2) is essential:** the validator runs with `strict: false`
       (E5).
   - **Losing the role is signalled synchronously:** `script-host:changed`
     `{ active: false }`, with `canEdit` reset first, **before**
     `connecting`, before a `disconnect()` closes the socket, on a connect
     timeout and on the socket's close. Generations only increase per
     connection record (E6).
   - **The sender's own echo of `extras.atrium.objectId` applies the
     broadcast's value**, as 4a's Z2a does (E6).
   - **Ids on add** (E7):
     - new ids for the palette, Model form, teleporter form, library and
       Duplicate (`prepareDuplicate` replaces the copied id);
     - the palette retry and Undo/redo re-adds keep theirs.
   - **Import maps:** `@atrium/client/object-id` needs an entry in
     `apps/client/index.html` and a `package.json` export. `importmap-guard`
     must stay green.
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
   - Tests run in the DEV deploy as `atrium-build` with no network.
   - New server tests listen on port 0, **except E4's identity-cleanup
     test,** which drives `attachSessionHandlers` with a fake `wss` and fake
     sockets (§5 E4).
   - `apps/client` tests can't import three.js or touch the DOM.
7. **Uploads during the round go under `devtasks/` only.** Anything else is
   refused at the DEV deploy.

#### Before DEV acceptance (operator and Claude)
- The operator runs an outside code review of the **published SHA**, over
  the whole round (base to tip).
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
