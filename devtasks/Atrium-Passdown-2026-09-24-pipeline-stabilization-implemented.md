# Atrium / Hermes — Passdown: Pipeline Stabilization Implemented
# (runtime caps, retry limits, task-creation guard, orphan reaper)

**Date:** 2026-09-24 (UTC)
**Purpose:** Durable record of everything changed on the host while
implementing `Atrium-Hermes-Pipeline-Stabilization-Proposal-2026-09-24.md`,
what was verified live, where the proposal turned out to be wrong, what is
still open, and what to watch on the next pipeline run. Read alongside the
proposal and the Sept 12–17 passdowns; this extends them.

## Headline outcome

The proposal's core recommendations are live and enforced mechanically
rather than by prompt discipline alone. Every task on the `atrium` board now
gets a runtime cap. Release and gate stages fail closed after one failure
instead of respawning, and carry exact titles and SHA-scoped idempotency keys.
MAIN and PROD tasks cannot be created until the human's exact approval words
are recorded on the gate task. A root timer cleans up the processes and
containers that killed workers leave behind.

Each mechanism was tested on the live host before being relied on. Along the
way, three pre-existing problems turned up that the proposal did not know
about. Auto-decompose had never actually been turned off. Killed workers were
leaking processes and Docker containers. The orchestrator's `SOUL.md` still
told it to send MAIN to `atrium-deepseek` with a raw `git push`.

The first pipeline run under this setup, `worldload-address-sync`, was
released to DEV, MAIN and PROD at `e66d99be28320f310a740ff67b98898c77826d1e`
on 2026-09-27, all healthy; see section 7a.

Host: Hermes Agent v0.21.0 (2026.8.31), commit `5a0b1ba`, installed at
`/usr/local/lib/hermes-agent`. Release state at the start of this work was
`COMPLETE` at `9eab59f`; nothing in this work touched DEV, MAIN, or PROD.

## 1. Corrections to the proposal

These were verified against the installed Hermes source and the live board.

**`idempotency_key` deduplicates, it does not reject.** A second create with
the same key silently returns the existing task's id. The lookup runs outside
the write transaction, and the source comment admits a truly concurrent create
can still insert twice. Keys prevent re-creation; they do not make duplicates
structurally impossible. Archived tasks are excluded, so archiving a task frees
its key.

**The orchestrator cannot set `max_retries` through its tool.** The
`kanban_create` tool exposes `idempotency_key` and `max_runtime_seconds` but
not `max_retries`; only the CLI (`--max-retries`) can. No task on the board had
ever had a per-task `max_retries`. The `max_retries=2` the proposal saw on the
Bug A/B review tasks was the `kanban.failure_limit: 2` default, which
`hermes kanban show` displays as if it were per-task. The PROD recovery task
did not have `max_retries=1` set by hand either.

**`kanban_unblock` has no reason field,** which is why unblock events had
empty payloads. The CLI's `hermes kanban unblock <id> --reason "…"` records a
comment, but agents use the tool.

**Gate titles already had templates.** The orchestrator `SOUL.md` prescribed
`Awaiting DEV acceptance / main merge approval — <sha8>` and
`Awaiting PROD approval — <sha8>`, but actual titles drifted, for example
`Awaiting human DEV acceptance — Step 5 commons — 7eb29ba2`. The problem was
enforcement, not absence.

