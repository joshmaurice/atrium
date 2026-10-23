# Pre-brief: Phase 3 step 4 — scripting: the plan (4a–4d), and 4a (model animations) in detail

Status: **DRAFT, Revision 0 (2026-10-22). Decisions D1–D6 (the whole step)
and L1–L9 (4a) open (§3).**
- **Drafted by Claude from `main` at `1206a52`.** Its code is identical to
  the released `a31c5a62` (DEV, MAIN and PROD). Claims marked *probe* were
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
- **Records change on:** attach, fail, remove, a spec change, a world reset,
  and a view change (`detachView` / `attachView` keep the cache, A9). An
  animation state has to survive a view change and re-apply after any new
  instance.

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

### P9. Test baseline at `1206a52`
- **Suites:** server 530 (34 files), `packages/client` 391, renderer-three
  265, `apps/client` 766, som 234, protocol 71 and interaction 9. All pass.
  Node v22.22.0.
- **Ports:** new server tests use port 0 (AGENTS.md).

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
  - **(a) Recommended: `AtriumClient` estimates the server's clock** from
    `ping`/`pong` and exposes `serverNow()`.
    - Five pings at connect, then one every 30 s; the lowest-RTT sample
      wins. `hello.serverTime` is used until the first `pong`.
    - The owner's Play writes `startedAt = round(serverNow())`. Every client
      computes the clip time from `serverNow()`.
    - The server checks only the shape: `startedAt` is an integer from 0 to
      2^53.
  - (b) The server stamps `startedAt` itself when it accepts the value.

  With (b), the writer still needs `serverNow()` to show the right frame
  straight away, and the server would be rewriting an owner's value: a new
  rule in `send`. (a) uses the existing ping and needs no protocol change.
- **L6 — A once-through clip simply ends.**
  - **(a) Recommended:** after `duration / speed`, every client holds the
    last frame. Nobody writes a stop; `playing` stays true and means "has
    been played".
    - The panel shows "Played" and offers Play again.
    - A visitor who arrives later sees the last frame too.
  - (b) The owner's client writes `playing: false` when the clip ends.

  (b) reproduces P2's flaw 2 for whoever is the writer, and it fails when
  the owner has left.
- **L7 — The Edit panel's controls.**
  - **(a) Recommended, in the model row for a selected loaded model with
    clips:**
    - a **clip select**: the clips by name, with `animation_<n>` for an
      unnamed one and ` (2)` added to a repeated name;
    - a **Loop** checkbox;
    - one **Play / Stop** button.
  - A model with no clips shows "No animations"; one that's loading shows
    "Animations: loading".
  - **A saved clip the model doesn't have** shows "Clip ‘X’ not found in
    this model", and nothing plays.
  - **Play, Stop, a clip change while playing, and a Loop change while
    playing** each write the whole value once and wait for the answer: the
    controls are disabled until it comes.
    - Nothing changes locally until the server accepts (the rename
      pattern, P11). A rejection shows its reason in the edit error line.
    - A Loop change while playing restarts the clip.
  - (b) A separate Animation section in the panel.

  (a) keeps everything about a model in one place.
- **L8 — Clips are picked by name, with a unique-name rule.**
  - **(a) Recommended:** the stored `clip` is the name the select shows.
    Duplicates are made unique as in L7, in file order, so the same file
    always gives the same names.
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
  - `clip`: not a string of 1–256 characters;
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
- **The SOM (P10):** `SOMDocument.setPath` creates a missing **final** key
  when every earlier segment resolves and the path starts with `extras.`.
  Every other path keeps today's refusal.
  - Which `extras` leaves reach `setPath` at all is still decided by the send
    policy, so this widens nothing on its own.
  - A missing intermediate object is still refused.
  - The same SOM code runs on the server and in every client, so a
    broadcast `set` of the new leaf applies everywhere.
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
- **Nothing changes locally until the answer** (the rename pattern). On the
  own echo, `_resolveOwnSetEcho` applies the value with `setPath` inside
  `applyLocally`, then emits `som:set` for that field, then
  `edit:accepted`. A rejection or an unknown answer changes nothing.
