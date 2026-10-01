# Atrium Passdown — 2026-09-30 — Step 7: Teleporters

**Predecessor:** `devtasks/Atrium-Passdown-2026-09-28-cross-server-connect-shipped.md` (Step 6). Follow-ups F-1..F-14, kanban CLI recipes, incident patterns, and the §8.3 deterministic PROD path all still apply and are referenced below rather than repeated.

## 1. Status at handoff

| Stage | State |
|---|---|
| Branch `workflow/teleporters` tip | `88032eea3eadc65bf467c50e241b529f021ad4dd` |
| Base SHA | `51fd22571ad9af4b03303db5f66eff8a33bb09ca` |
| Review | APPROVE (round 4, GLM, `t_f59e9886`) |
| DEV | Deployed, running `88032eea`, acceptance largely passed |
| MAIN | **Not done** |
| PROD | **Not done** |

Worktree: `/workspace/wt/teleporters` (host: `/root/.hermes/sandboxes/docker/default/workspace/wt/teleporters`). Shared checkout `$SC` = `/root/.hermes/sandboxes/docker/default/workspace/atrium`.

## 2. What shipped

Teleporter pads: an owner can place a pad in their world, give it a destination, and anyone walking onto it is connected to that destination — including cross-server, building on Step 6.

- **Placement:** owner-only placement mode; click in the viewport to position; form with destination + optional label; pads and labels persist via SOM and rebuild on `world:loaded`.
- **Labels:** live for all connected users; full-URL destinations render as commons-style labels.
- **Arming:** a pad under you on arrival does not fire; it arms once you step off and back on. Pads are also paused while placement mode is active.
- **Trigger → connect:** walking onto an armed pad initiates a connect to the destination; on failure the user gets a message plus a "Go back" button returning them to the previous server.
- **Save validation** (`wsUrl.js:180`, `isValidDestination`): accepts only `/`, `/worlds/<user>/<slug>` (leading slash optional), or a full `ws(s)://` URL.
- **Docs:** ADDENDUM §8 "What shipped".

**Tests:** `apps/client/tests/teleport-trigger.test.js`, `packages/server/test/teleporter.test.js`, plus three regression tests for the connect-record bug below.

**Verification standard (F-9):** every `packages/server/test/*.test.js` run individually under `timeout 180`, **no** `--test-force-exit` — 16 files, 288 tests at the tip, all exiting on their own.

## 3. The main find: stale connect timeout / ghost avatars

**Symptom (DEV):** teleport to a bad destination → "Go back" → reconnect → disconnected ~10s later; reconnecting showed two extra avatars, one frozen at spawn, one trailing.

**Root cause** — `packages/client/src/AtriumClient.js`: a connect that failed before `hello` never cleared its connect timeout and never marked its record closing. Because that record was no longer `_connectionRecord`, the next `connect()` could not mark it stale, so the orphaned timer later wiped the **new** connection's state and emitted a disconnect **without closing its socket** → zombie server session + ghost peers.

**Fix:** every per-record handler (timeout, `onOpen`, dispatch, `onClose`, `onError`, both constructor-failure timers) now also requires `record === this._connectionRecord`; `onClose` clears the timer and marks closing first. Proven fail-at-base / pass-at-tip.

**Note:** pre-existing since Step 6. This explains the Step 6 "ghost session" that was wrongly blamed on caching. Theories about T9 avatar-name collisions were disproved — the server names avatars `avatar-<sessionId first 8>` (`session.js:302`) and refuses other names (`:511`). **User confirmed no recurrence on DEV after the fix.**

## 4. Release — next action

Run from the host.

**MAIN:**

```
atrium-main-approve 88032eea3eadc65bf467c50e241b529f021ad4dd
atrium-main-push    88032eea3eadc65bf467c50e241b529f021ad4dd
atrium-release-status
```

**PROD:** use the §8.3 deterministic CLI path from the Step 6 passdown — approval expires in 15 minutes, so create the blocked gate and the deployer task (card text: "Call exactly once") first, then:

