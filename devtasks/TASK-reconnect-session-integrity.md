# Task: Reconnect session integrity — evict stale sessions on re-auth, and close the hello bootstrap race

## Context

Triggered by a live report: three users (different accounts) lost their
connection to a shared internet outage, then reconnected one at a time.
Afterward, two of the three tabs showed peer avatars with wrong display
names; the third tab was correct.

That exact symptom — a live peer avatar rendering under a *different real
user's* name — was **not** reproduced despite extensive testing (dozens of
trials: clean disconnects, silent/undetected drops, staggered reconnects,
concurrent reconnects with randomized jitter, using the real server and real
`AtriumClient`/`AvatarController` code throughout, no mocks). Every
mislabel-looking result traced back to a flaw in the test harness itself,
not the product code. So **this brief is not a confirmed fix for the
reported symptom** — same posture as `TASK-keepalive-grace-counter.md`
before it: nothing here should be read as "the mislabeling is understood and
solved."

What the same investigation *did* find, confirmed by running the real
server and real clients (not just reading the code), are two independent,
reproducible defects in `packages/server/src/session.js`'s connection
lifecycle — both plausible contributors to "something looked wrong after a
multi-user reconnect," and both worth fixing on their own merits regardless
of whether either is the exact original cause:

1. **No dedup on authenticated re-connection.** If a user's socket dies
   without the server seeing a clean close (real internet loss almost always
   looks like this — no FIN, nothing — until the keepalive ping/pong times
   out, up to ~90s later per `KEEPALIVE_INTERVAL`), and that user reconnects
   before the timeout, the server accepts a **second, fully independent
   session for the same account**. The old session's avatar stays in the
   world, frozen at its last position, correctly labeled but duplicated.
   Verified live: reconnecting quickly after an undetected drop reliably
   produces a ghost avatar alongside the real one.

2. **A race in the `hello` handler itself.** `case 'hello'` does `await
   world.serialize()` in between creating the session (added to the live
   `sessions` map synchronously) and registering it in `presence` /
   broadcasting its join (Steps 1–3, currently *after* the await). That
   await is a yield point: a second `hello` arriving while the first is
   still awaiting can run its own synchronous portion, and depending on
   which promise resolves first, one connecting client's presence-bootstrap
   can run before another's registration has actually landed. Verified with
   25 trials of three near-simultaneous reconnects: a peer went silently
   missing from another's world (not mislabeled — just never appeared) in 7
   of them.

Read `AGENTS.md` for stack/conventions/gotchas before starting.
`docs/DESIGN-user-accounts.md`'s Peer Identity & Routing section is relevant
background — it specifies rejecting a duplicate **currently live
`sessionId`** at hello (already implemented, `session.js:143-147`, not in
scope here) — but says nothing about deduping by *account* when the
`sessionId` differs, which is exactly the gap item 1 covers. This is new
ground the design doc doesn't address, not a conflict with it; if anything
here turns out to contradict the design doc, the design doc wins and the
conflict should be flagged rather than guessed past.

## What to build

**1. Evict a stale session for the same authenticated user at `hello`.**

Before creating the new session (`session.js:167`), check whether any
existing live session already has the same `userId`:

```js
if (upgradeUserId) {
  for (const [oldId, oldSession] of sessions) {
    if (oldSession.userId === upgradeUserId) {
      cleanupSession(oldSession)   // see extraction note below
      oldSession.ws.close()
      break   // userId is unique among live sessions by construction; no need to keep scanning
    }
  }
}
```

Only trigger this when `upgradeUserId` is non-null — anonymous sessions have
no persistent identity to dedupe against, and must never evict each other
just because of a coincidence (there is none here, but be explicit rather
than relying on absence of collision).

**Extract the cleanup logic first.** The `ws.on('close', ...)` handler
(`session.js:385-411`) already contains the exact sequence needed here:
stop the tick loop, remove from `sessions`, remove from `presence`, and —
only if `presence.remove()` returned a truthy entry — remove the avatar node
from `world` and broadcast `remove` + `leave`. Pull that block into a
`cleanupSession(session)` function and have **both** the close handler and
the new eviction path call it, rather than duplicating the sequence. See the
subtlety about double-cleanup below before doing this.

