# Shared helpers for the scripting-4a §5.1 checks (model animations).
import sys, os, time, json
sys.path.insert(0, os.environ.get('HARNESS_ROOT', '/tmp/atrium-harness') + '/harness')
from h import *

FOX = A + '/khronos/Fox.glb'
CESIUM = A + '/khronos/CesiumMan.glb'
LAUNCH = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']

# The panel as the owner sees it.
ROW = """() => { const g = (id) => document.getElementById(id); const r = g('ep-anim-row');
  return { shown: !!r && getComputedStyle(r).display !== 'none', clips: [...g('ep-anim-clip').options].map(o => o.value),
    clip: g('ep-anim-clip').value, loop: g('ep-anim-loop').checked, play: !g('ep-anim-play').disabled,
    stop: !g('ep-anim-stop').disabled, status: g('ep-anim-status').textContent, error: g('ep-error').textContent } }"""

# A model node's pose: the world positions of a few of its bones (or meshes), rounded.
POSE = """(name) => { const o = window.__mb && stage.scene.getObjectByName(name); if (!o) return null;
  const out = []; const v = new o.position.constructor(); o.updateWorldMatrix(true, true);
  o.traverse((c) => { if (c.isBone) { c.getWorldPosition(v); out.push([+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)]) } });
  return out }"""

# The clip time this session's layer would set now, and the server-clock estimate.
CLOCK = """(name) => { const a = __anim().modelAnimations.actionFor(name); const c = atriumClient;
  return { t: a ? a.time : null, enabled: a ? a.enabled : null, running: a ? a.isRunning() : null,
    serverNow: c.serverNow(), ready: c.serverClockReady, value: c.som?.getNodeByName(name)?.extras?.atrium?.animation ?? null,
    state: __anim().modelAnimations.status(name) } }"""


def new_browser(pw):
    return pw.chromium.launch(args=LAUNCH)


def sends(page):
    """Record every client->server message on this page (a pass-through route)."""
    log = []
    def route(ws):
        server = ws.connect_to_server()
        def up(m):
            log.append(m); server.send(m)
        ws.on_message(up)
        server.on_message(lambda m: ws.send(m))
    page.route_web_socket('**/w/**', route)
    return log


def add_model(p, url, scale=None):
    """Place a model by URL through the Model form; returns its node name once loaded."""
    before = set(p.ev('atriumClient.som.allNodes.map(n => n.name)'))
    p.page.click('#ep-model'); p.page.fill('#model-url-input', url); p.page.click('#model-check-btn')
    p.wait("() => __ep().modelForm.state.result || __ep().modelForm.state.problem", timeout=60000)
    p.wait("() => !document.getElementById('model-save-btn').disabled", timeout=30000)
    p.page.click('#model-save-btn')
    p.wait("(b) => atriumClient.som.allNodes.some(n => !b.includes(n.name) && n.extras?.atrium?.model)", arg=list(before), timeout=30000)
    name = p.ev("(b) => atriumClient.som.allNodes.find(n => !b.includes(n.name) && n.extras?.atrium?.model).name", list(before))
    p.wait("(n) => __mb.status(n)?.status === 'loaded'", arg=name, timeout=60000)
    p.page.wait_for_timeout(300)
    if scale is not None:
        select(p, name)
        for i in range(3):
            f = p.page.locator(f'#ep-fields input[data-field="scale"][data-i="{i}"]')
            f.fill(str(scale)); f.press('Enter'); p.page.wait_for_timeout(250)
    return name


def select(p, name):
    p.ev("(n) => __ep().selectForEdit(atriumClient.som.getNodeByName(n))", name)
    p.page.wait_for_timeout(200)


def row(p):
    return p.ev(ROW)


def clock(p, name):
    return p.ev(CLOCK, name)


def pose(p, name):
    return p.ev(POSE, name)


def wait_loaded(p, name, timeout=60000):
    p.wait("(n) => __mb.status(n)?.status === 'loaded' && __anim().modelAnimations.status(n).state !== 'loading'", arg=name, timeout=timeout)


def same_moment(pages, name):
    """Sample every page's clip time as close together as the sync API allows."""
    return [p.ev(CLOCK, name) for p in pages]

# Ground truth: this machine's real wall clock (performance.timeOrigin + now() is
# unaffected by a page overriding Date.now, and the harness server runs on the
# same machine). The layer is stepped once, then the action's time is compared
# with the clip time the stored value implies at that same instant.
ERR = """(name) => { const m = __anim().modelAnimations; m.update(); const a = m.actionFor(name);
  const node = atriumClient.som?.getNodeByName(name); const v = node?.extras?.atrium?.animation ?? null;
  const now = performance.timeOrigin + performance.now();
  if (!a || !v || !v.playing) return { t: a ? a.time : null, value: v, state: m.status(name).state, clockErrMs: atriumClient.serverNow() - now };
  const d = a.getClip().duration; const e = (now - v.startedAt) / 1000 * v.speed;
  const exp = v.loop ? e % d : Math.min(Math.max(e, 0), d); let err = a.time - exp;
  if (v.loop) err = ((err + d / 2) % d + d) % d - d / 2;
  return { t: +a.time.toFixed(4), exp: +exp.toFixed(4), errMs: +(err * 1000).toFixed(1), d: +d.toFixed(3),
    clockErrMs: +(atriumClient.serverNow() - now).toFixed(1), state: m.status(name).state, ready: atriumClient.serverClockReady } }"""

