<!-- Outside review (Claude, runtime: cloned, ran the named tests and two probes) of PREBRIEF-copy-objects.md DRAFT Rev 1.2 at 2746d663.
     Pasted by the operator on 2026-11-06 evening. -->

# Outside review: `PREBRIEF-copy-objects.md` DRAFT Rev 1.2

**Reviewed commit:** `2746d6634db08501273f3bf68faf77aeda021e2f`
**Code commit the line numbers refer to:** `f286d283ac1cd6a8520192533c5bb6faaf177bba` (verified: the two differ only in `devtasks/PREBRIEF-copy-objects.md`, `devtasks/PREBRIEF-richer-add-copy.md` and `docs/DESIGN-phase3-placement-scripting.md`, so every `file:line` below is at both).
**Reviewer:** Claude (Anthropic), 2026-11-06. Read-only: nothing pushed, no PR, no deployed site touched; the one local edit (the K0 fix, to see the probe flip) was reverted and the tree is clean.

## Verdict: CHANGES REQUESTED

The design is close. K0 is real and the one-line fix works (reproduced both ways). The credit, the Inspect mode and the URL rule are sound in shape. Three things must change before the brief is written:

1. **K2 and K5 contradict each other** on a malformed credit: Copy refuses the object before K2's "replace as if absent" can ever run.
2. **K7's `destIds` is incomplete and its file list is short:** the Redo stack restores objects with their old ids, and `edit-undo.js` (not in §6) exposes no ids at all, so the worker will have to stop and ask on commit 3.
3. **CP-L5 (c)'s "what it doesn't cover" paragraph is wrong as written.** The case it names cannot happen in one tab; the real residual (another tab's Undo/Redo stacks) is not named. The operator's decision rests on this reasoning, so the text has to be right. The reasoning itself mostly holds, with the correction below, and the review also finds that (c) buys nothing over (a1) in this round — see finding 3.

Everything else is should-fix or nit.

---

## Where I spent the time, in the order asked

### 1. CP-L5 (c), the behaviour rule

**The reasoning tested.** "A foreign id reaches nothing in another world and only matches one of yours on purpose." I checked every way an id can enter a world:

| Path | Fresh id? | Evidence |
|---|---|---|
| palette / pad / model / library `add` | yes (`withNewObjectId`) | `object-identity.js` L33–40 |
| Duplicate | yes | `edit-duplicate.js` L408–411 |
| Paste (K6 step 3) | yes | by design |
| **Undo of a delete** | **no — the old id** | `edit-duplicate.js` L406–407 ("a restore brings back the same object"), `edit-undo.js` L703–707 |
| **Redo of an undone add** | **no — the old id** | `edit-undo.js` L696–701 re-adds `entry.descriptor`, which carries `extras.atrium.objectId` |
| healing at load | yes (random, for missing/duplicated ids) | `world.js` L338ff |
| world template, commons seed | none | no `objectId` in `home-world.js` or `commons.js` (grep) |
| `send` of `extras.atrium.objectId` | set-once, owner's own client, random in practice | `send-policy.js` L423–490 |
| avatars | **cannot carry one**: `extras.atrium` must be exactly `{ ephemeral: true }` | `session.js` L222 |
| a hostile source object whose own id equals one of yours | harmless: `remapBehaviorTargets` turns every reference to it into a self-reference | `edit-duplicate.js` L362–373 |

So within one tab the claim holds **provided `destIds` includes both stacks**. The pre-brief says "the Undo stack's entries can restore" — Redo must be named (K7, §5).

**What a kept reference to nothing does.** Stronger than "inert": the runner **refuses to load a behaviour whose `nodeMap[i]` (i ≥ 1) doesn't resolve** (`runner.js` L361–366, `behaviour disabled — nodeMap[i] does not resolve`). `targets` entries that don't resolve are consulted only by `isGranted` (L283) and `animations[].object` only at enqueue, where an unresolved target is dropped with a log (L554–559). Custom events are per-engine. No reads, no events, no animations reach anything. Enabling such a behaviour flips `enabled: true` in the stored value and the runner then disables it at load with a log line the owner never sees — see finding 4.

**Is "matches" checked against the right set at the right time?** This tab's SOM plus this tab's Undo *and Redo* stacks is the right set for this tab. The real gaps:

