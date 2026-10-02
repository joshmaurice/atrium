# Pre-brief: world visibility toggle + server-sent failure reasons (Step 9)

Status: **FINAL, Revision 1 (2026-10-01). All decisions (V1–V9) are
confirmed by the human,** including the proposals in V3, V4, V6, V7, V8
and V9. §5's open questions go to the brief author with their stated
recommendations. Ready for the brief/critic pipeline once this file is
uploaded to `devtasks/`.

V1 restates code that already shipped in Step 4; it isn't a new decision.
Strict destination resolution is confirmed out of scope (§4).

**Correction to the Step 8 passdown (§7.1):**
- **What the passdown says:** `worlds.visibility` is still locked by
  `CHECK (visibility = 'private')`, so this task needs a DB migration.
- **What's actually true:** Step 4 (`de26d8b`, 2026-09-17) already
  shipped the migration, the API and the admission rules (§2.1).
- **What that leaves:** this task has **no database migration**. The
  toggle half is client-only, apart from one small list field (V7).

**Inputs:**
- `devtasks/Atrium-Passdown-2026-10-01-step8-ui-polish.md` §7.1;
- `devtasks/Atrium-Passdown-2026-09-30-step7-teleporters.md` §6.3 and §6.4;
- `devtasks/ADDENDUM-user-accounts-phase2.md` §5 (visibility) and §7
  (failure visibility, cross-origin anonymity, invariants);
- `devtasks/PREBRIEF-ui-polish.md` (U1–U3: the failure panel and its
  wording helpers).

This is input for the brief-writing step. It is not the brief itself.

**Code facts:**
- **Verified at:** `main` `d6bebb6`. Its runtime code is identical to the
  released `c441b125`; the two commits since add only the Step 8 passdown.
- **Line numbers:** approximate.
- **Implementation base:** a freshly fetched `origin/main` at kickoff,
  never a SHA quoted here.

## 1. Goal

1. **A public/private switch per world in the My Worlds list,** including
   the home world. The default stays private.
2. **When a world server refuses a connection, it says so,** so the client
   can tell "the server answered and refused" apart from "the server didn't
   answer". The refusal still doesn't reveal whether the world exists.
3. **A switch to private takes effect immediately.** Non-owners already
   inside are disconnected, with a message saying why.
4. **Every connect surface shows the reason:** teleports and Go back, My
   Worlds Load, and manual Connect.

**Layers touched:**
- `@atrium/protocol`: the error code enum;
- `packages/server`: the registry, session handling, the world host, and
  the HTTP worlds routes;
- `apps/client`: `app.js`, `index.html`, the failure-wording module and
  their tests.

**`@atrium/client` is not changed.** **No DB migration.**

## 2. Verified facts

### 2.1 Already shipped in Step 4 (server)

- **Migration v4** (`db.js:128`) rebuilds `worlds` with
  `CHECK (visibility IN ('private','public'))`. **Default `'private'`.**
- **Creation defaults:**
  - new worlds are private (`world-store.js` `createWorld`, ~L59);
  - home worlds are private (`home-world.js` ~L39).
- **`PUT /api/worlds/:id` accepts `visibility`** (`http-routes.js`
  ~L664–804). It:
  - returns 400 for a value other than `private`/`public`;
  - returns **403 "The commons world must remain public"** for the root
    world (~L771);
  - **explicitly allows** a home world to go public (comment ~L776);
  - is owner-only, because `updateWorld` matches
    `id AND owner_user_id`, and a non-owner gets 404 (`world-store.js`
    ~L84);
  - requires the same origin (`isOriginAllowed`) and a login cookie.
- **Admission** (`world-registry.js`): a private world admits only its
  owner. That means anonymous visitors **and other logged-in users** are
  both refused. It's enforced for:
  - `/worlds/<user>/<slug>` and its `/public/` alias (~L355–363), with a
    re-check in case the owner flips visibility while the host is still
    being created (~L396–406);
  - `/ws/<id>` (~L207–224).
- **`/home/<uuid>/home`** admits only the matching logged-in user
  (~L232–260).
- **The commons row must be public.** Boot refuses a non-public commons
  row (`commons.js` ~L97).
- **Tests already cover:** the toggle round trip, cross-user PUT (404),
  commons-to-private (403, `commons.test.js` ~L765), and private refusal
  on every path (`world-crud.test.js` ~L1110–1300).

### 2.2 What's missing on the client

