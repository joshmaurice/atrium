import sys, time, json
import os; sys.path.insert(0, os.environ.get('HARNESS_ROOT', '/tmp/atrium-harness') + '/harness')
from h import *
with sync_playwright() as pw:
    br = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctl(catalog='committed')
    p = Page(br); p.connect('wss://127.0.0.1:8443/w/c1b'); p.edit_on(); time.sleep(1)
    print('committed: models', p.ev("__lib().libraryCatalog.models.length"), 'skies', p.ev("__lib().libraryCatalog.skies.length"), 'sky options', p.ev("document.querySelectorAll('#ep-sky option').length"))
    print('warnings', [c for c in p.console if 'catalog' in c])
    p.page.click('#ep-library'); time.sleep(0.5)
    print('grid open', p.ev("__lib().libraryGrid.isOpen()"), 'visible', p.ev("getComputedStyle(document.getElementById('library-grid')).display"), 'tiles in DOM', p.ev("document.querySelectorAll('.lg-tile').length"))
    p.page.keyboard.press('Escape'); time.sleep(0.2)
    print('after Escape open', p.ev("__lib().libraryGrid.isOpen()"))
    print('errors', p.errors, 'failed', [f for f in p.failed if '401' not in f][:5])
    p.close(); br.close()
    ctl(catalog='small')
