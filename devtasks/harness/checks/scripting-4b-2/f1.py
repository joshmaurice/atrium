# scripting-4b-2 round 5 — §5.1 THROUGH THE BEHAVIOUR FORM (real <select> choices, real button clicks,
# canvas clicks for selection and triggering). Base: rt2's helpers.
exec(open(__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)), 'rt2.py')).read().split('\nwith sync_playwright() as pw:')[0])

FORM = """() => { const $ = (id) => document.getElementById(id); const sel = $('ep-behavior-template');
  const shown = (e) => !!e && getComputedStyle(e).display !== 'none';
  return { open: __beh().behaviorForm.openState, row: shown($('ep-behavior-row')), tpl: sel?.value,
    options: sel ? [...sel.options].map(o => o.value) : [],
    params: [...document.querySelectorAll('#ep-behavior-params [data-field]')].map(e => ({ f: e.dataset.field, tag: e.tagName.toLowerCase(), type: e.type,
      value: e.type === 'checkbox' ? e.checked : e.value, label: e.tagName === 'SELECT' ? e.options[e.selectedIndex]?.textContent : undefined,
      opts: e.tagName === 'SELECT' ? [...e.options].map(o => o.textContent) : undefined })),
    hint: shown($('ep-behavior-hint')) ? $('ep-behavior-hint').innerText : null,
    status: $('ep-behavior-status').textContent, note: $('ep-behavior-note').textContent,
    enabled: { text: $('ep-behavior-enabled').textContent, disabled: $('ep-behavior-enabled').disabled },
    save: { text: $('ep-behavior-save').textContent, disabled: $('ep-behavior-save').disabled },
    remove: { disabled: $('ep-behavior-remove').disabled },
    log: [...document.querySelectorAll('#ep-behavior-log-lines > div')].map(d => d.textContent).slice(-4) } }"""
LEAFV = """(n) => { const b = atriumClient.som.getNodeByName(n)?.extras?.atrium?.behavior; return b === undefined ? 'absent' : b === null ? null : { tpl: b.template?.id, params: b.template?.params, enabled: b.enabled } }"""
SEL = "(n) => { try { __ep().selectForEdit(atriumClient.som.getNodeByName(n)); return null } catch (e) { return String(e).slice(0, 100) } }"
P = '#ep-behavior-params [data-field={}]'


def select(p, name):
    """Select in Edit mode with a real canvas click; fall back to selectForEdit if the node is off-screen."""
    p.edit_on(); r = click_node(p, name)
    if not r['clicked'] or p.ev('__ep().selected?.name ?? null') != name:
        err = p.ev(SEL, name)
        if err: print('   selectForEdit threw', err)
    p.page.wait_for_timeout(300)
    if not p.ev('__beh().behaviorForm.openState'):
        # ROUND-5 FINDING: after Edit off -> on, reselecting the same node leaves the form closed
        # (lastBehaviorNode isn't reset). Work around: select another node, then this one again.
        print('   [workaround] form closed after selecting', name, '- reselecting via another node')
        other = [n for n in p.ev("atriumClient.som.nodes.filter(n => !n.extras?.atrium?.ephemeral && n.mesh).map(n => n.name)") if n != name][:1]
        if other: p.ev(SEL, other[0]); p.page.wait_for_timeout(200)
        p.ev(SEL, name); p.page.wait_for_timeout(300)
    return p.ev('__ep().selected?.name ?? null')


_add_cube = add_cube
def add_cube(p):
    p.edit_on(); return _add_cube(p)


def choose(p, tpl):
    p.page.select_option('#ep-behavior-template', tpl); p.page.wait_for_timeout(250)


def setp(p, field, label=None, value=None, check=None, fill=None):
    s = P.format(field)
    if label is not None: p.page.select_option(s, label=label)
    if value is not None: p.page.select_option(s, value=value)
    if check is not None: (p.page.check if check else p.page.uncheck)(s)
    if fill is not None: p.page.fill(s, str(fill)); p.page.press(s, 'Tab')
    p.page.wait_for_timeout(200)


