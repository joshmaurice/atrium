# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
"""touch-nav harness checks (pre-brief §5): see tn_lib.py for the touch helpers."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tn_lib import *

with sync_playwright() as pw:
    br = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    k = 'atrtn%d' % (int(time.time()) % 100000)
    p = phone(br); connect(p, k); t = Touch(p.page)
    cx, cy = centre(p)

    # t0 — TN-L7 (a): nothing shows before the first touch; the first touch shows the stick
    ui = p.ev(UI)
    check('t0a no stick before a touch', not ui['stick'] and not ui['fp'], json.dumps(ui))
    t.down(0, cx, cy + 150); t.up(0); time.sleep(0.4)
    ui = p.ev(UI)
    check('t0b the first touch shows the stick, the button and the touch hint',
          ui['stick'] and ui['fp'] and 'Stick to walk' in ui['hint'], json.dumps(ui))

    # t1 — a one-finger drag looks (0.005 rad / px); a vertical one pitches
    n0 = p.ev(NAV)
    t.drag(1, (cx - 50, cy), (cx + 50, cy)); time.sleep(0.3)
    n1 = p.ev(NAV)
    check('t1a a 100 px drag turns the view by about 0.5 rad', abs((n1['yaw'] - n0['yaw']) + 0.5) < 0.03, f"Δyaw {n1['yaw'] - n0['yaw']:.4f}")
    check('t1b and does not walk', n1['pos'][0] == n0['pos'][0] and n1['pos'][2] == n0['pos'][2])
    t.drag(1, (cx, cy - 40), (cx, cy + 40)); time.sleep(0.3)
    n2 = p.ev(NAV)
    check('t1c an 80 px vertical drag pitches by about -0.4 rad', abs((n2['pitch'] - n1['pitch']) + 0.4) < 0.03, f"Δpitch {n2['pitch'] - n1['pitch']:.4f}")
    p.ev("stage.nav.yaw = 0; stage.nav.pitch = 0")

    # t2 — the stick walks (forward, ~1.4 m/s at full push) and a peer sees it
    peer = Page(br); peer.connect(f'wss://127.0.0.1:8443/w/{k}'); time.sleep(1.0)
    me = p.ev("stage.nav._avatar.localNode.name")
    sx, sy = stick_centre(p)
    a = p.ev(NAV)
    t.down(2, sx, sy); t.move(2, sx, sy - 30); t.move(2, sx, sy - 60)   # past the rim: full push
    t0 = time.time(); time.sleep(1.5)
    mid = p.ev(NAV)
    t.up(2); el = time.time() - t0; time.sleep(0.5)
    b = p.ev(NAV)
    walked = a['pos'][2] - b['pos'][2]
    check('t2a a full push walks forward (−Z) at about the world speed', walked > 0.8 * 1.4 * 1.5 * 0.8 and abs(b['pos'][0] - a['pos'][0]) < 0.05,
          f'walked {walked:.2f} m in {el:.2f} s, input during {mid["input"]}')
    check('t2b release stops: input (0, 0), the knob home', b['input'] == [0, 0] and p.ev("document.getElementById('touch-stick-knob').style.transform") in ('translate(0px, 0px)', ''),
          str(p.ev("document.getElementById('touch-stick-knob').style.transform")))
    time.sleep(1.5)
    seen = peer.ev(f"(() => {{ const n = atriumClient.som.getNodeByName({json.dumps(me)}); return n ? n.translation.slice() : null }})()")
    check('t2c the peer sees the avatar where it walked', seen is not None and abs(seen[2] - b['pos'][2]) < 0.2, f'peer {seen} me {b["pos"]}')
    peer.close()

    # t5 — stick and look at once (two thumbs)
    a = p.ev(NAV)
    t.down(3, sx, sy); t.move(3, sx + 60, sy)           # stick right
    t.down(4, cx, cy); 
    for s in range(1, 11): t.move(4, cx + 6 * s, cy); time.sleep(0.03)
    time.sleep(0.6)
    t.up(4); t.up(3); time.sleep(0.4)
    b = p.ev(NAV)
    check('t5 two thumbs: the stick strafes while the other finger turns', abs(b['yaw'] - a['yaw'] + 0.3) < 0.05 and math.hypot(b['pos'][0] - a['pos'][0], b['pos'][2] - a['pos'][2]) > 0.3,
          f"Δyaw {b['yaw'] - a['yaw']:.3f}, moved {math.hypot(b['pos'][0] - a['pos'][0], b['pos'][2] - a['pos'][2]):.2f} m")

    # t3 — taps in Edit. Back at the spawn point first: t5 strafed through the atrium's
    # wall, which would hide the cube. At 390 px the Edit panel covers the middle:
    # turn until the cube is left of it.
    p.ev("stage.nav._avatar.localNode.translation = [0, 0.7, 0]; stage.nav.yaw = 0; stage.nav.pitch = 0"); time.sleep(0.5)
    p.ev("document.getElementById('edit-toggle-btn').click()"); time.sleep(0.6)
    p.ev("document.querySelector('#ep-palette button[data-kind=\"cube\"]').click()"); time.sleep(1.5)
    home(p)
    cube = p.ev("__ep().selected?.name")
    SEL = "__ep().selected?.name ?? null"
    PROJ = f"""(() => {{ const o = stage.scene.getObjectByName({json.dumps(cube)}); const v = new (o.position.constructor)();
        o.getWorldPosition(v); v.project(stage.camera); const r = document.querySelector('#viewport canvas').getBoundingClientRect();
        return [r.x + (v.x + 1) / 2 * r.width, r.y + (1 - v.y) / 2 * r.height] }})()"""
    def deselect(): p.ev("__ep().selectForEdit(null)"); time.sleep(0.8)
    ui = p.ev(UI)
    check('t3a Edit mode: the stick still shows (TN-L8 (a)) and the hint is the touch one', ui['stick'] and 'Tap to select' in ui['hint'], json.dumps(ui))
    for _ in range(40):
        scr = p.ev(PROJ)
        if scr[0] < 90: break
        p.ev("stage.nav.yaw -= 0.03"); time.sleep(0.1)
    time.sleep(0.3); scr = p.ev(PROJ)
    check('t3 setup: the cube is on the canvas, not under the Edit panel',
          p.ev(f"document.elementFromPoint({scr[0]}, {scr[1]}) === document.querySelector('#viewport canvas')"), f'at {scr}')
    # clicks Chrome sends (document, capture) against clicks the page's handlers see (viewport, bubble)
    p.ev("window.__docClk = 0; window.__vpClk = 0; document.addEventListener('click', () => __docClk++, true); document.getElementById('viewport').addEventListener('click', () => __vpClk++)")
    clk = lambda: p.ev("[__docClk, __vpClk]")
    deselect(); y0 = p.ev(NAV)['yaw']; c0 = clk()
    t.down(5, scr[0], scr[1])
    for s in range(1, 7): t.move(5, scr[0] + 2 * s, scr[1])
    t.up(5); time.sleep(0.8); c1 = clk()
    check('t3b a 12 px drag on the cube looks, Chrome still sends its click, and the page swallows it: nothing selected',
          p.ev(SEL) is None and abs(p.ev(NAV)['yaw'] - y0) > 0.03 and c1[0] - c0[0] == 1 and c1[1] - c0[1] == 0,
          f"selected {p.ev(SEL)}, Δyaw {p.ev(NAV)['yaw'] - y0:.3f}, clicks sent/seen {c1[0] - c0[0]}/{c1[1] - c0[1]}")
    p.ev(f"stage.nav.yaw = {y0}"); time.sleep(0.4); scr = p.ev(PROJ)
    deselect(); p.page.touchscreen.tap(scr[0], scr[1]); time.sleep(0.8)
    check('t3c a tap on the cube selects it', p.ev(SEL) == cube, f"selected {p.ev(SEL)} want {cube}")
    deselect(); y0 = p.ev(NAV)['yaw']
    t.down(5, scr[0], scr[1]); t.move(5, scr[0] + 2.5, scr[1] + 1); t.move(5, scr[0] + 5, scr[1] + 2); t.up(5); time.sleep(0.8)
    check('t3d S-1: a tap that rolls 5 px selects and does not look', p.ev(SEL) == cube and abs(p.ev(NAV)['yaw'] - y0) < 1e-9,
          f"selected {p.ev(SEL)}, Δyaw {p.ev(NAV)['yaw'] - y0:.4f}")
    # S-2 — the stick held by a real finger; the tapping finger synthetic (tn_lib.synth says why)
    deselect(); sx, sy = stick_centre(p); c0 = clk()
    t.down(11, sx, sy); t.move(11, sx, sy - 2)          # a thumb resting on the stick
    synth(p, 'pointerdown', 901, scr[0], scr[1]); synth(p, 'pointerup', 901, scr[0], scr[1]); time.sleep(0.8)
    c1 = clk()
    check('t3e S-2: with a thumb on the stick, a tap on the cube selects it (the page makes the click)',
          p.ev(SEL) == cube and c1[0] - c0[0] == 1, f"selected {p.ev(SEL)}, clicks {c1[0] - c0[0]}")
    bfp = p.ev("(() => { const r = document.getElementById('touch-fp').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })()")
    cam0 = p.ev("stage.nav._avatar.cameraNode.translation[1]")
    synth(p, 'pointerdown', 902, bfp[0], bfp[1]); synth(p, 'pointerup', 902, bfp[0], bfp[1]); time.sleep(0.6)
    cam1 = p.ev("stage.nav._avatar.cameraNode.translation[1]")
    check('t3f S-2: with a thumb on the stick, a tap on First person works, once', cam0 != cam1 and cam1 == 1.6, f'camera y {cam0} → {cam1}')
    synth(p, 'pointerdown', 903, bfp[0], bfp[1]); synth(p, 'pointerup', 903, bfp[0], bfp[1]); time.sleep(0.6)
    t.up(11); time.sleep(0.4)
    check('t3g ... and a second tap goes back to third person', p.ev("stage.nav._avatar.cameraNode.translation[1]") == cam0)
    # t6 — a drag that starts on the handle's centre moves the cube, not the view (B3)
    p.ev(f"__ep().selectForEdit(atriumClient.som.getNodeByName({json.dumps(cube)}))"); time.sleep(0.8); scr = p.ev(PROJ)
    y0 = p.ev(NAV)['yaw']; pos0 = p.ev(f"atriumClient.som.getNodeByName({json.dumps(cube)}).translation.slice()")
    t.drag(6, (scr[0], scr[1]), (scr[0] + 40, scr[1] - 20), steps=12, hold=0.03); time.sleep(1.0)
    pos1 = p.ev(f"atriumClient.som.getNodeByName({json.dumps(cube)}).translation.slice()")
    moved = math.dist(pos0, pos1); dyaw = abs(p.ev(NAV)['yaw'] - y0)
    check('t6 a touch drag on the handle moves the cube and does not turn the view', moved > 0.05 and dyaw < 1e-6, f'moved {moved:.3f}, Δyaw {dyaw:.4f}')
    # t6b — S-3: a second finger during a handle drag doesn't steer it or end it. The first
    # finger settles before each reading (its moves arrive a frame late); the second is
    # synthetic (tn_lib.synth) and lands on the canvas, left of the Edit panel.
    scr = p.ev(PROJ); obj = lambda: p.ev(f"stage.scene.getObjectByName({json.dumps(cube)}).position.toArray()")
    t.down(6, scr[0], scr[1])
    for s_ in range(1, 6): t.move(6, scr[0] + 4 * s_, scr[1]); time.sleep(0.03)
    time.sleep(0.8); o1 = obj()
    on = synth(p, 'pointerdown', 913, 40, 300)
    for j in range(1, 8): synth(p, 'pointermove', 913, 40 + 6 * j, 300 + 12 * j); time.sleep(0.03)
    time.sleep(0.6); o2 = obj(); synth(p, 'pointerup', 913, 82, 384); time.sleep(0.4)
    for s_ in range(6, 9): t.move(6, scr[0] + 4 * s_, scr[1]); time.sleep(0.03)
    time.sleep(0.6); o3 = obj(); t.up(6); time.sleep(1.0)
    check('t6b S-3: a second finger moving on the view during a handle drag leaves the cube still, and the first finger drags on after it lifts',
          on == 'CANVAS' and math.dist(o1, o2) < 1e-6 and math.dist(o2, o3) > 0.05,
          f'second finger on {on}, jump {math.dist(o1, o2):.4f} (1.90 at cba7f8b), after the lift {math.dist(o2, o3):.3f}')
    p.ev("document.getElementById('edit-toggle-btn').click()"); time.sleep(0.5)

    # t4 — ORBIT: the stick hides; a drag orbits; a pinch out zooms in
    p.ev("(() => { const s = document.getElementById('mode-switcher'); s.value = 'ORBIT'; s.dispatchEvent(new Event('change')) })()"); time.sleep(0.5)
    p.ev("stage.nav.orbitRadius = 10"); time.sleep(0.2)       # away from the 0.5 clamp (the avatar is at the spawn point)
    ui = p.ev(UI); n0 = p.ev(NAV)
    check('t4a ORBIT hides the stick and says pinch', n0['mode'] == 'ORBIT' and not ui['stick'] and 'Pinch to zoom' in ui['hint'], json.dumps(ui))
    t.down(7, cx - 40, cy); t.down(8, cx + 40, cy)
    for s in range(1, 11): t.move(7, cx - 40 - 6 * s, cy); t.move(8, cx + 40 + 6 * s, cy); time.sleep(0.02)
    t.up(8); t.up(7); time.sleep(0.3)
    n1 = p.ev(NAV)
    check('t4b spreading two fingers (80 → 200 px) zooms in by 2.5×', abs(n0['r'] / n1['r'] - 2.5) < 0.1, f"r {n0['r']:.2f} → {n1['r']:.2f}")
    az0 = p.ev("stage.nav._orbitAzimuth")
    t.drag(9, (cx - 50, cy), (cx + 50, cy)); time.sleep(0.3)
    check('t4c a one-finger drag orbits', abs(p.ev("stage.nav._orbitAzimuth") - az0 + 0.5) < 0.03)
    p.ev("(() => { const s = document.getElementById('mode-switcher'); s.value = 'WALK'; s.dispatchEvent(new Event('change')) })()"); time.sleep(0.5)
    check('t4d back in WALK the stick shows again', p.ev(UI)['stick'])

    # t8 — the First person button by a real touch tap (N-2), and back
    bfp = p.ev("(() => { const r = document.getElementById('touch-fp').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })()")
    cam0 = p.ev("stage.nav._avatar.cameraNode.translation[1]")
    p.page.touchscreen.tap(bfp[0], bfp[1]); time.sleep(0.6)
    fp_on = p.ev("stage.nav._avatar.cameraNode.translation[1]") == 1.6 and 'Third' in p.ev("document.getElementById('touch-fp').textContent")
    p.page.touchscreen.tap(bfp[0], bfp[1]); time.sleep(0.6)
    check('t8 a touch tap on the button goes first person, a second one back', fp_on and p.ev("stage.nav._avatar.cameraNode.translation[1]") == cam0)

    # t2-pad — a teleporter pad 3 m ahead fires when the stick walks onto it. Away from
    # the spawn point first: a pad near spawn stays disarmed until you have left it.
    p.ev("stage.nav._avatar.localNode.translation = [0, 0.7, 6]; stage.nav.yaw = 0"); time.sleep(0.6)
    k2 = k + 'b'
    dest = f'wss://127.0.0.1:8443/w/{k2}'
    p.ev("document.getElementById('edit-toggle-btn').click()"); time.sleep(0.5)
    p.ev("document.getElementById('ep-teleporter').click()"); time.sleep(0.5)
    p.ev(f"(() => {{ const i = document.getElementById('tp-dest-input'); i.value = {json.dumps(dest)}; i.dispatchEvent(new Event('input', {{ bubbles: true }})) }})()"); time.sleep(0.4)
    p.ev("document.getElementById('tp-save-btn').click()"); time.sleep(1.5)
    pad = p.ev("(() => { const n = atriumClient.som.nodes.find(n => n.extras?.atrium?.teleporter); return n ? { name: n.name, t: n.translation.slice() } : null })()")
    p.ev("document.getElementById('edit-toggle-btn').click()"); time.sleep(0.5)
    home(p)
    if pad:
        me_pos = p.ev(NAV)['pos']
        # face the pad (setup, not the gesture under test), then walk with the stick
        p.ev(f"stage.nav.yaw = Math.atan2(-({pad['t'][0]} - {me_pos[0]}), -({pad['t'][2]} - {me_pos[2]}))")
        t.down(10, sx, sy); t.move(10, sx, sy - 60)
        fired = False
        for _ in range(60):
            time.sleep(0.2)
            if k2 in (p.ev("document.getElementById('wsUrl').value") or ''): fired = True; break
        t.up(10)
        now = p.ev("document.getElementById('wsUrl').value")
        check('t2d walking onto a teleporter pad with the stick teleports', fired, f"pad {pad}, url now {now}")
    else:
        check('t2d setup: a pad was made', False, 'no pad')

    # t10 — S-4: the stick lets go on every route, each with the stick at full push first
    def pushed():
        sx, sy = stick_centre(p); t.down(20, sx, sy); t.move(20, sx, sy - 60); time.sleep(0.4)
        return p.ev(NAV)['input'] == [0, -1]
    def stopped(label):
        time.sleep(0.4); a = p.ev(NAV); time.sleep(0.6); b = p.ev(NAV)
        knob = p.ev("document.getElementById('touch-stick-knob').style.transform")
        ok = a['input'] == [0, 0] and b['pos'] == a['pos'] and knob in ('translate(0px, 0px)', '')
        check(f't10{label}', ok, f"input {a['input']}, still {b['pos'] == a['pos']}, knob {knob}")
        t.pts.clear()
    check('t10 after the teleport (t2d) the stick is let go and the avatar stands still', p.ev(NAV)['input'] == [0, 0])
    home(p)
    ok = pushed(); t.cdp.send('Input.dispatchTouchEvent', {'type': 'touchCancel', 'touchPoints': []}); stopped(f'a a cancelled touch (pushed {ok})')
    ok = pushed(); p.ev("(() => { const s = document.getElementById('mode-switcher'); s.value = 'ORBIT'; s.dispatchEvent(new Event('change')) })()")
    stopped(f'b the mode switched to ORBIT (pushed {ok})'); t.cdp.send('Input.dispatchTouchEvent', {'type': 'touchCancel', 'touchPoints': []})
    p.ev("(() => { const s = document.getElementById('mode-switcher'); s.value = 'WALK'; s.dispatchEvent(new Event('change')) })()"); time.sleep(0.4)
    ok = pushed(); p.ev("window.dispatchEvent(new Event('blur'))"); stopped(f'c the window blurred (pushed {ok})')
    t.cdp.send('Input.dispatchTouchEvent', {'type': 'touchCancel', 'touchPoints': []})
    ok = pushed(); p.ev("Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); delete document.hidden")
    stopped(f'd the page hidden (pushed {ok})'); t.cdp.send('Input.dispatchTouchEvent', {'type': 'touchCancel', 'touchPoints': []})
    ok = pushed(); p.ev("connectBtn.click()"); p.wait("!window.atriumClient.connected"); time.sleep(1.0)
    inp = p.ev("stage.nav.moveInput")
    check(f't10e a disconnect lets go (pushed {ok})', inp == [0, 0], f'input {inp}')
    t.cdp.send('Input.dispatchTouchEvent', {'type': 'touchCancel', 'touchPoints': []}); t.pts.clear()
    time.sleep(1.5)
    ui = p.ev(UI)
    check('t11 N-1: disconnected (a static world), the stick shows but First person does not', ui['stick'] and not ui['fp'], json.dumps(ui))

    p.page.screenshot(path=f'{SHOTS}/touch-nav-phone.png')
    errs = list(p.errors); p.ctx.close()

    # t7 — a mouse page: no stick ever, the mouse drag turns at 0.002 rad / px as before
    m = Page(br); m.connect(f'wss://127.0.0.1:8443/w/{k}')
    mc = m.ev("(() => { const r = document.querySelector('#viewport canvas').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })()")
    y0 = m.ev(NAV)['yaw']
    m.page.mouse.move(mc[0] - 50, mc[1]); m.page.mouse.down(); m.page.mouse.move(mc[0] + 50, mc[1], steps=10); m.page.mouse.up(); time.sleep(0.3)
    check('t7a a mouse drag of 100 px turns 0.2 rad, as before', abs(m.ev(NAV)['yaw'] - y0 + 0.2) < 0.01, f"Δyaw {m.ev(NAV)['yaw'] - y0:.4f}")
    check('t7b a mouse page never shows the stick, and its hint is the mouse one', not m.ev(UI)['stick'] and 'WASD' in m.ev(UI)['hint'], json.dumps(m.ev(UI)))
    check('t9 no page errors', not errs and not m.errors, f'{errs} {m.errors}')
    m.close(); br.close()

print(f"\n{sum(1 for _, ok in RESULTS if ok)}/{len(RESULTS)} PASS")
sys.exit(0 if all(ok for _, ok in RESULTS) else 1)     # N-2: a FAIL fails the run
