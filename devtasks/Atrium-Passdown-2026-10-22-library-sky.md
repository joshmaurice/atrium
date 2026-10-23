# Atrium Passdown — 2026-10-22 — library-sky (Phase 3 step 3b), released

**Predecessor:** `devtasks/Atrium-Passdown-2026-10-21-models-hardening.md`.
Its host and connector state still holds, except where this file says
otherwise.

**First instruction for the next session's Claude:**
1. Clone the repo and read `devtasks/`, newest first (this file first).
2. If the `atrium-ops` connector's tools are listed, use them for board,
   release, log and git state. It is read-only.
3. **The working conventions changed this round (§4.9).** Claude commits
   pre-briefs, kickoffs, revisions and passdowns straight to `devtasks/` on
   `main`.
4. **Kickoff cards must never ask the kickoff to run git or hash anything
   (§4.3).**
5. Then §6: the operator picks the next round.

## 1. Status at handoff

| Item | State |
|---|---|
| Release | **COMPLETE** (2026-10-22 ~20:25 PT). DEV, MAIN and PROD are at `a31c5a62826f89425db987f667ca4c3bf0f368c0`, recorded and healthy, with the deploy lock free and no warnings. Checked through the connector. |
| What `a31c5a62` is | The automatic release merge of the reviewed round-2 tip `fdcd350665266d31317acb9903025492800ca10d` with `main` `ae4ba8a`. Only `devtasks/KICKOFF-library-sky.md` and `devtasks/REVISION-library-sky.md` differ from the reviewed code. |
| Spec | `devtasks/PREBRIEF-library-sky.md`, FINAL Rev 1.1 (sha256 `9c89ba58…12c31ee`). Then the GLM brief `t_9a76f6f2`, with five brief-gate corrections on `t_16f2a65e`. Round 2: `devtasks/REVISION-library-sky.md` Rev 1 (sha256 `97fad699…201c`). |
| Decisions | L13–L15 (from models-by-url), and L21–L31, all as recommended (operator, 2026-10-22 ~09:39 PT). The §9.5 forward-write race was accepted as a deferral. |
| Host part | **Done before kickoff.** 34 models and 6 skies are in `/srv/atrium-library`. Caddy serves `/assets/library/*` on both sites. The catalog is on `main` at `apps/client/library/catalog.json` (sha256 `f18db4fa…0e54d`). |
| DEV acceptance | Operator, 2026-10-22 evening, on real assets. Claude's 14 browser checks pass on `fdcd3506` (§3). |

## 2. What shipped

### 2.1 Host: the starter library (pre-brief H1–H3)
- **`scripts/library-build/`** sits outside the pnpm workspace, so neither
  `sharp` nor its tests enter a deploy. Its README has the full procedure.
  - **`build.mjs`** has three modes: `--check`, `--out` and `--verify`. It
    reaches only Poly Haven's three hosts, follows redirects by hand, caps
    sizes while streaming, and checks every md5 and size. It converts each
    model in memory to one `.glb`, re-pivoted to the centre of its base,
    then holds it to Atrium's own `model-parse.js` checks. Each model's size
    is checked against Poly Haven's `dimensions` (§4.6).
  - **`install-library.sh`** runs as root from a pinned commit only. It is
    an embedded `python3 -I` program working through `O_NOFOLLOW`
    descriptors. Every destination is checked before anything is installed,
    so a refused run installs nothing. The catalog it keeps is rebuilt from
    checked fields only.
  - **Tests:** 77, with the installer's run as root.
- **Pinned installer:** `4d0e2a3d864470339b115c2edbe4e1bcd42fbcc1`, sha256
  `6a0dc0b0…ad65`. It passed three rounds of independent security review
  (§4.7).
- **Library:** 34 models in six categories and 6 skies (4096 × 2048 JPEG).
  - One model was rescaled: `steel_frame_shelves_01` came out ×10 (§4.6).
  - Texture estimate: about 613 MiB for the whole library, so about 30
    distinct items fit one world's 512 MiB.
- **Caddy:** `handle_path /assets/library/*` on both site blocks, with CORS
  `*`, `immutable` caching and `nosniff`. There is no directory listing.
  Backup: `/etc/caddy/Caddyfile.bak-library-2026-10-22`.

