# scripting-4d-1 round 4 — R24 (the outside review's S2) in a real browser: a ~3 MiB .gltf with N nodes and N lights
# (one host each) and a small on-select graph, opened through the panel. Round 3's importer matched lights to hosts
# in O(lights × nodes) on the main thread (33 s at 46,000 in Node); round 4's is one pass. Measures the time from
# choosing the file to the panel showing its mapping rows, and that the page stayed responsive (a timer's lag).
#   HARNESS_ROOT=/tmp/atrium-harness N=46000 python3 probe_r24.py      (authserver.mjs HOOKS=1 running)
from common4d import *

N = int(os.environ.get('N', '46000'))
G = graph([on_select(0) | {'flows': {'out': flow(1)}}, setter(VIS_PTR.format(i=1), 'bool', lit('bool', False))])
doc = {'asset': {'version': '2.0'},
       'nodes': [{'name': 'Own'}, {'name': 'Target'}] + [{'extensions': {'KHR_lights_punctual': {'light': i}}} for i in range(N)],
       'extensions': {'KHR_lights_punctual': {'lights': [{'type': 'point'} for _ in range(N)]},
                      'KHR_interactivity': {'graphs': [G], 'graph': 0}}}
data = json.dumps(doc, separators=(',', ':')).encode()
print(f'file: {N} nodes + {N} lights, {len(data) / 1048576:.2f} MiB')

with sync_playwright() as pw:
    br = new_browser(pw)
    print('register', register(br))
    octx = br.new_context(ignore_https_errors=True, viewport={'width': 1280, 'height': 800})
    a = owner_tab(octx, 'A', first=True)
    W = new_world(a, 'r24'); print('A connected', a.connect(W))
    a.edit_on(); x = add_cube(a); a.page.wait_for_timeout(300)
    select_node(a, x); a.page.click('#ep-import-open'); a.page.wait_for_timeout(200)
    a.ev("() => { window.__lag = 0; let last = performance.now(); window.__lagT = setInterval(() => { const t = performance.now(); window.__lag = Math.max(window.__lag, t - last - 50); last = t }, 50) }")
    t0 = time.time()
    a.page.set_input_files('#ep-import-file', {'name': 'many-lights.gltf', 'mimeType': 'model/gltf+json', 'buffer': data})
    ok = a.wait("document.querySelectorAll('#ep-import-mapping .ep-row').length > 0 || /refus|limit|can't|not /.test(document.getElementById('ep-import-status').textContent)", timeout=120000)
    dt = time.time() - t0
    lag = a.ev('window.__lag'); st = a.ev("document.getElementById('ep-import-status').textContent")
    rows = a.ev("[...document.querySelectorAll('#ep-import-mapping .ep-row span')].map(e => e.textContent)")
    print(f'panel ready in {dt:.2f} s (includes the upload into the page); longest main-thread stall {lag:.0f} ms; status {st!r}; rows {rows}')
    check(f'R24 a {len(data) / 1048576:.2f} MiB file with {N} lights opens in the panel in under 5 s', ok and dt < 5.0, (ok, dt))
    check('R24 ... and its mapping table shows the graph\'s two references', rows == ['Own (node)', 'Target (node)'], rows)
    br.close()
print('\nFAILS:', fails or 'none'); sys.exit(1 if fails else 0)
