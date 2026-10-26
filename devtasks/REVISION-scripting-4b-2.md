# Revision — scripting-4b-2 round 2 (after the GLM review of `b246093f`)

**Status:** approved by the operator (2026-10-24 21:53 PT), Rev 0 as
drafted: R1 and R2 in one round, §1.3's six deviations accepted.
- **Base:** round 1's reviewed tip `b246093f31866d3d409a851cce1505c6a1c13d60`
  on `workflow/scripting-4b-2`. Round 2 commits on top of it, on the same
  branch, in the existing worktree `/workspace/wt/scripting-4b-2`.
- **Nothing was published or deployed in round 1.** The review returned
  CHANGES_REQUIRED, so the review gate `t_3e676fd9` blocked for the operator
  and no release chain was built. That gate and round 1's sentinel
  `t_6ad02da5` stay as they are, superseded by round 2's.
- **The contract still governs:** `devtasks/PREBRIEF-scripting-4b-2.md`,
  FINAL Rev 2.1, at `951b541bef818499a16692ac968f1800fdb75434` (sha256
  `a7841421312f5ae59b74d8623067986557b4a241f048c30adbb556bc44190a73`), with
  the two operator texts on the implementation card `t_6c3817b2`: the
  **OPERATOR CORRECTION** (C1–C3, 2026-10-25 02:12 UTC) and the **OPERATOR
  NOTE** for the continuation (items 1–5, 02:41 UTC). This file adds R1 and
  R2, accepts round 1's last reported deviations (§1.3), and changes nothing
  else.

## 1. What the review found

### 1.1 The verdict
The GLM review (`t_4cf25321`, run 1016) returned **CHANGES_REQUIRED** on one
item, the operator correction's C2, which was half delivered:
- **the code is right:** `lightIntensity` returns 1 when the saved
  intensity is below 0.01 (`behavior-form.js` L156–158);
- **the mandated F9 test doesn't exist:** "Save on a light at intensity 0
  writes a graph whose on-branch literal is 1";
- **the help text C2 specifies is missing:** `elements.hintText` carries only
  the generic sentence (`behavior-form.js` L549).

Everything else the review checked was clean: the spec hash; all 14
vendored files against `VENDORED.md` and the npm tarballs; tree hygiene (no
symlinks, no committed `node_modules`); F1's two copies; F2; F4; F5; the
templates' `[n]` literals; C1 and C3 in source; the vectors (22 accepted,
including the 64-node and 16-type boundaries, and the back-edge case); every
suite, one server file at a time; the conformance test 2/2 and the
invalid-index test 3/3 with `KHRONOS_ASSETS` set; `r1` against the vendored
engine; and proof (f4), by its own break.

### 1.2 What the review didn't do
The kickoff required the reviewer to **reproduce every proof itself** and
**name every test in the spec's §5 table**. This review reproduced one proof,
(f4), of 26, and named no test list. Its first run ran out of its iteration
budget (300 of 300) and the second finished the remaining stages. So round
1's "review-clean" rests, for 25 proofs, on the implementer's handoff alone.
Round 2's review closes that gap (§4, card 2).

Neither the review nor the spec checked the **licence of the checked-in
Khronos fixtures** (R2).

### 1.3 Round 1's last reported deviations: accepted
The implementer's final handoff (run 1014, 03:45 UTC) reported six more
deviations. The operator accepts all six; round 2's reviewer checks them
against this list, not as findings:
1. `model-animations.update()` returns the number of entries it stepped (a
   test seam for F-L12 item 2; production ignores it).
2. Proof (d) reproduces as a 45 s timeout and (d4) as a 120 s timeout after
   its eight named failures, not as named failures alone: with the break,
   the file never exits. That is what those breaks do.
3. Proof (f) is aimed at the one visibility path (`visibility.js`
   `setNodeVisible` / `applyVisibility`), since C1 withdrew the bridge's.
   C1 itself is (f4).
4. **The F11 conformance subset is empty, and F3's 4b-2 subset of the invalid
   index is 0 of 187:** every Khronos asset declares an op outside F-L4. The
   always-on invalid-index test instead pins that all 180 readable invalid
   graphs are refused by the server's rule. That is the round's only
   check against external graphs, so the 180 graphs stay checked in, with
   R2's attribution. (The operator note asked for "only the subset"; it
   turned out empty, so keeping the whole readable set is the right call.)
