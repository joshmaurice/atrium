# Passdown 2026-11-05: undo-hold shipped to PROD (`8fc82bb5`)

This supersedes `Atrium-Passdown-2026-10-31-scripting-4d-1-shipped.md` as the
starting point. Read this file first. That passdown's host, connector and
convention notes still hold, and so does its §5 follow-up list (carried in §5
below).

**First instruction for the next session's Claude:**
1. Clone the repo and read this file. Then read
   `devtasks/PREBRIEF-richer-add-copy.md` (DRAFT Rev 0.1), the next work.
2. **Use the `atrium-ops` connector for board, release, log and git state.**
   It is read-only. To push `devtasks/` to `main`, attach the repo with push
   access (`add_repo`, `joshmaurice/atrium`, access `push`) and clone to
   `/home/claude/atrium`.
3. **The release rule is unchanged:** from a round's DEV release merge until
   PROD is `COMPLETE`, push **nothing** to `main`. A revision for a round that
   supersedes an unaccepted DEV is the exception (§3.4).
4. **The harness** (`devtasks/harness/`) runs the real code here.
   - `setup.sh <SHA>` builds it; a second root (`HARNESS_ROOT=/tmp/ah-base`)
     lets you compare two SHAs side by side.
   - Start servers in their own Bash call.
   - Stop them by pid, never with `pkill -f` (§3.5).
5. **Give the operator host commands with no leading spaces.** A heredoc
   inside an indented Markdown list never ends (§3.5).

## 1. Where things stand

| What | State |
|---|---|
| Release | `COMPLETE`. DEV = MAIN = PROD = **`8fc82bb5203ecbbf6f862d7d5839c111f916e77f`**, which is round 3's reviewed tip `2f28f030` plus `main`'s `devtasks/` notes (the same code). Healthy (`/api/health` ok on both). PROD's `app.js` is `263624977af7` |
| Board | Round 3's acceptance `t_1deabb33` is done. **Superseded and still blocked: round 1's `t_96969906` and round 2's `t_68a0a48c`.** Archive them (§7) |
| Branches on GitHub | `workflow/undo-hold`, and `release/{a096cf3f8fcf,4f66f93b7f8b,2f28f030ec72}` beside 4d-1's five. All can be deleted (by the operator) |
| `main` after the release | this file, `h6.py` and the outside-review prompt, all under `devtasks/`, pushed after `COMPLETE` |
| **Still live on PROD** | **the `add` defect** (`PREBRIEF-richer-add-copy.md` §2.3): an anonymous visitor's malformed avatar `add` stops joins to that world while they stay. RA-L1 asks whether to fix it alone first |

## 2. What shipped (undo-hold, three rounds)
**The contract:**
- `PREBRIEF-undo-hold.md` FINAL Rev 1 (`8bed4521`);
- `KICKOFF-undo-hold.md` (`5a2bf360`);
- `REVISION-undo-hold-round-2.md` (`6790a194`);
- `REVISION-undo-hold-round-3.md` (`68c694e7`).

All of round 1's and 2's work is client-only and in `apps/client`; round 3
also changed `library-grid.js` and `sky-picker.js`.

| Round | What it fixed | Found by |
|---|---|---|
| 1 (`a096cf3f`) | **A behaviour stopped after Undo** and restarted when another object was edited. 4b-2's drag-rule hold was set by every tracker send, but cleared only by a recorded settle, and Undo's and Redo's sends are unrecorded. Now the tracker reports `onNodeIdle`, and the hold (`createBehaviorHold`, kept by node object) is released then | the operator; reproduced by `h1.py` |
| 2 (`4f66f93b`) | **A move drag of a spinning model sometimes became "Transform"** and its Undo was refused: the drag copied all three fields, and a behaviour echo in flight changed the rotation. Now `handleUpdate(gizmo.mode, …)` records only the handle's field. The edit session's end clears the hold | the operator's DEV test; `h4.py`: 4 of 12, then 12 of 12 |
| 3 (`2f28f030`) | **The Library tiles and the sky list flickered** and a tile couldn't be clicked: every `som:set` rebuilt them. Now they rebuild only on a key change. **A typed edit of the field a behaviour writes went unrecorded,** and Undo silently undid the step before it. Now a behaviour's own echo (`ownEchoSet`) updates the server value without counting as another session's change | the operator's DEV test (`h5.py`: 27 rebuilds in 2 s, then 0); Claude's regression run (`h3` check 4) |

**Each round's checks:**
- GLM review: APPROVE every round, with the proofs reproduced and a test of
  its own each time.
- Claude's browser checks before DEV acceptance. Rounds 2 and 3 used `h1`–`h5`
  and 4d-1's `c2`, and round 3 added `h6`.
