// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// graph-import-panel.test.js — scripting-4d-1 G6, the importer's panel.
// No DOM: the strict element fake (V12) and a `createElement` dep, so the
// panel's own decisions are tested — and so a hostile string cannot pass as
// HTML, because the fake has no `innerHTML` at all.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createGraphImportPanel, IMPORT_OPEN_LABEL, CHOOSE_TARGET, SAVED, NO_GRAPH_YET,
} from '../src/graph-import-panel.js'
import { behaviorCheck } from '@atrium/behaviors/behavior-spec'
import { el } from './strict-element.mjs'

const OWN = '11111111-1111-4111-8111-111111111111'
const TGT = '22222222-2222-4222-8222-222222222222'
const THIRD = '33333333-3333-4333-8333-333333333333'

const T = { bool: 0, int: 1, float: 2, float3: 3, float4: 4, ref: 5 }
const lit = (type, value) => ({ type, value: Array.isArray(value) ? value : [value] })
const bytesOf = (value) => new TextEncoder().encode(JSON.stringify(value))

/** A graph that writes the file's node 5, named, with named variables. */
function sourceDocument({ nodeName = 'Pass', fileName = '' } = {}) {
  const graph = {
    types: [
      { signature: 'bool' }, { signature: 'int' }, { signature: 'float' },
      { signature: 'float3' }, { signature: 'float4' }, { signature: 'ref' },
    ],
    declarations: [
      { op: 'event/onStart' },
      { op: 'pointer/set' },
      // An op Atrium does not run, declared WITH an extension, so the engine's
      // validator accepts the graph and `graphReport` reports it unsupported.
      { op: 'event/onHoverIn', extension: 'EXT_probe' },
    ],
    nodes: [
      { declaration: 0, flows: { out: { node: 1, socket: 'in' } } },
      {
        declaration: 1,
        configuration: { pointer: lit(T.ref, '/nodes/5/translation'), type: lit(T.int, T.float3) },
        values: { value: lit(T.float3, [0, 0, 0.8]) },
      },
      { declaration: 2 },
    ],
    variables: [{ type: T.int, name: 'TestResult_x', value: [1] }],
    events: [{ id: 'test/onStart', name: 'test/onStart' }],
  }
  return {
    asset: { version: '2.0' },
    extensions: { KHR_interactivity: { graphs: [graph] } },
    nodes: [{ name: 'Exporter' }, { name: 'Quad' }, { name: nodeName }, { name: 'Fail' }],
    ...(fileName ? {} : {}),
  }
}

function panelElements() {
  return {
    open: el('button'), panel: el(), file: el('input'), fileName: el(),
    graphs: el('select'), source: el(), mapping: el(), report: el(), grants: el(),
    notes: el(), status: el(), save: el('button'), close: el('button'),
  }
}

function setup({ nodes, selected = null, answers = 'accept' } = {}) {
  const elements = panelElements()
  const calls = { setObjectId: [], sendField: [] }
  let seq = 0
  const record = (kind, args) => { calls[kind].push(args); seq += 1; return seq }
  const deps = {
    selected: () => selected,
    nodes: () => nodes,
    write: {
      setObjectId: (name, id) => record('setObjectId', { name, id }),
      sendField: (name, field, value) => record('sendField', { name, field, value }),
    },
    newObjectId: () => OWN,
    showError: () => {},
    clearError: () => {},
    onSaved: () => { deps.saved = (deps.saved ?? 0) + 1 },
    createElement: (tag) => el(tag),
  }
  const panel = createGraphImportPanel({ elements, deps })
  panel.wire()
  return { panel, elements, calls, deps }
}

const rowsOf = (elements) => elements.mapping.children
const controlsOf = (row) => row.children.find((child) => child.tagName === 'select')

test('G6 — open and close move the panel and the button, and the button says what it does', () => {
  const { panel, elements } = setup({ nodes: [] })
  assert.equal(IMPORT_OPEN_LABEL, 'Import a graph…')
  panel.open()
  assert.equal(elements.panel.style.display, '')
  assert.equal(elements.open.style.display, 'none')
  panel.close()
  assert.equal(elements.panel.style.display, 'none')
  assert.equal(elements.open.style.display, '')
})

