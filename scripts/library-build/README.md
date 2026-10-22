# Starter library build tool (step 3b, host part)

Builds Atrium's starter library from Poly Haven, and installs it. The spec
is `devtasks/PREBRIEF-library-sky.md`, sections H1–H3. This directory sits
outside the pnpm workspace on purpose: its dependencies (`sharp`, glTF-Transform
`functions`) never enter a deploy, and `atrium-deploy` never runs its tests.

| File | What it does | Runs as |
|---|---|---|
| `build.mjs` | `--check`, `--out`, `--verify` (below) | `atrium-build` |
| `items.json` | the chosen items (pre-brief Appendix A): 34 models, 6 skies | — |
| `install-library.sh` | installs a verified staging directory into `/srv/atrium-library` | **root**, from a pinned copy only |
| `lib/` | network rules, name checks, model and sky conversion, catalog rules | — |
| `test/` | `npm test` (73 tests; the installer's need root) | — |

## Build (as `atrium-build`)

```bash
git clone -q -b claude/library-build https://github.com/joshmaurice/atrium /var/tmp/lib-src
cd /var/tmp/lib-src && pnpm install --frozen-lockfile --filter @atrium/renderer-three
cd scripts/library-build && npm ci
node build.mjs --check items.json
node build.mjs --out /var/tmp/library-<date> items.json
node build.mjs --verify /var/tmp/library-<date> /var/tmp/library-<date>/catalog.json
```

- `--check` asks the API about every item and downloads nothing else. It
  refuses an item whose hosts, file names or claimed sizes break the rules,
  and flags an item whose largest side (from the API's `dimensions`) is under
  0.1 m or over 10 m.
- `--out` needs a directory that doesn't exist yet. Any refused item means
  **no `catalog.json`**: strike it from `items.json` and build into a new
  directory. The summary table flags odd sizes as measured after conversion,
  and adds up the texture estimate.
- The renderer-three install lets the tool run Atrium's own model checks
  (`model-parse.js`) on every `.glb` it builds.

What the tool enforces: https only, to `api.polyhaven.com`,
`dl.polyhaven.org` and `cdn.polyhaven.com`; redirects re-checked by hand
(at most 3); size caps counted while streaming; every claimed size and md5
checked; include names validated; a `.gltf` may only name its listed files.
Nothing it downloads is written to disk except the final outputs, which go
into the new staging directory with exclusive creates. Every model is
re-pivoted so its origin is the centre of its base.

## Install (as root)

Never run anything from `/var/tmp/lib-src` as root. Fetch the installer from
the pinned commit and check its sha256. Both values come from the handoff
that approves the tool.

```bash
install -d -m 0700 /root/lib-install
git -C /root/lib-install init -q 2>/dev/null
git -C /root/lib-install fetch -q --depth 1 https://github.com/joshmaurice/atrium "$INSTALLER_SHA"
git -C /root/lib-install show "$INSTALLER_SHA":scripts/library-build/install-library.sh > /root/lib-install/install-library.sh
echo "$INSTALLER_SHA256  /root/lib-install/install-library.sh" | sha256sum -c -
bash /root/lib-install/install-library.sh /var/tmp/library-<date>
```

The installer treats the staging directory, catalog included, as hostile. It
works through file descriptors opened without following symlinks, and checks
the following:
- **The staging directory:** its tree must be owned by `atrium-build` (`--owner`),
  sit under root-owned directories, and hold exactly `catalog.json`,
  `models/`, `skies/` and `thumbs/`, with only the files the catalog names.
- **Each named file:** a regular file with one link, under its size cap (and
  1 GiB in all). It is copied into a root-only directory while being hashed.
- **The catalog:** read as strict JSON, with every field checked.

Every destination is checked (absent, or the same bytes) **before anything is
installed**. A refused run installs nothing. Then missing files are installed,
root:root 0644, and everything is re-hashed. The catalog kept at
`/root/lib-install/catalog-<sha12>.json` is rebuilt from the checked fields
only. Upload **that** file to `main` as `apps/client/library/catalog.json`,
after the URLs it prints pass the Caddy check (H3).

## Tests

```bash
npm ci && npm test      # as root, so the installer tests run
```

The tests use an in-process fake of Poly Haven (`test/fake-polyhaven.mjs`):
generated multi-file models, skies, and hooks that make it misbehave.
