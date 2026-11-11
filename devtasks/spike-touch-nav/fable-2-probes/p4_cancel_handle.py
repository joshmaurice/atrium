"""P4: the finger dragging a move handle is CANCELLED (pointercancel: a system gesture, the
notification shade...). TransformControls r163 has no pointercancel listener, so `dragging`
stays true. What can a touch user do next?
"""
from common import *

with sync_playwright() as pw:
    br = pw.chromium.launch(args=ARGS)
    p = phone(br); connect(p, fresh()); t = Touch(p.page)
    first_touch(p, t)
    cube, PROJ = edit_with_cube(p)
    p.ev(f"__ep().selectForEdit(atriumClient.som.getNodeByName({json.dumps(cube)}))"); time.sleep(0.8)
    scr = p.ev(PROJ); cx, cy = centre(p)
    s0 = som_pos(p, cube)
    t.down(6, scr[0], scr[1])
    for s in range(1, 6): t.move(6, scr[0] + 4 * s, scr[1]); time.sleep(0.03)
    time.sleep(0.5)
    say('handle drag under way', f"dragging {dragging(p)}, object moved {math.dist(s0, obj_pos(p, cube)):.3f}")
    t.cdp.send('Input.dispatchTouchEvent', {'type': 'touchCancel', 'touchPoints': []}); t.pts.clear(); time.sleep(0.8)
    say('after the cancel', f"dragging {dragging(p)}, SOM moved {math.dist(s0, som_pos(p, cube)):.3f}")

    # 1) a tap on empty view (top-left of the canvas), then is the drag over?
    for i in range(1, 4):
        p.page.touchscreen.tap(30, 200); time.sleep(0.8)
        say(f'tap {i} on the view', f"dragging {dragging(p)}")
    # 2) a 100 px look drag
    y0 = p.ev(NAV)['yaw']
    t.drag(7, (30, 200), (130, 200)); time.sleep(0.5)
    say('a 100 px look drag', f"Δyaw {p.ev(NAV)['yaw'] - y0:.3f}, dragging {dragging(p)}")
    # 3) a tap on the cube with nothing selected... the selection can't be cleared by tap either
    scr = p.ev(PROJ)
    o0 = obj_pos(p, cube)
    t.drag(8, (scr[0], scr[1]), (scr[0] + 40, scr[1]), steps=10, hold=0.03); time.sleep(0.8)
    say('a new 40 px drag on the handle', f"object moved {math.dist(o0, obj_pos(p, cube)):.3f}, dragging {dragging(p)}")
    say('stick still walks?', '')
    sx, sy = stick_centre(p); a = p.ev(NAV)['pos']
    t.down(9, sx, sy); t.move(9, sx, sy - 60); time.sleep(1.0); t.up(9); time.sleep(0.3)
    b = p.ev(NAV)['pos']; say('  walked', f"{math.dist(a, b):.2f} m")
    # 4) Edit off and on again
    p.ev("document.getElementById('edit-toggle-btn').click()"); time.sleep(0.6)
    say('after Edit off', f"dragging {dragging(p)}")
    y0 = p.ev(NAV)['yaw']
    t.drag(10, (30, 200), (130, 200)); time.sleep(0.5)
    say('a 100 px look drag after Edit off', f"Δyaw {p.ev(NAV)['yaw'] - y0:.3f}")
    say('errors', p.errors)
    br.close()
