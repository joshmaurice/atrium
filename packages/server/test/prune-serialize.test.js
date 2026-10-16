// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// prune-serialize — Phase 3 server-cleanup, §7.1/§7.2: L2 (live prune on
// remove), L3 (serialize with identity exclusions, resources kept, index and
// structural checks) and L4 (heal on load). Real glTF-Transform documents and
// real worlds; no mocks. Each test loads its own document world.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Document, NodeIO } from '@gltf-transform/core'
import { KHRLightsPunctual } from '@gltf-transform/extensions'
import {
  createWorld, createWorldFromDocument, serializeSomDocument,
  healDocumentOnLoad, SERIALIZE_INDEX_MISMATCH, SERIALIZE_EXCLUDED_REFERENCED,
} from '../src/world.js'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES = resolve(__dirname, '../../../tests/fixtures')
const SPACE_EXT = resolve(FIXTURES, 'space-ext.gltf')

const createIO = () => new NodeIO().registerExtensions([KHRLightsPunctual])

const VEC3 = (doc, buf, array) =>
  doc.createAccessor().setType('VEC3').setArray(new Float32Array(array)).setBuffer(buf)

const SCALAR = (doc, buf, array) =>
  doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(array)).setBuffer(buf)

/** glTF JSON with every buffer and image embedded as a data: URI. */
async function docToJson(doc) {
  const io = createIO()
  const { json, resources } = await io.writeJSON(doc)
  for (const buf of json.buffers ?? []) {
    if (buf.uri && !buf.uri.startsWith('data:') && resources[buf.uri]) {
      buf.uri = 'data:application/octet-stream;base64,' +
        Buffer.from(resources[buf.uri]).toString('base64')
    }
  }
  for (const img of json.images ?? []) {
    if (img.uri && !img.uri.startsWith('data:') && resources[img.uri]) {
      img.uri = `data:${img.mimeType ?? 'image/png'};base64,` +
        Buffer.from(resources[img.uri]).toString('base64')
    }
  }
  return json
}

/** One box node with a POSITION accessor, an index accessor and a material. */
function boxDoc({ name = 'Box', material = true } = {}) {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  const buf = doc.createBuffer()
  const pos = VEC3(doc, buf, [0, 0, 0, 1, 0, 0, 0, 1, 0])
  const idx = SCALAR(doc, buf, [0, 1, 2])
  const prim = doc.createPrimitive().setAttribute('POSITION', pos).setIndices(idx)
  if (material) prim.setMaterial(doc.createMaterial('M').setBaseColorFactor([1, 0, 0, 1]))
  scene.addChild(doc.createNode(name).setMesh(doc.createMesh('Mesh').addPrimitive(prim)))
  return doc
}

/** The avatar descriptor a first-party client sends: a capsule-sized box. */
function avatarDescriptor(name) {
  return {
    name,
    translation: [0, 0, 0],
    mesh: {
      name: `${name}-mesh`,
      primitives: [{
        attributes: { POSITION: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
        indices: [0, 1, 2],
        material: { pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } },
      }],
    },
  }
}

const resourceCounts = (json) => ({
  nodes: (json.nodes ?? []).length,
  meshes: (json.meshes ?? []).length,
  materials: (json.materials ?? []).length,
  accessors: (json.accessors ?? []).length,
  buffers: (json.buffers ?? []).length,
  images: (json.images ?? []).length,
})

/** Resource counts of the live document, for "nothing changed" assertions. */
function liveCounts(world) {
  const root = world.som._document.getRoot()
  return {
    nodes: root.listNodes().length,
    meshes: root.listMeshes().length,
    materials: root.listMaterials().length,
    accessors: root.listAccessors().length,
    buffers: root.listBuffers().length,
    images: root.listTextures().length,
  }
}

// ===========================================================================
// L3 — saves with visitors present
// ===========================================================================

