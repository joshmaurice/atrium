# Revision — scripting-4a round 2 (after the outside code review of `c51ca3e9`)

**Status:** approved by the operator (2026-10-23 09:21 PT), Rev 0 as
drafted: **R1 (a)**, V1–V8 in one round; **R2 (a)**, Stop and Play enabled
in `clip-missing` (V6, amending L7 for that state).
- **Base:** the reviewed round-1 tip `c51ca3e92ab258279e0f3783b1fe6459b231b1ba`
  on `workflow/scripting-4a`. Round 2 commits on top of it, on the same
  branch, in the existing worktree `/workspace/wt/scripting-4a`.
- **DEV runs its release merge, `a49e18e8`.** That is **not accepted**: the
  acceptance gate `t_24b37001` stays blocked and is superseded by round 2's.
- **The spec still governs:** `devtasks/PREBRIEF-scripting-4a.md`, FINAL Rev
  1.2, at `100365758e75c8880897fa5ceb48693fdc810415` (sha256 `9260df0b…667f`),
  with the operator's brief-gate corrections (the comment on `t_4954c617`,
  2026-10-23 09:32 UTC). This file adds V1–V8 and nothing else.

## 1. What the review found
**The verdict:** "NO-GO — revisions required". The review found 4 must-fix
items, 3 should-fix items and 1 nit. It judged the server rule, the stamp,
`setPath`, the own echo, instance keying, Stop and disposal, clip ids and
the import maps correct, and recommended no redesign. Claude checked every
finding. Two were already seen in the browser harness (§5.1 checks 4 and 8,
on `c51ca3e9`). The others were reproduced against the real modules with
throwaway scripts (not committed).

| # | Finding | Where (at `c51ca3e9`) | Claude's check |
|---|---|---|---|
| V1 | **The clip controls don't follow the animation layer's state** (review 1 and 2). The row re-renders only on SOM, selection and bridge-status events. (a) A once-through clip that ends leaves the row on "Playing", with Play disabled. (b) A model selected while it loads stays on "Animations: loading": the bridge's `setStatus(loaded)` → `onStatus` → `refreshModelRow` runs **before** `onInstanceCreated` gives the layer its entry. | `app.js` `onStatus` (L2806), the frame loop (L2716); `model-bridge.js` L642–650 | **Reproduced in the browser.** (a) The row stayed on "Playing", with Play off, for 2 s after the end, then showed "Played" with both buttons on after a reselect. (b) It stayed on "Animations: loading" for 3 s after the load completed, while the layer already reported `clip-missing` |
| V2 | **Play can be enabled and send nothing** (review 4). Selected while loading, `syncChoice` stores `choice.clip = null`. After the load, `panelState` *shows* the first clip and enables Play, but `play()` returns at `!choice.clip`. A one-clip model can't recover through the select, because choosing the shown option fires no `change`. | `model-animation-panel.js` `syncChoice` (L114), `play` (L189) | **Reproduced** with the real module: after the load the row read "Stopped", Play enabled, clip shown `animation_0`, `choice.clip` null; `play()` returned null with 0 writes |
| V3 | **A discontinuity sets the offset to `null`, and `serverNow()` reads that as 0** (review 3). Until the first recovery pong, `serverNow()` is the page's uptime, not server time: a playing clip shows frame 0 (or the rest pose), and `serverClockReady` stays true. | `AtriumClient.js` `_onPong` (L480), `serverNow` (L363) | **Reproduced** with fake clocks: after a +60 s server jump, `serverNow() − truth = −1.79 × 10¹² ms`, with `serverClockReady` true |
| V4 | **Recovery accepts pongs to pings sent before the discontinuity** (review 6). `clock.sent` isn't cleared, and with `offset` null the first sample skips the comparison, so an old ping's answer becomes the estimate. That is exactly the "pre-sleep ping answered after a wake" Z3 says may be wrong. | `AtriumClient.js` `_onPong` (L461–486) | **Reproduced:** with three pings outstanding, the jump on pong 2 left ping 3 in the map, and pong 3 was then accepted as the window's first sample |
| V5 | **A stopped action never restarts for the same clip and `startedAt`** (review 5). `targetAction`'s fast path returns when the clip id and `startedAt` match, without checking `entry.stopped`. It isn't reachable from 4a's UI, because the server re-stamps every Play, but 4b's writes and any re-applied value would hit it. | `model-animations.js` `targetAction` (L132) | **Reproduced** with real three.js: playing (x = 7.5), then `null` (x = 0, the rest pose), then the same value again: still x = 0, `isRunning()` false, status `playing` |
| V6 | **A missing saved clip strands the owner** (review 7). In `clip-missing`, Play and Stop are both disabled. The only way out is to choose a *different* clip in the select, which a one-clip model doesn't have. Also, `status().clips` lists every L8 id, **including dropped animations**, so the select offers clips that L8 says aren't offered. | `model-animation-panel.js` L61–62; `model-animations.js` `status` (L237) | Browser check 8: in `clip-missing`, Play and Stop were both off. The dropped-id listing was confirmed by reading (neither Khronos model has a dropped clip) |
| V7 | *Nit:* the select's option cache key is `clips.join('\u0000')`, and an id may contain U+0000. | `app.js` L2910 | Confirmed by reading |
| V8 | *Nit (Claude's browser check 7):* a new Play doesn't clear the previous rejection's message, so "stubbed: animation refused" stays visible while the next write is waiting. | `model-animation-panel.js` `write` (L149) | Seen in the browser |

**The review didn't see the operator's corrections** (they weren't in its
prompt). Its "areas that passed" include the parts those corrections changed
(`null` on `add`, the model check on the resolved node), so nothing in the
corrections is in dispute.

## 2. The contract (round 2)

### V1. The panel follows the layer
- **`createModelAnimations` takes `onChange(name)`** (optional, default a
  no-op). It is called with the node's name whenever what `status(name)`
  returns could have changed:
  - after `onInstanceCreated` and `onInstanceDisposing` (for the current
    instance) have run;
  - after `set`, `rename` and `clear` change anything;
  - **from `update()`, once, when an entry's state changes** (for example
    `playing` → `ended`). `update()` keeps each entry's last reported
    state, so a frame where nothing changes calls nothing.
