# grouping c5 (GR8's enable rules and the Empty groups list, r6 and r9 as
# harness checks): Group and Move to are disabled for space-anim's animated
# crate-01 and enabled for a plain object; Empty groups never lists an avatar
# (two tabs are in the world) or a source container (space-ext's Crate and
# Light), and a bare group given a behaviour through the form stays listed.
# Another tab's list follows a bare node's add and a group's last part being
# deleted (harness finding: it waited for this tab's own next refresh).
import json, ssl, urllib.request
from gp import *

EMPTY = "() => [getComputedStyle(document.getElementById('ep-empty-row')).display, [...document.getElementById('ep-empty-groups').options].map(o => o.textContent)]"
BTNS = "() => ['ep-group','ep-ungroup','ep-move-to'].map(id => { const e = document.getElementById(id); return [e.disabled, e.title] })"
ROOT = '/home/claude/atrium'
CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE

def post(path, body):
    req = urllib.request.Request(A + path, data=body.encode(), method='POST')
    return urllib.request.urlopen(req, context=CTX).read().decode()

with sync_playwright() as pw:
    br = launch(pw)
    # r6: the animated crate
    k = 'an' + key()
    post(f'/__put?key={k}&kind=file', open(f'{ROOT}/tests/fixtures/space-anim.gltf').read())
    p = Page(br); p.connect(f'wss://127.0.0.1:8443/w/{k}'); p.edit_on(); time.sleep(1)
    select_by_click(p, 'crate-01', 'crate-01')
    g, u, mv = p.ev(BTNS)
    check(g == [True, 'an animation moves it in local values'], 'r6: Group is disabled for the animated crate-01, with the reason', g)
    check(mv[0] is True, 'r6: Move to is disabled for it', mv)
    plain = None
    for name in ('lamp-stand', 'ground-plane'):
        p.ev("() => __ep().selectForEdit(null)"); time.sleep(0.5)
        sc = p.ev(SCREEN, name); click(p.page.mouse, sc['x'], sc['y']); time.sleep(0.5)
        g, u, mv = p.ev(BTNS)
        print(f'  {name} → {p.ev(SEL)}: group {g}, move {mv}')
        if not g[0]: plain = p.ev(SEL); break
    check(plain is not None, 'r6: Group is enabled for a plain object in the same world', plain)
    p.close() if hasattr(p, 'close') else None

    # r9: avatars and source containers are never listed
    k = 'ext' + key()
    a = Page(br); a.connect(f'wss://127.0.0.1:8443/w/{k}'); a.edit_on(); time.sleep(1)
    b = Page(br); b.connect(f'wss://127.0.0.1:8443/w/{k}'); b.edit_on(); time.sleep(1.5)
    avatars = a.ev("() => atriumClient.som.nodes.filter(n => /^avatar-[^-]*$/.test(n.name)).map(n => n.name)")
    check(len(avatars) == 2, 'r9: two avatars are in the world', avatars)
    e = a.ev(EMPTY)
    print('  Empty groups:', e)
    check(a.ev("() => atriumClient.som.nodes.some(n => /-camera$/.test(n.name))"), 'r9: an avatar camera node exists (bare)')
    check(not any('avatar-' in x for x in e[1]), 'r9: no avatar or avatar camera is listed', e)
    check(not any(x.split(' › ')[0] in ('Crate', 'Light') for x in e[1]), 'r9: no source container (Crate, Light) or anything in one is listed', e)
    # a bare group, given a behaviour through the form, stays listed
    a.ev("() => atriumClient.addNode({ name: 'group-09', translation: [1, 0.5, 1.5] })"); time.sleep(1)
    e = a.ev(EMPTY)
    check('group-09' in e[1], 'r9: a new bare node is listed', e)
    check('group-09' in b.ev(EMPTY)[1], 'the other tab lists it too, at once', b.ev(EMPTY))
    a.page.select_option('#ep-empty-groups', label='group-09'); time.sleep(0.6)
    check(a.ev(SEL) == 'group-09', 'r9: picking it selects it', a.ev(SEL))
    opts = a.ev("() => [...document.getElementById('ep-behavior-template').options].map(o => [o.value, o.textContent])")
    print('  behaviour templates:', opts)
    a.page.select_option('#ep-behavior-template', value=opts[1][0]); time.sleep(0.4)
    a.page.click('#ep-behavior-save'); time.sleep(1.2)
    print('  behaviour status:', repr(a.ev("() => document.getElementById('ep-behavior-status').textContent")), repr(a.ev(ERROR)))
    srv = json.loads(http(f'/__doc?key={k}'))
    n9 = next((n for n in srv['nodes'] if n['name'] == 'group-09'), {})
    check(n9.get('extras', {}).get('atrium', {}).get('behavior') is not None, 'r9: the server holds group-09’s behaviour', n9.get('extras'))
    e = a.ev(EMPTY)
    check('group-09' in e[1], 'r9: with a behaviour it is still listed in Empty groups', e)
    # another tab's list follows a delete of a group's last part, and its Undo
    k = 'c5' + key()
    a = Page(br); a.connect(f'wss://127.0.0.1:8443/w/{k}'); a.edit_on(); time.sleep(1)
    b2 = Page(br); b2.connect(f'wss://127.0.0.1:8443/w/{k}'); b2.edit_on(); time.sleep(1)
    select_by_click(a, 'crate-01', 'crate-01'); press(a, 'ep-group'); time.sleep(0.7)
    sc = a.ev(SCREEN, 'crate-01'); dbl(a.page.mouse, sc['x'], sc['y'])
    check(a.ev(SEL) == 'crate-01', 'crate-01 selected inside group-01', a.ev(SEL))
    a.page.click('#ep-delete'); time.sleep(1.2); settle(a)
    check(b2.ev(EMPTY)[1] == ['Empty groups (1)', 'group-01'], 'the other tab lists group-01 once its last part is deleted', b2.ev(EMPTY))
    a.page.select_option('#ep-empty-groups', label='group-01'); time.sleep(0.5)
    a.page.click('#ep-delete'); time.sleep(1.2); settle(a)
    check(b2.ev(EMPTY)[0] == 'none', 'the other tab’s row hides when group-01 is deleted', b2.ev(EMPTY))
    undo(a); time.sleep(0.6)
    check(b2.ev(EMPTY)[1] == ['Empty groups (1)', 'group-01'], 'and lists it again when the delete is undone', b2.ev(EMPTY))
    check(a.errors == [] and b.errors == [] and b2.errors == [], 'no page errors', a.errors + b.errors + b2.errors)
    br.close()
done()
