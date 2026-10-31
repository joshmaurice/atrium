# Revision — scripting-4d-1 round 3 (round 2 is on DEV, not accepted)

**Status: Rev 0, approved by the operator (2026-10-31 05:12 PT), all as
recommended:** R-L2 (a) a lifetime lock file; R-L3 (a) identifiers 1–64,
pointers 256, prose 256 with no control characters; R-L4 (a) keep the
importer's rule, rewrite §6.1 check 4; R-L5 (a) accept the Khronos
`setDelay` result and record it. Twelve items, R6–R17, continuing round
2's numbering; the kickoff body is §5.

- **Base:** round 2's reviewed tip `3cfeeed9a8bf91bc407d796030ea5508d706ccaa`
  on `workflow/scripting-4d-1` (published). DEV is its release merge
  `7a60dbb8`, `WAITING_FOR_HUMAN_DEV_ACCEPTANCE`; **it is not accepted**.
  Round 3 commits on top of `3cfeeed9` on the same branch, one commit per
  step. There is no merge step.
- **Round 2's cards:** kickoff `t_724972d4`; steps `t_9be88969`,
  `t_9a75fd9b`, `t_248c384c`, `t_ede92a07`, `t_1530a5fd`, `t_085355ef`; GLM
  review `t_9ae89c40` (APPROVE `3cfeeed9`); gate `t_0c3c0e08`; chain
  `t_df0f5c25`, `t_ba9e3f27`, `t_8f2c1046`, `t_f56db644`; release sentinel
  `t_f93034ca`. The acceptance card `t_f56db644` is **not** completed: round
  3 redeploys DEV over the unaccepted round (`set-dev` from
  waiting-for-acceptance, as 4b-2 rounds 5–7 did).
- **The contract still governs:** `PREBRIEF-scripting-4d.md` FINAL Rev 1.4
  at `4f19b253` (sha256 `457e2ff0…9458`); `KICKOFF-scripting-4d-1.md` at
  `1a26d8fa`; `REVISION-scripting-4d-1.md` Rev 0 (R1–R5, R-L1 (a)) at
  `c89eb69c`. **This file adds R6–R17 and four Rev 1.5 notes to the
  pre-brief (§4), and changes nothing else.** The R5 rules (one card per
  step, every item answered, never complete with an item undone, check the
  predecessor first) carry over unchanged.

## 1. What round 2's checks found

Three inputs, in the order they arrived:

| Input | Where | Result |
|---|---|---|
| GLM's review and the step handoffs | passdown 2026-10-31 §3, items 1–8 | six coverage/harness findings and the `onHoverIn` question |
| **Claude's §6.1 browser checks on DEV `7a60dbb8`**, short pass | `devtasks/harness/checks/scripting-4d/` (new; §1.2) | **one must-fix (F1)**, a spec/check conflict (F2), item 7 settled (F3), one nit (F4). Checks 2, 3, 5, 6 pass; 1 and 8 fail on F1; 4 can't run as written (F2); 7 passes. 9, 10, 11 not run (deferred to round 3's SHA) |
| **The outside review** (`REVIEW-scripting-4d-1-code.md`, source-based, NO-GO) | M1, M2, S1, S2, N1, three spec notes | **M1 and M2 confirmed** by Claude from the source; S1 confirmed by running the rule; S2 confirmed from the source |

### 1.1 The findings, checked

- **F1 (HIGH, must fix): every `flow/setDelay` kills its behaviour in a real
  browser.** `packages/behaviors/src/adapter.js` L273 calls the injected
  timer as a method, `table.setT(() => …)`, so `this` is the delay table.
  Chrome's `window.setTimeout` throws `TypeError: Illegal invocation` for any
  receiver but `window` (verified in Chromium: `{ setT: setTimeout }.setT()`
  throws; an unbound call works; Node ignores `this`, which is why 699
  server tests, the 21 fixtures and the Khronos subset all pass). In the
  browser the throw surfaces as `the graph threw: Illegal invocation` →
  `behaviour disabled — engine-error` on the first delay. §6.1 check 1's
  graph (select → 0.5 s → hide → 2 s → show) died on the visitor's first
  click; check 8 inherits it. Nothing in the round's test matrix could see
  this: the suites run in Node. **R6.**
- **F2 (spec vs check): §6.1 check 4 can't happen through the importer.**
  Its graph (a `/materials/…` `pointer/get` feeding a translation write) is
  refused at import by G6's own consumer rule (Rev 1.1 S3, Rev 1.2 N4):
  `the reference /materials/0/pbrMetallicRoughness/baseColorFactor (node 4's
  pointer) is read by math/extract4 at node 5; its meaning can't survive the
  import`. The check expected the import to succeed and the write to be
  refused at run time. The code follows G6; the check text predates S3.
  **R-L4.**
- **F3 (item 7, settled): card 4 was right about the validator; G-L3 holds.**
  `validateInteractivityGraph` (engine build L11908) refuses a *bare*
  declaration of any op whose schema carries an `extension`:
  `event/onHoverIn`, `event/onHoverOut` (`KHR_node_hoverability`) and
  `event/onSelect` (`KHR_node_selectability`) all fail with `unknown core
  operation <op>`; both rule copies run the validator last, so such a graph
  is refused (`behavior-graph`), not stored. A hover declaration written as
  the spec requires, `{ op, extension: 'KHR_node_hoverability' }`, is
  accepted by the validator and the rule, is not an executable identity, is
  renamed to a NoOp, and is stored, inert and reported as "Partially
  supported" (`runner-g4.test.js` L507–519 pins exactly that; the
  implementer patched its declaration for the same reason). What is wrong
  is G-L2's wording, which lists hover under "Not run" beside two *core*
  ops as if "bare" applied to it. The outside review's spec note 1 says the
  same. **R17 (a Rev 1.5 note; no code change).**
