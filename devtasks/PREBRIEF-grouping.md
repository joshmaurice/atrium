# Pre-brief: grouping and ungrouping (`grouping`)

Status: **DRAFT, Revision 0.3 (2026-11-09).** Rev 0.2 (the fresh-agent check,
§7) plus the operator's decisions: **GR-L1 (a) and GR-L3 (a)**, and GR-L2 and
GR-L4 to GR-L9 as recommended ("no preference"). **GR-L10 is open**: the
operator asked why (a) is recommended (answered in the session). §4 is written
for the recommendations.
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
- **How it was checked.** Claude read every cited line and ran three probes:
  - `devtasks/spike-grouping/g1-reparent-facts.mjs` (headless, real modules);
  - `g3-order-and-save.mjs`;
  - **a real-browser probe on the released page**,
    `devtasks/harness/checks/grouping/g2.py` (lesson 1 of the selection-parts
    passdown): **17 PASS** on the harness at `172b816d`.

  **A fresh Claude agent then checked Rev 0.1** (§7). It checked 26 facts:
  20 confirmed, 2 wrong, 2 imprecise, 2 line numbers off by one. It wrote
  three probes in `devtasks/spike-grouping/fresh/`, and Claude reran all
  three: `f1` (a GR1 prototype, the move value, the bounds), `f2` (the real
  Undo engine) and `f3` (real mouse, on the harness).
- **Not yet done:** no suite was run (nothing has changed); no outside review.

## 1. What this delivers
**An owner can make groups, take them apart, and move an object into or out
of a group, in the Edit panel, with Undo. Every visitor sees the change at
once, and nothing jumps.**
- **A new row in the Edit panel** (GR-L1 (a)), under Duplicate, Copy and
  Delete:
  - **Group:** puts the selected object into a new, empty group at the same
    spot (`group-01`, the next free name), and selects the group;
  - **Ungroup:** for a selected group with nothing of its own, moves its parts
    up one level, keeping each where it is in the world, then deletes the
    group;
  - **Move to…:** a list of the groups the selected object can go into,
    plus **Top level** for a part. The object keeps its place in the world.
- **One new edit on the wire** (GR-L2 (a)): a `send` whose `field` is
  `parent`. Its value names the new parent (or `null` for the top level) and
  carries the local placement that keeps the object where it is. The server
  applies it atomically and broadcasts it as a `set`.
- **Undo and Redo** for all three, one step each (GR7). The entry labels are
  "Group", "Ungroup" and "Move to".
- **Groups stay inside SA-L2's counts** (GR-L5 (a)): 256 nodes, 8
  generations, 1,024 primitives. The server refuses a move **or an add**
  (Duplicate in place, a part's re-add) that would take a top-level group
  past a count it is not already past. **Counts aren't everything:** a group
  holding something Duplicate refuses (a camera, light or skin host, an
  animated node, external content) still can't be copied, as today.
- **An unreloaded tab can no longer edit, or be the behaviour host,** once
  this ships (GR-L3 (a)). It can't apply a parent change (§2.3), so its
  edits would land in the wrong place.

## 2. Verified facts (at `172b816d`)

### 2.1 A parent change today
- **The server refuses it.** `authorizeSend` ends with "Whole `extras` …,
  `name`, `parent`, internals … all refused" (`send-policy.js` L1892–1894):
  a `send` with `field: 'parent'` answers `PERMISSION_DENIED`, "field is not
  writable on a node", whatever the value (g1 §1). **Nothing the app sends
  can change a live node's parent.**
- **`parent` exists only on `add`** (`add.client.json` L12, `string|null`).
  `world.addNode` checks that the parent exists and calls `parent.addChild`
  (`world.js` L589–607, and L737–757 for the saved-world path). The `add` path
  refuses a parent that is, or descends from, a live avatar or external
  content (`isBlockedParent`, `session.js` L136–145, private to `session.js`,
  needing the live avatar names; used at L1407). An avatar `add` may carry no
  parent (L1336).
- **The add's bounds are the message's own:** `subtreeCountProblem`
  (session.js L758) and `subtreeShapeProblem` (L1383) count the tree being
  added, never the destination. **Duplicate in place of a part already grows
  a group with no limit** (`app.js` L3019 sends the copy into the same
  parent; fresh check).
- **Rename is the precedent.** The client sends a `send` with
  `field: 'name'`, which `authorizeNodeSend` allows by type (`send-policy.js`
  L1853–1857). `world.setField` applies it in its own branch, through
  `SOMDocument.renameNode` (`world.js` L571–580). The client applies it
  **only on the server's answer**: `AtriumClient.renameNode` L1384,
  `_resolveOwnSetEcho` L1812ff, and a remote rename at L1771–1793.

### 2.2 What glTF-Transform and the view do (g1, g3, f1)
- **`Node.addChild` detaches first** (`@gltf-transform/core` 4.3.0,
  `index.modern.js` L3130–3140), from a parent node and from any scene;
  `Scene.addChild` likewise (L3516–3521).
- **It does not refuse a cycle.** `A.addChild(G)` with G the parent of A
  succeeds, and **both leave the scene** (g1 §2).
- **A parent change keeps the LOCAL values, so the object jumps**: from
  (0, 0, 5) to (20, 0, 0) under a group at (10, 0, 0) turned 90° and scaled
  2 (g1 §4).
- **Keeping the world placement takes a 4×4 affine inverse**, which
  `part-transform.js` doesn't have (only `inverse3`, L44; f1 writes
  `inverseAffine`). Into a turned, scaled, nested group it is kept to 6e-16,
  into a mirrored one to 1e-16 (f1). **A shear is common**: any rotated
  object moved into or out of a non-uniformly scaled group has no TRS (f1,
  both directions).
