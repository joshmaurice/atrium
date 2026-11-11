"""P3: the stick held (the primary touch) while ANOTHER finger presses a move handle.
The handle press's click slop (T17: a click until 4 px) is edit-press.js's, fed by the viewport's
capture listeners, which since S-3's fix ignore non-primary touches.
 0) control: no stick, one (primary) synthetic finger wiggles 2 px on the handle  -> expect nothing moves
 1) stick held, pushed 5 px (inside its dead zone, so no walking); second finger wiggles 2 px on the handle
 2) stick held, not moved; second finger drags the handle 40 px
"""
from common import *

with sync_playwright() as pw:
    br = pw.chromium.launch(args=ARGS)
    p = phone(br); connect(p, fresh()); t = Touch(p.page)
    first_touch(p, t)
    cube, PROJ = edit_with_cube(p)
    say('snap grid', p.ev("document.getElementById('ep-snap-grid')?.checked"))
    sel = lambda: p.ev(f"__ep().selectForEdit(atriumClient.som.getNodeByName({json.dumps(cube)}))")
    undo = lambda: p.ev("(() => { const u = __lib().undo; return u?.size ?? u?.length ?? u?.undoCount ?? (u?.canUndo ? u.canUndo() : null) })()")
    say('undo api', p.ev("Object.keys(__lib().undo ?? {}).join(',')"))
    sx, sy = stick_centre(p)

    def wiggle(pid, primary, px):
        scr = p.ev(PROJ)
        synth(p, 'pointerdown', pid, scr[0], scr[1], primary=primary); time.sleep(0.1)
        n = max(2, px // 2)
        for s in range(1, n + 1):
            synth(p, 'pointermove', pid, scr[0] + px * s / n, scr[1], primary=primary); time.sleep(0.05)
        time.sleep(0.3)
        mid_obj = obj_pos(p, cube); mid_drag = dragging(p)
        synth(p, 'pointerup', pid, scr[0] + px, scr[1], primary=primary); time.sleep(1.0)
        return mid_obj, mid_drag

    # 0) control
    sel(); time.sleep(0.8); s0 = som_pos(p, cube); o0 = obj_pos(p, cube)
    mid, d = wiggle(920, True, 2)
    say('0) no stick, primary finger, 2 px on the handle', f"gizmo dragging during {d}; object moved during {math.dist(o0, mid):.4f}; SOM moved after {math.dist(s0, som_pos(p, cube)):.4f}; selected {p.ev(SEL)}")

    # 1) stick held and pushed 5 px (dead zone: input stays 0)
    sel(); time.sleep(0.8); s0 = som_pos(p, cube); o0 = obj_pos(p, cube)
    t.down(11, sx, sy); t.move(11, sx, sy - 3); t.move(11, sx, sy - 5); time.sleep(0.3)
    say('   stick input', p.ev(NAV)['input'])
    mid, d = wiggle(921, False, 2)
    say('1) stick held (thumb travelled 5 px), second finger, 2 px on the handle', f"gizmo dragging during {d}; object moved during {math.dist(o0, mid):.4f}; SOM moved after {math.dist(s0, som_pos(p, cube)):.4f}")
    # 1b) again, stick still held: now no press record at all
    s0 = som_pos(p, cube); o0 = obj_pos(p, cube)
    mid, d = wiggle(922, False, 2)
    say('1b) the same again, stick still held', f"gizmo dragging during {d}; object moved during {math.dist(o0, mid):.4f}; SOM moved after {math.dist(s0, som_pos(p, cube)):.4f}")
    t.up(11); time.sleep(0.5)

    # 2) stick held, thumb still; second finger drags the handle 40 px
    sel(); time.sleep(0.8); s0 = som_pos(p, cube); o0 = obj_pos(p, cube)
    t.down(12, sx, sy); time.sleep(0.3)
    mid, d = wiggle(923, False, 40)
    say('2) stick held (thumb still), second finger drags the handle 40 px', f"gizmo dragging during {d}; object moved during {math.dist(o0, mid):.4f}; SOM moved after {math.dist(s0, som_pos(p, cube)):.4f}")
    t.up(12); time.sleep(0.5)
    # 2c) control for 2: no stick, a primary finger drags the handle 40 px
    sel(); time.sleep(0.8); s0 = som_pos(p, cube); o0 = obj_pos(p, cube)
    mid, d = wiggle(924, True, 40)
    say('2c) control: no stick, primary finger drags the handle 40 px', f"gizmo dragging during {d}; object moved during {math.dist(o0, mid):.4f}; SOM moved after {math.dist(s0, som_pos(p, cube)):.4f}")
    say('errors', p.errors)
    br.close()
