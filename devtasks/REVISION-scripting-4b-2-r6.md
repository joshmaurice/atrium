# Revision — scripting-4b-2 round 6 (the browser checks of round 5's published tip)

**Status:** DRAFT **Rev 0.1** (2026-10-25), for the operator's approval. Not
in force. Rev 0 (W1–W6) was approved at 13:07 PT but never started: the front
door was holding it for the outside review of round 5 and the security hotfix
that review led to. Rev 0.1 adds:
- **W0:** merge `main` (the hotfix, now on PROD) before anything else;
- **N1 into W5;**
- **W7 (N2)** and **W8 (the nits)**.

It also renumbers "What doesn't change" to W9. W1–W4 are unchanged.
- **Base:** round 5's published tip `c042ef5a581de161788d3f6132d9dacdadd1b352`
  on `workflow/scripting-4b-2` (GLM APPROVE, `t_3c03a44a`; published by
  `t_271332b8`; on DEV as release merge `e3d9ab14` by `t_52e0c377`). Round 6
  commits on top of it, on the same branch, in the existing worktree
  `/workspace/wt/scripting-4b-2`.
- **Round 5 is not accepted.** Its finalizer `t_78ba2e7f` and acceptance gate
  `t_fbb089d1` stay blocked as they are, superseded by round 6's chain, and
  round 5's sentinel `t_e7333c23` is not reused. **No one completes
  `t_78ba2e7f` or `t_fbb089d1`.** Round 6's DEV deploy replaces round 5's on
  DEV, as round 5's replaced round 4's. Nothing reaches MAIN or PROD.
- **The contract still governs:** `devtasks/PREBRIEF-scripting-4b-2.md`,
  FINAL Rev 2.1, at `951b541bef818499a16692ac968f1800fdb75434` (sha256
  `a7841421312f5ae59b74d8623067986557b4a241f048c30adbb556bc44190a73`); the
  OPERATOR CORRECTION and OPERATOR NOTE on `t_6c3817b2`; rounds 2's
  (`45fcc433`, sha256 `4ef9aaad2237b61a5f8f9cf23ffcb6604f4e3765284e5e1d28f8ad95679bd2d0`),
  3's (`f47cc3f7`, sha256 `4e49b1d45cc33185c7955f8b881a66b5b46c3e101ff0bbd53864cf64ade0e93f`),
  4's (`32c14a4f`, sha256 `aa28260f1454974ca97a745d846c93868911d1a9d7c2f5e0a01db046e8533ee6`)
  and 5's (`afabd79d`, sha256 `94a80bf42ce12630092769fc0dae6983b9ee2865532dd7e218845139c687a626`)
  revisions. **The message-depth-guard hotfix's contract binds the merge
  (W0):** `devtasks/PREBRIEF-message-depth-guard.md`, FINAL Rev 0, at
  `380a2db74e675a8c67c2314bff86ce2c863268c4` (sha256
  `a079fe03fd016aafecb0b13e21d7c4d86f32ee5bd3fab9e99fa4ecc6184416c4`), as
  released (reviewed `3e103d2751582d818ae7281834d3e5021f13fe63`, release merge
  and `main` `4a1a01a568159fff2e1b2514c69cef5aea688b84`). This file adds W0–W9
  and changes nothing else.

## 1. What the browser checks found

Claude ran the spec's §5.1 checks against `c042ef5a` in the harness (Chromium,
real mouse clicks; this time **through the Behaviour form**: real `<select>`
choices and button clicks), plus the outside review's scenarios and every
regression script. The scripts go to a `claude/` branch after PROD.

### 1.1 What round 5 fixed (seen in the page)
- **The form renders and works:** each template's parameters and hint appear;
  select-visibility, select-animation, interval-animation, proximity-animation
  and select-light were each set up, saved and triggered **through the form**;
  the defaults are the right kind (V11: the Fox for an animation template, a
  light for select-light); the light template in a world without lights says
  "This world has no lights" and Save is disabled; Enabled toggles `enabled`
  (V2), and a disabled behaviour's click does nothing; Remove clears the leaf.
  **Not checkable in the page yet:** a Custom graph's Enabled (V2/S1). A value
  written by hand opened as "None" (§1.2 item 3), so the button was never
  available. Round 6's checks cover it.
