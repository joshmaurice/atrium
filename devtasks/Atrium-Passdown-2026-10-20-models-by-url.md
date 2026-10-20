# Atrium Passdown — 2026-10-20 — Models by URL (Phase 3 step 3a), released

**Predecessor:** `devtasks/Atrium-Passdown-2026-10-19-copy-objects.md` (and, before it, edit-polish-2). Their host and connector state still holds, except where this file says otherwise.

**First instruction for the next session's Claude:**
1. Clone the repo and read `devtasks/`, newest first (this file first).
2. If the `atrium-ops` connector's tools are listed, use them for board, release, log and git state. It is read-only.
3. Then §6: the follow-up round, or step 3b's pre-brief. The order is the operator's call.
4. **Whichever comes first, include §6.0 (the release merge done automatically) in that pre-brief as a prerequisite.** The operator wants no manual merge at the next release.

## 1. Status at handoff

| Item | State |
|---|---|
| Release | **COMPLETE** (2026-10-20 ~15:00 PT), checked through the connector. DEV, MAIN and PROD are at `3a71e855dcbdcf794c5b653fd2ee26fd6dcc6519`, all recorded and healthy, with the deploy lock free and no warnings. |
| What `3a71e855` is | A docs-only merge of `main` (`14385065`) into the accepted code `f8e5aa9b44b76d0880b7b259dba02f0fb92cc64c`. Made so `atrium-main-push` could fast-forward (§4.7). Its code is byte-identical to `f8e5aa9b`; only `devtasks/REVISION-models-by-url*.md` differ. |
| Spec | `devtasks/PREBRIEF-models-by-url.md` FINAL Rev 2 (§12 governs), plus `REVISION-models-by-url.md` (round 2), `-r3.md`, `-r4.md`, `-r5.md` and `-r6.md`. |
| Decisions | L1–L19 (pre-brief §3 and §12 A15), plus **L20: the world texture budget is 512 MiB** (r5, operator, 2026-10-20 ~08:54 PT). |
| DEV acceptance | Operator, on an Android phone, 2026-10-20 ~14:35 PT. Everything passed except teleporting, which mobile can't test (no touch movement). |
| Branches to delete (operator) | `workflow/models-by-url`, `claude/models-by-url-release`; host scratch clone `/root/tmp-release`. |

**Board cleanup (operator, host):**
- Archive the superseded acceptance gates `t_2b9bff3f` (8a902f59), `t_0f59759c` (83ee8afe), `t_18dc23c8` (d1db9ad1), `t_c4837f6f` (a1847bb3) and `t_10cda607` (ee8d39f5).
- Archive the strays from the tool fault: `t_93f47490`, `t_d7b3625c` (duplicate "Implement r4") and `t_122639ef` ("param-test").
- Optionally archive `t_27e12c05`. It is done, and it carries a stale "phantom task id" diagnostic from the front door's placeholder id.

## 2. What shipped

An owner in Edit mode presses **Model**, pastes an `https://` URL or a root-relative path, presses **Check**, then **Save**. The model appears 2.5 m ahead and behaves like any node: move, rotate, scale, rename, duplicate, delete, undo and redo. In the world it is a mesh-less node with `extras.atrium.model = { url, sha256?, bounds? }`. Every visitor's browser fetches and renders it, and its content never enters the world document.

**Files** (from `5a31a3a` to `f8e5aa9b`), roughly:
- **`packages/client`:** `model-spec.js` (the URL and value rules) and `model-fetch.js` (the limited fetcher).
- **`packages/renderer-three`:**
  - `model-parse.js`: preflight, parse, the template cache, the texture budget;
  - `model-instances.js`: clone, name isolation, retargeting;
  - `model-bridge.js`: lifecycle, ordering, placeholders.
- **`apps/client`:**
  - `model-form.js`, `model-listeners.js`, and `app.js` (wiring);
  - `index.html`: the Model button, form, panel row and import maps;
  - the import maps in `tools/som-inspector` and `apps/playground`;
  - `edit-duplicate.js` (the model rule).
- **`packages/server`:** `send-policy.js` (`checkModelExtras`) and `session.js` (the no-mesh rule on `add`).
- **Shared:** `tests/fixtures/model-spec-vectors.json`, used by the server, client and Duplicate tests.

