import sys, time, json
import os; sys.path.insert(0, os.environ.get('HARNESS_ROOT', '/tmp/atrium-harness') + '/harness')
from h import *
STATE = "() => ({ som: atriumClient.som.extras.atrium.background?.texture?.split('/').pop(), select: document.getElementById('ep-sky').value, status: getComputedStyle(document.getElementById('ep-sky-status')).display !== 'none' ? document.getElementById('ep-sky-status').textContent : '', retry: getComputedStyle(document.getElementById('ep-sky-retry')).display !== 'none', loaded: __sky.loaded?.url?.split('/').pop() ?? null, failed: __sky.failed?.reason ?? null, bg: stage.scene.background ? stage.scene.background.image?.width + 'x' + stage.scene.background.image?.height : null })"
RAW = "(tex) => { const e = JSON.parse(JSON.stringify(atriumClient.som.extras)); e.atrium.background = { type: 'equirectangular', texture: tex }; atriumClient.som.extras = e }"
RENAME = "(n) => { const e = JSON.parse(JSON.stringify(atriumClient.som.extras)); e.atrium.name = n; atriumClient.som.extras = e }"
def skylog(p): return [c.split('[sky] ')[1] for c in p.console if '[sky]' in c]
def reqs(sub): return sum(v for k, v in counts().items() if sub in k)
with sync_playwright() as pw:
    br = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctl(catalog='small'); ctl(flaky='0'); ctl(missing='')
    cat = json.loads(http('/apps/client/library/catalog.json'))
    night = cat['skies'][2]
    a = Page(br); a.connect('wss://127.0.0.1:8443/w/r2c12'); a.edit_on()
    b = Page(br); b.connect('wss://127.0.0.1:8443/w/r2c12'); b.edit_on()
    http('/__reset')
    # 1. chooser picks a failing catalog sky (404)
    ctl(missing=night['url'])
    a.page.select_option('#ep-sky', night['id']); time.sleep(3)
    print('1 chooser after failing pick', a.ev(STATE), 'log', skylog(a), 'requests', reqs('Night'))
    a.page.screenshot(path=SHOTS + '/r2-c12-chooser-failed.png')
    print('1 other owner', b.ev(STATE))
    # 2. Retry while still 404
    a.console.clear()
    a.page.click('#ep-sky-retry'); time.sleep(3)
    print('2 after failed Retry', a.ev(STATE), 'log', skylog(a), 'requests', reqs('Night'))
    # 3. rename while failed (from B, arrives as som:set on A) — and on A itself
    a.console.clear()
    b.ev(RENAME, 'Rename 1'); time.sleep(2)
    b.ev(RENAME, 'Rename 2'); time.sleep(2)
    print('3 A after 2 renames', a.ev(STATE), 'log', skylog(a), 'requests', reqs('Night'))
    # 4. Retry once the file is served
    ctl(missing='')
    a.page.click('#ep-sky-retry')
    a.wait("() => __sky.loaded && stage.scene.background === __sky.loaded.texture", timeout=30000); time.sleep(0.5)
    print('4 after Retry with valid file', a.ev(STATE))
    # 5. a 404 that arrives through som:set, then Retry, then valid
    b.ev(RAW, '/skies/flaky.png'); time.sleep(3)
    print('5 A 404 via som:set', a.ev(STATE))
    ctl(flaky='1'); a.page.click('#ep-sky-retry')
    a.wait("() => __sky.loaded && stage.scene.background === __sky.loaded.texture", timeout=30000); time.sleep(0.5)
    print('5 after Retry', a.ev(STATE))
    ctl(flaky='0')
    # 6. a rule refusal (document-relative): reason, no Retry
    b.ev(RAW, 'skyboxtest1.png'); time.sleep(2)
    print('6 doc-relative', a.ev(STATE))
    print('errors', a.errors, b.errors)
    a.close(); b.close(); br.close()
