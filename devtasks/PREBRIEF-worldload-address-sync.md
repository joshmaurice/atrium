# Pre-brief: "Load" should connect live; the World box should track the connection

Status: **All decisions (1–15) confirmed by the human, 2026-09-24. Ready for
the kanban pipeline.**

This is input for the brief-writing step (brief author, then critic). It is
not the brief itself.

Code facts were verified on `main` at `107bb36`. Files read:
- `apps/client/src/app.js`, `apps/client/src/wsUrl.js`, `apps/client/index.html`;
- `packages/client/src/AtriumClient.js`, `packages/client/src/AvatarController.js`;
- `packages/client/tests/client.test.js`;
- `packages/renderer-three/src/load-background.js`;
- `tools/som-inspector/src/app.js`, `tools/som-inspector/index.html`;
- `packages/server/src/{world-registry,session,http-routes,auth,index}.js`;
- `tests/fixtures/{space-ext,atrium}*`;
- `claude-sessions/SESSION-23-drag-drop.md`.

Line numbers are approximate.

## 1. Goal

Three related client bugs, one fix:

1. Clicking **Load** on a world in the My Worlds list should drop you into
   that world exactly as if you'd connected to it. That means your avatar,
   other live avatars, and a correct `World:` / `You:` / `Peers:` HUD, not a
   disconnected static preview.
