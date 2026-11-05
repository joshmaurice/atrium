# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
# undo-hold h4 — the operator's DEV report (2026-11-04 21:33): on a spinning model
# Undo sometimes says "Can't undo: … was changed elsewhere". Suspect: a MOVE drag
# records rotation too (onHandleChange passes translation, rotation AND scale), so a
# behaviour rotation that lands during the drag makes the entry a "Transform" whose
# rotation the behaviour then overwrites. This drags like a mouse (many objectChange
# events over ~0.6 s) N times, and counts the entries and Undo's answers.
# Server: checks/signin-sync/authserver.mjs with HOOKS=1.
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripting-4d'))
from common4d import *
N = int(os.environ.get('TRIALS', '12'))
G = graph([
    {'op': 'event/onTick', 'flows': {'out': flow(4)}},
    getter('/nodes/0/rotation', 'float4'),
    {'op': 'math/quatFromAxisAngle', 'values': {'axis': lit('float3', [0, 1, 0]), 'angle': lit('float', 0.05)}},
    {'op': 'math/quatMul', 'values': {'a': sock(1), 'b': sock(2)}},
    setter('/nodes/0/rotation', 'float4', sock(3)),
])
BEGIN = "() => { __ep().gizmo.dispatchEvent({ type: 'dragging-changed', value: true }) }"
STEP = "() => { const e = __ep(); e.selectedObj.position.x += 0.02; e.gizmo.dispatchEvent({ type: 'objectChange' }) }"
END = "() => { __ep().gizmo.dispatchEvent({ type: 'dragging-changed', value: false }) }"
LABEL = "document.getElementById('ep-undo').title || document.getElementById('ep-undo').textContent"
ERR = "document.getElementById('ep-error').textContent"

with sync_playwright() as pw:
    br = new_browser(pw)
    print('register', register(br))
    ctx = br.new_context(ignore_https_errors=True, viewport={'width': 1280, 'height': 800})
    a = owner_tab(ctx, 'A', first=True)
    W = new_world(a, 'uh4'); print('A connected', a.connect(W)); a.page.wait_for_timeout(800)
    a.edit_on()
    x = add_cube(a); a.ev(MOVE, {'name': x, 't': [-1.5, 0.5, -3]}); a.page.wait_for_timeout(300)
    import_graph(a, x, gltf_doc(G, ['Spinner']), 'spin.gltf', {'Spinner (node)': x})
    set_enabled(a, x, True)
    a.edit_on(); select_node(a, x); a.page.wait_for_timeout(1500)
    labels, answers = {}, {}
    for i in range(N):
        a.ev(BEGIN)
        for _ in range(20):
            a.ev(STEP); a.page.wait_for_timeout(30)
        a.ev(END); a.page.wait_for_timeout(700)
        lab = a.ev(LABEL).split(' “')[0]; labels[lab] = labels.get(lab, 0) + 1
        a.page.click('#ep-undo'); a.page.wait_for_timeout(700)
        err = a.ev(ERR); ans = 'refused: changed elsewhere' if 'changed elsewhere' in err else ('undone' if not err else err)
        answers[ans] = answers.get(ans, 0) + 1
        print(f'  trial {i + 1}: recorded "{lab}", Undo → {ans}')
        a.ev("() => { document.getElementById('ep-error').textContent = '' }"); a.page.wait_for_timeout(500)
    print('\nrecorded:', labels, '| Undo:', answers)
    check('no MOVE drag records a rotation change', set(labels) <= {'Undo Move'}, labels)
    check('every Undo of a move drag works', set(answers) <= {'undone'}, answers)
    br.close()
print('\nFAILS:', fails or 'none'); sys.exit(1 if fails else 0)
