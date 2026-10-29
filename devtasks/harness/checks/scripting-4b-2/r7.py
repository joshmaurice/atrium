# Round 7 (X1–X6) in the page, on the DEV release 0c31ddc0: labelled rows, the no-animations model, the field
# check (and zero sends past it), shown == held through every step incl. the id-less Save, the scrolling panel.
import json
exec(open(__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)), 'f1.py')).read().split('\nwith sync_playwright() as pw:')[0])
SHOT = __import__('os').environ.get('HARNESS_ROOT', '/tmp/atrium-harness') + '/shots/4b-2-r7/'
__import__('os').makedirs(SHOT, exist_ok=True)
ROWS = """() => [...document.querySelectorAll('#ep-behavior-params > *')].map(r => { const c = r.querySelector('[data-field]');
  return { tag: r.tagName.toLowerCase(), cls: r.className, label: r.querySelector(':scope > span')?.textContent,
    field: c?.dataset.field, ctl: c?.tagName.toLowerCase(), aria: c?.getAttribute('aria-label'), wrapped: !!r.querySelector('label [data-field]'),
    text: c ? undefined : r.textContent.trim(), shown: c ? (c.tagName === 'SELECT' ? c.options[c.selectedIndex]?.textContent : c.type === 'checkbox' ? c.checked : c.value) : undefined,
    opts: c?.tagName === 'SELECT' ? [...c.options].map(o => o.textContent) : undefined } })"""
SH = """() => { const s = __beh().behaviorForm.state; const bad = [];
  for (const e of document.querySelectorAll('#ep-behavior-params [data-field]')) { const f = e.dataset.field;
    const held = f === 'target' ? s.targetId : s.params[f];
    let shown; if (e.tagName === 'SELECT') shown = e.value; else if (e.type === 'checkbox') shown = e.checked; else if (e.type === 'number') shown = e.value === '' ? NaN : Number(e.value); else shown = e.value;
    const same = (Number.isNaN(shown) && (held === undefined || held === null || Number.isNaN(held))) || shown === (held ?? (e.tagName === 'SELECT' ? '' : held));
    if (!same) bad.push({ f, shown, held }) }
  return bad.length ? bad : 'shown == held' }"""
SPY = """() => { const c = atriumClient; if (c.__spy) { c.__spy.n.length = 0; return 'reset' } const n = []; c.__spy = { n };
  for (const m of ['setObjectId', 'sendField']) { const o = c[m].bind(c); c[m] = (...a) => { n.push(m + ':' + a[0] + ':' + (a[1] ?? '')); return o(...a) } } return 'installed' }"""
SENT = "() => atriumClient.__spy?.n.filter(x => !x.includes('User-')) ?? []"
F = lambda p: {k: v for k, v in p.ev(FORM).items() if k in ('status', 'save')}

