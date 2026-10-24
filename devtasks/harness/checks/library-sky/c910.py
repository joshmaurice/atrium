import sys, time, json
import os; sys.path.insert(0, os.environ.get('HARNESS_ROOT', '/tmp/atrium-harness') + '/harness')
from h import *
HOOK = "() => { window.__ans = []; for (const t of ['edit:accepted','edit:rejected','edit:unknown']) atriumClient.on(t, (e) => __ans.push([t, e.seq, e.code, e.message])) }"
RAW = "(tex) => { const e = JSON.parse(JSON.stringify(atriumClient.som.extras)); e.atrium.background = { ...(e.atrium.background ?? {}), type: 'equirectangular', texture: tex }; atriumClient.som.extras = e; return atriumClient.lastSendSeq }"
STATE = "() => ({ som: atriumClient.som.extras.atrium.background, select: document.getElementById('ep-sky').value, selectDisabled: document.getElementById('ep-sky').disabled, status: document.getElementById('ep-sky-status').textContent, statusShown: getComputedStyle(document.getElementById('ep-sky-status')).display !== 'none', retry: getComputedStyle(document.getElementById('ep-sky-retry')).display !== 'none', loaded: __sky.loaded?.url ?? null, failedUrl: __sky.failedUrl, bg: stage.scene.background ? stage.scene.background.image?.width + 'x' + stage.scene.background.image?.height : null })"
with sync_playwright() as pw:
    br = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctl(catalog='small')
    cat = json.loads(http('/apps/client/library/catalog.json'))
    blue = cat['skies'][0]
    a = Page(br); a.connect('wss://127.0.0.1:8443/w/c910'); a.edit_on(); a.ev(HOOK)
    b = Page(br); b.connect('wss://127.0.0.1:8443/w/c910'); b.edit_on(); b.ev(HOOK)
    v = Page(br); v.connect('wss://127.0.0.1:8443/w/c910?visitor=1')
    a.page.select_option('#ep-sky', blue['id'])
    a.wait("() => __sky.loaded && !document.getElementById('ep-sky').disabled", timeout=60000)
    b.wait("() => __sky.loaded", timeout=60000)
    print('start A', a.ev(STATE)); print('start B', b.ev(STATE))
    # ---- check 9: http sky by raw send
    seq = a.ev(RAW, 'http://127.0.0.1:8443/skies/ok.png')
    time.sleep(2)
    print('C9 http: seq', seq, 'A answers', a.ev('__ans'))
    print('C9 http: A', a.ev(STATE)); print('C9 http: B', b.ev(STATE))
    # same through the picker path: inject a picker write whose URL the server refuses (picker.change with a doctored catalog entry)
    a.ev("() => { const c = __lib().libraryCatalog; c.skies[1] = { ...c.skies[1], url: 'http://127.0.0.1:8443/skies/ok.png' } }") if False else None
    # ---- '' accepted
    a.ev("() => { __ans.length = 0 }")
    seq = a.ev(RAW, '')
    time.sleep(2)
    print("C9 '': seq", seq, 'A answers', a.ev('__ans'))
    print("C9 '': A", a.ev(STATE)); print("C9 '': B", b.ev(STATE))
    # ---- check 10: oversize PNG at a root path
    a.ev("() => { __ans.length = 0 }")
    b.console.clear(); v.console.clear()
    seq = a.ev(RAW, '/skies/big.png')
    time.sleep(4)
    print('C10: A answers', a.ev('__ans'))
    print('C10: A', a.ev(STATE)); print('C10: B', b.ev(STATE))
    print('C10: B console', [c for c in b.console if '[sky]' in c])
    print('C10: visitor console', [c for c in v.console if '[sky]' in c], 'visitor bg', v.bg())
    b.page.screenshot(path=SHOTS + '/r2-c10-oversize-B.png')
    # A reloads the world (reconnect) and sees the refusal on world:loaded
    a.page.click('#connectBtn'); a.wait('!atriumClient.connected'); time.sleep(0.5)
    a.console.clear()
    a.connect('wss://127.0.0.1:8443/w/c910'); a.edit_on(); time.sleep(4)
    print('C10: A after reconnect', a.ev(STATE))
    print('C10: A console', [c for c in a.console if '[sky]' in c])
    print('errors', a.errors, b.errors)
    a.close(); b.close(); br.close()