- **`app.js` wires it:** `onChange: (name) => { if (selected?.name === name)
  refreshModelRow() }`. There is no per-frame DOM work: the row is written
  only when the layer reports a change.
- **The bridge's order stays as it is** (`setStatus`, then
  `onInstanceCreated`). The layer's own `onChange` after
  `onInstanceCreated` is what closes the gap.

### V2. Play sends the clip the select shows
- **The panel remembers whether the owner picked a clip** for the selected
  node (`choice.explicit`). A pick is a `change()`, or a Play.
- **Without an explicit pick,** every render re-derives `choice.clip` with
  `panelState`'s rule: the stored value's clip if it's offered, else the
  first offered clip. So when the clips arrive after a load, the remembered
  clip is the shown one.
- **An explicit pick is kept** while it's still offered. If it isn't, the
  shown clip replaces it.
- **The invariant, tested:** whenever Play is enabled, `play()` writes
  exactly `playValue({ clip: <the clip panelState shows>, loop })`. It never
  returns null without writing.

### V3. A discontinuity keeps the last estimate until a new one exists
- **On a discontinuity,** `clock.samples` is cleared and the burst starts as
  now, but **`clock.offset` is left as it was.** `serverNow()` keeps
  returning the last good estimate until the first recovery sample lands.
- **`clock.recovering = true`** until that sample. The first sample accepted
  while recovering replaces the offset **without** the discontinuity
  comparison, which is what lets the estimate move to the new clock. After
  it, the window and the comparison work as usual.
- **`serverNow()` never adds a missing offset as 0 once a `hello` has given
  one.** Before any `hello` there is no world and nothing plays. The
  `?? 0` stays only for that case.
- **`serverClockReady`** is false while recovering and true again after the
  first recovery sample.

### V4. Recovery uses only the new burst's answers
- **On a discontinuity, `clock.sent` is cleared before the new burst is
  sent.** A pong to an earlier ping is then "not in the map" and ignored,
  under Z3's existing rule. The per-connection counter keeps increasing, so
  the new burst's keys never collide with the old ones.

### V5. Re-applying a value after Stop plays it
- **`targetAction`'s fast path also requires `!entry.stopped`.** A stopped
  action asked for the same clip and `startedAt` is played again
  (`action.play()`, with the time set from Z4 as usual), and `stopped`
  becomes false.
- **Everything else in Z5 stays:** Stop is still `action.stop()` alone, and
  a deep-equal `set` still does nothing.

### V6. A missing clip can be cleared or replaced; dropped clips aren't offered
- **`status(name).clips` lists only playable ids,** the L8 ids whose
  animation was retained, in file order. A dropped animation keeps its id
  (`clipIds` is unchanged), isn't listed, and a saved value naming it is
  still `clip-missing`.