**The security boundary.** Public worlds load models automatically, so all of this is enforced in the client:
- **URL rule (A1):** `https://` or a single-slash root path, with no control characters, backslashes or credentials. The same rule runs on server `add`; `send` can't write the field.
- **Requests (A2):** `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`, and redirects followed then checked (L17).
- **Size and time:**
  - 25 MiB per model, counted per chunk;
  - a 150 MiB ledger per world that is never refunded;
  - one 30 s deadline per job, with waiting time excluded.
- **Fail-closed resource loading for both formats:**
  - a `.glb` may only use embedded images and buffers (round 6 M1);
  - a `.gltf`'s dependencies are prefetched and rewritten to `blob:` URLs;
  - the URL modifier passes only `data:` and `blob:`.
- **Preflight before parsing:**
  - at most 10,000 nodes, 500k vertices and 64 MiB of accessor data;
  - PNG, JPEG or WebP only, with range-checked headers and sides of at most 4096 px;
  - Draco, meshopt and KTX2 are refused.
- **The texture budget:** **512 MiB per world** (L20), with each generation owning its own budget. Admission is in `som.allNodes` order, so the owner and every visitor refuse the same models.
- **Name isolation:** model parts are unnamed and clips are retargeted by identity, so a part named like a world node can't hijack picking, selection or animations. Imported lights and cameras are removed.
- **A placeholder with the reason** for every refusal, including `bad-spec` for an invalid node.

**Tests at the accepted code (r5/r6 handoffs):**

| Package | Files | Tests |
|---|---|---|
| server | 33 | 499 |
| client | 12 | 290 |
| renderer-three | 10 | ~175+ |
| interaction | 1 | 9 |
| apps/client | 25 | ~581+ |

All files are run one by one under `timeout 180`, with no force-exit. Round 6 added tests on top; see its handoff.

## 3. How the round ran

| Round | SHA | Spec | Found afterwards by |
|---|---|---|---|
| 1 | `8a902f59` | pre-brief Rev 2 | Claude's browser checks: no page loaded (import maps), Save threw, models never rendered (no fetcher), repeated downloads |
| 2 | `83ee8afe` | `REVISION-models-by-url.md` (V1–V5) | Claude: the texture budget was never charged (preflight return shape), and `data:` images unchecked |
| 3 | `d1db9ad1` | `-r3.md` (W1–W2) | Claude: eviction of in-use templates, and the owner's Check bypassing the budget |
| 4 | `a1847bb3` | `-r4.md` (W3–W4) | Claude: admission in arrival order, not document order (A10) |
| 5 | `ee8d39f5` | `-r5.md` (W5, W6/L20) | **Outside code review (NO-GO):** GLB external URIs (confirmed in the browser), redirect URL, deadline, late-parse budget, truncated headers, and four should-fixes |
| 6 | `f8e5aa9b` | `-r6.md` (M1–M5, S2, S3, S5, S7) | Re-review "provisional NO-GO" (S3 residual; M3 and M5 not run). Claude ran M3 and M5 and found S3 unreachable through the UI. **GO.** |

Then the docs-only merge (§4.7), DEV, the operator's acceptance, MAIN and PROD.

**Timeline (PT):**
- 10-19 ~23:20: pre-brief Rev 1.
- ~23:30: kickoff.
- ~23:56: outside review of the pre-brief, giving Rev 2 (§12).
- 10-20 00:20: implementation.
- ~05:20: round 1 on DEV.
- Rounds 2–6 between 05:40 and 12:00.
- ~12:30: re-review.
- 14:35: acceptance.
- ~15:00: PROD.

## 4. Findings and lessons

### 4.1 Browser checks are mandatory for client work
Rounds 1–4 had all-green Node suites and GLM approvals, yet four of the defects made the feature unusable or unsafe in a browser:
- **Import maps:** Node resolves `package.json` exports; browsers need import-map entries.
- **App wiring that unit tests stub out:** `firstFreeName` received a string, and the bridge was never given a fetcher.
- **Async ordering and bookkeeping** across real loads.

The DEV deploy's own check only fetches `app.js` as a file, so a page that can't load still passes. **Future client rounds should carry a browser smoke check** (§5). Consider adding one to `atrium-deploy`'s checks, for example loading the client page headlessly and asserting `window.atriumClient` exists.

