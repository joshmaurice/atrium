# Task: World CRUD, session sweep, honeypot (Phase 1, step 2d)

## Context

Steps 1 (peer identity & routing), 2a (HTTP restructure), 2b (persistence
layer), and 2c (auth) are merged to `main`. This is the last task of Phase 1.
It adds the one thing accounts were for — saving and owning a world — plus
two smaller security-baseline items that were explicitly deferred from 2c:
the `auth_sessions` sweep and the registration honeypot. This task has the
same authority-boundary weight as 2c, arguably more: "can user A load, edit,
or delete user B's world" is the entire point of World CRUD, not an
incidental concern.

The authoritative specification is in `docs/DESIGN-user-accounts.md`,
primarily the **World CRUD (HTTP — not SOP)**, **Persistence Model**, and
**Security baseline** sections, plus `docs/ADDENDUM-user-accounts-final.md`
item 4 (Phase-1 visibility), which is already folded into the main doc. Read
both in full before starting. Also read `AGENTS.md` for stack, conventions,
and known gotchas — in particular the test-port table (see point 9 below
before trusting it) and the server-test-hang gotcha. This brief does not
restate the spec — the design doc is authoritative. **If anything here
conflicts with the design doc, the design doc wins; flag the conflict rather
than guessing.**

## What to build

Three pieces, all called for by Phase 1's checklist in
`docs/DESIGN-user-accounts.md` (**Phasing → Phase 1**), which is the
authoritative list — implement everything it lists, not a fixed number from
this brief:

1. **World CRUD over HTTP** — `GET/POST /api/worlds`,
   `GET/PUT/DELETE /api/worlds/:id`, all worlds private in Phase 1.
   Server-authoritative saves via `world.serialize({ excludeNodes })`,
   excluding avatars.
2. **Periodic sweep of `auth_sessions`** — delete expired rows on an
   interval, not just lazily on lookup.
3. **Honeypot field on registration** — server-side bot check on
   `POST /api/auth/register`. See point 11 — this does **not** require
   building any client UI.

## How to work

- **Create a branch first.** Do not commit to `main`. Name it
  `feature/world-crud`. All work for this task lives on that branch.

- **One commit per checklist item.** Focused, independently reviewable
  commits — not one large one. Each commit should leave the test suite
  green.

- **Per AGENTS.md: schema, validator, and tests move together in the same
  commit.** A commit that changes a message/data shape without updating its
  schema and the associated tests is incomplete. Do not split those across
  commits.

- **Tests run against real implementations** (real server, real schemas,
  real database), per the repo convention — no mocks standing in for the
  real thing.

- **After each commit, run the affected package tests and confirm green**
  before moving on. Use the per-package test commands from AGENTS.md, not
  the top-level runner (known gltf-extension failure). Mind the
  server-test-hang gotcha and run server test files individually if needed.

- **Push the branch** to `origin` (`joshmaurice/atrium`) when done, for
  review before any merge to `main`. **Do not merge to `main` yourself.**

## Authority boundaries — test the disagreement case, not just the happy path

For any code in this task that enforces server authority — anywhere the
server assigns, validates, rejects, or overrides a value the client also
supplies — the tests **must** include at least one case where the client
sends a value that **conflicts** with what the server expects, and assert
the server's value wins.

A happy-path test (client sends the value the server would have assigned
anyway) does **not** satisfy this — it passes whether or not the check
works, because the two values are identical. The proving test is the one
where they differ. For each authority boundary, write a test that:

1. Puts the server in its authoritative state (it has assigned/decided the
   value).
2. Has the client send a **different** value for the same thing.
3. Asserts the server **rejects** (with the specific error code) or
   **overrides** with its own value — whichever the design specifies.
4. Asserts the server's authoritative state is **unchanged** by the attempt.

**Before considering the task done**, for every line where the server reads
a client-supplied value, ask: *"What happens if the client lied here?"* If a
test doesn't cover it, that test is missing. "It can't happen because the
client is well-behaved" is not an answer — server authority means not
depending on the client being well-behaved.

