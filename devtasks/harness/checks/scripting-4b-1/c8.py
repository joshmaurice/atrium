# scripting-4b-1 §5.1 check 8 (PREBRIEF-scripting-4b.md): load healing. A world document
# with one id on two nodes loads with the id on neither, and logs once; a malformed id is
# dropped too; a unique id and other extras keys stay. Run for a saved-document world and a
# file world (POST /__put, harness server). Reads the server's log at $HARNESS_ROOT/server.log.
import sys, os, json, time, uuid, urllib.request
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripting-4a'))
from anim import *
import h

ROOT = os.environ.get('HARNESS_ROOT', '/tmp/atrium-harness')
src = json.load(open(ROOT + '/wt/tests/fixtures/space.gltf'))
DUP, KEEP = str(uuid.uuid4()), str(uuid.uuid4())
by = {n['name']: n for n in src['nodes']}
by['crate-01']['extras'] = {'atrium': {'objectId': DUP}, 'note': 'kept'}
by['lamp-01']['extras'] = {'atrium': {'objectId': DUP}}
by['lamp-stand']['extras'] = {'atrium': {'objectId': DUP.upper()}}   # malformed: uppercase
by['ground-plane']['extras'] = {'atrium': {'objectId': KEEP}}
# file worlds resolve buffers against the file's folder, so inline nothing: space.gltf is self-contained
doc = json.dumps(src)


def put(key, kind):
    req = urllib.request.Request(A + f'/__put?key={key}&kind={kind}', data=doc.encode(), method='POST')
    return json.loads(urllib.request.urlopen(req, context=h._ctx).read().decode())


def ids(d):
    return {n.get('name'): n.get('extras') for n in d['nodes'] if n.get('name') in by}


with sync_playwright() as pw:
    br = new_browser(pw)
    for kind in ('doc', 'file'):
        key = f'heal{kind}{int(time.time())}'
        mark = os.path.getsize(ROOT + '/server.log')
        d = put(key, kind)
        time.sleep(0.3)
        log = open(ROOT + '/server.log').read()[mark:]
        print(f'C8 [{kind}] server extras after load', ids(d))
        print(f'C8 [{kind}] log lines', [l for l in log.splitlines() if 'objectId' in l])
        p = Page(br); p.connect('wss://127.0.0.1:8443/w/' + key)
        print(f'C8 [{kind}] client extras', p.ev("(ns) => Object.fromEntries(ns.map(n => [n, atriumClient.som.getNodeByName(n)?.extras ?? null]))", list(by)))
        p.ev("() => { window.__r = []; atriumClient.on('edit:accepted', (e) => __r.push('accepted')); atriumClient.on('edit:rejected', (e) => __r.push(e.message)) }")
        p.ev("(i) => atriumClient.setObjectId('lamp-stand', i)", str(uuid.uuid4())); p.page.wait_for_timeout(800)
        p.ev("(i) => atriumClient.setObjectId('crate-01', i)", DUP); p.page.wait_for_timeout(800)
        print(f'C8 [{kind}] set-once on the healed nodes (lamp-stand fresh id, crate-01 the freed duplicate id):', p.ev('__r'))
        p.close()
    br.close()
