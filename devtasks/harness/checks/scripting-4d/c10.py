# scripting-4d-1 §6.1 check 10 — the world total, measured (Q7), on the REAL server with real sign-in
# (checks/signin-sync/authserver.mjs HOOKS=1, ATRIUM_AUTOSAVE_DEBOUNCE_MS=3000).
#
# Q7's thresholds (pre-brief §5, carried by the acceptance card):
#   with a world at the cap (multi-byte strings) and three visitors, a visitor's join → `world:loaded` adds at most 1.5 s
#   over the same world without behaviours; the server's serialize and heal of that world take at most 250 ms together;
#   a visitor tab's heap grows by at most 50 MB.
# Method (Rev 1.2): an A/B of the same world with and without ~1 MiB of leaves; three visitors joining at once; five runs
#   each, interleaved A, B, A, B, …; the median. Every run starts from an UNLOADED world (all tabs closed, past the
#   registry's 3 s teardown), so its first join loads the world from the database and logs `[world] healed <logId> in
#   <ms> ms`, and each join logs `[world] serialized <logId> in <ms> ms (<bytes> bytes)` (read through /__log).
#   Visitors are fresh anonymous contexts with NO pass-through socket route (that would add per-byte latency to the
#   join); the heap is CDP's (`HeapProfiler.collectGarbage`, then `Performance.getMetrics` `JSHeapUsedSize`) on the
#   same page before the connect and after `world:loaded`; the som-dump's bytes on the wire are CDP's
#   `Network.webSocketFrameReceived` on visitor 1.
# The leaves are custom graphs of `debug/log` nodes whose messages are 200 code points of 3-byte CJK, 2-byte Latin and
#   4-byte emoji; stored disabled (as the importer saves them) — Q7 is about bytes, not about running them.
# Finally: a `send` past the total is refused, and nothing changes.
#   HARNESS_ROOT=/tmp/atrium-harness RUNS=5 python3 c10.py
from common4d import *
import statistics, re

RUNS = int(os.environ.get('RUNS', '5'))
CUBES = 8
CAP = 1024 * 1024
TARGET = CAP - 1500                 # fill to just under the cap
LEAF_UNITS_MAX = 65536

# 200 code points: 120 × 3-byte, 70 × 2-byte, 10 × 4-byte (UTF-16: 210 units, UTF-8: 360 + 140 + 40 = 540 bytes)
MSG_BASE = ('漢字仮名交じり文' * 15) + ('éàüöçñ' * 12)[:70] + ('🌲🌊🔥🌙⭐' * 2)
assert len(MSG_BASE) == 200, len(MSG_BASE)


def u16(s): return len(s.encode('utf-16-le')) // 2
def jdump(v): return json.dumps(v, ensure_ascii=False, separators=(',', ':'))
def leaf_bytes(v): return len(jdump(v).encode('utf-8'))       # the server's behaviorLeafBytes (JSON.stringify's UTF-8)


def log_graph(n_nodes, tag):
    nodes = []
    for i in range(n_nodes):
        msg = (f'{tag}{i:03d}' + MSG_BASE)[:200]
        nodes.append({'op': 'debug/log', 'configuration': {'message': {'value': [msg]}}})
    return graph(nodes)


def leaf_value(own, g):
    return {'kind': 'graph', 'origin': 'local', 'enabled': False, 'graph': g, 'nodeMap': [own], 'targets': [], 'animations': []}


def plan_leaves(ids, target):
    """Leaves for `ids` (in order) whose UTF-8 total is as close to `target` as possible from below; each under 65,536 units."""
    out, total = [], 0
    for k, own in enumerate(ids):
        lo, hi, best = 1, 256, None
        while lo <= hi:                     # the largest node count that fits the leaf cap and the remaining budget
            mid = (lo + hi) // 2; v = leaf_value(own, log_graph(mid, f'L{k}'))
            if u16(jdump(v)) <= LEAF_UNITS_MAX - 64 and total + leaf_bytes(v) <= target: best = v; lo = mid + 1
            else: hi = mid - 1
        if best is None: break
        out.append(best); total += leaf_bytes(best)
        if target - total < 2000: break
    return out, total


