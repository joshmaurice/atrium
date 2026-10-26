# Kickoff — Phase 3 step 4b-2: behaviours, owner-present (`scripting-4b-2`)

How to use this file:
- The **front-door note** is for the front door and the operator.
- Everything between the two rules is the **kickoff body**. Post it
  verbatim on the kickoff card.
- Then post the canonical worker-card requirements as a separate comment
  headed `WORKER-CARD REQUIREMENTS (canonical)`, the spec's commit and hash,
  and the sentinel's id.

**Front-door note (check before creating the card):**
- **Base:** `base_main_sha = 951b541bef818499a16692ac968f1800fdb75434` (the
  commit that carries the FINAL pre-brief).
  - Its code is identical to the scripting-4b-1 release `8358b043` (DEV,
    MAIN and PROD); only `devtasks/` differs.
  - Confirm it with a host fetch of `origin/main`. Any later commit on
    `main` (this file's) must touch only `devtasks/`.
- **The base must carry `devtasks/PREBRIEF-scripting-4b-2.md`,** FINAL Rev
  2.1, 95,425 bytes, sha256
  `a7841421312f5ae59b74d8623067986557b4a241f048c30adbb556bc44190a73`.
  **Check the hash yourself and post the commit and hash on the kickoff
  card.** The kickoff has only `kanban_*` tools and can't check it.
- **The spec goes by git reference** (95 KB, over the 40 KB limit).
- **The kickoff body itself:** 4b-1's body comment was truncated for the
  orchestrator and needed PART 2A–2C (4b-1 passdown §3). Read this one
  back after posting; if it's cut, post the rest as PART comments the same
  way, before the orchestrator runs.
- **No open sentinel,** and `workflow/scripting-4b-2` doesn't exist yet. Do
  a push dry run first.
- **After every create, read the card back.** If a body or field is missing,
  fix it on **that** card while it's `todo`, or post the missing text as its
  first comment. **Never create a second card in its place.** Check the
  implementation card's `max_runtime_seconds` is **14400**.
- **On the review gate's APPROVE, build the WHOLE release chain in one go**
  (scripting-4a passdown §4.5; edit-polish-3 passdown §5.2):
  - Publish, DEV deploy, DEV finalizer and the acceptance gate, the same
    four cards and bodies as scripting-4b-1's (`t_fabd0628`, `t_b9ff5fa4`,
    `t_3bc01136`, `t_4a82cdf0`) with the new SHA;
  - link the finalizer to the sentinel;
  - **only then** complete the review gate;
  - report every id.
  - If `kanban_complete` drops `task_id` again (4b-1 passdown §4.2), stop
    and tell the operator; don't retry blind.
- **Server and protocol round:** DEV restarts at the deploy.
- **Nothing is pushed to `main` between the DEV deploy's release merge and
  the MAIN push** (scripting-4a passdown §4.4). `main` refuses force-pushes.

**Operator pre-checks on the host (this round is the first since
deploy-least-privilege to add workspace packages):**
1. **The deploy installs** when `package.json`, `pnpm-lock.yaml` or
   `pnpm-workspace.yaml` change (`atrium-deploy`), and this round changes
   all three (new `packages/behaviors`, `packages/vendor/*`). Confirm
   `atrium-build-run install` is `pnpm install --frozen-lockfile` with the
   build store, and that `ensure-node-modules` makes the `node_modules`
   directories of **new** workspace packages too, not a fixed list.
2. **`atrium-build-run list-tests`** listed "21 server files plus 6
   packages" at server-cleanup (its pre-brief §8). If the package part is a
   fixed list, `@atrium/behaviors` won't run at the deploy. Check now, and
   after the DEV deploy confirm it lists the round's server files plus
   **7** packages.
3. **`tree-check`** refuses symlinks and `node_modules` path components:
   the vendored packages are plain files, so they pass, but a worker that
   commits a symlink or a `node_modules` folder under `packages/vendor/`
   makes the DEV deploy refuse. The kickoff says so to the workers (R7).

