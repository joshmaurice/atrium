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
