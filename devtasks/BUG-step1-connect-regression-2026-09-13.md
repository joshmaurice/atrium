# Bug: Connect fails immediately on DEV (Step 1 regression)

**Reported:** 2026-09-13
**Found against reviewed SHA:** `5d463097b8d63d1ae7ad50bb644f45706c6290bc`
**Branch:** `fix/review-1a-findings`
**Blocks:** Phase 2 Step 1 human DEV acceptance (`WAITING_FOR_HUMAN_DEV_ACCEPTANCE`)

## Reported symptom

Clicking **Connect** in the client no longer works. The status dot goes
gray → yellow ("Connecting...") and then, after a fraction of a second,
reverts to gray / "Connect". No successful connection is ever established.

## Reproduction steps

1. Open the DEV client (`https://dev.5-78-232-73.sslip.io`, served at
   `/apps/client/`).
2. Click **Connect**.

## Expected behavior

Status dot turns yellow, then green, with a live WebSocket session
established — same as before Step 1 landed. Step 1 was server-side
multi-world infrastructure only and was not expected to change any
visible connect behavior for existing usage.

## Actual behavior

Status dot turns yellow ("Connecting..."), then reverts to gray /
"Connect" almost immediately. No session is ever established.

## Root cause

`packages/server/src/world-registry.js`, `resolveWorldId()`, only maps the
literal bare root path (`/` or `''`) to the `'default'` world. Every other
path — including the one the real client actually uses — falls through to
the "unknown" branch, which causes the registry's `upgrade` handler to
respond `404 World Not Found` and destroy the socket before any WebSocket
handshake completes:

```js
// packages/server/src/world-registry.js
function resolveWorldId(pathname) {
  ...
  if (cleaned === '/' || cleaned === '') return 'default'
  if (cleaned.startsWith('/home/'))   return null
  if (cleaned.startsWith('/public/')) return null
  if (cleaned.startsWith('/ws/')) return cleaned.slice(4)
  return null   // <-- /apps/client falls through to here
}
```

The client is never actually served from bare `/`. A prior session
(`devtasks/DEPLOY-and-handoff-notes-2026-08-25.md`, "Round 2") found and
fixed a Caddy quirk: a bare `redir / /apps/client/ 302` directive gets
reordered ahead of the WebSocket `handle` block regardless of where it's
written in the Caddyfile, so a WS upgrade request to exactly `/` gets
redirected before it can ever be handled — and a WS handshake can't follow
a redirect. The existing fix for that was making `computeWsUrl` always
append `location.pathname`, which in practice is always `/apps/client/`,
never `/`. That's a permanent, load-bearing fact about how this app is
served — `resolveWorldId` doesn't account for it, so every real connection
attempt hits the unknown-path branch and gets rejected.

Confirmed `world-host.js` has no path-resolution logic of its own — it only
handles upgrades already resolved and handed to it by the registry. This
one function is the entire fix surface.

## Suggested fix

Add one more case to `resolveWorldId`, next to the existing root-path
check:

```js
// The client is always served under /apps/client/ — Caddy redirects
// bare `/` before a WS upgrade can reach it (directive reordering; see
// devtasks/DEPLOY-and-handoff-notes-2026-08-25.md, "Round 2"). Treat
// this path as equivalent to root.
if (cleaned === '/apps/client') return 'default'
```

(`cleaned` already has a trailing slash stripped earlier in the function,
so this one line covers both `/apps/client` and `/apps/client/`.)

## Suggested test coverage

Add a case to whatever test currently covers `resolveWorldId` (or add one
if none exists) asserting:

- `resolveWorldId('/apps/client')` → `'default'`
- `resolveWorldId('/apps/client/')` → `'default'`
- existing `/`, `/home/...`, `/public/...`, `/ws/...`, and unknown-path
  cases still behave as before (no regressions to the routing table
  itself).

## Scope note

This should be a narrowly targeted fix to `resolveWorldId` plus its test
coverage — no other changes. Continue from the exact reviewed SHA above on
`fix/review-1a-findings`, not from `main` (per the project's exact-SHA
discipline — `main` is unaffected by this branch's work).

## Forward-looking flag (not part of this fix)

Steps 4 and 5 (`ADDENDUM-user-accounts-phase2.md`) introduce
`/public/<user>/<slug>` routing and root-path routing for the commons.
Since Caddy has already caused one directive-ordering surprise on an
exact-path redirect, it's worth explicitly re-checking then that those
paths reach the WS handler cleanly under the current Caddy config, rather
than assuming this fix generalizes.
