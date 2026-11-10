> **Transcription note (Claude, 2026-11-09):** this copy was transcribed from
> the review session's transcript, not the delivered file. The reviewer's
> second review says it differs from the delivered file in r6's quoted output
> ranges (another run's numbers) and in one line of r1, which Claude missed
> from a late edit. Neither changes a result.

34917de8fbaa1d027834619dc95d0a2ebace763c — outside review of `devtasks/PREBRIEF-grouping.md` (DRAFT Rev 1.0)

**Verdict: CHANGES REQUESTED.**
**Reviewer:** Claude Fable 5.2 (`claude-fable-5-2`).
**Reviewed commit:** `34917de8fbaa1d027834619dc95d0a2ebace763c` on `claude/grouping`. The prompt is `devtasks/OUTSIDE-REVIEW-PROMPT-grouping.md` at `fb212d3`.
**Kind of review:** a clone, with code run. The clone worked, and the checkout differs from `172b816d` only in `devtasks/` (8 files), as the prompt says.

The design is sound in outline. The wire edit, the server's order of authority, applying only on the server's answer, and the stale-tab rule all hold up against the code. Two things in the contract have to change before FINAL: the bounds rule is written two ways and its Undo promise is false under both, and GR7 leaves out the step that keeps older entries alive when a group comes back as a new node. Nine should-fix findings follow. Four of them are places an object visibly jumps or vanishes.

Line numbers: `PREBRIEF Lnn` is `devtasks/PREBRIEF-grouping.md` at the reviewed commit. Code lines are at the reviewed commit, which are the same as at `172b816d`. Each finding says how I know it: REPRODUCED (I ran it), CONFIRMED IN THE SOURCE, or INFERRED.

---

## Must-fix

### M1. The bounds rule is written two ways, and "neither is its Undo" is false under both
PREBRIEF L54–57 (§1), L266–270 (GR-L5 (a)), L403–414 (GR4). **REPRODUCED** (`r1-gr4-undo.mjs`: GR1 and GR4 prototyped from the text, on the real `SOMDocument` and the real `SUBTREE_*` bounds).

- **The two wordings differ for a tree that is already over a count.**
  - §1 refuses a change "that would take a top-level group past a count it is not already past".
  - GR-L5 (a) and GR4 refuse when a count is "over its bound after and larger than before".
  - A 300-node tree growing to 301 is allowed by the first and refused by the second.
- **Under GR4's wording:**
  - Move a part out of a 300-node seed group: accepted. Its Undo: refused ("the group would be too large to copy").
  - Delete a part of that group, then Undo: the re-add is refused. That Undo works today, because the `add` counts only its own message (`send-policy.js` L2533, called at `session.js` L758). The Delete was recorded as undoable. §1 names "a part's re-add" but not that an ordinary Delete stops being undoable.
- **Under either wording:**
  - A 257-node group: move one part out (256), Undo: refused.
  - A 9-generation tree: move the deepest part to the top level, Undo: refused (depth).
  - Ungroup a 300-node top-level group: all 299 moves out are accepted. Undo re-adds the group, then 255 moves back are accepted and 44 refused. GR-L7 (a) drops the entry. The world is left half-ungrouped, and Move to can't finish the job (the same rule refuses it).
- **Exposure.** No shipped fixture is over a count (`atrium.gltf`'s largest tree is `Furniture`: 33 nodes, 2 generations). Trees over a count come from file worlds, and from Duplicate in place repeated (PREBRIEF L81–83).
- **Asked for:**
  1. One rule, in §1, GR-L5 and GR4. I would take §1's: a tree that already can't be copied loses nothing by growing, and Delete → Undo keeps working there.
  2. Strike "and neither is its Undo" (L269–270), or make it true by a client rule: a Move to out of, or an Ungroup of, a tree whose Undo GR4 would refuse is disabled with the reason, or asks first, as an oversized Delete does.
  3. Add GR4 to GR7's checks before sending, so a refusal the client can predict never starts a multi-step Undo.
  4. Tests for the cases above. §5's bounds tests (L534–538) cover none of them.

### M2. GR7 never says a composite's re-add points the group's handle at the new node
PREBRIEF L446–465 (GR7's entries); `edit-undo.js` L713–718 (the re-add's parent check), L793–816 (the only place a handle is pointed at a re-added node). **REPRODUCED** (`r5-older-entries-after-ungroup-undo.mjs`, the real Undo engine on `space.gltf`).

- **The sequence, in one tab, with no race:** Delete `lamp-shade` (a part of `lamp-01`); Ungroup `lamp-01`; Undo; Undo. The Ungroup's Undo re-adds `lamp-01` as a new SOM node. The older Delete entry still holds the old node's handle, so its Undo answers "Can't undo: "lamp-shade" its group was replaced elsewhere" and the entry is dropped.
- **The same happens to every older entry that points at the group:**
  - a Move to whose `from.parent` or `to.parent` is the group;
  - a transform or Rename entry on the group itself;
  - a `group` entry under a Move to that emptied and deleted the group (GR-L8 (a));
  - a Rename of `group-01` after Undo and Redo of its Group.
- **The claim the prompt asks about** ("exact local values keep older entries undoable") is right for the moved node's own entries: f1's bitwise result holds, and one tab's stack is undone in order. It is not enough for entries that reach the node through the group. S4 is the one exception I found for the node's own entries.
- **A second gap in the same place.** The `move` entry's Undo check requires "`from.parent`, if any, is alive and addressable" (L448–451). With GR-L8 (a), `from.parent` is the group deleted in the same step, so as written every such Undo answers "changed elsewhere". That entry needs its own list: the group's name is free; the group's own parent (a handle) is alive and addressable; then the re-add, the handle pointed at the new node, then the move.
- **Asked for:**
  1. GR7 states that every re-add inside a composite (Undo of `ungroup`, Redo of `group`, Undo of a `move` that deleted an emptied group) points the group's handle at the new node, as `completeAccepted` does for `entry.handle`.
  2. The group's delete in Ungroup and in GR-L8 goes through the existing capture window (`registerDelete` or `openRemovalWindow`, with the parent re-read). Otherwise a node another tab moves into the group, or a move of the group itself, between this tab's check and its `remove` is lost or comes back in the wrong place.
  3. §5 tests: the r5 sequence; a Move into a group, Ungroup, Undo, Undo; a drag of the group, Ungroup, Undo, Undo; Group, Move to the top level (GR-L8), Undo, Undo.

---

## Should-fix

### S1. An unreloaded tab doesn't draw moved objects "in the old frame": it loses them
PREBRIEF L239–242 (GR-L3's stated limits), L60–62; `AtriumClient.js` L1797–1802 (`_onSet`), L1714–1745 (`_onRemove`). **REPRODUCED** (`r2-stale-tab-loses-parts.mjs`, the released `AtriumClient`).

- After another tab's Ungroup, the old client throws on each `parent` set, then applies the group's `remove` with the parts still inside it. Both cubes are gone from its SOM while the server holds both. The same happens to an object moved out of a group that GR-L8 (a) then deletes.
- This covers unreloaded visitors, unreloaded owner tabs, and the sessions that aren't judged (the SOM Inspector, cross-origin clients).
- A Node process running an older `AtriumClient` gets an unhandled rejection from the async `dispatch` (L846), which ends the process by default.
- **Asked for:** GR-L3's stated limit and the release notes say what happens. If that is too much to accept, the cheap fix is for the server to end a judged stale session (it knows the level at the hello) when the first `parent` change is broadcast in its world. The page then shows "disconnected", and a reload brings the new client.

### S2. A transform already in flight is applied in the new frame
PREBRIEF L147–152, L506–508; `edit-gesture.js` L491–503 (`accepted`), L267–283 (`reconcile`); `app.js` L1060–1063. **REPRODUCED** (`r3-inflight-transform.mjs`, the real tracker on `space.gltf`).

- Tab A commits `crate-01`'s translation `[1.5, 0.25, 0]`. Tab B's Move to (into `lamp-01`) reaches the server first. The server then applies A's value to the node where it now is. Every tab, and the saved world, ends with the crate at world `[4.5, 0.25, 0]`: 3 m from where either tab put it.
- GR8 ends a drag at `som:reparent` (f3). That covers sends made after the reparent, not one made before it.
- The behaviour runner has the same window in the mover's own tab: a write it sends between this tab's move and its echo (`runner.js` L604–605) is an old-frame value. `moveNode` doesn't take the hold that a panel write takes (`app.js` L1868), so the runner isn't held.
- **Asked for:** a pending move takes the behaviour hold on the node. For the two-tab case, either name it as a limit, or have the tab that sees its own transform accepted after a `som:reparent` of that node send the reparent's value for that field again. One test either way.

### S3. Nodes that something else writes in local coordinates jump after Group, Move to or Ungroup
PREBRIEF L250–262 (GR-L4), L342–356 (GR-L10); `tests/fixtures/space-anim.gltf`; `renderer-three/src/AnimationBridge.js` L60; `behaviors/src/behavior-spec.js` L199. **REPRODUCED in the browser for an animation** (`r6_group_animated_node.py`, on the harness); **INFERRED for custom graphs**.

- `space-anim.gltf`'s clip `CrateBob` writes `crate-01`'s translation, with keys around `[1, 0.25, 0]`. After Group (the group at `[1, 0.25, 0]`, the crate at 0) the crate rests in the right place. When the clip plays, it is drawn at x = 2, y 0.37–0.63 (before the Group: x = 1, y 0.11–0.38).
- A custom behaviour graph may write `translation`, `rotation` and `scale` (`behavior-spec.js` L199). The five templates write only visibility, animation state and light intensity. GR-L10's "Stated" covers a spin or a scale pulse after Group. It doesn't cover a translation write after Group, or any of the three after a Move to into a turned or scaled group.
- The design never mentions nodes that an animation channel or a skin references.
- **Asked for:** Group, Move to and Ungroup are refused for a node an animation channel or a skin references. The client already has that rule (`edit-duplicate.js` L584ff, `referenced`). For custom graphs, widen GR-L10's stated limit.

### S4. A move into or out of a mirrored group leaves a scale the panel then destroys
PREBRIEF L100–105, L561–566; `edit-gesture.js` L84, L99 (`sanitizeTransform`); `app.js` L2813–2836. **REPRODUCED** (`r4-negative-scale.mjs`).

- `moveValue` gives a local scale such as `[-1, 0.5, 2]` (f1). The panel's transform path clamps every scale component to at least 0.01.
- Typing 0.6 in the scale-y field sends `[0.01, 0.6, 2]`. Undo of that entry sends `[0.01, 0.5, 2]`. The older Move to entry's check ("its vectors equal `to`'s exactly") then fails, and the entry is dropped as "changed elsewhere".
- A move into a group scaled above 100 gives a positive local scale under 0.01, with the same result.
- **Asked for:** `moveTargets` leaves out, and counts with the shears, any target whose result has a scale component below the editor's 0.01. Or the clamp becomes a clamp on the magnitude.

### S5. "A group with nothing of its own" should be whatever the capture accepts
PREBRIEF L290–295 (GR-L6), L321–323 (GR-L8); `edit-undo.js` L420–440 (`capture`); `edit-duplicate.js` L584–602. **CONFIRMED IN THE SOURCE.**

- Ungroup's Undo re-adds the group from its capture. The capture refuses more than GR-L6's list names: a node an animation channel or skin references, node extensions, morph weights, an own `extras.atrium.source`, a rotation that isn't unit, and `extras.atrium` values the add rules refuse.
- A `source` container in a file world passes GR-L6's list as written: it has parts (the loaded nodes) and no mesh.
- **Asked for:** Ungroup, and GR-L8's delete, are offered only when the capture of the group without its children succeeds. Otherwise the control is disabled with the capture's reason.

### S6. A group can be left empty by paths GR-L8 doesn't cover
PREBRIEF L318–327, L286–288, L309–310. **INFERRED** from the contract and the selection policy; GR-L8's own text says such a node can't be selected or deleted.

- **Upward:** Group a cube, then Group `group-01`. Move the cube to the top level. `group-01` is deleted, and `group-02` is left empty.
- **Delete:** deleting the last part of a group leaves it empty. This is possible today, but it becomes ordinary once users make groups.
- **A composite that stops halfway:**
  - an Undo of Ungroup, or a Redo of Group, whose moves are all refused after the re-add;
  - a disconnect between Group's `add` and its move;
  - an Ungroup whose one refused part was "already there".
- Each leaves a node nothing can reach, and its name stays taken.
- **Asked for:** one rule for all of them. Either GR-L8 (a) applies upward and to Delete, and a composite removes a group it re-added that ends up empty; or the panel gets a way to reach empty groups (GR-L8 (b) plus a delete).

### S7. A `source` container can be the new parent
PREBRIEF L255–259, L391–392; `session.js` L136–145; `world.js` L547–549, L556–562, L708–716; `edit-selection.js` L49–58. **CONFIRMED IN THE SOURCE.**

- `isBlockedParent` knows the names of the nodes loaded into a container, not the container. In a document world the set is empty, because clients load external content themselves.
- A move into the container is accepted. On the client the container is atomic (a click, Alt and drilling all stop at it), so the moved object can't be selected again.
- The same gap exists today for a hand-made `add`.
- **Asked for:** GR3 step 2 also refuses a parent that carries, or is under a node that carries, an own `extras.atrium.source`. `moveTargets` does the same. GR4 says whether `treeCounts` counts external nodes: the server holds them in file worlds only and the client always, so GR8's pre-check could disagree with the server.

### S8. The Move to select: when it is built, and what an index means
PREBRIEF L478–482, L501–505; `app.js` L3544, L4594–4598, L2644–2647. **INFERRED**; the two precedents are confirmed in the source.

- `refreshEditActions` runs on every `som:set`, which a running behaviour produces constantly. The sky select (R4) and the breadcrumb row were both rebuilt for that reason after a rebuild between press and release lost a click.
- GR8 gives option values as indices but doesn't say when the list is built. An index into a rebuilt list can name a different group between opening and choosing.
- `moveTargets` runs a matrix decomposition and a GR4 count of a whole tree for each target, so it is too heavy to run on every `som:set`.
- **Asked for:** the list is built when the select opens, or only when its key changes (as R4 does). The node objects are kept beside the options. The `change` handler resolves the chosen option to its node object and checks it again.

### S9. §5: one proof has no test, the hello list is short, and step 7 names no gesture
PREBRIEF L546–556, L585–591, L607–608. **CONFIRMED IN THE SOURCE.**

- **"The wait for the group's `add`"** (L590). On one socket a pipelined `add` and move succeed in order, so removing the wait turns no listed test red. The test that fails for the stated reason: the group's `add` is refused "already in use" while another node holds that name; nothing is sent until the retry's `add` is accepted; the object ends in the retry's group.
- **Hellos the bump makes stale that §5 doesn't list:** `packages/server/test/script-host.test.js` L85 and L294, and `packages/server/test/activate.test.js` L176. Both default to `scriptRunner: 3` with no `addFields`. They are the two suites that test the host election and the hand-over, which GR5 changes. The grep step would find them; the list should name them.
- **`devtasks/harness/checks/scripting-4d/c1.py` L53** asserts `addFields: 3`. §6 allows changes under `checks/grouping/` only.
- **DEV step 7.** The page doesn't reconnect by itself, so a tab from before the deploy is disconnected and can't edit at all; it never shows the message. The step should read: press Connect in the old tab without reloading, then drag a cube. It snaps back, and the panel says "Couldn't save: this page is older than the server: reload it to keep editing" (`edit-gesture.js` L514).

---

## Nits

- **N1. GR3's order** (PREBRIEF L389–397). The cycle and "already there" checks belong before GR4, so the bounds count never walks an "after" tree that contains a cycle.
- **N2. Exact values when the frames allow it.** `moveValue` by decomposition changes the last bits of rotation and scale (f1: "move back by maths: false"). When the two parents differ by a translation only, as for a group Group made, it can keep rotation and scale bitwise and add the translations. Group then Ungroup, without Undo, then leaves the values other tabs' entries expect.
- **N3. GR-L10.** Define "behaviour-carrying" as "has the leaf, enabled or not". Note that a parented `add` under a scripted ancestor is not covered, so the server's rule is a courtesy to the panel and not a boundary.
- **N4. GR6.** A `parent` set for a node the client can't find should desync too. A move that lands in another node of the parent's name should be reported, and the entry's `to.parent` read from the node, as N-4 does for adds.
- **N5. Edit mode off mid-composite.** The palette's retry needs `modes.edit` (`app.js` L3453). Group's continuation after its `add` must not, or the group stays empty (Y7).
- **N6. R3 for moves.** `world.setField` should hand `reparentNode` the object `authorizeSend` judged, as it does for a rename.
- **N7. The g2 count.** PREBRIEF L26 says g2 gave 17 PASS. The committed `g2.py` has 13 checks, and 13 passed here.

---

## What held up

- **The stale-host rule.** The role is granted in two places only: the hello's election (`session.js` L874) and `handOverScriptHost` through `canRunBehaviors` (L598, L613–625). GR5 names both.
- **What else sends `send`.** In the released page every `send` is an owner's edit, so the bump breaks no visitor. The tests it breaks are in S9.
- **Cycles and avatar parents.** I found no way to make a cycle (one server, one order; the client applies only in that order), and no way to an avatar parent.
- **Shipped content.** `atrium.gltf`'s four groups and their nine sub-groups have no mesh and no extras, so they qualify for Ungroup. The templates' behaviours write no transforms.
- **The pending-delete fix.** Re-reading the parent in `reCapture` and at the removal window's opening covers the click Delete and both removal windows. With M2's second item it covers the composites too.
- **The accounting** is implementable in `edit-undo.js`: a move's seq needs a non-null marker in `bySeq` (L577–578), and the composites need phases. I found no existing entry type they break.

---

## What I ran

| What | Result |
|---|---|
| `git clone`, checkout of `34917de8…` | worked |
| `pnpm install --frozen-lockfile --ignore-scripts`, the `better-sqlite3` build | worked (Node 22.23.4, pnpm 10.28.0) |
| `g1-reparent-facts.mjs`, `g3-order-and-save.mjs`, `f1-…mjs`, `f2-…mjs` | ran; the output matches §2 |
| `apps/client`: the five named test files | 121 pass, 0 fail |
| `packages/server`: `subtree-add.test.js` | 30 pass, 0 fail |
| `packages/server`: `behavior-leaf.test.js` | 30 pass, 0 fail |
| The harness (`setup.sh 34917de8…`, `server.mjs`) | built and ran |
| `checks/grouping/g2.py` | 13 checks, all pass (the brief says 17; N7) |
| `spike-grouping/fresh/f3_drag_remote_reparent.py` | the 3.009 m jump, as §2.4 says |
| My probes `r1`–`r5` (Node) and `r6` (browser) | ran; outputs below |

**Not run:** the full suites; any server test file other than the two named; `checks/grouping/sp.py` by itself (it is the helper module g2 and f3 import); anything against DEV or PROD. Nothing was pushed and no PR was opened.

**Limits of my probes.** r1 prototypes GR1 and GR4 from the text, since neither exists yet. r2 feeds the released client's `_onSet` and `_onRemove` the messages GR3 would broadcast, with a hand-built connection record. r3 and r6 apply the remote move in the tracker or the page as GR6 describes it, not through a server. r5 shows the engine without the step M2 asks for.

---

## Probe outputs

The code is in the six files delivered with this review. Each Node probe takes the path of the clone as its argument; r6 also needs the harness server.

**r1-gr4-undo.mjs**
```
bounds (nodes, generations, primitives)                                        {"nodes":256,"depth":8,"prims":1024}

── rule "gr4" (GR-L5 (a) and GR4: over after AND larger than before)
a. 300-node seed group: move p0 to the top level                               {"ok":true}
   its Undo (p0 back into G, exact old values)                                 {"ok":false,"message":"the group would be too large to copy (nodes)"}
a2. 257-node seed group: move p0 to the top level                              {"ok":true}
   its Undo                                                                    {"ok":false,"message":"the group would be too large to copy (nodes)"}
b. Ungroup a 300-node seed group: moves out accepted                           299 of 299
   its Undo: moves back accepted / refused                                     255 / 44  → G holds 255 parts, 44 left at the top level
c. 300-node seed group: Delete p0, then Undo (re-add under G)                  {"ok":false,"message":"the group would be too large to copy (nodes)"}
d. 9-generation seed tree: move the deepest part to the top level              {"ok":true}
   its Undo                                                                    {"ok":false,"message":"the group would be too large to copy (depth)"}

── rule "s1" (§1: past a count it is not already past)
a. 300-node seed group: move p0 to the top level                               {"ok":true}
   its Undo (p0 back into G, exact old values)                                 {"ok":true}
a2. 257-node seed group: move p0 to the top level                              {"ok":true}
   its Undo                                                                    {"ok":false,"message":"the group would be too large to copy (nodes)"}
b. Ungroup a 300-node seed group: moves out accepted                           299 of 299
   its Undo: moves back accepted / refused                                     255 / 44  → G holds 255 parts, 44 left at the top level
c. 300-node seed group: Delete p0, then Undo (re-add under G)                  {"ok":true}
d. 9-generation seed tree: move the deepest part to the top level              {"ok":true}
   its Undo                                                                    {"ok":false,"message":"the group would be too large to copy (depth)"}
```

**r2-stale-tab-loses-parts.mjs**
```
before                                                                 group-01, cube-a (in group-01), cube-b (in group-01)
set cube-a.parent = null                                               threw TypeError: Cannot set property parent of #<SOMNode> which h…
set cube-b.parent = null                                               threw TypeError: Cannot set property parent of #<SOMNode> which h…
after the Ungroup (the server holds cube-a, cube-b)                    (no nodes)
events the page saw                                                    som:remove group-01

before                                                                group-01, cube-a (in group-01)
set cube-a.parent = null                                               threw TypeError: Cannot set property parent of #<SOMNode> which h…
after Move to + GR-L8 (a) (the server holds cube-a)                    (no nodes)
```

**r3-inflight-transform.mjs**
```
crate-01 world / lamp-01 world                                             [1,0.25,0] / [3,0,0]
tab A commits translation (in flight)                                      [1.5,0.25,0] seq 1
tab A after B's move arrives: parent / local / world                       lamp-01 / [-2,0.25,0] / [1,0.25,0]
tab A after its own send is accepted: local / world                        [1.5,0.25,0] / [4.5,0.25,0]
the server and every other tab hold the same                               crate-01 in lamp-01 at [1.5,0.25,0]
where the owner meant it (0.5 m along x from [1, 0.25, 0])                 [1.5, 0.25, 0]
```

**r4-negative-scale.mjs**
```
edit-gesture MIN_SCALE                                                     0.01
sanitizeTransform(scale, [-1, 0.5, 2])                                     [0.01,0.5,2]
panel commit of scale [-1, 0.6, 2]: sent                                   [0.01,0.6,2]
Undo of the Scale entry sends `from` [-1, 0.5, 2]: sent / node holds       [0.01,0.5,2] / [0.01,0.5,2]
GR7: the older Move to entry's check "its vectors equal to's exactly"      FAILS → “changed elsewhere”, the entry is dropped
sanitizeTransform(scale, [1/150, 1/150, 1/150])                            [0.01,0.01,0.01]
```

**r5-older-entries-after-ungroup-undo.mjs**
```
1. Delete “lamp-shade” (a part of lamp-01): undo stack                       ["Delete “lamp-shade”"]
2. Ungroup + its Undo: lamp-01 is back, holding                              lamp-stand
   the node of the name “lamp-01” is the one the Delete entry remembers      false
3. Undo of the Delete: ran / sent                                            false / null
   the panel's message                                                       "Can’t undo: “lamp-shade” its group was replaced elsewhere."
   undo stack afterwards (the entry is dropped)                              []
```

**r6_group_animated_node.py** (browser, on the harness)
```
crate-01 drawn at rest: [1, 0.25, 0]
CrateBob playing: True
BEFORE Group, CrateBob playing: world x / y / z ranges: [[1, 1], [0.124, 0.374], [0, 0]]
stopped; drawn: [1, 0.25, 0]
Group applied (GR-L6 (a)): {'group': [1, 0.25, 0], 'parent': 'group-01', 'local': [0, 0, 0]}
AFTER Group, at rest: drawn world: [1, 0.25, 0]
AFTER Group, CrateBob playing: world x / y / z ranges: [[2, 2], [0.365, 0.625], [0, 0]]
PASS before Group the clip keeps the crate at x = 1  [[1, 1]]
FAIL after Group the playing clip still keeps the crate at x = 1 (“nothing jumps”)  [[2, 2]]
FAIL after Group the clip’s height range is the one it had  [([0.124, 0.374], [0.365, 0.625])]
page errors: []
2 failed
```
