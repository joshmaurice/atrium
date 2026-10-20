# Atrium Passdown — 2026-10-19 — Edit mode polish 2 (full pipeline)

**Predecessor:** `devtasks/Atrium-Passdown-2026-10-19-edit-tweaks.md`. Its
host, connector and follow-up state still holds, except where this file says
otherwise.

**First instruction for the next session's Claude:**
1. Clone the repo and read `devtasks/`, newest first.
2. If the `atrium-ops` connector's tools are listed, use them for board,
   release, log and git state. It is read-only.

## 1. Status at handoff

| Item | State |
|---|---|
| Release | **COMPLETE** (2026-10-19 ~21:15 PT), checked through the connector: DEV, MAIN and PROD at `229c4a87a3b9622f0a70b4d18c652d0127caba42`, all recorded, both healthy, deploy lock free, **no warnings**. Nothing ready or running; one stale blocked card (§4.3) |
| Base | `a2590cfe` (`main` with the pre-brief uploaded) |
| Spec | `devtasks/PREBRIEF-edit-polish-2.md`, FINAL Rev 1 (L1–L6 all as recommended; no outside review of the pre-brief) |
| Lane | **full pipeline** (L1) |
| Branches | `claude/prebrief-edit-polish-2`, `workflow/edit-polish-2`, `claude/passdown-edit-polish-2` (this file): for the operator to delete when done |

**Board, this round:**
- **First graph (dead, §4.1):** kickoff `t_68642a4c` (triage), sentinel
  `t_008e04ab` (superseded), children `t_63bef732`, `t_e6aaa408`,
  `t_a8b72432`, `t_a0870f27`, `t_0f4e9409`. Spec comments 522–524,
  requirements 525 live on `t_68642a4c` and the second graph points at them.
- **Second graph:** continuation kickoff `t_e1c8980d`; sentinel `t_bf87d740`
  (fired early, §4.2); GLM brief `t_7b74f9b3`; brief gate `t_e234d5de`;
  implementation `t_b2594f38`; GLM review `t_791c97a0` (APPROVE
  `229c4a87`, no findings); review gate `t_069cf4d7` (gave up, §4.3);
  publish `t_9f3455b5`, DEV deploy `t_ab6bbcd1`, DEV finalizer
  `t_56f96419`, acceptance gate `t_2bc72fac`; PROD deploy `t_eeb10fab`.
- **To archive** (operator): the seven dead cards above and `t_069cf4d7`.

### 1.1 Timeline (PT)
~18:00 probes at `906ee05` · 18:16 L1–L6 approved · ~18:35 pre-brief on
`main` (`a2590cfe`) · 18:49 kickoff · 18:52 first kickoff in triage · 18:54
continuation · 18:55 graph rebuilt · ~19:35 brief gate completed by the
operator · ~20:00 DEV (implementation, GLM review, publish, DEV deploy) ·
20:08 Claude's §5.1 checks 21/21 · outside code review APPROVE with
follow-ups · ~20:55 operator DEV acceptance · ~21:15 MAIN and PROD.

## 2. What shipped

`apps/client` and `packages/renderer-three` only (10 files, +616 −338). No
server, protocol, SOM or `packages/client` change; no DEV restart.

- **Teleporters live in Edit mode** (Z3, L2, L4): a **Teleporter** button,
  last in the Add palette (no `data-kind`), opens the destination form,
  which now sits inside the Edit panel, titled "New teleporter". The pad
  lands 2.5 m ahead on y = 0, like a palette add, and is named `Teleporter`,
  `Teleporter 2`… Its add is a structural request recorded with
  `undo.registerAdd`, so **Undo removes it and Redo brings it back**, label
  and trigger included (S1, rebuilt from `som:add`/`som:remove`). A
  rejection shows in the form; Cancel, Escape, Edit off and a reconnect
  close it. **Existing `teleporter-<uuid>` pads keep their names.**
