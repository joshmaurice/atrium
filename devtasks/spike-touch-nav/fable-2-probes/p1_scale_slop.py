"""P1: the page's scale on the emulated phone, the stick's size in CSS and screen px,
and the travel at which Chromium stops sending a click for a touch drag (its tap slop),
against the page's 10 px look slop."""
from common import *

with sync_playwright() as pw:
    br = pw.chromium.launch(args=ARGS)
    p = phone(br); connect(p, fresh()); t = Touch(p.page)
    first_touch(p, t)
    say('viewport', p.ev("""({ innerWidth, innerHeight, clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth, vvScale: visualViewport.scale, vvWidth: visualViewport.width,
        dpr: devicePixelRatio, screenW: screen.width, outerWidth })"""))
    say('stick rect (CSS px)', p.ev("(() => { const r = document.getElementById('touch-stick').getBoundingClientRect(); return [r.x, r.y, r.width, r.height] })()"))
    say('canvas rect (CSS px)', p.ev("(() => { const r = document.querySelector('#viewport canvas').getBoundingClientRect(); return [r.x, r.y, r.width, r.height] })()"))
    cx, cy = centre(p)
    p.ev("window.__docClk = 0; document.addEventListener('click', () => __docClk++, true); window.__vpClk = 0; document.getElementById('viewport').addEventListener('click', () => __vpClk++)")
    for d in (4, 8, 9, 10, 12, 16, 20, 24, 28, 30, 32, 36, 40, 50):
        c0 = p.ev("[__docClk, __vpClk]"); y0 = p.ev(NAV)['yaw']
        t.down(1, cx, cy)
        steps = max(2, d // 2)
        for s in range(1, steps + 1): t.move(1, cx + d * s / steps, cy)
        t.up(1); time.sleep(0.7)
        c1 = p.ev("[__docClk, __vpClk]"); y1 = p.ev(NAV)['yaw']
        say(f'drag {d:>2} CSS px', f"click sent by Chromium: {c1[0] - c0[0]}, seen by the page: {c1[1] - c0[1]}, looked: {abs(y1 - y0) > 1e-9} (Δyaw {y1 - y0:.3f})")
    say('errors', p.errors)
    br.close()
