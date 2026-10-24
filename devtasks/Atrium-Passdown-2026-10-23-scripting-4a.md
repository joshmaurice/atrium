# Atrium Passdown — 2026-10-23 — scripting-4a (model animations), released

**Predecessor:** `devtasks/Atrium-Passdown-2026-10-23-edit-polish-3.md`. Its
host, connector and convention notes still hold, except where this file says
otherwise.

**First instruction for the next session's Claude:**
1. Clone the repo and read `devtasks/`, newest first (this file first).
2. Use the `atrium-ops` connector for board, release, log and git state. It
   is read-only.
3. **Next up is Phase 3 step 4b** (§6.1): its pre-brief doesn't exist yet.
   It opens with the Khronos-engine spike (step 4 pre-brief D2) and carries
   4a's recorded items.
4. **Never push to `main` between a DEV deploy's release merge and the MAIN
   push** (§4.4). `main` refuses force-pushes.

## 1. Status at handoff

| Item | State |
|---|---|
| Release | **COMPLETE** (2026-10-23 ~21:29 PT). DEV, MAIN and PROD are at `147df81481babbe9d95c83ba5a9a40c4adc9de47`, recorded and healthy, with the deploy lock free. Checked through the connector |
| What `147df814` is | The release merge of round 3's reviewed tip `4ba86c0d6a2c7d3736d3c71e0635b80f9d5be8e5` with `main` `62f4d705`. The only difference is `devtasks/` |
| Spec | `devtasks/PREBRIEF-scripting-4a.md`, FINAL Rev 1.2 (sha256 `9260df0b…667f`, at `10036575`), plus the operator's brief-gate corrections (the comment on `t_4954c617`) |
| Revisions | Round 2: `devtasks/REVISION-scripting-4a.md` (sha256 `578b8891…b8cc`, at `999372ea`). Round 3: `devtasks/REVISION-scripting-4a-r3.md` (sha256 `550f40e0…269d`, at `62f4d705`) |
| Decisions | D1–D6 and L1–L9 as recommended (2026-10-23 00:52 PT). Round 2: R1 (a), R2 (a) (09:21 PT). Round 3 had none (20:23 PT) |
| DEV acceptance | The operator, Firefox, on `147df814` (~21:20 PT): §6 steps 1–8 and round 3's re-check pass. Step 9 (select a model mid-load) can't be done by hand on DEV: the model loads too fast. Claude's harness covers it with a held fetch. Claude's §5.1 checks 1–10, round 2's four and round 3's pass on `4ba86c0d` (§3) |

## 2. What shipped
- **Placed models play their own animations,** synced for everyone and
  saved with the world. One new writable node leaf,
  `extras.atrium.animation` = `{ clip, playing, loop, speed, startedAt }`,
  only on a model node. `null` means stopped (Z1, Z2).
- **The server stamps `startedAt`** when it accepts a playing `send`; `add`
  is never stamped, so Duplicate and Undo stay in step (L5 (b)).
- **`SOMDocument.CREATABLE_PATHS = ['extras.atrium.animation']`:** the one
  missing final key `setPath` may create, using own-property checks (Z2).
- **`AtriumClient`** (Z2a, Z3):
  - `setModelAnimation(name, value)`; the own echo, matched by `requestSeq`,
    applies the broadcast (stamped) value;
  - **`serverNow()`** on a monotonic clock: ping counters per connection, a
    window of 10 samples up to 5 minutes old, discontinuity recovery. Round
    2: the last estimate is kept until a recovery sample lands, and earlier
    pings are forgotten.
- **`packages/client/src/animation-spec.js`:** the value rule, `clipTime`
  and `clipIds`. L8 ids keep their file index, and only playable ids are
  offered (round 2).
- **`packages/renderer-three/src/model-animations.js`:**
  - one `AnimationMixer` per instance object;
  - every action is `LoopOnce` with clamping, its time set from the clock
    every frame;
  - Stop is `action.stop()` alone;
  - three bridge callbacks; `onChange` (round 2).
- **The bridge refreshes each placed instance** (`refreshPlacedInstance`,
  round 3), so a rigged model selected before its first render gets a true
  outline and stays clickable (§4.7).
