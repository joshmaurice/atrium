# Atrium Phase 2 Step 1 — Checkpoint v2

**Checkpoint date:** 2026-09-12 (Pacific time)  
**Purpose:** Concise authoritative “current state” handoff after the orchestration/release automation pass. Use this as the front-page summary; the three passdown documents contain the fuller architecture, workflow, and operations history.

## Current release state

Phase 2 Step 1 is **not complete**.

Current reviewed SHA:

`5d463097b8d63d1ae7ad50bb644f45706c6290bc`

Branch:

`fix/review-1a-findings`

Review status:
- GLM architecture/intent review: **APPROVE**
- Nemotron adversarial/correctness review: **APPROVE**
- Both approved the same exact SHA.

DEV:
- exact reviewed SHA successfully deployed;
- automated DEV health checks passed;
- DEV URL: `https://dev.5-78-232-73.sslip.io`;
- manual testing has revealed a bug that has **not yet been characterized/resolved**.

Therefore:
- **Do not merge to `main`.**
- **Do not deploy this release to PROD.**
- **Do not begin Phase 2 Step 2.**

Current durable release state:

`WAITING_FOR_HUMAN_DEV_ACCEPTANCE`

Current release-state fields:
- `reviewed_sha = 5d463097b8d63d1ae7ad50bb644f45706c6290bc`
- `dev_sha = 5d463097b8d63d1ae7ad50bb644f45706c6290bc`
- `main_sha = null`
- `prod_sha = null`

Current actual MAIN:

`e7b99f8048f3a9841d02d45ea5929833f3fe03f3`

Current actual PROD checkout:

`3790109c726085e505394143c3e8c1380ac54107`

PROD is healthy and unchanged by this release.

## Required release workflow

DEV success is only the human acceptance gate.

Correct sequence:

1. Required reviewers approve the same exact SHA.
2. Deploy that exact SHA to DEV.
3. Run DEV health/finalization checks.
4. **Stop and wait indefinitely for human DEV testing.**
5. Only an explicit user instruction such as **“merge to main”** authorizes the exact reviewed SHA to advance.
6. Main update must be exact-SHA, restricted, and fast-forward only.
7. After main is confirmed at that SHA, stop at the PROD approval gate.
8. PROD requires:
   - host exact-SHA approval;
   - explicit user authorization such as **“approved”** / **“go ahead”**.
9. Deploy only that exact approved SHA to PROD.
10. Run PROD health checks.
11. Only successful PROD deployment/health makes the step `COMPLETE`.
12. Only then may Phase 2 Step 2 begin.

The following never count as human DEV acceptance:
- successful DEV deploy;
- automated health checks;
- silence;
- elapsed time;
- completion of Kanban children;
- vague acknowledgments such as “okay”.

## Automation completed after the original checkpoint

### 1. Orchestrator release policy corrected

The old orchestrator policy incorrectly allowed the DEV finalizer to declare the overall workflow complete.

It now explicitly treats DEV success as:

`WAITING_FOR_HUMAN_DEV_ACCEPTANCE`

and requires:
- explicit main authorization;
- then separate PROD approval;
- only PROD success completes the feature/step.

### 2. Generic Kanban auto-decomposition disabled

For `atrium-orchestrator`:

`kanban.auto_decompose = false`

Reason:
Generic decomposition had created new deploy retries while operator remediation was still in progress.

### 3. Durable machine-enforced release state added

Helper:

`/usr/local/sbin/atrium-release-state`

State file:

`/var/lib/atrium-release/state.json`

States:
- `UNINITIALIZED`
- `WAITING_FOR_HUMAN_DEV_ACCEPTANCE`
- `WAITING_FOR_PROD_APPROVAL`
- `COMPLETE`

Successful DEV deployment automatically records the DEV-acceptance state.
Successful restricted main transition records the PROD-approval state.
Successful PROD deployment records `COMPLETE`.

### 4. Restricted exact-SHA main bridge built

Helpers:

`/usr/local/sbin/atrium-main-approve <SHA>`

`/usr/local/sbin/atrium-main-push <SHA>`

The bridge enforces:
- exact lowercase 40-character SHA;
- DEV currently runs that SHA;
- DEV health passes;
- one-time human main approval;
- short approval TTL;
- fast-forward relationship from current `origin/main`;
- exact push to `refs/heads/main`;
- post-push verification that `origin/main` equals the approved SHA.

The bridge is exposed through the restricted `atrium-deployer` plugin/gate.

