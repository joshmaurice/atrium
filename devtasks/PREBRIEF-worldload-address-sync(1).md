# Pre-brief: "Load" should connect live; Server box should track the connection

Status: **Revision 2. All decisions (1–8) resolved and confirmed
(2026-09-24). Ready for the kanban pipeline.** Decisions 1–5 are unchanged
from revision 1. Decision 6 was revised, and decisions 7 and 8 are new. All
three came from a code check done after revision 1 was committed, and the
human confirmed them the same day.

Review trail. In revision 1, Claude drafted proposals 1, 2, 3 and 5, and they
were confirmed as written. Decision 4 (Server-box sync) was discussed at length
and confirmed as "(b), broadened". Decision 6 came from a deliberate second
pass over the code and was confirmed separately. Revision 2 came from checking
decision 6 against `resolveExternalReferences()` and against the upstream
external-reference dev flow. That check found the following:

- As confirmed, decision 6 would have produced a `ws://` base URL, which can't
  be fetched.
- As confirmed, decision 6 would also have silently broken the
  `space-ext.gltf` flow, which has always worked.
- `app.js` has a second, independent `worldBaseUrl` with the same bug (new
  decision 7).
- A §2 fact in revision 1 was wrong: the Server box is set in two places, not
  one. It's corrected below.

This is input for the brief-writing step (brief author, then critic). It is
not the brief itself. Code facts were verified by reading
`apps/client/src/app.js`, `apps/client/src/wsUrl.js`,
`packages/client/src/AtriumClient.js`, `packages/server/src/http-routes.js`
and `tests/fixtures/space-ext*` on current `main` (`107bb36`). Code is
identical to `f8b2750`, since the commits between them only add docs. Line
numbers are approximate. The human independently reproduced one symptom:
refresh silently returns to the home world. That symptom is explicitly out of
scope here (see §4).

---

## 1. Goal

Two related client bugs, one fix:

1. Clicking **Load** on a world in the My Worlds list should drop you into
   that world exactly as if you'd connected to it. That means your avatar,
   other live avatars, and a correct `World:` / `You:` / `Peers:` HUD, not a
   disconnected static preview.
2. The **Server** address box should always show the URL of the world you're
   actually connected to, however you got there: home auto-connect,
   world-browser Load, manual Connect, and later, cross-connect.

This fix has one supporting goal. Every URL-derived piece of connection state
(the connect URL, the Server box, and the base URL used to resolve a world's
relative asset refs) should come from the connection itself, not from
whatever happens to be in a DOM input field.

## 2. Verified facts about the current code

**`apps/client/src/app.js`**

- The per-world Load button (`renderWorldList`, ~L178–204) does
  `fetch('/api/worlds/${w.id}')`, then `client.loadWorldFromData(text, name)`.
  This is a **local, disconnected** render: no `hello`, no session, no avatar,
  and nothing visible to anyone else already in that world.
