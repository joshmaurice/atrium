// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// prune-rule — Phase 3 server-cleanup, L1/L2 and the L1 dry run (§7.1).
//
// Real glTF-Transform Documents and real SOMDocuments; no mocks.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Document, NodeIO } from '@gltf-transform/core'
import { KHRLightsPunctual } from '@gltf-transform/extensions'
import { SOMDocument } from '../src/SOMDocument.js'
import {
  pruneDocumentInPlace,
  pruneDocumentDryRun,
  countDocumentResources,
  collectExtensionLights,
  copyDocument,
} from '../src/prune.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VEC3 = (doc, buf, array) =>
  doc.createAccessor().setType('VEC3').setArray(new Float32Array(array)).setBuffer(buf)

const SCALAR = (doc, buf, array) =>
  doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(array)).setBuffer(buf)

async function serialize(doc) {
  const io = new NodeIO()
  const { json } = await io.writeJSON(doc)
  return json
}

const rootOf = (doc) => doc.getRoot()

// A document with one node 'A' holding one mesh: a POSITION accessor, an index
// accessor, a material and a buffer.
function oneMeshDoc() {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  const buf = doc.createBuffer()
  const pos = VEC3(doc, buf, [0, 0, 0, 1, 0, 0, 0, 1, 0])
  const idx = SCALAR(doc, buf, [0, 1, 2])
  const mat = doc.createMaterial('M').setBaseColorFactor([1, 0, 0, 1])
  const prim = doc.createPrimitive().setAttribute('POSITION', pos).setIndices(idx).setMaterial(mat)
  const mesh = doc.createMesh('Mesh').addPrimitive(prim)
  const a = doc.createNode('A').setMesh(mesh)
  scene.addChild(a)
  return { doc, scene, a, mesh }
}

// ---------------------------------------------------------------------------
// L1/L2 on remove
// ---------------------------------------------------------------------------

test('L2: a removed node\'s mesh, primitives, accessors, material and buffer are gone from root, maps and output', async () => {
  const { doc, a } = oneMeshDoc()
  const som = new SOMDocument(doc)

  assert.equal(rootOf(doc).listMeshes().length, 1)
  assert.equal(som.meshes.length, 1)
  assert.equal(som.materials.length, 1)
  assert.equal(rootOf(doc).listAccessors().length, 2)

  som.removeSubtree(som.getNodeByName('A'))

  assert.equal(rootOf(doc).listMeshes().length, 0, 'no mesh left in the root')
  assert.equal(rootOf(doc).listAccessors().length, 0, 'no accessor left')
  assert.equal(rootOf(doc).listBuffers().length, 0, 'no buffer left')
  assert.equal(rootOf(doc).listMaterials().length, 0, 'no material left')
  assert.equal(som.meshes.length, 0, 'som.meshes is empty')
  assert.equal(som.materials.length, 0, 'som.materials is empty')
  assert.equal(som.getNodeByName('A'), null, 'the node is gone')
  assert.equal(rootOf(doc).listNodes().length, 0, 'the node is gone from the document')

  const json = await serialize(doc)
  assert.deepEqual([...(json.meshes ?? []), ...(json.accessors ?? []),
    ...(json.materials ?? []), ...(json.buffers ?? [])], [],
    'the serialized document carries no orphan resource')
})

test('L1: a mesh used by two nodes survives, and the surviving node keeps its wrapper', async () => {
  const { doc, scene, mesh } = oneMeshDoc()
  const b = doc.createNode('B').setMesh(mesh)
  scene.addChild(b)
  const som = new SOMDocument(doc)

  som.removeSubtree(som.getNodeByName('A'))

  assert.equal(rootOf(doc).listMeshes().length, 1, 'the shared mesh survives')
  assert.equal(som.meshes.length, 1)
  assert.equal(som.materials.length, 1, 'the shared material survives')
  assert.equal(rootOf(doc).listAccessors().length, 2, 'the shared accessors survive')
  // wrapper identity: B's mesh is still the very same SOMMesh instance
  assert.equal(som.getNodeByName('B').mesh, som.meshes[0])
  assert.equal(som.meshes[0]._mesh, mesh)
})

