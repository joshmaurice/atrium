// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// grouping GR7 (PREBRIEF-grouping.md FINAL Rev 2, §4 GR7, §5 "edit-undo.js")
// — Move to, Group and Ungroup in the Undo engine, on a REAL SOMDocument
// (space.gltf: crate-01, lamp-01 › lamp-shade, lamp-stand). The harness plays
// the server: an `add` ingests under the parent it names, a `remove` disposes,
// a move applies through `reparentNode`; the world changes first, then the
// engine hears (as AtriumClient's own echo does).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createEditUndo, OUT_OF_STEP_MESSAGE } from '../src/edit-undo.js'
import { prepareRestore, prepareDuplicate } from '../src/edit-duplicate.js'
import { groupPlan, ungroupPlan, moveValue } from '../src/edit-group.js'

const { NodeIO } = await import('../../../packages/som/node_modules/@gltf-transform/core/dist/index.modern.js')
const { SOMDocument, worldMatrix } = await import('../../../packages/som/src/index.js')
const fixture = (name) => fileURLToPath(new URL(`../../../tests/fixtures/${name}`, import.meta.url))
const world = async () => new SOMDocument(await new NodeIO().read(fixture('space.gltf')))
const parentName = (som, name) => som.getNodeByName(name)?.parent?.name ?? null
const near = (a, b, eps = 1e-9) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= eps)
const worldT = (som, name) => worldMatrix(som.getNodeByName(name)).slice(12, 15)

