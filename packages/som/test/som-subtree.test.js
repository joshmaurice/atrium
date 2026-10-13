// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// Phase 3 step 1a — A5 (name rules), A6 (subtree dispose, D2) and A8
// (atomic rename). Real glTF-Transform Documents and real SOMDocuments; no
// mocks.

import { test }   from 'node:test'
import assert     from 'node:assert/strict'
import { Document, NodeIO } from '@gltf-transform/core'
import { KHRLightsPunctual } from '@gltf-transform/extensions'
import { SOMDocument } from '../src/SOMDocument.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** S -> P -> C -> G, plus a sibling Leaf. */
function makeTreeDoc() {
  const doc   = new Document()
  const scene = doc.createScene('Scene')
  const p = doc.createNode('P')
  const c = doc.createNode('C')
  const g = doc.createNode('G')
  const leaf = doc.createNode('Leaf')
  p.addChild(c)
  c.addChild(g)
  scene.addChild(p)
  scene.addChild(leaf)
  return doc
}

/** S -> Host (hosts a camera named 'Lens'), plus a plain node. */
function makeCameraHostDoc() {
  const doc   = new Document()
  const scene = doc.createScene('Scene')
  const cam   = doc.createCamera('Lens').setType('perspective')
  const host  = doc.createNode('Host').setCamera(cam)
  scene.addChild(host)
  scene.addChild(doc.createNode('Plain'))
  return doc
}

/** S -> A and S -> B, both hosting the SAME camera named 'Lens'. */
function makeSharedCameraDoc() {
  const doc   = new Document()
  const scene = doc.createScene('Scene')
  const cam   = doc.createCamera('Lens').setType('perspective')
  const a = doc.createNode('A').setCamera(cam)
  const b = doc.createNode('B').setCamera(cam)
  scene.addChild(a)
  scene.addChild(b)
  return doc
}

/** S -> Sun (hosts a directional light named 'Glow'). */
function makeLightHostDoc() {
  const doc   = new Document()
  const ext   = doc.createExtension(KHRLightsPunctual)
  const scene = doc.createScene('Scene')
  const gltfLight = ext.createLight('Glow').setType('directional').setIntensity(2)
  const host = doc.createNode('Sun').setExtension('KHR_lights_punctual', gltfLight)
  scene.addChild(host)
  scene.addChild(doc.createNode('Plain'))
  return doc
}

// ===========================================================================
// A6 — subtree remove
// ===========================================================================

test('A6: removeSubtree drops the whole subtree, names and all', () => {
  const som = new SOMDocument(makeTreeDoc())
  const p   = som.getNodeByName('P')

  som.removeSubtree(p)

  for (const name of ['P', 'C', 'G']) {
    assert.equal(som.getNodeByName(name), null, `"${name}" must no longer resolve as a node`)
    assert.equal(som.getObjectByName(name), null, `"${name}" must no longer be in the global namespace`)
  }
  assert.equal(som.getNodeByName('Leaf').name, 'Leaf', 'the sibling survives')
  assert.equal(som.nodes.length, 1, 'only the sibling is left')
})

test('A6: a removed subtree is not serialized outside the scene', () => {
  const som = new SOMDocument(makeTreeDoc())
  som.removeSubtree(som.getNodeByName('P'))

  const names = som.document.getRoot().listNodes().map(n => n.getName())
  assert.deepEqual(names, ['Leaf'], 'the document holds no disposed node')
})

test('A6: the old name of a removed subtree is free again', () => {
  const som = new SOMDocument(makeTreeDoc())
  som.removeSubtree(som.getNodeByName('P'))

  assert.doesNotThrow(() => som.createNode({ name: 'C' }), 'reusing a freed name is allowed')
  assert.equal(som.getNodeByName('C').name, 'C')
})

test('A6: SOMNode.dispose removes the subtree too (one shared path)', () => {
  const som = new SOMDocument(makeTreeDoc())
  som.getNodeByName('P').dispose()

  assert.equal(som.getNodeByName('C'), null)
  assert.equal(som.getNodeByName('G'), null)
})

// ===========================================================================
// A6 — dispose deletes by identity (F7)
// ===========================================================================

test('A6: removing a node named __document__ leaves the document registered', () => {
  const som = new SOMDocument(makeTreeDoc())
  // createNode registers it in _nodesByName but cannot take the global
  // __document__ slot (already the document).
  const impostor = som.createNode({ name: '__document__' })
  assert.equal(som.getObjectByName('__document__').constructor.name, 'SOMDocument')

  impostor.dispose()

  assert.ok(som.getObjectByName('__document__') instanceof SOMDocument,
    'the document must still be addressable')
  assert.equal(som.getNodeByName('__document__'), null, 'the node is gone')
})

