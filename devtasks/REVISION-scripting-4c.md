# Revision — scripting-4c round 2 (the outside review of round 1's tip)

**Status:** approved by the operator (2026-10-30 09:25 PT), **Rev 0** as
drafted, with **W-L1 as recommended** (1–64 characters of `[A-Za-z0-9_-]`).
§1.3 filled in after the approval (the regression run finished; no contract
change). Seven items: W1–W7.
- **Base:** round 1's published tip `6378b49b6b6fd39309701c31b5d4bb503ba435d1`
  on `workflow/scripting-4c`:
  - implementation `t_040b0b47`; GLM APPROVE on `t_6b0b990a` (0 findings);
    review gate `t_be15bfc1`;
  - published by `t_411af56e`;
  - on DEV by `t_12a7dc13` as release
    `a02c2429ea0c7db23c5554abdfd92ef9b444ce04` (the release merge of `main`
    `bf206e5f` into the tip; the delta is `devtasks/` only).

  Round 2 commits on top of `6378b49b`, on the same branch, in the existing
  worktree `/workspace/wt/scripting-4c`. There is no merge step.
- **Round 1 is not accepted.**
  - Its DEV finalizer `t_906cd735` and acceptance gate `t_57ec50fa` stay
    blocked as they are, superseded by round 2's chain. **No one completes
    `t_906cd735` or `t_57ec50fa`.**
  - Round 1's chain cards (`t_411af56e`, `t_12a7dc13`, `t_906cd735`,
    `t_57ec50fa`) and its sentinel `t_5fc688b3` are not reused.
  - Round 2's DEV deploy replaces round 1's release on DEV. The host allows
    `set-dev` from `WAITING_FOR_HUMAN_DEV_ACCEPTANCE`. Nothing reaches MAIN
    or PROD.
- **The contract still governs:**
  - `devtasks/PREBRIEF-scripting-4c.md`, FINAL Rev 1.3, at
    `53f68ba99b28a3d8805986f132b9726db313fb9c` (sha256
    `07e3ecb7e34f4ccef2d30945c9061f6bc67b55a12be9bf66addbf52feb6d6cd4`);
  - `devtasks/KICKOFF-scripting-4c.md` at
    `bf206e5f532eb1b93488bb20a633c8e87e7d34f0` (sha256
    `d1ac80fc7a29faf2bd781389f4eddb85a9432c1c980457460ca87986f4766fb1`),
    its Settlement included;
  - the GLM brief `t_57733b6c`;
  - the operator's three pins on the brief-review gate `t_4c2519ef`
    (`from` is for the log line only; the 10 m boundary may disagree;
    the FINAL spec is authoritative over a truncated read-back);
  - round 1's five declared deviations (the vector generator, the extra
    `activate-click.js` exports, the held-load test's place, the exported
    bucket helper and limits, `selectTargetFor` stopping at an enabled,
    non-running behaviour), as GLM and the outside review accepted them.

  This file adds W1–W7 and changes nothing else.

## 1. What was found

Two independent passes over round 1, after it was published and deployed:
- **The operator's outside code review** of the whole round (`53f68ba9` to
  `6378b49b`): **NO-GO**, one must-fix (M1) and three should-fix (S1–S3). It
  was a source review: the reviewer's environment could not clone. Claude
  checked every finding against the code at `6378b49b`; §1.1 says how.
- **Claude's §6.1 browser checks** on the DEV SHA `a02c2429`, in the harness
  with the real server and real sign-in (`devtasks/harness/checks/scripting-4c/`).
  All thirteen checks are in §1.2.

### 1.1 The outside review, checked against the code

