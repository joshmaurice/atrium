# Operator hypothesis: the "visitor doesn't see the proximity animation until a reload" bug happens with a legacy
# (id-less) model. Build a world whose models have no objectId, add the proximity behaviour (which gives the Fox
# its id during the session), then walk a visitor and a second owner in, sampling each tab's real playback time.
import json
exec(open(__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)), 'f1.py')).read().split('\nwith sync_playwright() as pw:')[0])
MOVE_ME = """(t) => { const me = atriumClient._avatarNodeName; atriumClient.som.getNodeByName(me).translation = t; return me }"""


def snap(label, tabs, fox):
    t1 = {k: p.ev(ERR, fox) for k, p in tabs.items()}
    tabs['host'].page.wait_for_timeout(700)
    t2 = {k: p.ev(ERR, fox) for k, p in tabs.items()}
    print(label, {k: {'state': t2[k].get('state'), 't': (t1[k].get('t'), t2[k].get('t')), 'errMs': t2[k].get('errMs')} for k in tabs})


with sync_playwright() as pw:
    br = new_browser(pw)
    K = 'np' + T; W = f'wss://127.0.0.1:8443/w/{K}'
    a = Page(br); a.connect(W); a.edit_on()
    fox = add_model(a, FOX, scale=0.01); a.ev(MOVE, {'name': fox, 't': [0, 0, -20]})
    a.close()
    doc = json.loads(http(f'/__doc?key={K}'))
    for n in doc.get('nodes', []):
        at = n.get('extras', {}).get('atrium', {})
        if at.get('model'):
            at.pop('objectId', None)
    K2 = K + 'b'; W2 = f'wss://127.0.0.1:8443/w/{K2}'
    urllib.request.urlopen(urllib.request.Request(A + f'/__put?key={K2}', data=json.dumps(doc).encode(), method='POST', headers={'content-type': 'model/gltf+json'}), context=_ctx).read()

    # Visitor and second owner join BEFORE the Fox gets its id.
    h = Page(br); h.connect(W2); h.edit_on(); h.page.wait_for_timeout(2500)
    v = Page(br); v.connect(W2 + '?visitor'); b = Page(br); b.connect(W2)
    for p in (v, b):
        p.page.wait_for_timeout(2500)
    print('L Fox id at start', h.ev(OID, fox))
    # The behaviour on the Fox itself (DEV step 3), saved through the form: Save gives the Fox its id.
    h.ev(SEL, fox); h.page.wait_for_timeout(300); choose(h, 'proximity-animation')
    print('L form', [(q['f'], q.get('label') or q['value']) for q in h.ev(FORM)['params']])
    try:
        setp(h, 'clip', label='Walk')
    except Exception:
        setp(h, 'clip', fill='Walk'); print('L clip was a text box (id-less model) - typed Walk')
    print('L save ->', save(h, fox), '| status', repr(h.ev(FORM)['status']), '| Fox id now', h.ev(OID, fox))
    print('L each tab sees the Fox id', {k: p.ev(OID, fox) for k, p in {'host': h, 'visitor': v, 'owner2': b}.items()})
    edit_off(h)
    tabs = {'host': h, 'visitor': v, 'owner2': b}
    snap('L before', tabs, fox)
    v.ev(MOVE_ME, [0, 0, -19]); v.page.wait_for_timeout(2500); snap('L visitor inside', tabs, fox)
    v.ev(MOVE_ME, [0, 0, 10]); v.page.wait_for_timeout(2500); snap('L visitor outside', tabs, fox)
    b.ev(MOVE_ME, [0, 0, -19]); b.page.wait_for_timeout(2500); snap('L owner2 inside', tabs, fox)
    print('errors', h.errors[:3], v.errors[:3], b.errors[:3])
    br.close()
