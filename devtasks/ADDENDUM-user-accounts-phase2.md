# Addendum: Phase 2 — Home Worlds, Auto-Save, and the Commons

Status: Final — ready for implementation, **including §7 (Step 6,
cross-server world loading).** Its design was confirmed on 2026-09-28.

Renumbered 2026-09-28: cross-server world loading was inserted as Step 6
(§7), and teleporter placement moved from Step 6 (§7) to Step 7 (§8).
Older devtasks files (passdowns, briefs) that say "Step 6" for
teleporters refer to the old numbering.

This addendum resolves the architectural and product decisions Phase 2 of
`DESIGN-user-accounts.md` left open. It exists so that implementation work
(brief-writing, review, and coding) has firm ground to build on instead of
having to originate these decisions per step. Read alongside
`docs/DESIGN-user-accounts.md` and `docs/ADDENDUM-user-accounts-final.md`.

## Why this matters more than the Phase 2 bullet list suggests

The base design doc lists Phase 2's items (home world auto-create, auto-load,
auto-save, visibility toggle, public URLs) as if they were independent. They
aren't. All of them depend on one capability the server doesn't have today:
hosting more than one live, mutable world at a time. Right now the server
loads exactly one world once, at boot, from `WORLD_PATH`, and every
connection joins that same instance — `index.js` holds one `world` reference
for its entire lifetime. Persistence, as it exists in Phase 1, is a
completely separate idea from that live world: saving takes a snapshot of
the one live world and freezes it into a DB row. There is no code path that
turns a saved snapshot back into something people can actually join and
mutate. Building that — a server that can host several such live instances
at once, created and torn down as people come and go — is the real
prerequisite underneath everything else in this phase.

The good news: `createWorld()` and `createSessionServer()` are already
written as factory functions, not singletons — each call produces an
independent instance. The singleton behavior is purely a boot-time choice in
`index.js`, calling each once. What's missing is a registry above them, and
a routing step to decide which instance a given connection belongs to.

## 1. Multi-world hosting (Step 1)

- Introduce a server-side registry mapping `worldId -> { world, sessions }`.
  `createWorld()` / `createSessionServer()` get called once per instance
  instead of once for the whole process.
- **Routing:** every connection — whether via home-world auto-load on login
  or a visit to `/public/<user>/<slug>` — resolves to one `worldId` and goes
  through this same registry, regardless of entry path. The client already
  threads the browser's URL path into the WebSocket URL
  (`computeWsUrl` builds `wss://host + path`); the server's `upgrade`
  handler currently ignores `request.url` entirely. That handler's own
  comment already flags it as "the seam for later... validation at upgrade
  time" — routing resolution belongs at that same seam, using the path plus
  the already-resolved `upgradeUserId`.
- **Lifecycle (general rule):** create an instance on first join. Tear it
  down after the last session leaves and its final save has flushed (see
  §4). No world instance should sit resident in memory with nobody in it.
- **Capacity:** no hard cap on concurrent live instances for now. This is a
  stated decision, not an oversight — revisit if it becomes an actual
  resource problem.
- **This step must also carry the permission change in §2.** Multi-world
  hosting and the owner-only mutation gate land together, in the same step
  — not sequentially — so there is never a window where many live,
  personally-owned worlds exist with no authorization on who can change
  them.

## 2. Mutation authorization (also Step 1)

Today, `send` (setField), `add`, and `remove` — the only ways to mutate a
live world — have **no authorization check at all**. `session.userId` is
tracked but never consulted in these handlers. This is harmless today
because the one shared world belongs to nobody. It stops being harmless the
moment worlds are personally owned.

- **Decision: mutation rights are owner-only, full stop**, for every world,
  including the commons (§6). The check is a single comparison: does this
  session's `userId` match this world's `owner_user_id`?
- **No admin/privilege system.** The commons is made to work under this
  same rule by being owned by a real account (§6), not by adding a second
  authorization path.
- **Visitors (non-owners)** retain: view rights, control of their own
  avatar (already governed by existing avatar-identity matching, untouched
  by this change — avatar nodes are explicitly ephemeral and never
  persisted to the canonical document), and the ability to trigger
  teleporters. Teleporter triggering causes **no server-side mutation** —
  it's the visiting client's own decision to navigate, so it needs no
  authorization at all (§8).
