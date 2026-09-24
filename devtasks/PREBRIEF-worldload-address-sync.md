# Pre-brief: "Load" should connect live; Server box should track the connection

Status: **All decisions (1–6) resolved and confirmed (2026-09-24). Ready for
GLM.**

Review trail: proposals 1, 2, 3, 5 drafted by Claude and confirmed as written.
Decision 4 (Server-box sync) was discussed at length — see resolution below —
and confirmed as "(b), broadened" rather than as originally proposed. Decision
6 was found on a deliberate second pass over the same code, requested
specifically to catch anything the first pass missed, and confirmed
separately on 2026-09-24 after decision 4 had already been settled.

Input for the brief-writing step (GLM), then critique (Nemotron) — not the brief
itself. Code facts verified by reading `apps/client/src/app.js` and
`packages/client/src/AtriumClient.js` on current `main`
(`f8b2750`). One symptom independently reproduced by the human
(refresh silently returns to home world — see §4, explicitly out of scope here).

---

## 1. Goal

Two related client bugs, one fix:

1. Clicking **Load** on a world in the My Worlds list should drop you into that
   world exactly as if you'd connected to it — your avatar, other live avatars,
   correct `World:` / `You:` / `Peers:` HUD — not a disconnected static preview.
2. The **Server** address box should always show the URL of whatever world
   you're actually connected to, however you got there (home auto-connect,
   world-browser Load, manual Connect, and later, cross-connect).

## 2. Verified facts about the current code

**`apps/client/src/app.js`**
- The per-world Load button (`renderWorldList`, ~L178–204) does
  `fetch('/api/worlds/${w.id}')` → `client.loadWorldFromData(text, name)`.
  This is a **local, disconnected** render: no `hello`, no session, no avatar,
  nothing visible to anyone else already in that world.
