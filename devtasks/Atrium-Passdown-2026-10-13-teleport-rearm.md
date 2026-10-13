# Atrium Passdown — 2026-10-13 (early morning, pt 2) — teleporter spawn-pad re-arm, second fast-lane release

**Predecessor:** `devtasks/Atrium-Passdown-2026-10-13-peer-avatar-tint-fast-lane.md`
(earlier the same night). Its §6 follow-ups still hold, except where this file
says otherwise.

**First instruction for the next session's Claude: clone the repo and read
`devtasks/` before advising.** List `devtasks/` by date and read every
passdown newer than the one you think is latest.

## 1. Status at handoff

| Item | State |
|---|---|
| Release state | **COMPLETE** (2026-10-13 ~03:19 PT) |
| DEV / MAIN / PROD | all at `9312e5ee28273494122348a7057b3505e2523d79` |
| Base for the release | `dd94771bf83f00386ad7bd5731b12cd8efcc678f` (`main` plus the operator's README edit, §3.1) |
| First SHA | `fcfa301aed43c366e05ddc486ff98f87fba0e020` on base `3b2b70b` — reviewed and DEV-accepted, then refused by MAIN (§3.1) |
| Code branches | `claude/teleport-rearm` (`fcfa301`) and `claude/teleport-rearm-r2` (`9312e5e`). **The operator deletes them:** the Claude session can't delete branches (§4.2) |
| Workflow branch | none (fast lane) |

**Board:**
- `t_6688e1df` GLM review of `fcfa301` — done, APPROVE (operator-created card).
- `t_61f4924e` PROD gate and `t_a79739fc` PROD deploy for `fcfa301` —
  **archived**. They were created by the PROD block before the host refused it;
  nothing ran (§3.2).
- A second PROD gate and deploy card for `9312e5e` — done. The IDs weren't
  captured here; the host state confirms them.

## 2. What shipped

**Teleporter pads start disarmed on every connection** (tint passdown §4.2,
"spawn pad fires after reconnecting to the same world").

**The bug** (operator-observed on PROD, shortly before this round):
- Pads start disarmed and arm once the avatar has been outside them, so
  spawning on a pad doesn't fire it.
- `setPads` keeps `armed` and `wasInside` for pads whose name, position and
  destination are unchanged (operator correction #2).
- `trigger.reset()`, called on `connecting` (`app.js` ~L686), cleared only
  `inFlight` and the warnings, not the pads.
- So any reconnect to the **same** world (Go Back after a failed teleport, or
  any other reconnect) rebuilt identical pads as "armed, outside". Spawning at
  the origin counted as stepping in, and the spawn pad fired.

**The change** (client only; one commit; no server, protocol or schema change):
- `apps/client/src/teleport-trigger.js`: `reset()` also does
  `pads = new Map()`, with a comment. A reconnect now behaves like a fresh load.
- **Why clearing is safe:** `reset()` has exactly one caller, the
  `connecting` handler. Pads are rebuilt afterwards from the SOM by
  `rebuildPads()` (`app.js` L457, called at L639/644/664/752/763/776), and
  `update()` is inert until `setReady(true)` anyway.

**Tests** (`apps/client`: 191 → 193):
- New: "reconnect to the same world — spawn pad starts disarmed again".
  Covers the app.js order (not ready, `reset`, identical `setPads`, ready); the
  spawn pad must not fire, and a real walk-off and walk-on still fires it.
- New: "reset drops pads — nothing fires until pads are set again".
- **Changed:** the warn-once test called `setPads()` before `reset()`, the
  reverse of app.js. It now calls `reset()` first. It still checks that
  `reset()` clears the warned set, and it passes both at base and with the
  fix.
- **Proof:** with the base `teleport-trigger.js`, exactly the 2 new tests fail
  (11 pass).

**Verified:**
1. **Claude** (author): Node 22.22.0, clean install; 193 pass, 0 skipped;
   proof as above. Rerun after the reapply onto `dd94771`: 193 pass.
2. **GLM review `t_6688e1df`:** APPROVE in 95 s. Own worktree; `readlink`
   inside it; Node 22.23.2; diff exactly the 2 files (+5, +52/−2); 193 (glob)
   and 13 (single file) pass; proof re-run with the same 2 failures. It
   independently confirmed the single `reset()` caller and the
   `rebuildPads()` paths.
3. **DEV deploy of `fcfa301`:** 25 suites, all `fail 0` and `skipped 0`;
   client 145, apps/client 193; no server restart.
4. **DEV acceptance** (operator, ~03:07 PT, on `fcfa301`): Go Back to the same
   world no longer fires the spawn pad; walking off and back on still does.
   - **PROD baseline skipped by choice:** the operator had hit the bug on PROD
     shortly before, and PROD's teleporter code hadn't changed since.
5. **`9312e5e`** is byte-identical to `fcfa301` in code: `git diff fcfa301
   9312e5e` is only `README.md`. It was redeployed to DEV (healthy), with no
   second review or DEV test.

## 3. Findings

### 3.1 A GitHub web edit to `main` mid-round blocks MAIN
- At 02:44 the operator edited `README.md` on GitHub (`dd94771`), after the
  round's base `3b2b70b` and during the DEV deploy.
- `atrium-main-push` fetched, saw `3b2b70b..dd94771`, and refused:
  `REFUSED: SHA is not a fast-forward descendant of origin/main`.
- **The recovery:**
  1. Reapply the commit onto the new `main` → new SHA `9312e5e`, on a new
     branch (`-r2`). A new branch keeps the old SHA, which DEV was running,
     reachable.
  2. Show the code is unchanged: `git diff <old> <new>` lists only the
     operator's file.
  3. Redeploy DEV with the new SHA. **The host requires MAIN to be exactly
     the SHA deployed to DEV,** so this step can't be skipped even when the
     code is identical.
  4. MAIN, then PROD.
- **Cost:** one extra DEV deploy, a few minutes.
- **The rule, restated:** no GitHub web edits (README, passdown uploads) from
  the base fetch until PROD. Make them before the round, so the fix is built
  on top, or after PROD.

### 3.2 The PROD recipe creates cards before the host can refuse
- On the refused attempt, Step 8 §8.2 ran in order: gate created, approval
  comment added, deploy card created, then `atrium-prod-approve` refused
  (`release state is 'WAITING_FOR_HUMAN_DEV_ACCEPTANCE', expected
  WAITING_FOR_PROD_APPROVAL`). The `&&` chain stopped there.
- It left a blocked gate carrying an approval comment for a SHA that never
  reached MAIN, plus a child deploy card. The operator archived both.
- **No risk this time:** the gate had no parent, and the host would refuse a
  PROD deploy anyway.
- **Fix the recipe** (§6.2): guard the whole PROD block on
  `STATE: WAITING_FOR_PROD_APPROVAL` with `REVIEWED` equal to `$S` (see §7.2).

### 3.3 Reapplying a commit in a shallow clone
- `git rebase` in the session's `--depth 1` clone reported add/add conflicts
  in every file, because the shared history wasn't there.
- **What worked:**
  `git diff <old base> <old tip> | git apply --index && git commit -C <old tip>`
  on a branch from the new `origin/main`.

### 3.4 Pipeline observations
- **GLM `kanban_complete` succeeded first time**, after ~30 failed attempts in
  the last round (tint passdown §4.5). Still worth watching.
- **The review was 95 s,** but every step had evidence: three progress
  comments, a readlink path, counts, and the named proof failures. Fast isn't
  suspicious if the comments are there.
- **Giving both counts with their commands** (193 for the glob, 13 for the
  file) avoided last round's misreading.
- **The test-count grep in tint passdown §7.1 doesn't match:** the deploy log
  prints `# tests N` / `# fail N` / `# skipped N` (TAP), not `ℹ …`. Use the §7.1
  grep below.
- **The hand-made review card needs a host fetch first:** `git -C $SC fetch
  origin claude/<slug>`, so the reviewer's `worktree add` from
  `/workspace/atrium` can find the SHA. Tint §7.2 already has it; the first
  draft of this round's card didn't.

### 3.5 Fast-lane timing
- Fix, tests and proof: ~15 min. First push 02:36, PROD COMPLETE 03:19:
  **~45 min**, of which the README detour cost ~10.

## 4. Claude cloud session notes

### 4.1 Pushing works
- The GitHub App and the account link from the tint round work.
  `add_repo(access: "push")` clones to `/home/claude/atrium`; pushing a
  `claude/*` branch succeeded first time.

### 4.2 The session can't delete branches
- `git push origin --delete` and `git push origin :refs/heads/<b>`: the
  connection drops (`unexpected disconnect while reading sideband packet`),
  with no relay failure in the proxy status.
- `gh api -X DELETE …/git/refs/heads/<b>`: HTTP 403, "Write access to this
  GitHub API path is not permitted through this proxy."
- **So the operator deletes branches after release,** from the host (§7.3)
  or on GitHub.

## 5. What's next

### 5.1 In sequence
- **Phase 3 step 1 (Edit mode) pre-brief:**
  `docs/DESIGN-phase3-placement-scripting.md` §4 and §9. Steps 0, 0b and 0c
  are done. Step 1 grows the allowlist through reviewed changes to
  `send-policy.js`.

### 5.2 Small, fast-lane sized
- **The teleporter error message:** a non-string destination gets the text
  "destination exceeds 2048 characters". Cosmetic.
- **The PROD recipe guard** (§3.2): a host-side recipe change only, no repo
  change.

## 6. Follow-ups

### 6.1 Closed this round
- **The teleporter spawn-pad re-arm** (tint §4.2): **done**, `9312e5e`.

### 6.2 New
- **Guard the PROD recipe on release state** (§3.2, §7.2).
- **Fix the test-count grep** in the fast-lane recipe (§3.4, §7.1).
- **Delete** `claude/teleport-rearm` and `claude/teleport-rearm-r2` (§7.3).

### 6.3 Carried over (all still open)
- **From the tint passdown:**
  - `atrium-deploy` health checks still use the sslip.io names (tint §4.3);
  - the `file:///` security error right after a peer joins (tint §4.4);
  - the `JSON.parse: unexpected end of data` error after a home world loads,
    on PROD and DEV (tint §4.4).
- **From send-field-allowlist §6.1:**
  - externally loaded nodes in file worlds are still writable;
  - the pre-brief template's DEV plan should use the protocol inspector for
    owner-only checks;
  - the durable-block gate rule is still untested: no agent created a gate
    this round either.
- **From create-template §6.2–6.3:**
  - the stale `/workspace/atrium` checkout (`e66d99b`);
  - the 2026-10-09 items: `ewwb.dev` sign-in, re-saving the `sslip.io` pads,
    agent docs to `ewwb.dev`, recording the PROD commons owner, a DEV commons
    owner;
  - the Step 9 §6.3 list.
- **The GitHub PAT expires 2026-10-29.**

## 7. Recipes

`$SC` = `/root/.hermes/sandboxes/docker/default/workspace/atrium`

### 7.1 The fast lane, with the corrected grep
```
# Claude, in its session: fix, tests, proof, commit, push a claude/<slug> branch (never main)

# Host:
S=<40-char sha>
atrium-release-status | sed -n 2,3p
atrium-deploy-gate "dev $S" 2>&1 | tee /root/dev-<slug>.log
grep -E "REFUSING|reachable|origin/|No server-affecting|RESTART|ROLLING BACK|DEV DEPLOY|STATE=" /root/dev-<slug>.log
grep -E "^# (tests|fail|skipped) " /root/dev-<slug>.log | paste - - - | sort | uniq -c   # 25 suites, all fail 0 / skipped 0
# then: host fetch + review card (tint §7.2), DEV acceptance, MAIN (Step 8 §8.1), PROD (§7.2 below)
```
**Don't touch `main` on GitHub between the base fetch and PROD** (§3.1).

### 7.2 PROD, guarded on release state
The Step 8 §8.2 block, run only if the host is ready for this SHA:
```
S=<40-char sha>; S8=${S:0:8}
if atrium-release-status | grep -q "STATE: *WAITING_FOR_PROD_APPROVAL" && \
   atrium-release-status | grep -q "REVIEWED: *$S"; then
  GATE=$(hermes kanban --board atrium create "Awaiting PROD approval — $S8" --assignee atrium-orchestrator --initial-status blocked --body "PROD approval gate for $S." | grep -oE 't_[0-9a-f]{8}' | head -1)
  echo "GATE=$GATE"
  if [ -n "$GATE" ]; then
    hermes kanban --board atrium comment $GATE "HUMAN APPROVAL: \"approved: deploy $S to PROD\" (host CLI, $(date -u +%Y-%m-%dT%H:%MZ))" && \
    hermes kanban --board atrium create "PROD deploy — $S8" --assignee atrium-deployer --parent $GATE --max-runtime 1800 --max-retries 1 --body "Call exactly once: atrium_deploy(action=\"prod\", sha=\"$S\"). Do not call it again for any reason, including if you lose track of the result. A refusal saying release state is COMPLETE means the first call succeeded. Report the tool's output, then complete this task. If the single call genuinely fails, block with kind=capability and the exact error. Do not retry." && \
    atrium-prod-approve $S && hermes kanban --board atrium complete $GATE
  else
    echo "STOP: gate card was not created; nothing else was run"
  fi
else
  echo "STOP: host is not waiting for PROD approval of $S; no cards created"
  atrium-release-status | sed -n 2,3p
fi
```

### 7.3 Delete the round's branches (operator; the Claude session can't)
```
git -C $SC push origin --delete claude/<slug> [claude/<slug>-r2]
```

### 7.4 MAIN moved mid-round: rebuild the commit on the new main
In the Claude session:
```
git fetch --depth 5 origin main
git checkout -B claude/<slug>-r2 origin/main
git diff <old base> <old sha> | git apply --index && git commit -C <old sha>
# rerun the tests; push claude/<slug>-r2
```
On the host, before redeploying DEV:
```
git -C $SC fetch origin claude/<slug>-r2 && git -C $SC diff --stat <old sha> <new sha>   # expect only the operator's files
```
