import sys, time, json
import os; sys.path.insert(0, os.environ.get('HARNESS_ROOT', '/tmp/atrium-harness') + '/harness')
from h import *
mode = {'tp': 'pass', 'model': 'pass'}   # pass | reject | hold
held = []
def route(page):
    def handler(ws):
        server = ws.connect_to_server()
        def from_page(m):
            try: d = json.loads(m)
            except Exception: server.send(m); return
            if d.get('type') == 'add':
                atr = (d.get('node') or {}).get('extras', {}).get('atrium', {})
                kind = 'tp' if 'teleporter' in atr else 'model' if 'model' in atr else None
                if kind and mode[kind] == 'reject':
                    ws.send(json.dumps({'type': 'error', 'code': 'INVALID_VALUE', 'message': 'stubbed refusal (harness)', 'seq': d['seq']})); return
                if kind and mode[kind] == 'hold':
                    held.append(lambda m=m: server.send(m)); return
            server.send(m)
        ws.on_message(from_page)
        server.on_message(lambda m: ws.send(m))
    page.route_web_socket('**/w/ep3*', handler)
TP = "() => ({ open: __ep().teleporterForm.isOpen(), err: [getComputedStyle(document.getElementById('tp-form-error')).display, document.getElementById('tp-form-error').textContent], save: [document.getElementById('tp-save-btn').textContent, document.getElementById('tp-save-btn').disabled], sel: __ep().selected?.name ?? null, editErr: document.getElementById('ep-error').textContent })"
with sync_playwright() as pw:
    br = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    p = Page(br, ws_routes=route); p.connect('wss://127.0.0.1:8443/w/ep3fresh'); p.edit_on()
    # ---- check 3
    mode['tp'] = 'reject'
    p.page.click('#ep-teleporter'); p.page.wait_for_timeout(500); p.page.fill('#tp-dest-input', '/worlds/x/y'); p.page.click('#tp-save-btn'); p.page.wait_for_timeout(800)
    print('C3 after stubbed rejection', p.ev(TP))
    mode['tp'] = 'hold'
    p.page.click('#tp-save-btn'); p.page.wait_for_timeout(300)
    print('C3 retry while held (Saving)', p.ev(TP))
    for f in held: f()
    held.clear(); p.page.wait_for_timeout(1500)
    print('C3 accepted', p.ev(TP), 'pad exists', p.ev("!!atriumClient.som.getNodeByName('Teleporter')"))
    # ---- check 8, pad (a structural request pending blocks other adds, so the cube is added FIRST)
    mode['tp'] = 'pass'
    p.page.click('#ep-palette button[data-kind="cube"]'); p.page.wait_for_timeout(1200)
    mode['tp'] = 'hold'
    p.page.click('#ep-teleporter'); p.page.wait_for_timeout(500); p.page.fill('#tp-dest-input', '/worlds/x/z'); p.page.click('#tp-save-btn'); p.page.wait_for_timeout(300)
    print('C8 pad held', p.ev(TP))
    p.page.click('#edit-toggle-btn'); p.page.wait_for_timeout(300); p.edit_on(); p.page.wait_for_timeout(300)
    p.ev("__ep().selectForEdit(atriumClient.som.getNodeByName('Cube'))"); p.page.wait_for_timeout(300)
    print('C8 cube selected while pad held', p.ev(TP))
    for f in held: f()
    held.clear(); p.page.wait_for_timeout(1500)
    print('C8 pad accepted late', p.ev(TP), 'pad2 exists', p.ev("!!atriumClient.som.getNodeByName('Teleporter 2')"), 'undo title', p.ev("document.getElementById('ep-undo').title"))
    p.page.click('#ep-undo'); p.page.wait_for_timeout(1200)
    print('C8 after Undo', 'pad2 exists', p.ev("!!atriumClient.som.getNodeByName('Teleporter 2')"), 'cube exists', p.ev("!!atriumClient.som.getNodeByName('Cube')"))
    # ---- check 8, model
    mode['model'] = 'hold'
    p.ev("__ep().selectForEdit(null)")
    p.page.click('#ep-model'); p.page.fill('#model-url-input', '/assets/library/models/Tiny_Cube-a29f050367f9.glb'); p.page.click('#model-check-btn')
    p.wait("() => __ep().modelForm.state.result", timeout=30000)
    p.page.click('#model-save-btn'); p.page.wait_for_timeout(300)
    print('C8m model held', p.ev("({ saving: __ep().modelForm.state.saving, sel: __ep().selected?.name ?? null })"))
    p.page.click('#edit-toggle-btn'); p.page.wait_for_timeout(300); p.edit_on(); p.page.wait_for_timeout(300)
    p.ev("__ep().selectForEdit(atriumClient.som.getNodeByName('Cube'))"); p.page.wait_for_timeout(300)
    print('C8m cube selected while model held', p.ev(TP))
    for f in held: f()
    held.clear(); p.page.wait_for_timeout(2000)
    names = p.ev("atriumClient.som.nodes.map(n => n.name).filter(n => /Tiny|Model|Cube/.test(n))")
    print('C8m model accepted late', p.ev(TP), 'nodes', names, 'undo title', p.ev("document.getElementById('ep-undo').title"))
    p.page.click('#ep-undo'); p.page.wait_for_timeout(1200)
    print('C8m after Undo', p.ev("atriumClient.som.nodes.map(n => n.name).filter(n => /Tiny|Model|Cube/.test(n))"))
    print('errors', p.errors)
    p.close(); br.close()
