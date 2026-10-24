import sys, time, json
import os; sys.path.insert(0, os.environ.get('HARNESS_ROOT', '/tmp/atrium-harness') + '/harness')
from h import *
STATE = "() => ({ som: atriumClient.som?.extras?.atrium?.background?.texture, status: document.getElementById('ep-sky-status').textContent, retry: getComputedStyle(document.getElementById('ep-sky-retry')).display !== 'none', loaded: __sky.loaded?.url ?? null, failed: __sky.failed, bg: stage.scene.background ? stage.scene.background.image?.width + 'x' + stage.scene.background.image?.height : null })"
def skylog(p): return [c for c in p.console if '[sky]' in c]
def load_file(p, url):
    p.page.fill('#worldUrl', url); p.page.click('#loadBtn')
    p.wait("() => atriumClient.som && document.getElementById('loadBtn').disabled === false", timeout=30000)
    time.sleep(4)
with sync_playwright() as pw:
    br = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctl(catalog='small'); http('/__reset')
    p = Page(br)
    load_file(p, '/tests/fixtures/atrium.gltf')
    print('8a static atrium.gltf', p.ev(STATE), {k: v for k, v in counts().items() if 'skybox' in k}, 'log', skylog(p))
    p.page.screenshot(path=SHOTS + '/r2-c8-atrium-static.png')
    p.console.clear()
    load_file(p, '/tests/fixtures/atrium-rel.gltf')
    print('8b static doc-relative', p.ev(STATE), 'log', skylog(p))
    p.close()
    p = Page(br); p.connect('wss://127.0.0.1:8443/w/atr8b'); p.edit_on(); time.sleep(4)
    print('8c server atrium.gltf', p.ev(STATE), 'log', skylog(p))
    p.close()
    o = Page(br); o.connect('wss://127.0.0.1:8443/w/rel8b'); o.edit_on(); time.sleep(3)
    v = Page(br); v.connect('wss://127.0.0.1:8443/w/rel8b?visitor=1'); time.sleep(3)
    print('8d owner doc-relative', o.ev(STATE), 'log', skylog(o))
    print('8d visitor: edit toggle shown', v.ev("getComputedStyle(document.getElementById('edit-toggle-btn')).display"), 'bg', v.ev(STATE)['bg'], 'log', skylog(v))
    o.page.screenshot(path=SHOTS + '/r2-c8-docrelative-owner.png')
    # rename by the owner: the visitor and owner logs
    o.console.clear(); v.console.clear()
    o.ev("() => { const e = JSON.parse(JSON.stringify(atriumClient.som.extras)); e.atrium.name = 'Renamed'; atriumClient.som.extras = e }"); time.sleep(2)
    print('8e after rename: owner', o.ev(STATE)['status'], 'retry', o.ev(STATE)['retry'], 'owner log', skylog(o), 'visitor log', skylog(v))
    print('errors', o.errors, v.errors)
    o.close(); v.close(); br.close()