- **Another session's `set` of the field** is applied by `_onSet` as today,
  which works once Z2's `setPath` change is in.

### Z3. The server's clock in `AtriumClient` (`packages/client`)
- **After `hello`:** the estimate starts from `hello.serverTime` (offset =
  `serverTime − Date.now()`), then five `ping`s at 200 ms intervals, then
  one every 30 s while connected.
- **On each `pong`,** `rtt = now − clientTime`. The sample with the lowest
  RTT so far sets `offset = serverTime − (clientTime + rtt / 2)`. A `pong`
  older than 60 s, or one from a previous connection, is ignored.
- **`serverNow()`** returns `Date.now() + offset`. `serverClockReady` is
  true after the first `pong`.
- **Everything resets on `disconnected` and on a new `hello`.**
- **Timers and the clock are injectable** (`now`, `setInterval`), so tests
  run with a fake clock.

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
- **`clipNames(clips)`** gives the display names with L7's uniqueness rule.

### Z5. Playing it (`packages/renderer-three`, a new `model-animations.js`)
- **`createModelAnimations({ bridge, now })`** keeps, per model node name,
  the wanted value and, once an instance is loaded, an `AnimationMixer` on
  that instance's `scene`. `now` is `() => client.serverNow()`.
  - **`set(name, value)`:** the wanted value (or `null`).
  - **`update()`, once per frame:** for each playing entry with a loaded
    instance, it finds the clip by display name and sets the action's time
    from `clipTime`. Looping isn't left to the mixer's own wrap: the time
    comes from Z4 every frame, then `mixer.update(0)`.
  - **Stopping** stops the action and resets the pose.
- **Driving every frame from the clock** means a tab that was in the
  background, a slow frame or a late joiner always shows the right frame,
  and nothing accumulates drift.
- **Instance changes:**
  - a new instance (attach, a reload after a failure, a view change) gets a
    new mixer, and the wanted value is applied at once;
  - remove, a world reset and `disposeInstance` stop the action,
    `uncacheRoot` the mixer, and drop it.
  - The model bridge reports instance attach and dispose through a
    callback or event, which is added to it for this.
- **A missing clip:** the entry reports `clip-missing`, and nothing plays.
  `status(name)` gives the panel `{ clips: [display names], state:
  'stopped' | 'playing' | 'ended' | 'clip-missing' | 'no-clips' |
  'loading' }`.
- **Only playing entries cost work per frame.** With nothing playing,
  `update()` returns at once.

### Z6. Wiring in `app.js`
- **`world:loaded`, `som:add`, and `som:set` with path
  `extras.atrium.animation` (or `extras`) on a model node** call `modelAnimations.set(name, node.extras?.atrium?.animation ?? null)`.
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
- **Play** writes `{ clip, playing: true, loop, speed: 1, startedAt:
  round(serverNow()) }`. **Stop** writes `null`.
- **Changing the clip or Loop while playing** writes a new value with a new
  `startedAt`. While stopped, the choice is only remembered in the panel
  until Play.
- **Undo** doesn't record these writes (L9). A model deleted and restored
  through Undo comes back with its leaf.

### Z8. What doesn't change
- The model bridge's loading, limits, cache and keys (except the new
  attach and dispose notification).
- `SOMAnimation`, `AnimationController` and `AnimationBridge` (§9.5).
- The protocol schemas.
- The SOM Inspector and the playground.
- Duplicate's rules: a copy keeps the leaf and plays in step with the
  original (P6).

## 5. Tests

