# r6 — outside review of PREBRIEF-grouping.md Rev 1.0 (34917de8): Group, as
# GR-L6 (a) plans it, on a node that a world animation's TRANSLATION channel
# targets (tests/fixtures/space-anim.gltf: clip "CrateBob" → crate-01, keys
# around its own place [1, 0.25, 0]). On the released page (the harness at
# 34917de8, whose code is 172b816d's). The Group is applied in the page the way
# GR6 would apply the two broadcasts (the group's add, then the parent set),
# inside applyLocally; then the clip is played, as any owner or behaviour can.
#   HARNESS_ROOT=/tmp/atrium-harness python3 r6_group_animated_node.py /path/to/atrium
import sys, os, json, time, urllib.request
REPO = sys.argv[1]
sys.path.insert(0, os.path.join(REPO, 'devtasks/harness/checks/grouping'))
from sp import *
import h

def put(key, path):
    req = urllib.request.Request(h.A + f'/__put?key={key}&kind=file', data=open(path, 'rb').read(), method='POST')
    return urllib.request.urlopen(req, context=h._ctx).read()

WORLDPOS = "(name) => { const o = stage.scene.getObjectByName(name); o.updateWorldMatrix(true, false); const v = o.position.clone(); o.getWorldPosition(v); return v.toArray().map(x => Math.round(x * 1e3) / 1e3) }"
GROUP = """(name) => { const som = atriumClient.som; const c = som.getNodeByName(name);
  const t = [...c.translation];
  atriumClient.applyLocally(() => {
    const g = som.ingestNode({ name: 'group-01', translation: t }); (c.parent ?? som.scene).addChild(g)   // the group's add
    c.translation = [0, 0, 0]; g.addChild(c) })                                                           // the parent set: translation 0, rotation and scale kept
  return { group: t, parent: c.parent.name, local: [...c.translation] } }"""
PLAY = "(clip) => { atriumClient.som.getAnimationByName(clip).play({ loop: true }); return atriumClient.som.getAnimationByName(clip).playing }"
STOP = "(clip) => { atriumClient.som.getAnimationByName(clip).stop() }"

def sample(p, n=12, gap=0.15):
    out = []
    for _ in range(n):
        out.append(p.ev(WORLDPOS, 'crate-01')); time.sleep(gap)
    return out
def span(s):
    return [[min(v[i] for v in s), max(v[i] for v in s)] for i in range(3)]

with sync_playwright() as pw:
    br = launch(pw)
    k = 'r6' + key()
    put(k, os.path.join(REPO, 'tests/fixtures/space-anim.gltf'))
    p = Page(br); p.connect(f'wss://127.0.0.1:8443/w/{k}'); time.sleep(1.5)
    print('crate-01 drawn at rest:', p.ev(WORLDPOS, 'crate-01'))
    print('CrateBob playing:', p.ev(PLAY, 'CrateBob')); time.sleep(0.4)
    before = span(sample(p))
    print('BEFORE Group, CrateBob playing: world x / y / z ranges:', before)
    p.ev(STOP, 'CrateBob'); time.sleep(0.5)
    print('stopped; drawn:', p.ev(WORLDPOS, 'crate-01'))
    print('Group applied (GR-L6 (a)):', p.ev(GROUP, 'crate-01')); time.sleep(0.5)
    rest = p.ev(WORLDPOS, 'crate-01')
    print('AFTER Group, at rest: drawn world:', rest)
    p.ev(PLAY, 'CrateBob'); time.sleep(0.4)
    after = span(sample(p))
    print('AFTER Group, CrateBob playing: world x / y / z ranges:', after)
    check(abs(before[0][0] - 1) < 0.01 and abs(before[0][1] - 1) < 0.01, 'before Group the clip keeps the crate at x = 1', before[0])
    check(abs(after[0][0] - 1) < 0.01 and abs(after[0][1] - 1) < 0.01, 'after Group the playing clip still keeps the crate at x = 1 (“nothing jumps”)', after[0])
    check(after[1][1] <= before[1][1] + 0.01, 'after Group the clip’s height range is the one it had', (before[1], after[1]))
    print('page errors:', p.errors[:3])
    br.close()
done()
