# Pre-brief: the subtree `add` (`subtree-add`)

Status: **DRAFT, Revision 1.3 (2026-11-07): parts inside a group added as
SA-L7 (the operator's question, 17:50 PT). Decided (operator, 2026-11-07,
17:37: "no preference", so the recommendations): SA-L2 (a), SA-L3 (a), SA-L6
(a).** Open: SA-L1, SA-L4, SA-L5, and SA-L7 (the operator leans to (a),
include). The next placement round after `copy-objects` (RA-L6 (a),
`PREBRIEF-richer-add.md` §3): **an `add` that carries a node and its
children**, so a group can be duplicated, deleted and undone, and copied
between worlds, and (SA-L7) so can anything inside a group. **Still to come:**
the remaining decisions and one ChatGPT review.
- **What it builds on.** `PREBRIEF-add-check.md` FINAL Rev 1.1 (A1–A10),
  `PREBRIEF-richer-add.md` FINAL Rev 2 (R1–R10) and `PREBRIEF-copy-objects.md`
  FINAL Rev 2.1 (K0–K10) hold here unchanged for every node of a subtree: a
  child is checked, kept, duplicated, restored and pasted exactly as a
  top-level object is today. This file adds the rules that are about the
  **tree**: what a message may carry, what must hold across its members, and
  what every path that reads an `add` does with the children.
- **Against `main` at `70a30bd2`**, whose code is PROD's `42aa56ff` (the
  difference is `devtasks/` only: the passdown). Every line number below is at
  that commit.
