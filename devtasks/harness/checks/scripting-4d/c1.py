# scripting-4d-1 §6.1 checks 1, 4, 7 and 8 — the importer, through the panel, on the REAL server with real sign-in
# (checks/signin-sync/authserver.mjs HOOKS=1, started with ATRIUM_AUTOSAVE_DEBOUNCE_MS=3000; check 8 restarts it with KEEP_DB=1).
# alice's tabs share one context; V is an anonymous visitor in its own context.
import subprocess, signal
from common4d import *

ROOT = os.environ.get('HARNESS_ROOT', '/tmp/atrium-harness')
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..'))

# ---- check 1's graph: on select → 0.5 s → hide the target → 2 s → show it (file node 0 = own, 1 = target)
G1 = graph([
    on_select(0) | {'flows': {'out': flow(1)}},
    {'op': 'flow/setDelay', 'values': {'duration': lit('float', 0.5)}, 'flows': {'done': flow(2)}},
    setter(VIS_PTR.format(i=1), 'bool', lit('bool', False)) | {'flows': {'out': flow(3)}},
    {'op': 'flow/setDelay', 'values': {'duration': lit('float', 2.0)}, 'flows': {'done': flow(4)}},
    setter(VIS_PTR.format(i=1), 'bool', lit('bool', True)),
])
# ---- check 4's graphs (Rev 1.5, R-L4 (a)):
# G4: a hover node carrying KHR_node_hoverability that only ends a flow, and a /materials/ pointer/SET that nothing
#     reads (inert, listed); the rest (onStart → scale 1.5 → the material write) runs.
# G4b: the same material pointer READ by a running node (extract4 → combine3 → a translation set): refused at import,
#     naming the reference and its consumer (G6's consumer rule, Rev 1.1 S3 / Rev 1.2 N4).
MAT = '/materials/0/pbrMetallicRoughness/baseColorFactor'
G4 = graph([
    {'op': 'event/onStart', 'flows': {'out': flow(1)}},                                   # 0
    setter('/nodes/0/scale', 'float3', lit('float3', [1.5, 1.5, 1.5])) | {'flows': {'out': flow(4)}},   # 1: the rest runs
    {'op': 'event/onHoverIn', 'extension': 'KHR_node_hoverability', 'configuration': {'nodeIndex': {'value': [0]}}, 'flows': {'out': flow(3)}},  # 2: inert
    setter(VIS_PTR.format(i=0), 'bool', lit('bool', False)),                                # 3: never runs
    setter(MAT, 'float4', lit('float4', [1.0, 0.0, 0.0, 1.0])),                             # 4: an unsupported pointer family, written, read by nothing
])
G4b = graph([
    {'op': 'event/onStart', 'flows': {'out': flow(1)}},                                   # 0
    setter('/nodes/0/scale', 'float3', lit('float3', [1.5, 1.5, 1.5])) | {'flows': {'out': flow(5)}},   # 1
    getter(MAT, 'float4'),                                                                  # 2: the unsupported pointer...
    {'op': 'math/extract4', 'values': {'a': sock(2)}},                                      # 3: ...read by a running node
    {'op': 'math/combine3', 'values': {'a': sock(3, '0'), 'b': sock(3, '1'), 'c': sock(3, '2')}},  # 4
    setter('/nodes/0/translation', 'float3', sock(4)),                                      # 5
])


def wait_vis(t, name, want, ms=4000):
    return t.wait("([n, w]) => { const o = stage.scene.getObjectByName(n); return !!o && o.visible === w }", timeout=ms, arg=[name, want])


