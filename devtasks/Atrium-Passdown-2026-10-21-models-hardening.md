# Atrium Passdown — 2026-10-21 — models-hardening, released (with the automatic release merge and the smoke check)

**Predecessor:** `devtasks/Atrium-Passdown-2026-10-20-models-by-url.md`. Its host and connector state still holds, except where this file says otherwise.

**First instruction for the next session's Claude:**
1. Clone the repo and read `devtasks/`, newest first (this file first).
2. If the `atrium-ops` connector's tools are listed, use them for board, release, log and git state. It is read-only.
3. **The release path changed this round (§2.1).** Read it before any release: the reviewed SHA and the SHA that reaches DEV, MAIN and PROD can now differ.
4. **Pre-briefs over about 40 KB go to workers by git reference, never posted on the kickoff (§4.1).**
5. Then §6: the operator picks the next round.

## 1. Status at handoff

| Item | State |
|---|---|
| Release | **COMPLETE** (2026-10-21 ~21:05 PT). DEV, MAIN and PROD are at `82c1d40eebcc479ce326712613d9ae2a4cb7e4fe`, all recorded and healthy, with the deploy lock free. |
| What `82c1d40e` is | The **release merge** (§2.1) of the reviewed `ad7b04452ae4c190232158ab2cb312ef00fdf512` with `main` `26a028f5`. It was built and pushed by the host as `release/ad7b04452ae4`. Its code is byte-identical to `ad7b0445`; only `devtasks/REVISION-models-hardening.md` differs. MAIN fast-forwarded to it with no hand merge. |
| Spec | `devtasks/PREBRIEF-models-hardening.md` (Rev 3, plus the Playwright 1.64 pin), and `devtasks/REVISION-models-hardening.md` (round 2). The reviews are in `devtasks/REVIEW-models-hardening-rev2.md` and the pre-brief's §12–§13. |
| Decisions | L1a–L6a (pre-brief §3), all as recommended, operator 2026-10-20. |
| DEV acceptance | Operator, 2026-10-21 ~21:00 PT. Item 1 (add, Undo, Redo, Duplicate, Delete, visitor sees it) passed. Items 2–3 depend on timing and can't be done by hand; Claude's browser checks covered them (§4.6). |
| Host additions (live) | `/usr/local/sbin/atrium-release-merge`; the patched `atrium-deploy-gate` (`dev` runs the release merge) and `atrium-deploy` (the smoke check); `/usr/local/lib/atrium-smoke/` (user `atrium-smoke`, venv, Playwright 1.64, Chromium). Backups: `/root/atrium-deploy.bak-2026-10-21`, `/root/atrium-deploy-gate.bak-2026-10-21`. |

**Board and branch cleanup (operator, host):**
- Complete the round-2 sentinel `t_babf296a` (it waits for the operator), and any open round-1 models-hardening sentinel.
- Delete the branches `workflow/models-hardening` and `release/ad7b04452ae4`. The older `claude/copy-objects-decisions` and `claude/passdown-edit-polish-2` are still on GitHub too: your call.
- Remove the host scratch files `/root/tmp-h` and `/root/mh-correction.txt`.

## 2. What shipped

### 2.1 The release path: the automatic release merge (host)
**Before:** a revision doc uploaded to `main` mid-round left `main` ahead of the workflow branch, so `atrium-main-push` refused (not a fast-forward). The operator merged by hand (models-by-url passdown §5.2).

**Now:** the deployer's `atrium_deploy(action="dev", sha=<reviewed>)` goes through `atrium-deploy-gate`, which first runs `atrium-release-merge <reviewed>`:
- **`main` already in the reviewed SHA:** the release is the reviewed SHA, and nothing is pushed (round 1, `a6b93610`).
- **Otherwise:**
  1. It builds a two-parent merge without a checkout (`merge-tree --write-tree`, `commit-tree`).
  2. It refuses unless `main` brought only regular files under `devtasks/` and the merge is clean.
  3. It refuses up front if `atrium-deploy` would refuse (the release state, a deploy marker, legacy mode).
  4. It pushes `release/<sha12>` with a lease, fetches it back and verifies it.
  5. It prints `REVIEWED_SHA=`, `RELEASE_SHA=` and `MAIN_AT_RELEASE=`, then hands `RELEASE_SHA` to `atrium-deploy dev`. Round 2 built `82c1d40e` this way.
