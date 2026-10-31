# Atrium Passdown — 2026-10-30 — scripting-4d's pre-brief FINAL, its fixtures, and 4d-1's kickoff

**Predecessor:** `devtasks/Atrium-Passdown-2026-10-30-scripting-4c.md`. Its
host, connector and convention notes still hold, except where this file says
otherwise.

**First instruction for the next session's Claude:**
1. Clone the repo and read `devtasks/`, newest first (this file first).
2. Use the `atrium-ops` connector for board, release, log and git state. It
   is read-only.
3. **Next: 4d-1's kickoff** (`devtasks/KICKOFF-scripting-4d-1.md`), if the
   operator hasn't run it yet. The front door creates the sentinel first,
   fills the body's three placeholders, then creates the card (§3). After
   the round's review gate approves: Claude's §6.1 browser checks (eleven,
   two of them measured gates, one a rollback rehearsal), then the outside
   review of the whole round, then DEV acceptance.
4. **The repo's code runs in this environment.** The first session's
   sandbox refused to execute the cloned repo once; the operator confirmed
   that running it is expected, and the retry worked. Don't draft around
   it again: run the suites and the probes.
5. **Never push to `main` between a DEV deploy's release merge and the MAIN
   push** of the release you mean to ship.
6. **Give the operator host commands as one copyable `bash <<'EOF'` block
   each, and say exactly when to run it.**

## 1. Status at handoff

| Item | State |
|---|---|
| Release | Unchanged: DEV, MAIN and PROD at `14ab0076` (scripting-4c), healthy, lock free. `main` is at `1a26d8fa`, ahead by `devtasks/` and one `tests/`-only commit (expected) |
| Spec | `devtasks/PREBRIEF-scripting-4d.md` **FINAL Rev 1.4**, 121,240 bytes, sha256 `457e2ff0…9458`, at **`4f19b253`**, 4d-1's base |
| Decisions | G-L1–G-L12, Q3 and Q7 approved by the operator, all as recommended (2026-10-30 20:57 PT) |
| Reviews | Three outside reviews of the pre-brief: Rev 0 CHANGES REQUESTED (4/7/2), Rev 1 CHANGES REQUESTED (3/4/2), Rev 1.1 **APPROVE WITH NITS** (0/2/4). The third reviewer **cloned and ran code** for the first time (§4.3) |
| Fixtures | `tests/fixtures/behavior-conformance-4d/` (21 graphs) and `tests/fixtures/behavior-conformance-khronos/` (143 graphs, CC-BY-4.0, manifest), at `e600905e`. Read-only for the round |
| Kickoff | `devtasks/KICKOFF-scripting-4d-1.md` at `1a26d8fa`, drafted, not yet run |
| Board | Nothing running |

## 2. What the pre-brief settled
4d-1 is one round of seven steps: the runtime for graphs beyond the five
templates, and an importer that puts one standard graph onto the selected
object. In short:
- **ops:** the core set (flow, events including `onStart`, `onTick` and
  `send`, variables, pointers, all math and type ops, animation, debug),
  each only as a bare core declaration; `onSelect` only with its exact
  Khronos extension;
