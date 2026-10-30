import re, os, sys, difflib
B, R = '/tmp/reg/base', '/tmp/reg/r2'
def norm(t):
    t = re.sub(r'GL Driver Message.*', '', t)
    t = re.sub(r'\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b', 'UUID', t)
    t = re.sub(r'\b(avatar|User)-[0-9a-f]{4,8}\b', r'\1-X', t)
    t = re.sub(r'\b[st]4[ab]\w*\d{9,}\b|\b\w+\d{10,}\b', 'KEY', t)
    t = re.sub(r'-?\d+(\.\d+)?(e-?\d+)?', 'N', t)
    return [l.rstrip() for l in t.splitlines() if l.strip()]
names = sorted(f for f in os.listdir(R) if f.endswith('.txt') and not f.startswith('_')) if os.path.isdir(R) else []
for f in names:
    a, b = norm(open(os.path.join(B, f)).read()), norm(open(os.path.join(R, f)).read())
    d = [l for l in difflib.unified_diff(a, b, lineterm='', n=0) if not l.startswith(('---', '+++', '@@'))]
    print(f"{'SAME' if not d else 'DIFF'}  {f}")
    for l in d[:12]: print('     ', l[:220])
