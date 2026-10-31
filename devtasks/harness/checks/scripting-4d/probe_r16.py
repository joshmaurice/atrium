# scripting-4d-1 round 3 — R16 (F4) probe: does the page name an object id the way the importer's grant line and the
# Q3 confirmation do? Both pass `deps.nodeName = (id) => client.som.resolveObjectId(id)?.name ?? id` (app.js L3222, L3268),
# but resolveObjectId returns { node } or { problem }, never a node. Prints what the page resolves, then the Q3 prompt
# that the real Enable confirmation shows for a start-on-load graph with a grant outside its own subtree.
from common4d import *

G = graph([
    on_select(0) | {'flows': {'out': flow(1)}},
    setter(VIS_PTR.format(i=1), 'bool', lit('bool', False)),
])

with sync_playwright() as pw:
    br = new_browser(pw)
    print('register', register(br))
    octx = br.new_context(ignore_https_errors=True, viewport={'width': 1280, 'height': 800})
    a = owner_tab(octx, 'A', first=True)
    W = new_world(a, 'r16'); print('A connected', a.connect(W))
    a.edit_on(); x = add_cube(a); y = add_cube(a); a.page.wait_for_timeout(400)
    r = import_graph(a, x, gltf_doc(G, ['Own', 'Target']), 'r16.gltf', {'Own (node)': x, 'Target (node)': y})
    yid = a.ev(OID, y)
    shape = a.ev("(id) => { const r = atriumClient.som.resolveObjectId(id); return { keys: Object.keys(r), name: r.name ?? null, nodeName: r.node?.name ?? null } }", yid)
    print('resolveObjectId(target id):', shape)
    print('importer grant line       :', r['mapped']['grants'])
    check('R16 the importer grant line names the target', r['mapped']['grants'] == f'It can change: {y}', (r['mapped']['grants'], y, yid))
    # the REAL Q3 prompt: it asks only for a graph that writes and starts on load (or runs every frame), so import one
    G2 = graph([{'op': 'event/onStart', 'flows': {'out': flow(1)}}, setter(VIS_PTR.format(i=1), 'bool', lit('bool', False))])
    z = add_cube(a); a.page.wait_for_timeout(300)
    import_graph(a, z, gltf_doc(G2, ['Own', 'Target']), 'r16-start.gltf', {'Own (node)': z, 'Target (node)': y})
    prompt, en = set_enabled(a, z, True, accept=False)       # dismiss: leaves it disabled
    print('Q3 prompt (the real one)  :', prompt)
    check('Q3 the Enable prompt names the target', prompt is not None and f'It can also change: {y}.' in prompt and yid not in prompt, prompt)
    br.close()
print('\nFAILS:', fails or 'none'); sys.exit(1 if fails else 0)
