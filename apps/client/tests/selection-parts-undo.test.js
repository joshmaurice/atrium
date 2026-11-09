// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// selection-parts T11 (PREBRIEF-selection-parts.md FINAL Rev 2, §4, §5): the
// Undo engine with PARTS, on a REAL SOMDocument (space.gltf's `lamp-01`). The
// harness plays the server: a delete disposes the node BEFORE the engine hears
// (as AtriumClient._onRemove does), a re-add ingests the descriptor UNDER the
// parent it names (as world.addNode and _onAdd do), and a parent that isn't
// there is refused NODE_NOT_FOUND, as the server refuses it.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createEditUndo, sameCanonical, GROUP_NOT_ADDRESSABLE, SHARED_MATERIAL_NOTE } from '../src/edit-undo.js'
import { prepareRestore, prepareDuplicate, buildDescriptor } from '../src/edit-duplicate.js'

const { NodeIO, Document } = await import('../../../packages/som/node_modules/@gltf-transform/core/dist/index.modern.js')
const { SOMDocument } = await import('../../../packages/som/src/SOMDocument.js')
const fixture = (name) => fileURLToPath(new URL(`../../../tests/fixtures/${name}`, import.meta.url))

async function world(file = 'space.gltf') {
  return new SOMDocument(await new NodeIO().read(fixture(file)))
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
    sendTransform: () => null,
    rename: () => null,
    structural: (req, dir) => {
      const s = ++seq
      info.set(s, { kind: 'structural', req, dir })
      sent.push({ seq: s, kind: `structural-${req.kind}`, req })
      return s
    },
    message: (t) => messages.push(t),
  })
  function add(descriptor, parentName) {
    // as world.addNode: an empty name is no parent (`if (parentName)`)
    if (parentName) {
      const parent = som.getNodeByName(parentName)
      if (!parent) return { ok: false, text: `NODE_NOT_FOUND: ${parentName}` }
      parent.addChild(som.ingestNode(descriptor))
    } else {
      som.scene.addChild(som.ingestNode(descriptor))
    }
    return { ok: true }
  }
  /** The server's answer: the world changes first, then the engine hears. */
  function answer(s) {
    const i = info.get(s)
    const structural = i.kind === 'structural'
    const request = structural ? { seq: s, undo: i.dir, name: i.req.name } : { seq: s, name: i.name }
    const kind = structural ? i.req.kind : i.kind
    if (kind === 'delete' || kind === 'plain-delete') {
      som.getNodeByName(request.name).dispose()
    } else {
      const r = add(structural ? i.req.descriptor : i.descriptor, structural ? i.req.parent : i.parent)
      if (!r.ok) {
        undo.onStructureAnswer({ request, status: 'rejected', removedMessage: null }, r.text)
        return
      }
    }
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
  /** A Duplicate in place: the copy under the original's parent, as app.js sends it. */
  function duplicateInPlace(node, name) {
    const r = prepareDuplicate(node._node, { name, isFree: (n) => som.checkNewName(n).ok, trees })
    assert.equal(r.ok, true, r.reason)
    const s = ++seq
    info.set(s, { kind: 'plain-add', descriptor: r.descriptor, parent: node.parent?.name ?? null })
    undo.registerAdd(s, { name, duplicate: true, expectParent: node.parent ?? null })
    return { seq: s }
  }
  const last = () => sent.at(-1)
  return { undo, answer, clickDelete, duplicateInPlace, messages, last, info }
}

const parentName = (som, name) => som.getNodeByName(name)?.parent?.name ?? null

