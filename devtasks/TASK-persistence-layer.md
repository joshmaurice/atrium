# Task: Persistence layer — SQLite connection, schema, migrations (Phase 1, step 2b)

## Context

Phase 1 step 2a (HTTP server restructure) is complete, reviewed, merged to
`main`, and running in dev. The server now owns a port, serves `/api/*` through
an extracted route handler, and has an empty seam in the WebSocket upgrade path
for later cookie validation.

This task lands the **persistence layer only**: a database module, the schema,
and a migration runner. It creates the storage that auth (step 2c) and world
CRUD (step 2d) will build on.

**No authentication, no password hashing, no HTTP routes, and no world CRUD are
in scope here.** The `password_hash` column is created; nothing writes to it
yet. This split is deliberate — it means the credential-handling task does not
also have to debug schema and connection setup.

The authoritative specification is `docs/DESIGN-user-accounts.md`, sections
"Architecture" (the database diagram, lines 104–113) and "Server Changes
Summary". Read it in full before starting, along with `AGENTS.md`. This brief
does not restate the spec. **If anything here conflicts with the design doc,
flag the conflict and stop rather than guessing** — two known conflicts are
already resolved below, and further ones should be surfaced, not silently
decided.

## Resolved conflicts — read before starting

**1. Module location: use `src/`, not `lib/`.** The design doc refers to
`packages/server/lib/db.js`. No `lib/` directory exists — all server modules
live in `packages/server/src/` (`session.js`, `world.js`, `http-routes.js`).
Create `packages/server/src/db.js`. The design doc's `lib/` paths are an
inconsistency in the doc, not an instruction to create a second source
directory. Do not create `lib/`.

**2. The `preferences` table: create it, but write no code against it.** The
design lists `preferences` in the schema diagram, and separately says
preferences are not in scope for Phase 1 ("Interface Configuration"). Create the
table in the migration — schema is cheap now and awkward to retrofit — but add
no accessor functions and no tests beyond confirming the table exists.

## What to build

### `packages/server/src/db.js`

A module that opens a SQLite connection, applies migrations, and exports the
connection plus a small amount of lifecycle handling. Specifically:

- **Dependency: `better-sqlite3`.** Add it to `packages/server/package.json`.
  Do not use the built-in `node:sqlite` — it requires Node 22.5+ and is still
  flagged experimental; the deployment target has not been verified to be on 22.
  If `better-sqlite3` fails to build in the sandbox, **stop and report it**
  rather than substituting a different library.

