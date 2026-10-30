# B. Install. Run as root, only after Claude confirms step A. It stops before
# changing anything unless every downloaded file and every live file has the
# expected sha256, and it holds the deploy lock so no deploy starts meanwhile.
set -euo pipefail
exec 9>>/run/lock/atrium-deploy.lock
flock -n 9 || { echo "STOP: a deploy holds the lock; run this again when it's free"; exit 1; }
check() { [ "$(sha256sum "$1" | cut -d' ' -f1)" = "$2" ] || { echo "STOP: $1 is not $2; nothing was changed by this check"; exit 1; }; }
B=/root/host-round-2026-10-30-backup
S=/tmp/host-round-2026-10-30
mkdir -p "$B" "$S"
U=https://raw.githubusercontent.com/joshmaurice/atrium/43a6ed34a2f43f56c218c788c1411a52de59d3b1/devtasks/host-drafts/host-round-2026-10-30
for f in kanban_guard.py atrium-release-status buildrun.py; do
  curl -fsS -o "$S/$f" "$U/$f"
done
check "$S/kanban_guard.py"        d14f7b85f7eb4d23b2aaccecffc3a5c7a73297125139bdc51d13f3193d95bcfa
check "$S/atrium-release-status"  18b36f195bab1e50de51865d6289d55c5f724bbefe4490e1e3077c05634e90ac
check "$S/buildrun.py"            e03b832433372b6dc9a7f1c716b568574bcb5d18868b2868a8e053bd65574793
GUARDS=(/root/.hermes/profiles/*/plugins/atrium-kanban-guard/__init__.py)
[ -f "${GUARDS[0]}" ] || { echo "STOP: no guard copies found"; exit 1; }
for g in "${GUARDS[@]}"; do check "$g" 5a1ca40bdd12bb1448b846006e6f5526461f21cbe608478ed5c4ce72e35c3e01; done
check /usr/local/sbin/atrium-release-status                  9d37c98b587d0c7ac426003bfee92227245360afb56fe112ba2a2d0f99367517
check /usr/local/lib/atrium-host/lib/atrium_host/buildrun.py 8af62e357df3b481ac95dca10275f0727c61f8ffe008f557aff351055cb9c3dc
echo "Every baseline matches (${#GUARDS[@]} guard copies). Installing; backups in $B."
for g in "${GUARDS[@]}"; do
  p="$(basename "$(dirname "$(dirname "$(dirname "$g")")")")"
  y="$(dirname "$g")/plugin.yaml"
  mkdir -p "$B/$p"
  cp -p "$g" "$B/$p/__init__.py"
  if [ -f "$y" ]; then cp -p "$y" "$B/$p/plugin.yaml"; fi
  cp "$S/kanban_guard.py" "$g"            # cp onto the existing file keeps its owner and mode
  if [ -f "$y" ]; then sed -i 's/^version:.*/version: 1.2.0/' "$y"; fi
done
cp -p /usr/local/sbin/atrium-release-status "$B/atrium-release-status"
cp "$S/atrium-release-status" /usr/local/sbin/atrium-release-status
cp -p /usr/local/lib/atrium-host/lib/atrium_host/buildrun.py "$B/buildrun.py"
cp "$S/buildrun.py" /usr/local/lib/atrium-host/lib/atrium_host/buildrun.py
for g in "${GUARDS[@]}"; do check "$g" d14f7b85f7eb4d23b2aaccecffc3a5c7a73297125139bdc51d13f3193d95bcfa; done
check /usr/local/sbin/atrium-release-status                  18b36f195bab1e50de51865d6289d55c5f724bbefe4490e1e3077c05634e90ac
check /usr/local/lib/atrium-host/lib/atrium_host/buildrun.py e03b832433372b6dc9a7f1c716b568574bcb5d18868b2868a8e053bd65574793
stat -c '%a %U:%G %n' "${GUARDS[@]}" /usr/local/sbin/atrium-release-status /usr/local/lib/atrium-host/lib/atrium_host/buildrun.py
grep -H '^version:' /root/.hermes/profiles/*/plugins/atrium-kanban-guard/plugin.yaml || true
echo "INSTALLED."