with sync_playwright() as pw:
    br = new_browser(pw)
    ctl(catalog='small')
    W = 'wss://127.0.0.1:8443/w/r7' + T
    a = Page(br); a.connect(W); a.edit_on(); a.ev(SPY)
    fox = add_model(a, FOX, scale=0.01); a.page.wait_for_timeout(2000); a.ev(MOVE, {'name': fox, 't': [3, 0, -6]})
    a.page.click('#ep-library'); a.page.wait_for_timeout(500)
    before = set(a.ev("atriumClient.som.nodes.map(n => n.name)"))
    a.page.locator('.lg-tile').first.click(); a.page.wait_for_timeout(2500)
    lib = [n for n in a.ev("atriumClient.som.nodes.map(n => n.name)") if n not in before][0]
    a.ev(MOVE, {'name': lib, 't': [-2, 0, -5]})

    # X1 — every template's rows
    cube = add_cube(a); a.ev(MOVE, {'name': cube, 't': [0, 0.5, -5]}); a.ev(SEL, cube); a.page.wait_for_timeout(300)
    for t in ('select-visibility', 'select-animation', 'proximity-animation', 'interval-animation', 'select-light'):
        choose(a, t); print('X1', t, [(r['tag'] + '.' + r['cls'], r['label'], r['field'], r['ctl'], r['aria'], r['wrapped']) for r in a.ev(ROWS)], '|', a.ev(SH))
    choose(a, 'proximity-animation'); a.page.screenshot(path=SHOT + 'x1-proximity.png', clip={'x': 1000, 'y': 0, 'width': 280, 'height': 800})

    # X2 — the library model (no clips), then the Fox
    for model in (lib, fox):
        a.ev(SEL, model); a.page.wait_for_timeout(400); choose(a, 'interval-animation'); a.page.wait_for_timeout(300)
        print(f'X2 [{model}] rows', [(r['label'], r['ctl'] or r['text'], r['shown'], r['opts']) for r in a.ev(ROWS)], '|', F(a), '|', a.ev(SH))
    a.ev(SEL, lib); a.page.wait_for_timeout(300); choose(a, 'interval-animation')
    a.page.screenshot(path=SHOT + 'x2-no-animations.png', clip={'x': 1000, 'y': 0, 'width': 280, 'height': 800})
    a.ev(SPY); r = a.ev("() => __beh().behaviorForm.save()"); a.page.wait_for_timeout(1200)
    print('X2 forced save() on the no-clips model ->', r, '| sends', a.ev(SENT), '| leaf', a.ev(LEAFV, lib), '|', F(a))

    # X3 — range problems on the Fox, then forced save
    a.ev(SEL, fox); a.page.wait_for_timeout(300); choose(a, 'proximity-animation')
    for v in ('0', '51', ''):
        setp(a, 'radius', fill=v); print(f'X3 radius {v!r}', F(a), '|', a.ev(SH))
    a.ev(SPY); a.ev("() => __beh().behaviorForm.save()"); a.page.wait_for_timeout(1200)
    print('X3 forced save() with radius empty -> sends', a.ev(SENT), '| leaf', a.ev(LEAFV, fox))
    choose(a, 'interval-animation')
    for v in ('0', '3601'):
        setp(a, 'seconds', fill=v); print(f'X3 seconds {v}', F(a))
    setp(a, 'seconds', fill='2'); setp(a, 'clip', label='Walk'); print('X3 valid', F(a), '|', a.ev(SH))
    a.ev(SPY); print('X3 save valid ->', save(a, fox) or '', a.ev(LEAFV, fox), '| sends', a.ev(SENT), '|', F(a))

    # X4 — a removed target shows the placeholder and disables Save
    y = add_cube(a); a.ev(MOVE, {'name': y, 't': [1.5, 0.5, -5]})
    a.ev(SEL, cube); a.page.wait_for_timeout(300); choose(a, 'select-visibility'); setp(a, 'target', label=y); save(a, cube)
    print('X4 before removal', [(r['field'], r['shown']) for r in a.ev(ROWS)], a.ev(SH))
    a.ev("(n) => atriumClient.removeNode(n)", y); a.page.wait_for_timeout(1000)
    a.ev(SEL, fox); a.page.wait_for_timeout(200); a.ev(SEL, cube); a.page.wait_for_timeout(400)
    print('X4 after removal', [(r['field'], r['shown'], r['opts']) for r in a.ev(ROWS)], '|', F(a), '|', a.ev(SH))
    a.close()

    # X6 + X4 — an id-less world (noid): clips found by node, target stays on Fox through Save, leaf written
    K = 'r7n' + T; Wn = f'wss://127.0.0.1:8443/w/{K}'
    s = Page(br); s.connect(Wn); s.edit_on()
    car = add_model(s, CESIUM); s.ev(MOVE, {'name': car, 't': [-3, 0, -6]})
    fx = add_model(s, FOX, scale=0.01); s.ev(MOVE, {'name': fx, 't': [3, 0, -6]}); s.page.wait_for_timeout(1500); s.close()
    doc = json.loads(http(f'/__doc?key={K}'))
    for n in doc.get('nodes', []):
        at = n.get('extras', {}).get('atrium', {})
        if at.get('model'): at.pop('objectId', None)
    urllib.request.urlopen(urllib.request.Request(A + f'/__put?key={K}b', data=json.dumps(doc).encode(), method='POST', headers={'content-type': 'model/gltf+json'}), context=_ctx).read()
    b = Page(br); b.connect(Wn + 'b'); b.edit_on(); b.page.wait_for_timeout(3000); b.ev(SPY)
    print('X6 ids', {n: b.ev(OID, n) for n in (car, fx)})
    c2 = add_cube(b); b.ev(MOVE, {'name': c2, 't': [0, 0.5, -5]}); b.ev(SEL, c2); b.page.wait_for_timeout(300)
    choose(b, 'proximity-animation'); print('X6 chosen', [(r['field'], r['ctl'], r['shown']) for r in b.ev(ROWS)], b.ev(SH))
    setp(b, 'target', label=fx); b.page.wait_for_timeout(400)
    print('X6 Fox picked', [(r['field'], r['ctl'], r['shown'], r['opts']) for r in b.ev(ROWS)], '|', F(b), '|', b.ev(SH))
    try: setp(b, 'clip', label='Walk')
    except Exception as e: print('X6 no clip select:', str(e)[:80])
    save(b, c2)
    print('X6 after Save', [(r['field'], r['shown']) for r in b.ev(ROWS)], '|', b.ev(SH), '|', F(b), '| Fox id', b.ev(OID, fx), '| leaf', b.ev(LEAFV, c2), '| sends', b.ev(SENT))
    # the noid sequence with a REFUSED stage 3: a fresh id-less model, the leaf write stubbed to be refused by the server
    b.ev(SEL, car); b.page.wait_for_timeout(200); b.ev(SEL, c2); b.page.wait_for_timeout(300)
    print('X6 reopen', [(r['field'], r['shown']) for r in b.ev(ROWS)], b.ev(SH))

    # X5 — a short window: the panel scrolls, the last control is reachable, a wheel over it doesn't move the camera
    b.page.set_viewport_size({'width': 800, 'height': 600}); b.page.wait_for_timeout(500)
    m = b.ev("""() => { const p = document.getElementById('edit-panel'); const cs = getComputedStyle(p); const r = p.getBoundingClientRect();
      return { maxH: cs.maxHeight, ovf: cs.overflowY, osb: cs.overscrollBehaviorY, h: Math.round(r.height), bottom: Math.round(r.bottom), win: innerHeight, scrollH: p.scrollHeight, clientH: p.clientHeight } }""")
    print('X5 panel', m)
    cam0 = b.ev("() => stage.camera.position.toArray().map(v => +v.toFixed(3))")
    b.ev("() => { const n = stage.nav; if (!n.__w) { const o = n.onWheel.bind(n); n.__w = { c: 0 }; n.onWheel = (d) => { n.__w.c++; return o(d) } } n.__w.c = 0 }")
    b.page.mouse.move(700, 300)
    for _ in range(12): b.page.mouse.wheel(0, 400); b.page.wait_for_timeout(60)
    b.page.wait_for_timeout(400)
    last = b.ev("""() => { const p = document.getElementById('edit-panel'); const els = [...p.querySelectorAll('button, select, input, summary')].filter(e => e.offsetParent);
      const e = els[els.length - 1]; const r = e.getBoundingClientRect(); return { last: e.id || e.textContent, top: Math.round(r.top), bottom: Math.round(r.bottom), win: innerHeight, scrollTop: p.scrollTop } }""")
    cam1 = b.ev("() => stage.camera.position.toArray().map(v => +v.toFixed(3))")
    print('X5 after wheel over panel', last, '| nav.onWheel calls', b.ev('() => stage.nav.__w.c'), '| camera unchanged', cam0 == cam1, cam0, cam1)
    b.page.screenshot(path=SHOT + 'x5-scrolled.png')
    b.ev("() => { stage.nav.__w.c = 0 }"); hit = b.ev("() => document.elementFromPoint(300, 300)?.tagName + '#' + (document.elementFromPoint(300, 300)?.id || '')")
    for _ in range(6): b.page.mouse.move(300, 300); b.page.mouse.wheel(0, 400); b.page.wait_for_timeout(80)
    b.page.wait_for_timeout(600); print('X5 wheel over the canvas (control)', hit, '| nav.onWheel calls', b.ev('() => stage.nav.__w.c'))
    print('errors', a.errors[:4], b.errors[:4])
    br.close()
