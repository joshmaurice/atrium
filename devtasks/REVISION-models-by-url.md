# Revision: models-by-url, round 2 (after Claude's §5.1 checks of `8a902f59`)

Status: **for the operator, 2026-10-20.** The fixes below are mechanical; no
decision is needed beyond "do this revision".
- **Reviewed SHA:** `8a902f59017504b02d6d39edd8d68aed3e419df9` (workflow/models-by-url, GLM APPROVE, on DEV since ~05:20 PT).
- **Spec:** `devtasks/PREBRIEF-models-by-url.md` FINAL Rev 2 (incl. §12), unchanged. This file adds no decision; it lists defects against that spec and the tests that would have caught them.
- **How they were found:** headless Chromium against the published SHA, a fresh owner-only world server per run, and test models served root-relative (`/models/...`). Steps as edit-polish-2 passdown §6.5, plus routing esm.sh's `three@0.163.0/addons/`. All four defects reproduce in the browser and are invisible to the Node suites (which all pass: server 499, client 290, renderer-three 152/153, apps/client 556).
- **Scope:** `apps/client`, `tools/som-inspector/index.html`, `apps/playground/index.html`, `packages/renderer-three`. No server, protocol or `packages/client` source change. No DEV restart is required by these files, but none is harmful.

## 1. Defects (must fix)

### V1. No page that imports the new modules can load (import maps)
`app.js`, `edit-duplicate.js`, `model-form.js` and `renderer-three`'s
`model-bridge.js` import `@atrium/client/model-spec` and
`@atrium/client/model-fetch`. `packages/client/package.json` exports them, so
Node resolves them. **No browser import map does.** `renderer-three/src/index.js`
now re-exports the bridge, so every page that imports `@atrium/renderer-three`
fails too.

| Page | At `8a902f59` | With the two import-map lines |
|---|---|---|
| `apps/client/index.html` | `Failed to resolve module specifier "@atrium/client/model-fetch"`; `window.atriumClient` never exists | loads; owner gets Edit |
| `tools/som-inspector/index.html` | same error | loads, no errors |
| `apps/playground/index.html` | same error | loads, no errors |

**DEV's client page is broken now.** The deploy's check fetches `app.js` as a file, so it passed.

**Fix:** in all three import maps, after the `@atrium/client/AnimationController` line:
```
"@atrium/client/model-spec":            "../../packages/client/src/model-spec.js",
"@atrium/client/model-fetch":           "../../packages/client/src/model-fetch.js",
```
**Guard (new test, `apps/client/tests/importmap-guard.test.js`):**
- For each of the three HTML files, parse its `<script type="importmap">`.
- Starting from the page's module entry points, follow the static import graph: relative imports, plus any specifier the map resolves to a repo path.
- Assert every bare specifier met is a key of that page's map, either exact or a trailing-`/` prefix.
- Reads files only; no browser.

### V2. Save never adds a model (`firstFreeName` wiring)
`app.js` ~L2761 passes the form `firstFreeName: (text) => firstFreeName(text, '', isNameFree)`.
`firstFreeName`'s second argument is a **function** (`suffix(n)`), so every
Save throws `TypeError: suffix is not a function` (page error) and sends nothing.
`model-form.test.js` injects its own `firstFreeName`, so the real wiring was never run.

**Fix:**
- Add `modelName(stem, isFree)` to `edit-palette.js`, next to `teleporterName` and `copyName`: `firstFreeName(stem, (n) => (n === 1 ? '' : \` ${n}\`), isFree)`.
- Give it tests: a free stem is kept; `chair` taken gives `chair 2`; it is cut to the name rules.
- `app.js` passes `firstFreeName: (text) => modelName(text, isNameFree)`.
- The import guard (`import-guard.test.js`) covers the new import.

### V3. Placed models never render (the bridge has no fetcher)
`app.js` creates the bridge with `som`, `listViews`, `worldBaseUrl`, `nextFrame`
and `onStatus`, but **no `hooks.fetchModel`**. `createModelBridge` then falls
back to `defaultFetchModel()` (`model-bridge.js` ~L418), which always returns
`network: "no fetcher was configured"`. Every saved model stays an amber
placeholder, and the Edit panel says "no fetcher was configured". Check
works only because the form calls `fetchModel` itself.

