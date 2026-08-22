# Revision: Client auth UI — review fix

## Context

Follow-up to `devtasks/TASK-client-ui.md`. Branch `feature/client-ui` (5
commits, `d625640`..`25a1d0d`) has been reviewed — checked out and run, not
just read. **Everything is correct except one item, and it's worth being
precise about why, not just what.** Items 2 through 5 all match the brief:
the world browser correctly gates on login state rather than connection
state, Load is correctly disabled while connected, the honeypot field is
wired through end-to-end (`index.html` → `app.js` → `auth.js` →
already-proven server behavior), and the three-file `displayName` fix
(`session.js` / `AtriumClient.js` / `app.js`) is exactly right, including
the anonymous fallback staying unchanged. None of that is being redone.
Server suite: 133/133. `packages/client`'s existing suite: 80/27, matching
the known pre-existing baseline — the `connect()` signature change didn't
break anything new.

One item needs fixing before this merges. Continue on the **same branch**.

## Item 1 — `auth.test.js` never calls `auth.js`

`apps/client/tests/auth.test.js`

Every import in the file is a *server* module
(`packages/server/src/{session,http-routes,db,auth}.js`) — it stands up a
real server, the right instinct, but then exercises it through its own
hand-rolled `httpPost`/`httpGet` helpers built on raw `node:http`, not
through `apps/client/src/auth.js` at all. The 12 passing tests genuinely
prove the *server's* register/login/logout/me routes work — true, and not
wasted effort, but it duplicates coverage `packages/server/test/auth.test.js`
already has. It proves nothing about whether the new client module — the
thing this item of the brief actually asked to be tested — works: its
error-message extraction (`data.error || data.message || ...`), `me()`
returning `null` specifically on `401` rather than throwing, whether the
`baseUrl` override is honored, whether `register()` actually sends the
`website` field only when provided.

**Why a straight "just import auth.js instead" fix doesn't fully work, and
what to do about it instead:** Node's built-in `fetch()` does not persist
cookies across separate calls the way a browser does — confirmed directly,
not assumed: a `Set-Cookie` from one `fetch()` response is not
automatically resent as a `Cookie` header on a later `fetch()` call in the
same process. `auth.js`'s functions only return the parsed JSON body, not
the raw `Response`, so there's currently no way for a caller to capture and
re-thread a session cookie between calls even manually. That means a
register-then-`me()` continuity test, if `auth.js`'s functions are called
back-to-back exactly as a browser would call them, cannot actually prove
what it looks like it's proving in a plain Node test — `me()` would
(correctly, given no cookie was resent) report "not logged in" regardless
of whether registration worked.

So the fix has two distinct parts, not one:

1. **Test `auth.js`'s own per-call contract directly** — this doesn't
   depend on cookie persistence at all, so there's no obstacle here. Import
   the real functions (`import { register, login, logout, me } from
   '../src/auth.js'`) and, against the real test server (keep the existing
   server setup in the file, it's fine), verify: `register()` resolves with
   the right shape on success and throws an `Error` with the server's
   actual message and a `.status` property on `409`/`400`; `login()` throws
   with message + `.status` on `401`; `me()` resolves to `null` specifically
   on `401` (not a thrown error — that's the one behavioral contract this
   module adds beyond a bare fetch call, worth its own explicit test);
   `me()` *does* throw on a genuine server error; `logout()` resolves `true`
   on success; the `baseUrl` option is honored (point it at the test
   server's actual `http://localhost:PORT` and confirm the request lands
   there — these functions default to same-origin relative paths, so this
   is the only way to point them at a Node test server at all).
2. **Don't attempt to prove login→`me()` session continuity through
   `auth.js`'s public API in this test file** — it can't be proven that way
   in Node, for the reason above, and trying will either silently not test
   what it claims (the likely original cause here) or require adding
   cookie-jar machinery to `auth.js` itself for testability alone, which
   isn't worth doing for Phase 1. That continuity is what the brief's live
   browser smoke test already exists to prove (steps 1–2 in
   `TASK-client-ui.md`'s Live Verification section), where a real browser's
   real cookie jar makes it meaningful. Leave a comment in the test file
   saying this plainly, so the next person doesn't wonder why continuity
   isn't covered here and try to bolt it on.

The existing hand-rolled server-route tests in the current file aren't
wrong, just redundant — fine to delete them rather than keep both, since
`packages/server/test/auth.test.js` already covers that ground; keeping
only the new `auth.js`-calling tests avoids two parallel suites drifting
apart later.

**Verification requirement:** after rewriting, run
`node --test apps/client/tests/auth.test.js` and paste the raw output, not
a summarized count. Confirm each test actually imports and calls the real
`register`/`login`/`logout`/`me` — not a re-declared helper — by name in
the diff, not just by the test names sounding right.

## How to work

- Same branch (`feature/client-ui`). One commit for this item. Don't merge.
- Nothing else in the branch needs touching.

## When done

Report: the commit, the raw `node --test` output for the rewritten file,
and confirm the rest of the server and `packages/client` suites are still
green (they weren't touched by this fix, but worth a quick re-run to be
sure). Live verification from the original brief is still required before
merge and is unaffected by this fix.