- **unsupported ops are stored, inert and reported** ("Partially
  supported"), gated by `(op, extension)` identity through a renamed load
  copy; an unsupported node may end flows but never feed a value to one that
  runs;
- **pointers:** node transforms and visibility (literal, `[x]` and `{x}`),
  read-only matrices, light intensity and colour; no materials;
- **time:** the ops observe an injected clock; delays have monotonic ids and
  a cap of 16; interpolation callbacks are wrapped on the adapter's bus;
- **the runner:** writes checked by the server's own value rules; a total
  send opportunity; a frame limit of 10,000 node starts or 8 ms; an overlay
  so a graph reads its own writes, with a stated invariant;
- **limits:** 64 Ki units a leaf, 256 nodes, 1 MiB of behaviour per world;
- **`scriptRunner: 3`**, so a 4c tab is never the host;
- **rollback:** roll forward by default; offline export and a three-outcome
  reconcile, rehearsed on a copy of PROD's data before PROD.

Out of 4d-1: `KHR_animation_pointer` models (4d-2), material pointers, a
synced transition, embedded graphs in placed models (pre-brief §10).

## 3. How it ran

| Stage | Commit | What happened |
|---|---|---|
| Rev 0 | `2b6f7df0` | Drafted from the 4c and 4b-2 pre-briefs, the design, code reading, a static survey of the Khronos assets and probes `p1`–`p7` |
| Review of Rev 0 | — | CHANGES REQUESTED, source-only. M1 (an extension runs a core op), M2 (the overlay can't tell its own echo), M3 (the clock test can't pass), M4 (reused delay slots) |
| Rev 1 | `2bb7013e` | All taken; M1, M3 and S1 reproduced by running code (`r1`, `r2`) |
| Review of Rev 1 | — | CHANGES REQUESTED, source-only. M1 (an overlay entry with no send behind it), M2 (finite but invalid transforms), M3 (the rollback restore) |
| Rev 1.1 | `3a689eb4` | All taken; S4 reproduced (`r3`) |
| Review of Rev 1.1 | — | **APPROVE WITH NITS**, with a clone and runs. S1 (the reconcile's `unchanged` case), S2 (where the overlay is written) |
| Rev 1.2, FINAL 1.3 | `587d1ac`, `50a938d` | Taken; the operator approved |
| Fixtures, Rev 1.4 | `e600905e`, `e3fcc61`, `4f19b253` | The fixtures found P26 (§4.1) |
| Kickoff | `1a26d8fa` | Drafted |

**Running the kickoff (front door, from the file's note):**
1. check the spec's hash at `4f19b253` yourself;
2. create the sentinel first (the guard creates it `blocked`, unparented);
3. fill `<SPEC_CHECK>`, `<SENTINEL_ID>` and `<CANONICAL_REQUIREMENTS>`
   (signin-sync's comment 855 on `t_2d41531f`, verbatim) in the body;
4. create the kickoff card with the filled body, read it back whole;
5. link the kickoff to the sentinel, read the sentinel back.

## 4. Findings and lessons

### 4.1 Writing the fixtures found a shipped defect (P26)
The engine's pointer trie keeps one index node per level, so the adapter's
per-index closures all reach the last `nodeMap` index. A lone write to
`/nodes/0/scale` landed on node 1. **No shipped template is affected**
(each writes only the last index), and authority is checked on the same
index the write goes to, so nothing unauthorized was ever written. **The
tests missed it** because every authority test used `[OWN, TGT]` and wrote
index 1: the signin-sync §4.1 shape again, a test value that happens to
match. The `p4` probe printed the symptom in Rev 0 and it was misread.
**Lessons:** read every line of a probe's output against what it should
say; and write expected values by hand before running anything, as the
fixtures were, so the run can disagree with you.

### 4.2 The probes paid for themselves
Rev 0's probes changed three things before any reviewer read it (`p3`'s
value-read crash, `p2`'s frame budget, `p6`'s baseline), and every review
finding that could be reproduced was (`r1`–`r3`, and the reviewer's `x1`).
Keep the 4c pattern: each finding checked at the code, and run where it can
be.

### 4.3 The reviewer cloned on the third try
ChatGPT's environment failed on DNS for `github.com` twice, then cloned and
ran everything on the third review. The review prompt now starts with the
clone, says to report the error if it fails, and falls back to pinned
`raw.githubusercontent.com` URLs. Keep both paths in every prompt.

### 4.4 "Verified" means a fix was run
The second review's N1: the probes reproduced defects, they didn't verify
fixes that don't exist yet. Say *reproduced* or *confirmed in the source*
until the round's own tests run.

### 4.5 Healing isn't saved until a mutation
4c's (and 4d's) load healing sets a refused behaviour to `null` in memory;
the database keeps the old leaf until the world is saved after an edit
(the third review's S1). Anything that reasons about rollback or migration
should start from that.

## 5. Recipes
The same as the scripting-4c passdown §5, plus:
- **The 4d probes and tooling:** `devtasks/spike-4d/README.md` (`p1`–`p7`,
  `r1`–`r4`, `x1`, the survey, `fixtures-gen.mjs`, `fixtures-check.mjs` with
  `FIXED_POINTERS=1`, `khronos-extract.mjs`). They run from the repo root
  against the workspace's real adapter.
- **The Khronos assets** at `926bec45` (281 MB), data only:
  ```bash
  git init assets && cd assets && git remote add origin https://github.com/KhronosGroup/glTF-Test-Assets-Interactivity
  git fetch --depth 1 origin 926bec45dfbe052bad4013ab5852ed2f4042bff5 && git checkout FETCH_HEAD
  ```
- **Playwright from an ES module:** `createRequire(import.meta.url)('playwright')`
  (a bare `import` doesn't find the preinstalled package).

## 6. Follow-ups

### 6.1 Next: 4d-1
The kickoff (§3), then the round, Claude's §6.1 checks (with the measured
gates and the rollback rehearsal, before DEV acceptance), the outside
review of the round, DEV acceptance, release.

### 6.2 After 4d-1
- **4d-2, `KHR_animation_pointer` models:** its own short pre-brief (which
  three.js versions Needle's `@needle-tools/three-animation-pointer` plugin
  supports, vendoring it, and the panel text meanwhile).
- **Material pointers**, with an authority rule for shared materials.
- **A synced transition** for smooth interpolation.
- **Non-destructive healing** for future rollbacks.

### 6.3 Carried, unchanged
The scripting-4c passdown §6.2 (N1 is now in 4d-1's scope), §6.3 (the
same-tab sign-in), §6.4 and §6.5.

## 7. Cleanup
Nothing to clean on the host: no cards, branches or deploys were made. The
three review files and the probes are in `devtasks/` on purpose.
