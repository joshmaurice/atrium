# Pre-brief: Phase 3 step 3b — the starter library, the sky, and library hosting

Status: **FINAL, Revision 1 (2026-10-22, ~10:20 PT). Decisions L21–L31 (§3)
approved by the operator, all as recommended (2026-10-22, ~09:39 PT), and
the §9.5 deferral accepted.** Rev 1 also records how the host tool was built
(H1's implementation note). Rev 0.1 takes the operator's answer to Q1 (no live world
has a sky) into P2, L25, L26, Z3, §5 and §9, and adds L31. Rev 0.2 adds a
Misc category of ten models (Appendix A, L28, §5.1). **Rev 0.3 takes an
outside review of Rev 0.2 (NOT YET GO; findings R1–R7 and three smaller
notes, §13): H1, H2, Z1–Z4, §5 and §9 are amended in place, and §13 maps
each finding to its change.** **Rev 0.4 takes the re-review of Rev 0.3
(two must-fix, four should-fix, one nit; §14).** No decision changed; the reviewer agreed with
L21–L31 as recommended. L13–L15 were decided on 2026-10-19 (models-by-url
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
  writing the existing `extras.atrium.background`; the sky loader brought
  under 3a's request policy and limits, with the server checking new sky
  values; the library build tool and the Caddy route (host steps).
- **Out of scope:** model animations (step 4); the richer `add` and the copy
  step; uploads and live API browsing (design §4.4 "later"); `.hdr` skies;
  a default environment light for worlds with no sky (L31); the Hubs/Spoke
  kit (licence unverified, design §4.4).

## 1. What this round is

An owner in Edit mode presses **Library**, sees a grid of 34 thumbnails
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
- **`world:loaded` clears both slots itself first** (`app.js` L639–641; the
  Inspector at L217–218), and it **repeats on the same SOM** when an external
  reference loads (comment at L645). So "skip an unchanged URL" inside the
  loader would leave such a world with no sky (review R1).
- A texture that arrives after a newer request is dropped by the token check
  but **never disposed** (a second leak, review R4).
- The world boundary the model bridge uses is `connecting` and
  `disconnected` (`modelBridge.resetWorld()`, `app.js` L738, L753), not
  `world:loaded`.

### P2. What a sky URL can be today (*probe*)
- **Server** (`send-policy.js` L350–351): `atrium.background.type` is
  `'equirectangular'` or `'cubemap'`; `.texture` is any string of at most
  `DESTINATION_MAX` characters. So an owner can set `http://…`,
  `javascript:…`, a `data:` URI or a 40-megapixel PNG.
- **Client:** `TextureLoader` fetches it with the page's defaults (image
  element, `crossOrigin: 'anonymous'`, the page's referrer), no size,
  dimension or time limit. Every visitor does this automatically on entry.
- **No live world has a sky** (operator, 2026-10-22: the commons and every
  world so far are black). The only sky anywhere is the test fixture
  `tests/fixtures/atrium.gltf`, which names `skyboxtest1.png`
  (document-relative; 7.6 MB PNG, 3072 × 1536). So tightening the rule
  breaks nothing in use.
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
- **Every World Info write sends the whole extras object** (*probe*), and the
  server allows any changed World Info leaf in it. So a write built from a
  copy that hasn't yet received another owner's change reverts that change on
  the server. Today this applies to the SOM Inspector's World Info too; it is
  pre-existing and needs a protocol change to remove (§9).
- `AtriumClient.applyLocally(fn)` (L234) runs a SOM change **without
  sending**; `edit:rejected` carries the edit it rejects (`{ node, field,
  value }`, L866–875).

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
and by the client before loading. **No legacy forms:** no live world has a
sky (P2), so a document-relative value is refused like any other non-A1 value.
The fixture generator writes `/tests/fixtures/skyboxtest1.png` instead.
`background.type` stays as is. (b) As (a), but the client still loads a
document-relative value that resolves to the world's own origin (only the
fixture would use it). (c) Client-side only (the server keeps accepting any
string; every client refuses it).

**L26. Sky limits.** (a) **16 MiB download, the 30 s deadline, A2's request
policy (credentials omitted, no referrer, redirects followed then checked),
PNG/JPEG/WebP only by header (3a's `imageHeader`), each side ≤ 4096 and
width × height ≤ 4096 × 2048; outside the 512 MiB model budget (one sky at a
time); the previous texture disposed on change; reloaded only when the
resolved URL changes.** The 3072 × 1536 fixture passes. (b) As (a)
but charged to the model texture budget (a sky then evicts about two library
items' worth).

**L27. Placing from the grid.** (a) **A click on a tile adds at once** at the
palette placement, named `firstFreeName(catalog name)`; the grid stays open
for more; one library add in flight at a time (tiles disabled until the
answer); a refusal shows in the grid's status line. (b) Select a tile, then
an Add button.

**L28. Which items.** (a) **Appendix A's 34 models (six categories,
including Misc) and 6 skies**, listed from the API on 10-21 and 10-22 (the
Misc ten's 1k glTF files confirmed, 0.4–3.1 MB each); the operator strikes or swaps freely before the
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

**L31. Lighting when a world has no sky.** Every world today has none (P2),
so every library item will first be seen under `Stage`'s lights only: an
ambient light at 0.6 and one directional sun (`Stage.js` L39–80), with no
environment map. Rough wood and fabric look acceptable that way; metal and
glossy parts look flat or black. (a) **No change this round.** Claude's
browser checks (§5.1) screenshot four items (wood, fabric, metal, plant)
with no sky and with a library sky, and the passdown records whether a
default is needed. (b) When the sky is None, set `scene.environment` to a
neutral `RoomEnvironment` (PMREM). Library models look right at once, but
**every existing world's primitives change appearance** too (they gain
reflections and get brighter). (c) Give only model instances an `envMap`
when the scene has no environment: primitives unchanged, but a second
lighting path to keep in step with the sky.

## 4. Contract (per the recommended decisions)

### Host part (before kickoff; not Hermes)

#### H1. The build tool (`scripts/library-build/`, outside the pnpm workspace)
- **Why outside the workspace:** `pnpm-workspace.yaml` covers `packages/*`,
  `tools/*` and `apps/*`; anything there is installed and tested by
  `atrium-deploy`. The tool's dependencies (`@gltf-transform/core`,
  `/extensions`, `/functions` 4.3, `sharp`) must never enter a deploy. It has
  its own `package.json` and `package-lock.json`, SPDX headers, and its own
  `node --test` tests.
- **It treats every API response as untrusted input** (review R3). Poly Haven
  isn't expected to be hostile; the tool still runs on the host and writes
  files from what it's told.
- **Input:** `scripts/library-build/items.json` (Appendix A's ids, display
  names, categories). An id must match `^[A-Za-z0-9_]{1,64}$`.
- **Network rules (every request, the API included):**
  - `https:` only, to exactly `api.polyhaven.com`, `dl.polyhaven.org` and
    `cdn.polyhaven.com`; any other URL in a response refuses that item;
  - redirects followed by hand (`redirect: 'manual'`), at most 3, each hop
    re-checked against the same list;
  - bytes counted while streaming, aborted past the cap, whatever `size` the
    API claimed: a model include 32 MiB, a model's total 64 MiB, a sky source
    96 MiB, a thumbnail 2 MiB, an API response 1 MiB;
  - then the API's `size` and `md5` must match too;
  - `User-Agent: atrium-library-build/1 (+https://ewwb.dev)`, one request at a
    time, one retry on 5xx, 60 s per request.
- **`--check`:** for each id, `GET /info/<id>` and `/files/<id>`; applies
  every rule above that doesn't need the files (hosts, include keys, claimed
  sizes); refuses an id with no `gltf.1k` (models) or no `tonemapped` (skies);
  flags a model whose largest side in `/info`'s `dimensions` (millimetres) is
  under 0.1 m or over 10 m; prints a table. Downloads nothing else.
