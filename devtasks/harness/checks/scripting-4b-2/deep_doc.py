# M2 on PROD's tree: a deeply nested DOCUMENT extras value (owner, World Info's own path), sent raw to a
# spare harness server on 9443 running 8358b043. Refused, or does the process die?
import os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'scripting-4a')); from anim import *
O = 'https://127.0.0.1:9443'
DEPTH = int(sys.argv[1]) if len(sys.argv) > 1 else 6500
RAW = """(depth) => new Promise((res) => { const c = atriumClient; let v = 0; for (let i = 0; i < depth; i++) v = [v];
  const value = { ...(c.som.document?.extras ?? {}), deep: v };
  const seq = 90000 + Math.floor(Math.random() * 9999);
  const f = (d) => { if (d.seq === seq) res({ k: d.code ? 'rejected' : 'accepted', code: d.code ?? null, message: d.message ?? null }) };
  c.on('edit:accepted', f); c.on('edit:rejected', f);
  c._trackEdit?.(seq, { type: 'send', node: '__document__', field: 'extras', value });
  c._wsSend({ type: 'send', seq, node: '__document__', field: 'extras', value });
  setTimeout(() => res({ k: 'timeout', connected: c.connected }), 6000) })"""
with sync_playwright() as pw:
    br = new_browser(pw)
    p = Page(br, origin=O); W = 'wss://127.0.0.1:9443/w/docdeep' + str(int(time.time()))
    frames = []
    p.page.on('websocket', lambda ws: ws.on('framereceived', lambda f: frames.append(f if isinstance(f, str) else str(f))))
    p.connect(W); p.edit_on()
    print('PROD canEdit', p.ev('atriumClient.canEdit'), '| depth', DEPTH, '| JSON bytes ~', 2 * DEPTH + 30)
    print('PROD raw document-extras send', p.ev(RAW, DEPTH))
    p.page.wait_for_timeout(1500)
    print('PROD server replies naming seq 9xxxx:', [f[:200] for f in frames if '"seq":9' in f][:3])
    print('PROD still connected', p.ev('atriumClient.connected'))
    q = Page(br, origin=O)
    try:
        q.connect(W); print('PROD a new tab connects afterwards: yes')
    except Exception as e:
        print('PROD a new tab connects afterwards: NO', str(e)[:80])
    br.close()
