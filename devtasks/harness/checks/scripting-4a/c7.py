# §5.1 checks 7 and 8: a refused Play, late answers after selecting another model; the status texts.
from anim import *
W = fresh('ref')
with sync_playwright() as pw:
    br = new_browser(pw)
    a = SPage(br, init=[ANIM_HOLD]); a.connect(W); a.edit_on()
    fox = add_model(a, FOX, scale=0.01); cm = add_model(a, CESIUM)
    rest = pose(a, fox)
    # ---- check 7a: a stubbed rejection, the fox still selected
    a.ev("window.__animHold = { mode: 'reject', ms: 300 }")
    select(a, fox); a.page.select_option('#ep-anim-clip', 'Run'); a.page.click('#ep-anim-play')
    print('C7 while waiting', row(a))
    a.page.wait_for_timeout(800)
    print('C7 after rejection', row(a), 'stored', a.ev("(n)=>atriumClient.som.getNodeByName(n).extras.atrium.animation ?? null", fox),
          'pose vs rest', pose_diff(pose(a, fox), rest), 'action', a.ev("(n)=>!!__anim().modelAnimations.actionFor(n)", fox))
    # ---- check 7b: a late REJECTION after selecting another model
    a.ev("window.__animHold = { mode: 'reject', ms: 1500 }")
    select(a, fox); a.page.click('#ep-anim-play'); a.page.wait_for_timeout(200)
    print('C7b fox waiting', row(a))
    select(a, cm); a.page.wait_for_timeout(200)
    print('C7b cesium selected while the fox waits', row(a))
    a.page.wait_for_timeout(1800)
    print('C7b cesium after the late rejection', row(a), 'waiting', a.ev('__anim().animationControls.waiting'))
    # ---- check 7c: a late ACCEPT after selecting another model
    a.ev("window.__animHold = { mode: 'delay', ms: 1500 }")
    select(a, fox); a.page.click('#ep-anim-play'); a.page.wait_for_timeout(200)
    select(a, cm); a.page.wait_for_timeout(200)
    before = row(a)
    a.page.wait_for_timeout(2200)
    print('C7c cesium before/after the late accept', before, row(a))
    print('C7c the accept applied to its own node', a.ev("(n)=>atriumClient.som.getNodeByName(n).extras.atrium.animation", fox), 'cesium', a.ev("(n)=>atriumClient.som.getNodeByName(n).extras.atrium.animation ?? null", cm))
    select(a, fox); print('C7c fox row', row(a))
    a.ev("window.__animHold = null")
    stop(a, fox)
    # ---- check 8: no clips, a missing clip, loading
    cube = add_model(a, '/assets/library/models/Tiny_Cube-a29f050367f9.glb'); select(a, cube)
    print('C8 static model', row(a))
    # a saved clip the model doesn't have: written as another session would (raw send), markup in the name
    a.ev("(n) => atriumClient.setModelAnimation(n, { clip: '<b>Gallop</b>', playing: true, loop: true, speed: 1, startedAt: 0 })", fox)
    a.page.wait_for_timeout(800); select(a, cube); select(a, fox)
    print('C8 missing clip', row(a), 'status html', a.ev("document.getElementById('ep-anim-status').innerHTML"), 'pose vs rest', pose_diff(pose(a, fox), rest))
    # loading: a second session that sees the fox before its model loads (slow model fetch)
    b = SPage(br, origin=B)
    held = []
    b.ctx.route('**/khronos/Fox.glb', lambda route: held.append(route))   # hold the fetch: no answer until released
    b.connect(W); b.edit_on(); select(b, fox)
    print('C8 loading (B, fetch held)', held and 'held', row(b))
    held[0].continue_(); wait_loaded(b, fox); b.page.wait_for_timeout(3000)
    print('C8 B 3 s after the load completed, no other event', row(b), 'layer', b.ev('(n)=>__anim().modelAnimations.status(n)', fox)); select(b, cube); select(b, fox); print('C8 B after reselect', row(b))
    print('errors', a.errors, b.errors, [x for x in a.console if x.startswith('error') and '401' not in x][:5])
    br.close()