This task has several concrete instances worth naming explicitly
(non-exhaustive — apply the question above everywhere else too):

- **Cross-user access.** Create a world as user A. As user B (a second,
  distinct authenticated session), attempt `GET`, `PUT`, and `DELETE` on
  A's world id. Assert each is rejected and that A's row is byte-for-byte
  unchanged afterward. Repeat with no auth cookie at all (anonymous).
- **`visibility` spoofing.** `POST /api/worlds` and `PUT /api/worlds/:id`
  with a body that includes `visibility: "public"` (or any value other than
  the server default). Assert the stored row is unaffected — Phase 1 has no
  public worlds regardless of what the client sends (per ADDENDUM item 4).
- **Document spoofing.** `PUT /api/worlds/:id` with a `document` field in
  the request body containing arbitrary glTF JSON. Assert the server
  ignores it and persists its own live `world.serialize()` output instead —
  this is principle 5 in the design doc ("server-authoritative saves");
  accepting a client-uploaded document as a normal save creates a second
  authority path the design explicitly forbids.
- **`owner_user_id` / `id` spoofing.** Any create or update body that tries
  to set ownership or id fields directly. Assert the server-generated
  values are what's actually stored.
- **Avatar exclusion is server-tracked, not client-tracked.** The set of
  node names excluded from a save comes from the live `sessions` map's
  `avatarNodeName` values (server state), never from anything in the
  request or from `extras` in the world document. There's no direct way for
  a client to "supply a conflicting value" here since the option isn't
  client-facing at all — but write a test that a node whose `extras`
  happens to *claim* to be an avatar-like thing is still saved normally,
  confirming exclusion truly runs off session state and not document
  content.

## Points that are easy to get subtly wrong

1. **`lib/` vs `src/`, again.** The design doc's Server Changes Summary
   table lists `packages/server/lib/world-store.js`. No `lib/` directory
   exists — same resolution 2b and 2c already made for `db.js`, `auth.js`,
   and `session.js`. Use `packages/server/src/world-store.js`.

