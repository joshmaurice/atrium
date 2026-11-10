# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
"""touch-nav probe 5: the fresh check's F1 and F2 on the real page.
F1: a look-drag (60 px, past Chrome's tap slop, so no click of its own) then, within
    0.2 s, a tap on the first-person button: does the tap still work?
F2: a 6 px look on a group member, then a quick tap: does the tap select (detail 1)
    or drill into the group (detail 2)?"""
import os, sys, time, json
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'harness', 'checks', 'touch-nav'))
from tn_lib import *
PROJ = """(name) => { const o = stage.scene.getObjectByName(name); const v = new (o.position.constructor)();
  o.getWorldPosition(v); v.project(stage.camera); const r = document.querySelector('#viewport canvas').getBoundingClientRect();
  return [r.x + (v.x + 1) / 2 * r.width, r.y + (1 - v.y) / 2 * r.height, v.z] }"""
with sync_playwright() as pw:
    br = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    p = phone(br); connect(p, 'atrprobe5%d' % (int(time.time()) % 1000)); t = Touch(p.page)
    cx, cy = centre(p)
    t.down(0, cx, cy + 150); t.up(0); time.sleep(0.4)
    p.ev("window.__clicks = []; document.addEventListener('click', e => __clicks.push((e.target.id || e.target.tagName) + ' d' + e.detail), true)")
    fp0 = p.ev("stage.nav._avatar.cameraNode.translation[1]")
    b = p.ev("(() => { const r = document.getElementById('touch-fp').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })()")
    p.ev("window.__ups = []; document.addEventListener('pointerup', e => __ups.push(Math.round(performance.now())), true); document.addEventListener('click', e => __ups.push('click ' + Math.round(performance.now())), true)")
    t.drag(1, (cx - 30, cy), (cx + 30, cy), steps=6, hold=0.01)
    t.down(9, b[0], b[1]); t.up(9); time.sleep(0.6)       # straight after, no round trip between
    print('timings (ms):', p.ev('__ups'))
    fp1 = p.ev("stage.nav._avatar.cameraNode.translation[1]")
    print('F1 a tap on First person 0.15 s after a 60 px look: camera y', fp0, '->', fp1, '(toggled)' if fp1 != fp0 else '(LOST)', 'clicks seen', p.ev('__clicks'))
    if fp1 != fp0: p.ev("document.getElementById('touch-fp').click()")
    # F2 — a group member in Edit
    p.ev("document.getElementById('edit-toggle-btn').click()"); time.sleep(0.6); home(p)
    member = p.ev("""(() => { for (const n of atriumClient.som.nodes) { const par = n.parent; if (par && par.children?.length > 1 && n.mesh && par.parent && !par.parent.parent) return n.name } return null })()""")
    print('a group member:', member)
    for _ in range(80):
        x, y, z = p.ev(PROJ, member)
        if 20 < x < 110 and 150 < y < 760 and z < 1 and p.ev(f"document.elementFromPoint({x},{y}) === document.querySelector('#viewport canvas')"): break
        p.ev("stage.nav.yaw += 0.08"); time.sleep(0.08)
    x, y, z = p.ev(PROJ, member)
    print('member on screen at', round(x), round(y), 'canvas there:', p.ev(f"document.elementFromPoint({x},{y}) === document.querySelector('#viewport canvas')"))
    p.ev("window.__clicks = []")
    p.page.touchscreen.tap(x, y); time.sleep(0.8)
    plain = p.ev("__ep().selected?.name ?? null")
    print('a plain tap selects:', plain, 'clicks', p.ev('__clicks'))
    p.ev("__ep().selectForEdit(null)"); time.sleep(1.0); p.ev("window.__clicks = []")
    t.down(2, x, y); t.move(2, x + 3, y); t.move(2, x + 6, y); t.up(2)
    time.sleep(0.12); x2, y2, _ = p.ev(PROJ, member)
    p.page.touchscreen.tap(x2, y2); time.sleep(0.8)
    print('F2 a 6 px look then a tap 0.12 s later selects:', p.ev("__ep().selected?.name ?? null"), '(plain tap gave', plain + ')', 'clicks', p.ev('__clicks'))
    br.close()
