# Outside review M2 — a deeply nested behaviour value sent raw (past the client's own check) to a SECOND
# harness server on 9443/9444. Does the server refuse it, or does the process die?
import os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'scripting-4a')); from anim import *
O = 'https://127.0.0.1:9443'
DEPTH = int(sys.argv[1]) if len(sys.argv) > 1 else 6500
RAW = """({ name, depth }) => new Promise((res) => { const c = atriumClient; let v = 0; for (let i = 0; i < depth; i++) v = [v];
  const value = { kind: 'graph', graph: v, nodeMap: [], targets: [], animations: [], enabled: true, origin: 'local' };
  const seq = 90000 + Math.floor(Math.random() * 9999);
  const f = (d) => { if (d.seq === seq) res({ k: d.code ? 'rejected' : 'accepted', code: d.code ?? null, message: d.message ?? null }) };
  c.on('edit:accepted', f); c.on('edit:rejected', f);
  c._trackEdit?.(seq, { type: 'send', node: name, field: 'extras.atrium.behavior', value });
  c._wsSend({ type: 'send', seq, node: name, field: 'extras.atrium.behavior', value });
  setTimeout(() => res({ k: 'timeout', connected: c.connected }), 6000) })"""
with sync_playwright() as pw:
    br = new_browser(pw)
    p = Page(br, origin=O); W = 'wss://127.0.0.1:9443/w/deep' + str(int(time.time()))
    p.connect(W); p.edit_on()
    p.page.click('button[data-kind=cube]'); p.page.wait_for_timeout(700)
    name = [n for n in p.ev("atriumClient.som.nodes.map(n => n.name)") if n.startswith('Cube')][0]
    oid = p.ev("(n) => new Promise((res) => { const id = crypto.randomUUID(); const s = atriumClient.setObjectId(n, id); atriumClient.on('edit:accepted', (d) => d.seq === s && res(id)); setTimeout(() => res(null), 4000) })", name)
    print('M2 node', name, oid, '| depth', DEPTH)
    print('M2 raw send', p.ev(RAW, {'name': name, 'depth': DEPTH}))
    p.page.wait_for_timeout(1500)
    print('M2 still connected', p.ev('atriumClient.connected'))
    q = Page(br, origin=O)
    try:
        q.connect(W); print('M2 a new tab connects afterwards: yes')
    except Exception as e:
        print('M2 a new tab connects afterwards: NO', str(e)[:80])
    br.close()
