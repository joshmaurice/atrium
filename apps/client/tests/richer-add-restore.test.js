// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// richer-add R7/R8 (devtasks/PREBRIEF-richer-add.md §5) — Duplicate's and
// Undo's canonical form against REAL glTF-Transform documents: the fixture
// worlds, the real `SOMDocument.ingestNode`, and glTF-Transform's own writer
// and reader (what a save and a joiner's som-dump use).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readdirSync } from 'node:fs'
import { duplicateRuleProblem, prepareRestore, prepareDuplicate, hasSharedMaterial } from '../src/edit-duplicate.js'
import { SOMDocument } from '../../../packages/som/src/SOMDocument.js'
import { serializeSomDocument } from '../../../packages/server/src/world.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../../..')
// The ES module builds, the ones the SOM and the server load: a CommonJS copy
// would make accessors the writer doesn't recognise as its own.
const { Document, NodeIO, WebIO } = await import('../../../packages/som/node_modules/@gltf-transform/core/dist/index.modern.js')
const { ALL_EXTENSIONS, KHRONOS_EXTENSIONS } = await import('../../../packages/som/node_modules/@gltf-transform/extensions/dist/index.modern.js')

const fileIO = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const wireIO = new WebIO().registerExtensions(KHRONOS_EXTENSIONS)

const FIXTURES = [
  ...readdirSync(resolve(ROOT, 'tests/fixtures')).filter((f) => f.endsWith('.gltf')).map((f) => resolve(ROOT, 'tests/fixtures', f)),
  resolve(ROOT, 'devtasks/harness/group.gltf'),
]

const topLevel = (doc) => (doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]).listChildren()
const byName = (doc, name) => doc.getRoot().listNodes().find((n) => n.getName() === name)

/** The restore's `add`, ingested by the real ingestNode into a fresh world, in its scene. */
function ingest(descriptor) {
  const doc = new Document()
  const scene = doc.createScene()
  const som = new SOMDocument(doc)
  som.ingestNode(descriptor)
  const node = byName(doc, descriptor.name)
  scene.addChild(node)
  return { doc, som, node }
}

/**
 * A save and a read back: the server's own `serializeSomDocument` (what
 * autosave and a join's som-dump write), read with the client's WebIO and
 * KHRONOS_EXTENSIONS, as `_onSomDump` does.
 */
async function saveAndReload(som) {
  const json = await serializeSomDocument(som)
  return wireIO.readJSON({ json: JSON.parse(JSON.stringify(json)), resources: {} })
}

/** Is this value within the writer's 1e-5 of [1, 1, 1, 1] without being it (R7's stated limit)? */
function nearDefaultBaseColor(descriptor) {
  return (descriptor.mesh?.primitives ?? []).some((p) => {
    const c = p.material?.pbrMetallicRoughness?.baseColorFactor
    return c && c.some((v) => v !== 1) && c.every((v) => Math.abs(v - 1) <= 10e-6)
  })
}

describe('richer-add R7: the fixed point over every fixture world', () => {
  test('prepareRestore of the re-ingested node equals the descriptor, live and after a save and a reload', async () => {
    let restorable = 0
    for (const file of FIXTURES) {
      const doc = await fileIO.read(file)
      for (const node of topLevel(doc)) {
        const r = prepareRestore(node)
        if (!r.ok) continue
        restorable += 1
        const where = `${file.split('/').pop()}: ${node.getName()}`
        const live = ingest(r.descriptor)
        const again = prepareRestore(live.node)
        assert.equal(again.ok, true, `${where}: ${again.reason}`)
        assert.deepStrictEqual(again.descriptor, r.descriptor, `${where}: live`)
        if (nearDefaultBaseColor(r.descriptor)) continue      // R7's stated limit; none in the fixtures
        const reloaded = await saveAndReload(live.som)
        const third = prepareRestore(byName(reloaded, node.getName()))
        assert.equal(third.ok, true, `${where}: ${third.reason}`)
        assert.deepStrictEqual(third.descriptor, r.descriptor, `${where}: after a save and a reload`)
      }
    }
    assert.equal(restorable, 14, 'the 13 named-material top-level objects and group.gltf’s Floor')
  })

  // Named, so it shows in the count (the review's N2), never folded into a PASS.
  test.skip('R7 stated limit: a base colour within 1e-5 of [1, 1, 1, 1] matches live but not after a reload (the writer omits it; true today)', () => {})
})

describe('richer-add R7: what the fixtures gain (p1 as a test)', () => {
  test('no top-level fixture object is refused for its mesh any more', async () => {
    const refusals = new Map()
    for (const file of FIXTURES) {
      for (const node of topLevel(await fileIO.read(file))) {
        const p = duplicateRuleProblem(node)
        if (p) refusals.set(p.rule, (refusals.get(p.rule) ?? 0) + 1)
      }
    }
    assert.equal(refusals.get('mesh') ?? 0, 0, JSON.stringify([...refusals]))
  })

  test('the commons’ ground-plane and crate-01 restore, keeping their material names', async () => {
    const doc = await fileIO.read(resolve(ROOT, 'tests/fixtures/space.gltf'))
    for (const name of ['ground-plane', 'crate-01']) {
      const r = prepareRestore(byName(doc, name))
      assert.equal(r.ok, true, `${name}: ${r.reason}`)
      const original = byName(doc, name).getMesh().listPrimitives()[0].getMaterial().getName()
      assert.equal(r.descriptor.mesh.primitives[0].material.name, original)
      assert.equal(prepareDuplicate(byName(doc, name), { name: `${name} copy` }).ok, true)
    }
  })
})

