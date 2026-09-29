# Atrium / Hermes — Passdown: Cross-Server Connect (Step 6) Shipped
# (first full run under the stabilized pipeline, what broke, what was fixed by hand)

**Date:** 2026-09-28 (UTC)
**Purpose:** Durable record of how addendum Step 6 (cross-server world
loading) went from pre-brief to PROD, every place the pipeline needed a human
to intervene and why, the host changes made along the way, corrections to
earlier passdowns, and the prioritized follow-up list. Read alongside
`Atrium-Passdown-2026-09-24-pipeline-stabilization-implemented.md` (§7a covers
the previous run, worldload-address-sync).

## Headline outcome

Step 6 is on `main` and live on DEV and PROD at
`2fbcaf40add7761734a5f90d9622a7e67bbe7f68`. `atrium-release-status` reports
`COMPLETE`, with DEV, MAIN and PROD actual and recorded all equal to that SHA
and both servers healthy. DEV acceptance (Part A) and the post-PROD
cross-server checks (Part B) all passed, partly by the operator and partly by
Hermes driving a browser with throwaway DEV accounts.

The code needed three revision rounds and a test fix. The pipeline around it
needed human intervention at almost every stage, but the interventions were
different in kind from the previous run: this time the safety mechanisms
(guard titles, review gates that block instead of improvising, the host
release state machine) mostly worked, and the failures came from agents
improvising around them, from the container layout, and from test hygiene.

The actual implementation took DeepSeek about 17 minutes. Operating the
pipeline around it took most of a day.

## 1. What shipped

Branch `workflow/cross-server-connect`, fast-forwarded onto `main` from
`426b8c7` (the operator's upload of the Rev 5 pre-brief and renumbered
addendum). Commit history, oldest first:

- `8fe7144`..`24717e3` — original implementation, 7 commits (D3, D4, D2, D9,
  D10, D1/D5/D7/D8, D11), branched from the stale base `1f759ce`.
