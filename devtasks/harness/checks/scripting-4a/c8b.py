# The model row right after placing a model (the new node is selected while it loads), with no other event.
from anim import *
W = fresh('place')
with sync_playwright() as pw:
    br = new_browser(pw)
    a = SPage(br); a.connect(W); a.edit_on()
    cm = add_model(a, CESIUM)
    print('selected after Save', a.ev('__anim().selected?.name'), 'layer state', a.ev("(n)=>__anim().modelAnimations.status(n)", cm))
    a.page.wait_for_timeout(2000)
    print('row 2 s after load, no other event', row(a))
    a.ev("(n) => __ep().selectForEdit(null)"); select(a, cm)
    print('row after reselect', row(a))
    br.close()
