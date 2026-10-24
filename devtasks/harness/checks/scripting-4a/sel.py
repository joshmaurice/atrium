# Operator report (DEV, 2026-10-23 evening): the Stop button overflows the Edit panel; and after
# Duplicate / Undo of animated models, the selection outline is wrong (rotated, then gone) and the model
# can't be clicked any more, until a reconnect.
from anim import *
W = fresh('sel')
# The outline's box vs the model's true (precise, current-pose) box, both world-space.
BOXES = """(name) => { const o = stage.scene.getObjectByName(name); if (!o) return null; o.updateWorldMatrix(true, true);
  const B = o.position.constructor; const T = window.__THREE_Box3 || null;
  const out = {}; const sk = []; o.traverse(c => { if (c.isSkinnedMesh) sk.push(c) });
  out.skinned = sk.length;
  out.cachedBox = sk.map(m => m.boundingBox ? [m.boundingBox.min.toArray().map(v=>+v.toFixed(2)), m.boundingBox.max.toArray().map(v=>+v.toFixed(2))] : null);
  out.cachedSphereR = sk.map(m => m.boundingSphere ? +m.boundingSphere.radius.toFixed(2) : null);
  const ol = __ep().selectedObj === o ? window.__outline?.() : null;
  return out }"""
# Click through the middle of the model's true (current-pose) box, as the user would.
PICK = """(name) => { const o = stage.scene.getObjectByName(name); o.updateWorldMatrix(true, true);
  const box = new (window.__Box3())().setFromObject(o, true); const c = box.getCenter(o.position.clone());
  const v = c.clone().project(stage.camera); const el = document.getElementById('viewport') || stage.renderer.domElement; const r = el.getBoundingClientRect();
  return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height, onScreen: Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && v.z < 1,
           trueBox: [box.min.toArray().map(x=>+x.toFixed(2)), box.max.toArray().map(x=>+x.toFixed(2))] } }"""
OUTLINE = """() => { const s = stage.scene; let ol = null; s.traverse(c => { if (c.type === 'BoxHelper' || (c.isLineSegments && c.material?.color?.getHex?.() === 0xa78bfa)) ol = c });
  if (!ol) return null; ol.geometry.computeBoundingBox(); const b = ol.geometry.boundingBox; return [b.min.toArray().map(x=>+x.toFixed(2)), b.max.toArray().map(x=>+x.toFixed(2))] }"""
def click_pick(p, name):
    """Deselect, click where the model really is, report what got selected."""
    p.ev("() => __ep().selectForEdit(null)"); p.page.wait_for_timeout(150)
    at = p.ev(PICK, name)
    p.page.mouse.click(at['x'], at['y']); p.page.wait_for_timeout(400)
    return {'selected': p.ev('__ep().selected?.name ?? null'), 'onScreen': at['onScreen'], 'trueBox': at['trueBox'], 'outline': p.ev(OUTLINE)}
with sync_playwright() as pw:
    br = new_browser(pw)
    a = SPage(br, viewport=(1280, 800)); a.connect(W); a.edit_on()
    a.ev("() => { window.__Box3 = () => stage.scene.constructor.prototype.constructor && window.__B3 }")
    a.page.add_script_tag(type='module', content="import { Box3 } from 'three'; window.__B3 = Box3")
    a.page.wait_for_timeout(300)
    fox = add_model(a, FOX, scale=0.01); cm = add_model(a, CESIUM)
    # Stop button visibility in the panel
    select(a, cm)
    geo = a.ev("""() => { const p = document.getElementById('edit-panel').getBoundingClientRect(); const g = (id) => { const r = document.getElementById(id).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)] };
      return { panel: [Math.round(p.left), Math.round(p.right)], clip: g('ep-anim-clip'), loop: g('ep-anim-loop-label'), play: g('ep-anim-play'), stop: g('ep-anim-stop'), win: innerWidth } }""")
    print('PANEL cesium', geo); a.page.locator('#edit-panel').screenshot(path=SHOTS + '/s4a-panel-cesium.png')
    select(a, fox)
    print('PANEL fox', a.ev("() => { const p = document.getElementById('edit-panel').getBoundingClientRect(), s = document.getElementById('ep-anim-stop').getBoundingClientRect(); return { panelRight: Math.round(p.right), stop: [Math.round(s.left), Math.round(s.right)] } }"))
    a.page.locator('#edit-panel').screenshot(path=SHOTS + '/s4a-panel-fox.png')
    play(a, fox, 'Walk', True); play(a, cm, 'animation_0', True); a.page.wait_for_timeout(1000)
    a.page.reload(); a.page.wait_for_function('window.atriumClient && window.stage && window.__lib', timeout=30000)
    a.page.add_script_tag(type='module', content="import { Box3 } from 'three'; window.__B3 = Box3"); a.ev("() => { window.__Box3 = () => window.__B3 }")
    a.connect(W); a.edit_on(); wait_loaded(a, fox); wait_loaded(a, cm); a.page.wait_for_timeout(1000)
    print('RELOADED')
    print('PICK fox (playing)', click_pick(a, fox))
    print('PICK cesium (playing)', click_pick(a, cm))
    # Duplicate CesiumMan: the copy is selected at once
    before = set(a.ev("atriumClient.som.allNodes.map(n => n.name)")); select(a, cm); a.page.click('#ep-duplicate')
    a.wait("(b) => atriumClient.som.allNodes.some(n => !b.includes(n.name) && n.extras?.atrium?.model)", arg=list(before), timeout=15000)
    copy = [n for n in a.ev("atriumClient.som.allNodes.map(n => n.name)") if n not in before][0]
    a.page.wait_for_timeout(1500)
    print('DUP selected', a.ev('__ep().selected?.name'), 'outline', a.ev(OUTLINE), 'true', a.ev(PICK, copy)['trueBox'], 'caches', a.ev(BOXES, copy))
    for i in range(3):
        print('PICK copy', i, click_pick(a, copy)); a.page.wait_for_timeout(1500)
    print('caches copy', a.ev(BOXES, copy), 'original', a.ev(BOXES, cm))
    # Delete the fox, then Undo: the restored fox is selected at once
    select(a, fox); a.page.click('#ep-delete'); a.wait("(n) => !atriumClient.som.getNodeByName(n)", arg=fox, timeout=10000); a.page.wait_for_timeout(500)
    a.page.click('#ep-undo'); a.wait("(n) => !!atriumClient.som.getNodeByName(n)", arg=fox, timeout=10000); a.page.wait_for_timeout(1500)
    print('UNDO selected', a.ev('__ep().selected?.name'), 'outline', a.ev(OUTLINE), 'true', a.ev(PICK, fox)['trueBox'], 'caches', a.ev(BOXES, fox))
    for i in range(3):
        print('PICK restored fox', i, click_pick(a, fox)); a.page.wait_for_timeout(1500)
    a.page.screenshot(path=SHOTS + '/s4a-sel.png')
    print('errors', a.errors)
    br.close()
