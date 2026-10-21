# Second outside review: pre-brief models-hardening Rev 2, `atrium-release-merge` and `atrium-client-smoke` (Rev 2)

2026-10-20, ~17:45 PT. Read-only. Probes and extra tests were throwaway, in a local clone and a scratch folder; nothing was pushed, and nothing on the board or the host was changed.

## Access (step 0)
1. **Repository: OK.** Cloned `https://github.com/joshmaurice/atrium` and checked out `a1eb65b`. `git diff --stat 3a71e855 a1eb65b` shows one file: `devtasks/Atrium-Passdown-2026-10-20-models-by-url.md`, +251.
2. **Ops connector: OK.** `read_file` returned `atrium-deploy`, `atrium-deploy-gate`, `atrium-main-approve`, `atrium-main-push`, `kanban-guard` and `worker-card-requirements`.
3. **Note:** the first set of attachments was Rev 1 (no §12, 20 test cases). The Rev 2 files arrived at 16:54 PT, and everything below is against Rev 2. Rev 2 is not on `origin/main`, so the connector can't read it.

Environment: Node 22.22.0, pnpm 10.28.0, git 2.43.0, Python Playwright with Chromium (build 1194), SwiftShader.

## Verdicts
| Item | Verdict |
|---|---|
| **Pre-brief Rev 2** | **NO-GO** as written. There are four must-fixes, all text changes to P10, Z2 and Z3. No decision (L1–L6) needs to change. The host part H1–H4 can proceed (L2a) once S6–S9 are taken or explicitly declined. |
| **`atrium-release-merge` (Rev 2)** | **GO.** Take S6 and S7 before install. N1 and N5 are cosmetic. |
| **`atrium-client-smoke` (Rev 2)** | **GO.** S8 belongs to the `atrium-deploy` hook and S9 to `app.js`. N2–N4 are cosmetic. |
| H2 gate snippet | **GO.** Exit codes propagate unchanged (tested). |

## Must-fix

### M1. P10's `packages/client` baseline is wrong, and its command truncates the suite at random
- **Where:** pre-brief §2 P10 table; §5 "Expected counts".
- **What goes wrong:** with `--test-force-exit`, `node --test` exits before all of `tests/model-spec.test.js` has run. That file declares 97 tests, many in a `for` loop over the shared A1 vectors. Three per-file runs reported **72, 97 and 38**. The whole suite reported **300, 274 and 241** across runs, all with `fail 0`, and never the 292 in P10. Without the flag, the suite gives **302** every time (three runs), exits 0 and takes about 49 s.
- **Consequences:**
  - Every handoff's `packages/client` count will disagree with "P10 plus new tests". A reviewer either blocks on noise or learns to ignore the number.
  - Worse, a truncated run passes with the URL-rule vectors (A1, the security boundary) never executed.
