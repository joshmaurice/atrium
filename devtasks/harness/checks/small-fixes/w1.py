# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
#
# small-fixes SF-4 (R12-R15): the saved worlds as one drop-down row.
# On checks/signin-sync/authserver.mjs (the real server). Screenshots go to
# $HARNESS_ROOT/shots/sf4-*.png: phone 390 x 844, desktop-site mode (the page
# laid out 980 px wide and zoomed out, as Chrome's "desktop site"), 1280 x 900.
#   HARNESS_ROOT=/tmp/atrium-harness python3 devtasks/harness/checks/small-fixes/w1.py
import os, sys, re, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripting-4c'))
from common import *   # noqa
ROOT = os.environ.get('HARNESS_ROOT', '/tmp/atrium-harness')
OPTS = "() => [...document.querySelectorAll('#wb-select option')].map(o => o.textContent)"
ROW = """() => { const s = document.getElementById('wb-select'), l = document.getElementById('wb-list'), b = document.getElementById('world-browser')
  const t = l.querySelector('.wb-vis-toggle input')
  return { rows: l.querySelectorAll('.wb-item').length, options: s ? s.options.length : 0, chosen: s ? s.options[s.selectedIndex]?.textContent : null,
           pub: t ? t.checked : null, label: l.querySelector('.wb-vis-toggle')?.textContent.trim(), browserH: Math.round(b.getBoundingClientRect().height),
           buttons: [...l.querySelectorAll('button')].map(x => x.textContent) } }"""

def slug_of(label): return label.split('(').pop().split(' ·')[0]

def shot(t, name):
    path = f'{ROOT}/shots/sf4-{name}.png'; t.page.screenshot(path=path); print('   shot', path)

with sync_playwright() as pw:
    # The desktop-site page is rewritten (its viewport meta stripped), and a rewritten page loses its
    # local-network permission: without these flags it never connects (as spike-touch-nav/probe12.py).
    br = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
        '--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessRespectPreflightResults'])
    print('register', register(br))
    ctx = br.new_context(ignore_https_errors=True, viewport={'width': 1280, 'height': 900})
    a = owner_tab(ctx, 'A', first=True)
    # three more worlds, so the old list would have been four rows
    tag = int(time.time())
    for sl in (f'park-{tag}', f'gallery-{tag}', f'maze-{tag}'):
        a.ev("async (slug) => (await fetch('/api/worlds', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug, name: slug.split('-')[0] }) })).status", sl)
    a.page.reload(); a.page.wait_for_function('window.atriumClient && window.stage'); a.wait_world(); a.page.wait_for_timeout(1200)
    r = a.ev(ROW); print('row:', r)
    n = a.ev("async () => (await (await fetch('/api/worlds')).json()).length")   # earlier runs may have left worlds
    check(f'R12 one row, a drop-down with every world ({n}), then Public, Load, Delete', r['rows'] == 1 and r['options'] == n >= 4 and r['buttons'] == ['Load', 'Delete'] and r['label'] in ('Public', 'Private'), r)
    check('R13 the chosen world is the one this tab is in (home)', slug_of(r['chosen']) == 'home', r['chosen'])
    shot(a, 'desktop-1280')

    # choose another world, Load it: connected there, and the row still shows it
    opts = a.ev(OPTS); park = next(o for o in opts if slug_of(o) == f'park-{tag}')
    a.page.select_option('#wb-select', label=park); a.page.wait_for_timeout(200)
    check('the switch follows the choice (a new world is private)', a.ev(ROW)['pub'] is False, a.ev(ROW))
    a.page.click('#wb-list button:has-text("Load")')
    ok = a.wait_world(f'/worlds/alice/park-{tag}'); a.page.wait_for_timeout(800)
    check('R14 Load connects to the chosen world', ok, a.ev('atriumClient._wsUrl'))
    check('R13 after Load the row shows that world', slug_of(a.ev(ROW)['chosen']) == f'park-{tag}', a.ev(ROW)['chosen'])

    # the switch: make park public; the server agrees; the choice stays
    a.page.click('#wb-list .wb-vis-toggle input'); a.page.wait_for_timeout(800)
    vis = a.ev("async (slug) => (await (await fetch('/api/worlds')).json()).find(w => w.slug === slug)?.visibility", f'park-{tag}')
    check('R14 the switch makes the chosen world public (server agrees)', vis == 'public' and a.ev(ROW)['pub'] is True, (vis, a.ev(ROW)))

    # a refresh (Create) keeps the choice by id; the new world is listed
    gallery = next(o for o in a.ev(OPTS) if slug_of(o) == f'gallery-{tag}')
    a.page.select_option('#wb-select', label=gallery); a.page.wait_for_timeout(100)
    a.page.click('#connectBtn'); a.wait('!atriumClient.connected', timeout=8000)   # not connected: the earlier choice rules
    a.page.fill('#wb-slug', f'pond-{tag}'); a.page.fill('#wb-name', 'pond'); a.page.click('#wb-create-btn'); a.page.wait_for_timeout(1500)
    r = a.ev(ROW)
    check('R13 a refresh keeps the choice by id (gallery), and lists the new world', slug_of(r['chosen']) == f'gallery-{tag}' and r['options'] == n + 1 and any(slug_of(o) == f'pond-{tag}' for o in a.ev(OPTS)), r)

    # Delete the chosen world (gallery), confirmed
    a.page.once('dialog', lambda d: d.accept())
    a.page.click('#wb-list button:has-text("Delete")'); a.page.wait_for_timeout(1500)
    names = [slug_of(o) for o in a.ev(OPTS)]
    check('R14 Delete removes the chosen world', f'gallery-{tag}' not in names and len(names) == n, names)
    a.connect(HOME); a.page.wait_for_timeout(500)

    # screenshots on a phone, and in desktop-site mode
    ph = br.new_context(ignore_https_errors=True, viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    p = Tab(ph, 'phone'); p.login('alice'); p.wait_world(); p.page.wait_for_timeout(1500)
    r = p.ev(ROW); print('phone row:', r)
    check('R15 on a phone: one row, the browser well under 40 % of the height', r['rows'] == 1 and r['browserH'] < 0.2 * 844, r)
    shot(p, 'phone-390')
    ds = br.new_context(ignore_https_errors=True, viewport={'width': 390, 'height': 760}, device_scale_factor=2, is_mobile=True, has_touch=True)
    ds.route('**/apps/client/local.html', lambda route: (lambda r: route.fulfill(response=r, body=re.sub(r'<meta name="viewport"[^>]*>', '', r.text())))(route.fetch()))
    d = Tab(ds, 'desktop-site'); d.login('alice'); d.wait_world(); d.page.wait_for_timeout(1500)
    r = d.ev(ROW); print('desktop-site row:', r, 'scale', d.ev('visualViewport.scale'), 'width', d.ev('innerWidth'))
    check('R15 in desktop-site mode: one row, showing the world the tab is in', r['rows'] == 1 and slug_of(r['chosen'] or '') == 'home', r)
    shot(d, 'desktop-site')
    br.close()
print('\nFAILS:', fails or 'none'); sys.exit(1 if fails else 0)
