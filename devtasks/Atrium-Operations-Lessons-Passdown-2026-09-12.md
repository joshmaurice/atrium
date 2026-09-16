# Atrium / Hermes — Operations & Lessons Learned Passdown

**Date:** 2026-09-12 Pacific  
**Purpose:** Operational handoff covering incidents, test/process gotchas, deployment failures, fixes, and diagnostics from Phase 2 Step 1.

## Persistent worker-process incident

Hermes workers originally used:
`terminal.docker_persist_across_processes: true`

This allowed child Node/test processes from timed-out/reclaimed workers to survive and contaminate later runs.

Observed:
- stale Node test processes;
- processes alive for hours;
- PID pressure;
- misleading evidence;
- worker interference.

Fix:
Set persistence to false for:
- `atrium-deepseek`
- `atrium-glm`
- `atrium-nemotron`

Old persistent worker containers were removed.

## Shared checkout safety

The shared authoring repo is mutable shared state.

Do not:
- checkout historical revisions into the shared checkout;
- restore old files into it for comparison;
- leave debugging debris.

Use:
- `git show`
- `git diff`
- temporary worktrees

## Targeted-test command trap

Do not assume:
`pnpm test -- <file>`

runs only one file.

Atrium package scripts may still expand to the full suite.

Prefer direct:
`node --test ... <specific-file>`

## Background tests are forbidden

Do not use:
- `nohup`
- `&`
- `disown`
- `setsid`

for tests.

After a timeout, prove the original process is gone before starting another.

## DEV deployment hang: multi-world mutation

Reviewed SHA:
`5d463097b8d63d1ae7ad50bb644f45706c6290bc`

Initial DEV deploys hung at:
`node --test packages/server/test/multi-world-mutation.test.js`

Direct diagnostic with `--test-force-exit`:
- 7/7 passed;
- 0 failed;
- exit 0;
- prompt completion.

Conclusion:
Open handles after assertions, not failing tests.

## Client-suite hang

After server hardening, deploy reached `@atrium/client` and hit the outer timeout.

Direct diagnostic:
`node --test --test-force-exit tests/*.test.js`

Result:
- 106/106 passed;
- 0 failed;
- about 1.28 s reported duration;
- exit 0.

Conclusion:
Also an open-handle-after-completion problem.

## Deployment-helper hardening

DEV now uses:
- bounded protocol tests;
- bounded SOM tests;
- per-server-test timeout;
- `--test-force-exit` for `reconnect-session.test.js`;
- `--test-force-exit` for `multi-world-mutation.test.js`;
- bounded client suite with `--test-force-exit`;
- bounded renderer-three;
- bounded interaction.

PROD was mirrored to the same structure and syntax-checked.

Defense in depth:
- `--test-force-exit` handles completed assertions with open handles;
- outer `timeout` handles true hangs.

## Deploy lock

Global lock:
`/run/lock/atrium-deploy.lock`

Uses `flock`.

Never delete the lock file while a process holds it.

Correct recovery:
1. identify actual holder;
2. inspect process tree;
3. let bounded deploy finish or deliberately terminate actual stuck process;
4. verify rollback/unwind;
5. verify status and lock release.

## Tool timeout does not imply host exit

A Hermes plugin timeout can occur while:
- SSH remains active;
- host deploy helper remains active;
- tests remain active;
- lock remains held.

So:
`tool timed out` != `deployment ended`

Always inspect actual host/release state before retrying.

## Rollback behavior

Observed rollback behavior worked correctly:
- checkout returned to prior SHA;
- service remained/restored healthy;
- DB backup retained;
- lock released.

## Auto-decomposer problem

With `kanban.auto_decompose=true`, blocked deployment work generated new deploy retry children before remediation was complete.

Fix:
`atrium-orchestrator` now has:
`kanban.auto_decompose=false`

## Release-state completion bug

Old orchestrator instructions treated DEV success as workflow completion.

Fix:
DEV success now means:
`WAITING_FOR_HUMAN_DEV_ACCEPTANCE`

Human DEV acceptance, main transition, PROD approval, and PROD success are separate gates.

## Useful operational commands

Release overview:
`/usr/local/sbin/atrium-release-status`

DEV status:
`/usr/local/sbin/atrium-deploy status`

PROD status:
`/usr/local/sbin/atrium-deploy-prod status`

Durable state:
`/usr/local/sbin/atrium-release-state show`

Lock inspection:
`lslocks | grep -i atrium`

Prefer targeted `ps`/`pstree` against actual deploy PID.

Avoid broad `pkill -f node`.

## Current deployment result

Reviewed SHA:
`5d463097b8d63d1ae7ad50bb644f45706c6290bc`

After hardening:
- DEV deploy completed;
- server restarted;
- local health passed;
- public health passed;
- follow-up health check verified API, client HTTP 200, auth lifecycle, and TLS.

Manual testing then revealed a DEV bug that remains uncharacterized.

Therefore:
- do not merge main;
- do not deploy PROD;
- do not begin Step 2.

## Current operational release status

Last observed:
- state: `WAITING_FOR_HUMAN_DEV_ACCEPTANCE`
- reviewed SHA: `5d463097b8d63d1ae7ad50bb644f45706c6290bc`
- DEV actual/recorded: same SHA
- DEV health: healthy
- MAIN actual: `e7b99f8048f3a9841d02d45ea5929833f3fe03f3`
- MAIN recorded: none
- PROD actual: `3790109c726085e505394143c3e8c1380ac54107`
- PROD recorded: none
- PROD health: healthy
- deploy lock: free

## Next investigation

Next substantive task:
characterize the user-observed DEV bug.

Capture:
- reproduction steps;
- expected behavior;
- actual behavior;
- browser/device if relevant;
- console/network/server evidence if useful.

If code changes are needed, route through normal brief → implementation → dual review → exact-SHA DEV deployment → manual acceptance.
