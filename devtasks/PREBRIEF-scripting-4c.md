# Pre-brief: Phase 3 step 4c — visitors' `activate`: a click in any tab reaches the script host

Status: **DRAFT, Revision 0 (2026-10-30). Decisions AC-L1–AC-L8 are open
(§3), each with a recommendation.** Nothing here is approved yet.
- **Drafted by Claude from `main` at `71b6e40b`.** Its code is identical to
  the released `ab02239b` (DEV, MAIN and PROD): the two commits on top
  (`43e518e`, `71b6e40`) touch only `devtasks/`. Line numbers are at that
  commit.
- **Order (signin-sync passdown, first instruction 3):** the small host
  round (that passdown §6.2) goes first, all of it. This pre-brief can be
  reviewed while it runs. **4c's kickoff waits for the host round.**
- **Sources:**
  - `devtasks/PREBRIEF-scripting-4b-2.md` FINAL Rev 2.1: §9 (this round's
    sketch), F-L9 (the host's own clicks; "clicks in a visitor's tab or a
    non-host owner tab do nothing until 4c's `activate`"), F5 (the runner,
    `select` from the viewport, M3), F7 (limits);
  - `devtasks/PREBRIEF-scripting-4a.md` §9.2 (4c, "the trust policy is
    confirmed here");
  - the design, `docs/DESIGN-phase3-placement-scripting.md` Rev 1.2: §5.2
    (`activate`, the trust policy, the script host), §5.3 (`select`), §11.2
    C (the trust policy, "confirm in the step 4 pre-brief");
  - `devtasks/Atrium-Passdown-2026-10-29-scripting-4b-2.md` §4 (lessons),
    §6.1;
  - `devtasks/Atrium-Passdown-2026-10-30-signin-sync.md` §4.1 (the seam
    rule), §4.3 (the kanban tools), §6.1 ("4c's checks can trust
    `session.userId`").
- **Scope:** the `activate` message in both directions, the server's checks
  and forwarding, the visitor's and the non-host owner tab's click path, and
  the host's handling of a forwarded `select`.
- **Out of scope:** graphs beyond the five templates, `flow/setDelay`,
  `event/onTick`, the converter (4d); `hover` and visitor-side `change`
  (design §5.2: "only `select` is forwarded in Phase 3"); behaviours while
  the owner is away (design §7 item 2); a per-behaviour distance (AC-L2,
  unless the operator picks (b)); server-enforced revocation (design §5.2,
  "needed before any non-disconnect role move ships", and none ships here);
  a hover cursor over activatable objects (§9).

## 1. What 4c delivers

| Who | What they get |
|---|---|
| **A visitor** (signed in or anonymous, same-origin or not) | A click on an object with an enabled "On select" behaviour, within 10 m, runs the behaviour in the owner's script-host tab, and the visitor sees the effect as an ordinary `set`. Too far: "Move closer to use this." No owner present: "Nothing happens: this world's owner isn't here." |
| **The owner, in a non-host tab** | The same route as a visitor. The Behaviour section's status line now says "Behaviours run in another tab; clicks here are sent to it." |
| **The owner, in the host tab** | No change except AC-L3: the same 10 m rule applies here, so every tab behaves the same |
| **The server** | One new client message, `activate`, with a fixed order of checks (§4 AC3), two rate limits (5 per second per session, 20 per second per world), and forwarding to the current host only, with its `hostGen`. One new error code, `NO_SCRIPT_HOST` (AC-L5) |
| **The repo** | `activate.client.json` and `activate.server.json`; one shared "which node does a click select" rule, used by every tab; `worldPosition` moved into `@atrium/som`, so the server and the page measure distance with the same code |

**It is one round with six steps** (AC-L1). It doesn't run any new kind of
world-supplied code, but **it opens a new input path for anonymous
visitors** into the server and into the owner's browser. So it keeps both
outside reviews: this pre-brief, and the whole round from base to tip.

## 2. Verified facts (at `71b6e40b`)

Claude read the code, ran two probes (§2.4: `p1` against the installed
workspace, `p2` against a real world server), and ran the suites nearest
this round at the base: protocol 100 pass; `@atrium/behaviors` 131 pass,
1 skip (the named `KHRONOS_ASSETS` skip); server `script-host` 11,
`behavior-leaf` 21, `behavior-walk` 9, all pass. No browser was started
for this draft.

### 2.1 The protocol
- **P1. `activate` doesn't exist.** `validate('client', { type: 'activate',
  seq: 1, node: 'Switch', event: 'select' })` returns `Unknown message type:
  activate` (probe), so today's server answers `UNKNOWN_MESSAGE`
  (`session.js` L616–621). `messageTypes` (`protocol/src/index.js` L73) has
  no entry for it.
- **P2. The validator's direction list is hard-coded:** `hello`, `view`,
  `add` and `remove` (`index.js` L59–61). A message with a client form and a
  server form needs its name added there, or `validate` looks up the plain
  key and fails.
- **P3. `RATE_LIMITED` is in the error enum** (`error.json`) **and nothing
  on the WebSocket path sends it** (no match in `packages/*/src` or
  `apps/*/src` outside tests). 4c's limiter is the first one on this path.
  `error` has `additionalProperties: false`: an error can carry a `code`, a
  `message` and a `seq`, nothing else.
- **P4. The client ignores message types it doesn't know.** `AtriumClient`'s
  `dispatch` (L752–784) is a `switch` with no `default`, and the client
  never validates inbound messages. A 4b-2 tab that receives a forwarded
  `activate` drops it without a word (§8).

### 2.2 The server
- **P5. The script host** is per world host (`attachSessionHandlers`,
  `scriptHost = { sessionId, hostGen }`, L324). It's granted at `hello`
  (L718–725, needs `canEdit` and `capabilities.scriptRunner === 1`) or by
  `handOverScriptHost` (L481–490) from `cleanupSession` (L544–546), which
  runs synchronously after the departed session is removed. The server never
  sends `script-host` `active: false` today.
- **P6. A session's position** is its own avatar node's translation, set
  by `view` (L1155–1164) and only on the node that session's accepted
  avatar `add` created (`session.avatarNode`, L1125). A session whose
  avatar `add` was refused has `avatarNode: null`. Avatar nodes are always
  at the root (A4, L996–999), so their translation is their world position.
- **P7. `world.getNodeTranslation(name)` is the LOCAL translation**
  (`world.js` L594–598 and L706–710: `[...node.translation]`). The design
  (§5.2) names it for the distance check. It would be wrong for any object
  inside a group (§2.4).
- **P8. The `view` position is the client's claim.** Nothing checks it
  against the previous position. **A client that sends a `view` next to an
  object, then `activate`, passes the distance check**, and its avatar
  visibly jumps there for everyone. The design already says `select` "isn't
  proof of a real click". The distance check stops casual far-away
  triggering and ordinary clients. It isn't a security boundary (AC-L2).
- **P9. The message handler fails closed** (G2, L1243–1261), and the depth
  guard (G1, L604–614) runs before the schema on every message. A throw in
  the new `activate` case is answered and logged, and the world carries on.
- **P10. The behaviour leaf, as stored, says whether it listens for
  `select`.** F1 (both copies: `behavior-spec.js` L256–446,
  `send-policy.js` L489 on) allows at most one `event/onSelect`
  declaration, with exactly `extension: 'KHR_node_selectability'` (L78,
  L304–313), and pins every `event/onSelect` node to `nodeIndex: 0`,
  `stopPropagation: false` (L316–324). Healing drops a malformed leaf to
  `null` at load. So a server-side "listens for select" is a pure read of
  the stored value: `enabled === true` and a graph node whose declaration's
  op is `event/onSelect`.
- **P11. Behaviour nodes always have their own `objectId`** (F2), and node
  names are unique and at most 256 characters (`SOMDocument.checkNewName`,
  L316–320).

### 2.3 The client
- **P12. Today's click path** (`app.js` L2077–2099): outside Edit mode, a
  click on the canvas that passes `isSelectClick` (4 px slop, a press that
  didn't start on a handle; `edit-selection.js` L22–26) calls
  `runner?.select(pickBehaviorTarget(e))` (L2087). `pickBehaviorTarget`
  (L2101–2116) raycasts the visible hits and resolves the hit object to a
  SOM node (`nodeForHitObject`). Every tab has a runner (L3126). In every tab
  but the host, `runner.select` returns at once (`enabled()` is false,
  `runner.js` L99, L505–506). That's 4b-2's "clicks here do nothing".
- **P13. The host's walk** (`runner.js` L505–511) goes up the SOM ancestors
  to the first node with a **live engine** and calls its `select(0)`. A node
  whose behaviour the runner disabled (`enabled: false`, `invalid`,
  `target-not-found`, …) has a record with `engine: null`, **so the walk
  carries on past it to an ancestor.** A visitor's tab has no engines and
  can't know the runner's reasons. A rule taken from the stored leaf (P10)
  is the only one every tab can apply the same way (§4 AC2).
- **P14. The non-host status text** is `otherTab` in `behavior-form.js`
  L108: "Behaviours run in another tab; clicks here don't trigger them".
- **P15. An `error` during a pending connect fails that connect.**
  `connectNow`'s `onErr` (`app.js` L1204–1208) settles the connect as
  failed on any `error` with the connecting session's id. After
  `session:ready`, errors only reach the console (L938–955). So `activate`
  must never be sent before the current connection is ready (§4 AC4).
- **P16. The runner already has the local avatar's world position**
  (`position` → `worldPosition`, `app.js` L3131; the proximity pass,
  `runner.js` L455–470).
- **P17. Pointer lock.** With `modes.usePointerLock`, a click on the
  viewport requests the lock (`app.js` L2951–2953). While locked, a mouse
  event's `clientX/Y` stay where the lock started. `pickBehaviorTarget`
  aims from there, not from the screen centre. That's existing 4b-2
  behaviour in the host tab (§5, open question Q2).
- **P18. An ORBIT tab has an avatar, and it sits at the camera.**
  `NavigationController.tick` (L91–121) returns early only when there is
  no `localNode`. In ORBIT it sets the avatar node's translation to the
  orbiting camera's position and sends that as `view`. The orbit radius
  is 0.5–100 m (`onWheel`, L71–75). So in ORBIT, the distance AC-L2
  measures is from the camera, not from the orbit target: an owner or
  visitor zoomed out past 10 m can't trigger anything until they zoom in.

### 2.4 Probes `p1` and `p2` (2026-10-30)
**`p2`, a real server:** `node src/index.js` with
`WORLD_PATH=../../tests/fixtures/space.gltf` and a scratch database, one
anonymous `hello`, then `{ type: 'activate', seq: 7, node: 'Switch',
event: 'select' }`. The answer: `{ type: 'error', code: 'UNKNOWN_MESSAGE',
message: 'Unknown message type: activate', seq: 7 }`. The server carried
on.

**`p1`, the workspace:**
Run from the workspace (`@atrium/protocol`, `@atrium/som`,
`@gltf-transform/core` 4.3.0). `Switch` is at local `[3, 1, 0]` under
`Group`, which is at `[10, 0, 0]`, rotated 90° about Y and scaled 2:

| Check | Result |
|---|---|
| `validate('client', activate)` | `{ valid: false, errors: [{ message: 'Unknown message type: activate' }] }` |
| `messageTypes.includes('activate')` | `false` |
| an `error` with `RATE_LIMITED` | valid |
| `SOMNode.translation` (what `getNodeTranslation` returns) | `[3, 1, 0]` |
| `worldPosition` (`apps/client/src/world-position.js`) | `[10, 2, -6]` |
| glTF-Transform `Node.getWorldTranslation()` | `[10, 2, -6]` |

The client's `worldPosition` and glTF-Transform agree. The local
translation is about 9.3 m from the real position. (Both probes were
scratch scripts, not committed.)

## 3. Decisions (for the operator)

- **AC-L1 — The round's shape.**
  - **(a) Recommended:** one round, six steps, each a commit (§7):
    protocol, the shared rule, server, client and runner, app, then full
    suites and proofs.
  - (b) Two rounds: protocol and server first (testable with a fake host),
    then the client.

  (a): the server half can't be accepted on DEV without a page that sends
  `activate`, so (b) would ship an unused message to PROD or hold it on DEV.
  The round is small next to 4b-2.

- **AC-L2 — Distance: how far a click may reach.**
  - **(a) Recommended:** one fixed limit, **10 m**, a server constant
    (`ACTIVATE_MAX_DISTANCE`, with a copy in `@atrium/behaviors` for the
    page; the E1 pattern, pinned by vectors). Measured between the sender's
    avatar position (P6) and the **world position of the behaviour node's
    origin** (P7: through `worldPosition`, not `getNodeTranslation`).
    Inclusive: exactly 10 m passes. No avatar node: refused. A
    per-behaviour distance is recorded for 4d.
  - (b) The design's per-behaviour `maxDistance` (default 10 m, "any
    distance" allowed): a new optional leaf key, both F1 copies, the
    vectors, the template-regeneration rule (Rev 2 S5), and a form field.
  - (c) No distance check.

  (b) reopens the leaf's key set and the form, which took 4b-2 rounds 5–7
  to settle, for a need nobody has asked for yet. (c) lets any visitor
  anywhere in the world, including one who never moves, press every switch.
  Neither (a) nor (b) is a security boundary (P8). (a) is the design's
  default with the configurability deferred. **Note:** it's measured from
  the object's origin, so a large object (a 20 m wall) can be out of reach
  of a visitor standing at its far end.

- **AC-L3 — Does the host tab's own click obey the same distance?**
  - **(a) Recommended: yes.** The runner checks the same
    `withinActivateDistance` against the local avatar's world position
    (P16) before `select`. With no local avatar, nothing runs, as on the
    server. Too far shows the same notice.
  - (b) No: the host's own clicks stay unlimited, as 4b-2 shipped them.

  With (b) the same click on the same object works in one of the owner's
  tabs and not in the other, depending on which one the server picked: the
  kind of "the tabs disagree" the operator flagged at signin-sync's
  acceptance (signin-sync passdown §4.6). **(a) changes shipped behaviour:**
  an owner who clicked a switch from across the world in 4b-2 now has to
  walk up to it, and sees "Move closer to use this." In ORBIT the
  distance is from the camera (P18), so a zoomed-out owner has to zoom in.
  That's true in every tab under (a), and in visitors' tabs under either
  option.

- **AC-L4 — What the rate limits count.**
  - **(a) Recommended:** **per session**, a token bucket of 5, refilled at
    5 per second, charged for **every** schema-valid `activate` from a
    handshaken session, before the node is looked up; **per world**, a
    bucket of 20, refilled at 20 per second, charged **only for an
    `activate` that passed every other check**, at the moment it is
    forwarded. Both use an injected clock.
  - (b) Both charge every attempt.

  With (b), one far-away visitor clicking at 5 per second spends a quarter
  of the world's budget on refusals, and four of them lock everyone out.
  With (a), the world budget is spent only on behaviours that actually run,
  which is what it exists to bound (the host's per-frame work). The session
  bucket is the one that stops a single flood, and it is charged first so a
  flood costs no lookups.

- **AC-L5 — Error codes.**
  - **(a) Recommended:** existing codes, plus **one new code,
    `NO_SCRIPT_HOST`**, in the error enum:

    | Case | Code | Message |
    |---|---|---|
    | the per-session or the per-world limit | `RATE_LIMITED` | `too many activations; try again in a moment` |
    | the node doesn't exist | `NODE_NOT_FOUND` | `NODE_NOT_FOUND: <node>` (as `send`) |
    | no enabled behaviour that listens for select | `INVALID_FIELD` | `this object doesn't respond to clicks` |
    | no host | `NO_SCRIPT_HOST` | `nothing runs here while the world's owner is away` |
    | no avatar, or too far | `PERMISSION_DENIED` | `you have no avatar in this world` / `you are too far away to use this` |

  - (b) Existing codes only, with "no host" as `PERMISSION_DENIED` and the
    page telling the two apart by the message text.

  The page has to say different things for "too far" and "owner away"
  (AC-L6). (b) makes that depend on matching server prose, the shape of
  4.5's lesson (a check that passes until the real value changes). A new
  enum value is a schema change in a round that is already changing the
  schema, and old clients ignore codes they don't map (P4, `codeToReason`'s
  `default`).