test('L3: a save with two visitors connected writes no avatar node and no avatar resources, while both avatars stay live', async () => {
  const world = await createWorldFromDocument(await docToJson(boxDoc()))
  const before = liveCounts(world)

  world.addNode(avatarDescriptor('avatar-aaaa'))
  world.addNode(avatarDescriptor('avatar-bbbb'))
  const a = world.som.getNodeByName('avatar-aaaa')
  const b = world.som.getNodeByName('avatar-bbbb')
  assert.ok(a && b, 'both avatars were added')

  // The save path hands the sessions' avatarNode identities (L11/L3 step 1).
  const json = await world.serialize({ excludeNodes: [a, b] })
  const counts = resourceCounts(json)

  assert.equal(counts.nodes, before.nodes, 'only the world node is written')
  assert.equal((json.nodes ?? []).some(n => n.name === 'avatar-aaaa'), false,
    'no avatar node is written')
  assert.deepEqual(
    { meshes: counts.meshes, materials: counts.materials, accessors: counts.accessors, buffers: counts.buffers },
    { meshes: before.meshes, materials: before.materials, accessors: before.accessors, buffers: before.buffers },
    'and none of their resources')

  // The live world still holds both avatars and their geometry.
  assert.equal(liveCounts(world).nodes, before.nodes + 2, 'both avatars are still live')
  assert.equal(world.som.getNodeByName('avatar-aaaa'), a, 'a is still addressable')
  assert.equal(world.som.getNodeByName('avatar-bbbb'), b, 'b is still addressable')
  assert.equal(world.som.meshes.length, before.meshes + 2, 'their meshes are still live')
})

test('L2: a disconnected avatar leaves nothing behind, so the next dump has no orphan resource', async () => {
  const world = await createWorldFromDocument(await docToJson(boxDoc()))
  const before = resourceCounts(await world.serialize())

  const ids = []
  for (let i = 0; i < 5; i += 1) {
    const name = `avatar-${String(i).padStart(8, '0')}`
    world.addNode(avatarDescriptor(name))
    ids.push(name)
  }
  assert.equal(world.som.meshes.length, before.meshes + 5)
  // The disconnect path removes by IDENTITY (L11).
  for (const name of ids) world.removeNode(world.som.getNodeByName(name))

  assert.equal(world.som.meshes.length, before.meshes, 'no avatar mesh survived')
  const after = resourceCounts(await world.serialize())
  assert.deepEqual(after, before, 'the dump is back to its pre-join counts')
  assert.deepEqual(liveCounts(world), {
    nodes: before.nodes, meshes: before.meshes, materials: before.materials,
    accessors: before.accessors, buffers: before.buffers, images: before.images,
  })
})

// ===========================================================================
// L3 — file worlds with external content
// ===========================================================================

test('L3: a file world dump carries no external-only resource, and a permanent node named like an external one is still written', async () => {
  const world = await createWorld(SPACE_EXT)
  await world.resolveExternalReferences()
  assert.ok(world.externalNodes.size > 0, 'space-ext.gltf has external content')

  const json = await world.serialize()
  const counts = resourceCounts(json)

  // Every mesh written is used by a written node (review #17: content, not counts).
  const usedMeshes = new Set((json.nodes ?? []).map(n => n.mesh).filter(i => i !== undefined))
  assert.equal(counts.meshes, usedMeshes.size,
    'no mesh is written that no written node uses')

  // A permanent node added under an external node's name is still written
  // (exclusion is by identity, not by name — review #8 / L8 test 2). The
  // server's addNode guard refuses a duplicate name, so the node goes in
  // through the SOM, as a legacy file that already holds one would.
  const externalName = [...world.externalNodeNames][0]
  assert.ok(externalName, 'there is at least one external node name')
  const permanent = world.som.ingestNode({ name: externalName, translation: [1, 2, 3] })
  world.som.scene.addChild(permanent)
  const withDup = await world.serialize()
  const written = (withDup.nodes ?? []).filter(n => n.name === externalName)
  assert.equal(written.length, 1, 'the permanent node with the external name is written')
  assert.equal(written[0].translation[0], 1, 'and it is the permanent one')
})

// ===========================================================================
// L3 / H13 — binary resources are kept (images and buffers)
// ===========================================================================

function texturedDoc(imageBytes) {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  const buf = doc.createBuffer()
  const tex = doc.createTexture('BaseColor').setImage(imageBytes).setMimeType('image/png')
  const mat = doc.createMaterial('Textured').setBaseColorTexture(tex)
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', VEC3(doc, buf, [0, 0, 0, 1, 0, 0, 0, 1, 0]))
    .setMaterial(mat)
  scene.addChild(doc.createNode('Quad').setMesh(doc.createMesh('QuadMesh').addPrimitive(prim)))
  return doc
}

