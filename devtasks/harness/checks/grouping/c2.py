# grouping c2 (PREBRIEF-grouping.md GR6's matrix path, GR-L8/GR-L11 (c)): the
# rotated `Group` of group.gltf (90° about y). Its part, the teleporter `Child
# Pad`, has no shape: it is reached through Empty groups. Move to → Top level
# keeps its world place and turn (the matrix path), Undo puts the exact local
# values back, Redo, then Move to → Group brings it back in; a visitor tab
# watches. The server's copy is read after every step.
import json, math
from gp import *

WORLDQ = "(name) => { const o = stage.scene.getObjectByName(name); if (!o) return null; o.updateWorldMatrix(true, false); const q = o.quaternion.clone(); o.getWorldQuaternion(q); return q.toArray().map(x => Math.round(x * 1e4) / 1e4) }"
EMPTY = "() => [getComputedStyle(document.getElementById('ep-empty-row')).display, [...document.getElementById('ep-empty-groups').options].map(o => o.textContent)]"

def srv_node(k, name):
    g = json.loads(http(f'/__doc?key={k}'))
    n = next((n for n in g['nodes'] if n['name'] == name), None)
    return None if n is None else (n.get('translation', [0, 0, 0]), n.get('rotation', [0, 0, 0, 1]))

def same_q(a, b, eps=1e-3):
    # q and -q are the same turn
    return a is not None and b is not None and (all(abs(x - y) <= eps for x, y in zip(a, b)) or all(abs(x + y) <= eps for x, y in zip(a, b)))