- **Implementation note (Rev 1, `scripts/library-build`):** the tool never
  writes a downloaded file to disk. The `.gltf` and its includes stay in
  memory and go to glTF-Transform's `readJSON` as a resource map (a
  null-prototype object), so no name from the API or the JSON reaches the
  file system. The `itemDir`, `wx` and directory-reuse rules below therefore
  have nothing to apply to. The key rules still apply to every include key,
  and outputs go into the new staging directory with exclusive creates. This
  is stricter than the contract, not looser.
- **Include keys are checked by one function** (R3):
  - relative, `/`-separated, each segment `^[A-Za-z0-9._-]{1,128}$` and not
    `.` or `..`; no empty segment, backslash, `%` or leading `/`;
  - unique after lower-casing;
  - `path.resolve(itemDir, key)` must stay inside `itemDir`, a fresh
    `mkdtemp` directory per item;
  - files are created with `open(…, 'wx')` (fails if anything, a symlink
    included, is already there);
  - a directory is created with `mkdir` and recorded in a per-item set; an
    existing directory is reused **only** if this run created it inside this
    `itemDir` and `lstat` still shows a directory, not a symlink (so
    `textures/a.jpg` and `textures/b.jpg` share `textures/`); any other
    existing entry refuses the item (re-review 4).
