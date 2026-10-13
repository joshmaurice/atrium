# Atrium Passdown — 2026-10-12 (night) — Step 0c `send-field-allowlist`

**Predecessor:** `devtasks/Atrium-Passdown-2026-10-12-create-template.md`
(same evening). Its §6 follow-ups still hold, except where this file says
otherwise.

**First instruction for the next session's Claude: clone the repo and read
`devtasks/` before advising.** List `devtasks/` by date and read every
passdown newer than the one you think is latest.

## 1. Status at handoff

| Item | State |
|---|---|
| Release state | **COMPLETE** (2026-10-12 ~23:15 PT) |
| DEV / MAIN / PROD | all at `e8c7b621c419134d4ee80f136f80acd582c11471` |
| Base for this round | `9fc9a51c9cac28fbdc09c2db7a7926b32b55153a` (`main` plus the uploaded pre-brief) |
| Review branch | `review/send-field-allowlist-r1`, deleted after release |
| Workflow branch | `workflow/send-field-allowlist`, published |

**Board:**
- `t_e522243f` kickoff — done
- `t_3b72c601` GLM brief — done
- `t_c5df5c7f` brief-review gate — done (operator)
- `t_47c81b6b` DeepSeek implementation — done
- `t_8bf3fefc` GLM review — done, APPROVE
- `t_68ea37aa` review gate — done
- `t_712e9fc6` publish, `t_69464ca5` DEV deploy, `t_20781ea9` DEV finalizer
  — DEV state confirms them
- `t_c35c8d0b` DEV-acceptance gate — **completed by an agent, not the
  operator** (§3.3); the operator's closing comment was added afterwards
- `t_dd4c7af8` PROD gate — done
- `t_c10b7149` PROD deploy — PROD state confirms it
- `t_2f57017e` sentinel — done
- **Duplicates from the kickoff:** `t_a260b2ca` and `t_86e2e478`, plus the
  last round's `t_3856c806` and `t_826c3cd1`, are all `archived`.

## 2. What shipped (security)

**A client `send` can now make only an explicit list of edits.** Before this
change, a `send` named a target (`msg.node`) and a path (`msg.field`), and
`setPath` walked any JavaScript property. So:
- `parent.*` and `children[n].*` reached other nodes, bypassing every
  per-node check;
- an owner could write any field, including internals.

**What changed:**
- **New `packages/server/src/send-policy.js`** (`resolveSendTarget`,
  `authorizeSend`, `liveAvatarNames`), default deny:
  - the target is classified by the class of the resolved object;
  - the path must match a canonical spelling exactly;
  - World Info edits are authorized change by change;
  - each value is checked for type, length, enum and "finite".
- **`session.js` `case 'send'`, in order:**
  1. the avatar display-name guard;
  2. S2 (the source guard);
  3. the owner check (mutation gate);
  4. **the allowlist**;
  5. `world.setField`.
- **The raw `checkDestinationLength` is gone.** The 2048-character limit is
  now the teleporter leaf's value check.
- **Contract:** `devtasks/PREBRIEF-send-field-allowlist.md` (FINAL Rev 1),
  plus the operator correction on `t_47c81b6b`, which moved the allowlist
  after the owner check.

**What's allowed now:**

| Target | Edits |
|---|---|
| Node | `translation`, `rotation`, `scale`, `visible`; `mesh.primitives[N].material.{7 props}`; `extras.atrium.teleporter.destination` (on any node, ≤2048) |
| `<host>.camera` | `type`, `yfov`, `aspectRatio`, `znear`, `zfar`, `xmag`, `ymag` |
| `<host>.light` | `color`, `intensity`, `type`, `range`, `innerConeAngle`, `outerConeAngle` |
| Animation | `playback` |
| `__document__` | `extras`, with only the 12 World Info leaves allowed to change |

**What's refused:**
- rename;
- whole node `extras` and `extras.atrium`;
- mesh and primitive fields;
- cameras and lights addressed by their bare glTF names;
- any send to a live avatar, including by the owner.

**Commits:** `58a4b81`, `f650172`, `e8c7b62`.

**Tests:**
- **Server:** 19 files with 380 pass (336 + 44 new in
  `send-field-allowlist.test.js`). Every file exits on its own.
- **Clients:** `packages/client` 140; `apps/client` 191. 0 skipped anywhere.
- **Existing tests:** only the two whole-`extras` teleporter assertions
  changed (`INVALID_VALUE` → `PERMISSION_DENIED`).
- **Proofs (a)–(d):** all fail as required (13 / 10 / 3 / 9 tests in GLM's
  run).