with sync_playwright() as pw:
    br = launch(pw)
    k = 'grp' + key()
    a = Page(br); a.connect(f'wss://127.0.0.1:8443/w/{k}'); a.edit_on(); time.sleep(1)
    b = Page(br, path='/apps/client/local.html?visitor'); b.connect(f'wss://127.0.0.1:8443/w/{k}'); time.sleep(1.5)
    p0, q0 = a.ev(WORLDPOS, 'Child Pad'), a.ev(WORLDQ, 'Child Pad')
    print('  Child Pad world:', p0, q0)
    check(near(p0, [0, 0, 0]), 'Child Pad stands at the origin (Group at x 3, turned 90°)', p0)

    def placed(what):
        for p, tab in ((a, 'owner'), (b, 'visitor')):
            check(near(p.ev(WORLDPOS, 'Child Pad'), p0) and same_q(p.ev(WORLDQ, 'Child Pad'), q0),
                  f'{what}: Child Pad keeps its world place and turn in the {tab} tab', (p.ev(WORLDPOS, 'Child Pad'), p.ev(WORLDQ, 'Child Pad')))

    e = a.ev(EMPTY)
    check(e[0] != 'none' and 'Group › Child Pad' in e[1], 'Empty groups lists Group › Child Pad', e)
    a.page.select_option('#ep-empty-groups', label='Group › Child Pad'); time.sleep(0.6)
    check(a.ev(SEL) == 'Child Pad', 'picking it selects Child Pad', a.ev(SEL))
    check(a.ev(PATH, 'ep-path').startswith('Group'), 'its breadcrumb starts with Group', a.ev(PATH, 'ep-path'))

    # Move to → Top level (the matrix path: Group is turned)
    move_to(a, 'Top level')
    check(server_tree(k).get('Child Pad') is None, 'the server has Child Pad at the top level', server_tree(k).get('Child Pad'))
    t, r = srv_node(k, 'Child Pad')
    check(near(t, [0, 0, 0], 1e-5) and same_q(r, [0, 0.7071068, 0, 0.7071068], 1e-5), 'the server holds its world values as local ones', (t, r))
    placed('Top level')
    check(a.ev(SEL) == 'Child Pad', 'Child Pad stays selected', a.ev(SEL))
    e = a.ev(EMPTY)
    check('Group' in e[1], 'Group, now empty, is listed in Empty groups', e)
    check(a.ev(UNDO_LABELS) == ['Move to “Child Pad”'], 'one Undo entry', a.ev(UNDO_LABELS))

    # Undo: the exact local values are back
    undo(a)
    check(server_tree(k).get('Child Pad') == 'Group', 'Undo: the server has Child Pad under Group again', server_tree(k).get('Child Pad'))
    t, r = srv_node(k, 'Child Pad')
    check(t == [0, 0, -3] and r == [0, 0, 0, 1], 'Undo: its local values are exactly the file’s', (t, r))
    placed('Undo')

    # Redo, then Move to → Group by the list
    undo(a, 'redo')
    check(server_tree(k).get('Child Pad') is None, 'Redo: at the top level again', server_tree(k).get('Child Pad'))
    placed('Redo')
    a.page.select_option('#ep-empty-groups', label='Child Pad') if 'Child Pad' in a.ev(EMPTY)[1] else None
    time.sleep(0.4)
    check(a.ev(SEL) == 'Child Pad', 'Child Pad is selected', a.ev(SEL))
    move_to(a, 'Group')
    check(server_tree(k).get('Child Pad') == 'Group', 'Move to → Group: the server has it under Group', server_tree(k).get('Child Pad'))
    t, r = srv_node(k, 'Child Pad')
    check(near(t, [0, 0, -3], 1e-5) and same_q(r, [0, 0, 0, 1], 1e-5), 'its local values are the file’s again (to rounding)', (t, r))
    placed('Move to → Group')
    check(a.ev(PATH, 'ep-path').startswith('Group'), 'its breadcrumb starts with Group again', a.ev(PATH, 'ep-path'))
    # Ungroup the turned Group (Escape goes up to it), Undo; then Group Child Pad at the top level, Undo, Redo
    a.ev("() => document.activeElement && document.activeElement.blur()")
    a.page.keyboard.press('Escape'); time.sleep(0.4)
    check(a.ev(SEL) == 'Group', 'Escape goes up to Group', a.ev(SEL))
    press(a, 'ep-ungroup')
    srv = server_tree(k)
    check('Group' not in srv and srv.get('Child Pad') is None, 'Ungroup: Group is gone and Child Pad is at the top level on the server', srv)
    placed('Ungroup')
    check(a.ev(SEL) == 'Child Pad', 'Ungroup selects its first part', a.ev(SEL))
    check(a.ev(UNDO_LABELS)[-1] == 'Ungroup “Group”', 'Ungroup is one Undo entry', a.ev(UNDO_LABELS))
    undo(a)
    srv = json.loads(http(f'/__doc?key={k}'))
    gn = next((n for n in srv['nodes'] if n['name'] == 'Group'), None)
    check(gn is not None and gn.get('translation') == [3, 0, 0] and same_q(gn.get('rotation'), [0, 0.7071068, 0, 0.7071068], 1e-6), 'Undo: Group is back at its place and turn', gn)
    check(server_tree(k).get('Child Pad') == 'Group', 'Undo: Child Pad is inside it again', server_tree(k).get('Child Pad'))
    placed('Ungroup undone')
    undo(a)   # the Move to → Group
    check(server_tree(k).get('Child Pad') is None, 'Undo again: Child Pad back at the top level', server_tree(k).get('Child Pad'))
    a.page.select_option('#ep-empty-groups', label='Child Pad'); time.sleep(0.5)
    press(a, 'ep-group')
    check(a.ev(SEL) == 'group-01', 'Group: the new group-01 is selected', a.ev(SEL))
    check(server_tree(k).get('Child Pad') == 'group-01' and server_tree(k).get('group-01') is None, 'Group: Child Pad is in a new top-level group-01', server_tree(k))
    placed('Group')
    undo(a)
    check('group-01' not in server_tree(k) and server_tree(k).get('Child Pad') is None, 'Undo: group-01 is gone, Child Pad at the top level', server_tree(k))
    placed('Group undone')
    undo(a, 'redo')
    check(server_tree(k).get('Child Pad') == 'group-01', 'Redo: in group-01 again', server_tree(k).get('Child Pad'))
    placed('Group redone')
    check(a.ev(ERROR) == '', 'no error', a.ev(ERROR))
    check(a.errors == [] and b.errors == [], 'no page errors', a.errors + b.errors)
    br.close()
done()
