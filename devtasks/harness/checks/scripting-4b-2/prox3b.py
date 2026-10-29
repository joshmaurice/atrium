# Operator report (DEV acceptance step 3): a visitor (or a second owner) walking up to the model triggers the
# proximity animation, but it only PLAYS in the host tab until a reload. Check, in every tab, the stored leaf AND
# what that tab's animation layer is actually doing (state + clip time advancing).
exec(open(__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)), 'f1.py')).read().split('\nwith sync_playwright() as pw:')[0])
LAYER = """(n) => { const s = __anim().modelAnimations.status(n); const v = atriumClient.som.getNodeByName(n)?.extras?.atrium?.animation;
  return { leaf: v ? v.clip + (v.playing ? ' playing' : ' stopped') : null, state: s.state } }"""
CLIPT = """(n) => { const r = __mb.instances.get(n); const m = r?.mixer ?? r?.instance?.mixer; const acts = m?._actions ?? [];
  return acts.filter(a => a.isRunning?.()).map(a => +a.time.toFixed(2)) }"""
MOVE_ME = """(t) => { const me = atriumClient._avatarNodeName; const n = atriumClient.som.getNodeByName(me); n.translation = t; return me }"""


def snap(label, tabs, fox):
    t1 = {k: p.ev(ERR, fox) for k, p in tabs.items()}
    tabs['host'].page.wait_for_timeout(700)
    t2 = {k: p.ev(ERR, fox) for k, p in tabs.items()}
    out = {k: {'state': t2[k].get('state'), 't': (t1[k].get('t'), t2[k].get('t')), 'errMs': t2[k].get('errMs')} for k in tabs}
    print(label, out)


with sync_playwright() as pw:
    br = new_browser(pw)
    W = 'wss://127.0.0.1:8443/w/prox3' + T
    a = Page(br); a.connect(W); a.edit_on()
    fox = add_model(a, FOX, scale=0.01); a.page.wait_for_timeout(2500); a.ev(MOVE, {'name': fox, 't': [0, 0, -20]})
    px = add_cube(a); a.ev(MOVE, {'name': px, 't': [0, 0.5, -20]})
    print('P write', behave(a, px, 'proximity-animation', {'target': fox, 'clip': 'Walk', 'loop': True, 'radius': 3}))
    edit_off(a)
    v = Page(br); v.connect(W + '?visitor')
    b = Page(br); b.connect(W)
    tabs = {'host': a, 'visitor': v, 'owner2': b}
    for p in tabs.values():
        p.page.wait_for_timeout(1500)
    print('P roles', {k: p.ev('atriumClient.scriptHost') for k, p in tabs.items()})
    print('P mixer probe ok?', a.ev("(n) => { const r = __mb.instances.get(n); return r ? Object.keys(r).slice(0, 12) : null }", fox))
    snap('P before', tabs, fox)
    print('P visitor walks in', v.ev(MOVE_ME, [0, 0, -19])); v.page.wait_for_timeout(2500)
    snap('P visitor inside (1)', tabs, fox); v.page.wait_for_timeout(1500); snap('P visitor inside (2)', tabs, fox)
    print('P visitor walks out', v.ev(MOVE_ME, [0, 0, 10])); v.page.wait_for_timeout(2500)
    snap('P visitor outside', tabs, fox)
    print('P owner2 walks in', b.ev(MOVE_ME, [0, 0, -19])); b.page.wait_for_timeout(2500)
    snap('P owner2 inside', tabs, fox)
    v.page.reload(); v.page.wait_for_timeout(500); v.connect(W + '?visitor'); v.page.wait_for_timeout(2500)
    snap('P after visitor reload', tabs, fox)
    print('errors', a.errors[:3], v.errors[:3], b.errors[:3])
    br.close()
