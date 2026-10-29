# Atrium Passdown — 2026-10-29 — scripting-4b-2 (behaviours, owner-present) and the message-depth-guard hotfix, released

**Predecessor:** `devtasks/Atrium-Passdown-2026-10-24-scripting-4b-1.md`. Its
host, connector and convention notes still hold, except where this file says
otherwise.

**First instruction for the next session's Claude:**
1. Clone the repo and read `devtasks/`, newest first (this file first).
2. Use the `atrium-ops` connector for board, release, log and git state. It
   is read-only.
3. **Next up is Phase 3 step 4c** (§6.1): visitors' `activate`. Its pre-brief
   doesn't exist yet; `devtasks/PREBRIEF-scripting-4b-2.md` §9 is its sketch.
4. **Never push to `main` between a DEV deploy's release merge and the MAIN
   push.** This round kept to it: the revision documents went to `main` only
   while no MAIN push was pending, and the harness scripts went to a
   `claude/` branch first (§4.6).

## 1. Status at handoff

| Item | State |
|---|---|
| Release | **COMPLETE** (2026-10-29 ~12:50 PT). DEV, MAIN and PROD are at `0c31ddc0b8e55e799d7b4c09ca2717d089f0bd81`, recorded and healthy, with the deploy lock free. Checked through the connector |
| What `0c31ddc0` is | The release merge of round 7's reviewed tip `3596651105c08b10b6678bf4e5309e028517c42a` with `main` `967bd621` (round 7's revision). The only difference is `devtasks/` |
| Spec | `devtasks/PREBRIEF-scripting-4b-2.md`, FINAL Rev 2.1 (95,425 bytes, sha256 `a7841421…0a73`, at `951b541b`), plus the OPERATOR CORRECTION (C1–C3) and OPERATOR NOTE on `t_6c3817b2`, and the revisions of rounds 2–7 (§3) |
| Decisions | F-L1–F-L12 as recommended (operator); the pre-brief had two outside reviews (Rev 1, Rev 2) before FINAL |
| Rounds | **Seven**, plus one security hotfix released on its own between rounds 5 and 6 (§3) |
| Hotfix | message-depth-guard: on PROD as `4a1a01a5` since 2026-10-25 18:55 PT, and in 4b-2 through round 6's W0 merge |
| DEV acceptance | The operator, Firefox, on `0c31ddc0` (2026-10-29): §6 steps 1–3 and 5–7 pass, and round 7's extras (labelled rows, the no-animations text, the scrolling panel). **Skipped:** step 4 (no owner world on DEV has a light, §6.2; Claude's F12 check covers it on `0c31ddc0`), and the older-world extra (the operator couldn't identify the world; Claude's `r7.py` X6 covers it on `0c31ddc0`) |

## 2. What shipped

**4b-2 — behaviours, owner-present:**
- **The leaf** `extras.atrium.behavior` (F1, F2): a `KHR_interactivity` graph
  plus `nodeMap`, `targets`, `animations`, `proximity`/`interval` and the
  template it came from. One check in two copies (`@atrium/behaviors`'
  `behavior-spec.js`, used by the server on `send` and `add` and by the
  client), bounded walks that fail closed, 64 behaviours per world.
- **The vendored engine** (F3, F-L11 as amended by round 4): the Khronos
  `gltf-interactivity-engine` and `gl-matrix`, unedited workspace packages at
  `packages/gltf-interactivity-engine/` and `packages/gl-matrix/`, with
  licences, hashes and `NOTICE` entries.
- **The adapter and runner** (`packages/behaviors`, F4, F5): one engine per
  behaviour per load, a step budget, pointer authorization, the clip check;
  the runner only in the `scriptHost.active` session (the election now
  requires `hello.capabilities.scriptRunner`), a coalesced send queue at one
  send per 50 ms with a 100-key cap, each entry checked again when it leaves
  (producer live, no drag in progress, authority), and every disable a
  dispose.
