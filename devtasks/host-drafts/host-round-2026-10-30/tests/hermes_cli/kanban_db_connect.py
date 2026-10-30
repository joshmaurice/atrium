# Test stub: a scratch board in one sqlite file (DB env var).
import contextlib, os, sqlite3
@contextlib.contextmanager
def connect_closing(board=None):
    conn = sqlite3.connect(os.environ["GUARD_TEST_DB"]); 
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()
@contextlib.contextmanager
def write_txn(conn):
    yield
    conn.commit()
