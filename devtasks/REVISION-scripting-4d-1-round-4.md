# Revision — scripting-4d-1 round 4 (round 3 is on DEV, not accepted)

**Status: Rev 1, approved by the operator (2026-10-31 11:40 PT), all as recommended:** R-L6 (a) the canonical
path plus a runbook line; R-L7 (a) the finalizer's rule is what the deploy handoff can show; R-L8 (a) one kernel
lock, through SQLite, that the server and both scripts hold for their whole run. Seven items, R18–R24,
continuing round 3's numbering: two findings from Claude's §6.1 checks on round 3 (F5, F6); three from **the
second outside review** (`REVIEW-scripting-4d-1-round-3-code.md`, in `devtasks/`; NO-GO, source-based: its M1,
S1, S2), **all three reproduced by Claude by running the round-3 code** (§2.5); and two process items. The
kickoff body is §5.

- **Base:** round 3's reviewed tip `769825ce3781b5bb4de03f4d7687b37cd9f0d46a` on `workflow/scripting-4d-1`
  (published). DEV is its release merge `5eebe09fd5b000e70d50a36a9c926e6263d86e80`,
  `WAITING_FOR_HUMAN_DEV_ACCEPTANCE`; **it is not accepted.** Round 4 commits on top of `769825ce` on the same
  branch, one commit per step, and redeploys DEV over round 3 (`set-dev` from waiting-for-acceptance, as round 3
  did over round 2).
- **Round 3's cards:** kickoff `t_2e18372a`; steps `t_c461f16c`, `t_81e24585`, `t_d6659dcf`, `t_6c9b8c2f`,
  `t_35a69aed`; GLM review `t_093266a3` (APPROVE `769825ce`); gate `t_06f75ed0`; chain `t_40c2e44b`,
  `t_313aec4f`, `t_7e0acd73` (finalizer, completed by the operator), `t_b6db79eb` (acceptance); sentinel
  `t_7e8edf61` (done). **`t_b6db79eb` is not completed:** round 4 supersedes it, as round 3 superseded
  `t_f56db644`.
- **The contract still governs:** `PREBRIEF-scripting-4d.md` FINAL Rev 1.4 at `4f19b253` (sha256
  `457e2ff0…9458`), with round 3's Rev 1.5 notes on the branch; `KICKOFF-scripting-4d-1.md` at `1a26d8fa`;
  `REVISION-scripting-4d-1.md` (R1–R5, R-L1 (a)) at `c89eb69c`; `REVISION-scripting-4d-1-round-3.md` (R6–R17,
  R-L2–R-L5 (a)) at `025a2195`. **This file adds R18–R24 and Rev 1.6 notes to the pre-brief, and changes
  nothing else, with one exception:** under R-L8 (a) it replaces the *mechanism* of R-L2 (a)'s lifetime lock
  (a lock file), which the review showed is not mutually exclusive, and keeps R-L2 (a)'s decision: a lock the
  server holds for its lifetime, which the scripts check. The R5 rules (one card per step, every item
  answered, never complete with an item undone, check the predecessor first) carry over unchanged.

