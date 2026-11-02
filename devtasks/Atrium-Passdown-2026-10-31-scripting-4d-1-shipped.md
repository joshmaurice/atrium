# Passdown 2026-10-31: scripting-4d-1 shipped to PROD (`84542c73`)

Supersedes the 2026-10-31 scripting-4d-1 passdowns as the starting point. Read this file first; open the
others only for history. The host, connector and convention notes in
`Atrium-Passdown-2026-10-31-scripting-4d-1-on-dev.md` still hold.

**First instruction for the next session's Claude:**
1. Clone the repo and read this file, then `devtasks/PREBRIEF-scripting-4d.md` §10 (the next rounds).
2. Use the `atrium-ops` connector for board, release, log and git state; it is read-only. To push `devtasks/`
   to `main`, attach the repo with push access (`add_repo`, `joshmaurice/atrium`, access `push`) and clone to
   `/home/claude/atrium`.
3. **The release rule:** from a round's DEV release merge until PROD is `COMPLETE`, push **nothing** to
   `main`, not even `devtasks/` notes. Hold the records and push them after PROD (§4).
4. The harness (`devtasks/harness/`, `checks/scripting-4d/README.md`) runs the real code here: `setup.sh <SHA>`
   with `ATRIUM_REPO` pointing at the clone it installs into. The proxy refuses `dev.ewwb.dev`, so "checks on
   DEV" means the harness at the DEV SHA.

## 1. Where things stand

| What | State |
|---|---|
| Release | `COMPLETE`. DEV = MAIN = PROD = **`84542c73156546d82d63cbb202325dd8bb24a487`** (round 6's reviewed tip `fe4dcbb3` + `main`'s `devtasks/` notes; same code). All healthy |
| PROD's switch to 4d | 2026-11-01 02:38 UTC: the 4c server stopped `Deactivated successfully`; the 4d server started (pid 3200799). PROD's 23 worlds hold **no** behaviour leaves yet; DEV has 10 |
| Board | Nothing blocked or open for 4d-1. Superseded acceptance cards archived; round 6's acceptance `t_12ea047f`, PROD gate `t_845a7ca1` and deploy `t_a24ee502` done |
| Branches | `workflow/scripting-4d-1` and `release/{3cfeeed9a8bf,769825ce3781,85669db0f8a9,e536913011cc,fe4dcbb34ed7}` remain on GitHub; deletable (operator) |
| `main` after the release | `c760d3a` (this round's records) and this file, both `devtasks/` only, pushed after `COMPLETE` |

## 2. What shipped (scripting-4d-1, six rounds)
Graphs beyond the templates: owners import `KHR_interactivity` graphs through the panel and map their objects
and lights; variables, `onStart`/`onTick`, delays, interpolations; "Partially supported" for what Atrium doesn't
run; the per-world 1 MiB total; a frame budget; the rollback export/reconcile scripts with a lifetime lock.
The contract: `PREBRIEF-scripting-4d.md` FINAL Rev 1.4 + notes Rev 1.5–1.8 (on the branch, now on `main`), and
`REVISION-scripting-4d-1{,-round-3,-round-4,-round-5,-round-6}.md`.

| Round | What it fixed | Found by |
|---|---|---|
| 3 | the browser-only `setTimeout` receiver (F1), importer light/node namespace, the lock (M2), string bounds | Claude's browser checks; the first code review |
| 4 | object names in the grant line and the Q3 prompt; the lock rebuilt as a kernel lock held by the server **and** the scripts; declaration socket-map keys; a quadratic light match | Claude's checks; the second review (its M1 reproduced: a second server started on one database) |
| 5 | a dangling database symlink; the lock's journal kept in memory; the server ends by the signal (systemd records a clean stop) | the third review; Claude's F7 |
| 6 | link targets resolved the kernel's way (`realpathSync.native`); a loop refuses cleanly | the fourth review (plus a sibling layout Claude found) |

Every outside review was source-only (no clone, no `pnpm`); Claude reproduced each finding with the real code
before it went into a revision, and turned several estimates into measurements (§3). The reviews are on record:
`REVIEW-scripting-4d-1-round-{3,4,5,6}-code.md`.

**Measured at the end** (checks README, "Results on DEV `7ad49f57`" and earlier): Q7 at 1 MiB, join +0.54 s
(gate 1.5 s), heal + serialize 28 ms (250), visitor heap +2.5 MB (50); 64 behaviours, host p95 frame 92–97 ms
(SwiftShader); the rollback rehearsal 27/27 locally and on the host's database copies.

## 3. Lessons
- **Reproduce every reviewer finding with the real code before writing it into a revision.** Twice that showed
  the finding narrower (S1's input maps) or wider (round 5's sibling layout) than written, and once that a
  check of mine was wrong (a `..` in the configured path is read the same textual way by everything).
- **Node's `path.resolve`/`join` and its JavaScript `fs.realpathSync` fold `..` as text.** For anything that
  must agree with the kernel (lock identity), use `fs.realpathSync.native` and don't normalise a path that may
  still contain `..` after a symlink.
- **A unit test that injects the dependency it tests can't catch a wrong call shape** (F5). Probe the real
  composition once in the browser.
- **A new check must fail on the code with the bug** before its PASS means anything (`probe_r5.sh` was run on
  round 4 first and caught all three).
- **`pkill -f <pattern>` kills the Bash tool's own shell** if the command line contains the pattern (exit
  144); `c1.py`'s check 8 does this to any command that also names `authserver.mjs`. Run `c1.py` alone; stop
  servers by pid.
