# A. Read-only. Paste the whole output back to Claude.
echo "== guard copies (sha256, path) =="
sha256sum /root/.hermes/profiles/*/plugins/atrium-kanban-guard/__init__.py
grep -H '^version:' /root/.hermes/profiles/*/plugins/atrium-kanban-guard/plugin.yaml
echo "== release status and the test list (sha256, mode) =="
sha256sum /usr/local/sbin/atrium-release-status /usr/local/lib/atrium-host/lib/atrium_host/buildrun.py
stat -c '%a %U:%G %n' /usr/local/sbin/atrium-release-status /usr/local/lib/atrium-host/lib/atrium_host/buildrun.py
echo "== the board's tasks columns (read-only) =="
python3 -c 'import glob, sqlite3
for p in sorted(glob.glob("/root/.hermes/kanban/**/*.db", recursive=True)):
    try:
        c = sqlite3.connect("file:" + p + "?mode=ro", uri=True)
        print(p, [r[1] for r in c.execute("PRAGMA table_info(tasks)")])
    except Exception as e:
        print(p, "unreadable:", e)'
echo "== deploy lock, container memory =="
atrium-release-status | grep -E "STATE|DEPLOY LOCK"
docker stats --no-stream hermes-c6b7f940
