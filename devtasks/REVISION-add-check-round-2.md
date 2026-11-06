# Revision: `add-check` round 2

Status: **SHIPPED to PROD as `cdfe88a8` (2026-11-05, 02:25 UTC).** Implemented by Claude in the fast lane (operator's choice,
2026-11-05), on `claude/add-check-r2`. **Round 2.1 (§8) is the current tip,
`d56444c0fec6e9c5c9aeff811a2c7abd93cacfe8`;** round 2 was
302654c8bb990ef6a7674a693754d1cd9ec8f49d, on top of round 1's
reviewed tip `53764b76`. It supersedes round 1's DEV (`14c7adcf`), which the
operator had tested but the host never accepted (undo-hold passdown §3.4).
- **The contract** is still `PREBRIEF-add-check.md` FINAL Rev 1.1 (base
  `25f6b083`). This revision changes no decision. It fixes what the outside
  code review of round 1 found, all of it confirmed by Claude's own runs.
- **The review:** `REVIEW-add-check-code-r1-chatgpt.md` (source only; its
  clone failed on DNS), prompt `OUTSIDE-REVIEW-PROMPT-add-check-code.md`.
  CHANGES REQUESTED: two must-fixes, three should-fixes, a nit. The GLM
  review (`t_e3f66534`) had passed round 1, with five non-blocking findings.

## 1. What round 1 left, as reproduced
| # | Finding | Reproduced by Claude at `53764b76` | Fix |
|---|---|---|---|
| R1 | **`__proto__` bypasses the 16 KiB extras budget** (review M1). `worldExtrasProblem` copied extras into `{}`, where assigning an own `__proto__` key sets the prototype instead, so it wasn't measured. Both copies of the rule | Through the real handler on a world with the `open` policy: 900 KB under `__proto__` (a string or an object) **accepted, broadcast (900 KB) and saved**; a plain key of the same size refused. Avatar adds were safe (their extras keys are checked by name). On PROD every saved world has an owner (policy `owner`), so in practice only an owner could send it | A prototype-less copy, `Object.create(null)` |
| R2 | **An edit made while a save is in flight can be lost** (review M2). `doSave` cleared `dirty` after its write whatever happened meanwhile; a debounced save that fired during it returned early (`saving`) and was dropped; a flush during it returned early too | A real coordinator and world, the round's read-back seam held open: an edit during the save is **never written, not even by the owner's leaving flush**. The same probe on `8fc82bb5`, holding `serialize` instead: **also lost**. So it's older than this round; A10's read-back widened the window | A generation counter; `dirty` cleared only if no edit came in after the save began; a save asked for mid-save runs after it; both flushes wait for a save in flight |
| R3 | **The checker relied on the schema for some shapes** (review S1; GLM finding 5). It accepted a `null` or non-object node and `mesh`, `material`, `indices` or `extensions` set to `null`, contrary to A1's "complete on its own". The schema refused all of them first, so it wasn't a server bypass | `checkAddNode(null)`, `(5)`, `{mesh: null}`, `material: null`, `indices: null` all returned accepted | Fail closed; two new reason codes, `node-type` and `extras-type` |
| R4 | **Index lengths were checked after POSITION and NORMAL were scanned**, and a later primitive's keys after an earlier one's values (review S2), contrary to A1's lengths first. Bounded by the 1 MiB cap, so not a stall | Confirmed in the source; the new tests fail on `53764b76` | Every primitive's shape (keys, lengths, avatar budget, material) first, then any values |
| R5 | **Boundary vectors missing** (review S3): 64 primitives, 1,024 avatar vertices, 6,144 indices, 65,535 vertices with index 65,534, 16,384 UTF-8 bytes | — | Added: small ones as shared vectors, large ones generated in a new test that runs both copies |
| N1 | **The A10 autosave test listened on fixed port 9016** (review N1), the same port as an older test in that file | — | Port 0 |

