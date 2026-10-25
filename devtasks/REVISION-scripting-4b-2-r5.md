# Revision — scripting-4b-2 round 5 (the browser checks and the outside review of the published tip)

**Status:** DRAFT Rev 0, for the operator's approval. Not in force.
- **Base:** round 4's published tip `957140bd92843b61b4ed692a4e368846f0d313ef`
  on `workflow/scripting-4b-2` (GLM APPROVE, `t_0bc9416b`; published by
  `t_58fd67a9`; on DEV as release merge `8ab5e52f` by `t_043bcfe0`). Round 5
  commits on top of it, on the same branch, in the existing worktree
  `/workspace/wt/scripting-4b-2`.
- **Round 4 is not accepted.** Its finalizer `t_6717fe9c` and acceptance gate
  `t_26410540` stay blocked as they are, superseded by round 5's chain, and
  round 4's sentinel `t_e7ef64b2` is not reused. **No one completes
  `t_6717fe9c` or `t_26410540`.** Round 5's DEV deploy replaces round 4's on
  DEV (the host allows `set-dev` from `WAITING_FOR_HUMAN_DEV_ACCEPTANCE`, as
  library-sky's round 2 did). Nothing reaches MAIN or PROD.
- **The contract still governs:** `devtasks/PREBRIEF-scripting-4b-2.md`,
  FINAL Rev 2.1, at `951b541bef818499a16692ac968f1800fdb75434` (sha256
  `a7841421312f5ae59b74d8623067986557b4a241f048c30adbb556bc44190a73`); the
  OPERATOR CORRECTION and OPERATOR NOTE on `t_6c3817b2`; round 2's revision
  (`45fcc433`, sha256 `4ef9aaad2237b61a5f8f9cf23ffcb6604f4e3765284e5e1d28f8ad95679bd2d0`),
  round 3's (`f47cc3f7`, sha256 `4e49b1d45cc33185c7955f8b881a66b5b46c3e101ff0bbd53864cf64ade0e93f`)
  and round 4's (`32c14a4f`, sha256 `aa28260f1454974ca97a745d846c93868911d1a9d7c2f5e0a01db046e8533ee6`).
  This file adds V1–V14 and changes nothing else.

## 1. What was found

Two independent passes over `957140bd`, after it was published and deployed:
- **Claude's §5.1 browser checks** in the harness (Chromium, real mouse
  clicks on the canvas). The scripts are in Claude's scratchpad and go to a
  `claude/` branch after PROD, as 4b-1's did (§4.4 of its passdown).
- **The operator's outside code review** of the whole round (`951b541b` to
  `957140bd`): NO-GO, findings M1–M7 and S1–S4. Claude checked each one
  against the code; §1.3 says which hold and where.

