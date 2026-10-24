# §5.1 checks 1, 2, 2b and 3: owner plays; different clocks; Play before the first pong; late joiner.
from anim import *
W = 'wss://127.0.0.1:8443/w/s4a1' + str(int(time.time()))
with sync_playwright() as pw:
    br = new_browser(pw)
    a = SPage(br); a.connect(W); a.edit_on()
    fox = add_model(a, FOX, scale=0.01)
    cm = add_model(a, CESIUM)
    print('models', fox, cm, 'fox scale', a.ev("(n)=>atriumClient.som.getNodeByName(n).scale", fox))
    # B: a visitor on the other origin whose Date.now is 5 s ahead.
    b = SPage(br, origin=B, init=[DATE_SHIFT % 5000]); b.connect(W + '?visitor')
    wait_loaded(b, fox); wait_loaded(b, cm)
    print('B Date.now - true (ms)', b.ev('Date.now() - (performance.timeOrigin + performance.now())'))
    rest_a, rest_b = pose(a, fox), pose(b, fox)
    # ---- check 1
    v = play(a, fox, 'Run', True)
    print('C1 stored value', v, 'true now - startedAt (ms)', round(true_now_ms(a) - v['startedAt']))
    print('C1 row after Play', row(a))
    for i in range(4):
        a.page.wait_for_timeout(700)
        print('C1 sample', i, 'A', err(a, fox), 'B', err(b, fox))
    pa, pb = pose(a, fox), pose(b, fox)
    print('C1 animates: A pose != rest', pa != rest_a, ' B pose != rest', pb != rest_b)
    play(a, cm, 'animation_0', True)
    a.page.wait_for_timeout(500)
    print('C1 cesium A', err(a, cm), 'B', err(b, cm))
    # ---- check 2: jump B's Date.now by +60 s mid-play
    b.ev('window.__dateShift += 60000')
    print('B Date.now - true after jump (ms)', b.ev('Date.now() - (performance.timeOrigin + performance.now())'))
    for i in range(3):
        b.page.wait_for_timeout(1000)
        print('C2 after jump', i, 'A', err(a, fox), 'B', err(b, fox), 'B cesium', err(b, cm))
    b.page.wait_for_timeout(31000)   # past the next 30 s ping
    print('C2 after next ping', 'B', err(b, fox), 'B cesium', err(b, cm))
    # ---- check 2b: an owner whose socket is 300 ms each way plays at once, before its first pong
    c = SPage(br, init=[WS_DELAY % 300])
    c.page.fill('#wsUrl', W); c.page.click('#connectBtn')
    c.wait('atriumClient.connected && atriumClient.som && atriumClient.som.getNodeByName(%s)' % json.dumps(cm), timeout=30000)
    old = c.ev("(n) => atriumClient.som.getNodeByName(n).extras.atrium.animation.startedAt", cm)
    pre = c.ev("(n) => { const ready = atriumClient.serverClockReady; const seq = atriumClient.setModelAnimation(n, { clip: 'animation_0', playing: true, loop: true, speed: 1, startedAt: 0 }); return { ready, seq, pressedAt: performance.timeOrigin + performance.now() } }", cm)
    print('C2b sent before first pong?', pre)
    c.wait("([n, old]) => atriumClient.som.getNodeByName(n).extras.atrium.animation.startedAt !== old && atriumClient.serverClockReady", arg=[cm, old], timeout=15000)
    v2 = c.ev("(n) => atriumClient.som.getNodeByName(n).extras.atrium.animation", cm)
    print('C2b stored', v2, 'startedAt - press (ms)', round(v2['startedAt'] - pre['pressedAt']), '(expect ~300: the server stamped on arrival)')
    wait_loaded(c, cm)
    c.page.wait_for_timeout(1500)
    print('C2b same phase: A', err(a, cm), 'B', err(b, cm), 'C', err(c, cm))
    print('C2b C clock window', c.ev(SAMPLES))
    c.page.wait_for_timeout(31000)
    print('C2b after C\'s next ping: A', err(a, cm), 'B', err(b, cm), 'C', err(c, cm), 'C window', c.ev(SAMPLES))
    # ---- check 3: a late joiner, 7 s after the fox started
    a.page.wait_for_timeout(max(0, 7000 - (true_now_ms(a) - v['startedAt'])))
    d = SPage(br, origin=B); d.page.fill('#wsUrl', W + '?visitor'); d.page.click('#connectBtn')
    d.wait('(n) => __anim().modelAnimations.actionFor(n)', arg=fox, timeout=60000)
    first = d.ev("(n) => { const a = __anim().modelAnimations.actionFor(n); return { t: a.time } }", fox)
    print('C3 late joiner: since start (s)', round((true_now_ms(d) - v['startedAt']) / 1000, 2), 'first action time', first, 'now', err(d, fox))
    print('C3 cesium', err(d, cm))
    for p, n in ((a, 'A'), (b, 'B'), (c, 'C'), (d, 'D')):
        print('clock window', n, p.ev(SAMPLES))
        print('errors', n, p.errors, [x for x in p.console if x.startswith('error') and '401' not in x][:5])
    print('visitor anim sends: B', b.anim_sends(), 'D', d.anim_sends())
    a.page.screenshot(path=SHOTS + '/s4a-c1-owner.png'); b.page.screenshot(path=SHOTS + '/s4a-c1-visitor.png')
    br.close()