- **The Edit panel:**
  - the clip select, Loop, Play and Stop, with Loop, Play and Stop on their
    own row (round 3);
  - "Played" when a once clip ends; "Animations: loading"; "No animations";
    "Clip ‘X’ not found in this model";
  - one write at a time per node; late answers touch nothing;
  - Stop and Play are enabled in `clip-missing` (R2 (a)).

**Tests at release** (round 3 review): server 550 (36 files), renderer-three
296, `apps/client` 949, `packages/client` 474, som 232, protocol 71 and
interaction 9. Nothing was skipped, and every file exits on its own.

## 3. How the round ran

| Step | Card or SHA | Notes |
|---|---|---|
| Kickoff | `t_92bd68f0`; sentinel `t_6ad50332` | Clean |
| GLM brief, then the gate | `t_9258ddec`, `t_4bdc3ee5` | Faithful, but carried a spec gap: `null` (Stop) would fail `add`'s check, so a stopped model couldn't be duplicated or restored. **The operator's correction comment** on the implementation and review cards fixed it before the run started (§4.1) |
| Round 1 | `c51ca3e9` (`t_4954c617`, review `t_8c2d5a77`) | GLM APPROVE, 0 findings. DEV `a49e18e8`; the deploy card blocked on the handoff gap; verified on the host |
| Outside review of the whole round | NO-GO: 4 must-fix, 3 should-fix, 1 nit | All reproduced by Claude (§4.2). Note: the first outside "review" covered only the last commit, which was test-only |
| Round 2 | `159b2235` (`t_cff2250a`, review `t_3aa7b71b`, gate `t_4f261bac`, sentinel `t_c1d6e517`) | V1–V8. **The front door stopped at the gate's APPROVE** and had to be told to build the chain (§4.5). DEV `d835a8a6`, then `11f1757f` (§4.4) |
| Targeted outside re-review | No must-fix; 2 should-fix, 1 nit | Recorded for 4b (§6.1) |
| Operator DEV acceptance of round 2 | Failed on two things | Stop off the panel; rigged-model selection after a reload (§4.3, §4.7) |
| Round 3 | `4ba86c0d` (`t_22e23e24`, review `t_95c8ad85`) | W1–W3. DEV `147df814`; the finalizer `t_f9d42d20` blocked on the handoff gap; verified on the host |
| Release | `147df814` | Acceptance `t_9e16eb50`, MAIN, PROD (`t_1fe8b92e`). Round 1's gate `t_24b37001` and round 2's `t_4abec9df` were superseded |

## 4. Findings and lessons

### 4.1 Check the brief against the pre-brief, then correct by comment
- Claude's check of the GLM brief found one must-fix that was in the
  pre-brief itself: Z2's `add` rule ("must pass Z1") refused the `null` that
  Stop stores. It also found two should-fixes: (e4) was missing from the
  step-6 list, and Z7 didn't say how the answers would be routed.
- **What worked:** one `OPERATOR CORRECTION` text, posted with `hermes
  kanban comment` on the implementation **and** review cards before the
  gate was completed (edit-plumbing passdown §7.4). The front door also
  relayed it. The implementer had it in its first context.

### 4.2 GLM's APPROVE is not enough on its own
- Round 1: GLM approved with 0 findings and 14 proofs. The outside review
  then found 4 must-fix items: two panel refresh gaps, the clock falling to
  0 on a discontinuity, and a silent Play. Claude's browser checks had
  found the two panel ones independently.
- **Keep the outside review of the whole round** (from base to tip, not the
  last commit). Give it the compare URL and the corrections.
- A **targeted re-review** of a revision is cheap and found a real issue
  (the two-owner select).

### 4.3 What Claude's browser checks missed, and what DEV acceptance caught
- **Layout:** the checks pressed buttons through the page's own code and
  read their enabled state. They never checked that a button was on screen.
  Now `sel3.py` checks that every control's box is inside the panel at
  1280 × 800.