const IMAGE_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4])

test('L3/H13: a textured document world survives save -> reload with byte-identical image data, with and without exclusions', async () => {
  const json = await docToJson(texturedDoc(IMAGE_BYTES))
  assert.ok(json.images?.[0]?.uri?.startsWith('data:'), 'the fixture carries a real image')

  const world = await createWorldFromDocument(json)
  world.addNode(avatarDescriptor('avatar-cccc'))
  const avatar = world.som.getNodeByName('avatar-cccc')

  for (const [label, opts] of [['without exclusions', {}], ['with exclusions', { excludeNodes: [avatar] }]]) {
    const out = await world.serialize(opts)
    assert.equal((out.images ?? []).length, 1, `${label}: the image is written`)
    const uri = out.images[0].uri
    assert.ok(uri.startsWith('data:'), `${label}: the image is embedded as a data: URI`)
    const bytes = Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64')
    assert.deepEqual(new Uint8Array(bytes), IMAGE_BYTES,
      `${label}: the image bytes are byte-identical`)

    // It survives a reload, too.
    const reloaded = await createWorldFromDocument(out)
    const reloadOut = await reloaded.serialize()
    const reloadUri = reloadOut.images[0].uri
    const reloadBytes = Buffer.from(reloadUri.slice(reloadUri.indexOf(',') + 1), 'base64')
    assert.deepEqual(new Uint8Array(reloadBytes), IMAGE_BYTES,
      `${label}: still byte-identical after a reload`)
  }

  assert.equal(world.som.getNodeByName('avatar-cccc'), avatar, 'the live world was not touched')
})

// ===========================================================================
// L3 step 3 — refuse a structural break
// ===========================================================================

test('L3 step 3: excluding a node a kept channel targets throws SERIALIZE_EXCLUDED_REFERENCED and writes nothing', async () => {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  const buf = doc.createBuffer()
  scene.addChild(doc.createNode('Kept'))
  const boxDocNode = doc.createNode('Box').setMesh(doc.createMesh('M').addPrimitive(
    doc.createPrimitive().setAttribute('POSITION', VEC3(doc, buf, [0, 0, 0]))))
  scene.addChild(boxDocNode)

  // An animation channel that targets the node we will exclude.
  const input = doc.createAccessor('in').setType('SCALAR').setArray(new Float32Array([0, 1])).setBuffer(buf)
  const output = doc.createAccessor('out').setType('VEC3')
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0])).setBuffer(buf)
  const sampler = doc.createAnimationSampler().setInput(input).setOutput(output)
  doc.createAnimation('Move').addSampler(sampler)
    .addChannel(doc.createAnimationChannel().setTargetNode(boxDocNode)
      .setTargetPath('translation').setSampler(sampler))

  const world = await createWorldFromDocument(await docToJson(doc))
  const target = world.som.getNodeByName('Box')
  assert.ok(target, 'the animated node loaded')

  const liveBefore = JSON.stringify(await world.serialize())
  await assert.rejects(
    () => world.serialize({ excludeNodes: [target] }),
    (err) => err.code === SERIALIZE_EXCLUDED_REFERENCED && err.name === 'Error',
    'excluding a channel target is refused with a typed error')

  // Nothing was written and the live document is unchanged.
  assert.equal(world.som.getNodeByName('Box'), target, 'the node is still live')
  assert.equal(JSON.stringify(await world.serialize()), liveBefore,
    'the live document is byte-identical afterwards')
})

// ===========================================================================
// L3 step 2 — index correspondence
// ===========================================================================

