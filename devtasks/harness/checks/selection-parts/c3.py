# selection-parts c3 (PREBRIEF-selection-parts.md §5, harness): nested groups
# in an `atr…` world (atrium.gltf). A click on a bench seat selects Furniture;
# a triple-click the seat; the breadcrumb's Bench-NE the bench; ten
# double-clicks in a row, on different groups' visible parts, each drill ONE
# level, move nothing and record nothing (the parts on screen, six or more:
# the drag-safety check SA-L6 (d)
# asked for). Then Inspect as a visitor: the same gestures, a hidden part
# unreachable.
from sp import *

ALL = """() => { const out = {}; for (const n of atriumClient.som.nodes ?? []) out[n.name] = [...n.translation].map(v => Math.round(v * 1e4) / 1e4); return out }"""
VISIBLE = """(name) => { const o = stage.scene.getObjectByName(name); if (!o) return false; const v = o.position.clone();
  o.updateWorldMatrix(true, false); o.getWorldPosition(v); v.project(stage.camera); return Math.abs(v.x) < 0.9 && Math.abs(v.y) < 0.9 && v.z < 1 }"""
CRUMB = """(name) => { const b = [...document.querySelectorAll('#ep-path button.ep-crumb')].find(e => e.textContent === name); if (!b) return false; b.click(); return true }"""

with sync_playwright() as pw:
    br = launch(pw)
    k = 'atr' + key()
    p = Page(br); p.connect(f'wss://127.0.0.1:8443/w/{k}'); p.edit_on(); time.sleep(1.2)
    m = p.page.mouse
    # face the furniture
    p.ev("() => { const c = stage.camera; c.position.set(0, 6, 9); c.lookAt(0, 0, 0); c.updateMatrixWorld(true) }"); time.sleep(0.3)
    bench = next((b for b in ['Bench-NE', 'Bench-SE', 'Bench-SW', 'Bench-NW'] if p.ev(VISIBLE, f'{b}-Seat')), None)
    check(bench is not None, 'a bench seat is on screen', bench)
    seatName = f'{bench}-Seat'
    seat = p.ev(SCREEN, seatName)
    click(m, seat['x'], seat['y']); time.sleep(0.4)
    check(p.ev(SEL) == 'Furniture', f'a click on {seatName} selects Furniture', p.ev(SEL))
    p.ev("() => __ep().selectForEdit(null)"); time.sleep(0.2)
    before = p.ev(ALL)
    triple(m, seat['x'], seat['y'])
    check(p.ev(SEL) == seatName, 'a triple-click selects the seat', p.ev(SEL))
    check(p.ev(PATH, 'ep-path') == f'Furniture › {bench} › {seatName}', 'the breadcrumb shows the path', p.ev(PATH, 'ep-path'))
    clicked = p.ev(CRUMB, bench); time.sleep(0.3)
    check(clicked and p.ev(SEL) == bench, f'the breadcrumb’s {bench} selects the bench', p.ev(SEL))
    check(p.ev(ALL) == before and p.ev(UNDO) == [], 'nothing moved, nothing recorded', p.ev(UNDO))

    # ten double-clicks on different groups' parts: each drills exactly one level
    targets = [n for n in ['Table-Center-Top', 'Credenza-North-Top', 'Bench-SE-Seat', 'Bench-SW-Seat', 'Credenza-East-Body',
                           'Bench-NW-Seat', 'Credenza-West-Top', 'Table-Center-Base', 'Credenza-South-Body', 'Bench-NE-LegLeft'] if p.ev(VISIBLE, n)]
    check(len(targets) >= 6, 'at least six of the ten parts are on screen', targets)
    # a real run of gestures (the fresh-agent code check's nit): from the bench
    # the breadcrumb selected, Escape up to Furniture (a click on another
    # bench's part would rightly select at the bench level, SP-L2), then for
    # each part a double-click and an Escape back up
    p.page.keyboard.press('Escape'); time.sleep(0.3)
    check(p.ev(SEL) == 'Furniture', 'Escape from the bench goes up to Furniture', p.ev(SEL))
    first = p.ev(SCREEN, targets[0])
    click(m, first['x'], first['y']); time.sleep(0.5)
    check(p.ev(SEL) == 'Furniture', '  a click on a part keeps Furniture', p.ev(SEL))
    for name in targets:
        pt = p.ev(SCREEN, name)
        dbl(m, pt['x'], pt['y'], travel=1)
        group = p.ev(f"() => atriumClient.som.getNodeByName('{name}').parent.name")
        check(p.ev(SEL) == group, f'double-click on {name} with Furniture selected: {group}', p.ev(SEL))
        p.page.keyboard.press('Escape'); time.sleep(0.3)
        check(p.ev(SEL) == 'Furniture', '  Escape goes back up to Furniture', p.ev(SEL))
    check(p.ev(ALL) == before, f'the {len(targets)} double-clicks moved nothing', None)
    check(p.ev(UNDO) == [], '  and recorded nothing', p.ev(UNDO))
    check(p.errors == [], 'no page errors', p.errors[:2])

    # Inspect, as a visitor (in space.gltf: the lamp; one part hidden by the owner)
    k2 = 'c3i' + key()
    o = Page(br); o.connect(f'wss://127.0.0.1:8443/w/{k2}'); o.edit_on(); time.sleep(0.8)
    o.ev("() => { atriumClient.som.getNodeByName('lamp-stand').visible = false }"); time.sleep(0.5)
    v = Page(br); v.connect(f'wss://127.0.0.1:8443/w/{k2}?visitor'); time.sleep(0.8)
    v.page.click('#inspect-toggle-btn'); time.sleep(0.4)
    vm = v.page.mouse
    sh = v.ev(SCREEN, 'lamp-shade'); st = v.ev(SCREEN, 'lamp-stand')
    click(vm, sh['x'], sh['y']); time.sleep(0.4)
    check((v.ev(IPNAME) or '').startswith('lamp-01 (2 parts'), 'Inspect: a click selects lamp-01 (its parts named)', v.ev(IPNAME))
    dbl(vm, sh['x'], sh['y'])
    check(v.ev(IPNAME) == 'lamp-shade', 'Inspect: a double-click selects the shade', v.ev(IPNAME))
    check(v.ev(PATH, 'ip-path') == 'lamp-01 › lamp-shade', 'Inspect: the breadcrumb reads lamp-01 › lamp-shade', v.ev(PATH, 'ip-path'))
    v.page.keyboard.press('Escape'); time.sleep(0.3)
    check((v.ev(IPNAME) or '').startswith('lamp-01 (2 parts'), 'Inspect: Escape goes up to lamp-01', v.ev(IPNAME))
    dbl(vm, st['x'], st['y'])
    check(v.ev(IPNAME) == 'ground-plane', 'Inspect: the hidden stand can’t be reached: the click goes through it to the ground', v.ev(IPNAME))
    check(v.errors == [] and o.errors == [], 'no page errors', v.errors[:2] + o.errors[:2])
    br.close()
done()
