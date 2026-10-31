# Atrium Passdown — 2026-10-30 — scripting-4c (visitors' `activate`) and the small host round, released

**Predecessor:** `devtasks/Atrium-Passdown-2026-10-30-signin-sync.md`. Its
host, connector and convention notes still hold, except where this file says
otherwise.

**First instruction for the next session's Claude:**
1. Clone the repo and read `devtasks/`, newest first (this file first).
2. Use the `atrium-ops` connector for board, release, log and git state. It
   is read-only: it can't create cards, comment or push.
3. **Next: Phase 3 step 4d** (§6.1), graphs beyond the templates. It needs a
   pre-brief first, from `devtasks/PREBRIEF-scripting-4c.md` §10 and
   `devtasks/PREBRIEF-scripting-4b-2.md` §9. 4d runs world-supplied graphs, so
   it gets an outside review (of the pre-brief, and of the round).
4. **Never push to `main` between a DEV deploy's release merge and the MAIN
   push** of the release you mean to ship. A round that is on DEV and will be
   **replaced** (not accepted) doesn't count: its revision can go to `main`
   once the operator has decided to replace it, as this round's did.
5. **Give the operator host commands as one copyable `bash <<'EOF'` block
   each, and say exactly when to run it** (now; only after X shows Y). Pasted
   multi-line commands without the wrapper lose output.

## 1. Status at handoff

| Item | State |
|---|---|
| Release | **COMPLETE** (2026-10-30 ~17:58 PT). DEV, MAIN and PROD are at `14ab00768b692634d8b767c44eb22285d2a93045`, recorded and healthy, with the deploy lock free. PROD backup `/var/backups/atrium-prod/atrium-20261031T005746Z-ab02239befbd.db` |
| What `14ab0076` is | The release merge of round 2's reviewed tip `59f50d3d16e47baef39e6b7d25d1fd3d635dc212` with `main` `5e70ed72`. The only difference is `devtasks/` |
| `main` now | `c7f58f50` (+ this passdown): one `devtasks/` commit after the release (`m1.py`). Release status shows `main` ahead of the recorded SHA; that is expected |
| Spec | `devtasks/PREBRIEF-scripting-4c.md` FINAL Rev 1.3 (69,279 bytes, sha256 `07e3ecb7…6cd4`, at `53f68ba9`); `devtasks/KICKOFF-scripting-4c.md` (sha256 `d1ac80fc…6fb1`, at `bf206e5f`) and its Settlement; the GLM brief `t_57733b6c`; the operator's three pins on `t_4c2519ef`; `devtasks/REVISION-scripting-4c.md` (23,336 bytes, sha256 `33e43b5c…623e`, at `75e2a03e`) |
| Rounds | **Two.** Round 1 passed every suite, GLM (0 findings) and Claude's 13 browser checks, and got an outside **NO-GO** (M1, §4.1). Round 2 fixed it |
| Reviews | Pre-brief: two outside reviews (`REVIEW-scripting-4c-rev0.md`, `REVIEW-scripting-4c-rev1.1.md`). Round 1: NO-GO (M1, S1–S3). Round 2: **GO**, one nit (N1, §6.2). Both code reviews were source-only: the reviewer's environment can't resolve `github.com` (§4.3) |
| DEV acceptance | The operator, Firefox, on `14ab0076` (2026-10-30 evening): all eight §7 steps pass |
| Host round | Done (§3.1): guard v1.2.0 in all six copies and loaded by the gateway, the content health check, `@atrium/behaviors` in the deploy's suites, the 2,600 MiB container cap |
| Board | Clean: round 1's superseded finalizer `t_906cd735`, gate `t_57ec50fa` and sentinel `t_5fc688b3` archived; nothing blocked or to-do |
| Branches | `main` only (and the old PR #1, not this project's) |

## 2. What shipped

- **`activate` (client → server)** `{ seq, node, event: 'select' }`, and its
  **forward** to the script host only `{ seq, node, event, from, hostGen }`
  (`activate.client.json`, `activate.server.json`). `from` is for the host's
  log line only, never identity (pin 1).
- **The server's ten ordered checks** (`session.js`, the `activate` case):
  handshake, the session bucket (5/s, burst 5) **before** the node lookup, the
  node, an enabled behaviour that listens for `select` (`selectTargetFor`),
  the 10 m rule against the target's **world** position (`worldPosition`,
  now in `@atrium/som`, re-exported by `apps/client`), a script host, its
  readiness, the world bucket (20/s) at the forward, then the forward.
  Refusals: `PERMISSION_DENIED`, `RATE_LIMITED`, `INVALID_FIELD`,
  `NODE_NOT_FOUND`, `NO_SCRIPT_HOST`.
