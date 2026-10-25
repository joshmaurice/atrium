# Pre-brief: a depth bound on every WebSocket message, and a fail-closed handler (security)

Status: **DRAFT, Revision 0 (2026-10-25), for the operator's approval.** Nothing
here is in force until the operator confirms decisions G1–G5 (§3).
**Priority: before 4b-2 continues.** This affects PROD today.

**Inputs:**
- the second outside review of scripting-4b-2 (2026-10-25), finding **N3**:
  "an owner `add` with deep plain node extras kills the server after the node
  is in the world", reproduced on `c042ef5a`, `957140bd` and `main`;
- `devtasks/REVISION-scripting-4b-2-r5.md` V9 (4b-2's fix for the same class
  of crash in the behaviour check), and its §1.3 M2 row;
- `devtasks/host-drafts/atrium-release-merge` (why 4b-2 must merge this, §3 G4).

This is input for the brief-writing step. It is not the brief itself.

**Code facts:**
- **Verified at:** `main` `216683a1`. Its runtime code is identical to the
  release on PROD, `8358b043` (`git diff --stat 8358b043 216683a1 --
  packages apps tools` is empty).
- **Line numbers:** `packages/server/src/session.js` at that commit,
  approximate.
- **Implementation base:** a freshly fetched `origin/main` at kickoff, never a
  SHA quoted here.

## 1. The problem

**One message takes the whole server process down,** and every world on it
drops:
- `ws.on('message', async (raw) => …)` (L515) parses with `JSON.parse` (L518,
  which handles deep input), validates the schema (L524), and dispatches.
  Nothing bounds a message's nesting depth.
- Nothing catches an exception thrown later in the handler. It's an `async`
  listener, so a throw becomes an unhandled rejection, and Node 22 exits on
  that. No `process.on('unhandledRejection' | 'uncaughtException')` handler
  exists in `packages/server/src`.
- **`JSON.stringify` of a value nested a few thousand deep throws
  `RangeError: Maximum call stack size exceeded`.** The server stringifies
  every message it sends (`broadcast` L349, `broadcastExcept` L358).

**Two reproductions, by Claude on PROD's tree** (`8358b043`, a spare harness
server, Chromium, 2026-10-25):
1. **An owner's `add`** of a node whose `extras.foo` is an array nested 6,500
   deep. `checkAtriumExtras` only looks under `extras.atrium`, so
   `world.addNode` succeeds (L966). The `add` broadcast's `JSON.stringify`
   throws (`broadcast` ← L987), and the process exits. The world was changed
   before the throw.
2. **A visitor's own avatar `add`,** from a tab with no edit rights, carrying
   the same `extras.foo`. Avatar adds skip the owner gate by design, and
   `addCarriesAtriumExtras` only refuses `extras.atrium`. `broadcastExcept`
   (← L978) throws and the process exits. **So anyone who can join a world can
   crash the server**: on PROD, every signed-in user and, for a public world,
   whoever the visibility rules admit.

The outside reviewer reproduced (1) at 6,500 and 100,000 deep on `c042ef5a`,
`957140bd` and `main` (child exit 7).

**What isn't affected:**
- **Document `extras` sends** serialize inside a `try` first and are refused
  ("document extras are not serializable"); Claude checked PROD's tree at
  6,500 and 30,000 deep.