function harness(som, { editOn = () => true } = {}) {
  let seq = 0
  const info = new Map()
  const pending = []
  const messages = []
  const selected = []
  const refuse = []          // [{ test(i) → bool, text }]: the server refuses matching requests
  const busy = { structural: false }   // the page's structural slot is taken: `structural` sends nothing
  const undo = createEditUndo({
    getNodeByName: (n) => som.getNodeByName(n),
    getObjectByName: (n) => som.getObjectByName(n),
    checkNewName: (n, node) => som.checkNewName(n, node),
    prepareRestore,
    trees: () => true,
    isEditOn: editOn,
    sendTransform: (node, field, value) => {
      const s = ++seq
      info.set(s, { kind: 'transform', name: node.name, field, value }); pending.push(s)
      return s
    },
    rename: () => null,
    structural: (req, dir) => {
      if (busy.structural) return null
      const s = ++seq
      info.set(s, { kind: 'structural', req, dir }); pending.push(s)
      return s
    },
    move: (node, value, dir) => {
      const s = ++seq
      info.set(s, { kind: 'move', name: node.name, value, dir }); pending.push(s)
      return s
    },
    freeName: (base) => { for (let i = 2; i < 99; i++) { const n = `group-${String(i).padStart(2, '0')}`; if (som.checkNewName(n).ok) return n } return null },
    select: (e) => selected.push(e.node?.name ?? null),
    message: (t) => messages.push(t),
  })

  function answer(s) {
    const i = info.get(s)
    pending.splice(pending.indexOf(s), 1)
    const refusal = refuse.find((r) => r.test(i))
    if (i.kind === 'transform') {
      if (refusal) { undo.onRejected(s, { message: refusal.text }); return }
      som.getNodeByName(i.name)[i.field] = i.value
      undo.onAccepted(s)
      return
    }
    if (i.kind === 'move') {
      const node = som.getNodeByName(i.name)
      const parent = i.value.parent ? som.getNodeByName(i.value.parent) : null
      const r = refusal ? { ok: false, message: refusal.text } : (!node || (i.value.parent && !parent))
        ? { ok: false, message: 'NODE_NOT_FOUND' } : som.reparentNode(node, parent, i.value)
      if (!r.ok) { undo.onRejected(s, { message: r.message }); return }
      undo.onAccepted(s, { applied: true, landed: node.parent?.name ?? null })
      return
    }
    const request = { seq: s, undo: i.dir, name: i.req.name }
    if (refusal) { undo.onStructureAnswer({ request, status: 'rejected', removedMessage: null }, refusal.text); return }
    if (i.req.kind === 'delete') {
      som.getNodeByName(i.req.name).dispose()
    } else {
      const d = i.req.descriptor
      if (!som.checkNewName(d.name).ok) { undo.onStructureAnswer({ request, status: 'rejected', removedMessage: null }, `INVALID_VALUE: name "${d.name}" is already in use`); return }
      const parent = i.req.parent ? som.getNodeByName(i.req.parent) : null
      if (i.req.parent && !parent) { undo.onStructureAnswer({ request, status: 'rejected', removedMessage: null }, 'NODE_NOT_FOUND'); return }
      ;(parent ?? som.scene).addChild(som.ingestNode(d))
    }
    undo.onStructureAnswer({ request, status: 'accepted', removedMessage: null })
  }
  /** Answer everything, in order, phase after phase. */
  function settle() { let n = 0; while (pending.length > 0 && n++ < 1000) answer(pending[0]) }
  /** Another tab's move, as AtriumClient applies it: then som:set → reCapture. */
  function remoteMove(name, parentNameOrNull) {
    const node = som.getNodeByName(name)
    const parent = parentNameOrNull ? som.getNodeByName(parentNameOrNull) : null
    const m = moveValue(node, parent)
    assert.equal(m.ok, true)
    assert.equal(som.reparentNode(node, parent, m.value).ok, true)
    undo.reCapture()
  }
  function clickDelete(node) {
    const cap = undo.capture(node)
    const s = ++seq
    info.set(s, { kind: 'structural', req: { kind: 'delete', name: node.name }, dir: undefined })
    undo.registerDelete(s, { node, name: node.name, descriptor: cap.ok ? cap.descriptor : null })
    return s
  }
  function answerPlain(s, { add } = {}) {
    // a click's request: the world changes, then onStructureAnswer without `undo`
    const i = info.get(s)
    if (i.req.kind === 'delete') som.getNodeByName(i.req.name).dispose()
    else (add.parent ? som.getNodeByName(add.parent) : som.scene).addChild(som.ingestNode(add.descriptor))
    undo.onStructureAnswer({ request: { seq: s, name: i.req.name }, status: 'accepted', removedMessage: null })
  }
  return { undo, answer, settle, pending, info, messages, selected, refuse, busy, remoteMove, clickDelete, answerPlain, sent: () => [...info.values()] }
}

const group = (h, som, name) => { const n = som.getNodeByName(name); const plan = groupPlan(n, { isFree: (x) => som.checkNewName(x).ok }); assert.equal(h.undo.group(n, plan), true); h.settle(); return plan }
const ungroup = (h, som, name) => { const g = som.getNodeByName(name); const plan = ungroupPlan(g); assert.equal(plan.ok, true); assert.equal(h.undo.ungroup(g, plan), true); h.settle() }
const moveTo = (h, som, name, parent) => { const n = som.getNodeByName(name); const p = parent ? som.getNodeByName(parent) : null; const m = moveValue(n, p); assert.equal(m.ok, true); assert.equal(h.undo.moveTo(n, p, m.value), true); h.settle() }
const run = (h, d) => { assert.equal(h.undo.run(d), true, `${d}: ${h.messages.at(-1)}`); h.settle() }

