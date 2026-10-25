# Revision — scripting-4b-2 round 4 (the host's workspace rules refuse `packages/vendor/*`)

**Status:** DRAFT, Rev 0 (2026-10-25), for the operator's approval. Nothing
here is in force until the operator approves it.
- **Base:** round 3's reviewed tip `c0e563f0e0f09ad4b1433dc9714f85dde2740164`
  on `workflow/scripting-4b-2` (GLM APPROVE, `t_4b921a88`). Round 4 commits on
  top of it, on the same branch, in the existing worktree
  `/workspace/wt/scripting-4b-2`.
- **Nothing was published or deployed.** Round 3's review gate `t_916959c5`
  was never completed, so its release chain (`t_03ede0fb` Publish,
  `t_82c17ea9` DEV deploy, `t_4642b86e` finalizer, `t_c2d75b59` acceptance
  gate) never ran. Those cards and round 3's sentinel `t_b9c2a9bc`, like
  rounds 1's and 2's, stay as they are, superseded by round 4's. **No one
  completes `t_916959c5`.**
- **The contract still governs:** `devtasks/PREBRIEF-scripting-4b-2.md`,
  FINAL Rev 2.1, at `951b541bef818499a16692ac968f1800fdb75434` (sha256
  `a7841421312f5ae59b74d8623067986557b4a241f048c30adbb556bc44190a73`); the
  OPERATOR CORRECTION and OPERATOR NOTE on `t_6c3817b2`;
  `devtasks/REVISION-scripting-4b-2.md` (round 2, at `45fcc433`, sha256
  `4ef9aaad2237b61a5f8f9cf23ffcb6604f4e3765284e5e1d28f8ad95679bd2d0`); and
  `devtasks/REVISION-scripting-4b-2-r3.md` (round 3, at `f47cc3f7`, sha256
  `4e49b1d45cc33185c7955f8b881a66b5b46c3e101ff0bbd53864cf64ade0e93f`).
  This file adds U1, amends F-L11's directory, and changes nothing else.

## 1. What the host pre-check found

### 1.1 The DEV deploy would refuse this tree
Before completing round 3's gate, the operator read the host's install and
test code (`/usr/local/lib/atrium-host/lib/atrium_host/`, 2026-10-25):
- **`config.py` L30:** `WORKSPACE_ALLOWED = ("packages/*", "tools/*", "apps/*")`.
- **`workspace.py` `parse_packages`:** every glob in `pnpm-workspace.yaml`
  outside that tuple raises `WorkspaceRefused`. Round 1 added
  **`packages/vendor/*`** (F-L11), so `ensure-node-modules` refuses right
  after the deploy's checkout, and `atrium-deploy` rolls DEV back.
- **Allowlisting that glob wouldn't be enough.** `package_dirs` treats a
  glob's root as one path component (`NAME_RE` on `g[:-2]`, then a single
  `open_subdir`), and the install check (`buildrun.py` `VERIFY_INSTALL`)
  looks for hard links only under `packages/*/node_modules`, so a nested
  package's install would escape it. Accepting nested globs would mean
  changing the least-privilege deploy code.
- **The install itself is right:** `pnpm install --frozen-lockfile
  --store-dir <build store> --package-import-method copy` (`buildrun.py`
  L26–27), and the `node_modules` directories come from the workspace globs,
  not a fixed list.

### 1.2 The host's test list is fixed
`buildrun.py` `TESTS` names seven suites: protocol, som, server, client,
renderer-three, interaction and apps-client. **`@atrium/behaviors` isn't
one,** so its 112 tests wouldn't run at the deploy. That isn't a breakage
(the implementer and three GLM reviews ran them), and it's a host change, not
this round's (§3).

### 1.3 The cause
F-L11 chose `packages/vendor/<name>` without checking the host's workspace
rules. The kickoff's front-door note named the risk as a pre-check, and the
pre-check caught it before anything ran.

## 2. The contract (round 4)

### U1. The vendored packages move under the existing glob
**F-L11 is amended in one respect, its directory:** each vendored module is
still a workspace package under its upstream name and version, unedited,
with its licence, its hashes recorded and the `NOTICE` entry. Only where it
lives changes.
- **Move, byte for byte** (`git mv`, so the history shows renames):
  - `packages/vendor/gltf-interactivity-engine/` → **`packages/gltf-interactivity-engine/`**;
  - `packages/vendor/gl-matrix/` → **`packages/gl-matrix/`**.

  No file inside them changes, `package.json` included (their dependency on
  `gl-matrix` is `workspace:*`, by name).
- **`packages/vendor/VENDORED.md`** → **`VENDORED.md` at the repo root,**
  beside `NOTICE`, with every path updated and every hash unchanged. Nothing
  else is left under `packages/vendor/`, and the directory is gone.
  (Not `packages/VENDORED.md`: the host lists every entry directly under
  `packages/` and checks its name, so `packages/` holds only package
  directories.)