# Shift Date.now (only) by window.__dateShift ms; a check can change it mid-play.
DATE_SHIFT = """(() => { const real = Date.now.bind(Date); window.__dateShift = %d; Date.now = () => real() + window.__dateShift })()"""

# Delay every socket message by %d ms each way, inside the page.
WS_DELAY = """(() => { const D = %d; const P = WebSocket.prototype; const send = P.send;
  P.send = function (d) { setTimeout(() => { try { send.call(this, d) } catch (e) {} }, D) };
  const add = P.addEventListener;
  P.addEventListener = function (t, fn, o) { if (t === 'message') return add.call(this, t, (e) => setTimeout(() => fn.call(this, e), D), o); return add.call(this, t, fn, o) } })()"""


class SPage(Page):
    """A Page whose context gets init scripts before the app boots."""
    # A small viewport by default: SwiftShader renders two skinned models in ~150 ms
    # a frame at 1280 x 800, and a pong queued behind a frame biases the clock
    # estimate by half that wait (a harness artifact, not a code fault).
    def __init__(self, browser, origin=A, init=(), path='/apps/client/local.html', viewport=(480, 360)):
        self.ctx = browser.new_context(ignore_https_errors=True, viewport={'width': viewport[0], 'height': viewport[1]})
        for script in init:
            self.ctx.add_init_script(script)
        self.page = self.ctx.new_page()
        self.errors, self.console, self.failed = [], [], []
        self.page.on('pageerror', lambda e: self.errors.append(str(e)))
        self.page.on('console', lambda m: self.console.append(f'{m.type}: {m.text}'))
        self.sent = []
        self.page.on('websocket', lambda ws: ws.on('framesent', lambda f: self.sent.append(f if isinstance(f, str) else f.get('payload', f))))
        self.page.goto(origin + path)
        self.page.wait_for_function('window.atriumClient && window.stage && window.__lib', timeout=30000)

    def anim_sends(self):
        out = []
        for f in self.sent:
            try:
                m = json.loads(f)
            except Exception:
                continue
            if m.get('field') == 'extras.atrium.animation' or 'animation' in json.dumps(m.get('value', '')):
                out.append(m)
        return out


def err(p, name):
    return p.ev(ERR, name)


def play(p, name, clip, loop):
    """The owner's UI path: select, pick the clip, set Loop, press Play; wait for the answer."""
    select(p, name)
    p.page.select_option('#ep-anim-clip', clip); p.page.wait_for_timeout(100)
    if p.page.is_checked('#ep-anim-loop') != loop:
        p.page.click('#ep-anim-loop'); p.page.wait_for_timeout(100)
    p.page.click('#ep-anim-play')
    p.wait("(n) => atriumClient.som.getNodeByName(n).extras?.atrium?.animation?.playing === true && __anim().animationControls.waiting === 0", arg=name, timeout=10000)
    return p.ev("(n) => atriumClient.som.getNodeByName(n).extras.atrium.animation", name)


def stop(p, name):
    select(p, name)
    p.page.click('#ep-anim-stop')
    p.wait("(n) => (atriumClient.som.getNodeByName(n).extras?.atrium?.animation ?? null) === null && __anim().animationControls.waiting === 0", arg=name, timeout=10000)


def true_now_ms(p):
    return p.ev('performance.timeOrigin + performance.now()')

SAMPLES = "() => { const c = atriumClient._connectionRecord.clock; return { rtts: c.samples.map(s => +s.rtt.toFixed(1)), errMs: +(atriumClient.serverNow() - (performance.timeOrigin + performance.now())).toFixed(1) } }"


def pose_diff(p1, p2):
    """The largest coordinate difference between two poses (None if either is missing)."""
    if not p1 or not p2 or len(p1) != len(p2):
        return None
    return round(max(abs(a - b) for u, v in zip(p1, p2) for a, b in zip(u, v)), 5)


def fresh(tag):
    return f'wss://127.0.0.1:8443/w/s4a{tag}{int(time.time())}'

# Hold this page's animation sends: window.__animHold = { mode: 'reject' | 'delay', ms }.
# 'reject' answers with a stubbed server error after ms; 'delay' forwards it after ms.
ANIM_HOLD = """(() => { const P = WebSocket.prototype; const send = P.send;
  P.send = function (d) { const h = window.__animHold; let m = null; try { m = JSON.parse(d) } catch (e) {}
    if (h && m && m.type === 'send' && m.field === 'extras.atrium.animation') {
      window.__animHeld = (window.__animHeld || 0) + 1;
      if (h.mode === 'reject') { setTimeout(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'error', seq: m.seq, code: 'INVALID_VALUE', message: 'stubbed: animation refused' }) })), h.ms); return }
      setTimeout(() => send.call(this, d), h.ms); return }
    return send.call(this, d) } })()"""
