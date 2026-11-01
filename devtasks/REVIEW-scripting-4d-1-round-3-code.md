# Atrium scripting-4d-1 — round-3 outside re-review

**Range:** `3cfeeed9a8bf91bc407d796030ea5508d706ccaa..769825ce3781b5bb4de03f4d7687b37cd9f0d46a` (five commits). **Verdict: NO-GO for DEV acceptance.**

**Read-only methodology:** `git ls-remote` could not resolve `github.com`; Node v22.16.0 exists, but `pnpm` is absent. I could not clone, run `pnpm install --frozen-lockfile` / `pnpm -r test`, or independently rerun the proof breaks and browser checks. No test counts are claimed. I read pinned files with the GitHub connector, including the round-3 revision (stored on `main`/release but **not** at the branch tip), Rev 1.5 pre-brief, code and tests. I executed independent isolated probes using the **actual fetched source** of the vendored validator, both behavior-rule copies and the importer. Those probes are **not** project-level tests. GitHub comparison confirms that release `5eebe09fd5b000e70d50a36a9c926e6263d86e80` differs from reviewed tip only in `devtasks/` notes/harness files.

## Must fix

### M1. The lifetime-lock protocol is still not mutually exclusive across rollback scripts and server startup

- **Where:** `packages/server/src/server-lock.js:84–105,118–139`; `packages/server/scripts/behaviors-reconcile.mjs:228–256`; `behaviors-export.mjs:100–129`; `packages/server/src/index.js:64–84`.
- **Trigger:** Reconcile calls `assertServerStopped(dbPath)` while no `<db>.lock` exists; it returns and opens the DB. A server starts before the reconcile has finished. `acquireServerLock` succeeds, because **the script never acquires/holds a maintenance lock**. The server may load pre-reconciliation world state while the script restores it, then later overwrite the restored state on autosave. `BEGIN IMMEDIATE` serializes SQLite writes but does not prevent startup or a stale in-memory world.
- **Sibling race:** The server's lock is created with `openSync(lockPath,'wx')` before its PID JSON is written (server-lock.js:90–95). During that interval, `assertServerStopped` can read an empty/partial lock as malformed and **unlink it** (lines 123–128). Similarly, two processes recovering a stale lock can each read the old contents and unlink a newly acquired lock from the other process (lines 99–105), allowing two holders. Releases at line 96 unconditionally unlink the path; they do not confirm they still own the same file.
- **Evidence:** Source-inferred, not reproduced using Atrium's CLI. The specific interleavings follow directly from the read/unlink and check-then-work paths.
- **Smallest remedy:** Both maintenance scripts must take and hold an exclusive maintenance claim against server startup for the entire operation, releasing it after DB close. Strengthen stale-lock recovery to avoid deleting a newer owner's claim, and make release ownership-aware. A kernel `flock` or a race-safe equivalent is preferable; preserve the operator's lifetime-lock decision. **Test:** pause reconciliation immediately after its no-lock check, start the server and assert startup cannot succeed; simultaneously recover one stale lock from two processes and verify only one may hold the DB; inject a temporary malformed/partial newly-created lock and ensure a script does not remove a live owner's claim. The current `server-lock.test.js:90–173` only tests a server already fully holding a well-formed lock, plus sequential stale recovery.
- **Relation to known F6:** This is independent of the already-reported 4c server not creating a lock and symlinked DB paths bypassing `resolve`-based identity. Those known issues remain additional limitations.

## Should fix this round

### S1. R9's string walk misses declaration socket-map keys

- **Where:** `packages/behaviors/src/behavior-spec.js:391–429`; server duplicate `packages/server/src/send-policy.js:812–848`.
- **Trigger:** A validated extension graph has `declarations[0].outputValueSockets` keyed by `"Z".repeat(1000)` or `"a\n<b>"`. R-L3 and Rev 1.5 G7 explicitly require **both declaration socket maps** to have 1–64-character `[A-Za-z0-9_]` keys. `graphStringProblem` walks node `values`, `configuration`, `flows`, variable literals and event `values`, but **not** `declarations[].inputValueSockets` or `outputValueSockets`.
- **Reproduced (isolated actual source):** With `types:[{signature:'float'}]`, `declarations:[{op:'probe/foo',extension:'EXT_probe',outputValueSockets:{[key]:{type:0}}}]`, `nodes:[{declaration:0}]` and a valid behavior envelope, the vendored validator, **client behaviorCheck** and **server behaviorCheck** all returned success for each of the ordinary, 1,000-character and newline-bearing keys:

  ```text
  ordinary client={"problem":null,"message":null} server={"problem":null,"message":null}
  overlong client={"problem":null,"message":null} server={"problem":null,"message":null}
  newline client={"problem":null,"message":null} server={"problem":null,"message":null}
  ```

