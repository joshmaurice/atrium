# Revision — undo-hold round 3 (round 2 is on DEV, not accepted)

**Status: Rev 0, approved by the operator (2026-11-05 11:23 PT: "let's fold
into round 3").** Three items, R4–R6, continuing round 2's numbering. **No
decision:** the fixes are mechanical.
- **What round 2 delivered:** the operator's DEV test found Undo and Redo
  "now seem to work fine". Claude's `h4.py` gives 12 of 12.
- **What the same test found:** a running behaviour makes the Library tiles
  and the World (sky) dropdown flicker, and a library item can't be chosen.
- **What Claude's regression run found:** a typed rotation on a spinning model
  goes unrecorded, and Undo then silently undoes the step before it.

Both are older than this workflow: PROD's code shows each one (§1). The
operator chose to fold them into this workflow, as round 2.

- **Base:** round 2's reviewed tip `4f66f93b7f8beda61a372e6b891c8f885b58bb5e`
  on `workflow/undo-hold` (published). DEV runs its release merge
  `0cee80c580f52000b2ca178fbb875434457c582a`,
  `WAITING_FOR_HUMAN_DEV_ACCEPTANCE`; **it is not accepted.** Round 3 commits
  on top of `4f66f93b`, in the same persistent worktree, and redeploys DEV
  over round 2 (`set-dev` from waiting-for-acceptance).
- **Round 2's cards:**
  - kickoff `t_7746dfd1`;
  - implementation `t_9c6c9f19`;
  - GLM review `t_a1b41936`;
  - review gate `t_04c62789`;
  - sentinel `t_799da9aa`;
  - Publish `t_307913e6`, DEV deploy `t_6f1926af`, finalizer `t_06756705`;
  - acceptance `t_68a0a48c`.
  
  **`t_68a0a48c` and round 1's `t_96969906` are not completed:** round 3
  supersedes both.
- **The contract still governs:**
  - `devtasks/PREBRIEF-undo-hold.md`, FINAL Rev 1, at `8bed4521` (sha256
    `327957b5…d299f`);
  - the kickoff at `5a2bf360` (sha256 `a654d0a0…7b61`), with its Settlement
    and its "Requirements for the implementation AND review cards";
  - the round-2 revision at `6790a194` (sha256 `0c0c90bd…3dc7`);
  - the GLM brief, the summary of `t_d866f1bf`.
  
  **This file adds R4–R6 and changes nothing else.** Every rule of rounds 1
  and 2 stands, among them `runner?.setGesture(` appearing exactly once in
  `app.js`.
- **The file set grows (approved with this revision):**
  - `apps/client/src/library-grid.js` and `apps/client/src/sky-picker.js`,
    with their tests `apps/client/tests/library-grid.test.js` and
    `apps/client/tests/sky-picker.test.js`;
  - beside round 1's four: `edit-gesture.js`, `app.js`,
    `edit-gesture.test.js` and `behavior-wiring.test.js`.
  
  **No other file.** Still nothing under `packages/`.

## 1. What was found (all line numbers at `4f66f93b`)

### 1.1 The Library tiles and the sky dropdown are rebuilt on every change → R4
- **In Edit mode, every `som:set` redraws the panel's actions:**
  `client.on('som:set', () => { if (modes.edit) refreshEditActions(); … })`
  (`app.js` L2934).
- **That includes a behaviour's own writes,** about 13 a second for a
  spinner.
- **`refreshEditActions` calls `libraryGrid?.refresh()` and
  `skyPicker?.refresh()`** (L2593, L2595). Each one re-renders from scratch:
  - `renderLibraryTiles` (L3838) empties `#library-tiles` and recreates every
    heading, tile, thumbnail `<img>` and click handler, and the credit line;
  - `renderSkySelect` (L3941) empties `#ep-sky` and recreates every
    `<option>`.
- **So each tile is replaced about every 75 ms.** A click needs the same
  element under both the press and the release, so the click rarely lands.
- **Claude's `devtasks/harness/checks/undo-hold/h5.py`** counts rebuilds in
  2 s, with the Library grid open, and then tries a real mouse click on a
  tile:

| Code | No behaviour | A spinner running | A real click on a tile |
|---|---|---|---|
| `4f66f93b` (round 2) | 0 tiles, 0 sky | **27 tiles, 27 sky** | **fails** (Playwright: the element is never stable for 5 s) |
| `8ff7000` (PROD's code) | 0, 0 | **26, 26** | **fails** |

  Before round 1 the operator rarely saw this: the spinner stopped at the
  first Undo. Now it keeps running.

### 1.2 A typed edit of the field a behaviour writes goes unrecorded → R5
- **The `som:set` handler passes every transform change to the tracker as
  another session's:** `editTracker.remoteSet(node, path, …)` (`app.js`
  L1036).
- **That includes `origin: 'own'`,** which for a transform field is only a
  behaviour's own echo: `sendField` with `applyEcho`, `AtriumClient.js`
  L1724–1731. The panel's own sends apply first and emit no `own` set.
- **`remoteSet` marks the open record `remote`** (`edit-gesture.js`
  L538–543). A batch with a `remote` record is reported with **no result**
  (`reportBatch`, L301–305).
- **So a typed rotation on a spinning model is never recorded.** The next
  Undo undoes the step **before** it, without a word.
- **Claude's trace** (`h3.py` check 4, instrumented; three runs each on
  `a096cf3f` and `4f66f93b`): every time, the Undo label stayed at the
  previous step ("Undo Move "Cube 2"") after the rotation edit, and Undo then
  moved **Cube 2** back.
