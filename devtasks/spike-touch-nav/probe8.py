# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
"""touch-nav probe 8: the second outside review's S-7 made on demand. One slow frame
(a 650 ms busy task in a bubble-phase pointerup listener, after the page's own) between
a touch release and its click: does a tap on First person toggle twice? Does a 12 px
look-drag's click get through the swallow and select?"""
import os, sys, time, json
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'harness', 'checks', 'touch-nav'))
from tn_lib import *
SLOW = """(() => { if (window.__slow) return; window.__slow = true;
  document.addEventListener('pointerup', () => { const t = performance.now(); while (performance.now() - t < 650) {} }) })()"""
with sync_playwright() as pw:
    br = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    p = phone(br); connect(p, 'atrp8%d' % (int(time.time()) % 10000)); t = Touch(p.page)
    cx, cy = centre(p); t.down(0, cx, cy + 150); t.up(0); time.sleep(0.4)
    p.ev("window.__clk = 0; document.addEventListener('click', () => __clk++, true)")
    b = p.ev("(() => { const r = document.getElementById('touch-fp').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })()")
    cam = lambda: p.ev("stage.nav._avatar.cameraNode.translation[1]")
    c0 = cam(); t.down(1, b[0], b[1]); t.up(1); time.sleep(1.0)
    print('fast frame: a tap on First person: camera y', c0, '->', cam(), '| clicks', p.ev('__clk'))
    p.page.touchscreen.tap(b[0], b[1]); time.sleep(1.0)
    p.ev(SLOW); p.ev('__clk = 0'); c0 = cam()
    t.down(2, b[0], b[1]); t.up(2); time.sleep(1.5)
    c1 = cam()
    print('slow frame: a tap on First person: camera y', c0, '->', c1, '(TOGGLED TWICE)' if c1 == c0 else '(once)', '| clicks', p.ev('__clk'))
    br.close()