- **Explicitly out of scope for Phase 2:** any visitor-triggered action
  that *does* cause a real, server-synced change (buttons, toggles, doors,
  anything beyond navigation). That is general interactivity/scripting
  territory — the deferred `ATRIUM_user_object` extension work — and the
  base design doc is already explicit that its open questions "should not
  be solved simultaneously with auth and persistence." Do not build a
  per-node "visitor may trigger this" permission mechanism in Phase 2; there
  is nothing in this phase that would use it.

## 3. Home world (Step 2)

- Represented as a **reserved slug, `"home"`, per user** — not a new schema
  column. Reuses the existing slug-addressing scheme worlds already have.
- **Auto-created on first login if missing**, with the default content
  already specified in the base design doc (empty skybox, ground plane,
  avatar).
- **Auto-loaded** into the multi-world registry (§1) when the owner logs
  in, using the same resolution path as any other world.

## 4. Auto-save (Step 3)

Three distinct mechanisms, each solving a different failure mode:

- **Debounced save on mutation.** Don't write to the DB on every single
  change — restart a short timer on each mutation, and only save once
  things go quiet. Avoids hammering the database during active editing.
  Suggested default: ~30s. This is a tunable default, not a fixed
  requirement.
- **Disconnect-save as an immediate flush.** When the *last* session in a
  world leaves, save immediately rather than waiting out the debounce
  window — otherwise a clean disconnect mid-edit could lose the tail end of
  changes before the instance is torn down.
- **Periodic save as a crash safety net**, independent of the above. A
  disconnect-flush only fires on a *clean* disconnect; it doesn't help if
  the server process itself crashes or the network dies uncleanly. A
  save on a regular interval, regardless of debounce state, bounds the
  worst-case loss to that interval rather than "everything since the last
  successful save." Interval not pinned down — pick something reasonable
  and revisit if needed.

**Important dependency:** because mutation rights are owner-only (§2) and
avatar movement is never persisted, the *only* thing that can ever produce
a saveable change is the owner's own edits. Without §8 (teleporter
placement), there is no owner-facing editing feature in the product at all
— the auto-save mechanism can be built and correctness-tested via the
existing automated test suite or via `tools/som-inspector` before §8 lands,
but it will not do anything meaningful for a real user until it does.

## 5. Visibility and public sharing (Step 4)

This is smaller than it looks, because Phase 1 already laid groundwork for
it on purpose. The `worlds` table already has a `visibility` column,
currently locked to `'private'` by an explicit CHECK constraint added
specifically to defer this decision.

- Relax or replace that constraint to also allow `'public'`.
- Add an owner-facing way to toggle it (extending the existing world-update
  endpoint is the natural fit).
- **Public worlds are reachable at `/public/<user>/<slug>`.** Since the
  worldload work (2026-09-27), `/worlds/<user>/<slug>` is the canonical
  address, and `/public/` is still accepted as an alias. Both follow the
  same visibility and ownership rules.
- Connection-time routing (§1) must check visibility + ownership before
  admitting a non-owner session: private worlds admit only their owner;
  public worlds admit anyone.

### What shipped (Step 9)

- **Server-sent failure reasons (V2–V4):** every admission refusal now
  completes the WebSocket upgrade and sends `WORLD_UNAVAILABLE` with
  message `"World not available"` before closing with 1008. The byte-
  identical reason applies to every admission gate (unknown user, unknown
  slug, private world, home-path mismatch, `/ws/<id>` no-host or
  private). Server-side failures (host creation failure, degraded-mode
  503) still respond with plain HTTP. A dedicated `WebSocketServer` per
  registry handles refusal upgrades; it is closed by `registry.close()`.
- **Eviction on switch to private (V5):** after a successful `PUT` that
  sets `visibility: 'private'`, the live host (if any) disconnects every
  connection whose `userId` does not match the world's `ownerUserId`,
  including sockets that haven't sent `hello` yet. Each evicted
  connection receives `WORLD_NOW_PRIVATE` before a 1008 close.
