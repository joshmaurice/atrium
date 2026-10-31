# scripting-4d-1 §6.1 — shared helpers, on top of scripting-4c/common.py (real sign-in, authserver.mjs HOOKS=1).
# Graphs are authored here in the fixtures' form (types 0..6 = bool, int, float, float3, float4, ref, float2),
# wrapped into a glTF document and imported THROUGH THE PANEL (#ep-import-*), as an owner would.
import sys, os, json, math, time
_here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_here, '..', 'scripting-4c'))
from common import *   # noqa

T = {'bool': 0, 'int': 1, 'float': 2, 'float3': 3, 'float4': 4, 'ref': 5, 'float2': 6}
TYPES = [{'signature': s} for s in ('bool', 'int', 'float', 'float3', 'float4', 'ref', 'float2')]
VIS_PTR = '/nodes/{i}/extensions/KHR_node_visibility/visible'


def lit(t, v): return {'type': T[t], 'value': v if isinstance(v, list) else [v]}
def sock(n, s='value'): return {'node': n, 'socket': s}
def flow(n, s='in'): return {'node': n, 'socket': s}


def graph(nodes, variables=None, events=None):
    """nodes: list of dicts {op, extension?, configuration?, values?, flows?}; declarations are made by (op, extension)."""
    decls, index = [], {}
    out = []
    for n in nodes:
        key = (n['op'], n.get('extension'))
        if key not in index:
            index[key] = len(decls)
            decls.append({'op': n['op'], **({'extension': n['extension']} if n.get('extension') else {})})
        node = {'declaration': index[key]}
        for k in ('configuration', 'values', 'flows'):
            if n.get(k): node[k] = n[k]
        out.append(node)
    g = {'types': TYPES, 'declarations': decls, 'nodes': out}
    if variables is not None: g['variables'] = variables
    if events is not None: g['events'] = events
    return g


def setter(ptr, t, value):
    return {'op': 'pointer/set', 'configuration': {'pointer': {'value': [ptr]}, 'type': {'value': [T[t]]}}, 'values': {'value': value}}


def getter(ptr, t):
    return {'op': 'pointer/get', 'configuration': {'pointer': {'value': [ptr]}, 'type': {'value': [T[t]]}}}


def on_select(i=0):
    return {'op': 'event/onSelect', 'extension': 'KHR_node_selectability',
            'configuration': {'nodeIndex': {'value': [i]}, 'stopPropagation': {'value': [False]}}}


def gltf_doc(g, node_names, extra=None):
    doc = {'asset': {'version': '2.0'}, 'nodes': [{'name': n} for n in node_names],
           'extensions': {'KHR_interactivity': {'graphs': [g], 'graph': 0}}}
    if extra: doc.update(extra)
    return json.dumps(doc).encode()


# ---- the panel ----
def select_node(t, name):
    t.ev("(n) => __ep().selectForEdit(atriumClient.som.getNodeByName(n))", name); t.page.wait_for_timeout(300)


def panel_text(t):
    ids = {'file': 'ep-import-file-name', 'report': 'ep-import-report', 'grants': 'ep-import-grants',
           'notes': 'ep-import-notes', 'status': 'ep-import-status'}
    out = {k: t.ev(f"document.getElementById('{v}').textContent") for k, v in ids.items()}
    out['rows'] = t.ev("""() => [...document.querySelectorAll('#ep-import-mapping .ep-row')].map(r => ({
        label: r.querySelector('span').textContent, options: [...r.querySelector('select').options].map(o => o.textContent),
        value: r.querySelector('select').value }))""")
    out['save_disabled'] = t.ev("document.getElementById('ep-import-save').disabled")
    return out


