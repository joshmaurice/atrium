# Atrium Passdown — 2026-10-18 — Phase 3 step 2: undo and redo (full pipeline; S22 accepted)

**Predecessor:** `devtasks/Atrium-Passdown-2026-10-16-edit-mode-ui-1b-2.md`.
Its host, connector and follow-up state still holds, except where this file
says otherwise.

**First instruction for the next session's Claude:**
1. Clone the repo and read `devtasks/`, newest first.
2. If the `atrium-ops` connector's tools are listed, use them for board,
   release, log and git state. It is read-only.

## 1. Status at handoff

| Item | State |
|---|---|
| Release | **COMPLETE** (2026-10-18 ~20:54 PT), checked through the connector: DEV, MAIN record and PROD at `c2b8301de6c75ab2127f0e614265d67b0b1acdf1`, both healthy, deploy lock free, nothing blocked on the board |
| Base | `b27c3ff` (`main` with the pre-brief uploaded) |
| Spec | `devtasks/PREBRIEF-undo-redo.md`, FINAL Rev 4 (three outside reviews of the pre-brief, §12) |
| Lane | **full pipeline** (W1), so that this round was S22's acceptance test |
| **S22** | **Accepted by this round:** publish (on the second attempt, §4.1), two DEV deploys, MAIN approve and push, PROD approve and deploy, with no other S22 message. Tell the S22 conversation; `/root/atrium-s22` (the rollback copy) can go |
| GitHub token | **Replaced** (S22 pre-brief Rev 3's recipe); the old 10-29 expiry no longer applies |
| Branches | `workflow/undo-redo`, `claude/prebrief-undo-redo`, `claude/prebrief-undo-tweaks` (§5.2): for the operator to delete when done with them |

**Board, this round:**
- kickoff `t_0df44743`; sentinel `t_c1e0c7db`; GLM brief `t_07348829` (a
  first brief card, `t_d727232f`, was a leftover of the blocked kickoff run
  and was archived); brief-review gate `t_75cf8e50`;
- implementation `t_f68f9d12`; GLM review `t_01dfbb96` (APPROVE `09da28c9`);
  review gate `t_37368cd9`;
- publish `t_89a3fd07` (refused once, §4.1), DEV deploy `t_682a4f67`, DEV
  finalizer `t_34cb9d5b`; acceptance gate `t_3943a24e` (archived: superseded
  by the revision);
- **revision R1:** DeepSeek `t_b9332d83`, GLM re-review `t_ec5fe115`
  (APPROVE `c2b8301d`), re-review gate `t_8a2303fd`, R1 sentinel
  `t_70943cd4`; publish `t_5971f493`, DEV deploy `t_e3ad5806`, finalizer
  `t_e4f5ec06`, acceptance gate `t_fe6a65ca`;
- PROD gate `t_ce7a918c`; PROD deploy `t_a0d34484`.

### 1.1 Timeline (PT)
10:31 round started · 11:31 pre-brief FINAL (three ChatGPT reviews: 9, 6 and
3 findings) · 11:34 uploaded (`b27c3ff`) · 11:40 kickoff · 11:51 brief
review · ~12:20 GLM APPROVE `09da28c9` · 12:21 review gate couldn't build
the chain (§4.3) · 12:42 chain built by the front door · 12:43 **publish
refused** (exit 66) · ~15:40 S22 fix, publish attempt 2 · 16:41 DEV · 18:27
operator DEV check (found §4.5) · 18:54 outside code review: CHANGES
REQUIRED · ~19:15 revision R1 sent · 19:51 GLM re-review APPROVE `c2b8301d`
· ~20:54 PROD.

## 2. What shipped

`apps/client` only (`edit-undo.js` new; `edit-gesture.js`,
`edit-duplicate.js`, `edit-structure.js`, `app.js`, `index.html`). No server,
protocol, SOM, `packages/client` or renderer-three change; no DEV restart.

- **Undo and Redo** in the Edit panel (their own row, visible with nothing
  selected) and on Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y (Edit mode only,
  never in a text field). Undoable: handle drags, panel fields, rename,
  palette add, Duplicate, and a delete of a node that can come back exactly.
- **Only confirmed changes are recorded;** one gesture is one entry; a
  partly refused drag records what the server accepted.
- **Identity by handles** (W2): entries survive an undone delete.
- **Every undo checks the world first** (W4): changed or removed elsewhere →
  refused with a message, entry dropped. A removal requires the node to
  match exactly what this tab left.
- **No dialog for an undoable delete** (W6, superseding design §4.1 for
  those nodes); the "can't be undone" dialog stays for the rest.
- **History survives Edit off/on;** cleared on reconnect, world change,
  reload (W7). 100 entries per stack, 16 MiB of stored descriptors (W8).
- **Two 1b-1 bugs fixed** (U16), both live before today: a tab could show a
  stale value after another owner tab's interleaved edit (with or without a
  refused send). The gesture tracker now hears other sessions' changes.

