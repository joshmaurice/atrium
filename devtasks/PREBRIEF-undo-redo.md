# Pre-brief: Undo and redo (Phase 3 step 2)

Status: **FINAL, Revision 4 (2026-10-18).**
- **Rev 0:** drafted.
- **Rev 1:** applies an outside review of Rev 0 (ChatGPT, 2026-10-18, four
  must-fix and five should-fix findings). Each was checked against
  `42e9f87`, #3 with a new probe; §12 lists them. Changes: new U13–U15;
  W2 (known limitation), W5 (redo cleared), W6 and W7 wording; Y1–Y4
  rewritten in part; new Y7; §7 tests, proofs (k)–(q) and the e2e; §10.
- **Rev 2:** applies the same reviewer's review of Rev 1 (three must-fix,
  three clarifications), each checked against `42e9f87`, #2 with a new
  probe; §12.2 lists them. **New U16, found by that check: a 1b-1 bug
  that exists today** (another session's change can be overwritten on
  screen by a revert); fixed here in Y3. Also new U17; W6 says it supersedes
  design §4.1; Y3, Y4, Y5 and Y7 changed; tests, proofs (r)–(v), e2e.
- **Rev 3:** a targeted amendment for the same reviewer's review of Rev 2
  (two must-fix, one should-fix), checked against `42e9f87`, #1 by probe;
  §12.3. **U16 gains a second, more likely case, also live today:** an
  accepted send after another session's earlier change leaves this tab
  showing the other value, with no refusal involved. Y3's reconcile rule,
  Y2/Y4's blocking during a pending structural request, and Y3's redo
  rule changed; tests, proofs (w)–(y), e2e.
- **Rev 4:** the operator approved decisions W1–W10 (§4) as recommended in
  Rev 3, on 2026-10-18. No other changes.
- **Drafted by Claude from a clone of `main` at `42e9f87`.** Its runtime code
  is identical to the released `68a5b2b4` (DEV, MAIN record and PROD); the
  only later commits are the 1b-2 passdown upload and a README edit
  (`git diff --stat 68a5b2b4 42e9f87`: `README.md` and one file under
  `devtasks/`).
- **Every "today the code does X" claim in §2 was checked against that
  clone.** The ones marked *probe* were also run against the real server
  world, SOM and glTF-Transform with throwaway scripts (not committed).
- **Board and host at drafting** (ops connector, 2026-10-18 ~10:30 PT):
  release `COMPLETE`, nothing ready, running or blocked, DEV and PROD
  healthy, deploy lock free. The only warning is the MAIN record vs
  `origin/main`, which is the docs-only difference above.
- **This round is also S22's acceptance test** (`atrium-ops`
  `PASSDOWN-s22-installed.md`, `ac2d314`): a DEV deploy, a MAIN push and
  approval, a PROD approval and the pipeline's publish, through the new
  release path. See §9.

**Inputs:**
- `docs/DESIGN-phase3-placement-scripting.md` §4.5 (undo and redo), §4.6
  (edit confirmation), §4.9 (object identity), §9 step 2;
- `devtasks/PREBRIEF-edit-mode-ui-1.md` B4 (gestures, records, revert);
- `devtasks/PREBRIEF-edit-mode-ui-1b-2.md` N2–N4 (delete, duplicate,
  structural requests) and its §11 (S1);
- `devtasks/Atrium-Passdown-2026-10-16-edit-mode-ui-1b-2.md` (the newest;
  §4.5 "remove-by-name is the root of S1", §5.1 item 6, §5.2 item 1);
- `devtasks/Atrium-Passdown-2026-10-16-server-cleanup.md` §3 (how the last
  full-pipeline round ran) and §4.1 (claims must quote the code).

**Code facts:**
- **Line numbers:** approximate.
- **Implementation base:** a freshly fetched `origin/main` at the start of
  the round.

## 1. What step 2 is

**Undo and Redo for the owner's own Edit-mode changes,** as design §4.5
describes them:
- **Only confirmed edits enter the stack.** A refused edit is reverted (1b-1
  B4), not recorded.
- **One gesture is one entry:** a handle drag records its start and end, not
  every throttled send; a committed panel field is one entry.
- **Each entry knows its inverse:** a transform's previous value; a rename's
  previous name; an add's or a duplicate's inverse is a delete; a delete's
  inverse is a re-add, **only for a node that can come back exactly** (Y2).
- **Undo sends the inverse through the normal pipeline.** No server history.
- **The stacks are cleared on reconnect and world change.**

Two buttons in the Edit panel, and the usual keys (W9).

**Client only: `apps/client`.** No server, protocol, SOM, `packages/client`
or renderer-three change, so the DEV deploy needs no restart. (W2's
alternative would change that.)

## 2. What the code does today (verified at `42e9f87`)

### U1. What 1b-1's gesture tracker knows (`apps/client/src/edit-gesture.js`)
- `begin(node)` (~L138) reads every transform field into `start` and
  returns a gesture with `update`, `end` and `cancel`. `commit(node, field,
  value)` (~L206) is a one-send gesture for a panel field.
- Confirmation lives in **records, one per node object and field, shared by
  every gesture on that field** (~L84–107): `confirmed`, `pending` seqs, a
  `rejected` flag, an `active` count, `dead`. A record reconciles (reverts if
  anything was rejected) only when nothing is pending and no gesture is
  active, then it's dropped (~L116–124).
- **Nothing reports a gesture's outcome.** `accepted(seq)` returns `{node,
  field, value}` for that one send (~L220); no event says "every send of
  this gesture was accepted". The gesture object knows its `start` and the
  last value it sent per field, but forgets both on `end`.
- **A commit from undo would look like any other commit.** Nothing marks a
  send as an undo's, so it would be recorded as a new edit.
- `read`, `writeLocal` and `writeSend` are injected (`app.js` ~L1585–1600);
  `writeSend` assigns `node[field]`, and the SOM listener sends.

### U2. Answers and broadcasts on the requesting client (`AtriumClient.js`)
- `edit:accepted`, `edit:rejected` and `edit:unknown` carry `seq` plus the
  tracked edit: `{type: 'add'|'remove'|'send', node, field?, value?}`
  (`_trackEdit` ~L847, `_resolveAccepted` ~L854, `_resolveRejected` ~L866,
  `_resolveAllPendingAsUnknown` ~L882).
- **Own `add` and `remove`:** `som:add` (~L933) and `som:remove` (~L964)
  are emitted **before** `edit:accepted` (1b-2 I1). So a re-added node is in
  the SOM when its acceptance arrives.
- **Own `send`:** the echo emits `edit:accepted` and **no `som:set`**, except
  for a rename (`_onSet` ~L983, `_resolveOwnSetEcho` ~L1028; 1b-2 I14).
- **Another session's changes:** `som:set {nodeName, path, value}` (~L1020),
  `som:rename {from, to}` (~L1005), `som:add {nodeName}`, `som:remove
  {nodeName}`. None says which session made it. A second tab of the same
  owner is "another session".
- `edit:unknown` fires for every unanswered request when a connection ends.

### U3. Rename (1b-1 B5)
- The name field's `change` (`app.js` ~L1918–1938) checks `checkNewName`,
  then `pendingRename = { seq: client.renameNode(node.name, value), node }`.
  Nothing changes locally until the server accepts (`renameNode` doc,
  `AtriumClient.js` ~L814–826).
- Accepted / rejected / unknown are handled at ~L1950–1978, outside the
  gesture tracker.

### U4. Structural requests (1b-2 N4, `apps/client/src/edit-structure.js`)
- One pending request at a time, `{kind: 'add'|'duplicate'|'delete', seq,
  name, node, subtree, held, replaced, ...extra}` (~L63). Extra fields are
  kept on the request.
- **The S1 defences:** `removalSeen(node)` holds the "removed" message for
  this tab's own pending delete of that object (by identity); `addSeen(name)`
  notices a newer node with the deleted name; `settle()` turns them into
  `'quiet'`, `'show'` or `'replaced'` (~L72–113).
- `onStructureAnswer` (`app.js` ~L2149–2170) handles all three kinds. **A
  rejected `add` whose message matches `already in use` is retried once with
  the next palette name** (~L2158–2163). It reads `request.primitive`; any
  other add with that refusal falls through to `Couldn't add: …`.
