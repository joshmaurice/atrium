# §5.1 check 9: Duplicate plays in step; Undo of a delete brings it back playing; and (operator
# correction 1) a model that was played then stopped (animation: null) can be duplicated and restored.
from anim import *
W = fresh('dup')
NAMES = "atriumClient.som.allNodes.filter(n => n.extras?.atrium?.model).map(n => n.name)"
def phase(p, a, b):
    """Clip-time difference between two nodes in one page, at one instant."""
    return p.ev("([x, y]) => { const m = __anim().modelAnimations; m.update(); const ax = m.actionFor(x), ay = m.actionFor(y); return ax && ay ? +((ax.time - ay.time) * 1000).toFixed(1) : null }", [a, b])
with sync_playwright() as pw:
    br = new_browser(pw)
    a = SPage(br); a.connect(W); a.edit_on()
    fox = add_model(a, FOX, scale=0.01); cm = add_model(a, CESIUM)
    b = SPage(br, origin=B); b.connect(W + '?visitor'); wait_loaded(b, fox)
    play(a, fox, 'Run', True)
    # Duplicate while playing
    before = set(a.ev(NAMES)); select(a, fox); a.page.click('#ep-duplicate')
    a.wait(f"(b) => ({NAMES}).some(n => !b.includes(n))", arg=list(before), timeout=15000)
    copy = [n for n in a.ev(NAMES) if n not in before][0]
    wait_loaded(a, copy); wait_loaded(b, copy); a.page.wait_for_timeout(500)
    print('C9 copy', copy, a.ev("(n)=>atriumClient.som.getNodeByName(n).extras.atrium.animation", copy))
    print('C9 copy vs original, clip-time diff ms: A', phase(a, fox, copy), 'B', phase(b, fox, copy), '| copy A', err(a, copy), 'B', err(b, copy))
    # Delete the copy, then Undo
    select(a, copy); a.page.click('#ep-delete')
    a.wait("(n) => !atriumClient.som.getNodeByName(n)", arg=copy, timeout=10000); a.page.wait_for_timeout(500)
    a.page.click('#ep-undo')
    a.wait("(n) => !!atriumClient.som.getNodeByName(n)", arg=copy, timeout=10000)
    wait_loaded(a, copy); wait_loaded(b, copy); a.page.wait_for_timeout(500)
    print('C9 after Undo of delete', a.ev("(n)=>atriumClient.som.getNodeByName(n).extras.atrium.animation", copy), 'diff A', phase(a, fox, copy), 'B', phase(b, fox, copy), 'state', err(b, copy)['state'])
    # The stopped case: CesiumMan played, then stopped (stored null)
    play(a, cm, 'animation_0', True); stop(a, cm)
    print('C9 stopped value', a.ev("(n)=>atriumClient.som.getNodeByName(n).extras.atrium", cm))
    before = set(a.ev(NAMES)); select(a, cm); a.ev("() => document.getElementById('ep-error').textContent = ''"); a.page.click('#ep-duplicate'); a.page.wait_for_timeout(1500)
    after = [n for n in a.ev(NAMES) if n not in before]
    print('C9 duplicate of a stopped model:', after, 'error line', repr(a.ev("document.getElementById('ep-error').textContent")))
    victim = after[0] if after else cm
    select(a, victim); a.page.click('#ep-delete')
    a.wait("(n) => !atriumClient.som.getNodeByName(n)", arg=victim, timeout=10000); a.page.wait_for_timeout(500)
    a.page.click('#ep-undo'); a.page.wait_for_timeout(1500)
    print('C9 Undo of delete of a stopped model: back?', a.ev("(n) => !!atriumClient.som.getNodeByName(n)", victim),
          a.ev("(n)=>atriumClient.som.getNodeByName(n)?.extras?.atrium ?? null", victim), 'error line', repr(a.ev("document.getElementById('ep-error').textContent")))
    print('errors', a.errors, b.errors, [x for x in a.console + b.console if x.startswith('error') and '401' not in x][:5])
    br.close()
