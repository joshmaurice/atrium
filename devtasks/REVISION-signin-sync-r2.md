# Revision — signin-sync round 2 (what Claude's browser checks of round 1 found)

**Status:** approved by the operator (2026-10-29 21:37 PT), **Rev 0** as
drafted. Five items: J1–J4, plus J5 (what doesn't change).
- **Base:** round 1's published tip `617dcc8cad03019b10fd2ee1175449e718b75952`
  on `workflow/signin-sync`:
  - GLM APPROVE on `t_f22290a9`; review gate `t_082e8bf4`;
  - published by `t_2c188464`;
  - on DEV by `t_603119db` as release `97c94faed574905407fd92a182d5df6522dcc2af`
    (the release merge of `main` `d7c7623f` into the tip).

  Round 2 commits on top of `617dcc8`, on the same branch, in the existing
  worktree `/workspace/wt/signin-sync`. There is no merge step.
- **Round 1 is not accepted.**
  - Its acceptance gate `t_65c4d2ec` stays blocked, superseded by round 2's
    chain. **No one completes `t_65c4d2ec`.**
  - Round 1's chain cards (`t_2c188464`, `t_603119db`, `t_4bb4b0fe`,
    `t_65c4d2ec`) and its sentinel `t_ed021448` are not reused.
  - Round 2's DEV deploy replaces round 1's release on DEV. The host allows
    `set-dev` from `WAITING_FOR_HUMAN_DEV_ACCEPTANCE`. Nothing reaches MAIN
    or PROD.
- **The contract still governs:**
  - `devtasks/PREBRIEF-signin-sync.md`, FINAL Rev 1, at
    `6220ffef58e4b11c7f5192dba38f6e4b87b22b0e` (sha256
    `10444d771dbd4251318964919a15d0bd303d8fb0b696b6cb4403ab19956465cf`);
  - the GLM brief `t_e7c35ee3`;
  - the operator's pin on the brief-review gate `t_315cd897`
    (`codeToReason('SIGNED_OUT')` is "You have been signed out.");
  - the four deviations accepted on the review gate `t_082e8bf4`: the
    `index.js` wiring, the `beforeWorldLoad` test hook, steps 6 and 7 as
    one commit, and the `git checkout` after the OOM kill.

  This file adds J1–J5 and changes nothing else.

## 1. What the browser checks found

Claude ran the pre-brief's §6.7 checks on `617dcc8` (2026-10-29, 21:25–21:35
PT) with the real server and its DB behind two HTTPS origins. Two tabs shared
one browser context, as a browser's tabs do. The harness is
`devtasks/harness/checks/signin-sync/authserver.mjs` and `c.py`, on
`claude/harness-signin-sync` at `48828678`.

### 1.1 What passed
- **The server side, all of it.**
  - Logout closes exactly that sign-in's sockets with `SIGNED_OUT` (the I7
    lines count 1 or 2, as expected).
  - `hello` says who was admitted, on same-origin and cross-origin
    connections.
  - The repro script with `--expect-fixed`: six of six.
  - The I7 log lines, with no ids in them.
- **Check 1:** tab B signs out, and tab A (visible, or hidden at the time)
  shows signed out and disconnected, with "You were signed out in another
  tab."; tab B shows no notice.
- **Check 3:** a stale tab's Load of an old-user world and its Connect make
  **no** connect, show the right notice and refresh the world list.
- **Check 4:** after expiry, a tab that shows a user makes no anonymous
  connect, and shows the expired notice.
- **Check 6:** a cross-origin connect is anonymous, with no notice and no
  disconnect.

