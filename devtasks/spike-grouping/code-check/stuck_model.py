# Finding: a composite's later structural phase (Ungroup's remove) can't begin
# while another structural request is pending, and the engine stays in flight
# forever. The Model form's Save is not gated on the Undo engine.
import sys, os
sys.path.insert(0, '/home/claude/atrium/devtasks/harness/checks/grouping')
from gp import *

URL = 'https://127.0.0.1:8443/assets/library/models/Big_Block-bd67c6162e6e.glb'
with sync_playwright() as pw:
    br = launch(pw)
    k = 'cc' + key()
    a = Page(br); a.connect(f'wss://127.0.0.1:8443/w/{k}'); a.edit_on(); time.sleep(1)
    a.ev("() => __ep().selectForEdit(atriumClient.som.getNodeByName('lamp-01'))"); time.sleep(0.4)
    print('selected', a.ev(SEL), 'ungroup enabled:', a.ev("() => !document.getElementById('ep-ungroup').disabled"))
    r = a.ev("""async (url) => { const f = __ep().modelForm; f.open(); f.onUrlInput(url); const ok = await f.check(); return { ok, canSave: f.canSave() } }""", URL)
    print('model form checked:', r)
    out = a.ev("""() => { document.getElementById('ep-ungroup').click(); const s = __ep().modelForm.save(); return { saveSeq: s, inFlight: __lib().undo.inFlight() } }""")
    print('after Ungroup click + Save in the same task:', out)
    time.sleep(4)
    st = a.ev("""() => ({ inFlight: __lib().undo.inFlight(), undo: __lib().undo.undoLabels,
      undoTitle: document.getElementById('ep-undo').title, groupTitle: document.getElementById('ep-group').title,
      lamp: !!atriumClient.som.getNodeByName('lamp-01'), err: document.getElementById('ep-error').textContent })""")
    print('4 s later:', st)
    srv = server_tree(k)
    print('server has lamp-01:', 'lamp-01' in srv, ' lamp-shade parent:', srv.get('lamp-shade', 'absent'))
    check(st['inFlight'] is False, 'the Undo engine is idle 4 s later', st)
    time.sleep(6)
    print('10 s later inFlight:', a.ev(BUSY), 'undo title:', a.ev("() => document.getElementById('ep-undo').title"))
    br.close()
done()
