# Host round 2026-10-30: the small host round before 4c's kickoff

Status: **DRAFT (2026-10-30), for the operator.** A short brief, not a
pipeline round: no kickoff, no cards, no GLM. Claude drafted the changes and
tested them off-host. The operator applies them on the VPS with the commands
in §6. **4c's kickoff waits until §7's "done" holds.**
- **Why now:** the signin-sync passdown (first instruction 3, §6.2): the host
  round goes first, all of it, because item 1 (cards created without a parent)
  is a risk to every release chain, 4c's included.
- **Drafts:** `devtasks/host-drafts/host-round-2026-10-30/`, beside the
  earlier host drafts (`atrium-deploy-H3.patch`, …). Claude couldn't attach
  the `atrium-ops` repo to this session, so nothing is on an `atrium-ops`
  branch. **After rollout, the operator copies the two changed files into
  `atrium-ops`** (or tells Claude to, in a session that has it).
- **Host facts** were read through the ops connector on 2026-10-30, 07:50–08:00
  UTC: the guard and `atrium-release-status` sources (`read_file`), the
  board (`kanban_show`), the orchestrator's run statistics
  (`agent_run_stats`), and `system`.

## 1. The four items

| # | Item (signin-sync passdown) | What this round does |
|---|---|---|
| 1 | §4.3: workflow cards created without a parent; why the orchestrator's `kanban_create` and `kanban_complete` drop fields | **Guard v1.2.0** (§2): a parentless card is created `blocked`, and a link releases it. Plus a key-only log of every `kanban_create`/`kanban_complete`, which settles the dropped fields (§2.3) |
| 2 | §4.5: `atrium-release-status` doesn't check content | **A content check** (§3): served `app.js` against its blob at the checkout's `HEAD` |
| 3 | `@atrium/behaviors` in the host's test list | **Needs one paste** (§4): the list lives in `atrium-build-run`, which the connector can't read |
| 4 | The 4 GB host's memory during proof runs | **A finding and a recommendation** (§5). Nothing is applied without the operator's choice |

## 2. Item 1: guard v1.2.0

### 2.1 What the host showed
- **A parentless card is born claimable.** Every one of last round's cases
  has the same `created` event: `{'status': 'ready', 'parents': []}`, then a
  `linked` event seconds later. Round 2's Publish (`t_4d192108`), created by
  the front door, went `ready` at 05:06 and was linked 27 s later. Round 1's
  sentinel (`t_ed021448`) was claimed and run inside that window, and blocked
  itself "OPERATOR INPUT NEEDED: … no linked parents". The kickoff
  (`t_9e5fbd78`) is the one card that is legitimately parentless.
- **The guard never looks at `parents`.** Guard v1.1.4's `_check_create`
  checks titles, SHAs, assignees, runtime caps and approvals. Nothing reads
  `parents`, so a parentless Publish or deploy card passes untouched.
- **What the guard adds does stick.** The implementation card `t_0149264e`
  has, as its whole body, the guard's footer with "Runtime cap: 90 minutes"
  (DeepSeek's default). So the guard's own `body` and `max_runtime_seconds`
  reached the card, and the guard was handed **no** body and **no** cap. The
  loss happens before the hook. A field the guard sets on create
  (`initial_status`) therefore survives.
- **Cards the front door creates keep their bodies** (`t_4d192108`'s body is
  intact), while the orchestrator's lose them (`t_0149264e`, round 7's cards).
  So the fault is in the orchestrator's tool surface or its calls, not in the
  board.

### 2.2 The change
- **Hold:** on a guarded board, a `kanban_create` with no `parents` (a list,
  or a comma or space separated string), other than a title starting
  `Kickoff`, gets `initial_status="blocked"`. The card's body gets one more
  operating-notes line: "This card was created without a parent, so the guard
  created it blocked: nothing runs it until a parent is linked. Linking its
  parent with kanban_link releases it." Log event `no_parent_hold`.
