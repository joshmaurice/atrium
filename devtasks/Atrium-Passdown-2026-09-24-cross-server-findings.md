# Findings: Cross-Server World Loading (prep, not yet a brief or addendum section)

Date: 2026-09-24. Status: discussion/analysis only — nothing here has been
written into `ADDENDUM-user-accounts-phase2.md` yet. The addendum currently
numbers teleporters as Step 6; the plan (confirmed, not yet executed) is to
insert cross-server loading before it, renumbering teleporters to Step 7.
Drafting that addendum section was deliberately deferred in favor of the
Load-button/Server-box fix (`PREBRIEF-worldload-address-sync.md`), which was
done first specifically as groundwork — see §3.

## 1. Decision already made: same-page cross-connect, not full navigation

Confirmed by the human. "Cross-server world loading" means: a client on one
page, authenticated against server A, can connect its live WebSocket to a
world hosted on server B, in place, without a page reload. The alternative
(teleporting = navigating the browser to a page served by B) was considered
and rejected — a full reload drops all client-side state (avatar, camera,
in-memory session continuity) and defeats the point of a portal feeling
continuous. This decision shapes everything below: it requires the client to
genuinely separate "the server my account lives on" from "the server the
current world is hosted on," which today are conflated into one `wsUrlInput`
field.

## 2. Governing invariants

Stated by the human and agreed: work here must not bake in "the current
server is the permanent server."

- `/` means "the commons of the server this connection targets" — server-
  local, never a fixed URL/UUID/slug held in shared or client code.
- User ids, usernames, ownership, and host keys are meaningful only within
  one server; nothing should treat them as global.
- Don't bake a server's own absolute URLs into seeded or saved documents.
- Don't extend the `/apps/client` alias or add new page-path coupling.

## 3. Groundwork already in flight (from the Load-button/Server-box fix)

The Load-button fix (`PREBRIEF-worldload-address-sync.md`, all 6 decisions
now confirmed, ready for GLM) was chosen specifically because it rehearses
the same mechanism cross-connect needs, same-server first:

- `AtriumClient.connect(wsUrl, opts)` already calls `disconnect()` first if a
  connection exists — the disconnect-then-reconnect-in-place swap, on one
  page, already works mechanically. Nothing about *that* part needs new
  design; cross-connect is "the same swap, different origin."
- `AtriumClient` will store its full connect args (`url`, `avatar`,
  `displayName`) and expose `url` on the `session:ready` payload, with
  `app.js` syncing the Server box from one listener. This gives cross-connect
  a ready-made place to compare "where I was" vs. "where I'm going" without
  re-deriving it from a DOM input each time.
- `_worldBaseUrl` (used to resolve relative `extras.atrium.source` refs) will
  be derived from the actual connect URL inside `connect()`, the same way
  `loadWorld(url)` already derives it from a loaded file's own URL. This
  generalizes correctly to cross-server for free: when cross-connect calls
  `connect()` with a remote URL, asset resolution follows that remote
  origin automatically, rather than a manual field or the account server.
- A known bug is being fixed in the same pass: `autoConnectToHomeWorld`
  currently builds the home-world URL from `wsUrlInput`'s origin instead of
  the account server's. Left unfixed, this becomes a live cross-server bug —
  connect to a world on server B (which sets `wsUrlInput` to B), and the next
  home-world reconnect would send server A's user UUID to server B and 404.

None of this is cross-server-specific work; it's the same-server version
of the exact primitives cross-connect will call.

## 4. Requirements identified, not yet built or spec'd

- **Origin check must loosen, carefully.** `isOriginAllowed`
  (`packages/server/src/http-routes.js`) currently requires the browser's
  Origin to equal the server's own Host — this rejects a cross-origin
  WebSocket handshake from a page served by A trying to reach B. This needs
  to change for cross-connect to work at all, and needs care: too broad an
  allowlist (e.g. treating same-domain subdomains as trusted) could let
  cookie-authenticated connections through unintentionally.
- **Cookies already behave correctly, and this should be preserved, not
  undermined by the Origin fix.** Session cookies are `SameSite=Lax`, so
  they don't ride along on a cross-origin WebSocket handshake. A visitor
  connecting from A to B therefore naturally arrives on B anonymous — which
  is exactly right for the server-local identity model (§2). Whatever the
  Origin-check change ends up being, it should not accidentally start
  sending A's cookies to B.
- **Client needs a real account-server/world-server split.** Today
  `wsUrlInput` serves both roles (the origin for `/api/...` fetches is
  always `window.location`, same-origin; the origin for the live world
  connection is whatever's typed into the box) only because they're always
  the same host in practice. Cross-connect needs these to be two genuinely
  independent values the client tracks.
- **Teleporter destinations need an addendum amendment.** The addendum's §7
  (teleporter placement, to become Step 7 once renumbered) currently
  describes the destination as free-text "full path." It needs to explicitly
  support either a server-relative path or a full `wss://` URL, since
  teleporters are the most likely UI for triggering a cross-connect once
  built. This amendment hasn't been drafted.

## 5. Not yet decided

- The exact shape of the Origin allowlist change (what counts as "trusted,"
  how narrow).
- How the client should represent/store "account server" vs. "world server"
  concretely (a second input field? derived state? something else).
- Whether/how the addendum's new cross-server section should describe
  fallback behavior if a target server is unreachable or rejects the
  connection.
- The actual addendum section itself — content above is analysis to draft
  from, not the section text.

## 6. Sequencing reminder

Confirmed order: cross-server world loading (new Step 6) before teleporters
(renumbered Step 7) — teleporters need cross-server addressing to be
meaningful as a "jump to another server" mechanism.