- **isCommons in world list (V7):** `GET /api/worlds` returns
  `isCommons: true/false` per row, computed from `getRootWorldId()`,
  not stored.
- **Client wording helper (V8):** `codeToReason(code)` maps
  `WORLD_UNAVAILABLE` and `WORLD_NOW_PRIVATE` to human-readable
  sentences. `teleportFailureMessage` accepts an optional `code`
  parameter. Every connect surface (teleport, Go back, My Worlds Load,
  manual Connect) shows code-specific wording when available; without a
  known code, today's generic text is preserved.
- **Eviction listener (V8):** when `WORLD_NOW_PRIVATE` arrives for a
  session that already reached `session:ready`, a failure panel is shown
  with Dismiss only, naming the destination.
- **Visibility toggle (V6):** each row in the My Worlds list has a
  `role="switch"` checkbox marked "Public" / "Private". On change it
  `PUT /api/worlds/:id` with the new visibility; on success it refreshes
  the list, on failure it restores the previous state and shows the
  error. The commons row is locked public with a tooltip.
- **Protocol enum (V9):** `error.json` schema now includes
  `WORLD_UNAVAILABLE`, `WORLD_NOW_PRIVATE`, and the previously-missing
  `SESSION_CONFLICT`.

## 6. The commons (Step 5)

**Decision: keep it, don't retire it.** The strongest reason is the first
visitor problem — an anonymous, not-yet-registered person needs somewhere
to land that isn't a login screen, or Atrium stops being a walk-in shared
space and becomes an account-gated app. (The Phase 3 backlog's mention of
"remembered-guest identity... anonymous sessions that persist" also points
toward anonymous access being a long-term feature, not an accident of the
current architecture.)

- **Ownership: the operator's own account** — a real `owner_user_id`, same
  as any other world. This reuses the plain owner-only rule from §2
  unchanged. No admin/privilege system was introduced for this; that
  option was considered and rejected as more scope than needed for a
  problem a normal account ownership already solves at this project's
  current scale. (If broader delegation is ever actually needed — more than
  one person able to edit it — build real admin privileges then, as its
  own well-motivated feature, not preemptively here.)
- **Seed content:** migrate whatever is currently live under `WORLD_PATH`
  in production into this world's row.
- **Lifecycle exception:** unlike ordinary worlds (create-on-join,
  teardown-on-empty), the commons is loaded eagerly at server boot and
  never torn down. It needs to be reliably present for a stranger's first
  visit, not spun up cold on demand.
- **Routing:** resolves to the bare root path, using the same
  already-existing path-threading and routing seam described in §1.

## 7. Cross-server world loading (Step 6)

**Design confirmed 2026-09-28.** Background is in
`devtasks/Atrium-Passdown-2026-09-24-cross-server-findings.md`. Below, **A**
is the server whose page the client loaded, and **B** is the server hosting
the world it joins.

- **Same-page cross-connect** (decided 2026-09-24). A client moves to a
  world hosted on another Atrium server by reconnecting its live
  connection in place, from the page it's already on. It doesn't navigate
  the browser to the other server's page.
  - It's an ordinary `connect()` to B's full `ws://` or `wss://` URL.
    There's no separate client lifecycle for it: replacing, abandoning and
    tearing down a connection work the same as for any other connect.
- **Visitors are anonymous on arrival.** B accepts WebSocket connections
  whose page came from another origin, but attaches the session cookie's
  identity only to a **same-origin** upgrade: the `Origin` header's
  scheme, hostname and port all equal B's own, with B's browser-facing
  scheme taken from `X-Forwarded-Proto`. A cross-origin visitor is always
  anonymous on B, even if they're logged in to B in the same browser.
  - So a cross-origin visitor can't reach private worlds or `/home/…` on B,
    even ones they own there (they get 404). They can't change anything
    except their own avatar, and they appear under B's anonymous name.
  - **Why:** the protection against cross-site WebSocket hijacking moves
    from refusing the socket to never attaching an identity to it. An
    anonymous cross-origin connection can do exactly what a script sending
    no `Origin` could already do. That holds however browsers treat
    cookies, so it doesn't depend on cookie or site policy.
  - The rule is by origin, never by site. Nothing compares registrable
    domains or consults the Public Suffix List, there's no allowlist, and
    cookie attributes are unchanged. `isOriginAllowed` remains the CSRF
    check for HTTP routes only.