- **Place Teleporter retired** (Z4): the toolbar button, its Cancel, the
  click-to-place mode and its bookkeeping. `edit-modes.js` has no teleporter
  mode at all (Z1, L6): triggers are active exactly when Edit is off.
- **A pad restored under the avatar waits** (L3, Z5): unchanged behaviour,
  now pinned by tests; it fires only after the avatar steps off and back on.
- **The key-wiring guard** (Z6, L5): `apps/client/tests/edit-key-wiring.test.js`
  reads `app.js` as text (weaker than specified, §4.5).
- **`addBackFace` refuses** non-indexed, interleaved and empty geometry
  before changing anything (Z2).

**Tests:** `apps/client` 506 → **520**; renderer-three 98 → **102**;
`packages/client` 169 and interaction 9 unchanged. Proofs (a)–(e), (e2),
(e3) reproduced; Claude reran both suites on the published SHA.

## 3. How the round ran

1. **Pre-brief** from probes at `906ee05`; six decisions, all taken as
   recommended. The probes found item 3's arbitrary-string test had nothing
   to test once item 1 removed `'placement'` (L6).
2. **Kickoff** posted by the front door from Claude's body. First graph lost
   to triage; a continuation rebuilt it (§4.1–§4.2).
3. **Brief review** by Claude (faithful; three non-blocking notes), then the
   operator completed the brief gate from the host (§4.4).
4. **Pipeline to DEV** with no intervention after the brief gate, although
   the review gate gave up (§4.3).
5. **Claude's §5.1 checks** (21/21, headless Chromium, fresh server per run),
   the **outside code review**, then **operator acceptance** (all steps but
   one passed: §4.6).

## 4. Findings

### 4.1 A bare `kanban_block` triaged the first kickoff
The first kickoff run built the whole graph correctly, then called
`kanban_block` **without a `task_id`**, meaning to block the brief gate. A
worker's bare block acts on its own card, so it blocked the kickoff, using
the `OPERATOR BLOCK` wording its body forbade. With its earlier "dispatched
before the spec" block that was a second consecutive `needs_input` block:
**triage**, which is terminal. The kickoff could never complete, so its
children could never promote. Nothing was implemented or deployed.
**Lessons:** a kickoff never calls `kanban_block` without an explicit
`task_id` and never blocks its own card; hardening the brief gate is the
front door's job (the gate is born blocked). Now in the kickoff body
(Appendix A).

### 4.2 The continuation's sentinel fired at once
The front door's continuation parented the replacement sentinel only on
the continuation kickoff, so it promoted when that kickoff completed, before
any work ran. Last round the front door's instruction had the kickoff link
the review gate to the sentinel; the continuation omitted it. Progress was
reported by the front door instead. **Lesson:** the kickoff links the
review gate to the sentinel before it completes; the review gate adds the
DEV finalizer before it completes. Recorded in the front door's skill and in
the kickoff template.