- **Release:** after a `kanban_link`, the child goes to `todo` (through
  `kanban_db.unblock_task`, the same call the sentinel auto-link uses) only
  when all of these hold. From `todo` it waits on its parents like any other
  card.
  - it is still `blocked`;
  - its `created` event says `blocked` with no parents;
  - its body carries that exact line, so the guard held it, not its caller;
  - it now has a parent;
  - it has no later `blocked`, `claimed` or `unblocked` event;
  - it isn't a gate (no human-gate stage title, no `OPERATOR BLOCK`).

  Log event `no_parent_released`.
- **Diagnostics:** every `kanban_create` and `kanban_complete` on a guarded
  board logs one `args` line. It records the **argument keys** (never their
  values), the lengths of `body`, `summary` and `result`, the parent count,
  and the cap. `kanban_complete` is logged only, never changed.
- **Unchanged:** every v1.1.4 rule. **Failure behaviour:** as before, an
  internal error fails open and is logged. In the release path that means
  **closed**: if the board's `tasks` table has no `body` column, the read
  raises, the error is logged, and the held card stays `blocked`. It is
  never released by mistake.
- **The alternative, refusing a parentless create,** is safer in principle
  but can wedge a kickoff. If the orchestrator's calls lose `parents` the way
  they lose `body` (§2.1 can't rule that out yet), every create it makes
  would be refused. Holding works either way. Once §2.3 shows what arrives,
  the operator can switch to refusing.

### 2.3 How it settles the dropped fields
After the next orchestrator run (the first card it creates or completes),
the `args` lines show which keys arrived. A `kanban_create` without `body`,
or a `kanban_complete` without `summary` and `result` (last round: refused
about 130 times, "provide at least one of: summary, result"; run 1094 logged
135 errors), then means the model never sent them, or sent them under
another name, which the line also shows. Either way it's the orchestrator's
tool definitions or prompt, the next thing to look at, with the line as
evidence. §6 step D collects them.

### 2.4 Tested off-host
`tests/test_guard_v120.py`, 12 tests, against a scratch board (sqlite)
behind stubs of the three Hermes calls the guard makes. Seven targeted
breaks, each failing the test that pins it:

| Break | Fails |
|---|---|
| (k1) no hold on the stage path | `test_parentless_stage_card_is_held` |
| (k2) no hold on the worker path | the worker, sentinel, self-blocked and no-body-column tests |
| (k3) kickoff not exempt | `test_kickoff_is_a_root_and_not_held` |
| (k4) release without the body-line check | `test_a_card_its_creator_made_blocked_is_not_released_by_a_link` |
| (k5) release a card that blocked itself | `test_a_held_card_that_blocked_itself_since_is_not_released` |
| (k6) no key log | `test_argument_keys_are_logged_without_values` |
| (k7) the body's value in the log | the same |

**Not tested off-host:** the real Hermes `kanban_db`, the real `tasks`
schema, and whether a `modify` that sets `initial_status` reaches the board.
§6 step C checks the first two directly, and the first held card proves the
third.

## 3. Item 2: the content check
- **The change:** `service_health` gains a fourth check. It fetches the
  served `app.js` (with `Cache-Control: no-cache` and a cache-buster) and
  compares its sha256 with the blob `HEAD:apps/client/src/app.js` in that
  environment's checkout, read through the script's own fixed git contract.
  - A match prints `healthy (app.js sha256 <12> served = checkout HEAD)`.
  - A mismatch or a failed check is a health failure,
    `active / content: app.js served sha256 <12>, checkout HEAD <12> FAILED`.
- **Why the blob and not the file on disk:** "actual" in this script means
  `HEAD`. An uncommitted edit in the checkout is a mismatch too.
- **Readers of the output:** the health line still starts with `healthy`
  when everything passes. Anything that matches the whole line exactly
  (`== "healthy"`) would now see a longer line. Nothing in the release
  scripts read here does. The front door and the connector show the text.
- **Tested off-host:** `tests/test_release_status_content.py`, 5 tests: a
  git checkout served over local HTTP; the same bytes, another release's
  bytes, an uncommitted edit, an unfetchable file, an unreadable checkout.

## 4. Item 3: `@atrium/behaviors` in the test list
The deploy runs `"$BUILD" list-tests` and then `"$BUILD" test-<name>` for
each (`atrium-deploy`). The last DEV deploy reported "All 7 test suites"
(`t_1c3551ce`), with no names. The list is in `atrium-build-run`
(`/usr/local/lib/atrium-host/sbin/`, from `atrium-ops`
`host/lib/atrium_host/buildrun.py`), which the connector can't read. §6
step A prints it. Claude then writes the one-line change, in the same shape
as the existing entries, and the operator applies it in step B.
`@atrium/behaviors` runs with `node --test tests/*.test.js` from
`packages/behaviors` (132 tests, 1 named skip, at the base).

## 5. Item 4: memory
- **What the host showed:** 3,814 MB of RAM, 2,047 MB of swap (518 MB in
  use), and about 2.4 GB available at 07:51 UTC. The OOM lines `system`
  returns are from 2026-10-24 16:53–16:57: three kills of `node` processes
  of 2.9–3.2 GB anonymous RSS each, **inside the Hermes Docker container**
  (`hermes-c6b7f940`). They were global OOMs, invoked by `sshd-session`,
  `containerd` and `node`, so the kernel was choosing victims host-wide.
  The signin-sync proof run's kill (2026-10-30) isn't among the lines
  returned.
- **What it means:** a single test process can take most of the machine. The
  container has no memory limit (the kills were global, not cgroup ones), so
  when it does, the kernel may pick `sshd`, `containerd` or the PROD server
  instead.
- **Recommended, operator's choice:**
  1. **A memory limit on the Hermes container,** so a runaway test is killed
     inside it: `docker update --memory 2600m --memory-swap 3600m
     hermes-c6b7f940`. It takes effect at once, and no restart is needed.
     Check first that the container's normal use is well below that
     (`docker stats --no-stream hermes-c6b7f940`).
  2. **Proofs one at a time** is already a worker rule in 4c's pre-brief (§6,
     §8). Nothing to change on the host for it.
  3. A Node heap cap (`NODE_OPTIONS=--max-old-space-size=1536`) for worker
     runs would turn a runaway into a clean "heap out of memory" failure.
     It's in the container's environment, so it needs a container recreate.
     Recommended later, not in this round.

