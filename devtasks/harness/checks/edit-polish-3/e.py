import sys, time, json
import os; sys.path.insert(0, os.environ.get('HARNESS_ROOT', '/tmp/atrium-harness') + '/harness')
from h import *
with sync_playwright() as pw:
    br = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    p = Page(br); p.connect('wss://127.0.0.1:8443/w/ep10'); p.edit_on()
    W = lambda ms: p.page.wait_for_timeout(ms)
    p.page.click('#ep-palette button[data-kind="cube"]'); W(1200)
    print('C10 selected', p.ev("__ep().selected?.name"))
    p.page.mouse.click(640, 700); W(200)   # focus the page, not a field
    p.ev("__ep().selectForEdit(atriumClient.som.getNodeByName('Cube'))"); W(200)
    pos0 = p.ev("atriumClient.som.getNodeByName(avatarNodeName ?? '')?.translation ?? null") if p.ev("typeof avatarNodeName !== 'undefined'") else None
    cam0 = p.ev("stage.camera.position.toArray()")
    p.page.keyboard.press('Control+d'); W(1500)
    print('C10 Ctrl+D: nodes', p.ev("atriumClient.som.nodes.map(n=>n.name).filter(n=>/Cube/.test(n))"), 'selected', p.ev("__ep().selected?.name"), 'camera moved', p.ev("stage.camera.position.toArray()") != cam0)
    name_inp = p.page.locator('#ep-name')
    if name_inp.count():
        name_inp.click(); name_inp.press('End'); name_inp.press('Delete'); name_inp.press('Backspace'); W(500)
        print('C10 Delete/Backspace in the name field: field', repr(name_inp.input_value()), 'node still there', p.ev("!!atriumClient.som.getNodeByName(__ep().selected?.name ?? '')"), 'selected', p.ev("__ep().selected?.name"))
        name_inp.press('Escape')
    p.page.click('#ep-teleporter'); W(400); dest = p.page.locator('#tp-dest-input'); dest.fill('/worlds/a/b'); dest.press('Backspace'); dest.press('Delete'); W(400)
    print('C10 keys in the destination field', repr(dest.input_value()), 'selected still', p.ev("__ep().selected?.name"), 'tp open', p.ev("__ep().teleporterForm.isOpen()"))
    print('errors', p.errors)
    p.close(); br.close()
