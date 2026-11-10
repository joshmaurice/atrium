# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
"""touch-nav probe 2: what lies past a 390 px screen's right edge, before and after connecting."""
import os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'harness'))
from h import A
from playwright.sync_api import sync_playwright
LIST = """(() => [...document.querySelectorAll('button, select, input, a')].filter(e => {
  const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
  return r.width > 0 && s.visibility !== 'hidden' && r.right > innerWidth + 1 }).map(e => (e.id || e.textContent.trim().slice(0, 20)) + '@' + Math.round(e.getBoundingClientRect().left))
)()"""
with sync_playwright() as pw:
    br = pw.chromium.launch()
    ctx = br.new_context(ignore_https_errors=True, viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True)
    page = ctx.new_page(); page.goto(A + '/apps/client/local.html')
    page.wait_for_function('window.atriumClient && window.stage && window.__lib', timeout=30000)
    print('innerWidth', page.evaluate('innerWidth'), 'top bar widths', page.evaluate("[...document.body.children].slice(0,4).map(e => (e.id||e.tagName) + ':' + Math.round(e.scrollWidth))"))
    print('off the right edge before connecting:', page.evaluate(LIST))
    page.fill('#wsUrl', 'wss://127.0.0.1:8443/w/atrprobe2'); page.evaluate('connectBtn.click()')
    page.wait_for_function('window.atriumClient.connected', timeout=30000); time.sleep(1)
    page.evaluate('window.scrollTo(0,0); document.scrollingElement.scrollLeft = 0; for (const e of document.querySelectorAll("*")) if (e.scrollLeft) e.scrollLeft = 0')
    print('off the right edge after connecting:', page.evaluate(LIST))
    # a tap on the canvas: what events reach the page
    page.evaluate("""window.__ev = []; for (const t of ['pointerdown','pointermove','pointerup','mousedown','mousemove','mouseup','click','touchstart','touchmove','touchend'])
      document.addEventListener(t, e => __ev.push(t + (e.pointerType ? '/' + e.pointerType : '')), true)""")
    cdp = ctx.new_cdp_session(page)
    for kind, pts in [('touchStart', [{'x': 195, 'y': 500}]), ('touchMove', [{'x': 215, 'y': 500}]), ('touchMove', [{'x': 245, 'y': 500}]), ('touchEnd', [])]:
        cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': pts}); time.sleep(0.05)
    time.sleep(0.4)
    print('events for a 50 px touch drag:', page.evaluate('__ev'))
    page.evaluate('__ev.length = 0'); page.touchscreen.tap(195, 500); time.sleep(0.5)
    print('events for a tap:', page.evaluate('__ev'))
    print('canvas touch-action:', page.evaluate("getComputedStyle(document.querySelector('canvas')).touchAction"))
    br.close()