**Not taken from the review:** nothing. Its "direct calls to `world.addNode`
are unchecked" is the internal trust boundary the contract intends (every
network path is behind the check, which both reviews confirmed).

## 2. The commits
1. `ef5e070` **r2a, the rule** (R1, R3, R4, R5): `packages/server/src/send-policy.js`,
   `packages/client/src/add-spec.js` (changed identically; a mechanical diff
   of the rule functions differs by one doc comment),
   `tests/fixtures/add-node-vectors.json` (+18 vectors, 60 in all),
   `packages/server/test/add-node-boundaries.test.js` (new, 21 tests).
2. `302654c` **r2b, autosave** (R2, N1): `packages/server/src/autosave.js`,
   `packages/server/test/autosave.test.js` (+2 tests).

**Files outside the spec's §6 list:** none. The new test file is under
`packages/server/test/`.

## 3. Proof that each new test fails on round 1's code (`53764b76`)
- **Vectors:** 11 fail in each suite (server `add-node-vectors`, client
  `add-spec`): the two `__proto__` refusals and the nine fail-closed cases. On
  the fix, 67/67 and 65/65.
- **`add-node-boundaries.test.js`:** 8 fail (the four lengths-first tests in
  each copy; they use arrays whose elements throw when read). The 12 boundary
  acceptances pass on both: they pin coverage, not a bug. On the fix, 21/21.
- **`autosave.test.js`:** the two R2 tests fail (the edit isn't saved; the
  flush logs CRITICAL). On the fix, 13/13.

## 4. Suite results at the tip
Claude, at the tip, Node v22.23.4, after `pnpm install --frozen-lockfile --ignore-scripts` and a local build of `better-sqlite3`:
- **`packages/server`: all 52 test files, each alone under `timeout 180`: 828 tests, 0 fail, 0 skipped, every file exit 0.**
- `packages/client` 637/637 (no `--test-force-exit`, exited on its own); `apps/client` 1420/1420; protocol 128; som 266; behaviors 263; interaction 9; renderer-three 310; gltf-extension 0.
- **3,861 tests in all, 0 fail, 0 skipped** (round 1's 3,802, plus 59 new: 18 vectors in each of the two suites, 21 boundary tests, 2 autosave tests).

## 5. Probes at the tip (Claude)
- **R1 through the real handler** (a world with the `open` policy): 900 KB under `__proto__`, as a string or an object, now **refused `extras-size`, nothing broadcast**, like the plain key.
- **R2 with the real coordinator** (the read-back held open, an edit made during it): the edit is **in the saved document**, and the owner's leaving flush keeps it. On `53764b76` and on `8fc82bb5` it was lost.
- `p4` and `p7` unchanged from round 1: every malformed avatar `add` refused, and every later join reads its dump.
- Not rerun in the browser: round 2 changes no client UI, and A7's Duplicate and Undo call the same `checkAddNode`, which accepts everything first-party (the vectors, the boundary tests and `add-check.test.js`'s real-builder test).

## 6. Release path
- **Review:** one outside review of this revision's diff
  (`53764b76..302654c8`), prompt `OUTSIDE-REVIEW-PROMPT-add-check-code-r2.md`.
  No GLM card (fast lane, operator 2026-11-05).
- **DEV:** the operator runs `atrium-deploy-gate "dev 302654c8bb990ef6a7674a693754d1cd9ec8f49d"` on the host. It
  makes a new release merge with `main`. Round 1's release merge (`14c7adcf`) is
  never promoted.
- **DEV acceptance:** a hard reload in every tab; the same steps as round 1
  (place, Duplicate, delete and Undo, a second tab), plus: edit an object, then
  close the tab at once (within a second), reopen the world and the edit is
  there.
- **Then MAIN and PROD** as usual, with `p6` rerun first if worlds have
  changed much.