- **Another tab's stacks.** Tab 2 deletes X (X enters tab 2's undo stack; tab 1's SOM drops X on `som:remove`, and tab 1's stack never had it). Tab 1 pastes a hostile behaviour aimed at X: no match, kept. Tab 2 presses Undo: X is back, and the kept reference now names it. This is the case §3's paragraph should state. The case it does state — "a restore of an object deleted *after* the paste" — cannot happen: an object present at paste time was in the SOM and was replaced.
- **A future import that keeps ids** (design §6 items 1–2, "export and import as files"). If import ever carries `objectId` through, a shared file becomes a way to plant ids. Worth a one-line rule now: import stamps fresh ids, as paste does.

**Does (c) gain anything over (a1)?** I could not find a user-visible difference in this round. For a template, the form shows "Choose a target…" whether the held id is a kept foreign id or a fresh one (`behavior-form.js` L928–933): neither is pickable. For a custom graph there is no re-aiming at all (`renderParams` returns for `state.custom`, L907–911; Enabled and Remove only, L704–711), and the runner won't load it while any `nodeMap` entry is foreign. A later paste of the referenced object gives it a fresh id, so the kept reference never reconnects. The "record" survives only in the JSON. Meanwhile (c) costs: a `destIds` set, a new accessor on the undo engine, the tab gap above, and proof (p1b). The operator decided (c) and the review's job is to test the reasoning, not reopen it — but the pre-brief should say plainly that the kept ids have no use until a rebinding round exists, so the decision is made with that in hand.

**Mechanics confirmed (REPRODUCED).** Replacing an id in place at every site (`nodeMap`, `targets`, `animations[].object`, `template.params.target`) with one fresh id passes `behaviorCheck` with the copy's id and `matchesTemplate` still returns true (probe `k7-replace.mjs`, output in the appendix).

### 2. K0, the missing cap