- **The animation templates work** (V3): a click plays Run on the Fox for
  every tab; interval-animation restarts every ~2.1 s (distinct `startedAt`);
  proximity plays Walk on enter and stops on exit; a missing clip on a loaded
  Fox is refused, nothing changes, and the panel's log shows `clip
  "NoSuchClip" is not on this model` (V5).
- **First person hides the own capsule** and a second tab still sees it (V6).
- **The outside review's scenarios:**
  - **M2:** a behaviour nested 6,500 and 30,000 deep is refused
    (`INVALID_VALUE`) on a spare round-5 server, the tab stays connected, new
    tabs connect, and nothing is thrown;
  - **M3:** a send queued behind 20 others **before** a drag starts on its
    target is dropped at the opportunity with the drag line, and the target
    stays where it was dragged;
  - **M1's producer check:** a queued entry whose behaviour is reloaded before
    it leaves is dropped;
  - **M5:** the 101st key disposes its producer with `over-send-cap`, one
    line, and Enabled (a reload) brings it back.
- **Everything 4b-2 already passed still passes:** the non-host text "Behaviours
  run in another tab; clicks here don't trigger them" (now visible) and its
  clicks do nothing; the handover (0.22 s); a 4b-1-style tab never hosts; the
  drag rule; the 64/65 cap; restart from the saved document; Duplicate's remap,
  now with no error.

### 1.2 What's still broken
1. **Visible doesn't redraw in the owner's own tab** (check 3). The SOM
   changes and the visitor's tab redraws, but the tab that clicked Visible
   keeps drawing the old state. That covers hide **and** show, and Undo and Redo
   of either. Probed: the tracker's commit applies the value locally and sends
   it; the echo raises **no `som:set`** in the sender's tab (only
   `edit:accepted`), and F6's `setNodeVisible` runs only on `som:set`. A
   behaviour's own sends do redraw, because they go through `sendField`'s echo.
2. **The Behaviour section stays closed after Edit off → Edit on** when the same
   object is selected again. V13's explicit `behaviorForm.close()` on Edit off
   (`app.js` L1720) doesn't reset `lastBehaviorNode`, so `refreshBehaviorRow`
   (L2967–2980) sees the same node and only calls `render()` on a closed form.
   The section comes back only after another object is selected first. That
   is the owner's ordinary loop: set up, Edit off to try it, Edit on to adjust.
3. **The form doesn't re-read the leaf when it changes under a selected
   object.** `refreshBehaviorRow` runs on `som:set` of the leaf, but for the
   same node it only calls `render()`, which draws the form's old state. Seen
   three ways:
   - after **Remove**, the picker still shows the removed template;
   - a behaviour written while its object was **already selected** (adding a
     cube selects it) opens as "None", with Enabled, Save and Remove disabled,
     while the runner runs it;
   - by the same path, a change from **another owner tab** leaves this tab's
     form stale, and a Save from it would overwrite that change.

   F9 says `refreshBehaviorRow` "renders it on selection and on `som:set` of
   the leaf"; the intent is the stored value, not a stale one.
4. **Every "Disabled" status reads "Disabled: the behaviour value is
   invalid".** `statusText` passes the runner's reason (`disabled`,
   `over-send-cap`, `over-budget`, `not-found`, `target-not-found: <i>`,
   `rejected: <message>`, `invalid: <code>`) to `behaviorReasonText`, which
   knows only F1's codes and falls back to "the behaviour value is invalid".
   Seen for Enabled → Disabled and for `over-send-cap`.
5. **A dispose during a tick throws.** When a behaviour's own tick queues the
   101st key, V8 disposes it in that tick (`record.engine = null`), and
   `runner.js` L431 then reads `record.engine.disposed`: "Cannot read
   properties of null (reading 'disposed')", out of `tick()`. That frame's
   remaining engines, its send and its render are skipped (one frame; the
   loop continues).

### 1.3 The regression scripts (§5.1 check 9)
**All 28 pass on `c042ef5a`:** 4b-1 c1, c4 (with F9's new host text) and c8;
4a c1, c4, c6, c7, c8b and c9; library-sky c1, c1b, c1c, c11–c14, **c23 and
c4** (round 4's regression, fixed by V13), c5, c67, c8 and c910; edit-polish-3
a–f. The only page errors are 4a c7's stubbed refusal, which that check
injects, and library-sky c1b's thumbnail 404s, which round 4's run had too:
the harness doesn't serve the committed catalog's thumbnails.

**DEV:** round 5's release merge `e3d9ab14` (`c042ef5a` plus `devtasks/` only
from `main` `afabd79d`) is on DEV, recorded and healthy. Its finalizer blocked
on the known missing journal lines, as round 4's did.

### 1.4 The outside review of round 5, and the hotfix it led to
The operator's second outside review read `957140bd` → `c042ef5a` with a
clone and the tests (3,060 green). It found **GO for round 5's fixes**: M1–M7,
S1 and S2 are each fixed as V2–V13 say, and all six proofs it broke held. It
also confirmed W1–W4's plan. Claude checked its three new findings against the
code:
- **N1 (should-fix, into W5): a behaviour disposed by the send cap keeps
  queueing for the rest of its flow.**
  - `BasicBehaveEngine.dispose()` clears its queues, but the flow in
    progress continues, and every later `world.set` in that tick reaches
    `enqueue`. `enqueue` checks whether the producer is still live only in
    its 100-key branch (`runner.js` L307–318).
  - So stale entries refill the queue, each spends a 50 ms opportunity before
    V7 drops it, and each logs a line. V8's "logs once" and "the queue stays
    at 100" don't hold on this path.
  - W5's guard alone doesn't stop it.
- **N2 (should-fix, W7): the seq record only shrinks on a rejection or a
  dispose.**
  - Nothing subscribes to `edit:accepted` or `edit:unknown`, so every accepted
    send stays in `sendSeqs` (`runner.js` L380): about 1,800 entries an hour
    for a 2 s interval behaviour, with no bound.
  - `disposeAll` clears neither `sendSeqs` nor the once-sets, and
    `disposeEngine` returns before forgetting when it has no record. So
    across a reconnect, a refusal that was logged before isn't logged again,
    contrary to V3's "until that behaviour is reloaded".
- **N3 (must-fix, done): any client could crash the server process with one
  deeply nested message.**
  - Claude reproduced it on PROD's tree twice: an owner's `add`, and a
    **visitor's** own avatar `add`.
  - It was fixed as its own security round, message-depth-guard: a depth
    bound of 64 on every inbound message before the schema check, and a
    fail-closed message handler.
  - The fix is on DEV, MAIN and PROD as `4a1a01a5` (2026-10-25, 18:55 PT).
  - 4b-2 takes it in through W0.
- **The nits (W8):**
  - Save's stage 3 looks the target up again (`lightIntensity(targetNode())`,
    `behavior-form.js` L316) instead of using the snapshot's object, and the
    parameter fields stay editable while saving;
  - the strict fake delivers `change` only to checkbox and radio inputs, so
    the picker's and the parameter container's real listeners are never
    driven by a test;
  - `adapter.js` L322 logs "refused refused write";
  - `refusedOnce` is keyed without the reason, so a key dropped once for a
    drag is never logged again when it's later dropped for authority.

## 2. The contract (round 6)

### W0. Merge `main` first
- **Why:** the host's release merge refuses any change on `main` outside
  `devtasks/` that the tip doesn't already contain
  (`atrium-release-merge`, `ALLOWED_RE='^devtasks/'`). `main` now carries the
  hotfix (`packages/server/src/session.js`, `message-depth.js`, its tests).
  Without this step, round 6's DEV deploy is refused.
- **Step 1, before W1:** `git -C /workspace/wt/scripting-4b-2 fetch origin main`,
  then `git merge --no-ff origin/main` in the worktree, as one merge commit.
  `origin/main` must be `4a1a01a568159fff2e1b2514c69cef5aea688b84` or a
  descendant whose extra commits touch only `devtasks/`; otherwise block
  `needs_input`.
- **The expected conflict is `packages/server/src/session.js`'s message
  listener.** The hotfix wraps the whole listener body in one `try/catch`
  (G2), which re-indents it, and adds the depth guard (G1) right after
  `JSON.parse`. 4b-2 changed the same body (the election rule, the `add`
  checks, and round 5's V9 fail-closed boundaries).
- **The rule for resolving it:** the result is **4b-2's listener body, with
  the hotfix's changes applied on top, exactly**:
  - G1's guard and its log line after `JSON.parse`, before `validate`;
  - G2's outer `try/catch`, its log line and its reply.

  The hotfix's own change is small without whitespace (`git diff -w
  380a2db7 3e103d27 -- packages/server/src/session.js`, about 45 lines), so
  re-apply it rather than hand-merging the re-indented hunks.
- **Both sides' fail-closed paths stay:** round 5's V9 `try` around
  `authorizeSend` and the `add` checks (its own reply, "the value could not be
  checked") sits inside the hotfix's outer `try`. Neither replaces the other.
- **Every other file merges as it is:** the hotfix's `message-depth.js` and its
  tests, and 4b-2's files. No other conflict is expected; if one appears,
  block `needs_input` with the conflicting hunks.
- **The merge commit is runnable:** every suite green, including the hotfix's
  `message-depth.test.js` and `message-depth-measure.test.js` (the deepest
  legitimate message, **now over 4b-2's suites too**, must still be 32 or
  less; the handoff reports the new number and its message type).


### W1. Visible redraws wherever the value changes
- **The renderer follows the SOM node's `visible`, whatever changed it:** a
  local apply (the tracker's `writeLocal`), an echo, a broadcast, a revert on
  rejection, Undo and Redo. `setNodeVisible(docView, node, node.visible !== false)`
  runs for each.
- The worker chooses the hook (the SOM node's own mutation event for
  `visible`, or the tracker's `writeLocal`, revert and undo paths). The handoff
  names it and says why it covers every path. **`som:set` alone is not
  enough** (§1.2 item 1).
- Nothing else about Visible changes: one commit is one send, as V4 has it.

### W2. Reselecting after Edit off opens the section
- `refreshBehaviorRow` opens the form, so the stored value is read again,
  whenever **the selection differs from `lastBehaviorNode` or the form is
  closed.** It doesn't rely on the Edit-off path resetting the cache.
- The Edit-off path also clears `lastBehaviorNode` beside its
  `behaviorForm.close()`, so the two can't drift apart again.

### W3. The form shows the stored value
- **On `som:set` of the selected node's `extras.atrium.behavior`** (and the
  `extras` and `name` paths `refreshBehaviorRow` already follows), the form
  **re-reads the stored value**, as `open` does: template or Custom graph,
  params, target, Enabled.
- **Except while this form's own sequence is in flight** (a Save's stages,
  Enabled or Remove): those writes' echoes must not bump the generation or
  cancel the sequence. M4's rules are unchanged. When the sequence ends, the
  form re-reads once.
- **A change from elsewhere during an unsaved edit** (the owner has changed
  the picker or a parameter but not saved): the form re-reads and shows the
  stored value, and the status line says "Changed in another tab" once. An
  unsaved edit is never silently kept over a newer stored value.

### W4. Each disable reason has its own text
`statusText` shows "Disabled: <text>" with these texts. The runner's codes
don't change; only the text the panel shows does:

| Runner reason | Text |
|---|---|
| `disabled` | `turned off` |
| `invalid: <code>` | `behaviorReasonText(<code>)` (F1's message for that code) |
| `not-found` | `its object can't be found` |
| `target-not-found: <i>` | `target <i> can't be found` |
| `rejected: <message>` | `the graph was refused: <message>` |
| `over-budget` | `it did too much work in one frame` |
| `over-send-cap` | `too many changes were waiting to be sent` |
| anything else | the reason as it is |

