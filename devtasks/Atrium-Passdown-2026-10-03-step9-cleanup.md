# Atrium Passdown — 2026-10-03 — Step 9 cleanup: pre-hello close, close codes, tests that exit

**Predecessor:** `devtasks/Atrium-Passdown-2026-10-02-step9-followup.md`.
Step 9's §7 and Step 8's §8 still hold the kickoff, MAIN, PROD and
revision-round recipes. The Step 6 passdown
(`…-2026-09-28-cross-server-connect-shipped.md`) still holds the F-list and
the kanban CLI recipes.

**First instruction for the next session's Claude: clone the repo and read
`devtasks/` before advising.**
- The chat sandbox can run `git clone https://github.com/joshmaurice/atrium.git`,
  `pnpm install` and every test suite. Background processes do not survive
  between tool calls there, so run tests in the foreground, in batches.
- **Read the pipeline passdowns too, not only the latest two.** This session
  Claude advised on a kickoff block before reading
  `…-2026-09-24-pipeline-stabilization-implemented.md`, and had to correct
  itself (§3.1).
- **Check claims against the code, prototype before approving a brief, and
  re-run every proof of failure.** This round that found a test that had
  checked nothing since Step 9 (§4) and two tests that never ran (§3.4).

## 1. Status at handoff

| Stage | State |
|---|---|
| Release state | **COMPLETE** (`atrium-release-status`, operator-confirmed 2026-10-03) |
| DEV / MAIN / PROD | all at `b97984fd2fce3aa2d13f0026fedbf4b4f79e903f` |
| Base for this round | `08c51c8` (8 commits to the release) |
| Workflow branch | `workflow/step9-cleanup`, published |
| Review branches | `review/step9-cleanup-r1` used for `a4f92df5`, deleted after release |

**Board:** every `step9-cleanup` card is `done`. Archived during the round:
`t_b25531ff` (round 1 sentinel), then `t_76dc826f` (round 1 review gate),
before round 2 started. The DEV acceptance gate `t_3a2a27e2` was to be
archived after release; it no longer appears in the board listing.

**Not confirmed this session:**
- Whether the previous round's sentinel `t_6bb061cb` (child of kickoff
  `t_eb3e0c2d`) is closed. Check it before the next kickoff: the guard
  auto-links the review gate only when exactly one sentinel is open.
- Whether the round 2 kickoff `t_9fe8caad` hit the missing-terminal block
  that round 1 did (§3.1).

**No `AGENTS.md` change was needed.** The new test file uses port 0.

## 2. What shipped

Eight commits on top of `08c51c8`. Six from the implementation (`37b809c`,
`ea3df78`, `3056553`, `e8297bb`, `9198ee3`, `a4f92df`) and two from revision
round 2 (`5e25f03`, `b97984f`). No user-visible change.

| # | Change | Files |
|---|---|---|
| 1 | `host.close()` terminates every socket in `wss.clients`, so pre-hello sockets are closed too | `world-host.js` |
| 2 | Both `onPreHelloClosed` callbacks guard with `if (hosts.get(worldId) !== host) return` | `world-registry.js` |
| 3 | Test 4 rewritten: two raw `node:net` refusal sockets that never answer the close frame, plus a pre-hello client on a real host; all must be closed by `registry.close()` | `world-visibility.test.js` |
| 4 | `try/finally` cleanup in the three tests that create their own servers (3e no-root, 4, 3b pending-teardown) | `world-visibility.test.js` |
| 5 | `AtriumClient` `onClose` handles both call shapes: `ws` passes `(code, Buffer)`, a browser passes a `CloseEvent`. `disconnected.code` is a number in both; `closeReason` is a string or undefined | `AtriumClient.js`, new `close-code.test.js` |
| 6 | `closeServer()` calls `server.close()`, which clears the keepalive interval. `client.test.js` now exits on its own | `packages/client/tests/client.test.js` |

**Item 2 in detail.** The previous passdown suggested `if (!h) return`. The
identity check is stricter: `commons.js` replaces hosts under the same key,
and `!h` would let a closed host's callback act on its replacement. Old and
new guards behave the same from outside, so there is no test for this item.
Items 1 and 2 belong together: once `close()` terminates pre-hello sockets,
their close events fire after the host is removed, and the guard makes that
a no-op.

