02b5554bb9e7bccb57bc5ed1829976108abab300

# Atrium `subtree-add` — outside code review of the implementation

**Verdict: APPROVE WITH NITS** — one should-fix (visual-only, one line, in a file already in §6's list) that I'd take before the PROD deploy; no must-fix. The clone worked; every listed test file passes; my own probes against the real server and real two-tab Undo did not break any claim of the handoff.

Reviewed: `claude/subtree-add` at `02b5554b…` against base `99ed7a81` (`git diff` — 38 files, +7,612/−361; only `devtasks/` differs between the base and `main`/PROD/DEV code, as stated). Contract: `PREBRIEF-subtree-add.md` FINAL Rev 2 §4 T1–T12, §5, §6. T11/§9 out of scope.

## Findings

### S-1 — Should-fix: a hidden part that arrives in a live `add` is drawn (and clickable) in every present tab until a reload
REPRODUCED (headless DocumentView + the real `ingestNode`) and CONFIRMED IN THE SOURCE.

- `apps/client/src/app.js:1083–1094` (the `som:add` handler) applies nothing for `visible`; `app.js:794` runs `applyVisibility` only at view creation; `app.js:3305–3310` runs `setNodeVisible` only on a `som:set` of `visible`. `packages/renderer-three/src/visibility.js:64–80`.
- `copy-paste.js:409` removes the hidden marker from the root only, by design (T6, §2.4: "hidden parts travel"); §5 promises "Duplicate and Undo keep the part hidden". The renderer test (`subtree-add-render.test.js:61`) itself says the part is hidden "once Atrium's visibility pass runs" — and nothing runs that pass after a live add.

Scenario: Paste (or Duplicate, or Undo-of-Delete) of a group with a hidden part — PROD has one (§2.5). In the pasting tab and every tab present, DocumentView builds the part's `Object3D` with `visible: true`; the SOM says hidden, the panel says "includes 1 hidden part", but the part renders and passes `visibleHits`. A later joiner sees it hidden (`applyVisibility` at load), so tabs disagree until a reload or a `visible` toggle. DEV acceptance step 4 wouldn't catch it (the commons lamp has no hidden part); PROD step 6 might, depending on which of the 9 groups is duplicated.

Probe (headless, as `subtree-add-render.test.js`):
```js
const root = som.ingestNode({ name: 'lamp', children: [
  { name: 'stand', extras: { __atrium_visible: false }, mesh: { primitives: [{ attributes: { POSITION: TRI } }] } } ] })
som.scene.addChild(root)
som.getNodeByName('stand').visible        // false
byName('stand').visible                   // true  ← printed: "view object visible right after the live add: true"
setNodeVisible(docView, som.getNodeByName('stand'), false)  // → false
```
This is pre-existing for Duplicate/Undo of a single hidden object, but this round makes hidden parts travel on purpose. Fix: in `app.js`'s `som:add` handler (which now fires once per member, T4), `if (node && docView) setNodeVisible(docView, node, node.visible !== false)` — with the same next-frame retry `selectAddedNode` uses, since model-bridge.js:807 notes the view object can appear a frame after `som:add`. Add a run-time assertion to the renderer test (the live add, no `applyVisibility`, the page's handler lifted as the pad test does).

### N-1 — Nit: STEP 2 as written leaves `better-sqlite3` unbuilt, so two e2e tests fail for anyone following it
REPRODUCED. `pnpm install --frozen-lockfile --ignore-scripts` skips the native build; `copy-objects-e2e.test.js` then fails 2 of 6 ("Could not locate the bindings file", from `createDb`), including the new group test. After `prebuild-install` in the package directory: 167/167. Worth a line in the review prompt / AGENTS.md.

### N-2 — Nit: the e2e harness's `wireUndo` doesn't wire app.js's re-captures, so (p8) is never exercised end to end
CONFIRMED IN THE SOURCE (`copy-objects-e2e.test.js:116–160`; handoff §4 item 7). My probe E2 below wires the `som:add` (root-only) and `som:remove` re-captures exactly as `app.js:1091, 2717` do and reproduces M3 through two real tabs; it passes and would be a cheap addition to the e2e file.