### 1.1 What works (browser checks)
- **The runtime, driven without the form** (behaviours written with the
  product's own `templateGraph` and `client.sendField`):
  - the engine loads through the import map;
  - select-visibility hides and shows a cube in the host and in a visitor's
    tab; a 10 px look-drag and a right-click trigger nothing;
  - select-light toggles `Sun` (3 → 0 → 3) in a world from `space-lights.gltf`;
  - Edit mode on: a click selects and triggers nothing; a hidden cube is
    selectable.
- **Two owner tabs (check 4):** the non-host's clicks do nothing; closing the
  host moves the role in 0.22 s (`hostGen` 1 → 2) and the behaviour runs in
  the other tab.
- **A 4b-1-style `hello` (check 5)** never becomes host; the next 4b-2 tab does.
- **The drag rule (check 6), for a send enqueued during the drag:** it is
  logged as "a behaviour send was dropped: the owner has an edit in
  progress", nothing is sent, and the cube stays where it was dropped.
- **Limits (check 7):** the 65th behaviour is refused with "this world already
  has 64 behaviours", and the 64th can still be clicked; `flow/while`, a `{n}`
  pointer and a back edge are refused with F1's texts and the validator's
  "output flow must point to a later node".
- **Saved (check 8):** after a restart from the saved document all four
  behaviours are there and run, and the hidden cube is still hidden.
- **Duplicate (check 8b):** a self-targeted behaviour's copy targets the copy
  (`nodeMap`, `params.target`), and a copy of a behaviour that targets another
  node keeps that target.
- **The host's workspace rules:** round 4's deploy passed the workspace, install
  and hard-link checks, and DEV is healthy.

### 1.2 What's broken (browser checks)
1. **The Behaviour form throws on every render that shows parameters**
   (`behavior-form.js` L495–531): `field.dataset = { ... }` raises
   `Cannot set property dataset of #<HTMLElement> which has only a getter`.
   - So choosing any template shows no parameters and no hint, and Save
     can't be reached.
   - Selecting an object that **already has** a behaviour throws through
     `selectForEdit` → `refreshEditPanel` → `refreshBehaviorRow`, so the
     rest of the Edit panel's refresh doesn't run. It also throws during
     Duplicate.
   - The owner can't create or edit a behaviour in the browser at all.
2. **Enabled does nothing.** `#ep-behavior-enabled` is a `<button>`, but the
   form listens for `change` and reads `.checked` (L634), and a button
   fires neither. (The outside review's M6, independently.)
3. **Every animation template does nothing.** The runner's play value is
   `{ clip, playing: true, loop, speed }` (`runner.js` L136). The server
   refuses it with "extras.atrium.animation must have exactly the keys clip,
   playing, loop, speed and startedAt", because 4a's leaf has five keys and the
   server stamps `startedAt` over the sent value (4a's `playValue` sends
   `startedAt: 0`). This breaks interval, select and proximity animation (check
   1, check 2's Fox and proximity).
   - **The refusal isn't visible anywhere:** the runner log stays empty. The
     spec has each opportunity "record the seq against the behaviour"; the
     runner looks up the record and discards it (`void record`).
4. **The Visible checkbox throws** "value is not iterable" and never un-hides
   (check 3). `#ep-visible` calls `editTracker.commit(selected, 'visible',
   bool)`, and `commit` runs `sanitizeTransform`, whose last line is
   `return [...value]` (`edit-gesture.js` L77).
   - Round 1's report said Visible went through `writeSend` like any node
     field. It does, but nothing ever ran it with a boolean.
5. **The clip check (S7) is inert, and the form's clip picker is always a text
   box.** `clipsFor` (`app.js` L2894–2904) returns `{ status: 'loaded' }` with
   no `clipIds`, and its comment says "the host's clip ids are not exposed to
   the page yet". They are: 4a's `modelAnimations.status(name).clips` drives
   the Animation row's clip list. The form gets no `deps.clipIds` either. This
   is a deviation from F4 and F9 that the handoffs didn't report.
6. **First person still draws the own capsule** (check 9). The `V` handler sets
   `avatar.localNode.visible = false`, but F6's `setNodeVisible` runs only on
   `som:set`, which fires for writes the server applies. The avatar's
   visibility is local (a second tab is unaffected, which is right), so
   nothing redraws it.
7. **The tests didn't catch 1, 2 or 4** because they all run against fakes
   more lenient than the browser: `behavior-form.test.js`'s `el()` has a
   writable `dataset` and lets a button carry `checked` and fire `change`, and
   no test commits a boolean through the tracker.
8. **Not yet checkable:** the Behaviour section's own texts. That covers the
   non-host line in check 4 ("Behaviours run in another tab; clicks here don't
   trigger them") and round 3's hint lines, because the form can't render. They
   run after round 5 publishes.

### 1.3 The outside review, checked against the code
| Finding | Holds? | Where |
|---|---|---|
| **M1** a queued write isn't re-checked for authority when it's sent | **Yes.** `opportunity()` finds the producing record and discards it (`void record`); neither the producer's generation nor F4's rule is checked again. The code's own comment says it is | `runner.js` L249–273 |
| **M2** deep nesting overflows the server's validation walk | **Yes, and it takes the server down.** Claude reproduced it on a second harness server: one owner `send` of a behaviour whose `graph` is an array nested 6,500 deep (13 kB) threw `RangeError: Maximum call stack size exceeded` in `hasForbiddenKey` (`send-policy.js` L1058), which nothing catches. The process exited; every world on it dropped and new tabs got connection refused. The same recursive walks guard document `extras` (L1395–1398), and did before this round, so PROD probably has the same exposure through that field; Claude didn't test PROD's tree. The load path (`world.js` L427) runs the same check on saved and file worlds. The client copy in `behavior-spec.js` L127–141 is recursive too | `send-policy.js` L699–705, L1045–1063; `session.js` L803 |
| **M3** a write queued before a drag goes out during it | **Yes.** The gesture is checked only in `enqueue`; `opportunity` doesn't check it. The spec's rule ("while set, a send whose target is that node … is dropped") covers it. Claude's check 6 enqueued during the drag, so it didn't see this | `runner.js` L227–235, L249 |
| **M4** an engine the adapter disposed stays in the frame loop | **Yes.** `tick` keeps the record, calls the disposed engine every frame (it throws, swallowed), writes "behaviour disabled — …" to the log **every frame**, and leaves its queued sends in place. The spec: "every disable is a `dispose()`", and S3 drops a disposed engine's entries | `runner.js` L289–304 |
| **M5** the 101st key doesn't disable its behaviour | **Yes.** `engines.get(nodeByName(objectId)?.name)` looks a UUID up as a name, so it finds nothing, and setting `reason` wouldn't dispose anything if it did. The spec says the behaviour is disabled with `over-send-cap` | `runner.js` L236–241 |
| **M6** Enabled can't be toggled | **Yes**, §1.2 item 2 | |
| **M7** a multi-stage Save can follow a replacement target | **Yes.** `aliveAsRecorded` compares the behaviour node by identity but looks the target up again (`nodeById`, which for an id-less target is by name), contrary to F9's "records the behaviour node and the target by SOM node identity and id" | `behavior-form.js` L131–143, L294–300 |
| **S1** a Custom graph can't be enabled or disabled | **Yes.** `setEnabled` returns at once for `custom`, and `render` disables the button; F9 says Custom shows "Enabled and Remove only" | `behavior-form.js` L405–407, L599 |
| **S2** a template's default target can be the wrong kind | **Yes.** `onTemplateChange` defaults the target to the selected node whatever the template's kind, so the light template on a cube keeps the cube as `targetId` while the picker shows a light | `behavior-form.js` L256–266, L166 |
| **S3** the checked-in conformance subsets are empty | **Yes**, as the fixtures say: 0 of 156 assets and 0 of 187 invalid cases use only F-L4's ops. It follows from the approved allowlist; the templates' execution tests and the probes are the evidence this round. **Not in round 5;** a follow-up (§3) | `tests/fixtures/behavior-conformance.json` |
| **S4** the host's test list omits `@atrium/behaviors` | **Yes**, round 4's §1.2; the small host round, not this one | host `buildrun.py` |

### 1.4 The regression scripts (§5.1 check 9)
All of 4b-1's, 4a's, library-sky's and edit-polish-3's scripts ran against
`957140bd`, and any that failed ran again against PROD's tree (`8358b043`) on
the same harness:
- **Pass:** 4b-1 c1 and c8; 4a c1, c4, c6, c7, c8b and c9; library-sky c1,
  c1b, c1c, c5, c67, c8, c910 and c11–c14; edit-polish-3 a–f.
- **4b-1 c4: an expected change, not a regression.** The script waits for the
  host line "Script host: this tab", and F9 changes it on purpose to "…(behaviours
  run here)". With the new text, the whole script passes: the handover, and
  `script-host:changed false` before `connecting`.
- **library-sky c23 and c4: a 4b-2 regression.** Both pass on `8358b043` and
  fail on `957140bd`.
  - **The symptom:** after the first library placement, the grid closes, so
    the next tile click lands on nothing. On PROD the grid stays open between
    placements.
  - **The cause:** `behaviorForm.open` calls `gate.claim('behavior')`
    (`behavior-form.js` L221) every time the Edit panel refreshes for a
    selection. Claiming the shared form gate closes whichever form holds it:
    the library grid, the Model form or the destination form. A placement
    selects the new node, so the grid closes.
  - The spec asked the Behaviour form to **register** with the gate so that
    Edit off closes it (F9), not to take it.

  Fixed by V13.

## 2. The contract (round 5)

### V1. The form renders in a real page
- **Every `dataset` write** in `behavior-form.js` sets a property
  (`field.dataset.field = 'target'`, and so on) and never assigns
  `dataset` itself.
- **Nothing else in the form, or in any other `apps/client/src` file, assigns
  a getter-only DOM property:** `dataset`, `style`, `classList`, `children`,
  `parentNode`. The worker greps for each and lists the result in the handoff.

### V2. Enabled is a button, and Custom graphs have it (M6, S1)
- The form listens for **`click`** on `#ep-behavior-enabled` and calls
  `setEnabled(!state.enabled)`.
- `render` keeps the label ("Enabled" / "Disabled") and the `disabled` rule,
  and stops writing `.checked`.
- **A Custom graph's Enabled works,** as F9 says: it rewrites the stored value
  with only `enabled` changed, and never regenerates the graph. It is disabled
  only while a write is in flight. "None" still has no Enabled.
- The markup is unchanged, apart from `type="button"` on the three action
  buttons.

### V3. The runner's animation values are 4a's, and its refused sends are logged
- **Play** enqueues `{ clip, playing: true, loop, speed, startedAt: 0 }`: 4a's
  five keys in 4a's order, with `startedAt: 0` (the server stamps it, as 4a's
  `playValue` relies on). **Stop** stays `null`.
- **The runner records each send's seq against its behaviour** (the spec's
  "records the seq against the behaviour"): the seq that `sendField` /
  `setModelAnimation` returns, with the behaviour id and generation.
- **On `edit:rejected` for one of those seqs,** it writes "a behaviour send
  was refused: <the server's message>" to the log, once per (behaviour, key,
  code) until that behaviour is reloaded. Nothing else changes: no retry and
  no disable. Seqs it didn't send are ignored, and a behaviour's seqs are
  forgotten when it's disposed.