- `363d10d` — operator merge of `origin/main` (426b8c7) into the branch.
- `87160d1` — operator redo of the D11 addendum commit against the
  renumbered addendum (text written in chat against pre-brief #11).
- `559c061`..`f8362d4` — revision 1: #4 event contract, #2
  `isSameOriginUpgrade` / `resolveUpgradeUserId` at all five call sites, #9
  avatar-name `set` guard, #10 hygiene, #1/#5/#7/#8 app changes.
- `838a066`..`cf1bb34` — revision 2: F1 server never adopts client hello
  name, F2 timeout-path order, F3 `trackConnect` keyed by sessionId, F4
  toolbar branch removed, F5 `_onServerHello` updates avatar descriptor, F6
  tests and `resolveUpgradeUserId` reusing `resolveWsUserId`.
- `87f50cc` — revision 3, tests only (cross-origin-with-cookie cases,
  owner-policy set guard, `trackConnect` isolation, A→B→A).
- `2fbcaf4` — operator test fix: the new owner set-guard test in
  `avatar.test.js` now calls the `closeKeepalive` function returned by
  `attachSessionHandlers` and closes its servers (see §3.6).

The addendum at `2fbcaf4` has the full §7 section and §8's destination rules;
the pre-brief is `devtasks/PREBRIEF-cross-server-connect.md` Rev 5.

## 2. Timeline in brief

1. Kickoff built brief → critique → implementation → commit task → two
   reviews → gate → release chain. The orchestrator told the implementer to
   branch from `1f759ce`, the "test baseline" quoted in pre-brief §2.1,
   instead of freshly fetched `origin/main`.
2. The implementer's first run correctly blocked on the merge-base check. The
   front-door (Telegram) Hermes unblocked it with a comment reinterpreting the
   check. The implementation was built on the stale base, and the implementer
   never had the pre-brief in its tree (it didn't exist at `1f759ce`).
3. The separate commit task looped for over 20 minutes: its worktree folder
   didn't exist (§3.1), and it spent the time probing environment variables.
4. Operator blocked the commit task and archived the two reviews. Archiving
   the reviews made the round-1 gate ready; it ran, found no verdicts, and
   recreated the reviews plus a new gate. Front-door Hermes unblocked the
   operator's block of the commit task ("blocked without giving a reason").
   Lesson: archive bottom-up, and agents currently don't respect human blocks.
5. Operator merged `origin/main` and redid D11 on the host (`87160d1`).
6. Round-1 reviews of `24717e3`: GLM CHANGES_REQUIRED with a thorough,
   correct decision-by-decision list. Nemotron APPROVED using a misnumbered
   decision list and SameSite reasoning the pre-brief explicitly rejects.
   Code greps confirmed GLM on every disputed point.
7. Revisions 1–3 as in §1. From revision 1 on, the gates behaved correctly:
   on CHANGES_REQUIRED or a missing verdict they blocked and created nothing.
8. Revision 3's Nemotron review failed twice for infrastructure reasons
   (§3.3); after a container reset it approved.
9. DEV deploy of `87f50cc` failed with exit 124 and rolled back cleanly
   (§3.6). Operator committed the test fix as `2fbcaf4`.
10. A light re-review of `2fbcaf4` (no implementation task). The kickoff
    couldn't record its own completion (§3.7); the gate used a 7-character
    SHA in titles and the guard rejected them (§3.8). After operator fixes,
    the chain ran and DEV deployed `2fbcaf4`.
11. DEV acceptance. Early operator results looked like bugs (no failure
    messages, a disconnect, duplicate avatars); they were a stale cached
    client (§3.9). Hermes, with a fresh browser profile, confirmed the new
    behavior.
12. MAIN and PROD via the host scripts (§3.10, §3.11).

## 3. Incidents and root causes

### 3.1 Worktrees don't persist (correction to the 2026-09-24 passdown)

Every Atrium profile mounts only
`/root/.hermes/sandboxes/docker/default/workspace/atrium` → `/workspace/atrium`
(`terminal.docker_volumes` in each profile's `config.yaml`). `/workspace`
itself is **not** mounted. A worktree at `/workspace/wt-<name>` lives in the
container's own filesystem and disappears when the container is removed.
`container_persistent: true` does not cover it.

Consequences seen this run and last: committed work survives (commits and
the worktree registration live in `/workspace/atrium/.git`, on the host);
uncommitted work is lost (worldload revision 1); a separate "commit" task can
never see the implementer's worktree; git on the host always reports these
worktrees as `prunable`, because the host has no `/workspace`. Never run
`git worktree prune` from the host for that reason.

The 2026-09-24 passdown's statement that the worktree folder "is on a
persistent bind mount", and the guard's operating note calling it the
"persistent worktree", are both wrong.

The same missing mount broke Nemotron's terminal in revision 3 (§3.3) and made
every worker recreate the worktree.

### 3.2 Stale base, and an agent overriding a safety check

The orchestrator picked the base SHA by reading one out of the pre-brief. The
implementer's merge-base check caught it and blocked; the front-door Hermes
talked it out of the block. The check did its job and was defeated by another
agent's judgment. See follow-ups F-2 and F-3.

### 3.3 Nemotron: unreliable reviews and a free-tier endpoint

- Round 1: approved against a misnumbered decision list, with reasoning that
  contradicted the pre-brief's central security argument.
- Revision 1: "confirmed" GLM's verdict by summarizing it; GLM had posted its
  findings on the shared parent task, which Nemotron reads at startup.
- Revision 3, run 1: did the work, then died on OpenRouter "Upstream error
  from Nvidia: Service temporarily overloaded" (the `:free` Nemotron SKU),
  exiting without a terminal kanban call.
- Revision 3, run 2: found the worktree missing, ran `git worktree remove
  --force` despite the note, recreated it, `cd`'d into it; the folder vanished
  again and the container's exec cwd pointed at a nonexistent path, so every
  terminal command failed. Fixed by removing the Nemotron containers and
  unblocking.

GLM's reviews were accurate throughout; its test counts matched independent
runs exactly (e.g. 15 server files, 272 tests at `2fbcaf4`).

### 3.4 The round-1 gate recreated reviews

With its parents archived, gate `t_841fc62e` became ready, found no verdicts,
and created a new review pair and a new gate. Fixed by instruction from
revision 1 onwards ("if a verdict is missing, block for me; create
nothing"); every later gate obeyed. It should become a rule, not a per-request
instruction (F-4).

### 3.5 Reviewers ran tests differently from the deploy

Both reviewers ran server tests with `--test-force-exit` on every file. The
deploy script (`/usr/local/sbin/atrium-deploy`, same pattern in
`atrium-deploy-prod`) runs each server test file under a 180 s `timeout`,
with `--test-force-exit` only for `reconnect-session.test.js` and
`multi-world-mutation.test.js`. So a test that passes but leaves a handle open
passes review and fails the deploy.

### 3.6 DEV deploy exit 124: a leaked keepalive in a new test

`attachSessionHandlers` starts a keepalive `setInterval` and returns a
`closeKeepalive` function. Revision 3's new owner set-guard test in
`avatar.test.js` discarded it, so Node never exited after all 7 tests passed;
the deploy's `timeout 180s` killed it (the deploy tool call took 185.8 s),
and the deploy rolled back to `e66d99b` with a DB backup, correctly, without
retrying. `atrium-dev.service` had no journal entries: the failure was in the
test phase, not the restart or health check, whatever the deployer's summary
guessed.

Reproduced in a Claude sandbox against the published branch (before: exit
124; after the fix: 7/7 in 2 s), and the full deploy test sequence was run
the way the script runs it: every file passed and exited on its own.
`multi-world-mutation.test.js` has the same discarded-`closeKeepalive`
pattern, which is why it's on the force-exit list (F-9).

### 3.7 Slow orchestrator, and `kanban_complete` dropping arguments

The test-fix kickoff's model (`z-ai/glm-5.3-flash`, a paid OpenRouter model)
took 443 s and ~16k output tokens for one step. It then built the graph
correctly but `kanban_complete` failed six times with arguments dropped, so it
recorded its handoff as a comment and blocked. The gate had the kickoff as a
parent, so the operator had to complete the kickoff by hand. The same session
reported that `kanban_create` bodies and `parents` were silently lost at
creation; it re-posted instructions as comments and re-linked parents.

### 3.8 `<sha8>` means 8 characters

The guard requires stage titles like `Publish workflow — <sha8>`, where
`<sha8>` is the first **8** characters (`2fbcaf40`). The gate used `2fbcaf4`
(7), taken from the operator request's shorthand, and every `kanban_create`
was rejected. Fixed with an operator comment giving exact titles, then
unblock. Requests should always quote the 8-character prefix.

### 3.9 Stale client JavaScript in browsers

Neither Caddy site sent `Cache-Control` for static files, only ETag and
Last-Modified, so browsers applied heuristic caching and could run old or
mixed-version client modules (`app.js`, `wsUrl.js` and the client library are
separate files). Symptoms during acceptance: no failure messages (the old
client shows only the status dot), an unexpected disconnect, the user's own
avatar drawn as a peer, and a ghost session. With a fresh browser profile
(Hermes) none of it reproduced, across three runs. Fixed on the host (§4.1).

A second confound to remember from Sept 1: two users in tabs of the *same*
browser share one cookie jar. Use separate browsers or containers for
multi-user tests.

### 3.10 MAIN: the deployer can't push without host approval, by design

Hermes created a MAIN task, which was refused with exit 77, "DENIED: no active
human main approval". The procedure is the Sept 16 one: the operator runs, back
to back on the host,

```
atrium-main-approve <sha>
atrium-main-push <sha>
atrium-release-status
```

then archives the MAIN task. Hermes then claimed MAIN had not happened
(because the task was archived) and suggested `atrium_main_approve` /
`atrium_main_push` (underscores, not real commands). `atrium-release-status`
is the source of truth, not the task history.

### 3.11 PROD: the deployer called `atrium_deploy` four times

After `atrium-prod-approve` and completion of the approval gate, the deployer's
first `atrium_deploy(action="prod")` (31.4 s) succeeded and set the release
state to `COMPLETE`. The worker then appeared to lose track of the result and
called it three more times; each was refused in 0.6 s ("release state is
'COMPLETE', expected WAITING_FOR_PROD_APPROVAL"). It blocked as if the deploy
had failed. The host state machine prevented any harm. Operator commented and
completed the task.

## 4. Host changes made this run

### 4.1 Caddy: `Cache-Control: no-cache` on static files (DEV and PROD)

In `/etc/caddy/Caddyfile`, `header Cache-Control "no-cache"` was added after
each of the six `root * /srv/atrium…` lines (the `/apps/client/*`,
`/tools/protocol-inspector/*` and `/packages/*` handlers for both sites),
validated with `caddy validate`, and applied with `systemctl reload caddy`.
Backup: `/etc/caddy/Caddyfile.bak-cache-control-<timestamp>`. Verified with
`curl -I` on `app.js` and `AtriumClient.js` on both hosts. Browsers still
cache, but revalidate every load (cheap 304s via ETag), so deploys reach users
immediately.

### 4.2 Test accounts on DEV

Hermes created throwaway accounts `acctest1` and `acctest2` on DEV only, with
random passwords it holds. Keep them for a future browser smoke stage, or
delete them.

### 4.3 No other host configuration was changed

The mount fix (F-1) was designed but deliberately not applied mid-run.

## 5. Operator techniques that worked

**Committing on a workflow branch from the host, safely.** Create a detached
temporary worktree at the expected SHA, commit there, then move the branch
only if it hasn't moved:

```
NEW=$(git rev-parse HEAD)                 # computed inside the temp worktree
git -C $SC update-ref refs/heads/$B $NEW $OLD
```

Don't write `git -C $SC update-ref … HEAD $OLD`: with `-C $SC`, `HEAD` is the
shared checkout's HEAD, not the temp worktree's, which would silently move the
branch to stale `main`. (Caught in simulation before use.)

**Reading the code at a SHA without a worktree:** `git -C $SC grep -n -E
'<pattern>' <sha> -- <paths>` and `git -C $SC show <sha>:<path>`.

**Kanban CLI** (verified syntax):

```
hermes kanban --board atrium list
hermes kanban --board atrium show <id>
hermes kanban --board atrium comment <id> '<text>'
hermes kanban --board atrium block <id> --kind needs_input "<reason>"
hermes kanban --board atrium block <id> --kind dependency "<reason>"   # waits in todo, auto-promotes when parents finish
hermes kanban --board atrium unblock <id>
hermes kanban --board atrium complete <id>
hermes kanban --board atrium archive <id>
hermes kanban --board atrium reclaim <id>                             # release a running worker's claim
```

Archive children before parents: archiving a parent can make a child
(gate, sentinel) ready. Blocking a task doesn't necessarily stop its running
worker; check with
`grep -l 'HERMES_KANBAN_TASK=<id>' /proc/[0-9]*/environ`. Word operator
blocks explicitly ("OPERATOR BLOCK: do not unblock…").

**A stuck container** (exec cwd pointing at a vanished path): with no worker
running for the task, `docker ps -aq --filter
label=hermes-profile=<profile> | xargs -r docker rm -f`, then unblock.

**Hermes browser tool.** Enabled for the CLI and Telegram platforms, running
locally (agent-browser; no Browserbase key configured). It works: it drove the
DEV client, created accounts, and ran multi-session checks. Its fresh profile
also removes cache and cookie-jar confounds. Keep cross-origin cookie checks
human.

## 6. Follow-ups, in priority order

**Status 2026-09-29:** F-1 to F-7 and F-9 are done; see §8. One correction to F-4 as written below: automatic revision cycles (up to 3) were kept for normal runs. Only a missing or archived review always blocks, and human-directed workflows block on CHANGES_REQUIRED. F-8 and F-10 to F-14 remain open.

**F-1. Make worktrees persistent.** Done; see §8.1 for what was actually built (the mount is in all five profiles, not only DeepSeek's).

**F-2. Base = freshly fetched `origin/main` at kickoff, always.** Never a SHA
quoted from a pre-brief. Ideally computed by a host script, not chosen by an
agent.

**F-3. Agents never unblock a task a human blocked,** and a failed
merge-base/base check always goes to the human. Put it in the front-door and
orchestrator `SOUL.md`, and enforce it in the guard if the block's source is
detectable.

**F-4. Gates never create reviews or revisions.** A missing verdict or
CHANGES_REQUIRED blocks for the operator. Make it the standing gate rule.

**F-5. Reviewers run tests the way the deploy does** (per-file, 180 s
timeout, `--test-force-exit` only for the two listed files) and report each
file exiting on its own. Reviewers post verdicts only on their own task.

**F-6. Remove the separate commit task** from the workflow skill; the
implementer commits its own work.

**F-7. Guard: one `atrium_deploy` call per deploy task.**

**F-8. Replace or re-home the Nemotron reviewer.** It was unreliable in
content and availability (free SKU). Consider a paid model or a different
second reviewer; GLM was consistently accurate.

**F-9. Fix `multi-world-mutation.test.js`'s discarded `closeKeepalive`** (and
check `reconnect-session.test.js`), then remove both from the deploy scripts'
force-exit lists, so every server test file must exit on its own.

**F-10. Browser smoke stage after DEV deploy.** A fixed script (not an agent
session) with a fresh profile: page loads without console errors; DNS and
timeout failures show a message naming the host; two sessions see each other
exactly once with correct names.

**F-11. Cost check.** The orchestrator runs `z-ai/glm-5.3-flash` (paid), and
the auxiliary client logs "PAID lane engaged". Review OpenRouter usage; consider
`auxiliary.free_only: true`.

**F-12. Client UX.** No way to cancel a pending connect (Connect is disabled for
up to 15 s). When connected, the button is "Disconnect", so connecting
elsewhere from the World box takes two clicks, which confused an automated
tester. Consider a Cancel, or letting Connect switch worlds directly.

**F-13. Cross-site pair check** (a second hostname under a different domain)
from pre-brief §6 wasn't run; it's covered by the `Origin` tests, and the
same-site DEV↔PROD pair, the harder case, passed.

**F-14. The larger redesign.** Most of this run's interventions came from
agents improvising on plumbing (base selection, unblocking, recreating tasks,
repeated deploy calls). The durable fix is to move plumbing into host scripts
(branch/worktree setup, test runs, SHA recording, gate decisions) and keep
LLM judgment for briefs, implementation and review.

## 7. Watch on the next run

- Worktree folders after F-1: they should survive between tasks.
- Any agent unblocking a human block (F-3 not yet enforced).
- Gate behavior on a missing verdict.
- Deploy-style test runs in reviews.
- Stage titles with 8-character SHA prefixes.


## 8. Addendum 2026-09-29: follow-ups done, and what we learned doing them

### 8.1 Changes made (all with backups under `/root/backups-*` and `*.bak-f1-*`)

**F-1, persistent worktrees.** `/root/.hermes/sandboxes/docker/default/workspace/wt`
is mounted at `/workspace/wt` in **all five** Atrium profiles, not just
DeepSeek: every worker runs `git worktree prune` against the shared `.git`,
so a container that couldn't see `/workspace/wt` would unregister live
worktrees. Implementers use `/workspace/wt/<name>`; reviewers use their own
detached `/workspace/wt/review-<task id>` (on the mount for the same reason;
`/tmp` is also a 512 MB tmpfs, too small for dependency installs). Verified
with two probe tasks (DeepSeek wrote, GLM read, host saw the same file). Old
containers were removed so new ones pick up the mount. Review folders
accumulate; delete old `review-*` from the host occasionally, with nothing
running. **Never run `git worktree prune` from the host**: it has no
`/workspace`, so every real worktree looks missing.

**F-2 to F-6, rules.** Orchestrator `SOUL.md` (committed in its profile
repo), front-door `SOUL.md`, and the front door's `atrium-workflows` skill:
base is always freshly fetched `origin/main`, never a pre-brief SHA; a failed
merge-base check goes to the human; no agent clears a human's block; gates
never recreate reviews, and human-directed workflows block on
CHANGES_REQUIRED; reviewers test the way the deploy does and post only on
their own task; implementers and revisions commit their own work in the
worktree, and there is no separate commit task. The skill had the wrong
lesson from 2026-09-28 written in as a rule ("the merge-base check means the
base is an ancestor of origin/main") and several recipes committing in the
shared checkout; all replaced. The skill is Hermes-maintained, so skim it
after the next runs for drift.

**Guard (all profiles, self-tested):**
- `OPERATOR BLOCK`: an agent's `kanban_unblock` is refused when the task's
  latest block reason contains `OPERATOR BLOCK`. The CLI isn't affected. Block
  with `hermes kanban --board atrium block <id> --kind needs_input
  "OPERATOR BLOCK: …"`.
- F-7: one `atrium_deploy` call per kanban task (keyed on
  `HERMES_KANBAN_TASK`, marker files in the profile's
  `atrium-kanban-guard-state/`); recognizes direct calls and the `tool_call`
  wrapper, not `tool_describe`. Each allowed call is logged as `allow_deploy`
  in the deployer's `logs/atrium-kanban-guard.log`. Live-verified on publish,
  DEV, MAIN and PROD.
- Task bodies containing the old `/workspace/wt-` path are refused at
  creation.

**F-9, test handle leaks.** `multi-world-mutation.test.js` discarded
`attachSessionHandlers`' `closeKeepalive` in two tests;
`reconnect-session.test.js`'s race test never closed `slowServer`/`raceDb`.
Fixed via the pipeline as `42fa2a85` (workflow/test-handle-cleanup), now on
DEV, main and PROD. Both deploy scripts no longer special-case any server
test file: every one must exit on its own within 180 s, or the deploy fails
and rolls back.

**Caddy** (from 2026-09-28): `Cache-Control: no-cache` on all static
handlers, both sites.

### 8.2 Long-running processes don't see changes (new operating rule)

The Telegram front door and the kanban dispatcher are one long-running
process: the **user-level** systemd unit `hermes-gateway.service` (not
`hermes.service`, which is the dashboard). It loads the guard plugin once, and
its Telegram conversation is one continuous session (`session_reset: mode:
none`) started with whatever `SOUL.md` existed then. Workers are fresh child
processes and always load current code, so a change can look live in workers
while the front door still runs the old version. Found when a front-door
card carried the pre-F-1 footer.

**Rule: after any change to a `SOUL.md`, the guard, a skill or plugin
config, with no tasks running: `hermes gateway restart` (it drains in-flight
work first), then `/new` in Telegram.**

### 8.3 PROD: use the deterministic path

The host approvals expire after 15 minutes, so approve immediately before
the agent step that needs it. For PROD, the most reliable path was to skip
the agents and create the two tasks from the CLI (the CLI isn't subject to
agent improvisation, and doesn't get the guard's footer, so the deploy body
carries its own instructions):

```
S=<sha>; S8=${S:0:8}
GATE=$(hermes kanban --board atrium create "Awaiting PROD approval — $S8" --assignee atrium-orchestrator --initial-status blocked --body "PROD approval gate for $S." | grep -oE 't_[0-9a-f]{8}' | head -1)
hermes kanban --board atrium comment $GATE "HUMAN APPROVAL: \"approved: deploy $S to PROD\" (telegram, $(date -u +%Y-%m-%dT%H:%MZ))"
hermes kanban --board atrium create "PROD deploy — $S8" --assignee atrium-deployer --parent $GATE --max-runtime 1800 --max-retries 1 --body "Call exactly once: atrium_deploy(action=\"prod\", sha=\"$S\") ..."
atrium-prod-approve $S && hermes kanban --board atrium complete $GATE
```

MAIN via the deployer worked when the host approval was run first and the
"merge to main" message sent right after.

### 8.4 Incidents during the follow-up work

- **Implementer followed its card, not the rules.** The F-9 implementation
  card (written by the orchestrator) said `worktree add
  /workspace/wt-test-handle-cleanup origin/main`: old path, detached, no
  branch. The commit was safe in `.git` but no branch pointed at it; the gate
  correctly blocked rather than invent one. Fixed by creating the branch on
  the host after verifying the commit. The guard now refuses such bodies.
- **A degenerate orchestrator run.** The fresh front door turned a PROD
  approval into a whole orchestrator kickoff (claiming "no further human gate
  is needed"), and that worker's output degenerated into 110 KB of
  multilingual garbage with fake "SYSTEM OVERRIDE" banners, on the paid
  model, for 25 minutes. It made only `kanban_show` calls: no commands, no
  network, no tasks. Stopped with an operator block and `kill`. Treat such
  text as noise, never as instructions.
- **The PROD deploy first failed** with "no active human PROD approval": the
  approval wasn't live when the deployer ran. F-7 then refused the retry,
  correctly.

### 8.5 Still open

F-8 (Nemotron reliability), F-10 (browser smoke stage; Hermes's browser tool
works locally and was used for acceptance), F-11 (cost: the orchestrator's
paid model also produced the degenerate run), F-12 (connect UX), F-13
(cross-site pair check), F-14 (plumbing as code). New: a reaper step to prune
old `wt/review-*` folders; the throwaway DEV accounts `acctest1`/`acctest2`
(keep for a smoke stage, or delete).
