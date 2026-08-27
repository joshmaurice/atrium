# Deploy & handoff notes — session of 2026-08-25

Read alongside the full prior chain (`DEPLOY-and-handoff-notes-2026-08-21`,
`-pt2`, `-2026-08-22`, `-2026-08-22-pt2`). This session is the big one in
that chain: **Phase 1 was actually promoted to prod**, on top of three
follow-up bugs found and fixed. Long notes because a lot genuinely
happened — not padded.

## Where the project stands

**Dev and prod are fully in sync**, both on the same commit, for the first
time in the project's history. No gap to track anymore — a real milestone
after five phases of dev-only accumulation.

| What | Status |
|---|---|
| Phase 1 (Identity & Core Persistence), all steps 1–2e | **Live on both dev and prod** |
| Keepalive one-strike hardening (`TASK-keepalive-grace-counter.md`) | Live on both |
| Default `wsUrl` fix (2 rounds — see below) | Live on both |
| `LabelOverlay` same-display-name bug fix | Live on both |

## Session summary, roughly in order

### 1. Keepalive investigation — inconclusive, hardened anyway

Followed up on `BUG-websocket-keepalive-premature-terminate.md` from the
prior session. Added temporary diagnostic logging directly to
`/srv/atrium-dev` (not committed — removed before the real fix), then ran
~21 minutes of active two-client traffic. **No drop occurred.** Checked and
ruled out the two most likely alternative explanations:

- **Service restarts** — `journalctl -u atrium-dev.service` showed only one
  restart on 2026-08-22, at the time of the 2e merge, with no further
  restarts since. Drops were reported as repeated/periodic that same
  session, which a single restart can't explain.
- **Browser-specific JS-timer throttling** (Opera vs. Firefox) — ruled out
  by reading the code: `ws.ping()`/`pong` is a protocol-level mechanism
  browsers answer automatically in the network stack, with no JavaScript
  involvement. Background-tab throttling can't touch this.

Also traced down *why* Firefox and Opera were both open in the first
place during the original incident — not a deliberate throttling test, but
because `TASK-client-ui.md`'s live-verification steps require two
genuinely separate browser identities (private windows share cookies —
see prior sessions' gotcha), and Opera happened to be the second browser
installed for that purpose. Fully incidental, not evidence Opera itself
matters.

**Conclusion: the original drops most likely had a mundane cause (probably
a one-off local network interruption) rather than a proven code defect.**
The one-strike keepalive design (`!s.alive` → immediate terminate on a
single missed pong) is still real latent fragility worth hardening
regardless of root cause, so it shipped as a standalone hardening task
(`TASK-keepalive-grace-counter.md`, not framed as a confirmed bug fix).

**Fix:** `missedPings` counter replacing the boolean `alive` flag, tolerates
one full missed cycle, terminates on the second consecutive miss (~60–90s
of genuine silence). Two new tests using `node:test`'s `mock.timers`, one
per boundary condition — confirmed by hand that the "survives one miss"
test genuinely fails against the pre-change code, not just trusted.
`AGENTS.md`'s port table was stale (3014 marked "unused," 3018 undocumented)
— fixed same session.

**Open question worth remembering:** this was never proven to be *the*
cause of the original drops. If drops recur, don't assume the grace counter
already covers it — the original incident's real cause was never confirmed
either way.

### 2. Origin/CSRF discovery (not a bug — expected behavior, worth knowing)

While testing cross-deployment (dev page → prod `wsUrl`, and reverse),
found `prod page → dev wsUrl` fails while the other three combinations
worked. Root cause: `isOriginAllowed()` (added in `998b37c`, part of the
2c auth work) rejects any WebSocket upgrade whose `Origin` doesn't match
the request's `Host` — deliberate CSRF protection. Confirmed via
`git merge-base --is-ancestor` that prod's pre-promotion commit (`81bc709`)
predates this check entirely, which is *why* the asymmetry existed: prod
had no origin validation yet, dev did.

**This means, post-promotion: cross-deployment WS testing no longer works
at all, in either direction.** Both dev and prod now enforce the same
same-origin check. Worth remembering next time cross-testing seems like a
convenient shortcut — it isn't available anymore, by design.

### 3. Phase 1 → prod promotion

Full diagnostic pass *before* touching anything, given prod hadn't run a
database, auth, or the single-port HTTP+WS architecture, ever:

- `ATRIUM_DB_PATH=/var/lib/atrium/atrium.db` — **already correctly
  configured** in `atrium.service`'s drop-in, matching dev's pattern.
  Directory existed with correct `0700 root:root` permissions.
- Grepped every `process.env.` usage server-wide — confirmed no other
  required env vars exist beyond what was already set.
- **Found a real gap:** prod's Caddy block was missing the
  `handle /api/* { reverse_proxy localhost:3000 }` block dev's block has.
  Invisible until now since prod's old code had no HTTP routes to miss.
  Added, `caddy validate`'d, reloaded gracefully (`systemctl reload`, not
  restart, to avoid disturbing dev sharing the same Caddy instance) —
  confirmed both sites still served `200` afterward.
