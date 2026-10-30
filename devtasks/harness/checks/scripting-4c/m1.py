# scripting-4c round 2: the outside review's M1, reproduced against the REAL server (authserver.mjs,
# HOOKS=1) with a real browser host. The "attacker" is a hand-made socket opened from a visitor page.
from common import *

RAW = """async ({ url, steps }) => {
  const ws = new WebSocket(url); const got = []; let seq = 1
  ws.onmessage = (e) => { try { const m = JSON.parse(e.data); got.push({ type: m.type, code: m.code ?? null, message: m.message ?? null, avatarNodeName: m.avatarNodeName ?? null, bytes: e.data.length }) } catch { got.push({ raw: String(e.data).slice(0, 60) }) } }
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const out = []
  for (const s of steps) {
    const n0 = got.length
    if (s.hello) ws.send(JSON.stringify({ type: 'hello', id: s.hello, capabilities: { tick: { interval: 5000 } } }))
    if (s.avatar) { const h = got.find((m) => m.type === 'hello' && m.avatarNodeName); ws.send(JSON.stringify({ type: 'add', id: s.avatar, seq: seq++, node: { name: h.avatarNodeName, translation: [0, 0, 3] } })); await wait(300); ws.send(JSON.stringify({ type: 'view', seq: seq++, position: [0, 0, 3] })) }
    if (s.activate) for (let i = 0; i < (s.n ?? 1); i++) ws.send(JSON.stringify({ type: 'activate', seq: seq++, node: s.activate, event: 'select' }))
    await wait(s.wait ?? 800)
    out.push({ step: s.label, replies: got.slice(n0).filter((m) => m.type !== 'ping' && m.type !== 'tick').map((m) => [m.type, m.code, m.message, m.bytes]).slice(0, 4), open: ws.readyState === 1 })
  }
  ws.close(); return out }"""

def logtail(n0):
    import urllib.request, ssl
    cx = ssl.create_default_context(); cx.check_hostname = False; cx.verify_mode = ssl.CERT_NONE
    t = urllib.request.urlopen('https://127.0.0.1:8443/__log', context=cx).read().decode()
    return t[n0:], len(t)

with sync_playwright() as pw:
    br = new_browser(pw); register(br)
    octx = br.new_context(ignore_https_errors=True, viewport={'width': 1280, 'height': 800})
    vctx = br.new_context(ignore_https_errors=True, viewport={'width': 1280, 'height': 800})
    a = owner_tab(octx, 'A', first=True); W = new_world(a, 'm1'); a.connect(W)
    a.edit_on(); x = add_cube(a); y = add_cube(a)
    a.ev(MOVE, {'name': x, 't': [0, 0.5, 0]}); a.ev(MOVE, {'name': y, 't': [2, 0.5, 0]})
    print('write', behave(a, x, 'select-visibility', {'target': y, 'action': 'toggle'})); edit_off(a)
    check('setup: A hosts W', a.ev(HOST)['active'] is True)
    v = Tab(vctx, 'V')                                    # a page to open raw sockets from (not connected itself)
    _, L0 = logtail(0)
    big = 'x' * 250000 + '\n\u001b[31mFAKE'
    r = v.ev(RAW, {'url': W, 'steps': [
        {'label': '250,000-char id', 'hello': big},
        {'label': 'control-char id', 'hello': 'ab\n\u001b[2Jcd'},
        {'label': 'a 65-char id', 'hello': 'a' * 65},
        {'label': 'then a valid 64-char id, same socket', 'hello': 'v' * 64, 'wait': 1200},
        {'label': 'avatar + view at 3 m', 'avatar': 'v' * 64},
        {'label': 'activate x5', 'activate': x, 'n': 5, 'wait': 1200},
    ]})
    for s in r: print('  ', s)
    tail, _ = logtail(L0)
    hl = [l for l in tail.splitlines() if '[session]' in l or '[activate]' in l]
    print('   server log lines since:', [l[:120] for l in hl][-6:], '| longest line', max((len(l) for l in tail.splitlines()), default=0))
    first3 = r[0:3]
    check('250,000-char, control-char and 65-char ids: UNKNOWN_MESSAGE, socket open', all(s['replies'] and s['replies'][0][0] == 'error' and s['replies'][0][1] == 'UNKNOWN_MESSAGE' and s['open'] for s in first3), first3)
    check('...and none of them was admitted (no hello reply, no [session] hello line)', not any(any(m[0] == 'hello' for m in s['replies']) for s in first3) and sum('[session] hello ' in l for l in hl) == 1, hl)
    check('the same socket is then admitted with a valid 64-char id', any(m[0] == 'hello' for m in r[3]['replies']), r[3])
    fwd = of(a.ws, 'activate', '<')[-5:]
    sizes = [len(json.dumps(m, separators=(',', ':'))) for m in fwd]
    print('   the host received', len(fwd), 'forwards, sizes', sizes, '| from', fwd[0]['from'] if fwd else None)
    check('the host receives the forwards, each under 400 bytes, from = the 64-char id', len(fwd) == 5 and all(s < 400 for s in sizes) and fwd[0]['from'] == 'v' * 64, (len(fwd), sizes))
    check('no server log line is longer than 300 characters', max((len(l) for l in tail.splitlines()), default=0) <= 300)
    print('page errors: A', a.errors[:3], '| V', v.errors[:3])
    br.close()
print('\nFAILS:', fails or 'none'); sys.exit(1 if fails else 0)
