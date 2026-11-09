# Pre-brief: grouping and ungrouping (`grouping`)

Status: **DRAFT, Revision 0.1 (2026-11-09).** Not yet checked by a fresh
agent or reviewed. Decisions GR-L1 to GR-L7 are open (§3), each with a
recommendation; §4 is written for the recommendations.
- **The round.** The operator chose it on 2026-11-08 (after 21:20 PT), from
  `Atrium-Passdown-2026-11-08-selection-parts-shipped.md` §5 item 1: grouping
  and ungrouping in the Edit panel, and moving a part into another group (a
  `parent` change on a live node), then SA-L2's bounds against created
  content.
- **What it builds on.** `PREBRIEF-selection-parts.md` FINAL Rev 2.1 and
  everything it builds on (`PREBRIEF-subtree-add.md` T1–T12, A1–A10, R1–R10,
  K0–K10) hold unchanged.
- **Checked against `main` at `172b816d`**, whose code is PROD's `331e4aed`
  (the difference is `devtasks/` only: the passdown). Every line number below
  is at that commit.
- **How it was checked.** Claude read every cited line at `172b816d` and ran
  three probes:
  - `devtasks/spike-grouping/g1-reparent-facts.mjs` (headless, on the real
    modules): the allowlist, glTF-Transform's `addChild`, an older client's
    `setPath`, and DocumentView;
  - `devtasks/spike-grouping/g3-order-and-save.mjs`: node order, and the
    saved and reloaded file;
  - **a real-browser probe on the released page** (lesson 1 of the
    selection-parts passdown), `devtasks/harness/checks/grouping/g2.py` on
    the harness at `172b816d`: **17 PASS**. A parent change was applied in
    the page as a received `set` would apply it, and the drawing, selection,
    breadcrumb, handles, outline, a click, a double-click and Escape were
    checked.
- **Not yet done:** no suite was run (nothing has changed); no fresh-agent
  check; no outside review.

## 1. What this delivers
**An owner can make groups, take them apart, and move an object into or out
of a group, in the Edit panel, with Undo; every visitor sees the change at
once and nothing jumps.**
- **A new row in the Edit panel** (GR-L1 (a)), under Duplicate, Copy and
  Delete:
  - **Group:** puts the selected object into a new, empty group at the same
    spot (`group-01`, the next free name), and selects the group;
  - **Ungroup:** for a selected group, moves its parts up one level, keeping
    each where it is in the world, then deletes the empty group;
  - **Move to…:** a list of the groups the selected object can go into,
    plus **Top level** for a part. The object keeps its place in the world.
- **One new edit on the wire** (GR-L2 (a)): a `send` whose `field` is
  `parent`, whose value names the new parent (or `null` for the top level)
  and carries the local placement that keeps the object where it is. The
  server applies it atomically and broadcasts it as a `set`.
- **Undo and Redo** for all three, one step each (§4 GR7).
- **Groups made this way stay copyable** (GR-L5 (a)): the server refuses a
  move that would make a top-level group larger than SA-L2's bounds, so every
  group a user makes can still be duplicated, copied, deleted and restored.
- **An unreloaded tab can no longer edit at all** once this ships (GR-L3 (a)):
  it can't apply a parent change (§2.3), so its moves would land in the wrong
  place.

## 2. Verified facts (at `172b816d`)

### 2.1 A parent change today
- **The server refuses it.** `authorizeSend` ends with "Whole `extras` …,
  `name`, `parent`, internals … all refused" (`send-policy.js` L1892–1894):
  a `send` with `field: 'parent'` answers `PERMISSION_DENIED`, "field is not
  writable on a node", whatever the value (g1 §1). **Nothing the app sends
  can change a live node's parent.**
- **`parent` exists only on `add`** (`add.client.json` L12, `string|null`):
  `world.addNode` checks that the parent exists and calls `parent.addChild`
  (`world.js` L589–607, and L737–757 for the saved-world path). The
  `add` path refuses a parent that is, or descends from, a live avatar or an
  externally loaded node (`isBlockedParent`, `session.js` L136–145, used at
  L1407). An avatar `add` may not carry a parent at all (L1336).
