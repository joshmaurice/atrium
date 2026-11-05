# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
# undo-hold h3 — the round's browser check (PREBRIEF-undo-hold.md §5), on the
# published SHA. A cube spins with an imported onTick graph, Edit mode on, selected.
#   1 Undo of a panel move: the spinner sends and turns again within 1 s (h1's 3, turned round)
#   2 Redo of it: the same
#   3 Undo then a move of ANOTHER cube: the first keeps spinning throughout (h1's 4, turned round)
#   4 an Undo of a ROTATION while it spins: refused, "changed elsewhere" (unchanged, by design)
#   5 the drag rule still holds DURING a handle drag (sends dropped), and lets go at its end
#   6 scale: Undo of a panel scale while it spins: put back, spinner keeps going
# On 8ff7000 (before the fix) 1, 2, 3 and 6 FAIL (6 is the same stuck hold, after a
# scale Undo); 0, 4 and 5 pass. Note 2 on 8ff7000 is not a clean Redo repro: the
# hold is already stuck from 1.
# Server: checks/signin-sync/authserver.mjs with HOOKS=1 (see scripting-4d/README.md).
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripting-4d'))
from common4d import *

G = graph([
    {'op': 'event/onTick', 'flows': {'out': flow(4)}},
    getter('/nodes/0/rotation', 'float4'),
    {'op': 'math/quatFromAxisAngle', 'values': {'axis': lit('float3', [0, 1, 0]), 'angle': lit('float', 0.05)}},
    {'op': 'math/quatMul', 'values': {'a': sock(1), 'b': sock(2)}},
    setter('/nodes/0/rotation', 'float4', sock(3)),
])
SETF = """({ f, i, v }) => { const e = document.querySelector(`#edit-panel input[data-field="${f}"][data-i="${i}"]`);
  e.focus(); e.value = String(v); e.dispatchEvent(new Event('input', { bubbles: true }));
  e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); e.blur() }"""
DRAG = """() => { const e = __ep(); const g = e.gizmo, o = e.selectedObj; g.dispatchEvent({ type: 'dragging-changed', value: true });
  o.position.x += 0.5; g.dispatchEvent({ type: 'objectChange' }); return null }"""
END = "() => { __ep().gizmo.dispatchEvent({ type: 'dragging-changed', value: false }) }"
ERR = "document.getElementById('ep-error').textContent"
yaw = lambda q: math.degrees(2 * math.atan2(q[1], q[3]))


def spinning(t, name, ms=1500):
    n0 = len(t.ws); q0 = rot(t, name); t.page.wait_for_timeout(ms); q1 = rot(t, name)
    sent = [m for (d, m) in t.ws[n0:] if d == '>' and isinstance(m, dict) and m.get('type') == 'send'
            and m.get('node') == name and m.get('field') == 'rotation']
    return len(sent), round((yaw(q1) - yaw(q0)) % 360, 1)


def setf(t, name, f, i, v):
    select_node(t, name); t.ev(SETF, {'f': f, 'i': i, 'v': v}); t.page.wait_for_timeout(900)


def spins(s): return s[0] > 0 and s[1] > 0


with sync_playwright() as pw:
    br = new_browser(pw)
    print('register', register(br))
    ctx = br.new_context(ignore_https_errors=True, viewport={'width': 1280, 'height': 800})
    a = owner_tab(ctx, 'A', first=True)
    W = new_world(a, 'uh3'); print('A connected', a.connect(W)); a.page.wait_for_timeout(800)
    a.edit_on()
    x = add_cube(a); a.ev(MOVE, {'name': x, 't': [-1.5, 0.5, -3]}); a.page.wait_for_timeout(300)
    y = add_cube(a); a.ev(MOVE, {'name': y, 't': [1.5, 0.5, -3]}); a.page.wait_for_timeout(300)
    import_graph(a, x, gltf_doc(G, ['Spinner']), 'spin.gltf', {'Spinner (node)': x})
    set_enabled(a, x, True)
    a.edit_on(); select_node(a, x); a.page.wait_for_timeout(1500)
    s = spinning(a, x); print('baseline', s); check('0 baseline: the spinner spins and sends', spins(s), s)

    # 1 Undo of a panel move
    setf(a, x, 'translation', 0, -1.0)
    a.page.click('#ep-undo'); a.page.wait_for_timeout(1000)
    s = spinning(a, x); print('after Undo', tr(a, x), s, '| log', rlog(a, 2))
    check('1 Undo put the move back', abs(tr(a, x)[0] + 1.5) < 1e-6, tr(a, x))
    check('1 after Undo the spinner sends and turns (within 1 s)', spins(s), s)

    # 2 Redo
    a.page.click('#ep-redo'); a.page.wait_for_timeout(1000)
    s = spinning(a, x); print('after Redo', tr(a, x), s)
    check('2 Redo re-applied the move', abs(tr(a, x)[0] + 1.0) < 1e-6, tr(a, x))
    check('2 after Redo the spinner sends and turns', spins(s), s)

    # 3 Undo, then a move of another object: the first keeps spinning throughout
    a.page.click('#ep-undo'); a.page.wait_for_timeout(1000)
    s1 = spinning(a, x, 1000)
    setf(a, y, 'translation', 0, 1.0)
    s2 = spinning(a, x, 1000); print('after Undo', s1, '| after moving the other cube', s2)
    check('3 spinning after the Undo AND after moving another object', spins(s1) and spins(s2), (s1, s2))

    # 4 Undo of a rotation while it spins: refused, by design
    setf(a, x, 'rotation', 0, 30)
    a.page.wait_for_timeout(800)
    a.page.click('#ep-undo'); a.page.wait_for_timeout(800)
    msg = a.ev(ERR); s = spinning(a, x); print('rotation Undo message:', repr(msg), '| then', s)
    check("4 an Undo of a rotation while it spins is refused as 'changed elsewhere'", 'changed elsewhere' in msg, msg)
    check('4 and the spinner keeps going', spins(s), s)

    # 5 the drag rule during a handle drag
    select_node(a, x)
    a.ev(DRAG); a.page.wait_for_timeout(300)
    s_drag = spinning(a, x, 1500)
    a.ev(END); a.page.wait_for_timeout(1000)
    s_after = spinning(a, x); print('during the drag', s_drag, '| after it', s_after, '| log', rlog(a, 2))
    check('5 during a handle drag the spinner sends nothing (the drag rule)', s_drag[0] == 0, s_drag)
    check('5 after the drag it sends and turns again', spins(s_after), s_after)

    # 6 scale Undo while it spins
    setf(a, x, 'scale', 0, 1.5)
    a.page.click('#ep-undo'); a.page.wait_for_timeout(1000)
    sc = a.ev("(n) => atriumClient.som.getNodeByName(n).scale", x); s = spinning(a, x)
    print('after scale Undo', sc, s, '| message', repr(a.ev(ERR)))
    check('6 Undo of a scale while it spins: put back, still spinning', abs(sc[0] - 1) < 1e-6 and spins(s), (sc, s))
    print('\npage errors:', a.errors[:3])
    br.close()
print('\nFAILS:', fails or 'none'); sys.exit(1 if fails else 0)
