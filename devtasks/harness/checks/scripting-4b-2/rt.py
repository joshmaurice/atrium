# scripting-4b-2 §5.1 — the RUNTIME checks, driven without the Behaviour form (which throws in a
# real page at 957140bd). Behaviours are written with the product's own templateGraph and
# client.sendField / client.setObjectId; clicks are real mouse clicks on the canvas.
import sys, os, time, json
_here = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.join(_here, '..', '..')); sys.path.insert(0, os.path.join(_here, '..', 'scripting-4a'))
from anim import *

T = str(int(time.time()))
W = 'wss://127.0.0.1:8443/w/rt' + T
LEAF = 'extras.atrium.behavior'

TPL = """async ({ id, params, own }) => { const m = await import('@atrium/behaviors/templates'); return m.templateGraph(id, params, { ownId: own }) }"""
OID = """(n) => atriumClient.som.getNodeByName(n)?.extras?.atrium?.objectId ?? null"""
SEND = """({ name, field, value }) => new Promise((res) => { const c = atriumClient; const seq = c.sendField(name, field, value);
  const done = (k) => (d) => { if (d.seq === seq) { c.off?.('edit:accepted', ok); c.off?.('edit:rejected', bad); res({ k, code: d.code ?? null, message: d.message ?? null }) } };
  const ok = done('accepted'), bad = done('rejected'); c.on('edit:accepted', ok); c.on('edit:rejected', bad); setTimeout(() => res({ k: 'timeout' }), 5000) })"""
SETID = """(name) => new Promise((res) => { const c = atriumClient; const id = crypto.randomUUID(); const seq = c.setObjectId(name, id);
  const f = (d) => { if (d.seq === seq) res(id) }; c.on('edit:accepted', f); c.on('edit:rejected', () => res(null)); setTimeout(() => res(null), 5000) })"""
MOVE = """({ name, t }) => { atriumClient.som.getNodeByName(name).translation = t }"""
VIS = """(n) => { const s = atriumClient.som.getNodeByName(n); const o = stage.scene.getObjectByName(n);
  return { som: s ? s.visible : null, obj: o ? o.visible : null } }"""
ANIMV = """(n) => { const a = atriumClient.som.getNodeByName(n)?.extras?.atrium?.animation; return a ? { clip: a.clip, playing: a.playing, startedAt: a.startedAt } : a }"""
RUN = """() => { const r = __beh().runner; return { enabled: r.enabled, engines: [...r.engines].map(([k, v]) => [k, v?.reason ?? 'ok']), log: r.log.slice(-6).map(l => l.node + ': ' + l.message) } }"""
PICK = """(name) => { const o = stage.scene.getObjectByName(name); if (!o) return null; o.updateWorldMatrix(true, true);
  const p = new o.position.constructor(); o.getWorldPosition(p); const v = p.clone().project(stage.camera);
  const el = stage.renderer?.domElement ?? document.querySelector('canvas'); const r = el.getBoundingClientRect();
  return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height, on: Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && v.z < 1 } }"""


def edit_off(p):
    if p.ev("getComputedStyle(document.getElementById('edit-panel')).display !== 'none'"):
        p.page.click('#edit-toggle-btn'); p.page.wait_for_timeout(300)


def add_cube(p):
    before = set(p.ev("atriumClient.som.nodes.map(n => n.name)"))
    p.page.click('button[data-kind=cube]'); p.page.wait_for_timeout(700)
    new = [n for n in p.ev("atriumClient.som.nodes.map(n => n.name)") if n not in before]
    return new[0] if new else None


def click_node(p, name, dx=0, button='left', drag=0):
    at = p.ev(PICK, name)
    if not at or not at['on']:
        return {'clicked': False, 'at': at}
    if drag:
        p.page.mouse.move(at['x'], at['y']); p.page.mouse.down(button=button)
        p.page.mouse.move(at['x'] + drag, at['y'], steps=5); p.page.mouse.move(at['x'], at['y'], steps=5)  # starts and ends on the node
        p.page.mouse.up(button=button)
    else:
        p.page.mouse.click(at['x'] + dx, at['y'], button=button)
    p.page.wait_for_timeout(600)
    return {'clicked': True}


def behave(p, name, tid, params):
    own = p.ev(OID, name) or p.ev(SETID, name)
    for k in ('target',):
        if params.get(k) and not params[k].count('-') == 4:   # a node name -> its id
            params[k] = p.ev(OID, params[k]) or p.ev(SETID, params[k])
    value = p.ev(TPL, {'id': tid, 'params': params, 'own': own})
    r = p.ev(SEND, {'name': name, 'field': LEAF, 'value': value})
    p.page.wait_for_timeout(500)
    return r


