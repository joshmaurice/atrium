# Revision — scripting-4d-1 round 2 (round 1 delivered step 1 of 7)

**Status:** approved by the operator (2026-10-30 23:26 PT), **Rev 0** as
drafted, with **R-L1 as recommended**: (a), the rule stays key-exact and the
importer drops `name`. Five items: R1–R5.

- **Base:** round 1's tip `880b0f1ab2226eea677a67f6ed3fe2c1e19af4ca` on
  `workflow/scripting-4d-1`. It exists only locally, in the persistent
  worktree `/workspace/wt/scripting-4d-1`, and was never pushed.
  - **Round 1's cards:** brief `t_255de53b` (run 1148's summary is the
    brief); brief-review gate `t_e0f3e8d7`, completed by the operator;
    implementation `t_70443b8b`; GLM review `t_64414bde`, CHANGES_REQUIRED;
    review gate `t_d0639e09`, blocked; sentinel `t_adf3ee2b`.
  - Round 2 commits on top of `880b0f1a` on the same branch, in the same
    worktree. There is no merge step.
- **Round 1 is superseded, not accepted.**
  - **No one completes the review gate `t_d0639e09`.** It stays blocked,
    and it keeps round 1's sentinel `t_adf3ee2b` from firing, which is
    intended (4b-2 passdown §4.5). Both are archived when the round is
    cleaned up.
  - Round 2 has its own sentinel, created by the front door first.
- **The contract still governs, unchanged:**
  - `devtasks/PREBRIEF-scripting-4d.md`, FINAL Rev 1.4, at
    `4f19b2533308ef0dc0fa3c3d8a5b4164eb389e82` (121,240 bytes, sha256
    `457e2ff0d018580e117bc0e3aac3ae6d4d4e90aa36a9c6dbf1106cdc10279458`);
  - `devtasks/KICKOFF-scripting-4d-1.md` at
    `1a26d8faba708c7784d1ae283670921d4608ae3b` (27,952 bytes, sha256
    `426626027d62a624296d0c4971f179bd4d26c67688fae63f35a87e35d2132b5c`):
    its Settlement and its section **"Requirements for the implementation
    AND review cards (beyond the spec)"**, items 1–7;
  - the GLM brief, run 1148's summary on `t_255de53b`;
  - the operator's ruling of 2026-10-31 04:58 UTC on `t_70443b8b` and
    `t_255de53b`: nothing from the stray run 1147 (`c2d2153`) exists or may
    be reused.

  This file adds R1–R5 and R-L1, and changes nothing else.

## 1. What happened in round 1

| What | Found |
|---|---|
| **Implementation `t_70443b8b`** (run 1150, DeepSeek) | Ran 38 minutes of a 4-hour cap, with no error and no budget exhaustion. It committed **step 1 only** (`880b0f1a`) and then **completed**, listing the enum as "not in this change (later steps)". The card's rule for a run that stops partway is to block, not complete. Its handoff also lacked canonical §2's items: no tip SHA in the summary, four server files instead of all of them, and no `packages/client` or `apps/client` results |
| **GLM review `t_64414bde`** (run 1151, 138 s) | **CHANGES_REQUIRED**, three findings. It reproduced the vectors (38 accepted, 64 refused, byte for byte), `packages/behaviors` (176 pass, 1 pre-existing skip), five server files each on its own, and proofs (a), (a2) and (a3) with named failing tests |
| **The review card's cap** | The guard's 45-minute default. That is enough for one step, not for the round's review (§3, card 7) |