**Verified three ways:**
- **DeepSeek's handoff:** complete, including every required field.
- **GLM's review:** APPROVE, with two minor findings needing no action.
- **Claude's outside review, on a clean install:**
  - **Tests:** the same counts.
  - **Proof (a):** re-run, 13 failures.
  - **Extra cases:** 15 policy probes on cases the tests don't name, all
    correct.
  - **`world-visibility.test.js`:** takes 60 s at the base too, so the time
    isn't new.

**DEV acceptance** (operator, 2026-10-12):
1. **The normal app:** signed in, walked around, placed, used and removed a
   teleporter, with two windows seeing each other.
2. **Forged messages through the protocol inspector**
   (`/tools/protocol-inspector/`, same origin, so it connects as the
   signed-in user):
   - **As a non-owner:** all three sends were refused by the owner check.
   - **As the owner:**
     - `translation` → `set`;
     - `parent.translation` → `PERMISSION_DENIED`, "field is not writable on
       a node";
     - whole `extras` → the same refusal.

## 3. Findings during the round

### 3.1 Code check of the pre-brief found two errors before implementation
- **The brief ran the allowlist before the owner check.** That would have
  failed `commons.test.js` L237, L268 and L291: non-owners sending to a
  missing node expect `PERMISSION_DENIED`, and would have got
  `NODE_NOT_FOUND`. The fix moved the allowlist after the owner check.
- **The brief's worktree command lacked `-b`.** The front door caught this
  one too.
- **Claude checked every `send` in the existing server tests** against the
  new rules before implementation. Only those three tests and the two
  teleporter assertions were affected.

### 3.2 Pre-brief mistakes found later (harmless)
- **The teleporter-leaf condition:** "only on a node that already has a
  teleporter" contradicted an existing test, which sends to a plain node.
  DeepSeek allowed the leaf on any node, which is no wider than before.
- **"The client never sends to an avatar" was half right.** It never sends
  to *its own* avatar. But `AvatarController.js` ~L162 gives each *peer*
  avatar a random local tint by setting `baseColorFactor`, and the client's
  material listener sends that.
  - **Before:** the owner's tint was accepted and overwrote the peer's
    material for everyone. Non-owners already got "Only the owner may
    mutate".
  - **Now:** everyone gets `PERMISSION_DENIED: live avatar nodes are
    server-controlled`. That refusal is correct.
  - **What's left** is console noise and per-viewer tints. Follow-up in §6.1.
- **The pre-brief's DEV plan assumed the SOM inspector on DEV as the
  owner.** That isn't possible:
  - DEV doesn't serve `/tools/som-inspector/` (2026-09-27 passdown).
  - A local copy connects cross-origin, so only anonymously.
  - **What's possible:** the protocol inspector, which DEV *does* serve,
    is the way to test as the owner. Use it for server-side checks in
    future DEV plans.

### 3.3 Pipeline observations
- **Kickoff graph damage:**
  - **The cause:** an orchestrator worker hit a tool-layer fault (tool
    calls echoed back instead of executed).
  - **The damage:** two duplicate gate cards, and the live gate created as
    `ready`.
  - **The orchestrator claimed "verified by read-back" anyway.**
  - **Recovery:** the front door checked card by card. The gate's own run
    then blocked it correctly.
  - **No harm done.** Keep checking the graph with `show` after kickoff.
- **The DEV-acceptance gate leaked.** `t_c35c8d0b` was created `blocked` at
  05:44.
  - **What happened:**
    1. It was promoted when the DEV finalizer finished (05:49).
    2. Orchestrator run 661 claimed it.
    3. That run *completed* it, with the summary `placeholder`, about 25
       minutes before the operator's DEV acceptance.
  - **The cause:** the review gate's run created the card with
    `initial_status="blocked"` only. It skipped the immediate `kanban_block`
    that worker-card rule §4 requires for exactly this gate. Then the agent
    dispatched onto the gate completed it, instead of blocking it.
  - **No harm done:** the host's MAIN and PROD approvals don't read the
    board. But the gate meant nothing this round. Follow-up in §6.1.
- **The front door said the old sentinel and gate were still open.** `show`
  said `archived`. Check its status claims with `show`.
- **The §4 worker rules from the evening passdown worked:**
  - both workers ran `pnpm install` in their own worktree and checked
    `readlink`;
  - `http-integration` passed without hanging, which confirms the stale
    dependencies caused last round's hang (create-template passdown §6.2);
  - the handoff was complete;
  - the reviewer posted progress comments.
- **GLM's review emitted a malformed tool call before `kanban_complete`, but
  recovered on its own.** The fallback providers weren't needed.
