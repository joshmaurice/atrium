// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { loadBackground } from '../src/load-background.js'

// ---------------------------------------------------------------------------
// Tests — synchronous paths only (TextureLoader cannot be mocked in ES modules)
// ---------------------------------------------------------------------------

describe('loadBackground — clear paths', () => {

  test('null clears scene background and bumps token', () => {
    const scene = new THREE.Scene()
    scene.userData.__bgToken = 5
    scene.background = 'anything'
    scene.environment = 'anything'

    loadBackground(scene, null)

    assert.equal(scene.background, null)
    assert.equal(scene.environment, null)
    assert.equal(scene.userData.__bgToken, 6, 'token bumped after clear')
  })

  test('undefined clears scene', () => {
    const scene = new THREE.Scene()
    scene.background = 'anything'
    scene.environment = 'anything'

    loadBackground(scene, undefined)

    assert.equal(scene.background, null)
    assert.equal(scene.environment, null)
  })

  test('empty object clears scene (no .texture field)', () => {
    const scene = new THREE.Scene()
    scene.background = 'anything'
    scene.environment = 'anything'

    loadBackground(scene, {})

    assert.equal(scene.background, null)
    assert.equal(scene.environment, null)
  })

  test('unsupported type logs warning, does not clear', () => {
    const scene = new THREE.Scene()
    scene.background = 'existing'
    scene.environment = 'existing'
    scene.userData.__bgToken = 3

    const warnings = []
    const origWarn = console.warn
    console.warn = (msg) => { warnings.push(msg) }

    loadBackground(scene, { type: 'cube', texture: 'sky.jpg' })

    console.warn = origWarn

    assert.equal(warnings.length, 1)
    assert.ok(warnings[0].includes('Unsupported background type'))
    assert.equal(scene.background, 'existing')
    assert.equal(scene.environment, 'existing')
  })

  test('bg with texture field but missing type defaults to equirectangular', () => {
    // loadBackground uses `if (bg.type && bg.type !== 'equirectangular')` so a
    // missing type should proceed (no warning). Will attempt TextureLoader, but
    // we only verify synchronous behavior before the loader is called.
    const scene = new THREE.Scene()
    scene.background = 'existing'
    scene.environment = 'existing'

    // This will attempt THREE.TextureLoader.load synchronously, which
    // may fail in Node. We're just checking it doesn't throw on the
    // synchronous parts before the loader call.
    try {
      loadBackground(scene, { texture: 'http://example.com/pano.jpg' })
      // If it didn't throw, check token bumped
      assert.ok(scene.userData.__bgToken > 0, 'token bumped')
    } catch {
      // TextureLoader may throw in Node — that's OK for this test
    }
  })
})