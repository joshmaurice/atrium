# Pre-brief: selection and parts (`selection-parts`)

Status: **DRAFT, Revision 1.3 (2026-11-08).** Rev 1.2 plus Fable's outside
review of it (§7, `REVIEW-selection-parts-rev1.2-fable.md`, CHANGES
REQUESTED) and the four decisions it raised, **SP-L9 (a), SP-L10 (a), SP-L11
(a) and SP-L12 (a)**, as recommended (operator, about 18:25 PT). Rev 1.2 was the
fresh-agent check (§7) and **SP-L8 (a)**, which it made necessary (operator,
about 17:40 PT).
Every decision taken (operator, 2026-11-08, 17:04 PT): SP-L2 (b), SP-L3 (b),
SP-L4 (b) as recommended, and SP-L1 (a), SP-L5 (a), SP-L6 (b), SP-L7 (a):
"go with the recs". The
round after `subtree-add`, as decided there: **SA-L6 (d)**, a selection round
of its own (a click selects the top-level group, more clicks drill down, Alt
goes to the leaf, a breadcrumb), **with SA-L7 (c)**, parts (Duplicate in
place, Undo back into the group, Copy out with the world placement: T11).
**Its first item is splitting `message-depth-measure.test.js`** (operator,
2026-11-07; P0 below). Client-only, apart from P0's test files.
- **What it builds on.** `PREBRIEF-subtree-add.md` FINAL Rev 2.1 (T1–T12) and
  everything it builds on (A1–A10, R1–R10, K0–K10) hold unchanged. Its §9
  (T11, drafted for this round) is the starting point. Every line of §9 was
  rechecked against today's code, and its fresh-agent check (§9.5) is taken
  or answered item by item (§7, Rev 1).
- **Against `main` at `dd2071f9`**, whose code is PROD's `45e6cd00` (the
  difference is `devtasks/` only: the passdown). Every line number below is
  at that commit.
- **How it was checked.** Claude read every cited line at `dd2071f9`. Claude
  timed every server test file under the depth recorder in the cloud session
  (§2.1; `devtasks/spike-selection-parts/depth-times.mjs`). Claude also
  reproduced §9.5's M2 with the real `buildDescriptor` (§2.6;
  `devtasks/spike-selection-parts/m2-refs.mjs`). **A fresh Claude agent
  checked Rev 1.1** against the code (§7, Rev 1.2: 50 of 52 facts confirmed,
  2 imprecise; T13, T11's Undo, the TRS decomposition and the offset
  prototyped on the real modules; five real-browser checks through
  `devtasks/harness`). Claude reproduced both must-fixes before taking them,
  must-fix 1 in the browser. **Fable reviewed Rev 1.2** at `3ccc1ad4`
  (cloned, ran the listed commands, drove the real page with a prototype of
  T13, T15 and T17 behind `?proto`); Claude reran its released-code and
  prototype probes on the scratch harness and reproduced every finding it
  took (§7, Rev 1.3). Not yet done: the suites not rerun.
- **Sources:** `PREBRIEF-subtree-add.md` SA-L6, SA-L7, §2.4, §2.8, §8, §9;
  `Atrium-Passdown-2026-11-08-subtree-add-shipped.md` §1.1 (Edit mode selects
  hidden objects on purpose, F-L8), §3 (lessons), §5 item 1;
  `PREBRIEF-edit-mode-ui-1b-2.md` W6 (a restorable delete asks nothing);
  `PREBRIEF-undo-redo.md` W2 (handles), Y2 (capture), Y4 (the check);
  `PREBRIEF-message-depth-guard.md` §6.2 (the measured ceiling).

## 1. What this delivers
**Every level of a group is reachable, and a part behaves like an object.**
- **Selection (SA-L6 (d)), in Edit and Inspect alike:**
  - a click selects the **top-level** object under the pointer (the ancestor
    whose parent is the scene), not the nearest meshless ancestor;
  - a **double-click** goes one level deeper toward what's under the
    pointer, and a triple-click two (SP-L1);
  - while you work inside a group, a click on another part of it selects at
    the same level (SP-L2);
  - **Alt-click** goes straight to the part under the pointer, as today;
  - **a short press on a move handle is a click** (SP-L8): it selects and
    moves nothing, and changes the selection only within the selected
    object's group (SP-L10); a handle drag starts once the pointer travels 4
    px, and never from the second press of a double-click (SP-L11);
  - **a selection change during a handle drag ends the drag first**, keeping
    the move (SP-L9); today such a change can leave the handles stuck until a
    reload (SP-L12, a PROD bug fixed here);
  - a **breadcrumb** in the Edit and Inspect panels (`Furniture › Bench-NE ›
    seat`) shows where the selection is, and each name in it selects that
    level;
  - **Escape** goes up one level before it deselects (SP-L3).
- **Parts (T11):** an Alt-clicked or drilled-to part can be duplicated in
  place (the copy goes into the same group), deleted without the question and
  undone back into its group, redone, and copied out with its **world**
  placement, then pasted at the top level of any world.
- **P0:** `message-depth-measure.test.js` split into shards, each well inside
  the deploy's 180 s per file. With SP-L6 (b), the three suites it left out
  for time are measured too.

**Not in this round:** grouping and ungrouping, or moving a part into another
group (a `parent` change on a live node); selecting several objects at once;
selection in the SOM Inspector tool and the playground (they keep today's
policy, §2.3); a part of externally loaded content (still selected as its
container); material identity and sharing across messages (RA-L3 (c)); the
Edit panel showing that a material is shared (subtree-add §8).

## 2. Verified facts (at `dd2071f9`)

### 2.1 The depth measurement (P0)
- **What it is:** one test (`message-depth-measure.test.js` L67–119) spawns
  `node --import helpers/depth-recorder.mjs --test test/<file>` for every
  server test file in turn (`PER_FILE_TIMEOUT_MS` 150,000 each, L43). Each
  file must exit 0 and on its own. The deepest recorded inbound message must
  be at most `LEGITIMATE_DEPTH_CEILING` 32 (L55), against the guard's 64
  (`message-depth.js` L25).
- **What it leaves out** (`EXCLUDED`, L45–52): `message-depth.test.js` and
  `behavior-walk.test.js` (hostile on purpose), itself, and **for time
  alone** `world-visibility.test.js`, `payload-cap.test.js` and
  `home-world.test.js`. The handoffs reported the full set by a manual run.
- **What it costs** (Claude, the cloud session, 2026-11-08, the same spawn
  per file): **51 files, 122.7 s** (the host's full run took 134.6 s of its
  180 s, subtree-add passdown §5). The three left out take 71.7 s together
  (`world-visibility` 61.2 s, `payload-cap` 5.3 s, `home-world` 5.2 s), so
  the whole set is 194.4 s and can't be one file. The slowest measured are
  `behaviors-rollback` 11.5 s, `activate` 11.3 s, `server-lock` 9.0 s; 17
  files send no message at all (27.3 s together).
- **The deepest message** is depth **27**, an `add` from
  `subtree-add.test.js` (an 8-generation tree with a template leaf).
  `send-field-allowlist.test.js` is next at 12. The three left out reach 3.
- **How the deploy runs it:** `atrium-build-run list-tests` names the
  package suites; the `server` suite globs `packages/server/test/*.test.js`
  with a 180 s timeout per file (server-cleanup passdown §7). So **new
  `*.test.js` files are picked up with no host change.** Any file under
  `packages/server/` restarts DEV at the deploy (`atrium-deploy`'s restart
  rule), test files included.
- **Shards, estimated from these timings** (sorted by name, index mod 3):
  the 53 files other than `world-visibility` split into 44.9 s, 49.4 s and
  38.9 s (18, 18, 17 files), and `world-visibility` alone is 61.2 s. The 51
  of today's set alone split 49.8, 45.8 and 27.1 s. Add about 10% on the
  host (134.6 against 122.7). New suites move files between shards, which
  changes nothing about what is measured.

