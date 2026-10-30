# scripting-4c §6.1 checks 13 (an older server, cross-origin; Rev 1.2 M1) and 10 (a stale owner tab, S2).
# The 4c REAL server: authserver.mjs HOOKS=1 STALE_ROOT=/tmp/ah-base on :8443 (HARNESS_ROOT=/tmp/atrium-harness, code a02c2429).
# The BASE real server: authserver.mjs on :8447 (HARNESS_ROOT=/tmp/ah-base, code 71b6e40b = ab02239b's).
import urllib.request, ssl
from common import *
OLD = 'https://127.0.0.1:8447'
NOHOST = "Nothing happens: this world's owner isn't here right now."
CX = ssl.create_default_context(); CX.check_hostname = False; CX.verify_mode = ssl.CERT_NONE

def old_log():
    return urllib.request.urlopen(OLD + '/__log', context=CX).read().decode()

def stale_files(page):
    """This tab's page files come from the BASE checkout, on the same origin: the 4c test server serves
    STALE_ROOT's files to a request carrying `x-harness-tree: stale` (a tab loaded before the deploy).
    /api and the world socket are the 4c server's."""
    page.set_extra_http_headers({'x-harness-tree': 'stale'})

with sync_playwright() as pw:
    br = new_browser(pw); print('register', register(br))
    octx = br.new_context(ignore_https_errors=True, viewport={'width': 1280, 'height': 800})
    vctx = br.new_context(ignore_https_errors=True, viewport={'width': 1280, 'height': 800})
    a = owner_tab(octx, 'A', first=True); W = new_world(a, 'c3'); a.connect(W)
    v = Tab(vctx, 'V'); v.connect(W)
    a.edit_on(); x = add_cube(a); y = add_cube(a)
    a.ev(MOVE, {'name': x, 't': [0, 0.5, -3]}); a.ev(MOVE, {'name': y, 't': [-2.5, 0.5, -2]})
    print('write', behave(a, x, 'select-visibility', {'target': y, 'action': 'toggle'})); edit_off(a)
    check('setup: A hosts W with scriptRunner 2', a.ev(HOST)['active'] and hello(a).get('scriptRunner') == 2, (a.ev(HOST), hello(a)))

    print('\n== 13. an older server, cross-origin, through the address bar')
    t = owner_tab(octx, 'T'); print('   T (a 4c tab of alice) starts in', t.ev('atriumClient._wsUrl'), '| its hello', hello(t))
    log0 = len(old_log())
    ok = t.connect('wss://127.0.0.1:8447/')
    h = of(t.ws, 'hello', '>')[-1]; tail = old_log()[log0:]
    print('   connected', ok, '| url', t.ev('atriumClient._wsUrl'), '| canEdit', t.ev('atriumClient.canEdit'), '| sent hello', h)
    print('   the old server logged:', [l for l in tail.splitlines() if 'hello' in l or 'error' in l.lower()][-3:])
    check('13 it connects to the older server', ok and t.ev('atriumClient.connected'), t.ev('[atriumClient.connected, atriumClient._wsUrl]'))
    check('13 the page sent a hello with NO scriptRunner key', 'scriptRunner' not in (h.get('capabilities') or {}), h)
    check("13 the old server accepted it, as anonymous", ('hello ' + h['id'][:8] + ' as anonymous') in tail, tail[-300:])
    check('13 as a visitor there (canEdit false)', t.ev('atriumClient.canEdit') is False)
    t.connect(W); th = of(t.ws, 'hello', '>')[-1]
    check('13 back on the 4c origin: its hello has scriptRunner 2, and A is still the host', (th.get('capabilities') or {}).get('scriptRunner') == 2 and a.ev(HOST)['active'] is True and t.ev(HOST)['active'] is False, (th, a.ev(HOST), t.ev(HOST)))

    print('\n== 10. a stale owner tab (base page, scriptRunner 1) is the only owner tab')
    t.page.close(); a.page.close(); v.page.wait_for_timeout(1500)
    sp = octx.new_page(); stale_files(sp)
    s = Tab.__new__(Tab); s.name = 'S'; s.ctx = octx; s.page = sp; s.errors = []; s.console = []
    sp.on('pageerror', lambda e: s.errors.append(str(e))); s.ws = wslog(sp)
    sp.goto(A + PAGE); sp.wait_for_function('window.atriumClient && window.stage', timeout=30000); time.sleep(1)
    s.wait_world(); time.sleep(0.8)
    base_page = sp.evaluate("async () => (await (await fetch('/packages/protocol/src/schemas/hello.client.json')).text()).includes('\"const\": 1')")
    print('   S page is the base code:', base_page, '| __beh hook (4c harness only):', sp.evaluate("typeof window.__beh"))
    print('   S before connect', s.ev('[atriumClient.connected, atriumClient._wsUrl]'), '| ws log', len(s.ws), '| errors', s.errors[:2])
    sp.on('console', lambda m: s.console.append(m.type + ': ' + m.text))
    print('   connect', s.connect(W), s.ev('[atriumClient.connected, atriumClient._wsUrl]'), '| ws log', [(d, m.get('type') if isinstance(m, dict) else str(m)[:40]) for d, m in s.ws][:6])
    print('   S console', [c[:160] for c in s.console if 'GL Driver' not in c][-6:])
    sh = (of(s.ws, 'hello', '>') or [{}])[-1]
    print('   S in', s.ev('atriumClient._wsUrl'), '| hello caps', sh.get('capabilities'), '| canEdit', s.ev('atriumClient.canEdit'), '| scriptHost', s.ev('atriumClient.scriptHost'))
    check('10 the stale tab is signed in and connected, with scriptRunner 1', s.ev('atriumClient.canEdit') is True and (sh.get('capabilities') or {}).get('scriptRunner') == 1, sh)
    check('10 it is not the host', not (s.ev('atriumClient.scriptHost') or {}).get('active'), s.ev('atriumClient.scriptHost'))
    b = v.ev(VIS, y)['obj']; click_node(v, x); nt = v.ev(NOTICE)
    check("10 a visitor's click: the \"isn't here right now\" notice, nothing runs", nt == NOHOST and v.ev(VIS, y)['obj'] is b, (nt, v.ev(VIS, y)))
    a6 = owner_tab(octx, 'A6'); a6.connect(W); a6.wait("() => __beh().runner.engines.size > 0", timeout=20000); a6.page.wait_for_timeout(600)
    check('10 a 4c owner tab opens: it becomes the host', a6.ev(HOST)['active'] is True, a6.ev(HOST))
    b = v.ev(VIS, y)['obj']; click_node(v, x); v.page.wait_for_timeout(800)
    check("10 and the visitor's next click works", v.ev(VIS, y)['obj'] is (not b) and a6.ev(VIS, y)['obj'] is (not b), (b, v.ev(VIS, y), v.ev(NOTICE)))
    print('\npage errors: S', s.errors[:3], '| V', v.errors[:3], '| A6', a6.errors[:3])
    br.close()
print('\nFAILS:', fails or 'none'); sys.exit(1 if fails else 0)
