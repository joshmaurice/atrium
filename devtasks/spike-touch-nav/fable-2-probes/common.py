"""Reviewer's probes for touch-nav: shared setup (reuses the repo's tn_lib helpers)."""
import os, sys, time, json, math
REPO = os.environ.get('ATRIUM_REPO', '/home/claude/joshmaurice/atrium')
sys.path.insert(0, REPO + '/devtasks/harness/checks/touch-nav')
from tn_lib import *   # noqa: F401,F403  (Page, phone, connect, Touch, synth, NAV, UI, centre, stick_centre, home, A, sync_playwright)

ARGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']

def say(label, value):
    print(f'{label}: {value}', flush=True)

def fresh(prefix='atrrv'):
    return '%s%d' % (prefix, int(time.time() * 10) % 1000000)

def first_touch(p, t):
    cx, cy = centre(p)
    t.down(0, cx, cy + 150); t.up(0); time.sleep(0.4)

def edit_with_cube(p):
    """Edit on, a cube added and turned to the left of the Edit panel. Returns (cube name, PROJ js)."""
    p.ev("stage.nav._avatar.localNode.translation = [0, 0.7, 0]; stage.nav.yaw = 0; stage.nav.pitch = 0"); time.sleep(0.5)
    p.ev("document.getElementById('edit-toggle-btn').click()"); time.sleep(0.6)
    p.ev("document.querySelector('#ep-palette button[data-kind=\"cube\"]').click()"); time.sleep(1.5)
    cube = p.ev("__ep().selected?.name")
    PROJ = f"""(() => {{ const o = stage.scene.getObjectByName({json.dumps(cube)}); const v = new (o.position.constructor)();
        o.getWorldPosition(v); v.project(stage.camera); const r = document.querySelector('#viewport canvas').getBoundingClientRect();
        return [r.x + (v.x + 1) / 2 * r.width, r.y + (1 - v.y) / 2 * r.height] }})()"""
    for _ in range(40):
        scr = p.ev(PROJ)
        if scr[0] < 90: break
        p.ev("stage.nav.yaw -= 0.03"); time.sleep(0.1)
    time.sleep(0.4)
    return cube, PROJ

SEL = "__ep().selected?.name ?? null"
def som_pos(p, name):
    return p.ev(f"atriumClient.som.getNodeByName({json.dumps(name)}).translation.slice()")
def obj_pos(p, name):
    return p.ev(f"stage.scene.getObjectByName({json.dumps(name)}).position.toArray()")
def dragging(p):
    return p.ev("!!__ep().gizmo?.dragging")