### 2.2 What a click selects today
- **The click path** (`app.js`): a capture-phase `mousedown` on `#viewport`
  records `pressDown` (L2372–2374, `onHandle: gizmo.dragging`); the `click`
  handler (L2376–2443) runs Inspect's branch first (L2380–2389), then the
  behaviour click outside Edit (L2400–2434), then Edit's selection
  (L2435–2442). Each checks `isSelectClick(down, up, { gestureEnded })`
  (`edit-selection.js` L22–26: less than 4 px of travel, no handle press)
  before it selects. **Nothing reads a click count, and nothing listens for
  `dblclick`** (grep of `apps/client/src`, `packages/client/src` and
  `packages/renderer-three/src`; `model-listeners.js` L36, L38 read the SOM
  pointer events' own `detail`, which is not a click count). In Chromium the
  second press of a double-click carries `detail` 2. **Playwright's
  `mouse.down()` sends `detail` 1 unless given `clickCount`**: the harness
  must pass it (seen in the fresh-agent check's probe).
- **`pickEditTarget(e, { includeHidden })`** (L2326–2357) raycasts, maps each
  hit to the SOM node of the nearest node object (`nodeForHitObject`,
  `edit-selection.js` L104–114), and calls `pickEditSelection(hits, {
  isSeeThrough, isExcluded: isEditExcluded, isDuplicatedName, resolveRoot:
  resolveSelectionRoot, descend: e.altKey })` (L2350–2356). Edit keeps hidden
  hits (F-L8: the owner can select one and un-hide it); Inspect drops them
  (`includeHidden: false`, L2385).
- **`pickEditSelection`** (`edit-selection.js` L133–144) skips see-through
  hits (the local avatar), refuses a hit or a result whose name another node
  holds (`DUPLICATE_NAME_MESSAGE`), and resolves through
  **`resolveEditSelection`** (L47–58): any excluded ancestor (an avatar) →
  nothing; any ancestor carrying `extras.atrium.source` → the **outermost**
  such ancestor (external content is selected as its container, even with
  Alt); otherwise `resolveRoot(hit, { descend })`.
- **The policy** (`packages/interaction/src/selectionModel.js`):
  `nearestNonMeshAncestor` (L13–20) walks up to the nearest ancestor with no
  mesh, else returns the leaf; `resolveSelectionRoot` (L41–47) returns the leaf
  when `descend`, else the policy's answer. **So a click selects the nearest
  meshless ancestor, not the top-level root** (subtree-add §2.4):
  `atrium.gltf`'s `Furniture` can't be reached by a click (its pieces are
  meshless sub-groups, which take the click). A group whose root has a mesh
  is selected whole only from the root's own mesh: a click on a part under a
  meshed root walks past it to the scene and selects the part itself.
- **Selecting:** Edit calls `selectForEdit(node)` (L2283–2292: ends a drag
  in progress, attaches the handles and the outline, refreshes the panel);
  Inspect calls `inspectSelect(node)` (L2024–2040). **The handles are
  attached to the selection at once, and they cover its parts on screen**
  (fresh-agent check, measured with a real mouse on `dd2071f9`; Claude
  reproduced it): a group's origin is at its base and its parts stack above
  it, so the Y arrow and the centre XYZ handle lie over them. With `lamp-01`
  selected the stand is under its Y handle (at 4.4, 5.4 and 7.1 m); with the
  shade selected, the stand is under the shade's Y handle; `Table-Center`'s
  parts are under its Y and XYZ handles, `Fountain`'s under XYZ; any selected
  object's own centre is under XYZ.
- **A press on a handle is a drag at once.** It starts a gesture
  (`dragging-changed`, L2217–2235), sets `pressDown.onHandle`, and
  `isSelectClick` refuses that click: no selection change. The gesture writes
  every pointer move locally at once and **sends its first change after 100
  ms** (`edit-gesture.js` L198 `throttleMs = 100`, L435), then one final send
  at the end. A drag that moves nothing sends nothing and records nothing (R7,
  undo-hold H3); **a drag that moves 2 px does both:** a double-click on the
  stand with `lamp-01` selected, with 2 px of travel on the second press,
  moved the lamp 0.0995 m up and recorded "Undo Move “lamp-01”"
  (`/tmp/sp-check-probes/h-dblclick-jitter.py`, reproduced by Claude). So
  **without SP-L8 a double-click can't drill into a stacked group, and a
  shaky one moves it.** The gesture has a `cancel()` (L447–453: no final
  send) that the app uses only for removed nodes.
- **The handles keep their drag across a selection change** (Fable review,
  M-1; reproduced by Claude on the released code). `attach(object)`
  (`TransformControls.js` L573–580) swaps the object and leaves `dragging`,
  `axis` and `_positionStart` as they were, and every later pointer move sets
  `object.position = offset + _positionStart` (L328): the old object's start
  on the new object. Today only Escape changes the selection mid-drag, and it
  selects nothing (L1646), which detaches. Calling `selectForEdit(parent)`
  mid-drag of the shade, on today's code, leaves `lamp-01` at `[3, 0, 0]` in
  the SOM and **drawn at `[0.6353, 1.4963, -0.3741]`**.
- **A selection cleared mid-drag leaves the handles stuck: a PROD bug today**
  (Fable review, S-1; reproduced by Claude on the released code, all three
  triggers). `syncGizmoEnabled` turns the control off with nothing selected
  (L2205), and its `onPointerUp` returns at once when it is off
  (`TransformControls.js` L730–732), so `dragging` stays `true`; no later
  press starts (L244), every press is marked `onHandle` (L2373), every click
  is refused (L2439), the look-drag doesn't start, and Undo says "Finish
  moving the object first". It lasts until a reload, Edit off and on
  included. Triggers: Escape mid-drag (L1646), another tab removing the
  dragged object (L2745–2748), a disconnect mid-drag (`endEditSession`,
  L2173). Nothing is lost: the drag's last send stands. Calling the
  control's own `pointerUp({ button: 0 })` (L540–553: clears `dragging` and
  `axis`, which fires `dragging-changed`) before the selection changes ends
  it cleanly (Fable's `p5.py`, rerun by Claude).
- **Escape** (`app.js` L1617–1650): in Edit mode, outside a text field, the
  first Escape deselects and the second leaves Edit mode (L1642–1647, B2).
  Inspect has no Escape handling.
- **Other users of the policy:** `tools/som-inspector/src/app.js` (L143, L152)
  and `apps/playground/src/app.js` (L160, L219, L225) call
  `resolveSelectionRoot` with its default policy. A change to the default
  would change them. This round adds a policy beside it (T13) and leaves
  the default alone.

### 2.3 The panels
- **Edit** (`index.html` L685–923): the selection's fields are `#ep-fields`
  (L792), whose first row is the name (L793). **Inspect** (L927–940):
  `#ip-fields` (L930) with the name (`#ip-name`, L931), credit, behaviour,
  Copy and its reason. Neither shows where the selection sits in its group.
- **Inspect's one writer** is `renderInspectPanel` (`app.js` L2046–2076),
  which sets every name with `textContent` (K4) and appends "N parts" for a
  group (`partsText`, `copy-paste.js` L613). The Edit panel's writer is
  `refreshEditPanel` (L2499–2513).
- **Names are other users' text:** `shownText(value, max)` (`copy-paste.js`
  L99–108) escapes control and direction characters and truncates. The K7
  notes and the Inspect behaviour lines use it (L2066).

### 2.4 Parts today (subtree-add §2.8, rechecked)
- **Parts are editable alone already:** an Alt-clicked part can be moved,
  renamed, hidden and deleted. **Duplicate and Copy refuse it**
  (`duplicateRuleProblem`, `edit-duplicate.js` L604–637: L606–607, a `Node`
  parent → `parent`, "Only top-level objects can be duplicated yet", L74),
  and so does the Undo capture (`prepareRestore` runs the same rule,
  L774–783), so **a part's Delete asks first and can't be undone**.
- **`parent` travels on `add` both ways** and the server checks it: it
  refuses a parent that is or descends from a live avatar or an external
  node (`isBlockedParent`, `session.js` L136–145; called L1407) and a parent
  that doesn't exist (`world.addNode`, `world.js` L595–598: `NODE_NOT_FOUND`,
  reported raw as `NODE_NOT_FOUND: <parent>`, `session.js` L1557–1560). It
  broadcasts `parent` (L1572, L1580), and every client inserts the node
  under it (`AtriumClient._onAdd`, L1644–1653; a parent missing locally emits
  `som:desync` and inserts nothing). **The client API doesn't expose it:**
  `addNode(descriptor)` sends `{ type, seq, node }` (L1335–1345). Duplicate
  (`app.js` L2981), the Undo engine's `structural` (L1918–1935, L1923) and
  the paste paths (L3034, L3067) all call it.
- **A part's TRS is local**, and `buildDescriptor` writes it as stored, the
  root alone taking the offset (`buildOneDescriptor`, `edit-duplicate.js`
  L475: `t[0] + offsetX`). `DUPLICATE_OFFSET_X` is 1.5 (L55), its comment
  saying "along world X … (J3: root only)": true only for a top-level node.
- **The world transform:** `worldMatrix(node)` (`packages/som/src/world-matrix.js`
  L60–68) composes each ancestor's local matrix, column-major, reading the
  SOM node's `translation`, `rotation`, `scale` and `parent` getters. **It
  needs a SOM node:** `copyObject` (`copy-paste.js` L208–258) is given the
  glTF-Transform node (`copyNode`, `app.js` L2090–2096: `node._node`), whose
  `translation` is undefined. Nothing decomposes a matrix into TRS today.
- **K6** (`checkTransformValues`, `send-policy.js` L115–130): a unit
  quaternion and non-zero scale components. **Negative scales are legal**, so
  an ancestor may mirror (determinant < 0).
- **`addChild` appends:** a part re-added under its group comes back last
  among its siblings. **The SOM Inspector's tree shows child order**
  (`tools/som-inspector/src/TreeView.js`), so "nothing shows it" (§9.1) was
  wrong; the app itself doesn't.
- **The seed lamp** (`space.gltf`, the commons): `lamp-01` at `[3, 0, 0]`,
  no rotation, unit scale, children `lamp-stand` (`[0, 0.75, 0]`, a mesh) and
  `lamp-shade` (`[0, 1.6, 0]`, a mesh). PROD's 9 groups are this lamp or
  copies of it (subtree-add §2.5): depth 1, 18 parts, one with the hidden
  marker key.