### V4. Visible goes through the tracker
- `sanitizeTransform` returns a value that isn't an array unchanged. Scale,
  rotation and translation behave exactly as before.
- **Visible un-hides.** One commit is one send, the echo is applied, and
  Undo and Redo of a Visible change restore and reapply it through the same
  path as a transform's. If the undo stack can't hold a boolean field, the
  worker makes it hold one and says so in the handoff; it doesn't leave Visible
  out of Undo.

### V5. Clip ids reach the adapter and the form
- **`clipsFor(objectId)`** resolves the node and reads 4a's
  `modelAnimations.status(node.name)`:
  - no node, or no model on it, gives `{ status: 'none' }` as today;
  - `loading` gives `{ status: 'loading' }`;
  - any other state gives `{ status: 'loaded', clipIds: status.clips }`.
- The comment about clip ids not being exposed is removed.
- **The form gets `deps.clipIds`** from the same source. A loaded model shows
  its clips as a `<select>`; a loading or unknown target keeps the text box.
- **S7 is then live,** as F4 already specifies: a clip not in a loaded model's
  list is refused and logged once, and the graph continues on `err`.

### V6. First person hides the own capsule
- The `V` handler calls `setNodeVisible(docView, avatar.localNode, !firstPerson)`
  after setting `avatar.localNode.visible`.