**REPRODUCED.** A legitimate world `add` of 1,184,577 bytes (1.13 MiB, a 45,000-vertex primitive that passes `add.client.json` and add-check's shape rules) through `createWorldHost` on today's code: **accepted, stored and broadcast**, socket still open. The same message through `createSessionServer`: closed with 1009, world unchanged. With `maxPayload: 1048576` added to `world-host.js` L46 (locally, then reverted), the host path closes with 1009 and stores nothing. Probe and output in the appendix.

**Is it the whole fix?** For sessions, yes: `createWorldHost` is the only `WebSocketServer` on the registry path (`world-registry.js` L624, L669 both call it). One other socket has no cap: the **refusal `WebSocketServer`** (`world-registry.js` L67), which completes the upgrade, sends `WORLD_UNAVAILABLE`, calls `close(1008)` and terminates after 5 s (L81–87). `ws` keeps parsing inbound frames until the close handshake completes, so a client can push up to the 100 MiB default into that receiver for 5 s per refused upgrade. Bounded by the timer, so a nit — but it's the same one-option fix and the brief should say it was considered.

**What breaks when it lands.** Nothing I can find. The largest legitimate inbound messages: a Duplicate or Undo `add`, bounded by the client at 1,000,000 bytes measured on an envelope with a 16-digit `seq` (`edit-duplicate.js` L292–295; the real envelope at `AtriumClient.js` L1260–1264 is the same shape), 48,576 bytes under the cap; a behaviour `send` ≤ 65,536 + envelope; an avatar `add` ≤ 1,024 vertices. Outbound (`som-dump`) is unaffected: `maxPayload` is inbound only. `ws`'s server default `perMessageDeflate` is off, so the cap is on the bytes sent. Caddy's `reverse_proxy` passes a WebSocket as a byte stream after the upgrade and has no per-message limit (INFERRED from Caddy's design; the operator's check stands).

### 3. K1–K3, the credit

- **`additionalProperties: false`** is at the top of `hello.server.json` (L51). Older clients don't validate inbound messages (no `validate(` anywhere in `packages/client/src` or `apps/client/src`), so `world` reaches them harmlessly — CONFIRMED. Server tests do validate the hello (`script-host.test.js` L127–139, `edit-plumbing.test.js` L390), so schema and server must land in one commit, as §6's commit 2 says. A newer client on an older server gets no `world` → `null` → `{ server, at }` only. Fine.
- **Test worlds with `db: null`:** `owner: { id: 'user-a' }` without `name` — K1 allows it. Fine. The hello handler's existing lookup (`session.js` L778–792) is by `upgradeUserId`; K1 needs a second query by `worldOwnerUserId` per hello. Cheap, but say so.
- **Hostile server's values — finding 5:** K2 bounds `creatorName` by length only (1–256), and K1's client check drops the *whole* `client.world` when any field fails. Real usernames are at most 64 characters with whitespace runs collapsed and nothing else forbidden (`auth.js` L93–95), so control characters and bidi overrides are legal in a username today. `textContent` stops HTML, not U+202E or a newline in "Made by <name>, it says".
- **K2's table and fill order:** consistent. One wording slip: `copiedFrom` "replaced by each copy", but a Duplicate (a copy) keeps it (§2.1) — say "each paste".
- **Server check vs client mirror disagreeing:** they can't on form if both read the vectors file. They disagree on *order* — finding 1.

### 4. K6–K8, paste

- **Snapshot:** `buildDescriptor` holds no live object (`structuredClone` and `Array.from`, L264–265, L195–197) — CONFIRMED. Export needed — in §6.
- **Which `extras` survive:** K6's `extras.atrium` key list (`objectId`, `teleporter`, `model`, `animation`, `behavior`, `origin`, `copiedFrom`) is complete for node-level keys the code reads (grep over the four packages: the others are `source`, refused at Copy; `ephemeral`, avatars; `background`/`navigation`/`name`/…, root-level). But **keys *inside* `teleporter` are unchecked** by the server (`checkAtriumExtras` L173–180 looks only at `destination`) and by the client (`atriumProblem` L111–116) — finding 7.
- **URL resolution — models:** `resolveModelUrl(url, source.baseUrl)` keeps the result on the source's origin (L135) and an `http:` base yields `url-scheme` from `modelUrlProblem` (L85–100) — CONFIRMED. `resolveModelUrl` can also answer `no-base` (L125–135), which is not a `modelUrlProblem` code — finding 8.
- **URL resolution — pads:** `resolveWorldAddress` resolves **slash-less** relative paths too (`wsUrl.js` L197: `trimmed.startsWith('/') ? trimmed.slice(1) : trimmed`), and `isValidDestination` accepts `worlds/<user>/<slug>` without the slash (L236–241). K8's "a path `teleporter.destination`" must mean "anything that is not `""` and does not start with `ws://`/`wss://`" — finding 6.
- **Refusal and no-answer paths:** the generic branch has no `unknown` text and retries only `request.primitive` (`app.js` L2871–2878) — CONFIRMED; K6's own branch is right. The tracker takes any `kind` with extras (`edit-structure.js` L94–96), so `request.paste` needs no tracker change.
- **Size after credit:** K6 step 8 measures after step 7. Fine.
- **The "Library" rule across servers:** a library crate placed in A, copied to B on another server, resolves to `https://a.example/assets/library/crate.glb`, fails the "destination's own origin" test, and is credited to A's owner by rule 3. Correct by CR-S7 and worth one sentence in K2 so nobody reads it as a bug. Test "under `/assets/library/`" on the resolved `pathname` (`..` is normalised by `new URL`).

### 5. K4, Inspect

- Hidden objects: `pickEditTarget` passes `includeHidden: true` (`app.js` L2138); Inspect's `false` is the one change. `isEditExcluded` drops avatars, `resolveSelectionRoot` lifts a child to its group root (L2142–2148), whose Duplicate reason is `children` — the panel shows why. CONFIRMED.
- `activate`: the click decision is `app.js` wiring over `activate-click.js`'s pure parts; the Inspect gate is an `app.js` change. In §6.
- Pointer lock: `edit-modes.js` L14 `usePointerLock = pref && !edit`; Inspect joins the `!edit` term. In §6.
- Other users' text: names, credit, graph labels via `textContent` — fine; see finding 5 for what `textContent` doesn't stop.
- Leave condition — nit 11: the gate is `canEditNow()` (`canEdit && avatarReady && connected`, L1582–1584); an owner whose avatar isn't ready yet sees Inspect offered, and "`canEdit` turning true" never fires for them because it already is.

### 6. §5's tests, proofs, §6's files

- §6 lacks **`apps/client/src/edit-undo.js`** (finding 2). The engine exposes counts, bytes and labels only (L747–774); K7 needs the restorable ids of both stacks.
- §5's two-world end-to-end test imports across packages by relative path; precedent exists (`edit-e2e.test.js` L9 imports `AtriumClient`; `richer-add-restore.test.js` imports the server). Feasible.
- §5 has no test for "leaving the world, or the world's `canEdit` turning true, leaves Inspect" (K4) — add it to the Inspect wiring list.
- §5 should add: a paste of a copy whose source node had **no own id** is refused (nit 10 shows Copy lets it through); the Redo case (an undone add whose id the source aimed at is replaced); and `teleporter` extra keys dropped (finding 7).
- Proofs (p1)–(p5) are sound. (p1b) exists only to keep (c) from collapsing into (a1); if finding 3's note changes the decision, it goes.

---

## Findings

Severity: **must-fix** / **should-fix** / **nit**. Evidence: REPRODUCED (ran it), CONFIRMED IN THE SOURCE, INFERRED.

### F1 — must-fix — K2 and K5 contradict each other on a malformed credit
`apps/client/src/edit-duplicate.js:330–331` (`duplicateRuleProblem` calls `atriumProblem`), `:101–127`; pre-brief K2 ("An existing `origin` or `copiedFrom` that fails K3 is replaced as if absent, and the paste's notes say so"), K3 ("the client's `atriumProblem` gives the same verdict, so a Duplicate or Undo of a malformed legacy credit is refused"), K5 ("`copyObject` runs `duplicateRuleProblem`").
**Scenario:** a source object carries `origin: { server: "atrium.example" }` (not an origin). Per K3, `atriumProblem` now refuses it. Per K5, Copy runs `duplicateRuleProblem` → `atriumProblem` → `deny('atrium', …)`: the Inspect panel says it can't be copied. K2's replacement never runs; its sentence and §5's test ("a malformed existing credit is replaced and noted") are dead.
**Fix:** pick one. Either (a) `copyObject` checks everything *except* the credit at Copy (an `atriumProblem` option, or a credit-free check), and K6 step 7 replaces and notes, then step 8's `atriumProblem` sees a valid one; or (b) delete K2's replacement clause and §5's test, and let Inspect show K3's reason. (a) matches the stated intent (a hostile or newer server's credit shouldn't block a copy). Also state what Duplicate and Undo do with such an object in its own world: refused, as K3 says — acceptable, since nothing writes one today.
**Evidence:** CONFIRMED IN THE SOURCE.

### F2 — must-fix — K7's `destIds` omits the Redo stack, and `edit-undo.js` exposes no ids and is not in §6
`apps/client/src/edit-undo.js:696–701` (redo of an add re-sends `entry.descriptor`, which carries the stored `objectId`), `:703–707` (undo of a delete, same), `:747–774` (the public surface: counts, bytes, labels — no descriptors); pre-brief K7 ("every one the Undo stack's entries can restore"), §6 files ("No other file; if one must change, stop and ask").
**Scenario:** the owner adds X, presses Undo (X is now on the *redo* stack), pastes a hostile object aimed at X's id (not in the SOM, not in the undo stack → kept), presses Redo: X is back under the id the pasted behaviour names. Enable the template — one click, no question — and it writes to X. Separately, the worker reaches commit 3, finds no way to read ids out of the undo engine, and must stop.
**Fix:** K7: "every id the Undo *or Redo* stack can bring back." §6: add `apps/client/src/edit-undo.js` (one getter, e.g. `restorableIds`, over both stacks' `descriptor.extras.atrium.objectId`). §5: a Redo case beside the Undo one.
**Evidence:** CONFIRMED IN THE SOURCE.

### F3 — must-fix — CP-L5's "what it doesn't cover" names an impossible case and misses the real one
Pre-brief §3 CP-L5 (c), "What it doesn't cover": "the remaining case is a restore of an object deleted after the paste whose id the source had aimed at."
**Why it's wrong:** an object that exists at paste time is in the SOM, so its id is in `destIds` and is replaced; deleting and restoring it afterwards restores an object nothing names. The residual cases are: (1) **another tab of the owner's** — its Undo/Redo stacks hold ids this tab's SOM and stacks don't (`edit-undo.js` records only this tab's own requests, L297–316; `som:remove` from another tab drops the node here with nothing recorded); (2) **any future path that imports objects with their ids** (design §6 items 1–2). Neither is closed by (c); both are closed by (a1).
**And the value claim:** "in the friendly case, everything" is kept, but nothing kept can be used: the runner won't load a behaviour with a foreign `nodeMap` entry (`runner.js:361–366`), a template shows "Choose a target…" for a kept id exactly as for a fresh one (`behavior-form.js:928–933`), a custom graph has no re-aim UI at all (`:907–911`), and a later paste of the referenced object gets a fresh id, so the reference never reconnects. The record lives only in the JSON.
**Fix:** rewrite the paragraph with the two real residuals, and state that the kept ids have no use until a rebinding round exists. The operator can then keep (c) knowingly or take (a1), which removes `destIds`, the undo accessor, the tab gap, proof (p1b) and F2 at no functional cost in this round. If (c) stays: the multi-tab sentence, and a line that import must stamp fresh ids.
**Evidence:** CONFIRMED IN THE SOURCE (runner, form, undo); the tab scenario INFERRED from the engine's structure.

### F4 — should-fix — "inert" understates it: a kept foreign `nodeMap` id makes the whole behaviour un-runnable, and the owner can't tell
`packages/behaviors/src/runner.js:361–366`; `apps/client/src/behavior-form.js:718–738` (`setEnabled` rewrites `enabled` and sends); pre-brief K7 ("A reference to an object the destination doesn't have is inert"), CP-L5 ("the owner can re-aim it").
**Scenario:** a pasted *custom* graph with `nodeMap: [own, foreign]`. The owner presses Enabled; `shouldPromptEnable` may ask, naming "an object not in this world"; they accept; the stored value says `enabled: true`; the runner logs `behaviour disabled — nodeMap[1] does not resolve` and loads nothing. The panel says Enabled. Nothing runs, and there is no UI to fix it (custom graphs have Enabled and Remove only).
**Fix:** in K7 and the paste note, say that a behaviour referring to objects not in this world **will not run until re-aimed, and a custom graph can't be re-aimed** — or have `preparePaste` drop a custom graph whose `nodeMap` has a foreign entry (GR's (a2), for custom graphs only), keeping (c) for templates where re-aiming exists. Either way the Inspect summary should flag it before the copy.
**Evidence:** CONFIRMED IN THE SOURCE.

### F5 — should-fix — K2's `creatorName` and K1's name have no character rule, and one bad field nulls the whole `client.world`
`packages/server/src/auth.js:93–95` (`normalizeUsername`: trim, collapse whitespace, `slice(0, 64)` — nothing else refused); pre-brief K1 ("keeps `client.world` only if every value is a string in K2's form and length, else `null`"), K2 (`creatorName`: "1–256 characters").
**Scenario (hostile server):** `hello.world.owner.name` is `"admin‮ (verified)"` or carries a newline; it passes K2's form, is stored in `origin.creatorName`, and the Inspect panel's "Made by admin‮ (verified), it says" renders through `textContent` with the bidi override live. **Scenario (friendly, but K1 as written):** the owner's own username legitimately contains a character K2 later forbids; K1 nulls `client.world`; the owner's Copy → Paste in their own world is now "another world" (K7 case 2): disabled, grants defused. Duplicate behaves differently from Copy/Paste in the same world for that owner.
**Fix:** K2: `creatorName` ≤ 64 (the real max), no character matching `BEHAVIOR_PROSE_CTRL_RE` plus the bidi controls (U+202A–U+202E, U+2066–U+2069), as prose elsewhere is bounded; the same rule for the `name` K1's client check applies. K1: drop the failing *field*, not the object (as K2 rule 3 already does for the paste), so `world.id` survives a bad `name`. Add the vectors.
**Evidence:** CONFIRMED IN THE SOURCE.

### F6 — should-fix — K8's "path" pad must cover slash-less relative destinations
`apps/client/src/wsUrl.js:197` (`resolveWorldAddress` resolves `worlds/alice/garden` against the origin too), `:236–241` (`isValidDestination` accepts it, "leading slash optional"); `packages/server/src/send-policy.js:140–147` (the server accepts any string ≤ 2,048).
**Scenario:** a pad on server A stored as `worlds/alice/garden` (legal through the pad form). K8 says "a path destination becomes `resolveWorldAddress(destination, source.wsUrl)`"; if "path" is read as "starts with `/`", this one is "kept as it is" and, pasted on server B, leads to B's `alice/garden` or nowhere — the exact failure CP-L6 exists to prevent. A hostile `http://…` destination is a third shape (`resolveWorldAddress` → `null`).
**Fix:** K8: three cases, exhaustively — `""` kept; `ws://`/`wss://` kept; **everything else** resolved against `source.wsUrl`, refused when the result is `null` or over 2,048.
**Evidence:** CONFIRMED IN THE SOURCE.

### F7 — should-fix — unknown keys inside `extras.atrium.teleporter` are neither checked nor dropped
`packages/server/src/send-policy.js:173–180` (only `destination` is examined); `apps/client/src/edit-duplicate.js:111–116` (same); pre-brief K6 step 4 ("any other [key] is dropped … so a hostile world can't plant a key a later round gives meaning to").
**Scenario:** a hostile world's pad carries `teleporter: { destination: "/", arm: "…", … }`. K6 drops unknown keys at the `atrium` level only; the planted key rides through the paste, the server's check and the save, and waits for a round that reads it. `model` and `behavior` are key-exact already (`checkModelValue`; `BEHAVIOR_KEYS`, `behavior-spec.js:87–89`).
**Fix:** K6 step 4: the kept `teleporter` is exactly `{ destination }`. One line, one test.
**Evidence:** CONFIRMED IN THE SOURCE.

### F8 — should-fix — K8's model refusal names reasons `resolveModelUrl` doesn't produce, and misses one it does
`packages/client/src/model-spec.js:123–137` (`resolveModelUrl` answers `{ ok: false, reason: 'no-base' }` for an empty, unparsable or cross-origin base; `modelUrlProblem` is what yields `url-scheme`/`url-length`); pre-brief K8 ("the result must pass `modelUrlProblem`; otherwise the paste is refused with that reason's text (`modelReasonText`)").
**Scenario:** `source.baseUrl` came from the File box (`app.js:1395–1398`, `shouldUseFileBase`) and is a page-relative `http://localhost:5173/worlds/x/` while the world was `ws://localhost:3000`: `resolveModelUrl` resolves `/crate.glb` onto the *page's* origin, not the source server's. The loopback exception in `shouldUseFileBase` (`wsUrl.js:268–273`) makes this a DEV-only path, but it's exactly the "source base from a field the object carries" class GR2-S4 warned about, with the File box as the field.
**Fix:** K5: `source.baseUrl` is `wsOriginToHttpOrigin(source.wsUrl)` — the live connection's origin, never `client.worldBaseUrl` (which the File box can override). K8: name `no-base` (refuse with a plain sentence), then `modelUrlProblem`'s codes.
**Evidence:** CONFIRMED IN THE SOURCE.

### F9 — nit — the refusal socket has no `maxPayload` either
`packages/server/src/world-registry.js:67` (`new WebSocketServer({ noServer: true })`), `:81–87` (close 1008, terminate after 5 s).
**Scenario:** a client hammers a refused address and streams large frames into each refusal socket for its 5 s. Bounded by the timer; memory only.
**Fix:** the same option on L67, in K0's commit, or a sentence saying it was weighed and left.
**Evidence:** CONFIRMED IN THE SOURCE.

### F10 — nit — K7's parenthetical is wrong: Copy's `atriumProblem` does pass a behaviour whose node has no own id
`apps/client/src/edit-duplicate.js:122–125` (`behaviorCheck(atrium.behavior, { ownId: atrium.objectId })`), `packages/behaviors/src/behavior-spec.js:780` (`ownId !== undefined &&` — the `nodeMap[0]` check is skipped when the node has no id), `edit-duplicate.js:363` (`remapBehaviorTargets` returns the input when `fromId` is falsy); pre-brief K7 ("if it doesn't [pass], the paste is refused (it can't be a legacy value: Copy ran `atriumProblem`)").
**Scenario:** a hostile server's `som-dump` holds a node with a behaviour and no `objectId` (a real Atrium server heals that at load, `world.js:338`; a hostile one needn't). Copy passes; paste's `behaviorCheck(…, { ownId: copyId })` fails `behavior-map` because `nodeMap[0]` is still the source's entry.
**REPRODUCED** (`k7-replace.mjs`, last line: Copy-style check `null`, paste-style check `behavior-map`). The refusal path exists, so this is wording: say "Copy accepts a node with a behaviour and no own id; paste refuses it" and add the vector.

### F11 — nit — K4's leave condition should be `canEditNow()`, not `canEdit`
`apps/client/src/app.js:1582–1584`. An owner whose avatar isn't ready yet has `canEdit` true and `canEditNow()` false; Inspect is offered (K4: "when `canEditNow()` is false") and "the world's `canEdit` turning true" never happens. Use the same gate both ways.
**Evidence:** CONFIRMED IN THE SOURCE.

### F12 — nit — `source.origin` and the same-origin tests should be `new URL(...).origin`
Pre-brief K5/K7/K8 compare origins as strings. `AtriumClient.wsOriginToHttpOrigin` (L251–263) parses and rebuilds, which normalises default ports; say the comparison is on `new URL(x).origin` on both sides so `wss://h:443` and `wss://h` are one origin.
**Evidence:** INFERRED.

### F13 — nit — wording
- K2: `copiedFrom` "replaced by each copy" → "each paste" (Duplicate keeps it, §2.1).
- K2/K8: say once that a library item copied *across* servers is credited to the source world's owner by rule 3 (CR-S7's rule, correct, surprising).
- K7: "`nodeMap` (from entry 1)" — also say entry 0 is the copy's id after `remapBehaviorTargets`, so a hostile source whose own id equals one of yours becomes a self-reference, not a grant.
- §5: add the Inspect leave test, the Redo case, the no-own-id case, the teleporter-keys case.