test('A6: removing a node named like an animation leaves the animation registered', () => {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  const anim = doc.createAnimation('Spin')
  scene.addChild(doc.createNode('Spin'))
  const som = new SOMDocument(doc)

  assert.equal(som.getObjectByName('Spin').constructor.name, 'SOMNode', 'node wins the bare slot')
  som.getNodeByName('Spin').dispose()

  assert.equal(som.getObjectByName('Spin'), null, 'the node slot is gone with the node')
  assert.equal(som.getAnimationByName('Spin').name, 'Spin', 'the animation itself survives')
})

test('A6: removing a node named like a camera alias leaves the camera addressable', () => {
  const som = new SOMDocument(makeCameraHostDoc())
  const camera = som.getObjectByName('Host.camera')
  assert.equal(camera.constructor.name, 'SOMCamera')

  const impostor = som.createNode({ name: 'Host.camera' })
  impostor.dispose()

  assert.strictEqual(som.getObjectByName('Host.camera'), camera,
    'the camera alias must survive an unrelated node named like it')
})

// ===========================================================================
// A6 — camera and light host cleanup
// ===========================================================================

test('A6: deleting a camera host clears its alias, bare name and cameras entry', () => {
  const som = new SOMDocument(makeCameraHostDoc())
  assert.equal(som.cameras.length, 1)

  som.removeSubtree(som.getNodeByName('Host'))

  assert.equal(som.getObjectByName('Host.camera'), null, 'the qualified alias goes')
  assert.equal(som.getObjectByName('Lens'), null, 'the bare name goes')
  assert.equal(som.getObjectByName('Host'), null, 'the host goes')
  assert.equal(som.cameras.length, 0, 'the cameras list goes')
  assert.equal(som._cameraMap.size, 0, 'the camera map goes')
})

test('A6: deleting a light host clears its alias, bare name and lights entry', () => {
  const som = new SOMDocument(makeLightHostDoc())
  assert.equal(som.lights.length, 1)

  som.removeSubtree(som.getNodeByName('Sun'))

  assert.equal(som.getObjectByName('Sun.light'), null, 'the qualified alias goes')
  assert.equal(som.getObjectByName('Glow'), null, 'the bare name goes')
  assert.equal(som.lights.length, 0, 'the lights list goes')
  assert.equal(som._lightMap.size, 0, 'the light map goes')
})

test('A6: a camera shared by two nodes survives the deletion of one host', () => {
  const som = new SOMDocument(makeSharedCameraDoc())
  const camera = som.getObjectByName('A.camera')
  assert.strictEqual(som.getObjectByName('B.camera'), camera, 'both hosts share one camera wrapper')
  assert.equal(som.cameras.length, 2, 'one entry per host node')

  som.removeSubtree(som.getNodeByName('A'))

  assert.equal(som.getObjectByName('A.camera'), null, "the deleted host's alias goes")
  assert.strictEqual(som.getObjectByName('B.camera'), camera, "the surviving host's alias stays")
  assert.strictEqual(som.getObjectByName('Lens'), camera, 'the bare name stays')
  assert.equal(som.cameras.includes(camera), true, 'the camera keeps its place')
})

// ===========================================================================
// A5 / A8 — checkNewName
// ===========================================================================

test('A5: checkNewName accepts a plain new name', () => {
  const som = new SOMDocument(makeTreeDoc())
  assert.equal(som.checkNewName('Box').ok, true)
})

test('A5: checkNewName refuses every D3 forbidden form', () => {
  const som = new SOMDocument(makeTreeDoc())

  assert.equal(som.checkNewName('').ok, false, 'empty')
  assert.equal(som.checkNewName(42).ok, false, 'not a string')
  assert.equal(som.checkNewName('a'.repeat(257)).ok, false, 'too long')
  assert.equal(som.checkNewName('__document__').ok, false, 'reserved name')
  assert.equal(som.checkNewName('Foo.camera').ok, false, 'camera alias form')
  assert.equal(som.checkNewName('Foo.light').ok, false, 'light alias form')
  assert.equal(som.checkNewName('a/b').ok, false, 'contains a slash')
  assert.equal(som.checkNewName('P').ok, false, 'already a node')

  for (const bad of ['', 'a'.repeat(257), '__document__', 'Foo.camera', 'Foo.light', 'a/b', 'P']) {
    assert.equal(som.checkNewName(bad).code, 'INVALID_VALUE', `"${bad}" is INVALID_VALUE`)
  }
})

test('A5: checkNewName allows a name that is already the object itself', () => {
  const som = new SOMDocument(makeTreeDoc())
  const p = som.getNodeByName('P')
  assert.equal(som.checkNewName('P', p).ok, true, 'renaming a node to its own name is not a duplicate')
})