**Tests:** `apps/client` 388 → **475**; every other suite unchanged
(`packages/client` 169, renderer-three 86, interaction 9, som 224, protocol
71). Proofs (a)–(y) plus R2–R7. Claude's §7.4 checks on `c2b8301d`: **36/36**
end-to-end (real server, real clients, the modules wired as `app.js` wires
them) and **21/21** on the real page headless.

## 3. How the round ran

1. **Pre-brief:** Rev 0 from probes; three outside reviews (ChatGPT), each
   finding checked against the code, three by probe. The second and third
   reviews found the U16 bugs, which exist in 1b-1 today.
2. **Kickoff** through the front door (§4.2), GLM brief, brief gate (three
   operator corrections on the implementation card: the worktree already
   existed; no server test files for a client-only round; the brief's step
   list governs).
3. **Implementation** (DeepSeek, one card) and **GLM review: APPROVE, zero
   findings.**
4. **Release chain:** the review gate's run created no card bodies (§4.3);
   the front door created them from operator-specified bodies.
5. **Publish refused** (§4.1), fixed by the S22 conversation, retried.
6. **DEV checks:** operator in Firefox (found §4.5); Claude's §7.4 runs;
   **outside code review: CHANGES REQUIRED** (§4.4).
7. **Revision R1** (R1–R10, human-directed): DeepSeek, GLM re-review
   APPROVE; the re-review gate built the chain itself this time (§4.3).
8. Claude's checks on `c2b8301d`, operator re-check, MAIN, PROD.

## 4. Findings

### 4.1 S22: the first sandboxed publish was refused
`atrium_deploy(action="publish", …)` → exit 66, `REFUSED: the sandboxed
pack step failed`. Nothing was pushed, release state unchanged, DEV
untouched: it failed closed. The S22 conversation found a permission problem
and fixed it host-side; the guard's one-call marker was moved aside (kept as
`deploy-t_89a3fd07.attempt1-…`) and the same card retried. The second
publish (R1) went through first time. **Lesson for S22-era rounds:** a
deployer refusal is information for the S22 side, never a retry.

### 4.2 A parentless kickoff can't be held `blocked`
Created `initial_status="blocked"`, the kickoff was promoted and claimed
13 s later with 2 of 8 parts posted. It waited for the parts this time. The
front door recorded it in its skill.

### 4.3 Agents drift from exact text; the guard catches it
- The kickoff run invented two gate titles (`Operator gate: approve brief —
  …`, `Awaiting brief approval — …`); the guard refused both (a blocked
  orchestrator title may not start with "Awaiting" or contain
  "accept"/"approv"). The kickoff's exact title passed once it was used.
- The review gate's run created the release cards with no SHA in their
  bodies (guard: "found 0 distinct") and blamed the tool. The front door
  created them from explicit bodies. **For R1 the gate body carried the four
  bodies as templates, and the gate built the chain itself.** Keep doing
  that.
- **My kickoff template had a bug:** the acceptance gate's body line had
  only `<sha8>`; the guard requires the full 40-character SHA in every stage
  card's body.

### 4.4 The outside code review earned its place again
On `09da28c9` it found **M1**: the new edit block reached the buttons but
not the handles and fields (`refreshEditActions` never called
`syncGizmoEnabled`), so during an undo a drag moved the object with nothing
sent and the next real drag committed the hidden offset. It also confirmed
the known undo-rename lockup, found a stale-descriptor gap on an undo's
removal (S2) and a proof that couldn't fail ((y)). All fixed in R1.

### 4.5 Operator DEV check: Undo vanished after a delete
The buttons sat inside `#ep-fields`, hidden with no selection, which is
exactly the moment after a delete. The headless run used the keys there and
missed it. Fixed in R1 (own row). **Lesson:** a headless check of a button
must check it is visible, not only enabled.

### 4.6 Legacy content can't be restored after a delete
`space.gltf`'s `ground-plane` and `crate-01` fail only because their
**material has a name**, which `add` can't carry; `lamp-01` has a child. So
a delete there shows "can't be undone". This is content, not origin: a
cloned world keeps palette objects undoable and other content not. See §5.1
item 1.

## 5. Follow-ups