def add_cube(p):
    before = set(p.ev('atriumClient.som.nodes.map(n => n.name)'))
    p.page.click('button[data-kind=cube]'); p.page.wait_for_timeout(350)
    new = [n for n in p.ev('atriumClient.som.nodes.map(n => n.name)') if n not in before]
    return new[0] if new else None


def build_world(a, tag, with_leaves):
    W = new_world(a, tag); slug = W.rsplit('/', 1)[1]
    print('  ', tag, 'connected', a.connect(W))
    a.edit_on(); names = []
    for i in range(CUBES):
        n = add_cube(a); names.append(n); a.ev(MOVE, {'name': n, 't': [-3.5 + i, 0.5, -3]})
    a.page.wait_for_timeout(400)
    ids = [a.ev(OID, n) or a.ev(SETID, n) for n in names]
    total, res = 0, []
    if with_leaves:
        leaves, total = plan_leaves(ids, TARGET)
        for n, v in zip(names, leaves):
            res.append(a.ev(SEND, {'name': n, 'field': LEAF, 'value': v}))
        print(f'   {tag}: {len(leaves)} leaves, {total} UTF-8 bytes (cap {CAP}, {CAP - total} under); node counts',
              [len(v['graph']['nodes']) for v in leaves], '| UTF-16 units', [u16(jdump(v)) for v in leaves])
        print('   writes:', [r['k'] for r in res], [r.get('message') for r in res if r['k'] != 'accepted'])
    edit_off(a)
    return {'W': W, 'slug': slug, 'names': names, 'ids': ids, 'total': total, 'writes': res}


def world_id(a, slug):
    return a.ev("async (slug) => (await (await fetch('/api/worlds')).json()).find(x => x.slug === slug).id", slug)


def saved_behaviour_bytes(a, wid):
    """The SAVED document's behaviour bytes, by the server's measure (JSON.stringify's UTF-8), in the page."""
    return a.ev("""async (id) => { const d = await (await fetch('/api/worlds/' + id)).json(); const doc = d.document ?? d;
      const enc = new TextEncoder(); let b = 0, n = 0;
      for (const x of doc.nodes ?? []) { const v = x.extras?.atrium?.behavior; if (v != null) { b += enc.encode(JSON.stringify(v)).length; n++ } }
      return { bytes: b, leaves: n } }""", wid)


def heap(cdp):
    cdp.send('HeapProfiler.collectGarbage'); cdp.send('HeapProfiler.collectGarbage')
    m = cdp.send('Performance.getMetrics')['metrics']
    return next(x['value'] for x in m if x['name'] == 'JSHeapUsedSize')


ARM = """(url) => { window.__q7 = { loaded: null, t0: null };
  atriumClient.on('world:loaded', () => { if (window.__q7.loaded === null) window.__q7.loaded = performance.now() });
  document.getElementById('wsUrl').value = url; return true }"""
GO = "() => { window.__q7.t0 = performance.now(); document.getElementById('connectBtn').click(); return window.__q7.t0 }"


