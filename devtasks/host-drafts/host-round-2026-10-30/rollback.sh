# Rollback: put back every file step B replaced, from its backup.
set -euo pipefail
B=/root/host-round-2026-10-30-backup
for d in "$B"/*/; do
  p="$(basename "$d")"; t="/root/.hermes/profiles/$p/plugins/atrium-kanban-guard"
  cp "$d/__init__.py" "$t/__init__.py"
  if [ -f "$d/plugin.yaml" ]; then cp "$d/plugin.yaml" "$t/plugin.yaml"; fi
done
cp "$B/atrium-release-status" /usr/local/sbin/atrium-release-status
cp "$B/buildrun.py" /usr/local/lib/atrium-host/lib/atrium_host/buildrun.py
sha256sum /root/.hermes/profiles/*/plugins/atrium-kanban-guard/__init__.py /usr/local/sbin/atrium-release-status /usr/local/lib/atrium-host/lib/atrium_host/buildrun.py
