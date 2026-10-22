# Pre-brief: Phase 3 step 3b — the starter library, the sky, and library hosting

Status: **DRAFT, Revision 0 (2026-10-21, ~23:59 PT). Decisions L21–L30 (§3)
await the operator.** L13–L15 were decided on 2026-10-19 (models-by-url
pre-brief §3) and carry into this round; §3 refines L13's catalog path (L21).
- **Drafted by Claude from a clone of `main` at `9e7478f`.** Its runtime code
  is identical to the released `82c1d40e` (DEV, MAIN record and PROD): the
  only commit since is the models-hardening passdown upload. Claims marked
  *probe* were checked against the code or Poly Haven's live API, not
  committed.
- **Board and host at drafting** (ops connector, 2026-10-21 ~23:45 PT):
  release `COMPLETE` at `82c1d40e`; nothing ready, running or blocked; DEV
  and PROD healthy; deploy lock free. The only warning is MAIN record vs
  `origin/main` (the passdown upload).
- **Sources:** design `docs/DESIGN-phase3-placement-scripting.md` §4.4;
  models-by-url pre-brief §3 (L13–L15), §9 (3b sketch), §12 (A1, A2, A5);
  passdowns 10-20 (models-by-url) §6.3 and 10-21 (models-hardening) §2.1,
  §4.1, §6.3.
- **Scope:** a **Library** button and thumbnail grid in Edit mode that places
  pinned, self-hosted Poly Haven models through 3a's loader; a **Sky** picker
  writing the existing `extras.atrium.background`; `loadBackground` brought
  under 3a's request policy and limits, with the server checking new sky
  values; the library build tool and the Caddy route (host steps).
- **Out of scope:** model animations (step 4); the richer `add` and the copy
  step; uploads and live API browsing (design §4.4 "later"); `.hdr` skies;
  a default environment light for worlds with no sky (§9.3); the Hubs/Spoke
  kit (licence unverified, design §4.4).

## 1. What this round is

An owner in Edit mode presses **Library**, sees a grid of 24 thumbnails
("Models and skies from Poly Haven, CC0"), and clicks one. The item appears
2.5 m ahead like a Model add, already pinned (`sha256`) and with its bounds,
without a Check: the catalog has done the checking. Everything 3a gives a
model (move, rotate, scale, rename, duplicate, delete, undo, redo, the
placeholder, the limits) applies unchanged, because the node is an ordinary
`extras.atrium.model` node with a library URL.

The same panel gains a **Sky** select: None, or one of six library skies.
Choosing one writes `atrium.background = { type: 'equirectangular',
texture: <url> }`; every visitor sees it. Today any visitor's browser loads
whatever URL a sky names, at any size and over `http:` (P2), so this round
also puts the sky through the same request rules as models.

The files live outside git on the host (L13), served by Caddy at
`/assets/library/`. A build tool, run once by the operator on the host,
downloads the chosen assets, packs each model into one `.glb`, converts each
sky to a 4096 × 2048 JPEG, and writes the catalog that the pipeline round
then ships.

## 2. What the code does today (at `9e7478f`)

### P1. The sky is `extras.atrium.background`, loaded with no limits
`loadBackground(threeScene, bg, baseUrl)` (`packages/renderer-three/src/
load-background.js`, 63 lines) resolves `bg.texture` against the world's base
and hands it to `THREE.TextureLoader`. Then:
- `scene.background` **and** `scene.environment` are set to it, so a sky also
  lights PBR materials (three r163 builds the PMREM itself). Library models
  look much better under a sky than without one.
- A per-scene token drops a late texture from an earlier request.
- The previous texture is **never disposed** (a GPU leak per change).
- Called from `app.js` on `world:loaded` (L655) and on **every**
  `som:set` of `__document__` (L804–806): renaming the world re-downloads the
  sky. Also from the SOM Inspector (`app.js` L81, L245, L329).

### P2. What a sky URL can be today (*probe*)
- **Server** (`send-policy.js` L350–351): `atrium.background.type` is
  `'equirectangular'` or `'cubemap'`; `.texture` is any string of at most
  `DESTINATION_MAX` characters. So an owner can set `http://…`,
  `javascript:…`, a `data:` URI or a 40-megapixel PNG.
