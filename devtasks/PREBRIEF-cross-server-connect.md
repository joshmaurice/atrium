# Pre-brief: Cross-server connect (addendum Step 6)

Status: **FINAL, Revision 5. Decisions 1–11 were confirmed by the human
on 2026-09-28. #12 is done:** the human applied it to DEV and prod on
2026-09-28. Ready for the brief/critic pipeline once this file is
uploaded to `devtasks/`, together with the updated
`ADDENDUM-user-accounts-phase2.md` (its §7 points here).

Revision 5 (2026-09-28): the human confirmed decisions 1–11 as written.
Nothing else in the design changed. §3 is now marked confirmed, and #1's
alternative is marked rejected. The addendum's status line, §7 and §8 were
updated to match: Step 6 is ready for implementation, and this pre-brief
is where its decisions are recorded until the pipeline writes the full
§7.

The open questions in §5 remain the brief author's and critic's to
settle within these decisions, except where a question says it's the
human's. Q-teleport-consent is a Step 7 decision and doesn't block this
task.

Revision 4, amended (2026-09-28): the addendum was renumbered outside the
pipeline, with teleporters now §8 / Step 7 and a settled-only §7 / Step 6.
The W#13 note was added too. §8 then got the teleporter changes that
follow from decided items, including a new server-relative storage rule
for dropdown destinations, plus the open cross-server auto-trigger
question (Q-teleport-consent). #11 now covers only finishing §7 and amending
§8, and §2.11 describes the updated addendum.

Revision 4 (2026-09-28) records work done on the VPS and a design rule:
- **#12 is applied on both servers and verified** (§3 #12). The Caddy facts
  in §2.12 were checked on the VPS, not inferred. The pipeline doesn't
  apply #12; the brief only records it.
- **#2 gains a rule:** remote identity only ever affects presentation,
  never permissions.
- **New §4 entries for future work:** a "via host" label for visitors,
  connection logging (none exists today, in Node or Caddy), and verified
  remote identity.

Revision 3 (2026-09-28) folds in a second round of external review, each
point again verified against the code:
- **#1:** the manual-connect File-box rule now compares full HTTP origins.
  The only exception is a narrow one for loopback, which keeps the local
  fixture flow working. Revision 2's hostname-only rule let a stale File
  URL for `example.com:3000` apply while connecting to `example.com:3100`.
- **#2:** the scheme is a bare `http`/`https` token. Revision 2's pseudocode
  would have built `http:://host`. The forwarded value is trimmed and
  lowercased, and unrecognized values fail closed.
- **#9:** the open-world question is settled, not left to the brief
  author. `set` can't change an avatar's `extras.displayName` (or replace
  its whole `extras`) under any policy, and the guard works on parsed path
  segments.
- **#12:** the curl check forces `--http1.1`.

Revision 2 (2026-09-28) folded in external review. Each point was verified
against `main` at `1f759ce` and the deploy notes before being adopted.
- **New #12:** the public endpoint doesn't serve WebSockets at `/`, because
  of a Caddy redirect. Fixing that is now part of this task (§2.4, §2.12).
  Revision 1 wrongly said `/` needed no work.
- **#2:** identity now uses a real scheme + host + port origin comparison,
  not today's `isOriginAllowed` semantics. `Q-origin-port` is resolved and
  removed.
- **#9:** reversed. B's server-side name for a visitor is authoritative in
  this task, not deferred. This needs a protocol schema change.
- **#4:** the order of the timeout path is pinned, so it emits exactly one
  `error` and one `disconnected`.
- **#11:** teleporter destinations accept `ws://` as well as `wss://`.
- Revision 1 also added a cross-site test pair and a CORS note, after the
  human asked about non-sslip.io servers.

This is input for the brief-writing step (brief author, then critic). It is
not the brief itself.