**2. Reorder the `hello` handler so registration can't race.**

Move the `await world.serialize()` / `som-dump` send (`session.js:199-209`)
to run **after** Steps 1–3 (newcomer broadcast, existing-peer bootstrap,
`presence.add`), not before. All of the bookkeeping in Steps 1–3 is
synchronous and has no dependency on the world dump — moving the one `await`
in the handler to the very end means no other concurrently-processing
`hello` can observe this session as "half-registered" (in `sessions` but not
yet in `presence`, or registered but not yet broadcast). The `hello`
response itself (`session.js:186-195`) still goes out first, unchanged;
only the dump's position in the sequence moves.

## How to work

- **Create a branch first.** Do not commit to `main`. Name it
  `fix/reconnect-session-integrity`. All work for this task lives on that
  branch.

- **One commit per checklist item** — the eviction logic (including the
  `cleanupSession` extraction) as one commit, the hello reordering as a
  second. Each should leave the test suite green independently.

- **Tests run against real implementations** (real server, real WebSocket
  connections), per repo convention — no mocks standing in for the thing
  under test. One narrow, flagged exception for item 2's test — see below.

- **After each commit, run the affected package tests and confirm green**
  before moving on. Use the per-package test commands from `AGENTS.md`, not
  the top-level runner. Mind the server-test-hang gotcha and run server test
  files individually if needed.

- **Push the branch** to `origin` (`joshmaurice/atrium`) when done, for
  review before any merge to `main`. **Do not merge to `main` yourself.**

## Authority boundaries — test the disagreement case, not just the happy path