- **Client:** `TextureLoader` fetches it with the page's defaults (image
  element, `crossOrigin: 'anonymous'`, the page's referrer), no size,
  dimension or time limit. Every visitor does this automatically on entry.
- **Legacy form in use:** `tests/fixtures/atrium.gltf` names
  `skyboxtest1.png` (document-relative; 7.6 MB PNG, 3072 × 1536). The PROD
  commons may use the same form (unverified, §11 Q1). So the client must keep
  loading a document-relative sky that resolves to the world's own origin.
- `'cubemap'` is accepted by the server but the client only warns.

### P3. World Info writes already work, from the owner only
The client writes document extras by assigning `som.extras`; the SOM's
mutation event sends `{ type: 'send', node: '__document__', field: 'extras' }`
with a `seq` (`AtriumClient.js` L1116, L1237–1245), and a refusal comes back
as `edit:rejected` for that `seq`. The server diffs the proposed extras
against the current ones and refuses the message if any changed leaf isn't a
World Info leaf (`authorizeDocumentSend`, `collectChanges`): a sky write must
change **only** the two `background` leaves. A missing `background` object is
created leaf by leaf, so a world without a sky can gain one. Clearing is
`texture: ''` (a removed key is a refused change). Only the main client has
no World Info UI yet; the SOM Inspector edits these leaves as free text.

### P4. 3a's loader already does everything a library model needs
`fetchModel` (`packages/client/src/model-fetch.js` L574) applies A1, A2, the
25 MiB cap, the world ledger, the job deadline, the transfer limiter and
`sha256` pinning; `parseTemplate` applies A5's preflight; the bridge places,
isolates, budgets and disposes. `buildModelDescriptor` (`model-form.js` L73)
makes the `add` descriptor from `{ name, position, rotation, url, bounds,
sha256 }`. A library add needs no loader change.

### P5. The Add row and form pattern
`index.html` L568–583: palette buttons with `data-kind`, then
`#ep-teleporter` and `#ep-model` **without** `data-kind` (the palette
handler throws on an unknown kind). Forms register with `createFormGate()`
so one is open at a time; Save is a structural add answered through
`onStructureAnswer` (`app.js` ~L2302) with undo registration. The smoke check
requires `#ep-model` (models-hardening passdown §2.2).

