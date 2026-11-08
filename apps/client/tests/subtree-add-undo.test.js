// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// subtree-add T5 (devtasks/PREBRIEF-subtree-add.md FINAL Rev 2, §5): the Undo
// engine with TREES, on a REAL SOMDocument (the fixtures' `lamp-01` and
// `Columns`). The harness plays the server: a structural delete disposes the
// node, a re-add ingests the descriptor with the real `ingestNode`, and each
// answer reaches the engine as app.js's handlers deliver it.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createEditUndo, SHARED_MATERIAL_NOTE, PART_NOT_ADDRESSABLE } from '../src/edit-undo.js'
import { prepareRestore, prepareDuplicate } from '../src/edit-duplicate.js'

const { NodeIO, Document } = await import('../../../packages/som/node_modules/@gltf-transform/core/dist/index.modern.js')
const { SOMDocument } = await import('../../../packages/som/src/SOMDocument.js')
const fixture = (name) => fileURLToPath(new URL(`../../../tests/fixtures/${name}`, import.meta.url))

async function world(file = 'space.gltf') {
  const doc = await new NodeIO().read(fixture(file))
  return new SOMDocument(doc)
}

function harness(som, { trees = true } = {}) {
  let seq = 0
  const info = new Map()
  const messages = []
  const sent = []
  const undo = createEditUndo({
    getNodeByName: (n) => som.getNodeByName(n),
    getObjectByName: (n) => som.getObjectByName(n),
    checkNewName: (n, node) => som.checkNewName(n, node),
    prepareRestore,
    trees: () => trees,
    sendTransform: (node, field, value) => {
      node[field] = [...value]
      const s = ++seq
      info.set(s, { kind: 'transform' })
      sent.push({ seq: s, kind: 'transform', node, field, value })
      return s
    },
    rename: () => null,
    structural: (req, dir) => {
      const s = ++seq
      info.set(s, { kind: 'structural', req, dir })
      sent.push({ seq: s, kind: `structural-${req.kind}`, req })
      return s
    },
    message: (t) => messages.push(t),
  })
  /** The server's answer: the world changes first (as its broadcast arrives first), then the engine hears. */
  function answer(s) {
    const i = info.get(s)
    if (i.kind === 'transform') { undo.onAccepted(s); return }
    const request = i.kind === 'structural' ? { seq: s, undo: i.dir, name: i.req.name } : { seq: s, name: i.name }
    const kind = i.kind === 'structural' ? i.req.kind : i.kind
    if (kind === 'delete' || kind === 'plain-delete') som.getNodeByName(request.name).dispose()
    else som.scene.addChild(som.ingestNode(i.kind === 'structural' ? i.req.descriptor : i.descriptor))
    undo.onAccepted(s)
    undo.onStructureAnswer({ request, status: 'accepted', removedMessage: null })
  }
  function clickDelete(node) {
    const cap = undo.capture(node)
    const s = ++seq
    info.set(s, { kind: 'plain-delete', name: node.name })
    undo.registerDelete(s, { node, name: node.name, descriptor: cap.ok ? cap.descriptor : null })
    return { seq: s, cap }
  }
  function duplicate(node, name) {
    const r = prepareDuplicate(node._node, { name, isFree: (n) => som.checkNewName(n).ok, trees })
    assert.equal(r.ok, true, r.reason)
    const s = ++seq
    info.set(s, { kind: 'plain-add', descriptor: r.descriptor })
    undo.registerAdd(s, { name, duplicate: true })
    return { seq: s, descriptor: r.descriptor }
  }
  function settle(node, changes) {
    undo.onTransformsSettled([{ node, changes }], { acceptedOwnSend: true, remote: false, rejected: false })
  }
  const last = () => sent.at(-1)
  return { undo, answer, clickDelete, duplicate, settle, messages, sent, last }
}

const namesUnder = (node) => node.children.map((c) => c.name).sort()

