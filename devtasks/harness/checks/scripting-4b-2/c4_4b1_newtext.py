# scripting-4b-1 §5.1 checks 4, 5 and 6 (PREBRIEF-scripting-4b.md):
# 4 two owner tabs: host line text, the handover on close, a reopened tab stays non-host;
# 5 supersession: the host tab switches worlds, `script-host:changed` active:false fires
#   before `connecting`, and the other owner tab becomes host;
# 6 a visitor sees no host line and its `hello` has scriptHost:false and no hostGen.
import sys, os, json, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripting-4a'))
from anim import *

T = str(int(time.time()))
W = 'wss://127.0.0.1:8443/w/host' + T
W2 = 'wss://127.0.0.1:8443/w/other' + T
LOG = """() => { if (window.__log) return; window.__log = [];
  for (const e of ['script-host:changed', 'connecting', 'disconnected'])
    atriumClient.on(e, (d) => __log.push(e === 'script-host:changed' ? [e, d.active, d.hostGen] : [e])) }"""
LINE = """() => { const e = document.getElementById('ep-host-status'); return { text: e.textContent,
  visible: !!e && getComputedStyle(e).display !== 'none' && e.offsetParent !== null, role: atriumClient.scriptHost, canEdit: atriumClient.canEdit } }"""


def recv_log(page):
    """Record every server->client message (a pass-through route)."""
    log = []
    def route(ws):
        server = ws.connect_to_server()
        ws.on_message(lambda m: server.send(m))
        def down(m):
            log.append(m); ws.send(m)
        server.on_message(down)
    page.route_web_socket('**/w/**', route)
    return log


def hellos(log):
    out = []
    for m in log:
        try: d = json.loads(m)
        except Exception: continue
        if d.get('type') in ('hello', 'script-host'):
            out.append({k: d.get(k) for k in ('type', 'scriptHost', 'hostGen', 'active') if k in d})
    return out


def open_tab(br, ws, edit=True):
    holder = {}
    p = Page(br, ws_routes=lambda pg: holder.setdefault('log', recv_log(pg)))
    p.recv = holder['log']; p.connect(ws); p.ev(LOG)
    if edit: p.edit_on()
    p.page.wait_for_timeout(300)
    return p


with sync_playwright() as pw:
    br = new_browser(pw)
    # ---- check 4
    a = open_tab(br, W); b = open_tab(br, W)
    print('C4 tab A', a.ev(LINE), hellos(a.recv))
    print('C4 tab B', b.ev(LINE), hellos(b.recv))
    t0 = time.time(); a.close()
    b.wait("() => document.getElementById('ep-host-status').textContent === 'Script host: this tab (behaviours run here)'", timeout=10000)
    print(f'C4 A closed -> B in {time.time() - t0:.2f}s', b.ev(LINE), 'B messages', hellos(b.recv), 'B events', b.ev('__log'))
    a = open_tab(br, W)
    print('C4 A reopened', a.ev(LINE), hellos(a.recv), '| B still', b.ev(LINE)['text'])
    # ---- check 5: B is host; B switches worlds with a new connection
    b.ev("() => { window.__log.length = 0 }"); a.ev("() => { window.__log.length = 0 }")
    # The app's Connect button disconnects first, so it isn't supersession; a teleport
    # calls client.connect() on the live connection, which this does directly.
    # scripting-4c: the app's every connect goes through connectNow, which passes
    # `scriptRunner` on a same-origin connection (AC6); a direct client.connect() without it
    # sends no scriptRunner and is never elected, so this stand-in passes it as connectNow does.
    # (A base client ignores the option.)
    b.ev("(u) => { atriumClient.connect(u, { avatar: atriumClient._avatarDescriptor, scriptRunner: true }) }", W2)
    b.wait("() => atriumClient.connected && atriumClient.som", timeout=15000); b.page.wait_for_timeout(800)
    print('C5 B event order', b.ev('__log'))
    a.wait("() => document.getElementById('ep-host-status').textContent === 'Script host: this tab (behaviours run here)'", timeout=10000)
    print('C5 A after B left', a.ev(LINE), 'A events', a.ev('__log'))
    b.edit_on(); print('C5 B in the new world (alone, owner)', b.ev(LINE), hellos(b.recv)[-1])
    # ---- check 6: a visitor
    v = open_tab(br, W + '?visitor', edit=False)
    print('C6 visitor', v.ev(LINE), 'edit button shown', v.ev("getComputedStyle(document.getElementById('edit-toggle-btn')).display"), hellos(v.recv))
    print('errors', a.errors, b.errors, v.errors)
    br.close()
