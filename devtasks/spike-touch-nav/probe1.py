# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
"""touch-nav probe 1: what touch does on today's page, in a phone-sized Chromium.
Real touch events through CDP (Input.dispatchTouchEvent), not synthetic DOM events.
Prints the nav state (yaw, pitch), the avatar's position and the selection after each gesture."""
import os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'harness'))
from h import A, SHOTS
from playwright.sync_api import sync_playwright

STATE = """() => { const n = stage.nav; const a = window.atriumClient; const loc = n._avatar.localNode;
  return { mode: n.mode, yaw: +n.yaw.toFixed(4), pitch: +n.pitch.toFixed(4),
           pos: loc ? loc.translation.map(v => +v.toFixed(3)) : null,
           hint: document.getElementById('hud-hint')?.textContent } }"""

def touch(cdp, kind, pts):
    cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': [{'x': x, 'y': y, 'id': i} for i, (x, y) in enumerate(pts)]})

def drag(cdp, frm, to, steps=12, fingers=1, gap=60):
    def pts(x, y): return [(x + i * gap, y) for i in range(fingers)]
    touch(cdp, 'touchStart', pts(*frm))
    for s in range(1, steps + 1):
        x = frm[0] + (to[0] - frm[0]) * s / steps; y = frm[1] + (to[1] - frm[1]) * s / steps
        touch(cdp, 'touchMove', pts(x, y)); time.sleep(0.03)
    touch(cdp, 'touchEnd', [])
    time.sleep(0.4)

with sync_playwright() as pw:
    br = pw.chromium.launch()
    ctx = br.new_context(ignore_https_errors=True, viewport={'width': 390, 'height': 844},
                         device_scale_factor=3, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(A + '/apps/client/local.html')
    page.wait_for_function('window.atriumClient && window.stage && window.__lib', timeout=30000)
    k = 'atrtouch%d' % int(time.time())
    page.screenshot(path=f'{SHOTS}/touch-00-boot.png')
    # At 390 px the Connect button is covered (probe finding): click it from script.
    print('connect button covered by:', page.evaluate("""(() => { const r = connectBtn.getBoundingClientRect();
      const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return e === connectBtn ? 'nothing' : e.tagName + '#' + e.id })()"""))
    page.fill('#wsUrl', f'wss://127.0.0.1:8443/w/{k}')
    page.evaluate("connectBtn.click()")
    page.wait_for_function('window.atriumClient.connected && window.atriumClient.som', timeout=30000)
    time.sleep(1.5)
    page.screenshot(path=f'{SHOTS}/touch-0-connected.png')
    cdp = ctx.new_cdp_session(page)
    vp = page.evaluate("(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return [r.x, r.y, r.width, r.height] })()")
    cx, cy = vp[0] + vp[2] / 2, vp[1] + vp[3] / 2
    print('canvas rect', vp)
    print('what is at the centre:', page.evaluate(f"document.elementFromPoint({cx},{cy})?.tagName + '#' + (document.elementFromPoint({cx},{cy})?.id||'')"))
    print('start   ', page.evaluate(STATE))
    drag(cdp, (cx - 80, cy), (cx + 80, cy))
    print('1-finger horizontal drag 160px', page.evaluate(STATE))
    drag(cdp, (cx, cy - 80), (cx, cy + 80))
    print('1-finger vertical drag 160px  ', page.evaluate(STATE))
    drag(cdp, (cx - 60, cy + 100), (cx - 60, cy - 100), fingers=2)
    print('2-finger upward drag          ', page.evaluate(STATE))
    time.sleep(2)
    print('after 2 s idle                ', page.evaluate(STATE))
    # the page's own mode switcher and the panels at phone size
    print('mode options:', page.evaluate("[...document.querySelectorAll('#mode-switcher option')].map(o => o.value + (o.disabled?'(off)':''))"))
    print('page scroll size:', page.evaluate("[document.documentElement.scrollWidth, document.documentElement.scrollHeight]"))
    page.screenshot(path=f'{SHOTS}/touch-1-after.png')
    print('errors:', errs)
    br.close()
