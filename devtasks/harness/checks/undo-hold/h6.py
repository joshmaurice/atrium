# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
# undo-hold h6 — round 3's R4 must not freeze what the Library and sky lists show
# (REVISION-undo-hold-round-3.md §3, "by hand"): with NO behaviour running, the
# Library grid shows the catalog's tiles, and a sky picked in tab A shows up in tab
# B's select (same owner, second tab), and B's own pick still works.
# Server: checks/signin-sync/authserver.mjs with HOOKS=1.
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripting-4d'))
from common4d import *
OPTS = "() => [...document.querySelectorAll('#ep-sky option')].map((o) => o.value)"
VAL = "() => document.getElementById('ep-sky').value"
PICK = "(v) => { const s = document.getElementById('ep-sky'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })) }"

with sync_playwright() as pw:
    br = new_browser(pw)
    print('register', register(br))
    ctx = br.new_context(ignore_https_errors=True, viewport={'width': 1280, 'height': 900})
    a = owner_tab(ctx, 'A', first=True)
    W = new_world(a, 'uh6'); print('A connected', a.connect(W)); a.page.wait_for_timeout(800)
    b = owner_tab(ctx, 'B'); print('B connected', b.connect(W)); b.page.wait_for_timeout(1200)
    for t in (a, b): t.edit_on()
    a.page.click('#ep-library'); a.page.wait_for_timeout(800)
    n = a.page.locator('#library-tiles .lg-tile').count(); print('A library tiles:', n)
    check('the Library grid shows the catalog (tiles present)', n > 0, n)
    opts = a.ev(OPTS); print('sky options:', opts[:4], '…', len(opts))
    pick = next((o for o in opts if o not in ('', '__custom__')), None)
    check('the sky list has catalog skies', pick is not None, opts)
    a.ev(PICK, pick); a.page.wait_for_timeout(2500)
    print('A picked', pick, '| A shows', a.ev(VAL), '| B shows', b.ev(VAL))
    check("A's pick shows in A", a.ev(VAL) == pick, a.ev(VAL))
    check("A's pick shows in B's select (another tab's change)", b.ev(VAL) == pick, b.ev(VAL))
    other = next((o for o in opts if o not in ('', '__custom__', pick)), '')
    b.ev(PICK, other); b.page.wait_for_timeout(2500)
    print('B picked', repr(other), '| B shows', b.ev(VAL), '| A shows', a.ev(VAL))
    check("B's own pick works and reaches A", b.ev(VAL) == other and a.ev(VAL) == other, (b.ev(VAL), a.ev(VAL)))
    print('page errors:', a.errors[:2], b.errors[:2])
    br.close()
print('\nFAILS:', fails or 'none'); sys.exit(1 if fails else 0)
