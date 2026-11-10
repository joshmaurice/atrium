# grouping c6 (the code check's finding 1, with the operator's go of
# 2026-11-10): the Model form's Save waits for an edit in flight. Real clicks:
# the form is opened and checked; Ungroup on lamp-01, and at once the Save
# button: it is disabled, with its reason, so the Ungroup completes and is
# recorded whole; then Save is enabled again and adds the model.
from gp import *

URL = 'https://127.0.0.1:8443/assets/library/models/Big_Block-bd67c6162e6e.glb'
SAVE = "() => { const b = document.getElementById('model-save-btn'); return [b.disabled, b.title] }"

with sync_playwright() as pw:
    br = launch(pw)
    k = 'c6' + key()
    a = Page(br); a.connect(f'wss://127.0.0.1:8443/w/{k}'); a.edit_on(); time.sleep(1)
    select_by_click(a, 'lamp-stand', 'lamp-01')
    a.page.click('#ep-model'); time.sleep(0.3)
    a.page.fill('#model-url-input', URL)
    a.page.click('#model-check-btn')
    a.page.wait_for_function("() => !document.getElementById('model-save-btn').disabled", timeout=30000)
    check(a.ev(SAVE) == [False, ''], 'the checked form offers Save', a.ev(SAVE))
    # Ungroup, then Save in the same task (as fast as any person could)
    out = a.ev("""() => { document.getElementById('ep-ungroup').click()
      const b = document.getElementById('model-save-btn'); const st = [b.disabled, b.title]; b.click()
      return { st, inFlight: __lib().undo.inFlight() } }""")
    print('  right after Ungroup:', out)
    check(out['st'] == [True, 'Wait for the edit in progress to finish'], 'Save is disabled at once, with its reason', out['st'])
    settle(a); time.sleep(0.6)
    check(not a.ev(BUSY), 'the Undo engine is idle')
    check(a.ev(UNDO_LABELS) == ['Ungroup “lamp-01”'], 'the Ungroup is recorded whole; no model was added', a.ev(UNDO_LABELS))
    srv = server_tree(k)
    check('lamp-01' not in srv and srv.get('lamp-shade') is None, 'the server applied the Ungroup', srv)
    check(not any(n.startswith('Big_Block') for n in srv), 'the server has no model', [n for n in srv if n.startswith('Big')])
    check(a.ev(SAVE) == [False, ''], 'Save is offered again once the edit has landed', a.ev(SAVE))
    a.page.click('#model-save-btn'); time.sleep(1.5); settle(a)
    srv = server_tree(k)
    check(any(n.startswith('Big_Block') for n in srv), 'Save adds the model', [n for n in srv if n.startswith('Big')])
    check(a.ev(UNDO_LABELS)[-1].startswith('Add “Big_Block'), 'the Add is the next Undo entry', a.ev(UNDO_LABELS))
    check(a.errors == [], 'no page errors', a.errors)
    br.close()
done()