### 1.2 What's broken
1. **After a change of user, the tab never reconnects** (checks 2, 3b and
   8). It updates the top bar and the notice, then stays disconnected.
   - **The mechanism:**
     - `runSync()` calls `applyChange()` while its own request is still the
       one in flight (`auth-sync.js`, `syncAuth()` sets `inFlight` until
       `runSync()` settles);
     - `applyChange()` step 4 calls `autoConnect(user)`, which goes through
       `trackConnect` → `guardConnect()` → `syncAuth()`;
     - that call **joins the request still in flight**, whose answer is
       `{ changed: true }`, so the guard cancels the autoconnect it was
       asked to make.
   - It happens on every path that ends signed in as someone new: another
     user (check 2), a stale tab after its Load or Connect (check 3b), and
     signing back in as the same account (check 8).
   - **The unit tests missed it** because I4's tests give `applyChange` a
     spy for `autoConnect`; nothing drove the autoconnect through the real
     guard.
2. **A cancelled connect leaves Connect stuck on "Connecting..."** (checks
   3a and 4, and 2 and 8).
   - `autoConnectToHomeWorld` and `handleConnect` call
     `setConnectionState('connecting')` and then `trackConnect`. When the
     guard cancels, `trackConnect` clears the overlay and the failure panel
     but **never resets the connection state**.
   - So the button stays disabled until a reload, even when the new state
     is signed out (check 4).
3. **I3 never compares, and I4 never disconnects** (check 5).
   - `sameOriginAsAccount(worldUrl, accountOrigin)` (`wsUrl.js` L114)
     converts the **world** URL to `https:` and compares it with
     `new URL(accountOrigin).origin`.
   - Every caller in `app.js` passes `accountWsBase`, which is
     `computeWsUrl(location)`: a **`wss:`** URL, such as
     `wss://127.0.0.1:8443/apps/client/local.html`. Its origin is
     `wss://127.0.0.1:8443`, so the comparison is always false. In the page,
     even the tab's own home world counts as cross-origin.
   - The helper's tests pass an `https:` account origin, so they never saw
     it.
   - **Effects in this round:**
     - I3 (`handleSessionReady`, sameOrigin false) never compares. In check
       5, the tab was admitted as bob with alice in the top bar, and showed
       no notice.
     - I4 step 3 (`connectionIsSameOrigin`) never disconnects a same-origin
       socket.
   - **Effect since T7 (2026-09-30):** the client's `displayName` is never
     sent on a teleport, Go back, resync or Connect. The server ignores
     client names (pre-brief #9), so nothing visible changed.
4. **Renewal fires on every check after about a week** (minor; Claude
   confirmed it against the real server).
   - `renewSessionIfBelowHalfLife` measures the life as
     `expires_at − created_at`. A renewal moves `expires_at` but not
     `created_at`, so each renewal lengthens the "life".
   - Once a sign-in is about 7 days old, every `GET /api/auth/me` renews:
     a DB write, a `Set-Cookie` and an `[auth] renewed` line on every
     visible tab and every connect. In Claude's run, sign-ins 10 and 30
     days old renewed with 6 and 6.9 days left.
   - The pre-brief's I6 meant half of the 7-day lifetime: renew below 3.5
     days left, which keeps the writes rare.

### 1.3 Not in this round
- The 28-script regression set (4b-2 passdown §4.6). Claude runs it on round
  2's tip before DEV acceptance.
- **Realistic same-account timing (check 8)** reaches the tab as signed out
  first (`SIGNED_OUT` arrives at the logout), then as alice (the login's
  `auth-changed`). The notice is then "You're signed in as alice now (the
  sign-in changed in another tab).", not S1's "then signed in again". That's
  accurate, and S1's text remains for the case where the sign-in is already
  back when `SIGNED_OUT`'s check runs. No change.

## 2. The contract (round 2)

### J1. The autoconnect after a change goes ahead
- **The answer that found the change counts as the guard's answer for the
  autoconnect that the change itself starts**, in the same way the
  load-time `me()` already counts for the page-load autoconnect.
- **That one connect only.** The skip is passed **explicitly**: for example,
  `applyChange()` calls `autoConnect(user, { confirmedUser: user })`, and
  the connect path skips the guard only when `confirmedUser` is given and is
  the current user.
  - **No module-level flag** that a later connect could consume.
  - Every other connect, including a user's Connect right after the change,
    still runs `syncAuth()`.
- It covers every path that ends signed in: another user, signed-out to
  signed-in, and `SIGNED_OUT` with the same user (S1).

