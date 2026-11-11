# Passdown 2026-11-11: `grouping` shipped to PROD (`b37c4823`)

This supersedes `Atrium-Passdown-2026-11-08-selection-parts-shipped.md` as
the starting point. Read this file first. That passdown's rules and lessons
still hold, and so do the host, connector and convention notes it points to
(`Atrium-Passdown-2026-11-06-richer-add-shipped.md` §3, §4). This file adds
to them.

**First instruction for the next session's Claude:**
1. **Get the repo.** Use `add_repo` on `joshmaurice/atrium` with access
   `push`, clone to `/home/claude/atrium`, and read this file.
2. **The next release is `touch-nav`, and it is already built** (§4). It has
   its own session, branch and handoff (`devtasks/HANDOFF-touch-nav.md` on
   `claude/touch-nav`). Its release runs from that session, or from a session
   that starts from its handoff.
3. **Use the `atrium-ops` connector** (read-only) for board, release, log and
   git state. Check DEV's actual SHA with `release_status` before reading an
   acceptance as done.
4. **These rules are unchanged:**
   - the release rule;
   - the cost rule;
   - the host-command rule: no leading spaces, real SHAs, never
     placeholders;
   - the review-SHA rule.

## 1. Where things stand
| | |
|---|---|
| **PROD, MAIN, DEV** | **`b37c48230baa9423a49c38251331a1c2905cf6d8`**, state `COMPLETE` (2026-11-11, 12:43 PT). PROD serves the same `app.js` as DEV (`a51495848ce6`). MAIN fast-forwarded `172b816..b37c482`; the DEV gate merged nothing. |
| **The round** | `grouping`: **Group**, **Ungroup**, **Move to…** and an **Empty groups** dropdown in the Edit panel. Each keeps world placement, and each is one Undo entry with exact values. |
| **The record** | `devtasks/PREBRIEF-grouping.md` (FINAL Rev 2.0), `HANDOFF-grouping.md` (§1–§9), `RELEASE-grouping.md` (the commands, the acceptance steps and the release notes), and the reviews in `devtasks/`: `REVIEW-grouping-code-fable.md`, `REVIEW-grouping-code-fable-r2.md` and `spike-grouping/code-check/REPORT.md` |

## 2. What the round added
- **The wire:**
  - a `send` with `field: 'parent'`, whose value is
    `{parent, translation, rotation, scale}`. The server applies it
    atomically and broadcasts it as a `set`;
  - `ADD_FIELDS_LEVEL` is 4.
- **The server's rules:**
  - GR3: the order of checks, with no model as a parent;
  - GR4: bounds of 256 nodes, 8 generations and 1,024 primitives;
  - GR-L10: no change of which behaviours may move an object;
  - GR-L12 (a): a stale tab is refused at Connect.
- **The client:**
  - applies a move only on the server's answer;
  - `som:reparent` cancels a drag on the moved node;
  - composite Undo entries (`edit-undo.js`'s runner, with phases and
    re-pointed handles), and "Ungroup (partly)" when only some parts move.
- **The Model form's Save** waits while an edit is in flight. That was
  `model-form.js`, changed outside the contract's file list with the
  operator's go.

## 3. Lessons from this round
1. **The harness checks with a real mouse and two tabs found three bugs the
   unit tests missed** (HANDOFF §3):
   - a stale Move to list in a focused select;
   - a cancelled drag recorded in the Undo stack;
   - Empty groups not following another tab's changes.

   Write those checks before the reviews.
2. **The fresh-agent code check found the one must-fix:** the Undo engine
   could stay in flight when a later structural step lost the tracker's slot
   (HANDOFF §7). Run that check on every round.
3. **A reviewer that can't run code reviews half as well.** The first Fable
   5.2 session was refused execution by its permission check. A second
   session, asked up front to run the tests, ran everything.
4. **`proofs.py`** (`devtasks/harness/checks/grouping/`) breaks each of 38
   mechanisms in turn and runs its test. It caught two tests that couldn't go
   red and one that hung instead of failing. Reuse the pattern.
5. **The glTF-Transform `assert.equal` trap** (AGENTS.md) bit again, through
   a `JSON.stringify` in an assertion message: keep messages cheap.
6. **Before stating what the product has, look in the code.** A spoken
   answer that the Edit panel has a colour control was wrong.

## 4. Next: `touch-nav` (built, reviewed, not released)
- **The round:** touch navigation on Android Chrome: a virtual stick, touch
  look, pinch in ORBIT and a first-person button.
  - **Branch:** `claude/touch-nav`, based on `b37c482`, which is now `main`
    and PROD. No rebase is needed.
  - **Contract:** `devtasks/PREBRIEF-touch-nav.md` Rev 1.5. The operator
    chose to build first (TN-L0 (a)), so it is not a FINAL pre-brief reviewed
    before building.
  - **Checks:** a fresh-agent code check, then three Fable 5.2 code reviews,
    the third APPROVE WITH NITS (its handoff §5–§8).
- **Its handoff's §9** proposes a phone layout as its own round.
- **The other candidates the grouping session left** are in
  `NOTE-2026-11-10-grouping-unreleased-next-round.md`:
  - **Multi-select:** Shift-click, and Group of several objects.
  - **Materials in the Edit panel:** a colour control, a notice that a
    material is shared, and "make this one unique".
  - **The texture limit:** 512 MiB of decoded textures per world in the
    page, in `model-parse.js`. Unconfirmed: deleting a model may not give
    its share back until a reload. Investigate before stating it.

## 5. Grouping's follow-ups (none blocking)
- **Caching `ungroupHint`'s plan:** measured at 0.1 ms in atrium.gltf and
  about 1 ms for 249 rotated parts (review S-2, HANDOFF §8).
- **N-3:** a custom graph that writes an object's transform makes its Group
  entry "changed elsewhere". This is stated in the release notes.
- **Pre-brief §6's release note** still says "disconnected at the first
  regroup". The truth is "refused at Connect", as `RELEASE-grouping.md` says.
- **No outline for a selected empty group** (only its handles show), and the
  other §8 items of the pre-brief.

## 6. Cleanup (the operator, on the host)
Once this passdown is on `main`:
```bash
git -C /root/.hermes/sandboxes/docker/default/workspace/atrium push origin --delete claude/grouping
```
Leave `claude/touch-nav`: it is the next release.
