// Ungroup's hint judges the group with { credit: false }; the removal capture
// (prepareRestore, the Delete capture's own rule) judges the credit. A group
// with a malformed legacy credit: Ungroup is offered, the group is deleted,
// and the Ungroup is not recorded (no ask-first).
import { test } from 'node:test'
import assert from 'node:assert/strict'
const R = '/home/claude/atrium/'
const { NodeIO } = await import(R + 'packages/som/node_modules/@gltf-transform/core/dist/index.modern.js')
const { SOMDocument } = await import(R + 'packages/som/src/index.js')
const { createEditUndo } = await import(R + 'apps/client/src/edit-undo.js')
const { prepareRestore, ownNodeProblem } = await import(R + 'apps/client/src/edit-duplicate.js')
const { ungroupPlan } = await import(R + 'apps/client/src/edit-group.js')

test('a malformed credit on a group: Ungroup offered, then not recorded', async () => {
  const som = new SOMDocument(await new NodeIO().read(R + 'tests/fixtures/space.gltf'))
  const lamp = som.getNodeByName('lamp-01')
  lamp._node.setExtras({ ...(lamp._node.getExtras() ?? {}), atrium: { origin: 'not-an-object' } })
  const own = ownNodeProblem(lamp._node, { credit: false })        // what app.js ungroupHint asks
  console.log('ungroupHint\'s ownNodeProblem(credit:false):', own)
  const full = ownNodeProblem(lamp._node)                            // the Delete capture's rule
  console.log('the capture\'s rule (credit on):', full?.reason)
  let seq = 0; const pend = []; const msgs = []
  const undo = createEditUndo({
    getNodeByName: (n) => som.getNodeByName(n), getObjectByName: (n) => som.getObjectByName(n),
    checkNewName: (n, x) => som.checkNewName(n, x), prepareRestore, trees: () => true,
    sendTransform: () => null, rename: () => null,
    structural: (req, dir) => { const s = ++seq; pend.push({ s, kind: 'structural', req, dir }); return s },
    move: (node, value) => { const s = ++seq; pend.push({ s, kind: 'move', name: node.name, value }); return s },
    message: (t) => msgs.push(t),
  })
  assert.equal(undo.ungroup(lamp, ungroupPlan(lamp)), true)
  while (pend.length) {
    const p = pend.shift()
    if (p.kind === 'move') {
      const n = som.getNodeByName(p.name); som.reparentNode(n, null, p.value)
      undo.onAccepted(p.s, { applied: true, landed: null })
    } else {
      som.getNodeByName(p.req.name).dispose()
      undo.onStructureAnswer({ request: { seq: p.s, undo: p.dir, name: p.req.name }, status: 'accepted', removedMessage: null })
    }
  }
  console.log('lamp-01 still there:', !!som.getNodeByName('lamp-01'), ' undoCount:', undo.undoCount, ' messages:', msgs)
  assert.equal(own, null, 'Ungroup is offered')
  assert.equal(undo.undoCount, 1, 'the Ungroup is recorded (or was asked first)')
})
