// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// behavior-spec.test.js — scripting-4b-2 step 2, F1's CLIENT copy.
//
// The vectors are the contract's own case list, shared with the server's test
// (packages/server/test/behavior-leaf.test.js) so the two copies of the rule
// cannot drift. Every ACCEPTED vector is run through the engine's
// `validateInteractivityGraph` as well as through the rule — §2.3's rule that
// the validator, not the loader, is the gate: a template that only
// `loadBehaveGraph` accepts is not one the server will store.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { validateInteractivityGraph } from '@khronosgroup/gltf-interactivity-engine'
import {
  behaviorProblem, behaviorCheck, behaviorReasonText, templateParamsOk,
  isExecutableDeclaration,
  BEHAVIOR_OPS, BEHAVIOR_EVENTS, BEHAVIOR_TEMPLATES, BEHAVIOR_MESSAGES,
  BEHAVIOR_NODES_MAX, BEHAVIOR_BYTES_MAX, BEHAVIOR_CLIP_MAX, BEHAVIOR_PROX_MIN, BEHAVIOR_PROX_MAX,
  BEHAVIOR_INTERVAL_MIN, BEHAVIOR_INTERVAL_MAX, BEHAVIOR_SPEED_MIN, BEHAVIOR_SPEED_MAX,
  BEHAVIOR_DECLS_MAX, BEHAVIOR_TYPES_MAX, BEHAVIOR_VARIABLES_MAX, BEHAVIOR_EVENTS_MAX, BEHAVIOR_STRING_MAX,
} from '../src/behavior-spec.js'
import { templateGraph, TEMPLATE_IDS, TEMPLATE_LABELS, TEMPLATE_FIELDS } from '../src/templates.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const VECTORS = JSON.parse(readFileSync(resolve(__dirname, '../../../tests/fixtures/behavior-vectors.json'), 'utf8'))

describe('F1 (client copy) — the shared vectors', () => {
  test('every accepted vector passes the rule', () => {
    assert.ok(VECTORS.accepted.length >= 15, 'the templates and their boundaries')
    for (const vector of VECTORS.accepted) {
      const problem = behaviorProblem(vector.value, { ownId: VECTORS.ownId })
      assert.equal(problem, null, `${vector.name}: expected accepted, got ${problem}`)
    }
  })

  test('every accepted vector is accepted by the ENGINE VALIDATOR too', () => {
    for (const vector of VECTORS.accepted) {
      assert.doesNotThrow(() => validateInteractivityGraph(vector.value.graph),
        `${vector.name}: the validator is the gate, not the loader`)
    }
  })

  test('every refused vector returns exactly its named reason code', () => {
    assert.ok(VECTORS.refused.length >= 50, 'the adversarial set')
    for (const vector of VECTORS.refused) {
      const problem = behaviorProblem(vector.value, { ownId: VECTORS.ownId })
      assert.equal(problem, vector.code, `${vector.name}: expected ${vector.code}, got ${problem}`)
    }
  })

  test('every reason code the vectors use has plain text of its own', () => {
    const codes = new Set([...VECTORS.refused.map((v) => v.code)])
    for (const code of codes) {
      assert.equal(typeof BEHAVIOR_MESSAGES[code], 'string', `${code} is a named code`)
      assert.notEqual(behaviorReasonText(code), 'the behaviour value is invalid', `${code}: text`)
    }
  })

  test('a value refused by the VALIDATOR carries the engine\'s own message', () => {
    const vector = VECTORS.refused.find((v) => v.name.includes('declaration index is out of range'))
    const check = behaviorCheck(vector.value, { ownId: VECTORS.ownId })
    assert.equal(check.problem, 'behavior-graph')
    assert.match(check.message, /graph is not a valid KHR_interactivity graph:/)
  })
})

