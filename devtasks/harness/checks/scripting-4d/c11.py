# scripting-4d-1 §6.1 check 11 — the rollback rehearsal (§8, G10; Rev 1.1 M3; R8 / R-L2 (a)), LOCALLY, end to end:
# the round's real server, then the 4c server (BASE root, PROD's 14ab0076) over the SAME database, then the round's again.
#
#   phase 1 (4d)  alice's world W1: cubes N1, N2, N3 each carry a 4d-only leaf (on select → setDelay → hide N4; setDelay
#                 is not in 4c's rule), N4 is a plain cube; bob's world W2: B1 carries a 4d-only leaf (target B2).
#                 With the 4d server UP: export and reconcile REFUSE (the lifetime lock's pid is alive).
#   step 1        stop the server; back the database up with SQLite's backup API (never a file copy); sha256; it opens.
#   step 2        behaviors-export.mjs against the COPY.
#   phase 2 (4c)  roll back: the 4c server over the same database. alice opens W1 (4c heals the three leaves to null in
#                 memory); moves N4 (an unrelated transform edit: autosave writes the nulls); replaces N2's leaf with a 4c
#                 template; deletes N3 and adds a new cube. bob's W2 stays OFFLINE (its leaf is never healed in storage).
#                 With the 4c server UP: the scripts have NO lock to see (the 4c server predates R8) — recorded.
#   step 4        stop the 4c server; second backup; reconcile dry run (no write) → --apply → --apply.
#                 Expected: N1 restore (W1, edited during the rollback), N2 conflict (a different leaf), N3 conflict (the
#                 node is gone), B1 unchanged; one world written; the second --apply writes nothing, same conflicts.
#   after         the 4d server again: N1's leaf is back byte for byte and RUNS (a click hides N4 after the delay),
#                 N4's transform, N2's template and the new cube are kept, B1 intact, healing dropped nothing.
#                 A stale lock (dead pid) is warned about, removed, and the script proceeds.
# Nothing else may be listening on 8443/8444. Run with the Bash tool's run_in_background (≈ 4 min).
#   HARNESS_ROOT=/tmp/atrium-harness BASE_ROOT=/tmp/ah-base python3 c11.py
import subprocess, signal, sqlite3, hashlib, shutil
from common4d import *

R = os.environ.get('HARNESS_ROOT', '/tmp/atrium-harness'); BASE = os.environ.get('BASE_ROOT', '/tmp/ah-base')
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..'))
AUTHSERVER = os.path.join(REPO, 'devtasks/harness/checks/signin-sync/authserver.mjs')
D = '/tmp/rh'; shutil.rmtree(D, ignore_errors=True); os.makedirs(D)
DB = f'{D}/prod.db'
SCRIPTS = f'{R}/wt/packages/server/scripts'

G = graph([                                  # file node 0 = own, 1 = target; flow/setDelay makes it 4d-only
    on_select(0) | {'flows': {'out': flow(1)}},
    {'op': 'flow/setDelay', 'values': {'duration': lit('float', 0.5)}, 'flows': {'done': flow(2)}},
    setter(VIS_PTR.format(i=1), 'bool', lit('bool', False)) | {'flows': {'out': flow(3)}},
    {'op': 'flow/setDelay', 'values': {'duration': lit('float', 2.0)}, 'flows': {'done': flow(4)}},
    setter(VIS_PTR.format(i=1), 'bool', lit('bool', True)),
])


def start(root, label, keep=True):
    env = dict(os.environ, HARNESS_ROOT=root, AUTH_DB=DB, HOOKS='1', ATRIUM_AUTOSAVE_DEBOUNCE_MS='2000')
    env.pop('KEEP_DB', None); env.pop('STALE_ROOT', None)
    if keep: env['KEEP_DB'] = '1'
    path = f'{D}/server-{label}.log'; logf = open(path, 'w')
    p = subprocess.Popen(['node', AUTHSERVER], env=env, stdout=logf, stderr=subprocess.STDOUT, start_new_session=True)
    for _ in range(100):
        time.sleep(0.3)
        if 'listening 8444' in open(path).read(): break
    p.label, p.logpath = label, path
    print(f'   [{label}] server up on {git_sha(root)[:8]}, lock file: {lock()}')
    return p


def stop(p):
    os.killpg(p.pid, signal.SIGTERM)
    try: p.wait(10)
    except Exception: os.killpg(p.pid, signal.SIGKILL); p.wait()
    time.sleep(1)
    print(f'   [{p.label}] server stopped, lock file: {lock()}')


