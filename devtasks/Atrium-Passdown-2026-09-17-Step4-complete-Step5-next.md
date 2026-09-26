# Atrium Passdown — 2026-09-17

## Purpose

This passdown is the clean starting point for the next ChatGPT session before beginning **Phase 2 Step 5 — The Commons**.

Phase 2 Step 4 is complete and fully released. The repository, Kanban board, and release pipeline have been cleaned up after the Step 4 workflow incidents. Do not reopen Step 4 unless new evidence shows a real regression.

---

## Canonical release state

**Phase 2 Step 4 — Visibility toggle + public routing**

- **STATE:** COMPLETE
- **REVIEWED:** `de26d8bee66b556368c54ac72125c8c08ff3fb8a`
- **DEV:** `de26d8bee66b556368c54ac72125c8c08ff3fb8a`
- **MAIN / origin/main:** `de26d8bee66b556368c54ac72125c8c08ff3fb8a`
- **PROD:** `de26d8bee66b556368c54ac72125c8c08ff3fb8a`

PROD deployment succeeded through the restricted host-side mechanism.

Post-deploy verification:
- local health: `{"status":"ok"}`
- public health: `{"status":"ok"}`
- PROD DB backup created before deployment:
  `/var/backups/atrium-prod/atrium-20260917T191917Z-4f8354552ca7.db`

Step 4 manual DEV testing also confirmed:
- `/public/marty/home` is accessible when the world is `public`
- `/public/marty/home` is denied when the world is `private`

---

## Current repository state

Shared Hermes Atrium checkout:

`/root/.hermes/sandboxes/docker/default/workspace/atrium`

Equivalent in the shared workspace used by workers:

`/workspace/atrium`

Current expected state:

- branch: `main`
- HEAD: `de26d8bee66b556368c54ac72125c8c08ff3fb8a`
- `origin/main`: same exact SHA
- working tree: clean
- no unreleased Step 4 work remains

Before cleanup, the checkout had 7 unstaged Step 4 files while local `main` was one commit behind `origin/main`. A read-only audit proved all 7 working-tree files were byte-for-byte identical to the released Step 4 tree, with no unique/unreleased work. The checkout was then safely reset to the exact released SHA.

Do not restore or reconstruct those old dirty files.

---

## Step 4 Kanban cleanup

All stale/superseded Step 4 residue was archived.

The board was verified to have:

- zero remaining blocked Step 4 release tasks
- zero remaining todo Step 4 release tasks
- zero remaining ready Step 4 release tasks

Do not resurrect old Step 4 tasks.

---

## Release workflow now in force

The intended release path is:

```text
brief
  -> critique
  -> implementation / revision
  -> commit exact candidate SHA
  -> independent GLM + Nemotron review of that exact SHA
  -> exact-SHA review gate
  -> restricted workflow publication
  -> DEV deployment
  -> DEV finalizer
  -> human DEV acceptance
  -> merge-sanity / current-main check if needed
  -> human exact-SHA MAIN approval
  -> restricted MAIN transition
  -> post-MAIN verification
  -> human exact-SHA PROD approval
  -> restricted PROD deployment
```

### Important review invariant

Both independent reviewers must approve the **same committed 40-character SHA**.

Do not review an uncommitted tree and later “transfer” approval to a commit merely because the tree is believed to be equivalent.

Step 4 exposed this weakness; it was repaired with fresh exact-SHA GLM and Nemotron reviews of:

`de26d8bee66b556368c54ac72125c8c08ff3fb8a`

Future steps should commit the candidate first, then perform the final dual review on that exact SHA.

---

## Restricted workflow publication

Reviewed workflow commits can be published without exposing GitHub credentials to Hermes coding/review sandboxes.

Path:

```text
atrium-deployer
  -> atrium_deploy(action="publish", sha="<exact-sha>",
                   branch="workflow/<exact-branch>")
  -> localhost restricted SSH key
  -> atrium-deploybot forced command
  -> /usr/local/sbin/atrium-deploy-gate
  -> /usr/local/sbin/atrium-publish-workflow
  -> GitHub
```

