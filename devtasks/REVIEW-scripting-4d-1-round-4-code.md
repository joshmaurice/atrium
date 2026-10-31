# Atrium scripting-4d-1 — round 4 focused outside review

**Verdict: NO-GO for DEV acceptance.** Read-only review of `769825ce3781b5bb4de03f4d7687b37cd9f0d46a..85669db0f8a9c97f98a1c3b54293f7d7105cf642` (four commits). The deployed `1d4ccf17e62e9a94bb577d9c8ee694439a57c44b` differs only in `devtasks/`, per the GitHub compare. The prior R22/R23/R24 problems are substantially addressed, but two narrower lock flaws survive.

## Execution and scope

The clone failed with `Could not resolve host: github.com`. Node 22.16.0 is available; `pnpm` is not installed. I **could not run** `pnpm install --frozen-lockfile`, the package tests, or the per-server-file tests; **no independently run suite counts**. Source inspection used the pinned GitHub connector; independent probes used Node 22 filesystem path behavior, Python SQLite 3.46.1, and root/non-root Linux processes. The two findings are **reproduced at the filesystem/SQLite level, inferred as end-to-end Atrium effects**, not tested through its `better-sqlite3` process. Source/test assertions were inspected, and published DEV results checked separately (not passed off as my test runs).

## Must-fix findings

### M1 — First boot through a dangling database symlink changes lock identity mid-run (R19/R22)

**At:** `packages/server/src/server-lock.js:60–77`; server acquisition `packages/server/src/index.js:66–94`.

**Input/sequence:** `alias.db` is a symlink pointing at the still nonexistent `real.db`. The first server calls `canonicalDbPath(alias.db)`. `realpathSync(alias.db)` fails; the fallback chooses `alias.db` itself. Thus it takes `alias.db.lock.db`. Opening the main SQLite DB via `alias.db` creates `real.db`. A second server, started with the **same alias path**, can now realpath it and take **`real.db.lock.db`**. The two locks are distinct even though both servers open the same SQLite database.

**Reproduction:** Executed the source-equivalent `canonicalDbPath` logic in Node 22 and showed its pre-creation selection; used SQLite with an actual dangling symlink to show that opening the alias creates its target, then successfully acquired `BEGIN EXCLUSIVE` on both lock databases concurrently and opened the same main database. Not an end-to-end two-Atrium-server test.

**Fix:** Follow the last-component symlink even if its target is not yet present; resolve/canonicalize its target's existing parent and basename, with appropriate loop detection. Add a test that first boots on a dangling DB symlink and then attempts a second start using the same alias *after* the first created the database. The current R19 tests all create the real database before testing aliases, so they miss this.

### M2 — Root-owned `-journal` after SIGKILL can prevent service-user lock acquisition (R22)

**At:** `packages/server/src/server-lock.js:163–174, 209–247`.

**Input/sequence:** The main database belongs to the service user (UID 65534, mode 0640) in a **root-owned sticky directory (1777)**. A root-run script first creates the empty `<db>.lock.db`, issues `BEGIN EXCLUSIVE`, and invokes `matchDatabaseOwnership()`. SQLite creates a `<db>.lock.db-journal` file (observed 512 bytes, root-owned 0644); the code corrects only `.lock.db` and `.lock.json`. Kill the root holder with SIGKILL before rollback. The service user can now access `.lock.db` but cannot delete or rewrite root's `-journal` under the sticky-directory restrictions. Its `BEGIN EXCLUSIVE` fails with `sqlite3.OperationalError: disk I/O error`; the Atrium server would refuse to start after SQLite emits the equivalent failure.

**Reproduction:** Ran real SQLite 3.46.1 as root, SIGKILL'd the holder, and attempted acquisition as UID 65534 under a root-owned 1777 directory: failed with the above error, even though ownership of `.lock.db` and sidecar had been corrected. Repeated in a UID-65534-owned 0700 directory: recovery succeeded. Not an executed `better-sqlite3` test, but an actual on-disk SQLite failure.

**Fix:** Prefer initializing the lock database to a stable nonempty SQLite database before a lock transaction: on the same SQLite version, a nonempty initialized DB's `BEGIN EXCLUSIVE` did **not** create a journal because no data was written. Account for concurrent first initialization. Alternatively ensure journal creation/ownership/recovery is safe across crash boundaries and sticky directories without breaking the decided SQLite lock protocol. Test a root script killed with SIGKILL followed by service-user acquisition, including a sticky directory; the current `server-lock.test.js:313–385` tests a clean root release and not a crash with a journal.

## Known F7: planned fix assessment

**At:** `packages/server/src/index.js:84–92`. The SIGTERM handler exits `143`, which systemd reports as failure; this is already known, not rediscovered here. **Dropping both SIGTERM/SIGINT handlers is appropriate**, assuming service stop is by those signals and kernel lock release is relied upon. The OS releases SQLite file locks on termination; the server's `exit` listener may not run under default signal termination, but nothing else in these handlers closes the HTTP server, world registry or main database gracefully today. The main SQLite DB retains ordinary crash-recovery semantics. The risk from the leftover lock-database rollback journal under unusual directory ownership is M2, not a reason to retain status 143. Test signal-terminated exit status and systemd `inactive`, and correct the runbook's `is-active` expectation if necessary. An alternative is a clean-release handler that exits zero, but the proposed removal is sound after M2 is addressed.

