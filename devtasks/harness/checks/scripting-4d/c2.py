# scripting-4d-1 §6.1 checks 2 and 3 — onTick rotation (host vs visitor), pointer/interpolate with the host closing at 1.9 s.
# ROT_SECONDS=120 for the full two minutes (the short pass uses 30).
from common4d import *
ROT_SECONDS = int(os.environ.get('ROT_SECONDS', '30'))

# check 2: every frame, rotation ← quatMul(rotation, quatFromAxisAngle([0,1,0], 0.05 rad))
G2 = graph([
    {'op': 'event/onTick', 'flows': {'out': flow(4)}},
    getter('/nodes/0/rotation', 'float4'),
    {'op': 'math/quatFromAxisAngle', 'values': {'axis': lit('float3', [0, 1, 0]), 'angle': lit('float', 0.05)}},
    {'op': 'math/quatMul', 'values': {'a': sock(1), 'b': sock(2)}},
    setter('/nodes/0/rotation', 'float4', sock(3)),
])
# check 3: on select, interpolate translation to TARGET over 2 s, linear
TARGET = [2.0, 0.5, -2.0]
G3 = graph([
    on_select(0) | {'flows': {'out': flow(1)}},
    {'op': 'pointer/interpolate', 'configuration': {'pointer': {'value': ['/nodes/0/translation']}, 'type': {'value': [T['float3']]}},
     'values': {'value': lit('float3', TARGET), 'duration': lit('float', 2.0), 'p1': lit('float2', [0, 0]), 'p2': lit('float2', [1, 1])}},
])
FRAMES = "() => new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(n) }; requestAnimationFrame(f) })"


def rot_sets(t, name, since=0):
    return [m for (d, m) in t.ws[since:] if d == '<' and isinstance(m, dict) and m.get('type') == 'set' and m.get('node') == name and m.get('field') == 'rotation']


