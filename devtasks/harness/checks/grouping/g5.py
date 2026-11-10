# grouping g5 (PREBRIEF-grouping.md GR-L12 (a), the pre-contract probe, lesson
# 1): what the RELEASED page (172b816) shows when the server refuses its hello
# the way GR-L12 (a) would. Playwright sits between the page and the real world
# server; it passes the page's hello on, and replaces the server's `hello`
# answer with `error` (PERMISSION_DENIED, the stale message) and a close, as
# `WORLD_FULL` is sent today (session.js L779-782). The route plays the server:
# it answers the page's hello itself.
import json
from sp import *

STALE = 'this page is older than the server: reload it'

def routes(page):
    # The refusal comes at the hello, before the server sends anything, so the
    # route answers the page's hello itself, as the server would (a pass-through
    # to the harness server fails on its self-signed certificate).
    def handler(ws):
        def from_page(m):
            try:
                t = json.loads(m).get('type')
            except Exception:
                t = None
            if t == 'hello':
                ws.send(json.dumps({'type': 'error', 'code': 'PERMISSION_DENIED', 'message': STALE}))
                ws.close()
        ws.on_message(from_page)
    page.route_web_socket('**/w/**', handler)

with sync_playwright() as pw:
    br = launch(pw)
    k = 'g5' + key()
    p = Page(br, ws_routes=routes)
    p.page.fill('#wsUrl', f'wss://127.0.0.1:8443/w/{k}')
    p.page.click('#connectBtn'); time.sleep(3)
    shown = p.ev("() => { const o = document.getElementById('overlay') || document.querySelector('[id*=overlay]'); return o ? o.textContent.trim() : null }")
    print('  overlay:', repr(shown))
    print('  connected:', p.ev("() => !!(window.atriumClient && atriumClient.connected)"))
    print('  connect button:', repr(p.ev("() => document.getElementById('connectBtn').textContent")))
    check(shown is not None and STALE in shown, 'the released page shows the refusal with the stale text', shown)
    check(shown is not None and shown.startswith('Connect failed'), 'it reads as a Connect failure', shown)
    check(not p.ev("() => !!(window.atriumClient && atriumClient.connected)"), 'the page is not connected')
    print('  page errors:', p.errors)
    br.close()
done()
