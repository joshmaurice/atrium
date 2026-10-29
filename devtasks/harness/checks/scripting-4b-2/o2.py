# Round 5 — the outside review's scenarios in a real page: M3 (a send queued BEFORE a drag), M5 (the 101st key
# disposes its producer), and M1's producer check (an entry whose behaviour was reloaded).
exec(open(__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)), 'f1b.py')).read().split('\nwith sync_playwright() as pw:')[0])
FILL = """(n) => { const r = __beh().runner; for (let i = 0; i < n; i++) r.enqueue(crypto.randomUUID(), 'node', 'visible', true, 'filler', 0); return r.queue.size }"""
DRAG = """() => { const e = __ep(); const g = e.gizmo, o = e.selectedObj; g.dispatchEvent({ type: 'dragging-changed', value: true }); o.position.x += 0.5; g.dispatchEvent({ type: 'objectChange' }); return null }"""
END = "() => { __ep().gizmo.dispatchEvent({ type: 'dragging-changed', value: false }) }"
REC = "(n) => { const r = __beh().runner.engines.get(n); return r ? { reason: r.reason, engine: !!r.engine, gen: r.generation } : null }"
with sync_playwright() as pw:
    br = new_browser(pw)
    W = 'wss://127.0.0.1:8443/w/orev' + T
    a = Page(br); a.connect(W); a.edit_on(); v = Page(br); v.connect(W + '?visitor')
    x = add_cube(a); a.ev(MOVE, {'name': x, 't': [-1.5, 0.5, -5]})
    y = add_cube(a); a.ev(MOVE, {'name': y, 't': [1.5, 0.5, -5]})
    print('M3 write', behave(a, x, 'select-visibility', {'target': y, 'action': 'toggle'}))

    # M5: 100 filler keys and X's select in ONE evaluate, so X's enqueue (next tick, before that tick's opportunity) is the 101st.
    print('M5 fill+select', a.ev("""(n) => { const r = __beh().runner; for (let i = 0; i < 100; i++) r.enqueue(crypto.randomUUID(), 'node', 'visible', true, 'filler', 0);
      const size = r.queue.size; r.select(atriumClient.som.getNodeByName(n)); return size }""", x))
    a.page.wait_for_timeout(400)
    print('M5 X record', a.ev(REC, x), '| log', [l for l in a.ev(RUN)['log'] if 'too many' in l or 'disabled' in l][-2:])
    select(a, x); print('M5 panel status', repr(a.ev(FORM)['status']))
    n0 = len([l for l in a.ev("__beh().runner.log.map(l => l.message)") if 'disabled' in l]); a.page.wait_for_timeout(2000)
    print('M5 disable lines over 2 s', n0, '->', len([l for l in a.ev("__beh().runner.log.map(l => l.message)") if 'disabled' in l]))
    a.page.wait_for_timeout(5500)
    a.page.click('#ep-behavior-enabled'); a.page.wait_for_timeout(700); a.page.click('#ep-behavior-enabled'); a.page.wait_for_timeout(900)
    print('M5 after Enabled off/on (a reload)', a.ev(REC, x)); edit_off(a); b0 = a.ev(VIS, y); click_node(a, x); print('M5 click X: Y', b0, '->', a.ev(VIS, y))
    print('errors', a.errors[:4])
    br.close()
