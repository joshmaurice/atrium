# selection-parts c1 (PREBRIEF-selection-parts.md §5, harness): the lamp in a
# space.gltf world, Edit mode. Clicks, double-clicks with and without jitter
# on the handles' own positions, the breadcrumb, Escape, a short press on a
# handle over the floor and over the sky (SP-L10), a 6 px second press
# (SP-L11), a real drag and a one-move drag (S-4), another tab's move during
# a short press (S-2). Every step asserts the selection, the transforms and
# the Undo stack.
from sp import *

LAMP0 = [3, 0, 0]
with sync_playwright() as pw:
    br = launch(pw)
    k = key()
    p = Page(br); p.connect(f'wss://127.0.0.1:8443/w/c1{k}'); p.edit_on(); time.sleep(1)
    m = p.page.mouse
    sh = p.ev(SCREEN, 'lamp-shade'); st = p.ev(SCREEN, 'lamp-stand'); cr = p.ev(SCREEN, 'crate-01')
    stack = lambda: p.ev(UNDO)

    click(m, sh['x'], sh['y']); time.sleep(0.4)
    check(p.ev(SEL) == 'lamp-01', 'a click on the shade selects lamp-01', p.ev(SEL))
    check(p.ev(PATH, 'ep-path') == '', 'no breadcrumb for a top-level selection', p.ev(PATH, 'ep-path'))
    time.sleep(0.7); click(m, sh['x'], sh['y']); time.sleep(0.4)
    check(p.ev(SEL) == 'lamp-01', 'a second, separate click keeps lamp-01', p.ev(SEL))

    # the stand under lamp-01's Y handle (the fresh check's must-fix 1)
    pt = point_over(p, st, axis='Y', behind='lamp-stand')
    check(pt is not None, 'a point over lamp-01’s Y handle with the stand behind it', pt)
    for travel in (0, 1, 2):
        p.ev("() => __ep().selectForEdit(atriumClient.som.getNodeByName('lamp-01'))"); time.sleep(0.3)
        before = stack()
        dbl(m, pt['x'], pt['y'], travel=travel)
        check(p.ev(SEL) == 'lamp-stand', f'a double-click there ({travel} px on the second press) drills to lamp-stand', p.ev(SEL))
        check(p.ev(TR, 'lamp-01') == LAMP0 and p.ev(DRAWN, 'lamp-01') == LAMP0, f'  the lamp hasn’t moved ({travel} px)', (p.ev(TR, 'lamp-01'), p.ev(DRAWN, 'lamp-01')))
        check(stack() == before, f'  nothing recorded ({travel} px)', stack())
    check(p.ev(PATH, 'ep-path') == 'lamp-01 › lamp-stand', 'the breadcrumb reads lamp-01 › lamp-stand', p.ev(PATH, 'ep-path'))

    click(m, sh['x'], sh['y']); time.sleep(0.4)
    check(p.ev(SEL) == 'lamp-shade', 'a click on the shade, with the stand selected, selects the shade (SP-L2)', p.ev(SEL))

    # SP-L11: 6 px on the second press drills, moves nothing
    p.ev("() => __ep().selectForEdit(atriumClient.som.getNodeByName('lamp-01'))"); time.sleep(0.3)
    before = stack()
    dbl(m, pt['x'], pt['y'], travel=6)
    check(p.ev(SEL) == 'lamp-stand', 'a double-click with 6 px on the second press still drills (SP-L11)', p.ev(SEL))
    check(p.ev(TR, 'lamp-01') == LAMP0 and stack() == before, '  and moves nothing, records nothing', (p.ev(TR, 'lamp-01'), stack()))

    # Escape: up, deselect, Edit off
    p.page.keyboard.press('Escape'); time.sleep(0.3)
    check(p.ev(SEL) == 'lamp-01', 'Escape goes up to lamp-01', p.ev(SEL))
    p.page.keyboard.press('Escape'); time.sleep(0.3)
    check(p.ev(SEL) is None, 'a second Escape deselects', p.ev(SEL))
    p.page.keyboard.press('Escape'); time.sleep(0.3)
    check(p.ev("() => __ep().modes.edit") is False, 'a third Escape leaves Edit mode')
    p.edit_on(); time.sleep(0.4)

    # SP-L10: a short press on a handle over the floor, or the sky, changes nothing
    click(m, sh['x'], sh['y']); time.sleep(0.4)
    floor = point_over(p, sh, behind='ground-plane', span=220)
    sky = point_over(p, sh, behind=None, span=220)
    for name, q in (('the floor', floor), ('empty space', sky)):
        if q is None:
            check(False, f'a handle point with {name} behind it was found')
            continue
        click(m, q['x'], q['y']); time.sleep(0.4)
        check(p.ev(SEL) == 'lamp-01', f'a short press on the {q["axis"]} handle over {name} keeps lamp-01 (SP-L10)', p.ev(SEL))
        check(p.ev(TR, 'lamp-01') == LAMP0, '  and moves nothing', p.ev(TR, 'lamp-01'))

    # a real drag past 4 px records one Move; a one-move 30 px drag records one too (S-4)
    p.ev("() => __ep().selectForEdit(atriumClient.som.getNodeByName('crate-01'))"); time.sleep(0.3)
    cpt = point_over(p, cr, anchor='crate-01', span=80)
    check(cpt is not None, 'a point over a handle of crate-01', cpt)
    n0 = len(stack())
    m.move(cpt['x'], cpt['y']); m.down(click_count=1)
    for i in range(1, 6): m.move(cpt['x'] + 5 * i, cpt['y']); time.sleep(0.03)
    m.up(click_count=1); time.sleep(0.6)
    check(len(stack()) == n0 + 1 and stack()[-1].startswith(('Move', 'Transform')), 'a 25 px drag on a handle records one move', stack()[-3:])
    n1 = len(stack())
    cpt2 = point_over(p, p.ev(SCREEN, 'crate-01'), anchor='crate-01', span=80)
    m.move(cpt2['x'], cpt2['y']); m.down(click_count=1); m.move(cpt2['x'] + 30, cpt2['y']); m.up(click_count=1); time.sleep(0.6)
    check(len(stack()) == n1 + 1, 'a drag that arrives as ONE 30 px move records one move (S-4)', stack()[-3:])

    # S-2: another tab moves the crate during a short press on its handle
    q = Page(br); q.connect(f'wss://127.0.0.1:8443/w/c1{k}'); q.edit_on(); time.sleep(0.8)
    cpt3 = point_over(p, p.ev(SCREEN, 'crate-01'), anchor='crate-01', span=80)
    m.move(cpt3['x'], cpt3['y']); m.down(click_count=1); time.sleep(0.1)
    q.ev("() => { atriumClient.som.getNodeByName('crate-01').translation = [1, 0.25, -2] }"); time.sleep(0.5)
    m.move(cpt3['x'] + 2, cpt3['y']); time.sleep(0.1); m.up(click_count=1); time.sleep(0.5)
    check(p.ev(DRAWN, 'crate-01') == p.ev(TR, 'crate-01') == [1, 0.25, -2], 'another tab’s move during a short press: drawn where the SOM has it (S-2)', (p.ev(DRAWN, 'crate-01'), p.ev(TR, 'crate-01')))
    check(p.errors == [] and q.errors == [], 'no page errors', p.errors[:2] + q.errors[:2])
    br.close()
done()