- **F4 (LOW): the importer's grant line shows raw ids.** `It can change:
  c27d47d1-5728-…`, while the Q3 confirmation names the same objects
  (`nameOf`). **R16.**
- **M1 (HIGH, must fix; outside review, confirmed): the importer conflates
  light indices and node indices.** `parseGraphSource` builds `fileLights`
  from the *host node's* index (L244–248), not the light table's; the panel
  stores `node:<i>` and `light:<i>` into the same `mapping.nodes[i]` slot
  (`graph-import-panel.js` L204–211), so whichever row was set last wins and
  a graph that references `/nodes/0/…` and `/lights/0/…` can convert with
  both writes on one object and no conflict reported. `convertGraph`'s
  `LIGHT_RE` branch (L605–611) then resolves the light through
  `mapping.nodes`. G6 promised no silent retargeting. **R7.**
- **M2 (HIGH, must fix; outside review, confirmed): the rollback scripts'
  "exclusive lock" is not one.** `BEGIN IMMEDIATE` takes SQLite's RESERVED
  lock; an idle connection (a running server between transactions) does not
  hold one, so both scripts proceed with the server up, and its next
  autosave can overwrite a reconcile. G10 and N3 said the scripts *check*
  the server is stopped; they don't. **R8, R-L2.**
- **S1 (MEDIUM; outside review, confirmed by running the rule): graph
  object keys are unbounded.** A node `values` key of 1,000 `Z`s, or of
  `\u0007\n<b>`, passes `behaviorCheck` in both copies (the 65,536-unit leaf
  cap still holds). G7 bounds `op`, `extension` and event ids only; the
  kickoff says every stored graph string has a bound and a character set.
  **R9, R-L3.**
- **S2 (MEDIUM; outside review, confirmed from the source): the panel reads
  the whole file before the 4 MiB check.** `chooseFile` awaits
  `file.arrayBuffer()` and only then `parseGraphSource` sees the length.
  **R10.**
- **N1 (LOW; outside review): the CLI prints node names raw**, so a name
  with LF/CR forges report lines. **R11.**
- **Items 1–6 and 8 of the passdown's §3** stand as recorded: **R12** (the
  three coverage gaps), **R13** (the `world-total` harness hang), **R14**
  (`[world] healed -`), **R-L5** (the Khronos `setDelay` result), **R15**
  (handoffs in the summary and metadata).

### 1.2 The browser checks on DEV `7a60dbb8` (the short pass)

The harness is `devtasks/harness/checks/scripting-4d/` (`common4d.py`,
`c1.py` = checks 1, 4, 7, 8; `c2.py` = 2, 3; `c5.py` = 5, 6), on
`signin-sync/authserver.mjs` with `HOOKS=1` (which now also exposes
`__beh().importPanel`, and keeps its database across a restart with
`KEEP_DB=1`), real sign-in, the panel driven as an owner would.

| Check | Result on `7a60dbb8` | Notes |
|---|---|---|
| 1 import, map, grant, saved disabled, enable, visitor click | **FAIL at the click** (F1) | the panel half passes: one row per file node, Save disabled until mapped, the grant, `enabled: false` with `targets`, Enable without a prompt |
| 2 `onTick` rotation | **PASS** (30 s form) | host turns every frame independent of the echo (56 frames → 160.4°, as predicted); visitor steps at 13.7/s; no `INVALID_VALUE`, nothing refused; the sampled-motion note and the Q3 prompt shown. **Run the full 120 s on round 3** |
| 3 `pointer/interpolate`, host closed at 1.9 s | **PASS** | steady: visitor's last value = target (28 steps); closed at 1.96 s: visitor, saved document and the new host (A2, `hostGen` 2) all hold `[1.2458, 0.5, -2.1886]`, nothing sent after |
| 4 "Partially supported" | **can't run as written** (F2) | the importer refuses the material get feeding a write (G6 S3); the hover-only half is untested until R-L4 settles the graph |
| 5 the frame limit, stressed | **PASS** | 64 leaves accepted; a heavy tick = 3,004 node starts; **host p95 frame time 116 ms** (p50 92, max 139; SwiftShader-bound), ~54 of 64 engines skipped per frame in rotation; nothing disabled; a light graph still turns (9 ticks in 4 s); "Throttled" on all 64 (Q5's rule as written) |
| 6 a stale owner tab | **PASS** | the 4c page sends `scriptRunner: 2`, is never elected (not while A is host, not after A closes: the visitor's click gets the no-host notice); a 4d tab takes over (`hostGen` 2) and the click works |
| 7 XSS | **PASS** | HTML in the file name, node name, op name and event id all reach the DOM as text; no `<img>` in the panel; `window.__xss` unset |
| 8 restart from the saved document | **FAIL** (F1, through check 1) | the restart itself works: session survives, both leaves back byte for byte, healing logged nothing |
| 9, 10, 11 | **not run** | deferred to round 3's SHA: the regression set, the Q7 measured gates and the rollback rehearsal are the long ones, and 1, 4 and 8 must be rerun anyway |

## 2. The contract (round 3)

### R6. The adapter's timers are called unbound (F1)
- `createDelayTable` and the interval scheduler keep `setT`/`clearT` as
  plain locals and call them unbound (`const setT_ = …; setT_(fn, ms)`), or
  bind them at injection; **no `table.setT(…)` / `options.clearTimeout(…)`
  call remains** anywhere in `packages/behaviors/src/`.
- **Test, in `adapter-g3.test.js`:** the injected fakes are `this`-sensitive:
  `function setT() { if (this !== undefined && this !== globalThis) throw new
  TypeError('Illegal invocation'); … }`, the same for `clearT`. Every
  existing delay test (`done`, `cancel`, the stale handle, the 17th, the
  10,000 sequential, `dispose`) runs with these fakes.
- **A real-browser proof is Claude's §6.1 check 1**, now scripted
  (`checks/scripting-4d/c1.py`): the delay graph hides and shows the target.
- **Proof (c5):** call `table.setT(…)` as a method; the `done` test fails
  with `Illegal invocation`.
- **Lesson for the pre-brief (Rev 1.5 note):** an injected host function is
  called unbound; the fakes for injected host functions are `this`-sensitive.

### R7. The importer's light namespace (M1)
- `parseGraphSource` returns `fileLights` from the **light table**
  (`doc.extensions.KHR_lights_punctual.lights`), each `{ index, name, hosts:
  [nodeIndex…] }`, with the hosts resolved through
  `node.extensions.KHR_lights_punctual.light`. A light with no host or two
  hosts is a **problem** named at parse time (the import is refused, naming
  the light).
- The panel keys light rows `light:<lightIndex>`, and `convertGraph`'s
  mapping gains `lights: { <lightIndex>: objectId }`; `LIGHT_RE` resolves
  through it, never through `mapping.nodes`. A light row's label is `<host
  node name> → light <lightIndex> (light)`.
- The `nodeMap` is still own-first and unique over every mapped object
  (nodes and light hosts together), built after both namespaces resolve; a
  light reference rewrites to `/extensions/KHR_lights_punctual/lights/<nodeMap
  index of the mapped object>…`, as the adapter expects (G3's family rule).
- **Tests (`graph-import.test.js`, `graph-import-panel.test.js`,
  `adapter-g3.test.js`):** a glTF with `lights[0]` on `nodes[1]` and a graph
  reading `nodes[0]` and writing `lights[0]`, mapped to **two different**
  objects: the labels, the retained mapping after each pick, `nodeMap` of
  three, the light write landing on the light object and the node write on
  the node object **through the real adapter**; two distinct lights on two
  nodes; a light with two hosts refused; the old fixture (one node that is
  also the light's host) still converts with `nodeMap: [own]`.
- **Proof (f4):** resolve lights through `mapping.nodes` again; the
  two-object test writes both to one object.

### R8. The rollback scripts check the server is stopped (M2; R-L2 (a))
R-L2 (a), below. **Keep `BEGIN IMMEDIATE`** for atomicity; stop claiming it
is the offline check. Tests: a live holder → both scripts refuse with the
reason; a stale holder → proceed with a warning; the three outcomes and the
second `--apply` on a scratch database (the existing tests, unchanged).

#### R-L2. How the scripts know the server is stopped (operator decision)
- **(a) Recommended: a lifetime lock file beside the database.** The server
  creates `<db>.lock` exclusively (`O_EXCL`) at start with its pid and host,
  removes it on clean exit, and **refuses to start** if the file exists and
  its pid is alive (two servers on one database is the same hazard). The
  scripts refuse while the file exists and its pid is alive; if the pid is
  dead they warn (`stale lock from pid N, removed`) and proceed. Portable,
  ~40 lines, tested with a child process holding the lock.
- (b) The scripts probe for a live server through its own health endpoint
  (`/api/health` on the configured port). Simple, but it needs the port, and
  a server on another port or host is missed.
- (c) Runbook only: the operator stops the service first; the scripts print
  a reminder. Nothing checked.

(a) is what G10 and N3 already describe ("checked, not assumed"). The
review's spec note 3 asks for exactly a server-lifetime lock. **Decided: (a).**

### R9. Every string in a stored graph has a bound and a character set (S1; R-L3)
R-L3 (a), below, **in both copies**, with shared vectors at each boundary and
one past, with multi-byte strings, and the vector file regenerated with the
new counts.

#### R-L3. The string policy (operator decision)
- **(a) Recommended: identifiers 1–64, prose bounded.**
  - **Identifiers** — every object key inside the graph (`values`,
    `configuration`, `flows`, declaration socket maps, event `values`), and
    every socket name in a `{ node, socket }` reference: `1–64` characters
    of `[A-Za-z0-9_]`. (Khronos socket ids are `a`, `b`, `value`, `0`…`3`,
    `startIndex`, `loopBody`; all fit.)
  - **Pointers** (`configuration.pointer`): 1–256 characters of
    `[A-Za-z0-9_/{}\[\].:-]`, already partly bounded by the pointer family
    rule.
  - **Prose** (`debug/log`'s `message` literal and any other string
    literal): at most 256 characters, **no C0 control characters** other
    than `\n` and `\t`, no U+2028/2029. The validator's own type rules still
    apply.
  - The three G7 strings stay as they are.
- (b) One rule for everything: 1–64 of `[A-Za-z0-9_./:{}\[\]-]`, control
  characters refused. Simpler; it caps `debug/log` prose at 64.
- (c) Only (a)'s identifier rule; leave prose to the leaf cap.

(a) matches the kickoff's "every stored graph string has a bound and a
character set" and the review's spec note 2 (distinguish identifiers from
prose). **Decided: (a).** G7's table gets the three new rows (Rev 1.5).

### R10. The panel refuses an oversized file before reading it (S2)
`chooseFile` checks `file.size > IMPORT_BYTES_MAX` **before**
`arrayBuffer()`, shows the same problem text `parseGraphSource` would, and
`parseGraphSource` keeps its own byte guard. **Test:** a fake `File` of 4 MiB
+ 1 whose `arrayBuffer` throws if called → refused, zero reads; exactly 4 MiB
is read.

### R11. The CLI escapes names (N1)
`behaviors-export.mjs` and `behaviors-reconcile.mjs` print node and world
names through `JSON.stringify`. **Test:** a scratch export with a node named
`crate\n[reconcile] APPLIED: …` produces one record line per node.

### R12. The three coverage gaps (passdown §3 items 1–3)
- **(b3):** a server test where a `send` replaces a leaf at 1 MiB minus N
  bytes with a leaf of the same size: accepted (the replaced leaf is
  excluded from the total); with the exclusion removed the test fails.
- **(f):** `convertGraph` with a variable whose initial value is
  `/nodes/<i>`: the rewritten literal is asserted; with the rewrite skipped
  the write log differs.
- **(d3):** a runner test that mutates the overlay's `nextRevision` from a
  write check that runs *after* the queue would see it: with the check
  before the queue nothing is enqueued; with the order reversed the test
  fails.

### R13. `world-total.test.js` tears down on a failing assert (passdown §3 item 4)
Sockets and the server close in `finally` (or `t.after`), so proof (b2)
fails in seconds, not at the 180 s timeout. Record the new (b2) output.

### R14. `[world] healed <logId>` on the database path (passdown §3 item 6)
`world-registry.js` passes the world's `logId` to `createWorldFromDocument`;
the line reads `[world] healed <8 hex> in <ms> ms`. **Test:** the server
test's log capture asserts the id. (`world-registry.js` is added to card 2's
file list.)

### R15. Handoffs in the summary and metadata (passdown §3 item 8)
Process, in every card body: the handoff is the completion summary **and**
metadata (`tip_sha`, `step`), per canonical §2; a comment is not a handoff.
The gate checks it before promoting.

### R16. The importer's grant line names objects (F4)
`It can change: <name>, <name>` through the same `nameOf` the Q3 prompt
uses; an object with no name shows its id. **Test:** the panel test's grants
line.

### R17. Pre-brief Rev 1.5 notes (F3, and the review's three spec notes; no decision change)
Appended to §0 as "Rev 1.5 (after FINAL, round 3)", changing no decision:
1. **G-L2's "Not run" list, split:** `event/stopPropagation` and
   `animation/stopAt` are **core** ops, stored bare and inert;
   `event/onHoverIn`/`onHoverOut` are **extension** ops, valid only with
   `KHR_node_hoverability`, stored and inert in that form, and **a bare one
   is not a valid KHR_interactivity graph** (the validator refuses it,
   `unknown core operation`, in both copies). G-L3's "any declaration the
   engine's validator accepts" is the rule; this makes the hover case
   explicit. §6.1 check 4's graph carries the extension.
2. **The string policy** is R-L3's choice, in G7's table (three rows).
3. **"Exclusive lock"** means R-L2's choice: held for the server's lifetime
   and checked by the scripts; `BEGIN IMMEDIATE` is for atomicity only.
4. **Injected host functions are called unbound** (R6), and the fakes for
   them are `this`-sensitive.

#### R-L4. §6.1 check 4 vs the importer (operator decision)
- **(a) Recommended: keep the code, fix the check.** The importer's refusal
  is G6 (S3, N4) working: a running node reading a material would see a
  default or `NaN`, and the import names the consumer. Check 4 becomes:
  *a graph with `event/onHoverIn` (`KHR_node_hoverability`) and a
  `/materials/…` `pointer/set` that nothing reads: the list ("Partially
  supported: event/onHoverIn with the extension KHR_node_hoverability (1
  nodes); /materials/… (1 nodes)"), the rest runs, the material write is
  inert; and the same material pointer read by a running node is **refused
  at import**, naming the reference and its consumer.* The run-time half
  ("a material get feeding a translation writes nothing") stays as a runner
  test with a stored leaf (G4's write check refuses the `NaN`), since the
  importer never produces one.
- (b) Relax the importer: a `pointer/get` of an unsupported family is not
  a consumer; the value is whatever the engine returns, and the write check
  catches it. Matches the check as written; weakens S3.

**Decided: (a).**

#### R-L5. The Khronos `core:flow/setDelay_and_cancelDelay` result (passdown §3 item 5)
- **(a) Recommended: accept, and record it.** The result is `no result`
  because the conformance graph exceeds G7's 16 pending delays and reads the
  engine's `/extensions/KHR_interactivity/delays/<n>` path, which the
  adapter's delay subclass doesn't register. Both are G7/G3 decisions.
  `expected-4d.json` keeps `no result` for it with a one-line reason in the
  manifest; the fixture stays.
- (b) Register the `delays/<n>` path on the subclass and raise the cap for
  conformance only. More code, for a graph no Atrium owner will import.

**Decided: (a).**

## 3. The cards, their steps and their items

R5's rules hold: **one card per step**, the items listed in the body, the
handoff answers each one with files and test names, never complete with an
item undone, check the predecessor first, progress comments. **Each card's
body says: "The review is a single GLM review; Nemotron is benched (F-8)."**
Commit subjects: `scripting-4d-1 round 3 step <N> (<items>): …`.

### Card 1: the adapter and the runner — R6, R12 (d3), R-L4's runner test
Precondition: `HEAD` = `3cfeeed9a8bf91bc407d796030ea5508d706ccaa`, worktree
clean. Files: `packages/behaviors/src/adapter.js`, `runner.js`, their tests.
Run `packages/behaviors` on its own; the 21 fixtures; proofs (c5), (d3).

### Card 2: the rule (both copies) and the server — R9, R12 (b3), R13, R14
Files: `packages/behaviors/src/behavior-spec.js`,
`packages/server/src/send-policy.js`, `tests/fixtures/behavior-vectors.json`
(regenerated, counts stated), `packages/server/src/world-registry.js`,
`world-total.test.js`, the vector tests. Run `packages/behaviors`,
`packages/protocol`, and every server file touched, each alone under
`timeout 180`; proofs (a)-family for the new vectors, (b2) with its new
output, (b3).

### Card 3: the importer — R7, R10, R16, R12 (f), R-L4's import test
Files: `apps/client/src/graph-import.js`, `graph-import-panel.js`, their
tests. Run `apps/client`; proof (f), (f4).

### Card 4: the rollback scripts — R8 (as R-L2), R11
Files: `packages/server/scripts/behaviors-export.mjs`,
`behaviors-reconcile.mjs`, the server's start (the lock, under (a)), their
tests. Run the scripts' tests and the server's start/stop test.

### Card 5: the pre-brief notes, full suites, proofs, the handoff — R17, R15
`PREBRIEF-scripting-4d.md` Rev 1.5 (§0 note, G7 rows, G-L2 wording, §6.1
check 4's text, and `expected-4d.json`'s reason under R-L5 (a)); then the
round-2 kickoff's requirement 3 and canonical §2: every suite, 0 skipped,
every proof quoted both ways, the Khronos subset on the build host, the tip
in summary and metadata.

### Card 6: the GLM review of round 3 (`4f19b253..<tip>`), cap 14400 s
A single GLM review; it reproduces every proof including (c5), (f4) and the
new vectors. Then the gate, publish, DEV (`set-dev` over the unaccepted
round), the finalizer, acceptance — the front door **makes the sentinel
links itself and reads them back** (passdown §4).

### Before DEV acceptance
1. **Claude's eleven §6.1 checks on the new DEV SHA**, now scripted:
   `c1.py`, `c2.py` (`ROT_SECONDS=120`), `c5.py`, plus the scripts still to
   write for 9 (the regression set, two harness roots), 10 (Q7's measured
   gates: five runs, median, three visitors, the heap through CDP) and 11
   (the rollback rehearsal — on the host, by the operator, on a copy of
   PROD's database; Claude rehearses it locally first and hands over the
   command block).
2. A second outside review of `3cfeeed9..<tip>` (the review asked for
   exactly this: rerun the matrix where the repository and `pnpm` exist).
3. DEV acceptance (§7 of the pre-brief).

## 4. Cleanup, unchanged from the passdown
Archive sentinel `t_adf3ee2b`, then gate `t_d0639e09` (the sentinel first:
archiving promotes children).

## 5. Kickoff body for round 3

**For the front door.** Do these before creating anything:
1. Check that this file's commit is on `origin/main`, and compute its
   sha256.
2. Create **round 3's sentinel first**: the same shape as `t_f93034ca`,
   titled `Scripting-4d-1 r3 sentinel (scripting-4d-1)`.
3. Fill the body's three placeholders:
   - `<REVISION_CHECK>`:
     `REVISION CHECK (front door): <commit>:devtasks/REVISION-scripting-4d-1-round-3.md sha256 <hash>, <bytes> bytes, matches.`
   - `<SENTINEL_ID>`: the new sentinel's id.
   - `<CANONICAL_REQUIREMENTS>`: the canonical worker-card requirements,
     verbatim, the same text as rounds 1 and 2.
4. Create the kickoff card with the filled body **in its body field**, and
   read it back whole.
5. **The front door makes the sentinel link itself**, after the kickoff
   completes: `kanban_link(parent_id=<gate id>, child_id=<SENTINEL_ID>)`
   (gate → sentinel, never the reverse; round 2's kickoff reversed it), then
   read the sentinel back and check its parent is the gate.

Keep in mind:
- Round 2's sentinel `t_f93034ca` and acceptance card `t_f56db644` are
  still open by design (the round is on DEV, unaccepted); with two open
  sentinels the guard skips its automatic link. Round 3's chain redeploys
  DEV over round 2 (`set-dev` from waiting-for-acceptance).
- The cleanup of round 1's `t_adf3ee2b` and `t_d0639e09` (§4) can happen
  at any time; it doesn't affect this round.

---

### KICKOFF — scripting-4d-1 revision round 3. Slug: `scripting-4d-1`

You are the kickoff orchestrator for round 3 of `scripting-4d-1`. Build the
graph below, read it back, report, and stop. Do not implement, review or
deploy anything yourself.
- **Your tools:** only `kanban_*`.
- **Everything you need is in this body.** Nothing will be posted on this
  card afterwards, so don't wait for comments, and **never block this
  card.**
- **Blocking:** never call `kanban_block` without an explicit `task_id`.
- **Titles:** use them exactly as written, character for character.
- **Card bodies:** write each card's body from the bullets under its title;
  don't copy this kickoff's instructions to you into any card. The
  references block, the hash checks and the canonical requirements are
  copied whole. Bodies go in the body field when you create the card; read
  each back, and if a body is empty post it as the card's first comment
  while it's `todo`. Never create a second card in its place.
- **Create every card with its parent** (`parents=[…]`).
- **Do not create or link any sentinel.** The front door does that.

**The front door's spec check:** `SPEC CHECK (front door): 4f19b2533308ef0dc0fa3c3d8a5b4164eb389e82:devtasks/PREBRIEF-scripting-4d.md sha256 457e2ff0d018580e117bc0e3aac3ae6d4d4e90aa36a9c6dbf1106cdc10279458, 121240 bytes, matches.`

**The front door's revision check:** <REVISION_CHECK>

**The sentinel (for your report only; don't link it):** `<SENTINEL_ID>`

#### The references block (copy it whole into cards 1–6)
**The contract is in git.** Before anything else, read and check all four:

```
git -C /workspace/atrium fetch origin main
git -C /workspace/atrium show 4f19b2533308ef0dc0fa3c3d8a5b4164eb389e82:devtasks/PREBRIEF-scripting-4d.md > /tmp/prebrief.md
sha256sum /tmp/prebrief.md   # 457e2ff0d018580e117bc0e3aac3ae6d4d4e90aa36a9c6dbf1106cdc10279458
git -C /workspace/atrium show 1a26d8faba708c7784d1ae283670921d4608ae3b:devtasks/KICKOFF-scripting-4d-1.md > /tmp/kickoff-r1.md
sha256sum /tmp/kickoff-r1.md   # 426626027d62a624296d0c4971f179bd4d26c67688fae63f35a87e35d2132b5c
git -C /workspace/atrium show c89eb69c:devtasks/REVISION-scripting-4d-1.md > /tmp/revision-r2.md
sha256sum /tmp/revision-r2.md   # f3a73cd37502b49197a03490feedf7e4014088d3522f809669de4c00a4f5b514
git -C /workspace/atrium show <revision commit>:devtasks/REVISION-scripting-4d-1-round-3.md > /tmp/revision-r3.md
sha256sum /tmp/revision-r3.md   # <revision hash>
```

(Fill the two `<revision …>` values from the front door's revision check
above.) On any mismatch, block with `kind="capability"`, quote both hashes,
and do not work from a different text.

- **The round-3 revision is this round's contract:** its §2 (R6–R17, with
  R-L2–R-L5 all decided (a)) and its §3, which gives **your card's** items
  and handoff.
- **Also binding:** the pre-brief (FINAL Rev 1.4); the round-1 kickoff's
  Settlement and its "Requirements for the implementation AND review cards
  (beyond the spec)", items 1–7; the round-2 revision (R1–R5, R-L1 (a));
  the GLM brief, run 1148's summary on `t_255de53b`.
- **The review is a single GLM review; Nemotron is benched (F-8).**

#### Graph — build exactly this
Cards 1–5 are assigned to `atrium-deepseek` and created with
`max_runtime_seconds=14400`. Each one's parent is the previous card, and
card 1's is this kickoff.

**Every implementation card's body** carries: the references block; the
line `Your items: the round-3 revision's §3, "<card heading>".` with that
card's heading as below; the worktree rule; the step rule; the canonical
requirements.