- The Delete click (~L2119–2145): `window.confirm` with `This can't be
  undone.`, a 50 ms pause, an identity re-check, `client.removeNode(name)`.

### U5. A deleted root node comes back exactly (*probe*)
A palette cube with node `extras` (`__atrium_visible: false` and another
key) and a rotation, in a real document world (`createWorldFromDocument` of
`DEFAULT_HOME_DOCUMENT`), with a sphere added after it:
- `prepareDuplicate(gltfNode, { name: 'Cube' })` (N3) → `ok`, 948 bytes;
- `world.removeNode('Cube')` → ok; `checkNewName('Cube')` → free;
- `world.addNode(descriptor)` → ok. Translation, rotation and `extras`
  equal the original's. After `serializeSomDocument` and a reload,
  translation and `extras` are equal and `POSITION` is equal element by
  element;
- **the re-added node is a new `SOMNode`** (`getNodeByName('Cube') ===
  before` is false);
- **it moves to the end of the scene's children** (`Ground,Cube,Sphere` →
  `Ground,Sphere,Cube`). Nothing in Atrium depends on root order today
  (names are unique; L6's first-registered rule only matters for duplicate
  names, which `checkNewName` refuses).
- The probe subtracted `DUPLICATE_OFFSET_X` from N3's copy. **The real
  builder must not:** `x + 1.5 − 1.5` isn't always `x` in floating point.
  It must build with no offset (Y2).

### U6. What can't come back
A re-add is an `add`, so it carries exactly what N3's duplicate carries
(1b-2 I2, I15, N3 rules 1–9). It can't restore:
- **a node with children** (`add` carries one node; design §3.2);
- **a nested node** (`client.addNode` takes no `parent`; 1b-2 I1, J3);
- a camera, light or skin, an animated node, textures, UVs, non-default
  material state, names or `extras` on mesh parts, extensions;
- anything whose `add` would exceed 1 000 000 bytes (N3 rule 9).
The delete dialog says `This can't be undone.` on every delete today (U4).

### U7. Identity: node objects die on remove
- `node.dispose()` (`_onRemove` ~L960) ends the `SOMNode`; nothing points it
  at a later node with the same name. The tracker's records and the
  structure tracker are keyed by object (U1, U4).
- **So an entry holding a node object can't reach the node a later undo
  re-adds** (U5). Every entry recorded before the delete would point at a
  dead object. This is the identity problem the 1b-2 passdown §4.5 foresaw.

### U8. Remove by name (1b-2 S1)
`remove` and `send` name their target. 1b-2 closed the practical window for
a delete with the post-dialog pause and identity re-check, and it reports
the rare `replaced` case. **An undo that removes or edits a node has the same
exposure**, without a dialog's pause: the identity check runs immediately
before the send, and the server resolves the name when it arrives.

### U9. Keys today
- Two document `keydown` listeners (`app.js` ~L1268, ~L2329). The second
  returns unless `e.target === canvas` (the canvas has `tabindex="0"`,
  `Stage.js` ~L71) and handles M, V, Space and the navigation keys; nothing
  handles Ctrl or Cmd. The first handles Escape (teleporter modes, then
  Edit: deselect, then leave), skipping text fields.
- After a click on a panel button, focus is on the button, not the canvas.
- Panel fields commit on Enter or blur; Escape restores the field and stops
  propagation (`onEditFieldKey` ~L1881).
- **Browser undo in a text field** (Ctrl+Z while typing a name) is the
  browser's; it must keep working.

### U10. When the edit session ends
`endEditSession()` (~L1653) calls `setEditMode(false)`, `editTracker.reset()`,
`structure.reset()` and clears `pendingRename`. It runs on a world load
(~L635), `connecting` (~L710) and `disconnected` (~L726). Turning Edit mode
off alone (`setEditMode(false)` ~L1636) deselects and resets `structure`,
but not the tracker.

### U11. Legacy transforms
`sanitizeTransform` (`edit-gesture.js` ~L46) normalizes a rotation that is
not unit to within 1e-9 and clamps scale to ≥ 0.01. A node loaded with a
legacy rotation (L7 doesn't rewrite saved values) is sent normalized on the
first drag. An undo restoring that start value would send it normalized
again (or nothing, if the node already holds the normalized value); the
server's K6 check refuses the exact legacy value anyway.

### U13. A partly accepted drag keeps its accepted part (*probe*, Rev 1, review #3)
`createEditTracker` with a 100 ms throttle: a drag sends X=1, then X=2; the
server accepts the first and refuses the second. After reconcile the node
holds **X=1**, the record's `confirmed` (highest accepted seq, U1), not the
gesture's start. So a refused send doesn't mean "nothing changed": a real,
saved change remains.

### U14. Delete and Duplicate don't wait for transform sends (Rev 1, review #4)
`structuralBlockReason` (`edit-structure.js` ~L15, called at `app.js`
~L2034) blocks on a pending structural request, an active drag and a pending
rename, **not on unanswered tracker sends**. A drag ended a moment ago, or a
panel field just committed, may still be unanswered when Delete is clicked,
so the node's values at that moment can be optimistic.

### U15. An accepted rename may not apply locally (Rev 1, review #6)
`_resolveOwnSetEcho` (`AtriumClient.js` ~L1028–1051) applies an accepted
rename through `som.renameNode(old, new, target)`, which refuses if this
client's namespace has diverged (L6/R3). It emits `som:rename` only if the
rename applied, but **emits `edit:accepted` either way.** So "accepted"
doesn't prove the local node now has the new name.

### U16. A revert can overwrite another session's change (*probe*, Rev 2, review 2 #2; a 1b-1 bug today)
- The tracker never hears about other sessions' changes: `som:set` is
  handled in `app.js` (~L775 rebuilds pads and refreshes the panel; ~L2207
  refreshes the buttons), and neither tells `editTracker`.
- **Probe:** a drag sends X=1, then X=2; X=1 is accepted; another session's
  X=4 arrives and is applied to the node (as `_onSet` does); then X=2 is
  refused. Reconcile sees a rejection and a node value (4) different from
  `confirmed` (1), so it **writes X=1 locally**. The server holds 4; this
  tab shows 1, with nothing sent, until the next change to that field.
- **(Rev 3, review 3 #1) A second case, with no refusal (*probe*):** this
  tab commits X=5; another session's X=4, which the server applied first,
  arrives and is applied to the node; then X=5 is accepted, so the server
  holds 5. `_resolveOwnSetEcho` doesn't re-apply an accepted value (U2), and
  reconcile writes only after a refusal (U1), so **this tab shows 4.** Two
  owner tabs editing the same field at nearly the same moment are enough.
- **Ordering makes the fix simple:** one socket carries this tab's answers
  and other sessions' broadcasts in the order the server applied them. So
  the server's current value is whichever arrived last: this tab's latest
  accepted send or another session's `som:set`. (Own answers arrive in seq
  order, so 1b-1's "highest accepted seq" is the same rule for its own
  sends.)

### U17. Ordinary edits aren't blocked by unanswered sends (Rev 2, review 2 #3)
`syncGizmoEnabled` (`app.js` ~L1667) and the panel fields (~L1868) are
disabled only while a rename of the selection is unanswered. A drag or a
panel commit can start while an earlier send on the same field is pending;
that's by design in 1b-1 (B4's shared records), but it means an undo's
send could share a record with a new gesture.

### U12. Test baseline at `42e9f87`
Node 22.22.0, clean `pnpm install --frozen-lockfile`:

| Suite | Command | Count |
|---|---|---|
| `apps/client` | `cd apps/client && node --test tests/*.test.js` | **388** |
| `packages/client` | `cd packages/client && node --test --test-force-exit tests/*.test.js` | 169 |
| renderer-three | `cd packages/renderer-three && node --test tests/*.test.js` | 86 |
| interaction | `cd packages/interaction && node --test tests/*.test.js` | 9 |
| som | `cd packages/som && node --test test/*.test.js` | 224 |
| protocol | `cd packages/protocol && node --test test/*.test.js` | 71 |