describe('GR7: Move to', () => {
  test('do, undo, redo: the exact values come back, and the labels say "Move to"', async () => {
    const som = await world()
    const h = harness(som)
    const crate = som.getNodeByName('crate-01')
    const t0 = [...crate.translation], r0 = [...crate.rotation], s0 = [...crate.scale]
    const w0 = worldT(som, 'crate-01')
    moveTo(h, som, 'crate-01', 'lamp-01')
    assert.equal(parentName(som, 'crate-01'), 'lamp-01')
    assert.ok(near(worldT(som, 'crate-01'), w0), 'it stayed where it was')
    assert.deepEqual(h.undo.undoLabels, ['Move to “crate-01”'])
    run(h, 'undo')
    assert.equal(parentName(som, 'crate-01'), null)
    assert.deepEqual([...crate.translation], t0, 'translation exact')
    assert.deepEqual([...crate.rotation], r0)
    assert.deepEqual([...crate.scale], s0)
    run(h, 'redo')
    assert.equal(parentName(som, 'crate-01'), 'lamp-01')
    assert.equal(h.undo.undoCount, 1)
  })

  test('a refused Move to is not recorded and says why', async () => {
    const som = await world()
    const h = harness(som)
    h.refuse.push({ test: (i) => i.kind === 'move', text: 'INVALID_VALUE: the group would be too large to copy (nodes)' })
    moveTo(h, som, 'crate-01', 'lamp-01')
    assert.equal(h.undo.undoCount, 0)
    assert.match(h.messages.at(-1), /Couldn’t move “crate-01”: INVALID_VALUE/)
  })

  test('record: false (the panel asked first, GR-L5 (a)): applied, not recorded, Redo cleared', async () => {
    const som = await world()
    const h = harness(som)
    moveTo(h, som, 'crate-01', 'lamp-01'); run(h, 'undo')
    assert.equal(h.undo.redoCount, 1)
    const crate = som.getNodeByName('crate-01'), lamp = som.getNodeByName('lamp-01')
    assert.equal(h.undo.moveTo(crate, lamp, moveValue(crate, lamp).value, { record: false }), true)
    h.settle()
    assert.equal(parentName(som, 'crate-01'), 'lamp-01')
    assert.equal(h.undo.undoCount, 0)
    assert.equal(h.undo.redoCount, 0, 'Redo cleared (W5)')
  })
})

