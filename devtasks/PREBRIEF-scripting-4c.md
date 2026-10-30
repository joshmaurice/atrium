# Pre-brief: Phase 3 step 4c — visitors' `activate`: a click in any tab reaches the script host

Status: **DRAFT, Revision 1.2 (2026-10-30), ready for the operator to make
FINAL. Decisions AC-L1–AC-L8 approved by the operator (2026-10-30 00:32
PT), all as recommended:**
AC-L1 (a) one round, six steps; AC-L2 (a) a fixed 10 m from the object's
origin; AC-L3 (a) the same rule for the host's own clicks; AC-L4 (a) the
session bucket charged for every attempt, the world bucket only for
forwards; AC-L5 (a) existing codes plus `NO_SCRIPT_HOST`; AC-L6 (a)
transient notices, with Rev 1's N1 texts; AC-L7 (a) by node name; AC-L8 (a)
no carried items.
- **Rev 1.2 applies the second outside review, of Rev 1.1**
  (`devtasks/REVIEW-scripting-4c-rev1.1.md`, CHANGES REQUESTED: 1
  must-fix, 2 should-fix, 1 nit; read-only through GitHub's API). The
  reviewer closed all nine Rev 0 findings, found the readiness design and
  the version-2 election acceptable, and saw no reason to revisit
  AC-L1–AC-L8: "Once the older-server compatibility issue is settled, I
  would expect this pre-brief to be ready for FINAL without another broad
  design review." Claude checked each finding and ran probe `p4`. **All
  are taken;** §0.2 lists them. No decision changes.
- **Rev 1 applies the outside review of Rev 0**
  (`devtasks/REVIEW-scripting-4c-rev0.md`, CHANGES REQUESTED: 2 must-fix,
  4 should-fix, 3 nits; read-only against `ec9ebc1f` through GitHub).
  Claude checked every finding against the code and ran a third probe
  (`p3`, pointer lock in Chromium). **All are taken.** The reviewer agreed
  with all eight recommendations and with Q1 and Q4, so no decision
  changes. §0 lists what changed, and §11 maps each finding.
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
  a hover cursor over activatable objects (§10).

## 0. Changes

### 0.1 Revision 1 (the review of Rev 0)
- **M1, an `activate` lost while the host loads:** the server forwards only
  to a host that has said it is **ready**. A new client message,
  `script-ready { hostGen }`, is sent by the runner the moment it becomes
  enabled (role, `canEdit`, world loaded). Every grant clears readiness.
  Until the host is ready, `activate` is refused with `NO_SCRIPT_HOST`,
  never forwarded and lost. A host whose load fails never becomes ready, so
  visitors get the refusal. (P19; AC1, AC3, AC4, AC5; tests and proof (g).)
- **M2, `@atrium/som` in the app:** `apps/client/package.json` gets
  `"@atrium/som": "workspace:*"` and the lockfile follows. Both files are
  in the round's scope. (P20; AC2; §8.)
- **S1, the handover test:** rewritten to test what's actually true. With
  readiness there **is** an observable no-host window, from the grant to
  the new host's `script-ready`, and the test pins it there, not at
  `cleanupSession`. Its invariants: nothing goes to a closing socket,
  nothing is forwarded twice, and every forward carries the current
  `hostGen`. With no successor, the answer is `NO_SCRIPT_HOST`. (§6 AC3.)
- **S2, stale host tabs (Q3, now settled):** capability versioning.
  `scriptRunner: 2` means "runs behaviours and handles forwarded
  `activate`". **Election and handover require 2.** The schema still
  accepts 1, so a 4b-2 page still connects, keeps its Edit panel and is
  never the host. (AC1, AC3; tests and proof (g2); browser check 10.)
- **S3, the refusal map:** activation records live on the connection
  record, beside `pendingEdits`, because `_sendSeq` restarts at 0 on every
  connect (P21). (AC4; test and proof (h).)
- **S4, pointer lock (Q2, now settled), fixed in 4c:** `p3` showed that
  while `#viewport` holds the lock, a click's `target` is `#viewport` and
  `clientX/Y` stay where the lock began. The branch's `e.target !== canvas`
  test returns early, so **with mouse lock on, no click triggers anything
  today, in any tab.** Rev 1: while locked, a click on the viewport aims
  from the screen centre, where `#crosshair` is. (P17; AC6; test, proof
  (i), browser check 11, DEV acceptance step 7.)
- **N1:** the notices are split by who decided. The page's own pre-check
  can tell "no avatar" from "too far". A `PERMISSION_DENIED` from the
  server covers both, and gets a neutral text. (AC6.)
- **N2:** "the distance check is not a security boundary" is now a worker
  rule (§8), so the brief can't describe the 10 m rule as stopping a
  determined visitor.
- **N3:** a successful forward isn't a successful run. Stated in AC3 and
  §9, with the cases that can still drop a forwarded select.

### 0.2 Revision 1.2 (the review of Rev 1.1)
- **M1, `scriptRunner: 2` breaks connections to older servers:**
  confirmed, and it's older than this round (P23, `p4`). A server's `hello`
  schema refuses any `scriptRunner` it doesn't know, so today's 4b-2 client
  is already refused by any pre-4b-2 server, and 4c's `2` would be refused
  by every server released today. **That includes PROD while 4c is on DEV:**
  the two are different origins, so a DEV page that opens a PROD world
  connects cross-origin. **The policy (AC4, AC6):** the hello advertises
  `scriptRunner` only on a connection to the page's own account origin,
  where the server runs the same code as the page. A cross-origin hello
  carries no `scriptRunner` at all, the shape every released server
  accepts. Nothing is lost: a cross-origin connection is always anonymous
  (signin-sync I1), so it can never be the host. `AtriumClient.connect`
  gets a `scriptRunner` option (default off). The page sets it in the one
  place every connect goes through (`connectNow`). The two frozen
  `hello` schemas become test fixtures. (Tests and proof (j); browser
  check 13; DEV step 8.)
- **S1, the `activate()` readiness test:** three states, not two: before
  `session:ready`, between `session:ready` and `world:loaded`, and after
  both. (§6 AC4.)
- **S2, the held-load test's order:** spelled out, with the visitor loaded
  before the hold is installed, because `serialize` is shared. (§6 AC5.)
- **N1, `script-ready`'s direction:** it joins the validator's direction
  list and is compiled as `script-ready:client` only, so
  `validate('server', …)` refuses it. (AC1; §6 AC1.)

## 1. What 4c delivers

| Who | What they get |
|---|---|
| **A visitor** (signed in or anonymous, same-origin or not) | A click on an object with an enabled "On select" behaviour, within 10 m, runs the behaviour in the owner's script-host tab, and the visitor sees the effect as an ordinary `set`. Too far: "Move closer to use this." No owner present, or the owner's page still loading: "Nothing happens: this world's owner isn't here right now." With mouse lock on, a click aims at the crosshair |
| **The owner, in a non-host tab** | The same route as a visitor. The Behaviour section's status line now says "Behaviours run in another tab; clicks here are sent to it." |
| **The owner, in the host tab** | No change except AC-L3 (the same 10 m rule applies here, so every tab behaves the same) and S4 (mouse-lock clicks work) |
| **The server** | Two new client messages: `activate`, with a fixed order of checks (§4 AC3), two rate limits (5 per second per session, 20 per second per world) and forwarding to the current, **ready** host only, with its `hostGen`; and `script-ready`. One new error code, `NO_SCRIPT_HOST` (AC-L5). The host role now requires `scriptRunner: 2` |
| **The repo** | `activate.client.json`, `activate.server.json`, `script-ready.client.json`; one shared "which node does a click select" rule, used by every tab; `worldPosition` moved into `@atrium/som`, so the server and the page measure distance with the same code |

**It is one round with six steps** (AC-L1). It doesn't run any new kind of
world-supplied code, but **it opens a new input path for anonymous
visitors** into the server and into the owner's browser. So it keeps both
outside reviews: this pre-brief, and the whole round from base to tip.

## 2. Verified facts (at `71b6e40b`)

Claude read the code, ran three probes (§2.4: `p1` against the installed
workspace, `p2` against a real world server, `p3` in Chromium for Rev 1),
and ran the suites nearest
this round at the base: protocol 100 pass; `@atrium/behaviors` 131 pass,
1 skip (the named `KHRONOS_ASSETS` skip); server `script-host` 11,
`behavior-leaf` 21, `behavior-walk` 9, all pass. The app itself wasn't
opened in a browser for this draft. `p3` used a minimal page.

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
  `activate` would drop it without a word. That's why Rev 1 makes such a
  tab ineligible (S2, AC3).

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
- **P17. Pointer lock: clicks never reach the behaviour branch** (Rev 1,
  `p3`). With `modes.usePointerLock`, a click on the viewport requests the
  lock **on `#viewport`** (`app.js` L2951–2953), not on the canvas. While
  it is held, every mouse event is delivered to the lock target: `p3`
  (Chromium, a `#viewport` holding a canvas) logged the locked click with
  `target: 'viewport'` and `clientX/Y` at the point the lock started
  (100, 80), though the mouse had moved to (300, 250). So the branch's
  `if (e.target !== canvas) return` (L2083) ends **every** locked click,
  in every tab, and even if it didn't, `pickBehaviorTarget` would aim from
  the stale point. The page draws a centre crosshair (`#crosshair`,
  `index.html` L391–405, L623, `pointer-events: none`). Edit mode releases
  the lock (`setEditMode`, L1843), so only the behaviour branch is
  affected.
- **P18. An ORBIT tab has an avatar, and it sits at the camera.**
  `NavigationController.tick` (L91–121) returns early only when there is
  no `localNode`. In ORBIT it sets the avatar node's translation to the
  orbiting camera's position and sends that as `view`. The orbit radius
  is 0.5–100 m (`onWheel`, L71–75). So in ORBIT, the distance AC-L2
  measures is from the camera, not from the orbit target: an owner or
  visitor zoomed out past 10 m can't trigger anything until they zoom in.
- **P19. The host is elected before its world has loaded** (Rev 1, M1).
  The server elects at `hello` (`session.js` L718–725), sends the `hello`
  (L727), and only then awaits `world.serialize()` for the `som-dump`
  (L814). The page's runner is enabled only on `world:loaded`
  (`runner.js` L536), which `_onSomDump` emits after awaiting
  `io.readJSON` (`AtriumClient.js` L1149–1180). `dispatch` is called
  for each message without waiting for the previous one (L843), so a
  message can be handled while `_onSomDump` is still waiting. Under Rev
  0's AC3, an `activate` in that window would be forwarded to a host that
  then dropped it, and the visitor would hear nothing. The same holds for
  a host whose load fails.
- **P20. `@atrium/som` doesn't resolve from the app** (Rev 1, M2).
  `apps/client/package.json` depends only on `@atrium/behaviors` and
  `@atrium/client`. `apps/client/node_modules/@atrium/` holds just those
  two links, the repo root has no `@atrium` links, and
  `import('@atrium/som')` run from `apps/client` fails with
  `ERR_MODULE_NOT_FOUND` (checked at the base). The browser gets it from
  the import map (`index.html` L531). No file in `apps/client/src` imports
  `@atrium/som` today.
- **P21. A client's seqs restart at 0 on every connect** (Rev 1, S3).
  `connect` calls `_clearViewState` (`AtriumClient.js` L630), which sets
  `_sendSeq = 0` (L1913). Per-connection state already lives on the
  connection record (`pendingEdits`, `hostGenSeen`, L680–690).
- **P22. The election checks the capability in two places**:
  `canRunBehaviors` (`session.js` L466–468, used by the handover) and an
  inline `scriptRunner === 1` in the `hello` election (L720). A change to
  the rule has to change both. The client sends `scriptRunner: 1`
  (`AtriumClient.js` L743), and the schema has `const: 1`
  (`hello.client.json` L29).
- **P23. A server refuses a `hello` capability it doesn't know** (Rev 1.2,
  the second review's M1; `p4`). `hello.client.json` closes
  `capabilities` with `additionalProperties: false`. Before 4b-2 (the
  schema at `9e8b1e4^`) it had no `scriptRunner` key. 4b-2 (`9e8b1e4`)
  added it as `const: 1`. So every hello today's client sends is refused
  by a pre-4b-2 server, and a hello with `2` would be refused by every
  server released today (`ab02239b`, on PROD). The page already sends one
  field only on same-origin connects: T7's `displayName` (`app.js`
  L527–530, beside each connect site), checked with `sameOriginAsAccount`
  (`wsUrl.js`, fixed in signin-sync). Every connect reaches the client
  through **one** call, `connectNow` (`app.js` L1189–1191, the path
  signin-sync made single). The SOM Inspector (`tools/som-inspector`) and
  the playground also use `AtriumClient`, and they have no runner.