with sync_playwright() as pw:
    br = new_browser(pw)
    print('register', register(br))
    octx = br.new_context(ignore_https_errors=True, viewport={'width': 1280, 'height': 800})
    vctx = br.new_context(ignore_https_errors=True, viewport={'width': 1280, 'height': 800})
    a = owner_tab(octx, 'A', first=True)
    W = new_world(a, 'c1'); slug = W.rsplit('/', 1)[1]; print('A connected', a.connect(W))
    v = Tab(vctx, 'V'); print('V connected', v.connect(W)); a.page.wait_for_timeout(800)
    check('A is the host with scriptRunner 3', a.ev(HOST)['active'] is True and hello(a) == {'tick': {'interval': 5000}, 'scriptRunner': 3}, (a.ev(HOST), hello(a)))

    a.edit_on(); x = add_cube(a); y = add_cube(a)
    a.ev(MOVE, {'name': x, 't': [-1, 0.5, -2]}); a.ev(MOVE, {'name': y, 't': [-2.5, 0.5, -2]}); a.page.wait_for_timeout(500)

    print('\n== 1. import the on-select / delay / hide / show graph onto', x, 'with the target', y)
    r = import_graph(a, x, gltf_doc(G1, ['Switch', 'Target']), 'select-hide-show.gltf', {'Switch (node)': x, 'Target (node)': y})
    print('   before mapping:', json.dumps({k: r['before'][k] for k in ('file', 'status', 'rows', 'save_disabled')}))
    print('   mapped:', json.dumps({k: r['mapped'][k] for k in ('report', 'grants', 'notes', 'status', 'save_disabled')}))
    print('   after save:', json.dumps({k: r.get('after', {}).get(k) for k in ('status',)}))
    rows = r['before']['rows']
    check('1 the mapping table has one row per referenced file node, naming the file node and the kind', [q['label'] for q in rows] == ['Switch (node)', 'Target (node)'] and all(x in q['options'] and y in q['options'] for q in rows), rows)
    check('1 Save is disabled until every reference is mapped', r['before']['save_disabled'] is True and r['mapped']['save_disabled'] is False and r['before']['status'] == 'Choose a target…' and r['mapped']['status'] == 'Every reference is mapped.', (r['before']['status'], r['mapped']['status']))
    yid = a.ev(OID, y)
    check("1 the grant names the target outside the own subtree by its object name (R16), not its id", r['mapped']['grants'] == f'It can change: {y}' and yid not in r['mapped']['grants'], (r['mapped']['grants'], y, yid))
    check('1 no notes for an on-select graph (no start-on-load, no per-frame)', r['mapped']['notes'] == '', r['mapped']['notes'])
    L = leaf(a, x)
    check('1 saved disabled, as a custom graph with the target in targets', L is not None and L.get('enabled') is False and L.get('targets') == [yid] and 'template' not in L and L['nodeMap'][0] == a.ev(OID, x), (L or {}).get('enabled'), )
    f = form(a); print('   form after save:', json.dumps(f))
    check("1 the form shows Disabled and the importer's status says Saved", f['enabled'] == 'Disabled' and (r.get('after', {}).get('status') or '').startswith('Saved'), (f['enabled'], r.get('after', {}).get('status')))
    dlg, en = set_enabled(a, x, True)
    check('1 Enable: no confirmation for an on-select graph; the leaf is enabled', dlg is None and en is True, (dlg, en))
    edit_off(a); v.page.wait_for_timeout(800)
    print('   engine in A', engine(a, x), '| V pick', pick_at(v, x))
    check('1 the target is visible before the click', a.ev(VIS, y)['obj'] is True and v.ev(VIS, y)['obj'] is True)
    t0 = time.time(); click_node(v, x)
    hid = wait_vis(v, y, False, 3000); t_hide = time.time() - t0
    check(f'1 a visitor click hides the target after the 0.5 s delay (hidden at {t_hide:.2f} s)', hid and 0.4 < t_hide < 2.0 and a.ev(VIS, y)['obj'] is False, (hid, t_hide, a.ev(VIS, y)))
    shown = wait_vis(v, y, True, 4000); t_show = time.time() - t0
    check(f'1 ... and shows it again 2 s later (shown at {t_show:.2f} s)', shown and 2.3 < t_show < 4.5 and a.ev(VIS, y)['obj'] is True, (shown, t_show))
    print('   A runner log', rlog(a, 6))

    print('\n== 4. "Partially supported" (R-L4 (a)): a hover node (KHR_node_hoverability) and a /materials/ pointer/set nothing reads')
    a.edit_on(); z = add_cube(a); a.ev(MOVE, {'name': z, 't': [2, 0.5, -3]}); a.page.wait_for_timeout(300)
    r4 = import_graph(a, z, gltf_doc(G4, ['Own']), 'partial.gltf', {'Own (node)': z})
    print('   mapped:', json.dumps({k: r4['mapped'][k] for k in ('report', 'grants', 'notes', 'status')}))
    rep = r4['mapped']['report']
    check('4 the importer lists the hover op with its extension and the material pointer', 'Unsupported: event/onHoverIn (KHR_node_hoverability) ×1' in rep and f'Unsupported pointers: {MAT} ×1' in rep, rep)
    check('4 the material ref is kept (read by nothing), and the import is accepted', f'Kept: {MAT}' in rep and r4['mapped']['status'] == 'Every reference is mapped.' and r4.get('after', {}).get('status', '').startswith('Saved'), (rep, r4['mapped']['status'], r4.get('after', {}).get('status')))
    check('4 the start-on-load note is shown (the graph writes on onStart)', r4['mapped']['notes'].startswith('This graph runs again'), r4['mapped']['notes'])
    check('4 saved disabled', (leaf(a, z) or {}).get('enabled') is False)
    s0 = a.ev("(n) => [...atriumClient.som.getNodeByName(n).scale]", z); n0 = len(a.ev('__beh().runner.log'))
    dlg, en = set_enabled(a, z, True)
    print('   confirmation:', dlg)
    check('4 Enable asks first (Q3: a custom graph that writes and starts on load), naming no grants', dlg is not None and dlg.startswith('This graph runs again whenever you reconnect') and dlg.endswith('It can also change: . Enable it?') and en is True, (dlg, en))
    a.page.wait_for_timeout(1500)
    f4 = form(a); print('   form:', json.dumps(f4)); print('   engine', engine(a, z)); print('   log', rlog(a, 8)[-4:])
    check('4 the status line says "Partially supported" with both items', (f4['lines'] or '').startswith('Partially supported: event/onHoverIn with the extension KHR_node_hoverability (1 nodes); ' + MAT + ' (1 nodes)'), f4['lines'])
    check('4 the rest runs: the own scale became 1.5 (host and visitor)', a.ev("(n) => [...atriumClient.som.getNodeByName(n).scale]", z) == [1.5, 1.5, 1.5] and v.ev("(n) => [...atriumClient.som.getNodeByName(n).scale]", z) == [1.5, 1.5, 1.5], (s0, a.ev("(n) => [...atriumClient.som.getNodeByName(n).scale]", z)))
    newlog = a.ev('__beh().runner.log')[n0:]
    zlog = [l['message'] for l in newlog if l.get('node') == z]
    print('   new log lines for', z, zlog)
    mat_sent = [m for m in of(a.ws, 'set', '>') if m.get('node') == z and 'material' in json.dumps(m)]
    check('4 the material write is inert: translation unchanged, nothing refused or thrown, no material set on the wire', tr(a, z) == [2, 0.5, -3] and not any('refused' in m or 'threw' in m or 'disabled' in m for m in zlog) and not mat_sent, (tr(a, z), zlog, mat_sent))
    check('4 the engine stays live', engine(a, z)['live'] is True and engine(a, z)['reason'] is None, engine(a, z))
    # the second half: the same material pointer READ by a running node is refused at import, naming the reference and its consumer
    a.edit_on(); z2 = add_cube(a); a.ev(MOVE, {'name': z2, 't': [2, 0.5, -4.5]}); a.page.wait_for_timeout(300)
    r4b = import_graph(a, z2, gltf_doc(G4b, ['Own']), 'partial-read.gltf', {'Own (node)': z2}, save=False)
    st4b = r4b['mapped']['status']; print('   G4b status:', st4b, '| save disabled:', r4b['mapped']['save_disabled'])
    check('4 the material pointer read by a running node is refused at import, naming the reference and its consumer', f'the reference {MAT} (node 2\'s pointer) is read by math/extract4 at node 3' in st4b and "can't survive the import" in st4b and r4b['mapped']['save_disabled'] is True, st4b)
    check('4 ... and nothing was saved onto that cube', leaf(a, z2) is None, leaf(a, z2))
    a.page.click('#ep-import-close'); edit_off(a)

    print('\n== 7. XSS: HTML in the file name, node names, an op name, an event id, a variable name')
    EVIL = '<img src=x onerror="window.__xss=1">'
    G7 = graph([
        on_select(0) | {'flows': {'out': flow(1)}},
        {'op': 'ext/' + 'thing', 'extension': 'EXT_probe', 'flows': {'out': flow(2)}},
        setter(VIS_PTR.format(i=0), 'bool', lit('bool', False)),
    ], variables=[{'type': T['float'], 'value': [1.0], 'name': EVIL}], events=[{'id': 'ev/ok', 'name': EVIL}])
    G7['declarations'][1]['op'] = EVIL       # the op NAME is HTML; the rule refuses it, and the panel must show that as text
    a.edit_on(); w = add_cube(a); a.ev(MOVE, {'name': w, 't': [3.5, 0.5, -3]}); a.page.wait_for_timeout(300)
    r7 = import_graph(a, w, gltf_doc(G7, [EVIL + 'own']), EVIL + '.gltf', {EVIL + 'own (node)': w}, save=False)
    pt = r7['mapped']; print('   panel:', json.dumps({k: pt[k] for k in ('file', 'status', 'rows')})[:600])
    html = a.ev("document.getElementById('ep-import-panel').innerHTML")
    check('7 the file name shows as text', pt['file'] == EVIL + '.gltf')
    check('7 the node name shows as text in the mapping row', pt['rows'] and pt['rows'][0]['label'] == EVIL + 'own (node)', pt['rows'])
    check('7 the op name reaches the status as text (the rule refuses it, naming the reason)', EVIL in (pt['status'] or '') or 'refuses' in (pt['status'] or '') or 'operation' in (pt['status'] or ''), pt['status'])
    check('7 nothing executed: no <img> inside the panel, window.__xss unset, the text is escaped in the DOM', a.ev("document.querySelectorAll('#ep-import-panel img').length") == 0 and a.ev('window.__xss') is None and '&lt;img' in html, (a.ev("document.querySelectorAll('#ep-import-panel img').length"), a.ev('window.__xss')))
    # a graph whose op names are legal but whose event id is HTML: refused by the rule, shown as text
    G7b = graph([on_select(0) | {'flows': {'out': flow(1)}}, {'op': 'event/send', 'configuration': {'event': {'value': [0]}}}], events=[{'id': EVIL}])
    a.page.set_input_files('#ep-import-file', {'name': 'evil-event.gltf', 'mimeType': 'application/json', 'buffer': gltf_doc(G7b, ['own'])}); a.page.wait_for_timeout(400)
    try: a.page.select_option("#ep-import-mapping select[aria-label='own (node) target']", label=w)
    except Exception as e: print('   (no mapping row to set:', str(e)[:80], ')')
    a.page.wait_for_timeout(300); st = a.ev("document.getElementById('ep-import-status').textContent")
    print('   event-id status:', st)
    check('7 an HTML event id: refused, shown as text, nothing executed', a.ev("document.querySelectorAll('#ep-import-panel img').length") == 0 and a.ev('window.__xss') is None and st != 'Every reference is mapped.', st)
    a.page.click('#ep-import-close'); edit_off(a)

    print('\n== 8. restart from the saved document')
    a.page.wait_for_timeout(4500)          # the autosave debounce (3 s in this harness)
    saved = doc_leaf(a, slug, x); saved_z = doc_leaf(a, slug, z)
    check('8 before the restart, the saved document holds both imported graphs, enabled', (saved.get('beh') or {}).get('enabled') is True and (saved_z.get('beh') or {}).get('enabled') is True, (saved.get('keys'), (saved.get('beh') or {}).get('enabled'), (saved_z.get('beh') or {}).get('enabled')))
    sig = {'x': saved.get('beh'), 'z': saved_z.get('beh')}
    log_before = server_log(a)
    a.close(); v.close()
    # kill the harness (its SIGTERM handler kills the real server) and bring it back on the SAME database
    subprocess.run(['pkill', '-f', 'signin-sync/authserver.mjs']); time.sleep(1.5)
    env = dict(os.environ, KEEP_DB='1', HOOKS='1', HARNESS_ROOT=ROOT, ATRIUM_AUTOSAVE_DEBOUNCE_MS='3000', STALE_ROOT=os.environ.get('STALE_ROOT', '/tmp/ah-base'))
    logf = open('/tmp/authserver-4d.log', 'a')
    p = subprocess.Popen(['node', os.path.join(REPO, 'devtasks/harness/checks/signin-sync/authserver.mjs')], env=env, stdout=logf, stderr=subprocess.STDOUT, start_new_session=True)
    for _ in range(60):
        time.sleep(0.5)
        if 'listening 8444' in open('/tmp/authserver-4d.log').read().split('listening 8443')[-1]: break
    time.sleep(0.5)
    a = owner_tab(octx, 'A'); print('   A reconnected', a.connect(W)); v = Tab(vctx, 'V'); print('   V reconnected', v.connect(W)); a.page.wait_for_timeout(1500)
    log_after = server_log(a)
    check('8 the owner is signed in across the restart (the session survived in the kept database)', a.ev('atriumClient.canEdit') is True and a.ev(HOST)['active'] is True, (a.ev('atriumClient.canEdit'), a.ev(HOST)))
    check('8 every imported graph is back, byte for byte', leaf(a, x) == sig['x'] and leaf(a, z) == sig['z'], (leaf(a, x) == sig['x'], leaf(a, z) == sig['z']))
    check('8 healing logged nothing (no dropped/malformed behaviour lines after the restart)', 'dropped' not in log_after and 'malformed' not in log_after, [l for l in log_after.splitlines() if 'dropped' in l or 'malformed' in l][:3])
    print('   heal lines:', [l for l in log_after.splitlines() if '[world] healed' in l][-3:])
    print('   engines', engine(a, x), engine(a, z), '| log', rlog(a, 6))
    check("8 check 4's graph ran again on load (the start-on-load note is true): live, Partially supported, nothing refused", engine(a, z)['live'] is True and ' '.join(lines(a, z) or []).startswith('Partially supported') and not any(l.get('node') == z and ('refused' in l['message'] or 'threw' in l['message']) for l in a.ev('__beh().runner.log')), (engine(a, z), lines(a, z), rlog(a, 8)))
    check('8 check 1\'s graph runs: a visitor click hides the target', (click_node(v, x), wait_vis(v, y, False, 3000))[1] and a.ev(VIS, y)['obj'] is False, (a.ev(VIS, y), v.ev(VIS, y)))
    wait_vis(v, y, True, 4000)
    check("8 ... and shows it again", a.ev(VIS, y)['obj'] is True and v.ev(VIS, y)['obj'] is True)
    print('\npage errors: A', a.errors[:3], '| V', v.errors[:3])
    br.close()
print('\nFAILS:', fails or 'none'); sys.exit(1 if fails else 0)