def one_run(br, w, label, logid, log_lines_before):
    vs = []
    for i in range(3):
        ctx = br.new_context(ignore_https_errors=True, viewport={'width': 1280, 'height': 800})
        pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e, errs=errs: errs.append(str(e)))
        pg.goto(A + PAGE); pg.wait_for_function('window.atriumClient && window.stage', timeout=30000); pg.wait_for_timeout(1000)
        if pg.evaluate('atriumClient.connected'):          # an anonymous page may have auto-connected: leave first
            pg.click('#connectBtn'); pg.wait_for_function('!atriumClient.connected', timeout=8000); pg.wait_for_timeout(500)
        cdp = ctx.new_cdp_session(pg); cdp.send('Performance.enable')
        frames = []
        if i == 0:
            cdp.send('Network.enable')
            cdp.on('Network.webSocketFrameReceived', lambda e, frames=frames: frames.append(e['response']['payloadData']))
        pg.evaluate(ARM, w['W'])
        vs.append({'ctx': ctx, 'pg': pg, 'cdp': cdp, 'errs': errs, 'frames': frames, 'h0': heap(cdp)})
    for v in vs: v['t0'] = v['pg'].evaluate(GO)               # three visitors join at once
    for v in vs:
        ok = True
        try: v['pg'].wait_for_function('window.__q7.loaded !== null && atriumClient.som', timeout=60000)
        except Exception: ok = False
        v['ok'] = ok
        v['join'] = (v['pg'].evaluate('window.__q7.loaded') - v['t0']) / 1000 if ok else None
    for v in vs: v['pg'].wait_for_timeout(1500)
    for v in vs: v['h1'] = heap(v['cdp']); v['dheap'] = (v['h1'] - v['h0']) / 1e6
    dump = [f for f in vs[0]['frames'] if f.startswith('{"type":"som-dump"')]
    wire = len(dump[0].encode('utf-8')) if dump else None
    nodes = vs[0]['pg'].evaluate('atriumClient.som.nodes.length')
    errs = [e for v in vs for e in v['errs']]
    for v in vs: v['ctx'].close()
    lines = server_lines()[log_lines_before:]
    heal = [int(m.group(1)) for l in lines for m in [re.search(rf'\[world\] healed {logid} in (\d+) ms', l)] if m]
    ser = [(int(m.group(1)), int(m.group(2))) for l in lines for m in [re.search(rf'\[world\] serialized {logid} in (\d+) ms \((\d+) bytes\)', l)] if m]
    r = {'label': label, 'ok': all(v['ok'] for v in vs), 'joins': [v['join'] for v in vs], 'dheap': [round(v['dheap'], 1) for v in vs],
         'heal': heal, 'ser': ser, 'wire': wire, 'nodes': nodes, 'errs': errs[:3]}
    print(f"   {label}: joins {[round(j, 3) if j else j for j in r['joins']]} s | heap Δ {r['dheap']} MB | heal {heal} ms | serialize {ser} | som-dump on the wire {wire} B | nodes {nodes}", ('| errors ' + str(errs[:2])) if errs else '')
    return r


_owner = {}
def server_lines():
    return _owner['t'].ev("async () => (await fetch('/__log')).text()").splitlines()


