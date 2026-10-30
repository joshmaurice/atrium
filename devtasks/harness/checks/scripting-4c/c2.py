# scripting-4c §6.1 checks 4 (owner away), 5 (handover), 12 (the host's load, M1) and 11 (pointer lock, S4)
# — on the REAL server with real sign-in (authserver.mjs, HOOKS=1).
from common import *
NOHOST = "Nothing happens: this world's owner isn't here right now."
CENTRE = """(d) => { const c = stage.camera; c.updateMatrixWorld(); const p = c.getWorldPosition(new c.position.constructor());
  const dir = c.getWorldDirection(new c.position.constructor()); return [p.x + dir.x * d, p.y + dir.y * d, p.z + dir.z * d].map(v => +v.toFixed(3)) }"""
LOCK = "() => document.pointerLockElement?.id ?? null"

with sync_playwright() as pw:
    br = new_browser(pw); register(br)
    octx = br.new_context(ignore_https_errors=True, viewport={'width': 1280, 'height': 800})
    vctx = br.new_context(ignore_https_errors=True, viewport={'width': 1280, 'height': 800})
    a = owner_tab(octx, 'A', first=True); W = new_world(a, 'c2'); a.connect(W)
    v = Tab(vctx, 'V'); v.connect(W)
    a.edit_on(); x = add_cube(a); y = add_cube(a)
    a.ev(MOVE, {'name': x, 't': [0, 0.5, -3]}); a.ev(MOVE, {'name': y, 't': [-2.5, 0.5, -2]})
    print('write', behave(a, x, 'select-visibility', {'target': y, 'action': 'toggle'}))
    # A large world: 120 more cubes (a bigger som-dump), far off to the side.
    for i in range(120):
        c = add_cube(a); a.ev(MOVE, {'name': c, 't': [30 + (i % 12) * 2, 0.5, -10 - (i // 12) * 2]})
    edit_off(a); a.page.wait_for_timeout(800)
    check('setup: A is the host, V sees X', a.ev(HOST)['active'] and v.ev(VIS, x)['som'] is True, (a.ev(HOST), v.ev(VIS, x)))

    print('\n== 4. owner away')
    a.page.close(); v.page.wait_for_timeout(1500)
    n0, e0 = sent(v, 'activate'), got(v, 'error'); click_node(v, x); nt = v.ev(NOTICE)
    print('   V sent', sent(v, 'activate') - n0, '| errors', [e.get('code') for e in of(v.ws, 'error', '<')[e0:]])
    check('4 no owner tab: the "isn\'t here right now" notice', nt == NOHOST, nt)
    a3 = owner_tab(octx, 'A3'); a3.connect(W)
    a3.wait("() => __beh().runner.engines.size > 0", timeout=20000); a3.page.wait_for_timeout(500)
    print('   A3 host', a3.ev(HOST), '| script-ready sent', of(a3.ws, 'script-ready', '>'))
    b = a3.ev(VIS, y)['obj']; click_node(v, x); a3.page.wait_for_timeout(800)
    check('4 an owner tab opens: the next click after its world loaded works', a3.ev(VIS, y)['obj'] is (not b) and v.ev(VIS, y)['obj'] is (not b), (b, a3.ev(VIS, y), v.ev(NOTICE)))

    print('\n== 5. handover')
    a4 = owner_tab(octx, 'A4'); a4.connect(W); a4.page.wait_for_timeout(1000)
    print('   A3', a3.ev(HOST), '| A4', a4.ev(HOST))
    a3.page.close()
    ok = a4.wait("() => atriumClient.scriptHost.active === true", timeout=8000)
    a4.wait("() => __beh().runner.engines.size > 0", timeout=8000); a4.page.wait_for_timeout(800)
    print('   A4 after A3 closed', a4.ev(HOST), '| script-ready', of(a4.ws, 'script-ready', '>'))
    b = a4.ev(VIS, y)['obj']; click_node(v, x); a4.page.wait_for_timeout(800)
    check("5 close the host tab: the visitor's next click runs in the other owner tab", ok and a4.ev(VIS, y)['obj'] is (not b) and any('select from' in l for l in a4.ev(RUN)['log']), (a4.ev(HOST), a4.ev(VIS, y), a4.ev(RUN)['log'][-1:]))

    print("\n== 12. the host's load (M1): the owner's tab loads slowly; the visitor clicks during the load")
    a4.page.close(); v.page.wait_for_timeout(1000)
    hold = {'on': False, 'q': []}
    a5 = owner_tab(octx, 'A5', hold=hold)                 # in alice's home world, loaded normally
    a5.page.click('#connectBtn'); a5.wait('!atriumClient.connected', timeout=8000); time.sleep(0.5)
    hold['on'] = True                                     # the test world's load is held from its som-dump on
    a5.page.fill('#wsUrl', W); a5.page.click('#connectBtn')
    a5.wait("() => atriumClient.scriptHost?.active === true", timeout=10000)
    print('   A5 granted', a5.ev(HOST), '| held messages', len(hold['q']), '| som loaded', a5.ev('!!atriumClient.som && atriumClient.som.nodes.length'))
    seen = []
    for i in range(4):
        v.page.wait_for_timeout(1300); e0 = got(v, 'error'); click_node(v, x)
        seen.append((v.ev(NOTICE), [e.get('code') for e in of(v.ws, 'error', '<')[e0:]]))
    print('   during the load:', seen)
    check("12 every click during the load: \"isn't here right now\", never silence", all(n == NOHOST for n, _ in seen), seen)
    print('   released', release(hold), 'messages')
    a5.wait("() => __beh().runner.engines.size > 0", timeout=20000); a5.page.wait_for_timeout(800)
    print('   A5 script-ready', of(a5.ws, 'script-ready', '>'))
    b = a5.ev(VIS, y)['obj']; click_node(v, x); a5.page.wait_for_timeout(800)
    check('12 after the load the click works', a5.ev(VIS, y)['obj'] is (not b), (b, a5.ev(VIS, y), v.ev(NOTICE)))

    print('\n== 11. pointer lock (S4)')
    a5.edit_on(); z = add_cube(a5); zc = v.ev(CENTRE, 6.5)
    a5.ev(MOVE, {'name': z, 't': zc}); print('   Z on the visitor\'s centre ray at', zc, '| from V', dist(avatar(v), zc), 'm')
    print('   write', behave(a5, z, 'select-visibility', {'target': y, 'action': 'toggle'})); edit_off(a5); v.page.wait_for_timeout(800)
    for t, who in ((v, 'visitor'), (a5, 'host')):
        sx, sy = sky_point(t); print(f'   {who}: empty sky at', (sx, sy))
        if who == 'host':
            zc = a5.ev(CENTRE, 6.5); a5.edit_on(); a5.ev(MOVE, {'name': z, 't': zc}); edit_off(a5); a5.page.wait_for_timeout(600)
        t.page.mouse.click(sx, sy); t.page.wait_for_timeout(300)      # focus the canvas: a click on empty sky (y=60 is the top bar)
        print(f'   {who} before M: edit', t.ev('__ep().modes.edit'), '| focus', t.ev('document.activeElement?.tagName'))
        t.page.keyboard.press('m'); t.page.wait_for_timeout(300)
        t.page.mouse.click(sx, sy); t.page.wait_for_timeout(600)     # a click into the view takes the lock
        lk = t.ev(LOCK); print(f'   {who}: lock held by', lk, '| usePointerLock', t.ev('__ep().modes.usePointerLock'))
        check(f'11 {who}: M then a click takes the pointer lock', lk == 'viewport', lk)
        # With the lock held, put Z on THIS tab's crosshair (the view may have turned while the lock was taken).
        zc = t.ev(CENTRE, 6.5); a5.ev(MOVE, {'name': z, 't': zc}); t.page.wait_for_timeout(800)   # the owner's tab moves Z (no Edit toggle: the lock covers the button)
        print(f'   {who}: Z on the crosshair at', zc, '| lock', t.ev(LOCK), '| pick at the cursor', t.ev('([x, y]) => __beh().pick(x, y)', [sx, sy]), '| at the canvas centre', t.ev("() => { const r = document.getElementById('viewport').getBoundingClientRect(); return __beh().pick(r.left + r.width / 2, r.top + r.height / 2) }"))
        b, n0 = a5.ev(VIS, y)['obj'], sent(t, 'activate'); s0 = len(a5.ev('window.__sel || []'))
        if who == 'host': a5.ev(SPY); s0 = len(a5.ev('window.__sel'))
        t.page.mouse.click(sx, sy); a5.page.wait_for_timeout(800)   # the cursor is far from Z; the crosshair is on it
        res = (sent(t, 'activate') - n0, [m.get('node') for m in of(t.ws, 'activate', '>')[n0:]], 'Y', b, '->', a5.ev(VIS, y)['obj'], a5.ev('window.__sel || []')[s0:],
               'errors', [e.get('code') for e in of(t.ws, 'error', '<')][-2:], 'host log', a5.ev(RUN)['log'][-2:], 'Z', z, 'Z behaviour', a5.ev("(n) => !!atriumClient.som.getNodeByName(n)?.extras?.atrium?.behavior", z))
        print('   ', who, 'locked click:', res)
        check(f'11 {who}: a locked click aims from the crosshair: it runs', a5.ev(VIS, y)['obj'] is (not b), res)
        # Aim at the sky: look up with the lock held (movementY), then click.
        for _ in range(6): t.page.mouse.move(sx, sy - 40 * (_ + 1) % 50); t.page.wait_for_timeout(50)
        t.ev("() => { const e = new MouseEvent('mousemove', { movementX: 0, movementY: -400, bubbles: true }); document.dispatchEvent(e) }"); t.page.wait_for_timeout(400)
        print('   aim now', t.ev("() => { const d = stage.camera.getWorldDirection(new stage.camera.position.constructor()); return [d.x, d.y, d.z].map(v => +v.toFixed(2)) }"), '| pick at centre', t.ev("() => __beh().pick(640, 400)"))
        b, n0 = a5.ev(VIS, y)['obj'], sent(t, 'activate'); t.page.mouse.click(sx, sy); a5.page.wait_for_timeout(700)
        check(f'11 {who}: aimed at the sky, a click does nothing', a5.ev(VIS, y)['obj'] is b and sent(t, 'activate') == n0, (a5.ev(VIS, y), sent(t, 'activate') - n0))
        t.page.keyboard.press('Escape'); t.page.wait_for_timeout(300)
        t.ev("() => { const e = new MouseEvent('mousemove', { movementX: 0, movementY: 400, bubbles: true }); document.dispatchEvent(e) }")
        t.page.keyboard.press('m') if t.ev('__ep().modes.usePointerLock') else None; t.page.wait_for_timeout(300)

    print('\npage errors: A3', a3.errors[:3], '| A4', a4.errors[:3], '| A5', a5.errors[:3], '| V', v.errors[:3])
    br.close()
print('\nFAILS:', fails or 'none'); sys.exit(1 if fails else 0)