- The reset on disconnect (`firstPerson = false`) shows the capsule again the
  same way.
- **Nothing is sent:** the avatar's visibility stays local, as it is today.

### V7. Each send is checked again when it leaves (M1, M3)
At the opportunity, before the name is resolved and the send goes out, the
runner drops the entry, and logs once per (behaviour, key), when any of these
fails:
- **its producer is still live:** an engine record with the entry's
  behaviour id **and generation**, not disposed;
- **F4's authority rule still holds** for the entry's `objectId`. The engine
  exposes the adapter's own predicate as `mayWrite(objectId)`: its own node, a
  descendant of it now, or a granted id in `targets` (an animation entry:
  `animations`' rule, as F4 has it). The adapter and the runner use the same
  function; there is no second copy;
- **the drag rule:** `isInGesture` for the resolved node, with the same log
  line as at enqueue.

The comment above `opportunity` describes what the code now does.

### V8. Every disable is a dispose (M4, M5)
- **When `tick` finds an engine disposed** (budget or error), the runner
  disposes the record the same way `disposeEngine` does: its queued entries
  and its seqs are dropped. It keeps `{ engine: null, reason }` so the panel
  still shows the reason. It logs "behaviour disabled — <reason>" **once**,
  and never calls that engine again.
- **The send cap:** when an `enqueue` would add the 101st key, the runner finds
  the producer by the `behaviourId` and `generation` that `enqueue` already
  receives, disposes it the same way with reason `over-send-cap`, and logs
  once. The queue stays at 100, and the other behaviours' entries are kept.
- **A re-enable is a reload,** as the spec says: Enabled, a new leaf value or
  a world change. Nothing restarts a disabled behaviour on its own.

### V9. The server's walks are bounded, and its checks fail closed (M2)
- **`hasForbiddenKey` and `maxDepth` become one iterative walk**, with an
  explicit stack and no recursion. It returns as soon as it finds a forbidden
  key or passes the limit it was given (`BEHAVIOR_DEPTH_MAX` for a behaviour,
  `MAX_EXTRAS_DEPTH` for document extras), so it never visits more than the
  limit's depth. Both callers (`behaviorCheck`, and document extras at
  L1395–1398) use it with their existing messages.