- **Rename is the precedent:** a `send` with `field: 'name'`, allowed by type
  in `authorizeNodeSend` (`send-policy.js` L1853–1857), applied by
  `world.setField`'s own branch through `SOMDocument.renameNode`
  (`world.js` L571–580), and on the client applied **only on the server's
  answer** (`AtriumClient.renameNode` L1384, `_resolveOwnSetEcho` L1812ff,
  remote rename L1771–1793). §4 copies this shape.

### 2.2 What glTF-Transform and the view do (g1 §2, §4, §5; g3)
- **`Node.addChild` detaches first** (`@gltf-transform/core` 4.3.0,
  `index.modern.js` L3130–3140): it removes the child from its parent node
  and from any scene. `Scene.addChild` does the same for a parent node
  (L3516–3521). One call moves a node; nothing is left behind.
- **It does not refuse a cycle.** `A.addChild(G)` with G the parent of A
  succeeds: G's parent is then A and A's is G, and **both leave the scene**
  (g1 §2). The server must refuse a move under the node itself or any of its
  descendants.
- **A parent change keeps the LOCAL values,** so the object jumps: `crate-01`
  at (0, 0, 5), moved under a group at (10, 0, 0) turned 90° and scaled 2,
  lands at (20, 0, 0) (g1 §4). Keeping the world placement means sending the
  new local values with the move.
- **The node list doesn't change order** (g3): `root.listNodes()` reads
  G, A, C, Z before and after moving C into G. Saved node indices, and so
  `KHR_interactivity`'s `/nodes/<i>` pointers, are unaffected. The saved file
  has C in G's `children` and not in the scene's `nodes`, and reads back that
  way.
- **DocumentView follows a reparent with the same `Object3D`** (headless,
  `@gltf-transform/view` 4.4.0 in `node_modules`, g1 §5; and in the browser,
  4.3.0 from the page's import map, g2): `NodeSubject` and `SceneSubject`
  rebind their `children` on every update and never clone a node's output
  (`_outputSingleton`). A new empty node and a move into it also show. A
  placed model's drawing is a wrapper added to its node's `Object3D`
  (`model-bridge.js` L799, L847), which a children rebind doesn't remove.

### 2.3 An older client and a parent change (g1 §3, g2)
- **It throws.** `AtriumClient._onSet` sends every field but `name` to
  `som.setPath(target, field, value)` (L1797–1802), and `SOMNode` has only a
  getter for `parent` (L133–137). `setPath(C, 'parent', …)` throws
  `TypeError: Cannot set property parent of #<SOMNode> which has only a
  getter` (g1 §3; and in the page, g2). `dispatch` is `async` (L845) and has
  no `catch` around `_onSet`, so the tab drops the message (an unhandled
  rejection in its console) and **keeps the node under its old parent**.
- **So its later edits of that node go wrong for everyone.** Its handles and
  fields work in the old parent's frame, and the server would apply the
  local values it sends under the new parent. **Today a stale tab can still
  `send`:** `isStaleEditor` (`session.js` L201–206) refuses only `add`
  (L1370) and `remove` (L1638); the richer-add passdown's "it can still join,
  move, recolour and rename" is by design.
- **Who is judged a stale tab:** a session that sends `scriptRunner` without
  `addFields` ≥ `ADD_FIELDS_LEVEL` (3 today, L186). Tests, the protocol
  inspector and cross-origin clients send neither and are not judged.

### 2.4 The page after a parent change (g2, the released page)
On the harness's `space.gltf` world: `crate-01` was selected, then moved into
`lamp-01` in the page (world placement kept, through `applyLocally`), then
back to the top level.
- The drawn crate hangs under `lamp-01`'s `Object3D` and **doesn't move on
  screen** (world (1, 0.25, 0) before and after, both ways).
- The selection still names `crate-01`; **the handles and the outline stay on
  it.**
- **The breadcrumb is not refreshed.** It still reads nothing for the part,
  and `selectForEdit(crate-01)` doesn't help, because `selectForEdit`
  returns at once for the node already selected (`app.js` L2412). The path
  itself is computed from the node's ancestors (`selectionPath`,
  `renderPath` L2652), so a refresh is all it needs (§4 GR8).