All `fail 0`, `skipped 0`; they match the 1b-2 passdown. Server: 492 over 32
files per the 10-16 passdown (not rerun; this round doesn't touch it).

`apps/client` tests can't import three.js or touch the DOM (1b-1 G12):
logic goes in pure modules, `app.js` wires them.

## 3. Decisions already made
- **Design §4.5:** confirmed edits only; one gesture, one entry; inverse per
  entry; no undo of a delete of a node with children; cleared on reconnect
  or world change; no server history.
- **Design §4.9:** `objectId` is the long-term identity, implemented in step
  4 (see W2).
- **From 1b-2, unchanged:** one structural request at a time (N4); D2
  (delete removes the subtree); J5 names; J6 select after an add; J7 (the
  teleporter delete mode stays); E7.

## 4. Decisions (operator, 2026-10-18)

All ten were approved as recommended (Rev 3 wording).

- **W1 — Lane. Recommended: the full pipeline.** It's the only lane that
  runs the pipeline's publish (`atrium-deploy-gate publish` →
  `atrium-publish-workflow`), which S22 replaced and which hasn't run since
  Q0 disabled it after the server-cleanup round's publish. So this round is
  S22's acceptance test, and that acceptance unblocks connector Pass B. The prototype lane (1b-1, 1b-2)
  would be faster for a client-only round, but S22 would then wait for the
  next pipeline round, against the PAT's 10-29 expiry.

- **W2 — Identity. Recommended: client-side handles.** Every entry points at
  a small handle object, `{ node }`, one per node object (kept in a
  `WeakMap` from node to handle). When an undo or redo re-adds a node and
  the server accepts, the handle is pointed at the new `SOMNode` and the new
  node maps to the same handle, so every older entry for that node follows
  it, and newer entries share it (U7). An entry's node is usable only
  while it's alive by identity (`client.som.getNodeByName(node.name) ===
  node`), as 1b-2's delete already checks. Client only.
  - **The alternative** is `extras.atrium.objectId` now (design §4.9):
    entries resolve an id to the current node at undo time. It is the real
    fix for S1 (U8), but it needs the server's uniqueness check and a policy
    for nodes without an id, so it brings a server change and restart into
    this round, and design §9 puts it in step 4. Handles leave nothing to
    undo later: step 4 can switch them to ids.
  - **Known limitation, kept (Rev 1, review #9):** the identity check runs
    before the send. If another session removes the object and makes a new
    one with the same name **after** that check but before the server
    handles this tab's request, the request hits the new object. 1b-2's
    `replaced` message reports it afterwards (U4); nothing prevents it. Only
    `objectId` closes this. The handoff and the UI must not claim more.

- **W3 — What's undoable. Recommended:** everything the Edit panel does,
  and nothing else:
  - a handle drag (one entry, all fields it changed);
  - a committed position, rotation or scale field;
  - a rename;
  - a palette add and a duplicate (inverse: delete);
  - a delete of a node that can come back exactly (Y2; inverse: re-add).
  Not undoable: a delete that can't come back (U6); the teleporter place and
  delete modes and the destination form (outside Edit mode); anything
  another session did.

- **W4 — An entry whose object changed elsewhere. Recommended: refuse it
  and drop it,** with a message, and leave the rest of the stack alone. At
  undo (or redo) time each entry checks that the world is still the way the
  entry left it (Y4): the node is alive by identity, each field still holds
  the value the entry set, a rename's name is still the new one, a re-add's
  name is still free, and **a node about to be removed is exactly as this
  tab left it** (Y1, Rev 1). If not: `Can't undo: “Cube” was changed elsewhere.`
  (or `… was removed`, or `… the name is in use`), the entry is discarded,
  and the next Undo goes on to the one below it.
  - **Alternatives:** apply it anyway (silently overwrites another tab's
    edit); or clear both stacks on any change from another session (simple,
    but a visitor walking past can't change anything, so in practice only a
    second owner tab would ever trigger it, and it would throw away all
    history for an unrelated change).

