# Atrium Passdown — 2026-10-13 (early morning) — peer-avatar tint, first fast-lane release

**Predecessor:** `devtasks/Atrium-Passdown-2026-10-12-send-field-allowlist.md`
(the night before). Its §6 follow-ups still hold, except where this file says
otherwise.

**First instruction for the next session's Claude: clone the repo and read
`devtasks/` before advising.** List `devtasks/` by date and read every
passdown newer than the one you think is latest.

## 1. Status at handoff

| Item | State |
|---|---|
| Release state | **COMPLETE** (2026-10-13 ~02:15 PT) |
| DEV / MAIN / PROD | all at `8d75d2399d290b101b8aab7c0a6981f732fc8b78` |
| Base for this round | `aacb12d378d43e3a6bf9720c9b626cfe11b2cc00` (`main` plus the uploaded send-field-allowlist passdown) |
| Code branch | `claude/peer-avatar-tint`, pushed from a Claude cloud session; deleted after release |
| Workflow branch | none: the fast lane didn't need one (§3) |

**Board:**
- `t_079f6cbb` GLM review — done, APPROVE (operator-created card, §7.2)
- `t_2f8c6d25` PROD gate — done (operator)
- `t_1be5c3a6` PROD deploy — done
- **No kickoff, brief, implementation or sentinel cards:** this round was the
  fast lane.

## 2. What shipped

**The per-viewer peer-avatar tint no longer goes to the server**
(send-field-allowlist passdown §6.1, "Peer-avatar tint").

**The problem:**
- `AvatarController._addPeer` gives each peer avatar a random local tint by
  setting its material's `baseColorFactor`.
- The client's material listener sent that change as a `send`.
- Since `e8c7b621` the server refuses every send to a live avatar node. So
  every viewer logged a `PERMISSION_DENIED` for each peer it saw:
  - as the world's owner: "live avatar nodes are server-controlled";
  - as a non-owner: "Only the owner may mutate", because the owner check runs
    first.

**What you see on screen was already right and didn't change:** each viewer
tints its peers itself. Before `e8c7b621`, the owner's tint was accepted and
overwrote the peer's color for everyone; that release stopped it. This round
removes the refused send and its console error.

**The change** (client only; no server, protocol or schema change; one commit,
`8d75d23`):
- **`AtriumClient.applyLocally(fn)`, a new public method:** runs `fn` with
  outbound sends suppressed.
  - SOM mutation events still dispatch, so renderers update.
  - It saves and restores `_applyingRemote`, so it nests and survives a throw.
- **`AvatarController._addPeer`** wraps only the tint in `applyLocally`. If a
  client has no `applyLocally` (the mock clients in the tests), it falls back
  to tinting directly.
- **Other edits to a peer avatar,** such as the SOM inspector's color field,
  are still sent, and the server still decides. That was a deliberate choice
  over skipping peer avatars in `_attachNodeListeners`.

**Tests:**
- `packages/client`: 140 → 145. The 5 new tests:
  - tint on `peer:join`: applied, nothing sent;
  - tint from the som-dump scan: applied, nothing sent;
  - **control:** a direct edit to a peer's material *is* sent. This shows the
    listener is live, so the tint tests aren't vacuous;
  - two `applyLocally` unit tests: return value, nesting, a throw, sends
    resuming afterwards.
- `apps/client`: 191, unchanged. 0 skipped anywhere.
- **Proof (a):** with `AvatarController.js` at base, exactly the 2 tint tests
  fail; the control still passes.
- **End to end** (Claude, a throwaway script, not committed): a real server
  and two real clients.
  - **At base:** client A sent `…material.baseColorFactor` and got
    `PERMISSION_DENIED`.
  - **With the fix:** no sends and no errors.

**Verified three ways:**
1. **Claude** (the author): all of the above, Node 22.22.0, clean install.
2. **GLM review `t_079f6cbb`:** APPROVE.
   - Own worktree and `pnpm install`; `readlink` resolved inside it.
   - Node 22.23.2; 145 + 191 pass.
   - Diff exactly the 4 files; proof (a) re-run with the same result.
3. **The DEV deploy's own test run** (`atrium-deploy`): 25 suites, all
   `fail 0` and `skipped 0`; client 145, apps/client 191.

**DEV acceptance** (operator, 2026-10-13 ~02:10 PT):
- **Baseline on PROD** (still the old client): ToddOnProd, a non-owner, in
  `josh/jorsh`. When josh joined, the console showed `PERMISSION_DENIED: Only
  the owner may mutate this message`.