- **No visibility UI exists.** The only client read of `visibility` is the
  "(private)" suffix in the teleporter destination dropdown
  (`app.js` ~L1198).
- **`renderWorldList`** (`app.js` ~L172) builds each `.wb-item` from:
  - `.wb-info` (the name, plus the slug and an age);
  - a Load button;
  - a Delete button.

  CSS is in `index.html` ~L230–255. `#world-browser` holds `#wb-error` and
  `#wb-list` (~L433).
- **The list is sorted `ORDER BY updated_at DESC`** (`world-store.js`
  ~L18). Every PUT bumps `updated_at`, so **a toggle moves that world to
  the top.**
- **A PUT on a live world also saves it.** When the world has a live host,
  PUT serializes the live document and writes it alongside the metadata
  (`http-routes.js` ~L703–722). Toggling a loaded world is therefore also
  a save.
- **The list can't identify the commons.** The operator's commons row
  appears in their own list, but `GET /api/worlds` (~L519) returns only
  `id, slug, name, visibility, updated_at`. The client must not identify
  the commons by slug or id itself (ADDENDUM §7 invariant), so it needs a
  field from the server (V7).

### 2.3 How refusals look today

- **Every refusal is an HTTP status written to the raw socket** before the
  WebSocket handshake (`sendHttpResponse`, `world-registry.js` ~L137). The
  sites are:
  - **an unresolvable path** (e.g. `/hi`): 404 (~L176);
  - **unknown user, unknown slug, private and not the owner, or a
    home-path mismatch or anonymous home request**: 404 (~L217–223,
    ~L243–272, ~L330–362, ~L405);
  - **`/ws/<id>` with no live host**: 404 "World Not Found" (~L200);
  - **server-side failures:**
    - commons host missing: 404 (~L184);
    - host creation failed: 404 (~L316, ~L439);
    - host missing after creation: 404 (~L283, ~L393);
    - degraded-mode commons slug: **503** (~L377).
- **The 404 bodies differ** ("Not Found" vs "World Not Found"). The
  difference is invisible to a browser today, but it must not carry over
  into anything the client can read.
- **A browser can't read the status of a failed upgrade.** It gets an
  `error` event and a 1006 close. `AtriumClient` turns that into
  "WebSocket error connecting to <url>" (`AtriumClient.js` ~L465).
- **So today the client can't tell a missing or private world from a
  server that's down.** That's why U3's wording says "may not exist, or
  the server may not be reachable".
- **No upgrade rate limiting exists.** The only limiter is on the auth HTTP
  routes (`http-routes.js` ~L150).

### 2.4 The existing in-band error path

- **Precedent:** `WORLD_FULL` is sent as an `error` message followed by
  `ws.close()` (`session.js` ~L256), and so is `SESSION_CONFLICT` (~L267).
- **`AtriumClient` handles an `error` message at any time, including
  before the server's `hello`** (`AtriumClient.js` ~L433–440). It emits
  `error` with `err.code`, `err.url` and `err.sessionId`, and
  `err.message = "<CODE>: <message>"`. The close then emits
  `disconnected`.
- **`trackConnect`** (`app.js` ~L819) settles on the first `error` or
  `disconnected` for its session id. **It passes only `value.message` to
  `onError`** (~L863), so callers can't see `err.code` today.
- **The protocol enum is out of date.** `error.json`'s `code` enum lacks
  `SESSION_CONFLICT`, which the server already sends. Nothing validates
  outbound errors (`sendError`, `session.js` ~L22), and the client doesn't
  validate inbound ones.
- **The browser drops close codes.** `AtriumClient` attaches `onClose` with
  `addEventListener` (~L485), so it receives a `CloseEvent`, not
  `(code, reason)`. `typeof code === 'number'` is then false, so
  `disconnected.code` and `closeReason` are always undefined in browsers;
  only Node's `ws` gets them. **No app code reads them today.** This is why
  V3 doesn't use close codes as the contract.

### 2.5 Sessions and eviction mechanics

- **A host's `sessions` map gets an entry only at `hello`**
  (`session.js` ~L295–311). `session.userId` is the upgrade's resolved user
  id, or `null` for anonymous and cross-origin visitors.
  - A socket that has been upgraded but hasn't sent `hello` yet isn't in
    `sessions`. Its `upgradeUserId` lives only in the connection closure
    (~L232).
- **`ws.on('close')` runs `cleanupSession`** (~L639): it removes the
  avatar, then broadcasts `remove` and `leave`.
