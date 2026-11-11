# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
"""touch-nav probe 10: the operator's 'desktop site' screenshots (2026-11-11 12:36): a touch on
the view scrolls the bars off the top, with no way back. The canvas has tabindex 0, so a tap
focuses it and the browser scrolls it fully into view; body is 100vh (the height with Chrome's
address bar hidden) and overflow: hidden, so the user can't scroll back. Emulation has no address
bar: the gap is made by setting body's height 120 px past the window, as 100vh is on the phone."""
import os, sys, time, json
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'harness', 'checks', 'touch-nav'))
from tn_lib import *
with sync_playwright() as pw:
    br = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    p = phone(br); connect(p, 'atrp10%d' % (int(time.time()) % 10000))
    print('body height rule:', p.ev("getComputedStyle(document.body).height"), 'window', p.ev('innerHeight'))
    p.ev("document.body.style.height = (innerHeight + 120) + 'px'")    # 100vh with the address bar showing
    time.sleep(0.3)
    print('before a tap: scrollY', p.ev('scrollY'), '| top bar top', p.ev("Math.round(document.querySelector('.toolbar').getBoundingClientRect().top)"))
    cx, cy = centre(p)
    p.page.touchscreen.tap(60, 500); time.sleep(0.8)
    print('after a tap on the view: scrollY', p.ev('scrollY'), '| top bar top', p.ev("Math.round(document.querySelector('.toolbar').getBoundingClientRect().top)"), '| focused', p.ev("document.activeElement.tagName"))
    br.close()
