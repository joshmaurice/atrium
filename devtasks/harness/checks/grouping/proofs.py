# grouping proofs (HANDOFF-grouping.md §4): break each mechanism alone, run its
# test file alone under timeout 180, restore. `python3 proofs.py [index ...]`.
import subprocess, shutil, os, sys, tempfile
BAK = os.path.join(tempfile.mkdtemp(), 'original')
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../../..'))
S='packages/server/src/session.js'; U='apps/client/src/edit-undo.js'; A='apps/client/src/app.js'; SOM='packages/som/src/SOMDocument.js'
PROOFS = [
 ('the cycle check', SOM, "if (p === node._node) return { ok: false, code: 'INVALID_VALUE', message: 'a node can’t go inside itself' }", "if (false) return null",
   ['packages/som/test/reparent.test.js', 'packages/server/test/grouping.test.js']),
 ('the bounds', S, "  const bound = treeBoundsProblem(moveCounts(node, parent))\n", "  const bound = null\n", ['packages/server/test/grouping.test.js']),
 ('the behaviour rule', S, "  if (behaviorAncestorsChange(node, parent)) {", "  if (false) {", ['packages/server/test/grouping.test.js']),
 ('the stale send refusal', S, "            // layer, before authorizeSend.\n            if (isStaleEditor(session.capabilities)) {", "            // layer, before authorizeSend.\n            if (false) {", ['packages/server/test/grouping.test.js']),
 ('the stale host refusal (election at the hello)', S, "            if (canEdit && session.capabilities?.scriptRunner === 3 &&\n                !isStaleEditor(session.capabilities) && scriptHost.sessionId === null) {", "            if (canEdit && session.capabilities?.scriptRunner === 3 &&\n                scriptHost.sessionId === null) {", ['packages/server/test/grouping.test.js']),
 ('the stale host refusal (canRunBehaviors)', S, "    return session?.canEdit === true && session?.capabilities?.scriptRunner === 3 &&\n      !isStaleEditor(session?.capabilities)", "    return session?.canEdit === true && session?.capabilities?.scriptRunner === 3", ['packages/server/test/grouping.test.js']),
 ('the stale hello refusal', S, "            if (refuseStaleHello && isStaleEditor(msg.capabilities)) {", "            if (false) {", ['packages/server/test/grouping.test.js']),
 ('the exact Undo values', U, "      translation: copyValue(place.translation),", "      translation: copyValue(place.translation)?.map((v) => v + 1e-9),", ['apps/client/tests/grouping-undo.test.js']),
 ('the parent re-read (openRemovalWindow)', U, "    entry.parent = parentHandle(node)\n    deleteWindow = {", "    deleteWindow = {", ['apps/client/tests/grouping-undo.test.js']),
 ('the parent re-read (reCapture)', U, "    req.parent = parentHandle(node)\n", "", ['apps/client/tests/grouping-undo.test.js']),
 ('the wait for the group’s add', U, "            if (name) { retried = true; addDescriptor = { ...addDescriptor, name }; return 'retry' }", "            if (name) { retried = true; addDescriptor = { ...addDescriptor, name }; return 'next' }", ['apps/client/tests/grouping-undo.test.js']),
 ('the handle re-pointing (r5)', U, "          repoint(entry.handle, fresh)\n          return 'next'", "          return 'next'", ['apps/client/tests/grouping-undo.test.js']),
 ('the delete through the capture window', U, "    if (window) {\n      openRemovalWindow(inFlight.entry, inFlight.direction, node)", "    if (false) {\n      openRemovalWindow(inFlight.entry, inFlight.direction, node)", ['apps/client/tests/grouping-undo.test.js']),
 ('the cancel (not end) on som:reparent', A, "    activeGesture.cancel()\n    activeGesture = null\n    hold.clear()", "    activeGesture.end()\n    activeGesture = null\n    hold.clear()", ['apps/client/tests/grouping-wiring.test.js']),
 ('the hold released by the answer', A, "  if (compositeHold && !undo.inFlight()) { compositeHold = false; hold.clear() }", "", ['apps/client/tests/grouping-wiring.test.js']),
 ('the drag’s end on som:reparent', A, "  if (node && node === selected && gizmo?.dragging) endHandleDrag()\n", "", ['apps/client/tests/grouping-wiring.test.js']),
 ('the breadcrumb refresh on som:reparent', A, "  if (selected) {\n    attachSelected()\n    refreshEditPanel()\n  }\n  if (inspected) renderInspectPanel()\n  emptyKey = null", "  if (inspected) renderInspectPanel()\n  emptyKey = null", ['apps/client/tests/grouping-wiring.test.js']),
 ('c3: records marked remote before the cancel', A, "    for (const f of ['translation', 'rotation', 'scale']) editTracker.remoteSet(node, f, node[f] == null ? node[f] : [...node[f]])\n", "", ['apps/client/tests/grouping-wiring.test.js']),
 ('c1: a focused Move to rebuilt', A, "  else if (typeof document !== 'undefined' && document.activeElement === epMoveTo) syncMoveOptions()\n", "", ['apps/client/tests/grouping-wiring.test.js']),
 ('c5: another tab’s add/remove refreshes Empty groups', A, "emptyKey = null; refreshEmptyGroups() })", "emptyKey = null })", ['apps/client/tests/grouping-wiring.test.js']),
]
only = sys.argv[1:]
for i, (what, f, old, new, tests) in enumerate(PROOFS):
    if only and str(i) not in only: continue
    src = open(f).read()
    n = src.count(old)
    if n != 1:
        print(f'{i:2} {what}: the pattern occurs {n} times — NOT RUN'); continue
    shutil.copy(f, BAK)
    try:
        open(f, 'w').write(src.replace(old, new))
        res = []
        for t in tests:
            r = subprocess.run(['timeout', '180', 'node', '--test', '--test-reporter=tap', t], capture_output=True, text=True)
            fails = [l.strip() for l in r.stdout.splitlines() if l.startswith('    not ok') or l.startswith('        not ok')]
            tot = [l for l in r.stdout.splitlines() if l.startswith('# fail')]
            res.append(f"{t.split('/')[-1]}: {tot[0] if tot else 'rc ' + str(r.returncode)}" + (f" — {fails[0][:110]}" if fails else ''))
        print(f'{i:2} {what}:\n     ' + '\n     '.join(res))
    finally:
        shutil.copy(BAK, f)
