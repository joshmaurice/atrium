# scripting-4b-2 §5.1 — runtime checks, part 2: 2d light, 4 two owner tabs + handover, 5 a 4b-1-style tab,
# 8 restart from the saved document, 8b Duplicate remap, 9 first person. Without the Behaviour form.
import sys, time, json, urllib.request
import os
_here = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.join(_here, '..', '..')); sys.path.insert(0, os.path.join(_here, '..', 'scripting-4a'))
from anim import *
exec(open(__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)), 'rt.py')).read().split('with sync_playwright()')[0].split('from anim import *')[1])
from h import _ctx

T = str(int(time.time()))
LIGHT = """(n) => { const l = atriumClient.som.getNodeByName(n)?.light; return l ? +l.intensity.toFixed(3) : null }"""
STATUS = """() => document.getElementById('ep-behavior-status').textContent"""


def put(key, path, kind=None):
    data = open(path, 'rb').read()
    q = f'/__put?key={key}' + (f'&kind={kind}' if kind else '')
    req = urllib.request.Request(A + q, data=data, method='POST', headers={'content-type': 'model/gltf+json'})
    return urllib.request.urlopen(req, context=_ctx).read().decode()[:120]


def strip_runner(page):
    """A 4b-1-style tab: its hello carries no capabilities.scriptRunner."""
    def route(ws):
        server = ws.connect_to_server()
        def up(m):
            try:
                d = json.loads(m)
                if d.get('type') == 'hello' and isinstance(d.get('capabilities'), dict):
                    d['capabilities'].pop('scriptRunner', None); m = json.dumps(d)
            except Exception:
                pass
            server.send(m)
        ws.on_message(up); server.on_message(lambda m: ws.send(m))
    page.route_web_socket('**/w/**', route)