| Finding | Holds? | What Claude found |
|---|---|---|
| **M1** — a visitor's session id is amplified into every forwarded `activate` | **Yes, reproduced** | `hello.client.json` L9: `id` is `{ "type": "string", "minLength": 1 }`, no maximum. `session.js` L717 adopts it (`msg.id ?? randomUUID()`), and the forward (L1039–1046) copies it whole into `from`, whose schema (`activate.server.json` L13) has no maximum either. **A probe on a real port-0 server** (round 1's own `activate.test.js` helpers, not committed): an anonymous `hello` whose id is 250,000 characters followed by a newline and an ANSI escape is **accepted**, and each of the visitor's 60-byte `activate`s reaches the owner as a **250,108-byte** frame (5 of 5). The buckets limit counts, not bytes; the 1 MiB `maxPayload` limits only one message |
| **S1** — control characters in log lines | **Yes** | The same probe's id (a `\n` and `\u001b[31m`) was admitted. Its first 8 characters go into `[session] hello` (L838), `[activate] rate limited` (L977) and the owner's runner log (`runner.js` L559); the depth guard (L686) logs the **whole** id, so today a 250,000-character id makes each refused deep message a 250,000-character log line. **And more than logs:** `session.js` L498 names the session's avatar node `avatar-<first 8 characters>`, a node every client receives |
| **S2** — AC6's harness passes local translations where production passes world positions | **Yes** | `apps/client/tests/activate-click.test.js` L231 and L275–276, `packages/behaviors/tests/runner-activate.test.js` L44: `node.translation`. Production passes `worldPosition` (`app.js` L2153–2154, L3203). Equal for root-level nodes only |
| **S3** — the `NaN` and `Infinity` vectors are `null` | **Yes** | `gen-vectors.mjs` L448 and L452 build them; L499 writes `JSON.stringify(fixture)`, which turns both into `null`. Both copies of `withinActivateDistance` (`behavior-spec.js` L320, `send-policy.js` L931) use `Number.isFinite`, so this is a proof gap, not a runtime defect |
| **(g2) half 2** (already known) | — | The reviewer agrees it's coverage only, and suggests adding the legacy-owner-first test in this round rather than 4d. **Taken: W6** |

**What the released client sends:** `AtriumClient.connect()` at PROD's
`ab02239b` sends `crypto.randomUUID()` (36 characters, `[0-9a-f-]`), and so
does 4c's. Every literal id in the repository's tests matches
`[A-Za-z0-9_-]{1,64}`. No other sender of `hello` exists in the repository.

### 1.2 The browser checks (pre-brief §6.1), on `a02c2429`