- **The same change in the client's copy** (`packages/behaviors/src/behavior-spec.js`
  L127–141), so the shared vectors still pass on both sides.
- **The send and add paths fail closed.** In `session.js`, an exception thrown
  by `authorizeSend` or the add check (including from `behaviorCheck`) refuses
  that message with `INVALID_VALUE` and "the value could not be checked". The
  session, the world and the process carry on, and the server logs one line
  with the session and field.
- **The load path fails closed too:** in `world.js`, an exception from
  `behaviorCheck` on load drops that behaviour to `null` with the existing log
  line's wording plus "(could not be checked)".
- These are the only server changes in round 5.

### V10. Save follows the target it recorded (M7)
- **On Save, the snapshot keeps the target's SOM node object,** beside its id
  (`null` for an id-less target).
- **Before every stage,** the form checks that this object is still in the
  SOM (`deps.nodes()` contains it), and that its id is the one the snapshot
  expects: none yet before the stage that gives it one, and that id after.
  It never looks the target up again by name or id.
- Any mismatch cancels, the same way as a selection change: the generation
  is bumped and "Save cancelled" is shown once.

### V11. The default target is one the template can use (S2)
- On a template change, the target defaults to **the selected node if it is
  in that template's `pickable()` list, otherwise the list's first entry**.
- `state.targetId` and the picker's selected option are always the same
  node.
- **With an empty list,** the picker shows the existing empty text (for the
  light template, `NO_LIGHTS`) and Save is disabled. It is never sent with
  the wrong kind of target.

### V12. Tests with the browser's rules
- **One strict element fake,** shared by `behavior-form.test.js` and any other
  form or panel test that builds elements:
  - `dataset` is a getter-only object, like `DOMStringMap`, so assigning it
    throws `TypeError`;
  - `style` and `classList` are getter-only too;
  - `checked` and `change` exist only on `input`s of type `checkbox` or
    `radio`;
  - a `<button>` dispatches `click` only.
- Every existing test in those files passes with it.
- **A wiring guard** in `behavior-wiring.test.js`:
  - no `apps/client/src` file contains `.dataset =`, `.style =` or
    `.classList =`;
  - the Enabled listener is `click`.

### V13. The Behaviour section doesn't take the form gate (§1.4)
- **`behaviorForm.open` no longer calls `gate.claim`, and `close` no longer
  calls `gate.release`.** The Behaviour section is part of the Edit panel,
  shown with every selection; it isn't one of the gate's mutually exclusive
  forms. Opening it never closes the library grid, the Model form or the
  destination form.
- **Edit off still closes it,** explicitly: `setEditMode(false)` calls
  `behaviorForm.close()` beside `modelGate.closeCurrent()`, so M4's
  cancellation on Edit off still holds. The form's `gate` argument and its
  `register` call go, or stay unused, whichever the worker's tests show is
  cleaner. The handoff says which.

### V14. What doesn't change
Everything else in F1–F12, C1–C3, the OPERATOR NOTE, round 2's R1–R2, round
3's T1 and round 4's U1. **The only server changes are V9's.** The runner's
queue order, coalescing and rate don't change; V3, V7 and V8 add the play
value's key, the seq record, the checks at the opportunity and the disposal on
disable.

## 3. Tests and proofs (round 5)

