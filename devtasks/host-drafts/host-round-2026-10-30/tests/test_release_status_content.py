# Tests for atrium-release-status's content check (host round 2026-10-30).
# Loads only the script's definitions (everything before the top-level run), then
# serves a git checkout's apps/client/src over HTTP and compares.
import http.server, os, subprocess, sys, tempfile, threading, unittest, functools
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = open(os.environ.get("RS_FILE", os.path.join(HERE, "../atrium-release-status"))).read()
defs = SRC.split("\nif STATE_FILE.exists():")[0]
ns = {}
exec(compile(defs, "atrium-release-status", "exec"), ns)

def git(repo, *a):
    subprocess.run(["git", "-C", repo, *a], check=True, capture_output=True,
                   env={**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t",
                        "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"})

class Content(unittest.TestCase):
    def setUp(self):
        self.repo = tempfile.mkdtemp()
        git(self.repo, "init", "-q")
        os.makedirs(os.path.join(self.repo, "apps/client/src"))
        self.write(b"// release A\n")
        git(self.repo, "add", "-A"); git(self.repo, "commit", "-qm", "A")
        self.served = tempfile.mkdtemp()
        handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=self.served)
        handler.log_message = lambda *a, **k: None
        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"

    def tearDown(self):
        self.httpd.shutdown()

    def write(self, data):
        with open(os.path.join(self.repo, "apps/client/src/app.js"), "wb") as f: f.write(data)

    def serve(self, data):
        with open(os.path.join(self.served, "app.js"), "wb") as f: f.write(data)

    def test_same_bytes_is_ok(self):
        self.serve(b"// release A\n")
        ok, detail = ns["served_content"](self.repo, self.base)
        self.assertIs(ok, True, detail)

    def test_another_release_served_is_a_failure(self):   # the front door's 4a1a01a5 confusion
        self.serve(b"// release B\n")
        ok, detail = ns["served_content"](self.repo, self.base)
        self.assertIs(ok, False); self.assertIn("served sha256", detail)

    def test_compares_with_head_not_the_working_tree(self):
        self.serve(b"// edited on disk\n"); self.write(b"// edited on disk\n")   # uncommitted
        ok, _ = ns["served_content"](self.repo, self.base)
        self.assertIs(ok, False)

    def test_unfetchable_is_not_ok(self):
        ok, detail = ns["served_content"](self.repo, self.base + "/missing")
        self.assertIsNone(ok); self.assertIn("can't be fetched", detail)

    def test_unreadable_checkout_is_not_ok(self):
        self.serve(b"// release A\n")
        ok, detail = ns["served_content"](tempfile.mkdtemp(), self.base)
        self.assertIsNone(ok); self.assertIn("can't be read", detail)

if __name__ == "__main__":
    unittest.main(verbosity=2)
