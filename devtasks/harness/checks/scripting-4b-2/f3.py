# Round 6 — the form cases f1 doesn't reach: a multi-stage Save on a node with no object id (its own echoes must
# not cancel it, W3/M4), a leaf arriving while its node is selected (W3), another tab's change over an unsaved edit
# (W3 "Changed in another tab"), and proximity in a clean world with a second avatar inside.
exec(open(__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)), 'f1.py')).read().split('\nwith sync_playwright() as pw:')[0])
STATE = "() => { const s = __beh().behaviorForm.state; return { open: s.open, node: s.node?.name, template: s.template, custom: s.custom, saving: !!s.saving } }"
with sync_playwright() as pw:
    br = new_browser(pw)
    W = 'wss://127.0.0.1:8443/w/f3' + T
    a = Page(br); a.connect(W); a.edit_on()

    # S — crate-01 (a fixture node) has no objectId: Save is setObjectId, then the leaf.
    print('S crate-01 id before', a.ev(OID, 'crate-01'))
    y = add_cube(a); a.ev(MOVE, {'name': y, 't': [1.5, 0.5, -5]})
    a.ev(SEL, 'crate-01'); a.page.wait_for_timeout(300); choose(a, 'select-visibility')
    setp(a, 'target', label=y); setp(a, 'action', label='toggle')
    statuses = []
    a.page.click('#ep-behavior-save')
    for i in range(20):
        statuses.append(a.ev(FORM)['status']); a.page.wait_for_timeout(150)
    print('S statuses seen', sorted(set(statuses)), '| id after', a.ev(OID, 'crate-01'), '| leaf', a.ev(LEAFV, 'crate-01'), '| form', a.ev(STATE))

    # W3a — X selected with no behaviour; its leaf is written (as another tab would); the open form follows.
    x = add_cube(a); a.ev(MOVE, {'name': x, 't': [-1.5, 0.5, -5]}); a.ev(SEL, x); a.page.wait_for_timeout(300)
    print('W3a before', a.ev(FORM)['tpl'], a.ev(STATE))
    print('W3a write', behave(a, x, 'select-visibility', {'target': y, 'action': 'toggle'})); a.page.wait_for_timeout(500)
    f = a.ev(FORM); print('W3a after (no reselect)', f['tpl'], '| target', [q.get('label') for q in f['params'] if q['f'] == 'target'], '| enabled', f['enabled'], '| remove', f['remove'], '| status', repr(f['status']))

    # W3e — tab B rewrites X's leaf while A has an unsaved change in its picker.
    b = Page(br); b.connect(W); b.edit_on()
    choose(a, 'select-animation'); print('W3e A unsaved picker', a.ev(FORM)['tpl'])
    leaf = b.ev("(n) => atriumClient.som.getNodeByName(n).extras.atrium.behavior", x); leaf2 = dict(leaf); leaf2['enabled'] = False
    print('W3e B writes', b.ev(SEND, {'name': x, 'field': LEAF, 'value': leaf2})); a.page.wait_for_timeout(700)
    f = a.ev(FORM); print('W3e A after', f['tpl'], '| enabled', f['enabled'], '| status', repr(f['status']))
    b.close()

    # P — proximity in a clean world: a visitor avatar stays at spawn; the owner walks away.
    W2 = 'wss://127.0.0.1:8443/w/prox' + T
    c = Page(br); c.connect(W2); c.edit_on(); v = Page(br); v.connect(W2 + '?visitor')
    fox = add_model(c, FOX, scale=0.01); c.page.wait_for_timeout(2500); c.ev(MOVE, {'name': fox, 't': [3, 0, -6]})
    px = add_cube(c); c.ev(MOVE, {'name': px, 't': [0, 0, -40]})
    print('P write', behave(c, px, 'proximity-animation', {'target': fox, 'clip': 'Walk', 'loop': True, 'radius': 3}))
    c.ev(MOVE, {'name': px, 't': [0, 0, 0]}); c.page.wait_for_timeout(1500); print('P both avatars inside (enter)', v.ev(ANIMV, fox))
    me = c.ev("() => atriumClient._avatarNodeName ?? null")
    c.ev("(n) => { const a = atriumClient.som.getNodeByName(n); a.translation = [0, 0, 30] }", me); c.page.wait_for_timeout(1500)
    print('P owner left, visitor still inside', v.ev(ANIMV, fox))
    v.close(); c.page.wait_for_timeout(1500); print('P visitor gone too (exit)', c.ev(ANIMV, fox))
    print('errors', a.errors[:4], c.errors[:4])
    br.close()
