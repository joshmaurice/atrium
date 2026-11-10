# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
"""touch-nav probe 4: a touch drag on the move handle's centre: what TransformControls sees."""
import os, sys, time, json, math
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'harness', 'checks', 'touch-nav'))
from tn_lib import *
mode = sys.argv[1] if len(sys.argv) > 1 else 'touch'
PROJ = """(name) => { const o = stage.scene.getObjectByName(name); const v = new (o.position.constructor)();
  o.getWorldPosition(v); v.project(stage.camera); const r = document.querySelector('#viewport canvas').getBoundingClientRect();
  return [r.x + (v.x + 1) / 2 * r.width, r.y + (1 - v.y) / 2 * r.height] }"""
with sync_playwright() as pw:
    br = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    p = phone(br); connect(p, 'atrprobe4%d' % (int(time.time()) % 1000)); t = Touch(p.page)
    t.down(0, 100, 300); t.up(0); time.sleep(0.3)
    p.ev("document.getElementById('edit-toggle-btn').click()"); time.sleep(0.6)
    p.ev("document.querySelector('#ep-palette button[data-kind=\"cube\"]').click()"); time.sleep(1.5)
    home(p)
    cube = p.ev("__ep().selected?.name")
    for _ in range(40):          # turn right until the cube is in the strip left of the Edit panel
        x, y = p.ev(PROJ, cube)
        if x < 90: break
        p.ev("stage.nav.yaw -= 0.03"); time.sleep(0.1)
    time.sleep(0.3); x, y = p.ev(PROJ, cube)
    print('cube', cube, 'on screen at', round(x), round(y), 'element there:', p.ev(f"(e => e.id || e.tagName)(document.elementFromPoint({x},{y}))"))
    p.ev("""window.__g = []; const c = document.querySelector('#viewport canvas');
      for (const ty of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'])
        c.addEventListener(ty, e => { const g = window.__gizmo ?? null; __g.push(ty + ' ' + e.pointerType) }, true)""")
    pos0 = p.ev(f"atriumClient.som.getNodeByName({json.dumps(cube)}).translation.slice()")
    if mode == 'touch':
        t.down(1, x, y); time.sleep(0.1)
        for s in range(1, 13): t.move(1, x + 4 * s, y); time.sleep(0.03)
        t.up(1)
    else:
        p.page.mouse.move(x, y); p.page.mouse.down()
        for s in range(1, 13): p.page.mouse.move(x + 4 * s, y); time.sleep(0.03)
        p.page.mouse.up()
    time.sleep(1.0)
    pos1 = p.ev(f"atriumClient.som.getNodeByName({json.dumps(cube)}).translation.slice()")
    print(mode, 'moved', round(math.dist(pos0, pos1), 3), 'events', sorted(set(p.ev('__g'))), 'count', len(p.ev('__g')))
    br.close()