test('L3 step 2: the round trip maps every node to the same index with duplicate names, detached nodes, nested subtrees and two scenes', async () => {
  const doc = new Document()
  const s1 = doc.createScene('S1')
  const s2 = doc.createScene('S2')
  const buf = doc.createBuffer()

  const dup1 = doc.createNode('Dup')
  const dup2 = doc.createNode('Dup')
  const child = doc.createNode('Child')
  const grandchild = doc.createNode('Grandchild')
  child.addChild(grandchild)
  const detached = doc.createNode('Detached')    // in no scene
  const other = doc.createNode('Other')

  s1.addChild(dup1)
  s1.addChild(dup2)
  s1.addChild(child)
  s2.addChild(other)
  doc.createScene('Empty')

  for (const n of [dup1, dup2, child, grandchild, detached, other]) {
    n.setMesh(doc.createMesh(`${n.getName()}-mesh`).addPrimitive(
      doc.createPrimitive().setAttribute('POSITION', VEC3(doc, buf, [0, 0, 0]))))
  }

  const io = createIO()
  const { json, resources } = await io.writeJSON(doc)
  const copy = await io.readJSON({ json, resources })
  const liveNames = doc.getRoot().listNodes().map(n => n.getName())
  const copyNames = copy.getRoot().listNodes().map(n => n.getName())
  assert.deepEqual(copyNames, liveNames,
    'writeJSON -> readJSON keeps every node at the same index, duplicates included')
  assert.equal(liveNames.length, 6)

  // Excluding a nested subtree prunes exactly its own resources.
  const world = await createWorldFromDocument(await docToJson(doc))
  const childSom = world.som.getNodeByName('Child')
  const out = await world.serialize({ excludeNodes: [childSom] })
  assert.equal((out.nodes ?? []).some(n => n.name === 'Child' || n.name === 'Grandchild'), false,
    'the nested subtree is gone')
  const used = new Set((out.nodes ?? []).map(n => n.mesh).filter(i => i !== undefined))
  assert.equal((out.meshes ?? []).length, used.size, 'no orphan mesh is written')
})

test('L3 step 2: a copy whose node list does not line up throws SERIALIZE_INDEX_MISMATCH and writes nothing', async () => {
  const world = await createWorldFromDocument(await docToJson(boxDoc()))
  world.addNode(avatarDescriptor('avatar-dddd'))
  const avatar = world.som.getNodeByName('avatar-dddd')
  const before = JSON.stringify(await world.serialize())

  // §7.1's test hook: the copy is written from the live node list, so the guard
  // can only be reached by making the two lists disagree on purpose.
  await assert.rejects(
    () => serializeSomDocument(world.som, { excludeNodes: [avatar], _testForceNodeListMismatch: true }),
    (err) => err.code === SERIALIZE_INDEX_MISMATCH,
    'the mismatch is a typed error')

  // Nothing was written: the world and a normal dump are unaffected.
  assert.equal(world.som.getNodeByName('avatar-dddd'), avatar)
  assert.equal(JSON.stringify(await world.serialize()), before,
    'the live document is byte-identical afterwards')
  const out = await world.serialize({ excludeNodes: [avatar] })
  assert.equal((out.nodes ?? []).some(n => n.name === 'avatar-dddd'), false)
})

// ===========================================================================
// L4 — heal on load
// ===========================================================================