- **What U16 is for, and what must stay:** a refused edit reverts to the
  **server's** latest value, never an older one. A behaviour's echo is the
  server's value too. So R5 keeps that, and drops only the "another session
  touched it" verdict.

## 2. The contract (round 3)

### R4. The Library grid and the sky list rebuild only when what they show changes
- **Two pure key functions, exported and unit-tested:**
  - `libraryTilesKey(groups, { credit, creditUrl, base })` in
    `library-grid.js`: a string that changes when any category, entry `id`,
    `name` or `thumbnail`, the credit, the credit URL, or `base` (the world
    base URL the thumbnails resolve against) changes, and **only** then;
  - `skyOptionsKey(options, custom)` in `sky-picker.js`: a string that
    changes when any option's `id` or `name`, or `custom`, changes, and
    **only** then.
- **`renderLibraryTiles` (`app.js`):**
  - It keeps the key it last built. When the new key is the same, it doesn't
    touch the DOM structure: it only sets each existing tile's `disabled` and
    `title` from `enabled` and `reason`, and only where they differ.
  - When the key differs, it rebuilds as today.
  - The click handler calls the **current** `onPick`, held in a variable the
    render updates, not the one captured when the tile was built.
- **`renderSkySelect` (`app.js`):**
  - It rebuilds the `<option>`s only when `skyOptionsKey` changes.
  - It sets `epSky.value` and `epSky.disabled` only when they differ from
    the element's current ones.
- **Nothing else changes:** what is enabled, when, and why (the grid's
  `tileEnabled` and `tileBlockReason`, the picker's enable rule), and every
  existing caller of `refresh()`.

### R5. A behaviour's own echo updates the server value but isn't "another session"
- **A new tracker method, `ownEchoSet(node, field, value)`** (`edit-gesture.js`):
  - like `remoteSet`, it sets the open record's `confirmed` to `value`, and
    does nothing when there is no open record;
  - unlike `remoteSet`, it **doesn't** set `remote`.
- **The `som:set` handler (`app.js` L1017) reads `origin`.** For a transform
  field it calls `editTracker.ownEchoSet(…)` when `origin === 'own'`, and
  `editTracker.remoteSet(…)` otherwise.
- **The result:**
  - a typed edit overlapped by the behaviour's write is **recorded**, as this
    tab's change;
  - a later Undo of it finds the field changed by the behaviour, and says so
    ("changed elsewhere", W4);
  - **a refused edit still reverts to the behaviour's latest server value**,
    not to the value before the edit (U16).

### R6. Suites, proofs, the handoff
- **R4's tests:**
  - **`libraryTilesKey`** (`library-grid.test.js`): it is equal for equal
    inputs, and different when each of category, `id`, `name`,
    `thumbnail`, credit, credit URL and `base` changes, one at a time.
    **It is equal** when only `enabled` or `reason` would differ, because
    they aren't inputs.
  - **`skyOptionsKey`** (`sky-picker.test.js`): it is equal for equal inputs,
    and different when an option's `id`, an option's `name`, or `custom`
    changes.
  - **The wiring guards** (`behavior-wiring.test.js`, reading `app.js`):
    - `renderLibraryTiles` compares `libraryTilesKey(…)` against its kept key
      before emptying `#library-tiles`;
    - `renderSkySelect` compares `skyOptionsKey(…)` against its kept key
      before emptying `#ep-sky`;
    - a tile's click handler calls the kept current `onPick`.
- **R5's tests** (`edit-gesture.test.js`, through the real
  `createEditTracker`):
  - **recorded:** a recorded commit of `rotation`; while it is pending,
    `ownEchoSet(node, 'rotation', v2)`; the send is accepted. The batch is
    reported **with** its `rotation` result (from → to), and `remote` false;
  - **the contrast:** the same steps with `remoteSet` report no result and
    `remote` true, as today;
  - **the revert:** a recorded commit; `ownEchoSet(node, 'rotation', v2)`;
    the send is **refused**. The node ends at `v2`, not at the value before
    the edit;
  - **no record:** `ownEchoSet` on a node with no open record changes
    nothing and throws nothing;
  - **the wiring guard:** the `som:set` handler at L1017 destructures
    `origin`, and calls `ownEchoSet` for `origin === 'own'` and `remoteSet`
    otherwise.
