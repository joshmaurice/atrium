// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// model-isolation.test.js — models-by-url step 5 (Z4, A7).
//
// The invariant, with a REAL GLTFLoader parse of an in-test GLB whose parts are
// named like world nodes: every scene lookup resolves to the world node, a world
// clip moves the world node and no model part, and the model's own retargeted
// clip still moves its own part — for two instances of one template, each clip
// its own instance's part only.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Group, Object3D, Mesh, AnimationMixer, AnimationClip, VectorKeyframeTrack, Box3 } from 'three'
import { parseTemplate } from '../src/model-parse.js'
import { buildInstance, buildPlaceholder, disposeInstance, retargetClip, PLACEHOLDER_COLOURS } from '../src/model-instances.js'
import { walkUpToSOMNode } from '../src/hit-test.js'
import { modelGlb } from './glb-fixture.js'

const parseModel = async () => {
  const result = await parseTemplate({
    kind: 'glb',
    bytes: modelGlb({ parts: ['Door', 'Cube'], clipTarget: 'Door', withLight: true, withCamera: true }),
  })
  assert.equal(result.ok, true, result.message)
  return result.template
}

/** A world under `sceneGroup`: `Chair` (the host), a real world `Door`, and a `Cube`. */
function worldUnder() {
  const sceneGroup = new Group()
  const nodes = new Map()
  for (const name of ['Chair', 'Door', 'Cube']) {
    const object = new Object3D()
    object.name = name
    sceneGroup.add(object)
    nodes.set(name, object)
  }
  return { sceneGroup, nodes }
}

const lookup = (nodes) => (name) => nodes.get(name) ?? null

test('Z4/A7: names inside the instance are cleared, and the originals are kept', async () => {
  const template = await parseModel()
  const instance = buildInstance(template)
  const names = []
  instance.scene.traverse((object) => names.push(object.name))
  assert.deepEqual(names.filter((n) => n !== ''), [], 'no part keeps a name')
  const kept = []
  instance.scene.traverse((object) => { if (object.userData.atriumModelName) kept.push(object.userData.atriumModelName) })
  assert.ok(kept.includes('Door') && kept.includes('Cube'), kept.join(','))
})

test('Z4: the wrapper is a plain Object3D, never a Group (P3)', async () => {
  const template = await parseModel()
  const { wrapper } = buildInstance(template)
  assert.ok(!wrapper.isGroup, 'a Group would be removed by detachMesh')
  assert.equal(wrapper.type, 'Object3D')
  assert.equal(wrapper.name, '')
  assert.equal(wrapper.userData.atriumModel, true)
})

test('Z4 (the invariant): every lookup resolves to the world node', async () => {
  const template = await parseModel()
  const { sceneGroup, nodes } = worldUnder()
  const { wrapper } = buildInstance(template)
  nodes.get('Chair').add(wrapper)

  // A hit on a model part walks up to the host world node, never to a world
  // node that merely shares the part's old name.
  let part = null
  wrapper.traverse((object) => { if (object.isMesh && !part) part = object })
  assert.ok(part, 'the instance has a mesh')
  const walked = walkUpToSOMNode(part, lookup(nodes))
  assert.equal(walked.somNode, nodes.get('Chair'), 'the walk stops at the host')

  // getObjectByName of a world node's name returns the WORLD node: the model
  // part is either unnamed or deeper than the world node in the scene order.
  assert.equal(sceneGroup.getObjectByName('Door'), nodes.get('Door'))
  assert.equal(sceneGroup.getObjectByName('Cube'), nodes.get('Cube'))
})

test('Z4 (the invariant): a world clip moves the world node and no model part', async () => {
  const template = await parseModel()
  const { sceneGroup, nodes } = worldUnder()
  const first = buildInstance(template)
  nodes.get('Chair').add(first.wrapper)

  const partBefore = []
  first.scene.traverse((object) => partBefore.push(object.position.clone()))

  const clip = new AnimationClip('world', 1, [
    new VectorKeyframeTrack('Door.position', [0, 1], [0, 0, 0, 5, 0, 0]),
  ])
  const mixer = new AnimationMixer(sceneGroup)
  mixer.clipAction(clip).play()
  mixer.update(0.5)

  assert.equal(nodes.get('Door').position.x, 2.5, 'the world node moved')
  const partAfter = []
  first.scene.traverse((object) => partAfter.push(object.position.clone()))
  assert.deepEqual(partAfter.map((v) => [v.x, v.y, v.z]), partBefore.map((v) => [v.x, v.y, v.z]),
    'no model part moved')
})

