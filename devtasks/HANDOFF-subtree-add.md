# Handoff: `subtree-add`, implemented on `claude/subtree-add`

**Contract:** `devtasks/PREBRIEF-subtree-add.md` FINAL Rev 2 (operator, 2026-11-06).
**Base:** `main` at `99ed7a8` (the pre-brief's FINAL commit; code identical to
`70a30bd2`, the SHA §2's facts were verified at). **Implemented by Claude in the
fast lane** (SA-L5 (a)), no OpenRouter. Not yet checked by a fresh agent or
reviewed outside; not published or deployed.

The decisions it implements: SA-L1 (a) one `add` carries the tree; SA-L2 (a)
256 nodes, 8 generations, 1,024 primitives, the socket's 1,048,576 bytes as the
server's byte bound; SA-L3 (b) materials shared within a message (`{ ref: n }`);
SA-L4 (a) Delete asks nothing for a group that can come back; SA-L6 (d) and
SA-L7 (c): selection and parts (T11) are the next round's, §9.

## 1. The five commits
| Commit | What (contract items) |
|---|---|
| 1 `ab5674c` | T1, T8, T12's form: `definitions.node` (recursive `children`, `minItems: 1`) and the `{ ref }` material in `add.client.json` and `add.server.json`; the tree rule in both copies (`add-spec.js`, `send-policy.js`): `subtreeShapeProblem`, `membersInMessageOrder`, `nodeNameFormOk`, `materialRefsProblem`, the seven new reasons; 34 tree vectors |
| 2 `19268b8` | T2, T3, T12's ingest: step 0 (`subtreeCountProblem`, before Ajv), the shape pass, every per-member check in `session.js`; one id set per message (`savedObjectIds`); `treeNameTaken` in both `addNode` copies; `ingestNode` (pre-order list, the ref pre-pass, one buffer, the call's materials) |
| 3 `650c1af` | T7: the client sends `addFields` 3; `ADD_FIELDS_LEVEL` 3 in `isStaleEditor` and the server hello; `client.serverAddFields`; both hello schemas; the moved tests and `c1.py` |
| 4 `96584a2` | T4, T5, T12's builder: `_onAdd` (one `som:add` per member, `som:desync` on a failed ingest), `som:remove`'s `removed`; Duplicate and Undo of trees (`edit-duplicate.js`, `edit-undo.js`); the `som:add`/`som:remove` re-captures and the delete question in `app.js` |
| 5 (this commit) | T6: Copy and Paste of trees (`copy-paste.js`), the Inspect panel's parts line and the paste's level, notes and retry (`app.js`); the two-world end-to-end group test; the full suites; the proofs; this file |

Code files touched are §6's list. Outside it: only `devtasks/` (this file).

## 2. Tests
- **All suites, each server file alone under `timeout 180`:** 65 suites,
  **4,451 passing, 0 failing, 1 named skip** (richer-add's R7 skip, unchanged),
  at commit 5's code before the proofs. The proofs added one test (the run-time
  pad wiring test, §2.2) and changed nine assertions in five test files (§4,
  item 9); each touched file was rerun alone and passes: **4,452**.
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