test('L1: a material shared with a surviving primitive survives', async () => {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  const buf = doc.createBuffer()
  const mat = doc.createMaterial('Shared').setBaseColorFactor([1, 1, 1, 1])

  const meshA = doc.createMesh('A').addPrimitive(
    doc.createPrimitive().setAttribute('POSITION', VEC3(doc, buf, [0, 0, 0])).setMaterial(mat))
  const meshB = doc.createMesh('B').addPrimitive(
    doc.createPrimitive().setAttribute('POSITION', VEC3(doc, buf, [1, 0, 0])).setMaterial(mat))

  scene.addChild(doc.createNode('A').setMesh(meshA))
  scene.addChild(doc.createNode('B').setMesh(meshB))
  const som = new SOMDocument(doc)

  som.removeSubtree(som.getNodeByName('A'))

  assert.equal(rootOf(doc).listMaterials().length, 1, 'the shared material survives')
  assert.equal(som.materials.length, 1)
  assert.equal(rootOf(doc).listMeshes().length, 1, 'A\'s mesh is gone, B\'s stays')
})

test('L1: a texture used by two materials survives when one material goes', async () => {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  const buf = doc.createBuffer()
  const tex = doc.createTexture('T').setImage(new Uint8Array([1, 2, 3])).setMimeType('image/png')

  const matA = doc.createMaterial('A').setBaseColorTexture(tex)
  const matB = doc.createMaterial('B').setBaseColorTexture(tex)
  const meshA = doc.createMesh('MA').addPrimitive(
    doc.createPrimitive().setAttribute('POSITION', VEC3(doc, buf, [0, 0, 0])).setMaterial(matA))
  const meshB = doc.createMesh('MB').addPrimitive(
    doc.createPrimitive().setAttribute('POSITION', VEC3(doc, buf, [1, 0, 0])).setMaterial(matB))
  scene.addChild(doc.createNode('A').setMesh(meshA))
  scene.addChild(doc.createNode('B').setMesh(meshB))
  const som = new SOMDocument(doc)

  assert.equal(rootOf(doc).listTextures().length, 1)
  som.removeSubtree(som.getNodeByName('A'))

  assert.equal(rootOf(doc).listMaterials().length, 1, 'only B\'s material is left')
  assert.equal(rootOf(doc).listTextures().length, 1, 'the shared texture survives')
  assert.equal(som.textures.length, 1, 'som.textures still holds it')
})

test('L1: the texture goes when its last material goes', async () => {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  const buf = doc.createBuffer()
  const tex = doc.createTexture('T').setImage(new Uint8Array([1, 2, 3])).setMimeType('image/png')
  const matA = doc.createMaterial('A').setBaseColorTexture(tex)
  const matB = doc.createMaterial('B').setBaseColorTexture(tex)
  const meshA = doc.createMesh('MA').addPrimitive(
    doc.createPrimitive().setAttribute('POSITION', VEC3(doc, buf, [0, 0, 0])).setMaterial(matA))
  const meshB = doc.createMesh('MB').addPrimitive(
    doc.createPrimitive().setAttribute('POSITION', VEC3(doc, buf, [1, 0, 0])).setMaterial(matB))
  scene.addChild(doc.createNode('A').setMesh(meshA))
  scene.addChild(doc.createNode('B').setMesh(meshB))
  const som = new SOMDocument(doc)

  som.removeSubtree(som.getNodeByName('A'))
  som.removeSubtree(som.getNodeByName('B'))

  assert.equal(rootOf(doc).listMaterials().length, 0)
  assert.equal(rootOf(doc).listTextures().length, 0, 'the texture went with its last material')
  assert.equal(som.textures.length, 0)
})

test('L1: a morph-target accessor shared with kept geometry survives; the target\'s own accessor goes', async () => {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  const buf = doc.createBuffer()

  const shared = VEC3(doc, buf, [0, 0, 0, 1, 0, 0, 0, 1, 0])
  const own    = VEC3(doc, buf, [0, 1, 0, 0, 1, 0, 0, 1, 0])

  // Kept: a primitive whose POSITION is the shared accessor.
  const keptPrim = doc.createPrimitive().setAttribute('POSITION', shared)
  scene.addChild(doc.createNode('Kept').setMesh(doc.createMesh('KeptMesh').addPrimitive(keptPrim)))

  // Removed: a primitive with a morph target that re-uses the shared accessor
  // and one that does not.
  const gonePrim = doc.createPrimitive().setAttribute('POSITION', VEC3(doc, buf, [2, 0, 0]))
  gonePrim.addTarget(doc.createPrimitiveTarget().setAttribute('POSITION', shared))
  gonePrim.addTarget(doc.createPrimitiveTarget().setAttribute('POSITION', own))
  const goneMesh = doc.createMesh('GoneMesh').addPrimitive(gonePrim)
  scene.addChild(doc.createNode('Gone').setMesh(goneMesh))

  const som = new SOMDocument(doc)
  assert.equal(rootOf(doc).listAccessors().length, 3)

  som.removeSubtree(som.getNodeByName('Gone'))

  const accessors = rootOf(doc).listAccessors()
  assert.equal(accessors.length, 1, 'only the shared accessor is left')
  assert.equal(accessors[0], shared, 'the shared morph-target accessor survived')
})

