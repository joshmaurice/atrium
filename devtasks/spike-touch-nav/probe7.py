# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
"""touch-nav probe 7: the outside review's S-1, S-2 and S-3 on the real page (real CDP touches).
S-1: a tap that rolls 5 px on the cube in Edit: selected, or looked and swallowed?
S-2: with a finger on the stick, a tap on the cube, and a tap on the First person button.
S-3: during a one-finger handle drag, a second finger down and moving on the view, then lifted."""
import os, sys, time, json, math
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'harness', 'checks', 'touch-nav'))
from tn_lib import *
PROJ = """(name) => { const o = stage.scene.getObjectByName(name); const v = new (o.position.constructor)();
  o.getWorldPosition(v); v.project(stage.camera); const r = document.querySelector('#viewport canvas').getBoundingClientRect();
  return [r.x + (v.x + 1) / 2 * r.width, r.y + (1 - v.y) / 2 * r.height] }"""
SEL = "__ep().selected?.name ?? null"
with sync_playwright() as pw:
    br = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    p = phone(br); connect(p, 'atrp7%d' % (int(time.time()) % 10000)); t = Touch(p.page)
    cx, cy = centre(p); t.down(0, cx, cy + 150); t.up(0); time.sleep(0.4)
    p.ev("document.getElementById('edit-toggle-btn').click()"); time.sleep(0.6)
    p.ev("document.querySelector('#ep-palette button[data-kind=\"cube\"]').click()"); time.sleep(1.5); home(p)
    cube = p.ev(SEL)
    for _ in range(40):
        x, y = p.ev(PROJ, cube)
        if x < 90: break
        p.ev("stage.nav.yaw -= 0.03"); time.sleep(0.1)
    time.sleep(0.3); x, y = p.ev(PROJ, cube)
    p.ev("window.__clk = 0; document.addEventListener('click', () => __clk++, true)")
    def deselect(): p.ev("__ep().selectForEdit(null)"); time.sleep(0.8)
    # S-1
    deselect(); y0 = p.ev("stage.nav.yaw"); c0 = p.ev('__clk')
    t.down(1, x, y); t.move(1, x + 2.5, y); t.move(1, x + 5, y); t.up(1); time.sleep(0.8)
    print('S-1 a 5 px rolling tap: selected', p.ev(SEL), '| Δyaw', round(p.ev('stage.nav.yaw') - y0, 4), '| clicks Chrome sent', p.ev('__clk') - c0)
    p.ev(f"stage.nav.yaw = {y0}"); time.sleep(0.3)
    # S-2
    deselect(); sx, sy = stick_centre(p); c0 = p.ev('__clk')
    t.down(2, sx, sy); t.move(2, sx, sy - 2)          # a resting thumb on the stick (inside the dead zone)
    t.down(3, x, y); t.up(3); time.sleep(0.8)
    print('S-2 a tap on the cube with the stick held: selected', p.ev(SEL), '| clicks', p.ev('__clk') - c0)
    b = p.ev("(() => { const r = document.getElementById('touch-fp').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })()")
    cam0 = p.ev("stage.nav._avatar.cameraNode.translation[1]"); c0 = p.ev('__clk')
    t.down(4, b[0], b[1]); t.up(4); time.sleep(0.8)
    print('S-2 a tap on First person with the stick held: toggled', p.ev("stage.nav._avatar.cameraNode.translation[1]") != cam0, '| clicks', p.ev('__clk') - c0)
    t.up(2); time.sleep(0.5)
    # S-3
    p.ev(f"__ep().selectForEdit(atriumClient.som.getNodeByName({json.dumps(cube)}))"); time.sleep(0.8)
    x, y = p.ev(PROJ, cube); pos0 = p.ev(f"atriumClient.som.getNodeByName({json.dumps(cube)}).translation.slice()")
    obj = lambda: p.ev(f"stage.scene.getObjectByName({json.dumps(cube)}).position.toArray()")
    t.down(5, x, y)
    for s in range(1, 6): t.move(5, x + 4 * s, y); time.sleep(0.03)
    a = obj(); dragging_a = p.ev("!!document.querySelector('#viewport canvas') && (window.__ep?.()?.gizmoDragging ?? null)")
    t.down(6, cx + 100, cy + 200)
    for s in range(1, 8): t.move(6, cx + 100 - 10 * s, cy + 200 - 10 * s); time.sleep(0.03)
    b2 = obj()
    t.up(6); time.sleep(0.3)
    for s in range(6, 9): t.move(5, x + 4 * s, y); time.sleep(0.03)
    c = obj()
    t.up(5); time.sleep(1.0)
    print('S-3 the cube (on screen) after finger 1 moved 20 px:', [round(v, 3) for v in a])
    print('S-3 ... after a second finger moved on the view:', [round(v, 3) for v in b2], '| jumped', round(math.dist(a, b2), 3))
    print('S-3 ... after it lifted and finger 1 moved 12 px more:', [round(v, 3) for v in c], '| moved by finger 1 after the lift', round(math.dist(b2, c), 3))
    br.close()
