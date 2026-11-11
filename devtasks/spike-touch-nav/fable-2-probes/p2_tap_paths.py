"""P2: the made-up tap (S-2's fix) and the First person button.
 a) a view finger CANCELLED while the stick is held: does the page make a click?
 b) a view finger held 2 s while the stick is held, then lifted: a click?
 c) First person: a finger that presses the button, slides 150 px off it and lifts: does it toggle?
 d) touch seen BEFORE connecting, then connect: does the First person button show without another event?
"""
from common import *

with sync_playwright() as pw:
    br = pw.chromium.launch(args=ARGS)
    p = phone(br); t = Touch(p.page)
    # d) a touch in the static world first, then connect
    cx, cy = centre(p)
    t.down(0, cx, cy + 150); t.up(0); time.sleep(0.4)
    say('d) static, after a touch', p.ev(UI))
    connect(p, fresh()); time.sleep(0.5)
    say('d) connected, no further event', p.ev(UI))

    cube, PROJ = edit_with_cube(p)
    scr = p.ev(PROJ)
    say('cube on canvas', p.ev(f"document.elementFromPoint({scr[0]}, {scr[1]}) === document.querySelector('#viewport canvas')"))
    p.ev("window.__docClk = 0; document.addEventListener('click', () => __docClk++, true)")
    def deselect(): p.ev("__ep().selectForEdit(null)"); time.sleep(0.8)
    sx, sy = stick_centre(p)

    # a) cancel
    deselect(); c0 = p.ev("__docClk")
    t.down(11, sx, sy); t.move(11, sx, sy - 30)
    synth(p, 'pointerdown', 901, scr[0], scr[1]); time.sleep(0.2)
    synth(p, 'pointercancel', 901, scr[0], scr[1]); time.sleep(0.8)
    say('a) stick held, view finger pointercancel', f"selected {p.ev(SEL)}, clicks made {p.ev('__docClk') - c0}")
    # b) long hold
    deselect(); c0 = p.ev("__docClk")
    synth(p, 'pointerdown', 902, scr[0], scr[1]); time.sleep(2.0)
    synth(p, 'pointerup', 902, scr[0], scr[1]); time.sleep(0.8)
    say('b) stick held, view finger held 2 s then lifted', f"selected {p.ev(SEL)}, clicks made {p.ev('__docClk') - c0}")
    # a') the stick let go BEFORE the view finger is cancelled
    deselect(); c0 = p.ev("__docClk")
    synth(p, 'pointerdown', 903, scr[0], scr[1]); time.sleep(0.2)
    t.up(11); time.sleep(0.4)
    synth(p, 'pointercancel', 903, scr[0], scr[1]); time.sleep(0.8)
    say("a') view finger pressed with the stick held, stick let go, then the view finger cancelled", f"selected {p.ev(SEL)}, clicks made {p.ev('__docClk') - c0}")

    # c) the button: press, slide off, lift (a real finger)
    p.ev("document.getElementById('edit-toggle-btn').click()"); time.sleep(0.5)
    bfp = p.ev("(() => { const r = document.getElementById('touch-fp').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })()")
    cam0 = p.ev("stage.nav._avatar.cameraNode.translation[1]")
    t.down(12, bfp[0], bfp[1])
    for s in range(1, 11): t.move(12, bfp[0] + 15 * s, bfp[1] - 20 * s)
    t.up(12); time.sleep(0.6)
    cam1 = p.ev("stage.nav._avatar.cameraNode.translation[1]")
    say('c) button pressed, finger slid 150 px right / 200 px up, lifted', f"camera y {cam0} -> {cam1} (toggled: {cam0 != cam1}), text {p.ev('document.getElementById(\"touch-fp\").textContent')}")
    say('errors', p.errors)
    br.close()
