## Atrium scripting-4d-1 — Round 6 Review

GO WITH NITS — DEV acceptance

Reviewed: `e536913011cc72bd6bad845f76d638bea843ddc1..fe4dcbb34ed7f6b9b4d2e13d83f0d209e5903189`

Conclusion: My round-5 must-fix is addressed. The revised path handling preserves the database's identity across the symlink layouts I tested, and the startup error handling is corrected. I found no new must-fix or should-fix defects.

### Findings

Must-fix: None.

Should-fix: None.

Nit N1 — One end-to-end test does not reproduce the exact original failure

File: [packages/server/test/server-lock.test.js:729–745, 815–838](https://github.com/joshmaurice/atrium/blob/fe4dcbb34ed7f6b9b4d2e13d83f0d209e5903189/packages/server/test/server-lock.test.js?utm_source=chatgpt.com#L729-L838)

The `splitLayouts()` helper's `review` case starts the server through `real/child/alias.db`, rather than through `linkdir/alias.db`.

That distinction matters: the former did not exhibit the round-5 bug; the latter did.

I reproduced that difference using the round-5 canonicalizer:

| Database spelling     | Round 5 before/after creation |
| --------------------- | ----------------------------- |
| `real/child/alias.db` | Same lock path                |
| `linkdir/alias.db`    | Different lock paths          |

The separate six-layout invariant test correctly includes `linkdir/alias.db`, and Claude's reported DEV checks also exercise the actual failing layout.

Disposition: Non-blocking test-coverage nit. Change the end-to-end helper to use the symlinked-directory spelling so it independently catches the original two-server failure.

Evidence: Reproduced locally with Node 22.

### R30–R32 assessment

| Item                                  | Status                | Evidence                                                                                                                                                                                                                                                                  |
| ------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R30 — Kernel-style symlink resolution | Delivered             | `server-lock.js:104–147` uses `realpathSync.native` and preserves `..` in symlink targets. My isolated Node 22 probe tested 30 layouts: 29 valid layouts matched before and after creation; one was not openable by the filesystem. Both original failing layouts passed. |
| R31 — Guarded startup refusal         | Delivered             | `index.js:70–85` moves the legacy-lock check inside the startup `try`. A symlink loop is caught and reported with the standard refusal prefix. Verified from source.                                                                                                      |
| R32 — Rev 1.8, suites, proofs         | Delivered as reported | Rev 1.8 and the regression tests are present. The published DEV results report 6/6 path layouts, successful live-holder checks, 10/10 previous probes, 27/27 rollback checks and 34/34 browser checks. I did not independently run the repository suites.                 |

### Additional observations

Starting with `resolve(dbPath)` is appropriate because the server and scripts already normalize the configured path before handing it to SQLite. After that point, preserving `..` inside symlink targets is essential. The implementation now makes that distinction correctly.

`realpathSync.native` is supported in Node 22. One portability caveat: Node documents that on Linux with musl libc, `/proc` must be mounted for this API. That does not affect the stated Ubuntu/glibc deployment.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://r2.nodejs.org\&sz=32)

Node.js v22.23.4 Documentation



I confirmed the release comparison contains only `devtasks/` changes beyond the reviewed code.

Test limitation: The container still could not clone GitHub, and `pnpm` was unavailable. I tested the exact canonicalization logic in isolation, rather than running Atrium's test suite.

Recommendation: Accept round 6 on DEV. The remaining test nit can be handled separately; I see no reason for another implementation round before acceptance.