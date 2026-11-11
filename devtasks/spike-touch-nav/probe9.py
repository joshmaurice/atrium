# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
"""touch-nav probe 9: the operator's phone report (2026-11-11), on the code before this round.
Portrait and landscape (mobile layout), and a 'desktop site' stand-in (a 980 px layout, zoomed
out): where the top bar, the saved-worlds strip, the view and the Edit panel are, and what a
touch on the view does to them."""
import os, sys, time, json
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'harness'))
from h import A, SHOTS
from playwright.sync_api import sync_playwright
BOXES = """(() => { const out = {}; const q = { topbar: '#toolbar, #topbar, header, body > div:first-child', worlds: '#world-browser', view: '#viewport', edit: '#edit-panel', canvas: '#viewport canvas' };
  for (const [k, sel] of Object.entries(q)) { const e = document.querySelector(sel); if (!e) { out[k] = null; continue }
    const r = e.getBoundingClientRect(); out[k] = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height), getComputedStyle(e).display === 'none' ? 'hidden' : ''] }
  out.inner = [innerWidth, innerHeight]; out.vv = [Math.round(visualViewport.width), Math.round(visualViewport.height), +visualViewport.scale.toFixed(2), Math.round(visualViewport.pageLeft), Math.round(visualViewport.pageTop)];
  out.scroll = [document.scrollingElement.scrollWidth, document.scrollingElement.scrollHeight, document.scrollingElement.scrollTop]; return out })()"""
def run(br, name, **ctxargs):
    ctx = br.new_context(ignore_https_errors=True, has_touch=True, **ctxargs)
    page = ctx.new_page(); page.goto(A + '/apps/client/local.html')
    page.wait_for_function('window.atriumClient && window.stage && window.__lib', timeout=30000)
    page.evaluate("wsUrl.value = 'wss://127.0.0.1:8443/w/atrp9%s'; connectBtn.click()" % name)
    page.wait_for_function('window.atriumClient.connected', timeout=30000); time.sleep(1.5)
    print(f'--- {name}: connected', json.dumps(page.evaluate(BOXES)))
    page.screenshot(path=f'{SHOTS}/p9-{name}-1.png')
    page.evaluate("document.getElementById('edit-toggle-btn').click()"); time.sleep(0.6)
    page.evaluate("document.querySelector('#ep-palette button[data-kind=\"cube\"]').click()"); time.sleep(1.5)
    cube = page.evaluate("__ep().selected?.name")
    vis = page.evaluate(f"""(() => {{ const o = stage.scene.getObjectByName({json.dumps(cube)}); const v = new (o.position.constructor)();
        o.getWorldPosition(v); v.project(stage.camera); const r = document.querySelector('#viewport canvas').getBoundingClientRect();
        const x = r.x + (v.x + 1) / 2 * r.width, y = r.y + (1 - v.y) / 2 * r.height; const e = document.elementFromPoint(x, y);
        return [Math.round(x), Math.round(y), e ? (e.id || e.tagName) : 'off-screen'] }})()""")
    print(f'    Edit + a new cube: boxes', json.dumps(page.evaluate(BOXES)), '| the cube at', vis[:2], 'is under', vis[2])
    page.screenshot(path=f'{SHOTS}/p9-{name}-2-edit.png')
    # a touch on the view (a tap, then a short drag)
    vw = page.evaluate("(() => { const r = document.querySelector('#viewport canvas').getBoundingClientRect(); return [r.x + 30, r.y + r.height - 30] })()")
    page.touchscreen.tap(vw[0], vw[1]); time.sleep(0.8)
    print(f'    after a tap on the view', json.dumps(page.evaluate(BOXES)))
    page.screenshot(path=f'{SHOTS}/p9-{name}-3-tapped.png')
    ctx.close()
with sync_playwright() as pw:
    br = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    run(br, 'portrait', viewport={'width': 390, 'height': 760}, device_scale_factor=2, is_mobile=True)
    run(br, 'landscape', viewport={'width': 800, 'height': 330}, device_scale_factor=2, is_mobile=True)
    # 'Desktop site': Chrome lays the page out at 980 px and zooms out to fit; is_mobile off ignores the meta viewport
    run(br, 'desktopsite', viewport={'width': 980, 'height': 1910}, device_scale_factor=0.8, is_mobile=False)
    br.close()