5. Three of the four clock tests of 4a §6.1 item 5 were written; the optional
   fourth (a second ping burst after the world's models load) wasn't. It
   stays recorded for a later round.
6. Proofs (a2), (h2) and (j) each needed a second, correct break; the
   handoff lists the breaks that reproduce.

## 2. The contract (round 2)

### R1. C2, completed: the light template's on-value, tested and explained
In `apps/client/src/behavior-form.js` and its tests:
- **The help text.** When the chosen template is `select-light`, the form's
  hint shows, after the generic sentence, exactly:
  `If the light was off when you saved, 'on' uses intensity 1.`
  It isn't shown for the other four templates. Same element
  (`elements.hintText`), same rendering path; nothing else in the form
  changes.
- **The tests** (`apps/client/tests/behavior-form.test.js`), each through
  Save with the form's real `templateGraph` and a fake client:
  - a target light at **intensity 0** → the written value's on-branch
    `pointer/set` literal (the `flow/branch` `false` flow) is **1**, and
    `template.params.intensity` is 1;
  - a light whose intensity is **non-finite or missing** → 1, the same way;
  - a light at **0.005** → 0.01 (the floor);
  - a light at **2.5** → 2.5;
  - the hint text is present for `select-light` and absent for each of the
    other four.
- **The code isn't changed** unless a test shows it wrong.

### R2. Attribution for the Khronos-derived fixtures
The always-on invalid-index test reads graphs derived from
**KhronosGroup/glTF-Test-Assets-Interactivity**, whose licence is **CC BY 4.0
International** (its `LICENSES/CC-BY-4.0.txt`; its README: "© 2025, The
Khronos Group and Needle. Licensed as CC-BY 4.0 International"). CC BY needs
attribution, a link to the licence and a note of changes.
- **`NOTICE`** (the repo root) gains an entry naming:
  - the checked-in files derived from the assets (every file
    `build-invalid-subset.mjs` writes; name them in the handoff);
  - the source: `https://github.com/KhronosGroup/glTF-Test-Assets-Interactivity`,
    commit `926bec45dfbe052bad4013ab5852ed2f4042bff5`,
    `Tests/Interactivity/invalid/`;
  - the credit: "© 2025, The Khronos Group and Needle";
  - the licence: CC BY 4.0 International,
    `https://creativecommons.org/licenses/by/4.0/`;
  - the changes: the `KHR_interactivity` JSON of each case was extracted and
    collected into the checked-in files; no graph was edited.
- **The licence text beside the files:** the assets' own
  `LICENSES/CC-BY-4.0.txt` at that commit, copied byte for byte into the
  fixtures' folder as `LICENSE-CC-BY-4.0.txt`, its sha256 recorded in the
  handoff.
- **A guard test** (`packages/behaviors/tests/invalid-index.test.js` or a new
  file): `NOTICE` names the fixtures' folder and "CC BY 4.0", and the licence
  file exists beside them.
- **If `NOTICE` already carries this,** say so in the handoff and add only
  what's missing, plus the guard.

### What doesn't change
Everything else in F1–F12, C1–C3, the continuation note and §1.3.

## 3. Tests and proofs (round 2)

| Item | New tests |
|---|---|
| R1 | `behavior-form.test.js`: the four intensity cases and the hint text, as listed in R1 |
| R2 | the `NOTICE` and licence-file guard |

**Proofs** (each break fails named tests; "not reproducible" is not an
acceptable result):
- **(r1)** `lightIntensity` returns 0.01 for a light at 0 (R1's intensity-0
  test fails);
- **(r2)** the C2 sentence removed from the hint (its assertion fails);
- **(r3)** the `NOTICE` entry removed (the guard fails).

**And the whole round still passes:**
- full suites, with round 1's rules: server files one at a time under
  `timeout 180`, `packages/client` without `--test-force-exit`, every other
  package with `node --test` on its own directory, `importmap-guard` green,
  the one named conformance skip and no other;
- round 1's proofs on the files round 2 touches, re-run against the round-2
  tip: **(h)** and **(h2)** (`behavior-form.js`), and **(c)** (the hash test,
  since R2 adds a recorded file).

**Steps, one commit each:**
1. R1 and its tests;
2. R2 and its guard;
3. suites, proofs and the handoff.

**Before DEV acceptance**, after round 2's release chain publishes and deploys:
- the operator's **outside code review of the published SHA**, over the
  whole round (base `951b541b` to the round-2 tip);
- **Claude's §5.1 browser checks** (1–9 and 8b), against the published SHA,
  in the harness.

The operator then runs the spec's §6 DEV acceptance.

## 4. Kickoff body for round 2 (post it verbatim as the revision kickoff card's text)

---

### KICKOFF — scripting-4b-2 revision round 2. Slug: `scripting-4b-2`

You are the kickoff orchestrator for round 2 of `scripting-4b-2`. Build the
graph below, read it back, report, and stop. Do not implement, review or
deploy anything yourself.
- **Your tools:** only `kanban_*`.
- **Blocking:** never call `kanban_block` without an explicit `task_id`, and
  never block this card.
- **Titles:** use them exactly as written. Don't add words to them.

**The contract is in git; you don't read it.** It is
`devtasks/REVISION-scripting-4b-2.md` on `main`, together with
`devtasks/PREBRIEF-scripting-4b-2.md` at `951b541bef818499a16692ac968f1800fdb75434`
(sha256 `a7841421312f5ae59b74d8623067986557b4a241f048c30adbb556bc44190a73`)
and the two operator texts on `t_6c3817b2` (the OPERATOR CORRECTION and the
OPERATOR NOTE).
- **The front door has already checked the round-2 revision** and posted
  its commit and sha256 on this card. **You have only `kanban_*` tools: do
  not try to fetch or hash anything, and do not block for lack of a shell.**
- Copy that commit and sha256 into cards 1 and 2. **They** have terminal,
  file and git tools. Each reads the revision with
  `git -C /workspace/atrium fetch origin main && git -C /workspace/atrium show <commit>:devtasks/REVISION-scripting-4b-2.md > /tmp/revision-r2.md && sha256sum /tmp/revision-r2.md`,
  and blocks with `kind="capability"` on a mismatch.

#### Graph
1. **`Implement r2 — scripting-4b-2`.** Assignee `atrium-deepseek`, parent:
   this kickoff, `--max-runtime 2h` (7200 s).
   - **Body:**
     - the revision reference and hash check;
     - continue `workflow/scripting-4b-2` from
       `b246093f31866d3d409a851cce1505c6a1c13d60` in the existing worktree
       `/workspace/wt/scripting-4b-2` (`git -C /workspace/wt/scripting-4b-2
       status` must be clean at that SHA, or block `needs_input`);
     - the revision's §2 contract and §3 steps, tests and proofs;
     - the spec, the OPERATOR CORRECTION and the OPERATOR NOTE on
       `t_6c3817b2`, still binding;
     - the WORKER-CARD REQUIREMENTS comment (855 on `t_2d41531f`).
   - **The handoff** carries proofs (r1)–(r3), **and** round 1's (h), (h2)
     and (c) re-run, with per-file counts and exit codes, the one named
     skip, the files R2 names and the licence file's sha256.
2. **`GLM review r2 — scripting-4b-2`.** Assignee `atrium-glm`, parent:
   card 1.
   - Its body opens with
     `THIS RUN HAS TERMINAL, FILE AND GIT TOOLS. Use them for every step below.`
   - **The review covers the whole round,** base `951b541b` to the round-2
     tip, against the spec, the two operator texts and this revision.
   - **The reviewer reproduces every proof itself:** round 1's 26 —
     (a), (a2), (b), (b2), (b3), (c), (d), (d2), (d3), (d4), (e), (e2),
     (e3), (e4), (f), (f2), (f3), (f4), (g), (g2), (h), (h2), (i), (i2),
     (j), (k) — and round 2's (r1)–(r3). Round 1's review reproduced only
     (f4).
   - **It names every test** in the spec's §5 table and this revision's §3
     table, and says where each lives. A missing test is a finding, never a
     pass.
   - It checks round 1's accepted deviations against the revision's §1.3
     and the OPERATOR NOTE, not as findings, and checks R2 against the
     assets' licence.
   - **Progress comments on its own card** after each stage (static review;
     each group of five proofs; server files; client files), so a run that
     stops on its iteration budget is retried from its last comment, not
     from the start.
3. **`Review gate r2 — scripting-4b-2`.** Assignee `atrium-orchestrator`,
   parent: card 2. It creates nothing.
   - **On a valid APPROVE of the exact 40-character SHA,** it blocks with
     `APPROVE <SHA40>: front door, build the release chain`.
   - **Otherwise,** it blocks for the operator with the verdict quoted.
4. **Before you complete,** link card 3 to **round 2's sentinel** as a
   parent. The front door creates it and posts its id on this card. Round
   1's `t_6ad02da5` must not be used. Do not create a sentinel yourself.
5. **The release chain** is the front door's: the same four cards as
   scripting-4b-1's (Publish, DEV deploy, DEV finalizer, acceptance gate),
   with the new SHA, built whole at card 3's APPROVE. The DEV deploy
   restarts DEV. Nothing reaches MAIN or PROD.

#### Report back
- the three ids;
- the implementation's parent and its 7200 s cap;
- the hash line copied into cards 1 and 2;
- the review's opening line;
- the gate linked to round 2's sentinel.

Then complete this card.

---
