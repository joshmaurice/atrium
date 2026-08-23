# Deploy & handoff notes — session of 2026-08-22 (pt 2)

Supersedes nothing; read alongside `devtasks/DEPLOY-and-handoff-notes-2026-08-21.md`,
`-pt2`, and `devtasks/DEPLOY-and-handoff-notes-2026-08-22.md` (this session's
earlier notes, covering 2d). Where files conflict, this one is newest. This
doc covers the same calendar-day session continuing past where the first
2026-08-22 notes left off — 2e's full lifecycle, start to finish.

## Where the project stands

**Phase 1 (Identity & Core Persistence) is functionally complete — every
item in `docs/DESIGN-user-accounts.md`'s Phase 1 checklist has shipped and
is merged to `main`.** 2e was the last unchecked line. There is one open,
real issue discovered during this session's live testing (see below) that's
worth resolving before treating the *deployment* as fully settled, even
though it isn't a Phase 1 checklist item and isn't something this session's
work introduced.

| Step | What | Status |
|---|---|---|
| 1 | Peer identity & routing | Merged, deployed to prod |
| 2a | HTTP server restructure | Merged, running in dev |
| 2b | Persistence layer (SQLite) | Merged, running in dev |
| 2c | Auth (register/login/logout/me, Argon2id, cookies) | Merged, running in dev |
| 2d | World CRUD, session sweep, honeypot | Merged, running in dev, live-verified |
| 2e | Client auth UI + world browser | **Merged, running in dev, live-verified** |

Task briefs for this session's work: `devtasks/TASK-client-ui.md`, followed
by `devtasks/REVISION-client-ui.md`.

### Deployment state

- **prod** — still `81bc709`, peer-routing only. **Now five phases behind**
  (2a–2e). The gap has been growing all session and hasn't been revisited —
  worth a deliberate decision at some point about when to promote, rather
  than letting it keep growing by default.
- **dev** — on merged `main` (`5a72588` at end of this session), full stack
  including the client auth UI and world browser, live-verified end to end
  through a real browser for the first time in the project's history (see
  below — this matters more than it sounds).

### What 2e actually landed

- `apps/client/src/auth.js` — new HTTP client module wrapping
  `/api/auth/*` (register/login/logout/me).
- Auth UI overlay in `index.html`/`app.js` — login/register toggle +
  submit, logged-out/logged-in states, `auth.me()` on page load.
- World browser panel — list/create/load/delete, gated on login state (not
  WS connection state); Load disabled while connected.
- Honeypot `website` field wired into the real registration form.
- A small, three-file `displayName` fix, found while grounding the brief
  and not previously known: `session.js` now looks up the real
  `display_name` from the `users` table when `session.userId` resolves
  (previously always `User-xxxx`, even for logged-in users);
  `AtriumClient.connect()` gained an optional `displayName` hint;
  `app.js` passes the logged-in username through.

**Two revision rounds, both about test coverage rather than the actual
feature code:**

1. `apps/client/tests/auth.test.js` initially never called `auth.js` at
   all — it hand-rolled its own HTTP client and re-tested the server
   routes directly (duplicate of `packages/server/test/auth.test.js`
   coverage). Rewritten to actually import and call the real
   `register`/`login`/`logout`/`me`. Along the way, confirmed empirically
   (not assumed) that **Node's `fetch()` does not persist cookies across
   separate calls** the way a browser does — a throwaway script proved a
   `Set-Cookie` from one call is never resent on a later one — so
   login→`me()` session continuity genuinely can't be proven through
   `auth.js`'s public API in a Node test. That continuity is what the live
   browser smoke test exists to cover instead; the test file says so in a
   comment rather than silently working around it.
2. The honeypot test's own verification step had the identical blind spot —
   it checked `me()` returned `null` after a honeypot-triggered register,
   which would be `null` regardless of whether the honeypot actually
   worked, for the same cookie-persistence reason. Fixed by attempting a
   `login()` afterward and expecting `401` instead — mirrors the pattern
   `world-crud.test.js` already used for the identical scenario in 2d.

Both fixes independently re-verified: diffs read line by line, not just the
reported pass counts trusted.