- **A re-run** reuses `release/<sha12>`, after re-deriving every link on it, or stacks a new merge if `main` moved again.
- **Exit codes:** 64 usage; 77 refused before the push; 75 an operation failed before the push; 70 critical, at or after the push.
- **DEV, acceptance, MAIN and PROD all use `RELEASE_SHA`.** `atrium-release-status`'s REVIEWED line shows it, because `set-dev` records it.
- **`main` moving after the merge** (an upload during acceptance) is caught by `atrium-main-approve`, before any approval exists. The remedy is to run `atrium-release-merge <reviewed>`, then `atrium-deploy dev <new RELEASE_SHA>`, and accept again.
- **Uploads under `devtasks/` mid-round are fine now.** Anything else is refused at the DEV deploy, with the path named. Hold those until after PROD.
- **Tests:** `devtasks/host-drafts/test-release-merge.sh`, 47 cases (fault injection, a stub `atrium-host`).

### 2.2 The browser smoke check (host)
Every DEV deploy, and every same-SHA health check, runs `atrium-client-smoke https://dev.ewwb.dev/ --require-id ep-model --timeout 40`. It runs as a transient unit (`atrium-smoke-<pid>-<n>`) under the unprivileged `atrium-smoke` user.
- **It fails when:**
  - the page throws;
  - a module or script fails to load;
  - `window.atriumClient`, `window.stage` and a live WebGL context aren't all present within 40 s;
  - `#ep-model` is missing.
- **On failure:** two attempts, then the ERR trap rolls DEV back. Exit 4 labels a third-party outage (a CDN) but is treated like 1.
- **It is a startup check, not a functional test.** Claude's browser checks remain per round.
- **In use:** it ran and passed in about 4.4 s, 460 MB peak, on both DEV deploys (journal, §5.2).

### 2.3 The code (`ad7b0445`, through the pipeline)
**Files:**
- `packages/client/src/model-fetch.js` (two new helpers, `createSharedTasks` and `createTransferLimiter`);
- `packages/renderer-three/src/model-bridge.js`, `model-parse.js`, `model-instances.js`;
- `apps/client/src/model-form.js`, `app.js`;
- and their tests.

**What changed:**
- **S8, shared loads:** a load belongs to its template key and a set of requesters, not to the first node. Deleting the first of two copies mid-load leaves the second loading. Deleting the only copy cancels the download. A job abandoned by its last requester is never adopted by a new one, and the parse belongs to its task.
- **S6, the download limit:** one transfer limiter per page counts HTTP requests, at most 4 at a time, the Check's included. Waiting for a slot is ordered by document order, then first come. Waiting for admission or the parse queue holds no slot.
- **S6, shared dependencies:** two `.gltf` files that need one dependency while both are loading share a single transfer. It's keyed by URL plus redirect policy, and each model's 25 MiB budget is charged chunk by chunk.
- **The job deadline (30 s):** counts only a job's own work. The clock stops while it waits for a slot, admission or the parse queue. Each job that joins a shared transfer enforces its own deadline.
- **S1, aliased URIs:** a `.gltf` naming one file two ways (`./a.png` and `a.png`) loads.
- **S4, disposal:** placeholders and each model's cloned skeletons are disposed on attach, fail, remove, a spec change and a world reset. The template's shared resources are never touched.
- **S3, the Check:** a stale Check result changes nothing in the form.
- **Sign-in:** the page-load sign-in check catches its own error, so a transient 502 from `/api/auth/me` isn't a page error (it would fail the smoke check).
- **R7, aborts:** an abort during a shared download is named (`timeout`, `world-download-budget`). A node that's still wanted is never left invisibly `loading`.

**Tests at release:**

| Package | Tests |
|---|---|
| `packages/client` | 332, run **without** `--test-force-exit` (§4.5) |
| renderer-three | 225 |
| `apps/client` | 588 |
| interaction | 9 |
| server | 33 files, 499 tests, unchanged this round |

