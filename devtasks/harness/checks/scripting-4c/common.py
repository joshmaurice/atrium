# scripting-4c §6.1 — shared helpers. Builds on scripting-4b-2/rt.py's helpers (templates written with
# the product's own templateGraph through client.sendField; real mouse clicks on the canvas).
import sys, os, time, json
_here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_here, '..', '..')); sys.path.insert(0, os.path.join(_here, '..', 'scripting-4a'))
from anim import *

LEAF = 'extras.atrium.behavior'
TPL = """async ({ id, params, own }) => { const m = await import('@atrium/behaviors/templates'); return m.templateGraph(id, params, { ownId: own }) }"""
OID = """(n) => atriumClient.som.getNodeByName(n)?.extras?.atrium?.objectId ?? null"""
SEND = """({ name, field, value }) => new Promise((res) => { const c = atriumClient; const seq = c.sendField(name, field, value);
  const done = (k) => (d) => { if (d.seq === seq) { c.off?.('edit:accepted', ok); c.off?.('edit:rejected', bad); res({ k, code: d.code ?? null, message: d.message ?? null }) } };
  const ok = done('accepted'), bad = done('rejected'); c.on('edit:accepted', ok); c.on('edit:rejected', bad); setTimeout(() => res({ k: 'timeout' }), 5000) })"""
SETID = """(name) => new Promise((res) => { const c = atriumClient; const id = crypto.randomUUID(); const seq = c.setObjectId(name, id);
  const f = (d) => { if (d.seq === seq) res(id) }; c.on('edit:accepted', f); c.on('edit:rejected', () => res(null)); setTimeout(() => res(null), 5000) })"""
MOVE = """({ name, t }) => { atriumClient.som.getNodeByName(name).translation = t }"""
VIS = """(n) => { const s = atriumClient.som.getNodeByName(n); const o = stage.scene.getObjectByName(n);
  return { som: s ? s.visible : null, obj: o ? o.visible : null } }"""
ANIMV = """(n) => { const a = atriumClient.som.getNodeByName(n)?.extras?.atrium?.animation; return a ? { clip: a.clip, playing: a.playing } : a }"""
RUN = """() => { const r = __beh().runner; return { enabled: r.enabled, log: r.log.slice(-6).map(l => l.node + ': ' + l.message) } }"""
HOST = "() => ({ ...atriumClient.scriptHost })"
NOTICE = "() => { const e = document.getElementById('activate-notice'); return e && e.style.display !== 'none' ? e.textContent : '' }"
PICK = """(name) => { const o = stage.scene.getObjectByName(name); if (!o) return null; o.updateWorldMatrix(true, true);
  const p = new o.position.constructor(); o.getWorldPosition(p); const v = p.clone().project(stage.camera);
  const el = stage.renderer?.domElement ?? document.querySelector('canvas'); const r = el.getBoundingClientRect();
  return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height, on: Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && v.z < 1 } }"""


def wslog(page, hold=None):
    """Record every message both ways on this page's world socket: [(dir, parsed-json)].
    hold: a dict; while hold['on'], server->page messages from the first `som-dump` on are queued
    in hold['q'] (in order), and release(hold) delivers them. That is a slow world load the script controls."""
    log = []
    def route(ws):
        server = ws.connect_to_server()
        def up(m):
            try: log.append(('>', json.loads(m)))
            except Exception: log.append(('>', m))
            server.send(m)
        def down(m):
            try: j = json.loads(m)
            except Exception: j = m
            log.append(('<', j))
            if hold is not None and hold.get('on') and (hold['q'] or (isinstance(j, dict) and j.get('type') == 'som-dump')):
                hold['q'].append((ws, m)); return
            ws.send(m)
        ws.on_message(up); server.on_message(down)
    page.route_web_socket(lambda u: True, route)
    return log


def of(log, t, d=None):
    return [m for (dd, m) in log if isinstance(m, dict) and m.get('type') == t and (d is None or dd == d)]


def edit_off(p):
    if p.ev("getComputedStyle(document.getElementById('edit-panel')).display !== 'none'"):
        p.page.click('#edit-toggle-btn'); p.page.wait_for_timeout(300)


def add_cube(p):
    before = set(p.ev("atriumClient.som.nodes.map(n => n.name)"))
    p.page.click('button[data-kind=cube]'); p.page.wait_for_timeout(700)
    new = [n for n in p.ev("atriumClient.som.nodes.map(n => n.name)") if n not in before]
    return new[0] if new else None