- **The world host exposes** `sessions`, `wss`, `ownerUserId` and
  `handleUpgrade` (`world-host.js`). `close()` terminates every session.
- **The PUT route can reach the live host** via `getWorldForId`
  (`http-routes.js` ~L139, wired in `index.js` to
  `registry.getWorldHost`).
- **Owner identity is by user id on the same origin only.** A logged-in
  owner who visits their own world from another origin is anonymous there
  (ADDENDUM §7), so to the server they're a non-owner.

### 2.6 Failure surfaces today

| Entry point | Code | Surface |
|---|---|---|
| Teleport | `app.js` ~L344–392 | Failure panel, `teleportFailureMessage(worldUrl)`; `onError`'s `msg` is ignored |
| Go back | ~L362–380 | Panel, `{ returning: true }`, no second Go back |
| My Worlds Load | ~L216–222 | `#wb-error`: `'Load failed: ' + msg` |
| Manual Connect | ~L952–956 | `#overlay`: `'Connect failed: ' + msg` |
| Home auto-connect | ~L498–515 | Calls `client.connect` directly; **reports nothing** |

- **The panel stays up across the failure's own `disconnected`.** U2's
  rule says only `hideTeleportFailurePanel()` hides it, so the
  `disconnected` handler (~L629) doesn't.
- **The app-level `error` listener** (~L641) only logs.

### 2.7 Testing facts (verified at `d6bebb6`, Node 22, after `pnpm install`)

- **Baseline results** (all files exit on their own, no force-exit):

  | Suite | Tests |
  |---|---|
  | `apps/client`, `node --test tests/*.test.js` | 151 pass |
  | `packages/server/test/world-crud.test.js` | 72 pass |
  | `packages/server/test/home-world.test.js` | 15 pass |
  | `packages/server/test/commons.test.js` | 19 pass |
  | `packages/protocol` | 57 pass |

- **Tests asserting upgrade-time 404s:**
  - `world-crud.test.js` ~L1110–1300 (`statusCode` 404);
  - `home-world.test.js` ~L398, ~L435, ~L464 (`unexpected-response`);
  - `commons.test.js` ~L913, ~L988.

  Every one that covers an admission refusal **changes deliberately**
  under V3. Server-failure cases keep their HTTP assertions (V4).
- **`packages/protocol/test/validate.test.js` ~L129** validates a
  `WORLD_FULL` error. It's the pattern for the new codes.
- **Test ports are crowded and not fully listed** in AGENTS.md (ports seen
  in tests include 3000–3020, 3060–3061, 3117, 3183–3184 and 3991–3992).
  Prefer extending existing files. A new file needs a grep-verified unused
  port, and an AGENTS.md table entry.
- **The deploy runs server test files individually** under `timeout 180`,
  and `apps/client` with no force-exit (Step 8 passdown §5). Any new
  WebSocket server (V3) must be closed by the registry's `close()`, or test
  files will hang.

## 3. Decisions

**V1. Visibility semantics, as already implemented (no change).**
- **Private:** only the owner is admitted, and only on the same origin.
  Anonymous visitors and other logged-in users are refused alike.
- **Public:** anyone is admitted, including anonymous and cross-origin
  visitors.
- **Every world can be toggled, including home. The commons can't be
  made private (403). New and home worlds default to private.**
- **Admission rules aren't changed in this task.** Only how a refusal is
  delivered changes (V3), and the new eviction (V5).

**V2. One reason for every admission refusal.**
- **Every refusal decided by admission gets the same reason:**
  - an unresolvable path;
  - an unknown user or slug;
  - a private world and a non-owner;
  - a home-path mismatch, an anonymous home request, or a missing home
    row;
  - `/ws/<id>` with no live host, or private and not the owner.
- **Identical bytes:** the same code, the same message text and the same
  close code, whichever of these applied.
- **Code `WORLD_UNAVAILABLE`, message `"World not available"`.** The
  client's wording reads "doesn't exist, or it isn't public" (V8).
- **Why:** distinguishing private from not-found would let anyone probe
  which user and slug pairs exist. One reason still answers the real
  question ("the server answered and refused"), which today's message
  can't.
- **Timing differences** between the refusal paths (one DB query or two)
  exist today too, and are out of scope.