## Other observations and ruled-out concerns

- **Core R22 exclusion:** `server-lock.js:209–250` uses a `better-sqlite3` connection, `timeout: 0`, `journal_mode=DELETE`, `BEGIN EXCLUSIVE` held through return. `index.js:76–94` and both rollback CLIs take it before opening the main database. Script exit/failure paths release it, and OS close applies on crashes. I confirmed via SQLite that two contenders cannot both acquire **the same** lock DB; `BEGIN EXCLUSIVE` on an empty DB really does acquire the lock. The sidecar at `server-lock.js:104–150` affects refusal wording only; no lock decision depends on its contents. The `journal_mode=DELETE` choice matters: per SQLite documentation `BEGIN EXCLUSIVE` and `BEGIN IMMEDIATE` differ outside WAL mode. Source does not check the returned PRAGMA mode, but this was not independently demonstrated to fail with this code and does not rise to a finding.
- **Portability qualification:** SQLite coordinates using OS/VFS locking (POSIX advisory locks on typical Unix systems and platform file locks on Windows); cooperation relies on a correctly locking filesystem. SQLite documents broken/missing locks on some network filesystems, especially NFS: https://www.sqlite.org/howtocorrupt.html . It is sound for a local VPS filesystem, not an unconditional promise across mounts/platforms. Hard links and alternate mounts are excluded by settled R-L6(a), as specified.
- **Root-created main lock and sidecar:** The ownership copy after acquisition addresses ordinary cross-user clean stop on a suitable database directory. M2 captures the missing root-created *journal* crash path.
- **`testLockHoldHook`:** `server-lock.js:182–192` returns immediately when `ATRIUM_TEST_LOCK_SIGNAL` is absent, so it is inert in normal production. It is synchronous and can block up to 60 seconds if the environment variable is accidentally set; this is an opt-in test facility with operational caveat, not a separate acceptance blocker.
- **R23 string rules:** `behavior-spec.js:405–458` and `send-policy.js:827–877` now walk both declaration socket-key maps as well as node socket maps, variables, event values and pointer literals. I ran the **actual fetched validator and both copies** in an isolated JS harness; both accept valid 64-char extension output names and refuse 65-char, control/newline and punctuation cases for input/output, with the same `behavior-type` verdict. No remaining omitted G7/R-L3 socket-string place established.
- **R24 importer:** `graph-import.js:267–289` builds `hostsByLight` in one node pass and walks the table once. The original zero-host and multiple-host rejection texts are unchanged. Existing tests cover both, plus two distinct light hosts; `graph-import.test.js:708–735` adds a 20,000-light scale assertion. The prior source-sized quadratic light matching is fixed. Other graph-reference traversals may repeat work over a bounded maximum 256 graph nodes, but I found no comparable unbounded source-node × light-table nested loop in the round-4 delta.

## R18–R24 delivery assessment

| Item | Assessment and evidence |
|---|---|
| **R18** | **Delivered.** `object-name.js:21–25` reads `resolveObjectId(id)?.node?.name` and falls back to id; both `app.js:3223,3269` callers use the helper. `object-name.test.js` exercises a real SOM, including ambiguity and unaddressability; panel and Q3 tests use it. |
| **R19** | **Partly delivered.** `canonicalDbPath` collapses symlinks to an **existing** target and symlinked parent directories; tests at `server-lock.test.js:392–491` cover them, but **M1** misses dangling symlinks on first creation. |
| **R20** | **Delivered.** `PREBRIEF-scripting-4d.md` Rev 1.6 has the §0.6/G10/G7/G6/Q3 and rollback-procedure notes. Known F7 makes the `systemctl is-active` instruction incorrect until updated. |
| **R21** | **Implemented/reported, not independently verified.** Named tests and proof-sensitive assertions exist. The published DEV README reports R18/R23/R24 PASS, 34/34 browser check 1/4/7/8, and 27/27 local rollback checks; I did not independently run the package suites, fault mutations, or task-board handoffs. R19/R22 proofs do not cover M1/M2. |
| **R22** | **Partly delivered.** All three actors hold the same SQLite lock for the normal path and sidecar is diagnostic only; `server-lock.test.js:142–385` checks mutual exclusion, SIGKILL, stale sidecars and normal cross-user ownership. **M1 and M2** remain outside the tested cases. |
| **R23** | **Delivered.** Both rule copies include declaration socket maps and return equal verdicts on actual isolated validation probes. Regenerated shared vectors and tests cover required boundaries. |
| **R24** | **Delivered.** Linear pass and unchanged orphan/duplicate-host refusals, 20,000-light test and browser measurement reported. |

## Recommended acceptance condition

Fix M1 with a missing-target symlink regression and M2 with a root-SIGKILL-to-service-user recovery regression; apply and verify the already-planned F7 signal-handler correction and its runbook update. Then run the per-package/per-server-file suite and the targeted rollback/browser checks at the final SHA. No reason to reopen R-L6, R-L7 or R-L8 decisions.