- **How it was checked.** Claude read every cited line at `70a30bd2`, ran a new
  probe on the fixtures (`p10`, §2.5) and the depth probe of §2.6, and extended
  `p6` with the counters this round needs, tested on a scratch database of
  five fixture worlds (§2.5). **The operator ran it on PROD** (2026-11-07,
  16:57 PT, at `530c636`, this file's Rev 1 commit): §2.5. A fresh Claude agent
  checked Rev 1.1 against the code (§7: 59 of 71 facts confirmed, prototypes
  of T3, T4 and T8 run in a scratch copy); Claude reproduced each finding it
  took. The app wasn't opened in a browser.
- **Sources:** `docs/DESIGN-phase3-placement-scripting.md` §3.2 item 2 ("`add`
  carries one node, not a subtree"), §4.5 (no undo for a node with children),
  §7 item 7 (the subtree `add`); `Atrium-Passdown-2026-10-18-undo-redo.md`
  §5.1 item 1; `PREBRIEF-edit-mode-ui-1b-2.md` D5, N2 (the "N objects inside
  it" question), W6 (a restorable delete asks nothing); `PREBRIEF-richer-add.md`
  §2.7 and R6 (version skew); `PREBRIEF-copy-objects.md` K2, K6–K8;
  `PREBRIEF-message-depth-guard.md` §6.2 (the measured depth ceiling);
  `Atrium-Passdown-2026-11-06-copy-objects-shipped.md` §1.1 (PROD's `p6` at
  `42aa56ff`) and §3 (the lessons applied in §5).

## 1. What this delivers
**An object with children behaves like any other object.** Concretely:
- a world `add` may carry `children`: node descriptors of today's form, nested,
  within bounds (SA-L2). The server checks the whole tree before it changes
  anything, stores it, and broadcasts it as one message; every client ingests
  it as one tree;
- **Duplicate, Delete-and-Undo and Redo** accept a group when every member
  passes today's per-object rules: 11 of the 13 fixture groups (§2.5; one of
  them, `Furniture`, can't be selected as a whole by a click, §2.4) and PROD's
  9 (`p6`, 2026-11-07: 460 top-level objects, 450 copy today, 9 are refused
  for children, 1 for a non-unit rotation);
- **Copy and Paste** accept a group: the credit, the behaviour rule and the
  URL rule apply to every member, and a member's reference to another member
  stays a reference to its copy (K7 widened);
- deleting a group is undoable, so the "This can't be undone" question goes
  away for a restorable group (SA-L4);
- **(SA-L7) a part works too:** an Alt-clicked part (a lamp shade) or a
  sub-group (`Furniture`'s `Bench-NE`) can be duplicated beside itself in its
  group, deleted and undone back into its group, and copied out to another
  world. On PROD that's the 18 parts of the 9 lamps;
- an unreloaded tab can't silently store a childless copy of a group (R6
  widened, §2.7), and a new tab on an older server can't silently lose a
  group (T7's server level).

**Not in this round:** selecting a nested group as a whole (SA-L6 (a): a
click on `Furniture` selects its sub-group); grouping or ungrouping objects in
the Edit panel; reparenting (`parent` on the message is
unchanged); carrying material or mesh sharing inside a group (SA-L3); lights,
cameras, skins, morph targets and animation on `add` (per-node rules refuse
them as today); textures; a per-world resource budget (the audit item).

## 2. Verified facts (at `70a30bd2`)

### 2.1 The `add` path today
- **The schema refuses `children`:** `add.client.json`'s `node` is
  `additionalProperties: false` with exactly `name`, `translation`, `rotation`,
  `scale`, `extras`, `extensions` and `mesh`; `add.server.json`'s `node` is
  identical (checked key for key). A world `add` with `children` is refused
  before the handler runs, as `UNKNOWN_MESSAGE` with Ajv's text. **Neither
  `checkAddNode` copy looks at the node's key set** (`add-spec.js` L386–406;
  `send-policy.js` L2380): A1 leaves unknown node keys to the schema (A8).
- **`parent` already exists on the message** (`"parent": { "type": ["string",
  "null"] }`): the server adds the node under the named parent
  (`world.addNode(msg.node, msg.parent)`, `session.js` L1480). **`world.js`
  has two copies of `addNode`, identical:** `createWorld`'s (L573–590, file
  worlds: the commons, `commons.js` L120, and `world-registry.js` L621) and
  `createWorldFromDocument`'s (L721–738, document worlds: home and user
  worlds, `world-registry.js` L664). Each has the duplicate-name guard, the
  parent check, `ingestNode`, then `parent.addChild` or the scene. It refuses a parent that is or
  descends from a live avatar or an external node (`isBlockedParent`,
  L1352–1356), and broadcasts `parent` with the node (L1497, L1505). **The
  client honours it** (`AtriumClient._onAdd`, L1630–1639, edit-plumbing A7: a
  parent missing locally emits `som:desync` and inserts nothing;
  `edit-tracking.test.js` L255–270). No first-party sender uses it; the app
  never sends `parent`. So a group **could** be built today as N messages,
  parent first: SA-L1 (b).
- **The handler's checks are all about one node** (`session.js` L1282–1517):
  the avatar's parent (L1308), S2's `source` (`addSetsAtriumSource(msg.node)`,
  L1316; L165), K4 (`addCarriesAtriumExtras`, L1325; L217), the gate (L1333),
  R6 (L1341), the name (`world.som.checkNewName(msg.node.name)`, L1357), the
  id (`objectIdInUse`, L1367–1371), K6 (`checkTransformValues(msg.node)`,
  L1378), `format` (L1386), A5 (L1394–1407), then in the V9 `try`
  `checkAddNode`, `checkAtriumExtras(msg.node.extras)` and
  `checkModelHost(msg.node)` (L1418–1449), the 64-behaviour and 1 MiB
  behaviour caps (L1453–1470, counting the world's existing leaves plus **the
  one** added), `world.addNode` (L1480) and the broadcast of `msg.node` as sent
  (L1491–1510). **Every one of them that is about a world node must run for
  every member** (T2). Two are avatar-only and stay so: the avatar's parent
  (L1308) and K4 (`msg.id && …`, L1325). **The order matters for a tree:**
  the name and id checks and K6 run before the V9 `try`, where
  `checkAddNode` (and so any tree bound inside it) runs.
- **`ingestNode` ignores `children`** (`SOMDocument.js` L781–873): it reads
  `name`, the TRS, `extras` and `mesh`, nothing else. It makes **one buffer per
  call** (L807–811, richer-add R4). `ingestExternalScene` (L894) is the one
  recursive ingest, for file worlds' external nodes, and names its nodes
  `container/Parent/Child` (L884–885): not a model for `add` (names with `/`
  are refused by `checkNewName`, L328–330).
- **The client's `_onAdd`** (`AtriumClient.js` L1621–1670) ingests one node
  inside `applyLocally`, attaches it to its parent or the scene (L1644–1649),
  **attaches the mutation listeners to that one node** (`_attachNodeListeners`,
  L1650; the `som-dump` path attaches them to every node of the document,
  L1893–1895), emits one `som:add { nodeName }` (L1662) and resolves the
  sender's pending add (L1665). A client **doesn't validate** incoming
  messages (richer-add §2.2), so an older client fed a node with `children`
  ingests the root and drops the children without a word (§2.7).
- **`remove` is already a subtree remove**, on the server and every client:
  `world.removeNode` → `node.dispose()` (`world.js` L745–754) → `SOMNode.dispose`
  → `SOMDocument.removeSubtree` (`SOMNode.js` L165–171; `SOMDocument.js`
  L429–456: children first, then the mesh, skin, camera and light the subtree
  used and nothing else uses). The client's `_onRemove` disposes the named
  node the same way (L1685–1690). A subtree holding a live avatar can't be
  removed (`subtreeHasLiveAvatar`, `session.js` L1584).
- **Names are one world-wide space:** `_registerObject` (L282–294) puts every
  node, animation and camera and light alias in `_objectsByName`;
  `checkNewName` (L315–336) refuses an empty name, over 256 characters,
  `__document__`, a `.camera` or `.light` suffix, a `/`, and a name in use.
  `send` addresses by name, so **a member must have a world-unique name** to
  be editable, and a legacy duplicate is shadowed ("first-registered wins",
  L181–184; K5(b)). **A node can hold its name without being addressable by
  it:** a shadowed duplicate, or a node whose name an animation or a
  `.camera`/`.light` alias registered first (`getObjectByName(name) !==
  node`). Restoring such a member would be refused by `checkNewName`.
- **Object ids are healed on load** (`healDocumentObjectIds`, `world.js`
  L338–370: an id held by two nodes is dropped from both; a malformed one is
  dropped). **`objectIdInUse` (`SOMDocument.js` L1112–1117) is a linear scan**
  of `_savedNodes()` (L1101–1103), which rebuilds `allNodes` and filters it on
  every call; it isn't a map. The fresh-agent check measured 14,000 calls on a
  505-node world at **632 ms**, against 4 ms for 14,000 `checkNewName` calls
  (`/tmp/subtree-check/idscan-probe.mjs`). `behaviorCountIn` and
  `behaviorBytesIn` (`send-policy.js` L1461–1470, L764) count **every** node
  of the world (`som.allNodes`, `SOMDocument.js` L692).
- **Message depth** is bounded at 64 (`message-depth.js` L25), and
  `message-depth-measure.test.js` asserts the deepest legitimate message the
  suites send is **32 or less** (L13, L67). Measured for this file
  (`/tmp/depth-probe.mjs`, with `messageDepth` and `templateGraph`): an `add`
  whose node carries any of the five template behaviours is depth **11**; each
  generation of `children` adds **2** (`children` array, then the node). A
  template leaf on a node 8 generations down is depth 27. **The deepest
  behaviour leaf is depth 12** at generation 0 (the leaf starts at depth 5,
  `msg.node.extras.atrium.behavior`, and `walkGuards` caps it at
  `BEHAVIOR_DEPTH_MAX = 8` levels, `behavior-spec.js` L53, L614: corrected by
  the fresh-agent check, Rev 1.1 said "about 13"), so generation 10 is 32 and
  generation 11 passes it. **The ceiling allows 10 generations; SA-L2's 8 is a
  margin of two**, not a number the ceiling forces.

### 2.2 Duplicate, Undo and Copy today
- **`duplicateRuleProblem` refuses a group at its first line**
  (`edit-duplicate.js` L481: `node.listChildren().length > 0` →
  `children`, "Objects with children can't be duplicated yet", L62) **and a
  part at its second** (L483: a `Node` parent → `parent`, "Only top-level
  objects can be duplicated yet", L63). Every other rule (L484–507) is about
  the node itself: camera, light or skin; animated or skinned into;
  `source`; `atriumProblem` (L106–136, with the credit); morph weights;
  `meshProblem`; extensions; the transform; the size's lower bound.
- **`buildDescriptor` (L414–447) builds one node:** name, TRS, deep-cloned
  `extras`, the mesh with every richer-add field. **`addMessageBytes`**
  (L450–453) measures the whole message; `MAX_ADD_BYTES` is 1,000,000 (L41).
- **`prepareDuplicate` (L563–577)** gives the copy a new id
  (`withNewObjectId`, which creates `extras.atrium` if needed), remaps the
  behaviour's self-references (`remapBehaviorTargets`, L522–533: `nodeMap`,
  `targets`, `animations[].object`, `template.params.target` equal to the
  original's id), measures, and runs `add-spec.js` (A7). **`prepareRestore`
  (L593–602)** builds the same descriptor with the node's own name and
  translation and adds `sharedMaterial: true` when `hasSharedMaterial`
  (L395–407) finds the node's mesh or a material of it used elsewhere.
- **The Undo engine** (`edit-undo.js`): `capture` is `prepareRestore` of the
  node (L289–295); an add's entry is captured after the server's echo
  (`acceptAdd`, L360–372); `checkEntry` refuses to remove a node that has
  children ("was changed elsewhere", **L565–567**: the one place the engine
  looks at children) and otherwise compares a fresh capture with the entry's
  (`sameDescriptor`, L74–88: every key and value, arrays element by element
  in order, not key order); a re-add checks only that the name is free
  (L531–537). An entry is one request, one `seq` (L687–717); only a transform
  entry fans out to several (`startTransform`, L654–670). The stack holds at
  most 16 MiB of descriptors (`MAX_DESCRIPTOR_BYTES`, L40).
- **Delete asks only when the node can't come back** (`app.js` L3016–3049):
  `undo.capture(node)` first; refused → `Delete "X" and N objects inside it?
  This can’t be undone.` with `countDescendants` (`edit-structure.js`
  L60–64), or `Delete "X"? This can’t be undone.` (straight quotes around the
  name, L3024–3025); accepted → no question (W6). The request records the
  subtree (`collectSubtree`, L67–71) so a held removal of any member is this
  delete's (`removalSeen`, L108–114). `registerDelete` reads
  `hasSharedMaterial(node._node)` itself (`edit-undo.js` L311).
- **What re-captures a pending delete:** `undo.reCapture()` is called on
  `som:set` (`app.js` L1079), `som:add` (L1091) and `som:rename` (L1112),
  **not on `som:remove`** (none of the three `som:remove` listeners, L1094,
  L2684, L3210, calls it). For a single object that's right: a remove of the
  pending node ends the window. **For a group it's a gap:** another tab
  removing a part while our delete is pending would leave the stale tree in
  the entry, and Undo would bring the part back (fresh-agent check, M3).
- **A re-add re-points only the root's handle** (`completeAccepted`,
  `edit-undo.js` L610–611; W2: "older entries for the node follow it"):
  entries recorded on parts (an Alt-clicked move or rename) would still
  point at the disposed part nodes after the group comes back.
- **Copy and Paste** (`copy-paste.js`): `copyObject` (L187–230) runs
  `duplicateRuleProblem` with the credit skipped and `buildDescriptor` on one
  node, and collects the names of the behaviour's foreign ids (`foreignIds`,
  L138–147: `nodeMap` from entry 1, `targets`, `animations[].object`,
  `template.params.target`, less the object's own). `preparePaste` (L270–410)
  takes one descriptor through its eight steps: the name (L282–284), the
  translation (L287–288), a new id (L291–292), the `extras` whitelist and the
  hidden marker (L295–310), the behaviour (L313–337: `remapBehaviorTargets`,
  then in another world `enabled: false` and `swapIds` through one map, the
  record), the URLs (L340–372), the credit (L375–388), the size, A7 and
  `atriumProblem` (L394–408).

### 2.3 Every reader of a `som:add`
A one-message subtree arrives as one `_onAdd`. What reacts to it today, and
what each looks at:

| Listener | Looks at | For a subtree |
|---|---|---|
| pads (`app.js` L1083–1092) | `isTeleporter(root)` only, then `rebuildPads()`; `derivePads` itself walks `som.nodes` at any depth (L524–538, B7/G13: "a pad inside a moved group follows it") | a pad **child** wouldn't rebuild the pads until some later event |
| the Z6 model handover (L2712–2723) | `added.extras.atrium.model` of the **root** | a model child's saved animation state wouldn't be handed over |
| `modelBridge.reconcile()` (L2716) | `som.allNodes` (`model-bridge.js` L863) | fine |
| the behaviour runner (`runner.js` L1026–1028 → `scan`, L387–397) | every `som.nodes` entry | fine |
| `structure.addSeen(name)` (L3207), `undo.reCapture()` (L1091) | the name; a pending delete | fine either way |
| `AnimationController._onSomAdd` | animations by name | fine |

So either every listener learns to walk the added subtree, or **`som:add`
fires once per member** (T4): the second needs no listener to change.

### 2.4 Selection, the panel and parts
- **A click selects the nearest ancestor without a mesh** (`nearestNonMeshAncestor`,
  `selectionModel.js` L13–19; `resolveSelectionRoot`, L41–47; `app.js`
  L2300–2309): **the nearest, not the top-level root.** A depth-1 group whose
  root has no mesh (every PROD group, and every fixture group but one, §2.5)
  is selected as a whole from any part. **A nested group isn't:**
  `Furniture`'s nine children (`Table-Center`, `Credenza-*`, `Bench-*`) are
  meshless sub-groups, so a click on any piece selects its sub-group, which
  `parent` refuses; `Furniture` itself can't be reached by a click, in Edit or
  Inspect (fresh-agent check, S2; reproduced from `atrium.gltf`). A group
  whose root **has** a mesh is selected as a whole only by clicking the root's
  own mesh. **Alt-click descends** (`descend: e.altKey`, L2309) to the part
  under the pointer, in Edit and Inspect alike. SA-L6 decides what this round
  does about nested groups.
- So **parts are editable today:** an Alt-clicked part can be moved, renamed,
  recoloured, hidden (`epVisible`, L1696, L2585–2588) and deleted
  (permanently: `prepareRestore` refuses `parent`). Duplicate and Copy of a
  part are refused with `parent`'s text. SA-L7 changes that (T11). K6's
  hidden-marker rule applies to the copied root only (T6): a hidden part
  inside it is the author's design, and the paster can reach it.
- **A visitor's Copy of a group carries its hidden parts**, though Inspect
  skips hidden objects (CP-L1: "what a visitor is offered is what they see").
  It isn't new exposure: every visitor's `som-dump` already holds the hidden
  part (CR's reasoning for CP-L1). T6 states it.
- **Inspect lifts a part to its root too** (`pickEditSelection` with
  `resolveSelectionRoot`, copy-objects §2.2), and shows Duplicate's reason:
  today "Objects with children can't be duplicated yet"
  (`REVIEW-copy-objects-rev1.2-claude.md` L82 confirmed the lift and the
  reason shown).

### 2.5 The content (`p10` on the fixtures; `p6` on PROD)
**`devtasks/spike-subtree-add/p10-groups.mjs`** (new; run on
`tests/fixtures/*.gltf devtasks/harness/group.gltf`): for every top-level node
with children, its members, depth, what they carry, the per-node Duplicate
rule asked of each member with `children` and `parent` set aside, and the
UTF-8 size of a one-message subtree descriptor (today's `buildDescriptor` per
node, nested).

| Group (file) | Members (root incl.) | Depth | With a mesh | One message |
|---|---|---|---|---|
| `Walls` (atrium) | 5 | 1 | 4 | 12,089 bytes |
| `Columns` (atrium) | 9 | 1 | 8 | 58,356 |
| `Furniture` (atrium) | 33 | 2 | 23 | 76,178 |
| `Fountain` (atrium) | 6 | 1 | 5 | 112,875 |
| `Lamp` (lamp), `lamp-01` (space, space-anim, space-anim-autoplay, space-cameras, space-lights) | 3 | 1 | 2 | 16,529–16,558 |
| `Group` (harness) | 2 | 1 | 0 | 285 (a pad child) |
| `NestedCameraMount`, `AnimatedCameraMount` (space-cameras) | 2 | 1 | 0 | refused: a camera member; an animated root |

- **13 groups, 64 descendants, depth at most 2, the largest 113 KB** as one
  message: a ninth of the cap. **11 of 13 pass the per-node rule in every
  member**; the two refused are refused for what refuses them today. **Every
  root is meshless**, so a click selects the whole group (§2.4), except
  `Furniture`, whose meshless sub-groups take the click. No member has
  an `objectId`, a behaviour, a model, a hidden marker, an empty name or a
  name another node holds; one member is a pad (the harness).
- **Sharing inside a group:** `atrium.gltf`'s nine columns share "Marble"
  (`p5`, richer-add §2.3), and `p2` counted 40 primitives with a shared
  material across the seven files, in groups and not. RA-L3 (a) gives each
  primitive its own material on a copy or a restore (SA-L3).
- **PROD (`p6`, run by the operator 2026-11-07 at `530c636`, its
  subtree-add section new):** 24 worlds, none unreadable, **460** top-level
  objects (455 at `42aa56ff`): 450 copy today, **9 have children**, 1 has a
  non-unit rotation. **The 9 groups:**
  - **every one is 3 nodes (root and two parts), depth 1**, and every member
    passes the per-node rule; as one message the largest is **16,656 bytes**
    (all nine together 149,039): the commons' lamp's shape and size
    (`lamp-01`, 16,529 bytes in `p10`);
  - **no root has its own mesh** (a click on any part selects the group,
    §2.4); no member carries an object id, a behaviour, a pad or a model; no
    member has an empty name or a name another **node** in its world holds
    (`p6` counts node names only, not animation or `.camera`/`.light`
    aliases: T5's addressability rule covers those);
  - **one member carries the hidden marker key** (`__atrium_visible`). `p6`
    counts the key, and `SOMNode` writes `true` when a part is shown again
    (`SOMNode.js` L79–80), so the part may or may not be hidden (corrected by
    the fresh-agent check). Either way the marker is `extras`: T5 keeps it
    through Duplicate and Undo, and T6 keeps it on a part through Paste (it
    is removed from the root only).

  So PROD's groups are far inside SA-L2 (a) and (b) alike, and SA-L1 (a)'s
  byte cap never binds on PROD today. Every name collision T5 handles comes
  from the copy itself (a Duplicate of `lamp-01` in its own world meets
  `lamp-shade` and `lamp-stand`), never from legacy content.
- **Elsewhere in that run:** 5 objects now carry a credit (pastes made since
  `42aa56ff`; `p6`'s label said "expected 0", written before that round, and
  is reworded); model URLs 39 root-path and 16 absolute (38 and 14 before); 1
  double-sided primitive (none at `3fcc296`; carried since `richer-add`);
  behaviours, pads and material counts as before; nothing refused by
  `add-check`'s ranges.

### 2.6 What an `add` with children costs
- **Bytes:** the socket's 1 MiB (`MAX_PAYLOAD_BYTES`, everywhere since K0)
  and the client's 1,000,000 bound the whole message, children included: a
  group over it can't be duplicated, restored or pasted as one message
  (SA-L1 (a)). Fixtures: 113 KB at most; PROD: 16,656 bytes at most (§2.5).
- **Ingest:** `ingestNode` is 0.38 s for 20,000 primitives (richer-add R4's
  `q2`); a subtree within the byte cap is far smaller. One buffer per call is
  the R4 rule; for a tree it's one buffer per message (T3), pruned when the
  last member using it goes (`pruneCandidateProperties`, L454). The
  fresh-agent check prototyped it: one buffer for a 4-member tree; removing
  one part alone keeps the buffer and the rest's accessors live; removing the
  rest prunes back to the baseline.
- **Checks: names are a map lookup, ids are not** (§2.1: `objectIdInUse`
  scans every node). **About 57,000 near-empty members fit in 1,000,000
  bytes** (about 14,000 if each carries an id), and any signed-in user owns a
  home world and passes the gate there. So per-member world lookups on an
  unbounded tree would let anyone stall the shared process for about 0.6 s
  per message (fresh-agent check, M1). Hence T2's order: **the tree's shape
  first** (count, depth, key sets, names and ids unique within the tree),
  then **one id set per message** built in one scan, then the per-member
  checks.
- **Re-capture:** a tree capture costs about 1.1 ms per 113 KB
  (`/tmp/subtree-check/capture-cost.mjs`). With T4's per-member `som:add`, a
  pending delete would re-capture once per member: 256 events on a 1 MB
  group, about 2.5 s. T4 has the client re-capture once per message.
- **Depth:** §2.1's measurement: 10 generations stay at the 32 ceiling; 8
  leaves a margin.

### 2.7 Version skew (richer-add §2.7, R6)
- **A `42aa56ff` tab fed a subtree `add` keeps the root and loses the
  children** (§2.1: `ingestNode` reads no `children`; the client doesn't
  validate). A meshless root is invisible, so the group vanishes for that
  tab; its Duplicate of the root sees no children and **sends a childless
  copy**, which the new server accepts (poorer is valid); its Delete of the
  root asks nothing (the childless capture passes), the server removes the
  whole group, and its Undo re-adds the root alone. **Silent and saved:**
  exactly R6's case, one field set later. (Reproduced by the fresh-agent
  check through the real handlers with a `42aa56ff` client copy.) **After the
  deploy restart such a tab reconnects** and reads the whole tree from its
  `som-dump` (`readJSON` keeps children), so in practice its old rules then
  refuse a group's Duplicate client-side ("Objects with children can't be
  duplicated yet") and its Delete asks first; the loss is for groups that
  arrive **after** the reconnect, by `add`.
- **The tool is in place:** the app sends `capabilities.addFields = 2` beside
  `scriptRunner` (`AtriumClient.js` L816–825); the schema takes any integer
  ≥ 1 (`hello.client.json` L36, R5: "a later page still connects");
  `isStaleEditor` refuses a world `add` and every `remove` from a session
  with `scriptRunner` and `addFields` under 2 (`session.js` L189–194; L1341,
  L1562). **This round moves the level to 3** (T7). A `42aa56ff` tab is then
  refused as a `3fcc296c` tab was: it can visit, move, recolour and rename,
  and a reload fixes it.
- **Who sends `addFields: 2` today** (grep): `AtriumClient.js` L824; the
  tests `richer-add.test.js` (`CURRENT`, L398, and the `isStaleEditor` unit
  test L400–405, whose "a later page" case is `addFields: 3` today and
  becomes 4),
  `world-total.test.js` L83, `behavior-leaf.test.js` L328,
  `copy-objects.test.js` L85, `activate.test.js` L141–152,
  `richer-add-lifecycle.test.js` L134, and `richer-add.test.js` L459–461 (its
  `later` case, `addFields: 3`, becomes 4); and the harness `c1.py` L53, the
  only harness hit. All move with the client.
- **A rollback reverses the hazard** (fresh-agent check, M2; reproduced with
  `/tmp/subtree-check/rollback-probe.mjs`): the old schema accepts a hello
  with `addFields: 3`, and the old `isStaleEditor` passes it (≥ 2), so a tab
  loaded on the new client connects to a rolled-back server as a current
  editor. Its Delete of a group asks nothing (its tree capture succeeds); the
  old server removes the whole group; its Undo sends an `add` with
  `children`, which the old schema refuses ("must NOT have additional
  properties"). **The group is gone, and nothing asked first.** Stored
  data still needs nothing undone.
- **The tool for it exists:** the server's `hello` already carries a
  `capabilities` object (`hello.server.json`: `tick`, `physics`, `chat`,
  `additionalProperties: false`; sent at `session.js` L899). A new key there
  reaches an older client harmlessly (it doesn't validate), and an older
  server simply doesn't send it. T7 uses it.

### 2.8 Parts (SA-L7; at `70a30bd2`)
- **Putting a node under a parent already works on the wire** (§2.1: the
  `add` message's `parent`, honoured by the server, its `isBlockedParent`
  check, and every client's `_onAdd`). **The client API doesn't expose it:**
  `AtriumClient.addNode(descriptor)` sends `{ type, seq, node }` only
  (L1321–1331). Every first-party structural add goes through it: Duplicate
  (`app.js` L2916–2932, `client.addNode(check.descriptor)`), and Undo's and
  Redo's re-adds (`structural`, L1885–1893, `client.addNode(request.descriptor)`).
- **A part's translation, rotation and scale are local** (relative to its
  parent), and `buildDescriptor` reads them as stored (`edit-duplicate.js`
  L415–421); Duplicate's offset is `+1.5` on the local x (L418).
- **The world transform is one function away:** `worldMatrix` in `@atrium/som`
  (`world-matrix.js` L60, column-major, composed from each ancestor's TRS),
  already imported by `app.js` (L31) for the behaviour runner. Nothing
  decomposes a matrix back into TRS today.
- **`addChild` appends** (glTF-Transform's `Node.addChild`; `SOMNode.addChild`,
  `SOMNode.js` L139–140): a part re-added under its parent comes back last
  among its siblings. Nothing in Atrium shows or uses child order, but
  `sameDescriptor` compares arrays in order (§2.2), so a parent's capture
  would differ after one of its parts was deleted and restored.
- **PROD (`p6`, §2.5):** 18 parts, two in each of the 9 lamps, each a mesh with
  no children; one carries the hidden-marker key.

## 3. Decisions (for the operator)
Binding from earlier rounds: RA-L1–RA-L8, C1–C4, CP-L1–CP-L8, PC.

**SA-L1. How a subtree travels.**
- **(a) Recommended: one `add` carries the tree, in and out.** `node` gains
  `children`: an array of node descriptors of the same form, recursively, in
  both schemas. The server checks every member and the tree rules **before
  the first world change**, ingests the tree, and broadcasts the message as
  sent; every client ingests it as one tree. Undo, Redo, Duplicate and Paste
  stay one request each. It needs R6's level bump (§2.7) **and the server's
  level in `hello`** (T7: a rollback otherwise loses groups silently, §2.7),
  the bounds of SA-L2 **checked before any per-member world lookup** (T2:
  §2.6's cost), and a group over the cap can't travel at all.
- (b) **N messages with `parent`**, no protocol change (§2.1): the client
  sends the root, then each member under its parent, and collects N answers.
  No skew bump (a `42aa56ff` tab honours `parent`), and a group of any size
  restores if each member fits. But a refusal half-way leaves a partial group
  on the server and every client (the client must then `remove` the root and
  say so), a joiner can see a half group, "already in use" on member 7 after 6
  were added needs a rollback and a renamed retry, the structure tracker and
  the Undo engine take one structural request at a time (§2.2) and would need
  a composite request, and a tab closed mid-sequence leaves the half group
  saved. The failure modes are many, and all in `app.js`.
- (c) **One message in, N broadcasts with `parent` out** (`add.client.json`
  gains `children`; `add.server.json` doesn't). Atomic on the server, no skew
  bump, no client ingest change. **But the sender's echo decides when its Undo
  entry is captured** (`acceptAdd` runs on the root's echo, before the
  children's broadcasts arrive, §2.2), so the entry would hold the root alone
  unless `requestSeq` rides on the **last** broadcast, which no reader expects.
  Workable, subtle, and a reviewer's first finding.
- **Claude (a):** the design doc's item is "a subtree `add`" (§7 item 7),
  every refusal in this codebase changes nothing (V9, E3, A6), and the skew
  bump is a rule that exists and shipped once. (b) trades a protocol change
  for client-side transactions; (c) trades it for echo timing.

**SA-L2. The bounds on one message** (with SA-L1 (a)).
- **(a) Recommended: at most 256 nodes, root included; at most 8 generations
  below the root; the 1,000,000-byte cap on the whole message.** 8 is two
  under what §2.1's measurement allows (10 at the 32 ceiling); 256 is eight
  times the largest fixture group (33) and 85 times PROD's (3), and keeps the
  per-member checks' cost named; the byte cap is the one that binds in
  practice. PROD's `p6` (§2.5) is far inside it.
- (b) 64 nodes and 4 generations: twice the fixtures' largest, and nothing
  more. PROD fits this too.
- (c) Only the byte cap and the depth: no node count. Simpler, but then the
  count of members a message may carry is whatever fits in a megabyte of
  near-empty nodes (**about 57,000**, fresh-agent check; Rev 1.1 said 8,000),
  and the names check, the ids check, the broadcasts and the Undo stack carry
  it.

**SA-L3. Sharing inside a group.** The columns share one material (§2.5); a
copy or a restore gives each primitive its own (RA-L3 (a)).
- **(a) Recommended: RA-L3 (a) holds across the tree; the Undo note says so.**
  `hasSharedMaterial` walks the members (T5): a mesh or material used by two
  members, or by a member and an outsider, gives the entry "(it comes back
  with its own material)". PROD has no shared material or mesh (`p6` at
  `3fcc296`), and RA-L3's revisit trigger (step 7's import, material identity,
  or `p6` finding sharing) stands.
- (b) Carry sharing **within one message**: a primitive's `material` may be
  `{ "ref": i }`, the i-th material defined earlier in the same tree, and
  `ingestNode` reuses it. It keeps a group's own sharing (recolour one column,
  all nine change, `p5`) at the cost of a second material form in the schema,
  both `checkAddNode` copies, `buildDescriptor` and the fixed point, for
  content PROD doesn't have.

**SA-L4. What Delete asks for a group that can come back.**
- **(a) Recommended: nothing**, as for any restorable object (W6 supersedes
  design §4.1 for restorable nodes). The question stays, with "N objects
  inside it", for a group that can't come back.
- (b) Keep "Delete “X” and N objects inside it?" for every group, without
  "This can't be undone." A big action gets a pause; it breaks W6's rule for
  one case.

**SA-L6. Nested groups** (new in Rev 1.2; §2.4). A click selects the nearest
meshless ancestor, so `atrium.gltf`'s `Furniture` (whose pieces are meshless
sub-groups) can't be selected as a whole, and its sub-groups are refused
`parent`.
- **(a) Recommended: state it; change no selection rule.** PROD has no nested
  group (every group is depth 1, §2.5), and nothing a user can do makes one:
  a Duplicate or a Paste puts the copy at the top level, and the app never
  sends `parent`. The fixture's `Furniture` passes every T5 rule and is
  tested through the pure functions; it just has no click path. Recorded in
  §8.
- (b) A click selects the **top-level** group (the member whose parent is the
  scene), Alt-click the part under the pointer. Every group is then reachable,
  but a sub-group (`Table-Center`) is no longer selectable at all, by any
  click: Alt goes to a leaf. It changes Edit mode for everyone working in a
  nested file world.
- (c) A "Select the group it's in" control in the Edit panel when the
  selection has a parent. Reaches everything, at a new control (`index.html`)
  and its wiring.

**SA-L7. Parts inside a group** (new in Rev 1.3; the operator's question:
"if Bench-NE is selected, why wouldn't we want it copyable"). Today a part
can be moved, recoloured, renamed and deleted, but not duplicated or copied,
and its delete can't be undone (§2.4). Rev 1.2 kept that, recording parts as
a later round (§8).
- **(a) Recommended: include them (T11).** No server or protocol change:
  `parent` already travels both ways (§2.8). Duplicate puts the copy beside
  the original in the same group; Undo and Redo put a part back into its
  group, or refuse when the group is gone; Copy carries the part out with its
  **world** placement baked into the copy's root, and Paste puts it at the top
  level as today. It covers an Alt-clicked single part (the lamp shade) and a
  sub-group (`Bench-NE`) with the same rules, so SA-L6's nested case gets
  every piece reachable, only the top group not. **Claude's reason:** once
  groups work, "Only top-level objects can be duplicated yet" on a lamp shade
  reads as a bug, and it's the same machinery as the rest of the round.
- (b) The next round: this one ships top-level groups only, and a small round
  after it adds parts (§8). Smaller now; the `parent` refusal stays a round
  longer.

**SA-L5. How the round runs.**
- **(a) Recommended: the cheap round** (`richer-add` passdown §4; CP-L8 (a)):
  one ChatGPT review of this pre-brief pinned to a SHA, a fresh-agent check,
  Claude's fast lane on `claude/subtree-add` in the commits of §6, a
  fresh-agent code check, one ChatGPT code review, publish and deploy from the
  host. No OpenRouter credit.
- (b) The GLM pipeline for the server and SOM half (the schema, the checks,
  the ingest), Claude for the client. More independence where the protocol
  changes, at OpenRouter cost.

## 4. The contract (written for the recommendations)
Where an option not recommended is chosen, the brief changes the item named.
A1–A10, R1–R10 and K0–K10 hold for every member where this says nothing.
"Member" means the root or any node under it; "generation" is a member's
distance below the root.

- **T1, the tree rule, one rule in two places.** `checkAddNode` (both copies)
  gains `children`, and both copies export **`subtreeShapeProblem(node)`**,
  the cheap first pass that `checkAddNode` calls first and the handler calls
  early (T2): an iterative walk (no recursion over untrusted input) that
  stops at the first bound it passes, checks the count, the depth, every
  member's key set, every member's name form, and names and ids unique
  within the tree, and touches no mesh array and no world state:
  - `children`, when present, is a non-empty array of plain objects; each is
    checked as a node, recursively, with the same `{ avatar }` (so an avatar
    with `children` is refused: **`avatar-children`**, "an avatar carries no
    children"). Lengths and key sets first: the member count and depth are
    checked **before** any member's mesh (add-check round 2's R4);
  - **the tree bounds** (SA-L2): at most `SUBTREE_NODES_MAX = 256` members
    including the root (**`children-count`**), and no member deeper than
    `SUBTREE_DEPTH_MAX = 8` generations (**`children-depth`**);
  - **names:** every member's `name` is a string that passes the D3 form
    (non-empty, at most 256 characters, not `__document__`, no `.camera` or
    `.light` suffix, no `/`), and **no two members share a name**
    (**`children-names`**). Whether a name is in use in the world is the
    handler's (T2), as today;
  - **ids:** no two members carry the same `extras.atrium.objectId`
    (**`children-ids`**). Whether one is in use in the world is the
    handler's;
  - a member's own form is today's rule: a mesh member passes A3/A4/R1, a
    model member has no mesh (`checkModelHost`, run per member by the
    handler), and so on. The vectors file gains the tree cases (§5). Both
    `ADD_REASONS` stay identical.
  - The D3 name form is now in three places (`checkNewName` and both
    `checkAddNode` copies); the vectors pin the two copies to each other, and
    a server unit test pins the server copy to `checkNewName` over the same
    names.
- **T2, the server.** In the `add` handler, for a world `add` whose node has
  `children`, **in this order:**
  1. **after the gate and R6, before `isBlockedParent`:** `subtreeShapeProblem`
     (T1), in a `try` of its own that fails closed (V9). Nothing that scans
     the world runs on a tree that hasn't passed it (§2.6, fresh-agent M1);
  2. **every per-node check runs for every member, before the first world
     change:** S2's `source` (`addSetsAtriumSource`) walks the tree. **K4 is
     unchanged** (`msg.id && …`, avatar-only; an avatar tree is already
     refused `avatar-children`, and applying K4 to world members would refuse
     every pad and behaviour member). `checkNewName` for every member's name
     (so a member whose name the world holds is refused as the root is,
     "already in use" included); **the ids against one `Set` of the world's
     saved ids, built once per message** in one pass over `_savedNodes()`
     (not `objectIdInUse` per member, which scans the world each time; the
     root's single-node check may keep `objectIdInUse`);
     `checkTransformValues` per member; `checkAddNode` (which re-runs the
     shape pass, cheap), `checkAtriumExtras` and `checkModelHost` per member,
     in the V9 `try`; the behaviour caps count **every member's** leaf: the
     world's existing count plus the tree's must stay within 64, and the
     bytes within 1 MiB. The first refusal is answered with that member's
     reason, as today's codes and texts, and nothing has changed;
  - `isBlockedParent` applies to `msg.parent`, the root's parent, as today.
    Members' parents are their position in the tree;
  - **both `world.addNode` copies** (`createWorld`'s, L573–590, and
    `createWorldFromDocument`'s, L721–738) ingest the tree: `ingestNode` (T3)
    builds the root and its members; the root goes under `msg.parent` or the
    scene. Each copy's duplicate-name guard checks every member;
  - the broadcast is `msg.node` as sent, children included, one message;
  - an **avatar** `add` is never a tree (T1's `avatar-children`), checked in
    the avatar's own `try` before anything else, so a visitor can't make a
    hundred nodes appear.
- **T3, `ingestNode` keeps `children`,** on the server and every client (one
  function): after the node's own fields and mesh, each entry of
  `descriptor.children` is ingested recursively and added with `addChild`, in
  order; **one buffer per call**, the message's (created at the first
  accessor of any member: roots are usually meshless), shared by every
  member's accessors (CR-M2's reasoning: ingest cost grows with the buffer count;
  `removeSubtree`'s prune disposes it when the last member using it goes, and
  a part removed alone leaves it for the rest). It returns the root. It still
  doesn't check: `checkAddNode` ran first on the server, and a client ingests
  only what the server broadcast.
- **T4, the client.** `_onAdd` ingests the tree inside `applyLocally`,
  attaches the mutation listeners to **every member** (as the dump path does,
  L1893–1895), then emits **`som:add` once per member, the root first, then
  in document order**, each `{ nodeName, root }` where `root` is the root's
  name (a single node's event is `{ nodeName, root: nodeName }`), then
  resolves the pending add (`_resolveAccepted`). So the pad rebuild, the Z6
  handover, the runner's scan, the model bridge and `addSeen` see every member
  without changing (§2.3; the fresh-agent check prototyped this and found
  each idempotent or correct under N events), and the Undo engine's
  `acceptAdd` captures the whole tree, which is in the SOM before
  `edit:accepted`. **`app.js`'s `undo.reCapture()` on `som:add` runs only for
  the root's event** (`nodeName === root`): one tree capture per message, not
  one per member (§2.6). The `som:remove` path is unchanged (one event, the
  root).
- **T5, Duplicate, Undo and Redo** (`edit-duplicate.js`, `edit-undo.js`,
  `app.js`):
  - **`duplicateRuleProblem` drops its `children` rule** and asks every rule
    but `parent` of every member; the first refusal is reported with the
    member's name in the detail ("…(in “lamp-shade”)", the name through
    `shownText`, `copy-paste.js` L84) when the member isn't
    the root. **`parent` stays** for the root: a part isn't duplicated or
    restored on its own (§1). Two new rules: **`names`** ("Its parts don't all
    have distinct names": a member's name empty, failing the D3 form, or held
    by another member) and **`tree`** ("This object has too many parts, or
    parts too deep": SA-L2's bounds). A member whose name another node **in
    the world** holds passes here for Duplicate (the copy is renamed, below);
  - **a restore needs every member addressable by its own name** (fresh-agent
    check, S6): the Undo engine's `capture` refuses a tree any member of which
    isn't `som.getObjectByName(member.name)` (a shadowed duplicate, or a name
    an animation or a `.camera`/`.light` alias took first: §2.1), with the
    reason "One of its parts can't be restored under its own name". The
    capture failing makes Delete ask first (SA-L4), so such a group is never
    deleted without the question. `createEditUndo` gains the dependency
    (`getObjectByName`, as it has `getNodeByName`);
  - **`buildDescriptor` nests:** each member's descriptor as today, in
    `children`, in `listChildren()` order; the root's name and translation
    are the copy's or the restore's, every member keeps its own name and
    local TRS;
  - **Duplicate** (`prepareDuplicate`): the root is named `copyName`'d as
    today; **every member whose name isn't free in the world gets
    `copyName(name, isFree)` too**, free against the world and the names
    already chosen for the tree; every member gets a **fresh id**
    (`withNewObjectId`, as the root does today), and **one map** from every
    member's old id to its new one remaps every behaviour in the tree
    (`remapBehaviorTargets` takes the map: a reference to a member becomes a
    reference to its copy; every other id stays, a grant, F-L10). The whole
    message is measured and run through `add-spec.js` (A7);
  - **Undo and Redo** (`prepareRestore`): the tree exactly as it is, names
    and ids kept; `hasSharedMaterial` walks the members (SA-L3 (a)) **at both
    call sites** (`prepareRestore`'s, and `registerDelete`'s own call,
    `edit-undo.js` L311), and the note's text is unchanged. **The fixed point
    holds for trees:** `prepareRestore(ingest(d))` is `sameDescriptor`-equal
    to `d`, children in order, live and after a save and a reload (the
    fresh-agent check prototyped it for the 7 passing fixture groups, both
    ways);
  - **`checkEntry` compares trees:** L565–567's "has children" refusal goes;
    a remove's check is a fresh capture of the whole tree against the
    entry's; a re-add checks that the root's name is free (the server checks
    the members'; a member's name taken meanwhile refuses the re-add with the
    server's text, and the entry is dropped as any refused entry is);
  - **a removal re-captures too** (fresh-agent check, M3): `app.js`'s
    `som:remove` listener (L2684) calls `undo.reCapture()`, as `som:set`,
    `som:add` and `som:rename` do. `reCapture` already ends the window when
    the pending node itself is gone (`edit-undo.js` L347–348); when only a
    member went, the entry's tree becomes the tree without it, so Undo never
    brings back a part another tab removed. Both windows: a click delete and
    `openRemovalWindow`;
  - **a re-add re-points every member's handle** (fresh-agent check, S3):
    `completeAccepted` (L610–611) re-points the root's handle as today, and
    every handle held for a member of the old tree to the new member at the
    same position (the path of child indices from the root), so an older
    entry for a part (an Alt-clicked move or rename) follows the part back
    (W2);
  - **Delete** (SA-L4 (a)): a group whose capture succeeds asks nothing; one
    whose capture fails asks today's question with `countDescendants`. The
    held-removal logic already covers the members (`collectSubtree`);
  - the Edit panel's Duplicate hint runs the tree rule on every event as it
    runs today's (`minGeometryBytes` per member; 33 members in the largest
    fixture, 3 on PROD);
  - **only when the server's level allows it** (T7): with no `addFields` of 3
    or more in the server's `hello`, a group is treated as today: Duplicate
    refuses it with `children`'s reason and Delete asks first.
- **T6, Copy and Paste** (`copy-paste.js`, `app.js`):
  - **Copy** takes the tree: `duplicateRuleProblem` (credit skipped, every
    member), `buildDescriptor` nested, the size, and `names` collects the
    source names of **every member's** foreign ids; **a member's reference to
    another member isn't foreign** (`foreignIds` takes the set of member ids,
    not one). The snapshot holds the tree;
  - **Paste** applies its steps to **every member**: the name (the original's
    if free, else `copyName`; for members as Duplicate names them), the
    translation (the **root's** x and z from the palette, y the root's own;
    members keep their local TRS), a fresh id per member with **one map** (as
    T5), the `extras` whitelist per member (K6's `ATRIUM_KEYS`, the
    `teleporter` exactly `{ destination }`), the **hidden marker removed from
    the root only** (§2.4: a hidden part is the author's design and the
    paster can Alt-click it; a paste is visible as a whole), the behaviour per
    member (K7 with the map: **same world** → the map and nothing else, as
    Duplicate; **another world** → the map first, then `enabled: false` and
    every id that is neither the member's own nor a member's replaced through
    one fresh-id map for the whole tree, recorded in **that member's**
    `copiedFrom.refs`), the URLs per member (K8: models and pads anywhere in
    the tree), **the credit per member** (K2: `origin` by its three rules for
    each member, `copiedFrom` on each), then the size, A7 and
    `atriumProblem` per member, and K7's entry-0 check per member;
  - **K8's other-host question is asked once per host,** not once per model
    member: one question names every host the tree's models load from that
    isn't the destination's;
  - **the Inspect panel and the paste note** show the root's credit and
    summarise the tree: "N parts" after the name, **N the members below the
    root** (the lamp: "2 parts"), and the behaviour summary of every member
    that has one, each named; the K7 notes name the member ("Its part
    “Button” referred to…");
  - **hidden parts travel** (§2.4): a visitor's Copy of a group carries a
    hidden part, stated in the Inspect panel as "includes N hidden parts"
    when there are any. Not new exposure: the `som-dump` already holds them;
  - the structure tracker, the paste branch and Undo's `registerAdd` are
    unchanged: one request. **The one "already in use" retry re-chooses the
    names only** (`retryPaste`, `app.js` L2999–3011): every member's name is
    chosen again against the SOM as it now is, on the descriptor already
    prepared. Nothing else is prepared again: the position, the ids and
    K8's answers stay as they were (a full re-prepare would ask K8's
    question again outside the click, move the paste, and draw new ids:
    fresh-agent check, S4);
  - **only when the server's level allows it** (T7): Paste of a group into a
    world whose server sent no `addFields` of 3 or more says "This server
    can't take objects with parts yet" and sends nothing.
- **T7, version skew, both ways.**
  - **An old tab on the new server (R6 widened).** The client sends
    `addFields: 3` exactly where it sends 2 today; `isStaleEditor` refuses a
    world `add` and every `remove` from a session with `scriptRunner` and
    `addFields` under **3**; `STALE_CLIENT_MESSAGE` and the avatar exemption
    are unchanged. The tests and the harness check of §2.7 move (`addFields:
    3` where 2 is sent; the "later page" cases to 4). `hello.client.json`'s
    description names 3. Accepted limitations as R6's.
  - **A new tab on an old server (fresh-agent check, M2).** The server's
    `hello` gains `capabilities.addFields: 3` (`hello.server.json`'s
    `capabilities` gains `addFields`, `{ "type": "integer", "minimum": 1 }`,
    as the client's), sent to every session. The client keeps it as
    `client.serverAddFields` (an integer ≥ 1, else `null`; reset where
    `client.world` is reset), and T5 and T6 treat a group as duplicable,
    restorable and pasteable **only when it is 3 or more**. Against a
    `42aa56ff` server (no key) a group is handled exactly as today: its
    Duplicate refused with `children`'s reason, its Delete asking "… and N
    objects inside it? This can't be undone.", its Paste refused. So a
    rollback can't make a new tab's group delete silently permanent.
- **T8, the schemas (AGENTS rule 1).** `add.client.json` and `add.server.json`:
  `node` gains `children`, an array (`minItems` 1) whose items are the node
  schema itself (`$ref` to `#/definitions/node`, so the two files stay
  identical in their `node`; the fresh-agent check ran it under the repo's
  Ajv, `strict: false`, draft-07: the protocol suite passed); the bounds, the
  name rules and the id rules stay in T1. **A new protocol test deep-compares
  the two files' node definitions** (none does today). The schema's
  `minItems: 1` and `name`'s `minLength: 1` refuse `children: []` and an
  empty member name before the handler runs: those server tests see
  `UNKNOWN_MESSAGE` with Ajv's text, and only the direct vector calls see
  T1's codes (A8's "which layer refuses what"). `hello.server.json` gains
  T7's key. The protocol tests change with them, in the same commit as T1.
- **T9, nothing is migrated.** Undo entries live in memory; saved worlds are
  untouched; a world written after this round reads in `42aa56ff` (plain
  glTF). **A rollback** stores nothing to undo, and T7's server level makes a
  new tab on the old server handle groups as today (§2.7). A tab on the new
  client still connects to the old server (its `addFields: 3` passes the old
  schema and `isStaleEditor`).
- **T11, parts (SA-L7 (a)).** A **part** is a node whose parent is a node: an
  Alt-clicked mesh part, or a sub-group with members of its own (then also a
  tree, T1–T6).
  - **The rule:** `duplicateRuleProblem`'s `parent` rule is replaced by an
    **`ancestors`** rule: no ancestor carries `extras.atrium.source`
    (`external`'s reason, as for the node itself) or is an avatar
    (`isEditExcluded`). Every other per-node rule holds for the part, and
    T5's tree rules for a sub-group. At the click, `app.js` also requires the
    **parent addressable by its name** (`getObjectByName(parent.name) ===
    parent`), else "Its group can't be found by its name". The server's own
    `isBlockedParent` and parent-exists checks are unchanged;
  - **the client API:** `AtriumClient.addNode(descriptor, { parent } = {})`
    sends `parent` when it is a string; Duplicate, `structural` and the paste
    branch pass it (a paste never does: it lands at the top level);
  - **Duplicate in place:** the copy goes under the same parent (`parent`:
    the parent's current name), named and given ids by T5's rules, with the
    offset `+1.5` on its **local** x, as today's descriptor does (so in a
    rotated or scaled group the offset turns and scales with the group:
    stated, not changed);
  - **Undo and Redo:** a part's delete entry records its **parent as a
    handle** (`handleFor(parent)`), so a rename of the group, or the group's
    own delete and Undo, keeps it pointing at the live group (T5's
    re-pointing). A re-add sends `parent`: the handle's current name.
    `checkEntry` refuses a re-add whose parent isn't alive ("Can’t undo:
    “X” its group was removed."), and the entry is dropped as any refused
    entry is. A part's descriptor holds its **local** TRS, so the fixed point
    is unchanged. A part whose capture succeeds is deleted without the
    question (W6), as a top-level object is;
  - **child order:** T5's tree comparison (`sameDescriptor` over a capture)
    treats `children` as a set keyed by member name (names are unique within
    a tree, T1), so a part's re-add, which appends it (§2.8), doesn't make
    its group "changed elsewhere". The re-added part comes back last among
    its siblings, which nothing shows: stated;
  - **Copy:** the snapshot's root takes the part's **world** transform:
    `worldMatrix(node)` decomposed into a translation, a unit rotation and a
    positive scale. The copy is refused, with "Its group’s rotation and scale
    can’t be carried with it", when recomposing that TRS doesn't reproduce
    the matrix within 1e-5 per element (a shear: a non-uniform scale on an
    ancestor with a rotation below it), or when the TRS fails K6 (`transform`,
    as today). The members below the root keep their local TRS. Paste then
    treats the snapshot as a top-level object: x and z from the palette, y
    the root's **world** y;
  - **references outside the copied tree** (to the part's parent or
    siblings) are like any other id outside the tree: a Duplicate in place
    keeps them as grants (F-L10, T5's map leaves them alone); a Paste into
    another world replaces and records them (K7); a Paste into the same world
    keeps them, as Duplicate does;
  - **the server level** (T7): a part with no children uses only `parent`,
    which every released server honours, so its Duplicate and Undo work
    whatever the server's level; a sub-group is a tree and needs level 3, as
    any group;
  - **Inspect:** a click still lifts to the nearest container (§2.4), and
    Alt-click picks a part; Copy is offered for either.
- **T10, what doesn't change:** `remove` and its rules; `send`; `parent` on
  the message and `isBlockedParent`; A5's numbers beyond `avatar-children`;
  the palette, pad, model and avatar builders (no children; they pass); the
  Behaviour panel; the runner; the model bridge; K0–K10 for a single object
  (a tree of one is today's `add`: no `children` key is emitted for a node
  without children, so a single object's descriptor is byte-for-byte today's,
  and the vectors' accepted cases stay accepted).

## 5. Tests and proofs
- **Run on today's code first, and keep the failures in the handoff:** the
  server test file's tree tests on `70a30bd2` (the schema refuses every
  `children`).
- **The vectors,** both suites: a tree of 2, of 256 and of 257 members; depth
  8 and 9 (a chain); a member with an empty name, with a `/`, with `.light`;
  two members with one name; two members with one id; an avatar with
  `children` (`avatar-children`); a member with a mesh A3 refuses (the
  reason is the member's); a model member with a mesh; a member with every
  R1 field (accepted); `children: []` (refused: `children-count`); the tree
  bounds checked before a member's mesh (a 257-member tree whose last member
  has a malformed mesh is refused `children-count`); a member carrying
  `__atrium_visible: false` (accepted: PROD may have one, §2.5); member names
  `__document__` and 257 characters (both refused, the T1 name form, pinned
  to `checkNewName` by a server unit test).
- **A new server test file, port 0, through the real `attachSessionHandlers`,
  run on both world kinds** (a file world through `createWorld`, as the
  commons is, and a document world through `createWorldFromDocument`;
  passdown §3 lesson 3, fresh-agent check S1):
  - a 3-generation tree with a mesh member, a pad member, a model member and
    a behaviour member: accepted, broadcast as one message; a present client's
    `ingestNode` has every member under its parent; a later joiner reads its
    `som-dump` with the client's own `WebIO` and finds the tree; `serialize`
    → `createWorldFromDocument` → `serialize` keeps it; the document gains
    **one** buffer, and removing the root removes it;
  - each T2 refusal changes nothing and is broadcast to no one: a member's
    name in use in the world; a member's id in use; a member with `source`;
    a member whose behaviour would take the world past 64; a member with a
    non-unit rotation (K6's text); a member's model with a mesh;
  - **T2's order** (fresh-agent check, M1): a tree of 257 near-empty members,
    each with an id, in a world of 500 nodes, is refused `children-count`
    with the reply under 100 ms, and **`objectIdInUse` is never called**
    (counted through a wrapped `som`); a valid 256-member tree with ids is
    accepted with the reply under 500 ms;
  - **an 8-generation tree with a template leaf on its deepest member**
    (message depth 27): accepted, and `message-depth-measure.test.js` then
    records it (its 32 ceiling holds; check that file's run time stays inside
    its 180 s budget with the new file in the suite);
  - `remove` of the root removes every member on the server and on a present
    client (today's behaviour, now with an added tree);
  - a part removed alone (`remove` of a member's name) leaves the rest and
    the shared buffer;
  - **T7:** `{ scriptRunner: 3, addFields: 2 }` is refused for a world `add`
    and a `remove` with R6's text and its avatar `add` accepted; `addFields:
    3` and `4` accepted; neither capability accepted; the moved tests of
    §2.7 pass; **the server's `hello` carries `capabilities.addFields: 3`**,
    valid against `hello.server.json`.
- **`packages/som`:** `ingestNode` with `children`: the tree, the order, one
  buffer for a tree of 64 mesh members; a node without children emits
  today's document; `removeSubtree` of a tree ingested this way prunes the
  buffer.
- **`packages/client`:** `_onAdd` with a tree: every member in the SOM,
  listeners on every member (a mutation on a child sends), `som:add` once per
  member root first, each carrying the root's name, then `edit:accepted`;
  the hello carries `addFields: 3` exactly when it carries `scriptRunner`;
  `client.serverAddFields` is 3 from a new server's hello, `null` from a hello
  without it (a `42aa56ff` server) or with a malformed value, and reset at
  disconnect. **The two-world e2e** (`copy-objects-e2e.test.js`, one server,
  two worlds routed by path) gains a group paste: copied in world A, pasted
  in world B, B's next joiner sees the tree with each member's credit.
- **`packages/renderer-three`:** a tree ingested through `DocumentView`,
  headless (as `p9` does): every member's object is under its parent's, a
  hidden member isn't rendered, a pad member's world position follows the
  root (`worldPosition`).
- **`apps/client`:**
  - `duplicateRuleProblem` over every fixture group: `Walls`, `Columns`,
    `Furniture`, `Fountain`, `Lamp`, `lamp-01` and the harness `Group` pass;
    `NestedCameraMount` and `AnimatedCameraMount` are refused with the
    member's reason and name; a part is still refused `parent`; a tree of 257
    and a chain of 9 are refused `tree`; two members named alike, `names`;
  - **the fixed point** over every fixture group that passes, live and after
    a save and reload, children in order, and over a group with a hidden
    part (PROD's one, §2.5): Duplicate and Undo keep the part hidden;
  - Duplicate of `lamp-01` in `space.gltf`: the copy is `lamp-01 copy` with
    members `lamp-shade copy` and `lamp-stand copy` (their names are in use),
    each member a fresh id, the root 1.5 along x, members' local TRS kept
    (a Duplicate in the same world always renames its members: the
    original's hold their names; a member whose name is free keeps it only in
    a Paste into another world, tested there);
  - **the behaviour map:** a tree whose child's template targets the root,
    and whose root's custom graph names the child in `nodeMap` and `targets`:
    after Duplicate both reference the copies and pass `behaviorCheck` and
    `matchesTemplate`; an id outside the tree is kept;
  - the Undo engine: Delete of a group asks nothing and is recorded; Undo
    restores it under its names and ids; Redo removes it; a child moved by
    another tab while the delete is pending re-captures the tree (the
    restored child is where it was moved to); **a member removed by another
    tab while the delete is pending stays removed after Undo** (M3), for a
    click delete and for an undo's removal (`openRemovalWindow`); a child
    added to the group by another tab after the entry was recorded refuses
    the redo-of-delete as "changed elsewhere" (the tree capture differs); **an
    older entry for a part (a move made on the Alt-clicked shade) still
    undoes after the group is deleted and restored** (S3); a group with a
    member whose name an animation holds can't be captured, and its Delete
    asks (S6); `serverAddFields` `null` → the group's Delete asks and its
    Duplicate is refused (T7); the sharedMaterial note for `Columns`, through
    both call sites;
  - **the existing tests that encode today's group rules are rewritten, not
    kept green** (fresh-agent check, S12): `edit-undo.test.js` L710–865
    ("a group … can never come back", "grew a child …" → `DELETE_CHANGED`),
    `edit-duplicate.test.js` L116, L196, L443, L494, and `copy-paste.test.js`
    L244. Each becomes the tree case it now is, or a `serverAddFields: null`
    case where it tests today's behaviour;
  - **Copy and Paste**, pure: same world (the map, grants kept, enabled kept);
    another world (every member disabled, member references kept through the
    map, a foreign reference replaced and recorded on **that member**, the
    root's and each member's credit, the hidden marker gone from the root and
    kept on a hidden child, a model member's root-path URL resolved, a pad
    member's path resolved, an unknown `extras.atrium` key on a child
    dropped and noted with the member's name; a member's free name kept); a
    group over the cap can't be copied; the Inspect summary's "N parts" (2 for
    the lamp), "includes N hidden parts", and per-member behaviour lines; one
    K8 question for two model members on one host; the retry re-chooses names
    only (the position, ids and K8 answers unchanged, `confirm` not called
    again); a Paste of a group with `serverAddFields: null` refused with its
    sentence;
  - `app.js` wiring (as text, as the existing wiring tests do): the delete
    question is skipped for a restorable group and asked, with the count,
    for one that isn't.
- **T11, parts** (`apps/client`, pure, and `packages/client`):
  - `addNode(d, { parent: 'lamp-01' })` puts `parent` on the wire, and
    without it nothing changes (the existing `addNode` tests pass);
  - Duplicate of the lamp shade: `lamp-shade copy` under `lamp-01`, local x
    + 1.5, a fresh id; of `Bench-NE` in `atrium.gltf`: a tree under
    `Furniture`, every member renamed;
  - Delete of the shade asks nothing and Undo puts it back under `lamp-01`
    with its name, id and local TRS; the lamp's own older Add entry still
    undoes afterwards (child order ignored); Undo after the lamp was renamed
    sends the new name as `parent`; Undo after the lamp was deleted refuses
    with "its group was removed"; Undo after the lamp was deleted and
    restored puts the shade into the restored lamp;
  - Copy of a part of a group moved, rotated 90° about y and uniformly scaled
    2: the pasted root's world placement equals the part's (within 1e-5);
    Copy of a part under a non-uniformly scaled, rotated group is refused
    with the shear sentence; a behaviour on the shade that targets the stand
    keeps it on a same-world Duplicate and has it replaced and recorded on a
    Paste into another world;
  - an `ancestors` refusal for a part of an externally loaded node, and for
    a part whose parent isn't addressable by its name;
  - **the server test file** (both world kinds): a Duplicate-in-place `add`
    with `parent` is accepted and broadcast with `parent`, and a present
    client has it under the parent.
- **Proofs** (each break made, the named tests seen failing, the file restored
  from a saved copy):
  - (p1) T2's per-member name check **and** `world.addNode`'s per-member
    duplicate-name guard removed: the member-name-in-use server test fails,
    **and the world holds two nodes of one name** (with only the handler's
    check removed, the guard still refuses with "node name already exists",
    so the test asserts `checkNewName`'s exact text: fresh-agent check, S7);
  - (p1b) T2's shape pass moved after the per-member checks: the
    257-member timing test fails (`objectIdInUse` is called);
  - (p2) T3 back to one buffer per member: the one-buffer tests fail;
  - (p3) T4 emits `som:add` for the root only: the `packages/client` test
    "`som:add` once per member" fails, and so does an `apps/client` wiring
    test that a pad member added in one message is in `derivePads`' result
    after the `som:add` handler runs;
  - (p4) T5's `checkEntry` tree comparison reduced to the root: the
    child-added-meanwhile test fails;
  - (p5) T6's member map removed (self-references only): the child-targets-
    root tests fail under Duplicate and both Paste cases;
  - (p6) T7's level left at 2: the stale-session tests fail; (p6b) the
    client ignores `serverAddFields`: the old-server tests fail;
  - (p7) T1's depth bound removed: the depth-9 vectors fail in both suites;
  - (p8) the `som:remove` re-capture removed: the member-removed-meanwhile
    tests fail;
  - (p9) T11's Copy keeps the part's local transform: the world-placement
    Copy test (a part of a moved and rotated group pasted where it appeared)
    fails; (p9b) T11's re-add without `parent`: the part-Undo test fails (the
    shade comes back at the top level).
- **Claude's checks before DEV acceptance:** on the published SHA, `p10`
  rerun (every passing group's one-message size unchanged), `p1`/`p2`
  (richer-add) unchanged for single objects, `add-check`'s `p3`, `p4`, `p7`
  and `review-q/q2` still refused; `h1`–`h6` and `c2`.
- **The operator's DEV acceptance** (each step names the screen, passdown §3
  lesson 1):
  1. In the commons (a file world), Edit mode, click the lamp (`lamp-01`,
     shade and stand, from `space.gltf`'s seed; any group if it's gone): the
     Edit panel shows `lamp-01` selected, Duplicate is enabled; Duplicate: a
     second lamp with shade and stand appears 1.5 m along; its name in the
     panel is `lamp-01 copy`; Alt-click its shade: `lamp-shade copy`;
  2. Delete the copy: **no question**; the Undo button's title reads "Undo
     Delete “lamp-01 copy”"; Undo: the lamp is back, shade and stand; Redo:
     gone;
  3. (SA-L7) Alt-click the original's shade: the panel shows `lamp-shade`
     alone, Duplicate is enabled; Duplicate: `lamp-shade copy` appears 1.5 m
     beside the shade **and** a click on it selects the whole lamp (it's in
     the lamp); Undo removes it. Delete the shade: **no question**; Undo: the
     shade is back on the lamp;
  4. Sign out, Inspect the lamp: the panel offers Copy (not the children
     reason) and says "2 parts"; Copy; sign in, teleport home (a document
     world), Edit, Paste: the lamp appears ahead with its parts, the Edit
     panel's Credit row names the commons' owner; Alt-click a part: its own
     Credit row names it too; Undo removes the lamp;
  5. A second tab opened **before** the deploy (it reconnects at the restart
     and reads the lamp whole, §2.7): Duplicate of `crate-01` and a palette
     add each show "this page is older than the server: reload it to keep
     editing"; Delete of the lamp **asks first** (its old rules), and on
     OK shows the same refusal; the lamp is still there; a reload fixes it;
  6. **On PROD after the deploy:** the operator duplicates one of the 9
     groups, deletes the copy and presses Undo.

## 6. Worker rules and release path
As `copy-objects` (`PREBRIEF-copy-objects.md` §6), with these specifics:
- **`p6` on PROD: done for the pre-brief** (Rev 1.1, §2.5). **Rerun before
  the PROD deploy,** at the round's commit or later, as every round; a group
  whose shape differs from §2.5's is shown to Claude before PROD. On the host:
  ```bash
  sqlite3 /var/lib/atrium/atrium.db ".backup /tmp/atrium-survey.db"
  rm -rf /root/tmp-survey && git clone -q --depth 1 https://github.com/joshmaurice/atrium /root/tmp-survey && cd /root/tmp-survey
  git log -1 --oneline
  pnpm install --frozen-lockfile --ignore-scripts
  node devtasks/spike-richer-add/p6-db-survey.mjs /tmp/atrium-survey.db
  rm /tmp/atrium-survey.db
  cd ~ && rm -rf /root/tmp-survey
  ```
- **Five commits, each runnable:**
  1. T1 and T8: the vectors, both copies of the tree rule, the schemas and
     their unit and protocol tests;
  2. T2 and T3: the handler, `world.addNode`, `ingestNode`, the SOM tests and
     the new server test file;
  3. T7: `AtriumClient.js`, `isStaleEditor`, the server hello's level and
     `client.serverAddFields`, both hello schemas, the moved tests and
     `c1.py`;
  4. T4 and T5: `_onAdd`, `edit-duplicate.js`, `edit-undo.js`, the delete
     question in `app.js`, the renderer test, their tests;
  5. T6: `copy-paste.js`, the Inspect summary and paste notes in `app.js`,
     the end-to-end tests;
  6. T11 (SA-L7): `addNode`'s `parent`, the `ancestors` rule, Duplicate in
     place, the part's Undo, Copy's world placement, their tests; the full
     suites, proofs (p1)–(p9) and the handoff.
- **Files:** `packages/server/src/send-policy.js`, `session.js` (T2, T7's
  `isStaleEditor` and the server hello's level), `world.js` (both `addNode`
  copies); `packages/som/src/SOMDocument.js`;
  `packages/protocol/src/schemas/add.client.json`, `add.server.json`,
  `hello.client.json`, `hello.server.json`; `packages/client/src/add-spec.js`,
  `AtriumClient.js` (T4, T7's `serverAddFields`); `apps/client/src/edit-duplicate.js`,
  `edit-undo.js`, `copy-paste.js`, `app.js` (the delete question, the
  `som:add` re-capture on the root's event, the `som:remove` re-capture, the
  Inspect summary, the paste notes and retry); `tests/fixtures/add-node-vectors.json`;
  `devtasks/harness/checks/scripting-4d/c1.py` (L53); test files under
  `packages/*/test/`, `packages/*/tests/` and `apps/client/tests/`.
  **No other file.** If the brief or the implementation finds another must
  change, stop and ask. (`edit-structure.js` needn't change: `collectSubtree`
  and the tracker already cover a tree. `index.html` needn't: no new control.)
- **A new check must fail on today's code** before its PASS counts.
  **Server test files one at a time,** each under `timeout 180`, new tests on
  port 0.
- **One outside review of this pre-brief and one of the round's code** (SA-L5).
- **Release:** a server, SOM, protocol and client round. DEV restarts at the
  deploy, and acceptance needs a hard reload in every tab; the stale tab of
  §5 step 5 is opened before it. No `package.json` or lockfile change. **A
  rollback** stores nothing to undo, and a tab loaded on the new client that
  connects to the old server sees no server level and handles groups as
  today (T7, T9). **Check DEV's actual SHA with `release_status` before
  reading an acceptance as done** (passdown §3 lesson 4), and `git diff
  <reviewed> <dev> -- . ':!devtasks'` before the MAIN and PROD commands.
- **Never push to `main` between the release merge and PROD `COMPLETE`.**

## 7. Review log
- **Rev 1.3** (2026-11-07, evening): **SA-L7 added**, on the operator's
  question (17:50 PT: "if Bench-NE is selected, why wouldn't we want it
  copyable"). Claude's answer: the `parent` refusal is a holdover from
  Duplicate's first round, and `add` already carries `parent` both ways. New
  §2.8 (facts at `70a30bd2`: `addNode` doesn't expose `parent`; local TRS;
  `worldMatrix`; `addChild` appends), T11, its tests and proofs (p9), DEV step
  3 rewritten, a sixth commit, §8's part item now conditional on SA-L7 (b).
  **Recorded:** SA-L2 (a), SA-L3 (a) and SA-L6 (a), as recommended (operator,
  17:37: "no preference"). Not yet checked by a fresh agent: T11 is new.
- **Rev 1.2** (2026-11-07, evening): a fresh Claude agent checked Rev 1.1
  against the code at `98584307` (it hadn't written it: read every cited line,
  prototyped T3's ingest and prune, T4's per-member events, T8's recursive
  schema and T5's fixed point in a scratch copy, ran a 3-generation tree and a
  `42aa56ff` client through the real handlers, and wrote eleven probes in
  `/tmp/subtree-check/`). 59 of 71 facts confirmed. Claude reproduced each
  must-fix and each corrected fact in the source before taking it. Taken:
  - **M1, must-fix:** per-member world lookups ran before the tree bounds,
    and `objectIdInUse` is a linear scan, so a home-world owner could stall
    the process (§2.1, §2.6). T1 gains `subtreeShapeProblem`, run first; T2
    checks ids against one set per message; a timing test and proof (p1b);
    SA-L2 (c)'s count corrected (57,000, not 8,000);
  - **M2, must-fix:** a rollback made a new tab's group delete silently
    permanent (§2.7: the old server accepts `addFields: 3` and refuses the
    tree Undo). T7 gains the server's level in `hello`
    (`hello.server.json`), and the client handles groups as today without it;
    proof (p6b);
  - **M3, must-fix:** no `som:remove` listener re-captures a pending delete,
    so Undo could restore a part another tab removed (§2.2). T5 adds the
    re-capture; test and proof (p8);
  - **should-fix:** both `addNode` copies, tests on both world kinds (S1);
    nested groups can't be selected whole (§2.4, new **SA-L6**) (S2);
    member handles re-pointed after a re-add (S3); the paste retry re-chooses
    names only (S4); K4 stays avatar-only (S5); a non-addressable member
    makes the capture fail, so Delete asks (S6); proofs (p1), (p3), (p7)
    rewritten to reach their effect (S7); the impossible same-world "names
    kept" test moved to Paste (S8); DEV step 5 uses `crate-01` and expects
    the Delete question (S9); "N parts" is the members below the root (S10);
    hidden parts travel with a visitor's Copy, stated (S11); the existing
    group-rule tests named for rewriting (S12); the two-world e2e gains a
    group paste (S13);
  - **nits:** the depth ceiling allows 10 generations, 8 is a margin; the
    schema refuses `children: []` and empty names first; one re-capture per
    message; one K8 question per host; the D3 form pinned in three places;
    a deep-compare of the two `node` schemas; "the message's" buffer;
    `registerDelete`'s own `hasSharedMaterial` call; the measure test's run
    time;
  - **corrected facts:** the two `addNode` copies; `objectIdInUse`'s scan;
    nearest-meshless selection; the deepest behaviour leaf (12, not about
    13); `p6`'s hidden-marker count is the key, not hidden; `p6`'s name
    counter covers nodes only; the missing `richer-add.test.js` L459–461;
    `allNodes`' file; `healDocumentObjectIds`' lines; line drift in
    `retryPaste`, the Delete handler and `nearestNonMeshAncestor`; the Delete
    question's straight quotes.
  
  Confirmed sound by that check: the recursive schema under the repo's Ajv;
  T3's one buffer and its prune with a part removed alone; T5's fixed point
  for the 7 passing fixture groups, live and after a reload; T4's per-member
  events against every listener; a live tree in `DocumentView`; §2.7's stale
  tab, end to end; `p10` and the depth figures; SA-L1 (b)'s and (c)'s hazards;
  `isBlockedParent`; `send` refusing `children[n]` paths.
- **Rev 1.1** (2026-11-07, 17:00 PT): the operator's `p6` run on PROD at
  `530c636` (§2.5). The 9 groups are all 3 nodes, depth 1, at most 16,656
  bytes as one message, every member passing the per-node rule; no root mesh,
  no member id, behaviour, pad, model or name collision; one hidden part.
  **Reopens nothing:** SA-L1 and SA-L2 stand, and T5's renaming is needed
  only for the copy's own names. Added: the hidden part to §5's vectors and
  the fixed point; §6's `p6` step is now the usual pre-PROD rerun. `p6`'s
  credit label reworded (5 pastes on PROD carry one).
- **Rev 1, DRAFT** (2026-11-07, against `70a30bd2`): written from the
  passdown's item (§5 item 1) and the design doc's item 7. Facts found while
  writing it:
  - **`parent` already travels on `add`, both ways** (§2.1), so a group could
    be built as N messages today: SA-L1 (b) and (c) exist because of it;
  - **the message-depth ceiling fixes the depth bound at 8** (§2.1: a
    template leaf is depth 11, two levels per generation, 32 the ceiling);
  - **`som:add`'s pad and model listeners look at the root only** (§2.3), so
    a one-message tree needs T4's per-member events or three listener
    changes;
  - **Alt-click selects a part** (§2.4), which settles the hidden marker's
    scope (root only) and shows that parts are already editable alone;
  - **every fixture group's root is meshless** and the largest group is 113 KB
    as one message (§2.5); the two refused groups are refused for a camera
    and an animation, as today;
  - **`acceptAdd` captures on the sender's echo** (§2.2), which is SA-L1
    (c)'s hazard.
  New probe `p10`; `p6` extended with the subtree-add counters (tested on a
  scratch database); `/tmp/depth-probe.mjs` for §2.1's numbers (not kept).

## 8. Follow-ups this file records
- **Nested groups' selection** (SA-L6 (a)): `Furniture`-shaped content can't
  be selected whole by a click. If nested groups ever reach PROD (step 7's
  import), SA-L6 (b) or (c).
- **Parts, if SA-L7 is (b):** T11 as written, as a small round after this
  one.
- Grouping and ungrouping in the Edit panel (a `parent` change on a live
  node: a new message or a `send` leaf), after that.
- SA-L3 (b), sharing within a message, if `p6` ever finds shared materials
  on PROD or step 7's import brings them (RA-L3's trigger).
- `p6`'s heading "by richer property" is current; its subtree-add section
  prints counts only, as the rest does.