| Item | New tests |
|---|---|
| V1 | With the strict fake, choosing each of the five templates renders its parameters and its hint. Opening the form on a node that already has each template's value renders without throwing. Duplicate of a node with a behaviour leaves the form open on the copy |
| V2 | A `click` on Enabled rewrites the value with `enabled: false`, then `true`. A `change` event does nothing. On a Custom graph, Enabled is available and its value differs from the stored one only in `enabled`, with the graph deep-equal |
| V3 | Every animation value the runner enqueues, for all three animation templates, play and stop, passes `@atrium/client/animation-spec`'s `animationValueProblem` (an `apps/client` test, which has both packages); in `packages/behaviors`, the play value's keys are exactly `ANIMATION_KEYS`' five, in order. **Refusals:** a fake client that rejects a runner send gets one log line with the message; a second identical refusal adds none; a rejection of a seq the runner didn't send adds none; a disposed behaviour's seqs are gone |
| V4 | `sanitizeTransform('visible', false)` is `false`. Commit `visible: false` then `true` through the tracker: one send each, and Undo then Redo restore and reapply. Scale, rotation and translation's existing tests unchanged |
| V5 | `clipsFor` with a fake `modelAnimations`: no model gives `none`; loading gives `loading`; loaded gives the ids. The form shows a `<select>` of those ids. The adapter refuses `NoSuchClip` on a loaded target (end to end through `clipsFor`) |
| V6 | A wiring guard: the `V` handler calls `setNodeVisible` with `avatar.localNode`, and so does the disconnect reset |
| V7 | With fake timers and a fake client: **reparent** a descendant target out of the behaviour's subtree between enqueue and the opportunity, and nothing is sent, with one log line; the same for a target whose grant is removed (the leaf rewritten without it: the old generation's entry is dropped); an entry whose producer was reloaded (new generation) is dropped; **a gesture that starts after enqueue** (the review's M3 scenario) drops the queued send at the opportunity and nothing is replayed on `setGesture(null)`; entries for other nodes are still sent in order |
| V8 | An engine the adapter disposes for `over-budget`: over the next 60 ticks, its `tick` is never called again, the log has one disable line, its queued entries never leave, and the panel status is the reason. **The send cap with real producers:** 100 keys from behaviour A, then a 101st from behaviour B, and B is disposed with `over-send-cap` (one line), A's 100 entries still leave, B's `tick` is never called again; Enabled (a reload) brings B back |
| V9 | **Server, port 0, a real WebSocket:** an owner `send` of a behaviour whose `graph` is an array nested 6,500 deep, and the same for document `extras`, is refused (`behavior-type` and the existing depth message), the connection stays open, and the next valid send on it is accepted; a second session in the same world is unaffected. The fail-closed boundary: with `authorizeSend` stubbed to throw, a `send` is refused with "the value could not be checked" and the process keeps serving. A saved document with a 6,500-deep behaviour loads, with that behaviour `null` and the log line. **Both copies of the walk** (server and `behavior-spec.js`): depth limit exact (limit passes, limit + 1 refused), a forbidden key at depth 3 found, and a 100,000-deep array refused without a `RangeError` |
| V10 | Save on a node whose target `Lamp` has no id: after stage 1's answer, `Lamp` is removed and a new node named `Lamp` is added (the review's scenario), and the next stage cancels with "Save cancelled", with no further send; the same when `Lamp` keeps its object but its id is changed between stages |
| V11 | The light template chosen on a cube in a world with one light defaults to that light, and Save's value targets it; with no light the picker shows `NO_LIGHTS` and Save is disabled; the select-visibility template on a cube defaults to that cube |
| V12 | The guard above |
| V13 | With a real `createFormGate` and the library grid's, the Model form's and the destination form's closers registered: the grid open, then the Behaviour section opened for a selection, and the grid is still open (the same for the Model form and the destination form); Edit off closes the grid and the Behaviour form, and a Save in flight is cancelled with "Save cancelled" (M4's test, still green). **In the harness** (after publish): library-sky c23 and c4 pass |

**Proofs** ("not reproducible" is not an acceptable result):
- **(v1)** one `field.dataset = {…}` restored: the strict-fake render test
  fails;
- **(v2)** the Enabled listener changed back to `change`: V2's test fails;
- **(v2b)** `if (state.custom) return null` restored in `setEnabled`: the
  Custom-graph test fails;
- **(v3)** `startedAt` dropped from the play value: `animationValueProblem`'s
  test fails;
- **(v3b)** the `edit:rejected` handler removed: the refusal test fails;
- **(v4)** `return [...value]` restored: V4's test fails;
- **(v5)** `clipIds` dropped from `clipsFor`: the `NoSuchClip` test fails;
- **(v6)** the `setNodeVisible` call removed from the `V` handler: the guard
  fails;
- **(v7)** the authority check at the opportunity removed: the reparent test
  fails; **(v7b)** the gesture check at the opportunity removed: the M3 test
  fails;
- **(v8)** the disposal in `tick` removed: the 60-tick test fails (the log has
  60 lines); **(v8b)** the cap's lookup changed back to `nodeByName(objectId)`:
  the real-producer test fails;
- **(v9)** the recursive `hasForbiddenKey` restored: the 6,500-deep server test
  fails (the test runs the server in a child process, so the failure is the
  child's exit, not the test runner's); **(v9b)** the `try` around
  `authorizeSend` removed: the stubbed-throw test fails;