If any of the three needs a host change, that's a small host round before
this kickoff, not a change inside it.

---

### KICKOFF — Phase 3 step 4b-2: behaviours, owner-present. Slug: `scripting-4b-2`

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
git -C /workspace/atrium show 951b541bef818499a16692ac968f1800fdb75434:devtasks/PREBRIEF-scripting-4b-2.md > /tmp/prebrief.md
sha256sum /tmp/prebrief.md   # must be a7841421312f5ae59b74d8623067986557b4a241f048c30adbb556bc44190a73
```

On a mismatch, the card blocks with `kind="capability"`, quotes both hashes,
and does not work from a different text.

- **The spec:** `devtasks/PREBRIEF-scripting-4b-2.md`, **FINAL Revision 2.1
  (2026-10-24)**.
  - §1–§2: what the round delivers; the code, the spike, its rerun, and
    the review probes (§2.3: **the validator is not the loader**).
  - §3: the approved decisions F-L1–F-L12.
  - §4: **the contract, F1–F12.**
  - §5: the tests and proofs. §5.1: Claude's browser checks.
  - §7: the worker rules. §8: notes for the brief author.
  - §9 sketches 4c and 4d. **It is not in scope.**
  - §10: two outside reviews and how each finding was applied. Read it;
    it explains several rules that look arbitrary without it.
- **Its evidence is in git too:** `devtasks/spike-4b/` (`t0`–`t6`, `r1`,
  `r2`, `README.md`) and `devtasks/REVIEW-scripting-4b-2-rev0.1.md`.
- **The worker-card requirements** are a separate comment on this card,
  headed `WORKER-CARD REQUIREMENTS (canonical)`. Card bodies refer to that
  comment by its id; they never point at a host path.

#### Settlement (operator) — do not reopen
- **Base:** `base_main_sha = 951b541bef818499a16692ac968f1800fdb75434`.
  - Workflow branch: **`workflow/scripting-4b-2`**, created from that SHA.
  - Worktree: `/workspace/wt/scripting-4b-2`, made with
    `git -C /workspace/atrium worktree add -b workflow/scripting-4b-2 /workspace/wt/scripting-4b-2 951b541bef818499a16692ac968f1800fdb75434`.
- **Scope:** implement **§4, F1–F12,** per the approved decisions
  F-L1–F-L12 as the spec's status line records them:
  - the vendored engine and `gl-matrix` (F3), the `behavior` leaf's rule in
    two copies (F1), its server, SOM, healing and election rules (F2);
  - the adapter (F4), `sendField` and the runner (F5), visibility in the
    renderer (F6), the five templates (F8), the Edit panel's Behaviour
    section (F9), Duplicate (F10), the conformance subset and probes as
    tests (F11);
  - F-L12's carried items: 4a's items 1, 2, 3 and 5, and resetting
    `_scriptHostRoleWarned` per connection.

  **Not in scope:** `activate` or any visitor trigger (4c);
  `flow/setDelay`, `event/onTick`, `event/onStart`, loops,
  `pointer/interpolate` or `variable/*` in an accepted graph (4d); graph
  import; server-side rate limits; 4a's item 4.
- **The spec's line numbers are at `a246f80c`.** Its code is identical to
  this base, so they hold. Engine line numbers are in the pinned
  `build/index.js` (sha256 in §2.3).
- **Files:**
  - **`packages/vendor/gltf-interactivity-engine/`** and
    **`packages/vendor/gl-matrix/`** (new): the upstream files unedited,
    each `LICENSE`, `package.json` under the upstream name and version;
    `packages/vendor/VENDORED.md` (versions, tarballs, every file's
    sha256); `NOTICE` at the repo root; `pnpm-workspace.yaml`'s glob;
    `pnpm-lock.yaml` regenerated and committed.
  - **`packages/behaviors/`** (new, renderer-neutral): `behavior-spec.js`
    (F1's client copy), the adapter (F4), the runner (F5), `templates.js`
    (F8), `scripts/conformance.mjs` (F11), tests.
  - **`packages/server`:** `package.json` (the engine as `workspace:*`);
    `send-policy.js` (F1's server copy, the fourth leaf, `checkAtriumExtras`,
    a `behaviorCount(excludeNode)` callback); `session.js` (the `add`
    cap and the election rule); `world.js` (behaviour healing, both world
    kinds, after `healDocumentObjectIds`); tests on port 0.
  - **`packages/som`:** `SOMDocument.js` (`CREATABLE_PATHS` gains the
    leaf); tests.
  - **`packages/protocol`:** `hello.client.json` (`capabilities.scriptRunner`,
    `const 1`, optional) and tests. **No other schema changes.**
  - **`packages/client`:** `AtriumClient.js` (`sendField` and its own-echo
    flag; `hello` sends `capabilities.scriptRunner: 1`; the NIT); tests.
  - **`packages/renderer-three`:** visibility on view objects; the hit
    filter in `PointerInputBridge` with `includeHidden`; tests.
  - **`tests/fixtures/behavior-vectors.json`** (new), read by the server
    and client copies.
  - **`apps/client`:** `behavior-form.js` (new); `edit-duplicate.js`;
    `app.js` (the runner's wiring and tick, the `!modes.edit` click
    branch, `setGesture`, the form, `refreshBehaviorRow`, the Visible
    checkbox, the host line's text, F-L12's items 1–3); `index.html`
    (the Behaviour section, `#ep-visible`, the import-map entries); tests.
  - **`tools/som-inspector`, `apps/playground`:** import-map entries only
    if `importmap-guard` needs them.
- **This round changes the protocol in one place** (`hello.client.json`).
  If the brief or the implementation finds another schema change is
  needed, stop and ask.
- **Full pipeline round, with a DEV restart.** The operator's outside code
  review of the published SHA (base to tip, the whole round), and Claude's
  browser checks (§5.1), come **before DEV acceptance**.

#### Graph — build exactly this
1. **GLM brief** — assignee `atrium-glm`. Parent: this kickoff. Title:
   `GLM brief — scripting-4b-2`.
   - Its card carries:
     - (a) this kickoff body;
     - (b) the spec reference and hash check above, with the front door's
       commit and hash copied in;
     - (c) a reference to the worker-card requirements comment.
   - The brief it writes is the **self-contained contract** for the
     implementation:
     - every F1–F12 rule, written out, F7's limits table included;
     - the five templates' graphs exactly as F8 gives them;
     - the full §5 test table;
     - every proof with its sub-proofs;
     - the §5.1 checks;
     - the §7 step list.
   - It may refer to sections of the spec, but must not leave a rule only in
     the spec.
2. **Operator brief-review gate** — assignee `atrium-orchestrator`.
   - Title exactly `OPERATOR BLOCK: awaiting human brief review — scripting-4b-2`.
   - Created with `initial_status="blocked"`. Parent = the GLM brief.
   - Body exactly: `OPERATOR BLOCK: human brief-review gate. Only the operator completes this. An agent dispatched here must kanban_block(kind="needs_input") on this card and do nothing else.`
   - Read it back and confirm `status == "blocked"` with no runs.
3. **DeepSeek implementation** — assignee `atrium-deepseek`. Title:
   `Implement — scripting-4b-2`.
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
   `GLM review — scripting-4b-2`. Parent: the implementation.
   - A **single** review.
   - Its body opens with the exact line `THIS RUN HAS TERMINAL, FILE AND GIT TOOLS. Use them for every step below.`
   - Then the spec reference and the requirements below.
5. **Review gate** — assignee `atrium-orchestrator`. Title:
   `Review gate — scripting-4b-2`. Parent: the review. It **creates nothing**.
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
These are the same four cards as scripting-4b-1's, with `scripting-4b-1`
replaced by `scripting-4b-2` and the new SHA.
- Every body carries the full 40-character reviewed SHA.
- The DEV deploy runs the host's automatic release merge, so DEV, MAIN and
  PROD may run a `RELEASE_SHA` that differs from the reviewed SHA.
- **The front door builds all four cards, links the DEV finalizer to the
  sentinel, and only then completes the review gate.**
- **The publish, DEV deploy and finalizer cards make one call each.** On
  any refusal, non-zero exit or unexpected message, they do not retry: they
  block with `kind="capability"` and the complete output verbatim.

#### Requirements for the implementation AND review cards (beyond the spec)
1. **Ordered steps, one commit per step, every commit runnable** (spec §7):
   1. F3: vendoring, `NOTICE`, `VENDORED.md`, the dependency entries, the
      Node and hash tests, the import-map entries;
   2. F1 (both copies and the vectors) and F2 (the SOM path, the server's
      leaf and `add` checks, healing, the election rule and the schema);
   3. F4: the adapter, its tests, the probes as tests, the conformance
      subset (F11);
   4. F5: `sendField`, the runner, its tests;
   5. F6: visibility in the renderer and the Visible checkbox;
   6. F8–F10: the templates, the form and panel, Duplicate;
   7. F-L12's items, full suites, proofs and the handoff.

   **Each step's report lists the suites run and names every test
   deferred to a later step.** **If a run stops partway:** block with
   `kind="needs_input"` once. Use a different kind for a second
   consecutive stop.
2. **The rules most likely to be missed:**
   - **The validator is the gate, not the loader** (§2.3, §8). F1 runs
     `validateInteractivityGraph` **after** its own rules. Every template
     test and every vector goes through the validator; a test that only
     calls `loadBehaveGraph` proves nothing about what the server accepts.
   - **Graph shape** (F1, F8):
     - pointer templates are **`[n]`** with an **int** literal `n`; any
       `{…}` is refused (`{n}` is a `ref` socket);
     - `variables` is **absent**; `events` is present only when non-empty;
       `types` is never empty;
     - `event/onSelect` is declared `{ op: 'event/onSelect', extension:
       'KHR_node_selectability' }`, configured `nodeIndex: 0`,
       `stopPropagation: false`;
     - the op allowlist is F-L4's exactly: **no `flow/setDelay`, no
       `event/onStart`, no `event/onTick`**. The interval template is
       `event/receive` of `atrium/interval`, dispatched by the adapter's
       own injected timer (F4);
     - `FORBIDDEN_KEYS` and depth ≤ 8 anywhere in the value, before
       anything else.
   - **The server** (F2): the leaf needs the node's own `objectId`; the
     64-behaviour cap counts **other** nodes, so the 64th can still be
     rewritten and toggled; `add` checks the leaf; healing drops a
     behaviour on a node with **no own id**; the election needs `canEdit`
     **and** `capabilities.scriptRunner === 1`, at `hello` and at handover.
     `validateInteractivityGraph` is imported at the top of
     `send-policy.js` by its bare name.
   - **The adapter** (F4): `loadBehaveGraph(graph, false)`;
     `processNodeStarted` set **on the engine**; **every disable is a
     `dispose()`**, never a parked engine; the `world` interface is total
     (failures are return values); animations use the **same authority
     predicate** as pointer writes (self, descendant, grant); the clip
     check only when the model is `loaded`; a refused write logs and
     continues, never throws.
   - **The runner** (F5): enabled only with the role, `canEdit` **and** a
     loaded world of the same connection; disposes every engine
     synchronously on `active: false`; **one coalesced send per 50 ms per
     world** (a rate, FIFO by first enqueue), keyed by `(objectId, kind,
     field)` with the producing behaviour's id and generation, the name
     resolved at the opportunity; avatars (`ephemeral`) are never scanned.
   - **`select` comes from `app.js`'s viewport click** with `pressDown` and
     `isSelectClick` and `e.target === canvas`, Edit mode off — **never
     from a SOM `click`** (M3 of the first review).
   - **`sendField` applies nothing locally;** its own echo applies the
     broadcast value, then `som:set`, then `edit:accepted`. The Edit
     panel's apply-first path is untouched.
   - **Visibility** (F6): the hit filter takes the **next** visible hit;
     Edit mode passes `includeHidden: true`; model instances inherit
     through their wrapper's parent — no second visibility path.
   - **The form** (F9): Save is one sequence bound to a snapshot and a
     generation, registered with the form gate; a selection change, Edit
     off, `connecting`, `disconnected` or the target's removal stops it.
     "Custom graph" unless `templateGraph(template.id, template.params)`
     regenerates the saved value.
   - **Duplicate** (F10) remaps self-references in `nodeMap`, `targets`,
     `animations[].object` **and `template.params.target`**.
3. **The handoff includes every proof and sub-proof** — (a), (a2), (b),
   (b2), (b3), (c), (d), (d2), (d3), (d4), (e), (e2), (e3), (e4), (f),
   (f2), (f3), (g), (g2), (h), (h2), (i), (i2), (j), (k) — each with its
   failing test names, **and** what canonical requirement §2 asks:
   - the per-file counts, with their commands and exit codes;
   - the Node version and the skipped count;
   - **the conformance subset's result** against the checked-in expected
     list, and whether `KHRONOS_ASSETS` was set for the run.

   **Commit before running proofs. Restore each broken file from a saved
   copy, never with `git checkout`.** Proof (c) breaks a vendored file:
   restore it from the saved copy and re-run the hash test green.
4. **"Not reproducible" is not an acceptable proof result.**
   - Either the break is wrong (fix the break) or the test is weak
     (strengthen it).
   - **The reviewer reproduces every proof itself,** and checks that **every
     test in the spec's §5 table exists** (name each).
   - **The reviewer also recomputes every hash in `VENDORED.md`** from the
     vendored files, and checks them against the pinned packages from npm
     or the pnpm store. If neither is reachable, the review says so as a
     finding for the operator; it is never a pass. It runs `r1` from
     `devtasks/spike-4b/` against the vendored engine.
   - A missing test is a finding, never a pass.
5. **Test runs:**
   - server test files run one at a time, each under `timeout 180`;
   - `packages/client` runs **without `--test-force-exit`**;
   - every other package, `packages/behaviors` included, runs `node --test`
     on its own test directory;
   - read proof results from the `not ok` and `cancelled` lines, not from
     the fail count.
6. **The test environment:**
   - Tests run in the DEV deploy as `atrium-build` with no network. The
     vendored packages are local, so nothing is fetched.
   - New server tests listen on port 0.
   - `apps/client` and `packages/behaviors` tests can't import three.js or
     touch the DOM; timers are injected fakes.
   - The Khronos assets aren't on the host: F11's conformance run happens
     only when `KHRONOS_ASSETS` points at a checkout at `926bec45`. Without
     it, that one test is skipped with a logged reason, and **it is the only
     skip allowed**; the handoff names it. The invalid-graph subset (F3)
     is checked in and always runs.
7. **What the deploy refuses:**
   - **no symlinks and no `node_modules` path component anywhere in the
     tree** (the host's `tree-check`): vendor plain files only;
   - `pnpm-lock.yaml` regenerated and committed in step 1, so the deploy's
     frozen install succeeds;
   - uploads during the round go under `devtasks/` only.

#### Before DEV acceptance (operator and Claude)
- The operator runs an outside code review of the **published SHA**, over
  the whole round (base to tip). This round runs world-supplied graphs:
  the review is required, not optional (4b-1 passdown §6.1).
- Claude runs §5.1's browser checks.
- **No agent completes the acceptance gate.** Your chain stops at it.

#### Report back (completion summary)
Report every task id, and confirm each of the following:
- the brief, implementation and review cards each carry the spec commit and
  hash you copied from the front door's comment;
- the brief-review gate's parent, and its `blocked`/no-runs state;
- the implementation card's parent is the gate, and its `max-runtime` is
  14400 s;
- the review card's opening line;
- the review gate creates nothing and blocks on APPROVE;
- the review gate is linked to the sentinel.

Then complete this kickoff. Do not start any of the work.

---
