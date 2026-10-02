# Atrium Passdown — 2026-10-02 — Step 9 follow-up: test fixes, switch reordering, stranded hosts

**Predecessor:** `devtasks/Atrium-Passdown-2026-10-01-step9-world-visibility.md`
(Step 9). Its §7 and Step 8's §8 still hold the kickoff, MAIN, PROD and
revision-round recipes. The Step 6 passdown
(`…-2026-09-28-cross-server-connect-shipped.md`) still holds the F-list and
the kanban CLI recipes.

**First instruction for the next session's Claude: clone the repo and read
`devtasks/` before advising.**
- The chat sandbox can run `git clone https://github.com/joshmaurice/atrium.git`,
  `pnpm install` and every test suite.
- **Check claims in passdowns against the code, and prototype before
  approving a brief.** This round, applying the brief's fix in the sandbox
  showed that two of its tests would have passed against a broken fix (§3).

## 1. Status at handoff

| Stage | State |
|---|---|
| Release state | **COMPLETE** (`atrium-release-status`, 2026-10-02) |
| DEV / MAIN / PROD | all at `4d5c298a43846ed52428f7433225f986299ac0ad`, DEV and PROD healthy |
| Base for this round | `6a3d419` (3 commits to the release) |
| Workflow branch | `workflow/world-visibility-followup`, published |
| Review branches | none used this round (§5.1) |

**Still to do:**
- **Archive the DEV acceptance gate `t_153127f9`** if not already done.
  Check the card's page for children first; the CLI `show` listed a parent
  (`t_404b98bb`) and no children.
- **No `AGENTS.md` change is needed.** The new tests reuse ports 3050, 3051
  and 3056.

**Board cleanup done this session:** `t_98de5947` (Step 9 stale acceptance
gate), `t_01baef34` (round 3 sentinel) and `t_dd501946` (round 3 review
gate) are archived.

## 2. What shipped

Three commits on top of `6a3d419`: `abd04b5` (item 5), `f7857f0` (item 4),
`4d5c298` (items 1 to 3 and the item 5 tests).

| # | Change | Files |
|---|---|---|
| 1 | Test 3d now tests the real creation-failure path: a public world whose stored document is `'{}'`, upgraded via `/worlds/<owner>/<slug>`, returns HTTP 404 with no open event | `world-visibility.test.js` |
| 2 | Test 3b now refuses the same private world that is pending teardown, once anonymously via `/worlds/` and once as a non-owner via `/ws/<id>`, and checks the host is still torn down | `world-visibility.test.js` |
| 3 | Test 3c holds its session in the commons itself; test 3e asserts exactly one `isCommons` row | `world-visibility.test.js` |
| 4 | The visibility switch updates its row in place (switch, Public/Private text, timestamp, clears `#wb-error`) instead of re-fetching the list | `apps/client/src/app.js` |
| 5 | A connection that closes before hello no longer strands its host | `session.js`, `world-host.js`, `world-registry.js` |

**Item 5 in detail.** Teardown was scheduled only when the last *session*
left. A socket that never sent hello was never a session, so two cases left
a host loaded forever with 0 sessions:
- a socket lazily created the host, then closed without hello;
- a socket cancelled a pending teardown, then closed without hello.

The fix adds an `onPreHelloClosed` callback and a `getPreHelloSocketCount()`
from `session.js` through `world-host.js` to the registry. When a pre-hello
socket closes and the host has no sessions and no other pre-hello sockets,
the normal teardown is scheduled. `performTeardown` now also skips while any
pre-hello socket is open. The root world stays exempt.

This bug was found by the outside review at the start of this session, not
by the pipeline. The code involved predates Step 9. Impact was memory only:
one stranded host per reachable world, cleared by a restart.

**Tests at release** (each server file run on its own, no force-exit):

| Suite | Result |
|---|---|
| Server, 17 files | all pass and exit on their own |
| `world-visibility.test.js` | 24 tests, about 61 s (was 20 tests, about 40 s) |
| `apps/client` | 191 pass |
| `@atrium/protocol` | 60 pass |

## 3. How the run went

| Stage | Outcome |
|---|---|
| Kickoff `t_eb3e0c2d` | §6.1 text from the Step 9 passdown, plus outside-review notes, item 5, a proof-of-failure requirement and the §7.1 brief-gate wording |
| GLM brief `t_37194f5d` | Accurate on the code; three corrections from outside review |
| Brief gate `t_fbd2b149` | Created correctly by the orchestrator; completed by the operator after a card comment |
| Implementation and GLM review | The acceptance gate records GLM APPROVE on `4d5c298a`. Claude did not see the review handoff |
| Outside review of `4d5c298a` | Approved for DEV acceptance, one non-blocking slip (§6.1) |
| DEV acceptance | Passed (§3.3) |
| MAIN, PROD | Released with the Step 8 §8.1 and §8.2 recipes |

### 3.1 Brief corrections (posted as a comment on DeepSeek's card)

1. **Item 1 path:** the brief offered `/ws/<id>` as an option. That path
   never creates a host; it refuses with `WORLD_UNAVAILABLE`, so the 404
   would never be reached.
