# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
#
# small-fixes: an imported graph can't target an object that has no id yet (SF-3).
# The operator's 2-rotation.gltf, imported through the panel onto a group made
# by Group (no objectId), with its one node mapped to: (1) the group itself;
# (2) another id-less group; (3) a cube that has an id. Before the fix, 1 and 2
# are refused before Save ("nodeMap or targets is malformed"); after it, all
# three save and spin the mapped target.
# Server: checks/signin-sync/authserver.mjs with HOOKS=1.
#   HARNESS_ROOT=/tmp/atrium-harness python3 devtasks/spike-small-fixes/r3_target.py [--expect-fixed]
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
def make_group(t, at):
    c = add_cube(t); t.ev(MOVE, {'name': c, 't': at}); t.page.wait_for_timeout(300)
    select_node(t, c); t.page.click('#ep-group'); t.page.wait_for_timeout(1200)
    return t.ev("(n) => atriumClient.som.getNodeByName(n).parent?.name", c)

def spins(t, name):
    r0 = rot(t, name); t.page.wait_for_timeout(700); return r0 != rot(t, name)

def case(t, label, own, target):
    print(f'\n== {label}: import onto {own}, target {target} | ids: own={t.ev(OID, own)} target={t.ev(OID, target)}')
    out = import_graph(t, own, gltf_doc(G, ['Spinner']), '2-rotation.gltf', {'Spinner (node)': target})
    m = out['mapped']; a = out.get('after') or {}
    print('   mapped status:', repr(m['status'])[:160], '| save disabled:', m['save_disabled'])
    print('   after:', repr(a.get('status'))[:160])
    saved = (a.get('status') or '').startswith('Saved')
    leaf_ = leaf(t, own)
    if saved:
        set_enabled(t, own, True); t.page.wait_for_timeout(600)
    sp = spins(t, target) if saved else False
    # close the panel (it stays open after Save, and after a refusal), so the next case can open it
    t.edit_on(); select_node(t, own)
    if t.ev("getComputedStyle(document.getElementById('ep-import-panel')).display !== 'none'"):
        t.page.click('#ep-import-close'); t.page.wait_for_timeout(200)
    return saved, m, leaf_, sp

with sync_playwright() as pw:
    br = new_browser(pw); print('register', register(br))
    ctx = br.new_context(ignore_https_errors=True, viewport={'width': 1280, 'height': 900})
    a = owner_tab(ctx, 'A', first=True)
    W = new_world(a, 'sf3'); a.connect(W); a.page.wait_for_timeout(800); a.edit_on()
    g1 = make_group(a, [-2, 0.5, -3]); g2 = make_group(a, [0, 0.5, -3]); g3 = make_group(a, [2, 0.5, -3])
    c = add_cube(a); a.ev(MOVE, {'name': c, 't': [0, 0.5, -5]}); a.page.wait_for_timeout(300)
    a.ev(SETID, c); a.page.wait_for_timeout(500)
    print('groups', g1, g2, g3, 'cube with id', c)
    s1, m1, l1, sp1 = case(a, '1. own id-less group targets itself', g1, g1)
    s2, m2, l2, sp2 = case(a, '2. id-less group targets another id-less group', g2, g3)
    s3, m3, l3, sp3 = case(a, '3. id-less group targets a cube with an id', g2 if not s2 else g3, c)
    if FIXED:
        check('1 saved, and the group spins', s1 and sp1, (m1['status'], sp1))
        check('1 the own group got its id, and the leaf targets it as itself', a.ev(OID, g1) is not None and l1 is not None, (a.ev(OID, g1), l1))
        check('2 saved, the other group got an id and spins', s2 and sp2 and a.ev(OID, g3) is not None, (m2['status'], sp2))
        check('3 saved, the cube spins', s3 and sp3, (m3['status'], sp3))
    else:
        check('(bug) 1 refused before Save', not s1 and 'malformed' in (m1['status'] + (m1.get('report') or '')), m1['status'])
        check('(bug) 2 refused before Save', not s2 and 'malformed' in (m2['status'] + (m2.get('report') or '')), m2['status'])
        check('3 a target with an id saves and spins', s3 and sp3, (m3['status'], sp3))
    print('errors:', a.errors[:3])
    br.close()
print('\nFAILS:', fails or 'none'); sys.exit(1 if fails else 0)
