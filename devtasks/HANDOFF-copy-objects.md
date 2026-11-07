# Handoff: `copy-objects`, implemented on `claude/copy-objects`

**Contract:** `devtasks/PREBRIEF-copy-objects.md` FINAL Rev 2 (operator, 2026-11-06).
**Base:** `main` at `ace29de` (code identical to PROD `3fcc296c`; since `db9efc4`
only `devtasks/` moved). **Implemented by Claude in the fast lane** (CP-L8 (a)),
no OpenRouter. **Checked by a fresh Claude agent** (§7: no must-fix; its
should-fix and nits taken in commit 5). Not yet reviewed outside; not published
or deployed.

**The operator's two answers before DEV** (passdown §4), both in:
- **the DEV commons has an owner, `commonskeeper`, and so does PROD's.** So the
  DEV acceptance expects the pasted crate's credit to read "Made by
  commonskeeper, it says (dev.ewwb.dev, <the day>)";
- **Caddy caps no WebSocket frame.** `/etc/caddy/Caddyfile` has no
  `request_body` (only the `@websocket` matchers), and the probe
  (`devtasks/spike-copy-objects/caddy-frame-probe.mjs`, run on the host against
  `wss://dev.ewwb.dev/apps/client` at `9ff511f`): "big (1.20 MiB junk): the server
  answered; socket still open". So **PROD accepts any visitor's message up to
  `ws`'s 100 MiB until K0 ships.**

## 1. The five commits
| Commit | What (contract items) |
|---|---|
| 0 `34245eb` | K0: `maxPayload: MAX_PAYLOAD_BYTES` on `createWorldHost`'s server and the registry's refusal socket; `session.js` exports the constant |
| 1 `8a90c1b` | K2–K3: `creditProblem` in `send-policy.js` (server, through `checkAtriumExtras`) and `edit-duplicate.js` (client, through `atriumProblem`, `{ credit: false }` for Copy); `tests/fixtures/credit-vectors.json`; the server test file's K3 part |
| 2 `09ba2aa` | K1: `hello.world` (server, schema, protocol tests); `AtriumClient`'s `worldFromHello` and `client.world`, reset with `signedIn`; the server test file's K1 part |
| 3 `0aba28a` | K5–K8: `apps/client/src/copy-paste.js` and its 61 tests; `buildDescriptor` exported; `enablePromptText`'s K7 text |
| 4 `4a64969` | K4, K6, K9 glue (`edit-modes.js`, `app.js`, `index.html`, `behavior-form.js`); the end-to-end and wiring tests; `p6`'s counters; proofs; this file |
| `9ff511f` | the Caddy frame probe (`devtasks/` only) |
| 5 (see §7) | the fresh check's fixes: same-server K7 tests (unit and e2e), escaped display of a stored address and of dropped key names, bounded notes, per-entry chains, Copy's refusal texts, the Inspect outline, the Enable question's `inWorld` |

Code files touched are exactly §6's list. Three existing test files that pinned
old text changed with it (§4 below): `import-guard.test.js`,
`behavior-wiring.test.js`, `edit-modes.test.js` (all under `apps/client/tests/`,
which §6 allows). Outside §6's list: only `devtasks/` (this file, the probe, the
review prompt).

## 2. Tests
- **All suites, each server file alone under `timeout 180`:** 64 suites,
  **4,223 passing, 0 failing, 1 named skip** at commit 5 and after the review's N1 and N2 (4,204 at commit 4;
  richer-add's R7 skip, unchanged).
  Baseline at `ace29de`: 61 suites, 4,046 passing, the same skip.
  (`better-sqlite3` built in this session, so the database suites ran.)
