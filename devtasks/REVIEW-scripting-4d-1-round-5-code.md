# Atrium — scripting-4d-1 round 5 outside review

**Verdict for DEV acceptance: NO-GO.** One new must-fix in R25; no should-fixes; one nonblocking nit. This is a review **only** of `85669db0f8a9c97f98a1c3b54293f7d7105cf642..e536913011cc72bd6bad845f76d638bea843ddc1` (two commits). R-L9 (a), `journal_mode = MEMORY`, remains settled. No branches or deployed environments were changed.

## Findings

### Must-fix M1 — R25 still splits one database into two lock paths when the dangling symlink's parent is itself a symlink

**Code:** `packages/server/src/server-lock.js:76–115`, specifically **L102**. **Reproduced** on Node 22 with the exact function body; concurrent acquisition of the two resulting SQLite lock databases also reproduced using SQLite.

Set up this path topology, with the main database initially missing:

```text
root/
  linkdir -> real/child
  real/
    child/
      alias.db -> ../target.db
    target.db  (missing)
```

A first server starts with `ATRIUM_DB_PATH=root/linkdir/alias.db`. The actual symlink points to `root/real/target.db`, but the R25 fallback calculates `resolve(dirname(path), '../target.db')`, which lexically strips `linkdir/..` *before* following `linkdir` to `real/child`. It therefore picks **`root/target.db.lock.db`**, an incorrect lock. The server opens the main database via `alias.db`, creating `root/real/target.db`. A second start through the **same** alias now succeeds at `realpathSync(root/linkdir/alias.db)` and selects **`root/real/target.db.lock.db`** instead. Both exclusive transactions can coexist because they are on different files, although the two server processes open the same actual database.

Observed:

```text
before database creation: root/target.db.lock.db
 after database creation: root/real/target.db.lock.db
both distinct SQLite BEGIN EXCLUSIVE locks acquired simultaneously: yes
```

**Remedy:** Before resolving a relative `readlinkSync()` target, canonicalize the symlink's containing directory (`realpathSync(dirname(path))` when it exists), then interpret the relative target from that physical directory. Keep the hop cap and existing fallback behavior. Add a first-boot regression test with a **symlinked parent**, a final-component link whose relative target contains `..`, and a target not yet created. Start server A through the alias and prove server B through that *same alias* refuses after A creates the database; also compare with the real target and both scripts. Current R25 tests cover a dangling relative link and a symlinked directory **separately**, not this combination (`packages/server/test/server-lock.test.js:439–484,596–687`).

### Nit N1 — a symlink loop emits an uncaught stack trace rather than the server's refusal prefix

**Code:** `packages/server/src/index.js:70–81` and `packages/server/src/server-lock.js:93–95`. **Inferred** from the source and corroborated by the DEV team, not independently run as an Atrium server.

`legacyLockExists(dbPath)` runs before the `try` around `acquireLock()`. A loop (`a.db -> b.db -> a.db`) makes `canonicalDbPath` throw, and that error escapes uncaught, so the startup emits Node's stack trace rather than `Atrium server refuses to start: ...`. It still exits nonzero, before loading the main database and **before taking any unsafe lock**, so this is cosmetic/fail-closed, not another NO-GO reason. Move the legacy-file diagnostic into the guarded startup sequence (or guard just that diagnostic). The current test asserts nonzero exit and text matching `too many levels of symbolic links`, not the prefix (`server-lock.test.js:689–705`).

No other must-fix or should-fix found in the delta.

## R25–R29 disposition

| Item | Status | Evidence |
| --- | --- | --- |
| **R25** — dangling symlinks | **PARTLY** | Plain dangling symlink, relative target and two-hop chain are implemented and covered (`server-lock.js:76–115`, tests `:596–687`). Combined symlinked directory + `../` breaks canonical identity (M1). Loop refuses but diagnostics are a nit. |
| **R26** — in-memory lock journal | **DELIVERED** | `server-lock.js:266–286` reads back `journal_mode = memory` before `BEGIN EXCLUSIVE`. SQLite 3.46.1 local probes: no new `-journal` file, second connection gets `database is locked`, lock released on exit; the earlier root-owned `DELETE`-mode journal did **not** prevent a non-root `MEMORY`-mode acquisition. The old root-owned file may remain in a sticky directory (historical artifact, not a new journal or blocking failure). Tests `:711–772`; DEV's 11/11 probe includes the root-crash case. |
| **R27** — signal termination | **DELIVERED** | `index.js:84–95`: removed handlers returning 143/130, retained `exit` hook. The kernel lock does not depend on the handlers; tests `server-lock.test.js:778–802` assert signal exit and immediate reacquisition. |
| **R28** — Rev 1.7 and stale comment | **DELIVERED** | `db.js:19–25` comment corrected; pre-brief Rev 1.7 and step-3 operating note present. |
| **R29** — suites, proofs, handoff | **REPORTED / NOT INDEPENDENTLY VERIFIED** | Tip and two commits confirmed; commit `75391007` reports red/green mutation proofs (r25/r26/r27), `e5369130` reports full suites. GitHub DEV README reports `probe_r5.sh` 11/11, `c11.py` 27/27, `c1.py` 34/34, `c5.py` pass. Those checks don't cover M1's combined path topology. |

## Test and release limitations

- `node v22.16.0` is present, but `pnpm` is not installed and a `git ls-remote`/clone attempt failed with `Could not resolve host: github.com`; therefore **zero server test files were executed locally**. The reported suite counts above belong to Claude's host/DEV checks, not to this reviewer.
- Source and the contract were read from the pinned GitHub refs via the GitHub connector. GitHub compare confirms exactly **2 commits and 5 changed files**, of which 4 are shipped or test files and one is `devtasks/PREBRIEF-scripting-4d.md`. The release merge `ddef0a31f3a484453d0ed5dd28353ffff35a4842` adds only `devtasks/` files relative to reviewed tip `e5369130`.
- Isolated probes executed locally: Node 22 path resolution with the exact R25 function, simultaneous SQLite lock acquisition on the two resulting distinct files, SQLite `journal_mode = MEMORY` exclusion (second connection refused, no new journal), and a cross-user round-4 orphan journal → round-5 memory mode acquisition (service UID 65534 succeeds on SQLite 3.46.1, though the old root-owned journal can remain). These are **not** the complete Atrium startup/tests.
