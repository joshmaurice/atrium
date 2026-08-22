# Revision: World CRUD, session sweep, honeypot — review fixes

## Context

This is a follow-up to `devtasks/TASK-world-crud.md`. The branch
`feature/world-crud` (6 commits, `42b23e1`..`790a2f2`) has been reviewed —
independently checked out and run, not just read. **Most of the design is
correct and is not being redone**: the `world-store.js` module split, the
`lib/`→`src/` fix, the migration-3 CHECK constraint, the CSRF Origin checks
on the state-changing world routes, and the anti-spoofing logic for
`visibility`/`id`/`owner_user_id`/`document` in `worldStore.updateWorld` and
`createWorld` are all sound. Leave those alone.

Two items below are **merge-blocking** — the reported "30/30 pass" on
`world-crud.test.js` does not reproduce; running the branch as committed
gives 19/30. Two more are **not blocking** but should go in this same pass
since they're small and touch the same files. Continue on the **same
branch**, one commit per item, in order.

Do not re-litigate the design. If anything below conflicts with
`docs/DESIGN-user-accounts.md`, the design doc wins — flag the conflict
rather than guessing.

## Item 1 (blocking) — `getLiveAvatarNodeNames()` cannot see `sessionsRef`; every save fails

`packages/server/src/http-routes.js:808`

The function is defined at module scope, **outside** `createRequestHandler`'s
body (lines 121–687):

```js
function getLiveAvatarNodeNames() {
  if (!sessionsRef || !sessionsRef.current) return []
  ...
}
```

`sessionsRef` only exists as a local variable destructured inside
`createRequestHandler` (`const { db, auth, world, sessionsRef } = opts`).
The helper has no closure over it. Every call throws
`ReferenceError: sessionsRef is not defined` — confirmed directly, not
theoretical. In the running code this means:

- Every `PUT /api/worlds/:id` hits the `catch` block and returns `500`.
  The save path — the entire point of this task — does not work.
- Every `POST /api/worlds` silently swallows the same error in its own
  `try`/`catch` and falls back to an empty `initialDocument`, so a created
  world's `document` is never actually populated from the live world.

Fix by threading `sessionsRef` through explicitly rather than relying on
scope — verified working:

```js
function getLiveAvatarNodeNames(sessionsRef) {
  if (!sessionsRef || !sessionsRef.current) return []
  const names = []
  for (const [, session] of sessionsRef.current) {
    if (session.avatarNodeName) names.push(session.avatarNodeName)
  }
  return names
}
```

and update both call sites (currently lines 512 and 614) from
`getLiveAvatarNodeNames()` to `getLiveAvatarNodeNames(sessionsRef)`. (Moving
the function inside the `createRequestHandler` closure instead is an
equally valid fix if you prefer that shape — either way, decide and
say which.)

**Verification requirement:** confirm you've reproduced the
`ReferenceError` on the unmodified code (it will show up as `500`s and the
`console.error` lines `World serialize failed for save: sessionsRef is not
defined` / `Initial world serialize failed for create: sessionsRef is not
defined` in test output), then confirm the fix removes it. Report both.

## Item 2 (blocking) — test harness passes `worldRef`, which is never read; `world` is `undefined` for every test in this file

`packages/server/test/world-crud.test.js:172-182`

```js
const worldRef = { current: null }

// Wire worldRef + sessionsRef for save handlers
const httpServer = createServer(createRequestHandler({ db, auth, worldRef, sessionsRef }))

const world = await createWorld(FIXTURE_PATH)
const server = createSessionServer({ httpServer, maxUsers: 20, world, db })
worldRef.current = world
sessionsRef.current = server.sessions
```

`createRequestHandler` destructures `world`, not `worldRef` — this option is
silently ignored, and `world` is `undefined` inside every request handler
for the whole file. (This is a second, independent cause of the same
symptom as Item 1 — fixing only one of these still leaves the suite red.)
Unlike `sessions`, `world` doesn't need ref-indirection at all: it already
exists synchronously before the handler is built, same as in `index.js`.
Fix by reordering — verified working:

```js
const db = createDb(dbPath)
const sessionsRef = { current: null }

const world = await createWorld(FIXTURE_PATH)

// world exists synchronously here, same as production index.js — only
// sessions needs the ref indirection, since that Map doesn't exist until
// createSessionServer runs.
const httpServer = createServer(createRequestHandler({ db, auth, world, sessionsRef }))

const server = createSessionServer({ httpServer, maxUsers: 20, world, db })
sessionsRef.current = server.sessions
```

**Verification requirement:** with both Item 1 and Item 2 fixed, run
`node --test test/world-crud.test.js` and confirm 30/30. That is the actual
number to report — not the number from the branch as originally committed.

