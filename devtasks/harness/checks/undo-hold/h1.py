# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
# undo-hold h1 — the stuck drag-rule hold (operator report, 2026-11-04).
# A cube spins with an imported onTick graph. Through the Edit panel: move it, Undo.
# Expected on today's code (the bug): after the Undo, the spinner's rotation sends
# stop and it stands still, with Enabled still showing; moving ANOTHER object
# makes it spin again. Then a panel edit to the value it already has, which
# does NOT stick (the panel sends nothing and holds nothing).
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
SETPOS = """({ i, v }) => { const e = document.querySelector(`#edit-panel input[data-field="translation"][data-i="${i}"]`);
  e.focus(); e.value = String(v); e.dispatchEvent(new Event('input', { bubbles: true }));
  e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); e.blur() }"""
yaw = lambda q: math.degrees(2 * math.atan2(q[1], q[3]))


def spinning(t, name, ms=1500):
    """(rotation sets this tab sent for `name` in `ms`, degrees the SOM node turned)."""
    n0 = len(t.ws); q0 = rot(t, name); t.page.wait_for_timeout(ms); q1 = rot(t, name)
    sent = [m for (d, m) in t.ws[n0:] if d == '>' and isinstance(m, dict) and m.get('type') == 'send'
            and m.get('node') == name and m.get('field') == 'rotation']
    return len(sent), round((yaw(q1) - yaw(q0)) % 360, 1)


def panel_move(t, name, x):
    select_node(t, name); t.ev(SETPOS, {'i': 0, 'v': x}); t.page.wait_for_timeout(900)


with sync_playwright() as pw:
    br = new_browser(pw)
    print('register', register(br))
    ctx = br.new_context(ignore_https_errors=True, viewport={'width': 1280, 'height': 800})
    a = owner_tab(ctx, 'A', first=True)
    W = new_world(a, 'uh'); print('A connected', a.connect(W)); a.page.wait_for_timeout(800)
    a.edit_on()
    x = add_cube(a); a.ev(MOVE, {'name': x, 't': [-1.5, 0.5, -3]}); a.page.wait_for_timeout(300)
    y = add_cube(a); a.ev(MOVE, {'name': y, 't': [1.5, 0.5, -3]}); a.page.wait_for_timeout(300)
    import_graph(a, x, gltf_doc(G, ['Spinner']), 'spin.gltf', {'Spinner (node)': x})
    dlg, en = set_enabled(a, x, True)
    a.edit_on(); select_node(a, x); a.page.wait_for_timeout(1500)
    s0 = spinning(a, x); print(f'baseline: {s0[0]} rotation sends in 1.5 s, turned {s0[1]}°')
    check('0 the spinner spins and sends (baseline)', s0[0] > 0 and s0[1] > 0, s0)

    panel_move(a, x, -1.0)
    print('after a panel move: translation', tr(a, x), '| undo label', a.ev("document.getElementById('ep-undo').title || document.getElementById('ep-undo').textContent"))
    s1 = spinning(a, x); print(f'after the panel move: {s1[0]} sends, turned {s1[1]}°')
    check('1 the spinner still spins after a recorded panel move', s1[0] > 0 and s1[1] > 0, s1)

    a.page.click('#ep-undo'); a.page.wait_for_timeout(1200)
    print('after Undo: translation', tr(a, x), '| Enabled button', a.ev("document.getElementById('ep-behavior-enabled').textContent"))
    check('2 Undo put the position back', abs(tr(a, x)[0] - (-1.5)) < 1e-6, tr(a, x))
    s2 = spinning(a, x, 3000); print(f'after Undo: {s2[0]} sends in 3 s, turned {s2[1]}° | leaf enabled {leaf(a, x).get("enabled")} | engine {engine(a, x)}')
    print('   runner log:', rlog(a, 4))
    check('3 BUG REPRO: after the Undo the spinner sends nothing and stands still', s2[0] == 0 and s2[1] == 0, s2)

    panel_move(a, y, 1.0)
    s3 = spinning(a, x); print(f'after moving the OTHER cube: {s3[0]} sends, turned {s3[1]}°')
    check('4 BUG REPRO: moving another object makes it spin again', s3[0] > 0 and s3[1] > 0, s3)

    # a panel edit to the value the field already has (nothing is sent)
    cur = tr(a, x)[0]; panel_move(a, x, cur)
    s4 = spinning(a, x, 3000); print(f'after a no-change panel edit: {s4[0]} sends in 3 s, turned {s4[1]}°')
    check('5 a no-change panel edit does not hold the spinner (not part of the bug)', s4[0] > 0 and s4[1] > 0, s4)
    print('\npage errors:', a.errors[:3])
    br.close()
print('\nFAILS:', fails or 'none'); sys.exit(1 if fails else 0)