- **Smallest remedy:** Apply `socketMapProblem` to both declaration socket maps (and applicable declaration socket string literals) in both copies, preserving the existing validator and key-exact policies. **Test:** shared vectors for input and output maps at 64/65 characters, invalid punctuation and control characters, plus an accepted extension declaration; mutation proof reverting these new branches must fail.

### S2. R7 adds quadratic work when parsing a source's light table

- **Where:** `apps/client/src/graph-import.js:260–283`, especially `265–271`.
- **Trigger:** A `.gltf` file contains 10,000 small `nodes` and 10,000 small `KHR_lights_punctual.lights`, with one unique host per light. This fits comfortably under the 4 MiB guard. The importer scans **every node for every light** to find hosts; the browser's main thread executes `O(lights × nodes)` comparisons synchronously.
- **Reproduced (isolated actual `parseGraphSource`, injected only a small text-decoding shim):**

  | Nodes = lights | JSON bytes | Parse time | Verdict |
  |---:|---:|---:|---|
  | 1,000 | 56,052 | 156 ms | accepted |
  | 5,000 | 284,052 | 3,707 ms | accepted |
  | 10,000 | 569,052 | 14,731 ms | accepted |

  These are environment-specific timings, but a <0.6 MiB source causes a ~14.7-second synchronous freeze in the isolated runtime. The work is newly introduced in R7; the old host-node filter was linear.
- **Smallest remedy:** Scan source nodes **once** into `Map<lightIndex, hosts[]>`, then walk the light table and apply the same zero/multiple-host checks (`O(nodes + lights)`). **Test:** a many-light under-4 MiB case plus an operation-count or relaxed scaling assertion; retain orphan/multiple-host correctness tests.

## Old findings and spec notes — second-pass disposition

| Previous item | Status | Evidence |
|---|---|---|
| **M1** light/node index collision | **Fixed** | `graph-import.js:253–289,617–668` gives light-table hosts and distinct `mapping.lights`; `graph-import-panel.js:249–260` retains separate selections. `graph-import.test.js:579–701` exercises different mapped targets through the **real adapter**. New performance issue is S2, not the original silent collision. |
| **M2** `BEGIN IMMEDIATE` mistaken for offline check | **Partly fixed** | Server now holds a lifetime file lock, both scripts inspect it; but no script holds an exclusive claim while operating, and stale recovery is racy (new M1). Known F6 also remains. |
| **S1** unbounded socket identifiers | **Partly fixed** | Node/event socket maps and wired socket names now bounded in both copies; declaration socket maps are omitted (reproduced S1). |
| **S2** huge File allocated before size check | **Fixed** | `graph-import-panel.js:122–136` checks `file.size` before `arrayBuffer()`, parser still checks bytes. `graph-import-panel.test.js:356–389` tests a throwing oversized reader and exact-boundary read. |
| **N1** node name console log injection | **Fixed** | `behaviors-export.mjs:36` defines `quoteName` via `JSON.stringify`, used by both scripts for node/world names; `behaviors-rollback.test.js:382–429` asserts line counts and escapes. |
| **Spec 1** bare hover was erroneously implied storable | **Fixed** | Rev 1.5 splits core and extension unsupported ops and states validator rejects bare hover; accepted `KHR_node_hoverability` form stays inert. |
| **Spec 2** string policy underspecified | **Specified, incompletely enforced** | R-L3/Rev 1.5 G7 explicitly includes identifier, pointer and prose rules; code omission of declaration socket maps remains S1. |
| **Spec 3** exclusive lock undefined | **Specified, incompletely enforced** | R-L2 defines lifetime file lock, `BEGIN IMMEDIATE` atomicity only. R8 implementation does not provide true mutual exclusion throughout rollback (M1). |

## R6–R17 contract / proof audit

**Proof qualification:** For every named proof below, I evaluated whether the supplied test appears to detect the described reverted defect **from the test's assertions and the implementation**. I did **not** execute sabotage commits or the full test matrix; no claimed fail/green output is independently certified.

