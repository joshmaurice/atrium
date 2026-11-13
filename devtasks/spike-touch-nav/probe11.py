# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
"""touch-nav probe 11: the operator at DEV (2026-11-12): in 'desktop site' mode, in portrait, the
look is too fast. That page is zoomed out (visualViewport.scale ~0.4): a 100 CSS px look-drag is 40
px of finger. Here: page zoom 0.5 (CDP), a 100 CSS px drag; the turn should be by screen px."""
import os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'harness', 'checks', 'touch-nav'))
from tn_lib import *
with sync_playwright() as pw:
    br = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    q = phone(br); connect(q, 'atrp11%d' % (int(time.time()) % 10000)); tq = Touch(q.page)
    tq.down(0, 60, 500); tq.up(0); time.sleep(0.4)
    for zoom in (1, 0.5):
        tq.cdp.send('Emulation.setPageScaleFactor', {'pageScaleFactor': zoom}); time.sleep(0.6)
        y0 = q.ev(NAV)['yaw']
        c = q.ev("(() => { const r = document.querySelector('#viewport canvas').getBoundingClientRect(); return [r.x + 60, r.y + 200] })()")
        synth(q, 'pointerdown', 995, c[0], c[1], primary=True)
        for j in range(1, 11): synth(q, 'pointermove', 995, c[0] + 10 * j, c[1], primary=True)
        synth(q, 'pointerup', 995, c[0] + 100, c[1], primary=True); time.sleep(0.4)
        print(f"page zoom {q.ev('visualViewport.scale')}: a 100 CSS px look-drag ({100 * zoom:.0f} px on screen) turned {q.ev(NAV)['yaw'] - y0:.3f} rad")
    br.close()
