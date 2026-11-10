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
 # the code check of de33cf8..9716caf (HANDOFF §7)
 ('code check 5: the cycle checked before the counts', S, "  const structural = world.som.reparentProblem(node, parent)\n  if (structural) return { code: structural.code, message: structural.message }\n  const bound = treeBoundsProblem(moveCounts(node, parent))\n  if (bound) return { code: 'INVALID_VALUE', message: `${TREE_BOUNDS_MESSAGE} (${bound})` }\n", "  const bound = treeBoundsProblem(moveCounts(node, parent))\n  if (bound) return { code: 'INVALID_VALUE', message: `${TREE_BOUNDS_MESSAGE} (${bound})` }\n  const structural = world.som.reparentProblem(node, parent)\n  if (structural) return { code: structural.code, message: structural.message }\n", ['packages/server/test/grouping.test.js']),
 ('code check 1: structural sends nothing while the slot is taken', A, "    if (structure.pending) return null\n", "", ['apps/client/tests/grouping-wiring.test.js']),
 ('code check 1: an unsent later step stops the composite', U, "      if (c.phase > 0) {", "      if (false) {", ['apps/client/tests/grouping-undo.test.js']),
 ('code check 2: Ungroup waits and re-checks after the dialog', A, "  if (!ask.record) await new Promise((r) => setTimeout(r, AFTER_DIALOG_MS))\n", "", ['apps/client/tests/grouping-wiring.test.js']),
 ('code check 2: Move to recomputes its value after the dialog', A, "    value = moveValue(node, target)\n    if (!value.ok) { showEditError(`Couldn’t move: ${MOVE_REASONS[value.rule]}`); return }\n  }", "  }", ['apps/client/tests/grouping-wiring.test.js']),
 ('code check 3: Ungroup’s rule checks the credit', A, "  const own = ownNodeProblem(node._node)\n", "  const own = ownNodeProblem(node._node, { credit: false })\n", ['apps/client/tests/grouping-wiring.test.js']),
 ('code check 4: Delete asks first at a bound', A, "  const tooLarge = capture.ok && groupingAllowed() && !!deleteUndoProblem(node)", "  const tooLarge = false", ['apps/client/tests/grouping-wiring.test.js']),
 ('code check 1 (operator’s go): the Model form’s Save gated', 'apps/client/src/model-form.js', "    return state.open && Boolean(state.result) && !state.checking && !state.saving && dispatchAllowed()", "    return state.open && Boolean(state.result) && !state.checking && !state.saving", ['apps/client/tests/model-form.test.js']),
 ('code check 1 (operator’s go): refreshEditActions re-renders the form', A, "  if (modelForm?.isOpen()) modelForm.render()\n", "", ['apps/client/tests/grouping-wiring.test.js']),
 ('code check 4: a re-add past a bound is not started', U, "      if (p && treeBoundsProblem(moveCounts(null, p, descriptorCounts(entry.descriptor)))) {", "      if (false) {", ['apps/client/tests/grouping-undo.test.js']),
 # the outside code review (Fable 5.2, Rev 2, at 98f916c6; HANDOFF §8)
 ('review S-1: a same-tree Move to predicts its Undo', 'apps/client/src/edit-group.js', "    if (node.parent === target) return null\n    return treeBoundsProblem({ before: moveCounts(node, target).after, after: treeCounts(oldTop) })", "    return null", ['apps/client/tests/grouping-undo.test.js']),
 ('review S-2: Empty groups rescanned only when its key is cleared', A, "  if (emptyKey === null) refreshEmptyGroups()\n}", "  refreshEmptyGroups()\n}", ['apps/client/tests/grouping-wiring.test.js']),
 ('review N-1: the engine refuses a move into a model', U, "    if (parent && parent.extras?.atrium?.model != null) return 'a model can’t hold objects'\n", "", ['apps/client/tests/grouping-undo.test.js']),
 ('review N-1: a part of a model can’t be moved out', A, "  if (hasModel(node.parent)) return 'It is part of a model'\n", "", ['apps/client/tests/grouping-wiring.test.js']),
 ('review N-2: no remove while something is inside', U, "    if (node.children.length > 0) { inFlight.unsentText = 'something else is inside it now'; return false }\n", "", ['apps/client/tests/grouping-undo.test.js']),
 ('review N-4: the moved parts are the accepted ones', U, "        const moved = entry.parts.filter((p) => landed.has(p.handle.node))", "        const moved = entry.parts.filter((p) => !refused(outs).some((o) => o.node === p.handle.node))", ['apps/client/tests/grouping-undo.test.js']),
 ('review N-6: an unsent moves phase names every part', U, "      const stayed = parts.filter((p) => !landed.has(p.handle.node))", "      const stayed = parts.filter((p) => refused(outs).some((o) => o.node === p.handle.node))", ['apps/client/tests/grouping-undo.test.js']),
 ('review N-5: the Move to header acts on nothing', A, "  if (epMoveTo.value === '') return   // the header (the outside review's N-5: Number('') is 0)\n", "", ['apps/client/tests/grouping-wiring.test.js']),
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
