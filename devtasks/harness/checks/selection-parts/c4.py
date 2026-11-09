# selection-parts c4 (PREBRIEF-selection-parts.md §5, harness): parts through
# the Edit panel's own buttons. Duplicate, Delete, Undo and Redo of the
# lamp's shade (space.gltf) and of Bench-NE (atrium.gltf), the server's copy
# (/__doc) showing each under its parent; Copy of the stand and Paste at the
# top level, at the stand's world height.
import json
from sp import *

def doc(key):
    return json.loads(http(f'/__doc?key={key}'))

def parent_on_server(key, name):
    d = doc(key)
    nodes = d.get('nodes', [])
    idx = next((i for i, n in enumerate(nodes) if n.get('name') == name), None)
    if idx is None: return '(absent)'
    for n in nodes:
        if idx in n.get('children', []): return n.get('name')
    return None

def btn(p, id):
    p.page.click('#' + id); time.sleep(0.6)

def select(p, name):
    p.ev(f"() => __ep().selectForEdit(atriumClient.som.getNodeByName('{name}'))"); time.sleep(0.3)

def run(p, key, part, group, copy):
    select(p, part)
    check(p.ev("() => document.getElementById('ep-duplicate').disabled") is False, f'{part}: Duplicate is enabled', p.ev("() => document.getElementById('ep-duplicate').title"))
    btn(p, 'ep-duplicate')
    check(p.ev(SEL) == copy, f'{part}: Duplicate makes {copy}, selected', p.ev(SEL))
    check(parent_on_server(key, copy) == group, f'  under {group} on the server', parent_on_server(key, copy))
    btn(p, 'ep-undo')
    check(parent_on_server(key, copy) == '(absent)', '  Undo removes it', parent_on_server(key, copy))
    btn(p, 'ep-redo')
    check(parent_on_server(key, copy) == group, f'  Redo puts it back under {group} (§9.5 M1)', parent_on_server(key, copy))
    btn(p, 'ep-undo')
    select(p, part)
    dialogs = []
    p.page.once('dialog', lambda d: (dialogs.append(d.message), d.dismiss()))
    btn(p, 'ep-delete')
    check(dialogs == [], f'{part}: Delete asks nothing', dialogs)
    check(parent_on_server(key, part) == '(absent)', '  and removes it', parent_on_server(key, part))
    btn(p, 'ep-undo')
    check(parent_on_server(key, part) == group, f'  Undo puts it back under {group}', parent_on_server(key, part))
    btn(p, 'ep-redo')
    check(parent_on_server(key, part) == '(absent)', '  Redo removes it again', parent_on_server(key, part))
    btn(p, 'ep-undo')
    check(parent_on_server(key, part) == group, f'  Undo: back under {group}', parent_on_server(key, part))

with sync_playwright() as pw:
    br = launch(pw)
    k = 'c4' + key()
    p = Page(br); p.connect(f'wss://127.0.0.1:8443/w/{k}'); p.edit_on(); time.sleep(1)
    shadeWorld = p.ev("() => { const n = atriumClient.som.getNodeByName('lamp-shade'); const o = stage.scene.getObjectByName('lamp-shade'); const v = o.position.clone(); o.getWorldPosition(v); return v.toArray() }")
    run(p, k, 'lamp-shade', 'lamp-01', 'lamp-shade copy')
    copyWorld = None
    # the copy's world offset (SP-L4 (b)): checked on a fresh Duplicate
    select(p, 'lamp-shade'); btn(p, 'ep-duplicate')
    copyWorld = p.ev("() => { const o = stage.scene.getObjectByName('lamp-shade copy'); const v = o.position.clone(); o.getWorldPosition(v); return v.toArray() }")
    check(abs(copyWorld[0] - shadeWorld[0] - 1.5) < 1e-6 and abs(copyWorld[1] - shadeWorld[1]) < 1e-6, 'the copy lands 1.5 m along world x from the shade', (shadeWorld, copyWorld))
    btn(p, 'ep-undo')

    # Copy the stand, Paste it at the top level, at the stand's world height
    select(p, 'lamp-stand')
    standY = p.ev("() => { const o = stage.scene.getObjectByName('lamp-stand'); const v = o.position.clone(); o.getWorldPosition(v); return v.y }")
    btn(p, 'ep-copy')
    btn(p, 'ep-paste')
    pasted = p.ev(SEL)
    check(pasted is not None and pasted.startswith('lamp-stand'), 'Paste makes a stand, selected', pasted)
    check(parent_on_server(k, pasted) is None, '  at the top level on the server', parent_on_server(k, pasted))
    check(abs(p.ev(TR, pasted)[1] - standY) < 1e-4, '  at the stand’s world height', (p.ev(TR, pasted), standY))
    btn(p, 'ep-undo')
    check(p.errors == [], 'no page errors', p.errors[:2])

    # Bench-NE in atrium.gltf: a sub-group (a tree) as the part
    k2 = 'atr' + key()
    a = Page(br); a.connect(f'wss://127.0.0.1:8443/w/{k2}'); a.edit_on(); time.sleep(1.2)
    run(a, k2, 'Bench-NE', 'Furniture', 'Bench-NE copy')
    check(a.errors == [], 'no page errors', a.errors[:2])
    br.close()
done()