describe('T11: a part’s Delete, Undo and Redo', () => {
  test('Delete of the shade asks nothing; Undo puts it back under lamp-01 with its name, id and local TRS', async () => {
    const som = await world()
    const h = harness(som)
    const id = crypto.randomUUID()
    const shade = som.getNodeByName('lamp-shade')
    shade.extras = { atrium: { objectId: id } }
    const before = [...shade.translation]
    const del = h.clickDelete(shade)
    assert.equal(del.cap.ok, true, 'restorable: no question (W6)')
    h.answer(del.seq)
    assert.equal(som.getNodeByName('lamp-shade'), null)
    assert.equal(h.undo.run('undo'), true)
    assert.equal(h.last().req.parent, 'lamp-01', 'the re-add names the parent (read at the click, must-fix 2)')
    h.answer(h.last().seq)
    assert.equal(parentName(som, 'lamp-shade'), 'lamp-01')
    assert.equal(som.getNodeByName('lamp-shade').extras.atrium.objectId, id)
    assert.deepEqual([...som.getNodeByName('lamp-shade').translation], before)
    assert.equal(h.undo.run('redo'), true)
    h.answer(h.last().seq)
    assert.equal(som.getNodeByName('lamp-shade'), null)
    assert.equal(h.undo.run('undo'), true)
    h.answer(h.last().seq)
    assert.equal(parentName(som, 'lamp-shade'), 'lamp-01')
  })

  test('Redo of the shade’s Duplicate in place puts the copy back under lamp-01 (§9.5 M1)', async () => {
    const som = await world()
    const h = harness(som)
    const dup = h.duplicateInPlace(som.getNodeByName('lamp-shade'), 'lamp-shade copy')
    h.answer(dup.seq)
    assert.equal(parentName(som, 'lamp-shade copy'), 'lamp-01')
    assert.equal(h.undo.label('undo'), 'Undo Duplicate “lamp-shade copy”')
    h.undo.run('undo'); h.answer(h.last().seq)
    assert.equal(som.getNodeByName('lamp-shade copy'), null)
    h.undo.run('redo')
    assert.equal(h.last().req.parent, 'lamp-01')
    h.answer(h.last().seq)
    assert.equal(parentName(som, 'lamp-shade copy'), 'lamp-01')
    assert.deepEqual(h.messages, [])
  })

  test('the lamp’s own older Duplicate entry still undoes after a part’s delete and Undo (SP-L5 (a): child order ignored)', async () => {
    const som = await world()
    const h = harness(som)
    const dup = h.duplicateInPlace(som.getNodeByName('lamp-01'), 'lamp-01 copy')
    h.answer(dup.seq)
    // the copy's first part goes and comes back: it is now LAST among its siblings
    const first = som.getNodeByName('lamp-01 copy').children[0]
    const firstName = first.name
    const del = h.clickDelete(first)
    h.answer(del.seq)
    h.undo.run('undo'); h.answer(h.last().seq)
    assert.equal(som.getNodeByName('lamp-01 copy').children.at(-1).name, firstName, 'the part came back last')
    // the part's Delete entry is on the redo stack now; the undo stack's top is
    // the lamp copy's Duplicate, captured with the part FIRST
    assert.equal(h.undo.label('undo'), 'Undo Duplicate “lamp-01 copy”')
    const r = h.undo.run('undo')
    assert.equal(r, true, `the lamp’s Duplicate still undoes: ${h.messages.join(' | ')}`)
    h.answer(h.last().seq)
    assert.equal(som.getNodeByName('lamp-01 copy'), null)
  })

  test('a part sharing a material with a sibling: its Delete has the note, and after its restore the group\u2019s older entry is \u201cchanged elsewhere\u201d (the sharing was lost)', async () => {
    const som = await world()
    // the lamp's shade and stand share one material (as T12 keeps it within a copy)
    const shadeMat = som.getNodeByName('lamp-shade')._node.getMesh().listPrimitives()[0].getMaterial()
    som.getNodeByName('lamp-stand')._node.getMesh().listPrimitives()[0].setMaterial(shadeMat)
    const h = harness(som)
    const dup = h.duplicateInPlace(som.getNodeByName('lamp-01'), 'lamp-01 copy')
    h.answer(dup.seq)
    const shadeCopy = som.getNodeByName('lamp-shade copy')
    const del = h.clickDelete(shadeCopy)
    h.answer(del.seq)
    assert.ok(h.undo.label('undo').endsWith(SHARED_MATERIAL_NOTE), h.undo.label('undo'))
    h.undo.run('undo'); h.answer(h.last().seq)
    assert.equal(parentName(som, 'lamp-shade copy'), 'lamp-01 copy')
    assert.equal(h.undo.run('undo'), false)
    assert.equal(h.messages.at(-1), 'Can\u2019t undo: \u201clamp-01 copy\u201d was changed elsewhere.')
  })

  test('Undo after the lamp was renamed sends the new name as parent', async () => {
    const som = await world()
    const h = harness(som)
    const del = h.clickDelete(som.getNodeByName('lamp-shade'))
    h.answer(del.seq)
    som.getNodeByName('lamp-01').name = 'lamp-renamed'
    h.undo.run('undo')
    assert.equal(h.last().req.parent, 'lamp-renamed')
    h.answer(h.last().seq)
    assert.equal(parentName(som, 'lamp-shade'), 'lamp-renamed')
  })

  test('Undo after the lamp was deleted refuses with “its group was removed”', async () => {
    const som = await world()
    const h = harness(som)
    const del = h.clickDelete(som.getNodeByName('lamp-shade'))
    h.answer(del.seq)
    som.getNodeByName('lamp-01').dispose()            // another tab
    assert.equal(h.undo.run('undo'), false)
    assert.equal(h.messages.at(-1), 'Can’t undo: “lamp-shade” its group was removed.')
  })

  test('after another tab made a new lamp-01, it refuses with “replaced elsewhere”', async () => {
    const som = await world()
    const h = harness(som)
    const del = h.clickDelete(som.getNodeByName('lamp-shade'))
    h.answer(del.seq)
    som.getNodeByName('lamp-01').dispose()
    som.scene.addChild(som.ingestNode({ name: 'lamp-01' }))
    assert.equal(h.undo.run('undo'), false)
    assert.equal(h.messages.at(-1), 'Can’t undo: “lamp-shade” its group was replaced elsewhere.')
  })

  test('after the lamp was deleted and restored by our own Undo, the shade goes into the restored lamp', async () => {
    const som = await world()
    const h = harness(som)
    const delShade = h.clickDelete(som.getNodeByName('lamp-shade'))
    h.answer(delShade.seq)
    const delLamp = h.clickDelete(som.getNodeByName('lamp-01'))
    h.answer(delLamp.seq)
    h.undo.run('undo'); h.answer(h.last().seq)        // the lamp back (with its stand)
    const restored = som.getNodeByName('lamp-01')
    h.undo.run('undo')
    assert.equal(h.last().req.parent, 'lamp-01')
    h.answer(h.last().seq)
    assert.equal(som.getNodeByName('lamp-shade').parent, restored)
  })

  test('a re-add refused NODE_NOT_FOUND (renamed or removed after the send) says so', async () => {
    const som = await world()
    const h = harness(som)
    const del = h.clickDelete(som.getNodeByName('lamp-shade'))
    h.answer(del.seq)
    h.undo.run('undo')
    som.getNodeByName('lamp-01').name = 'lamp-other'     // between our check and the server's answer
    h.answer(h.last().seq)
    assert.equal(h.messages.at(-1), 'Can’t undo: “lamp-shade” its group was renamed or removed.')
  })

  test('N-4: a re-add accepted under a newer node of the group’s name says so', async () => {
    const som = await world()
    const h = harness(som)
    const del = h.clickDelete(som.getNodeByName('lamp-shade'))
    h.answer(del.seq)
    h.undo.run('undo')
    som.getNodeByName('lamp-01').dispose()                 // another tab replaces the group
    som.scene.addChild(som.ingestNode({ name: 'lamp-01' }))
    h.answer(h.last().seq)
    assert.equal(h.messages.at(-1), '“lamp-shade” went into a newer “lamp-01”: its group was replaced elsewhere.')
  })

  test('N-4: a Duplicate in place whose group another tab replaced before the answer says so', async () => {
    const som = await world()
    const h = harness(som)
    const dup = h.duplicateInPlace(som.getNodeByName('lamp-shade'), 'lamp-shade copy')
    som.getNodeByName('lamp-01').dispose()                 // another tab replaces the group
    som.scene.addChild(som.ingestNode({ name: 'lamp-01' }))
    h.answer(dup.seq)
    assert.equal(h.messages.at(-1), '“lamp-shade copy” went into a newer “lamp-01”: its group was replaced elsewhere.')
  })

  test('N-4: a re-add that landed in a newer group is recorded there: Undo and Redo go into the newer group', async () => {
    const som = await world()
    const h = harness(som)
    const del = h.clickDelete(som.getNodeByName('lamp-shade'))
    h.answer(del.seq)
    h.undo.run('undo')
    som.getNodeByName('lamp-01').dispose()
    som.scene.addChild(som.ingestNode({ name: 'lamp-01' }))
    const newer = som.getNodeByName('lamp-01')
    h.answer(h.last().seq)
    assert.equal(som.getNodeByName('lamp-shade').parent, newer)
    assert.equal(h.undo.run('redo'), true, h.messages.join(' | '))     // the Delete again
    h.answer(h.last().seq)
    assert.equal(h.undo.run('undo'), true, `not “its group was removed”: ${h.messages.join(' | ')}`)
    assert.equal(h.last().req.parent, 'lamp-01')
    h.answer(h.last().seq)
    assert.equal(som.getNodeByName('lamp-shade').parent, newer)
  })

  test('a part whose parent isn’t the node of its name can’t be captured, so its Delete asks', async () => {
    const som = await world()
    const h = harness(som)
    const shade = som.getNodeByName('lamp-shade')
    const realGet = som.getNodeByName.bind(som)
    som.getNodeByName = (n) => (n === 'lamp-01' ? null : realGet(n))   // a shadowed parent
    const cap = h.undo.capture(shade)
    assert.equal(cap.ok, false)
    assert.equal(cap.reason, GROUP_NOT_ADDRESSABLE)
  })

  test('a part of an UNNAMED group can\u2019t be captured (an empty name can\u2019t travel as parent), so its Delete asks', () => {
    const doc = new Document()
    const g = doc.createNode('').setTranslation([5, 0, 0])
    g.addChild(doc.createNode('leaf').setTranslation([0, 1, 0]))
    doc.createScene().addChild(g)
    const som = new SOMDocument(doc)
    const h = harness(som)
    assert.equal(som.getNodeByName(''), som.getNodeByName('leaf').parent, 'the SOM does register the unnamed node under ""')
    const cap = h.undo.capture(som.getNodeByName('leaf'))
    assert.equal(cap.ok, false)
    assert.equal(cap.reason, GROUP_NOT_ADDRESSABLE)
  })

  test('a part of no children Duplicates, Deletes and Undoes whatever the server level (T7)', async () => {
    const som = await world()
    const h = harness(som, { trees: false })
    const del = h.clickDelete(som.getNodeByName('lamp-shade'))
    assert.equal(del.cap.ok, true)
    h.answer(del.seq)
    h.undo.run('undo'); h.answer(h.last().seq)
    assert.equal(parentName(som, 'lamp-shade'), 'lamp-01')
  })
})

