# Revision — scripting-4b-2 round 3 (after the GLM review of `2d5e3487`)

**Status:** approved by the operator (2026-10-25 08:47 PT), Rev 0 as
drafted: T1 in one round.
- **Base:** round 2's reviewed tip `2d5e34874775a68850049f47118b1b976da52b8a`
  on `workflow/scripting-4b-2`. Round 3 commits on top of it, on the same
  branch, in the existing worktree `/workspace/wt/scripting-4b-2`.
- **Nothing was published or deployed in rounds 1 or 2.** Round 2's review
  gate `t_b3b26724` and sentinel `t_31a95fba`, like round 1's `t_3e676fd9`
  and `t_6ad02da5`, stay as they are, superseded by round 3's.
- **The contract still governs:** `devtasks/PREBRIEF-scripting-4b-2.md`,
  FINAL Rev 2.1, at `951b541bef818499a16692ac968f1800fdb75434` (sha256
  `a7841421312f5ae59b74d8623067986557b4a241f048c30adbb556bc44190a73`); the
  OPERATOR CORRECTION and OPERATOR NOTE on `t_6c3817b2`; and
  `devtasks/REVISION-scripting-4b-2.md` (round 2, at `45fcc433`, sha256
  `4ef9aaad2237b61a5f8f9cf23ffcb6604f4e3765284e5e1d28f8ad95679bd2d0`).
  This file adds T1 and nothing else.

## 1. What the review found

### 1.1 The verdict
The GLM review of round 2 (`t_dd0ae66d`) returned **CHANGES_REQUIRED** on one
major finding: **C2's help sentence is computed but rendered nowhere.**
`HINT_LIGHT_ON` (`behavior-form.js` L34) is appended to the form's hint for
`select-light`, and tested, but `app.js` (~L2907) passes no hint element to
`createBehaviorForm`, the element defaults to `null`, the form's `text(null,
…)` is a no-op, and `index.html`'s Behaviour section has no such element.

Everything else was clean, and this time independently so: **all 29 proofs**
(round 1's 26 and round 2's (r1)–(r3)) reproduced by the reviewer's own
breaks; every test in the spec's §5 and round 2's §3 tables located; R2's
attribution compliant with CC BY 4.0; round 1's deviations checked against
round 2's §1.3 and the OPERATOR NOTE.

### 1.2 The cause, and why the fix is wider than one sentence
The spec's F9 lists the Behaviour section's elements (`#ep-behavior-row`,
`-params`, `-actions`, `-status`, `-log`) **and names no element for help
text**, while F4, F8, F9 and C2 all say "the form's help says …". Round 2's
R1 then said "same element (`elements.hintText`), same rendering path",
assuming one existed. That gap is the spec's, not the implementer's.

So **every** help line the form computes may be as invisible as C2's. T1
fixes the class: one help element, wired, and a guard that every
user-facing string the spec names reaches an element that exists.

### 1.3 Two small facts recorded
- **R1 changed code, not only tests,** and was right to: its 0.005 case
  showed round 1's `lightIntensity` returning 1 below the 0.01 floor. R1's
  rule ("the code isn't changed unless a test shows it wrong") authorised
  it.
- **The `apps/client` count:** round 1's review reported 1042; round 2's
  implementer measured 1044 at `b246093f` and 1049 at `2d5e3487`. Round 3's
  review reconciles it by counting at `b246093f` itself.

## 2. The contract (round 3)

### T1. Every user-facing string of the Behaviour section is rendered
In `apps/client/index.html`, `apps/client/src/app.js` and
`apps/client/src/behavior-form.js`:
- **One help element,** `#ep-behavior-hint`, inside the Behaviour section,
  under `#ep-behavior-params` and above `#ep-behavior-actions`. A plain text
  block, styled as the panel's other hint lines; hidden when empty.
- **`app.js` passes it** to `createBehaviorForm` as the form's hint element
  (whatever key the form already reads, so the form's code and tests don't
  change shape).