## 6. Operator steps
Every block is self-contained. Check what each step says to check **before**
running the next block.

**A. Read-only: paste the whole output back to Claude.**
```bash
C=hermes-c6b7f940
echo "== guard copies (path, sha256) =="
docker exec "$C" sh -c 'grep -rl --include=*.py "atrium-kanban-guard: mechanical checks" / 2>/dev/null | xargs -r sha256sum'
echo "== release status =="
RS="$(command -v atrium-release-status)"; echo "$RS"; sha256sum "$RS"
echo "== test list =="
/usr/local/lib/atrium-host/sbin/atrium-build-run list-tests
grep -rn "list-tests\|interaction\|renderer-three" /usr/local/lib/atrium-host/ 2>/dev/null | head -40
echo "== container memory =="
docker stats --no-stream "$C"
```
Claude checks:
- every guard copy's sha256 is `e684c4e56b00415197e63447ca6e7594efa97fcd750bff564e406dc0044429c3`
  (v1.1.4 as the connector read it);
- the release status script's is `9d37c98b587d0c7ac426003bfee92227245360afb56fe112ba2a2d0f99367517`.

**If a hash differs, stop:** Claude rebases the patch (`*.patch` in the
drafts) instead, and step B becomes `patch --dry-run` first. Claude also
writes step B's item-3 line from the list.

