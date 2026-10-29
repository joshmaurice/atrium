# Operator report: in an older world (models with no objectId), choosing "On enter: play" with target Fox shows
# a text box for the clip; Save is refused "animations is malformed" and the picker jumps to another model.
# Build that world: place two models, read the server's document, strip their objectIds, load it back.
import json
exec(open(__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)), 'f1.py')).read().split('\nwith sync_playwright() as pw:')[0])
ROWS = """() => [...document.querySelectorAll('#ep-behavior-params [data-field]')].map(e => ({ f: e.dataset.field, tag: e.tagName.toLowerCase(),
  shown: e.tagName === 'SELECT' ? e.options[e.selectedIndex]?.textContent : e.value, opts: e.tagName === 'SELECT' ? [...e.options].map(o => o.textContent) : undefined }))"""
STATE = "() => { const s = __beh().behaviorForm.state; return { targetId: s.targetId, clip: s.params.clip, error: s.error } }"
with sync_playwright() as pw:
    br = new_browser(pw)
    K = 'noid' + T; W = f'wss://127.0.0.1:8443/w/{K}'
    a = Page(br); a.connect(W); a.edit_on()
    car = add_model(a, CESIUM); a.ev(MOVE, {'name': car, 't': [-3, 0, -6]})
    fox = add_model(a, FOX, scale=0.01); a.ev(MOVE, {'name': fox, 't': [3, 0, -6]})
    a.close()
    doc = json.loads(http(f'/__doc?key={K}'))
    stripped = 0
    for n in doc.get('nodes', []):
        at = n.get('extras', {}).get('atrium', {})
        if at.get('model') and 'objectId' in at:
            del at['objectId']; stripped += 1
    K2 = K + 'b'
    req = urllib.request.Request(A + f'/__put?key={K2}', data=json.dumps(doc).encode(), method='POST', headers={'content-type': 'model/gltf+json'})
    urllib.request.urlopen(req, context=_ctx).read()
    print('N stripped ids from', stripped, 'model nodes')
    b = Page(br); b.connect(f'wss://127.0.0.1:8443/w/{K2}'); b.edit_on(); b.page.wait_for_timeout(3000)
    print('N ids now', {n: b.ev(OID, n) for n in (car, fox)})
    cube = add_cube(b); b.ev(MOVE, {'name': cube, 't': [0, 0.5, -5]})
    b.ev(SEL, cube); b.page.wait_for_timeout(300); choose(b, 'proximity-animation')
    print('N after choosing:', b.ev(ROWS), b.ev(STATE))
    setp(b, 'target', label=fox)
    print('N after picking Fox:', b.ev(ROWS), b.ev(STATE))
    b.page.click('#ep-behavior-save'); b.page.wait_for_timeout(2500)
    print('N after Save:', b.ev(ROWS), b.ev(STATE), '| status', repr(b.ev(FORM)['status']), '| Fox id now', b.ev(OID, fox), '| leaf', b.ev(LEAFV, cube))
    print('errors', b.errors[:4])
    br.close()
