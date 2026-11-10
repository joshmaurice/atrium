# grouping c3 (PREBRIEF-grouping.md §4 "som:reparent", second review S1, r7 —
# f3 as a harness check): tab A is part-way through a real-mouse handle drag
# of crate-01 when tab B (an owner too) presses Group on it. A's drag is
# CANCELLED, not ended: nothing jumps in either tab, A's release sends nothing
# more, the drag is not recorded in A's Undo stack, and the three copies (A, B,
# the server) agree.
import json
from gp import *

def srv_world_x(k):
    g = json.loads(http(f'/__doc?key={k}'))
    by = {n['name']: n for n in g['nodes']}
    c = by['crate-01'].get('translation', [0, 0, 0])
    par = next((n for n in g['nodes'] if 1 in n.get('children', []) or any(g['nodes'][i]['name'] == 'crate-01' for i in n.get('children', []))), None)
    pt = par.get('translation', [0, 0, 0]) if par else [0, 0, 0]
    return [round(c[i] + pt[i], 4) for i in range(3)], (par or {}).get('name')

with sync_playwright() as pw:
    br = launch(pw)
    k = 'c3' + key()
    a = Page(br); a.connect(f'wss://127.0.0.1:8443/w/{k}'); a.edit_on(); time.sleep(1)
    b = Page(br); b.connect(f'wss://127.0.0.1:8443/w/{k}'); b.edit_on(); time.sleep(1)
    m = a.page.mouse
    select_by_click(a, 'crate-01', 'crate-01')
    select_by_click(b, 'crate-01', 'crate-01')
    sc = a.ev(SCREEN, 'crate-01')
    h = point_over(a, sc, axis='X', anchor='crate-01')
    check(h is not None, 'an X handle point is found in tab A (real-mouse hover)', h)
    m.move(h['x'], h['y']); time.sleep(0.2); m.down(); time.sleep(0.15)
    for i in range(1, 11): m.move(h['x'] - 3 * i, h['y']); time.sleep(0.03)
    time.sleep(0.5)
    check((a.ev(GZ) or {}).get('dragging') is True, 'tab A is mid-drag', a.ev(GZ))
    mid = a.ev(WORLDPOS, 'crate-01')
    time.sleep(0.6)   # A's drag sends reach the server and B
    check(near(b.ev(WORLDPOS, 'crate-01'), mid), 'tab B sees the drag so far', (b.ev(WORLDPOS, 'crate-01'), mid))

    # B groups it while A holds the mouse down
    press(b, 'ep-group')
    time.sleep(0.8)
    check(server_tree(k).get('crate-01') == 'group-01', 'B’s Group lands: crate-01 is in group-01 on the server', server_tree(k).get('crate-01'))
    check(a.ev(SOM_PARENT, 'crate-01') == 'group-01' and a.ev(DRAWN_PARENT, 'crate-01') == 'group-01', 'tab A has and draws it under group-01', (a.ev(SOM_PARENT, 'crate-01'), a.ev(DRAWN_PARENT, 'crate-01')))
    check((a.ev(GZ) or {}).get('dragging') is not True, 'tab A’s drag is over (cancelled)', a.ev(GZ))
    w_after = a.ev(WORLDPOS, 'crate-01')
    check(near(w_after, mid), 'no jump in tab A', (w_after, mid))
    check(near(b.ev(WORLDPOS, 'crate-01'), mid), 'no jump in tab B', b.ev(WORLDPOS, 'crate-01'))

    # A keeps moving and lets go: nothing more is sent
    for i in range(11, 21): m.move(h['x'] - 3 * i, h['y']); time.sleep(0.03)
    m.up(); time.sleep(1.2)
    check(near(a.ev(WORLDPOS, 'crate-01'), mid), 'A’s later moves and release move nothing in A', a.ev(WORLDPOS, 'crate-01'))
    check(near(b.ev(WORLDPOS, 'crate-01'), mid), '… nor in B', b.ev(WORLDPOS, 'crate-01'))
    sw, spar = srv_world_x(k)
    check(spar == 'group-01' and near(sw, mid), 'the server agrees (group at the cube’s place, cube inside)', (sw, spar, mid))
    check(not any('crate-01' in l and l.startswith('Move ') for l in a.ev(UNDO_LABELS)), 'the cancelled drag is not in A’s Undo stack', a.ev(UNDO_LABELS))
    check(b.ev(UNDO_LABELS) == ['Group “group-01”'], 'B’s Undo stack holds its Group', b.ev(UNDO_LABELS))
    check(a.errors == [] and b.errors == [], 'no page errors', a.errors + b.errors)
    br.close()
done()