- **DEV:** BevOnDev, a non-owner, in `TrevOnDev/trevvy`. When the peer joined,
  there was no `PERMISSION_DENIED` of either kind.
- **Proof the browser ran the new code:** `AtriumClient.js` console line
  numbers moved down by exactly 17 (1158 → 1175), the size of the addition.
- **Not checked:** the owner's window. It's the same code path, and the
  release wasn't held for it.

## 3. The fast lane, first run

The create-template passdown §5 proposed it. **It works, and it's simpler than
proposed.**

**What `atrium-deploy dev` actually requires** (operator uploaded
`/usr/local/sbin/atrium-deploy`; read in full):
- a 40-character SHA;
- a clean `/srv/atrium-dev`;
- the SHA reachable from **any** `origin/*` branch after `git fetch origin
  --prune`.

There is no branch-name rule. **So no `publish` step was needed:**
`atrium-deploy-gate "dev <sha>"` took the SHA straight from
`origin/claude/peer-avatar-tint`.

**Also from the script:**
- **Dependencies** are installed only when `package.json`,
  `pnpm-lock.yaml` or `pnpm-workspace.yaml` changed.
- **The DEV server restarts** only when `packages/{server,protocol,som,gltf-extension}/`
  or those files changed. A client-only change needs no restart; DEV serves
  the client straight from the checkout.
- **The full suite runs every time:**
  - protocol and som;
  - each server file, 180 s each;
  - client with `--test-force-exit`;
  - renderer-three, interaction, apps/client.
- **Every deploy backs up the DB first,** and any failure rolls the checkout
  back automatically.
- **On success it calls `set-dev`,** so the human DEV-acceptance gate and the
  MAIN and PROD approvals all still apply.

**How this round ran:**
1. **Prototype, tests, proof and end-to-end check** in a Claude cloud session.
2. **Commit and push** to `claude/peer-avatar-tint` from that session (§4.1).
3. `atrium-deploy-gate "dev 8d75d239…"`: success, at 07:01Z.
4. **One GLM review card, made by hand** (§7.2): about 6 minutes, APPROVE.
5. **DEV acceptance:** PROD baseline, then DEV (§2).
6. **MAIN (§8.1) and PROD (§8.2):** both worked first time.

**Durations:**
- **Fix and tests:** minutes.
- **Review:** about 6 minutes.
- **Total, about 2.5 hours:** most of it the GitHub-access detour (§4.1) and
  operator steps late at night, not the pipeline.

**Verdict:** use the fast lane for small, already-prototyped changes. It
weakens no host safety (create-template passdown §5): the host's
exact-SHA, human MAIN and single-use PROD approvals are all unchanged.

## 4. Findings

### 4.1 Pushing from a Claude cloud session
- **Anonymous clones of the public repo work, but pushing needs two things:**
  1. GitHub linked to the Claude account;
  2. **the Claude GitHub App installed on `joshmaurice/atrium`**
     (github.com/apps/claude → install → pick `atrium`).

  Linking alone still refused the push with a 403. Both are done now, so
  future sessions should be able to push.
- **The session has a stop hook that demands every commit be pushed.** A
  shallow clone only tracks `main`, so after pushing a new branch the hook
  still complained, because there was no local `origin/<branch>` ref. **The
  fix:**
  ```
  git config --add remote.origin.fetch +refs/heads/<branch>:refs/remotes/origin/<branch>
  git fetch --depth 1 origin <branch>
  ```
- **Claude pushes branches only, never `main`.** MAIN stays the host's job.

### 4.2 Teleporter: a spawn pad fires after reconnecting to the same world (operator-observed; not fixed)
**Symptom:** a teleporter at the spawn point doesn't fire on a normal world
load. But after you take a pad to a world that fails and click **Go Back**,
you land on the spawn pad and it fires.

**Cause** (read in the code, not run):
- **Pads start disarmed.** A pad only arms once the avatar has been outside
  it, so spawning on one doesn't fire it.
- **`setPads` keeps `armed` and `wasInside`** for any pad whose name,
  position and destination are unchanged (`apps/client/src/teleport-trigger.js`
  ~L45–58, "operator correction #2"). That's meant for edits within a world.