- **Remote identity only ever affects presentation.** Remote identity is
  anything about who a visitor is on another server: their name on A, the
  server they came from, whether their client claims it or A someday
  vouches for it.
  - B may use it to *show* a visitor, such as a label, a badge or grouping
    in a list.
  - B never uses it to decide what a visitor may *do*: no access to private
    worlds, no mutation rights, no ownership, and it never maps to a B user
    id. Accounts `josh` on A and `josh` on B are unrelated, even if they're
    the same person. Otherwise whoever runs or compromises A could grant
    themselves access on B.
  - A later, explicit federation feature (say, an owner on B inviting
    `josh@a.example` to edit a world) would be its own design. It never
    happens automatically because a visitor arrives with an identity
    attached.
- **B names its visitors.** The server tells each client its session name
  in `hello` (the account's display name, or `User-xxxx`), puts that name
  on the visitor's avatar, and refuses any `set` that would change an
  avatar's name, under every world policy. The name a client asks for is a
  request, not a claim. As a result, anonymous users also see themselves as
  `User-xxxx` on their own server, as their peers already did.
- **The asset base follows the world server.** A world's relative assets
  and backgrounds resolve against the HTTP origin of the server hosting it,
  derived from the connect URL. A File-box base applies to a manual Connect
  only when it's on the same origin (loopback hosts may differ in port, for
  local fixtures). Nothing falls back to the page's own URL, so a remote
  world never silently loads A's assets.
- **Failure is visible, and there's no automatic return.** Every entry
  point that connects (My Worlds Load, manual Connect, auto-connect, and
  the teleporters in §8) reports the outcome through one app-level helper.
  - A connect that fails, is refused or times out shows a message naming
    the target host. It doesn't claim a cause, since a browser can't tell a
    missing world from a server that's down. A timeout can say it timed
    out.
  - The client is left disconnected. It doesn't try to return to the
    previous world: that can fail too, can hide the original failure, and
    needs a rule for what "previous" means. It can be added later as its
    own decision.
- **The account server and the world server are separate.** The account
  server (A) serves login, My Worlds and home auto-connect. The world
  server is whichever server the current connection targets.
  - Loading one of your own worlds while on B takes you back to A. That's
    correct: My Worlds lists A's worlds.
  - Logging out while on B disconnects from B. Logging in to A while on B
    leaves you on B, still anonymous there.
- **Server-relative addresses follow the current world's server.** A
  destination written as a path (`/`, `/worlds/<user>/<slug>`) resolves
  against the origin of the connected world, not the account server. So `/`
  in a world on B means B's commons. With nothing connected, it resolves
  against the account server. Full `ws://` and `wss://` URLs are used
  as-is, and `http://` or `https://` URLs are rejected rather than guessed
  at.
- **`/` is a working WebSocket endpoint on every server:** it's that
  server's commons (§6). This is a **deployment requirement**: any Atrium
  server behind a reverse proxy must pass WebSocket upgrades at `/`
  through to Node, not redirect them.
  - Our Caddy config meets this since 2026-09-28. In each site block, the
    redirect of `/` to `/apps/client/` has a matcher that excludes upgrades
    (`path /` plus `not header Connection *Upgrade*`, the same header check
    `@websocket` uses). A plain request to `/` still redirects, and an
    upgrade reaches Node, whatever order Caddy applies the directives in.
  - The proxy must also send `X-Forwarded-Proto` (Caddy does by default).
    Without it, every `https:` page looks cross-origin, so every user would
    connect anonymously and home auto-connect would fail for everyone.
- **Invariants** (from the 2026-09-24 findings):
  - `/` means "the commons of the server this connection targets". It's
    never a fixed URL, id or slug held in shared or client code.
  - User ids, usernames, ownership and host keys mean something only
    within one server.
  - No server bakes its own absolute URLs into seeded or saved documents.

## 8. Teleporter placement (Step 7)