def git_sha(root): return subprocess.run(['git', '-C', f'{root}/wt', 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip()
def lock():
    try: return json.loads(open(DB + '.lock').read())
    except FileNotFoundError: return None
    except Exception as e: return {'unreadable': str(e)}
def pid_alive(pid):
    try: os.kill(pid, 0); return True
    except ProcessLookupError: return False
    except PermissionError: return True


def script(name, *args):
    r = subprocess.run(['node', f'{SCRIPTS}/{name}', *args], capture_output=True, text=True, timeout=120)
    out = r.stdout + r.stderr
    rep = None
    for l in r.stdout.splitlines():
        if l.startswith('REPORT_JSON '): rep = json.loads(l[len('REPORT_JSON '):])
    return r.returncode, out, rep


def show(out, n=30):
    for l in out.splitlines()[:n]:
        if not l.startswith('REPORT_JSON'): print('      |', l[:220])


def backup(dst):
    """SQLite's online backup API (what `sqlite3 <db> ".backup <copy>"` does), never a file copy."""
    with sqlite3.connect(DB) as src, sqlite3.connect(dst) as out: src.backup(out)
    sha = hashlib.sha256(open(dst, 'rb').read()).hexdigest()
    with sqlite3.connect(dst) as c: ok = c.execute('PRAGMA integrity_check').fetchone()[0]; n = c.execute('SELECT count(*) FROM worlds').fetchone()[0]
    print(f'   backup {dst}: sha256 {sha[:16]}…, integrity_check {ok}, {n} worlds')
    return sha, ok


def docs():
    """{world slug: (document dict, updated_at)} straight from the database (the server must be stopped)."""
    with sqlite3.connect(DB) as c:
        cols = [r[1] for r in c.execute('PRAGMA table_info(worlds)')]
        slugcol = 'slug' if 'slug' in cols else 'id'
        return {r[0]: (json.loads(r[1]), r[2]) for r in c.execute(f'SELECT {slugcol}, document, updated_at FROM worlds')}


def node_by_id(doc, oid):
    xs = [n for n in doc.get('nodes', []) if n.get('extras', {}).get('atrium', {}).get('objectId') == oid]
    return xs[0] if len(xs) == 1 else (None if not xs else 'dup')


def beh(n): return None if n in (None, 'dup') else n.get('extras', {}).get('atrium', {}).get('behavior')


def write_leaf(t, own_name, target_name):
    own = t.ev(OID, own_name) or t.ev(SETID, own_name); tgt = t.ev(OID, target_name) or t.ev(SETID, target_name)
    v = {'kind': 'graph', 'origin': 'local', 'enabled': True, 'graph': G, 'nodeMap': [own, tgt], 'targets': [tgt], 'animations': []}
    return t.ev(SEND, {'name': own_name, 'field': LEAF, 'value': v})


def world_of(t, user, tag):
    slug = f'{tag}-{int(time.time())}'
    st = t.ev("""async (slug) => (await fetch('/api/worlds', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug }) })).status""", slug)
    print('   new world', user, slug, st)
    return slug, f'wss://127.0.0.1:8443/worlds/{user}/{slug}'


def delete_node(t, name):
    t.page.once('dialog', lambda d: d.accept())
    select_node(t, name); t.page.click('#ep-delete')
    return t.wait("(n) => !atriumClient.som.getNodeByName(n)", arg=name, timeout=10000)


with sync_playwright() as pw:
    br = new_browser(pw)
    print(f'== 11. phase 1: the round ({git_sha(R)[:8]}), a fresh database {DB}')
    srv = start(R, '4d-1', keep=False)
    print('register', register(br, ('alice', 'bob')))
    actx = br.new_context(ignore_https_errors=True, viewport={'width': 1280, 'height': 800})
    bctx = br.new_context(ignore_https_errors=True, viewport={'width': 1280, 'height': 800})
    a = owner_tab(actx, 'A', first=True)
    s1, W1 = world_of(a, 'alice', 'rh1'); print('   W1 public', make_public(a, s1)); print('   A connected', a.connect(W1))
    a.edit_on(); N = [add_cube(a) for _ in range(4)]; a.page.wait_for_timeout(400)
    for i, n in enumerate(N): a.ev(MOVE, {'name': n, 't': [-3 + 2 * i, 0.5, -3]})
    a.page.wait_for_timeout(400)
    w = [write_leaf(a, n, N[3]) for n in N[:3]]
    print('   W1 leaf writes', [x['k'] for x in w])
    ids = {n: a.ev(OID, n) for n in N}
    b = Tab(bctx, 'B'); b.login('bob'); b.wait_world('/worlds/bob/home'); b.page.wait_for_timeout(800)
    s2, W2 = world_of(b, 'bob', 'rh2'); print('   B connected', b.connect(W2))
    b.edit_on(); B1, B2 = add_cube(b), add_cube(b); b.ev(MOVE, {'name': B2, 't': [2, 0.5, -3]}); b.page.wait_for_timeout(400)
    wb = write_leaf(b, B1, B2); print('   W2 leaf write', wb['k'])
    idB1 = b.ev(OID, B1)
    check('11 phase 1: every 4d leaf accepted (three in alice\'s world, one in bob\'s)', all(x['k'] == 'accepted' for x in w) and wb['k'] == 'accepted', (w, wb))
    edit_off(a); edit_off(b); a.page.wait_for_timeout(4000)
    a.connect(); b.close(); a.page.wait_for_timeout(5000)       # back home: W1 and W2 autosave, flush and tear down

    print('\n== 11. the lock (R-L2 (a)): with the 4d server UP, both scripts refuse')
    L = lock(); print('   lock file:', L, '| pid alive:', L and pid_alive(L['pid']))
    rc_e, out_e, _ = script('behaviors-export.mjs', DB, f'{D}/live-export.json'); show(out_e, 4)
    open(f'{D}/empty-export.json', 'w').write(json.dumps({'worlds': []}))
    rc_r, out_r, _ = script('behaviors-reconcile.mjs', DB, f'{D}/empty-export.json'); show(out_r, 4)
    check('11 export refuses while the server holds the lock, naming its pid, and writes no export',
          rc_e != 0 and f"the world server is running (pid {L['pid']}" in out_e and not os.path.exists(f'{D}/live-export.json'), (rc_e, out_e[:300]))
    check('11 reconcile refuses while the server holds the lock', rc_r != 0 and f"the world server is running (pid {L['pid']}" in out_r, (rc_r, out_r[:300]))
    a.close(); stop(srv)
    check('11 a clean stop removes the lock file', lock() is None, lock())

    print('\n== 11. steps 1–2: backup (SQLite backup API), verify, export against the COPY')
    sha1, ok1 = backup(f'{D}/copy1.db')
    check('11 the first backup opens and passes integrity_check', ok1 == 'ok', ok1)
    rc, out, _ = script('behaviors-export.mjs', f'{D}/copy1.db', f'{D}/export.json'); show(out, 12)
    EXP = json.load(open(f'{D}/export.json'))
    exp_nodes = {n['objectId']: n for wd in EXP['worlds'] for n in wd['nodes']}
    check('11 the export lists the four 4d leaves, each with a sha256', rc == 0 and all(i in exp_nodes for i in [ids[N[0]], ids[N[1]], ids[N[2]], idB1]) and len(exp_nodes) == 4 and all(len(n['behaviorSha256']) == 64 for n in exp_nodes.values()), (rc, list(exp_nodes)))
    before = docs()
    d1, d2 = before[s1][0] if s1 in before else None, before[s2][0] if s2 in before else None
    if d1 is None:      # worlds keyed by id: find by contents
        for k, (d, _) in before.items():
            if node_by_id(d, ids[N[0]]) not in (None, 'dup'): d1, s1 = d, k
            if node_by_id(d, idB1) not in (None, 'dup'): d2, s2 = d, k
    leaf0 = {i: beh(node_by_id(d1 if i != idB1 else d2, i)) for i in [ids[N[0]], ids[N[1]], ids[N[2]], idB1]}
    n4_t0 = node_by_id(d1, ids[N[3]]).get('translation')

    print(f'\n== 11. phase 2: roll back to 4c ({git_sha(BASE)[:8]}) over the same database')
    srv = start(BASE, '4c', keep=True)
    check('11 the 4c server creates NO lifetime lock (it predates R8)', lock() is None, lock())
    rc_r4c, out_r4c, rep4c = script('behaviors-reconcile.mjs', DB, f'{D}/export.json')
    print('   reconcile (dry run) with the 4c server UP: exit', rc_r4c); show(out_r4c, 3)
    check('11 RECORDED: with the 4c server running, the scripts cannot tell (no lock) and proceed — the runbook must stop the server first', rc_r4c == 0, (rc_r4c, out_r4c[:200]))
    a = owner_tab(actx, 'A2'); print('   A (4c page) connected', a.connect(W1)); a.page.wait_for_timeout(1500)
    healed = [l for l in open(srv.logpath).read().splitlines() if 'behavio' in l and ('drop' in l or 'heal' in l)]
    print('   4c load lines:', healed[:6])
    check('11 the 4c server heals the three 4d leaves to null at load (in memory)', all(a.ev("(n) => atriumClient.som.getNodeByName(n)?.extras?.atrium?.behavior ?? null", n) is None for n in N[:3]), [leaf(a, n) is None for n in N[:3]])
    a.edit_on()
    a.ev(MOVE, {'name': N[3], 't': [3, 1.25, -3]}); a.page.wait_for_timeout(600)                 # the unrelated transform edit
    tb = behave(a, N[1], 'select-visibility', {'target': N[3], 'action': 'toggle'})              # N2: the owner's 4c template
    print('   N2 ← 4c template:', tb)
    gone = delete_node(a, N[2]); newc = add_cube(a); a.page.wait_for_timeout(500)                # N3: deleted, a new cube added
    new_id = a.ev(OID, newc) or a.ev(SETID, newc)
    print('   N3 deleted', gone, '| new cube', newc, new_id)
    edit_off(a); a.page.wait_for_timeout(4500); a.connect(); a.page.wait_for_timeout(5000); a.close()
    stop(srv)
    mid = docs(); dm1, upd1 = mid[s1]; dm2, upd2 = mid[s2]
    print('   W1 updated_at', before[s1][1], '→', upd1, '| W2', before[s2][1], '→', upd2)
    check("11 during the rollback W1's stored leaves became: N1 null, N2 the 4c template, N3 gone; N4 moved",
          beh(node_by_id(dm1, ids[N[0]])) is None and ((beh(node_by_id(dm1, ids[N[1]])) or {}).get('template') or {}).get('id') == 'select-visibility'
          and node_by_id(dm1, ids[N[2]]) is None and node_by_id(dm1, ids[N[3]]).get('translation') == [3, 1.25, -3],
          (beh(node_by_id(dm1, ids[N[0]])), ((beh(node_by_id(dm1, ids[N[1]])) or {}).get('template') or {}).get('id'), node_by_id(dm1, ids[N[2]]), node_by_id(dm1, ids[N[3]]).get('translation')))
    check("11 bob's W2, offline throughout, still holds its 4d leaf in storage (P17)", beh(node_by_id(dm2, idB1)) == leaf0[idB1] and upd2 == before[s2][1])

    print('\n== 11. step 4: the server stopped; second backup; reconcile dry run, --apply, --apply')
    sha2, ok2 = backup(f'{D}/copy2.db')
    raw_before = {k: v[0] for k, v in docs().items()}
    rc, out, rep = script('behaviors-reconcile.mjs', DB, f'{D}/export.json'); print('   DRY RUN exit', rc); show(out, 14)
    def outcomes(rep): return {l['objectId']: (l['outcome'], l.get('reason')) for wd in rep['worlds'] for l in wd['leaves']}
    o = outcomes(rep) if rep else {}
    exp_o = {ids[N[0]]: 'restore', ids[N[1]]: 'conflict', ids[N[2]]: 'conflict', idB1: 'unchanged'}
    check('11 dry run: N1 restore, N2 conflict (a different leaf), N3 conflict (the node is gone), B1 unchanged',
          rc == 0 and {k: v[0] for k, v in o.items()} == exp_o, o)
    wid1 = next(wd['worldId'] for wd in EXP['worlds'] if any(n['objectId'] == ids[N[0]] for n in wd['nodes']))
    wid2 = next(wd['worldId'] for wd in EXP['worlds'] if any(n['objectId'] == idB1 for n in wd['nodes']))
    since = {wd['worldId']: wd['sinceExport'] for wd in rep['worlds']} if rep else {}
    check("11 dry run: W1 is reported 'edited' during the rollback, W2 'untouched'; zero writes; the database is unchanged",
          since.get(wid1) == 'edited' and since.get(wid2) == 'untouched' and rep['totals']['writes'] == 0 and {k: v[0] for k, v in docs().items()} == raw_before,
          (since, rep and rep['totals']))
    rc, out, rep1 = script('behaviors-reconcile.mjs', DB, f'{D}/export.json', '--apply'); print('   --apply exit', rc); show(out, 14)
    after = docs(); da1, _ = after[s1]; da2, _ = after[s2]
    check('11 --apply: one write; only the untouched lost leaf (N1) is restored, byte for byte',
          rc == 0 and rep1['totals']['writes'] == 1 and rep1['totals']['restore'] == 1 and beh(node_by_id(da1, ids[N[0]])) == leaf0[ids[N[0]]], (rc, rep1 and rep1['totals']))
    check('11 ... every newer change is kept: N2 keeps the 4c template, N3 stays gone, the new cube and N4\'s transform kept, B1 untouched',
          ((beh(node_by_id(da1, ids[N[1]])) or {}).get('template') or {}).get('id') == 'select-visibility' and node_by_id(da1, ids[N[2]]) is None
          and node_by_id(da1, new_id) not in (None, 'dup') and node_by_id(da1, ids[N[3]]).get('translation') == [3, 1.25, -3]
          and beh(node_by_id(da2, idB1)) == leaf0[idB1],
          (((beh(node_by_id(da1, ids[N[1]])) or {}).get('template') or {}).get('id'), node_by_id(da1, ids[N[2]]), node_by_id(da1, new_id) not in (None, 'dup'), node_by_id(da1, ids[N[3]]).get('translation'), beh(node_by_id(da2, idB1)) == leaf0[idB1]))
    rc, out, rep2 = script('behaviors-reconcile.mjs', DB, f'{D}/export.json', '--apply'); print('   second --apply exit', rc); show(out, 14)
    o2 = outcomes(rep2) if rep2 else {}
    check('11 the second --apply changes nothing: zero writes, N1 now unchanged, the same two conflicts',
          rc == 0 and rep2['totals']['writes'] == 0 and o2.get(ids[N[0]], (None,))[0] == 'unchanged'
          and o2.get(ids[N[1]]) == o.get(ids[N[1]]) and o2.get(ids[N[2]]) == o.get(ids[N[2]]) and {k: v[0] for k, v in docs().items()} == {k: v[0] for k, v in after.items()},
          (rep2 and rep2['totals'], o2))
    reasons = sorted({v[1] for v in o.values() if v[0] == 'conflict'}); print('   conflict reasons:', reasons)

    print('\n== 11. a stale lock (dead pid) is warned about, removed, and the script proceeds')
    dead = subprocess.Popen(['true']); dead.wait()
    open(DB + '.lock', 'w').write(json.dumps({'pid': dead.pid, 'host': 'rehearsal', 'startedAt': '2026-10-31T00:00:00Z'}) + '\n')
    rc, out, _ = script('behaviors-export.mjs', DB, f'{D}/export-after.json'); show(out, 3)
    check(f'11 stale lock from pid {dead.pid}: warned, removed, the export proceeds', rc == 0 and f'stale lock from pid {dead.pid}, removed' in out and lock() is None, (rc, out[:300]))

    print(f'\n== 11. upgrade again: the round ({git_sha(R)[:8]}) loads the reconciled worlds')
    srv = start(R, '4d-2', keep=True)
    a = owner_tab(actx, 'A3'); print('   A connected', a.connect(W1))
    vctx = br.new_context(ignore_https_errors=True, viewport={'width': 1280, 'height': 800})
    v = Tab(vctx, 'V'); print('   V connected', v.connect(W1)); a.page.wait_for_timeout(1500)
    lg = open(srv.logpath).read()
    check('11 the restored world loads and healing drops nothing', 'dropped' not in lg.split('listening 8444')[-1] and leaf(a, N[0]) == leaf0[ids[N[0]]], [l for l in lg.splitlines() if 'drop' in l][:3])
    check("11 N1's restored leaf runs: the engine is live", (engine(a, N[0]) or {}).get('live') is True, engine(a, N[0]))
    click_node(v, N[0])
    hid = v.wait("([n]) => { const o = stage.scene.getObjectByName(n); return !!o && o.visible === false }", arg=[N[3]], timeout=3000)
    check('11 ... a visitor click hides N4 after the delay', hid, (a.ev(VIS, N[3]), rlog(a, 4)))
    v.wait("([n]) => { const o = stage.scene.getObjectByName(n); return !!o && o.visible === true }", arg=[N[3]], timeout=4000)
    print('\npage errors: A', a.errors[:3], '| V', v.errors[:3])
    a.close(); v.close(); stop(srv)
    br.close()
print('\nFAILS:', fails or 'none'); sys.exit(1 if fails else 0)