- **The reload path:** structural actions (Duplicate, Undo) were only tried
  in a session that had run Check first. Repeat them **after a page reload**.
  `sel.py` does that now.
- **Step 9 by hand:** a model from a fast host can't be selected mid-load.
  Keep that check in the harness, with the fetch held.

### 4.4 `main` moved after the release merge (Claude's own commit)
- **What happened:** after round 2's DEV deploy made its release merge
  `d835a8a6` from `main` `978ab16b`, Claude pushed a harness commit
  (`c4a534a`) to `main`. `atrium-main-push` would then refuse: "update
  would not be a fast-forward".
- **`main` refuses force-pushes** (a GitHub rule, GH013), so it couldn't be
  moved back. The session's own safety check also refused the force-push.
- **The remedy that worked** (models-by-url passdown §5.2, §5.1 here): a
  fresh merge of the reviewed tip with the new `main`, pushed to
  `claude/scripting-4a-release` (`11f1757f`), then `atrium-deploy dev` on
  the host.
- **Rule:** nothing is pushed to `main` from the moment the DEV deploy makes
  its release merge until the MAIN push. Revision docs are pushed **before**
  a round starts. This passdown and the harness commit went in after PROD.

### 4.5 The front door and the deployer, again
- **Round 2:** the review gate blocked with `APPROVE …: front door, build the
  release chain`, and the front door built nothing until the operator sent
  the full-chain instruction (edit-polish-3 passdown §5.2). Round 3, given
  the instruction up front, built it whole.
- **The deployer's handoff** still lacks `REVIEWED_SHA=`, `RELEASE_SHA=` and
  `SMOKE OK:` in every round. Round 1's deploy card blocked, and round 2's
  and round 3's finalizers blocked. Each was verified on the host (§5.2).

### 4.6 Harness notes (see `devtasks/harness/README.md`)
- **SwiftShader stalls bias the clock estimate:** about 150 ms frames at
  1280 × 800 with two rigged models. A pong queued behind a frame or a
  model parse biases `serverNow()` by half the wait, which is −190 ms at
  worst. Use a 480 × 360 viewport for timing checks; the estimate is then
  within about 10–60 ms. Real hardware isn't affected this way.
- **Ground truth** is `performance.timeOrigin + performance.now()` in the
  page.
- **New controls:**
  - `/__save` and `/__restart?key=…` (a server restart from the saved
    document);
  - `/khronos/` (Fox, CesiumMan and `FoxLong.glb`);
  - `__anim()`.
- **The scripts:** `checks/scripting-4a/`: `c1`, `c4`, `c6`, `c7`, `c8b`
  and `c9` (§5.1), `r2.py` (round 2), and `sel.py` / `sel3.py` (round 3).

### 4.7 A pre-existing bug, now fixed: rigged models after a reload
- **Since models-by-url (and on PROD until this release):** after a page
  reload, a Duplicate or an Undo-restored **rigged** model (`SkinnedMesh`)
  got a wrong outline (on its side, or collapsed) and couldn't be clicked,
  until a reconnect.
- **The cause:** three r163 caches `SkinnedMesh` bounds from the current
  bone and bind matrices. `Box3.setFromObject` doesn't refresh
  `bindMatrixInverse`. Duplicate and Undo select the new node before its
  first render. Before a reload, the Model form's Check had left the
  template's matrices current, which hid it.
- **The fix** (round 3, W1/W2): the bridge's `refreshPlacedInstance` on
  every attach, and fresh transforms before the selection outline.
- **The library never showed it:** its models have no skeletons.

## 5. Recipes
The same as the edit-polish-3 passdown §5, plus:

### 5.1 Release when `main` moved after the release merge
```bash
# In any clone with push access to claude/* (the Claude session can do this part):
git fetch origin main workflow/<slug>
git checkout -B claude/<slug>-release <reviewed SHA>
git merge --no-ff origin/main -m "release: merge main (<main sha8>, devtasks/ only) into <sha8> so MAIN can fast-forward"
X=$(git rev-parse HEAD); git diff --name-only <reviewed SHA> $X | grep -v '^devtasks/'   # nothing
git merge-base --is-ancestor origin/main $X && echo "FF OK"
git push origin claude/<slug>-release
# Host:
atrium-deploy dev $X        # restarts DEV; then accept, atrium-main-approve/-push $X, PROD with S=$X
```

