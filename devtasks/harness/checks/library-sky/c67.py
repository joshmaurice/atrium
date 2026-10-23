import sys, time, json
import os; sys.path.insert(0, os.environ.get('HARNESS_ROOT', '/tmp/atrium-harness') + '/harness')
from h import *
WL = "() => { window.__wl = []; atriumClient.on('world:loaded', (e) => __wl.push(e.source ?? 'main')) }"
def skyreq():
    return {k: v for k, v in counts().items() if 'skies' in k}
with sync_playwright() as pw:
    br = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctl(catalog='small')
    cat = json.loads(http('/apps/client/library/catalog.json'))
    blue = cat['skies'][0]
    a = Page(br); a.ev(WL)
    a.page.fill('#worldUrl', 'https://127.0.0.1:8443/tests/fixtures/space-ext.gltf')
    a.connect('wss://127.0.0.1:8443/w/ext67')
    a.edit_on()
    a.page.select_option('#ep-sky', blue['id'])
    a.wait("() => __sky.loaded && stage.scene.background === __sky.loaded.texture", timeout=60000)
    a.wait("() => !document.getElementById('ep-sky').disabled")
    print('A worldBaseUrl', a.ev('atriumClient.worldBaseUrl'), 'A world:loaded', a.ev('__wl'))
    http('/__reset')
    b = Page(br); b.ev(WL)
    b.page.fill('#worldUrl', 'https://127.0.0.1:8443/tests/fixtures/space-ext.gltf')
    b.connect('wss://127.0.0.1:8443/w/ext67')
    b.wait("() => __sky.loaded && stage.scene.background === __sky.loaded.texture", timeout=60000)
    time.sleep(3)
    print('B world:loaded events on join', b.ev('__wl'), 'B sky requests on join', skyreq(), 'bg', b.bg())
    # --- check 7: repeated world:loaded on the same SOM, slots cleared first
    http('/__reset')
    uuid0 = b.bg()['uuid']
    som0 = b.ev("() => { window.__som0 = atriumClient.som; return true }")
    b.ev("() => { stage.scene.background = null; stage.scene.environment = null; __wl.length = 0 }")
    b.ev("() => atriumClient.resolveExternalReferences()")
    time.sleep(3)
    print('C7 after resolveExternalReferences: world:loaded', b.ev('__wl'), 'same SOM', b.ev('atriumClient.som === __som0'), 'bg', b.bg(), 'same texture', b.bg() and b.bg()['uuid'] == uuid0, 'sky requests', skyreq())
    # --- check 6: rename (World Info write of atrium.name) from B, then from A
    http('/__reset')
    ua, ub = a.bg()['uuid'], b.bg()['uuid']
    b.ev("() => { const e = JSON.parse(JSON.stringify(atriumClient.som.extras)); e.atrium.name = 'Renamed by B'; atriumClient.som.extras = e }")
    time.sleep(2)
    a.ev("() => { const e = JSON.parse(JSON.stringify(atriumClient.som.extras)); e.atrium.name = 'Renamed by A'; atriumClient.som.extras = e }")
    time.sleep(2)
    print('C6 names', a.ev("atriumClient.som.extras.atrium.name"), b.ev("atriumClient.som.extras.atrium.name"))
    print('C6 bg unchanged A', a.bg()['uuid'] == ua, 'B', b.bg()['uuid'] == ub, 'sky requests after renames', skyreq())
    print('errors', a.errors, b.errors)
    a.close(); b.close(); br.close()