describe('GR7: Group', () => {
  test('do: the group is added, THEN the object moves in; undo and redo; the group comes back as a new node', async () => {
    const som = await world()
    const h = harness(som)
    const w0 = worldT(som, 'crate-01')
    const crate = som.getNodeByName('crate-01')
    const plan = groupPlan(crate, { isFree: (x) => som.checkNewName(x).ok })
    assert.equal(h.undo.group(crate, plan), true)
    const first = [...h.info.values()]
    assert.equal(first.length, 1, 'only the add is sent at first')
    assert.equal(first[0].req.kind, 'add')
    h.answer(h.pending[0])
    assert.equal(h.pending.length, 1, 'the move is sent after the add is accepted')
    assert.equal(h.info.get(h.pending[0]).value.parent, 'group-01')
    h.settle()
    assert.equal(parentName(som, 'crate-01'), 'group-01')
    assert.ok(near(worldT(som, 'crate-01'), w0))
    assert.deepEqual(h.undo.undoLabels, ['Group “group-01”'])
    assert.equal(h.selected.at(-1), 'group-01', 'the group is selected')
    run(h, 'undo')
    assert.equal(som.getNodeByName('group-01'), null, 'the group is removed')
    assert.equal(parentName(som, 'crate-01'), null)
    assert.ok(near(worldT(som, 'crate-01'), w0))
    const old = h.undo
    run(h, 'redo')
    assert.equal(parentName(som, 'crate-01'), 'group-01', 'regrouped')
    assert.ok(old === h.undo)
    run(h, 'undo')
    assert.equal(som.getNodeByName('group-01'), null)
  })

  test('the wait for the group’s add (review S9): refused "already in use", nothing moves until the retry’s add is accepted', async () => {
    const som = await world()
    const h = harness(som)
    const crate = som.getNodeByName('crate-01')
    const plan = groupPlan(crate, { isFree: (x) => som.checkNewName(x).ok })
    assert.equal(plan.descriptor.name, 'group-01')
    assert.equal(h.undo.group(crate, plan), true)
    // another tab takes the name before our add reaches the server
    som.scene.addChild(som.ingestNode({ name: 'group-01' }))
    h.answer(h.pending[0])                                         // refused: already in use
    assert.equal([...h.info.values()].filter((i) => i.kind === 'move').length, 0, 'no move was sent')
    assert.equal(h.info.get(h.pending[0]).req.descriptor.name, 'group-02', 'the retry uses the next free name')
    h.settle()
    assert.equal(parentName(som, 'crate-01'), 'group-02', 'the object ends in the retry’s group')
    assert.equal(som.getNodeByName('group-01').children.length, 0, 'the other tab’s group-01 got nothing')
  })

  test('a refused move removes the empty group again, and nothing is recorded', async () => {
    const som = await world()
    const h = harness(som)
    h.refuse.push({ test: (i) => i.kind === 'move', text: 'INVALID_VALUE: this would change which behaviours can move it' })
    group(h, som, 'crate-01')
    assert.equal(som.getNodeByName('group-01'), null, 'cleaned up')
    assert.equal(h.undo.undoCount, 0)
    assert.match(h.messages.at(-1), /Couldn’t group: INVALID_VALUE/)
  })

  test('N5: Group’s continuation completes with Edit mode turned off after the add', async () => {
    const som = await world()
    let on = true
    const h = harness(som, { editOn: () => on })
    const crate = som.getNodeByName('crate-01')
    assert.equal(h.undo.group(crate, groupPlan(crate, { isFree: (x) => som.checkNewName(x).ok })), true)
    h.answer(h.pending[0])
    on = false
    h.settle()
    assert.equal(parentName(som, 'crate-01'), 'group-01')
    assert.equal(h.undo.undoCount, 1)
  })

  test('undo is refused when the group gained a part elsewhere ("changed elsewhere")', async () => {
    const som = await world()
    const h = harness(som)
    group(h, som, 'crate-01')
    h.remoteMove('lamp-01', 'group-01')
    assert.equal(h.undo.run('undo'), false)
    assert.match(h.messages.at(-1), /Can’t undo: “group-01” was changed elsewhere/)
  })
})

describe('GR7: Ungroup', () => {
  test('do, undo, redo on lamp-01: the parts stay put, the group goes and comes back with both parts inside, exact', async () => {
    const som = await world()
    const h = harness(som)
    const shade = som.getNodeByName('lamp-shade'), stand = som.getNodeByName('lamp-stand')
    const before = { shade: [...shade.translation], stand: [...stand.translation] }
    const w = { shade: worldT(som, 'lamp-shade'), stand: worldT(som, 'lamp-stand') }
    const firstPart = som.getNodeByName('lamp-01').children[0].name
    ungroup(h, som, 'lamp-01')
    assert.equal(som.getNodeByName('lamp-01'), null, 'the group is deleted')
    assert.equal(parentName(som, 'lamp-shade'), null)
    assert.ok(near(worldT(som, 'lamp-shade'), w.shade) && near(worldT(som, 'lamp-stand'), w.stand), 'nothing moved')
    assert.deepEqual(h.undo.undoLabels, ['Ungroup “lamp-01”'])
    assert.equal(h.selected.at(-1), firstPart, 'the first part is selected')
    run(h, 'undo')
    assert.equal(parentName(som, 'lamp-shade'), 'lamp-01')
    assert.equal(parentName(som, 'lamp-stand'), 'lamp-01')
    assert.deepEqual([...som.getNodeByName('lamp-shade').translation], before.shade, 'exact')
    assert.deepEqual([...som.getNodeByName('lamp-stand').translation], before.stand)
    run(h, 'redo')
    assert.equal(som.getNodeByName('lamp-01'), null)
    run(h, 'undo')
    assert.equal(parentName(som, 'lamp-stand'), 'lamp-01')
  })

  test('"Ungroup (partly)": a refused part stays, the group stays, the accepted move is recorded and undoes', async () => {
    const som = await world()
    const h = harness(som)
    h.refuse.push({ test: (i) => i.kind === 'move' && i.name === 'lamp-stand' && i.dir === 'do', text: 'INVALID_VALUE: refused' })
    ungroup(h, som, 'lamp-01')
    assert.ok(som.getNodeByName('lamp-01'), 'the group stays')
    assert.equal(parentName(som, 'lamp-shade'), null)
    assert.equal(parentName(som, 'lamp-stand'), 'lamp-01')
    assert.deepEqual(h.undo.undoLabels, ['Ungroup (partly) “lamp-01”'])
    assert.match(h.messages.at(-1), /Ungroup stopped: “lamp-stand” stayed in the group/)
    run(h, 'undo')
    assert.equal(parentName(som, 'lamp-shade'), 'lamp-01')
  })

  test('GR-L7 (a): an undo the server stops halfway names the part and drops the entry', async () => {
    const som = await world()
    const h = harness(som)
    ungroup(h, som, 'lamp-01')
    h.refuse.push({ test: (i) => i.kind === 'move' && i.name === 'lamp-stand' && i.dir === 'undo', text: 'INVALID_VALUE: raced' })
    run(h, 'undo')
    assert.equal(h.undo.undoCount, 0, 'dropped')
    assert.equal(h.undo.redoCount, 0)
    assert.match(h.messages.at(-1), /Undo stopped: “lamp-stand” changed elsewhere \(INVALID_VALUE: raced\)/)
    assert.equal(parentName(som, 'lamp-shade'), 'lamp-01', 'what was accepted stands')
  })
})