The one owner-facing editing feature in Phase 2, and deliberately the
*only* one. This is scoped narrowly on purpose: it is not a general
object-placement or world-editing system. If that's wanted later, it's a
separate, well-motivated feature — don't build it speculatively here.

- **Owner-only placement UI**, visible only in the owner's own world: a
  "Place Teleporter" affordance, click-to-place against the ground plane.
- Mechanically an ordinary `add` — a new node with a default placeholder
  visual (a ring or pad is enough), flowing through the same
  now-owner-gated pipeline as any other edit.
- **Destination:** a dropdown of the owner's own other worlds (the existing
  worlds-list endpoint already supports this) plus a free-text field.
  - **The dropdown saves a server-relative path,** such as
    `/worlds/<user>/<slug>`, never an absolute URL of this server. That
    follows the §7 invariant that no server bakes its own absolute URLs
    into saved documents, and it keeps the teleporter valid if the world is
    served under another hostname.
  - **The free-text field** accepts either a server-relative path (someone
    else's public world on this server, or `/` for the commons), or a full
    URL of a world on **another server** (§7).
  - **Accepted forms:** a server-relative path, resolved against the
    current world's server (§7), or a full `ws://` or `wss://` URL.
    `ws://` is accepted so that localhost and dev teleporters work. An
    `http://` or `https://` URL is rejected.
    - So a teleporter in a world on B that says `/` leads to B's commons,
      including for a visitor whose page came from A.
  - No public-worlds directory/browse feature is being built for this —
    that's separate, larger, unbuilt scope. Destination sharing works the
    same way any URL sharing does elsewhere.
- **Trigger:** pure client-side proximity detection. When any avatar gets
  close, that client moves to the destination by **reconnecting in place**
  (§7), with an ordinary `connect()`, not by loading a new page. No new protocol message and no server
  round-trip — the teleporter's position already syncs the normal way.
- **Cross-server teleporters trigger automatically too** (decided by the
  human on 2026-09-29, and re-confirmed the same day after the cookie
  point below was added). Every teleporter, same-server or cross-server,
  triggers on proximity with no confirmation step.
  - This was weighed against asking first for cross-server destinations.
    Automatic triggering means a visitor who walks onto a pad connects to
    whatever server the world owner chose, without choosing to go there.
  - **What the destination server receives:**
    - the visitor's IP address, and the fact that their page came from
      this server;
    - whatever name their client sends (Step 7 omits it for other
      servers; Atrium servers replace it anyway, §7);
    - **cookies that the destination's own site previously set in the
      visitor's browser.** Browsers attach these to the connection, and
      page code can't prevent it. For a same-site destination ordinary
      cookies are sent; for a cross-site one, only cookies marked for
      cross-site use, which some browsers block. Atrium servers ignore
      cookies on cross-origin connections (§7).
  - **What the world owner can't do:** they choose only the address.
    Atrium's client sends only its fixed messages and discards replies it
    doesn't understand, so the owner never sees what the destination
    sends back. The main consequence is that the destination can see
    who arrives, and sometimes link that to earlier visits.
  - Asking first wouldn't stop any of this technically, only make each
    cross-server jump a deliberate choice. It's accepted as the same kind
    of disclosure as ordinary browsing, in exchange for teleporters that
    behave the same everywhere. Details:
    `devtasks/PREBRIEF-teleporters.md`, T0.
- Support deleting a placed teleporter. Skip in-place repositioning for v1;
  delete-and-replace covers the same need with less to build.
- No upfront destination validation. If a pasted destination is wrong,
  private, or gone by the time someone walks through, show §7's failure
  message at that moment (it names the destination host without claiming
  a cause) rather than checking it at save time.
### What shipped (Step 7, 2026-09-30)
The implementation described above is complete. Key details per decision:
- **T0** — Cookie disclosure: the source server's Atrium cookie never reaches
  another host; the destination server's own cookie may be sent and is ignored
  for cross-origin connections. Already documented in §7/§8.
- **T1** — Teleporter representation: `extras.atrium.teleporter.destination`
  (non-empty string). Visual: flat teal ring, `RingGeometry(0.45, 0.75, 48)`
  on the xz plane at y=0.02 (2 cm lift baked into geometry). Node name:
  `teleporter-<uuid>`. No rotation, no scale.
- **T2** — `hello.server.json` carries optional `canPlaceTeleporters` boolean.
  Server computes: `userId !== null && userId === worldOwnerUserId && isMutator`.
  Client exposes it, resets on each `connect()`.
- **T3** — Server echoes successful non-avatar `add`/`remove` to sender too
  (broadcast, not broadcastExcept). Avatar adds keep broadcastExcept. Errors
  carry `seq`. Client `addNode(descriptor)`/`removeNode(name)` refuse until
  world fully loaded (`_worldReady`), never touch local SOM, return request `seq`.
- **T4** — Pure proximity trigger module (`teleport-trigger.js`): R=0.75m,
  H=2.0m. Arming rule: start disarmed, arm on exit, trigger on re-enter. One
  at a time, nearest pad wins. Inert while not ready, while connecting, while
  editing, or while teleport in flight. Wired in app.js: pads derived from SOM
  via `isTeleporter`/`teleporterDestination` on `som:dump`, `som:add`,
  `som:remove`, `som:set`; `trigger.update()` called after `stage.tick()` in
  the rAF loop; `setReady(true)` on `avatar:local-ready`, `false` on
  `connecting`; `setActive(false)` while placement/delete mode is open.
- **T5** — Placement UI: toolbar "Place Teleporter" button → click-to-place
  at y=0 (via `projectRayToPlane`) → dropdown of own worlds (from `/api/worlds`)
  + free-text field + spawn-point warning (via `nearSpawn`). Delete mode:
  click on pad → confirm → `client.removeNode()`. Both modes exit on Esc.
- **T7** — App rule: manual Connect and teleporter trigger send `displayName`
  only when `sameOriginAsAccount(destUrl, accountWsBase)` is true.
  `AtriumClient` omits `displayName` from `hello` when none provided (key not
  set, not `null`).
- **T8** — Teleport failure shows message naming destination host (`new
  URL(worldUrl).host`) plus "Go back" button. "Go back" re-connects to the
  previous world; if that also fails, ordinary failure with no second "Go
  back". `trackConnect` hardened: uses `client.on` not `once`, returns
  `{status:'ready', data}` or `{status:'superseded'}`. Superseded callers
  do no UI work.
- **T13** — Pad labels via `LabelOverlay`: per-label height offset (1.2m),
  distinct teal border style (`.pad-label` CSS class), text prefixed with `↳`
  arrow, `textContent` only (no HTML). Derived via `teleporterLabel` helper.
  Removed on world teardown and rebuilt on SOM changes.
- **T9** — Server duplicate-name guard (`INVALID_VALUE`), parent-before-ingest
  (`NODE_NOT_FOUND`), both `addNode` functions.
- **T10** — Server-side 2048-char length cap on
  `extras.atrium.teleporter.destination` in `add` and `set` handlers.
- **T6** — `resolveWorldAddress` fixed: reduces origin to scheme+host before
  resolution, maps http→ws/https→wss, keeps ports, handles IPv6.

## Implementation sequencing

Land in this order — each step depends on the ones before it:

1. **Multi-world hosting + owner-only mutation gate** (§1, §2) — together,
   in one step.
2. **Home world auto-create + auto-load on login** (§3).
3. **Auto-save** (§4) — debounce, disconnect-flush, periodic safety net.
4. **Visibility toggle + public routing** (§5).
5. **The commons** (§6) — seed, lifecycle exception, root-path routing.
6. **Cross-server world loading** (§7).
7. **Teleporter placement** (§8).

## Explicitly out of scope for Phase 2

Naming these so they're recognized as deliberate exclusions, not gaps:

- Any general visitor-interaction or scripting system (buttons, toggles,
  triggered behaviors beyond teleport navigation) — deferred to the
  `ATRIUM_user_object` extension work in Phase 3.
- A general admin/privilege system — the commons doesn't need one (§6).
- A public-worlds directory or browse/search feature — teleporter
  destinations are shared as plain links for now (§8).
- General object placement beyond teleporters — a separate feature to
  scope later if wanted, not part of this phase.
