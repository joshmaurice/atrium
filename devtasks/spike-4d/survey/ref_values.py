# SPDX-License-Identifier: MIT
# Part of the 4d pre-brief's static survey (§2.4). Reads the assets' JSON only; runs no engine code.
import json, os, struct, sys, re, collections
root = sys.argv[1]
def glb_json(path):
    data = open(path,'rb').read()
    if data[:4] != b'glTF': return None
    n = struct.unpack_from('<I', data, 12)[0]
    return json.loads(data[20:20+n].decode('utf-8'))
shapes = collections.Counter(); types_seen = collections.Counter(); ref_assets = 0
for dirpath, dirs, files in os.walk(root):
    if '/invalid' in dirpath or '/.git' in dirpath: continue
    for fn in files:
        if not fn.endswith('.glb'): continue
        try: j = glb_json(os.path.join(dirpath, fn))
        except Exception: continue
        ext = (j or {}).get('extensions', {}).get('KHR_interactivity') if j else None
        if not ext or not ext.get('graphs'): continue
        g = ext['graphs'][ext.get('graph', 0)]; types = [t.get('signature') for t in g.get('types') or []]
        has = False
        for node in g.get('nodes') or []:
            for sid, v in (node.get('values') or {}).items():
                if isinstance(v, dict) and 'node' not in v and 0 <= v.get('type', -1) < len(types) and types[v['type']] == 'ref':
                    has = True
                    val = (v.get('value') or [None])[0]
                    shapes[re.sub(r'\d+', 'N', str(val))] += 1
        ref_assets += has
print('assets with literal ref values:', ref_assets)
for s, v in shapes.most_common(15): print(f'  {v:4d} {s}')
