# Atrium Passdown — 2026-10-23 — edit-polish-3, released

**Predecessor:** `devtasks/Atrium-Passdown-2026-10-22-library-sky.md`. Its
host, connector and convention notes still hold, except where this file says
otherwise.

**First instruction for the next session's Claude:**
1. Clone the repo and read `devtasks/`, newest first (this file first).
2. Use the `atrium-ops` connector for board, release, log and git state. It
   is read-only.
3. **Next up is Phase 3 step 4a** (§6.1):
   - its pre-brief, `devtasks/PREBRIEF-scripting-4a.md`, is FINAL Rev 1.2;
   - its kickoff, `devtasks/KICKOFF-scripting-4a.md`, is written from this
     release's commit.

## 1. Status at handoff

| Item | State |
|---|---|
| Release | **COMPLETE** (2026-10-23 ~01:48 PT). DEV, MAIN and PROD are at `100365758e75c8880897fa5ceb48693fdc810415`, recorded and healthy, with the deploy lock free and nothing open on the board. Checked through the connector. |
| What `10036575` is | The release merge of the reviewed round-2 tip `7cd20655f68a8ae4c48cb180575c34cf9d62a627` with `main` `f4e7260`. The only difference is `devtasks/`: the kickoff, the revision and the step 4 pre-brief. |
| Spec | `devtasks/PREBRIEF-edit-polish-3.md`, FINAL Rev 1.1 (sha256 `031b140d…1dec`, at `dcd5fa6e`). Round 2: `devtasks/REVISION-edit-polish-3.md` (sha256 `9cb39def…fb25`, at `933bdc72`). |
| Decisions | S1, S2, L1–L6, all (a) (operator, 2026-10-22 21:28 PT). Round 2 approved 2026-10-23 00:10 PT. |
| DEV acceptance | The operator, 2026-10-23 ~01:41 PT, on `7cd20655` (§6 list, all six pass). Claude's ten browser checks, plus V1 and V2, pass on `7cd20655` (§3). |

## 2. What shipped
- **HUD world name** (Z1): one writer, `showWorldName`. It's called on load
  and from the `__document__` branch of `som:set`, so a rename from another
  session shows at once.
- **Edit off closes the panel's forms** (Z2):
  - `createFormGate().closeCurrent()`, then `modelForm.reset()`;
  - the Model form's URL box always mirrors its state, and `reset()` clears
    it even when it has focus (r2 V2).
- **Owned versus not-owned answers** (Z2). A form handles its own answers
  completely, including selecting its new node. A late answer for a model or
  pad whose form has closed:
  - selects nothing;
  - keeps its undo entry;
  - shows the generic error only on a rejection.
- **`teleporter-form.js`** (Z3): the destination form as a module, with
  fake-element tests.
  - Save hides the old error.
  - A world list belongs to the opening that asked for it.
  - A late list keeps the chosen destination (r2 V1).
- **Sky:**
  - a refused value is logged once per value (Z4);
  - catalog skies are recognised by path, from any origin, and an empty `?`
    or `#` doesn't count (Z5, r2 V4);
  - an unchanged pick sends nothing.
- **Key-wiring guard** (Z6): the scanner strips comments, including inside
  `${ … }` (r2 V3). It reads the listener's third argument exactly: quoted
  keys, the last `capture` wins, and a spread or computed key is "unknown
  options".
- **Spawn note** (Z7): `padNearSpawn` checks each pad's own world position.
  `refreshSpawnNote()` runs on selection, during a drag, on a typed
  transform, on undo, and on changes to descendants.
- **Model answers** (r2 V5): an owned unknown answer shows only the form's
  own message.

**Tests at release:** `apps/client` 879 (from 766), renderer-three 271,
`packages/client` 391, server 530 (34 files), som 234, protocol 71 and
interaction 9. Nothing was skipped, and every file exits on its own.

## 3. How the round ran