## Item 3 (blocking) — `db.test.js`'s "migrations are idempotent" test now fails, and wasn't mentioned in the report

`packages/server/test/db.test.js:55` (assertion at line 68)

This pre-existing test (from 2b) hardcodes an expected migration count. It
currently fails — `3 !== 2` — because migration 3 exists now and the test
wasn't updated. This is the "schema, validator, and tests move together"
rule from `AGENTS.md` applying to a test outside this task's own new file,
which is presumably why it got missed. Update the expected count to `3`.
Confirm `db.test.js` is fully green afterward (it should be 11/11), and
include it explicitly in the final report — it wasn't listed at all in the
first one.

## Item 4 (blocking) — the avatar-exclusion-is-session-not-document test doesn't test that

`packages/server/test/world-crud.test.js:738`, `'node with avatar-like
extras is saved normally (not treated as avatar)'`

The test's own comment admits it: *"no WS session with avatar exists at
this point in this isolated test... This test is structural: it asserts
the save path doesn't query extras."* It doesn't — it never constructs a
node with avatar-like `extras` at all. It only checks that ordinary fixture
nodes survive a save when no sessions are live, which is true regardless of
whether `extras` is ever inspected.

To actually test the property named in the title: `add` a node to the live
world with `extras` claiming to be avatar-like (e.g.
`extras: { isAvatar: true }`, or a `name` that looks like the server's real
avatar-naming pattern) but with **no corresponding live WS session** for
it, `PUT` save, and assert that node **is present** in the saved document —
proving exclusion runs off `sessionsRef.current`'s actual
`avatarNodeName` values and not anything inspectable in the node itself.
Rename the test if the new body no longer matches "saved normally" framing,
or keep it if it still fits — your call, just make it prove the thing it
claims to.

## Item 5 (not blocking, small — worth doing in this pass) — honeypot fake-success uses a constant, fingerprintable id

`packages/server/src/http-routes.js`, honeypot branch of the register
handler (~line 226-234)

```js
res.end(JSON.stringify({
  id: '00000000-0000-0000-0000-000000000000',
  ...
```

Every tripped honeypot gets the identical id. A bot comparing responses
across several registration attempts — its own or others it's seen — would
notice the fake response never varies, which defeats some of the point of
responding as if registration succeeded. Generate a fresh `randomUUID()`
for this response instead, same as a real created user would get, so
nothing about the response shape distinguishes it.

The existing tests (`honeypot: website field populated returns 200...`)
currently assert the id equals the hardcoded sentinel — update that
assertion to check the id is present and well-formed rather than pinned to
a specific value.

## Item 6 (not blocking — a reporting-accuracy fix, not a code fix) — decision #7 was recorded inaccurately

The original report stated: *"Decision: 404 for all non-owner /
non-existent world access."* The actual implementation (and its own test,
`'Anonymous: no cookie gets 401 on world routes'`) returns `401` for an
unauthenticated request and `404` only for an authenticated non-owner. This
is a defensible split — `401` doesn't leak anything about whether a
specific id exists, since it's returned identically for *any* id when
there's no cookie at all — but it's not what the write-up said. No code
change is required here. In the final report for this revision, state the
distinction explicitly (`401` unauthenticated / `404` authenticated
non-owner) so the record is accurate, rather than restating the original
"404 for all" phrasing.

## How to work

- **Same branch** (`feature/world-crud`). Do not open a new one and do not
  merge to `main`.
- **One commit per item**, in the order above. Each commit should leave the
  test suite green except where a later item in this list is what fixes the
  remaining red (Items 1 and 2 both have to land before `world-crud.test.js`
  is fully green — that's expected, not a problem).
- Run `packages/server`'s tests per-file (not the top-level runner), per
  the existing gotchas. Run the full server suite once more at the end and
  confirm no teardown hang.
- Push the branch when done.

## Out of scope

Everything not named above. In particular: no new features, no additional
authority-boundary cases beyond Item 4, no changes to the client, no
changes to the migration-3 CHECK constraint or the module boundaries —
those were reviewed and are correct as committed.

## When done

Report per item: the commit and a one-line description of the change. Then:
the **actual, freshly-run** pass/fail counts for `world-crud.test.js` and
`db.test.js` (not restated from the original report), and confirmation the
rest of the server suite (`http-integration.test.js`, `rate-limit.test.js`,
`auth.test.js`, `world.test.js`) is still green. Restate the live-avatar-
exclusion end-to-end test result specifically — that's the one the original
report described as passing when it could not have.

The pre-merge smoke test from the original brief (register via devtools
console, create/save a world, confirm a second user gets `404`/`401` and
user A's world is unchanged, via `fetch()`/`curl`) is still required before
merge and is unaffected by anything in this revision.
