# r9 — outside review of PREBRIEF-grouping.md Rev 1.2 (95d7a096): the Empty
# groups dropdown (GR-L8/GR-L11 (c), GR8). On the released page (the harness at
# 95d7a096, whose code is 172b816d's). The dropdown doesn't exist yet, so GR8's
# own test for its list (isEmptyGroup: no parts, and no mesh, model, light,
# camera, behaviour or teleporter) is evaluated in the page as written.
#  A. what that test lists in the harness's worlds today;
#  B. a bare node selected as the dropdown would select it (g4), then given a
#     behaviour through the panel's own Behaviour form: is it still listed?
#   HARNESS_ROOT=/tmp/atrium-harness python3 r9_empty_groups.py /path/to/atrium
import sys, os, time
REPO = sys.argv[1]
sys.path.insert(0, os.path.join(REPO, 'devtasks/harness/checks/grouping'))
from sp import *

# GR8's isEmptyGroup, as written in Rev 1.2 (L681–684), over the page's SOM
EMPTY = """() => { const som = atriumClient.som;
  const isEmpty = (n) => { const a = n.extras?.atrium ?? {}; const g = n._node;
    return n.children.length === 0 && !g.getMesh() && !g.getCamera() && !g.getExtension('KHR_lights_punctual')
      && a.model == null && a.behavior == null && a.teleporter == null };
  const under = (n, test) => { for (let a = n.parent; a; a = a.parent) if (test(a)) return a.name; return null };
  return som.nodes.filter(isEmpty).map((n) => ({ name: n.name,
    insideExternal: under(n, (a) => a.extras?.atrium?.source != null),
    ownSource: n.extras?.atrium?.source != null,
    avatar: n.extras?.atrium?.ephemeral === true || /^avatar/i.test(n.name) })) }"""
FORM = """() => { const $ = (id) => document.getElementById(id); const sel = $('ep-behavior-template');
  const shown = (e) => !!e && getComputedStyle(e).display !== 'none';
  return { row: shown($('ep-behavior-row')), options: sel ? [...sel.options].map(o => o.value) : [], save: shown($('ep-behavior-actions')) && !$('ep-behavior-save').disabled,
           status: $('ep-behavior-status').textContent, note: $('ep-behavior-note').textContent } }"""
LEAF = "(n) => { const b = atriumClient.som.getNodeByName(n)?.extras?.atrium?.behavior; return b ? { template: b.template?.id ?? null, enabled: b.enabled } : null }"
SRVLEAF = "async ([k, n]) => { const r = await fetch('/__doc?key=' + k); const g = await r.json(); const x = g.nodes.find(o => o.name === n); return x ? (x.extras?.atrium?.behavior ? 'has a behaviour' : 'no behaviour') : 'absent' }"

with sync_playwright() as pw:
    br = launch(pw)
    print('A. What GR8\'s isEmptyGroup lists today')
    for prefix, what in (('atr', 'atrium.gltf'), ('grp', 'group.gltf'), ('ext', 'space-ext.gltf (external content)')):
        k = prefix + 'r9' + key()
        p = Page(br); p.connect(f'wss://127.0.0.1:8443/w/{k}'); time.sleep(2.5)
        print(f'  {what}:', p.ev(EMPTY))
        p.close() if hasattr(p, 'close') else None

    print('B. A bare node, selected as the dropdown would, then given a behaviour')
    k = 'r9' + key()
    p = Page(br); p.connect(f'wss://127.0.0.1:8443/w/{k}'); p.edit_on(); time.sleep(1)
    p.ev("() => atriumClient.addNode({ name: 'group-09', translation: [1, 0.5, 1.5] })"); time.sleep(1)
    p.ev("() => __ep().selectForEdit(atriumClient.som.getNodeByName('group-09'))"); time.sleep(0.6)
    listed = [e['name'] for e in p.ev(EMPTY)]
    check('group-09' in listed, 'before: group-09 is in the list', listed)
    f = p.ev(FORM); print('  the Behaviour form for it:', f)
    check(f['row'], 'the panel offers the Behaviour row for the bare node')
    landed = None
    for tpl in [o for o in f['options'] if o and o not in ('', 'none', 'custom')]:
        p.page.select_option('#ep-behavior-template', tpl); time.sleep(0.3)
        g = p.ev(FORM)
        if not g['save']:
            print(f'  template {tpl}: Save not offered ({g["status"] or g["note"]})'); continue
        p.page.click('#ep-behavior-save'); time.sleep(2)
        landed = p.ev(LEAF, 'group-09')
        print(f'  template {tpl}: Save pressed → the node\'s behaviour: {landed}')
        if landed: break
    check(landed is not None, 'a behaviour was saved on the bare node through the form', landed)
    print('  the server\'s copy:', p.ev(SRVLEAF, [k, 'group-09']))
    listed = [e['name'] for e in p.ev(EMPTY)]
    check('group-09' in listed, 'after: group-09 is still in the Empty groups list (so it can be selected again)', listed)
    # deselect, then try the only other way in: a click where it is
    sc = p.ev(SCREEN, 'group-09')
    p.page.keyboard.press('Escape'); time.sleep(0.3)
    if p.ev(SEL) is not None:
        p.ev("() => __ep().selectForEdit(null)"); time.sleep(0.3)
    click(p.page.mouse, sc['x'], sc['y']); time.sleep(0.5)
    check(p.ev(SEL) == 'group-09', 'a click where it is selects it', p.ev(SEL))
    print('  page errors:', p.errors[:2])
    br.close()
done()