### 2.2 Code (`fdcd3506`, through the pipeline)
- **Z1:** `apps/client/src/library-catalog.js`. It fetches the catalog
  relative to its own module, capped at 256 KiB while reading. Paths must
  match exact per-kind patterns, with the file name's hash tied to its
  sha256.
- **Z2:** the **Library** grid (`library-grid.js`), shown and hidden through
  one `setVisible` port (r2 V1). Adds go through a `request.library` answer
  branch.
- **Z3:** `createSkyLoader` in `packages/renderer-three/src/load-background.js`.
  - It alone owns `scene.background` and `scene.environment`.
  - Only the current generation may touch them, and the newest value always
    wins.
  - It resets from `beginNewWorld()`, `connecting` and `disconnected`.
  - Every current failure is logged once as `[sky] …` (r2 V2).
- **`fetchImage` and `resolveSkyUrl`** live in `packages/client`, with
  shared sky-URL vectors for the client and the server.
- **Z4:** the Sky picker (`sky-picker.js`).
  - One write at a time, and a rejection rolls back only the two leaves,
    through `applyLocally`, never sent.
  - Every result reaches the picker. Retry is offered only for retryable
    failures (r2 V3).
- **Z5:** the server refuses any new `background.texture` value that isn't
  https, a root path, or `''`.

**Tests at release:** server 530 (34 files), client 391, renderer-three 265,
`apps/client` 766, som 234, protocol 71 and interaction 9. Nothing was
skipped, and every file exits on its own.

## 3. How the round ran

| Step | Card or SHA | Notes |
|---|---|---|
| Pre-brief Rev 0–1.1 | `devtasks/PREBRIEF-library-sky.md` | Two outside reviews (R1–R7, then two must-fix and four should-fix), all taken |
| Host part | `scripts/library-build`, `4d0e2a3` | Independent security review of the installer, three rounds. First real build found the ×10 model (§4.6) |
| Kickoff | `t_99c9de3d` | **Plus three duplicate kickoffs** and 14 stray cards (§4.2), archived leaf-first |
| GLM brief, then the brief gate | `t_9a76f6f2`, `t_341b0da3` | Faithful. Five corrections posted on the implementation card |
| Round 1 | `a94d56a9` (`t_16f2a65e`, review `t_540a2ccb`) | All 15 proofs; GLM APPROVE with no findings. **Claude's browser checks: 11 of 14, and the Library grid never shown** (§4.1) |
| Round 1 DEV | `cf8858fe` | The deployer blocked on the truncated handoff (§4.4); verified on the host. Never accepted; archived |
| Revision | `REVISION-library-sky.md` | V1–V3. The first round-2 kickoff `t_366520a1` blocked: it had no shell to check the hash (§4.3). Rev 1 fixed the text |
| Round 2 | `fdcd3506` (`t_82be9557`, review `t_80cabd96`) | 21 proofs. Browser checks 14 of 14 |
| Release | `a31c5a62` | The finalizer blocked on the truncated handoff (§4.4); verified on the host. Acceptance, MAIN, PROD |

## 4. Findings and lessons

### 4.1 Green tests and an APPROVE did not mean the feature worked
Round 1 had all suites green, all 15 proofs reproduced, and a GLM APPROVE
with "no findings". The Library grid still never appeared:
- `#library-grid` starts as `display:none`;
- `app.js` looked the element up and never used it;
- the grid's `open()` changed only state.

The same thing happened in 3a's round 1. Unit tests that take plain values
can't see a page that never shows its panel. **Claude's browser checks stay
mandatory for client rounds, before DEV acceptance.** Wiring guards that read
`app.js` as text (r2's one-writer guard) are a cheap partial defence.

### 4.2 The front door created three duplicate kickoffs
The `kanban_create` field-drop fault (§4.8 of the 10-21 passdown) dropped
the first kickoff's body. The front door then re-created the kickoff rather
than posting the text as a comment on the card that existed. Each empty
kickoff ran the orchestrator's default plan and built a stray chain: 14
cards, two of them DeepSeek **Implement** cards.
- **Rules for the front door:**
  - after a create, read the card back;
  - if the body is missing, post it as the first comment on **that** card;
  - never create a second one.
- **Cleanup:** archive strays children before parents. An archived parent
  counts as done (round 1's sentinel fired once its stray parent was
  archived), so archiving a parent first releases its children.

### 4.3 A kanban-only card cannot verify anything
The round-2 kickoff text asked the kickoff to fetch the revision and check
its sha256. That profile has only `kanban_*` tools, so it rightly blocked
with `kind=capability`. Round 1's kickoff had the same wording and went
ahead, by trusting the posted hash. **Rule:**
- the front door verifies the hash and posts it on the kickoff;
- the kickoff copies it into the implementation and review cards;
- only cards with a shell check it.

### 4.4 The deploy handoff is still truncated
Round 1's DEV deploy card blocked (the deployer saw `TARGET_SHA` ≠ the
reviewed SHA, and no `RELEASE_SHA`/`SMOKE OK` lines). Round 2's finalizer
blocked the same way.
- **Verify from the host:** `atrium-release-status` showing DEV actual =
  recorded = `RELEASE_SHA` and `WAITING_FOR_HUMAN_DEV_ACCEPTANCE` is enough.
  `set-dev` runs only after health and the smoke check pass.