**B. Install** (only after Claude confirms step A). This writes the paths
Claude names from step A. Claude gives the block with those paths written
in, no placeholders. Its shape:
```bash
set -euo pipefail
B=/root/host-round-2026-10-30-backup; mkdir -p "$B"
git -C /root/lib-install fetch -q origin main
H=devtasks/host-drafts/host-round-2026-10-30
git -C /root/lib-install show "origin/main:$H/kanban_guard.py" > /tmp/kanban_guard-v1.2.0.py
git -C /root/lib-install show "origin/main:$H/atrium-release-status" > /tmp/atrium-release-status.new
sha256sum /tmp/kanban_guard-v1.2.0.py /tmp/atrium-release-status.new
# must print bee4eb60b1ed1f574d570c5b1345ee049e4cd316043a956c415d136535731746
#        and 18b36f195bab1e50de51865d6289d55c5f724bbefe4490e1e3077c05634e90ac
# then, per guard path from step A: docker cp the old file to "$B", docker cp the new one in
# then: cp -p "$RS" "$B"/ && install -m 0755 -o root -g root /tmp/atrium-release-status.new "$RS"
```
Each kanban worker run starts a new process, so the next card picks up
v1.2.0. **A long-running front-door session keeps the old plugin until
`/new`.** Start a fresh one.

**C. Check it** (read-only, then one log read):
```bash
atrium-release-status          # both health lines: "healthy (app.js sha256 … served = checkout HEAD)"
C=hermes-c6b7f940
# the board's tasks table has the columns the release reads
docker exec "$C" sh -c 'find / -name "*.db" -path "*kanban*atrium*" 2>/dev/null | head -1 | xargs -r -I{} python3 -c "import sqlite3,sys; print([r[1] for r in sqlite3.connect(sys.argv[1]).execute(\"PRAGMA table_info(tasks)\")])" {}'
# the decision, without creating a card (this writes one labelled line to the guard log)
docker exec "$C" sh -c 'cd "$(dirname "$(grep -rl --include=*.py "atrium-kanban-guard: mechanical checks" / 2>/dev/null | head -1)")" && python3 -c "
import importlib.util, glob, os
p = [f for f in glob.glob(\"*.py\") if \"mechanical checks\" in open(f).read()][0]
s = importlib.util.spec_from_file_location(\"g\", p); g = importlib.util.module_from_spec(s); s.loader.exec_module(g)
r = g.pre_tool_call(\"kanban_create\", {\"board\": \"atrium\", \"title\": \"HOST ROUND CHECK — not a card\", \"assignee\": \"atrium-glm\", \"body\": \"x\"})
print(r[\"action\"], r[\"args\"].get(\"initial_status\"), g.NO_PARENT_NOTE in r[\"args\"][\"body\"])"'
```
Expect: the column list includes `body` and `status`; the decision prints
`modify blocked True`. **If `body` is missing,** held cards can't be
released by a link (they stay `blocked`, safe), and Claude changes the
release's column before 4c's kickoff.

**D. After the next orchestrator run** (any card it creates or completes),
paste the `args` lines:
```bash
docker exec hermes-c6b7f940 sh -c 'for f in $(find / -name atrium-kanban-guard.log 2>/dev/null); do echo "== $f"; grep "\"event\": \"args\"\|no_parent" "$f" | tail -20; done'
```

**Rollback:** copy the files in `/root/host-round-2026-10-30-backup` back to
the paths they came from (the guard with `docker cp`, the script with
`install -m 0755`).

## 7. Done
- [ ] Step A pasted. Hashes match, or the patches are rebased.
- [ ] Guard v1.2.0 and the content check installed. Item 3's line added.
  Item 4's limit decided (applied or declined).
- [ ] Step C: both health lines show the content match; `tasks` has `body`;
  the decision prints `modify blocked True`.
- [ ] The two changed files committed to `atrium-ops`.

Then 4c's kickoff can be written from `53f68ba` (the FINAL pre-brief).
**At 4c's kickoff,** the first held card (if any) and step D's `args` lines
are checked, and the operator still checks each new card's parents (4c
pre-brief §8).
