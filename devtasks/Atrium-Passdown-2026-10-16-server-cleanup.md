# Atrium Passdown — 2026-10-15/16 — Phase 3 server cleanup round (full pipeline)

**Predecessor:** `devtasks/Atrium-Passdown-2026-10-14-ops-connector.md`. Its
host and connector state still holds, except where this file says otherwise
(the DEV least-privilege migration is now finished, §1).

**First instruction for the next session's Claude:**
1. Clone the repo and read `devtasks/`, newest first.
2. If the `atrium-ops` connector's tools are listed, use them for board,
   release, log and git state instead of asking the operator to paste it.
   The connector is read-only (§5.1).

## 1. Status at handoff

| Item | State |
|---|---|
| Release | **COMPLETE** (2026-10-16 08:02 PT) |
| DEV / MAIN / PROD | all at `27486bdf7beda558f3a9102262029703be7f5902` |
| Base | `e2b4d18aa2154b09dbca8a0efd54a830b3e9ff41` (`main` plus the uploaded pre-brief) |
| Spec | `devtasks/PREBRIEF-server-cleanup.md`, FINAL Rev 5, sha256 `c4a5c752…2ec305` |
| Branch | `workflow/server-cleanup`: deleted by the operator after PROD |
| DEV least-privilege | **`--finish` done** 2026-10-16 after this round's DEV deploy: pre-migration trees, script backups and the pre-migration DB backup deleted. DEV runs as `atrium-dev`; installs and tests as `atrium-build` |
| Board | clean: nothing ready, running, blocked or in triage |

**Board, this round:**
- kickoff `t_fb34918c`; sentinel `t_944bd3dd`;
- GLM brief `t_e4e0eb1f`; brief-review gate `t_e24d1a6c`;
- implementation `t_b43fb20f` (archived after triage, §3.5), continued on
  `t_d8916d83`;
- GLM review `t_0d1f4aa4`: **APPROVE** of `27486bdf`;
- review gate `t_875613ad`; publish `t_f6e09d5b`; DEV deploy `t_a263227e`;
  DEV finalizer `t_eb6414ce`;
- DEV-acceptance gate `t_16bc6298` (completed by the operator, with the
  outside review and acceptance recorded as comments);
- PROD gate `t_0f684092`; PROD deploy `t_9ae39c23`.

## 2. What shipped

`packages/som`, `packages/server`, `packages/client` (one change), and new
server tests. No protocol change, no `apps/client` change.

- **Resources are pruned** (L1, L2; new `packages/som/src/prune.js`). Removing
  a node disposes every mesh, primitive, morph target, material, texture,
  accessor, buffer, skin, camera and light it used that nothing else uses.
  Dependencies are collected before disposing. Clients run the same SOM, so
  they prune too.
- **Shared cameras and lights** (H12): per-host cleanup; the shared wrapper and
  its alias move to the surviving host.
- **One `serialize` for both world kinds** (L3):
  - buffers **and images** embedded (H13: saves used to drop every texture);
  - exclusions (avatars, external content) by node identity, mapped to node
    indices, with the copy checked before anything is disposed
    (`SERIALIZE_INDEX_MISMATCH`);
  - a kept animation channel or skin that uses an excluded node is refused
    (`SERIALIZE_EXCLUDED_REFERENCED`);
  - the live document is never touched.
- **Heal on load** (L4, K2 as narrowed): document worlds prune unreferenced
  resources when they load. Nodes are never removed. The log gives counts
  only. The heal reaches the database at the world's next owner edit.
- **`add` checks** (L5, K4 as ruled, §4.1): non-avatar `extras.atrium` and
  teleporter shapes, one destination checker shared with `send`; an avatar
  `add`'s `extras.atrium` must be absent or exactly `{ ephemeral: true }`.
- **Transform ranges** (L7, K6): unit quaternions (`|‖q‖ − 1| ≤ 1e-3`) and
  non-zero scale (`|s| ≥ 1e-6`) on `send` and `add`, avatar adds included.
  Negative scale allowed.