### 5.2 A finalizer blocked on the handoff gap
```bash
atrium-release-status | sed -n 1,8p   # DEV actual = recorded = RELEASE_SHA, healthy
hermes kanban --board atrium complete <finalizer> --result "OPERATOR: DEV runs RELEASE_SHA <sha> (release merge of reviewed <sha40> with main <sha8>, devtasks/ only), verified on the host"
```

### 5.3 A correction to a brief, before the gate (§4.1)
```bash
cat > /root/correction-<slug>.txt <<'EOF'
OPERATOR CORRECTION to the brief <t_id> … Binding; it supersedes the brief and the spec where they differ.
EOF
hermes kanban --board atrium comment <implementation t_id> "$(cat /root/correction-<slug>.txt)"
hermes kanban --board atrium comment <review t_id> "$(cat /root/correction-<slug>.txt)"
hermes kanban --board atrium complete <brief-review gate t_id>
```

## 6. Follow-ups

### 6.1 Next: Phase 3 step 4b — behaviours, owner-present
- **The pre-brief opens with the Khronos-engine spike** (step 4 pre-brief
  D2: bounded execution, cleanup, pointer authorization, rejection of
  invalid graphs). D5's conflict rule and D6's `objectId` are 4b's.
- **4a items carried into 4b** (more writers of the same leaf make them
  matter):
  1. **The clip select in a second owner tab** (round-2 re-review finding
     1). An explicit pick outlives another session's change of the playing
     clip, so the select shows a stale clip and a Loop toggle restarts it.
     Proposed rule: the select follows another session's playing value, and
     a pick lasts only until its own write is answered.
  2. **Per-frame work for stopped models** (re-review finding 2):
     `update()` builds a status snapshot for every entry every frame. Skip
     stopped entries.
  3. **A saved value on a model with no clips** (re-review nit): Stop is
     disabled, so the value can't be cleared from the panel. Enable Stop
     whenever a saved playing value exists.
  4. **Selection bounds come from one pose** (round 3's stated limit): a
     click on an outstretched limb of an animating model can miss. That
     needs per-clip or per-frame bounds.
  5. **Clock tests not yet written** (re-review notes): a lost recovery
     pong, overlapping bursts, and a steady ping sent between `sent.clear()`
     and the burst. Optionally, a second ping burst after the world's
     models finish loading (§4.6's bias on slow machines).
- **The world file's own animations** (`SOMAnimation`, step 4 pre-brief
  §9.5; edit-polish-3 passdown §6.3 item 7) can now use `serverNow()`.

### 6.2 Small host round (still open, plus new)
- **The deployer's handoff gap** (§4.5): every round of this step.
- **The front door's skill:**
  - the full-chain wording (edit-polish-3 passdown §5.2);
  - read back, never recreate;
  - **new:** don't wait at an APPROVE for a separate instruction;
  - **new:** keep `main` still between the release merge and the MAIN push
    (§4.4).
- **The `kanban_create` field-drop fault.**
- **The `atrium-ops` connector:**
  - `read_file` allowlist: the release-merge, publish and smoke scripts;
  - `git_fetch_mirror` and `git_*` can't reach `release/*` branches;
  - `kanban_list` has no `todo` filter.

### 6.3 Client and server follow-ups (recorded, not done)
The edit-polish-3 passdown §6.3, items 1–6 and 8, are unchanged. Item 7 is
§6.1's last bullet.

## 7. Cleanup (operator, host)
```bash
git -C /root/lib-install push -q https://github.com/joshmaurice/atrium --delete \
  workflow/scripting-4a release/c51ca3e92ab2 release/159b22354f98 release/4ba86c0d6a2c \
  claude/scripting-4a-release claude/harness-s4a-r2
git ls-remote https://github.com/joshmaurice/atrium   # main only
```
On the board, archive the superseded acceptance gates `t_24b37001` (round 1)
and `t_4abec9df` (round 2).
