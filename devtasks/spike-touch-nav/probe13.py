# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
"""touch-nav probe 13: the operator at DEV (2026-11-13), desktop-site mode only: laggy; in Edit you
must tap at the bottom of an object or below it to select it; animations not playing.
Desktop site emulated as probe12 (no meta viewport, zoom ~0.4) at a phone's device pixel ratio.
Measures: frames per second; the drawing buffer against the canvas's CSS size and the camera's
aspect against the view's; scroll events; then the view's height changed WITHOUT a window resize
(what 100dvh does when Chrome's address bar shows or hides) and a tap at a cube's centre."""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from probe12 import desktop_site
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'harness', 'checks', 'touch-nav'))
from tn_lib import *
FPS = "new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { if (++n === 30) r(Math.round(30000 / (performance.now() - t0) * 10) / 10); else requestAnimationFrame(f) }; requestAnimationFrame(f) })"
GEOM = """(() => { const c = document.querySelector('#viewport canvas'); const v = document.getElementById('viewport').getBoundingClientRect();
  return { buffer: [c.width, c.height], css: [Math.round(c.getBoundingClientRect().width), Math.round(c.getBoundingClientRect().height)], view: [Math.round(v.width), Math.round(v.height)],
           aspect: +stage.camera.aspect.toFixed(3), viewAspect: +(v.width / v.height).toFixed(3), dpr: devicePixelRatio, zoom: +visualViewport.scale.toFixed(2),
           scrolls: window.__scrolls ?? null, mixers: (window.__lib?.()?.animations?.playing?.length ?? 'n/a') } })()"""
with sync_playwright() as pw:
    br = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
                                  '--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessRespectPreflightResults'])
    for mode in ('desktop-site', 'normal'):
        if mode == 'desktop-site':
            p = desktop_site(br, dsf=float(os.environ.get('DSF', 2)))
        else:
            p = phone(br)
        p.ev("window.__scrolls = 0; window.addEventListener('scroll', () => window.__scrolls++)")
        p.ev(f"wsUrl.value = 'wss://127.0.0.1:8443/w/atrp13{mode[0]}'; connectBtn.click()")
        p.wait('window.atriumClient.connected && stage.nav._avatar.localNode'); time.sleep(1.5)
        t = Touch(p.page); t.down(0, 200, 500); t.up(0); time.sleep(0.5)
        print(f'--- {mode}: fps {p.ev(FPS)}', json.dumps(p.ev(GEOM)))
        # Edit, a cube, a tap at its centre
        p.ev("document.getElementById('edit-toggle-btn').click()"); time.sleep(0.6)
        p.ev("document.querySelector('#ep-palette button[data-kind=\"cube\"]').click()")
        p.wait("__ep().selected && stage.scene.getObjectByName(__ep().selected.name)", 60000); time.sleep(1.0)
        cube = p.ev("__ep().selected?.name")
        PROJ = f"""(() => {{ const o = stage.scene.getObjectByName({json.dumps(cube)}); const v = new (o.position.constructor)();
            o.getWorldPosition(v); v.project(stage.camera); const r = document.querySelector('#viewport canvas').getBoundingClientRect();
            return [r.x + (v.x + 1) / 2 * r.width, r.y + (1 - v.y) / 2 * r.height] }})()"""
        def tap_select(label):
            p.ev("__ep().selectForEdit(null)"); time.sleep(0.6)
            scr = p.ev(PROJ); under = p.ev(f"(e => e.id || e.tagName)(document.elementFromPoint({scr[0]}, {scr[1]}))")
            p.page.touchscreen.tap(scr[0], scr[1]); time.sleep(0.8)
            print(f'    {label}: a tap at the cube centre {[round(v) for v in scr]} (on {under}) selects {p.ev("__ep().selected?.name ?? null")}')
        tap_select('as loaded')
        # the view gets 200 CSS px shorter with no window resize: what 100dvh does as the address bar shows
        p.ev("document.body.style.height = (document.body.getBoundingClientRect().height - 200) + 'px'"); time.sleep(0.8)
        print('    after the view shrank 200 px (no window resize):', json.dumps(p.ev(GEOM)))
        tap_select('then')
        print(f'    fps now {p.ev(FPS)}')
        p.ctx.close()
    br.close()