Inputs:
- `devtasks/Atrium-Passdown-2026-09-24-cross-server-findings.md`
- `devtasks/Atrium-Passdown-2026-09-27-worldload-complete.md`
- `devtasks/PREBRIEF-worldload-address-sync.md` (decisions referred to here
  as W#1–W#15)

Code facts were verified on `main` at `1f759ce`. Files read:
- `packages/server/src/{http-routes,world-registry,session,world-host,commons,index}.js`;
- `packages/server/test/http-integration.test.js`;
- `packages/client/src/AtriumClient.js`;
- `packages/renderer-three/src/load-background.js`;
- `apps/client/src/{app,wsUrl}.js`;
- `tools/som-inspector/src/app.js`;
- `devtasks/ADDENDUM-user-accounts-phase2.md`, `docs/DESIGN-user-accounts.md`;
- `devtasks/DEPLOY-and-handoff-notes-2026-08-25.md`;
- the Public Suffix List (`publicsuffix/list`, `main`, fetched 2026-09-27).

Line numbers are approximate.

## 1. Goal

A client on a page served by server A, logged in to A (or not), can connect
its live WebSocket to a world hosted on server B **in place, without a page
reload**, and back again. This is the "same-page cross-connect" model the
human chose on 2026-09-24. Full-page navigation to B was rejected.

Cross-connect is `client.connect(<B's world URL>, …)`. Worldload already
built the lifecycle for this (W#4, W#9, W#11): connection records,
`connecting`, per-connection reset, stale-work suppression. This task makes
the rest of the stack safe for it:

1. **Server:** B admits a browser connection whose page came from another
   origin, and that connection is **always anonymous on B**. Nothing about
   A's session, or the visitor's own B session, is attached to it.
2. **Client:** everything URL-derived about the connection follows the
   *world* server (B), and everything about the account follows the
   *account* server (A, the page's origin). Nothing is read from a DOM field
   where it matters.
3. **Failure is visible.** A connect that fails, times out, or is refused
   tells the user so, naming the host.
4. **The addendum** gains the cross-server section as Step 6, and the
   teleporter section becomes Step 7 with destinations that can name another
   server.
5. **`/` works at the public endpoint.** `wss://host/` reaches that
   server's commons through Caddy (#12), so the `/` invariant holds for
   real clients, not only inside Node. **Done on DEV and prod,
   2026-09-28.**

Within this task, B also names its visitors (#9), so "anonymous on B"
holds in what users see as well as in what they're allowed to do.

### Governing invariants (from the findings, unchanged)

- `/` means "the commons of the server this connection targets". It's
  server-local, never a fixed URL, UUID or slug held in shared or client
  code.
- User ids, usernames, ownership and host keys mean something only within
  one server. Nothing treats them as global.
- No server bakes its own absolute URLs into seeded or saved documents.
- Don't extend the `/apps/client` alias, and don't add new page-path
  coupling.

## 2. Verified facts about the current code

### 2.1 Test baseline at `1f759ce`

- `packages/server`, run per file (`test/*.test.js`): 14 files, 237 tests,
  all pass.
- `packages/renderer-three`: 63/63 pass. `apps/client/tests`: 32/32 pass.
- `packages/client`: every file passes, but **`tests/client.test.js` never
  exits**. Its 33 tests pass and then a handle keeps the process alive, so
  `pnpm --filter @atrium/client test` hangs. It hung the same way at
  `107bb36`, before worldload, so it isn't a regression. Run that file with
  `--test-force-exit` until someone finds the leak.
- `packages/server/tests/external-refs.test.js` (note: `tests/`, not
  `test/`) fails 3 of 6 with `createSessionServer requires httpServer
  option`. It's outside the package's `test` script, and has been broken
  since `4572e5e` (2026-08-20) made `httpServer` required. It's orphaned, not
  a regression.

### 2.2 Server: Origin validation

- **`isOriginAllowed(req)`** (`http-routes.js` ~L32–55):
  - no `Origin` header: allowed (non-browser clients);
  - otherwise the Origin's hostname must equal the `Host` header's
    hostname, and its protocol must be `http:` or `https:`;
  - **quirk:** if the Origin has no explicit port, it's accepted whatever
    port `Host` names. The scheme isn't compared with anything, because the
    server can't see its external scheme behind Caddy.
  - `Origin: null` fails `new URL()` and is rejected.
- **It's one function with two jobs.** It is the CSRF check for the
  state-changing HTTP routes (register, login, logout, world create, update,
  delete: `http-routes.js` ~L239, ~L385, ~L491, ~L549, ~L671, ~L817), and
  the cross-site WebSocket hijacking (CSWSH) check at every upgrade. **Any
  loosening applied inside it weakens CSRF protection too.**
- **Upgrade sites:**
  - `world-registry.js` (the live server): one check at ~L166, before route
    dispatch.
  - `session.js` `createSessionServer` (~L45; used by tests, not by
    `index.js`): its own check at ~L67.
- **Pinned by a test:** `http-integration.test.js` ~L586, "WebSocket upgrade
  with cross-origin header is rejected (socket destroyed)". The HTTP CSRF
  tests next to it (~L546–583) must keep passing unchanged.

### 2.3 Server: cookies and identity

- **The auth cookie** (`setAuthCookie`, `http-routes.js` ~L886):
  `atrium_auth_session=…; HttpOnly; Secure; SameSite=Lax; Path=/;
  Max-Age=604800`. **There's no `Domain` attribute, so it's a host-only
  cookie.** The browser sends A's cookie only to A's exact host, whatever
  the SameSite setting is. (Cookies aren't port-scoped, though.)
- **SameSite compares *sites*, not origins.** A site is the scheme plus the
  registrable domain (eTLD+1, from the Public Suffix List). A
  WebSocket handshake is a subresource request, so:
  - page cross-*site* to B: B's Lax cookie is **not** sent;
  - page same-site but cross-*origin* to B: B's Lax cookie **is** sent.
- **Our deployment is all one site.** DEV is `dev.5-78-232-73.sslip.io` and
  prod is `5.78.232.73.sslip.io` (from the deploy notes). **`sslip.io` is
  not on the Public Suffix List**; the current list was checked. So the
  registrable domain is `sslip.io` for DEV, prod, and **every other server
  anyone hosts under sslip.io**. They're all the same site.
  - **Consequence:** if the Origin check were loosened with no other change,
    a page on *any* `*.sslip.io` host could open a WebSocket to our prod
    server, the browser would attach the visitor's prod cookie, and the
    connection would be authenticated as them. That includes owner-level
    mutation of their worlds, and admission to their private worlds.
  - The 09-24 findings assumed Lax keeps B's cookie off cross-origin
    handshakes. That holds only for cross-*site* pages. Our deployment makes
    the premise false (§2.10).
- **This is a fact about today's DEV/prod pair, not an assumption about
  where cross-connect will run.** Cross-connect must work between any two
  servers: same-site, cross-site, any domain. The design (#2) doesn't depend
  on the relationship. The same-site case matters here because it's the
  *hardest* one: it's the only case where the browser attaches B's cookie to
  a handshake from A's page. In the cross-site case the browser sends no
  cookie at all.
- **Identity is resolved from the cookie at upgrade time** by
  `resolveWsUserId(request, db)` (`http-routes.js` ~L951). It's called in
  five places:
  - `world-registry.js`: the `default` branch (~L196), `byWorldRowId`
    (~L211), `home` (~L244), and `public`, which serves both `/worlds/` and
    `/public/` (~L363);
  - `session.js` ~L76.
- **What identity controls on a world:**
  - admission to a private world, via `/worlds/`, `/public/` or `/ws/`: the
    owner only, otherwise 404 (~L222, ~L366);
  - `/home/<userId>/home`: anonymous gets 404 (~L247), and so does a
    mismatched user;
  - the mutation gate: under `'owner'` policy only the owner may `set`, add
    non-avatar nodes, or `remove` (`session.js` `isMutator` ~L220).
    `'read-only'` blocks everyone. Avatar adds are always allowed.
  - the server-side display name: the DB `display_name`, or `User-xxxx`
    when anonymous (`session.js` ~L270–286).
- **The `hello` message carries no credentials.** The client sends `{ type,
  id: sessionId, capabilities }`. Identity comes only from the upgrade
  cookie.
- **Non-browser clients already connect anonymously from anywhere.** They
  send no `Origin`, so they pass the check, and they have no cookie. An
  anonymous connection from a foreign page therefore gains no capability
  that a script doesn't already have.

### 2.4 Server: routes and admission (unchanged by this task)

- `resolveWorldId` recognizes:
  - `/` and `/apps/client`: `default`, the commons;
  - `/ws/<id>`;
  - `/home/<userId>/home`;
  - `/worlds/<username>/<slug>` and `/public/<username>/<slug>`. Both
    decode their segments (W#10). They are two copies of the same parsing
    code (~L97–128), which is a small W#13 deviation this task doesn't
    touch.
- **`/` reaches B's commons, inside Node and (since 2026-09-28) at the
  public endpoint.** Until #12 was applied, `wss://host/` failed through
  Caddy on both DEV and prod (§2.12).
- For an anonymous visitor on B:
  - public worlds and the commons are reachable;
  - private worlds and `/home/…` give 404;
  - mutation is refused except for the visitor's own avatar.
- **Rejections aren't distinguishable in the browser.** The server answers a
  refused upgrade with an HTTP 404 or by destroying the socket. The browser's
  `WebSocket` exposes neither: every failure looks like an `error` event
  followed by `close` with code 1006. DNS failure, TLS failure, an
  unreachable host, a 404 and an Origin rejection all look the same.

### 2.5 Client: `AtriumClient`

- **`connect(wsUrl, { avatar, displayName, worldBaseUrl })`** (~L243)
  implements W#9 as specified. It:
  - bumps the world generation;
  - marks the old record stale and closes its socket;
  - resets per-connection state;
  - emits `connecting { sessionId, url, previousSessionId }` before creating
    the socket;
  - catches a synchronous constructor throw and schedules `error` and
    `disconnected`;
  - returns the `sessionId`.
- **The derived asset base is wrong for any connect.** The code at
  ~L283–293 is:

  ```js
  const parsed = new URL(wsUrl)
  this._worldBaseUrl = `${parsed.protocol}//${parsed.host}`
  ```

  That keeps `ws:`/`wss:`. W#6 required `ws:`→`http:`, `wss:`→`https:`, and
  a trailing `/`. Checked with Node:
  - `wss://b.example/worlds/u/s` gives the base `wss://b.example`;
  - `./crate.gltf` then resolves to `wss://b.example/crate.gltf`.

  `resolveExternalReferences` (~L867) passes that to `fetch`, which rejects
  a `wss:` URL. `loadBackground` hands it to `TextureLoader`, which fails
  too. So every relative `source` ref and every relative background in any
  server-hosted world fails today, same-server or cross-server.
  - Nothing tests the derived value (W#6's test expectation "derived when
    not passed" is missing). `external-references.test.js` sets
    `_worldBaseUrl` by hand.
  - A correct helper exists, **unused and untested**:
    `wsOriginToHttpOrigin` in `apps/client/src/wsUrl.js` (~L72). It maps
    `wss:`→`https:` and *every other scheme* →`http:`. `@atrium/client`
    can't import from `apps/client`.
  - No prod world has a relative ref or background (W pre-brief §2), which
    is why DEV acceptance didn't catch this. The dev fixtures were tested
    through manual Connect, which passes an explicit base.
- **Errors and disconnects are missing some W#9 fields:**
  - `error` carries `sessionId` and `url` only on the constructor-throw path
    (~L325–330).
  - A socket `error` event (~L392–395) becomes
    `new Error(String(evt))`. In a browser that's `"[object Event]"`, with no
    `sessionId` or `url`.
  - A server `error` message (~L376–378) is emitted with no `sessionId` or
    `url`.
  - A socket close (~L385–390) emits `disconnected` with
    `reason: reason ? String(reason) : undefined`, not `'closed'`.
    Consumers can't tell a server drop from an unspecified reason.
- **There's no connect timeout.** A connect to a blackholed host stays in
  `connecting` until the OS gives up on TCP, which can take tens of seconds
  to minutes. While it's pending, the app's Connect button is disabled
  ("Connecting...").
- `disconnect()` (~L417–453) and `_onServerHello` (~L525–541) behave as
  W#9 requires. `session:ready` carries `{ sessionId, displayName, url }`.
  - That `displayName` is the **client-supplied** name, not the server's.
- **Mixed content:** on an `https:` page, `new WebSocket('ws://…')` throws
  `SecurityError` synchronously. The W#9 constructor-throw path already
  handles it. Nothing here needs a special case.

### 2.6 Client: `apps/client/src/app.js`

- **The account/world split already mostly exists.**
  - `accountWsBase = computeWsUrl(window.location)` (~L19) is the account
    server. It's declared with `let` but never reassigned.
  - Auto-connect (~L387–404) and My Worlds Load (~L180–215) build their URLs
    from it.
  - Every `/api/...` fetch is page-relative (~L149, ~L225, ~L762), so it
    always goes to the page's own origin.
  - The world server is whatever the client connected to. `session:ready`
    syncs the World box from its `url` (~L458–466).

  The findings' "a second input field or derived state?" question is mostly
  answered by W#2 and W#4. What's left is the small set of places that
  still read a DOM field (below).
- **Manual Connect** (click ~L703–718, and an identical `contextmenu`
  handler at ~L685–701) passes `worldBaseUrl` from the **File box** whenever
  that box is non-empty (W#6 did this for the dev fixtures). A manual Connect
  to B with a stale File-box value therefore resolves B's assets against the
  local file's URL. While connected, Connect acts as Disconnect, so a manual
  cross-connect is Disconnect then Connect.
- **Load has no outcome tracking** (~L189–214). It calls `client.connect()`,
  clears the overlay, and re-enables its button, all synchronously.
  W#9's "Load's listeners match the `sessionId` from its own `connect()`
  call" wasn't implemented. The `error` listener (~L492) only calls
  `console.error`. **A failed connect of any kind shows the user nothing**
  except the status dot going back to disconnected.
- **Load falls back to the user id:**
  `currentUser.username || currentUser.id` (~L196). A `/worlds/<uuid>/…`
  address always 404s, since the lookup is by username. W#2's rule for
  auto-connect is not to connect when there's no username.
- **The toolbar Load has an unreachable branch** (~L640–659): "WS world URL
  while connected". It builds `/worlds/<me or 'anonymous'>/<File-box text>`
  against `accountWsBase`. `setConnectionState('connected')` (~L370)
  disables `loadBtn`, so the branch can't run.
- **The World box is written in three places:**
  - its initial value (~L16);
  - `loadAtriumConfig` (~L553), from `config.world.server`;
  - `session:ready`.

  The 09-27 passdown's "nowhere else" is inaccurate, but the behavior fits
  W#4: text in the box is a pending destination.
- **The `disconnected` handler** (~L484–490) statically reloads the File box
  if it's non-empty. That covers every `disconnected`, including a failed
  connect.
- **Logout** (~L736–739) calls `logout()` on the account server, then
  `client.disconnect()`. So logging out while on B leaves B.
- **Auto-connect** runs after login/registration (~L122) and at page load
  (~L904). It returns early if `client.connected` is true, so logging in to
  A while connected to B leaves you on B.
- **Backgrounds:** `loadBackground(..., client.worldBaseUrl || '')`
  (~L438, ~L523). That's the W#7 deviation the 09-27 passdown noted.

### 2.7 Client: display names

- `connect()` puts the caller's `displayName` into
  `_avatarDescriptor.extras.displayName`, and `session:ready` reports it
  (HUD `You:`).
- The server stores the avatar node **verbatim** on `add` (`session.js`
  ~L446–471). It checks only `node.name`.
- **Peers see two different names:**
  - peers already present get `join` with the server's name, the DB
    `display_name` or `User-xxxx` (`AtriumClient` ~L694);
  - peers who arrive later read the avatar node from `som-dump`, and
    `AvatarController` labels it from `extras.displayName` (~L123), which
    is the client-claimed name.
- This already happens for anonymous users on one server. Cross-connect
  makes *every* visitor an anonymous user with a claimed name, which can
  match one of B's own usernames.
- **The server `hello` can't carry a name today.**
  `packages/protocol/src/schemas/hello.server.json` allows `type`, `id`,
  `seq`, `serverTime`, `worldStartTime`, `avatarNodeName` and `capabilities`,
  with `additionalProperties: false`. The server builds `hello` in
  `session.js` ~L309.
- **`set` is owner-gated, except in open worlds.** `set` calls
  `isMutator(session, false)` (`session.js` ~L406), so in `'owner'` worlds
  only the owner can `set` any node, avatars included. `'open'` policy is
  the default when a world has no owner and no explicit policy
  (`session.js` ~L211): legacy and `WORLD_PATH` dev worlds. There, anyone
  can `set` anything, including another avatar's fields.

### 2.8 `tools/som-inspector`

- It connects only manually (~L450–463). It passes `worldBaseUrl` from its
  File box when that's non-empty, like `apps/client`, and it writes its
  World box from `.atrium.json` (~L344).
- Its `loadBackground` calls use `client.worldBaseUrl || ''` (~L245, ~L309)
  and `client.worldBaseUrl` (~L81).
- **It's the one real cross-origin client today.** DEV doesn't serve it
  (09-27 passdown), so it runs from a local static server, and its Origin
  (`http://localhost:…`) is rejected by DEV and prod. After #2 it can
  connect to DEV anonymously.

### 2.9 `packages/renderer-three/src/load-background.js`

- With a falsy `baseUrl`, it falls back to `globalThis.location.href`
  (~L33–36) instead of warning (the W#12 deviation). For a remote world with
  no base, a relative background would resolve against **A's page**, and so
  load A's asset into B's world. After #3 a WebSocket world always has a
  base, so this remains reachable only for `loadWorldFromData` (dropped
  files).

### 2.10 Corrections to the input passdowns

To the **09-24 findings**:

- The `/` invariant: the findings (and Revision 1 of this pre-brief) treat
  `wss://B/` as reaching B's commons. It does inside Node, but not through
  Caddy (§2.12). #12 fixed that on 2026-09-28.
- §4, "Cookies already behave correctly … Lax … don't ride along on a
  cross-origin WebSocket handshake": **wrong for our deployment** (§2.3).
  - A's cookie never reaches B because it's host-only, not because of Lax.
  - B's own cookie *does* ride along from any same-site page, and all
    sslip.io hosts are one site.
- §4, the "loosen the Origin check" framing: `isOriginAllowed` is shared
  with the HTTP CSRF check (§2.2), so it can't simply be loosened.
- §4, "Client needs a real account-server/world-server split": largely done
  by worldload (§2.6).
- §3: all four groundwork items landed, but the asset-base derivation
  landed wrong (§2.5).

To the **09-27 worldload passdown**:

- "`wss:` mapped to `https:`": **not on `main`** (§2.5).
- "Every lifecycle event carries [the sessionId]": socket and server
  `error`s don't (§2.5).
- "The World box … is synced from `session:ready` and nowhere else": also
  written at startup and by `loadAtriumConfig` (§2.6).
- Not listed as outstanding:
  - Load's `sessionId` outcome listeners (W#9);
  - the `disconnected` `'closed'` reason (W#9);
  - the missing derived-base test (W#6);
  - the addendum's `/worlds/` note (W#13; `docs/DESIGN-user-accounts.md`
    ~L438 has it, the addendum doesn't).

### 2.11 Docs

- `ADDENDUM-user-accounts-phase2.md`: **updated 2026-09-28** (see #11).
  The facts below describe that updated version, which the human commits
  alongside this pre-brief.
  - §7 is "Cross-server world loading (Step 6)", marked **design
    confirmed 2026-09-28; ready for implementation**. It points here for
    the decisions, and holds an interim summary: same-page cross-connect,
    `/` as a deployment requirement (with our Caddy fix), and the 09-24
    invariants.
  - §8 is "Teleporter placement (Step 7)". Its destination is a dropdown
    of the owner's worlds, saved as server-relative paths, plus a
    free-text field for a server-relative path or another server's URL.
    It has a "Decided in the Step 6 design, and written here by the Step 6
    work" line covering accepted URL forms and relative resolution.
  - The trigger "reconnects in place (§7)". Cross-server auto-triggering
    is recorded as an open question. It still asks for "a friendly
    client-side error" when a destination fails.
  - The sequencing list runs to "7. Teleporter placement (§8)".
  - The status line says "Final — ready for implementation, including §7",
    points to this pre-brief as authoritative, and notes the
    renumbering.
  - §5 now says `/worlds/<user>/<slug>` is canonical, with `/public/` as an
    alias. §1 (~L39) still mentions `/public/` as the example path, which
    is fine now that §5 defines both.

### 2.12 Deployment

- There's no Content-Security-Policy anywhere (no `<meta>` tag, and none in
  the deploy notes), so no `connect-src` blocks cross-origin sockets.
- Caddy routes WebSockets to Node with a header-based `@websocket` matcher.
  `reverse_proxy` passes the client's `Origin` and `Host` through, and by
  default sets `X-Forwarded-Proto` from the client connection. By default it
  also replaces any `X-Forwarded-*` values sent by clients that aren't
  trusted proxies. Node doesn't read `X-Forwarded-Proto` today. It does
  trust `x-forwarded-for` unconditionally, for rate limiting
  (`http-routes.js` ~L152).
  - **The Caddyfiles aren't in the repo.** They live only on the VPS, and
    prod's config has drifted from DEV's before (deploy notes, 2026-08-25
    §"Next steps" item 8). Header behavior must be checked on the live
    vhosts, not assumed (§6).
- **Checked on the VPS, 2026-09-28:**
  - **The service:** Caddy v2.11.4, running as `caddy.service` with
    `caddy run --environ --config /etc/caddy/Caddyfile`. It has no
    `import`s, and the admin API is on (reloads go through it).
  - **The Caddyfile has two site blocks:** prod proxies to `localhost:3000`
    (the first block, around L11–44) and DEV to `localhost:3100` (the
    second, around L46–80 after the #12 edit). Each block has:
    - `@websocket` (`header Connection *Upgrade*` plus
      `header Upgrade websocket`), and `handle @websocket` proxying to
      Node;
    - `handle` blocks for `/api/*`, `/apps/client/*`,
      `/tools/protocol-inspector/*` and `/packages/*`;
    - a `redir` at `/` (now the #12 form);
    - a catch-all `handle`.
  - **Access logging is off.** There's no `log` directive, `caddy adapt`
    gives no `"logs"` key, and `/var/log/caddy/` is empty. The journal
    carries only Caddy's own TLS and ACME lines.
  - `caddy validate` warns that the file isn't `caddy fmt`-formatted
    (around L12). It's cosmetic.
  - **Backups on the VPS:** `/etc/caddy/Caddyfile.bak-2026-09-28` (from
    before #12) and `/etc/caddy/Caddyfile.bak-2026-09-28-dev-done` (with
    DEV changed, prod not yet).
- **Until 2026-09-28, `wss://host/` didn't reach Node** (deploy notes
  2026-08-25, "Round 2"; `BUG-step1-connect-regression-2026-09-13.md`
  ~L55). Both site blocks had a bare top-level `redir / /apps/client/ 302`.
  Caddy's adapter reorders bare directives by type, and `redir` sorts
  ahead of `handle`. So a WebSocket upgrade at exactly `/` was redirected
  before `handle @websocket` could match, and a WebSocket handshake can't
  follow a redirect. #12 fixed this.
  - The app worked around it: `computeWsUrl` appends `location.pathname`,
    so the page's own connects go to `/apps/client/…`, which the `default`
    route accepts. That still works and stays as it is.
- Node listens on all interfaces (`index.js` ~L91: `listen(port)`, with no
  host). Whether ports 3000 and 3100 are reachable directly depends on the
  VPS firewall, which isn't documented here. That matters for which
  headers can be trusted (#2).
- DEV and prod are two separate Node servers on the same VPS. That's a
  natural cross-server pair for acceptance (§6). They are same-site, so they
  can't cover the cross-site case by themselves (§6).
- **Nothing sends CORS headers.** There's no `Access-Control-*` header in
  the server code or the Caddy notes. Caddy serves only the client's static
  paths and 404s everything else, and Node serves no static files.
  - Consequence for assets: after #3, a relative asset in B's world
    resolves to `https://B/…` and is fetched from A's page. That is a
    cross-origin request whatever the site relationship. `fetch` uses
    `cors` mode, and `TextureLoader` sets `crossOrigin = 'anonymous'`. So
    the asset host must send `Access-Control-Allow-Origin`, and today no
    Atrium host does.
  - Same-server worlds with absolute asset URLs on another host already
    have this requirement.
  - Where server-stored worlds' assets live, and how they're served, is out
    of scope (W §4, and §4 here). The pre-brief only records that
    cross-server asset loading needs CORS from the asset host.

## 3. Decisions (confirmed by the human, 2026-09-28)

1. **Cross-connect is a plain `connect()`. No new client lifecycle
   primitive.**
   - Any entry point that targets a world on another server calls
     `client.connect(url, { avatar, displayName })` with a full
     `ws(s)://host/…` URL, and **never passes `worldBaseUrl`**. The base is
     derived from the URL (#3).
   - W#9 and W#11 already cover replacement, staleness and teardown. Don't
     re-spec them; test them across origins (§6).
   - **The entry point in this task is the World box (manual Connect), plus
     the connect-outcome helper (#5) that teleporters will reuse in Step 7.**
     No new picker or directory UI.
   - **Manual Connect's File-box base only applies to the same origin.**
     Convert the connect URL to its HTTP origin with #3's helper
     (`ws:`→`http:`, `wss:`→`https:`). Pass `worldBaseUrl` from the File
     box only when the File URL's origin equals that origin; otherwise
     derive it. Origin means scheme, hostname and effective port.
     - **One narrow exception, for local fixtures:** when *both* hostnames
       are loopback, the ports may differ. Loopback means `localhost`, an
       address in `127.0.0.0/8`, or `[::1]`, compared after URL parsing.
       The schemes must still match after conversion. This keeps the dev
       fixture flow working: a File box on `http://localhost:<static
       port>/…` with Connect to `ws://localhost:3000`.
     - Without the exception, a stale File URL for `example.com:3000`
       (server A) would apply while connecting to `example.com:3100`
       (server B). That's a legitimate cross-server arrangement, so a
       hostname-only rule isn't enough.
     - A leftover File-box value can no longer redirect B's assets to any
       other server.
     - The same rule applies in both apps, as a small shared pure helper
       with tests. Anything that fails to parse means "derive".
     - **Rejected alternative:** keep today's rule, and document that the
       File box governs manual-connect assets. It's simpler, but the bug
       stays silent.
2. **B admits cross-origin browser connections, and they are always
   anonymous on B.**
   - **Split the policy.** `isOriginAllowed` stays exactly as it is, and it
     stays the CSRF check for the HTTP routes. WebSocket upgrades stop
     calling it as a gate.
   - **Add one upgrade-identity helper,** e.g.
     `resolveUpgradeUserId(request, db)`, built on a new
     `isSameOriginUpgrade(request)`. It returns the cookie's user only when
     the upgrade is same-origin, and `null` otherwise.
     - **No `Origin` header:** cookie identity may be used, the same as
       today (non-browser clients).
     - **`Origin` present:** it must be a **real origin match**, meaning
       scheme, hostname and effective port are all equal. **Do not reuse
       `isOriginAllowed`'s semantics** (§2.2). They don't compare scheme,
       and they accept a port-less `Origin` against any `Host` port.
     - **The server's own origin comes from the browser-facing scheme plus
       the `Host` header.** `scheme` is a **bare token, `http` or
       `https`, with no colon**:
       - `X-Forwarded-Proto` present: take its first comma-separated value,
         then `trim()` and lowercase it. `http` or `https` are used as-is.
         **Any other value means not same-origin** (fail closed, so the
         connection is anonymous). Don't fall back to `http`.
       - `X-Forwarded-Proto` absent: `http`, since Node itself serves
         plain HTTP.
     - **Compare via the URL parser, not string splitting:**
       `new URL(originHeader).origin === new URL(`${scheme}://${host}`).origin`,
       where `scheme` is the bare token (so it builds `http://host`, never
       `http:://host`).
       That handles default ports, hostname case and bracketed IPv6.
       Today's `split(':')` breaks on IPv6. Any parse failure, or
       `Origin: null`, means not same-origin.
     - **Trusting `X-Forwarded-Proto` is safe here.** A web page can't set
       headers on a WebSocket handshake, so a hostile page can't forge it.
       Caddy also replaces the values untrusted clients send (§2.12). A
       non-browser client that forges it gains nothing beyond what the
       no-`Origin` rule already gives it: its own cookie, if it has one.
     - **A loud failure mode, not a silent one:** if Caddy doesn't set
       `X-Forwarded-Proto`, every `https:` page looks cross-origin. Every
       user would then connect anonymously, and home auto-connect would 404
       for everyone. The DEV acceptance catches this immediately (§6).
     - All five `resolveWsUserId` call sites (§2.3) use the helper. There's
       no per-branch logic.
     - `resolveWsUserId` itself is unchanged, or is folded into the new
       helper.
   - **Upgrades are no longer refused because of `Origin`.** Any `Origin`
     value, including `null` (from `file://` pages and sandboxed iframes),
     reaches route dispatch as an anonymous connection.
   - **Why this is safe:** an anonymous cross-origin connection can do
     exactly what a script with no `Origin` header can already do today
     (§2.3). The CSWSH protection moves from "reject the socket" to "never
     attach an identity to it". That holds however browsers treat SameSite,
     third-party cookies or the Public Suffix List, so it doesn't depend on
     the fact that sslip.io is one site.
   - **The rule is by origin, never by site.** Nothing in the
     implementation may compare registrable domains, consult the Public
     Suffix List, or special-case any domain (sslip.io included). A
     same-site B and a cross-site B go through the identical code path.
     They differ only in whether the browser happened to attach a cookie,
     which the server then ignores.
   - **Why not an allowlist:** an allowlist that admits the cookie still
     needs every listed origin to be trustworthy with the visitor's
     session. Under the server-local identity model (§1), no foreign page
     should carry B's session at all.
   - **Intended consequences**, which the addendum states:
     - cross-origin visitors can't reach private worlds or `/home/…`, even
       when they own them on B and are logged in to B in the same browser.
       They get 404.
     - they can't mutate anything except their avatar;
     - they appear under B's anonymous name, `User-xxxx`, to everyone,
       including themselves (#9).
   - **Rule: remote identity only ever affects presentation.** "Remote
     identity" means anything about who a visitor is on another server:
     their username or display name on A, the server they came from,
     whether claimed by their client now or vouched for by A someday.
     - **B may use it to *show* a visitor:** a label such as
       `User-ab12 · via a.example`, a badge, grouping in a list.
     - **B never uses it to decide what a visitor may *do*:** no access to
       private worlds, no mutation rights, no ownership, and it never maps
       to a B user id.
     - **Example:** accounts `josh` on A and `josh` on B are unrelated,
       even if they're the same person. A visitor from A's page is never
       treated as B's `josh` on the strength of anything A says. Otherwise
       whoever runs or compromises A could grant themselves access on B.
     - **What it doesn't rule out:** a later, explicit federation feature,
       such as an owner on B inviting `josh@a.example` to edit a world.
       That would be its own design. The rule is that it never happens
       *automatically* because a visitor arrives with an identity
       attached.
     - This task adds no remote-identity presentation (§4). The rule is
       recorded now so that later work, and the addendum, start from it.
   - **Don't touch cookie attributes.** No `Domain`, and no change to
     `SameSite`.
3. **Fix the asset-base derivation (W#6), in its own commit with tests,
   before anything that depends on it.**
   - Move the URL→HTTP origin helper into `@atrium/client`. It must be pure
     and must never throw.
     - Mapping: `ws:`→`http:`, `wss:`→`https:`. `http:` and `https:` pass
       through, since browsers accept them in `new WebSocket()`. Any other
       scheme, or an unparseable URL, gives `null`.
     - Output is the origin plus a trailing `/`.
   - `connect()` uses it when `worldBaseUrl` isn't passed.
   - `apps/client` imports it from `@atrium/client` instead of keeping its
     own copy, or re-exports it. The existing `wsOriginToHttpOrigin` isn't
     used, so it can be removed. Brief author's call.
   - This fixes every server-hosted world's relative refs and backgrounds,
     same-server included. Cross-server gets `https://B/` automatically.
4. **Finish W#9's event contract.**
   - **Every `error`** emitted by `AtriumClient` for a connection is an
     `Error` carrying `sessionId` and `url`. That covers socket errors,
     server `error` messages, and the existing constructor-throw path.
     - For a socket error, the message says something useful, e.g.
       `WebSocket error connecting to <host>`, not `"[object Event]"`.
     - Server `error` messages keep their `CODE: message` text and gain a
       `code` property.
   - **`disconnected` on a server or network close** has
     `reason: 'closed'`. The WebSocket close `code`, and the close reason
     string if there is one, go in separate fields (e.g. `code`,
     `closeReason`).
   - **Add a connect timeout in `AtriumClient`.** If a record hasn't
     reached `session:ready` within N ms, where N is a constructor option
     with a default the brief author picks (e.g. 15 s), the timeout path
     runs **in this order**:
     1. clear the timer;
     2. mark the record terminal (`stale` and `closing`), so `onClose` and
        `onError` ignore everything the socket does next (their guards are
        at `AtriumClient.js` ~L383 and ~L393). A browser that closes a
        `CONNECTING` socket fires `error` and then `close`;
     3. clear the current-connection state, the same fields `onClose`
        clears;
     4. call `ws.close()`;
     5. emit `error`, then `disconnected` with `reason: 'timeout'`.

     The result is **exactly one** `error` and **exactly one**
     `disconnected`, and never a second one with `reason: 'closed'`. A
     superseded or disconnected record's timer is cleared and never fires,
     and so is the timer of a record that reaches `session:ready`.
5. **Connect outcomes are visible, through one app-level helper.**
   - `apps/client` gets a small helper, e.g.
     `trackConnect(sessionId, { onReady, onFail, onSuperseded })`. It
     implements W#9's original Load-listener clause:
     - `session:ready` with that `sessionId` means success;
     - `error` or `disconnected` with that `sessionId` means failure;
     - `connecting` whose `previousSessionId` is that id means superseded:
       no error;
     - it removes its listeners in every outcome.
   - **Used by:** My Worlds Load, manual Connect and auto-connect. The Step 7
     teleporters will use it too.
   - **On failure,** show a visible message that names the target *host*.
     Load uses `wbError` as it does today; manual Connect and auto-connect
     use the overlay. For example: "Couldn't connect to b.example". The
     message **doesn't claim a cause**, since the browser can't tell a 404
     from a down server (§2.4). A timeout can say it timed out.
   - Load's button stays disabled until its own outcome arrives, not just
     until `connect()` returns.
6. **A failed cross-connect leaves you disconnected. There's no automatic
   return to the previous world.**
   - The user sees the #5 message and the normal disconnected state. My
     Worlds and the World box are still there to go anywhere, including
     home.
   - **Why not auto-return:** returning means reconnecting to the previous
     URL. That can fail too, can mask the original failure, and needs a
     policy for "previous" when that was also remote. `connecting` and
     `sessionId` make it easy to add later as its own decision.
   - **Unchanged:** the `disconnected` handler's static reload of the File
     box also runs after a failed connect (§2.6). That's existing
     behavior, out of scope (W §4).
7. **The account server and the world server are two distinct values in
   `apps/client`, and the remaining DOM reads go.**
   - **Account server:** `accountWsBase` (make it `const`) plus
     page-relative `/api` fetches. It serves auth, My Worlds (list, Load,
     create, delete) and home auto-connect. **Loading one of your own worlds
     while on B takes you back to A.** That's correct: My Worlds lists A's
     worlds.
   - **World server:** the connected record's URL, as reported by
     `session:ready`. Nothing in the app keeps a separate copy.
   - **Load:** drop the `|| currentUser.id` fallback (§2.6). No username
     means no connect, the same as W#2.
   - **Toolbar Load:** remove the unreachable "WS world URL while
     connected" branch (§2.6). It builds account-server URLs from File-box
     text, and nothing specifies it.
   - **Logout while on B** disconnects from B (unchanged, §2.6).
   - **Logging in to A while on B** stays on B, still anonymous there. This
     is deliberate: auto-connect doesn't replace a live connection. Both
     cases go on the DEV checklist.
8. **Server-relative addresses resolve against the *current world's*
   server.**
   - This applies to any destination written as a path (`/`, `/worlds/u/s`)
     rather than a full URL. That covers teleporters in Step 7, and a path
     typed into the World box, if the brief author supports that.
   - Such a path resolves against the **origin of the connected world's
     URL**, not `accountWsBase`. So a teleporter in a world on B that says
     `/` goes to B's commons, which is the `/` invariant (§1).
   - When nothing is connected, a path resolves against `accountWsBase`.
   - Add a pure `resolveWorldAddress(dest, currentWorldUrl, accountWsBase)`
     helper with tests now. Teleporters will depend on it. Full `ws(s)://`
     URLs pass through unchanged; `http(s)://` URLs are rejected (null)
     rather than guessed at.
9. **B is authoritative over a visitor's visible name, in this task.**
   Once cross-connect is normal, a visitor who is anonymous on B can appear
   under an account name from A, and that name can match a different B
   account (§2.7). "Anonymous on B" has to be true in the UI as well as in
   permissions.
   - **Protocol:** add an optional `displayName` (string) to
     `hello.server.json`. The server always sends its session name: the DB
     `display_name`, or `User-xxxx`. Add protocol schema tests for accepting
     it and for rejecting other properties, which stays the rule.
   - **Server:** on an avatar `add` (which has `msg.id`), set the stored and
     broadcast node's `extras.displayName` to the session's server-side
     name. This overwrites the client's value, and adds it if absent,
     before storing and broadcasting. Nothing else in the node changes.
     `join` already carries the server name, so both paths now agree.
   - **Client:** `_onServerHello` adopts `msg.displayName` (when present) as
     the session's name *before* emitting `session:ready`. It updates
     `_displayName` and `_avatarDescriptor.extras.displayName`, so
     `session:ready.displayName`, the HUD `You:` and the avatar the client
     sends all agree with B. An old server that sends no `displayName`
     leaves the client's name as it is.
   - **The caller's `displayName` becomes a request, not a claim.** On the
     account server it matches anyway (same DB row). On B it's replaced.
   - **Visible change:** anonymous users on the *same* server now also see
     themselves as `User-xxxx`, which peers already saw.
   - **Avatar names can't be changed with `set`, under any policy
     (settled).** If `set` could rename an avatar after the add, "B names
     visitors" wouldn't be an invariant. `'open'` still means open for
     world content. It doesn't mean one session can overwrite another's
     server-assigned identity.
     - **The guard:** reject `set` with `PERMISSION_DENIED` when the target
       node is an avatar node and the field's **parsed** path is either
       exactly `['extras']` (replacing the whole object) or starts with
       `['extras', 'displayName']`. An avatar node is one whose name equals
       the `avatarNodeName` of a live session in this world.
     - **It applies to everyone:** the session's own avatar, other
       avatars, and the world owner in an `'owner'` world. It runs before
       `isMutator` or independently of it, so no policy bypasses it.
     - **Use the parsed path, never string prefixes.** `SOMDocument.js`'s
       `parsePath` (~L8) tokenizes with `/([^.[]+)|\[(\d+)\]/g`, which skips
       empty segments. So `extras..displayName` and `.extras.displayName`
       both mean `['extras', 'displayName']`. `parsePath` isn't exported
       today. Export it, or a thin wrapper, from `@atrium/som` and use it in
       the guard, so the guard and `setPath` can't disagree.
     - **Everything else is unchanged:** other avatar fields
       (`extras.<other>`, transforms) and every non-avatar node follow the
       existing policy.
     - **Out of scope:** `add` or `remove` of *other* sessions' avatar nodes
       in open worlds. `remove` is policy-gated today, and a non-avatar
       `add` of an avatar-named node is its own question.
10. **Renderer and app hygiene, in the code #3 touches:**
    - Both apps pass `client.worldBaseUrl` through as-is at every
      `loadBackground` call site, with no `|| ''` (W#7).
    - `loadBackground` drops its page-URL fallback. A relative texture with
      no base warns and returns (W#12). The page fallback is how a base-less
      remote world would load A's asset (§2.9).
    - Remove `apps/client`'s duplicate `contextmenu` Connect handler, or
      make it call the same function as click. Brief author's call. It's an
      identical copy (§2.6).
    - Update every comment and JSDoc these decisions make untrue. In
      particular: `isOriginAllowed`'s policy block (it's no longer applied to
      WebSocket upgrades), the `connect()` JSDoc on base derivation, and the
      CSRF note's "if a future cross-origin deployment is needed".
11. **Addendum: finish §7 (Step 6) and amend §8 (teleporters, Step 7), in
    the same task, as a doc-only commit.**
    - **Already done by the human on 2026-09-28, outside the pipeline:**
      - teleporters renumbered to §8 (Step 7), with every "§7"
        cross-reference updated;
      - the sequencing list updated;
      - a renumbering note added to the status line, which says Step 6 is
        ready for implementation and points here for its decisions;
      - the W#13 `/worlds/`-is-canonical note added to §5;
      - a §7 "Cross-server world loading (Step 6)" section added, marked
        design-confirmed and ready, with an interim summary: same-page
        cross-connect (09-24), `/` as a deployment requirement and how our
        Caddy meets it (09-28), and the 09-24 invariants;
      - §8 updated with what follows from decided items:
        - destinations may be on another server;
        - **the dropdown saves server-relative paths**
          (`/worlds/<user>/<slug>`), never absolute URLs of this server,
          per the "no baked absolute URLs" invariant;
        - "navigates" now reads "reconnects in place (§7), not by loading
          a new page";
        - the cross-server auto-trigger question is recorded as open
          (Q-teleport-consent).

      The pipeline doesn't redo any of this.
    - **Replace §7's interim summary with the full section,** and remove
      the pointers to this pre-brief from the status line and from §7's
      opening line. Keep what §7 already says. Its content comes from #1–#9 and #12:
      - same-page cross-connect;
      - anonymous-on-arrival, and why;
      - asset base follows the world server;
      - visible failure with no auto-return;
      - account server vs world server;
      - relative addresses follow the current world's server;
      - B names visitors (#9);
      - `/` is a working WebSocket endpoint on every server (#12). State
        this as a **deployment requirement**: any Atrium server behind a
        reverse proxy must pass WebSocket upgrades at `/` through to Node,
        and not redirect them. Say how our Caddy config meets it;
      - the presentation-only rule for remote identity (#2).
    - **Complete §8's destination rules,** replacing its "Decided in the
      Step 6 design, and written here by the Step 6 work" line: the free-text field accepts a
      server-relative path (resolved per #8) or a full `ws://` or `wss://`
      URL, so localhost and dev teleporters aren't excluded.
      "Navigates" means `connect()` in place, and "friendly error" means
      the #5 helper, which names the host without claiming a cause. The
      "reconnects in place" wording is already there.
    - Historical devtasks files stay as they are. The addendum's status
      line already warns that older files use the old numbering.
12. **WebSocket upgrades at `/` reach Node through Caddy, on DEV and on
    prod. APPLIED 2026-09-28 by the human, on both servers, and
    verified.**
    *(It was required: without it, the `/` invariant was false at the real
    endpoint, §2.4.)*
    - **What was done:**
      1. DEV's block first: back up, edit, `caddy validate`, reload,
         verify.
      2. Then prod's block the same way, with its own backup (§2.12).
      3. In each block, the bare `redir / /apps/client/ 302` was replaced
         with the snippet below.
    - **Verified on each host:**
      - a `curl --http1.1` WebSocket upgrade to `https://<host>/` gives
        `101 Switching Protocols`;
      - a plain `curl --http1.1 -sI https://<host>/` gives `302` to
        `/apps/client/`;
      - the page loads normally in a browser.
    - **For the brief and pipeline:** nothing to apply. Record #12 as done,
      and keep the §6 browser checks that need cross-origin connects,
      since those depend on #2. **Rollback** is copying the relevant
      backup over `/etc/caddy/Caddyfile` and reloading.
    - **The change:** a WebSocket upgrade whose path is exactly `/` goes to
      Node. An ordinary browser request to `https://host/` keeps
      redirecting to `/apps/client/`.
    - **The form used doesn't depend on Caddy's directive ordering:** the
      redirect gets a matcher that excludes upgrades, built from the same
      header check `@websocket` uses. This is what's in both blocks now:

      ```
      @rootpage {
        path /
        not header Connection *Upgrade*
      }
      redir @rootpage /apps/client/ 302
      ```

      Wrapping the directives in an explicit `route` block that keeps
      `handle @websocket` first would also have worked. The deploy notes
      recommend `route` for bare directives in general. Either way, future
      Caddy edits shouldn't rely on textual order for bare directives.
    - **Keep `computeWsUrl`'s `location.pathname` workaround.** It's
      harmless, and removing it isn't needed. Don't extend the
      `/apps/client` alias (§1).
    - **Verify with curl** before any browser check, e.g.
      `curl --http1.1 -si -H 'Connection: Upgrade' -H 'Upgrade: websocket'
      -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: <16 bytes
      b64>' https://<host>/`. The expected response is `101` from Node, not
      a `302`. A plain `curl --http1.1 -si https://<host>/` still gives the
      `302`. `--http1.1` matters: `101` is the HTTP/1.1 upgrade path, and
      Caddy's classic WebSocket matcher is the HTTP/1.1 form (`Connection:
      *Upgrade*` plus `Upgrade: websocket`). HTTP/2 WebSockets use the
      separate `:protocol` form. Forcing HTTP/1.1 avoids an ambiguous
      result from ALPN negotiation.

## 4. Out of scope

- Teleporters themselves (Step 7). This task only amends their spec (#11)
  and provides #5 and #8.
- Any cross-server *identity*: federated login, carrying A's account to B,
  signed visitor tokens. Visitors are anonymous on B (#2).
- Automatic return to the previous world after a failed connect (#6).
- Committing the Caddyfiles to the repo (Q-caddy). #12 changed them in
  place on the VPS.
- **Any remote-identity presentation**, e.g. a "via a.example" label. B
  could derive the origin host from the `Origin` header on the upgrade.
  A web page can't forge that header, although a non-browser client can.
  It needs no client claims, and it fits #2's presentation-only rule. It
  does tell other peers where a visitor came from, which is a small
  privacy trade-off for its own decision. A *claimed* handle (the
  client telling B its A username) is deliberately not proposed: it would
  let anyone pose as A's users.
- **Verified remote identity:** A vouching for a user with a short-lived
  signed statement that B checks against A's published key. That brings
  key publishing and rotation, replay protection, and B making outbound
  requests to hosts that visitors name. It's the first step of
  federation, and under #2's rule it would still only affect
  presentation.
- **Connection logging.** Today there's none (§2.12, and Node logs no
  per-connection events; refused upgrades are silent). Two separable
  options for later:
  1. **A Node-side operational line per upgrade outcome:** route kind and
     world, admitted or refused and why, identity class (authenticated,
     anonymous same-origin, anonymous cross-origin) and the origin host,
     with no IP and no names. It's the only place identity outcomes are
     visible. It would help diagnose #2's `X-Forwarded-Proto` failure
     mode and support DEV acceptance.
  2. **Caddy access logging** (a `log` block per site). It records client
     IP, path, status, duration and request headers, `Origin` included,
     with cookie and authorization headers redacted by default. Its
     WebSocket entries are written when the connection *closes*, with
     status `101` and the session length as duration.
     - Recommended settings when it's enabled: `format filter` with
       `ip_mask` on `request>remote_ip` and `request>client_ip`, file
       output under `/var/log/caddy/` with explicit `roll_keep_for`, and
       optionally `log_skip` for static paths.
     - IP masking and retention are the human's decisions, and should be
       made before enabling it.
- A server directory, browse or search UI.
- Refresh while on B still returns to the home world on A (the refresh
  behavior is unchanged, as in W §4).
- Where assets for server-stored worlds should live, and serving them with
  CORS headers so another server's page can load them (§2.12).
  Cross-server worlds with relative assets will 404 on them until that's
  decided.
- Operator configuration for rejecting cross-origin sockets (Q-switch).
- The duplicated `/worlds/` / `/public/` parsers, removing the `/public/`
  alias, whether usernames belong in world addresses, and the static reload
  on `disconnected`.
- Fixing `client.test.js`'s leaked handle and the orphaned
  `packages/server/tests/`. Record them. Fixing them is welcome in a
  separate commit, but not required.

## 5. Open questions for the brief author / critic

- **Q-switch.** Should operators be able to turn off cross-origin
  WebSockets (e.g. an env var) for a closed server? Under #2 there's no
  security reason to, but there may be product or abuse reasons. The
  default, if one is added, is *on*.
- **Q-caddy.** Should the Caddyfile be committed to the repo (e.g.
  `deploy/Caddyfile`, a single file with both site blocks, as on the VPS),
  so that a config change like #12 is reviewable and drift is visible? The
  structure is now known (§2.12). It isn't required for this task.
- **Q-firewall.** Are Node's ports (3000, 3100) reachable from outside the
  VPS (§2.12)? #2's trust in `X-Forwarded-Proto` is safe either way, but
  the answer belongs in the deploy notes.
- **Q-teleport-consent** (a Step 7 decision, recorded in addendum §8 as
  open). Should a teleporter whose destination is on another server
  trigger automatically on proximity?
  - Auto-triggering connects a visitor to the owner-chosen server without
    a deliberate choice. That reveals their IP, their origin server and
    the name their client sends. Under #9, Atrium servers overwrite the
    name, but other servers needn't.
  - **Suggested:** same-server destinations trigger automatically;
    other-server ones ask first.
  - It doesn't block Step 6. #5 and #8 work either way.
  - **A related Step 6 point for the brief author:** should the client
    send its account-server display name on a cross-origin connect at all,
    given that #9 overwrites it on Atrium servers? Sending a neutral
    placeholder there would avoid disclosing it to non-Atrium servers.
    It's cheap. Brief author's call, unless the human decides otherwise.
- **Q-timeout.** The default for #4's timeout, and whether auto-connect
  uses a different value.
- **Q-hud.** Should the HUD show the world server's host when it isn't the
  account server (e.g. `World: Plaza @ b.example`)? It's cosmetic; the
  World box already shows the full URL.
- **Q-harness.** `apps/client` and `tools/som-inspector` still have no DOM
  harness. Put the #5 helper and the #1 and #8 URL helpers in pure modules
  so they're unit-testable, and keep everything else on the DEV checklist.
- **Q-servers.** Automated cross-origin tests can run two real servers on
  different ports and set the `Origin` header by hand on a `ws` client
  (the `ws` package allows it). Prefer that to shims. Timing control for #4
  uses the injected `WebSocket` (W Q-ordering).
- **Q-split.** Suggested commit order:
  1. #3, the base fix plus its tests. It's valuable on its own.
  2. #4, the client event contract plus the timeout.
  3. #2, server-side, with the rewritten upgrade tests.
  4. #9: protocol schema, then server, then client.
  5. #10's renderer part (`loadBackground`).
  6. #1, #5, #7, #8 and #10's app part: the app-level changes.
  7. #11, the addendum.

  #12 is already applied on both servers (2026-09-28), so it isn't part of
  the commit sequence.
- **Compatibility of #9:** `AtriumClient` doesn't validate incoming
  messages against the schema, and the server doesn't validate its
  outgoing `hello` (its `validate()` calls cover `leave`, `join`,
  inbound client messages and `set`). So an old client ignores
  `hello.displayName`, and a new client connected to an old server keeps
  its own name. Both directions are safe during a staggered DEV/prod
  deploy.

## 6. Test expectations

Automated:

- **The HTTP-origin helper (#3)** covers `ws`, `wss`, `http`, `https`, a
  port, a path, a query, another scheme (null) and garbage (null), and
  never throws. The output ends in `/`.
- **`connect()` without `worldBaseUrl`** sets the base to
  `https://b.example/` for `wss://b.example/worlds/u/s`, and to
  `http://localhost:3000/` for `ws://localhost:3000/`.
  - It's replaced on the next `connect()`.
  - An explicit `worldBaseUrl` is still used as-is.
- **A WebSocket world with a relative `source`** makes `fetch` receive
  `https://…/crate.gltf`, not a `ws(s):` URL. This is the missing W#6 test.
- **Errors (#4):**
  - a socket error, a server `error` message and a constructor throw each
    give an `Error` with `sessionId` and `url`;
  - server errors keep their `CODE: message` text and have `code`.
- **Close (#4):** a server-initiated close gives `disconnected` with
  `reason: 'closed'` and the close `code`.
- **Timeout (#4), with an injected `WebSocket` that never opens:**
  - after N ms: `error`, then `disconnected` with `reason: 'timeout'`, and
    the socket is closed;
  - **exactly one** `error` and **exactly one** `disconnected` for that
    `sessionId`. The fake socket then fires its own `error` and `close`
    events after `close()` is called, as a browser does for a `CONNECTING`
    socket. They produce nothing: no second `disconnected`, and no
    `reason: 'closed'`;
  - a `connect()` or `disconnect()` before N means it never fires;
  - reaching `session:ready` before N clears it.
- **Manual-connect base rule (#1), as a pure helper:**
  - File `https://example.com/w/` with Connect `wss://example.com/…`: the
    File base is passed;
  - File for `example.com:3000` with Connect to `example.com:3100`
    (`https`/`wss`): **derived**, not passed. This is the case Revision 2
    got wrong;
  - File `https://example.com/…` with Connect `ws://example.com/…`:
    derived (scheme);
  - different hostnames: derived;
  - loopback exception: File `http://localhost:8080/…` with Connect
    `ws://localhost:3000`: passed. The same holds for `127.0.0.1` and
    `[::1]`, and for mixed loopback names (`localhost` against
    `127.0.0.1`);
  - loopback with a scheme mismatch (File `https://localhost:8443/…` with
    Connect `ws://localhost:3000`): derived;
  - only one side loopback: derived;
  - an empty File box, or an unparseable URL: derived.
- **`resolveWorldAddress` (#8):**
  - a path with a connected `wss://b/…` gives `wss://b/<path>`;
  - a path with nothing connected resolves against `accountWsBase`;
  - `/` gives B's root;
  - a full `ws(s)` URL passes through;
  - `http(s)`, empty and garbage give null.
- **Upgrade identity (#2), server, per file, with two real servers or one
  server with a hand-set `Origin`:**
  - same-origin plus a valid cookie is authenticated. The owner can mutate
    their world and reach their private world;
  - **cross-origin plus a valid cookie is anonymous**:
    - a private world gives 404;
    - `/home/<id>/home` gives 404;
    - a public world admits the connection, and a `set` gets
      `PERMISSION_DENIED`;
    - the display name is `User-xxxx`;
  - an `Origin: null` upgrade is admitted anonymously;
  - **the cross-origin cases run with both kinds of `Origin`:** a same-site
    sibling (e.g. `https://other.<host's domain>`) and an unrelated domain
    (e.g. `https://example.net`). Both give identical results;
  - no `Origin` header with a cookie is still authenticated (unchanged);
  - **rewrite** `http-integration.test.js` ~L586: a cross-origin upgrade is
    now *accepted and anonymous*, not destroyed;
  - **the HTTP CSRF tests (~L546–583) pass unchanged.** Add one: a
    cross-origin `POST /api/worlds` with a valid cookie still gets 403;
  - apply the same cases to `createSessionServer` (`session.js`).
- **Strict origin matching (#2), as a pure unit test of
  `isSameOriginUpgrade`:**
  - `Origin: https://h` with `Host: h` and `X-Forwarded-Proto: https`:
    same;
  - `Origin: http://h` with `Host: h` and `X-Forwarded-Proto: https`: **not**
    same (scheme);
  - `Origin: https://h` with `Host: h` and no `X-Forwarded-Proto`: not same
    (Node's own scheme is `http:`);
  - `Origin: https://h` with `Host: h:3000` and `X-Forwarded-Proto: https`:
    not same (port). **Today's `isOriginAllowed` accepts this case**;
  - `Origin: http://localhost:3000` with `Host: localhost:3000` and no
    `X-Forwarded-Proto`: same;
  - `Origin: https://h:443` with `Host: h` and `X-Forwarded-Proto: https`:
    same (default port);
  - hostname case differences: same;
  - bracketed IPv6 with a port: correct in both directions;
  - `X-Forwarded-Proto: https, http`: the first value is used;
  - `X-Forwarded-Proto: " HTTPS "` against `Origin: https://h`: same
    (trimmed and lowercased);
  - `X-Forwarded-Proto: wss`, `ftp`, or an empty string: **not** same,
    even when `Origin` would otherwise match (fail closed, no fallback to
    `http`);
  - no `X-Forwarded-Proto` with `Origin: http://localhost:3000` and
    `Host: localhost:3000`: same. This guards against the `http:://`
    construction bug;
  - `Origin: null`, a garbage `Origin`, and a garbage `Host`: not same, and
    no throw.
  - A matching integration case: a WebSocket upgrade with a valid cookie
    and a scheme-mismatched `Origin` is anonymous.
- **Visitor names (#9):**
  - **protocol:** `hello` with a `displayName` string validates; with
    another unknown property, it still fails;
  - **server:** an anonymous session's `hello` carries `User-xxxx`, and an
    authenticated session's carries the DB `display_name`;
  - **server:** an avatar `add` whose `extras.displayName` is `"Mallory"`
    is stored and broadcast with the session's server name. A later
    joiner's `som-dump` shows the server name, and so does `join`;
  - **server:** an avatar `add` with no `extras` gets
    `extras.displayName`, and other `extras` fields are kept;
  - **client:** `_onServerHello` with `displayName` makes
    `session:ready.displayName` and the outgoing avatar descriptor carry
    the server's name. A `hello` with no `displayName` leaves the caller's
    name unchanged;
  - **The avatar-name `set` guard,** in an `'open'` world unless noted.
    Each rejected case gets `PERMISSION_DENIED`, and nothing changes or is
    broadcast:
    - `set` of `extras.displayName` on *another* session's avatar:
      rejected;
    - the same on the sender's own avatar: rejected;
    - `set` of `extras` (the whole object) on an avatar: rejected;
    - `extras..displayName` and `.extras.displayName`: rejected (parsed
      path);
    - in an `'owner'` world, the owner setting a visitor's
      `extras.displayName`: rejected;
    - `set` of another avatar field (e.g. `translation`) in an open world:
      unchanged, accepted as today;
    - `set` of `extras.displayName` on a *non-avatar* node: unchanged,
      follows policy;
    - after an avatar's session leaves (the node is gone), there's no
      special case: `NODE_NOT_FOUND` as today.
- **Cross-origin replacement (W#9 across servers):** connect to server A,
  then to server B on another port. B is current, A's host sees the session
  leave, and there's no `disconnected` for A. Then connect back to A: the
  base follows each server.
- **Stale async work across servers (W#11):** A's external-ref fetch,
  resolved after the move to B, doesn't ingest into B.
- **`loadBackground` (#10):** a relative texture with a null base warns and
  doesn't touch `location`.

Manual DEV acceptance (DEV and prod are the cross-server pair; see the
ordering note):

- **#12, remaining browser checks.** The curl checks passed on both
  servers on 2026-09-28 (§3 #12).
  - **Same-origin (possible now):** typing `wss://<DEV host>/` into the
    World box on the DEV page lands in DEV's commons, and the same on
    prod.
  - **Cross-origin (needs #2 deployed on the target server):** typing
    `wss://<prod host>/` from the DEV page lands in prod's commons,
    anonymous there. Typing `wss://<DEV host>/` from the prod page lands
    in DEV's.
- **Same-origin identity still works (#2):** logged in on DEV, a refresh
  auto-connects to your DEV home world, authenticated. If the home world
  404s, `X-Forwarded-Proto` isn't reaching Node, and #2 is failing closed
  (§3 #2). Stop and fix the Caddy side before continuing. Logging the
  forwarded headers once on DEV is a quick way to confirm.

- **Before prod is deployed,** from the **prod** page, log in and type a
  DEV world URL (`wss://dev.5-78-232-73.sslip.io/worlds/<user>/<slug>`) into
  the World box, then Connect.
  - The old prod client can do this, and it only needs DEV's server change.
  - Your HUD, and a second browser already on DEV, both show you as
    `User-xxxx`, not your prod display name. Your label doesn't change
    for a third browser that joins after you (#9). Because the old prod
    client ignores `hello.displayName`, its own HUD still shows the prod
    name in this pre-deploy run. Recheck the HUD from the DEV page after
    deploy.
  - You arrive **anonymous** on DEV even though you're logged in to DEV in
    the same browser. The two hosts are same-site, so this is the real test
    of #2.
  - A DEV world you own and have made private fails to connect. The old prod
    client shows only the status dot. The #5 message is checked from the
    DEV page below.
- **After deploy, from the DEV page:**
  - connect to a prod public world, and back to your DEV home via My Worlds;
  - check that there's no flash of the disconnected UI, no stale labels,
    and the old world's occupants see you leave. The World box shows each
    full URL.
- **Cross-site pair.** DEV and prod are same-site (§2.3), so they only test
  the hard case. Also run one cross-site pair, meaning two hosts under
  different registrable domains. The cheapest is a second hostname for the
  same VPS under another wildcard-DNS domain (e.g. a `nip.io` name for the
  same IP). Caddy serves the DEV client there with its own certificate. From
  that page, connect to DEV and to prod.
  - You arrive anonymous, exactly as in the same-site case.
  - The World box, HUD, peers and leave/arrive behave identically.
  - This needs a Caddy config addition, so it's a deploy step, not code.
    If it's not practical, record the cross-site case as covered only by
    the automated `Origin` tests.
- **Assets, same-server and cross-server:** use a world document with a
  relative background and relative `source` refs (e.g. upload
  `atrium.gltf`'s content into a DEV world). The page's network log shows
  the requests going to `https://<world host>/…`, **not** `wss:` and not the
  page's own directory.
  - They then 404, because no Atrium host serves world assets (§2.12), and
    each logs one warning. That's the expected outcome here. Asset hosting
    and CORS are out of scope.
  - The `space-ext`/`atrium` local fixture flows still load their assets
    (W checklist).
- **Failures, each showing a visible message that names the host:**
  - a nonexistent host;
  - a firewalled or blackholed port (the timeout message appears after N);
  - an unknown slug on a real server;
  - `ws://` from the `https:` page (mixed content).

  In every case you end up disconnected, with no auto-return.
- **Load failure:** My Worlds Load on a world deleted in another tab shows
  `wbError`, and the button re-enables.
- **Superseding:** start a connect to a blackholed host, then Load a world
  before the timeout. You land in the world with no error.
- **Account vs world while on B:**
  - My Worlds lists A's worlds, and Load goes to A;
  - log out on A: you leave B;
  - log in on A while on B: you stay on B, still anonymous.
- **Log out, then log in as another user in the same window** (the W
  checklist item, repeated). Start from a remote world as well as a local
  one.
- **Refresh while on B** returns to A's home world (unchanged).
- **Manual Connect base rule:** with the File box holding a local fixture
  URL, connect to a *remote* world. Its assets resolve against the remote
  host. The `space-ext` and `atrium` fixture flows still work locally
  (W checklist).
- **Inspector, run locally:** connects to a DEV public world anonymously.
  This also does the SOM-inspector smoke test the 09-27 passdown deferred.
- **Addendum:** Step 6 is cross-server and Step 7 is teleporters, with the
  amended destination text and the `/worlds/` note.
