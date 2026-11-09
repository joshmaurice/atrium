# f3 — fresh check of PREBRIEF-grouping.md Rev 0.1 (GR6/GR8): another tab's
# parent change of the node THIS tab is dragging with the handles. On the
# released page (172b816), the change is applied as GR6 would apply it (world
# kept, inside applyLocally), mid-drag; the drag then continues. Does the
# object stay where the drag had it, and what local value does the drag send?
# Run from devtasks/harness/checks/grouping:
#   HARNESS_ROOT=/tmp/atrium-harness timeout 300 python3 ../../../spike-grouping/fresh/f3_drag_remote_reparent.py
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../harness/checks/grouping'))
from sp import *

# g2's REPARENT, unchanged: three's attach() gives the world-kept local TRS
REPARENT = """([child, parent]) => {
  const som = atriumClient.som; const c = som.getNodeByName(child);
  const p = parent ? som.getNodeByName(parent) : null;
  const oc = stage.scene.getObjectByName(child);
  const op = parent ? stage.scene.getObjectByName(parent) : (function f(o){ while (o.parent && o.parent.type !== 'Scene') o = o.parent; return o.parent })(oc);
  const ghost = oc.clone(false); oc.parent.add(ghost); ghost.position.copy(oc.position); ghost.quaternion.copy(oc.quaternion); ghost.scale.copy(oc.scale);
  op.attach(ghost);
  const t = ghost.position.toArray(), r = ghost.quaternion.toArray(), s = ghost.scale.toArray(); ghost.removeFromParent();
  atriumClient.applyLocally(() => { c.translation = t; c.rotation = r; c.scale = s; (p ?? som.scene).addChild(c) });
  return { t: t.map(v => Math.round(v * 1e4) / 1e4), parentNow: c.parent ? c.parent.name : null } }"""
WORLDPOS = "(name) => { const o = stage.scene.getObjectByName(name); o.updateWorldMatrix(true, false); const v = o.position.clone(); o.getWorldPosition(v); return v.toArray().map(x => Math.round(x * 1e4) / 1e4) }"
SENT = """() => { const out = []; const ws = atriumClient._ws; if (!ws.__spy) { const orig = ws.send.bind(ws); ws.__log = []; ws.send = (d) => { try { const m = JSON.parse(d); if (m.type === 'send') ws.__log.push([m.field, m.value]) } catch {} ; return orig(d) }; ws.__spy = true } return ws.__log }"""

with sync_playwright() as pw:
    br = launch(pw)
    k = 'f3' + key()
    p = Page(br); p.connect(f'wss://127.0.0.1:8443/w/{k}'); p.edit_on(); time.sleep(1)
    m = p.page.mouse
    p.ev(SENT)
    cr = p.ev(SCREEN, 'crate-01')
    click(m, cr['x'], cr['y']); time.sleep(0.4)
    check(p.ev(SEL) == 'crate-01', 'crate-01 selected', p.ev(SEL))
    pt = point_over(p, cr, axis='X', anchor='crate-01') or point_over(p, cr, anchor='crate-01')
    check(pt is not None, 'a handle point found', pt)
    if pt is None:
        br.close(); done()
    print('handle:', pt)
    w0 = p.ev(WORLDPOS, 'crate-01')
    m.move(pt['x'], pt['y']); m.down(); m.move(pt['x'] + 15, pt['y'], steps=3); time.sleep(0.2)
    print('dragging:', p.ev(GZ))
    w1 = p.ev(WORLDPOS, 'crate-01')
    print('world after the first part of the drag:', w0, '->', w1)
    r = p.ev(REPARENT, ['crate-01', 'lamp-01']); time.sleep(0.2)
    print('another tab moved crate-01 into lamp-01 (world kept):', r)
    w2 = p.ev(WORLDPOS, 'crate-01')
    check(all(abs(a - b) < 1e-3 for a, b in zip(w1, w2)), 'right after the reparent, the world position is still the dragged one', (w1, w2))
    m.move(pt['x'] + 16, pt['y'], steps=1); time.sleep(0.2)   # one more pixel of drag
    w3 = p.ev(WORLDPOS, 'crate-01')
    jump = max(abs(a - b) for a, b in zip(w2, w3))
    check(jump < 0.2, 'one more pixel of drag moves it by a pixel’s worth, not a jump', (w2, w3, round(jump, 3)))
    m.up(); time.sleep(0.8)
    w4 = p.ev(WORLDPOS, 'crate-01')
    sent = [s for s in p.ev(SENT) if s[0] == 'translation']
    print('world at release:', w4, ' local translation now:', p.ev(TR, 'crate-01'))
    print('translation sends (the last is what the server, which never saw the reparent here, applies):', sent[-2:])
    print('Undo stack:', p.ev(UNDO))
    br.close()
done()