**Hermes has a `capability` block kind** ("a hard wall: no access, missing
credentials") that routes to a human instead of retrying. It was unused. It is
the in-run answer to finalizers that loop trying to reach the host from a
sandbox.

## 2. Pre-existing problems found and fixed

**Auto-decompose was never off.** The dispatcher runs inside the
default-profile gateway, so it reads `/root/.hermes/config.yaml`, not the
orchestrator's config. The Sept 12 fix set `auto_decompose: false` only in the
orchestrator profile, and the decomposer kept creating tasks, including
deploy and publication work on Sept 13 and 22.

It also works against the block-loop breaker: the breaker handles a
same-reason re-block by moving the task to `triage`, and the decomposer turns
triage tasks into new work. **Fix:** `kanban.auto_decompose: false` in
`/root/.hermes/config.yaml`. It is re-read every dispatcher tick, so no restart
was needed; the backup is `config.yaml.bak-20260924`. The other profiles'
configs still say `true`, which has no effect unless one of them runs its own
gateway.

**Killed workers leak processes.** The dispatcher's runtime-cap kill signals
only the worker's own pid. Terminal commands run in their own sessions and
background commands detach, so both outlive the worker. This was confirmed
live, and upstream HEAD has the same behavior. **Fix:** the reaper in section 4.

**All six profiles are on the Docker backend, and killed workers leak their
containers.** Hermes creates a container per worker process. A worker that
exits normally removes it, but one killed by the runtime cap does not, and
Hermes's own orphan cleanup only removes stopped containers. Three leaked test
containers were removed by hand (`hermes-044bd391`, `hermes-2922fc23`,
`hermes-7e37d624`). **Fix:** the reaper removes them automatically; see
section 4.

**The orchestrator `SOUL.md` still routed MAIN to `atrium-deepseek` with a raw
`git push origin <sha>:refs/heads/main`** in its "Human DEV acceptance"
section. That contradicted its own later sections, the Sept 17 passdown, and
the `atrium-workflows` skill, which all say `atrium-deployer` with
`atrium_deploy(action="main")`. **Fix:** see section 6.

**Stale tasks.** Twelve leftover tasks from completed releases were archived,
after `atrium-release-status` confirmed `COMPLETE` at `9eab59f`:

    t_7f08392f t_685c933f t_e5f1d9b4 t_bca122ad t_4642afb6 t_446d4d24
    t_6709cf19 t_7d8842b8 t_459536cb t_bccfe4bf t_11dce906 t_a0fa70dd

None had runtime caps, and caps cannot be added after creation. Two could
still have started on their own. `t_4642afb6` would have deployed the
superseded SHA `0b1fd07a` to DEV as the `default` profile. `t_bca122ad` was a
sentinel.

## 3. Verified live on the host

A dry-run ran on a disposable board (`atrium-stab-dryrun`, now archived).

- **Idempotency:** a second create with the same key returned the existing id
  (`t_396bf01a`), and after archiving, the same key created a new task. Five
  concurrent creates produced one task. That does not prove the race is
  impossible.
- **Runtime cap and retries:** a deliberately runaway `atrium-nemotron` worker
  (`t_eeaa7a33`, `--max-runtime 2m --max-retries 1`) was killed at exactly
  120 s. `gave_up` fired with `limit_source: task` and `effective_limit: 1`,
  and the task went to `blocked` with no respawn.
- **Leftover processes:** the same test showed the worker's background
  `sleep 900` and a foreground command surviving the kill. That led to
  section 4.
- **Reaper:** after tag forwarding was configured (section 4), a live test
  (`t_7ce05fad`) showed the reaper finding and clearing all three leftover
  processes inside the worker's container.

## 4. Installed: `hermes-kanban-reaper` (root timer, every minute)

**Files:**

    /usr/local/sbin/hermes-kanban-reaper                   the reaper (v2)
    /etc/systemd/system/hermes-kanban-reaper.{service,timer}
    /var/log/hermes-kanban-reaper.log                      one JSON line per action
    /run/hermes-kanban-reaper.json                         small state file
    /root/install-kanban-reaper.sh                         installer (install | test | enable | status | uninstall)

**Processes.** Every dispatched worker carries `HERMES_KANBAN_TASK`,
`HERMES_KANBAN_RUN_ID`, and `HERMES_KANBAN_DB`, and its commands inherit them.
Docker profiles only pass them into containers because
`terminal.docker_forward_env` now lists those three names on all six profiles;
this was set with `hermes -p <profile> config set`, which writes both
`config.yaml` and `.env`. A tagged process whose specific run ended more than
60 s ago gets SIGTERM, then SIGKILL after 5 s.

It never touches:

- untagged processes, which covers Telegram, CLI, and TUI sessions and the
  gateway;
- anything belonging to an `atrium-deployer` task, because a deploy's
  host-side SSH transport must never be cut;
- anything whose command line, or any ancestor's, mentions
  `/usr/local/sbin/atrium-`, `atrium-deploybot`, or `atrium_deploy`;
- any run it cannot confirm has ended.

**Containers.** Running Hermes containers (label `hermes-agent=1`) belonging to
`atrium-deepseek`, `atrium-glm`, `atrium-nemotron`, or `atrium-deployer`, and
older than 5 minutes, are removed when no Hermes process for that profile is
running at all, neither a worker nor a CLI/TUI session. `default` and
`atrium-orchestrator` containers are never removed, because the gateway and
interactive sessions use them.

**Check / operate:**

    bash /root/install-kanban-reaper.sh status          # timer, last actions, what it sees now
    /usr/local/sbin/hermes-kanban-reaper --dry-run      # what it would do, changes nothing
    bash /root/install-kanban-reaper.sh uninstall       # stop and remove (log kept)

If a new profile is added on the Docker backend, add the three names to its
`terminal.docker_forward_env`, or the reaper cannot see its leftovers.

## 5. Installed: `atrium-kanban-guard` Hermes plugin

**Files (v1.1.0):**

    /root/.hermes/plugins/atrium-kanban-guard/                          default profile
    /root/.hermes/profiles/<profile>/plugins/atrium-kanban-guard/       atrium-orchestrator, -glm,
                                                                        -nemotron, -deepseek, -deployer
    <profile home>/logs/atrium-kanban-guard.log                         decisions, one log per profile
    /root/install-atrium-guard.sh                                       installer (install | enable | status | disable)

It is enabled in all six profiles and acts only on the `atrium` board. It
uses `pre_tool_call` and `post_tool_call` hooks on `kanban_create` and
`kanban_unblock`, and a `transform_tool_result` hook on `kanban_show`. It
started in the default and orchestrator profiles only (v1.0.x); v1.1.0 added
the worker profiles because the `kanban_show` trimming must run where the
workers are. When it blocks a call, the message tells
the agent exactly what to fix. Internal errors are logged and fail open; the
host-side release gates still apply.

**Stage titles.** The body must contain the full lowercase 40-char SHA exactly
once. The guard canonicalizes the title and sets
`idempotency_key = atrium:<stage>:<sha>`.

| Title | Assignee | Requirement | Cap |
|---|---|---|---|
| `Publish workflow — <sha8>` | atrium-deployer | `action="publish"` + exact `workflow/<branch>` | 10 min |
| `DEV deploy — <sha8>` | atrium-deployer | `action="dev"` | 45 min |
| `DEV finalizer — <sha8>` | atrium-orchestrator | verify from handoff only | 10 min |
| `Awaiting DEV acceptance / main merge approval — <sha8>` | atrium-orchestrator | `initial_status="blocked"` | 10 min |
| `MAIN push — <sha8>` | atrium-deployer | `action="main"`, approval comment on gate | 10 min |
| `Awaiting PROD approval — <sha8>` | atrium-orchestrator | `initial_status="blocked"` | 10 min |
| `PROD deploy — <sha8>` | atrium-deployer | `action="prod"`, approval comment on gate | 30 min |

The SHA-scoped key replaces the old gate-scoped keys such as
`atrium-dev-deploy:<gate_id>:<sha>`. Two gates therefore cannot both create a
deploy chain for the same SHA, which was the Sept 15 duplicate race.
Redeploying a stage for the same SHA requires archiving the old task first,
which is deliberately a human decision.

**Other rules:**

- Assignees must be `atrium-*` (never `default`).
- Deployer tasks must use a stage title, request exactly one `atrium_deploy`
  action, and never mention `kanban_create`.
- Worker tasks (GLM, Nemotron, DeepSeek) may not mention `atrium_deploy` or
  be titled as a MAIN merge or push. The orchestrator is exempt, because its
  kickoff and gate bodies legitimately describe later deploy steps; this was
  narrowed in v1.0.1.
- Drifted `Awaiting …` or finalizer titles are refused.

**Human approvals.** Unblocking a human gate, or creating a `MAIN push` or
`PROD deploy` task, requires a comment on the gate task, newer than the gate
itself, starting `HUMAN APPROVAL:` and quoting the user's exact words:

    kanban_comment(task_id=<gate_id>,
                   body='HUMAN APPROVAL: "merge to main" (telegram, 2026-09-25T18:02Z)')

**Caps and retries.** A task without `max_runtime_seconds` gets one, based on
observed run durations; any cap the agent sets itself is kept.

- gates, finalizers, and sentinels: 10 min
- other orchestrator tasks: 30 min
- GLM and Nemotron: 45 min
- DeepSeek: 90 min
- deploy stages: as in the table

Stage tasks, gates, finalizers, and sentinels get `max_retries=1`. The plugin
writes this after creation, since the tool cannot pass it. Reviews and
implementation keep the default of 2. Every task body gets a short footer
of plain-prose operating notes: the runtime cap, call `kanban_show` only for
something not already in the startup context and never twice for the same
task, a `[truncated …]` marker does not mean missing instructions, and block
with `kind="capability"` when access is missing. Finalizers also get "verify
only from the parent handoff."

Footer history: v1.0.0 and v1.0.1 used a `---` separator and a bracketed
`[atrium-kanban-guard]` tag. On 2026-09-25, `atrium-glm` (`glm-5.3-flash`)
repeatedly treated its task bodies as "truncated" and re-read task cards
until its step budget ran out, on the brief (twice) and on Review A. That had
not happened on earlier runs with the same model, and the tag closely
resembles Hermes's own truncation marker. v1.0.2 therefore replaced it with
plain notes. Operator comments with the same guidance, followed by an
unblock or reclaim, got stuck tasks moving. The same misreading then hit
DeepSeek on a task still carrying the old footer, which pointed at
`kanban_show`'s duplicated startup context as the main trigger; see
"`kanban_show` trimming" above. v1.1.0 added a note on where git work happens. Its first wording ("the repo
is the shared checkout at `/workspace/atrium`; scratch folders are not git
repos") was wrong and was corrected in v1.1.1; see "Lost revision" below.

The observed durations behind the caps, in minutes (median / p90 / max, from
completed runs): gates 0.7 / 1.4 / 3.0; finalizers 0.4 / 1.0 / 3.3; publish
max 1.3; MAIN max 0.8; PROD max 2.4; DEV 1.1 / 18.7 / 63.1; GLM reviews
max 29.9; Nemotron reviews max 36.6; DeepSeek max 46.8.

**`kanban_show` trimming (v1.1.0).** `kanban_show` normally returns, besides
the task, a `worker_context` field: a full copy of the startup prompt, in
which long parent handoffs end in `[truncated, N chars omitted]`. On
2026-09-25 both `atrium-glm` and `atrium-deepseek` misread that copy as their
instructions having been cut off. They re-fetched cards until their step
budget ran out, and DeepSeek said so outright ("kanban_show is embedding the
huge prompt and truncating"). The guard now drops `worker_context` and
heartbeat events from `kanban_show` results. Nothing is lost: the worker got
that context at startup, and the full task body, `result`, comments, and
every run's summary and metadata remain in the result.

**Sentinel auto-link (v1.1.0).** When the orchestrator creates a review gate
or a `DEV finalizer`, the guard links it as a parent of the workflow's open
sentinel, and returns the sentinel to `todo` if it had blocked itself. Without
this, a sentinel whose parents had all finished re-launched an orchestrator
worker every minute or so; that happened twice on 2026-09-25 and was fixed by
hand with `hermes kanban link`. If more than one sentinel is open, the guard
links nothing and logs `sentinel_link_skipped`; link it by hand in that case.

**Lost revision (2026-09-25) and the v1.1.1 git note.** The shared checkout
`/workspace/atrium` (host: `/root/.hermes/sandboxes/docker/default/workspace/atrium`)
stayed on `main`, with leftovers from earlier steps (Step 5 commons files, a
2219cffc bundle, `.bak` files, and an old stash), until the 2026-09-27
cleanup reset it. Revision 1 (`t_9d2966cc`) was done, uncommitted, in a git
worktree in that task's scratch folder. When the task ended, the files were
gone and the scratch folder was empty. What removed them was never
established; containers do mount `/root` and `/workspace` from the host. The separate commit task (`t_5e3b4939`) then found
nothing to commit, and floundered.

The underlying flaw is that the pipeline hands *uncommitted* work between
tasks without saying where that work must live to persist. The operating
notes now say:

- never edit or commit in the shared checkout;
- do workflow-branch work in the persistent worktree `/workspace/wt-<name>`
  (host `/root/.hermes/sandboxes/docker/default/workspace/wt-<name>`);
- anything left uncommitted in a scratch folder or `/tmp` is lost when the
  task ends;
- review with read-only `git show`.

The redo of revision 1 was run in that worktree.

**Stale base (2026-09-26) and v1.1.2.** DEV testing found that
`workflow/worldload-address-sync` had forked from the shared checkout's
stale local `main` (`de26d8b`), not `origin/main`. It was therefore missing
the Step 5 hardening (`ce41ccd`, `0b1fd07`, `2219cff`) and Bug A/B
(`9eab59f`), and Bug A reappeared on DEV. The host's MAIN step would have
refused the non-fast-forward later, but DEV had already regressed. Fixes:

- The orchestrator `SOUL.md` now requires creating the branch from
  `base_main_sha` in the persistent worktree, and having the implementer
  confirm `git merge-base HEAD origin/main` before starting.
- The v1.1.2 git note says to start branches from a freshly fetched
  `origin/main`.
- v1.1.2 also tells gates that a "… sentinel" child is the notifier, not
  leftover work; this tripped a gate's retry.
- v1.1.2 narrows the worker title rule, so "Merge origin/main into
  <branch>" is no longer mistaken for a MAIN push.

A pre-brief decision (#2, rewrite auto-connect's "by design" comment) also
survived implementation and two revision rounds unchecked. The critique
stage and every review now do a decision-by-decision check against the
pre-brief, the reviews against the code.

**Minutes read as seconds (2026-09-26) and v1.1.3.** The contract listed the
default caps with a unit only on the first number ("10 min; … DeepSeek 90"),
and the guard kept any cap an agent supplied. The orchestrator passed 90,
meaning minutes, and the integration task was killed at 90 seconds, twice.
The retries redid the merge, and the task finished by committing its own
work. Since
v1.1.3, any cap below the default is raised to the default, which makes units
irrelevant. The contract now says to leave the cap unset. Caps already
stored on open tasks were corrected by hand, with a one-off SQL update.

**v1.1.4 (2026-09-27 cleanup).**

- Sentinel auto-link now matches only review and revision gates. "Supersede
  old DEV acceptance gate" had matched.
- `kanban_link` refuses to make a human gate a sentinel's parent. A sentinel
  must fire when DEV is ready, not after the human acts.
- A blocked orchestrator task whose title mentions acceptance or approval must
  use the canonical human-gate title. The finalizer's non-canonical gate had
  left the MAIN approval check nothing to find, so Hermes created and approved
  a new gate on the spot.
- New operating-note lines: `kanban_block`/`kanban_complete` without a
  `task_id` act on the worker's own card, and workers can only comment on
  other cards. Deployer tasks are also told that `atrium_deploy` is a deferred
  tool, to be found with `tool_search`, and never a shell command.
- The plugin now registers three hooks: `pre_tool_call`, `post_tool_call`
  and `transform_tool_result`.

**Check / operate:**

    bash /root/install-atrium-guard.sh status     # enabled state + recent decisions
    bash /root/install-atrium-guard.sh install    # rewrites files and reruns the 68-check self-test
    bash /root/install-atrium-guard.sh disable    # disables in all profiles, restarts gateway if idle

The guard needs no "allow tool override" permission, because it only uses
hooks. `enable` passes `--no-allow-tool-override`. That permission was
granted by accident on 2026-09-26 and then revoked.

## 6. Prompt changes

Applied with `/root/apply-atrium-soul-updates.py`. The script is idempotent,
edits only at anchored lines, and shows its diff before writing.

**`/root/.hermes/profiles/atrium-orchestrator/SOUL.md`** is committed in that
profile directory's local git repo (host-only; check `git remote -v`).

- MAIN now goes through `atrium-deployer` and `atrium_deploy(action="main")`,
  with an explicit ban on raw `git push`.
- MAIN and PROD first record the user's words on the gate.
- The DEV deploy, finalizer, and PROD steps use the stage titles.
- A new "Task-creation contract" section mirrors section 5.

**`/root/.hermes/SOUL.md`** (default profile, the Telegram front door) gained
a section to record approvals verbatim and route Atrium work only to
`atrium-*` profiles. It also gained front-door item 9: never assign pipeline
stages yourself, always hand off to an `atrium-orchestrator` kickoff, plus the
profile roster. That was added on 2026-09-25, after a fresh session asked the
user which profiles should write and critique the brief. Backups:
`SOUL.md.bak-<timestamp>`.

Hermes scans every `SOUL.md` for prompt-injection patterns and replaces the
whole file with a `[BLOCKED …]` notice if anything matches, so the agent would
silently run without it. All the text above passes that scanner. Recheck after
any future edit:

    cd /usr/local/lib/hermes-agent && PYTHONPATH=. venv/bin/python -c "from agent import prompt_builder as pb; [print(f, pb._scan_for_threats(open(f).read(), scope='context') or 'clean') for f in ('/root/.hermes/SOUL.md', '/root/.hermes/profiles/atrium-orchestrator/SOUL.md')]"

**`/root/.hermes/skills/devops/atrium-workflows/SKILL.md`:**

- Gate routing now names the stage titles and guard-set keys.
- "Finalizer closes Phase N Step N complete" became "reports DEV ready and
  STOPS at the human DEV acceptance gate." The old line contradicted the
  orchestrator `SOUL.md`.

Backup: `SKILL.md.bak-<timestamp>`.

**2026-09-27 wording, via the same script.** The orchestrator's critique and
review checks now require one line per consumer, call site or requirement
that a decision names, not one per decision. Default-profile front-door item
10: answer status questions from the board, never from conversation memory,
and never give the user `atrium_deploy` as a shell command. Both pass the
injection scanner. The orchestrator change is committed in its local repo.

## 6a. Asking Hermes for work: new feature vs revision

**New feature or step:** "kick off …" runs the full graph. GLM writes the
brief, Nemotron critiques it, DeepSeek implements, both review, and a gate
decides. Use it when there is new scope, or design questions are still open.

**Revision:** a DeepSeek revision, then GLM and Nemotron re-reviews, then a
gate, then the release chain. There is no brief or critique. Use it when the
*what* is already concrete: findings naming files and behaviors, against
pre-brief decisions that are already settled. A scope change that alters a
decision goes into the pre-brief first, with the owner's approval; after
that, it is a revision.

**Say which one you mean.** "Pre-PROD revision" matches the skill's section
of that name. "Fix X" alone leaves the orchestrator to guess. Template, with
the 2026-09-25/26 lessons built in:

> Pre-PROD revision <n> for <workflow>, from <source> on <current sha>. Hand
> this to an atrium-orchestrator kickoff; don't assign stages yourself.
> Nothing from <current sha> goes to main; DEV acceptance gate <gate id> will
> be superseded.
>
> Graph to build:
> 1. One atrium-deepseek task. It works only in the persistent worktree
>    /workspace/wt-<name> on workflow/<name>, starting from <current sha>, and
>    commits its own work, with no separate commit task.
>    a. git -C /workspace/atrium fetch origin main. If origin/main is not an
>       ancestor of HEAD, merge it first and run the full suite.
>    b. <each fix: files, functions, behavior, pre-brief decision #>.
>    c. Before completing, write a compliance table for each affected
>       decision: every consumer or requirement it lists, with the file:line
>       that implements it.
>    d. Full suite (server tests one file at a time). Commit, never push.
>       Report the tip SHA and the table, and confirm git merge-base HEAD
>       origin/main equals current origin/main.
> 2. GLM and Nemotron re-reviews of that tip SHA, verifying the table item by
>    item, and every other numbered pre-brief decision, with file:line.
> 3. A review gate on both. On dual approval of the same SHA: Publish
>    workflow, DEV deploy, DEV finalizer, and a new DEV acceptance gate.
>    Comment "SUPERSEDED by <new sha>" on the old gate, but create no task to
>    archive it; the operator archives it.
>
> This is a human-directed revision, not an automatic revision cycle.

Afterwards, archive the old gate yourself:
`hermes kanban --board atrium archive <old gate id>`. Workers cannot archive
other tasks. Do not push anything to main between the revision's merge and
the MAIN step; it would make MAIN a non-fast-forward.

## 7. Watch on the next pipeline run

**A few guard blocks early on are expected** while the orchestrator adapts to
the titles. The same block repeating is not; check
`bash /root/install-atrium-guard.sh status`.

**At DEV acceptance and PROD approval,** the agent should comment your exact
words on the gate before acting. If it cannot create the MAIN or PROD task,
that comment is what is missing.

**A timed-out task stays blocked** and is not retried. Diagnose it before
recreating anything, and for deploys follow the SOUL's deployment
timeout-and-recovery invariant.

**The reaper log should stay quiet** unless a task times out:
`tail /var/log/hermes-kanban-reaper.log`.

## 7a. First run under the new setup: `worldload-address-sync` (2026-09-25 to 27)

**Outcome.** Released at `e66d99be28320f310a740ff67b98898c77826d1e`. DEV,
MAIN and PROD were healthy, and the release state was `COMPLETE`. MAIN was
pushed by the operator with `atrium-main-approve` and `atrium-main-push`. PROD
was deployed by `atrium-deployer` after `atrium-prod-approve`, and the
recorded approvals quote the owner: "merge to main plz" and "Approved for
PROD".

**Path.**

1. The first graph ran brief, critique, implementation (`b9708f3`) and two
   reviews. Nemotron asked for changes.
2. Revision 1 was lost (see "Lost revision") and redone in the persistent
   worktree (`539c435f`). GLM then asked for changes, including a critical
   browser regression.
3. Revision 2 reached dual approval and was deployed to DEV.
4. DEV testing found the stale base (see "Stale base"). Pre-PROD revision 1
   merged `origin/main` and added the auto-connect scope change (`35b267ec`).
5. DEV testing then found ghost labels (pre-brief #9). Pre-PROD revision 2
   extracted a shared teardown function (`bac9622`). GLM found a HIGH race
   (a pending `disconnected` firing over a replacement connection), and one
   more cycle produced `e66d99be`, which was approved, deployed to DEV and
   accepted.

**Operator interventions**, each now covered by a fix above or listed in
section 8:

- GLM rereading loops on the brief and on Review A (comment, then
  unblock/reclaim);
- a gate wired to the wrong parent (manual `link`);
- the sentinel re-launching, twice (manual `link`);
- DeepSeek thrashing on a commit whose input was lost (stopped and
  inspected);
- a gate retry looping after the OpenRouter credits ran out (note, then
  unblock);
- a 90-second cap (SQL fix, then unblock);
- a supersede task that could not archive another card (operator `archive`);
- a finalizer that blocked itself (operator `complete`);
- a sentinel parented on the human gate (`unlink`);
- the MAIN deployer not loading its deferred `atrium_deploy` tool (operator
  ran the host helpers).

**What the new setup demonstrably caught.**

- Runtime caps bounded every runaway to its cap, where earlier runs burned
  150-step budgets.
- Stage titles and SHA-scoped keys held throughout.
- Human approvals were quoted before MAIN and PROD.
- Two workers hit real limits and blocked with `capability` in minutes
  instead of looping.
- Every task that committed its own work before finishing kept it. Uncommitted
  work was lost once (revision 1). The worktree folder under `/workspace` is on
  a persistent bind mount, but after the release something, most likely a
  worker tidying up, deleted it and left git's registration behind.
- After the `kanban_show` trimming, `glm-5.3-flash` (orchestrator and GLM
  reviewer) behaved well, including a long decision-by-decision review.

**What only the human caught**, with the process changes it prompted:

- the stale base: branch from verified `base_main_sha`;
- pre-brief #2's surviving comment and #9's missing `connecting` handler:
  decision-by-decision checks, which need to become per-consumer (see
  section 8).

## 8. Still open

**Post-run cleanup: done on 2026-09-27.**

- Guard v1.1.4, and the `SOUL.md` wording above.
- Board: archived the orphaned acceptance gates `t_57c8a234` and `t_0337d829`,
  and the obsolete "Post-merge finalizer — verify main == de26d8be"
  (`t_97085b6d`).
- Pruned the stale worktree registration for `wt-worldload-address-sync`.
- The shared checkout was reset to a clean, current `origin/main`. It was
  first backed up, without `node_modules`, to
  `/root/backups/shared-checkout-<date>.tar.gz`, and its old stash was kept.
  Its local `main` is no longer stale. It will drift again as `main` moves,
  which is why branches are created from a fresh `origin/main`.
- Removed the `default` container `hermes-2baed677`, which had been running
  since late August and shared the workspace involved in the Sept 15
  credential incident. Hermes creates a fresh one on demand.

**Still to do.**

- **Commit before completing; never delete worktrees.** Add these rules to the
  operating notes and the orchestrator `SOUL.md`. Code-changing tasks should
  commit their own work before completing, rather than handing uncommitted
  work to a separate commit task, which the workflow skill still describes.
  Workers should never remove worktrees; that is operator cleanup. The
  revision template in section 6a already asks for this.
- **Workers' advice to the operator.** Hermes twice told the operator to run
  `atrium_deploy action=… sha=…` "on the host". Default-profile item 10 and the
  deployer note now say it is never a shell command; the host commands are the
  `atrium-*` helpers in `/usr/local/sbin`. Watch that this holds.

**Concurrent-create race.** Truly simultaneous creates with the same key can
still double-insert. This is a Hermes source issue; the guard cannot fix it.
It is unlikely now that keys are SHA-scoped.

**The host approval helpers leave no log.** `atrium-main-approve` and
`atrium-prod-approve` record no history, and `/var/lib/atrium-release/state.json`
holds only the current state. Chat approvals are now recorded in Kanban.
Whether the helpers should append to a root-only log is an owner decision,
because they are part of the security boundary.

**Nemotron's non-completion rate.** 14 of its 40 review runs ended in
something other than `completed`. Not yet investigated.

**After any `hermes update`:** rerun `bash /root/install-atrium-guard.sh install`
(self-test) and `bash /root/install-kanban-reaper.sh test`. Both depend on
internals that an update could change: hook semantics, worker environment
tags, the kanban schema, and the Docker labels.

**Upstream issues worth reporting to Hermes:**

- the runtime-cap kill signals only the worker pid;
- killed workers leak running containers;
- `kanban_create` cannot set `max_retries`;
- `kanban_unblock` cannot carry a reason;
- auto-decompose is read from the dispatcher gateway's config, which is easy
  to miss.

## 9. Full rollback, if ever needed

    bash /root/install-atrium-guard.sh disable
    bash /root/install-kanban-reaper.sh uninstall
    git -C /root/.hermes/profiles/atrium-orchestrator log --oneline   # revert the SOUL commit if wanted
    # default SOUL.md and SKILL.md: restore from their .bak-<timestamp> copies
    # docker_forward_env: hermes -p <profile> config set terminal.docker_forward_env '[]'

Do not revert `auto_decompose: false` in `/root/.hermes/config.yaml`; turning
it off was the original Sept 12 decision, just applied to the wrong file.