---

## What I ran

Clone worked (`git clone`, then `git fetch --depth 1` of both pinned SHAs; checked out `2746d66`). Node v22.23.4, pnpm 10.28.0. `pnpm install --frozen-lockfile --ignore-scripts`: clean.

| Command | Result |
|---|---|
| `packages/server`: `timeout 180 node --test test/payload-cap.test.js` | 2/2 pass |
| `packages/server`: `timeout 180 node --test test/script-host.test.js` | 11/11 pass |
| `apps/client`: `node --test tests/edit-duplicate.test.js tests/behavior-form.test.js` | 89/89 pass |
| probe `k0-worldhost.mjs` on today's code | host path: **accepted and stored**; session-server path: 1009 |
| probe `k0-worldhost.mjs` with `maxPayload: 1048576` on `world-host.js` L46 (local, reverted) | host path: 1009, world unchanged |
| probe `k7-replace.mjs` | in-place replacement passes `behaviorCheck` and `matchesTemplate`; no-own-id case passes Copy's check and fails paste's |

**Not run:** the full suites (not asked; the four named files only); the app in a browser; anything against DEV or PROD; Caddy's WebSocket handling (INFERRED). Nothing reported above as passing was unrun.

---

## Appendix — probes

### `k0-worldhost.mjs` (output on today's code)

