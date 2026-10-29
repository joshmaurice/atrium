# Revision — scripting-4b-2 round 7 (what DEV acceptance of round 6 found)

**Status:** approved by the operator (2026-10-28 23:52 PT), **Rev 0** as
drafted. Six items, all in the Behaviour form and the Edit panel: X1–X6, plus
X7 (what doesn't change).
- **Base:** round 6's published tip `45241157d451f35664261d967218df75b3a08f6d`
  on `workflow/scripting-4b-2`:
  - GLM APPROVE on `t_a25224fc`;
  - published by `t_e50f0254`;
  - on DEV by `t_d888e8ca`, recorded and healthy;
  - finalizer `t_1937aca7` done.

  Round 7 commits on top of it, on the same branch, in the existing worktree
  `/workspace/wt/scripting-4b-2`. Round 6 already contains `main`'s hotfix, so
  there is no merge step this round.
- **Round 6 is not accepted.** Its acceptance gate `t_89fe6413` stays blocked
  as it is, superseded by round 7's chain, and round 6's sentinel `t_f59ac6b2`
  is not reused. **No one completes `t_89fe6413`.** Round 7's DEV deploy
  replaces round 6's on DEV, as round 6's replaced round 5's. Nothing reaches
  MAIN or PROD.
- **The contract still governs:**
  - `devtasks/PREBRIEF-scripting-4b-2.md`, FINAL Rev 2.1, at
    `951b541bef818499a16692ac968f1800fdb75434` (sha256
    `a7841421312f5ae59b74d8623067986557b4a241f048c30adbb556bc44190a73`);
  - the OPERATOR CORRECTION and OPERATOR NOTE on `t_6c3817b2`;
  - the revisions of rounds 2 (`45fcc433`, sha256 `4ef9aaad2237b61a5f8f9cf23ffcb6604f4e3765284e5e1d28f8ad95679bd2d0`),
    3 (`f47cc3f7`, sha256 `4e49b1d45cc33185c7955f8b881a66b5b46c3e101ff0bbd53864cf64ade0e93f`),
    4 (`32c14a4f`, sha256 `aa28260f1454974ca97a745d846c93868911d1a9d7c2f5e0a01db046e8533ee6`),
    5 (`afabd79d`, sha256 `94a80bf42ce12630092769fc0dae6983b9ee2865532dd7e218845139c687a626`)
    and 6 (`68f01af0`, sha256 `e18d0ebe715004fe60a8d1e9a5c94ef8cdc1bbc880639d5f4c910eec5a843831`);
  - the message-depth-guard hotfix as merged by round 6's W0
    (`devtasks/PREBRIEF-message-depth-guard.md` at `380a2db7`, sha256
    `a079fe03fd016aafecb0b13e21d7c4d86f32ee5bd3fab9e99fa4ecc6184416c4`).

  This file adds X1–X7 and changes nothing else.

## 1. What DEV acceptance found

The operator ran the spec's §6 DEV acceptance on round 6 (`45241157`), steps
1, 2, 3, 5 and 7. Steps 4 and 6 aren't run yet, and step 5's drag wording
wasn't clear; §3 "Before DEV acceptance" covers both. Claude reproduced each
finding in the harness on the same tip.

### 1.1 What passed
- **Step 1** passed.
- **Steps 5 and 7** raised nothing beyond the wording question.
- **Round 6's own items hold on its tip** (Claude's harness checks before
  DEV acceptance):
  - Visible redraws in the owner's tab;
  - the section reopens after Edit off → Edit on;
  - the form follows the stored value;
  - the Disabled texts.

### 1.2 What's broken
1. **The parameter fields run together, so the target list reads as the clip
   list.**
   - `renderParams` makes each row an inline `<label>` whose text is the raw
     key (`target `, `clip `, …), with the control after it.
   - In the 250 px panel, the rows wrap into one another. The operator read
     the target `<select>` (every model in the world) as the clip list, and
     chose a "clip" from it.
   - The labels are also the raw keys, not words.
