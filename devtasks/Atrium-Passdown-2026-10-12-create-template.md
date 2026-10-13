# Atrium Passdown — 2026-10-12 (evening) — Step 0b `create-template`, pipeline fixes, fast-lane findings

**Predecessor:** `devtasks/Atrium-Passdown-2026-10-12-source-ref-guard.md`
(same day, earlier). Its §6 follow-ups still hold, except where this file
says otherwise.

**First instruction for the next session's Claude: clone the repo and read
`devtasks/` before advising.** List `devtasks/` by date and read every
passdown newer than the one you think is latest.

## 1. Status at handoff

| Item | State |
|---|---|
| Release state | **COMPLETE** (2026-10-12 ~20:26 PT) |
| DEV / MAIN / PROD | all at `4d74a89e96c67b3cc08b67947be78c5a079b82c0` |
| Base for this round | `9977c546d9086ced2788734076b7a21a7ab0dc93` |
| Review branch | `review/create-template-r1`, deleted after release |
| Workflow branch | `workflow/create-template`, published |

**Board:**
- `t_afdded8d` kickoff — done
- `t_880bbaf9` GLM brief — done
- `t_2551410d` brief-review gate — done (operator)
- `t_4ef3bce2` DeepSeek implementation — done
- `t_b55d12bf` GLM review — done
- `t_3856c806` review gate — done
- `t_38608c2e` PROD gate — done
- `t_25a02664` PROD deploy — PROD state confirms it
- sentinel `t_826c3cd1` — archived
- `t_25b8050a`, the previous round's DEV-acceptance gate (left blocked) —
  closed with an operator comment
- **No open sentinel at handoff.**

## 2. What shipped

**Create (`POST /api/worlds`) no longer copies the live world (the
commons).** It starts every new world from a fixed template.
`home-world.js` gains `newWorldDocument(name)`:
- the same content as `DEFAULT_HOME_DOCUMENT`;
- `asset.generator = 'Atrium World'`;
- `extras.atrium.name` = the request's name, falling back to the slug.

**Other details:**
- `getLiveWorld()` and `getLiveAvatarNodeNames()` were removed.
- Home worlds are unchanged.
- No client, protocol or schema change.
- Pre-brief: `devtasks/PREBRIEF-create-template.md`, with the operator's
  decision on option B.

**Commits:** `426d1eb`, `450519c`, `4d74a89`.

**Tests:**
- `world-crud.test.js`: 72 → 75.
- Server: 18 files, 336 pass, all exit on their own, in Claude's clean
  sandbox.
- `apps/client`: 191 pass; `packages/client`: 140 pass. 0 skipped anywhere.
- **Proof (a)** (`http-routes.js` restored to base) failed exactly the 3 new
  tests.

**DEV acceptance:** passed. A new world created on `dev.ewwb.dev` showed only
the ground, and the HUD read "World: <name>".

**Count correction:** the source-ref-guard passdown's "330" should be 333.
Its own per-file counts add up to 333.

## 3. How the round went, and what slowed it

The change took Claude minutes to prototype. The round took about 90
minutes, almost all of it pipeline problems:

1. **The brief gate didn't stay blocked.** A gate created blocked is
   promoted to ready when its parent completes. An agent picked it up, did
   nothing and re-blocked it. Harmless, but risky.
2. **DeepSeek's handoff was the bare string `READY_FOR_REVIEW`,** with no
   SHA, test counts or proof results. The reviewer found the SHA from the
   branch itself.
3. **The first GLM review run (641) crashed after 26 minutes.** It finished
   the review and decided APPROVE, but the model then returned empty
   responses. With **no fallback provider configured**, it exited without
   `kanban_complete`. The work was lost and the retry (run 642) redid it.
4. **The reviewer tested against stale code.** Its fresh worktree had no
   `node_modules`, so it symlinked the shared checkout's.
   - **The shared checkout** (`/workspace/atrium`) is at `e66d99b`, from
     2026-09-27.
   - **Its `@atrium/protocol`, `som` and `gltf-extension` links** point at
     that checkout's own `packages/*`.
   - **So the reviewer's server tests ran the reviewed server code against
     September protocol and SOM code.** That explains the 3 stray
     "hello"/display-name failures and, probably, `http-integration.test.js`
     passing 51/51 and then hanging until the 180 s timeout (at both the tip
     and the base).
   - **The implementer's worktree had correct links of its own,** so
     DeepSeek's results were valid.
   - **Confirmed on the host:** `readlink` on the review worktree's
     `node_modules`, and an `ls` of the shared checkout's
     `node_modules/@atrium/`.
5. **Each hang costs 180 s,** and the reviewer hit it about five times while
   classifying it.

**The outside review (Claude)** was done through `review/create-template-r1`
with a clean install. The diff was exactly the 3 files, essentially
identical to the prototype. `http-integration` passed and exited in 3 s,
twice. Approved.

## 4. Pipeline fixes applied this session (no repo change)

| Fix | Where | By |
|---|---|---|
| Workers run `pnpm install --frozen-lockfile --prefer-offline` in their own worktree, never symlink `node_modules` from `/workspace/atrium`; they confirm `readlink -f packages/server/node_modules/@atrium/protocol` resolves inside their worktree, otherwise they block with `capability` | `~/.hermes/skills/devops/atrium-workflows/SKILL.md` §"Worker card requirements" and new `references/worker-card-requirements.md` (pasted into future kickoff bodies) | front door, at the operator's request |
| Implementation handoff is mandatory: 40-char SHA, per-file counts and exit codes, `node --version`, skipped count, client results, every proof result. A bare `READY_FOR_REVIEW` makes the gate block for the operator | same | front door |
| Reviewers post a progress comment after each major stage | same | front door |
| Gates: create blocked, then immediately `kanban_block` with an `OPERATOR BLOCK:` reason, then read back | same (§ gate item 8) | front door |
| **Fallback model providers**, previously none for any profile: atrium-glm and atrium-orchestrator → `deepseek/deepseek-v4.1-flash`; atrium-deepseek and atrium-deployer → `z-ai/glm-5.3-flash`. All via openrouter, so no new credentials. atrium-nemotron (benched) has none | `/root/.hermes/profiles/<p>/config.yaml` `fallback_providers:`; backups `config.yaml.bak-2026-10-12` | operator, on the host |