### 5.1 From this round
1. **A richer `add`** (operator discussion, 20:42): material, mesh and
   accessor names and `extras`, emissive, alpha mode, double-sided, UVs and
   vertex colours. Undo, Duplicate and imported content would then cover
   most real objects. SOM and server, and the schema under AGENTS rule 1,
   so a pipeline round. Textures stay out of `add` (models by URL, step 3);
   children (subtree `add`), lights/cameras and animation are separate,
   larger rounds. **Not needed by step 3** (placed models are a node plus
   an `extras.atrium.model` reference, so they already round-trip). Do it
   **before step 7 at the latest** (import and export depend on it), or
   sooner if editing legacy content matters. The same round widens
   Duplicate's and Undo's restorable rules (N3, `prepareRestore`) to match.
2. **For the step 4 (scripting) pre-brief** (operator discussion, 21:25):
   - **Edit versus play: authored versus runtime state.** Scripts run in the
     owner's browser and their changes reach the server like any edit, and
     may be saved. Decide whether behaviour changes are saved or runtime-only,
     whether behaviours run in Edit mode, and how Edit mode tells authored
     values from live ones (a door being edited while it swings). Today's
     undo copes safely: a behaviour's sends aren't recorded, and a later undo
     of that object is refused as "changed elsewhere". But it isn't designed
     for this.
   - **Grouped undo for tool-style scripts** ("align selected", "scatter 20
     trees"): one entry covering several objects, e.g. `undo.group(label,
     fn)`. Check all first and refuse the whole entry if any changed
     elsewhere; partial refusals reported as today's multi-field undo does.
     Live behaviours (a door, a moving platform) are not recorded.
     `objectId` makes entries sturdier when names change under a script.
3. **R1 nits not taken:** none outstanding from the review list; N3's
   wording is now in the code comment. The `objectId` race (W2) remains a
   known limitation until step 4.
4. **Headless harness** (scratch, not committed): Playwright Chromium at
   `/opt/pw-browsers`; `esm.sh` routed to local esbuild bundles of
   `@gltf-transform/core`/`extensions` 4.3.0 and `view` 4.3.0 (`npm pack`;
   its `three/examples/jsm/` imports rewritten to the routed URL); a single
   HTTP server serving the checkout plus `attachSessionHandlers` with every
   socket as the owner. `/api/session` 404s are harmless.

### 5.2 The tweak round (prototype lane)
A draft exists on `claude/prebrief-undo-tweaks` (`5f54de3`, Rev 0, probed at
`09da28c`). R1 already covers its items 1–3. **Its remaining scope:** planes
visible from below, Delete and Duplicate keys (1b-2 J9), retiring the
teleporter delete mode (1b-2 J7). It must be re-probed against `c2b8301d`.
Optional: these could instead fold into step 3's pre-brief.

### 5.3 Next in sequence
- **Pass B** (connector writes): its design is settled
  (`atrium-ops` `docs/PREBRIEF-s22-pass-b.md`, Rev 3 + §13, Q0–Q10
  approved); S22's acceptance was its only gate. Check today's lessons
  (§4.1–§4.3) against it first.
- **Step 3:** models by URL, starter library, sky.
- Order is the operator's call.

### 5.4 Carried
- `Cache-Control: no-cache` for `/apps` and `/packages` (acceptance still
  needs the hard reload and marker check).
- Everything in the 1b-2 passdown §5 and the 10-16 server-cleanup passdown
  §6 not closed here.

## 6. Recipes

### 6.1 Is this tab running undo/redo? (browser console)
```js
!!document.getElementById('ep-undo') && document.getElementById('ep-history') !== null   // true at c2b8301d or later
```

### 6.2 A human-directed revision round through the front door
Post the revision spec on the kickoff; one DeepSeek revision (`--max-runtime
3h`), one GLM re-review, a re-review gate **whose body carries the four
release-card bodies as templates with the full SHA**, a new sentinel under
the new DEV finalizer. Archive the superseded acceptance gate host-side.
The R1 spec and Hermes message are in this conversation's history; the
board cards in §1 show the result.

### 6.3 Retrying a refused deployer card
Only after the cause is fixed, and for S22-era refusals only on the S22
side's word:
```
mv /root/.hermes/profiles/atrium-deployer/atrium-kanban-guard-state/deploy-<t_id> \
   /root/.hermes/profiles/atrium-deployer/atrium-kanban-guard-state/deploy-<t_id>.attempt1-$(date -u +%H%M)
hermes kanban --board atrium unblock <t_id> --reason "operator: <why>"
```

### 6.4 MAIN and PROD
As used today: `atrium-main-approve $S && atrium-main-push $S`, then the
teleport-rearm §7.2 guarded PROD block.
