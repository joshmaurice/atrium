# Atrium Passdown — 2026-10-24 — scripting-4b-1 (object identity and the script host), released

**Predecessor:** `devtasks/Atrium-Passdown-2026-10-23-scripting-4a.md`. Its
host, connector and convention notes still hold, except where this file says
otherwise.

**First instruction for the next session's Claude:**
1. Clone the repo and read `devtasks/`, newest first (this file first).
2. Use the `atrium-ops` connector for board, release, log and git state. It
   is read-only.
3. **Next up is Phase 3 step 4b-2** (§6.1): behaviours, owner-present. Its
   pre-brief doesn't exist yet. `devtasks/PREBRIEF-scripting-4b.md` §9 is
   its sketch, and the spike (`devtasks/spike-4b/`) is its evidence.
4. **Never push to `main` between a DEV deploy's release merge and the MAIN
   push** (4a passdown §4.4). This round kept to it: Claude's harness commit
   went to a `claude/` branch first (§4.4).

## 1. Status at handoff

| Item | State |
|---|---|
| Release | **COMPLETE** (2026-10-24 ~12:52 PT). DEV, MAIN and PROD are at `8358b0434fc6d61d104c0c8db07b60e10e3ad598`, recorded and healthy, with the deploy lock free. Checked through the connector |
| What `8358b043` is | The release merge of the reviewed tip `271553cc64102140f2963683d8b00263bc6f6892` with `main` `9535d76c` (the 4b-1 kickoff). The only difference is `devtasks/` |
| Spec | `devtasks/PREBRIEF-scripting-4b.md`, FINAL Rev 2.1 (66,498 bytes, sha256 `8d057ebc…427d`, at `da28c0cb`), plus the operator's brief-gate correction (the comment on `t_a0b63990`) |
| Decisions | B1–B6 and E-L1–E-L6 as recommended (operator, "approve all") |
| Rounds | One. GLM APPROVE with one MINOR and one NIT, no change requested |
| DEV acceptance | The operator, Firefox, on `8358b043` (~12:45 PT): §6 steps 1–5 pass. Step 4: a visitor has no Edit panel at all, so no host line. Claude's §5.1 checks 1–9 pass on `271553cc` (§3) |

## 2. What shipped
- **Every new object gets a stable id,** `extras.atrium.objectId`, a
  lowercase UUID v4 (E1, E7). The palette, the Model form, the teleporter
  form, the library and Duplicate give a new id; the palette retry and
  Undo/Redo re-adds keep the one they had. Names stay the protocol's
  identifiers.
- **One id rule in two copies** (client `packages/client/src/object-id.js`,
  server `send-policy.js`), both tested against
  `tests/fixtures/object-id-vectors.json`.
- **The SOM** (E2): external nodes recorded by identity (`isExternalNode`),
  `objectIdInUse`, `resolveObjectId` (`not-found`, `ambiguous`,
  `unaddressable`), and one narrow intermediate creation for
  `extras.atrium.objectId` only.
- **The server** (E3): `add` checks the id's form and uniqueness ("objectId
  is already taken in this world"); a set-once `send` of the leaf on a node
  without one; load healing in both world kinds drops an id held by two or
  more nodes from all of them, and drops malformed ids, one log line each.
- **The script host** (E4, E5): one owner session per world holds the role.
  `hello` carries `scriptHost` (and `hostGen` when true); the new
  `script-host` message hands the role over when the host leaves.
  `cleanupSession` is now identity-safe, a fix to existing behaviour (a late
  `close` of a terminated socket could remove the session that took its id).
- **The client** (E6): `client.scriptHost`, `script-host:changed`, the
  synchronous loss signal on every path that abandons a connection,
  `setObjectId`, and its own echo applied.
- **The Edit panel** (E8): "Script host: this tab" / "another tab or device"
  under the title. Visitors have no panel.
- **No caller yet** for `resolveObjectId` or `setObjectId`: 4b-2's runner and
  behaviour form are the first.

**Tests at release** (implementation handoff, re-run by GLM): server 579
(38 files, each run on its own), som 249, protocol 85, `packages/client` 525,
renderer-three 296, interaction 9, `apps/client` 993. Nothing skipped. All 20
proofs of failure reproduce.

## 3. How the round ran