Important invariants:

- publication is restricted to `workflow/*`
- exact lowercase 40-character SHA required
- exact local workflow branch must already exist and point to that SHA
- existing remote workflow branch may only fast-forward
- no force push or deletion exposed through Hermes
- GitHub credentials remain host-root-only
- publication is automatic after final dual approval and before DEV
- publication is not a human release gate

Publisher repo:

`/var/lib/atrium-publisher/repo.git`

Do not replace this with raw sandbox `git push`, a PAT, or a sandbox SSH credential.

---

## Capability routing

Privileged release actions must be assigned by capability, not by model competence.

### Coding / review

- implementation / revision: `atrium-deepseek`
- architecture / intent review: GLM reviewer
- adversarial / correctness review: Nemotron reviewer

### Privileged release actions

- workflow publication:
  `atrium-deployer`
  via `atrium_deploy(action="publish", ...)`

- DEV:
  `atrium-deployer`
  via restricted `dev`

- MAIN:
  **must be `atrium-deployer`**
  via restricted exact-SHA:
  `atrium_deploy(action="main", sha="<exact-sha>")`

- PROD:
  `atrium-deployer`
  via restricted `prod`, after host-side human approval

### MAIN routing incident and fix

During Step 4, a MAIN task was incorrectly created with:

`assignee = atrium-deepseek`

That worker correctly failed because its sandbox had no GitHub credentials, but it should never have received the task.

The authoritative workflow skill was hardened:

`/root/.hermes/skills/devops/atrium-workflows/SKILL.md`

It now explicitly requires:

- MAIN transition tasks MUST be assigned to `atrium-deployer`
- MAIN transition tasks MUST NEVER be assigned to `atrium-deepseek`, GLM, Nemotron, or a generic/default sandbox worker
- merge-sanity gates creating a MAIN task must create it with:
  `assignee="atrium-deployer"`
- MAIN must use the restricted exact-SHA host path

This was verified against the real host-side skill file.

No GitHub credentials should be added to generic Hermes sandboxes.

---

## Host approval helpers

Existing trusted host-side approval helpers:

```text
atrium-main-approve <40-char-sha>
atrium-main-push <40-char-sha>
atrium-prod-approve <40-char-sha>
```

Operationally, Hermes uses the restricted deployer plugin/actions rather than raw Git from sandbox workers.

Human approvals are exact-SHA and short-lived.

MAIN and PROD remain explicit human gates.

---

## Main-drift policy

At feature kickoff, snapshot current `origin/main` as `base_main_sha`.

Keep `base_main_sha` distinct from the reviewed candidate SHA.

If `origin/main` changes before integration:

### A. unchanged
Normal fast-forward path.

### B. docs-only drift
If changes are limited to documentation such as:

- `README.md`
- `devtasks/**`

perform mechanical integration, prove runtime equivalence, rerun the appropriate tests, deploy the exact integration SHA to DEV, and require a fresh human gate.

Do not force a full code rereview merely because documentation moved.

### C. runtime/config/conflict/ambiguous drift
Hard stop for explicit integration/review.

After a release is COMPLETE, later docs-only movement on `main` does not rewrite the completed release state. The next feature simply starts from the current `origin/main`.

---

## Deterministic DAG rules

Avoid the workflow failures seen in earlier Phase 2 steps:

- pre-create deterministic continuation tasks whenever the next stage is knowable
- do not rely on a completed parent “waking up” the orchestrator
- keep sibling first-pass reviews independent
- keep publication and deployment as separate tasks
- maintain one live human gate for a given transition
- avoid duplicate review-gate or release chains
- if a task is superseded, downstream finalizers should reference the replacement task / exact SHA, not stale task IDs
- finalizers should verify actual Git/release state, not trust task narration alone

Ground truth is:

- Git refs
- exact SHA
- release status
- deployed service health

Do not trust a confident task summary when those disagree.

---

## Human-gate behavior lesson

