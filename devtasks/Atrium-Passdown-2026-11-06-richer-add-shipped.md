# Passdown 2026-11-06: `richer-add` shipped to PROD (`3fcc296c`)

This supersedes `Atrium-Passdown-2026-11-05-add-check-shipped.md` as the
starting point. Read this file first. That passdown's host, connector and
convention notes still hold, and so do its follow-ups (carried in §6).

**First instruction for the next session's Claude:**
1. Clone the repo and read this file. The next work is **`copy-objects`**
   (RA-L6 (a), §6 item 1): `devtasks/PREBRIEF-richer-add-copy.md`, DRAFT
   Rev 0.4, with CP-L1–CP-L7 open. Carve it into its own contract
   (`PREBRIEF-copy-objects.md`), as `add-check` and `richer-add` were.
2. **Use the `atrium-ops` connector for board, release, log and git state.**
   It is read-only. To push, attach the repo with push access (`add_repo`,
   `joshmaurice/atrium`, access `push`) and clone to `/home/claude/atrium`.
3. **The release rule is unchanged:** from a round's DEV release merge until
   PROD is `COMPLETE`, push **nothing** to `main`, except a revision that
   supersedes a DEV the host hasn't accepted.
4. **Cost matters.** This round cost **no OpenRouter credit**: Claude's fast
   lane, three ChatGPT reviews, publish and deploy from the host (§4).
5. **Give the operator host commands with no leading spaces,** and real paths,
   never placeholders.
6. **Before acting on an outside review, check the SHA it names** (§3.1).

## 1. Where things stand
| What | State |
|---|---|
| Release | `COMPLETE`. DEV = MAIN = PROD = **`3fcc296c9226911b3280c4d221eed2a99c6bbc0f`**: the reviewed tip `4b3393db` plus `main`'s two `devtasks/` notes (no code difference, checked). PROD's `app.js` is still `b601c8e710db`: `app.js` didn't change this round |
| What users get | Duplicate and Undo now keep a material's name, extras, emissive, alpha mode and cutoff, and double-sided, mesh and primitive extras, UVs and vertex colours. On PROD **445 of 455** top-level objects copy (410 of 437 before); the 18 named-material objects now do |
| Avatars | Unchanged: an anonymous visitor's `add` carries nothing new (R2, `avatar-fields`) |
| Version skew | An unreloaded tab's world `add` **and** `remove` are refused ("this page is older than the server: reload it to keep editing"); it can still join, move, recolour and rename. Seen in a real stale tab on DEV and on PROD |
| PROD survey (`p6`, at `3fcc296`) | 24 worlds, none unreadable. **No accessor or buffer labels, no shared materials or meshes, no part extras, no non-FLOAT attributes, no MASK cutoffs:** RA-L2 and RA-L3 stay closed |
| Board | No cards this round (fast lane). `add-check`'s leftovers `t_d6c11601` and `t_82771022`, if not yet archived (§7) |
| Branches on GitHub | `claude/richer-add`, nine `release/*` refs, `workflow/undo-hold`, `workflow/scripting-4d-1`. All can go (§7) |