test('L1: a skin\'s joints and inverse-bind-matrix accessor survive while a node still uses the skin', async () => {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  const buf = doc.createBuffer()
  const ibm = doc.createAccessor().setType('MAT4')
    .setArray(new Float32Array(16)).setBuffer(buf)

  const joint = doc.createNode('Joint')
  scene.addChild(joint)
  const skin = doc.createSkin('Skin').addJoint(joint).setInverseBindMatrices(ibm)

  const meshA = doc.createMesh('MA').addPrimitive(
    doc.createPrimitive().setAttribute('POSITION', VEC3(doc, buf, [0, 0, 0])))
  const meshB = doc.createMesh('MB').addPrimitive(
    doc.createPrimitive().setAttribute('POSITION', VEC3(doc, buf, [1, 0, 0])))

  scene.addChild(doc.createNode('A').setMesh(meshA).setSkin(skin))
  scene.addChild(doc.createNode('B').setMesh(meshB).setSkin(skin))

  const som = new SOMDocument(doc)
  assert.equal(rootOf(doc).listSkins().length, 1)

  som.removeSubtree(som.getNodeByName('A'))

  assert.equal(rootOf(doc).listSkins().length, 1, 'the skin survives (B still uses it)')
  assert.equal(som.skins.length, 1)
  assert.equal(rootOf(doc).listAccessors().length, 2, 'the IBM accessor and B\'s POSITION survive')
  assert.ok(rootOf(doc).listAccessors().includes(ibm), 'the inverse-bind-matrix accessor survived')
  assert.equal(skin.listJoints().length, 1, 'the joint survives')

  // now the last user goes
  som.removeSubtree(som.getNodeByName('B'))
  assert.equal(rootOf(doc).listSkins().length, 0)
  assert.equal(rootOf(doc).listAccessors().length, 0, 'the IBM accessor went with the skin')
})

test('L1: an accessor used only by animation samplers survives a whole-document prune', async () => {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  const buf = doc.createBuffer()
  const node = doc.createNode('N')
  scene.addChild(node)

  // Two samplers share one output accessor (never pruned: Animation and its
  // channels and samplers are excluded).
  const input = doc.createAccessor('in').setType('SCALAR')
    .setArray(new Float32Array([0, 1])).setBuffer(buf)
  const output = doc.createAccessor('out').setType('VEC3')
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0])).setBuffer(buf)

  const sampler1 = doc.createAnimationSampler().setInput(input).setOutput(output)
  const sampler2 = doc.createAnimationSampler().setInput(input).setOutput(output)
  const channel1 = doc.createAnimationChannel().setTargetNode(node).setTargetPath('translation').setSampler(sampler1)
  const channel2 = doc.createAnimationChannel().setTargetNode(node).setTargetPath('scale').setSampler(sampler2)
  doc.createAnimation('A').addSampler(sampler1).addSampler(sampler2).addChannel(channel1).addChannel(channel2)

  const counts = pruneDocumentInPlace(doc).counts
  assert.equal(counts.accessor, 0, 'animation sampler accessors are never pruned')
  assert.equal(rootOf(doc).listAccessors().length, 2)
})

test('L1: an orphan morph target and its accessors go (whole-document mode)', async () => {
  const doc = new Document()
  const buf = doc.createBuffer()
  const own = VEC3(doc, buf, [9, 9, 9])
  const prim = doc.createPrimitive().setAttribute('POSITION', VEC3(doc, buf, [0, 0, 0]))
  prim.addTarget(doc.createPrimitiveTarget().setAttribute('POSITION', own))
  // The mesh is created but no node uses it, and it is in no scene.
  doc.createMesh('Orphan').addPrimitive(prim)

  const counts = pruneDocumentInPlace(doc).counts
  assert.equal(counts.mesh, 1, 'the orphan mesh went')
  assert.equal(counts.primitive, 1)
  assert.equal(counts.primitiveTarget, 1, 'the orphan morph target went')
  assert.equal(counts.accessor, 2, 'both its accessors went')
  assert.equal(rootOf(doc).listMeshes().length, 0)
  assert.equal(rootOf(doc).listAccessors().length, 0)
})

