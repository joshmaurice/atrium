import sys, time, json
import os; sys.path.insert(0, os.environ.get('HARNESS_ROOT', '/tmp/atrium-harness') + '/harness')
from h import *
with sync_playwright() as pw:
    br = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctl(catalog='small')
    cat = json.loads(http('/apps/client/library/catalog.json'))
    # owner client sets Blue sky in a fresh world
    a = Page(br); a.connect('wss://127.0.0.1:8443/w/c14'); a.edit_on()
    a.page.select_option('#ep-sky', cat['skies'][0]['id'])
    a.wait("() => __sky.loaded && !document.getElementById('ep-sky').disabled", timeout=60000)
    http('/__reset')
    ctx = br.new_context(ignore_https_errors=True, viewport={'width': 1280, 'height': 800})
    ip = ctx.new_page(); errs = []; cons = []; bad = []
    ip.on('pageerror', lambda e: errs.append(str(e))); ip.on('console', lambda m: cons.append(f'{m.type}: {m.text}'))
    ip.on('response', lambda r: bad.append(f'{r.status} {r.url}') if r.status >= 400 else None)
    ip.on('requestfailed', lambda r: bad.append(f'{r.url} {r.failure}'))
    ip.goto(A + '/tools/som-inspector/local.html')
    ip.wait_for_function('window.atriumClient', timeout=30000)
    ip.fill('#wsUrl', 'wss://127.0.0.1:8443/w/c14'); ip.click('#connectBtn')
    ip.wait_for_function('atriumClient.connected && atriumClient.som', timeout=30000)
    time.sleep(5)
    print('inspector sky requests', {k: v for k, v in counts().items() if 'skies' in k})
    ip.screenshot(path=SHOTS + '/r2-c14-inspector-sky.png')
    # sample the viewport's top area colour from the screenshot
    from PIL import Image
    im = Image.open(SHOTS + '/r2-c14-inspector-sky.png').convert('RGB')
    vp = ip.evaluate("() => { const r = document.getElementById('viewport').getBoundingClientRect(); return [r.x, r.y, r.width, r.height] }")
    x, y = int(vp[0] + vp[2] / 2), int(vp[1] + 20)
    print('viewport', vp, 'pixel near top of viewport', im.getpixel((x, y)))
    # rename via the Inspector's World Info Name field
    http('/__reset')
    ip.evaluate("() => { const i = [...document.querySelectorAll('#world-info input[type=text]')][0]; i.value = 'Renamed in Inspector'; i.dispatchEvent(new Event('change')) }")
    time.sleep(3)
    print('after Inspector rename: A name', a.ev("atriumClient.som.extras.atrium.name"), 'sky requests', {k: v for k, v in counts().items() if 'skies' in k}, 'A bg', a.bg() is not None)
    print('inspector errors', errs, 'bad', [b for b in bad if '401' not in b], [c for c in cons if c.startswith('error')])
    ctx.close(); a.close(); br.close()
