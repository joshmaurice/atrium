# grouping harness helpers (on top of sp.py): the panel's controls by the real
# mouse, the server's copy, and world positions as each tab draws them.
from sp import *
import json

WORLDPOS = "(name) => { const o = stage.scene.getObjectByName(name); if (!o) return null; o.updateWorldMatrix(true, false); const v = o.position.clone(); o.getWorldPosition(v); return v.toArray().map(x => Math.round(x * 1e4) / 1e4) }"
DRAWN_PARENT = "(name) => { const o = stage.scene.getObjectByName(name); return o ? (o.parent?.name || o.parent?.type || null) : null }"
SOM_PARENT = "(name) => { const n = atriumClient.som.getNodeByName(name); return n ? (n.parent ? n.parent.name : null) : 'absent' }"
UNDO_LABELS = "() => __lib().undo.undoLabels"
REDO_LABELS = "() => __lib().undo.redoLabels"
ERROR = "() => document.getElementById('ep-error').textContent"
BUSY = "() => __lib().undo.inFlight()"


def server_tree(k):
    """{name: parent name or None} for every node in the server's copy of world k."""
    g = json.loads(http(f'/__doc?key={k}'))
    parent = {}
    for i, n in enumerate(g['nodes']):
        for c in n.get('children', []):
            parent[g['nodes'][c]['name']] = n['name']
    return {n['name']: parent.get(n['name']) for n in g['nodes']}


def near(a, b, eps=1e-3):
    return a is not None and b is not None and all(abs(x - y) <= eps for x, y in zip(a, b))


def settle(p, timeout=8):
    """Wait until the Undo engine and the structure tracker are idle."""
    end = time.time() + timeout
    while time.time() < end:
        if not p.ev(BUSY):
            time.sleep(0.3)
            return True
        time.sleep(0.1)
    return False


def select_by_click(p, name, expect=None):
    """A real click on the drawn object; `expect` is the node the panel should select."""
    sc = p.ev(SCREEN, name)
    before = p.ev(SEL)
    click(p.page.mouse, sc['x'], sc['y'])
    time.sleep(0.5)
    if expect is not None:
        check(p.ev(SEL) == expect, f'a click on {name} selects {expect}', (before, p.ev(SEL)))


def press(p, btn_id):
    """A real click on a panel button."""
    p.page.click('#' + btn_id)
    time.sleep(0.2)
    settle(p)


def move_to(p, label):
    """Open the Move to select (focus builds it), then choose the option with this label."""
    p.page.focus('#ep-move-to')
    time.sleep(0.2)
    labels = p.ev("() => [...document.getElementById('ep-move-to').options].map(o => o.textContent)")
    check(label in labels, f'Move to lists "{label}"', labels)
    if label not in labels:
        return False
    p.page.select_option('#ep-move-to', label=label)
    time.sleep(0.2)
    settle(p)
    return True


def undo(p, d='undo'):
    p.page.click('#ep-' + d)
    time.sleep(0.2)
    settle(p)