All thirteen pass. Real server, its DB, real sign-in; the owner's tabs share
one browser context; the visitor is a context with no cookie; a fresh public
world per run; real mouse clicks on the canvas.
1. **Visitor click:** within 10 m, the second cube hides in both tabs, and the
   host's log shows `select from <visitor's 8>`; at 12 m, "Move closer to use
   this." and nothing sent; after walking to 8.2 m (`W` held), the click works.
2. **A Fox's inner mesh:** the visitor's click is sent for `Fox` and plays
   `Run` in every tab.
3. **A second owner tab:** not the host; its Behaviour status reads
   "Behaviours run in another tab; clicks here are sent to it"; its click is an
   `activate` and runs in the host's tab, whose runner is the only enabled one.
4. **Owner away:** with every owner tab closed, `NO_SCRIPT_HOST` and "Nothing
   happens: this world's owner isn't here right now."; a new owner tab
   (`hostGen` 2) sends `script-ready`, and the next click works.
5. **Handover:** closing the host tab hands the role to the other owner tab
   (`hostGen` 3), and the visitor's next click runs there.
6. **Limits:** 10 `activate`s in one task: 5 forwarded, 5 `RATE_LIMITED`; a far
   object: `PERMISSION_DENIED`; a `view` next to it, then `activate`: forwarded
   (P8, expected); a cube with no behaviour: `INVALID_FIELD`, console only.
7. **The host's own click:** at 15 m, "Move closer to use this.", the runner
   returns `too-far`, nothing sent; at 5 m it runs.
8. **Edit mode on in the host:** the visitor's click still runs; the host's
   click selects the cube.
9. **Regression:** signin-sync's `c.py` (all 21) and `c4b.py` pass at 4c. The
   28-script set plus 4b-2's `r7.py` and `f3.py`, base `71b6e40b` against 4c:
   no regression (§1.3).
10. **A stale owner tab:** a page from the base commit, served on the same
    origin, signs in and connects with `scriptRunner: 1`; it is not elected;
    the visitor gets "isn't here right now"; a 4c owner tab opens, becomes the
    host, and the next click works.
11. **Pointer lock:** in the visitor's tab and in the host's, `M` and a click
    take the lock; a locked click with the cursor over empty sky and the
    crosshair on the cube runs (the visitor's is sent as an `activate` for that
    cube; the host's runs locally); aimed at the sky, a click does nothing.
12. **The host's load:** with the new owner tab's world held at its
    `som-dump`, four clicks during the load each get "isn't here right now",
    never silence; after the load, `script-ready` (`hostGen` 4) and the click
    works.
13. **An older server, cross-origin:** a real server built from the base on
    another origin; from a 4c page, through the address bar: connected, a
    `hello` with no `scriptRunner` key, logged there as
    `hello <id> as anonymous`, `canEdit` false; back on the 4c origin its
    `hello` carries `scriptRunner: 2`, and the owner's tab is still the host.

### 1.3 The regression set (§6.1 check 9)
signin-sync's 28-script set (`reg_run.sh`) plus 4b-2's `r7.py` and `f3.py`
(`checks/scripting-4c/reg4c.sh`), on the base `71b6e40b` and on `a02c2429`,
diffed with `regdiff.py`:
- **all 31 exit 0 on both; 28 outputs are the same.**
- **Two differences are noise:** library-sky `c1` (a WebGL driver id in a
  warning) and scripting-4a `c1` (one more clock-sync sample).
- **One is expected:** 4b-2's `c4_4b1_newtext` check 5. Its stand-in for a
  teleport calls `atriumClient.connect()` directly, which at 4c sends no
  `scriptRunner`, so the tab is never elected in the new world. That is AC6:
  `connectNow` is the only place `scriptRunner` is set, and every connect in
  the app goes through it (`trackConnect` → `connectNow`: `app.js` L384, L540
  (the teleporter), L557, L718, L1094, L1383). **With the stand-in passing
  `scriptRunner: true`**, as `connectNow` does on a same-origin connection,
  check 5 matches the base (B elected, `hostGen` 1). The script now does that,
  with a comment.

## 2. The contract (round 2)

### W-L1. The session-id bound (operator decision: as recommended)
**A `hello` id is 1–64 characters of `[A-Za-z0-9_-]`.** Every client in the
repository and at PROD sends a 36-character UUID, so nothing real is refused.
64 leaves room for a non-UUID id; the character set excludes every control
character, space, quote and escape. *(Alternatives: exactly a UUID, which
would refuse the tests' `owner-1`-style ids and need them all rewritten; or a
length bound only, which leaves S1 to W3 alone.)*

### W1. `hello` refuses an id outside the bound (M1, S1)
- `hello.client.json`: `id` gets `"maxLength": 64` and
  `"pattern": "^[A-Za-z0-9_-]+$"` (keeping `"minLength": 1`).
- **No server code changes for it.** A `hello` that fails the schema already
  gets `UNKNOWN_MESSAGE` with the validator's message, creates no session and
  leaves the socket open (`session.js` L695–699). That is the refusal.
- The server's own fallback id (`randomUUID()`) is within the bound.
- **What it bounds:** every `session.id`, and so `from`, the three log lines,
  and the avatar node's name (`avatar-<8>`).

### W2. A forwarded `activate`'s `from` is bounded where it is built (M1)
- `activate.server.json`: `from` gets the same `maxLength` and `pattern`.
- **The forward checks before it sends:** if `session.id` does not match the
  bound (unreachable after W1), the server does not forward, answers the sender
  with `INVALID_FIELD`, and logs nothing about the id. A defence in depth, not
  a path: W1 is what keeps it unreachable.
- `from` is still for the log line only (pin 1).

### W3. One way to put a session id into a log line (S1)
- **A helper, `logId(id)`**: the first 8 characters of `id` after dropping
  every character outside `[A-Za-z0-9_-]`; `'-'` when nothing is left or `id`
  is not a string. One copy in the server (`session.js` or a module beside
  it) and one in `@atrium/behaviors`.
- **Its users:** `[session] hello` (L838), `[activate] rate limited` (L977),
  the depth guard's `session=` (L686, which today logs the **whole** id), and
  the runner's `select from` line (`runner.js` L559). No other change to those
  lines' wording.
- The avatar name (L498) is not a log line and is not changed: W1 bounds it.

### W4. AC6's tests use the production positions (S2)
- **`apps/client/tests/activate-click.test.js`:** the runner's `position` and
  `performActivateClick`'s `avatarPosition`/`targetPosition` are the real
  `worldPosition` (the one `app.js` imports), not `node.translation`.
- **A nested target:** the switch is the child of a group translated by
  `[0, 0, -20]`; its own translation is `[0, 0, 2]`. Local translation says
  2 m, world position says 18 m: the visitor's click shows "Move closer to use
  this." and sends nothing, and the host's own click returns `too-far`. And a
  pair the other way (a far local translation, a near world position) is
  allowed.
- **`packages/behaviors/tests/runner-activate.test.js`** (`@atrium/behaviors`
  does not depend on `@atrium/som`): the `position` callback returns a value
  that **differs** from `node.translation` (a fixture map of world positions),
  and the local-selection decision follows the callback, both ways. Nothing in
  the runner reads `translation` itself.

### W5. Non-finite numbers are tested as numbers (S3)
- **Direct tests in both packages:** `withinActivateDistance` with `NaN`,
  `Infinity` and `-Infinity` in either point is `false`, for
  `behavior-spec.js`'s copy and `send-policy.js`'s.
- **The generator refuses a vector that doesn't survive JSON:** before
  writing, `gen-vectors.mjs` checks that every distance vector's points deep-equal
  their `JSON.parse(JSON.stringify(...))`, and exits 1 naming the vector
  otherwise. The `NaN` and `Infinity` vectors leave the fixture (the direct
  tests cover them); the fixture is regenerated, and its other vectors are
  unchanged.

### W6. The handover skips an earlier `scriptRunner: 1` owner, tested (g2 half 2)
- In `packages/server/test/activate.test.js`, a real port-0 test: owner A
  (`scriptRunner: 2`, the host), **then** a `scriptRunner: 1` owner, **then**
  owner B (`scriptRunner: 2`). A closes: B is granted the role, and the legacy
  owner receives no `script-host`.
- **Proof (g2) half 2** is rerun with it: `canRunBehaviors` broken alone to
  accept 1 fails this test.

### W7. What doesn't change
- AC1–AC7's behaviour, the ten checks' order, both buckets, readiness,
  eligibility, the notices and their texts, and the client's three states.
- No UI change; no new message; no change to `hello`'s other fields.
- The 1 MiB `maxPayload`.

## 3. Tests and proofs (round 2)

| Item | New tests |
|---|---|
| W1 | **Protocol:** `hello` with a 64-character id validates; 65 is refused; ids with `\n`, `\u001b`, a space, `"` and `/` are refused; the empty id is still refused. **Server, port 0, a real WebSocket:** an anonymous `hello` with a 250,000-character id gets `UNKNOWN_MESSAGE` and no session (`sessions.size` unchanged, no `join` to others); the same with `"x\n\u001b[31m"`; **the same socket** then sends a valid `hello` and is admitted |
| W2 | **Protocol:** a server `activate` whose `from` is 65 characters, or carries `\n`, is refused. **Server:** with a 64-character id, a forwarded `activate` frame is under 400 bytes, and it validates against `activate.server.json` (round 1's AC3 test, now meaningful). **The guard:** a session whose `id` is set past the bound directly in the session map (a test-only setup, as round 1's tests set state) is not forwarded, and the sender gets `INVALID_FIELD` |
| W3 | `logId`: a UUID gives its first 8; the depth guard's line for a deep message from a session prints `logId`'s 8, not the id; `"\n\u001b[2Jabc"` gives `2Jabc`; `"\u0000"` and `42` give `'-'`. **The runner:** a forwarded `activate` whose `from` is `"\u001b[31mFAKE"` logs `select from 31mFAKE`, with no control character |
| W4 | As W4: the nested-target pair in `apps/client` with the real `worldPosition`, both directions, visitor and host; in `packages/behaviors`, the callback-differs pair, both directions |
| W5 | As W5; and the generator run on a fixture with a `NaN` vector added exits 1 |
| W6 | As W6 |

**Proofs** ("not reproducible" is not an acceptable result):
- **(w1)** `maxLength` removed from `hello.client.json`: the 250,000-character
  server test fails; **(w1b)** `pattern` removed: the control-character tests fail;
- **(w2)** `maxLength` removed from `activate.server.json`: the 65-character
  `from` schema test fails; **(w2b)** the forward's check removed: the guard
  test fails;
- **(w3)** the runner's line back to `String(from ?? '').slice(0, 8)`: the
  runner's log test fails;
- **(w4)** `worldPosition` replaced by `node.translation` in the app test's
  wiring: the nested-target tests fail (which shows the test tells them apart);
  **(w4b)** the same in the behaviors test's callback;
- **(w5)** `Number.isFinite` replaced by `typeof … === 'number'` in either
  copy: that copy's non-finite test fails; **(w5b)** the generator's round-trip
  check removed: the `NaN`-vector run writes a fixture;
- **(w6)** `canRunBehaviors` alone accepting 1 (`session.js` L543): W6's test
  fails; **(g2)** both halves, as round 1 ran them, with W6's test in place.

**And the whole round still passes:**
- full suites, with round 1's rules (server files one at a time under
  `timeout 180`, every package on its own directory, the guards green, the one
  named conformance skip and no other);
