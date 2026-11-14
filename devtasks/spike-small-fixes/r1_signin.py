# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
#
# small-fixes: the sign-in that isn't followed until a reconnect (SF-1).
# Runs on signin-sync/authserver.mjs (the real server, real cookies).
#   HARNESS_ROOT=/tmp/atrium-harness python3 devtasks/spike-small-fixes/r1_signin.py [--expect-fixed]
# A signed-out tab connects to a world as a guest, then signs in in that tab.
# Before the fix it stays on the guest socket (admitted anonymous, no Edit).
# After it, the tab reconnects to the SAME world as the signed-in user.
import os, sys, time, json
from playwright.sync_api import sync_playwright

A = 'https://127.0.0.1:8443'
PAGE = '/apps/client/local.html'
PW = 'correct-horse-battery-9'
FIXED = '--expect-fixed' in sys.argv
fails = []

def check(label, ok, seen=''):
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + ('' if ok else f'   (saw: {seen})'))
    if not ok: fails.append(label)

STATE = """() => {
  const c = window.atriumClient, shown = (id) => { const e = document.getElementById(id); return !!e && getComputedStyle(e).display !== 'none' }
  return { connected: !!c.connected, url: c.connected ? c._wsUrl : null, signedIn: c.signedIn ?? null, userId: c.userId ?? null,
           top: shown('auth-logged-in') ? document.getElementById('auth-user-label').textContent : null,
           edit: shown('edit-toggle-btn'), notice: document.getElementById('auth-notice').textContent }
}"""

def run(page, world_url, user, home_url):
    sockets = []
    page.on('websocket', lambda ws: sockets.append(ws.url))
    page.goto(A + PAGE); page.wait_for_function('window.atriumClient', timeout=30000); time.sleep(1.0)
    page.fill('#wsUrl', world_url); page.click('#connectBtn')
    page.wait_for_function('window.atriumClient.connected', timeout=12000); time.sleep(1.0)
    before = page.evaluate(STATE); print('    guest:  ', before)
    n0 = len(sockets)
    page.fill('#auth-username', user); page.fill('#auth-password', PW)
    if page.text_content('#auth-submit-btn') != 'Login': page.click('#auth-toggle-btn')
    page.click('#auth-submit-btn')
    page.wait_for_function("getComputedStyle(document.getElementById('auth-logged-in')).display !== 'none'", timeout=8000)
    try:
        page.wait_for_function('window.atriumClient.connected && window.atriumClient.signedIn === true', timeout=6000)
    except Exception:
        pass
    time.sleep(1.5)
    after = page.evaluate(STATE); print('    signed in:', after, 'new sockets:', sockets[n0:])
    return before, after, sockets[n0:]

with sync_playwright() as p:
    browser = p.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    setup = browser.new_context(ignore_https_errors=True); sp = setup.new_page(); sp.goto(A + PAGE)
    for u in ('alice', 'bob'):
        # register (or log in) so the home world exists, make it public (a guest can reach it), sign out
        r = sp.evaluate("""async ([u, pw]) => { let r = await fetch('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: pw }) });
          if (r.status !== 200 && r.status !== 201) r = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: pw }) });
          const ws = await (await fetch('/api/worlds')).json(); const list = Array.isArray(ws) ? ws : (ws.worlds || [])
          const home = list.find(w => w.slug === 'home')
          const put = home ? await fetch('/api/worlds/' + home.id, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ visibility: 'public' }) }) : null
          await fetch('/api/auth/logout', { method: 'POST' }); return [r.status, put && put.status] }""", [u, PW])
        print(f'account {u}: {r}')
    setup.close()

    print('\n== 1. A guest on alice\'s own home world signs in as alice')
    ctx = browser.new_context(ignore_https_errors=True, viewport={'width': 900, 'height': 600})
    before, after, new = run(ctx.new_page(), 'wss://127.0.0.1:8443/worlds/alice/home', 'alice', '/worlds/alice/home')
    check('1 the guest socket was admitted anonymous', before['signedIn'] is False, before)
    if FIXED:
        check('1 after sign-in: one new socket, to the SAME world', len(new) == 1 and new[0].rstrip('/').endswith('/worlds/alice/home'), new)
        check('1 admitted as alice, Edit offered', after['signedIn'] is True and after['edit'], after)
    else:
        check('1 (bug) after sign-in the old guest socket is kept: no new socket', new == [], new)
        check('1 (bug) still admitted anonymous, no Edit', after['signedIn'] is False and not after['edit'], after)
    ctx.close()

    print("\n== 2. A guest on bob's home world signs in as alice (stays in bob's world)")
    ctx = browser.new_context(ignore_https_errors=True, viewport={'width': 900, 'height': 600})
    before, after, new = run(ctx.new_page(), 'wss://127.0.0.1:8443/worlds/bob/home', 'alice', None)
    if FIXED:
        check("2 one new socket, to bob's world (not alice's home)", len(new) == 1 and new[0].rstrip('/').endswith('/worlds/bob/home'), new)
        check('2 admitted as alice (a visitor there: no Edit)', after['signedIn'] is True and not after['edit'], after)
    else:
        check('2 (bug) no new socket, still anonymous', new == [] and after['signedIn'] is False, (new, after))
    ctx.close()

    print('\n== 3. A signed-out tab, not connected, signs in: home world, as today')
    ctx = browser.new_context(ignore_https_errors=True, viewport={'width': 900, 'height': 600})
    pg = ctx.new_page(); socks = []; pg.on('websocket', lambda ws: socks.append(ws.url))
    pg.goto(A + PAGE); pg.wait_for_function('window.atriumClient', timeout=30000); time.sleep(1.0)
    pg.fill('#auth-username', 'alice'); pg.fill('#auth-password', PW)
    if pg.text_content('#auth-submit-btn') != 'Login': pg.click('#auth-toggle-btn')
    pg.click('#auth-submit-btn')
    try: pg.wait_for_function("window.atriumClient.connected && window.atriumClient.signedIn === true", timeout=10000)
    except Exception: pass
    s = pg.evaluate(STATE); print('   ', s, socks)
    check("3 connected to alice's home as alice, Edit offered", s['url'] and s['url'].rstrip('/').endswith('/worlds/alice/home') and s['signedIn'] is True and s['edit'], s)
    ctx.close()
    browser.close()

print('\nRESULT:', 'FAIL ' + str(fails) if fails else 'all PASS')
sys.exit(1 if fails else 0)
