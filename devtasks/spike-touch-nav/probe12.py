# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
"""touch-nav probe 12: Chrome's 'desktop site' mode, emulated: the page served without its
<meta name="viewport"> on a 390 px mobile screen, so Chrome lays it out 980 px wide and zooms
out (as the phone does). The operator at DEV (2026-11-12): in portrait the look is too fast, and
the stick is small and too near the left edge. Measures the page zoom, the stick's size and its
distance from the screen's left edge in SCREEN px, and the turn for a 100 px finger drag."""
import os, sys, time, re
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'harness', 'checks', 'touch-nav'))
from tn_lib import *

def desktop_site(br, w=390, h=760):
    p = Page.__new__(Page)
    p.ctx = br.new_context(ignore_https_errors=True, viewport={'width': w, 'height': h}, device_scale_factor=2, is_mobile=True, has_touch=True)
    def strip(route):
        r = route.fetch(); body = re.sub(r'<meta name="viewport"[^>]*>', '', r.text())
        route.fulfill(response=r, body=body)
    # A rewritten page loses its local-network permission, so the probe's Chromium runs
    # without that check (see the launch flags): the world server is on 127.0.0.1.
    p.ctx.route('**/apps/client/local.html', strip)
    p.page = p.ctx.new_page(); p.errors = []; p.console = []; p.failed = []
    p.page.on('pageerror', lambda e: p.errors.append(str(e)))
    p.page.goto(A + '/apps/client/local.html')
    p.page.wait_for_function('window.atriumClient && window.stage && window.__lib', timeout=30000)
    return p

if __name__ == '__main__':
    with sync_playwright() as pw:
        br = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessRespectPreflightResults'])
        for w, h in ((390, 760), (800, 360)):
            p = desktop_site(br, w, h)
            p.ev(f"wsUrl.value = 'wss://127.0.0.1:8443/w/atrp12{w}'; connectBtn.click()")
            p.wait('window.atriumClient.connected && stage.nav._avatar.localNode'); time.sleep(1.0)
            t = Touch(p.page)
            s = p.ev('visualViewport.scale')
            # a finger tap on the view (screen px = CSS px x scale; CDP touch takes CSS px of the layout)
            t.down(0, 200, 600 if h > 500 else 250); t.up(0); time.sleep(0.5)
            st = p.ev("(() => { const r = document.getElementById('touch-stick').getBoundingClientRect(); return [r.left - visualViewport.offsetLeft, r.width] })()")
            y0 = p.ev(NAV)['yaw']
            # a drag of 100 SCREEN px = 100 / scale CSS px
            x0 = 200; d = 100 / s; yy = 600 if h > 500 else 250
            synth(p, 'pointerdown', 996, x0, yy, primary=True)
            for j in range(1, 11): synth(p, 'pointermove', 996, x0 + d * j / 10, yy, primary=True)
            synth(p, 'pointerup', 996, x0 + d, yy, primary=True); time.sleep(0.4)
            print(f"{'portrait ' if h > w else 'landscape'} {w}x{h}: page zoom {s:.2f}, layout {p.ev('innerWidth')} px wide | "
                  f"stick {st[1] * s:.0f} screen px wide, {st[0] * s:.0f} screen px from the left edge | "
                  f"a 100 screen-px drag turns {p.ev(NAV)['yaw'] - y0:.3f} rad (0.500 at zoom 1)")
            p.ctx.close()
        br.close()
