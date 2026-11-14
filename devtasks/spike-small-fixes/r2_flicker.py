# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
#
# small-fixes: "Move to" flickers while a behaviour turns the selected object (SF-2).
# The operator's 2-rotation.gltf graph (onTick -> quatMul -> pointer/set on
# /nodes/0/rotation, 0.05 rad a tick about Y), imported onto a cube through the
# panel, as h5.py does. With the cube selected in Edit, this counts in 2 s:
# changes of Move to / Group / Ungroup's `disabled` and `title`, and rebuilds of
# Move to's options; with the spinner off, then on. Then a real mouse choice
# from Move to while it spins.
# Server: checks/signin-sync/authserver.mjs with HOOKS=1.
#   HARNESS_ROOT=/tmp/atrium-harness python3 devtasks/spike-small-fixes/r2_flicker.py [--expect-fixed]
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'harness', 'checks', 'scripting-4d'))
from common4d import *
FIXED = '--expect-fixed' in sys.argv
G = graph([
    {'op': 'event/onTick', 'flows': {'out': flow(4)}},
    getter('/nodes/0/rotation', 'float4'),
    {'op': 'math/quatFromAxisAngle', 'values': {'axis': lit('float3', [0, 1, 0]), 'angle': lit('float', 0.05)}},
    {'op': 'math/quatMul', 'values': {'a': sock(1), 'b': sock(2)}},
    setter('/nodes/0/rotation', 'float4', sock(3)),
])
WATCH = """() => { const ids = ['ep-move-to', 'ep-group', 'ep-ungroup']; window.__flk = {}
  for (const id of ids) {
    const el = document.getElementById(id); const c = window.__flk[id] = { disabled: 0, title: 0, options: 0, log: [] }
    let last = { d: el.disabled, t: el.title }
    new MutationObserver((l) => { for (const m of l) {
      if (m.type === 'childList') c.options++
      else if (m.attributeName === 'disabled' && el.disabled !== last.d) { c.disabled++; if (c.log.length < 6) c.log.push((el.disabled ? 'off ' : 'on ') + el.title); last.d = el.disabled }
      else if (m.attributeName === 'title' && el.title !== last.t) { c.title++; last.t = el.title } } })
      .observe(el, { attributes: true, childList: true }) } }"""
COUNT = "() => JSON.parse(JSON.stringify(window.__flk))"
RESET = "() => { for (const c of Object.values(window.__flk)) { c.disabled = 0; c.title = 0; c.options = 0; c.log = [] } }"
STATE = "() => ({ pending: __ep().gate?.pendingCount ?? null, dis: document.getElementById('ep-move-to').disabled, title: document.getElementById('ep-move-to').title })"

def counts(t, ms=2000):
    t.ev(RESET); t.page.wait_for_timeout(ms); return t.ev(COUNT)

with sync_playwright() as pw:
    br = new_browser(pw)
    print('register', register(br))
    ctx = br.new_context(ignore_https_errors=True, viewport={'width': 1280, 'height': 900})
    a = owner_tab(ctx, 'A', first=True)
    W = new_world(a, 'sf2'); print('A connected', a.connect(W)); a.page.wait_for_timeout(800)
    a.edit_on()
    x = add_cube(a); a.ev(MOVE, {'name': x, 't': [-1.5, 0.5, -3]}); a.page.wait_for_timeout(300)
    y = add_cube(a); a.ev(MOVE, {'name': y, 't': [1.5, 0.5, -3]}); a.page.wait_for_timeout(300)
    # an empty group, so Move to has a destination (Group on y, then Ungroup leaves... no: Group y, the group is a destination)
    select_node(a, y); a.page.click('#ep-group'); a.page.wait_for_timeout(1200)
    imp = import_graph(a, x, gltf_doc(G, ['Spinner']), '2-rotation.gltf', {'Spinner (node)': x})
    print('import status:', imp.get('after', {}).get('status'))
    a.edit_on(); select_node(a, x); a.page.wait_for_timeout(500)
    a.ev(WATCH)
    idle = counts(a); print('spinner off: in 2 s', {k: {kk: v[kk] for kk in ('disabled', 'title', 'options')} for k, v in idle.items()})
    set_enabled(a, x, True); a.edit_on(); select_node(a, x); a.page.wait_for_timeout(800)
    r0 = rot(a, x); a.page.wait_for_timeout(500); r1 = rot(a, x)
    print('spinning:', r0 != r1, '| state', a.ev(STATE))
    busy = counts(a); print('spinner on: in 2 s', {k: {kk: v[kk] for kk in ('disabled', 'title', 'options')} for k, v in busy.items()})
    print('   Move to log:', busy['ep-move-to']['log'])
    check('the spinner runs (the rotation changes)', r0 != r1, (r0, r1))
    check('spinner off: Move to, Group, Ungroup steady', all(v['disabled'] == 0 and v['options'] == 0 for v in idle.values()), idle)
    flick = {k: v['disabled'] + v['title'] for k, v in busy.items()}
    if FIXED:
        check('spinner on: Move to, Group and Ungroup do not flicker', all(n == 0 for n in flick.values()), flick)
        check('spinner on: Move to options not rebuilt', busy['ep-move-to']['options'] == 0, busy['ep-move-to'])
    else:
        check('(bug) spinner on: Move to flickers', flick['ep-move-to'] > 0, flick)
        print('   Group / Ungroup changes:', flick['ep-group'], flick['ep-ungroup'])
    br.close()
print('\nFAILS:', fails or 'none'); sys.exit(1 if fails else 0)
