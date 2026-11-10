# grouping smoke: the page at this commit loads, connects, shows the Group row
# in Edit mode, and the controls answer for a selected cube (real page, real
# server). Run first, before the c-checks.
from sp import *

with sync_playwright() as pw:
    br = launch(pw)
    k = 'gs' + key()
    p = Page(br); p.connect(f'wss://127.0.0.1:8443/w/{k}'); p.edit_on(); time.sleep(1)
    st = p.ev("""() => ({ addFields: atriumClient.serverAddFields,
      row: getComputedStyle(document.getElementById('ep-group-actions')).display,
      move: getComputedStyle(document.getElementById('ep-move-row')).display,
      empty: getComputedStyle(document.getElementById('ep-empty-row')).display })""")
    print('state:', st)
    check(st['addFields'] == 4, 'the server says level 4', st)
    check(st['row'] != 'none' and st['move'] != 'none', 'the Group row and Move to show in Edit mode', st)
    cr = p.ev(SCREEN, 'crate-01'); click(p.page.mouse, cr['x'], cr['y']); time.sleep(0.4)
    check(p.ev(SEL) == 'crate-01', 'crate-01 selected', p.ev(SEL))
    btns = p.ev("""() => ['ep-group','ep-ungroup','ep-move-to'].map(id => { const e = document.getElementById(id); return [id, e.disabled, e.title] })""")
    print('controls:', btns)
    check(btns[0][1] is False, 'Group is enabled for crate-01', btns[0])
    check(btns[1][1] is True, 'Ungroup is disabled for crate-01 (no parts)', btns[1])
    check(btns[2][1] is False, 'Move to is enabled', btns[2])
    check(p.errors == [], 'no page errors', p.errors)
    br.close()
done()