| Step | Card or SHA | Notes |
|---|---|---|
| Pre-brief | Rev 0 → Rev 1 (outside review: 3 must-fix, 3 should-fix, 1 nit) → FINAL Rev 1.1 | The review caught two bugs wider than it reported (§4.3) |
| Kickoff | `t_7087da37` | **Clean: one kickoff, no strays.** The front door checked the hash and posted it; the kickoff only copied it |
| GLM brief, then the gate | `t_600b6eac`, `t_7b85413a` | Faithful (39 s) |
| Round 1 | `a3ec6537` (`t_656e0e80`, review `t_540e526c`) | APPROVE; 21 proofs; Claude's browser checks 10 of 10 |
| Round-1 release chain | `t_66427677`, `t_4d08820e`, `t_fd8d7555`, `t_058cea77` | **The front door built only Publish and left the review gate blocked** (§4.1). The operator re-prompted it with the full chain. The DEV deploy blocked on the truncated handoff (§4.2); verified on the host |
| Outside code review of `a3ec6537` | Conditional GO: 3 should-fix, 2 nits | Finding 2 reproduced in the browser (§4.4) |
| Round 2 | `7cd20655` (`t_e6ab638e`, review `t_9c3ea9b4`) | V1–V5; 24 proofs re-run by the reviewer |
| Round-2 release chain | `t_71006236`, `t_10db1f88`, `t_ca4de21e`, `t_0e3f9f33`; sentinel `t_39d84936` | **Built whole, then the gate completed.** The finalizer blocked on the truncated handoff; verified on the host |
| Release | `10036575` | Acceptance, MAIN, PROD. Round 1's gate `t_058cea77` was superseded |

## 4. Findings and lessons

