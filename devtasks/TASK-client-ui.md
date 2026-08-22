# Task: Client auth UI + world browser (Phase 1, step 2e)

## Context

Steps 1, 2a, 2b, 2c, and 2d are merged to `main`. This is the last unchecked
line in Phase 1's own checklist in `docs/DESIGN-user-accounts.md` — the
**Client Changes Summary** table. Every server endpoint this task needs
already exists and is live-verified: `POST /api/auth/register`,
`POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, and
the full World CRUD surface (`GET/POST /api/worlds`,
`GET/PUT/DELETE /api/worlds/:id`). This task adds no new server behavior of
its own except one small, necessary fix described below — it's a consumer
of what 2c and 2d already built.

**This is also the first Phase-1 task where grounding means reading the
client, not the server.** Read `apps/client/index.html`,
`apps/client/src/app.js`, and `apps/client/src/LabelOverlay.js` in full
before starting, plus `packages/client/src/AtriumClient.js` (specifically
`connect()`, `loadWorld()`, `loadWorldFromData()`, and `_onServerHello()`).
There is no build step — `index.html` loads `src/app.js` directly as an ES
module via an import map; there's nothing to compile. Match the existing
style: static markup and CSS live in `index.html`'s `<style>` block;
elements created at runtime get inline styles via `Object.assign(el.style,
{...})`, the same pattern `LabelOverlay.js` already uses — no CSS framework,
no component library, nothing new introduced for this.

Two things below were only resolved by actually reading the current source
today — don't re-litigate either, they're settled:

**1. "Can the world browser actually load a saved world?" — yes, trivially,
and it doesn't touch Phase 2 at all.** The design doc defers "loading a
persisted world back into a live multiplayer server runtime" to Phase 2 —
that means the *server* swapping its own hosted/broadcast world state for
every connected peer, which is genuinely a Phase 2 feature. It does **not**
mean the client can't load a saved world into its own local view. `app.js`
already has this exact code path for drag-and-drop: `client.loadWorldFromData(text,
file.name)` for a `.gltf` file's raw text. `GET /api/worlds/:id` already
returns exactly that — the full glTF document as JSON text. So "Load" in
the world browser is: `const text = await (await
fetch('/api/worlds/'+id)).text()`, then `client.loadWorldFromData(text,
world.name)`. No new client machinery needed, no Phase-2 boundary crossed.

**2. A real gap, found while reading `session.js` today, not previously
known.** The design doc states a Phase-1 rule plainly: *"`displayName =
username` at registration... the server is authoritative for the display
name distributed to peers."* As shipped, this isn't true.
`packages/server/src/session.js` unconditionally assigns
`userDisplayName = \`User-${sessionId.slice(0, 4)}\`` at hello time — even
when `session.userId` successfully resolves from the auth cookie (2c's own
work). A logged-in user shows up to every other peer as `User-a1b2`, same
as an anonymous guest. Without fixing this, building a full login UI would
ship something that visibly doesn't do anything once you're actually in the
world — worth fixing as part of this task, not filed away for later. See
item 5 below; it's small.

## What to build

1. **`apps/client/src/auth.js`** — new module, a thin HTTP client for
   `/api/auth/*`. Cookie handling is automatic (same-origin `fetch`, no
   special `credentials` option needed — the browser sends the cookie by
   default for same-origin requests, and this deployment is same-origin by
   the Phase-1 assumption already documented). Needs at minimum:
   `register(username, password)`, `login(username, password)`, `logout()`,
   `me()` (wraps `GET /api/auth/me`, returns the user object or `null` on
   `401` — don't throw on the expected "not logged in" case). Each should
   surface the server's actual error message on failure (e.g. duplicate
   username, wrong password) rather than a generic one — the server already
   returns useful, non-leaking messages; don't discard them.

2. **Auth UI overlay** — `index.html` + `app.js`. Functional requirements,
   layout is your call within the existing toolbar/dark-theme visual style:
   - A logged-out state: username + password fields, a way to switch
     between "register" and "login" intent, submit action, and the
     honeypot field (see item 4).
   - A logged-in state: show the current username (from `auth.me()` /
     the register-or-login response), a logout action.
   - **On page load**, call `auth.me()` once to establish real state before
     rendering either UI state — don't default to "logged out" and flicker,
     and don't assume any state without asking the server first. See the
     "Authority boundaries" section below; this is the one that matters
     most for this task.
   - Failed login/register: show the server's message near the form, don't
     use `alert()`.

