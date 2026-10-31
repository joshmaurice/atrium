# scripting-4d-1 §6.1 checks 5 (the frame limit, stressed) and 6 (a stale owner tab, G-L9).
# Check 5 writes its 64 leaves with client.sendField (the panel is check 1's subject); check 6 serves the BASE page
# (STALE_ROOT, `x-harness-tree: stale`) to one of alice's tabs, as a tab loaded before the deploy.
from common4d import *
N_LIGHT, N_HEAVY, LOOP = 56, 8, int(os.environ.get('LOOP', '1200'))
TYPES.append({'signature': 'float4x4'}); T['float4x4'] = 7

# a light onTick graph: rotation ← rotation × 2.86° about Y (the visible "still runs")
LIGHT = graph([
    {'op': 'event/onTick', 'flows': {'out': flow(4)}},
    getter('/nodes/0/rotation', 'float4'),
    {'op': 'math/quatFromAxisAngle', 'values': {'axis': lit('float3', [0, 1, 0]), 'angle': lit('float', 0.05)}},
    {'op': 'math/quatMul', 'values': {'a': sock(1), 'b': sock(2)}},
    setter('/nodes/0/rotation', 'float4', sock(3)),
])
# a heavy onTick graph: a for-loop of LOOP matrix products and determinants into a variable, plus an interpolation at start
HEAVY = graph([
    {'op': 'event/onTick', 'flows': {'out': flow(1)}},
    {'op': 'flow/for', 'configuration': {'initialIndex': {'value': [0]}}, 'values': {'startIndex': lit('int', 0), 'endIndex': lit('int', LOOP)}, 'flows': {'loopBody': flow(5)}},
    getter('/nodes/0/matrix', 'float4x4'),
    {'op': 'math/matMul', 'values': {'a': sock(2), 'b': sock(2)}},
    {'op': 'math/determinant', 'values': {'a': sock(3)}},
    {'op': 'variable/set', 'configuration': {'variables': {'value': [0]}}, 'values': {'0': sock(4)}},
    {'op': 'event/onStart', 'flows': {'out': flow(7)}},
    {'op': 'pointer/interpolate', 'configuration': {'pointer': {'value': ['/nodes/0/scale']}, 'type': {'value': [T['float3']]}},
     'values': {'value': lit('float3', [1.3, 1.3, 1.3]), 'duration': lit('float', 1.5), 'p1': lit('float2', [0, 0]), 'p2': lit('float2', [1, 1])}},
], variables=[{'type': T['float'], 'value': [0.0]}])

SAMPLE = """(ms) => new Promise(r => { const r0 = __beh().runner; const dts = [], skips = []; let last = performance.now(); const t0 = last;
  const f = () => { const t = performance.now(); dts.push(t - last); last = t; skips.push(r0.skippedThisFrame.size);
    if (t - t0 < ms) requestAnimationFrame(f); else r({ dts, skips }) }; requestAnimationFrame(f) })"""


def add_cube(p):
    before = set(p.ev('atriumClient.som.nodes.map(n => n.name)'))
    p.page.click('button[data-kind=cube]'); p.page.wait_for_timeout(350)
    new = [n for n in p.ev('atriumClient.som.nodes.map(n => n.name)') if n not in before]
    return new[0] if new else None


def send_leaf(t, name, g):
    own = t.ev(OID, name) or t.ev(SETID, name)
    value = {'kind': 'graph', 'origin': 'local', 'enabled': True, 'graph': g, 'nodeMap': [own], 'targets': [], 'animations': []}
    return t.ev(SEND, {'name': name, 'field': LEAF, 'value': value})


def pct(xs, p):
    xs = sorted(xs); return xs[min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1))))]


def stale_tab(ctx):
    sp = ctx.new_page(); sp.set_extra_http_headers({'x-harness-tree': 'stale'})
    s = Tab.__new__(Tab); s.name = 'S'; s.ctx = ctx; s.page = sp; s.errors = []; s.console = []
    sp.on('pageerror', lambda e: s.errors.append(str(e))); s.ws = wslog(sp)
    sp.goto(A + PAGE); sp.wait_for_function('window.atriumClient && window.stage', timeout=30000); time.sleep(1)
    s.wait_world(); time.sleep(0.8); return s