### 1.1 The findings, checked
- **F1 (MEDIUM): `hello.client.json`'s `scriptRunner` enum is still
  `[1, 2]`.** It is a named step-1 item (spec §8 step 1; the kickoff's
  requirement 1.1; the brief's step list), and the implementer's own comment
  defers it. Until it lands, a `scriptRunner: 3` hello is refused by the
  schema. **R1.**
- **F2 (MEDIUM-LOW): the two rule copies disagree on event entries.** The
  server copy requires every entry to be exactly `{ id }`. The client copy
  checks the id and leaves an entry's other keys unchecked for a non-`atrium/`
  id. G1 says "Entries may carry `values`", so the server copy refuses what
  the spec allows. The client copy accepts keys the spec never lists, and
  their strings have no bound or character set (4c passdown §4.1). No vector
  has a custom event with `values`, which is why the shared vectors pass on
  both copies. **R2.**
- **F3 (LOW, accepted): `invalid-index.test.js` case A2c.** Its graph is well
  formed. Its fault is the glTF extension object's `graph: "0"`, a wrapper
  Atrium never stores, and 4b-2 refused it only because its ops weren't
  allowlisted. Accepted on one condition: the test asserts that the accepted
  set is **exactly `['A2c']`**, with the reason inline. It must not exclude
  the case from the loop or mark it as a `node:test` skip, and the suite's
  skipped total stays at the one pre-existing skip. **R4.**
- **The reviewer's note on `event/send`'s index (noted only):** the client
  copy runs the `atrium/*` target check only for an integer index, and the
  server copy indexes `events[...]` unguarded. The outcome is the same today,
  but the two copies must use the same predicate. **R3.**

### 1.2 A spec gap Claude found while checking F2 (R-L1)
**The Khronos graphs name their events and variables, and G1 says nothing
about `name`.** In the checked-in subset
(`tests/fixtures/behavior-conformance-khronos/`, 143 graphs):
- **events:** 437 entries; 436 carry `name`, always equal to their `id` when
  there is one; 145 carry `values`; two (both in `core--graph_json_syntax`)
  have a `name` and **no `id`**;
- **variables:** all 1,530 carry `name`. The names run up to 361 characters,
  with newlines, quotes, braces and `≈`. They are test descriptions.
- **declarations** carry only `op`, **types** only `signature`, and **nodes**
  only `declaration`, `values`, `flows` and `configuration`.

The engine reads an event's `name` only in one error message (`index.js`
L1789), and a variable's `name` not at all. G6 requires "a survey asset that
fits converts, **passes `behaviorCheck`**". So the importer and the rule have
to agree on `name`, and today neither the spec nor the brief says how.

### R-L1. `name` on events and variables (operator decision: (a))
- **(a) Recommended: the rule stays key-exact, and the importer drops
  `name`.**
  - **Rule (both copies):** an event entry's keys are `id` (required) and
    `values` (optional), and nothing else. An `atrium/*` entry is exactly
    `{ id }`, as now. A variable entry's keys are `type` (required) and
    `value` (optional), and nothing else. Any other key is refused with the
    copy's existing reason code for that list.
  - **Importer (`convertGraph`):** drops `name` from every event and variable
    entry, and lists "names dropped: N" in the report. It refuses an event
    entry with no `id`, naming the entry's index. An Atrium event needs an id
    under G1, and making one up would change what an external sender
    matches.
  - **Why:** labels never run. Keeping them would mean a bound and a
    character set for strings like the 361-character, multi-line test
    descriptions above, for no behaviour.
- **(b) Alternative:** allow `name` on both, as 1–64 characters of
  `[A-Za-z0-9_./:-]`. The importer would still have to truncate or drop
  most Khronos variable names, so (a) is simpler and just as faithful.

## 2. The contract (round 2)

### R1. `scriptRunner: 3` in the `hello` schema (F1)
- `packages/protocol/src/schemas/hello.client.json`: the `scriptRunner` enum
  becomes `[1, 2, 3]`.
- **Protocol tests:** `3` validates; `4`, `0`, `"3"` and `true` are refused;
  a hello with no `scriptRunner` key still validates.
- **Nothing else changes here.** Election on `3`, `AtriumClient`'s `3`, and
  the frozen `14ab0076` hello are step 4's, as the spec orders them.

### R2. One event-entry rule and one variable-entry rule, in both copies (F2, R-L1)
- **Both copies,** as R-L1 (a) states: event keys are `id` and optional
  `values`; `atrium/*` is exactly `{ id }`; variable keys are `type` and
  optional `value`.
