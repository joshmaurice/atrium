# Atrium Passdown — 2026-10-19 — Edit mode tweak round (full pipeline)

**Predecessor:** `devtasks/Atrium-Passdown-2026-10-18-undo-redo.md`. Its host,
connector and follow-up state still holds, except where this file says
otherwise.

**First instruction for the next session's Claude:**
1. Clone the repo and read `devtasks/`, newest first.
2. If the `atrium-ops` connector's tools are listed, use them for board,
   release, log and git state. It is read-only.

## 1. Status at handoff

| Item | State |
|---|---|
| Release | **COMPLETE** (2026-10-19 ~13:50 PT), checked through the connector: DEV, MAIN and PROD at `ab32f9b8d9661796af2a3b215f44675a965bdb26`, all recorded, both healthy, deploy lock free, **no warnings**, nothing ready, running or blocked |
| Base | `32016839` (`main` with the pre-brief uploaded) |
| Spec | `devtasks/PREBRIEF-edit-tweaks.md`, FINAL Rev 1.1 (one outside review, §4.1) |
| Lane | **full pipeline** (K1), chosen to save Claude usage on a small round |
| Branches | `claude/prebrief-edit-tweaks`, `workflow/edit-tweaks`, `claude/passdown-edit-tweaks` (this file): for the operator to delete when done |

**Board, this round:** kickoff `t_e824025e`; sentinel `t_3fffe891`; GLM
brief `t_a2b27dcd` (comment 509); brief gate `t_9ffbbdbc`; implementation
`t_98bc0e46` (handoff comment 512); GLM review `t_afbe4076` (APPROVE
`ab32f9b8`); review gate `t_fac56057`; publish `t_65bc7cc6`, DEV deploy
`t_1015f495`, DEV finalizer `t_6be7e0f3`; acceptance gate `t_3c3c783b`;
release sentinel `t_c0edf255`; PROD gate `t_39794a1f`; PROD deploy
`t_769babb1`.

### 1.1 Timeline (PT)
10:42 lane switched to the full pipeline · ~11:05 pre-brief Rev 1 ·
11:10 outside review of Rev 1 · ~11:12 Rev 1.1 uploaded (`32016839`) ·
11:21 kickoff · 11:24 GLM brief · ~11:30 brief gate released · ~11:44 DEV
(implementation, GLM review, publish and DEV deploy with no stop) · ~12:40
Claude's §5.1 checks 25/25 · 12:57 outside code review APPROVE · ~13:39
operator DEV acceptance · ~13:50 MAIN and PROD.

**The pipeline itself took about 25 minutes from kickoff to DEV, with no
refusal and no operator intervention after the brief gate.** Almost all the
elapsed time was review and acceptance.

## 2. What shipped

`packages/renderer-three` and `apps/client` only (9 files, +641 −133). No
server, protocol, SOM or `packages/client` change; no DEV restart.

- **Back faces** (K2): a shared `addBackFace` in `geometry-utils.js` appends
  a reversed copy of every triangle, copying every attribute (uv included)
  and negating only normals. Palette planes (8 vertices, 4 triangles) and
  teleporter pads (196, 192) are now visible and clickable from below. The
  material stays single-sided, so Duplicate and Undo accept them. **Existing
  planes and pads are not migrated.**
- **Delete and Duplicate keys** (K3): Delete/Backspace and Ctrl/Cmd+D in
  Edit mode, through one key listener (`app.js`) and the pure
  `edit-keys.js`. Keys call the buttons' own handlers, so W6's dialog and
  every block apply; a refused action shows the button's reason; nothing
  selected does nothing; **a repeated key is consumed but not run**, so
  holding Ctrl+D makes one duplicate with no strafing and no bookmark
  dialog. Text fields and Edit off keep the browser's keys.
- **Teleporter delete mode retired** (K4): no toolbar Delete; pads are
  deleted in Edit mode and come back with Undo. `setTeleporterMode` accepts
  only `'placement'` or `null`.

**Tests:** renderer-three 86 → **98**; `apps/client` 475 → **506**;
`packages/client` 169 and interaction 9 unchanged. Proofs (a)–(g), (b2),
(f2) reproduced; (d) honestly reported as not separable from (a)/(c).

## 3. How the round ran

1. **Pre-brief:** Rev 0 (2026-10-18, deleted branch) recovered from its
   conversation and re-probed at `9d5a17f`; Rev 0's items 1–3 and J1–J3/J7
   had shipped in step 2's R1. Decisions came from a voice session
   (2026-10-18 evening), including extending back faces to pads (operator).
2. **One outside review of the pre-brief** (ChatGPT): one must-fix (§4.1),
   two should-fix, one optional, all taken in Rev 1.1.
3. **Kickoff with three PART comments**, the 10-18 lessons built in: exact
   titles, a "wait for all parts" instruction, the full SHA in every stage
   body, and **the four release-card templates in the review gate's body**.
4. **The review gate built the release chain itself** and linked the DEV
   finalizer to the sentinel. 10-18 §4.3's fix works; keep it.
5. **Claude's §5.1 checks** on the published SHA (§5.3 below), then the
   **outside code review**, then operator acceptance.

## 4. Findings

### 4.1 The pre-brief review's must-fix was a real bug in the spec
Rev 1 had `editKeyAction` return `null` for a repeated Delete/Ctrl+D. The
canvas navigation listener passes `e.code` to navigation without checking
modifiers, so a held Ctrl+D would have duplicated once, then strafed right
and reached the bookmark dialog. **Lesson: "ignore a repeat" must mean
consume the event and skip the action, not skip the event.** The §5.1 check
against the base confirmed the hazard: holding Ctrl+D moved the avatar
0.93 m.