3. **World browser panel** — new UI, shown only when logged in (World CRUD
   requires auth; an anonymous request gets `401`, so there's nothing
   useful to show a logged-out user here). Needs:
   - List: `GET /api/worlds`, rendered as a simple list (slug/name +
     updated time is enough — the endpoint doesn't return more than that
     by design).
   - Create: a name/slug input + button → `POST /api/worlds`, refresh the
     list.
   - Load: per item, a button that does the `GET /api/worlds/:id` +
     `client.loadWorldFromData()` sequence from Context item 1 above. If
     the user is connected (`client.connected`), decide and document
     whether Load is disabled while connected or implicitly disconnects
     first — either is defensible, but pick one and say so in the report
     rather than leaving the interaction undefined.
   - Delete: per item, `DELETE /api/worlds/:id`, refresh the list. A simple
     confirm before deleting is reasonable; not required by anything above,
     your call.
   - Handle `409` (duplicate slug on create) and `404` (already-deleted /
     not found) by showing the server's message, not by crashing or
     silently no-op'ing.

4. **Wire the honeypot into the real form.** The server already checks an
   optional `website` field on `POST /api/auth/register` (2d) — silently
   accepts without creating an account if it's non-empty. Add a `website`
   input to the registration form, hidden from real users but reachable by
   a bot that fills every field: position it off-screen (e.g.
   `position: absolute; left: -9999px`) rather than `display: none` or
   `visibility: hidden` — some bots skip fields hidden that way but still
   fill positioned-off-screen ones, which is the point. Give it
   `tabindex="-1"` and `autocomplete="off"` too. Don't label it anything
   that reads as a honeypot to a human glancing at the DOM (e.g. avoid
   `name="honeypot"` — the field name the server checks is already
   `website`, which reads as an innocuous optional field).

5. **Fix `userDisplayName` to reflect the real username when logged in —
   small, three coordinated pieces, all needed together:**
   - `packages/server/src/session.js`: at hello time, when
     `session.userId` is non-null, look up the real name with `SELECT
     display_name FROM users WHERE id = ?` (same query shape
     `http-routes.js` already uses for `/api/auth/me` and `/login` — reuse
     that pattern) and use it as `userDisplayName` instead of the
     `User-xxxx` fallback. Anonymous connections (`userId === null`) keep
     the existing fallback unchanged.
   - `packages/client/src/AtriumClient.js`: `connect(wsUrl, { avatar,
     displayName })` — accept an optional `displayName` in `opts`. When
     provided, use it for the client's own local `_displayName` (what
     drives the "You: X" HUD line) and as the avatar descriptor's initial
     `extras.displayName`, instead of always generating `User-${shortId}`.
     This is a **hint**, not authoritative — the server still independently
     resolves and can override it per the point above and per the design
     doc's existing "server canonicalizes, doesn't trust the client"
     principle for this field. Keep the `User-${shortId}` fallback for when
     `displayName` isn't passed (anonymous connect, unchanged behavior).
   - `apps/client/src/app.js`: when the user is logged in at connect time,
     pass their known username into `client.connect(wsUrl, { avatar:
     avatarDesc, displayName: knownUsername })`. Omit it for an anonymous
     connect.

## How to work

- **Branch `feature/client-ui`**, cut from current `main`. One commit per
  numbered item above, in order. Item 5 is genuinely three files touched
  together for one behavior — keep it as one commit, not three, since none
  of the three pieces does anything useful alone.
- **`auth.js` gets real tests** — it's a plain fetch-wrapper module,
  testable the same way `packages/server`'s test files stand up a real
  server and hit it, not mocked. There's no existing test directory under
  `apps/client` (nothing there has been tested before this task) — add
  `apps/client/tests/auth.test.js` following the same real-server,
  `node --test` convention as `packages/server/test/*.test.js`, hitting an
  actual running instance.
- **The DOM-wiring code in `app.js`/`index.html` doesn't have an automated
  test path in this codebase** — nothing in `apps/client` has browser-level
  test coverage today, and this task isn't the place to invent one from
  scratch. That work is covered by the live smoke test instead (see below),
  same as every other UI-touching change in this project so far.
- Run `packages/server`'s and `packages/client`'s test suites after any
  change to `session.js` or `AtriumClient.js` respectively — item 5 touches
  both.
- Push the branch when done. Don't merge.

## Authority boundaries — adapted for client work

The standard disagreement-testing framing (client sends a conflicting
value, server rejects, test the rejection) mostly doesn't apply here — this
task barely adds server logic, and what little it does (item 5) reuses an
already-proven query pattern. The client-side analog that matters instead:
**the UI must never act on assumed or stale auth state — only on what the
server actually just said.**

Concretely:

- On page load, don't render the logged-in UI based on anything cached
  locally (no `localStorage`/`sessionStorage` guess at username — and
  recall browser storage APIs are off-limits in this environment anyway).
  Call `auth.me()` and render whichever state it actually returns.
- After a `logout()` call succeeds, don't leave any part of the UI (world
  browser, "logged in as X" display) showing the old state until a
  subsequent action happens to refresh it — clear it immediately as part of
  the same flow.