- **New vectors** through both copies and the validator:
  - a custom event with `values` is **accepted**;
  - the same event with `name` is **refused**;
  - a custom event with an `extras` key is **refused**;
  - `atrium/interval` with `values` is **refused**;
  - a variable with `name` is **refused**;
  - a variable with `type` only is **accepted** when the validator accepts
    it (if the validator refuses it, say so and keep the vector refused with
    the validator's reason).
- **Regenerate** `tests/fixtures/behavior-vectors.json` with
  `gen-vectors.mjs`, and state the new counts.

### R3. `event/send`'s target check, the same predicate in both copies
- Both copies run the `atrium/*` target check only when
  `configuration.event.value[0]` is an integer in range, and leave anything
  else to the validator.
- **New vector:** an `event/send` whose `event` configuration is
  `{ value: [null] }` gets the same verdict and the same reason from both
  copies.

### R4. A2c, asserted (F3)
`invalid-index.test.js` asserts that the accepted set is exactly `['A2c']`,
with F3's reason in a comment. It has no loop exclusion and no skip.

### R5. One card per step, and the step can't be skipped
This is about how the round runs, not the code. §3 below, and the kickoff in
§4, carry it:
- **Each step gets its own implementation card.** The card does that step
  and **no other**.
- **The card's body lists the step's items.** The handoff answers each one
  with the files and the test names that pin it.
- **A card may not complete with an item undone.** If it can't finish, it
  blocks with `kind="needs_input"` and names what is left. Completing with
  "later steps" is not allowed.
- **Each card first checks its predecessor's work:** a clean worktree,
  `HEAD` equal to the tip the parent card reported, and one commit per
  earlier step. If anything doesn't match, it blocks with
  `kind="needs_input"` and touches nothing.
- **A progress comment** after each item group and after each commit, so a
  run cut short resumes where it stopped.

## 3. The cards, their steps and their items

**Commit subjects** (one commit per step, every commit runnable):
- step 1 is `880b0f1a`, plus the fix commit
  `scripting-4d-1 step 1 fix (R1–R4): …`;
- each later step is `scripting-4d-1 step <N> (<G…>): …`.

**Every implementation card's handoff (cards 1–5)** carries:
- the 40-character lowercase tip SHA, in the summary and in metadata
  (`tip_sha`, plus `step`);
- every item of its step, **each marked done** with its files and test
  names;
- the suites run at that step:
  - every package the step touched, `node --test` on its own directory,
    with counts and exit codes;
  - every server test file it touched, or that tests a server file it
    touched, each alone under `timeout 180`;
- the operator's 21 fixtures' current results, if the step touched the
  adapter or the runner (cards 1, 2 and 5);
- the tests deferred to a later step, each named with its step;
- the final `git status`, which must be empty.

**Card 6's handoff** is the full one: the round-1 kickoff's requirement 3
and canonical §2.

**The tests for each item are the spec's §6 row for that G.** The step's own
tests must exist at its commit. The proofs are all run at card 6.

### Card 1: R1–R4, then step 2 (G3, the adapter)
Precondition: `HEAD` = `880b0f1ab2226eea677a67f6ed3fe2c1e19af4ca`.
- **Fix commit:** R1, R2, R3 and R4 (§2), the vectors regenerated, and the
  protocol, behaviors and server files each rule copy touches run.
- **Step 2:**
  1. **the identity gate:** the renamed load copy for every declaration
     whose `(op, extension)` isn't in `EXECUTABLE`. The stored graph is
     never edited. `event/onSelect` is the exception: refused unless exact.
     `r1` becomes a test through the real loader;
  2. **the registry kept by allowlist,** its key set equal to the allowlist,
     with no name denylist;
  3. **pointer registration once per family,** the index read from the path
     (P26). Tests: the three-entry `nodeMap` (literal, `[x]` and `{x}`), and
     light hosts at 0 and 2;
  4. **the clock:** the injected `now`. The engine's own `performance.now()`
     call stays (M3). No allowlisted op calls the global `setTimeout`;
  5. **the delay subclasses:**
     - monotonic ids;
     - the 17th pending delay takes `err`;
     - a stale id cancels nothing;
     - 10,000 sequential delays leave one live entry;
     - `dispose` clears with the injected `clearTimeout`;
  6. **the interpolation wrapper on the bus:**
     - a rejection disposes at the start of the next tick, once, with no
       `unhandledRejection`;
     - a sync throw is rethrown, and disposes in the same tick;
  7. **`graphReport`,** each flag;
  8. **`worldMatrix`** in `@atrium/som` (`world-matrix.js`, exported beside
     `worldPosition`), and `globalMatrix` of a nested node equals it.

### Card 2: step 3 (G4, G5's `som:set`)
1. **the write check:** through `packages/behaviors/src/value-rules.js`
   (new, imported relatively), and `tests/fixtures/value-vectors.json`
   (new), which the server's `authorizeNodeSend` tests also read;
2. **the total send opportunity:** a send that didn't happen (`canSend()`
   false, a throw, a non-number) clears its entry;
3. **the frame limit and its rotation,** the 9 ms stop, and "Throttled"
   after two seconds of skips;
4. **the overlay by revision,** written inside `enqueue` right after
   `queue.set`:
   - the drag drop returns `false`;
   - every path that empties the queue empties the overlay in the same
     call;