// ===========================================================================
// A8 — renameNode
// ===========================================================================

test('A8: renameNode moves the name maps and the glTF node name', () => {
  const som = new SOMDocument(makeTreeDoc())
  const p = som.getNodeByName('P')

  const result = som.renameNode('P', 'Box')
  assert.deepEqual(result, { ok: true, code: null, message: null })
  assert.equal(p.name, 'Box')
  assert.strictEqual(som.getNodeByName('Box'), p)
  assert.strictEqual(som.getObjectByName('Box'), p)
  assert.equal(som.getNodeByName('P'), null, 'the old name no longer resolves')
  assert.equal(som.getObjectByName('P'), null, 'the old global entry is gone')
})

test('A8: a rename then a mutation addresses the node by its new name', () => {
  const som = new SOMDocument(makeTreeDoc())
  som.renameNode('P', 'Box')
  som.setPath(som.getObjectByName('Box'), 'translation', [1, 2, 3])
  assert.deepEqual([...som.getNodeByName('Box').translation], [1, 2, 3])
})

test('A8: a rename then a delete frees the new name and leaves no stale entry', () => {
  const som = new SOMDocument(makeTreeDoc())
  som.renameNode('P', 'Box')
  som.removeSubtree(som.getNodeByName('Box'))

  assert.equal(som.getNodeByName('Box'), null)
  assert.equal(som.getObjectByName('Box'), null)
  assert.equal(som.getNodeByName('P'), null, 'the old name must not come back')
  assert.doesNotThrow(() => som.createNode({ name: 'Box' }))
})

test('A8: a rename survives serialize and reload', async () => {
  const som = new SOMDocument(makeTreeDoc())
  som.renameNode('P', 'Box')

  const io = new NodeIO()
  const { json } = await io.writeJSON(som.document)
  const doc2 = await io.readJSON({ json, resources: {} })
  const som2 = new SOMDocument(doc2)

  assert.equal(som2.getNodeByName('Box').name, 'Box')
  assert.equal(som2.getNodeByName('P'), null)
})

test('A8: renaming onto an existing name is refused and changes nothing', () => {
  const som = new SOMDocument(makeTreeDoc())
  const p = som.getNodeByName('P')

  const result = som.renameNode('P', 'Leaf')
  assert.equal(result.ok, false)
  assert.equal(result.code, 'INVALID_VALUE')
  assert.equal(p.name, 'P', 'the node keeps its name')
  assert.equal(som.getNodeByName('P'), p)
  assert.equal(som.getNodeByName('Leaf').name, 'Leaf', 'the other node is untouched')
})

test('A8: renaming onto a reserved or malformed name is refused', () => {
  const som = new SOMDocument(makeTreeDoc())
  for (const bad of ['__document__', 'Foo.camera', 'Foo.light', 'a/b', '', 'a'.repeat(257)]) {
    const result = som.renameNode('Leaf', bad)
    assert.equal(result.ok, false, `"${bad}" must be refused`)
    assert.equal(result.code, 'INVALID_VALUE')
  }
  assert.equal(som.getNodeByName('Leaf').name, 'Leaf', 'every refusal changed nothing')
})

test('A8: renaming a camera host is refused (D4)', () => {
  const som = new SOMDocument(makeCameraHostDoc())
  const result = som.renameNode('Host', 'Renamed')
  assert.equal(result.ok, false)
  assert.equal(result.code, 'INVALID_VALUE')
  assert.equal(som.getNodeByName('Host').name, 'Host')
})

test('A8: renaming a light host is refused (D4)', () => {
  const som = new SOMDocument(makeLightHostDoc())
  const result = som.renameNode('Sun', 'Renamed')
  assert.equal(result.ok, false)
  assert.equal(result.code, 'INVALID_VALUE')
  assert.equal(som.getNodeByName('Sun').name, 'Sun')
})

test('A8: renaming an unknown name is NODE_NOT_FOUND', () => {
  const som = new SOMDocument(makeTreeDoc())
  assert.deepEqual(som.renameNode('ghost', 'Box'), { ok: false, code: 'NODE_NOT_FOUND', message: null })
})

test('A8: renaming a non-node object is INVALID_FIELD', () => {
  const som = new SOMDocument(makeTreeDoc())
  assert.deepEqual(som.renameNode('__document__', 'Box'), { ok: false, code: 'INVALID_FIELD', message: null })
})

test('A8: SOMNode.name setter throws a typed error and changes nothing', () => {
  const som = new SOMDocument(makeTreeDoc())
  const p = som.getNodeByName('P')

  assert.throws(() => { p.name = 'Leaf' }, (err) => {
    assert.equal(err.code, 'INVALID_VALUE')
    return true
  })
  assert.equal(p.name, 'P')
})