| Item | Code/coverage judgment | Would its named test detect the stated regression? |
|---|---|---|
| **R6** browser timer invocation | **Implemented:** `adapter.js:261,284` saves `table.setT` to a local and calls it unbound; clear/interval use local functions. `fake-world.mjs:39–53` adds receiver-sensitive fakes. | **Yes, for `table.setT()` reverted:** the injected fake throws `Illegal invocation` during the existing delay/`done` test (c5). Browser proof itself not rerun. |
| **R7** light namespace | **Original correctness fixed, S2 introduced.** Independent node/light mapping and real-adapter distinct-target test present. | **Yes:** `graph-import.test.js:579–625` and panel test `314–350` reject the former collision (f4), although no scalability test exists. |
| **R8** lifetime lock | **Partial:** fully formed live locks refused, but non-atomic check and stale-recovery races remain M1. | **Yes for removing `assertServerStopped`:** live-holder test `server-lock.test.js:90–132` would fail; **no** proof covers startup/check interleaving or concurrent stale removal. |
| **R9** stored-string policy | **Partial:** node/event socket keys and literals checked, but declaration maps missed. Shared constants and vectors exist. | **Yes for reverting implemented node-key guard; no** for missing declaration-map checks (S1). |
| **R10** pre-read file cap | **Fixed.** The panel checks `file.size` before reading. | **Yes:** oversized reader at `graph-import-panel.test.js:356–389` deliberately throws if read; exact 4 MiB input is read. |
| **R11** escaped operator log names | **Fixed.** Both scripts use `quoteName`. | **Yes:** `behaviors-rollback.test.js:382–429` asserts no injected lines and escaped world/node names. |
| **R12** three coverage gaps | **Addressed.** `(b3)` real socket send replaces a leaf at 1 MiB, `world-total.test.js:246–274`; `(f)` variable initial literal and real-adapter write log, `graph-import.test.js:708–751`; `(d3)` refused write leaves next revision at 1, `runner-g4.test.js:166–183`. | **Yes** for each specified code break, from the assertions. Failure outputs not independently observed. |
| **R13** hung world-total proof | **Plausibly fixed:** `world-total.test.js:48–59,71–76` tracks/terminates every WebSocket, kills child processes and closes server handles in `after()`. | **Likely:** cleanup is registered outside the failing assertion, so a failing b2 assertion should exit rather than hang. Cannot verify elapsed time without running proof. |
| **R14** heal log id | **Fixed:** `world-registry.js` passes DB world ID to document loader; `world-total.test.js:456–485` asserts the abbreviated hexadecimal ID. | **Yes:** omission returns `-`, which the assertion rejects. |
| **R15** card handoffs | **Not independently verifiable** from code tree; this is board/process metadata, not program behavior. | **No program test**; requires inspecting card bodies and completion metadata in the task system. |
| **R16** readable grant names | **Component fixed** in `graph-import-panel.js:91–98,439+`; panel test `395–413` passes a working `nodeName` fake. **Actual app wiring is known F5:** `app.js:3222,3268` misreads `resolveObjectId()`'s `{node}` return and displays IDs. | **Only tests component**, not the real app wiring. This omission explains known F5; not reported as a new finding. |
| **R17** four Rev 1.5 notes | **Present:** hover extension wording, the G7 string policy, lifetime-lock meaning, unbound host functions. R-L4 check-4 clarification and R-L5 manifest note also present. | **Documentation/process**, not a mutation-test obligation. Practical completeness is limited by M1/S1. |

## Additional requested checks

- **F5 (already known):** `app.js:3222,3268` misreads `{node}` and therefore the grant line and Q3 prompt fall back to raw IDs. I checked other relevant consumers: `packages/behaviors/src/runner.js:156–159,269–273` dereferences `.node`; `apps/client/src/behavior-clips.js` accepts `{node}` and extracts it. I found no additional misread in those callers. The latter's fallback also tolerates a direct node value, returning `none` when given `{problem}`.
- **F6 (already known):** A pre-4d (4c) server has no lifetime lock to detect; `resolveDbPath()` / both scripts normalize DB paths using `resolve()` rather than canonical `realpath()`. Both bypasses still apply. The new M1 lock race remains even without symlinks and even when every server is 4d.
- **Rule parity:** The actual client and server validator copies agreed on the declaration-socket key probes (both wrongly accept). Their implemented node/event socket policies and shared constants appear parallel; no additional differential verdict established.
- **Importer original correctness:** Real-adapter tests cover distinct light and node writes, multiple lights, orphan and duplicate hosts, and the original single-host case. Checked; original silent retargeting not found.
- **Rollback classifications and idempotency:** Existing `behaviors-rollback.test.js:182–243` contains dry-run unchanged/restore/conflict and second-apply-zero-writes assertions. I could not independently run its scratch-DB execution. The locking defect is separate from the classification algorithm.

**Acceptance:** Fix M1 and close S1/S2, retain F5/F6 on the outstanding DEV acceptance list, run the actual Node 22 matrix and browser checks, and exercise a concurrent rollback/startup regression rather than relying solely on a live-lock-at-start test.