**Item 1 has a narrow but real authority boundary.** The decision to evict
is keyed entirely on `upgradeUserId`, which is resolved server-side from the
signed auth cookie at WS upgrade (`session.js`'s `resolveWsUserId`) — never
from anything the client asserts in the `hello` message itself. Test that a
client **cannot** trigger eviction of an unrelated session by supplying a
crafted `hello.id`, a `displayName`-alike, or any other client-controlled
field: only a second real, cookie-authenticated connection for the *same*
account may evict the first. Concretely: connect as user A, connect as user
B with a `hello.id` deliberately crafted to collide with something
A-related, and assert A's session is untouched — the only thing that should
ever evict A's session is a second successful login as A.

**Item 2 has no authority boundary** — it's pure internal ordering of
already-trusted server-side bookkeeping; no client-supplied value is being
validated or overridden. State this explicitly in the report, per standing
convention.

## Points that are easy to get subtly wrong

1. **Double-cleanup / double-broadcast on eviction.** After your eviction
   code calls `cleanupSession(oldSession)` and then `oldSession.ws.close()`,
   the *old* connection's own `ws.on('close')` handler will still fire
   later (asynchronously) — it wasn't the one that called `cleanupSession`,
   and its own `session` closure variable is untouched by code running in a
   different connection's handler. This is fine **only if** `cleanupSession`
   is written so a second call on an already-cleaned-up session is a no-op —
   which falls out naturally from `presence.remove()` already returning
   `null` on the second call, as long as the `world.removeNode` +
   broadcast-`remove`/`leave` block stays gated behind that return value (as
   it already is in the existing close handler). Do not restructure this
   gating away. Write a test that evicts a session and then simulates its
   old socket's own close firing afterward, and assert `remove`/`leave` was
   broadcast exactly once, not twice.
2. **Evict before creating the new session, not after** — otherwise the
   brand-new session can briefly coexist with its own predecessor and could
   see it as a "peer" (itself, under its old name) before cleanup lands.
3. **Only dedupe on `userId`, never on `displayName`.** Two different
   anonymous sessions can legitimately share the auto-generated
   `User-xxxx`-style name; that must never trigger eviction.
4. **For item 2, confirm message-order assumptions on the client before
   relying on them.** Reordering the bootstrap `join` messages to arrive
   *before* the `som-dump` (relative to today's order) is safe because nothing
   in `AtriumClient.js`'s `_onJoin` touches `this._som` — it only writes to
   `_peerSessions`. This was verified against the current client code during
   the investigation, but re-check `AtriumClient.js` for this task's actual
   base commit before relying on it, in case something has changed.
5. **Item 2's test needs a way to force the actual interleaving
   deterministically** — real `world.serialize()` timing is normally too
   fast and non-deterministic to reproduce the race reliably in a test. The
   investigation reproduced it by racing multiple real connections with
   randomized jitter across ~25 trials, which is not a suitable committed
   test (flaky, slow, non-deterministic). Instead, pass a small
   test-local wrapper around the real `world` object into `createSessionServer`
   whose `serialize()` delays by a controlled amount (e.g. via a Promise that
   resolves after a `setTimeout`, or after an externally-triggered gate) before
   delegating to the real `world.serialize()` — this is a stand-in for timing
   only, not a mock of any logic under test (the real session/presence/broadcast
   code all still runs for real). Flag this choice explicitly in the report
   given the "no mocks" convention, so the reviewer can confirm it doesn't
   cross the line the convention is meant to guard.

## Out of scope

No changes to the keepalive timing itself (`KEEPALIVE_INTERVAL`,
`missedPings` threshold — already correct per the prior hardening task). No
changes to how `avatarNodeName` is generated or its collision odds (a
separate, much lower-severity latent concern noticed in passing: it's
derived from an 8-hex-character slice of a UUID, ~32 bits of entropy — not
in scope here, mention in the report if it seems worth its own follow-up
but do not fix it in this task). No attempt to reproduce or fix the original
mislabeling report directly — that remains open and unconfirmed.

## Live verification (protocol-touching work only)

Both items touch the `hello`/`join` sequence, so the unit suite alone is not
sufficient evidence. For item 1: an integration test with two real
authenticated WebSocket connections for the same account (register once,
open two cookie-bearing connections), asserting the first is closed and its
avatar removed (via a `remove`/`leave` observed by a third, bystander
connection) once the second connects. For item 2: the deterministic-delay
integration test described in point 5 above, asserting all three connecting
clients' bootstrap data is complete and correct regardless of resolution
order. In addition, note in the report that both changes touch the
connect/hello/join sequence closely enough to warrant a live two-tab (or
three-tab) smoke test in the dev environment before merge — the reviewer
will run it as a merge gate.

## When done

Report: the branch name, the commit messages (one per checklist item), and
the test output showing each affected package green — including the
authority/disagreement test for item 1 and the double-cleanup test from
point 1 above, both of which should fail against the pre-change code and
pass after. State explicitly which parts satisfy the live-verification bar
and which still need a live multi-tab smoke test before merge. Do not merge;
the diff will be reviewed, and the live smoke test run, before anything
reaches `main`.

## Resolution (2026-09-01)

Both fixes above were reviewed, tested, and deployed to dev and prod — real
fixes for two independently confirmed defects (ghost duplicate sessions on
silent reconnect, and a bootstrap race under concurrent hellos). Neither
fix addresses the originally reported symptom (a live peer's avatar showing
another user's name), because that symptom was never a server defect.

Root cause: both the original prod report and a later dev repro used
multiple accounts logged into separate tabs of the *same* browser window to
simulate multiple users. Browsers share one cookie jar per origin across
all tabs in a window by default, so logging into a second account
overwrites the shared session cookie for every other tab at that origin.
On reconnect, a tab sends whatever cookie the browser currently holds
rather than the one it originally authenticated with — so a reconnecting
tab can resolve to a different account entirely, with the server behaving
correctly given what it was actually sent. Confirmed by comparing the
`atrium_auth_session` cookie value across tabs live, and by the fact that
the extensive server-side reproduction effort (dozens of trials against
the real server/client code) never once produced a wrong-name result —
only the two genuinely separate defects fixed above.

**If this symptom is reported again:** first confirm whether the users
were on genuinely separate browsers/devices, or multiple accounts in tabs
of one browser. Only the former would indicate a real, unresolved
server-side bug.