- **W5 — A delete that can't be undone. Recommended: it isn't recorded;
  the undo stack is kept and the redo stack is cleared** (Rev 1, review #7).
  Entries for nodes it removed fail W4's check when they're reached. Redo is
  the branch an undo abandoned, and any new change of this tab's starts
  another (Y1). The alternative, clearing both stacks, is simpler to explain
  but loses unrelated history.

- **W6 — The delete dialog. Recommended: no dialog for a delete that can be
  undone** (Y2 decides at click time, from confirmed values only). **(Rev 2,
  review 2 #6) This supersedes design §4.1's "deleting a node the world came
  with asks for confirmation"** for nodes that can be restored: Undo covers
  them, and the client can't tell "came with the world" from "added in an
  earlier session" anyway (both arrive in the `som-dump`). `Ground` and
  other mesh-less nodes can't be selected (1b-2 I9). The alternative keeps a
  dialog for every node that was in the world when it loaded. The dialog stays, with `This can't be undone.`, for one that
  can't (U6), and keeps the "and N objects inside it" wording. Undo is the
  safety net editors use for an ordinary delete. The alternative keeps a
  dialog for every delete, with `You can undo this.` when that's true.

- **W7 — When the stacks are cleared. Recommended:** on everything that ends
  the edit session (U10: world load, `connecting`, `disconnected`, so also
  sign-out and reconnect), **but not when Edit mode is turned off.** An owner
  who leaves Edit mode to walk around and look can come back and undo; W4's
  checks cover anything that changed meanwhile. Undo isn't available while
  Edit mode is off. **A change still unanswered when Edit mode goes off is
  recorded when its answer arrives** (Y7, Rev 1, review #1). The
  alternative clears them on Edit off too.

- **W8 — Bounds. Recommended: 100 entries per stack, and at most 16 MiB of
  stored descriptors** (Y1; UTF-8 bytes of their `add` messages, U6's
  limit) across both stacks. The oldest entries go first. A delete entry
  carries a descriptor of up to 1 MB, so the byte bound matters more than the
  count.

- **W9 — Keys. Recommended:** Ctrl+Z (Cmd+Z on macOS) undo; Ctrl+Shift+Z
  (Cmd+Shift+Z) and Ctrl+Y redo. Only while Edit mode is on, and never when
  focus is in a text input, textarea or select (that's the browser's own
  undo, U9). Handled keys `preventDefault`. **Delete and Duplicate keys stay
  a follow-up** (1b-2 passdown §5.1 item 6): they bring focus rules of their
  own, and this round already carries S22's acceptance.

- **W10 — Selection after undo and redo. Recommended: select what changed.**
  After an accepted undo or redo, the node it changed or re-added is
  selected, so the handles show the result. An undone add or a redone delete
  clears the selection if that node was selected, with no "removed" message
  (it's this tab's own request, U4). The alternative leaves the selection
  alone.

## 5. The step 2 contract

### Y1. Entries (pure module, e.g. `apps/client/src/edit-undo.js`)
An entry has a `kind`, a `label` and the data its inverse needs:

| Kind | Recorded when | Data | Undo | Redo |
|---|---|---|---|---|
| `transform` | a settle batch reports it (Y3) | handle; per changed field `{field, from, to}` | send each `from` | send each `to` |
| `rename` | the rename is accepted **and applied locally** (Y4) | handle; `from`, `to` | rename `to` → `from` | rename `from` → `to` |
| `add` | an add or a duplicate is accepted | handle; `descriptor`: `prepareRestore` of the node as accepted (Y2) | delete, if the node still matches `descriptor` | re-add `descriptor` |
| `delete` | a delete Y2 could capture is accepted | handle; `descriptor`: the last capture before the removal (Y2) | re-add `descriptor` | delete, if the node still matches `descriptor` |

- **Labels** for the buttons' tooltips: `Move`, `Rotate`, `Scale`,
  `Transform` (more than one field), `Rename`, `Add`, `Duplicate`,
  `Delete`, each with the node's name at recording time: `Undo Move
  “Cube”`.
- **Two stacks.** A newly recorded entry goes on the undo stack and clears
  the redo stack. An accepted undo moves its entry to the redo stack; an
  accepted redo moves it back. A refused or dropped entry leaves both
  (W4).
- **(Rev 1, review #7) Any confirmed change of this tab's that isn't
  recorded** (a delete that can't be undone, W5; a rename that didn't apply
  locally, Y4) **also clears the redo stack.** Another session's changes
  don't touch either stack; W4's checks handle them.
- **(Rev 1, review #2) Every step that removes a node checks it against the
  entry's `descriptor` first** (Y4): a fresh `prepareRestore` of the node
  must equal it exactly (every number, every key). This is W4 for structural
  entries: without it, undoing an add would delete an object another tab has
  since moved. Own later edits on that node are entries above this one, so
  they've been undone by the time this entry is reached; if one of them was
  dropped instead, the node differs and the removal is refused, which errs
  on the side of keeping the object.
- **Bounds:** W8, enforced on every push; the oldest entries go first.
  Every `descriptor` counts toward the byte bound.
- **Cleared:** W7.
- **The palette's one retry** (U4) records the final name.

### Y2. Restorable nodes (`apps/client/src/edit-duplicate.js`)
- A new export, e.g. `prepareRestore(gltfNode)`: **N3's rules 1–9
  unchanged**, and a descriptor built by the same code as a copy but with
  **the node's own name and its translation unchanged** (no offset applied
  and subtracted, U5). `prepareDuplicate` keeps its behaviour. Its output
  is the canonical form Y1 compares: the same node gives the same
  descriptor, key order included.
- **An `add` entry's `descriptor`** is captured when the add or duplicate is
  accepted: the node is in the SOM by then (U2). A node that isn't
  restorable then (it can't be for the palette or a duplicate, both of
  which are N3-eligible by construction) isn't recorded, and the redo stack
  is cleared (Y1).
- **A delete (Rev 1, review #4):**
  - **Delete and Duplicate wait for unanswered transform sends:**
    `structuralBlockReason` gains a `sending` input
    (`editTracker.pendingCount > 0`, U14), with the reason `Waiting for the
    server…`. So a delete is never captured from optimistic values;
  - **captured at click time, before the delete is sent,** from current
    values (1b-2 I14): `ok` → the delete can be undone (no dialog, W6); not
    `ok` → the dialog, and the delete isn't recorded (W5);
  - **nothing of this tab's can change the node while the delete is
    pending** (Y4's block, Rev 3), so every re-capture reads server values;
  - **captured again while it's pending:** on every `som:set`, `som:rename`
    and `som:add` from another session before the delete's own `som:remove`,
    the capture is redone from current values (a shared material can change
    through another node, so any `som:set` counts). The server broadcasts in
    the order it applies changes, and the delete's `som:remove` comes after
    everything it applied first (U2), so the last capture is the node's last
    server state. If a re-capture fails (a child was added, say), the delete
    goes ahead but isn't recorded: the panel says `This delete can't be
    undone: the object changed while it was being deleted.` and the redo
    stack is cleared.
- **Undo of an `add`, and redo of a `delete`,** capture again at that moment
  and compare with the entry's `descriptor` (Y1, Y4).

### Y3. Recording transforms (`edit-gesture.js`)
- **(Rev 1, reviews #3 and #5) Outcomes are decided per settle batch, not
  per gesture.** Records are shared by every gesture on a node and field
  (U1). A gesture is settled only when every record it touched has
  reconciled (nothing pending, no gesture active). Gestures that share a
  record, directly or through another gesture, settle together as one
  batch, after reconcile has written any revert.
- **The tracker reports each batch** to a new injected callback, e.g.
  `onTransformsSettled(results)`:
  - **every send in the batch accepted:** one result per gesture, **in the
    order the gestures began**, each `{ node, changes: [{field, from, to}] }`
    with `from` the gesture's start and `to` its last sent value, for each
    field where they differ. Each becomes an entry, in that order, so Undo
    reverses the newest first;
  - **any send refused** (a partly accepted drag included, U13): one result
    **per node** in the batch, with `from` the value each record held when
    it was created and `to` the record's final `confirmed` value (what
    reconcile left on the node). A record is only created when no earlier
    record on that field is open, so its starting value is the server's.
    Fields where `from` equals `to` are left out; a node with none left gives
    nothing. So **every change the server accepted is recorded,** merged
    into one entry where a refusal makes per-gesture values unreliable;
  - **any send unknown:** nothing; the session is ending (W7).
- **(Rev 2, review 2 #2, U16) Other sessions' changes reach the tracker.**
  A new `remoteSet(node, field, value)`, called from the `som:set` handler
  for a transform field: if a record is open for that node and field, its
  `confirmed` becomes `value` and the record is marked `remote`. Rule: a
  record's `confirmed` is the value of whichever arrived last, this tab's
  accepted send or another session's set (U16's ordering). So a revert
  puts back the server's value, never an older one. A refusal arriving
  after a remote set therefore writes nothing if the node already holds it.
- **(Rev 3, review 3 #1) When a record reconciles, the node is made to hold
  `confirmed` whenever it differs, refused send or not:** written locally
  (`writeLocal`, nothing sent), with `onReverted` so the panel and pads
  refresh. Without a remote set and without a refusal the node already
  holds `confirmed` (the last accepted send is the last local write), so
  this changes nothing in 1b-1's ordinary path; it fixes U16's second case.
  It applies equally to an undo's `{ record: false }` sends.
- **A batch with any record marked `remote` reports no entry** (only
  whether one of this tab's sends in it was accepted, for the redo rule
  below): another
  session changed those fields while this tab's sends were in flight, so
  neither per-gesture nor per-record `from`/`to` describes this tab's change.
  **(Rev 3, review 3 #3) It clears the redo stack only if at least one of
  this tab's sends in it was accepted** (a confirmed change of this tab's
  went unrecorded, Y1). If all of them were refused, this tab changed
  nothing and both stacks stay; W4's checks decide what's still usable.
- A batch on a removed node (dead records) reports nothing.
- **(Rev 2, review 2 #4) "Did anything change" is judged on the confirmed
  result,** never on the last attempted value. With every send accepted
  the two are the same, so a gesture dragged back to its start contributes
  nothing. With a refusal, the merged result compares each record's start
  with its final `confirmed`: X=0 → X=1 (accepted) → X=0 (refused) records
  0 → 1.
- `commit()` takes an option that marks the send as an undo's or a redo's
  (e.g. `{ record: false }`): it's never part of a reported batch, and its
  answer goes to the caller (by seq). Confirmation and revert work exactly as
  for any commit (1b-1 B4): a refused undo is reverted locally.
- **`commit()` returning `null`** (the sanitized value equals what the node
  holds, U11) means nothing was sent and nothing is pending.
- Nothing else in B4 changes. The existing 1b-1 tests keep passing
  unchanged.

### Y4. Undo and redo
- **Available** when the stack isn't empty, Edit mode is on, and nothing is
  in flight: no structural request pending (N4), no drag active, no rename
  unanswered, no tracker send unanswered (`editTracker.pendingCount`), no
  undo or redo unanswered. The buttons show the reason as a tooltip (as
  Delete does), and the click and the keys check again (a field committed
  by the blur that the click itself caused leaves a send pending, U9).
- **One undo or redo at a time.** An entry is in flight until every request
  it sent is answered.
- **(Rev 2, review 2 #3, U17) While an undo or redo is in flight, every
  other Edit-mode change is blocked,** in its dispatch path and not only its
  button state: handle drags (`syncGizmoEnabled` also requires no undo in
  flight, and `onHandleDragging` begins no gesture), panel commits
  (`commitVectorField` returns and restores the field), rename (the field's
  `change` handler returns and restores it), the palette, Duplicate and
  Delete (`structuralBlockReason` gains `undoing`, reason `Undoing…`). It
  lasts one round trip. So an undo's `{ record: false }` send never shares a
  record with a gesture.
- **(Rev 3, review 3 #2) The same block applies while any structural
  request is pending** (an add, duplicate or delete, a click's or an
  undo's): handle drags, panel commits and rename are refused in their
  dispatch paths, as above, with the reason `Waiting for the server…`. So
  nothing of this tab's can change a node between a delete's capture and
  its removal, and Y2's re-captures only ever see the server's values. One
  shared guard, e.g. `editBlocked()` = an undo or redo in flight, or a
  structural request pending, serves both.
- **Before sending,** the entry checks (W4):
  - **transform:** the handle's node is alive by identity and addressable
    (`getObjectByName(name) === node`, L6), and every field's current value
    equals the entry's `to` (undo) or `from` (redo), element by element;
  - **rename:** alive and addressable, current name equals `to` (undo) or
    `from` (redo), and the target name passes `checkNewName`;
  - **remove a node** (undo of `add`, redo of `delete`): alive, addressable,
    no children, restorable, and **`prepareRestore` equals the entry's
    `descriptor`** (Y1; Rev 1, review #2);
  - **re-add** (undo of `delete`, redo of `add`): the name passes
    `checkNewName`.
  A failed check sends nothing, shows the message, and drops the entry.
- **Sending:**
  - transform: one `editTracker.commit(node, field, value, { record:
    false })` per field. **(Rev 1, review #8)** A field whose commit returns
    `null` sent nothing and counts as done. If no field sent anything (the
    U11 case: the target normalizes to what the node already holds), the
    entry moves to the other stack at once, with no request;
  - rename: `client.renameNode(currentName, target)`, through the same
    `pendingRename` path as the name field, so the panel behaves as for a
    typed rename; `pendingRename` carries the undo or redo marker, so its
    acceptance isn't recorded as a new entry;
  - remove: through the structure tracker as a `delete` request (with
    `subtree` and `name`, so the S1 hold and `replaced` logic apply, U4),
    marked as an undo's or redo's;
  - re-add: through the structure tracker as an `add` request, marked the
    same way.
- **Answers:**
  - **all accepted:** the entry moves to the other stack, **storing the
    values the node now holds** (a legacy rotation is sent normalized, U11,
    so the mirror check must compare against what the node holds). After a
    re-add, the handle points at the new node (`getNodeByName(name)`; it's
    in the SOM before `edit:accepted`, U2). Selection per W10;
  - **(Rev 1, review #6) a rename's acceptance, typed or from an undo or
    redo, counts only if it applied locally:** the handle's node is alive
    and its name is now the target (U15). Otherwise nothing is recorded or
    moved, **both stacks are cleared** (this window no longer matches the
    server), and the panel says `Undo history was cleared: this window is out
    of step with the server. Reload to resync.`;
  - **any refused:** `Couldn't undo: <server message>` (or redo); the entry
    is dropped. The tracker reverts refused transform fields (B4). A
    multi-field entry with some fields accepted is still dropped: the node
    is now in neither state, and the panel shows what it holds. **(Rev 2,
    review 2 #5) Then the message says so:** `Undo was only partly applied:
    position changed, rotation was refused (<server message>).` (field
    names as the panel shows them), and, since a confirmed change of this
    tab's wasn't recorded, the redo stack is cleared (Y1);
  - **an S1 `replaced` or held `show` on an undo's remove:** the 1b-2
    messages, and the entry is dropped (W2's known limitation);
  - **unknown:** the session is ending; the stacks are cleared with it (W7).
- **`onStructureAnswer` handles undo and redo answers before anything
  else.** In particular the palette retry (U4) must never run for them.
- **Teleporters:** pads rebuild as today (moves through the tracker's
  accepted path; re-adds and deletes through `som:add` and `som:remove`).
- **The view's camera** (1b-2 J8) is reset by the existing `som:remove`
  handler; a camera host is never restorable (N3 rule 3).

### Y5. UI
- **Undo and Redo buttons** in the Edit panel, beside Duplicate and Delete,
  with the Y1 labels as tooltips (`Undo Move “Cube”`, `Nothing to undo`, or
  the Y4 reason).
- **Messages** go in the panel's existing error line (`ep-error`).
- **Keys** per W9, in their own document `keydown` listener that does
  nothing unless Edit mode is on and the target isn't a text field.
- **The Delete dialog** per W6.
- Visitors (`canEdit` false) see none of it.

### Y6. What does not change
- Server, protocol, SOM, `packages/client`, renderer-three.
- 1b-1's gestures, revert, selection rules, rename; 1b-2's palette,
  duplicate, delete-with-children dialog and J8.
- The teleporter modes and form.
- **E7:** a node whose name another node shares still can't be selected.

### Y7. Recording doesn't depend on Edit mode (Rev 1, review #1; Rev 2, review 2 #1)
- `setEditMode(false)` resets the structure tracker (U4, U10), so an add,
  duplicate or delete answered after Edit mode goes off would never reach a
  recorder that lives in `onStructureAnswer`.
- **(Rev 2) Edit off no longer resets the structure tracker.** It also
  holds 1b-2's one-at-a-time rule and the S1 evidence (`subtree`, `held`,
  `replaced`), and resetting it let Edit off-and-on start a second
  structural request while the first was pending, and lost the S1 state for
  a delete answered while Edit was off. `structure.reset()` now runs only in
  `endEditSession()` (world load, `connecting`, `disconnected`). After Edit
  on, the palette, Duplicate and Delete stay blocked until the pending
  request is answered (`Waiting for the server…`). This changes 1b-2 N4's
  "Edit mode can be turned off with a structural request pending; its
  answer is then ignored": the answer is now handled as usual, except that
  with Edit off nothing is selected and no panel message is shown
  (`onStructureAnswer` already checks `modes.edit` for those, `app.js`
  ~L2158–2167).
- **So the undo module keeps its own map of recordable requests,** keyed by
  seq: registered when the request is sent (add, duplicate, delete, rename,
  and every undo or redo request), with what it needs to record (Y1, Y2),
  and settled from `edit:accepted`, `edit:rejected` and `edit:unknown`
  **whatever the Edit mode.** Turning Edit mode off doesn't touch it; only
  the session end does (W7), and by then every open request is `unknown`.
- The gesture tracker isn't reset on Edit off (U10), so a drag that Edit
  off ends (`selectForEdit(null)` sends its final value) is recorded too.
- With Edit mode off when an answer arrives, nothing is selected (W10 and
  1b-2 J6 apply only in Edit mode) and no panel message is shown; Y2's
  delete re-captures still run (they're part of recording).

## 6. Out of scope
- `objectId` (W2's alternative; step 4).
- Undo of a delete of a node with children, or of a nested node (needs a
  subtree `add`, design §7 item 7).
- Undo across a reconnect or reload; a world-level history (design §4.5).
- Undo of the teleporter modes or form, or of another session's edits.
- Delete and Duplicate keys (W9).
- The other 1b-2 follow-ups (passdown §5.1): planes from below, nested
  duplicate, retiring the pad delete mode, public SOM geometry getters.
- `Cache-Control` on `/apps` and `/packages` (DEV acceptance still needs the
  hard reload and marker check, §8).

## 7. Tests

**Pure modules, real logic, no mocks of the module under test.** `app.js`
wiring is DOM code and is accepted on DEV (§8) and in the headless run
(§7.4).

### 7.1 New
- **`edit-undo`:**
  - a recorded entry clears the redo stack; undo → redo stack; redo → back;
  - **handles (W2):** record a transform on node A, a delete of A, undo the
    delete (re-add as a new object A′, the handle re-pointed), then undo the
    transform → it targets A′ and its check passes;
  - **W4 checks**, one test each: a field changed elsewhere; the node
    removed elsewhere; a node no longer addressable (a stand-in for L6);
    a rename's name changed elsewhere; a rename target taken; a re-add's
    name taken. Each sends nothing, gives its message and drops only that
    entry; the next undo reaches the entry below;
  - redo's checks are the mirror (`from` instead of `to`);
  - **in flight:** a second undo is refused while one is pending; a refused
    undo drops the entry and leaves the redo stack as it was; a multi-field
    entry with one field refused is dropped;
  - **availability** (Y4): each block reason, in turn;
  - **bounds (W8):** the 101st entry drops the oldest; descriptors totalling
    more than 16 MiB drop the oldest delete entries first by age, and the
    byte count is UTF-8;
  - **clear (W7):** the session-end hook empties both stacks; turning Edit
    mode off doesn't;
  - labels: each kind, and `Transform` for two fields;
  - **(Rev 1, review #1) Edit off with a request pending:** an add, a
    duplicate and a delete each registered, Edit mode turned off, then
    accepted → each is recorded; Edit back on → Undo reverses it;
  - **(Rev 1, review #2) structural changed-elsewhere:** an add, then
    another session moves the node → Undo of the add refuses and sends no
    remove; undo a delete, another session moves the re-added node → Redo of
    the delete refuses and sends no remove. In both, the node's
    `prepareRestore` differs from the entry's `descriptor` in one number only;
  - **(Rev 1, review #4) delete capture:** a `som:set` from another session
    between capture and the delete's `som:remove` → the recorded
    `descriptor` has the new value; a `som:add` of a child in that window →
    not recorded, the message, redo cleared;
  - **(Rev 1, review #6) rename postcondition:** an accepted rename whose
    node doesn't carry the new name afterwards → nothing recorded, both
    stacks cleared, the message;
  - **(Rev 1, review #7)** an unrecorded confirmed change (a delete that
    can't be undone) clears the redo stack and keeps the undo stack;
  - **(Rev 1, review #8) zero-send undo:** a transform entry whose `from`
    normalizes to what the node holds (a legacy rotation) → no request, the
    entry moves to the redo stack;
  - **(Rev 1, review #9)** an undo's remove that settles as `replaced` drops
    the entry with 1b-2's message;
  - **(Rev 2, review 2 #3)** with an undo in flight, a panel commit, a drag
    start, a rename, a palette add, a duplicate and a delete each send
    nothing (the dispatch paths, as pure guards: `undoing` in
    `structuralBlockReason` and a shared `editBlocked()` the wiring calls);
  - **(Rev 2, review 2 #5)** a two-field undo with one field refused: the
    partly-applied message names both fields, the entry is dropped, the
    redo stack is cleared;
  - **(Rev 3, review 3 #2)** with a delete pending, a drag start, a panel
    commit and a rename each send nothing; an unrelated remote `som:add`
    re-captures the deleted node's descriptor with its server values; Undo
    of that delete restores exactly that descriptor.
- **`edit-gesture` (Y3):**
  - a drag whose sends are all accepted is reported once, after the last
    answer, with `from` = start and `to` = last sent value, only for changed
    fields;
  - **(Rev 1, review #3) partial, one field** (U13's probe): X=1 accepted,
    X=2 refused → one result, `from` 0, `to` 1, and the node holds 1;
  - **(Rev 1, review #3) partial, two fields:** a drag changing translation
    and rotation with one rotation send, which is refused, and every
    translation send accepted → one result: translation from its start to
    its last sent value; rotation left out (reconcile put it back to its
    start);
  - **overlap, with a refusal:** gesture 1 on X (pending), gesture 2 on X
    (accepted), then gesture 1's send refused → **one merged result**, from
    the record's starting value to its final `confirmed`, and nothing is
    reported before gesture 1's answer;
  - **(Rev 1, review #5) overlap, both accepted:** two results, in begin
    order; recorded as two entries, Undo reverses gesture 2 first;
  - **(Rev 1, review #5)** gesture 2's own sends all answered while gesture
    1's are still pending → nothing reported yet;
  - **(Rev 2, review 2 #2, U16's probe)** X=1 accepted, another session's
    X=4 through `remoteSet`, X=2 refused → the node stays at 4 (nothing
    written), and nothing is reported;
  - **(Rev 2)** `remoteSet` for a node and field with no open record changes
    nothing in the tracker;
  - **(Rev 2)** a remote X=4 arrives, then this tab's X=5 is accepted, then
    a later X=6 refused → reverts to 5 (the last to arrive);
  - **(Rev 2, review 2 #4)** X=0 → X=1 (accepted) → X=0 (refused) → one
    result, 0 → 1;
  - **(Rev 3, review 3 #1, the probe)** commit X=5; `remoteSet` X=4 (the
    node set to 4); X=5 accepted → the node holds 5, `onReverted` was
    called, nothing is reported; the same with a `{ record: false }` commit
    → the node holds 5;
  - **(Rev 3)** an ordinary drag with every send accepted and no remote set
    → reconcile writes nothing (`writeLocal` not called after the drag);
  - **(Rev 3, review 3 #3)** a batch with a remote set and every own send
    refused → nothing reported, and the batch is reported as having no
    accepted own send (so the undo module keeps the redo stack); with one
    own send accepted → reported as such (the redo stack is cleared);
  - a drag put back to its start reports nothing; a drag cancelled by a
    remove reports nothing;
  - `commit(..., { record: false })` is never reported as a gesture, and is
    still reverted when refused;
  - the existing 1b-1 tests unchanged.
- **`edit-duplicate` (Y2):**
  - `prepareRestore` of a palette cube: the descriptor equals
    `prepareDuplicate`'s except name (the original's) and translation (the
    original's, **bit for bit**, including an X such as `0.1` where
    `0.1 + 1.5 − 1.5 !== 0.1`);
  - each of rules 1–9 refuses it, as for a duplicate;
  - **(Rev 1)** two calls on an unchanged node give descriptors that are
    equal by the comparison Y1 uses; a change to any one number makes them
    differ;
  - `prepareDuplicate`'s existing tests unchanged.
- **`structuralBlockReason` (Rev 1, review #4, U14):** `sending` blocks
  Delete and Duplicate with `Waiting for the server…`; **(Rev 2)**
  `undoing` blocks them with `Undoing…`.
- **`edit-structure` (Rev 2, review 2 #1):** a pending delete survives an
  Edit-off-and-on cycle (the app no longer calls `reset` there; a test of
  the tracker's own API: no `reset`, a second `begin` refused, `held` and
  `replaced` kept through to `settle`).
- **`edit-structure`:** requests carry the undo/redo marker through
  `settle()`; the S1 hold works for a marked delete as for a click.
- **`import-guard.test.js`** picks up any new import.

### 7.2 Expected counts
- `apps/client`: **388 + the new tests.**
- Every other suite unchanged (U12). The handoff gives each exact number
  next to its command.

### 7.3 Proofs of failure
Each must fail the named tests and exit nonzero; restore from a saved copy,
never with `git checkout` (1b-2 passdown §4.2), and commit before running
them.

| Proof | Break | Must fail |
|---|---|---|
| (a) | Entries hold the node object instead of a handle | the handles test |
| (b) | Skip the value check before undoing a transform | the changed-elsewhere test |
| (c) | Report a gesture accepted when its own sends were accepted but its record was marked rejected | the overlap test |
| (d) | `commit(..., { record: false })` reports a gesture | its test |
| (e) | `prepareRestore` subtracts the offset from a copy | the bit-for-bit translation test |
| (f) | Recording an entry doesn't clear the redo stack | its test |
| (g) | Count W8's bytes in UTF-16 code units | the UTF-8 test |
| (h) | Allow a second undo while one is in flight | the in-flight test |
| (i) | Undo of an add removes a node that is no longer restorable | its test |
| (j) | Clear the stacks when Edit mode is turned off | the W7 test |
| (k) | (Rev 1) Settle recordable requests through the structure tracker, which Edit off resets | the Edit-off-with-a-request-pending test |
| (l) | (Rev 1) Undo of an add checks only alive, childless and restorable | the structural changed-elsewhere tests |
| (m) | (Rev 1) A batch with any refusal reports nothing | the partial tests |
| (n) | (Rev 1) Report a gesture when its own sends are answered, before its records reconcile | the gesture-2-answered-first test |
| (o) | (Rev 1) Keep the click-time capture; skip re-captures while the delete is pending | the delete-capture test |
| (p) | (Rev 1) Record an accepted rename without checking the local name | the rename-postcondition test |
| (q) | (Rev 1) Drop the `sending` block | its `structuralBlockReason` test |
| (r) | (Rev 2) `remoteSet` does nothing (1b-1's behaviour) | U16's probe test |
| (s) | (Rev 2) A batch with a `remote` record still reports | the same test's "nothing reported" |
| (t) | (Rev 2) Drop the `undoing` guard | the undo-in-flight tests |
| (u) | (Rev 2) Judge the refused-batch "changed" filter on the last attempted value | the dragged-back test |
| (v) | (Rev 2) The partly-applied undo shows `Couldn't undo` | its message test |
| (w) | (Rev 3) Reconcile writes only after a refusal (1b-1's rule) | the accepted-after-remote test |
| (x) | (Rev 3) `editBlocked()` ignores a pending structural request | the pending-delete tests |
| (y) | (Rev 3) Any batch with a remote set clears the redo stack | the all-own-sends-refused test |

### 7.4 End to end (Claude, throwaway, not committed)
Run by Claude on the published SHA, before the operator's DEV acceptance. A
real server (owned document world) and real `AtriumClient`s, A the owner:
- A adds a cube, moves it, renames it, deletes it; then undoes all four in
  turn: the cube is back with its original name and position, and B (a
  visitor) sees each step. Redo all four: it's gone again. Save and reload
  between: what persists matches the last accepted state;
- **handles:** A moves a cube, deletes it, undoes the delete, undoes the
  move → the move's undo targets the re-added node;
- **two owner tabs:** A moves a cube; A2 moves it again; A's undo is refused
  as changed elsewhere and sends nothing (count A's outbound `send`s);
- A2 deletes a node A has entries for; A's undo of them says removed;
- **S1 on undo:** A adds a cube; A2 deletes it and adds a new `Cube`; A's
  undo of the add is refused by the identity check (the handle's node is
  dead), and A2's new cube survives;
- a refused undo (a stand-in: the world made read-only between record and
  undo, or a K6-failing value) reverts locally and drops the entry;
- **(Rev 1, review #2)** A adds a cube; A2 moves it; A's Undo refuses and the
  cube survives in every client. A deletes a cube and undoes the delete; A2
  moves the re-added cube; A's Redo refuses and the cube survives;
- **(Rev 1, review #3)** A partly accepted drag: A drags a cube through a
  value the server accepts, then one it refuses (a crafted refusal, e.g. a
  rotation the K6 check refuses, sent through the tracker); the node holds
  the accepted value and one Undo returns it to the start;
- **(Rev 1, review #4)** A moves a cube and clicks Delete before the answer:
  Delete is disabled until it arrives. A deletes a cube while A2's move of it
  is in flight (A2 sends first): Undo restores the cube where A2 left it;
- **(Rev 1, review #1)** A adds a cube and turns Edit mode off before the
  answer; after it arrives, Edit on and Undo removes the cube;
- **(Rev 2, review 2 #1)** A deletes a cube, turns Edit off and on at once:
  Delete and the palette are disabled until the answer. A deletes a cube
  and turns Edit off; A2 removes it and adds a new `Cube` before A's request
  reaches the server: A's answer still settles as 1b-2's `replaced` (no
  panel message with Edit off), and nothing is recorded;
- **(Rev 2, review 2 #2)** U16's case with real clients: A's drag (two sends
  through the tracker), A2's move of the same cube landing between them,
  A's second send refused (a crafted refusal) → A shows A2's value, the
  server holds it, and A's Undo has no entry for the drag and can't
  overwrite A2's move;
- **(Rev 2, review 2 #3)** A presses Undo and, before its answer, drags and
  commits a panel field: neither sends anything (count A's outbound
  `send`s);
- **(Rev 3, review 3 #1)** A commits X=5 while A2's X=4 is already on its
  way (A2 sends first, A sends before receiving A2's broadcast): the server
  holds 5 and so does A's node, after A's answer arrives; A's Undo has no
  entry for it;
- **(Rev 3, review 3 #2)** A deletes a cube and, before the answer, tries
  to drag it and to commit its X field: nothing is sent; A2 adds an
  unrelated node meanwhile; A's Undo of the delete restores the cube at its
  server position;
- **(Rev 1, review #9, the known limitation)** A adds a cube; A2 sends a
  remove and an add of a new `Cube` and, without waiting for any broadcast,
  A sends its undo of the add (A's identity check passes, since A hasn't
  seen A2's messages). The server handles A2's first: A's remove hits A2's
  new cube, A shows 1b-2's `replaced` message and drops the entry. The test
  asserts that report, not prevention.

**Headless browser run** (the 1b-1/1b-2 harness, 1b-2 passdown §4.3):
the real page against a local server: the buttons' enabled state during a
drag, a pending rename and a pending delete; Ctrl+Z and Ctrl+Shift+Z with
the canvas focused and with a panel button focused; **Ctrl+Z while typing in
the name field undoes the typing, not the last edit**; an undoable delete
shows no dialog and a group delete does; selection after undo per W10;
**(Rev 1)** Add, Duplicate and Delete each followed at once by Edit off,
then Edit on and Undo (Y7). **(Rev 2)** Edit off and on with a delete
pending: the palette, Duplicate and Delete stay disabled until the answer;
the handles and fields are disabled while an undo is in flight.
Real click timing (1b-2 passdown §4.1's lesson).

## 8. DEV acceptance (operator, Firefox)

**First, in each window: hard-reload and check the new code is running**:
`!!document.getElementById('ep-undo')` is `true` in the browser console (the
handoff confirms the id).

**Setup:** an owned world on `https://dev.ewwb.dev` with at least one pad;
a visitor window; a second owner tab for steps 6–7.

1. **Gate:** the visitor and a logged-out window see no Undo or Redo.
2. **Transforms:** drag a cube, rotate it, scale it; type a new X in the
   panel. Undo four times → each change reverses in order, one per press,
   and the visitor sees each. Redo four times → back. Tooltips read
   `Undo Move “Cube”` and so on.
3. **Rename:** rename a cube; undo → the old name, in the panel and for the
   visitor; redo → the new one.
4. **Add, duplicate, delete:** add a sphere, duplicate it, delete the copy
   (**no dialog**). Undo three times → the copy returns, then goes, then the
   sphere goes. Redo three times. Delete a pad, undo → it's back with its
   label and still teleports (Edit off, walk onto it).
5. **Not undoable:** delete `grp-test` (a group, recipe §6.2 of the 1b-2
   passdown) → the dialog says it can't be undone and counts the object
   inside; afterwards Undo doesn't offer it.
6. **Changed elsewhere:** move a cube in tab 1; move it again in tab 2; in
   tab 1 press Undo → `Can't undo: “Cube” was changed elsewhere.` and
   nothing moves; the next Undo reaches the entry below. **(Rev 1)** Add a
   cube in tab 1, move it in tab 2, Undo in tab 1 → refused, and the cube
   stays in both tabs.
7. **Removed elsewhere:** in tab 1 move a cube; delete it from tab 2; tab 1's
   Undo says it was removed.
8. **Keys:** Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y with the viewport focused and
   after clicking a panel button. Typing a name and pressing Ctrl+Z undoes
   the typing only. With Edit mode off, Ctrl+Z does nothing.
9. **Lifetime:** make two edits, turn Edit mode off and on → Undo still
   works (W7). Reload the page → Undo is empty.
10. **Persistence:** after a mix of undos and redos, wait ~35 s (or close
    every window) and reload → the world is in the last state shown.
11. **Regression:** 1b-1 and 1b-2 behaviour (move, rotate, scale, rename,
    palette, duplicate, delete-with-children, the "removed" messages, J8);
    the teleporter modes with Edit off; teleporting.
12. **Console:** no errors beyond deliberate refusals.

## 9. Worker rules, S22, and operator checks

**This round's release path is S22's acceptance test** (`atrium-ops`
`PASSDOWN-s22-installed.md` at `ac2d314`): the publish is the first since
Q0 disabled the publisher (after the server-cleanup round's publish,
`t_f6e09d5b`), and the first run of the sandboxed
`atrium-publish-workflow` (installed 2026-10-18 16:08 UTC; the
`atrium-deploy-gate publish` entry point is unchanged). **Any refusal or
odd output from publish, DEV deploy, `recover`, MAIN or PROD goes back to
the S22 conversation with the full output.** The fail-closed messages that
passdown lists (exit 77 `DEV can't change until PROD completes`, `NOT
ROLLING BACK`, `REFUSING … the marker is kept`, `COULD NOT CONFIRM set-dev
FINISHED`, a held release lock) are answered with `atrium-deploy recover`
or by waiting, never by running `atrium-release-state` by hand during a
deploy. Rollback stays available until acceptance.

**Workers:** as the server-cleanup round (10-16 passdown §3):
- `pnpm install --frozen-lockfile --prefer-offline` in their own worktree;
- the full handoff (40-char SHA, per-file counts and exit codes, Node
  version, skipped count, proofs);
- **an ordered step list with a commit per step** (10-16 §3.4):
  1. `prepareRestore` and its tests (Y2);
  2. gesture outcomes and `{ record: false }`, and their tests (Y3);
  3. `edit-undo.js` and its tests (Y1, Y4, W4, W7, W8);
  4. `edit-structure` marker and test;
  5. `app.js` and `index.html` wiring (Y4, Y5, W6, W9, W10);
  6. full suites, proofs, handoff;
- **`--max-runtime 3h`** at creation, and expect more than one run (the
  150-iteration budget, 10-16 §3.4).

**Kickoff and cards:**
- the kickoff is created **blocked**, every spec part is posted, then it's
  released (10-16 §3.1); the body tells the orchestrator not to reuse an
  `OPERATOR BLOCK:` prefix it quotes;
- **the worker-card requirements go on the kickoff as a comment**, and card
  bodies reference that comment, never the host path (10-16 §3.2);
- gates are protected by whoever sees them turn `ready` (10-16 §3.3);
- the sentinel hangs off the DEV finalizer, never the review gate (§3.6);
- hand-made review cards open with "THIS RUN HAS TERMINAL, FILE AND GIT
  TOOLS. Use them for every step below.";
- check every code reference the GLM brief makes.

**Before kickoff:**
- **upload this pre-brief before the base fetch.** No GitHub web edits to
  `main` from then until PROD;
- no open sentinel; a push dry run; the base SHA from a host fetch;
- **the GitHub PAT expires 2026-10-29.** Renew it first if the round could
  reach PROD after that.

**Outside review** of the implementation by a separate Claude session (10-16
§5.3), alongside §7.4.

## 10. Notes for the brief author
- **Identity is the headline (W2, U7).** Every place an entry touches a
  node goes through its handle, and every send is preceded by an
  identity-and-value check (Y4). Grep the wiring for any entry field that
  holds a `SOMNode` directly.
- **Don't record undo's own sends** (Y3). Without the marker, every undo
  would push a new entry and clear the redo stack.
- **Don't trust a gesture's `from` after a rejection on its record** (Y3,
  proof (c)).
- **Build the restore descriptor without an offset** (U5, proof (e)).
- **(Rev 1) Undo records what the server accepted, not what the client
  meant to do** (the review's summary). Three places carry it: Y3's settle
  batches (a partly accepted drag is still a change), Y2's re-captures (a
  delete restores the last server state), and Y1's `descriptor` check (a
  remove never takes an object someone else has since changed).
- **(Rev 1) Recording lives outside the panel's state** (Y7). Grep for any
  recording that reads `structure.pending` or `modes.edit`.
- **(Rev 2) U16 is a 1b-1 bug fixed here,** not undo-only: `remoteSet` must
  be wired for every transform `som:set`, Edit mode on or off.
- **(Rev 2) Guard dispatch paths, not just buttons** (Y4): the keys, a
  blur-triggered commit and a gizmo drag don't go through a button.
- **(Rev 3) Reconcile always leaves the node at `confirmed`** (Y3). It's the
  one-line change that fixes both U16 cases; check that 1b-1's existing
  tests still pass unchanged, since the ordinary path writes nothing.
- **`onStructureAnswer` order matters** (Y4): undo answers first, so the
  palette's retry can't swallow them.
- **No server, protocol or SOM change.** If the brief finds one is needed,
  stop and ask (AGENTS rule 1).

## 11. Where this sits
1. 1b-1 (`6447082b`), the server cleanup (`27486bdf`), 1b-2 (`68a5b2b4`).
2. **Step 2: undo and redo** (this file).
3. Next: step 3 (models by URL, starter library, sky). The 1b-2 tweak round
   (passdown §5.1) can go before or after it; its keyboard item waits for
   this round.

## 12. Review log

### 12.1 Outside review of Rev 0 (ChatGPT, 2026-10-18)
Verdict: revise before implementation; four must-fix, five should-fix; W1–W3
and W6–W10 agreed, W4 and W5 changed. Each finding was checked against
`42e9f87`, #3 with a new probe. All nine accepted.

| # | Finding | Check | Disposition |
|---|---|---|---|
| 1 (must) | An add, duplicate or delete answered after Edit mode goes off is never recorded | Confirmed: `setEditMode(false)` calls `structure.reset()` (`app.js` ~L1639) | New Y7: the undo module keeps its own map of recordable requests, settled whatever the Edit mode; W7 wording. Tests, proof (k), headless |
| 2 (must) | Undoing an add (or redoing a delete) can remove an object another tab has since changed | Confirmed against Rev 0's Y4, which checked only alive, childless and restorable | Y1: every structural entry stores the `prepareRestore` descriptor; a remove requires an exact match (Y4). Tests, proof (l), e2e |
| 3 (must) | A partly accepted drag leaves an accepted change with no entry | **Confirmed by probe** (U13): X=1 accepted, X=2 refused → the node holds 1 | Y3 rewritten: settle batches; with any refusal, one merged entry per node from the records' starting to final confirmed values. Tests, proof (m), e2e |
| 4 (must) | Delete can capture optimistic or stale values | Confirmed: `structuralBlockReason` ignores tracker sends (U14); nothing re-captures during a pending delete | Y2: Delete and Duplicate wait for sends; captures redone on every remote change until the removal; a failed re-capture isn't recorded. Tests, proofs (o), (q), e2e |
| 5 | Overlapping gestures must settle together and record in order | Accepted (Rev 0's per-gesture outcome could report before a shared record reconciled) | Folded into Y3's batches; begin order. Tests, proof (n) |
| 6 | An accepted rename may not have applied locally | Confirmed: `_resolveOwnSetEcho` emits `edit:accepted` whether or not `renameNode` applied (~L1033–1051, U15) | Y4: recorded or moved only if the node now has the new name; otherwise both stacks cleared and a message. Test, proof (p) |
| 7 | A new change that isn't undoable should clear the redo stack | Accepted | W5 and Y1. Test |
| 8 | Zero-send undo isn't defined | Confirmed: `commit` returns `null` when the sanitized value is already held (`edit-gesture.js` ~L209) | Y3 and Y4: a `null` commit is done; an all-`null` entry moves with no request. Test |
| 9 | Keep the post-check name race as an explicit limitation, with a test | Accepted | W2 known limitation; Y4; e2e asserts the `replaced` report |

### 12.2 Outside review of Rev 1 (same reviewer, 2026-10-18)
Verdict: substantially improved; one more revision. Rev 0's #2, #6, #7, #8
and #9 resolved; #1, #3, #4 and #5 resolved in part. Three must-fix, three
clarifications, each checked against `42e9f87`, #2 by probe. All six
accepted.

| # | Finding | Check | Disposition |
|---|---|---|---|
| 1 (must) | Edit off still resets the structure tracker: a second structural request becomes possible, and S1's evidence is lost | Confirmed: `setEditMode(false)` → `structure.reset()` (~L1639); the palette's only block is `structure.pending` (~L2059) | Y7: `structure` reset only at session end; N4's "answer ignored" changed. Tests, e2e, headless |
| 2 (must) | A revert can overwrite another session's newer value, and Undo could then overwrite it on the server | **Confirmed by probe (U16), and it's a 1b-1 bug today**: the tracker never sees remote sets, so it writes X=1 over the server's 4 | Y3: `remoteSet`; `confirmed` = the last to arrive; a batch touched by a remote set isn't recorded. Tests, proofs (r), (s), e2e |
| 3 (must) | Ordinary edits aren't blocked while an undo is in flight | Confirmed: handles and fields are blocked only by a pending rename (U17) | Y4: every Edit-mode change blocked in its dispatch path during an undo or redo. Tests, proof (t), e2e, headless |
| 4 | Dragged back to the start after a partial acceptance | Accepted: Rev 1's wording could be read as filtering on the last attempt | Y3: judged on the confirmed result. Test, proof (u) |
| 5 | A partly applied undo says `Couldn't undo` | Accepted | Y4: the partly-applied message; redo cleared. Test, proof (v) |
| 6 | W6 contradicts design §4.1 | Accepted | W6 says it supersedes §4.1 for restorable nodes, with the reason and the alternative |

### 12.3 Outside review of Rev 2 (same reviewer, 2026-10-18)
Verdict: Rev 1's findings resolved except one in part; a targeted
amendment, no further broad review needed. Two must-fix, one should-fix,
each checked against `42e9f87`, #1 by probe. All three accepted.

| # | Finding | Check | Disposition |
|---|---|---|---|
| 1 (must) | An accepted send after another session's earlier set leaves this tab showing the other value | **Confirmed by probe (U16's second case), live today:** commit X=5, remote X=4 applied, X=5 accepted → the tab shows 4. No refusal needed | Y3: reconcile writes `confirmed` whenever the node differs, refused or not. Tests, proof (w), e2e |
| 2 (must) | Edits to a node while its delete is pending can be captured as its restore state | Confirmed: during a pending structural request only the palette, Duplicate and Delete are disabled (`refreshEditActions` ~L2057–2066); handles and fields stay live (U17) | Y4: every Edit-mode change blocked while a structural request is pending, through one `editBlocked()` guard; Y2 notes it. Tests, proof (x), e2e |
| 3 | A batch touched only by another session shouldn't clear redo | Accepted | Y3: redo cleared only if one of this tab's sends in the batch was accepted. Test, proof (y) |