2. **`AtriumClient` owns the authoritative "where am I connected" URL.** The
   connection box is synchronized to that URL after every successful
   connection, however it happened: home auto-connect, world-browser Load,
   manual Connect, and later, cross-connect. Today the box is labelled
   "Server:"; it becomes "World:" (#14). The box is editable, so text the
   user types there is a pending manual destination, not a claim about the
   current connection.
3. **A static world can no longer replace the SOM underneath a live
   connection.** Today, File Load and drag-and-drop while connected swap in
   the file's scene while the socket keeps applying and sending mutations for
   the server's world. This was deferred earlier "to be fixed holistically
   later", once the Load/Connect lifecycle was rationalized (§2). This task is
   that rationalization.

Supporting goals:
- Every URL-derived piece of connection state comes from the connection
  itself, not from a DOM input. That means the connect URL, the World box,
  and the base URL for resolving a world's relative assets.
- **Safely replacing one live world context with another** is a
  general-purpose primitive. No stale events, stale state, or stale async
  work from the old world may touch the new one. This fix is the first thing
  that needs it, and cross-server navigation will need it next.

## 2. Verified facts about the current code

### apps/client/src/app.js

- **Load path today.** The per-world Load button (`renderWorldList`,
  ~L178–204) fetches `/api/worlds/${w.id}`, then calls
  `client.loadWorldFromData(text, name)`. That's a **local, disconnected**
  render: no `hello`, no session, no avatar, and nobody else in that world
  can see you.
- **Load is disabled while connected, in two places.** This was a deliberate
  earlier decision (`devtasks/REVISION-client-ui.md`), so we're revisiting a
  decision, not fixing an oversight.
  - Per-item: `loadBtn.disabled = client.connected` when the list renders.
  - `setConnectionState('connected')` (~L349–353) disables every
    `.wb-item button:first-of-type` and sets its title to "Disconnect before
    loading a saved world". `setConnectionState('disconnected')` calls
    `enableWbLoadButtons()` (~L359, ~L365–373) to undo that. **If only the
    per-item check is removed, Load is still disabled the moment
    `session:ready` fires.**
- **The connection box (`wsUrlInput`) is set in two places:**
  - at page load (L16), from `computeWsUrl(window.location)`, which is the
    account-server origin;
  - in `loadAtriumConfig` (~L531), from a dropped `.atrium.json`'s
    `world.server`.

  Nothing updates it in response to an actual connection.
- **Home auto-connect builds its URL from the connection box.**
  `homeWorldWsUrl()` / `autoConnectToHomeWorld` (~L378–400) take the origin
  of `wsUrlInput.value`. So after dropping a `.atrium.json` that points at
  another server, auto-connect goes to the wrong host. A comment there
  describes this as "by design".
  - The correct base already exists: `computeWsUrl(window.location)`.
- `currentUser` already holds `{ id, username, displayName }`.
- **`app.js` keeps its own module-level `worldBaseUrl` for backgrounds**
  (~L497).
  - The `world:loaded` handler (~L419–425) re-derives it from
    `worldUrlInput.value` on every load, including WS-connected worlds.
  - It's used at ~L434 and ~L501.
  - When the field is empty, the base falls back to the page URL's
    directory. So a WS world's relative background resolves against the
    page's own directory, or against a stale dropped file.
- **`connectBtn` (~L620–637) sets `client.worldBaseUrl` by hand** from
  `worldUrlInput` before calling `connect()`. That's load-bearing for two
  dev fixtures:
  - `space-ext.atrium.json` pairs `./space-ext.gltf` (with relative source
    refs `./crate.gltf` and `./lamp.gltf`) with `server: ws://localhost:3000`;
  - `atrium.atrium.json` pairs `./atrium.gltf` (with a relative
    `skyboxtest1.png` background) with the same server.

  The Node server serves no static files, so without the manual set those
  relative refs have nothing to resolve against.
- **The `disconnected` handler (~L459–469)** clears labels, shows the
  disconnected UI, and resets `firstPerson`. If `worldUrlInput` is non-empty,
  it also statically reloads that file.
- **Toolbar** (`index.html` ~L316–319):
  - The first input (`#worldUrl`) has no label. Its placeholder is
    `.gltf or .atrium.json URL`, and it feeds the toolbar Load button, which
    does a local static load.
  - The connection box (`#wsUrl`) is labelled `Server:`, with placeholder
    `ws://...`.
  - The HUD's first line is `World: <name>` (`#hud-world`).
- **Name shadowing.** The per-item `const loadBtn` in `renderWorldList`
  shadows the toolbar `loadBtn` (L17).
- **Static loads don't check `client.connected`.** There are three entry
  points, and all of them replace the local SOM whether or not a connection
  is live:
  - the toolbar Load (~L598–618) calls `client.loadWorld()`, or goes through
    `loadAtriumConfig()` for a `.json` file;
  - `loadAtriumConfig` (~L510) calls `client.loadWorld()` when the config
    has a `world.gltf`;
  - viewport drop (~L579) goes through `loadDroppedFile` (~L541) to
    `loadWorldFromData()` or `loadAtriumConfig()`.

  The socket's later `set` / `add` / `remove` / `view` traffic then applies
  to, or comes from, a SOM that doesn't match the server's world.
  `claude-sessions/SESSION-23-drag-drop.md` records "Drop while connected" as
  deferred, to be "fixed holistically later". Its handoff doc says the same
  for Load-while-connected and suggests auto-disconnecting or prompting.

### tools/som-inspector

- It uses the same pattern as `apps/client`:
  - `connectBtn` (~L438–447) sets `client.worldBaseUrl` from its World URL
    field, then calls `connect()`;
  - it keeps a module-level `worldBaseUrl` (L72), re-derived from
    `worldUrlInput` in `world:loaded` (~L220–223);
  - `loadBackground` is called with it at ~L84, ~L253 and ~L304.
- Its `disconnected` handler (~L270) also reloads statically from the field.
- It has the same three unguarded static-load entry points: toolbar Load
  (~L406), `loadAtriumConfig` (~L318) and viewport drop (~L387).
- The toolbar (`index.html` ~L544–548) has the same unlabeled first input and
  the same `Server:` label. `#wsUrl` has the default value
  `ws://localhost:3000`.

### packages/client/src/AtriumClient.js

- **`connect(wsUrl, { avatar, displayName })` (~L216):**
  - calls `this.disconnect()` if `this._ws` exists;
  - generates a **fresh `sessionId`** (`crypto.randomUUID()`) on every
    call;
  - sets `_sessionId`, `_displayName`, `_avatarNodeName` and
    `_avatarDescriptor`;
  - creates the socket and stores it in `this._ws`;
  - returns nothing.

  The `sessionId` is sent in `hello`, and `session:ready` already exposes it.
- **The socket callbacks don't check which connection they belong to.**
  - `onOpen`, the `dispatch` message handler, `onError` and `onClose`
    (~L236–286) all act on `this`.
  - `onClose` sets `_connected = false` and `_ws = null`, then emits
    `disconnected`.
  - `disconnect()` (~L294) calls `ws.close()`, and the close event arrives
    later.

  So if a new connection starts before an old socket's close arrives, the
  old socket clobbers the new connection's state. That holds whether the new
  connection starts inside `connect()` or right after an explicit
  Disconnect. Late messages and errors from the old socket also land on the
  current state. Nothing triggers this in normal use today, because Connect
  and auto-connect never replace a live connection. This fix makes
  replacement a single click.
- **`disconnect()` (~L294)** closes the socket and clears `_ws`, then
  synchronously sets `_connected = false`, clears `_viewFlushTimer`, and
  calls `_clearPointerState()`. So `client.connected` is already false while
  the close is still in flight.
- **`connect()` supersedes an old connection by calling `this.disconnect()`,
  which is what closes the old socket.** Any restructuring for #9 must keep
  that close. Otherwise the old socket stays open, the avatar stays in the old
  world, and the old world's occupants never see it leave.
- **The `disconnected` event from `disconnect()` is asynchronous, and code
  depends on that.**
  - `client.test.js` ~L156 registers its wait before calling `disconnect()`.
  - ~L152–153 registers it *after*, which only works because the event
    fires later.
  - The Bug A logout fix (`9eab59f`) relies on the normal disconnected
    transition.
- **`new WebSocket(url)` can throw synchronously** on a malformed or
  unsupported URL. That happens in both the browser and the `ws` package. The
  exception currently propagates out of `connect()` after the session and
  avatar fields have already been overwritten. Network failures, by
  contrast, arrive asynchronously.
- **`_peerSessions` (L91) is created once and never cleared.**
  - `peer:join` adds to it (~L510) and `peer:leave` removes from it
    (~L516).
  - The server (`session.js`) sends `hello` (~L309), then each existing
    peer's `join` (~L323–350), then `som-dump` (~L379). So B's peer joins
    arrive *before* B's `som-dump`.
- **Async world work doesn't check whether its world is still current:**
  - `_onSomDump` (~L369) awaits `io.readJSON`, then runs `_initSom` and
    `resolveExternalReferences()`;
  - `loadWorld` (~L311) and `loadWorldFromData` (~L324) await document
    reads before committing;
  - `_loadExternalRef` (~L733) awaits `this._fetch`, the response body, and
    a document read, then calls `this.som.ingestExternalScene(...)` and
    emits `world:loaded`.

  Any of these can finish after the client has moved on. For example, A's
  `crate.gltf` could land in B.
- **Other per-connection state on the client** that a connection change has
  to account for:
  - view throttling: `_pendingView`, `_viewFlushTimer`, `_lastSentAt`, and
    the view/send sequence counters. A pending view flush timer from A could
    otherwise fire into B.
  - `_applyingRemote`;
  - pointer state (`_pointerDownTarget` and whatever `_clearPointerState()`
    resets);
  - `_navInfo`, which is world-scoped and set from the document at ~L780.
- **`fetch` and `WebSocket` are injectable** through the constructor
  (`{ WebSocket, fetch }`, L69–73).
- **`_worldBaseUrl` is never set in the WS connect path.**
  - `resolveExternalReferences` (~L715) does nothing while it's null.
  - `loadWorld` sets it to the file's directory *before* its `await`.
    `loadWorldFromData` sets it to null, and an existing test asserts that
    no-op.
  - Errors from `loadWorld`'s read propagate to the caller. The toolbar Load
    shows them as "Load failed: …".
  - Resolution uses `new URL(source, base)` and then `fetch`, so the base
    must be `http(s)`.
  - A failed reference fetch logs a warning and isn't fatal.
  - The comment in `_onSomDump` about "the original loadWorld call" is
    stale.
  - The setter's JSDoc (~L202–208) describes the manual set as the
    connect-only mechanism.

### packages/client/src/AvatarController.js

- It listens for `disconnected` (L78). `_onDisconnected` (~L129) clears
  `_localNode`, `_cameraNode`, `_peers` and `_lastSentView`.
- `_shouldSend` compares each view update against `_lastSentView`. So if
  those fields survive into another world, `Peers:` is wrong, and the new
  world's first view update can be suppressed.
- The only listeners for lifecycle events in the repo are
  `AvatarController`, `apps/client/src/app.js` and
  `tools/som-inspector/src/app.js`, plus tests.

### packages/renderer-three/src/load-background.js

- It computes `new URL(bg.texture, baseUrl)`.
  - **An empty-string base throws `Invalid URL`, even when the texture URL
    is absolute.**
  - An `undefined` base works for absolute URLs.
- Neither app passes an empty string today, because both fall back to the
  page directory.
- The `TextureLoader.load` success callback always sets
  `threeScene.background` and `environment`. So a texture that finishes
  loading late overwrites whatever background was set after it was
  requested.

### Server side

- **`/public/<username>/<slug>`**:
  - handled by `world-registry.js`, `resolveWorldId` (~L53), in the
    `/public/` branch (~L86, and the handling at ~L292–345);
  - looks up the username (`COLLATE NOCASE`), then `(owner_user_id, slug)`;
  - creates the world's host lazily;
  - admits the owner even to a *private* world, so the name `/public/`
    describes an access policy the route doesn't actually enforce.
- **`/ws/<id>`** doesn't create a host lazily. **Don't use it for Load**:
  most worlds have no live host until someone joins.
- **Live hosts are keyed by world row id.** Any two paths that resolve to
  the same row reach the same live room.
- The world list includes each user's `home` world.
- **Path segments are never percent-decoded.** The upgrade handler uses
  `new URL(request.url, …).pathname` (~L139), which keeps escapes, and the
  raw segments are matched against the DB.
- **Neither usernames nor slugs are restricted.**
  - `normalizeUsername` (`auth.js` ~L93) allows spaces.
  - World create/update (`http-routes.js` ~L564, ~L711) accept any
    non-empty slug except `home`.
  - So `/public/` addressing is already broken for any name that needs
    encoding.
- **Exact `.` and `..` segments can't be addressed at all.** The WHATWG URL
  parser normalizes `.`, `..`, `%2e`, `.%2e` and `%2e%2e` away as dot
  segments, so no encoding can carry them. Today's validation allows them.
- `/public/` appears in:
  - 37 places across `world-crud.test.js` and `commons.test.js`;
  - comments in `world-registry.js` (~L331) and `http-routes.js` (~L757);
  - the design docs.

  Nothing on the client builds `/public/` URLs.
- **Deployment.**
  - The Node server serves only `/api/*` and WebSocket upgrades.
  - Caddy serves the client's static files on the same origin, and 404s
    everything else.
  - Caddy sends WebSocket traffic to Node using a **header-based**
    `@websocket` matcher, not by path
    (`DEPLOY-and-handoff-notes-2026-08-25.md`).
  - Nobody has tested whether Caddy passes an encoded `%2F` through to Node
    unchanged.
- **Prod content:**
  - the commons runs `WORLD_PATH=…/space.gltf`, which has no background and
    no `source` refs;
  - home worlds start with an empty skybox;
  - the only fixture with a relative background is the dev-only
    `atrium.gltf`.

## 3. Decisions

1. **Load performs a real connect.**
   - Add `buildWorldWsUrl(baseUrl, username, slug)` to `wsUrl.js`. It:
     - is pure;
     - keeps only the origin of `baseUrl`;
     - builds the canonical `/worlds/<username>/<slug>` path (#13);
     - passes `username` and `slug` through `encodeURIComponent`, which is
       paired with #10: neither ships without the other.
   - `baseUrl` is `accountWsBase` (#2).
   - Load drops its `fetch('/api/worlds/:id')`; the WS `som-dump` delivers
     the document.
2. **Account-server URLs come from `accountWsBase`, not the connection
   box.**
   - Capture `computeWsUrl(window.location)` once at startup as
     `accountWsBase`.
   - Home auto-connect builds from it.
   - Rewrite the "by design" comment.
   - Manual Connect keeps using the box's value, because that's the one path
     where the user is telling us the URL.
3. **Load works whether or not you're connected.**
   - Remove **both** mechanisms that disable it:
     - the per-item `client.connected` check;
     - the mass-disable in `setConnectionState('connected')`, together with
       `enableWbLoadButtons()` and its call site.
   - A button may still be disabled while its own Load is in progress.
   - Loading while connected replaces the current connection (#9).
   - Use `overlayEl` for feedback while loading.
4. **`AtriumClient` is the source of truth for its connection state.**
   - Each connection record holds that connection's args (`url`, `avatar`,
     `displayName`, `worldBaseUrl`) and its `sessionId`. There is no single
     mutable `_connectArgs`: a late callback must never read a newer
     connection's args.
   - `session:ready` adds `url`, taken from the record whose socket
     delivered the `hello`.
   - `app.js` has **one** listener that syncs the box:
     `client.on('session:ready', ({ url }) => { wsUrlInput.value = url })`.
     No call site needs to know the box exists.
   - The box is updated only on success, never when a connect merely
     starts.
   - Why this belongs on the client rather than in `app.js`:
     reconnect-on-drop, teleporters and cross-connect all need "where did I
     connect, with what", and so do error logs. Multiple `AtriumClient`
     instances also each need to report their own connection.
5. **Leave the home-world entry in My Worlds as-is.** Load on it connects
   via `/worlds/<username>/home`, which is equivalent to auto-connect.
6. **`connect()` always sets `_worldBaseUrl`. An explicit value wins;
   otherwise it's derived from the connect URL.**
   - `connect(…, { worldBaseUrl })` accepts an optional explicit base.
   - Otherwise the base is the **connect URL's own origin** (the world
     server's origin, not the account server's), with `ws:`→`http:` and
     `wss:`→`https:`, plus a trailing `/`. The two are the same server in
     this task. Cross-connect to server B must derive `https://B/`.
   - The derivation is a pure, unit-tested helper: an unparseable URL gives
     null, and the helper never throws.
   - **Don't derive the base unconditionally.** That would overwrite the
     explicit base that the `space-ext` and `atrium` dev flows depend on
     (§2).
   - Both `apps/client`'s and `tools/som-inspector`'s `connectBtn` pass
     `worldBaseUrl` from their World URL field when it's non-empty, instead
     of calling the setter. The setter call would now be overwritten.
   - Auto-connect, Load and future cross-connect never pass it.
   - Keep the setter, and update its JSDoc and the stale `_onSomDump`
     comment.
   - **Intended behavior change:** in a server-stored world, a relative
     `source` ref now tries to load from the world server's origin, 404s,
     and logs a warning. Today it's silently skipped.
7. **Background base URLs come from `client.worldBaseUrl`.**
   - In both `apps/client` and `tools/som-inspector`, replace the module
     variable derived from `worldUrlInput` with the client's base, at every
     `loadBackground` call site listed in §2.
   - Pass the base through as-is, including null. **Don't coerce it to
     `''`**, which throws even for absolute textures. #12 makes
     `loadBackground` handle a missing base.
   - **Intended behavior change:** a WS world's relative background now
     resolves against the world server's origin (`/`) instead of the page
     directory (`/apps/client/`). No prod world has one. The dev fixtures keep working,
     because manual Connect passes their own URL.
8. **Hygiene in the code this fix touches.**
   - Rename the per-item `loadBtn` in `renderWorldList` (e.g. to
     `itemLoadBtn`).
   - Update every comment and JSDoc that the decisions above make untrue.
   - Update any hint text, tooltips or docs that refer to the "Server" box.
9. **Connection lifecycle: only the current connection may act, and
   starting a connection is an explicit event.**
   - **Current connection.**
     - Each `connect()` creates a record and makes it current synchronously,
       before anything else.
     - `disconnect()` ends the current record.
     - A record is **stale** as soon as a newer `connect()` has been called.
   - **Stale records are inert.** Every callback captures its own record and
     does nothing if that record is stale. That covers `open`, every
     `message` (including a late `hello` or `som-dump`), `error` and
     `close`.
     - It also covers a pending `disconnected` from an explicit
       `disconnect()` that hasn't arrived when a newer `connect()` starts.
       That's the Disconnect-then-Connect case, not just replacement inside
       `connect()`.
     - The rule is about *which connection is current*, not what `reason` a
       disconnect carries.
   - **A superseded connection's socket is actually closed.** When
     `connect(B)` supersedes A, it makes B current, marks A stale, then calls
     `close()` on A's socket. A's eventual close callback is silent because A
     is stale. Being inert isn't enough: an unclosed A leaves your avatar in
     A, and its occupants never see you leave.
   - **Explicit `disconnect()` puts the record into a closing state.** The
     record stays current until its close callback arrives, or until a newer
     `connect()` makes it stale.
     - While closing, it ignores messages and errors.
     - Its one remaining effect is to emit the single `disconnected` event
       when the close arrives.
     - The record stops being current *before* that `disconnected` is
       emitted, so `disconnected` handlers see no live connection (#15
       depends on this).
   - **Explicit `disconnect()` with no newer connection is unchanged:**
     exactly one `disconnected`, still asynchronous (§2).
     - **Don't implement staleness as a bare `if (this._ws !== ws) return` in
       `onClose`.** `disconnect()` has already cleared `_ws` by the time the
       close arrives, so that guard would silence every explicit disconnect.
     - **Don't make `disconnected` synchronous either.** That breaks the test
       at ~L152.
   - **Every `connect()` synchronously emits
     `connecting { sessionId, url, previousSessionId }`** before creating the
     socket. `previousSessionId` is the connection being replaced, or null.
     - Before emitting it, the client resets all of its per-connection
       state: `_peerSessions`, `_connected`, the session/display/avatar
       fields, `_worldBaseUrl` (#6), the view-throttling state (cancel any
       pending flush timer), pointer state, and anything else the Q-state
       audit finds (§2 lists the known fields).
     - **Reset `_peerSessions` here, not in `_onSomDump`.** The new world's
       peer joins arrive before its `som-dump` (§2), so clearing it there
       would wipe them.
   - **Replacement emits `connecting`, never `disconnected`.** Consumers
     reset their per-connection state on `connecting`:
     - `AvatarController` does what `_onDisconnected` does today;
     - `apps/client` clears labels, shows the connecting UI, and resets
       `firstPerson`;
     - the inspector clears its panels.

     So a replacement never shows the disconnected UI or triggers the static
     reload, with no special cases in the `disconnected` handlers. The event
     name is the brief author's call. It must stay one explicit
     start-of-connection event, not an overloaded `disconnected`.
   - **`sessionId` is the connection id.** `connect()` returns the
     `sessionId` it generated. Don't add a separate attempt id without a
     concrete reason. Every per-connection event carries the `sessionId`:
     - `connecting`;
     - `session:ready`, which gains `url`;
     - `disconnected { sessionId, url, reason: 'client' | 'closed' }`;
     - `error`, which stays an `Error` object (consumers read
       `err.message`), with `sessionId` and `url` added as properties.
   - **A synchronous `WebSocket` constructor throw** is caught inside
     `connect()`.
     - It's reported as `error` followed by `disconnected` (with `'closed'`,
       or a distinct reason if the brief author prefers).
     - Both are emitted **asynchronously**, so a caller that registers
       listeners using the returned `sessionId` still receives them.
     - These scheduled events go through the same currentness check. If a
       newer `connect()` starts before they run, they're silent. "Only the
       current connection may act" covers the client's own scheduled
       lifecycle events, not just socket callbacks.
     - `connect()` never throws for this, still returns the `sessionId`, and
       leaves no half-updated state.
   - **Load's listeners match the `sessionId` from its own `connect()`
     call:**
     - `session:ready` means success;
     - `error`/`disconnected` means failure, so show `wbError`;
     - `connecting` with a `previousSessionId` equal to Load's id means the
       Load was superseded: treat it as cancelled, re-enable the button, and
       show no error.

     Remove the listeners in every one of those outcomes.
10. **World routes decode their path segments.**
    - In `resolveWorldId`'s username/slug branch (which serves both
      prefixes, #13), split on `/` first, then `decodeURIComponent` each
      segment. That way an encoded `%2F` stays inside its segment.
    - Malformed encoding (a `URIError`), or a segment that decodes to
      empty, returns null. That takes the existing 404 path. Nothing may
      throw out of the upgrade handler.
    - Reject usernames and slugs that are exactly `.` or `..`, using the same
      400 style those routes already use:
      - at registration, for usernames;
      - at world create and update, for slugs.

      **Encoding can't make these addressable** (§2). Existing rows, if any,
      stay unreachable, and aren't migrated here.
    - A stored name that literally contains `%XX` is now reached as `%25XX`.
      That's correct behavior, not a regression.
    - `/home/` and `/ws/` are unchanged.
    - Run server tests per file (see the gotcha in `AGENTS.md`).
11. **Async world work commits only if its world is still current.**
    - The client keeps an internal **world generation** counter. It goes up
      whenever the world context changes: `connect()`, `disconnect()`,
      `loadWorld()` and `loadWorldFromData()`. It does not go up on ordinary
      SOM mutations.
    - Async work captures the generation when it starts, and re-checks it
      **after every `await`** before committing:
      - `_onSomDump`: after `readJSON`, before `_initSom`;
      - `loadWorld` / `loadWorldFromData`: before `_finalizeWorldLoad`;
      - `_loadExternalRef`: before `ingestExternalScene`, and before
        emitting `world:loaded`.
    - Work from a changed generation is dropped silently; at most it's
      logged in debug mode.
    - **Failures are generation-scoped too, not just successes.** A
      rejection skips the post-`await` check, so every error path must check
      the captured generation too. If the generation is stale when an
      operation resolves *or* rejects, it produces no event, no
      user-visible error, and no normal-level warning.
      - `loadWorld` and `loadWorldFromData` then **resolve without
        effect** rather than reject, so a superseded File Load never shows
        "Load failed" over the world that replaced it. Whether they return a
        "superseded" indicator is the brief author's call.
      - A stale external-ref failure doesn't `console.warn`.
    - **Guarding only at message-dispatch entry isn't enough.** The world
      can change during an `await` inside the handler.
    - This also covers a static reload, started by a `disconnected` handler,
      racing a Load right after it.
    - It's kept separate from #9's connection record because static loads
      have no connection. The brief author may unify the two if the result
      stays clear.
12. **`loadBackground` handles a missing base and ignores textures that
    have been superseded.** The change is in `packages/renderer-three`, so
    both apps get it.
    - `baseUrl` becomes optional:
      - an absolute texture works without a base;
      - a relative texture with no base, or any URL that fails to parse,
        logs a warning and returns without throwing.
    - Each call records a per-scene request token (e.g. on
      `threeScene.userData`).
      - The success callback applies its texture only if its token is still
        the latest.
      - The `!bg?.texture` clear path also bumps the token.
      - So a slow skybox from world A can't overwrite world B's background,
        including B having no background.
    - Add renderer unit tests in `renderer-three/tests`.
13. **The canonical world route is `/worlds/<username>/<slug>`, and
    `/public/<username>/<slug>` stays as an alias.**
    - **Why:** the path should name the thing, not an access policy.
      `/public/` already admits owners to their private worlds, and
      visibility can change at any time. This fix is what starts showing
      these addresses to users, and cross-server connect will use them as
      world addresses. So it's cheapest to rename now, before people have
      seen and shared them.
    - **Server:**
      - `resolveWorldId` accepts both prefixes and produces the same
        descriptor.
      - Both then follow the same code path: username and row lookup, the
        private-owner check, the commons convergence check, and #10's
        decoding. There's no second copy of that logic.
      - Because hosts are keyed by row id, both prefixes reach the same live
        room.
      - Rename the internal descriptor `kind: 'public'` (e.g. to `'named'`)
        if it's cheap; that's the brief author's call.
      - Update the comments at `world-registry.js` ~L331 and
        `http-routes.js` ~L757.
    - **Client:** everything this fix builds uses `/worlds/`.
    - **Alias:** keep `/public/` so already-shared links keep working.
      - Leave the 37 existing `/public/` test uses alone; they now double as
        alias coverage.
      - Add `/worlds/` tests for the key cases (§6).
    - **Unchanged:** `/home/<userId>/home` and `/ws/<id>`.
    - **Deploy:** no Caddy change, because the WS matcher is header-based.
      DEV acceptance still confirms it.
    - **Docs:** add a one-line note to `docs/DESIGN-user-accounts.md` and to
      the addendum that mentions `/public/`: `/worlds/` is canonical and
      `/public/` is an alias. Historical devtasks files stay as they are.
14. **Toolbar labels: "File:" for the static-file input, "World:" for the
    connection box.**
    - **Why:** the connection box now holds a specific world's address.
      Labelling only one box "World:" would leave it ambiguous next to the
      unlabeled first input, which also takes a world URL but loads it
      locally. With both labels, the toolbar shows the address and the HUD's
      `World: <name>` shows the name.
    - In both `apps/client/index.html` and `tools/som-inspector/index.html`:
      - add `File:` before `#worldUrl`;
      - change `Server:` to `World:`;
      - set the connection box's placeholder to an example such as
        `wss://host/worlds/user/slug`.

      The inspector keeps its `ws://localhost:3000` default value.
    - Only visible text changes. Element ids, JS variable names
      (`worldUrlInput`, `wsUrlInput`) and CSS classes (`.ws-label`) stay the
      same. If they're renamed at all, that happens in a separate commit.

15. **Static loads are refused while a connection is live.** This closes
    the deferred Load-while-connected / drop-while-connected issue (§2).
    - **Client:** `loadWorld()` and `loadWorldFromData()` reject with a
      clear `Error` (e.g. "Disconnect before loading a static world") if a
      connection record is current: connecting, connected, or closing
      (#9). Because #9 clears the record before emitting `disconnected`,
      the static reload inside the existing `disconnected` handlers keeps
      working. The rejection is a backstop so no caller can reach the bad
      state. The apps check first, so users normally never see it.
    - **Apps (`apps/client` and `tools/som-inspector`):**
      - The toolbar File Load button is enabled only in the disconnected
        state. Its title while disabled is "Disconnect to open a local
        file".
      - A viewport drop while not disconnected is ignored, and the overlay
        shows the same message. This covers `.gltf`, `.glb` and
        `.atrium.json` drops alike.
      - Treat the brief window after clicking Disconnect and before the
        `disconnected` event as still connected. That matches the client
        rule.
    - **The world-browser Load (#1, #3) is unaffected.** It connects rather
      than loading statically, so it works in every state.
    - **Why refuse rather than auto-disconnect:** an auto-disconnect would
      go through the asynchronous `disconnected` event. The existing
      `disconnected` handlers then statically reload `worldUrlInput`, which
      would overwrite the file the user just dropped. A clean automatic
      switch from live to static needs its own start-of-static-world event,
      and that can be built on #9 and #11 later (§4). Refusing is simple,
      matches the earlier "disabled while connected" policy on the right
      button, and never lets the SOM and socket disagree.

## 4. Out of scope

- **Refresh silently reconnecting to the home world.** This fix must not
  change refresh behavior, and a regression check confirms it doesn't.
- Cross-server connect itself. This fix lays groundwork for it (#4, #9, #11,
  #13).
- Where assets referenced by server-stored worlds should live.
- Whether the static reload on an explicit Disconnect or a drop should exist
  at all. It's unchanged; it just no longer fires on replacement.
- Migrating any existing `.` or `..` usernames or slugs.
- Removing the `/public/` alias.
- Whether usernames belong in world addresses at all. `/worlds/Josh%20Maurice/…`
  works after #10, but looks rough.
- Renaming element ids, JS variables or CSS classes to match the new labels.
- Any "you were redirected" UI.
- Switching automatically from a live connection to a static file (#15
  refuses instead).

## 5. Open questions for the brief author / critic

- **Q-tests.** Existing tests that assert on `loadBtn.disabled`, or on the
  old fetch-then-`loadWorldFromData` Load path, are updated in the same
  commit.
- **Q-overlay.** Should the overlay text during a Load swap name the world?
  It's cosmetic; the brief author decides.
- **Q-harness.** `apps/client` and `tools/som-inspector` have no DOM test
  harness. The brief should separate automated tests from the manual DEV
  acceptance checklist in §6.
- **Q-ordering.** The ordering tests for #9 and #11 need control over when
  events arrive. The constructor already accepts injected `WebSocket` and
  `fetch`.
  - The repo's "no mocks" convention covers servers, schemas and documents.
    A shim that only controls the timing of socket or fetch events is a
    judgment call.
  - The brief should say which approach it uses and why.
  - Prefer the real server wherever the ordering can be forced without a
    shim.
- **Q-state.** Audit `AtriumClient` for per-connection and per-world state,
  and list exactly which fields `connecting` resets. Start with the fields in
  §2: `_pendingView`, `_viewFlushTimer`, `_lastSentAt`, the view/send
  sequence counters, `_applyingRemote`, pointer state and `_navInfo`. Say
  which of these belong to the connection and which belong to the world, and
  so reset on any world-context change (#11).
- **Q-caddy.** Does Caddy forward an encoded `%2F` in a WS path to Node
  unchanged? It's checked in DEV acceptance. If Caddy decodes it, record that
  as a known limitation rather than working around it here.
- **Q-split.** This fix spans the client lifecycle, the server, the
  renderer, and two apps. Consider ordered commits:
  1. #9, #11 and the client half of #15, with their race tests;
  2. #10 and #13, server-side;
  3. #12, renderer;
  4. #1–#8, #14 and the app half of #15, the app-level changes built on the
     first commit.

## 6. Test expectations

Automated:

- **`buildWorldWsUrl`:**
  - builds `/worlds/<username>/<slug>`;
  - keeps only the origin, for `ws`, `wss`, a base with a path, and a base
    with a port;
  - encodes its arguments;
  - returns null for missing arguments or a bad base.
- **The `ws`→`http` base helper:** covers the same cases and never throws.
- **`session:ready`** includes `url`, and it matches the URL passed to the
  `connect()` call that produced it. Test with one client and with two
  clients.
- **`worldBaseUrl` in `connect()`:**
  - derived when not passed;
  - used as-is when passed;
  - replaced on the next `connect()`.

  The existing null-base no-op test stays green.
- **A WS world with a relative `source`** calls `fetch` with the resolved
  `http(s)` URL.
- **Replacement race (#9):** connect to A, then immediately connect to B,
  and deliver A's close *after* B's socket exists. Expect:
  - B stays current and connected;
  - no `disconnected` for A;
  - `connecting` with `previousSessionId` equal to A's id;
  - B reaches `session:ready` with B's url.

  Run it with A already ready, and with A still mid-handshake.
- **Disconnect-then-Connect race (#9):** connect to A, call `disconnect()`,
  and connect to B *before* A's close arrives. A's pending `disconnected` is
  never emitted, and B stays current.
- **Stale socket is inert (#9):** a message or error that arrives on A after
  B started changes nothing and emits nothing.
- **Explicit disconnect (#9):**
  - exactly one `disconnected`, with `reason: 'client'` and the right
    `sessionId`;
  - both existing disconnect tests (~L152, ~L156) pass unchanged.
- **Superseded socket is closed (#9):** after A→B, A's socket has been
  closed. With a real server, A's host sees the session leave.
- **Closing record (#9):** after `disconnect()`, a message that arrives
  before the close is ignored, and exactly one `disconnected` follows.
- **Server drop:** `disconnected` with `reason: 'closed'`.
- **Synchronous constructor failure:**
  - `connect('not a url')` doesn't throw, and returns a `sessionId`;
  - `error`, then `disconnected`, arrive asynchronously, carrying that id;
  - `error` is still an `Error` with its `message` intact;
  - if a newer `connect()` starts before those scheduled events run, they
    never fire.
- **Per-connection reset (#9):**
  - after A→B, `_peerSessions` holds only B's peers, including joins that
    arrived before B's `som-dump`;
  - `AvatarController`'s peers and `_lastSentView` are reset on
    `connecting`;
  - B's first view update is sent even if it equals A's last one;
  - a view flush timer pending from A never sends into B.
- **Distinct `sessionId`s per `connect()`**, each carried by the right
  events.
- **Stale async work (#11), using an injected `fetch` resolved by hand:**
  - A's external-ref fetch, resolved after the move to B, doesn't ingest
    into B or emit `world:loaded`;
  - the same for `_onSomDump`'s document read;
  - the same for `loadWorld` racing a `connect()`;
  - **stale failures:** a superseded `loadWorld` whose read *rejects*
    resolves without effect (no rejection to the caller), and a superseded
    external-ref fetch that rejects emits nothing and doesn't warn.
- **`loadBackground` (#12):**
  - an absolute texture with a null or undefined base loads;
  - a relative texture with no base warns and doesn't throw;
  - a texture that finishes after a newer request, including a clear,
    doesn't overwrite the newer one.
- **Route decoding (#10), server, per file:**
  - `/worlds/Josh%20M/my%20world` resolves to `Josh M` / `my world`, and so
    does the same path under `/public/`;
  - `%2F` stays inside its segment;
  - malformed encoding returns null without throwing;
  - a segment that decodes to empty returns null;
  - `.` and `..` are rejected at registration and at world create/update;
  - over WS, a username and slug containing spaces reach `session:ready`.
- **Static loads while live (#15):**
  - `loadWorld()` and `loadWorldFromData()` reject while connecting,
    connected, or closing, and leave the SOM unchanged;
  - `loadWorld()` called from inside a `disconnected` handler succeeds.
- **Round trip:** names with spaces, `/`, `%` and non-ASCII characters
  survive `buildWorldWsUrl` → `resolveWorldId` unchanged.
- **Route alias (#13), server, per file:**
  - `/worlds/` resolves exactly like `/public/` for:
    - a public world;
    - a private world with the owner connecting;
    - a private world with someone else connecting (404);
    - an unknown user or slug (404);
    - the commons convergence case;
  - a `/worlds/` client and a `/public/` client in the same world see each
    other;
  - the existing `/public/` tests pass unchanged.

Manual DEV acceptance:

- **Load while disconnected:** you get a real session, your avatar, and
  `You:` / `Peers:`. The World box shows `/worlds/<username>/<slug>`.
- **Load while connected to another world:**
  - no flash of the disconnected UI;
  - no static reload;
  - no stale peer labels or peer count;
  - the old world's occupants see you leave;
  - Load stays enabled.
- **Load B, then C, quickly:** you end up in C, with no error for B.
- **Disconnect, then Load immediately:** a late disconnect doesn't knock you
  out of the world you just loaded.
- **Load a private world you own.**
- **The World box syncs after:** auto-connect (at login and on page load),
  Load, and manual Connect. After a failed manual Connect, the typed URL
  stays in the box, but the HUD and client state don't treat it as
  connected.
- **Refresh still goes to the home world** (unchanged).
- **Auto-connect after dropping a `.atrium.json` that points elsewhere**
  still goes to the account server.
- **`space-ext` and `atrium` dev flows, in both apps:** drop the
  `.atrium.json` and Connect. `crate.gltf`, `lamp.gltf` and the
  `skyboxtest1.png` background all load.
- **Swap from a world with a background to one without:** the old skybox
  doesn't reappear.
- **`/worlds/` through Caddy:** Load connects over `/worlds/`. A `/public/`
  URL typed into the World box lands in the same live room.
- **Labels:** both toolbars read "File:" and "World:".
- **Static load while connected (#15), in both apps:**
  - the File Load button is disabled while connected, and enabled again
    after Disconnect;
  - dropping a `.gltf` or `.atrium.json` while connected shows "Disconnect
    to open a local file" and changes nothing;
  - after disconnecting, both work.
- **Encoded names through Caddy:** a slug with a space works. Also try a slug
  containing `/` (answers Q-caddy).