- `loadBtn.disabled = client.connected` (title: "Disconnect before loading a
  saved world") means Load only works while not connected. This was a
  deliberate, reviewed choice at the time (`devtasks/REVISION-client-ui.md`,
  which pre-dates the kanban pipeline): "Load is correctly disabled while
  connected." It's named here so it isn't read as an oversight. We're
  revisiting a past decision, not fixing an unreviewed one.
- **Correction from revision 1:** `wsUrlInput.value` (the Server box) is set
  in **two** places, not one:
  - at page load (L16), `wsUrlInput.value = computeWsUrl(window.location)`,
    which is the account-server origin, mapped to `ws:`/`wss:`;
  - in `loadAtriumConfig` (~L531), from a dropped `.atrium.json`'s
    `world.server` field.

  Nothing ever updates it in response to an actual connection. Before any
  `.atrium.json` is dropped, the box shows the account server, and
  auto-connect happens to work because of that. Manual Connect appears
  correct only because the user typed the URL into the box before clicking
  Connect.
- `homeWorldWsUrl()` / `autoConnectToHomeWorld` (~L378–400) build
  `/home/<userId>/home` from the **origin of `wsUrlInput.value`**. After a
  `.atrium.json` pointing elsewhere is dropped, auto-connect targets the wrong
  host. The comment inside `autoConnectToHomeWorld` describes the
  `wsUrlInput`-origin behavior as "by design". That comment has to be
  rewritten along with the code (decision #2), not left describing behavior
  that no longer exists.
- **The value that `wsUrlInput` is initialised from is exactly the right
  account-server base:** `computeWsUrl(window.location)` from `wsUrl.js`. The
  fix for decisions #1 and #2 is to capture that value once at startup, in a
  `const` such as `accountWsBase`, and use the const everywhere an
  account-server WS URL is built. That keeps today's default behavior
  byte-for-byte, including the dev setup, and only removes the dependence on
  the editable field.
- `currentUser` (set by `setAuthState`) already holds
  `{ id, username, displayName }`, so the logged-in user's own username is
  available client-side with no new fetch.
- **`app.js` keeps its own module-level `worldBaseUrl`, separate from
  `client.worldBaseUrl`, and derives it from the wrong source.** It's declared
  at ~L497. The `world:loaded` handler (~L418–425) sets it from
  `worldUrlInput.value` every time a world loads, including WS-connected
  worlds. It's then passed to `loadBackground()` in that handler and again in
  the `som:set` handler for `__document__` changes (~L499–501). The effect is
  that on any WS-connected world, a relative `extras.atrium.background` path
  is resolved against whatever is in the World URL field. That's often
  nothing, in which case it resolves against the page's own URL. Sometimes
  it's a stale file from an earlier drop. This is the same bug class as the
  `client._worldBaseUrl` problem below, but it's a different variable, so
  fixing only `AtriumClient` wouldn't fix backgrounds. See decision #7.
- `connectBtn` handler (~L620–637): if `worldUrlInput` is non-empty, it sets
  `client.worldBaseUrl = new URL(worldUrl, window.location.href).href` right
  before calling `client.connect(wsUrl, …)`. See the next bullet for why this
  is load-bearing today and has to be preserved in some form.
- **The upstream external-reference dev flow depends on that manual set.**
  `tests/fixtures/space-ext.atrium.json` sets both
  `world.gltf: "./space-ext.gltf"` (which `loadAtriumConfig` loads statically
  and writes into `worldUrlInput`) and `world.server: "ws://localhost:3000"`
  (written into `wsUrlInput`). `space-ext.gltf` has relative
  `extras.atrium.source` refs (`./crate.gltf`, `./lamp.gltf`). When the user
  then clicks Connect, those refs resolve against the fixture's own directory
  only because of the manual `client.worldBaseUrl` set. The WS server itself
  serves no static assets (see the server bullet below). Deriving the base
  unconditionally from the connect URL would silently break this flow. See
  decision #6 (revised).
- **Naming collision, implementation hygiene only.** There are two unrelated
  variables named `loadBtn`:
  - a toolbar-level one (`getElementById('loadBtn')`, L17) that loads a
    static file from the `worldUrlInput` field;
  - a per-item `const loadBtn` declared fresh inside `renderWorldList`'s loop
    for each world's own Load button. This is the one the fix changes.

  Same name, same surrounding vocabulary ("load"), different button, different
  behavior. It isn't a bug, but the implementer should rename the per-item one
  (e.g. `itemLoadBtn`) while touching this code, so the diff and any future
  search for `loadBtn` aren't ambiguous.

**`packages/client/src/AtriumClient.js`**

- `connect(wsUrl, opts)` (~L216) already calls `this.disconnect()` first if a
  connection exists, then proceeds normally. Swapping which world a live
  client is connected to, on the same page, already works mechanically.
  `AtriumClient` doesn't need to change to support "Load while connected".
  The changes it does need are for decisions #4 and #6.
- The real-connect path drives `You:`, `Peers:` and the world name in the
  HUD: `hello` → `_onServerHello` (~L353) → `session:ready` (~L363), and
  `som-dump` → `_onSomDump` → avatar announce + `world:loaded`. The static
  path (`loadWorld` / `loadWorldFromData` → `_finalizeWorldLoad`) only emits
  `world:loaded`. It never emits `session:ready` and never announces an
  avatar. This is the entire reason Load today shows `World:` but not `You:` /
  `Peers:`.
- **`connect(wsUrl, opts)` is synchronous and event-driven. It doesn't return
  a promise and doesn't throw on failure.** Failures surface later as an
  `error` or `disconnected` event. So the new Load handler can't be written as
  `try { await client.connect(url) } catch …`, the way the current
  `await client.loadWorldFromData(...)` is. Instead it has to listen for:
  - `session:ready` (success): clear `wbError` and re-enable the button;
  - `error` / `disconnected` (failure): show `wbError` and re-enable the
    button.

  A `finally` block won't work here. The implementer should also make sure
  these listeners are one-shot or otherwise cleaned up, so repeated Loads
  don't pile up handlers.
- **`_worldBaseUrl` is never set anywhere in the WS connect path.** It's what
  resolves `extras.atrium.source` refs. `resolveExternalReferences()` (~L715)
  runs from the static loader and again from `_onSomDump`, so it runs on every
  WS connection. But it silently no-ops when `_worldBaseUrl` is null
  (`if (!this._som || !this._worldBaseUrl) return`). Only two things ever set
  it:
  - `loadWorld(url)` (~L313), which derives it from that file's own URL as a
    directory with a trailing slash;
  - the manual `client.worldBaseUrl = …` setter call in the `connectBtn`
    handler.

  `loadWorldFromData` explicitly sets it to `null` (~L325), and an existing
  test asserts that no-op
  (`external-references.test.js`, "no-op when worldBaseUrl is null"). That
  test has to stay green. The comment inside `_onSomDump` ("Re-resolve
  external references using the world URL from the original loadWorld call")
  is stale: for any WS-connected world there was no `loadWorld` call.
- **`resolveExternalReferences` resolves with `new URL(source, base)` and
  then `fetch`es the result** (`_loadExternalRef`, ~L733). So the base has to
  be an `http:`/`https:` URL. A `ws:`/`wss:` base would produce `ws://…`
  resolved URLs, and `fetch()` rejects those. Per-reference failures are
  caught and logged with `console.warn`, and they're non-fatal. A bad base
  fails quietly and doesn't break the world.
- The JSDoc on the `worldBaseUrl` getter/setter (~L202–208) says it "can be
  set manually by the app layer for connect-only flows where loadWorld() is
  not called." Decision #6 replaces that as the primary mechanism, so the
  JSDoc needs updating.

**Server side (unchanged by this fix, checked for compatibility)**

- `packages/server/src/world-registry.js`:
  - `/public/<username>/<slug>` lazily creates a live host on first join. It
    also admits the owner even when the world is `private`, because the
    owner-only check happens after the visibility branch. That makes this
    route usable for "load any of my own worlds", public or private, with no
    server change.
  - `/ws/<id>` does **not** lazily create. It only reaches worlds that already
    have a live host (`hosts.get(id)`, 404 otherwise). Most of a user's own
    worlds have no live host until someone joins them. So even though the
    world list already has `w.id`, `/ws/<id>` isn't the right route for Load.
    This is flagged explicitly so the implementer doesn't reach for it as the
    obvious-looking shortcut.
  - The world list (`GET /api/worlds`) includes the `home`-slug world along
    with everything else, because `listWorlds` has no slug filter. Once Load
    is fixed, the home-world entry in My Worlds would connect via
    `/public/<username>/home`. That's functionally equivalent to the existing
    home-world auto-connect, just via a different route. See §3-5.
- **The Node server serves only `/api/*` and WebSocket upgrades. It serves no
  static files.** `http-routes.js` ends in a catch-all 404. In deployment,
  Caddy serves the client's static files on the same origin, reverse-proxies
  `/api/*` and the WebSocket to Node, and 404s everything else. This matters
  for decision #6. A relative `source` ref in a server-stored world, resolved
  against the account origin, points at Caddy's static tree. Today no world
  assets live there, so such a ref would 404 and log a warning. That's
  acceptable for this fix, because prod's commons fixture has zero
  `extras.atrium.source` refs (confirmed 2026-09-19). Where server-stored
  worlds' assets should live is a separate, later question (§4).

## 3. Decisions (resolved)

1. **Load performs a real connect** (confirmed). It uses a new
   `buildPublicWorldWsUrl(baseUrl, username, slug)` helper in `wsUrl.js`,
   parallel to the existing `buildHomeWorldWsUrl`: origin only, path
   discarded, pure, with unit tests in `apps/client/tests/wsUrl.test.js`.
   `baseUrl` is the account-server WS base: the `accountWsBase` const
   captured from `computeWsUrl(window.location)` at startup (see §2), never
   `wsUrlInput.value`. The extra `fetch('/api/worlds/:id')` for the document
   goes away entirely, because the WS `som-dump` already delivers it.
   `username` and `slug` should be URL-encoded (`encodeURIComponent`) when the
   path is built.
2. **Fix `autoConnectToHomeWorld`'s origin source in the same pass**
   (confirmed). `homeWorldWsUrl()` builds from `accountWsBase`, not
   `wsUrlInput.value`. It's the same bug, and touching this code without
   fixing it would leave a near-identical bug sitting next to the fixed one.
   Rewrite the "divergence is by design" comment to match. Manual Connect
   still uses the box's raw value, which is correct: that's the one path
   where the user is telling us the URL.
3. **Remove the `loadBtn.disabled = client.connected` restriction**
   (confirmed). Load works whether you're connected or not. Clicking it while
   connected to a *different* world disconnects that session and connects the
   new one; `connect()` already does this. For UI feedback during the swap,
   reuse `overlayEl` ("Loading…", matching manual Connect).
4. **`AtriumClient` becomes the source of truth for its own connection
   state** (confirmed as "(b), broadened"). This isn't just about the Server
   box. Connection state belongs on the client itself, not re-derived by
   whichever caller happens to need it. Concretely:
   - `connect(wsUrl, opts)` stores the full args it's called with (e.g.
     `this._connectArgs = { url: wsUrl, avatar, displayName, worldBaseUrl }`),
     not just the URL. Storing the full args costs nothing now and avoids a
     second pass later, when something needs more than the URL (see the
     forward-looking cases below).
   - The confirmed URL is exposed on the payload the client already emits
     once the handshake actually succeeds:

     ```js
     // AtriumClient.js, inside _onServerHello — one field added
     this.emit('session:ready', {
       sessionId:   this._sessionId,
       displayName: this._displayName,
       url:         this._connectArgs.url,
     })
     ```

   - `app.js` gets exactly one listener, replacing all per-call-site box
     updates: `client.on('session:ready', ({ url }) => { wsUrlInput.value = url })`.
     No call site needs to know a Server box exists, including cross-connect
     whenever it lands.
   - Updating the box only on `session:ready`, not when `connect()` is
     called, is itself a correctness improvement: the box never shows a URL
     for a connection attempt that then failed.
   - Test surface: `packages/client/tests/client.test.js` has about 12
     `session:ready` assertions. None appear to assert the payload's exact key
     set, so adding `url` should be additive. The implementer should add at
     least one assertion covering it and check that no existing test asserts
     the payload shape strictly. `apps/playground/src/app.js` also consumes
     `@atrium/client`. It's unaffected today because it has no address box,
     and it gets this for free if it ever wants one.
   - **Forward-looking reasons this belongs on the client rather than in
     `app.js`.** None of these are built now; this only decides *where* the
     state lives so today's fix doesn't have to be redone:
     - reconnect-on-drop would need the stored avatar and displayName to
       retry without the caller supplying them again;
     - teleporters and cross-connect both want "where did I connect from"
       available without re-deriving it from a DOM input;
     - error logging currently has no way to say which server a failure was
       talking to;
     - multiple concurrent `AtriumClient` instances (already the case in
       `client.test.js`'s multi-peer tests) each need to report their own
       connection, rather than one global `app.js` variable assuming a single
       client.
5. **Home-world list entry** (confirmed). Leave it as-is rather than hiding
   or disabling it. Load on it behaves like auto-connect, just via
   `/public/<username>/home` instead of `/home/<userId>/home`. There's no
   evidence yet that this is confusing in practice. Revisit if it turns out
   to be.
6. **`connect()` sets `_worldBaseUrl` on every call. An explicit caller
   value wins; otherwise it's derived from the connect URL.** (REVISED from
   revision 1. Confirmed 2026-09-24.)
   - `connect(wsUrl, { avatar, displayName, worldBaseUrl })` accepts an
     optional `worldBaseUrl`, which is stored in `_connectArgs` per decision
     #4.
   - If `worldBaseUrl` is supplied, `_worldBaseUrl` is set to it.
   - If it isn't supplied, `_worldBaseUrl` is derived from the connect URL's
     **origin**, with the scheme mapped `ws:` → `http:` and `wss:` →
     `https:`, plus a trailing `/`. For example,
     `wss://host/public/josh/garden` → `https://host/`.
   - Derivation belongs in a small pure helper, unit-tested on its own, that
     covers `ws`, `wss`, a URL with a port, a URL with a path, and an
     unparseable URL. An unparseable URL leaves `_worldBaseUrl` null, which
     keeps the existing no-op behavior; the helper must never throw out of
     `connect()`.
   - `connect()` always sets `_worldBaseUrl` one way or the other, so a
     previous world's base can't leak into the next connection.
   - `connectBtn` passes `worldBaseUrl` as a connect option, derived from
     `worldUrlInput` exactly as it does today, only when that field is
     non-empty. This replaces the setter call it makes today, and it
     preserves the `space-ext` dev flow described in §2. Auto-connect and the
     new Load **never** pass it. Cross-connect, later, must not pass anything
     taken from a local DOM field either.
   - Keep the `worldBaseUrl` setter for API compatibility, and update its
     JSDoc to say `connect()` now sets the base itself and that the setter is
     for callers that know better. Fix the stale comment in `_onSomDump`.

   Why this differs from revision 1:
   - Revision 1 said "the connect URL's origin (or origin + path)", which left
     the scheme problem and the path question to the implementer. The scheme
     has to be mapped or every resolved ref is an unfetchable `ws://` URL. The
     path should be discarded: `/public/<user>/<slug>` is a WS route, not an
     asset directory, so resolving relative refs under it can never work.
   - Revision 1's wording also didn't account for the manual `connectBtn`
     set. Deriving the base unconditionally would have overwritten it and
     silently broken `space-ext`. Hence explicit-wins.
   - Expected behavior after the fix: for server-stored worlds with relative
     refs, the refs now attempt a fetch against the account origin and 404
     with a console warning, instead of being silently skipped. That's
     intended: it's visible rather than silent, and it can't affect prod
     today. Deciding where such assets should actually live is out of scope
     (§4).
7. **`app.js`'s background base URL comes from `client.worldBaseUrl`, not
   `worldUrlInput`.** (NEW. Confirmed 2026-09-24.)
   - In the `world:loaded` handler, replace the `worldUrlInput`-based
     derivation (~L422–425) with the client's own base,
     `worldBaseUrl = client.worldBaseUrl ?? ''`. Keep the module variable, or
     read `client.worldBaseUrl` directly at both `loadBackground` call sites;
     that's the implementer's choice, and reading directly is simpler if it
     doesn't change behavior.
   - This works for every path. Static `loadWorld` already sets a directory
     base. Dropped data sets null, and relative backgrounds already can't
     resolve there. WS connects get decision #6's base.
   - It closes the last place where world-asset resolution reads a DOM input.
     This is the same bug class as #2 and #6, in code this fix already
     touches.
   - Check what `loadBackground` does with an empty or null base and an
     absolute background URL, and keep that behavior unchanged. Absolute
     URLs must keep working.
8. **Correct the §2 record, don't just fix the code.** (NEW. Housekeeping,
   confirmed 2026-09-24.) Revision 1 of this pre-brief was committed to `main` with the
   "set in exactly one place" claim. Revision 2 replaces the file in place;
   no separate errata file is needed. The brief author should work from
   revision 2 only.

## 4. Explicitly out of scope

- **Refresh silently reconnecting to the home world**, overriding whatever
  world you were actually in (your own non-home world, or another user's
  public world via manual Connect). The human confirmed this is reproducible
  in both cases. Root cause: `me().then(...)` unconditionally calls
  `autoConnectToHomeWorld` on every page load if you're logged in and not
  connected, with nothing checking "was I connected to something else before
  this reload." It's deliberately not addressed here. There's no decision yet
  on whether refresh should ever preserve or restore the pre-refresh world,
  and that's a separable question from "does Load work and does the box stay
  in sync". **This fix must not change refresh/reload behavior.** A
  regression test should confirm refresh still goes to the home world,
  unchanged, after this fix lands.
- Cross-server connect itself. That's a separate, upcoming piece of work; see
  `Atrium-Passdown-2026-09-24-cross-server-findings.md`. This fix is a
  same-server rehearsal of the same disconnect/reconnect-in-place mechanism,
  not the cross-server version of it.
- **Where assets referenced by server-stored worlds should live and how
  they're served.** That covers an asset route on the Node server, a Caddy
  static path, or absolute URLs only. Decision #6 makes such refs resolve
  deterministically against the account origin. It doesn't make them load.
- Any UI indicating "you were redirected". That would only be relevant if
  refresh behavior changes later.

## 5. Open questions for the brief author / critic

Resolved in review: decision #4 (Server-box sync), and decisions #6–8
(revision 2); see §3.

- **Q2.** Any existing `apps/client` or `packages/client` tests that assert on
  `loadBtn.disabled` state, or on the old fetch-then-`loadWorldFromData` Load
  path, need updating in the same commit, not left red.
- **Q3.** Should the overlay/loading text during a Load-triggered swap be
  identical to manual Connect's, or specific to the world list (e.g. naming
  the world being loaded)? This is cosmetic, so it's left to the brief
  author's judgment unless the human wants to weigh in.