- **Stored worlds** can't carry such a value in by another door: `PUT
  /api/worlds/…` always serializes the live world on the server and accepts no
  uploaded document, and the crash happens before any autosave.
- **PROD's journal** (late September to now) shows no such crash.

## 2. Verified facts
- Every client message goes through the one handler at L515: `hello` before a
  session exists, `send`, `add`, `remove`, `view` and the rest.
- The schema check (L524) runs Ajv. Node descriptors' `extras` are open
  objects, so the schema doesn't bound depth either.
- The deepest **legitimate** client message is far shallower than a
  stringify-breaking depth. A behaviour leaf, for example, is at most depth 8
  inside `msg.node.extras.atrium.behavior`, about 13 overall; a node
  descriptor's `children` add two levels per generation. **The implementer
  measures it** (§6.2).
- 4b-2 (unreleased) already has an iterative bounded walk (`walkGuards`,
  round 5's V9) and fail-closed boundaries around its own checks. They're on
  `workflow/scripting-4b-2`, not on `main`, so this round doesn't use them.

## 3. Decisions (for the operator)

**G1. One depth bound on every inbound message, before anything else reads
it.**
- Right after `JSON.parse` and **before** the schema check, an **iterative**
  walk (an explicit stack, no recursion) measures the parsed message's nesting
  depth. It stops as soon as it passes the limit.
- **The limit is `MAX_MESSAGE_DEPTH = 64`,** counting the top-level object as
  depth 1, with objects and arrays alike.
- A deeper message is refused with `UNKNOWN_MESSAGE` and "message nested too
  deeply", echoing the message's `seq` if its top-level `seq` is a number.
  Nothing else happens, and the socket stays open.
- **Why here:** one gate for every message type and every field, including
  avatar adds and messages sent before `hello`, rather than a check per
  handler that the next feature could miss.
- **Why 64:** a wide margin over legitimate traffic (§6.2 must measure it at
  32 or less), and far below where `JSON.stringify` or a recursive walk
  breaks.

**G2. The handler fails closed.**
- The whole body of the `message` listener goes inside one `try/catch`. An
  exception is logged as one line (`[session] message handler error: <type>
  <message>`) and answered with `UNKNOWN_MESSAGE` "the message could not be
  processed", with its `seq`. The session, the world and the process carry
  on.
- **No process-level `unhandledRejection` or `uncaughtException` handler:**
  outside the message handler, an unknown failure still exits and systemd's
  restart policy applies (G5).
- **The `catch` doesn't roll back a partly applied change:** if a throw comes
  after a world change, the world and the clients disagree until they reload.
  G1 removes the known case; G2 is the last line, not a substitute.

**G3. Its own round, to PROD first.**
- A small server round off a freshly fetched `main`, through the normal
  pipeline (brief, review, DEV, acceptance, MAIN, PROD), **before 4b-2's round
  6**.
- **Files:** `packages/server/src/session.js`, plus one small helper module
  for the walk (say `packages/server/src/message-depth.js`), and the tests.
- **No protocol schema change:** a refusal with an existing code doesn't
  change any message's structure (`AGENTS.md` rule 1). No client change.
- Its DEV deploy replaces 4b-2's round 5 release on DEV (round 5 isn't
  accepted, and the host allows `set-dev` from
  `WAITING_FOR_HUMAN_DEV_ACCEPTANCE`).

**G4. 4b-2 takes it in by merging `main`.**
- The host's release merge refuses any `main` change outside `devtasks/`
  (`atrium-release-merge` `ALLOWED_RE='^devtasks/'`). So once this round is on
  `main`, **4b-2's round 6 begins by merging `origin/main` into
  `workflow/scripting-4b-2`**, as worldload-address-sync's "Integrate
  origin/main" step did.
- The conflicts will be in `session.js`, where round 5's V9 added its own
  `try` around `authorizeSend` and the `add` checks. They're resolved so that
  both rules hold, and 4b-2's tests and this round's pass on the merge.
- Round 6's revision gets that step as a Rev 0.1 (W0) before the front door
  sees it.

**G5. Operator checks, outside the pipeline.**
- **Before the release:**
  - `systemctl show atrium -p Restart -p RestartSec` (and the same for
    `atrium-dev`), to know whether a crash recovers on its own today;
  - whether a PROD public world admits signed-out visitors, which sets how
    wide the exposure is.
- **At DEV acceptance:** Claude repeats both reproductions (§1) against the
  published SHA in the harness: refused, and the server keeps serving. Then
  the operator's usual smoke check on DEV.

## 4. Out of scope
- Bounding breadth or total size beyond what exists (the WebSocket payload
  cap and the per-field checks). Wide-and-shallow input doesn't break
  `JSON.stringify`.
- Outbound messages (the server only sends what it accepted or built).
- Client-side hardening against a deep broadcast (once the server refuses
  deep input, no client receives one).
- 4b-2's own fixes (round 5's V9 stays as it is).

## 5. Open questions for the brief author / critic
- Is 64 right? The brief should cite §6.2's measurement.
- Should the depth guard also log, as a line per refusal, so the operator
  can see attempts in the journal? (Proposed: yes, one line with the session
  id and the message type, rate-limited by the existing per-session limits.)

## 6. Test expectations

### 6.1 New file `packages/server/test/message-depth.test.js` (port 0)
The server runs in a **child process**, so a crash shows as the child's exit
rather than killing the test runner (4b-2's `deep-server.mjs` pattern). Each
case checks that the child is still serving afterwards, with a valid message
answered on the same socket and on a second session.
- **(a)** an owner `add` with `extras.foo` nested 6,500 deep: refused
  `UNKNOWN_MESSAGE` "message nested too deeply"; no `add` broadcast; the
  world has no new node; the next valid `add` is accepted.
- **(b)** a visitor's avatar `add` with the same `extras`: refused, same
  checks, and that visitor's normal avatar `add` afterwards is accepted.
- **(c)** a deep message **before `hello`**: refused, and the socket can
  still say `hello`.
- **(d)** a `send` with a deep value (any field): refused by the guard.
- **(e)** depth 64 exactly passes the guard (then accepted or refused by the
  later rules, as today); depth 65 is refused.
- **(f)** an array nested 100,000 deep: refused with no `RangeError`
  anywhere.
- **(g)** the fail-closed boundary: with a handler path made to throw (for
  example `world.addNode` stubbed to throw in the child), the reply is
  "the message could not be processed", one log line, and the child keeps
  serving.
- **The walk itself**, without a server: depth counting exact for objects,
  arrays and mixed; stops at the limit (a 1,000,000-deep array is refused
  without walking it all); scalars and strings are not walked.

### 6.2 The deepest legitimate message
- A test that records the depth of every message the existing suites send to
  the server (a wrapper at the handler, in test mode only, or by running the
  client tests against a recording server), and asserts the maximum is **32
  or less**. The handoff reports the number and the message type that has it.
- If it's over 32, the worker blocks `needs_input` and doesn't raise the
  limit.

### 6.3 Existing suites
All green, with the usual rules: server files one at a time under `timeout
180`; `packages/client` without `--test-force-exit`; every other package on
its own directory.

### 6.4 Proofs of failure (run each; each must fail the named tests and exit on its own)
- **(p1)** the guard removed: (a) and (b) fail on the child's exit;
- **(p2)** the `try/catch` removed: (g) fails on the child's exit;
- **(p3)** the limit's comparison off by one: (e) fails;
- **(p4)** the walk made recursive: (f) fails.