```
atrium-prod-approve $S && hermes kanban --board atrium complete $GATE
```

**Expected:** `atrium-release-status` COMPLETE with DEV/MAIN/PROD all at `88032eea`. Then smoke-test a pad on PROD.

Also archive the stale `154d8ec0` acceptance gate.

## 5. DEV acceptance

**Passed** (Hermes headless, accounts `tp-tester-a` / `tp-tester-b`): owner vs non-owner controls; placement with live labels for both users; `hi` rejected inline; spawn warning; pads and labels surviving reload; peer visibility.

**Skipped** — headless browser cannot walk the avatar or click SOM nodes (see F-10): arming rule, teleport trigger, failure/"Go back", reconnect-without-"Go back", delete.

**Outstanding manual checks before sign-off:**

1. Arming — pad at spawn must not fire on arrival, only after step-off/step-on.
2. After a page reload, walking onto an existing pad still teleports.
3. Anonymous visitor sees pads and labels but no placement controls.
4. Reconnect via Connect (not "Go back") hides the "Go back" button.
5. Delete a pad — propagates to the other user and survives reload. Use this to remove the old `hi` / `<3` pads.

User has separately confirmed working placement, labels, a successful cross-server teleport to PROD, and the disconnect fix.

## 6. Follow-ups

### 6.1 Teleporter UI polish (one small task)

- **Cancel button** (`app.js:1181`) hides the form but does not call `exitTeleporterMode()`, so placement mode stays on and the click bubbles to the viewport handler, which reopens the form at the Cancel button's position. Escape works. Fix: call `exitTeleporterMode()` and stop clicks inside `tpForm` reaching the viewport.
- **Failure UI:** the message and "Go back" should be a single centred error panel. Currently the message renders as small bottom-left status text above the WASD hint, and "Go back" is fixed at `bottom:30px; left:200px`, half-overlapping the hostname.
- **Failure wording:** name the destination path, and phrase causes neutrally rather than implying the server is at fault.

### 6.2 Top-bar layout

Keep only the file box, the world box, and connect / disconnect / walk / orbit on the top line. Move the remaining top-right controls down a line, to the right of the My Worlds section (slug + world name), where there is plenty of empty space.

### 6.3 Public/private toggle per world

In the My Worlds list, give each world — including the home world created at account signup — a public/private toggle switch. There is room in the interface. Default to private. Ties into the "private" teleport failure reason in 6.4.

### 6.4 Longer term

- Server sends specific failure reasons (not found / private) over the socket.
- Client connects to the new world **before** leaving the old one, making "Go back" mostly unnecessary.
- Optionally make destination *resolution* as strict as Save validation, so typo pads are inert. Note T6 makes the leading `/` optional, so `hi` → `/hi` and `<3` → `/%3C3` resolve to valid-looking addresses with no world; resolution was deliberately left unchanged, so pre-existing lenient pads on DEV still misfire.

### 6.5 Open bugs

- **Hard-reload 404** (DEV and PROD, pre-existing): first load spins then 404s; a second reload works. Next occurrence, capture the exact URL, whether the 404 page is Caddy's or Node's, and devtools Network Remote Address + Timing with Preserve log on.
- **`packages/client/tests/client.test.js`** passes 31/31 then hangs (exit 124). Reproduced identically at base SHA. Deploy does not run client tests.

### 6.6 Housekeeping

- **PAT expiry:** a new fine-grained GitHub PAT (Contents: read/write on `joshmaurice/atrium`) was installed via `git -C $SC credential approve`. **Set a calendar reminder before it expires** — not yet done.
- DEV cleanup: throwaway accounts `acctest1`, `acctest2`, `tp-tester-1`, `tp-tester-2`, `tp-tester-a`, `tp-tester-b`; Hermes's world `tp-test-a` and its test pads including the `nosuchworld` one.
- `$SC` stashes: `stash@{0}` (Step 6 revision 3), `stash@{1}` (Step 5 debug). Untracked `_check_crate.js` in the teleporters worktree.
- **F-10:** a browser agent cannot move the avatar; a scripted smoke stage needs a test hook for avatar movement.