2. **Item 5 tests (c) and (d) asserted too early.** They checked "host still
   up" right after the pre-hello close, but a wrongly scheduled teardown
   fires 3 s later. Against a careless fix (schedule on every pre-hello
   close, no `performTeardown` guard), the host was up immediately, gone
   after the delay, and the second socket's hello *still succeeded* on the
   dead host. The tests now wait past the delay and check the host before
   and after the hello.
3. **Item 5 tests used `vis-test-world`,** whose visibility other tests
   flip. Each test now has its own world row.
4. **Close every socket.** Closing a host does not terminate pre-hello
   sockets (§6.1), so one left open hangs the file.

### 3.2 Proofs of failure, run independently by Claude on `4d5c298a`

| Behaviour broken | Result |
|---|---|
| Item 1: creation failure changed to a refusal | 3d fails |
| Item 2: `cancelTeardown` moved above admission (both branches, and each alone) | 3b fails all three ways |
| Item 3: commons 403 guard removed | 3c fails |
| Item 5: fix reverted to `6a3d419` | 5a and 5b fail |
| Item 5: careless fix (no pre-hello count checks) | 5d fails |

### 3.3 DEV acceptance

| Check | Result |
|---|---|
| Toggle a non-top row among 3+ worlds: no reordering, row updates in place | Passed |
| Switching a public world to private still evicts a visitor | Passed |
| `Tearing down world` appears in the DEV log about 3 s after leaving | Passed |
| A failed toggle restores the switch and shows an error | **Not checked.** Claude read this path but could not run it |

## 4. Corrections to earlier passdowns

- **The round 3 `CHANGES_REQUIRED` was not skipped.** Gate `t_dd501946` sat
  blocked on GLM's finding that the import-guard test checked nothing. Round
  4 (`69850ec`) fixed it before the Step 9 release. Checked this session:
  the guard on `main` fails 2 of 26 against the old buggy `app.js` and
  passes 26 of 26 against the fixed one. The gate was simply never cleaned
  up.
- **Step 9 §6.1 item 2 was incomplete.** The teardown test connected its
  "owner" with no cookie, so making the world private also needed an auth
  session for that owner.
- **Step 9 §6.1 did not say what replaces Nemotron's brief-critique stage.**
  Use the §7.1 gate wording in every kickoff while Nemotron is benched.

## 5. Process notes

### 5.1 What worked
- **Prototyping the brief before approving it.** Applying the brief's fix in
  the sandbox took minutes and found the vacuous tests in §3.1.
- **Asking for proof of failure in the kickoff, then re-running it.** Every
  mutation in §3.2 was reproduced outside the pipeline.
- **The §7.1 brief gate worked first time again.**
- **Reviewing the published SHA.** GLM approved before the outside review,
  so the SHA was already on `workflow/world-visibility-followup` and could
  be fetched directly. No `review/` branch was needed.
- **Combining a small server fix with a test round.** One round, no
  revisions seen.

### 5.2 Lessons
- **A "still up" assertion must wait past the teardown delay.** Checked
  immediately, it passes against any bug that fires on a timer.
- **A successful hello does not prove the host is alive.** A socket on a
  torn-down host can still complete hello.
- **Run mutation tests with a short timeout.** Several tests close their
  server only on success, so a failing run hangs until the timeout.
- **Archive a superseded gate when the next round starts,** child before
  parent. Two stale gates and a sentinel had built up.
- **To watch DEV:**
  `journalctl -u atrium-dev.service -f | grep --line-buffered -E "World loaded|Tearing down"`

## 6. Follow-ups

### 6.1 New this session

- **Dead guard in `registerWorldFromDocument`.** The new callback reads the
  host into `h`, then tests `host`, which is always set there:
  ```js
  const h = hosts.get(worldId)
  if (!host) return
  ```
  Behaviour is correct today: the cases where it matters end in a teardown
  timer that finds no host. Fix: `if (!h) return`, and use `h` below.
- **Closing a host does not terminate its pre-hello sockets.**
  `host.close()` terminates sessions only. It matters at shutdown, since
  teardown now waits for pre-hello sockets to leave.
- **A pre-hello socket that stays open holds its host loaded.** There is no
  hello timeout. Not a regression: before this round such a socket also
  cancelled teardown.
- **Test 3b does not clean up on failure.** It closes its server only at the
  end, so a failing run hangs until the timeout instead of exiting. Other
  tests in the file share the pattern.
- **Client aborts during host creation:** the brief listed this as a known
  edge, out of scope. One timing tried in the sandbox tore down correctly.
  Not tested further.

### 6.2 Carried over from Step 9 §6.2, all still open

- `AtriumClient` close code: `onClose` receives a `CloseEvent`, so
  `disconnected.code` and `closeReason` are always undefined in browsers.
- F-10: no browser smoke stage. Item 4 again had no automated test.
- Strict destination resolution and connect-before-leave (Step 7 §6.4).
- Home auto-connect reports no failures.
- The hard-reload 404, the `packages/client` test hang, the GitHub PAT
  expiry date, DEV cleanup, and F-11 to F-14.

### 6.3 Suggested next round

A small server-and-client cleanup, one round: the `h`/`host` guard,
terminating pre-hello sockets in `host.close()`, `try/finally` cleanup in
the `world-visibility` tests, and the `AtriumClient` close-code fix. All are
small, and the first three touch files this round already changed. This is
a suggestion; the operator decides whether Step 10 comes first.