## 3. How the round ran

| Step | Card or SHA | Notes |
|---|---|---|
| Pre-brief Rev 0–1 | — | Drafted 10-20 from probes at `a1eb65b`; L1–L6 approved as recommended |
| Outside review 1 | — | Its session couldn't reach GitHub or the connector; NO-GO on design (M1–M6). Rev 2 |
| Outside review 2 | `REVIEW-models-hardening-rev2.md` | With repo and host access; NO-GO on four text fixes, GO on both scripts. Rev 3 (written by the reviewing session) |
| Host part H1–H5 | — | Installed 10-21 morning. Playwright 1.56 refused Ubuntu 26.04 → pinned 1.64 (§4.7) |
| Kickoff, attempt 1 | `t_cc2275f7` | **Failed:** the 68 KB pre-brief was posted on the kickoff (101 KB card) → iteration budget, then triage (§4.1) |
| Kickoff, attempt 2 | `t_f56de8b9` | Spec by git reference, pinned by sha256 |
| GLM brief | `t_0955c5ec` | Faithful. The brief gate was approved with three corrections on the implementation card (runtime cap, read the brief's comments, `-b` on the worktree) |
| Round 1 | `a6b93610` (`t_3d23e0ea`, GLM `t_6f8c33b2`) | GLM APPROVE, but 4 of 13 proofs unshown. Claude's checks and the outside code review: **NO-GO**. Three regressions in shared downloads (R1, R7, R8), and weak or missing tests |
| Round 2 | `ad7b0445` (`t_f29be48b`, GLM `t_38f6268a`) | All 16 proofs reproduced by both workers. Claude's browser checks 9/10 (the tenth a harness artifact). Outside re-check: GO |
| Release | `82c1d40e` | First real release merge. Acceptance, MAIN fast-forward, PROD |

## 4. Findings and lessons

### 4.1 A large pre-brief can't be posted on the kickoff
The front door posted the 68 KB pre-brief as comments on the kickoff, making a 101 KB card. That broke the orchestrator in two ways:
- **It can't read its own context back.** Large `kanban_show` results are saved to a file, and that profile has no tool to read it.
- **It can't re-emit the spec** into a downstream card within 150 iterations.

The card went to triage after two blocks, and only the operator could archive it.

**Rule:** from about 40 KB up, every card that needs the spec gets a reference, not a copy: `git -C /workspace/atrium fetch origin main && git show <base>:devtasks/<file>`, with its sha256 checked, blocking if it differs. The GLM brief remains the self-contained contract. models-by-url's 37 KB pre-brief was close to the limit.

### 4.2 The deployer's handoff shows only the end of the deploy output
On both DEV deploys, the handoff lacked `REVIEWED_SHA=`, `RELEASE_SHA=` and `SMOKE OK`. Both DEV finalizers blocked for the operator.
- **What actually happened:** the gate patch is installed, and the host journal confirmed both steps ran and passed.
- **The cause:** the deployer's tool returns, or the deployer quotes, only the tail of a long output. In round 1 it also explained the missing lines wrongly ("no server-affecting files changed").
- **Until it's fixed,** the operator verifies from the journal (§5.2) and completes the finalizer by hand.
- **Fix options for a small host round:**
  - have `atrium-deploy` re-print a short summary block at the very end, with `REVIEWED_SHA`, `RELEASE_SHA`, `SMOKE OK` and the success line (the gate would have to pass the reviewed SHA through, for example in an environment variable);
  - or have the gate run `atrium-deploy` without `exec` and print that block itself afterwards.

### 4.3 GLM APPROVE with unshown proofs is not evidence
- **Round 1:** the GLM reviewer reported p2, p4 and p5b as "not reproducible", and noted that p3c's test still passed under its break. It approved anyway.
- **What Claude and the outside review found:**
  - p2 was provable (the workers' breaks were wrong);
  - p3c, p4 and p5b guarded correct code with tests that couldn't fail;
  - several tests listed in the pre-brief's §5 table were never written. One of them, the shared-transfer timer test, would have caught R1, a real regression.
- **Revision rule, kept for future rounds:** "not reproducible" is not an acceptable proof result. Either the break is wrong (fix the break) or the test is weak (strengthen it). The reviewer must reproduce every proof itself.
- **Also add to review cards:** check that every test in the pre-brief's §5 table exists.
- **Round 2 under that rule:** all 16 proofs were shown by both workers.

### 4.4 Shared resources: the regressions
R1, R7 and R8 all came from round 1's new shared dependency transfers. The pre-brief's design was right; the implementation missed half of it:
- **R1, no per-consumer timer:** a stalled texture froze every later model in the world, because admission is in document order (W5).
- **R7, abort names lost:** the bridge then parked nodes invisibly.
- **R8, bag per key:** a stale byte count was charged to joiners.

**Lessons:**
- **For any shared, cancellable resource, test the joiner's view separately from the starter's:** its deadline, its budget, its abort.
- **"Queued" cases need a Check in front.** Node parses never queue behind each other, because W5 settles each node before the next is admitted. Only a Check's parse can hold a node's job in the parse queue.

### 4.5 Test-runner quirks
- **`--test-force-exit` truncates `packages/client` at random.** `model-spec.test.js` ran 38, 72 or 97 of its 97 tests, suite totals 241–300, all reported as passing. Run `packages/client` without the flag: 302 at the base, 332 now.
- **A proof that hangs shows as `cancelled`, not `fail`.** Under p9, the stalled-transfer tests report `# fail 0`, `# cancelled 9`, with a non-zero exit. Report proofs from the `not ok` and `cancelled` lines, not from the fail count.

### 4.6 DEV acceptance steps must be doable by hand
Steps that depend on timing ("delete before it appears", "Check while models load") can't be done by a person on a fast connection. Put those in Claude's browser checks with deliberately slowed downloads, and keep the operator's steps to what a person can see.

### 4.7 The host runs Ubuntu 26.04
Playwright refuses Ubuntu 26.04 before 1.61. `install-atrium-smoke.sh` pins 1.64.0. Any future Playwright or browser tooling on the host needs 1.61 or later.

### 4.8 The kanban field-drop fault is still live
The implementation card was created with a 90-minute cap instead of the 3 hours asked for (passdown 10-20 §4.4). The operator raised it with the SQL recipe while the card was `todo` (models-by-url passdown §5.3). **Still open:** find the cause on the host.

### 4.9 Claude's browser harness: what to know
- **It needs https.** A1 rightly refuses `http:` dependencies, so a plain-http harness fails every `.gltf` with `bad-dependency`. Use a self-signed cert and `ignore_https_errors`, with `wss://` for the world.
- **Measure concurrency in the browser, not at the server.** Keep-alive makes server-side "in flight" counts read high: they showed 6–8 while the limiter showed 4. Poll `window.__mb.limiter.active` and compute overlap from `performance.getEntriesByType('resource')`.
- **Never `pkill -f` or `pgrep -f` a pattern that appears in your own command line;** it kills your own shell. This happened four times. Record the PID when starting and kill by it.
- **The host's journal is in UTC.**

## 5. Recipes

### 5.1 Claude's browser harness (scratch, not committed)
- **Modules:** `npm i esbuild three@0.163.0 @gltf-transform/{core,extensions,view}@4.3.0`, then bundle:
  - `core` whole;
  - `extensions` with `core` external;
  - `view` (`dist/view.modern.js`) with `three`, `core` and `extensions` external.
- **Server** (Node, https, one port):
  - **Pages:**
    - the repo, statically;
    - `/apps/client/local.html`, which is `index.html` with the esm.sh imports rewritten to `/vendor/...` (map `three/examples/jsm/` and `three/addons/` too);
    - `app.js` with `const modelBridge = window.__mb = createModelBridge(`;
    - `/api/auth/me` answering 401.
  - **Models:** `/models/<path>?delay=&drip=`, with CORS `*`, counted. `/models/stall/*` sends headers and 10 bytes, then nothing.
  - **The world:** `attachSessionHandlers({ wss, world: createWorld('tests/fixtures/space.gltf', { baseUrl: 'https://127.0.0.1:<port>/' }), worldOwnerUserId: 'owner' })`, with every upgrade emitted as `'owner'`.
- **Driver** (Playwright, Python):
  - connect with `window.atriumClient.connect('wss://127.0.0.1:<port>/')`;
  - add with `atriumClient.addNode({ name, translation, extras: { atrium: { model: { url: '/models/...' } } } })`;
  - remove with `removeNode(name)`;
  - read status with `__mb.status(name)`;
  - read memory with `stage._renderer.info.memory`.
- **Fixtures:** Khronos Box, Duck, RiggedSimple and BoxTextured. Generated from those:
  - an alias `.gltf`;
  - two `.gltf` files sharing `../shared/*`;
  - a `.gltf` whose texture is `/models/stall/...` (its buffer must resolve, or a 404 comes first).

### 5.2 Verify a DEV deploy on the host (until §4.2 is fixed)
```bash
journalctl --since "<UTC start>" | grep -E "atrium-smoke|atrium-release-merge" | head
# expect: atrium-release-merge ... release=<sha> (only when it pushed), and Started/Deactivated atrium-smoke-<pid>-1
hermes kanban --board atrium complete <DEV finalizer id> --result "OPERATOR: DEV deploy verified on the host (journal: ...)"
```

### 5.3 Run the smoke check by hand
`bash /root/tmp-h/devtasks/host-drafts/smoke-now.sh`, or the same `systemd-run` line from `devtasks/host-drafts/smoke-now.sh`. It changes nothing.

### 5.4 Accept, MAIN and PROD with a release merge
```bash
S=<RELEASE_SHA>      # from atrium-release-status's REVIEWED and DEV lines, not the reviewed SHA
hermes kanban --board atrium complete <acceptance gate id> --result "OPERATOR: <slug> DEV accepted ($S)"
atrium-main-approve $S && atrium-main-push $S
```
Then the guarded PROD block (teleport-rearm passdown §7.2) with the same `S`.

### 5.5 Undo the host changes
```bash
cp -p /root/atrium-deploy.bak-2026-10-21      /usr/local/sbin/atrium-deploy
cp -p /root/atrium-deploy-gate.bak-2026-10-21 /usr/local/sbin/atrium-deploy-gate
```
`atrium-release-merge` does nothing unless the gate calls it.

## 6. Follow-ups

### 6.1 Small host round (operator or Claude on the host)
- **The deployer's handoff gap (§4.2):** print the summary block at the end.
- **The `kanban_create` field-drop fault (§4.8):** find the cause.
- **Add these to `atrium-ops`'s `read_file` allowlist,** so Claude can verify them from a session: `atrium-release-merge`, `atrium-publish-workflow`, `/usr/local/lib/atrium-smoke/atrium-client-smoke`.
- **Optional:** switch `atrium-deploy`'s `PUBLIC_HEALTH` and `PUBLIC_CLIENT_BASE` from `dev.5-78-232-73.sslip.io` to `dev.ewwb.dev` (10-09 domain passdown).

### 6.2 Recorded, not done
- **A SOM node replaced by identity,** with the same name and spec, while it loads, ends `loading/aborted`, because `reconcile` keeps the stale record. It's an older issue: the outside review reproduced it at the base. A later round should check it against Z2's invariant.
- **Models don't play their animations yet** (by design; step 4). The operator noticed at acceptance. The loader already prepares each instance's retargeted clips (`record.clips`).
- **Known limitations** from the 10-20 passdown §6.2 still hold: no touch movement; undo history per connection; model fields can't be edited after placement.

### 6.3 Next in sequence (operator's order)
- **Step 3b:** the starter library, the sky, and Caddy and library hosting. L13–L15 are decided (models-by-url pre-brief §3, §9 sketch). The library's packed `.glb` files don't use shared dependencies.
- **Step 4:** model animations.
- **The richer `add`,** then **the copy step** (copy-objects passdown C1–C4; a root-relative model URL may need to become absolute on another server).
- **Pass B** (connector writes) and **edit-polish-3** remain open from earlier passdowns.