- **The `release/<sha12>` ref** gives the merge's parents and diff.
- **The fix** is still the small host round (§6.1).

### 4.5 Board state to know
- Round 1's sentinel `t_c944dbac` fired early (§4.2). Round 2 had its own,
  `t_1f53c6b5`, which completed after the round-2 finalizer.
- Every round-1 card that still matters is done or archived. The round-1
  acceptance gate `t_dd93bfc2` was archived, never accepted.

### 4.6 Real Poly Haven data
- **`steel_frame_shelves_01`'s glTF carries a ×10 scale.** It measured
  21 m tall against Poly Haven's own 2.14 m.
  - The tool now compares sorted sides with `/info`'s `dimensions`
    (millimetres). Within 10% is fine. All three sides off by the same
    factor is fixed by one uniform rescale. Anything else is flagged.
  - Every other model matched within 10%.
- **The stool (18 cm) and the side table (42 cm) really are small.** They
  are named "Footstool" and "Small Side Table".
- **Poly Haven's file host blocks robots.** Claude can't read a real `.gltf`
  from a session. The tool requires every `uri` in a `.gltf` to equal an
  include key, and the real data passed.
- **Sky sources are 8192 × 4096 tonemapped JPGs.** Downsized, the six skies
  are 0.16–0.39 MB each. The operator saw no banding.

### 4.7 Host tooling that runs as root gets an independent review
An outside reviewer read the installer in three rounds, without Claude's
reasoning. Round 1 found seven issues, including disk-fill through hard
links, copying through a symlinked or trailing-slash staging path, and a
refused run still installing files. Round 2 found five more, including an
author name with a lone surrogate that installed every file and then
crashed. Its final verdict was "fit for root".
- **Lesson:** the staging directory and its catalog are hostile input.
  Root runs only a pinned, hashed copy of its tool.

### 4.8 Claude's browser checks run locally
`dev.ewwb.dev` is refused by the session's proxy, so the checks ran in a
headless harness:
- the published code;
- a library generated in the production format by `scripts/library-build`
  and its fake Poly Haven;
- Playwright's `route_web_socket` to stub server refusals;
- a `?visitor=1` world for a non-owner viewer.

The real 34 models and 6 skies are checked only by the operator on DEV.

### 4.9 Working conventions (operator, 2026-10-22)
- **Claude commits pre-briefs, kickoffs, revisions and passdowns** straight
  to `devtasks/` on `main`, and reports the commit. A pre-brief stays marked
  DRAFT until approved. The kickoff pins the approved version by sha256.
- **Mid-round, only `devtasks/` may change on `main`.** The release merge
  refuses anything else. Code or config on `main` needs the operator's OK,
  outside a round.
- **Branch deletes don't work from Claude's session** (its git connection
  drops them). They go through root's credentials on the VPS (§7).

## 5. Recipes

### 5.1 Rebuild or extend the library
Follow `scripts/library-build/README.md`:
- **Build** as `atrium-build`, with a scratch `HOME` under `/var/tmp`
  (`sudo -u atrium-build env HOME=/var/tmp/lib-home bash -c '…'`). Its shell
  is `nologin`, so `bash -c` is explicit.
- **Install** as root, from the pinned installer (`4d0e2a3`, sha256 above).
- **New items:** edit `items.json`, run `--check`, then `--out` into a new
  directory, then `--verify`.
  - Names match `^[A-Za-z0-9][A-Za-z0-9 ()'.,&-]{0,47}$`; categories match
    `^[A-Z][A-Za-z ]{0,23}$`.
  - The library is append-only: existing files are never rewritten.
  - The new catalog goes to `main` **between rounds**, because it isn't
    under `devtasks/`.