test('L1: an unattached light goes (whole-document mode)', async () => {
  const doc = new Document()
  const ext = doc.createExtension(KHRLightsPunctual)
  ext.setRequired(false)
  const scene = doc.createScene('Scene')
  const host = doc.createNode('H')
  scene.addChild(host)

  const light = ext.createLight('Glow').setType('point').setIntensity(5)
  host.setExtension('KHR_lights_punctual', light)

  assert.equal(collectExtensionLights(rootOf(doc)).length, 1)
  const som = new SOMDocument(doc)
  assert.equal(som.lights.length, 1)

  som.removeSubtree(som.getNodeByName('H'))

  assert.equal(collectExtensionLights(rootOf(doc)).length, 0, 'the light went with its host')
  assert.equal(som.lights.length, 0)
})

test('L1: a detached node keeps its resources (only whole-document orphans are pruned)', async () => {
  const doc = new Document()
  const buf = doc.createBuffer()
  const mesh = doc.createMesh('M').addPrimitive(
    doc.createPrimitive().setAttribute('POSITION', VEC3(doc, buf, [0, 0, 0])))
  // Not in any scene — but glTF allows nodes outside every scene on purpose.
  doc.createNode('Detached').setMesh(mesh)

  const counts = pruneDocumentInPlace(doc).counts
  assert.equal(counts.mesh, 0, 'a detached node\'s mesh is referenced and stays')
  assert.equal(counts.accessor, 0)
  assert.equal(rootOf(doc).listMeshes().length, 1)
})

test('L2: removing a subtree takes the children\'s resources too', async () => {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  const buf = doc.createBuffer()
  const parent = doc.createNode('P')
  const child = doc.createNode('C')
  parent.addChild(child)
  scene.addChild(parent)
  parent.setMesh(doc.createMesh('PM').addPrimitive(
    doc.createPrimitive().setAttribute('POSITION', VEC3(doc, buf, [0, 0, 0]))))
  child.setMesh(doc.createMesh('CM').addPrimitive(
    doc.createPrimitive().setAttribute('POSITION', VEC3(doc, buf, [1, 1, 1]))))

  const som = new SOMDocument(doc)
  som.removeSubtree(som.getNodeByName('P'))

  assert.equal(rootOf(doc).listNodes().length, 0)
  assert.equal(rootOf(doc).listMeshes().length, 0, 'both meshes went')
  assert.equal(rootOf(doc).listAccessors().length, 0, 'both accessors went')
  assert.equal(rootOf(doc).listBuffers().length, 0)
})

// ---------------------------------------------------------------------------
// L1 dry run
// ---------------------------------------------------------------------------

test('L1 dry run: counts equal a real prune of a copy, and the original is byte-identical', async () => {
  // An orphan chain: mesh → primitive → accessor → buffer.
  const doc = new Document()
  const buf = doc.createBuffer()
  const prim = doc.createPrimitive().setAttribute('POSITION', VEC3(doc, buf, [0, 0, 0]))
  doc.createMesh('Orphan').addPrimitive(prim)
  doc.createScene('Empty')

  const before = JSON.stringify(await serialize(doc))
  const dryRun = await pruneDocumentDryRun(doc)
  const after = JSON.stringify(await serialize(doc))

  assert.equal(after, before, 'the dry run leaves the original byte-identical')
  assert.equal(dryRun.mesh, 1)
  assert.equal(dryRun.primitive, 1)
  assert.equal(dryRun.accessor, 1)
  assert.equal(dryRun.buffer, 1)
  assert.equal(doc.getRoot().listMeshes().length, 1, 'the original still has its mesh')

  // A real prune of an independent copy agrees, count for count.
  const realCopy = await copyDocument(doc)
  const real = pruneDocumentInPlace(realCopy).counts
  assert.deepEqual(real, dryRun, 'the dry run agrees with a real prune of a copy')
})

test('L1 dry run: a clean document reports nothing to remove', async () => {
  const { doc } = oneMeshDoc()
  const before = JSON.stringify(await serialize(doc))
  const dryRun = await pruneDocumentDryRun(doc)
  const after = JSON.stringify(await serialize(doc))

  assert.equal(after, before)
  for (const [key, value] of Object.entries(dryRun)) {
    assert.equal(value, 0, `${key} must be 0`)
  }
  assert.equal(countDocumentResources(rootOf(doc)).meshes, 1)
})