with sync_playwright() as pw:
    br = new_browser(pw)
    print('register', register(br))
    octx = br.new_context(ignore_https_errors=True, viewport={'width': 1280, 'height': 800})
    vctx = br.new_context(ignore_https_errors=True, viewport={'width': 1280, 'height': 800})
    a = owner_tab(octx, 'A', first=True)
    W = new_world(a, 'c5'); print('A connected', a.connect(W))
    v = Tab(vctx, 'V'); print('V connected', v.connect(W)); a.page.wait_for_timeout(800)

    print(f'\n== 5. the frame limit, stressed: {N_LIGHT} light + {N_HEAVY} heavy onTick graphs (loop {LOOP})')
    a.edit_on(); names = []
    t0 = time.time()
    for i in range(N_LIGHT + N_HEAVY):
        c = add_cube(a); names.append(c)
        a.ev(MOVE, {'name': c, 't': [-6 + (i % 13), 0.5, -3 - (i // 13) * 1.5]})
    print(f'   {len(names)} cubes in {time.time() - t0:.0f} s')
    res = []
    for i, c in enumerate(names):
        res.append(send_leaf(a, c, HEAVY if i < N_HEAVY else LIGHT))
    kinds = {}
    for r in res: kinds[(r['k'], r.get('code'))] = kinds.get((r['k'], r.get('code')), 0) + 1
    print('   leaf writes:', kinds)
    check('5 all 64 leaves accepted (the 64-per-world cap holds exactly)', kinds.get(('accepted', None)) == 64, kinds)
    edit_off(a); a.page.wait_for_timeout(2500)
    live = a.ev("() => [...__beh().runner.engines.values()].filter(r => r.engine).length")
    print('   live engines', live, '| heavy:', [(n, engine(a, n)) for n in names[:N_HEAVY]][:3], '| log', rlog(a, 5))
    heavy, light = names[:N_HEAVY], names[N_HEAVY:]
    print('   node starts per tick, heavy[0] / light[0]:', a.ev("(n) => __beh().runner.engines.get(n)?.engine?.steps ?? null", heavy[0]), a.ev("(n) => __beh().runner.engines.get(n)?.engine?.steps ?? null", light[0]))
    sample = a.ev(SAMPLE, 10000)
    dts, skips = sample['dts'][1:], sample['skips'][1:]
    p50, p95, mx = pct(dts, 50), pct(dts, 95), max(dts)
    print(f'   host frames: {len(dts)} in 10 s | frame time p50 {p50:.1f} ms, p95 {p95:.1f} ms, max {mx:.1f} ms | skips per frame: mean {sum(skips) / len(skips):.1f}, max {max(skips)}, frames with a skip {sum(1 for s in skips if s)}/{len(skips)}')
    thr = [n for n in names if any(l.startswith('Throttled') for l in lines(a, n))]
    thr_h, thr_l = [n for n in thr if n in heavy], [n for n in thr if n in light]
    print(f'   "Throttled" on {len(thr)} behaviours: {len(thr_h)} heavy, {len(thr_l)} light')
    eng = {n: engine(a, n) for n in names}
    dead = [n for n, e in eng.items() if not e or not e['live']]
    print('   disabled/dead:', dead[:6], '| log tail', rlog(a, 6))
    check('5 nothing is disabled', not dead and a.ev("() => [...__beh().runner.engines.values()].filter(r => r.engine).length") == 64, (dead[:5], live))
    yaw = lambda q: math.degrees(2 * math.atan2(q[1], q[3]))
    L = light[-1]; s0, o0 = rot(a, L), obj_rot(a, L); vs0 = rot(v, L); a.page.wait_for_timeout(4000); s1, o1 = rot(a, L), obj_rot(a, L); vs1 = rot(v, L)
    turned = (yaw(s1) - yaw(s0)) % 360; oturned = (yaw(o1) - yaw(o0)) % 360; vturned = (yaw(vs1) - yaw(vs0)) % 360
    print(f'   a light graph ({L}) in 4 s: host SOM turned {turned:.1f}°, host object {oturned:.1f}°, visitor SOM {vturned:.1f}° | host SOM {s1} obj {o1}')
    check('5 the host object follows the host SOM for a light graph', abs(((oturned - turned + 180) % 360) - 180) < 6, (turned, oturned))
    rej = [m for (d, m) in a.ws if d == '<' and isinstance(m, dict) and m.get('type') in ('error', 'edit:rejected')]
    print('   socket errors/rejections to A:', len(rej), [(m.get('type'), m.get('code'), (m.get('message') or '')[:60]) for m in rej[-3:]])
    print('   light SOM rotations (3 cubes):', [[round(c, 2) for c in rot(a, n)] for n in light[-3:]])
    check('5 a light graph still runs', turned > 5, turned)
    check('5 "Throttled" appears (on the heavy graphs)', len(thr_h) > 0, (thr_h, thr_l))
    check('5 the frame limit bites: some engines skip in most frames', sum(1 for s in skips if s) > len(skips) * 0.5 and max(skips) >= 1, (sum(1 for s in skips if s), len(skips)))
    bad = [l for l in a.ev('__beh().runner.log') if 'refused' in l['message'] or 'INVALID' in l['message']]
    check('5 no refused values', not bad, [l['message'] for l in bad][:3])
    vs = v.ev("(n) => [...atriumClient.som.getNodeByName(n).scale]", heavy[0]); print('   visitor sees heavy[0] scale', vs)
    print(f'   RECORD: p95 frame time {p95:.1f} ms (p50 {p50:.1f}, max {mx:.1f}) over {len(dts)} frames; skips mean {sum(skips) / len(skips):.1f}/frame; Throttled on {len(thr_h)}/{N_HEAVY} heavy and {len(thr_l)}/{N_LIGHT} light')
    # quiet the world for check 6
    a.edit_on()
    for c in names: a.ev(SEND, {'name': c, 'field': LEAF, 'value': None})
    edit_off(a); a.page.wait_for_timeout(1500)

    print('\n== 6. a stale owner tab (the 4c page, scriptRunner 2) is never the host; a 4d tab takes over')
    a.edit_on(); x = add_cube(a); y = add_cube(a); a.ev(MOVE, {'name': x, 't': [-1, 0.5, -2]}); a.ev(MOVE, {'name': y, 't': [-2.5, 0.5, -2]})
    print('   write X->Y select-visibility (a 4c template)', behave(a, x, 'select-visibility', {'target': y, 'action': 'toggle'})); edit_off(a)
    s = stale_tab(octx)
    base_page = s.page.evaluate("async () => (await (await fetch('/packages/protocol/src/schemas/hello.client.json')).text())")
    print('   S page hello schema mentions scriptRunner const:', [l.strip() for l in base_page.splitlines() if 'const' in l][:3])
    s.connect(W); s.page.wait_for_timeout(1000)
    sh = (of(s.ws, 'hello', '>') or [{}])[-1]
    print('   S hello caps', sh.get('capabilities'), '| canEdit', s.ev('atriumClient.canEdit'), '| scriptHost', s.ev('atriumClient.scriptHost'), '| A host', a.ev(HOST))
    check('6 the stale tab is a signed-in owner tab with scriptRunner 2', s.ev('atriumClient.canEdit') is True and (sh.get('capabilities') or {}).get('scriptRunner') == 2, sh.get('capabilities'))
    check('6 while A (4d) is the host, the stale tab is not', a.ev(HOST)['active'] is True and not (s.ev('atriumClient.scriptHost') or {}).get('active'))
    a.close(); s.page.wait_for_timeout(2500)
    print('   after A closed: S scriptHost', s.ev('atriumClient.scriptHost'))
    check('6 A closes: the stale tab is still not elected (scriptRunner 2 is never elected)', not (s.ev('atriumClient.scriptHost') or {}).get('active'), s.ev('atriumClient.scriptHost'))
    b = v.ev(VIS, y)['obj']; click_node(v, x); nt = v.ev(NOTICE); v.page.wait_for_timeout(500)
    print('   visitor click with only the stale tab: notice', repr(nt), '| Y visible', v.ev(VIS, y))
    check('6 a visitor click runs nothing (no host)', v.ev(VIS, y)['obj'] is b, (nt, v.ev(VIS, y)))
    a2 = owner_tab(octx, 'A2'); a2.connect(W); a2.wait("() => __beh().runner.engines.size > 0", timeout=20000); a2.page.wait_for_timeout(800)
    print('   A2 host', a2.ev(HOST), '| S scriptHost', s.ev('atriumClient.scriptHost'))
    check('6 a 4d tab opens: it takes over as host; the stale tab still is not', a2.ev(HOST)['active'] is True and not (s.ev('atriumClient.scriptHost') or {}).get('active'), (a2.ev(HOST), s.ev('atriumClient.scriptHost')))
    b = v.ev(VIS, y)['obj']; click_node(v, x); v.page.wait_for_timeout(900)
    check("6 and the visitor's click works again", v.ev(VIS, y)['obj'] is (not b), (b, v.ev(VIS, y)))
    print('\npage errors: S', s.errors[:3], '| A2', a2.errors[:3], '| V', v.errors[:3])
    br.close()
print('\nFAILS:', fails or 'none'); sys.exit(1 if fails else 0)
