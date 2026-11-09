# selection-parts c2 (PREBRIEF-selection-parts.md §5, harness): T18, the drag
# ends before the handles change (SP-L9 (a), SP-L12 (a)). Escape mid-drag of
# the shade keeps the shade's move, selects lamp-01 and leaves it where it
# was (the SOM, the drawing and the server's own copy); a remote removal and
# a disconnect mid-drag no longer strand the handles: the next click selects.
import json
from sp import *

def server_translation(key, name):
    doc = json.loads(http(f'/__doc?key={key}'))
    node = next((n for n in doc.get('nodes', []) if n.get('name') == name), None)
    return [round(v, 4) for v in node.get('translation', [0, 0, 0])] if node else None

def drag_start(p, m, around, anchor='lamp-01'):
    q = point_over(p, around, anchor=anchor, span=90)
    check(q is not None, 'a point over a handle of the selection', q)
    m.move(q['x'], q['y']); m.down(click_count=1)
    for i in range(1, 6): m.move(q['x'] + 5 * i, q['y']); time.sleep(0.03)
    return q

with sync_playwright() as pw:
    br = launch(pw)
    k = 'c2' + key()
    p = Page(br); p.connect(f'wss://127.0.0.1:8443/w/{k}'); p.edit_on(); time.sleep(1)
    m = p.page.mouse
    sh = p.ev(SCREEN, 'lamp-shade'); cr = p.ev(SCREEN, 'crate-01')

    # Escape mid-drag of a part (Fable review, M-1)
    p.page.keyboard.down('Alt'); click(m, sh['x'], sh['y']); p.page.keyboard.up('Alt'); time.sleep(0.4)
    check(p.ev(SEL) == 'lamp-shade', 'Alt-click selects the shade', p.ev(SEL))
    q = drag_start(p, m, p.ev(SCREEN, 'lamp-shade'))
    p.page.keyboard.press('Escape'); time.sleep(0.2)
    for i in range(6, 10): m.move(q['x'] + 5 * i, q['y']); time.sleep(0.03)
    m.up(click_count=1); time.sleep(0.8)
    check(p.ev(SEL) == 'lamp-01', 'Escape mid-drag goes up to lamp-01', p.ev(SEL))
    check(p.ev(TR, 'lamp-01') == [3, 0, 0], '  lamp-01 hasn’t moved in the SOM', p.ev(TR, 'lamp-01'))
    check(p.ev(DRAWN, 'lamp-01') == [3, 0, 0], '  nor on screen', p.ev(DRAWN, 'lamp-01'))
    check(server_translation(k, 'lamp-01') == [3, 0, 0], '  nor on the server', server_translation(k, 'lamp-01'))
    labels = p.ev(UNDO)
    check(labels == ['Move “lamp-shade”'], '  the shade’s move was kept and recorded, once (SP-L9 (a))', labels)
    check(p.ev(GZ)['dragging'] is False, '  the handles aren’t stranded', p.ev(GZ))
    click(m, cr['x'], cr['y']); time.sleep(0.4)
    check(p.ev(SEL) == 'crate-01', '  and the next click selects (SP-L12)', p.ev(SEL))

    # another tab removes the object being dragged
    b = Page(br); b.connect(f'wss://127.0.0.1:8443/w/{k}'); b.edit_on(); time.sleep(0.8)
    drag_start(p, m, p.ev(SCREEN, 'crate-01'), anchor='crate-01')
    b.ev("() => atriumClient.removeNode('crate-01')"); time.sleep(0.6)
    m.up(click_count=1); time.sleep(0.5)
    check(p.ev(SEL) is None and p.ev(GZ)['dragging'] is False, 'a removal by another tab mid-drag: deselected, not stranded', (p.ev(SEL), p.ev(GZ)))
    sh = p.ev(SCREEN, 'lamp-shade')
    click(m, sh['x'], sh['y']); time.sleep(0.4)
    check(p.ev(SEL) == 'lamp-01', '  and the next click selects (SP-L12)', p.ev(SEL))

    # a disconnect mid-drag
    drag_start(p, m, p.ev(SCREEN, 'lamp-shade'))
    p.ev("() => atriumClient.disconnect()"); time.sleep(0.5)
    m.up(click_count=1); time.sleep(0.3)
    check(p.ev(GZ)['dragging'] is False, 'a disconnect mid-drag: not stranded', p.ev(GZ))
    p.page.click('#connectBtn'); p.wait('window.atriumClient.connected && window.atriumClient.som'); time.sleep(0.8)
    p.edit_on(); time.sleep(0.4)
    sh = p.ev(SCREEN, 'lamp-shade')
    click(m, sh['x'], sh['y']); time.sleep(0.4)
    check(p.ev(SEL) == 'lamp-01', '  after the reconnect the next click selects (SP-L12)', p.ev(SEL))
    check(p.errors == [] and b.errors == [], 'no page errors', p.errors[:2] + b.errors[:2])
    br.close()
done()
