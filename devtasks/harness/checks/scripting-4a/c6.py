# §5.1 check 6: saved. The world server is restarted from its saved document; the loop is still running, at the right phase.
from anim import *
W = fresh('save'); KEY = W.rsplit('/', 1)[1]
with sync_playwright() as pw:
    br = new_browser(pw)
    a = SPage(br); a.connect(W); a.edit_on()
    fox = add_model(a, FOX, scale=0.01); cm = add_model(a, CESIUM)
    v = play(a, fox, 'Run', True); play(a, cm, 'animation_0', False)   # CesiumMan once: it will have ended
    b = SPage(br, origin=B); b.connect(W + '?visitor'); wait_loaded(b, fox)
    a.page.wait_for_timeout(3000)
    doc = json.loads(http('/__restart?key=' + KEY))
    saved = [n.get('extras', {}).get('atrium', {}) for n in doc.get('nodes', []) if n.get('extras', {}).get('atrium', {}).get('model')]
    print('C6 saved document, model nodes:', json.dumps(saved))
    for p in (a, b):
        p.wait('!atriumClient.connected', timeout=10000)
    a.page.wait_for_timeout(1500)
    a.page.click('#connectBtn'); a.wait('atriumClient.connected && atriumClient.som', timeout=20000)
    b.page.click('#connectBtn'); b.wait('atriumClient.connected && atriumClient.som', timeout=20000)
    for p in (a, b):
        wait_loaded(p, fox); wait_loaded(p, cm)
        p.wait('(n) => __anim().modelAnimations.actionFor(n)', arg=fox, timeout=30000)
    a.page.wait_for_timeout(1000)
    print('C6 after restart, stored', a.ev("(n) => atriumClient.som.getNodeByName(n).extras.atrium.animation", fox), 'same startedAt', a.ev("(n) => atriumClient.som.getNodeByName(n).extras.atrium.animation.startedAt", fox) == v['startedAt'])
    print('C6 fox phase A', err(a, fox), 'B', err(b, fox))
    print('C6 cesium (once, ended) A', err(a, cm), 'B', err(b, cm), 'A vs B pose', pose_diff(pose(a, cm), pose(b, cm)))
    print('errors', a.errors, b.errors, [x for x in a.console + b.console if x.startswith('error') and '401' not in x][:5])
    br.close()