**Item 5 in detail.** `close-code.test.js` runs against a real
`WebSocketServer` on port 0: two tests with the `ws` package, two with
Node's built-in `WebSocket` (the browser shape, no `.on`), and one with an
`EventTarget` fake. The two built-in tests skip only when
`globalThis.WebSocket` is undefined. Nothing in `apps/client` reads
`disconnected.code` yet.

**Tests at release** (each server file run on its own, no force-exit):

| Suite | Result |
|---|---|
| Server, 17 files | all pass and exit on their own |
| `world-visibility.test.js` | 24 tests, about 61 s |
| `packages/client` | 140 pass, 0 skipped, about 48 s, exits on its own (was: passes then hangs) |
| `apps/client` | 191 pass |
| `@atrium/protocol` | 60 pass |

The agent containers reported Node 22.23.2. The sandbox ran 22.22.2.

## 3. How the run went

| Stage | Outcome |
|---|---|
| Prototype (Claude, sandbox) | All six items built and tested before the kickoff was written (§5.1) |
| Kickoff `t_cffdda05` | Run 607 blocked itself in 18 s; run 608 completed after the operator supplied the base SHA (§3.1) |
| GLM brief `t_7fe766e9` | Six corrections from outside review (§3.2) |
| Brief gate `t_6c26f413` | Created correctly, wired to DeepSeek's card; completed by the operator after a card comment |
| Implementation `t_4f564d36` | `a4f92df5`, six commits |
| GLM review `t_8b5ad9a1` | CHANGES_REQUIRED, three findings |
| Review gate `t_76dc826f` | Blocked for the operator, as designed |
| Outside review of `a4f92df5` | Via `review/step9-cleanup-r1`. Source correct; five test findings (§3.4) |
| Round 2: kickoff `t_9fe8caad`, DeepSeek `t_26552458`, GLM rereview `t_34d3776e`, gate `t_fd8198d1`, sentinel `t_833bd1c8` | APPROVE on `b97984fd`. Claude did not see the rereview handoff |
| Publish `t_9b221031`, DEV `t_0ff587fd`, finalizer `t_d3d77375` | Done |
| Outside review of `b97984fd` | Approved, one small gap (§6.1) |
| DEV acceptance | Passed (§3.6) |
| MAIN, PROD (`t_4e47e5c6`, `t_91f1eb3a`) | Released with the Step 8 §8.1 and §8.2 recipes |

### 3.1 The kickoff blocked for a missing terminal

Run 607 posted three placeholder comments, then blocked with
`kind=capability`: "this run has no terminal/read tool access — only
kanban_* tools are exposed". It wanted `git fetch origin main` to record
`base_main_sha`.

- **This is not normal.** No earlier passdown records it. All Atrium
  profiles are on the Docker backend with `/workspace/wt` mounted, and the
  orchestrator's `SOUL.md` requires it to snapshot `origin/main` at kickoff.
- **The cause is unknown.** Kanban events do not record tool calls, so it
  is not known whether the worker tried a terminal call or misjudged its
  tools. No orchestrator container existed afterwards (normal after a clean
  exit) and the profile repo was clean.
- **The fix used:** the operator fetched on the host, confirmed
  `08c51c8b…`, posted it as a card comment telling the worker to ignore the
  placeholder comments, and unblocked from the CLI. The front door offered
  to do this itself; that was declined (Step 6 §3.2).
- **The fetch is not needed to build the graph.** The kickoff card leaves
  the fetch and worktree to the implementer.

### 3.2 Brief corrections (posted as a comment on DeepSeek's card)

1. **Proof (b) used the wrong mutation:** the 5 s timeout in `sendRefusal`
   instead of the terminate loop in `registry.close()`. Run in the sandbox,
   the brief's version left test 4 passing.
2. **Item 4 would have closed the shared database.** The 3e no-root test
   owns only `norootHttp` and borrows `putDb`.
3. **The worktree command named a branch that did not exist yet** (§7.1).
4. **Item 2 had lost its "do not write a test" sentence** (§3.3).
5. **Item 3:** open all three sockets before the single `registry.close()`;
   no cookie needed for a public world; send no frames on the raw sockets;
   `getWorldHost()` returns null after close, so count pre-hello sockets
   only before it.