- **New checks fail on today's code** (the code reverted, the tests kept):
  - K0 (`world-host-payload-cap.test.js`, with only the export added so the
    file loads): 2 of 4 fail, the 1009 test and the refusal-socket test;
  - K3: the 72 malformed credit vectors are **all accepted** by today's
    `checkAtriumExtras` and today's `duplicateRuleProblem`; in
    `copy-objects.test.js` the malformed-credit test fails (its two other K3
    tests describe today's behaviour: a credit already passes and `send`
    already can't write it);
  - K1: all 5 K1 server tests and 3 of the schema tests fail; the client's
    `copy-objects-hello.test.js` can't load (`worldFromHello` is new);
  - K5–K8: `copy-paste.js` is new; `enablePromptText`'s no-grants text fails.
- **New test files:**
  - `packages/server/test/world-host-payload-cap.test.js` (K0, port 0);
  - `packages/server/test/credit-check.test.js` (K3, the vectors);
  - `packages/server/test/copy-objects.test.js` (K3 and K1 through the real
    `attachSessionHandlers`, port 0; a real database for the owner's name);
  - `packages/protocol/test/copy-objects-schema.test.js` (K1's schema);
  - `packages/client/tests/copy-objects-hello.test.js` (K1, field by field, resets);
  - `packages/client/tests/copy-objects-e2e.test.js` (**two real servers, two
    origins, real AtriumClients, the real Undo engine and the real runner**:
    two worlds end to end; the hostile two-tab case; its Redo version);
  - `apps/client/tests/edit-duplicate-credit.test.js` (K3 client side);
  - `apps/client/tests/copy-paste.test.js` (K2, K5–K8, 61 tests);
  - `apps/client/tests/copy-objects-wiring.test.js` (K4, K6, K9 in `app.js`
    and `index.html`; the Inspect gate and the paste answer's text are lifted
    out of `app.js` and run).

### 2.1 The proofs (each break made, the named tests seen failing, the file restored from a saved copy)
| Proof | Break | Failed |
|---|---|---|
| (p0) | K0's option removed from `world-host.js` | K0's 1009 test |
| (p1) | K7 keeps every foreign id (Rev 1.2's rule, in the case it was meant for: nothing in the destination matches) | **the two hostile e2e tests** (the runner loads the pasted button against the restored door, `select` returns `ran`, and the server's door is hidden: checked with the engine assertion removed), the other two e2e tests, 13 of `copy-paste.test.js`'s another-world tests |
| (p1b) | K7's same-world case treated as another world | 11 same-world tests (the matrix and the credit) |
| (p2) | K8 resolves a model against the destination's base | 6 cross-origin tests (absolute, `http`, `no-base`, library across servers, the question) |
| (p2b) | K8 resolves a pad against the destination | the pad test; the e2e two-worlds test |
| (p3) | K3's check removed on the server | the handler's malformed-credit test; the vectors through `checkAtriumExtras` |
| (p4) | the snapshot's translation and extras are the live node's | the snapshot test |
| (p5) | Inspect picks with `includeHidden: true` | the Inspect click wiring test |
| (p6, commit 5) | "same world" ignores the world ids (any two worlds on one server) | 11 of `copy-paste.test.js` (the same-server matrix) and the one-server hostile e2e test; before commit 5 only an unrelated Library test failed (the fresh check's finding 1) |

The proofs are scripted (`/home/claude/scripts/proofs.sh`, not in the repo):
each saves the file, makes one replacement, runs the tests, restores.

## 3. What was built, where
- **K0** `world-host.js` L46, `world-registry.js` L67. The refusal test sends
  its oversized frame inside `'open'` itself: the refusal's close frame arrives
  with the upgrade response, so a send one tick later never goes.
- **K1** the owner's name is a second query, by `worldOwnerUserId`, at each
  hello, in its own `try`. `hello.world` is in every hello this server sends.
- **K2/K3** one rule in two copies, checked in a fixed field order so both name
  the same field; `creditProblem(atrium, { key })` checks one key (K2's fill).
- **K4** `edit-modes.js` gains `inspect` / `setInspect` (exclusive with Edit;
  triggers as outside Edit; pointer lock suspended; M ignored). `app.js`:
  `canInspectNow()` is `!canEditNow() && client.connected`, run from
  `updateEditControls()` and `endEditSession()`; an Inspect click picks with
  `includeHidden: false` and returns before the `activate` path; a cyan outline;
  the panel is written with `textContent` only.
- **K5/K6** `copyObject` / `preparePaste`; `app.js` Copy (Inspect and Edit),
  Paste (Edit only, beside Undo and Redo, so it needs no selection), and the
  paste's own answer branch (`request.paste`, before the forms' branches).
- **K7** `copiedFrom.refs`; the Behaviour form shows the record through
  `deps.recordLines`, and the Enable question names a grant not in the world
  through `deps.objectInWorld`.
- **K8** in `preparePaste`; the other-host question through the injected
  `confirm` (the page's `window.confirm`).
- **K9** in the Inspect panel, above the world browser's list, and as each
  non-commons Public/Private toggle's tooltip.

## 4. Choices the contract left open, and where the code differs from its words
1. **`copyObject` returns `{ ok: true, snapshot }`** (or Duplicate's refusal),
   not the bare snapshot, so a caller tests `ok` as for `prepareDuplicate`.
2. **`preparePaste` takes `isFree`** (and an optional `name`, the retry's) and
   picks the name itself (K6 step 1); also `newId` for tests. It returns
   `sameWorld` beside `{ ok, descriptor, bytes, notes }`.
3. **The single-tab Redo sequence can't happen.** §5's "the owner adds an
   object, presses Undo, pastes a behaviour aimed at its id, presses Redo":
   the paste is recorded and **clears Redo** (`pushEntry`). So the Redo hole is
   across tabs, and that's the test (tab 2 adds and undoes, tab 1 pastes, tab 2
   redoes); a fourth e2e test pins the single-tab fact.
4. **The e2e tests live in `packages/client/tests/`**, not the server test
   file: they need the real `AtriumClient`, as `richer-add-lifecycle.test.js`
   did. The server test file has K1 and K3 through the handler.
5. **The runner's click rule needs a local avatar** (AC-L3 (a)): the hostile
   tests give the host tab one at the origin. Without it every `select` stops
   at `no-avatar` and the door check proves nothing (found while proving (p1)).
6. **A ref's `name` not in K2's form is dropped** (an object name over 64
   characters, or with a control character), as K2 drops a bad K1 value.
7. **An extra note,** "Its behaviour arrives turned off", when an enabled
   behaviour is pasted into another world.
8. **The credit's wording** (`creditLines`): "Made by alice, it says
   (a.example, 2026-11-06)", "From the library, it says (…)", "First copied
   from a world on a.example, 2026-11-06, it says" (no name),
   "Copied from /worlds/alice/garden on a.example, 2026-11-06, it says".
9. **Inspect turns off at `world:loaded`, as Edit does** (`endEditSession`):
   after a teleport it is offered again but not on. The clipboard is kept.
10. **After the other-host question** (which pauses the page), Paste checks
    Edit mode and the block again before sending.
11. **`import-guard.test.js`** flagged `buildDescriptor` because `app.js` has it
    as an object key (`buildDescriptor: buildTeleporterDescriptor`) and in a
    comment; the guard now skips whole-line comments and object-literal keys.
    Its test count is unchanged and every other check still runs.
12. `behavior-wiring.test.js` and `edit-modes.test.js` pinned the old text
    (the notes call, the Enable call, the modes' keys) and follow the change.

## 5. Not done, or not checked
- **Not run in a browser.** `app.js` parses, every identifier the glue uses is
  declared, and the wiring tests read it; the panel's look, the outline and the
  clicks are for the DEV acceptance.
- Recorded in the pre-brief for later: rebinding a custom graph's references
  (`copiedFrom.refs` is its input); several objects at once; a clipboard that
  survives a reload; the client's missing animation check; healing a malformed
  saved credit at load; any future import stamps fresh ids (K10).

## 6. Release
A server, protocol and client round; no `package.json` or lockfile change. A
rollback stores nothing to undo (§6 of the pre-brief). Before the PROD deploy
the operator runs `p6` (its new counters: behaviours by kind, root-path model
URLs, path pad destinations, objects already credited, expected 0). Host
commands with the real SHA come with the round's release notes.

## 7. The fresh-agent check (of `ace29de..4a64969`)
No must-fix. It reproduced (p0) per socket and (p1) with the write, fuzzed both
credit checks with 200,000 random credits (0 differences), probed seven
same-world edge cases, and found every §4 departure sound. Claude reproduced
each finding below before taking it. All taken in commit 5:
1. **should-fix, reproduced:** no test covered a hostile world on the SAME
   server (one origin, two world ids), PROD's likely case: making "same world"
   ignore the ids failed only an unrelated test. Now a K7 matrix on one server
   (10 cases) and an e2e test with one real server routing two worlds by path;
   both fail under that break (proof p6 in §2.1).
2. **should-fix, reproduced (a gap in K2, not the code):** K2's `address` form
   allows text-direction characters, and the Inspect panel printed a stored one
   raw in "Copied from <address> …". Not changed in the form (the contract's
   table); **shown escaped** (`shownText` percent-encodes K2's `creatorName`
   set). A paste's own address comes from `URL.pathname` and can't carry one.
   **For the outside review:** should K2's `address` form refuse that set too?
3. **nit, reproduced:** a note per unknown key (2,001 lines). Now one note,
   at most 5 names, each shown escaped and cut to 40 characters, "and N more".
4. **nit:** the Inspect outline never updated (`tickEditMode` returned at Edit's
   guard first). Moved before the guard.
5. **nit:** one bad `refs` entry discarded the whole earlier record in a chain.
   Now per entry, as K2 words it.
6. **nit:** the Enable question called an ambiguous id "not in this world".
   Now only `not-found` is.
7. **nit:** a source origin over 256 or a path over 2,048 characters was refused
   at Paste with the wrong text. Now refused at Copy, saying which.
8. **nit:** §1 said three test files were outside §6; they are inside. Fixed.

## 8. The outside code review (ChatGPT, of `2971a440`)
`devtasks/REVIEW-copy-objects-code-chatgpt.md`: **APPROVE WITH NITS**, naming
`2971a440906487b6e3089755f7a96e93fe5daac3` in its first line. Source only: its
clone failed on DNS ("Could not resolve host: github.com"), as last round, so
it ran none of the project's tests; it ran one isolated date probe. No
must-fix; K7's earlier must-fix confirmed addressed. Claude reproduced both
nits before taking them:
- **N2 (taken):** `creditDateOk` refused real dates in years 0001–0099 in both
  copies (`Date.UTC` maps years 0–99 to 1900–1999). Now `setUTCFullYear`;
  four vectors added (0001-01-01, 0004-02-29 accepted; 0001-02-29, 1900-02-29
  refused), which fail on the old check.
- **N1 (taken, the operator: "Take it now"):** the fresh check's §7 item 2.
  K2's `address` form now refuses U+007F, U+2028–U+2029, U+202A–U+202E and
  U+2066–U+2069 as `creatorName` does, in both checks; five vectors (four
  refused, the percent-encoded form a paste records accepted) fail on the old
  check; the pre-brief's K2 row is Rev 2.1. The escaped display stays as a
  second guard.