test('G6 — a source is parsed, its graph picked, and one row drawn per reference', () => {
  const { panel, elements } = setup({ nodes: [] })
  panel.open()
  assert.equal(elements.status.textContent, NO_GRAPH_YET)

  const chosen = panel.chooseSource(bytesOf(sourceDocument()), 'asset.gltf')
  assert.equal(chosen.problem, undefined)
  assert.equal(elements.graphs.children.length, 1)
  assert.equal(elements.fileName.textContent, 'asset.gltf')
  // One row for the file's node 5, and nothing else: the graph has one pointer.
  const rows = rowsOf(elements)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].children[0].textContent, 'node 5 (node)')
  assert.equal(controlsOf(rows[0]).children[0].textContent, CHOOSE_TARGET)
  assert.equal(elements.status.textContent, CHOOSE_TARGET)
  assert.equal(elements.save.disabled, true)
})

test('G6 — a problem source shows its problem and draws no rows', () => {
  const { panel, elements } = setup({ nodes: [] })
  panel.open()
  panel.chooseSource(new TextEncoder().encode('{ nope'), 'broken.gltf')
  assert.match(elements.status.textContent, /not JSON/)
  assert.equal(rowsOf(elements).length, 0)
  assert.equal(elements.save.disabled, true)
})

test('G6 — the mapping is by hand: the row offers the SOM, filtered by kind', () => {
  const own = { name: 'Cube', extras: { atrium: {} } }
  const target = { name: 'Pass', extras: { atrium: { objectId: TGT } } }
  const light = { name: 'Key', light: { intensity: 1 }, extras: { atrium: { objectId: THIRD } } }
  const { panel, elements } = setup({ nodes: [own, target, light], selected: own })
  panel.open()
  panel.chooseSource(bytesOf(sourceDocument()), 'asset.gltf')

  const picker = controlsOf(rowsOf(elements)[0])
  assert.deepEqual(picker.children.map((option) => option.value), ['', 'name:Cube', TGT, THIRD])
  assert.deepEqual(picker.children.map((option) => option.textContent), [CHOOSE_TARGET, 'Cube', 'Pass', 'Key'])
})

test('G6 — a full mapping converts: the report, the grants, the notes and Save', () => {
  const own = { name: 'Cube', extras: { atrium: {} } }
  const target = { name: 'Pass', extras: { atrium: { objectId: TGT } } }
  const { panel, elements } = setup({ nodes: [own, target], selected: own })
  panel.open()
  panel.chooseSource(bytesOf(sourceDocument()), 'asset.gltf')
  panel.setTarget('node', 5, TGT)

  const report = panel.state.conversion.report
  assert.equal(report.namesDropped, 2)                     // one event, one variable
  assert.deepEqual(report.grants, [TGT])
  assert.equal(report.unsupported.length, 1)
  assert.equal(report.unsupported[0].op, 'event/onHoverIn')
  assert.equal(report.unsupported[0].extension, 'EXT_probe')
  assert.equal(report.startsOnLoad, true)
  assert.match(elements.report.textContent, /Unsupported: event\/onHoverIn \(EXT_probe\) ×1/)
  assert.match(elements.report.textContent, /names dropped: 2/)
  assert.equal(elements.grants.textContent, `It can change: ${TGT}`)
  assert.match(elements.notes.textContent, /This graph runs again whenever the owner reconnects/)
  assert.equal(elements.save.disabled, false)
  // The leaf the panel will send is the rule's.
  assert.equal(behaviorCheck(panel.state.conversion.value, { ownId: panel.state.conversion.value.nodeMap[0] }).problem, null)
})

test('G6 — Save gives a node with no objectId one first, then sends the leaf once', () => {
  const own = { name: 'Cube', extras: { atrium: {} } }
  const target = { name: 'Pass', extras: { atrium: { objectId: TGT } } }
  const { panel, elements, calls, deps } = setup({ nodes: [own, target], selected: own })
  panel.open()
  panel.chooseSource(bytesOf(sourceDocument()), 'asset.gltf')
  panel.setTarget('node', 5, TGT)

  const seq = panel.save()
  assert.equal(calls.setObjectId.length, 1)
  assert.deepEqual(calls.setObjectId[0], { name: 'Cube', id: OWN })
  assert.equal(calls.sendField.length, 0)
  assert.equal(seq, 1)

  panel.onAnswer('edit:accepted', { seq })
  assert.equal(calls.sendField.length, 1)
  assert.equal(calls.sendField[0].name, 'Cube')
  assert.equal(calls.sendField[0].field, 'extras.atrium.behavior')
  const leaf = calls.sendField[0].value
  assert.deepEqual(leaf.nodeMap, [OWN, TGT])
  assert.deepEqual(leaf.targets, [TGT])
  assert.equal(leaf.enabled, false)
  assert.equal(leaf.origin, 'local')
  assert.equal(leaf.kind, 'graph')
  assert.equal(behaviorCheck(leaf, { ownId: OWN }).problem, null)
  assert.equal(elements.save.disabled, true)

  panel.onAnswer('edit:accepted', { seq: calls.sendField[0].seq ?? 2 })
  assert.equal(elements.status.textContent, SAVED)
  assert.equal(deps.saved, 1)
  assert.equal(elements.panel.style.display, '')
})

