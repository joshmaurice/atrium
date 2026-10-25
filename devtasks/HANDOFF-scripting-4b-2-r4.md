# Handoff — scripting-4b-2 round 4 (U1)

**Branch:** `workflow/scripting-4b-2` (base
`c0e563f0e0f09ad4b1433dc9714f85dde2740164`, round 3's reviewed tip).
Worktree `/workspace/wt/scripting-4b-2` only; **not pushed**.
`/workspace/atrium` untouched (still `main`, never edited, never switched).

**Commits:** `1d6e969` (step 1 — U1: the moves, the references, the
workspace glob, the lockfile and the guard; the round's code tip) and the
commit on top of it that adds this file (step 2 — suites, proofs and
handoff; no source change). Round 4's tip is that second commit.

Round 4's contract is `devtasks/REVISION-scripting-4b-2-r4.md` at
`32c14a4f85e4127c1204fca5562edb319a67df9b` (sha256
`aa28260f1454974ca97a745d846c93868911d1a9d7c2f5e0a01db046e8533ee6`,
248 lines / 13,470 bytes) — verified before any work, against the front
door's line; §2 U1 and §3 govern. The spec
(`devtasks/PREBRIEF-scripting-4b-2.md` at `951b541b`, sha256
`a7841421…90a73`), the OPERATOR CORRECTION and OPERATOR NOTE on
`t_6c3817b2` (both re-read), and rounds 2's and 3's revisions
(`4ef9aaad…`, `4e49b1d4…`, both verified) remain binding. Nothing in them
changes; this round moves files and adds one guard.

## 1. What changed (step 1, `1d6e969`)

F-L11 is amended **in its directory only**: each vendored module is still a
workspace package under its upstream name and version, unedited, with its
licence, its hashes and its `NOTICE` entry. Only where it lives changes.

- `git mv` (byte for byte, history shows renames):
  - `packages/vendor/gltf-interactivity-engine/` →
    **`packages/gltf-interactivity-engine/`**;
  - `packages/vendor/gl-matrix/` → **`packages/gl-matrix/`**;
  - `packages/vendor/VENDORED.md` → **`VENDORED.md`** at the repo root,
    beside `NOTICE`, hashes unchanged (its rows are relative to
    `packages/`, and no row changed).
  - The now-empty nested `vendor/` directory is gone. Nothing else under it.
- `pnpm-workspace.yaml`: the nested glob is removed; the `packages:` list is
  again exactly the base's three globs (`packages/*`, `tools/*`, `apps/*`).
- `pnpm-lock.yaml`: regenerated with `pnpm install --prefer-offline`
  (`node v22.23.2`, `pnpm 12.3.4`) and committed, so the deploy's frozen
  install succeeds. Its workspace section now keys
  `packages/gl-matrix` and `packages/gltf-interactivity-engine`.
- Every reference follows the move: `NOTICE` (four path lines);
  `apps/client/index.html`'s import map (the engine's and `gl-matrix`'s
  entries now `../../packages/gltf-interactivity-engine/build/index.js` and
  `../../packages/gl-matrix/esm/index.js`); `packages/behaviors/tests/
  vendor.test.js` (reads the root `VENDORED.md`, resolves rows under
  `packages/`, every hash unchanged). No other page carries those entries.
- **New guard** `packages/behaviors/tests/workspace-rules.test.js` (§4).

`readlink -f packages/server/node_modules/@atrium/protocol` →
`/workspace/wt/scripting-4b-2/packages/protocol` (inside my own worktree);
likewise `@khronosgroup/gltf-interactivity-engine` →
`…/scripting-4b-2/packages/gltf-interactivity-engine`. Tests ran against the
worktree's own install.

## 2. The moves are pure renames

`git diff -M --stat c0e563f0..HEAD` (step 1's tree; every vendored file is
a rename at 0 changed lines = 100% similarity):

```
 NOTICE                                             |  8 +-
 packages/vendor/VENDORED.md => VENDORED.md         |  0
 apps/client/index.html                             |  4 +-
 packages/behaviors/tests/vendor.test.js            | 13 ++-
 packages/behaviors/tests/workspace-rules.test.js   | 94 ++++++++++++++++++++++
 packages/{vendor => }/gl-matrix/LICENSE.md         |  0
 packages/{vendor => }/gl-matrix/esm/common.js      |  0
 packages/{vendor => }/gl-matrix/esm/index.js       |  0
 packages/{vendor => }/gl-matrix/esm/mat2.js        |  0
 packages/{vendor => }/gl-matrix/esm/mat2d.js       |  0
 packages/{vendor => }/gl-matrix/esm/mat3.js        |  0
 packages/{vendor => }/gl-matrix/esm/mat4.js        |  0
 packages/{vendor => }/gl-matrix/esm/quat.js        |  0
 packages/{vendor => }/gl-matrix/esm/quat2.js       |  0
 packages/{vendor => }/gl-matrix/esm/vec2.js        |  0
 packages/{vendor => }/gl-matrix/esm/vec3.js        |  0
 packages/{vendor => }/gl-matrix/esm/vec4.js        |  0
 packages/{vendor => }/gl-matrix/package.json       |  0
 .../{vendor => }/gltf-interactivity-engine/LICENSE |  0
 .../gltf-interactivity-engine/build/index.js       |  0
 .../gltf-interactivity-engine/package.json         |  0
 pnpm-lock.yaml                                     | 22 ++---
 pnpm-workspace.yaml                                |  1 -
 23 files changed, 120 insertions(+), 22 deletions(-)
```

No source file outside the moves, the references and the guard changed.

## 3. `git grep -n 'packages/vendor'` at the tip

```
devtasks/PREBRIEF-scripting-4b-2.md:605  ... `packages/vendor/gltf-interactivity-engine/`
devtasks/PREBRIEF-scripting-4b-2.md:609  ... `packages/vendor/gl-matrix/` ...
devtasks/PREBRIEF-scripting-4b-2.md:611  ... `packages/vendor/VENDORED.md` ...
devtasks/PREBRIEF-scripting-4b-2.md:614  ... globs (`packages/vendor/*`) ...
```

**Nothing outside `devtasks/`.** (`devtasks/` keeps its history as written.)
`git grep -n 'packages/vendor' -- . ':!devtasks'` → no matches.

## 4. The guard (U1)

`packages/behaviors/tests/workspace-rules.test.js` — four tests, reading
repo files only (the same shape `vendor.test.js` already had; no DOM, no
three.js, no timers). Its comment says the two rules mirror the host's
`config.WORKSPACE_ALLOWED` and `workspace.package_dirs`, so a future round
cannot add a glob or an entry the deploy refuses without this test failing
first.

1. `pnpm-workspace.yaml`'s `packages:` globs are each one of `packages/*`,
   `tools/*`, `apps/*` (the host's `config.WORKSPACE_ALLOWED`).
2. every entry directly under `packages/`, `apps/` and `tools/` (dot
   entries aside) is a directory whose name matches `^[a-z0-9][a-z0-9-]*$`
   and is none of them `node_modules` (the host's `workspace.package_dirs`).
   A directory without a `package.json` is allowed: the host skips it, and
   `tools/som-inspector` is one (verified: it has `index.html` and `src/`,
   no `package.json`).

Every entry in the base passes it, and the tip has no entry that fails it
other than the ones this round removes — the tip is green with no
loosening. (Had one existed, this would have been a `needs_input` block.)

## 5. Proofs — all four reproduced, each restored from a saved copy

Method, as the contract requires: **commit first**, keep an on-disk copy of
each file, break the file, run the named test file(s) under `timeout 180`,
record the failing test names and the exit code, restore from the saved copy
(**never `git checkout`**), re-run green. Every restored file was confirmed
byte-identical afterwards (`git status --short` empty).

- **(u1)** the nested `vendor` glob put back in `pnpm-workspace.yaml`
  (copy `pnpm-workspace.yaml` → save → insert the line → run):
  `workspace-rules.test.js` → **exit 1**, 3 pass / 1 fail, failing by name:
  `not ok 1 - pnpm-workspace.yaml names only packages/*, tools/* and apps/*`,
  `error: 'pnpm-workspace.yaml names a glob the host refuses (config.WORKSPACE_ALLOWED): packages/vendor/*'`.
  Restored; re-run **4 pass / 0 fail, exit 0**.
- **(u2)** a file added directly under `packages/` (`packages/NOTES.md`):
  `workspace-rules.test.js` → **exit 1**, 3 pass / 1 fail, failing by name:
  `not ok 2 - packages/ holds only workspace-package directories`,
  `error: 'packages/NOTES.md is not a directory (the host lists every direct entry)'`.
  The file removed; re-run **4 pass / 0 fail, exit 0**.
- **(u3)** the engine's import-map entry pointed back at the old nested
  path (`apps/client/index.html`): `importmap-guard.test.js` →
  **exit 1**, 11 pass / 1 fail, failing by name:
  `not ok 2 - every bare specifier in the page’s static import graph is mapped`,
  `error: 'packages/vendor/gltf-interactivity-engine/build/index.js: imported by a page but missing'`
  (i.e. the importmap-guard fails on the missing file, as §3 requires).
  Restored; re-run **12 pass / 0 fail, exit 0**.
- **(c)** one byte of the moved engine file changed
  `packages/gltf-interactivity-engine/build/index.js`, offset 44 `P`→`p`
  (byte count unchanged at 353,583, so the **hash** is what fails):
  `vendor.test.js` → **exit 1**, 17 pass / 1 fail, failing by name:
  `not ok 2 - gltf-interactivity-engine/build/index.js matches its recorded bytes and sha256`.
  Restored from the saved copy (`sha256sum` back to
  `23a4604c0b7621e08bba8c115d9815b403abc9f517406c2b19d624c20f2270b6`);
  re-run **18 pass / 0 fail, exit 0**.

Every proof file exited on its own (no `--test-force-exit` anywhere; no
timeout was needed as a result). No proof was "not reproducible".

## 6. `r1` against the moved engine

`devtasks/spike-4b/r1.mjs` is unchanged, and the engine's files are
byte-identical after the move, so the probe's output must be identical too.
It was measured both ways rather than asserted:

- **before** (round-3 tree at `c0e563f0`, the engine at its old path):
  `timeout 120 node devtasks/spike-4b/r1.mjs` → exit 0, 21 lines, sha256
  `632242302566394eb46d3f93fd0dd05d27e571944f161b69a75f905ff5558cd4`;
- **after** (this round's tip, the engine at `packages/gltf-interactivity-engine/`):
  exit 0, 21 lines, sha256
  `632242302566394eb46d3f93fd0dd05d27e571944f161b69a75f905ff5558cd4` — **byte-identical** (`diff` empty).

Method note (not a deviation from the contract, but worth recording for the
reviewer): `r1.mjs` imports the engine by its **bare name**, and Node's ESM
resolver does not read `NODE_PATH`, so a bare run from `devtasks/` finds no
package. The probe was run with a temporary symlink at
`/workspace/wt/node_modules/@khronosgroup/gltf-interactivity-engine`
(outside every repo, pointing first at the round-3 engine and then at the
moved one), removed afterwards. Nothing inside any repo was touched.

The output (identical before and after; `validate:` is the server's gate,
`load:` is the lenient loader — F1's whole point):

```
select-visibility (hide)     {n} + int (F1/F8 as written)  | validate: REJECTED: invalid or missing pointer/set input n   | load: ok
select-visibility (toggle)   {n} + int (F1/F8 as written)  | validate: REJECTED: invalid or missing pointer/get input n   | load: ok
select-animation (play)      {n} + int (F1/F8 as written)  | validate: accepted                                          | load: ok
proximity-animation          {n} + int (F1/F8 as written)  | validate: accepted                                          | load: ok
select-light                 {n} + int (F1/F8 as written)  | validate: REJECTED: invalid or missing pointer/get input n   | load: ok
select-visibility (hide)     [n] + int                     | validate: accepted                                          | load: ok
select-visibility (toggle)   [n] + int                     | validate: accepted                                          | load: ok
select-animation (play)      [n] + int                     | validate: accepted                                          | load: ok
proximity-animation          [n] + int                     | validate: accepted                                          | load: ok
select-light                 [n] + int                     | validate: accepted                                          | load: ok
select-visibility (hide)     {n} + ref /nodes/1            | validate: accepted                                          | load: ok
select-visibility (toggle)   {n} + ref /nodes/1            | validate: accepted                                          | load: ok
select-animation (play)      {n} + ref /nodes/1            | validate: accepted                                          | load: ok
proximity-animation          {n} + ref /nodes/1            | validate: accepted                                          | load: ok
select-light                 {n} + ref /nodes/1            | validate: accepted                                          | load: ok
interval-animation, F8 row 5 (delayed self-loop)           | validate: REJECTED: output flow must point to a later node  | load: ok
interval-animation, alternative (a): event/receive atrium/interval | validate: accepted                                   | load: ok
interval-animation, alternative (b): onTick -> throttle    | validate: accepted                                          | load: ok
sync cycle sequence -> sequence (t6 item 5)                | validate: REJECTED: output flow must point to a later node  | load: ok
F-L2 shape: select-animation + empty variables/events      | validate: REJECTED: graph does not match the Khronos JSON schema | load: ok
event/onSelect declared bare, without its extension        | validate: REJECTED: unknown core operation event/onSelect   | load: ok
```

## 7. The suites

`node --version` = **v22.23.2**; `pnpm --version` = 12.3.4. Command shape:
server files **one at a time** under `timeout 180 node --test <file>`; every
other package `node --test` on its own test directory; `packages/client`
without `--test-force-exit`; **no `--test-force-exit` anywhere**; no
background or detached runs; no whole-suite `pnpm test`.

`packages/server` — **all 39 files, one at a time, every one exit 0, every
one exited on its own** (tests / pass / fail / cancelled / skipped):

| file | tests | pass | fail | cancelled | skipped | exit |
|---|---|---|---|---|---|---|
| add-extras.test.js | 9 | 9 | 0 | 0 | 0 | 0 |
| animation-extras.test.js | 15 | 15 | 0 | 0 | 0 | 0 |
| animation-stamp.test.js | 5 | 5 | 0 | 0 | 0 | 0 |
| audit-document.test.js | 6 | 6 | 0 | 0 | 0 | 0 |
| auth.test.js | 17 | 17 | 0 | 0 | 0 | 0 |
| autosave.test.js | 10 | 10 | 0 | 0 | 0 | 0 |
| avatar-ownership.test.js | 4 | 4 | 0 | 0 | 0 | 0 |
| avatar.test.js | 7 | 7 | 0 | 0 | 0 | 0 |
| behavior-leaf.test.js | 21 | 21 | 0 | 0 | 0 | 0 |
| client-listener-guards.test.js | 3 | 3 | 0 | 0 | 0 | 0 |
| commons.test.js | 19 | 19 | 0 | 0 | 0 | 0 |
| db.test.js | 11 | 11 | 0 | 0 | 0 | 0 |
| dump-cost.test.js | 2 | 2 | 0 | 0 | 0 | 0 |
| duplicate-names.test.js | 4 | 4 | 0 | 0 | 0 | 0 |
| edit-e2e.test.js | 6 | 6 | 0 | 0 | 0 | 0 |
| edit-plumbing.test.js | 42 | 42 | 0 | 0 | 0 | 0 |
| external-refs.test.js | 6 | 6 | 0 | 0 | 0 | 0 |
| home-world.test.js | 15 | 15 | 0 | 0 | 0 | 0 |
| http-integration.test.js | 51 | 51 | 0 | 0 | 0 | 0 |
| model-extras.test.js | 7 | 7 | 0 | 0 | 0 | 0 |
| multi-world-mutation.test.js | 9 | 9 | 0 | 0 | 0 | 0 |
| object-id.test.js | 20 | 20 | 0 | 0 | 0 | 0 |
| origin.test.js | 17 | 17 | 0 | 0 | 0 | 0 |
| payload-cap.test.js | 2 | 2 | 0 | 0 | 0 | 0 |
| presence.test.js | 6 | 6 | 0 | 0 | 0 | 0 |
| prune-serialize.test.js | 13 | 13 | 0 | 0 | 0 | 0 |
| rate-limit.test.js | 5 | 5 | 0 | 0 | 0 | 0 |
| reconnect-session.test.js | 5 | 5 | 0 | 0 | 0 | 0 |
| script-host.test.js | 11 | 11 | 0 | 0 | 0 | 0 |
| send-field-allowlist.test.js | 44 | 44 | 0 | 0 | 0 | 0 |
| session.test.js | 19 | 19 | 0 | 0 | 0 | 0 |
| sky-url.test.js | 31 | 31 | 0 | 0 | 0 | 0 |
| source-ref-guard.test.js | 21 | 21 | 0 | 0 | 0 | 0 |
| teleporter.test.js | 16 | 16 | 0 | 0 | 0 | 0 |
| transform-ranges.test.js | 11 | 11 | 0 | 0 | 0 | 0 |
| visitor-leak.test.js | 4 | 4 | 0 | 0 | 0 | 0 |
| world-crud.test.js | 75 | 75 | 0 | 0 | 0 | 0 |
| world-visibility.test.js | 24 | 24 | 0 | 0 | 0 | 0 |
| world.test.js | 9 | 9 | 0 | 0 | 0 | 0 |

Every other package (`node --test <dir>/*.test.js`):

| package | tests | pass | fail | cancelled | skipped | exit |
|---|---|---|---|---|---|---|
| packages/som/test | 250 | 250 | 0 | 0 | 0 | 0 |
| packages/som/tests | 10 | 10 | 0 | 0 | 0 | 0 |
| packages/protocol/test | 91 | 91 | 0 | 0 | 0 | 0 |
| packages/client/tests (no force-exit) | 536 | 536 | 0 | 0 | 0 | 0 |
| packages/behaviors/tests | 116 | 115 | 0 | 0 | **1** | 0 |
| packages/renderer-three/tests | 310 | 310 | 0 | 0 | 0 | 0 |
| packages/interaction/tests | 9 | 9 | 0 | 0 | 0 | 0 |
| apps/client/tests | 1082 | 1082 | 0 | 0 | 0 | 0 |

**Skipped total: 1** — the one skip the round allows and no other.
`packages/behaviors/tests` is 116 because the guard adds 4 to the base
`c0e563f0` tree, whose own count was measured for this handoff (read-only,
in the round-3 worktree): **112 tests, 111 pass, 1 skipped**. `importmap-guard`
is green: 12/12, exit 0 (and 3/3 suites). `apps/client` rose from 1049
(round 2) to 1082 with round 3's T1 tests plus nothing here — this round
changed no `apps/client` test.

**The one named skip** (`packages/behaviors/tests/conformance.test.js`):
```
not ok 2 - the subset recomputes against the checked-in list, and every asset runs # SKIP KHRONOS_ASSETS is not set — the conformance subset cannot be recomputed or run (skipped, not failed)
# tests 2  # pass 1  # fail 0  # skipped 1
```
`KHRONOS_ASSETS` was **not** set for this round's runs (the round moves
files; it added no conformance case). The F3 invalid-index test is
always-on and ran green inside the `packages/behaviors/tests` count above.

## 8. Deviations

1. **The guard lives in `packages/behaviors/tests/`**, the file the section
   §2 U1 names first and the one that already reads repo files
   (`vendor.test.js`). No new directory was introduced. (The revision
   allowed either `packages/behaviors/tests/` or `apps/client/tests/`.)
2. **The guard parses `pnpm-workspace.yaml` by hand** (the `packages:` block,
   the `- <glob>` lines) rather than importing a YAML library:
   `packages/behaviors` has no YAML dependency and the tests, per the spec's
   §7, must not add one for a two-rule file check.
3. **Comments in the two test files avoid the literal string
   `packages/vendor`** (the old path is described in prose). §2 U1 requires
   `git grep -n 'packages/vendor'` to find nothing outside `devtasks/`, so
   the explanations were worded around it rather than adding two matches.

Nothing else deviates: no source file outside the moves, the references and
the guard changed.

## 9. Final state

- `git status --short` at the tip: **empty**.
- `workflow/scripting-4b-2` exists only in `/workspace/wt/scripting-4b-2`;
  `git ls-remote --heads origin workflow/scripting-4b-2` returns nothing
  (not pushed; the deployer publishes).
- `/workspace/atrium` untouched.
- Scratch left outside every repo for the operator to delete:
  `/workspace/wt/.r4-proofs/` (proof outputs and saved copies),
  `/workspace/wt/.r4-suites.sh`, `/workspace/wt/.r4-suite-report.txt`.
  Nothing of it is inside the worktree.
- Not done, and not claimed: the §5.1 browser checks, the release chain,
  DEV acceptance. Round 4's review reproduces (u1)–(u3) and (c) itself, runs
  `r1` against the moved engine and recomputes every `VENDORED.md` hash.

READY_FOR_REVIEW
