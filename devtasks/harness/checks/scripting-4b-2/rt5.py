# scripting-4b-2 §5.1 — check 6 (the drag rule) and check 7 (the 64/65 cap).
exec(open(__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)), 'rt2.py')).read().split('\nwith sync_playwright() as pw:')[0])
SEL = "(n) => { try { __ep().selectForEdit(atriumClient.som.getNodeByName(n)); return null } catch (e) { return String(e).slice(0, 80) } }"
DRAG = """(xz) => { const e = __ep(); const g = e.gizmo, o = e.selectedObj; g.dispatchEvent({ type: 'dragging-changed', value: true }); o.position.set(xz[0], o.position.y, xz[1]); g.dispatchEvent({ type: 'objectChange' }); return null }"""
END = "() => { __ep().gizmo.dispatchEvent({ type: 'dragging-changed', value: false }) }"
POS = "(n) => atriumClient.som.getNodeByName(n).translation.map(v => +v.toFixed(2))"

with sync_playwright() as pw:
    br = new_browser(pw)
    W6 = 'wss://127.0.0.1:8443/w/dr' + T
    a = Page(br); a.connect(W6); a.edit_on(); v = Page(br); v.connect(W6 + '?visitor')
    x = add_cube(a); a.ev(MOVE, {'name': x, 't': [-1.5, 0.5, -5]})
    y = add_cube(a); a.ev(MOVE, {'name': y, 't': [1.5, 0.5, -5]})
    print('C6 write', behave(a, x, 'select-visibility', {'target': y, 'action': 'toggle'}))
    print('C6 select Y', a.ev(SEL, y)); a.page.wait_for_timeout(300)
    a.ev(DRAG, [2.5, -6]); a.page.wait_for_timeout(200)
    a.ev("(n) => __beh().runner.select(atriumClient.som.getNodeByName(n))", x); a.page.wait_for_timeout(400)
    a.ev(END); a.page.wait_for_timeout(1200)
    print('C6 during drag: Y', a.ev(VIS, y), 'visitor', v.ev(VIS, y), '| Y at', a.ev(POS, y), 'visitor', v.ev(POS, y))
    print('C6 log', a.ev(RUN)['log'])
    a.ev("(n) => __beh().runner.select(atriumClient.som.getNodeByName(n))", x); a.page.wait_for_timeout(800)
    print('C6 after the drag, a select: Y', a.ev(VIS, y), '| Y at', a.ev(POS, y))

    # ---- 7: 64 behaviours in one world, then the 65th.
    W7 = 'wss://127.0.0.1:8443/w/cap' + T
    c = Page(br); c.connect(W7); c.edit_on()
    tgt = add_cube(c); c.ev(MOVE, {'name': tgt, 't': [0, 3, -8]})
    cubes = []
    for i in range(65):
        n = add_cube(c); cubes.append(n); c.ev(MOVE, {'name': n, 't': [-4 + (i % 9), 0.5, -6 - (i // 9)]})
    res = [behave(c, n, 'select-visibility', {'target': tgt, 'action': 'toggle'}) for n in cubes]
    print('C7 accepted', sum(r['k'] == 'accepted' for r in res), '| 64th', res[63], '| 65th', res[64])
    edit_off(c); c.page.wait_for_timeout(500); print('C7 runner engines', len(c.ev(RUN)['engines']))
    before = c.ev(VIS, tgt); print('C7 click the 64th', click_node(c, cubes[63]), before, '->', c.ev(VIS, tgt))
    print('errors', a.errors[:4], c.errors[:4])
    br.close()
