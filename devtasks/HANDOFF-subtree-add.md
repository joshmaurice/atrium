# Handoff: `subtree-add`, implemented on `claude/subtree-add`

**Contract:** `devtasks/PREBRIEF-subtree-add.md` FINAL Rev 2 (operator, 2026-11-06).
**Base:** `99ed7a8`, the pre-brief's FINAL commit on this branch. Its code is
`main`'s (`70a30bd2`, the SHA §2's facts were verified at), which is PROD's and
DEV's (`42aa56ff`, `release_status`, 2026-11-07); only `devtasks/` differs. **Implemented by Claude in the
fast lane** (SA-L5 (a)), no OpenRouter. **Checked by a fresh Claude agent**
(§7: no must-fix; its two should-fix and three of its nits taken in commit 6).
**Reviewed outside** (Fable, at `02b5554b`: APPROVE WITH NITS; §8: its
should-fix and N-2 taken in commit 8). Not published or deployed.

The decisions it implements: SA-L1 (a) one `add` carries the tree; SA-L2 (a)
256 nodes, 8 generations, 1,024 primitives, the socket's 1,048,576 bytes as the
server's byte bound; SA-L3 (b) materials shared within a message (`{ ref: n }`);
SA-L4 (a) Delete asks nothing for a group that can come back; SA-L6 (d) and
SA-L7 (c): selection and parts (T11) are the next round's, §9.

## 1. The commits
| Commit | What (contract items) |
|---|---|
| 1 `ab5674c` | T1, T8, T12's form: `definitions.node` (recursive `children`, `minItems: 1`) and the `{ ref }` material in `add.client.json` and `add.server.json`; the tree rule in both copies (`add-spec.js`, `send-policy.js`): `subtreeShapeProblem`, `membersInMessageOrder`, `nodeNameFormOk`, `materialRefsProblem`, the seven new reasons; 34 tree vectors |
| 2 `19268b8` | T2, T3, T12's ingest: step 0 (`subtreeCountProblem`, before Ajv), the shape pass, every per-member check in `session.js`; one id set per message (`savedObjectIds`); `treeNameTaken` in both `addNode` copies; `ingestNode` (pre-order list, the ref pre-pass, one buffer, the call's materials) |
| 3 `650c1af` | T7: the client sends `addFields` 3; `ADD_FIELDS_LEVEL` 3 in `isStaleEditor` and the server hello; `client.serverAddFields`; both hello schemas; the moved tests and `c1.py` |
| 4 `96584a2` | T4, T5, T12's builder: `_onAdd` (one `som:add` per member, `som:desync` on a failed ingest), `som:remove`'s `removed`; Duplicate and Undo of trees (`edit-duplicate.js`, `edit-undo.js`); the `som:add`/`som:remove` re-captures and the delete question in `app.js` |
| 5 `fd0bb88` | T6: Copy and Paste of trees (`copy-paste.js`), the Inspect panel's parts line and the paste's level, notes and retry (`app.js`); the two-world end-to-end group test; the full suites; the proofs; this file |
| 6 `02b5554` | the fresh check's fixes: the Copy and Paste notes' parts summary, T6's lowercase "includes", the paste retry keeping a free root name, `ingestNode`'s first pass numbering exactly what the build numbers, the client half of the byte-bound test |
| 7 `d2aadc2` | `devtasks/` only: the outside code-review prompt, this file's base line |
| 8 (see §8) | the outside review's fixes: a part that arrives hidden in a live add is hidden in the view (`app.js`); the e2e's Undo wiring takes `app.js`'s re-captures, and a part removed elsewhere during a group's Delete |

Code files touched are §6's list. Outside it: only `devtasks/` (this file).

## 2. Tests
- **All suites, each server file alone under `timeout 180`:** 65 suites,
  **4,451 passing, 0 failing, 1 named skip** (`apps/client`'s richer-add R7 stated-limit test, unchanged; the outside review caught that this said the server's),
  at commit 5's code before the proofs. The proofs added one test (the run-time
  pad wiring test, §2.2) and changed nine assertions in five test files (§4,
  item 9); each touched file was rerun alone and passes: **4,452** (a full run confirmed it). After commit 6: **4,460**; after commit 8: **4,463**, 0 failing.
  Baseline at `99ed7a8`: 64 suites, 4,234 passing, the same skip.