| Item | Tests | Proof of failure |
|---|---|---|
| Z1 | The vectors file read by both the server and the client tests: every accepted and refused case with its reason | (a) accept a `speed` of 0 in one copy only |
| Z2 | Server (port 0): an owner `send` of a valid value on a model node is accepted and broadcast; on a non-model node it's refused `INVALID_FIELD`; a bad value is refused `INVALID_VALUE`; `null` removes it; a visitor is refused; `add` with a valid and an invalid leaf; it survives a save and reload | (b) allow the leaf on any node |
| Z2 (SOM) | som: `setPath` creates a missing final key under `extras.`; still refuses a missing key elsewhere and a missing intermediate; an existing key behaves as before | (b2) create missing keys on any path |
| Z2a | Client (fake socket): `setModelAnimation` sends the exact message and tracks it; nothing changes before the echo; the echo applies the value and emits `som:set` then `edit:accepted`; a rejection changes nothing; another session's `set` of the field applies | (b3) apply the value before the answer |
| Z3 | Client: with a fake clock and a fake socket, the offset from `hello`, then the lowest-RTT `pong` wins over a later, slower one; a stale `pong` is ignored; reset on disconnect; the ping schedule (five, then every 30 s) | (c) take the latest sample instead of the lowest RTT |
| Z4 | `clipTime`: stopped, loop wrap, once clamp and `ended`, `speed`, a future `startedAt`, a zero duration; `clipNames` with unnamed and repeated names | (d) loop without the modulo |
| Z5 | renderer-three with real `AnimationClip`s and a fake bridge: set before load, then attach applies it; time follows `now`; stop resets; dispose uncaches; a missing clip reports `clip-missing`; with nothing playing, `update` touches no mixer | (e) accumulate `dt` instead of setting the time from the clock |
| Z6–Z7 | A source-level wiring guard for `app.js` (the frame-loop call and the three `set` call sites), and a pure panel-state helper tested for each status text and for the write values Play and Stop produce | (f) Play writing the client's `Date.now()` instead of `serverNow()` |

**Proofs:** commit first; break the file, run, record the failing test
names, restore the file **from a saved copy, never with `git checkout`**,
re-run green. "Not reproducible" is not an acceptable result.

### 5.1 Claude's browser checks (after publish, before DEV acceptance)
In the local harness (library-sky passdown §5.3), with `Fox.glb` and
`CesiumMan.glb` from Khronos's glTF-Sample-Assets, fetched by a sparse
`git clone` and served locally (§6 has their clips and sizes):
1. **Owner plays:** select the model, pick a clip, Loop, Play. It animates,
   and a second session sees the same frame within 100 ms of clip time.
2. **Different clocks:** the second session's `Date.now` shifted by +5 s
   (an init script): it's still in step, because it uses `serverNow()`.
3. **Late joiner:** a third session connects 7 s later and shows the right
   frame at once.
4. **Once:** Play without Loop: every session ends on the last frame, and no
   session sends anything when it ends.
5. **Stop:** all sessions return to the rest pose.
6. **Saved:** reload the server from its saved file; the loop is still
   running, at the right phase.
7. **Refused:** a stubbed rejection: the controls restore and the reason
   shows.
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

## 7. Worker rules and release path
As library-sky (`devtasks/KICKOFF-library-sky.md`), with this round's
specifics:
- **Steps, one commit each:**
  1. Z1, the vectors file, the SOM change and the server's half (Z2);
  2. Z2a and Z3: the client's send and the clock;
  3. Z4, the client's value rule and clip time;
  4. Z5, `model-animations.js` and the bridge notification;
  5. Z6–Z7, `app.js`, `index.html` and the panel helper;
  6. full suites, proofs (a)–(f) with (b2) and (b3), and the handoff.
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
  Atrium a behaviour's animations are a placed model's clips, so the adapter
  maps the index to the object's clip list (4a's display-name order) and
  writes 4a's leaf. The world file's own animations (§9.5) are a separate
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
- **Rev 0** (2026-10-22 evening): drafted from the design, code reading and
  probes at `1206a52`, with D1–D6 and L1–L9 open. P8 summarises a separate
  evaluation of the Khronos engine. Claude checked its package metadata and
  loaded it in Node; the rest of P8 is that evaluation's reading of the code.
