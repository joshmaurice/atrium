# Ungroup's ask-first (GR-L5 (a)) pauses the page in window.confirm. Messages
# from the server queue meanwhile; the re-check after the dialog
# (`ungroupHint(node)`) runs before they land, and the part values computed
# from the pre-dialog world are sent. Tab B moves the group while A's dialog
# is open: A's Ungroup puts the parts back where they were before B's move.
import sys
sys.path.insert(0, '/home/claude/atrium/devtasks/harness/checks/grouping')
from gp import *
import ssl, urllib.request
_ctx = ssl.create_default_context(); _ctx.check_hostname = False; _ctx.verify_mode = ssl.CERT_NONE

def post(path, body):
    req = urllib.request.Request(A + path, data=body.encode(), method='POST')
    return urllib.request.urlopen(req, context=_ctx).read().decode()

with sync_playwright() as pw:
    br = launch(pw)
    k = 'bg' + key()
    post(f'/__put?key={k}&kind=file', open('/tmp/grouping-code-check/big.gltf').read())
    a = Page(br); a.connect(f'wss://127.0.0.1:8443/w/{k}'); a.edit_on(); time.sleep(1)
    b = Page(br); b.connect(f'wss://127.0.0.1:8443/w/{k}'); time.sleep(1.5)
    dialogs = []
    a.page.on('dialog', lambda d: dialogs.append(d))
    a.ev("() => __ep().selectForEdit(atriumClient.som.getNodeByName('big'))"); time.sleep(0.4)
    print('Ungroup:', a.ev("() => [document.getElementById('ep-ungroup').disabled, document.getElementById('ep-ungroup').title]"))
    w0 = a.ev(WORLDPOS, 'big-0'); print('big-0 world before:', w0)
    a.ev("() => { setTimeout(() => document.getElementById('ep-ungroup').click(), 0) }")
    t = time.time()
    while not dialogs and time.time() - t < 5: a.page.wait_for_timeout(50)
    print('dialog:', dialogs[0].message if dialogs else None)
    # tab B moves the group 4 m along z while A's question is open
    b.ev("() => atriumClient.sendField('big', 'translation', [-3, 0, 4])"); time.sleep(1.0)
    print('server big translation after B:', [n.get('translation') for n in json.loads(http(f'/__doc?key={k}'))['nodes'] if n['name'] == 'big'])
    dialogs[0].accept(); time.sleep(0.5); settle(a, 15); time.sleep(1)
    g = json.loads(http(f'/__doc?key={k}'))
    srv = {n['name']: n for n in g['nodes']}
    print('server: big present:', 'big' in srv, '; big-0 translation:', srv.get('big-0', {}).get('translation'))
    print('A draws big-0 at', a.ev(WORLDPOS, 'big-0'), '; B draws big-0 at', b.ev(WORLDPOS, 'big-0'))
    want = [w0[0], w0[1], w0[2] + 4]
    check(near(b.ev(WORLDPOS, 'big-0'), want), 'big-0 stays where B moved the group (world z + 4)', b.ev(WORLDPOS, 'big-0'))
    print('A undo:', a.ev(UNDO_LABELS), 'error:', a.ev(ERROR))
    br.close()
done()
