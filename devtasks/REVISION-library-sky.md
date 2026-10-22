# Revision — library-sky round 2 (after Claude's browser checks of `a94d56a9`)

**Status:** for the operator's approval (2026-10-22, ~17:10 PT).
- **Base:** the reviewed round-1 tip
  `a94d56a98998b6eb7f1708499abc22166f01cec0` on `workflow/library-sky`.
  Round 2 commits on top of it, on the same branch.
- **DEV:** runs its release merge `cf8858fe`. That is **not accepted**:
  the acceptance gate `t_dd93bfc2` stays blocked and is superseded by round 2's.
- **The spec still governs:** `devtasks/PREBRIEF-library-sky.md`, FINAL
  Rev 1.1, sha256 `9c89ba58…12c31ee`, with the brief `t_9a76f6f2` and the
  brief-gate corrections on `t_16f2a65e`. This file adds V1–V3 and nothing
  else.

## 1. What the browser checks found

Claude's §5.1 checks ran in a local headless harness. They used the published
code, and a library generated in the production format by
`scripts/library-build`.
- **Result:** 11 of 14 pass. Placement, the texture budget, skies, renames,
  repeated `world:loaded`, the server's rule, two owners, cross-origin, and
  the SOM Inspector all work.
- **Three failures,** each confirmed in the code at `a94d56a9`:

| # | Symptom | Cause |
|---|---|---|
| V1 | **The Library grid never appears.** After **Library**, the grid is logically open (`isOpen()` true, tiles in the DOM), but `#library-grid` stays `display:none`. With it forced visible, everything else in Z2 works. | `index.html` L663 creates it hidden. `app.js` L1495 looks up `libraryGridEl` and never uses it. `createLibraryGrid`'s `open()`/`close()` (`library-grid.js` L191–216) change state and re-render, but never show or hide the element. |
| V2 | **A refused or failed sky is never logged.** A document-relative sky, an oversize PNG and a 404 leave the console silent. The reason shows only in the owner's Edit panel. | Neither `createSkyLoader` nor `app.js` logs a failure. Z4 says visitors' "console has the reason". |
| V3 | **The picker loses failures.** (a) The owner who picks a failing sky gets no reason and no Retry. (b) A Retry that fails again hides the reason and the Retry button until the world changes. (c) A later World Info change replaces the specific reason with a generic one. (d) Retry is offered for a value refused by rule, where it can never help. | (a) `sky-picker.js` `change()` drops `sky.update(...)`'s result. (b) `retry()` clears `failure` first, and `app.js` L3110 drops the promise `retry()` returns; `onRejected`'s `sky.update` is dropped too. (c) `load-background.js` L213: the `failedUrl` shortcut returns `{reason: 'failed'}` instead of the original reason. (d) No distinction between retryable and rule refusals. |

**Not in scope (recorded):**
- **A raw send that's refused isn't rolled back.** A non-picker World Info
  send that the server refuses leaves the sender's SOM holding the refused
  value. That is how the client already handled raw sends.
- **"Custom" on another origin.** A viewer on another origin sees a catalog
  sky as "Custom", because the stored URL is absolute on the first origin.

## 2. The contract (round 2)

### V1. The grid is shown and hidden with its state
- `createLibraryGrid` gets a `deps.setVisible(visible)` port, called with
  `true` from `open()` and `false` from `close()` and `reset()`, every time.
- `app.js` passes a port that sets `libraryGridEl.style.display` to `''` or
  `'none'`. It is the only place that writes that element's visibility.
- The grid's DOM, tiles and status line are otherwise unchanged.

### V2. Every current sky failure is logged, for everyone
- `createSkyLoader` takes `log` (default `console.warn`). On every failure it
  reports, it calls it once, as
  `[sky] <message> (<reason>) — <url or the refused value>`. That covers a
  current failure, a refusal by `resolveSkyUrl`, and the `failedUrl` shortcut
  the first time only.
- Superseded results and `{ok: true}` are not logged.
- This runs for every viewer, owner or not, Edit mode or not.

### V3. The picker shows every current failure, and Retry only when it can help
1. **Every call to the controller made by the picker or `app.js` sends its
   result to `skyPicker.onSkyResult`.** That means `change()`,
   `onRejected()`'s local update, `retry()`, `world:loaded` and `som:set`. Make
   `change()` and `retry()` return the promise and route it in one place, so
   no call site can drop it.
2. **`retry()` does not clear `failure` itself.** The result decides: success
   clears it; a failure shows the new reason and keeps Retry.
3. **The `failedUrl` shortcut returns the original failure's `reason` and
   `message`,** which the controller keeps with `failedUrl`. A rename therefore
   keeps the specific reason on screen.
4. **Retry shows only for retryable failures:** network, HTTP status,
   timeout, decode, or an image header that is unreadable or too large. It
   never shows for a refusal by rule: any `resolveSkyUrl` code or a
   non-equirectangular type. For those, the reason shows with no button.
   Export the retryable set from `load-background.js` so the picker and its
   tests use the same list.

