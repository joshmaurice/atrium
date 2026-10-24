#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
#
# Build Claude's local browser-check harness for one commit (see README.md).
#   devtasks/harness/setup.sh <sha>
# Env: HARNESS_ROOT (default /tmp/atrium-harness), ATRIUM_REPO (default /home/claude/atrium).
set -euo pipefail
SHA=${1:?usage: setup.sh <commit sha to test>}
ROOT=${HARNESS_ROOT:-/tmp/atrium-harness}
REPO=${ATRIUM_REPO:-/home/claude/atrium}
HERE=$(cd "$(dirname "$0")" && pwd)

mkdir -p "$ROOT/harness" "$ROOT/shots" "$ROOT/vendor" "$ROOT/vsrc"
cp "$HERE/server.mjs" "$HERE/h.py" "$HERE/group.gltf" "$HERE/gen.mjs" "$ROOT/harness/"

# 1. The code under test: a detached worktree of the repo at SHA, with its own install.
if [ -e "$ROOT/wt/.git" ]; then
  git -C "$ROOT/wt" checkout -q --detach "$SHA"
else
  git -C "$REPO" worktree add -q --detach "$ROOT/wt" "$SHA"
fi
(cd "$ROOT/wt" && pnpm install --frozen-lockfile --prefer-offline >/dev/null)
echo "code under test: $(git -C "$ROOT/wt" rev-parse HEAD)"

# 2. sharp, for the server's test skies and the library generator (scripts/library-build's own deps).
(cd "$REPO/scripts/library-build" && [ -d node_modules/sharp ] || npm ci --silent)
#    The generator also imports the clone's own renderer-three checks, which need three.js installed there.
[ -d "$REPO/packages/renderer-three/node_modules/three" ] || (cd "$REPO" && pnpm install --frozen-lockfile --prefer-offline >/dev/null)

# 3. Local copies of what the page's import map loads from esm.sh (the sandbox can't reach it).
if [ ! -f "$ROOT/vendor/gltf-view.js" ]; then
  (cd "$ROOT/vsrc" && npm init -y >/dev/null && npm install --silent \
     @gltf-transform/core@4.3.0 @gltf-transform/extensions@4.3.0 @gltf-transform/view@4.3.0 \
     three@0.163.0 esbuild@0.28.2)
  cd "$ROOT/vsrc"
  echo "export * from '@gltf-transform/core'" | npx esbuild --bundle --format=esm --log-level=warning \
    --outfile="$ROOT/vendor/gltf-core.js"
  echo "export * from '@gltf-transform/extensions'" | npx esbuild --bundle --format=esm --log-level=warning \
    --external:@gltf-transform/core --outfile="$ROOT/vendor/gltf-extensions.js"
  echo "export * from '@gltf-transform/view'" | npx esbuild --bundle --format=esm --log-level=warning \
    --external:@gltf-transform/core --external:@gltf-transform/extensions \
    --external:three --external:'three/*' --outfile="$ROOT/vendor/gltf-view.js"
  cd - >/dev/null
fi

# 4. A self-signed certificate for 127.0.0.1 (ports 8443 and 8444 are the two origins).
if [ ! -f "$ROOT/harness/cert.pem" ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj /CN=127.0.0.1 \
    -addext subjectAltName=IP:127.0.0.1 \
    -keyout "$ROOT/harness/key.pem" -out "$ROOT/harness/cert.pem" 2>/dev/null
fi

# 5. Two libraries in the production format, made by scripts/library-build with its fake Poly Haven.
# A half-built library (an earlier failed run) is removed first: the generator refuses an existing directory.
for lib in small heavy; do [ -f "$ROOT/lib-$lib/catalog.json" ] || rm -rf "$ROOT/lib-$lib"; done
[ -f "$ROOT/lib-small/catalog.json" ] || ATRIUM_REPO="$REPO" node "$ROOT/harness/gen.mjs" small "$ROOT/lib-small" >/dev/null
[ -f "$ROOT/lib-heavy/catalog.json" ] || ATRIUM_REPO="$REPO" node "$ROOT/harness/gen.mjs" heavy "$ROOT/lib-heavy" >/dev/null

# 6. A world whose sky is document-relative (refused by rule), for the 'rel*' worlds.
node -e '
  const fs = require("fs"); const [src, out] = process.argv.slice(1)
  const j = JSON.parse(fs.readFileSync(src, "utf8")); j.extras.atrium.background.texture = "skyboxtest1.png"
  fs.writeFileSync(out, JSON.stringify(j))' "$ROOT/wt/tests/fixtures/atrium.gltf" "$ROOT/harness/atrium-rel.gltf"

# 7. Khronos's animated sample models for the scripting-4a checks (served at /khronos/), by a sparse clone.
if [ ! -f "$ROOT/khronos/Fox.glb" ] || [ ! -f "$ROOT/khronos/CesiumMan.glb" ]; then
  mkdir -p "$ROOT/khronos"
  [ -d "$ROOT/gsa/.git" ] || git clone -q --depth 1 --filter=blob:none --sparse https://github.com/KhronosGroup/glTF-Sample-Assets.git "$ROOT/gsa"
  git -C "$ROOT/gsa" sparse-checkout set Models/Fox/glTF-Binary Models/CesiumMan/glTF-Binary
  cp "$ROOT/gsa/Models/Fox/glTF-Binary/Fox.glb" "$ROOT/gsa/Models/CesiumMan/glTF-Binary/CesiumMan.glb" "$ROOT/khronos/"
fi

python3 -c 'import playwright' 2>/dev/null || echo "WARNING: Python Playwright is missing (pip install --break-system-packages playwright)"
echo "ready: start the server with HARNESS_ROOT=$ROOT node $ROOT/harness/server.mjs (Bash run_in_background)"