2. **A model with no animations gets an empty text box, and Save sends an
   empty clip.**
   - For a loaded model with no clips (a library model: `status` is
     `no-clips`, `clips: []`), `clipIdsFor` returns `[]`. The form then
     falls back to the text box it uses for a model whose clips aren't known.
   - The clip is `''` and Save is enabled. Save sends it, and the server's
     F1 check refuses it with **"animations is malformed"**: F1 requires
     `isClip`, 1–300 characters. Nothing else happens.
   - Harness, `dev2`: "Every N seconds: play" on Tiny Cube. The clip is a
     text box with value `''`, Save is enabled, the status after Save is
     "animations is malformed", and no leaf is written.
3. **The form sends values it hasn't checked, and the refusal is in F1's
   words.**
   - The client has F1's check (`behaviorCheck`; `edit-duplicate.js`
     already uses it), but Save doesn't run it.
   - Every stage is sent, including `setObjectId` on the target, and the
     server's code-level message is what the owner reads.
   - "animations is malformed" doesn't tell the owner that a clip is
     missing.
4. **The fields can show one value while the form holds another.**
   - A `<select>` whose held value isn't among its options shows its
     first option, and the form never notices.
   - The operator saw the target "change on its own" (to ToyCar) and the
     clip "change on its own" (to Survey). Both were the display, not the
     held value.
   - Harness, `noid`, in a world whose models have no `objectId`: the owner
     picks Fox (held `name:Fox`, clip `''`) and clicks Save.
     - Stage 2 gives Fox an id, and stage 3 is refused "animations is
       malformed".
     - Afterwards the target shows **CesiumMan** and the clip shows
       **Survey**. The form holds `name:Fox` and `''`.
     - A second Save would send neither of the values on screen.
5. **The Edit panel can't scroll.**
   - `#edit-panel` (`index.html` L399–410) is `position: absolute` with no
     `max-height` and no `overflow`.
   - With the Behaviour section open, the panel runs past the bottom of the
     window, and its last controls can't be reached. This is the operator's
     request.
6. **Models without an `objectId` (worlds saved before ids existed):**
   - **No clip list.** `clipIdsFor` looks clips up by the target's
     `objectId` only. For an id-less model the list is empty, so the clip is
     a text box even though the model's clips are loaded (Fox: Survey, Walk,
     Run).
   - **The target slips after Save.** Stage 2 gives the target its id, but
     `state.targetId` stays `name:Fox`. The rebuilt picker's options carry
     the new id, so none of them matches, and §1.2 item 4 follows.

### 1.3 Not in this round
- **The visitor didn't see the proximity animation until a reload** (step 3,
  reported once). Claude's harness runs didn't reproduce it:
  - a visitor, then a second owner, walking in and out, on a new world;
  - the same on a world whose models have no ids;
  - every tab sampled for the leaf, the animation state and the clip time.

  In every run, every tab played and stopped together. It stays open, and the
  operator has a console snippet to capture the state if it recurs. Possible
  causes: a background tab, or a tab loaded before the DEV deploy.
- **The proximity target's wording** (a hint that names both objects, or the
  label "Animate"): a follow-up after 4b-2, at the operator's choice.

## 2. The contract (round 7)

All of X1–X6 is in `apps/client/src/behavior-form.js`, `apps/client/src/behavior-clips.js`,
`apps/client/src/app.js` (wiring only) and `apps/client/index.html` (CSS
only), with their tests. **No server, runner, adapter, protocol or
`@atrium/behaviors` change.**

### X1. One field per row, each with its label
- Each parameter is its own row. The row is a `div.ep-row`, the same row the
  panel's other fields use (`display: flex`, a 58 px `span` label, then the
  control). No `<label>` wraps the control.
- **The labels are words:**

  | Key | Label |
  |---|---|
  | `target` | `Target` |
  | `clip` | `Clip` |
  | `action` | `Action` |
  | `loop` | `Loop` |
  | `radius` | `Radius (m)` |
  | `seconds` | `Every (s)` |

