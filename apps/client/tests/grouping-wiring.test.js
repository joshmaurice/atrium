// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// grouping GR8 (PREBRIEF-grouping.md FINAL Rev 2, §5 "Wiring") — the app.js
// glue for Group, Ungroup, Move to and Empty groups. The page's own functions
// and handlers are LIFTED from app.js and RUN (subtree-add lesson 1), against
// a real SOMDocument and the real edit-group.js / edit-duplicate.js, with
// small DOM stand-ins. The rest is read as text.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as group from '../src/edit-group.js'
import { ownNodeProblem, isReferenced } from '../src/edit-duplicate.js'
import { treeBoundsProblem } from '../../../packages/client/src/add-spec.js'
import { createEditTracker } from '../src/edit-gesture.js'

const { NodeIO } = await import('../../../packages/som/node_modules/@gltf-transform/core/dist/index.modern.js')
const { SOMDocument } = await import('../../../packages/som/src/index.js')
const __dirname = dirname(fileURLToPath(import.meta.url))
const code = readFileSync(resolve(__dirname, '../src/app.js'), 'utf-8')
  .split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')
const fixture = (name) => resolve(__dirname, `../../../tests/fixtures/${name}`)
const world = async (name = 'space.gltf') => new SOMDocument(await new NodeIO().read(fixture(name)))

function functionText(name) {
  const at = code.search(new RegExp(`function ${name}\\s*\\(`))
  assert.ok(at >= 0, `app.js has a function ${name}()`)
  const open = code.indexOf('{', code.indexOf(')', at))
  let depth = 0
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++
    else if (code[i] === '}' && --depth === 0) return code.slice(at, i + 1)
  }
  throw new Error(`unbalanced ${name}`)
}
function blockFrom(start) {
  const at = code.indexOf(start)
  assert.ok(at >= 0, `app.js has ${start}`)
  return code.slice(at, code.indexOf('\n})', at) + 3)
}

/** A DOM element stand-in: style, a value, children (textContent = '' clears them), listeners. */
function el() {
  return {
    style: { display: '' }, value: '', disabled: false, title: '', children: [], handlers: {},
    get textContent() { return this._t ?? '' },
    set textContent(v) { this._t = v; this.children = [] },
    appendChild(c) { this.children.push(c) },
    addEventListener(type, fn) { this.handlers[type] = fn },
  }
}

const NAMES = [
  'groupingAllowed', 'groupRules', 'isAddressable', 'underOrIs', 'hasOwnSource', 'movableProblem', 'groupHint',
  'isGrantedTarget', 'ungroupHint', 'askUnundoable', 'moveListKey', 'buildMoveOptions', 'syncMoveOptions',
  'refreshEmptyGroups', 'refreshGroupActions',
]

/** The page's GR8 glue, lifted and bound to a small world. */
function page(som, { block = null, serverAddFields = 4 } = {}) {
  const env = {
    client: { som, serverAddFields, on: (ev, fn) => { (env.listeners[ev] ??= []).push(fn) } },
    listeners: {},
    modes: { edit: true },
    selected: null,
    inspected: null,
    gizmo: { dragging: false },
    activeGesture: null,
    compositeHold: false,
    structureStamp: 0,
    moveOptions: [], moveOptionsKey: null, emptyList: [], emptyKey: null,
    errors: [], calls: [],
    epGroupActions: el(), epGroup: el(), epUngroup: el(), epMoveRow: el(), epMoveTo: el(), epMoveNote: el(),
    epEmptyRow: el(), epEmptyGroups: el(),
    document: { createElement: () => ({ value: '', textContent: '' }) },
    window: { confirm: () => true },
    structure: { reparentSeen: () => env.calls.push('reparentSeen') },
    undo: { inFlight: () => false, doing: () => false, moveTo: (...a) => { env.calls.push(['moveTo', ...a]); return true }, group: () => true, ungroup: () => true },
    hold: { clear: () => env.calls.push('hold.clear') },
    editTracker: { remoteSet: () => {} },
    isEditExcluded: (n) => /^avatar-/.test(n.name),
    isTeleporter: (n) => n.extras?.atrium?.teleporter != null,
    structuralBlock: () => block,
    showEditError: (t) => env.errors.push(t),
    clearEditError: () => {},
    refreshEditActions: () => env.calls.push('refreshEditActions'),
    refreshEditPanel: () => env.calls.push('refreshEditPanel'),
    attachSelected: () => env.calls.push('attachSelected'),
    renderInspectPanel: () => env.calls.push('renderInspectPanel'),
    endHandleDrag: () => env.calls.push('endHandleDrag'),
    selectForEdit: (n) => env.calls.push(['selectForEdit', n?.name ?? null]),
    ownNodeProblem, isReferenced, treeBoundsProblem,
    ...group,
    ANIMATED_REASON: 'an animation moves it in local values',
    AFTER_DIALOG_MS: 50,
    clearSelectionErrors: () => {},
  }
  const api = new Function('env', `with (env) { ${NAMES.map(functionText).join('\n')}\n return { ${NAMES.join(', ')} } }`)(env)
  Object.assign(env, api)
  return env
}