- Write a test (can be manual, described in the report, not necessarily
  automated given the point above) for the case where the server has
  independently invalidated the session — e.g. call `/api/auth/logout` via
  `curl` in a separate terminal using the same session's cookie value while
  the browser tab is still open and showing "logged in" — and confirm the
  **next** action that hits the server (e.g. clicking into the world
  browser) reflects the real state (a `401`, handled gracefully) rather
  than the UI's stale belief. This is the closest thing this task has to an
  authority-boundary test, and it matters: the whole point of cookie-based
  auth is that the server's session state is ground truth, and this is the
  first task where the client actually displays a belief about that state
  rather than just sending a cookie along blindly.

## Points that are easy to get subtly wrong

1. **`loadWorldFromData` takes a JSON *string*, not a parsed object.**
   `GET /api/worlds/:id` already returns raw JSON text — use `.text()` on
   the fetch response and pass it straight through, not `.json()` followed
   by `JSON.stringify()` back (which would work but is pointless
   round-tripping — `.text()` is simpler and correct).
2. **The world list endpoint doesn't return the document.** `GET
   /api/worlds` returns `{ id, slug, name, visibility, updated_at }` per
   world by design (multi-megabyte documents don't belong in a list
   response) — Load requires a second request,
   `GET /api/worlds/:id`, per item. Don't try to get away with one call.
3. **`displayName` in `AtriumClient.connect()` is a hint, not a promise.**
   Don't build any client-side logic that assumes the name you passed is
   what peers will actually see — the server can and does override it
   (point 5, third bullet). If you need the *confirmed* name after
   connecting, that's still whatever `session:ready`/`hello` responses
   already carry, not the value you passed into `connect()`.
4. **Don't gate the world browser panel's *visibility* on `client.connected`
   — gate it on login state.** These are two different, independent kinds
   of "connected": WebSocket connection to the live multiplayer world
   (`client.connected`), and HTTP auth session (`auth.me()`). You can be
   logged in and not connected to any world (e.g. just arrived, browsing
   your saved worlds before loading one), or connected anonymously and not
   logged in at all (World CRUD needs auth; the live multiplayer session
   doesn't, per the design's anonymous-sessions rule). Conflating the two
   will produce a UI that doesn't make sense in at least one of those four
   states.
5. **The `users.display_name` column, not `username`, is what session.js
   should query for item 5.** They're set equal at registration today
   (`display_name` defaults to the username at creation, per the
   already-shipped register route), but they're separate columns for a
   reason — `/api/auth/me` and `/login` already return `displayName` from
   that column, not `username` directly. Match that, don't introduce a
   third, different source of truth for the same concept.

## Out of scope

No home world, no auto-load-on-login, no auto-save, no preferences UI — all
explicitly deferred Phase-1-wide, unchanged by this task; a login screen
naturally invites "what happens right after login" questions, but the
answer for Phase 1 is still "nothing automatic, the user picks a world from
the list." No public/private visibility toggle in the UI — Phase 1 has no
public worlds at all (every saved world is private, enforced at the
database level since 2d's migration 3), so there's nothing to toggle. No
renaming/editing world metadata beyond what create already sets — `PUT`
exists for saves, not a metadata-editing form; don't build one unless
asked. No server-side loading of a persisted world into the live
multiplayer runtime — see Context item 1; that's Phase 2, unaffected by
this task's client-side load path. No changes to `LabelOverlay.js`, pointer
events, navigation, or anything else in `app.js` not touched by the items
above.

## Live verification

This task touches the WebSocket `hello` flow indirectly (item 5's
`displayName` addition) and the full auth+world-CRUD flow directly, so the
live smoke test matters here more than usual — this is the first time any
of Phase 1's server work will actually be exercised through the real UI
instead of `curl`/devtools console. "Done" requires, in a real browser
against dev:

- Register a new user through the actual form (honeypot field present but
  empty), confirm logged-in state renders.
- Reload the page — confirm logged-in state persists (via `auth.me()`, not
  local cache).
- Create a world, confirm it appears in the list without a manual refresh
  action beyond whatever the UI already does after create.
- Load it — confirm the viewport actually shows the saved content.
- Connect to the live world while logged in — **open a second, completely
  separate browser (not a second private window — see the 2026-08-22
  handoff notes, gotcha #1, for why that doesn't give a second identity)**
  as a different logged-in user, and confirm each sees the other's avatar
  labeled with their real username, not `User-xxxx`.
- Delete a world, confirm it leaves the list.
- Log out, confirm the world browser disappears and a subsequent action
  correctly requires login again.
- Submit the registration form with the honeypot field populated (e.g. via
  devtools, setting its value before submit) and confirm no account is
  created, matching the server behavior already proven in 2d's tests.

## When done

Report: branch, one description per commit, `auth.js`'s test output, and
the manual live-verification steps above with their actual results — this
task doesn't have much to report via automated test counts given how much
of it is UI, so the live walkthrough carries more weight than usual in the
report. State explicitly which decision you made for the "Load while
connected" interaction (item 3) and why. Don't merge.