- **Five templates** (F8): on select show/hide, on select play/stop an
  animation, on enter play / on exit stop, on select toggle a light, every N
  seconds play.
- **The Behaviour section** of the Edit panel (F9, rounds 5–7): template,
  one labelled field per row, a target picker, Enabled, Save (a multi-stage
  sequence bound to a snapshot and a generation), Remove, a status line in
  plain words, the node's own log lines. The form checks before it sends
  and every field shows exactly what it will send.
- **The renderer honours `visible`** (F6), on every path that changes it; the
  own capsule is hidden in first person.
- **Duplicate and Undo** (F10): a copy's self-targeted behaviour targets the
  copy; behaviour changes aren't undone by Undo, and the panel says so.
- **The Edit panel scrolls** when it is taller than the window.

**message-depth-guard (security, its own release):**
- **G1:** every inbound WebSocket message is checked against a nesting depth
  of 64 (`MAX_MESSAGE_DEPTH`, an iterative walk after `JSON.parse` and before
  `validate`) and refused with one log line.
- **G2:** the message handler fails closed: a `try/catch` around the whole
  listener body, with its own log line and reply.
- Before it, one deeply nested message from any client (an owner's `add`, or
  a visitor's own avatar `add`) crashed the server process and every world
  on it. Reproduced on PROD's tree; found by the second outside review (N3).

**Tests at release** (round 7's handoff, re-run by GLM): `apps/client` 1,172,
server 623 (42 files, each run on its own), `packages/client` 536, som 260,
protocol 91, renderer-three 311, interaction 9, behaviors 131. One named
skip (`KHRONOS_ASSETS`), nothing else skipped. `r1` exit 0.

## 3. How the round ran

| Round | Reviewed tip | Cards | What happened |
|---|---|---|---|
| Brief | — | GLM brief `t_129a44c8` | From the FINAL pre-brief |
| 1 | `b246093f` | impl `t_6c3817b2`, GLM `t_4cf25321`, gate `t_3e676fd9` | CHANGES_REQUIRED: the OPERATOR CORRECTION's C2 (the light's on-value) half delivered, its test and help text missing |
| 2 | `2d5e3487` | impl `t_211bb151`, GLM `t_dd0ae66d`, gate `t_b3b26724` | R1, R2. CHANGES_REQUIRED: C2's help sentence computed but rendered nowhere |
| 3 | `c0e563f0` | impl `t_3c3bd9a6`, GLM `t_4b921a88`, gate `t_916959c5` | T1. APPROVE, but the operator's host pre-check found the host's workspace rules refuse `packages/vendor/*`; the gate was never completed and its chain never ran |
| 4 | `957140bd` | impl `t_d4852f0b`, GLM `t_0bc9416b`; Publish `t_58fd67a9`, DEV `t_043bcfe0` (`8ab5e52f`) | U1 (the vendored packages move). On DEV. Claude's browser checks and the operator's outside review (NO-GO, M1–M7, S1–S4) found the form throwing in a real page, Enabled dead, every animation template a no-op, and more (round 5 §1) |
| 5 | `c042ef5a` | impl `t_b16beaa2`, GLM `t_3c03a44a`; Publish `t_271332b8`, DEV `t_52e0c377` (`e3d9ab14`) | V1–V14. On DEV. The second outside review: GO for V1–V14, with N1–N3; N3 was the server crash |
| Hotfix | `3e103d27` → `4a1a01a5` | GLM brief `t_69640d7a`, impl `t_8780be8a`, GLM `t_c71cd9e6` (gate `t_0b091c38`), fix `t_8f9c56dc`, re-review `t_e76667ee`; Publish `t_86b24df7`, DEV `t_f784a4c5`, PROD `t_c1860389` | message-depth-guard (G1–G5). The first review was CHANGES_REQUIRED (D3: a test-only depth recorder in `src`; D2: the G2 log line's format); the fix passed. Released to PROD 2026-10-25 18:55 PT |
| 6 | `45241157` | impl `t_0005f38a`, GLM `t_a25224fc`, gate `t_a6be02d4`; Publish `t_e50f0254`, DEV `t_d888e8ca`, finalizer `t_1937aca7`, acceptance `t_89fe6413` | W0 (merge the hotfix), W1–W8 (browser-check findings, N1, N2, nits). On DEV with no release merge (`main` was an ancestor). DEV acceptance found round 7's items |
| 7 | `35966511` → `0c31ddc0` | impl `t_e62ece2b`, GLM `t_7ddbb75b`, gate `t_8b834252`; Publish `t_b44ceed9`, DEV `t_fb544ed0`, finalizer `t_e6c887ba`, acceptance `t_7228fcf8`, PROD `t_6892eb7c` | X1–X6, client only. Released |

The revisions: `devtasks/REVISION-scripting-4b-2.md` (round 2) and `-r3.md`
to `-r7.md`, each with its commit and sha256 in the next one's header.
Superseded gates and finalizers were never completed (§4.5); round 1–7
sentinels are `t_6ad02da5`, `t_31a95fba`, `t_b9c2a9bc`, `t_e7ef64b2`,
`t_e7333c23`, `t_f59ac6b2` and `t_95c8aa33`.

## 4. Findings and lessons

### 4.1 Browser checks find what the unit tests can't
Round 4 passed every suite and GLM's review, and in a real page the
Behaviour form threw on every render (`field.dataset = {…}` on a
`DOMStringMap`), Enabled listened for `change` on a `<button>`, and the
animation templates wrote a value 4a's animation layer ignores. Round 5 added
a strict DOM fake and a "`dataset` is never assigned" guard (V1, V12), and
round 6 made the fake deliver `change` as the DOM does (W8). **For any round with UI, run Claude's
harness checks on the published tip before DEV acceptance,** through the real
controls, as rounds 5–7 did.

### 4.2 The outside reviews earned their place
The review of round 4 (NO-GO) found seven must-fix items GLM had approved
(queue entries outliving their producer, unbounded walks in the server's
check, the drag rule at the send, disables that didn't dispose, Enabled, and
Save following a replaced target). The review
of round 5 (GO) found the server crash (N3), which was on PROD, and two
runner leaks. **Keep an outside review for every round that runs
world-supplied code,** and re-review after large revisions.

### 4.3 DEV acceptance found what the harness's worlds didn't have
Round 6 passed every harness check, and the operator's first DEV run found:
the fields running together in the 250 px panel; a library model (no clips)
sending an empty clip; values sent unchecked with F1's code-level message
("animations is malformed"); fields showing one value while the form held
another; a panel taller than the window; and older, id-less models getting
no clip list and losing their target after Save. The harness's worlds had
ids on every model and only animated models. **Test with a library model, a
world saved before ids existed, and a short window.** `r7.py` now does.

### 4.4 The host's rules shaped two rounds
- **Workspace rules** (`config.py`: `WORKSPACE_ALLOWED = ("packages/*",
  "tools/*", "apps/*")`) refused `packages/vendor/*`. The operator found it by
  reading the host's code before completing round 3's gate; round 4 moved
  the packages.
- **The release merge** (`atrium-release-merge`, `ALLOWED_RE='^devtasks/'`)
  refuses a `main` change outside `devtasks/` the tip doesn't contain. Once
  the hotfix was on `main`, 4b-2 had to merge it first (round 6's W0, with a
  rule for the expected `session.js` conflict).
- **`set-dev` from `WAITING_FOR_HUMAN_DEV_ACCEPTANCE`** replaces an unaccepted
  round on DEV; rounds 5, 6 and 7 used it.

### 4.5 The pipeline
- **Superseded cards:** each round's gate, finalizer and acceptance gate stay
  blocked and are never completed. But a blocked **parent of a sentinel**
  pins it: Claude once told the operator to leave the hotfix's first review
  gate (`t_0b091c38`, CHANGES_REQUIRED) blocked for good, and the operator had to complete it after all. Check a
  card's children before leaving it blocked. §7 archives the leftovers.
- **Archiving a card promotes its children.** §7's first version archived
  round 3's gate before its never-run chain, so round 3's Publish and DEV
  deploy of `c0e563f0` went to `ready` for a moment (2026-10-29 20:07 UTC)
  before the same loop archived them. Neither was claimed and DEV stayed on
  `0c31ddc0`, but a dispatcher tick in between would have run an old deploy.
  The round's sentinels did run, harmlessly, with their old end states.
  **Archive leaf-first:** a chain's last card before its first, and a gate
  after everything under it.
- **Kickoffs:** round 6's implementation card got a 90-minute cap instead of
  180; round 7's kickoff created its cards with empty bodies and posted the
  bodies as comments (workers read them, but tell the next kickoff to fill
  the body field). The front door once looped on `kanban_create` with no
  body; a fresh session (`/new`) fixed it. It also once reported figures it
  hadn't measured, and corrected them on the card.
- **Operator commands:** a heredoc with a placeholder ran with the
  placeholder (the paste went nowhere). Give self-contained blocks with the
  text already inside, and put "check this first" **before** the block it
  guards, not after.
- **The deployer's handoff gap** is unchanged (4b-1 passdown §4.2): verify
  with `atrium-release-status`.

### 4.6 Claude's checks and `main`
- **New checks:** `devtasks/harness/checks/scripting-4b-2/` (README inside):
  the runtime without the form (`rt*.py`), the form (`f1`–`f3`), the outside
  reviews' scenarios (`o1`, `o2`), the deep-message crashes (`deep*.py`),
  round 6's DEV findings (`dev2`, `noid`, `prox3`, …), and round 7's `r7.py`.
  They went to `claude/harness-4b-2` and were merged with this passdown.
- **A proof can be masked:** round 7 asked for two mechanisms with one
  outcome (switch to the target's new id when Save gives it one, and
  normalise `name:<n>` on every render). Removing either alone leaves the
  sequence test green. When a contract requires two mechanisms, write a
  proof for each that breaks only it.
- **Regression set:** 28 scripts from 4b-1, 4a, library-sky and
  edit-polish-3, compared with the previous run ignoring numbers, ids and
  avatar names. f1's F6 line is noisy (the Fox still has F5's interval
  behaviour); f3's P section is the clean proximity check.

## 5. Recipes
The same as the 4b-1 passdown §5, plus the guarded PROD block (teleport-rearm
passdown §7.2). The commands the release used, in order:
```bash
# the review gate (after the front door has built the chain)
hermes kanban --board atrium complete <review gate> --result "OPERATOR: rN gate passed, GLM APPROVE <SHA40>; release the chain"
# accept, MAIN, then check, then the guarded PROD block with the same S
S=<RELEASE_SHA>
hermes kanban --board atrium complete <acceptance gate> --result "OPERATOR: <slug> DEV accepted ($S; reviewed <SHA40>)"
atrium-main-approve $S && atrium-main-push $S
atrium-release-status    # expect WAITING_FOR_PROD_APPROVAL, REVIEWED and MAIN actual = $S
```

A behaviour's state in a tab (browser console; wrap in `{ … }` so it can be
pasted twice):
```js
{ const n = atriumClient.som.allNodes.find(n => n.name === 'Fox')
  console.log(JSON.stringify({ host: atriumClient.scriptHost, hidden: document.hidden,
    behaviour: n?.extras?.atrium?.behavior?.template, animation: n?.extras?.atrium?.animation })) }
```