- **Build, per model:**
  1. download the 1k `.gltf` and every `include` under the rules above;
  2. **every `uri` in the `.gltf` JSON** (buffers, images) must equal one of
     the include keys exactly; anything else (another path, `data:`, an
     absolute URL) refuses the item, so `NodeIO` never reads outside `itemDir`;
  3. `NodeIO.read` (`ALL_EXTENSIONS` registered); refuse any
     `extensionsRequired`, and any Draco, meshopt or KTX2 (L7);
  4. **re-pivot** with `@gltf-transform/functions` `center(doc, { pivot:
     'below' })`, so every item's origin is the centre of its base and it
     lands on the floor at the placement point, whatever the source's origin
     was (review's placement note);
  5. write one `.glb` with every image and buffer embedded (3a's GLB rule);
  6. **run 3a's own checks on that `.glb`** (R3): import `readGlb`,
     `glbDependencyProblem`, `glbImages` and `preflightProblem` from
     `packages/renderer-three/src/model-parse.js` (the clone's
     renderer-three is installed first, H2) and refuse on any problem; then
     the tool's own stricter limits: 25 MiB, and a texture estimate over
     64 MiB (no library item may take an eighth of a world's budget);
  7. compute `sha256`, `bounds` (size per axis, clamped to 0.001–1000),
     vertices, bytes and texture estimate. The **build's** summary table
     (printed at the end of a full build; `--check` has no geometry, since
     it downloads nothing) flags any item whose largest side is under 0.1 m
     or over 10 m, for the operator to look at before installing;
  8. fetch `thumbnail_url` under the rules above, check it with `sharp`'s
     metadata (JPEG, PNG or WebP, ≤ 4096 px), resize to 256 × 256 WebP.
- **Build, per sky:** download `tonemapped` under the rules above, check its
  header is JPEG, resize to 4096 × 2048 JPEG q85 (L24) with `sharp`
  (`limitInputPixels` set to 16384 × 8192), thumbnail 256 × 128 WebP.
- **Output:** a staging directory with `models/`, `skies/`, `thumbs/` under
  content-addressed names (L23; `<id>-<first 12 hex of sha256>.<ext>`) and
  `catalog.json` (Z1's shape, a `sha256` for **every** file). It never
  writes into `/srv/atrium-library` itself.
- **`--verify <dir> <catalog>`:** re-hashes every file the catalog names.
- **Tests (Claude, local, against a mock API and file server):** the
  include-path rule (`../x`, `/abs`, `a//b`, `a\b`, `%2e%2e`, a duplicate in
  another case); a symlink planted where a file would go; a `.gltf` `uri`
  that isn't an include key; a redirect to another host and to `http:`; a
  body larger than its claimed size; an `md5` mismatch; each 3a refusal on a
  built `.glb`; the re-pivot (an off-centre fixture lands with its base at
  y = 0); determinism (two builds, same hashes); `--verify`.

#### H2. Running it, and installing the files (operator, host)
```bash
# 1. as atrium-build, in a scratch clone of the tool's branch
git clone -q -b claude/library-build https://github.com/joshmaurice/atrium /var/tmp/lib-src
cd /var/tmp/lib-src && pnpm install --frozen-lockfile --filter @atrium/renderer-three   # for H1 step 6
cd scripts/library-build && npm ci
node build.mjs --check items.json          # ids, hosts, paths, claimed sizes
node build.mjs --out /var/tmp/library-<date> items.json   # read its summary; strike anything flagged and rebuild
node build.mjs --verify /var/tmp/library-<date> /var/tmp/library-<date>/catalog.json

# 2. as root: the installer from a PINNED commit, never from the build checkout
#    INSTALLER_SHA and INSTALLER_SHA256 come from the passdown/handoff that
#    approves the tool (Claude prints both after its review).
install -d -m 0700 /root/lib-install
git -C /root/lib-install init -q 2>/dev/null; git -C /root/lib-install fetch -q --depth 1 \
  https://github.com/joshmaurice/atrium "$INSTALLER_SHA"
git -C /root/lib-install show "$INSTALLER_SHA":scripts/library-build/install-library.sh \
  > /root/lib-install/install-library.sh
echo "$INSTALLER_SHA256  /root/lib-install/install-library.sh" | sha256sum -c -
bash /root/lib-install/install-library.sh /var/tmp/library-<date>
```
**The trust boundary** (re-review 1): root never runs anything from
`/var/tmp/lib-src` or from the build account's environment: not the
installer, not `node`, not the tool's `node_modules`. The installer comes from
a reviewed commit, fetched by root into a root-only directory and checked
against a known sha256; it is plain `bash` plus `sha256sum`, `install`, `cp`,
`find` and `python3 -I` (to read `catalog.json` with the standard `json`
module). Everything under `/var/tmp/library-<date>` is untrusted data.

**`install-library.sh`** (in the tool's directory; tested by Claude locally):
1. refuses unless run as root, and unless `/srv/atrium-library` and its three
   subdirectories are root-owned, mode 0755, and not symlinks (it creates
   them that way on first run);
2. copies the staging directory into a fresh root-owned `mktemp -d`
   (`cp -R --no-dereference`), then refuses if the copy holds any symlink,
   device, or file not named by its `catalog.json`; everything after this
   works on the private copy, so the build account can't change files
   between check and install;
3. for each file the catalog names: its name must match Z1's pattern for its
   kind and its sha256 must match the catalog; then
   - destination missing → `install -m 0644 -o root -g root` it;
   - destination present → its sha256 must equal the catalog's, **else stop
     with an error** (never skip silently);
4. re-hashes every installed destination against the catalog;
5. prints the catalog's sha256 and `OK <n> files`. Exit non-zero on any
   refusal, with the path named.
6. runs with `PATH=/usr/sbin:/usr/bin:/sbin:/bin`, `umask 022`, `set -euo
   pipefail`, and `cd /` first, so nothing from the caller's environment or
   the staging directory is on its path.

Then, after H3: `curl -sI https://dev.ewwb.dev/<each url>` returns 200 with
the CORS header (the script prints these URLs). **Only then** upload the
catalog **from root's private copy** (the script leaves it at
`/root/lib-install/catalog-<sha256 prefix>.json` and prints its sha256) to
`main` as `apps/client/library/catalog.json` (L21), before
kickoff.

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
    "thumbnailSha256": "<64 hex>",
    "license": "CC0-1.0", "authors": ["…"],
    "source": "https://polyhaven.com/a/ArmChair_01" }],
  "skies": [{ "id": "…", "name": "…", "url": "/assets/library/skies/<id>-<sha12>.jpg",
    "sha256": "<64 hex>", "width": 4096, "height": 2048, "bytes": 0,
    "thumbnail": "…", "thumbnailSha256": "<64 hex>",
    "license": "CC0-1.0", "authors": ["…"], "source": "…" }] }
```
- `loadCatalog(fetchFn)`: same-origin `fetch` with `credentials: 'omit'`;
  the 256 KiB cap is **enforced while reading** (abort past it, using the
  same streaming reader as 3a), then `JSON.parse`; `version` must be 1.
- **Every entry is validated** and an invalid one is dropped with a console
  warning (review R5). Paths are checked **as exact strings, never by prefix
  or after URL parsing**:
  - model `url`: `^/assets/library/models/[A-Za-z0-9_]{1,64}-[0-9a-f]{12}\.glb$`
  - sky `url`: `^/assets/library/skies/[A-Za-z0-9_]{1,64}-[0-9a-f]{12}\.jpg$`
  - `thumbnail`: `^/assets/library/thumbs/[A-Za-z0-9_]{1,64}-[0-9a-f]{12}\.webp$`
  - the 12 hex in each name equal the first 12 of that file's `sha256`
    (`sha256` for the url, `thumbnailSha256` for the thumbnail);
  - these patterns admit no `.`-segment, `%`, query or fragment, so no
    normalization can move a path out of its directory;
  - models also need `bounds` that pass 3a's rules (`model-spec.js`); skies
    need `width`/`height` within L26; `id`s are unique per kind.
  A missing or broken catalog hides the Library button and leaves Sky with
  None only; the rest of Edit mode is unaffected.
- `storedUrl(path, worldBaseUrl, pageOrigin)` (L22): the path when
  `new URL(path, worldBaseUrl).origin === pageOrigin`, else
  `new URL(path, pageOrigin).href`.
- A test reads the **committed** catalog and checks every entry against these
  rules (and that none was dropped), so a bad upload fails the suite.

#### Z2. The Library grid (`apps/client/src/library-grid.js`; `index.html`; `app.js` wiring only)
- **Button:** `#ep-library` after `#ep-model`, **no `data-kind`**, the
  palette's enable rule (`!blocked && modes.edit`). Hidden when the catalog
  has no models.
- **Tiles follow the same rule** (review note): a tile is enabled only while
  `!blocked && modes.edit` **and** no library add is waiting. The grid
  re-reads the rule wherever the palette refreshes its buttons.
- **Grid:** a panel under the Add row (like `#tp-form`), registered in the
  form gate as `'library'` (opening it closes the Model or teleporter form
  and vice versa). Tiles: thumbnail (`<img loading="lazy">`, alt = name),
  name; grouped by category; the credit line linking `creditUrl`; the
  privacy note is **not** shown (the files are ours, L12 is about third-party
  hosts). Closes on Cancel, Escape, Edit off and reconnect, as the forms do.
- **Click (L27a):** `buildModelDescriptor({ name: firstFreeName(entry.name),
  position, rotation, url: storedUrl(…), bounds: entry.bounds,
  sha256: entry.sha256 })` → the same structural add as the Model form's
  Save (`structure.begin('add', …)`, `undo.registerAdd`), with the request
  marked **`request.library = true`** (as the Model form marks
  `request.model`). While waiting, tiles are
  disabled; a refusal shows in the grid's status line; the grid stays open
  after success.
- **Answers are routed explicitly** (re-review 5). `onStructureAnswer` gets
  a `request.library` branch before its generic ones, calling
  `libraryGrid.onAnswer(seq, status, message)`, which returns whether the
  grid still owned that wait:
  - **grid open and waiting on this seq:** accepted → select the node
    (`selectAdded`), status cleared; rejected → the message in the grid's
    status line, no generic error; unknown → "the world did not answer" in
    the status line. Then return (the generic branches don't run);
  - **grid closed (or waiting on another seq):** accepted → **nothing is
    selected**; rejected or unknown → the generic `showEditError`. Then
    return, so the generic `selectAdded` never runs for a library add.
  Undo registration and the structural tracker are untouched in both cases
  (they don't depend on this branch), so a closed grid's add is still
  undoable. Closing the grid (Cancel, Escape, another form) only ends its
  wait. Edit off and reconnect use the forms' existing paths.
- No Check, no fetch by the grid itself: the bridge loads the model like any
  other, pinned.

#### Z3. The sky loader (`packages/client/src/model-fetch.js`, `packages/renderer-three/src/load-background.js`)
- **`skyUrlProblem(texture)`** in `model-spec.js` (and its server mirror,
  Z5): A1, or `''`. **`resolveSkyUrl(texture, worldBaseUrl)`**: an A1 value
  resolves as models do (`resolveModelUrl`); anything else is refused with a
  reason (L25a: no document-relative form).
- **Fixture:** `tests/fixtures/generate-atrium.js` writes
  `/tests/fixtures/skyboxtest1.png`; regenerate `atrium.gltf` and commit both.
- **`fetchImage({ url, worldBaseUrl, signal, fetchFn, limits })`** exported
  from `model-fetch.js`, built on the existing internal `fetchOne`/`readBody`:
  `FETCH_OPTIONS`, redirect check (`redirectProblem`), 16 MiB cap counted per
  chunk. It does **not** use the world ledger or the transfer limiter (one
  sky; L26). Returns bytes or a reason. **Its 30 s deadline covers the
  request and reading the whole body** (review R7).

- **One sky controller per scene** replaces the free function (R1, R4):
  `createSkyLoader({ scene, fetchImage, decode })` in
  `load-background.js`, exported from renderer-three. `loadBackground` stays
  as a thin wrapper for one release (the Inspector moves to the controller in
  the same round). **It alone writes `scene.background` and
  `scene.environment`;** `app.js` L639–641 and the Inspector's L217–218 are
  removed.

  **State:** `generation` (a counter), `loaded = { url, texture } | null`,
  `pending = { generation, url, abort } | null`, `failedUrl` (or null).

  **The rule (R4):** only the current generation may change the scene's
  slots, `loaded`, `failedUrl`, or report a result. Every superseded or
  cancelled generation, whenever it settles, disposes any texture it made,
  revokes its blob URL, and changes nothing else.

  - **`update(bg, worldBaseUrl)`** (from `world:loaded`, `som:set` of
    `__document__`, and the picker):
    1. no sky (`''`, missing, `type` not `equirectangular`) → cancel
       `pending`; dispose `loaded.texture`; null both slots; `loaded = null`,
       `failedUrl = null`;
    2. resolve with `resolveSkyUrl`; a refusal → as (1), then report the
       reason;
    3. **the newest value wins** (re-review 2): if `pending` exists and
       `pending.url !== url`, cancel it (`generation++`, abort) **before** any
       shortcut below. So A loaded → B pending → A chosen again leaves A shown,
       and B's late texture is disposed by the stale rule;
    4. `url === pending?.url` → nothing (already on its way);
    5. `url === loaded?.url` → **re-assert** both slots to
       `loaded.texture` (they may have been cleared or replaced), no fetch.
       This is what makes a repeated `world:loaded` on the same SOM keep its
       sky (R1);
    6. `url === failedUrl` → nothing (no sky shown, the failure already
       reported): a failed sky is not refetched on every World Info change
       (P1's rename problem), only by `retry()` or a new world. `loaded` and
       `failedUrl` are never both set (a failure clears `loaded`);
    7. otherwise start a new generation: cancel `pending`, `generation++`,
       `pending = { generation, url, abort }`, then:
       - `fetchImage` (30 s for the transfer);
       - `imageHeader`: PNG/JPEG/WebP only, sides 1–4096, area ≤ 4096 × 2048;
       - `decode`: a `blob:` URL through `TextureLoader` (the same decode and
         orientation as today), **bounded at 10 s**; the blob URL is revoked
         when it settles, on every outcome; a decode that settles after the
         bound or after its generation was superseded is disposed then;
       - if still current: set mapping and colour space, dispose
         `loaded.texture` (if any), set both slots, `loaded = { url,
         texture }`, `failedUrl = null`, `pending = null`, report success;
       - on any failure while current: dispose `loaded.texture`, null both
         slots, `loaded = null`, `failedUrl = url`, `pending = null`, report
         the reason. (A world whose sky fails shows no sky, never the previous
         one.) A superseded generation's failure does nothing (R4).
  - **`retry()`:** `failedUrl = null`, then `update` with the last values.
    Called by the picker's Retry button (Z4).
  - **`resetWorld()`** (re-review 3: from **`beginNewWorld()`**, which runs
    before every `loadWorld`/`loadWorldFromData`, including static `.gltf`
    loads with no server, **and** from `connecting` and `disconnected`, next
    to `modelBridge.resetWorld()` at each): cancel `pending` (`generation++`), dispose
    `loaded.texture`, null both slots, clear `loaded` and `failedUrl`. A world
    change therefore never reuses a pending request from the previous world,
    even for the same URL (R1).
  - **`dispose()`:** as `resetWorld()`, and later calls do nothing.
  - **Reporting:** `update` returns a promise for its own generation:
    `{ ok: true }`, `{ ok: false, reason }`, or `{ ok: false, reason:
    'superseded' }`. The picker shows only its own non-superseded failure.
- The SOM Inspector uses the same controller: `onBackgroundChange` calls
  `update`; `resetWorld` is called on `connecting`, `disconnected`, and
  immediately before each of its `loadWorld`/`loadWorldFromData` calls
  (`tools/som-inspector/src/app.js` L284, L356, L389, L395, L455).

#### Z4. The Sky picker (`apps/client/src/sky-picker.js`; `index.html`; `app.js` wiring)
- A "World" label and row under the Add row with `<select id="ep-sky">`:
  None, then each catalog sky by name, then a disabled "Custom" option shown
  only while the world's texture isn't a catalog sky (L29a). Synced on
  `world:loaded` and on `som:set` of `__document__`.
- **One write at a time** (R2): while a sky write waits for its answer the
  select is disabled. The next change can't start until it's answered.
- **Change:** build the new extras from a deep copy of the **current**
  `som.extras` at that moment, changing only `atrium.background.type`
  (`'equirectangular'`) and `.texture` (`storedUrl(…)`, or `''` for None);
  assign `som.extras`; remember `client.lastSendSeq` and the two leaves'
  previous values; call `sky.update(…)` locally (*probe*: the server's echo
  of the owner's own send resolves the pending edit but emits no `som:set`,
  `AtriumClient.js` L982–985).
- **On `edit:accepted` for that seq:** re-enable the select.
- **On `edit:rejected` for that seq** (R2): the client doesn't roll the SOM
  back (*probe*: `_resolveRejected` only emits), so the picker does, **for the
  two leaves only and without sending**:
  - if the SOM's current `type` and `texture` still equal what this write
    sent, put back their previous values with `client.applyLocally(() => …)`
    on a copy of the **current** extras (every other field as it now is),
    then `sky.update(…)`;
  - otherwise another session's background change has already arrived and
    is the newer value: leave it;
  - re-sync the select from the SOM, show the server's message, re-enable.
  Nothing is sent, so a rollback can't revert anyone's description or name.
- **On `edit:unknown`** (connection lost): re-enable; the reconnect's
  `som-dump` brings the server's value.
- **A failed sky** (re-review 6): when the controller reports a failure for
  the world's current sky, a status line under the select shows the reason
  and a **Retry** button, which calls `sky.retry()`; both clear on success,
  on another choice, and on a world change. A `<select>` fires no `change`
  when the same option is chosen again, so re-picking is never the retry
  path. Visitors see no Retry (their console has the reason; a reload
  retries).
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
| Catalog | `loadCatalog`: size cap enforced mid-stream (a body that never ends is aborted), wrong version, path patterns (`/assets/library/models/../x.glb`, `/assets/library/%2e%2e/x.glb`, a query, a fragment, a sky url in `models`, a name whose 12 hex don't match `sha256`), each invalid-entry rule drops only that entry, broken JSON → empty; `storedUrl` same-origin and cross-origin; **the committed catalog passes** |
| Grid | tile click builds the exact descriptor (pinned `sha256`, catalog `bounds`, free name); tiles disabled while waiting **and** while structurally blocked; refusal message; form gate (opening closes the Model form and back); Escape, Edit off, reconnect close it; **`onStructureAnswer` with `request.library`: open grid → selects; closed grid → accepted selects nothing and undo is still registered, rejected shows the generic error** (re-review 5) |
| Sky URL | shared vectors through client `skyUrlProblem` and server leaf: A1 cases, `''`, `http:`, `data:`, `javascript:`, `//host`, backslash, credentials, over-length; `resolveSkyUrl` refuses a document-relative value (`skyboxtest1.png`, `../x.png`) |
| `fetchImage` | request options, redirect to `http:` refused, 16 MiB cap mid-stream, the deadline covering a body that drips past 30 s, abort |
| Sky controller | header checks (each format, oversize side, oversize area, zero size, truncated header); **repeated `world:loaded` on the same SOM with the slots cleared in between keeps the sky, no fetch** (R1); **`resetWorld` while a sky loads, then the same URL in the next world: a new request, and the old one's late texture is disposed** (R1, R4); a new value disposes the old texture; **a stale decode that succeeds is disposed and changes no slot; a stale failure doesn't clear a newer sky** (R4); blob URL revoked on success, failure, abort and supersession; decode past 10 s is disposed when it settles; **a failed URL isn't refetched on a rename, and `retry()` of the same URL succeeds** (R7); **A loaded → B pending → A chosen again → B completes late: A stays shown, B's texture is disposed, B's fetch aborted**; **B pending, then the previously failed URL chosen: B is cancelled** (re-review 2); **two static worlds loaded in turn (`beginNewWorld`) while the first's sky is pending: the first's late texture is disposed; a sky that failed in the first world is fetched again in the second** (re-review 3); clear disposes; `dispose()` |
| Picker | change writes only the two leaves (a test diffs the sent extras); select disabled until answered; **rejection restores only the two leaves, without a send, keeping a description another session changed meanwhile** (R2); **rejection after another session's background change keeps that change** (R2); Custom shown for a non-catalog texture; **a failed sky shows the reason and Retry; Retry calls `retry()` once and clears on success** (re-review 6) |
| Build tool (Claude, local; not in the pipeline) | H1's test list; `install-library.sh`: a destination present with the wrong hash stops with an error (R6), a symlink in staging refused, a file not in the catalog refused, a second run installs nothing and passes; a staging catalog naming `../x` or an absolute path is refused; the script run from another working directory with a hostile `PATH` behaves the same (re-review 1); `textures/a.jpg` + `textures/b.jpg` share one created directory, and a pre-planted `textures` symlink is refused (re-review 4) |
| Server | `world-crud`/send-policy: owner sets a library sky (allowed), `http:` refused, `''` allowed, other leaves still refused |

**Proofs** (each break must fail named tests; "not reproducible" is not an
acceptable result, models-hardening §4.3): (p1) the server leaf back to
`isBoundedString`; (p2) Z3's dimension check removed; (p3) `loadCatalog`'s
entry validation removed; (p4) `storedUrl` always returning the path;
(p5) the old texture's disposal removed; (p6) the unchanged-URL short-circuit
removed (a fetch count rises); (p7) the picker sending the whole extras
object with an extra changed leaf; (p8) step 3's re-assert removed (the
repeated `world:loaded` test loses its sky); (p9) the generation check
removed from the failure path (a stale failure clears a newer sky); (p10) the
stale-success disposal removed (a texture count rises); (p11) the picker's
rollback sending instead of `applyLocally` (the concurrent-description test
fails); (p12) `loadCatalog`'s path patterns replaced by a `startsWith`
check (the encoded-traversal entries load); (p13) Z3 step 3 removed (the
A → B → A test shows B); (p14) `sky.resetWorld()` removed from
`beginNewWorld()` (the two-static-worlds test fails); (p15) the
`request.library` branch removed (the closed-grid test selects the node).

### 5.1 Claude's browser checks (after publish, before DEV acceptance)
With the harness of the 10-21 passdown §5.1, plus a copy of the real library
files and catalog served under `/assets/library/`:
- every catalog model places from the grid and reaches `loaded` (in
  batches across fresh worlds: 34 distinct items exceed one world's 512 MiB);
  in one world, placing distinct items until the budget refuses gives a
  placeholder with the budget reason, and the count reached is recorded;
- every sky loads; switching skies 10 times leaves
  `renderer.info.memory.textures` flat;
- renaming the world causes no sky request; a world with an external
  reference keeps its sky when the reference loads (R1);
- **placement** (review note): the largest, smallest and three other items
  are placed side by side and screenshotted from the avatar's view; each
  rests on the floor at the placement point (H1's re-pivot) and its
  placeholder box matches the model;
- **two owners** in two browsers: one changes the description while the
  other's sky write is forced to fail (a stubbed server refusal); both end
  with the new description (R2);
- the regenerated `atrium.gltf` sky (root path) loads, and the old
  document-relative value is refused with a reason; an `http:` sky (set by a raw
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
- **Spec by git reference** (models-hardening §4.1): this pre-brief is about
  56 KB, over the 40 KB limit, so every card that needs it gets a `git show`
  reference pinned by sha256, never a copy.
- **Steps, one commit each:** (1) Z5 + shared sky vectors (server, client
  spec); (2) Z3 `fetchImage` + `resolveSkyUrl`, and the regenerated fixture; (3) Z3's sky controller, with `app.js` and the SOM Inspector moved to it;
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
  the sky controller's new imports) — round 1 of 3a failed on exactly this
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
3. Lighting for worlds with no sky: see L31.
4. `'cubemap'` remains a server-accepted type the client ignores.
5. **Whole-extras World Info writes can revert another owner's concurrent
   change** (P3). The Sky picker narrows this (it builds from the current SOM
   and never sends a rollback), but its forward write still carries every
   leaf, as the SOM Inspector's does. The fix is a leaf-level document `send`
   (a protocol change with its schema, AGENTS.md rule 1), for its own small
   round.

## 10. References
Design §4.4, §9 row 3; models-by-url pre-brief §3 (L13–L15, L20), §9,
§12 A1, A2, A5; passdowns 10-14 (Caddy, host facts), 10-20 §4.1, §6.3,
10-21 §2.1, §4.1, §4.3, §6.3. Code: `load-background.js`; `app.js` L640–655,
L804–806; `send-policy.js` L350–351, `authorizeDocumentSend`;
`AtriumClient.js` L1116, L1237; `model-fetch.js` L29–60, L356, L443, L574;
`model-parse.js` `imageHeader`; `model-form.js` L73–117; `index.html`
L568–583.

## 11. Open for the operator
- **Q1. Answered** (operator, 2026-10-22): the commons and all worlds so far
  have no sky. Taken into P2, L25 and L31.
- **Q2.** Strike or swap any of Appendix A before the build.

## 12. Revision log
- **Rev 0 (2026-10-21, ~23:59 PT):** drafted from probes at `9e7478f` and
  the live Poly Haven API.
- **Rev 0.1 (2026-10-22, ~01:55 PT):** Q1 answered (no live world has a sky).
  L25a drops the legacy document-relative form (old behaviour kept as
  option (b)); the fixture moves to a root path; P2, L26, Z3, §5, §5.1 and §9
  follow. New L31 (lighting without a sky), from §9.3.
- **Rev 0.2 (2026-10-22, ~08:55 PT):** a Misc category of ten models
  (operator request), 34 models in all; §5.1's budget check reworded, since
  34 distinct items no longer fit one world.
- **Rev 0.3 (2026-10-22, ~09:40 PT):** an outside review of Rev 0.2 (NOT YET
  GO; R1–R7 and three notes). Claude checked each claim against `9e7478f`
  and took all of them (§13). Decisions unchanged.
- **Rev 0.4 (2026-10-22, ~09:55 PT):** the re-review of Rev 0.3 ("almost
  ready, not yet GO"; two must-fix, four should-fix, one nit). All taken
  (§14). Decisions unchanged.
- **Rev 1 FINAL (2026-10-22, ~10:20 PT):** the operator approved L21–L31 as
  recommended and accepted the §9.5 deferral. H1 gains its implementation
  note (in-memory conversion) and `--check`'s size flag from `/info`. The
  tool and installer are on `claude/library-build`; the pinned installer
  commit and sha256 go in the handoff.

## 13. Outside review of Rev 0.2 (2026-10-22) and what Rev 0.3 did

Verdict: **NOT YET GO** for implementation or host installation; architecture
and L21–L31 agreed; a targeted Rev 0.3 asked for. The reviewer read the code
at `9e7478f` through GitHub and ran URL-normalization and `cp -n` checks.
Claude re-checked each concrete claim before amending.

| # | Finding | Checked | Rev 0.3 |
|---|---|---|---|
| R1 (must) | Skipping an unchanged URL loses the sky, because `world:loaded` clears both slots first and repeats on the same SOM | Confirmed: `app.js` L639–641, L645, L655 | P1; Z3's controller owns the slots, re-asserts on an unchanged URL, and resets on `connecting`/`disconnected`; app's clearing removed; tests, (p8) |
| R2 (must) | Restoring the whole saved extras after a rejection can overwrite a concurrent change | Confirmed (`_resolveRejected` only emits; another session's set is applied; a whole-extras send can revert a description). Claude adds that the **forward** write has the same exposure, pre-existing | P3; Z4: one write at a time, rollback of the two leaves only, via `applyLocally`, never sent, and skipped if a newer background arrived; §9.5 records the forward race; tests, (p11), §5.1 |
| R3 (must) | Build tool: include keys as paths, download limits, redirects, and checking the GLB against the browser's rules | Agreed (no code yet). Claude adds that the `.gltf`'s own `uri`s must be checked too, or `NodeIO` reads them from anywhere | H1 rewritten: host allowlist, manual redirects, streaming caps, one path function, `wx` creates, `uri` = include key, 3a's `preflightProblem` run on each GLB |
| R4 (must) | Every async outcome needs cleanup and generation ownership | Confirmed: today's late texture is dropped by the token but not disposed | Z3's rule: only the current generation touches slots or reports; every other disposes and revokes; tests, (p9), (p10) |
| R5 (should) | Prefix + A1 isn't containment (`/assets/library/%2e%2e/x`) | Confirmed with Node's URL parser: `../` and `%2e%2e` both normalize to `/assets/x` | Z1: exact per-kind patterns, name hash tied to `sha256`; tests, (p12) |
| R6 (should) | `cp -n` can skip silently | Agreed | H2: `install-library.sh` (private root copy, hash-or-stop, re-hash after install, root-owned 0755 tree) |
| R7 (should) | The sky deadline and retry are unclear | Agreed | `fetchImage` 30 s covers the body; decode bounded at 10 s; a failed URL is remembered but `retry()` and a new world refetch it |
| Note | Enforce the catalog cap while reading | Agreed | Z1 |
| Note | Tiles must respect the structural blocker; closing with an add pending | Agreed | Z2, tests |
| Note | Check placement, not only loading | Agreed | H1 re-pivots every model to its base centre and flags odd sizes; §5.1 screenshots |

Not taken: nothing. The reviewer's note that tonemapped JPEGs lose the
HDRI's range is agreed and left as L24 says (no HDR this round).

## 14. Re-review of Rev 0.3 (2026-10-22) and what Rev 0.4 did

Verdict: **almost ready, not yet GO**; L21–L31 still agreed; R5 resolved,
the rest substantially resolved. The forward-write race (§9.5) is accepted
as an explicit deferral provided the operator understands the limitation.

| # | Finding | Checked | Rev 0.4 |
|---|---|---|---|
| 1 (must) | Root runs the installer from the build account's writable checkout | Agreed | H2: root fetches the installer from a pinned commit into `/root/lib-install`, checks its sha256, runs that copy; nothing from the build checkout runs as root; fixed `PATH`, `cd /`; the catalog is uploaded from root's private copy |
| 2 (must) | A → B pending → A again: the shortcut reasserts A and B lands later | Confirmed in Rev 0.3's step order | Z3 step 3: any differing pending request is cancelled before the shortcuts; tests, (p13) |
| 3 (should) | Static loads don't reset the sky | Confirmed: `beginNewWorld()` (`app.js` L2835) runs before every `loadWorld`/`loadWorldFromData`; the Inspector has five load calls | Z3: `resetWorld()` from `beginNewWorld()` and before each Inspector load; tests, (p14) |
| 4 (should) | "`mkdir` refuses an existing directory" breaks shared `textures/` | Agreed | H1: reuse only a directory this run created, re-checked with `lstat` |
| 5 (should) | A closed grid's add would still be selected by the generic answer path | Confirmed: `onStructureAnswer` selects accepted adds (`app.js` ~L2323); the Model form's branch falls through to it | Z2: `request.library` and `libraryGrid.onAnswer`, which always returns before the generic branches; tests, (p15) |
| 6 (should) | Re-picking the selected option fires no `change` | Agreed | Z4: a Retry button beside the failure reason |
| 7 (nit) | `--check` can't measure sizes; "seven categories" | Agreed | H1 step 7 and H2: the build's summary flags sizes; L28 says six |

## Appendix A. Proposed items (L28; ids verified on api.polyhaven.com, 10-21)

**Models (34, 1k):**
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
- Misc (Rev 0.2, operator request): `wooden_crate_01`, `Barrel_01`,
  `standing_chalkboard_01`, `marble_bust_01`, `concrete_cat_statue`,
  `rubber_duck_toy`, `boombox`, `Television_01`, `Ukulele_01`,
  `ceramic_vase_01`. None is rigged.

**Skies (6, pure-sky HDRIs, tonemapped, 4096 × 2048):**
`kloofendal_48d_partly_cloudy_puresky`, `autumn_field_puresky`,
`farm_field_puresky`, `drakensberg_solitary_mountain_puresky`,
`belfast_sunset_puresky`, `evening_road_01_puresky`.
No night pure-sky was confirmed; one can be added after `--check`.
