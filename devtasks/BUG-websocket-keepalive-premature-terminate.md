# Bug: WebSocket keepalive terminates healthy connections on a single late pong

**Severity:** Pre-existing defect in the SOP keepalive loop
(`packages/server/src/session.js`). Long-lived client connections drop
intermittently ("on the order of minutes", not at a fixed interval), sometimes
recovering, sometimes not. Low user-facing severity today — reconnection is a
single click and simultaneous multi-user is not yet an expectation — but it
sits in the server session layer that Phase 2's multi-user work builds on, so
it should be resolved (or at least confirmed) before that work leans harder on
persistent sessions.

**This is a new branch, not a direct commit to `main`.** Branch from `main`
(`joshmaurice/atrium`), name it `fix/keepalive-grace-counter` (or similar),
work through the confirm-then-fix steps below, push for review. Do not merge to
`main` yourself.

**Status of diagnosis:** the root-cause mechanism below is derived from reading
the code, not yet proven against a live drop. Step 1 of this task is to
*confirm* it empirically. Do not skip to the fix — if the confirmation step
shows drops are *not* landing on keepalive tick boundaries, the cause is
elsewhere (see "Loose ends") and the fix below is the wrong tree.

## Symptom (observed live)

- A connected client's WebSocket dies after some minutes with no user action.
- Timing is irregular, not a fixed duration — inconsistent with a configured
  proxy/idle timeout.
- The app logs no ordinary disconnect for these drops.
- Reconnection is a single click and generally succeeds.
- Reportedly faster to drop on Opera than Firefox (see "Loose ends" — this
  detail is *not* explained by the mechanism below and should not be assumed
  fixed by the proposed change).

Ruled out already this session: the Caddy config for the dev site
(`dev.5-78-232-73.sslip.io`) has **no** `read_timeout` / `write_timeout` /
`idle_timeout` and no global options block — Caddy runs on defaults, so a
configured proxy timeout is not the cause.

## Root cause (hypothesis — confirm in step 1)

The keepalive loop in `session.js` uses a boolean liveness flag with a
one-interval window, so a single pong that arrives later than one
`KEEPALIVE_INTERVAL` (30 s) terminates an otherwise-healthy connection.

`KEEPALIVE_INTERVAL = 30_000` (line ~13). The loop (lines ~419–428):

```js
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

and the pong handler (line ~413):

```js
ws.on('pong', () => {
  if (session) session.alive = true
})
```

The same 30 s tick that sends `ws.ping()` is the one that, on the *next* tick,
checks whether the pong came back. There is no grace: exactly one missed pong
→ `terminate()`. Any transient that delays a single round-trip past 30 s — GC
pause, mobile radio sleep, laptop suspend/resume, a momentary network stall,
proxy buffering — kills a connection the client believes is healthy. And
`terminate()` is the abrupt close, so the client just sees the socket die.

This matches the symptom shape (irregular minute-scale drops, no app-side
disconnect log, sometimes-recovers) better than any fixed-timeout explanation:
it is effectively a per-30 s coin flip that comes up "terminate" whenever a
pong happens to be late.

Note: `ws.ping()` here is a **protocol-level** ping, which browsers answer
automatically in the network stack without JS involvement. The separate
app-level `{type:'ping'}` → `{type:'pong'}` handler (line ~262) is a
client-initiated latency echo (`clientTime`/`serverTime`) and is unrelated to
liveness. Do not conflate the two.

## Step 1 — confirm the mechanism before changing code

Prove (or disprove) that drops coincide with keepalive terminates. Cheapest
sufficient evidence:

1. Add a temporary log line in the terminate branch:
   `console.error('keepalive terminate', id, Date.now())` — on
   `atrium-dev.service`, this lands in `journalctl -u atrium-dev.service`.
2. Optionally enable Caddy access logging for the dev site (add a `log { format
   json }` block to `dev.5-78-232-73.sslip.io {`) so the completed WebSocket
   request logs a `duration` on close from the proxy side. A `duration` that is
   a near-multiple of 30 s corroborates.
3. Keep a browser connected, note the wall-clock time of an observed drop
   (box is UTC; local observer was PDT = UTC−7), and confirm a
   `keepalive terminate` line at that instant.

**Decision gate:** if drops line up with keepalive terminates → proceed to the
fix. If they do not → stop, record the finding, and re-open diagnosis; the
grace counter would be a harmless improvement but not the actual fix.

## Step 2 — the fix

Replace the boolean `alive` flag with a missed-ping counter so a connection
must miss *several* consecutive pings before termination, not one:

```js
const keepaliveTimer = setInterval(() => {
  for (const [id, s] of sessions) {
    if ((s.missedPings ?? 0) >= 2) {        // ~60–90 s of genuine silence
      s.ws.terminate()
      sessions.delete(id)
    } else {
      s.missedPings = (s.missedPings ?? 0) + 1
      s.ws.ping()
    }
  }
}, KEEPALIVE_INTERVAL)
```

and in the pong handler reset the counter instead of the flag:

```js
ws.on('pong', () => {
  if (session) session.missedPings = 0
})
```

Initialise `missedPings` where sessions are created (alongside whatever
currently sets `alive`). Keep `KEEPALIVE_INTERVAL` at 30 s; the tolerance comes
from the counter, not a longer interval. A threshold of 2 gives ~60–90 s of
real silence before termination; adjust with a comment justifying the value.

Grep for every reader/writer of `.alive` before removing it, so no other code
path still depends on the boolean.

## Required test

Add a server test that exercises the keepalive path, not just the message
handlers:

1. Stand up a real server with a real (or fake-timer-driven) client connection.
2. Simulate **one** missed pong (skip a single pong response) and assert the
   connection is **still open** after the next tick — this fails against the
   current one-strike code and passes with the counter.
3. Simulate the threshold number of consecutive missed pongs and assert the
   connection **is** terminated.

Per the repo's adversarial-testing standard: a green unit suite that never
runs the timer loop is not evidence this works. The proof is assertion #2
going red → green.

## How to work

- Branch from `main`; do not commit to `main`. One focused commit for the fix,
  one for the test (or schema/validator/test together per AGENTS.md if any
  message shape changes — here it likely does not).
- Run the affected server test file individually (per AGENTS.md server-test-hang
  gotcha), confirm green.
- Confirm live on dev if possible: with the fix deployed, a single induced
  late pong no longer drops the client.
- Push the branch to `origin` (`joshmaurice/atrium`) for review. Do not merge.
- Remove the temporary step-1 logging before final commit (or gate it behind a
  debug flag).

## Loose ends (do not assume the fix closes these)

- **Opera-vs-Firefox difference.** The reported faster drop on Opera is *not*
  explained by the mechanism above — protocol pings are answered by the browser
  network stack regardless of JS/tab throttling. If drops persist on Opera
  after the grace counter ships, this is the thread to pull; it may be a
  separate networking behavior and should not be folded into this fix's
  success criteria.
- **Confirmation is required.** As stated, the root cause is a reading-derived
  hypothesis until step 1 proves it.

## Environment / where to branch from

The dev box has several `atrium` trees; branch new work from the **active
working checkout** (the Hermes bind mount), not from a `/srv` deploy tree or
from `/root/atrium` (which is Parisi's *upstream* mirror, not yours). Sync to
`main` first (`git fetch && git checkout main && git pull`) so you don't fork
off a stale feature branch. Full layout, origins, and gotchas are in
`devtasks/ENV-checkout-layout.md` — read it before touching trees on the box.