### 4.2 Outside code review: APPROVE, no must-fix
Separate Claude session, read-only, 26 mutations. Carried as follow-ups
(§5.1), not a revision:
- **Should-fix:** the stale comment at `apps/client/src/app.js:477` still
  lists "teleporter delete" among the editing modes; **the Z5 wiring has no
  committed test** (four `app.js` mutations, including the 4.1 bug, pass
  all 506 tests; only the throwaway §5.1 checks catch them).
- **Nits:** `edit-modes.test.js:69` tests only `'delete'`, not an arbitrary
  string; `addBackFace` fails silently on non-indexed input (could throw);
  commit `742a605` leaves the toolbar Delete inert until step 4 (bisect
  only); Ctrl+D matches `e.key`, so a non-Latin layout still strafes, as the
  undo keys already behave.

### 4.3 Operator, DEV acceptance: placing a teleporter can't be undone
Place Teleporter is the toolbar mode, available only with Edit off, and undo
records only Edit-mode changes. Once placed, a pad's moves and deletes are
undoable. Follow-up §5.1 item 1.

### 4.4 Harness: one fresh server per run
A world server kept between runs holds the previous run's objects, so a
same-named add is refused and a check can test the old object. A base run
showed the raised-pad check passing for that reason. Start a fresh server
for each run.

## 5. Follow-ups

### 5.1 A small next round (Edit mode polish 2)
1. **Teleporter in Edit mode's Add palette** (from §4.3): a Teleporter
   button that opens the destination form, adds through the palette path and
   is recorded with `undo.registerAdd` like any add. Then retire the
   toolbar's Place Teleporter and its placement mode, so teleporters live
   entirely in Edit mode. Check pad labels and trigger rebuilds on undo and
   redo of the add.
2. **A committed guard for the key wiring** (§4.2): a source-level test in
   `apps/client` (as `import-guard` reads `app.js`) that the Edit-mode key
   listener is registered before the navigation listener and consumes the
   event before the `run` check; or commit the reviewer's lifted-listener
   harness.
3. The stale comment at `app.js:477`; the `edit-modes` arbitrary-string
   case; `addBackFace` throwing on non-indexed input.

Prototype lane or full pipeline: the operator's call. This round showed the
full pipeline is quick for a well-specified client round.

### 5.2 Operator ideas (voice session, 2026-10-18)
- **Touch controls for phones** (virtual joystick or drag-to-look): mobile
  has a fixed viewpoint today. Roadmap, not scheduled.
- **SSH on the phone** (e.g. Termius) with its own passphrase-protected key,
  revocable on its own: for routine steps such as cards; keep MAIN and PROD
  for when the operator can read carefully. Pass B reduces the need.

### 5.3 Next in sequence
- **Pass B** (connector writes, `atrium-ops` `docs/PREBRIEF-s22-pass-b.md`,
  Rev 3 + §13): check the 10-18 lessons (§4.1–§4.3 there) against it first;
  start on high effort.
- **Step 3:** models by URL, starter library, sky.
- §5.1 above, whenever there's a gap. Order is the operator's call.

### 5.4 Carried
Everything open in the 10-18 passdown §5 (a richer `add`, step 4 notes,
`Cache-Control: no-cache` for `/apps` and `/packages`, the 1b-2 and 10-16
carried items).

## 6. Recipes

### 6.1 Is this tab running edit-tweaks? (browser console)
```js
document.getElementById('tp-delete-btn') === null && !!document.getElementById('ep-history')   // true at ab32f9b8 or later
```

### 6.2 The full-pipeline kickoff that ran clean
The kickoff body (scratch, not committed) followed 10-18's with: exact
titles for every card; "wait for all PART comments, else block
needs_input"; the four release-card templates (full SHA, one call each,
block `capability` on any refusal) for the review gate's body; and a
completeness table of PART line ranges. The kickoff card `t_e824025e` and
review gate `t_fac56057` show the result.

### 6.3 Claude's headless checks (scratch, not committed)
Improves on 10-18 §5.1 item 4:
- **Bundles:** `npm i esbuild @gltf-transform/{core,extensions,view}@4.3.0
  three@0.163.0` in a scratch folder; esbuild `core` whole, `extensions`
  with core external, `view` with three and the two gltf-transform packages
  external, then rewrite `three/examples/jsm/` to
  `https://esm.sh/three@0.163.0/examples/jsm/`.
- **Browser:** Playwright from `/opt/npm-tools/node_modules/playwright`,
  Chromium at `/opt/pw-browsers`; route `https://esm.sh/**` to the bundles
  and to `three`'s own `build/three.module.js` and `examples/jsm/` files.
- **Server:** a static HTTP server over the checkout plus
  `attachSessionHandlers({ wss, world, worldOwnerUserId: 'owner' })`, every
  upgrade emitted as `('connection', ws, req, 'owner')`, world from
  `tests/fixtures/space.gltf`. **Fresh server per run** (§4.4).
- **Hooks:** `window.atriumClient` and `window.stage` (scene, camera,
  renderer, avatar); record sends by wrapping `WebSocket.prototype.send` in
  an init script; record key events with a capture-phase `window` listener
  and read `defaultPrevented` afterwards; `page.keyboard.down` twice gives
  `repeat: true`; `dynamic import('three')` and `import('@atrium/renderer-three')`
  work inside `page.evaluate` through the import map. `lamp-01` (a group)
  and `crate-01` (a named material) are the fixture's non-restorable,
  non-duplicable nodes.

### 6.4 MAIN and PROD
As used today: complete the acceptance gate, `atrium-main-approve $S &&
atrium-main-push $S`, then the teleport-rearm passdown §7.2 guarded PROD
block.