### J2. A cancelled connect restores the connection state
- When the guard cancels a connect, the connect path sets the connection
  state to what it actually is: `'connected'` if the client is connected (a
  cross-origin connection I4 left alone), otherwise `'disconnected'`. It
  does this in addition to clearing the overlay and the failure panel.
- It holds for every site that set `'connecting'` first: autoconnect and the
  Connect button today, and any later site, because it lives in the one
  connect path.

### J3. `sameOriginAsAccount` compares origins whatever their schemes
- **Both arguments are normalised the same way:** a `ws:`/`wss:` URL becomes
  `http:`/`https:` (through the existing `wsOriginToHttpOrigin`), and an
  `http:`/`https:` one is used as it is. Then the two origins are compared.
- **Unparseable input stays false.**
- `app.js`'s callers keep passing `accountWsBase`. The fix lives in the
  helper, so the six callers and I3, I4 and T7 are all fixed at once.
- **Expected consequences, all intended:**
  - I3 compares on every same-origin connection;
  - I4 step 3 disconnects a same-origin socket on a change;
  - T7's `displayName` is sent again on same-origin connects. The server
    still ignores it.

### J4. Renewal measures half of the fixed lifetime
- A session is renewed when it has **less than 3.5 days left**
  (`SESSION_LIFETIME_MS / 2`). `created_at` is no longer read for this.
- A session just renewed has 7 days left and isn't renewed again until it is
  below 3.5 days.
- Everything else in I6 is unchanged: the cookie is re-set with the same
  attributes, an expired session gets 401 and isn't renewed, and the
  `[auth] renewed` line is written.

### J5. What doesn't change
- The server's identity, logout and re-resolution code (round 1's steps 2–3).
- The protocol schemas.
- `packages/client`.
- I2's rules, the notices' texts, and I4's steps other than step 4's
  connect.

## 3. Tests and proofs (round 2)

| Item | New tests |
|---|---|
| J1 | **Through the real guard, never a spy.** The connect path that `app.js` uses (`trackConnect`, or the function it moves into in `auth-sync.js` so it can be driven in a test) is wired to a real `createAuthSync`, with `me()` and `client.connect` faked. **(a)** The page is alice and `me()` answers bob, from `syncAuth()` on visibility: exactly **one** `client.connect`, to bob's home, with no second `me()` for it. **(b)** Signed out, and `me()` answers alice: one connect to alice's home. **(c)** `SIGNED_OUT` with `me()` answering the same user: one connect to the home world. **(d)** Right after (a), a user's Connect makes a **new** `me()` call before it connects |
| J2 | After a cancelled connect started by autoconnect, and by the Connect button: the state is `'disconnected'`, and the button reads Connect and is enabled. With a cross-origin connection still open and a change found: the state is `'connected'` |
| J3 | `wsUrl.test.js`: with the account base `computeWsUrl({ protocol: 'https:', host: '127.0.0.1:8443', pathname: '/apps/client/local.html' })`, the exact kind of value `app.js` passes, `wss://127.0.0.1:8443/worlds/a/home` is same-origin and `wss://127.0.0.1:8444/` isn't. The existing `https:` account cases still pass. `ws:` with `http:`; mixed schemes (`ws:` world, `https:` account) are false; garbage is false. **App level:** `session:ready` for a connection to the page's own origin, with `accountWsBase` as `app.js` computes it, runs I3's comparison (a mismatch shows the reload notice) |
| J4 | A session created 30 days ago with 6.9 days left: no renewal, no `Set-Cookie`, no write. The same with 3 days left: renewed to about 7 days. A session renewed just now: the next check doesn't renew it. Round 1's 6.2(d) cases still pass |

**Proofs** ("not reproducible" is not an acceptable result):
- **(j1)** the explicit skip removed (the autoconnect guarded again): J1
  (a)–(c) fail;
- **(j1b)** the skip made unconditional (every connect skips the guard):
  J1 (d) fails;
