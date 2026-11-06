<!-- Outside follow-up review (ChatGPT) of add-check round 2.1 at d56444c0, source-only (its clone failed on DNS).
     Pasted by the operator on 2026-11-05. APPROVE WITH NITS; the nits are recorded in
     Atrium-Passdown-2026-11-05-add-check-shipped.md section 6 item 4. -->

# Atrium `add-check` Round 2.1 — Follow-up Review

Reviewed commit: `d56444c0fec6e9c5c9aeff811a2c7abd93cacfe8`\
Parent: `302654c8bb990ef6a7674a693754d1cd9ec8f49d`\
Review type: Source-only, using the GitHub connector.

Clone: FAILED. Exact error:

```
fatal: unable to access 'https://github.com/joshmaurice/atrium/': Could not resolve host: github.com
```

I retrieved the pinned files through GitHub instead. The comparison confirms exactly one commit changing only `packages/server/src/autosave.js` and `packages/server/test/autosave.test.js`.

Verdict: APPROVE WITH NITS — `d56444c0fec6e9c5c9aeff811a2c7abd93cacfe8`

The four findings from my previous review are addressed correctly in the revised source. I found no new release-blocking defect in the two-file change. Approval is based on source inspection, not independently passing repository tests.

## Earlier findings

| Finding                                      | Disposition  | Evidence                |
| -------------------------------------------- | ------------ | ----------------------- |
| M1 — Unbounded flush wait                    | Fixed        | CONFIRMED IN THE SOURCE |
| S1 — Stopped save corrupts replacement entry | Fixed        | CONFIRMED IN THE SOURCE |
| N1 — Timing-dependent test                   | Partly fixed | CONFIRMED IN THE SOURCE |
| N2 — Read-back log resets too early          | Fixed        | CONFIRMED IN THE SOURCE |

### M1 — Promise lifecycle

`autosave.js:77–93, 208–261`

The important correction is that `entry.current` now represents one save, not the entire chain of follow-up saves.

A concurrent save request sets `again`, but a follow-up is scheduled separately. When a flush begins, `flushing` suppresses that follow-up and prevents debounce and periodic callbacks from starting saves.

The flush waits for the currently running save, then makes at most two attempts of its own. It no longer repeatedly awaits the same settled promise after `stop()`.

I found no ordinary path that starts two concurrent saves for the same active entry or leaves `entry.current` permanently set. Separate entries created after `stop()` can briefly have overlapping serialization/read-back work, but the obsolete entry cannot write to the database.

### S1 — Entry identity

`autosave.js:114–155`

After the awaited serialization and read-back, the code now checks:

```
if (worlds.get(worldId) !== entry) return
```

That check occurs before the database update, and the successful-save branch modifies the captured entry rather than looking up a replacement by world ID.

Because the database update is synchronous, a stop cannot interleave between the identity check and the write on the same event loop.

A stopped save therefore cannot overwrite the database after the check or clear a replacement entry's dirty flag. This includes stopping after serialization but before read-back completes.

### N2 — Read-back logging

`autosave.js:121–145`

The previous database row remains untouched when read-back fails. `readBackLogged` is now reset only when `updateWorld` succeeds, exactly as requested.

### Edits during saves

Generation tracking remains correct. A mutation during serialization or read-back increments `gen`; the older save cannot clear the dirty flag. A pending debounce, periodic save, or queued follow-up can subsequently write the newer state.

`flushWorld` also schedules a follow-up if the world remains dirty after the flush.

One qualification: `flushAndTeardown` intentionally has a finite retry budget. It cannot guarantee persistence of edits arriving after its final serialization snapshot. Normally teardown starts after all sessions leave, so this is not a regression in this patch. There is a separate, pre-existing possibility of a new session arriving while `world-registry.js:593–607` is awaiting teardown's flush; that registry path does not re-check sessions before closing the host. I would track that lifecycle race separately.

## Remaining nits

N1 — Nit: the stopped-save test still uses a fixed delay.

`packages/server/test/autosave.test.js:821–845`

Evidence: CONFIRMED IN THE SOURCE.

The test starts `coordinator.flushWorld()` without keeping its promise, then releases the held read-back and waits 50 ms before asserting that no write occurred.

It would be more deterministic to retain and await the original flush promise before checking the database. This also makes the test independent of runner scheduling.

The earlier debounce race test is improved: it now polls for the actual persisted result with a three-second bound. Its preceding 80 ms delay remains, but is not used to determine completion.

N2 — Nit: `within()` leaves timeout timers running.

`packages/server/test/autosave.test.js:706–707`

Evidence: CONFIRMED IN THE SOURCE.

`Promise.race` does not cancel its losing timeout. Even a successful flush leaves a two-second timer pending. A small helper using `clearTimeout` in `finally` would avoid unnecessary test-process delay.

Neither issue warrants blocking this patch.

## Tests and regression sensitivity

The new R2.1 tests are appropriately targeted:

| Test                                 | Expected failure on `302654c8`                 |
| ------------------------------------ | ---------------------------------------------- |
| Repeated failing saves during flush  | Timeout/failure                                |
| Stopped save followed by replacement | Old document written or replacement left clean |
| Stop while flush awaits save         | Hang/timeout                                   |

From the parent and tip source, the tests should detect the intended regressions. I did not independently execute the mutation comparison.

The revision reports `16/16` autosave tests and `3,864` tests across the repository, all passing. Those are the revision author's results, not mine.

## What I ran and couldn't run

| Activity                                        | Result                           |
| ----------------------------------------------- | -------------------------------- |
| `git clone`                                     | Failed: DNS resolution           |
| GitHub pinned comparison                        | Succeeded: one commit, two files |
| Pinned source inspection                        | Completed                        |
| Node version                                    | `v22.16.0`                       |
| pnpm                                            | Not installed                    |
| `timeout 180 node --test test/autosave.test.js` | Not run                          |
| Three R2.1 tests on parent commit               | Not run                          |
| Other repository test suites                    | Not run                          |

## Recommendation

Approve round 2.1 for the next DEV acceptance step, provided the operator's reported test runs are independently trusted by the release process.

The previous release-blocking autosave promise-chain problem has been resolved in the source, the stopped-entry guard is correctly positioned, and the read-back logging behavior is corrected. The remaining test nits can be addressed separately.