## Live smoke testing — several distinct things surfaced, worth separating clearly

This was the first task where the live smoke test actually exercised
something built this session (not just proving 2c/2d's server work through
`curl`) — a real UI, clicked through in a real browser, for the first time
in the project.

1. **The auth fields were easy to miss.** They're small inline toolbar
   inputs (110px `Username`/`Password` fields plus Login/Register buttons),
   not a modal or prompt — a reasonable reading of the brief's "your call
   within the existing toolbar style," but genuinely easy to overlook at a
   glance amid the pre-existing world-URL/ws-URL/mode controls. Not a bug.
   Worth a polish pass later — either a clearer visual separation or an
   actual modal.

2. **Private windows share their entire cache, not just cookies, across
   the whole private-browsing session.** This refines gotcha #4 from the
   2026-08-21 pt2 notes and gotcha #1 from this session's earlier
   (2026-08-22) notes — both described this as a *cookie* problem
   specifically. It's broader: it cost real diagnostic time this session
   tracing a "the new UI just isn't there" report all the way down to
   confirming (via `wc -c`/`grep` directly on the VPS) that the file on
   disk was completely correct, before landing on **any open private
   window, anywhere, keeps the whole private session's cache alive** —
   closing every private window and opening a genuinely fresh one resolved
   it immediately both times it came up this session. Worth stating
   plainly since it's now bitten twice.

3. **The Login/Register button pairing is confusing UI, not broken.** One
   button submits (its label toggles Login/Register depending on mode);
   the other toggles mode (showing the opposite label, inviting a switch).
   A natural instinct — click the button labeled "Register" — actually hits
   the toggle, which just swaps both labels without submitting anything,
   looking exactly like nothing happened. Confirmed working correctly once
   the actual submit button was identified by its current label rather than
   by memory of where it was clicked. Worth a small follow-up task: either
   two always-visible Login/Register tabs, or some clearer visual
   distinction between "this submits" and "this switches mode."

4. **The big one — an extensive "Peers: 0" investigation that turned out
   not to be a 2e bug at all.** Two users, each showing their own correct
   real username, didn't see each other as peers. Investigated thoroughly
   before concluding anything:
   - Ruled out the WS URL (the default placeholder value,
     `ws://localhost:3000`, is wrong for this deployment — worth fixing the
     default at some point — but the manually-entered
     `wss://dev.5-78-232-73.sslip.io/apps/client/` routes correctly; the
     server's upgrade handler doesn't filter by path at all).
   - Ruled out a schema-validation rejection of the `join` message (the
     protocol schema has no pattern constraint on `displayName`).
   - Ruled out `avatarNodeName` collision from the `displayName` fix
     (the server assigns `avatar-${sessionId}`, unrelated to username;
     traced the full client-side adoption path and confirmed it correctly
     overrides any local guess before the `add` message is sent).
   - **Built two independent, increasingly faithful reproductions in a
     sandbox, against the exact deployed commit** — one hand-rolling the
     WS protocol directly, one using the real `AtriumClient` class
     end-to-end with real cookies and the real `buildAvatarDescriptor()`,
     including the exact "load a saved world, then connect" sequence one
     of the live users had actually done. **Both showed correct
     peer-join behavior.** This is strong, empirical evidence that 2e's
     actual code is correct — the live symptom has a different cause.
   - The actual cause, once found: `session.js` has a pre-existing 30-second
     ping/pong keepalive (`KEEPALIVE_INTERVAL = 30_000` — terminates a
     connection if the previous ping's pong wasn't answered). Confirmed via
     `git log` that this code predates 2c/2d/2e entirely (visible in the
     earliest peer-routing commits) and that `feature/client-ui` touches
     `session.js` in exactly one unrelated place. Live connections are
     dropping periodically (on the order of minutes) and not always
     recovering peer visibility on reconnect — anecdotally more/faster on
     Opera than Firefox, unverified beyond one session's observation. Not
     yet root-caused further than "the keepalive is involved somehow" —
     Caddy's own log (`journalctl -u caddy`, not `atrium-dev.service`, since
     the app never logs an ordinary disconnect) is the next step, not yet
     pulled this session.
   - **Structurally, this class of bug could not have been caught before
     now.** This is the first time two real, separate, simultaneous human
     users have connected to this server through actual browsers, ever, in
     the project's history. Every prior WS-related test is either
     automated (fast, short-lived, single-process, no real network path or
     proxy involved) or single-user manual testing. Worth remembering next
     time something "must be a regression" — it might just be the first
     time a particular real-world condition was ever exercised at all.

