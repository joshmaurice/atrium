# SPDX-License-Identifier: MIT
# Part of the 4d pre-brief's static survey (§2.4). Reads the assets' JSON only; runs no engine code.
import json, os, struct, sys, re, collections
root = sys.argv[1]
def glb_json(path):
    data = open(path,'rb').read()
    if data[:4] != b'glTF': return None
    n = struct.unpack_from('<I', data, 12)[0]
    return json.loads(data[20:20+n].decode('utf-8'))
seen = set(); assets = 0; wired_assets = 0; ref_tpl_assets = 0; fam_assets = collections.Counter()
for dirpath, dirs, files in sorted(os.walk(root)):
    if '/invalid' in dirpath or '/.git' in dirpath: continue
    for fn in sorted(files):
        if not fn.endswith('.glb'): continue
        key = re.sub(r'/glTF[^/]*$', '', dirpath) + '/' + (fn if 'glTF' not in dirpath else '')
        if key in seen: continue
        try: j = glb_json(os.path.join(dirpath, fn))
        except Exception: continue
        ext = (j or {}).get('extensions', {}).get('KHR_interactivity') if j else None
        if not ext or not ext.get('graphs'): continue
        seen.add(key)
        g = ext['graphs'][ext.get('graph', 0)]; decls = g.get('declarations') or []; nodes = g.get('nodes') or []
        wired = False; reftpl = False; fams = set(); hasptr = False
        for node in nodes:
            d = decls[node['declaration']] if 0 <= node.get('declaration',-1) < len(decls) else {}
            if not str(d.get('op','')).startswith('pointer/'): continue
            hasptr = True
            p = (((node.get('configuration') or {}).get('pointer') or {}).get('value') or [''])[0] or ''
            fams.add(p.split('/')[1] if p.startswith('/') and len(p.split('/'))>1 else '?')
            if p.startswith('/extensions/'): fams.add('ext:' + p.split('/')[2])
            for m in re.finditer(r'(\[([^\]]+)\]|\{([^}]+)\})', p):
                sid = m.group(2) or m.group(3)
                if m.group(3): reftpl = True
                v = (node.get('values') or {}).get(sid)
                if isinstance(v, dict) and 'node' in v: wired = True
        if hasptr:
            assets += 1; wired_assets += wired; ref_tpl_assets += reftpl
            for f in fams: fam_assets[f] += 1
print('distinct assets with pointer nodes', assets, '| any wired index/ref', wired_assets, '| any {ref} template', ref_tpl_assets)
print(fam_assets.most_common())