5. **the status lines,** exactly as the spec writes them;
6. **`som:set`'s `origin`, and `requestSeq` on own echoes,** at every site
   in `AtriumClient`. The tests use the real `AtriumClient`'s events.

### Card 3: step 4 (G2, the rest of G5, G10)
1. **`behaviorBytesIn` on every path:**
   - a send that replaces a leaf, an `add`, a Duplicate, an Undo re-add,
     and healing;
   - the refusal text exactly as G2 writes it, and no partial change;
2. **the two timing lines,** exactly as G2 writes them;
3. **election on `3` in both places** (the `hello` path and
   `canRunBehaviors`);
4. **`AtriumClient`:** `scriptRunner: true` sends `3`, and a cross-origin
   hello has no `scriptRunner` key. Also `canSend()`;
5. **the frozen `14ab0076` hello:**
   `tests/fixtures/protocol-compat/hello.client.14ab0076.json` and that
   folder's README;
6. **N1;**
7. **`behaviors-export.mjs` and `behaviors-reconcile.mjs`** (G10's table):
   offline, an exclusive lock, a dry run by default, and three outcomes.

### Card 4: step 5 (G6, the importer)
1. **`graph-import.js`:** `parseGraphSource`, `referencesOf` and
   `convertGraph`. These include R-L1's rule: `name` dropped and counted,
   and an id-less event refused, naming its index;
2. **`graph-import-panel.js`,** and `index.html`'s markup and style only;
3. **the three notes and the Enable confirmation,** exactly as G6 writes
   them;
4. **the wiring guards:** nothing reaches the DOM as HTML, and there is no
   `innerHTML` with graph data in the panel or the log view;
5. **R-L1's test:** a Khronos subset graph with named events and variables
   converts and passes `behaviorCheck`.

### Card 5: step 6 (G8, conformance)
1. **`conformance.mjs`** on the checked-in subset, and the operator's 21
   fixtures through the real adapter, under their README's harness rules.
   The fixtures are read-only, and a fixture the code can't pass is a
   finding;
2. **`expected-4d.json` regenerated** against the manifest's baseline (134
   pass, 8 fail, `math/random` disposed), every change explained.

### Card 6: step 7 (full suites, proofs, the handoff)
1. **Full suites,** run with the round-1 kickoff's requirement 5;
2. **proofs (a)–(h), with every sub-proof** (a2, a3, b2, b3, c0, c, c2, c3,
   c4, d–d5, e, e2, f–f3, g, h, h2), and round 2's:
   - **(r1)** the enum back to `[1, 2]`: the protocol test for `3` fails;
   - **(r2)** the server copy's event check back to exactly `{ id }`: the
     custom-event-with-`values` vector fails in `behavior-leaf.test.js`;
   - **(r2b)** the client copy accepting any key on a custom event: the
     `name` vector fails in `behavior-spec.test.js`;
   - **(r-L1)** `convertGraph` keeping `name`: R-L1's conversion test fails.

   Each proof quotes both runs (failing and green), with the failing test
   names, and states whether each file exited on its own. Commit before the
   proofs. Restore from a saved copy, never with `git checkout`. Run them one
   at a time;
3. **the full handoff:** the round-1 kickoff's requirement 3 and canonical
   §2, with all 21 fixtures and the Khronos subset against the manifest.

### Card 7: the GLM review of the whole round
- **It covers `4f19b253` to the round-2 tip,** step 1 included, against the
  spec, the brief and this revision.
- **It does everything the round-1 kickoff's requirement 4 lists:**
  - reproduces **every** proof, (r1)–(r-L1) included;
  - runs the 21 fixtures and the Khronos subset itself;
  - writes its own P26 check;
  - runs `r1`'s graph through the adapter;
  - reads the overlay against its invariant;
  - runs the greps;
  - runs the reconcile on a scratch database twice.
- **And:**
  - **diffs the two rule copies** clause by clause, and lists every place
    they differ, if any;
  - **checks every handoff of cards 1–6 against its step's items here**,
    and names any item without a test.
- **Cap: 14400 s.** A progress comment after each stage.

### Before DEV acceptance, as the round-1 kickoff says
- Claude's §6.1 browser checks, with Q7's measured gates and the rollback
  rehearsal;
- the outside review of the whole round;
- `atrium-release-status` after the DEV deploy.

## 4. Kickoff body for round 2

**For the front door.** Do these before creating anything:
1. Check that this file's commit is on `origin/main`, and compute its
   sha256.