### N-3 — Nit: the K7/K6 paste notes name a part by its *pasted* name
CONFIRMED IN THE SOURCE: `copy-paste.js` step 1 (`chooseTreeNames`) renames members before `partLabel(d)` reads `d.name` in steps 4–5, so when a part was renamed on paste the note says "Its part “stand copy”’s behaviour referred to…". Defensible (that's the name it has here); recording it since T6 quotes the source name.

## What I checked, in the order asked

1. **T2 / M1.** Step 0 (`session.js:757–762`, `subtreeCountProblem` in `send-policy.js`) runs after the depth guard and before Ajv for any sender; it counts members/generations/primitives by array lengths only. Hostile shapes I tried: 100,000 non-object children escape step 0's count (`continue`) but Ajv's `allErrors: false` refuses at the first item in 26 ms, nothing changes, no save; a visitor's 256-member tree stops at the gate; a member named as `msg.parent` is refused by `checkNewName` ("already in use") with nothing changed; a forward ref and a dangling ref are refused before any node or material exists; the owner's 1,020-primitive tree is accepted in 58 ms. Every per-node check runs per member: S2 `source` (members, after the shape pass; the root before the gate, unchanged), `checkNewName`, ids against one `savedObjectIds()` set, `checkTransformValues`, `checkAtriumExtras`, `checkModelHost`, the behaviour count and bytes caps summed over members; `checkAddNode` once on the root walks every member (`nodeOwnProblem`) then `materialRefsProblem`. `isBlockedParent` stays on `msg.parent` (contract). Both `world.addNode` copies use `treeNameTaken`. An avatar with `children` is bounded by step 0 and refused `avatar-children` by `checkAddNode(avatar)`; nothing walks it before that. Nothing left that assumes one node.
2. **T12.** The three walks are the same pre-order with an explicit reverse-pushed stack; `material: {}` counts as given in all three (`given += 1`, `if (!m) continue`, `numbering.set`), a no-material primitive in none. Probe P-A: `{}`, no-material primitives and a cross-branch ref through the real server → three materials on the server and on a client's ingest, identity-checked with `===`; `buildDescriptor({refs:true})` on the client's copy reproduces exactly `[none, inline, inline] / [ref1, none, ref0] / [inline, ref2] / [ref2, ref0]`; the rebuilt tree round-trips through the server to a second reader with three materials; `serialize → createWorldFromDocument` keeps the sharing. The schema's `oneOf` with `required: ["ref"]` is as specified; the two files' `definitions.node` are deep-equal.
3. **T7.** `ADD_FIELDS_LEVEL = 3` in `isStaleEditor` and the hello; the client sends 3 beside `scriptRunner`; `serverAddFields` is set from the hello (integer ≥ 1 else null) and reset at the same five places `world` is (verified by grep: every `this.world =` is paired). `treesAllowed()` gates Duplicate, the hint, Copy, Paste (`destAddFields`), the undo engine (`trees`), `hasSharedMaterial` and the builder's refs. The skew tests assert R6's exact text and the hello's value.
4. **T5.** Probes on two real owner tabs with the engine wired as app.js wires it: **E2** B removes a part while A's Delete of the group is in flight (both accepted, in that order) → one `som:add` re-capture per tree message, the `som:remove` re-capture, and A's Undo restores the group **without** the part, on the server and in B. **E3** an older Move entry for a part undoes after Delete+Undo of the group (handles re-pointed by name). **E4** Redo-of-Delete after B moved a part → "changed elsewhere", group stays, redo stack cleared. **E6** Duplicate of a group → copy shares one new material among itself and none with the original; Undo removes it; Redo brings back the same names and ids. SA-L4: `epDelete` asks only when `undo.capture` fails, with `countDescendants`.
5. **T6.** One member map (`memberMap`) then one foreign map for the tree, recorded on that member's `copiedFrom.refs`; `foreignIds` filtered through `copyIdSet`; credit per member; `delete root.extras[HIDDEN_MARKER]` root only; model URLs and pad destinations resolved against the source per member; K8 one question listing every host; `renamePaste` re-chooses names only on a `structuredClone` of the prepared descriptor, ids/position/K8 untouched; the retry keeps a still-free root name (nit 2).
6. **Page glue.** `app.js` parses (`node --check`); every new import exists in `copy-paste.js`; `ipName`, `prepared.parts`, `request.originals` (passed through `structure.begin`'s `...extra`) are all defined; the paste answer branch returns before the palette retry; undo requests never hit a retry.
7. **Tests.** The T2-order test spies on `checkNewName`/`savedObjectIds`/`objectIdInUse`/`ingestNode` by replacing the SOM methods (session.js calls through `world.som.*`, so the spies see real calls); the step-0 test asserts T1's exact text where Ajv's would differ; the name test asserts `checkNewName`'s text so (p1) can't pass on the `addNode` guard. Text-only wiring tests are fragile but declared as such. One oddity: the apps/client suite shows 1 skip (the handoff attributes the one skip to the server's richer-add R7).

## What I ran (Node v22.23.4, pnpm 10.28.0)

Clone: worked (`git clone`, `git fetch origin claude/subtree-add`, checkout `02b5554b…`). `pnpm install --frozen-lockfile --ignore-scripts`: done in 1.3 s.

| Command | Result |
|---|---|
| server `subtree-add.test.js` (alone) | 30 pass, 0 fail |
| server `add-node-boundaries.test.js` | 74 pass |
| server `add-node-vectors.test.js` | 153 pass |
| protocol `subtree-add-schema.test.js` | 14 pass (whole protocol suite: 155) |
| som `subtree-add-ingest.test.js` | 14 pass (whole som suite: 297) |
| client `add-spec`, `subtree-add-hello`, `subtree-add-client`, `copy-objects-e2e` | **165/167 before** rebuilding `better-sqlite3` (both failures the native binding, N-1); **167/167 after** (whole packages/client suite: 753) |
| renderer `subtree-add-render.test.js` | 4 pass |
| apps/client `subtree-add-duplicate/-undo/-wiring/-paste`, `copy-objects-wiring` | 81 pass (whole apps/client suite: 1,644 pass, 1 skip, 0 fail) |
| server `richer-add`, `copy-objects`, `behavior-leaf`, `world-total` (changed files, each alone) | 9, 8, 30, 13 pass |
| my probes: server P-A, P-B1–B4; two-tab Undo E2, E3, E4, E6; renderer hidden-part | all pass (P-B/E as expected; the renderer probe shows S-1) |

Not run: anything in a browser; DEV/PROD; the fresh agent's `t12-*.mjs` scripts; `message-depth-measure.test.js`; the full server suite beyond the files above. I'm not reporting those as passing. The probe files were kept out of the repo; nothing was pushed or committed.