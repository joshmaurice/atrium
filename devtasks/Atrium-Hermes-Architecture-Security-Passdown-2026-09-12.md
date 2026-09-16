# Atrium / Hermes — Architecture & Security Passdown

**Date:** 2026-09-12 Pacific  
**Purpose:** Durable handoff for future ChatGPT/Hermes sessions. This document focuses on the Atrium repository topology, Hermes roles, trust boundaries, and restricted release/deployment architecture.

## Repository and runtime topology

Canonical repository:
- GitHub: `https://github.com/joshmaurice/atrium.git`

Shared authoring checkout:
- Host: `/root/.hermes/sandboxes/docker/default/workspace/atrium`
- Worker/container path: `/workspace/atrium`

DEV:
- Checkout: `/srv/atrium-dev`
- Service: `atrium-dev.service`
- Port: `3100`
- URL: `https://dev.5-78-232-73.sslip.io`
- DB: `/var/lib/atrium-dev/atrium.db`

PROD:
- Checkout: `/srv/atrium`
- Service: `atrium.service`
- Port: `3000`
- URL: `https://5-78-232-73.sslip.io`
- DB: `/var/lib/atrium/atrium.db`

Historical upstream mirror:
- `/root/atrium`
- Not the authoring tree and not the deployment tree.

## Hermes specialist profiles

### `atrium-deepseek`
Primary implementer/reviser. It writes code, runs targeted tests, reconciles findings, and prepares revisions.

### `atrium-glm`
Architecture, requirements, design-intent, integration, briefing, and review.

### `atrium-nemotron`
Independent/adversarial correctness reviewer: edge cases, regression risk, races, testing scrutiny.

### `atrium-orchestrator`
Workflow coordinator only. It should route Kanban work and enforce release gates, not implement code itself.

### `atrium-deployer`
Restricted release/deployment worker. It uses the custom deployment plugin and has no general host shell.

Supported release actions now include:
- `status`
- `dev <exact SHA>`
- `main <exact SHA>`
- `prod <exact SHA>`

## Worker-container safety

For `atrium-deepseek`, `atrium-glm`, and `atrium-nemotron`:

`terminal.docker_persist_across_processes = false`

This was changed because stale child Node/test processes survived timed-out/reclaimed workers.

Worker rules:
- Never background tests with `nohup`, `&`, `disown`, or `setsid`.
- Never switch the shared authoring checkout to historical revisions.
- Use `git show`, `git diff`, or temporary worktrees for historical comparison.
- Do not use `pnpm test -- <file>` for targeted tests because package scripts may still expand to the full suite.
- Prefer direct `node --test ... <specific-file>`.
- After a timeout, prove the old process is gone before starting another.

## Restricted deploybot boundary

Service account:
- `atrium-deploybot`
- home: `/var/lib/atrium-deploybot`
- shell: `/bin/bash`

Sudo:
- only `/usr/local/sbin/atrium-deploy-gate *` as root, passwordless.

SSH authorization:
- localhost only;
- `restrict`;
- forced command:
  `/usr/bin/sudo -n /usr/local/sbin/atrium-deploy-gate "$SSH_ORIGINAL_COMMAND"`

Deployer SSH key:
- `/root/.hermes/profiles/atrium-deployer/ssh/deploy_ed25519`

This preserves a narrow privilege boundary: the deployer cannot obtain a general host shell.

## DEV deployment bridge

Host helper:
- `/usr/local/sbin/atrium-deploy`

Gate:
- `/usr/local/sbin/atrium-deploy-gate`

Plugin:
- `/root/.hermes/profiles/atrium-deployer/plugins/atrium-deploy`

DEV helper behavior:
- exact 40-character lowercase SHA;
- global deploy `flock`;
- fetch origin;
- validate target reachability;
- online SQLite backup + integrity check;
- detached exact-SHA checkout;
- explicit dependency handling;
- bounded tests;
- conditional restart;
- local + public health checks;
- rollback code/DB on failure.