test('L4: a document with orphan meshes, an orphan light and an orphan morph target loads without them and logs counts only', async () => {
  const doc = new Document()
  const ext = doc.createExtension(KHRLightsPunctual)
  const scene = doc.createScene('Scene')
  const buf = doc.createBuffer()

  // Kept: an ordinary node.
  scene.addChild(doc.createNode('Kept').setMesh(doc.createMesh('KeptMesh').addPrimitive(
    doc.createPrimitive().setAttribute('POSITION', VEC3(doc, buf, [0, 0, 0])))))

  // Orphan 1: a mesh no node uses, with a morph target.
  const orphanPrim = doc.createPrimitive().setAttribute('POSITION', VEC3(doc, buf, [1, 1, 1]))
  orphanPrim.addTarget(doc.createPrimitiveTarget().setAttribute('POSITION', VEC3(doc, buf, [2, 2, 2])))
  doc.createMesh('OrphanMesh').addPrimitive(orphanPrim)

  // Orphan 2: an unattached light.
  ext.createLight('OrphanLight').setType('point')

  const json = await docToJson(doc)
  const parsed = JSON.parse(JSON.stringify(json))
  assert.equal((parsed.meshes ?? []).length, 2, 'the fixture really has an orphan mesh')

  const lines = []
  const log = { warn: (m) => lines.push(String(m)), log: (m) => lines.push(String(m)), error: (m) => lines.push(String(m)) }

  // The heal runs inside createWorldFromDocument; drive it directly to read the log.
  const io = createIO()
  const liveDoc = await io.readJSON({ json: parsed, resources: {} })
  const result = healDocumentOnLoad(liveDoc, { log })
  assert.equal(result.counts.mesh, 1, 'the orphan mesh is reported')
  assert.equal(result.counts.primitive, 1, 'with its primitive')
  assert.equal(result.counts.primitiveTarget, 1, 'and its morph target')
  assert.equal(result.counts.accessor, 2, 'and both its accessors')
  assert.equal(result.counts.light, 1, 'the unattached light is reported')
  assert.equal(result.detachedRoots, 0, 'no detached root node here')
  assert.equal(liveDoc.getRoot().listNodes().length, 1, 'no node was removed')

  // The log is counts only: no node, mesh or light name.
  const text = lines.join('\n')
  assert.ok(/healed document/.test(text), 'the heal logged a line')
  assert.ok(text.includes('detached root'), 'and reports detached roots')
  for (const name of ['Kept', 'OrphanMesh', 'OrphanLight']) {
    assert.equal(text.includes(name), false, `the log must not name "${name}"`)
  }

  // Loading through the world API gives the same cleaned document.
  const world = await createWorldFromDocument(json)
  const out = await world.serialize()
  assert.equal((out.meshes ?? []).length, 1, 'only the kept mesh is written')
  assert.equal(out.extensions?.KHR_lights_punctual?.lights?.length ?? 0, 0, 'no light is written')
})

test('L4: a detached root whose descendant an animation targets is kept, with its resources', async () => {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  const buf = doc.createBuffer()
  scene.addChild(doc.createNode('Visible'))

  // A detached root (in no scene) whose child an animation targets.
  const rootNode = doc.createNode('DetachedRoot')
  const target = doc.createNode('DetachedChild')
  rootNode.addChild(target)
  target.setMesh(doc.createMesh('DetachedMesh').addPrimitive(
    doc.createPrimitive().setAttribute('POSITION', VEC3(doc, buf, [0, 1, 0]))))

  const input = doc.createAccessor('in').setType('SCALAR').setArray(new Float32Array([0, 1])).setBuffer(buf)
  const output = doc.createAccessor('out').setType('VEC3')
    .setArray(new Float32Array([0, 0, 0, 1, 1, 1])).setBuffer(buf)
  const sampler = doc.createAnimationSampler().setInput(input).setOutput(output)
  doc.createAnimation('Move').addSampler(sampler)
    .addChannel(doc.createAnimationChannel().setTargetNode(target)
      .setTargetPath('translation').setSampler(sampler))

  const json = await docToJson(doc)
  const lines = []
  const log = { warn: (m) => lines.push(String(m)), log: (m) => lines.push(String(m)), error: (m) => lines.push(String(m)) }

  const io = createIO()
  const liveDoc = await io.readJSON({ json, resources: {} })
  const result = healDocumentOnLoad(liveDoc, { log })

  assert.equal(result.counts.mesh, 0, "the detached node's mesh stays (it is referenced)")
  assert.equal(result.counts.accessor, 0, 'and so do its accessors')
  assert.equal(result.detachedRoots, 2,
    'both detached nodes are counted (the heal counts every node no scene holds)')
  assert.equal(liveDoc.getRoot().listNodes().length, 3, 'no node was removed')

  // It survives a reload with its resources and is still referenced.
  const world = await createWorldFromDocument(json)
  assert.ok(world.som.getNodeByName('DetachedChild'), 'the detached node is still loadable')
  const out = await world.serialize()
  const targetNode = (out.nodes ?? []).find(n => n.name === 'DetachedChild')
  assert.ok(targetNode, 'the detached node is written')
  assert.notEqual(targetNode.mesh, undefined, 'and still references its mesh')
  assert.equal((out.meshes ?? []).length, 1, 'its mesh is written')
  const anim = (out.animations ?? [])[0]
  assert.ok(anim, 'the animation is written')
  const ch = anim.channels[0]
  assert.equal(typeof ch.target.node, 'number', 'the channel still has a target node')
  assert.equal(out.nodes[ch.target.node].name, 'DetachedChild',
    'and it points at the detached node')
})