- **AC-L6 — What the clicker sees.**
  - **(a) Recommended:** the page pre-checks what it can (an enabled
    select behaviour on the target, the distance) and sends nothing when the
    pre-check fails. It shows a transient notice (3 s, one at a time, a new
    `#activate-notice` beside the HUD hint) for `PERMISSION_DENIED` ("Move
    closer to use this.") and `NO_SCRIPT_HOST` ("Nothing happens: this
    world's owner isn't here."), whether the page or the server decided.
    `RATE_LIMITED`, `NODE_NOT_FOUND` and `INVALID_FIELD` go to the console
    only. A click that resolves to no behaviour node shows nothing (it's an
    ordinary click on scenery).
  - (b) Silent: refusals reach the console only.

  With (b), a visitor whose clicks are refused can't tell a broken switch
  from an absent owner. The pre-check keeps clicks on scenery off the wire
  and gives the distance answer at once. The server's checks stay the gate.

- **AC-L7 — How `activate` names its object.**
  - **(a) Recommended:** by **name** (`node`), like every other SOP
    message. **The page resolves the click to the behaviour node before it
    sends** (AC2's rule), so the server checks exactly the named node and
    **never walks ancestors**. A placed model's inner nodes are the page's
    own (models-by-url), not the server's, so a server-side walk couldn't
    work for them anyway.
  - (b) By `objectId` (every behaviour node has one, P11), the field named
    `object`.

  A rename between the click and the server is a few milliseconds wide,
  and its result is a harmless `NODE_NOT_FOUND`. (b) would be the only SOP
  message addressed by id, and the host would map it back to a name for the
  runner, which is keyed by name.

- **AC-L8 — Carried items.**
  - **(a) Recommended:** none, apart from the `otherTab` text (P14), which
    this round makes wrong.
  - (b) Also the proximity template's labels (4b-2 passdown §6.3: "Animate"
    and a hint that names both objects).

  The carried list (signin-sync passdown §6.3) is UI polish with no
  bearing on `activate`. 4b-2 took seven rounds. Keep this one narrow.

## 4. The contract (as recommended; adjust with §3)

### AC1. The protocol (`@atrium/protocol`)
- **`activate.client.json`:** `{ type: 'activate', seq, node, event }`,
  all required, `additionalProperties: false`. `seq` integer ≥ 0 (as
  `send`); `node` string, 1–256 characters (P11); `event` `const:
  'select'`.
- **`activate.server.json`:** `{ type: 'activate', seq, node, event, from,
  hostGen }`, all required, `additionalProperties: false`. `seq` is the
  server's `nextSeq()`; `node` and `event` as above; `from` the sender's
  session id (string, at least 1 character); `hostGen` as in
  `script-host.server.json` (integer, 1 to 2^53 − 1).
- **`index.js`:** `'activate:client'` and `'activate:server'` compiled;
  `activate` added to the direction list (P2) and to `messageTypes`.
- **`error.json`:** `NO_SCRIPT_HOST` added to the enum (AC-L5).

### AC2. The shared rule (`@atrium/behaviors` and the server's copy)
- **`listensForSelect(value)`:** true exactly when `value` is a plain
  object, `value.enabled === true`, and `value.graph.nodes` has a node
  whose `declaration` indexes a declaration with `op: 'event/onSelect'`
  (P10). Total: never throws, false for anything malformed. Two copies (the
  E1 pattern): `behavior-spec.js` and `send-policy.js`, both reading new
  `listensForSelect` vectors in `tests/fixtures/behavior-vectors.json`.
- **`selectTargetFor(somNode)`** (`@atrium/behaviors`, page only): walk
  `somNode` and its ancestors to the **first node whose stored leaf has
  `enabled === true`**. Skip avatars (`extras.atrium.ephemeral`). Return
  that node if `listensForSelect(leaf)`, otherwise `null`; return `null`
  if no such node. **Every tab uses it** (P13): the host's local click, the
  non-host owner's and the visitor's. The runner's `select(somNode)` keeps
  its signature but resolves through `selectTargetFor`, then runs that
  node's engine if it's live (nothing otherwise). That is one change to
  4b-2: a node the runner disabled no longer passes the click to an
  ancestor.
- **`ACTIVATE_MAX_DISTANCE = 10`** and
  **`withinActivateDistance(a, b, max = ACTIVATE_MAX_DISTANCE)`**:
  Euclidean, inclusive, false when either point is missing or not three
  finite numbers. Two copies, with vectors (including 10 exactly, 10.000001,
  a `NaN`, a missing point).
- **`worldPosition` moves to `@atrium/som`** (exported from its
  `index.js`, the same math), and `apps/client/src/world-position.js`
  re-exports it, keeping `subtreeSome`. Its existing tests
  (`world-position.test.js`, `teleport-trigger.test.js`) pass unchanged.
  The server imports it from `@atrium/som` (already a dependency). P7's
  probe case becomes a test.

### AC3. The server (`session.js`)
A new `case 'activate'` in the switch. **The checks run in this order**,
each refusal answered with `error` and the request's `seq`, and nothing
else happening: no broadcast, no change, no save.
1. (existing) depth guard, schema, handshake: `UNKNOWN_MESSAGE`,
   `AUTH_FAILED`.
2. **No world:** `UNKNOWN_MESSAGE`, `World not loaded` (as `send`).
3. **The session's bucket** (AC-L4): charged here; empty → `RATE_LIMITED`.
4. **The node:** `world.som.getNodeByName(msg.node)`; missing →
   `NODE_NOT_FOUND`.
5. **The behaviour:** `listensForSelect(node.extras?.atrium?.behavior)`
   false → `INVALID_FIELD`.
6. **A host:** `scriptHost.sessionId` set, that session in `sessions`, its
   socket `OPEN`; otherwise → `NO_SCRIPT_HOST`.
7. **An avatar:** `session.avatarNode` null → `PERMISSION_DENIED`.
8. **The distance:** `withinActivateDistance(session.avatarNode.translation,
   worldPosition(node))` false → `PERMISSION_DENIED`.
9. **The world's bucket** (AC-L4): charged here; empty → `RATE_LIMITED`.
10. **Forward** to the host session only:
    `{ type: 'activate', seq: nextSeq(), node: msg.node, event: 'select',
    from: session.id, hostGen: scriptHost.hostGen }`. No answer to the
    sender on success (the effect is the answer).

- **Mutation gate:** none. `activate` grants no edit rights and changes
  nothing on the server. Any session may send it, the host included (the
  page never sends from the host, but if it did the message would be
  forwarded to itself, harmlessly).
- **State:** the session bucket lives on the session object (gone with it),
  the world bucket beside `scriptHost` in `attachSessionHandlers` (one per
  world host, P5). The clock is a parameter of `attachSessionHandlers`
  (`now = () => Date.now()`), so tests drive it.
- **Log:** no line per accepted `activate` (up to 20 a second). One line
  per session per 60 s when its bucket first refuses: `[activate] rate
  limited <first 8 of session id> world <id>`. No node names, no user
  names.

### AC4. The client (`AtriumClient`)
- **`activate(nodeName)`** returns the seq, or `null` without sending when
  the client isn't connected, the current connection hasn't reached
  `session:ready` and `world:loaded` (P15), or `nodeName` isn't a non-empty
  string. It records `seq → nodeName` in a map of at most 16 entries
  (oldest dropped: success has no answer, so entries can't wait for one).
  An `error` whose `seq` is in the map removes it and emits
  **`activate:refused`** `{ node, code, message }`, as well as the usual
  `error` event.
- **An inbound `activate`** (new `case` in `dispatch`, P4): emitted as
  **`activate`** `{ node, from }` only when `this.scriptHost.active` and
  `msg.hostGen === this.scriptHost.hostGen` and `msg.event === 'select'`.
  Otherwise dropped, without a word. The connection-record guard at the top
  of `dispatch` already drops a stale socket's messages.
- **No other change** to the hello, `scriptRunner` stays `1` (Q3).

### AC5. The runner (`packages/behaviors/src/runner.js`)
- **`select(somNode, { from } = {})`:** resolves through `selectTargetFor`
  (AC2). If AC-L3 (a): unless `from` is given (a forwarded select), it
  checks `withinActivateDistance(position(localAvatar), position(target))`
  first. Too far: returns `'too-far'` and runs nothing. It returns
  `'ran'`, `'too-far'`, `'no-behaviour'` or `'not-running'`, so the app
  can show AC-L6's notice. The runner needs the local avatar node: a new
  `localAvatar` port (`() => avatar.localNode`).
- **The forwarded select:** the runner subscribes to the client's
  `activate`. It looks the node up by name. If `enabled()` and the node's
  record has a live engine and `listensForSelect(leaf)`, it calls
  `select(0)` and logs `select from <first 8 of from>` on that node.
  Otherwise it drops it and logs once per node per engine generation
  (`select dropped — <reason>`). It never re-checks distance: the server is
  the gate. **A forwarded select runs in Edit mode too**: Edit mode changes
  what the host's own clicks do, not what the world's behaviours do.
- Unchanged: the engines, the queue, the drag rule, the 20-a-second send
  rate. A forwarded `select` reaches at most 20 engines a second per world
  (the server's bucket), each bounded by the 10,000-step budget.

### AC6. The app (`apps/client`)
- **The click branch** (P12), outside Edit mode, after `isSelectClick`:
  `target = selectTargetFor(pickBehaviorTarget(e))`. No target: nothing.
  **This tab is the host** (`client.scriptHost.active`): `runner.select`
  as AC5 (a notice on `'too-far'`). **Otherwise:** the page pre-check
  (distance from the local avatar; no local avatar → the "Move closer"
  notice, as the server would say), then `client.activate(target.name)`.
- **`activate:refused`:** AC-L6's mapping to `#activate-notice`, one
  pure function (`activateNoticeText(code)`, tested), the element cleared
  after 3 s.
- **`otherTab`** becomes "Behaviours run in another tab; clicks here are
  sent to it".
- Edit mode: unchanged. A click selects in every tab.

### AC7. What doesn't change
The leaf (no new key under AC-L2 (a)), F1's rules, the templates, the form
apart from `otherTab`, the election, `hostGen`'s rules, the send queue and
its rate, the renderer, `hover`, proximity (still computed by the host from
`view`, design §5.2).

## 5. Open questions for the brief author and the reviewer
- **Q1. ORBIT** (answered in Rev 0, P18): an ORBIT tab has an avatar at
  the camera's position. What's left for the reviewer: is "the camera must
  be within 10 m" acceptable in ORBIT worlds, or should ORBIT measure from
  the orbit target? The server can't see the orbit target (only `view`), so
  measuring from the target would make the page and the server disagree.
  Recommended: accept it, and have the notice say "Move closer to use this."
  in ORBIT too ("zoom in" is the same move there).
- **Q2. Pointer lock** (P17): should a click while the pointer is locked
  aim from the screen centre? It's existing behaviour in the host tab, and
  4c makes it reach visitors. Recommended: record it, don't fix it here,
  unless the brief author finds it already broken on DEV.
- **Q3. A stale host tab** (P4): a 4b-2 page still open after the deploy
  can be elected host (it sends `scriptRunner: 1`) and drops every
  forwarded `activate`. Visitors then see no effect and no notice.
  Recommended: accept it (it's the owner's own tab, and a reload fixes it).
  The alternative is `scriptRunner: 2` meaning "handles `activate`", with
  the election preferring it: a protocol change for a one-deploy window.
- **Q4. The distance check's anchor:** the object's origin (AC-L2). A
  reviewer may prefer the nearest point of its bounds. The server has no
  bounds for model hosts (models are the page's), so the origin is the
  only thing both sides can compute.

## 6. Tests

| Item | Tests | Proof of failure |
|---|---|---|
| AC1 | both schemas: a valid message of each form accepted; each required field missing refused; `event: 'hover'` refused; an extra key refused; `node` of 257 characters refused; `hostGen: 0` refused; `validate('client', <server form>)` refused (`from` is an extra key); `NO_SCRIPT_HOST` in an `error` accepted | (a) drop `activate` from the direction list (the client form is looked up as `activate` and every message is refused) |
| AC2 | the vectors through both copies: `listensForSelect` for each template (true for the three select templates, false for proximity and interval), `enabled: false`, a declaration with no node using it, `null`, a string, a graph with no `nodes`; `withinActivateDistance` at 9.999, 10, 10.000001, `NaN`, a missing point; `selectTargetFor` on a stand-in tree: the hit's own node, a model's inner node reaching its host, an enabled proximity behaviour on the parent stopping the walk (`null`), a disabled behaviour on the parent skipped to the grandparent, an avatar skipped; `worldPosition` from `@atrium/som` on P7's case gives `[10, 2, -6]` | (b) accept `enabled: false` in the server copy only; (b2) walk past an enabled non-select behaviour in `selectTargetFor` |
| AC3 | server, port 0, **real sessions over real sockets** (the seam rule): owner host + visitor; the visitor's `activate` within 10 m reaches the host with `from` and the current `hostGen`, and the visitor gets nothing back; **each refusal in §4 AC3's order** with its code and `seq`, and **nothing forwarded** (the host's socket sees no `activate`); the order itself: a far-away visitor's `activate` on an object with no behaviour gets `INVALID_FIELD`, not `PERMISSION_DENIED`; **a nested object** (P7's group) measured at its world position (7 m from the visitor at the world position passes; at the local translation it would fail); **buckets with the injected clock:** 5 in one instant pass the session check, the 6th is `RATE_LIMITED`, after 200 ms one more passes; 30 visitors each within their own limit: 20 forwarded in one instant, the 21st `RATE_LIMITED`; refused-for-distance attempts don't charge the world bucket; **handover:** the host closes, an `activate` in the same tick is `NO_SCRIPT_HOST` until a second owner session is granted, then it is forwarded to that session with the new `hostGen`; a host whose socket is closing (not `OPEN`) is `NO_SCRIPT_HOST`; an anonymous cross-origin visitor is forwarded like any other; a session with a refused avatar `add` gets `PERMISSION_DENIED`; the rate-limit log line once per session per 60 s; a `G2`-style throw in the case (injected) is answered and the session survives | (c) check distance against `getNodeTranslation` (the nested case fails); (c2) charge the world bucket before the distance check (the "refused attempts" test fails); (c3) forward to the first `canEdit` session instead of `scriptHost.sessionId` |
| AC4 | `packages/client` against a port-0 server (not a fake socket): `activate` before `session:ready` returns `null` and sends nothing; after it, the exact message; a refusal emits `activate:refused` with the node and code, and **a pending connect is not failed by it** (P15: a teleport started after a refused `activate`); the 17th outstanding seq evicts the first; an inbound `activate` with the current `hostGen` emits `activate`; with an older `hostGen`, or after `script-host` `active: false`, or on a non-host, it doesn't | (d) emit `activate` without the `hostGen` comparison |
| AC5 | the runner with a fake client **and the real `selectTargetFor` and `withinActivateDistance`** (not stand-ins, signin-sync §4.1): a forwarded select runs the engine and logs `from`; dropped when the runner isn't enabled, the node has no live engine, or the leaf no longer listens; dropped-once logging per node per generation; **a forwarded select runs while the app is in Edit mode** (the runner never knows Edit mode: the test is that nothing in the path consults it); the host's local `select` at 11 m returns `'too-far'` and the engine doesn't run, at 9 m `'ran'`; a disabled node with an enabled select behaviour on its parent: the parent doesn't run (the AC2 change), and 4b-2's existing select tests still pass | (e) skip the distance check on the host's local path; (e2) keep 4b-2's "first live engine" walk |
| AC6 | the strict DOM fake: the click branch for host, non-host owner and visitor tabs (local `select` vs `activate`, a pre-check refusal sends nothing and shows the notice), **through the real runner and the real `client.activate`** with only the socket faked; `activateNoticeText` for each code; the notice clears after 3 s and a second one replaces the first; the `otherTab` text; a wiring guard that the click branch calls `selectTargetFor` and that the Edit-mode branch is unchanged | (f) send `activate` from the host tab (the host test sees a message on the socket) |

**Proofs:** commit first; break the file, run, record the failing test
names, restore the file **from a saved copy, never with `git checkout`**,
re-run green. "Not reproducible" is not an acceptable result. The 4 GB
host ran out of memory during signin-sync's proof batch (that passdown
§4.6): run the proofs one at a time, not in parallel.

### 6.1 Claude's browser checks (after publish, before DEV acceptance)
In the harness (`devtasks/harness/`, new `checks/scripting-4c/`), with the
real sign-in (`checks/signin-sync/` setup):
1. **Owner host tab + anonymous visitor tab:** a cube with "On select: show
   or hide" on a second cube. The visitor walks within 10 m and clicks: the
   second cube hides in both tabs, and the host's log shows `select from
   <visitor>`. At 12 m: "Move closer to use this." and nothing is sent (the
   visitor's socket log).
2. **A model's inner mesh:** the visitor clicks a placed `Fox.glb` with
   "On select: play": it plays everywhere.
3. **A second owner tab** (not host): its click goes through `activate`;
   its status line says "clicks here are sent to it".
4. **Owner away:** close every owner tab. The visitor's click: "Nothing
   happens: this world's owner isn't here." Open an owner tab: the next
   click works.
5. **Handover:** two owner tabs and a visitor; close the host tab; the
   visitor's next click runs in the other owner tab.
6. **Limits, from the visitor's console:** 10 `activate`s in one task: 5
   forwarded, 5 `RATE_LIMITED`; a `view` that puts the visitor next to a
   far object, then `activate`: forwarded (P8, recorded as expected);
   `activate` for a cube with no behaviour: `INVALID_FIELD`.
7. **The host's own click at 15 m** (AC-L3 (a)): the notice, nothing runs.
   At 5 m: it runs.
8. **Edit mode:** the host in Edit mode, a visitor's click still runs the
   behaviour; the host's own click selects.
9. **Regression:** 4b-2's `r7.py`, `f3.py` (P section), signin-sync's `c.py`
   and `c4b.py`, and the 4b-2 regression set with a baseline
   (`reg_run.sh`, `regdiff.py`).

## 7. DEV acceptance (operator, Firefox, hard reload in every tab)
1. **In an owned world:** a cube with "On select: show or hide" targeting a
   library model. Open a private window as a visitor. Walk the visitor up
   to the cube and click it: the model disappears in both windows; click
   again: it comes back.
2. **Walk the visitor away (past 10 m) and click:** "Move closer to use
   this." Nothing changes.
3. **A second signed-in tab of the owner:** its Behaviour section says
   clicks are sent to the other tab; standing close, its click works.
4. **Close both owner tabs.** The visitor's click: "Nothing happens: this
   world's owner isn't here." Reopen an owner tab: the visitor's click
   works again.
5. **The owner's host tab, far from the cube:** the notice; close up: it
   works (AC-L3 (a)).
6. **Edit mode on in the host tab:** the visitor's click still toggles the
   model; the owner's click selects the cube.

## 8. Worker rules and release path
As scripting-4b-2 and signin-sync, with this round's specifics:
- **Steps, one commit each, every commit runnable:**
  1. AC1: the schemas, the validator, the enum, the schema tests;
  2. AC2: `listensForSelect`, `selectTargetFor`, the distance rule (both
     copies), the vectors, `worldPosition` into `@atrium/som` with the
     re-export;
  3. AC3: the server case, the buckets, forwarding, the log line, its tests;
  4. AC4–AC5: the client and the runner, their tests;
  5. AC6: the app, its tests and wiring guards;
  6. full suites (server files each on its own), proofs (a)–(f) with every
     sub-proof, and the handoff.
- **Each commit's report lists the suites run at that step** and names any
  test deferred to a later step.
- **Every brief rule from signin-sync §4.1:** a test of a seam uses the
  real collaborator or the exact value production passes. Named for this
  round: AC3's tests use real sockets, not a fake host; AC5's use the real
  `selectTargetFor` and distance rule; AC6's use the real runner and
  `client.activate`.
- **`--max-runtime 4h`**, and check the implementation card's cap after
  creation (signin-sync §4.3–4.4: the tools have dropped it).
- **A protocol and server round:** DEV restarts at the deploy.
  **Acceptance needs a hard reload in every tab** (Q3).
- **Cards and bodies:** the kickoff fills each card's body field (the
  bodies went in as comments in both previous rounds), and every workflow
  card is created with its parent. If the host round (signin-sync §6.2
  item 1) hasn't landed its guard, the operator checks each new card's
  parents on the board before the dispatcher's next tick.
- **Both outside reviews:** this pre-brief, before FINAL; and the whole
  round from base to tip after GLM's review.
- **Never push to `main` between the release merge and the MAIN push.**

## 9. Notes for the brief author
- **The check order is the contract** (§4 AC3). A refusal's code must be
  deterministic for the tests, and the cheap checks (bucket, map lookup) run
  before the walks (`listensForSelect` reads at most 32 declarations and 64
  nodes; `worldPosition` walks the parent chain).
- **`worldPosition` and SOM nodes:** it reads `translation`, `rotation`,
  `scale` and `parent`, all `SOMNode` getters (`SOMNode.js` L53–67, L133).
  glTF-Transform's `getWorldTranslation` agrees (P7's probe), but use one
  implementation on both sides.
- **The server never trusts `from` or `node` beyond what it checked,** and
  neither does the host: `from` is for the log, not identity.
- **`activate` must not reach `_resolveRejected`'s edit paths** (P15 and
  AC4): its seqs are in their own map, so an `activate` refusal never
  resolves an edit with the same seq. Every client seq comes from one counter (`_sendSeq`), so
  they can't collide, but say so in a test.
- **The visitor's pre-check and the server can disagree at the boundary:**
  the server measures the last `view` it got, up to one view interval old.
  The page then shows the server's notice. That's expected.
- **Recorded, not fixed (P8):** the distance check trusts `view`. A
  movement-plausibility check would belong to `view` itself, for every
  feature that reads positions (teleporters, proximity), not to 4c.

## 10. Next rounds
- **4d — graphs beyond the templates** (4b-2 pre-brief §9): the wider op
  allowlist, `flow/setDelay` with its own timers, `event/onTick`,
  `pointer/interpolate`, the converter and the unsupported-node report,
  `KHR_animation_pointer` models; plus, from this round, **a per-behaviour
  distance** (AC-L2 (b)) if wanted, and the conformance fixtures (4b-2
  passdown §6.6 item 1).
- **Later:** a hover cursor over activatable objects (needs a raycast on
  move, outside Edit mode); `hover` and visitor-side `change` (design §5.2,
  not in Phase 3); server-enforced revocation, before any non-disconnect
  role move.

## 11. Review log
- **Rev 0** (2026-10-30, early morning PT): drafted by Claude from the
  4b-2 pre-brief §9 and F-L9, the 4a pre-brief §9.2, the design §5.2, §5.3
  and §11.2 C, the 4b-2 and signin-sync passdowns, code reading at
  `71b6e40b`, probes `p1` and `p2` (§2.4) and the base suites (§2). Open:
  AC-L1–AC-L8, Q2–Q4 (Q1 answered, P18).
