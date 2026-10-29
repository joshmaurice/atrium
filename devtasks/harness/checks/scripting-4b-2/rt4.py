# scripting-4b-2 §5.1 check 9 — first person: what the own tab draws, and what a second tab sees.
exec(open(__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)), 'rt2.py')).read().split('\nwith sync_playwright() as pw:')[0])
W9 = 'wss://127.0.0.1:8443/w/fp' + T
MINE = "() => atriumClient._avatarNodeName ?? atriumClient.avatarNodeName ?? null"
DRAW = """(n) => { const s = atriumClient.som.getNodeByName(n); const objs = [];
  stage.scene.traverse((o) => { if (o.name === n) objs.push({ type: o.type, visible: o.visible, meshes: (() => { let k = 0; o.traverse((c) => { if (c.isMesh && c.visible) k++ }); return k })() }) });
  return { som: s ? s.visible : null, objs } }"""

with sync_playwright() as pw:
    br = new_browser(pw)
    a = Page(br); a.connect(W9); b = Page(br); b.connect(W9); a.page.wait_for_timeout(1500)
    me = a.ev(MINE); print('C9 A avatar', me)
    print('C9 third person: A draws', a.ev(DRAW, me), '| B sees', b.ev(DRAW, me))
    a.page.mouse.click(400, 300); a.page.keyboard.press('KeyV'); a.page.wait_for_timeout(1500)
    print('C9 A first person: A draws', a.ev(DRAW, me), '| B sees', b.ev(DRAW, me))
    a.page.keyboard.press('KeyV'); a.page.wait_for_timeout(1500)
    print('C9 A back to third: A draws', a.ev(DRAW, me), '| B sees', b.ev(DRAW, me))
    print('errors', a.errors[:4], b.errors[:4])
    br.close()