## 6. Follow-ups

### 6.1 Next: Phase 3 step 4c — visitors' `activate`
From `PREBRIEF-scripting-4b-2.md` §9: the message and schema; the server's
checks (an enabled behaviour that listens for `select`, distance, 5 per
second per session and 20 per world, a host present); forwarding to the
current `hostGen` only; the visitor's click path; and the non-host owner
tab's clicks through the same route. 4d (graphs beyond the templates) after
it, as §9 lists.

### 6.2 New: the light template can't be used in any owner's world
New worlds start from a template with no lights (`newWorldDocument`,
`home-world.js`), the Edit panel can't add one, and there's no import from a
`.gltf`. So "On select: toggle a light" always shows "This world has no
lights" outside the harness. Needs an "add a light" tool or a world import.

### 6.3 New: the proximity template's two objects
The radius is measured from the object that carries the behaviour, and the
Target is what plays. The operator read the Target as pointless ("it only
works if the target is the same as the selected object"). Chosen, not
urgent: a hint that names both objects, and the field labelled "Animate".

### 6.4 Open: a visitor didn't see a proximity animation until a reload
Reported once on round 6's DEV; not reproduced by Claude (new and id-less
worlds, a visitor and a second owner walking in and out, every tab sampled).
If it recurs, run §5's snippet in each tab, and note whether the tab was in
the background or loaded before the last deploy.