## 1. What round 3's checks found
Claude's eleven §6.1 checks on `5eebe09f`: **ten pass; check 1 passes except its R16 line.** Check 11 passed
locally (20/20) and on the host (a copy of PROD's database; a copy of DEV's, with 9 real template leaves; the
lock refusing against DEV's live database). Q7's gates pass with a wide margin (join +0.543 s, heal + serialize
28 ms, heap +2.5 MB). Evidence: `devtasks/harness/checks/scripting-4d/README.md`, "Results on DEV `5eebe09f`",
and the passdown `Atrium-Passdown-2026-10-31-scripting-4d-1-round-3-checks.md` (at `8fadf87`).

- **F5 (LOW; R16 not delivered, and the Q3 prompt never named objects).** `apps/client/src/app.js` L3222 (the
  Behaviour form's `nodeName`, which the Q3 Enable prompt uses) and L3268 (the import panel's) are both
  `(id) => (client.som?.resolveObjectId?.(id)?.name ?? id)`. `resolveObjectId` returns `{ node }` or
  `{ problem }` (`packages/som/src/SOMDocument.js` L1116), never a node, so `.name` is always undefined and both
  texts show the raw id. Seen in the browser (`probe_r16.py`): grant line `It can change: 163c3b30-…`, prompt
  `It can also change: 163c3b30-…`. **Why the tests passed:** every unit test injects its own `nodeName`, and
  `apps/client/tests/behavior-wiring.test.js` L226 pins the wrong expression as text. L3222 was the same in
  round 2. The other callers read the shape correctly (`runner.js` L157 and L272 `?.node`; `behavior-clips.js`
  L60 `resolved?.node ?? resolved`); the outside review checked the same callers and agrees.
- **F6 (LOW; the lock's reach).**
  - **(a)** The 4c server a rollback runs (`14ab0076`) predates R8 and holds no lock, so while it runs the
    scripts can't tell. Rehearsed: a reconcile dry run with 4c up exits 0. §8's procedure never runs a script
    while 4c is up (step 2 is on the copy, step 4 is after the fix is redeployed), so this needs a line in the
    procedure, not code.
  - **(b)** The lock path is the path *string* (`resolveDbPath` and the scripts use `resolve()`; `lockPathFor`
    appends `.lock`). With a server on `/tmp/lk/link.db`, export refused through that spelling and **proceeded
    through a symlink to the same file**. The server's own refusal to start a second server on one database
    has the same gap.

## 2. The contract (round 4)

### R18. Objects are named through the SOM's real return shape (F5)
- **One helper**, exported from a client module the tests can import (suggested: a new
  `apps/client/src/object-name.js`): `objectNameOf(som, id)` → `som?.resolveObjectId?.(id)?.node?.name` when
  it's a non-empty string, otherwise `id`. Every `{ problem }` (`not-found`, `ambiguous`, `unaddressable`)
  gives the id.
- **`app.js` L3222 and L3268 both call it** (`nodeName: (id) => objectNameOf(client.som, id)`); no other copy
  of the expression remains in `apps/client/src/`.
- **Tests, against a real `SOMDocument`** (AGENTS.md: real implementations, no throwaway fakes): a node with
  an `objectId` and a name gives the name; an unknown id gives the id; two nodes sharing an id (`ambiguous`)
  give the id; a nameless node gives the id. Then the two texts end to end through the real helper:
  `enablePromptText(leaf, { nameOf: (id) => objectNameOf(som, id) })` names the target, and the import panel's
  grant line (`graph-import-panel.test.js`, with `deps.nodeName` built from the helper over a real SOM) reads
  `It can change: <name>`.
- **`behavior-wiring.test.js` L226** pins that both `deps` objects call `objectNameOf(client.som, id)`, not the
  old expression.
- **Proof (r18):** restore `?.name` in the helper; the real-SOM tests fail. Restore the file from a saved copy.

### R19. The lock is keyed on the database's canonical path (F6 (b))
- **One function derives the lock's path from the database's,** canonicalising first: when the file exists,
  `realpathSync(dbPath)`; when it doesn't (the server's first start),
  `join(realpathSync(dirname(dbPath)), basename(dbPath))`; when the directory doesn't exist either, the
  `resolve()`d path, as today. The server and both scripts derive the lock through it, so all three agree on
  one lock for one database. The refusal message names the canonical database path.
- **Tests (child processes):** a server started on the real path → export and reconcile through a **symlink to
  the file** both refuse; a server started through the symlink → the scripts on the real path refuse; a
  **symlinked directory** (`<tmp>/alias → <tmp>/real`, the database under it) → refuse both ways; a second
  server through the symlink refuses to start.
- **Proof (r19):** make the function skip canonicalising; the symlink tests fail (the export proceeds).
- **Limit, stated in the code and in Rev 1.6:** a hard link to the database, or the same file reached through
  another mount, is a different path after `realpath`. Out of scope unless R-L6 (b).

#### R-L6. How far the offline check reaches (operator decision)
- **(a) Recommended: canonical path (R19) plus a runbook line (R20).** It closes the symlink gap in code. The
  4c window (F6 (a)) is closed by the procedure, which never runs a script there.
- (b) (a), plus a Linux-only second check: before opening the database, both scripts scan `/proc/*/fd` for any
  process holding the database's inode (`stat` device and inode, so hard links and mounts are caught too) and
  refuse, naming its pid; elsewhere they warn that the check is skipped. It catches a pre-R8 server and any
  other process. About 40 more lines and two tests. The scripts run as root on the host, so `/proc` is
  readable.
- (c) The runbook line only; no code. The symlink gap stays.

**Decided: (a).**

### R20. Pre-brief Rev 1.6 notes
On the branch, in `PREBRIEF-scripting-4d.md`: §0.6 "Revision 1.6 (after FINAL, round 4)" with the notes below;
the status line names Rev 1.6. **No decision changes** beyond R-L8's mechanism.
1. **§8, the procedure, step 3:** "The 4c server you roll back to holds no lifetime lock (it predates R8), so
   the scripts can't detect it. Don't run either script until step 4, after the fixed server has been deployed
   and stopped again; check `systemctl is-active atrium` reports `inactive` first."
2. **G10, the offline check:** under R-L8 (a), what the lock is (R22: a kernel lock that the server and both
   scripts hold for the whole of their run, which the OS releases when its holder exits for any reason); that
   it is keyed on the database's canonical path (R19); and what it doesn't cover (hard links and other mounts;
   under R-L6 (b): "…which the `/proc` check covers on Linux").
3. **G7, the string policy:** both declaration socket maps' keys are identifiers (R23); the review's S1 named
   the gap.
4. **G6, the importer:** the light table is matched to its hosts in one pass over the nodes (R24).
5. **G6/Q3:** objects in the grant line and the Enable prompt are named through `objectNameOf` (R18).

### R21. Full suites, proofs, the handoff (as R15)
Every suite, 0 skipped (per package, as AGENTS.md says; the server's test files one at a time under
`timeout 180`); proofs (r18), (r19), (r22a), (r22b), (r23), (r24), each quoted both ways (break the code, the
named test fails; restore from a saved copy, never `git checkout`; green); the Khronos subset on the build host;
the tip in both the summary and the metadata (`tip_sha`, `step`).

### 2.4 R-L7. The DEV finalizer's criterion (passdown N2; operator decision)
The finalizer's pass rule asks for `TARGET_SHA` equal to `RELEASE_SHA` "from the handoff". `atrium-deploy-gate
dev` prints `RELEASE_SHA=` (the release merge) and then deploys exactly that SHA, exiting 70 without a deploy if
it has none, so a successful deploy's `TARGET_SHA` is the release SHA by construction. But the board's handoff
keeps only the tail of the output, so the finalizer can never see the line, and it has blocked every round
(round 3's `t_7e0acd73`). The finalizer is a front-door card (the release chain), not one of the kickoff's.
- **(a) Recommended: the front door writes the finalizer's rule as what the handoff can show:**
  `DEV DEPLOY SUCCESS` (or `success: true`, `exit_code: 0`), both health lines ok, `reviewed_sha` = the reviewed
  tip, and `TARGET_SHA` a 40-character SHA. The card says why `TARGET_SHA` is the release SHA (the gate script's
  construction) and names `release/<reviewed 12 hex>` as the cross-check for the operator. `SMOKE OK` stays a
  host-journal fact the operator can read.
- (b) Keep the rule; the operator clears the finalizer each round with the one-line command (status quo).
- (c) Have the deployer's handoff carry `release_sha`. That needs the deploy tool to return the gate's first
  lines; it's a host change (atrium-ops), not this repository.

**Decided: (a).**

### 2.5 The second outside review's findings
The review (`REVIEW-scripting-4d-1-round-3-code.md`, range `3cfeeed9..769825ce`) could not clone the repository
or run `pnpm`; it read the source and ran isolated probes. **Its dispositions of round 2's findings:** M1, S2
and N1 fixed; M2 and S1 partly fixed (its new M1 and S1); spec notes 1–3 fixed or specified; R6–R17 each judged
from the source. **Claude reproduced its three new findings with the round-3 code** (`/tmp/atrium-harness/wt`
at `5eebe09f`, code identical to `769825ce`):

- **Its M1 → R22 (HIGH).** Two separate defects in round 3's lock.
  - **The scripts never hold the lock**, they only check it before they start (`behaviors-export.mjs` and
    `behaviors-reconcile.mjs` import `assertServerStopped`, never `acquireServerLock`). A server started
    during a reconcile succeeds, loads the pre-reconcile worlds and can save them over the restore.
  - **The lock file can be deleted under a live server.** The server creates the file (`openSync(…, 'wx')`)
    and writes its pid in a second call, so for an instant it is empty, and a script that reads it then calls
    it malformed and **deletes it**. Reproduced by truncating a live server's lock: `[export] stale lock from
    pid ?, removed (the lock file is not valid JSON)`, export exit 0, the lock file gone, and **a second server
    then started on the same database** (`listening on http://localhost:39991` beside the first). Two
    processes recovering one stale lock can each delete the other's new file; release deletes the path
    without checking it is still its own.
- **Its S1 → R23 (MEDIUM).** `graphStringProblem` (`behavior-spec.js` L398–429; the server copy at
  `send-policy.js` L812–848) walks node `values`, `configuration`, `flows`, variables and event `values`, but
  not `declarations[].inputValueSockets` / `outputValueSockets`, which R-L3 (a) and G7 name. Reproduced in both
  copies: an extension declaration whose `outputValueSockets` key is 65 characters, 1,000 characters or
  `"a\n<b>"` is **accepted** by both. *Narrower than the review states:* a bad `inputValueSockets` key is
  already refused, because the validator requires a node value for every declared input socket and the node
  walk refuses that key (`behavior-type` in both copies). R23 walks both maps anyway, as the contract says.
- **Its S2 → R24 (MEDIUM).** R7's light-host match is a loop over every node for every light
  (`graph-import.js` L265–271), `O(lights × nodes)`, on the main thread. Reproduced with the real
  `parseGraphSource` (Node 22, this sandbox): N nodes and N lights, one host each — 1,000: 31 ms; 5,000:
  208 ms; 10,000: 811 ms; **46,000 (3.15 MiB, under the 4 MiB cap): 33.0 s**, then accepted. The review
  measured 14.7 s at 10,000 in its runtime.

#### R22. One lock that the server and both scripts hold for their whole run (its M1; R-L8)
Under **R-L8 (a)**:
- **The lock is a kernel lock, through SQLite.** Beside the database, a small lock database (`<canonical
  db>.lock.db`, `journal_mode = DELETE`), on which the holder opens a connection with `timeout: 0` and runs
  `BEGIN EXCLUSIVE`, and keeps the transaction open for its whole run. Anyone else gets `SQLITE_BUSY` at once.
  **The OS releases the lock when the holder exits for any reason, including `kill -9`,** so there is no stale
  lock to recover and no recovery race. Claude checked this with `better-sqlite3` (already a dependency): a
  second process is refused with `SQLITE_BUSY database is locked`, and after `kill -9` of the holder the next
  process acquires at once.
- **The server** acquires it at start, before it opens the database, and refuses to start if it can't:
  `another process holds <lock path> (pid N, <what>)`. It holds it until exit.
- **Both scripts** acquire the **same** lock before opening the database and hold it until they have closed it.
  While they hold it, a server can't start (it refuses with the message above), and while a server holds it,
  they refuse (`the world server is running (pid N on <host>)…`). `BEGIN IMMEDIATE` on the main database stays,
  for atomicity only.
- **Who holds it, for the messages only:** the holder writes `{ pid, host, startedAt, role }` to a sidecar
  `<canonical db>.lock.json` after acquiring, and others read it to name the holder. **The sidecar is never the
  lock:** a missing, empty or stale sidecar changes no decision; nothing ever deletes the lock database.
- **The file's owner.** On the host the server runs as its service user and the scripts as root. Whoever
  creates the lock database or the sidecar creates it with **the main database's owner, group and mode**
  (`chown`/`chmod` from `stat` of the database), so a lock database that root's script made first never stops
  the service from opening it later. Test: create it as one user (or with a mode), then acquire as the
  database's owner.
- **The old `<db>.lock` file** is no longer read or written. A leftover one is ignored, and the start logs one
  line naming it (operators may delete it).
- **Tests (child processes; replace `server-lock.test.js`'s three):** (1) a server holds the lock → export and
  reconcile refuse, naming its pid; (2) **a script holds the lock (paused after acquiring, through a test-only
  hook) → a server start refuses**, and once the script exits the server starts; (3) two scripts at once → the
  second refuses; (4) `kill -9` of a holder → the next acquire succeeds at once; (5) an empty, garbage or stale
  sidecar → no decision changes and nothing is deleted; (6) the lock database created with another mode → the
  database's owner still acquires; (7) R19's symlink cases, through the same function.
- **Proofs:** (r22a) make the scripts check without acquiring (round 3's shape) → test (2) fails, the server
  starts while the script holds; (r22b) let the sidecar decide (refuse on a live pid, delete on garbage) → test
  (5) fails.

#### R-L8. The lock's mechanism (operator decision; replaces how R-L2 (a) is built, not what it decides)
- **(a) Recommended: the kernel lock above.** Exclusion is the operating system's; crash-safe by construction;
  no stale-lock recovery to get wrong; one mechanism for the server and the scripts.
- (b) Keep the lock file and harden it: write the pid to a temporary file and `link` it into place (so it is
  never seen empty), the scripts create and hold the same file, release checks the inode is still its own,
  stale recovery renames to a unique name and re-checks. More code, and stale takeover keeps a narrow race
  between two recoverers.
- (c) Leave round 3's lock as it is and rely on the procedure (stop the service, nothing starts it during a
  reconcile). The review's M1 stays open.

**Decided: (a).**

#### R23. The string policy covers both declaration socket maps (its S1)
- `graphStringProblem` in **both copies** applies the identifier rule (1–64, `[A-Za-z0-9_]`) to every key of
  `declarations[].inputValueSockets` and `declarations[].outputValueSockets`, with the same reason code the node
  maps use. The two copies stay text-identical where they are now.
- **Vectors** (`tests/fixtures/behavior-vectors.json`, regenerated, counts stated): for each map, a 64-character
  key accepted, 65 refused, punctuation refused, a control character and `\n<b>` refused; an ordinary extension
  declaration with both maps accepted. Both copies and the validator run them, as G1's tests do.
- **Proof (r23):** delete the declaration-map walk in one copy → its vector test fails (the 65-character
  `outputValueSockets` key is accepted).

#### R24. The importer matches lights to hosts in one pass (its S2)
- `parseGraphSource` builds `Map<lightIndex, hostNodeIndices[]>` in **one** pass over `nodes`, then walks the
  light table and applies the same zero-host and many-host refusals with the same texts. `O(nodes + lights)`.
- **Tests:** the existing orphan, duplicate-host, single-host and distinct-target tests unchanged; a scale test:
  20,000 nodes and 20,000 lights, one host each (1.36 MiB), parses in **under 2 s** on the build host. Measured
  here with the round-3 code: 4.9 s, against 28 ms for the same parse without the lights, so the limit
  separates the two with room on a slower host.
- **Proof (r24):** restore the nested loop → the scale test fails on time.

## 3. The cards, their steps and their items
R5's rules hold: **one card per step**, the items listed in the body, the handoff answers each one with files
and test names, never complete with an item undone, check the predecessor first, progress comments. **Each
card's body says: "The review is a single GLM review; Nemotron is benched (F-8)."** Commit subjects:
`scripting-4d-1 round 4 step <N> (<items>): …`.

### Card 1: the client — R18, R24
Precondition: `HEAD` = `769825ce3781b5bb4de03f4d7687b37cd9f0d46a`, worktree clean. Files: the new helper's
module, `apps/client/src/app.js`, `apps/client/src/graph-import.js`, their tests (`behavior-wiring.test.js`,
`graph-import-panel.test.js`, `graph-import.test.js`, the helper's own test file). Run `apps/client` and
`packages/som`; proofs (r18), (r24).

### Card 2: the rule, both copies — R23
Files: `packages/behaviors/src/behavior-spec.js`, `packages/server/src/send-policy.js`,
`tests/fixtures/behavior-vectors.json` (regenerated, counts stated), the vector tests. Run `packages/behaviors`,
`packages/protocol`, and every server test file touched, each alone under `timeout 180`; proof (r23).

### Card 3: the lock — R22 (as R-L8), R19 (and, under R-L6 (b), the `/proc` check)
Files: `packages/server/src/server-lock.js`, `packages/server/src/index.js`,
`packages/server/scripts/behaviors-export.mjs`, `behaviors-reconcile.mjs`, `server-lock.test.js`,
`behaviors-rollback.test.js`. Run those two test files and the server's start/stop test, each alone under
`timeout 180`; proofs (r19), (r22a), (r22b).

### Card 4: the pre-brief notes, full suites, proofs, the handoff — R20, R21
`PREBRIEF-scripting-4d.md` Rev 1.6 (§0.6, the §8 step-3 line, the G10, G7, G6 and Q3 notes, the status line);
then R21.

### Card 5: the GLM review of round 4 (`4f19b253..<tip>`), cap 14400 s
A single GLM review: round 4's commits read closely, rounds 2–3 for regressions; it reproduces every proof,
(r18), (r19), (r22a), (r22b), (r23) and (r24). Then the gate, publish, DEV (`set-dev` over the unaccepted
round 3), the finalizer (under R-L7), acceptance.

### Before DEV acceptance
1. **Claude's §6.1 checks on the new DEV SHA:** `c1.py` (its R16 line must now pass), `probe_r16.py`, `c11.py`
   with three cases added (a script refuses through a symlink while the server is up; a server can't start
   while a script holds the lock; a `kill -9`'d server doesn't block the scripts), the operator's host block
   again (the lock file's name changes), and the quick set `c2.py`, `c5.py`. A 3 MiB many-light file through the
   panel in the browser (R24). Checks 9 and 10 again only if a card touches their areas.
2. **A short outside review of round 4's delta** (`769825ce..<tip>`), by the same reviewer.
3. DEV acceptance (§7 of the pre-brief), then MAIN.

## 4. Cleanup — do it before this round's kickoff
Archive round 1's sentinel `t_adf3ee2b` first, then its gate `t_d0639e09` (the sentinel first: archiving a
parent promotes its children).
```bash
hermes kanban --board atrium archive t_adf3ee2b
hermes kanban --board atrium archive t_d0639e09
```
**Why before:** `t_adf3ee2b` is now the board's **only** open sentinel (round 2's and round 3's are done). The
guard links "the workflow's single open sentinel" to every new review gate and DEV finalizer
(`atrium-kanban-guard`, `_link_sentinel`). With it archived, round 4's sentinel is the only open one, and the
guard makes round 4's two links itself; with it open, there are two, the guard links nothing, and every link is
the front door's to make by hand (round 3's way).

## 5. Kickoff body for round 4

**For the front door.** Do these before creating anything:
1. Confirm §4's cleanup is done: `t_adf3ee2b` and `t_d0639e09` are archived.
2. Check that this file's commit is on `origin/main`, and compute its sha256.
3. Create **round 4's sentinel first**: the same shape as `t_7e8edf61`, titled
   `Scripting-4d-1 r4 sentinel (scripting-4d-1)`.
4. Fill the body's three placeholders:
   - `<REVISION_CHECK>`:
     `REVISION CHECK (front door): <commit>:devtasks/REVISION-scripting-4d-1-round-4.md sha256 <hash>, <bytes> bytes, matches.`
   - `<SENTINEL_ID>`: the new sentinel's id.
   - `<CANONICAL_REQUIREMENTS>`: the canonical worker-card requirements, verbatim, the same text as rounds 1–3.
5. Create the kickoff card with the filled body **in its body field**, and read it back whole.
6. **The sentinel's links:** with one open sentinel, the guard links it to round 4's review gate when the
   kickoff creates it, and to the DEV finalizer when the front door does. **Read the sentinel back after the
   kickoff completes, and again after the finalizer is created;** link any that's missing yourself (gate →
   sentinel, finalizer → sentinel, never the reverse). Never link it to a human gate (the guard refuses).
7. **The finalizer's rule** (R-L7 (a)): pass when the parent DEV deploy's handoff shows success (`DEV DEPLOY
   SUCCESS`, or `success: true` with `exit_code: 0`), the local and public health lines ok, `reviewed_sha` equal
   to round 4's reviewed tip, and `TARGET_SHA` a full lowercase 40-character SHA; otherwise block with
   `kind="capability"` quoting the handoff. The body says why that suffices (`atrium-deploy-gate dev` deploys
   exactly the release merge's `RELEASE_SHA`, and exits 70 without deploying if it has none) and names
   `release/<reviewed 12 hex>` as the operator's cross-check. Don't ask for `RELEASE_SHA=` or `SMOKE OK:` lines:
   the handoff never carries them.

Keep in mind: round 3's acceptance card `t_b6db79eb` and round 2's `t_f56db644` stay blocked by design; round
4's chain redeploys DEV over round 3 (`set-dev` from waiting-for-acceptance).

---

### KICKOFF — scripting-4d-1 revision round 4. Slug: `scripting-4d-1`

You are the kickoff orchestrator for round 4 of `scripting-4d-1`. Build the graph below, read it back, report,
and stop. Do not implement, review or deploy anything yourself.
- **Your tools:** only `kanban_*`.
- **Everything you need is in this body.** Nothing will be posted on this card afterwards, so don't wait for
  comments, and **never block this card.**
- **Blocking:** never call `kanban_block` without an explicit `task_id`.
- **Titles:** use them exactly as written, character for character.
- **Card bodies:** write each card's body from the bullets under its title; don't copy this kickoff's
  instructions to you into any card. The references block, the hash checks and the canonical requirements are
  copied whole. Bodies go in the body field when you create the card; read each back, and if a body is empty
  post it as the card's first comment while it's `todo`. Never create a second card in its place.
- **Create every card with its parent** (`parents=[…]`).
- **Do not create or link any sentinel.** The guard and the front door do that.

**The front door's spec check:** `SPEC CHECK (front door): 4f19b2533308ef0dc0fa3c3d8a5b4164eb389e82:devtasks/PREBRIEF-scripting-4d.md sha256 457e2ff0d018580e117bc0e3aac3ae6d4d4e90aa36a9c6dbf1106cdc10279458, 121240 bytes, matches.`

**The front door's revision check:** <REVISION_CHECK>

**The sentinel (for your report only; don't link it):** `<SENTINEL_ID>`

#### The references block (copy it whole into cards 1–5)
**The contract is in git.** Before anything else, read and check all five:

```
git -C /workspace/atrium fetch origin main
git -C /workspace/atrium show 4f19b2533308ef0dc0fa3c3d8a5b4164eb389e82:devtasks/PREBRIEF-scripting-4d.md > /tmp/prebrief.md
sha256sum /tmp/prebrief.md   # 457e2ff0d018580e117bc0e3aac3ae6d4d4e90aa36a9c6dbf1106cdc10279458
git -C /workspace/atrium show 1a26d8faba708c7784d1ae283670921d4608ae3b:devtasks/KICKOFF-scripting-4d-1.md > /tmp/kickoff-r1.md
sha256sum /tmp/kickoff-r1.md   # 426626027d62a624296d0c4971f179bd4d26c67688fae63f35a87e35d2132b5c
git -C /workspace/atrium show c89eb69c:devtasks/REVISION-scripting-4d-1.md > /tmp/revision-r2.md
sha256sum /tmp/revision-r2.md   # f3a73cd37502b49197a03490feedf7e4014088d3522f809669de4c00a4f5b514
git -C /workspace/atrium show 025a2195a5bca7fbc72f81e1090ef82f1f313f1b:devtasks/REVISION-scripting-4d-1-round-3.md > /tmp/revision-r3.md
sha256sum /tmp/revision-r3.md   # 71171bedff8d315c5409e71838bf3ca3cfe2758271655e29f9404d3a40159541
git -C /workspace/atrium show <revision commit>:devtasks/REVISION-scripting-4d-1-round-4.md > /tmp/revision-r4.md
sha256sum /tmp/revision-r4.md   # <revision hash>
```

(Fill the two `<revision …>` values from the front door's revision check above.) On any mismatch, block with
`kind="capability"`, quote both hashes, and do not work from a different text.

- **The round-4 revision is this round's contract:** its §2 (R18–R24, with R-L6–R-L8 all decided (a)) and its §3, which gives **your card's** items and handoff.
- **Also binding:** the pre-brief (FINAL Rev 1.4, with round 3's Rev 1.5 notes on the branch); the round-1
  kickoff's Settlement and its "Requirements for the implementation AND review cards (beyond the spec)", items
  1–7; the round-2 revision (R1–R5, R-L1 (a)); the round-3 revision (R6–R17, R-L2–R-L5 (a)); the GLM brief, run
  1148's summary on `t_255de53b`.
- **The review is a single GLM review; Nemotron is benched (F-8).**

#### Graph — build exactly this
Cards 1–4 are assigned to `atrium-deepseek` and created with `max_runtime_seconds=14400`. Each one's parent is
the previous card, and card 1's is this kickoff.

**Every implementation card's body** carries: the references block; the line
`Your items: the round-4 revision's §3, "<card heading>".` with that card's heading as below; the worktree rule;
the step rule; the canonical requirements.

**The worktree rule:** work in the existing persistent worktree `/workspace/wt/scripting-4d-1`, on
`workflow/scripting-4d-1`. Before changing anything:

```
cd /workspace/wt/scripting-4d-1
git status --porcelain                                            # must print nothing
git rev-parse HEAD                                                # must equal the tip your parent card reported (card 1: 769825ce3781b5bb4de03f4d7687b37cd9f0d46a)
git log --format='%h %s' 4f19b2533308ef0dc0fa3c3d8a5b4164eb389e82..HEAD   # round 2's eight commits, round 3's five, then one `round 4 step <N>` commit per earlier card
pnpm install --frozen-lockfile --prefer-offline
readlink -f packages/server/node_modules/@atrium/protocol          # must resolve inside this worktree
```

On any mismatch, block with `kind="needs_input"`, quote what you saw, and touch nothing. Commit locally and
never push. Commit subjects: `scripting-4d-1 round 4 step <N> (<items>): …`, one commit per card.

**The step rule:** do **your card's items and no other**; your handoff (the completion summary **and** metadata
`tip_sha`, `step`; R15) marks **every item** done with its files and test names, plus the round-2 revision's §3
handoff list; **never complete with an item undone**: block with `kind="needs_input"` naming what is left; a
progress comment after each item group and each commit.

1. `Implement r4 step 1 — scripting-4d-1`. Heading: "Card 1: the client — R18, R24".
2. `Implement r4 step 2 — scripting-4d-1`. Heading: "Card 2: the rule, both copies — R23".
3. `Implement r4 step 3 — scripting-4d-1`. Heading: "Card 3: the lock — R22 (as R-L8), R19 (and, under R-L6
   (b), the `/proc` check)".
4. `Implement r4 step 4 — scripting-4d-1`. Heading: "Card 4: the pre-brief notes, full suites, proofs, the
   handoff — R20, R21".
5. `GLM review r4 — scripting-4d-1`. Assignee `atrium-glm`, parent: card 4, `max_runtime_seconds=14400`.
   - The body opens with the exact line
     `THIS RUN HAS TERMINAL, FILE AND GIT TOOLS. Use them for every step below.`
   - Then: the references block; "Your review: the round-4 revision's §3, 'Card 5: the GLM review of round 4'";
     the range is `4f19b253..<tip card 4 reported>`, with round 4's commits read closely and rounds 2–3 for
     regressions; review in your own detached worktree at `/workspace/wt/review-<your task id>` at that tip,
     never in the persistent one; reproduce every proof, (r18), (r19), (r22a), (r22b), (r23) and (r24); the
     canonical requirements.
   - The verdict is APPROVE or CHANGES_REQUIRED, with the exact lowercase 40-character SHA when approving, and
     metadata `verdict`, `reviewer_role`, `review_round: round-4`, `findings_count` and the maximum severity.
6. `Review gate r4 — scripting-4d-1`. Assignee `atrium-orchestrator`, parent: card 5. It creates nothing. Its
   body says: **"A single GLM review is the whole review; Nemotron is benched (F-8). Do not ask for another."**
   - **On a valid APPROVE of the exact 40-character SHA,** it blocks with `kind="needs_input"` and the reason
     `APPROVE <SHA40>: front door, build the release chain`.
   - **Otherwise,** it blocks for the operator with the verdict quoted.
7. **The release chain is the front door's:** publish, DEV (`set-dev` over the unaccepted round 3), the
   finalizer, acceptance, at card 6's APPROVE. Nothing reaches MAIN or PROD.

#### Report back
- the six ids, each with its parent;
- each implementation card's and the review's `max_runtime_seconds` (14400);
- that cards 1–5 each carry the references block with the filled revision commit and hash, in their body
  fields, and the canonical requirements;
- the review's opening line, and the gate's F-8 line;
- that you created and linked **no** sentinel.

Then complete this card.

#### WORKER-CARD REQUIREMENTS (canonical)
<CANONICAL_REQUIREMENTS>