def click_node(p, name, dx=0):
    at = p.ev(PICK, name)
    if not at or not at['on']:
        return {'clicked': False, 'at': at}
    p.page.mouse.click(at['x'] + dx, at['y'])
    p.page.wait_for_timeout(700)
    return {'clicked': True}


def behave(p, name, tid, params):
    own = p.ev(OID, name) or p.ev(SETID, name)
    if params.get('target') and params['target'].count('-') != 4:
        params['target'] = p.ev(OID, params['target']) or p.ev(SETID, params['target'])
    value = p.ev(TPL, {'id': tid, 'params': params, 'own': own})
    r = p.ev(SEND, {'name': name, 'field': LEAF, 'value': value})
    p.page.wait_for_timeout(500)
    return r


def hello(p):
    h = of(p.ws, 'hello', '>')
    return h[-1].get('capabilities') if h else None

# What the app's own pick resolves at a node's on-screen point (the hit, and the node a click acts on).
def pick_at(p, name):
    at = p.ev(PICK, name)
    return p.ev("([x, y]) => __beh().pick(x, y)", [at['x'], at['y']]) if at and at['on'] else None

# Record the host runner's select outcomes.
SPY = """() => { const r = __beh().runner; if (r.__spied) return; r.__spied = true; window.__sel = []; const o = r.select.bind(r);
  r.select = (h, ...rest) => { const out = o(h, ...rest); window.__sel.push([h?.name ?? null, out]); return out } }"""
# The centre of a node's rendered bounds, projected (for models, whose origin is at their feet).
BOXPICK = """(name) => { const o = stage.scene.getObjectByName(name); if (!o) return null; o.updateWorldMatrix(true, true);
  const B = stage.scene.constructor; let min = [1e9,1e9,1e9], max = [-1e9,-1e9,-1e9];
  o.traverse(c => { if (c.isMesh) { c.geometry.computeBoundingBox?.(); const b = c.geometry.boundingBox; if (!b) return;
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
      const v = b.min.clone().set(x, y, z).applyMatrix4(c.matrixWorld); [v.x, v.y, v.z].forEach((q, i) => { min[i] = Math.min(min[i], q); max[i] = Math.max(max[i], q) }) } } });
  const ctr = b => b; const v = new o.position.constructor((min[0]+max[0])/2, (min[1]+max[1])/2, (min[2]+max[2])/2); const w = v.clone();
  v.project(stage.camera); const r = (stage.renderer?.domElement ?? document.querySelector('canvas')).getBoundingClientRect();
  return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height, on: Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && v.z < 1, centre: [w.x, w.y, w.z].map(q => +q.toFixed(2)) } }"""

# ---- the real sign-in (checks/signin-sync/authserver.mjs with HOOKS=1, on :8443/:8444) ----
PW = 'correct-horse-battery-9'
PAGE = '/apps/client/local.html'
HOME = 'wss://127.0.0.1:8443/worlds/alice/home'


def register(browser, users=('alice',)):
    ctx = browser.new_context(ignore_https_errors=True); sp = ctx.new_page(); sp.goto(A + PAGE)
    out = {u: sp.evaluate("""async ([u, pw]) => { const r = await fetch('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: u, password: pw }) }); await fetch('/api/auth/logout', { method: 'POST' }); return r.status }""", [u, PW]) for u in users}
    ctx.close(); return out


