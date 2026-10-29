# N3, visitor variant: a VISITOR's own avatar `add` (which skips the owner gate) carrying deep plain extras.
# The page's automatic avatar add is rewritten in flight. Spare harness server on 9443.
import sys, time, json
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'scripting-4a')); from anim import *
O = 'https://127.0.0.1:9443'
DEPTH = int(sys.argv[1]) if len(sys.argv) > 1 else 6500
state = {'rewrote': False}


def deep_avatar(page):
    def route(ws):
        server = ws.connect_to_server()
        def up(m):
            try:
                d = json.loads(m)
                if d.get('type') == 'add' and d.get('id') and not state['rewrote']:
                    v = 0
                    for _ in range(DEPTH): v = [v]
                    d['node'].setdefault('extras', {})['foo'] = v
                    m = json.dumps(d); state['rewrote'] = True
            except RecursionError:
                pass
            except Exception:
                pass
            server.send(m)
        ws.on_message(up); server.on_message(lambda m: ws.send(m))
    page.route_web_socket('**/w/**', route)


sys.setrecursionlimit(100000)
with sync_playwright() as pw:
    br = new_browser(pw)
    W = 'wss://127.0.0.1:9443/w/avdeep' + str(int(time.time()))
    owner = Page(br, origin=O); owner.connect(W)
    vis = Page(br, origin=O, ws_routes=deep_avatar)
    try:
        vis.connect(W + '?visitor')
    except Exception as e:
        print('N3v visitor connect:', str(e)[:80])
    owner.page.wait_for_timeout(2500)
    print('N3v rewrote the visitor avatar add', state['rewrote'], '| depth', DEPTH, '| visitor canEdit', vis.ev('atriumClient.canEdit') if not vis.page.is_closed() else None)
    print('N3v owner tab still connected', owner.ev('atriumClient.connected'))
    q = Page(br, origin=O)
    try:
        q.connect(W); print('N3v a new tab connects afterwards: yes')
    except Exception as e:
        print('N3v a new tab connects afterwards: NO', str(e)[:80])
    br.close()