- **A fresh click on the crate selects `lamp-01`** (the top-level object, as
  selection-parts made it), a double-click goes down to `crate-01` with the
  breadcrumb `lamp-01 › crate-01`, and Escape goes back up to `lamp-01`.
  After the move back, a click selects `crate-01` again.
- The server's copy was unchanged throughout (it never heard).

### 2.5 What the client already has for this
- **The world placement maths:** `part-transform.js` (selection-parts T11):
  `multiply`, `inverse3`, `decomposeTRS`, `partWorldTRS` (a part's world TRS;
  a **shear** is refused, a mirror carried as a negative x scale), and
  `@atrium/som`'s `worldMatrix`. Moving into a parent `P` needs
  `inverse(world(P)) × world(node)` decomposed: the same decomposition, with
  the same shear refusal.
- **A free name:** `isNameFree` (`app.js` L3005, `checkNewName`), as
  Duplicate's `copyName` uses it.
- **An empty node is a legal `add`:** `checkAddNode({ name: 'group-01',
  translation: [0, 0, 0] })` returns `null` (no problem) in both copies of the
  rule.
- **The Undo engine** (`edit-undo.js`) has `transform`, `rename`, `add` and
  `delete` entries. Each points at handles that follow a node through re-adds
  (W2). A transform entry already carries several sends in flight at once
  (`bySeq`, with accepted and refused counts, L876). Structural entries are
  one message each. A delete records its parent's handle (selection-parts
  T11).
- **One socket keeps order:** the server handles one session's messages in
  the order they arrive, so `add` of a new group followed at once by a move
  into it is answered in that order (the second refused with
  `NODE_NOT_FOUND` if the first was refused).

### 2.6 Groups today
- No user can make a group (subtree-add §2.5, still true): PROD's 9 groups
  are seed content (3 nodes each). `atrium.gltf`'s largest is `Furniture`
  (9 children). The harness's `group.gltf` has a rotated group with a child
  teleporter.
