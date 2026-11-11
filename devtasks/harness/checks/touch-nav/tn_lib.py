# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
"""touch-nav harness checks (pre-brief §5): a phone-sized Chromium (390 × 844,
mobile, touch), real touch events through CDP Input.dispatchTouchEvent.
Every check asserts the outcome (selection-parts lesson 2)."""
import sys, time, math, json
import os; sys.path.insert(0, os.environ.get('HARNESS_ROOT', '/tmp/atrium-harness') + '/harness')
from h import *

RESULTS = []
def check(name, ok, detail=''):
    RESULTS.append((name, ok)); print(('PASS ' if ok else 'FAIL ') + name + (' — ' + detail if detail else ''), flush=True)

NAV = """() => { const n = stage.nav; const l = n._avatar.localNode;
  return { mode: n.mode, yaw: n.yaw, pitch: n.pitch, r: n.orbitRadius,
           pos: l ? l.translation.slice() : null, input: n.moveInput } }"""
UI = """() => ({ stick: !document.getElementById('touch-stick').hidden, fp: !document.getElementById('touch-fp').hidden,
             hint: document.getElementById('hud-hint').textContent })"""

class Touch:
    """Several fingers at once: every CDP event carries all the fingers still down."""
    def __init__(self, page):
        self.cdp = page.context.new_cdp_session(page); self.pts = {}
    def _send(self, kind):
        self.cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints':
            [] if kind == 'touchEnd' else [{'x': x, 'y': y, 'id': i} for i, (x, y) in self.pts.items()]})
    def down(self, i, x, y): self.pts[i] = (x, y); self._send('touchStart')
    def move(self, i, x, y): self.pts[i] = (x, y); self._send('touchMove')
    def up(self, i):
        del self.pts[i]
        self._send('touchMove' if self.pts else 'touchEnd')
    def drag(self, i, frm, to, steps=10, hold=0.02):
        self.down(i, *frm)
        for s in range(1, steps + 1):
            self.move(i, frm[0] + (to[0] - frm[0]) * s / steps, frm[1] + (to[1] - frm[1]) * s / steps); time.sleep(hold)
        self.up(i)

def phone(br):
    p = Page.__new__(Page)
    p.ctx = br.new_context(ignore_https_errors=True, viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    p.page = p.ctx.new_page(); p.errors = []; p.console = []; p.failed = []
    p.page.on('pageerror', lambda e: p.errors.append(str(e)))
    p.page.goto(A + '/apps/client/local.html')
    p.page.wait_for_function('window.atriumClient && window.stage && window.__lib', timeout=30000)
    return p

def connect(p, k):
    # From script, not page.fill: focusing a field pans the visual viewport (below).
    p.ev(f"wsUrl.value = 'wss://127.0.0.1:8443/w/{k}'"); p.ev('connectBtn.click()')
    p.wait('window.atriumClient.connected && window.atriumClient.som && stage.nav._avatar.localNode'); time.sleep(1.0)
    home(p)

def home(p):
    """The top bar is wider than a phone (795 px at 390): focusing a field there pans the
    visual viewport sideways, and CDP touches are screen points. The checks never focus
    a field, and this asserts the page is not panned before a gesture is aimed."""
    off = p.ev("[visualViewport.pageLeft, visualViewport.pageTop]")
    assert off == [0, 0], f'the page is panned: {off}'

def centre(p):
    r = p.ev("(() => { const r = document.querySelector('#viewport canvas').getBoundingClientRect(); return [r.x, r.y, r.width, r.height] })()")
    return r[0] + r[2] / 2, r[1] + r[3] / 2

def stick_centre(p):
    return p.ev("(() => { const r = document.getElementById('touch-stick').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })()")


def synth(p, kind, pid, x, y, primary=False):
    """A second finger as in-page PointerEvents (pointerType touch) at the element under
    (x, y), or the canvas when it holds the capture. Chromium's CDP touch emulation on
    this page often withholds one finger's release until every finger lifts (probe
    dbg10: two fingers on the canvas, Edit on or off), which left touches stuck; the
    checks of a SECOND finger use this instead, with the first finger real. A move has
    `button` -1, as a real one does: TransformControls ignores a move with any other."""
    # Synthetic ids are 900+, and no real pointer has them, so pointer capture by them
    # (TransformControls captures every canvas press) would throw: a test-only shim.
    p.ev("""(() => { if (window.__synthShim) return; window.__synthShim = true;
        for (const m of ['setPointerCapture', 'releasePointerCapture']) { const f = Element.prototype[m];
          Element.prototype[m] = function (id) { if (id >= 900) return; return f.call(this, id) } } })()""")
    return p.ev(f"""(() => {{ const el = document.elementFromPoint({x}, {y});
        const target = window.__synthTarget?.[{pid}] ?? el;
        if ('{kind}' === 'pointerdown') (window.__synthTarget ??= {{}})[{pid}] = target;
        if ('{kind}' === 'pointerup' || '{kind}' === 'pointercancel') delete window.__synthTarget[{pid}];
        target.dispatchEvent(new PointerEvent('{kind}', {{ pointerId: {pid}, pointerType: 'touch', isPrimary: {str(primary).lower()},
          bubbles: true, cancelable: true, composed: true, clientX: {x}, clientY: {y}, button: '{kind}' === 'pointermove' ? -1 : 0, buttons: '{kind}' === 'pointerup' ? 0 : 1 }}));
        return target.id || target.tagName }})()""")