6. **Item 5:** the fake must extend `EventTarget` with no `.on`. The
   synthetic sockets in `AtriumClient.test.js` define `.on` and take the
   Node path. The built-in `WebSocket` tests may skip only when the global
   is undefined.

### 3.3 The front door edited the kickoff

- The kickoff card dropped "Do not write a test for this item" from item 2.
- Its chat summary listed proofs for "items 1, 3, 5, 6 plus the refusal
  terminate loop", omitting proof (d). The card itself had all five.
- It added its own operating notes, including a 10-minute runtime cap that
  conflicts with the guard's 30.

Always read the card with `show`; the chat summary is not the card.

### 3.4 Outside review of `a4f92df5` (round 1)

Source changes matched the prototype. All findings were in tests:

1. **Two tests never ran.** `skip` was given a function, which `node:test`
   treats as truthy. `packages/client` reported 138 pass, 2 skipped. (GLM
   found this.)
2. **`close-code.test.js` hung when a test failed.** Each test created its
   own server and closed it on its last line. (GLM missed this.)
3. **Test 4 hung under proof (a).** The pre-hello client was not in the
   `finally` cleanup. (GLM missed this.)
4. **Test 4 lacked the "still open after 300 ms" assertion** and polled
   socket flags instead of listening for `close`. (GLM found both.)
5. **Test 5 set three private client fields it did not need.**

GLM also asked for `getWorldHost(id) === null` after close. That was never
in the spec; it read a correction note as a requirement. It is true and
harmless, and was added.

### 3.5 Proofs of failure, run independently by Claude on `b97984fd`

| Behaviour broken | Result |
|---|---|
| (a) `world-host.js` restored to `origin/main` | test 4 fails; file exits in 1 s |
| (b) terminate loop and `refusalWss.close()` removed from `registry.close()` | test 4 fails; file exits in 1 s |
| (c) `AtriumClient.js` restored to `origin/main` | all 5 close-code tests fail; file exits in 1 s |
| (d) `performTeardown` returns immediately | 3b, 5a and 5b fail; file exits in 61 s, no timeout |
| (e) `client.test.js` | exits on its own |

### 3.6 DEV acceptance

| Check | Result |
|---|---|
| `atrium-release-status`: DEV at `b97984fd`, healthy after the deploy restart | Passed |
| `Tearing down world` appears in the DEV log about 3 s after leaving | Passed |

## 4. Corrections to earlier passdowns

- **Test 4 ("registry close terminates refusal sockets") had been vacuous
  since Step 9.** It passed with the terminate loop and `refusalWss.close()`
  removed, because a `ws` client answers the close frame at once and was
  already closed. Only a peer that never answers can show the difference.
- **The `packages/client` test hang had a simple cause:** `closeServer()`
  never called `server.close()`, so the keepalive interval kept the process
  alive. It was carried as an open item for several rounds.
- **The follow-up passdown's §6.1 fix for the dead guard (`if (!h) return`)
  was weaker than needed.** See §2, item 2.
- **The close-code tests in `AtriumClient.test.js` use a shape no real
  socket produces:** a fake with `.on` that passes a string reason. They
  still pass and were left in place; `close-code.test.js` is the real test.
- **`AGENTS.md`'s port list is incomplete.** For example,
  `teleporter.test.js` uses 3060 and 3061, which are not listed. Only the
  operator can edit that file.

## 5. Process notes

### 5.1 What worked
- **Prototyping the whole round before the kickoff.** It turned four vague
  follow-ups into six exact items with proofs, found the vacuous test 4 and
  the `client.test.js` fix, and gave a reference to check the brief and
  both SHAs against. The prototype patch stayed in chat; it was not given
  to the agents.
- **Re-running each proof and timing the exit.** Two of the round 1
  findings were "fails correctly, then hangs", which a pass/fail check does
  not show.
- **The review gate blocked on CHANGES_REQUIRED** and waited for the
  operator, so GLM's findings and the outside review went into one
  revision round.
- **Step 9 §7.3 (`review/<slug>-r<N>` branch)** for reviewing an
  unpublished SHA.
- **Archiving the old sentinel, then the old gate, before round 2.** Round
  2's sentinel linked and completed.

### 5.2 Lessons
- **A `skip` option must be a value, not a function.** Ask for the skipped
  count in every handoff and expect 0.