**V3. Delivery channel: complete the upgrade, send an `error` message, then
close.**
- **A refusal socket:** for each V2 refusal, the registry completes the
  WebSocket handshake on **its own** `WebSocketServer({ noServer: true })`,
  never on any world host's `wss`. It then:
  - sends `{ "type": "error", "code": "WORLD_UNAVAILABLE", "message":
    "World not available" }`;
  - closes with **1008** (policy violation).
- **It never becomes a session:**
  - it never reaches `attachSessionHandlers`, creates or loads a host,
    cancels a teardown, or appears in any presence;
  - inbound messages (including `hello`) are ignored;
  - if the peer doesn't complete the close handshake promptly, the socket
    is terminated (Q-refusal-timeout).
- **Admission order is unchanged.** Every check that today precedes a
  404 still runs first. The refusal replaces only the final
  `sendHttpResponse` call at those sites.
- **The registry's `close()` closes the refusal server** and terminates
  any refusal sockets, so test files exit on their own (§2.7).
- **Protocol:** add `WORLD_UNAVAILABLE` and `WORLD_NOW_PRIVATE` (V5) to the
  `error.json` enum, and add the missing `SESSION_CONFLICT` (§2.4), with
  validator tests, in one commit (AGENTS.md rule 1). No other message
  changes.
- **Why an `error` message and not a 4xxx close code:**
  - `AtriumClient` already delivers in-band errors to the app before
    `hello`, with no `@atrium/client` change;
  - close codes are lost in browsers today (§2.4).

  The 1008 close code is informational: no client logic depends on it.
- **Malformed upgrades** (no `Upgrade: websocket` header, an unparsable
  URL) still just destroy the socket.
- **Compatibility:**
  - a server without this change still refuses with HTTP, so the client
    must fall back to today's wording when no code arrives (V8);
  - an older Atrium client connecting to an upgraded server would show
    `"... WORLD_UNAVAILABLE: World not available"` through its existing
    `msg` paths. That's acceptable.

**V4. Server-side failures keep their HTTP status.**
- **Which ones:** commons host missing (~L184), host creation failure
  (~L316, ~L439), host missing after creation (~L283, ~L393), and the
  degraded-mode 503 (~L377). These keep `sendHttpResponse` and their
  current status.
- **Why:**
  - they aren't refusals: the world may exist and the visitor may be
    allowed;
  - "doesn't exist or isn't public" would be wrong for them;
  - each happens only after the visitor has passed admission, so the
    distinction leaks nothing.
- **What the client shows:** today's generic message.

**V5. Switching a world to private disconnects non-owners already inside.**
- **When:** after a successful `PUT` that sets `visibility: 'private'`,
  and only after the DB write. That way any reconnect hits the new row,
  through admission and the existing re-check (~L396–406).
- **What:** if the world has a live host, the server disconnects every
  connection whose user id isn't the host's `ownerUserId`. Each gets
  `{ "type": "error", "code": "WORLD_NOW_PRIVATE", "message": "This world
  is now private" }`, then a 1008 close.
  - **This covers sockets that haven't sent `hello` yet** (§2.5). Track
    each connection's `upgradeUserId` per socket in
    `attachSessionHandlers`, and expose e.g. `evictNonOwners()` from the
    session handlers through the world host.
  - **Sessions** go through the normal close path, so `cleanupSession`
    removes their avatars and broadcasts `remove` and `leave` to the
    owner's clients as usual.
- **Who's affected:**
  - **the owner's own sessions are never disconnected;**
  - **a cross-origin owner is anonymous there, so they are disconnected.**
    That's consistent with V1.
- **Out of reach:** the commons can't become private (403), and
  unowned/degraded hosts can't be PUT. So eviction never applies to them.
- **No-ops:** a world with no live host, and a switch to public.
- **The PUT response is unchanged.** Whether to report how many visitors
  were disconnected is Q-evict-count.

**V6. The toggle in My Worlds (placement, scope and default from Step 7
§6.3).**
- **Markup:** one switch per `.wb-item`, between `.wb-info` and Load. It's
  a real `<input type="checkbox" role="switch">` inside a `<label>`, with
  visible text **"Public"** or **"Private"** showing the current state.
  Colour is never the only signal.
- **On change:**
  1. disable the switch;
  2. `PUT /api/worlds/<id>` with `Content-Type: application/json` and
     `{ "visibility": "public" | "private" }`, the same fetch shape as
     Create (~L1433);
  3. on success, call `refreshWorldList()`;
  4. on failure, restore the switch's previous state and show
     `data.error || "Couldn't change visibility"` in `#wb-error`. A 401 is
     handled as `refreshWorldList` already does it (`setAuthState(null)`).
