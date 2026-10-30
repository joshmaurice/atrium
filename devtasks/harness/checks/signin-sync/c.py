# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
#
# signin-sync §6.7 browser checks 1-6 and 8, against authserver.mjs (the REAL
# server and DB behind https://127.0.0.1:8443 and :8444).
#   HARNESS_ROOT=/tmp/ah python3 devtasks/harness/checks/signin-sync/c.py
#
# Tabs that share one browser context share the cookie and BroadcastChannel,
# as a browser's tabs do. Each check prints what it saw and PASS/FAIL against
# the pre-brief's expectation; the script exits 1 on any FAIL.
import os, sys, time, sqlite3, json
from datetime import datetime, timedelta, timezone
from playwright.sync_api import sync_playwright

ROOT = os.environ.get('HARNESS_ROOT', '/tmp/atrium-harness')
DB = os.environ.get('AUTH_DB', ROOT + '/auth.db')
A = 'https://127.0.0.1:8443'
B = 'https://127.0.0.1:8444'
PAGE = '/apps/client/local.html'
PW = 'correct-horse-battery-9'
fails = []

def check(label, ok, seen=''):
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + ('' if ok else f'   (saw: {seen})'))
    if not ok: fails.append(label)

def db():
    c = sqlite3.connect(DB, timeout=5); c.row_factory = sqlite3.Row; return c

def uid(name):
    with db() as c: return c.execute('SELECT id FROM users WHERE username = ?', (name,)).fetchone()['id']

# Blocks a tab's BroadcastChannel and/or its visibilitychange listeners.
BLOCK_BC = "window.BroadcastChannel = class { constructor(){} postMessage(){} close(){} addEventListener(){} removeEventListener(){} set onmessage(f){} }"
BLOCK_VIS = "window.addEventListener('visibilitychange', (e) => { if (window.__blockVis !== false) e.stopImmediatePropagation() }, true)"

class Tab:
    def __init__(self, ctx, name, origin=A, block_bc=False, block_vis=False, route_me=None):
        self.name = name
        self.page = ctx.new_page()
        self.sockets = []          # every WebSocket URL this tab opened
        self.errors = []
        self.page.on('websocket', lambda ws: self.sockets.append(ws.url))
        self.page.on('pageerror', lambda e: self.errors.append(str(e)))
        if block_bc: self.page.add_init_script(BLOCK_BC)
        if block_vis: self.page.add_init_script(BLOCK_VIS)
        if route_me: self.page.route('**/api/auth/me', route_me)
        self.page.goto(origin + PAGE)
        self.page.wait_for_function('window.atriumClient', timeout=30000)
        time.sleep(1.0)

    def ev(self, js, arg=None): return self.page.evaluate(js, arg)

    def state(self):
        return self.ev("""() => {
          const shown = (id) => { const e = document.getElementById(id); return e && getComputedStyle(e).display !== 'none' }
          const c = window.atriumClient
          return {
            top: shown('auth-logged-in') ? document.getElementById('auth-user-label').textContent : null,
            notice: document.getElementById('auth-notice').textContent,
            you: document.getElementById('hud-you').textContent,
            connected: !!c.connected,
            url: c.connected ? c._wsUrl : null,
            worlds: [...document.querySelectorAll('#wb-list .wb-meta')].map(e => e.textContent.split(' ')[0]),
            button: document.getElementById('connectBtn').textContent + (document.getElementById('connectBtn').disabled ? ' (disabled)' : ''),
          }
        }""")

    def wait(self, js, timeout=8000):
        try:
            self.page.wait_for_function(js, timeout=timeout); return True
        except Exception:
            return False

    def wait_connected(self, path_part, timeout=12000):
        return self.wait(f"window.atriumClient.connected && (window.atriumClient._wsUrl || '').includes({json.dumps(path_part)})", timeout)

    def login(self, user):
        self.page.fill('#auth-username', user); self.page.fill('#auth-password', PW)
        if self.page.text_content('#auth-submit-btn') != 'Login': self.page.click('#auth-toggle-btn')
        self.page.click('#auth-submit-btn')
        self.wait("getComputedStyle(document.getElementById('auth-logged-in')).display !== 'none'")

    def logout(self):
        self.page.click('#auth-logout-btn')
        self.wait("getComputedStyle(document.getElementById('auth-logged-out')).display !== 'none'")

    def hide_show(self):
        """The tab goes to the background and comes back (visibilitychange twice)."""
        self.ev("""() => {
          for (const v of ['hidden', 'visible']) {
            Object.defineProperty(document, 'visibilityState', { value: v, configurable: true })
            Object.defineProperty(document, 'hidden', { value: v === 'hidden', configurable: true })
            document.dispatchEvent(new Event('visibilitychange'))
          }
        }""")

    def disconnect(self):
        if self.ev('window.atriumClient.connected'):
            self.page.click('#connectBtn')
            self.wait('!window.atriumClient.connected')