with sync_playwright() as pw:
    br = new_browser(pw)
    print('register', register(br))
    octx = br.new_context(ignore_https_errors=True, viewport={'width': 1280, 'height': 800})
    vctx = br.new_context(ignore_https_errors=True, viewport={'width': 1280, 'height': 800})
    a = owner_tab(octx, 'A', first=True)
    W = new_world(a, 'c2'); slug = W.rsplit('/', 1)[1]; print('A connected', a.connect(W))
    v = Tab(vctx, 'V'); print('V connected', v.connect(W)); a.page.wait_for_timeout(800)

    print(f'\n== 2. onTick rotation ({ROT_SECONDS} s)')
    a.edit_on(); x = add_cube(a); a.ev(MOVE, {'name': x, 't': [-1.5, 0.5, -3]}); a.page.wait_for_timeout(300)
    r = import_graph(a, x, gltf_doc(G2, ['Spinner']), 'spin.gltf', {'Spinner (node)': x})
    print('   mapped:', json.dumps({k: r['mapped'][k] for k in ('report', 'grants', 'notes', 'status')}))
    check('2 the import shows the sampled-motion note (per frame)', r['mapped']['notes'].startswith('Visitors see this motion in steps'), r['mapped']['notes'])
    dlg, en = set_enabled(a, x, True); print('   confirmation:', dlg)
    check('2 Enable asks (writes, per frame) and the leaf is enabled', dlg is not None and 'Enable it?' in dlg and en is True, (dlg, en))
    edit_off(a); a.page.wait_for_timeout(1000)
    # the host: angle advanced over 2 s vs frames rendered in the same 2 s (0.05 rad = 2.8648° a frame)
    q0 = obj_rot(a, x); frames = a.ev(FRAMES); q1 = obj_rot(a, x)
    yaw = lambda q: math.degrees(2 * math.atan2(q[1], q[3]))
    turned = (yaw(q1) - yaw(q0)) % 360
    print(f'   host: {frames} frames in 2 s, object turned {turned:.1f}° (quaternion angle, mod 360); expected ≈ {frames * 2.8648:.1f}° mod 360 = {(frames * 2.8648) % 360:.1f}°')
    check('2 the host turns every frame, independent of the echo (angle ≈ frames × 2.86°)', abs(((turned - frames * 2.8648 + 180) % 360) - 180) < 3 * 2.8648, (turned, frames))
    n0 = len(v.ws); v.page.wait_for_timeout(10000); sets = rot_sets(v, x, n0)
    print(f'   visitor: {len(sets)} rotation som:set in 10 s ({len(sets) / 10:.1f}/s)')
    check('2 the visitor steps at most 20 times a second', 8 <= len(sets) <= 205, len(sets))
    v_steps = [m['value'][1] for m in sets[:5]] if sets else []; print('   first visitor steps (y):', [round(s, 3) for s in v_steps])
    t_end = time.time() + ROT_SECONDS - 12
    while time.time() < t_end: a.page.wait_for_timeout(2000)
    errs = [m for (d, m) in a.ws if d == '<' and isinstance(m, dict) and m.get('type') in ('error', 'edit:rejected')]
    log = a.ev('__beh().runner.log'); bad = [l for l in log if 'refused' in l['message'] or 'INVALID' in l['message'] or 'disabled' in l['message']]
    print('   A errors/rejections:', [(m.get('type'), m.get('code')) for m in errs][:5], '| bad log lines:', [l['message'] for l in bad][:5])
    check(f'2 {ROT_SECONDS} s: no INVALID_VALUE and no refused value, engine live', not errs and not bad and engine(a, x)['live'] is True, (len(errs), len(bad), engine(a, x)))
    qa, qv = rot(a, x), rot(v, x); print('   SOM rotation host', [round(c, 3) for c in qa], 'visitor', [round(c, 3) for c in qv])
    check('2 the rotation stays a unit quaternion (host SOM)', abs(sum(c * c for c in qa) - 1) < 1e-6, qa)
    # park the spinner so check 3 is quiet
    set_enabled(a, x, False); edit_off(a)

    print('\n== 3. pointer/interpolate over 2 s; then the host closes at 1.9 s')
    a.edit_on(); y = add_cube(a); a.ev(MOVE, {'name': y, 't': [-2, 0.5, -3]}); a.page.wait_for_timeout(300)
    r3 = import_graph(a, y, gltf_doc(G3, ['Slider']), 'slide.gltf', {'Slider (node)': y})
    check('3 the import shows the sampled-motion note (interpolates)', r3['mapped']['notes'].startswith('Visitors see this motion in steps'), r3['mapped']['notes'])
    dlg, en = set_enabled(a, y, True)
    check('3 an on-select interpolation enables without a prompt', dlg is None and en is True, (dlg, en))
    edit_off(a); v.page.wait_for_timeout(800)
    n0 = len(v.ws); click_node(v, y); v.page.wait_for_timeout(3000)
    tsets = [m for (d, m) in v.ws[n0:] if d == '<' and isinstance(m, dict) and m.get('type') == 'set' and m.get('node') == y and m.get('field') == 'translation']
    print(f'   visitor saw {len(tsets)} translation steps; last', tsets[-1]['value'] if tsets else None, '| host SOM', tr(a, y))
    check("3 steady host: the visitor's last value equals the target", tsets and all(abs(p - q) < 1e-6 for p, q in zip(tsets[-1]['value'], TARGET)) and tr(v, y) == TARGET, (tsets[-1]['value'] if tsets else None, tr(v, y)))
    check('3 the engine stays live after the interpolation', engine(a, y)['live'] is True, engine(a, y))
    print('   A runner log', rlog(a, 4))
    # again, with a second owner tab open, closing the host at ~1.9 s
    a.edit_on(); a.ev(MOVE, {'name': y, 't': [-2, 0.5, -3]}); edit_off(a); a.page.wait_for_timeout(600)
    a2 = owner_tab(octx, 'A2'); print('   A2 connected', a2.connect(W)); a2.page.wait_for_timeout(600)
    check('3 A2 is not the host while A is', a2.ev(HOST)['active'] is False and a.ev(HOST)['active'] is True)
    n0 = len(v.ws); t0 = time.time(); click_node(v, y)
    while time.time() - t0 < 1.9: v.page.wait_for_timeout(50)
    a.close(); t_close = time.time() - t0; print(f'   host tab closed at {t_close:.2f} s')
    v.page.wait_for_timeout(2500); a2.page.wait_for_timeout(500)
    tsets = [m for (d, m) in v.ws[n0:] if d == '<' and isinstance(m, dict) and m.get('type') == 'set' and m.get('node') == y and m.get('field') == 'translation']
    last = tsets[-1]['value'] if tsets else None
    a2.page.wait_for_timeout(3500)      # the autosave debounce
    saved = doc_leaf(a2, slug, y)
    last = last or [None]*3
    print(f'   visitor: {len(tsets)} steps, last {last} | A2 SOM {tr(a2, y)} | saved document {saved.get("tr")} | A2 host {a2.ev(HOST)}')
    check('3 the interpolation stopped short of the target (the host closed mid-way)', last[0] is not None and last != TARGET and last[0] > -2, last)
    check('3 the visitor and the saved document show the same last sent value', saved.get('tr') is not None and all(abs(p - q) < 1e-6 for p, q in zip(saved['tr'], last)), (saved.get('tr'), last))
    check('3 the new host (A2) took over and starts from that value', a2.ev(HOST)['active'] is True and all(abs(p - q) < 1e-6 for p, q in zip(tr(a2, y), last)) and engine(a2, y) and engine(a2, y)['live'] is True, (a2.ev(HOST), tr(a2, y), engine(a2, y)))
    check('3 nothing more was sent after the close (the visitor SOM equals the last step)', tr(v, y) == last, (tr(v, y), last))
    print('   A2 log', rlog(a2, 5))
    print('\npage errors: A2', a2.errors[:3], '| V', v.errors[:3])
    br.close()
print('\nFAILS:', fails or 'none'); sys.exit(1 if fails else 0)
