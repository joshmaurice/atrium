# Task: WebSocket keepalive grace counter (hardening, not phase-tied)

## Context

`packages/server/src/session.js` has a pre-existing 30-second ping/pong
keepalive (`KEEPALIVE_INTERVAL = 30_000`). It uses a boolean `alive` flag:
each tick, if the previous ping's pong hasn't arrived, the connection is
`terminate()`'d immediately — one missed pong ends the connection, with no
tolerance for a single late round-trip (GC pause, brief network stall,
laptop suspend/resume, etc).

This was investigated as the suspected cause of live connection drops
observed during 2e's live testing on 2026-08-22 (see
`devtasks/DEPLOY-and-handoff-notes-2026-08-22-pt2.md`, item 4, and
`devtasks/BUG-websocket-keepalive-premature-terminate.md`). A follow-up
investigation session on 2026-08-25 attempted to confirm it via a temporary
server-side log line and ~21 minutes of active two-client traffic against
dev, and **did not reproduce a drop**. Two alternative explanations for the
original incident were also checked and are more consistent with the
evidence: service-restart timing was ruled out (only one restart that day,
long before the drops stopped recurring), and JS-timer-based browser
throttling was ruled out by reading the code (`ws.ping()` is a
protocol-level ping, answered by the browser's network stack regardless of
tab focus). A one-off local network interruption during the original session
is the best remaining explanation.

**This task is not a confirmed-bug fix.** The one-strike design is real
latent fragility worth hardening on its own merits — a healthy production
connection shouldn't depend on every single pong landing inside one 30-second
window — but nothing here is blocking the Phase 1 prod push, and this
shouldn't be read as evidence the original incident is understood.

There is no design-doc section governing this; it's server-internal
connection-lifecycle behavior, not a `docs/DESIGN-user-accounts.md` checklist
item. Read `AGENTS.md` for stack, conventions, and known gotchas before
starting.

## What to build

Replace the boolean `alive` flag with a numeric `missedPings` counter that
tolerates one full missed ping/pong cycle before terminating (i.e.,
terminates on the *second* consecutive miss, roughly 60–90s of genuine
silence, not the first).

Current shape (as of this writing — confirm against the actual file, line
numbers may have shifted):

```js
// session creation
alive: true,

// pong handler
ws.on('pong', () => {
  if (session) session.alive = true
})

// keepalive loop
const keepaliveTimer = setInterval(() => {
  for (const [id, s] of sessions) {
    if (!s.alive) {
      s.ws.terminate()
      sessions.delete(id)
    } else {
      s.alive = false
      s.ws.ping()
    }
  }
}, KEEPALIVE_INTERVAL)
```

Target shape:

```js
// session creation
missedPings: 0,

// pong handler
ws.on('pong', () => {
  if (session) session.missedPings = 0
})

// keepalive loop
const keepaliveTimer = setInterval(() => {
  for (const [id, s] of sessions) {
    if (s.missedPings >= 2) {
      s.ws.terminate()
      sessions.delete(id)
    } else {
      s.missedPings = (s.missedPings ?? 0) + 1
      s.ws.ping()
    }
  }
}, KEEPALIVE_INTERVAL)
```

Also remove the temporary diagnostic line added during the 2026-08-25
investigation session, directly above the `s.ws.terminate()` call in the
keepalive loop:

```js
console.error("keepalive terminate", id, Date.now())
```

That was throwaway logging for confirming the original hypothesis on the
deployed dev tree directly (not committed) — grep for it before starting in
case it's still present in whatever checkout this task starts from, and
confirm it's gone from the final diff either way.

## How to work

- **Create a branch first.** Do not commit to `main`. Name it
  `fix/keepalive-grace-counter`. All work for this task lives on that
  branch.

- **One commit per checklist item** — the counter change and the diagnostic
  line removal can be one commit if the diagnostic line is still present,
  or the counter change alone if it's already gone. Focused, independently
  reviewable commits, each leaving the test suite green.

- **Tests run against real implementations** (real server, real WebSocket
  connections), per repo convention — no mocks standing in for the real
  thing.

- **After each commit, run the affected package tests and confirm green**
  before moving on. Use the per-package test commands from `AGENTS.md`, not
  the top-level runner. Mind the server-test-hang gotcha and run server test
  files individually if needed.

- **Push the branch** to `origin` (`joshmaurice/atrium`) when done, for
  review before any merge to `main`. **Do not merge to `main` yourself.**

## Authority boundaries — test the disagreement case, not just the happy path

This task has **no authority boundary** — it's pure server-internal
connection-lifecycle bookkeeping; no client-supplied value is being trusted,
validated, or overridden. State this explicitly in the report rather than
omitting the section, per standing convention.

## Points that are easy to get subtly wrong

1. **Off-by-one on the threshold.** The required behavior is: survive
   exactly one missed pong, terminate on the second consecutive miss. Test
   both sides of that boundary explicitly — a test that only checks "still
   alive after 1 miss" without also checking "terminated after 2" could pass
   with a threshold of 1, 3, or anything else.
2. **The pong handler must reset the counter to `0`, not decrement it.** A
   single answered pong should fully forgive any prior misses, not merely
   reduce the count by one.
3. **Don't touch the unrelated `terminate()` call in `close()`** (the
   shutdown path that terminates all sessions when the server itself is
   stopping) — grep for `s.ws.terminate()` first and confirm which
   occurrence belongs to the keepalive loop before editing. There are two in
   the file; only one is in scope here.
4. **Real 30-second intervals are impractical for a test.** Use Node's
   built-in `mock.timers` (from `node:test`) to control time rather than
   waiting on wall-clock intervals, and rather than temporarily shrinking
   `KEEPALIVE_INTERVAL` just for the test (which wouldn't be testing the
   real constant).

## Out of scope

No change to `KEEPALIVE_INTERVAL` itself (stays 30s). No change to Caddy
config or proxy timeouts. No new server-side introspection endpoint for
inspecting live connection state. Not tied to any Phase 2 work.

## Live verification

This change is testable end-to-end without a live two-browser smoke test:
write an integration test that stands up a real server, connects a real
client through the full connect sequence, uses `mock.timers` to advance
past one missed pong and assert the connection is still open, then advance
past a second consecutive missed pong and assert `terminate()` was called.
That satisfies the project's live-verification bar for protocol-adjacent
work (a real server, a real client, real behavior asserted end-to-end) — a
live browser smoke test is not required for this task, since the change is
pure connection-liveness timing with no effect on the connect/hello/add
sequence, avatar handling, or movement.

## When done

Report: the branch name, the commit message(s), and the test output showing
the affected server tests green — **including both the "survives one
missed pong" and "terminates after two consecutive missed pongs" cases**,
which should fail against the pre-change code and pass after. Confirm
explicitly in the report that the temporary diagnostic `console.error` line
is not present in the final diff. Do not merge; the diff will be reviewed
before anything reaches `main`.
