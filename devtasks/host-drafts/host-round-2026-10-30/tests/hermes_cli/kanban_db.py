# Test stub of the three board calls the guard makes.
import json
def get_current_board(): return "atrium"
def _normalize_board_slug(raw): return raw
def link_tasks(conn, parent, child):
    conn.execute("INSERT INTO task_links VALUES (?, ?)", (parent, child))
def unblock_task(conn, tid):
    n = conn.execute("UPDATE tasks SET status='todo' WHERE id=? AND status='blocked'", (tid,)).rowcount
    if n: conn.execute("INSERT INTO task_events(task_id, kind, payload) VALUES (?, 'unblocked', ?)",
                       (tid, json.dumps({"status": "todo"})))
    return n
