# Atrium Passdown — 2026-10-01 — Step 9: world visibility + failure reasons

**Predecessor:** `devtasks/Atrium-Passdown-2026-10-01-step8-ui-polish.md`
(Step 8). Its §8 still holds the MAIN, PROD, kickoff and revision-round
recipes; §7 below adds three more. The Step 6 passdown
(`…-2026-09-28-cross-server-connect-shipped.md`) still holds the F-list and
the kanban CLI recipes.

**First instruction for the next session's Claude: clone the repo and read
`devtasks/` before advising.**
- The chat sandbox can run `git clone https://github.com/joshmaurice/atrium.git`,
  `pnpm install` and every test suite.
- Read the passdowns, the pre-briefs and `ADDENDUM-*`, not just the latest
  passdown.
- **Check claims in passdowns against the code.** The Step 8 passdown said
  this task needed a DB migration. It didn't: Step 4 had already shipped
  the migration, the API and the admission rules (§2).

## 1. Status at handoff

| Stage | State |
|---|---|
| Release state | **COMPLETE** |
| DEV / MAIN / PROD | all at `69850ec16096390876c3648d7aa696fe1588fdd8` |
| Base for this step | `5ff51a103faaccdabe02fb8f8c23769ba0e3f47e` (17 commits to the release) |
| Review branches | `review/world-visibility-r1` and `-r2` deleted |

**Still to do** (the operator may already have done some of these):
- **Archive the stale DEV acceptance gate `t_98de5947`.** It was created for
  `e82cd64a` and superseded by round 3.