const optionLabels = (select) => select.children.map((o) => o.textContent)

describe('GR8: the row’s enable rules', () => {
  test('r6: Group and Move to are disabled for an animated node (space-anim.gltf crate-01), enabled for a plain one', async () => {
    const som = await world('space-anim.gltf')
    const env = page(som)
    env.selected = som.getNodeByName('crate-01')
    env.refreshGroupActions()
    assert.equal(env.epGroup.disabled, true)
    assert.equal(env.epGroup.title, 'an animation moves it in local values')
    assert.equal(env.epMoveTo.disabled, true)
    const plain = som.nodes.find((n) => n.name !== 'crate-01' && n._node.getMesh() && !isReferenced(n._node))
    assert.ok(plain, 'the fixture has a plain object')
    env.selected = plain
    env.refreshGroupActions()
    assert.equal(env.epGroup.disabled, false, env.epGroup.title)
  })

  test('Ungroup: enabled for lamp-01 (a group with nothing of its own); disabled for an object with a shape, a hidden group, a group with a behaviour', async () => {
    const som = await world()
    const env = page(som)
    env.selected = som.getNodeByName('lamp-01')
    env.refreshGroupActions()
    assert.equal(env.epUngroup.disabled, false, env.epUngroup.title)
    env.selected = som.getNodeByName('crate-01')
    env.refreshGroupActions()
    assert.equal(env.epUngroup.title, 'It has nothing inside to take out')
    const lamp = som.getNodeByName('lamp-01')
    lamp.visible = false
    env.selected = lamp
    env.refreshGroupActions()
    assert.equal(env.epUngroup.title, 'Show the group first')
    lamp.visible = true
    lamp.extras = { atrium: { behavior: { enabled: false } } }
    env.refreshGroupActions()
    assert.equal(env.epUngroup.title, 'It has a behaviour')
  })

  test('a pending structural request (a Move to, Group or Ungroup in flight) disables the whole row with its reason', async () => {
    const som = await world()
    const env = page(som, { block: 'Waiting for the server…' })
    env.selected = som.getNodeByName('lamp-01')
    env.refreshGroupActions()
    for (const b of [env.epGroup, env.epUngroup, env.epMoveTo]) {
      assert.equal(b.disabled, true)
      assert.equal(b.title, 'Waiting for the server…')
    }
  })

  test('below level 4 (a rollback) the row and the Empty groups row are hidden', async () => {
    const som = await world()
    const env = page(som, { serverAddFields: 3 })
    env.selected = som.getNodeByName('lamp-01')
    env.refreshGroupActions()
    assert.equal(env.epGroupActions.style.display, 'none')
    assert.equal(env.epMoveRow.style.display, 'none')
    assert.equal(env.epEmptyRow.style.display, 'none')
  })

  test('the pending composite blocks everything a structural request blocks, and holds the runner (text)', () => {
    assert.match(functionText('structuralBlock'), /pending:\s+!!structure\.pending \|\| undo\.doing\(\)/)
    assert.match(functionText('editDispatchBlocked'), /undoing: undo\.inFlight\(\)/, 'the gizmo and the fields follow editDispatchBlocked')
    assert.match(code, /holdNode: \(node\) => \{\s*if \(!node\) return\s*hold\.hold\(node\)/)
    assert.match(functionText('refreshEditActions'), /if \(compositeHold && !undo\.inFlight\(\)\) \{ compositeHold = false; hold\.clear\(\) \}/, 'the answer releases the hold')
  })
})

describe('GR8: Move to', () => {
  test('the list is built when it opens, not again until its key changes; it holds node objects, values are indices', async () => {
    const som = await world()
    const env = page(som)
    env.selected = som.getNodeByName('crate-01')
    env.syncMoveOptions()
    const first = optionLabels(env.epMoveTo)
    assert.equal(first[0], 'Move to…')
    assert.ok(first.includes('lamp-01'), JSON.stringify(first))
    assert.ok(env.moveOptions.every((o) => o.node === null || o.node === som.getNodeByName(o.node.name)), 'node objects')
    assert.ok(env.epMoveTo.children.slice(1).every((o, i) => o.value === String(i)), 'indices, never names')
    env.epMoveTo.children.push({ marker: true })
    env.syncMoveOptions()
    assert.equal(env.epMoveTo.children.at(-1).marker, true, 'not rebuilt: the key is unchanged')
    env.structureStamp += 1
    env.syncMoveOptions()
    assert.equal(env.epMoveTo.children.some((c) => c.marker), false, 'rebuilt after a structural change')
  })

  test('harness c1: a Move to list that keeps the focus after a choice is rebuilt when the answer changes the structure; an unfocused one waits for its focus', async () => {
    const som = await world()
    const env = page(som)
    env.selected = som.getNodeByName('crate-01')
    env.syncMoveOptions()
    assert.ok(optionLabels(env.epMoveTo).includes('lamp-01'))
    assert.equal(optionLabels(env.epMoveTo).includes('Top level'), false, 'crate-01 is at the top level')
    // the move lands: crate-01 is inside lamp-01 now
    som.getNodeByName('lamp-01')._node.addChild(som.getNodeByName('crate-01')._node)
    env.structureStamp += 1
    env.refreshGroupActions()
    assert.equal(optionLabels(env.epMoveTo).includes('Top level'), false, 'not focused: left for the focus to rebuild')
    env.document.activeElement = env.epMoveTo
    env.refreshGroupActions()
    assert.ok(optionLabels(env.epMoveTo).includes('Top level'), JSON.stringify(optionLabels(env.epMoveTo)))
  })

  test('a som:set never rebuilds the Move to list (text: its handler only refreshes the Empty groups)', () => {
    const handler = blockFrom("client.on('som:set', ({ path }) => {")
    assert.equal(/buildMoveOptions|syncMoveOptions/.test(handler), false)
  })

  test('a chosen option is resolved to its node and checked again: a target gone since the list was built sends nothing', async () => {
    const som = await world()
    const env = page(som)
    env.selected = som.getNodeByName('crate-01')
    env.buildMoveOptions()
    const handlerCode = blockFrom("epMoveTo?.addEventListener('change'")
    new Function('env', `with (env) { ${handlerCode} }`)(env)
    const i = env.moveOptions.findIndex((o) => o.node?.name === 'lamp-01')
    som.removeSubtree(som.getNodeByName('lamp-01'))
    env.epMoveTo.value = String(i)
    env.epMoveTo.handlers.change()
    assert.equal(env.calls.some((c) => Array.isArray(c) && c[0] === 'moveTo'), false, 'nothing sent')
    assert.equal(env.errors.at(-1), 'That group is gone')
    assert.equal(env.epMoveTo.value, '', 'the select goes back to its label')
  })

  test('a valid choice starts the engine’s Move to with the node, the target and the move value', async () => {
    const som = await world()
    const env = page(som)
    env.selected = som.getNodeByName('crate-01')
    env.buildMoveOptions()
    new Function('env', `with (env) { ${blockFrom("epMoveTo?.addEventListener('change'")} }`)(env)
    env.epMoveTo.value = String(env.moveOptions.findIndex((o) => o.node?.name === 'lamp-01'))
    env.epMoveTo.handlers.change()
    const call = env.calls.find((c) => Array.isArray(c) && c[0] === 'moveTo')
    assert.ok(call, env.errors.join(' | '))
    assert.ok(call[1] === som.getNodeByName('crate-01') && call[2] === som.getNodeByName('lamp-01'))
    assert.deepEqual(Object.keys(call[3]).sort(), ['rotation', 'scale', 'translation'])
    assert.deepEqual(call[4], { record: true })
  })
})

describe('GR8: Empty groups', () => {
  test('hidden with none; appears when a move empties a group; a choice selects the node and resets the select', async () => {
    const som = await world()
    const env = page(som)
    env.refreshEmptyGroups()
    assert.equal(env.epEmptyRow.style.display, 'none', 'space.gltf has no bare node')
    const lamp = som.getNodeByName('lamp-01')
    for (const part of [...lamp.children]) som.reparentNode(part, null, { translation: [...part.translation], rotation: [...part.rotation], scale: [...part.scale] })
    env.emptyKey = null
    env.refreshEmptyGroups()
    assert.equal(env.epEmptyRow.style.display, '')
    assert.deepEqual(optionLabels(env.epEmptyGroups), ['Empty groups (1)', 'lamp-01'])
    new Function('env', `with (env) { ${blockFrom("epEmptyGroups?.addEventListener('change'")} }`)(env)
    env.epEmptyGroups.value = '0'
    env.epEmptyGroups.handlers.change()
    assert.deepEqual(env.calls.find((c) => Array.isArray(c) && c[0] === 'selectForEdit'), ['selectForEdit', 'lamp-01'])
    assert.equal(env.epEmptyGroups.value, '', 'it picks; it holds no state')
  })

  test('harness c5: another tab’s add, remove or rename refreshes the list at once (an undone Delete of an empty group, the last part deleted)', async () => {
    const som = await world()
    const env = page(som)
    new Function('env', `with (env) { ${code.match(/for \(const ev of \['som:add', 'som:remove', 'som:rename'\]\)[^\n]*/)[0]} }`)(env)
    env.refreshEmptyGroups()
    assert.equal(env.epEmptyRow.style.display, 'none')
    som.scene.addChild(som.ingestNode({ name: 'group-09' }))
    env.listeners['som:add'][0]({ nodeName: 'group-09' })
    assert.deepEqual(optionLabels(env.epEmptyGroups), ['Empty groups (1)', 'group-09'], 'a bare node another tab added')
    const lamp = som.getNodeByName('lamp-01')
    for (const part of [...lamp.children]) som.removeSubtree(part)
    env.listeners['som:remove'][0]({ nodeName: 'lamp-stand' })
    assert.deepEqual(optionLabels(env.epEmptyGroups), ['Empty groups (2)', 'group-09', 'lamp-01'], 'a group whose last part another tab deleted')
  })

  test('the DOM is rebuilt only when the key changes; the row waits while this tab’s own request is in flight', async () => {
    const som = await world()
    const env = page(som)
    const lamp = som.getNodeByName('lamp-01')
    for (const part of [...lamp.children]) som.reparentNode(part, null, { translation: [...part.translation], rotation: [...part.rotation], scale: [...part.scale] })
    env.refreshEmptyGroups()
    env.epEmptyGroups.children.push({ marker: true })
    env.refreshEmptyGroups()
    assert.equal(env.epEmptyGroups.children.at(-1).marker, true, 'same key: not rebuilt')
    env.undo.inFlight = () => true
    som.scene.addChild(som.ingestNode({ name: 'group-09' }))
    env.refreshEmptyGroups()
    assert.equal(env.epEmptyGroups.children.at(-1).marker, true, 'waits for this tab’s request')
  })
})

describe('GR8: som:reparent', () => {
  function reparentPage(som) {
    const env = page(som)
    new Function('env', `with (env) { ${blockFrom("client.on('som:reparent'")} }`)(env)
    return env
  }

  test('a gesture on the moved node is CANCELLED, not ended (second review S1, r7), then the drag ends and the panel refreshes', async () => {
    const som = await world()
    const env = reparentPage(som)
    const crate = som.getNodeByName('crate-01')
    const gesture = { node: crate, cancelled: false, ended: false, cancel() { this.cancelled = true }, end() { this.ended = true } }
    env.selected = crate
    env.activeGesture = gesture
    env.gizmo.dragging = true
    env.listeners['som:reparent'][0]({ nodeName: 'crate-01' })
    assert.equal(gesture.cancelled, true)
    assert.equal(gesture.ended, false, 'no final send of an old-frame value')
    assert.equal(env.activeGesture, null)
    const order = env.calls.filter((c) => typeof c === 'string')
    assert.ok(order.indexOf('hold.clear') < order.indexOf('endHandleDrag'), JSON.stringify(order))
    for (const c of ['reparentSeen', 'attachSelected', 'refreshEditPanel', 'refreshEditActions']) assert.ok(order.includes(c), c)
  })

  test('harness c3: a drag whose sends were all answered before another tab regrouped its node is not recorded (its records are marked as another session’s before the cancel)', async () => {
    const som = await world()
    const env = reparentPage(som)
    const crate = som.getNodeByName('crate-01')
    let t = 0
    let seq = 0
    const settled = []
    const tracker = createEditTracker({
      read: (n, f) => n[f],
      writeLocal: (n, f, v) => { n[f] = v },
      writeSend: (n, f, v) => { n[f] = v; return ++seq },
      onTransformsSettled: (results, info) => settled.push({ results, info }),
      now: () => t,
    })
    env.editTracker = tracker
    const gesture = tracker.begin(crate)
    t = 200
    gesture.update({ translation: [0.5, 0.25, 0] })
    assert.equal(seq, 1, 'the drag sent once')
    tracker.accepted(1)                       // every send answered: nothing pending
    // the reparent: the node's values are the new frame's
    som.getNodeByName('lamp-01')._node.addChild(crate._node)
    crate.translation = [-2.5, 0.25, 0]
    env.selected = crate
    env.activeGesture = gesture
    env.gizmo.dragging = true
    env.listeners['som:reparent'][0]({ nodeName: 'crate-01' })
    assert.equal(settled.length, 1, `${settled.length} batches`)
    assert.equal(settled[0].results.length, 0, `no entry for the cancelled drag (${settled[0].results.map((r) => r.changes.map((c) => c.field).join()).join('; ')})`)
    assert.equal(settled[0].info.remote, true)
    assert.deepEqual([...crate.translation], [-2.5, 0.25, 0], 'nothing written back')
  })

  test('a gesture on another node is left alone; the breadcrumb still refreshes', async () => {
    const som = await world()
    const env = reparentPage(som)
    const gesture = { node: som.getNodeByName('lamp-01'), cancel() { throw new Error('must not cancel') }, end() {} }
    env.selected = som.getNodeByName('crate-01')
    env.activeGesture = gesture
    env.listeners['som:reparent'][0]({ nodeName: 'crate-01' })
    assert.ok(env.activeGesture === gesture)
    assert.ok(env.calls.includes('refreshEditPanel'), 'the selectForEdit early return is not relied on (§2.4)')
  })
})

// ---------------------------------------------------------------------------
// The code check of de33cf8..9716caf (findings 1-4), each reproduced first
// ---------------------------------------------------------------------------

/** A top-level group `big` with `n` empty parts, in space.gltf. */
async function bigWorld(n) {
  const som = await world()
  const big = som.ingestNode({ name: 'big', translation: [-3, 0, 0] })
  som.scene.addChild(big)
  for (let i = 0; i < n; i++) big.addChild(som.ingestNode({ name: `big-${i}`, translation: [0, 0.25, 0] }))
  return som
}
/** Another tab's message, queued while the dialog is open: it lands after the handler's synchronous part. */
const queued = (fn) => setTimeout(fn, 0)

describe('the code check, finding 2: after an ask-first question, Ungroup and Move to plan from the values as they are NOW', () => {
  test('Ungroup of a 257-node group: another tab moves the group while the question is open; the parts keep the moved places', async () => {
    const som = await bigWorld(256)
    const env = page(som)
    let plan = null
    env.undo.ungroup = (node, p) => { plan = p; return true }
    env.window.confirm = () => { queued(() => { som.getNodeByName('big').translation = [-3, 0, 4] }); return true }
    new Function('env', `with (env) { ${blockFrom("epUngroup?.addEventListener('click'")} }`)(env)
    env.selected = som.getNodeByName('big')
    await env.epUngroup.handlers.click()
    assert.ok(plan, 'Ungroup was started')
    const part = plan.parts.find((p) => p.node.name === 'big-0')
    assert.deepEqual([...part.value.translation].map((v) => Math.round(v * 1e6) / 1e6), [-3, 0.25, 4], 'planned from the moved group')
  })

  test('Move to → Top level out of a 257-node tree: another tab moves the group while the question is open; the value is computed after', async () => {
    const som = await bigWorld(256)
    const env = page(som)
    let sent = null
    env.undo.moveTo = (node, target, value, opts) => { sent = { value, opts }; return true }
    env.window.confirm = () => { queued(() => { som.getNodeByName('big').translation = [-3, 0, 4] }); return true }
    env.selected = som.getNodeByName('big-0')
    env.buildMoveOptions()
    new Function('env', `with (env) { ${blockFrom("epMoveTo?.addEventListener('change'")} }`)(env)
    env.epMoveTo.value = String(env.moveOptions.findIndex((o) => o.node === null))
    await env.epMoveTo.handlers.change()
    assert.ok(sent, 'the move was started')
    assert.equal(sent.opts.record, false, 'asked first: not recorded')
    assert.deepEqual([...sent.value.translation].map((v) => Math.round(v * 1e6) / 1e6), [-3, 0.25, 4], 'the world place after the other tab’s move')
  })

  test('the selection changed while the question was open: nothing is sent', async () => {
    const som = await bigWorld(256)
    const env = page(som)
    let started = false
    env.undo.ungroup = () => { started = true; return true }
    env.window.confirm = () => { queued(() => { env.selected = som.getNodeByName('crate-01') }); return true }
    new Function('env', `with (env) { ${blockFrom("epUngroup?.addEventListener('click'")} }`)(env)
    env.selected = som.getNodeByName('big')
    await env.epUngroup.handlers.click()
    assert.equal(started, false)
  })
})

describe('the code check, finding 3: Ungroup’s own-node rule is the Delete capture’s, credit included', () => {
  test('a group with a malformed credit is not offered Ungroup (its removal could not be captured)', async () => {
    const som = await world()
    const env = page(som)
    const lamp = som.getNodeByName('lamp-01')
    lamp.extras = { atrium: { origin: 'not an object' } }
    env.selected = lamp
    env.refreshGroupActions()
    assert.equal(env.epUngroup.disabled, true)
    assert.match(env.epUngroup.title, /credit/)
  })
})

describe('the code check, finding 4: a Delete in a tree just over a GR4 bound asks first and is not recorded', () => {
  function deletePage(som) {
    const env = page(som)
    env.questions = []
    env.registered = []
    Object.assign(env, {
      epDelete: el(),
      countDescendants: (n) => n.children.length,
      collectSubtree: () => [],
      structure: { ...env.structure, begin: () => {} },
    })
    env.client.removeNode = () => 7
    env.undo.capture = () => ({ ok: true, descriptor: { name: 'x' } })
    env.undo.registerDelete = (seq, r) => env.registered.push(r)
    env.window.confirm = (q) => { env.questions.push(q); return true }
    new Function('env', `with (env) { ${blockFrom("epDelete.addEventListener('click'")} }`)(env)
    return env
  }

  test('a part of a 257-node group: asks with GR4’s reason, then registers no descriptor (not recorded, W5)', async () => {
    const som = await bigWorld(256)
    const env = deletePage(som)
    env.selected = som.getNodeByName('big-0')
    await env.epDelete.handlers.click()
    assert.equal(env.questions.length, 1)
    assert.match(env.questions[0], /This can’t be undone: the group would be too large to copy\./)
    assert.equal(env.registered.length, 1)
    assert.equal(env.registered[0].descriptor, null)
  })

  test('a part of a 256-node group: no question, the descriptor is kept (its Delete undoes)', async () => {
    const som = await bigWorld(255)
    const env = deletePage(som)
    env.selected = som.getNodeByName('big-0')
    await env.epDelete.handlers.click()
    assert.equal(env.questions.length, 0)
    assert.deepEqual(env.registered[0].descriptor, { name: 'x' })
  })
})

describe('the code check, finding 1: the structural dependency sends nothing while the slot is taken (text)', () => {
  test('structural returns null before calling the client when structure.pending is set', () => {
    assert.match(code, /structural: \(request, direction\) => \{\s*if \(structure\.pending\) return null\s*let seq/)
  })
})

describe('the code check, finding 1 (operator’s go, 2026-11-10): the Model form’s Save follows the edit block (text)', () => {
  test('the form gets dispatchAllowed from the same block the other forms use, and refreshEditActions re-renders it', () => {
    assert.match(blockFrom('modelForm = createModelForm({'), /dispatchAllowed: \(\) => modes\.edit && !editDispatchBlocked\(\),/)
    assert.match(functionText('refreshEditActions'), /const blocked = editDispatchBlocked\(\)\s*if \(modelForm\?\.isOpen\(\)\) modelForm\.render\(\)/)
  })
})