- `loadBtn.disabled = client.connected` (title: "Disconnect before loading a
  saved world") — Load is only usable while not connected. This was a
  deliberate, reviewed choice at the time (`devtasks/REVISION-client-ui.md`,
  pre-dates the kanban pipeline): "Load is correctly disabled while connected."
  Worth naming so this isn't read as an oversight — we're revisiting a past
  decision, not fixing an unreviewed one.
- `wsUrlInput.value` (the Server box) is set in exactly **one** place in the
  whole file: `loadAtriumConfig`, from a dropped `.atrium.json`'s
  `world.server` field. Neither `autoConnectToHomeWorld` nor (obviously) the
  current Load button ever sets it. Manual Connect appears correct only
  because the user typed the URL into the box themselves before clicking
  Connect — the box was never actually driven by the connection.
- `autoConnectToHomeWorld` (~L383–400) builds
  `/home/<userId>/home` from the **origin of `wsUrlInput.value`**, not from
  `window.location`. Same root cause as the address-box desync; listed here
  because any fix touching "what URL did we actually connect to" should fix
  this in the same pass rather than leave a second, related bug in place.
- `currentUser` (set by `setAuthState`) already holds `{ id, username,
  displayName }` — the logged-in user's own username is available client-side
  with no new fetch.
- **Naming collision, implementation hygiene only.** There are two unrelated
  variables named `loadBtn`: a toolbar-level one (`getElementById('loadBtn')`)
  that loads a static file from the `worldUrlInput` field, and a per-item
  `const loadBtn` declared fresh inside `renderWorldList`'s loop for each
  world's own Load button — the one this fix changes. Same name, same
  surrounding vocabulary ("load"), different button, different behavior. Not
  a bug, but worth GLM renaming the per-item one (e.g. `itemLoadBtn`) while
  touching this code, so the diff and any future search for `loadBtn` aren't
  ambiguous.

**`packages/client/src/AtriumClient.js`**
- `connect(wsUrl, opts)` (~L216) already calls `this.disconnect()` first if a
  connection exists, then proceeds normally. Swapping which world a live
  client is connected to, on the same page, already works mechanically — nothing
  in `AtriumClient` needs to change to support "Load while connected."
- The real-connect path (`hello` → `_onServerHello` → `session:ready`,
  `som-dump` → `_onSomDump` → avatar announce + `world:loaded`) is what
  actually drives `You:`, `Peers:`, and world name in the HUD. The static path
  (`loadWorld` / `loadWorldFromData` → `_finalizeWorldLoad`) only emits
  `world:loaded`, never `session:ready`, never announces an avatar. This is
  the entire reason Load today shows `World:` but not `You:` / `Peers:`.
- **`connect(wsUrl, opts)` is synchronous and event-driven — it does not
  return a promise and does not throw on failure.** Failures surface later as
  an `error` or `disconnected` event. This matters for the new Load handler:
  it can't be written as `try { await client.connect(url) } catch ...` the
  way the current `await client.loadWorldFromData(...)` is. It needs to
  listen for `session:ready` (success: clear `wbError`, re-enable the
  button) and `error`/`disconnected` (failure: show `wbError`, re-enable the
  button) instead of using a `finally` block.
- **`_worldBaseUrl` — used to resolve `extras.atrium.source` refs — is never
  set anywhere in the WS connect path.** `resolveExternalReferences()` is
  called both by the static loader and, again, from `_onSomDump` (i.e. on
  every WS connection, including home auto-connect and the fix in this
  brief), but it no-ops silently when `_worldBaseUrl` is null
  (`if (!this._som || !this._worldBaseUrl) return`). It's only ever set by
  `loadWorld(url)` (derived from that file's own URL) or by the manual
  `client.worldBaseUrl = ...` setter call in the `connectBtn` handler (driven
  by the unrelated `worldUrlInput` field). Nothing sets it for
  `autoConnectToHomeWorld`, and nothing will for the new Load path either,
  unless this is fixed. The code's own comment inside `_onSomDump` —
  "Re-resolve external references using the world URL from the original
  loadWorld call" — is stale: for any WS-connected world there was no
  `loadWorld` call. Not currently biting anyone (prod's commons fixture has
  zero `extras.atrium.source` refs, confirmed 2026-09-19), but it's the same
  class of bug as the two already being fixed here (state derived from the
  wrong source, or not derived at all), sits in code this fix already touches,
  and matters a great deal for cross-connect, where `worldBaseUrl` absolutely
  must be the *remote* server's origin — never the account server, never a
  manual field. See §3-6.

**Server-side routing (`packages/server/src/world-registry.js`, unchanged by
this fix, checked for compatibility)**
- `/public/<username>/<slug>` lazily creates a live host on first join and
  admits the owner even when the world is `private` (owner-only check happens
  after the visibility branch). This is what makes it usable for "load any of
  my own worlds," public or private, with no server change.
- `/ws/<id>` does **not** lazily create — it only reaches worlds that already
  have a live host (`hosts.get(id)`, 404 otherwise). This is why it isn't the
  right route for Load even though the world list already has `w.id`: most of
  a user's own worlds have no live host until someone joins them. Flagging
  this explicitly so GLM doesn't reach for `/ws/<id>` as the obvious-looking
  shortcut.
- The world list (`GET /api/worlds`) includes the `home`-slug world along with
  everything else (`listWorlds` has no slug filter). So the My Worlds list
  already contains an entry that, once Load is fixed, would connect via
  `/public/<username>/home` — functionally equivalent to the existing
  home-world auto-connect, just via a different route. See §3-5.

## 3. Decisions (resolved)

1. **Load performs a real connect**, via a new
   `buildPublicWorldWsUrl(baseUrl, username, slug)` helper in `wsUrl.js`,
   parallel to the existing `buildHomeWorldWsUrl`. `baseUrl` is the
   account-server origin (`window.location`, or the same source
   `autoConnectToHomeWorld` uses once its origin bug is fixed — see #2),
   never `wsUrlInput.value`, for the same reason `autoConnectToHomeWorld`
   shouldn't use it. The extra `fetch('/api/worlds/:id')` for the document goes
   away entirely — the WS `som-dump` already delivers it.
2. **Fix `autoConnectToHomeWorld`'s origin source in the same pass**, since
   it's the same bug (URL built from `wsUrlInput` instead of the account
   server) and touching this code without fixing it would leave a second,
   near-identical bug sitting next to the one being fixed. Confirmed.
3. **Remove the `loadBtn.disabled = client.connected` restriction.** Load
   works whether connected or not; clicking it while connected to a
   *different* world disconnects that session and connects the new one
   (`connect()` already does this). UI feedback during the swap: reuse
   `overlayEl` ("Loading…", matching manual Connect). Confirmed.
4. **`AtriumClient` becomes the source of truth for its own connection
   state — resolved as (b), broadened.** This isn't just about the Server
   box; connection state belongs on the client itself, not re-derived by
   whichever caller happens to need it. Concretely:
   - `connect(wsUrl, { avatar, displayName })` stores the full args it's
     called with (`this._connectArgs = { url: wsUrl, avatar, displayName }`
     or equivalent), not just the URL. Storing the full args now costs
     nothing and avoids a second pass later when something needs more than
     the URL (see the forward-looking cases below).
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
     No call site — including cross-connect, whenever it lands — needs to
     know a Server box exists.
   - Confirming only on `session:ready` (not at `connect()`-call time) is
     itself a correctness improvement: the box never shows a URL for a
     connection attempt that then failed.
   - Test surface: `packages/client/tests/client.test.js` has ~12
     `session:ready` assertions; none appear to assert the payload's exact
     key set, so adding `url` should be additive. GLM should add at least one
     assertion covering it and verify no existing test is checking payload
     shape strictly. `apps/playground/src/app.js` also consumes
     `@atrium/client` — unaffected today (no address box), free upside if it
     ever wants one.
   - **Forward-looking reasons this belongs on the client, not `app.js`**
     (not built now — this just shapes *where* the state lives so today's fix
     doesn't have to be redone): reconnect-on-drop would need the stored
     avatar/displayName to retry without the caller re-supplying them;
     teleporters and cross-connect both want "where did I connect from"
     available without re-deriving it from a DOM input; error logging
     currently has no way to say which server a failure was talking to;
     multiple concurrent `AtriumClient` instances (already true in
     `client.test.js`'s multi-peer tests) each need to report their own
     connection independently rather than one global `app.js` variable
     assuming a single client.
5. **Home-world list entry.** Leave it as-is (Load on it behaves like
   auto-connect, just via `/public/<username>/home` instead of
   `/home/<userId>/home`) rather than hiding/disabling it — no evidence yet
   that it's confusing in practice. Confirmed; revisit if it turns out to be.
6. **Derive `_worldBaseUrl` from the connect URL inside `connect()`**, the
   same way `loadWorld(url)` already derives it from the loaded file's own
   URL: `this._worldBaseUrl` = the connect URL's origin (or origin + path,
   matching whatever convention `resolveExternalReferences` expects — GLM
   should check against how server-relative vs. absolute `source` values
   are meant to resolve). This fits directly into decision #4's
   architecture: `connect()` already stores `this._connectArgs.url` in this
   same commit, so deriving `_worldBaseUrl` from it is a one-line addition,
   not new plumbing. Removes the silent no-op for any world (now or later)
   whose document has relative `extras.atrium.source` refs, for every
   WS-connected path — home auto-connect, the new Load, manual connect, and
   eventually cross-connect. Confirmed (2026-09-24).

## 4. Explicitly out of scope

- **Refresh silently reconnecting to home world**, overriding whatever world
  you were actually in (own non-home world, or another user's public world
  via manual Connect) — confirmed reproducible by the human for both cases.
  Root cause: `me().then(...)` unconditionally calls `autoConnectToHomeWorld`
  on every page load if logged in and not connected, with nothing checking
  "was I connected to something else before this reload." Deliberately not
  addressed here — no decision yet on whether refresh should ever preserve or
  restore the pre-refresh world, and it's a separable question from "does
  Load work and does the box stay in sync." **This fix must not change
  refresh/reload behavior**; a regression test should confirm refresh still
  goes to home world, unchanged, after this fix lands.
- Cross-server connect itself (separate, upcoming piece of work — this fix is
  a same-server rehearsal of the same disconnect/reconnect-in-place mechanism,
  not that mechanism's cross-server form).
- Any UI indicating "you were redirected" (would only be relevant if refresh
  behavior changes later).

## 5. Open questions for the brief author / critic

Resolved in review: decision #4 (Server-box sync — see §3, resolved as
broadened option (b)).

- **Q2.** Any existing `apps/client` or `packages/client` tests that assert on
  `loadBtn.disabled` state or on the old fetch-then-`loadWorldFromData` Load
  path will need updating in the same commit, not left red.
- **Q3.** Should the overlay/loading text during a Load-triggered swap be
  identical to manual Connect's, or world-list-specific (e.g. naming the
  world being loaded)? Cosmetic; leaving to GLM's judgment unless the human
  wants to weigh in.

## 6. Test expectations

- Load a different owned world while disconnected: real session, own avatar
  visible, `You:` / `Peers:` populated, Server box shows the
  `/public/<username>/<slug>` URL.
- Load a different owned world while connected to another: old session ends
  cleanly (old world's other occupants see the avatar leave), new session
  starts, HUD and Server box both reflect the new world.
- Load a private world you own: succeeds (owner admission via `/public/`
  route, unchanged server-side).
- Server box reflects the connected URL after: home auto-connect
  (login and page-load), world-browser Load, manual Connect (already true,
  guard against regressing it).
- Regression: refresh while connected to a non-home world still silently
  returns to the home world, unchanged from current behavior (see §4).
- `autoConnectToHomeWorld` still builds the correct URL when `wsUrlInput` has
  been overwritten by a dropped `.atrium.json` pointing elsewhere (this is the
  scenario the origin-source bug was found in).
- `session:ready`'s payload includes `url`, matching the URL passed to the
  `connect()` call that produced it (single-client and, given the existing
  multi-peer test pattern, two-client cases).
- A WS-connected world (any of the three connect paths) whose document
  contains a relative `extras.atrium.source` ref actually resolves it
  client-side (decision #6) — regression coverage for the currently-silent
  no-op, plus confirmation that `autoConnectToHomeWorld` and the new Load
  path no longer depend on `worldUrlInput` being incidentally filled in.