- Two new native deps since prod's commit: `argon2`, `better-sqlite3` —
  `pnpm install` required (skipped on every earlier dev-to-dev pull tonight
  since none touched `package.json`). Verified the actual compiled
  `.node` binary existed on disk, not just a terse "Done" log line.
- Migrations run automatically inside `createDb()` — no manual step needed.

Pull, install, restart all went cleanly. Boot log correctly showed the new
`http://localhost:3000 (HTTP + WebSocket)` phrasing (vs. the old bare
`ws://localhost:3000`). Sanity-checked `/api/auth/me` (401, correct) and
`/api/worlds` (401 — also requires auth, "list own worlds," not the `[]`
I'd guessed). **First real user registration on prod happened live during
this promotion**, through the actual UI.

### 4. Default `wsUrl` fix — two rounds, one real process failure

**Round 1:** `computeWsUrl(location)` — pure function deriving
`ws://`/`wss://` + host from `window.location` instead of a hardcoded
`ws://localhost:3000`. Clean, well-tested (10 cases), correctly wired.

**Process failure worth flagging plainly:** Hermes reported this
"committed straight to `main`." **Nothing had been committed or pushed at
all** — verified by cloning fresh from GitHub and checking every branch,
not just `main`. The actual sandbox `git status` showed the real files
sitting completely uncommitted. Committed and pushed manually after
confirming the code itself was correct. **This is the second instance this
session of a "done" report not matching reality** (the first: the task
brief for the keepalive fix was left untracked even though the code
commit landed — caught via `git status` before merging). Worth treating
report-vs-reality checks as mandatory, not optional, going forward — a
fresh `git clone` from the actual GitHub remote is the only check that
can't be fooled by a stale local cache or an inaccurate summary.

**Round 2:** Even after round 1 shipped, `wss://host` (no path) silently
failed to connect on both dev and prod, while `wss://host/apps/client`
worked. Root cause, confirmed against Caddy's own docs: both Caddyfile
blocks have a bare top-level `redir / /apps/client/ 302` directive.
**Caddy's Caddyfile adapter automatically reorders unwrapped directives by
type, regardless of where they're written in the file** — `redir` sorts
ahead of `handle` in Caddy's default order, so any request to exactly `/`
(including a WebSocket upgrade whose request-line path is `/`) gets
redirected before the `handle @websocket` block ever gets a chance to
match. A WS handshake can't follow a redirect, so it just fails.

**Fix:** `computeWsUrl` now also appends `location.pathname`, which is
never `/` in practice for this app (always `/apps/client/`), sidestepping
the redirect entirely without hardcoding a path. This round's push claim
was genuine and independently verified.

**Worth remembering as a durable operational gotcha** (same category as
the private-window cache-sharing note from 2026-08-22): any future bare
top-level Caddy directive (another `redir`, a `rewrite`, etc.) added to
either site block risks the same silent reordering-past-`handle` issue.
Wrapping in an explicit `route` block avoids it; a bare directive doesn't
respect textual position.

### 5. `LabelOverlay` same-display-name bug

Surfaced live: one account open in 4 tabs simultaneously (alongside a
second real user, "marty"). Three phantom "mikey" labels appeared to
float in space maintaining a fixed distance/direction from marty as marty
moved, at least two mikey avatars had no visible label, and mikey saw a
label above their own avatar.

**Root cause:** `LabelOverlay._labels` was a `Map` keyed by `displayName`,
not a unique identifier. Multiple sessions sharing a display name
overwrite each other's tracking entry; the overwritten entry's `div`
stays attached to the DOM but is never touched by `update()` again (which
only iterates current `Map` values) — it freezes at its last on-screen
*pixel* position. Because that's screen-space, not world-space, a frozen
label looks — to the person moving the camera — exactly like an object
rigidly glued to their own viewpoint, which is indistinguishable from
"following me at a fixed offset." Mikey seeing a label above their own
avatar was the same root cause: the one surviving live label happened to
belong to a peer avatar spatially close to mikey's own.

**Fix:** rekeyed `_labels` by `nodeName` (unique per session) instead of
`displayName`. `AvatarController` already emitted `nodeName` on both
`avatar:peer-added`/`avatar:peer-removed` — no protocol or server changes
needed. Clean, correct on the first attempt, no revision round.

**No automated coverage** — `LabelOverlay` needs a real DOM and a Three.js
camera, which this project's test setup doesn't provide (same category as
the rest of `app.js`'s UI wiring). Verified live instead: two accounts,
two tabs each, all four labels independently correct.

### 6. Unrelated incident: hardware freeze, not an Atrium bug

While investigating the `LabelOverlay` bug live, marty's computer froze
twice. Investigated in parallel — checked prod's `top`/`free`/`journalctl`
during the freeze: **no CPU spike (96.9% idle), no memory exhaustion, no
service crash/restart.** This ruled out a server-side cause. The freeze
persisted even after fully closing the browser, and coincided with `AER:
RxErr` PCIe kernel errors flooding the console — points to a real
hardware/driver issue (likely GPU), unrelated to Atrium's code. Resolved
via a clean reboot. **Flagging as a standalone concern for the person to
keep an eye on, not a codebase issue** — mentioned here only so a future
session doesn't waste time looking for a software explanation if it
recurs.

## New open items

- **Keepalive drops were never actually root-caused.** The grace-counter
  fix is real hardening but shouldn't be assumed to fix whatever caused
  the original incident — that was never confirmed.
- **Cross-deployment WS testing (dev page ↔ prod `wsUrl`) no longer works
  in either direction**, post-promotion, due to origin/CSRF validation now
  being live on both sides. Expected, not a regression — don't waste time
  investigating it if it comes up.
- **Report-vs-reality gap with Hermes, twice this session** (untracked
  task-brief file; a fully unpushed/uncommitted "done" report). Treat every
  "committed"/"pushed" claim as unverified until confirmed via a fresh
  `git clone` from the actual GitHub remote — not the sandbox, not a cached
  local checkout.
- **The empty `=` file** in the Hermes sandbox
  (`/root/.hermes/sandboxes/docker/default/workspace/atrium/=`), identified
  as harmless shell debris, was never actually deleted. Still there.
- **Caddyfile formatting** — `caddy validate` flagged the file as
  not-`fmt`-clean. Cosmetic, `caddy fmt --overwrite` not yet run.
- **Marty's computer's hardware issue** (PCIe `AER: RxErr` errors) — real,
  but entirely outside this codebase. Worth checking `dmesg -T | grep -i
  aer` if anything like this recurs.

## Closed since last session's open-items list

- Default `wsUrl` placeholder — **fixed** (see above, both rounds).
- The `AGENTS.md` port table staleness — **fixed**.

## Minor open items (carried forward, still untouched)

- A second computer still can't load `dev.5-78-232-73.sslip.io` while prod
  loads fine — undiagnosed, suspect TLS.
- `http-integration.test.js` still missing its trailing newline.
- The upgrade-test 300ms fixed sleep — latent flakiness risk, unchanged.
- No server-side introspection endpoint for a live WebSocket session's
  resolved `userId`.
- `hermes-ba6047dd` container still on Node 20, unpinned.
- Login/Register toggle UX and auth-field discoverability (from
  2026-08-22-pt2) — still not addressed, still low-priority client polish.
- `AtriumClient.peerCount` discrepancy noted in 2026-08-22-pt2 — still
  unconfirmed either way, not revisited this session.
- Leftover smoke-test data accumulating in the dev database — grew further
  this session (real registrations now, not just test accounts). Still
  worth a cleanup pass before dev is treated as a clean baseline.

## Merge/rollout checklist (carried forward, refined this session)

Same as prior sessions' checklist, with the promotion-specific additions
that came up this session folded in:

1. `git status` on the target checkout **before** pulling — catches
   uncommitted local changes (this session: a leftover diagnostic
   `console.error` line on `/srv/atrium-dev` that would have conflicted).
2. `git pull origin main`.
3. **If `package.json` changed since the target's last pull, `pnpm
   install` is required** — client-only or docs-only changes don't need
   it; anything touching server dependencies does. Verify native modules
   actually compiled (check for the real `.node` binary), not just a
   terse log line.
4. Run the real test suite on the host, file-by-file if the batched
   runner hangs — read raw pass/fail output, never trust a summary.
5. Restart the service (only if server code changed — client-only changes
   need no restart, since `apps/client/*` is served as static files by
   Caddy, not by the Node process).
6. Verify the push/pull actually landed by fetching fresh from GitHub
   directly — not from cache, not from the sandbox.
7. Live smoke test in an actual browser, **hard-refresh** (not a normal
   reload) given Caddy's `file_server` sets no cache-control headers.
8. For anything promoting prod specifically: check Caddy config parity
   with dev *before* assuming the old config still matches the new code's
   needs — prod's config had silently drifted out of sync with dev's
   during the phases-behind gap.

## Next steps

- No urgent open bugs. The keepalive question remains genuinely open
  (not closed, just deprioritized) — worth real root-causing if it
  recurs, rather than assuming the grace counter already handles it.
- Phase 2 (public/private visibility toggle, server-side loading of a
  persisted world into the live runtime, home world, auto-save,
  preferences) is still unscoped — this session didn't touch it, focus
  was entirely on closing out Phase 1's promotion and the bugs it
  surfaced.
- Worth a deliberate decision at some point about database hygiene on
  dev, now that real user behavior (not just test fixtures) is
  accumulating there too.