- **(j2)** the state reset removed: J2 fails;
- **(j3)** `sameOriginAsAccount` back to round 1: J3's `wss:` cases and the
  app-level I3 test fail;
- **(j4)** the life back to `expires_at − created_at`: J4's 30-day cases
  fail.

**And the whole round still passes:**
- full suites with round 1's rules:
  - server files one at a time under `timeout 180`;
  - `packages/client` without `--test-force-exit`;
  - every other package on its own directory;
- round 1's client proofs (p4), (p5), (p9) and (p10) re-run and quoted, since
  they live in the files this round touches. (p4) runs for each of the six
  sites, as before;
- (p6) re-run against J4;
- the repro script with `--expect-fixed` on the tip: six of six.

**Steps, one commit each:**
1. J3: `wsUrl.js` and its tests;
2. J1 and J2: the connect path and `auth-sync.js`, `app.js`'s wiring, and
   their tests;
3. J4: `http-routes.js` and its test;
4. suites, proofs and the handoff.

**Files:** `apps/client/src/wsUrl.js`, `apps/client/src/auth-sync.js`,
`apps/client/src/app.js`, `packages/server/src/http-routes.js`, and tests
under `apps/client/tests/` and `packages/server/test/`. **No other file.**
If another file must change, stop and ask.

**Before DEV acceptance,** after round 2's release chain publishes and
deploys:
- **Claude's checks on the published tip:**
  - `c.py`, all checks (1–6 and 8), every one passing, including 2, 3b and
    8's reconnect, the Connect button after 3a and 4, and 5's reload notice;
  - the 28 regression scripts;
  - the repro script with `--expect-fixed`;
- **after the DEV deploy,** `atrium-release-status`: DEV actual = recorded =
  `RELEASE_SHA`, healthy;
- **Claude writes the acceptance steps out in plain words** for the
  operator: the pre-brief's §6.8, with two tabs and two accounts.

## 4. Kickoff body for round 2 (post it verbatim as the revision kickoff card's text)

---

### KICKOFF — signin-sync revision round 2. Slug: `signin-sync`

You are the kickoff orchestrator for round 2 of `signin-sync`. Build the
graph below, read it back, report, and stop. Do not implement, review or
deploy anything yourself.
- **Your tools:** only `kanban_*`.
- **Blocking:** never call `kanban_block` without an explicit `task_id`.
  Never block this card, with one exception: if you are dispatched before
  the front door's two comments (the revision's commit and hash, and round
  2's sentinel id) are on this card, call
  `kanban_block(task_id=<this card's id>, kind="needs_input", reason="waiting for: <the missing comments>")`
  and do nothing else.
- **Titles:** use them exactly as written. Don't add words to them.
- **Bodies go in each card's body field** when you create it, and each
  card's parent goes in the same `kanban_create` call. Read every card back:
  - if a body is empty, post the body as its first comment while it's
    `todo`;
  - if a parent is missing, link it at once;
  - never create a second card in its place.

**The contract is in git; you don't read it.** It is
`devtasks/REVISION-signin-sync-r2.md` on `main`, together with:
- `devtasks/PREBRIEF-signin-sync.md` at `6220ffef58e4b11c7f5192dba38f6e4b87b22b0e`
  (sha256 `10444d771dbd4251318964919a15d0bd303d8fb0b696b6cb4403ab19956465cf`);
- the GLM brief `t_e7c35ee3`;
- the operator texts on `t_315cd897` and `t_082e8bf4`.

**The front door has already checked the round-2 revision** and posted its
commit and sha256 on this card. **You have only `kanban_*` tools: do not try
to fetch or hash anything, and do not block for lack of a shell.**

Copy that commit and sha256 into cards 1 and 2. **They** have terminal, file
and git tools. Each reads the revision with
`git -C /workspace/atrium fetch origin main && git -C /workspace/atrium show <commit>:devtasks/REVISION-signin-sync-r2.md > /tmp/revision-r2.md && sha256sum /tmp/revision-r2.md`,
and blocks with `kind="capability"` on a mismatch.

