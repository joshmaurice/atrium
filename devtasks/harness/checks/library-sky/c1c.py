import sys, time
import os; sys.path.insert(0, os.environ.get('HARNESS_ROOT', '/tmp/atrium-harness') + '/harness')
from h import *
with sync_playwright() as pw:
    br = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    p = Page(br); p.connect('wss://127.0.0.1:8443/w/c1c'); p.edit_on()
    p.page.click('#ep-model'); time.sleep(0.3)
    p.page.click('#edit-toggle-btn'); time.sleep(0.3); p.edit_on(); time.sleep(0.3)
    print('Model form after Edit off/on', p.ev("getComputedStyle(document.getElementById('model-form')).display"))
    p.close(); br.close()
