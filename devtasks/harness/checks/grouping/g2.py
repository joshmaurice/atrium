# grouping g2 (PREBRIEF-grouping.md §2, the pre-contract probe, lesson 1 of the
# selection-parts passdown): on the RELEASED page (172b816), a parent change
# applied in the page the way a received `set` would apply it (world placement
# kept, through applyLocally), then what the page does with it: the drawing,
# the selection, the breadcrumb, the outline and handles, a click, Escape.
# Nothing here reaches the server (it refuses `parent` today); the server's copy
# is checked to stay unchanged.
from sp import *

REPARENT = """([child, parent]) => {
  const som = atriumClient.som; const c = som.getNodeByName(child);
  const p = parent ? som.getNodeByName(parent) : null;
  const oc = stage.scene.getObjectByName(child);
  const op = parent ? stage.scene.getObjectByName(parent) : oc.parent.parent && (function f(o){ while (o.parent && o.parent.type !== 'Scene') o = o.parent; return o.parent })(oc);
  // three's attach() computes the local TRS that keeps the world placement
  const ghost = oc.clone(false); oc.parent.add(ghost); ghost.position.copy(oc.position); ghost.quaternion.copy(oc.quaternion); ghost.scale.copy(oc.scale);
  (parent ? op : op).attach(ghost);
  const t = ghost.position.toArray(), r = ghost.quaternion.toArray(), s = ghost.scale.toArray(); ghost.removeFromParent();
  atriumClient.applyLocally(() => { c.translation = t; c.rotation = r; c.scale = s; (p ?? som.scene).addChild(c) });
  return { t: t.map(v => Math.round(v * 1e4) / 1e4), parentNow: c.parent ? c.parent.name : null } }"""
WORLDPOS = "(name) => { const o = stage.scene.getObjectByName(name); o.updateWorldMatrix(true, false); const v = o.position.clone(); o.getWorldPosition(v); return v.toArray().map(x => Math.round(x * 1e4) / 1e4) }"
OPARENT = "(name) => stage.scene.getObjectByName(name).parent.name || stage.scene.getObjectByName(name).parent.type"
OUTLINED = "() => { const o = __ep().selectedObj; return o ? o.name : null }"
SERVER_KIDS = "async (k) => { const r = await fetch('/__doc?key=' + k); const g = await r.json(); return g.nodes.filter(n => n.children).map(n => n.name + ':' + n.children.map(i => g.nodes[i].name).join('+')).join(' ') }"

with sync_playwright() as pw:
    br = launch(pw)
    k = 'g2' + key()
    p = Page(br); p.connect(f'wss://127.0.0.1:8443/w/{k}'); p.edit_on(); time.sleep(1)
    m = p.page.mouse
    before_srv = p.ev(SERVER_KIDS, k)
    cr = p.ev(SCREEN, 'crate-01')
    click(m, cr['x'], cr['y']); time.sleep(0.4)
    check(p.ev(SEL) == 'crate-01', 'a click selects crate-01', p.ev(SEL))
    w0 = p.ev(WORLDPOS, 'crate-01')

    r = p.ev(REPARENT, ['crate-01', 'lamp-01']); time.sleep(0.5)
    print('reparent:', r)
    check(r['parentNow'] == 'lamp-01', 'the SOM has crate-01 under lamp-01')
    check(p.ev(OPARENT, 'crate-01') == 'lamp-01', 'the drawn crate hangs under lamp-01 (same Object3D)', p.ev(OPARENT, 'crate-01'))
    w1 = p.ev(WORLDPOS, 'crate-01')
    check(all(abs(a - b) < 1e-3 for a, b in zip(w0, w1)), 'its world position is kept', (w0, w1))
    check(p.ev(SEL) == 'crate-01', 'the selection still names crate-01', p.ev(SEL))
    print('  breadcrumb with no re-select:', repr(p.ev(PATH, 'ep-path')))
    print('  gizmo:', p.ev(GZ), ' outlined:', p.ev(OUTLINED))
    p.ev("() => __ep().selectForEdit(atriumClient.som.getNodeByName('crate-01'))"); time.sleep(0.3)
    check(p.ev(PATH, 'ep-path') == '', 'FINDING: selectForEdit of the already-selected node does not refresh the breadcrumb (returns early)', p.ev(PATH, 'ep-path'))
    p.ev("() => __ep().selectForEdit(null)"); time.sleep(0.3)
    cr = p.ev(SCREEN, 'crate-01')
    click(m, cr['x'], cr['y']); time.sleep(0.4)
    check(p.ev(SEL) == 'lamp-01', 'a fresh click on the crate now selects the top-level lamp-01', p.ev(SEL))
    time.sleep(0.7); dbl(m, cr['x'], cr['y'])
    check(p.ev(SEL) == 'crate-01', 'a double-click goes down to crate-01', p.ev(SEL))
    print('  breadcrumb:', repr(p.ev(PATH, 'ep-path')))
    p.page.keyboard.press('Escape'); time.sleep(0.3)
    check(p.ev(SEL) == 'lamp-01', 'Escape goes up to lamp-01', p.ev(SEL))

    r = p.ev(REPARENT, ['crate-01', None]); time.sleep(0.5)
    print('back to the scene:', r)
    check(p.ev(OPARENT, 'crate-01') == p.ev(OPARENT, 'lamp-01'), 'the crate is drawn at the scene level again (lamp-01’s own parent)', p.ev(OPARENT, 'crate-01'))
    w2 = p.ev(WORLDPOS, 'crate-01')
    check(all(abs(a - b) < 1e-3 for a, b in zip(w0, w2)), 'its world position is kept again', (w0, w2))
    p.ev("() => __ep().selectForEdit(null)"); time.sleep(0.3)
    cr = p.ev(SCREEN, 'crate-01'); click(m, cr['x'], cr['y']); time.sleep(0.4)
    check(p.ev(SEL) == 'crate-01', 'a click selects crate-01 at the top level', p.ev(SEL))

    # an older page receiving `set` field 'parent' from another session
    err = p.ev("""() => { try { atriumClient._onSet({ type: 'set', seq: 1, node: 'crate-01', field: 'parent', value: { parent: 'lamp-01' }, serverTime: 1, session: 'other' }, atriumClient._connectionRecord); return 'no throw' } catch (e) { return e.constructor.name + ': ' + e.message } }""")
    print('the released _onSet on a parent set:', err)
    check(p.ev(SERVER_KIDS, k) == before_srv, 'the server copy is unchanged', p.ev(SERVER_KIDS, k))
    br.close()
done()