### 4.2 Outside code review found what testing couldn't
Round 5 passed every browser check, yet the outside review found that a `.glb` could make every visitor fetch arbitrary URLs (M1). Over five rounds, the spec and every reviewer had treated "external resources" as a `.gltf` concern only. The test fixtures never declared external URIs, so no test could see it.

**Lesson:** for any untrusted-content boundary, have an adversarial outside review **before** release. Ask it explicitly to try to escape each limit. The round-6 re-review prompt is a good template.

### 4.3 GLM reviews: variable depth
- Round 1's GLM review approved in about 5 minutes, "reading all 25 files" with only 7 reads. It reproduced 6 of 14 proofs and missed V1–V4.
- From round 2 on, the review cards required reproducing **every** proof and quoting specific test outputs, and those reviews were materially better.

**Keep both requirements** in review bodies. Don't treat a GLM APPROVE as evidence of browser behavior.

### 4.4 Tool fault: `kanban_create` from orchestrator and worker sessions drops fields
- **Since about 08:15 PT on 10-20** (round 2's cards at 05:42 were fine): creates made from the orchestrator and worker sessions lost `body`, `parents` and `max_runtime_seconds`, and completion **metadata** came back empty.
- **The front door's** creates were unaffected.
- **Round 2's gate** reported "guard refused (found 0 distinct SHA)", but `atrium-kanban-guard.log` has **no `block` entry** for it. The calls failed before reaching the guard, and the model invented the guard message.
- **Round 4's kickoff** worked around it with body-as-comment plus `kanban_link`, but left strays and a `param-test` card. Its gate created one release card, then ran out of iterations.
- **Rounds 5–6 used a pattern that worked:** the review gate **creates nothing**. On APPROVE it blocks with "APPROVE `<SHA>`: front door, build the release chain", and the front door builds the four cards, links the finalizer to the sentinel and completes the gate.
- **Open:** find the cause on the host. Check for a Hermes or orchestrator-model change, or a tool-schema change for those profiles, between 05:42 and 08:15 PT on 10-20.

### 4.5 Iteration budgets, not time, stopped workers
- Round 1's implementation stopped twice at `max_turns: 150` (about 13–15 minutes each) and needed a continuation comment and an unblock.
- **`max_turns` is now 300** in `/root/.hermes/profiles/atrium-deepseek/config.yaml` and `atrium-glm/config.yaml` (line 12, under `agent:`; backups `config.yaml.bak-max-turns`). The orchestrator stays at 150.
- Rounds 2–6 each finished in one run.
- A card's runtime cap is the DB column `tasks.max_runtime_seconds`. It can be raised on a `todo` card through `hermes_cli.kanban_db_connect` (recipe in §5.3). The guard keeps the larger of the caller's value and its default, so pass it explicitly at creation.

### 4.6 The front door stalled once
Before round 6 it went off on a "pending skill update", the patch failed, and it then hung for about 15 minutes on a model response with no board activity. Stopping it and re-sending a narrow instruction fixed it. **Keep front-door requests to one job.**

### 4.7 MAIN must fast-forward; revision docs on `main` break that
- **The cause:** the workflow branch was cut from `5a31a3a`, and each round's `REVISION-*.md` upload advanced `main`. So at release, `atrium-main-push` would refuse (not a fast-forward). It checks before consuming the approval, so nothing is lost.
- **The fix used here:**
  1. A merge of `main` into the accepted SHA, made on the host in a throwaway clone and pushed to `claude/models-by-url-release`.
  2. Claude verified that the parents were exactly the accepted SHA and `main`, and that the diff touched only `devtasks/`.
  3. Then `atrium-deploy dev`, accept, MAIN and PROD on the merge SHA.
- **For next time:** either upload revision docs to a non-`main` branch during a round, or plan this merge step into the release.

### 4.8 Smaller notes
- **AGENTS.md's port table is stale.** The worker couldn't write that protected file. Correct entries: 3019 (`avatar.test.js`), 3020 (`world-crud.test.js`), 3060 and 3061 (`teleporter.test.js`), 3070 (`model-extras.test.js`), 3183 and 3184 (`reconnect-session.test.js`).
- **Deploy cards' handoffs** sometimes say only `DEPLOY_OK <sha>`, and the DEV finalizer then blocks for lack of a health result (r6, `t_9f295db1`). Health is guaranteed by `atrium-deploy` before it records DEV. Either complete the finalizer from the host, or have the deploy body require the health line.
- **At 512 MiB, five typical 2048 px PBR models fit** (six come to about 16 bytes over, because each texture's estimate is rounded up), or about twenty-four of 3b's 1k library items.
- **Textured models appear one at a time,** in world order. Parsing is serialized (A5), and in software rendering each 2k model took a few seconds to parse.

## 5. Recipes

### 5.1 Claude's browser harness (scratch, not committed)
Rebuild it in the session's scratchpad:
- **Bundles:** `npm i esbuild @gltf-transform/{core,extensions,view}@4.3.0 three@0.163.0`. Bundle `core` whole; `extensions` with core external; `view` with three and the two gltf-transform packages external. Then rewrite `three/examples/jsm/` to `https://esm.sh/three@0.163.0/examples/jsm/`.
- **Routing:** Playwright (Python) routes `https://esm.sh/**`:
  - `three@0.163.0/examples/jsm/*` **and** `three@0.163.0/addons/*` (the SOM inspector maps `three/addons/` that way) to three's `examples/jsm`;
  - bare `three@0.163.0` to `build/three.module.js`;
  - `@gltf-transform/{core,extensions,view}@` to the bundles. **Match on the URL path, not the query:** the view URL's `?deps=` contains `core@`.
- **Server** (`server.mjs`), a fresh one per run:
  - static files over the checkout, plus `attachSessionHandlers({ wss, world: createWorld(tests/fixtures/space.gltf), worldOwnerUserId: 'owner' })`, with every upgrade as `'owner'`;
  - `/api/auth/me` answers 401;
  - `/models/*` is served from a fixtures folder with `access-control-allow-origin: *` and per-path GET counts at `/__counts`;
  - `normalize()` the models folder path before the containment check.
- **Hooks:**
  - `window.atriumClient` and `window.stage`;
  - in a scratch copy only, `const modelBridge = window.__mb = createModelBridge(` in `app.js`, to read `__mb.textureBudget.taken`, `__mb.status(name)`, and to trace `reserve` and `release`.
- **Models:**
  - CC0 Khronos samples from `raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/<Name>/glTF-Binary/<Name>.glb`, all served with CORS `*`. Avocado, BoomBox, Lantern, WaterBottle and AnimatedMorphCube are CC0. BoxAnimated and Duck are not.
  - Generated adversarial fixtures:
    - parts named like world nodes, with a clip;
    - 600k vertices; 27.6 MB; 10,001 nodes;
    - a Draco-only `.gltf`; an 8192² PNG header;
    - a truncated PNG;
    - **a GLB whose JSON declares an external image URI.**
  - Distinct copies of one file via `?v=N` query strings (the dedupe key is the canonical URL).
- **Gotchas:**
  - Don't `pkill -f` a pattern that matches your own shell command. Kill by PID.
  - Allow about 45 s for several 2k models to parse in SwiftShader.

### 5.2 Release when `main` moved (§4.7)
```bash
rm -rf /root/tmp-release && git clone -q https://github.com/joshmaurice/atrium /root/tmp-release && cd /root/tmp-release
git checkout -q -b claude/<slug>-release origin/workflow/<slug>
git -c user.name="…" -c user.email="…" merge --no-ff -q origin/main -m "<slug>: merge main (docs only) so MAIN can fast-forward"
X=$(git rev-parse HEAD); git diff --name-only <accepted sha> $X   # only devtasks/
git merge-base --is-ancestor origin/main $X && echo "FF OK"
git push -q origin claude/<slug>-release
atrium-deploy dev $X        # then accept, atrium-main-approve/-push $X, then the PROD block with S=$X
```

### 5.3 Raise a `todo` card's runtime cap (host)
```bash
env -u PYTHONPATH -u PYTHONHOME /usr/local/lib/hermes-agent/venv/bin/python - <<'EOF'
from hermes_cli import kanban_db_connect as kbc
with kbc.connect_closing(board='atrium') as conn:
    with kbc.write_txn(conn):
        n = conn.execute("UPDATE tasks SET max_runtime_seconds=<new> WHERE id='<t_id>' AND status='todo' AND max_runtime_seconds=<old>").rowcount
    print('updated', n, tuple(conn.execute("SELECT id,status,max_runtime_seconds FROM tasks WHERE id='<t_id>'").fetchone()))
EOF
```
`hermes` is a bash wrapper, so use the venv's Python. `fetchone()` returns a `sqlite3.Row`, so wrap it in `tuple()` to print it. Don't run these with `set -e` on: a syntax error will close the SSH session.

### 5.4 Look inside the Hermes worktree from the host
The worktree's `.git` file points at the container's paths, so run git inside the container:
`docker exec hermes-c6b7f940 git -C /workspace/wt/<slug> log --oneline <base>..HEAD`.

### 5.5 A continuation after the iteration budget
Post a comment on the card naming the committed steps, what's left and any accepted deviation. Then run `hermes kanban --board atrium unblock <id>`. This works for a dispatcher "gave up" block, which isn't an operator gate.

## 6. Follow-ups

### 6.0 Prerequisite for the next round: the release merge without the operator (operator request, 10-20)
**Problem (§4.7):** revision docs uploaded to `main` during a round put `main` ahead of the workflow branch, so `atrium-main-push` can't fast-forward. This round, the operator had to run §5.2 by hand.

**Wanted:** the release chain handles it. After the GLM APPROVE of `<SHA>`, the Publish step:
1. merges `origin/main` into `<SHA>` when `main` isn't already an ancestor;
2. refuses unless the merge is clean and `git diff --name-only <SHA> <merge>` touches only `devtasks/`;
3. publishes the merge.

The DEV deploy, acceptance, MAIN and PROD then all use the merge SHA, and the acceptance card names both SHAs.

**Where:** most likely `atrium-deploy`'s publish action, or a new deployer action. These are host scripts that Hermes can't change, so the pre-brief should spell out the change for the operator or for Claude on the host. Read them with `read_file("atrium-deploy")` and `read_file("atrium-main-push")` first.

**Not wanted:** changing where the operator uploads docs.

**Note:** cutting the workflow branch is already automatic. Workers branch from a freshly fetched `origin/main`, per the card operating notes.

### 6.1 A small hardening round (models-by-url follow-up)
From the outside review, deferred, none of them security:
- **S1.** Dependency URIs that alias one canonical URL (`./a.png` and `a.png`) are fetched once, but only one is rewritten, so a valid model is refused. Map every original URI.
- **S3 hardening.** `model-form.js` `check()`'s `finally` should only touch state if its generation is current. Today that path isn't reachable through the UI.
- **S4.** Dispose placeholder geometries and materials, and instance-owned skeleton resources, on replace and remove (a slow leak across editing).
- **S6.** The owner's Check runs outside the four-transfer queue, and dependencies aren't deduplicated across different `.gltf` files in a world.
- **S8.** A shared in-flight load belongs to whichever node started it. Removing that node can fail the load for others.
- **N1.** Clear `withTimeout`'s timer.
- The AGENTS.md port table (§4.8).
- A browser smoke check in `atrium-deploy`, or as a pipeline stage (§4.1).

### 6.2 Known limitations (by design, recorded)
- **No touch movement:** you can't walk onto a teleporter on mobile.
- **Undo history is per connection:** a reconnect starts it fresh (step 2's design). Persisting history would be its own feature.
- **Models don't play their animations yet** (step 4).
- **Model fields can't be edited after placement** (L3). To change a model, delete it and add another.

### 6.3 Next in sequence (operator's order)
- **Step 3b:** the starter library, the sky, and Caddy and library hosting. Decisions L13–L15 are already made (pre-brief §3, §9 sketch). The 512 MiB budget fits about twenty-four 1k library items.
- **The richer `add`**, then **the copy step** (copy-objects passdown C1–C4). Note for copy: a root-relative model URL means something else on another server, so a copy may need to make it absolute.
- **Pass B** (connector writes) and edit-polish-3 remain open from earlier passdowns.
- **Host investigation of §4.4's `kanban_create` fault.**
