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

    # M3: 20 fillers ahead (one opportunity each, 50 ms), X's toggle of Y queued behind them, THEN the drag on Y starts.
    select(a, y); print('M3 queue after fillers', a.ev(FILL, 20))
    a.ev("(n) => __beh().runner.select(atriumClient.som.getNodeByName(n))", x); a.page.wait_for_timeout(150)
    print('M3 X entry queued before the drag', a.ev("() => [...__beh().runner.queue.values()].filter(e => e.behaviourId !== 'filler').map(e => e.field)"))
    a.ev(DRAG); a.page.wait_for_timeout(1800); a.ev(END); a.page.wait_for_timeout(800)
    print('M3 Y after the drag', a.ev(VIS, y), '| visitor', v.ev(VIS, y), '| log', [l for l in a.ev(RUN)['log'] if 'edit in progress' in l or 'Cube' in l][-2:])

    # M1 (producer check): queue X's toggle behind fillers, then reload X's behaviour (Enabled off/on via the leaf): its old entry must not leave.
    print('M1 queue after fillers', a.ev(FILL, 20)); before = a.ev(VIS, y)
    a.ev("(n) => __beh().runner.select(atriumClient.som.getNodeByName(n))", x); a.page.wait_for_timeout(150)
    g0 = a.ev(REC, x)
    leaf = a.ev("(n) => atriumClient.som.getNodeByName(n).extras.atrium.behavior", x); leaf2 = dict(leaf); leaf2['enabled'] = False
    a.ev(SEND, {'name': x, 'field': LEAF, 'value': leaf2}); a.ev(SEND, {'name': x, 'field': LEAF, 'value': leaf})
    a.page.wait_for_timeout(2000)
    print('M1 generation', g0, '->', a.ev(REC, x), '| Y', before, '->', a.ev(VIS, y), '(unchanged = the stale entry was dropped)')

    # M5: 100 filler keys, then X's real enqueue is the 101st.
    a.page.wait_for_timeout(1500); print('M5 queue after fillers', a.ev(FILL, 100))
    a.ev("(n) => __beh().runner.select(atriumClient.som.getNodeByName(n))", x); a.page.wait_for_timeout(300)
    print('M5 X record', a.ev(REC, x), '| queue', a.ev('__beh().runner.queue.size'), '| log', a.ev(RUN)['log'][-2:])
    select(a, x); print('M5 panel status', repr(a.ev(FORM)['status']))
    ticks0 = len([l for l in a.ev("__beh().runner.log.map(l => l.message)") if 'disabled' in l]); a.page.wait_for_timeout(2000)
    print('M4/M5 disable lines over 2 s (expect no growth)', ticks0, '->', len([l for l in a.ev("__beh().runner.log.map(l => l.message)") if 'disabled' in l]))
    a.page.wait_for_timeout(5000)
    a.page.click('#ep-behavior-enabled'); a.page.wait_for_timeout(700); a.page.click('#ep-behavior-enabled'); a.page.wait_for_timeout(900)
    print('M5 after Enabled off/on (a reload)', a.ev(REC, x)); edit_off(a); b0 = a.ev(VIS, y); click_node(a, x); print('M5 click X: Y', b0, '->', a.ev(VIS, y))
    print('errors', a.errors[:4])
    br.close()
