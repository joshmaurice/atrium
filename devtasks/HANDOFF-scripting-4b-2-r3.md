# Handoff — scripting-4b-2 round 3 (T1)

**Branch:** `workflow/scripting-4b-2` (base
`2d5e34874775a68850049f47118b1b976da52b8a`, round 2's reviewed tip).
Worktree `/workspace/wt/scripting-4b-2` only; not pushed.
`/workspace/atrium` untouched (still `main`).

**Commits:** `81393d2` (step 1 — T1 and its tests, the round's code tip),
and the commit on top of it that adds this file (step 2 — suites, proofs
and handoff; no source change). Round 3's tip is that second commit.

Round 3's contract is `devtasks/REVISION-scripting-4b-2-r3.md` at
`f47cc3f7` (sha256 `4e49b1d4…0e93f`, verified before any work), §2 T1 and
§3: `apps/client/index.html`, `apps/client/src/app.js` and
`apps/client/src/behavior-form.js`.

## 1. The finding, and the class of it

The round-2 review found that `HINT_LIGHT_ON` (`behavior-form.js`) was
appended to the form's hint for `select-light`, was tested, and rendered
nowhere: `app.js` passed no `hint` element to `createBehaviorForm`, so
`elements.hint` was `null` and `text(null, …)` was a no-op, and
`index.html`'s Behaviour section had no such element.

Every help line the form computed was equally invisible, so round 3 fixes
the class: **one help element, wired, plus a guard that every user-facing
string the spec names reaches an element that exists.**

## 2. The change (step 1, `81393d2`)

- `index.html`: `#ep-behavior-hint`, a plain text block
  (`class="ep-status"`, hidden while empty), **between
  `#ep-behavior-params` and `#ep-behavior-actions`** inside the Behaviour
  section.
- `app.js`: binds it and hands it to `createBehaviorForm` as
  `elements.hint`, the key the form already reads — the form's code and
  its tests keep their shape.
- `behavior-form.js`: one writer for the element, `renderHint(value)`,
  which moves the text and its visibility together (hidden while empty,
  cleared on close, on `None` and on `Custom graph`); `hintText()` returns
  the chosen template's lines.

### The hint's lines, per template

| template | the hint element receives |
|---|---|
| `None` | `''` — cleared and hidden |
| `Custom graph` | `''` — cleared and hidden |
| `select-visibility` | generic + "One click per change." |
| `select-light` | generic + C2's sentence + "One click per change." (+ "This world has no lights" when none is on offer) |
| `select-animation` | generic + "A clip's end doesn't trigger anything." |
| `proximity-animation` | generic + "A clip's end doesn't trigger anything." |
| `interval-animation` | generic + "A clip's end doesn't trigger anything." |

C2's sentence comes straight after the generic sentence — R1's order — and
round 3's lines follow it. The D4 sentence is **not** repeated: it is
already rendered once, in `#ep-behavior-note`.

## 3. The inventory

Every user-facing string the spec (F4, F6, F8, F9, E8), C2 and the two
revisions name for the Behaviour section and the host line, with the
element id it lands in and who writes it there. The guard
(`apps/client/tests/behavior-inventory.test.js`) asserts, per string, that
the element id is in `index.html`, that `app.js` binds it and hands it to
the code that writes it, and — for the form's strings — that the form
actually writes it there (observed by driving the form through every
template, `Custom graph`, `None` and every status).

| string | element id | writer |
|---|---|---|
| `None` ("None") | `ep-behavior-template` | `app.js` (the option list) |
| "On select: show or hide" | `ep-behavior-template` | `app.js` (`TEMPLATE_LABELS`) |
| "On select: play or stop an animation" | `ep-behavior-template` | `app.js` (`TEMPLATE_LABELS`) |
| "On enter: play; on exit: stop" | `ep-behavior-template` | `app.js` (`TEMPLATE_LABELS`) |
| "On select: toggle a light" | `ep-behavior-template` | `app.js` (`TEMPLATE_LABELS`) |
| "Every N seconds: play" | `ep-behavior-template` | `app.js` (`TEMPLATE_LABELS`) |
| "Custom graph" | `ep-behavior-template` | `app.js` (and the form sets the select) |
| "Running" | `ep-behavior-status` | the form |
| "Disabled: …" | `ep-behavior-status` | the form |
| "Not running: this tab isn't the script host" | `ep-behavior-status` | the form |
| "Behaviours run in another tab; clicks here don't trigger them" | `ep-behavior-status` | the form |
| "Saving…" | `ep-behavior-status` | the form |
| "Save cancelled" | `ep-behavior-status` | the form |
| "Behaviour changes are saved with the world and aren't undone by Undo." (D4) | `ep-behavior-note` | the form |
| "Behaviour changes are saved with the world." (generic) | `ep-behavior-hint` | the form |
| "If the light was off when you saved, 'on' uses intensity 1." (C2) | `ep-behavior-hint` | the form |
| "One click per change." | `ep-behavior-hint` | the form |
| "A clip's end doesn't trigger anything." | `ep-behavior-hint` | the form |
| "This world has no lights" | `ep-behavior-hint` | the form |
| "Script host: this tab (behaviours run here)" | `ep-host-status` | `app.js` (`hostStatusText`) |

## 4. Proofs

Method: commit, break the file, run the named test file, record the failing
test names, restore the file **from an on-disk saved copy** (never `git
checkout`), re-run green. Round 1's rule held: where the first break did
not reproduce, the break was fixed, not the test.

| proof | break | failing tests (by name) |
|---|---|---|
| **(t1)** | `app.js` stops passing the hint element | `behavior-wiring`: "app.js passes it to createBehaviorForm as the form's hint element"; `behavior-inventory`: the five hint strings, each by name ("Behaviour changes are saved with the world." / "If the light was off…" / "One click per change." / "A clip's end doesn't trigger anything." / "This world has no lights" → `#ep-behavior-hint`) |
| **(t2)** | `#ep-behavior-hint` removed from `index.html` | `behavior-wiring`: "#ep-behavior-hint is in index.html", "it sits inside the Behaviour section, between the params and the actions"; `behavior-inventory`: the five hint strings, each by name, and "nothing in the inventory is empty, and every element is a real page id" |
| **(t3)** | one template's help line dropped from the form (`interval-animation` loses the clip-end line) | `behavior-form`: "T1 — the hint element carries each template's own lines, and "None" clears it" |
| **(h)** re-run | stage 1 falls through and writes the leaf before the id is answered | `behavior-form`: the 5 F9/M4 sequence tests (same names as round 1) |
| **(h2)** re-run | the sequence survives the bump (4 places: `bump()` keeps the sequence, `onAnswer`'s generation guard, `dispatchStage`'s guard, `aliveAsRecorded`'s two checks) | `behavior-form`: "F9 — a selection change after the first acknowledgement stops the sequence (M4)" (exactly one) |
| **(r2)** re-run | the C2 sentence removed from the hint | `behavior-form`: "R1 — the hint carries C2's sentence for select-light and for nothing else", "T1 — the hint element carries each template's own lines…"; `behavior-inventory`: "If the light was off when you saved, 'on' uses intensity 1." → `#ep-behavior-hint` |
| **(e4)** re-run | the viewport select taken without `isSelectClick` | `behavior-wiring`: "select comes from the VIEWPORT click, never from a SOM click" |

**(t1) needed a second, correct break.** The first attempt commented the
wire out (`// hint: epBehaviorHint,`), and both guards still passed: they
matched the text, and a comment is text. **The tests were weak, so they
were strengthened, not the break weakened**: both guards now read `app.js`
with its whole-line `//` comments dropped, and the rerun above (the
commented-out wire) reproduces.

## 5. Verification (node v22.23.2; total skipped: 1)

Every `packages/server/test/*.test.js` file run **one at a time** as
`timeout 180 node --test <file>`: 39 files, every one `# fail 0`,
`exit=0`, and every one exited on its own (no `124`). Counts (tests/pass):
add-extras 9 · animation-extras 15 · animation-stamp 5 · audit-document 6 ·
auth 17 · autosave 10 · avatar-ownership 4 · avatar 7 · behavior-leaf 21 ·
client-listener-guards 3 · commons 19 · db 11 · dump-cost 2 ·
duplicate-names 4 · edit-e2e 6 · edit-plumbing 42 · external-refs 6 ·
home-world 15 · http-integration 51 · model-extras 7 ·
multi-world-mutation 9 · object-id 20 · origin 17 · payload-cap 2 ·
presence 6 · prune-serialize 13 · rate-limit 5 · reconnect-session 5 ·
script-host 11 · send-field-allowlist 44 · session 19 · sky-url 31 ·
source-ref-guard 21 · teleporter 16 · transform-ranges 11 · visitor-leak 4 ·
world-crud 75 · world-visibility 24 · world 9.

Other packages, `node --test` on each package's own test directory:
`packages/som/test` 250/250 · `packages/som/tests` 10/10 ·
`packages/protocol/test` 91/91 · `packages/client/tests` 536/536 (no
`--test-force-exit`) · `packages/behaviors/tests` 112 tests, 111 pass,
**1 skipped** · `packages/renderer-three/tests` 310/310 ·
`packages/interaction/tests` 9/9 · `apps/client/tests` 1082/1082. All exit
0, none with `--test-force-exit`, none run in the background.

**The one skip:** `packages/behaviors/tests/conformance.test.js` — "the
subset recomputes against the checked-in list, and every asset runs",
`KHRONOS_ASSETS is not set`. It is the only skip in the round. With
`KHRONOS_ASSETS=/workspace/wt/.proof-assets/khronos/Tests/Interactivity`
it passes 2/2, skipped 0.

`apps/client/tests/importmap-guard.test.js` 12/12, exit 0.

## 6. Deviations and notes

1. **The two help lines were added; the existing wording was kept.** The
   generic sentence and C2's sentence are unchanged.
2. **`"This world has no lights"` had no home either.** The form's
   `elements.noLights` seam was computed and never wired, and the sentence
   was never written anywhere at all — the same class of defect as the
   hint. It now renders in `#ep-behavior-hint` (the section's help
   element), for `select-light` when no light is on offer. `elements.noLights`
   is left exactly as it was, so the form's logic is unchanged.
3. **The D4 sentence is not repeated in the hint**: `#ep-behavior-note`
   already renders it, once, under the status line (F9).
4. **Two round-2 test expectations were updated**, both because the
   revision adds a line: `R1 — the hint carries C2's sentence…` asserted
   the hint was *exactly* generic + C2 for `select-light`, and that the
   other four kept the generic sentence alone. It now asserts C2's
   sentence comes straight after the generic one, and is absent for the
   other four — the property R1 actually pinned. The T1 tests carry the
   new per-template lines.
5. **Bullet 1 of §2's guard is met without a `noLights` element**: the
   section has ONE help element, as T1 requires.
