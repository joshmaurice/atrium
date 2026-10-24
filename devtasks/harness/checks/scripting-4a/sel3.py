# scripting-4a round 3 (REVISION-scripting-4a-r3.md §3 "Before DEV acceptance"):
# W1/W2 — after a page reload, Duplicate and Undo of rigged models (stopped and playing) and of a static
# library model keep a true outline and stay clickable; W3 — every clip control lies inside the panel.
from anim import *
exec(open(os.path.join(os.path.dirname(__file__), 'sel.py')).read().split('with sync_playwright()')[0].split('from anim import *', 1)[1])
W = fresh('r3')
FIT = """() => { const p = document.getElementById('edit-panel').getBoundingClientRect(); const r = {};
  for (const id of ['ep-anim-clip', 'ep-anim-loop-label', 'ep-anim-play', 'ep-anim-stop']) { const b = document.getElementById(id).getBoundingClientRect();
    r[id] = b.width > 0 && b.left >= p.left - 0.5 && b.right <= p.right + 0.5 && b.top >= p.top - 0.5 && b.bottom <= p.bottom + 0.5 }
  r.panel = [Math.round(p.left), Math.round(p.right), Math.round(p.width)]; r.win = innerWidth; r.title = document.getElementById('ep-anim-clip').title.length; return r }"""
def boxdiff(a, b):
    return None if not a or not b else round(max(abs(x - y) for u, v in zip(a, b) for x, y in zip(u, v)), 3)
def added_after(p, before):
    return [n for n in p.ev("atriumClient.som.allNodes.map(n => n.name)") if n not in before]
def dup(p, name):
    before = set(p.ev("atriumClient.som.allNodes.map(n => n.name)")); select(p, name); p.page.click('#ep-duplicate')
    p.wait("(b) => atriumClient.som.allNodes.some(n => !b.includes(n.name))", arg=list(before), timeout=15000)
    p.page.wait_for_timeout(1200); return added_after(p, before)[0]
def del_undo(p, name):
    select(p, name); p.page.click('#ep-delete'); p.wait("(n) => !atriumClient.som.getNodeByName(n)", arg=name, timeout=10000); p.page.wait_for_timeout(500)
    p.page.click('#ep-undo'); p.wait("(n) => !!atriumClient.som.getNodeByName(n)", arg=name, timeout=10000); p.page.wait_for_timeout(1200)
def report(p, label, name):
    sel_now = p.ev('__ep().selected?.name ?? null'); ol = p.ev(OUTLINE); tb = p.ev(PICK, name)['trueBox']
    clicks = [click_pick(p, name)['selected'] for _ in range(3)]
    print(f'{label}: auto-selected {sel_now!r}, outline vs true box {boxdiff(ol, tb)} m, clicks {clicks}')
with sync_playwright() as pw:
    br = new_browser(pw)
    a = SPage(br, viewport=(1280, 800)); a.connect(W); a.edit_on()
    fox = add_model(a, FOX, scale=0.01); cm = add_model(a, CESIUM); long_ = add_model(a, A + '/khronos/FoxLong.glb', scale=0.01)
    cube = add_model(a, '/assets/library/models/Tiny_Cube-a29f050367f9.glb')
    for n in (fox, cm, long_):
        select(a, n); print('W3 fit', n, a.ev(FIT))
    a.page.locator('#edit-panel').screenshot(path=SHOTS + '/s4a-r3-panel-long.png')
    select(a, cm); a.page.locator('#edit-panel').screenshot(path=SHOTS + '/s4a-r3-panel-cesium.png')
    play(a, cm, 'animation_0', True)
    # the operator's case: a page reload, then Duplicate and Undo
    a.page.reload(); a.page.wait_for_function('window.atriumClient && window.stage && window.__lib', timeout=30000)
    a.page.add_script_tag(type='module', content="import { Box3 } from 'three'; window.__B3 = Box3"); a.ev("() => { window.__Box3 = () => window.__B3 }")
    a.connect(W); a.edit_on()
    for n in (fox, cm, cube): a.wait("(n) => __mb.status(n)?.status === 'loaded'", arg=n, timeout=60000)
    a.page.wait_for_timeout(1000); print('RELOADED')
    report(a, 'W1 Duplicate CesiumMan (playing)', dup(a, cm))
    stop(a, cm); report(a, 'W1 Duplicate CesiumMan (stopped)', dup(a, cm))
    del_undo(a, fox); report(a, 'W1 Undo-restored fox (stopped)', fox)
    play(a, fox, 'Walk', True); del_undo(a, fox); report(a, 'W1 Undo-restored fox (walking)', fox)
    report(a, 'W1 Duplicate static cube', dup(a, cube))
    del_undo(a, cube); report(a, 'W1 Undo-restored static cube', cube)
    report(a, 'original CesiumMan', cm)
    print('errors', a.errors, [x for x in a.console if x.startswith('error') and '401' not in x][:5])
    br.close()