def import_graph(t, onto, data, fname, mapping, save=True, mime='application/json'):
    """Import `data` (bytes of a glTF/GLB) onto the node `onto` through the panel; mapping: {row label -> target node name}.
    Returns the panel's texts before and after Save."""
    t.edit_on(); select_node(t, onto)
    t.page.click('#ep-import-open'); t.page.wait_for_timeout(200)
    t.page.set_input_files('#ep-import-file', {'name': fname, 'mimeType': mime, 'buffer': data})
    t.wait("document.getElementById('ep-import-file-name').textContent !== ''", timeout=5000); t.page.wait_for_timeout(300)
    before = panel_text(t)
    for row in before['rows']:
        target = mapping.get(row['label'])
        if target is None:
            for k, v in mapping.items():
                if row['label'].startswith(k + ' ('): target = v
        if target is None: continue
        t.page.select_option(f"#ep-import-mapping select[aria-label='{row['label']} target']", label=target)
        t.page.wait_for_timeout(150)
    mapped = panel_text(t)
    out = {'before': before, 'mapped': mapped}
    if save and not mapped['save_disabled']:
        t.page.click('#ep-import-save')
        t.wait("() => { const s = document.getElementById('ep-import-status').textContent; return s.startsWith('Saved') || getComputedStyle(document.getElementById('ep-import-panel')).display === 'none' || /refus|not |can't|limit/.test(s) }", timeout=8000)
        t.page.wait_for_timeout(400)
        out['after'] = panel_text(t)
    return out


def form(t):
    """The Behaviour form as the owner sees it."""
    g = lambda i: t.ev(f"(() => {{ const e = document.getElementById('{i}'); return e ? (getComputedStyle(e).display === 'none' ? null : e.textContent) : undefined }})()")
    return {'enabled': g('ep-behavior-enabled'), 'status': g('ep-behavior-status'), 'lines': g('ep-behavior-lines'),
            'notes': g('ep-behavior-notes'), 'note': g('ep-behavior-note'), 'template': t.ev("document.getElementById('ep-behavior-template').value"),
            'log': t.ev("[...document.querySelectorAll('#ep-behavior-log-lines > *')].map(e => e.textContent)")}


def leaf(t, name): return t.ev("(n) => atriumClient.som.getNodeByName(n)?.extras?.atrium?.behavior ?? null", name)


def set_enabled(t, name, on=True, accept=True):
    """Click Enabled/Disabled in the form for `name`; a Q3 confirmation is answered by `accept`. Returns (dialog text, leaf.enabled)."""
    seen = []
    def on_dialog(d): seen.append(d.message); (d.accept() if accept else d.dismiss())
    t.page.on('dialog', on_dialog)
    t.edit_on(); select_node(t, name)
    want = 'Disabled' if on else 'Enabled'
    t.wait(f"document.getElementById('ep-behavior-enabled').textContent === '{want}'", timeout=4000)
    t.page.click('#ep-behavior-enabled'); t.page.wait_for_timeout(900)
    t.page.remove_listener('dialog', on_dialog)
    return (seen[0] if seen else None), (leaf(t, name) or {}).get('enabled')


def rlog(t, n=12): return t.ev("(n) => __beh().runner.log.slice(-n).map(l => (l.node ?? '') + ': ' + l.message)", n)
def lines(t, name): return t.ev("(n) => __beh().runner.statusLines(n)", name)
def engine(t, name): return t.ev("(n) => { const r = __beh().runner.engines.get(n); return r ? { live: !!r.engine, reason: r.reason ?? null, throttled: r.throttled === true, report: r.report ?? null } : null }", name)
def rot(t, name): return t.ev("(n) => [...atriumClient.som.getNodeByName(n).rotation]", name)
def tr(t, name): return t.ev("(n) => [...atriumClient.som.getNodeByName(n).translation]", name)
def obj_rot(t, name): return t.ev("(n) => { const o = stage.scene.getObjectByName(n); return o ? [o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w] : null }", name)


def qangle(q):
    """The rotation angle (deg) of a unit quaternion."""
    w = max(-1.0, min(1.0, q[3])); return math.degrees(2 * math.acos(abs(w)))


def server_log(t): return t.ev("async () => (await fetch('/__log')).text()")


def doc_leaf(t, slug, name):
    """The SAVED document's leaf for `name` in alice's world `slug` (GET /api/worlds/:id, the owner's read)."""
    return t.ev("""async ([slug, name]) => { const ws = await (await fetch('/api/worlds')).json(); const w = ws.find(x => x.slug === slug);
      const d = await (await fetch('/api/worlds/' + w.id)).json(); const doc = d.document ?? d; const nodes = doc.nodes ?? [];
      const n = nodes.find(x => x.name === name); return n ? { tr: n.translation ?? null, rot: n.rotation ?? null, beh: n.extras?.atrium?.behavior ?? null, keys: Object.keys(d) } : { keys: Object.keys(d), names: nodes.map(x => x.name) } }""", [slug, name])