- **Q4 (new).** `apps/client` has no DOM/integration test harness. Its tests
  directory holds only `auth.test.js` and `wsUrl.test.js`, and both test pure
  functions. The brief should say which §6 expectations are automated and
  which are a manual DEV-acceptance checklist, rather than implying a test
  harness exists. The following can be unit-tested with pure helpers and
  `AtriumClient`:
  - `buildPublicWorldWsUrl`;
  - the `ws`→`http` base derivation;
  - the `url` field on the `session:ready` payload;
  - explicit-vs-derived `_worldBaseUrl`;
  - external-ref resolution after a WS connect.

  The Server-box, HUD, and refresh behaviors are most likely manual
  acceptance items.

## 6. Test expectations

Automated (packages/client, apps/client pure helpers):

- `buildPublicWorldWsUrl`:
  - origin-only output for `ws`, `wss`, a base with a path, and a base with a
    port;
  - encodes username and slug;
  - returns null for missing arguments or an unparseable base.
- The `ws`→`http` base-derivation helper covers the cases listed in decision
  #6, and never throws.
- `session:ready`'s payload includes `url`, and it matches the URL passed to
  the `connect()` call that produced it. Cover the single-client case and,
  following the existing multi-peer test pattern, the two-client case.
- `connect()` without a `worldBaseUrl` option sets `client.worldBaseUrl` to
  the scheme-mapped origin. `connect()` with the option uses it unchanged. A
  second `connect()` without the option replaces a base set by an earlier
  connect or an earlier `loadWorld`, so nothing leaks between connections.