- **In `clip-missing`:**
  - **Stop is enabled.** It writes `null`, as everywhere else.
  - **Play is enabled when the select shows a playable clip.** It writes a
    new playing value for that clip, which the server stamps.
  - The status text is unchanged ("Clip ‘X’ not found in this model",
    written with `textContent`).
- This amends L7's "Play when stopped or ended, Stop when playing or ended"
  for this one state (R2 (a), approved).

### V7. A collision-free cache key
`renderAnimationRow` keys the options on `JSON.stringify(panel.clips)`.

### V8. A new write clears the controls' old error
When the controls start a write (Play, Stop, a clip or Loop change while
playing), the edit error line is cleared first, as `editTracker` does for its
own answers. A rejection of the new write shows its own reason as before.

### What doesn't change
Everything else in Z1–Z8 and the operator's corrections, and round 1's code
outside these eight points. In particular: the server and SOM halves, the
stamp, the own echo, instance keying, the three bridge callbacks and their
order, `clipTime` and `clipIds`.

## 3. Tests and proofs (round 2)

| Item | New tests |
|---|---|
| V1 | renderer-three, real clips: `onChange` fires once after `onInstanceCreated`, once after `onInstanceDisposing`, once on `set` of a new value, and **once** from `update()` when a once clip crosses its duration (fake `now`), not on the frames before or after it. No call for a deep-equal `set` or a frame with no change. Plus an `app.js` wiring guard: `createModelAnimations` gets an `onChange` that calls `refreshModelRow` for the selected name |
| V2 | panel: select a model while its status is `loading` with no saved value; the status becomes `stopped` with clips `['animation_0']`; refresh; `play()` writes `{ clip: 'animation_0', … }`. The same with three clips: an explicit pick of the third survives a refresh. An explicit pick that disappears from the list is replaced by the shown clip. For every state, when `playEnabled` is true, `play()` writes |
| V3 | client, fake clocks: after a discontinuity and **before** any recovery pong, `serverNow()` equals the last estimate (within 1 ms) and `serverClockReady` is false. The first recovery pong sets the new offset (a +60 s server jump is followed, not refused again); readiness returns |
| V4 | client: three pings outstanding; a discontinuity on the first's pong; the second's and third's pongs (old keys) are ignored; the new burst's first pong is the window's first sample |
| V5 | renderer-three, **the object's own values:** value A (x moves), `null` (rest pose), A again: x moves again and the action is running |
| V6 | renderer-three: a dropped animation's id isn't in `status().clips`, while a saved value naming it gives `clip-missing`. Panel: in `clip-missing`, Stop is enabled and writes `null`; Play is enabled with a playable clip shown and writes it |
| V7 | wiring guard: the options key is `JSON.stringify` |
| V8 | panel: a rejection, then a new Play: the error line is cleared when the new write starts |

**Proofs** (each break fails named tests; "not reproducible" is not an
acceptable result):
- **(r1)** `update()` reporting no `playing` → `ended` change, or no
  `onChange` after `onInstanceCreated`;
- **(r2)** `syncChoice` initializing only on a node change again;
- **(r3)** the discontinuity setting `clock.offset = null` again;
- **(r4)** the discontinuity not clearing `clock.sent`;
- **(r5)** the fast path without `!entry.stopped`;
- **(r6)** `status().clips` built from every id again, or Stop disabled in
  `clip-missing` (two breaks, each failing its own test).

**And the whole round still passes:**
- full suites, with the same rules as round 1: server files one at a time
  under `timeout 180`, `packages/client` without `--test-force-exit`,
  `importmap-guard` green;
- **round 1's proofs re-run against the round-2 tip:** (a)–(f) with (b2),
  (b3), (b4), (c2), (d2), (e2), (e3) and (e4).

**Steps, one commit each:**
1. V3 and V4 (the clock);
2. V5 and V6's layer half, and V1's `onChange` (`model-animations.js`);
3. V1's wiring, V2, V6's panel half, V7 and V8 (`app.js` and the panel);
4. suites, proofs and the handoff.

**Before DEV acceptance:** Claude re-runs §5.1 checks 1–10 and these in the
browser:
- a once clip ends with the fox selected: "Played", Play re-plays, with no
  reselect;
- selected while loading (a held fetch): the clips appear when it loads, and
  Play works without a reselect, on CesiumMan's single clip;