describe('F1 (client copy) — the rules the vectors pin', () => {
  const base = VECTORS.accepted.find((v) => v.name === 'template: select-animation play').value
  const ownId = VECTORS.ownId

  test('the forbidden-key and depth walk runs BEFORE any shape rule', () => {
    // The value carries BOTH a forbidden key and a disallowed op; the walk wins.
    const value = { ...JSON.parse(JSON.stringify(base)), ['__proto__']: { x: 1 } }
    value.graph.declarations[0] = { op: 'flow/while' }
    assert.equal(behaviorProblem(value, { ownId }), 'behavior-type')
  })

  test('variables is optional; an empty array is refused (M4/G7)', () => {
    const value = JSON.parse(JSON.stringify(base))
    value.graph.variables = []
    assert.equal(behaviorProblem(value, { ownId }), 'behavior-size')
    delete value.graph.variables
    assert.equal(behaviorProblem(value, { ownId }), null)
  })

  test('the executable set is G-L2 (a)\'s core ops, less the four it does not run', () => {
    // G-L2 (a): every registered core op except these four, each as a bare core
    // declaration — plus event/onSelect exactly with its extension.
    for (const op of ['flow/while', 'flow/for', 'flow/setDelay', 'pointer/interpolate',
      'variable/get', 'event/onTick', 'event/onStart', 'math/add', 'flow/sequence',
      'variable/set', 'variable/interpolate', 'pointer/get', 'pointer/set',
      'math/not', 'math/gt', 'animation/start', 'animation/stop', 'debug/log', 'ref/eq']) {
      assert.equal(BEHAVIOR_OPS.includes(op), true, `${op} is executable`)
    }
    for (const op of ['event/onHoverIn', 'event/onHoverOut', 'event/stopPropagation', 'animation/stopAt',
      'atrium/notreal', 'debug/nope']) {
      assert.equal(BEHAVIOR_OPS.includes(op), false, `${op} is not executable`)
    }
    // An allowlisted op name with ANY other extension is not an executable
    // identity (P19); the one event/onSelect declaration is.
    assert.equal(isExecutableDeclaration('flow/sequence', 'EXT_probe'), false)
    assert.equal(isExecutableDeclaration('event/onSelect', 'EXT_probe'), false)
    assert.equal(isExecutableDeclaration('event/onSelect', 'KHR_node_selectability'), true)
    assert.equal(isExecutableDeclaration('math/add'), true)
  })

  test('the declared event ids are the three this round dispatches', () => {
    assert.deepEqual([...BEHAVIOR_EVENTS], ['atrium/enter', 'atrium/exit', 'atrium/interval'])
  })

  test('the five template ids are the round\'s five, each with a label and fields', () => {
    assert.deepEqual([...BEHAVIOR_TEMPLATES], [...TEMPLATE_IDS])
    for (const id of TEMPLATE_IDS) {
      assert.equal(typeof TEMPLATE_LABELS[id], 'string', `${id} has a display name`)
      assert.ok(Array.isArray(TEMPLATE_FIELDS[id]) && TEMPLATE_FIELDS[id].includes('target'))
    }
  })

  test('templateParamsOk refuses a missing, extra or ill-typed key', () => {
    const target = VECTORS.targetId
    assert.equal(templateParamsOk('select-animation', { target, clip: 'Idle', action: 'play', loop: true }), true)
    assert.equal(templateParamsOk('select-animation', { target, clip: 'Idle', action: 'play' }), false)
    assert.equal(templateParamsOk('select-animation', { target, clip: 'Idle', action: 'play', loop: 'yes' }), false)
    assert.equal(templateParamsOk('select-animation', { target, clip: 'Idle', action: 'play', loop: true, x: 1 }), false)
    assert.equal(templateParamsOk('nope', { target }), false)
    assert.equal(templateParamsOk('interval-animation', { target, clip: 'Idle', loop: true, seconds: 1.5 }), false)
    assert.equal(templateParamsOk('proximity-animation', { target, clip: 'Idle', loop: true, radius: 0.49 }), false)
  })

  test('the limits are G7\'s numbers', () => {
    assert.equal(BEHAVIOR_NODES_MAX, 256)
    assert.equal(BEHAVIOR_DECLS_MAX, 64)
    assert.equal(BEHAVIOR_TYPES_MAX, 16)
    assert.equal(BEHAVIOR_VARIABLES_MAX, 32)
    assert.equal(BEHAVIOR_EVENTS_MAX, 16)
    assert.equal(BEHAVIOR_STRING_MAX, 64)
    assert.equal(BEHAVIOR_BYTES_MAX, 65536)
    assert.equal(BEHAVIOR_CLIP_MAX, 300)
    assert.deepEqual([BEHAVIOR_PROX_MIN, BEHAVIOR_PROX_MAX], [0.5, 50])
    assert.deepEqual([BEHAVIOR_INTERVAL_MIN, BEHAVIOR_INTERVAL_MAX], [1, 3600])
    assert.deepEqual([BEHAVIOR_SPEED_MIN, BEHAVIOR_SPEED_MAX], [0.1, 10])
  })
})

