# grouping g4 (PREBRIEF-grouping.md GR-L8/GR-L11 (c), the pre-contract probe,
# lesson 1): on the RELEASED page (172b816), can the Edit panel hold a bare
# node (no mesh, no parts) as its selection, as the "Empty groups" dropdown
# would select it? A real `add` makes the node (the server accepts an empty
# node today), the page selects it as the dropdown would (selectForEdit),
# then a real-mouse drag of its handle, the Delete button, and Undo.
from sp import *

with sync_playwright() as pw:
    br = launch(pw)
    k = 'g4' + key()
    p = Page(br); p.connect(f'wss://127.0.0.1:8443/w/{k}'); p.edit_on(); time.sleep(1)
    m = p.page.mouse
    srv = "async ([k, n]) => { const r = await fetch('/__doc?key=' + k); const g = await r.json(); const x = g.nodes.find(o => o.name === n); return x ? (x.translation ?? [0,0,0]).map(v => Math.round(v * 1e3) / 1e3) : null }"
    p.ev("() => atriumClient.addNode({ name: 'group-09', translation: [1, 0.5, 1.5] })"); time.sleep(1)
    check(p.ev(srv, [k, 'group-09']) == [1, 0.5, 1.5], 'the server holds the bare node group-09', p.ev(srv, [k, 'group-09']))
    p.ev("() => __ep().selectForEdit(atriumClient.som.getNodeByName('group-09'))"); time.sleep(0.5)
    check(p.ev(SEL) == 'group-09', 'the panel selects the bare node', p.ev(SEL))
    g = p.ev(GZ)
    check(g and g['attached'] == 'group-09', 'the handles attach to it', g)
    vals = p.ev("() => ({ name: document.getElementById('ep-name').value, del: !document.getElementById('ep-delete').disabled, delTitle: document.getElementById('ep-delete').title, fields: document.getElementById('ep-fields')?.style.display })")
    print('  panel:', vals)
    check(vals['name'] == 'group-09', 'its name fills the Name field', vals)
    check(vals['del'], 'Delete is enabled for it', vals)
    print('  outline object:', p.ev("() => __ep().selectedObj ? __ep().selectedObj.name : null"))
    # drag its X handle with the real mouse
    sc = p.ev(SCREEN, 'group-09')
    h = point_over(p, sc, axis='X', anchor='group-09')
    check(h is not None, 'an X handle point is found on screen (real-mouse hover)', h)
    if h:
        m.move(h['x'], h['y']); time.sleep(0.2); m.down(); time.sleep(0.15)
        for i in range(1, 21): m.move(h['x'] + 3 * i, h['y']); time.sleep(0.02)
        m.up(); time.sleep(1)
        t = p.ev(TR, 'group-09')
        check(t and t[0] > 1.05, 'a handle drag moves it (x grows)', t)
        check(p.ev(srv, [k, 'group-09']) == [round(v, 3) for v in t], 'the server holds the dragged position', (p.ev(srv, [k, 'group-09']), t))
        print('  undo labels:', p.ev(UNDO))
    # Delete it with the button, then Undo
    p.page.click('#ep-delete'); time.sleep(1)
    check(p.ev(srv, [k, 'group-09']) is None, 'Delete removes it on the server', p.ev(srv, [k, 'group-09']))
    print('  undo labels:', p.ev(UNDO))
    p.page.click('#ep-undo'); time.sleep(1.2)
    check(p.ev(srv, [k, 'group-09']) is not None, 'Undo brings it back', p.ev(srv, [k, 'group-09']))
    br.close()
done()