- **Duplicate names** (L6, K5(b)): one node per name, first registered wins in
  both maps; the next node takes the name over on remove or rename. The
  `name` setter and the client's own rename pass the resolved target. Client
  listeners on every node, sending only while the node is addressable
  (`getObjectByName(node.name) === node`), material callbacks included;
  camera and light aliases read at send time.
- **Payload cap** (L9, K7): `maxPayload` 1 MiB; an oversized message closes the
  connection with 1009.
- **Avatar ownership** (L11, K9, the security fix): unique avatar names at
  `hello` (`-2`, `-3`… on a collision); `session.avatarNode` records the node
  an accepted avatar `add` created, and `view`, disconnect cleanup,
  `liveAvatarNames`, autosave and the HTTP save route all use it. Before
  this round, any visitor could move and delete another visitor's avatar
  (H15).
- **Audit script** (L10): `packages/server/scripts/audit-document.js`,
  read-only, one document on stdin, counts, prune dry run (on a copy),
  detached roots, dangling references. Recipe §8.2.
- **`external-refs.test.js`** moved into `packages/server/test/` and brought
  up to the current contract (L8).

**Tests:**
- server 427 → **492** over 21 → **32** files;
- som 200 → **224**;
- unchanged: protocol 71, packages/client 169, apps/client 294,
  renderer-three 64, interaction 9.
- All `fail 0`, `skipped 0`, every server file under 62 s (world-visibility is
  the slowest).
- Proofs (a)–(aa), 27 breaks, each reported by the implementer with failing
  test names. GLM reproduced six; the outside review reproduced (b) and (j).

**Effect, measured:**

| World | Before | After |
|---|---|---|
| DEV commons | 33 meshes, 29 orphaned | heal removed 29 meshes, 87 accessors, 29 buffers |
| DEV `sep28` (BevOnDev) | 431,191 bytes, 50 orphans | **21,660 bytes** after one owner edit; audit clean |
| PROD commons | 286,686 bytes, 34 of 38 meshes orphaned | heal removed 34 meshes, 102 accessors, 34 buffers at the restart; the row shrinks at the next owner edit |
| 20 visitor sessions (probe) | 11.8 KB → 175.6 KB | 11.8 KB → 11.8 KB |

## 3. How the round ran

1. **Pre-brief:** Rev 0 drafted from probes against the real code; K1–K8
   approved; two ChatGPT reviews (24 and 12 findings, all accepted after
   checking). The second found H15, the avatar takeover, and K9 was added.
   FINAL Rev 5.
2. **Kickoff** through the front door, spec pasted as 8 parts. It raced the
   posting (§3.1).
3. **GLM brief:** blocked once for the worker-card file it can't read (§3.2),
   then delivered a sound brief.
4. **Brief-review gate:** caught by the front door the moment it turned
   `ready` (§3.3). Released by the operator with one correction (L6(a) has a
   `packages/client` half).
5. **Implementation:** 4 runs over 2 cards (§3.4, §3.5). Two spec errors found
   by DeepSeek (§4.1).
6. **GLM review:** APPROVE, six proofs reproduced.
7. **Publish, DEV deploy, finalizer:** clean. The sentinel fired at the real
   end (the front door had re-parented it, §3.6).
8. **Outside review (K8):** Claude, in its own checkout: APPROVE, minor
   findings only (§6).
9. **DEV acceptance:** pre-brief §9 steps 1–9 and 7a, all passed, after one
   false alarm from browser cache (§4.2).
10. **`--finish`**, MAIN, PROD.

### 3.1 The kickoff card was claimed while its spec was half posted
- The front door created the kickoff `ready`, then posted the 8 parts in
  turn. The orchestrator claimed it 35 s later with 2 parts up and blocked,
  correctly.
- **It used the `OPERATOR BLOCK:` prefix** (copied from the kickoff body's gate
  wording), so only the operator could release it.
- **Fix, recorded in the skill by the front door:** create the kickoff
  `blocked`, post every part, then release it; and a kickoff body that quotes
  `OPERATOR BLOCK:` must tell the orchestrator not to reuse it.

### 3.2 Worker containers can't read the worker-card requirements
- The file lives in the host's default profile skills, not mounted in worker
  containers. Card bodies that said "paste it from the skill, else block"
  stranded the GLM brief.