- a saved missing clip on CesiumMan: Stop clears it, and Play replaces it;
- a forced discontinuity in a playing session: no jump to frame 0 before the
  recovery pong.

## 4. Decisions (approved 2026-10-23 09:21 PT, both (a))
- **R1 — the round:** **(a), approved:** V1–V8 in one round 2, as above.
  Not taken: (b) V1–V4 only, with V5–V8 recorded for 4b.
- **R2 — V6's `clip-missing` controls:** **(a), approved:** Stop and Play
  enabled as in V6, amending L7 for that state. Not taken: (b) only the
  dropped-id listing, leaving L7 as written, under which a one-clip model
  with a missing saved clip could be cleared only by deleting and re-adding
  the model.

## 5. Kickoff body for round 2 (post it verbatim as the revision kickoff card's text)

---

### KICKOFF — scripting-4a revision round 2. Slug: `scripting-4a`

You are the kickoff orchestrator for round 2 of `scripting-4a`. Build the
graph below, read it back, report, and stop. Do not implement, review or
deploy anything yourself.
- **Your tools:** only `kanban_*`.
- **Blocking:** never call `kanban_block` without an explicit `task_id`, and
  never block this card.
- **Titles:** use them exactly as written.

**The contract is in git; you don't read it.** It is
`devtasks/REVISION-scripting-4a.md` on `main`, together with
`devtasks/PREBRIEF-scripting-4a.md` at `100365758e75c8880897fa5ceb48693fdc810415`
(sha256 `9260df0bc259d64b55c0812aba0f735ffa3183e2db637dccf4359ca1c5d9667f`)
and the operator's corrections (the comment on `t_4954c617`).
- **The front door has already checked the revision** and posted its commit
  and sha256 on this card. **You have only `kanban_*` tools: do not try to
  fetch or hash anything, and do not block for lack of a shell.**
- Copy that commit and sha256 into cards 1 and 2. **They** have terminal,
  file and git tools. Each reads the revision with
  `git -C /workspace/atrium fetch origin main && git -C /workspace/atrium show <commit>:devtasks/REVISION-scripting-4a.md > /tmp/revision.md && sha256sum /tmp/revision.md`,
  and blocks with `kind="capability"` on a mismatch.

#### Graph
1. **`Implement r2 — scripting-4a`.** Assignee `atrium-deepseek`, parent:
   this kickoff, `--max-runtime 2h` (7200 s).
   - **Body:**
     - the revision reference and hash check;
     - continue `workflow/scripting-4a` from
       `c51ca3e92ab258279e0f3783b1fe6459b231b1ba` in the existing worktree
       `/workspace/wt/scripting-4a` (`git -C /workspace/wt/scripting-4a
       status` must be clean at that SHA, or block `needs_input`);
     - the revision's §2 contract and §3 steps, tests and proofs;
     - the operator's corrections (the comment on `t_4954c617`), still
       binding;
     - the WORKER-CARD REQUIREMENTS comment (779 on `t_92bd68f0`).
   - **The handoff** carries proofs (r1)–(r6) **and** round 1's proofs with
     sub-proofs re-run, with per-file counts and exit codes.
2. **`GLM review r2 — scripting-4a`.** Assignee `atrium-glm`, parent:
   card 1.
   - Its body opens with
     `THIS RUN HAS TERMINAL, FILE AND GIT TOOLS. Use them for every step below.`
   - The reviewer reproduces every proof itself and checks that every test
     in the revision's §3 table exists.
3. **`Review gate r2 — scripting-4a`.** Assignee `atrium-orchestrator`,
   parent: card 2. It creates nothing.
   - **On a valid APPROVE of the exact 40-character SHA,** it blocks with
     `APPROVE <SHA40>: front door, build the release chain`.
   - **Otherwise,** it blocks for the operator with the verdict quoted.
4. **Before you complete,** link card 3 to **round 2's sentinel** as a
   parent. The front door creates it and posts its id on this card. Round
   1's sentinel `t_6ad50332` must not be used. Do not create a sentinel
   yourself.
5. **The release chain** is the front door's: the same four cards as round
   1 (`devtasks/KICKOFF-library-sky.md`, "Release chain"), with the new SHA.
   The DEV deploy restarts DEV. Nothing reaches MAIN or PROD.

#### Report back
- the three ids;
- the implementation's parent and its 7200 s cap;
- the hash line copied into cards 1 and 2;
- the review's opening line;
- the gate linked to round 2's sentinel.

Then complete this card.

---