## 2. What shipped
**Contract:** `devtasks/PREBRIEF-richer-add.md` FINAL Rev 2 (widens
`PREBRIEF-add-check.md`'s A1–A4, keeps A5). **Handoff:**
`devtasks/HANDOFF-richer-add.md` (commits, test counts, proofs, deviations).

| Item | What |
|---|---|
| R1–R3 | `checkAddNode` and `add-spec.js` (identical, byte for byte): world adds may carry the new fields; new reason codes; vectors 60 → 112 |
| R4 | `ingestNode` keeps every new field, and makes **one buffer per call**: a 20,000-primitive direct ingest went from 3.8 s to 0.38 s (`q2`) |
| R5 | the add schemas; `hello`'s `addFields` (an integer, so a later page still connects) |
| R6 | the version-skew check: `addFields: 2` rides beside `scriptRunner`; a session with `scriptRunner` and no `addFields` can't add or remove world objects |
| R7 | Duplicate's rules narrow to what's still lost; the canonical builder emits only what a save keeps (a cutoff only with MASK; emissive outside the writer's 1e-5) |
| R8 | stated exceptions: accessor and buffer **names** dropped (their extras refused), sharing (a restore gets its own material; the Undo title says so), an index's storage type, accessor sharing between primitives |

**Decisions** (operator, 2026-11-05): RA-L2 (c) **modified** (names dropped,
extras refused, after the second ChatGPT review's S5), RA-L3 (a) with a revisit
trigger (step 7's import, material identity, or labels or sharing found by
`p6`), RA-L6 (a) (`copy-objects` next), the fast lane.

**Tests:** 60 suites, 4,056 passing, 1 named skip (R7's stated limit: a base
colour within 1e-5 of the default). Every new test failed on `cdfe88a8` first;
proofs (p1)–(p6) in the handoff.

## 3. Lessons
### 3.1 ChatGPT was given the wrong prompt once
The first "review" of `PREBRIEF-richer-add.md` was a second review of the old
combined draft at `923bd444` (it had the old prompt file). It was triaged, not
taken as the round's review (`REVIEW-richer-add-copy-rev0.1-chatgpt-2.md`), and
it still contributed RA-L2's modification. **Check the reviewed SHA in the
first lines of any outside review before reading further,** and name each
prompt file distinctly.

### 3.2 The outside design review caught a hole Claude made
Rev 1.2's R6 refused a stale tab's `add` but not its `remove`: a stale Delete
(which asks nothing for a restorable object) would have been permanent once R6
refused its Undo (`REVIEW-richer-add-rev1.2-chatgpt.md` M1). The fix was one
more check; the lesson is that a refusal designed for one message must be
traced through every flow that pairs with it (Delete ↔ Undo, add ↔ remove).

### 3.3 The fresh-agent checks were worth it, twice
On the pre-brief (Rev 1.1) a fresh agent found that R6 as written would have
broken 16 server test files' hellos, that `atrium.gltf`'s columns (the RA-L3
example put to the operator) are inside a group, the writer's 1e-5 tolerance,
and shared meshes. On the code it found a real bug (the Undo note survived a
Redo) and a test that passed with or without R6. **Claude told the operator
once that a column's delete couldn't be undone under RA-L3 (b); that example
was wrong** (corrected in Rev 1.2 §3 and in the session).

### 3.4 Two test traps
- **glTF-Transform's CommonJS and ES module builds don't mix.** A test that got
  `Document` through `createRequire` (CommonJS) made accessors the server's
  writer (ES module) silently skipped. Import
  `packages/som/node_modules/@gltf-transform/core/dist/index.modern.js`.
- **`add-check.test.js`'s Duplicate stand-in answers every `getAttribute` with
  NORMAL.** Builders must read `listSemantics()`, never probe by name.

### 3.5 A stale tab for acceptance
Only a page loaded before the deploy runs the old client. The operator had one
on DEV by luck. For PROD, Claude asked for a scratch cube placed in a tab opened
before the deploy. For DEV, a console patch of `WebSocket.prototype.send` that
strips `addFields` from the hello, then a teleport (a new connection, no
reload), imitates one (`packages/client/tests/richer-add-lifecycle.test.js`
does the same on the wire).

### 3.6 Session mechanics
- `better-sqlite3` builds in the cloud session with
  `node /opt/node22/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js rebuild --release --nodedir=/opt/node22`
  in its package directory; then every database suite runs.
- The DEV gate merges `main`'s `devtasks/` into the branch
  (`release: merge main … so MAIN can fast-forward`), so DEV's SHA differs from
  the reviewed tip. Check `git diff <reviewed> <dev> -- . ':!devtasks'` is
  empty before giving the MAIN and PROD commands.

## 4. The cheap round, as run
1. Pre-brief: Claude, a fresh-agent check, one ChatGPT review (plus the
   mis-targeted one), operator decisions by AskUserQuestion.
2. Implementation: Claude's fast lane on `claude/richer-add`, four commits,
   then a fresh-agent code check and a fifth commit for its findings.
3. One ChatGPT code review (APPROVE WITH NITS, source-only: its clone fails on
   DNS every time).
4. Host: `atrium-deploy-gate "dev <sha>"`, the operator's DEV acceptance,
   `atrium-main-approve … && atrium-deploy-gate "main …"`, the `p6` survey,
   `atrium-prod-approve … && atrium-deploy-gate "prod …"`.

No GLM cards, no OpenRouter credit. Worth keeping for rounds whose contract
names every rule, file and test.

## 5. Probes added (`devtasks/spike-richer-add/`)
- `p8-richer-add-facts.mjs`: labels in the fixtures, what the writer keeps,
  ingestNode before the round, the hello schema and an unknown capability,
  buffers per call, sharing through Duplicate, the writer's tolerance.
- `p9-render-mapping.mjs`: the new fields through `DocumentView`, headless.
- `p6-db-survey.mjs` counts labels, part extras, non-FLOAT attributes, MASK
  cutoffs and shared meshes. Its heading "by property today's add drops" is
  now stale (material names and emissive are kept): fix the wording when it's
  next touched.

## 6. Follow-ups
1. **Next: `copy-objects`** (single objects between worlds).
   `PREBRIEF-richer-add-copy.md` DRAFT Rev 0.4, CP-L1–CP-L7 open, each with a
   recommendation; Rev 0.4 added Inspect skipping hidden objects, the paste
   lifecycle, and model URL revalidation with the live source base. It builds on
   `richer-add`'s descriptor. The subtree `add` is the placement round after it
   (PROD's 9 objects with children).
2. **`richer-add`'s nits, not taken** (`REVIEW-richer-add-code-chatgpt.md`):
   N1, `isUnitRangeVec3`/`Vec4` accept a holey array on a direct call (refused
   off the wire; an indexed check in both copies with a unit test); N2, `-0`
   over JSON (no change).
3. **Recorded for an audit:** node `extras` has no finiteness walk (part
   extras do); `send` can set a cutoff on a non-MASK material; a per-world
   resource budget (the 1 MiB message cap doesn't bound a world).
4. **`initDocumentView` passes the renderer as the document**
   (`packages/renderer-three/src/document-view.js` L21,
   `new DocumentView(renderer)`): it works only because the first argument is
   unused for viewing. Older than this round.
5. **One PROD object has a non-unit rotation** (`p6`), so it can't be duplicated
   and its delete can't be undone (the app asks first). The owner can reset its
   rotation in the Edit panel. Older than this round.
6. **Carried from the last passdown:** the hidden host tab stops behaviours;
   two behaviour-driven objects are choppy; `add-check`'s test-only nits; the
   registry race at teardown; the Behaviour panel's "Custom graph"; 4d-1's
   three items; `c2.py`'s timing flake; the kickoff template.

## 7. Cleanup (operator, on the host)
```bash
hermes kanban --board atrium archive t_d6c11601
hermes kanban --board atrium archive t_82771022
git -C /root/.hermes/sandboxes/docker/default/workspace/atrium push origin --delete claude/richer-add release/4b3393db219d
```
The first two lines only if those cards are still there. The other `release/*`
refs (`2f28f030ec72`, `3cfeeed9a8bf`, `4f66f93b7f8b`, `769825ce3781`,
`85669db0f8a9`, `a096cf3f8fcf`, `e536913011cc`, `fe4dcbb34ed7`) and
`workflow/undo-hold` and `workflow/scripting-4d-1` can go the same way.
