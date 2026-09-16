# Atrium — Orchestration & Release Workflow Passdown

**Date:** 2026-09-12 Pacific  
**Purpose:** Durable handoff for the Hermes multi-agent workflow, human gates, release state, and current Phase 2 Step 1 position.

## Standard workflow

1. `atrium-glm` drafts an implementation brief.
2. `atrium-nemotron` independently critiques/corrects it.
3. `atrium-deepseek` implements.
4. GLM and Nemotron perform independent sibling reviews.
5. Both must approve the same exact lowercase 40-character SHA.
6. If either requests changes, DeepSeek revises and both rereview.
7. Once both approve the same exact SHA, deploy that SHA to DEV.
8. Run DEV health/finalization.
9. Stop at human DEV acceptance.
10. Only explicit human authorization may merge exact reviewed SHA to `main`.
11. Stop again at PROD approval.
12. Only explicit human approval may deploy that exact SHA to PROD.
13. Only successful PROD health completes the feature/step.

Maximum automatic revision cycles: 3.

## Critical release-policy correction

The old orchestrator policy let the DEV finalizer “declare the overall workflow complete” after DEV health passed.

That caused Hermes to become eager to start Phase 2 Step 2 before the main/PROD release was finished.

This was corrected.

DEV success now means:
`WAITING_FOR_HUMAN_DEV_ACCEPTANCE`

The orchestrator must:
- report DEV readiness;
- say nothing has merged to main or deployed to PROD;
- stop;
- not begin the next feature/step.

## Human DEV acceptance gate

The following are NOT acceptance:
- DEV deploy success;
- automated health checks;
- silence;
- elapsed time;
- Kanban child completion;
- vague acknowledgments such as “okay”.

Only explicit wording authorizing the main merge, e.g.:
`merge to main`

may advance the exact reviewed SHA.

If manual testing finds a bug:
- do not merge;
- do not approve PROD;
- do not begin next step;
- return to diagnosis/revision/review.

## Main gate

After explicit human DEV acceptance:
- create/use exact-SHA main approval;
- perform only restricted fast-forward exact-SHA push;
- verify `origin/main == reviewed_sha`;
- enter `WAITING_FOR_PROD_APPROVAL`.

## PROD gate

PROD requires both:
1. host exact-SHA approval with `/usr/local/sbin/atrium-prod-approve <SHA>`;
2. explicit user authorization such as `approved` or `go ahead`.

After successful PROD deploy + health:
- state becomes `COMPLETE`;
- next feature/step may become eligible.

## Auto-decomposition change

For `atrium-orchestrator`:

`kanban.auto_decompose = false`

Reason:
Generic auto-decomposition caused blocked/triaged deployment work to spawn new retry/dependency tasks during operator remediation.

Atrium now relies on deliberate specialist task creation.

## Operator hold semantics

An explicit human/operator hold overrides:
- automatic retry;
- promotion;
- decomposition;
- progression.

A blocked task requiring remediation must not be auto-interpreted as permission to retry.

## Deployment timeout/recovery invariant

A tool timeout, lost worker, interrupted SSH, missing completion handoff, or Kanban timeout does NOT prove the host-side deployment ended.

Required behavior:
1. Never auto-retry immediately.
2. Query restricted deployment/status first.
3. If deploy lock is held, treat host deployment as still active.
4. Do not create replacement deploy tasks while prior host operation may still run.
5. If lock is free, inspect actual DEV/PROD SHA and health and compare with requested exact SHA.
6. Retry only after proving no prior deployment is active.
7. Never delete `/run/lock/atrium-deploy.lock`.
8. Human/operator hold always forbids automatic retry.

Prefer:
`/usr/local/sbin/atrium-release-status`

for compact investigation.

## Kanban principles

- Kanban is durable workflow state.
- Do not rely on private worker conversational memory.
- Important results belong in completion summaries/metadata.
- First-pass reviews remain independent.
- Carry exact reviewed SHA downstream.
- Never substitute HEAD, latest, branch tips, or abbreviated SHA.
- Escalate unresolved ambiguity/security/requirements conflicts.

## Current Phase 2 Step 1 state

Reviewed SHA:
`5d463097b8d63d1ae7ad50bb644f45706c6290bc`

Branch:
`fix/review-1a-findings`

Reviews:
- GLM APPROVE
- Nemotron APPROVE
- same exact SHA

DEV:
- exact reviewed SHA deployed successfully;
- automated health checks passed;
- manual testing revealed a bug that has not yet been characterized/resolved.

Current release state:
`WAITING_FOR_HUMAN_DEV_ACCEPTANCE`

Human acceptance is currently withheld because of the observed DEV bug.

Current MAIN:
`e7b99f8048f3a9841d02d45ea5929833f3fe03f3`

Current PROD checkout:
`3790109c726085e505394143c3e8c1380ac54107`

For current release:
- `main_sha = null`
- `prod_sha = null`

No main merge or PROD deployment is authorized.

## Immediate next workflow

1. Keep release paused.
2. Characterize DEV bug.
3. If code changes are needed:
   - brief/diagnose as appropriate;
   - DeepSeek implements;
   - GLM + Nemotron review;
   - require same exact reviewed SHA;
   - deploy new SHA to DEV;
   - health check;
   - resume manual testing.
4. After explicit acceptance, exact-SHA main transition.
5. Stop at PROD approval.
6. After explicit PROD approval, exact-SHA PROD deploy.
7. PROD health completes Phase 2 Step 1.
8. Only then begin Phase 2 Step 2.
