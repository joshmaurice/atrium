# scripting-4b-1 §5.1 checks 1, 2, 3 and 7 (PREBRIEF-scripting-4b.md):
# 1 ids on the palette, Model form, teleporter and library adds; 2 Duplicate gets a
# new id, Undo of a delete and Redo of an undone add keep it, again after a reload;
# 3 the set-once leaf through client.setObjectId on the floor; 7 ids survive a restart.
import sys, os, re, json, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripting-4a'))
from anim import *   # h.py's Page, http, ctl, plus add_model/select/new_browser

W = 'wss://127.0.0.1:8443/w/ids' + str(int(time.time()))
KEY = W.rsplit('/', 1)[1]
UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
LOG = """() => { if (window.__log) return; window.__log = [];
  for (const e of ['script-host:changed', 'connecting', 'disconnected', 'edit:accepted', 'edit:rejected', 'edit:unknown'])
    atriumClient.on(e, (d) => __log.push([e, d && { active: d.active, hostGen: d.hostGen, field: d.field, code: d.code, message: d.message, type: d.type }])) }"""
NAMES = "atriumClient.som.allNodes.map(n => n.name)"
IDOF = "(n) => atriumClient.som.getNodeByName(n)?.extras?.atrium?.objectId ?? null"


def cid(p, n): return p.ev(IDOF, n)
def server_ids():
    d = json.loads(http('/__doc?key=' + KEY))
    return {n.get('name'): ((n.get('extras') or {}).get('atrium') or {}).get('objectId') for n in d['nodes']}
def new_after(p, before):
    return [n for n in p.ev(NAMES) if n not in before]
def ok(i): return bool(i and UUID.match(i))


def dup(p, name):
    before = set(p.ev(NAMES)); select(p, name); p.page.click('#ep-duplicate')
    p.wait("(b) => atriumClient.som.allNodes.some(n => !b.includes(n.name))", arg=list(before), timeout=15000)
    p.page.wait_for_timeout(600); return new_after(p, before)[0]


def del_undo(p, name):
    select(p, name); p.page.click('#ep-delete'); p.wait("(n) => !atriumClient.som.getNodeByName(n)", arg=name, timeout=10000)
    p.page.wait_for_timeout(400); p.page.click('#ep-undo'); p.wait("(n) => !!atriumClient.som.getNodeByName(n)", arg=name, timeout=10000)
    p.page.wait_for_timeout(600)


def check2(p, label, src):
    i0 = cid(p, src); d = dup(p, src); di = cid(p, d)
    print(f'C2 {label} Duplicate {src!r}->{d!r}: orig {i0} copy {di} valid {ok(di)} different {di != i0} server {server_ids().get(d) == di}')
    del_undo(p, d); back = cid(p, d)
    print(f'C2 {label} Delete+Undo {d!r}: id {back} same {back == di} server {server_ids().get(d) == back}')
    # Undo of the duplicate's add, then Redo: the re-added copy keeps its id
    p.page.click('#ep-undo'); p.wait("(n) => !atriumClient.som.getNodeByName(n)", arg=d, timeout=10000); p.page.wait_for_timeout(400)
    p.page.click('#ep-redo'); p.wait("(n) => !!atriumClient.som.getNodeByName(n)", arg=d, timeout=10000); p.page.wait_for_timeout(600)
    r = cid(p, d)
    print(f'C2 {label} Undo add + Redo {d!r}: id {r} same {r == di} server {server_ids().get(d) == r}')