- **Exact old values undo exactly; maths doesn't** (f1): moving back with the
  saved local values is bitwise equal, recomputing them is not.
- **The node list doesn't change order** (g3), so saved indices and
  `KHR_interactivity`'s `/nodes/<i>` are unaffected. The saved file has the
  new structure and reads back that way.
- **DocumentView follows a reparent with the same `Object3D`** (g1 §5,
  headless with 4.4.0; g2, in the page with 4.3.0). A placed model's
  drawing is a wrapper added to its node's `Object3D` (`model-bridge.js`
  L798, L847). A children rebind doesn't remove it.
- **three.js doesn't draw the children of a hidden object,** so a part's
  drawn visibility depends on its ancestors (GR-L9).

### 2.3 An older client, and who is judged one (g1 §3, g2; fresh check)
- **An older client throws on a parent change.** `_onSet` sends every field
  but `name` to `som.setPath` (L1797–1802). `SOMNode.parent` is a getter
  only (L133–137), so it throws `TypeError: Cannot set property parent …`.
  `dispatch` is `async` (L846) and doesn't catch it, so the tab **keeps the
  node under its old parent**. Its later edits of that node (and, as a
  visitor, its drawing of later moves) are then in the old frame.
- **Today a stale tab can still `send`:** `isStaleEditor` (`session.js`
  L201–206) refuses only `add` (L1370) and `remove` (L1638).
- **A stale tab can be the behaviour host.** The role goes on
  `scriptRunner === 3` alone (`canRunBehaviors` L598–600, the hello's
  election L874), and a released page sends `scriptRunner: 3, addFields: 3`
  (`AtriumClient.js` L830–832). The runner writes through `client.sendField`
  → `send` (`runner.js` L604–605, `AtriumClient.js` L1497).
- **Not judged:** a session that sends neither `scriptRunner` nor
  `addFields`, i.e. tests, the protocol inspector, cross-origin clients
  and **the SOM Inspector, which can edit** (`tools/som-inspector/src/app.js`
  L495).

### 2.4 The page after a parent change (g2, f3: the released page)
On the harness's `space.gltf` world, `crate-01` was moved into `lamp-01` in
the page (world placement kept, through `applyLocally`), then back.
- The drawn crate hangs under `lamp-01`'s `Object3D` and **doesn't move on
  screen**, both ways. The handles and outline stay on it.
- **The breadcrumb is not refreshed:** `selectForEdit` returns at once for the
  node already selected (`app.js` L2412). The path is computed from the
  ancestors (`selectionPath`, `renderPath` L2652), so a refresh is enough.
- A fresh click on the crate selects `lamp-01`. A double-click goes down to
  `crate-01` (breadcrumb `lamp-01 › crate-01`), and Escape goes back up.
- **A reparent during a handle drag makes the object jump** (f3, real
  mouse). Mid-drag, the crate was moved into `lamp-01` as another tab's
  change would arrive. On the next pixel of drag it jumped **3.009 m**
  (world 1.13 → 4.14). TransformControls keeps the drag's start in the old
  frame. The drag sent an old-frame translation and recorded "Move
  “crate-01”" with an old-frame "from".

### 2.5 What the client already has, and the gaps
- **A free name:** `isNameFree` (`app.js` L3005). **An empty node is a legal
  `add`** (`checkAddNode` returns `null`, both copies).
- **One socket keeps order** (no `await` in the add or send cases;
  `session.js` L717ff). **But a refused `add` doesn't make a following move
  fail.** The commonest refusal is "the name is taken" (`treeNameTaken`,
  `world.js` L591), and then a move naming that parent is **accepted into the
  other node of that name**. The palette and Paste already retry on that
  race (`app.js` L3382, L3454). A move into a new group must wait for the
  group's `add` to be accepted.