```
createWorldHost (PROD path): sent 1,184,577 bytes (1.13 MiB)
  close code after 2.5 s: null   nodes before/after: 5/6   stored: true
  server answer: add broadcast (seq 5)   (2523 ms)
createSessionServer (tested path): sent 1,184,577 bytes (1.13 MiB)
  close code after 2.5 s: 1009   nodes before/after: 5/5   stored: false
  server answer: none   (2506 ms)
```

With `maxPayload: 1048576` on `world-host.js` L46:

```
createWorldHost (PROD path): sent 1,184,577 bytes (1.13 MiB)
  close code after 2.5 s: 1009   nodes before/after: 5/5   stored: false
  server answer: none   (2518 ms)
```

```js
// K0 probe — does a message over 1 MiB get through createWorldHost (PROD's path)?
// Real HTTP server on port 0, real world, the host's own handleUpgrade, no mocks.
import { createServer } from 'node:http'
import WebSocket from '<repo>/packages/server/node_modules/ws/index.js'
import { createWorld } from '<repo>/packages/server/src/world.js'
import { createWorldHost } from '<repo>/packages/server/src/world-host.js'
import { createSessionServer } from '<repo>/packages/server/src/session.js'

const SPACE = '<repo>/tests/fixtures/space.gltf'
const MiB = 1048576
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

/** A legitimate world `add` (passes add.client.json and add-check's shape rules) of `vertices` vertices. */
function bigAdd(vertices, seq) {
  const pos = new Array(vertices * 3)
  for (let i = 0; i < pos.length; i++) pos[i] = Math.round((i % 97) * 0.0103 * 1e4) / 1e4
  const idx = []
  for (let i = 0; i + 2 < vertices; i += 3) idx.push(i, i + 1, i + 2)
  return JSON.stringify({ type: 'add', seq, node: { name: `probe-${seq}`, translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1],
    mesh: { primitives: [{ attributes: { POSITION: pos }, indices: idx }] } } })
}

async function run(label, start) {
  const world = await createWorld(SPACE)
  const http = createServer()
  await new Promise((r) => http.listen(0, '127.0.0.1', r))
  const stop = start(http, world)
  const ws = new WebSocket(`ws://127.0.0.1:${http.address().port}/`)
  const got = []
  ws.on('message', (raw) => { try { got.push(JSON.parse(raw)) } catch {} })
  let closeCode = null
  ws.on('close', (c) => { closeCode = c })
  await new Promise((r) => ws.once('open', r))
  ws.send(JSON.stringify({ type: 'hello', id: 'probe-' + Math.random().toString(36).slice(2, 8), capabilities: { tick: { interval: 5000 } } }))
  while (!got.some((m) => m.type === 'hello')) await delay(10)
  const msg = bigAdd(45_000, 7)
  const bytes = Buffer.byteLength(msg)
  const before = world.som.nodes.length
  ws.send(msg)
  await delay(2500)
  const answer = got.find((m) => (m.type === 'add' && m.node?.name === 'probe-7') || (m.type === 'error' && m.seq === 7))
  console.log(`${label}: sent ${bytes.toLocaleString()} bytes (${(bytes / MiB).toFixed(2)} MiB)`)
  console.log(`  close code after 2.5 s: ${closeCode}   nodes before/after: ${before}/${world.som.nodes.length}   stored: ${world.som.getNodeByName('probe-7') !== null}`)
  console.log(`  server answer: ${answer ? (answer.type === 'add' ? `add broadcast (seq ${answer.seq})` : `${answer.code}: ${answer.message}`) : 'none'}`)
  try { ws.close() } catch {}
  await stop()
  http.close()
}