- **Add the new test file's ports to `AGENTS.md`** under `## Test Ports
  Used`. Agents can't edit that file, so GLM's round-2 finding was carried
  over to the operator:
  `- 3050–3052, 3055, 3056: world-visibility.test.js (refusal server,
  PUT/eviction server, no-root server, close-terminates test, teardown test)`
- **Optionally, replace the pre-brief.** `devtasks/PREBRIEF-world-visibility.md`
  on `main` is the DRAFT; the FINAL differs only in its status lines.
- **Kick off the follow-up task** (§6.1).

## 2. What shipped

Pre-brief: `devtasks/PREBRIEF-world-visibility.md`, decisions V1–V9. All
were confirmed by the operator; V1 restates what Step 4 already shipped.

- **A public/private switch in My Worlds**, on every world including home.
  - The commons row is locked public, with a tooltip.
  - `GET /api/worlds` now returns `isCommons`, so the client never needs
    the commons slug or id.
  - New worlds are still private by default.
- **Server-sent failure reasons:**
  - **Every admission refusal is identical.** That covers unknown users and
    slugs, unresolvable paths, private worlds seen by non-owners,
    home-path mismatches, and `/ws/<id>` with no host or not the owner.
    Each one completes the WebSocket upgrade on a separate refusal server,
    sends `error` `WORLD_UNAVAILABLE` "World not available", and closes
    with 1008 and an empty reason.
  - **Private and missing worlds can't be told apart.** That's deliberate
    (V2).
  - **Server-side failures keep their HTTP status:** a host that fails to
    load, and the degraded-mode 503 (V4).
- **Switching a world to private disconnects non-owners immediately.** That
  includes connections that haven't sent `hello` yet. They receive
  `WORLD_NOW_PRIVATE`, then a 1008 close. The owner's own sessions stay,
  but a cross-origin owner is anonymous there, so they're disconnected too.
  The operator confirmed this on DEV.
- **Client wording.** `codeToReason`, `evictionMessage` and a code-aware
  `teleportFailureMessage` live in `src/teleport-failure.js`. Teleport, Go
  back, Load and manual Connect all show "That world doesn't exist, or it
  isn't public." when the server sends a reason. Without one (an older
  server, an unreachable host, a timeout) they keep the old text. A
  visitor who is disconnected because the world went private sees the
  failure panel, with Dismiss only.
- **Protocol:** the `error.json` code enum gains `WORLD_UNAVAILABLE` and
  `WORLD_NOW_PRIVATE`, plus `SESSION_CONFLICT`, which the server already
  sent but the schema never listed.
- **Security fix (pre-existing, found in review):** no server WebSocket had
  an `error` listener. One malformed frame from any anonymous visitor (an
  unmasked client frame, say) threw an uncaught `RangeError` and killed the
  Node process. That was true on PROD from Phase 1 until this release.
  - **The fix:** both the session handler and the refusal sockets now log
    and swallow these errors.
  - **The tests are proven:** they fail when the listeners are removed.
- **`attachSessionHandlers` now returns `{ closeKeepalive, evictNonOwners }`**
  instead of a single function. All callers were updated.
- **A new guard test,** `apps/client/tests/import-guard.test.js`, checks that
  every name `app.js` uses from a local module is actually imported. It
  fails on `e82cd64a`'s `app.js`.

**Tests at release** (each server file run on its own, as the deploy does;
all pass and exit on their own):

| Suite | Tests |
|---|---|
| auth | 17 |
| autosave | 10 |
| avatar | 7 |
| commons | 19 |
| db | 11 |
| home-world | 15 |
| http-integration | 51 |
| multi-world-mutation | 9 |
| origin | 17 |
| presence | 6 |
| rate-limit | 5 |
| reconnect-session | 5 |
| session | 19 |
| teleporter | 16 |
| world-crud | 72 |
| **world-visibility (new, about 40 s)** | **20** |
| world | 9 |
| `apps/client` | 191 |
| protocol | 60 |

## 3. How the run went

**Pipeline:** kickoff `t_adbcd51a`; GLM brief `t_30506027`; human brief gate
`t_f962caf7`; DeepSeek implementation `t_433bdfa7` (tip `0d890842`); four
revision rounds.

| Round | Tip | Review | Outcome |
|---|---|---|---|
| Implementation | `0d890842` | GLM `t_05ea04ba` | Stuck in a loop; stopped by the operator |
| 1 | `046d4149` | GLM `t_771fa91a` | CHANGES_REQUIRED |
| 2 | `e82cd64a` | GLM `t_b1b29b3b` | CHANGES_REQUIRED, minor (the `AGENTS.md` ports); accepted by the operator |
| 3 | `ae778e03` | GLM `t_42774b59` | CHANGES_REQUIRED (guard test checked nothing) |
| 4 | `69850ec1` | GLM | APPROVE; released |

- **The brief-review gate held.** Using the text in §7.1, the orchestrator
  built it correctly the first time, with "OPERATOR BLOCK" in the title and
  DeepSeek's card behind it. The operator didn't check the graph before GLM
  finished; it was right anyway. Four corrections went to DeepSeek as a
  card comment:
  - all decisions were final, even though the uploaded pre-brief was the
    DRAFT;
  - GLM's line numbers were unreliable;
  - the close reason must be empty on every refusal;
  - `isCommons` needed a guard for when `getRootWorldId` isn't provided.
- **The implementation:**
  - **The design was right.** Eviction worked when smoke-tested.
  - **It broke `teleporter.test.js`,** which hung because one caller of
    `attachSessionHandlers` still expected a function.
  - **It added no new server tests,** only converted the existing 404
    assertions.
- **GLM's first review looped** for 40 minutes, then crashed, and its retry
  looked "corrupted": the same container symptoms as run 508 in Step 7.
  The operator stopped it with the §7.2 recipe. Claude reviewed instead,
  using a pushed review branch (§7.3), and found the WebSocket crash bug
  along the way.
- **Rounds 1 and 2** fixed the test file and added the adversarial tests. A
  handle leak (exit 124) and the missing crash tests needed a second
  round.
- **Claude's outside review of `e82cd64a`** found three tests that are
  weaker than they look (§6.1). It recommended shipping anyway, because
  PROD was exposed to the crash.
- **DEV acceptance then caught a real bug.** Manual Connect to a missing
  PROD world hung on "Connecting to world…". `app.js` called
  `codeToReason` and `formatDestination` but never imported them, so every
  Load or Connect failure threw inside its error handler. This had been
  there since `0d890842`. **Both GLM and Claude missed it:** Claude read the
  diff but didn't check the import line, and no test touches `app.js`
  (F-10).
  - **Round 3** fixed the import. It also added a guard test that searched
    for `'./wsUrl'` instead of `'./wsUrl.js'`, so it never found the import
    line and checked nothing. GLM caught that by running it against the
    old buggy file.
  - **Round 4** fixed the guard. Claude confirmed it fails on the buggy
    file and passes on the fixed one.

## 4. Process notes

### 4.1 What worked

- **Explicit gate text:** "OPERATOR BLOCK" in the brief-review gate's title
  and body (§7.1).
- **Human-directed rounds block on any CHANGES_REQUIRED.** The orchestrator
  doesn't start a revision on its own, so the operator can decide whether a
  minor finding (like the protected `AGENTS.md` edit) is worth a round.
- **Proving tests catch the bug.** "Show that this test fails when the bug
  is put back" caught a test that checked nothing, in round 3. Ask for
  that proof on every guard or regression test.
- **Outside review of an unpublished SHA through a `review/` branch**
  (§7.3). It's separate from `workflow/*`, so publish and the guard aren't
  affected.

### 4.2 Lessons

- **Review `app.js` imports explicitly.** The client app has no DOM test
  harness, so a missing import only shows up at runtime. The guard test now
  covers names from local modules. It doesn't cover npm packages or
  modules `app.js` never imports.
- **GLM sometimes reports only top-level test counts** (auth 4, db 2,
  world-crud 38). The full counts are 17, 11 and 72. Don't read a lower
  number as lost tests without checking `# tests`.
- **Upload the FINAL pre-brief, not the DRAFT.** If the DRAFT gets uploaded,
  correct it with a card comment rather than a mid-release docs push to
  `main` (Step 8 §6.1).
- **Reconsider "accepted" UX trade-offs in use.** Q-updated-at (the list
  reorders after a toggle) looked harmless on paper. On DEV, the row moves
  under the cursor (§6.1).
- **A one-line fix still costs a full round:** one DeepSeek revision, one
  GLM rereview, publish and DEV, about an hour. Round 3 spent most of that
  on the guard test, not the fix.

## 5. Security note

The WebSocket crash (§2) was exploitable with a single packet by anyone who
could reach the server, on any path (the commons is public). It's fixed as
of `69850ec1`. Two loose ends:
- **Error logging has no rate limit.** Each malformed frame logs one line,
  so a flood would mean log volume, not a crash.
- **Check whether the systemd units restart Atrium on a crash**
  (`Restart=`). If they don't, any future uncaught exception means a
  manual restart.

## 6. Follow-ups

### 6.1 Next task: Step 9 follow-up (test fixes + switch reordering)

Ready to send as a kickoff (single GLM review per round; Nemotron stays
benched):
```
Step 9 follow-up (test fixes plus one small client fix). Slug: world-visibility-followup. Branch from a freshly fetched origin/main.
1. Replace "3d" in packages/server/test/world-visibility.test.js (currently a plain HTTP GET that never reaches the upgrade path) with a real V4 test: insert a world row whose stored document is invalid so host creation fails, attempt a WebSocket upgrade to it, and assert an HTTP status via 'unexpected-response', with no open event and no error message.
2. The pending-teardown test must refuse the same world that is pending teardown. Make td-world private, let the owner disconnect, then attempt anonymous and non-owner connections via /worlds/TdOwner/td-world and /ws/<tdWorldId>. Assert both are refused and the host is still torn down.
3. The commons-to-private 403 test must hold its non-owner session in the commons itself (/worlds/PutOwner/commons), not in vis-test-world.
4. Client (apps/client/src/app.js, renderWorldList): after a successful visibility PUT, update that row in place (the switch's checked state and its "Public"/"Private" text) instead of calling refreshWorldList(), so the list doesn't reorder under the cursor. Keep the existing failure and 401 handling. Manual check: in a list of 3+ worlds, toggling any row leaves every row where it was.
Also assert that exactly one row has isCommons true in the 3e test. Nemotron stays benched: a single GLM review per round, no Review B; block for me if a verdict is missing. Test rules: each server file individually under timeout 180, no force-exit; cd apps/client && node --test tests/*.test.js; pnpm --filter @atrium/protocol test. Every file must pass and exit on its own.
```
The switch glitch the operator saw on DEV: toggling a row below the top one
moves it to the top, because every `PUT` bumps `updated_at` and the list is
sorted newest first.

### 6.2 Other follow-ups

- **`AtriumClient` loses close codes in browsers.** `onClose` is attached
  with `addEventListener`, so it receives a `CloseEvent`, and the
  `typeof code === 'number'` check drops it. `disconnected.code` and
  `closeReason` are always undefined in browsers. Nothing depends on them
  yet; fix before anything does.
- **F-10:** no browser smoke stage. This task's missing-import bug is the
  second time DOM-only code shipped broken past both reviews (Step 7's
  "DeepSeek skipped `app.js`" was the first).
- **Strict destination resolution** (Step 7 §6.4): still open. Typo pads now
  at least say "doesn't exist, or it isn't public".
- **Connect-before-leave** (Step 7 §6.4): still open.
- **Home auto-connect reports no failures.** That's fine for owners, who
  are always admitted, but noted.
- **Still open from earlier steps:** the hard-reload 404 (Step 7 §6.5), the
  `packages/client` test hang, the GitHub PAT expiry date, DEV cleanup
  (test accounts and the `tp-test-a` world), and F-11 to F-14.

## 7. Recipes

Step 8 §8 (MAIN, PROD, the human-directed revision round) is unchanged.
These are new or updated.

### 7.1 Kickoff with a human brief-review gate (worked first time)
Add to the kickoff text, after the task description:
```
Nemotron is benched for this run (F-8). Replace the Nemotron brief-critique stage with a gate card created with --initial-status blocked, assigned to atrium-orchestrator, titled "OPERATOR BLOCK: awaiting human brief review — <slug>", with the body "OPERATOR BLOCK: human brief-review gate. Only the operator completes this; agents must not unblock, complete or recreate it." Its parent is the GLM brief. DeepSeek's implementation card must have this gate as a parent, so it cannot start until I complete the gate. Do not create the implementation card without that parent link. No agent may unblock, complete or recreate the gate, including after the brief finishes. Each review round, including re-reviews, is a single GLM review with no Review B. Gates expect only the GLM verdict, and block for me if it's missing.
```
Check the graph right after kickoff:
```
hermes kanban --board atrium show <gate t_id> | head -15     # children should list DeepSeek's card
hermes kanban --board atrium show <deepseek t_id> | head -12 # parents should include the gate
```

### 7.2 Stopping a looping review worker
```
T=<review t_id>
hermes kanban --board atrium block $T --kind needs_input "OPERATOR BLOCK: review paused; outside review in progress"
for p in $(grep -l "HERMES_KANBAN_TASK=$T" /proc/[0-9]*/environ 2>/dev/null | cut -d/ -f3); do kill $p; done
docker ps -aq --filter label=hermes-profile=atrium-glm | xargs -r docker rm -f   # only if no other GLM task is running
```
If the review is replaced by a revision round, archive its gate **before**
the review itself, so the gate doesn't fire on a missing verdict.

### 7.3 Outside review of an unpublished SHA
```
SC=/root/.hermes/sandboxes/docker/default/workspace/atrium
git -C $SC push origin <40-char sha>:refs/heads/review/<slug>-r<N>
```
After release:
```
git -C $SC push origin --delete review/<slug>-r<N>
```