- **Trigger:** `cd packages/client && node --test --test-force-exit tests/*.test.js`, run a few times; compare `# tests`.
- **Fix:** set the baseline to **302**, and drop `--test-force-exit` for `packages/client` (it isn't needed: the run exits on its own). If it must stay, require per-file runs, and require each file's `# tests` to equal its declared count.
- **Reproduced:** yes, by running the suite repeatedly (per-file table in the appendix).

### M2. Z2: a new task for a key adopts an abandoned task's in-flight parse, so a re-added node ends `loading`/`aborted`
- **Where:** pre-brief Z2 (M5's "a join after abandonment starts a new task"), together with `model-bridge.js` `templateFor` L430–511: the `parses` map, `inFlight` at L434–435, cleanup at L508–509.
- **What goes wrong:** Z2 gives the shared-task map new identities and own-entry cleanup. But `templateFor` keeps a second per-key map, `parses`, and returns whatever promise is in it.
  - An abandoned task's parse stays in `parses` until it settles. That includes a parse waiting in the serialized parse chain behind other models.
  - A new task for the same key then fetches and calls `templateFor(key)`, which returns the **old** promise.
  - When the old parse's turn comes, its `wanted()` is the abandoned task's, so it answers `aborted` (L460, or L479–483 if it was already running).
  - The new task hands `aborted` to its requesters. `load` calls `drop(record)` (L296), so the node ends `{ loading, reason: 'aborted' }` with no placeholder. That is exactly the state Z2's invariant forbids, and P3's outcome by another route.
  - Today `resetWorld` clears `parses` and `loads` together (L231–232), so the world-change case is safe. Z2 adds per-key abandonment without saying the same for `parses`.
- **Sequence:**
  1. A world with several models loading, so the parse chain is busy (each 2k model takes seconds in SwiftShader; passdown §4.8).
  2. The owner deletes node N while its parse waits in the chain. N was the only requester, so the task is abandoned and its parse stays queued.
  3. The owner presses Undo before the chain drains. N is re-added, a new task starts, and the fetch is quick (HTTP cache).
  4. `templateFor` returns the old parse. N ends `loading`/`aborted`, invisible, until a world change.
- **Same for a Check:** Check, Cancel, Check the same URL. The second Check reports "the download was cancelled" although nobody cancelled it.
- **Fix:** in Z2, state that the in-flight parse belongs to its task:
  - **(a)** drop the `parses` map (one task per key makes it redundant), or key it by task identity; and
  - **(b)** when a task is abandoned, delete its `parses` entry only if it is still its own (the `=== job` pattern), and dispose its late result as Z2 says.
  - **Better alternative:** an abandoned task whose parse completes while a newer live task exists for the key puts the template in the cache for that task instead of disposing it. That saves a second parse and a second texture reservation.
- **Test:** delete a node while its parse is queued behind another, re-add it before the queue drains, and the node ends `loaded`. Proof: (p3c) let a new task reuse `parses.get(key)`.
- **Reproduced:** found by reading, since Z2 isn't implemented. The shared-fate mechanism is P3's, which I reproduced (P-claims table).

### M3. Z3: shared transfers weaken the 25 MiB per-model cap from per-chunk to per-completed-transfer
- **Where:** pre-brief Z3 "Invariants of a shared transfer", bullets 3–4. Compare `model-fetch.js` `readBody` L178–239: one `budget` object for the file **and** every dependency, charged and checked on every chunk (L216–223), plus a Content-Length early refusal against the **remaining** budget (L179–183). This contradicts Z6, which says every limit is unchanged, and A3 step 3.
- **What goes wrong:** Z3 says the transfer enforces 25 MiB on its own, and each consumer adds the bytes to its budget "when the transfer completes". Every non-`data:` dependency goes through `sharedTransfers`, shared or not.
  - A model's cumulative cap is therefore checked only between whole dependencies.
  - The Content-Length refusal no longer sees the model's remaining budget.
- **Sequence:** a `.gltf` naming dependencies `a.bin`, `b.bin` and so on, each about 24 MiB.
  - **Today:** it stops at 25 MiB. My probe, with two 20 MiB dependencies, gave `too-large` with the ledger at **25.00 MiB**.
  - **Under Z3 as written, sequential:** about 48 MiB is downloaded and charged before `too-large`.
  - **Under Z3 as written, parallel** (Z3 doesn't say which): up to 4 × 25 MiB, about 100 MiB, charged by one model. That is two-thirds of the world's 150 MiB ledger, which never refunds, so later models fail `world-download-budget`.
- **Fix:**
  - The shared transfer fans each chunk out to its consumers.
  - Each consumer charges its own 25 MiB budget per chunk and leaves (`too-large`) the moment it's over. The transfer continues while others remain.
  - A consumer whose remaining budget is below a declared Content-Length leaves at once.
  - Say whether one job's dependencies are fetched in sequence or in parallel.
- **Test:** two models share a 20 MiB texture; model X also names a second 20 MiB file. X fails `too-large` with its own bytes at 25 MiB plus one chunk; Y loads; the ledger is about 40 MiB, not 60.
- **Reproduced:** today's behaviour, yes (probe). The regression is by reading Z3.

### M4. Z3: A2's redirect rule depends on the consumer, but shared transfers are joined by URL alone
- **Where:** pre-brief Z3 invariant 1 ("A1's URL rule and A2's request policy are applied by `fetchOne` … **before** a transfer starts or is joined"). Compare `model-fetch.js` `fetchOne` L246–283: the redirect check (L262–268) uses the caller's `rootRelative` and `worldBaseUrl`.
- **What goes wrong:** a redirect is known only from the response, so "before … joined" can't apply it. The rule differs per consumer: L17 lets an absolute-https model's dependency follow any https redirect, but a root-relative model's must stay on the world's origin.
- **Sequence:**
  1. World `https://w.example/`. Node P has `url: "https://w.example/m/a.gltf"` (absolute); node Q has `url: "/m/b.gltf"` (root-relative). Both name `tex.png`, which resolves to `https://w.example/m/tex.png` for each.
  2. `https://w.example/m/tex.png` answers 302 to `https://cdn.example/tex.png`.
  3. P starts the shared transfer, and its redirect check passes.
  4. Q joins, and receives bytes from `cdn.example`, which A2/L17 refuses for Q.
- **Fix:** key `sharedTransfers` by `(canonical URL, redirect policy)`, where the policy is `abs` or the world origin. Or have each consumer apply `redirectProblem(finalUrl, its rootRelative, worldBaseUrl)` to the shared result (`url`, `redirected`) and fail `redirect` on its own.
- **Test:** the sequence above. Q fails `redirect`, P loads, and there is one request.
- **Reproduced:** by reading. It isn't implemented yet, and the rule is in today's `fetchOne`.

## Should-fix

**S1. Z3, the deadline on a shared transfer (M3's meaning).** "Each transfer and the parse get `remainingMs()` when they start" doesn't say whose clock a shared transfer runs on.
- If it is the starter's: Y starts with 2 s left, X joins with 25 s left, and Y's timer aborts the transfer, so X fails `timeout` on another job's clock. That is not "30 s of a job's own work".
- **Fix:** the shared transfer has no timer of its own. Each consumer's deadline makes that consumer leave, and the transfer is aborted when the last one leaves.
- Also define the clock by exclusion, as round 6's M3 did: it runs from the first request to the end of the parse, except while waiting for a slot, for admission or for the parse queue. The inclusion wording ("a transfer in flight or its parse is running") leaves CPU work uncounted, such as `JSON.parse` of a 25 MiB `.gltf` or a pin's sha256.
- **Test:** Y (1 s left) starts the transfer, X (fresh) joins, and Y times out; X completes.

**S2. Z3 contradicts §12 A4 on transfer order.**
- A4 (binding): "Queued transfers start in A10's order". Z3's limiter is first-come, and only first transfers queue in `allNodes` order. A dependency of the first model queues behind every later model's file. W5 then holds every later parse until that model is admitted.
- A10's "bounded by their own 30 s timeouts" now means 30 s of work, not wall time.
- **Fix:** give the limiter a priority (the `allNodes` index of the job's earliest requester, with Checks last, first-come within). Or amend A4 and A10 explicitly in Z3.

**S3. Z3 contradicts §12 A4 on dedupe scope.** A4: "Fetches are deduplicated by canonical URL for the whole world". L4a: dependencies are shared in flight only. Z6 claims nothing changes.
- **Fix:** state the amendment in Z3 and Z6, so a reviewer holding §12 doesn't flag a conforming implementation and an implementer doesn't "fix" it.

**S4. Z3: limiter edge cases.**
- **A slot can leak** if the grant and an abort land in the same tick.
  - **Fix:** say that `release` is idempotent and held in `try/finally` from the moment of the grant, and that an abort after the grant releases.
  - **Test:** abort in the tick the slot is granted; there's no leak, and the next waiter starts.
- **A4's "every queued or later model fails `world-download-budget`"** needs two statements:
  - a waiter whose job's controller the ledger aborts leaves the queue and is named `world-download-budget` (today's `abortOrTimeout`);
  - the shared transfer registers its own controller with the ledger.

**S5. Z2: the parse's reference.** "The entry the parse creates (`acquired: true`) … hands it to its first remaining requester" should say *only when this task's parse created the entry*. When the task finds the entry already cached (`templateFor` L431–432, or `again` at L458–459), there's no reference to hand over, and every requester acquires its own.

**S6. H1 pushes before `atrium-deploy`'s up-front refusals.**
- `atrium-deploy` refuses with nothing changed in four cases:
  - a release state other than `UNINITIALIZED`, `WAITING_FOR_HUMAN_DEV_ACCEPTANCE` or `COMPLETE` (exit 77);
  - a recorded interrupted deploy;
  - legacy mode;
  - local modifications.
- H1 runs first and may already have pushed `release/<sha12>`.
- **Sequence:** the release is in `WAITING_FOR_PROD_APPROVAL`. A DEV deploy card arrives for another reviewed SHA whose base lacks `main`. H1 pushes `release/<sha12>`, then `atrium-deploy` refuses with 77 "DEV can't change until PROD completes". A stray branch is left on GitHub.
- **Fix:** before fetching, H1 (or the gate, before H1) reads `/usr/local/lib/atrium-host/sbin/atrium-host release-record`, `deploy-mark read` and `legacy-mode`, the way `atrium-deploy` does, and refuses with 77 first. Not a safety hole, since the deploy still refuses.
- **Found by reading.**

**S7. H1 accepts and pushes non-regular entries under `devtasks/`.**
- **Reproduced** (extra case E7): `main` gains `devtasks/link.md -> ../packages/a.js` (a symlink). H1 exits 0 and pushes `release/<sha12>`. `atrium-deploy`'s D2 tree check refuses symlinks and submodules (per its comment), but only after the push.
- **Fix:** in `only_docs`, or a separate check on the final commit, read `git diff --raw -z --no-renames <from> <to>` and refuse any new mode other than `100644`/`100755` (and `000000` for deletions). The refusal then names the path before anything leaves the host.

**S8. H3: the hook's exact shape.** "Runs the unit through `run` … up to twice" is easy to get wrong with this `run`/ERR pattern. I tested it with `atrium-deploy`'s `run` and ERR trap copied verbatim:
- **`run x` as a statement in a loop** triggers the ERR rollback on the first failure, so there is never a second attempt.
- **If `x` is a shell function** (a wrapper around `systemd-run`), the ERR trap also fires inside the background child (errtrace). The rollback ran first in the child, then in the main shell (confirmed by PID). Once `ACTIVATED=1`, that would be two rollbacks back to back.
- **`if run systemd-run …; then return 0; fi`** inside the loop, then `return 1`, with `check_client_smoke` called as a plain statement, works: two attempts, then one rollback.
- **Fix:** write that shape into H3, with `systemd-run` (an external command) as `run`'s direct argument.
- **Also:** name the unit (`--unit=atrium-smoke-$STAMP`) so a rollback or recover can stop it, or state that `RuntimeMaxSec=120` is relied on. `stop_child_group` kills `systemd-run`, which isn't the unit. I couldn't check whether `systemd-run --wait` stops its unit on SIGTERM.

**S9. A transient auth-backend error fails, and rolls back, a good deploy.**
- `app.js` L2585 `me().then(...)` has no `.catch`, and `auth.js` `me()` throws on any non-401 error status or a network error. The result is an unhandled rejection, which the smoke reports as `pageerror`.
- **Reproduced** against the real client page (imports served locally): `/api/auth/me` answering **401 → `SMOKE OK`** (about 5 s); **502 → `SMOKE FAILED … page error: Session check failed (502)`**, exit 1.
- **Fix:** catch, and log, the page-load `me()` in `app.js` (already in this round's file list). It's a real page bug as well. Or record in H3 that an auth-backend fault during a deploy rolls DEV back.

## Nits
- **N1. H1 exit code:** a `merge-tree` failure that isn't a conflict exits **77**, not 75 (extra case E4). Distinguish rc 1 (a conflict, 77) from rc above 1 (a failed operation, 75) in `merged_tree`.
- **N2. Smoke and H3 wording:** the docstring and H3 say "app.js sets them once its imports have loaded and its setup has run". It doesn't: `window.atriumClient` is set at L375 and `window.stage` at L392, before the bridge (L2637) and the form (L2766). READY proves the imports and the Stage. A setup throw is caught only through `pageerror`, and a hang not at all. Optionally set `window.atriumReady = true` at the end of `app.js` setup and require it in READY.
- **N3. Smoke timing:** `goto` and `wait_for_function` each get the full `--timeout` (2 × 45 s), plus the settle time and the launch, against `RuntimeMaxSec=120`. A unit killed at 120 s prints no `SMOKE FAILED` line. Use one deadline across both, or pass `--timeout 40`.
- **N4. Smoke label:** a third-party failure plus our own page error gives exit 4 and the outage label (tested). That's harmless since 4 ≡ 1, but an operator may re-run instead of reading. List first-party causes first, or say "and N other causes".
- **N5. H1 lock:** git children inherit the deploy-lock fd 8. `atrium-deploy` closes 8 and 9 for its children, while H1 doesn't. A SIGKILLed H1 leaves the lock held until its git child exits. Append `8>&-` to `rgit`'s git call.
- **N6. `model-bridge.js`, latent double release:** `useEntry`'s not-wanted branch releases at L413, then `drop()` releases `record.key` again (L532; `record.key` was set at L406). It's unreachable today (nothing awaits between L298 and L413). Z2's hand-over must not add an await there, or it becomes a double release.
- **N7. P8 is incomplete:**
  - fixed listening ports missing from both the table and P8: 3991 and 3992 (`http-integration.test.js` `REG_PORT`), 9011–9020 (`autosave.test.js`), 9021–9025, 9030 and 9031 (`multi-world-mutation.test.js`), 9051 (`home-world.test.js`) and 9200–9203 (`commons.test.js`);
  - `client.test.js` uses `BASE_PORT` 4100 + N;
  - the corrected `AGENTS.md` wasn't attached, so I couldn't check it.
- **N8. Z6:** "stop and ask (AGENTS rule 1)". AGENTS.md's rule 1 is about SOP message structure.
- **N9. H4:** if DEV already runs `RELEASE_SHA` (for example after the H2 residual's host remedy), `atrium-deploy` takes its same-SHA path. It prints `DEV ALREADY AT TARGET_SHA=…`, with no `=== DEV DEPLOY SUCCESS ===`, so the finalizer blocks. Say which way H4 wants that.
- **N10. P1 nuance:** the guard requires one **distinct** 40-hex SHA with the title's prefix (`set(...)`); repeats are fine. H4's bodies pass either way.

## P-claims (P1–P10)
| Claim | Held? | How checked |
|---|---|---|
| P1 release path | **Held** (N10 nuance) | Read the gate, `atrium-deploy` (origin-branch check; `set-dev` records DEV and REVIEWED, per `commit_outcome`), `main-approve`/`main-push` (`is-ancestor` before the approval is written, and before it's consumed), and the guard's `STAGES` and `_ACTION` |
| P2 S1 aliases | **Held** | Probe, real `fetchModel` and `parseTemplate` (stub loader): 2 requests, `dependencies` keys `['./a.png']`, result `unsupported-image` |
| P3 S8 first requester | **Held** | Probe, real bridge: one fetch; removing A doesn't abort it; B ends `{"status":"loading","reason":"aborted"}` with 0 children on its host, and stays so after another `reconcile` |
| P4 S6 jobs not transfers | **Held** | Read `pump` L250–259, `loadTemplate` L344 (no queue) and the dependency loop L443–451 (sequential) |
| P5 S4 not disposed | **Held** | Probe: skinned template attached then removed. Placeholder geometry disposed 0 times, instance skeleton 0 times; the instance's `Skeleton` is distinct from the template's |
| P6 S3 residual | **Held** | Probe, real form plus `app.js` generation logic: after A settles, `checking=false` and Check is enabled mid-B; B ends `{"reason":"aborted","message":"the check was cancelled"}`, nothing held, A and B released |
| P7 N1 done | **Held** | `withTimeout` L811–823 clears the timer on both outcomes |
| P8 ports | **Partly** | The listed ports and 3117 are right, but the list is incomplete (N7) |
| P9 smoke would catch | **Held** | `check_public_client_assets` fetches four files. The smoke catches a startup throw through `pageerror` (N2) |
| P10 baseline | **Partly** | `apps/client` 585 ✓, renderer-three 202 ✓, interaction 9 ✓; **`packages/client` 302, not 292**, and nondeterministic with `--test-force-exit` (M1) |

## The first review's findings (§12): does Rev 2's answer hold?
| Finding | Holds? | Evidence |
|---|---|---|
| M1 failing diff | **Holds** | Extra case E3 injects `git diff` exit 128: 77, nothing pushed. No path reads git output before its status |
| M2 forged link | **Holds** | 27/27. Against the Rev 1 script, the 5 new or changed cases fail (reproduced). Reading `check_chain`, every commit on the first-parent path is re-derived; I found no bypass |
| M3 deadline | **Partly** | The queue semantics are now exact; shared-transfer timer ownership is open (S1) |
| M4 shared accounting | **Partly** | The ledger and its abort are fine; the per-model cap (M3) and redirect policy (M4) escape |
| M5 task states | **Partly** | The task map is right; the `parses` map is not covered (M2) |
| M6 admission on membership change | **Holds** | As written: wake on join and leave, recompute the earliest, Check-only snapshot at that moment. No deadlock found (a node waits only on earlier nodes) |
| S1 `main` moves after H1 | **Holds** | `atrium-main-approve` refuses (`is-ancestor`, exit 77) before writing an approval. `atrium-main-push` refuses before `rm -f "$APPROVAL"`. The remedy works with `atrium-deploy` (`WAITING_FOR_HUMAN_DEV_ACCEPTANCE` accepts `set-dev`) |
| S2 exit codes | **Holds**, with N1 | 75: fetch (E5), commit-tree (E6). 70: lease race on a new branch (E1), on a stack (E2), post-push fetch (E10), rejected push (case 14). A re-run after E10 recovers |
| S3 smoke not functional | **Holds**, with N2 | The real client passes; a page without a WebGL context fails |
| S4 CDN outage | **Holds** | A foreign 5xx or unreachable host gives 4; a foreign 404 gives 1 |
| S5 input validation | **Holds** | Credentials in the URL, `http://` off-host, `nan` and a negative settle each give 2 |
| S6 finalizer trusts the handoff | **Holds** | The guard's finalizer footer forbids host probing. `main-approve`/`main-push` require `require-dev` and DEV's live HEAD |
| N1 header, N2 local array | **Hold** | |

## Answers to the brief's scope questions, briefly
- **Z2/Z3 implementable and complete?** Implementable, but not complete: M2–M4, S1, S2, S4 and S5.
- **Stuck `loading`?** Yes, through the `parses` map (M2).
- **Reference released twice or leaked?** Not with S5 and N6 written in.
- **Limiter slot leak?** Only through the grant/abort race (S4).
- **W5 for every visitor?** Admission still holds (it waits only on earlier nodes; membership changes recompute). Transfer order no longer follows A4 (S2).
- **M3 = 30 s of own work?** Yes, except for shared transfers (S1).
- **Shared transfer and the 25 MiB cap, the 150 MiB ledger, A2?** The cap: yes, it escapes (M3). The ledger: no, if the transfer registers its own controller (S4). A2: yes, the redirect half escapes (M4).
- **Contradictions with §12 or r6?** A4's transfer order (S2) and dedupe scope (S3); M3's per-model budget (M3).
- **Any SHA to DEV, MAIN or PROD without H1's checks?**
  - The gate's `dev` always runs H1. `dev-force` and the operator's `atrium-deploy dev` don't, as stated.
  - MAIN requires `origin/main` to be an ancestor, so a SHA H1 didn't build can reach MAIN only if it already fast-forwards (today's behaviour).
  - PROD goes through `atrium-release-state require-prod` and the human approval. I couldn't read `atrium-release-state` through the connector.
  - No new hole.
- **`atrium-deploy` with a merge SHA?**
  - It works as for any SHA: `commit_block`, `rollback_core`, `PRE_DEV` and `recover` key on `TARGET_SHA` and the record, and `set-dev` records the release as DEV and REVIEWED.
  - A docs-only release changes no install or restart triggers, but every test still runs.
  - Issues found: S6 (order of refusals) and N9.
- **H4 and the guard?** They pass: one distinct SHA per stage body, one action per deployer card. MAIN and PROD run from the shell with `S=RELEASE_SHA`. The PROD block's gate and card titles then use the release's sha8 consistently, which the guard accepts.
- **H2 residual?** Handled as stated.
- **H3 hook?** It fits, with the shape in S8.

## Appendix: what was run
- **P10:** the four suites as in the table. `packages/client` per-file `# tests` with `--test-force-exit`, three runs each: `model-spec.test.js` gave 72, 97 and 38 (97 without the flag); all others were stable. Suite totals: 300, 274, 241 with the flag; 302, 302, 302 without.
- **`test-release-merge-REV2.sh`:** 27/27 against Rev 2; 22/27 against Rev 1 (the 5 new or changed cases fail).
- **`test-release-extra.sh`** (attached): a git wrapper injects faults (`sed` replaces `/usr/bin/git` in `rgit`). Ten cases: E1–E3, E5, E6 and E8–E10 pass; **E4 (N1) and E7 (S7) fail as reported.**
- **Gate snippet:** stubbed callees; exit codes 0→exec, 64, 70, 75, 77 and 143 all propagate; a missing `RELEASE_SHA` gives 70.
- **H3 shapes:** `atrium-deploy`'s `run` and ERR trap copied verbatim; the three shapes, each run with a smoke that passes at attempt 1, at attempt 2, or never.
- **Smoke:**
  - the real `apps/client/index.html`, with its esm.sh imports rewritten to local copies of the same versions (`three@0.163.0`, `@gltf-transform/*@4.3.0`): passes in about 5 s with a 401 session answer, fails on 502 (S9);
  - unmodified (esm.sh unreachable here): exit 4 with the outage label;
  - synthetic pages: no WebGL (1), an error after ready (1), foreign 404 (1), foreign 500 (4), foreign host down (4), mixed (4, N4), missing `#ep-model` (1), and a rejection handled 100 ms later (1).
- **Probes** (attached): `p3.mjs`, `p2p5.mjs`, `p6.mjs` and `cap.mjs`.
