// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// value-rules.test.js — scripting-4d-1 round 2, step 3 (G4, the server's half).
//
// The runner's write check is a RENDERER-NEUTRAL COPY of the server's own node
// and light value rules (`packages/behaviors/src/value-rules.js`), and the two
// are pinned to each other by `tests/fixtures/value-vectors.json` — the E1
// pattern. This file runs the vectors through the SERVER's `authorizeNodeSend`
// and `authorizeLightSend`, so a change to either copy that the other does not
// make fails here.
//
// The vectors go through the REAL policy helper with REAL SOM objects: the
// class gate, the field gate and the value rule are all in the path.
//
// JSON cannot carry NaN or Infinity (JSON.stringify writes both as `null`), so
// the NaN cases G4 names are asserted as NUMBERS at the end — a `null` vector
// proves a different thing (a non-number), and saying it proved NaN was 4b-2
// W5's bug.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { Document } from '@gltf-transform/core'
import { KHRLightsPunctual } from '@gltf-transform/extensions'
import { SOMDocument } from '@atrium/som'
import { authorizeSend } from '../src/send-policy.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const VECTORS = JSON.parse(readFileSync(resolve(__dirname, '../../../tests/fixtures/value-vectors.json'), 'utf8'))

/** A SOMDocument with one plain node and one light host. */
function makeSOM() {
  const doc = new Document()
  const ext = doc.createExtension(KHRLightsPunctual)
  const scene = doc.createScene('Scene')
  scene.addChild(doc.createNode('Crate'))
  const light = ext.createLight('Sun').setType('directional').setColor([1, 1, 1]).setIntensity(3)
  scene.addChild(doc.createNode('Sun').setExtension('KHR_lights_punctual', light))
  return new SOMDocument(doc)
}

const som = makeSOM()
const node = som.getNodeByName('Crate')
const light = som.lights[0]

/** One candidate write through the server's own policy. */
const decide = (vector) => (vector.kind === 'light'
  ? authorizeSend({ target: light, nodeName: light.qualifiedName, field: vector.field, value: vector.value })
  : authorizeSend({ target: node, nodeName: node.name, field: vector.field, value: vector.value }))

test('G4: every node vector answers the server\'s own verdict and text', () => {
  assert.ok(VECTORS.node.length >= 25, 'the node vectors are present')
  for (const vector of VECTORS.node) {
    const decision = decide({ ...vector, kind: 'node' })
    assert.equal(decision.ok, vector.ok, `${vector.label}: ok`)
    if (!vector.ok) assert.equal(decision.message, vector.message, `${vector.label}: text`)
    assert.equal(decision.code, vector.ok ? null : 'INVALID_VALUE', `${vector.label}: code`)
  }
})

test('G4: every light vector answers the server\'s own verdict and text', () => {
  assert.ok(VECTORS.light.length >= 8, 'the light vectors are present')
  for (const vector of VECTORS.light) {
    const decision = decide({ ...vector, kind: 'light' })
    assert.equal(decision.ok, vector.ok, `${vector.label}: ok`)
    if (!vector.ok) assert.equal(decision.message, vector.message, `${vector.label}: text`)
    assert.equal(decision.code, vector.ok ? null : 'INVALID_VALUE', `${vector.label}: code`)
  }
})

test('G4: NaN and Infinity are refused as NUMBERS, not as JSON nulls', () => {
  // The `[null, 0, 0]` vector proves a non-number is refused. THESE prove the
  // finiteness half, which a JSON fixture cannot carry.
  for (const bad of [NaN, Infinity, -Infinity]) {
    const translation = decide({ kind: 'node', field: 'translation', value: [bad, 0, 0] })
    assert.equal(translation.ok, false, `translation [${bad}, 0, 0]`)
    assert.equal(translation.message, 'translation must be 3 finite numbers')

    const rotation = decide({ kind: 'node', field: 'rotation', value: [0, 0, 0, bad] })
    assert.equal(rotation.ok, false, `rotation [0, 0, 0, ${bad}]`)
    assert.equal(rotation.message, 'rotation must be 4 finite numbers')

    const scale = decide({ kind: 'node', field: 'scale', value: [bad, 1, 1] })
    assert.equal(scale.ok, false, `scale [${bad}, 1, 1]`)
    assert.equal(scale.message, 'scale must be 3 finite numbers')

    const intensity = decide({ kind: 'light', field: 'intensity', value: bad })
    assert.equal(intensity.ok, false, `intensity ${bad}`)
    assert.equal(intensity.message, 'intensity must be a finite number')

    const color = decide({ kind: 'light', field: 'color', value: [0, bad, 0] })
    assert.equal(color.ok, false, `color [0, ${bad}, 0]`)
    assert.equal(color.message, 'color must be 3 finite numbers')
  }
})

test('G4: a write the runner has no rule for is still the server\'s to decide', () => {
  // The runner applies these rules to G-L4's families only. The server keeps
  // its own answer for everything else — this is the seam the two do not share.
  const decision = decide({ kind: 'node', field: 'name', value: 'Renamed' })
  assert.equal(decision.ok, true, 'a rename is not a value this fixture covers')
  const denied = decide({ kind: 'node', field: 'no-such-field', value: 1 })
  assert.equal(denied.ok, false)
  assert.equal(denied.code, 'PERMISSION_DENIED')
})