## PROD deployment bridge

Host helper:
- `/usr/local/sbin/atrium-deploy-prod`

Approval helper:
- `/usr/local/sbin/atrium-prod-approve <SHA>`

Approval properties:
- exact SHA;
- 15-minute TTL;
- one-time;
- SHA must be contained in `origin/main`;
- release state must be `WAITING_FOR_PROD_APPROVAL`.

The PROD helper uses the same global deploy lock and has backup/test/restart/health/rollback behavior.

## Restricted main fast-forward bridge

Helpers:
- `/usr/local/sbin/atrium-main-approve <SHA>`
- `/usr/local/sbin/atrium-main-push <SHA>`

Main approval requires:
- exact SHA;
- DEV currently runs the SHA;
- DEV service is active and healthy;
- SHA is a fast-forward descendant of current `origin/main`;
- SHA is reachable from an origin remote ref.

Main push:
- refuses while deployment lock is held;
- requires release state `WAITING_FOR_HUMAN_DEV_ACCEPTANCE`;
- requires matching one-time human main approval;
- rechecks DEV exact SHA and health;
- rechecks current `origin/main`;
- requires fast-forward ancestry;
- pushes exactly `<SHA>:refs/heads/main`;
- verifies `origin/main == SHA`;
- advances state to `WAITING_FOR_PROD_APPROVAL`.

The bridge was negative-tested end-to-end through the real deployer plugin:
- release-state validation passed;
- no human approval existed;
- bridge returned exit `77`;
- `origin/main` stayed unchanged.

A real main push has intentionally not yet been performed.

## Git credential boundary

Root/host Git already has a stored credential helper.

Do not print or expose stored Git credentials.

Coding/review workers do not need GitHub credentials. Root-owned restricted helpers perform validated pushes.

A dry-run push of reviewed SHA `5d463097b8d63d1ae7ad50bb644f45706c6290bc` to `main` succeeded and was fast-forward from `e7b99f8048f3a9841d02d45ea5929833f3fe03f3`.

## Durable release state

Helper:
- `/usr/local/sbin/atrium-release-state`

State:
- `/var/lib/atrium-release/state.json`

States:
- `UNINITIALIZED`
- `WAITING_FOR_HUMAN_DEV_ACCEPTANCE`
- `WAITING_FOR_PROD_APPROVAL`
- `COMPLETE`

Tracked fields:
- `reviewed_sha`
- `dev_sha`
- `main_sha`
- `prod_sha`
- `updated_at`

Successful DEV enters `WAITING_FOR_HUMAN_DEV_ACCEPTANCE`.
Approved main push enters `WAITING_FOR_PROD_APPROVAL`.
Successful PROD enters `COMPLETE`.

## Consolidated release status

Helper:
- `/usr/local/sbin/atrium-release-status`

It reports:
- release state;
- reviewed SHA;
- actual/recorded DEV SHA + health;
- actual/recorded MAIN SHA;
- actual/recorded PROD SHA + health;
- deploy lock;
- next action;
- mismatch warnings.

Current observed status:
- state: `WAITING_FOR_HUMAN_DEV_ACCEPTANCE`
- reviewed SHA: `5d463097b8d63d1ae7ad50bb644f45706c6290bc`
- DEV: same SHA, healthy
- MAIN actual: `e7b99f8048f3a9841d02d45ea5929833f3fe03f3`
- MAIN recorded: none
- PROD actual: `3790109c726085e505394143c3e8c1380ac54107`
- PROD recorded for this release: none
- PROD health: healthy
- deploy lock: free

## Security principles to preserve

1. Exact SHA everywhere.
2. No branch names/HEAD/latest commit for release actions.
3. No force-push.
4. Main updates are fast-forward only.
5. No general GitHub credentials for coding/review workers.
6. No general host shell for deployer.
7. Human acceptance gates remain explicit.
8. DEV, MAIN, and PROD are separate transitions.
9. Never delete a live deploy lock file.
10. Never bypass the restricted release path for convenience.
