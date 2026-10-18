// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// Phase 3 step 2, Y1/Y4/W4/W7/W8 — devtasks/PREBRIEF-undo-redo.md §7.1
//
// The module is driven against a stand-in world: plain SOM-like node objects
// with a real glTF-Transform-shaped `_node`, so `prepareRestore` (Y2) runs for
// real. The harness plays the app's part — it holds the world, hands out seqs
// the way AtriumClient does, and feeds answers in whatever order a case needs.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  createEditUndo, MAX_ENTRIES, MAX_DESCRIPTOR_BYTES,
  NOTHING_TO_UNDO, NOTHING_TO_REDO, WAITING_MESSAGE, OUT_OF_STEP_MESSAGE,
  DELETE_CHANGED_MESSAGE,
} from '../src/edit-undo.js'
import { prepareRestore } from '../src/edit-duplicate.js'
import { sanitizeTransform } from '../src/edit-gesture.js'

// ── a stand-in SOM world ────────────────────────────────────────────────────

/** A SOM-like node whose `_node` has the glTF-Transform shape Y2 reads. */
function somNode(name, opts = {}) {
  const node = {
    name,
    translation: opts.translation ?? [0, 0, 0],
    rotation: opts.rotation ?? [0, 0, 0, 1],
    scale: opts.scale ?? [1, 1, 1],
    children: opts.children ?? [],
    extras: opts.extras ?? {},
  }
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

function sameArray(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function makeApp(opts = {}) {
  let seq = 0
  const nodes = new Map()
  const sent = []
  const bySeq = new Map()
  const messages = []
  const selections = []
  const flags = {
    editOn: true, dragging: false, renamePending: false,
    sendPending: false, structuralPending: false,
  }

  const getNodeByName = (name) => nodes.get(name) ?? null
  const put = (node) => { nodes.set(node.name, node); return node }
  const drop = (node) => { if (nodes.get(node.name) === node) nodes.delete(node.name) }

  /** Every send the harness makes is recorded, the way AtriumClient's seq is. */
  function record(kind, fields = {}) {
    const s = ++seq
    sent.push({ seq: s, kind, ...fields })
    return s
  }

  const undo = createEditUndo({
    getNodeByName,
    checkNewName: (name, node) => {
      const other = nodes.get(name)
      if (other && other !== node) return { ok: false, message: `“${name}” is already in use` }
      return { ok: true }
    },
    prepareRestore: opts.prepareRestore ?? ((gltfNode) => prepareRestore(gltfNode)),
    sendTransform: (node, field, value) => {
      // exactly what edit-gesture's commit does: sanitize, and send nothing
      // when the node already holds the value
      const v = sanitizeTransform(field, value)
      if (sameArray(v, node[field])) return null
      node[field] = v
      const s = record('transform', { node, field, value: v })
      bySeq.set(s, { kind: 'transform', field })
      return s
    },
    rename: (node, from, to, direction) => {
      const s = record('rename', { node, from, to })
      bySeq.set(s, { kind: 'rename', node, from, to })
      flags.renamePending = true
      return s
    },
    structural: (req, direction) => {
      if (req.kind === 'delete') {
        drop(req.node)
        const s = record('structural-delete', { name: req.name, node: req.node, subtree: req.subtree })
        bySeq.set(s, { kind: 'structural', undo: direction, name: req.name })
        return s
      }
      // the server makes a NEW node object (U5, J1)
      const fresh = somNode(req.descriptor.name, {
        translation: [...(req.descriptor.translation ?? [0, 0, 0])],
        rotation: [...(req.descriptor.rotation ?? [0, 0, 0, 1])],
        scale: [...(req.descriptor.scale ?? [1, 1, 1])],
      })
      put(fresh)
      const s = record('structural-add', { name: req.name, node: fresh })
      bySeq.set(s, { kind: 'structural', undo: direction, name: req.name })
      return s
    },
    select: (node) => selections.push(node),
    message: (text) => messages.push(text),
    isEditOn: () => flags.editOn,
    isDragging: () => flags.dragging,
    isRenamePending: () => flags.renamePending,
    hasPendingSend: () => flags.sendPending,
    hasPendingStructural: () => flags.structuralPending,
  })

  /** The app applies a `som:rename` before `edit:accepted` arrives. */
  function applyRename(node, to) {
    if (nodes.get(node.name) === node) nodes.delete(node.name)
    node.name = to
    nodes.set(to, node)
  }

  /**
   * Feed one answer: the app's own `edit:*` handler and, for a structural
   * request, the structure tracker's settle — both reach the undo engine.
   * `extra.applyRename: false` plays U15's accepted-but-did-not-apply case.
   */
  function answer(s, status, text = null, extra = {}) {
    const info = bySeq.get(s)
    if (!info) throw new Error(`answer: unknown seq ${s}`)
    if (status === 'accepted' && info.kind === 'rename') {
      flags.renamePending = false
      if (extra.applyRename !== false) applyRename(info.node, info.to)
    }
    if (status === 'rejected' && info.kind === 'rename') flags.renamePending = false
    // the server broadcasts `som:remove` before the delete's own answer (U2)
    if (status === 'accepted' && info.kind === 'plain-delete') drop(info.node)
    if (status === 'accepted') undo.onAccepted(s)
    else if (status === 'rejected') undo.onRejected(s, { message: text ?? 'refused' })
    else undo.onUnknown(s)

    const structural = info.kind === 'structural' || info.kind === 'plain-add' || info.kind === 'plain-delete'
    if (structural) {
      undo.onStructureAnswer({
        request: { seq: s, undo: info.undo, name: info.name },
        status,
        removedMessage: extra.removedMessage ?? null,
      }, text)
    }
  }

  /** A settle batch straight from the gesture tracker (Y3). */
  function settle(node, changes) {
    undo.onTransformsSettled(
      [{ node, changes }],
      { acceptedOwnSend: true, remote: false, rejected: false })
  }

  /** A palette/Duplicate add: send, register, answer. */
  function addNode(node, { duplicate = false, restorable = true } = {}) {
    const s = record('plain-add', { name: node.name, duplicate })
    bySeq.set(s, { kind: 'plain-add', name: node.name })
    if (restorable) put(node)
    undo.registerAdd(s, { name: node.name, duplicate })
    return s
  }

  /** A typed rename: send, register, answer. */
  function typeRename(node, to) {
    const from = node.name
    const s = record('rename', { node, from, to })
    bySeq.set(s, { kind: 'rename', node, from, to })
    undo.registerRename(s, { node, from, to })
    return s
  }

  /** The Delete click: capture first, then send, then register (Y2, W6). */
  function clickDelete(node) {
    const cap = undo.capture(node)
    const s = record('plain-delete', { name: node.name, node })
    bySeq.set(s, { kind: 'plain-delete', name: node.name, node })
    undo.registerDelete(s, { node, name: node.name, descriptor: cap.ok ? cap.descriptor : null })
    return { seq: s, restorable: cap.ok }
  }

  function deletes() { return sent.filter((e) => e.kind === 'structural-delete') }
  function adds() { return sent.filter((e) => e.kind === 'structural-add') }

  return {
    undo, nodes, sent, messages, selections, flags,
    put, drop, getNodeByName, applyRename, answer, settle,
    addNode, typeRename, clickDelete, deletes, adds,
  }
}

// ── Y1: stack mechanics ─────────────────────────────────────────────────────

describe('edit-undo: entries and stacks (Y1)', () => {
  test('a recorded entry clears the redo stack; an accepted undo moves it over; redo moves it back', () => {
    const app = makeApp()
    const a = app.put(somNode('A'))
    app.settle(a, [{ field: 'translation', from: [0, 0, 0], to: [1, 0, 0] }])
    a.translation = [1, 0, 0]
    assert.equal(app.undo.undoCount, 1)
    assert.equal(app.undo.redoCount, 0)

    app.undo.run('undo')                          // sends X=0
    assert.equal(app.undo.inFlight(), true)
    app.answer(app.sent.at(-1).seq, 'accepted')
    assert.equal(app.undo.undoCount, 0)
    assert.equal(app.undo.redoCount, 1, 'the entry moved to the redo stack')

    app.undo.run('redo')                          // sends X=1
    app.answer(app.sent.at(-1).seq, 'accepted')
    assert.equal(app.undo.undoCount, 1)
    assert.equal(app.undo.redoCount, 0, 'back where it came from')

    // a newly recorded entry clears the redo stack
    app.undo.run('undo')
    app.answer(app.sent.at(-1).seq, 'accepted')
    assert.equal(app.undo.redoCount, 1)
    app.settle(a, [{ field: 'translation', from: [0, 0, 0], to: [3, 0, 0] }])
    assert.equal(app.undo.redoCount, 0, 'a new entry clears the branch an undo abandoned')
  })

  test('labels name the kind and the node, and Transform covers more than one field', () => {
    const app = makeApp()
    const a = app.put(somNode('Cube'))
    app.settle(a, [{ field: 'translation', from: [0, 0, 0], to: [1, 0, 0] }])
    assert.equal(app.undo.label('undo'), 'Undo Move “Cube”')
    app.settle(a, [{ field: 'rotation', from: [0, 0, 0, 1], to: [0, 0, Math.SQRT1_2, Math.SQRT1_2] }])
    assert.equal(app.undo.label('undo'), 'Undo Rotate “Cube”')
    app.settle(a, [{ field: 'scale', from: [1, 1, 1], to: [2, 2, 2] }])
    assert.equal(app.undo.label('undo'), 'Undo Scale “Cube”')
    app.settle(a, [
      { field: 'translation', from: [0, 0, 0], to: [1, 0, 0] },
      { field: 'rotation', from: [0, 0, 0, 1], to: [0, 0, 0, 1] },
    ])
    assert.equal(app.undo.label('undo'), 'Undo Transform “Cube”')

    const b = app.put(somNode('Box'))
    app.typeRename(b, 'Crate')
    app.answer(app.sent.at(-1).seq, 'accepted')
    assert.equal(app.undo.label('undo'), 'Undo Rename “Box”')

    const c = somNode('Sphere')
    app.addNode(c)
    app.answer(app.sent.at(-1).seq, 'accepted')
    assert.equal(app.undo.label('undo'), 'Undo Add “Sphere”')

    const d = somNode('Cone')
    app.put(d)
    app.addNode(d, { duplicate: true })
    app.answer(app.sent.at(-1).seq, 'accepted')
    assert.equal(app.undo.label('undo'), 'Undo Duplicate “Cone”')

    const e = app.put(somNode('Pad'))
    app.clickDelete(e)
    app.answer(app.sent.at(-1).seq, 'accepted')
    assert.equal(app.undo.label('undo'), 'Undo Delete “Pad”')

    const empty = makeApp()
    assert.equal(empty.undo.label('undo'), NOTHING_TO_UNDO)
    assert.equal(empty.undo.label('redo'), NOTHING_TO_REDO)
  })

  test('(W2) the handle follows a re-added node, so an older entry still targets it', () => {
    const app = makeApp()
    const a = app.put(somNode('A'))
    app.settle(a, [{ field: 'translation', from: [0, 0, 0], to: [1, 0, 0] }])
    a.translation = [1, 0, 0]                       // the drag left it there
    app.clickDelete(a)                              // captured at X = 1
    app.answer(app.sent.at(-1).seq, 'accepted')
    assert.equal(app.undo.undoCount, 2)

    app.undo.run('undo')                            // undo the delete: re-add
    const readded = app.adds().at(-1).node
    assert.notEqual(readded, a, 'the server made a new SOMNode (U5)')
    app.answer(app.sent.at(-1).seq, 'accepted')
    assert.deepEqual(readded.translation, [1, 0, 0], 'restored exactly')

    // the transform entry's node is the new one now: its check must pass
    const before = app.sent.length
    app.undo.run('undo')
    assert.equal(app.sent.length, before + 1, 'the transform’s undo did send')
    assert.equal(app.sent.at(-1).node, readded, 'it targeted the re-added node')
    assert.deepEqual(app.sent.at(-1).value, [0, 0, 0])
  })

  test('(Y1, Rev 1 #4) a delete is captured at click time from current values', () => {
    const app = makeApp()
    const a = app.put(somNode('A', { translation: [5, 0, 0] }))
    const { restorable } = app.clickDelete(a)
    assert.equal(restorable, true, 'a plain root node can come back')
    app.answer(app.sent.at(-1).seq, 'accepted')
    app.undo.run('undo')
    const readded = app.adds().at(-1).node
    app.answer(app.sent.at(-1).seq, 'accepted')
    assert.deepEqual(readded.translation, [5, 0, 0])
  })
})

// ── W4: the world changed elsewhere ─────────────────────────────────────────

describe('edit-undo: W4 checks (refuse and drop)', () => {
  test('a transform field changed elsewhere sends nothing, says so, and drops only that entry', () => {
    const app = makeApp()
    const a = app.put(somNode('Cube'))
    app.settle(a, [{ field: 'translation', from: [0, 0, 0], to: [1, 0, 0] }])
    a.translation = [1, 0, 0]
    app.settle(a, [{ field: 'translation', from: [1, 0, 0], to: [2, 0, 0] }])
    a.translation = [2, 0, 0]
    a.translation = [9, 0, 0]                       // another tab moved it
    const before = app.sent.length
    assert.equal(app.undo.run('undo'), false)
    assert.equal(app.sent.length, before, 'nothing was sent')
    assert.equal(app.messages.at(-1), 'Can’t undo: “Cube” was changed elsewhere.')
    assert.equal(app.undo.undoCount, 1, 'only that entry was dropped')

    // the next Undo reaches the one below it
    assert.equal(app.undo.run('undo'), false, 'that one is refused too (its `to` differs)')
    assert.equal(app.undo.undoCount, 0)
  })

  test('the node removed elsewhere is refused with its own message', () => {
    const app = makeApp()
    const a = app.put(somNode('Cube'))
    app.settle(a, [{ field: 'translation', from: [0, 0, 0], to: [1, 0, 0] }])
    a.translation = [1, 0, 0]
    app.drop(a)                                      // another tab deleted it
    const before = app.sent.length
    app.undo.run('undo')
    assert.equal(app.sent.length, before)
    assert.equal(app.messages.at(-1), 'Can’t undo: “Cube” was removed.')
  })

  test('a node no longer addressable (a duplicate name) is treated as removed (L6)', () => {
    const app = makeApp()
    const a = app.put(somNode('Cube'))
    app.settle(a, [{ field: 'translation', from: [0, 0, 0], to: [1, 0, 0] }])
    a.translation = [1, 0, 0]
    // the name now resolves to another object: `getNodeByName(name) === node` fails
    app.drop(a)
    app.put(somNode('Cube'))
    const before = app.sent.length
    app.undo.run('undo')
    assert.equal(app.sent.length, before)
    assert.equal(app.messages.at(-1), 'Can’t undo: “Cube” was removed.')
  })

  test('a rename whose name changed elsewhere, and a rename whose target is taken', () => {
    const app = makeApp()
    const a = app.put(somNode('Cube'))
    const s = app.typeRename(a, 'Box')
    app.answer(s, 'accepted')
    assert.equal(app.undo.undoCount, 1)

    a.name = 'Crate'                                 // someone else renamed it again
    app.nodes.delete('Box')
    app.nodes.set('Crate', a)
    const before = app.sent.length
    app.undo.run('undo')
    assert.equal(app.sent.length, before)
    assert.equal(app.messages.at(-1), 'Can’t undo: “Cube” was changed elsewhere.')
    assert.equal(app.undo.undoCount, 0)

    // the target taken
    const app2 = makeApp()
    const b = app2.put(somNode('Cube'))
    const s2 = app2.typeRename(b, 'Box')
    app2.answer(s2, 'accepted')
    app2.put(somNode('Cube'))                        // a node took the old name back
    const before2 = app2.sent.length
    app2.undo.run('undo')
    assert.equal(app2.sent.length, before2)
    assert.equal(app2.messages.at(-1), 'Can’t undo: “Cube” the name is in use.')
  })

  test('a re-add whose name is taken is refused', () => {
    const app = makeApp()
    const a = app.put(somNode('Cube'))
    app.clickDelete(a)
    app.answer(app.sent.at(-1).seq, 'accepted')
    app.put(somNode('Cube'))                         // another tab made a new Cube
    const before = app.sent.length
    app.undo.run('undo')
    assert.equal(app.sent.length, before, 'no re-add was sent')
    assert.equal(app.messages.at(-1), 'Can’t undo: “Cube” the name is in use.')
  })

  test('redo’s checks are the mirror: the world must hold the entry’s `from`', () => {
    const app = makeApp()
    const a = app.put(somNode('Cube'))
    app.settle(a, [{ field: 'translation', from: [0, 0, 0], to: [1, 0, 0] }])
    a.translation = [1, 0, 0]
    app.undo.run('undo')
    app.answer(app.sent.at(-1).seq, 'accepted')      // now on the redo stack
    assert.deepEqual(a.translation, [0, 0, 0])
    a.translation = [7, 0, 0]                        // changed elsewhere
    const before = app.sent.length
    app.undo.run('redo')
    assert.equal(app.sent.length, before)
    assert.equal(app.messages.at(-1), 'Can’t redo: “Cube” was changed elsewhere.')
    assert.equal(app.undo.redoCount, 0)
  })

  test('(Rev 1 #2) structural changed-elsewhere: an undo of an add refuses when the node moved on', () => {
    const app = makeApp()
    const a = somNode('Sphere')
    app.addNode(a)
    app.answer(app.sent.at(-1).seq, 'accepted')
    assert.equal(app.undo.undoCount, 1)
    a.translation = [4, 0, 0]                        // another session moved it
    const before = app.deletes().length
    app.undo.run('undo')
    assert.equal(app.deletes().length, before, 'no remove was sent')
    assert.equal(app.messages.at(-1), 'Can’t undo: “Sphere” was changed elsewhere.')
  })

  test('(Rev 1 #2) structural changed-elsewhere: a redo of a delete refuses when the node moved on', () => {
    const app = makeApp()
    const a = app.put(somNode('Sphere', { translation: [2, 0, 0] }))
    app.clickDelete(a)
    app.answer(app.sent.at(-1).seq, 'accepted')
    app.undo.run('undo')                             // re-add it
    const readded = app.adds().at(-1).node
    app.answer(app.sent.at(-1).seq, 'accepted')
    assert.deepEqual(readded.translation, [2, 0, 0])
    readded.translation = [3.5, 0, 0]                // one number differs
    const before = app.deletes().length
    app.undo.run('redo')
    assert.equal(app.deletes().length, before, 'no remove was sent')
    assert.equal(app.messages.at(-1), 'Can’t redo: “Sphere” was changed elsewhere.')
  })
})

// ── Y4: in flight, refusals, availability ───────────────────────────────────

describe('edit-undo: in flight and refusals (Y4)', () => {
  test('a second undo is refused while one is unanswered', () => {
    const app = makeApp()
    const a = app.put(somNode('Cube'))
    app.settle(a, [{ field: 'translation', from: [0, 0, 0], to: [1, 0, 0] }])
    a.translation = [1, 0, 0]
    app.settle(a, [{ field: 'translation', from: [1, 0, 0], to: [2, 0, 0] }])
    a.translation = [2, 0, 0]
    app.undo.run('undo')
    assert.equal(app.undo.inFlight(), true)
    const before = app.sent.length
    assert.equal(app.undo.run('undo'), false)
    assert.equal(app.undo.run('redo'), false)
    assert.equal(app.sent.length, before, 'nothing else was sent')
    assert.equal(app.undo.reason('undo'), WAITING_MESSAGE)
  })

  test('a refused undo drops the entry and leaves the redo stack as it was', () => {
    const app = makeApp()
    const a = app.put(somNode('Cube'))
    app.settle(a, [{ field: 'translation', from: [0, 0, 0], to: [1, 0, 0] }])
    a.translation = [1, 0, 0]
    app.undo.run('undo')
    app.answer(app.sent.at(-1).seq, 'accepted')      // the redo stack gets the entry
    assert.equal(app.undo.redoCount, 1)
    app.undo.run('redo')
    app.answer(app.sent.at(-1).seq, 'rejected', 'no')
    assert.equal(app.undo.redoCount, 0, 'dropped')
    assert.equal(app.undo.undoCount, 0)
    assert.equal(app.messages.at(-1), 'Couldn’t redo: no')
  })

  test('a multi-field entry with one field refused is dropped, and the panel says which', () => {
    const app = makeApp()
    const a = app.put(somNode('Cube'))
    app.settle(a, [
      { field: 'translation', from: [0, 0, 0], to: [1, 0, 0] },
      { field: 'rotation', from: [0, 0, 0, 1], to: [0, 0, Math.SQRT1_2, Math.SQRT1_2] },
    ])
    a.translation = [1, 0, 0]
    a.rotation = [0, 0, Math.SQRT1_2, Math.SQRT1_2]
    app.undo.run('undo')
    const seqs = app.sent.filter((e) => e.kind === 'transform').map((e) => e.seq)
    assert.equal(seqs.length, 2)
    app.answer(seqs[0], 'accepted')
    app.answer(seqs[1], 'rejected', 'not a unit quaternion')
    assert.equal(app.undo.undoCount, 0, 'the entry is dropped either way')
    assert.equal(app.undo.reason('undo'), NOTHING_TO_UNDO)
    assert.equal(app.messages.at(-1),
      'Undo was only partly applied: position changed, rotation was refused (not a unit quaternion).')
  })

  test('(Rev 1 #8) a zero-send undo moves the entry with no request at all', () => {
    const app = makeApp()
    // a legacy rotation: the entry's `from` normalizes to the identity the node
    // already holds, so the tracker sends nothing (U11)
    const a = app.put(somNode('Cube', { rotation: [0, 0, 0, 1] }))
    app.settle(a, [
      { field: 'rotation', from: [0, 0, 0, 2], to: [0, 0, 0, 1] },
    ])
    const before = app.sent.length
    app.undo.run('undo')
    assert.equal(app.sent.length, before, 'nothing was sent')
    assert.equal(app.undo.redoCount, 1, 'the entry moved to the redo stack at once')
    assert.equal(app.undo.inFlight(), false)
  })

  test('(Rev 1 #9) an undo’s remove that settles as `replaced` drops the entry', () => {
    const app = makeApp()
    const a = somNode('Sphere')
    app.addNode(a)
    app.answer(app.sent.at(-1).seq, 'accepted')
    app.undo.run('undo')
    app.answer(app.sent.at(-1).seq, 'accepted', null, { removedMessage: 'replaced' })
    assert.equal(app.undo.undoCount, 0, 'the entry is dropped (W2’s limitation)')
    assert.equal(app.undo.redoCount, 0, 'it never moved to the redo stack')
  })

  test('availability: each block reason in turn (Y4)', () => {
    const app = makeApp()
    const a = app.put(somNode('Cube'))
    assert.equal(app.undo.reason('undo'), NOTHING_TO_UNDO)
    assert.equal(app.undo.reason('redo'), NOTHING_TO_REDO)

    app.settle(a, [{ field: 'translation', from: [0, 0, 0], to: [1, 0, 0] }])
    a.translation = [1, 0, 0]
    assert.equal(app.undo.reason('undo'), null, 'available')
    app.flags.editOn = false
    assert.match(app.undo.reason('undo'), /Edit mode/)
    app.flags.editOn = true
    app.flags.structuralPending = true
    assert.equal(app.undo.reason('undo'), WAITING_MESSAGE)
    app.flags.structuralPending = false
    app.flags.dragging = true
    assert.match(app.undo.reason('undo'), /Finish moving/)
    app.flags.dragging = false
    app.flags.renamePending = true
    assert.match(app.undo.reason('undo'), /rename/)
    app.flags.renamePending = false
    app.flags.sendPending = true
    assert.equal(app.undo.reason('undo'), WAITING_MESSAGE)
    app.flags.sendPending = false
    assert.equal(app.undo.reason('undo'), null)

    app.undo.run('undo')
    assert.equal(app.undo.reason('undo'), WAITING_MESSAGE, 'an undo in flight blocks another')
  })
})

// ── W8: bounds ──────────────────────────────────────────────────────────────

describe('edit-undo: bounds (W8)', () => {
  test('the 101st entry drops the oldest', () => {
    const app = makeApp()
    const a = app.put(somNode('Cube'))
    const results = Array.from({ length: 101 }, () => ({
      node: a, changes: [{ field: 'translation', from: [0, 0, 0], to: [1, 0, 0] }],
    }))
    app.undo.onTransformsSettled(results, { acceptedOwnSend: true })
    assert.equal(app.undo.undoCount, MAX_ENTRIES)
  })

  test('descriptors over 16 MiB drop the oldest, and the count is UTF-8 bytes', () => {
    // each descriptor is 4 MiB of UTF-8: five of them are 20 MiB
    const big = { ok: true, descriptor: { name: 'é'.repeat(2 * 1024 * 1024) } }
    const app = makeApp({ prepareRestore: () => big })
    const names = ['a', 'b', 'c', 'd', 'e']
    for (const name of names) {
      const n = app.put(somNode(name))
      app.clickDelete(n)
      app.answer(app.sent.at(-1).seq, 'accepted')
    }
    assert.ok(app.undo.undoBytes <= MAX_DESCRIPTOR_BYTES,
      `${app.undo.undoBytes} must be at or under ${MAX_DESCRIPTOR_BYTES}`)
    // 5 × 4 MiB = 20 MiB: dropping one leaves 16 MiB plus the message overhead,
    // still over; dropping two leaves 12 MiB. In UTF-16 units it would be 10 MiB
    // and nothing would be dropped at all.
    assert.equal(app.undo.undoCount, 3)
  })

  test('the byte bound drops descriptor-carrying entries, not merely the oldest', () => {
    const big = { ok: true, descriptor: { name: 'é'.repeat(2 * 1024 * 1024) } }
    const app = makeApp({ prepareRestore: () => big })
    const plain = app.put(somNode('Plain'))
    app.settle(plain, [{ field: 'translation', from: [0, 0, 0], to: [1, 0, 0] }])   // oldest, 0 bytes
    for (const name of ['a', 'b', 'c', 'd', 'e']) {
      const n = app.put(somNode(name))
      app.clickDelete(n)
      app.answer(app.sent.at(-1).seq, 'accepted')
    }
    assert.ok(app.undo.undoBytes <= MAX_DESCRIPTOR_BYTES)
    assert.equal(app.undo.undoCount, 4, 'the byte-free entry survives with three descriptors')
    assert.deepEqual(app.undo.undoLabels,
      ['Move “Plain”', 'Delete “c”', 'Delete “d”', 'Delete “e”'],
      'the two oldest descriptors went, and the byte-free entry stayed')
  })
})

// ── W7 and Y7: lifetime and Edit mode ───────────────────────────────────────

describe('edit-undo: lifetime (W7, Y7)', () => {
  test('the session-end hook empties both stacks; turning Edit mode off does not', () => {
    const app = makeApp()
    const a = app.put(somNode('Cube'))
    app.settle(a, [{ field: 'translation', from: [0, 0, 0], to: [1, 0, 0] }])
    a.translation = [1, 0, 0]
    app.undo.run('undo')
    app.answer(app.sent.at(-1).seq, 'accepted')
    assert.equal(app.undo.undoCount + app.undo.redoCount, 1)

    app.flags.editOn = false                          // Edit mode off is not the end
    // the panel polls the reason on every Edit-mode toggle (refreshEditActions)
    assert.match(app.undo.reason('undo'), /Edit mode/)
    assert.equal(app.undo.undoCount + app.undo.redoCount, 1)
    app.flags.editOn = true
    assert.equal(app.undo.reason('redo'), null, 'and Undo works again afterwards')

    app.undo.endSession()
    assert.equal(app.undo.undoCount, 0)
    assert.equal(app.undo.redoCount, 0)
  })

  test('(Y7) an add, a duplicate and a delete answered after Edit mode goes off are each recorded', () => {
    for (const kind of ['add', 'duplicate', 'delete']) {
      const app = makeApp()
      const n = somNode('Sphere')
      let seq
      if (kind === 'add') { app.put(n); seq = app.addNode(n) }
      else if (kind === 'duplicate') { app.put(n); seq = app.addNode(n, { duplicate: true }) }
      else { app.put(n); seq = app.clickDelete(n).seq }
      app.flags.editOn = false                        // Edit mode off before the answer
      app.answer(seq, 'accepted')
      assert.equal(app.undo.undoCount, 1, `${kind} was recorded with Edit off`)
      app.flags.editOn = true
      const before = app.sent.length
      assert.equal(app.undo.run('undo'), true, `Undo reverses the ${kind}`)
      assert.equal(app.sent.length, before + 1)
    }
  })

  test('an unknown answer clears both stacks with the session (W7)', () => {
    const app = makeApp()
    const a = app.put(somNode('Cube'))
    app.settle(a, [{ field: 'translation', from: [0, 0, 0], to: [1, 0, 0] }])
    a.translation = [1, 0, 0]
    app.undo.run('undo')
    app.answer(app.sent.at(-1).seq, 'unknown')
    assert.equal(app.undo.undoCount, 0)
    assert.equal(app.undo.redoCount, 0)
    assert.equal(app.undo.inFlight(), false)
  })
})

// ── Y1/W5: recording rules ──────────────────────────────────────────────────

describe('edit-undo: what is recorded and what is not (Y1, W5)', () => {
  test('a delete that cannot be undone is not recorded, keeps the undo stack, clears redo', () => {
    const app = makeApp()
    const a = app.put(somNode('Cube'))
    const b = app.put(somNode('Box'))
    app.settle(a, [{ field: 'translation', from: [0, 0, 0], to: [1, 0, 0] }])
    a.translation = [1, 0, 0]
    app.settle(b, [{ field: 'translation', from: [0, 0, 0], to: [1, 0, 0] }])
    b.translation = [1, 0, 0]
    app.undo.run('undo')                             // undo A: the redo stack gets it
    app.answer(app.sent.at(-1).seq, 'accepted')
    assert.equal(app.undo.undoCount, 1)
    assert.equal(app.undo.redoCount, 1)

    // a group: it has children, so it can never come back (U6)
    const grp = app.put(somNode('grp-test', { children: [somNode('leg')] }))
    const { restorable } = app.clickDelete(grp)
    assert.equal(restorable, false, 'the dialog path (W6)')
    app.answer(app.sent.at(-1).seq, 'accepted')
    assert.equal(app.undo.undoCount, 1, 'the undo stack is kept')
    assert.equal(app.undo.redoCount, 0, 'the redo stack is cleared')
    assert.equal(app.undo.label('undo'), 'Undo Move “Cube”', 'the earlier entry is still there')
  })

  test('(Rev 1 #6) an accepted rename that did not apply locally clears both stacks', () => {
    const app = makeApp()
    const a = app.put(somNode('Cube'))
    app.settle(a, [{ field: 'translation', from: [0, 0, 0], to: [1, 0, 0] }])
    a.translation = [1, 0, 0]
    const s = app.typeRename(a, 'Box')
    app.answer(s, 'accepted', null, { applyRename: false })   // U15: accepted, not applied
    assert.equal(app.undo.undoCount, 0, 'nothing was recorded')
    assert.equal(app.undo.redoCount, 0)
    assert.equal(app.messages.at(-1), OUT_OF_STEP_MESSAGE)
  })

  test('(Rev 1 #4) a remote change while a delete is pending re-captures its descriptor', () => {
    const app = makeApp()
    const a = app.put(somNode('Cube', { translation: [1, 0, 0] }))
    const { seq } = app.clickDelete(a)
    a.translation = [4, 0, 0]                        // another session moved it, as the app would apply it
    app.undo.reCapture()
    app.answer(seq, 'accepted')
    app.undo.run('undo')
    const readded = app.adds().at(-1).node
    app.answer(app.sent.at(-1).seq, 'accepted')
    assert.deepEqual(readded.translation, [4, 0, 0], 'the last capture is the server’s state')
  })

  test('(Rev 1 #4) a re-capture that fails leaves the delete unrecorded, with its message', () => {
    const app = makeApp()
    const a = app.put(somNode('Cube'))
    const b = app.put(somNode('Box'))
    app.settle(a, [{ field: 'translation', from: [0, 0, 0], to: [1, 0, 0] }])
    a.translation = [1, 0, 0]
    app.settle(b, [{ field: 'translation', from: [0, 0, 0], to: [1, 0, 0] }])
    b.translation = [1, 0, 0]
    app.undo.run('undo')                             // fills the redo stack
    app.answer(app.sent.at(-1).seq, 'accepted')
    assert.equal(app.undo.undoCount, 1)
    assert.equal(app.undo.redoCount, 1)

    const { seq, restorable } = app.clickDelete(a)
    assert.equal(restorable, true, 'at click time it could come back (W6: no dialog)')
    a.children = [somNode('leg')]                    // a child was added while it was pending
    app.undo.reCapture()
    app.answer(seq, 'accepted')
    assert.equal(app.undo.undoCount, 1, 'only the earlier transform entry is left')
    assert.equal(app.undo.redoCount, 0, 'the redo stack is cleared')
    assert.equal(app.messages.at(-1), DELETE_CHANGED_MESSAGE)
  })

  test('(Rev 3 #2) an unrelated remote som:add re-captures with the node’s server values', () => {
    const app = makeApp()
    const a = app.put(somNode('Cube', { translation: [2, 0, 0] }))
    const { seq } = app.clickDelete(a)
    // a shared material changed through another node: any som:set counts, and
    // the node's own values are what the capture reads
    a.rotation = [0, Math.SQRT1_2, 0, Math.SQRT1_2]
    app.undo.reCapture()
    app.answer(seq, 'accepted')
    app.undo.run('undo')
    const readded = app.adds().at(-1).node
    app.answer(app.sent.at(-1).seq, 'accepted')
    assert.deepEqual(readded.translation, [2, 0, 0])
    assert.deepEqual(readded.rotation, [0, Math.SQRT1_2, 0, Math.SQRT1_2])
  })

  test('a re-capture after the node is gone is a no-op, not a failure', () => {
    const app = makeApp()
    const a = app.put(somNode('Cube'))
    const { seq } = app.clickDelete(a)               // the node left the world
    app.undo.reCapture()
    app.answer(seq, 'accepted')
    assert.equal(app.undo.undoCount, 1, 'still recorded, from the click-time capture')
  })

  test('an add whose node is not restorable when the answer arrives is not recorded', () => {
    const app = makeApp()
    const a = somNode('Sphere')
    const seq = app.addNode(a)
    a.children = [somNode('leg')]                    // grew a child before the answer
    app.answer(seq, 'accepted')
    assert.equal(app.undo.undoCount, 0)
  })

  test('a refused plain add records nothing', () => {
    const app = makeApp()
    const a = somNode('Sphere')
    const seq = app.addNode(a)
    app.answer(seq, 'rejected', 'already in use')
    assert.equal(app.undo.undoCount, 0)
    assert.equal(app.messages.length, 0, 'the panel’s own message is the app’s')
  })
})

// ── the deletion path through the structure tracker ────────────────────────

describe('edit-undo: undo’s own structural requests (Y4)', () => {
  test('an undo of an add sends a marked remove with the subtree and settles as 1b-2 does', () => {
    const app = makeApp()
    const a = somNode('Sphere')
    app.addNode(a)
    app.answer(app.sent.at(-1).seq, 'accepted')
    app.undo.run('undo')
    const del = app.deletes().at(-1)
    assert.equal(del.name, 'Sphere')
    assert.deepEqual(del.subtree, [a], 'the S1 hold needs the subtree')
    app.answer(del.seq, 'accepted')
    assert.equal(app.undo.undoCount, 0)
    assert.equal(app.undo.redoCount, 1)
  })

  test('a rejected undo remove is dropped with its message', () => {
    const app = makeApp()
    const a = somNode('Sphere')
    app.addNode(a)
    app.answer(app.sent.at(-1).seq, 'accepted')
    app.undo.run('undo')
    app.answer(app.deletes().at(-1).seq, 'rejected', 'no permission')
    assert.equal(app.undo.undoCount, 0)
    assert.equal(app.undo.redoCount, 0)
    assert.equal(app.messages.at(-1), 'Couldn’t undo: no permission')
  })

  test('a re-add after an undo of a delete selects the new node (W10)', () => {
    const app = makeApp()
    const a = app.put(somNode('Pad'))
    app.clickDelete(a)
    app.answer(app.sent.at(-1).seq, 'accepted')
    app.selections.length = 0
    app.undo.run('undo')
    const readded = app.adds().at(-1).node
    app.answer(app.sent.at(-1).seq, 'accepted')
    assert.equal(app.selections.at(-1), readded)
  })

  test('an undo’s remove that takes the node away selects nothing (W10)', () => {
    const app = makeApp()
    const a = somNode('Sphere')
    app.addNode(a)
    app.answer(app.sent.at(-1).seq, 'accepted')
    app.undo.run('undo')
    app.answer(app.deletes().at(-1).seq, 'accepted')
    assert.equal(app.selections.at(-1), null)
  })
})

// ── Y1/Y4: the redo stack's own rules ──────────────────────────────────────

describe('edit-undo: redo-stack rules (Y1)', () => {
  test('a remote-touched batch with an accepted own send clears redo without recording', () => {
    const app = makeApp()
    const a = app.put(somNode('Cube'))
    app.settle(a, [{ field: 'translation', from: [0, 0, 0], to: [1, 0, 0] }])
    a.translation = [1, 0, 0]
    app.undo.run('undo')
    app.answer(app.sent.at(-1).seq, 'accepted')
    assert.equal(app.undo.redoCount, 1)

    app.undo.onTransformsSettled([], { acceptedOwnSend: true, remote: true })
    assert.equal(app.undo.redoCount, 0, 'a confirmed change went unrecorded')
    assert.equal(app.undo.undoCount, 0)

    app.undo.onTransformsSettled([], { acceptedOwnSend: false, remote: true })
    assert.equal(app.undo.redoCount, 0)
  })
})