describe('T11: sameCanonical (SP-L5 (a))', () => {
  function group(materials) {
    // G with a, b, c; `materials` names each child's material (same letter, same material)
    const doc = new Document()
    const buf = doc.createBuffer()
    const mats = {}
    const G = doc.createNode('G')
    for (const [name, m] of Object.entries(materials)) {
      mats[m] ??= doc.createMaterial(m).setBaseColorFactor(m === 'red' ? [1, 0, 0, 1] : [0, 0, 1, 1])
      const pos = doc.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buf)
      G.addChild(doc.createNode(name).setMesh(doc.createMesh().addPrimitive(doc.createPrimitive().setAttribute('POSITION', pos).setMaterial(mats[m]))))
    }
    doc.createScene().addChild(G)
    return { doc, G }
  }
  test('b and c sharing: equal before and after a’s delete and Undo (a re-added last, with its own material)', () => {
    const { doc, G } = group({ a: 'red', b: 'blue', c: 'blue' })
    const before = buildDescriptor(G, 'G', 0, { refs: true })
    const a = G.listChildren()[0]
    G.removeChild(a)
    const restoredMat = doc.createMaterial('red').setBaseColorFactor([1, 0, 0, 1])
    a.getMesh().listPrimitives()[0].setMaterial(restoredMat)   // a restore is one message: its own material
    G.addChild(a)
    const after = buildDescriptor(G, 'G', 0, { refs: true })
    assert.notDeepEqual(before, after, 'the refs are renumbered (§2.6)')
    assert.equal(sameCanonical(before, after), true)
  })
  test('a and c sharing: unequal after a’s restore (the sharing was really lost)', () => {
    const { doc, G } = group({ a: 'red', b: 'blue', c: 'red' })
    const before = buildDescriptor(G, 'G', 0, { refs: true })
    const a = G.listChildren()[0]
    G.removeChild(a)
    a.getMesh().listPrimitives()[0].setMaterial(doc.createMaterial('red').setBaseColorFactor([1, 0, 0, 1]))
    G.addChild(a)
    assert.equal(sameCanonical(before, buildDescriptor(G, 'G', 0, { refs: true })), false)
  })
  test('a child added or removed, a value changed, two members swapping names: unequal', () => {
    const { G } = group({ a: 'red', b: 'blue', c: 'blue' })
    const d = buildDescriptor(G, 'G', 0, { refs: true })
    const fewer = structuredClone(d); fewer.children.pop()
    assert.equal(sameCanonical(d, fewer), false)
    const moved = structuredClone(d); moved.children[1].translation = [0, 1, 0]
    assert.equal(sameCanonical(d, moved), false)
    const swapped = structuredClone(d)
    ;[swapped.children[0].name, swapped.children[1].name] = [swapped.children[1].name, swapped.children[0].name]
    assert.equal(sameCanonical(d, swapped), false)
  })
  test('the same tree: equal; a single node: as sameDescriptor', () => {
    const { G } = group({ a: 'red', b: 'blue', c: 'blue' })
    const d = buildDescriptor(G, 'G', 0, { refs: true })
    assert.equal(sameCanonical(d, structuredClone(d)), true)
    assert.equal(sameCanonical({ name: 'x', translation: [0, 0, 0] }, { name: 'x', translation: [0, 0, 0] }), true)
    assert.equal(sameCanonical({ name: 'x', translation: [0, 0, 0] }, { name: 'x', translation: [0, 0, 1] }), false)
  })
})