- **Rounds 2 and 3 found problems that already existed on PROD** (the drag
  rotation, the flicker, the unrecorded edit), each confirmed on `8ff7000` in
  a second harness root. Round 1 had hidden them, because a behaviour stopped
  at the first Undo.

## 3. Lessons and incidents

### 3.1 The kickoff's `parents` didn't take (round 3)
- Both `kanban_create` calls in round 3's kickoff landed parentless
  (`parents: []`). The guard then promoted them, and **the GLM review was
  claimed while the implementation was still running.**
- The review found the implementer's commit in the shared object store and
  reviewed it **without the handoff.**
- **What was done:**
  - Claude ruled the run void unless (a) its APPROVE SHA equals the
    implementer's `tip_sha`, and (b) the run started after the
    implementation completed;
  - both reports were then compared: the same SHA (`2f28f030`), no
    deviations, six proofs on both sides, and the commit touches only
    `apps/client`, so the suites GLM didn't rerun can't differ;
  - so **(b) was waived for that run**, on the operator's word.
- **For the kickoff template:** create each card, read its parent back, and
  only then create the next.

### 3.2 A GLM completion lost its payload (round 1)
- The round-1 review completed as a bare `APPROVE`, with no SHA in the
  summary or metadata. The verdict was in a later comment, and the front door
  rescued it.
- From round 2 on, the review card says "put the verdict, the SHA and the
  findings in the completion summary itself". That worked twice.

### 3.3 The "Runtime cap" in a card's notes is static
- The operating notes' "Runtime cap: 90 minutes" is written once, when the
  card is created.
- **The enforced value is the database column `tasks.max_runtime_seconds`,**
  raised on a `todo` card with the models-by-url passdown §5.3 recipe.
- Hermes read the notes and reported the raise as not done. The read-only
  `SELECT` showed 7200.

### 3.4 Folding fixes into a round
- **Rounds 2 and 3 were folded in rather than released one by one,** on the
  operator's call. That's one MAIN/PROD release instead of three.
- A revision for a round that supersedes an unaccepted DEV is pushed to
  `main` while the earlier round is on DEV. Its release merge is never
  promoted, and the next DEV deploy makes a new one.
- The superseded acceptance cards stay blocked until cleanup.

### 3.5 Session mechanics
- **`kill $(pgrep -f "authserver.mjs")` in the same command line as a new
  server start kills that shell itself** (exit 144). Stop by pid in its own
  call: `ps -eo pid,args | awk '$2=="node" && $3 ~ /authserver/ {print $1}' | xargs -r kill`.
- **A heredoc in an indented list picks up leading spaces,** so bash never
  sees `EOF` and waits at `>`. This happened twice to the operator.
- **An automatic background-task notice appeared in a reply** as if
  addressed to the operator. It was harmless, and it was explained to them.

## 4. Harness checks added (`devtasks/harness/checks/undo-hold/`)

| Check | What it does |
|---|---|
| `h1.py` | the original stuck-hold repro (its checks 3–4 now "fail", which means fixed) |
| `h2.py` | one handle-drag move with Undo |
| `h3.py` | round 1's checks: Undo, Redo, another object, the typed rotation (round 3's R5), the drag rule, scale |
| `h4.py` | 12 mouse-like move drags on a spinner, each undone |
| `h5.py` | Library and sky rebuilds in 2 s with a spinner running, and a real tile click |
| `h6.py` | the Library shows its tiles; a sky picked in one tab shows in another, and back |

They run on `checks/signin-sync/authserver.mjs` with `HOOKS=1`, as
`checks/scripting-4d/` does.

## 5. Where Phase 3 stands (`docs/DESIGN-phase3-placement-scripting.md` §9)

| Step | What | State |
|---|---|---|
| 0, 0b | source-ref guard; Create stops copying the commons | done |
| 1–3 | Edit mode, undo/redo, models by URL, library and sky | done |
| 4 | the scripting runtime: 4a, 4b-1/2, 4c, 4d-1 (plus this undo-hold fix) | **done**. 4d-2 and the other `PREBRIEF-scripting-4d.md` §10 extras are optional add-ons, not plan steps |
| **side track** | **the `add` check, the richer `add`, copying objects** (the 10-19 copy-objects passdown; `PREBRIEF-richer-add-copy.md`) | **next, by the operator's choice (2026-11-02)**, ahead of step 5. The richer `add` has to come before step 7 at the latest |
| 5 | the graphical behaviour editor (design §5.6: evaluate the Khronos authoring tool first; it's React, against Atrium's no-build rule) | **next in the plan, after the side track** |
| 6 | owner-only JavaScript in a Web Worker | after 5 |
| 7 | export and import of objects | last |