- **On `connecting`, `app.js` ~L678–686 calls `trigger.reset()`,** which
  clears only `inFlight` and the warnings (`teleport-trigger.js` ~L69–72),
  **not the pads.**

**The sequence:**
1. The spawn pad arms when you walk away from it.
2. You teleport to a world that fails. It never loads, so the old pads stay.
3. Go Back reconnects to the **same** world. The rebuilt pads are identical,
   so they keep "armed, outside".
4. You spawn at the origin, which counts as stepping *into* the pad, and it
   fires.

**Not affected:** a fresh load, which starts with an empty pad map, and a
successful A → B → A round trip, because B's pads replace A's.

**Affected:** any reconnect to the same world, not only Go Back. That
includes an automatic reconnect after a dropped connection, if the client
does one. **So a redesign of Go Back won't fix it by itself.**

**The fix:**
- **Change:** `reset()` also clears the pads (`pads = new Map()`), so every
  connection starts disarmed.
- **Tests:** add a test, and a proof that fails at base.
- **Size:** about one line plus tests; client only.
- **A good second fast-lane candidate.** The operator chose to defer it to
  this passdown.

### 4.3 `atrium-deploy` still checks the sslip.io names
- **`PUBLIC_CLIENT_BASE`** (L9) is `https://dev.5-78-232-73.sslip.io/apps/client/src`.
- **The public health check** (L295) uses `https://dev.5-78-232-73.sslip.io/api/health`.
- **That works while those names resolve.** If they're ever retired, **every
  DEV deploy will fail its health check and roll back.**
- **Add it to the 2026-10-09 "switch to `ewwb.dev`" item.** It's a host
  script change.

### 4.4 Console errors that are not new (both seen on PROD and DEV)
- **`Uncaught (in promise) SyntaxError: JSON.parse: unexpected end of data`
  (`readAsJSON`, platform-io.ts:115, gltf-transform `core.mjs`):**
  - appears right after a **home world** loads, and also after a
    `WORLD_UNAVAILABLE`;
  - **this answers send-field-allowlist §6.1:** it isn't DEV-only;
  - **likely cause, unchecked:** a client-side glTF load of an empty
    response.
- **`Security Error: Content at https://<host>/apps/client/ may not load or link to file:///`:**
  - appears **right after a peer joins**, in a non-home world;
  - a lead for source-ref-guard §6.1. Check what a peer join loads or builds
    a URL from.
- **`Request for font "…" blocked at visibility level 2`:** Firefox's font
  fingerprinting protection, so this is noise, not Atrium.
- **`WORLD_UNAVAILABLE` for `josh/home` as ToddOnProd:** correct; josh's home
  is private.

### 4.5 Pipeline observations
- **GLM's `kanban_complete` failed about 30 times** before it accepted the
  summary: first "provide at least one of: summary…", then bare `[error]`s.
  The verdict wasn't lost, because the reviewer had posted the full handoff as
  a comment first, which the progress-comment rule (§3) is for. Watch whether
  this repeats.
- **The sandbox security scanner blocked** `pnpm install … >/tmp/pnpm-install.log`,
  apparently because of the redirect. The worker re-ran it without the
  redirect. Card bodies shouldn't tell workers to redirect output.
- **"Expect 145 pass" in the card was read too narrowly at first:** the
  reviewer ran only the two changed files (51 tests), then the whole suite
  (145). Always give the exact command next to an expected count.
- **The durable-block rule for gates** (send-field-allowlist §6.1) **is still
  untested:** no agent created a gate this round. Check it in the next full
  round's events.

### 4.6 DEV-acceptance lessons
- **Get the "before" first.** A hard reload on DEV replaces the old client,
  so the only baseline left is **PROD**, which still runs the old client until
  release.
- **Owner and non-owner see different refusal messages** for the same send,
  because the owner check runs before the allowlist. A DEV check should accept
  either.
- **Console line-number shifts** in the app's own files confirm the browser
  loaded the new code without opening DevTools Sources.

## 5. What's next

### 5.1 In sequence
- **Phase 3 step 1 (Edit mode) pre-brief:**
  `docs/DESIGN-phase3-placement-scripting.md` §4 and §9. Steps 0, 0b and 0c
  are done. Step 1 grows the allowlist through reviewed changes to
  `send-policy.js` (send-field-allowlist §5.1).

### 5.2 Small, fast-lane sized
- **The teleporter spawn-pad re-arm** (§4.2).
- **The teleporter error message:** a non-string destination gets the text
  "destination exceeds 2048 characters" (send-field-allowlist §6.1). Cosmetic.