## 7. Process notes

**Pipeline:** brief (GLM, `t_4e6fb356`) → critique (Nemotron, `t_4270151d`) → implementation (DeepSeek, `t_cc428318`) → 4 revisions (`t_7524d949`, `t_376fb705`, `t_a1e69352`, `t_6056ea32`) → 4 review rounds (GLM: `t_1ca59593`, `t_be1c8c76`, `t_ff9d4946`, `t_f59e9886`). Publish/DEV deploy `t_36e2b4ba` / `t_84cbc630`. Archived: `t_4795c76a`, `t_bb5d817e`. Final tip `88032eea`.

- **[F-8] Nemotron remains unreliable.** Its round-2 critique approved a `displayName ?? null` bug, missed major issues, and promised a corrected brief but delivered "See metadata". A later adversarial review spent 20 minutes improvising around a blocked `pnpm install` — NODE_PATH, `pnpm link`, symlinking `node_modules` into the review worktree, which would have tested main's packages rather than the reviewed tip — instead of calling `kanban_block kind=capability`. Operator stopped it. GLM alone handled rounds 2–4.
- **Tirith scanner** (profile-level, 285+ patterns) intermittently refuses `pnpm install` ("[MEDIUM] Package threat intelligence could not be completed") and flags "[HIGH] Nested executable body" for piped/compound shell. Retries usually succeed. Every card should carry: retry install once, else `kanban_block kind=capability`; never symlink `node_modules`, set NODE_PATH, or `pnpm link`.
- **Looping worker, run 508.** A GLM worker sat "in progress" 27 minutes making ~20 repeated `kanban_show` calls with empty turns and intermittent exit-1 on trivial commands. Hermes wrongly reported the PID dead — it checked from inside its own sandbox while heartbeats were live. Recovery: OPERATOR BLOCK → `kill` → `docker ps -aq --filter label=hermes-profile=atrium-glm | xargs -r docker rm -f` → unblock. A fresh container finished the same work in 2m20s, so the container was the cause even though `docker exec … pwd` looked fine.
- **Operator control recipes.** `hermes kanban --board atrium block <id> --kind needs_input "OPERATOR BLOCK: …"` (the guard refuses agent unblocks when the reason contains OPERATOR BLOCK). Find worker PIDs with `grep -l "HERMES_KANBAN_TASK=<id>" /proc/[0-9]*/environ 2>/dev/null | cut -d/ -f3`, then `kill`. **Blocking alone does not stop a running worker.**
- **Publish failure.** `atrium_deploy(action="publish")` exited 128 with "Password authentication is not supported" — expired PAT. The deployer behaved correctly: one call, `capability` block. `/usr/local/sbin/atrium-publish-workflow` runs as root with `export HOME=/root`, no token in the script, credential helper `store`, and `/root/.git-credentials` had been zeroed when git rejected the old token. Fixed with a new fine-grained PAT via `git -C $SC credential approve`, verified with `git -C $SC push --dry-run origin <sha>:refs/heads/workflow/teleporters`. The F-7 guard marker then had to be removed before retry: `rm /root/.hermes/profiles/atrium-deployer/atrium-kanban-guard-state/deploy-t_36e2b4ba`, then unblock.
- **DeepSeek skipped `app.js`** in the first implementation, calling it "DOM-dependent" and out of scope, and overstated three handoff items. Recovery: split the remaining work into R1 (fixes/tests, `app.js` forbidden) and R2 (`app.js` wiring + T11 doc), chained parent→child so R2 auto-started, with a single review after both.
- **Guard/rules drift to fix:** orchestrator cards still quote the obsolete two-file `--test-force-exit` exception (update SOUL.md / the skill). GLM ran `git worktree remove --force` on its own review worktree despite the rule. Agents write scratch scripts to `/tmp` and created `/tmp/wt-base` to dodge the scanner.