## 6. Follow-ups
1. **Next: the `add` work.** `PREBRIEF-richer-add-copy.md` is DRAFT Rev 0.1
   at `923bd444`, with decisions RA-L1–RA-L6 and CP-L1–CP-L7 open. RA-L2 (c)
   is recommended after the operator's discussion.
   - **Its outside review hasn't been sent.** The prompt is
     `devtasks/OUTSIDE-REVIEW-PROMPT-richer-add-copy.md`, pinned to
     `923bd444`.
   - Its §2.3 defect is live on PROD (§1).
   - **Update (later on 2026-11-05):** two outside reviews came back, both
     CHANGES REQUESTED (`REVIEW-richer-add-copy-rev0.1-{claude,chatgpt}.md`).
     The pre-brief is now **DRAFT Rev 0.2**, with decisions RA-L1–RA-L8 and
     CP-L1–CP-L7. The defect is wider than Rev 0.1 said: it includes a world
     that saves but can't be loaded, and a single message that stalls the
     server. See its §9.
   - **Then:** the operator ran `p6` on PROD (23 worlds, none unreadable,
     nothing saved that the check would refuse), decided RA-L1, L4, L5, L7
     and L8 (a), and `add-check` was split out as
     **`PREBRIEF-add-check.md` FINAL Rev 1.1** (base `25f6b083`), with
     **`KICKOFF-add-check.md`** ready for the front door. The combined
     pre-brief stays a draft for `richer-add` and `copy-objects`.
   - **`p6` rerun at `6980e24` (operator, 2026-11-05 14:26 PT), with the
     Rev 1.1 counters:** 23 worlds, none unreadable; **nothing saved that
     `add-check` or the new `send` ranges would refuse**, including the cases
     the first run didn't check (`PREBRIEF-add-check.md` §2.6). The spec's §6
     rerun before the PROD deploy still applies, in case worlds change.
2. **The Behaviour panel shows only "Custom graph"** for an imported graph:
   no file name (none is stored) and no targets, though they are stored.
   UH-L2 put the targets display in the copy round. The file name needs a
   stored field, like the copy's credit.
3. **The hold names one node** (`PREBRIEF-undo-hold.md` §2.4): a quick edit
   to A and then B leaves A without the hold while A's edit is in flight. No
   one has reported it.
4. **4d-1's carried items,** unchanged:
   - the Behaviour on/off button reads as an action;
   - the R30 test helper's path;
   - the documented lock limits.
5. **`c2.py` failed check 3 once on `4f66f93b`** ("steady host"), then passed
   four runs. It's a timing flake; rerun it once before reading anything into
   it.
6. **Two behaviour-driven objects moving at once are choppy** (operator,
   2026-11-05). Turning either off restores the other.
   - **This is by design.** A world's behaviour sends share **one queue: one
     send every 50 ms, 20 a second for the whole world**, taken in turn by
     every changing key (`PREBRIEF-scripting-4b-2.md` §F7, L978;
     `runner.js` L19 and L61). So two spinners get 10 updates a second
     each, and three about 7.
   - **Nothing smooths between steps, for the host too:** the host applies a
     value on its echo (`PREBRIEF-scripting-4d.md` **G-L5 (a)**, L944,
     approved as "an explicit, temporary departure" from the design's
     "continuous motion never goes over the network", design L570). The
     importer's note says "Visitors see this motion in steps, not smoothly."
   - **The options,** each needing a short pre-brief:
     - **(1) renderer smoothing:** each client glides between the updates
       it receives for behaviour-driven objects. It's client-only, covers
       `onTick` and interpolations alike, adds about one step of delay and
       no traffic. It's a new decision next to G-L5 (a), not a reversal.
       **Claude's pick;**
     - **(2) several keys per send:** each spinner keeps 20 a second, but
       traffic grows with moving objects. It changes F7's budget;
     - **(3) the synced transition,** G-L5 (b) in 4d's §10: smooth, one
       send per interpolation, but it doesn't cover an endless `onTick`
       spin.
   - **The workaround today:** a glTF animation in the model, with the Play
     animation template. Every client plays it locally.
   - **Where it goes:** the operator wants it recorded; it isn't scheduled
     yet. It fits after the `add` check, or as its own small client round.

## 7. Cleanup (operator, on the host)
```bash
hermes kanban --board atrium archive t_96969906
hermes kanban --board atrium archive t_68a0a48c
git -C /root/.hermes/sandboxes/docker/default/workspace/atrium push origin --delete workflow/undo-hold release/a096cf3f8fcf release/4f66f93b7f8b release/2f28f030ec72
```
The last line is optional, and 4d-1's five `release/*` refs can go the same
way.