### 6.5 Small host round (still open)
4b-1 passdown §6.4, plus: `@atrium/behaviors` in the host's test list (round
5's S4; round 7's deploy listed seven suites, none of them
`@atrium/behaviors`).

### 6.6 Recorded, not done
1. **Conformance fixtures** (round 5's S3): a small set of independently
   written graphs within F-L4's ops with expected results, for 4c or 4d.
2. **Round 7's proof gap** (§4.6): a test that fails when only the
   stage-answer id switch is removed.
3. **4a's item 4** (selection bounds from one pose): deferred to 4d or a
   polish round (pre-brief F-L12).
4. **4b-1 passdown §6.3** (`KHR_animation_pointer` models): unchanged.

### 6.7 Open, and wider than recorded: the top bar and the viewport disagree about who you are
4b-1 passdown §6.2 (signed in on the page, anonymous on the server) is **not
fixed**. The operator has since seen a second form of it: **signed in as one
user in the viewport and as another in the top bar.**
- **A likely cause, from the code (not confirmed):** the session cookie is
  shared by every tab, but each page reads `/api/auth/me` once, at load, and
  never again. If another tab signs out and signs in as someone else, this
  tab's top bar keeps the old name, and its next connect or teleport is
  admitted with the new cookie as the new user. The anonymous case is the
  same mechanism with an expired or cleared session.
- **The fix proposed there covers both:** re-check `/api/auth/me` before each
  connect or teleport and when the tab becomes visible; and have `hello`
  say who the server admitted (authenticated or not, and as whom), so the
  page can compare it with the top bar and re-check or say so on a
  mismatch. Worth its own small round before 4c, since 4c is where visitors'
  and owners' identities start to matter for behaviours.
5. The edit-polish-3 passdown §6.3, items 1–6 and 8: unchanged.

## 7. Cleanup (operator, host)
```bash
# the superseded cards, never completed by design — done 2026-10-29. Leaf-first
# (§4.5): archiving a parent promotes its children, so each chain goes last card first.
for t in t_c2d75b59 t_4642b86e t_82c17ea9 t_03ede0fb t_916959c5 \
         t_26410540 t_6717fe9c t_fbb089d1 t_78ba2e7f t_89fe6413 \
         t_b3b26724 t_3e676fd9; do
  hermes kanban --board atrium archive $t
done
# the round's branches
git -C /root/lib-install push -q https://github.com/joshmaurice/atrium --delete \
  workflow/scripting-4b-2 workflow/message-depth-guard \
  release/957140bd9284 release/c042ef5a581d release/3e103d275158 release/3596651105c0 \
  claude/harness-4b-2
git ls-remote https://github.com/joshmaurice/atrium   # main only
```
