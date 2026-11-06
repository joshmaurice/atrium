// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// richer-add §2.6/§5 (devtasks/PREBRIEF-richer-add.md) — `p9` as a test: an
// object added with the richer fields, through the REAL `ingestNode` and the
// `@gltf-transform/view` DocumentView Atrium renders with, gets the three.js
// material it should. Headless, with a stub image provider (no WebGL, no DOM).
// `initDocumentView` itself can't run here: it constructs
// `new DocumentView(renderer)` with no config, so the default image provider,
// which needs `document`, is always used (§5 allows this fallback). What a
// browser shows is the DEV acceptance check's.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { DocumentView } from '@gltf-transform/view'
import { SOMDocument } from '../../som/src/SOMDocument.js'

const { Document } = await import('../../som/node_modules/@gltf-transform/core/dist/index.modern.js')

/** A stand-in for the browser's image provider. */
const HEADLESS = { imageProvider: { initTexture() {}, getTexture: async () => null, clear() {}, dispose() {}, setKTX2Loader() { return this } } }

function view(descriptor) {
  const doc = new Document()
  const scene = doc.createScene()
  const som = new SOMDocument(doc)
  som.ingestNode(descriptor)
  scene.addChild(doc.getRoot().listNodes().find((n) => n.getName() === descriptor.name))
  const sceneGroup = new DocumentView(doc, HEADLESS).view(scene)
  const meshes = []
  sceneGroup.traverse((o) => { if (o.isMesh) meshes.push(o) })
  return meshes
}

const TRI = [0, 0, 0, 1, 0, 0, 0, 1, 0]

test('emissive renders self-lit, BLEND is transparent without depth writes, double-sided shows its back', () => {
  const [mesh] = view({ name: 'glass', mesh: { primitives: [{ attributes: { POSITION: TRI }, material: { emissiveFactor: [1, 0.5, 0], alphaMode: 'BLEND', doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 0.5] } } }] } })
  const m = mesh.material
  assert.deepEqual(m.emissive.toArray(), [1, 0.5, 0], 'emissive')
  assert.equal(m.transparent, true); assert.equal(m.depthWrite, false)
  assert.equal(m.opacity, 0.5)
  assert.equal(m.side, THREE.DoubleSide)
})

test('MASK sets alphaTest to the cutoff', () => {
  const [mesh] = view({ name: 'leaf', mesh: { primitives: [{ attributes: { POSITION: TRI }, material: { alphaMode: 'MASK', alphaCutoff: 0.3 } }] } })
  assert.ok(Math.abs(mesh.material.alphaTest - 0.3) < 1e-6)
  assert.equal(mesh.material.transparent, false)
})

test('COLOR_0, VEC3 and VEC4, turns on vertex colours with the right item size', () => {
  for (const [values, size] of [[[1, 0, 0, 0, 1, 0, 0, 0, 1], 3], [[1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0.5], 4]]) {
    const [mesh] = view({ name: `c${size}`, mesh: { primitives: [{ attributes: { POSITION: TRI, COLOR_0: values }, material: {} }] } })
    assert.equal(mesh.material.vertexColors, true, `VEC${size}`)
    assert.equal(mesh.geometry.getAttribute('color').itemSize, size)
  }
})

test('a plain add renders as before: opaque, front side, not emissive, no vertex colours', () => {
  const [mesh] = view({ name: 'plain', mesh: { primitives: [{ attributes: { POSITION: TRI }, material: { pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] } } }] } })
  const m = mesh.material
  assert.equal(m.transparent, false); assert.equal(m.side, THREE.FrontSide)
  assert.deepEqual(m.emissive.toArray(), [0, 0, 0]); assert.equal(m.vertexColors, false)
})
