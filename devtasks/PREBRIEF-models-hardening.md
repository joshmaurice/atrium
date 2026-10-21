# Pre-brief: models-by-url hardening (with the automatic release merge)

Status: **Revision 3 (2026-10-20 ~19:30 PT). Decisions L1–L6 approved by the
operator, all as recommended (§3). Rev 2 answered the outside review of Rev 1
(§12). Rev 3 answers the second outside review, of Rev 2, which had the
repository and the host scripts (§13): no decision changed; P8, P10, Z2, Z3,
Z5 and H1–H5 are corrected, and the host drafts were revised and re-tested.**
- **Drafted by Claude from a clone of `main` at `a1eb65b`.** Its code is identical
  to the released `3a71e855` (DEV, MAIN record and PROD): `git diff --stat
  3a71e855 a1eb65b` shows only the models-by-url passdown. Claims marked *probe*
  were run against the real modules with throwaway scripts (not committed).
- **Board and host at drafting** (ops connector, ~16:05 PT): release `COMPLETE` at
  `3a71e855`, nothing running or blocked, DEV and PROD healthy, deploy lock
  free. The only warning is the MAIN record vs `origin/main`: the passdown upload.
- **Source:** passdown 2026-10-20 (models-by-url) §6.0 (the release merge, a
  prerequisite) and §6.1 (S1, S3, S4, S6, S8, N1, the AGENTS.md port table, a
  browser smoke check).
- **Scope:** two parts that ship in this order.
  - **Host part (H1–H5), before kickoff:** the release merge, the smoke check,
    the card-template change and the AGENTS.md upload. Hermes can't change host
    scripts, so these are for the operator or for Claude on the host. Drafts of
    both scripts come with this pre-brief, tested locally (§5.2).
  - **Code part (Z1–Z6), through the pipeline:** `packages/client`
    (`model-fetch.js`), `packages/renderer-three` (`model-bridge.js`,
    `model-parse.js`, `model-instances.js`) and `apps/client` (`model-form.js`,
    `app.js`). No server, protocol or SOM change, so no DEV restart.
- **Out of scope:** step 3b (library, sky); model animations (step 4); editing a
  model's fields after placement (L3 of models-by-url); touch movement; a
  world-lifetime cache of dependency bytes (L4 option b).
- Line numbers are approximate, at `a1eb65b`.

## 1. What this round is
1. **The release merge, done by the host (§6.0).** When `main` has moved during
   a round, DEV, MAIN and PROD get a docs-only merge of the reviewed SHA with
   `main`, made and checked by a host script. The operator never runs §5.2 of
   the passdown by hand again.
2. **A browser smoke check in every DEV deploy.** A deploy whose client page
   doesn't start fails and rolls back, like a failed health check.
3. **Four should-fixes from the outside review**, none of them security:
   - **S1:** a `.gltf` that names one file twice (`./a.png` and `a.png`) loads;
   - **S8:** a shared load survives the node that started it;
   - **S6:** every HTTP transfer, the Check's included, goes through one
     four-at-a-time limiter, and two `.gltf` files loading at once share a
     dependency download;
   - **S4:** placeholders and instance skeletons are disposed.
4. **The S3 residual:** a stale Check can no longer cancel a newer one.
5. **Housekeeping:** the AGENTS.md port table (an operator upload); N1 is closed
   with no change (P7).

## 2. What the code does today (at `a1eb65b`)

### P1. The release path, and why `main` stopped fast-forwarding
- `atrium-deploy-gate` (host) maps the deployer's `atrium_deploy` actions:
  `publish <sha> <workflow/branch>` → `atrium-publish-workflow` (not readable
  through the connector); `dev <sha>` → `atrium-deploy dev <sha>`; `main` and
  `prod` behind human approvals.
- `atrium-deploy dev` needs the target only to be on some `origin/*` branch.
  `set-dev` then records it as DEV and REVIEWED.
- `atrium-main-approve` and `atrium-main-push` both require
  `merge-base --is-ancestor origin/main <sha>`. The push checks it **after**
  DEV acceptance, so a `main` that moved during the round is found only at the
  end (passdown §4.7).
- **The kanban guard** (`atrium-kanban-guard`) requires every stage card's body
  to carry its SHA exactly once and each deployer card to request exactly one
  `atrium_deploy` action from `publish`, `dev`, `main` or `prod`. A new action
  name would need the guard, the `atrium_deploy` tool and the card templates to
  change (L1).
- **The front door builds the four release cards at once** after the review
  gate's APPROVE block (passdown §4.4), so a SHA that only exists after Publish
  can't be written into the later cards' bodies.

### P2. S1 — an aliased dependency refuses a valid model (*probe*)
- `listDependencies` (`model-fetch.js` L318–344) dedupes by canonical `href` and
  **drops the second URI** (`if (seen.has(resolved)) continue`, L339). So
  `fetchModel`'s `dependencies` map (L442–451) is keyed by the first URI only.
- *Probe:* a `.gltf` with `images: [{uri:'./a.png'}, {uri:'a.png'}]` fetches
  `a.png` once (2 requests in all), then `parseTemplate` refuses it as
  `unsupported-image`. The second image has no bytes in `gltfImages`
  (`model-parse.js` L284–291), and round 6's M5 refuses a declared image with no
  bytes. The reason is also misleading: the image is a valid PNG.
- `rewriteGltfJson` (L398) keys blob URLs by original URI, so even with the map
  fixed, aliases would each get their own `blob:` URL of the same bytes.

### P3. S8 — a shared load belongs to its first requester (*probe*)
- `load` (`model-bridge.js` L272) and `loadTemplate` (L326) share one job per
  template key (`loads`, L112). The job is built with the **first** requester's
  `controller` and `wanted()` (L290, L344), and its admission turn is measured
  from that requester (`templateFor` L449–451).
- Removing a node calls `removeInstance` (L668), which **never aborts** that
  node's fetch. The shared job runs on, but its `wanted()` now answers false, so
  it ends `aborted` for **every** requester.
- *Probe:* nodes A and B with one URL; remove A mid-fetch. B ends with status
  `{ loading, reason: 'aborted' }`, **no placeholder and no model, for good**:
  `drop` (L530) removes the placeholder and settles B, and `reconcile` skips a
  record whose spec is unchanged. That is worse than the passdown's "can fail
  the load for others": B is stuck, invisible, until a world change.
- A Check sharing a node's job inherits the same fault, in both directions.

### P4. S6 — the four-transfer limit counts jobs, and the Check skips it
- Pre-brief A4 says the limit of 4 counts **HTTP transfers, dependencies
  included, per page**. The bridge counts **jobs** instead: `enqueue`/`pump`
  (L245–259) cap `load` calls at `MODEL_LIMITS.concurrent` (4).
- **A job keeps its slot through admission and the serialized parse,** because
  `load` awaits the whole job. So while three models wait to parse, only one
  transfer runs.
- **A Check never takes a slot:** `loadTemplate` calls `fetchAndParse` directly
  (L344).
- **Dependencies within one `.gltf`** are fetched one after another (L443–451),
  so a job is at most one transfer at a time.
- **Across `.gltf` files nothing is shared:** two models naming the same
  texture URL download it twice, charging the world's ledger twice, which never
  refunds.

### P5. S4 — placeholders and instance skeletons are never disposed (*probe*)
- `showPlaceholder` (L599) builds a fresh `BoxGeometry` and `MeshBasicMaterial`
  per call (`buildPlaceholder`, `model-instances.js` L134). Nothing disposes
  either:
  - `useEntry` (L414) just detaches it when the model attaches;
  - `fail` (L537) detaches the loading one and builds a failed one;
  - `removeWrapper` (L217) only detaches.
- `disposeInstance` (`model-instances.js` L151) is exported but **never called**.
  It wouldn't free the skeleton anyway: `SkeletonUtils.clone` gives each
  instance its own `Skeleton`, whose bone texture only `skeleton.dispose()`
  frees.
- *Probe:* a skinned model attached, then removed. The placeholder geometry is
  disposed 0 times, and the instance's skeleton 0 times.

### P6. S3 residual — a stale Check cancels a newer one (*probe*)
- `model-form.js` `check()` (L216–261), when a result arrives after its
  generation ended:
  - calls `deps.onDropResult()` (L242, L252), which in `app.js` is `endCheck()`
    (L2710). That bumps **app.js's** `checkGeneration` and releases whatever
    the form holds;
  - and its `finally` (L256) sets `checking = false` whatever the generation.