## 7. Recorded follow-ups (not in this round)
- **A hidden host tab stops behaviours** (operator, 2026-11-05, during round
  1's DEV acceptance): the runner ticks on `requestAnimationFrame`
  (`PREBRIEF-scripting-4d.md` P8), so when the owner switches to another tab,
  the host's behaviours stop and the visible tab sees them freeze. Not caused
  by this round. Options for a short pre-brief: hand the host role to a
  visible owner tab (Claude's pick), tick a hidden host from a timer (partial;
  browsers throttle those too), or wait for step 6's worker.
- **The cheaper pipeline** (operator, 2026-11-05, on OpenRouter cost): run
  publish and DEV deploy from the host rather than as agent cards; size
  reviewer duties to the round; fewer retries on review cards.

## 8. Round 2.1 (after the outside review of round 2)
**The review:** `REVIEW-add-check-code-r2-chatgpt.md` (source only), CHANGES
REQUESTED. It found R1, R3, R4, R5 and N1 fixed, and round 2's autosave fix
flawed. Round 2 had reached DEV as `1df266e1`; round 2.1 supersedes it, and
the host still waits for DEV acceptance.

| # | Finding | Reproduced by Claude at `302654c8` | Fix in `d56444c0` |
|---|---|---|---|
| M1 | **A flush could wait forever.** Round 2 returned each save's follow-up from the promise the flush awaited, so saves that kept failing while save requests kept arriving held the flush, and its bounded retry never ran | On the real coordinator (failing read-back of 20 ms, periodic every 5 ms): **still pending after 1.5 s and 73 save attempts**. The production timings (a 60 s periodic) make it unlikely, not impossible | `entry.current` is one save; its single follow-up is scheduled separately, never during a flush; periodic and debounced saves stand back while a flush runs; the flush waits for the one save in flight, then makes at most two of its own |
| — | **Found by Claude while reproducing M1: `stop()` while a flush waited made the process spin.** Round 2's `while (entry.inFlight) await entry.inFlight` kept awaiting an already-settled promise, blocking the event loop | The test file hung until `timeout` killed it | The loop is gone (above) |
| S1 | **A save stopped mid-way could still write, and clear a new entry's `dirty`** (same world, same generation number). The registry awaits the flush before `stop()`, so the normal path was safe | Reproduced with the coordinator: the stopped save wrote, and the new entry's edit was then never saved | A save checks its entry is still the world's before writing or changing any state |
| N1 | The first race test waited fixed times | — | It waits for the saved result, with a 3 s limit |
| N2 | The read-back log's once-only flag reset before the write succeeded | — | It resets only after a successful write |

**Not changed:** the review's note on R4 (a material's four
`baseColorFactor` numbers are read in the shape pass, before a later
primitive's keys). It's bounded work, and the review doesn't count it as a
blocker. A4's material check stays in the shape pass.

**Proof:** three new tests in `autosave.test.js`. On `302654c8` the M1 test
fails and then the file hangs; the S1 test fails (the stopped save wrote); the
stop-during-flush test hangs (exit 124 under `timeout 30`). On `d56444c0`,
16/16.

**Suites at `d56444c0`:** every suite again, each server file alone under `timeout 180`: **3,864 tests, 0 fail, 0 skipped**, all 52 server files exit 0 (round 2's 3,861 plus the three new tests). Claude's probes of M1 and S1 on the real coordinator: the flush finishes (about 55 ms, 3 attempts), and the stopped save writes nothing.

**Release path:** a short outside follow-up review
(`OUTSIDE-REVIEW-PROMPT-add-check-code-r2.1.md`), then the host's
`atrium-deploy-gate "dev d56444c0fec6e9c5c9aeff811a2c7abd93cacfe8"`, then
DEV acceptance as §6 says.

**Outcome:** the follow-up review (`REVIEW-add-check-code-r2.1-chatgpt.md`)
approved `d56444c0` with two test-only nits. DEV `cdfe88a8` passed the
operator's acceptance (including the last-tab autosave check), then MAIN and
PROD. See `Atrium-Passdown-2026-11-05-add-check-shipped.md`.