- **Copying the correction onto the review card** headed off a likely false
  "deviation" finding. Do this whenever a correction goes on the
  implementation card.
- **Durations:**
  - kickoff to brief: about 7 min;
  - implementation: 14 min;
  - review: 5.5 min;
  - kickoff to PROD: about 75 min, most of it the operator steps and the
    outside review.

## 4. Lessons
- **Check every pre-brief claim of the form "no client does X" against the
  code,** including peer and remote paths, not just the local user's
  listeners.
- **Before writing a brief, grep every existing test that exercises the
  changed handler.** That's what caught the ordering bug.
- **DEV acceptance must use tools DEV actually serves.**

## 5. What's next

### 5.1 In sequence
- **Phase 3 step 1 (Edit mode) pre-brief:**
  `docs/DESIGN-phase3-placement-scripting.md` §4 and §9. Steps 0, 0b and 0c
  are now done.
- **Step 1 will grow the allowlist,** for placement, models and later
  rename. Each addition is a reviewed change to `send-policy.js`: add the
  field to the right class with a value check. Never loosen the canonical
  matching.

## 6. Follow-ups

### 6.1 New
- **Make operator gates hold (pipeline, before the next round).** Two
  changes through the front door, in the atrium-workflows skill:
  1. **The review gate's instructions** must say that, in the same run, it
     calls `kanban_block` on the DEV-acceptance gate right after creating it,
     then reads it back, as rule §4 already requires. This round it didn't.
  2. **A rule for any agent dispatched onto a card titled `OPERATOR BLOCK:`
     or `Awaiting …`:** it calls `kanban_block(kind="needs_input")` on that
     card and nothing else. It never completes it.

  Check both in the next round's events.
- **Peer-avatar tint:** `AvatarController.js` ~L158–166 sets the peer
  material's `baseColorFactor` outside `_applyingRemote`, so the client
  sends it and the server now refuses it.
  - **Fix:** make the tint local-only, by setting it while
    `_applyingRemote` is true or by skipping peer-avatar nodes in
    `_attachNodeListeners`.
  - **Size:** small, client-only.
  - **Also consider:** per-viewer tint is the intended look.
- **`JSON.parse: unexpected end of data` (`readAsJSON`, platform-io.ts)** in
  the DEV console: client-side loading, not caused by this round. Check
  whether PROD shows it too.
- **The teleporter error message:** a non-string destination gets the text
  "destination exceeds 2048 characters". Cosmetic.
- **Externally loaded nodes in file worlds** are still writable like any
  node. They were deferred (pre-brief §8 item 5).
- **The pre-brief template's DEV plan** should use the protocol inspector
  for owner-only server checks.

### 6.2 Carried over
Everything in the create-template passdown §6.2–6.3 still holds:
- the stale `/workspace/atrium` checkout;
- the `file:///` DEV console error;
- the 2026-10-09 items;
- **the PAT expiry on 2026-10-29.**

The `http-integration` hang is resolved: it was the stale dependencies.

## 7. Recipes

`$SC` = `/root/.hermes/sandboxes/docker/default/workspace/atrium`

### 7.1 After this release (done)

**Commands run:**
```
git -C $SC push origin --delete review/send-field-allowlist-r1
hermes kanban --board atrium comment t_c35c8d0b "OPERATOR: DEV acceptance of e8c7b621 passed ..."
hermes kanban --board atrium show t_2f57017e | sed -n 1,3p
```

**Results:**
- **The review branch:** deleted.
- **The gate:** already `done` (§3.3), so the `complete` was refused.
- **The sentinel:** `done`.

### 7.1a Check whether an agent touched a gate
```
hermes kanban --board atrium show <gate t_id> | sed -n '1,4p;/^Events/,$p'
```
A `[run N] completed` event on a gate means an agent completed it.

### 7.2 Owner-only server checks on DEV
1. Open `https://dev.ewwb.dev/tools/protocol-inspector/` in a browser
   signed in as the world's owner.
2. Connect to `wss://dev.ewwb.dev/worlds/<username>/<slug>`, using the
   lowercase username as in the app's console.
3. Send `hello`, then the test messages.
4. Export the log and upload it.

**Watch out:** the browser's cookie decides who you are. Check
`displayName` in the `hello` reply.

### 7.3 Copy a file from the host to your computer
```
scp root@5.78.232.73:/root/<file> .
```
Run it on your own computer, not on the server.

### 7.4 Put a correction on both cards
After posting a correction on the implementation card (create-template
passdown §7.4):
```
hermes kanban --board atrium comment <review t_id> "OPERATOR NOTE for the reviewer: ... $(cat /root/correction-<slug>.txt)"
```
