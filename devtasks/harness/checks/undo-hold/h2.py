# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
# undo-hold h2 — the operator's EARLIER report (2026-11-04): with a model spinning
# from an imported graph, a move by HANDLE DRAG couldn't be undone. h1 moved it
# through the panel. This drags the move handle (the gizmo's own events, as
# scripting-4b-2/o2.py does) and looks at what the drag recorded and what Undo says.
# Server: checks/signin-sync/authserver.mjs with HOOKS=1.
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripting-4d'))
from common4d import *

# h1's spinner graph and measure, copied (h1 runs on import)
G = graph([
    {'op': 'event/onTick', 'flows': {'out': flow(4)}},
    getter('/nodes/0/rotation', 'float4'),
    {'op': 'math/quatFromAxisAngle', 'values': {'axis': lit('float3', [0, 1, 0]), 'angle': lit('float', 0.05)}},
    {'op': 'math/quatMul', 'values': {'a': sock(1), 'b': sock(2)}},
    setter('/nodes/0/rotation', 'float4', sock(3)),
])
yaw = lambda q: math.degrees(2 * math.atan2(q[1], q[3]))


def spinning(t, name, ms=1500):
    """(rotation sets this tab sent for `name` in `ms`, degrees the SOM node turned)."""
    n0 = len(t.ws); q0 = rot(t, name); t.page.wait_for_timeout(ms); q1 = rot(t, name)
    sent = [m for (d, m) in t.ws[n0:] if d == '>' and isinstance(m, dict) and m.get('type') == 'send'
            and m.get('node') == name and m.get('field') == 'rotation']
    return len(sent), round((yaw(q1) - yaw(q0)) % 360, 1)



DRAG = """() => { const e = __ep(); const g = e.gizmo, o = e.selectedObj; g.dispatchEvent({ type: 'dragging-changed', value: true });
  o.position.x += 0.5; g.dispatchEvent({ type: 'objectChange' }); return null }"""
END = "() => { __ep().gizmo.dispatchEvent({ type: 'dragging-changed', value: false }) }"
THREE_ROT = "(n) => { const o = __ep().selectedObj; return o ? o.quaternion.toArray() : null }"
UNDO_LABEL = "document.getElementById('ep-undo').title || document.getElementById('ep-undo').textContent"
ERR = "document.getElementById('ep-error').textContent"

with sync_playwright() as pw:
    br = new_browser(pw)
    print('register', register(br))
    ctx = br.new_context(ignore_https_errors=True, viewport={'width': 1280, 'height': 800})
    a = owner_tab(ctx, 'A', first=True)
    W = new_world(a, 'uh2'); print('A connected', a.connect(W)); a.page.wait_for_timeout(800)
    a.edit_on()
    x = add_cube(a); a.ev(MOVE, {'name': x, 't': [-1.5, 0.5, -3]}); a.page.wait_for_timeout(300)
    import_graph(a, x, gltf_doc(G, ['Spinner']), 'spin.gltf', {'Spinner (node)': x})
    set_enabled(a, x, True)
    a.edit_on(); select_node(a, x); a.page.wait_for_timeout(1500)
    print('spinning before the drag:', spinning(a, x))
    print('at drag start: SOM rotation', [round(c, 4) for c in rot(a, x)], '| three.js object', [round(c, 4) for c in a.ev(THREE_ROT, x)])

    n0 = len(a.ws)
    a.ev(DRAG); a.page.wait_for_timeout(250); a.ev(END); a.page.wait_for_timeout(1200)
    sent = [(m.get('field'), m.get('value')) for (d, m) in a.ws[n0:] if d == '>' and isinstance(m, dict) and m.get('type') == 'send' and m.get('node') == x]
    own = [f for f, _ in sent]
    print('the drag sent fields:', sorted(set(own)), f'({len(sent)} sends incl. the behaviour\'s)')
    label = a.ev(UNDO_LABEL); print('Undo button:', label)
    check('the drag recorded a plain Move (not a Transform with rotation)', label.startswith('Undo Move'), label)
    a.page.wait_for_timeout(1500)
    a.page.click('#ep-undo'); a.page.wait_for_timeout(1200)
    msg = a.ev(ERR); print('after Undo: translation', tr(a, x), '| message:', repr(msg))
    check('Undo put the drag back', abs(tr(a, x)[0] - (-1.5)) < 1e-6 and not msg, (tr(a, x), msg))
    print('   runner log:', rlog(a, 3))
    print('\npage errors:', a.errors[:3])
    br.close()
print('\nFAILS:', fails or 'none'); sys.exit(1 if fails else 0)