- Each control's `aria-label` is its label. `data-field` is unchanged
  (V1's rule: written as a property of `dataset`).
- The field order is unchanged (`TEMPLATE_FIELDS`).

### X2. A model with no animations says so
- **When the target's clip status is loaded with no clips,** the Clip row
  shows the text **"This model has no animations"** in place of a control.
  - The held clip is `''`.
  - Save is disabled, and the status line shows the same text.
- **When the clips aren't known yet** (loading, or no record yet), the Clip
  row keeps its text box. The text box has the placeholder `clip name`. An
  empty text box is a field problem (X3), so Save is disabled until a name
  is typed.
- **When the target's clip status changes** (loading → loaded, or a
  different clip list), the open form renders again.
  - `app.js` keeps the last status it passed to the form for the form's
    target, and calls `behaviorForm.render()` from `modelAnimations`'
    `onChange` only when that status or that list differs.
  - A clip starting or stopping alone doesn't re-render the form, so typing
    in a field isn't interrupted.

### X3. The form checks before it sends, in plain words
- **A field check runs on every render** and gives the first problem, in this
  order, with these texts:

  | Problem | Text |
  |---|---|
  | `select-light` with no light to offer | `This world has no lights` (F8's text, unchanged) |
  | no target held | `Choose a target` |
  | loaded model with no clips | `This model has no animations` |
  | clip select with nothing held | `Choose a clip` |
  | clip text box empty | `Type a clip name` |
  | `radius` not a number from 0.5 to 50 | `Radius must be from 0.5 to 50 m` |
  | `seconds` not a number from 1 to 3600 | `The interval must be from 1 to 3600 seconds` |

  The bounds are `BEHAVIOR_PROX_MIN/MAX` and `BEHAVIOR_INTERVAL_MIN/MAX`,
  imported, never retyped.
- **While there is a problem,** Save is disabled and the status line shows its
  text. The text takes precedence over the runner's status, but not over a
  Save's own error or "Saving…".
- **Save checks again before its first stage:**
  1. It runs the field check.
  2. It builds the value exactly as stage 3 will. For any id the sequence
     hasn't given yet, it uses a stand-in in `OBJECT_ID_RE`'s form.
  3. It runs `behaviorCheck(value, { ownId })` on that value.

  On any refusal, **nothing is sent: no `setObjectId` and no leaf.** The
  status line shows the field text, or for a whole-value refusal
  `Can't save: <behaviorReasonText(code)>`.
- **A refusal from the server** (a stage answered `edit:rejected`) still shows
  its message, as today. X3 only makes it rarer.

### X4. Every field shows exactly what the form will send
- **The invariant, after every render:**
  - each `<select>`'s selected option's value equals the held value
    (`state.targetId` for Target, `state.params[key]` otherwise);
  - each text box's `value` equals the held string;
  - Loop's `checked` equals the held boolean;
  - each number box shows the held number, or is empty when the held value
    isn't a number.
- **A held value that isn't among the options:**
  - the held value becomes `''`;
  - the `<select>` gets a first option `Choose a target…` (or
    `Choose a clip…`) with value `''`, and that option is selected;
  - X3's check then disables Save and says why.

  This covers a removed target, a stored clip that isn't on the loaded
  model, and an empty picker. **It also covers the state after a refused
  Save:** the fields go on showing what the form holds.
- **A normalisation isn't an edit.** When the held values change only
  because of X4 or X6 (no owner input), and there was no unsaved edit
  before, W3's baseline follows the change. So "Changed in another tab" and
  W3's re-read rules behave as in round 6.

### X5. The Edit panel scrolls
- `#edit-panel` gets three rules:
  - `max-height: calc(100% - 20px)` (its containing block is `#viewport`,
    which is `position: relative`; 10 px top and bottom);
  - `overflow-y: auto`;
  - `overscroll-behavior: contain`.
- **A wheel over the panel scrolls the panel and doesn't move the camera.**
  The viewport's wheel listener already returns for any target but the
  canvas (`app.js` L2893), and that stays as it is.
- Nothing inside the panel changes size or order.

### X6. Models without an `objectId`
- **Clips are looked up by node.**
  - `behavior-clips.js` gains `clipsForNode(node, { modelAnimations })`,
    which returns the same shape as `clipsFor`.
  - `clipsFor(objectId, …)` resolves the id to its node and calls it.
    There is one source, so V5's "the picker and the check can never
    disagree" still holds.
  - The form's dep becomes `deps.clipStatus(node)` → `{ status, clipIds }`.
    It replaces `deps.clipIds(objectId)`, and X2 uses its `status`.
  - The adapter's clip check keeps calling `clipsFor` by id.
- **The target keeps its place when Save gives it an id:**
  - When stage 1 (target = the behaviour node) or stage 2 is accepted,
    `state.targetId` and `state.params.target` become the id that stage
    gave.
  - **On every render, a held `name:<name>` whose node now has an
    `objectId`** becomes that id, so the picker's option and the held value
    stay the same string.
  - After a refused stage 3, the target is shown by its new id: the ids
    from stages 1 and 2 stay, which is harmless (M4).

### X7. What doesn't change
Everything in F1–F12, C1–C3, the OPERATOR NOTE, rounds 2–6's revisions, and
the hotfix as merged.
- **The Save sequence's stages and checks (M4, V10, V11) are unchanged**
  apart from X3's check before stage 1 and X6's id switch.
- No server file, runner, adapter, protocol schema or `@atrium/behaviors`
  file changes.
- The templates' graphs are unchanged.

## 3. Tests and proofs (round 7)

**The strict fake** (round 6's W8) drives every test below through the real
elements and listeners. **One helper, `shownEqualsHeld(form, elements)`,**
asserts X4's invariant. It runs after every render in every new test, and
in round 6's form tests too.

| Item | New tests |
|---|---|
| X1 | For each template, the params container's children are `div.ep-row`s, one per field, in `TEMPLATE_FIELDS` order (no `intensity`). Each row's label `span` has X1's text, and its control has `aria-label` equal to it and the right `data-field`. No `<label>` wraps a control |
| X2 | A target whose `clipStatus` is loaded with `[]`: the Clip row has the text and no control, the held clip is `''`, Save is disabled, and the status line says "This model has no animations". Loading: a text box with the `clip name` placeholder, and Save disabled until text is typed. A status change from loading to `['A','B']` re-renders a `<select>` with A selected. A play or stop alone doesn't re-render (app.js's filter, with a fake `modelAnimations`) |
| X3 | Each row of X3's table gives its exact text and a disabled Save. With a problem forced past the disabled button (calling `save()` directly), there are **zero** `setObjectId` and `sendField` calls, and the status line shows the text. A value that passes the fields but fails `behaviorCheck` (a stubbed template output) gives `Can't save: …` and zero sends. A valid value still saves in its usual stages |
| X4 | `shownEqualsHeld` holds after: open on a stored value; a template change; each parameter change; a removed target (the placeholder is shown, held `''`, Save disabled); a stored clip that isn't on the loaded model; **`noid`'s sequence**: an id-less Fox picked, stages 1 and 2 accepted, stage 3 rejected. After that, the target shows Fox by its new id, the clip shows what is held, and the next Save sends exactly what is shown. A normalisation alone sets no "Changed in another tab" |
| X5 | `index.html`'s `#edit-panel` rule has X5's three declarations (a static check on the file). With a fake canvas and panel element, a wheel event whose target is in the panel doesn't call `nav.onWheel` (the existing listener, now under test) |
| X6 | `clipsForNode` for an id-less model node returns its loaded clips. `clipsFor(id)` gives the same result as `clipsForNode` of its node. An id-less Fox as target shows a clip `<select>` with Survey, Walk and Run. When stage 2 is accepted, `state.targetId` is the new id and the picker's selected option is Fox. When stage 1 is accepted with target = self, likewise. A held `name:X` whose node gains an id from elsewhere (another tab's `setObjectId`) becomes that id on the next render |

