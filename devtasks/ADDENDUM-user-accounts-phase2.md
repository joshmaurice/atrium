# Addendum: Phase 2 — Home Worlds, Auto-Save, and the Commons

Status: Final — ready for implementation.

This addendum resolves the architectural and product decisions Phase 2 of
`DESIGN-user-accounts.md` left open. It exists so that implementation work
(brief-writing, review, and coding) has firm ground to build on instead of
having to originate these decisions per step. Read alongside
`DESIGN-user-accounts.md` and `ADDENDUM-user-accounts-final.md`.

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

## 1. Multi-world hosting

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

## 2. Mutation authorization

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
  authorization at all (§7).
- **Explicitly out of scope for Phase 2:** any visitor-triggered action
  that *does* cause a real, server-synced change (buttons, toggles, doors,
  anything beyond navigation). That is general interactivity/scripting
  territory — the deferred `ATRIUM_user_object` extension work — and the
  base design doc is already explicit that its open questions "should not
  be solved simultaneously with auth and persistence." Do not build a
  per-node "visitor may trigger this" permission mechanism in Phase 2; there
  is nothing in this phase that would use it.

## 3. Home world

- Represented as a **reserved slug, `"home"`, per user** — not a new schema
  column. Reuses the existing slug-addressing scheme worlds already have.
- **Auto-created on first login if missing**, with the default content
  already specified in the base design doc (empty skybox, ground plane,
  avatar).
- **Auto-loaded** into the multi-world registry (§1) when the owner logs
  in, using the same resolution path as any other world.

## 4. Auto-save

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
a saveable change is the owner's own edits. Without §7 (teleporter
placement), there is no owner-facing editing feature in the product at all
— the auto-save mechanism can be built and correctness-tested via the
existing automated test suite or via `tools/som-inspector` before §7 lands,
but it will not do anything meaningful for a real user until it does.

## 5. Visibility and public sharing

This is smaller than it looks, because Phase 1 already laid groundwork for
it on purpose. The `worlds` table already has a `visibility` column,
currently locked to `'private'` by an explicit CHECK constraint added
specifically to defer this decision.

- Relax or replace that constraint to also allow `'public'`.
- Add an owner-facing way to toggle it (extending the existing world-update
  endpoint is the natural fit).
- **Public worlds are reachable at `/public/<user>/<slug>`.**
- Connection-time routing (§1) must check visibility + ownership before
  admitting a non-owner session: private worlds admit only their owner;
  public worlds admit anyone.

## 6. The commons

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

## 7. Teleporter placement

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
  worlds-list endpoint already supports this) plus a free-text field for
  pasting a full path, to cover linking to someone else's public world or
  the commons. No public-worlds directory/browse feature is being built for
  this — that's separate, larger, unbuilt scope. Destination sharing works
  the same way any URL sharing does elsewhere.
- **Trigger:** pure client-side proximity detection. When any avatar gets
  close, that client navigates. No new protocol message and no server
  round-trip — the teleporter's position already syncs the normal way.
- Support deleting a placed teleporter. Skip in-place repositioning for v1;
  delete-and-replace covers the same need with less to build.
- No upfront destination validation. If a pasted destination is wrong,
  private, or gone by the time someone walks through, show a friendly
  client-side error at that moment rather than checking it at save time.

## Implementation sequencing

Land in this order — each step depends on the ones before it:

1. **Multi-world hosting + owner-only mutation gate** (§1, §2) — together,
   in one step.
2. **Home world auto-create + auto-load on login** (§3).
3. **Auto-save** (§4) — debounce, disconnect-flush, periodic safety net.
4. **Visibility toggle + public routing** (§5).
5. **The commons** (§6) — seed, lifecycle exception, root-path routing.
6. **Teleporter placement** (§7).

## Explicitly out of scope for Phase 2

Naming these so they're recognized as deliberate exclusions, not gaps:

- Any general visitor-interaction or scripting system (buttons, toggles,
  triggered behaviors beyond teleport navigation) — deferred to the
  `ATRIUM_user_object` extension work in Phase 3.
- A general admin/privilege system — the commons doesn't need one (§6).
- A public-worlds directory or browse/search feature — teleporter
  destinations are shared as plain links for now (§7).
- General object placement beyond teleporters — a separate feature to
  scope later if wanted, not part of this phase.