def show(tab):
    s = tab.state()
    print(f"    {tab.name}: top={s['top']!r} you={s['you']!r} connected={s['connected']} url={s['url']} button={s['button']!r} notice={s['notice']!r}")
    return s

with sync_playwright() as p:
    browser = p.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])

    # Accounts: alice and bob, registered in a throwaway context.
    setup = browser.new_context(ignore_https_errors=True)
    sp = setup.new_page(); sp.goto(A + PAGE)
    for u in ('alice', 'bob'):
        r = sp.evaluate("""async ([u, pw]) => { const r = await fetch('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: pw }) }); await fetch('/api/auth/logout', { method: 'POST' }); return r.status }""", [u, PW])
        print(f'register {u}: {r}')
    setup.close()

    # ---------------------------------------------------------------- check 1
    print('\n== 1. Tab B signs out: tab A gets SIGNED_OUT and shows signed-out')
    ctx = browser.new_context(ignore_https_errors=True, viewport={'width': 900, 'height': 600})
    ta = Tab(ctx, 'A'); ta.login('alice'); ta.wait_connected('/worlds/alice/home'); show(ta)
    tb = Tab(ctx, 'B'); tb.wait_connected('/worlds/alice/home'); show(tb)
    tb.logout()
    ok = ta.wait("!window.atriumClient.connected && getComputedStyle(document.getElementById('auth-logged-out')).display !== 'none'")
    s = show(ta)
    check('1a tab A signed out and disconnected', ok and s['top'] is None and not s['connected'], s)
    check('1a tab A notice "You were signed out in another tab."', s['notice'] == 'You were signed out in another tab.', s['notice'])
    tb_s = show(tb)
    check('1a tab B (signed itself out) shows no notice', tb_s['notice'] == '', tb_s['notice'])
    # 1b: tab A hidden during the logout, then made visible
    ta.login('alice'); ta.wait_connected('/worlds/alice/home'); tb.page.reload(); tb.page.wait_for_function('window.atriumClient'); tb.wait_connected('/worlds/alice/home')
    ta.ev("() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')) }")
    tb.logout(); time.sleep(1.5)
    ta.ev("() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')) }")
    time.sleep(1.0); s = show(ta)
    check('1b hidden tab A shows signed-out, disconnected, once visible', s['top'] is None and not s['connected'], s)
    ctx.close()

    # ---------------------------------------------------------------- check 2
    print('\n== 2. Tab B signs out, then in as bob; tab A (broadcast blocked) follows')
    ctx = browser.new_context(ignore_https_errors=True, viewport={'width': 900, 'height': 600})
    ta = Tab(ctx, 'A', block_bc=True); ta.login('alice'); ta.wait_connected('/worlds/alice/home'); show(ta)
    tb = Tab(ctx, 'B'); tb.logout(); time.sleep(1.0)
    print('   after B signs out:'); show(ta)
    tb.login('bob'); time.sleep(1.0)
    print('   after B signs in as bob (A hears nothing: its broadcast is blocked):'); show(ta)
    ta.hide_show()
    ok = ta.wait_connected('/worlds/bob/home')
    s = show(ta)
    check('2 tab A switches to bob and autoconnects to bob\'s home', ok and s['top'] == 'bob', s)
    check('2 top bar and viewport agree', s['top'] and s['you'] == f"You: {s['top']}", s)
    check('2 notice names bob', s['notice'] == "You're signed in as bob now (the sign-in changed in another tab).", s['notice'])
    ctx.close()

    # ---------------------------------------------------------------- check 3
    print('\n== 3. A stale, disconnected tab: Load and Connect make no connect')
    ctx = browser.new_context(ignore_https_errors=True, viewport={'width': 900, 'height': 600})
    ta = Tab(ctx, 'A', block_bc=True, block_vis=True); ta.login('alice'); ta.wait_connected('/worlds/alice/home')
    ta.wait("document.querySelectorAll('#wb-list .wb-item').length > 0"); ta.disconnect()
    print('   A, disconnected, list:', ta.state()['worlds'])
    tb = Tab(ctx, 'B'); tb.logout(); tb.login('bob'); tb.disconnect(); time.sleep(0.5)
    n0 = len(ta.sockets)
    ta.page.click('#wb-list .wb-item button:has-text("Load")')
    time.sleep(2.0); s = show(ta)
    new = ta.sockets[n0:]
    check('3a Load of an alice world makes no connect as alice', not any('/worlds/alice/' in u for u in new), new)
    check('3a notice names bob, top bar bob', s['top'] == 'bob' and 'bob' in s['notice'], s)
    check('3a the Connect button is usable afterwards (not stuck on Connecting)', 'disabled' not in s['button'], s['button'])
    check("3a the list is bob's", s['worlds'] and all(w for w in s['worlds']) and ta.wait("[...document.querySelectorAll('#wb-list .wb-meta')].length > 0", 3000), s['worlds'])
    # a stale tab again (A believes bob, the cookie is alice's), then Connect.
    # A is reloaded first so a stuck Connect button from 3a can't mask 3b
    # (its init scripts, blocking broadcast and visibility, stay in force).
    ta.page.reload(); ta.page.wait_for_function('window.atriumClient'); time.sleep(1.0); ta.wait_connected('/worlds/bob/home'); ta.disconnect(); tb.logout(); tb.login('alice'); tb.disconnect(); time.sleep(0.5)
    ta.page.fill('#wsUrl', 'wss://127.0.0.1:8443/')
    n0 = len(ta.sockets); ta.page.click('#connectBtn'); time.sleep(2.0); s = show(ta)
    new = ta.sockets[n0:]
    check('3b Connect from a stale tab makes no connect to the typed URL', not any(u.rstrip('/') == 'wss://127.0.0.1:8443' for u in new), new)
    check('3b notice names alice, top bar alice', s['top'] == 'alice' and 'alice' in s['notice'], s)
    check('3b the tab ends connected to alice\'s home (I4 step 4)', ta.wait_connected('/worlds/alice/home', 6000), show(ta))
    ctx.close()

    # ---------------------------------------------------------------- check 4
    print('\n== 4. Expiry: a visible tab that shows a user makes no anonymous connect')
    ctx = browser.new_context(ignore_https_errors=True, viewport={'width': 900, 'height': 600})
    ta = Tab(ctx, 'A'); ta.login('alice'); ta.wait_connected('/worlds/alice/home'); ta.disconnect()
    with db() as c: c.execute("UPDATE auth_sessions SET expires_at = '2000-01-01T00:00:00.000Z'")
    ta.page.fill('#wsUrl', 'wss://127.0.0.1:8443/')
    n0 = len(ta.sockets); ta.page.click('#connectBtn'); time.sleep(2.0); s = show(ta)
    check('4 no connect after expiry', not ta.sockets[n0:], ta.sockets[n0:])
    check('4 the Connect button is usable afterwards', 'disabled' not in s['button'], s['button'])
    check('4 signed out with the expired notice', s['top'] is None and s['notice'] == 'Your sign-in expired. Sign in again to edit your worlds.', s)
    ctx.close()

    # ---------------------------------------------------------------- check 5
    print("\n== 5. The backstop: /api/auth/me stuck on alice while the cookie is bob's")
    ctx = browser.new_context(ignore_https_errors=True, viewport={'width': 900, 'height': 600})
    alice = {'id': uid('alice'), 'username': 'alice', 'displayName': 'alice'}
    tb = Tab(ctx, 'B'); tb.login('bob'); tb.disconnect()
    stub = lambda route: route.fulfill(status=200, content_type='application/json', body=json.dumps(alice))
    ta = Tab(ctx, 'A', block_bc=True, route_me=stub); ta.wait_connected('/worlds/alice/home', 4000); ta.disconnect()
    print('   A before connect:'); show(ta)
    ta.page.fill('#wsUrl', 'wss://127.0.0.1:8443/'); ta.page.click('#connectBtn')
    ta.wait("document.getElementById('auth-notice').textContent.includes('Reload')", 6000)
    s = show(ta)
    check('5 "Reload the page" backstop notice', s['notice'] == 'This world admitted you as bob, but the page says alice. Reload the page.', s['notice'])
    ctx.close()

    # ---------------------------------------------------------------- check 6
    print('\n== 6. Cross-origin: no comparison, no notice, no disconnect; hello anonymous')
    ctx = browser.new_context(ignore_https_errors=True, viewport={'width': 900, 'height': 600})
    ta = Tab(ctx, 'A'); ta.login('alice'); ta.wait_connected('/worlds/alice/home')
    hello = []
    ta.page.on('websocket', lambda ws: ws.on('framereceived', lambda f: hello.append(f) if isinstance(f, str) and '"type":"hello"' in f else None))
    ta.disconnect()   # Connect while connected is Disconnect: disconnect first
    ta.page.fill('#wsUrl', 'wss://127.0.0.1:8444/'); ta.page.click('#connectBtn')
    ok = ta.wait_connected('8444')
    time.sleep(1.5); s = show(ta)
    h = json.loads(hello[-1]) if hello else {}
    check('6 connected cross-origin, still alice in the top bar, no notice', ok and s['top'] == 'alice' and s['notice'] == '', s)
    check('6 the cross-origin hello says signedIn: false', h.get('signedIn') is False and 'userId' not in h, h)
    ctx.close()

    # ---------------------------------------------------------------- check 8
    print('\n== 8. Same account: tab B signs out and back in as alice')
    ctx = browser.new_context(ignore_https_errors=True, viewport={'width': 900, 'height': 600})
    ta = Tab(ctx, 'A'); ta.login('alice'); ta.wait_connected('/worlds/alice/home')
    tb = Tab(ctx, 'B'); tb.logout(); tb.login('alice')
    ok = ta.wait_connected('/worlds/alice/home', 12000); time.sleep(1.0)
    s = show(ta)
    check('8 tab A ends connected to alice\'s home with alice in the top bar', ok and s['top'] == 'alice' and s['you'] == 'You: alice', s)
    print(f"    (notice seen: {s['notice']!r})")
    ctx.close()

    browser.close()

print('\nserver log lines (I7):')
import urllib.request, ssl
cx = ssl.create_default_context(); cx.check_hostname = False; cx.verify_mode = ssl.CERT_NONE
for line in urllib.request.urlopen(A + '/__log', context=cx).read().decode().splitlines():
    if line.startswith('[auth]') or line.startswith('[session] hello'): print('  ', line)
print('\n' + (f'{len(fails)} FAIL: ' + '; '.join(fails) if fails else 'all PASS'))
sys.exit(1 if fails else 0)