## Operational gotchas discovered this session

Both already folded into the numbered list above (private-window cache
sharing, item 2), rather than repeated here.

## New open items

- **WS connection stability (item 4 above) — the one open item worth
  resolving before Phase 2 work leans on multi-user sessions more heavily.**
  Next step: `journalctl -u caddy`, not the app's own log. Given the
  keepalive is pre-existing and untouched by this session, this isn't a
  2e defect to fix as part of that task — it's a standalone follow-up.
- **`AtriumClient.peerCount` showed `2` in a two-total-client sandbox
  reproduction, where `1` (excluding self) was expected.** Noticed
  incidentally while building the reproduction above; not yet investigated
  further, and possibly not even meaningful — the real app's HUD reads
  `AvatarController.peerCount` (a different property, computed
  differently), not `AtriumClient.peerCount` directly, which is what the
  reproduction checked. Flagging so it isn't lost, not claiming it's a
  confirmed bug.
- **Login/Register toggle UX (item 3 above).** Small, clearly-scoped
  follow-up whenever there's a client-polish pass.
- **Auth field discoverability (item 1 above).** Same category — worth
  bundling with the above into a small "client UI polish" pass rather than
  either becoming its own task.
- **The default `wsUrl` placeholder (`ws://localhost:3000`) is wrong for
  every deployment except prod-on-localhost.** Minor, but worth fixing
  alongside any other client polish — noticed while investigating item 4
  above.
- **Leftover smoke-test data in the dev database keeps accumulating** —
  now includes this session's test accounts/worlds on top of 2d's. Still
  harmless, still worth a cleanup pass before dev is treated as a clean
  baseline for anything user-facing.

## Merge checklist (carried forward, unchanged — worked cleanly again this session)

1. `git fetch origin` before `git status` — don't trust a cached "up to
   date" on any checkout.
2. `git status` — confirm branch and clean tree.
3. `pnpm install` if the checkout hasn't seen this branch's dependencies.
4. `node --test packages/server/test/*.test.js` (and, as of this session,
   the equivalent per-package commands for `apps/client` and
   `packages/client` when either changed) — on the host.
5. Merge, then verify the push landed by fetching from the remote.
6. Restart the service, check `journalctl` for a clean boot sequence.
7. Live smoke test — `curl` with separate cookie jars for anything
   multi-identity and HTTP-only; a real browser, with every private window
   closed before opening a fresh one, for anything UI-facing.
8. Return dev to `main` afterward.

## Minor open items (carried forward from prior sessions, still unresolved)

- A second computer still can't load `dev.5-78-232-73.sslip.io` while prod
  loads fine — undiagnosed, suspect TLS. Not touched this session.
- `http-integration.test.js` still missing its trailing newline. Cosmetic.
- The upgrade-test 300ms fixed sleep — unchanged, latent flakiness risk.
- No server-side introspection endpoint for confirming a live WebSocket
  connection's resolved `userId` from outside.
- `hermes-ba6047dd` still on Node 20, unpinned.

## Next steps

Phase 1's checklist is done. Before Phase 2 (public/private visibility
toggle, server-side loading of a persisted world into the live runtime,
home world, auto-save, preferences — none yet scoped or briefed):

1. Resolve or at least root-cause the WS keepalive/connection-drop issue —
   it'll only matter more once multiple simultaneous users are a normal
   expectation rather than a first-time test.
2. Decide deliberately about the prod/dev gap rather than letting it keep
   growing by default.
3. The small client-polish items above (toggle UX, field discoverability,
   default `wsUrl`) are low-priority but cheap — worth bundling into one
   pass whenever convenient, not urgent enough to block anything.
