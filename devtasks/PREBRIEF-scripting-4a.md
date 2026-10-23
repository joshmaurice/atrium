# Pre-brief: Phase 3 step 4 — scripting: the plan (4a–4d), and 4a (model animations) in detail

Status: **DRAFT, Revision 1.1 (2026-10-23). Decisions D1–D6 (the whole step)
and L1–L9 (4a) open (§3).**
- **Rev 1.1 applies a second outside review** (of Rev 1, "sound; seven
  fixes, no conceptual change"). The changes are listed in §10.
- **Rev 1 applies an outside review of Rev 0** ("changes recommended, no
  conceptual redesign"): five must-fix, two should-fix and two conditions on
  4b, all taken. §10 lists them.
  - **Changed recommendations:** L5 is now **(b)**, the server stamps
    `startedAt`. L8 is now a unique clip id with an index map.
  - **Narrowed:** D2 is provisional, and D5 sets a direction only.
- **Drafted by Claude from `main` at `1206a52`.** Its code is identical to
  the released `a31c5a62` (DEV, MAIN and PROD).
  - **The kickoff's base will be whatever edit-polish-3 releases as.** That
    round changes the Edit panel. The brief author re-checks P7
    (`refreshModelRow`) and Z6's `app.js` call sites against that base
    before writing the brief. Claims marked *probe* were
  run against the real modules with throwaway scripts (not committed). The
  rest are read from the code, with line numbers at `1206a52`.
- **Sources:**
  - the design, `docs/DESIGN-phase3-placement-scripting.md` Rev 1.2:
    - §4.3 (a model's own animations, `playback` on the placed node);
    - §4.9 (`objectId`);
    - §5 (scripting: host, `activate`, API, storage, interpreter,
      templates);
    - §9 row 4 and §10 Q1, Q2, Q4, Q6 and Q7;
  - the undo-redo passdown (10-18) §5.1 item 2: edit versus play, and
    grouped undo;
  - the models-by-url pre-brief, L10: animations not played in 3a, so that
    playback could be synced;
  - an evaluation of the Khronos interactivity engine (§2, P8).
- **Scope of this document:**
  - §1–§3 frame the **whole step**, its split into four rounds, and six
    decisions that shape all of them (D1–D6);
  - §4–§8 are the **contract for 4a only**: a placed model's own animations,
    played and stopped by the owner, synced for everyone and saved with the
    world. There is no scripting in 4a.
  - **4b, 4c and 4d each get their own pre-brief** when their turn comes,
    as step 3's 3b did. §9 sketches them.
- **Out of scope for 4a:**
  - everything scripted: behaviours, the script host, `activate`,
    `objectId`, the interpreter and templates;
  - pausing (L3);
  - the world file's own animations (`SOMAnimation`, §9.5);
  - named-part overrides;
  - the SOM Inspector showing models.

## 1. Why step 4 is several rounds

The design's step 4 row (§9) is the largest in Phase 3. Its client part is a
script API, an engine, events, animation control, a `KHR_interactivity`
interpreter, templates and an import converter. Its server and protocol part
is `hello.scriptHost` and `hostGen`, a `script-host` message, `activate`
with its distance check and two rate limits, `objectId` uniqueness, and
schemas for all three.

As one round it would be bigger than models-by-url, which took six
revisions. It splits cleanly, and each part is useful by itself:

| Round | What the owner gets | Server / protocol |
|---|---|---|
| **4a** | Placed models play their own animations. The owner picks a clip and presses Play (loop or once) or Stop in the Edit panel. Everyone sees the same frame, and it's saved with the world | One new writable node leaf, `extras.atrium.animation`, with a strict value check on `send` and `add`. No schema change |
| **4b** | Behaviours, owner-present. Templates in the Edit panel ("on click, play this animation", "show or hide that", "toggle a light", "every N seconds…"), run by one owner browser, the script host | `objectId`; `hello.scriptHost` and `hostGen`; `script-host` (handover and revocation); schemas |
| **4c** | Visitors can trigger behaviours: a visitor's click on a scripted object reaches the owner's runner | `activate` (visitor → server → host), distance check, per-session and world-wide rate limits; schema |
| **4d** | Graphs beyond the templates: import a `KHR_interactivity` graph, a wider node subset, the unsupported-node report, the Khronos test assets | None expected |

**4a first** because:
- it is what the operator noticed missing (models-hardening acceptance);
- design §5.3 says "continuous motion never goes over the network: scripts
  start and stop glTF animations, which syncs only the playback state", so
  4b's most common template ("on click, play an animation") needs 4a's
  synced playback underneath it anyway;
- it needs none of the script machinery.

## 2. What the code does today (at `1206a52`)

### P1. A placed model's clips are built, retargeted and never played
- **The clips are already built.** `buildInstance` (`model-instances.js`
  L105) clones the template and retargets each clip to the instance by
  identity (A7). The model bridge keeps them on its record
  (`record.clips`, `model-bridge.js` L613), and `disposeInstance` disposes
  them.
- **Nothing creates an `AnimationMixer` for a model.** The models-by-url
  pre-brief, L10, chose "not played (rest pose); its clips are kept ready for
  step 4", because autoplay would be per visitor and unsynced.
- **Clip names come from GLTFLoader:** the file's animation name, or
  `animation_<index>` when unnamed (three r163 `GLTFLoader.js` L3950). Names
  aren't guaranteed unique within a file.
- **Library items have no animations.** Poly Haven's models are static, so
  testing needs an animated model by URL, for example from Khronos's
  glTF-Sample-Assets (§6).

### P2. The world file's own animations already sync, with two flaws
This is the pattern design §4.3 points to ("synced the way
`SOMAnimation.playback` is").
- **`SOMAnimation`** (`packages/som/src/SOMAnimation.js`) keeps `playback`:
  `playing`, `paused`, `loop`, `autoStart`, `timeScale`, `startTime`,
  `startWallClock` and `pauseTime`. It persists in the animation's
  `extras.atrium.playback`, and `play()`, `pause()` and `stop()` each write
  it once.
  - `AtriumClient` sends a local `playback` change as a `send` on the
    animation (L1228).
  - The server allows only `playback` on an animation, with an exact shape
    check (`send-policy.js` L328–341, L705).
  - `AnimationController` and `AnimationBridge` (renderer-three) drive a
    three.js mixer from it.
- **Flaw 1: each viewer's own clock.** `currentTime` is
  `(Date.now() - startWallClock) / 1000` on the **viewer's** clock, and
  `startWallClock` is the **sender's** `Date.now()`. A viewer whose clock is
  2 s off sees the animation 2 s off. Nothing in the client estimates the
  server's clock.
- **Flaw 2: every viewer stops it.** When a non-looping clip ends,
  `AnimationBridge._onMixerFinished` (L119) calls `anim.stop()` **in every
  client**. Each one sends a `send`: the owner's is accepted, and each
  visitor's is refused, so it shows as a console error.
- These are recorded in §9.5, not fixed in 4a. 4a's design avoids both
  (L5, L6).

### P3. The server's clock is available but unused
- **`hello`** carries `serverTime` (required) and `worldStartTime`.
- **`ping` → `pong`** with `clientTime` and `serverTime` is already answered
  by the server (`session.js` L632), with its schema in `@atrium/protocol`.
  Only the protocol inspector sends pings today; `AtriumClient` ignores
  `pong` (L465).
- **`tick`** carries `serverTime` too, and the client ignores it (L464).
- **All of these are the server's `Date.now()`:** `hello.serverTime`,
  `pong.serverTime`, `tick.serverTime` and, under L5 (b), Z2's stamp. So
  the stamp and every client's estimate use one clock.
- So a client can estimate the server's clock with no protocol change: the
  usual round-trip method, offset = `serverTime` − (`clientTime` + RTT/2),
  keeping the sample with the lowest RTT.

### P4. Node `extras` are writable only through an allowlist
- `send` on a node allows `translation`, `rotation`, `scale`, `visible`,
  `name`, the material chain, and **exactly one extras leaf**,
  `extras.atrium.teleporter.destination` (`send-policy.js` L50, L69, L629).
  This is send-field-allowlist's D2. Anything else under `extras` is
  refused.
- On `add`, `checkAtriumExtras` (L161) checks `extras.atrium.teleporter` and
  `extras.atrium.model`, and accepts other keys as they are.
- **`extras.atrium.model` has a strict key set:** `url`, `sha256` and
  `bounds` (L194, L272–276). A `playback` key inside it, the design's
  example, would be refused, and it would also change the value the model
  bridge keys its loads on (`specKey`, L924).
- So 4a needs **a new, separate leaf** and a server check for it (L1).

### P5. How a model's visual reaches the frame loop
- **`Stage.tick(dt)`** (renderer-three `Stage.js` L307) advances navigation,
  `AnimationController` and `AnimationBridge`, then renders. It has no hook
  for the model bridge.
- **The model bridge's records** are keyed by node name and carry
  `instance` (`wrapper`, `scene`, `clips`) and a status (`loading`,
  `loaded`, `failed`). `status(name)` is public (L882).
- **Two lifetimes, already separate (A9; review 4):**
  - **An instance** is created when a load succeeds. It's disposed by
    `clearVisual` (`model-bridge.js` L319): on remove, a spec change, a
    failure after a reload, or a world reset. Disposal goes through
    `disposeInstance`, which disposes its skeletons and retargeted clips.
  - **A view change** (`detachView` L292 / `attachView` L285, including an
    external reference's repeated `world:loaded`) **keeps the same
    instance**: it re-hosts the same wrapper and never rebuilds it.
  - An animation's mixer therefore belongs to the **instance**, not the view.
- **Records are keyed by node name.** A name is reused when a node is removed
  and another added under the same name, so anything that follows an
  instance must hold the instance itself, not its name.

### P6. Undo, Duplicate and capture
- **The undo engine records** transforms, renames, the material chain, add,
  delete and duplicate. It has no extras-leaf kind except through whole
  descriptors.
- **Duplicate and the delete capture keep the node's `extras`**
  (`edit-duplicate.js` L167–168). A duplicated or restored model would carry
  its `extras.atrium.animation` with it. With L5's time rule, a copy then
  plays in step with the original, and a restored one carries on where it
  would have been.

### P7. The Edit panel's model row
- **`refreshModelRow()`** shows a selected model node's URL and status
  (models-by-url Z7). It's refreshed on `som:set`, selection and the bridge's
  status changes.
- The row is where the clip controls go (L7).

### P8. The Khronos interactivity engine (for D2)
A separate evaluation read the code of the tool, its npm package, the Khronos
Sample Renderer and the test-asset repo (shallow clones, 2026-10-22). Claude
then checked the package's metadata and loaded it in Node (*probe*).
- **The status of the extensions:** the glTF registry lists
  `KHR_interactivity`, `KHR_node_selectability` and `KHR_node_hoverability`
  as ratified (registry change of 2026-08-30), and `KHR_node_visibility`
  since 2026-04. The spec is still being edited after ratification (pointer
  and variable interpolation, 2026-10-13).
- **The engine is published on its own:**
  `@khronosgroup/gltf-interactivity-engine` 1.1.0 (2026-10-14), Apache-2.0.
  `build/index.js` is one ES module of 12,005 lines (about 350 KB
  unminified), with a single import, `gl-matrix` ^3.4.3.
  - *Probe:* with `gl-matrix` 3 installed, it imports in Node 22 and `new
    BasicBehaveEngine(60)` constructs. `loadBehaveGraph`,
    `executeEventQueueTick`, `registerJsonPointer` and `dispose` are all
    there.
  - **No build step is needed to vendor it,** which fits AGENTS.md's "no
    build step".
- **It isn't tied to Babylon or React.** Those are in the editor's
  `BabylonDecorator`. The host plugs in through an `ADecorator` subclass:
  - JSON-pointer get and set (`registerJsonPointer`, `resolveJsonPtr`);
  - animation start, stop and stop-at;
  - `select` and `hoverOn` for the selectability and hoverability events;
  - `getParentNodeIndex`;
  - an event bus;
  - debug and error hooks.
- **Khronos's own Sample Renderer** (`@khronosgroup/gltf-viewer`,
  Apache-2.0) depends on this engine. Its adapter is about 1,050 lines of
  plain JavaScript, and it drives the engine with one
  `executeEventQueueTick()` per rendered frame. That is the model for an
  Atrium adapter.
- **Coverage:** all 138 operations in the spec's catalogue are registered,
  including the event, flow, pointer, variable, animation and math nodes,
  with interpolation. Unknown operations become no-ops.
- **Tests:** the tool runs the engine headless against Khronos's
  `glTF-Test-Assets-Interactivity` (162 test `.glb` files with JSON
  sidecars, CC-BY 4.0).
- **Risks:**
  - The API is still moving: 1.1.0 lists breaking interface changes
    against 1.0.0, so pin the version.
  - It reads `performance.now()` and uses real `setTimeout` for
    `flow/setDelay`. A Node test needs those stubbed.
  - Values are shared mutable arrays, so the adapter copies before
    mutating.
  - Errors thrown inside a tick must be caught by the host.
- **The alternative,** a hand-written interpreter for the template subset,
  was estimated at 1,200–2,000 lines plus tests. It would fail most of the
  Khronos assets and need rework for every new operation.

### P9. Test baseline at `1206a52`
- **Suites:** server 530 (34 files), `packages/client` 391, renderer-three
  265, `apps/client` 766, som 234, protocol 71 and interaction 9. All pass.
  Node v22.22.0.
- **Ports:** new server tests use port 0 (AGENTS.md).

### P10. A new extras leaf can't be set today (*probe*)
- **`SOMDocument.setPath`** (`packages/som/src/SOMDocument.js` L949)
  refuses a final key that doesn't exist yet. It throws `Unknown property
  "animation" on Object` when `extras.atrium.animation` is first set on a
  model node. An existing leaf (`extras.atrium.model.url`) is set fine.
- **The server applies a `send`, and every client applies a `set`
  broadcast, through `setPath`,** so a first Play would fail everywhere
  until the leaf exists. The teleporter leaf never hit this, because a pad
  is always created with its `destination`.
- 4a therefore includes a narrow SOM change (Z2).

### P11. No client call sends a node's extras leaf
- **Node edits reach the wire through SOM mutation events** (`AtriumClient`
  `_attachNodeListeners`, L1148). Setting `node.extras` sends the field
  `extras` as a whole, which the server refuses (D2 of the allowlist round).
  An in-place change to a nested extras value fires no event at all.
- **No first-party code sends `extras.atrium.teleporter.destination`;** the
  server allows it, but no UI edits it.
- **The pattern to copy is `renameNode`** (L827):
  - it sends `send` with an explicit `field` and tracks the pending edit;
  - nothing changes locally until the answer;
  - the own echo resolves it (`_resolveOwnSetEcho`, L1027), and the client
    then applies it and emits.

  Accept-then-apply needs no rollback on rejection.

### P12. How three.js holds a clip's end (*probe*; review 1)
- **The setup:** a 2 s clip moving `box.x` from 0 to 10, driven by setting
  `action.time` and calling `mixer.update(0)` each time.
- **The result:** times past the end gave `x = 10` with the action still
  enabled, under the default `LoopRepeat` and also under `LoopOnce` with or
  without `clampWhenFinished`. Setting the time back to 1 gave `x = 5`.
- **But** this relies on `update(0)` skipping the loop and finish logic.
  The defaults are `LoopRepeat` and `clampWhenFinished = false`, so any real
  delta (or a later three.js) can wrap a clip or disable it at its end.
  - Z5 therefore configures every action as `LoopOnce` with
    `clampWhenFinished = true`, and computes looping itself (Z4).
  - The tests check the **animated object's own values**, not only the
    computed time.
- **Stop restores the loaded pose only through `action.stop()`** (*probe*,
  second review 2). The test object starts at `x = 0`, with a clip running
  from 5 to 10:
  - `reset()` then `update(0)` gives `x = 5`: the clip's first frame, not
    the rest pose;
  - `action.stop()` alone gives `x = 0`. The mixer saved each binding's
    original value when the action was first activated, and restores it
    when the action stops.

### P13. The clip list isn't the file's animation list (review 3)
- **`buildInstance` keeps only clips with at least one bound track**
  (`model-instances.js` L80–81: a clip with no resolvable track returns
  `null` and is skipped). So `record.clips[i]` need not be the file's
  animation *i*.
- **Names aren't unique.** A file can hold `Walk`, `Walk` and `Walk (2)`. A
  naive " (2)" suffix gives two `Walk (2)`.

## 3. Decisions

### The whole step (D1–D6)
These set the direction for 4b–4d, so later pre-briefs don't reopen them.
4a depends only on D1.

- **D1 — The split.**
  - **(a) Recommended: four rounds, 4a → 4b → 4c → 4d** (§1), each released
    before the next pre-brief is final.
  - (b) Two rounds: 4a, then everything else.

  (b) puts the host, `activate`, the interpreter and templates in one round,
  which is the size problem §1 describes.
- **D2 — The interpreter.**
  - **(a) Recommended: vendor Khronos's engine** (`@khronosgroup/gltf-interactivity-engine`,
    pinned at 1.1.0, with `gl-matrix` 3) as plain ES modules under
    `packages/`. Atrium writes an adapter (`ADecorator`) onto the script
    API, using the Sample Renderer's adapter as the model (P8). Design §5.5's
    "evaluate before writing" comes out as reuse:
    - it has full operation coverage;
    - it has a conformance suite (the Khronos test assets), so 4d is mostly
      the converter and the report.
  - (b) Port selected parts.
  - (c) Write a small interpreter for the template subset.

  (b) is a fork of tightly coupled code. (c) is more code than the adapter
  and fails most of the conformance assets.

  The graph JSON stays standard either way (§5.4), so the choice can change
  later without migrating worlds. **Vendoring needs the operator's OK:** it
  is about 350 KB of third-party code, Apache-2.0, and a `NOTICE` entry.
  - **(a) is provisional (review 8).** The engine has been shown to import,
    construct and take an adapter. That doesn't yet prove Atrium can bound
    it.
  - **4b starts with a short integration spike**, and the engine is used
    only if the spike shows:
    - **bounded execution:** a work budget per event or tick, so a looping
      flow can't freeze the page;
    - **cleanup:** memory and timers (`setDelay`) are released on stop and
      on world change;
    - **pointer authorization:** writes outside the behaviour's `targets`
      are refused through the adapter;
    - **rejection** of the Khronos invalid-graph assets.

    If any of these fails, (c) is reconsidered.
- **D3 — Templates are stored as standard graphs.**
  - **(a) Recommended: yes, as design §5.5 says,** so a later editor or an
    export reads them unchanged. The template form writes a small graph from
    a few parameters.
  - (b) A short Atrium template record (`{ template, params }`), compiled to
    a graph at run time.

  (b) is simpler in 4b but gives two formats to support forever.
- **D4 — A behaviour's changes are saved.**
  - **(a) Recommended for Phase 3: yes.** A behaviour's writes are ordinary
    owner sends (design §5.2), so autosave keeps them: a light a template
    toggled stays toggled after a reload. Animation state is saved anyway
    (4a).
  - (b) Runtime-only changes: a separate unsaved layer, with authored values
    kept apart from live ones.

  (b) is the cleaner model (undo-redo passdown §5.1 item 2), but it's a
  protocol and persistence feature of its own. With (a), the template form
  says plainly that behaviour changes are saved.
- **D5 — Behaviours and Edit mode.**
  - **(a) Recommended: behaviours keep running while the host owner is in
    Edit mode,** and the owner's clicks in Edit mode select rather than
    activate.
    - The undo engine already ignores writes that don't come from a gesture,
      and it refuses an undo of an object "changed elsewhere".
    - **4b must settle what a behaviour does to an object the owner is
      dragging:** its writes are from the same session, so the edit tracker
      can't tell them from the owner's. The likely answer is that the runner
      skips writes to the object being dragged.
  - (b) The runner pauses while its owner is in Edit mode, with visitors'
    `activate` refused meanwhile (4c).
  - **Approving (a) now fixes the direction only (review 9).** The conflict
    rule is 4b's decision, together with D4. Skipping the dragged node isn't
    enough: a behaviour can change the node's parent, an animated child or a
    shared material. 4b chooses between:
    - suppressing behaviour writes to the whole edited subtree, its ancestors
      and the resources it shares;
    - pausing the affected behaviours during a gesture.

    It also says what happens to their pending writes when the gesture ends.
- **D6 — `objectId` arrives in 4b, assigned at creation.**
  - **(a) Recommended:**
    - every new node from the palette, a model, a teleporter, the library or
      Duplicate gets a UUID in `extras.atrium.objectId` on `add`;
    - an existing node gets one the first time a behaviour refers to it,
      through a set-once leaf;
    - the server refuses a duplicate, and Duplicate always assigns a new id.
  - (b) Assign ids to every node in every world when it loads.

  (b) writes to every world, even those that never use behaviours.

### 4a (L1–L9)
- **L1 — Where the state lives.**
  - **(a) Recommended: a sibling leaf, `extras.atrium.animation`,** on the
    model node, written as a whole object. It becomes the second writable
    node extras leaf. The server allows it only on a node that has
    `extras.atrium.model`, and checks its value on `send` and `add`.
  - (b) Inside the model value, as `extras.atrium.model.playback` (the
    design's example).

  (b) needs the strict model key set widened, and it changes the value the
  model bridge keys loads on (P4). A play would then look like a new model.
- **L2 — The value.** Recommended:
  - `clip`: the clip's name, 1–256 characters;
  - `playing`: true or false;
  - `loop`: true or false;
  - `speed`: a number from 0.1 to 10;
  - `startedAt`: integer milliseconds on the **server's** clock, at clip
    time 0.

  The exact key set is checked on the server. A missing leaf, or `playing:
  false`, means stopped, shown at rest pose.

  Not taken: copying `SOMAnimation`'s eight keys, which bring `paused` and
  `autoStart` (L3, L4) and its clock problem (P2).
- **L3 — No pause in 4a.**
  - **(a) Recommended: Play and Stop only.** Pause is added with 4b if a
    template needs it, as `pausedAt` (seconds) in the same value.
  - (b) Pause now.

  Stop then Play covers the owner's use. Pause adds a third state to every
  rule and test.
- **L4 — "Playing when the world loads" is the saved state itself.**
  - **(a) Recommended: no separate `autoStart`.** A looping animation saved
    as playing is playing for everyone who arrives, in step: a windmill
    turns. It has no "start when the first visitor arrives" mode.
  - (b) An `autoStart` flag that restarts the clip when the world loads with
    no one present, as `SOMAnimation` does.

  (b) needs someone to write the new start time, and a visitor can't.
- **L5 — Time comes from the server's clock.**
  - **(b) Recommended in Rev 1 (review 5): the server stamps `startedAt`**
    when it accepts a Play. A start time the owner's client estimated would
    be saved as it is: a client that is 300 ms off before its first `pong`
    leaves every visitor 300 ms off for as long as the clip plays, and no
    later sample fixes it.
    - Accept-then-apply (Z2a) already waits for the server's answer. The
      echo now carries the stamped value, and the owner applies **that**
      value.
    - `serverNow()` is still needed by every client to show the right frame
      (Z3).
  - (a) **`AtriumClient` estimates the server's clock** from `ping`/`pong`
    and the owner's client writes `startedAt` (Rev 0's recommendation).
    - Five pings at connect, then one every 30 s; the lowest-RTT sample
      wins. `hello.serverTime` is used until the first `pong`.
    - The owner's Play writes `startedAt = round(serverNow())`. Every client
      computes the clip time from `serverNow()`.
    - The server checks only the shape: `startedAt` is an integer from 0 to
      2^53.

  (b) adds one server rule (Z2) and no protocol change: the `set` broadcast
  already carries the value and `serverTime`.
- **L6 — A once-through clip simply ends.**
  - **(a) Recommended:** after `duration / speed`, every client holds the
    last frame. Nobody writes a stop; `playing` stays true and means "has
    been played".
    - The panel shows "Played", with Play (again) and Stop (back to rest)
      both enabled.
    - A visitor who arrives later sees the last frame too.
  - (b) The owner's client writes `playing: false` when the clip ends.

  (b) reproduces P2's flaw 2 for whoever is the writer, and it fails when
  the owner has left.
- **L7 — The Edit panel's controls.**
  - **(a) Recommended, in the model row for a selected loaded model with
    clips:**
    - a **clip select**: the clips by their L8 ids;
    - a **Loop** checkbox;
    - **two buttons, Play and Stop** (second review 6):
      - **Play** is enabled when stopped or ended, and restarts the clip;
      - **Stop** is enabled when playing or ended, and returns the model to
        its rest pose.
  - A model with no clips shows "No animations"; one that's loading shows
    "Animations: loading".
  - **A saved clip the model doesn't have** shows "Clip ‘X’ not found in
    this model" (written with `textContent`, never as markup), and nothing
    plays.
  - **Play, Stop, a clip change while playing, and a Loop change while
    playing** each write the whole value once and wait for the answer: the
    controls are disabled until it comes.
    - **The wait belongs to its request and its node** (review 7): its seq
      and the SOM node it was sent for. If the owner selects another model
      meanwhile, the late answer re-enables nothing on the new selection and
      shows no error against it. The answer still applies to its own node,
      through the SOM.
    - Nothing changes locally until the server accepts (the rename
      pattern, P11). A rejection shows its reason in the edit error line.
    - A Loop change while playing restarts the clip.
  - (b) A separate Animation section in the panel.

  (a) keeps everything about a model in one place.
- **L8 — Clips are identified by a unique id built from their names.**
  - **(a) Recommended (Rev 1; review 3):**
    - **The id comes from the file's own animation list,** in file order,
      before any clip is dropped (P13). **The names are GLTFLoader's**
      (`gltf.animations[i].name`), the names the clip objects carry. GLTFLoader
      already names an unnamed animation `animation_<i>` (P1), so `clipIds`
      treats an empty name the same way only as a defensive fallback.
    - **Candidate:** the name, with its stem cut to 250 characters.
    - **First occurrence wins.** The candidate is kept unless it's already an
      assigned id. Otherwise it gets ` (n)`: the smallest n ≥ 2 such that
      `candidate (n)` is neither an assigned id nor any animation's name in
      the file. So `Walk`, `Walk` and `Walk (2)` become `Walk`, `Walk (3)`
      and `Walk (2)`.
    - **An id is at most 256 + ` (n)` characters,** within Z1's 300.
    - **Each id keeps its file index,** so 4b can map a graph's animation
      index to it.
    - **A dropped animation keeps its id** but isn't offered or playable
      (`clip-missing`).
    - **The select shows the ids.** For Phase 3 the label is the id.
  - **Stated limit:** for a file with repeated names, an edit that adds,
    removes or reorders animations can move which clip an id names. Only a
    unique name in the file is stable across edits.
  - (b) By index.

  A name survives a model update that reorders clips. An index doesn't, and
  it's meaningless in a graph later.
- **L9 — Play, Stop and clip changes don't go on the undo stack.**
  - **(a) Recommended:** they're a playback control, like the sky picker's
    retry, not an edit of the object. Undo of a delete or an add still
    restores the node with its `animation` value (P6).
  - (b) A new undo kind for the leaf.

  Not taken in 4a: it would be the first extras kind in the engine, for a
  control the owner can simply press again.

## 4. The contract (4a, per the recommendations; amended after decisions)

### Z1. One value rule, two implementations
- **`animationValueProblem(value)`** returns a reason code or null:
  - `animation-type`: not a plain object;
  - `keys`: not exactly `clip`, `playing`, `loop`, `speed` and `startedAt`;
  - `clip`: not a string of 1–300 characters;
  - `playing` or `loop`: not a boolean;
  - `speed`: not a finite number from 0.1 to 10;
  - `startedAt`: not an integer from 0 to 2^53 − 1.
- **It's written once in each package:** the server's in `send-policy.js`;
  the client's in `packages/client/src/animation-spec.js` (new,
  renderer-neutral).
- **Both read `tests/fixtures/animation-spec-vectors.json`,** the
  `model-spec-vectors.json` pattern: accepted and refused values with
  their reason codes.

### Z2. Server (`send-policy.js`, `session.js`)
- **`send` on a node with field `extras.atrium.animation`:**
  - allowed only when the node has `extras.atrium.model`; otherwise
    `INVALID_FIELD` with "extras.atrium.animation is only allowed on a model
    node";
  - the value must pass Z1, or `INVALID_VALUE` with the reason's message;
  - the owner gate, live-avatar refusal and everything else as for any
    `send`.
- **`null` means stopped.** It's accepted for the same nodes and stored as
  `null`.
- **The server stamps a Play (L5 (b)).** When it accepts a `send` of the leaf
  whose value has `playing: true`, it replaces `startedAt` with its own
  `Date.now()` before applying and broadcasting. The client sends
  `startedAt: 0`.
  - A `send` with `playing: false`, or `null`, isn't stamped.
  - **`add` isn't stamped:** a Duplicate or an Undo-restored node keeps its
    value, so it stays in step (P6).
  - The stamp happens after the value check, so a refused value is never
    stamped.
- **The SOM (P10), narrowed (review 6):** `SOMDocument` exports
  `CREATABLE_PATHS = ['extras.atrium.animation']`. `setPath` creates a
  missing final key **only** for a path exactly in that list, and only when
  every earlier segment resolves to a plain object.
  - Every other path keeps today's refusal.
  - **For a listed path, "missing" means not an own property**
    (`Object.hasOwn`), so an inherited name such as `toString` never counts
    as present.
  - A missing intermediate object is still refused.
  - The same SOM code runs on the server and in every client, so a broadcast
    `set` of the new leaf applies everywhere.
  - **It's a list on purpose:** 4b's set-once `objectId` leaf (D6) joins it.
- **`add`:** `checkAtriumExtras` also checks `atrium.animation` when it's
  present. It must pass Z1, and the node must carry `atrium.model`.
- **No schema change.** `send`'s `field` and `value` are already generic.
- **The world file keeps the leaf with the node,** like any extras; autosave
  persists it.

### Z2a. Sending the leaf (`AtriumClient`, P11)
- **`client.setModelAnimation(name, value)`** sends `{ type: 'send', seq,
  node: name, field: 'extras.atrium.animation', value }`. It tracks the
  edit as `renameNode` does (`type: 'send'`, `field`, `value`) and returns
  the seq. It throws "World not loaded" as the others do.
- **The own echo is matched by `requestSeq`, never by value** (second review
  1). Today's `_resolveOwnSetEcho` (`AtriumClient` L1027) already looks the
  pending edit up by `msg.requestSeq`. Keep it that way: a stamped
  `startedAt` changes the value, so a value comparison would never match.
- **Nothing changes locally until the answer** (the rename pattern). On the
  own echo, `_resolveOwnSetEcho` applies **the broadcast's `value`** (the
  server-stamped one, L5 (b)), never the value it sent. It does so with
  `setPath` inside `applyLocally`, then emits `som:set` for that field, then
  `edit:accepted`. A rejection or an unknown answer changes nothing.
- **Another session's `set` of the field** is applied by `_onSet` as today,
  which works once Z2's `setPath` change is in.

### Z3. The server's clock in `AtriumClient` (`packages/client`)
- **A monotonic local clock (review 2):** every time the client measures
  is taken from `performance.now()` (injectable as `monoNow`), never
  `Date.now()`. The offset maps that clock to the server's:
  `serverNow() = monoNow() + offset`. A wall-clock change on the device then
  can't move `serverNow()`.
- **Pings carry `clientTime`** as the schema requires (an integer). Its
  value is **a per-connection ping counter** (1, 2, 3 …), not a time, so the
  five pings of a burst never share a key (second review 4). The client
  keeps a map from that counter to the `monoNow()` at send, and measures RTT
  from that.
- **Samples:** after `hello` the estimate starts from `hello.serverTime`.
  Then five `ping`s go at 200 ms intervals, then one every 30 s while
  connected.
  - Each `pong` gives `rtt` and `offset = serverTime − (sentMono + rtt / 2)`.
  - The client keeps a **rolling window of the last 10 samples, none older
    than 5 minutes**, and uses the lowest-RTT sample in the window. A best
    sample therefore ages out and is replaced.
- **A discontinuity** is a new sample whose offset differs from the current
  estimate by more than `max(250 ms, its RTT)`. It could be a sleeping
  device whose monotonic clock paused, or a server restart. On one:
  - the window is cleared, **without keeping that sample**: it may itself be
    wrong, for example a pre-sleep ping answered after a wake;
  - a burst of five pings follows at once, and the estimate rebuilds from
    their answers.
- **Ignored:** a `pong` not in the map (another connection's), or one whose
  ping was sent more than 60 s ago by `monoNow()`.
- **Timers:** every ping timer belongs to its connection record. All are
  cancelled on `disconnected`, on a superseded connection, on a connect
  timeout and on a new `hello`.
- **`serverClockReady`** is true after the first `pong`.
- **Clocks and timers are injectable** (`monoNow`, `setTimeout`,
  `setInterval`), so tests run with fake ones.

### Z4. The clip time (`packages/client/src/animation-spec.js`)
- **`clipTime({ value, duration, nowServer })`** returns `{ time, ended }`
  in seconds:
  - not playing, or no value: `{ time: 0, ended: false }`, the rest pose;
  - `elapsed = max(0, (nowServer − startedAt) / 1000) × speed`;
  - loop: `elapsed mod duration`;
  - once: `min(elapsed, duration)`, with `ended` true from `duration`;
  - a duration of 0: `{ time: 0, ended: true }`.
- A `startedAt` in the future (a clock estimate behind the writer's) counts
  as 0 elapsed, so a clip never shows negative time.
- **`clipIds(names)`** takes the file's animation names in file order
  (`''` for an unnamed one). It returns `[{ id, index }]` by L8's rule: ids
  are unique against every name and id in the file, and each keeps its file
  index.

### Z5. Playing it (`packages/renderer-three`, a new `model-animations.js`)
- **`createModelAnimations({ bridge, now })`** keeps two things. `now` is
  `() => client.serverNow()`.
  - **The wanted value per model node,** from `set(name, value)`.
  - **Per live instance,** an `AnimationMixer` on that instance's `scene`.
    It's keyed by the **instance object**, never by name (review 4).
- **Clip ids:** `buildInstance` also returns the template's animation names
  in file order. Each retained clip keeps its file index, so Z4's
  `clipIds` maps an id to a retained clip, or to `clip-missing` (P13).
- **The action contract (review 1; P12):**
  - every action is `setLoop(LoopOnce, 1)` with `clampWhenFinished = true`;
  - each frame its time is set from Z4: loop wraps there, once clamps at the
    duration;
  - then `mixer.update(0)`;
  - **the mixer's own looping and its `finished` event are never relied
    on;**
  - **Stop:** `action.stop()`. The mixer restores each binding's saved
    original value, which is the loaded rest pose (P12). The first activation
    happens on a fresh instance (`onInstanceCreated`), so what's saved is the
    loaded pose. Don't reset and update first: that shows the clip's frame 0.
  - **A clip that's never activated** (`clip-missing`, `no-clips`) has
    nothing to restore.
  - **An already-ended clip** (a late joiner) is set straight to its
    duration, which holds the last pose.
- **`set` is idempotent (review 7).** Setting a value deep-equal to the
  current one changes nothing: no new action, no mixer change, no restart.
  A changed value with the same clip and `startedAt` only re-reads `loop`
  and `speed` (kept for 4b; in 4a a Loop change is re-stamped, so it
  restarts). Anything else re-targets the action.
- **`update()` runs once per frame.** Only entries that are playing and have
  a live instance cost work. With nothing playing it returns at once.
- **Driving every frame from the clock** means a tab that was in the
  background, a slow frame or a late joiner always shows the right frame,
  and nothing accumulates drift.
- **Three lifecycle events, from the model bridge** (review 4; P5). It gains
  three callbacks, each passing `{ name, node, instance }`:
  1. **`onInstanceCreated`:** a new mixer for that instance, with the node's
     wanted value applied at once.
  2. **`onInstanceRehosted`,** on a view's detach and attach: nothing is
     disposed or restarted. The mixer and its action stay, and the next
     `update()` sets the time as usual.
  3. **`onInstanceDisposing`,** called by `clearVisual` **before**
     `disposeInstance`: the action stops and the mixer's bindings are
     uncached (`uncacheRoot`). Then the bridge disposes the clips and
     skeletons.
  - **An event for an instance that isn't the current one for that name is
    ignored,** so a late event for an old instance can't touch a
    replacement under the same name.
- **A missing clip:** the entry reports `clip-missing`, and nothing plays.
  `status(name)` gives the panel `{ clips: [L8 ids], state:
  'stopped' | 'playing' | 'ended' | 'clip-missing' | 'no-clips' |
  'loading' }`.
- **Only playing entries cost work per frame.** With nothing playing,
  `update()` returns at once.

### Z6. Wiring in `app.js`
- **`world:loaded`, `som:add`, and `som:set` with path
  `extras.atrium.animation` on a model node** call `modelAnimations.set(name, node.extras?.atrium?.animation ?? null)`.
  A rename moves the entry (as the bridge's records move); `som:remove`
  drops it.
- **The frame loop** calls `modelAnimations.update()` before `stage.tick`.
- **`connecting`, `disconnected` and a world reset** clear everything, as
  the model bridge does.

### Z7. The Edit panel (L7)
- **The model row gains the clip select, Loop and Play / Stop** for a
  selected model node, with the status texts from Z5. Visitors never see
  them, since the panel is the owner's.
- **One write at a time:** `client.setModelAnimation(name, value)` (Z2a),
  then the controls are disabled until its `edit:accepted`,
  `edit:rejected` or `edit:unknown`.
  - On a rejection the reason shows in the edit error line. Nothing needs
    restoring, because nothing changed locally.
  - On an unknown answer (reconnect), the next `som-dump` is the truth.
- **Play** writes `{ clip, playing: true, loop, speed: 1, startedAt: 0 }`;
  the server stamps `startedAt` (Z2). **Stop** writes `null`.
- **Changing the clip or Loop while playing** writes a new playing value,
  which the server stamps again, so it restarts. While stopped, the choice
  is only remembered in the panel until Play.
- **Undo** doesn't record these writes (L9). A model deleted and restored
  through Undo comes back with its leaf.

### Z8. What doesn't change
- The model bridge's loading, limits, cache and keys, except the three
  lifecycle callbacks (Z5) and the template's animation names passed through
  `buildInstance`.
- `SOMAnimation`, `AnimationController` and `AnimationBridge` (§9.5).
- The protocol schemas.
- The SOM Inspector and the playground.
- Duplicate's rules: a copy keeps the leaf and plays in step with the
  original (P6).

## 5. Tests

| Item | Tests | Proof of failure |
|---|---|---|
| Z1 | The vectors file read by both the server and the client tests: every accepted and refused case with its reason | (a) accept a `speed` of 0 in one copy only |
| Z2 | Server (port 0): an owner `send` of a valid value on a model node is accepted and broadcast; on a non-model node it's refused `INVALID_FIELD`; a bad value is refused `INVALID_VALUE`; `null` is accepted; a visitor is refused; `add` with a valid and an invalid leaf; it survives a save and reload. **Stamping:** a playing send with `startedAt: 0` is stored and broadcast with the server's time (within the test's window); a `playing: false` send and `null` are not stamped; an `add` keeps its `startedAt` | (b) allow the leaf on any node; (b4) store the client's `startedAt` |
| Z2 (SOM) | som: `setPath` creates `extras.atrium.animation` when missing; still refuses any other missing final key under `extras.` (for example `extras.atrium.other`), a missing intermediate, a malformed spelling (`extras..atrium.animation`, `extras.atrium.animation.`), and an inherited name (`extras.atrium.toString` is never created and never treated as present); an existing key behaves as before | (b2) create missing keys on any `extras.` path |
| Z2a | Client (fake socket): `setModelAnimation` sends the exact message and tracks it; nothing changes before the echo; **the echo applies the broadcast's value, not the sent one** (a stamped `startedAt` arrives); then `som:set` and `edit:accepted`; a rejection changes nothing; another session's `set` of the field applies | (b3) apply the sent value |
| Z3 | Client, fake clocks and socket: the offset from `hello`, then from the lowest-RTT `pong` in the window; **a stale best sample older than 5 minutes is replaced**; a window of 10; **a discontinuity** (a fake monotonic jump, and a server-time jump) clears the window and bursts five pings; **a wall-clock (`Date.now`) change moves nothing**; an unknown or 60 s-old `pong` is ignored; **all five pongs of one burst land, each with its own send time**; a discontinuity's own sample is not kept; **no ping timer survives** a disconnect, a superseded connection, a connect timeout or a new `hello` | (c) keep the lowest-RTT sample forever; (c2) leave a timer running after disconnect |
| Z4 | `clipTime`: stopped, loop wrap, once clamp and `ended`, `speed`, a future `startedAt`, a zero duration. `clipIds`: `['Walk', 'Walk', 'Walk (2)']` gives `Walk`, `Walk (3)`, `Walk (2)`; GLTFLoader's names for an unnamed index 0 and an index 1 named `animation_0` give `animation_0` and `animation_0 (2)`; the `''` fallback; a 300-character name repeated gives ids of at most 300 characters; indices kept | (d) loop without the modulo; (d2) a naive suffix that repeats an id |
| Z5 | renderer-three with real `AnimationClip`s on a real `Object3D` and a fake bridge: **the animated object's own values** past the duration for a once clip (the last pose), for a late-created instance of an ended clip, and after Stop (the rest pose); a looping clip at a time past its duration shows the wrapped pose; **Stop with a clip whose first frame differs from the loaded value (the object at `x = 0`, the clip running 5 → 10) returns `x = 0`**; set before load, then `onInstanceCreated` applies it; `onInstanceRehosted` keeps the same mixer and action; `onInstanceDisposing` uncaches before disposal; **an event for a replaced instance under the same name is ignored**; a dropped earlier animation gives `clip-missing` for its id while later ids still play; **`set` with a deep-equal value creates no action and restarts nothing**; with nothing playing, `update` touches no mixer | (e) accumulate `dt` instead of setting the time from the clock; (e2) the default loop mode without clamping; (e4) Stop by reset and `update(0)`; (e3) key the mixer by name |
| Z6–Z7 | A source-level wiring guard for `app.js` (the frame-loop call and the three `set` call sites); a pure panel-state helper tested for each status text, for which of Play and Stop are enabled in each state (stopped, playing, ended, `clip-missing`, loading), and for the values Play (`startedAt: 0`) and Stop produce; **a late answer for a model that is no longer selected** re-enables nothing and shows no error on the new selection | (f) a late answer applied to the current selection |

**Proofs:** commit first; break the file, run, record the failing test
names, restore the file **from a saved copy, never with `git checkout`**,
re-run green. "Not reproducible" is not an acceptable result.

### 5.1 Claude's browser checks (after publish, before DEV acceptance)
In the local harness (library-sky passdown §5.3), with `Fox.glb` and
`CesiumMan.glb` from Khronos's glTF-Sample-Assets, fetched by a sparse
`git clone` and served locally (§6 has their clips and sizes):
1. **Owner plays:** select the model, pick a clip, Loop, Play. It animates,
   and a second session sees the same frame within 100 ms of clip time.
2. **Different clocks:** the second session's `Date.now` shifted by +5 s,
   and `Date.now` jumped by +60 s mid-play (init scripts): it's still in
   step, because it uses `serverNow()` on a monotonic clock.
2b. **Play before the first `pong`:** the owner's socket delayed by 300 ms
   each way (a WebSocket route), Play pressed at once: every session shows
   the same phase, because the server stamped the start.
3. **Late joiner:** a third session connects 7 s later and shows the right
   frame at once.
4. **Once:** Play without Loop: every session ends on the last frame, and no
   session sends anything when it ends.
5. **Stop:** all sessions return to the rest pose, from playing and from ended.
6. **Saved:** reload the server from its saved file; the loop is still
   running, at the right phase.
7. **Refused:** a stubbed rejection: the reason shows, and nothing played.
   A late answer after selecting another model changes nothing on it.
8. **No clips, a missing clip, loading:** each status text.
9. **Duplicate:** the copy plays in step; Undo of a delete brings it back
   playing.
10. **Regression:** library-sky checks 1–14 and edit-polish-3's.

## 6. DEV acceptance (operator, Firefox, hard reload, owner)
1. **Add two animated models by URL** from Khronos's glTF-Sample-Assets.
   Its host sends CORS `*`. *Probe:* clip names and sizes read with
   glTF-Transform.
   - `https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CesiumMan/glTF-Binary/CesiumMan.glb`
     (CC-BY 4.0): about 1.5 m tall. It has one **unnamed** clip, shown as
     `animation_0` (L7).
   - `https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Fox/glTF-Binary/Fox.glb`
     (CC0 and CC-BY 4.0): clips **Survey, Walk and Run**. It's about 155
     units long, so **set its scale to 0.01** in the panel.
2. **On the fox, pick "Run", Loop, Play:** the fox runs. Play CesiumMan's
   `animation_0` too.
3. **A second browser or device as a visitor:** the same pose at the same
   time.
4. **Reload both:** still running, in step.
5. **Stop:** both return to rest. **"Survey" without Loop:** both end on the
   last frame.
6. **Delete it and Undo:** it comes back with its animation.
7. **Play and Stop:** Play is offered when stopped or ended, and Stop when
   playing or ended.

## 7. Worker rules and release path
As library-sky (`devtasks/KICKOFF-library-sky.md`), with this round's
specifics:
- **Steps, one commit each:**
  1. Z1, the vectors file, the SOM change and the server's half (Z2);
  2. Z2a and Z3: the client's send and the clock;
  3. Z4, the client's value rule and clip time;
  4. Z5, `model-animations.js` and the bridge notification;
  5. Z6–Z7, `app.js`, `index.html` and the panel helper;
  6. full suites, proofs (a)–(f) with (b2)–(b4), (c2), (d2), (e2) and (e3), and the handoff.
- **`--max-runtime 3h`.**
- **The server changes,** so the DEV deploy restarts DEV, as in earlier
  server rounds.
- **The kickoff and the front door:** the library-sky passdown §4.2–§4.3
  rules. The front door verifies the hash and posts it; the kickoff only
  copies it.

## 8. Notes for the brief author
- **Read P2 before writing Z5:** reuse three's `AnimationMixer`, not
  `AnimationBridge`. The bridge belongs to the world file's animations and
  its stop-on-finish is the flaw L6 avoids.
- **The mixer's root is the instance's `scene`:** the clips are already
  retargeted to it by uuid (A7). Don't rebuild clips from names.
- **`clipTime` is pure and in `packages/client`;** renderer-three only sets
  the action's time from it.
- **Z2's node check reads the SOM node's current extras,** so a node that
  loses its model can't keep receiving the leaf.

## 9. The later rounds (sketches for their own pre-briefs)

### 9.1 4b — behaviours, owner-present
- **`objectId` (D6);** the script host (`hello.scriptHost`, `hostGen`,
  `script-host`; design §5.2 with its tests: two tabs, handover on close,
  the host reconnecting, an answer during handover).
- **The script API surface** of design §5.3, as far as the templates need
  it: get and set on own subtree and granted `targets`, play and stop
  (writing 4a's leaf), `on('select' | 'enter' | 'exit' | 'frame')`,
  `after`/`every`, and `log`. Writes coalesced to 20 per second per world.
- **The interpreter (D2)** for the templates' subset, and **templates
  (D3):** on select show or hide a target; on select play or stop an
  animation; on enter play, on exit stop; on select toggle a light; every N
  seconds play.
- **Resource limits** (steps per event, pending delays, writes per second,
  variable memory) and the `targets` grant UI.
- **D5's drag rule.**
- **What a graph's animation index means.** In a standard graph,
  `animation/start` names an animation by its index in the glTF file. In
  Atrium a behaviour's animations are a placed model's clips. Every L8 id
  keeps its file index, so the adapter maps the graph's index to the file
  index, then to the id, and writes 4a's leaf. A dropped animation is
  `clip-missing`. The world file's own animations (§9.5) are a separate
  question.

### 9.2 4c — visitors' `activate`
- The message and schema, the server's checks (node, enabled behaviour that
  listens for `select`, distance `maxDistance` default 10 m, 5 per second
  per session and 20 per second per world, a host present), forwarding to
  the current `hostGen` only, and the visitor's click path. The trust policy
  is confirmed here (design §11.2 C).

### 9.3 4d — graphs beyond the templates
- The graph import converter (design §5.4), the unsupported-node report, a
  wider subset, and the Khronos `glTF-Test-Assets-Interactivity` files.

### 9.4 Not in step 4
The graphical editor (step 5), owner-only JavaScript (step 6), behaviours
while the owner is away (design §7 item 2), and sharing (step 7).

### 9.5 Recorded: the world file's own animations
P2's two flaws (each viewer's clock, every viewer stopping a finished clip)
remain in `SOMAnimation` and `AnimationBridge`. After 4a, the fix is to use
`serverNow()` and stop no clip on finish. It touches the SOM's playback
shape and the SOM Inspector's Animations panel, so it's a round of its own,
or part of 4b if templates are to drive world-file animations too.

## 10. Review log
- **Rev 0** (2026-10-22 evening, `7117455`): drafted from the design, code
  reading and probes at `1206a52`, with D1–D6 and L1–L9 open. P8 summarises
  a separate evaluation of the Khronos engine. Claude checked its package
  metadata and loaded it in Node; the rest of P8 is that evaluation's
  reading of the code.
- **Rev 1** (2026-10-23): an outside review of Rev 0 (read-only, against
  `7117455`; "changes recommended, no conceptual redesign"). Claude checked
  each finding against the code; finding 1 was also probed with three.js
  (P12). All are taken.

| # | Finding | Severity | Where it went |
|---|---|---|---|
| 1 | A once-through clip's end isn't specified for three.js (`LoopRepeat` and no clamping by default) | Must-fix | P12 (*probe*: holds under `update(0)`, but only by an internal path), Z5's action contract, tests on the object's own values, (e2) |
| 2 | The best clock sample never expires; no recovery from a jump; timers not tied to connections | Must-fix | Z3 rewritten: monotonic clock, rolling window, discontinuity reset, timers per connection; tests and (c2) |
| 3 | Repeated clip names can give two equal ids; dropped clips shift indices | Must-fix | P13, L8 rewritten, Z4 `clipIds`, Z5 index map, tests and (d2) |
| 4 | Instance and view lifecycles were conflated; name-keyed events can hit a replacement | Must-fix | P5 corrected, Z5's three callbacks keyed by instance, tests and (e3) |
| 5 | A client-estimated `startedAt` is saved wrong for good if the clock was off | Must-fix | **L5 now (b): the server stamps**; Z2, Z2a (echo applies the broadcast value), Z7, browser check 2b, (b4) |
| 6 | `setPath` widened more than needed | Should-fix | Z2: exactly `extras.atrium.animation`, own-property checks, malformed and inherited cases tested |
| 7 | Idempotent `set`; late answers against another selection | Should-fix | Z5 and L7/Z7, tests and (f) |
| 8 | The engine's resource limits are unproven | 4b condition | D2 (a) provisional; 4b opens with a spike and its four pass criteria |
| 9 | D5's conflict rule isn't ready | 4b condition | D5 (a) fixes the direction only; 4b decides the rule with D4 |

The reviewer recommends (a) for D1–D6 (D2 provisional, D5 as direction) and
for L1–L4, L6, L7 and L9, (b) for L5, and the revised L8, the same as this
revision.
- **Rev 1.1** (2026-10-23): a second outside review, of Rev 1 (`f997eba`),
  read the document only. Its verdict was "sound, ready for FINAL after one
  more pass". Claude checked the code claims: own-echo matching (by
  `requestSeq`) and Stop (*probe*: `stop()` restores the loaded pose, and
  reset with `update(0)` shows frame 0).

| # | Finding | Severity | Where it went |
|---|---|---|---|
| 1 | Matching the own echo by value would fail once the server stamps | Must-fix | Z2a states the rule; the code already matches by `requestSeq` |
| 2 | Stop as reset with `update(0)` shows frame 0, not the rest pose | Must-fix | P12 (*probe*), Z5's Stop rule, a distinguishing test and (e4) |
| 3 | L8's text contradicted its example; repeated long names overflow Z1 | Must-fix | L8 restated (first occurrence wins; the stem cut to 250), Z1's `clip` up to 300 |
| 4 | A burst's pings share one `clientTime` key | Should-fix | Z3: a per-connection counter; the 60 s rule on `monoNow` |
| 5 | Which names feed `clipIds` changes the ids | Should-fix | L8: GLTFLoader's names; `''` is a defensive fallback; the test's expected output stated |
| 6 | One Play/Stop button can't serve the ended state | Should-fix | L6, L7: two buttons; panel-state tests per state |
| 7 | §9.1 still mapped by display order | Should-fix | §9.1: file index to id |
| Nits | The Loop parenthetical; the base after edit-polish-3; the same server clock; P-section order; Z6's `extras`; `CREATABLE_PATHS` as a list; `textContent`; a discontinuity's own sample | — | All taken |