- **A test that closes its server on its last line hangs when it fails.**
  Use `before`/`after` or `try/finally`, and track every client socket.
- **When a brief restates a proof, run the brief's version.** A proof that
  cannot fail looks the same on paper.
- **Supply a base SHA from the host, never from an agent's fetch** (F-2).
- **Tell a fresh worker to ignore junk comments left by a failed run.**
  They are in its startup context.
- **A round with a revision took about as long as two rounds.** The
  revision here was test-only.

## 6. Follow-ups

### 6.1 New this session

- **Why did the orchestrator have no terminal on run 607?** Unexplained
  (§3.1). If it recurs, look at the orchestrator profile's toolset config
  and container, and consider a gateway restart.
- **Test 4 has no explicit "still open after 300 ms" assertion.** The
  `close` listeners cover it in practice: a socket already closed would
  time out and fail.
- **Test 4's 500 ms close timers start before the pre-hello client
  connects.** A very slow machine could see a false failure. It passed
  every run in the sandbox.
- **The deploy does not run `packages/client` tests.** The package now
  exits on its own, so it could be added to the deploy's test step.
- **`close-code.test.js` checks `.on` on the constructor,** not on
  `WebSocket.prototype`. It gives the right answer by accident.
- **Nothing uses `disconnected.code` yet.** The app could now tell a 1008
  eviction from a network drop.

### 6.2 Closed this round

The dead guard, pre-hello sockets surviving `host.close()`, test 3b's
missing cleanup, the `AtriumClient` close code, and the `packages/client`
test hang.

### 6.3 Carried over, all still open

- A pre-hello socket that stays open holds its host loaded. There is no
  hello timeout.
- Client aborts during host creation: one timing tried, not tested further.
- The failed-toggle path in `app.js` (restores the switch, shows an error)
  has been read but never run. To check on DEV: set DevTools to Offline and
  toggle a row.
- F-10: no browser smoke stage.
- Strict destination resolution and connect-before-leave (Step 7 §6.4).
- Home auto-connect reports no failures.
- The hard-reload 404, the GitHub PAT expiry date, DEV cleanup, and F-11
  to F-14.

### 6.4 Next

**Step 10 is not defined anywhere** in `devtasks/` or `docs/`. The Phase 2
addendum's sequence ends at Step 7; Steps 8 and 9 and both follow-up rounds
were additions. It needs scoping with the operator before a kickoff.

## 7. Recipes

`$SC` = `/root/.hermes/sandboxes/docker/default/workspace/atrium`

### 7.1 Worktree for a new workflow branch
```
git -C /workspace/atrium fetch origin main
git -C /workspace/atrium worktree prune
git -C /workspace/atrium worktree add -b workflow/<slug> /workspace/wt/<slug> origin/main
git -C /workspace/wt/<slug> rev-parse HEAD    # must equal base_main_sha
```
Without `-b` and `origin/main` the command fails, because the branch does
not exist yet.

### 7.2 Kickoff blocked for a base SHA
```
git -C $SC fetch origin main && git -C $SC rev-parse origin/main
hermes kanban --board atrium comment <kickoff t_id> "OPERATOR: base_main_sha=<40-char sha>, from a host fetch of origin/main at $(date -u +%Y-%m-%dT%H:%MZ). Ignore earlier placeholder comments. Use this SHA as the base and build the pipeline as the card describes."
hermes kanban --board atrium unblock <kickoff t_id> --reason "operator supplied base_main_sha from host fetch"
```

### 7.3 Find this round's cards
```
hermes kanban --board atrium list | grep -i -E "<slug>|<sha8>"
```
The chain is kickoff → brief → gate → implementation → review → review
gate, so the kickoff's `children` line does not list them all.

### 7.4 Before a revision round
```
hermes kanban --board atrium show <review gate t_id> | head -12   # only child should be the sentinel
hermes kanban --board atrium archive <sentinel t_id>
hermes kanban --board atrium archive <review gate t_id>
```
Then send the Step 8 §8.5 message. State the full base SHA and the existing
worktree, and say which files must not change.

### 7.5 Additions to the kickoff's test rules
```
cd packages/client && timeout 180 node --test tests/*.test.js
```
Report `node --version` and the skipped count. Every proof of failure must
say whether the file exited on its own.