- **The Undo engine** (`edit-undo.js`) has `transform`, `rename`, `add` and
  `delete` entries over handles (W2).
  - **Several sends in flight:** a transform entry carries them (`bySeq`,
    L876), but `onStructureAnswer` completes an undo **as soon as its
    structural answer arrives** (L641), and `onAccepted` treats
    `field === null` as structural (L578). Entries that mix one structural
    request with sends need new accounting (GR7).
  - **A pending delete reads its parent once, at the click** (L475).
    `reCapture` (L510–526) and the removal window (`openRemovalWindow`,
    L488–507) refresh the descriptor and members, never the parent. **So a
    node moved by another tab while its delete is pending comes back in the
    wrong place** (f2: `crate-01` restored at world (−2, 0.25, 0) instead of
    (1, 0.25, 0); the same for a Redo after an Undo of a Duplicate).
  - A remove's `checkEntry` ignores the parent: an older Add entry still
    undoes after another tab moved the node into a group (f2 case C). This is
    right: the node is removed wherever it is.
  - The label "Move" is already the drag's (`FIELD_VERB.translation`, L73).
- **What blocks edits while a request is pending:** `reason()` (L677–687:
  rename, transform, structural), `structuralBlockReason`, `fieldsDisabled`,
  and `syncGizmoEnabled` (`app.js` L2253–2256: the gizmo is held for a
  pending rename or structural request only).
- **Duplicate's rule** (`duplicateRuleProblem` → `nodeRuleProblem`,
  `edit-duplicate.js` L586–602) refuses camera, light and skin hosts,
  animated nodes, `source` containers and nodes with extensions, whatever the
  counts.
- **A behaviour may write its own node and that node's descendants**
  (`isOwnOrDescendant`, `runner.js` L274–281), plus the targets its owner
  granted. So a parent change can widen or narrow what a behaviour may write,
  without the grant question (GR-L10).

### 2.6 Groups today
No user can make a group from an empty node today (the only growth is
Duplicate in place, above). PROD's 9 groups are seed content, 3 nodes each.
`atrium.gltf`'s largest is `Furniture`, with 9 children. SA-L2's bounds
(`SUBTREE_NODES_MAX` 256, `SUBTREE_DEPTH_MAX` 8, `SUBTREE_PRIMITIVES_MAX`
1,024, exported by `add-spec.js`) apply to one `add` message, with the root
as generation 0 (f1 agrees).

## 3. Decisions (for the operator)
Binding from earlier rounds: everything in `PREBRIEF-selection-parts.md` §3
and `PREBRIEF-subtree-add.md` §3.

**GR-L1. The controls.** The Edit panel selects one object at a time; Shift
multi-select is a separate candidate round. **Decided (operator, 2026-11-09): (a), as recommended.**
- **(a) Recommended: three controls for one selected object.** **Group**,
  **Ungroup** and **Move to…** (§1). Two objects end up together in two
  steps: Group the first, then Move the second into that group. A later
  multi-select round adds "Group selected" over the same edit.
- (b) Do Shift multi-select first, and make grouping "Group selected". It's
  the usual way, but it means two rounds before anyone can group anything,
  and the move edit is needed either way.
- (c) A pick gesture: "Move into…", then click the target in the viewport.
  It is a new gesture over the handles, which needs its own browser probe
  first (selection-parts lesson 1); the list in (a) needs none.

**GR-L2. The edit on the wire.** **Decided (operator, 2026-11-09: "no preference"): (a), as recommended.**
- **(a) Recommended: a `send` with `field: 'parent'` and
  `value: { parent, translation, rotation, scale }`.** `parent` is a name, or
  `null` for the top level. The vectors are the new local placement, which
  the client computes to keep the world placement. It is one message,
  applied atomically and broadcast as a `set`, and Undo sends the exact old
  values back (f1). The schema doesn't change (`send.value` is open).
- (b) `value` is only the parent's name; the **server** computes the local
  values. This is robust to a parent moving at the same moment, but needs
  the decomposition and the shear rule on the server, and Undo would get
  recomputed floats, not the old values (f1), so an older Move entry would
  read "changed elsewhere".
- (c) A new message type: a schema, a validator key, a direction, and
  nothing gained over (a).

**GR-L3. Unreloaded tabs** (§2.3). **Decided (operator, 2026-11-09): (a), as recommended.**
- **(a) Recommended: `addFields` 4. A tab below it may not edit (`send`
  included) and may not be the behaviour host.** The server refuses its
  `send` with the stale message, and gives it the host role in neither of
  the two places that decide the role. **The cost:** until it reloads, an
  old tab can't move, recolour or rename anything (today it can). **Stated
  limits:** an unreloaded SOM Inspector tab isn't judged (it declares
  neither capability), and an unreloaded visitor draws later moves of a
  regrouped object in the old frame until it reloads.