#### Graph
1. **`Implement r2 — signin-sync`.** Assignee `atrium-deepseek`, parent:
   this kickoff, `--max-runtime 2h` (7200 s), passed in the create call.
   - **Body:**
     - the revision reference and hash check;
     - continue `workflow/signin-sync` from
       `617dcc8cad03019b10fd2ee1175449e718b75952` in the existing worktree
       `/workspace/wt/signin-sync`. `git -C /workspace/wt/signin-sync status`
       must be clean at that SHA, or block `needs_input`;
     - **there is no merge step this round;**
     - the revision's §2 contract (J1–J5) and §3 tests, proofs, steps and
       files;
     - **J1's tests drive the autoconnect through the real guard, never a
       spy.** Round 1's I4 tests used a spy, and that is how the bug got
       through;
     - **J3's tests use a `wss:` account base, the kind of value `app.js`
       actually passes.** Round 1's helper tests used `https:`, and that is
       how the bug got through;
     - the pre-brief, the GLM brief `t_e7c35ee3` and the operator texts on
       `t_315cd897` and `t_082e8bf4`, still binding;
     - the WORKER-CARD REQUIREMENTS comment (855 on `t_2d41531f`);
     - a progress comment on its own card after each step's commit.
   - **The handoff** carries:
     - proofs (j1), (j1b), (j2), (j3) and (j4), each with its failing test
       names;
     - round 1's (p4) for each of the six sites, and (p5), (p6), (p9) and
       (p10), re-run;
     - the repro script's `--expect-fixed` output: six PASS, exit 0;
     - per-file counts with exit codes, and the Node version;
     - `git diff --stat 617dcc8c <tip>`, showing only the revision's files.
2. **`GLM review r2 — signin-sync`.** Assignee `atrium-glm`, parent: card 1.
   - Its body opens with
     `THIS RUN HAS TERMINAL, FILE AND GIT TOOLS. Use them for every step below.`
   - **The review covers round 2's change** (`617dcc8c` to the round-2 tip)
     against this revision. It reproduces **every proof** itself.
   - **J1:** it reads every call of `autoConnect` and every connect path,
     and confirms that only the change handling's own autoconnect skips the
     guard, and only through the explicit argument. It writes its own test,
     or reuses (a), that runs a change through the real guard to one
     `client.connect`.
   - **J3:** it calls `sameOriginAsAccount` itself with
     `computeWsUrl(location)`'s output for an `https:` page, and checks
     that each of the six `app.js` callers gets `true` for the page's own
     origin.
   - **J4:** it confirms `created_at` no longer decides renewal.
   - **It confirms the diff touches only the revision's files.**
   - **Progress comments on its own card** after each stage.
3. **`Review gate r2 — signin-sync`.** Assignee `atrium-orchestrator`,
   parent: card 2. It creates nothing.
   - **On a valid APPROVE of the exact 40-character SHA,** it blocks with
     `APPROVE <SHA40>: front door, build the release chain`.
   - **Otherwise,** it blocks for the operator with the verdict quoted.
4. **Before you complete,** link card 3 to **round 2's sentinel** as a
   parent. The front door creates it and posts its id on this card. Do not
   create a sentinel yourself, and do not use round 1's `t_ed021448`.
5. **The release chain** is the front door's: the same four cards as round
   1's (Publish, DEV deploy, DEV finalizer, acceptance gate), with the new
   SHA, built whole at card 3's APPROVE.
   - **Round 1's chain cards (`t_2c188464`, `t_603119db`, `t_4bb4b0fe`,
     `t_65c4d2ec`) are not reused,** and no one completes `t_65c4d2ec`.
   - The Publish is a fast-forward of `workflow/signin-sync` from
     `617dcc8c`.
   - The DEV deploy replaces round 1's release on DEV. Nothing reaches MAIN
     or PROD.

#### Report back
- the three ids;
- the implementation's parent and its 7200 s cap;
- the hash line copied into cards 1 and 2;
- the review's opening line;
- the gate linked to round 2's sentinel.

Then complete this card.

---