- **Fix:** the front door posted it as a comment (407 on `t_e4e0eb1f`) and
  pointed later cards at it. Next round it goes on the kickoff card beside the
  spec parts, and card bodies reference the comment, never the path.

### 3.3 Worker-card requirements §4 can't be followed as written
- §4 says the run that creates a gate must `kanban_block` it. The kernel lets a
  run block **only its own card** ("You cannot complete, block or archive
  other cards"). So no creating run can do it; this is likely why gates have
  leaked since 10-13.
- **What actually protects a gate:** whoever sees it turn `ready` blocks it.
  This round the front door did it for the brief gate, 13 s after promotion;
  the agent dispatched onto the acceptance gate did it, 4 s after claiming.
- **§4 needs rewriting** to the mechanism that works. A body line telling the
  dispatched agent to block and do nothing else, plus the front door watching
  for promotion. Not done this round.

### 3.4 Implementation runs: two budgets, neither the card's cap
- Run 704 stopped after 7½ minutes on its own estimate that the round
  wouldn't fit 90 minutes. Run 705 did two steps in 38 minutes and stopped
  early again.
- Run 706 (continuation, 3-hour cap) died after 16½ minutes: **"Iteration
  budget exhausted (150/150)"**. Each run gets 150 agent iterations, whatever
  `--max-runtime` says. The dispatcher retried it (run 707), which finished.
- **Lessons:** size `--max-runtime` at creation (it can't be changed later);
  expect a wide round to need several runs because of the iteration budget;
  give the implementer an ordered step list with a commit per step, as this
  round did.

### 3.5 Triage is a dead end
- Two `needs_input` blocks in a row (both CONTINUE stops) tripped
  `block_loop_detected` and sent `t_b43fb20f` to **triage**.
- From triage, `block`, `unblock`, `promote` and `schedule` all refuse; only
  `specify` and `decompose` leave it, and both have an LLM rewrite the card.
- **Recovery used** (recipe §8.4): a continuation card, created with the done
  gate as parent and `--max-runtime 3h`, its body deferring to the old card's
  body and comments; link it to the review card, *then* unlink the old card;
  archive the old card.
- **Avoid it:** a stop-and-continue plan should alternate block kinds, or the
  operator re-blocks with a generic block before unblocking.

### 3.6 The sentinel
The graph allowed "the review gate or the DEV finalizer" as the sentinel's
parent; the orchestrator picked the review gate. The front door re-parented it
and recorded the rule: the sentinel hangs off the DEV finalizer, never the
review gate. It fired at the true end.

### 3.7 Operator commands pasted into Telegram
Twice, host or browser commands were pasted in the wrong place (Telegram, the
VPS shell for a browser snippet). Hermes then guessed at a "wrong DB". Every
command block from Claude is now labelled **(VPS shell)**, **(browser
console)** or **(for Hermes)**.

## 4. Findings

### 4.1 Two pre-brief errors, both caught by the implementer
- **K4's premise was wrong.** `AtriumClient.connect` (~L359–362) adds
  `extras.atrium.ephemeral = true` to every avatar `add`, and `peerCount`,
  `apps/client` and the SOM inspector use it. Refusing any `extras.atrium`
  would have refused every visitor. **Operator ruling:** absent, or exactly
  `{ ephemeral: true }`; everything else refused.
- **§7.3's claim** that no server test expected a disconnect `remove` from a
  session without an avatar was false: three did (edit-plumbing A2,
  world-visibility 3c and Finding 2b). Updated under L11.
- **Lesson:** a pre-brief claim about "what the client sends" must quote the
  sending code, not the builder. And "no test does X" needs a grep across every
  test file, quoted.

### 4.2 Browsers keep running old modules after a deploy
- DEV acceptance step 6 first failed: 3 visitors left 3 capsules in the
  owner's tab. `typeof atriumClient.som.allNodes` was `undefined`: **the tab
  was running pre-deploy SOM code from cache.** After a hard reload it passed.
- **Cause:** Caddy serves `/apps` and `/packages` without `Cache-Control`, so
  Firefox reuses modules heuristically. Visitors can run stale code, or a mix
  of old and new modules (new `AtriumClient` with an old `SOMDocument` would
  throw on load).
- **Follow-up (host, small):** `Cache-Control: no-cache` for `/apps/*` and
  `/packages/*` on DEV and PROD, or versioned module URLs. Add a DEV-acceptance
  step: confirm the tab runs the new code (a marker like `allNodes`).

### 4.3 A test that couldn't fail
`visitor-leak.test.js`'s end-to-end case ("B joins and leaves 10 times, A's
SOM is back to its counts") uses avatars `{ name, translation }` **with no
mesh**, so it can't detect a client-side mesh leak. The code is right (a probe
with real capsule avatars passed), but the test needs
`buildAvatarDescriptor()` avatars. Follow-up.

### 4.4 Outside reviews earned their place again
The second ChatGPT review of the pre-brief found the avatar takeover (H15),
the round's most serious fix. Every finding from both reviews was checked
against the code before acceptance; several were confirmed by new probes.

### 4.5 The connector's `deploy_status` takes the deploy lock
`atrium-deploy status` takes the deploy lock while it runs, so a
`release_status` called at the same moment shows `DEPLOY LOCK: HELD`. Harmless,
but don't call `deploy_status` during a deploy.

## 5. Notes for Claude sessions

### 5.1 The ops connector
- **Read-only:** `kanban_list`, `kanban_show` (with `full_summary`), logs, git
  on its own mirror, release and deploy status, `read_file` for a fixed list.
  It can't comment, unblock, move or create cards; those are host commands.
- **`kanban_show` output over ~65 KB** is saved to a file instead of returned,
  and long fields are trimmed in the middle.
- **Workflow branches are invisible** to it until published.
- `kanban_list` with `status: archived` returned nothing although cards were
  archived; read archived cards with `kanban_show`.
- **`read_file` for `devtasks/*.md` didn't see a file `git_fetch_mirror` had
  just fetched** (2026-10-16: the fetch reported `origin/main` at `b41bb29`,
  and `read_file` of the passdown added in that commit failed with "does not
  exist in refs/remotes/origin/main"). It may read a different clone or ref
  than the fetch updates. Check when the connector is next worked on.

### 5.2 Watching the board
Claude can't wake itself without a scheduled check-in, which the operator sees.
What worked: no check-ins during long implementation runs; the operator says
when Hermes reports something; check-ins only for short, time-bound waits (a
gate about to promote, a PROD deploy).

### 5.3 Outside code review from a Claude session
Fetch the published `workflow/*` branch from GitHub, make a separate worktree,
`pnpm install --frozen-lockfile --prefer-offline`, run every suite, re-run the
pre-brief's probes against the new code, read the diff against the contract,
and reproduce a few proofs (break, run, `git checkout --`).

### 5.4 Pushing from a cloud session
A pre-brief draft went on a `claude/prebrief-*` branch to keep the session's
stop hook satisfied; the operator uploaded the final to `main` and deleted the
branch. Deleting a remote branch from the session fails (git proxy).

## 6. Follow-ups

### 6.1 From this round
1. **`Cache-Control: no-cache`** for `/apps` and `/packages` (§4.2). Host, small.
2. **`checkNewName` should refuse names reserved by live sessions.** An owner
   can create a node named like a connected visitor's reserved avatar name
   before that visitor's avatar `add`; the visitor then has no avatar. Owner's
   own world only. Small server fix.
3. **The end-to-end visitor test needs real avatars** (§4.3).
4. **Stale comment** at `session.js` ~L786 ("Refuses any own extras.atrium,
   including {}").
5. **H11 partial:** `serialize` is shared; `removeNode`, `setField` and
   `addNode` are still duplicated in both world kinds.
6. **Rewrite worker-card requirements §4** to the mechanism that works (§3.3),
   and post the canonical block on kickoff cards (§3.2).
7. **Detached nodes** are counted in the heal log, never deleted (K2 as
   narrowed). All DEV and PROD loads so far logged 0. Decide later whether
   they ever need handling.
8. **Geometry limits on `add`** beyond the 1 MiB cap (out of scope here).

### 6.2 Next in sequence
1. **1b-2:** add palette, delete with confirmation and the "includes N
   children" warning, duplicate per D5. Prototype lane. Delete is now cheap.
2. **Step 2:** undo and redo.
3. **Host:** connector Pass B (writes), gated on S22 (`atrium-main-push`'s D7
   git hardening); then PROD least-privilege; P10.

### 6.3 Carried
- **The GitHub PAT expires 2026-10-29.**
- From the ops passdown: root SSH accepts a password; `hermes.ewwb.dev` is
  public behind Hermes's own login; the Hermes Docker sandbox runs as root;
  merge `claude/least-privilege` and `claude/pass-a` into `atrium-ops` `main`.
- From 2026-10-13: M/Escape; unused `addons/` import maps; the `sslip.io`
  health checks; the static-world fallback 404 (`JSON.parse: unexpected end of
  data`, seen again on DEV); DEV leftovers (`grp-test`, `pad-in-grp`,
  `hermes-devcheck`, `ep-check`).

## 7. Corrections to the pre-brief (it stays on `main` as FINAL)
- §4 K4 and §5 L5, avatar adds: as ruled (§4.1).
- §7.3: three tests did expect the disconnect `remove` (§4.1).
- §8 "28 suites": the deploy lists 7 package suites; new server test files join
  the `server` suite automatically (it globs `packages/server/test/*.test.js`,
  `atrium-ops` `host/lib/atrium_host/buildrun.py`). Each file has a 180 s
  timeout; the server suite 40 minutes.

## 8. Recipes

### 8.1 Saved-world sizes and orphan meshes (VPS shell, read-only)
```
DB=/var/lib/atrium/atrium.db   # DEV: /var/lib/atrium-dev/atrium.db
sqlite3 -readonly $DB "SELECT w.id, u.username, w.slug, length(w.document) AS bytes,
  json_array_length(w.document,'\$.meshes') - (SELECT count(DISTINCT json_extract(n.value,'\$.mesh')) FROM json_each(w.document,'\$.nodes') AS n) AS orphan_meshes
FROM worlds w JOIN users u ON u.id = w.owner_user_id WHERE json_valid(w.document) ORDER BY bytes DESC LIMIT 20"
```

### 8.2 Audit one world (VPS shell, read-only)
```
DB=/var/lib/atrium-dev/atrium.db; ID=<world id>
sqlite3 -readonly $DB "SELECT document FROM worlds WHERE id='$ID'" \
  | sudo -u atrium-dev /usr/local/bin/node /srv/atrium-dev/packages/server/scripts/audit-document.js
```
For PROD, use `/var/lib/atrium/atrium.db` and `/srv/atrium/...`; PROD still
runs as root, so run the script as any unprivileged user that can read it.

### 8.3 Is this tab running the new code? (browser console)
```js
typeof atriumClient.som.allNodes   // 'object' at 27486bdf or later; 'undefined' means cached old modules
[atriumClient.som.meshes.length, atriumClient.som.materials.length, atriumClient.som.document.getRoot().listAccessors().length]
```

### 8.4 A card stuck in triage (VPS shell)
```
NEW=$(hermes kanban --board atrium create "<title> (continuation)" \
  --assignee <profile> --parent <done gate id> --max-runtime 3h \
  --body "$(cat /root/<continuation body>.txt)" | grep -oE 't_[0-9a-f]{8}' | head -1)
echo "NEW=$NEW"
[ -n "$NEW" ] || { echo "create failed — stop here"; false; } && \
hermes kanban --board atrium link "$NEW" <downstream review id> && \
hermes kanban --board atrium unlink <triaged id> <downstream review id> && \
hermes kanban --board atrium comment <triaged id> "OPERATOR: superseded by $NEW" && \
hermes kanban --board atrium archive <triaged id>
```
Link before unlinking, or the downstream card loses its last open parent and
starts.

### 8.5 MAIN and PROD
As `Atrium-Passdown-2026-10-01-step8-ui-polish.md` §8.1 (MAIN) and
`Atrium-Passdown-2026-10-13-teleport-rearm.md` §7.2 (PROD, guarded on release
state). `atrium-deploy-prod` takes an integrity-checked DB backup to
`/var/backups/atrium-prod/` and restores it on a failed deploy.