### 5.2 Verify a DEV deploy when the handoff is truncated
```bash
atrium-release-status | sed -n 1,8p     # DEV actual = recorded = RELEASE_SHA, healthy
git ls-remote https://github.com/joshmaurice/atrium refs/heads/release/<sha12>   # = RELEASE_SHA
hermes kanban --board atrium complete <blocked deploy or finalizer> --result "OPERATOR: DEV runs RELEASE_SHA <sha>, verified on the host"
```

### 5.3 Claude's local browser harness
The same as the 10-21 passdown §5.1, plus:
- serve a generated catalog at `/apps/client/library/catalog.json` and the
  generated files under `/assets/library/`;
- use `run(['--out', dir, items], { fetchFn: createFakePolyHaven(…).fetchFn })`
  from `scripts/library-build`;
- use `modelOptions: { id: { textureSide: 2048 } }` to reach the 512 MiB
  budget (about 11 items).

## 6. Follow-ups

### 6.1 Small host round (still open, plus new)
- **The deployer's handoff gap** (§4.4; 10-21 §4.2): have `atrium-deploy`
  re-print `REVIEWED_SHA`, `RELEASE_SHA`, `TARGET_SHA` and `SMOKE OK` at the
  very end.
- **The `kanban_create` field-drop fault:** find the cause. The front door's
  duplicate-creation behaviour (§4.2) belongs in its skill text.
- **`atrium-ops` `read_file` allowlist:** add `atrium-release-merge`,
  `atrium-publish-workflow` and `atrium-client-smoke`.
- **Optional:** the smoke check could also `--require-id ep-library`. It
  still wouldn't catch a hidden grid; only browser checks do.

### 6.2 Client follow-ups (recorded, not done)
1. **The HUD's world name updates only on reconnect.** It is set only on
   `world:loaded`. Fix: refresh it in `som:set`'s `__document__` branch.
   Pre-existing.
2. **The SOM Inspector doesn't render models.** It has no model bridge; this
   was scoped out in 3a. A modest round of its own.
3. **Edit off hides the Library grid but doesn't close it.** The Model form
   behaves the same way. Z2 literally says "closes on Edit off".
4. **A remote viewer logs a rule-refused sky on every World Info change.**
   Rule refusals skip the log-once shortcut.
5. **A viewer on another origin sees a catalog sky as "Custom",** because
   the stored URL is absolute on the first origin.
6. **A raw (non-picker) World Info send that's refused isn't rolled back**
   in the sender's SOM, and an accepted raw send doesn't update the sender's
   own sky. Pre-existing.
7. **The §9.5 forward-write race:** whole-extras World Info writes can
   revert another owner's concurrent change. The fix is a leaf-level
   document `send` (a protocol change).
8. **L31:** no default lighting for skyless worlds. The comparison with real
   wood, fabric and metal items was never done, because the harness had
   only synthetic assets. The operator can judge on DEV whether library
   items look too dark without a sky.

### 6.3 Next in sequence (operator's order)
- **Step 4:** model animations. The loader already prepares `record.clips`.
- **The richer `add`,** then **the copy step** (copy-objects passdown
  C1–C4). A library URL is recognisable by its `/assets/library/` path
  (L15).
- **Pass B** (connector writes) and **edit-polish-3** remain open.

## 7. Cleanup (operator, host)
```bash
# Branches: the round's, the two merged Claude branches, and two older ones (your call)
git -C /root/lib-install push -q https://github.com/joshmaurice/atrium --delete \
  workflow/library-sky release/a94d56a98998 release/fdcd35066526 \
  claude/prebrief-library-sky claude/library-build \
  claude/copy-objects-decisions claude/passdown-edit-polish-2
# Host scratch, if still present
rm -rf /var/tmp/library-1022b /var/tmp/lib-src /var/tmp/lib-home \
       /root/libsky-corrections.txt /root/kickoff-library-sky.txt /root/tmp-dry
```
- **If `/root/lib-install/.git` was removed** (§7 of the earlier
  instructions), the branch delete needs any root clone instead.
- **Keep:** `/srv/atrium-library`, `/root/lib-install/catalog-f18db4fabbba.json`
  and the Caddyfile backup.
- **On the board,** nothing is open.
