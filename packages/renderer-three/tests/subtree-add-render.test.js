// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// subtree-add §5 (devtasks/PREBRIEF-subtree-add.md FINAL Rev 2) — a tree added
// live, through the REAL `ingestNode` and the `@gltf-transform/view`
// DocumentView Atrium renders with: every member's object is under its
// parent's, a hidden member isn't rendered (Atrium's visibility pass), a
// part's world position follows its root, and a shared material (T12) is one
// three.js material. Headless, as richer-add-render.test.js.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { DocumentView } from '@gltf-transform/view'
import { SOMDocument } from '../../som/src/SOMDocument.js'
import { applyVisibility } from '../src/visibility.js'

const { Document } = await import('../../som/node_modules/@gltf-transform/core/dist/index.modern.js')
const HEADLESS = { imageProvider: { initTexture() {}, getTexture: async () => null, clear() {}, dispose() {}, setKTX2Loader() { return this } } }
const TRI = [0, 0, 0, 1, 0, 0, 0, 1, 0]

function liveTree(descriptor) {
  const doc = new Document()
  const scene = doc.createScene()
  const som = new SOMDocument(doc)
  const docView = new DocumentView(doc, HEADLESS)
  const sceneGroup = docView.view(scene)
  // added AFTER the view exists, as a live `add` is
  som.scene.addChild(som.ingestNode(descriptor))
  sceneGroup.updateMatrixWorld(true)
  const byName = (name) => { let found = null; sceneGroup.traverse((o) => { if (!found && o.name === name) found = o }); return found }
  return { doc, som, docView, sceneGroup, byName }
}

const TREE = {
  name: 'lamp', translation: [3, 0, -2],
  children: [
    { name: 'body', translation: [0, 1, 0], children: [{ name: 'shade', translation: [0, 0.6, 0], mesh: { primitives: [{ attributes: { POSITION: TRI }, material: { name: 'Brass', pbrMetallicRoughness: { baseColorFactor: [1, 0.8, 0.2, 1] } } }] } }] },
    { name: 'stand', extras: { __atrium_visible: false }, mesh: { primitives: [{ attributes: { POSITION: TRI }, material: { ref: 0 } }] } },
  ],
}

test('every member’s object hangs under its parent’s', () => {
  const { byName } = liveTree(TREE)
  const lamp = byName('lamp')
  assert.ok(lamp, 'the root is rendered')
  assert.equal(byName('body').parent, lamp)
  assert.equal(byName('shade').parent, byName('body'))
  assert.equal(byName('stand').parent, lamp)
})

test('a part’s world position follows its root', () => {
  const { som, sceneGroup, byName } = liveTree(TREE)
  const at = () => byName('shade').getWorldPosition(new THREE.Vector3()).toArray()
  assert.deepEqual(at(), [3, 1.6, -2])
  som.getNodeByName('lamp').translation = [5, 0, 0]
  sceneGroup.updateMatrixWorld(true)
  assert.deepEqual(at().map((v) => Math.round(v * 1e6) / 1e6), [5, 1.6, 0])
})

test('a hidden member isn’t rendered once Atrium’s visibility pass runs', () => {
  const { som, docView, byName } = liveTree(TREE)
  applyVisibility(docView, som)
  assert.equal(byName('stand').visible, false)
  assert.equal(byName('shade').visible, true)
})

test('T12: both sharers render the shared material (DocumentView may keep a three.js variant per primitive, as for any file\u2019s shared material)', () => {
  const { sceneGroup } = liveTree(TREE)
  const meshes = []
  sceneGroup.traverse((o) => { if (o.isMesh) meshes.push(o) })
  assert.equal(meshes.length, 2)
  assert.deepEqual(meshes.map((m) => m.material.name), ['Brass', 'Brass'])
  assert.deepEqual(meshes[0].material.color.toArray(), meshes[1].material.color.toArray())
})
