# Round 5 form checks, part 2: Remove's picker, Custom graph (S1), missing clip in the panel log, the non-host
# text, the hints per template, select-light in the lights world.
exec(open(__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)), 'f1b.py')).read().split('\nwith sync_playwright() as pw:')[0])
STATE = "() => { const s = __beh().behaviorForm.state; return { open: s.open, node: s.node?.name, template: s.template, custom: s.custom, enabled: s.enabled, saved: !!s.saved } }"
with sync_playwright() as pw:
    br = new_browser(pw)
    W = 'wss://127.0.0.1:8443/w/form2' + T
    a = Page(br); a.connect(W); a.edit_on(); v = Page(br); v.connect(W + '?visitor')
    y = add_cube(a); a.ev(MOVE, {'name': y, 't': [1.5, 0.5, -5]})
    fox = add_model(a, FOX, scale=0.01); a.page.wait_for_timeout(2500); a.ev(MOVE, {'name': fox, 't': [3.5, 0, -7]})

    # Remove: what the picker shows afterwards.
    x2 = add_cube(a); a.ev(MOVE, {'name': x2, 't': [0, 0.5, -5]})
    print('R select', select(a, x2)); choose(a, 'select-visibility'); setp(a, 'target', label=y); print('R save', save(a, x2))
    a.page.click('#ep-behavior-remove'); a.page.wait_for_timeout(900)
    print('R after Remove: leaf', a.ev(LEAFV, x2), '| picker', a.ev(FORM)['tpl'], '| state', a.ev(STATE), '| runner', [e[0] for e in a.ev(RUN)['engines']])
    select(a, y); select(a, x2); print('R reselected: picker', a.ev(FORM)['tpl'], a.ev(STATE))

    # Custom graph.
    x5 = add_cube(a); a.ev(MOVE, {'name': x5, 't': [-3, 0.5, -5]})
    val = a.ev(TPL, {'id': 'select-visibility', 'params': {'target': a.ev(OID, y) or a.ev(SETID, y), 'action': 'toggle'}, 'own': a.ev(OID, x5) or a.ev(SETID, x5)})
    val['template']['params']['action'] = 'show'
    print('C write custom', a.ev(SEND, {'name': x5, 'field': LEAF, 'value': val}), '| leaf', a.ev(LEAFV, x5))
    print('C selected', select(a, x5), '| state', a.ev(STATE))
    f = a.ev(FORM); print('C form', f['tpl'], '| enabled', f['enabled'], '| save', f['save'], '| remove', f['remove'], '| status', repr(f['status']))
    if not f['enabled']['disabled']:
        g0 = a.ev("(n) => JSON.stringify(atriumClient.som.getNodeByName(n).extras.atrium.behavior.graph)", x5)
        a.page.click('#ep-behavior-enabled'); a.page.wait_for_timeout(800)
        print('C after Enabled: leaf enabled', a.ev(LEAFV, x5)['enabled'], '| graph unchanged', g0 == a.ev("(n) => JSON.stringify(atriumClient.som.getNodeByName(n).extras.atrium.behavior.graph)", x5), '| status', repr(a.ev(FORM)['status']))
    # Does the form recognise a template value written the same way (not custom)?
    x8 = add_cube(a); a.ev(MOVE, {'name': x8, 't': [-3, 2, -5]})
    print('C write a template value by hand', behave(a, x8, 'select-visibility', {'target': y, 'action': 'toggle'}))
    print('C selected', select(a, x8), '| form', a.ev(FORM)['tpl'], a.ev(STATE))

    # Missing clip on a loaded Fox: the panel log.
    x6 = add_cube(a); a.ev(MOVE, {'name': x6, 't': [0, 2, -5]})
    print('M write NoSuchClip', behave(a, x6, 'select-animation', {'target': fox, 'clip': 'NoSuchClip', 'action': 'play', 'loop': True}))
    before = v.ev(ANIMV, fox); edit_off(a); click_node(a, x6); a.page.wait_for_timeout(800)
    select(a, x6); f = a.ev(FORM)
    print('M Fox unchanged', v.ev(ANIMV, fox) == before, '| runner log', a.ev(RUN)['log'][-1:], '| panel log', f['log'], '| log shown', a.ev("getComputedStyle(document.getElementById('ep-behavior-log')).display"))

    # Hints per template and the light template with no lights (this world has none).
    x7 = add_cube(a); select(a, x7)
    for t in ('select-visibility', 'select-animation', 'proximity-animation', 'select-light', 'interval-animation'):
        choose(a, t); f = a.ev(FORM)
        print(f'H {t:20} hint {f["hint"]!r} | save disabled {f["save"]["disabled"]} | target opts {[q.get("opts") for q in f["params"] if q["f"] == "target"]}')
    choose(a, 'None'); f = a.ev(FORM); print('H None: enabled', f['enabled'], '| save', f['save'], '| hint', repr(f['hint']))

    # A second owner tab: its Behaviour status line.
    b = Page(br); b.connect(W); print('N B role', b.ev('atriumClient.scriptHost'), '| B selects', select(b, x8))
    f = b.ev(FORM); print('N B status', repr(f['status']))
    edit_off(b); b0 = b.ev(VIS, y); click_node(b, x8); print('N B click: Y', b0, '->', b.ev(VIS, y))
    print('errors A', a.errors[:4], '| B', b.errors[:4]); b.close(); a.close(); v.close()

    # select-light in the lights world.
    KL = 'flt' + T; print('L put', put(KL, '/tmp/atrium-harness/wt/tests/fixtures/space-lights.gltf', 'file')[:30])
    c = Page(br); c.connect(f'wss://127.0.0.1:8443/w/{KL}'); c.edit_on()
    xl = add_cube(c); c.ev(MOVE, {'name': xl, 't': [0, 0.5, -5]}); select(c, xl); choose(c, 'select-light'); f = c.ev(FORM)
    print('L params', [(q['f'], q.get('label') or q['value'], q.get('opts')) for q in f['params']], '| hint', repr(f['hint']), '| save', f['save'])
    setp(c, 'target', label='Sun'); print('L save', save(c, xl))
    edit_off(c); seq = [c.ev(LIGHT, 'Sun')]
    for i in range(2):
        click_node(c, xl); c.page.wait_for_timeout(600); seq.append(c.ev(LIGHT, 'Sun'))
    print('L Sun intensity before, click 1, click 2', seq, '| errors', c.errors[:4])
    br.close()