- **Readiness (M1 of the pre-brief review):** `script-ready { hostGen }`, sent
  once per generation by the host's runner after its engines exist; only a
  ready host is forwarded to. A loading host means `NO_SCRIPT_HOST`, never
  silence.
- **Eligibility:** `scriptRunner: 2` in `hello`, required in both places
  (`canRunBehaviors` and the `hello` election). A 4b-2 page (`scriptRunner:
  1`) is never elected. A **cross-origin** `hello` carries no `scriptRunner`
  key at all, so older servers accept it (`connectNow` is the only place it is
  set).
- **The page:** every tab's click outside Edit mode resolves the same way
  (`activate-click.js`): the host runs it locally under the same 10 m rule
  (AC-L3 (a)), every other tab pre-checks and sends `activate`; pointer lock
  aims from the crosshair (`behaviorAim`); the 3 s notices ("Move closer to
  use this.", "Nothing happens: this world's owner isn't here right now.",
  …); a non-host owner tab's Behaviour status says "clicks here are sent to
  it".
- **Round 2 (W1–W6):** `hello.id` and `from` are 1–64 characters of
  `[A-Za-z0-9_-]` (W-L1); the forward re-checks `from` (W2); one `logId()` per
  package for every session id in a log line (W3); AC6's tests use the real
  `worldPosition` (W4); non-finite distances tested directly, and the vector
  generator refuses vectors that don't survive JSON (W5); the handover test
  with the legacy owner connected first (W6).

**Tests at round 2's handoff:** server 45 files, each on its own, 678 pass;
protocol 122; som 255; behaviors 176 + the one named conformance skip;
`packages/client` 554; `apps/client` 1,280; renderer-three 310; interaction 9.
Every proof (w1)–(w6), (g2) both halves, and round 1's (c), (e), (g) rerun:
failed when broken, passed when restored; GLM reproduced each.

## 3. How it ran

### 3.1 The small host round (`devtasks/BRIEF-host-round-2026-10-30.md`)
A short brief, not a pipeline round. The source of record is `atrium-ops`
(`main` fast-forwarded to `0557880`).
- **Guard v1.2.0** (`atrium-kanban-guard`): a workflow card created without a
  parent (not titled `Kickoff…`) is created `blocked`, with the hold note;
  `kanban_link` releases it. It logs the argument **keys** (never values) of
  every `kanban_create` and `kanban_complete` (`"event": "args"` in
  `$HERMES_HOME/logs/atrium-kanban-guard.log`).
- **Six copies**, all `d14f7b85…`: one per profile under
  `/root/.hermes/profiles/<p>/plugins/`, **and** the root copy at
  `/root/.hermes/plugins/atrium-kanban-guard/`, which the gateway (the front
  door and the dispatcher) loads. Step B's glob missed the root copy; it was
  installed separately.
- **`atrium-release-status`** health now compares a served file's hash with
  the checkout's (`app.js sha256 … served = checkout HEAD`).
- **`buildrun.py`**: `@atrium/behaviors` is in the deploy's suites (eight now).
- **Memory:** `container_memory: 2600` in all six Hermes configs. Containers
  are created per need (`hermes-c6b7f940`, `hermes-13e7a713`, …), so the
  config is what counts; `docker update` only reaches a container that exists.
- **Step D, the dropped-fields diagnosis:** with v1.2.0's `args` lines, every
  orchestrator `kanban_create` carried `body`, `parents` and the cap. Nothing
  on the path strips them; the earlier drops were the model omitting them (in
  runs that were looping).

### 3.2 The rounds

| Stage | Cards | What happened |
|---|---|---|
| Pre-brief | — | Rev 0 → two outside reviews → FINAL Rev 1.3 (`53f68ba9`); AC-L1–L8 approved as recommended |
| Round 1 | kickoff `t_f101599a`, sentinel `t_5fc688b3`, GLM brief `t_57733b6c`, brief gate `t_4c2519ef`, impl `t_040b0b47`, GLM `t_6b0b990a`, gate `t_be15bfc1`; Publish `t_411af56e`, DEV `t_12a7dc13` (`a02c2429`), finalizer `t_906cd735`, acceptance `t_57ec50fa` (both never completed; archived) | `6378b49b`. GLM APPROVE, 0 findings; five declared deviations accepted. The (g2) half-2 proof gap recorded (§4.4). Claude's 13 checks all pass. Outside review NO-GO (M1). Not accepted |
| Round 2 | kickoff `t_58dd5f17`, sentinel `t_005810cc`, impl `t_586c6a38`, GLM `t_ed438570`, gate `t_ec65eb1f`; Publish `t_76eac566`, DEV `t_ee935235`, finalizer `t_16457b9b`, acceptance `t_0991f272`; PROD `t_fb37de60` | W1–W7. GLM APPROVE `59f50d3d`, 0 findings. Claude's 13 checks and the M1 reproduction pass; outside re-review GO; DEV accepted; released |

