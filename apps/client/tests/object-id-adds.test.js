// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// object-id-adds.test.js — scripting-4b-1 E7, the Undo half.
//
// E-L2: "Undo and redo keep the id: they bring back the SAME object, so a
// behaviour that names it keeps working." Undo of an accepted add removes the
// node; the redo re-adds it. The re-added descriptor comes from
// `prepareRestore`, which copies the node's extras exactly — so the id it
// carries is the one the object was created with, never a fresh one.
//
// A refused re-add (another node took the id meanwhile) is reported exactly as
// any other refused re-add is.
//
// The engine is driven with a fake client, so no DOM and no three.js.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createEditUndo } from '../src/edit-undo.js'
import { prepareRestore } from '../src/edit-duplicate.js'

const ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
const OBJECT_ID_TAKEN = 'objectId is already taken in this world'

/** A SOM-like node whose `_node` has the glTF-Transform shape capture reads. */
function somNode(name, extras = {}) {
  const node = { name, translation: [1, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], children: [], extras }
  node._node = {
    getName: () => node.name,
    getTranslation: () => node.translation,
    getRotation: () => node.rotation,
    getScale: () => node.scale,
    getExtras: () => node.extras,
    getMesh: () => null,
    listChildren: () => node.children,
    listParents: () => [{ propertyType: 'Root' }, { propertyType: 'Scene' }],
    getCamera: () => null,
    getSkin: () => null,
    getWeights: () => [],
    getExtension: () => null,
    listExtensions: () => [],
  }
  return node
}

/**
 * A minimal engine harness, the shape edit-undo.test.js builds: one `sent` log,
 * and a `structural` dep that records the descriptor it was handed.
 */
function makeHarness() {
  let seq = 0
  const sent = []
  const nodes = new Map()
  const messages = []
  const record = (kind, fields = {}) => { const s = ++seq; sent.push({ seq: s, kind, ...fields }); return s }

  const undo = createEditUndo({
    getNodeByName: (name) => nodes.get(name) ?? null,
    checkNewName: () => ({ ok: true }),
    prepareRestore: (gltfNode) => prepareRestore(gltfNode),
    sendTransform: () => null,
    rename: () => record('rename'),
    structural: (req, direction) => {
      if (req.kind === 'delete') return record('remove', { name: req.name, direction })
      return record('add', { name: req.name, descriptor: req.descriptor, direction })
    },
    select: () => {},
    message: (text) => messages.push(text),
    isEditOn: () => true,
    isDragging: () => false,
    isRenamePending: () => false,
    hasPendingSend: () => false,
    hasPendingStructural: () => false,
  })

  const adds = () => sent.filter((e) => e.kind === 'add')
  const removes = () => sent.filter((e) => e.kind === 'remove')

  /** Register and accept a form's add of `node` (the app's own path). */
  function acceptAdd(node) {
    nodes.set(node.name, node)
    const s = record('plain-add', { name: node.name })
    undo.registerAdd(s, { name: node.name, duplicate: false })
    // The app's own answer path: the structure tracker settles, then the undo
    // engine sees the accepted add (Y4).
    undo.onStructureAnswer({
      request: { seq: s, undo: undefined, name: node.name }, status: 'accepted', removedMessage: null,
    })
    return s
  }

  /** Settle a structural request the undo engine sent. */
  function settle(entry, status, text = null) {
    undo.onStructureAnswer(
      { request: { seq: entry.seq, undo: entry.direction, name: entry.name }, status, removedMessage: null },
      text)
  }

  return { undo, sent, nodes, messages, record, adds, removes, acceptAdd, settle }
}

describe('E7 — Undo and redo keep the object’s id', () => {
  test('the redo of an undone add re-sends the SAME id (a Model-form-shaped add)', () => {
    const h = makeHarness()
    const node = somNode('ModelOne', { atrium: { objectId: ID, model: { url: 'https://cdn.example.com/m.glb' } } })
    h.acceptAdd(node)
    assert.equal(h.undo.undoCount, 1)

    h.undo.run('undo')                       // the remove goes out
    const removal = h.removes().at(-1)
    assert.ok(removal, 'an undo of an add removes the node')
    h.settle(removal, 'accepted')

    h.undo.run('redo')                       // the re-add
    const readd = h.adds().at(-1)
    assert.ok(readd, 'the redo re-adds it')
    assert.equal(readd.descriptor.extras.atrium.objectId, ID, 'the SAME id comes back')
    assert.deepEqual(readd.descriptor.extras.atrium.model, { url: 'https://cdn.example.com/m.glb' },
      'and the rest of the object is unchanged')
  })

  test('every accepted add records the id the object was created with', () => {
    // The Model form, the teleporter form and the library all funnel through the
    // same app path (guarded by app-wiring.test.js); the engine’s half is one
    // behaviour, so one descriptor shape stands for them.
    for (const extras of [
      { atrium: { objectId: ID } },                                             // the library's model node
      { atrium: { objectId: ID, teleporter: { destination: '/w' } } },          // the teleporter form
      { atrium: { objectId: ID, animation: { clip: 'Walk' } } },                // a model's leaf
    ]) {
      const h = makeHarness()
      h.acceptAdd(somNode('Thing', extras))
      h.undo.run('undo')
      h.settle(h.removes().at(-1), 'accepted')
      h.undo.run('redo')
      assert.deepEqual(h.adds().at(-1).descriptor.extras, extras, 'the descriptor is the object, id included')
    }
  })

  test('an id-less add still comes back without one', () => {
    const h = makeHarness()
    h.acceptAdd(somNode('Old'))
    h.undo.run('undo')
    h.settle(h.removes().at(-1), 'accepted')
    h.undo.run('redo')
    assert.equal(h.adds().at(-1).descriptor.extras, undefined, 'a restore invents nothing')
  })

  test('a refused re-add because the id was taken is reported as any refused re-add', () => {
    const h = makeHarness()
    h.acceptAdd(somNode('Thing', { atrium: { objectId: ID } }))
    h.undo.run('undo')
    h.settle(h.removes().at(-1), 'accepted')

    h.undo.run('redo')
    const readd = h.adds().at(-1)
    assert.equal(readd.descriptor.extras.atrium.objectId, ID)
    // …another node took the id in the meantime (a raw `add`); the server refuses.
    h.settle(readd, 'rejected', OBJECT_ID_TAKEN)

    assert.equal(h.messages.at(-1), `Couldn’t redo: ${OBJECT_ID_TAKEN}`, 'the refusal is shown')
    assert.equal(h.undo.redoCount, 0, 'the entry is dropped, exactly as any refused re-add')
    assert.equal(h.undo.undoCount, 0)
  })

  test('the taken-id message never matches the palette retry predicate', () => {
    // S-B: the palette retries a refusal matching /already in use/, which is the
    // SOM’s name-collision text. The id refusal must never look like it.
    const paletteRetry = /already in use/
    assert.equal(paletteRetry.test(OBJECT_ID_TAKEN), false)
  })
})