with sync_playwright() as pw:
    br = new_browser(pw)
    ctl(catalog='small')
    a = Page(br); a.connect(W); a.ev(LOG); a.edit_on()
    b = Page(br); b.connect(W); b.ev(LOG)
    added = {}
    # ---- check 1: the four add paths
    before = set(a.ev(NAMES)); a.page.click('#ep-palette button[data-kind="cube"]'); a.page.wait_for_timeout(1200)
    added['palette'] = new_after(a, before)[0]
    added['model'] = add_model(a, FOX, scale=0.01)
    a.ev("__ep().selectForEdit(null)")
    before = set(a.ev(NAMES)); a.page.click('#ep-teleporter'); a.page.wait_for_timeout(400)
    a.page.fill('#tp-dest-input', '/worlds/x/y'); a.page.click('#tp-save-btn'); a.page.wait_for_timeout(1500)
    added['teleporter'] = new_after(a, before)[0]
    a.ev("__ep().selectForEdit(null)")
    before = set(a.ev(NAMES)); a.page.click('#ep-library'); a.page.wait_for_timeout(500)
    a.ev("() => document.querySelectorAll('.lg-tile')[0].click()")
    a.wait("(b) => atriumClient.som.allNodes.some(n => !b.includes(n.name))", arg=list(before), timeout=15000); a.page.wait_for_timeout(1500)
    added['library'] = new_after(a, before)[0]
    a.page.keyboard.press('Escape')
    s = server_ids(); ids = {}
    for k, n in added.items():
        ids[k] = cid(a, n)
        print(f'C1 {k:10s} {n!r}: client {ids[k]} valid {ok(ids[k])} other tab {cid(b, n) == ids[k]} server {s.get(n) == ids[k]}')
    print('C1 all distinct', len(set(ids.values())) == 4, '| scene nodes with ids (fixture):', {n: i for n, i in s.items() if i and n not in added.values()})
    # ---- check 2: Duplicate / Undo / Redo, then after a reload
    check2(a, 'before reload', added['palette'])
    check2(a, 'before reload', added['model'])
    a.page.reload(); a.page.wait_for_function('window.atriumClient && window.stage && window.__lib', timeout=30000)
    a.connect(W); a.ev(LOG); a.edit_on(); a.wait("(n) => __mb.status(n)?.status === 'loaded'", arg=added['model'], timeout=60000)
    print('C2 after reload ids unchanged', {k: cid(a, n) == ids[k] for k, n in added.items()})
    check2(a, 'after reload', added['palette'])
    check2(a, 'after reload', added['library'])
    # ---- check 3: the set-once leaf on the floor (no extras.atrium)
    print('C3 floor extras before', a.ev("atriumClient.som.getNodeByName('ground-plane').extras ?? null"))
    a.ev("() => { window.__log.length = 0 }")
    fid = a.ev("() => crypto.randomUUID()")
    seq = a.ev("(i) => atriumClient.setObjectId('ground-plane', i)", fid); a.page.wait_for_timeout(1000)
    print('C3 first send seq', seq, 'events', [e for e in a.ev('__log') if e[0].startswith('edit')])
    print('C3 sender SOM', cid(a, 'ground-plane') == fid, '| other tab', cid(b, 'ground-plane') == fid, '| server', server_ids().get('ground-plane') == fid,
          '| sender extras', a.ev("atriumClient.som.getNodeByName('ground-plane').extras"))
    a.ev("() => { window.__log.length = 0 }")
    a.ev("() => atriumClient.setObjectId('ground-plane', crypto.randomUUID())"); a.page.wait_for_timeout(1000)
    print('C3 second send', [e for e in a.ev('__log') if e[0].startswith('edit')], 'id unchanged', cid(a, 'ground-plane') == fid)
    a.ev("() => { window.__log.length = 0 }")
    a.ev("(i) => atriumClient.setObjectId('crate-01', i)", ids['palette']); a.page.wait_for_timeout(1000)
    print('C3 duplicate value on crate-01', [e for e in a.ev('__log') if e[0].startswith('edit')])
    # ---- check 7: restart from the saved document
    snap = server_ids()
    http('/__restart?key=' + KEY); a.page.wait_for_timeout(1500)
    a.connect(W); a.edit_on()
    after = {n: cid(a, n) for n in snap}
    print('C7 after restart: client ids equal the saved ones', all(after[n] == i for n, i in snap.items() if i),
          '| count', sum(1 for i in snap.values() if i), '| server', server_ids() == snap)
    print('errors', a.errors, b.errors)
    br.close()
