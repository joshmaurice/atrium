// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// sky-url.test.js — library-sky step 1 (Z5, L25a). The server's half of the
// sky-URL rule: a new `extras.atrium.background.texture` must be a valid A1
// URL, or `''` to clear the sky. `atrium.background.type` is unchanged.
//
// The shared vectors (tests/fixtures/sky-url-vectors.json, read by this file
// and by the client's model-spec.test.js — neither keeps its own copy) run
// through the REAL `send` decision on a real world's SOM: `resolveSendTarget`
// resolves `__document__` and `authorizeSend` collects the changed leaves and
// applies the World Info table. A document-relative value is refused exactly
// like any other non-A1 value: no live world has a sky, so no legacy form
// survives.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createWorld } from '../src/world.js'
import { authorizeSend, resolveSendTarget, skyUrlProblem } from '../src/send-policy.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SPACE = resolve(__dirname, '../../../tests/fixtures/space.gltf')
const VECTORS = JSON.parse(readFileSync(resolve(__dirname, '../../../tests/fixtures/sky-url-vectors.json'), 'utf8'))

/** The world's extras with a sky already stored: a change to it is a change. */
const OLD_SKY = 'https://old.example.com/sky.jpg'

function cloneExtras(world) {
  const extras = JSON.parse(JSON.stringify(world.som.extras ?? {}))
  extras.atrium = { ...(extras.atrium ?? {}), background: { type: 'equirectangular', texture: OLD_SKY } }
  return extras
}

function setLeaf(obj, path, value) {
  const segments = path.split('.')
  let target = obj
  for (let i = 0; i < segments.length - 1; i++) {
    if (target[segments[i]] == null) target[segments[i]] = {}
    target = target[segments[i]]
  }
  target[segments[segments.length - 1]] = value
  return obj
}

function getLeaf(obj, path) {
  let value = obj
  for (const segment of path.split('.')) {
    if (value == null) return undefined
    value = value[segment]
  }
  return value
}

describe('skyUrlProblem — the shared sky-URL vectors (Z5/L25a)', () => {
  assert.ok(VECTORS.vectors.length >= 20, 'the shared vectors are the adversarial set')
  for (const vector of VECTORS.vectors) {
    test(vector.label, () => {
      const problem = skyUrlProblem(vector.value)
      assert.equal(problem === null, vector.ok, problem ?? 'accepted')
      if (!vector.ok) assert.equal(problem, vector.reason, 'the shared reason code')
    })
  }
})

describe('the server leaf — atrium.background.texture through the real send path', () => {
  test('an owner may set a library sky, and the whole World Info table still allows its own leaves', async () => {
    const world = await createWorld(SPACE)
    const doc = resolveSendTarget(world.som, '__document__')
    const current = cloneExtras(world)

    const proposed = setLeaf(cloneExtras(world), 'atrium.background.texture',
      'https://cdn.example.com/assets/library/skies/a-0123456789ab.jpg')
    const decision = authorizeSend({
      target: doc, nodeName: '__document__', field: 'extras', value: proposed, currentExtras: current,
    })
    assert.equal(decision.ok, true, decision.code ?? 'accepted')
    assert.equal(getLeaf(proposed, 'atrium.background.texture'),
      'https://cdn.example.com/assets/library/skies/a-0123456789ab.jpg')
  })

  test('an http: sky is refused INVALID_VALUE, and nothing else changes', async () => {
    const world = await createWorld(SPACE)
    const doc = resolveSendTarget(world.som, '__document__')
    const current = cloneExtras(world)

    const proposed = setLeaf(cloneExtras(world), 'atrium.background.texture', 'http://cdn.example.com/sky.jpg')
    const decision = authorizeSend({
      target: doc, nodeName: '__document__', field: 'extras', value: proposed, currentExtras: current,
    })
    assert.equal(decision.ok, false)
    assert.equal(decision.code, 'INVALID_VALUE')
  })

  test("'' is allowed: it clears the sky", async () => {
    const world = await createWorld(SPACE)
    const doc = resolveSendTarget(world.som, '__document__')
    const current = cloneExtras(world)

    const proposed = setLeaf(cloneExtras(world), 'atrium.background.texture', '')
    const decision = authorizeSend({
      target: doc, nodeName: '__document__', field: 'extras', value: proposed, currentExtras: current,
    })
    assert.equal(decision.ok, true, decision.code ?? 'accepted')
  })

  test('other leaves are still refused: a non-World-Info change, and a bad type', async () => {
    const world = await createWorld(SPACE)
    const doc = resolveSendTarget(world.som, '__document__')
    const current = cloneExtras(world)

    const decide = (path, value) => authorizeSend({
      target: doc, nodeName: '__document__', field: 'extras',
      value: setLeaf(cloneExtras(world), path, value), currentExtras: current,
    })

    assert.equal(decide('atrium.source', 'https://evil.example/x.glb').code, 'PERMISSION_DENIED')
    assert.equal(decide('evil', 'x').code, 'PERMISSION_DENIED')
    assert.equal(decide('atrium.background.type', 'sphere').code, 'INVALID_VALUE')
    assert.equal(decide('atrium.background.type', 'cubemap').ok, true, 'the type leaf is unchanged by this round')
  })

  test("the stored value is never re-checked: an old document-relative sky stays writable elsewhere", async () => {
    const world = await createWorld(SPACE)
    const doc = resolveSendTarget(world.som, '__document__')
    // A world whose CURRENT sky is a legacy document-relative value (none live
    // today, but a document may carry one): renaming the world must not be
    // refused, because only changed leaves are collected.
    const current = cloneExtras(world)
    current.atrium.background.texture = 'skyboxtest1.png'

    const proposed = setLeaf(JSON.parse(JSON.stringify(current)), 'atrium.name', 'Renamed')
    const decision = authorizeSend({
      target: doc, nodeName: '__document__', field: 'extras', value: proposed, currentExtras: current,
    })
    assert.equal(decision.ok, true, decision.code ?? 'accepted')
  })

  test('every shared vector is decided the same way through the real send path', async () => {
    const world = await createWorld(SPACE)
    const doc = resolveSendTarget(world.som, '__document__')
    const current = cloneExtras(world)

    for (const vector of VECTORS.vectors) {
      const proposed = setLeaf(cloneExtras(world), 'atrium.background.texture', vector.value)
      const decision = authorizeSend({
        target: doc, nodeName: '__document__', field: 'extras', value: proposed, currentExtras: current,
      })
      assert.equal(decision.ok, vector.ok, `${vector.label} (got ${decision.code}: ${decision.message})`)
      if (!vector.ok) assert.equal(decision.code, 'INVALID_VALUE', vector.label)
    }
  })

  test('one bad sky leaf plus one good leaf still refuses the whole message', async () => {
    const world = await createWorld(SPACE)
    const doc = resolveSendTarget(world.som, '__document__')
    const current = cloneExtras(world)

    let proposed = setLeaf(cloneExtras(world), 'atrium.name', 'Renamed')
    proposed = setLeaf(proposed, 'atrium.background.texture', 'javascript:alert(1)')
    const decision = authorizeSend({
      target: doc, nodeName: '__document__', field: 'extras', value: proposed, currentExtras: current,
    })
    assert.equal(decision.ok, false)
    assert.equal(decision.code, 'INVALID_VALUE')
  })
})