- **The form writes into it** the help for the chosen template. Its
  content, at least:
  - for every template: the D4 sentence (spec F9) **if it isn't already
    rendered in `#ep-behavior-status`'s line** — not twice;
  - `select-visibility` and `select-light`: "One click per change." (spec
    F8, N7);
  - `select-animation`, `proximity-animation`, `interval-animation`: that a
    clip's end doesn't trigger anything (spec F4: `done` never fires in
    4b-2), in one short sentence;
  - `select-light`: C2's sentence, exactly
    `If the light was off when you saved, 'on' uses intensity 1.`
  - nothing for "None".
- **The inventory, as a guard.** A test in `apps/client/tests/` lists every
  user-facing string the spec, C2 and the two revisions name for the
  Behaviour section and the host line:
  - the five template display names;
  - the status texts ("Running", "Disabled: …", "Not running: this tab isn't
    the script host", "Behaviours run in another tab; clicks here don't
    trigger them", "Saving…", "Save cancelled");
  - "Custom graph", "This world has no lights";
  - the D4 sentence, the help lines above;
  - "Script host: this tab (behaviours run here)".

  For each, it asserts that the form or `app.js` writes it into an element
  whose id is in `index.html` **and** is passed by `app.js` to the code that
  writes it. A string with no rendered home fails the guard by name.
- **Nothing else changes:** the form's logic, R1's intensity rule, the
  strings themselves (except adding the two help lines if they don't
  exist yet; if one exists with different wording, keep it and say so).

### What doesn't change
Everything else in F1–F12, C1–C3, the OPERATOR NOTE and round 2's R1–R2.

## 3. Tests and proofs (round 3)

| Item | New tests |
|---|---|
| T1 | `index.html` guard: `#ep-behavior-hint` exists inside the Behaviour section, between params and actions. `app.js` guard: it's passed to `createBehaviorForm`. `behavior-form` (no DOM): for each template the hint element receives that template's lines, C2's only for `select-light`; "None" clears it. The inventory guard above |

**Proofs** ("not reproducible" is not an acceptable result):
- **(t1)** `app.js` stops passing the hint element (the `app.js` guard and
  the inventory guard fail, each by name);
- **(t2)** `#ep-behavior-hint` removed from `index.html` (the `index.html`
  guard and the inventory guard fail);
- **(t3)** one template's help line dropped from the form (its
  per-template test fails).

**And the whole round still passes:**
- full suites, with round 1's rules (server files one at a time under
  `timeout 180`, `packages/client` without `--test-force-exit`, every
  other package on its own directory, `importmap-guard` green, the one
  named conformance skip and no other);
