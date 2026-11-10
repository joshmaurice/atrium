# Pre-brief: grouping and ungrouping (`grouping`)

Status: **FINAL, Revision 2.0 (2026-11-10).** The operator approved Rev 1.4
as FINAL by voice ("Yes, I do"), and confirmed it in text at 00:05 PT ("Go
ahead, please"). Rev 2.0 is Rev 1.4 unchanged but for this line and §7.
**This is the contract for the implementation.**

Rev 1.4 (2026-11-09) took every decision.
Rev 1.4 records GR-L12 (a), refuse a stale tab's hello (the operator, by
voice, 23:59 PT). Earlier: **Revision 1.3**, Rev 1.2 plus **a second
outside review**, of `95d7a096` (§7), by the same Claude Fable 5.2 session per
its first lines. Its verdict was CHANGES REQUESTED, with 2 must-fix, 5
should-fix and 6 nits. Claude reproduced every finding (`review2/r7`–`r9`,
`r9` in the browser) or checked it at the cited lines before taking it.
That review's M2 reopened GR-L12: the decided (a) protected only the stale
tabs connected at one moment.

Earlier: Rev 1.0 plus the outside review of `34917de8`, by Claude Fable 5.2
per its own first lines. Its verdict was CHANGES REQUESTED, with 2 must-fix,
9 should-fix and 7 nits; Claude reproduced every finding before taking it.

The operator's decisions (2026-11-09):
- **GR-L1 (a)**, **GR-L3 (a)** and **GR-L10 (a)** (20:24 PT, "go with recs",
  after asking why (a));
- GR-L2, GR-L4 to GR-L7 and GR-L9 as recommended ("no preference");
  GR-L12 (a) too, until the second review reopened it;
- **GR-L12 (a), Rev 1.3's: refuse the hello of a judged stale session**
  (23:59 PT). The operator agreed by voice ("Sure"), saying it hardly
  matters, because the account log shows no users yet, so the easiest real
  fix should win. A hello refusal is one check, with nothing to keep track
  of, and was tried on the released page (g5);
- **GR-L8 and GR-L11: (c), keep empty groups** (22:31 PT). The operator asked
  whether someone might want to empty a group for a while and refill it
  later, which rules out deleting a group because it is empty. Empty groups
  stay, are listed in Move to, and are reached by an **Empty groups**
  dropdown. A real-browser probe of the released page
  (`checks/grouping/g4.py`, 10 checks, all PASS; Rev 1.2 said 9, second
  review N6) showed the panel already holds a bare node as its selection.