### 2.4 Probes `p1`–`p4` (2026-10-30)
**`p4`, `hello` compatibility (Rev 1.2):** Ajv (as the server compiles it,
`strict: false`) on the `hello.client.json` of two server versions: the
one before 4b-2 (`9e8b1e4^`) and the base (`71b6e40b`, identical to
released `ab02239b`):

| The client's `capabilities` | pre-4b-2 server | `71b6e40b` server |
|---|---|---|
| `{ tick }` (no `scriptRunner`) | accepted | accepted |
| `{ tick, scriptRunner: 1 }` (today's client) | **refused** (`must NOT have additional properties`) | accepted |
| `{ tick, scriptRunner: 2 }` (Rev 1.1's client) | **refused** (`must NOT have additional properties`) | **refused** (`must be equal to constant`) |

**`p3`, pointer lock (Rev 1):** Chromium from the workspace's Playwright,
a page with `<div id="viewport"><canvas></canvas></div>` whose click
handler logs and then calls `viewport.requestPointerLock()`. First click
at (100, 80): `{ locked: false, target: 'c' }`. The mouse moved to (300,
250), then a second click: `{ locked: true, target: 'viewport', x: 100,
y: 80 }`. The lock was still held at the end. Firefox wasn't probed. The
Pointer Lock spec sends events to the lock target in every browser, and
DEV acceptance runs in Firefox (§7 step 7).


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
translation is about 9.3 m from the real position. (All four probes were
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
    | no host, or the host isn't ready (Rev 1, M1) | `NO_SCRIPT_HOST` | `nothing runs here while the world's owner is away` / `the world's owner isn't ready yet` |
    | no avatar, or too far | `PERMISSION_DENIED` | `you have no avatar in this world` / `you are too far away to use this` |

  - (b) Existing codes only, with "no host" as `PERMISSION_DENIED` and the
    page telling the two apart by the message text.

  The page has to say different things for "too far" and "owner away"
  (AC-L6). (b) makes that depend on matching server prose, which can change
  without any test noticing. A new enum value is a schema change in a round
  that is already changing the schema, and old clients ignore codes they
  don't map (P4, `codeToReason`'s `default`).

- **AC-L6 — What the clicker sees.**
  - **(a) Recommended:** the page pre-checks what it can (an enabled
    select behaviour on the target, the distance) and sends nothing when the
    pre-check fails. It shows a transient notice (3 s, one at a time, a new
    `#activate-notice` beside the HUD hint). **Rev 1 (N1): the text depends
    on who decided.**

    | Decided by | Case | Notice |
    |---|---|---|
    | the page | no local avatar | "You can't use this until your avatar has joined." |
    | the page | too far | "Move closer to use this." |
    | the server | `PERMISSION_DENIED` (no avatar or too far: one code) | "You can't reach this from where you are." |
    | the server | `NO_SCRIPT_HOST` | "Nothing happens: this world's owner isn't here right now." |

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
- **`script-ready.client.json`** (Rev 1, M1): `{ type: 'script-ready',
  hostGen }`, both required, `additionalProperties: false`, `hostGen` as
  above. Client to server only; the server never answers it. **Rev 1.2
  (N1): it's directional.** It joins the direction list and is compiled as
  `'script-ready:client'` only, so `validate('server', …)` finds no schema
  and refuses it.
- **`hello.client.json`** (Rev 1, S2): `capabilities.scriptRunner`
  becomes `enum: [1, 2]` (was `const: 1`). 1 stays valid, so a 4b-2 page
  still connects. 3 is refused.
- **`index.js`:** `'activate:client'`, `'activate:server'` and
  `'script-ready:client'` compiled; `activate` and `script-ready` added to
  the direction list (P2) and to `messageTypes`.
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
  re-exports it, keeping `subtreeSome`. **Rev 1 (M2, P20):**
  `apps/client/package.json` gains `"@atrium/som": "workspace:*"`, and
  `pnpm-lock.yaml` is updated by `pnpm install` (never by hand). Both files
  are in the round's scope (§8). The existing tests
  (`world-position.test.js`, `teleport-trigger.test.js`) pass unchanged,
  run by `apps/client`'s own `node --test tests/*.test.js`, the command the
  host runs. The server imports `worldPosition` from `@atrium/som` (already
  a dependency). P7's probe case becomes a test.

### AC3. The server (`session.js`)
**The host role (Rev 1, S2 and M1):**
- **Eligibility is `canEdit` and `capabilities.scriptRunner === 2`,** in
  both places that decide it (P22): `canRunBehaviors` and the `hello`
  election. A session with `scriptRunner: 1` keeps `canEdit` and every
  edit right and is never the host. With only such sessions, the world has
  no host.
- **Readiness:** `scriptHost` gains `ready: false`. Every grant (the
  `hello` election and `grantScriptHost`) sets `ready = false`, and so does
  a handover that finds no successor. A `script-ready` message sets
  `ready = true` **only when** it comes from `scriptHost.sessionId`
  **and** its `hostGen` equals `scriptHost.hostGen`. Any other
  `script-ready` (from a non-host, or an old generation) is ignored, with no
  answer and no log line. This is cooperative, like revocation (design
  §5.2): the server trusts the owner's page to say it when its runner is
  enabled.

**`case 'activate'`.** **The checks run in this order**, each refusal
answered with `error` and the request's `seq`, and nothing else happening:
no broadcast, no change, no save.
1. (existing) depth guard, schema, handshake: `UNKNOWN_MESSAGE`,
   `AUTH_FAILED`.
2. **No world:** `UNKNOWN_MESSAGE`, `World not loaded` (as `send`).
3. **The session's bucket** (AC-L4): charged here; empty → `RATE_LIMITED`.
4. **The node:** `world.som.getNodeByName(msg.node)`; missing →
   `NODE_NOT_FOUND`.
5. **The behaviour:** `listensForSelect(node.extras?.atrium?.behavior)`
   false → `INVALID_FIELD`.
6. **A ready host:** `scriptHost.sessionId` set, that session in
   `sessions`, its socket `OPEN`, and **`scriptHost.ready`** (Rev 1, M1);
   otherwise → `NO_SCRIPT_HOST` (`the world's owner isn't ready yet` when
   a host exists but isn't ready).
7. **An avatar:** `session.avatarNode` null → `PERMISSION_DENIED`.
8. **The distance:** `withinActivateDistance(session.avatarNode.translation,
   worldPosition(node))` false → `PERMISSION_DENIED`.
9. **The world's bucket** (AC-L4): charged here; empty → `RATE_LIMITED`.
10. **Forward** to the host session only:
    `{ type: 'activate', seq: nextSeq(), node: msg.node, event: 'select',
    from: session.id, hostGen: scriptHost.hostGen }`. No answer to the
    sender on success.

- **A forward isn't a run (Rev 1, N3).** The server confirms nothing. Once
  the host is ready, a forwarded select can still be dropped by the host if
  the behaviour changed or was disabled in the meantime, if the host's
  runner was disposed, or if the socket closed with the message in flight.
  Each of those is logged in the host's runner (AC5). The visitor sees only
  the absence of an effect. Accepted for Phase 3.
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
- **The hello and its capability (Rev 1, S2; Rev 1.2, M1, P23):**
  `connect(wsUrl, { …, scriptRunner = false })`. With `scriptRunner:
  true`, the hello's `capabilities` carry `scriptRunner: 2`. Otherwise they
  carry **no `scriptRunner` key at all** (not `0`, not `1`: the key's
  absence is the one shape every released server accepts). The default is
  off, so the SOM Inspector and the playground, which have no runner, stop
  advertising one. **The rule for later rounds:** a hello field that older
  servers don't know goes only on a same-origin connection. T7's
  `displayName` already follows it.
- **`activate(nodeName)`** returns the seq, or `null` without sending when
  the client isn't connected, the current connection hasn't reached
  `session:ready` and `world:loaded` (P15), or `nodeName` isn't a non-empty
  string. **It records `seq → nodeName` on the connection record**
  (`record.pendingActivations`, beside `pendingEdits`; Rev 1, S3, P21), at
  most 16 entries, oldest dropped (success has no answer, so entries can't
  wait for one). A new connection starts with an empty map, and a late
  error from an old socket is already dropped by `dispatch`'s record guard.
  An `error` whose `seq` is in the current record's map removes it and
  emits **`activate:refused`** `{ node, code, message }`, as well as the
  usual `error` event.
- **`scriptReady()`** (Rev 1, M1): sends `{ type: 'script-ready', hostGen
  }` for the current `scriptHost.hostGen`, **at most once per `hostGen` per
  connection** (`record.readySent`), and only while `scriptHost.active`.
  Returns true when it sent.
- **An inbound `activate`** (new `case` in `dispatch`, P4): emitted as
  **`activate`** `{ node, from }` only when `this.scriptHost.active` and
  `msg.hostGen === this.scriptHost.hostGen` and `msg.event === 'select'`.
  Otherwise dropped, without a word. The connection-record guard at the top
  of `dispatch` already drops a stale socket's messages.

### AC5. The runner (`packages/behaviors/src/runner.js`)
- **Readiness (Rev 1, M1):** `evaluate()` calls `client.scriptReady()`
  whenever `enabled()` is true after its scan: on the grant, on
  `world:loaded` and on a re-evaluation. The client's once-per-generation
  rule makes repeats harmless. It never calls it while disabled. So the
  server marks the host ready only after this tab's engines exist.
- **`select(somNode, { from } = {})`:** resolves through `selectTargetFor`
  (AC2). If AC-L3 (a): unless `from` is given (a forwarded select), it
  checks `withinActivateDistance(position(localAvatar), position(target))`
  first. Too far: returns `'too-far'` and runs nothing. It returns
  `'ran'`, `'too-far'`, `'no-avatar'`, `'no-behaviour'` or
  `'not-running'`, so the app can show AC-L6's notice. The runner needs the
  local avatar node: a new `localAvatar` port (`() => avatar.localNode`).
- **The forwarded select:** the runner subscribes to the client's
  `activate`. It looks the node up by name. If `enabled()` and the node's
  record has a live engine and `listensForSelect(leaf)`, it calls
  `select(0)` and logs `select from <first 8 of from>` on that node.
  Otherwise it drops it and logs once per node per engine generation
  (`select dropped — <reason>`, N3's cases). It never re-checks distance:
  the server is the gate. **A forwarded select runs in Edit mode too**:
  Edit mode changes what the host's own clicks do, not what the world's
  behaviours do.
- Unchanged: the engines, the queue, the drag rule, the 20-a-second send
  rate. A forwarded `select` reaches at most 20 engines a second per world
  (the server's bucket), each bounded by the 10,000-step budget.

### AC6. The app (`apps/client`)
- **The click branch** (P12), outside Edit mode:
  - **Unlocked:** as today, `e.target === canvas`, `isSelectClick`, and
    the hit under the cursor.
  - **Locked (Rev 1, S4, P17):** when `document.pointerLockElement ===
    viewportEl`, a click whose `target` is `viewportEl` is accepted, and
    `pickBehaviorTarget` aims from the **screen centre** (NDC `(0, 0)`,
    where `#crosshair` is) instead of `clientX/Y`. There's no look-drag
    while locked (looking is plain mouse movement), so the slop rule
    passes; the handle rule still applies. The aim choice is one pure
    function (`behaviorAim({ locked, clientX, clientY, rect })` → NDC),
    tested.
  - Then `target = selectTargetFor(<the hit node>)`. No target: nothing.
    **This tab is the host** (`client.scriptHost.active`): `runner.select`
    as AC5, with a notice on `'too-far'` and `'no-avatar'`.
    **Otherwise:** the page pre-check (no local avatar, or too far: AC-L6's
    page texts, nothing sent), then `client.activate(target.name)`.
- **`activate:refused`:** AC-L6's server texts on `#activate-notice`,
  from one pure function (`activateNoticeText({ by, code, reason })`,
  tested), the element cleared after 3 s.
- **`otherTab`** becomes "Behaviours run in another tab; clicks here are
  sent to it".
- **The connect path (Rev 1.2, M1):** `connectNow` (`app.js` L1189–1191),
  the one call every connect site goes through, passes `scriptRunner:
  sameOriginAsAccount(wsUrl, accountWsBase)` to `client.connect`. No other
  site sets it, so a seventh connect site can't get it wrong.
- Edit mode: unchanged. A click selects in every tab (and Edit mode
  already releases the lock).

### AC7. What doesn't change
The leaf (no new key under AC-L2 (a)), F1's rules, the templates, the form
apart from `otherTab`, `hostGen`'s rules (it still only increases), the
send queue and its rate, the renderer, `hover`, proximity (still computed
by the host from `view`, design §5.2). The election's ORDER is unchanged
(the earliest eligible session); only who is eligible changes (AC3).

## 5. Open questions for the brief author and the reviewer
- **Q1. ORBIT** (answered in Rev 0, P18): an ORBIT tab has an avatar at
  the camera's position. What's left for the reviewer: is "the camera must
  be within 10 m" acceptable in ORBIT worlds, or should ORBIT measure from
  the orbit target? The server can't see the orbit target (only `view`), so
  measuring from the target would make the page and the server disagree.
  Recommended: accept it, and have the notice say "Move closer to use this."
  in ORBIT too ("zoom in" is the same move there).
- **Q2. Pointer lock** (settled in Rev 1: S4, P17). It isn't an aiming
  inaccuracy. Locked clicks never reach the branch at all. Fixed in 4c
  (AC6), with a test, a proof, a browser check and a DEV step.
- **Q3. A stale host tab** (settled in Rev 1: S2). Election and handover
  require `scriptRunner: 2` (AC3), so a 4b-2 page is never the host, even
  when it's the only owner tab. **Consequence, accepted:** after the
  deploy, an owner whose only open tab is a 4b-2 page has no behaviours
  running (no host) until that tab reloads, and visitors get
  `NO_SCRIPT_HOST`, not silence. Browser check 10 shows it.
- **Q4. The distance check's anchor:** the object's origin (AC-L2). The
  reviewer agreed (Rev 0 review). The server has no bounds for model hosts
  (models are the page's), so the origin is the only thing both sides can
  compute.

## 6. Tests

| Item | Tests | Proof of failure |
|---|---|---|
| AC1 | the three schemas: a valid message of each form accepted; each required field missing refused; `event: 'hover'` refused; an extra key refused; `node` of 257 characters refused; `hostGen: 0` refused; `validate('client', <server form>)` refused (`from` is an extra key); `NO_SCRIPT_HOST` in an `error` accepted; a `hello` with `scriptRunner` 1 and 2 accepted, 3 refused; `validate('server', <script-ready>)` refused, `validate('client', <script-ready>)` accepted (N1) | (a) drop `activate` from the direction list (the client form is looked up as `activate` and every message is refused) |
| AC2 | the vectors through both copies: `listensForSelect` for each template (true for the three select templates, false for proximity and interval), `enabled: false`, a declaration with no node using it, `null`, a string, a graph with no `nodes`; `withinActivateDistance` at 9.999, 10, 10.000001, `NaN`, a missing point; `selectTargetFor` on a stand-in tree: the hit's own node, a model's inner node reaching its host, an enabled proximity behaviour on the parent stopping the walk (`null`), a disabled behaviour on the parent skipped to the grandparent, an avatar skipped; `worldPosition` from `@atrium/som` on P7's case gives `[10, 2, -6]`; **(M2) `apps/client`'s suite, run with its own `node --test tests/*.test.js` from `apps/client`, imports `src/world-position.js` and gets the `@atrium/som` function** | (b) accept `enabled: false` in the server copy only; (b2) walk past an enabled non-select behaviour in `selectTargetFor` |
| AC3 | server, port 0, **real sessions over real sockets** (the seam rule): owner host + visitor; the visitor's `activate` within 10 m reaches the host with `from` and the current `hostGen`, and the visitor gets nothing back; **each refusal in §4 AC3's order** with its code and `seq`, and **nothing forwarded** (the host's socket sees no `activate`); the order itself: a far-away visitor's `activate` on an object with no behaviour gets `INVALID_FIELD`, not `PERMISSION_DENIED`; **a nested object** (P7's group) measured at its world position (7 m from the visitor at the world position passes; at the local translation it would fail); **buckets with the injected clock:** 5 in one instant pass the session check, the 6th is `RATE_LIMITED`, after 200 ms one more passes; 30 visitors each within their own limit: 20 forwarded in one instant, the 21st `RATE_LIMITED`; refused-for-distance attempts don't charge the world bucket. **Readiness (M1):** the owner's `hello` is answered with the role, and **before it sends `script-ready`** a visitor's `activate` is `NO_SCRIPT_HOST` (`isn't ready yet`) and the owner's socket sees no `activate`; after `script-ready` with the current `hostGen`, the next is forwarded; a `script-ready` from the visitor, or with an old `hostGen`, changes nothing. **Eligibility (S2):** an owner `hello` with `scriptRunner: 1` gets `scriptHost: false`, is never handed the role, and with only that owner connected a visitor's `activate` is `NO_SCRIPT_HOST`; the E4 tests still pass with `scriptRunner: 2`. **Handover (S1, the real invariants):** two owner sessions A (host, ready) and B and a visitor V; A closes; `activate`s from V before, around and after the close are each either forwarded to exactly one of A or B or refused, **never to a socket that isn't `OPEN`, never to both**, and every forward carries the `hostGen` current when it was sent; B is granted with `hostGen + 1`, and V's `activate`s are `NO_SCRIPT_HOST` **from the grant until B's `script-ready`**, then forwarded to B. With no successor, `NO_SCRIPT_HOST`. Then: an anonymous cross-origin visitor is forwarded like any other; a session with a refused avatar `add` gets `PERMISSION_DENIED`; the rate-limit log line once per session per 60 s; a G2-style throw in the case (injected) is answered and the session survives | (c) check distance against `getNodeTranslation` (the nested case fails); (c2) charge the world bucket before the distance check (the "refused attempts" test fails); (c3) forward to the first `canEdit` session instead of `scriptHost.sessionId`; **(g) skip the readiness check (the before-ready test fails); (g2) elect a `scriptRunner: 1` session (change only the `hello` election, then only `canRunBehaviors`: each alone must fail a test, P22)** |
| AC4 | `packages/client` against a port-0 server (not a fake socket): **the hello (Rev 1.2, M1):** with `scriptRunner: true`, its capabilities carry `scriptRunner: 2` and the port-0 server elects the owner; without it, they have no `scriptRunner` key; and **the exact hello the client sends without it** (captured on a raw port-0 socket) **is accepted by the two frozen server schemas**, `tests/fixtures/protocol-compat/hello.client.pre-4b-2.json` (from `9e8b1e4^`) and `hello.client.71b6e40b.json` (from `71b6e40b`), copied byte for byte with their source commit and sha256 in a README beside them, and compiled the way the server compiles them; **`activate` in three states (Rev 1.2, S1):** before `session:ready`, `null` and nothing sent; after `session:ready` and before `world:loaded` (the som-dump held), `null` and nothing sent; after both, the exact message; a refusal emits `activate:refused` with the node and code, and **a pending connect is not failed by it** (P15: a teleport started after a refused `activate`); the 17th outstanding seq evicts the first; **(S3) reconnect after an unanswered `activate` on node X: the new connection's first `activate` (on node Y, the same seq 1 or 2) is refused, and `activate:refused` names Y, never X**; `scriptReady()` sends once per `hostGen` per connection, never while inactive, and again after a reconnect's new grant; an inbound `activate` with the current `hostGen` emits `activate`; with an older `hostGen`, or after `script-host` `active: false`, or on a non-host, it doesn't | (d) emit `activate` without the `hostGen` comparison; **(j) send `scriptRunner` on every hello (the frozen-schema test fails); (j2) gate `activate` on `session:ready` alone (the middle state sends)**; **(h) keep `pendingActivations` on the client instead of the connection record (the reconnect test names X)** |
| AC5 | the runner with a fake client **and the real `selectTargetFor` and `withinActivateDistance`** (not stand-ins, signin-sync §4.1): **(M1) `scriptReady` is called exactly when the runner becomes enabled: not on the grant while the world is still loading, and once `world:loaded` arrives; never after `active: false`**; a forwarded select runs the engine and logs `from`; dropped when the runner isn't enabled, the node has no live engine, or the leaf no longer listens; dropped-once logging per node per generation; **a forwarded select runs while the app is in Edit mode** (nothing in the path consults Edit mode); the host's local `select` at 11 m returns `'too-far'` and the engine doesn't run, at 9 m `'ran'`, with no local avatar `'no-avatar'`; a disabled node with an enabled select behaviour on its parent: the parent doesn't run (the AC2 change), and 4b-2's existing select tests still pass. **And one test through the real client and a real port-0 server (M1, the reviewer's held load):** the owner's load is held **at the server**, by wrapping the real world's `serialize` to await a promise the test controls (no test seam in `src`, the hotfix's D3 lesson; a slow world isn't deterministic and isn't acceptable). **The order (Rev 1.2, S2), because `serialize` is shared by every connection:** (1) connect the visitor, wait for its `world:loaded`, its avatar `add` and a `view` within 10 m; (2) install the hold; (3) connect the owner with `scriptRunner: true`, wait for its `hello` (the role), and check that no `som-dump` has arrived; (4) the visitor's `activate`: `NO_SCRIPT_HOST` (`isn't ready yet`), and nothing on the owner's socket; (5) release the hold, wait for the owner's `world:loaded` and for the server to have received `script-ready`, then the visitor's next `activate` is forwarded and the owner's engine runs (its `set` reaches the visitor) | (e) skip the distance check on the host's local path; (e2) keep 4b-2's "first live engine" walk; **(g3) call `scriptReady` on the grant instead of when enabled (the held-load test fails)** |
| AC6 | the strict DOM fake: the click branch for host, non-host owner and visitor tabs (local `select` vs `activate`, a pre-check refusal sends nothing and shows the notice), **through the real runner and the real `client.activate`** with only the socket faked; **(S4) with `document.pointerLockElement === viewportEl`, a click whose `target` is `viewportEl` is handled, and `behaviorAim` gives NDC `(0, 0)` whatever `clientX/Y` say; unlocked, a click on anything but the canvas is still ignored**; `activateNoticeText` for each row of AC-L6's table (N1: the page's "no avatar" and "too far" differ; the server's `PERMISSION_DENIED` has the neutral text); the notice clears after 3 s and a second one replaces the first; the `otherTab` text; a wiring guard that the click branch calls `selectTargetFor` and `behaviorAim`, and that the Edit-mode branch is unchanged; **a wiring guard that `connectNow` passes `scriptRunner: sameOriginAsAccount(…)`, and that no other connect site passes `scriptRunner` (Rev 1.2, M1)** | (f) send `activate` from the host tab (the host test sees a message on the socket); **(i) aim from `clientX/Y` while locked (the centre test fails)** |

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
   happens: this world's owner isn't here right now." Open an owner tab:
   the next click after its world has loaded works.
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
10. **A stale owner tab (S2):** the owner's only tab is a page served from
    the base commit (`ab02239b`'s harness root, `scriptRunner: 1`): it
    isn't the host, nothing runs, and a visitor's click shows "Nothing
    happens: this world's owner isn't here right now." Open a 4c owner tab:
    it becomes the host, and the visitor's next click works.
11. **Pointer lock (S4):** in the visitor's tab, `M` for mouse lock, aim
    the crosshair at the cube, click: it runs. Aim at the sky and click:
    nothing. Repeat in the host tab.
12. **The host's load (M1):** throttle the owner tab's network while it
    loads a large world, and have the visitor click during the load:
    "isn't here right now", never silence. After the load, the click
    works.
13. **An older server, cross-origin (Rev 1.2, M1):** a second world
    server on another origin, built from the base (`setup.sh 71b6e40b`).
    From a 4c page, open one of its worlds through the address bar: it
    connects as an anonymous visitor (that server's log shows the `hello`
    accepted), and the page's socket log shows a hello with no
    `scriptRunner`. Back on the 4c origin, the owner's tab is still elected
    host (`scriptRunner: 2` in its hello).

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
   world's owner isn't here right now." Reopen an owner tab: once its
   world has loaded, the visitor's click works again.
5. **The owner's host tab, far from the cube:** the notice; close up: it
   works (AC-L3 (a)).
6. **Edit mode on in the host tab:** the visitor's click still toggles the
   model; the owner's click selects the cube.
7. **Mouse lock (S4):** in the visitor's window press `M`, click into the
   view, aim the crosshair at the cube and click: the model toggles. Press
   `M` again to release.
8. **An older server (Rev 1.2, M1):** from DEV, open a PROD world through
   the address bar (PROD still runs the released code): it connects, as a
   visitor. (Before this fix, Rev 1.1's client would have been refused
   there.)

## 8. Worker rules and release path
As scripting-4b-2 and signin-sync, with this round's specifics:
- **Steps, one commit each, every commit runnable:**
  1. AC1: the three schemas, `scriptRunner`'s enum, the validator, the
     error enum, the schema tests;
  2. AC2: `listensForSelect`, `selectTargetFor`, the distance rule (both
     copies), the vectors, `worldPosition` into `@atrium/som` with the
     re-export, **`apps/client/package.json` and `pnpm-lock.yaml`** (M2);
  3. AC3: eligibility (both places, P22), readiness, the `activate` case,
     the buckets, forwarding, the log line, its tests. **The client still
     sends `scriptRunner: 1` at this step** (on every connect, as 4b-2
     does), so the server's own tests use
     raw sockets with `scriptRunner: 2`, and the step's report says that a
     page built from this commit is never the host (expected until step 4);
  4. AC4–AC5: the client (the `scriptRunner` connect option, `activate`,
     `scriptReady`, the per-record map) and the runner, their tests, and
     the frozen-schema fixtures;
  5. AC6: the app (`connectNow`'s option, the click branch, pointer lock,
     the notices), its tests and wiring guards;
  6. full suites (server files each on its own), proofs (a)–(j) with every
     sub-proof (b2, c2, c3, e2, g2's two halves, g3, j2), and the handoff.
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
  **Acceptance needs a hard reload in every tab:** an unreloaded owner
  tab is a 4b-2 page and, after S2, is never the host (Q3).
- **Files in scope beyond `src` and tests:** `apps/client/package.json`
  and `pnpm-lock.yaml` (M2), the three new schemas,
  `tests/fixtures/behavior-vectors.json`, and
  `tests/fixtures/protocol-compat/` (the two frozen `hello` schemas and
  their README; Rev 1.2). Nothing under `packages/` for
  the vendored engine changes.
- **The distance check is not a security boundary (Rev 1, N2; P8).** The
  brief, the code comments and the handoff must not describe the 10 m
  rule as stopping a determined visitor: any client can send a `view`
  next to an object first. It stops ordinary far-away clicks and makes
  activation local, nothing more.
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
  AC4): its seqs are in their own map on the connection record, so an
  `activate` refusal never resolves an edit with the same seq. Within one
  connection every seq comes from one counter (`_sendSeq`), so they can't
  collide. Across connections the counter restarts (P21), which is why the
  map is per record. Say both in tests.
- **Readiness is the delivery contract (M1).** The server forwards only
  to a host that sent `script-ready` for the current `hostGen`. Don't
  weaken it to "the host's socket is open". That is exactly Rev 0's gap.
  `script-ready` is cooperative: the server can't verify the page's state,
  only that the right session said so for the right generation.
- **A forward isn't a run (N3).** Even with readiness, the host can drop a
  forwarded select (AC3's list). The runner's log is the only record. The
  handoff should say so, and DEV acceptance shouldn't treat a single
  missing effect as a server failure without the host's log.
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
- **Rev 1** (2026-10-30, PT): an outside review of Rev 0
  (`devtasks/REVIEW-scripting-4c-rev0.md`, CHANGES REQUESTED, read-only
  against `ec9ebc1f` through GitHub; the reviewer couldn't run the suites).
  Claude checked each finding against the code at `ec9ebc1f` (code
  unchanged since `71b6e40b`): `session.js` L466–468, L718–727, L814;
  `AtriumClient.js` L630, L680–690, L743, L843, L1149–1180, L1913;
  `runner.js` L536; `apps/client/package.json` and its `node_modules`
  (`import('@atrium/som')` → `ERR_MODULE_NOT_FOUND`); `app.js` L2083,
  L2951–2953; `index.html` L391–405, L623. Claude ran probe `p3` (pointer
  lock in Chromium). All are taken. No decision changes: the reviewer
  agreed with AC-L1–AC-L8 as recommended, and with Q1 and Q4.

| # | Finding | Severity | Where it went |
|---|---|---|---|
| M1 | An `activate` forwarded to a host whose world is still loading is dropped, and the visitor hears nothing | Must-fix | **Confirmed** (P19). Readiness: `script-ready`, `scriptHost.ready`, AC3 check 6, AC4 `scriptReady`, AC5; the held-load test at the server (§6 AC5) and proofs (g), (g3); browser check 12 |
| M2 | `@atrium/som` isn't a dependency of `apps/client` | Must-fix | **Confirmed** (P20: `ERR_MODULE_NOT_FOUND`). AC2 (the dependency and lockfile), §8 (files in scope), §6 AC2 (the app's own suite imports it) |
| S1 | The handover test asserts a no-host interval that doesn't exist | Should-fix | Confirmed for Rev 0 (the handover is synchronous). Rewritten (§6 AC3): the reviewer's invariants, plus the window that readiness does create, from the grant to `script-ready` |
| S2 | A 4b-2 tab can be elected and drop every `activate` | Should-fix | Confirmed (P22). `scriptRunner: 2` required for election and handover (AC1, AC3, AC4); Q3 settled; proof (g2) in two halves; browser check 10 |
| S3 | The refusal map outlives a connection whose seqs restart | Should-fix | **Confirmed** (P21). `record.pendingActivations` (AC4); the reconnect test and proof (h) |
| S4 | Pointer-lock clicks aim from a stale point | Should-fix | **Worse than reported** (`p3`, P17): locked clicks never reach the branch. Fixed in 4c (AC6 `behaviorAim`); test and proof (i); browser check 11; DEV step 7 |
| N1 | One notice for "no avatar" and "too far" | Nit | AC-L6's table: the page's texts differ, the server's `PERMISSION_DENIED` has a neutral one |
| N2 | Keep "not a security boundary" prominent | Nit | §8, a worker rule |
| N3 | A forward isn't a run | Nit | AC3, AC5, §9 |
- **Rev 1.1** (2026-10-30 00:32 PT): the operator approved AC-L1–AC-L8 as
  recommended. Only the status line and this entry changed. Next: the
  outside reviewer re-reviews Rev 1.1, then FINAL.
- **Rev 1.2** (2026-10-30, PT): a second outside review, of Rev 1.1
  (`devtasks/REVIEW-scripting-4c-rev1.1.md`, CHANGES REQUESTED; read-only
  through GitHub's API, no suites run). The reviewer verified Rev 1.1's
  size and sha256, closed all nine Rev 0 findings, and found the readiness
  design and the version-2 election acceptable. Claude checked each
  finding: the `hello` schema's history (`9e8b1e4`, `9e8b1e4^`), probe
  `p4` on both schemas, `connectNow` (`app.js` L1189–1191), T7's
  same-origin `displayName` (L527–530), `AtriumClient.connect` (L593,
  L645, L743–746), `session.js` L803–822 (`serialize` per `hello`), and
  `protocol/src/index.js` L59–61. All are taken. No decision changes.

| # | Finding | Severity | Where it went |
|---|---|---|---|
| M1 | `scriptRunner: 2` breaks the hello to older servers (cross-origin) | Must-fix | **Confirmed by `p4`, and older than 4c** (P23): 4b-2's `1` is already refused by pre-4b-2 servers, and DEV→PROD is cross-origin. AC4 (the connect option, absent by default), AC6 (`connectNow` only), the rule for later rounds; frozen-schema fixtures and the hello test, proofs (j); browser check 13; DEV step 8 |
| S1 | `activate()`'s test conflated `session:ready` and `world:loaded` | Should-fix | §6 AC4: three states; proof (j2) |
| S2 | The held-load test's setup order | Should-fix | §6 AC5: the five steps, visitor first, because `serialize` is shared (`session.js` L812–814) |
| N1 | `script-ready` validated in both directions | Nit | AC1: in the direction list, compiled `:client` only; §6 AC1 |