### P6. Hosting
Caddy serves `/srv/atrium-dev` and `/srv/atrium` (`file_server` for
`/apps/client/*`, `/tools/protocol-inspector/*`, `/packages/*`, with
`hide node_modules .git .env* .npmrc`, `Cache-Control: no-cache`). Site
blocks list old and new names (`ewwb.dev` and the sslip names). There is no
`/assets/*` route and no `assets/` directory. **A repo-root
`assets/library/catalog.json` (L13's wording) would not be served** without a
new route into the checkout (L21).

### P7. Poly Haven, as the build tool will see it (*probe*, live API 10-21)
- `GET https://api.polyhaven.com/files/<id>` for a model has a `gltf` key
  with `1k`/`2k`/`4k`; each holds the `.gltf` (`url`, `size`, `md5`) and an
  `include` map of **relative path → `{ url, size, md5 }`**. `ArmChair_01`
  at 1k: `.gltf` 2.6 KB, one `.bin` 154 KB, three JPGs (diff, nor_gl, arm),
  **769 KB in all**. The 1k `.bin`'s URL points into the `4k/` folder: the
  tool must save each include at its **key** path, not its URL path.
- For an HDRI the keys are `hdri` (`.hdr`/`.exr` at 1k–16k) and
  `tonemapped`: **one JPG at full resolution** (22 MB for
  `kloofendal_48d_partly_cloudy_puresky`). **There is no 4k or 2k JPG.** So
  L14's "library skies as equirectangular JPG (≤ 4096 × 2048)" needs a
  conversion step (L24).
- `GET /info/<id>` carries `name`, `authors` and `thumbnail_url`;
  `/assets?t=models&c=<category>` lists ids with polycounts. Furniture alone
  has 85 models; most are 1k–30k triangles.
- Assets are CC0; attribution is appreciated, not required. The API asks for
  a distinct `User-Agent`. The tool uses the API offline, once, not live.

### P8. Budgets for library items
A 1k PBR material is about three 1024² textures, about 16.8 MiB of 3a's
texture estimate (Σ w × h × 4 × 4⁄3). At 512 MiB (L20), about **24–30
distinct library items** fit one world; repeated items share a template and
count once. Downloads are small (about 0.5–3 MB each) against the 150 MiB
ledger.

## 3. Decisions for the operator

Each has a recommendation (**bold**). L13–L15 stand; nothing here reopens
them except L21's path refinement.

**L21. Where the catalog lives.** (a) **`apps/client/library/catalog.json`
in the repo**: served today by the `/apps/client/*` route with `no-cache`,
ships with the code that reads it, no Caddy change for it. (b) Repo-root
`assets/library/catalog.json` as L13 worded it, plus a second Caddy route into
each checkout. (c) On the host next to the files (no longer in git; L13 wants
git to be the source of truth).

**L22. The URL a library item or sky stores.** The catalog lists
root-relative paths (`/assets/library/…`). (a) **Store the path as is when
the world's origin is the page's origin; otherwise store the absolute URL on
the page's origin** (`new URL(path, location.origin)`), so a library item
placed in a world on another server still loads. (b) Always root-relative
(breaks in a world served elsewhere). (c) Always absolute on one canonical
host (`https://ewwb.dev/…`): ties DEV worlds to PROD's files.

**L23. File names and caching.** (a) **Content-addressed names**
(`models/<id>-<sha12>.glb`, `skies/<id>-<sha12>.jpg`,
`thumbs/<id>-<sha12>.webp`), `Cache-Control: public, max-age=31536000,
immutable`, and one append-only `/srv/atrium-library` shared by DEV and PROD
(each serves its own catalog over the same files). (b) Plain names with
`no-cache`, a rebuild overwriting files in place.

**L24. Making a 4096 × 2048 sky (P7).** (a) **The build tool downloads Poly
Haven's tonemapped JPG and downsizes it to 4096 × 2048, JPEG quality 85,
with `sharp`** (libvips; shrink-on-load keeps a 16k JPEG's decode within the
host's memory), installed only in the build tool's own directory, never in
the workspace. (b) Download the 4k `.hdr` and tonemap it in pure JS
(no native module, but our own tone curve, unlike Poly Haven's previews).
(c) 2048 × 1024 (lighter; visibly soft on a desktop screen).

**L25. The sky URL rule.** (a) **New values follow A1** (`https://` or a
single-slash root path, no control characters, backslashes or credentials),
or `''` to clear, **checked by the server** on the `background.texture` leaf
and by the client before loading; the client also still loads a **legacy**
document-relative value (P2) but only when it resolves to the world's own
origin. `background.type` stays as is. (b) Client-side only (the server keeps
accepting any string; every client refuses it).

**L26. Sky limits.** (a) **16 MiB download, the 30 s deadline, A2's request
policy (credentials omitted, no referrer, redirects followed then checked),
PNG/JPEG/WebP only by header (3a's `imageHeader`), each side ≤ 4096 and
width × height ≤ 4096 × 2048; outside the 512 MiB model budget (one sky at a
time); the previous texture disposed on change; reloaded only when the
resolved URL changes.** The legacy 3072 × 1536 fixture passes. (b) As (a)
but charged to the model texture budget (a sky then evicts about two library
items' worth).

**L27. Placing from the grid.** (a) **A click on a tile adds at once** at the
palette placement, named `firstFreeName(catalog name)`; the grid stays open
for more; one library add in flight at a time (tiles disabled until the
answer); a refusal shows in the grid's status line. (b) Select a tile, then
an Add button.

**L28. Which items.** (a) **Appendix A's 24 models and 6 skies**, all
checked to exist on 10-21; the operator strikes or swaps freely before the
build. The build tool's `--check` re-verifies ids, sizes and limits before
anything is downloaded. (b) Fewer, larger (2k) models.

**L29. The Sky picker.** (a) **A "World" row in the Edit panel with one
select: None + the catalog's skies.** When the current texture isn't a
catalog sky it shows a disabled "Custom" option (the SOM Inspector remains
the way to set an arbitrary URL). Not undoable (L14). A refusal reverts the
select and shows the reason. (b) Also a free URL field in the main client.

**L30. Lane and order.** (a) **Host part first, then one pipeline round.**
Claude drafts the build tool and the Caddy block on a `claude/` branch and
tests the tool against a local mock of the API (the workspace can't reach
Poly Haven); the operator runs it on the host, installs the Caddy route, and
uploads the generated `catalog.json` to `main` **before kickoff** (a
non-`devtasks/` upload mid-round is refused by the release merge,
models-hardening §2.1). Then the pipeline: client, renderer and server, with
a DEV restart (the server's sky check). (b) Pipeline first with a fixture
catalog, library later (DEV acceptance couldn't place real items).

## 4. Contract (per the recommended decisions)

### Host part (before kickoff; not Hermes)

#### H1. The build tool (`scripts/library-build/`, outside the pnpm workspace)
- **Why outside the workspace:** `pnpm-workspace.yaml` covers `packages/*`,
  `tools/*` and `apps/*`; anything there is installed and tested by
  `atrium-deploy`. The tool's dependencies (`@gltf-transform/core`,
  `/extensions`, `/functions` 4.3, `sharp`) must never enter a deploy. It has
  its own `package.json` and `package-lock.json`, SPDX headers, and its own
  `node --test` tests.
- **Input:** `scripts/library-build/items.json` (Appendix A's ids, display
  names, categories).
- **`--check`:** for each id, `GET /info/<id>` and `/files/<id>`; refuses an
  id with no `gltf.1k` (models) or no `tonemapped` (skies); sums sizes;
  prints a table. Downloads nothing else.
- **Build, per model:**
  1. download the 1k `.gltf` and every `include` into a fresh temp directory
     at the include's **key** path (P7), checking each `md5` and size;
  2. `NodeIO.read` the `.gltf` (`ALL_EXTENSIONS` registered), refuse any
     `extensionsRequired` outside a short allowlist (none expected) and any
     Draco, meshopt or KTX2 (L7);
  3. write one `.glb` with every image and buffer embedded (3a's GLB rule);
  4. measure with the same rules 3a enforces, and **refuse** above: 25 MiB,
     500,000 vertices, 10,000 nodes, 64 MiB of accessor data, any image side
     over 4096, or a texture estimate over 64 MiB (a library item should
     never take an eighth of a world's budget);
  5. compute `sha256`, `bounds` (`getBounds` of the scene, size per axis,
     clamped to 3a's 0.001–1000), vertices, bytes and texture estimate;
  6. fetch `thumbnail_url`, resize to 256 × 256 WebP.
- **Build, per sky:** download `tonemapped` (checking `md5`), resize to
  4096 × 2048 JPEG q85 (L24), thumbnail 256 × 128 WebP.
- **Output:** a staging directory with `models/`, `skies/`, `thumbs/` under
  content-addressed names (L23) and `catalog.json` (Z1's shape). It never
  writes into `/srv/atrium-library` itself.
- **`--verify <dir> <catalog>`:** re-hashes every file the catalog names.
- **Network etiquette:** `User-Agent: atrium-library-build/1 (+https://ewwb.dev)`,
  one request at a time, retry once on 5xx.
- **Tests (Claude, local):** a mock API and file server with tiny generated
  assets; cases for the include-path rule, an `md5` mismatch, each refusal,
  determinism (two builds, same hashes), and `--verify`.

#### H2. Running it (operator, host)
```bash
# as an unprivileged user (atrium-build), in a scratch clone of the tool's branch
git clone -q -b claude/library-build https://github.com/joshmaurice/atrium /var/tmp/lib-src
cd /var/tmp/lib-src/scripts/library-build && npm ci && node build.mjs --check items.json
node build.mjs --out /var/tmp/library-<date> items.json
node build.mjs --verify /var/tmp/library-<date> /var/tmp/library-<date>/catalog.json
# as root: append-only install
install -d -m 0755 /srv/atrium-library/{models,skies,thumbs}
cp -n -p /var/tmp/library-<date>/{models,skies,thumbs}/* …    # -n: never overwrite
```
Then upload `catalog.json` to `main` as `apps/client/library/catalog.json`
(L21), before kickoff.

#### H3. Caddy (both site blocks, DEV and PROD)
```
handle_path /assets/library/* {
    root * /srv/atrium-library
    header Access-Control-Allow-Origin "*"
    header Cache-Control "public, max-age=31536000, immutable"
    header X-Content-Type-Options "nosniff"
    file_server {
        hide .*
    }
}
```
Placed before the catch-all of each block. Back up the Caddyfile first;
`caddy validate`, then reload. **Check:** a `.glb` returns 200 with the CORS
header from both names; `/assets/library/` (the directory) returns 404, not a
listing; `/assets/library/../` can't escape.

### Code part (the pipeline)

#### Z1. The catalog (`apps/client/library/catalog.json`, `apps/client/src/library-catalog.js`)
```json
{ "version": 1,
  "credit": "Models and skies from Poly Haven (CC0)",
  "creditUrl": "https://polyhaven.com",
  "models": [{ "id": "ArmChair_01", "name": "Arm Chair", "category": "Seating",
    "url": "/assets/library/models/ArmChair_01-<sha12>.glb",
    "sha256": "<64 hex>", "bounds": [0.8, 0.9, 0.8],
    "bytes": 0, "vertices": 0, "textureBytes": 0,
    "thumbnail": "/assets/library/thumbs/ArmChair_01-<sha12>.webp",
    "license": "CC0-1.0", "authors": ["…"],
    "source": "https://polyhaven.com/a/ArmChair_01" }],
  "skies": [{ "id": "…", "name": "…", "url": "/assets/library/skies/<id>-<sha12>.jpg",
    "width": 4096, "height": 2048, "bytes": 0, "thumbnail": "…",
    "license": "CC0-1.0", "authors": ["…"], "source": "…" }] }
```
- `loadCatalog(fetchFn)`: same-origin `fetch`, at most 256 KiB, `version`
  must be 1. **Every entry is validated** and an invalid one is dropped with
  a console warning: `url` and `thumbnail` are root paths under
  `/assets/library/` that pass A1; models need `sha256` and `bounds` that
  pass 3a's rules (`model-spec.js`); skies need `width`/`height` within L26.
  A missing or broken catalog hides the Library button and leaves Sky with
  None only; the rest of Edit mode is unaffected.
- `storedUrl(path, worldBaseUrl, pageOrigin)` (L22): the path when
  `new URL(path, worldBaseUrl).origin === pageOrigin`, else
  `new URL(path, pageOrigin).href`.
- A test reads the **committed** catalog and checks every entry against these
  rules, so a bad upload fails the suite.

#### Z2. The Library grid (`apps/client/src/library-grid.js`; `index.html`; `app.js` wiring only)
- **Button:** `#ep-library` after `#ep-model`, **no `data-kind`**, the
  palette's enable rule (`!blocked && modes.edit`). Hidden when the catalog
  has no models.
- **Grid:** a panel under the Add row (like `#tp-form`), registered in the
  form gate as `'library'` (opening it closes the Model or teleporter form
  and vice versa). Tiles: thumbnail (`<img loading="lazy">`, alt = name),
  name; grouped by category; the credit line linking `creditUrl`; the
  privacy note is **not** shown (the files are ours, L12 is about third-party
  hosts). Closes on Cancel, Escape, Edit off and reconnect, as the forms do.
- **Click (L27a):** `buildModelDescriptor({ name: firstFreeName(entry.name),
  position, rotation, url: storedUrl(…), bounds: entry.bounds,
  sha256: entry.sha256 })` → the same structural add as the Model form's
  Save (`structure.begin('add', …)`, `undo.registerAdd`), answered through
  `onStructureAnswer`; the new node is selected. While waiting, tiles are
  disabled; a refusal shows in the grid's status line; the grid stays open
  after success.
- No Check, no fetch by the grid itself: the bridge loads the model like any
  other, pinned.

#### Z3. The sky loader (`packages/client/src/model-fetch.js`, `packages/renderer-three/src/load-background.js`)
- **`skyUrlProblem(texture)`** in `model-spec.js` (and its server mirror,
  Z5): A1, or `''`. **`resolveSkyUrl(texture, worldBaseUrl)`**: an A1 value
  resolves as models do; a legacy value (no scheme, not starting with `/`)
  resolves against `worldBaseUrl` and is accepted only if the result's origin
  is the world's origin; anything else is refused.
- **`fetchImage({ url, worldBaseUrl, signal, fetchFn, limits })`** exported
  from `model-fetch.js`, built on the existing internal `fetchOne`/`readBody`:
  `FETCH_OPTIONS`, redirect check (`redirectProblem`), 16 MiB cap counted per
  chunk, its own 30 s `createJobDeadline`. It does **not** use the world
  ledger or the transfer limiter (one sky; L26). Returns bytes or a reason.
- **`loadBackground`** becomes:
  1. clear (`''`, missing, or `type` other than `equirectangular`) →
     dispose the current sky texture, null both slots;
  2. if the resolved URL equals the current one → nothing (P1's reload on
     every World Info change goes away);
  3. bump the token, abort the previous sky fetch, `fetchImage`;
  4. `imageHeader` (from `model-parse.js`): PNG/JPEG/WebP only, sides ≤ 4096,
     area ≤ 4096 × 2048;
  5. decode via a `blob:` URL and `TextureLoader` (same decode and `flipY`
     as today), revoke the blob URL, check the token, set
     `EquirectangularReflectionMapping` and sRGB, dispose the previous
     texture, set both slots;
  6. on any refusal: dispose and clear both slots (a world whose sky fails
     shows no sky, as a failed model shows a placeholder, never the previous
     world's sky), log the reason, and report it through the returned
     promise so the Sky picker can show it to the owner.
- The SOM Inspector keeps calling `loadBackground`; it gets the same rules.

#### Z4. The Sky picker (`apps/client/src/sky-picker.js`; `index.html`; `app.js` wiring)
- A "World" label and row under the Add row with `<select id="ep-sky">`:
  None, then each catalog sky by name, then a disabled "Custom" option shown
  only while the world's texture isn't a catalog sky (L29a). Synced on
  `world:loaded` and on `som:set` of `__document__`.
- **Change:** build the new extras from a deep copy of the current
  `som.extras`, changing **only** `atrium.background.type`
  (`'equirectangular'`) and `.texture` (`storedUrl(…)`, or `''` for None);
  assign `som.extras`; remember `client.lastSendSeq`; call `loadBackground`
  locally (*probe*: the server's echo of the owner's own send resolves the
  pending edit but emits no `som:set`, `AtriumClient.js` L982–985).
- **On `edit:rejected` for that seq** (*probe*): the client does **not** roll
  the SOM back (`_resolveRejected` only emits). The picker restores the
  previous extras itself by assigning them again (a send with no changed
  leaf, which the server allows), restores the select, reloads the previous
  sky, and shows the server's message. `edit:unknown` (connection lost)
  needs nothing: the reconnect's `som-dump` brings the server's value.
- Enabled only in Edit mode, as the Add row.

#### Z5. Server (`packages/server/src/send-policy.js`)
- `'atrium.background.texture'`: `(v) => v === '' || skyUrlProblem(v) === null`,
  with `skyUrlProblem` mirroring Z3's (shared vectors, as
  `tests/fixtures/model-spec-vectors.json` does for models). The value
  already stored in a world is never re-checked (P3: only changed leaves are).
- `'atrium.background.type'` unchanged.

#### Z6. What does not change
3a's limits, reason codes and loader; the `add` check; World Info's other
leaves; the undo engine (a sky isn't undoable); the SOM Inspector's UI.

## 5. Tests
| Area | Tests (each in its package's suite) |
|---|---|
| Catalog | `loadCatalog`: size cap, wrong version, each invalid-entry rule drops only that entry, broken JSON → empty; `storedUrl` same-origin and cross-origin; **the committed catalog passes** |
| Grid | tile click builds the exact descriptor (pinned `sha256`, catalog `bounds`, free name); tiles disabled while waiting; refusal message; form gate (opening closes the Model form and back); Escape, Edit off, reconnect close it |
| Sky URL | shared vectors through client `skyUrlProblem` and server leaf: A1 cases, `''`, `http:`, `data:`, `javascript:`, `//host`, backslash, credentials, over-length; `resolveSkyUrl` legacy same-origin accepted, legacy escaping to another origin refused |
| `fetchImage` | request options, redirect to `http:` refused, 16 MiB cap mid-stream, deadline, abort |
| `loadBackground` | header checks (each format, oversize side, oversize area, zero size, truncated header); unchanged URL → no fetch; a new value disposes the old texture; a late response loses to a newer request; clear disposes; refusal clears and reports |
| Picker | change writes only the two leaves (a test diffs the sent extras); rejection restores the SOM's extras, the select and the previous sky; Custom shown for a non-catalog texture |
| Server | `world-crud`/send-policy: owner sets a library sky (allowed), `http:` refused, `''` allowed, other leaves still refused |

**Proofs** (each break must fail named tests; "not reproducible" is not an
acceptable result, models-hardening §4.3): (p1) the server leaf back to
`isBoundedString`; (p2) Z3's dimension check removed; (p3) `loadCatalog`'s
entry validation removed; (p4) `storedUrl` always returning the path;
(p5) the old texture's disposal removed; (p6) the unchanged-URL short-circuit
removed (a fetch count rises); (p7) the picker sending the whole extras
object with an extra changed leaf.

### 5.1 Claude's browser checks (after publish, before DEV acceptance)
With the harness of the 10-21 passdown §5.1, plus a copy of the real library
files and catalog served under `/assets/library/`:
- every catalog model places from the grid and reaches `loaded`; all 24 in
  one world stay within 512 MiB (`__mb.textureBudget.taken`);
- every sky loads; switching skies 10 times leaves
  `renderer.info.memory.textures` flat;
- renaming the world causes no sky request;
- the legacy `atrium.gltf` sky still loads; an `http:` sky (set by a raw
  `send`) is refused by the server; an oversize PNG served from a stubbed
  World Info is refused by the client with a reason;
- a page on origin A in a world on origin B: the stored URL is absolute on A,
  and loads (CORS);
- after DEV deploy, the same placement against `https://dev.ewwb.dev/`'s
  real `/assets/library/` (CORS header present, `immutable`).

## 6. DEV acceptance (operator, hard reload, owner; then a second browser as visitor)
1. Edit → **Library**: the grid shows thumbnails and the Poly Haven credit.
2. Click three different items: each appears ahead of you; Undo, Redo,
   Duplicate and Delete work; the visitor sees them.
3. **Sky**: pick a sky; the visitor sees it. Pick another, then None.
4. Rename the world (SOM Inspector or World Info): the sky doesn't flicker.
5. Reload: items and sky persist.
6. On the phone: the grid scrolls and the sky renders.

## 7. Worker rules and release path
As models-hardening §7, with:
- **Spec by git reference** (models-hardening §4.1) if this pre-brief's final
  revision is over about 40 KB; it is about 31 KB now, but the kickoff should
  reference it anyway, pinned by sha256.
- **Steps, one commit each:** (1) Z5 + shared sky vectors (server, client
  spec); (2) Z3 `fetchImage` + `resolveSkyUrl`; (3) Z3 `loadBackground`;
  (4) Z1 catalog module and the committed-catalog test; (5) Z2 grid;
  (6) Z4 picker; (7) full suites, proofs, handoff.
- **`--max-runtime 3h`**, `max_turns` 300; review card requires every proof
  reproduced and every §5 row present.
- **Release:** the automatic release merge (models-hardening §2.1); verify
  DEV from the journal until §4.2 there is fixed.
- **Before kickoff:** H1–H3 done; `catalog.json` on `main`; this pre-brief's
  final revision uploaded; no open sentinel; push dry run.
- **Outside code review** of the published SHA (a separate session), focused
  on Z3 (can a sky value still reach a non-A1 URL, or decode an oversize
  image?) and Z1 (can a catalog entry point off `/assets/library/`?).

## 8. Notes for the brief author
- `app.js` is 2,840 lines: new logic goes in `library-catalog.js`,
  `library-grid.js` and `sky-picker.js`; `app.js` only wires.
- `@atrium/client` stays renderer-neutral: `fetchImage` and
  `resolveSkyUrl` live there; decoding stays in renderer-three.
- Import maps: any new module path imported by the browser needs an
  import-map entry in `apps/client/index.html` (and the SOM Inspector's, for
  `loadBackground`'s new imports) — round 1 of 3a failed on exactly this
  (10-20 passdown §4.1).
- The smoke check requires `#ep-model`; adding `--require-id ep-library` is a
  host follow-up, not part of this round.
- `catalog.json` is data the worker must not edit; a test failure on it is a
  host-side problem to report.

## 9. Recorded, not done
1. Library items carry no C4 `origin` stamp (L15); the copy step will
   recognise `/assets/library/` URLs.
2. A rebuilt library with changed hashes leaves old files in place (L23's
   append-only rule); pruning unreferenced files is a later host task.
3. **Worlds with no sky have no environment light,** so PBR library models
   look dark next to primitives. A default `RoomEnvironment` when the sky is
   None is a small follow-up worth considering.
4. `'cubemap'` remains a server-accepted type the client ignores.

## 10. References
Design §4.4, §9 row 3; models-by-url pre-brief §3 (L13–L15, L20), §9,
§12 A1, A2, A5; passdowns 10-14 (Caddy, host facts), 10-20 §4.1, §6.3,
10-21 §2.1, §4.1, §4.3, §6.3. Code: `load-background.js`; `app.js` L640–655,
L804–806; `send-policy.js` L350–351, `authorizeDocumentSend`;
`AtriumClient.js` L1116, L1237; `model-fetch.js` L29–60, L356, L443, L574;
`model-parse.js` `imageHeader`; `model-form.js` L73–117; `index.html`
L568–583.

## 11. Open for the operator
- **Q1.** What does the PROD commons' `atrium.background.texture` say today?
  If it's document-relative, L25a keeps it loading; if it's `http:`, it will
  stop loading after this round (re-set it from the Sky picker).
- **Q2.** Strike or swap any of Appendix A before the build.

## 12. Revision log
- **Rev 0 (2026-10-21, ~23:59 PT):** drafted from probes at `9e7478f` and
  the live Poly Haven API.

## Appendix A. Proposed items (L28; ids verified on api.polyhaven.com, 10-21)

**Models (24, 1k):**
- Seating: `ArmChair_01`, `GreenChair_01`, `Sofa_01`,
  `mid_century_lounge_chair`, `painted_wooden_bench`,
  `plastic_monobloc_chair_01`, `wooden_stool_02`
- Tables: `WoodenTable_02`, `coffee_table_round_01`,
  `round_wooden_table_02`, `modern_coffee_table_01`, `wooden_picnic_table`,
  `side_table_01`
- Storage: `Shelf_01`, `wooden_display_shelves_01`,
  `steel_frame_shelves_01`, `painted_wooden_cabinet`
- Lighting (meshes only; imported lights are dropped, 3a): `street_lamp_02`,
  `Lantern_01`, `wooden_lantern_01`
- Plants: `potted_plant_04`, `fern_02`, `shrub_03`, `tree_stump_01`

**Skies (6, pure-sky HDRIs, tonemapped, 4096 × 2048):**
`kloofendal_48d_partly_cloudy_puresky`, `autumn_field_puresky`,
`farm_field_puresky`, `drakensberg_solitary_mountain_puresky`,
`belfast_sunset_puresky`, `evening_road_01_puresky`.
No night pure-sky was confirmed; one can be added after `--check`.