- **`message-depth-measure.test.js`**: the deepest message is now 27 levels
  (an 8-generation tree with a template leaf on its deepest member; the guard
  is 64). It took **134.6 s of its 180 s** in the full run (126 s alone):
  the margin is getting thin; worth splitting before the next round adds to
  it.
- **New checks fail on today's code** (the code of the commit before, the
  tests of the commit):
  - commit 1: the vectors 26 fail in each copy; `add-node-boundaries` 12 fail;
    `subtree-add-schema` 4 fail;
  - commit 2: the server file 24 fail (1 passes: a non-array `children` is
    Ajv's, today's behaviour); the SOM file 9 fail (2 pass: a meshless tree
    makes no buffer, a single node ingests as before);
  - commit 3: `subtree-add-hello` 4 of 4 fail; `richer-add`'s moved
    `isStaleEditor` test fails (a level-2 tab isn't stale today);
  - commit 4: `subtree-add-duplicate`, `-undo`, `-client` fail at import or
    first assertion; `subtree-add-wiring` 5 fail (1 passes: SA-L4's question
    with its count, unchanged); `subtree-add-render` 4 of 4 fail;
  - commit 5 (against `96584a2`): `subtree-add-paste` fails at import (its
    exports are new); `copy-objects-wiring` 4 assertions fail in two groups
    (K4's Inspect panel, K6's paste branch); the e2e group test fails at the
    Copy ("Objects with children can’t be duplicated yet"), its five old tests
    pass.
- **New test files** (counts at commit 5):
  - `packages/protocol/test/subtree-add-schema.test.js` (14);
  - `packages/server/test/subtree-add.test.js` (30; port 0; both world kinds);
  - `packages/som/test/subtree-add-ingest.test.js` (11);
  - `packages/client/tests/subtree-add-hello.test.js` (4),
    `subtree-add-client.test.js` (6);
  - `packages/renderer-three/tests/subtree-add-render.test.js` (4);
  - `apps/client/tests/subtree-add-duplicate.test.js` (25),
    `subtree-add-undo.test.js` (9), `subtree-add-wiring.test.js` (7),
    `subtree-add-paste.test.js` (14);
  - grown: `add-node-boundaries` (74), the vectors (153 server, 151 client),
    `copy-objects-e2e` (6: **a lamp with a hidden part, a shared material, a
    member reference and a foreign one, copied by a visitor of A and pasted
    in B through two real servers**; B's joiner sees every part credited, the
    reference followed, the foreign one recorded on its member, one material,
    the part hidden, the root visible; one Undo removes the group on the
    server and for the joiner).

### 2.1 The proofs (each break made in a scratch copy of commit 5, the named tests seen failing, every file restored from a saved copy)
The harness is `/home/claude/notes/proofs.py` (session-local; each break is
one text replacement, listed there).

| Proof | Break | Failed |
|---|---|---|
| (p1) | the handler's per-member `checkNewName` and `treeNameTaken` both removed | "a member whose name the world holds" (accepted: the world holds two `crate-01`); the 256-member test (its `checkNewName` spy) |
| (p1b) | the shape pass moved after the per-member checks | the T2-order test, on its spies (the id set is built before the refusal) |
| (p1c) | step 0 removed | the 60,000-member test and its visitor case (Ajv's text instead), the 9-generation chain |
| (p1d) | the primitive budget removed from T1 (both copies' shape pass) | 6 boundary tests (1,025 refused, the dense tree, counted before reading) in both copies. **Not the server's handler tests:** step 0 refuses the same message first |
| (p1d2) | the budget removed from step 0 as well | the server's dense-tree test (both world kinds) and "1,025 are refused" |
| (p2) | one buffer per member | the SOM's one-buffer test; the server's three-generation and part-removed tests (both kinds) |
| (p3) | `som:add` for the root only | `packages/client`'s "one `som:add` per member"; **`apps/client`'s run-time pad test** (written for this proof, §2.2) |
| (p4) | `checkEntry`'s comparison reduced to the root | the part-added-meanwhile Redo test |
| (p5) | the member map reduced to self-references, in Duplicate and Paste | Duplicate's behaviour-map test; Paste's another-world and same-world tests; the e2e group test |
| (p6) | the server's level left at 2 | the hello-level test; the `42aa56ff`-tab test |
| (p6b) | the client ignores the level (`treesAllowed()` true; `preparePaste` treats every destination as level 3) | Paste's "takes no group" and the S5 inline-materials test; the `treesAllowed` wiring test |
| (p7) | the depth bound removed (both copies' shape pass) | the 9-generation vector in both suites |
| (p8) | `app.js`'s `som:remove` re-capture removed | the wiring test (as text). The engine's member-removed-meanwhile test passes: it calls `reCapture` itself (§4, item 7) |
| (p10) | a ref ingested as a new default material | 5 SOM tests (numbering, recolour, no-material numbering, cross-branch, save and reload); the server's three-generation tests (both kinds) and T12's recolour; the render test |
| (p10b) | `buildDescriptor` numbering breadth-first | the two-branch pre-order test |
| (p10c) | `ingestNode`'s first pass removed | the SOM's forward-ref atomicity test. The server's tests pass: `checkAddNode`'s refs pass refuses a forward ref before any ingest |

(p9) is T11's and lives in §9 of the pre-brief, with the selection round.

### 2.2 Found while proving
- **(p10) first killed the server and SOM test files** rather than failing
  them (`SIGKILL`, out of memory): `assert.equal` on two glTF-Transform
  materials that differ builds a failure message by inspecting the whole
  document graph. Every identity check on a glTF-Transform object in the new
  tests is now `assert.ok(a === b, …)` with the names in the message (nine
  assertions: server ×2, SOM ×3, `subtree-add-client`, `subtree-add-duplicate`
  ×2, the e2e). Worth a line in AGENTS.md's gotchas.
- **(p3)'s `apps/client` half had no test.** The pre-brief named one (a pad
  part of a remote tree is in `derivePads`' result after the `som:add`
  handler); it now exists: `app.js`'s `derivePads` and its pad `som:add`
  handler, lifted as text and run on a real `AtriumClient` fed a tree, check
  the pad's world position under a moved root and one re-capture per message.

## 3. What was built, where (commit 5)
- **`copyObject(node, source, { date, nameOf, trees })`**: with `trees`, a
  group is copied whole (the descriptor from `buildDescriptor` with refs, the
  member rules per member); `names` holds only ids referred to from outside
  the tree. Without `trees`, a group is refused with Duplicate's children
  reason, as before.
- **`preparePaste(…, { destAddFields })`**, every step per member: names (a
  member's own name kept when free, else `copyName`); one fresh id per member
  through one member map; the extras whitelist per member, a dropped key's
  note naming the part ("its part “stand”’s Atrium data “planted”"); the
  hidden marker removed from the root only; the credit on every member; K7 per
  member (the member map first, then, from another world, disabled, and every
  other id replaced through one foreign map for the tree, recorded on that
  member's `copiedFrom.refs`); K8 per member, one question per host. A
  destination below level 3 takes no group (`PASTE_TEXT.noTrees`); a single
  object copied at level 3 with refs has them turned back into materials for
  it, with the note "It comes with its own materials" (`inlineMaterialRefs`).
- **`renamePaste(descriptor, { rootName, originals, isFree })`**: the retry
  after a name refusal re-chooses the names only. The position, ids, behaviour
  and K8 answers stay; nothing is asked again; the prepared descriptor is not
  changed.
- **`treeMembers`**, **`partsSummary`** (`{ parts, hidden }`: members below
  the root) and **`partsLines`** ("2 parts", "Includes 1 hidden part").
- **`app.js`**: the Inspect panel's name line carries the parts
  (`lamp-01 (2 parts)`) and the behaviour lines of every member; Copy's hint
  and Copy pass `trees: treesAllowed()`; Paste passes
  `destAddFields: client.serverAddFields` and keeps the original names for the
  retry, which uses `renamePaste`.

## 4. Choices the contract left open, and where the code differs from its words
1. **The node's key set is left to the schema** (`additionalProperties: false`
   on `definitions.node`); the tree rule doesn't repeat it.
2. **DEV step 3 is Rev 1.2's:** Duplicate of a part stays refused with
   "Only top-level objects can be duplicated yet", and Delete of a part asks
   (parts are the selection round's, SA-L7 (c)).
3. **`partsSummary` counts the members below the root:** the lamp is
   "2 parts", a single object has no line.
4. **K8 asks once per host for the whole tree**, not once per member; a
   declined question prepares nothing.
5. **A Paste's same-world case** keeps every grant and enabled state and adds
   no credit, as a Duplicate (the member map only).
6. **The e2e's Undo wiring** now passes `getObjectByName`, `trees` and
   `prepareRestore`'s options, as `app.js` does; without them the group's add
   is never recorded (found writing the test).
7. **(p8) is caught as text only.** The `som:remove` handler reaches a dozen
   page objects (`editTracker`, `structure`, the selection); lifting it to run
   would take a page stand-in larger than the handler. The engine half is
   tested in `subtree-add-undo`.
8. **(p1d) needed a second break (p1d2)** to fail on the server: the budget is
   in step 0 and in T1, so the server refuses at step 0 when T1's copy is
   gone. Both layers are now proved.
9. **Nine identity assertions** use `assert.ok(a === b)` (§2.2).

## 5. Not done, or not checked
- **Not run in a browser.** `app.js` parses; the wiring tests read it and run
  two of its pieces; the panel's look and the clicks are the DEV acceptance's
  (pre-brief §5).
- **Claude's checks before DEV acceptance** (pre-brief §5) run on the
  published SHA: `p10`, `p1`/`p2`, `add-check`'s `p3`/`p4`/`p7`,
  `review-q/q2`, `h1`–`h6`, `c2`, and T12's acceptance (`t12-fixedpoint`,
  `t12-shared`, `t12-prune` on `atrium.gltf`).
- **T11 (parts: Copy, Duplicate, Undo of a part)** and selection are the next
  round's (§9).

## 6. Release
A server, protocol and client round; no `package.json` or lockfile change; the
client and server levels move together (T7: a tab from before the deploy is
told to reload; a level-3 page facing an older server keeps single objects and
inlines refs). Before the PROD deploy the operator reruns `p6` on PROD (§6 of
the pre-brief, its subtree-add counters); a group whose shape differs from
§2.5's is shown to Claude first. Host commands with the real SHA come with the
round's release notes.

## 7. The fresh-agent check (of `99ed7a8..fd0bb88`)
No must-fix. It reran the suites, and probed against the real code: the
numbering of refs across a cross-branch tree (builder, both rules, ingest:
the fixed point holds); version skew both ways with real servers at
`99ed7a8` and `fd0bb88`; the cost of 256 `som:add` events through the real
runner (28.9 ms). It found the server's order, atomicity, Undo/Redo of groups
and Copy/Paste ids, references, credit, marker and URLs sound. Its findings,
each reproduced here before anything changed, and what was done (commit 6):

- **S-1, two §5 tests.** (a) §5's client half of the byte bounds was missing:
  now a legal two-node tree of 1,000,240 bytes or more is refused by
  `prepareDuplicate` (`size`) and by `prepareRestore` (the restore is an add
  this client sends, so Delete asks first: N3's rules, unchanged). The
  behaviour was already right, so the test was proved by a break (Duplicate's
  byte check removed: it fails). (b) The T2-order test refuses on
  `children-names`, not §5's 257-member `children-count` (step 0 now refuses
  that before Ajv), and spies on the SOM methods, not `checkTransformValues`
  (an imported function, not a method): **kept** — §5 names the three spies as
  alternatives, and (p1b) fails on the `checkNewName` and id-set spies.
- **S-2, T6's paste note.** Taken. The Copy note (Edit and Inspect) and the
  Paste note now summarise a group after its name, as the Inspect name line
  does: `Copied “lamp-01” (2 parts).`, `Pasted “lamp-01” (2 parts;
  includes 1 hidden part).` (`partsText`, `descriptorPartsSummary`; a prepared
  paste returns `parts`). A single object's notes are unchanged.
- **Nit 1, `ingestNode`'s first pass and the build disagreed** on a message
  no conforming server sends (a falsy material numbered by the first pass,
  not by the build; a `null` primitive or a non-array `primitives` read only
  by the build), so the build could throw half-way and leave names taken.
  Taken: the first pass numbers what the build numbers and refuses what the
  build can't read; three atomicity tests (all failed before). The tab's own
  add left pending by `som:desync` is cleared by the resync's reconnect
  (`app.js` L1120): no change.
- **Nit 2, the paste retry renamed a root whose name was still free** (a
  part's name was taken). Taken: the retry keeps the root's name when free.
- **Nit 3, Undo re-points parts by name, not by child-index path** as T5
  words it: names are unique within a tree and the members are re-captured
  with the descriptor, so the two are equivalent. Kept; recorded here.
- **Nit 4, wording.** The Inspect line's "Includes" mid-parenthesis: taken
  (T6's lowercase "includes"). The K7 note reads "Its part “X”’s behaviour
  referred to…" where T6 quotes "Its part “Button” referred to…" (elided):
  kept, as it says what refers.
- **Nit 5, the S6 test** uses a shadowed duplicate name, not the animation
  name §5 names: on load nodes register before animations, so that case can't
  arise from a loaded file. Kept.
- **Nit 6, the measure test's 134.6 s:** already in §2.
- **Unconfirmed, the per-member listeners it couldn't run in Node.**
  `modelBridge.reconcile()` per member, measured here
  (`/home/claude/notes/probes/reconcile-per-member.mjs`): 256 calls over a
  1,020-node world take 21 ms; no change. The SOM inspector's
  `treeView.rebuild` per member is in `tools/`, outside §6's file list: a
  follow-up if it shows.

## 8. The outside code review (Fable, of `02b5554b`)
`devtasks/REVIEW-subtree-add-code-fable.md`. **APPROVE WITH NITS**, no
must-fix. It cloned, ran every listed file (after rebuilding `better-sqlite3`,
N-1), and probed the real server and two real tabs: hostile shapes against
step 0 and Ajv, the ref numbering across `{}`, no-material primitives and a
cross-branch ref (server, client and reload), and Undo/Redo of groups across
two tabs (E2–E6). Each finding reproduced here before anything changed, and
what was done (commit 8):

- **S-1, a hidden part that arrives in a live add was drawn, and clickable,
  in every present tab until a reload.** Reproduced: `applyVisibility` runs
  only at view creation and `setNodeVisible` only on a `som:set`; a pasted,
  duplicated or restored group keeps its hidden parts on purpose (T6), and a
  hidden single object restored by Undo had the same gap before this round.
  **My render test hid it:** it called `applyVisibility` itself ("once
  Atrium's visibility pass runs"), so it passed for a reason the page never
  reaches. Taken: `app.js` has a `som:add` handler that hides a node arriving
  hidden, retrying for at most `VIEW_FRAME_LIMIT` (10) frames while the view
  object isn't built yet, and only while the node is still the one that came.
  Two tests in `subtree-add-wiring`, both failing before: the handler lifted
  as text on a real `AtriumClient` and a headless DocumentView, with no
  visibility pass (the hidden part's object hidden, its siblings drawn); and
  the retry's frames, its limit, and its stop when the node is gone.
- **N-1, the prompt's `--ignore-scripts` leaves `better-sqlite3` unbuilt**,
  so two e2e tests fail on a fresh clone. Taken (operator, 2026-11-07):
  AGENTS.md's gotchas now say to run the package's own install script
  (`pnpm rebuild better-sqlite3` exits 0 and builds nothing: tried on a fresh
  clone; the install script built it and the e2e file passed 7 of 7), with
  §2.2's `assert.equal` gotcha; this round's prompt carries the line for the
  next round to copy.
- **N-2, the e2e's Undo wiring had no re-captures**, so the in-flight case
  never ran end to end. Taken: `wireUndo(client, { recaptures: true })` wires
  `app.js`'s two (on `som:add`, the root's event; on every `som:remove`), and
  a new e2e test removes a part in tab B while tab A's Delete of the group is
  in flight; one Undo brings back the group as the server held it (without
  the part) on the server and in B. Without the re-captures it fails (the
  part comes back). (p8) is now caught at run time too.
- **N-3, the K7/K6 notes name a part by its pasted name** ("“stand copy”"),
  since names are chosen first. Kept: it is the name the part has here, the
  one the person can find. Recorded.
- **The skip** is `apps/client`'s, as it said: §2 corrected.
