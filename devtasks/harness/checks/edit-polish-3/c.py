import sys, time, json
import os; sys.path.insert(0, os.environ.get('HARNESS_ROOT', '/tmp/atrium-harness') + '/harness')
from h import *
RENAME = "(n) => { const e = JSON.parse(JSON.stringify(atriumClient.som.extras)); e.atrium.name = n; atriumClient.som.extras = e; return atriumClient.lastSendSeq }"
OPTS = "[...document.querySelectorAll('#tp-world-select option')].map(o => o.textContent)"
NOTE = "() => [getComputedStyle(document.getElementById('ep-spawn-note')).display, document.getElementById('ep-spawn-note').textContent.slice(0, 40)]"
with sync_playwright() as pw:
    br = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    W = lambda pg, ms: pg.page.wait_for_timeout(ms)
    # ---- check 4: delayed world list, close and reopen
    ctl(catalog='small', worldsDelay=1500)
    p = Page(br); p.connect('wss://127.0.0.1:8443/w/ep4'); p.edit_on()
    p.page.click('#ep-teleporter'); W(p, 200)
    print('C4 just opened', p.ev(OPTS))
    p.page.click('#tp-form-cancel'); W(p, 100); p.page.click('#ep-teleporter'); W(p, 3500)
    print('C4 after close+reopen and both answers', p.ev(OPTS))
    p.close(); ctl(worldsDelay=0)
    # ---- check 5: a refused sky value, then three World Info renames
    p = Page(br); p.connect('wss://127.0.0.1:8443/w/relep5'); W(p, 1500)
    sky1 = [c for c in p.console if '[sky]' in c]
    print('C5 after load', len(sky1), sky1[:1])
    for i in range(3): p.ev(RENAME, f'Rename {i}'); W(p, 800)
    sky2 = [c for c in p.console if '[sky]' in c]
    print('C5 after three renames', len(sky2))
    p.close()
    # ---- check 6: catalog sky stored as a root path, seen from a page on another origin
    cat = json.loads(http('/apps/client/library/catalog.json'))
    a = Page(br); a.connect('wss://127.0.0.1:8443/w/ep6'); a.edit_on()
    a.page.select_option('#ep-sky', cat['skies'][0]['id']); a.wait("() => __sky.loaded && !document.getElementById('ep-sky').disabled", timeout=60000)
    print('C6 stored texture', a.ev("atriumClient.som.extras.atrium.background.texture"))
    b = Page(br, origin=B); b.connect('wss://127.0.0.1:8443/w/ep6'); b.edit_on(); W(b, 2000)
    print('C6 page on B: select value', b.ev("document.getElementById('ep-sky').value"), 'expected', cat['skies'][0]['id'], 'custom shown', b.ev("[...document.querySelectorAll('#ep-sky option')].filter(o => o.value === '__custom__' && !o.hidden && o.style.display !== 'none').length"))
    seq0 = b.ev("atriumClient.lastSendSeq")
    b.ev("(id) => __lib().skyPicker.change(id)", cat['skies'][0]['id']); W(b, 800)
    print('C6 re-choose same sky on B: sent?', b.ev("atriumClient.lastSendSeq") != seq0, 'texture', a.ev("atriumClient.som.extras.atrium.background.texture"))
    a.close(); b.close()
    # ---- check 7: spawn note during a drag, and a group's offset child pad
    p = Page(br); p.connect('wss://127.0.0.1:8443/w/ep7'); p.edit_on()
    p.page.click('#ep-teleporter'); W(p, 400); p.page.fill('#tp-dest-input', '/worlds/x/y'); p.page.click('#tp-save-btn'); W(p, 1500)
    print('C7 pad selected', p.ev("__ep().selected?.name"), 'pos', p.ev("__ep().selected?.translation"), 'note', p.ev(NOTE))
    DRAG = """(xz) => { const e = __ep(); const g = e.gizmo, o = e.selectedObj; g.dispatchEvent({ type: 'dragging-changed', value: true }); o.position.set(xz[0], o.position.y, xz[1]); g.dispatchEvent({ type: 'objectChange' }); return null }"""
    END = "() => { __ep().gizmo.dispatchEvent({ type: 'dragging-changed', value: false }) }"
    p.ev(DRAG, [0.3, 0.2]); W(p, 100)
    print('C7 mid-drag onto spawn', p.ev(NOTE))
    p.ev("(xz) => { const e = __ep(); const o = e.selectedObj; o.position.set(xz[0], o.position.y, xz[1]); e.gizmo.dispatchEvent({ type: 'objectChange' }) }", [5, 5]); W(p, 100)
    print('C7 mid-drag off spawn', p.ev(NOTE))
    p.ev(END); W(p, 500)
    # group whose child pad is offset: add a cube, parent? (the client has no reparent UI) -> use a world with a group if any
    print('errors', p.errors)
    p.close(); br.close()