**The worktree rule:** work in the existing persistent worktree
`/workspace/wt/scripting-4d-1`, on `workflow/scripting-4d-1`. Before
changing anything:

```
cd /workspace/wt/scripting-4d-1
git status --porcelain                                            # must print nothing
git rev-parse HEAD                                                # must equal the tip your parent card reported (card 1: 3cfeeed9a8bf91bc407d796030ea5508d706ccaa)
git log --format='%h %s' 4f19b2533308ef0dc0fa3c3d8a5b4164eb389e82..HEAD   # round 2's eight commits, then one `round 3 step <N>` commit per earlier card
pnpm install --frozen-lockfile --prefer-offline
readlink -f packages/server/node_modules/@atrium/protocol          # must resolve inside this worktree
```

On any mismatch, block with `kind="needs_input"`, quote what you saw, and
touch nothing. Commit locally and never push. Commit subjects:
`scripting-4d-1 round 3 step <N> (<items>): …`, one commit per card.

**The step rule:** do **your card's items and no other**; your handoff
(the completion summary **and** metadata `tip_sha`, `step`; R15) marks
**every item** done with its files and test names, plus the round-2
revision's §3 handoff list; **never complete with an item undone**: block
with `kind="needs_input"` naming what is left; a progress comment after each
item group and each commit.