### 4.3 The review gate ran out of budget; the chain was built anyway
`t_069cf4d7` used its 150 iterations in 4 minutes "verifying the reviewed
SHA" (git in the shared checkout, kickoff comments) and gave up. Last
round's gate took 17 s. The release chain was then created by an
orchestrator run at 03:00 UTC (the gate card doesn't say which), and it
deployed correctly. Likely contributors: the continuation's gate body pointed
at the dead card's large comment set, and the gate tried to re-verify the
SHA with git rather than from the GLM handoff. **Worth a line in the next
review gate body:** take the SHA from the GLM verdict's metadata; no git, no
reading the spec.

### 4.4 Releasing the brief gate means the operator completes it
Claude said "release it however you did last round"; that was vague. Last
round the operator **completed** `t_9ffbbdbc` from the host. Unblocking
would have sent the gate to `ready`, an agent would block it again, and two
consecutive `needs_input` blocks mean triage (Hermes caught this). The
command is in §6.2.

### 4.5 Outside code review: APPROVE with follow-ups
Separate session, read-only, mutation tests (its container couldn't run the
full suites; Claude had: 520 and 102).
- **Should-fix:** the key-wiring guard reads only the text **before** the
  handler's body, so a capture argument after it is never seen; Z6 required
  that check. The shipped listeners use no capture (Claude's probe). Also a
  commented-out or `if (false)` consume call passes, a limit of reading text.
- **Should-fix:** no committed test of the form's state machine (accepted,
  rejected, unknown, re-click, Edit off, reconnect, late Y7 answer). Five
  `app.js` mutations there pass the guard; Claude's §5.1 checks cover them
  but aren't committed.
- **Nit:** after a rejection, a retry leaves the old error showing while
  "Saving…".

### 4.6 Operator acceptance: no spawn warning when dragging a pad
The form's spawn warning is computed only when the form opens, for the pad's
landing point (2.5 m ahead), so it is hard to see now and dragging a pad onto
spawn never warned (nor did it before). Accepted as is: pads arm only after
you step off them, so spawning on one is harmless. Optional follow-up.

### 4.7 Smaller notes
- The implementation card's runtime cap came out at **90 minutes**, though
  the continuation asked for 180; the dispatch default wins. The run took
  well under that.
- The connector's `git_diff_stat` with `origin/main` compared against a stale
  main after `git_fetch_mirror main`; full SHAs worked. Use full SHAs.
- The front door verified the pre-brief's hash and the PART split by
  character arithmetic before releasing the kickoff: keep that.

## 5. Follow-ups

### 5.1 A small next round (Edit mode polish 3), or ride along with another
1. **Key guard** (§4.5): check the arguments after the handler too (capture),
   and strip comments before matching.
2. **Form-state tests** (§4.5): most likely lift the form's logic out of
   `app.js` into a pure module with a fake-element harness.
3. Hide the form's old error when a new Save starts.
4. Optional: a hint when a pad is dragged onto the spawn area (§4.6).

### 5.2 Next in sequence
- **Pass B** (connector writes, `atrium-ops`
  `docs/PREBRIEF-s22-pass-b.md`, Rev 3 + §13): its design still keeps
  kickoffs with the front door (Q6, §11). Hands-off kickoffs would be a
  separate, later pre-brief.
- **Step 3:** models by URL, starter library, sky.
- §5.1 above when there's a gap. Order is the operator's call.

### 5.3 Carried
Everything open in the edit-tweaks passdown §5.2–§5.4.

## 6. Recipes

### 6.1 Is this tab running edit-polish-2? (browser console)
```js
document.getElementById('tp-place-btn') === null && !!document.getElementById('ep-teleporter')   // true at 229c4a87 or later
```

### 6.2 Complete the brief gate (VPS shell)
```
hermes kanban --board atrium complete <brief gate id> --result "OPERATOR: <slug> brief approved"
```
Complete, never unblock (§4.4).

### 6.3 The kickoff body
Appendix A: this round's body with §4.1–§4.2's lessons folded in. Copy and
adapt: slug, base, spec facts, PART ranges, files, steps, proofs. The front
door posts the PARTs, requirements and sentinel.

### 6.4 Accept, MAIN and PROD (VPS shell)
```
S=<40-char sha>
hermes kanban --board atrium complete <acceptance gate id> --result "OPERATOR: <slug> DEV accepted ($S)"
atrium-main-approve $S && atrium-main-push $S
atrium-release-status | sed -n 1,12p
```
then the teleport-rearm passdown §7.2 guarded PROD block with `S` set.

### 6.5 Claude's headless checks (scratch, not committed)
As edit-tweaks §6.3, with three changes:
- the `view` bundle's entry is `dist/view.modern.js`;
- `ws` loads from `packages/server/node_modules/ws/wrapper.mjs`;
- the static server must answer `/api/auth/me` with **401**, or the page
  throws "Session check failed (404)".
Hooks used: `window.stage.avatar.localNode.translation` to move the avatar;
a `WebSocket` constructor proxy to count connections; dropping one `add` in
`WebSocket.prototype.send` and emitting `edit:rejected` on
`window.atriumClient` to stub a refusal.

## Appendix A. The kickoff body, improved after the round

The text posted on `t_68642a4c` lacked three things now included: the
bare-block rule (§4.1), the sentinel link before the kickoff completes
(§4.2), and the no-new-sentinel line in the DEV finalizer template. The body
is between the two rules below.

---

**FRONT-DOOR NOTE (verified before this card was created).** Base `base_main_sha = a2590cfe64f0f269fd1b89dc8f354f2ddd858ed2` (= the operator's host fetch of `origin/main`), verified to carry `devtasks/PREBRIEF-edit-polish-2.md`: 436 lines, 26,015 bytes, sha256 `3b1d20a65f2bee15b35808330ed58a652bceb1f51fdd870e39c22db84c6cbf40` — exactly as stated below. `workflow/edit-polish-2` does not yet exist on the remote. The front door is posting the spec as the numbered comments PART 1/3, PART 2/3, PART 3/3, the `WORKER-CARD REQUIREMENTS (canonical)` comment, and the sentinel's id. **Do not build anything until PART 1/3–3/3 and the requirements comment are present**; if you are dispatched before then, `kanban_block(kind="needs_input")` and do nothing else.

---

### KICKOFF — Edit mode polish 2 (after the edit-tweaks round). Slug: `edit-polish-2`

You are the kickoff orchestrator for this workflow. Build the task graph below, read it back, report, and stop. Do not implement, review or deploy anything yourself. You have only `kanban_*` tools. This body quotes the `OPERATOR BLOCK:` prefix for the gates it describes; **never use that prefix in a block or comment of your own.** **Never call `kanban_block` without an explicit `task_id`, and never block this card:** a bare block acts on your own card and strands the whole graph in triage (2026-10-19). Hardening the brief gate is the front door's job, not yours: create it blocked, read it back, report. Use every title and body below **exactly as written**; do not invent titles (the guard refuses them, 2026-10-18 passdown §4.3).

**Wait for all three PART comments and the requirements comment before building anything.** If you are dispatched before they are all present, block with `kind="needs_input"` and do nothing else (10-18 §4.2).

#### Where the spec is — read it from THIS card's comments, not from a path
The complete pre-brief is posted on this card as numbered comments: **PART 1/3 … PART 3/3** (split on section boundaries). Treat their concatenation, in order, as the whole spec. There is **no** "go read the repo" step anywhere in this workflow.

- **Spec:** `devtasks/PREBRIEF-edit-polish-2.md`, **FINAL Revision 1 (2026-10-19)**, **436 lines**, sha256 **`3b1d20a65f2bee15b35808330ed58a652bceb1f51fdd870e39c22db84c6cbf40`**.
- **Completeness table:**

| Spec section | Lines | Comment |
|---|---|---|
| Title/status, §1 What this round is, §2 P1–P7 | 1–169 | PART 1/3 |
| §3 Decisions S1, L1–L6, §4 Contract Z1–Z7, §5 Tests and §5.1 | 170–349 | PART 2/3 |
| §6 DEV acceptance, §7 Worker rules and release path, §8 Notes for the brief author, §9–§11 | 350–436 | PART 3/3 |

- **The worker-card requirements** are posted on this card as a separate comment headed `WORKER-CARD REQUIREMENTS (canonical)`. Card bodies **reference that comment on this kickoff by its id**; they never point at a host path.

#### Settlement (operator) — do not reopen
- **Base:** `base_main_sha = a2590cfe64f0f269fd1b89dc8f354f2ddd858ed2` (an operator host fetch of `origin/main`, which carries the pre-brief). Workflow branch: **`workflow/edit-polish-2`**, worktree `/workspace/wt/edit-polish-2`.
- **Scope:** implement **§4 (contract Z1–Z7)** per the approved decisions **S1 and L1–L6** (§3). Everything listed out of scope in the status block stays out. The decisions are not to be re-derived or re-argued in the brief.
- **Files:** `apps/client` (`app.js`, `index.html`, `edit-modes.js`, `edit-palette.js`; their tests; new `tests/edit-key-wiring.test.js`; new `teleport-trigger` tests) and `packages/renderer-three/src/geometry-utils.js` with its tests. **`teleport-trigger.js` does not change. No server, protocol, SOM or `packages/client` change.** If the brief or the implementation finds one is needed, stop and ask.
- **Full-pipeline round** (L1): the operator's outside code review of the published SHA, and Claude's checks (§5.1), happen before DEV acceptance.

#### Graph — build exactly this
1. **GLM brief** — assignee `atrium-glm`. Parent: this kickoff. Title: `GLM brief — edit-polish-2`. Its card must carry (a) the **whole pre-brief verbatim**, copied from this card's PART comments and concatenated in order (do not summarise, renumber or omit §10–§11), (b) this kickoff body, and (c) a reference to the worker-card requirements comment on this kickoff.
2. **Operator brief-review gate** — assignee `atrium-orchestrator`, title exactly `OPERATOR BLOCK: awaiting human brief review — edit-polish-2`, created with `initial_status="blocked"`, parent = the GLM brief. Body exactly: `OPERATOR BLOCK: human brief-review gate. Only the operator completes this. An agent dispatched here must kanban_block(kind="needs_input") on this card and do nothing else.` Read it back and confirm `status == "blocked"` with no runs. (The front-door profile watches for this gate turning `ready` and blocks it.)
3. **DeepSeek implementation** — assignee `atrium-deepseek`. Title: `Implement — edit-polish-2`. **Parent MUST be the gate** (step 2), not the brief. Created with **`--max-runtime 3h`** (it can't be changed later). Its body carries the ordered step list from pre-brief §7 (one commit per step), the requirements below, and the worker-card requirements reference.
4. **One GLM review** — assignee `atrium-glm`. Title: `GLM review — edit-polish-2`. Parent: the implementation. A **single** review; a re-review after a revision is also a single GLM review. Its body opens with the exact line `THIS RUN HAS TERMINAL, FILE AND GIT TOOLS. Use them for every step below.`
5. **Review gate** — assignee `atrium-orchestrator`. Title: `Review gate — edit-polish-2`. Parent: the review. It expects **only** the GLM verdict. Its body must contain the **Release-chain templates** section below, verbatim. With a valid APPROVE naming the exact 40-character SHA, it creates the four cards from those templates, with `<SHA40>` replaced by that SHA and `<sha8>` by its first 8 characters, each parented on the previous one as listed, and adds the DEV finalizer as a parent of the sentinel. With a missing, malformed or non-APPROVE verdict it creates **nothing** and blocks for the operator.
6. **Sentinel** — the front-door profile creates it right after this kickoff and posts its id here; it is parented on this kickoff. **Before you complete, link the review gate you created to the sentinel as an additional parent** (`kanban_link(parent_id=<review gate id>, child_id=<sentinel id>)`): with this kickoff as its only parent, the sentinel fires the moment you complete (2026-10-19). The review gate then adds the **DEV finalizer** as a further parent before it completes, so the sentinel waits for the finalizer; the review gate never completes the sentinel or treats itself as the round's end. If a revision round is created, its DEV finalizer is added as a further parent. Do not create a second sentinel; never complete it early.
7. **Nothing reaches MAIN or PROD.** Those are host-side, operator-approved steps.

#### Release-chain templates (for the review gate's body — copy verbatim)
Every body carries the full 40-character SHA; the guard refuses a stage card without it.

1. Title `Publish workflow — <sha8>`, assignee `atrium-deployer`, parent = the review gate. Body:
`Publish the GLM-approved SHA <SHA40> to workflow/edit-polish-2 with exactly one call: atrium_deploy(action="publish", sha="<SHA40>", branch="workflow/edit-polish-2"). On any refusal, non-zero exit or unexpected message: do not retry and do not try a workaround; kanban_block(kind="capability") with the complete output verbatim.`
2. Title `DEV deploy — <sha8>`, assignee `atrium-deployer`, parent = card 1. Body:
`Deploy SHA <SHA40> to DEV with exactly one call: atrium_deploy(action="dev", sha="<SHA40>"). On any refusal, non-zero exit or unexpected message (including exit 77, NOT ROLLING BACK, REFUSING, COULD NOT CONFIRM, or a held lock): do not retry and do not run recover; kanban_block(kind="capability") with the complete output verbatim. Report the deployed SHA and the health result in your handoff.`
3. Title `DEV finalizer — <sha8>`, assignee `atrium-orchestrator`, parent = card 2. Body:
`Confirm from the parent DEV deploy's handoff that DEV now runs <SHA40> and that health is ok, then complete with those facts. If the handoff lacks either, kanban_block(kind="capability"). Do not create any sentinel card: the round's sentinel already exists and this card is linked to it as a parent.`
4. Title `Awaiting DEV acceptance / main merge approval — <sha8>`, assignee `atrium-orchestrator`, parent = card 3, `initial_status="blocked"`. Body:
`OPERATOR BLOCK: awaiting DEV acceptance / main merge approval — <sha8> (SHA <SHA40>). Only the operator completes this; an agent dispatched here must kanban_block(kind="needs_input") and do nothing else.`

#### Release path (S22, accepted 2026-10-18)
**Publish, DEV deploy and finalizer cards: one call each. On any refusal, non-zero exit or unexpected message, do not retry and do not try a workaround: `kanban_block(kind="capability")` with the complete output verbatim**, for the operator. A refusal is information for the operator, never a reason to retry (10-18 §4.1).

#### Requirements for the implementation AND review cards (beyond the pre-brief)
1. **Ordered steps, one commit per step** (pre-brief §7): `edit-modes.js` without the teleporter mode; `addBackFace` refusing non-indexed and interleaved input; `teleporterName` and the trigger tests; `app.js` and `index.html` (Teleporter button and form in the Edit panel, palette-path add, Place Teleporter removed, comments); the key-wiring guard; full suites, proofs, handoff. If a run stops to continue, block with `kind="needs_input"` once, and with a different kind for a second consecutive stop (two `needs_input` blocks in a row send the card to triage).
2. **A pad's add is a structural request recorded with `undo.registerAdd`** (pre-brief Z3), answered through `onStructureAnswer`; no second pending-seq bookkeeping. **The Teleporter button has no `data-kind`.**
3. **The handoff includes every proof (a)–(e) plus (e2) and (e3)** with its failing test names, **and** the per-file counts with their commands and exit codes, the Node version, the skipped count and the Z4 grep output. **Commit before running proofs; restore each broken file from a saved copy, never with `git checkout`.**
4. **`apps/client` tests can't import three.js or touch the DOM:** geometry tests live in renderer-three; `teleporterName` and the trigger take plain values; the key-wiring guard reads `app.js` as text.
5. After step 4, `grep` in `apps/client` for every name pre-brief Z4 lists: none may remain. The review checks this too.
6. Tests run in the DEV deploy as `atrium-build` with no network: loopback only.

#### The operator's outside review comes before DEV acceptance
The operator runs an outside code review of the **published SHA**, and Claude runs §5.1's checks, before completing the acceptance gate. **No agent completes that gate.** Your chain stops there.

#### Report back (completion summary)
Every task id; the brief card's id and confirmation that it carries the whole pre-brief; the brief-review gate's id, parent and confirmed `blocked`/no-runs state; the implementation card's id with the gate as its parent and its `max-runtime`; the review card's id; the review gate's id and confirmation that its body carries the four release-chain templates. Then complete this kickoff. Do not start any of the work.

---
