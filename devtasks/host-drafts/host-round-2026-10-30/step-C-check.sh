# C. Check. Read-only, except one labelled line in a scratch guard log.
atrium-release-status | grep -E "health"
/usr/local/lib/atrium-host/sbin/atrium-build-run list-tests
G="$(ls /root/.hermes/profiles/*/plugins/atrium-kanban-guard/__init__.py | head -1)"
HERMES_HOME="$(mktemp -d)" python3 -c 'import importlib.util, sys
s = importlib.util.spec_from_file_location("g", sys.argv[1]); g = importlib.util.module_from_spec(s); s.loader.exec_module(g)
r = g.pre_tool_call("kanban_create", {"board": "atrium", "title": "HOST ROUND CHECK, not a card", "assignee": "atrium-glm", "body": "x"})
print(r["action"], r["args"].get("initial_status"), g.NO_PARENT_NOTE in r["args"]["body"])' "$G"