- **the earlier proofs on the files round 3 touches,** re-run against the
  round-3 tip: **(h), (h2)** and **(r2)** (`behavior-form.js`), **(e4)**
  (`app.js`'s viewport click).

**Steps, one commit each:**
1. T1 and its tests;
2. suites, proofs and the handoff.

**Before DEV acceptance,** after round 3's release chain publishes and
deploys: the operator's **outside code review of the published SHA** over
the whole round (base `951b541b` to the round-3 tip), and **Claude's §5.1
browser checks** (1–9 and 8b) in the harness, which now include **reading
the hint line for each template on screen.** The operator then runs the
spec's §6 DEV acceptance.

## 4. Kickoff body for round 3 (post it verbatim as the revision kickoff card's text)

---

### KICKOFF — scripting-4b-2 revision round 3. Slug: `scripting-4b-2`

You are the kickoff orchestrator for round 3 of `scripting-4b-2`. Build the
graph below, read it back, report, and stop. Do not implement, review or
deploy anything yourself.
- **Your tools:** only `kanban_*`.
- **Blocking:** never call `kanban_block` without an explicit `task_id`, and
  never block this card.
- **Titles:** use them exactly as written. Don't add words to them.

**The contract is in git; you don't read it.** It is
`devtasks/REVISION-scripting-4b-2-r3.md` on `main`, together with
`devtasks/PREBRIEF-scripting-4b-2.md` at `951b541bef818499a16692ac968f1800fdb75434`
(sha256 `a7841421312f5ae59b74d8623067986557b4a241f048c30adbb556bc44190a73`),
`devtasks/REVISION-scripting-4b-2.md` at `45fcc433015c54355fcec31a8917f6c548af9434`
(sha256 `4ef9aaad2237b61a5f8f9cf23ffcb6604f4e3765284e5e1d28f8ad95679bd2d0`)
and the two operator texts on `t_6c3817b2` (the OPERATOR CORRECTION and the
OPERATOR NOTE).
- **The front door has already checked the round-3 revision** and posted
  its commit and sha256 on this card. **You have only `kanban_*` tools: do
  not try to fetch or hash anything, and do not block for lack of a shell.**
- Copy that commit and sha256 into cards 1 and 2. **They** have terminal,
  file and git tools. Each reads the revision with
  `git -C /workspace/atrium fetch origin main && git -C /workspace/atrium show <commit>:devtasks/REVISION-scripting-4b-2-r3.md > /tmp/revision-r3.md && sha256sum /tmp/revision-r3.md`,
  and blocks with `kind="capability"` on a mismatch.

#### Graph
1. **`Implement r3 — scripting-4b-2`.** Assignee `atrium-deepseek`, parent:
   this kickoff, `--max-runtime 2h` (7200 s).
   - **Body:**
     - the revision reference and hash check;
     - continue `workflow/scripting-4b-2` from
       `2d5e34874775a68850049f47118b1b976da52b8a` in the existing worktree
       `/workspace/wt/scripting-4b-2` (`git -C /workspace/wt/scripting-4b-2
       status` must be clean at that SHA, or block `needs_input`);
     - the revision's §2 contract and §3 steps, tests and proofs;
     - the spec, the OPERATOR CORRECTION and OPERATOR NOTE on
       `t_6c3817b2`, and round 2's revision, still binding;
     - the WORKER-CARD REQUIREMENTS comment (855 on `t_2d41531f`).
   - **The handoff** carries proofs (t1)–(t3), **and** (h), (h2), (r2) and
     (e4) re-run, with per-file counts and exit codes and the one named
     skip; and, for the inventory, each string with the element id it
     lands in.
2. **`GLM review r3 — scripting-4b-2`.** Assignee `atrium-glm`, parent:
   card 1.
   - Its body opens with
     `THIS RUN HAS TERMINAL, FILE AND GIT TOOLS. Use them for every step below.`
   - **The review covers round 3's change** (`2d5e3487` to the round-3 tip)
     against this revision. Round 2's review reproduced all 29 earlier
     proofs at `2d5e3487`; this one reproduces **(t1)–(t3)** and the four
     re-run proofs, (h), (h2), (r2) and (e4), itself.
   - **It checks the inventory against the spec,** not only against the
     test: every user-facing string the spec, C2 and the revisions name for
     the Behaviour section has a rendered home. A string with none is a
     finding.
   - It reconciles the `apps/client` count (1042 vs 1044 at `b246093f`) by
     counting at `b246093f` itself.
   - **Progress comments on its own card** after each stage, so a run that
     stops on its iteration budget resumes from its last comment.
3. **`Review gate r3 — scripting-4b-2`.** Assignee `atrium-orchestrator`,
   parent: card 2. It creates nothing.
   - **On a valid APPROVE of the exact 40-character SHA,** it blocks with
     `APPROVE <SHA40>: front door, build the release chain`.
   - **Otherwise,** it blocks for the operator with the verdict quoted.
4. **Before you complete,** link card 3 to **round 3's sentinel** as a
   parent. The front door creates it and posts its id on this card. Round
   1's `t_6ad02da5` and round 2's `t_31a95fba` must not be used. Do not
   create a sentinel yourself.
5. **The release chain** is the front door's: the same four cards as
   scripting-4b-1's (Publish, DEV deploy, DEV finalizer, acceptance gate),
   with the new SHA, built whole at card 3's APPROVE. The DEV deploy
   restarts DEV. Nothing reaches MAIN or PROD.

#### Report back
- the three ids;
- the implementation's parent and its 7200 s cap;
- the hash line copied into cards 1 and 2;
- the review's opening line;
- the gate linked to round 3's sentinel.

Then complete this card.

---