### What does not change
Z1–Z5's other rules; the server; the catalog; the controller's generation
rules (R1–R7); the scene-slot ownership.

## 3. Tests and proofs (round 2)

| Area | New tests |
|---|---|
| Grid (V1) | `open()` calls `setVisible(true)`, and `close()`, `reset()`, Escape, Edit off and reconnect call `setVisible(false)`. A wiring guard reads `app.js` as text: it passes `setVisible`, the port writes `libraryGridEl.style.display`, and no other line writes it. |
| Controller (V2) | Injected `log`: called once per reported failure, with the reason code and URL. Not called for a superseded result, a success, or the second `failedUrl` hit. A refusal by rule is logged. |
| Controller (V3.3) | After a failure, a repeated `update` with the same value returns the **original** reason and message. |
| Picker (V3) | `change()` to a failing sky shows the reason and Retry, from the promise. A Retry that fails again keeps the reason and Retry, with the new reason. A Retry that succeeds clears both. A rule refusal shows the reason with **no** Retry. `onRejected`'s update result reaches `onSkyResult`. A wiring guard checks that `app.js`'s Retry handler routes the promise. |

**Proofs** (same rules as round 1: each break fails named tests, and "not
reproducible" is not an acceptable result):
- **(r1)** the `setVisible(true)` call removed from `open()`;
- **(r2)** the `log` call removed;
- **(r3)** `change()` dropping the update's result;
- **(r4)** `retry()` clearing `failure` before the result;
- **(r5)** the `failedUrl` shortcut returning `'failed'`;
- **(r6)** Retry shown for a rule refusal.

**And the whole round still passes:**
- full suites, with the same rules as round 1: server files one at a time
  under `timeout 180`, `packages/client` without `--test-force-exit`;
- **proofs (p1)–(p15) re-run** against the round-2 tip.

**Steps, one commit each:** (1) V2 and V3.3 in `load-background.js`;
(2) V1; (3) V3.1, V3.2 and V3.4 in the picker and `app.js`; (4) suites,
proofs, handoff.

**Before DEV acceptance:** Claude re-runs all 14 browser checks against the
round-2 tip.

## 4. Kickoff body for round 2 (post it verbatim as the revision kickoff card's text)

---

### KICKOFF — library-sky revision round 2. Slug: `library-sky`

You are the kickoff orchestrator for round 2 of `library-sky`. Build the graph
below, read it back, report, and stop. Do not implement, review or deploy
anything yourself.
- **Your tools:** only `kanban_*`.
- **Blocking:** never call `kanban_block` without an explicit `task_id`, and
  never block this card.
- **Titles:** use them exactly as written.

**Spec by git reference.** The contract is
`devtasks/REVISION-library-sky.md` on `main`, together with
`devtasks/PREBRIEF-library-sky.md` at `61c520acaa0308fa756d7fb0f652b109d2f1b77a`
(sha256 `9c89ba58810db689788959f64364c6298aa578079366321a27e80590e12c31ee`).
Read the revision with
`git -C /workspace/atrium fetch origin main && git -C /workspace/atrium show origin/main:devtasks/REVISION-library-sky.md`.
Its sha256 is posted on this card by the front door; check it, and block with
`kind="capability"` on a mismatch.

#### Graph
1. **`Implement r2 — library-sky`.** Assignee `atrium-deepseek`, parent: this
   kickoff, `--max-runtime 2h` (7200 s).
   - **Body:** the revision reference and hash check; continue
     `workflow/library-sky` from `a94d56a98998b6eb7f1708499abc22166f01cec0`
     in the existing worktree `/workspace/wt/library-sky` (`git -C
     /workspace/wt/library-sky status` must be clean at that SHA, or block
     `needs_input`); the revision's §3 steps, tests and proofs; the
     WORKER-CARD REQUIREMENTS comment (712 on `t_99c9de3d`).
   - **The handoff** carries proofs (r1)–(r6) **and** (p1)–(p15) re-run,
     with per-file counts and exit codes.
2. **`GLM review r2 — library-sky`.** Assignee `atrium-glm`, parent: card 1.
   - Its body opens with
     `THIS RUN HAS TERMINAL, FILE AND GIT TOOLS. Use them for every step below.`
   - The reviewer reproduces every proof itself and checks that every test in
     the revision's §3 table exists.
3. **`Review gate r2 — library-sky`.** Assignee `atrium-orchestrator`,
   parent: card 2. It creates nothing.
   - **On a valid APPROVE of the exact 40-character SHA,** it blocks with
     `APPROVE <SHA40>: front door, build the release chain`.
   - **Otherwise,** it blocks for the operator with the verdict quoted.
4. **Before you complete,** link card 3 to the existing sentinel `t_c944dbac`
   as a parent. Do not create a sentinel.
5. **The release chain** is the front door's, from the round-1 kickoff's
   templates (`t_99c9de3d`, comment 711) with the new SHA. Nothing reaches
   MAIN or PROD.

#### Report back
The three ids; the implementation's parent and its 7200 s cap; the review's
opening line; the gate linked to the sentinel. Then complete this card.

---
