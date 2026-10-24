import sys, json
import os; sys.path.insert(0, os.environ.get('HARNESS_ROOT', '/tmp/atrium-harness') + '/harness')
from h import *
with sync_playwright() as pw:
    br = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctl(worldsDelay=2000)
    p = Page(br); p.connect('wss://127.0.0.1:8443/w/epf2'); p.edit_on()
    p.page.click('#ep-teleporter'); p.page.wait_for_timeout(200)
    p.page.select_option('#tp-world-select', '/')
    S = "() => ({ value: document.getElementById('tp-world-select').value, save: !document.getElementById('tp-save-btn').disabled, opts: [...document.querySelectorAll('#tp-world-select option')].length })"
    print('F2 picked The commons while loading', p.ev(S))
    p.page.wait_for_timeout(2600)
    print('F2 after the list arrived', p.ev(S))
    p.page.click('#tp-save-btn'); p.page.wait_for_timeout(400)
    print('F2 Save:', p.ev("document.getElementById('tp-form-error').textContent"))
    ctl(worldsDelay=0); p.close(); br.close()
# ---- V2 in the browser: a reconnect while the URL box has focus
with sync_playwright() as pw:
    br = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    p = Page(br); p.connect('wss://127.0.0.1:8443/w/epv2'); p.edit_on()
    p.page.click('#ep-model'); p.page.fill('#model-url-input', 'https://example.com/half-typed.glb')
    print('V2 focused before', p.ev("document.activeElement.id"), repr(p.ev("document.getElementById('model-url-input').value")))
    p.ev("atriumClient.disconnect()"); p.page.wait_for_timeout(800)
    print('V2 after disconnect: focus', p.ev("document.activeElement.id"), 'box', repr(p.ev("document.getElementById('model-url-input').value")), 'state', repr(p.ev("__ep().modelForm.state.url")))
    p.close(); br.close()