## 6. Follow-ups

### 6.1 Closed this round
- **Peer-avatar tint** (send-field-allowlist §6.1): **done**, `8d75d23`.
- **Whether PROD shows the `JSON.parse` error:** yes (§4.4).

### 6.2 New
- **The teleporter spawn-pad re-arm** (§4.2).
- **`atrium-deploy` health checks still use sslip.io** (§4.3).
- **The `file:///` error happens right after a peer joins** (§4.4). A lead.

### 6.3 Carried over (all still open)
- **From send-field-allowlist §6.1:**
  - externally loaded nodes in file worlds are still writable;
  - the pre-brief template's DEV plan should use the protocol inspector for
    owner-only checks;
  - the durable-block gate rule needs checking in a full round's events.
- **From create-template §6.2–6.3:**
  - the stale `/workspace/atrium` checkout (`e66d99b`);
  - the 2026-10-09 items: `ewwb.dev` sign-in, re-saving the `sslip.io` pads,
    agent docs to `ewwb.dev`, recording the PROD commons owner, a DEV commons
    owner;
  - the Step 9 §6.3 list.
- **The GitHub PAT expires 2026-10-29.**

## 7. Recipes

`$SC` = `/root/.hermes/sandboxes/docker/default/workspace/atrium`

### 7.1 The fast lane (as run)
```
# Claude, in its session: prototype, tests, proof, commit, then push a branch (never main)
git push -u origin claude/<slug>

# Host:
S=<40-char sha>
atrium-release-status | sed -n 2,3p        # expect COMPLETE (or another state set-dev accepts)
atrium-deploy-gate "dev $S" 2>&1 | tee /root/dev-<slug>.log
grep -E "REFUSING|reachable|origin/|^--- |ℹ (tests|fail|skipped) |No server-affecting|RESTART|health|ROLLING BACK|DEV DEPLOY|STATE=" /root/dev-<slug>.log
# then the review card (7.2), DEV acceptance, Step 8 §8.1 MAIN, Step 8 §8.2 PROD
```
**Keep `main` untouched until PROD:** no GitHub web uploads mid-round. MAIN
is a fast-forward from the base.

### 7.2 A hand-made GLM review card
```
git -C $SC fetch origin claude/<slug> && git -C $SC cat-file -t $S      # expect: commit
REQ=~/.hermes/skills/devops/atrium-workflows/references/worker-card-requirements.md
cat > /root/review-<slug>.txt <<'EOF'
<what changed; SHA and base as 40-char; "Review only, do NOT push/publish/deploy";
 numbered steps: worktree add --detach under /workspace/wt/review-<slug>, pnpm install + readlink check,
 diff --stat with the expected file list, exact test commands with expected counts, proofs,
 what to judge; progress comments; kanban_complete with verdict, SHA, counts, proofs; remove worktree>
EOF
cat $REQ >> /root/review-<slug>.txt
REV=$(hermes kanban --board atrium create "GLM review — <slug> ${S:0:8}" --assignee atrium-glm --body "$(cat /root/review-<slug>.txt)" | grep -oE 't_[0-9a-f]{8}' | head -1)
echo "REV=$REV"; hermes kanban --board atrium show $REV | head -12
```
This round's body is in `/root/review-peer-avatar-tint.txt` on the host. Use
it as the example.

### 7.3 A DEV deploy log too long to copy
Run with `| tee /root/<file>.log`, then either use the `grep` in §7.1, or copy
the log to your computer and upload it. Run this on your own computer, not the
server:
```
scp root@5.78.232.73:/root/<file>.log .
```
**If the deploy already ran without `tee`:** running it again on the same SHA
only does a health check. Use `atrium-release-status` and `atrium-deploy status`
instead.

### 7.4 A client-only DEV check with a baseline
1. **Before:** reproduce the old behavior on **PROD**, which still runs the
   old client.
2. **After:** hard-reload the DEV windows and repeat the same steps.
3. **Confirm the new code loaded:** the console line numbers move, or
   DevTools → Sources → search for a new identifier.

### 7.5 Give a Claude cloud session push access (one-time; done)
- **Link GitHub** to the Claude account.
- **Install the Claude GitHub App on the repo:**
  `https://github.com/apps/claude/installations/select_target` → `joshmaurice`
  → `atrium`.