- round 1's proofs (a)–(j) still hold: rerun (c), (e) and (g) after W1–W3.

**Steps, one commit each, every commit runnable:**
1. W1 and W2's schemas, with the protocol tests;
2. W1's and W2's server tests and W2's guard; W3 (both copies of `logId` and
   their four users);
3. W4 and W5: the tests and the generator, the fixture regenerated;
4. W6;
5. suites, proofs and the handoff.

**Before DEV acceptance**, after round 2's release chain publishes and
deploys:
- **Claude's §6.1 browser checks again**, all thirteen, on the round-2 DEV
  SHA (the scripts are committed), and the M1 reproduction against the
  round-2 server: the 250,000-character `hello` refused;
- **the operator's outside re-review** of round 2 (`6378b49b` to the round-2
  tip);
- **after the DEV deploy,** `atrium-release-status`: DEV actual = recorded =
  `RELEASE_SHA`, healthy.

The operator then runs the pre-brief's §7 DEV acceptance.

## 4. Kickoff body for round 2 (post it verbatim as the revision kickoff card's text)

---

### KICKOFF — scripting-4c revision round 2. Slug: `scripting-4c`

You are the kickoff orchestrator for round 2 of `scripting-4c`. Build the
graph below, read it back, report, and stop. Do not implement, review or
deploy anything yourself.
- **Your tools:** only `kanban_*`.
- **Blocking:** never call `kanban_block` without an explicit `task_id`, and
  never block this card.