describe('T5: Delete, Undo and Redo of a group', () => {
  test('Delete of lamp-01 asks nothing (its capture succeeds) and is recorded; Undo restores it whole under its names and ids; Redo removes it', async () => {
    const som = await world()
    const h = harness(som)
    const lamp = som.getNodeByName('lamp-01')
    const shadeId = crypto.randomUUID()
    som.getNodeByName('lamp-shade').extras = { atrium: { objectId: shadeId } }
    const del = h.clickDelete(lamp)
    assert.equal(del.cap.ok, true, 'restorable: Delete asks nothing (SA-L4 (a))')
    h.answer(del.seq)
    assert.equal(som.getNodeByName('lamp-01'), null)
    assert.equal(h.undo.label('undo'), 'Undo Delete “lamp-01”')
    assert.equal(h.undo.run('undo'), true)
    assert.equal(h.last().kind, 'structural-add')
    h.answer(h.last().seq)
    const back = som.getNodeByName('lamp-01')
    assert.ok(back && back !== lamp, 'a new node, the same object')
    assert.deepEqual(namesUnder(back), ['lamp-shade', 'lamp-stand'])
    assert.equal(som.getNodeByName('lamp-shade').extras.atrium.objectId, shadeId, 'ids kept')
    assert.equal(h.undo.run('redo'), true)
    assert.equal(h.last().kind, 'structural-delete')
    h.answer(h.last().seq)
    assert.equal(som.getNodeByName('lamp-01'), null)
    assert.equal(som.getNodeByName('lamp-shade'), null)
  })

  test('without trees (an older server) the group can’t be captured: Delete asks, and nothing is recorded', async () => {
    const som = await world()
    const h = harness(som, { trees: false })
    const del = h.clickDelete(som.getNodeByName('lamp-01'))
    assert.equal(del.cap.ok, false)
    h.answer(del.seq)
    assert.equal(h.undo.undoCount, 0)
  })

  test('a part moved by another tab while the delete is pending is re-captured: Undo brings it back where it was moved', async () => {
    const som = await world()
    const h = harness(som)
    const del = h.clickDelete(som.getNodeByName('lamp-01'))
    som.getNodeByName('lamp-shade').translation = [0, 3, 0]   // another tab's move
    h.undo.reCapture()                                          // app.js: som:set
    h.answer(del.seq)
    h.undo.run('undo')
    h.answer(h.last().seq)
    assert.deepEqual([...som.getNodeByName('lamp-shade').translation], [0, 3, 0])
  })

  test('M3: a part another tab removes while our delete is pending stays removed after Undo (a click delete)', async () => {
    const som = await world()
    const h = harness(som)
    const del = h.clickDelete(som.getNodeByName('lamp-01'))
    som.getNodeByName('lamp-shade').dispose()                   // another tab's remove
    h.undo.reCapture()                                          // app.js: som:remove (new)
    h.answer(del.seq)
    h.undo.run('undo')
    h.answer(h.last().seq)
    assert.deepEqual(namesUnder(som.getNodeByName('lamp-01')), ['lamp-stand'], 'the shade isn’t brought back')
  })

  test('M3: the same through an undo’s removal window (openRemovalWindow): Redo doesn’t bring the removed part back', async () => {
    const som = await world()
    const h = harness(som)
    const dup = h.duplicate(som.getNodeByName('lamp-01'), 'lamp-01 copy')
    h.answer(dup.seq)
    assert.ok(som.getNodeByName('lamp-01 copy'))
    h.undo.run('undo')                                          // removes the copy: a removal window
    som.getNodeByName('lamp-shade copy').dispose()              // another tab removes a part meanwhile
    h.undo.reCapture()
    h.answer(h.last().seq)
    h.undo.run('redo')
    h.answer(h.last().seq)
    assert.deepEqual(namesUnder(som.getNodeByName('lamp-01 copy')), ['lamp-stand copy'])
  })

  test('a part added to the group by another tab after the entry was recorded: the redo-of-delete is "changed elsewhere"', async () => {
    const som = await world()
    const h = harness(som)
    const del = h.clickDelete(som.getNodeByName('lamp-01'))
    h.answer(del.seq)
    h.undo.run('undo')
    h.answer(h.last().seq)
    const lamp = som.getNodeByName('lamp-01')
    lamp.addChild(som.ingestNode({ name: 'lamp-cord' }))         // another tab adds a part
    assert.equal(h.undo.run('redo'), false)
    assert.match(h.messages.at(-1), /was changed elsewhere/)
  })

  test('S3: an older entry for a part (a move of the Alt-clicked shade) still undoes after the group is deleted and restored', async () => {
    const som = await world()
    const h = harness(som)
    const shade = som.getNodeByName('lamp-shade')
    const from = [...shade.translation]
    shade.translation = [0, 2.5, 0]
    h.settle(shade, [{ field: 'translation', from, to: [0, 2.5, 0] }])
    const del = h.clickDelete(som.getNodeByName('lamp-01'))
    h.answer(del.seq)
    h.undo.run('undo')                                          // the delete
    h.answer(h.last().seq)
    const freshShade = som.getNodeByName('lamp-shade')
    assert.notEqual(freshShade, shade)
    assert.equal(h.undo.run('undo'), true, 'the move’s entry is alive')
    assert.equal(h.last().node, freshShade, 'and points at the shade that came back')
    h.answer(h.last().seq)
    assert.deepEqual([...freshShade.translation], from)
  })

  test('S6: a group with a part whose name another object holds first can’t be captured; Delete asks', () => {
    const doc = new Document()
    const scene = doc.createScene()
    scene.addChild(doc.createNode('knob'))                      // registered first: it holds the name
    const g = doc.createNode('door')
    g.addChild(doc.createNode('knob'))
    scene.addChild(g)
    const som = new SOMDocument(doc)
    const h = harness(som)
    const cap = h.undo.capture(som.getNodeByName('door'))
    assert.equal(cap.ok, false)
    assert.equal(cap.reason, PART_NOT_ADDRESSABLE)
  })

  test('the shared-material note for Columns (its marble is also the fountain pillar’s), through the click delete’s own call', async () => {
    const som = await world('atrium.gltf')
    const h = harness(som)
    const del = h.clickDelete(som.getNodeByName('Columns'))
    assert.equal(del.cap.ok, true, del.cap.reason)
    h.answer(del.seq)
    assert.equal(h.undo.label('undo'), `Undo Delete “Columns” ${SHARED_MATERIAL_NOTE}`)
    h.undo.run('undo')
    h.answer(h.last().seq)
    // the restored columns share one marble among themselves, not with the pillar
    const mats = new Set(som.getNodeByName('Columns').children.map((c) => c._node.getMesh().listPrimitives()[0].getMaterial()))
    assert.equal(mats.size, 1)
  })
})
