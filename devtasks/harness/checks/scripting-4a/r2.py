# scripting-4a round 2 (REVISION-scripting-4a.md §3 "Before DEV acceptance"): the four new browser checks,
# plus a two-owner-tab look at the clip select.
from anim import *
W = fresh('r2')
JUMP = """(name) => { const c = atriumClient, r = c._connectionRecord, k = r.clock;
  c._sendPing(r); const key = k.pingCounter;                       // a ping whose real pong is still in flight
  const truth = () => performance.timeOrigin + performance.now();
  c._onPong({ type: 'pong', clientTime: key, serverTime: truth() + 60000 }, r);   // its answer, 60 s off: a discontinuity
  const m = __anim().modelAnimations; m.update(); const a = m.actionFor(name);
  return { clockErrMs: +(c.serverNow() - truth()).toFixed(1), ready: c.serverClockReady, recovering: k.recovering, samples: k.samples.length,
           sentKeys: [...k.sent.keys()], t: a ? +a.time.toFixed(3) : null } }"""
with sync_playwright() as pw:
    br = new_browser(pw)
    a = SPage(br); a.connect(W); a.edit_on()
    fox = add_model(a, FOX, scale=0.01); cm = add_model(a, CESIUM)
    rest = pose(a, fox)
    # ---- R-a: a once clip ends while selected
    v = play(a, fox, 'Survey', False)
    print('Ra while playing', row(a))
    a.page.wait_for_timeout(4200)
    print('Ra after the end, no reselect', row(a))
    a.page.click('#ep-anim-play')
    a.wait("([n, s]) => atriumClient.som.getNodeByName(n).extras.atrium.animation.startedAt !== s && __anim().animationControls.waiting === 0", arg=[fox, v['startedAt']], timeout=10000)
    a.page.wait_for_timeout(300)
    print('Ra Play again', row(a), err(a, fox))
    stop(a, fox)
    # ---- R-c: a saved missing clip on CesiumMan
    select(a, cm)
    a.ev("(n) => atriumClient.setModelAnimation(n, { clip: 'Gallop', playing: true, loop: true, speed: 1, startedAt: 0 })", cm); a.page.wait_for_timeout(800)
    print('Rc missing clip', row(a))
    a.page.click('#ep-anim-stop'); a.page.wait_for_timeout(800)
    print('Rc after Stop', row(a), 'stored', a.ev("(n)=>atriumClient.som.getNodeByName(n).extras.atrium.animation ?? null", cm))
    a.ev("(n) => atriumClient.setModelAnimation(n, { clip: 'Gallop', playing: true, loop: true, speed: 1, startedAt: 0 })", cm); a.page.wait_for_timeout(800)
    a.page.click('#ep-anim-play'); a.page.wait_for_timeout(800)
    print('Rc after Play', row(a), 'stored', a.ev("(n)=>atriumClient.som.getNodeByName(n).extras.atrium.animation", cm), err(a, cm))
    # ---- R-d: a forced discontinuity in a playing session
    play(a, fox, 'Run', True); a.page.wait_for_timeout(1500)
    print('Rd before', err(a, fox))
    print('Rd at the discontinuity, before any recovery pong', a.ev(JUMP, fox))
    a.page.wait_for_timeout(1500)
    print('Rd after recovery', err(a, fox), a.ev(SAMPLES))
    stop(a, cm)   # R-b needs CesiumMan stopped, so Play is the button to press
    # ---- R-b: selected while loading (a held fetch), CesiumMan's single clip, no reselect
    held = []
    b = SPage(br, origin=B); b.ctx.route('**/khronos/CesiumMan.glb', lambda route: held.append(route))
    b.connect(W); b.edit_on(); select(b, cm)
    print('Rb loading', row(b))
    b.wait('() => true'); held[0].continue_(); wait_loaded(b, cm); b.page.wait_for_timeout(800)
    print('Rb after the load, no reselect', row(b))
    b.page.click('#ep-anim-play'); b.page.wait_for_timeout(1000)
    print('Rb Play', row(b), 'stored', b.ev("(n)=>atriumClient.som.getNodeByName(n).extras.atrium.animation", cm), err(b, cm))
    # ---- two owner tabs: A picks Walk and plays; B plays Run; what does A's select show?
    stop(a, fox); play(a, fox, 'Walk', True)
    select(b, fox); b.page.select_option('#ep-anim-clip', 'Run')   # B switches the clip while it plays (a new playing value)
    a.wait("(n) => atriumClient.som.getNodeByName(n).extras.atrium.animation.clip === 'Run'", arg=fox, timeout=10000); a.page.wait_for_timeout(500)
    select(a, fox)
    print('two owners: stored', a.ev("(n)=>atriumClient.som.getNodeByName(n).extras.atrium.animation.clip", fox), 'A row', row(a))
    select(a, cm); select(a, fox)
    print('two owners: A row after reselect', row(a))
    print('errors', a.errors, b.errors, [x for x in a.console + b.console if x.startswith('error') and '401' not in x][:5])
    br.close()