### 2.5 The Undo engine and parts (`edit-undo.js`)
- **Entries record no parent.** `acceptAdd` (L401–414) and `acceptDelete`
  (L416–433) push `{ kind, label, name, handle, descriptor, members }`. A
  re-add (Undo of a delete, Redo of an add) sends `structural({ kind: 'add',
  name, descriptor })` (L749–760) with nothing about where the node was. So
  **any re-add puts a part at the top level** with its local TRS, Redo of a
  part's Duplicate included (§9.5 M1; by reading).
- **The re-add check** is the root's name only (`checkEntry`, L574–580).
- **The remove check** compares a fresh capture with the entry's
  (`sameDescriptor`, L81–97: arrays in order, every key) (L607–615).
- **Handles** (W2): one per node object (`handleFor`, L161–165). A re-add
  re-points the root's handle and **every member's handle by name**
  (`completeAccepted`, L650–665). That is §9.5's S8, already taken in
  subtree-add (the passdown's kept nit is now moot).
- **`capture`** (L309–325) refuses a tree with a part not addressable by its
  own name (`objectByName(part.name) !== part`, PART_NOT_ADDRESSABLE). It says
  nothing about the node's **parent**.

### 2.6 Shared materials and a part's re-add (§9.5 M2, reproduced)
`buildDescriptor` numbers material refs in message order, children in
`listChildren()` order (L453–468). A group `G` of `a` (red), `b` (blue) and `c`
(blue): its capture has `a` inline, `b` inline, `c` → `{ ref: 1 }`. Delete `a`
and Undo it (T11): `a` comes back last, so the order is `b, c, a`, and `c` →
`{ ref: 0 }`. **The two captures differ though the group didn't change.** A
comparison that only ignores order fails too: the refs' numbers differ.
(`devtasks/spike-selection-parts/m2-refs.mjs` shows the renumbering with the
real `buildDescriptor`; corrected by the fresh-agent check: the probe
re-attaches the same `a`, still sharing with `c`, which a real restore
doesn't.) When `a` itself shared with a sibling, the restored `a` comes back
with its own material (a part is one message; sharing with its siblings is
outside it, T12), so the group **has** changed: its older entries are
rightly "changed elsewhere".

## 3. Decisions (for the operator)
Binding from earlier rounds: everything in `PREBRIEF-subtree-add.md` §3,
SA-L6 (d) and SA-L7 (c) included.

**SP-L1. What makes a click go deeper.** **Decided (operator, 2026-11-08):
(a), as recommended.**
- **(a) Recommended: a double-click.** A click whose click count
  (`event.detail`) is 2 or more, landing inside the current selection, selects
  one level deeper toward what's under the pointer, so a triple-click goes two
  levels. A single click inside the current selection changes nothing. A
  double-click on the selected object a while later works the same way: its
  first click changes nothing, its second goes deeper. The browser decides
  what counts as a double-click (the system's interval and distance). The
  handles cover the parts (§2.2), so this needs SP-L8.
- (b) Any click on the current selection goes one level deeper. Fewer
  gestures, but a stray click on the selected object changes the selection,
  and the "click to make sure it's selected" habit drills down.

**SP-L2. What a single click selects while you work inside a group.**
**Decided (operator, 2026-11-08): (b), as recommended.**
- **(a)** Always the top-level object (a click inside the current selection
  changes nothing). Simple: one rule. But after drilling to the lamp's shade,
  a click on its stand selects the whole lamp, and getting to the stand takes
  another double-click.
- **(b) Recommended: the level you are working at.** The click selects, under
  the nearest ancestor of the current selection that contains what was hit,
  the child on the way to it. Concretely: a click on a sibling of the selected
  part selects that sibling; a click on another bench of `Furniture` while
  `Bench-NE › seat` is selected selects that bench; a click anywhere outside
  the selection's top-level object selects the top-level object hit. With
  nothing selected, or a top-level object selected, this is (a). The common
  rule in scene and drawing editors.

**SP-L3. Going back up a level.** **Decided (operator, 2026-11-08): (b), as
recommended.**
- (a) The breadcrumb only.
- **(b) Recommended: Escape goes up one level first.** In Edit mode, Escape
  with a part selected selects its parent; with a top-level object selected it
  deselects; with nothing selected it leaves Edit mode (today's two steps,
  with the levels in front). Inspect gets the first two steps (Inspect has no
  Escape today). The breadcrumb jumps to any level either way.
- (c) A new key (Shift+Enter, as some editors use), Escape unchanged.

**SP-L4. Where a part's Duplicate puts the copy** (§9.5 nit). **Decided
(operator, 2026-11-08): (b), as recommended.**
- (a) +1.5 on the part's **local** x, as `buildDescriptor` does today: in a
  rotated or scaled group the offset turns and scales with the group (a
  group scaled by 1,000 puts the copy 1.5 km away).
- **(b) Recommended: 1.5 m along world x,** converted into the parent's frame
  (the offset is the inverse of the parent's world 3×3 applied to `[1.5, 0,
  0]`), so a copy always lands 1.5 m beside the original, as a top-level
  Duplicate does. On PROD's lamps (unit scale, no rotation) (a) and (b) are the
  same.

**SP-L5. How Undo compares a group after one of its parts was re-added**
(§9.5 M2, §2.6). **Decided (operator, 2026-11-08): (a), as recommended.**
- **(a) Recommended: a canonical comparison.** `checkEntry`'s remove check
  compares the two captures with each ref replaced by the material it names,
  `children` matched by member name (unique within a tree, T1) rather than by
  position, and the sharing compared as a partition (which primitives share
  one material). The wire format and the fixed point are unchanged.
- (b) Capture with `children` sorted by name. The comparison stays
  `sameDescriptor`; but every restore and Redo then re-orders the group's
  children (shown by the SOM Inspector), and a Duplicate built by the same
  builder would too, unless it is told not to.

**SP-L6. The depth measurement's split (P0).** **Decided (operator,
2026-11-08): (b), as recommended.**
- (a) Three shards of today's 51 files (about 50, 46 and 27 s here); the
  three suites left out for time stay out, and the handoff keeps reporting
  them by hand.
- **(b) Recommended: four files, so the deploy measures everything.**
  `world-visibility.test.js` (61 s) in a file of its own, and the other 53
  (`payload-cap` and `home-world` included) in three shards by index (about
  45, 49 and 39 s here). The only exclusions left are the two hostile suites
  and the measure files themselves.

**SP-L8. A press on a move handle** (new in Rev 1.2; the fresh-agent
check's must-fix 1, §2.2). **Decided (operator, 2026-11-08): (a), as
recommended.**
- **(a) Decided: a short press is a click, even on a handle.** A
  press-and-release that travels less than 4 px (`CLICK_SLOP_PX`) puts back
  what the handle changed on screen, sends and records nothing, and is handled
  as a click (it selects, and drills with SP-L1). A handle drag begins once
  the pointer has travelled 4 px from the press. A nudge smaller than that
  is typed in the panel's fields, or made with a snap.
- (b) Keep the handles as they are, and go down a level with Alt-click, the
  breadcrumb or a key only. Drops SA-L6 (d)'s double-click.
- (c) Show the handles only after the double-click interval (about 0.5 s)
  following a click. No change to drags, but timing-based: a slow
  double-click still lands on them.

**SP-L9. Escape (or any selection change) during a handle drag** (new in Rev
1.3; Fable review, M-1). **Decided (operator, 2026-11-08): (a), as
recommended.**
- **(a) Decided: keep the move, then change the selection.** The drag ends
  where it is, with its final send, and is undoable, as today's Escape-deselect
  keeps it; then Escape selects the parent (T15).
- (b) Cancel the drag: the object goes back to where the drag started, with a
  revert sent if a move already went out (the 100 ms throttle), then up. New
  behaviour, and more code.

**SP-L10. What a short press on a handle may select** (new in Rev 1.3; Fable
review, S-3: as Rev 1.2 read, a hesitant grab of the X arrow over the floor
selected the ground plane, and one over empty sky deselected). **Decided
(operator, 2026-11-08): (a), as recommended.**
- **(a) Decided: only within the group.** A click that began on a handle
  changes the selection only when T13 picks something inside the current
  selection's top-level object; otherwise nothing changes (no message).
  Drilling and siblings through a handle still work.
- (b) Any click selects: a short press on a handle is an ordinary click, the
  floor and the sky included.

**SP-L11. The second press of a double-click** (new in Rev 1.3; Fable
review, N-1: a second press that travelled 6 px moved the lamp 1 cm and
recorded a Move). **Decided (operator, 2026-11-08): (a), as recommended.**
- **(a) Decided: it never starts a handle drag.** A press whose `mousedown`
  has `detail` 2 or more is a click whatever it travels. A deliberate drag
  starts with a fresh press.
- (b) Leave it: 4 px of travel on any press starts a drag.

**SP-L12. The stuck-handle bug on PROD** (§2.2; Fable review, S-1).
**Decided (operator, 2026-11-08): (a), as recommended.**
- **(a) Decided: fixed in this round,** by T18, which is the same line as
  SP-L9's fix and is tested with it.
- (b) A one-line round of its own, shipped first.

**SP-L7. How the round runs.** **Decided (operator, 2026-11-08): (a), as
recommended.**
- **(a) Recommended: the cheap round, with Fable as the outside reviewer
  both times** (the passdown's lesson 2: the reviewer that can execute finds
  the bugs; ChatGPT's clone fails): a fresh-agent check of this file, one
  Fable review of it pinned to a SHA, Claude's fast lane on
  `claude/selection-parts` in §6's commits, a fresh-agent code check, one Fable
  code review, Claude's harness checks, then the host. No OpenRouter credit.
- (b) As `subtree-add`: ChatGPT for this file, Fable for the code.

## 4. The contract (written for the recommendations)
Where an option not recommended is chosen, the item named changes. T1–T12
hold. "Top-level" means a node whose parent is the scene (`node.parent ===
null` on a SOM node).

- **P0, the measurement split (SP-L6 (b)).**
  - `packages/server/test/helpers/depth-measure.mjs` (new) holds today's test
    body as `measureFiles(files, { label })`: the same spawn, the same
    environment (`ATRIUM_DEPTH_RECORD`, `NODE_TEST_CONTEXT` removed), the same
    per-file assertions (no signal, status 0), the same per-file printout and
    the same ceiling assertion; plus `serverTestFiles()` (every
    `*.test.js` in `test/`, sorted, less `HOSTILE` = `message-depth.test.js`
    and `behavior-walk.test.js`, and less the **measure files**:
    `message-depth-measure-*.test.js` and `message-depth-shards.test.js`),
    `SOLO = ['world-visibility.test.js']`, and `shard(k, n)`: the files of
    `serverTestFiles()` not in `SOLO`, sorted, numbered from 0 **without**
    `SOLO`, those whose number is `k` mod `n`.
  - `message-depth-measure-1.test.js`, `-2`, `-3` and `-4` are the same three
    lines: each takes **its list from its own file name**,
    `listFor(basename(fileURLToPath(import.meta.url)))` (`-1` to `-3` the
    three shards, `-4` `SOLO`; no literal index in any file: Fable review,
    S-6, so a file can't run another's list). Each asserts its list isn't
    empty and its recording isn't empty, and prints its own deepest message
    and its elapsed time. `message-depth-measure.test.js` is removed, its header comment
    (why the ceiling exists, the recorder, the exclusions and their reasons)
    moved to the helper.
  - **A guard** (`message-depth-shards.test.js`, new, no spawn, under a
    second) that **doesn't use `serverTestFiles()`** (should-fix 8: built from
    the same filter, it would pass a filter that drops a suite): it lists
    `test/*.test.js` itself with `readdirSync`, removes the two hostile files
    and the five measure files **named literally**, and asserts the result
    equals the union of the three shards and `SOLO`, each file once; that
    `HOSTILE`'s files exist; that **the five measure files exist** (a renamed
    or deleted shard file fails, Fable review S-6); that `listFor` of each of
    the four names is its shard; and that no measure file is in any list.
  - `message-depth.js` L22's comment names the helper instead of the old file
    (a comment; nothing else in `packages/server/src` changes).
  - **What it proves is unchanged:** every legitimate message every server
    suite sends **to its in-process server** is depth 32 or less (messages to
    a spawned child server, as `world-total.test.js` L547's, aren't recorded,
    as today; they are shallow: Fable review, N-7). Now it includes the three
    suites left out for time, and runs in the deploy.
- **T13, the selection policy (SA-L6 (d), SP-L1 (a), SP-L2 (b)).**
  `packages/interaction/src/selectionModel.js` gains, beside today's
  exports (whose behaviour is unchanged):
  - `topLevelAncestor(leaf)`: the ancestor (or the leaf) whose `parent` is
    null;
  - `childToward(ancestor, leaf)`: the child of `ancestor` on the path down to
    `leaf`, or null when `leaf` is `ancestor` or isn't below it;
  - **`resolveScopedSelection(leaf, { current = null, drill = false, descend
    = false })`**, in this order:
    1. `descend` (Alt) → `leaf`;
    2. `leaf` is `current` or below it → with `drill`, `childToward(current,
       leaf) ?? current`; without, `current`;
    3. for each ancestor `A` of `current`, nearest first: `leaf` is below `A`
       → `childToward(A, leaf)` (SP-L2 (b));
    4. otherwise `topLevelAncestor(leaf)`.
  
  All of it is pure and walks `parent` only (no recursion over children).
  `resolveEditSelection` (`edit-selection.js` L47–58) keeps its avatar rule
  **first**. External content is now handed to the policy **as the leaf**:
  the outermost ancestor carrying `extras.atrium.source` replaces the hit, so
  the container stays atomic whatever the gesture (Alt and drilling stop at
  it) and an ordinary group around it is still selected by a single click
  (fresh-agent check, should-fix 7: as Rev 1.1 read, a click returned the
  inner container). Then it calls `resolveRoot(leaf, { descend, current,
  drill })`. `pickEditSelection` passes them through.
  `pickEditTarget(e, { includeHidden, current })` passes `resolveRoot:
  resolveScopedSelection`, `descend: e.altKey`, `drill: e.detail >= 2` and
  `current` (Edit: `selected`; Inspect: `inspected`).
  `DUPLICATE_NAME_MESSAGE` still applies to the hit and to the result.
  **Stated changes:** a click on a part of a group whose root has a mesh now
  selects the root (no fixture or PROD group has one, subtree-add §2.5); a
  click on a piece of `Furniture` selects `Furniture`, so **a click and
  Delete now remove the whole top-level group**, with no question when it can
  come back (W6, SA-L4): in `atrium.gltf` that is `Furniture`, 33 nodes, where
  a click used to take one bench; Undo brings it back (Fable review, N-8).
  - **The hint line** (`app.js` L652) becomes `Edit mode · Click to select ·
    Double-click goes into a group · Alt-click selects a part · Esc goes up ·
    Drag to look · WASD to move` (Fable review, N-6), and Inspect's hint
    likewise names the double-click.
  - **Inspect follows a removed part** (should-fix 4): the `som:remove`
    listener (`app.js` L3276–3278) clears `inspected` when
    `getNodeByName(inspected.name) !== inspected`, as Edit's does, not only
    when the removed root is the inspected node. Today a visitor's
    Alt-clicked part stays in the panel after its group is removed.
- **T14, the breadcrumb.** `index.html` gains `#ep-path` as the first row of
  `#ep-fields` and `#ip-path` as the first of `#ip-fields`, hidden when the
  selection is top-level. It lists the selection's ancestors from the
  top-level one down, then the selection: each ancestor a `<button
  class="ep-crumb">`, the selection plain text, separated by ` › `, each name
  through `shownText(name, 32)` and set with `textContent`. The full name,
  through `shownText(name)` (no truncation, so direction characters can't
  reorder it), is the button's `title`. The row is a `nav` with
  `aria-label="Selection path"`, the separators `aria-hidden`, the last item
  `aria-current="location"`. **Over 7 levels** (a world file can be deeper
  than T1's 9, which binds only messages) it shows the top-level name, `…`,
  and the last 6. The items come from a pure `breadcrumbItems(path)` in
  `edit-selection.js` (its cap, truncation and titles unit-tested: Fable
  review, N-5). Inspect's name and path rows are re-rendered on `som:rename`
  of any node in the path (Fable review, N-9; today `#ip-name` isn't). One writer per panel, called from `refreshEditPanel` and
  `renderInspectPanel`, **which rebuilds the row only when the path changes**
  (the list of node objects and their names; should-fix 5: `refreshEditPanel`
  runs on every `som:set` of the selection, L1065, and in Chromium a row
  rebuilt between press and release delivers no click). One delegated click
  listener per row. A crumb's click selects that node through `selectForEdit`
  (Edit) or `inspectSelect` (Inspect) if it is still `getNodeByName(name)`
  by identity and **its name isn't duplicated** (`isDuplicatedName`, else
  `DUPLICATE_NAME_MESSAGE` and nothing selected: should-fix 6); else it
  re-renders. It ends a drag in progress as any selection change does. After
  the click, focus returns to the viewport, so the movement keys work.
- **T15, Escape (SP-L3 (b)).** In the existing document listener (`app.js`
  L1642–1647), Edit mode: a selection with a parent → `selectForEdit(parent)`,
  unless the parent's name is duplicated (then `selectForEdit(null)` and
  `DUPLICATE_NAME_MESSAGE`: should-fix 6, Fable review N-2); a top-level
  selection → `selectForEdit(null)`; none → `setEditMode(false)`. **During a
  handle drag** T18 ends the drag first (the move kept, SP-L9 (a)), then the
  same step runs. Inspect mode: the same first two steps on
  `inspected`. The forms that take
  Escape first (the failure panel, the Library grid, the Model and
  destination forms) still do, in today's order.
- **T18, the drag ends before the handles change (SP-L9 (a), SP-L12 (a)).**
  `selectForEdit` (`app.js` L2283) begins with: `if (gizmo?.dragging)
  gizmo.pointerUp({ button: 0 })`. That clears the control's drag and
  fires `dragging-changed(false)`, so `onHandleDragging(false)` ends the
  gesture with its final send (the move is kept and recorded) before the
  selection, the handles or their enabled state change. `syncGizmoEnabled`
  (L2202–2206) does the same before it sets `enabled` false, so no path
  that turns the control off mid-drag (Edit off, an undo in flight, a
  pending structural request) can strand it. Every selection change mid-drag
  goes through these: Escape (T15), a crumb (T14), another tab's removal
  (L2745–2748), Edit off and the session end (L2155, L2173), a click.
- **T17, a short press on a handle (SP-L8 (a), SP-L10 (a), SP-L11 (a)).** The
  rule lives in a pure module, **`apps/client/src/edit-press.js`** (new;
  Fable review, S-7: it is the riskiest item and should be unit-tested, not
  only lifted as text). `createHandlePress({ slop = CLICK_SLOP_PX })` keeps
  one press:
  - `press({ x, y, detail, onHandle })` at the capture-phase `mousedown`
    (`app.js` L2372–2374, which also records `detail`);
  - `pointer({ x, y })` from a **capture-phase `pointermove` on `#viewport`**
    (Fable review, S-4: `TransformControls` moves the object from its own
    `pointermove`, and a `mousemove` arrives after it, one event late, so a
    drag that arrives as one 30 px move would be put back and lost);
  - `change()` → `'put-back'` while the pointer is within `slop` of the
    press, or always when the press's `detail` is 2 or more (SP-L11);
    `'begin'` at the first change past `slop`; `'drag'` once begun;
  - `release()` → `{ click: true }` when no gesture began, else `{ click:
    false }`; `reset()` for T18 and the session end.
  
  The app's glue (`onHandleDragging`, L2217–2235; `onHandleChange`,
  L2237–2246):
  - `onHandleDragging(true)` no longer begins the gesture; it tells the
    press a handle is held;
  - `onHandleChange`: on `'put-back'`, the three.js object is set back to the
    **live SOM node's** `translation`, `rotation` and `scale` (Fable review,
    S-2: the SOM node is never written before the gesture begins, so it is
    the record; a press-time copy would undo another tab's move on screen
    only), and nothing else happens (no `update`, no hold); on `'begin'`, the
    gesture begins **only when `selected && !editDispatchBlocked()`**, as
    today's L2221 (Fable review, N-3; blocked, the change is put back), then
    `hold.hold(selected)` and the current handle values are applied, so a
    real drag behaves as today;
  - `onHandleDragging(false)` with no gesture begun puts the object back once
    more; `pressDown.onHandle` is then false for that press, so the `click`
    that follows is a select click, with `e.detail` as the browser counted
    it;
  - **SP-L10:** that click, having begun on a handle, changes the selection
    only when T13's pick is the current selection's top-level object or
    below it; otherwise the selection is left as it is, with no message;
  - a gesture that did begin ends as today (`activeGesture.end()`). Nothing
    else in the gizmo changes (snaps, modes, space).
  
  **Stated:** a handle drag smaller than 4 px no longer moves the object; the
  fields and the snaps make small moves. The second press of a double-click
  never drags. The behaviour runner's drag rule (F-L5) holds from the
  gesture's start, so it now starts 4 px later; until then a behaviour may
  move the node and the put-back follows it (the live node).
- **T11, parts** (subtree-add §9.1, with §9.5 taken; SP-L4 (b), SP-L5 (a)).
  A **part** is a node whose parent is a node: a single mesh part, or a
  sub-group with members of its own (then also a tree, T1–T6).
  - **The rule.** `duplicateRuleProblem`'s `parent` rule (L606–607) becomes
    an **`ancestors`** rule: no ancestor carries `extras.atrium.source`
    (`external`'s reason) or is excluded by the caller's predicate. The
    predicate receives **glTF-Transform nodes**, as `duplicateRuleProblem`
    walks them: the app passes `(g) => isEditExcluded(client.som.getNodeByName(g.getName()))`
    (`isEditExcluded`, `app.js` L1960–1962, compares SOM nodes, so passed
    straight through it would never match: should-fix 10). An avatar is
    never a parent (the server refuses it), so this is defence in depth. Every other per-node rule holds for the part, and T5's tree rules
    for a sub-group. The client's rule is stricter than the server's
    `isBlockedParent`, which is unchanged. `DUPLICATE_REASONS.parent` is
    removed; its tests (`edit-duplicate.test.js` L122, L497;
    `subtree-add-duplicate.test.js` L85) become `ancestors` cases or
    accepted parts.
  - **The parent must be addressable** (§9.5 S6): a part is duplicated,
    captured or copied only when `getNodeByName(parent.name) === parent`, as
    the server and `_onAdd` resolve it; else "Its group can’t be found by its
    name" (new reason `group`). It is checked in the Duplicate hint, at the
    click and in the Undo engine's `capture`, so such a part's Delete asks
    first.
  - **The client API.** `AtriumClient.addNode(descriptor, { parent } = {})`
    adds `parent` to the message when it is a non-empty string. Duplicate
    and `structural` pass it; the paste branch and `retryPaste` never do (a
    paste lands at the top level). `_trackEdit` is unchanged.
  - **Duplicate in place.** The copy goes under the same parent (`parent`:
    the parent's current name), named and given ids by T5's rules (the
    names are checked world-wide, so `lamp-shade` → `lamp-shade copy`). Its
    translation is the part's own plus **the parent-frame offset** (SP-L4
    (b)): `inverse3(linear(worldMatrix(parent))) × [1.5, 0, 0]`, from
    `part-transform.js` (below), with `prepareDuplicate` taking the offset
    vector instead of `DUPLICATE_OFFSET_X` (a top-level node's is `[1.5, 0,
    0]`, unchanged). The `DUPLICATE_OFFSET_X` comment says so. Under a
    parent scaled near K6's minimum the local offset is large (about 1.5e6
    at scale 1e-6); K6 bounds no translation, so it is accepted and lands
    1.5 m away in the world, as specified: stated.
  - **Undo and Redo** (§9.5 M1): **every** structural entry records `parent:
    handleFor(node.parent)` when the node has one, else `parent: null`,
    **read while the node is alive:** a Delete's parent is read at the click,
    in `registerDelete`, carried on the request, and recorded by
    `acceptDelete` (fresh-agent check, must-fix 2: `_onRemove` disposes the
    node, `AtriumClient.js` L1737, before the engine hears the answer, so
    reading it in `acceptDelete` gives `null` and Undo restores the part at
    the top level); `acceptAdd` reads it from the live node. A removal (Undo
    of an Add, Redo of a Delete) keeps the entry's own `parent`. Every re-add (Undo of a delete, Redo of an
    add) sends `parent: entry.parent.node.name`. `checkEntry`'s re-add check
    (L574–580) also requires, when `entry.parent` is set, that the parent is
    alive by identity (`getNodeByName(p.name) === p`). If it isn't: "Can’t
    undo: “X” its group was removed." (or "Can’t redo: …"). When a node of
    that name exists but isn't the handle's: "… its group was replaced
    elsewhere." The entry is dropped, as any refused entry is. The handle
    follows the group through a rename, and through the group's own delete
    and Undo (T5's re-pointing by name). A server refusal of a vanished parent
    (`NODE_NOT_FOUND: <name>`, when another tab renamed or removed the
    group after the re-add was sent) is shown as "Can’t undo: “X” its group
    was renamed or removed." A
    part's descriptor holds its local TRS, so the fixed point is unchanged.
    A part whose capture succeeds is deleted without the question (W6).
    **A group replaced while a re-add or a Duplicate in place is in flight**
    (Fable review, N-4: `parent` is a name on the wire): on the accepted
    answer, if the new node's parent isn't the entry's parent handle's node
    (or, for a Duplicate, the original's parent), the panel says "“X” went
    into a newer “G”: its group was replaced elsewhere", and the entry is
    recorded against where it landed. Narrow; stated.
  - **The comparison** (SP-L5 (a)): `checkEntry`'s remove check uses
    `sameCanonical(a, b)` (new, `edit-undo.js`): both descriptors with each
    `{ ref }` replaced by a copy of the material it names, each `children`
    array matched by member name (every name present once in each), every
    other array in order, every key and value as `sameDescriptor`; and the
    material **partition** compared: for each tree, the sets of primitives
    (by member name and index) that share one material must be equal.
    `sameDescriptor` stays for everything else. **Stated:** restoring a part
    that shared a material with a sibling brings it back with its own (T12:
    one message), so the group's older entries become "changed elsewhere",
    which is true. The Undo note (`SHARED_MATERIAL_NOTE`) says so on the
    part's delete, through `hasSharedMaterial` as today.
  - **Copy** (§9.5 S1, S2, S3). `copyObject(node, source, { …, parentWorld =
    null })`: with `parentWorld` null (a top-level node) the root keeps its
    TRS **verbatim**, no decomposition. For a part, the app passes
    `worldMatrix(node.parent)` of the **SOM** node (`selected` in Edit,
    `inspected` in Inspect), and the root's TRS becomes
    `decomposeTRS(multiply(parentWorld, localMatrix(rootTRS)))`, where
    `rootTRS` is the built descriptor's root `{ translation, rotation, scale }`
    (should-fix 2: `localMatrix` of the glTF-Transform node, which
    `copyObject` holds, reads no fields and gives the identity):
    - the translation is the last column;
    - the scale is the three columns' lengths, and when the determinant is
      negative, the x scale is negated (a mirrored ancestor, legal under K6,
      is carried, not refused);
    - the rotation is the unit quaternion of the columns divided by their
      scales.
    
    The copy is refused with "Its group’s rotation and scale can’t be
    carried with it" (new reason `shear`) when recomposing that TRS misses an
    element of the matrix by more than `1e-5 × max(1e-9, that column's
    length)` (relative, so a shear at small scale is caught: nit). The
    check runs in `copyHint` too, so Copy shows the reason before the
    click. That is a shear: a non-uniform scale on an ancestor with a
    rotation below it. It is also refused when the TRS fails K6
    (`transform`, as today). The members below the root keep their local
    TRS. Paste treats the snapshot as a top-level object: x and z from the
    palette, y the root's (the part's **world** y). `decomposeTRS`,
    `multiply`, `inverse3` and `linear` live in
    `apps/client/src/part-transform.js` (new, pure, column-major as
    `world-matrix.js`), with their own tests.
  - **References outside the copied tree** (to the part's parent or
    siblings) are like any id outside the tree: a Duplicate in place keeps
    them as grants (F-L10, T5's map leaves them alone); a Paste into another
    world replaces and records them (K7); a Paste into the same world keeps
    them, as Duplicate does.
  - **The server level** (T7): a part with no children uses only `parent`,
    which every server in the rollback range honours, so its Duplicate,
    Delete, Undo and Redo work whatever `client.serverAddFields` is. A
    sub-group is a tree and needs level 3, as any group.
  - **Inspect:** Copy is offered for whatever T13 selected, a part included,
    under the same rule (the credit skipped, K5).
- **T16, what doesn't change:** the server (P0's test files and one comment
  aside), the protocol and its schemas, the SOM; `send`, `remove` and their
  rules; Paste's placement at the top level; the selection policy's default
  (`resolveSelectionRoot` with `nearestNonMeshAncestor`) for the SOM Inspector
  and the playground; external content selected as its container; Alt-click;
  hidden objects selectable in Edit and not in Inspect (F-L8, CP-L1); the
  behaviour click outside Edit (`pickBehaviorTarget`, untouched).

## 5. Tests and proofs
- **Run on today's code first, and keep the failures in the handoff:** the
  T13 policy tests, the T11 Undo and Redo tests, the guard (P0).
- **P0** (`packages/server`): the guard; each shard file run alone under
  `timeout 180`, its time recorded in the handoff (host and cloud); the four
  files' deepest messages together equal the old full run's (27,
  `subtree-add.test.js`).
- **T13** (`packages/interaction`, pure, stand-ins with `name`, `parent`,
  `mesh`; `Furniture › Bench-NE › seat`, `Furniture › Table-Center › top`, the
  lamp, a crate):
  - nothing selected: a click on `seat` → `Furniture`; the lamp's shade →
    `lamp-01`; the crate → the crate;
  - `Furniture` selected: a click on `seat` → `Furniture` (unchanged);
    `drill` → `Bench-NE`; with `Bench-NE` selected, `drill` → `seat`; with
    `seat` selected, `drill` → `seat`;
  - `seat` selected: a click on `Bench-NE`'s other part → that part; a click
    on `Table-Center`'s `top` → `Table-Center` (SP-L2 (b): the level under
    `Furniture`); a click on the lamp → `lamp-01`;
  - `descend` → the leaf, whatever `current` and `drill`;
  - a meshed root: a click on its part → the root (the stated change);
  - `topLevelAncestor` and `childToward` on their own, `childToward` null for
    a leaf outside;
  - `nearestNonMeshAncestor`, `resolveSelectionRoot` and `leafOnly`: the
    existing tests unchanged.
- **`apps/client` (pure):** `resolveEditSelection` with the new options:
  avatars still nothing, external content still its container with `drill`
  and with `descend`; `pickEditSelection` passes `current` and `drill` through,
  and still refuses a duplicated name.
- **`apps/client` wiring** (as text, as the existing wiring tests do): the
  `click` handler passes `drill: e.detail >= 2` and the panel's current
  selection, in both the Inspect and the Edit branches; the Escape listener's
  three steps; the breadcrumb writers use `textContent` and `shownText`; the
  crumb listener re-checks identity.
- **T17** (`apps/client/tests/edit-press.test.js`, pure; Fable review, S-7):
  a press with no travel, with 2 px, with one 30 px move (`'begin'` on the
  first change), with `detail` 2 and 6 px (`'put-back'` throughout, a
  click); `reset()` mid-press (T18's Escape and a removal); a block starting
  mid-press (the app's glue: put back, no gesture); the pointer read from
  `pointer()`, never from the press.
- **T18 and SP-L10** (`apps/client` wiring, as text, plus a harness check
  each): `selectForEdit` and `syncGizmoEnabled` end the control's drag first;
  a click that began on a handle picking outside the selection's top-level
  object changes nothing.
- **T14 and T15** (pure, `edit-selection.js`): `breadcrumbItems` for 1, 7 and
  12 levels (the cap: the top, `…`, the last 6), a name with direction
  characters (title escaped), a 300-character name (truncated to 32); Escape's
  steps in Edit and in Inspect, a duplicated-name parent (deselects, the
  message).
- **T11** (`apps/client`, pure, and `packages/client`):
  - `addNode(d, { parent: 'lamp-01' })` puts `parent` on the wire; without
    it nothing changes (the existing `addNode` tests pass); an empty string
    or a non-string sends no `parent`;
  - Duplicate of the lamp shade: `lamp-shade copy` under `lamp-01`, 1.5 m
    along world x from the shade, a fresh id; of `Bench-NE` in `atrium.gltf`
    (a tree under `Furniture`, every member renamed); under a group rotated
    90° about y and scaled 2, the copy's world position is the part's plus
    `[1.5, 0, 0]` (within 1e-6);
  - Delete of the shade asks nothing, and Undo puts it back under `lamp-01`
    with its name, id and local TRS. **Redo of the shade's Duplicate puts the
    copy back under `lamp-01`** (§9.5 M1). The lamp's own older Add entry
    still undoes afterwards (SP-L5 (a)), with the shade sharing nothing.
    With the shade sharing a material with the stand, the lamp's older entry
    is "changed elsewhere" after the restore, and the shade's delete shows
    the shared-material note. Undo after the lamp was renamed sends the new
    name as `parent`. Undo after the lamp was deleted refuses with "its group
    was removed"; after it was deleted and restored by our own Undo, the shade
    goes into the restored lamp; after another tab made a new `lamp-01`, it
    refuses with "replaced elsewhere"; a re-add answered `NODE_NOT_FOUND:
    lamp-01` shows "its group was renamed or removed"; a re-add accepted
    under a newer `lamp-01` shows the N-4 note; Inspect follows a removed
    part (the panel empties when the lamp is deleted while its shade is
    inspected);
  - `sameCanonical`: §2.6's group (`b` and `c` sharing) equal before and
    after `a`'s delete and Undo; `a` and `c` sharing, unequal after it (the
    sharing was lost); the same tree with its refs numbered differently,
    equal; a child added or removed, unequal;
  - Copy of a part of a group moved, rotated 90° about y and scaled 2: the
    **snapshot**'s root TRS composes to the part's world matrix (within
    1e-5), and after Paste the root's rotation, scale and y are the part's
    (x and z are the palette's, should-fix 1); a mirrored group (scale `[-1,
    1, 1]`): accepted, the same; a 1% shear at scale 1e-3: refused; a part with a
    rotation **below** a non-uniformly scaled group: refused with `shear`; a
    top-level node's snapshot TRS is bit-for-bit its own (no decomposition);
    a behaviour on the shade targeting the stand keeps it on a same-world
    Duplicate, and has it replaced and recorded on a Paste into another
    world;
  - `ancestors` refusals for a part of an externally loaded node and a part
    under an excluded node; `group` for a part whose parent isn't
    addressable by its name (a shadowed duplicate), at the hint, the click
    and the capture (its Delete asks);
  - `part-transform.js`: `decomposeTRS(localMatrix(t, r, s))` returns `t, r, s`
    (r up to sign) for a set of transforms, mirrored included; `inverse3` of a
    rotation-and-scale times itself is identity;
  - **the server test file, both world kinds:** a Duplicate-in-place `add`
    with `parent` is accepted and broadcast with `parent`, and a present
    client has it under the parent. (A test, not a server change.)
- **Proofs** (each break made, the named tests seen failing, the file
  restored from a saved copy):
  - (p9) Copy keeps the part's local transform: the world-placement Copy test
    fails;
  - (p9b) a re-add without `parent`: the part-Undo test fails (the shade comes
    back at the top level); (p9c) only the delete entry given a parent: the
    Redo-of-Duplicate test fails (§9.5 M1);
  - (p11) T13 with `drill` ignored (a single click drills): the "a click on
    `seat` with `Furniture` selected keeps `Furniture`" test fails;
  - (p12) T13's step 4 back to `nearestNonMeshAncestor`: the `Furniture`
    tests fail;
  - (p13) SP-L5 (a)'s comparison back to `sameDescriptor`: the lamp's
    older-entry test fails;
  - (p14) P0's guard with a file dropped from the shard rule, and again with
    `serverTestFiles()`'s filter widened to drop a suite: the guard fails both
    times;
  - (p14) also with one shard file pointed at another's list: the guard
    fails (S-6);
  - (p15) `edit-press.js` returning `'begin'` at the first change: the 2 px
    and `detail` 2 unit tests fail, and the harness's jitter checks record a
    Move;
  - (p16) T18 removed: the harness's Escape-mid-drag check moves the lamp,
    and its stuck-handle checks (a click after Escape, after a remote removal,
    after a reconnect) select nothing;
  - (p17) SP-L10's rule removed: the floor-behind-the-handle check selects the
    ground plane;
  - (p9d) a Delete's parent read in `acceptDelete`: the shade's
    Delete-and-Undo test fails (it comes back at the top level).
- **Wiring tests that change** (they pin today's text; rewritten with the
  code, not counted as regressions): `copy-objects-wiring.test.js` L189
  (`pickEditTarget(e, { includeHidden: false })`) and L191 (`{ includeHidden
  = true } = {}`); `app-wiring.test.js` L451 (`pickEditTarget\(e\)`); any
  test of `onHandleDragging`'s text.
- **Claude's harness checks before DEV acceptance** (`devtasks/harness`, on
  the published SHA; new `checks/selection-parts/`; real mouse events
  through Playwright with `clickCount` given on every press (§2.2). **Every
  check asserts the selection it expects and that no transform changed and
  no entry was recorded,** and each double-click check has a **jitter**
  variant (1 and 2 px of travel on the second press), on the handles' own
  positions (the stand under `lamp-01`'s Y handle, `Table-Center`'s parts,
  `Fountain`'s):
  - in a `space.gltf` world: a click on the shade selects `lamp-01`; a
    double-click selects `lamp-shade`, and **the lamp hasn't moved and no
    Undo entry was recorded**; the breadcrumb reads `lamp-01 › lamp-shade`;
    a click on the stand selects `lamp-stand`; Escape, Escape, Escape:
    `lamp-01`, nothing, Edit off;
  - in an `atr…` world (`atrium.gltf`): a click on `Bench-NE-Seat` selects
    `Furniture`, a triple-click the seat, the breadcrumb's `Bench-NE` the
    bench; ten double-clicks in a row on different groups move nothing and
    record nothing (the drag-safety check SA-L6 (d) asked for);
  - a double-click whose second press lands on a handle (SP-L8): it drills,
    nothing moves, nothing is recorded; a drag on the same handle past 4 px
    moves the object and records one Move, as today; a drag that arrives as
    one 30 px move records one Move (S-4); a double-click whose second press
    travels 6 px drills and moves nothing (SP-L11);
  - a short press on `lamp-01`'s X handle over the ground, and on its Y
    handle over the sky: the selection stays `lamp-01` (SP-L10);
  - **T18:** Alt-click the shade, drag its handle, press Escape mid-drag,
    keep moving, release: `lamp-01` selected and unmoved (SOM, drawn and on
    the server's `/__doc`), one "Move “lamp-shade”" recorded, and the next
    click selects; the same with another tab removing the dragged crate, and
    with a disconnect and reconnect mid-drag;
  - another tab moving the crate during a short press on its handle: the
    crate is drawn where the SOM has it (S-2);
  - Inspect (`?visitor`): the same click, double-click and breadcrumb; a
    hidden part can't be reached;
  - Duplicate, Delete, Undo and Redo of the shade, and of `Bench-NE`, with
    `/__doc` showing each under its parent on the server.
- **The operator's DEV acceptance** (each step names the panel, the control
  and the gesture; passdown §3 lesson 3). In the commons (`lamp-01`), Edit
  mode, after a hard reload:
  1. Click the lamp's shade: the Edit panel's Name is `lamp-01`, with no
     breadcrumb row. Wait a second and click the shade again: still
     `lamp-01`. Double-click the shade: the Name is `lamp-shade`, and above
     it the breadcrumb reads `lamp-01 › lamp-shade`. The lamp hasn't moved,
     and the Undo button's tooltip (hover it) is unchanged.
  2. With the shade selected, drag its up arrow a little: the shade moves,
     and Undo's tooltip reads "Undo Move “lamp-shade”"; Undo. Click the stand
     once: `lamp-stand` (the same level; the press may land on the shade's
     arrow and selects anyway, SP-L8). Click `lamp-01` in the breadcrumb:
     `lamp-01`. Click `crate-01`: `crate-01`, no breadcrumb.
  3. Alt-click the shade: `lamp-shade`. Press Escape: `lamp-01`. Escape:
     nothing selected. Escape: Edit mode is off. Turn it back on.
     **Escape mid-drag** (SP-L9, SP-L12): Alt-click the shade, start dragging
     its arrow, press Escape while still holding the button, move a little
     more and release. The Name is `lamp-01`; the shade stayed where the drag
     left it and the rest of the lamp hasn't moved; Undo's tooltip reads
     "Undo Move “lamp-shade”". Click `crate-01`: it is selected (on today's
     PROD it isn't, until a reload). Undo the move.
  4. Double-click the shade. Duplicate is enabled (tooltip "Duplicate the
     selected object"). Click it: `lamp-shade copy` appears 1.5 m beside the
     shade, selected, with the breadcrumb `lamp-01 › lamp-shade copy`.
     Undo (tooltip "Undo Duplicate “lamp-shade copy”"): the copy is gone.
     Redo: it is back, selected, and the breadcrumb reads `lamp-01 ›
     lamp-shade copy` (it is **on the lamp**). Click `crate-01`, then click
     the copy: `lamp-01`. Undo.
  5. Double-click the shade and Delete: **no question**. Undo: the shade is
     back, selected, and the breadcrumb reads `lamp-01 › lamp-shade`. Redo:
     gone; Undo: back.
  6. Double-click the stand and Copy. Teleport home and Paste: a stand
     appears ahead at the height it had in the lamp (0.75 m up), on its own: a
     click selects it, with no breadcrumb. Undo.
  7. Signed out, Inspect: click the lamp: `lamp-01 (2 parts)`; double-click
     the shade: `lamp-shade`, with the breadcrumb in the Inspect panel; Copy
     is enabled.
  8. **On PROD after the deploy:** double-click one lamp's shade, Duplicate,
     check the copy is on the lamp, Undo.
  
  Nested groups (deeper than the lamp) aren't on DEV or PROD; Claude's
  harness checks cover them on `atrium.gltf`.

## 6. Worker rules and release path
As `subtree-add` (`PREBRIEF-subtree-add.md` §6), with these specifics:
- **No `p6` run is needed:** nothing stored changes shape, and §2.4's facts
  about PROD's groups are from `45e6cd00`'s run. The release notes say so.
- **Five commits, each runnable:**
  1. P0: the helper, the four shard files, the guard, the comment; each
     shard timed (the handoff's table);
  2. T13: the policy and its tests, `edit-selection.js` and its tests;
  3. T17's `edit-press.js` and its tests; T13's, T14's, T15's, T17's and T18's
     `app.js` and `index.html` glue (the hint line included) and the wiring
     tests;
  4. T11: `AtriumClient.addNode`, `part-transform.js`, `edit-duplicate.js`,
     `edit-undo.js`, `copy-paste.js`, their `app.js` glue, the tests, the
     server test;
  5. the full suites, proofs (p9)–(p17), the harness checks and the handoff.
- **Files:** `packages/server/test/message-depth-measure.test.js` (removed),
  `message-depth-measure-{1,2,3,4}.test.js`, `message-depth-shards.test.js`,
  `helpers/depth-measure.mjs` (new), `packages/server/src/message-depth.js`
  (the comment); `packages/interaction/src/selectionModel.js`, `index.js`;
  `packages/client/src/AtriumClient.js` (`addNode`);
  `apps/client/src/edit-selection.js`, `edit-duplicate.js`, `edit-undo.js`,
  `copy-paste.js`, `part-transform.js` (new), `edit-press.js` (new),
  `app.js`; `apps/client/index.html`
  (the two breadcrumb rows); `devtasks/harness/checks/selection-parts/` (new)
  and, if its hooks need it, `devtasks/harness/server.mjs`; test files under
  `packages/*/test/`, `packages/*/tests/` and `apps/client/tests/`. **No
  other file.** If one must change, stop and ask.
- **A new check must fail on today's code** before its PASS counts. **Server
  test files one at a time,** each under `timeout 180`, new tests on port 0.
- **Release:** a client round with server test files. **DEV restarts** at
  the deploy (the files are under `packages/server/`), so acceptance needs a
  hard reload in every tab. **The deploy's server suite takes about 80 s
  longer** (the four measure files take about 215 s on the host, and the old
  file's 135 s goes; each file well inside its 180 s: Fable review, N-7).
  **The release notes name SP-L12's fix** (the stuck handles after Escape,
  a remote removal or a disconnect mid-drag). No `package.json` or lockfile change. **A
  rollback** stores nothing to undo: a part added in place is an ordinary
  node under its parent, as any server since `parent` existed stores it.
  **Check DEV's actual SHA with `release_status` before reading an
  acceptance as done**, and `git diff <reviewed> <dev> -- . ':!devtasks'`
  before the MAIN and PROD commands.
- **Never push to `main` between the release merge and PROD `COMPLETE`.**

## 7. Review log
- **Rev 1.3** (2026-11-08, 18:30 PT): **Fable's outside review of Rev 1.2**
  (`devtasks/REVIEW-selection-parts-rev1.2-fable.md`, at `3ccc1ad4`, named in
  its first line): **CHANGES REQUESTED**, one must-fix, seven should-fixes,
  nine nits. Its clone worked; it ran every listed command, built the harness
  for `dd2071f9`, and drove the real page with real mouse events, the
  gesture items through a prototype of T13, T15 and T17 behind `?proto` (its
  probes: `p1`–`p5.py`, `apply_proto.py`, `trs.mjs`, attached as an archive).
  **Claude reran them** on the scratch harness (`dd2071f9`, the prototype
  applied to the harness worktree only) and reproduced: M-1 on the prototype
  and on the released code; S-1's three triggers on the released code; S-2,
  S-3, S-4, S-5 and N-1 on the prototype; the candidate fix (`p5.py`). Taken:
  - **M-1, must-fix:** a selection change mid-drag re-attaches the dragging
    handles, so Escape mid-drag of the shade moved and saved `lamp-01`
    (§2.2). New **T18** (the control's drag ended first), **SP-L9 (a)** (the
    move is kept), proof (p16), a harness check, DEV step 3;
  - **S-1:** the same root cause strands the handles on PROD today (§2.2).
    **SP-L12 (a)**: fixed here by T18; release notes;
  - **S-2:** put back from the live SOM node; **S-3:** **SP-L10 (a)**, a
    handle click changes the selection only within the group, proof (p17);
    **S-4:** the pointer from a capture-phase `pointermove`; **S-5:** DEV step
    2 drags before clicking the stand; **S-6:** each shard file takes its list
    from its own name, the guard checks the files exist, (p14)'s third break;
    **S-7:** T17 in a pure module (`edit-press.js`) with unit tests, and in
    §6's commits and files;
  - **N-1:** **SP-L11 (a)**, the second press of a double-click never drags;
    **N-2** to **N-9**, every one: the duplicated-name Escape deselects with
    the message; T17 keeps today's block guard; the N-4 note; §5 lines for
    the `NODE_NOT_FOUND` text, Inspect's Escape and removed part, the
    breadcrumb cap (a pure `breadcrumbItems`); the hint line; P0's wording
    and the deploy's time (about 80 s longer, not 200); the click-and-Delete
    consequence stated; `aria-current="location"`; Inspect re-rendered on a
    rename.
  
  Not taken: nothing. **Confirmed sound by the review:** T13's policy (every
  §5 case, external content inside a group, avatars, hidden parts in
  Inspect, duplicated names at a middle level); T11's Undo and Redo by
  tracing (the parent handle re-pointed through the group's delete and Undo,
  a grandparent's, a rename; no retry re-sends without `parent`);
  `sameCanonical` by reading (no false equal found); the Copy decomposition
  over 200,000 random unsheared chains (worst relative miss 1.75e-15) and
  the shear refusal from 1e-6 to 1e3; SP-L4 (b)'s offset over 20,000 parents
  (worst 3.8e-10 m); P0's timings (shards 45.3, 50.0, 39.1 s, `SOLO` 61.3 s).
  **Not run by it:** DEV, PROD, Firefox, Safari, a physical double-click (its
  presses were Playwright's with `click_count`), the full suites. The harness
  checks (§5) cover the gestures again on the round's code.
- **Rev 1.2** (2026-11-08): **a fresh Claude agent checked Rev 1.1** at
  `74bdc113` (it hadn't written it). It read every cited line, timed all 54
  server files under the recorder, prototyped T13 through the real
  `pickEditSelection`, T11's Undo and Redo on the real `edit-undo.js` and a
  real `SOMDocument`, the TRS decomposition and the offset on the real
  `world-matrix.js`, and a `sameCanonical`, and ran five real-browser checks
  on `devtasks/harness` (probes in `/tmp/sp-check-probes/`, this session
  only). **50 of 52 facts confirmed**, 2 imprecise (corrected: §2.2's
  `e.detail`, §2.6's example). Claude reproduced must-fix 1 in the browser
  (`h-dblclick-jitter.py`: the lamp moved 0.0995 m, "Undo Move “lamp-01”")
  and must-fix 2 by the code and the probe. Taken:
  - **must-fix 1:** the handles cover the parts, so the second press of a
    double-click grabs a handle, and with jitter moves the group (§2.2). New
    **SP-L8**, decided (a) by the operator: a short press is a click (T17),
    proof (p15), jitter harness checks that assert the selection, DEV step 2;
  - **must-fix 2:** a Delete's parent read after the dispose is `null` (T11:
    read at the click), proof (p9d);
  - **should-fix:** the Copy test asserts the snapshot, not the paste (1);
    `localMatrix` of the descriptor's TRS, not the glTF node (2); DEV steps
    4, 5 and 7 (3); Inspect follows a removed part (4, T13); the breadcrumb
    rebuilt only when its path changes (5); the duplicate-name refusal for
    Escape and crumbs (6); external content handed to the policy as the leaf
    (7); a guard that lists the files itself (8); harness checks assert the
    selection (9); the predicate takes glTF nodes (10); the wiring tests that
    change (11);
  - **nits:** a relative shear tolerance, the shear in Copy's hint, the tiny-
    parent offset stated, the crumb title through `shownText`, ARIA, a row
    cap, focus back to the viewport, "renamed or removed", the fixture's real
    names in the harness, Inspect's `inspected.parent`, the shard numbering,
    the deploy's longer server suite.
  - **Recorded, not taken:** a keyboard route down a level (§8).
  
  **Confirmed sound by running it:** P0's shards (45–54 s, `SOLO` 61 s, every
  file green under the recorder, deepest 27); T13 exactly as written, every
  §5 case; an `add` with `parent` from a real page, in two tabs and on the
  server; T11's Undo and Redo with the click-time parent (rename, removed,
  replaced, restored by our own Undo); SP-L5 (a)'s comparison; the
  decomposition (exact for rotated, scaled and mirrored parents, a shear
  refused) and SP-L4 (b)'s offset (exactly 1.5 m along world x).
- **Rev 1.1** (2026-11-08): every decision taken, as recommended (operator:
  SP-L2, SP-L3 and SP-L4 by choice, the other four "go with the recs"). No
  contract text changed: §4 was written for the recommendations. Next: a
  fresh-agent check of this file, then one Fable review pinned to its commit
  (SP-L7 (a)).
- **Rev 1, DRAFT** (2026-11-08, against `dd2071f9`): written from the
  passdown's §5 item 1 and `PREBRIEF-subtree-add.md` §9, every line
  rechecked. **§9.5's findings, item by item:**
  - **M1 (Redo of a part's Duplicate at the top level): taken.** Confirmed
    by reading: no entry records a parent (§2.5). T11 records it on every
    structural entry; proof (p9c); DEV step 4's Redo.
  - **M2 (the set comparison against refs): taken, reproduced** (§2.6). The
    fix is SP-L5, a decision, since its two options trade the comparison's
    complexity against child order.
  - **S1 (`worldMatrix` needs a SOM node), S2 (a mirrored ancestor), S3 (the
    shear test's rotation below):** taken in T11's Copy, with `parentWorld`
    passed by the app and a top-level node kept verbatim.
  - **S6 (the parent addressable at capture and at the hint): taken**
    (`group`).
  - **S8 (re-point by name): already in the code** (§2.5, subtree-add's
    T5).
  - **S9 (DEV steps): taken**, rewritten for T13's gestures.
  - **Nits:** the client-API wording (taken); the `DUPLICATE_OFFSET_X`
    comment (taken); the world-x offset (SP-L4); `TreeView.js` shows child
    order (§2.4, corrected); `isEditExcluded` as a predicate (taken); where
    the decomposition lives (`part-transform.js`); the raw `NODE_NOT_FOUND`
    (taken); "replaced elsewhere" (taken); the relative per-column tolerance
    (taken).
  
  **Facts found while writing it:** nothing reads `event.detail` or listens
  for `dblclick` (§2.2); the handles attach at the first click, so a
  double-click's second press can land on one (§2.2: it then selects nothing
  and records nothing); the SOM Inspector and the playground share the policy's
  default (§2.2, so T13 adds a policy); the three suites left out of the
  measurement take 71.7 s, so the full set (194 s) can't be one file
  (§2.1); new server test files join the deploy with no host change.
  
  Next: the operator's decisions (taken in Rev 1.1).

## 8. Follow-ups this file records
- **Grouping and ungrouping** in the Edit panel (a `parent` change on a live
  node: a new message or a `send` leaf), and with it moving a part to
  another group. Then SA-L2's bounds against created content (subtree-add §8).
- Escape during a handle drag could cancel the drag instead (SP-L9 (b)), if
  the kept move proves surprising at DEV.
- A keyboard route down a level (Alt-click and double-click need a pointer):
  for example Enter selects the child toward the last pointer hit.
- Several objects selected at once (Shift-click), with the breadcrumb showing
  their common ancestor.
- The SOM Inspector tool's tree rebuilds once per member on a tree's
  `som:add` (subtree-add passdown §5, item 2); its selection could take T13's
  policy too.
- Showing sharing in the Edit panel (subtree-add §8).