2. Create **round 2's sentinel first**: the same shape as `t_adf3ee2b`,
   titled `Scripting-4d-1 r2 sentinel (scripting-4d-1)`.
3. Fill the body's three placeholders:
   - `<REVISION_CHECK>`:
     `REVISION CHECK (front door): <commit>:devtasks/REVISION-scripting-4d-1.md sha256 <hash>, <bytes> bytes, matches.`
   - `<SENTINEL_ID>`: the new sentinel's id.
   - `<CANONICAL_REQUIREMENTS>`: the canonical worker-card requirements,
     verbatim, the same text as round 1's.
4. Create the kickoff card with the filled body **in its body field**, and
   read it back whole.
5. `kanban_link(parent_id=<kickoff id>, child_id=<sentinel id>)`, and read
   the sentinel back. Nothing is posted on the kickoff card afterwards.

Keep in mind:
- **There are two open sentinels by design,** so the guard's automatic
  sentinel link is skipped. That's why the kickoff links the gate by id.
- **No one completes `t_d0639e09`.**

---

### KICKOFF — scripting-4d-1 revision round 2. Slug: `scripting-4d-1`

You are the kickoff orchestrator for round 2 of `scripting-4d-1`. Build the
graph below, read it back, report, and stop. Do not implement, review or
deploy anything yourself.
- **Your tools:** only `kanban_*`.
- **Everything you need is in this body.** Nothing will be posted on this
  card afterwards, so don't wait for comments, and **never block this
  card.**
- **Blocking:** never call `kanban_block` without an explicit `task_id`.
- **Titles:** use them exactly as written, character for character. Don't
  add words to them.
- **Card bodies:**
  - Write each card's body from the bullets under its title. Don't copy
    this kickoff's own instructions to you into any card.
  - The references block, the hash checks and the canonical requirements
    are copied whole.
  - Bodies go in the body field when you create the card. Read each card
    back; if a body is empty, post it as the card's first comment while it's
    `todo`. Never create a second card in its place.
- **Create every card with its parent** (`parents=[…]`). If the guard holds
  a card for want of one, link its parent with `kanban_link`.

**The front door's spec check:** `SPEC CHECK (front door): 4f19b2533308ef0dc0fa3c3d8a5b4164eb389e82:devtasks/PREBRIEF-scripting-4d.md sha256 457e2ff0d018580e117bc0e3aac3ae6d4d4e90aa36a9c6dbf1106cdc10279458, 121240 bytes, matches.`

**The front door's revision check:** <REVISION_CHECK>

**The sentinel:** `<SENTINEL_ID>`

#### The references block (copy it whole into cards 1–7)
**The contract is in git.** Before anything else, read and check all three:

```
git -C /workspace/atrium fetch origin main
git -C /workspace/atrium show 4f19b2533308ef0dc0fa3c3d8a5b4164eb389e82:devtasks/PREBRIEF-scripting-4d.md > /tmp/prebrief.md
sha256sum /tmp/prebrief.md   # 457e2ff0d018580e117bc0e3aac3ae6d4d4e90aa36a9c6dbf1106cdc10279458
git -C /workspace/atrium show 1a26d8faba708c7784d1ae283670921d4608ae3b:devtasks/KICKOFF-scripting-4d-1.md > /tmp/kickoff-r1.md
sha256sum /tmp/kickoff-r1.md   # 426626027d62a624296d0c4971f179bd4d26c67688fae63f35a87e35d2132b5c
git -C /workspace/atrium show <revision commit>:devtasks/REVISION-scripting-4d-1.md > /tmp/revision-r2.md
sha256sum /tmp/revision-r2.md   # <revision hash>
```

(Fill the two `<revision …>` values from the front door's revision check
above.) On any mismatch, block with `kind="capability"`, quote both hashes,
and do not work from a different text.

- **The revision is round 2's contract:** its §2 (R1–R4, and R-L1 as the
  operator decided it) and its §3, which gives **your card's** step, items
  and handoff.
- **Also binding:**
  - the pre-brief (FINAL Rev 1.4);
  - the round-1 kickoff's Settlement, and its section "Requirements for the
    implementation AND review cards (beyond the spec)", items 1–7;
  - the GLM brief, run 1148's summary on `t_255de53b`;
  - the operator's ruling of 2026-10-31 04:58 UTC on `t_70443b8b`.
- **Nothing from run 1147 (`c2d2153`) exists or may be reused.**