with sync_playwright() as pw:
    br = new_browser(pw)
    a = Page(br); a.connect(W); a.edit_on()
    v = Page(br); v.connect(W + '?visitor')
    print('HOST', a.ev('atriumClient.scriptHost'), '| visitor', v.ev('atriumClient.scriptHost'), v.ev('atriumClient.canEdit'))

    # ---- 1: the engine loads through the import map (the runner imports it); interval-animation on a Fox.
    fox = add_model(a, FOX, scale=0.01); a.page.wait_for_timeout(2500)
    a.ev(MOVE, {'name': fox, 't': [3, 0, -6]})
    print('C1 engine module', a.ev("async () => { const m = await import('@khronosgroup/gltf-interactivity-engine'); return Object.keys(m).includes('BasicBehaveEngine') }"))
    print('C1 write interval-animation', behave(a, fox, 'interval-animation', {'target': fox, 'clip': 'Survey', 'loop': False, 'seconds': 2}))
    seen = []
    for i in range(7):
        seen.append(v.ev(ANIMV, fox)); v.page.wait_for_timeout(1000)
    starts = sorted({s['startedAt'] for s in seen if s})
    print('C1 visitor sees the leaf', seen[-1], '| distinct startedAt over 7 s:', len(starts), [b - a_ for a_, b in zip(starts, starts[1:])])
    print('C1 runner', a.ev(RUN))

    # ---- 2a: select-visibility toggle, the host tab with Edit off.
    x = add_cube(a); a.ev(MOVE, {'name': x, 't': [-1.5, 0.5, -5]})
    y = add_cube(a); a.ev(MOVE, {'name': y, 't': [1.5, 0.5, -5]})
    print('C2a write', x, '->', y, behave(a, x, 'select-visibility', {'target': y, 'action': 'toggle'}))
    edit_off(a)
    print('C2a before', a.ev(VIS, y), 'visitor', v.ev(VIS, y))
    print('C2a click', click_node(a, x)); print('C2a after 1 click', a.ev(VIS, y), 'visitor', v.ev(VIS, y))
    print('C2a 10px look-drag on X', click_node(a, x, drag=10), a.ev(VIS, y))
    print('C2a right-click on X', click_node(a, x, button='right'), a.ev(VIS, y))
    print('C2a click again', click_node(a, x), a.ev(VIS, y), 'visitor', v.ev(VIS, y))
    print('C2a runner', a.ev(RUN))

    # ---- 2b: select-animation (play) on X2 targeting the Fox; and a clip that doesn't exist (S7).
    a.edit_on(); x2 = add_cube(a); a.ev(MOVE, {'name': x2, 't': [0, 0.5, -5]})
    print('C2b write', behave(a, x2, 'select-animation', {'target': fox, 'clip': 'Run', 'action': 'play', 'loop': True}))
    edit_off(a); click_node(a, x2); print('C2b fox leaf in visitor', v.ev(ANIMV, fox))
    a.edit_on(); x3 = add_cube(a); a.ev(MOVE, {'name': x3, 't': [0, 2.0, -5]})
    print('C2b write a missing clip', behave(a, x3, 'select-animation', {'target': fox, 'clip': 'NoSuchClip', 'action': 'play', 'loop': True}))
    edit_off(a); click_node(a, x3); print('C2b missing clip -> visitor leaf (S7: refused + logged expected once loaded)', v.ev(ANIMV, fox), a.ev(RUN)['log'][-2:])

    # ---- 2c: proximity — X4 at spawn (both avatars inside), then moved away (both leave).
    a.edit_on(); x4 = add_cube(a)
    print('C2c write', behave(a, x4, 'proximity-animation', {'target': fox, 'clip': 'Walk', 'loop': True, 'radius': 3}))
    a.ev(MOVE, {'name': x4, 't': [0, 0, 0]}); a.page.wait_for_timeout(1200); print('C2c at spawn (enter)', v.ev(ANIMV, fox))
    a.ev(MOVE, {'name': x4, 't': [0, 0, -40]}); a.page.wait_for_timeout(1200); print('C2c moved away (exit)', v.ev(ANIMV, fox))

    # ---- 3: Edit mode on — a click selects and triggers nothing; a hidden object is selectable; Visible un-hides.
    a.edit_on(); before = a.ev(VIS, y)
    if before['som']:
        edit_off(a); click_node(a, x); a.edit_on()
    hidden = a.ev(VIS, y); click_node(a, x); print('C3 Edit on: click X selects', a.ev('__ep().selected?.name ?? null'), '| Y unchanged', a.ev(VIS, y) == hidden, hidden)
    click_node(a, y); print('C3 hidden Y selectable', a.ev('__ep().selected?.name ?? null'), '| #ep-visible checked', a.ev("document.getElementById('ep-visible')?.checked"))
    if a.ev('__ep().selected?.name ?? null') == y:
        a.page.click('#ep-visible'); a.page.wait_for_timeout(600); print('C3 after Visible', a.ev(VIS, y), 'visitor', v.ev(VIS, y))

    # ---- 7: limits, from the console.
    bad = a.ev(TPL, {'id': 'select-visibility', 'params': {'target': a.ev(OID, y), 'action': 'toggle'}, 'own': a.ev(OID, x)})
    w = json.loads(json.dumps(bad)); w['graph']['declarations'].append({'op': 'flow/while'})
    print('C7 flow/while', a.ev(SEND, {'name': x, 'field': LEAF, 'value': w}))
    n = json.loads(json.dumps(bad)); s = json.dumps(n).replace('[n]', '{n}'); print('C7 {n} pointer', a.ev(SEND, {'name': x, 'field': LEAF, 'value': json.loads(s)}))
    be = json.loads(json.dumps(bad)); nodes = be['graph']['nodes']; nodes[-1].setdefault('flows', {})['out'] = {'node': 1, 'socket': 'in'}
    print('C7 back edge', a.ev(SEND, {'name': x, 'field': LEAF, 'value': be}))
    print('errors A', a.errors[:5], '| V', v.errors[:5])
    br.close()