| Step | Card or SHA | Notes |
|---|---|---|
| Kickoff | `t_225109de`; sentinel `t_e6855f30` | The kickoff body comment was truncated for the orchestrator; the front door added PART 2A–2C, and the operator unblocked with an explicit reason |
| GLM brief, then the gate | `t_3c286f03`, `t_fafa460f` | Claude checked it against the pre-brief: faithful. **One operator correction** on the implementation card before the gate: the brief is the three GLM BRIEF comments, and Duplicate adds the id before the `MAX_ADD_BYTES` check |
| Implementation | `271553cc` (`t_a0b63990`, 40 min) | Five commits, one per step. Deviation: the "name is also a material's" test uses an animation, because materials never register by name |
| GLM review | `t_36827c97` | APPROVE; reproduced all 20 proofs by breaking the code itself. MINOR: proof (a) pins both copies with shared vectors rather than breaking one copy. NIT: `_scriptHostRoleWarned` is never reset (logged once per page, not per `hello`) |
| Review gate | `t_a726927f` | APPROVE. The front door built the whole chain (Publish `t_fabd0628`, DEV deploy `t_b9ff5fa4`, finalizer `t_3bc01136`, acceptance `t_4a82cdf0`) but **couldn't complete the gate**: `kanban_complete` dropped `task_id` nine times (§4.2). The operator completed it on the host |
| DEV | `8358b043` | The finalizer blocked on the handoff gap again; verified on the host (4a passdown §5.2) |
| Claude's §5.1 checks | harness, `271553cc` | 1–8 pass; 9 (4a's, edit-polish-3's and library-sky's scripts) matches 4a's final run apart from noise (§4.3) |
| Release | `8358b043` | Acceptance `t_4a82cdf0`, MAIN, PROD (`t_bc604aca`) |

No outside review this round: the pre-brief had two, and GLM reproduced every
proof. 4b-2, which runs code from world files, should keep the outside
review of the whole round (4a passdown §4.2).

## 4. Findings and lessons

### 4.1 The pre-brief's two outside reviews paid off
Rev 0 drew 4 must-fix and 7 should-fix items, Rev 1 five should-fix. All were
confirmed and applied before the kickoff, and the round then passed in one
go with no findings that needed a change. For a contract this exact (E1–E9
with named proofs), the review before the kickoff is where the work is.

### 4.2 The front door, the deployer and the operator's commands
- **`kanban_complete` dropped `task_id`** for the front door, the same
  transport fault as the `kanban_create` field drops. A gate that only the
  front door may complete can then stall the chain silently: Publish stays
  `todo` with nothing failing. When a chain is built but Publish isn't
  `ready`, check the gate first.
- **The deployer's handoff gap,** every round since models-hardening: no
  `REVIEWED_SHA=`, `RELEASE_SHA=` or `SMOKE OK`. These lines are **not** in
  the journal (`journalctl | grep SMOKE` finds nothing), so verify with
  `atrium-release-status` (4a passdown §5.2), or run
  `devtasks/host-drafts/smoke-now.sh` for a real smoke run.
- **Host commands need `--board atrium`** (`hermes kanban --board atrium
  complete …`), as every recipe has it.

