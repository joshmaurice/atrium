#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# smoke-now.sh — run the browser smoke check once, exactly as atrium-deploy will
# (the same transient unit and options), against the DEV page. Changes nothing.
# Run as root. Expect a line starting "SMOKE OK:" and exit 0.
set -uo pipefail
D=/usr/local/lib/atrium-smoke
PAGE="${1:-https://dev.ewwb.dev/}"
systemd-run --quiet --pipe --wait --collect --unit="atrium-smoke-manual-$$" \
  --uid=atrium-smoke --gid=atrium-smoke \
  -p RuntimeMaxSec=120 -p MemoryMax=1G -p NoNewPrivileges=yes -p PrivateTmp=yes \
  -p ProtectSystem=strict -p ProtectHome=yes \
  -E PLAYWRIGHT_BROWSERS_PATH="$D/browsers" -E HOME=/tmp \
  "$D/venv/bin/python" "$D/atrium-client-smoke" "$PAGE" --require-id ep-model --timeout 40
rc=$?
echo "exit $rc"
exit $rc
