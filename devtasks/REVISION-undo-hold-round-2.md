# Revision — undo-hold round 2 (round 1 is on DEV, not accepted)

**Status: Rev 0, approved by the operator (2026-11-04 21:50 PT: "ok yes plz").**
Three items, R1–R3. **No decision:** the fixes are mechanical. Round 1's fix
works (Claude's `h3.py`, all eleven checks, on `a096cf3f`), but the operator's
DEV test found an intermittent "Can't undo: … was changed elsewhere" after a
**move** of a spinning model. Claude reproduced it (§1). The operator chose to
fold the fix into this workflow rather than release round 1 first.

- **Base:** round 1's reviewed tip `a096cf3f8fcf31480c9a9f114d4994512563620d`
  on `workflow/undo-hold` (published). DEV runs its release merge
  `f81d6f772ec067479d3425c3948dca1cd4fb4482`,
  `WAITING_FOR_HUMAN_DEV_ACCEPTANCE`; **it is not accepted.** Round 2 commits
  on top of `a096cf3f`, in the same persistent worktree, and redeploys DEV over
  round 1 (`set-dev` from waiting-for-acceptance).
- **Round 1's cards:**
  - kickoff `t_142bbf7e`;
  - brief `t_d866f1bf`;
  - brief-review gate `t_39c52a64`;
  - implementation `t_f18ed24e`;
  - GLM review `t_54529d9e`;
  - review gate `t_62ecf6e7`;
  - sentinel `t_6a4633e2` (done);
  - Publish `t_7a087f11`, DEV deploy `t_38f52dcf`, finalizer `t_625071d5`;
  - acceptance `t_96969906`.
  
  **`t_96969906` is not completed:** round 2 supersedes it, as 4d-1's rounds
  did.
- **The contract still governs:**
  - `devtasks/PREBRIEF-undo-hold.md`, FINAL Rev 1, at `8bed4521` (sha256
    `327957b5…d299f`, 12,249 bytes);
  - the kickoff at `5a2bf360` (`devtasks/KICKOFF-undo-hold.md`, sha256
    `a654d0a0…7b61`, 17,817 bytes), with its Settlement and its
    "Requirements for the implementation AND review cards";
  - the GLM brief, the summary of `t_d866f1bf`.
  
  **This file adds R1–R3 and changes nothing else.** Every rule of round 1
  stands, among them `runner?.setGesture(` appearing exactly once in `app.js`.

## 1. What the operator's DEV test found
**A move by handle drag is sometimes recorded as a "Transform", and its Undo
is refused.**
- **The cause:** `onHandleChange` (`app.js` L2016 at `a096cf3f`) gives the
  gesture **all three** of the dragged object's values (position, quaternion
  and scale) whatever the handle's mode. The gesture records every field
  whose value differs from its start (`edit-gesture.js`, `update`).
- **How it happens:** a behaviour's rotation send can already be on the wire
  when the drag begins. 4b-2 F-L5 allows for this: the hold drops new sends,
  not ones already sent. Its echo then turns the object during the drag. The
  next `objectChange` copies that rotation into the gesture, so a move is
  recorded as a move **and** a rotation, labelled "Transform".
- **Why Undo refuses it:** the behaviour keeps rotating the model, so Undo
  finds the rotation no longer as recorded and refuses the whole step:
  "changed elsewhere" (W4).