describe('GR7: older entries after a composite (review M2, r5)', () => {
  test('r5: Delete a part, Ungroup, Undo, Undo: the Delete’s Undo puts it back into the re-added group', async () => {
    const som = await world()
    const h = harness(som)
    const s = h.clickDelete(som.getNodeByName('lamp-shade'))
    h.answerPlain(s)
    ungroup(h, som, 'lamp-01')
    run(h, 'undo')                     // lamp-01 is back, a NEW node, holding lamp-stand
    run(h, 'undo')                     // the Delete's Undo
    assert.equal(parentName(som, 'lamp-shade'), 'lamp-01', h.messages.join(' | '))
    assert.equal(h.undo.undoCount, 0)
    assert.equal(h.undo.redoCount, 2)
  })

  test('a Move into a group, Ungroup, Undo, Undo', async () => {
    const som = await world()
    const h = harness(som)
    moveTo(h, som, 'crate-01', 'lamp-01')
    ungroup(h, som, 'lamp-01')
    run(h, 'undo'); run(h, 'undo')
    assert.equal(parentName(som, 'crate-01'), null, h.messages.join(' | '))
    assert.equal(h.undo.redoCount, 2)
  })

  test('a drag of the group, Ungroup, Undo, Undo', async () => {
    const som = await world()
    const h = harness(som)
    const lamp = som.getNodeByName('lamp-01')
    const t0 = [...lamp.translation]
    lamp.translation = [t0[0] + 1, t0[1], t0[2]]
    h.undo.onTransformsSettled([{ node: lamp, changes: [{ field: 'translation', from: t0, to: [...lamp.translation] }] }])
    ungroup(h, som, 'lamp-01')
    run(h, 'undo'); run(h, 'undo')
    assert.deepEqual([...som.getNodeByName('lamp-01').translation], t0, h.messages.join(' | '))
  })

  test('Group, Move to the top level, Undo, Undo: the group stays empty between, then holds the object again', async () => {
    const som = await world()
    const h = harness(som)
    group(h, som, 'crate-01')
    moveTo(h, som, 'crate-01', null)
    assert.ok(som.getNodeByName('group-01'), 'an emptied group is kept (GR-L8 (c))')
    run(h, 'undo')
    assert.equal(parentName(som, 'crate-01'), 'group-01')
    run(h, 'undo')
    assert.equal(som.getNodeByName('group-01'), null)
    assert.equal(parentName(som, 'crate-01'), null)
  })

  test('an older Move to before a Group still undoes after the Group’s undo', async () => {
    const som = await world()
    const h = harness(som)
    moveTo(h, som, 'crate-01', 'lamp-01')
    group(h, som, 'lamp-01')
    run(h, 'undo'); run(h, 'undo')
    assert.equal(parentName(som, 'crate-01'), null)
    assert.equal(parentName(som, 'lamp-01'), null)
  })
})

