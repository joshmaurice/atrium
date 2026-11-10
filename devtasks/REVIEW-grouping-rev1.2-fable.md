95d7a096ffc593e2ea3bf2941455d453b63a6183 — outside review of `devtasks/PREBRIEF-grouping.md` (DRAFT Rev 1.2)

**Verdict: CHANGES REQUESTED.**
**Reviewer:** Claude Fable 5.2 (`claude-fable-5-2`).
**Reviewed commit:** `95d7a096ffc593e2ea3bf2941455d453b63a6183`, the head of `claude/grouping` when I fetched it. No SHA was given for this round and no new review prompt is committed, so I pinned to the head and used the prompt at `fb212d3` again.
**Kind of review:** a clone, with code run. The checkout differs from `172b816d` in `devtasks/` only (17 files).

Rev 1.2 takes every finding of the last review, and most of the fixes hold against the code. Two things need to change before FINAL, and both are in what Rev 1.1 and 1.2 added: the Empty groups list as defined shows the owner's own avatar camera in every world and can lose a node for good, and GR-L12 as worded protects only the stale tabs connected at one moment. Five should-fix findings follow.

Line numbers: `PREBRIEF Lnn` is the pre-brief at the reviewed commit. Code lines are the same as at `172b816d`. Each finding says how I know it: REPRODUCED, CONFIRMED IN THE SOURCE, or INFERRED.

---

## Must-fix

