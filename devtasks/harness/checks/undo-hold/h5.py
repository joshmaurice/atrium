# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
# undo-hold h5 — the operator's DEV report (2026-11-05 11:18): while a model spins,
# the Library tiles and the World (sky) dropdown "flicker constantly"; a library
# tile seems impossible to choose. Suspect: client.on('som:set') runs
# refreshEditActions in Edit mode on EVERY set, a behaviour's included, and that
# rebuilds the whole tile grid (renderLibraryTiles) and the sky <select>
# (renderSkySelect) from scratch. This counts the rebuilds in 2 s with a spinner
# running and with none, and tries to place a library item by a real mouse click.
# Server: checks/signin-sync/authserver.mjs with HOOKS=1.
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripting-4d'))
from common4d import *
G = graph([
    {'op': 'event/onTick', 'flows': {'out': flow(4)}},
    getter('/nodes/0/rotation', 'float4'),
    {'op': 'math/quatFromAxisAngle', 'values': {'axis': lit('float3', [0, 1, 0]), 'angle': lit('float', 0.05)}},
    {'op': 'math/quatMul', 'values': {'a': sock(1), 'b': sock(2)}},
    setter('/nodes/0/rotation', 'float4', sock(3)),
])
WATCH = """() => { window.__rebuilds = { tiles: 0, sky: 0 }
  new MutationObserver((l) => { if (l.some((m) => m.type === 'childList' && m.removedNodes.length)) window.__rebuilds.tiles++ })
    .observe(document.getElementById('library-tiles'), { childList: true })
  new MutationObserver((l) => { if (l.some((m) => m.type === 'childList' && m.removedNodes.length)) window.__rebuilds.sky++ })
    .observe(document.getElementById('ep-sky'), { childList: true }) }"""
COUNT = "() => ({ ...window.__rebuilds })"
RESET = "() => { window.__rebuilds = { tiles: 0, sky: 0 } }"
NODES = "() => atriumClient.som.document.getRoot().listNodes().length"

def rebuilds(t, ms=2000):
    t.ev(RESET); t.page.wait_for_timeout(ms); return t.ev(COUNT)

with sync_playwright() as pw:
    br = new_browser(pw)
    print('register', register(br))
    ctx = br.new_context(ignore_https_errors=True, viewport={'width': 1280, 'height': 900})
    a = owner_tab(ctx, 'A', first=True)
    W = new_world(a, 'uh5'); print('A connected', a.connect(W)); a.page.wait_for_timeout(800)
    a.edit_on()
    x = add_cube(a); a.ev(MOVE, {'name': x, 't': [-1.5, 0.5, -3]}); a.page.wait_for_timeout(300)
    import_graph(a, x, gltf_doc(G, ['Spinner']), 'spin.gltf', {'Spinner (node)': x})
    a.edit_on(); a.page.click('#ep-library'); a.page.wait_for_timeout(800)
    a.ev(WATCH)
    idle = rebuilds(a); print('no behaviour running: rebuilds in 2 s', idle)
    set_enabled(a, x, True); a.edit_on(); a.page.wait_for_timeout(500)
    if not a.ev("() => document.getElementById('library-grid').style.display !== 'none'"):
        a.page.click('#ep-library'); a.page.wait_for_timeout(500)
    busy = rebuilds(a); print('spinner running: rebuilds in 2 s', busy)
    check('with no behaviour running, nothing is rebuilt', idle['tiles'] == 0 and idle['sky'] == 0, idle)
    check('with a spinner running, the tiles are NOT rebuilt', busy['tiles'] == 0, busy)
    check('with a spinner running, the sky list is NOT rebuilt', busy['sky'] == 0, busy)
    n0 = a.ev(NODES)
    tile = a.page.locator('#library-tiles .lg-tile').first
    print('tiles:', a.page.locator('#library-tiles .lg-tile').count())
    try:
        tile.click(timeout=5000, delay=120)   # a real press-and-release, 120 ms apart
        clicked = 'clicked'
    except Exception as e:
        clicked = f'click failed: {str(e).splitlines()[0][:90]}'
    a.page.wait_for_timeout(2500)
    n1 = a.ev(NODES); print('library click:', clicked, '| nodes before/after', n0, n1)
    check('a real click on a library tile places the item while the spinner runs', n1 > n0, (clicked, n0, n1))
    br.close()
print('\nFAILS:', fails or 'none'); sys.exit(1 if fails else 0)