class Tab:
    """One browser tab in a given context; its world socket is recorded (self.ws)."""
    def __init__(self, ctx, name, origin=A, path=PAGE, init=None, hold=None):
        self.name = name; self.ctx = ctx
        self.page = ctx.new_page(); self.errors = []; self.console = []
        self.page.on('pageerror', lambda e: self.errors.append(str(e)))
        self.page.on('console', lambda m: self.console.append(f'{m.type}: {m.text}'))
        if init: self.page.add_init_script(init)
        self.ws = wslog(self.page, hold)
        self.page.goto(origin + path)
        self.page.wait_for_function('window.atriumClient && window.stage', timeout=30000)
        time.sleep(1.0)

    def ev(self, js, arg=None): return self.page.evaluate(js, arg)

    def wait(self, js, timeout=30000, arg=None):
        try: self.page.wait_for_function(js, arg=arg, timeout=timeout); return True
        except Exception: return False

    def wait_world(self, part='/worlds/alice/home', timeout=20000):
        return self.wait(f"(p) => atriumClient.connected && (atriumClient._wsUrl || '').includes(p) && atriumClient.som", timeout=timeout, arg=part)

    def login(self, user='alice'):
        self.page.fill('#auth-username', user); self.page.fill('#auth-password', PW)
        if self.page.text_content('#auth-submit-btn') != 'Login': self.page.click('#auth-toggle-btn')
        self.page.click('#auth-submit-btn')
        return self.wait("getComputedStyle(document.getElementById('auth-logged-in')).display !== 'none'", timeout=8000)

    def connect(self, url=HOME):
        if self.ev('atriumClient.connected'):          # the button reads Disconnect: leave first
            self.page.click('#connectBtn'); self.wait('!atriumClient.connected', timeout=8000); time.sleep(0.5)
        self.page.fill('#wsUrl', url); self.page.click('#connectBtn')
        ok = self.wait("(u) => atriumClient.connected && atriumClient._wsUrl === u && atriumClient.som", arg=url, timeout=20000)
        time.sleep(0.8); return ok

    def edit_on(self):
        if not self.ev("getComputedStyle(document.getElementById('edit-panel')).display !== 'none'"):
            self.page.click('#edit-toggle-btn')
        self.wait("getComputedStyle(document.getElementById('edit-panel')).display !== 'none'", timeout=5000)

    def close(self): self.page.close()


def owner_tab(ctx, name, first=False, hold=None):
    """alice's tab. A signed-in tab first auto-connects to her home world: wait for that, so a later
    connect() to another world isn't overtaken by it."""
    t = Tab(ctx, name, hold=hold)
    if first: t.login('alice')
    t.wait_world(); time.sleep(0.8)
    return t


def click_at(p, at):
    if not at or not at['on']: return {'clicked': False, 'at': at}
    p.page.mouse.click(at['x'], at['y']); p.page.wait_for_timeout(700); return {'clicked': True}


def click_box(p, name):
    """Click the centre of a node's rendered bounds (models: their origin is at their feet)."""
    return click_at(p, p.ev(BOXPICK, name))


def walk(p, key, ms):
    """Hold a movement key in this tab's viewport (it gets focus from a click on empty sky first)."""
    p.page.mouse.click(1100, 160)
    p.page.keyboard.down(key); p.page.wait_for_timeout(ms); p.page.keyboard.up(key); p.page.wait_for_timeout(900)


def avatar(p): return p.ev('__beh().avatarPos')


def dist(a, b): return round(sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5, 2)


def sent(p, t): return len(of(p.ws, t, '>'))
def got(p, t): return len(of(p.ws, t, '<'))


fails = []
def check(label, ok, seen=''):
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + ('' if ok else f'   (saw: {seen})'))
    if not ok: fails.append(label)


def make_public(t, slug='home'):
    """The owner makes a world public (what the world browser's visibility toggle sends)."""
    return t.ev("""async (slug) => { const ws = await (await fetch('/api/worlds')).json(); const w = ws.find(x => x.slug === slug);
      const r = await fetch('/api/worlds/' + w.id, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ visibility: 'public' }) });
      return [r.status, w.id] }""", slug)


def new_world(t, tag):
    """A fresh public world of alice's for this run; returns its world URL."""
    slug = f'{tag}-{int(time.time())}'
    st = t.ev("""async (slug) => (await fetch('/api/worlds', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug }) })).status""", slug)
    print('   new world', slug, st, '| public', make_public(t, slug))
    return f'wss://127.0.0.1:8443/worlds/alice/{slug}'


def release(hold):
    hold['on'] = False
    for ws, m in hold['q']: ws.send(m)
    n = len(hold['q']); hold['q'].clear(); return n


SKY = """() => { for (let y = 180; y < 720; y += 40) for (const x of [1150, 1000, 200, 1220, 80, 900, 380]) {
    const e = document.elementFromPoint(x, y); if (e?.tagName === 'CANVAS' && !__beh().pick(x, y)) return [x, y] } return null }"""


def sky_point(t):
    """A point on the canvas, over empty sky, in this tab (owner tabs have the world list over the top band)."""
    return t.ev(SKY)