describe('F8 — the templates build graphs the rule and the validator accept', () => {
  const ownId = '11111111-1111-4111-8111-111111111111'
  const targetId = '22222222-2222-4222-8222-222222222222'

  const cases = [
    ['select-visibility', { target: targetId, action: 'show' }],
    ['select-visibility', { target: targetId, action: 'hide' }],
    ['select-visibility', { target: targetId, action: 'toggle' }],
    ['select-animation', { target: targetId, clip: 'Idle', action: 'play', loop: true }],
    ['select-animation', { target: targetId, clip: 'Idle', action: 'stop', loop: false }],
    ['select-animation', { target: ownId, clip: 'Idle', action: 'play', loop: true }],
    ['proximity-animation', { target: targetId, clip: 'Walk', loop: true, radius: 3 }],
    ['select-light', { target: targetId, intensity: 2.5 }],
    ['interval-animation', { target: targetId, clip: 'Idle', loop: true, seconds: 30 }],
  ]

  for (const [id, params] of cases) {
    test(`${id} ${JSON.stringify(params.action ?? '')} passes F1 and the validator`, () => {
      const value = templateGraph(id, params, { ownId })
      const check = behaviorCheck(value, { ownId })
      assert.equal(check.problem, null, check.message ?? '')
      assert.doesNotThrow(() => validateInteractivityGraph(value.graph))
      assert.equal(value.kind, 'graph')
      assert.equal(value.origin, 'local')
      assert.equal(value.enabled, true)
      assert.deepEqual(value.template, { id, params })
    })
  }

  test('nodeMap[0] is always the own id, and the templates that grant carry their target', () => {
    const value = templateGraph('select-visibility', { target: targetId, action: 'hide' }, { ownId })
    assert.deepEqual(value.nodeMap, [ownId, targetId])
    assert.deepEqual(value.targets, [targetId])

    const self = templateGraph('select-animation', { target: ownId, clip: 'Idle', action: 'play', loop: true }, { ownId })
    assert.deepEqual(self.nodeMap, [ownId])
    assert.deepEqual(self.targets, [])
  })

  test('pointer templates spell `[n]`, never `{n}`', () => {
    for (const [id, params] of [
      ['select-visibility', { target: targetId, action: 'hide' }],
      ['select-light', { target: targetId, intensity: 2 }],
    ]) {
      const value = templateGraph(id, params, { ownId })
      const pointers = []
      for (const node of value.graph.nodes) {
        const pointer = node.configuration?.pointer?.value?.[0]
        if (pointer) pointers.push(pointer)
      }
      assert.ok(pointers.length > 0, `${id} writes pointers`)
      for (const pointer of pointers) {
        assert.match(pointer, /\[n\]/)
        assert.equal(pointer.includes('{'), false)
      }
    }
  })

  test('variables is absent, and events appears only in the two templates that declare one', () => {
    const withEvents = [
      templateGraph('proximity-animation', { target: targetId, clip: 'W', loop: true, radius: 3 }, { ownId }),
      templateGraph('interval-animation', { target: targetId, clip: 'W', loop: true, seconds: 2 }, { ownId }),
    ]
    const withoutEvents = [
      templateGraph('select-visibility', { target: targetId, action: 'hide' }, { ownId }),
      templateGraph('select-animation', { target: targetId, clip: 'W', action: 'play', loop: true }, { ownId }),
      templateGraph('select-light', { target: targetId, intensity: 2 }, { ownId }),
    ]
    for (const value of [...withEvents, ...withoutEvents]) {
      assert.equal('variables' in value.graph, false, 'variables is absent')
    }
    for (const value of withEvents) assert.ok(value.graph.events.length > 0)
    for (const value of withoutEvents) assert.equal('events' in value.graph, false)
  })

  test('event/onSelect is declared with its extension and configured nodeIndex 0 / stopPropagation false', () => {
    const value = templateGraph('select-visibility', { target: targetId, action: 'hide' }, { ownId })
    const index = value.graph.declarations.findIndex((d) => d.op === 'event/onSelect')
    assert.deepEqual(value.graph.declarations[index], { op: 'event/onSelect', extension: 'KHR_node_selectability' })
    const node = value.graph.nodes[0]
    assert.equal(node.declaration, index)
    assert.deepEqual(node.configuration.nodeIndex.value, [0])
    assert.deepEqual(node.configuration.stopPropagation.value, [false])
  })
})