With `hooks: { fetchModel: (args) => fetchModel(args) }` added, models render:
two parts, both unnamed, in one plain `Object3D` wrapper. A visitor's page
renders them too.

**Fix:**
- **Remove the silent default.** `createModelBridge` throws if `fetchModel` isn't given, with a test.
- `app.js` passes the real `fetchModel`.
- The bridge's tests already inject one, so nothing else changes.

### V4. Every add, Redo and Duplicate downloads the model again
`load()` (`model-bridge.js` ~L169) calls `fetchModel` **first** and consults the
template cache only afterwards, keyed on the fetched `effectiveUrl`. In the browser (V3 fixed), counting GETs for one model:

| Action | Spec | Seen |
|---|---|---|
| Check, then Save | 1 fetch (A8: "Check then Save, 0 new fetches") | 2 |
| Delete the only instance, then Redo | 0 new (A8) | 1 new |
| Duplicate | 0 new (A4: "two nodes with one URL download once") | 1 new |

Each repeat is charged to the world's 150 MiB ledger (A4, never refunded).
Duplicating an 8 MiB model about 18 times therefore fails every later model
in that world with `world-download-budget`.

**Fix:**
- Before fetching, look up the cache, and a map of **in-flight** loads, under the key the spec determines: `templateKey(resolvedUrl, sha256)`, where `resolvedUrl` is the spec URL resolved against `worldBaseUrl`.
- On a hit, use the template, or await the in-flight load. On a miss, fetch, then store the template under that key **and** under `templateKey(effectiveUrl, sha256)` when a redirect changed it.
- The form's held Check (`holdCheckedTemplate`, `app.js` ~L2690) uses the same key function, so Save finds it.

**Tests, with a counting stub `fetchModel`:**
- two nodes with one URL, added together: 1 fetch;
- delete the only instance, then Redo: 0;
- Duplicate: 0;
- a held Check, then a node with that URL: 0;
- a pinned and an unpinned spec of one URL: 2 (different keys);
- after `resetWorld()`, the same URL: 1.

## 2. Should fix (same round, small)
- **V5. Plain-text URL problems in the form.** A refused URL shows the raw code (`url-scheme`, `url-chars`) in `#model-status`. Map it through `modelReasonText`, or a URL-problem text table, so the owner reads e.g. "the address must start with https:// or a single /".

## 3. Not code (operator)
- The AGENTS.md test-port table (reconciliation item 9). The worker couldn't write that protected file. It will be updated with the passdown: add 3019 (`avatar.test.js`), 3020 (`world-crud.test.js`), 3060 and 3061 (`teleporter.test.js`), 3070 (`model-extras.test.js`), 3183 and 3184 (`reconnect-session.test.js`).

## 4. Steps (one commit each, on `workflow/models-by-url` from `8a902f59`)
1. V1: the three import maps and the import-map guard test.
2. V2: `modelName`, its tests, and the `app.js` wiring.
3. V3: the required fetcher, its test, and the `app.js` wiring.
4. V4: cache and in-flight lookup before fetching, with the fetch-count tests.
5. V5: plain-text URL problems, with a form test.
6. Full suites, as in round 1 (every server file on its own under `timeout 180`, no force-exit), then the proofs below, then the handoff.

## 5. Proofs (each caught by a named test; restore from a saved copy, never `git checkout`)
- (o) delete one `model-fetch` line from any of the three import maps;
- (p) restore the string `''` as `firstFreeName`'s suffix inside `modelName`;
- (q) construct the bridge with no `fetchModel` (bring back the default);
- (r) move the fetch back ahead of the cache lookup;
- (s) drop the in-flight map (two nodes added together fetch twice).

## 6. Worker and reviewer notes
- **The worker's iteration budget is 150 calls per run.** Commit at every step. Write ONE script for all the proofs. The continuation rules from round 1 apply.
- **The reviewer must reproduce every proof (o)–(s) itself**, not a subset, and must quote the import-map guard's output for all three pages. Round 1's review approved `8a902f59` while V1–V4 made the feature unusable in a browser.
- Release path as before: publish, DEV deploy, finalizer, then the acceptance gate (a new one, for the new SHA). Claude reruns the browser checks on the new SHA before the operator's outside review and DEV acceptance.