- **Titles:** use them exactly as written. Don't add words to them.
- **Card bodies:** write each card's body from the bullets under its title
  below. Don't copy this kickoff's own instructions to you into any card.

**The contract is in git; you don't read it.** It is
`devtasks/REVISION-scripting-4c.md` on `main`, together with
`devtasks/PREBRIEF-scripting-4c.md` at `53f68ba99b28a3d8805986f132b9726db313fb9c`
(sha256 `07e3ecb7e34f4ccef2d30945c9061f6bc67b55a12be9bf66addbf52feb6d6cd4`),
`devtasks/KICKOFF-scripting-4c.md` at `bf206e5f532eb1b93488bb20a633c8e87e7d34f0`
(sha256 `d1ac80fc7a29faf2bd781389f4eddb85a9432c1c980457460ca87986f4766fb1`),
the GLM brief `t_57733b6c`, and the operator's three pins on `t_4c2519ef`.
- **The front door has already checked the round-2 revision** and posted
  its commit and sha256 on this card. **You have only `kanban_*` tools: do
  not try to fetch or hash anything, and do not block for lack of a shell.**
- Copy that commit and sha256 into cards 1 and 2. **They** have terminal,
  file and git tools. Each reads the revision with
  `git -C /workspace/atrium fetch origin main && git -C /workspace/atrium show <commit>:devtasks/REVISION-scripting-4c.md > /tmp/revision-4c-r2.md && sha256sum /tmp/revision-4c-r2.md`,
  and blocks with `kind="capability"` on a mismatch.