"the behaviour value is invalid" appears only for an F1 code that maps to it.

### W5. A dispose during a tick doesn't throw, and a disposed producer queues nothing (N1)
- `tick` keeps the engine in a local before calling it. After the call it
  checks whether the record is still the same, still has that engine, and
  whether that engine is disposed, and it never reads a property of `null`.
- A record disposed in its own tick (V8's send cap) is skipped for the rest of
  that frame. The other engines still tick, and the frame's opportunity still
  runs.
- **`enqueue` refuses an entry whose producer isn't live:** `findRecord(behaviourId,
  generation)` has no record, or its `engine` is `null` or disposed. The check
  comes first, before the gesture check and the 100-key check. It returns
  `false`, queues nothing, and logs nothing more (the disposal already logged
  its one line). So after the cap disposes a behaviour mid-flow, the queue
  stays at 100 and the rest of that flow leaves no entries.

### W6. (renumbered: see W9)

### W7. The seq record is bounded (N2)
- **On `edit:accepted` and `edit:unknown`** for a seq in `sendSeqs`, the runner
  deletes it. Only an `edit:rejected` logs, as V3 says.
- **`disposeAll`** (role loss, `connecting`, a world change) clears
  `sendSeqs`, `refusalLogged`, `droppedLogged` and `refusedOnce`.
- **`disposeEngine`** forgets the behaviour's seqs and its once-entries even
  when it has no engine record.
- So a refusal is logged again after a reload, as V3 says ("until that
  behaviour is reloaded").

### W8. The small items (the nits)
- **Save's stage 3** uses the snapshot's target object (`snapshot.target`) for
  the light's intensity, and never looks it up again. **The parameter fields and
  the template picker are disabled while a Save is in flight.**
- **The strict fake delivers `change`** to `<select>` and to text and number
  `<input>`s as well, as the DOM does. **At least one test per listener
  drives it through the real element:** the template picker's `change`,
  the parameter container's delegated `change` (one field of each kind), and
  Enabled's `click`.
- **`adapter.js`** logs "refused write to …" once, not "refused refused".
- **`refusedOnce`** is keyed by (behaviour, key, reason), so each different
  reason a key is dropped for is logged once.

### W9. What doesn't change
Everything in F1–F12, C1–C3, the OPERATOR NOTE, rounds 2–5's revisions, and
the hotfix's G1/G2 as merged by W0.
- **No server file changes beyond W0's merge.**
- **No change to the runner's queue order, coalescing, rate, checks at the
  opportunity or disposal rules beyond W5 and W7.**

## 3. Tests and proofs (round 6)

| Item | New tests |
|---|---|
| W1 | With a fake `docView` recording `setNodeVisible` calls: the Visible checkbox's commit of `false` calls it with `false` **before any echo**; `true` likewise; Undo and Redo of each call it; a rejected commit's revert calls it with the restored value. The existing echo path still calls it once per change |
| W2 | `refreshBehaviorRow` with a fake form: select X (open), Edit off (close), Edit on, select X → `open` is called again and reads X's leaf; selecting X twice in a row with the form open calls `render` only |
| W3 | With the strict fake: (a) Remove's echo → the picker shows None; (b) the form open on X with None, then a `som:set` of X's leaf with a select-visibility value → the picker shows select-visibility with its target, and Enabled and Remove are enabled; (c) the same with a Custom graph; (d) a Save in flight across its three stages, with each stage's echo arriving → no "Save cancelled", the final value is the template's (M4's test unchanged); (e) an unsaved picker change, then another tab's `som:set` → the stored value is shown with "Changed in another tab" |
| W4 | `statusText` for each row of W4's table, with the exact texts; no reason but an F1 code gives "the behaviour value is invalid" |
| W0 | The merge commit's full suites, the hotfix's two test files among them; `git diff -w c042ef5a <merge> -- packages/server/src/session.js` is the hotfix's G1 and G2 change and nothing else (quoted in the handoff); §6.2's measured maximum over all suites, ≤ 32 |
| W5 | A fake engine whose `tick` makes the 101st enqueue: `runner.tick()` doesn't throw; a second engine registered after it still ticks in that frame; the frame's opportunity sends. **N1's case, from inside a real engine's tick** (not the test seam): a Custom graph in F-L4's allowlist that writes three fields on one select, with 99 keys already queued. Its second write is the 101st and disposes it; its third write queues nothing; the queue stays at 100; there is exactly one disable line and no "no longer running" lines |
| W7 | 1,000 accepted runner sends leave `sendSeqs` empty; an `edit:unknown` removes its seq too; after `connecting` → `world:loaded`, a refusal of the same (behaviour, key, code) that was logged before is logged again; `disposeAll` empties the four maps and sets |
| W8 | Stage 3's light value comes from the snapshot's object (the target renamed between stages still gets its intensity); while saving, the picker and every parameter field are `disabled`; with the strict fake, a `change` dispatched on the real picker element and on each kind of parameter field reaches `onTemplateChange` / `onParamChange`; the adapter's refusal line reads "refused write"; one key dropped for a drag and then for authority logs two lines |

**Proofs** ("not reproducible" is not an acceptable result):
- **(w1)** W1's hook removed, so only `som:set` is left: the before-echo test
  fails;
- **(w2)** the `|| !form.open` condition removed and the Edit-off reset
  removed: W2's test fails;
- **(w3)** `som:set` of the leaf back to `render()` only: W3 (a) and (b) fail;
  **(w3b)** the in-flight exception removed: W3 (d) fails with "Save
  cancelled";
- **(w4)** `statusText` back to `behaviorReasonText(reason)`: W4's test fails;
- **(w5)** the guard removed: W5's test throws `TypeError`; **(w5b)** the
  producer check in `enqueue` removed: N1's test fails (the third write is
  queued);
- **(w7)** the `edit:accepted` delete removed: W7's 1,000-send test fails;
  **(w7b)** `disposeAll`'s clear removed: the after-reconnect test fails;
- **(w8)** the strict fake's `change` back to checkbox and radio only: the
  real-listener tests fail.

**And the whole round still passes:** full suites with round 1's rules
(server files one at a time under `timeout 180`, `packages/client` without
`--test-force-exit`, every other package on its own directory,
`importmap-guard` and the workspace-rules guard green, the one named
conformance skip and no other); **`r1`** unchanged; round 5's proofs (v1)–(v13)
re-run for the ones in files this round touches (`behavior-form.js`,
`app.js`, `runner.js`), and quoted.

**Steps, one commit each:**
1. W0: the merge of `origin/main`, with the full suites green on it;
2. W1 and W2: `app.js` (and the tracker if W1's hook lives there);
3. W3, W4 and W8's form items: `behavior-form.js` and the strict fake;
4. W5, W7 and W8's runner and adapter items: `runner.js`, `adapter.js`;
5. suites, proofs and the handoff.

**Before DEV acceptance**, after round 6's release chain publishes and
deploys:
- **Claude's §5.1 browser checks again through the form,** with §1.2's five
  items checked in the page, and the hotfix's two crash reproductions (an
  owner's and a visitor's deep `add`) against the merged server;
- **after the DEV deploy,** `atrium-release-status`: DEV actual = recorded =
  `RELEASE_SHA`, healthy.

The operator then runs the spec's §6 DEV acceptance. (Round 5's diff has had
its outside review, §1.4. Round 6's own change is small; an outside look at
it is the operator's call.)

## 4. Kickoff body for round 6 (post it verbatim as the revision kickoff card's text)

---

### KICKOFF — scripting-4b-2 revision round 6. Slug: `scripting-4b-2`

You are the kickoff orchestrator for round 6 of `scripting-4b-2`. Build the
graph below, read it back, report, and stop. Do not implement, review or
deploy anything yourself.
- **Your tools:** only `kanban_*`.
- **Blocking:** never call `kanban_block` without an explicit `task_id`, and
  never block this card.
- **Titles:** use them exactly as written. Don't add words to them.

**The contract is in git; you don't read it.** It is
`devtasks/REVISION-scripting-4b-2-r6.md` on `main`, together with
`devtasks/PREBRIEF-scripting-4b-2.md` at `951b541bef818499a16692ac968f1800fdb75434`
(sha256 `a7841421312f5ae59b74d8623067986557b4a241f048c30adbb556bc44190a73`),
`devtasks/REVISION-scripting-4b-2.md` at `45fcc433015c54355fcec31a8917f6c548af9434`
(sha256 `4ef9aaad2237b61a5f8f9cf23ffcb6604f4e3765284e5e1d28f8ad95679bd2d0`),
`devtasks/REVISION-scripting-4b-2-r3.md` at `f47cc3f7198a33309a59eee845167b61ae3ac173`
(sha256 `4e49b1d45cc33185c7955f8b881a66b5b46c3e101ff0bbd53864cf64ade0e93f`),
`devtasks/REVISION-scripting-4b-2-r4.md` at `32c14a4f85e4127c1204fca5562edb319a67df9b`
(sha256 `aa28260f1454974ca97a745d846c93868911d1a9d7c2f5e0a01db046e8533ee6`),
`devtasks/REVISION-scripting-4b-2-r5.md` at `afabd79da8a4a76efd5bb7ccf4f80356e1178e40`
(sha256 `94a80bf42ce12630092769fc0dae6983b9ee2865532dd7e218845139c687a626`),
`devtasks/PREBRIEF-message-depth-guard.md` at `380a2db74e675a8c67c2314bff86ce2c863268c4`
(sha256 `a079fe03fd016aafecb0b13e21d7c4d86f32ee5bd3fab9e99fa4ecc6184416c4`; it
binds W0's merge) and the two operator texts on `t_6c3817b2` (the OPERATOR
CORRECTION and the OPERATOR NOTE).
- **The front door has already checked the round-6 revision** and posted
  its commit and sha256 on this card. **You have only `kanban_*` tools: do
  not try to fetch or hash anything, and do not block for lack of a shell.**
- Copy that commit and sha256 into cards 1 and 2. **They** have terminal,
  file and git tools. Each reads the revision with
  `git -C /workspace/atrium fetch origin main && git -C /workspace/atrium show <commit>:devtasks/REVISION-scripting-4b-2-r6.md > /tmp/revision-r6.md && sha256sum /tmp/revision-r6.md`,
  and blocks with `kind="capability"` on a mismatch.

#### Graph
1. **`Implement r6 — scripting-4b-2`.** Assignee `atrium-deepseek`, parent:
   this kickoff, `--max-runtime 3h` (10800 s).
   - **Body:**
     - the revision reference and hash check;
     - continue `workflow/scripting-4b-2` from
       `c042ef5a581de161788d3f6132d9dacdadd1b352` in the existing worktree
       `/workspace/wt/scripting-4b-2` (`git -C /workspace/wt/scripting-4b-2
       status` must be clean at that SHA, or block `needs_input`);
     - **step 1 is W0's merge of `origin/main`**, resolved by W0's rule;
     - the revision's §2 contract and §3 steps, tests and proofs;
     - the spec, the two operator texts on `t_6c3817b2`, rounds 2–5's
       revisions and the hotfix's pre-brief, still binding;
     - the WORKER-CARD REQUIREMENTS comment (855 on `t_2d41531f`);
     - a progress comment on its own card after each step's commit.
   - **The handoff** carries:
     - W0's `git diff -w` quote and the new §6.2 number;
     - proofs (w1)–(w8) with their (b) variants;
     - W1's choice of hook and why it covers every path;
     - `r1`'s output and the re-run round-5 proofs;
     - per-file counts with exit codes, and the one named skip.
2. **`GLM review r6 — scripting-4b-2`.** Assignee `atrium-glm`, parent:
   card 1.
   - Its body opens with
     `THIS RUN HAS TERMINAL, FILE AND GIT TOOLS. Use them for every step below.`
   - **The review covers round 6's change** (`c042ef5a` to the round-6 tip)
     against this revision. It reproduces **every proof** itself.
   - **It checks W0's merge:**
     - `git diff -w c042ef5a <merge> -- packages/server/src/session.js` is
       exactly the hotfix's G1 and G2 change (compare with `git diff -w
       380a2db7 3e103d27` on the same file);
     - 4b-2's V9 boundaries are intact inside the outer `try`;
     - the hotfix's tests pass on the merge, and §6.2's maximum is 32 or less;
     - it sends a 6,500-deep owner `add` and a deep visitor avatar `add` to
       a child server on the merge, and both are refused with the server
       still serving.
   - **It traces W1's hook through every path** in W1's list (a local apply,
     an echo, a broadcast, a revert, Undo, Redo) and names the line that runs
     `setNodeVisible` for each.
   - **It reads W3's in-flight exception** against M4's sequence rules and
     confirms a Save's own echoes can't cancel it.
   - **It confirms no server file changed beyond W0's merge,** and that the
     runner's changes are only W5's, W7's and W8's.
   - **Progress comments on its own card** after each stage.
3. **`Review gate r6 — scripting-4b-2`.** Assignee `atrium-orchestrator`,
   parent: card 2. It creates nothing.
   - **On a valid APPROVE of the exact 40-character SHA,** it blocks with
     `APPROVE <SHA40>: front door, build the release chain`.
   - **Otherwise,** it blocks for the operator with the verdict quoted.
4. **Before you complete,** link card 3 to **round 6's sentinel** as a
   parent. The front door creates it and posts its id on this card. Rounds
   1–5's sentinels (`t_6ad02da5`, `t_31a95fba`, `t_b9c2a9bc`, `t_e7ef64b2`,
   `t_e7333c23`) must not be used. Do not create a sentinel yourself.
5. **The release chain** is the front door's: the same four cards as
   scripting-4b-1's (Publish, DEV deploy, DEV finalizer, acceptance gate),
   with the new SHA, built whole at card 3's APPROVE.
   - **Round 5's chain cards (`t_271332b8`, `t_52e0c377`, `t_78ba2e7f`,
     `t_fbb089d1`) are not reused,** and no one completes the two of them
     that are still blocked.
   - The DEV deploy replaces round 5's release on DEV. Nothing reaches MAIN
     or PROD.

#### Report back
- the three ids;
- the implementation's parent and its 10800 s cap;
- the hash line copied into cards 1 and 2;
- the review's opening line;
- the gate linked to round 6's sentinel.

Then complete this card.

---