- `checkModelNow` (L2730) has already released a stale result itself (L2742).
  So the form's extra `onDropResult` only ever harms the **current** Check.
- *Probe* (the form, with `app.js`'s generation logic copied):
  1. Check A waits;
  2. a world change (`beginNewWorld` → `endCheck`, `reset`);
  3. Check B starts;
  4. A settles: `checking` turns false, and Check is re-enabled mid-B;
  5. B settles: **"the check was cancelled"**, B's reference released, nothing
     held.
- **Reachable only narrowly:** A must outlive the world change. A Check waiting
  behind a parse already running can, because a running parse can't be aborted
  (`serialize`, L126). It needs a reconnect and a new Check within that parse's
  remaining seconds. The passdown called this path unreachable through the UI;
  that held for the URL-edit and Cancel sequences, not this one.

### P7. N1 is already done
`withTimeout` (`model-parse.js` L811) was rewritten by round 6's M3 (`cbf9a08`).
It clears its timer when the promise settles either way (L819–820). The
passdown carried N1 from round 6's deferred list, written before M3 landed.
**Nothing to do.**

### P8. The AGENTS.md port table
- The table lacks 3019 (`avatar.test.js` `AVATAR_PORT`), 3020 (`world-crud.test.js`
  `WS_ADM_PORT`), 3060 and 3061 (`teleporter.test.js`), 3070
  (`model-extras.test.js`) and 3183 and 3184 (`reconnect-session.test.js`).
- **The passdown's list also missed 3117** (`apps/client/tests/auth.test.js`).
- **And these fixed ports** (second review N7): 3991 and 3992
  (`http-integration.test.js` `REG_PORT`), 4100–4108 (`packages/client`
  `client.test.js`, `BASE_PORT` + 0…8), 9011–9020 (`autosave.test.js`),
  9021–9025, 9030 and 9031 (`multi-world-mutation.test.js`), 9051
  (`home-world.test.js`) and 9200–9203 (`commons.test.js`).
  `edit-plumbing.test.js` uses port 0.
- Workers can't write AGENTS.md (a protected file). A corrected copy comes with
  this pre-brief (H5).

### P9. What a smoke check would have caught
- **Round 1's four browser defects, by class:**
  - the import maps (already guarded since round 2 by
    `importmap-guard.test.js`, statically);
  - wiring that throws at startup (a bridge without a fetcher now throws in
    `createModelBridge`, V3);
  - Save throwing;
  - models never rendering.
- **A page-load check catches the first two classes.** The last two need
  interaction and a served model. They stay with Claude's browser checks
  (§5.1), which this round still runs.
- **What DEV's deploy checks today:** `check_public_client_assets` fetches four
  files as files. A page that can't start passes.

### P10. Test baseline at `a1eb65b`
Node 22.22.0, clean `pnpm install --frozen-lockfile --prefer-offline`. Re-run
for this draft, all with `fail 0` and `skipped 0`:

| Suite | Command | Count |
|---|---|---|
| `apps/client` | `cd apps/client && node --test tests/*.test.js` | **585** |
| renderer-three | `cd packages/renderer-three && node --test tests/*.test.js` | **202** |
| `packages/client` | `cd packages/client && node --test tests/*.test.js` | **302** |
| interaction | `cd packages/interaction && node --test tests/*.test.js` | 9 |

**`packages/client` runs without `--test-force-exit`** (second review M1). With
that flag `node --test` exits before all of `model-spec.test.js` has run: the
reviewer saw 38, 72 and 97 of its 97 tests (the A1 URL-rule vectors among those
skipped), and suite totals of 241, 274 and 300, every one `fail 0`. Rev 2's 292
came from such a run. Without the flag the suite gives 302 every time, exits on
its own, and takes about 50 s.

The server suites aren't touched by this round. Their per-file handoff
(models-by-url r6) stands, and the workers re-run them as always.

## 3. Decisions

**Approved (operator, 2026-10-20 16:22 PT, all as recommended):** L1a, L2a,
L3a, L4a, L5a, L6a. The other options stay below as the record of what was
not taken.

### L1 — How the release merge is made (§6.0)
- **(a) Approved (recommended). The gate's `dev` action makes it, on a `release/<sha12>`
  branch** (H1, H2).
  - `atrium-deploy-gate dev <reviewed SHA>` first runs a new
    `atrium-release-merge <SHA>`:
    - when `origin/main` is already an ancestor, the release **is** the
      reviewed SHA, and nothing is pushed (today's behaviour);
    - otherwise it builds a two-parent merge (reviewed SHA, `origin/main`)
      without a checkout (`git merge-tree --write-tree`, then `commit-tree`).
      It refuses unless `main` brings only `devtasks/` paths and the merge is
      clean, pushes the merge to `origin release/<sha12>`, and checks the
      result again.
  - It then deploys the merge. The output carries `REVIEWED_SHA=` and
    `RELEASE_SHA=` lines, followed by `atrium-deploy`'s usual output.
  - **No change** to the `atrium_deploy` tool, the guard, Publish, or any card's
    action. The DEV card's body still carries one SHA, the reviewed one.
  - DEV, the acceptance, MAIN and PROD all use `RELEASE_SHA`.
    `atrium-release-status`'s REVIEWED line shows it too, because `set-dev`
    records it.
  - **A re-run** reuses `release/<sha12>` when it already contains `main`. If
    `main` moved again, it stacks a second merge on top, after checking that
    every commit on the branch is a docs-only merge.
- **(b)** A new `dev-release <sha> <branch>` action. It has cleaner meaning, but
  needs the `atrium_deploy` tool, the guard (`STAGES`, `_ACTION`) and the
  templates to change.
- **(c)** The merge at Publish, the passdown's wording. Publish runs first, so
  the DEV card, the finalizer and the gate, all built before it, can't name the
  merge SHA. They would have to read it from Publish's handoff, which breaks
  the guard's one-SHA-per-body rule.
- **(d)** The worker merges `origin/main` at the start of every implementation
  run. That needs no host change. But an upload after the last revision's
  kickoff still breaks MAIN, and it puts docs commits into the reviewed diff.

With (a), the merge rules are exactly the passdown's §5.2, checked by a
script: parents are the reviewed SHA and `main`, and the diff from the reviewed
SHA touches only `devtasks/`.

### L2 — Lane and order
- **(a) Approved (recommended).** Host part first, by the operator or by Claude on the
  host:
  1. H1–H3 are installed and dry-run;
  2. **a short outside review of H1 and H2** (they run as root on the release
     path, as S22's scripts did);
  3. then the kickoff of the code part through the full pipeline: kickoff, GLM
     brief, brief gate, DeepSeek implementation, GLM review, publish, DEV,
     outside code review, Claude's browser checks, operator acceptance, MAIN,
     PROD.

  This round's own release then uses the release merge and the smoke check.
- **(b)** The code first, and the host part after PROD. This round's release
  would need §5.2 by hand again if `main` moves.

### L3 — S8: who owns a shared load
- **(a) Approved (recommended). The job belongs to its key and has a set of requesters**
  (Z2).
  - Each node, and each Check, joins with its own `AbortSignal`, and leaves when
    that signal aborts. A node's signal aborts when the node is removed, when
    its spec changes and at a world change. A Check's aborts at a URL edit,
    Cancel, a close and a world change.
  - The job keeps going while anyone still wants it. When the last requester
    leaves, its transfers are aborted.
  - **Removing a node then aborts its download** when nobody else wants it.
    Today it never does (P3), so a deleted 25 MiB model keeps downloading and
    charging the world's ledger.
- **(b)** Never abort a shared job; only stop deciding its fate by the first
  requester. Simpler, but a deleted model keeps downloading.

### L4 — S6: how far dependency sharing goes
- **(a) Approved (recommended). In flight only.** Two `.gltf` files that need the same
  dependency at the same time share one transfer (Z3), with L3's
  requester-set rule.
  - A dependency requested after an earlier download finished is fetched again
    and charged again.
  - 3b's library is packed `.glb` files with no dependencies, so this matters
    only for owner-hosted multi-file models.
- **(b)** Keep every dependency's bytes for the world's lifetime, too. Repeats
  are free, but up to about 150 MiB more memory per page at the ledger's limit.

### L5 — The smoke check's failure
- **(a) Approved (recommended). It fails the deploy**, like the public health check. Two
  attempts, then DEV rolls back. An esm.sh outage blocks deploys until it
  recovers, and a re-run is the remedy.
- **(b)** Warn only, in the deploy output, for the first rounds.

### L6 — The S3 residual: fix it in the form only
- **(a) Approved (recommended). Fix it in the form.** A stale result does nothing in the
  form (no `onDropResult`, no state change). `app.js` already gives back the
  stale reference (P6). Plus L3's Check signal, so a Check that's ended also
  leaves its shared job.
- **(b)** Also merge the form's and `app.js`'s two generation counters into
  one. That is tidier, but it touches tested wiring for no behaviour change.

## 4. The contract

### Host part (before kickoff; not Hermes)

#### H1. `atrium-release-merge` (L1a; draft `devtasks/host-drafts/atrium-release-merge`, Rev 3)
- **Interface:** `atrium-release-merge <40-hex reviewed SHA>`, run as root.
- **Exit codes** (review S2):
  - 0 prints `REVIEWED_SHA=`, `RELEASE_SHA=` and `MAIN_AT_RELEASE=`;
  - 64 is a usage error;
  - 77 is a refusal, and 75 an operation that failed (a fetch, `commit-tree`,
    or a `merge-tree` that fails for a reason other than a conflict: N1, Rev 3);
    both happen before anything is pushed, so nothing changed but git objects
    and the DEV checkout's remote-tracking refs (the fetch);
  - 70 is critical: a failure at or after the push. Inspect
    `origin/release/<sha12>` before anything else.
- **Fail closed** (review M1): every check that can't run is a failure. The
  path lists are written to a file, and git's exit status is checked before
  they are read, so a `diff` that fails can't pass as an empty one.
- **Steps:**
  1. Hold the deploy lock (`/run/lock/atrium-deploy.lock`, root-only check as in
     `atrium-main-push`).
  2. Fetch, then check that the SHA is a commit on some `origin/*` branch.
  3. The base is `origin/release/<sha12>` if it exists, else the SHA. **Every
     link on an existing branch is re-verified as exactly what this script
     builds** (review M2), at most 10 links:
     - two parents, the first leading back to the SHA;
     - the second already in the current `origin/main`;
     - the link's tree equal to `merge-tree --write-tree` of its two parents;
     - only `devtasks/` changed against its first parent.

     A hand-made or force-pushed commit fails one of these, whatever its shape.
     The fix for a refused branch is to delete it; the next run rebuilds it.
  4. **`main` already in the base** → the release is the base, and nothing is
     pushed.
  5. **Otherwise:**
     - every path in `diff --no-renames merge-base..origin/main` must match
       `^devtasks/`, or it refuses and lists them;
     - `merge-tree --write-tree` (a conflict refuses);
     - `commit-tree -p base -p origin/main` with a fixed identity
       (`Atrium release`) and a message naming both SHAs;
     - the final invariants (step 6) on the new commit, **before** the push;
     - **the deploy would be accepted** (S6, Rev 3): the release record's
       state is `UNINITIALIZED`, `WAITING_FOR_HUMAN_DEV_ACCEPTANCE` or
       `COMPLETE`; no interrupted deploy is recorded; DEV isn't in legacy
       mode. They are read through `atrium-host`, as `atrium-deploy` reads
       them; anything else, or a read that fails, is 77 with nothing pushed.
       So a deploy that `atrium-deploy` will refuse leaves no branch on
       GitHub. With nothing to push they aren't consulted: `atrium-deploy`
       decides alone, as today;
     - push to `refs/heads/release/<sha12>` with `--force-with-lease`: against
       "does not exist" for a new branch, against the base when stacking, so a
       branch changed since the fetch is never overwritten;
     - fetch it back and require it to equal the merge;
     - `logger -t atrium-release-merge`.
  6. **Always, on the final commit:** `diff <SHA> <release>` touches only
     `devtasks/`, and both the SHA and `origin/main` are ancestors of the
     release.
  7. **Only regular files** (S7, Rev 3): every diff H1 reads (`main` since the
     merge base, each link, the final commit) may add or change only mode
     `100644` or `100755` entries; a deletion is fine. A symlink or a
     submodule under `devtasks/` is refused with its path and mode, before
     the push. (`atrium-deploy`'s tree check would refuse it too, but only
     after the branch was pushed.)
- **Its git** is `atrium-main-push`'s `rgit` (S22 D7 environment and overrides)
  plus `user.name` and `user.email`. It works in the DEV checkout's
  repository, **never touching its worktree or HEAD**. `merge-tree` and
  `commit-tree` write objects only. No child inherits the deploy lock's
  descriptor (`8>&-`, as `atrium-deploy` does: N5, Rev 3).
- **Needs git 2.38 or later** (`merge-tree --write-tree`). Check `git --version`
  on the host first.
- **The host's GitHub credential must be allowed to create `release/*`
  branches.** The first real merge shows it; a refused push exits non-zero and
  the deploy doesn't start.
- **After PROD,** `release/<sha12>` is deleted with the workflow branch (the
  operator's usual branch cleanup).

#### H2. `atrium-deploy-gate`'s `dev` (L1a)
Replace the `dev` branch with this one (`dev-force` stays as it is). The
patch is `devtasks/host-drafts/atrium-deploy-gate-H2.patch`:
```bash
if [[ "$cmd" =~ ^dev[[:space:]]+([0-9a-f]{40})$ ]]; then
  SHA="${BASH_REMATCH[1]}"
  rc=0; OUT="$(/usr/local/sbin/atrium-release-merge "$SHA" 2>&1)" || rc=$?
  printf '%s\n' "$OUT"
  (( rc == 0 )) || exit "$rc"
  REL="$(sed -n 's/^RELEASE_SHA=\([0-9a-f]\{40\}\)$/\1/p' <<<"$OUT" | tail -n 1)"
  [[ "$REL" =~ ^[0-9a-f]{40}$ ]] || { echo "DENIED: the release merge printed no RELEASE_SHA" >&2; exit 70; }
  exec /usr/local/sbin/atrium-deploy dev "$REL"
fi
```
The operator's own `atrium-deploy dev <sha>` is unchanged: it never merges.

**Residual, accepted** (review S1): `main` can move again between the release
merge and MAIN, for example an upload during DEV acceptance. Nothing on the host
can lock GitHub. That case is caught exactly where it is today:
`atrium-main-approve` refuses a SHA that isn't a fast-forward of `origin/main`,
before an approval exists, so nothing is consumed. The remedy, on the host,
is two commands for the same reviewed SHA, still with no hand merge:
`atrium-release-merge <SHA>` stacks a merge on the release branch, and
`atrium-deploy dev <the new RELEASE_SHA>` moves DEV to it; the operator then
accepts it again. (A second DEV deploy card for the same SHA may be refused or
deduplicated by the guard's idempotency key, `atrium:dev-deploy:<sha>`.) The
standing rule stays: no uploads to `main` from DEV acceptance until PROD.

#### H3. The smoke check (L5a; draft `devtasks/host-drafts/atrium-client-smoke`)
- **The script:** Python and Playwright, about 150 lines. **It is a startup
  check, not a functional test** (review S3): it doesn't click, connect, place
  a model or save. Those stay with Claude's browser checks (§5.1). It loads the
  page in headless Chromium with SwiftShader WebGL, and fails on any of these:
  - a `pageerror`;
  - a module that doesn't resolve;
  - a document or script request that fails or returns 400 or more;
  - the page not **ready** within the timeout (40 s as `atrium-deploy` runs
    it; the script's default is 45 s): `window.atriumClient` and
    `window.stage` exist, and the stage's renderer has a live WebGL context;
  - a `--require-id` element that is missing.

  It reads and writes nothing on the host. It validates its inputs: an
  `https://` URL with a host and no credentials, a timeout above 0 and a
  settle time of 0 or more (review S5).
- **Exit codes:** 0 passes; 1 fails; **4 fails with a third-party network
  failure among the causes** (a connection failure or a 5xx from another host,
  such as esm.sh), labelled as such in the output (review S4); 2 is usage; 3
  is a browser that couldn't start. A third-party 4xx is a wrong URL, so it is
  ours and gives 1.
- **Install:** `devtasks/host-drafts/install-atrium-smoke.sh`, run as root,
  does all of this and is safe to re-run; `smoke-now.sh` then runs the check
  once by hand, exactly as a deploy will:
  - a system user `atrium-smoke`;
  - a venv at `/usr/local/lib/atrium-smoke/venv` with `playwright==1.56.0`;
  - `playwright install --with-deps chromium`, with the browsers path under
    `/usr/local/lib/atrium-smoke`;
  - the script at `/usr/local/lib/atrium-smoke/atrium-client-smoke`, root-owned.
- **Run it** from `atrium-deploy` as a transient unit, so it never runs as root:
  ```bash
  systemd-run --quiet --pipe --wait --collect --uid=atrium-smoke --gid=atrium-smoke \
    -p RuntimeMaxSec=120 -p MemoryMax=1G -p NoNewPrivileges=yes -p PrivateTmp=yes \
    -p ProtectSystem=strict -p ProtectHome=yes \
    -E PLAYWRIGHT_BROWSERS_PATH=/usr/local/lib/atrium-smoke/browsers -E HOME=/tmp \
    /usr/local/lib/atrium-smoke/venv/bin/python /usr/local/lib/atrium-smoke/atrium-client-smoke \
    "$PUBLIC_CLIENT_PAGE" --require-id ep-model --timeout 40
  ```
  `--timeout 40` (N3, Rev 3): the load and the readiness wait each get it, so
  with the 3 s settle and the browser's start the run stays inside
  `RuntimeMaxSec=120`, and a failure is always explained by a `SMOKE FAILED`
  line rather than a killed unit.
  - `PUBLIC_CLIENT_PAGE=https://dev.ewwb.dev/`, the page the operator opens for
    DEV acceptance (operator, 2026-10-20). The smoke run on the host's first
    install shows whether that address serves the client page itself; if it
    redirects, the script follows.
  - **While `atrium-deploy` is open for this:** its `PUBLIC_HEALTH` and
    `PUBLIC_CLIENT_BASE` still use `dev.5-78-232-73.sslip.io`. The 10-09
    domain passdown found that raw-IP names can be blocked by some networks.
    Switching both to `dev.ewwb.dev` is optional and outside this round's
    contract, but cheap to do in the same edit.
  - If Chromium's own sandbox won't start under these settings, the host
    adjusts the unit, not the script.
- **In `atrium-deploy`** (`devtasks/host-drafts/atrium-deploy-H3.patch`):
  - `PUBLIC_CLIENT_PAGE` and `SMOKE_DIR`, and a `check_client_smoke` that runs
    the unit through `run` (the S23 child pattern) up to twice;
  - called right after `check_public_client_assets`, in the deploy path and in
    the same-SHA health-check path.
  - With L5a, a second failure returns non-zero inside the health checks. The
    ERR trap rolls back as for a failed public health check, before `HEALTHY=1`
    and before the commit block. In the same-SHA path (no ERR trap) the script
    just exits non-zero.
  - **The shape is fixed** (S8, Rev 3), because with this `run` and ERR trap
    the obvious alternatives misbehave: `run …` as a plain statement rolls back
    on the first failure (no second attempt), and if `run`'s command is a
    shell function, the ERR trap also fires inside the background child
    (errtrace), so the rollback runs twice. Tested with `atrium-deploy`'s own
    `run` and a stand-in `systemd-run`: pass, pass on the second attempt, and
    two failures giving one rollback, in the main shell.
    ```bash
    check_client_smoke() {
      local attempt
      for attempt in 1 2; do
        if run systemd-run --quiet --pipe --wait --collect --unit="atrium-smoke-$$-$attempt" \
            … (the options above) … "$PUBLIC_CLIENT_PAGE" --require-id ep-model --timeout 40; then
          return 0
        fi
        echo "SMOKE attempt $attempt of 2 failed"
      done
      return 1
    }
    ```
    `run`'s argument is `systemd-run` itself, inside the `if`. A unit that a
    rollback leaves behind (`stop_child_group` stops `systemd-run`, not the
    unit) ends by `RuntimeMaxSec=120`.
  - **A known trigger** (S9, Rev 3): the page's sign-in check. Until Z5's fix
    is deployed, a 502 from `/api/auth/me` during a deploy fails the smoke and
    rolls DEV back; a re-run is the remedy. The reviewer reproduced it against
    the real client page: 401 gives `SMOKE OK`, 502 gives `SMOKE FAILED … page
    error: Session check failed (502)`.
  - **Exit 4 is treated like 1** (L5a stands). Rolling back during a CDN outage
    costs nothing, because the previous SHA uses the same CDN, and committing a
    release no browser was seen to start would be worse. The label tells the operator to
    re-run the deploy once the outage ends.
- **Memory:** about 300–500 MB while it runs. The host showed 2.5 GB available
  at drafting.

#### H4. The release cards' templates (front door and review-gate body)
- **DEV deploy — `<sha8>`:** the action is unchanged
  (`atrium_deploy(action="dev", sha="<reviewed SHA>")`). The handoff must quote
  these lines verbatim:
  - `REVIEWED_SHA=`;
  - `RELEASE_SHA=`;
  - `TARGET_SHA=`;
  - `local: …`;
  - `public: …`;
  - `SMOKE OK: …`;
  - `=== DEV DEPLOY SUCCESS ===`.

  `DEPLOY_OK <sha>` alone isn't a handoff. That folds in passdown §4.8's
  finalizer block.
- **DEV finalizer — `<sha8>`:** passes when the handoff shows success and
  health, `REVIEWED_SHA` is this card's SHA, and `TARGET_SHA` equals
  `RELEASE_SHA`. The finalizer can't check the merge itself; H1 already did,
  and the host only deploys a release H1 built. Its result names both SHAs.
  - **If DEV already ran `RELEASE_SHA`** (a re-run, or after H2's host
    remedy), `atrium-deploy` takes its same-SHA path: the handoff shows
    `DEV ALREADY AT TARGET_SHA=…` and `SMOKE OK`, but no
    `=== DEV DEPLOY SUCCESS ===` and no `set-dev`. The finalizer then blocks
    for the operator; it doesn't pass (N9, Rev 3).
- **Awaiting DEV acceptance / main merge approval — `<sha8>`:** the title keeps
  the reviewed `sha8`. The body tells the operator that MAIN and PROD use
  `RELEASE_SHA`, and to confirm it against `atrium-release-status`'s DEV and
  REVIEWED lines before `atrium-main-approve`.
- **What the cards' text can and can't do** (review S6): the finalizer
  verifies only from its parent's handoff, by the guard's own rule (no host
  probing from the sandbox). The authority is on the host: `set-dev` records
  what DEV actually runs, and `atrium-main-approve` and `atrium-main-push`
  require `require-dev` and DEV's live HEAD to equal the SHA they're given. A
  wrong SHA in a handoff can mislead a card, but it can't move MAIN or PROD.
- **Operator commands** (edit-polish-2 passdown §6.4): `S=<RELEASE_SHA>`.

#### H5. Uploads with this pre-brief
- `AGENTS.md`, with the corrected port table (P8, including Rev 3's
  additions; sent with this pre-brief);
- `devtasks/host-drafts/` with: `atrium-release-merge`, `test-release-merge.sh`,
  `atrium-client-smoke`, `install-atrium-smoke.sh`, `smoke-now.sh`,
  `atrium-deploy-H3.patch` and `atrium-deploy-gate-H2.patch`.

AGENTS.md sits outside `devtasks/`, so the release merge would refuse it
mid-round. Uploaded **before** kickoff, it is in the round's base and never
needs merging. After kickoff, uploads stay under `devtasks/`; anything else is
refused at the DEV deploy, with the path named.

### Code part (the pipeline)

#### Z1. S1 — every original URI maps to its bytes (`model-fetch.js`, `model-parse.js`)
- **`listDependencies`** returns each distinct canonical URL once, with **every**
  original URI that resolved to it (`uris: [...]`). Its validation is
  unchanged, and the first refusal still wins.
- **`fetchModel`** fetches each distinct URL once (bytes counted once) and puts
  an entry for **every** original URI in `dependencies`, all pointing at the
  one `{ url, bytes }` object.
- **`rewriteGltfJson`** keys its blob URLs by the dependency's canonical `url`,
  so aliases share one `blob:` URL. `revokeBlobs` and the URL modifier are
  unchanged.
- **Preflight** then sees bytes for every declared image. The refusal of an
  image that truly has no bytes stays (round 6 M5).

#### Z2. S8 — a shared load belongs to its key (L3a; `model-bridge.js`, `model-fetch.js`)
- **A small renderer-neutral helper,** `createSharedTasks()`, exported from
  `model-fetch.js`, which every page already maps (§8).
  - `join(key, start, signal)` returns a promise of the task's result for this
    requester. `start(taskSignal)` runs once per key while the task is live.
  - A requester whose `signal` aborts gets `{ ok: false, reason: 'aborted' }` at
    once, and the others are untouched.
  - When the last requester leaves before the task settles, the task's
    controller aborts. A settled task leaves the map.
  - **Task identity and states** (review M5):
    - a task is `live` while it has at least one requester and hasn't settled;
    - when its last requester leaves, it becomes `abandoned` **at once**: it
      leaves the map, and no one can join it again;
    - a join after that starts a **new** task, with a new identity, even while
      the old one is still settling;
    - an old task's settle or cleanup removes only its own entry, never a newer
      task under the same key (the bridge's existing
      `if (loads.get(key) === job)` pattern).
  - **The parse belongs to its task, too** (second review M2). `templateFor`
    keeps a second per-key map of parses in flight (`parses`, L111,
    L434–435, L508–509) and hands whatever is in it to the next caller. With
    abandonment that is wrong: a node deleted while its parse waits in the
    queue, then re-added (Undo) before the queue drains, starts a new task,
    which would be handed the abandoned parse; that parse answers `aborted`
    (its `wanted()` is the old task's), and the re-added node ends
    `loading`/`aborted`, the state the invariant below forbids. So:
    - `parses` is keyed by task, or removed (one task per key makes it
      redundant);
    - a new task never awaits an abandoned task's parse: it parses for
      itself, and the abandoned parse is disposed when it settles (below);
    - an abandoned task removes its own `parses` entry (the `=== job`
      pattern) when it is abandoned, not when its parse settles.
- **The bridge:**
  - **One job per template key,** joined through the helper by every node load
    and every Check.
  - **Each record gets its own `AbortController`,** aborted by `removeInstance`,
    a spec change and `resetWorld`. `loadTemplate` takes an optional `signal`.
  - **The job's `wanted()`** answers "some requester remains and the world
    generation is unchanged".
  - **The admission turn (W5)** is measured from the **earliest remaining**
    requester in `som.allNodes` order. When only Checks remain, it waits for the
    nodes loading at that moment (`waitForLoading`).
  - **Admission is re-evaluated whenever membership changes** (review M6). A
    join or a leave wakes every admission waiter (`notifyAdmission`), and each
    wake recomputes the earliest remaining requester. A job that becomes
    Check-only takes `waitForLoading`'s snapshot at that moment, and never
    keeps a departed node's turn.
- **The parse's reference:**
  - The entry the parse creates (`acquired: true`, W3) belongs to the job,
    which hands it to its first remaining requester. Every other requester
    acquires its own reference. **Only when this task's parse created the
    entry** (S5, Rev 3): when the task finds the entry already in the cache
    (`templateFor` L431–432, or `again` at L458–459), there's no reference
    to hand over, and every requester acquires its own.
  - If none remain, the job releases the reference, and the template goes idle
    and is kept (A8).
  - **Every reference has exactly one owner at a time.** Handing it to a
    requester and releasing it are one operation that runs once (a flag on
    the job), and a requester that left after the hand-over releases it
    through its own record. A parse that completes after its job was
    abandoned is disposed and its reservation released, each exactly once
    (today's late-parse path, `templateFor` L479–483).
  - **Today's latent double release stays unreachable** (N6, Rev 3):
    `useEntry`'s not-wanted branch releases (L413) and then `drop` releases
    `record.key` again (L532; `record.key` was set at L406). Nothing awaits
    between L298 and L413 today. The hand-over must not add an await there,
    or `useEntry` must clear `record.key` before calling `drop`.
- **Invariant (tested):** while its node is in the SOM, every model node ends
  `loaded` or `failed`. It never stays `loading` with reason `aborted`.
- **`app.js`:** `checkModelNow` passes an `AbortSignal` that `endCheck` aborts
  (L6a).

#### Z3. S6 — one transfer limiter per page, and shared dependency transfers (L4a)
- **`createTransferLimiter({ concurrent })`** in `model-fetch.js`.
  - `acquire(signal, priority)` resolves to a `release`, **lowest priority
    first, then first-come** (S2, Rev 3: §12 A4 says queued transfers start in
    A10's order, and a plain first-come queue puts the first model's
    dependencies behind every later model's file). A job's priority is the
    `som.allNodes` index of its earliest requester when it asks; a Check's is
    after every node. A shared transfer keeps the priority it queued with. A
    waiter whose signal aborts leaves the queue.
  - **`release` is idempotent** and held in `try/finally` from the moment of
    the grant. A signal that aborts after the grant, before the request
    starts, releases at once, so no slot leaks in that race (S4, Rev 3).
  - A waiter whose job the world's ledger aborts (A4's 150 MiB) leaves the
    queue, and its job is `world-download-budget`, as `abortOrTimeout` names
    it today (S4).
  - `fetchModel` takes an optional `limiter` and holds one slot per HTTP
    request: from before `fetchFn` until the body is read or cancelled.
- **The job's deadline** (M3, made exact by review M3, and by exclusion in
  Rev 3, S1):
  - the clock runs from the job's first request to the end of its parse,
    **except** while the job waits for a limiter slot, for admission (W5) or
    for the parse queue (A5). (Round 6's M3 put it this way. Counting only
    "a transfer in flight or the parse" would leave CPU work between stages
    uncounted, such as a 25 MiB `.gltf`'s `JSON.parse` or a pin's sha256.)
    A joined shared transfer that is itself still waiting for a slot counts
    as waiting;
  - each transfer and the parse get `remainingMs()` when they start, and
    `fetchModel`'s timer is re-armed per transfer rather than set once;
  - **a shared transfer has no timer of its own** (S1, Rev 3). Each
    consumer's deadline makes that consumer leave the transfer when it
    reaches zero, and the transfer is aborted when its last consumer leaves.
    So a job is never timed out on another job's clock;
  - reaching zero ends the job as `timeout`. The job leaves any shared
    transfer, aborts transfers only it wants, and a parse already running is
    disposed when it settles (M3/M4, unchanged).
- **The bridge makes one limiter per page** (it outlives world changes; aborted
  signals clear its queue) and passes it to every `fetchModel` call, loads and
  Checks alike.
  - **The bridge stops capping jobs:** `queue`, `running` and `pump` go.
  - `reconcile` starts loads in `som.allNodes` order, so their first transfers
    queue in that order (A10).
  - **Waiting for admission or for the parse holds no transfer slot.**
- **Shared dependency transfers.**
  - `fetchModel` takes an optional `sharedTransfers` (a `createSharedTasks()`
    per world generation; `resetWorld` makes a new one). Each non-`data:`
    dependency is joined **by its canonical URL and its redirect policy**,
    with the job's signal (M4, Rev 3). The policy is `abs` for an absolute
    model's dependency and the world's origin for a root-relative model's,
    because A2/L17's redirect rule differs between them: an absolute model
    may follow any `https` redirect, a root-relative one must stay on the
    world's origin. Keyed by URL alone, a root-relative model joining an
    absolute model's transfer would receive bytes from a redirect it must
    refuse. The transfer checks its redirect against its own policy, as
    `fetchOne` does now.
  - **One job's dependencies are fetched one after another**, as today
    (L443–451). Only different jobs' transfers run side by side.
  - **Invariants of a shared transfer** (review M4; each one tested):
    - A1's URL rule and A2's request policy are applied by `fetchOne`, as for
      any request, **before** a transfer starts or is joined. The redirect
      check, which needs the response, is the transfer's own, against its
      policy key (above);
    - received bytes are charged to the world's ledger as each chunk arrives,
      **once per transfer**, whoever joined it. The chunk that crosses 150 MiB
      aborts every in-flight transfer (A4, unchanged). The shared transfer
      registers its own controller with the ledger (S4, Rev 3);
    - the transfer enforces the 25 MiB cap while reading;
    - **each consumer's 25 MiB model budget is charged per chunk, as today**
      (M3, Rev 3; `readBody` L178–239 charges one budget for the file and
      every dependency, chunk by chunk). The transfer passes each chunk's
      length to every consumer as it arrives; a consumer that joins a
      transfer already under way is charged the bytes received so far at
      once. A consumer whose total (its file plus every dependency so far)
      passes 25 MiB fails `too-large` and leaves at once; the transfer goes on
      for the others. A declared `Content-Length` above a consumer's remaining
      budget makes that consumer leave before any body is read. So a
      download that only one model wants stops at that model's 25 MiB plus
      one chunk, exactly as today.
      (Charging only when a transfer completed would let one model pull about
      twice the cap in sequence, before failing, all charged to a ledger that
      never refunds.);
    - the transfer is aborted when no consumer remains (L3a's rule).
  - The model's top-level file is shared at the bridge level already (Z2), not
    here.
- **A4's world-wide dedupe, amended by L4a** (S3, Rev 3). §12 A4 says fetches
  are deduplicated by canonical URL for the whole world. That stays true of a
  model's own file (the template cache, Z2). For dependencies, L4a (approved)
  shares transfers in flight only: a dependency asked for after its earlier
  download finished is fetched, and charged, again. A reviewer holding A4
  should read this as the agreed amendment, not as a defect.

#### Z4. S4 — what is built is disposed (`model-bridge.js`, `model-instances.js`)
- **A record holds at most one visual,** a placeholder or an instance. A new
  `clearVisual(record)` detaches it and disposes it:
  - **a placeholder:** its geometry and material;
  - **an instance:** `disposeInstance`, which also calls `dispose()` once on
    every distinct `Skeleton` in the instance. It **never** touches the
    template's geometries, materials or textures (A9).
- **Called from:** `useEntry` (before the new instance goes in), `fail` (before
  the failed placeholder; recolouring the loading one is fine too), `drop`,
  `removeInstance`, a spec change and `resetWorld`.
- **Not called from `detachView`,** which keeps wrappers for re-attachment (A9).

#### Z5. S3 residual (L6a; `model-form.js`, `app.js`), and the page's sign-in check
- In `check()`, a result or an error whose generation is no longer current
  returns `false` and **changes nothing**: no `onDropResult`, no `checking`
  change, no render.
- `finally` resets `checking` and renders only when the generation is current.
- `close()` and `reset()` still end the Check and clear `checking` (`reset`
  does so today).
- `app.js` aborts the Check's signal in `endCheck` (Z2).
- **The page-load sign-in check catches its error** (second review S9).
  `app.js` L2585, `me().then(...)`, gets a `.catch` that logs a warning and
  leaves the visitor signed out. `auth.js`'s `me()` throws on any error status
  but 401, and on a network error, so today a transient 502 from
  `/api/auth/me` is an unhandled rejection: a page error, which H3's smoke
  check reports and which then rolls a DEV deploy back.

#### Z6. What does not change
- Every limit (25 MiB, 150 MiB, 512 MiB, 30 s, preflight), the URL rule, A2's
  request policy and the fail-closed URL modifier. Z3 states the one
  amendment, A4's dedupe scope for dependencies (L4a), and keeps the 25 MiB
  model budget per chunk exactly as today;
- the template cache's rules (A8, W3), the reason codes and the placeholder's
  look;
- the server, `send`, persistence and the protocol.

If one seems to need changing, stop and ask the operator.

## 5. Tests

| Item | New or changed tests | Proof of failure |
|---|---|---|
| Z1 | `packages/client` `model-fetch`: `./a.png`, `a.png` and `x/../a.png` give one request and three `dependencies` keys sharing one object. renderer-three `model-parse`: that `.gltf` passes preflight and its rewrite has one `blob:` URL for the three URIs (stub loader). A `.gltf` whose second image truly has no bytes is still refused | (p1) key `dependencies` by the first URI only |
| Z2 | renderer-three `model-bridge`: A and B with one URL, remove A mid-fetch → B `loaded`, one fetch, no abort. Remove both → the fetch's signal aborts, no parse. A before B, remove A while B waits for admission → B is admitted on its own turn. A Check and a node share a job; end the Check → the node loads. The invariant over a random add/remove sequence. **Membership change while waiting** (review M6): B waits behind A's turn, A leaves → B is admitted on its own turn; the same when only a Check remains. **A parse that completes after every requester left** → disposed once, reservation released once, no reference held. **A parse queued behind another when its only node is deleted, then the node re-added (Undo) before the queue drains** → the re-added node ends `loaded`, and the old parse's template is disposed once (second review M2). `packages/client` `createSharedTasks`, with deferred promises: join/leave; last-leaves-aborts; **a join after abandonment starts a new task** (start called twice) **and the old task's late settle doesn't remove the new one** (review M5) | (p2) the job's `wanted()` is its first requester's again; (p3) the last requester leaving doesn't abort; (p3b) let a join attach to an abandoned task; (p3c) let a new task await an abandoned task's parse (`parses.get(key)`) |
| Z3 | `packages/client`: the limiter's order, cap and abort-while-queued. `fetchModel` holds one slot per request, deps included. Two models sharing a dependency → one request, the ledger charged once, each budget charged. **Abort a queued waiter while another transfer is active** → no slot leaked, the next waiter is woken (review). **A shared dependency where one consumer goes over its 25 MiB budget** → that one fails `too-large`, the other loads. With a controlled clock: a job with 20 s of queue and admission waits plus 20 s of transfer and parse finishes; a job with 31 s of transfer and parse is `timeout` (review M3). **Per-chunk model budget** (second review M3): two models share a 20 MiB dependency and model X also names a second 20 MiB file → X fails `too-large` as soon as its own bytes pass 25 MiB, not at the end of a transfer; Y loads; the ledger is about 40 MiB. **Redirect policy** (M4): an absolute and a root-relative model share a dependency URL that redirects off the world's origin → two transfers; the absolute model loads, the root-relative one fails `redirect`. **A shared transfer's timer** (S1): job Y with 1 s left starts a transfer, job X joins fresh, Y times out → X completes. **Grant, then abort** (S4): abort in the tick a slot is granted → no slot leaked, the next waiter starts. **Priority** (S2): with every slot busy, a later node's file queues first, then an earlier node's dependency → the earlier node's starts first. renderer-three: a Check while four transfers run waits for a slot; three models waiting to parse don't hold slots | (p4) the Check bypasses the limiter; (p5) shared transfers off (two requests); (p5b) let the clock run while waiting for a slot; (p5c) charge a consumer's budget only when the shared transfer completes; (p5d) key shared transfers by URL alone |
| Z4 | renderer-three, with real three objects and `dispose` listeners: the placeholder's geometry and material are disposed once on attach, on fail, on remove and on reset; an instance's skeleton on remove, spec change and reset; a shared template's geometry is **not** disposed while another instance or the idle cache holds it; 50 add/remove cycles leave no placeholder geometry undisposed | (p6) skip the placeholder dispose on attach; (p7) skip the skeleton dispose |
| Z5 | `apps/client` `model-form`: P6's sequence (A waits; world change; B starts; A settles: `checking` still true, Check still disabled; B settles: result held). A stale error changes nothing | (p8) call `onDropResult` on a stale result again |

**Expected counts:** each suite's P10 count (`packages/client`: 302, run
without `--test-force-exit`), plus new tests, minus removed ones.
The handoff gives each exact number next to its command, and every server file
run individually under `timeout 180` (card requirements §2).

**Proofs:** commit first; break the file, run, record the failing test names,
restore the file **from a saved copy, never with `git checkout`**, re-run green.

### 5.1 Claude's checks (after publish, throwaway, not committed)
With the passdown §5.1 harness (a fresh server per run; Khronos CC0 samples;
generated fixtures):
- **S1:** an aliased `.gltf` (`./tex.png` and `tex.png`) renders, with one
  request for the texture.
- **S8:** two nodes with one slow URL; delete the first mid-load. The second
  renders, with one request.
- **Deleting the only node of a slow 20 MB model** aborts its request: the
  request count and the ledger stop growing.
- **S6:**
  - eight models load with **at most four requests in flight** at any moment
    (Playwright request events);
  - a Check while they load waits its turn;
  - two `.gltf` files sharing a texture, loaded together, give one texture
    request.
- **S4:** add and delete a skinned model 30 times.
  `stage._renderer.info.memory.geometries` returns to its starting value, and so
  does `.textures` (the bone textures).
- **S3:** in the browser, a Check on a slow model, a forced reconnect, then a
  new Check. The new Check reports its own result.
- **The sign-in check** (Z5): with `/api/auth/me` answering 502, the page
  shows no page error, and the H3 smoke script passes against it.
- **Delete while queued, then Undo** (Z2, M2): several models parsing; delete
  one whose parse is queued, Undo at once. It renders.
- **The smoke check's own output** is in the DEV deploy card's handoff.

### 5.2 The host drafts, tested locally (Claude, this draft)
- **`test-release-merge.sh`** runs `atrium-release-merge` against a throwaway
  `file://` origin. Only its paths and the file-protocol override differ from
  the draft. **Rev 2: 27 of 27 cases pass.** Against the Rev 1 script, the
  five new or changed cases fail, which shows they test the review's
  findings. Rev 1's 20 cases:
  - no merge needed;
  - a docs-only merge: its parents, the push, `devtasks/`-only, `main`
    fast-forwards;
  - a re-run reuses the release;
  - a second upload stacks on the branch;
  - code on `main` is refused, names the path, and pushes nothing;
  - a docs conflict is refused;
  - a tampered release branch is refused;
  - an unknown SHA, a bad argument and a held deploy lock are refused.

  And Rev 2's seven (review M2, S2):
  - a forged link whose second parent isn't in `main` is refused;
  - a forged link with the right parents but an extra file in its tree is
    refused;
  - an unrelated commit on the release branch is refused;
  - a genuine release built after the branch is deleted, then re-verified and
    reused on a re-run;
  - a push the remote rejects gives 70 (critical), not a refusal;
  - `MAIN_AT_RELEASE=` is printed.

  M1 (a `diff` that fails) is fixed by construction and checked by reading:
  the script has no path where git's output is read before its exit status.

  **Rev 3: one test file, 47 checks, all passing** (git 2.43): Rev 2's 27,
  the second review's fault cases (11 checks, E1–E10: lease races on a new
  and a stacked branch, a failing `diff`, `merge-tree`, `fetch` and
  `commit-tree`, a symlink, a rewound `main`, a modify/delete conflict, a
  post-push fetch failure and its recovery) and 9 for Rev 3 (S6: release
  state, marker, legacy mode, unreadable record, nothing to push, all clear;
  S7: a submodule, and an executable doc with a deletion; N5: no child holds
  fd 8). A git wrapper
  injects the faults, and a stub `atrium-host` sets the state. Against the
  Rev 2 script, the 8 checks for S6, S7, N1 and N5 fail.
  The host runs it once in a scratch directory before installing H1.
- **The H2 patch** and the **H3 patch** apply with `patch` to copies of the
  connector's `atrium-deploy-gate` and `atrium-deploy`, and the results pass
  `bash -n`. The gate snippet was tested with stubbed callees: every exit
  code passes through, and a missing `RELEASE_SHA` gives 70.
- **`atrium-client-smoke`** (Rev 2) against eight local pages, with Chromium
  141 and SwiftShader WebGL2:
  - a good page passes (exit 0);
  - a page with the globals but no WebGL context fails (review S3);
  - an unmapped import, a startup throw, a missing module (404) and an error
    500 ms after ready each fail with the cause named (exit 1);
  - an unreachable third-party module host fails with the outage label (exit 4);
  - a third-party module that answers 404 fails as ours (exit 1);
  - a non-https URL, a URL with credentials, a timeout of 0 or NaN and a
    negative settle time are usage errors (exit 2).
  - the second review ran it against the **real** client page (esm.sh
    imports served locally at the same versions): `SMOKE OK` in about 5 s
    with a 401 from `/api/auth/me`; `SMOKE FAILED` with a 502 (S9).

## 6. DEV acceptance (operator, hard reload, owner)
1. **The deploy itself:** the DEV deploy card's handoff shows `SMOKE OK`. If
   `main` moved during the round, it also shows a `RELEASE_SHA` different from
   the reviewed SHA, and `release/<sha12>` exists on GitHub.
2. **Models as before:** add one, then Undo, Redo, Duplicate, Delete. A visitor
   tab renders it.
3. **Delete while loading:** add two copies of one large model (Duplicate right
   after Save), delete the first before it appears. The second appears.
4. **A Check while models load** still answers.
5. **MAIN and PROD with `S=RELEASE_SHA`.** `atrium-main-push` fast-forwards with
   no hand merge.

## 7. Worker rules and release path
**Workers** (as edit-polish-2 §7):
- `pnpm install --frozen-lockfile --prefer-offline` in their own worktree;
- the full handoff: the 40-character SHA; per-file counts with commands and exit
  codes; Node version; skipped count; proofs (p1)–(p8), (p3b), (p3c), (p5b), (p5c) and (p5d) with failing test names;
- **an ordered step list, one commit per step:**
  1. Z1 (`model-fetch.js`, `model-parse.js`) and its tests;
  2. `createSharedTasks` and `createTransferLimiter` in `model-fetch.js`, with
     their unit tests;
  3. Z2 in the bridge, and `app.js`'s Check signal, with tests;
  4. Z3 in the bridge and `fetchModel` (limiter, shared dependencies), with
     tests;
  5. Z4 (`clearVisual`, `disposeInstance`), with tests;
  6. Z5 (`model-form.js`, and `app.js`'s sign-in check), with tests;
  7. full suites, proofs, handoff;
- **`--max-runtime 3h`** at creation, `max_turns` 300 (passdown §4.5). A second
  consecutive stop blocks with a different kind than the first.

**Release path** (S22): publish, DEV deploy and finalizer cards make **one call
each**. On any refusal, non-zero exit or unexpected message they block with the
full output and never retry. H4's templates apply. The review gate creates
nothing: on APPROVE it blocks for the front door, which builds the chain
(passdown §4.4).

**Before kickoff:**
- H1–H5 are done (L2a);
- this pre-brief (final revision) and H5 are uploaded to `main`;
- then take the base SHA from a host fetch;
- no open sentinel;
- a push dry run.

Uploads to `devtasks/` during the round are now fine: the release merge
absorbs them.

**Outside code review** of the published SHA by a separate Claude session,
alongside §5.1, before DEV acceptance.

## 8. Notes for the brief author
- **New helpers go in `model-fetch.js`,** not a new module. A new
  `@atrium/client/*` entry needs `package.json` exports **and** all three pages'
  import maps (round 1). `importmap-guard.test.js` would catch a miss, but
  there's no reason to risk it.
- **Z2 is the delicate part.** Today `templateFor`'s `token` is the first
  requester. After Z2, the token is the job, and the requesters are a set.
  Check every place that reads `createdFor`, `token.node` or `wanted()`
  (L300, L354, L449–452, L479), and the `parses` map (L111, L434–435,
  L508–509; Z2, Rev 3).
- **Z3 removes `enqueue`/`pump`.** `reconcile` calls `load` directly. Keep A10:
  loads start in `som.allNodes` order, and admission is still W5's.
- **`disposeInstance` must not dispose shared resources.** `SkeletonUtils.clone`
  shares geometry and materials with the template. Only the skeleton and the
  wrapper belong to the instance.
- **`apps/client` tests can't import three.js or the DOM.** Z4's tests live in
  renderer-three, and Z5's use the form's fake-element harness.
- **H1–H5 are not worker steps.** If a card asks a worker to touch
  `/usr/local/sbin` or AGENTS.md, that's a brief error.

## 9. Where this sits
1. Models by URL (3a), released 2026-10-20 (`3a71e855`).
2. **This round:** hardening, plus the release merge and the smoke check.
3. **Next, in the operator's order:**
   - step 3b (library, sky, Caddy hosting; L13–L15 decided);
   - the richer `add`, then copy (C1–C4; absolutise root-relative model URLs);
   - Pass B;
   - edit-polish-3;
   - the host investigation of the `kanban_create` field-drop fault (passdown
     §4.4).

## 10. Review log
- **Rev 0** (2026-10-20 ~16:30 PT): drafted from probes at `a1eb65b`, with the
  host scripts read through the ops connector (`atrium-deploy`,
  `atrium-deploy-gate`, `atrium-main-approve`, `atrium-main-push`,
  `kanban-guard`, `worker-card-requirements`). L1–L6 were open.
- **Rev 0 → Rev 1:** the operator took every recommendation (2026-10-20
  16:22 PT). The status line and §3 record them as approved; the contract (§4)
  was already written for them and is unchanged. No outside review of the
  pre-brief; L2a's outside review covers the host scripts H1 and H2.
- **Rev 1, same day:** the operator gave the DEV page, `https://dev.ewwb.dev/`
  (H3).
- **Rev 1 → Rev 2** (~17:30 PT): an outside review of Rev 1 gave NO-GO for the
  pre-brief and both scripts (must-fix M1–M6, should-fix S1–S6, nits N1–N2).
  §12 records what was done with each. No decision changed. Both drafts were
  revised and re-tested (§5.2).
- **Rev 2 → Rev 3** (~19:30 PT): a second outside review, with the repository
  at `a1eb65b` and the host scripts through the ops connector, gave NO-GO
  for the pre-brief (must-fix M1–M4) and GO for both scripts (should-fix
  S1–S9, nits N1–N10). §13 records what was done with each. No decision
  changed. `atrium-release-merge` was revised (S6, S7, N1, N5) and its test
  grew to 47 checks; the `atrium-deploy` and gate changes now come as
  patches, with an installer for the smoke check.

## 11. Open for the operator
- **Rev 3's text was written from the second review by the same session
  that did that review** (§13). The GLM brief and its gate read the contract
  as usual; a separate quick read of §13's changes is optional.
- **`atrium-publish-workflow`** isn't in the connector's `read_file` list, so it
  wasn't read. L1a doesn't change it. Consider adding it, and the two new host
  scripts, to the allowlist (atrium-ops), so Claude can verify them from here.

## 12. Outside review of Rev 1 (2026-10-20) and what Rev 2 did
**Limits of that review.** The reviewer's session couldn't resolve
`github.com` and had no ops connector. So it read only the pre-brief and the
two drafts, ran `test-release-merge.sh` (20 of 20, reproduced), and marked
every P-claim unverified. Claude had verified those claims with probes for Rev
0 (P2, P3, P5 and P6 marked *probe*; the rest by reading at `a1eb65b` and the
host scripts through the connector). Its findings are design and script
findings, and each was checked against the code and host scripts before
acting on it.

| Finding | Verdict after checking | What Rev 2 did |
|---|---|---|
| **M1** a failing `git diff` reads as an empty, acceptable diff | **Agreed.** Process substitution hides the producer's exit status | Fixed in H1: the list goes to a file, git's status is checked first. Every check fails closed |
| **M2** a forged two-parent link passes the chain check | **Agreed, and confirmed:** the Rev 1 script accepted both forgeries in the new tests. The final docs-only check meant no code could change, but the provenance was unproven | Fixed in H1: each link must equal the clean merge of its parents, with its second parent in `main`. Three new cases. A local record (the reviewer's alternative) wasn't needed: the link is re-derivable from git alone |
| **M3** the deadline is ambiguous across queues | **Agreed** | Z3 states when the clock runs and when it stops, re-arms per transfer, and adds a test |
| **M4** shared-transfer accounting and cancellation underspecified | **Agreed, as a specification gap** | Z3 lists five invariants, each tested |
| **M5** shared-task states and reference ownership | **Agreed** | Z2 defines `live` and `abandoned`, new identity on rejoin, own-entry cleanup, and single ownership of the parse's reference; tests with deferred promises |
| **M6** admission while membership changes | **Agreed** | Z2: every join or leave wakes and re-evaluates admission; a Check-only job snapshots at that moment; a test |
| **S1** `main` can move after H1 | **Agreed it can; declined a lock.** Nothing on the host can lock GitHub | H2 records it as an accepted residual: `atrium-main-approve` already refuses before any approval exists, and the remedy (a new DEV deploy, then re-acceptance) is written down |
| **S2** exit codes incomplete | **Agreed** | H1: 75 for an operation that failed before the push, 70 for anything at or after it; a test |
| **S3** smoke passes a non-functional client | **Partly.** It's a startup check by design (P9) | Readiness now also needs a live WebGL context; the script and H3 say plainly it's not a functional test |
| **S4** CDN outage rolls back a good deploy | **Kept L5a**, with a label | Exit 4 and an outage label. A third-party 4xx stays ours. Rollback during an outage costs nothing (the old SHA uses the same CDN) |
| **S5** input validation | **Agreed** | URL parsed (https, host, no credentials), finite positive timeout, non-negative settle; tests |
| **S6** finalizer trusts the handoff's text | **Declined as a card change:** the guard forbids host probing from the sandbox, by design | H4 says where the authority is (`set-dev`, `require-dev`, DEV's live HEAD at approve and push), and the acceptance gate asks the operator to check `atrium-release-status` before MAIN |
| **N1** the "changes nothing" header | **Agreed** | Header lists exit codes and what each means |
| **N2** a global array `p` | **Agreed** | `local -a` throughout |

## 13. Second outside review, of Rev 2 (2026-10-20), and what Rev 3 did
**Scope.** The reviewer cloned the repository at `a1eb65b` and read
`atrium-deploy`, `atrium-deploy-gate`, `atrium-main-approve`,
`atrium-main-push`, `kanban-guard` and `worker-card-requirements` through the
connector. It reproduced P2, P3, P5 and P6 with probes, ran P10, ran both
scripts (the smoke check against the real client page too) and added fault
cases. Verdicts: pre-brief NO-GO; both scripts GO. Of §12's answers, M1, M2,
M6 and S1–S6 held; M3–M5 held only in part (below).

| Finding | What Rev 3 did |
|---|---|
| **M1** P10's `packages/client` count (292) came from a run truncated by `--test-force-exit` | P10: 302, run without the flag; §5's expected counts say so |
| **M2** a new task adopts an abandoned task's queued parse; a re-added node ends `loading`/`aborted` | Z2: the parse belongs to its task (`parses` per task or removed); test and proof (p3c) |
| **M3** shared transfers would charge the 25 MiB model budget per completed transfer, not per chunk | Z3: per-chunk budget per consumer, Content-Length per consumer, one job's dependencies in sequence; test and proof (p5c) |
| **M4** A2's redirect rule depends on the model, but shared transfers were keyed by URL alone | Z3: keyed by URL and redirect policy; test and proof (p5d) |
| **S1** whose clock a shared transfer runs on; the clock defined by inclusion | Z3: no timer on a shared transfer; the clock defined by exclusion; test |
| **S2** a first-come limiter contradicts A4's "queued transfers start in A10's order" | Z3: a priority limiter (earliest requester's `allNodes` index; Checks last); test |
| **S3** A4's world-wide dedupe vs L4a | Z3, Z6: stated as the agreed amendment |
| **S4** limiter grant/abort race; ledger and queued waiters | Z3: idempotent release, abort after grant releases, ledger abort leaves the queue as `world-download-budget`; the shared transfer registers with the ledger; test |
| **S5** hand-over only for an entry the parse created | Z2 |
| **S6** H1 pushed before `atrium-deploy`'s up-front refusals | H1 step 5: the same checks before the push; 6 test checks |
| **S7** H1 accepted a symlink or submodule under `devtasks/` | H1 step 7: regular files only; 3 test checks |
| **S8** the smoke hook's shape with `run` and the ERR trap | H3: the exact function, in `atrium-deploy-H3.patch`, tested with the real `run` |
| **S9** an uncaught page-load sign-in check fails the smoke on a 502 | Z5: `.catch`; H3 notes it until then; §5.1 check |
| **N1** a `merge-tree` error that isn't a conflict gave 77 | H1: 75; test E4 |
| **N2** the smoke's "setup has run" wording | The docstring says what READY proves |
| **N3** the smoke's two waits against `RuntimeMaxSec` | H3: `--timeout 40` |
| **N4** the outage label alongside our own error | Kept; the label already says "among the causes" |
| **N5** git children inherited the deploy lock | H1: `8>&-`; test |
| **N6** a latent double release in `useEntry` | Z2: kept unreachable, or clear `record.key` first |
| **N7** P8's port list incomplete | P8 and the corrected `AGENTS.md` |
| **N8** Z6 cited AGENTS rule 1 | Z6: "stop and ask the operator" |
| **N9** the same-SHA path's handoff | H4: the finalizer blocks for the operator |
| **N10** the guard counts distinct SHAs | No change needed |
