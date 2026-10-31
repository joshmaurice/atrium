# SPDX-License-Identifier: MIT
# Part of the 4d pre-brief's static survey (§2.4). Reads the assets' JSON only; runs no engine code.
import json, os, struct, sys, collections
root = sys.argv[1]
def glb_json(path):
    with open(path, 'rb') as f:
        data = f.read()
    if data[:4] != b'glTF': return None
    n = struct.unpack_from('<I', data, 12)[0]
    return json.loads(data[20:20+n].decode('utf-8'))
assets = []
for dirpath, dirs, files in os.walk(root):
    if '/invalid' in dirpath or '/.git' in dirpath: continue
    for fn in files:
        p = os.path.join(dirpath, fn)
        j = None
        try:
            if fn.endswith('.glb'): j = glb_json(p)
            elif fn.endswith('.gltf'): j = json.load(open(p, encoding='utf-8'))
        except Exception: continue
        if not j: continue
        ext = (j.get('extensions') or {}).get('KHR_interactivity')
        if not ext: continue
        gs = ext.get('graphs') or []
        g = gs[ext.get('graph', 0)] if gs else None
        if not g: continue
        decls = g.get('declarations') or []
        ptrs = []
        for node in g.get('nodes') or []:
            d = decls[node.get('declaration', -1)] if 0 <= node.get('declaration', -1) < len(decls) else {}
            if str(d.get('op','')).startswith('pointer/'):
                pv = ((node.get('configuration') or {}).get('pointer') or {}).get('value') or [None]
                ptrs.append(pv[0])
        assets.append({'path': os.path.relpath(p, root), 'ops': sorted({(d.get('op'), d.get('extension')) for d in decls}, key=str),
                       'nodes': len(g.get('nodes') or []), 'decls': len(decls), 'vars': len(g.get('variables') or []),
                       'events': len(g.get('events') or []), 'ptrs': ptrs, 'bytes': len(json.dumps(g, separators=(',',':')))})
json.dump(assets, open(sys.argv[2], 'w'))
print(len(assets), 'assets with a graph')