2. **Where the route logic actually lives.** For auth, `http-routes.js`
   does its DB queries inline (see the register/login/logout handlers) and
   `auth.js` holds only pure functions with no `db` parameter — there's no
   established "business-logic module" layer yet. World CRUD adds five more
   routes on top of an already-18KB `http-routes.js`. Recommend
   `src/world-store.js` house the actual route-handler logic (matching how
   the design doc itself describes it — "CRUD for `worlds` table, HTTP
   handlers, not SOP") with `http-routes.js` dispatching to it, rather than
   inlining five more handlers' worth of SQL. This is a recommendation, not
   a spec requirement — override if you'd rather keep everything inline for
   consistency with the existing auth routes, but decide deliberately and
   say so in the report.

3. **The `excludeNodes` wiring has an ordering gap — verified in the actual
   `index.js`.** `createRequestHandler({ db, auth })` is constructed and
   handed to `createServer()` *before* `createSessionServer({ httpServer,
   world, db })` runs. The live `sessions` Map — where `avatarNodeName`
   actually lives per connection — does not exist yet at the point
   `http-routes.js`'s factory is called, and it changes continuously as
   people connect/disconnect. The save handler needs whichever avatar names
   are live *at request time*, not whatever existed at server startup (there
   were none). Thread a mutable reference through instead of trying to pass
   `sessions` directly at construction time, e.g.:

   ```js
   const sessionsRef = { current: null }
   const httpServer = createServer(createRequestHandler({ db, auth, world, sessionsRef }))
   const { sessions } = createSessionServer({ httpServer, world, db })
   sessionsRef.current = sessions
   ```

   The save handler reads `sessionsRef.current` (guarding for `null`, since
   nothing stops a request from arriving in the gap between the two lines
   above in theory, and tests may construct things differently) and maps
   live sessions to their `avatarNodeName`.

4. **Generalize the existing filter, don't write a second one.**
   `world.js`'s `serialize()` already has a working index-remap/filter
   mechanism for `externalNodeNames`. Add the `excludeNodes` option by
   merging it into the same exclusion set (`new Set([...externalNodeNames,
   ...excludeNodes])`) rather than adding a parallel filtering pass. Calls
   with no options (the `som-dump` path in `session.js`, unchanged by this
   task) must keep behaving exactly as today — avatars still included,
   external refs still filtered. Only the new save path passes
   `excludeNodes`.

5. **`worlds.visibility` has no CHECK constraint** (verified in `db.js` —
   just `DEFAULT 'private'`, any string currently accepted). Per ADDENDUM
   item 4, Phase 1 is private-only by design. Recommend a migration 3
   (create-copy-drop-rename, same pattern as migration 2's
   `password_hash NOT NULL`) adding `CHECK (visibility = 'private')` so the
   database — not just application code — enforces the Phase-1 invariant.
   Recommendation, not a hard requirement pulled from the design doc —
   override if you disagree, but decide deliberately and record it, same
   framing 2c used for the `password_hash` decision.

6. **A freshly created world has no content yet.** The design doc's create
   endpoint takes only `{ slug, name }` — nothing about `document`. Leaving
   the column at its schema default (`''`) means a `GET` on a
   never-saved world returns an empty string, which is not valid glTF.
   Recommend `POST /api/worlds` immediately serializes the current live
   world (the same code path the save flow uses) as the initial `document`,
   so a created world is always valid, loadable glTF from the moment it
   exists, rather than sitting invalid until a first `PUT`. Flag if you take
   a different approach (e.g. a minimal empty-scene glTF stub) and why.

7. **403 vs 404 for unauthorized world access.** Decide, and apply
   consistently: does a non-owner (or anonymous) `GET/PUT/DELETE` on a real
   world id get `403` (confirms the world exists, just not to them) or
   `404` (indistinguishable from a nonexistent id)? Recommend `404` in both
   the non-owner and the anonymous case, consistent with the
   don't-confirm-what-exists discipline 2c already applied to login and
   registration failures. Record the decision.

8. **Duplicate slug is a client-facing 409, not a raw exception.**
   `UNIQUE (owner_user_id, slug)` will throw a `better-sqlite3` constraint
   error on collision, same shape as the duplicate-username case
   `http-routes.js`'s register route already handles — catch it and return
   a proper 4xx with a generic message, not a 500 or a leaked stack trace.

9. **CSRF/Origin validation extends to the new state-changing routes.** The
   design doc's CSRF baseline applies to *state-changing HTTP routes*
   broadly, not just auth. `isOriginAllowed()` already exists and is
   already used by register/login/logout — apply it to `POST`, `PUT`, and
   `DELETE` under `/api/worlds` too. `GET /api/worlds` and
   `GET /api/worlds/:id` are read-only, same exemption class as
   `GET /api/auth/me`.

10. **`AGENTS.md`'s port table has drifted from the actual code — verified.**
    It lists `http-integration.test.js` as port **3014**; the file itself
    (`packages/server/test/http-integration.test.js:25`) actually uses
    **3015**. Not a live collision (3014 appears genuinely unused), but a
    stale doc. Whatever new test file(s) this task needs, start at **3017**
    and fix the 3014→3015 entry in the same `AGENTS.md` commit while you're
    in there.

11. **Session sweep: placement and cadence.** Recommend a small function in
    `db.js` (e.g. `pruneExpiredAuthSessions()` — a plain
    `DELETE FROM auth_sessions WHERE expires_at <= ?`), invoked on a
    periodic timer wired up in `index.js` using the same
    `setInterval(...).unref()` pattern `session.js`'s keepalive timer
    already uses, so it doesn't hold the process open. This is additive to,
    not a replacement for, the existing lazy expiry checks
    (`http-routes.js`'s `resolveUserIdFromCookie`, `session.js`'s
    `resolveWsUserId` already delete-on-read) — the sweep exists for rows
    nobody ever looks up again. Pick a concrete interval (e.g. hourly) and
    record it; test the prune function directly with a manufactured
    already-expired row rather than waiting on a real timer in the test
    suite.

12. **Honeypot needs no client UI in this task.** The design doc's Client
    Changes Summary lists UI work (world browser panel, register/login
    overlay) as its own separate line item from World CRUD, and — per the
    merge checklist's own live-verification step — there is currently **no**
    registration UI at all; every account so far has been created via
    devtools console against the raw HTTP endpoint. The honeypot is a
    server-side check on `POST /api/auth/register`: accept an optional
    field in the body (e.g. `website` — an innocuous-looking name, not
    literally `honeypot`), and if it's present and non-empty, don't create
    an account. Recommend responding as if registration *succeeded* (no
    account actually created) rather than a 4xx, so a scripted bot gets no
    signal that it was caught — override if you'd rather return an explicit
    rejection, but decide and record it. Test both paths: field
    absent/empty → normal registration proceeds; field populated → `200`ish
    response but no row in `users`. Wiring an actual hidden field into a
    real form is future client-UI work, out of scope here.

## Out of scope

No client UI of any kind (world browser panel, registration/login form,
honeypot field markup) — per point 12 and the design doc's own separation
of client UI as a distinct line item. No public/private toggle, no
unauthenticated `GET` on a world, no `/public/<user>/<slug>` addressing —
all Phase 2, per ADDENDUM item 4 ("all Phase-1 persisted worlds are
private"). No home world, no auto-save, no preferences UI. No GLB or
externally-stored resources for saved worlds — base64-embedded glTF JSON
only, matching current `world.serialize()` output. No server-side loading
of a persisted world back into the live multiplayer runtime — the design
doc names this as Phase 2's "critical prerequisite" work and explicitly
defers it. No rate limiting on world routes — the design doc's rate-limiting
bullet names register/login specifically; don't add scope not asked for.

## Live verification (protocol-touching work only)

This task doesn't change the live SOP protocol — no message types change,
and World CRUD is HTTP-only by design. It does read live session state
(`session.avatarNodeName` via the `sessionsRef` wiring in point 3), which is
exactly the category of surface that broke silently once before while unit
tests stayed green (the avatar-movement regression) — lower risk here since
it's an HTTP save path, not the WS protocol itself, but not zero. "Done"
requires:

- An integration test that connects a real WebSocket client through the
  full hello sequence (so a real avatar node exists at its
  server-assigned `avatarNodeName`), calls `PUT /api/worlds/:id` to save,
  and asserts the persisted/returned document does **not** contain that
  avatar node — while a plain `world.serialize()` call with no options,
  in the same test, still does. This is the test that proves `excludeNodes`
  actually filters and hasn't accidentally become the new default for
  `som-dump` too.
- A note in the report that a live smoke test in dev is required before
  merge: register via devtools console, create and save a world, open a
  second private-window tab as a different user, and confirm (via direct
  `fetch()`/`curl` against the API, since there's no UI) that the second
  user cannot list, load, or delete the first user's world.

State explicitly which of these covers the change and what the untested
residual risk is.

## When done

Report: the branch name, the commit messages (one per checklist item), and
the test output showing each affected package green — **including the
disagreement/authority tests**, which should fail against the pre-change
code and pass after. Also report the concrete decision made (or overridden)
for each numbered point above that called for one: the `visibility` CHECK
constraint, initial-document-on-create, 403-vs-404, honeypot response
shape, sweep interval, and the `world-store.js` module-boundary call. State
how the live verification above is satisfied. Do not merge; the diff will
be reviewed, and the save-path change will be live-smoke-tested in dev,
before anything reaches `main`.
