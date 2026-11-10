# grouping c4 (GR-L12 (a), g5 against the REAL server): a page whose hello
# lacks addFields (as a tab opened before the deploy sends it) is refused at
# Connect with the stale message; the same page, with the patch taken off (a
# reload), connects at level 4.
from gp import *

STALE = 'this page is older than the server: reload it'
STRIP = """() => { const send = WebSocket.prototype.send; window.__realSend = send;
  WebSocket.prototype.send = function (data) {
    try { const m = JSON.parse(data); if (m.type === 'hello' && m.capabilities) { delete m.capabilities.addFields; data = JSON.stringify(m) }
          else if (m.type === 'hello') { delete m.addFields; for (const v of Object.values(m)) if (v && typeof v === 'object') delete v.addFields; data = JSON.stringify(m) } } catch {}
    return send.call(this, data) } }"""
OVERLAY = "() => { const o = document.getElementById('overlay') || document.querySelector('[id*=overlay]'); return o ? o.textContent.trim() : null }"

with sync_playwright() as pw:
    br = launch(pw)
    k = 'c4' + key()
    p = Page(br)
    p.ev(STRIP)
    p.page.fill('#wsUrl', f'wss://127.0.0.1:8443/w/{k}')
    p.page.click('#connectBtn'); time.sleep(3)
    shown = p.ev(OVERLAY)
    print('  overlay:', repr(shown))
    check(shown == f'Connect failed: PERMISSION_DENIED: {STALE}', 'the real server refuses the stale hello at Connect, with the stale message', shown)
    check(not p.ev("() => !!atriumClient.connected"), 'the page is not connected')
    check(server_tree(k).get('crate-01', 'absent') is None and not any(n.startswith('User-') for n in server_tree(k)), 'the world holds no avatar for it')
    # the reload: the page's own hello again
    p.ev("() => { WebSocket.prototype.send = window.__realSend }")
    p.page.reload(); p.page.wait_for_function('window.atriumClient && window.stage && window.__lib', timeout=30000)
    p.connect(f'wss://127.0.0.1:8443/w/{k}'); p.edit_on(); time.sleep(1)
    check(p.ev("() => atriumClient.serverAddFields") == 4, 'reloaded, it connects at level 4', p.ev("() => atriumClient.serverAddFields"))
    select_by_click(p, 'crate-01', 'crate-01')
    press(p, 'ep-group')
    check(server_tree(k).get('crate-01') == 'group-01', 'and its edits work (Group lands)', server_tree(k).get('crate-01'))
    br.close()
done()