- **Database file path** comes from an env var, e.g. `ATRIUM_DB_PATH`, with a
  sensible default. **Dev and prod run on the same machine and must not share a
  database file.** Treat this as a hard requirement, not a nicety: dev is a
  place to create throwaway accounts and broken worlds, and pointing both
  environments at one file would let dev writes corrupt production data. The
  default must not resolve to a path both deployments would land on. Add the
  database file (and SQLite's `-wal` / `-shm` sidecars) to `.gitignore`.

- **Required pragmas on every connection:**
  - `PRAGMA foreign_keys = ON` — SQLite defaults this **off**, meaning foreign
    key constraints are silently unenforced. The `auth_sessions → users`
    cascade below does nothing without it. This is the single easiest thing to
    get wrong here.
  - `PRAGMA journal_mode = WAL` — concurrent reads alongside writes.
  - A `busy_timeout` so concurrent access waits rather than throwing.

- **A migration runner.** Versioned, ordered, idempotent, applied at startup.
  Track applied versions in a table (e.g. `schema_migrations`). Running
  migrations against an already-migrated database must be a no-op, and must not
  error. Do not use a migration framework — a small ordered list of statements
  with a recorded version is enough and keeps the dependency surface small.

- **A `close()` function**, for test teardown. The 2a work established that
  incomplete teardown surfaces as hangs rather than failures; the same applies
  to open database handles.

### Schema

Per the design doc's diagram. Column names as given there:

- **`users`** — `id`, `username`, `password_hash`, `display_name`, `created_at`
- **`auth_sessions`** — `id`, `user_id`, `created_at`, `expires_at`
- **`worlds`** — `id`, `owner_user_id`, `slug`, `name`, `document`,
  `visibility`, `created_at`, `updated_at`
- **`preferences`** — `user_id`, `key`, `value`

Constraints that are **not** optional:

- `users.id` — text primary key, holding a server-generated UUID (per the
  identity model: `userId` is a stable UUID).
- **`users.username` must be unique case-insensitively.** A schema that permits
  both `Josh` and `josh` as separate accounts creates a permanent account-
  confusion and impersonation problem that is very expensive to fix once real
  accounts exist. Enforce it in the schema (e.g. `COLLATE NOCASE` on a unique
  index), not in application code — application-level checks race under
  concurrent registration.
- `auth_sessions.user_id` — foreign key to `users.id`, `ON DELETE CASCADE`.
  Deleting a user must not leave orphaned sessions that could still resolve.
- `auth_sessions.expires_at` — not nullable. A session with no expiry is a
  session that never ends.
- `worlds.owner_user_id` — foreign key to `users.id`.
- `worlds` — unique on (`owner_user_id`, `slug`), since the design anticipates
  `/public/<user>/<slug>` addressing.
- `preferences` — primary key on (`user_id`, `key`), foreign key to `users.id`.

Pick explicit types and document them in a comment. Timestamps should be stored
in one consistent representation — choose one, state which, and use it
everywhere.

### Wiring

`index.js` should initialize the database at startup and run migrations before
the server begins listening. **Do not** add any route that reads or writes it.

## How to work

- **Branch first:** `feature/persistence-layer`. Do not commit to `main`, do not
  merge.
- **One commit per logical unit** (dependency + connection; migration runner;
  schema; wiring; tests). Each commit leaves the suite green.
- Tests run against **real implementations** — a real SQLite database (a temp
  file, or `:memory:` where it doesn't defeat the point), not mocks. Note that
  `:memory:` will not exercise WAL mode or file-path handling; use a temp file
  where those matter, and clean it up in teardown.
- Run affected package tests after each commit, per-package (not the top-level
  runner — known gltf-extension failure). Re-run the full server suite at the
  end and confirm the teardown hang has not returned.
- **Push the branch when done.** Credentials in the sandbox have been repaired;
  if the push still fails, say so explicitly and stop. Do not report unpushed
  work as pushed.

## Required tests

Beyond "the tables exist":

- **Migrations are idempotent** — running them twice against the same database
  is a no-op and does not error.
- **Migrations apply cleanly to an empty database** — fresh file to fully
  migrated.
- **Case-insensitive username uniqueness is enforced** — inserting `Josh` then
  `josh` must fail. A test that only inserts one username does not prove this.
- **Foreign keys are actually enforced** — inserting an `auth_sessions` row with
  a `user_id` that does not exist must fail. If `PRAGMA foreign_keys` is off,
  this insert silently succeeds; that is precisely what the test is for.
- **Cascade works** — deleting a user removes their `auth_sessions` rows.
- **Composite uniqueness on `worlds`** — same owner plus same slug fails; same
  slug under a different owner succeeds.

For each constraint test, the assertion must be that the operation **fails**.
A test that inserts valid data and checks it comes back does not prove a
constraint exists.

## Authority boundaries

This task is expected to introduce **no** authority boundary — there is no
client input and no trust decision; it is schema and connection setup.
**Confirm this explicitly in your report** rather than omitting the section. If
you find yourself writing a validation or rejection path that depends on
client-supplied data, that is scope drift — stop and flag it.

Note that the schema constraints above are *not* authority boundaries in that
sense, but they are the closest thing this task has, and their tests must assert
failure as described.

## Out of scope

Do not touch. If you find yourself needing to, **stop** and flag it:

- **No authentication of any kind** — no Argon2id, no password hashing, no
  cookie handling, no login/register/logout, no session resolution at WS
  upgrade. `password_hash` is a column with nothing writing to it.
- **No HTTP routes.** `/api/health` remains the only route. Do not add
  `/api/worlds`, `/api/register`, or anything else.
- **No `world-store.js`, no `auth.js`.** Those modules arrive in 2c and 2d.
- **No data-access functions for `users`, `worlds`, or `preferences`.** This
  task delivers schema and connection, not a query layer; accessors land with
  the code that consumes them. Test-only insert/delete statements written inline
  in the tests are fine and expected.
- **No changes to SOP schemas, `session.js` message handling, or the upgrade
  handler.**
- **No changes to port resolution or Caddy configuration.**
- **No Postgres adapter.** The design notes it as possible later; it is not in
  scope now.

## When done

Report per commit: what changed and the test output. State which timestamp
representation you chose and why. Confirm the `foreign_keys` pragma is on and
that the FK test fails without it — as with the 2a upgrade test, verify that by
temporarily disabling the pragma, observing the test fail, and restoring it.
Report that you did. Confirm the authority-boundary note. State plainly whether
the push succeeded, and what the default database path resolves to under both
dev and prod.
