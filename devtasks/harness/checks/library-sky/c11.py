import sys, time, json
import os; sys.path.insert(0, os.environ.get('HARNESS_ROOT', '/tmp/atrium-harness') + '/harness')
from h import *
HOOK = "() => { window.__ans = []; for (const t of ['edit:accepted','edit:rejected','edit:unknown']) atriumClient.on(t, (e) => __ans.push([t, e.seq, e.code, e.message])) }"
STATE = "() => ({ som: atriumClient.som.extras.atrium.background, desc: atriumClient.som.extras.atrium.description, select: document.getElementById('ep-sky').value, selectDisabled: document.getElementById('ep-sky').disabled, status: document.getElementById('ep-sky-status').textContent, loaded: __sky.loaded?.url?.split('/').pop() ?? null, bg: !!stage.scene.background && stage.scene.background === __sky.loaded?.texture })"
DESC = "(d) => { const e = JSON.parse(JSON.stringify(atriumClient.som.extras)); e.atrium.description = d; atriumClient.som.extras = e; return atriumClient.lastSendSeq }"
held = []        # (ws, reply) refusals held back by the route
fail = {'on': False}
def route(page):
    def handler(ws):
        server = ws.connect_to_server()
        def from_page(m):
            try:
                d = json.loads(m)
            except Exception:
                server.send(m); return
            if fail['on'] and d.get('type') == 'send' and d.get('node') == '__document__' and 'background' in json.dumps(d.get('value', {})) and d['value'].get('atrium', {}).get('background', {}).get('texture', '').find('Sunset') >= 0:
                held.append((ws, json.dumps({'type': 'error', 'code': 'PERMISSION_DENIED', 'message': 'stubbed refusal (harness)', 'seq': d['seq']})))
                return
            server.send(m)
        ws.on_message(from_page)
        server.on_message(lambda m: ws.send(m))
    page.route_web_socket('**/w/c11*', handler)
with sync_playwright() as pw:
    br = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctl(catalog='small')
    cat = json.loads(http('/apps/client/library/catalog.json'))
    blue, sunset = cat['skies'][0], cat['skies'][1]
    for order in ('desc-before-refusal', 'refusal-before-desc'):
        world = 'wss://127.0.0.1:8443/w/c11' + order.split('-')[0]
        a = Page(br, ws_routes=route); a.connect(world); a.edit_on(); a.ev(HOOK)
        b = Page(br); b.connect(world); b.edit_on(); b.ev(HOOK)
        a.page.select_option('#ep-sky', blue['id'])
        a.wait("() => __sky.loaded && !document.getElementById('ep-sky').disabled", timeout=60000)
        b.wait("() => __sky.loaded", timeout=60000)
        fail['on'] = True
        a.page.select_option('#ep-sky', sunset['id'])
        time.sleep(0.3)
        print(order, 'A while waiting', a.ev(STATE))
        if order == 'desc-before-refusal':
            b.ev(DESC, 'Description from B'); time.sleep(1.5)
            print(order, 'A after B desc arrived', a.ev(STATE))
            for ws, msg in held: ws.send(msg)
            held.clear(); time.sleep(3)
        else:
            for ws, msg in held: ws.send(msg)
            held.clear(); time.sleep(3)
            print(order, 'A after refusal', a.ev(STATE))
            b.ev(DESC, 'Description from B'); time.sleep(2)
        fail['on'] = False
        print(order, 'A answers', a.ev('__ans'), 'B answers', b.ev('__ans'))
        print(order, 'END A', a.ev(STATE)); print(order, 'END B', b.ev(STATE))
        if order == 'desc-before-refusal':
            a.page.screenshot(path=SHOTS + '/r2-c11-A-after-refusal.png')
        print('errors', a.errors, b.errors)
        a.close(); b.close()
    # ---- check 9 extra: a picker write the real server refuses (doctored catalog entry with an http URL)
    a = Page(br); a.connect('wss://127.0.0.1:8443/w/c9picker'); a.edit_on(); a.ev(HOOK)
    a.page.select_option('#ep-sky', blue['id'])
    a.wait("() => __sky.loaded && !document.getElementById('ep-sky').disabled", timeout=60000)
    frozen = a.ev("() => { const c = __lib().libraryCatalog; try { c.skies[2].url = 'http://127.0.0.1:8443/skies/ok.png'; } catch (e) { return 'threw ' + e.message } return Object.isFrozen(c.skies[2]) }")
    print('C9p doctor', frozen, a.ev("__lib().libraryCatalog.skies[2].url"))
    a.page.select_option('#ep-sky', cat['skies'][2]['id'])
    time.sleep(0.2)
    print('C9p immediately', a.ev(STATE))
    time.sleep(3)
    print('C9p answers', a.ev('__ans'))
    print('C9p END A', a.ev(STATE))
    print('errors', a.errors, [c for c in a.console if 'error' in c and '401' not in c])
    a.close(); br.close()