test('G6 — a refusal is shown and nothing is left waiting', () => {
  const own = { name: 'Cube', extras: { atrium: { objectId: OWN } } }
  const target = { name: 'Pass', extras: { atrium: { objectId: TGT } } }
  const { panel, elements, calls } = setup({ nodes: [own, target], selected: own })
  panel.open()
  panel.chooseSource(bytesOf(sourceDocument()), 'asset.gltf')
  panel.setTarget('node', 5, TGT)

  const seq = panel.save()
  assert.equal(calls.setObjectId.length, 0, 'the node already has an id')
  assert.equal(calls.sendField.length, 1)
  panel.onAnswer('edit:rejected', { seq, message: 'this world’s behaviours would exceed 1 MiB' })
  assert.equal(elements.status.textContent, 'this world’s behaviours would exceed 1 MiB')
  assert.equal(elements.save.disabled, false)
})

test('G6 — a file input, and duplicate file names, are read by INDEX', async () => {
  const own = { name: 'Cube', extras: { atrium: { objectId: OWN } } }
  const { panel, elements } = setup({ nodes: [own], selected: own })
  panel.open()
  const doc = sourceDocument({ nodeName: 'Quad' })
  doc.nodes[1].name = 'Quad'
  const file = { name: 'asset.gltf', arrayBuffer: async () => bytesOf(doc).buffer }
  elements.file.files = [file]
  elements.file.dispatch('change', { target: elements.file })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(elements.fileName.textContent, 'asset.gltf')
  // The row names the file's node index, so two nodes called "Quad" are two rows.
  assert.equal(panel.state.parsed.fileNodes[1].name, 'Quad')
  assert.equal(panel.state.parsed.fileNodes[2].name, 'Quad')
  assert.equal(rowsOf(elements).length, 1)
})

test('G6 — a file name and a problem text that carry HTML all reach the DOM as TEXT', () => {
  const hostile = '<img src=x onerror=alert(1)>'
  const own = { name: hostile, extras: { atrium: { objectId: OWN } } }
  const { panel, elements } = setup({ nodes: [own], selected: own })
  panel.open()

  const doc = sourceDocument({ nodeName: hostile })
  panel.chooseSource(bytesOf(doc), `${hostile}.gltf`)

  // The file's NAME, and its node's name, are hostile strings.
  assert.equal(elements.fileName.textContent, `${hostile}.gltf`)
  const row = rowsOf(elements)[0]
  assert.equal(row.children[0].textContent, 'node 5 (node)')
  const picker = controlsOf(row)
  assert.equal(picker.children.some((option) => option.textContent === hostile), true)

  // A PROBLEM text that carries the same string: an `other` ref read by a node
  // that runs names itself in the refusal.
  const graph = {
    types: [{ signature: 'bool' }, { signature: 'int' }, { signature: 'float' }, { signature: 'float3' }, { signature: 'float4' }, { signature: 'ref' }],
    declarations: [{ op: 'ref/eq' }],
    nodes: [{ declaration: 0, values: { a: lit(T.ref, `/materials/${hostile}`), b: lit(T.ref, '/nodes/0') } }],
  }
  const bad = { asset: { version: '2.0' }, extensions: { KHR_interactivity: { graphs: [graph] } }, nodes: [] }
  panel.chooseSource(bytesOf(bad), 'bad.gltf')
  panel.setTarget('node', 0, OWN)
  assert.match(elements.status.textContent, new RegExp(hostile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.equal(panel.state.problem?.includes(hostile), true)
  assert.equal(elements.save.disabled, true)
})
