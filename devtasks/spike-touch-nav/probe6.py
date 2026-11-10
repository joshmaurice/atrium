# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
"""touch-nav probe 6: the fresh check's F1 with no timing slack. In one evaluate: a
synthetic 60 px touch look on the canvas (PointerEvents, pointerType touch), then at
once a click on the first-person button. Tests the page's listeners, not Chrome's gestures."""
import os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'harness', 'checks', 'touch-nav'))
from tn_lib import *
RUN = """() => { const c = document.querySelector('#viewport canvas'); const r = c.getBoundingClientRect();
  const x = r.x + r.width / 2, y = r.y + r.height / 2;
  const ev = (type, dx) => c.dispatchEvent(new PointerEvent(type, { pointerId: 77, pointerType: 'touch', isPrimary: true, bubbles: true, clientX: x + dx, clientY: y }));
  const yaw0 = stage.nav.yaw;
  ev('pointerdown', 0); for (let i = 1; i <= 6; i++) ev('pointermove', i * 10); ev('pointerup', 60);
  const cam0 = stage.nav._avatar.cameraNode.translation[1];
  document.getElementById('touch-fp').click();
  const cam1 = stage.nav._avatar.cameraNode.translation[1];
  if (cam1 !== cam0) document.getElementById('touch-fp').click();
  // and the swallow still drops the drag's own click on the canvas
  let reached = 0; const count = () => reached++; c.addEventListener('click', count);
  ev('pointerdown', 0); for (let i = 1; i <= 2; i++) ev('pointermove', i * 3); ev('pointerup', 6);
  c.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x + 6, clientY: y }));
  c.removeEventListener('click', count);
  return { looked: stage.nav.yaw - yaw0, buttonWorked: cam1 !== cam0, canvasClickAfterShortLookReachedCanvas: reached } }"""
with sync_playwright() as pw:
    br = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    p = phone(br); connect(p, 'atrprobe6%d' % (int(time.time()) % 1000)); t = Touch(p.page)
    cx, cy = centre(p); t.down(0, cx, cy + 150); t.up(0); time.sleep(0.4)
    print('F1:', p.ev(RUN))
    br.close()
