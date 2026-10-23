# Revision — edit-polish-3 round 2 (after the outside code review of `a3ec6537`)

**Status:** DRAFT, Rev 0 (2026-10-23), for the operator's approval.
- **Base:** the reviewed round-1 tip `a3ec65371e3b4bcaac6a4e2b7b96722e20341a1d`
  on `workflow/edit-polish-3`. Round 2 commits on top of it, on the same
  branch, in the existing worktree `/workspace/wt/edit-polish-3`.
- **DEV runs its release merge, `b143003b`.** That is **not accepted**: the
  acceptance gate `t_058cea77` stays blocked and is superseded by round 2's.
- **The spec still governs:** `devtasks/PREBRIEF-edit-polish-3.md`, FINAL Rev
  1.1, at `dcd5fa6e4625bf9d483fe8ce3e7cc3c79bfb38bd` (sha256 `031b140d…1dec`).
  This file adds V1–V5 and nothing else.

## 1. What the review found
**The verdict:** "Conditional GO". The form lifecycle (owned versus
not-owned answers, undo kept, Edit off) was judged correct. Three should-fix
findings and two nits remain. Claude checked each one: finding 2 was
reproduced in the browser, and the others were confirmed by reading
`a3ec6537`.

| # | Finding | Where | Claude's check |
|---|---|---|---|
| V1 | **A late world list erases the chosen destination.** Open Teleporter on a slow connection and pick "The commons" while the list loads. When the list arrives, `fillTeleporterWorlds` rebuilds the select, its value returns to the placeholder, and Save stays enabled. Save then says "Select a world or enter a destination". | `teleporter-form.js` `fillIfCurrent` (L111); `app.js` `fillTeleporterWorlds` | **Reproduced** in the browser harness (a 2 s delay): before the list, value `/` with Save on; after it, value `''` with Save on; Save gives the error |
| V2 | **`reset()` doesn't clear a focused URL box.** `render()` writes the box only when it isn't focused, so a reset during typing (a world reset, a reconnect) empties the state and leaves the text. | `model-form.js` `render` (L178), `reset` (L397) | Confirmed by reading; the tests cover reset unfocused and render focused, but not reset focused |
| V3 | **Z6's scanner still misses capturing listeners and hidden comments.** `captureFlag` reads only an unquoted `capture:`. It reports `false` for `{ 'capture': true }`, `{ "capture": true }`, `{ capture: false, capture: true }` and `{ capture: false, ...{ capture: true } }`. And `skipLiteral` copies a template's `${ … }` as text, so a comment inside an interpolation survives stripping. | `tests/edit-key-wiring.test.js` L65–75, L248–259 | Confirmed by reading; the reviewer reproduced both with the test's own functions |
| V4 | *Nit:* an empty `?` or `#` (`…jpg?`, `…jpg#`) still names a catalog sky, because `new URL` gives empty `search` and `hash`. | `sky-picker.js` `storedPath` (L76) | Confirmed by reading |
| V5 | *Nit:* an owned **unknown** answer for the Model form shows two errors: the form's own "did not answer" and `onStructureAnswer`'s generic one. That breaks Z2's "an owned answer is handled completely by its form". It's older behaviour, kept by round 1. | `app.js` `request.model` branch (L2362–2373) | Confirmed by reading |

**Not taken (recorded):** one integrated test running `onStructureAnswer`,
the form, the undo engine and the selection together. `app.js` can't be
imported in the test runner. Browser check 8 covers that scenario end to end
(Save, close, Edit on, select another node, late acceptance, Undo), and it
passed on `a3ec6537`.

## 2. The contract (round 2)

### V1. A late world list keeps the user's choice
- **`fillIfCurrent` reads the select's current value** before filling, and
  passes it on: `deps.fillWorlds(options, { selected: previous })`.
- **The adapter (`fillTeleporterWorlds`) re-selects that value** if it's
  among the options it just wrote, including "The commons" (`/`).
  Otherwise the select is on the placeholder.
