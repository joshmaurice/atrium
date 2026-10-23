import sys, time, json
import os; sys.path.insert(0, os.environ.get('HARNESS_ROOT', '/tmp/atrium-harness') + '/harness')
from h import *
SHOW = "0"  # round 2: no forced visibility
with sync_playwright() as pw:
    br = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctl(catalog='heavy')
    cat = json.loads(http('/apps/client/library/catalog.json'))
    p = Page(br)
    p.connect('wss://127.0.0.1:8443/w/c4')
    p.edit_on()
    p.page.click('#ep-library'); time.sleep(0.3); p.ev(SHOW)
    print('tiles', p.ev("document.querySelectorAll('.lg-tile').length"))
    results = []
    for i, m in enumerate(cat['models']):
        before = set(p.ev("atriumClient.som.nodes.map(n=>n.name)"))
        p.ev("(nm) => [...document.querySelectorAll('.lg-tile')].find(t => t.querySelector('img').alt === nm).click()", m['name'])
        p.wait("() => __lib().libraryGrid.waiting === null", timeout=15000)
        new = [n for n in p.ev("atriumClient.som.nodes.map(n=>n.name)") if n not in before][0]
        p.wait("(n) => ['loaded','failed'].includes(__mb.status(n)?.status)", arg=new, timeout=120000)
        st = p.ev("(n) => __mb.status(n)", new)
        info = p.ev("(n) => { const r = __mb.instances.get(n); return { ph: !!r.placeholder, inst: !!r.instance, colour: r.placeholder?.box?.material?.color?.getHexString?.(), taken: __mb.textureBudget.taken ?? null } }", new)
        results.append((i + 1, new, st, info))
        print(i + 1, new, st, info, flush=True)
        if st['status'] == 'failed':
            # also show what the Edit panel says for the selected node
            time.sleep(0.5)
            print('panel model status', p.ev("document.getElementById('ep-model-status').textContent"))
            break
    print('textures in renderer', p.tex())
    p.page.click('#edit-toggle-btn'); time.sleep(0.5)
    p.page.screenshot(path=SHOTS + '/r2-c4-budget.png')
    print('errors', p.errors)
    p.close(); br.close()
    ctl(catalog='small')
