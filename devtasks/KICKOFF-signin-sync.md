# Kickoff — the page and the server agree about who you are (`signin-sync`)

How to use this file:
- The **front-door note** is for the front door and the operator.
- Everything between the two rules is the **kickoff body**. Post it
  verbatim **in the kickoff card's body field** (not as a comment).
- Then post three comments on the kickoff card:
  - the canonical worker-card requirements, headed `WORKER-CARD REQUIREMENTS
    (canonical)` (the same text as message-depth-guard's and scripting-4b-2's,
    comment 855 on `t_2d41531f`);
  - the spec's commit and hash;
  - the sentinel's id.

**Front-door note (check before creating the card):**
- **Base:** `base_main_sha = 1837436688b63b0cc622863a10689fbfd9381d85` (the
  commit that carries the FINAL pre-brief).
  - Its runtime code is identical to the release on DEV, MAIN and PROD,
    `0c31ddc0`. `git diff --stat 0c31ddc0 1837436 -- packages apps tools
    package.json pnpm-lock.yaml pnpm-workspace.yaml` is empty.
  - Confirm it with a host fetch of `origin/main`. Any later commit on
    `main` (this file's) must touch only `devtasks/`.
- **The base must carry `devtasks/PREBRIEF-signin-sync.md`,** FINAL Rev 0,
  21,432 bytes, sha256
  `8f68b2e78a8a452a9039f4c2b0d687522c3456b04913bc3813c654dba66ae070`.
  **Check the hash yourself and post the commit and hash on the kickoff
  card.** The kickoff has only `kanban_*` tools and can't check it.
- **The spec goes by git reference,** as for the last two rounds.
- **No open sentinel.** scripting-4b-2's last one, `t_95c8aa33`, is done.
  Create a new one for this slug and post its id.
- **`workflow/signin-sync` doesn't exist yet.** Do a push dry run first.
- **Card bodies go in the body field.** Round 7's kickoff created its cards
  with empty bodies and posted the bodies as comments (4b-2 passdown §4.5).
  **After every create, read the card back.** If a body or field is still
  missing (the known `kanban_create` field drop), post the missing text as
  that card's first comment while it's `todo`. **Never create a second card in
  its place.**
  - Check that the implementation card's `max_runtime_seconds` is **10800**.
  - Round 6's implementation card got a 90-minute cap instead of what was
    asked.
- **Read the kickoff body back after posting.** If it's cut, post the rest as
  PART comments before the orchestrator runs (4b-1 passdown §3).
- **On the review gate's APPROVE, build the WHOLE release chain in one go:**
  - Publish, DEV deploy, DEV finalizer and the acceptance gate. Use the same
    four cards and bodies as scripting-4b-2 round 7's (`t_b44ceed9`,
    `t_fb544ed0`, `t_e6c887ba`, `t_7228fcf8`), with this slug and the new SHA.
    This branch is new, so the publish is a **first push**, not a
    fast-forward of an existing branch.
  - Link the finalizer to this round's sentinel, and **only then** complete
    the review gate.
  - Report every id.
  - If `kanban_complete` drops `task_id` again, stop and tell the operator.
- **Server, protocol and client round:** DEV restarts at the deploy. No
  dependency changes are expected (`BroadcastChannel` is native). If a worker
  changes `package.json` or the lockfile, that's a finding.
- **Nothing is pushed to `main` between the DEV deploy's release merge and
  the MAIN push** (scripting-4a passdown §4.4).

**Before DEV acceptance (outside the pipeline):**
- Claude runs the pre-brief's §6.7 browser checks on the published SHA. That
  includes building the real-auth harness (I8), which is Claude's work, not a
  card's.
- An outside review is at the operator's discretion (the pre-brief's I8: it
  runs no world-supplied code, but changes who is admitted as whom and closes
  sockets on logout).

---