## 4. Findings and lessons

### 4.1 Count limits aren't size limits: the outside review's M1
Round 1 passed everything internal, and the outside review still found a
must-fix. `hello.id` had no maximum, the server adopted it as the session id,
and every forward copied it into `from`. **Reproduced on a real socket:** a
250,000-character anonymous id was admitted, and each 60-byte `activate`
reached the owner's browser as a **250,108-byte** frame. The buckets limit
how many, not how big. The same id also reached three log lines (one of them
whole) and every client's scene (the avatar is named `avatar-<first 8>`).
Round 2 bounds it at the schema; the host now receives **146 bytes** per
forward (`checks/scripting-4c/m1.py`).

**Put this in every brief that adds a server-stored or forwarded value:** its
bound, length and character set, in the schema, and a real-socket test with an
oversized and a control-character value.

### 4.2 Claude's checks of the review's claims found more than the review
Checking M1 and S1 against the code found the depth guard logging the
**whole** id (L686) and the avatar node's name. Check each finding at the
code, and look one step further along the same value.

**Correction:** the revision said every test id fits the bound. It checked
literal ids only. Five server tests generated ids with `Math.random()`, whose
`.` the bound refuses; the implementer fixed them (accepted deviation 2).
Scan generated ids too.

### 4.3 The outside reviewer can't clone
Both code reviews ran without a clone: their environment can't resolve
`github.com` (`git ls-remote` and `git clone` fail on DNS). Their GO was
conditional on the suites being green, which the implementer, GLM and the DEV
deploy each showed. **Plan around it:** keep asking them to run things, and
keep Claude's own real-server reproductions of their findings (`m1.py`).

### 4.4 A proof the implementer misreported
Round 1's handoff said breaking `canRunBehaviors` alone failed the handover
test. It didn't: that test connected the eligible owner first. GLM caught it
in review; Claude confirmed it with a probe. Recorded in round 1 and closed by
W6. **Proof claims need the quoted output of both runs** (round 2's kickoff
asked for it, and got it).

### 4.5 Kickoff cards: two lessons
- **The orchestrator copied its own instructions into a card** in round 1
  ("Its card carries (a) this kickoff body"): the GLM brief card got the
  orchestrator's role lines, and the front door corrected it. Round 2's
  kickoff said "write each card's body from the bullets under its title;
  don't copy this kickoff's own instructions into any card", and every card
  came out right. **Keep that line.**
- **A kickoff card is claimed within a second of creation.** Round 2's was
  claimed before the front door had posted the revision's commit and hash.
  The front door then blocked it as a "temporary hold", and the guard
  refused to let it lift that hold: it treats a `needs_input` block as the
  operator's. The orchestrator built the graph once the comment arrived, and
  the front door completed the kickoff. **Next time:** the front door creates
  the sentinel first and puts the commit, the hash, the operator's decisions
  and the sentinel id **in the kickoff card's body**, so there's nothing to
  post afterwards.

### 4.6 The gateway must be restarted to load a guard change
Worker runs are fresh processes and load the guard file at once. The gateway
(the front door and the dispatcher) loads it at start, and had run since
2026-10-12 on v1.1.4. A new front-door chat session (`/new`) does **not**
reload it; the host-round brief's §7 tick for that was wrong. It is a systemd
**user** unit, `hermes-gateway.service` (`Restart=always`), restarted
2026-10-30 16:48 UTC when nothing was running (§5). The first card the front
door created afterwards had v1.2.0's `args` lines.

### 4.7 The finalizer's verdict on a devtasks-only release merge
Round 1's DEV finalizer blocked because the release merge made `RELEASE_SHA`
differ from the reviewed SHA (a devtasks-only delta the front door had
verified). Round 2's passed on the same situation (`TARGET_SHA` =
`RELEASE_SHA`). The criteria text is the same; the reading differed. If it
blocks again, the front door's byte-for-byte check of the served files is the
evidence to accept it.

