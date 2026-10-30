# Atrium Passdown — 2026-10-30 — signin-sync (the page and the server agree about who you are), released

**Predecessor:** `devtasks/Atrium-Passdown-2026-10-29-scripting-4b-2.md`. Its
host, connector and convention notes still hold, except where this file says
otherwise.

**First instruction for the next session's Claude:**
1. Clone the repo and read `devtasks/`, newest first (this file first).
2. Use the `atrium-ops` connector for board, release, log and git state. It
   is read-only: it can't create cards, comment or push.
3. **Next: the small host round (§6.2), then Phase 3 step 4c** (§6.1),
   visitors' `activate`. The host round goes first, whole: its item 1 (cards
   created without a parent) is a risk to every release chain, including
   4c's. 4c's pre-brief can be written while it runs; it doesn't exist yet,
   and `devtasks/PREBRIEF-scripting-4b-2.md` §9 is its sketch. Only 4c's
   kickoff waits for the host round.
4. **Never push to `main` between a DEV deploy's release merge and the MAIN
   push** of the release you mean to ship. A round that is on DEV and will be
   **replaced** (not accepted) doesn't count: its revision can go to `main`,
   as 4b-2's and this round's did, as long as no one accepts it.

## 1. Status at handoff

| Item | State |
|---|---|
| Release | **COMPLETE** (2026-10-29 ~23:42 PT). DEV, MAIN and PROD are at `ab02239befbd68082e0027664e6a93407bed48f7`, recorded and healthy, with the deploy lock free. PROD restarted at 06:42 UTC on the new code |
| What `ab02239b` is | The release merge of round 2's reviewed tip `a70a2476c742e12be1ec94b7fe42b39cb425ecfd` with `main` `df769276`. The only difference is `devtasks/` |
| Spec | `devtasks/PREBRIEF-signin-sync.md` FINAL Rev 1 (29,785 bytes, sha256 `10444d77…65cf`, at `6220ffef`); the GLM brief `t_e7c35ee3`; the operator's pin on `t_315cd897`; the four deviations accepted on `t_082e8bf4`; `devtasks/REVISION-signin-sync-r2.md` (19,602 bytes, sha256 `70c42ed2…dab6`, at `df769276`) |
| Rounds | **Two.** Round 1 passed every suite, GLM's review and the repro, and failed Claude's browser checks (§4.1). Round 2 fixed it |
| DEV acceptance | The operator, on `ab02239b` (2026-10-29 ~23:30 PT): sign-out in one tab, another user, the same account again, returning to a tab, editing, and the DEV journal's I7 lines. All pass |

## 2. What shipped

- **I1, `hello` says who was admitted:** `signedIn` in every server `hello`,
  and `userId` exactly when signed in (`hello.server.json`, `if`/`then`/`else`).
  A cross-origin connection always gets `signedIn: false`. On the client,
  absent means unknown, never anonymous.
- **I2, the page re-checks:** one `syncAuth()` (`apps/client/src/auth-sync.js`)
  before every connect (all six sites go through `trackConnect`), when the tab
  becomes visible, on a `BroadcastChannel('atrium-auth')` message from another
  tab, and on any other 401. Responses from an earlier sign-in are dropped
  (an auth generation counter).
- **I3, the backstop:** a same-origin `hello` that disagrees with the page
  triggers a re-check, then "This world admitted you as X, but the page says
  Y. Reload the page."
- **I4, what a reload would do:** the top bar and world list follow, a
  same-origin socket is dropped, a signed-in tab autoconnects to its home, and
  a notice in `#auth-notice` says what happened. The tab that signs itself out
  ignores its own `SIGNED_OUT`; a failed sign-out says "Couldn't sign out. Try
  again." and stays signed in.