**Proofs** ("not reproducible" is not an acceptable result):
- **(x1)** the rows back to the inline `<label>` with the key as its text:
  X1's test fails;
- **(x2)** the no-clips branch removed (back to the text box): X2's test fails;
- **(x3)** Save's pre-stage check removed, with the button forced: X3's
  zero-sends test fails;
- **(x4)** the placeholder removed: `shownEqualsHeld` fails on the
  removed-target case;
- **(x5)** the three CSS declarations removed: X5's static check fails;
- **(x6)** the clip lookup back to id-only: X6's id-less clip test fails;
  **(x6b)** the id switch after stage 2 removed: X4's `noid` sequence fails.

**And the whole round still passes:**
- full suites with round 1's rules:
  - server files one at a time under `timeout 180`;
  - `packages/client` without `--test-force-exit`;
  - every other package on its own directory;
  - `importmap-guard` and the workspace-rules guard green;
  - the one named conformance skip and no other;
- **`r1`** unchanged;
- round 6's proofs (w2)–(w4) and (w8), and round 5's form proofs, re-run
  and quoted (they live in `behavior-form.js` and `app.js`, which this
  round touches).

**Steps, one commit each:**
1. X1, X2 and X4: `behavior-form.js` and the `shownEqualsHeld` helper;
2. X3: the field check and Save's pre-stage check;
3. X6: `behavior-clips.js`, the form's `clipStatus` dep, the id switch, and
   `app.js`'s wiring with X2's re-render filter;