- **(v10)** the target lookup by `nodeById` restored in `aliveAsRecorded`: the
  replacement test fails;
- **(v11)** the default target set back to the selected node: the light-on-a-cube
  test fails;
- **(v12)** the strict fake's `dataset` made writable again: (v1)'s test
  passes, which shows the fake is what catches it. The worker restores it and
  quotes both runs;
- **(v13)** `gate?.claim(name)` restored in `open`: the grid-stays-open test
  fails; **(v13b)** the explicit `behaviorForm.close()` on Edit off removed:
  the Edit-off cancellation test fails.

**And the whole round still passes:**
- full suites, with round 1's rules (server files one at a time under
  `timeout 180`, `packages/client` without `--test-force-exit`, every other
  package on its own directory, `importmap-guard` and the workspace-rules guard
  green, the one named conformance skip and no other);
- **`r1`** (`devtasks/spike-4b/r1.mjs`) with the same output as before.

**Steps, one commit each:**
1. V1, V2, V10, V11, V12 and V13: the form, the strict fake, the guard and the gate;
2. V3, V7 and V8: the runner (and the adapter's `mayWrite`);
3. V9: the walks, the fail-closed boundaries, server and client copies;
4. V4, V5 and V6: `edit-gesture.js` and `app.js`;
5. suites, proofs and the handoff. The handoff includes V1's grep results.

**Follow-ups, not in round 5:**
- **The host's test list** (S4): add `@atrium/behaviors` in the small host
  round, as round 4 §3 says.
- **Conformance coverage** (S3): a small set of independently written graph
  fixtures within F-L4's ops (pointer get/set, `onSelect`, `receive`,
  `branch`, animation start/stop) with expected results, for 4c or 4d, when
  the allowlist grows.
- **PROD's document-extras walk** (V9's pre-existing path): PROD runs the
  same recursive walk on document `extras`, an owner-only send, so it probably
  has the same exposure today (untested). V9 fixes it when 4b-2 reaches PROD.
  If the operator wants it sooner, it's a separate one-file hotfix of
  `send-policy.js` and `session.js`, not part of this round.

**Before DEV acceptance**, after round 5's release chain publishes and
deploys:
- **Claude's §5.1 browser checks** again, all of them, **through the form
  this time** (choose, fill, Save, Enabled, Remove), plus the texts §1.2 item 8
  couldn't reach, and the M2 reproduction against the round-5 server;
- **the operator's outside re-review** of the round-5 diff (`957140bd` to the
  round-5 tip), as the review recommends;
- **after the DEV deploy,** `atrium-release-status`: DEV actual = recorded =
  `RELEASE_SHA`, healthy.

The operator then runs the spec's §6 DEV acceptance.

## 4. Kickoff body for round 5 (post it verbatim as the revision kickoff card's text)

---

### KICKOFF — scripting-4b-2 revision round 5. Slug: `scripting-4b-2`

You are the kickoff orchestrator for round 5 of `scripting-4b-2`. Build the
graph below, read it back, report, and stop. Do not implement, review or
deploy anything yourself.
- **Your tools:** only `kanban_*`.
- **Blocking:** never call `kanban_block` without an explicit `task_id`, and
  never block this card.
- **Titles:** use them exactly as written. Don't add words to them.

**The contract is in git; you don't read it.** It is
`devtasks/REVISION-scripting-4b-2-r5.md` on `main`, together with
`devtasks/PREBRIEF-scripting-4b-2.md` at `951b541bef818499a16692ac968f1800fdb75434`
(sha256 `a7841421312f5ae59b74d8623067986557b4a241f048c30adbb556bc44190a73`),
`devtasks/REVISION-scripting-4b-2.md` at `45fcc433015c54355fcec31a8917f6c548af9434`
(sha256 `4ef9aaad2237b61a5f8f9cf23ffcb6604f4e3765284e5e1d28f8ad95679bd2d0`),
`devtasks/REVISION-scripting-4b-2-r3.md` at `f47cc3f7198a33309a59eee845167b61ae3ac173`
(sha256 `4e49b1d45cc33185c7955f8b881a66b5b46c3e101ff0bbd53864cf64ade0e93f`),
`devtasks/REVISION-scripting-4b-2-r4.md` at `32c14a4f85e4127c1204fca5562edb319a67df9b`
(sha256 `aa28260f1454974ca97a745d846c93868911d1a9d7c2f5e0a01db046e8533ee6`)
and the two operator texts on `t_6c3817b2` (the OPERATOR CORRECTION and the
OPERATOR NOTE).
- **The front door has already checked the round-5 revision** and posted
  its commit and sha256 on this card. **You have only `kanban_*` tools: do
  not try to fetch or hash anything, and do not block for lack of a shell.**