### 4.1 The front door stopped after the first release-chain card
- **What happened:** on round 1's APPROVE it created only `Publish
  workflow`. It created no DEV deploy, finalizer or acceptance gate, never
  linked the sentinel, and never completed the review gate, so Publish sat
  in `todo`.
- **The fix that worked in round 2:** say it in the instruction itself:
  - "build the WHOLE release chain in one go";
  - name the round-1 cards as templates;
  - "link the finalizer to the sentinel, only then complete the gate,
    report every id".
- **Put this wording in the front door's skill** (§6.2).

### 4.2 The deployer's handoff is still cut short
Both rounds lacked `REVIEWED_SHA=`, `RELEASE_SHA=` and `SMOKE OK:` lines, and
the deployer behaved inconsistently:
- round 1's deploy card blocked;
- round 2's completed, with caveats, and the finalizer blocked instead.

Verifying from the host (library-sky passdown §5.2) worked both times. The
fix is still the small host round.

### 4.3 Reviews keep finding what tests and checks miss
- **The pre-brief review** found two bugs wider than it reported:
  - the Model form never wrote its URL box at all, even on reset;
  - the Model form also stole the selection with a late answer.
- **After GLM's APPROVE and Claude's ten browser checks,** the outside code
  review still found a real bug (§4.4), a test gap (V3) and two smaller
  issues.
- **Keep both outside reviews:** of the pre-brief and of the published SHA.
  Browser checks should include **slow-network timing** for any form that
  loads data while the user is choosing.

### 4.4 A late world list erased the chosen destination (fixed in r2 V1)
- **Reproduced:** with a 2 s `/api/worlds`, the user picks "The commons"
  while the list loads. The list arrives and the select is rebuilt, its
  value goes back to the placeholder, and Save stays enabled. Save then
  fails with "Select a world…".
- **Now:** the adapter re-selects the chosen value when the list arrives,
  and the form re-derives Save from what is actually chosen.

### 4.5 Notes for Claude's browser harness
- **Playwright's sync API only processes `route_web_socket` traffic during
  its own calls.** `time.sleep` holds back forwarded messages, which looks
  like an answer that never came. Use `page.wait_for_timeout(ms)` in any
  check that stubs or holds WebSocket messages.
- **A server started with `nohup … &` dies when the reply ends.** Start the
  harness server with the Bash tool's `run_in_background` and a long
  timeout.
- **A structural request in flight blocks other adds** (1b-2's
  one-at-a-time rule). To test a late answer, add the other object first.
- **Harness additions this round:**
  - `/api/worlds` with a delay control;
  - `window.__ep()` (forms, gate, selection, gizmo);
  - a `grp*` world with an offset child pad in a rotated group
    (`harness/group.gltf`).

### 4.6 Small observations (recorded, not fixed)
- **The renaming session's own HUD** doesn't change when it renames through a
  raw document send, because the server doesn't echo a session's own change
  back as `som:set`. The main client has no rename control, and the SOM
  Inspector's rename updates every open client.
- **A not-owned rejection shows its error regardless of Edit mode** (round 1
  deviation 2). It's visible once Edit is back on, as the Library grid's
  already was.

## 5. Recipes
The same as the library-sky passdown §5, plus:

### 5.1 Accept, MAIN and PROD (as run this round)
```bash
S=<RELEASE_SHA>    # atrium-release-status REVIEWED = DEV
hermes kanban --board atrium complete <acceptance gate> --result "OPERATOR: <slug> DEV accepted ($S; reviewed <SHA40>)"
atrium-main-approve $S && atrium-main-push $S
# then the guarded PROD block (teleport-rearm passdown §7.2) with the same S
```

### 5.2 The front door, on a review gate's APPROVE
"Build the WHOLE release chain in one go: Publish, DEV deploy, DEV
finalizer and the acceptance gate, the same four cards and bodies as
<previous round's ids> with the new SHA. Link the finalizer to the round's
sentinel. Only then complete the review gate. Report every id."

## 6. Follow-ups

### 6.1 Next: Phase 3 step 4a — model animations
- **Pre-brief:** `devtasks/PREBRIEF-scripting-4a.md`, FINAL Rev 1.2. It went
  through two outside reviews. D1–D6 and L1–L9 were approved as recommended,
  2026-10-23 00:52 PT.
- **Kickoff:** `devtasks/KICKOFF-scripting-4a.md`, base `10036575`. At that
  commit the pre-brief is 56,588 bytes, sha256 `9260df0b…667f`.
- **It's a server round:** a new extras leaf, the server stamping
  `startedAt`, and a narrow SOM change. DEV restarts.
- **Animated test models:** Khronos's `CesiumMan.glb` and `Fox.glb` (scale
  0.01).
- **After 4a:** 4b (behaviours, owner-present), which opens with the
  Khronos-engine spike (D2), then 4c and 4d.

### 6.2 Small host round (still open)
- **The deployer's handoff gap** (§4.2).
- **The `kanban_create` field-drop fault.**
- **`atrium-ops` `read_file` allowlist:** add the release-merge, publish and
  smoke scripts.
- **The front door's skill:** the full-chain wording (§4.1, §5.2) and the
  read-back-never-recreate rule (library-sky passdown §4.2).
- **Optional:** the smoke check could also `--require-id ep-library`.
- **Done, and now recorded:** `Cache-Control: no-cache` for `/apps` and
  `/packages`. The operator checked DEV and PROD on 2026-10-22, and all show
  `no-cache`.

### 6.3 Client and server follow-ups (recorded, not done)
1. **The SOM Inspector doesn't render models** (no model bridge).
2. **A raw World Info send that's refused isn't rolled back,** and an
   accepted one doesn't update the sender's own sky.
3. **The §9.5 forward-write race** (whole-extras writes). The fix is a
   leaf-level document send.
4. **L31:** no default lighting for skyless worlds.
5. **The world list's name doesn't follow a rename** (edit-polish-3
   pre-brief §9.2). It's a server change: autosave could copy
   `extras.atrium.name` into `worlds.name`.
6. **The identity-replace `loading/aborted` case** (models-hardening
   §6.2).
7. **The world file's own animations** (`SOMAnimation`): each viewer uses
   its own clock, and every viewer stops a finished clip (step 4 pre-brief
   §9.5). The fix comes after 4a's `serverNow()`.
8. **§4.6's two small observations.**

### 6.4 Later, in the operator's order
- The richer `add`, then the copy step.
- Pass B (connector writes).

## 7. Cleanup (operator, host)
```bash
git -C /root/lib-install push -q https://github.com/joshmaurice/atrium --delete \
  workflow/edit-polish-3 release/a3ec65371e3b release/7cd20655f68a
git ls-remote --heads https://github.com/joshmaurice/atrium    # main only
```
If `/root/lib-install` is gone, use any root clone. On the board, nothing is
open; round 1's acceptance gate `t_058cea77` can be archived if it isn't
already.