### 4.8 Smaller notes
- **Regression diffs that are timing:** library-sky `c23` (whether a frame
  showed the placeholder before a model loaded: the base itself records
  `False` for Tiny Cube) and `c67` (two parallel loads' order). Rerun before
  calling either a regression.
- **4b-2's `c4_4b1_newtext` check 5** stood in for a teleport with a direct
  `atriumClient.connect()`, which at 4c sends no `scriptRunner`. Every app
  connect goes through `connectNow` (`trackConnect` sites in `app.js`, the
  teleporter included). The script now passes `scriptRunner: true`, as
  `connectNow` does same-origin.
- **The implementer's W5 proof** didn't reproduce as written (non-finite
  values already lose every comparison at 10 m); it added `max = Infinity`
  cases, which make the finiteness guard necessary. Accepted.
- **The 4 GB host** ran round 2's implementation and proofs with the 2,600
  MiB cap and no OOM kill.

## 5. Recipes
The same as the signin-sync passdown §5, plus:
- **4c's browser checks:** `devtasks/harness/checks/scripting-4c/README.md`.
  The real server with page hooks (`authserver.mjs` with `HOOKS=1`), a fresh
  public world per run, a stale page through `STALE_ROOT` and the
  `x-harness-tree: stale` header, a held load, pointer lock, an older server
  on :8447. `c1.py`, `c2.py`, `c3.py`, `m1.py`; `reg4c.sh` and `regdiff.py
  <base dir> <tip dir>` for check 9.
- **Harness gotchas:** a new world is private (make it public, or a visitor
  gets `WORLD_UNAVAILABLE`); a signed-in tab first autoconnects to its home
  (wait for it before connecting elsewhere); the avatar spawns at
  `[0, 0.7, 0]` and the camera trails 4 m behind it; owner tabs have the
  world list over the top band of the viewport; Playwright's `route.fulfill`
  of a page's own files breaks every WebSocket it opens; long-running
  servers need a long background `timeout` (the default is 30 minutes).
- **Restart the gateway** (host, only when the board has nothing running):
  ```bash
  bash <<'EOF'
  export XDG_RUNTIME_DIR=/run/user/0
  hermes kanban --board atrium list --status running 2>&1 | grep -q '^. t_' && { echo "STOP: a card is running"; exit 1; }
  systemctl --user restart hermes-gateway.service; sleep 10
  systemctl --user status hermes-gateway.service --no-pager | head -5
  EOF
  ```
  Then the first front-door card's `args` lines in
  `/root/.hermes/logs/atrium-kanban-guard.log` confirm the guard version.
- **MAIN and PROD:** the 4b-2 passdown §5 (complete the acceptance gate,
  `atrium-main-approve $S && atrium-main-push $S`), then the teleport-rearm
  passdown §7.2's guarded block, with `S` the release SHA.

## 6. Follow-ups

### 6.1 Next: Phase 3 step 4d — graphs beyond the templates
From `PREBRIEF-scripting-4c.md` §10: the wider op allowlist, `flow/setDelay`
with its own timers, `event/onTick`, `pointer/interpolate`, the converter and
the unsupported-node report, `KHR_animation_pointer` models; a per-behaviour
distance (AC-L2 (b)) if wanted; and the conformance fixtures (4b-2 passdown
§6.6 item 1). It needs a pre-brief, and outside reviews.

### 6.2 Small, for 4d or any round that touches the server
- **N1 (the round-2 re-review):** `logCheckFailure` (`session.js` L104–106)
  still interpolates the whole `session.id`. Bounded by W1, but not through
  `logId`. One line.

### 6.3 Deferred: a same-tab sign-in doesn't re-admit the open world
The operator, at acceptance: connected to a world while signed out, then
signed in **in the same tab**, you stay the anonymous user in that world, to
yourself and others, until a world change (the World field or a teleporter).
Most of the time, not always. The page shows the sign-in, but its open socket
was admitted anonymously and nothing reconnects it; the server learns who you
are at the next `hello`. signin-sync covered sign-ins that change in
**another** tab. The intermittency suggests a race with the autoconnect to
home. **Workaround:** disconnect and reconnect. **The fix, when wanted:** on a
same-tab sign-in, reconnect a same-origin world as the new user, with a
real-sign-in browser check.

### 6.4 Carried, unchanged
The signin-sync passdown §6.3 and §6.4: the 4b-2 passdown §6.2 (no way to
add a light), §6.3 (the proximity template's two objects), §6.4 (a visitor's
proximity animation once missing until a reload), §6.6 items 1–4; the
edit-polish-3 passdown §6.3 items 1–6 and 8; a socket whose session expires
stays open until it closes; the `beforeWorldLoad` test hook.

### 6.5 Later (4c pre-brief §10)
A hover cursor over activatable objects; `hover` and visitor-side `change`;
server-enforced revocation before any non-disconnect role move.

## 7. Cleanup
Done (2026-10-30 ~18:15 PT): round 1's `t_5fc688b3`, `t_906cd735` and
`t_57ec50fa` archived; `workflow/scripting-4c`, `release/6378b49b6b6f`,
`release/59f50d3d16e4` and `claude/harness-4c-r2` deleted. Nothing left.