describe('GR7: the pending-delete fix (fresh check must-fix 1, f2)', () => {
  test('A: a delete pending while another tab moves the node: Undo restores it in the right place', async () => {
    const som = await world()
    const h = harness(som)
    const w0 = worldT(som, 'crate-01')
    const s = h.clickDelete(som.getNodeByName('crate-01'))
    h.remoteMove('crate-01', 'lamp-01')         // reaches the server first
    h.answerPlain(s)
    run(h, 'undo')
    assert.equal(parentName(som, 'crate-01'), 'lamp-01', 'back where it was when deleted')
    assert.ok(near(worldT(som, 'crate-01'), w0), `world ${worldT(som, 'crate-01')} vs ${w0}`)
  })

  test('B: an Undo of a Duplicate pending while another tab moves the copy: Redo re-adds it in the right place', async () => {
    const som = await world()
    const h = harness(som)
    const crate = som.getNodeByName('crate-01')
    const dup = prepareDuplicate(crate._node, { name: 'crate-02', isFree: (n) => som.checkNewName(n).ok, trees: true })
    som.scene.addChild(som.ingestNode(dup.descriptor))
    h.undo.registerAdd(900, { name: 'crate-02', duplicate: true })
    h.undo.onStructureAnswer({ request: { seq: 900, name: 'crate-02' }, status: 'accepted', removedMessage: null })
    const w0 = worldT(som, 'crate-02')
    assert.equal(h.undo.run('undo'), true)
    h.remoteMove('crate-02', 'lamp-01')        // while the removal is pending
    h.settle()
    assert.equal(som.getNodeByName('crate-02'), null)
    run(h, 'redo')
    assert.equal(parentName(som, 'crate-02'), 'lamp-01')
    assert.ok(near(worldT(som, 'crate-02'), w0))
  })

  test('C (the re-read when the window opens): Delete, Undo, another tab moves it into a group at the origin (its values unchanged), Redo, Undo: it comes back inside that group', async () => {
    const som = await world()
    const h = harness(som)
    som.scene.addChild(som.ingestNode({ name: 'group-09' }))
    const w0 = worldT(som, 'crate-01')
    const s = h.clickDelete(som.getNodeByName('crate-01'))
    h.answerPlain(s)
    run(h, 'undo')                              // re-added at the top level
    h.remoteMove('crate-01', 'group-09')        // before the Redo: no window is open; same local values
    run(h, 'redo')                              // the delete again: the window opens now
    assert.equal(som.getNodeByName('crate-01'), null)
    run(h, 'undo')
    assert.equal(parentName(som, 'crate-01'), 'group-09', 'back where it was when deleted')
    assert.ok(near(worldT(som, 'crate-01'), w0), `world ${worldT(som, 'crate-01')} vs ${w0}`)
  })
})