await run('createWorldHost (PROD path)', (http, world) => {
  const host = createWorldHost({ id: 'probe', world, db: null, ownerUserId: null })
  http.on('upgrade', (req, socket, head) => host.handleUpgrade(req, socket, head, null, null))
  return async () => host.close()
})
await run('createSessionServer (tested path)', (http, world) => {
  const server = createSessionServer({ httpServer: http, world, db: null })
  return async () => server.close()
})
process.exit(0)
```

(The `ownerUserId: null` host is `open`, so an anonymous session may add — the point is the transport, not the gate. The §6 test should use an owned world and an owner session, as `payload-cap.test.js` does for the session-server path.)

### `k7-replace.mjs` (output)

```
source nodeMap 2 targets [ 'b7299db7-…' ] check: null
pasted check with copy id: null | matchesTemplate: true
nodeMap[1] replaced: true | targets: [ 'a466a4f7-…' ] | params.target replaced: true
no own id: remap returns input unchanged: true | atriumProblem-style check (ownId undefined): null | paste check with copy id: behavior-map
```

```js
import { templateGraph } from '<repo>/packages/behaviors/src/templates.js'
import { behaviorCheck } from '<repo>/packages/behaviors/src/behavior-spec.js'
import { remapBehaviorTargets } from '<repo>/apps/client/src/edit-duplicate.js'
import { matchesTemplate } from '<repo>/apps/client/src/behavior-form.js'
import { newObjectId } from '<repo>/packages/client/src/object-id.js'