It was negative-tested end-to-end:
- release-state check passed;
- no human main approval existed;
- push was denied with exit 77;
- `origin/main` remained unchanged.

A real main push has intentionally **not** been performed because the DEV bug has not been accepted.

### 5. PROD approval integrated with release state

`/usr/local/sbin/atrium-prod-approve <SHA>`

now requires:
- exact SHA;
- SHA contained in `origin/main`;
- durable state `WAITING_FOR_PROD_APPROVAL`.

PROD remains protected by:
- one-time exact-SHA approval;
- TTL;
- approval consumption before deployment;
- explicit user authorization.

### 6. DEV and PROD deploy helpers hardened

Known open-handle issues were diagnosed and bounded.

DEV and PROD helpers now use:
- bounded protocol tests;
- bounded SOM tests;
- per-server-test timeout;
- `--test-force-exit` for known open-handle server tests;
- bounded client suite with `--test-force-exit`;
- bounded renderer-three tests;
- bounded interaction tests.

Confirmed diagnostics:
- `multi-world-mutation.test.js`: 7/7 pass, exit 0 with force-exit.
- client suite: 106/106 pass, 0 fail, ~1.28 s reported duration, exit 0 with force-exit.

### 7. Deployment timeout/recovery policy added

The orchestrator now has an explicit invariant:

A Hermes/tool/Kanban timeout does **not** prove the host-side deployment ended.

When completion is ambiguous:
- never auto-retry first;
- inspect release/deployment state;
- if deploy lock is held, assume host operation may still be running;
- do not create a replacement deployment;
- if lock is free, inspect actual SHA and health;
- classify the prior attempt from concrete host state;
- retry only after proving no prior deployment remains active;
- never delete the live deploy lock file as a recovery method;
- explicit human/operator hold always forbids auto-retry.

### 8. Consolidated release-status command added

Helper:

`/usr/local/sbin/atrium-release-status`

Reports:
- durable state;
- reviewed SHA;
- DEV actual/recorded SHA + health;
- MAIN actual/recorded SHA;
- PROD actual/recorded SHA + health;
- deploy-lock state;
- next required action;
- mismatch warnings.

Last observed status:
- state: `WAITING_FOR_HUMAN_DEV_ACCEPTANCE`
- DEV: reviewed SHA, healthy
- MAIN: `e7b99f8048f3a9841d02d45ea5929833f3fe03f3`
- PROD: `3790109c726085e505394143c3e8c1380ac54107`, healthy
- deploy lock: free
- next action: human DEV testing

## Worker/container lessons still in force

For:
- `atrium-deepseek`
- `atrium-glm`
- `atrium-nemotron`

`terminal.docker_persist_across_processes = false`

Workers must:
- never background tests;
- never switch the shared authoring checkout to old revisions for comparison;
- use `git show`, `git diff`, or temporary worktrees;
- avoid `pnpm test -- <file>` for targeted Atrium tests;
- use direct `node --test ... <specific-file>`;
- not start another test while a timed-out prior process may still be alive.

## Restricted release boundary

`atrium-deployer` reaches privileged release actions only through:

deployer plugin  
→ localhost SSH as `atrium-deploybot`  
→ forced command  
→ `sudo /usr/local/sbin/atrium-deploy-gate ...`

The deploybot:
- is localhost-only;
- has no general privileged shell path;
- may sudo only the deploy gate.

Do not bypass this chain for convenience.

## Immediate next substantive task

The next task is to investigate the user-observed DEV bug.

Capture:
- exact reproduction steps;
- expected behavior;
- actual behavior;
- browser/device context if relevant;
- console/network/server evidence if useful.

If the bug requires code changes:
1. diagnose/brief as appropriate;
2. DeepSeek implements;
3. GLM + Nemotron review;
4. require approval of the same exact new SHA;
5. deploy that exact SHA to DEV;
6. rerun automated health checks;
7. resume human manual testing.

Do **not** merge main, approve PROD, deploy PROD, or start Phase 2 Step 2 until the bug is resolved and the user explicitly accepts DEV.

## Companion passdown files

For full detail, use these alongside this checkpoint:

1. `Atrium-Hermes-Architecture-Security-Passdown-2026-09-12.md`
2. `Atrium-Orchestration-Release-Workflow-Passdown-2026-09-12.md`
3. `Atrium-Operations-Lessons-Passdown-2026-09-12.md`

This v2 checkpoint is intended to be the concise authoritative front page; the three passdowns contain the deeper context and lessons.
