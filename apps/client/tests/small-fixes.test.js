// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// small-fixes.test.js — PREBRIEF-small-fixes.md's unit checks:
//   SF-1 R1  ownLoginPlan (this tab's own sign-in and the world connection);
//   SF-2 R4  setIfChanged (the Edit panel writes only changes);
//   SF-3 R7–R11  the graph import panel's id-less targets.
// The panel runs on the strict element fake, as graph-import-panel.test.js.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { ownLoginPlan } from '../src/auth-sync.js'
import { setIfChanged } from '../src/dom-write.js'
import { createGraphImportPanel, TARGET_GONE, SAVED, CHOOSE_TARGET } from '../src/graph-import-panel.js'
import { behaviorCheck } from '@atrium/behaviors/behavior-spec'
import { el, elementsFor } from './strict-element.mjs'
import { createBehaviorForm } from '../src/behavior-form.js'

// ===========================================================================
// SF-1 — R1
// ===========================================================================

describe('SF-1 R1 ownLoginPlan', () => {
  const alice = { id: 'u-alice', username: 'alice' }
  const W = 'wss://example.com/worlds/bob/home'

  test('no user id: nothing (the honeypot never gets here, a bad answer neither)', () => {
    assert.deepEqual(ownLoginPlan({ user: null, connected: true, sameOrigin: true, worldUrl: W }), { action: 'none' })
    assert.deepEqual(ownLoginPlan({ user: {}, connected: false }), { action: 'none' })
  })
  test('not connected: the home world, as before', () => {
    assert.deepEqual(ownLoginPlan({ user: alice, connected: false, sameOrigin: false, worldUrl: null }), { action: 'home' })
  })
  test('connected cross-origin: nothing (anonymous anyway, as I4 leaves it)', () => {
    assert.deepEqual(ownLoginPlan({ user: alice, connected: true, sameOrigin: false, admittedUserId: null, worldUrl: W }), { action: 'none' })
  })
  test('connected same-origin, admitted as this user: nothing', () => {
    assert.deepEqual(ownLoginPlan({ user: alice, connected: true, sameOrigin: true, admittedUserId: 'u-alice', worldUrl: W }), { action: 'none' })
  })
  test('connected same-origin as a guest: reconnect to the SAME world (SF-L1 (a))', () => {
    assert.deepEqual(ownLoginPlan({ user: alice, connected: true, sameOrigin: true, admittedUserId: null, worldUrl: W }),
      { action: 'reconnect', url: W })
  })
  test('admitted as someone else, or unknown: reconnect too', () => {
    assert.equal(ownLoginPlan({ user: alice, connected: true, sameOrigin: true, admittedUserId: 'u-bob', worldUrl: W }).action, 'reconnect')
    assert.equal(ownLoginPlan({ user: alice, connected: true, sameOrigin: true, admittedUserId: undefined, worldUrl: W }).action, 'reconnect')
  })
  test('connected with no world URL known: the home world', () => {
    assert.deepEqual(ownLoginPlan({ user: alice, connected: true, sameOrigin: true, admittedUserId: null, worldUrl: '' }), { action: 'home' })
  })

  test('app.js: the login submit asks the plan, and no longer calls the home autoconnect unconditionally', () => {
    const src = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    const at = src.indexOf('async function handleAuthSubmit')
    const body = src.slice(at, src.indexOf('\nfunction toggleAuthMode', at))
    assert.match(body, /ownLoginPlan\(\{/)
    assert.match(body, /plan\.action === 'home'\) autoConnectToHomeWorld\(result\)/)
    assert.match(body, /plan\.action === 'reconnect'\) reconnectSignedIn\(plan\.url, result\)/)
    assert.doesNotMatch(body, /if \(result && result\.id\) \{\s*autoConnectToHomeWorld/)
    // the honeypot branch still returns before any of it
    assert.ok(body.indexOf('if (isHoneypot)') < body.indexOf('ownLoginPlan('))
  })
})

// ===========================================================================
// SF-2 — R4
// ===========================================================================

describe('SF-2 R4 setIfChanged', () => {
  /** An element whose property writes are counted. */
  function counted(initial = {}) {
    const writes = []
    const values = { disabled: false, title: '', textContent: '', ...initial }
    const style = {}
    const element = { style }
    for (const key of Object.keys(values)) {
      Object.defineProperty(element, key, {
        get: () => values[key],
        set: (v) => { writes.push(key); values[key] = key === 'disabled' ? Boolean(v) : (v == null && key === 'textContent' ? '' : String(v)) },
      })
    }
    return { element, writes }
  }

  test('a value it already holds is not written; a new one is, once', () => {
    const { element, writes } = counted()
    assert.equal(setIfChanged(element, 'disabled', false), false)
    assert.equal(setIfChanged(element, 'title', ''), false)
    assert.equal(setIfChanged(element, 'disabled', true), true)
    assert.equal(setIfChanged(element, 'disabled', true), false)
    assert.equal(setIfChanged(element, 'title', 'Move the selected object into a group'), true)
    assert.equal(setIfChanged(element, 'title', 'Move the selected object into a group'), false)
    assert.deepEqual(writes, ['disabled', 'title'])
  })
  test('a title of null compares as the DOM stores it ("null"), textContent null as ""', () => {
    const { element, writes } = counted()
    setIfChanged(element, 'title', null); setIfChanged(element, 'title', null)
    setIfChanged(element, 'textContent', null)
    assert.deepEqual(writes, ['title'])
  })
  test('style.display reaches one level in', () => {
    const { element } = counted()
    assert.equal(setIfChanged(element, 'style.display', 'none'), true)
    assert.equal(element.style.display, 'none')
    assert.equal(setIfChanged(element, 'style.display', 'none'), false)
    assert.equal(setIfChanged(null, 'disabled', true), false)
  })

  test('app.js: refreshEditActions and refreshGroupActions write no property directly', () => {
    const src = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8')
    for (const name of ['function refreshEditActions()', 'function refreshGroupActions()']) {
      const at = src.indexOf(name)
      assert.ok(at >= 0, name)
      const body = src.slice(at, src.indexOf('\n}\n', at))
        .replace(/\/\/[^\n]*/g, '')
        // the hidden row's one-off reset is not on the per-set path
        .replace("if (!allowed) { epMoveNote.style.display = 'none'; refreshEmptyGroups(); emptyKey = null; return }", '')
      assert.doesNotMatch(body, /\.(disabled|title)\s*=[^=]/, `${name} writes disabled/title only through setIfChanged`)
      assert.doesNotMatch(body, /\.style\.display\s*=[^=]/, `${name} writes display only through setIfChanged`)
    }
  })
})

// ===========================================================================
// SF-3 — R7–R11
// ===========================================================================

const T = { bool: 0, int: 1, float: 2, float3: 3, float4: 4, ref: 5 }
const lit = (type, value) => ({ type, value: Array.isArray(value) ? value : [value] })
const bytesOf = (value) => new TextEncoder().encode(JSON.stringify(value))
const STAND_IN_RE = /^00000000-0000-4000-8000-/

/** A graph that sets the rotation of the file's nodes 0..n-1 on start. */
function source(n) {
  const nodes = [{ declaration: 0, flows: { out: { node: 1, socket: 'in' } } }]
  for (let i = 0; i < n; i += 1) {
    const node = {
      declaration: 1,
      configuration: { pointer: lit(T.ref, `/nodes/${i}/rotation`), type: lit(T.int, T.float4) },
      values: { value: lit(T.float4, [0, 0.0499792, 0, 0.9987503]) },
    }
    if (i < n - 1) node.flows = { out: { node: i + 2, socket: 'in' } }
    nodes.push(node)
  }
  return {
    asset: { version: '2.0' },
    extensions: {
      KHR_interactivity: {
        graphs: [{
          types: [{ signature: 'bool' }, { signature: 'int' }, { signature: 'float' },
            { signature: 'float3' }, { signature: 'float4' }, { signature: 'ref' }],
          declarations: [{ op: 'event/onStart' }, { op: 'pointer/set' }],
          nodes,
        }],
      },
    },
    nodes: Array.from({ length: n }, (_, i) => ({ name: `File${i}` })),
  }
}

const IDS = [
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
]
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

/**
 * The panel with a fake SOM: `setObjectId` records the call, and an accepted
 * answer (`accept`) gives the node its id as the echo would.
 */
function setup({ nodes, selected }) {
  const elements = {
    open: el('button'), panel: el(), file: el('input'), fileName: el(),
    graphs: el('select'), source: el(), mapping: el(), report: el(), grants: el(),
    notes: el(), status: el(), save: el('button'), close: el('button'),
  }
  const calls = { setObjectId: [], sendField: [] }
  const ids = [...IDS]
  let seq = 0
  const bySeq = new Map()
  const deps = {
    selected: () => selected,
    nodes: () => nodes,
    write: {
      setObjectId: (name, id) => { seq += 1; calls.setObjectId.push({ name, id, seq }); bySeq.set(seq, { name, id }); return seq },
      sendField: (name, field, value) => { seq += 1; calls.sendField.push({ name, field, value, seq }); return seq },
    },
    newObjectId: () => ids.shift(),
    showError: () => {},
    clearError: () => {},
    onSaved: () => { deps.saved = (deps.saved ?? 0) + 1 },
    createElement: (tag) => el(tag),
  }
  const panel = createGraphImportPanel({ elements, deps })
  panel.wire()
  const accept = (s) => {
    const set = bySeq.get(s)
    if (set) {
      const node = nodes.find((n) => n.name === set.name)
      node.extras.atrium.objectId = set.id
    }
    return panel.onAnswer('edit:accepted', { seq: s })
  }
  return { panel, elements, calls, deps, accept }
}

const node = (name, objectId) => ({ name, extras: { atrium: objectId ? { objectId } : {} } })
const pickers = (elements) => elements.mapping.children.map((row) => row.children.find((c) => c.tagName === 'select'))

describe('SF-3 the import panel and id-less targets', () => {
  test('R7: an id-less group targeting itself converts, and Save gives it ONE id then the leaf', () => {
    const group = node('group-01')
    const { panel, elements, calls, accept } = setup({ nodes: [group, node('Cube', OTHER)], selected: group })
    panel.open()
    panel.chooseSource(bytesOf(source(1)), '2-rotation.gltf')
    panel.setTarget('node', 0, 'name:group-01')
    assert.ok(panel.state.conversion, `it converts (was: ${panel.state.problem})`)
    assert.equal(elements.save.disabled, false)

    const s1 = panel.save()
    assert.deepEqual(calls.setObjectId.map((c) => c.name), ['group-01'])
    accept(s1)
    assert.equal(calls.setObjectId.length, 1, 'no second id for the same node')
    assert.equal(calls.sendField.length, 1)
    const leaf = calls.sendField[0].value
    assert.equal(leaf.nodeMap[0], IDS[0], 'the leaf names the group by the id it got')
    assert.ok(!JSON.stringify(leaf).match(/00000000-0000-4000-8000-/), 'no stand-in on the wire')
    assert.equal(behaviorCheck(leaf, { ownId: IDS[0] }).problem, null)
    accept(calls.sendField[0].seq)
    assert.equal(elements.status.textContent, SAVED)
  })

  test('R8/R9: two other id-less targets: stand-ins for the preview, then one stage each, then the leaf', () => {
    const own = node('Spinner', OTHER)
    const a = node('group-02')
    const b = node('group-03')
    const { panel, elements, calls, accept } = setup({ nodes: [own, a, b], selected: own })
    panel.open()
    panel.chooseSource(bytesOf(source(2)), 'two.gltf')
    panel.setTarget('node', 0, 'name:group-02')
    panel.setTarget('node', 1, 'name:group-03')
    const preview = panel.state.conversion.value
    const standIns = preview.nodeMap.filter((id) => STAND_IN_RE.test(id))
    assert.equal(new Set(standIns).size, 2, 'two distinct stand-ins in the preview')
    assert.equal(behaviorCheck(preview, { ownId: OTHER }).problem, null)

    const s1 = panel.save()
    assert.deepEqual(calls.setObjectId.map((c) => [c.name, c.id]), [['group-02', IDS[0]]])
    assert.equal(calls.sendField.length, 0)
    accept(s1)
    assert.deepEqual(calls.setObjectId.map((c) => c.name), ['group-02', 'group-03'])
    assert.equal(calls.sendField.length, 0)
    accept(calls.setObjectId[1].seq)
    assert.equal(calls.sendField.length, 1)
    const leaf = calls.sendField[0].value
    assert.deepEqual([...leaf.targets].sort(), [IDS[0], IDS[1]].sort())
    assert.equal(behaviorCheck(leaf, { ownId: OTHER }).problem, null)
    // R11 — the rows hold the ids now, and the pickers still show the choice
    assert.deepEqual(Object.values(panel.state.mapping).sort(), [IDS[0], IDS[1]].sort())
    assert.deepEqual(pickers(elements).map((p) => p.children.find((o) => o.selected)?.textContent), ['group-02', 'group-03'])
  })

  test('R10: a target removed before its stage cancels the Save; nothing more is sent', () => {
    const own = node('Spinner', OTHER)
    const a = node('group-02')
    const b = node('group-03')
    const nodes = [own, a, b]
    const { panel, elements, calls, accept } = setup({ nodes, selected: own })
    panel.open()
    panel.chooseSource(bytesOf(source(2)), 'two.gltf')
    panel.setTarget('node', 0, 'name:group-02')
    panel.setTarget('node', 1, 'name:group-03')
    const s1 = panel.save()
    nodes.splice(nodes.indexOf(b), 1)   // group-03 is deleted meanwhile
    accept(s1)
    assert.equal(calls.setObjectId.length, 1)
    assert.equal(calls.sendField.length, 0)
    assert.equal(elements.status.textContent, TARGET_GONE)
    assert.equal(panel.state.saving, false)
  })

  test('R10: a same-named replacement is not the target the click named', () => {
    const own = node('Spinner', OTHER)
    const nodes = [own, node('group-02'), node('group-03')]
    const { panel, elements, calls } = setup({ nodes, selected: own })
    panel.open()
    panel.chooseSource(bytesOf(source(2)), 'two.gltf')
    panel.setTarget('node', 0, 'name:group-02')
    panel.setTarget('node', 1, 'name:group-03')
    const s = panel.save()                 // the click holds both node objects
    assert.equal(calls.setObjectId[0].name, 'group-02')
    nodes[2] = node('group-03')            // removed and replaced by a node of the same name
    panel.onAnswer('edit:accepted', { seq: s })
    assert.equal(calls.setObjectId.length, 1, 'the impostor gets no id')
    assert.equal(calls.sendField.length, 0)
    assert.equal(elements.status.textContent, TARGET_GONE)
  })

  test('R10: a target given an id elsewhere before Save gets no second one', () => {
    const own = node('Spinner', OTHER)
    const a = node('group-02')
    const { panel, calls } = setup({ nodes: [own, a], selected: own })
    panel.open()
    panel.chooseSource(bytesOf(source(1)), 'one.gltf')
    panel.setTarget('node', 0, 'name:group-02')
    a.extras.atrium.objectId = IDS[3]   // another tab's Save gave it one
    panel.save()
    assert.equal(calls.setObjectId.length, 0)
    assert.equal(calls.sendField.length, 1)
    assert.deepEqual(calls.sendField[0].value.targets, [IDS[3]])
  })

  test('a refused id is forgotten: the next Save asks for one again', () => {
    const own = node('Spinner', OTHER)
    const a = node('group-02')
    const { panel, calls } = setup({ nodes: [own, a], selected: own })
    panel.open()
    panel.chooseSource(bytesOf(source(1)), 'one.gltf')
    panel.setTarget('node', 0, 'name:group-02')
    const s = panel.save()
    panel.onAnswer('edit:rejected', { seq: s, message: 'no' })
    assert.equal(calls.sendField.length, 0)
    panel.save()
    assert.equal(calls.setObjectId.length, 2, 'asked again')
    assert.equal(calls.setObjectId[1].name, 'group-02')
  })

  test('an id-less own node and an id-less other target: own first, then the other', () => {
    const group = node('group-01')
    const other = node('group-02')
    const { panel, calls, accept } = setup({ nodes: [group, other], selected: group })
    panel.open()
    panel.chooseSource(bytesOf(source(2)), 'two.gltf')
    panel.setTarget('node', 0, 'name:group-01')
    panel.setTarget('node', 1, 'name:group-02')
    accept(panel.save())
    accept(calls.setObjectId[1].seq)
    assert.deepEqual(calls.setObjectId.map((c) => c.name), ['group-01', 'group-02'])
    const leaf = calls.sendField[0].value
    assert.equal(behaviorCheck(leaf, { ownId: IDS[0] }).problem, null)
    assert.ok(leaf.nodeMap.includes(IDS[1]))
  })

  test('the held value follows a node that got its id elsewhere, so its picker keeps the choice', () => {
    const own = node('Spinner', OTHER)
    const a = node('group-02')
    const { panel, elements } = setup({ nodes: [own, a], selected: own })
    panel.open()
    panel.chooseSource(bytesOf(source(1)), 'one.gltf')
    panel.setTarget('node', 0, 'name:group-02')
    a.extras.atrium.objectId = IDS[2]
    panel.render()
    const picker = pickers(elements)[0]
    assert.equal(picker.children.find((o) => o.selected)?.textContent, 'group-02')
    assert.notEqual(picker.children[0].textContent, CHOOSE_TARGET)
  })
})

describe('SF-3 after the fresh-agent code check', () => {
  test('finding 2: the own node removed mid-sequence cancels; nothing is sent for it', () => {
    const group = node('group-01')
    const other = node('group-02')
    const nodes = [group, other]
    const { panel, elements, calls } = setup({ nodes, selected: group })
    panel.open()
    panel.chooseSource(bytesOf(source(2)), 'two.gltf')
    panel.setTarget('node', 0, 'name:group-01')
    panel.setTarget('node', 1, 'name:group-02')
    const s1 = panel.save()
    nodes.splice(nodes.indexOf(group), 1)
    panel.onAnswer('edit:accepted', { seq: s1 })
    assert.equal(calls.setObjectId.length, 1)
    assert.equal(calls.sendField.length, 0)
    assert.equal(elements.status.textContent, TARGET_GONE)
  })

  test('finding 2: a target held by its id, removed while another stage is in flight, cancels', () => {
    const own = node('Spinner', OTHER)
    const cube = node('Cube', IDS[3])
    const g = node('group-02')
    const nodes = [own, cube, g]
    const { panel, elements, calls, accept } = setup({ nodes, selected: own })
    panel.open()
    panel.chooseSource(bytesOf(source(2)), 'two.gltf')
    panel.setTarget('node', 0, IDS[3])
    panel.setTarget('node', 1, 'name:group-02')
    const s1 = panel.save()
    nodes.splice(nodes.indexOf(cube), 1)
    accept(s1)
    assert.equal(calls.sendField.length, 0)
    assert.equal(elements.status.textContent, TARGET_GONE)
  })

  test('N-6: a target gone before Save says so, not "malformed"', () => {
    const own = node('Spinner', OTHER)
    const nodes = [own, node('group-02')]
    const { panel, elements, calls } = setup({ nodes, selected: own })
    panel.open()
    panel.chooseSource(bytesOf(source(1)), 'one.gltf')
    panel.setTarget('node', 0, 'name:group-02')
    nodes.pop()
    panel.convert(); panel.render()
    assert.equal(elements.status.textContent, TARGET_GONE)
    assert.equal(panel.save(), null)
    assert.equal(calls.setObjectId.length + calls.sendField.length, 0)
  })

  test('finding 3: an animation row on a model with no id converts, and Save gives the model its id', () => {
    const src = {
      asset: { version: '2.0' }, animations: [{ name: 'Walk', channels: [], samplers: [] }], nodes: [{ name: 'Fox' }],
      extensions: { KHR_interactivity: { graphs: [{
        types: [{ signature: 'bool' }, { signature: 'int' }, { signature: 'float' }, { signature: 'float3' }, { signature: 'float4' }, { signature: 'ref' }],
        declarations: [{ op: 'event/onStart' }, { op: 'animation/start' }],
        nodes: [{ declaration: 0, flows: { out: { node: 1, socket: 'in' } } },
          { declaration: 1, values: { animation: lit(T.ref, '/animations/0'), startTime: lit(T.float, 0), endTime: lit(T.float, 1), speed: lit(T.float, 1) } }],
      }] } },
    }
    const own = node('Spinner', OTHER)
    const fox = { name: 'fox-01', extras: { atrium: { model: { url: 'https://example.com/fox.glb' } } } }
    const { panel, calls, accept } = setup({ nodes: [own, fox], selected: own })
    panel.open()
    panel.chooseSource(bytesOf(src), 'anim.gltf')
    panel.setAnimationTarget(0, 'name:fox-01')
    assert.ok(panel.state.conversion, `it converts (was: ${panel.state.problem})`)
    const s1 = panel.save()
    assert.deepEqual(calls.setObjectId.map((c) => c.name), ['fox-01'])
    accept(s1)
    assert.equal(calls.sendField.length, 1)
    const leaf = calls.sendField[0].value
    assert.ok(!JSON.stringify(leaf).match(/00000000-0000-4000-8000-/), 'no stand-in on the wire')
    assert.ok(JSON.stringify(leaf).includes(IDS[0]), 'the model is named by the id it got')
    assert.equal(panel.state.animations[0].object, IDS[0], 'the row holds the id now')
  })
})

describe('SF-2 R5 the Behaviour form: an idle render writes nothing (the code check\'s finding 1)', () => {
  const OWN_ID = '11111111-1111-4111-8111-111111111111'
  const TGT_ID = '22222222-2222-4222-8222-222222222222'
  /** Count every append, remove, textContent and value write on the form's elements. */
  function counting(elements) {
    const ops = {}
    const bump = (k) => { ops[k] = (ops[k] ?? 0) + 1 }
    for (const [k, e] of Object.entries(elements)) {
      if (!e || typeof e !== 'object' || typeof e.appendChild !== 'function') continue
      const a = e.appendChild, r = e.removeChild
      e.appendChild = (c) => { bump(`${k}:append`); return a(c) }
      e.removeChild = (c) => { bump(`${k}:remove`); return r(c) }
      const d = Object.getOwnPropertyDescriptor(e, 'textContent')
      if (d?.set) Object.defineProperty(e, 'textContent', { get: d.get, set: (v) => { bump(`${k}:text`); d.set(v) }, configurable: true })
      let val = e.value
      Object.defineProperty(e, 'value', { get: () => val, set: (v) => { bump(`${k}:value`); val = v }, configurable: true })
    }
    return ops
  }
  function idle(behavior) {
    const target = { name: 'target', extras: { atrium: { objectId: TGT_ID } } }
    const own = { name: 'crate', extras: { atrium: { objectId: OWN_ID, ...(behavior ? { behavior } : {}) } } }
    const elements = elementsFor()
    const deps = {
      selected: () => own, nodes: () => [own, target], status: () => ({}),
      write: { setObjectId: () => 1, sendField: () => 2 }, newObjectId: () => '9',
      createElement: (t) => el(t), showError() {}, clearError() {},
      logLines: () => ['[t] tick 1', '[t] tick 2'], clipStatus: () => ({ known: false, clips: [] }),
    }
    const form = createBehaviorForm({ elements, deps })
    form.open(own)
    if (!behavior) form.onTemplateChange('select-visibility')
    form.render()
    const ops = counting(elements)
    for (let i = 0; i < 10; i += 1) form.render()   // ten som:set ticks, nothing changed
    return ops
  }
  test('a template (its target picker is not rebuilt)', () => {
    assert.deepEqual(idle(null), {})
  })
  test('a custom graph (the log lines are not rebuilt)', () => {
    assert.deepEqual(idle({ kind: 'graph', origin: 'local', enabled: true, graph: { declarations: [], nodes: [] }, nodeMap: [], targets: [], animations: [] }), {})
  })
})