- **A finalizer can only check what the deploy handoff carries** (R-L7 (a)): success, health, `reviewed_sha`,
  a 40-character `TARGET_SHA`. Since round 4 it passes without the operator.
- **Sentinels:** with exactly one open sentinel, the guard links it to new review gates and finalizers itself;
  archive old rounds' sentinels before a kickoff; a parentless sentinel needs its dependency-hold clause.

## 4. If `main` moves after a release merge anyway
`atrium-main-approve` refuses (`not a fast-forward descendant of origin/main`). The remedy, on the host, same
reviewed SHA, no hand merge: `atrium-release-merge <reviewed SHA>` (prints `RELEASE_SHA=`), then `atrium-deploy
dev <RELEASE_SHA>`, then accept and MAIN/PROD with that SHA. Used once this round (`7ad49f57` → `84542c73`).

## 5. Next
**Follow-ups from 4d-1** (small; fold into the next round that touches them):
1. The Behaviour form's on/off button shows the state ("Disabled"), which reads as an action; make it a switch
   or name the action (operator, at acceptance).
2. The R30 end-to-end test helper starts through `real/child/alias.db`, which never split; use
   `linkdir/alias.db` (round 6 review N1).
3. Carried limits, documented: the 4c server a rollback runs holds no lock (§8 step 3); hard links and other
   mounts; `realpathSync.native` needs `/proc` on musl Linux.

**The next step**, from the pre-brief's §10. **4d-2 — `KHR_animation_pointer` models** is the one already
scoped as its own short pre-brief: which three.js versions `@needle-tools/three-animation-pointer` supports,
vendoring it the way the engine was, and the panel's "has animations, none playable here" text meanwhile.
The others listed there: material pointers (with an authority rule for shared materials), a synced transition
(smooth interpolations for every client), embedded graphs in placed models (a design question first), healing
that keeps what it drops, automatic mapping by name, a per-behaviour distance, whole-world import.

### 5.1 Why 4d-2 isn't urgent, and material pointers may matter more (survey, 2026-10-31)
Claude counted Khronos's reference content (blob-less clones; each asset's glTF JSON read, `.glb` JSON chunks too):
- **`glTF-Sample-Assets`** (`8f49239`, 2026-10-23): 150 models, 26 animated, **5 use `KHR_animation_pointer`**,
  all of them tests of that extension (AnimatedColorsCube, AnimationPointerUVs, CubeVisibility, LightVisibility,
  PotOfCoalsAnimationPointer). The most-used extensions are material ones (transmission 33, volume 25, IOR 17,
  texture transform 15).
- **`glTF-Test-Assets-Interactivity`** (`f99d9b6`, 2026-10-27): 187 assets with a graph (17 sample models, 170
  tests); **2 sample models use `KHR_animation_pointer`** (Ghost, WhackAMole), no test does.

So 4d-2 would make about seven reference files play correctly. Its real-world case is Unity content: Needle and
UnityGLTF export pointer animation by default (Godot imports and exports it; Blender only behind an experimental
export option; three.js core still lacks it, which is the gap Needle's plugin fills). It's worth doing when that
content is expected, not before. Atrium has no users besides the operator yet, so there's no real-world mix to
measure.

**Material pointers are the bigger gap for interactive content.** The 4d pre-brief's survey (§2.4) found that
all 17 interactive sample models have their *graphs* address more than node transforms: material colours,
texture transforms, morph weights, the active camera, animations' `maxTime`. That is what keeps today's
interactive sample models from running in Atrium (beside their driving their own inner nodes, §2.4). The pre-brief
lists it in §10 in one line (G-L4 (b)); the design question is authority over a material that several objects
share. If interoperating with interactive glTF is the goal, it is the step to scope next.