§4 is the contract for every decision.
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
    passdown): **13 checks, all PASS** on the harness at `172b816d` (Rev
    1.0 said 17; review N7).

  **A fresh Claude agent then checked Rev 0.1** (§7). It checked 26 facts:
  20 confirmed, 2 wrong, 2 imprecise, 2 line numbers off by one. It wrote
  three probes in `devtasks/spike-grouping/fresh/`, and Claude reran all
  three: `f1` (a GR1 prototype, the move value, the bounds), `f2` (the real
  Undo engine) and `f3` (real mouse, on the harness).
  **The outside review** (Claude Fable 5.2, from a clone, of `34917de8`)
  wrote six probes, now in `devtasks/spike-grouping/review/`. Claude reran
  all six at `172b816d`'s code with the same output: `r1` (GR4 and its
  Undo), `r2` (an unreloaded tab), `r3` (a transform in flight), `r4` (a
  mirrored scale), `r5` (older entries after an Ungroup's Undo) and `r6`
  (an animated node, in the browser).
- **Not yet done:** no suite was run (nothing has changed).

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
  - **Move to…:** a list of the groups the selected object can go into
    (empty ones too), plus **Top level** for a part. The object keeps its
    place in the world.
- **An Empty groups dropdown** (GR-L8/GR-L11 (c)), among the panel's
  world-level rows, shown only when the world has an empty group. Choosing
  one selects it. A group emptied by Move to, Delete or anything else stays,
  can be refilled with Move to, and is deleted only when its owner deletes it.
- **One new edit on the wire** (GR-L2 (a)): a `send` whose `field` is
  `parent`. Its value names the new parent (or `null` for the top level) and
  carries the local placement that keeps the object where it is. The server
  applies it atomically and broadcasts it as a `set`.
- **Undo and Redo** for all three, one step each (GR7). The entry labels are
  "Group", "Ungroup" and "Move to".
- **Groups stay inside SA-L2's counts** (GR-L5 (a)): 256 nodes, 8
  generations, 1,024 primitives. The server refuses a move **or an add**
  (Duplicate in place, a part's re-add) that would take a top-level group
  past a count **it is not already past**. A tree that is already past one
  may still grow. **An action whose Undo that rule would refuse asks first,**
  as a Delete that can't be restored does today (GR4, review M1).
  **Counts aren't everything:** a group holding something Duplicate refuses
  (a camera, light or skin host, an animated node, external content) still
  can't be copied, as today.
- **An unreloaded tab can no longer edit, or be the behaviour host,** once
  this ships (GR-L3 (a)). It can't apply a parent change (§2.3): its edits
  would land in the wrong place, and an Ungroup elsewhere would remove the
  parts from its view (review S1). **The server refuses its hello** (GR-L12
  (a), Rev 1.3): the page says "Connect failed: PERMISSION_DENIED: this page is older than the server: reload it"
  (g5, the released page), and a reload brings the new page.
- **Objects something else moves in local values aren't regrouped:** a node
  an animation channel or a skin targets can't be grouped, moved or
  ungrouped this round (review S3).

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
  `_resolveOwnSetEcho` L1820ff, and a remote rename at L1771–1793.

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
- **An Ungroup removes the parts from a stale tab's view** (review r2, the
  released `AtriumClient`). Each `parent` set throws; then the group's
  `remove` takes the parts with it. Both cubes are gone from its SOM while the
  server holds both. A Node process with an older client gets an unhandled
  rejection, which ends it by default.
- **A stale tab can be the behaviour host.** The role goes on
  `scriptRunner === 3` alone (`canRunBehaviors` L598–600, the hello's
  election L874), and a released page sends `scriptRunner: 3, addFields: 3`
  (`AtriumClient.js` L830–832). The runner writes through `client.sendField`
  → `send` (`runner.js` L604–605, `AtriumClient.js` L1497).
- **A `source` container passes `isBlockedParent`**: that rule knows the
  names of the nodes loaded into a container, not the container itself, and
  in a document world the set is empty (clients load external content). On
  the client a container is atomic (`edit-selection.js` L49–58), so an
  object moved into one couldn't be selected again (review S7).
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
- **A transform already in flight lands in the new frame** (review r3, the
  real tracker). Tab A commits `crate-01`'s translation (1.5, 0.25, 0); tab
  B's move into `lamp-01` reaches the server first; the server applies A's
  local value under `lamp-01`, and every tab and the saved world end with
  the crate at world (4.5, 0.25, 0). Ending the drag (f3) can't cover a send
  made before the reparent.
- **The panel holds a bare node as its selection** (g4, real mouse, 10 checks, all PASS).
  A node with no mesh and no parts, made by a real `add`, selected through
  `selectForEdit`, gets the handles at its origin and its name in the Name
  field. A real-mouse drag of its X handle moves it, and the server saves
  it. Delete removes it, and Undo brings it back. Nothing is outlined
  (there is nothing to draw).
- **An animation plays in local values** (review r6, in the browser).
  `space-anim.gltf`'s clip `CrateBob` writes `crate-01`'s translation around
  (1, 0.25, 0). After a Group as GR-L6 (a) makes it (the group at that
  spot, the crate at 0), the crate rests in the right place, but the
  playing clip draws it at x = 2.

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
  animated nodes (`referenced`: any parent that isn't the scene graph, such
  as an animation channel or a skin), `source` containers, morph weights,
  extensions, a non-unit rotation and `extras.atrium` values the add rules
  refuse, whatever the counts. **The Delete capture is the same rule**
  (`capture`, `edit-undo.js` L420–440), so a group's Undo-able delete needs
  it to pass.
- **The panel clamps every scale component to at least 0.01**
  (`MIN_SCALE`, `sanitizeTransform`, `edit-gesture.js` L83, L99). A move into
  a mirrored group gives a local scale like (−1, 0.5, 2) (f1). The next
  scale edit then sends (0.01, …), and the Move to entry's exact check fails
  (review r4). A group scaled above 100 gives a positive component under
  0.01, with the same result.
- **A pending delete still points at the group's old node after an Ungroup's
  Undo** (review r5, the real engine, one tab, no race). The sequence:
  Delete `lamp-shade`; Ungroup `lamp-01`; Undo; Undo. The Delete's Undo then
  says "its group was replaced elsewhere", and the entry is dropped. Only
  `completeAccepted`'s re-add branch (L793–816) points a handle at a
  re-added node, and only the entry's own `handle`.
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
  neither capability). An unreloaded page that isn't judged draws later
  moves of a regrouped object in the old frame, and **loses an ungrouped
  group's parts from its view**, until it reloads (r2). Judged tabs never get
  that far: GR-L12 (a) refuses their hello.
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
- **(a) Recommended: the server refuses a move or a parented `add` that
  would take the destination's top-level tree past one of SA-L2's counts
  that it is not already past** (Rev 1.1, review M1: one rule, §1's
  wording).
  - A tree already past a count may grow, so Delete → Undo inside an
    oversized seed group keeps working, and so does a move within it.
  - A move to the top level is never refused by size.
  - **Its Undo isn't always possible:** a move out of a 257-node group leaves
    256, and moving back would pass the bound (r1). **Every action whose Undo
    the rule would refuse asks first** ("this can't be undone: the group
    would be too large to copy"), as an unrestorable Delete does. This
    covers a Move to out of, or a Delete in, a tree **just over** a bound
    (257 nodes, r1; a Delete in a 256-node tree undoes), and an Ungroup of a
    group over one. GR7 runs the same check before any
    multi-step Undo, so a predictable refusal never starts one.
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
       and nothing is recorded. This continuation doesn't depend on Edit
       mode staying on (review N5): the palette's retry checks `modes.edit`
       (`app.js` L3453), and Group's must not, or the group stays empty.
    4. One Undo step; the group ends up selected.
  - **Ungroup** is offered only for a group with nothing of its own:
    - It has parts and no mesh, model, behaviour or teleporter.
    - **The node alone passes the Delete capture's own rule** (review S5).
      That rule is `nodeRuleProblem`, private today (`edit-duplicate.js`
      L584); this round exports it as `ownNodeProblem(node)`. It refuses
      camera, light and skin hosts, animated nodes, `source` containers,
      extensions and the rest, and its reason is the tooltip. No existing
      call judges "the capture without its children": `prepareRestore`
      refuses any node with children when `trees: false` (L631), and with
      `trees: true` it judges every member (L644–647). So this needs the
      export (second review S3).
    - It is not hidden (GR-L9).
    - Its `objectId` is not in any behaviour's granted targets.
    - Other `extras` go with it, and Undo brings them back.

    Each part moves to the group's parent, keeping its world placement.
    **Once every move is accepted,** the group is deleted, through the
    existing capture window (GR7). Ungroup is disabled, with the reason as
    its tooltip, if a part would need a shear or a scale component under
    0.01 (GR8), or is targeted by an animation or a skin.
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
nothing to click, not in Move to's list, so it can't be selected or deleted.
**Decided (operator, 2026-11-09, 22:31 PT): (c) as amended below, replacing
the earlier "no preference" (a).** The operator asked whether someone might
want to empty a group for a while and refill it later, which (a) rules out.
- **(a) Recommended: delete it in the same step**, when it would have
  qualified for Ungroup (GR-L6 (a)). The Undo entry ("Move to") brings it
  back, then the part. GR-L11 extends this to the other paths.
- (b) Leave it, and list empty groups in Move to so they can be refilled.
  They still can't be selected or deleted.
- **(c) as decided: leave it; list empty groups in Move to; and add an Empty
  groups dropdown** among the panel's world-level rows (GR8). Choosing one
  selects it, with the handles at its origin and no outline (g4). Then it
  can be renamed, moved, moved into another group, refilled, or deleted.
  Nothing deletes a group because it is empty.

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
move out takes it away. **Decided (operator, 2026-11-09, 20:24 PT): (a), as
recommended**, after asking why. The answer given: Group and Ungroup never
trip it, and a scripted object can still be grouped. The price is that
nothing can be put into a scripted group on purpose this round (§8).
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

**Stated (Rev 1.1, review S3, N3):**
- "Behaviour-carrying" means "has the leaf, enabled or not".
- A parented `add` under a scripted ancestor isn't covered, so the server's
  rule is a courtesy to the panel and not a boundary.
- A custom graph may write `translation`, `rotation` or `scale`
  (`behavior-spec.js` L199). After a Group, a translation write lands
  relative to the group. After a Move to into a turned or scaled group, so
  do all three. The five templates write none of them.

**GR-L11. Groups left empty by other paths** (review S6; new in Rev 1.1).
GR-L8 covers a Move to of the last part, but a group can be left with no
parts in other ways:
- **upward:** Group a cube, Group `group-01`, then Move the cube to the top
  level, and `group-02` is left empty;
- **Delete** of a group's last part, possible today and ordinary once users
  make groups;
- **a composite that stops halfway:** for example a disconnect between
  Group's `add` and its move.

Each leaves a node nothing can click, whose name stays taken. **Decided
(operator, 2026-11-09, 22:31 PT): (c), with GR-L8 (c)'s dropdown.** Every
path's empty group is reached the same way, including the disconnect
mid-composite, so no path needs its own rule and Delete is unchanged.
- (a) One rule. Whenever an Edit-panel action leaves a
  group with no parts that would qualify for Ungroup, the same step also
  deletes it, and then any ancestor it leaves empty in turn. One Undo brings
  them all back. **That includes Delete** (a change: deleting a group's last
  part now also removes the emptied group, inside the Delete's Undo). A
  composite that re-added a group and ends with it empty removes it. **Stated
  limit:** a disconnect mid-composite still leaves an empty group, with no
  way to reach it in the viewport (§8).
- (b) GR-L8 only (a Move to of the last part), and the other paths leave
  empty groups, as Delete does today.
- **(c) as decided:** a way to reach empty groups (GR-L8 (c)). It is new
  panel surface, but it covers the disconnect too.

**GR-L12. Unreloaded tabs that lose objects** (review S1; new in Rev 1.1;
**reopened in Rev 1.3** by the second review's M2). **Decided (operator,
2026-11-09, 23:59 PT, by voice): (a), refuse the hello.** An Ungroup elsewhere
removes the parts from an unreloaded tab's view (§2.3, r2).
- **What the second review found in Rev 1.2's (a)** ("close every judged
  stale session when the server *first* broadcasts a `parent` change"):
  - **"First" misses the ordinary case.** The deploy restarts the server and
    disconnects every old tab; the page doesn't reconnect by itself (`app.js`
    L934–958). So a stale session exists only because someone pressed
    Connect in an old tab, usually *after* that first broadcast, and it was
    never closed.
  - **A close tells the tab nothing.** After `session:ready` the released
    page shows a server `error` for three codes only (`app.js` L962–989), and
    no close reason: the user sees "disconnected" and a Connect button that
    reconnects the same stale page.
  - **A hello refusal is shown.** The server already refuses a hello with an
    `error` and a close (`WORLD_FULL`, `session.js` L779–782). The released
    page shows it as "Connect failed: " plus the code and the server's text
    (`app.js` L1436–1450). **Checked in the browser** (`checks/grouping/g5.py`,
    3 PASS: a WebSocket route answering the hello as GR5 would): the released
    page shows "Connect failed: PERMISSION_DENIED: this page is older than the server: reload it", and its button goes back to Connect.
- **(a) Recommended (Rev 1.3): refuse the hello of a judged stale session**,
  with the stale message ("this page is older than the server: reload it").
  Every stale page passes through a hello after the deploy, so this reaches
  all of them, says why, and needs no bookkeeping. **The cost goes further
  than GR-L3 (a): an unreloaded tab can't even watch** until it reloads.
  Reloading is one key, and the message says so. GR5's refusals of `send`
  and of the host role then never meet a judged session, but stay as the
  second layer (selection-parts lesson 5).
- (b) Keep the close, but **at every `parent` broadcast**, before the `set`
  goes out, with a test for a stale session that joins after the first one.
  An old tab can still watch until the first regroup. It still shows no
  reason: "disconnected", and Connect brings back the stale page.
- (c) Only name it in GR-L3's limits and the release notes. A visitor's
  view stays wrong until reload; the world itself is safe.

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
   may not be moved under a live avatar or an externally loaded node").
   **It also must not carry, or be under a node that carries, an own
   `extras.atrium.source`** (review S7: `isBlockedParent` doesn't know the
   container itself);
3. it must not carry a model (`INVALID_VALUE`);
4. **GR1's cycle and "already there" checks**, run here before any count,
   so GR4 never walks an "after" tree with a cycle (review N1);
5. GR4's bounds must hold;
6. the behaviour rule (GR-L10 (a)) must hold: the same behaviour-carrying
   ancestors before and after (`INVALID_VALUE`, "this would change which
   behaviours can move it").

Then `world.setField`'s own `parent` branch calls `som.reparentNode` **on the
node object `authorizeSend` judged**, as a rename does (R3, review N6). The
broadcast `set` carries the value as received, and autosave is notified,
unchanged.

**GR4. The bounds** (GR-L5 (a)). `treeCounts(root)` (pure, `send-policy.js`)
returns the nodes, deepest generation below `root`, and primitives of a live
tree. For a move, the server compares the destination's top-level tree
before and after:
- "after" counts the moved subtree once (no double count for a move inside
  one tree), at its new depth;
- the move is refused only when a count is **over its bound after and not
  over it before** (`INVALID_VALUE`, "the group would be too large to copy").
  A tree already over may grow (GR-L5 (a), review M1);
- a move to the top level is skipped.

The `add` case runs the same rule when `parent` is given, with the added
tree as the moved subtree.

**What is counted** (review S7): the nodes the server holds, **except nodes
under a `source` container** (the container itself counts as one node). In a
file world the server holds a container's loaded nodes and the client always
does, so both sides skip them, and GR8's pre-check agrees with the server.

**`treeCounts` has two copies, as the bounds do** (second review S3). The
server's is in `send-policy.js`, beside its `SUBTREE_*` (L2041). The client's
is in `packages/client/src/add-spec.js`, beside its own (L34), where
`edit-group.js` imports it. A test holds the two copies to the same answers
on the same trees, as for `checkAddNode`. The panel uses the client's copy to
ask first before any action whose Undo the rule would refuse (GR-L5 (a)).

**GR5. Version skew** (GR-L3 (a)).
- `ADD_FIELDS_LEVEL` is 4 (`session.js` L186), and the client's hello sends
  `addFields: 4` (`AtriumClient.js` L831).
- `isStaleEditor` also refuses `send`, in the `send` case, before
  `authorizeSend`, with `STALE_CLIENT_MESSAGE`.
- `canRunBehaviors` and the hello's election also require
  `!isStaleEditor(capabilities)`.
- **GR-L12 (a):** the `hello` case refuses a session that `isStaleEditor`
  judges, before it joins: `sendError(ws, null, 'PERMISSION_DENIED',
  STALE_HELLO_MESSAGE)` and `ws.close()`, as `WORLD_FULL` does
  (`session.js` L779–782). `STALE_HELLO_MESSAGE` is "this page is older
  than the server: reload it". **An existing code, so the schema's `code`
  enum (`error.json` L11) doesn't change** (Agent rule 1). The released page
  shows "Connect failed: PERMISSION_DENIED: this page is older than the server: reload it" (g5).
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
    existing `TRANSFORM_FIELDS` branch (L1060–1064) treats it as another
    session's transform change. That branch reaches `remoteSet`, the pads,
    the spawn note and the runner's overlay.
- A parent it can't find emits `som:desync` (`parent-not-found`), as `_onAdd`
  does. **So does a `parent` set for a node it can't find** (review N4). A
  refusal by `reparentNode` emits `som:desync` (`reparent-refused`).
- **A move that lands in another node of the parent's name** (a race) is
  reported: the entry's `to.parent` is read from the node after the apply,
  as N-4 does for adds (review N4).
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
    - Nothing is deleted with a move (GR-L8 (c)), so `from.parent` is
      still there to check.
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
- **Every re-add inside a composite points the group's handle at the new
  node** (review M2, r5): Undo of `ungroup` and Redo of `group`. This is what `completeAccepted` does
  for `entry.handle` (L793–816), so older entries that point at the group
  keep working. Those are a Delete of a part, a Move to into or out of it,
  a transform or Rename of the group, and a Rename after Undo and Redo of
  its Group.
- **The group's delete goes through the existing capture window**, in
  Ungroup (`registerDelete`, with the parent re-read), **and the `group`
  entry's Undo removes the group through `openRemovalWindow`**, as an `add`
  entry's Undo does (second review N5).
  So a node another tab moves into the group, or a move of the group itself,
  between this tab's check and its `remove` is neither lost nor restored in
  the wrong place (review M2).
- **The checks before sending include GR4** (review M1): a step the bounds
  rule would refuse is not started. An action the panel asked first about
  (GR-L5 (a)) is **not recorded, and Redo is cleared**, as an unrestorable
  Delete (W5, L556). Older entries for that node then read "changed
  elsewhere" when reached, which the existing checks already do (second
  review S2).
- **Accounting:** one in-flight record per step, completing when every seq is
  answered. The composites have phases (the `add`, then the moves; the moves,
  then the `remove`). A move's seq gets a non-null marker in `bySeq`
  (L577–578).
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
- **The Empty groups dropdown** `#ep-empty-groups` (GR-L8/GR-L11 (c)) sits
  in a row of its own beside `#ep-sky-row`, among the world-level rows and
  not the selected object's fields. It is in Edit mode only, and **hidden
  when the world has none**.
  - Its label is "Empty groups (N)". Each option shows a group's breadcrumb
    text, so a nested empty group reads `lamp-01 › group-02`.
  - Choosing one calls `selectForEdit` on that node, as a click would
    (g4), then puts the select back to its label: it picks, it holds no
    state.
  - **What it lists, stated once** (second review M1, r9 in the browser):
    the nodes the viewport can't reach, `isBareNode(node)` (`edit-group.js`).
    A node is bare when it has no parts (no children), no mesh and no
    model. That is, nothing is drawn for a click to land on. It is listed
    when it is bare **and** all of these hold:
    - it is not a live avatar or under one (r9: this tab's own
      client-only `avatar-<id>-camera` would otherwise show "Empty groups
      (1)" in every world);
    - it is not a `source` container or under one (r9: `space-ext.gltf`'s
      `Crate` and `Light`);
    - it is addressable by a non-empty name (`getObjectByName(name) ===
      node`).

    **A behaviour, a light, a camera or a teleporter on a bare node doesn't
    take it off the list.** It still can't be clicked (r9: a bare node given
    a behaviour through the panel's form fell off Rev 1.2's list, and a
    click where it stood selected `ground-plane`). Ungroup, GR-L9 and
    GR-L10 keep their own rules; this list's only job is reach.
  - **Its key** is the list of bare nodes' names, recomputed (a cheap scan,
    no matrices) on structural events and on any `som:set` that can change
    bareness (a mesh, a model or a node's `extras`). The DOM is rebuilt only
    when the key changes (second review N4). Its `change` handler resolves
    the option to its node object and checks it again.
  - **Stated** (second review N3): between Group's `add` and its move, the
    new group is bare for one round trip, so "Empty groups (1)" can flash in
    other tabs. The same holds at the Undo of an Ungroup and the Redo of a
    Group. This tab hides a node its own pending request made.
- **When the list is built** (review S8): when the select opens, or when its
  key changes (the selected node, and the world's structure), as the sky
  select (R4) does. Never on every `som:set`: a running behaviour produces
  those constantly, and `moveTargets` is too heavy. The node objects are kept
  beside the options. The `change` handler resolves the chosen option to its
  node object and checks it again before sending.
- **The behaviour hold** (review S2; second review S4).
  `createBehaviorHold` holds one node, and the runner's test covers that
  node, its descendants and its ancestors (`edit-gesture.js` L146–167,
  `runner.js` L432–439). While a request is pending, `app.js` holds:
  - Move to: the moved node;
  - Group and its Redo: the object;
  - Ungroup and its Redo: the group, which covers every part;
  - the Undo of Move to: the moved node;
  - the Undo of an Ungroup: the group's parent. **At the top level nothing
    is held.** The parts aren't held for that one round trip (stated): the
    hold takes one node.

  **The request's own answer releases the hold.** The tracker's idle
  (`app.js` L1887), which releases it today, never fires for a move.
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
  - GR-L9 and GR-L10;
  - **not a node an animation channel or a skin targets** (review S3, r6),
    for the object moved, and for every part of an Ungroup. This is
    `nodeRuleProblem`'s `referenced` test (`edit-duplicate.js` L587),
    exported on its own (§6);
    Reason: "an animation moves it in local values";
  - GR-L5 (a)'s ask-first when the Undo would be refused.
- **`edit-group.js`**, pure, unit-tested on turned, scaled, mirrored and
  nested groups (selection-parts lesson 3). It holds:
  - `inverseAffine`;
  - `moveValue(node, newParent)`: `inverse(world(newParent)) × world(node)`,
    decomposed, or a refusal: a shear, or **a scale component under 0.01
    or negative** (review S4: the panel's clamp would destroy it, §2.5);
  - **exact when the frames allow it** (review N2; second review N1, r8):
    when the group being left or entered has rotation exactly (0, 0, 0, 1)
    and scale exactly (1, 1, 1), the move is a translation addition or
    subtraction (`group.t + part.t`, or `part.t − group.t`). Rotation and
    scale are kept bitwise, and so is the translation. A group made by Group
    is such a group, nested or not. Group then Ungroup, without Undo, leaves
    the values other tabs' entries expect. Through the inverse, r8 got
    `1.3700000000000003` under a turned parent, so the addition is what
    makes it bitwise. **The scale refusal (under 0.01, or negative) applies
    only to a scale the move computed**, not one kept bitwise (second review
    N2): an already-mirrored part can still be grouped and ungrouped;
  - `groupPlan(node, { isFree })`;
  - `ungroupPlan(group)`;
  - `isBareNode(node)` and `bareNodes(som, rules)` (the list above),
    sorted by breadcrumb text;
  - `moveTargets(node, som, rules)`: the groups (nodes that have parts,
    and bare nodes) the object may go into, sorted, each with its breadcrumb text, then
    "Top level" for a part. Targets that `moveValue` refuses, or that GR-L4
    (with GR3's `source` rule), GR4, GR-L9 or GR-L10 refuse, are **left
    out**. A line under the select says how many were left out for a shear
    or a scale, so the list isn't silently short.
- **On `som:reparent`:**
  - **a handle drag or open gesture on that node is cancelled, not ended**
    (second review S1, r7). The tracker's `cancel()` makes no final send
    and records nothing, and the handles are reset after it.
    `endHandleDrag` alone would make a final send of the last dragged value,
    which is in the old frame: in r7 the crate ended at world x = 4.13
    instead of 1.10. The tracker sends at most once per 100 ms, so a drag
    under way usually has an unsent value. Cancelling first also keeps the
    cancelled drag from being recorded, because `som:reparent` fires before
    the transform `som:set`s that mark the record as another session's;
  - the panel and both breadcrumb rows refresh, and `attachSelected` runs
    (§2.4).
- **The SOM Inspector's tree** rebuilds on `som:reparent`
  (`tools/som-inspector/src/app.js`).
- **Selection afterwards:** after Group, the new group. After Ungroup, the
  first part. After Move to, the moved object, with its new breadcrumb.
  Moving the last part out of a group leaves the group in Empty groups.
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
  - **GR3:** a `source` container as the parent, and a parent under one,
    refused; the cycle checked before the counts.
  - **GR4** (r1's cases, review M1):
    - each count just past the bound refused, and at it accepted;
    - a tree already over a count may grow: in a 300-node seed group, a
      move back in after a move out, and a Delete's re-add, both accepted;
    - a move out of a 257-node group accepted, and moving it back refused;
    - the deepest part of a 9-generation tree to the top level accepted, and
      back refused;
    - a move to the top level of an oversized part accepted;
    - a Duplicate-in-place `add` past the bound refused;
    - nodes under a `source` container not counted.
  - **GR-L12 (a):** a judged stale hello is refused with `PERMISSION_DENIED`
    and `STALE_HELLO_MESSAGE`, and the session never joins (no `som-dump`, no
    presence). A level-4 hello, and a hello with neither capability, join.
    This includes a stale hello **after** a regroup in the world (second
    review M2).
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
  - **`packages/server/test/script-host.test.js` L85 and L294, and
    `activate.test.js` L176** (review S9). They default to `scriptRunner: 3`
    with no `addFields`, and they are the suites that test the host election
    and the hand-over, which GR5 changes;
  - **`devtasks/harness/checks/scripting-4d/c1.py` L53** (it asserts
    `addFields: 3`);
  - `packages/client/tests/richer-add-lifecycle.test.js` L134,
    `activate.test.js` L141–145 and `subtree-add-hello.test.js`.

  A grep for `addFields` and `scriptRunner` under every `test`/`tests`
  directory is the commit's first step.
- **Client:** `moveNode` sends and changes nothing until the echo; the own
  echo and a remote `set` apply and emit, in order, `som:reparent`,
  `som:set` for `parent`, then the three transform `som:set`s; a missing
  parent desyncs, and so does a missing node; a move that lands in another
  node of the parent's name is reported with that node.
- **`edit-group.js`:**
  - every plan on a group turned 90° about y, scaled 2, translated and nested
    two deep, with the world placement kept to 1e-9;
  - a mirrored ancestor, and a group scaled above 100: both refused (a
    scale under 0.01 or negative; r4);
  - a shear refused in both directions;
  - equal linear parts give bitwise rotation and scale (N2);
  - `isBareNode`: true for a bare node, a group emptied by a move, and a
    bare node with a behaviour, a light, a camera or a teleporter; false for
    a mesh, a model, or anything with parts;
  - `bareNodes`: sorted, with nested breadcrumbs; it leaves out a live
    avatar and its client-only camera child, a `source` container and what
    is under one, and an unaddressable node (r9's cases, second review M1);
  - the bitwise path: Group then Ungroup, nested under a turned, scaled
    parent, gives back the exact old translation (r8); an already-mirrored
    part can be grouped and ungrouped (second review N2);
  - `treeCounts`: the client's and the server's copies agree;
  - `moveTargets` lists a bare node;
  - `moveTargets`' exclusions.
- **`edit-undo.js`:**
  - `move`, `group` and `ungroup` undo and redo, with the exact values
    restored;
  - an older Move entry before a Group still undoes after the Group's undo;
  - a race refusal drops the entry and names the part;
  - "Ungroup (partly)";
  - **f2's cases A and B** (a delete, and an Undo of a Duplicate, pending
    while another tab moves the node): restored in the right place;
  - **r5's sequence and its relatives** (review M2): Delete a part, Ungroup,
    Undo, Undo; a Move into a group, Ungroup, Undo, Undo; a drag of the
    group, Ungroup, Undo, Undo; Group, Move to the top level, Undo, Undo.
    Each ends with every entry undone;
  - a Group whose `add` is refused "already in use" because another node holds
    that name: nothing is moved until the retry's `add` is accepted, and the
    object ends in the retry's group. **This is the test for "the wait for
    the group's `add`"** (review S9: pipelined on one socket, the old proof
    turned nothing red);
  - Group's continuation completes with Edit mode turned off after the `add`
    (N5).
- **Wiring:** the row's enable rules (an animated node, r6's `crate-01`,
  disabled); a pending move blocks the gizmo and the fields and holds the
  runner; `som:reparent` ends a drag and refreshes; the Move to list is not
  rebuilt by a `som:set`, and a chosen option is checked again; the Empty
  groups row is hidden with none, appears when a move empties a group, and
  its choice selects the node and resets the select (lift the
  page's own handlers, subtree-add lesson 1).
- **Harness** (`devtasks/harness/checks/grouping/`, real mouse):
  - Group, Move to, Ungroup, and Undo and Redo of each, in two tabs, on
    `group.gltf`'s rotated group;
  - **f3 as a check:** no jump when another tab regroups the dragged object;
  - **g5 as a check:** a stale hello shows the refusal text and leaves the
    page unconnected (against the real server once GR5 exists, not a route);
  - **r9 as a check** (second review M1): no avatar camera and no `source`
    container in Empty groups; a bare node given a behaviour through the
    form stays listed;
  - **r6 as a check:** Group is disabled for `space-anim.gltf`'s
    `crate-01`, and enabled for its plain cubes;
  - **g4 extended:** Group a cube, Move it to the top level, then pick the
    empty `group-01` in **Empty groups**. The handles attach, and a real
    drag moves the group; Move the cube back into it with **Move to**; then
    empty it again and **Delete** it from the dropdown's selection. Undo
    brings it back.

  **Stated, not tested:** r3's in-flight race between two tabs of one owner
  (one round trip wide; §8).

  Each asserts the selection, the world positions, the drawn parent, the
  server's copy (`/__doc`) and the Undo stack (selection-parts lesson 2).
- **Proofs** (the handoff records each): breaking any one of these turns its
  test red:
  - the cycle check, the bounds, the behaviour rule;
  - the stale `send` refusal, the stale host refusal;
  - the exact Undo values, the parent re-read;
  - the wait for the group's `add` (the "already in use" test above);
  - the handle re-pointing (r5), the delete through the capture window;
  - the stale hello refusal;
  - the cancel (not end) on `som:reparent` (r7), the hold released by the
    answer;
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
5a. After step 5's Undo, both cubes are inside `group-01`. Select one cube and
   **Move to… → Top level**, then the other. Both stay where they are, and
   **Empty groups (1)** appears. Pick `group-01` there: the handles appear
   at its origin and the Name field reads `group-01`. Select a cube and
   **Move to… → group-01**: the Empty groups row disappears. Move that cube
   to the top level again, pick `group-01` in Empty groups, and press
   **Delete**: it is gone, and Undo brings it back (second review S5).
6. In a second tab (a visitor), watch steps 1–5: nothing jumps.
7. A tab opened before the deploy, not reloaded: the deploy has already
   disconnected it. Press **Connect** in it without reloading: it says
   "Connect failed: PERMISSION_DENIED: this page is older than the server: reload it" (GR-L12 (a); second review S5, M2; g5). Reload it: it connects, and its edits work.
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
  - `packages/client/src/add-spec.js` (the client's copy of `treeCounts`,
    GR4; second review S3);
  - `apps/client/src/edit-duplicate.js` (the export of `ownNodeProblem`,
    GR-L6 (a), and of its `referenced` test for GR8's animated-node rule;
    `duplicateRuleProblem` can't stand in, because `attached` is checked
    first, L586–587; second review S3);
  - `apps/client/src/edit-group.js` (new), `edit-undo.js`,
    `edit-structure.js`, `app.js`;
  - `apps/client/index.html`;
  - `tools/som-inspector/src/app.js`;
  - `devtasks/harness/checks/grouping/` (g4 and g5 among them), and
    `devtasks/harness/checks/scripting-4d/c1.py` (its hello assertion only);
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
  - **The release notes name:**
    - the stale-tab change: no edits, no host, and disconnected at the first
      regroup;
    - the stated limits (GR-L3, GR-L10, r3's race);
    - the Empty groups dropdown (a group is never deleted because it is
      empty);
    - the pending-delete fix (f2).
- **Never push to `main` between the release merge and PROD `COMPLETE`.**

## 7. Review log
- **Rev 2.0, FINAL** (2026-11-10, 00:05 PT): approved by the operator (status
  line).
- **Rev 1.4** (2026-11-09, 23:59 PT): GR-L12 (a) decided (status line). Claude
  reran r7, r8, r9 and g5 at Rev 1.3 before recording it.
- **Rev 1.3** (2026-11-09): **the second outside review, of `95d7a096`**, by
  the same Claude Fable 5.2 session per its first lines. **CHANGES
  REQUESTED.** It was pinned to the branch head, with the round-1 prompt
  reused. Claude reran its probes: `review2/r7` and `r8` (the same output;
  `r8` needed the reviewer's own later fix, applied from its session) and
  `r9` in the browser (the same output, three worlds). The source-only
  findings were checked at the cited lines. Before writing GR-L12 (a)'s new
  text, `checks/grouping/g5.py` checked in the released page what a hello
  refusal shows (3 PASS).
  - **Must-fix:**
    - **M1, taken:** Empty groups stated once, as bare nodes, leaving out
      avatars, `source` containers and unaddressable nodes. A behaviour
      doesn't remove a node from it.
    - **M2:** GR-L12 reopened, recommending a hello refusal.
  - **Should-fix, all taken:**
    - **S1:** cancel, not end;
    - **S2:** not recorded, and "just over" a bound;
    - **S3:** `edit-duplicate.js` and `add-spec.js` added, and the two
      `treeCounts` copies;
    - **S4:** which node each request holds, and its release;
    - **S5:** DEV steps 5a and 7.
  - **Nits, all taken:**
    - **N1:** the bitwise path by addition;
    - **N2:** the scale refusal only for computed scales;
    - **N3:** the flash, stated;
    - **N4:** the row's key;
    - **N5:** the `group` entry's removal window;
    - **N6:** g4 has 10 checks.
  - **The record:** the reviewer noted that the committed copy of its first
    review differs from the file it delivered. Claude transcribed that copy
    from the session and missed one late edit (r6's quoted output block);
    `REVIEW-grouping-rev1.0-fable.md` now says so. No result changes.
- **Rev 1.2** (2026-11-09, 22:31 PT): GR-L8 and GR-L11 decided as (c),
  keeping empty groups, with the Empty groups dropdown (GR8). The operator
  asked first what control it entails, and approved the answer. Before the
  contract, `checks/grouping/g4.py` probed the released page with a real
  mouse: a bare node can be selected, dragged, deleted and restored (9
  PASS). GR7's emptied-group captures are gone, and so is GR-L11's Delete
  change.
- **Rev 1.1, same day:** GR-L12 (a) decided; GR-L11 questioned (status line).
- **Rev 1.1** (2026-11-09): **the outside review of `34917de8`**, by Claude
  Fable 5.2, per its first lines. It ran on a clone with code: 121 + 30 + 30
  tests passing, the four design probes, the harness, and six probes of its
  own. **CHANGES REQUESTED.** Claude reran all six probes (`review/r1`–`r6`,
  same output, `r6` in the browser), and checked the source-only findings
  (S5, S7, S8, S9) at the cited lines.
  - **Must-fix, both taken:**
    - **M1:** one bounds rule, "past a count it is not already past"; the
      Undo promise replaced by ask-first, plus GR4 in GR7's checks; r1's
      tests;
    - **M2:** the handle re-pointing; the group's delete through the
      capture window; the `move` entry's own checks; r5's tests.
  - **Should-fix, all taken:**
    - **S1:** GR-L12, new and open;
    - **S2:** the behaviour hold; the two-tab race stated;
    - **S3:** animated and skinned nodes refused; GR-L10's limit widened;
    - **S4:** a scale under 0.01 or negative left out;
    - **S5:** Ungroup needs the capture to pass;
    - **S6:** GR-L11, new and open;
    - **S7:** `source` containers refused as parents, and not counted;
    - **S8:** when the Move to list is built;
    - **S9:** the "already in use" test, three more hellos and the 4d
      harness check, and DEV step 7's gesture.
  - **Nits, all taken:** N1 (the order), N2 (exact when frames allow), N3
    (GR-L10 stated), N4 (desync, landing reported), N5 (Edit mode), N6 (R3),
    N7 (13 checks, not 17).
- **Rev 1.0** (2026-11-09): every decision taken (status line).
- **Rev 0.3** (2026-11-09): the operator's decisions but GR-L10.
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
- Grouping animated or skinned nodes (review S3): the clip's keys would need
  re-basing into the group's frame.
- r3's in-flight race between two tabs of one owner (review S2): a tab that
  sees its own transform accepted after a `som:reparent` of that node could
  re-send the reparent's value.
- An outline or marker for a selected empty group in the viewport (g4: the
  handles show its origin, nothing is outlined).
- A move into a scripted group that asks the Enable grant question
  ("the behaviour on X will be able to change Y"), instead of GR-L10 (a)'s
  refusal.
- Duplicate's rule refusals inside groups (§1: a camera host makes its group
  uncopyable), whatever the counts.
- Making the SOM Inspector declare its level, so an unreloaded Inspector is
  judged too.