- (b) Keep today's rule (only `add` and `remove`). A stale tab's edit of a
  regrouped object then lands in the wrong frame, for every visitor, and is
  saved. A stale host's behaviour writes would do the same.
- (c) Refuse a stale tab's `send` only for nodes whose parent changed since it
  connected. This narrows the cost of (a), but needs per-session history on
  the server, and doesn't cover the host.

**GR-L4. What may move, and where.** **Decided (operator, 2026-11-09: "no preference"): (a), as recommended.**
- **(a) Recommended:**
  - **The object moved:** any node a `send` may edit today: not a live
    avatar, and not external content or inside it.
  - **The new parent:** `null`, or a node that:
    - is addressable by a non-empty name;
    - is not blocked (`isBlockedParent`);
    - is not the object or one of its descendants;
    - is not its current parent;
    - **does not carry a model**.

  Nothing needs a model as a parent (Group makes an empty node; a model can
  be *in* a group), and a model's node already holds its drawing.
- (b) As (a), but models may be parents too. One rule fewer, and untried.

**GR-L5. The bounds** (SA-L2 against created content). **Decided (operator, 2026-11-09: "no preference"): (a), as recommended.**
- **(a) Recommended: the server refuses a move or a parented `add` when,
  afterwards, the destination's top-level tree is past one of SA-L2's counts
  and the change made that count larger than it was.**
  - So a move within, or out of, an oversized seed group is never refused,
    and neither is its Undo.
  - A move to the top level is never refused by size.
  - The 1,000,000-byte cap stays the client's, as now: an oversized Delete
    asks first.
- (b) Only the panel refuses. A hand-made `send` or Duplicate could still
  build an oversized group.
- (c) No bounds. Such a group can't be copied, and its Delete asks first.

**GR-L6. What Group and Ungroup make.** **Decided (operator, 2026-11-09: "no preference"): (a), as recommended.**
- **(a) Recommended:**
  - **Group**, step by step:
    1. The new group goes into the object's parent, at the object's local
       translation, with no rotation and scale 1.
    2. **After the group's `add` is accepted,** the object moves in, at
       translation 0, keeping its rotation and scale. No maths, so it is exact
       and never a shear (f1). If the name was taken (a race), the palette's
       retry with the next free name applies.
    3. If the move is refused, the client removes the empty group it made,
       and nothing is recorded.
    4. One Undo step; the group ends up selected.
  - **Ungroup** is offered only for a group with nothing of its own:
    - It has parts and no mesh, model, behaviour, camera, light or
      teleporter.
    - It is not hidden (GR-L9).
    - Its `objectId` is not in any behaviour's granted targets.
    - Other `extras` go with it, and Undo brings them back.

    Each part moves to the group's parent, keeping its world placement.
    **Once every move is accepted,** the group is deleted. Ungroup is
    disabled, with the reason as its tooltip, if a part would need a shear.
- (b) Group places the new group at the world origin. The object's local
  values are then its world placement, with a shear refusal.
- (c) Ungroup any node with parts, keeping a node with its own mesh as an
  object. This gives "Ungroup" two meanings.

