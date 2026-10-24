import sys, time, json
import os; sys.path.insert(0, os.environ.get('HARNESS_ROOT', '/tmp/atrium-harness') + '/harness')
from h import *
with sync_playwright() as pw:
    br = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctl(catalog='small')
    cat = json.loads(http('/apps/client/library/catalog.json'))
    http('/__reset')
    p = Page(br)
    p.connect('wss://127.0.0.1:8443/w/c5')
    p.edit_on(); time.sleep(1)
    print('baseline textures', p.tex(), 'bg', p.bg())
    def pick(val, expect_url):
        p.page.select_option('#ep-sky', val)
        if expect_url:
            p.wait("(u) => __sky.loaded && __sky.loaded.url.endsWith(u) && stage.scene.background === __sky.loaded.texture", arg=expect_url, timeout=60000)
        else:
            p.wait("() => stage.scene.background === null && stage.scene.environment === null", timeout=10000)
        p.wait("() => !document.getElementById('ep-sky').disabled", timeout=10000)
        time.sleep(1.0)
        return p.tex()
    for s in cat['skies']:
        t = pick(s['id'], s['url'])
        print('sky', s['id'], 'bg', p.bg(), 'textures', t, 'som', p.ev("atriumClient.som.extras.atrium.background"))
        p.page.screenshot(path=SHOTS + f"/r2-c5-sky-{s['id']}.png")
    seq = []
    ids = [s['id'] for s in cat['skies']]
    for i in range(10):
        s = cat['skies'][i % 3]
        seq.append((s['id'], pick(s['id'], s['url'])))
    print('10 switches textures', seq)
    t = pick('', None)
    print('None -> bg', p.bg(), 'textures', t, 'som', p.ev("atriumClient.som.extras.atrium.background"), 'select', p.ev("document.getElementById('ep-sky').value"))
    print('sky requests', {k: v for k, v in counts().items() if 'skies' in k})
    print('errors', p.errors, [c for c in p.console if c.startswith('error') and '401' not in c])
    p.close(); br.close()