1. `Implement r3 step 1 — scripting-4d-1`. Heading: "Card 1: the adapter
   and the runner — R6, R12 (d3), R-L4's runner test".
2. `Implement r3 step 2 — scripting-4d-1`. Heading: "Card 2: the rule (both
   copies) and the server — R9, R12 (b3), R13, R14".
3. `Implement r3 step 3 — scripting-4d-1`. Heading: "Card 3: the importer —
   R7, R10, R16, R12 (f), R-L4's import test".
4. `Implement r3 step 4 — scripting-4d-1`. Heading: "Card 4: the rollback
   scripts — R8 (as R-L2), R11".
5. `Implement r3 step 5 — scripting-4d-1`. Heading: "Card 5: the pre-brief
   notes, full suites, proofs, the handoff — R17, R15".
6. `GLM review r3 — scripting-4d-1`. Assignee `atrium-glm`, parent: card 5,
   `max_runtime_seconds=14400`.
   - The body opens with the exact line
     `THIS RUN HAS TERMINAL, FILE AND GIT TOOLS. Use them for every step below.`
   - Then: the references block; "Your review: the round-3 revision's §3,
     'Card 6: the GLM review of round 3'"; the range is `4f19b253..<tip card
     5 reported>`, with round 3's commits read closely and round 2's for
     regressions; review in your own detached worktree at
     `/workspace/wt/review-<your task id>` at that tip, never in the
     persistent one; reproduce every proof, including (c5), (f4) and the new
     vectors; the canonical requirements.
   - The verdict is APPROVE or CHANGES_REQUIRED, with the exact lowercase
     40-character SHA when approving, and metadata `verdict`,
     `reviewer_role`, `review_round: round-3`, `findings_count` and the
     maximum severity.
7. `Review gate r3 — scripting-4d-1`. Assignee `atrium-orchestrator`,
   parent: card 6. It creates nothing. Its body says: **"A single GLM review
   is the whole review; Nemotron is benched (F-8). Do not ask for another."**
   - **On a valid APPROVE of the exact 40-character SHA,** it blocks with
     `kind="needs_input"` and the reason
     `APPROVE <SHA40>: front door, build the release chain`.
   - **Otherwise,** it blocks for the operator with the verdict quoted.
8. **The release chain is the front door's:** publish, DEV (`set-dev` over
   the unaccepted round 2), the finalizer, acceptance, at card 7's APPROVE.
   Nothing reaches MAIN or PROD.

#### Report back
- the seven ids, each with its parent;
- each implementation card's and the review's `max_runtime_seconds`
  (14400);
- that cards 1–6 each carry the references block with the filled revision
  commit and hash, in their body fields, and the canonical requirements;
- the review's opening line, and the gate's F-8 line;
- that you created and linked **no** sentinel.

Then complete this card.

#### WORKER-CARD REQUIREMENTS (canonical)
<CANONICAL_REQUIREMENTS>

---