**Notes on the fallbacks:**
- **They're turn-scoped.** A card pinned with `model_override` or
  `provider_override` doesn't use them.
- **The trade-off was accepted on purpose:** if GLM's review falls back, the
  implementer's model family reviews for that turn.
- **Unverified:** the `fallback list` help text names rate-limit, 5xx and
  connection errors as triggers. The front door's reading of the docs says
  empty or malformed responses (tonight's failure) also trigger it. Check the
  log the next time a provider fails.

**Rules for the next session:** apply these from the next kickoff. Confirm in
the next review's worker log that it runs `pnpm install`, and that
`http-integration` no longer hangs. If it still hangs with correct
dependencies, investigate it as a separate problem.

## 5. Fast-lane findings (for small, already-prototyped changes)

The host scripts were read:
- `atrium-deploy-gate`;
- `atrium-release-state`;
- `ls /usr/local/sbin/atrium-*`.

**The host enforces:**
- an exact 40-character SHA;
- the order: `set-dev` from `UNINITIALIZED`, `WAITING_FOR_HUMAN_DEV_ACCEPTANCE`
  or `COMPLETE`, then `set-main`, then `set-prod`;
- a human approval for MAIN (`atrium-main-approve`);
- a single-use, 15-minute human approval for PROD (`atrium-prod-approve`,
  consumed by the gate).

**It does not check who wrote or reviewed a SHA:** `reviewed_sha` is simply
whatever was deployed to DEV. The brief, implementation and review stages
are kanban conventions.

**A fast lane therefore weakens no host safety.** Proposed, and not yet
tried:
1. Get the base SHA from a host fetch.
2. Create a worktree on a new `workflow/<slug>` branch from `origin/main`
   under `$SC/../wt/<slug>`.
3. `git apply` the tested patch, run the tests and commit.
4. Publish: `atrium-deploy-gate "publish <sha> workflow/<slug>"`.
5. Deploy to DEV: `atrium-deploy-gate "dev <sha>"`.
6. Review: one GLM review card, made by hand from the worker-card
   requirements, plus Claude's outside review.
7. DEV acceptance, then MAIN and PROD with the usual recipes.

**Before trying it**, read `/usr/local/sbin/atrium-deploy` (8 KB): what
`dev` requires (for example, a published branch), and what tests it runs.
Then try it on the next small change.

## 6. Follow-ups

### 6.1 Next in sequence
- **Restrict what a client `send` may traverse or write** (source-ref-guard
  passdown §6.1). An allowlist checked with `setPath`'s resolution, and
  checked against the inspector's and client's edit paths. **Recommended
  before Phase 3 step 1.** A good fast-lane candidate if it stays small.
- **Phase 3 step 1 (Edit mode) pre-brief:** `docs/DESIGN-phase3-placement-scripting.md`
  §4 and §9. Steps 0 and 0b are now both done.

### 6.2 New this session
- **The stale shared checkout `/workspace/atrium` (`e66d99b`, 2026-09-27)
  holds unrelated changes.** It's still a trap for any agent that reads or
  links from it. Decide whether to inspect, stash and update it.
- **The `http-integration.test.js` hang in the agent container:** probably
  the stale dependencies (§3.4). Verify next round.
- **The `file:///` security error in the DEV console** (source-ref-guard
  passdown §6.1): still uninvestigated.

### 6.3 Carried over
- **From the 2026-10-09 passdown:** confirm sign-in on `ewwb.dev`; re-save
  pads that point at the `sslip.io` names; switch agent instructions and docs
  to `ewwb.dev`; record the PROD commons owner; check whether DEV has a
  commons owner.
- **The GitHub PAT expires 2026-10-29.**
- **The Step 9 cleanup §6.3 list.**

## 7. Recipes used this session

`$SC` = `/root/.hermes/sandboxes/docker/default/workspace/atrium`

### 7.1 Check a worker's dependency links (read-only, on the host)
```
W=/root/.hermes/sandboxes/docker/default/workspace
readlink $W/wt/<worktree>/node_modules $W/wt/<worktree>/packages/server/node_modules
git -C $W/atrium log -1 --format='%h %cd %s' --date=short
```

### 7.2 Show and set fallback providers
Show them:
```
for p in atrium-glm atrium-nemotron atrium-deepseek atrium-deployer atrium-orchestrator; do
  echo "== $p"; hermes -p "$p" fallback list; done
```
Set one: a `fallback_providers:` list in `/root/.hermes/profiles/<p>/config.yaml`,
with entries `{provider, model}`. Back the file up first.

### 7.3 See why a review is slow
```
hermes kanban --board atrium show <review t_id> | sed -n '1,12p;/^Events/,$p'
```
The dashboard's "Worker log" view shows the full transcript.

### 7.4 Close a stale acceptance gate after release
```
hermes kanban --board atrium comment <t_id> "OPERATOR: DEV acceptance of <sha> passed <date> (...). Merged to main and released to PROD ... Closing for the record."
hermes kanban --board atrium complete <t_id>
```