Step 4 exposed an awkward interaction between:

- a `needs_input` blocker
- manual unblocking
- Hermes receiving the human approval in chat
- Kanban’s block-loop / triage behavior

This temporarily produced duplicate MAIN pipeline attempts.

For future steps, prefer one clean human-approval path and ensure exactly one downstream MAIN task becomes eligible.

Do not manually create extra MAIN pipelines when the original human gate is still in the process of resolving unless the original path is explicitly superseded first.

---

## Interactive SSH command safety

For command blocks intended to be pasted into a live interactive SSH shell:

Do **not** use top-level:

```bash
set -e
set -Eeuo pipefail
```

and do **not** use bare:

```bash
exit
exit 0
exit 1
```

as flow-control guards.

These have previously terminated or behaved unpredictably in the user's live SSH session.

Instead:

- use explicit `SAFE=yes` / `SAFE=no`
- put mutating actions behind an `if` guard
- on failed checks, skip mutations and print diagnostics
- if strict mode is needed, use a separate script or explicit subshell so failure does not terminate the parent SSH shell

This rule applies to human-pasted interactive command blocks, not to installed helper scripts.

---

## Existing deployment/security infrastructure — do not undo

The Atrium release helpers already contain earlier fixes for:

- static asset permissions
- public asset health checks
- same-SHA DEV refresh
- exact-SHA deployment
- release-state validation
- FF-only MAIN transition
- PROD exact-SHA validation
- host-side human approval
- no GitHub credentials in generic sandboxes

Do not replace or bypass these mechanisms unless there is concrete evidence they are broken.

---

# Next work: Phase 2 Step 5 — The Commons

Step 5 implements §6 of:

`devtasks/ADDENDUM-user-accounts-phase2.md`

The key design decisions are already fixed.

## Commons behavior

The Commons is retained as Atrium’s anonymous/walk-in shared space.

### Ownership

The Commons is owned by a **real normal Atrium account**, specifically the operator's account.

There is no special admin/privilege system.

The same owner-only mutation rule used everywhere else applies unchanged.

### Seed content

The current production shared world under the existing `WORLD_PATH` should be migrated/seeded into the Commons world row.

This should preserve the current shared-space content rather than replacing it with a blank home-world-style world.

### Lifecycle exception

Unlike ordinary personal worlds:

- ordinary worlds: create/load on first join; teardown after last session leaves and final save flushes
- Commons: load eagerly at server boot and never tear down

Reason: anonymous visitors need a reliable landing space without waiting for a cold world instance.

### Routing

The Commons resolves at the **bare root path**.

It should use the same multi-world registry/routing machinery introduced earlier in Phase 2.

Anonymous users should be able to enter it.

### Mutation authorization

The Commons does not get a special permission model.

Only the operator account that owns the Commons may perform real world mutations.

Anonymous visitors / non-owner users may view, move their own avatars, and later use teleporters, but not mutate canonical world state.

---

## Relevant Phase 2 sequence

Completed:

1. Multi-world hosting + owner-only mutation
2. Home world auto-create + auto-load
3. Auto-save
4. Visibility toggle + public routing

Next:

5. **The Commons**
6. Teleporter placement

Do not start Step 6 while implementing Step 5.

---

## Recommended fresh-session kickoff

In the new ChatGPT session:

1. attach or paste this passdown
2. provide the current `ADDENDUM-user-accounts-phase2.md`
3. optionally provide the current `DESIGN-user-accounts.md`
4. ask to begin Phase 2 Step 5 using the established orchestrated workflow

Suggested opening message:

> We are continuing Atrium Phase 2 development. The attached passdown is the canonical current state. Phase 2 Step 4 is COMPLETE in PROD at `de26d8bee66b556368c54ac72125c8c08ff3fb8a`. Please review the passdown and Phase 2 addendum, then help me begin Step 5 — The Commons — using the established Hermes orchestration/review/release workflow. Do not revisit completed Step 4 work unless the passdown identifies an unresolved issue.