- **Proofs** (each break made on the committed tip, the named tests seen
  failing with both runs quoted, the file restored from a saved copy):
  - (r4a) remove the key comparison from `renderLibraryTiles` → the wiring
    guard fails;
  - (r4b) leave `thumbnail` out of `libraryTilesKey` → the unit test fails;
  - (r4c) remove the key comparison from `renderSkySelect` → the wiring
    guard fails;
  - (r5a) make `ownEchoSet` also set `remote` → the "recorded" test fails;
  - (r5b) make `ownEchoSet` leave `confirmed` alone → the revert test fails;
  - (r5c) call `remoteSet` for every origin in `app.js` → the wiring guard
    fails.
- **Full suites as round 1** (the kickoff's requirement 5), and the handoff
  as round 1's (requirement 3 and canonical §2).

## 3. The cards
Rounds 1 and 2's rules hold. **One implementation commit:**
`undo-hold round 3 (R4, R5): the Library and sky lists rebuild only on change; a behaviour's echo isn't another session`.

### Card 1: R4, R5, R6
- Precondition: `HEAD` = `4f66f93b7f8beda61a372e6b891c8f885b58bb5e`, and
  the worktree is clean.
- Then everything in §2, every suite, proofs (r4a)–(r4c) and (r5a)–(r5c),
  and the handoff.

### Card 2: the GLM review of round 3 (`8bed4521..<tip>`)
- A single GLM review: round 3's commit read closely, rounds 1 and 2 checked
  for regressions.
- It reproduces all six proofs.
- **It writes its own test:** a recorded commit of `translation` with an
  `ownEchoSet` of `rotation` on the same node while it is pending. The
  batch records only `translation`. The `rotation` echo touches no record
  and produces no revert.
- **It checks the six files against §2 line by line,** and confirms that
  `tileEnabled`, `tileBlockReason` and the picker's enable rule are
  unchanged.
- Then the gate, publish, DEV (`set-dev` over the unaccepted round 2), the
  finalizer and acceptance.

### Before DEV acceptance (Claude)
- **`h5.py` on the new tip:** 0 rebuilds of the tiles and the sky list in
  2 s with the spinner running, and a real click on a tile places the item.
- **`h3.py`, with check 4 corrected** (now: the typed rotation is recorded,
  and its Undo is refused as "changed elsewhere", with no other object
  moving). On `4f66f93b`, check 4 fails as §1.2 says.
- **Regressions:** `h4.py` (12 of 12), `h2.py`, and 4d-1's `c2.py`. A rerun
  is allowed for `c2`'s timing flake: it failed once on `4f66f93b`, then
  passed twice.
- **The Library and the sky by hand,** with no behaviour running: open,
  pick, Retry. The rebuild-on-change path must still show a newly loaded
  catalog and a sky change made in another tab.

## 4. Cleanup
None. Round 2's sentinel `t_799da9aa` fires after its finalizer, so no
sentinel is open. The guard links round 3's sentinel to its review gate and
DEV finalizer itself. The acceptances `t_96969906` and `t_68a0a48c` stay
blocked by design.

## 5. Kickoff body for round 3

**For the front door.**
- **The sentinel first:** titled exactly `Undo-hold r3 sentinel (undo-hold)`,
  in `t_799da9aa`'s shape, naming this revision beside round 2's, with the
  dependency-hold clause. Never reuse `t_799da9aa`, `t_6a4633e2`,
  `t_68a0a48c` or `t_96969906`.
- **Then fill the body's placeholders:**
  - `<REVISION_CHECK>`: `REVISION CHECK (front door): <commit>:devtasks/REVISION-undo-hold-round-3.md sha256 <hash>, <bytes> bytes, matches.`;
  - `<SENTINEL_ID>`;
  - `<CANONICAL_REQUIREMENTS>`, verbatim.
- **The release chain on APPROVE** is round 2's four cards with this round's
  SHA. DEV is `set-dev` over round 2, a client-only round with no server
  stop. The finalizer's `reviewed_sha` is round 3's reviewed tip.
- **Nothing is pushed to `main` between round 3's DEV release merge and the
  MAIN push.**

---

### KICKOFF — undo-hold revision round 3. Slug: `undo-hold`

You are the kickoff orchestrator for round 3 of `undo-hold`. Build the graph
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
**The contract is in git.** Before anything else, read and check all four:

```
git -C /workspace/atrium fetch origin main
git -C /workspace/atrium show 8bed4521afa50a8340d8fbe97ad1575993848811:devtasks/PREBRIEF-undo-hold.md > /tmp/prebrief.md
sha256sum /tmp/prebrief.md   # 327957b56b8bd4200c024f90272220d1dd4565558c6f5479e77ac51bee9d299f
git -C /workspace/atrium show 5a2bf360a93013026a994df0e1609f0ca6149c1a:devtasks/KICKOFF-undo-hold.md > /tmp/kickoff-r1.md
sha256sum /tmp/kickoff-r1.md   # a654d0a008011a6b07f0ae42c8c965d83978296df462fb09b43fb518cf027b61
git -C /workspace/atrium show 6790a1945455f0810c8bc8f8916b31b3435b3a15:devtasks/REVISION-undo-hold-round-2.md > /tmp/revision-r2.md
sha256sum /tmp/revision-r2.md   # 0c0c90bd0f8c1436c68582bd72f34b63e7916db0e282648164caf36996d03dc7
git -C /workspace/atrium show <revision commit>:devtasks/REVISION-undo-hold-round-3.md > /tmp/revision-r3.md
sha256sum /tmp/revision-r3.md   # <revision hash>
```

(Fill the two `<revision …>` values from the front door's revision check
above.) On any mismatch, block with `kind="capability"`, quote both hashes,
and do not work from a different text.

- **The round-3 revision is this round's contract:** its §2 (R4–R6; no new
  decision) and its §3, which gives **your card's** items. Its file set
  (six source and test files beyond round 1's, listed in its preamble)
  replaces round 1's four-file rule for this round.
- **Also binding:**
  - the pre-brief (FINAL Rev 1);
  - the round-1 kickoff's Settlement and its "Requirements for the
    implementation AND review cards (beyond the spec)", items 1–7;
  - the round-2 revision (R1–R3);
  - the GLM brief, the summary of `t_d866f1bf`.

#### Graph — build exactly this
1. `Implement r3 — undo-hold`. Assignee `atrium-deepseek`, parent: this
   kickoff, created with `max_runtime_seconds=7200`, passed explicitly.
   - **Its body carries:**
     - the references block;
     - the line `Your items: the round-3 revision's §3, "Card 1: R4, R5, R6".`;
     - the worktree rule;
     - the step rule;
     - the canonical requirements.
   - **The worktree rule:** work in the existing persistent worktree
     `/workspace/wt/undo-hold`, on `workflow/undo-hold`. Before changing
     anything:
     ```
     cd /workspace/wt/undo-hold
     git status --porcelain                                            # must print nothing
     git rev-parse HEAD                                                # must equal 4f66f93b7f8beda61a372e6b891c8f885b58bb5e
     git log --format='%h %s' 8bed4521afa50a8340d8fbe97ad1575993848811..HEAD   # round 1's two commits, then round 2's one
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
       whole handoff as a comment headed `HANDOFF — undo-hold round 3`
       before completing.
2. `GLM review r3 — undo-hold`. Assignee `atrium-glm`, parent: card 1,
   `max_runtime_seconds=3600`.
   - The body opens with the exact line
     `THIS RUN HAS TERMINAL, FILE AND GIT TOOLS. Use them for every step below.`
   - **Then:**
     - the references block;
     - "Your review: the round-3 revision's §3, 'Card 2: the GLM review of
       round 3'";
     - the range is `8bed4521..<tip card 1 reported>`, with round 3's
       commit read closely and rounds 1 and 2 for regressions;
     - review in your own detached worktree at
       `/workspace/wt/review-<your task id>` at that tip, never in the
       persistent one;
     - reproduce all six proofs, and write the translation-and-rotation test;
     - the canonical requirements.
   - **The verdict** is APPROVE or CHANGES_REQUIRED, with the exact
     lowercase 40-character SHA when approving. **Put the verdict, the SHA
     and the findings in the completion summary itself**, not only in
     comments. Metadata: `verdict`, `reviewer_role`, `review_round:
     round-3`, `findings_count` and the maximum severity.
3. `Review gate r3 — undo-hold`. Assignee `atrium-orchestrator`, parent:
   card 2. It creates nothing.
   - **On a valid APPROVE of the exact 40-character SHA,** it blocks with
     `kind="needs_input"` and the reason
     `APPROVE <SHA40>: front door, build the release chain`.
   - **Otherwise,** it blocks for the operator with the verdict quoted.
4. **The release chain is the front door's:** publish, DEV (`set-dev` over
   the unaccepted round 2), the finalizer and acceptance, at card 3's
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