- Copy that commit and sha256 into cards 1 and 2. **They** have terminal,
  file and git tools. Each reads the revision with
  `git -C /workspace/atrium fetch origin main && git -C /workspace/atrium show <commit>:devtasks/REVISION-scripting-4b-2-r5.md > /tmp/revision-r5.md && sha256sum /tmp/revision-r5.md`,
  and blocks with `kind="capability"` on a mismatch.

#### Graph
1. **`Implement r5 — scripting-4b-2`.** Assignee `atrium-deepseek`, parent:
   this kickoff, `--max-runtime 3h` (10800 s).
   - **Body:**
     - the revision reference and hash check;
     - continue `workflow/scripting-4b-2` from
       `957140bd92843b61b4ed692a4e368846f0d313ef` in the existing worktree
       `/workspace/wt/scripting-4b-2` (`git -C /workspace/wt/scripting-4b-2
       status` must be clean at that SHA, or block `needs_input`);
     - the revision's §2 contract and §3 steps, tests and proofs;
     - the spec, the two operator texts on `t_6c3817b2`, and rounds 2's, 3's
       and 4's revisions, still binding;
     - the WORKER-CARD REQUIREMENTS comment (855 on `t_2d41531f`);
     - **a progress comment on its own card after each step's commit**, so a
       run that stops on its iteration budget resumes from its last comment.
   - **The handoff** carries proofs (v1)–(v13) with their (b) variants, V1's
     grep results, `r1`'s output, and per-file counts with exit codes and the
     one named skip.
2. **`GLM review r5 — scripting-4b-2`.** Assignee `atrium-glm`, parent:
   card 1.
   - Its body opens with
     `THIS RUN HAS TERMINAL, FILE AND GIT TOOLS. Use them for every step below.`
   - **The review covers round 5's change** (`957140bd` to the round-5 tip)
     against this revision. It reproduces **every proof** itself, (b)
     variants included.
   - **It reproduces the outside review's M2 against the round-5 server:**
     a 6,500-deep behaviour `send` on a real port-0 server is refused, and the
     process keeps serving.
   - **It checks the strict fake against the browser's rules** in V12, one by
     one: `dataset`, `style` and `classList` getter-only, `checked` and
     `change` only on checkbox and radio inputs, buttons `click` only.
   - **It reads every `apps/client/src` write to a DOM property** that V1
     names.
   - **It confirms the only server changes are V9's,** and that the runner's
     queue order, coalescing and rate are unchanged.
   - **Progress comments on its own card** after each stage, so a run that
     stops on its iteration budget resumes from its last comment.
3. **`Review gate r5 — scripting-4b-2`.** Assignee `atrium-orchestrator`,
   parent: card 2. It creates nothing.
   - **On a valid APPROVE of the exact 40-character SHA,** it blocks with
     `APPROVE <SHA40>: front door, build the release chain`.
   - **Otherwise,** it blocks for the operator with the verdict quoted.
4. **Before you complete,** link card 3 to **round 5's sentinel** as a
   parent. The front door creates it and posts its id on this card. Rounds
   1–4's sentinels (`t_6ad02da5`, `t_31a95fba`, `t_b9c2a9bc`, `t_e7ef64b2`)
   must not be used. Do not create a sentinel yourself.
5. **The release chain** is the front door's: the same four cards as
   scripting-4b-1's (Publish, DEV deploy, DEV finalizer, acceptance gate),
   with the new SHA, built whole at card 3's APPROVE.
   - **Round 4's chain cards (`t_58fd67a9`, `t_043bcfe0`, `t_6717fe9c`,
     `t_26410540`) are not reused,** and no one completes the two of them
     that are still blocked.
   - The DEV deploy replaces round 4's release on DEV. Nothing reaches MAIN
     or PROD.

#### Report back
- the three ids;
- the implementation's parent and its 10800 s cap;
- the hash line copied into cards 1 and 2;
- the review's opening line;
- the gate linked to round 5's sentinel.

Then complete this card.

---
