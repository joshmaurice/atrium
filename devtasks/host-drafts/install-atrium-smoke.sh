#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# install-atrium-smoke.sh — installs H3's browser smoke check
# (devtasks/PREBRIEF-models-hardening.md, H3). Run as root from the folder that
# holds atrium-client-smoke. Safe to run again.
set -euo pipefail
[[ "$(id -u)" == 0 ]] || { echo "Run this as root."; exit 1; }
HERE=$(cd "$(dirname "$0")" && pwd)
D=/usr/local/lib/atrium-smoke
[[ -f "$HERE/atrium-client-smoke" ]] || { echo "atrium-client-smoke is not next to this script."; exit 1; }

command -v python3 >/dev/null || { echo "python3 is missing (apt-get install -y python3)."; exit 1; }
if ! python3 -c 'import venv, ensurepip' 2>/dev/null; then
  echo "Installing python3-venv..."
  apt-get install -y python3-venv
fi

# A system user with no home and no shell: the check never runs as root.
id atrium-smoke >/dev/null 2>&1 \
  || useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin atrium-smoke

install -d -o root -g root -m 755 "$D"
[[ -x "$D/venv/bin/python" ]] || python3 -m venv "$D/venv"
"$D/venv/bin/pip" install --quiet --disable-pip-version-check 'playwright==1.56.0'
# Chromium and the system libraries it needs (apt), under the check's own folder.
PLAYWRIGHT_BROWSERS_PATH="$D/browsers" "$D/venv/bin/python" -m playwright install --with-deps chromium
install -o root -g root -m 755 "$HERE/atrium-client-smoke" "$D/atrium-client-smoke"
chown -R root:root "$D"
chmod -R go-w,a+rX "$D"

echo
echo "Installed in $D. Try it now (it changes nothing):"
echo "  bash $HERE/smoke-now.sh"