4. X5: `index.html`'s CSS and the wheel test;
5. suites, proofs and the handoff.

**Before DEV acceptance,** after round 7's release chain publishes and
deploys:
- **Claude's harness checks on the published tip:**
  - `dev2` (the no-clips model): the text, a disabled Save, nothing sent;
  - `noid` (id-less models): the clip list is found, the target stays on Fox
    through Save, and the leaf is written;
  - the panel's last control reached by scrolling in an 800 × 600 window,
    and a wheel over the panel leaving the camera where it was;
  - `f1`–`f3` (round 6's form checks);
  - the 28 regression scripts;
- **after the DEV deploy,** `atrium-release-status`: DEV actual = recorded =
  `RELEASE_SHA`, healthy;
- **Claude writes the acceptance steps out in plain words** for the
  operator: all of §6, with steps 4–6 spelled out (what to drag, which tab to
  close for the handover, what each tab should show).

The operator then runs the spec's §6 DEV acceptance.

## 4. Kickoff body for round 7 (post it verbatim as the revision kickoff card's text)

---

### KICKOFF — scripting-4b-2 revision round 7. Slug: `scripting-4b-2`

You are the kickoff orchestrator for round 7 of `scripting-4b-2`. Build the
graph below, read it back, report, and stop. Do not implement, review or
deploy anything yourself.
- **Your tools:** only `kanban_*`.
- **Blocking:** never call `kanban_block` without an explicit `task_id`, and
  never block this card.
- **Titles:** use them exactly as written. Don't add words to them.

**The contract is in git; you don't read it.** It is
`devtasks/REVISION-scripting-4b-2-r7.md` on `main`, together with:
- `devtasks/PREBRIEF-scripting-4b-2.md` at `951b541bef818499a16692ac968f1800fdb75434`
  (sha256 `a7841421312f5ae59b74d8623067986557b4a241f048c30adbb556bc44190a73`);
- `devtasks/REVISION-scripting-4b-2.md` at `45fcc433015c54355fcec31a8917f6c548af9434`
  (sha256 `4ef9aaad2237b61a5f8f9cf23ffcb6604f4e3765284e5e1d28f8ad95679bd2d0`);
- `devtasks/REVISION-scripting-4b-2-r3.md` at `f47cc3f7198a33309a59eee845167b61ae3ac173`
  (sha256 `4e49b1d45cc33185c7955f8b881a66b5b46c3e101ff0bbd53864cf64ade0e93f`);
- `devtasks/REVISION-scripting-4b-2-r4.md` at `32c14a4f85e4127c1204fca5562edb319a67df9b`
  (sha256 `aa28260f1454974ca97a745d846c93868911d1a9d7c2f5e0a01db046e8533ee6`);
- `devtasks/REVISION-scripting-4b-2-r5.md` at `afabd79da8a4a76efd5bb7ccf4f80356e1178e40`
  (sha256 `94a80bf42ce12630092769fc0dae6983b9ee2865532dd7e218845139c687a626`);
- `devtasks/REVISION-scripting-4b-2-r6.md` at `68f01af097f52fc88e081a675ab6ba53f9ecd909`
  (sha256 `e18d0ebe715004fe60a8d1e9a5c94ef8cdc1bbc880639d5f4c910eec5a843831`);
- the two operator texts on `t_6c3817b2` (the OPERATOR CORRECTION and the
  OPERATOR NOTE).

**The front door has already checked the round-7 revision** and posted its
commit and sha256 on this card. **You have only `kanban_*` tools: do not try
to fetch or hash anything, and do not block for lack of a shell.**

Copy that commit and sha256 into cards 1 and 2. **They** have terminal, file
and git tools. Each reads the revision with
`git -C /workspace/atrium fetch origin main && git -C /workspace/atrium show <commit>:devtasks/REVISION-scripting-4b-2-r7.md > /tmp/revision-r7.md && sha256sum /tmp/revision-r7.md`,
and blocks with `kind="capability"` on a mismatch.

#### Graph
1. **`Implement r7 — scripting-4b-2`.** Assignee `atrium-deepseek`, parent:
   this kickoff, `--max-runtime 2h` (7200 s).
   - **Body:**
     - the revision reference and hash check;
     - continue `workflow/scripting-4b-2` from
       `45241157d451f35664261d967218df75b3a08f6d` in the existing worktree
       `/workspace/wt/scripting-4b-2`. `git -C /workspace/wt/scripting-4b-2
       status` must be clean at that SHA, or block `needs_input`;
     - **there is no merge step this round;**
     - the revision's §2 contract and §3 steps, tests and proofs;
     - **the round touches only `apps/client`:** `behavior-form.js`,
       `behavior-clips.js`, `app.js` (wiring) and `index.html` (CSS), and
       their tests;
     - the spec, the two operator texts on `t_6c3817b2`, and rounds 2–6's
       revisions, still binding;
     - the WORKER-CARD REQUIREMENTS comment (855 on `t_2d41531f`);
     - a progress comment on its own card after each step's commit.
   - **The handoff** carries:
     - proofs (x1)–(x6b);
     - `r1`'s output and the re-run round-5 and round-6 proofs;
     - per-file counts with exit codes, and the one named skip;
     - `git diff --stat 45241157 <tip>`, showing only `apps/client` files.
2. **`GLM review r7 — scripting-4b-2`.** Assignee `atrium-glm`, parent:
   card 1.
   - Its body opens with
     `THIS RUN HAS TERMINAL, FILE AND GIT TOOLS. Use them for every step below.`
   - **The review covers round 7's change** (`45241157` to the round-7 tip)
     against this revision. It reproduces **every proof** itself.
   - **It checks X4's invariant** by reading every path that changes a held
     value: open, the template change, a parameter change, each Save stage's
     answer, a re-read, and a clip-status change. For each, it names where
     `shownEqualsHeld` is asserted in a test.
   - **It checks X3's pre-stage check:** no `setObjectId` or `sendField` can
     run before it, and the stand-in ids never reach a send.
   - **It confirms the Save sequence is otherwise unchanged** (M4, V10,
     V11), and that `clipsFor` and `clipsForNode` share one source.
   - **It confirms the diff touches only `apps/client`.**
   - **Progress comments on its own card** after each stage.
3. **`Review gate r7 — scripting-4b-2`.** Assignee `atrium-orchestrator`,
   parent: card 2. It creates nothing.
   - **On a valid APPROVE of the exact 40-character SHA,** it blocks with
     `APPROVE <SHA40>: front door, build the release chain`.
   - **Otherwise,** it blocks for the operator with the verdict quoted.
4. **Before you complete,** link card 3 to **round 7's sentinel** as a
   parent. The front door creates it and posts its id on this card. Do not
   create a sentinel yourself, and do not use the sentinels of rounds 1–6:
   `t_6ad02da5`, `t_31a95fba`, `t_b9c2a9bc`, `t_e7ef64b2`, `t_e7333c23` and
   `t_f59ac6b2`.
5. **The release chain** is the front door's: the same four cards as
   scripting-4b-1's (Publish, DEV deploy, DEV finalizer, acceptance gate),
   with the new SHA, built whole at card 3's APPROVE.
   - **Round 6's chain cards (`t_e50f0254`, `t_d888e8ca`, `t_1937aca7`,
     `t_89fe6413`) are not reused,** and no one completes `t_89fe6413`.
   - The DEV deploy replaces round 6's release on DEV. Nothing reaches MAIN
     or PROD.

#### Report back
- the three ids;
- the implementation's parent and its 7200 s cap;
- the hash line copied into cards 1 and 2;
- the review's opening line;
- the gate linked to round 7's sentinel.

Then complete this card.

---