#### Graph
1. **`Implement r2 — scripting-4c`.** Assignee `atrium-deepseek`, parent:
   this kickoff, `--max-runtime 3h` (10800 s).
   - **Body:**
     - the revision reference and hash check;
     - continue `workflow/scripting-4c` from
       `6378b49b6b6fd39309701c31b5d4bb503ba435d1` in the existing worktree
       `/workspace/wt/scripting-4c` (`git -C /workspace/wt/scripting-4c
       status` must be clean at that SHA, or block `needs_input`);
     - the revision's §2 contract (W-L1 as the operator decided it, posted on
       this card) and §3 steps, tests and proofs;
     - the pre-brief, the kickoff's Settlement, the GLM brief and the three
       pins, still binding;
     - the `WORKER-CARD REQUIREMENTS (canonical)` comment on `t_2d41531f`;
     - **a progress comment on its own card after each step's commit**, so a
       run that stops on its iteration budget resumes from its last comment.
   - **The handoff** carries proofs (w1)–(w6) with their (b) variants and
     (g2) both halves, each with the command and both runs quoted; round 1's
     (c), (e) and (g) rerun; and per-file counts with exit codes and the one
     named skip.
2. **`GLM review r2 — scripting-4c`.** Assignee `atrium-glm`, parent:
   card 1.
   - Its body opens with
     `THIS RUN HAS TERMINAL, FILE AND GIT TOOLS. Use them for every step below.`
   - **The review covers round 2's change** (`6378b49b` to the round-2 tip)
     against this revision. It reproduces **every proof** itself, (b)
     variants included.
   - **It reproduces the outside review's M1 against the round-2 server:** on
     a real port-0 server, an anonymous `hello` with a 250,000-character id is
     refused with `UNKNOWN_MESSAGE` and creates no session; with a 64-character
     id, a forwarded `activate` is under 400 bytes.
   - **It lists every place a session id reaches a log line or a node name**
     in `packages/server/src` and `packages/behaviors/src`, and confirms each
     goes through `logId` or is bounded by W1.
   - **It confirms the only behaviour changes are W1–W3's,** and that the ten
     checks' order and both buckets are unchanged.
   - **Progress comments on its own card** after each stage, so a run that
     stops on its iteration budget resumes from its last comment.
3. **`Review gate r2 — scripting-4c`.** Assignee `atrium-orchestrator`,
   parent: card 2. It creates nothing.
   - **On a valid APPROVE of the exact 40-character SHA,** it blocks with
     `APPROVE <SHA40>: front door, build the release chain`.
   - **Otherwise,** it blocks for the operator with the verdict quoted.
4. **Before you complete,** link card 3 to **round 2's sentinel** as a
   parent. The front door creates it and posts its id on this card. Round 1's
   sentinel `t_5fc688b3` must not be used. Do not create a sentinel yourself.
5. **The release chain** is the front door's: the same four cards as round
   1's (Publish, DEV deploy, DEV finalizer, acceptance gate), with the new
   SHA, built whole at card 3's APPROVE.
   - **Round 1's chain cards (`t_411af56e`, `t_12a7dc13`, `t_906cd735`,
     `t_57ec50fa`) are not reused,** and no one completes the two of them
     that are still blocked.
   - The DEV deploy replaces round 1's release on DEV. Nothing reaches MAIN
     or PROD.

#### Report back
- the three ids;
- the implementation's parent and its 10800 s cap;
- the hash line copied into cards 1 and 2;
- the review's opening line;
- the gate linked to round 2's sentinel.

Then complete this card.

---