### M1. The Empty groups list: what GR8's test puts in it, and what falls out of it
PREBRIEF L672–686 (GR8), L722–724, L422–426 (GR-L8 (c)); L809–812 and L836–838 (§5). **REPRODUCED in the browser** (`r9_empty_groups.py`: GR8's `isEmptyGroup` evaluated in the released page as L681–684 write it).

- **It lists this tab's own avatar camera, in every world.** The local avatar has a client-only child node, `avatar-<id>-camera`, with no mesh, no parts and no extras. The server doesn't hold it. As written, "Empty groups (1)" shows in every world as soon as Edit mode is on, and choosing it selects a node under the avatar that no edit can reach.
- **It lists `source` containers.** In the harness's `space-ext.gltf` world, `Crate` and `Light` are listed. GR8's list of what a node may not have (L682–683) omits an own `extras.atrium.source`.
- **A listed node can drop off the list and become unreachable.** The panel offers the Behaviour row for a bare node selected the way the dropdown selects it. I saved the `select-visibility` template on it through the form, and the server stored it. The node then fails `isEmptyGroup` ("no … behaviour"), so the dropdown no longer lists it. A click where it stands selects `ground-plane`. Nothing in the app can select it again to change or remove the behaviour. A bare node with a behaviour (a controller) is a likely thing for an owner to want.
- **The two definitions differ.** L681–682 says the test is "GR-L6 (a)'s own test for Ungroup". GR-L6 (a) (L379–383) lists mesh, model, behaviour and teleporter plus the capture; GR8 lists light and camera too and no capture.
- **Asked for:**
  1. `emptyGroups` leaves out a live avatar and anything under one, a `source` container and anything under one, and a node that isn't addressable by name.
  2. The list is for nodes the viewport can't reach, so a bare node stays listed when it gains a behaviour. Drop "behaviour" from `isEmptyGroup`'s exclusions (Ungroup and GR-L10 have their own rules), or say how such a node is reached.
  3. One definition, stated once.
  4. §5: the row is hidden in a world with avatars connected and no empty group; a `source` container isn't listed; a listed node given a behaviour is still listed.

### M2. GR-L12 closes stale sessions once per world, and the tab it closes is told nothing
PREBRIEF L496–506 (GR-L12 (a)), L586–589 (GR5), L770–772 (§5), L887–891 (DEV step 7). **CONFIRMED IN THE SOURCE**; the first item is a reading of the contract's own words.

- **"First" leaves every later stale session alone.** Both statements say the server acts "when it first broadcasts" a parent change in a world. A stale tab that connects after that moment is never closed, and the next Ungroup removes the parts from its view (r2, last round's S1).
- **Those later sessions are the ordinary case.** The deploy restarts the server, so every tab from before it is disconnected, and the page doesn't reconnect by itself (`app.js` L934–958). A stale session exists only because someone pressed Connect in an old tab. DEV step 7 does exactly that, after the close.
- **The closed tab shows no reason.** The released page shows a server `error` after `session:ready` for three codes only (`app.js` L962–989); anything else goes to the console. A close reason isn't shown either. The owner or visitor sees "disconnected" and a Connect button. Pressing it reconnects the stale page.
- **The released page does show a refusal at the hello.** The server already refuses a hello with an `error` and a close (`session.js` L779–782, `WORLD_FULL`). The released Connect path shows it as "Connect failed: " plus the server's text (`app.js` L1436–1450; `AtriumClient.js` L868–881).
- **Asked for, one of:**
  1. **Refuse the hello of a judged stale session**, with the stale message. Every stale session passes through a hello after the deploy, so this reaches all of them, with a visible reason, and needs no bookkeeping. The cost is that an unreloaded tab can't watch either. That is the operator's call, since it goes further than GR-L3 (a).
  2. **At the least, "at every `parent` broadcast"**, with a §5 test for a stale session that joins after the first one. The page still shows no reason.
- In either case the stale sessions should be closed before the `set` is sent to them, not after.

---

## Should-fix

### S1. On `som:reparent` the drag must be cancelled, not ended
PREBRIEF L729–731 (GR8); `app.js` L2267–2277, L2322–2325; `edit-gesture.js` L438–454. **REPRODUCED** (`r7-drag-end-vs-cancel.mjs`, the real tracker on `space.gltf`).

- GR8 names two mechanisms: "`endHandleDrag`, the tracker's cancel". `endHandleDrag()` ends the gesture through `end()`, which makes a final send of the last dragged value ("the move is kept").
- That value is in the old frame. In the probe the crate was dragged to x = 1.13, the other tab moved it into `lamp-01`, and `end()` sent `[1.13, 0.25, 0]`: the crate ends at world x = 4.13. With `cancel()` nothing is sent and the crate stays at x = 1.10, where the mover saw it.
- The tracker sends at most once per 100 ms, so a drag under way usually has an unsent value.
- **Asked for:** GR8 says the gesture is cancelled first (no final send), and the handles are reset after. The cancelled drag also shouldn't be recorded: `som:reparent` fires before the transform `som:set`s that mark the record as another session's.

### S2. "Recorded as not undoable" isn't what an unrestorable Delete does
PREBRIEF L351–357 (GR-L5 (a)), L650–652 (GR7); `edit-undo.js` L549–556. **CONFIRMED IN THE SOURCE.**

- GR-L5 (a) says such an action asks first "as an unrestorable Delete does". That Delete is not recorded, and Redo is cleared (W5, L556). GR7 says the entry "is recorded as not undoable".
- An entry on the stack that can't be undone would block every entry under it.
- **Asked for:** GR7 says "not recorded; Redo is cleared, as W5". Older entries for that node then read "changed elsewhere" when reached, which the existing checks already do.
- GR-L5 (a)'s examples say "a tree at the bound" (L355). The case is a tree just over it: 257 nodes, as r1 shows. A Delete in a 256-node tree undoes.

### S3. §6's file list is short by two files the contract needs
PREBRIEF L897–912 (§6), L380–383 and L629–630 ("capture without its children"), L704–706 (the `referenced` test), L556 and L575–576 (`treeCounts`). **CONFIRMED IN THE SOURCE.**

- **`apps/client/src/edit-duplicate.js`.**
  - "Capture without its children" has no existing call. `prepareRestore` with `trees: false` refuses any node that has children (L631). With `trees: true` it judges every member and the tree's size (L644–647), so a camera-host part or an oversized group fails it.
  - The rule for the node alone is `nodeRuleProblem`, which is private (L584), as is `SCENE_GRAPH_PARENTS` (L75).
  - `duplicateRuleProblem` can't stand in for the `referenced` test: it returns the first problem, and `attached` (a camera, light or skin host) is checked before `referenced` (L586–587). An animated camera node would pass as not animated.
- **`packages/client/src/add-spec.js`.** GR4 puts `treeCounts` in `send-policy.js` (L556) and has `edit-group.js` import it from `add-spec.js` (L575–576). Those are two files: the server's bounds are in `send-policy.js` (L2041) and the client's in `add-spec.js` (L34). So there are two copies, and the client's file isn't on the list.
- **Asked for:** both files on §6's list, with what changes in each (an exported own-node rule; `treeCounts`). GR4 says there are two copies, and a test holds them to the same answers.

### S4. The behaviour hold keeps one node, and an Ungroup moves several
PREBRIEF L612–614 (GR6), L834–835 (§5); `edit-gesture.js` L146–167; `runner.js` L432–439, L872–876; `app.js` L1847, L1887. **CONFIRMED IN THE SOURCE.**

- `createBehaviorHold` holds one node object, and the runner's `setGesture` takes one name. A second `hold(node)` replaces the first.
- The runner's test covers the held node, its descendants and its ancestors. So for an Ungroup, or a Redo of one, holding the group covers every part until its echo.
- For the Undo of an Ungroup the parts are under the group's parent. Holding that parent works. At the top level there is no node to hold.
- The hold is released by the tracker's idle (`app.js` L1887), which a move never raises. The move's own answer has to release it.
- The bullet sits under GR6, the `AtriumClient` section, but the hold is `app.js`'s.
- **Asked for:** GR8 says which node each composite holds and that the answer releases it. For the Undo of a top-level Ungroup, either say the parts aren't held, or widen the hold to a set and add `edit-gesture.js` and `packages/behaviors/src/runner.js` to §6.

### S5. DEV steps 7 and 5a can't be done as written
PREBRIEF L880–891. **CONFIRMED IN THE SOURCE** (step 7); a reading (5a).

- **Step 7** starts from "a tab opened before the deploy, not reloaded" and expects "disconnected" at the first Group elsewhere. The deploy's restart has already disconnected it. The step needs: press Connect in the old tab without reloading; Group in another tab; the old tab shows "disconnected". What comes next depends on M2.
- **Step 5a** says "Move both out again" after one cube was moved back in.

---

## Nits

- **N1. "Exact when the frames allow it"** (PREBRIEF L715–719). The linear parts are exactly equal for a group Group made, nested or not (`r8-exact-when-frames-allow.mjs`). The translation "computed" through the inverse is bitwise the old one at the top level only; under a turned, scaled parent it comes back as `1.3700000000000003, 0.25000000000000044`. Adding the group's translation to the part's is bitwise in both cases. So the stated benefit holds for rotation and scale, and for translation only with the addition.
- **N2. The scale rule and a part that is already mirrored** (L712–714). `moveValue` refuses any result with a negative scale component, including one kept bitwise. A node whose own scale is negative can be Grouped (no maths) and then never ungrouped or moved out once the Undo stack is gone. The rule could skip a scale it didn't change. No shipped fixture has such a node.
- **N3. The row flashes.** Between Group's `add` and its move, the new group is an empty group, so "Empty groups (1)" shows for one round trip in every tab. The same happens at the Undo of an Ungroup and the Redo of a Group.
- **N4. The row's key** (L685–688). Emptiness also changes when a bare node gains or loses a behaviour, a teleporter or a model, which isn't a change of structure.
- **N5. The capture window is named for Ungroup only** (L645–649). The `group` entry's Undo also removes the group one round trip after its check; it should go through `openRemovalWindow`, as an `add` entry's Undo does.
- **N6. The g4 count.** PREBRIEF L18 and L202 say 9 PASS. `g4.py` has 10 checks, and 10 passed here.

---

## What held up

- **Last round's M1.** One rule in §1, GR-L5 and GR4. The committed `r1` shows §1's rule accepting the Undo of a move out of a 300-node group and the re-add after a Delete. The cases that still can't undo are the ones the ask-first rule covers (S2 is about its wording).
- **Last round's M2.** The handle re-pointing is stated for both re-adds, with r5's sequences as tests. With empty groups kept, the `move` entry's `from.parent` check is right again.
- **S3 to S9 and the nits of last round** are taken as asked: animated and skinned nodes refused; a scale under 0.01 refused; Ungroup tied to the capture; `source` containers refused as parents and not counted; the select's rebuild rule; the "already in use" test; the three hellos and `c1.py`.
- **g4's finding.** A bare node can be selected, dragged, deleted and restored in the released page. That part of GR-L8 (c) stands.

---

## What I ran

| What | Result |
|---|---|
| `git fetch`, checkout of `95d7a096…` | worked; only `devtasks/` differs from `172b816d` |
| The harness (`setup.sh 95d7a096…`, `server.mjs`) | built and ran |
| `checks/grouping/g4.py` | 10 checks, all pass (the brief says 9; N6) |
| The committed `review/r1-gr4-undo.mjs` | ran; same output as last round |
| My probes `r7`, `r8` (Node) and `r9` (browser) | ran; outputs below |

**Not run:** the unit suites and the other design probes (I ran them last round, and no code has changed since); the committed `r2`–`r6` (they are byte-identical to the ones I delivered, apart from trailing whitespace); anything against DEV or PROD. Nothing was pushed.

**Limits of my probes.** The dropdown doesn't exist yet, so r9 evaluates GR8's test as the pre-brief words it. r7 applies the other tab's move to the SOM as GR6 describes it, not through a server.

**One note on the record.** The committed copy of my last review differs from the file I delivered in r6's quoted ranges (another run's numbers), and the committed `r1` has one line written differently. Neither changes a result.

---

## Probe outputs

**r7-drag-end-vs-cancel.mjs**
```
The crate was dragged from x = 1 to x = 1.13; the other tab moved it into lamp-01 (at x = 3).
gesture.end() after the reparent: sent                                   [["translation",[1.13,0.25,0]]]
  crate-01 then: parent / local / world                                  lamp-01 / [1.13,0.25,0] / [4.13,0.25,0]
gesture.cancel() after the reparent: sent                                nothing
  crate-01 then: parent / local / world                                  lamp-01 / [-1.9,0.25,0] / [1.1,0.25,0]
```

**r8-exact-when-frames-allow.mjs**
```
── the cube is at the top level
linear parts of world(group-01) and world(its parent) exactly equal          true
the translation before the Group (what another tab's entry holds)            [1.37,0.25,-2.61]
the translation computed for the Ungroup: inverse(world(parent)) × world     [1.37,0.25,-2.61]
  bitwise equal                                                              true
the group's translation + the part's (no matrix)                             [1.37,0.25,-2.61]  bitwise equal: true

── the cube is a part of P (turned 71°, scaled 2) inside “outer” (turned 37°, scaled 1.5)
linear parts of world(group-01) and world(its parent) exactly equal          true
the translation before the Group (what another tab's entry holds)            [1.37,0.25,-2.61]
the translation computed for the Ungroup: inverse(world(parent)) × world     [1.3700000000000003,0.25000000000000044,-2.61]
  bitwise equal                                                              false
the group's translation + the part's (no matrix)                             [1.37,0.25,-2.61]  bitwise equal: true
```

**r9_empty_groups.py** (browser, on the harness)
```
A. What GR8's isEmptyGroup lists today
  atrium.gltf: [{'name': 'avatar-bb09783f-camera', 'insideExternal': None, 'ownSource': False, 'avatar': True}]
  group.gltf: [{'name': 'Floor', 'insideExternal': None, 'ownSource': False, 'avatar': False}, {'name': 'avatar-bf17f070-camera', 'insideExternal': None, 'ownSource': False, 'avatar': True}]
  space-ext.gltf (external content): [{'name': 'Crate', 'insideExternal': None, 'ownSource': True, 'avatar': False}, {'name': 'Light', 'insideExternal': None, 'ownSource': True, 'avatar': False}, {'name': 'avatar-25782f3f-camera', 'insideExternal': None, 'ownSource': False, 'avatar': True}]
B. A bare node, selected as the dropdown would, then given a behaviour
PASS before: group-09 is in the list  [['avatar-1debf9b2-camera', 'group-09']]
  the Behaviour form for it: {'row': True, 'options': ['None', 'select-visibility', 'select-animation', 'proximity-animation', 'select-light', 'interval-animation', 'Custom graph'], 'save': False, 'status': 'Running', 'note': 'Behaviour changes are saved with the world and aren’t undone by Undo.'}
PASS the panel offers the Behaviour row for the bare node
  template None: Save not offered (Running)
  template select-visibility: Save pressed → the node's behaviour: {'template': 'select-visibility', 'enabled': True}
PASS a behaviour was saved on the bare node through the form  [{'template': 'select-visibility', 'enabled': True}]
  the server's copy: has a behaviour
FAIL after: group-09 is still in the Empty groups list (so it can be selected again)  [['avatar-1debf9b2-camera']]
FAIL a click where it is selects it  [ground-plane]
  page errors: []
2 failed
```
The avatar camera node, from a second look in the same harness: its parent is this tab's avatar (`avatar-<id>`, `extras.atrium.ephemeral`), it has no mesh, camera or extras, and the server's copy of the world has no node of that name. Another tab's avatar has no such child.
