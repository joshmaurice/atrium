# scripting-4c §6.1 checks 1, 2, 3, 6, 7, 8 — on the REAL server with real sign-in
# (checks/signin-sync/authserver.mjs, HOOKS=1). alice owns /worlds/alice/home;
# A and A2 are her tabs (one context: shared cookie); V is an anonymous visitor (its own context).
# Distances are from the avatar, which spawns at [0, 0.7, 0] (the camera trails 4 m behind it).
from common import *

with sync_playwright() as pw:
    br = new_browser(pw)
    print('register', register(br))
    octx = br.new_context(ignore_https_errors=True, viewport={'width': 1280, 'height': 800})
    vctx = br.new_context(ignore_https_errors=True, viewport={'width': 1280, 'height': 800})
    a = owner_tab(octx, 'A', first=True)
    W = new_world(a, 'c1'); print('A connected', a.connect(W))
    v = Tab(vctx, 'V'); print('V connected', v.connect(W))
    a.page.wait_for_timeout(1000)
    print('A hello caps', hello(a), '| host', a.ev(HOST), '| canEdit', a.ev('atriumClient.canEdit'))
    print('V hello caps', hello(v), '| host', v.ev(HOST), '| canEdit', v.ev('atriumClient.canEdit'))
    check('A (signed-in owner) is the host', a.ev(HOST)['active'] is True, a.ev(HOST))
    check('V is an anonymous visitor', v.ev('atriumClient.canEdit') is False and v.ev(HOST)['active'] is False)

    # ---- layout: X (the switch) and Y (its target) left of centre; the x = 0 lane stays clear.
    a.edit_on(); x = add_cube(a); y = add_cube(a)
    a.ev(MOVE, {'name': x, 't': [-1, 0.5, -2]}); a.ev(MOVE, {'name': y, 't': [-2.5, 0.5, -2]})
    print('write X->Y select-visibility', behave(a, x, 'select-visibility', {'target': y, 'action': 'toggle'}))
    edit_off(a); a.ev(SPY); v.page.wait_for_timeout(800)

    print('\n== 1. visitor click within 10 m; then at 12 m')
    print('   V avatar', avatar(v), '| X at', dist(avatar(v), [-1, 0.5, -2]), 'm | pick', pick_at(v, x))
    n0, h0 = sent(v, 'activate'), got(a, 'activate')
    click_node(v, x); a.page.wait_for_timeout(700)
    fwd = of(a.ws, 'activate', '<')[h0:]
    print('   V sent', sent(v, 'activate') - n0, '| A got', fwd, '| A log', a.ev(RUN)['log'][-1:])
    check('1 Y hides in both tabs', a.ev(VIS, y)['obj'] is False and v.ev(VIS, y)['obj'] is False, (a.ev(VIS, y), v.ev(VIS, y)))
    vid = (fwd[0]['from'] if fwd else '')[:8]
    check("1 the host's log shows 'select from <visitor>'", any(l.endswith('select from ' + vid) for l in a.ev(RUN)['log']) and vid != '', a.ev(RUN)['log'])
    click_node(v, x); a.page.wait_for_timeout(700)
    check('1 a second click shows Y again', a.ev(VIS, y)['obj'] is True and v.ev(VIS, y)['obj'] is True)
    a.edit_on(); a.ev(MOVE, {'name': x, 't': [0, 0.5, -12]}); edit_off(a); v.page.wait_for_timeout(800)
    print('   X now', dist(avatar(v), [0, 0.5, -12]), 'm from V | pick', pick_at(v, x))
    n0 = sent(v, 'activate'); click_node(v, x); nt = v.ev(NOTICE)
    check('1 at 12 m: "Move closer to use this." and nothing sent', nt == 'Move closer to use this.' and sent(v, 'activate') == n0 and a.ev(VIS, y)['obj'] is True, (nt, sent(v, 'activate') - n0))
    walk(v, 'w', 2600); d = dist(avatar(v), [0, 0.5, -12]); print('   V walked up: avatar', avatar(v), '->', d, 'm')
    n0 = sent(v, 'activate'); click_node(v, x); a.page.wait_for_timeout(700)
    check(f'1 after walking to {d} m, the click works', d < 10 and sent(v, 'activate') == n0 + 1 and a.ev(VIS, y)['obj'] is False, (d, sent(v, 'activate') - n0, a.ev(VIS, y)))
    click_node(v, x); a.page.wait_for_timeout(500)
    walk(v, 's', 2600); print('   V walked back', avatar(v))
    a.edit_on(); a.ev(MOVE, {'name': x, 't': [-1, 0.5, -2]}); edit_off(a)

    print('\n== 2. a placed Fox, "On select: play", clicked on its inner mesh')
    a.edit_on(); fox = add_model(a, FOX, scale=0.02); a.ev(MOVE, {'name': fox, 't': [2.5, 0, -3]}); a.page.wait_for_timeout(1500)
    print('   write', behave(a, fox, 'select-animation', {'target': fox, 'clip': 'Run', 'action': 'play', 'loop': True}))
    edit_off(a); v.wait(f"(n) => __mb.status(n)?.status === 'loaded'", arg=fox, timeout=60000); v.page.wait_for_timeout(800)
    bp = v.ev(BOXPICK, fox); print('   V pick at the Fox', v.ev("([x, y]) => __beh().pick(x, y)", [bp['x'], bp['y']]), '| before', a.ev(ANIMV, fox))
    n0 = sent(v, 'activate'); click_box(v, fox); a.page.wait_for_timeout(1000)
    print('   V sent', [m.get('node') for m in of(v.ws, 'activate', '>')[n0:]], '| A log', a.ev(RUN)['log'][-1:])
    check('2 the Fox plays everywhere', (a.ev(ANIMV, fox) or {}).get('playing') is True and (v.ev(ANIMV, fox) or {}).get('clip') == 'Run', (a.ev(ANIMV, fox), v.ev(ANIMV, fox)))

    print('\n== 3. a second owner tab, not the host')
    a2 = owner_tab(octx, 'A2'); print('   A2 connected', a2.connect(W))
    check('3 A2 is signed in, not the host; A still is', a2.ev('atriumClient.canEdit') and a2.ev(HOST)['active'] is False and a.ev(HOST)['active'] is True, (a2.ev(HOST), a.ev(HOST)))
    a2.edit_on(); click_node(a2, x); a2.page.wait_for_timeout(600)
    st = a2.ev("document.getElementById('ep-behavior-status').textContent")
    check('3 its status line says clicks are sent to the other tab', a2.ev('__ep().selected?.name ?? null') == x and 'clicks here are sent to it' in st, st)
    edit_off(a2); b, n0 = a.ev(VIS, y)['obj'], sent(a2, 'activate'); click_node(a2, x); a.page.wait_for_timeout(700)
    check("3 A2's click goes through activate and runs in A", sent(a2, 'activate') == n0 + 1 and a.ev(VIS, y)['obj'] is (not b) and a2.ev(RUN)['enabled'] is False, (sent(a2, 'activate') - n0, a.ev(VIS, y)))
    if a.ev(VIS, y)['obj'] is False: click_node(a2, x); a.page.wait_for_timeout(500)

    print("\n== 6. limits, from the visitor's console")
    v.page.wait_for_timeout(1500); h0, e0 = got(a, 'activate'), got(v, 'error')
    v.ev("(n) => { for (let i = 0; i < 10; i++) atriumClient.activate(n) }", x); a.page.wait_for_timeout(1500)
    codes = [e.get('code') for e in of(v.ws, 'error', '<')[e0:]]
    check('6 10 in one task: 5 forwarded, 5 RATE_LIMITED', got(a, 'activate') - h0 == 5 and codes == ['RATE_LIMITED'] * 5, (got(a, 'activate') - h0, codes))
    v.page.wait_for_timeout(2500)
    a.edit_on(); far = add_cube(a); a.ev(MOVE, {'name': far, 't': [8, 0.5, -60]})
    print('   far write', behave(a, far, 'select-visibility', {'target': y, 'action': 'toggle'})); edit_off(a)
    h0, e0 = got(a, 'activate'), got(v, 'error'); v.ev("(n) => atriumClient.activate(n)", far); a.page.wait_for_timeout(800)
    print('   far, honest view: forwarded', got(a, 'activate') - h0, [e.get('code') for e in of(v.ws, 'error', '<')[e0:]])
    v.ev("() => atriumClient.setView({ position: [8, 0, -58] })"); v.page.wait_for_timeout(800)
    h0, e0 = got(a, 'activate'), got(v, 'error'); v.ev("(n) => atriumClient.activate(n)", far); a.page.wait_for_timeout(800)
    check('6 a view next to a far object, then activate: forwarded (P8, expected)', got(a, 'activate') - h0 == 1 and got(v, 'error') == e0, (got(a, 'activate') - h0, of(v.ws, 'error', '<')[e0:]))
    v.ev("() => atriumClient.setView({ position: [0, 0.7, 0] })"); v.page.wait_for_timeout(800)
    a.edit_on(); plain = add_cube(a); a.ev(MOVE, {'name': plain, 't': [4, 2, -1]}); edit_off(a); v.page.wait_for_timeout(500)
    e0 = got(v, 'error'); v.ev("(n) => atriumClient.activate(n)", plain); v.page.wait_for_timeout(800)
    errs = [(e.get('code'), e.get('message')) for e in of(v.ws, 'error', '<')[e0:]]
    check('6 activate for a cube with no behaviour: INVALID_FIELD (console only)', [c for c, _ in errs] == ['INVALID_FIELD'] and v.ev(NOTICE) == '', (errs, v.ev(NOTICE)))

    print("\n== 7. the host's own click at 15 m, then 5 m (AC-L3 (a))")
    a.edit_on(); a.ev(MOVE, {'name': x, 't': [0, 0.5, -15]}); edit_off(a); a.page.wait_for_timeout(500)
    print('   A avatar', avatar(a), '| X at', dist(avatar(a), [0, 0.5, -15]), 'm | pick', pick_at(a, x))
    b, n0, s0 = a.ev(VIS, y)['obj'], sent(a, 'activate'), len(a.ev('window.__sel')); click_node(a, x); nt = a.ev(NOTICE)
    print('   select outcomes', a.ev('window.__sel')[s0:])
    check('7 at 15 m: the notice, nothing runs, nothing sent', nt == 'Move closer to use this.' and a.ev(VIS, y)['obj'] is b and sent(a, 'activate') == n0, (nt, a.ev(VIS, y)))
    a.edit_on(); a.ev(MOVE, {'name': x, 't': [0, 0.5, -5]}); edit_off(a); a.page.wait_for_timeout(500)
    b = a.ev(VIS, y)['obj']; click_node(a, x); a.page.wait_for_timeout(500)
    check('7 at 5 m: it runs', a.ev(VIS, y)['obj'] is (not b) and v.ev(VIS, y)['obj'] is (not b), (b, a.ev(VIS, y), a.ev('window.__sel')[-1:]))

    print('\n== 8. the host in Edit mode')
    a.edit_on(); a.page.wait_for_timeout(300); b = a.ev(VIS, y)['obj']
    click_node(v, x); a.page.wait_for_timeout(800)
    check("8 a visitor's click still runs the behaviour", a.ev(VIS, y)['obj'] is (not b) and v.ev(VIS, y)['obj'] is (not b), (b, a.ev(VIS, y)))
    b = a.ev(VIS, y)['obj']; a.ev('__ep().selectForEdit(null)'); click_node(a, x); a.page.wait_for_timeout(500)
    check("8 the host's own click selects", a.ev('__ep().selected?.name ?? null') == x and a.ev(VIS, y)['obj'] is b, (a.ev('__ep().selected?.name ?? null'), a.ev(VIS, y)))

    print('\npage errors: A', a.errors[:3], '| A2', a2.errors[:3], '| V', v.errors[:3])
    print('A warnings', [c[:140] for c in a.console if c.startswith('warning') and 'GL Driver' not in c][-4:])
    br.close()
print('\nFAILS:', fails or 'none'); sys.exit(1 if fails else 0)
