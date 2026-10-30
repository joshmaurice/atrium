# Tests for atrium-kanban-guard v1.2.0 (host round 2026-10-30). Run: python3 test_guard_v120.py
import importlib.util, json, os, sqlite3, sys, tempfile, unittest
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
TMP = tempfile.mkdtemp()
os.environ["HERMES_HOME"] = TMP
os.environ["GUARD_TEST_DB"] = os.path.join(TMP, "board.db")
spec = importlib.util.spec_from_file_location("g", os.environ.get("GUARD_FILE", os.path.join(HERE, "../kanban_guard.py")))
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)
SHA = "a70a2476c742e12be1ec94b7fe42b39cb425ecfd"

def db():
    return sqlite3.connect(os.environ["GUARD_TEST_DB"])

def reset():
    if os.path.exists(os.environ["GUARD_TEST_DB"]): os.remove(os.environ["GUARD_TEST_DB"])
    c = db()
    c.executescript("""
      CREATE TABLE tasks(id TEXT PRIMARY KEY, title TEXT, status TEXT, body TEXT, assignee TEXT,
                         created_at INTEGER DEFAULT 0, max_retries INTEGER);
      CREATE TABLE task_links(parent_id TEXT, child_id TEXT);
      CREATE TABLE task_events(id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, kind TEXT, payload TEXT);
      CREATE TABLE task_comments(task_id TEXT, body TEXT, created_at INTEGER);""")
    c.commit(); c.close()
    log = os.path.join(TMP, "logs", "atrium-kanban-guard.log")
    if os.path.exists(log): os.remove(log)

def create(tid, args):
    """Run the pre hook, then 'create' the card as Hermes would with the modified args."""
    out = g.pre_tool_call("kanban_create", dict(args))
    if out and out.get("action") == "block":
        return out
    final = {**args, **((out or {}).get("args") or {})}
    parents = g._parents(final)
    status = final.get("initial_status") or ("todo" if parents else "ready")
    c = db()
    c.execute("INSERT INTO tasks(id,title,status,body,assignee) VALUES (?,?,?,?,?)",
              (tid, final.get("title"), status, final.get("body", ""), final.get("assignee")))
    c.execute("INSERT INTO task_events(task_id,kind,payload) VALUES (?, 'created', ?)",
              (tid, json.dumps({"status": status, "parents": parents})))
    for p in parents: c.execute("INSERT INTO task_links VALUES (?,?)", (p, tid))
    c.commit(); c.close()
    g.post_tool_call("kanban_create", dict(args), json.dumps({"task_id": tid}))
    return final

def link(parent, child):
    assert g.pre_tool_call("kanban_link", {"parent_id": parent, "child_id": child}) is None
    c = db(); c.execute("INSERT INTO task_links VALUES (?,?)", (parent, child)); c.commit(); c.close()
    g.post_tool_call("kanban_link", {"parent_id": parent, "child_id": child}, "{}")

def status(tid):
    c = db(); r = c.execute("SELECT status FROM tasks WHERE id=?", (tid,)).fetchone(); c.close(); return r[0]

def log_events():
    path = os.path.join(TMP, "logs", "atrium-kanban-guard.log")
    if not os.path.exists(path):
        return []
    with open(path) as fh:
        return [json.loads(l) for l in fh]