describe('richer-add R8: sharing (RA-L3 (a))', () => {
  test('atrium.gltf’s FloorAccent and Ceiling restore with sharedMaterial, and each restored primitive has its own material', async () => {
    const doc = await fileIO.read(resolve(ROOT, 'tests/fixtures/atrium.gltf'))
    for (const name of ['FloorAccent', 'Ceiling']) {
      const node = byName(doc, name)
      assert.equal(hasSharedMaterial(node), true, name)
      const r = prepareRestore(node)
      assert.equal(r.ok, true, `${name}: ${r.reason}`)
      assert.equal(r.sharedMaterial, true)
      const restored = ingest(r.descriptor).node
      for (const prim of restored.getMesh().listPrimitives()) {
        const users = prim.getMaterial().listParents().filter((p) => p.propertyType === 'Primitive').length
        assert.equal(users, 1, `${name}: the restored primitive's material is its own`)
      }
    }
    assert.equal(prepareRestore(byName(doc, 'Floor')).sharedMaterial, undefined, 'Floor shares nothing')
  })

  function tri(doc, buffer) {
    return doc.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buffer)
  }

  test('a mesh used by two nodes counts as shared', () => {
    const doc = new Document(); const b = doc.createBuffer(); const scene = doc.createScene()
    const mesh = doc.createMesh().addPrimitive(doc.createPrimitive().setAttribute('POSITION', tri(doc, b)).setMaterial(doc.createMaterial()))
    const a = doc.createNode('A').setMesh(mesh); scene.addChild(a); scene.addChild(doc.createNode('B').setMesh(mesh))
    assert.equal(hasSharedMaterial(a), true)
    assert.equal(prepareRestore(a).sharedMaterial, true)
  })

  test('an orphan mesh’s primitive does not make a material count as shared', () => {
    const doc = new Document(); const b = doc.createBuffer(); const scene = doc.createScene()
    const mat = doc.createMaterial()
    const a = doc.createNode('A').setMesh(doc.createMesh().addPrimitive(doc.createPrimitive().setAttribute('POSITION', tri(doc, b)).setMaterial(mat)))
    scene.addChild(a)
    doc.createMesh('orphan').addPrimitive(doc.createPrimitive().setAttribute('POSITION', tri(doc, b)).setMaterial(mat))
    assert.equal(hasSharedMaterial(a), false)
    assert.equal(prepareRestore(a).sharedMaterial, undefined)
  })
})

describe('richer-add R7: every new field through the full round trip (the review’s S3)', () => {
  /** A real node carrying the R1 fields, COLOR_0 of `size` values per vertex. */
  function richDoc(size) {
    const doc = new Document(); const b = doc.createBuffer(); const scene = doc.createScene()
    const acc = (type, arr) => doc.createAccessor().setType(type).setArray(new Float32Array(arr)).setBuffer(b)
    const color = size === 3 ? [1, 0, 0, 0, 1, 0, 0, 0, 1] : [1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0.5]
    const mat = doc.createMaterial('Glass').setExtras({ note: 'x' }).setEmissiveFactor([0.25, 0.5, 0])
      .setAlphaMode('MASK').setAlphaCutoff(0.25).setDoubleSided(true).setBaseColorFactor([0.5, 0.5, 0.5, 1])
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', acc('VEC3', [0, 0, 0, 1, 0, 0, 0, 1, 0]))
      .setAttribute('NORMAL', acc('VEC3', [0, 0, 1, 0, 0, 1, 0, 0, 1]))
      .setAttribute('TEXCOORD_0', acc('VEC2', [0, 0, 1, 0, 0, 1]))
      .setAttribute('TEXCOORD_1', acc('VEC2', [0, 0, 0.5, 0, 0, 0.5]))
      .setAttribute('COLOR_0', acc(size === 3 ? 'VEC3' : 'VEC4', color))
      .setMaterial(mat).setExtras({ tag: 'p' })
    const node = doc.createNode('Rich').setMesh(doc.createMesh('RichMesh').addPrimitive(prim).setExtras({ lod: 0 }))
    scene.addChild(node)
    return { doc, node }
  }

  for (const size of [3, 4]) {
    test(`COLOR_0 VEC${size} with a material: prepareRestore → ingestNode → save → reload → prepareRestore`, async () => {
      const { node } = richDoc(size)
      const r = prepareRestore(node)
      assert.equal(r.ok, true, r.reason)
      const live = ingest(r.descriptor)
      assert.equal(live.node.getMesh().listPrimitives()[0].getAttribute('COLOR_0').getType(), `VEC${size}`)
      const reloaded = await saveAndReload(live.som)
      const back = byName(reloaded, 'Rich')
      assert.equal(back.getMesh().listPrimitives()[0].getAttribute('COLOR_0').getType(), `VEC${size}`, 'the type survives a save')
      assert.deepStrictEqual(prepareRestore(back).descriptor, r.descriptor)
      const m = r.descriptor.mesh.primitives[0].material
      assert.deepEqual(m, {
        name: 'Glass', extras: { note: 'x' },
        pbrMetallicRoughness: { baseColorFactor: [0.5, 0.5, 0.5, 1], metallicFactor: 1, roughnessFactor: 1 },
        emissiveFactor: [0.25, 0.5, 0], alphaMode: 'MASK', alphaCutoff: 0.25, doubleSided: true,
      })
    })
  }
})