#### Graph — build exactly this
Cards 1–6 are assigned to `atrium-deepseek` and created with
`max_runtime_seconds=14400`. Each one's parent is the previous card, and
card 1's is this kickoff.

**Every implementation card's body** carries:
- the references block;
- the line `Your step and items: the revision's §3, "<card heading>".`,
  with that card's heading as below;
- the worktree rule below;
- the step rule below;
- the canonical requirements.

**The worktree rule:** work in the existing persistent worktree
`/workspace/wt/scripting-4d-1`, on `workflow/scripting-4d-1`. Before
changing anything:

```
cd /workspace/wt/scripting-4d-1
git status --porcelain                                            # must print nothing
git rev-parse HEAD                                                # must equal the tip your parent card reported (card 1: 880b0f1ab2226eea677a67f6ed3fe2c1e19af4ca)
git log --format='%h %s' 4f19b2533308ef0dc0fa3c3d8a5b4164eb389e82..HEAD   # one commit per earlier step, as the revision's §3 names them
pnpm install --frozen-lockfile --prefer-offline
readlink -f packages/server/node_modules/@atrium/protocol          # must resolve inside this worktree
```

On any mismatch, block with `kind="needs_input"`, quote what you saw, and
touch nothing. Commit locally and never push.

**The step rule:**
- Do **your card's step and no other.**
- Your handoff marks **every item** of your step done, with its files and
  test names, plus the rest of the revision's §3 handoff list.
- **Never complete with an item undone, or with "later steps".** If you
  can't finish, block with `kind="needs_input"` and name what is left.
- Post a short progress comment on your own card after each item group and
  after each commit.

1. `Implement r2 step 2 — scripting-4d-1`. Heading: "Card 1: R1–R4, then
   step 2 (G3, the adapter)".
2. `Implement r2 step 3 — scripting-4d-1`. Heading: "Card 2: step 3 (G4,
   G5's `som:set`)".
3. `Implement r2 step 4 — scripting-4d-1`. Heading: "Card 3: step 4 (G2,
   the rest of G5, G10)".
4. `Implement r2 step 5 — scripting-4d-1`. Heading: "Card 4: step 5 (G6,
   the importer)".
5. `Implement r2 step 6 — scripting-4d-1`. Heading: "Card 5: step 6 (G8,
   conformance)".
6. `Implement r2 step 7 — scripting-4d-1`. Heading: "Card 6: step 7 (full
   suites, proofs, the handoff)".
7. `GLM review r2 — scripting-4d-1`. Assignee `atrium-glm`, parent: card 6,
   `max_runtime_seconds=14400`.
   - The body opens with the exact line
     `THIS RUN HAS TERMINAL, FILE AND GIT TOOLS. Use them for every step below.`
   - Then: the references block; "Your review: the revision's §3, 'Card 7:
     the GLM review of the whole round'"; review in your own detached
     worktree at `/workspace/wt/review-<your task id>` at the tip card 6
     reported, never in the persistent one; the canonical requirements.
   - The verdict is APPROVE or CHANGES_REQUIRED, with the exact lowercase
     40-character SHA when approving, and metadata `verdict`,
     `reviewer_role`, `review_round: round-2`, `findings_count` and the
     maximum severity.
8. `Review gate r2 — scripting-4d-1`. Assignee `atrium-orchestrator`,
   parent: card 7. It creates nothing.
   - **On a valid APPROVE of the exact 40-character SHA,** it blocks with
     `kind="needs_input"` and the reason
     `APPROVE <SHA40>: front door, build the release chain`.
   - **Otherwise,** it blocks for the operator with the verdict quoted.
9. **Before you complete,** link card 8 to the sentinel:
   `kanban_link(parent_id=<card 8 id>, child_id=<SENTINEL_ID>)`. Round 1's
   `t_adf3ee2b` and `t_d0639e09` must not be linked, completed or reused.
   Don't create a sentinel yourself.
10. **The release chain is the front door's:** the same four cards as round
    1 would have had, built whole at card 8's APPROVE. Nothing reaches MAIN
    or PROD.

#### Report back
- the eight ids, each with its parent;
- each implementation card's and the review's `max_runtime_seconds`
  (14400);
- that cards 1–7 each carry the references block with the filled revision
  commit and hash, in their body fields, and the canonical requirements;
- the review's opening line;
- card 8 linked to `<SENTINEL_ID>`.

Then complete this card.

#### WORKER-CARD REQUIREMENTS (canonical)
<CANONICAL_REQUIREMENTS>

---