class V120(unittest.TestCase):
    def setUp(self): reset()

    def test_kickoff_is_a_root_and_not_held(self):
        f = create("t_kick", {"title": "Kickoff — signin-sync", "assignee": g.ORCH, "body": "x"})
        self.assertNotIn("initial_status", {k: v for k, v in f.items() if k == "initial_status" and v == "blocked"})
        self.assertEqual(status("t_kick"), "ready")
        self.assertNotIn(g.NO_PARENT_NOTE, f["body"])

    def test_parentless_worker_card_is_held_then_released_by_a_link(self):
        create("t_kick", {"title": "Kickoff — x", "assignee": g.ORCH, "body": "k"})
        f = create("t_impl", {"title": "Implement — x", "assignee": "atrium-deepseek", "body": "do it"})
        self.assertEqual(f["initial_status"], "blocked")
        self.assertIn(g.NO_PARENT_NOTE, f["body"])
        self.assertEqual(status("t_impl"), "blocked")        # never claimable while parentless
        link("t_kick", "t_impl")
        self.assertEqual(status("t_impl"), "todo")           # now waits on its parent like any card
        self.assertTrue(any(e["event"] == "no_parent_released" and e["released"] for e in log_events()))

    def test_parentless_stage_card_is_held(self):   # the round-2 Publish card's case
        f = create("t_pub", {"title": f"Publish workflow — {SHA[:8]}", "assignee": g.DEPLOYER,
                             "body": f'atrium_deploy(action="publish", sha="{SHA}", branch="workflow/x")'})
        self.assertEqual(f["initial_status"], "blocked")
        self.assertEqual(f["title"], f"Publish workflow — {SHA[:8]}")
        self.assertEqual(status("t_pub"), "blocked")

    def test_parentless_sentinel_is_held(self):     # round 1's sentinel, claimed in 4 s
        create("t_sen", {"title": "X sentinel (x)", "assignee": g.ORCH, "body": "notify"})
        self.assertEqual(status("t_sen"), "blocked")

    def test_card_with_parents_is_unchanged(self):
        create("t_kick", {"title": "Kickoff — x", "assignee": g.ORCH, "body": "k"})
        for parents in (["t_kick"], "t_kick", "t_kick, t_other"):
            reset(); create("t_kick", {"title": "Kickoff — x", "assignee": g.ORCH, "body": "k"})
            f = create("t_b", {"title": "GLM brief — x", "assignee": "atrium-glm", "body": "b", "parents": parents})
            self.assertNotEqual(f.get("initial_status"), "blocked", parents)
            self.assertNotIn(g.NO_PARENT_NOTE, f["body"])
            self.assertEqual(status("t_b"), "todo")

    def test_a_caller_blocked_gate_is_never_released_by_a_link(self):
        create("t_kick", {"title": "Kickoff — x", "assignee": g.ORCH, "body": "k"})
        create("t_gate", {"title": "OPERATOR BLOCK: awaiting human brief review — x", "assignee": g.ORCH,
                          "body": "OPERATOR BLOCK: only the operator", "initial_status": "blocked"})
        link("t_kick", "t_gate")
        self.assertEqual(status("t_gate"), "blocked")

    def test_a_card_its_creator_made_blocked_is_not_released_by_a_link(self):
        # Not a gate title, no parent, created blocked by the CALLER: the guard didn't hold it
        # (no NO_PARENT_NOTE in its body), so a link must not release it.
        create("t_kick", {"title": "Kickoff — x", "assignee": g.ORCH, "body": "k"})
        c = db()
        c.execute("INSERT INTO tasks(id,title,status,body,assignee) VALUES ('t_m','Manual hold — x','blocked','held by hand','atrium-glm')")
        c.execute("INSERT INTO task_events(task_id,kind,payload) VALUES ('t_m','created',?)", (json.dumps({"status": "blocked", "parents": []}),))
        c.commit(); c.close()
        link("t_kick", "t_m")
        self.assertEqual(status("t_m"), "blocked")

    def test_a_held_card_that_blocked_itself_since_is_not_released(self):
        create("t_kick", {"title": "Kickoff — x", "assignee": g.ORCH, "body": "k"})
        create("t_c", {"title": "Implement — x", "assignee": "atrium-deepseek", "body": "b"})
        c = db(); c.execute("INSERT INTO task_events(task_id,kind,payload) VALUES ('t_c','blocked','{}')"); c.commit(); c.close()
        link("t_kick", "t_c")
        self.assertEqual(status("t_c"), "blocked")

    def test_release_fails_closed_without_a_body_column(self):
        create("t_kick", {"title": "Kickoff — x", "assignee": g.ORCH, "body": "k"})
        create("t_c", {"title": "Implement — x", "assignee": "atrium-deepseek", "body": "b"})
        c = db(); c.execute("ALTER TABLE tasks RENAME COLUMN body TO description"); c.commit(); c.close()
        link("t_kick", "t_c")
        self.assertEqual(status("t_c"), "blocked")           # stays unclaimable; the error is logged
        self.assertTrue(any(e["event"] == "error" and e["tool"] == "post_kanban_link" for e in log_events()))

    def test_argument_keys_are_logged_without_values(self):
        create("t_kick", {"title": "Kickoff — x", "assignee": g.ORCH, "body": "SECRET-BODY-TEXT",
                          "max_runtime_seconds": 14400})
        g.pre_tool_call("kanban_complete", {"summary": "SECRET-SUMMARY", "metadata": {"a": 1}})
        ev = [e for e in log_events() if e["event"] == "args"]
        self.assertEqual([e["tool"] for e in ev], ["kanban_create", "kanban_complete"])
        self.assertEqual(ev[0]["keys"], ["assignee", "body", "max_runtime_seconds", "title"])
        self.assertEqual(ev[0]["body_chars"], len("SECRET-BODY-TEXT"))
        self.assertEqual(ev[0]["max_runtime_seconds"], 14400)
        self.assertEqual(ev[1]["keys"], ["metadata", "summary"])
        with open(os.path.join(TMP, "logs", "atrium-kanban-guard.log")) as fh:
            raw = fh.read()
        self.assertNotIn("SECRET", raw)

    def test_kanban_complete_is_never_changed(self):
        self.assertIsNone(g.pre_tool_call("kanban_complete", {"summary": "s"}))

    def test_existing_rules_still_hold(self):
        # v1.1.x: a MAIN push still needs the approval comment; a human gate still needs blocked.
        out = g.pre_tool_call("kanban_create", {"title": f"MAIN push — {SHA[:8]}", "assignee": g.DEPLOYER,
                                                "body": f'atrium_deploy(action="main", sha="{SHA}")', "parents": ["t_x"]})
        self.assertEqual(out["action"], "block")
        out = g.pre_tool_call("kanban_create", {"title": f"Awaiting DEV acceptance / main merge approval — {SHA[:8]}",
                                                "assignee": g.ORCH, "body": SHA, "parents": ["t_f"]})
        self.assertEqual(out["action"], "block")
        self.assertIn("initial_status", out["message"])

if __name__ == "__main__":
    unittest.main(verbosity=2)
