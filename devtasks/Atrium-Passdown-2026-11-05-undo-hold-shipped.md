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
| Board | Round 3's acceptance `t_1deabb33` is done. **Superseded and still blocked: round 1's `t_96969906` and round 2's `t_68a0a48c`.** Archive them (§6) |
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

## 5. Follow-ups
1. **Next: the `add` work.** `PREBRIEF-richer-add-copy.md` is DRAFT Rev 0.1
   at `923bd444`, with decisions RA-L1–RA-L6 and CP-L1–CP-L7 open. RA-L2 (c)
   is recommended after the operator's discussion.
   - **Its outside review hasn't been sent.** The prompt is
     `devtasks/OUTSIDE-REVIEW-PROMPT-richer-add-copy.md`, pinned to
     `923bd444`.
   - Its §2.3 defect is live on PROD (§1).
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

## 6. Cleanup (operator, on the host)
```bash
hermes kanban --board atrium archive t_96969906
hermes kanban --board atrium archive t_68a0a48c
git -C /root/.hermes/sandboxes/docker/default/workspace/atrium push origin --delete workflow/undo-hold release/a096cf3f8fcf release/4f66f93b7f8b release/2f28f030ec72
```
The last line is optional, and 4d-1's five `release/*` refs can go the same
way.