### KICKOFF — the page and the server agree about who you are. Slug: `signin-sync`

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
- **Bodies go in each card's body field when you create it,** never only in a
  comment. Read each card back; if its body is empty, post the body as its
  first comment while it's `todo`, and never create a second card in its
  place.

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
git -C /workspace/atrium show 1837436688b63b0cc622863a10689fbfd9381d85:devtasks/PREBRIEF-signin-sync.md > /tmp/prebrief.md
sha256sum /tmp/prebrief.md   # must be 8f68b2e78a8a452a9039f4c2b0d687522c3456b04913bc3813c654dba66ae070
```

On a mismatch, the card blocks with `kind="capability"`, quotes both hashes,
and does not work from a different text.

- **The spec:** `devtasks/PREBRIEF-signin-sync.md`, **FINAL Revision 0
  (2026-10-29)**:
  - §1: the problem and the reproduction;
  - §2: verified facts;
  - §3: **the operator's decisions I1–I8, the contract**;
  - §4: out of scope;
  - §5: questions the brief settles;
  - §6: the tests and proofs.
- **The reproduction script** is on the same commit:
  `devtasks/harness/checks/signin-sync/repro.mjs`. Usage:
  `node devtasks/harness/checks/signin-sync/repro.mjs <worktree root>`, after
  `pnpm install`.
- **The worker-card requirements** are a separate comment on this card,
  headed `WORKER-CARD REQUIREMENTS (canonical)`. Card bodies refer to that
  comment by its id; they never point at a host path.

#### Settlement (operator) — do not reopen
- **Base:** `base_main_sha = 1837436688b63b0cc622863a10689fbfd9381d85`.
  - Workflow branch: **`workflow/signin-sync`**, created from that SHA.
  - Worktree: `/workspace/wt/signin-sync`, made with
    `git -C /workspace/atrium worktree add -b workflow/signin-sync /workspace/wt/signin-sync 1837436688b63b0cc622863a10689fbfd9381d85`.
- **Scope:** I1–I7 as written in the spec's §3, with the recommended choice
  wherever §3 offers an alternative:
  - I4: "what a reload would do", not alternative (b);
  - I6: renewal at half-life, not a longer fixed lifetime.

  Also §6's tests and proofs.
  **Not in scope:** §4's list, and every other open follow-up in the
  scripting-4b-2 passdown.
- **Files:**
  - `packages/protocol` (`hello.server.json`, `error.json`, tests);
  - `packages/server` (`http-routes.js`, `session.js`, `world-registry.js`,
    `world-host.js`, tests);
  - `packages/client` (`AtriumClient.js`, tests);
  - `apps/client` (`auth.js`, `app.js`, `teleport-failure.js`; `index.html`
    for the notice's element and its style only; **one new module** for
    `syncAuth` and the change handling; tests under `apps/client/tests/`);
  - `docs/DESIGN-user-accounts.md` (the one "Session continuity" line).

  **No other file.** If the brief or the implementation finds that another
  file must change, stop and ask.
- **A UI round, full pipeline, with a DEV restart.** Claude's browser checks
  (§6.7) come before DEV acceptance.

#### Graph — build exactly this
1. **GLM brief** — assignee `atrium-glm`. Parent: this kickoff. Title:
   `GLM brief — signin-sync`.
   - Its card carries:
     - (a) this kickoff body;
     - (b) the spec reference and hash check above, with the front door's
       commit and hash copied in;
     - (c) a reference to the worker-card requirements comment.
   - The brief it writes is the **self-contained contract** for the
     implementation:
     - I1–I7 written out;
     - every user-facing text exactly (the three notices, "Reload the page",
       `SIGNED_OUT`'s message and its `codeToReason` sentence);
     - I7's log lines exactly;
     - every §6 test and proof;
     - the step list below.

     It may refer to sections of the spec, but must not leave a rule only in
     the spec.
   - **It settles §5's questions** and says how:
     - the notice's element, place and style;
     - the double request at page load;
     - the honeypot path posts nothing.
2. **Operator brief-review gate** — assignee `atrium-orchestrator`.
   - Title exactly `OPERATOR BLOCK: awaiting human brief review — signin-sync`.
   - Created with `initial_status="blocked"`. Parent = the GLM brief.
   - Body exactly: `OPERATOR BLOCK: human brief-review gate. Only the operator completes this. An agent dispatched here must kanban_block(kind="needs_input") on this card and do nothing else.`
   - Read it back and confirm `status == "blocked"` with no runs.
3. **DeepSeek implementation** — assignee `atrium-deepseek`. Title:
   `Implement — signin-sync`.
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
   `GLM review — signin-sync`. Parent: the implementation.
   - A **single** review.
   - Its body opens with the exact line `THIS RUN HAS TERMINAL, FILE AND GIT TOOLS. Use them for every step below.`
   - Then the spec reference and the requirements below.
5. **Review gate** — assignee `atrium-orchestrator`. Title:
   `Review gate — signin-sync`. Parent: the review. It **creates nothing**.
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
   - **Never link to any other workflow's sentinel.**
7. **Nothing reaches MAIN or PROD.** Those are host-side, operator-approved
   steps.

#### Release chain (the front door builds it, whole, on the gate's APPROVE)
These are the same four cards as scripting-4b-2 round 7's, with this slug and
the new SHA.
- Every body carries the full 40-character reviewed SHA.
- The DEV deploy runs the host's automatic release merge, so DEV, MAIN and
  PROD may run a `RELEASE_SHA` that differs from the reviewed SHA.
- **The publish, DEV deploy and finalizer cards make one call each.** On any
  refusal, non-zero exit or unexpected message, they do not retry: they block
  with `kind="capability"` and the complete output verbatim.

#### Requirements for the implementation AND review cards (beyond the spec)
1. **Ordered steps, one commit per step, every commit runnable:**
   1. **Protocol:** `hello.server.json`'s `signedIn`/`userId` with the
      `if`/`then`/`else` pairing (not in `required`); `SIGNED_OUT` in
      `error.json`; §6.1.
   2. **Server, identity:** one resolver returning
      `{ userId, authSessionId }`, with the two existing resolvers as thin
      wrappers; the auth session id carried to each socket; `signedIn`/
      `userId` in every `hello`; I7's log lines; §6.2 (a) and (e).
   3. **Server, logout:** I5 across every world host, pre-hello sockets
      included; §6.2 (b) and (c).
   4. **Server, renewal:** I6; §6.2 (d).
   5. **Client package:** `AtriumClient` keeps `signedIn`/`userId` from
      `hello` and adds them to `session:ready`; §6.3.
   6. **App, re-checks:**
      - the new module's `syncAuth()`;
      - `auth.js`'s `me()` with `cache: 'no-store'`;
      - one connect wrapper used by all six sites;
      - `visibilitychange`;
      - the `BroadcastChannel`;
      - §6.4's `syncAuth`, connect-site, ordering and channel tests.
   7. **App, after a change:** I3, I4, the notices, `SIGNED_OUT` handling and
      `codeToReason`; the rest of §6.4; the design-doc line.
   8. **Full suites, proofs** (p1)–(p6), the repro script's output on the
      tip, and the handoff.

   **Each step's report lists the suites run.** **If a run stops partway:**
   block with `kind="needs_input"` once. Use a different kind for a second
   consecutive stop.
2. **The rules most likely to be missed:**
   - **`signedIn` is in every `hello` this server sends,** on every route
     kind. `userId` is there **exactly when** `signedIn` is true. A
     cross-origin upgrade with a valid cookie gets `signedIn: false`.
   - **On the client, a `hello` without `signedIn` means unknown,** never
     anonymous, and is never compared (I3). Cross-origin connections are
     never compared either.
   - **`@atrium/client` stays renderer-neutral:** no `window`, `document`,
     `BroadcastChannel` or `visibilitychange` in `packages/client`. Those
     live in `apps/client`.
   - **`syncAuth()` is the only call to `me()` after load:**
     - concurrent calls share one request;
     - the request times out at 3 s;
     - on a network error, a timeout or a 5xx, it keeps the state and the
       connect goes ahead.
   - **A change found before a connect cancels that connect.** No
     `client.connect` call is made, and the overlay is cleared.
   - **I4 disconnects only a same-origin connection,** and autoconnects only
     when the new state is signed in.
   - **I5 closes only the sockets of the auth session that logged out,** on
     every host, the default/commons host and pre-hello sockets included,
     with `SIGNED_OUT` then 1008.
     - The same user's other auth sessions are untouched.
     - On `SIGNED_OUT`, the client runs `syncAuth()` and **doesn't assume
       signed-out**.
   - **I6 renews only below half-life,** re-setting the cookie with the same
     attributes. An expired session gets 401 and is not renewed.
   - **No cookie value and no auth session id in any log line.**
   - **The register honeypot path posts no `auth-changed`.**
   - **App tests use the strict DOM fake,** and `dataset` is never assigned
     (scripting-4b-2 round 5's V1 and V12).
3. **The handoff includes:**
   - every proof, (p1)–(p6), each with its failing test names; (p4) is run
     once for **each** of the six connect sites;
   - the repro script's full output on the tip. After logout, the old socket
     is **closed**, and `hello`'s keys include `signedIn` (and `userId` when
     signed in);
   - what canonical requirement §2 asks: the per-file counts with their
     commands and exit codes, and the Node version.

   **Commit before running proofs. Restore each broken file from a saved
   copy, never with `git checkout`.**
4. **"Not reproducible" is not an acceptable proof result.**
   - Either the break is wrong (fix the break) or the test is weak
     (strengthen it).
   - **The reviewer reproduces every proof itself,** and runs the repro
     script on the tip itself.
   - **The reviewer greps `apps/client/src` for every `client.connect` and
     `trackConnect` call** and confirms each goes through the guard.
   - **The reviewer reads every `hello` the server can send** for the new
     fields, and every log line added for secrets.
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
- Claude runs the spec's §6.7 browser checks against the published SHA.
- **No agent completes the acceptance gate.** Your chain stops at it.

#### Report back (completion summary)
Report every task id, and confirm each of the following:
- the brief, implementation and review cards each carry the spec commit and
  hash you copied from the front door's comment, **in their body fields**;
- the brief-review gate's parent, and its `blocked`/no-runs state;
- the implementation card's parent is the gate, and its `max-runtime` is
  10800 s;
- the review card's opening line;
- the review gate creates nothing and blocks on APPROVE;
- the review gate is linked to this round's sentinel.

Then complete this kickoff. Do not start any of the work.

---