with sync_playwright() as pw:
    br = new_browser(pw)

    # ---- 2d: select-light in a world from space-lights.gltf.
    KL = 'lt' + T
    print('C2d put', put(KL, '/tmp/atrium-harness/wt/tests/fixtures/space-lights.gltf', 'file'))
    a = Page(br); a.connect(f'wss://127.0.0.1:8443/w/{KL}'); a.edit_on()
    print('C2d Sun', a.ev(LIGHT, 'Sun'), 'LampGlow', a.ev(LIGHT, 'LampGlow'))
    x = add_cube(a); a.ev(MOVE, {'name': x, 't': [0, 0.5, -5]})
    r = behave(a, x, 'select-light', {'target': 'Sun', 'intensity': a.ev(LIGHT, 'Sun') or 1})
    print('C2d write', r); edit_off(a)
    seq = [a.ev(LIGHT, 'Sun')]
    for i in range(2):
        click_node(a, x); a.page.wait_for_timeout(500); seq.append(a.ev(LIGHT, 'Sun'))
    print('C2d Sun intensity: before, click 1, click 2 =', seq, '| runner', a.ev(RUN))
    a.close()

    # ---- 4: two owner tabs; the non-host's text and clicks; the handover.
    W4 = 'wss://127.0.0.1:8443/w/two' + T
    a = Page(br); a.connect(W4); a.edit_on()
    x = add_cube(a); a.ev(MOVE, {'name': x, 't': [-1.5, 0.5, -5]})
    y = add_cube(a); a.ev(MOVE, {'name': y, 't': [1.5, 0.5, -5]})
    print('C4 write', behave(a, x, 'select-visibility', {'target': y, 'action': 'toggle'}))
    b = Page(br); b.connect(W4); b.edit_on()
    print('C4 roles A', a.ev('atriumClient.scriptHost'), 'B', b.ev('atriumClient.scriptHost'), '| B runner', b.ev(RUN))
    b.ev("(n) => { try { __ep().selectForEdit(atriumClient.som.getNodeByName(n)); return null } catch (e) { return String(e).slice(0, 80) } }", x); b.page.wait_for_timeout(400)
    print('C4 B status line with X selected:', repr(b.ev(STATUS)), '| B host line', repr(b.ev("document.getElementById('ep-host-status').textContent")))
    edit_off(b); before = b.ev(VIS, y); click_node(b, x); print('C4 B click on X (non-host): Y', before, '->', b.ev(VIS, y))
    t0 = time.time(); a.close()
    b.wait("() => atriumClient.scriptHost.active === true", timeout=10000)
    b.wait("() => __beh().runner.enabled && __beh().runner.engines.size > 0", timeout=10000)
    print(f'C4 handover in {time.time() - t0:.2f}s', b.ev('atriumClient.scriptHost'), b.ev(RUN))
    click_node(b, x); print('C4 B click after handover: Y', b.ev(VIS, y))
    b.close()

    # ---- 5: a 4b-1-style tab (no scriptRunner) first, then a 4b-2 tab.
    W5 = 'wss://127.0.0.1:8443/w/old' + T
    old = Page(br, ws_routes=strip_runner); old.connect(W5)
    print('C5 old tab alone', old.ev('atriumClient.scriptHost'), 'canEdit', old.ev('atriumClient.canEdit'))
    new = Page(br); new.connect(W5)
    print('C5 new tab', new.ev('atriumClient.scriptHost'), '| old still', old.ev('atriumClient.scriptHost'))
    old.close(); new.close()

    # ---- 8 and 8b: restart from the saved document; Duplicate a self-targeted animation behaviour.
    K8 = 'sv' + T; W8 = f'wss://127.0.0.1:8443/w/{K8}'
    a = Page(br); a.connect(W8); a.edit_on()
    fox = add_model(a, FOX, scale=0.01); a.ev(MOVE, {'name': fox, 't': [3, 0, -6]})
    x = add_cube(a); a.ev(MOVE, {'name': x, 't': [-1.5, 0.5, -5]})
    y = add_cube(a); a.ev(MOVE, {'name': y, 't': [1.5, 0.5, -5]})
    behave(a, x, 'select-visibility', {'target': y, 'action': 'toggle'})
    print('C8b write self-targeted', behave(a, fox, 'select-animation', {'target': fox, 'clip': 'Survey', 'action': 'play', 'loop': True}))
    edit_off(a); click_node(a, x); print('C8 Y hidden before restart', a.ev(VIS, y)); a.edit_on()
    a.ev("(n) => { try { __ep().selectForEdit(atriumClient.som.getNodeByName(n)); return null } catch (e) { return String(e).slice(0, 80) } }", fox); a.page.wait_for_timeout(300)
    n0 = len(a.errors); a.page.click('#ep-duplicate'); a.page.wait_for_timeout(2500)
    names = a.ev("atriumClient.som.nodes.filter(n => n.extras?.atrium?.model).map(n => n.name)")
    copy = [n for n in names if n != fox]
    if copy:
        c = copy[0]
        print('C8b copy', c, a.ev("""(n) => { const nd = atriumClient.som.getNodeByName(n); const b = nd.extras.atrium.behavior;
          return { own: nd.extras.atrium.objectId, nodeMap0: b?.nodeMap?.[0], animObject: b?.animations?.[0]?.object, paramTarget: b?.template?.params?.target } }""", c),
              '| errors during Duplicate', a.errors[n0:])
    else:
        print('C8b no copy appeared', names, a.errors[n0:])
    print('C8 restart', http(f'/__restart?key={K8}')[:80])
    a.page.wait_for_timeout(3000)
    a.wait("() => atriumClient.connected && atriumClient.som", timeout=30000); a.page.wait_for_timeout(1500)
    print('C8 after restart: Y', a.ev(VIS, y), '| host', a.ev('atriumClient.scriptHost'), '| runner', a.ev(RUN))
    if a.ev("getComputedStyle(document.getElementById('edit-panel')).display !== 'none'"):
        edit_off(a)
    click_node(a, x); print('C8 click X after restart: Y', a.ev(VIS, y))

    # ---- 9: first person hides the own capsule.
    def capsule():
        return a.ev("() => { const n = atriumClient._avatarNodeName; const o = n && stage.scene.getObjectByName(n); return o ? { obj: o.visible, som: atriumClient.som.getNodeByName(n)?.visible } : null }")
    print('C9 third person', capsule()); a.page.keyboard.press('KeyV'); a.page.wait_for_timeout(400)
    print('C9 first person', capsule()); a.page.keyboard.press('KeyV'); a.page.wait_for_timeout(400); print('C9 back', capsule())
    print('errors', a.errors[:6])
    br.close()
