# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
"""touch-nav probe 3: which element a touch lands on, and the pointer events for two fingers."""
import os, sys, time, json
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'harness', 'checks', 'touch-nav'))
from tn_lib import *
LOG = """window.__ev = []; for (const t of ['pointerdown','pointerup','pointercancel'])
  document.addEventListener(t, e => __ev.push(t + ' id' + e.pointerId + ' ' + e.pointerType + ' on ' + (e.target.id || e.target.tagName) + ' @' + Math.round(e.clientX) + ',' + Math.round(e.clientY)), true)"""
with sync_playwright() as pw:
    br = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    p = phone(br); connect(p, 'atrprobe3'); t = Touch(p.page)
    cx, cy = centre(p)
    print('innerWidth', p.ev('innerWidth'), 'visualViewport', p.ev('[visualViewport.width, visualViewport.scale]'), 'canvas centre', cx, cy)
    t.down(0, cx, cy + 150); t.up(0); time.sleep(0.3)
    sx, sy = stick_centre(p)
    print('stick centre', sx, sy, 'element there:', p.ev(f"(e => e.id || e.tagName)(document.elementFromPoint({sx},{sy}))"))
    p.ev(LOG)
    t.down(1, sx, sy); t.move(1, sx, sy - 40); time.sleep(0.2); t.up(1); time.sleep(0.2)
    t.drag(2, (cx, cy - 40), (cx, cy + 40)); time.sleep(0.2)
    t.down(3, cx - 40, cy); t.down(4, cx + 40, cy); t.move(3, cx - 80, cy); t.move(4, cx + 80, cy); t.up(4); t.up(3); time.sleep(0.3)
    print('\n'.join(p.ev('__ev')))
    print('pitch now', p.ev('stage.nav.pitch'))
    br.close()
