# scripting-4b-2 §5.1 — runtime checks, part 3: 8 restart from the saved document, 8b Duplicate remap, 9 first person.
import sys
exec(open(__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)), 'rt2.py')).read().split('\nwith sync_playwright() as pw:')[0])
SEL = "(n) => { try { __ep().selectForEdit(atriumClient.som.getNodeByName(n)); return null } catch (e) { return String(e).slice(0, 80) } }"
BEH = """(n) => { const nd = atriumClient.som.getNodeByName(n); const b = nd?.extras?.atrium?.behavior;
  return { own: nd?.extras?.atrium?.objectId, nodeMap: b?.nodeMap, targets: b?.targets, anim: b?.animations, paramTarget: b?.template?.params?.target } }"""

with sync_playwright() as pw:
    br = new_browser(pw)
    K8 = 'sv' + T; W8 = f'wss://127.0.0.1:8443/w/{K8}'
    a = Page(br); a.connect(W8); a.edit_on()
    fox = add_model(a, FOX, scale=0.01); a.page.wait_for_timeout(2000); a.ev(MOVE, {'name': fox, 't': [3, 0, -6]})
    x = add_cube(a); a.ev(MOVE, {'name': x, 't': [-1.5, 0.5, -5]})
    y = add_cube(a); a.ev(MOVE, {'name': y, 't': [1.5, 0.5, -5]})
    print('C8 write X->Y', behave(a, x, 'select-visibility', {'target': y, 'action': 'toggle'}))
    print('C8b write self-targeted on Fox', behave(a, fox, 'select-visibility', {'target': fox, 'action': 'toggle'}))
    print('C8b original', fox, a.ev(BEH, fox))

    # 8b Duplicate the self-targeted Fox (Edit on, selected).
    print('C8b select throws', a.ev(SEL, fox)); a.page.wait_for_timeout(300)
    names0 = set(a.ev("atriumClient.som.nodes.map(n => n.name)"))
    n0 = len(a.errors); a.page.click('#ep-duplicate'); a.page.wait_for_timeout(2500)
    new = [n for n in a.ev("atriumClient.som.nodes.map(n => n.name)") if n not in names0]
    for c in new:
        print('C8b copy', c, a.ev(BEH, c))
    print('C8b errors during Duplicate', a.errors[n0:])
    # Duplicate X (targets Y, not itself): the copy should keep targeting Y.
    print('C8b select X', a.ev(SEL, x)); names0 = set(a.ev("atriumClient.som.nodes.map(n => n.name)"))
    a.page.click('#ep-duplicate'); a.page.wait_for_timeout(2500)
    new = [n for n in a.ev("atriumClient.som.nodes.map(n => n.name)") if n not in names0]
    yid = a.ev(OID, y)
    for c in new:
        b = a.ev(BEH, c); print('C8b copy of X', c, '| own', b['own'], '| still targets Y', b['paramTarget'] == yid, b['targets'])

    edit_off(a); click_node(a, x); print('C8 Y before restart', a.ev(VIS, y))
    doc = json.loads(http(f'/__restart?key={K8}'))
    behs = [(n.get('name'), bool(n.get('extras', {}).get('atrium', {}).get('behavior'))) for n in doc.get('nodes', [])]
    print('C8 saved document behaviours', [n for n, b in behs if b])
    a.page.wait_for_timeout(1500); a.connect(W8); a.page.wait_for_timeout(1500)
    print('C8 after restart: Y', a.ev(VIS, y), '| host', a.ev('atriumClient.scriptHost'), '| runner', a.ev(RUN))
    edit_off(a); click_node(a, x); print('C8 click X after restart: Y', a.ev(VIS, y))

    def capsule():
        return a.ev("() => { const n = atriumClient._avatarNodeName ?? atriumClient.avatarNodeName; const o = n && stage.scene.getObjectByName(n); return o ? { name: n, obj: o.visible, som: atriumClient.som.getNodeByName(n)?.visible } : { name: n ?? null } }")
    print('C9 third person', capsule()); a.page.keyboard.press('KeyV'); a.page.wait_for_timeout(400)
    print('C9 after V', capsule()); a.page.keyboard.press('KeyV'); a.page.wait_for_timeout(400); print('C9 after V again', capsule())
    print('errors', a.errors[:6])
    br.close()