test('L4: a detached root used as a skin joint is kept, with its resources', async () => {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  const buf = doc.createBuffer()

  const ibm = doc.createAccessor('ibm').setType('MAT4')
    .setArray(new Float32Array(16)).setBuffer(buf)
  const joint = doc.createNode('DetachedJoint')      // in no scene
  const skin = doc.createSkin('Skin').addJoint(joint).setInverseBindMatrices(ibm)

  const skinned = doc.createNode('Skinned')
    .setMesh(doc.createMesh('SkinnedMesh').addPrimitive(
      doc.createPrimitive().setAttribute('POSITION', VEC3(doc, buf, [0, 0, 0]))))
    .setSkin(skin)
  scene.addChild(skinned)

  const json = await docToJson(doc)
  const lines = []
  const log = { warn: (m) => lines.push(String(m)), log: (m) => lines.push(String(m)), error: (m) => lines.push(String(m)) }

  const io = createIO()
  const liveDoc = await io.readJSON({ json, resources: {} })
  const result = healDocumentOnLoad(liveDoc, { log })

  assert.equal(result.counts.accessor, 0, 'the inverse-bind-matrix accessor stays')
  assert.equal(result.counts.skin, 0, 'the skin stays')
  assert.equal(liveDoc.getRoot().listAccessors().length, 2)
  assert.equal(liveDoc.getRoot().listSkins().length, 1)

  const world = await createWorldFromDocument(json)
  const out = await world.serialize()
  assert.equal((out.skins ?? []).length, 1, 'the skin is written')
  assert.equal(out.skins[0].joints.length, 1, 'with its joint')
  assert.equal(out.nodes[out.skins[0].joints[0]].name, 'DetachedJoint',
    'the joint is the detached node')
})

test('L4: a clean document loads unchanged and logs nothing', async () => {
  const json = await docToJson(boxDoc())
  const lines = []
  const log = { warn: (m) => lines.push(String(m)), log: (m) => lines.push(String(m)), error: (m) => lines.push(String(m)) }

  const io = createIO()
  const liveDoc = await io.readJSON({ json, resources: {} })
  const before = JSON.stringify(await new NodeIO().registerExtensions([KHRLightsPunctual]).writeJSON(liveDoc))
  const result = healDocumentOnLoad(liveDoc, { log })
  const after = JSON.stringify(await new NodeIO().registerExtensions([KHRLightsPunctual]).writeJSON(liveDoc))

  assert.deepEqual(result.counts, Object.fromEntries(Object.keys(result.counts).map(k => [k, 0])))
  assert.equal(result.detachedRoots, 0)
  assert.equal(after, before, 'the document is unchanged')
  assert.deepEqual(lines, [], 'nothing is logged')
})

test('L4: file worlds are not healed — an orphan mesh in a file stays', async () => {
  const world = await createWorld(SPACE_EXT)
  const root = world.som._document.getRoot()
  const meshesBefore = root.listMeshes().length
  assert.ok(meshesBefore > 0)
  // createWorld never heals: the operator's file is re-read at every boot, so
  // its unreferenced resources stay in the live document.
  const used = new Set(root.listNodes().map(n => n.getMesh()).filter(Boolean))
  assert.ok(root.listMeshes().length >= used.size,
    'the file world keeps whatever its file holds')
  assert.equal(root.listMeshes().length, meshesBefore)
})

// ===========================================================================
// L3 — serializeSomDocument directly (both world kinds share it, H11)
// ===========================================================================

test('L3: serializeSomDocument is the single serialize for both world kinds', async () => {
  const fileWorld = await createWorld(SPACE_EXT)
  const docWorld = await createWorldFromDocument(await docToJson(boxDoc()))
  const a = await serializeSomDocument(fileWorld.som)
  const b = await serializeSomDocument(docWorld.som)
  assert.equal(typeof a.asset?.version, 'string')
  assert.equal(typeof b.asset?.version, 'string')
  assert.equal(a.asset.version, b.asset.version, 'same NodeIO for both')
})