const A = newObjectId(), X = newObjectId()          // source object A, aimed at X
const src = { ...templateGraph('select-visibility', { target: X, action: 'toggle' }, { ownId: A }), enabled: true, origin: 'local', kind: 'graph' }
console.log('source nodeMap', src.nodeMap.length, 'targets', src.targets, 'check:', behaviorCheck(src, { ownId: A }).problem)

const A2 = newObjectId(), X2 = newObjectId()        // the copy's id; X's replacement (X "matched" the destination)
const step1 = remapBehaviorTargets(src, A, A2)
const swap = (id) => (id === X ? X2 : id)
const pasted = { ...step1, enabled: false, nodeMap: step1.nodeMap.map(swap), targets: step1.targets.map(swap),
  animations: step1.animations.map((e) => ({ ...e, object: swap(e.object) })),
  template: { ...step1.template, params: { ...step1.template.params, target: swap(step1.template.params.target) } } }
console.log('pasted check with copy id:', behaviorCheck(pasted, { ownId: A2 }).problem, '| matchesTemplate:', matchesTemplate(pasted, A2))
console.log('nodeMap[1] replaced:', pasted.nodeMap[1] === X2, '| targets:', pasted.targets, '| params.target replaced:', pasted.template.params.target === X2)

// F10 — a source node with NO own id: Copy's check (ownId undefined) passes, paste's (ownId = copy's) fails
const noOwn = remapBehaviorTargets(src, undefined, A2)
console.log('no own id: remap returns input unchanged:', noOwn === src, '| atriumProblem-style check (ownId undefined):', behaviorCheck(src, { ownId: undefined }).problem, '| paste check with copy id:', behaviorCheck(src, { ownId: A2 }).problem)
```