- **The evidence:** Claude's `devtasks/harness/checks/undo-hold/h4.py` makes
  12 mouse-like move drags (20 `objectChange` events over about 0.6 s) on a
  spinning cube, each followed by Undo:
  - **on `a096cf3f`:** 8 drags recorded as "Move" and undone; **4 recorded
    as "Transform" and refused**;
  - **on `8ff7000` (PROD's code):** 12 of 12 were "Move" and undone. That is
    only because the stuck hold stops the spinner at the first Undo, so no
    rotation lands during later drags.
  
  So round 1 didn't cause this, but it makes it common. It is most likely
  also the operator's earlier report that moves of a rotating model couldn't
  be undone.
- **Panel edits never do this:** a typed position commits only that field.

**And the follow-up that both GLM and Claude noted in round 1:**
- The tracker's `reset()` clears its records without reporting idle.
  `endEditSession` (`app.js` L1961) never clears the hold. So a hold in force
  at a reconnect or a world change outlives the session, until the next edit
  takes it over.
- Two comments say otherwise: `reset()`'s ("the caller re-establishes the
  runner fresh", `edit-gesture.js` L538) and `clear()`'s ("or the world
  changed", L126).

## 2. The contract (round 2)

### R1. A handle drag records only what its handle changes
- **A new pure export in `edit-gesture.js`,** `handleUpdate(mode, object)`.
  It returns the `update` values for a handle in that mode:
  - `'translate'`: `{ translation: object.position.toArray() }`;
  - `'rotate'`: `{ rotation: object.quaternion.toArray() }`;
  - `'scale'`: `{ scale: object.scale.toArray() }`;
  - any other mode: all three, as today.
- **`onHandleChange` calls `activeGesture.update(handleUpdate(gizmo.mode,
  selectedObj))`.** `gizmo.mode` is the TransformControls' own property, set
  by `gizmo.setMode` (`app.js`'s mode buttons: `translate`, `rotate`,
  `scale`).
- **Nothing else changes:**
  - `begin` still reads all three starts;
  - the tracker still records only the fields an update touched;
  - the Rotate and Scale handles behave as today, for their own field.

### R2. The edit session's end clears the hold
- `endEditSession` calls `hold.clear()`, after `editTracker.reset()`.
- **The two comments say what the code does:**
  - `reset()`: a reset reports no idle, and the caller clears the hold
    itself (`endEditSession`);
  - `clear()`: the drag ended, or the edit session ended (a reconnect or a
    world change).

### R3. Suites, proofs, the handoff
- **Tests:**
  - **`handleUpdate`'s unit tests** (`edit-gesture.test.js`), with plain
    objects that have `toArray()`: each of the three modes returns exactly
    its one field, and an unknown mode returns all three.
  - **The tracker test of the bug,** through the real `createEditTracker`:
    1. `begin(node)`;
    2. the node's rotation changes underneath, as an echo would change it;
    3. `update(handleUpdate('translate', obj))`, with `obj`'s quaternion
       also changed, then `end`;
    4. the send is accepted.
    
    The reported result has **only** `translation`. The same steps with
    `update` given all three fields report `translation` **and** `rotation`
    (the round-1 behaviour, kept as the test's contrast).
  - **The wiring guards** (`behavior-wiring.test.js`):
    - `onHandleChange` calls `handleUpdate(gizmo.mode, selectedObj)` and
      builds no three-field object of its own;
    - `endEditSession`'s body calls `hold.clear()`;
    - `runner?.setGesture(` still appears exactly once in `app.js`.
- **Proofs** (each break made on the committed tip, the named tests seen
  failing with both runs quoted, the file restored from a saved copy):
  - (r1a) make `handleUpdate('translate', …)` return all three fields → the
    unit test and the tracker test fail;
  - (r1b) put the three-field object back in `onHandleChange` → the wiring
    guard fails;
  - (r2) remove `hold.clear()` from `endEditSession` → the wiring guard
    fails.
- **Full suites as round 1** (the kickoff's requirement 5), and the handoff
  as round 1's (requirement 3 and canonical §2).
- **Files:** `apps/client/src/edit-gesture.js`, `apps/client/src/app.js`,
  `apps/client/tests/edit-gesture.test.js`,
  `apps/client/tests/behavior-wiring.test.js`. **No other file.**

## 3. The cards
Round 1's rules hold. **One implementation commit:**
`undo-hold round 2 (R1, R2): a drag records only its handle's field; the session's end clears the hold`.

### Card 1: R1, R2, R3
- Precondition: `HEAD` = `a096cf3f8fcf31480c9a9f114d4994512563620d`, and
  the worktree is clean.
- Then everything in §2, every suite, proofs (r1a), (r1b) and (r2), and the
  handoff.

### Card 2: the GLM review of round 2 (`8bed4521..<tip>`)
- A single GLM review: round 2's commit read closely, round 1's two commits
  checked for regressions.
- It reproduces (r1a), (r1b) and (r2).
- **It writes its own test:** the tracker test above, with `'rotate'` in
  place of `'translate'` and the position changing underneath. The result
  must have **only** `rotation`.
- Then the gate, publish, DEV (`set-dev` over the unaccepted round 1), the
  finalizer and acceptance.

### Before DEV acceptance (Claude)
- `h4.py` on the new tip: **12 of 12 recorded "Move" and undone** (round 1:
  8 and 4).
- Regressions: `h3.py` (all eleven), `h2.py`, and 4d-1's `c2.py`.

## 4. Cleanup
None. The only undo-hold sentinel, `t_6a4633e2`, is done, so no sentinel is
open. The guard links round 2's sentinel to its review gate and DEV finalizer
itself. Round 1's acceptance `t_96969906` stays blocked by design.

## 5. Kickoff body for round 2

**For the front door.**
- **The sentinel first:** titled exactly `Undo-hold r2 sentinel (undo-hold)`,
  in `t_6a4633e2`'s shape, naming this revision, with the dependency-hold
  clause. Never reuse `t_6a4633e2` or `t_96969906`.
- **Then fill the body's placeholders:**
  - `<REVISION_CHECK>`: `REVISION CHECK (front door): <commit>:devtasks/REVISION-undo-hold-round-2.md sha256 <hash>, <bytes> bytes, matches.`;
  - `<SENTINEL_ID>`;
  - `<CANONICAL_REQUIREMENTS>`, verbatim, as round 1's kickoff carried it.
- **The release chain on APPROVE** is round 1's four cards (`t_7a087f11`,
  `t_38f52dcf`, `t_625071d5`, `t_96969906`) with this round's SHA; DEV is
  `set-dev` over round 1. The finalizer's `reviewed_sha` is round 2's
  reviewed tip.
- **Nothing is pushed to `main` between round 2's DEV release merge and the
  MAIN push.**

---

### KICKOFF — undo-hold revision round 2. Slug: `undo-hold`

You are the kickoff orchestrator for round 2 of `undo-hold`. Build the graph
below, read it back, report, and stop. Do not implement, review or deploy
anything yourself.
- **Your tools:** only `kanban_*`.
- **Everything you need is in this body.** Nothing will be posted on this
  card afterwards, so don't wait for comments, and **never block this card.**
- **Blocking:** never call `kanban_block` without an explicit `task_id`.
- **Titles:** use them exactly as written, character for character.
- **Card bodies:** write each card's body from the bullets under its title;
  don't copy this kickoff's instructions to you into any card. The
  references block, the hash checks and the canonical requirements are
  copied whole. Bodies go in the body field when you create the card. Read
  each back, and if a body is empty, post it as the card's first comment
  while it's `todo`, **with the canonical requirements whole, not
  summarised**. Never create a second card in its place.
- **Create every card with its parent** (`parents=[…]`).
- **Do not create or link any sentinel.** The guard and the front door do
  that.

**The front door's spec check:** `SPEC CHECK (front door): 8bed4521afa50a8340d8fbe97ad1575993848811:devtasks/PREBRIEF-undo-hold.md sha256 327957b56b8bd4200c024f90272220d1dd4565558c6f5479e77ac51bee9d299f, 12249 bytes, matches.`

**The front door's revision check:** <REVISION_CHECK>

**The sentinel (for your report only; don't link it):** `<SENTINEL_ID>`

#### The references block (copy it whole into cards 1–2)
**The contract is in git.** Before anything else, read and check all three:

```
git -C /workspace/atrium fetch origin main
git -C /workspace/atrium show 8bed4521afa50a8340d8fbe97ad1575993848811:devtasks/PREBRIEF-undo-hold.md > /tmp/prebrief.md
sha256sum /tmp/prebrief.md   # 327957b56b8bd4200c024f90272220d1dd4565558c6f5479e77ac51bee9d299f
git -C /workspace/atrium show 5a2bf360a93013026a994df0e1609f0ca6149c1a:devtasks/KICKOFF-undo-hold.md > /tmp/kickoff-r1.md
sha256sum /tmp/kickoff-r1.md   # a654d0a008011a6b07f0ae42c8c965d83978296df462fb09b43fb518cf027b61
git -C /workspace/atrium show <revision commit>:devtasks/REVISION-undo-hold-round-2.md > /tmp/revision-r2.md
sha256sum /tmp/revision-r2.md   # <revision hash>
```

(Fill the two `<revision …>` values from the front door's revision check
above.) On any mismatch, block with `kind="capability"`, quote both hashes,
and do not work from a different text.

- **The round-2 revision is this round's contract:** its §2 (R1–R3; no new
  decision) and its §3, which gives **your card's** items.
- **Also binding:**
  - the pre-brief (FINAL Rev 1);
  - the round-1 kickoff's Settlement and its "Requirements for the
    implementation AND review cards (beyond the spec)", items 1–7;
  - the GLM brief, the summary of `t_d866f1bf`.

#### Graph — build exactly this
1. `Implement r2 — undo-hold`. Assignee `atrium-deepseek`, parent: this
   kickoff, created with `max_runtime_seconds=7200`, passed explicitly.
   - **Its body carries:**
     - the references block;
     - the line `Your items: the round-2 revision's §3, "Card 1: R1, R2, R3".`;
     - the worktree rule;
     - the step rule;
     - the canonical requirements.
   - **The worktree rule:** work in the existing persistent worktree
     `/workspace/wt/undo-hold`, on `workflow/undo-hold`. Before changing
     anything:
     ```
     cd /workspace/wt/undo-hold
     git status --porcelain                                            # must print nothing
     git rev-parse HEAD                                                # must equal a096cf3f8fcf31480c9a9f114d4994512563620d
     git log --format='%h %s' 8bed4521afa50a8340d8fbe97ad1575993848811..HEAD   # round 1's two commits
     pnpm install --frozen-lockfile --prefer-offline
     readlink -f packages/server/node_modules/@atrium/protocol          # must resolve inside this worktree
     ```
     On any mismatch, block with `kind="needs_input"`, quote what you saw,
     and touch nothing. Commit locally and never push. **One commit,** with
     the subject the revision's §3 gives.
   - **The step rule:**
     - do your card's items and no other;
     - your handoff (the completion summary **and** metadata `tip_sha`)
       marks **every item** done, with its files and test names;
     - **never complete with an item undone:** block with
       `kind="needs_input"`, naming what is left;
     - post a progress comment after each item and after the commit;
     - **if the completion's summary or metadata doesn't take,** post the
       whole handoff as a comment headed `HANDOFF — undo-hold round 2`
       before completing.
2. `GLM review r2 — undo-hold`. Assignee `atrium-glm`, parent: card 1,
   `max_runtime_seconds=3600`.
   - The body opens with the exact line
     `THIS RUN HAS TERMINAL, FILE AND GIT TOOLS. Use them for every step below.`
   - **Then:**
     - the references block;
     - "Your review: the round-2 revision's §3, 'Card 2: the GLM review of
       round 2'";
     - the range is `8bed4521..<tip card 1 reported>`, with round 2's
       commit read closely and round 1's for regressions;
     - review in your own detached worktree at
       `/workspace/wt/review-<your task id>` at that tip, never in the
       persistent one;
     - reproduce (r1a), (r1b) and (r2), and write the `'rotate'` test;
     - the canonical requirements.
   - **The verdict** is APPROVE or CHANGES_REQUIRED, with the exact
     lowercase 40-character SHA when approving. **Put the verdict, the SHA
     and the findings in the completion summary itself**, not only in
     comments. Metadata: `verdict`, `reviewer_role`, `review_round:
     round-2`, `findings_count` and the maximum severity.
3. `Review gate r2 — undo-hold`. Assignee `atrium-orchestrator`, parent:
   card 2. It creates nothing.
   - **On a valid APPROVE of the exact 40-character SHA,** it blocks with
     `kind="needs_input"` and the reason
     `APPROVE <SHA40>: front door, build the release chain`.
   - **Otherwise,** it blocks for the operator with the verdict quoted.
4. **The release chain is the front door's:** publish, DEV (`set-dev` over
   the unaccepted round 1), the finalizer and acceptance, at card 3's
   APPROVE. Nothing reaches MAIN or PROD.

#### Report back
- the three ids, each with its parent;
- the implementation card's `max_runtime_seconds` (7200), and the review's
  (3600);
- that cards 1–2 each carry the references block, with the filled revision
  commit and hash, and the canonical requirements whole, in their body
  fields or first comments;
- the review's opening line;
- that you created and linked **no** sentinel.

Then complete this card.

#### WORKER-CARD REQUIREMENTS (canonical)
<CANONICAL_REQUIREMENTS>