def save(p, name):
    p.page.click('#ep-behavior-save')
    try:
        p.wait("(n) => { const b = atriumClient.som.getNodeByName(n)?.extras?.atrium?.behavior; return !!b && document.getElementById('ep-behavior-save').textContent === 'Save' }", arg=name, timeout=8000)
    except Exception as e:
        print('   save did not land', str(e)[:80])
    p.page.wait_for_timeout(500)
    return p.ev(LEAFV, name)


with sync_playwright() as pw:
    br = new_browser(pw)
    W = 'wss://127.0.0.1:8443/w/form' + T
    a = Page(br); a.connect(W); a.edit_on()
    v = Page(br); v.connect(W + '?visitor')
    x = add_cube(a); a.ev(MOVE, {'name': x, 't': [-1.5, 0.5, -5]})
    y = add_cube(a); a.ev(MOVE, {'name': y, 't': [1.5, 0.5, -5]})
    fox = add_model(a, FOX, scale=0.01); a.page.wait_for_timeout(2500); a.ev(MOVE, {'name': fox, 't': [3.5, 0, -7]})

    # ---- F1 select-visibility through the form: choose, the default target (V11), the hint (T1), pick Y, Save.
    print('F1 selected', select(a, x))
    f = a.ev(FORM); print('F1 closed form: tpl', f['tpl'], '| options', f['options'], '| enabled', f['enabled'], '| save', f['save'], '| note', f['note'])
    choose(a, 'select-visibility'); f = a.ev(FORM)
    print('F1 params', [(q['f'], q['tag'], q.get('label') or q['value']) for q in f['params']], '| hint', repr(f['hint']), '| save', f['save'])
    setp(a, 'target', label=y); setp(a, 'action', label='toggle')
    print('F1 save ->', save(a, x), '| status', repr(a.ev(FORM)['status']), '| Y id', a.ev(OID, y))
    edit_off(a); b0 = a.ev(VIS, y); click_node(a, x); a.page.wait_for_timeout(400)
    print('F1 click X: Y', b0, '->', a.ev(VIS, y), '| visitor', v.ev(VIS, y))

    # ---- F2 Enabled (V2): reopen, the form shows the saved choice, click Enabled -> Disabled, a click does nothing, back.
    select(a, x); f = a.ev(FORM)
    print('F2 reopened: tpl', f['tpl'], '| target', [q.get('label') for q in f['params'] if q['f'] == 'target'], '| enabled', f['enabled'], '| status', repr(f['status']))
    a.page.click('#ep-behavior-enabled'); a.page.wait_for_timeout(800); f = a.ev(FORM)
    print('F2 after Enabled click: leaf', a.ev(LEAFV, x), '| button', f['enabled'], '| status', repr(f['status']))
    edit_off(a); b0 = a.ev(VIS, y); click_node(a, x); print('F2 click X while disabled: Y', b0, '->', a.ev(VIS, y))
    select(a, x); a.page.click('#ep-behavior-enabled'); a.page.wait_for_timeout(800)
    print('F2 re-enabled: leaf', a.ev(LEAFV, x), '| button', a.ev(FORM)['enabled'], '| runner', a.ev(RUN)['engines'])

    # ---- F3 the hidden Y: selectable in Edit mode, Visible un-hides (V4), Undo hides again, Redo shows.
    if a.ev(VIS, y)['som']:
        edit_off(a); click_node(a, x); a.page.wait_for_timeout(400)
    print('F3 Y hidden', a.ev(VIS, y), '| selected by a click on it', select(a, y), '| #ep-visible', a.ev("document.getElementById('ep-visible').checked"))
    n0 = len(a.errors); a.page.click('#ep-visible'); a.page.wait_for_timeout(900)
    print('F3 after Visible: Y', a.ev(VIS, y), '| visitor', v.ev(VIS, y), '| errors', a.errors[n0:])
    a.page.click('#ep-undo'); a.page.wait_for_timeout(900); print('F3 after Undo: Y', a.ev(VIS, y), '| visitor', v.ev(VIS, y))
    a.page.click('#ep-redo'); a.page.wait_for_timeout(900); print('F3 after Redo: Y', a.ev(VIS, y), '| visitor', v.ev(VIS, y))

    # ---- F4 select-animation through the form: the picker offers models only, the clip is a <select> of the Fox's clips (V5).
    x2 = add_cube(a); a.ev(MOVE, {'name': x2, 't': [0, 0.5, -5]}); select(a, x2); choose(a, 'select-animation'); f = a.ev(FORM)
    print('F4 params', [(q['f'], q['tag'], q.get('opts') or q['value']) for q in f['params']], '| hint', repr(f['hint']), '| save', f['save'])
    setp(a, 'target', label=fox); f = a.ev(FORM); print('F4 clip field after picking the Fox', [(q['tag'], q.get('opts')) for q in f['params'] if q['f'] == 'clip'])
    try:
        setp(a, 'clip', label='Run')
    except Exception as e:
        setp(a, 'clip', fill='Run'); print('   clip was a text box', str(e)[:60])
    setp(a, 'action', label='play'); setp(a, 'loop', check=True)
    print('F4 save ->', save(a, x2))
    edit_off(a); click_node(a, x2); a.page.wait_for_timeout(800)
    print('F4 click X2: visitor sees the Fox', v.ev(ANIMV, fox), '| log', a.ev(RUN)['log'][-2:])

    # ---- F5 interval-animation on the Fox itself through the form, every 2 s.
    select(a, fox); choose(a, 'interval-animation'); f = a.ev(FORM)
    print('F5 default target (V11: the Fox itself)', [q.get('label') for q in f['params'] if q['f'] == 'target'], '| params', [q['f'] for q in f['params']])
    setp(a, 'clip', label='Survey'); setp(a, 'loop', check=False); setp(a, 'seconds', fill=2)
    print('F5 save ->', save(a, fox)); edit_off(a)
    seen = []
    for i in range(7):
        seen.append(v.ev(ANIMV, fox)); v.page.wait_for_timeout(1000)
    starts = sorted({s['startedAt'] for s in seen if s and s.get('startedAt')})
    print('F5 distinct startedAt over 7 s', len(starts), [b_ - a_ for a_, b_ in zip(starts, starts[1:])], '| last', seen[-1])

    # ---- F6 proximity-animation: radius 3; both avatars at spawn are inside.
    x4 = add_cube(a); select(a, x4); choose(a, 'proximity-animation'); setp(a, 'target', label=fox)
    setp(a, 'clip', label='Walk'); setp(a, 'loop', check=True); setp(a, 'radius', fill=3); print('F6 save ->', save(a, x4))
    a.ev(MOVE, {'name': x4, 't': [0, 0, -40]}); a.page.wait_for_timeout(1500); print('F6 X4 far away', v.ev(ANIMV, fox))
    a.ev(MOVE, {'name': x4, 't': [0, 0, 0]}); a.page.wait_for_timeout(1500); print('F6 X4 at spawn (enter)', v.ev(ANIMV, fox))
    a.ev(MOVE, {'name': x4, 't': [0, 0, -40]}); a.page.wait_for_timeout(1500); print('F6 X4 away again (exit)', v.ev(ANIMV, fox))

    # ---- F7 Remove.
    select(a, x2); a.page.click('#ep-behavior-remove'); a.page.wait_for_timeout(900)
    print('F7 after Remove: leaf', a.ev(LEAFV, x2), '| form', a.ev(FORM)['tpl'], '| runner', [e[0] for e in a.ev(RUN)['engines']])

    # ---- F8 Custom graph (S1): a valid leaf whose params don't regenerate its graph; Enabled works and keeps the graph.
    x5 = add_cube(a); a.ev(MOVE, {'name': x5, 't': [-3, 0.5, -5]})
    val = a.ev(TPL, {'id': 'select-visibility', 'params': {'target': a.ev(OID, y), 'action': 'toggle'}, 'own': a.ev(OID, x5) or a.ev(SETID, x5)})
    val['template']['params']['action'] = 'show'          # params no longer regenerate the graph
    print('F8 write custom', a.ev(SEND, {'name': x5, 'field': LEAF, 'value': val}))
    select(a, x5); f = a.ev(FORM); print('F8 form', f['tpl'], '| enabled', f['enabled'], '| save', f['save'], '| remove', f['remove'])
    g0 = a.ev("(n) => JSON.stringify(atriumClient.som.getNodeByName(n).extras.atrium.behavior.graph)", x5)
    a.page.click('#ep-behavior-enabled'); a.page.wait_for_timeout(800)
    print('F8 after Enabled: leaf enabled', a.ev(LEAFV, x5)['enabled'], '| graph unchanged', g0 == a.ev("(n) => JSON.stringify(atriumClient.som.getNodeByName(n).extras.atrium.behavior.graph)", x5))

    # ---- F9 a missing clip (S7 live): written by hand on a loaded Fox; a click logs the refusal in the panel.
    x6 = add_cube(a); a.ev(MOVE, {'name': x6, 't': [0, 2, -5]})
    print('F9 write NoSuchClip', behave(a, x6, 'select-animation', {'target': fox, 'clip': 'NoSuchClip', 'action': 'play', 'loop': True}))
    before = v.ev(ANIMV, fox); edit_off(a); click_node(a, x6); a.page.wait_for_timeout(800)
    select(a, x6); f = a.ev(FORM)
    print('F9 Fox unchanged', v.ev(ANIMV, fox) == before, '| runner log', a.ev(RUN)['log'][-2:], '| panel log', f['log'])

    # ---- F10 a second owner tab: the Behaviour status text on a non-host (check 4).
    b = Page(br); b.connect(W); print('F10 B role', b.ev('atriumClient.scriptHost'), '| B selects X', select(b, x))
    f = b.ev(FORM); print('F10 B status', repr(f['status']), '| note', repr(f['note']))
    edit_off(b); b0 = b.ev(VIS, y); click_node(b, x); print('F10 B click X: Y', b0, '->', b.ev(VIS, y))
    b.close()

    # ---- F11 the hint lines for each template (round 3's T1) and the light template with no lights (V11).
    x7 = add_cube(a); select(a, x7)
    for t in ('select-visibility', 'select-animation', 'proximity-animation', 'select-light', 'interval-animation'):
        choose(a, t); f = a.ev(FORM); print(f'F11 {t:20} hint {f["hint"]!r} | save disabled {f["save"]["disabled"]} | target {[q.get("opts") for q in f["params"] if q["f"] == "target"]}')
    choose(a, 'None'); print('F11 None', a.ev(FORM)['enabled'], a.ev(FORM)['save'])
    print('errors A', a.errors[:6], '| V', v.errors[:4])
    a.close(); v.close()

    # ---- F12 select-light through the form in the lights world: the default target is a light (V11).
    KL = 'flt' + T; print('F12 put', put(KL, '/tmp/atrium-harness/wt/tests/fixtures/space-lights.gltf', 'file')[:40])
    c = Page(br); c.connect(f'wss://127.0.0.1:8443/w/{KL}'); c.edit_on()
    xl = add_cube(c); c.ev(MOVE, {'name': xl, 't': [0, 0.5, -5]}); select(c, xl); choose(c, 'select-light'); f = c.ev(FORM)
    print('F12 params', [(q['f'], q.get('label') or q['value'], q.get('opts')) for q in f['params']], '| hint', repr(f['hint']), '| save', f['save'])
    setp(c, 'target', label='Sun'); print('F12 save ->', save(c, xl))
    edit_off(c); seq = [c.ev(LIGHT, 'Sun')]
    for i in range(2):
        click_node(c, xl); c.page.wait_for_timeout(600); seq.append(c.ev(LIGHT, 'Sun'))
    print('F12 Sun intensity before, click 1, click 2', seq, '| errors', c.errors[:4])
    br.close()
