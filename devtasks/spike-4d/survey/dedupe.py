# SPDX-License-Identifier: MIT
# Part of the 4d pre-brief's static survey (§2.4). Reads the assets' JSON only; runs no engine code.
import json, sys, re, statistics, collections
A = json.load(open(sys.argv[1]))
by = {}
for a in A:
    parts = a['path'].split('/')
    # asset = path up to the folder above the variant folder (glTF / glTF-Binary) or the file stem
    key = '/'.join(p for p in parts[:-1] if not p.startswith('glTF')) + '/' + re.sub(r'\.(glb|gltf)$', '', parts[-1])
    key = re.sub(r'/[^/]+$', '', key) if len(parts) > 2 else key
    by.setdefault(key, a)
D = list(by.values())
FLOW={'flow/sequence','flow/branch','flow/switch','flow/doN','flow/multiGate','flow/waitAll','flow/throttle','flow/for','flow/while','flow/setDelay','flow/cancelDelay'}
EVT={'event/onStart','event/onTick','event/onSelect','event/receive','event/send'}
OK=lambda op: op in FLOW|EVT|{'variable/get','variable/set','variable/interpolate','pointer/get','pointer/set','pointer/interpolate','animation/start','animation/stop','debug/log'} or op.startswith('math/') or op.startswith('type/') or op=='ref/eq'
T={'event/onSelect','event/receive','flow/branch','pointer/get','pointer/set','math/not','math/gt','animation/start','animation/stop','debug/log'}
M=[a for a in D if a['path'].startswith('Models')]; Tt=[a for a in D if not a['path'].startswith('Models')]
for label, S in (('all', D), ('tests', Tt), ('models', M)):
    ins=[a for a in S if all(OK(o) for o,e in a['ops'])]
    fit=[a for a in ins if a['nodes']<=256 and a['bytes']<=65536]
    print(f"{label}: {len(S)} distinct; 4b-2 ops {sum(all(o in T for o,e in a['ops']) for a in S)}; proposed ops {len(ins)}; + fit 256/64K {len(fit)}; no-tick/interp {sum(all(OK(o) and o not in ('event/onTick','pointer/interpolate','variable/interpolate') for o,e in a['ops']) for a in S)}; no-variables {sum(all(OK(o) and not o.startswith('variable/') for o,e in a['ops']) for a in S)}")
    if S: print('   nodes median', statistics.median(a['nodes'] for a in S), 'bytes median', statistics.median(a['bytes'] for a in S), 'within 64/16K', sum(a['nodes']<=64 and a['bytes']<=16384 for a in S))
print(sorted(by)[:5])