- A WS-connected world whose `som-dump` contains a relative
  `extras.atrium.source` ref actually calls `fetch` with the resolved
  `http(s)` URL (decision #6). This is regression coverage for the
  previously silent no-op.
- The existing "no-op when worldBaseUrl is null (loadWorldFromData)" test
  still passes unchanged.

Manual DEV acceptance (unless the brief author finds a way to automate them):

- Load a different owned world while disconnected. Expect a real session,
  your own avatar visible, `You:` / `Peers:` populated, and the Server box
  showing the `/public/<username>/<slug>` URL.
- Load a different owned world while connected to another one. The old
  session ends cleanly, and occupants of the old world see the avatar leave.
  A new session starts, and the HUD and Server box both reflect the new
  world.
- Load a private world you own. It should succeed, via owner admission on the
  `/public/` route (unchanged server-side).
- The Server box shows the connected URL after each of these:
  - home auto-connect, both at login and at page load;
  - world-browser Load;
  - manual Connect (already true today; guard against regressing it).
- After a failed connect attempt, the Server box does not show the failed
  URL as if connected.
- Regression: refresh while connected to a non-home world still silently
  returns to the home world, unchanged from current behavior (see §4).
- Drop a `.atrium.json` whose `world.server` points elsewhere, then log in or
  refresh. `autoConnectToHomeWorld` still targets the account server's
  `/home/<userId>/home`. This is the scenario the origin-source bug was found
  in.
- **`space-ext` regression (decision #6):** drop
  `tests/fixtures/space-ext.atrium.json`, then click Connect to a local
  server. `crate.gltf` and `lamp.gltf` still load. This is the flow that
  revision 1's wording would have broken.
- **Background regression (decision #7):** a world with a relative
  `extras.atrium.background` still renders its background when loaded
  statically. On a WS-connected world, the background resolves against the
  client's base, and a stale World URL field no longer affects it.
