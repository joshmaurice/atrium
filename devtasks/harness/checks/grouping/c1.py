# grouping c1 (PREBRIEF-grouping.md §5, DEV acceptance steps 1-6): Group, Move
# to, a handle drag, Undo x3, Redo x3, Ungroup and its Undo, then 5a (both
# cubes out, Empty groups, Move back, Delete from the dropdown, Undo), all by
# the real mouse in an owner tab, with a visitor tab watching. Every step
# checks the selection, the world positions in BOTH tabs, the drawn parent, the
# server's copy and the Undo stack.
import json
from gp import *

OBJS = ['crate-01', 'lamp-01', 'lamp-shade']

with sync_playwright() as pw:
    br = launch(pw)
    k = 'c1' + key()
    a = Page(br); a.connect(f'wss://127.0.0.1:8443/w/{k}'); a.edit_on(); time.sleep(1)
    b = Page(br, path='/apps/client/local.html?visitor'); b.connect(f'wss://127.0.0.1:8443/w/{k}'); time.sleep(1.5)
    m = a.page.mouse
    w0 = {n: a.ev(WORLDPOS, n) for n in OBJS}

    def same_place(what, ref=None):
        ref = ref or w0
        for p, tab in ((a, 'owner'), (b, 'visitor')):
            got = {n: p.ev(WORLDPOS, n) for n in OBJS}
            check(all(near(got[n], ref[n]) for n in OBJS), f'{what}: nothing moved in the {tab} tab', got)

    def tree(what, want):
        srv = server_tree(k)
        for n, par in want.items():
            check(srv.get(n, 'absent') == par, f'{what}: the server has {n} under {par}', srv.get(n, 'absent'))
            for p, tab in ((a, 'owner'), (b, 'visitor')):
                got = p.ev(SOM_PARENT, n)
                check(got == par, f'{what}: the {tab} tab has {n} under {par}', got)
                if par and got != 'absent':
                    check(p.ev(DRAWN_PARENT, n) == par, f'{what}: the {tab} tab draws {n} under {par}', p.ev(DRAWN_PARENT, n))

    # 1. Group crate-01
    select_by_click(a, 'crate-01', 'crate-01')
    press(a, 'ep-group')
    check(a.ev(SEL) == 'group-01', '1: the panel selects group-01', a.ev(SEL))
    check(a.ev(PATH, 'ep-path') == '', '1: the breadcrumb is empty (top level)', a.ev(PATH, 'ep-path'))
    tree('1', {'group-01': None, 'crate-01': 'group-01'})
    same_place('1')
    check(a.ev(UNDO_LABELS) == ['Group “group-01”'], '1: one Undo entry, Group', a.ev(UNDO_LABELS))
    check(a.ev(ERROR) == '', '1: no error', a.ev(ERROR))

    # 2. Move lamp-01 into group-01; a click selects the group, a double-click the part
    time.sleep(0.7)
    select_by_click(a, 'lamp-stand', 'lamp-01')
    move_to(a, 'group-01')
    check(a.ev(SEL) == 'lamp-01', '2: the moved object stays selected', a.ev(SEL))
    check(a.ev(PATH, 'ep-path').startswith('group-01'), '2: its breadcrumb reads group-01 › …', a.ev(PATH, 'ep-path'))
    tree('2', {'group-01': None, 'crate-01': 'group-01', 'lamp-01': 'group-01'})
    same_place('2')
    check(a.ev(UNDO_LABELS)[-1:] == ['Move to “lamp-01”'], '2: one Undo entry, Move to', a.ev(UNDO_LABELS))
    a.ev("() => __ep().selectForEdit(null)"); time.sleep(0.8)
    select_by_click(a, 'crate-01', 'group-01')
    time.sleep(0.7)
    sc = a.ev(SCREEN, 'crate-01'); dbl(m, sc['x'], sc['y'])
    check(a.ev(SEL) == 'crate-01', '2: a double-click selects the cube', a.ev(SEL))
    check(a.ev(PATH, 'ep-path') == 'group-01 › crate-01', '2: the breadcrumb reads group-01 › crate-01', a.ev(PATH, 'ep-path'))

    # 3. drag group-01's X handle: both move together
    a.page.keyboard.press('Escape'); time.sleep(0.4)
    check(a.ev(SEL) == 'group-01', '3: Escape goes up to group-01', a.ev(SEL))
    sc = a.ev(SCREEN, 'group-01')
    h = point_over(a, sc, axis='X', anchor='group-01')
    check(h is not None, '3: an X handle point is found (real-mouse hover)', h)
    m.move(h['x'], h['y']); time.sleep(0.2); m.down(); time.sleep(0.15)
    for i in range(1, 21): m.move(h['x'] - 3 * i, h['y']); time.sleep(0.02)
    m.up(); time.sleep(1.2)
    w3 = {n: a.ev(WORLDPOS, n) for n in OBJS}
    dx = w3['crate-01'][0] - w0['crate-01'][0]
    check(dx < -0.05, '3: the drag moves the cube along -x', dx)
    check(near(w3['lamp-shade'], [w0['lamp-shade'][0] + dx, w0['lamp-shade'][1], w0['lamp-shade'][2]]), '3: the lamp moves by the same amount', w3['lamp-shade'])
    time.sleep(0.5)
    check(all(near(b.ev(WORLDPOS, n), w3[n]) for n in OBJS), '3: the visitor tab draws the same', {n: b.ev(WORLDPOS, n) for n in OBJS})
    labels3 = a.ev(UNDO_LABELS)
    check(len(labels3) == 3, '3: three Undo entries', labels3)

    # 4. Undo x3
    undo(a)
    w4 = {n: a.ev(WORLDPOS, n) for n in OBJS}
    check(all(near(w4[n], w0[n]) for n in OBJS), '4a: Undo puts the drag back', w4)
    undo(a); tree('4b', {'lamp-01': None, 'crate-01': 'group-01'}); same_place('4b')
    undo(a); tree('4c', {'crate-01': None}); same_place('4c')
    check('group-01' not in server_tree(k), '4c: group-01 is gone on the server')
    check(a.ev(UNDO_LABELS) == [], '4c: the Undo stack is empty', a.ev(UNDO_LABELS))
    check(len(a.ev(REDO_LABELS)) == 3, '4c: three Redo entries', a.ev(REDO_LABELS))

    # 5. Redo x3, Ungroup, Undo
    undo(a, 'redo'); tree('5a', {'group-01': None, 'crate-01': 'group-01'}); same_place('5a')
    undo(a, 'redo'); tree('5b', {'lamp-01': 'group-01'}); same_place('5b')
    undo(a, 'redo')
    check(all(near(a.ev(WORLDPOS, n), w3[n]) for n in OBJS), '5c: Redo makes the drag again', {n: a.ev(WORLDPOS, n) for n in OBJS})
    a.ev("() => __ep().selectForEdit(null)"); time.sleep(0.6)
    select_by_click(a, 'crate-01', 'group-01')
    press(a, 'ep-ungroup')
    srv = server_tree(k)
    check('group-01' not in srv, '5: Ungroup removes group-01 on the server', srv)
    tree('5', {'crate-01': None, 'lamp-01': None})
    check(all(near(a.ev(WORLDPOS, n), w3[n]) for n in OBJS), '5: Ungroup keeps both where they are', {n: a.ev(WORLDPOS, n) for n in OBJS})
    check(all(near(b.ev(WORLDPOS, n), w3[n]) for n in OBJS), '5: and the visitor tab too', {n: b.ev(WORLDPOS, n) for n in OBJS})
    check(a.ev(SEL) in ('crate-01', 'lamp-01'), '5: the first part is selected', a.ev(SEL))
    check(a.ev(UNDO_LABELS)[-1:] == ['Ungroup “group-01”'], '5: one Undo entry, Ungroup', a.ev(UNDO_LABELS))
    undo(a)
    tree('5 undo', {'group-01': None, 'crate-01': 'group-01', 'lamp-01': 'group-01'})
    check(all(near(a.ev(WORLDPOS, n), w3[n]) for n in OBJS), '5 undo: both back inside, unmoved', {n: a.ev(WORLDPOS, n) for n in OBJS})

    # 5a. both out to the top level; Empty groups; pick; Move back; Delete; Undo
    a.ev("() => __ep().selectForEdit(null)"); time.sleep(0.6)
    select_by_click(a, 'crate-01', 'group-01'); time.sleep(0.7)
    sc = a.ev(SCREEN, 'crate-01'); dbl(m, sc['x'], sc['y'])
    check(a.ev(SEL) == 'crate-01', '5a: crate-01 selected inside the group', a.ev(SEL))
    move_to(a, 'Top level')
    a.ev("() => __ep().selectForEdit(null)"); time.sleep(0.6)
    select_by_click(a, 'lamp-stand', 'group-01'); time.sleep(0.7)
    sc = a.ev(SCREEN, 'lamp-stand'); n0 = len(a.console); print('  pick:', a.ev(PICK, [sc['x'], sc['y'], 'group-01']))
    dbl(m, sc['x'], sc['y'])
    check(a.ev(SEL) == 'lamp-01', '5a: lamp-01 selected inside the group', a.ev(SEL))
    if a.ev(SEL) != 'lamp-01':
        print('  console:', a.console[n0:], len(a.console))
        print('  at point:', a.ev("([x, y]) => { const e = document.elementFromPoint(x, y); return e ? e.tagName + '#' + e.id + '.' + e.className : null }", [sc['x'], sc['y']]))
        print('  active:', a.ev("() => document.activeElement && document.activeElement.id"))
        a.page.screenshot(path='/tmp/c1-fail.png'); br.close(); done()
    move_to(a, 'Top level')
    tree('5a', {'group-01': None, 'crate-01': None, 'lamp-01': None})
    check(all(near(a.ev(WORLDPOS, n), w3[n]) for n in OBJS), '5a: both stay where they are', {n: a.ev(WORLDPOS, n) for n in OBJS})
    time.sleep(0.4)
    empty = a.ev("() => [getComputedStyle(document.getElementById('ep-empty-row')).display, [...document.getElementById('ep-empty-groups').options].map(o => o.textContent)]")
    check(empty[0] != 'none' and empty[1] == ['Empty groups (1)', 'group-01'], '5a: Empty groups (1) appears, listing group-01', empty)
    a.page.select_option('#ep-empty-groups', label='group-01'); time.sleep(0.6)
    check(a.ev(SEL) == 'group-01', '5a: picking it selects group-01', a.ev(SEL))
    check(a.ev("() => document.getElementById('ep-name').value") == 'group-01', '5a: the Name field reads group-01')
    check((a.ev(GZ) or {}).get('attached') == 'group-01', '5a: the handles attach to it', a.ev(GZ))
    # g4 extended: a real drag moves the empty group
    g_before = a.ev(TR, 'group-01')
    sc = a.ev(SCREEN, 'group-01')
    h = point_over(a, sc, axis='X', anchor='group-01')
    check(h is not None, '5a: an X handle point of the empty group is found (real-mouse hover)', h)
    if h:
        m.move(h['x'], h['y']); time.sleep(0.2); m.down(); time.sleep(0.15)
        for i in range(1, 16): m.move(h['x'] - 3 * i, h['y']); time.sleep(0.02)
        m.up(); time.sleep(1.2)
    g_after = a.ev(TR, 'group-01')
    srv_g = json.loads(http(f'/__doc?key={k}'))
    srv_g = next(n for n in srv_g['nodes'] if n['name'] == 'group-01').get('translation', [0, 0, 0])
    check(g_after[0] < g_before[0] - 0.05, '5a: a real drag moves the empty group', (g_before, g_after))
    check(near(srv_g, g_after), '5a: the server holds the dragged place', (srv_g, g_after))
    check(a.ev(UNDO_LABELS)[-1] == 'Move “group-01”', '5a: the drag is one Undo entry', a.ev(UNDO_LABELS))
    a.ev("() => __ep().selectForEdit(null)"); time.sleep(0.6)
    select_by_click(a, 'crate-01', 'crate-01')
    move_to(a, 'group-01')
    time.sleep(0.4)
    print('  after the move back:', a.ev(SOM_PARENT, 'crate-01'), a.ev(ERROR), a.ev(UNDO_LABELS)[-2:])
    check(a.ev("() => getComputedStyle(document.getElementById('ep-empty-row')).display") == 'none', '5a: the Empty groups row disappears')
    move_to(a, 'Top level'); time.sleep(0.4)
    a.page.select_option('#ep-empty-groups', label='group-01'); time.sleep(0.6)
    check(a.ev(SEL) == 'group-01', '5a: group-01 picked again', a.ev(SEL))
    a.page.click('#ep-delete'); time.sleep(1); settle(a)
    check('group-01' not in server_tree(k), '5a: Delete removes it on the server')
    undo(a); time.sleep(0.5)
    check(server_tree(k).get('group-01', 'absent') is None, '5a: Undo brings it back at the top level', server_tree(k).get('group-01', 'absent'))

    # 6. the visitor watched it all
    check(all(near(b.ev(WORLDPOS, n), a.ev(WORLDPOS, n)) for n in OBJS), '6: the visitor tab ends where the owner tab does')
    check(a.errors == [] and b.errors == [], 'no page errors in either tab', a.errors + b.errors)
    print('  undo:', a.ev(UNDO_LABELS))
    br.close()
done()
