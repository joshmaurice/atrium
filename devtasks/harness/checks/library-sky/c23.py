import sys, time, json
import os; sys.path.insert(0, os.environ.get('HARNESS_ROOT', '/tmp/atrium-harness') + '/harness')
from h import *
SHOW = "0"  # round 2: no forced visibility
BOX = """async (name) => {
  const THREE = await import('three')
  const r = __mb.instances.get(name); if (!r) return null
  const w = r.wrapper; if (!w) return { status: __mb.status(name) }
  w.updateWorldMatrix(true, true)
  const b = new THREE.Box3().setFromObject(w)
  const node = atriumClient.som.getNodeByName(name)
  return { status: __mb.status(name), min: b.min.toArray().map(v=>+v.toFixed(3)), max: b.max.toArray().map(v=>+v.toFixed(3)),
           size: b.getSize(new THREE.Vector3()).toArray().map(v=>+v.toFixed(3)), t: node.translation.map(v=>+v.toFixed(3)),
           bounds: node.extras?.atrium?.model?.bounds, placeholder: !!r.placeholder, instance: !!r.instance }
}"""
with sync_playwright() as pw:
    br = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctl(catalog='small')
    cat = json.loads(http('/apps/client/library/catalog.json'))
    p = Page(br)
    p.connect('wss://127.0.0.1:8443/w/c23')
    p.edit_on()
    p.page.click('#ep-library'); time.sleep(0.3)
    p.ev(SHOW); time.sleep(2)
    print('thumbs', p.ev("[...document.querySelectorAll('.lg-tile img')].map(i=>[i.alt, i.complete, i.naturalWidth, i.src.split('/').pop()])"))
    p.page.screenshot(path=SHOTS + '/r2-c2-grid.png')
    # --- click first tile (Tiny Cube) and a second tile in the same tick
    n0 = p.ev("atriumClient.som.nodes.length")
    names_before = set(p.ev("atriumClient.som.nodes.map(n=>n.name)"))
    res = p.ev("""() => { const t = [...document.querySelectorAll('.lg-tile')]; t[0].click(); const w1 = __lib().libraryGrid.waiting;
       t[1].click(); const t2 = [...document.querySelectorAll('.lg-tile')]; t2[1].click();
       return { w1, w2: __lib().libraryGrid.waiting, disabled: t2.map(x=>x.disabled) } }""")
    print('double click', res)
    time.sleep(0.2)
    # placeholder right away?
    added = [n for n in p.ev("atriumClient.som.nodes.map(n=>n.name)") if n not in names_before]
    print('added nodes', added)
    name = added[0]
    print('extras.atrium.model', p.ev("(n) => atriumClient.som.getNodeByName(n).extras.atrium.model", name))
    entry = cat['models'][0]
    print('catalog entry', {k: entry[k] for k in ('name', 'url', 'sha256', 'bounds')})
    print('box while loading', p.ev(BOX, name))
    p.wait("(n) => __mb.status(n)?.status === 'loaded' || __mb.status(n) === 'loaded'", arg=name, timeout=60000)
    print('status', p.ev("(n) => __mb.status(n)", name))
    print('box loaded', p.ev(BOX, name))
    time.sleep(0.5)
    print('selected', p.ev("document.getElementById('ep-name').value"), p.ev("getComputedStyle(document.getElementById('ep-fields')).display"))
    print('grid still open', p.ev("__lib().libraryGrid.isOpen()"), 'status line', p.ev("document.getElementById('library-status').textContent"))
    # undo
    p.page.click('#ep-undo'); time.sleep(1.0)
    print('after undo exists?', p.ev("(n) => !!atriumClient.som.getNodeByName(n)", name))
    # --- placement of several items
    ids = ['Long_Bench', 'Tall_Tower', 'Big_Block', 'Side_Table', 'Tiny_Cube', 'Flat_Rug', 'Nested_Box']
    placed = []
    for i, mid in enumerate(ids):
        p.ev(SHOW)
        idx = [m['id'] for m in cat['models']].index(mid)
        # tile order follows groupByCategory; find by alt text
        nm = cat['models'][idx]['name']
        before = set(p.ev("atriumClient.som.nodes.map(n=>n.name)"))
        place = p.ev("""async () => { const THREE = await import('three'); const o = (avatar => avatar)(null); return null }""")
        p.page.locator('.lg-tile', has=p.page.locator(f'img[alt="{nm}"]')).click()
        p.wait("() => __lib().libraryGrid.waiting === null", timeout=10000)
        new = [n for n in p.ev("atriumClient.som.nodes.map(n=>n.name)") if n not in before]
        ph = p.ev(BOX, new[0])
        p.wait("(n) => __mb.status(n)?.status === 'loaded'", arg=new[0], timeout=60000)
        bx = p.ev(BOX, new[0])
        placed.append((mid, new[0], ph, bx))
    for mid, nm, ph, bx in placed:
        print(mid, nm, 'placeholderSeen', ph.get('placeholder'), 'phSize', ph.get('size'), '| loaded size', bx['size'], 'bounds', bx['bounds'], 't', bx['t'], 'min', bx['min'], 'max', bx['max'])
    # spread them side by side along x (same placement z) for the screenshot
    p.ev("""(names) => { let x = -6; for (const n of names) { const node = atriumClient.som.getNodeByName(n); const b = node.extras.atrium.model.bounds; x += b[0]/2; node.translation = [x, 0, node.translation[2]]; x += b[0]/2 + 0.4 } }""", [x[1] for x in placed])
    time.sleep(1.5)
    for mid, nm, ph, bx in placed:
        b = p.ev(BOX, nm)
        print('moved', mid, 't', b['t'], 'min', b['min'], 'max', b['max'])
    p.page.click('#edit-toggle-btn'); time.sleep(0.5)
    p.page.screenshot(path=SHOTS + '/r2-c3-placement.png')
    print('errors', p.errors)
    print('bad', [c for c in p.console if c.startswith('error') and '401' not in c])
    p.close(); br.close()
