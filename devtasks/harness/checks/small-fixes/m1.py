# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
#
# small-fixes, the outside review's M-1: after Edit off -> Edit on, the same
# object's Behaviour fields (Target, Action) must show again. At 163c127 they
# stayed hidden (the parameter cache skipped the show); at b639d81 they showed.
# On checks/signin-sync/authserver.mjs with HOOKS=1.
#   HARNESS_ROOT=/tmp/atrium-harness python3 devtasks/harness/checks/small-fixes/m1.py
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripting-4d'))
from common4d import *
PARAMS = """() => { const e = document.getElementById('ep-behavior-params')
  return { shown: getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0,
           fields: [...e.querySelectorAll('select, input')].length, template: document.getElementById('ep-behavior-template').value } }"""
with sync_playwright() as pw:
    br = new_browser(pw); print('register', register(br))
    ctx = br.new_context(ignore_https_errors=True, viewport={'width': 1280, 'height': 900})
    a = owner_tab(ctx, 'A', first=True)
    W = new_world(a, 'm1'); a.connect(W); a.page.wait_for_timeout(800); a.edit_on()
    x = add_cube(a); a.ev(MOVE, {'name': x, 't': [-1.5, 0.5, -3]}); a.page.wait_for_timeout(300)
    y = add_cube(a); a.ev(MOVE, {'name': y, 't': [1.5, 0.5, -3]}); a.page.wait_for_timeout(300)
    select_node(a, x)
    a.page.select_option('#ep-behavior-template', 'select-visibility'); a.page.wait_for_timeout(300)
    a.page.click('#ep-behavior-save'); a.page.wait_for_timeout(1500)
    r1 = a.ev(PARAMS); print('saved:', r1, '| leaf:', bool(leaf(a, x)))
    check('the template saved, its fields shown', r1['shown'] and r1['fields'] > 0 and bool(leaf(a, x)), r1)
    select_node(a, y); a.page.wait_for_timeout(300); select_node(a, x); a.page.wait_for_timeout(400)
    r2 = a.ev(PARAMS); check('via another object and back: fields shown', r2['shown'] and r2['fields'] == r1['fields'], r2)
    a.page.click('#edit-toggle-btn'); a.page.wait_for_timeout(400)
    a.page.click('#edit-toggle-btn'); a.page.wait_for_timeout(400); select_node(a, x); a.page.wait_for_timeout(400)
    r3 = a.ev(PARAMS); print('Edit off, on, select:', r3)
    check('M-1 Edit off, Edit on, the same object: fields shown', r3['shown'] and r3['fields'] == r1['fields'] and r3['template'] == 'select-visibility', r3)
    print('page errors:', a.errors[:3])
    check('no page errors', not a.errors, a.errors[:3])
    br.close()
print('\nFAILS:', fails or 'none'); sys.exit(1 if fails else 0)