**GR-L7. Several messages, and the server stops halfway** (a race: another
tab of the owner changed something after this tab's check). **Decided (operator, 2026-11-09: "no preference"): (a), as recommended.**
- **(a) Recommended: whatever was accepted is the outcome, recorded as one
  entry; the panel names what didn't follow.**
  - **An Ungroup:** if a part's move is refused, the group stays, and the
    accepted moves are recorded as "Ungroup (partly)", undoable.
  - **An Undo or Redo:** the client checks every step before sending
    anything. If the server still refuses one, "Undo stopped: “X” changed
    elsewhere" names each part, and the entry leaves the stack. This is what
    "out of step" means today for one message.
- (b) Keep the entry and retry what is left on the next Undo. Each entry
  then needs a partial state, for a race between two tabs of one owner.

**GR-L8. A group emptied by Move to** (fresh check, missing decision 1).
Moving the last part out of a group leaves a node with no mesh and no parts:
nothing to click, not in Move to's list, so it can't be selected or deleted. **Decided (operator, 2026-11-09: "no preference"): (a), as recommended.**
- **(a) Recommended: delete it in the same step**, when it would have
  qualified for Ungroup (GR-L6 (a)). The Undo entry ("Move to") brings it
  back, then the part.
- (b) Leave it, and list empty groups in Move to so they can be refilled.
  They still can't be selected or deleted.
- (c) Leave it, and make empty nodes selectable (a list, or a marker in the
  viewport). This is a selection change for the whole app.

**GR-L9. Hidden groups** (fresh check, missing decision 2). three.js doesn't
draw a hidden node's children, so moving into or out of a hidden group hides
or shows the object, and Ungroup of a hidden group shows its parts, for
everyone. **Decided (operator, 2026-11-09: "no preference"): (a), as recommended.**
- **(a) Recommended: refuse any change of drawn visibility.** Group, Move to
  and Ungroup are disabled ("show the group first") when the object's drawn
  visibility would change: a hidden node on one side of the move and not the
  other, or a hidden group for Ungroup. This is the panel's rule only;
  visibility is presentation, and the server stores what it is sent.
- (b) Carry it over: set the moved object's own `visible` to match, as one
  more message in the step and the Undo.
- (c) Allow it, and let the object show or hide.

**GR-L10. Behaviours** (fresh check, missing decision 3). A behaviour may
write its own node and its descendants (§2.5), so a move into a scripted
node gives its behaviour the moved object without the grant question, and a
move out takes it away. **Open: the operator asked why (a) is recommended
(2026-11-09); answered in the session.**
- **(a) Recommended: refuse a move that changes which behaviours may write
  the object.** The set of behaviour-carrying ancestors of the moved object
  must be the same before and after. The server checks it (it holds the
  behaviour leaves) and the panel hides such targets. Group and Ungroup pass
  by construction: the group carries no behaviour. A node that carries its
  own behaviour may move. **Stated:** its behaviour's writes are local
  values, so after a Group they apply inside the group (a spin or a scale
  pulse looks the same, because Group keeps rotation and scale).
- (b) As (a), and also refuse moving any node whose subtree carries a
  behaviour. Safer, but a scripted object can never be grouped.
- (c) Allow it; the Enable grant question isn't asked.

## 4. The contract (written for the recommendations)

**GR1. The SOM: one way to move a node** (`packages/som/src/SOMDocument.js`).
`reparentNode(node, parent, { translation, rotation, scale })` checks, then
applies, atomically (on failure nothing changes), like `renameNode`:
- `node` is a live SOM node of this document; `parent` is `null` or one;
- `parent` is not `node` or one of its descendants (`INVALID_VALUE`, "a node
  can't go inside itself");
- `parent` is not the current parent (`INVALID_VALUE`, "already there");
- then it sets the three vectors **on the glTF-Transform node** and calls
  `(parent ?? scene)._node.addChild(node._node)` (through the scene's own
  wrapper for `null`).

It fires no SOM `mutation` events: through the `SOMNode` setters it would
fire four (f1). Server and client both call it.

**GR2. The value's shape** (`packages/server/src/send-policy.js`).
`authorizeNodeSend` allows `field === 'parent'` when `value` is a plain object
with exactly the keys `parent`, `translation`, `rotation` and `scale`:
- `parent` is `null` or a non-empty string of at most 256 characters;
- `translation` passes `isVec3`, `rotation` `isUnitQuaternion` and `scale`
  `isNonZeroScale`, with `send`'s own texts.

Anything else is `INVALID_VALUE`. A live avatar or external node is already
refused before this.

**GR3. The world checks and the apply** (`session.js`'s `send` case, as the
`add` path does at L1405–1411; `world.js`). For `field === 'parent'`, after
`authorizeSend`, in this order:
1. the parent, when named, must exist (`NODE_NOT_FOUND`);
2. it must not be blocked (`isBlockedParent`, `PERMISSION_DENIED`, "a node
   may not be moved under a live avatar or an externally loaded node");
3. it must not carry a model (`INVALID_VALUE`);
4. GR4's bounds must hold;
5. the behaviour rule (GR-L10 (a)) must hold: the same behaviour-carrying
   ancestors before and after (`INVALID_VALUE`, "this would change which
   behaviours can move it").

Then `world.setField`'s own `parent` branch calls `som.reparentNode`. The
broadcast `set` carries the value as received, and autosave is notified,
unchanged.

**GR4. The bounds** (GR-L5 (a)). `treeCounts(root)` (pure, `send-policy.js`)
returns the nodes, deepest generation below `root`, and primitives of a live
tree. For a move, the server compares the destination's top-level tree
before and after:
- "after" counts the moved subtree once (no double count for a move inside
  one tree), at its new depth;
- the move is refused only when a count is over its bound after **and** larger
  than before (`INVALID_VALUE`, "the group would be too large to copy");
- a move to the top level is skipped.

The `add` case runs the same rule when `parent` is given, with the added
tree as the moved subtree.

**GR5. Version skew** (GR-L3 (a)).
- `ADD_FIELDS_LEVEL` is 4 (`session.js` L186), and the client's hello sends
  `addFields: 4` (`AtriumClient.js` L831).
- `isStaleEditor` also refuses `send`, in the `send` case, before
  `authorizeSend`, with `STALE_CLIENT_MESSAGE`.
- `canRunBehaviors` and the hello's election also require
  `!isStaleEditor(capabilities)`.
- A level-4 page facing a level-3 server (a rollback) hides the Group row, as
  `treesAllowed()` hides group paths today.
- The hello schemas' `addFields` descriptions say 4.

**GR6. The client** (`packages/client/src/AtriumClient.js`).
- `moveNode(name, value)` sends the `send` and returns its seq, as
  `renameNode` does. **Nothing changes locally until the server accepts.**
- On its own echo, and on another session's `set` for `parent`, it applies
  `som.reparentNode` inside `applyLocally`, then emits, in this order:
  - `som:reparent { nodeName, from, to }` (parent names, `null` for the top
    level);
  - `som:set` with `path: 'parent'`;
  - **`som:set` for `translation`, `rotation` and `scale`**, so `app.js`'s
    existing `TRANSFORM_FIELDS` branch (L1061–1064) treats it as another
    session's transform change. That branch reaches `remoteSet`, the pads,
    the spawn note and the runner's overlay.
- A parent it can't find emits `som:desync` (`parent-not-found`), as `_onAdd`
  does; a refusal by `reparentNode` emits `som:desync` (`reparent-refused`).
- A move that didn't apply locally is reported, so Undo doesn't record it
  (as U15 does for a rename).

**GR7. Undo** (`apps/client/src/edit-undo.js`).
- **Entry kinds:**
  - **`move`** (label "Move to"): the node's handle, and `from` and `to`, each
    `{ parent: handle|null, translation, rotation, scale }`.
    - Undo checks, before sending `from`: the node is alive and
      addressable; its parent is `to.parent`; its vectors equal `to`'s
      exactly; `from.parent`, if any, is alive and addressable. Otherwise
      "changed elsewhere". Redo is the mirror.
    - With GR-L8 (a), the entry also holds the emptied group's capture:
      Undo re-adds it first, then moves the node back after the `add` is
      accepted.
  - **`group`:** the object's move and the group's descriptor.
    - Undo checks that the group's children are exactly [the object], and
      that the group's own capture without children equals the add's. Then
      it moves the object back, and **after that is accepted** removes the
      group.
    - Redo re-adds the group and, after acceptance, moves the object in.
  - **`ungroup`:** each part's move and the group's delete capture (empty).
    - Undo re-adds the group, then **after acceptance** moves each part back
      with its exact old values.
    - Redo moves them out, then deletes the group once every move is
      accepted.
- **Accounting:** one in-flight record per step, completing when every seq is
  answered.
  - A move's answer is routed by seq (as `requests` does for a rename), not
    by `field === null`.
  - Group's `add` and Ungroup's `delete` are marked so that `acceptAdd` and
    `acceptDelete` push no entry of their own.
  - GR-L7 (a) for refusals.
- **The pending-delete fix** (§2.5, f2): `reCapture` and the removal window
  re-read `parentHandle(node)` into `req.parent` and `req.entry.parent`.

**GR8. The panel** (`apps/client/index.html`, `app.js`, `edit-structure.js`,
a new pure module `apps/client/src/edit-group.js`).
- **The row** `#ep-group-actions` holds `#ep-group`, `#ep-ungroup` and a
  `#ep-move-to` select. It sits under `#ep-actions`, in Edit mode only. The
  select is width-capped as `#ep-anim-row select` is (index.html L554–559);
  its option values are indices, never names (a node may be called "Top
  level").
- **A move, a Group and an Ungroup are structural requests.** One at a time,
  each blocks everything a pending structural request blocks: the gizmo, the
  fields, Undo/Redo, Delete, Duplicate, Copy, Paste and the row itself, until
  answered.
- **Enable rules** join `structuralBlockReason`, each disabled control's
  reason as its tooltip. They include:
  - the object addressable (`getObjectByName(name) === node`);
  - for Group, its parent addressable by a non-empty name, and GR4's
    bounds;
  - for Ungroup, the group's parent and every part addressable;
  - GR-L9 and GR-L10.
- **`edit-group.js`**, pure, unit-tested on turned, scaled, mirrored and
  nested groups (selection-parts lesson 3). It holds:
  - `inverseAffine`;
  - `moveValue(node, newParent)`: `inverse(world(newParent)) × world(node)`,
    decomposed, or a shear refusal;
  - `groupPlan(node, { isFree })`;
  - `ungroupPlan(group)`;
  - `moveTargets(node, som, rules)`: the groups (nodes that have parts)
    the object may go into, sorted, each with its breadcrumb text, then
    "Top level" for a part. Targets that would shear, or that GR-L4, GR4,
    GR-L9 or GR-L10 refuse, are **left out**. A line under the select says
    how many were left out for a shear, so the list isn't silently short.
- **On `som:reparent`:**
  - a handle drag or open gesture on that node ends (`endHandleDrag`,
    the tracker's cancel), as for another session's transform (f3);
  - the panel and both breadcrumb rows refresh, and `attachSelected` runs
    (§2.4).
- **The SOM Inspector's tree** rebuilds on `som:reparent`
  (`tools/som-inspector/src/app.js`).
- **Selection afterwards:** after Group, the new group. After Ungroup, the
  first part. After Move to, the moved object, with its new breadcrumb.
- **Nit taken:** a pending delete of a group that another tab grew no longer
  reports the newcomer as "removed elsewhere" (`removalSeen` checks
  membership at the answer, `edit-structure.js` L96–101).

## 5. Tests and proofs
**Every new test must fail on `172b816d` first** (or be named a guard that
can't, with the reason). Server test files run one at a time under
`timeout 180`, new servers on port 0.
- **SOM:** `reparentNode`:
  - into a group, to the top level, and between groups;
  - the cycle (self, child, grandchild);
  - "already there";
  - the vectors exact;
  - no mutation events;
  - node order unchanged.
- **Server** (`packages/server/test/grouping.test.js`, new):
  - **GR2:** each malformed value.
  - **GR3:** each refusal in order; a behaviour-carrying ancestor gained,
    and one lost.
  - **GR4:**
    - each count just past the bound refused, and at it accepted;
    - a move inside an oversized seed group, and its Undo, accepted;
    - a move to the top level of an oversized part accepted;
    - a Duplicate-in-place `add` past the bound refused.
  - **Broadcast and save:** the broadcast `set` to two other sessions; a
    save and reload.
  - **GR5:**
    - a level-3 session's `send` refused;
    - a level-3 session never given the host role (at the hello, and after
      the host leaves);
    - a session with neither capability still allowed.
- **Existing hellos to update** (the bump makes them stale; fresh check):
  - `packages/server/test/world-total.test.js` L83, `copy-objects.test.js`
    L85, `behavior-leaf.test.js` L328, `richer-add.test.js`, and
    `subtree-add.test.js` L613–652 (it asserts 3);
  - `behavior-walk.test.js` (`scriptRunner` without `addFields`, and a
    `send`);
  - `packages/client/tests/richer-add-lifecycle.test.js` L134,
    `activate.test.js` L141–145 and `subtree-add-hello.test.js`.

  A grep for `addFields` and `scriptRunner` under every `test`/`tests`
  directory is the commit's first step.
- **Client:** `moveNode` sends and changes nothing until the echo; the own
  echo and a remote `set` apply and emit, in order, `som:reparent`,
  `som:set` for `parent`, then the three transform `som:set`s; a missing
  parent desyncs.
- **`edit-group.js`:**
  - every plan on a group turned 90° about y, scaled 2, translated and nested
    two deep, with the world placement kept to 1e-9;
  - a mirrored ancestor;
  - a shear refused in both directions;
  - `moveTargets`' exclusions.
- **`edit-undo.js`:**
  - `move`, `group` and `ungroup` undo and redo, with the exact values
    restored;
  - an older Move entry before a Group still undoes after the Group's undo;
  - a race refusal drops the entry and names the part;
  - "Ungroup (partly)";
  - **f2's cases A and B** (a delete, and an Undo of a Duplicate, pending
    while another tab moves the node): restored in the right place.
- **Wiring:** the row's enable rules; a pending move blocks the gizmo and the
  fields; `som:reparent` ends a drag and refreshes (lift the page's own
  handlers, subtree-add lesson 1).
- **Harness** (`devtasks/harness/checks/grouping/`, real mouse):
  - Group, Move to, Ungroup, and Undo and Redo of each, in two tabs, on
    `group.gltf`'s rotated group;
  - **f3 as a check:** no jump when another tab regroups the dragged object.

  Each asserts the selection, the world positions, the drawn parent, the
  server's copy (`/__doc`) and the Undo stack (selection-parts lesson 2).
- **Proofs** (the handoff records each): breaking any one of these turns its
  test red:
  - the cycle check, the bounds, the behaviour rule;
  - the stale `send` refusal, the stale host refusal;
  - the exact Undo values, the parent re-read;
  - the wait for the group's `add`;
  - the drag's end, the breadcrumb refresh.

**DEV acceptance (operator), each step naming the control and what happens:**
1. Hard reload. Select a cube. Press **Group**. The cube doesn't move; the
   panel selects `group-01`; the breadcrumb is empty (top level).
2. Select another cube. In **Move to…** pick `group-01`. It doesn't move.
   Click it: `group-01` is selected (both cubes outlined as one). Double-click
   it: the cube is selected, and the breadcrumb reads `group-01 › <cube>`.
3. With the group selected, drag the move handle a few centimetres on
   screen: both cubes move together.
4. **Undo** three times: the drag, then the Move to, then the Group, each back
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
  - `packages/protocol/src/schemas/hello.client.json`, `hello.server.json`
    (the `addFields` descriptions only);
  - `packages/client/src/AtriumClient.js`;
  - `apps/client/src/edit-group.js` (new), `edit-undo.js`,
    `edit-structure.js`, `app.js`;
  - `apps/client/index.html`;
  - `tools/som-inspector/src/app.js`;
  - `devtasks/harness/checks/grouping/`;
  - test files under `packages/*/test/`, `packages/*/tests/` and
    `apps/client/tests/`, including §5's existing hellos.

  **No other file.** If one must change, stop and ask.
- **Commits, each runnable:**
  1. GR1 and its tests;
  2. GR2–GR5, the server tests and the existing hellos;
  3. GR6 and the client tests;
  4. `edit-group.js` and its tests, GR7 and its tests;
  5. GR8's glue and the wiring tests;
  6. the full suites, the proofs, the harness checks and the handoff.
- **Release:**
  - A server and client round. DEV restarts at the deploy, and **every open
    tab must reload** (GR5).
  - No stored data changes shape (a moved node is an ordinary node under its
    parent). No `package.json` or lockfile change, and no `p6` run is
    needed.
  - **A rollback** to `331e4aed` loads every world as saved, and the old
    server refuses `parent` again.
  - **The release notes name:** the stale-tab change (no edits, no host),
    the stated limits (GR-L3), and the pending-delete fix (f2).
- **Never push to `main` between the release merge and PROD `COMPLETE`.**

## 7. Review log
- **Rev 0.3** (2026-11-09): the operator's decisions (status line). GR-L10
  open.
- **Rev 0.2** (2026-11-09): **the fresh-agent check of Rev 0.1.** Claude
  reproduced before taking: f1, f2 (cases A and B, 3 m off), f3 (the 3.009 m
  jump, in the browser), and in the source the stale host (`session.js`
  L598–600, L874; `runner.js` L604–605), the name race (`world.js` L591;
  `app.js` L3382) and `isOwnOrDescendant` (`runner.js` L274–281).
  - **Facts corrected:**
    - §2.5: a refused `add` doesn't make the next move fail;
    - §2.6: Duplicate in place already grows groups;
    - §2.2: a 4×4 inverse is needed, and shears are common;
    - §2.3: the SOM Inspector edits and isn't judged;
    - two line numbers (`dispatch` L846, `model-bridge.js` L798).
  - **Must-fix, all taken:**
    1. the pending delete's parent (GR7's last item; f2 as tests);
    2. the stale host (GR5);
    3. Group's move waits for the `add` (GR-L6 (a), GR7);
    4. a pending move blocks like a structural request (GR8).
  - **Should-fix, all taken:**
    1. the drag's end and the transform `som:set`s (GR6, GR8);
    2. the bounds' promise narrowed, and the `add` path bounded too (§1,
       GR-L5, GR4);
    3. GR4's rule reworded (no double count, "and larger");
    4. the world checks moved to `session.js` (GR3);
    5. GR7's accounting and Group's undo check;
    6. the existing hellos listed (§5);
    7. shearing targets left out, and counted (GR8);
    8. the label "Move to";
    9. the addressability rules (GR8).
  - **Nits, all taken:** GR1 sets on the glTF-Transform node; `inverseAffine`;
    `removalSeen`; the select's width and option values; the hello schema
    descriptions (now in §6's files); unreloaded visitors named as a limit.
  - **Missing decisions:**
    - three new ones: GR-L8 (emptied groups), GR-L9 (hidden groups),
      GR-L10 (behaviours);
    - a partly refused Ungroup, folded into GR-L7;
    - the definition of an empty group, folded into GR-L6 (a).
- **Rev 0.1** (2026-11-09): the first draft, from g1, g2 and g3.

## 8. Follow-ups this file records
- Multi-select (Shift-click) and "Group selected", over GR2's edit.
- Child order inside a group: a move appends (`addChild`), and Undo puts a
  part back last among its siblings, not at its old index (as a part's re-add
  does today). Nothing reads the order yet.
- Models as parents (GR-L4 (b)), if a use appears.
- Duplicate's rule refusals inside groups (§1: a camera host makes its group
  uncopyable), whatever the counts.
- Making the SOM Inspector declare its level, so an unreloaded Inspector is
  judged too.