test('Z4/A7: the model’s own clip still moves its own part, in one instance', async () => {
  const template = await parseModel()
  const instance = buildInstance(template)
  assert.equal(instance.clips.length, 1, 'the clip survives the retarget')
  assert.equal(instance.droppedTracks, 0, 'nothing had to be dropped')

  let part = null
  instance.scene.traverse((object) => { if (object.userData.atriumModelName === 'Door') part = object })
  const mixer = new AnimationMixer(instance.scene)
  mixer.clipAction(instance.clips[0]).play()
  mixer.update(0.5)
  assert.equal(part.position.x, 0.5, 'the part the clip targets moved')
})

test('A7: two instances of one template — each clip moves only its own instance', async () => {
  const template = await parseModel()
  const a = buildInstance(template)
  const b = buildInstance(template)
  const partOf = (instance) => {
    let found = null
    instance.scene.traverse((object) => { if (object.userData.atriumModelName === 'Door') found = object })
    return found
  }
  const mixerA = new AnimationMixer(a.scene)
  mixerA.clipAction(a.clips[0]).play()
  mixerA.update(0.5)

  assert.equal(partOf(a).position.x, 0.5, 'the first instance’s part moved')
  assert.equal(partOf(b).position.x, 0, 'the second instance is untouched')
})

test('A7: an unresolvable track is dropped and counted, never bound to a guess', async () => {
  const template = await parseModel()
  const clips = [...template.animations, new AnimationClip('stray', 1, [
    new VectorKeyframeTrack('NoSuchPart.position', [0, 1], [0, 0, 0, 9, 0, 0]),
  ])]
  const instance = buildInstance({ scene: template.scene, animations: clips })
  assert.equal(instance.droppedTracks, 1, 'the stray track is reported')
  assert.equal(instance.clips.length, 1)
  // And a clip whose every track is unresolvable produces no clip at all.
  const only = retargetClip(new AnimationClip('none', 1, [new VectorKeyframeTrack('Nope.position', [0], [0, 0, 0])]),
    template.scene, new Map())
  assert.equal(only.clip, null)
  assert.equal(only.dropped, 1)
})

test('A7: the model’s own lights and cameras are removed from the instance', async () => {
  const template = await parseModel()
  const instance = buildInstance(template)
  let lights = 0
  let cameras = 0
  instance.scene.traverse((object) => {
    if (object.isLight) lights += 1
    if (object.isCamera) cameras += 1
  })
  assert.equal(lights, 0, 'an imported light would light the world')
  assert.equal(cameras, 0, 'an imported camera must never become a world camera')
  assert.ok(instance.removedAttachments >= 2)

  const plain = await parseTemplate({ kind: 'glb', bytes: modelGlb({ parts: ['Only'] }) })
  assert.equal(buildInstance(plain.template).removedAttachments, 0, 'nothing to strip in a plain model')
})

test('Z6: the placeholder is an unnamed wireframe box on the node’s origin', async () => {
  const { wrapper, box } = buildPlaceholder([2, 4, 1])
  assert.ok(!wrapper.isGroup)
  assert.equal(box.isMesh, true)
  assert.equal(box.material.wireframe, true)
  assert.equal(box.position.y, 2, 'the base sits on the origin')
  assert.equal(box.name, '')

  const defaulted = buildPlaceholder()
  assert.deepEqual(defaulted.size, [1, 1, 1])
  assert.equal(PLACEHOLDER_COLOURS.loading, 0x6b7280)
  assert.equal(PLACEHOLDER_COLOURS.failed, 0xd97706)
})

test('Z6: a click on the placeholder resolves to its host', async () => {
  const { sceneGroup, nodes } = worldUnder()
  const { wrapper, box } = buildPlaceholder()
  nodes.get('Chair').add(wrapper)
  const walked = walkUpToSOMNode(box, lookup(nodes))
  assert.equal(walked.somNode, nodes.get('Chair'))
  assert.equal(sceneGroup.getObjectByName('Cube'), nodes.get('Cube'))
})

test('A9: disposing an instance removes its wrapper and leaves the template alone', async () => {
  const template = await parseModel()
  const { sceneGroup, nodes } = worldUnder()
  const instance = buildInstance(template)
  nodes.get('Chair').add(instance.wrapper)
  disposeInstance(instance)
  assert.equal(nodes.get('Chair').children.length, 0, 'the wrapper is gone from its host')
  assert.ok(template.scene.children.length > 0, 'the template is untouched')
  assert.ok(new Box3().setFromObject(template.scene).isEmpty() === false)
})