- **`pnpm-workspace.yaml`:** the `packages/vendor/*` glob is removed. The
  file's `packages:` list is again exactly the base's three globs.
- **`pnpm-lock.yaml`** regenerated with `pnpm install` and committed, so the
  deploy's frozen install succeeds.
- **Every reference follows the move:** `NOTICE`; the import map in
  `apps/client/index.html` (the engine's and `gl-matrix`'s entries now point
  at `../../packages/gltf-interactivity-engine/…` and
  `../../packages/gl-matrix/…`), and the other two pages' maps if they carry
  them; `packages/behaviors/tests/vendor.test.js` and any other test or
  script that names the old paths.
  **`git grep -n 'packages/vendor'` finds nothing outside `devtasks/`** at
  the tip (`devtasks/` keeps its history as written).
- **A guard of the host's workspace rules,** a new test (in
  `packages/behaviors/tests/` or `apps/client/tests/`, whichever already
  reads repo files):
  - `pnpm-workspace.yaml`'s `packages:` globs are each one of `packages/*`,
    `tools/*`, `apps/*`;
  - every entry directly under `packages/`, `apps/` and `tools/` (dot
    entries aside) is a directory whose name matches `^[a-z0-9][a-z0-9-]*$`,
    and none is named `node_modules`. A directory without a `package.json` is
    allowed: the host skips it (`tools/som-inspector` is one).

  Its comment says these mirror the host's `config.WORKSPACE_ALLOWED` and
  `workspace.package_dirs`, so a future round can't add a glob or an entry
  the deploy refuses without this test failing first. (Every entry in the
  base passes it.) **If the tip has an entry that fails it** other than the
  ones this round removes, the worker reports it and blocks `needs_input`;
  it doesn't loosen the rule.

### What doesn't change
Everything else in F1–F12, C1–C3, the OPERATOR NOTE, round 2's R1–R2 and
round 3's T1. No source file outside the moves, the references and the guard
changes.

## 3. Tests and proofs (round 4)

| Item | New tests |
|---|---|
| U1 | The workspace-rules guard above. `vendor.test.js` reads the new paths and the root `VENDORED.md`; every hash is unchanged. `importmap-guard` green with the new paths (it already checks that every file a page imports through its map exists) |

**Proofs** ("not reproducible" is not an acceptable result):
- **(u1)** `packages/vendor/*` put back in `pnpm-workspace.yaml` (the guard
  fails by name);
- **(u2)** a file added directly under `packages/` (say `packages/NOTES.md`)
  (the guard fails by name);
- **(u3)** the engine's import-map entry pointed back at
  `../../packages/vendor/…` (`importmap-guard` fails on the missing file);
- **(c)** re-run: one byte of the moved engine file changed (the hash test
  fails), restored from a saved copy.

**And the whole round still passes:**
- full suites, with round 1's rules (server files one at a time under
  `timeout 180`, `packages/client` without `--test-force-exit`, every other
  package on its own directory, `importmap-guard` green, the one named
  conformance skip and no other);
- **`r1`** (`devtasks/spike-4b/r1.mjs`) against the moved engine, with the
  same output as before;
- **the moves are pure renames:** `git diff -M --stat c0e563f0..<tip>` shows
  every vendored file as a rename with 100% similarity, and the handoff
  quotes it.

**Steps, one commit each:**
1. U1: the moves, the references, `pnpm-workspace.yaml`, the lockfile and
   the guard;
2. suites, proofs and the handoff.

**The host's test list (operator, separate from this round):** add
`("behaviors", 300, [PNPM, "--filter", "@atrium/behaviors", "test"])` to
`buildrun.py`'s `TESTS`, in the small host round already pending (4b-1
passdown §6.4). Before round 4's DEV deploy if it can be done in time;
otherwise the deploy runs without that suite, and the passdown records it.

**Before DEV acceptance**, after round 4's release chain publishes and
deploys:
- the operator's **outside code review of the published SHA**, over the
  whole round (base `951b541b` to the round-4 tip);
- **Claude's §5.1 browser checks** (1–9 and 8b, and round 3's hint lines) in
  the harness;
- **after the DEV deploy,** `atrium-release-status`: DEV actual = recorded =
  `RELEASE_SHA`, healthy.

The operator then runs the spec's §6 DEV acceptance.

## 4. Kickoff body for round 4 (post it verbatim as the revision kickoff card's text)

---

### KICKOFF — scripting-4b-2 revision round 4. Slug: `scripting-4b-2`

You are the kickoff orchestrator for round 4 of `scripting-4b-2`. Build the
graph below, read it back, report, and stop. Do not implement, review or
deploy anything yourself.
- **Your tools:** only `kanban_*`.
- **Blocking:** never call `kanban_block` without an explicit `task_id`, and
  never block this card.
- **Titles:** use them exactly as written. Don't add words to them.

