# scripting-4d-1 round 3 — R16 (F4) probe: does the page name an object id the way the importer's grant line and the
# Q3 confirmation do? Both pass `deps.nodeName = (id) => client.som.resolveObjectId(id)?.name ?? id` (app.js L3222, L3268),
# but resolveObjectId returns { node } or { problem }, never a node. Prints what the page resolves, then the Q3 prompt
# for a graph with a grant outside its own subtree (on-select → set the target's visibility).
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
    seen = []
    def on_dialog(d): seen.append(d.message); d.dismiss()   # dismiss: the probe leaves the behaviour disabled
    # the Q3 prompt asks only for a graph that writes AND starts on load or runs every frame; this one is on-select,
    # so build the prompt the way behavior-form.js L701 does, with the page's own nameOf
    prompt = a.ev("""async (n) => { const m = await import('/apps/client/src/graph-import.js');
        const leaf = atriumClient.som.getNodeByName(n).extras.atrium.behavior;
        const nameOf = (id) => (atriumClient.som?.resolveObjectId?.(id)?.name ?? id);
        return m.enablePromptText(leaf, { nameOf }) }""", x)
    print('Q3 prompt (page nameOf)   :', prompt)
    check('Q3 the Enable prompt names the target', f'It can also change: {y}.' in prompt, prompt)
    br.close()
print('\nFAILS:', fails or 'none'); sys.exit(1 if fails else 0)