with sync_playwright() as pw:
    br = new_browser(pw)
    print('register', register(br))
    octx = br.new_context(ignore_https_errors=True, viewport={'width': 1280, 'height': 800})
    a = owner_tab(octx, 'A', first=True); _owner['t'] = a

    print('\n== 10. build world A (≈1 MiB of multi-byte leaves) and world B (the same cubes, no leaves)')
    WA = build_world(a, 'q7a', True)
    WB = build_world(a, 'q7b', False)
    check('10 every leaf write accepted', WA['writes'] and all(r['k'] == 'accepted' for r in WA['writes']), [r for r in WA['writes'] if r['k'] != 'accepted'])
    # leave both worlds (back home), so they autosave, flush and tear down
    a.connect(HOME); a.page.wait_for_timeout(8000)
    idA, idB = world_id(a, WA['slug']), world_id(a, WB['slug'])
    sa, sb = saved_behaviour_bytes(a, idA), saved_behaviour_bytes(a, idB)
    print('   saved: A', sa, '| B', sb)
    check(f"10 world A's SAVED document holds the leaves: {sa['bytes']} bytes, {CAP - sa['bytes']} under 1 MiB, multi-byte", sa['leaves'] == len(WA['writes']) and CAP - 4000 < sa['bytes'] <= CAP, sa)
    check('10 world B has no behaviours', sb == {'bytes': 0, 'leaves': 0}, sb)
    logA, logB = idA[:8], idB[:8]

    print(f'\n== 10. {RUNS} runs each, interleaved; three visitors join at once from an unloaded world')
    runs = {'A': [], 'B': []}
    for k in range(RUNS):
        for label, w, lid in (('A', WA, logA), ('B', WB, logB)):
            time.sleep(6.0)                                  # past TEARDOWN_DELAY (3 s) since the last tab left
            n0 = len(server_lines())
            runs[label].append(one_run(br, w, f'{label}{k + 1}', lid, n0))

    def med(xs): xs = [x for x in xs if x is not None]; return statistics.median(xs) if xs else None
    slowA = [max(r['joins']) for r in runs['A'] if r['ok']]; slowB = [max(r['joins']) for r in runs['B'] if r['ok']]
    meanA = [statistics.mean(r['joins']) for r in runs['A'] if r['ok']]; meanB = [statistics.mean(r['joins']) for r in runs['B'] if r['ok']]
    srvA = [(r['heal'][0] if r['heal'] else None, max(s for s, _ in r['ser']) if r['ser'] else None) for r in runs['A']]
    srvA_sum = [h + s for h, s in srvA if h is not None and s is not None]
    srvB = [(r['heal'][0] if r['heal'] else None, max(s for s, _ in r['ser']) if r['ser'] else None) for r in runs['B']]
    heapA = [max(r['dheap']) for r in runs['A']]; heapB = [max(r['dheap']) for r in runs['B']]
    wireA = med([r['wire'] for r in runs['A']]); wireB = med([r['wire'] for r in runs['B']])
    serbytesA = med([b for r in runs['A'] for _, b in r['ser']]); serbytesB = med([b for r in runs['B'] for _, b in r['ser']])

    print('\n   RECORD (medians of', RUNS, 'runs):')
    print(f'     join → world:loaded, slowest of three: A {med(slowA):.3f} s, B {med(slowB):.3f} s, Δ {med(slowA) - med(slowB):+.3f} s'
          f' | mean of three: A {med(meanA):.3f} s, B {med(meanB):.3f} s, Δ {med(meanA) - med(meanB):+.3f} s')
    print(f'     server: A heal + serialize {med(srvA_sum)} ms (heal {med([h for h, _ in srvA])}, serialize max-of-three {med([s for _, s in srvA])}) | B heal {med([h for h, _ in srvB])}, serialize {med([s for _, s in srvB])} ms')
    print(f'     visitor heap Δ, largest of three: A {med(heapA):.1f} MB, B {med(heapB):.1f} MB, A − B {med(heapA) - med(heapB):+.1f} MB')
    print(f'     som-dump: on the wire A {wireA} B, B {wireB} B; serialized A {serbytesA} B, B {serbytesB} B')

    check('10 every run: all three visitors reached world:loaded, every run logged a heal (a real load) and three serializes',
          all(r['ok'] and len(r['heal']) == 1 and len(r['ser']) == 3 for r in runs['A'] + runs['B']),
          [(r['label'], r['ok'], len(r['heal']), len(r['ser'])) for r in runs['A'] + runs['B'] if not (r['ok'] and len(r['heal']) == 1 and len(r['ser']) == 3)])
    check(f'10 Q7 join: the slowest visitor adds ≤ 1.5 s over B (median Δ {med(slowA) - med(slowB):+.3f} s)', med(slowA) - med(slowB) <= 1.5)
    check(f'10 Q7 server: heal + serialize of world A ≤ 250 ms (median {med(srvA_sum)} ms)', med(srvA_sum) is not None and med(srvA_sum) <= 250, srvA)
    check(f'10 Q7 heap: a visitor tab grows by ≤ 50 MB joining world A (median of the largest of three {med(heapA):.1f} MB)', med(heapA) <= 50, heapA)
    check('10 the som-dump carries the leaves (A is ≥ 1 MiB larger than B on the wire)', wireA and wireB and wireA - wireB >= sa['bytes'] * 0.99, (wireA, wireB))

    print('\n== 10. a send past the total is refused, and nothing changes')
    a.connect(WA['W']); a.page.wait_for_timeout(1500); a.edit_on()
    extra = add_cube(a); a.page.wait_for_timeout(300)
    eid = a.ev(OID, extra) or a.ev(SETID, extra)
    over = leaf_value(eid, log_graph(8, 'X'))                 # ≈ 4.5 kB: past the ~1.5 kB left
    room = CAP - sa['bytes']
    print(f'   room left {room} B; the extra leaf is {leaf_bytes(over)} B')
    r = a.ev(SEND, {'name': extra, 'field': LEAF, 'value': over})
    print('   send:', r)
    check("10 the send past the total is refused with the world-total reason", r['k'] == 'rejected' and "exceed 1 MiB" in (r.get('message') or ''), r)
    check('10 ... and the extra cube has no leaf, host and saved', leaf(a, extra) is None, leaf(a, extra))
    small = leaf_value(eid, log_graph(1, 'Y'))
    if leaf_bytes(small) < room:
        r2 = a.ev(SEND, {'name': extra, 'field': LEAF, 'value': small})
        check(f'10 a leaf that fits the remaining {room} B is still accepted ({leaf_bytes(small)} B)', r2['k'] == 'accepted', r2)
    edit_off(a)
    print('\npage errors: A', a.errors[:3])
    br.close()
print('\nFAILS:', fails or 'none'); sys.exit(1 if fails else 0)
