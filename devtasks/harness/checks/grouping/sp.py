# selection-parts harness helpers (PREBRIEF-selection-parts.md §5): real mouse
# events through Playwright, with click_count given on every press (Playwright's
# mouse.down() sends detail 1 otherwise), and the assertions every check makes:
# the selection, the transforms, the Undo stack.
import sys, os, time
sys.path.insert(0, os.environ.get('HARNESS_ROOT', '/tmp/atrium-harness') + '/harness')
from h import *

ARGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
SCREEN = """(name) => { const o = stage.scene.getObjectByName(name); if (!o) return null; const v = o.position.clone();
  o.updateWorldMatrix(true, false); o.getWorldPosition(v); v.project(stage.camera);
  const r = document.querySelector('#viewport canvas').getBoundingClientRect();
  return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height } }"""
SEL = "() => __ep().selected ? __ep().selected.name : null"
TR = "(name) => { const n = atriumClient.som.getNodeByName(name); return n ? [...n.translation].map(v => Math.round(v * 1e4) / 1e4) : null }"
DRAWN = "(name) => { const o = stage.scene.getObjectByName(name); return o ? o.position.toArray().map(v => Math.round(v * 1e4) / 1e4) : null }"
GZ = "() => { const g = __ep().gizmo; return g ? { dragging: g.dragging, axis: g.axis, attached: g.object ? g.object.name : null } : null }"
UNDO = "() => __lib().undo.undoLabels"
PATH = "(id) => [...document.querySelectorAll('#' + id + ' > *')].map(e => e.textContent).join(' ').replace(/ › /g, ' › ')"
IPNAME = "() => document.getElementById('ip-fields').style.display === 'none' ? null : document.getElementById('ip-name').textContent"

FAILS = []
def check(cond, what, got=None):
    print(('PASS ' if cond else 'FAIL ') + what + ('' if got is None else f'  [{got}]'))
    if not cond: FAILS.append(what)

def done():
    print(f'{len(FAILS)} failed' if FAILS else 'all passed')
    sys.exit(1 if FAILS else 0)

def launch(pw):
    return pw.chromium.launch(args=ARGS)

def key():
    return str(int(time.time() * 1000) % 1000000)

def click(m, x, y, count=1, travel=0):
    """One press-and-release, the count-th of a series; `travel` px moved while held."""
    m.move(x, y)
    m.down(click_count=count)
    if travel: m.move(x + travel, y, steps=2)
    m.up(click_count=count)

def dbl(m, x, y, travel=0):
    click(m, x, y, 1); time.sleep(0.08)
    click(m, x, y, 2, travel=travel); time.sleep(0.4)

def triple(m, x, y):
    click(m, x, y, 1); time.sleep(0.06)
    click(m, x, y, 2); time.sleep(0.06)
    click(m, x, y, 3); time.sleep(0.4)

def hover_axis(p, x, y):
    m = p.page.mouse
    m.move(x + 2, y + 2); time.sleep(0.05); m.move(x, y); time.sleep(0.12)
    g = p.ev(GZ)
    return g['axis'] if g else None

# What the scene ray hits at a screen point (the node object's name), ignoring
# the handles and the outline: the raycast the page itself would make.
PICK = """([x, y, anchor]) => { const r = document.querySelector('#viewport canvas').getBoundingClientRect();
  const rc = new (__ep().gizmo.getRaycaster().constructor)();
  rc.setFromCamera({ x: (x - r.left) / r.width * 2 - 1, y: -((y - r.top) / r.height) * 2 + 1 }, stage.camera);
  const g = stage.scene.children.find(c => c.getObjectByName && c.getObjectByName(anchor));
  const hit = g ? rc.intersectObjects(g.children, true)[0] : null;
  let o = hit?.object; while (o && !(o.type === 'Object3D' && o.name)) o = o.parent; return o ? o.name : null }"""

# The handles' hover test, run in the page: a synthetic pointermove on the
# canvas makes TransformControls set `axis` synchronously (its pointerHover).
SCAN = """([cx, cy, span, step, anchor]) => { const c = document.querySelector('#viewport canvas'); const g = __ep().gizmo;
  const r = c.getBoundingClientRect(); const rc = new (g.getRaycaster().constructor)();
  const group = stage.scene.children.find(o => o.getObjectByName && o.getObjectByName(anchor)); const out = [];
  for (let dy = -span; dy <= span; dy += step) for (let dx = -span; dx <= span; dx += step) {
    const x = cx + dx, y = cy + dy;
    c.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, pointerType: 'mouse', bubbles: true }));
    if (!g.axis) continue;
    rc.setFromCamera({ x: (x - r.left) / r.width * 2 - 1, y: -((y - r.top) / r.height) * 2 + 1 }, stage.camera);
    const hit = group ? rc.intersectObjects(group.children, true)[0] : null;
    let o = hit?.object; while (o && !(o.type === 'Object3D' && o.name)) o = o.parent;
    out.push([x, y, g.axis, o ? o.name : null]) }
  return out }"""

def handle_points(p, around, span=160, step=4, anchor='lamp-01'):
    """Every grid point near `around` over a handle of the current selection: [(x, y, axis, behind)]."""
    return [tuple(t) for t in p.ev(SCAN, [around['x'], around['y'], span, step, anchor])]

def point_over(p, around, axis=None, behind=..., anchor='lamp-01', span=160):
    """A point over a handle (`axis`, any when None) whose scene hit is `behind`
    (a node name, or None for empty space; any when left out), confirmed with
    the real mouse."""
    for (x, y, a, b) in handle_points(p, around, span=span, anchor=anchor):
        if axis is not None and a != axis: continue
        if behind is not ... and b != behind: continue
        if hover_axis(p, x, y) != a: continue
        return {'x': x, 'y': y, 'axis': a}
    return None