describe('GR7: a later step that can’t be sent (the code check’s must-fix 1)', () => {
  const answerMoves = (h) => { while (h.pending.length > 0 && h.info.get(h.pending[0]).kind === 'move') h.answer(h.pending[0]) }

  test('Ungroup: the moves land, the group’s remove can’t be sent: “Ungroup (partly)” is recorded, nothing stays in flight, and its Undo puts the parts back', async () => {
    const som = await world()
    const h = harness(som)
    const lamp = som.getNodeByName('lamp-01')
    const w = { stand: worldT(som, 'lamp-stand'), shade: worldT(som, 'lamp-shade') }
    const plan = ungroupPlan(lamp)
    assert.equal(h.undo.ungroup(lamp, plan), true)
    h.busy.structural = true                   // another request takes the slot
    answerMoves(h)
    assert.equal(h.undo.inFlight(), false, 'not stuck')
    assert.equal(h.pending.length, 0, 'no remove was sent')
    assert.deepEqual(h.undo.undoLabels, ['Ungroup (partly) “lamp-01”'])
    assert.match(h.messages.at(-1), /another request was still waiting for the server/)
    assert.ok(som.getNodeByName('lamp-01'), 'the group stays, empty')
    assert.equal(parentName(som, 'lamp-stand'), null)
    h.busy.structural = false
    run(h, 'undo')
    assert.equal(parentName(som, 'lamp-stand'), 'lamp-01')
    assert.equal(parentName(som, 'lamp-shade'), 'lamp-01')
    assert.ok(near(worldT(som, 'lamp-stand'), w.stand) && near(worldT(som, 'lamp-shade'), w.shade))
  })

  test('Undo of a Group: the object moves out, the group’s remove can’t be sent: the Undo stops and says so, nothing stays in flight', async () => {
    const som = await world()
    const h = harness(som)
    group(h, som, 'crate-01')
    assert.equal(h.undo.run('undo'), true)
    h.busy.structural = true
    answerMoves(h)
    assert.equal(h.undo.inFlight(), false, 'not stuck')
    assert.equal(parentName(som, 'crate-01'), null, 'the move out was done')
    assert.match(h.messages.at(-1), /another request was still waiting for the server/)
    assert.equal(h.undo.undoCount + h.undo.redoCount, 0, 'the entry is dropped (GR-L7 (a))')
  })
})

describe('GR7: a re-add the bounds would refuse is not started (review M1; the code check’s finding 4)', () => {
  test('Delete a part of a group just over 256 nodes, then Undo: refused before sending, with GR4’s reason', async () => {
    const som = await world()
    const h = harness(som)
    const big = som.ingestNode({ name: 'big' })
    som.scene.addChild(big)
    for (let i = 0; i < 256; i++) big.addChild(som.ingestNode({ name: `big-${i}` }))
    const part = som.getNodeByName('big-0')
    const s = h.clickDelete(part)
    h.answerPlain(s)
    assert.equal(h.undo.undoCount, 1)
    const before = h.sent().length
    assert.equal(h.undo.run('undo'), false)
    assert.equal(h.sent().length, before, 'nothing sent')
    assert.match(h.messages.at(-1), /Can’t undo: “big-0” the group would be too large to copy\./)
  })

  test('a Delete in a 256-node tree still undoes (it was not over before)', async () => {
    const som = await world()
    const h = harness(som)
    const big = som.ingestNode({ name: 'big' })
    som.scene.addChild(big)
    for (let i = 0; i < 255; i++) big.addChild(som.ingestNode({ name: `big-${i}` }))
    const s = h.clickDelete(som.getNodeByName('big-0'))
    h.answerPlain(s)
    run(h, 'undo')
    assert.equal(parentName(som, 'big-0'), 'big')
  })
})

describe('GR7: out of step', () => {
  test('a move accepted but not applied here clears both stacks (U15 for a move)', async () => {
    const som = await world()
    const h = harness(som)
    moveTo(h, som, 'crate-01', 'lamp-01')
    assert.equal(h.undo.run('undo'), true)
    const s = h.pending[0]
    h.info.delete(s); h.pending.length = 0
    h.undo.onAccepted(s, { applied: false, landed: null })
    assert.equal(h.undo.undoCount + h.undo.redoCount, 0)
    assert.equal(h.messages.at(-1), OUT_OF_STEP_MESSAGE)
    assert.equal(h.undo.inFlight(), false)
  })
})
