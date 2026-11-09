# selection-parts c5 (the fresh-agent code check's finding 2): touch. A tap on
# a handle is a click (T17), and changes the selection only within the group
# (SP-L10): on touch the compatibility mousedown comes AFTER the release, so
# the release's verdict can't ride on the mouse press record. A double-tap on
# the stand: what it selects is printed (touch drilling is stated, not promised).
# A short touch DRAG on a handle (the outside code review, S-1): the move is
# kept, and the tap's click that can follow selects nothing.
from sp import *

class TouchPage(Page):
    def __init__(self, browser, origin=A, path='/apps/client/local.html'):
        self.ctx = browser.new_context(ignore_https_errors=True, viewport={'width': 1280, 'height': 800}, has_touch=True)
        self.page = self.ctx.new_page(); self.errors = []; self.console = []; self.failed = []
        self.page.on('pageerror', lambda e: self.errors.append(str(e)))
        self.page.goto(origin + path)
        self.page.wait_for_function('window.atriumClient && window.stage && window.__lib', timeout=30000)

with sync_playwright() as pw:
    br = launch(pw)
    p = TouchPage(br); p.connect(f'wss://127.0.0.1:8443/w/c5{key()}'); p.edit_on(); time.sleep(1)
    t = p.page.touchscreen
    sh = p.ev(SCREEN, 'lamp-shade'); st = p.ev(SCREEN, 'lamp-stand')
    t.tap(sh['x'], sh['y']); time.sleep(0.5)
    check(p.ev(SEL) == 'lamp-01', 'a tap on the shade selects lamp-01', p.ev(SEL))
    floor = point_over(p, sh, behind='ground-plane', span=220)
    check(floor is not None, 'a point over a handle of lamp-01 with the floor behind it', floor)
    if floor:
        t.tap(floor['x'], floor['y']); time.sleep(0.5)
        check(p.ev(SEL) == 'lamp-01', f'a tap on the {floor["axis"]} handle over the floor keeps lamp-01 (SP-L10 on touch)', p.ev(SEL))
        check(p.ev(TR, 'lamp-01') == [3, 0, 0] and p.ev(UNDO) == [], '  nothing moved or recorded (T17 on touch)', (p.ev(TR, 'lamp-01'), p.ev(UNDO)))
    for travel in (6, 10):
        if not floor: break
        p.ev("() => __ep().selectForEdit(atriumClient.som.getNodeByName('lamp-01'))"); time.sleep(0.3)
        before = len(p.ev(UNDO)); y0 = p.ev(TR, 'lamp-01')[1]
        cdp = p.ctx.new_cdp_session(p.page)
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': floor['x'], 'y': floor['y']}]}); time.sleep(0.05)
        for i in range(1, travel // 2 + 1):
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': floor['x'], 'y': floor['y'] - 2 * i}]}); time.sleep(0.02)
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); time.sleep(0.6)
        check(p.ev(SEL) == 'lamp-01', f'a {travel} px touch drag on the handle over the floor keeps lamp-01 (S-1)', p.ev(SEL))
        check(len(p.ev(UNDO)) == before + 1 and p.ev(TR, 'lamp-01')[1] > y0, '  and is one move', (p.ev(TR, 'lamp-01'), p.ev(UNDO)[-2:]))
        p.ev("() => __lib().undo.run('undo')"); time.sleep(0.5)
    p.ev("() => __ep().selectForEdit(atriumClient.som.getNodeByName('lamp-01'))"); time.sleep(0.3)
    while p.ev(UNDO): p.ev("() => __lib().undo.run('undo')"); time.sleep(0.4)
    t.tap(st['x'], st['y']); time.sleep(0.12); t.tap(st['x'], st['y']); time.sleep(0.6)
    print(f'INFO a double-tap on the stand with lamp-01 selected selects: {p.ev(SEL)}; lamp {p.ev(TR, "lamp-01")}; undo {p.ev(UNDO)}')
    check(p.ev(TR, 'lamp-01') == [3, 0, 0] and p.ev(UNDO) == [], '  the double-tap moves nothing and records nothing', (p.ev(TR, 'lamp-01'), p.ev(UNDO)))
    check(p.errors == [], 'no page errors', p.errors[:2])
    br.close()
done()