- **I5, logout closes that sign-in's sockets:** every socket (sessions and
  pre-hello) admitted with that auth session, on every world host, gets
  `error` `SIGNED_OUT` and close 1008. A socket admitted after a world load
  re-checks the sign-in at that moment (Rev 1's M1). A failed session
  deletion is a 500, with no cookie cleared and no socket closed (M4).
- **I6, renewal:** `GET /api/auth/me` renews a session with less than 3.5
  days left to 7 days (round 2's J4).
- **I7, log lines:** `[auth] login|register|logout … closed N sockets|logout
  failed|renewed <username>` and `[session] hello <8> as <name|anonymous>
  world <id>`. No ids or cookies.
- **`sameOriginAsAccount`** (`wsUrl.js`) now normalises both sides. It had
  been given the page's `wss:` address since T7 (2026-09-30) and was always
  false; T7's `displayName` is now sent on same-origin connects again
  (the server still ignores it).

**Tests at round 2's handoff:** server 43 files, each on its own, all pass;
`packages/client` 542, `apps/client` all pass; protocol, som, renderer-three,
interaction, behaviors all pass; one named skip. The repro script with
`--expect-fixed`: six of six.

## 3. How the round ran

| Stage | Cards | What happened |
|---|---|---|
| Pre-brief | — | Claude reproduced both forms at the real server first (`repro.mjs`). FINAL Rev 0 approved 19:02 PT |
| Outside review of the kickoff | — | CHANGES REQUESTED: M1 (a logout during a world load), M2 (other 401s, late responses), M3 (the kickoff's blocking rule contradicted itself), M4 (a failed logout reported success), S1–S4. All taken into Rev 1 before dispatch |
| Round 1 | kickoff `t_9e5fbd78`, sentinel `t_ed021448`, brief `t_e7c35ee3`, brief gate `t_315cd897`, impl `t_0149264e`, GLM `t_f22290a9`, gate `t_082e8bf4`; Publish `t_2c188464`, DEV `t_603119db` (`97c94fae`), finalizer `t_4bb4b0fe`, acceptance `t_65c4d2ec` (never completed) | `617dcc8c`. GLM APPROVE, with four declared deviations accepted. Claude's browser checks: three client bugs and a minor server one (§4.1). Not accepted |
| Round 2 | kickoff `t_5b594bfc`, sentinel `t_9e23bb28`, impl `t_2aca3080`, GLM `t_3c231567`, gate `t_7371f21e`; Publish `t_4d192108`, DEV `t_1c3551ce`, finalizer `t_d4bcfc78`, acceptance `t_2127b2dc` | J1–J4 (`devtasks/REVISION-signin-sync-r2.md`). GLM APPROVE `a70a2476`. Claude's checks all pass; DEV accepted; released |

## 4. Findings and lessons

### 4.1 Browser checks caught three bugs that every other check passed
Round 1 passed its suites, ten proofs, GLM's review with its own held-load
check, and the repro. In a real page with two tabs:
- **the autoconnect after a change was cancelled by its own guard:**
  `applyChange` called `autoConnect` while its own `syncAuth()` was still in
  flight, so the guard joined that request, got "changed", and cancelled;
- **a cancelled connect left Connect disabled on "Connecting...";**
- **`sameOriginAsAccount` was always false in the page**, so I3 never
  compared and I4 never disconnected.

Both test gaps have the same shape: **the test fed a collaborator a stand-in,
not what production feeds it.** I4's tests gave `applyChange` a spy for
`autoConnect`, and the helper's tests passed an `https:` base where `app.js`
passes a `wss:` one. Round 2's revision required tests through the real
guard and with the real value, and GLM checked both. **Put that rule in
every brief:** a test of a seam uses the real collaborator or the exact value
production passes.

### 4.2 The outside review earned its place before dispatch
Reviewing the **kickoff and pre-brief**, not code, it found the M1 race (a
socket admitted with pre-logout rights after a world load) and the M4
failure contract, both of which shipped as tests. It also found that every
kickoff since library-sky told the orchestrator both "never block this card"
and "block if the comments are missing". This round's kickoff gave one
explicit exception, with the card's own id.

### 4.3 The kanban tools drop fields, and cards land parentless and ready
- **`kanban_create` in the orchestrator's runs** dropped every body and the
  implementation card's runtime cap. The orchestrator says its tool schema
  offered no runtime field at all. Bodies went in as first comments.
- **`kanban_complete`** rejected the kickoff's summary about 130 times in a
  row ("provide at least one of: summary, result") until the 150-step budget
  ran out; the retry completed in 29 s.
- **Three cards landed `ready` with no parent**, then were linked seconds
  later: round 1's sentinel (the dispatcher claimed it in 4 s, and it blocked
  asking for its parents), round 1's implementation card, and round 2's
  Publish (a retried create without `parents`; linked after 27 s, never
  claimed). An unparented Publish or deploy card that gets claimed would run
  out of order.
- **Fix on the host (§6.2):** the guard refuses a workflow card created
  without a parent, or creates it `blocked`; and find why the orchestrator's
  tool surface drops `body`, `max_runtime_seconds` and `summary`.

### 4.4 A `todo` card's cap can be raised
The orchestrator and the front door both said the implementation's 90-minute
cap couldn't be changed after creation. It can: models-by-url passdown §5.3's
recipe raised `t_0149264e` to 14400 s before the gate released it.

### 4.5 `atrium-release-status`'s health doesn't check content
The front door reported PROD serving `4a1a01a5`'s files. It was wrong: on the
host both PROD names served `0c31ddc0`'s `app.js` and `behavior-form.js`, from
`/srv/atrium`, with no cache. But the script couldn't settle it, because its
health only checks that four files return 200. **Small fix (§6.2):** compare
one served file's hash with the checkout's.

### 4.6 Smaller notes
- **The implementer's first proof run was OOM-killed** on the 4 GB host
  mid-(p7). It restored a file with `git checkout` (accepted: committed and
  identical) and re-ran (p7).
- **The board page's Done column didn't show the GLM brief** `t_e7c35ee3`,
  though it was done and not archived. It was reachable from the kickoff's
  children.
- **Same-account timing:** when another tab signs out and back in as the same
  user, this tab normally sees signed-out first (`SIGNED_OUT` arrives at the
  logout), then the user again. The notice is then "You're signed in as alice
  now (…)", not S1's "then signed in again". It ends in the right state.
- **Behaviours run in one tab** (the script host) by design. The operator
  noticed it at acceptance; 4c lets any tab's click reach the host (§6.1).

## 5. Recipes
The same as the 4b-2 passdown §5, plus:
- **The real-sign-in harness:** `devtasks/harness/checks/signin-sync/` (see
  `devtasks/harness/README.md`). `setup.sh <sha>`, then
  `HARNESS_ROOT=… node devtasks/harness/checks/signin-sync/authserver.mjs`
  (Bash `run_in_background`), then `python3 …/c.py` and `…/c4b.py`.
- **The regression set with a baseline:** `reg_run.sh` on the base commit's
  harness root and on the tip's, then `regdiff.py`.
- **The guarded PROD block** is the teleport-rearm passdown §7.2, with `S`
  set to the release SHA.

## 6. Follow-ups

### 6.1 Next: Phase 3 step 4c — visitors' `activate`
From `PREBRIEF-scripting-4b-2.md` §9: the message and schema; the server's
checks (an enabled behaviour that listens for `select`, distance, 5 per
second per session and 20 per world, a host present); forwarding to the
current `hostGen` only; the visitor's click path; and the non-host owner
tab's clicks through the same route.

**What this round gives 4c:** the server knows each socket's user and auth
session, `hello` tells the page who it is, and the page and the server now
agree. 4c's checks can trust `session.userId`, and a signed-out owner's tabs
lose their sockets.

### 6.2 Small host round (next, before 4c's kickoff)
1. §4.3: workflow cards created without a parent are refused or created
   `blocked`; find why the orchestrator's `kanban_create` and
   `kanban_complete` drop fields.
2. §4.5: `atrium-release-status` compares a served file's hash with the
   checkout's.
3. `@atrium/behaviors` in the host's test list (4b-2 passdown §6.5).
4. The 4 GB host's memory during proof runs (§4.6).

### 6.3 Carried, unchanged
4b-2 passdown §6.2 (no way to add a light), §6.3 (the proximity template's
two objects), §6.4 (a visitor's proximity animation once missing until a
reload), §6.6 items 1–4, and the edit-polish-3 passdown §6.3 items 1–6 and 8.

### 6.4 Recorded, not done
- **A socket whose session expires stays open** until it closes (I5, by
  design); the page drops it at its next check (I4, now working).
- **The `beforeWorldLoad` test hook** lives in `world-registry.js`
  (accepted deviation 2). If a later round touches the registry, it can move
  behind a test-only factory.

## 7. Cleanup (operator, host)
```bash
# round 1's acceptance gate, superseded and never completed; nothing is under it
hermes kanban --board atrium archive t_65c4d2ec
# the round's branches (the harness is merged into main with this passdown)
git -C /root/lib-install push -q https://github.com/joshmaurice/atrium --delete \
  workflow/signin-sync release/617dcc8cad03 release/a70a2476c742 \
  claude/harness-signin-sync
git ls-remote https://github.com/joshmaurice/atrium   # main only
```