### 4.3 Claude's browser checks
- **New checks:** `devtasks/harness/checks/scripting-4b-1/` — `c1.py`
  (checks 1, 2, 3, 7), `c4.py` (4, 5, 6), `c8.py` (8). The harness server
  gained `/__doc` (a read-only look at the server's world) and `POST /__put`
  (load a given glTF as a saved-document or file world).
- **Check 5 (supersession):** the app's Connect button disconnects first, so
  it isn't supersession. The check calls `atriumClient.connect()` on the
  live connection, as a teleport does. Order seen: `script-host:changed`
  `active: false`, then `connecting`; the other owner tab became host
  (`hostGen` 3).
- **Check 9** compared each script's output with 4a's final run, ignoring
  numbers and ids. Differences: saved models now carry `objectId`; random
  avatar names; two fixture models loaded in a different order; a moved line
  number in an error stack. `sel3.py`: clicks on the restored Fox select
  `FoxLong`, which the script places at the same spot; outlines and panel fit
  are right.
- **DEV acceptance tip:** Firefox's console keeps a top-level `const`, so a
  pasted snippet run twice throws "redeclaration". Wrap snippets in `{ … }`.

### 4.4 `main` stayed still
The harness commit (`e1bc678`) went to `claude/harness-4b-1` during the
round and was merged into `main` only after PROD, with this passdown.

## 5. Recipes
The same as the 4a passdown §5. The commands this round used, in order:
```bash
# review gate, if the front door can't complete it
hermes kanban --board atrium complete <review gate>
# finalizer on the handoff gap
hermes kanban --board atrium complete <finalizer> --result "OPERATOR: DEV runs RELEASE_SHA <sha> (release merge of reviewed <sha40> with main <sha8>, devtasks/ only), verified on the host"
# accept, MAIN, then the guarded PROD block (teleport-rearm passdown §7.2) with the same S
S=<RELEASE_SHA>
hermes kanban --board atrium complete <acceptance gate> --result "OPERATOR: <slug> DEV accepted ($S; reviewed <SHA40>)"
atrium-main-approve $S && atrium-main-push $S
```

Checking ids on DEV (browser console, any world):
```js
{ const rows = atriumClient.som.allNodes.filter(n => n.extras?.atrium?.objectId).map(n => ({ name: n.name, id: n.extras.atrium.objectId }))
  console.table(rows); console.log('all different:', new Set(rows.map(r => r.id)).size === rows.length) }
```

## 6. Follow-ups

### 6.1 Next: Phase 3 step 4b-2 — behaviours, owner-present
- **Its own pre-brief,** from `PREBRIEF-scripting-4b.md` §9: storage
  (`extras.atrium.behavior`), the runner only in the `scriptHost.active`
  session, the script API as far as the templates need it, the five
  templates, and the adapter as the spike supports it (§9.2: step budget,
  pending-delay cap, one engine per behaviour per load, cleanup, pointer
  authorization, rejection of invalid graphs).
- **It's the round that runs world-supplied graphs,** so keep both outside
  reviews (the pre-brief, and the whole round from base to tip).
- **Carried into it:**
  1. 4a's five items (4a passdown §6.1): the clip select in a second owner
     tab, per-frame work for stopped models, Stop on a model with no clips,
     one-pose selection bounds, the clock tests not yet written;
  2. GLM's NIT: reset `_scriptHostRoleWarned` per connection, if the warning
     should repeat;
  3. the Rev 0 review's items in §9.1 of the pre-brief.

### 6.2 New this session: signed in on the page, anonymous on the server
- **What the operator saw:** a tab left signed in for a long time visited
  another world; other users saw it as `User-xxxx`. A reload fixed it.
- **The likely cause, from the code:**
  - auth sessions expire 7 days after login, with no renewal on use
    (`http-routes.js`: `expiresAt` at L313/L422; the cookie's Max-Age);
  - the page checks `/api/auth/me` once, at load (`app.js`), and never
    again, so the top bar keeps the stale name;
  - a WebSocket upgrade with an expired or missing session is admitted
    anonymously with no signal (`resolveUpgradeUserId` returns null); the
    client then adopts the server's `User-xxxx` (`AtriumClient.js` L948),
    shown only in the "You:" label.
- **Not confirmed:** if the reload showed the user signed in **without**
  signing in again, the session hadn't expired and the cause is elsewhere.
  The server logs neither sign-ins nor connections.
  `SELECT u.username, s.created_at, s.expires_at FROM auth_sessions s JOIN users u ON u.id = s.user_id`
  on the host shows when each sign-in started.
- **Proposed fix (a small round):**
  1. renew a session past half its life on use (or lengthen it);
  2. re-check `/api/auth/me` before each connect or teleport and when the
     tab becomes visible; on 401, show signed out with "Your sign-in
     expired";
  3. the server's `hello` says whether the session is authenticated; a
     signed-in page admitted anonymously re-checks and shows the mismatch.
     This catches the case whatever its cause.

### 6.3 New this session: `KHR_animation_pointer` models
- Khronos's `AnimationPointerUVs.glb` has animations, none of them playable:
  its channels use `KHR_animation_pointer`, which three r163's `GLTFLoader`
  skips (no `target.node`).
- **Panel text:** today it reads as a model with no animations. Say "has
  animations, none playable here" instead.
- **Playback:** later, with 4d's work on world animations (the same pointer
  mechanism as the interactivity engine's `pointer/*`).

### 6.4 Small host round (still open)
The 4a passdown §6.2, plus: the front door's `kanban_complete` drops
`task_id` (§4.2).

### 6.5 Client and server follow-ups (recorded, not done)
The edit-polish-3 passdown §6.3, items 1–6 and 8, are unchanged.

## 7. Cleanup (operator, host)
```bash
git -C /root/lib-install push -q https://github.com/joshmaurice/atrium --delete \
  workflow/scripting-4b-1 release/271553cc6410 claude/harness-4b-1
git ls-remote https://github.com/joshmaurice/atrium   # main only
```
