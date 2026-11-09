# selection-parts c6 (the outside code review, N-1): T17 in rotate and scale
# modes, with the snaps off and on. A 2 px press on a handle draws nothing
# and records nothing; a 40 px drag records one Rotate or Scale, drawn as the
# SOM has it, snapped when the snap is on.
import math
from sp import *

ROT = "(n) => [...atriumClient.som.getNodeByName(n).rotation].map(v => Math.round(v * 1e4) / 1e4)"
SCL = "(n) => [...atriumClient.som.getNodeByName(n).scale].map(v => Math.round(v * 1e4) / 1e4)"
DROT = "(n) => stage.scene.getObjectByName(n).quaternion.toArray().map(v => Math.round(v * 1e4) / 1e4)"
DSCL = "(n) => stage.scene.getObjectByName(n).scale.toArray().map(v => Math.round(v * 1e4) / 1e4)"

def mode(p, m):
    p.page.click(f'#ep-modes button[data-mode="{m}"]'); time.sleep(0.3)

def drag(m, q, travel, steps=8):
    m.move(q['x'], q['y']); m.down(click_count=1)
    for i in range(1, steps + 1): m.move(q['x'] + travel * i / steps, q['y'] - travel * i / steps / 2); time.sleep(0.03)
    m.up(click_count=1); time.sleep(0.6)

with sync_playwright() as pw:
    br = launch(pw)
    p = Page(br); p.connect(f'wss://127.0.0.1:8443/w/c6{key()}'); p.edit_on(); time.sleep(1)
    m = p.page.mouse
    for snap in (False, True):
        for md, read, drawn, label in (('rotate', ROT, DROT, 'Rotate'), ('scale', SCL, DSCL, 'Scale')):
            p.ev("() => __ep().selectForEdit(atriumClient.som.getNodeByName('crate-01'))"); time.sleep(0.3)
            mode(p, md)
            if snap != p.ev("() => document.getElementById('ep-snap-angle').checked"):
                p.page.click('#ep-snap-angle'); p.page.click('#ep-snap-scale'); time.sleep(0.2)
            q = point_over(p, p.ev(SCREEN, 'crate-01'), anchor='crate-01', span=110)
            check(q is not None, f'{md}{" (snaps on)" if snap else ""}: a point over a handle', q)
            if not q: continue
            v0 = p.ev(read, 'crate-01'); n0 = len(p.ev(UNDO))
            drag(m, q, 2, steps=2)
            check(p.ev(read, 'crate-01') == v0 and p.ev(drawn, 'crate-01') == v0 and len(p.ev(UNDO)) == n0,
                  f'  a 2 px press draws nothing and records nothing', (p.ev(read, 'crate-01'), p.ev(drawn, 'crate-01')))
            drag(m, q, 40)
            labels = p.ev(UNDO)
            check(len(labels) == n0 + 1 and labels[-1].startswith(label), f'  a 40 px drag records one {label}', labels[-2:])
            check(p.ev(read, 'crate-01') == p.ev(drawn, 'crate-01'), '  drawn as the SOM has it', (p.ev(read, 'crate-01'), p.ev(drawn, 'crate-01')))
            if snap and md == 'rotate':
                qv = p.ev(read, 'crate-01'); ang = math.degrees(2 * math.acos(min(1, abs(qv[3]))))
                check(abs(ang / 15 - round(ang / 15)) < 0.02, '  snapped to 15°', round(ang, 2))
            p.ev("() => __lib().undo.run('undo')"); time.sleep(0.5)
    check(p.errors == [], 'no page errors', p.errors[:2])
    br.close()
done()
