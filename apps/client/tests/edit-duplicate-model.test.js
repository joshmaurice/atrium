// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// edit-duplicate-model.test.js — models-by-url step 2 (Z1 client side).
//
// Duplicate's `atriumProblem` applies the same model rules as the server, so a
// legacy model value is reported here instead of being sent as an `add` the
// server refuses. The vectors are the SHARED file: the test does not restate
// the rules.
//
// apps/client tests can't import glTF-Transform, so `duplicateRuleProblem` runs
// on the same kind of stand-in node edit-duplicate.test.js uses; only the
// extras matter for this rule.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { duplicateRuleProblem, prepareRestore, DUPLICATE_REASONS } from '../src/edit-duplicate.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const VECTORS = JSON.parse(readFileSync(resolve(__dirname, '../../../tests/fixtures/model-spec-vectors.json'), 'utf8'))

const ext = (n) => Array.from({ length: n }, () => ({}))

function node(extras = {}) {
  return {
    getName: () => 'Cube',
    getTranslation: () => [0, 0, 0], getRotation: () => [0, 0, 0, 1], getScale: () => [1, 1, 1],
    getExtras: () => extras, getMesh: () => null, listChildren: () => [],
    listParents: () => [{ propertyType: 'Root' }, { propertyType: 'Scene' }],
    getCamera: () => null, getSkin: () => null, getWeights: () => [],
    getExtension: () => null, listExtensions: () => ext(0),
  }
}

// The mesh rule (A6) is the server's node-level rule and is covered by the
// client's validateModelHost tests; Duplicate reads extras only.
const EXTRAS_VECTORS = VECTORS.nodes.filter((v) => v.reason !== 'mesh')

test('every shared node vector with a bad model value is refused by the atrium rule', () => {
  assert.ok(EXTRAS_VECTORS.length >= 10, 'the shared node vectors')
  for (const vector of EXTRAS_VECTORS) {
    const problem = duplicateRuleProblem(node(vector.node.extras))
    if (vector.ok) {
      assert.equal(problem, null, `${vector.label}: accepted`)
    } else {
      assert.ok(problem, `${vector.label}: refused`)
      assert.equal(problem.rule, 'atrium', `${vector.label}: the model rule`, problem)
      assert.ok(problem.reason.startsWith(DUPLICATE_REASONS.atrium), problem.reason)
      assert.ok(problem.reason.includes(vector.reason === 'not-object'
        ? 'extras.atrium is not an object'
        : 'its model data would be refused'), problem.reason)
    }
  }
})

test('a valid model node with no mesh can be duplicated and restored', () => {
  const extras = { atrium: { model: { url: 'https://h/chair.glb', bounds: [1, 1, 1] } } }
  const n = node(extras)
  assert.equal(duplicateRuleProblem(n), null)
  const restored = prepareRestore(n, { name: 'Chair' })
  assert.equal(restored.ok, true, restored.reason)
  assert.deepEqual(restored.descriptor.extras, extras, 'the model extras are copied whole')
  assert.deepEqual(restored.descriptor.translation, [0, 0, 0])
})

test('a legacy model value a copy would send is refused, not sent', () => {
  const n = node({ atrium: { model: { url: 'javascript:alert(1)' } } })
  const problem = duplicateRuleProblem(n)
  assert.equal(problem?.rule, 'atrium')
  assert.match(problem.reason, /its model data would be refused/)
})

test('a model value with a teleporter sibling is checked for both', () => {
  const ok = node({ atrium: { teleporter: { destination: '/x' }, model: { url: '/m.glb' } } })
  assert.equal(duplicateRuleProblem(ok), null)
  const bad = node({ atrium: { teleporter: { destination: '/x' }, model: { url: 'http://h/m.glb' } } })
  assert.equal(duplicateRuleProblem(bad)?.rule, 'atrium')
  const badTeleporter = node({ atrium: { teleporter: { destination: 42 }, model: { url: '/m.glb' } } })
  assert.equal(duplicateRuleProblem(badTeleporter)?.rule, 'atrium')
  assert.match(duplicateRuleProblem(badTeleporter).reason, /destination is not text/)
})