- **The commons row** (V7) shows its switch checked, disabled, with a
  `title` of "The commons is always public".
- **No confirmation dialog on switching to private** (Q-confirm).
- **The list reordering after a toggle** (§2.2) is accepted
  (Q-updated-at).
- **Text** is set with `textContent`. World names already go through
  `escHtml`.

**V7. `GET /api/worlds` marks the commons.**
- **The field:** each row gains `isCommons: true` or `false`, true exactly
  when `row.id === getRootWorldId()`. It's computed in the route, not
  stored.
- **Why:** the client needs this to lock the commons switch without
  holding the commons slug or id (ADDENDUM §7 invariant).
- **Tests:** existing list assertions use `find(...)` plus field checks
  (`world-crud.test.js` ~L236), so an added field breaks nothing. Confirm
  that against every list test.

**V8. Client wording and surfaces.**
- **One pure, tested helper** in `apps/client/src/teleport-failure.js`
  maps a code to a reason sentence:
  - `WORLD_UNAVAILABLE` → **"That world doesn't exist, or it isn't
    public."**
  - `WORLD_NOW_PRIVATE` during a connect → **"Its owner has just made it
    private."**
  - any other or missing code → no reason sentence (the caller keeps
    today's text).

  `teleportFailureMessage` gains an optional `code`.
- **`trackConnect` passes the error object as a second argument:**
  `onError(msg, err)`. Existing callers keep working. **The raw
  `err.message` (`"CODE: message"`) is never shown when the code is
  known.**
- **Messages per surface, when a known code arrives:**

  | Surface | Message |
  |---|---|
  | Teleport (panel, Go back shown as today) | "Couldn't open `<dest>`. That world doesn't exist, or it isn't public." |
  | Go back (panel, no Go back) | "Couldn't return to `<dest>`. That world doesn't exist, or it isn't public." |
  | My Worlds Load (`#wb-error`) | "Load failed: That world doesn't exist, or it isn't public." |
  | Manual Connect (`#overlay`) | "Connect failed: Couldn't open `<dest>`. That world doesn't exist, or it isn't public." |

  With no known code, every surface keeps today's text exactly. That
  includes an unreachable server, a timeout, an older Atrium server and a
  non-Atrium server.
- **`<dest>`** is U3's `formatDestination` output for the resolved URL:
  the host in full, a percent-encoded pathname, and "the commons on
  `<host>`" for `/`.
- **Eviction message:** when `WORLD_NOW_PRIVATE` arrives for a session
  that already reached `session:ready`, an app-level `error` listener
  shows the failure panel: **"`<dest>` was made private by its owner, so
  you've been disconnected."**
  - **Buttons:** Dismiss only, no Go back.
  - **`<dest>`** comes from `err.url`.
  - **No double handling:** before `session:ready`, `trackConnect` owns
    the error, so the app-level listener must ignore it. Track the ready
    session id. The panel survives the following `disconnected`, as U2
    already guarantees.
- **Home auto-connect stays silent.** Its owner is always admitted, so the
  reasons don't apply (§4).

**V9. Commit order (suggested).**
1. Protocol: the enum additions (V3) and validator tests.
2. Server: the refusal path (V2–V4), with the deliberate test updates
   (§2.7) and new tests.
3. Server: eviction (V5) and its PUT hook, with tests.
4. Server: `isCommons` in the list (V7), with a test.
5. Client: the wording helper and its tests (V8).
6. Client: `trackConnect`'s error argument, wiring on every surface, and
   the eviction listener (V8).
7. Client: the toggle (V6).
8. Docs: ADDENDUM §5 "What shipped (Step 9)", plus an AGENTS.md
   test-ports entry if a new port was added.

## 4. Out of scope

- **Strict destination resolution** (Step 7 §6.4, third bullet). Typo pads like `hi` now say "doesn't exist, or it isn't public",
  which is accurate.
- **Connect-before-leave** (Step 7 §6.4, second bullet).
- **Fixing `AtriumClient`'s browser close-code handling** (§2.4). Record it
  as a follow-up; V3 doesn't need it.
- **Any `@atrium/client` change.**
- **Upgrade rate limiting.** There's none today (§2.3), and V3 doesn't
  change what an anonymous script could already probe.
- **Failure reporting for home auto-connect** (§2.6).
- **A public-worlds directory** (ADDENDUM, out of scope for Phase 2).
- **Changing the teleporter dropdown's "(private)" suffix.**
- **Surface-raycast pad placement** and the other Step 8 §7.2 follow-ups.

## 5. Open questions for the brief author / critic

- **Q-refusal-timeout:** how long a refusal socket may wait for the peer's
  close before `terminate()`. Recommendation: a few seconds, and never
  longer than `ws`'s default.
- **Q-evict-count:** whether the PUT response reports how many visitors
  were disconnected. Recommendation: no. Keep the response shape
  unchanged.
- **Q-confirm:** whether switching to private asks "Visitors in this world
  will be disconnected". Recommendation: no confirmation. The owner can't
  see who's inside, and the action is reversible.
- **Q-updated-at:** whether a visibility-only PUT should leave `updated_at`
  alone, so the list doesn't reorder. Recommendation: accept the bump. A
  PUT on a live world is also a save (§2.2), so the timestamp is honest.
- **Q-switch-style:** the switch's styling within `.wb-item`'s compact
  layout.

## 6. Test expectations

**Adversarial-testing standard (this task has authority boundaries).** The
server decides who may enter and who may stay, so tests must include
cases where the client's view disagrees with the server's:
- **Indistinguishable refusals:** for an unknown user, an unknown slug, a
  private world seen by an anonymous visitor, a private world seen by
  another logged-in user, an unresolvable path, and `/ws/<id>` (unknown
  and private), assert the **byte-identical** first message and the same
  close code.
- **A refusal socket isn't a session:** send `hello` on a refusal socket.
  Assert no `hello` reply, no `join` or `add` delivered to sessions
  already in that world, no new host in `registry.hosts`, and a still
  pending teardown not cancelled.
- **Eviction can't be dodged:**
  - a non-owner session that keeps sending `view` after the switch is
    still closed, and its avatar is removed for the owner (`remove` and
    `leave` observed);
  - **a socket upgraded while public whose `hello` arrives after the
    switch** is closed and never becomes a session;
  - an anonymous connection is closed;
  - **the owner's own session survives,** including two owner sessions.
- **Ownership:** a non-owner's `PUT { visibility }` still returns 404 and
  disconnects nobody. Making the commons private still returns 403 and
  disconnects nobody.
- **Server failures keep HTTP:** at least one V4 path (e.g. forced host
  creation failure) still produces an HTTP status and no `error` message.

**Automated, run as the deploy does** (each server file individually under
`timeout 180`, no force-exit; `cd apps/client && node --test
tests/*.test.js`; protocol via `pnpm --filter`):
- **Protocol:** the new codes and `SESSION_CONFLICT` validate as server
  `error` messages; an unknown code still fails.
- **Server:**
  - the updated admission tests assert `WORLD_UNAVAILABLE` instead of an
    HTTP 404;
  - the V5 and V7 cases;
  - every file exits on its own (the refusal server is closed by the
    registry's `close()`).
- **Client helper:**
  - each code produces its sentence on every surface variant;
  - an unknown or missing code gives today's text exactly;
  - `"CODE: message"` never appears in output for a known code;
  - HTML-like characters in `<dest>` come back unchanged;
  - it never throws on `null` or garbage input.
- **Baselines** (§2.7) still pass, plus the new tests.

**Manual DEV acceptance** (two browsers or profiles; A is the owner, B is
anonymous or a second account):
- **Toggling:**
  - A switches a world to Public, and the switch says "Public" after a
    reload;
  - the home world can be toggled;
  - the commons row (on the operator's account) is locked public, with its
    tooltip.
- **Admission:**
  - B connects to the public world by `/worlds/<a>/<slug>`, and it works;
  - **A switches it to Private while B is inside.** B sees the eviction
    panel naming the destination, and A sees B's avatar disappear;
  - B reconnects with manual Connect and gets "Connect failed: Couldn't
    open … That world doesn't exist, or it isn't public."
- **Wording:**
  - **a pad in the commons pointing at the private world** shows the panel
    with the new reason, and Go back works;
  - a pad or Connect to a **non-existent slug** shows **the same text**;
  - Connect to a host that doesn't exist, or to a server without this
    change (e.g. PROD before its deploy), shows **today's generic text**.
- **Load:** a My Worlds Load of a world deleted in another tab shows
  "Load failed: That world doesn't exist, or it isn't public."