- **The module then re-derives Save** from what is actually chosen:
  enabled exactly when `elements.worldSelect.value` is non-empty or the
  destination input is non-blank. Then it renders.
- **A loading or manual-only fill** (the opening's own synchronous fill)
  is unchanged.

### V2. `reset()` always clears the URL box
`reset()` sets `elements.url.value = ''` itself, whether or not the box has
focus, then clears the state and closes as today. `render()` keeps its
focus exception for ordinary renders.

### V3. The scanner reads options and interpolations exactly
In `tests/edit-key-wiring.test.js` (test code only):
- **The options argument:** an object literal is readable only if every
  entry is `key: value`.
  - Keys may be an identifier, or a single- or double-quoted string.
  - Values may be `true`, `false`, a number, a string, `null` or
    `undefined`.
  - **Anything else is "unknown options":** a spread (`...`), a computed key
    (`[k]`), a shorthand property, a method, or any other value.
- **Capture** is the value of the **last** `capture` entry, quoted or not,
  as in JavaScript. It counts as on unless that value is `false`, `0`, `''`,
  `null` or `undefined`.
- **Template literals:** inside a backtick string, `${ … }` is scanned as
  code. Its comments are stripped, its own strings, templates and regexes
  are kept, and its braces are matched to find the closing `}`. The rest of
  the template stays literal text.

### V4. An empty `?` or `#` is not a catalog path
`storedPath` returns null when the stored texture **string** contains `?`
or `#` anywhere, as well as when `search` or `hash` is non-empty.

### V5. An owned Model answer is handled by the form alone
In `onStructureAnswer`'s `request.model` branch, an answer
`modelForm.onAnswer` owns shows **no** generic edit error, whatever its
status. The form's own message ("The world did not answer; try again") is
the only one. A not-owned answer is unchanged (Z2).

### What doesn't change
Everything else in Z1–Z8, and round 1's code outside these five points.

## 3. Tests and proofs (round 2)

| Item | New tests |
|---|---|
| V1 | `teleporter-form`: (a) a fake adapter that re-selects `selected` only when it's among the options it writes (with `/` always written): choose `/` while loading, deliver the list: the value is still `/` and Save is enabled. (b) A chosen world that the late list no longer offers: the placeholder, and Save **disabled** unless the input has text. (c) With text typed and no world chosen, a late list keeps Save enabled. (d) `fillWorlds` receives `selected` on the late fill. Plus a wiring guard: `fillTeleporterWorlds` reads `selected` and assigns `tpWorldSelect.value` from it |
| V2 | `model-form`: type a URL **with the box focused**, then `reset()`: the box and the state are both empty. Render with focus still leaves a typed box alone (existing test kept) |
| V3 | `edit-key-wiring` scanner: each of the four capture forms above makes `captureFlag` true (or unknown, for the spread); `{ capture: true, capture: false }` is false; computed key, shorthand and method are unknown. A crafted listener whose only `stopImmediatePropagation()` sits in a comment inside `${ … }` fails the order rule. A `//` inside a string inside `${ … }` is kept |
| V4 | `sky-picker`: `…jpg?` and `…jpg#` give Custom |
| V5 | `app-wiring`: in the `request.model` branch, the owned path (`if (modelForm?.onAnswer(…))`) contains no `showEditError` call |

**Proofs** (each break fails named tests; "not reproducible" is not an
acceptable result):
- **(r1)** `fillIfCurrent` not passing `selected`, or the module not
  re-deriving Save;
- **(r2)** `reset()` not writing the box (the focus exception applied
  there too);
- **(r3)** `captureFlag` back to the unquoted-key regex;
- **(r4)** `${ … }` copied as text again;
- **(r5)** `storedPath` checking only `search` and `hash`;
- **(r6)** the owned unknown answer's `showEditError` put back.

**And the whole round still passes:**
- full suites, with the same rules as round 1: server files one at a time
  under `timeout 180`, `packages/client` without `--test-force-exit`;
- **round 1's proofs (a)–(g) and their sub-proofs re-run** against the
  round-2 tip.

**Steps, one commit each:**
1. V1;
2. V2;
3. V3;
4. V4 and V5;
5. suites, proofs and the handoff.

**Before DEV acceptance:** Claude re-runs browser checks 1–10, plus V1 in the
browser (pick "The commons" while a delayed list loads).

## 4. Kickoff body for round 2 (post it verbatim as the revision kickoff card's text)

---

### KICKOFF — edit-polish-3 revision round 2. Slug: `edit-polish-3`

You are the kickoff orchestrator for round 2 of `edit-polish-3`. Build the
graph below, read it back, report, and stop. Do not implement, review or
deploy anything yourself.
- **Your tools:** only `kanban_*`.
- **Blocking:** never call `kanban_block` without an explicit `task_id`, and
  never block this card.
- **Titles:** use them exactly as written.

**The contract is in git; you don't read it.** It is
`devtasks/REVISION-edit-polish-3.md` on `main`, together with
`devtasks/PREBRIEF-edit-polish-3.md` at `dcd5fa6e4625bf9d483fe8ce3e7cc3c79bfb38bd`
(sha256 `031b140d1115ffe6d6fd20bcd50c8d302694440043b78c5820951f8a04cc1dec`).
- **The front door has already checked the revision** and posted its commit
  and sha256 on this card. **You have only `kanban_*` tools: do not try to
  fetch or hash anything, and do not block for lack of a shell.**
- Copy that commit and sha256 into cards 1 and 2. **They** have terminal,
  file and git tools. Each reads the revision with
  `git -C /workspace/atrium fetch origin main && git -C /workspace/atrium show <commit>:devtasks/REVISION-edit-polish-3.md > /tmp/revision.md && sha256sum /tmp/revision.md`,
  and blocks with `kind="capability"` on a mismatch.

#### Graph
1. **`Implement r2 — edit-polish-3`.** Assignee `atrium-deepseek`, parent:
   this kickoff, `--max-runtime 2h` (7200 s).
   - **Body:**
     - the revision reference and hash check;
     - continue `workflow/edit-polish-3` from
       `a3ec65371e3b4bcaac6a4e2b7b96722e20341a1d` in the existing worktree
       `/workspace/wt/edit-polish-3` (`git -C /workspace/wt/edit-polish-3
       status` must be clean at that SHA, or block `needs_input`);
     - the revision's §3 steps, tests and proofs;
     - the WORKER-CARD REQUIREMENTS comment (751 on `t_7087da37`).
   - **The handoff** carries proofs (r1)–(r6) **and** round 1's (a)–(g)
     with sub-proofs re-run, with per-file counts and exit codes.
2. **`GLM review r2 — edit-polish-3`.** Assignee `atrium-glm`, parent:
   card 1.
   - Its body opens with
     `THIS RUN HAS TERMINAL, FILE AND GIT TOOLS. Use them for every step below.`
   - The reviewer reproduces every proof itself and checks that every test
     in the revision's §3 table exists.
3. **`Review gate r2 — edit-polish-3`.** Assignee `atrium-orchestrator`,
   parent: card 2. It creates nothing.
   - **On a valid APPROVE of the exact 40-character SHA,** it blocks with
     `APPROVE <SHA40>: front door, build the release chain`.
   - **Otherwise,** it blocks for the operator with the verdict quoted.
4. **Before you complete,** link card 3 to **round 2's sentinel** as a
   parent. The front door creates it and posts its id on this card. Round
   1's sentinel `t_e9f390bd` must not be used. Do not create a sentinel
   yourself.
5. **The release chain** is the front door's: the same four cards as round
   1 (`devtasks/KICKOFF-library-sky.md`, "Release chain"), with the new SHA.
   Nothing reaches MAIN or PROD.

#### Report back
- the three ids;
- the implementation's parent and its 7200 s cap;
- the hash line copied into cards 1 and 2;
- the review's opening line;
- the gate linked to round 2's sentinel.

Then complete this card.

---
