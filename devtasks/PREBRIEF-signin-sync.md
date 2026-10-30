# Pre-brief: the page and the server agree about who you are (sign-in sync)

Status: **FINAL, Revision 1 (2026-10-29).**
- The operator approved decisions I1–I8 (§3) as recommended on 2026-10-29 at
  19:02 PT. That includes I4's "what a reload would do" (not alternative (b))
  and I6's renewal (not a longer fixed lifetime).
- Revision 1 takes in the outside review of the kickoff (received 19:26 PT),
  which the operator sent for correction before dispatch. §0 lists what
  changed.
- §5's open questions are for the brief author.

**Priority: before Phase 3 step 4c.** 4c (visitors' `activate`) is where
visitor and owner identity starts to matter for behaviours.

**Inputs:**
- `devtasks/Atrium-Passdown-2026-10-24-scripting-4b-1.md` §6.2 (signed in on
  the page, anonymous on the server, with the first proposed fix);
- `devtasks/Atrium-Passdown-2026-10-29-scripting-4b-2.md` §6.7 (the second
  form: signed in as one user in the viewport and another in the top bar);
- `docs/DESIGN-user-accounts.md` "Logout" and "Session continuity" (I1 changes
  one line of it).

This is input for the brief-writing step. It is not the brief itself.

**Code facts:**
- **Verified at:** `main` `2a042bc2`. Its runtime code is identical to the
  release on PROD, `0c31ddc0`: `git diff --stat 0c31ddc0 2a042bc2 -- packages
  apps tools` is empty.
- **Line numbers** are at that commit, and approximate.
- **Implementation base:** a freshly fetched `origin/main` at kickoff, never a
  SHA quoted here.

## 0. Changes in Revision 1
Revision 0: 21,432 bytes, sha256 `8f68b2e7…a070`, at `1837436`. The outside
review's findings are M1–M4 (must fix), S1–S4 (should fix) and two minor
points. S4 and the first minor point concern the kickoff only.
- **I5, final admission (M1):** a socket admitted after a world load must be
  checked against the sign-in as it is then, not as it was before the load.
- **I5, the failure contract (M4):** a logout whose session row can't be
  deleted no longer reports success.
- **I2, other 401s and late responses (M2):** every 401 goes through
  `syncAuth()`, and a response from an earlier sign-in is dropped.
- **I4, the same account (S1):** after `SIGNED_OUT`, a tab whose user is
  unchanged still reconnects. **Also new (Claude):** the tab that signs itself
  out ignores its own `SIGNED_OUT`.
- **§6.3, one client, two servers (S3):** a second connection doesn't keep the
  first one's identity.
- **The repro script (S2):** it waits for close events, reports the identity
  fields it actually sees, uses a free port, and with `--expect-fixed` checks
  the fixed behaviour.
- **I6's heading (minor):** renewal happens when the page checks, not on an
  open socket alone.
- **§6:** new tests 6.2(f)–(g), additions to 6.3 and 6.4, proofs
  (p7)–(p10), and browser check 8.

## 1. The problem

**The page decides who you are once, at load. The server decides again at
every WebSocket upgrade, from the cookie as it is at that moment.** All of a
browser's tabs share that one cookie. Nothing tells a tab when the cookie
changes, and nothing in `hello` tells the page who the server admitted.

- **The page:** `me()` (`apps/client/src/auth.js` L63) runs once
  (`app.js` L3064). `setAuthState` (L95) sets `currentUser` and the top bar.
  After that, the only re-check is `refreshWorldList` seeing a 401
  (L191). No `visibilitychange` handler and no cross-tab channel exist
  anywhere in `apps/client` or `packages/client`.
- **The server:** every upgrade resolves the cookie again
  (`resolveUpgradeUserId`, `http-routes.js` L1049, called from
  `world-registry.js` L220, L235, L268 and L387, and `session.js` L234). An
  expired, deleted or missing session is admitted **anonymously, with no
  signal**. A different user's session is admitted **as that user**.
- **`hello` says nothing about it.** The server `hello` (`session.js` L673)
  carries `displayName` (the DB name, or `User-xxxx`). The client adopts it
  (`AtriumClient.js` L1065) and shows it only in the viewport's "You:" label
  (`app.js` L543). The top bar keeps `currentUser`.
- **Sessions last 7 days from sign-in and are never renewed**
  (`http-routes.js` L313 and L422; the cookie's `Max-Age=604800`, L877).
- **Logout doesn't touch open sockets.** `POST /api/auth/logout` (L459)
  deletes the `auth_sessions` row and clears the cookie. A socket admitted
  with that session keeps its `userId`, and with it `canEdit`, until it
  closes.

**Reproduced by Claude on `2a042bc2`** (2026-10-29, the real server with a
fresh DB and one shared cookie jar, the way a browser's tabs share one;
`devtasks/harness/checks/signin-sync/repro.mjs`):

| Step | Result |
|---|---|
| Tab A loads signed in as alice and connects to alice's home | admitted as `alice`, `canEdit: true` |
| Tab B signs out, then signs in as bob | `me` = bob |
| Tab A's open socket | **still open, still alice on the server** (after the logout) |
| Tab A (top bar: alice) walks onto a pad to the commons | **admitted as `bob`**: the viewport says bob, the top bar alice. This is §6.7's second form |
| Tab A clicks Load on "its" home in the world list (alice's private world) | **refused** (`WORLD_UNAVAILABLE`, close 1008): "That world doesn't exist, or it isn't public" |
| The server's `hello` keys | `type, id, seq, serverTime, avatarNodeName, displayName, canPlaceTeleporters, canEdit, scriptHost, capabilities`: **nothing about who was admitted** |
| The session expires (`expires_at` set in the past), then a connect | **admitted as `User-xxxx`**, `me` → 401. This is 4b-1's first form |
| Signed in, a socket open, then logout from another tab | **the open socket stays open as alice**; the next connect is `User-xxxx` |

**So both forms are one mechanism,** as the 4b-2 passdown guessed, and there
are two more symptoms. The stale tab's world list offers the old user's
private worlds, and Load refuses them with the wrong reason. And a signed-out
user's tab can keep editing as them.

**Not established:** which trigger the operator actually hit. Both are now
reproduced. The fix below covers both, and any other cause of a mismatch
(I3).

## 2. Verified facts the fix relies on

- **Every connect goes through one of six sites in `app.js`:**
  - world-list Load (L301);
  - the teleport trigger (L457);
  - its Go back (L474);
  - `autoConnectToHomeWorld` (L630, `client.connect` directly);
  - the `som:desync` resync (L960);
  - the Connect button (L1217).

  All except autoconnect go through `trackConnect` (L1082).
- **Cross-origin connections are anonymous by design** (cross-server connect
  decision #2; `isSameOriginUpgrade`, L997). The client already knows which
  connections are same-origin (`sameOriginAsAccount`, used at L452, L957 and
  L1212). A mismatch can only be judged on a same-origin connection.
- **There is a pattern for closing sockets with a reason:**
  - `evictNonOwners` (`session.js` L330) sends `error` `WORLD_NOW_PRIVATE`,
    closes 1008, and covers pre-hello sockets as well;
  - the client shows it through the `error` listener (`app.js` L841) and
    `teleport-failure.js`'s `codeToReason`.
- **The server `hello` schema has `additionalProperties: false`**
  (`packages/protocol/src/schemas/hello.server.json`). So I1 changes the
  schema, and `AGENTS.md` rule 1 applies.
- **The `error` schema's `code` is an enum,** so I5's new code changes
  `error.json` too.
- **The design doc says "The `hello` schema does not change for auth
  purposes. No token appears in any SOP message."** I1 adds no token: the user
  id is already what `/api/auth/me` returns to the same page. The doc's line
  is updated as part of the round.

## 3. Decisions (for the operator)

**I1. The server's `hello` says who it admitted.**
- Two fields, following `scriptHost`/`hostGen`'s pattern:
  - `signedIn` (boolean), **in every `hello` this server sends**;
  - `userId` (string), present **exactly when** `signedIn` is true.
- The schema enforces the pairing with `if`/`then`/`else`, as it does for
  `hostGen`. `signedIn` is **not** in `required`, because a client may talk to
  another or older Atrium server (cross-server connect). The server's tests
  pin that it always sends it.
- `AtriumClient` keeps both from `hello`, as it does `canEdit`, and adds them
  to `session:ready`'s payload. **Absent means "unknown",** never "anonymous".
- **Why the id and not the name:** display names aren't unique keys, and the
  page compares with `currentUser.id`.
- **Alternative:** `signedIn` only. That catches the first form (anonymous)
  but not the second (a different user).

**I2. The page re-checks `/api/auth/me` at the moments that matter.** There is
one function, `syncAuth()`, and it is the only path that calls `me()` after
load.
- **Before every same-origin connect,** at all six sites (§2). They go through
  one wrapper, so a seventh site can't miss it.
- **When the tab becomes visible** (`visibilitychange`).
- **When another tab says the sign-in changed:**
  - every tab posts `{ type: 'auth-changed' }` on a `BroadcastChannel`
    (`'atrium-auth'`) after its own login, register or logout;
  - every tab listening runs `syncAuth()`;
  - the message carries no identity. `me()` stays the only source of truth.
- **Rules:**
  - Concurrent calls share one request in flight.
  - `fetch` uses `cache: 'no-store'`.
  - The request times out at 3 s.
  - On a network error, a timeout or a 5xx, the page keeps its current state,
    the connect goes ahead, and I3 is the backstop. This matches Z5's rule
    for the load-time check.
- **Ordering:** two connects started back-to-back await the same `me()` and
  then connect in call order, so `trackConnect`'s supersession is unchanged.
  The brief requires a test for it.
- **Every other 401 goes through `syncAuth()` too (Rev 1, M2).**
  - Today `refreshWorldList` (`app.js` L191) and the visibility toggle's `PUT`
    (L261) call `setAuthState(null)` on a 401. Both run `syncAuth()` instead.
    So a 401 anywhere leads to I4, with its disconnect and notice, and never
    to a quiet sign-out.
  - After load, `setAuthState` is called only by `syncAuth()`'s change
    handling, the login and register submit, and the logout button.
- **Responses from an earlier sign-in are dropped (Rev 1, M2).**
  - An auth generation counter goes up on every `setAuthState`.
  - `refreshWorldList` and the toggle's `PUT` note it when they start. If it
    has changed when the response arrives, the response is ignored, a 401
    included; the toggle is restored to its state before the click.
  - So an old list never replaces the new user's, and a late 401 never signs
    out the new user.

**I3. The backstop: compare `hello` with the page.**
- On `session:ready` for a **same-origin** connection whose `hello` carried
  `signedIn`, compare `hello.userId` (or null) with `currentUser?.id` (or
  null).
- **If they differ,** run `syncAuth()`:
  - if the page now agrees with `hello`, I4's change handling applies;
  - if it still doesn't (a race, or a cause nobody has thought of), log one
    warning and show "This world admitted you as *X*, but the page says *Y*.
    Reload the page."
- **Cross-origin connections and a `hello` without `signedIn` are never
  compared.**
- This catches the mismatch whatever its cause, including any future one.

**I4. What a tab does when `syncAuth()` finds the user changed.** The
recommendation is **"what a reload would do"**:
1. `setAuthState(newUser or null)`. The top bar and the world list follow, as
   they already do.
2. **A connect that `syncAuth()` was guarding doesn't go ahead,** because it
   was started for the old user. Any overlay it raised is cleared.
3. If the tab is connected to a **same-origin** world, it disconnects. That
   socket's identity is the old one, or I5 has already closed it. A
   cross-origin connection is left alone, because it's anonymous anyway.
4. If the new state is signed in, `autoConnectToHomeWorld(newUser)` runs, as a
   page load does.
5. A notice in the top bar, in plain words, visible without opening anything.
   It stays until the next sign-in or sign-out in this tab, or until it's
   dismissed:
   - another user: "You're signed in as *bob* now (the sign-in changed in
     another tab)."
   - signed out after another tab's `auth-changed`: "You were signed out in
     another tab."
   - signed out otherwise: "Your sign-in expired. Sign in again to edit your
     worlds."
- **`SIGNED_OUT` always counts as a change for the connection (Rev 1, S1).**
  - Even when `syncAuth()` finds the **same** user (another tab signed out
    and back in as the same account), the socket is already closed. The tab
    does step 4 (autoconnect to the user's home), as a reload would.
  - The notice: "You were signed out in another tab, then signed in again."
- **The tab that signs itself out (Rev 1):**
  - It marks its own logout as in flight before the `POST`. While it is in
    flight, a `SIGNED_OUT` on this tab's sockets is expected: no `syncAuth()`
    and no notice.
  - **On success:** it disconnects, calls `setAuthState(null)` and posts
    `auth-changed`, with no notice.
  - **On failure** (I5's failure contract): it shows "Couldn't sign out. Try
    again." in the top bar and stays signed in and connected. Nothing is
    posted.
- **Alternative (b):** reconnect to the **same** world as the new user (as
  `som:desync` does), and fall back to the new user's home if it refuses. It
  keeps the user in place, but the tab can land in a world it never chose to
  visit as that user, and there are more paths to test.

**I5. Logout closes the sockets admitted with that sign-in.**
- The server records the **auth session id** on each socket at upgrade, next
  to `upgradeUserId`. One resolver returns `{ userId, authSessionId }`, and
  the two existing near-identical resolvers (L934, L957) become thin wrappers
  around it.
- `POST /api/auth/logout` asks the world registry to close every session
  **and pre-hello socket**, on every host, carrying that auth session id:
  - `error` code **`SIGNED_OUT`**, "You signed out", then close 1008, as
    `evictNonOwners` does;
  - the new code goes into `error.json`'s enum and `codeToReason`;
  - the client's `error` listener handles it next to `WORLD_NOW_PRIVATE`. It
    runs `syncAuth()`, and I4 then applies with whatever `me()` says. By then
    the other tab may have signed in as someone else, so the client doesn't
    assume signed-out.
- **Only that auth session.** The same user signed in on another browser keeps
  their sockets. The tests pin that.
- **Final admission checks the sign-in again (Rev 1, M1).**
  - **The gap:** the home and public routes can wait for a world to load
    (`pendingCreations`, `world-registry.js` L326–347 and L450–470). They
    then admit the socket with the identity resolved **before** the wait. A
    logout in that window doesn't find the socket, which is admitted with the
    old rights.
  - **The rule:** every path that awaits before `host.handleUpgrade` resolves
    the cookie again at the moment of admission. It uses that result both
    for the route's admission check (the owner match for a home world;
    ownership for a private world) and for the identity it admits.
  - **The outcome:**
    - for a home or private world, a session that is gone by then is
      refused, as today;
    - for a public world, the socket is admitted as the identity resolved at
      that moment (anonymous, if the session is gone). Its `hello` then says
      `signedIn: false`, and I3 handles the page.
  - **No gap between the check and the registration:** from the final
    resolution to the moment the socket is findable by the logout sweep,
    with its auth session id recorded, there is no `await` and no callback
    boundary. A logout therefore comes either before the check (refused, or
    admitted anonymous) or after the registration (the sweep finds it).
  - The synchronous routes (default, `/ws/<id>`) already resolve and admit in
    one turn. They are held to the same no-gap rule.
- **The logout failure contract (Rev 1, M4).** Today a failed `DELETE FROM
  auth_sessions` is swallowed (L476–482) and the reply is 200. Instead:
  - **if the deletion throws,** the reply is 500 `{ "error": "Sign-out
    failed" }`, the cookie **is not** cleared, no socket is closed, and one
    log line is written, `[auth] logout failed <username>`, with no ids;
  - **deleting zero rows** (the session already expired or gone) is a
    success;
  - **a logout with no cookie** is a success, as today.
- **A session that expires while a socket is open** doesn't close the socket.
  A socket admitted while its session was valid stays until it closes.
  Recorded, not changed: I6 makes expiry rare for anyone active, and I2's
  visibility check catches it on the page.
- **Why on the server:** a hidden tab that misses the broadcast (a closed
  laptop, a throttled background tab) would otherwise keep owner rights after
  the owner signed out.

**I6. An active sign-in is renewed whenever the page checks it.** Renewal
happens when `me()` runs, not because a socket is open. A tab never made
visible for 7 days, with no connects in that time, is signed out on its
first check, and I4 handles it.
- `GET /api/auth/me` renews a session with **less than half its life left**:
  - `expires_at` becomes now + 7 days, and the cookie is re-set with the same
    attributes and `Max-Age`;
  - a session with more than half its life left is untouched, which keeps the
    writes rare.
- The lifetime stays 7 days. I2 calls `me()` on every visible tab and every
  connect, so anyone using Atrium within a week stays signed in.
- **Alternative:** a longer fixed lifetime. That's simpler, but a forgotten
  sign-in lasts longer, and it still ends in the middle of a session.

**I7. The server logs sign-ins and admissions.** The 4b-1 passdown noted it
logs neither, which left the first form unconfirmable on DEV. One line each:
- `[auth] login <username>`, `[auth] register <username>`,
  `[auth] logout <username> closed <n> sockets`, `[auth] logout failed
  <username>` (Rev 1), `[auth] renewed <username>`;
- at `hello`: `[session] hello <first 8 of sessionId> as
  <username|anonymous> world <world id>`.
- **No cookie or auth session id in any line.**

**I8. Its own round, before 4c.**
- A small round off a freshly fetched `main`, through the normal pipeline:
  brief, GLM review, DEV, acceptance, MAIN, PROD.
- **Files:**
  - `packages/protocol` (two schemas and their tests);
  - `packages/server` (`http-routes.js`, `session.js`, `world-registry.js`,
    `world-host.js`, tests);
  - `packages/client` (`AtriumClient.js`, tests);
  - `apps/client` (`auth.js`, `app.js`, `teleport-failure.js`, a small new
    module for `syncAuth` and the change handling so it can be unit-tested
    outside `app.js`, tests);
  - `docs/DESIGN-user-accounts.md` (one line).
- **It has UI,** so Claude's harness checks run on the published tip before
  DEV acceptance (4b-2 passdown §4.1).
- **The harness fakes auth today** (`server.mjs` answers `/api/auth/me` with
  401). This round's checks need the real server, with its DB and cookies,
  behind a small HTTPS proxy that serves the checkout. Claude builds that
  next to the harness before the round's checks; it isn't the implementer's
  work.
- **Outside review:** recommended but optional. This round changes who is
  admitted as whom, and I5 closes sockets. It runs no world-supplied code,
  which is 4b-2 §4.2's rule.

## 4. Out of scope
- Changing what a cross-origin connection is (always anonymous).
- Multiple accounts in one browser at once. One cookie per origin stays the
  model: the fix makes every tab follow it, not separate from it.
- Closing sockets when a session expires (I5 records why not).
- `AGENTS.md` rule 2 (identity coupling of avatar node names). Untouched: no
  name or session-id derivation changes.
- The other open follow-ups (the 4b-2 passdown §6.2–§6.6).

## 5. Open questions for the brief author / critic
- **The notice's place:** `authError` lives in the signed-out form, which a
  signed-in tab hides. The brief should name the element (a new line in the
  top bar is likely) and its style, and the acceptance steps should look at
  it.
- **`syncAuth()` before the teleport trigger** adds one round trip to every
  pad. That's expected to be tens of milliseconds on DEV. Worth a measurement
  in the handoff; if it's noticeable, the trigger may connect at once and rely
  on I3 alone.
- **At page load,** the load-time `me()` and autoconnect's guard would make
  two requests. The load-time call can count as the guard's answer, or the
  second request can be accepted as harmless; the brief picks one.
- **The register response** auto-creates the home world and signs in, so
  register posts `auth-changed` too. Does the honeypot path post it? It must
  not.

## 6. Test expectations

### 6.1 Protocol (`packages/protocol/test`)
- Server `hello`:
  - valid with `signedIn: false` and no `userId`;
  - valid with `signedIn: true` and a `userId`;
  - **invalid** with `signedIn: true` and no `userId`, and with
    `signedIn: false` and a `userId`;
  - valid with neither (an older server).
- `error`: `SIGNED_OUT` is valid; an unknown code is still invalid.

### 6.2 Server (`packages/server/test`, port 0, files one at a time)
- **(a) `hello` fields:**
  - a same-origin upgrade with a valid cookie gets `signedIn: true` and that
    user's id;
  - no cookie, an expired session and a deleted session each get
    `signedIn: false` and no `userId`;
  - a cross-origin upgrade with a valid cookie gets `signedIn: false`;
  - every route kind is covered: default, `/ws/<id>`, home, `/worlds/<u>/<s>`.
- **(b) The two-user sequence of §1,** with one cookie jar:
  - after logout and login as bob, a new upgrade's `hello` says bob;
  - **the old socket is closed** with `SIGNED_OUT` and code 1008 (I5).
- **(c) Logout scope:**
  - alice signed in twice (two auth sessions);
  - logout of one closes only that session's sockets, on every world host,
    including a pre-hello socket;
  - the other session's sockets stay open and keep editing;
  - the log line counts the closed ones.
- **(d) Renewal:**
  - a session with 2 days left: `me` returns 200, `expires_at` moves to about
    7 days ahead, and the response sets the cookie;
  - a session with 5 days left is untouched and gets no `Set-Cookie`;
  - an expired session gets 401 and is not renewed.
- **(e) The log lines** of I7 appear, and none of them contains the cookie
  value.
- **(f) A held world load (Rev 1, M1).** The test makes the world's load wait
  until it releases it, for example by stubbing `registerWorldFromDocument`
  or the document read to resolve on demand.
  - alice upgrades to her **unloaded home**, and the upgrade waits;
  - she logs out (the sweep runs), then the load is released;
  - **the upgrade is refused**, and no session for alice exists on that host.
  - The same for a **public** world: the socket is admitted with
    `signedIn: false`, and it has no `userId` and no `canEdit`.
  - A **private** world owned by alice: refused.
- **(g) Logout when the deletion fails (Rev 1, M4).** The test makes
  `DELETE FROM auth_sessions` throw:
  - the reply is 500 `Sign-out failed`, with no `Set-Cookie` clearing the
    cookie;
  - alice's open socket stays open, and `me` still answers 200;
  - the log line is `[auth] logout failed alice`, with no cookie or session
    id.
  - Zero rows deleted, and no cookie at all: both 200.

### 6.3 Client package (`packages/client/test`)
- `hello` with `signedIn`/`userId`: both are readable and in `session:ready`.
- `hello` without them: reported as unknown (`undefined`), not `false`.
- **One `AtriumClient`, two servers (Rev 1, S3):** a connect to a server that
  sends `signedIn: true` and a `userId`, then a connect to one that sends
  neither. The second `session:ready` reports both as unknown, never the
  first connection's values. The same the other way round, and for
  `signedIn: false` followed by an older server.

### 6.4 App (`apps/client/test`, with the strict DOM fake)
- **`syncAuth()`:**
  - concurrent calls share one `fetch`;
  - it uses `no-store`;
  - a timeout, a network error and a 503 each keep the state and let the
    connect proceed;
  - a 401 while signed in leads to I4's signed-out handling;
  - a different id leads to I4's other-user handling.
- **Each of the six connect sites** awaits `syncAuth()`. When it reports a
  change, the connect is not made: no `client.connect` call, and the overlay
  is cleared.
- **Two connects back-to-back** connect in call order, and the first is
  superseded as today.
- **I3:**
  - same-origin, `hello.userId` ≠ `currentUser.id`: one `syncAuth()`; then
    either the change handling, or the "Reload the page" notice when it still
    disagrees;
  - cross-origin, or `hello` without `signedIn`: no comparison at all.
- **I4:**
  - a same-origin connection is disconnected and a cross-origin one isn't;
  - autoconnect runs only for a signed-in new state;
  - each of the three notices' text.
- **The `BroadcastChannel`:**
  - login, register and logout each post exactly one message, and the honeypot
    path posts none;
  - a received message runs `syncAuth()`;
  - a page with no `BroadcastChannel` (a fake without it) still works.
- **`SIGNED_OUT`** after `session:ready` runs `syncAuth()`:
  - `me()` → 401: the signed-out handling, with "You were signed out in
    another tab";
  - `me()` → another user: the other-user handling;
  - `me()` → **the same user** (Rev 1, S1): it autoconnects to the home
    world, with that notice.
- **Other 401s (Rev 1, M2):** a 401 from `refreshWorldList` and from the
  toggle's `PUT` each run `syncAuth()`, and neither calls `setAuthState`
  itself.
- **Late responses (Rev 1, M2):**
  - a world-list response started as alice, arriving after the switch to bob,
    is ignored, and bob's list stays;
  - a 401 started as alice, arriving after the switch to bob, is ignored, and
    bob stays signed in;
  - the toggle is restored in both cases.
- **This tab's own logout (Rev 1):**
  - a `SIGNED_OUT` while it is in flight runs no `syncAuth()` and shows no
    notice;
  - on success: signed out, disconnected, exactly one `auth-changed`;
  - on a 500: "Couldn't sign out. Try again.", still signed in and
    connected, and no `auth-changed`.

### 6.5 Existing suites
All green, with the usual rules: server files one at a time under
`timeout 180`; `packages/client` without `--test-force-exit`; every other
package in its own directory.

### 6.6 Proofs of failure
Run each. Each must fail the named tests and exit on its own.
- **(p1)** `signedIn` omitted from `hello`: 6.2(a), 6.3.
- **(p2)** I5's close removed: 6.2(b), 6.2(c).
- **(p3)** logout closes **every** socket of the user, not just that auth
  session's: 6.2(c).
- **(p4)** `syncAuth()` removed from one connect site (each site in turn):
  that site's 6.4 test.
- **(p5)** I3's same-origin guard removed: the cross-origin I3 test.
- **(p6)** the renewal threshold inverted: 6.2(d).
- **(p7)** (Rev 1) final admission uses the identity captured before the
  wait: 6.2(f).
- **(p8)** (Rev 1) the deletion error swallowed again, with a 200 reply:
  6.2(g).
- **(p9)** (Rev 1) the auth generation check removed: 6.4's late-response
  tests.
- **(p10)** (Rev 1) `SIGNED_OUT` with the same user treated as no change:
  6.4's same-user test.

### 6.7 Claude's browser checks
These run on the published tip, before DEV acceptance, with the real server.
Two tabs share one browser context, as a browser's tabs do.
1. **Tab A** is signed in as alice and in her home. **Tab B** signs out:
   - tab A gets `SIGNED_OUT` at once (I5) and shows the signed-out state;
   - with tab A hidden during the logout, it shows the same when it's made
     visible.
2. **Start again:** tab A is signed in as alice and in her home, and tab A's
   broadcast listener is blocked. Tab B signs out, then signs in as bob:
   - tab A gets `SIGNED_OUT`;
   - its `syncAuth()` finds bob: it switches to bob, shows the other-user
     notice, and autoconnects to bob's home;
   - its viewport and top bar agree.
3. **The stale tab:** tab A is signed in as alice and **disconnected**, with
   its broadcast and `visibilitychange` blocked. Tab B signs out, then signs
   in as bob. Tab A then:
   - clicks Load on an alice world: no connect is made, the notice shows, and
     bob's list appears;
   - the same from a fresh stale state for Connect. A pad needs a connected
     tab, which I5 closes, so 6.4's unit test covers the pad site.
4. **Expiry:** with `expires_at` set in the past, a pad in a visible tab
   shows the expired notice. No anonymous connect is made from a tab that
   shows a user.
5. **The backstop:** with `/api/auth/me` stubbed to keep answering alice
   while the cookie is bob's, a connect gets `hello` bob, I3 runs, and the
   "Reload the page" notice shows.
6. **Cross-origin:** a visit to the second origin while signed in at home:
   no notice, no disconnect, and `hello` is anonymous as before.
7. **The regression set** from the 4b-2 passdown §4.6.
8. **The same account (Rev 1):** tab A is signed in as alice, in her home.
   Tab B signs out and back in as alice. Tab A ends connected to alice's
   home, with alice in the top bar and the "then signed in again" notice.
9. **The repro script** with `--expect-fixed`, on the published SHA: every
   check passes.

### 6.8 DEV acceptance (operator)
- Two tabs on DEV, as 6.7 steps 1 and 2: sign out in one, then sign in as a
  second account.
- The viewport's "You:" label and the top bar agree in both tabs.
- The DEV journal shows I7's lines for both sign-ins and the closed sockets.