- **SA-L2's bounds** (one `add` message): at most 256 nodes, 8 generations
  below the root, 1,024 primitives, and the client's 1,000,000 bytes
  (`SUBTREE_NODES_MAX`, `SUBTREE_DEPTH_MAX`, `SUBTREE_PRIMITIVES_MAX`, exported
  by `add-spec.js`). A group past them can't be duplicated or copied, and its
  Delete asks first (it can't be restored). **Grouping is the first way a
  user could make one** (subtree-add §2.5 named this round to revisit them).

## 3. Decisions (for the operator)
Binding from earlier rounds: everything in `PREBRIEF-selection-parts.md` §3
and `PREBRIEF-subtree-add.md` §3.

**GR-L1. The controls.** The Edit panel selects one object at a time; Shift
multi-select is a separate candidate round.
- **(a) Recommended: three controls for one selected object.** **Group**
  wraps it in a new group in place. **Ungroup** lifts a group's parts out.
  **Move to…** is a list of the groups it can go into, plus **Top level**.
  Two objects end up together in two steps: Group the first, then Move the
  second into that group. Nothing here needs multi-select, and a later
  multi-select round adds "Group selected" over the same edit (GR-L2).
- (b) Do Shift multi-select first, and make grouping "Group selected" then.
  It's the usual way, but it's two rounds before anyone can group anything,
  and the move edit is needed either way.
- (c) A pick gesture: "Move into…", then click the target group in the
  viewport. It's quicker for far-apart objects, but it's a new gesture over
  the handles, which selection-parts showed needs its own browser probe
  before a contract (lesson 1); the list in (a) needs none.

**GR-L2. The edit on the wire.**
- **(a) Recommended: a `send` with `field: 'parent'` and
  `value: { parent, translation, rotation, scale }`.** `parent` is the new
  parent's name, or `null` for the top level. The three vectors are the new
  local placement, which the client computes to keep the world placement
  (§2.5). One message, applied atomically, broadcast as a `set` with the same
  value. The schema doesn't change (`send.value` is open), and the check is
  `send-policy.js`'s, as for every other leaf. Undo sends the exact old values
  back, so the entries around it still match (§4 GR7).
- (b) `value` is only the parent's name; the **server** computes the local
  values that keep the world placement. This is robust to a parent moving at
  the same moment, but it needs a second copy of the decomposition and the
  shear rule on the server. Undo would get recomputed floats rather than
  the exact old values, so an older Move entry would then read "changed
  elsewhere".
- (c) A new message type (`reparent`): a schema, a validator key, a
  direction, and nothing gained over (a).

**GR-L3. Unreloaded tabs** (§2.3).
- **(a) Recommended: `addFields` 4, and a stale tab may not edit at all.**
  Clients and servers declare 4 ("I apply parent changes"). The server
  refuses `send`, as well as `add` and `remove`, from a session below it,
  with the same message ("this page is older than the server: reload it to
  keep editing"). The cost: until it reloads, an old tab can't move,
  recolour or rename anything (today it can). The gain: no old tab can put a
  moved object in the wrong place for everyone.
- (b) Keep today's rule (only `add` and `remove`). A stale tab's move of a
  regrouped object then lands in the wrong frame, for every visitor, and is
  saved.
- (c) Refuse a stale tab's `send` only for nodes whose parent changed since it
  connected. This narrows the cost of (a), but needs per-session history on
  the server, for a window that ends at the next reload.

**GR-L4. What may move, and where.**
- **(a) Recommended:**
  - **The object moved:** any node a `send` may edit today: not a live
    avatar, not external content or inside it (`authorizeSend`'s checks).
  - **The new parent:** `null` (the top level), or a node that:
    - is addressable by a non-empty name;
    - is not, and doesn't descend from, a live avatar or external content
      (`isBlockedParent`);
    - is not the object itself or one of its descendants (§2.2: no cycle);
    - **does not carry a model** (`extras.atrium.model`).
  - **Not a no-op:** the object's current parent is refused
    ("already there").

  Models are refused as parents because a placed model's node already holds
  the model's own drawing (§2.2), and nothing needs a model as a parent:
  Group makes an empty node, and a model can still be *in* a group.
- (b) As (a), but models may be parents too. One rule fewer, and untried.

**GR-L5. The bounds** (SA-L2 against created content, §2.6).
- **(a) Recommended: the server refuses a move that would make the
  destination's top-level group exceed SA-L2's counts.** Those are 256 nodes,
  8 generations below its root, and 1,024 primitives, counted on the live
  tree after the move ("the group would be too large to copy"). So every
  group a user makes can be duplicated, copied, deleted and restored. The
  1,000,000-byte cap stays the client's, as now (an oversized Delete asks
  first). A move **out of** a group, or within one oversized seed group, is
  never refused by size.
- (b) The panel refuses, the server doesn't. A hand-made `send` could still
  build an oversized group.
- (c) No bounds. Such a group can't be copied, and its Delete asks first.

**GR-L6. What Group and Ungroup make.**
- **(a) Recommended:**
  - **Group:** the new group goes into the selected object's parent. It is
    placed at the object's local translation, with no rotation and scale 1.
    The object moves into it with translation 0 and keeps its rotation and
    scale. No matrix maths, so no shear can arise and the numbers are exact.
    It is two messages sent together (`add`, then the move), and one Undo
    step. The group ends up selected. If the server refuses the move, the
    client removes the empty group it made, and nothing is recorded.
  - **Ungroup:** offered only for an empty group: a node with parts and no
    mesh, model, behaviour, camera, light or teleporter of its own. Each part
    moves to the group's parent, keeping its world placement. **Once every
    move is accepted**, the empty group is deleted. Ungroup is disabled,
    with the reason as its tooltip, if a part would need a shear (§2.5).
- (b) Group places the new group at the world origin. The object's local
  values are then its world placement: the same maths as Copy of a part,
  with its shear refusal.
- (c) Ungroup any node with parts, keeping a node with its own mesh as an
  object. This makes "Ungroup" mean two different things.

**GR-L7. An Undo or Redo of several messages that the server stops halfway**
(a race: another tab of the owner changed something after the client's
check).
- **(a) Recommended: say which parts didn't follow, and drop the entry.** The
  client checks every step before sending anything (§4 GR7). If the server
  still refuses one, the panel says "Undo stopped: “X” changed elsewhere"
  (naming each), and the entry leaves the stack, because the world is no
  longer what either side of it describes. This is what "out of step" means
  today for one message.
- (b) Keep the entry and retry what is left on the next Undo. This needs a
  partial state in each entry, for a race between two tabs of one owner.

## 4. The contract (written for the recommendations)

**GR1. The SOM: one way to move a node** (`packages/som/src/SOMDocument.js`).
`reparentNode(node, parent, { translation, rotation, scale })` checks, then
applies, atomically (on failure nothing changes), like `renameNode`:
- `node` is a live SOM node of this document; `parent` is `null` or one;
- `parent` is not `node` and not one of its descendants (`INVALID_VALUE`,
  "a node can't go inside itself");
- `parent` is not the current parent (`INVALID_VALUE`, "already there");
- then it sets the three vectors and calls `(parent ?? scene).addChild(node)`.

Server and client both call it. It fires no `mutation` events of its own.
The callers run it inside their apply (the client's `applyLocally`).

**GR2. The server's check** (`packages/server/src/send-policy.js`).
`authorizeNodeSend` allows `field === 'parent'` when:
- `value` is a plain object with exactly the keys `parent`, `translation`,
  `rotation` and `scale`;
- `parent` is `null` or a non-empty string of at most 256 characters;
- `translation` passes `isVec3`, `rotation` `isUnitQuaternion` and `scale`
  `isNonZeroScale`, with `send`'s own texts.

Anything else is `INVALID_VALUE`. The checks that need the world follow in
GR3. A live avatar or external node is already refused before this
(`authorizeSend`).

**GR3. The server's apply** (`packages/server/src/world.js`, both
`setField`s; `session.js`). `world.setField(name, 'parent', value)` has its
own branch, as `name` does:
- the parent, when named, must exist (`NODE_NOT_FOUND`);
- it must not be blocked (`isBlockedParent`: `PERMISSION_DENIED`, "a node
  may not be moved under a live avatar or an externally loaded node");
- it must not carry a model (`INVALID_VALUE`);
- the bounds (GR4) must hold;
- then `som.reparentNode`.

The `send` case broadcasts the `set` with the value as received, and
notifies autosave, unchanged.

**GR4. The bounds** (GR-L5 (a)). A pure function over the live tree,
`treeBoundsProblem(root)` (in `send-policy.js`, beside `subtreeCountProblem`).
It counts nodes, generations below `root` and primitives against
`SUBTREE_NODES_MAX`, `SUBTREE_DEPTH_MAX` and `SUBTREE_PRIMITIVES_MAX`. GR3
runs it on the destination's top-level ancestor as it would be after the
move (that ancestor's tree plus the moved subtree, at its new depth),
without applying anything. Over: `INVALID_VALUE`, "the group would be too
large to copy". A move to the top level runs it on the moved subtree alone,
which is never larger than before, so it never refuses.

**GR5. Version skew** (GR-L3 (a)). `ADD_FIELDS_LEVEL` 4 (`session.js`), the
client's hello sends `addFields: 4` (`AtriumClient.js` L831), and
`isStaleEditor` also refuses `send` (in the `send` case, before
`authorizeSend`, with `STALE_CLIENT_MESSAGE`). A level-4 page facing a
level-3 server (a rollback) hides the Group row, as `treesAllowed()` hides
group paths today.

**GR6. The client** (`packages/client/src/AtriumClient.js`).
- `moveNode(name, value)` sends the `send` and returns its seq, like
  `renameNode`. **Nothing changes locally until the server accepts** (the
  rename pattern, §2.1).
- On its own echo, and on another session's `set` for `parent`, the client
  applies `som.reparentNode` inside `applyLocally`. It emits
  `som:reparent { nodeName, from, to }` (parent names, `null` for the top
  level), then `som:set` with `path: 'parent'`.
- A parent the client can't find emits `som:desync` (reason
  `parent-not-found`), as `_onAdd` does (L1650–1657). A refusal by
  `reparentNode` emits `som:desync` (reason `reparent-refused`).
- `_attachNodeListeners` is untouched: a reparent sends nothing on its own.

**GR7. Undo** (`apps/client/src/edit-undo.js`). Three new entry kinds,
recorded on acceptance:
- **`move`** ("Move to"): the node's handle, and `from` and `to`, each
  `{ parent: handle|null, translation, rotation, scale }`. Undo sends `from`,
  after checking that the node is alive, its parent is `to.parent`, its
  three vectors equal `to`'s exactly, and `from.parent` (if any) is alive.
  Otherwise: "changed elsewhere". Redo is the mirror.
- **`group`:** the object's `move` entry plus the group's `add`. Undo sends
  the move back, then removes the group, which must still be empty and
  unchanged. Redo re-adds it and moves the object in. Both are sent together
  (§2.5's order).
- **`ungroup`:** each part's `move`, plus the group's `delete` capture (an
  empty node). Undo re-adds the group, then moves each part back in with its
  exact old values, all sent together. Redo moves them out again, then
  deletes the group once every move is accepted.

Every step is checked before anything is sent (GR-L7 (a)). A refusal
halfway names the parts that didn't follow and drops the entry. The entry
labels are "Group", "Ungroup" and "Move".

**GR8. The panel** (`apps/client/index.html`, `app.js`, a new pure module
`apps/client/src/edit-group.js`).
- **The row** `#ep-group-actions` holds `#ep-group`, `#ep-ungroup` and a
  `#ep-move-to` select. It sits in the 250 px panel under `#ep-actions`, in
  Edit mode only (Inspect gets nothing).
- **Their enable rules** join `structuralBlockReason` (one structural request
  at a time). Each disabled control's reason is its tooltip.
- **`edit-group.js`**, pure and unit-tested on a turned and scaled group
  (selection-parts lesson 3), provides:
  - `groupPlan(node, { isFree })`: the group descriptor, its parent, and
    the move value;
  - `ungroupPlan(group)`: each part's move value, or the shear refusal;
  - `moveTargets(node, som, rules)`: the eligible groups, each with its
    breadcrumb text, sorted, then "Top level" for a part;
  - `moveValue(node, newParent)`: `inverse(world(newParent)) × world(node)`,
    decomposed with `decomposeTRS`, or a refusal.
- **`moveTargets` lists only nodes that already have parts** ("groups"),
  minus GR-L4's refusals and GR4's bounds. Group makes new ones.
- **On `som:reparent`**, the panel and both breadcrumb rows refresh, as do
  the outline and handles (`attachSelected`). This is the finding in §2.4:
  `selectForEdit`'s early return doesn't refresh.
- The SOM Inspector's tree rebuilds on `som:reparent`
  (`tools/som-inspector/src/app.js`).
- **Selection afterwards:** after Group, the new group. After Ungroup, the
  first part. After Move to, the moved object, with its new breadcrumb.

**GR9. Copy and Duplicate** are unchanged. A group made by Group is an
ordinary group, inside GR4's bounds by construction.

## 5. Tests and proofs
**Every new test must fail on `172b816d` first** (or be named a guard that
can't, with the reason). Server test files run one at a time under
`timeout 180`, new servers on port 0.

- **SOM** (`packages/som/test/`): `reparentNode`:
  - a move into a group, to the top level, and between groups;
  - the cycle (self, child, grandchild), each refused with nothing changed;
  - "already there";
  - the vectors set exactly;
  - node order unchanged (g3's check).
- **Server**
  (`packages/server/test/grouping.test.js`, new):
  - **GR2:** each malformed value;
  - **GR3:**
    - a missing parent;
    - an avatar parent, and a parent under an avatar;
    - an external parent, and a parent under one;
    - a model parent;
    - a cycle;
    - "already there";
  - **GR4:** 257 nodes, 9 generations and 1,025 primitives, each refused
    just past the bound and accepted at it, plus a move out of an oversized
    group accepted;
  - the broadcast `set` to two other sessions;
  - a save and reload (the saved tree);
  - **GR5:** a level-3 session's `send` refused with the stale message, and
    a session with neither capability still allowed.
- **Client** (`packages/client/tests/`): `moveNode` sends and changes
  nothing until the echo; the own echo applies; another session's `set`
  applies; `som:reparent` carries the names; a missing parent desyncs.
- **`edit-group.js`** (`apps/client/tests/`): every plan on a group turned
  90° about y, scaled 2, translated, and nested two deep: the world
  placement kept to 1e-9; a mirrored ancestor; a shear refused; `moveTargets`
  excludes self, descendants, models, avatars, external content and
  oversized results.
- **`edit-undo.js`:** `move`, `group` and `ungroup` undo and redo; the exact
  values restored; an older Move entry before a Group still undoes after the
  Group's undo; a race refusal drops the entry and names the part.
- **Wiring** (`apps/client/tests/`): the row's enable rules; the refresh on
  `som:reparent` (lift the page's own handler, subtree-add lesson 1).
- **Harness** (`devtasks/harness/checks/grouping/`, real mouse): Group,
  Move to, Ungroup, Undo and Redo of each, in two tabs, on `group.gltf`'s
  rotated group. Each asserts the selection, the world positions, the drawn
  parent, the server's copy (`/__doc`) and the Undo stack (selection-parts
  lesson 2).
- **Proofs** (the handoff records each): breaking each of the cycle check,
  the bounds, the stale `send` refusal, the exact Undo values and the
  breadcrumb refresh turns its test red.

**DEV acceptance (operator), each step naming the control and what happens:**
1. Hard reload. Select a cube. Press **Group**. The cube doesn't move; the
   panel selects `group-01`; the breadcrumb is empty (top level).
2. Select another cube. In **Move to…** pick `group-01`. It doesn't move.
   Click it: `group-01` is selected (both cubes outlined as one). Double-click
   it: the cube is selected, and the breadcrumb reads `group-01 › <cube>`.
3. With the group selected, drag the move handle a few centimetres on
   screen: both cubes move together.
4. **Undo** three times: the drag, then the move, then the group, each back
   exactly where it was.
5. **Redo** three times, then select `group-01` and press **Ungroup**: both
   cubes stay where they are, `group-01` is gone, Undo brings it back with
   both inside.
6. In a second tab (a visitor), watch steps 1–5: nothing jumps.
7. A tab opened before the deploy: any edit says "this page is older than
   the server: reload it to keep editing".
8. PROD: steps 1, 2 and 5 on a scratch cube.

## 6. Worker rules and release path
As `selection-parts` (`PREBRIEF-selection-parts.md` §6), with these
specifics:
- **Files:**
  - `packages/som/src/SOMDocument.js`;
  - `packages/server/src/send-policy.js`, `world.js`, `session.js`;
  - `packages/client/src/AtriumClient.js`;
  - `apps/client/src/edit-group.js` (new), `edit-undo.js`, `app.js`;
  - `apps/client/index.html`;
  - `tools/som-inspector/src/app.js`;
  - `devtasks/harness/checks/grouping/`;
  - test files under `packages/*/test/`, `packages/*/tests/` and
    `apps/client/tests/`.

  **No other file.** If one must change, stop and ask.
- **Commits, each runnable:**
  1. GR1 and its tests;
  2. GR2–GR5 and the server tests;
  3. GR6 and the client tests;
  4. `edit-group.js` and its tests, GR7 and its tests;
  5. GR8's glue and the wiring tests;
  6. the full suites, the proofs, the harness checks and the handoff.
- **Release:** a server and client round. DEV restarts at the deploy, and
  **every open tab must reload** (GR5). No stored data changes shape: a moved
  node is an ordinary node under its parent. **A rollback** to `331e4aed`
  loads every world as saved (groups made here are ordinary groups), and the
  old server refuses `parent` again. No `package.json` or lockfile change; no
  `p6` run needed.
- **Never push to `main` between the release merge and PROD `COMPLETE`.**

## 7. Review log
- **Rev 0.1** (2026-11-09): the first draft, from the probes in the header.

## 8. Follow-ups this file records
- Multi-select (Shift-click) and "Group selected", over GR2's edit.
- Child order inside a group: a move appends (`addChild`), and Undo puts a
  part back last among its siblings, not at its old index (as a part's re-add
  does today). Nothing reads the order yet.
- A keyboard route for Move to… (the select already takes keys).
- Models as parents (GR-L4 (b)), if a use appears.