**The contract is in git; you don't read it.** It is
`devtasks/REVISION-scripting-4b-2-r4.md` on `main`, together with
`devtasks/PREBRIEF-scripting-4b-2.md` at `951b541bef818499a16692ac968f1800fdb75434`
(sha256 `a7841421312f5ae59b74d8623067986557b4a241f048c30adbb556bc44190a73`),
`devtasks/REVISION-scripting-4b-2.md` at `45fcc433015c54355fcec31a8917f6c548af9434`
(sha256 `4ef9aaad2237b61a5f8f9cf23ffcb6604f4e3765284e5e1d28f8ad95679bd2d0`),
`devtasks/REVISION-scripting-4b-2-r3.md` at `f47cc3f7198a33309a59eee845167b61ae3ac173`
(sha256 `4e49b1d45cc33185c7955f8b881a66b5b46c3e101ff0bbd53864cf64ade0e93f`)
and the two operator texts on `t_6c3817b2` (the OPERATOR CORRECTION and the
OPERATOR NOTE).
- **The front door has already checked the round-4 revision** and posted
  its commit and sha256 on this card. **You have only `kanban_*` tools: do
  not try to fetch or hash anything, and do not block for lack of a shell.**
- Copy that commit and sha256 into cards 1 and 2. **They** have terminal,
  file and git tools. Each reads the revision with
  `git -C /workspace/atrium fetch origin main && git -C /workspace/atrium show <commit>:devtasks/REVISION-scripting-4b-2-r4.md > /tmp/revision-r4.md && sha256sum /tmp/revision-r4.md`,
  and blocks with `kind="capability"` on a mismatch.

#### Graph
1. **`Implement r4 — scripting-4b-2`.** Assignee `atrium-deepseek`, parent:
   this kickoff, `--max-runtime 2h` (7200 s).
   - **Body:**
     - the revision reference and hash check;
     - continue `workflow/scripting-4b-2` from
       `c0e563f0e0f09ad4b1433dc9714f85dde2740164` in the existing worktree
       `/workspace/wt/scripting-4b-2` (`git -C /workspace/wt/scripting-4b-2
       status` must be clean at that SHA, or block `needs_input`);
     - the revision's §2 contract and §3 steps, tests and proofs;
     - the spec, the two operator texts on `t_6c3817b2`, and rounds 2's and
       3's revisions, still binding;
     - the WORKER-CARD REQUIREMENTS comment (855 on `t_2d41531f`).
   - **The handoff** carries proofs (u1)–(u3) and (c), `r1`'s output against
     the moved engine, the `git diff -M --stat` of the moves, the
     `git grep 'packages/vendor'` result, and per-file counts with exit
     codes and the one named skip.
2. **`GLM review r4 — scripting-4b-2`.** Assignee `atrium-glm`, parent:
   card 1.
   - Its body opens with
     `THIS RUN HAS TERMINAL, FILE AND GIT TOOLS. Use them for every step below.`
   - **The review covers round 4's change** (`c0e563f0` to the round-4 tip)
     against this revision. It reproduces **(u1)–(u3)** and **(c)** itself,
     runs `r1` against the moved engine, and **recomputes every hash in the
     root `VENDORED.md` from the moved files**.
   - **It confirms the moves are pure renames** (`git diff -M` at 100%
     similarity) and that no source file outside the moves, references and
     guard changed.
   - **It runs the guard's two rules by hand** against the tip's tree, as a
     check on the guard itself.
   - **Progress comments on its own card** after each stage, so a run that
     stops on its iteration budget resumes from its last comment.
3. **`Review gate r4 — scripting-4b-2`.** Assignee `atrium-orchestrator`,
   parent: card 2. It creates nothing.
   - **On a valid APPROVE of the exact 40-character SHA,** it blocks with
     `APPROVE <SHA40>: front door, build the release chain`.
   - **Otherwise,** it blocks for the operator with the verdict quoted.
4. **Before you complete,** link card 3 to **round 4's sentinel** as a
   parent. The front door creates it and posts its id on this card. Rounds
   1–3's sentinels (`t_6ad02da5`, `t_31a95fba`, `t_b9c2a9bc`) must not be
   used. Do not create a sentinel yourself.
5. **The release chain** is the front door's: the same four cards as
   scripting-4b-1's (Publish, DEV deploy, DEV finalizer, acceptance gate),
   with the new SHA, built whole at card 3's APPROVE. **Round 3's chain
   cards (`t_03ede0fb`, `t_82c17ea9`, `t_4642b86e`, `t_c2d75b59`) are not
   reused.** The DEV deploy restarts DEV. Nothing reaches MAIN or PROD.

#### Report back
- the three ids;
- the implementation's parent and its 7200 s cap;
- the hash line copied into cards 1 and 2;
- the review's opening line;
- the gate linked to round 4's sentinel.

Then complete this card.

---
