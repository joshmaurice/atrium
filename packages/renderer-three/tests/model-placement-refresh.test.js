// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// model-placement-refresh.test.js — scripting-4a round 3, W1.
//
// DEV acceptance found that AFTER A PAGE RELOAD a duplicated or undo-restored
// rigged model gets a wrong selection outline and cannot be clicked. The bug
// predates 4a (it reproduces on the base) and only shows on a `SkinnedMesh`.
//
// The mechanism: `SkinnedMesh` caches `boundingBox`/`boundingSphere` the first
// time they are needed, computed from that moment's bone and bind matrices.
// `bindMatrixInverse` is refreshed only in `SkinnedMesh.updateMatrixWorld` —
// which the renderer calls each frame, but `Box3.expandByObject` (so
// `Box3.setFromObject`, and the `BoxHelper` outline) calls `updateWorldMatrix`
// instead, which does not. Duplicate and Undo select the new node at once, so
// the outline caches a box built from the TEMPLATE's stale matrices.
//
// These tests use the real three.js, a real `SkinnedMesh`, a real bridge, and
// NO render at all: everything the outline reads is checked exactly as it is
// right after the attach. A ray follows the box check, because "the outline is
// wrong" is only half of the report — the copy could not be clicked either.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  Bone, Box3, BoxGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial,
  Object3D, Raycaster, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3,
} from 'three'
import { createModelBridge, MODEL_STATUS } from '../src/model-bridge.js'
import { buildInstance } from '../src/model-instances.js'
import { validateModelHost } from '@atrium/client/model-spec'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * The skinned template: a Z-up file (its root turned a quarter turn, as an
 * exporter writes one), an armature, two bones and a `SkinnedMesh` bound to
 * them. The bones stay at their bind pose, so a correct refresh leaves the
 * skinned vertices exactly on the raw ones: the geometry's own shape is then
 * the right answer to compare against, and the mesh's own world position is the
 * model's true centre.
 *
 * `staticMesh` adds a mesh with no skeleton — (d)'s subject — and it is placed
 * clear of the ray (b) casts, so the two cases do not read each other.
 */
function skinnedTemplate({ staticMesh = false } = {}) {
  const root = new Object3D()
  root.name = 'Model'
  root.rotation.x = -Math.PI / 2

  const armature = new Object3D()
  armature.name = 'Armature'
  root.add(armature)

  const hip = new Bone()
  hip.name = 'Hip'
  hip.position.set(0, 0.5, 0)
  armature.add(hip)
  const chest = new Bone()
  chest.name = 'Chest'
  chest.position.set(0, 0.5, 0)
  hip.add(chest)

  const geometry = new BoxGeometry(1, 1, 1)
  const count = geometry.getAttribute('position').count
  const skinIndex = new Uint16Array(count * 4)
  const skinWeight = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    skinIndex[i * 4] = i % 2          // alternate the two bones
    skinWeight[i * 4] = 1             // one bone per vertex, as an exporter writes
  }
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(skinIndex, 4))
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(skinWeight, 4))

  const body = new SkinnedMesh(geometry, new MeshBasicMaterial())
  body.name = 'Body'
  body.position.set(0, 0.5, 0)
  armature.add(body)

  // A mesh with no skeleton: its bounds come from its geometry (d). It sits
  // clear of the model, so a ray through the body's centre never reaches it.
  let staticGeometry = null
  if (staticMesh) {
    staticGeometry = new BoxGeometry(3, 0.2, 3)
    staticGeometry.computeBoundingBox()
    const floor = new Mesh(staticGeometry, new MeshBasicMaterial())
    floor.name = 'Floor'
    floor.position.set(3, 0, 0)
    root.add(floor)
  }

  // Every template matrix current, so the template's own values are the
  // "correct" ones a stale clone would be measured against.
  root.updateMatrixWorld(true)
  body.bind(new Skeleton([hip, chest]))
  root.updateMatrixWorld(true)

  return { scene: root, animations: [], staticGeometry }
}

/** A box no model could have: the value a stale cache would hold. */
function wrongBox() {
  return new Box3(new Vector3(-99, -99, -99), new Vector3(-98, -98, -98))
}

function firstUnder(host, predicate) {
  let found = null
  host.traverse((object) => { if (!found && predicate(object)) found = object })
  return found
}

function assertBoxClose(actual, expected, tolerance, what) {
  for (const corner of ['min', 'max']) {
    for (let axis = 0; axis < 3; axis++) {
      const a = actual[corner].getComponent(axis)
      const b = expected[corner].getComponent(axis)
      assert.ok(Math.abs(a - b) <= tolerance,
        `${what}: ${corner}[${axis}] is ${a}, expected ${b} within ${tolerance}`)
    }
  }
}

/**
 * A bridge with stub views, a stub fetcher and a stub parser — the shape
 * model-bridge.test.js's harness uses — whose parsed template is the skinned
 * one above. `place()` puts a model node in the scene under a HOST TRANSLATED TO
 * (2, 0, −3) AND SCALED 0.5, the placement the round-3 revision names.
 */
function harness({ wrongBounds = false, staticMesh = false } = {}) {
  const template = skinnedTemplate({ staticMesh })
  const state = { nodes: [], hosts: new Map(), sceneGroup: new Group(), instance: null }

  const som = () => ({
    allNodes: state.nodes,
    nodes: state.nodes,
    getNodeByName: (name) => state.nodes.find((n) => n.name === name) ?? null,
  })
  const listViews = (node) => {
    const object = state.hosts.get(node.name)
    return object ? [object] : []
  }

  const bridge = createModelBridge({
    som,
    listViews,
    nextFrame: (fn) => fn(),
    hooks: {
      validateModelHost,
      fetchModel: async ({ url, signal }) => {
        if (signal?.aborted) return { ok: false, reason: 'aborted', message: 'cancelled' }
        return { ok: true, kind: 'glb', bytes: new Uint8Array([1]), json: null, dependencies: new Map(), effectiveUrl: url, totalBytes: 1 }
      },
      parseTemplate: async (args) => {
        args?.reserveTexture?.(0)
        return { ok: true, template: { scene: template.scene, animations: [] }, textureBytes: 0 }
      },
      // (c) — a wrong box on the instance BEFORE the bridge attaches it.
      buildInstance: (parsed, opts) => {
        const built = buildInstance(parsed, opts)
        state.instance = built
        if (wrongBounds) {
          built.scene.traverse((object) => { if (object.isSkinnedMesh) object.boundingBox = wrongBox() })
        }
        return built
      },
    },
  })
  bridge.attachView({}, state.sceneGroup)

  return {
    state, bridge, template,
    /** Add a model node and its host, then let the load finish. */
    async place(name = 'Chair') {
      const host = new Object3D()
      host.name = name
      host.position.set(2, 0, -3)
      host.scale.setScalar(0.5)
      state.sceneGroup.add(host)
      state.hosts.set(name, host)
      state.nodes.push({ name, _node: { def: name }, mesh: null, extras: { atrium: { model: { url: 'https://h/m.glb' } } } })
      bridge.reconcile()
      await tick()
      return host
    },
    /** A rebuilt view: a new sceneGroup and new hosts, the same SOM (A9). */
    rebuildView() {
      const nextGroup = new Group()
      state.hosts = new Map()
      for (const node of state.nodes) {
        const object = new Object3D()
        object.name = node.name
        nextGroup.add(object)
        state.hosts.set(node.name, object)
      }
      state.sceneGroup = nextGroup
      return nextGroup
    },
    hostFor(name) { return state.hosts.get(name) ?? null },
  }
}

/** The two boxes the outline could read: the cached-bounds one, and the true one. */
function boxesFor(host) {
  const byCachedBounds = new Box3().setFromObject(host)   // what BoxHelper does
  host.updateMatrixWorld(true)
  const precise = new Box3().setFromObject(host, true)    // the model's true box
  return { byCachedBounds, precise }
}

test('W1: the bridge attached the skinned instance under the passed host', async () => {
  const h = harness()
  const host = await h.place()
  assert.equal(h.bridge.status('Chair').status, MODEL_STATUS.loaded)
  assert.equal(host.children.length, 1, 'one wrapper under the host')
  const wrapper = host.children[0]
  assert.equal(wrapper.userData.atriumModel, true)
  const body = firstUnder(host, (o) => o.isSkinnedMesh)
  assert.ok(body, 'the instance carries the SkinnedMesh')
  assert.equal(body.boundingBox, null, 'and leaves no box cached')
})

test('W1 (a): the box the outline reads right after the attach is the model’s true box', async () => {
  const h = harness()
  const host = await h.place()
  const { byCachedBounds, precise } = boxesFor(host)
  assertBoxClose(byCachedBounds, precise, 1e-4, 'the placed instance’s box')
  // Sanity: the box is where the host puts the model (2, 0, −3 at half scale),
  // not in the template's own frame.
  const centre = precise.getCenter(new Vector3())
  assert.ok(Math.abs(centre.x - 2) < 0.01 && Math.abs(centre.z + 3.25) < 0.01,
    `the box is at the host’s placement, not the template’s (centre ${centre.toArray()})`)
  const size = precise.getSize(new Vector3())
  assert.ok(Math.abs(size.x - 0.5) < 0.01 && Math.abs(size.y - 0.5) < 0.01,
    `and it is the model’s own size, halved by the host (${size.toArray()})`)
})

test('W1 (b): with no render, a ray through the model’s true centre hits it', async () => {
  const h = harness()
  const host = await h.place()
  const body = firstUnder(host, (o) => o.isSkinnedMesh)
  // The outline measures the object first — `BoxHelper` calls `setFromObject`
  // from its `update()` — and THAT measurement is what a click is tested
  // against. It refreshes no `bindMatrixInverse` (it walks with
  // `updateWorldMatrix`), which is the whole of this bug.
  new Box3().setFromObject(host)
  // The model's true centre, from the mesh's OWN world matrix — read with
  // `updateWorldMatrix`, never `updateMatrixWorld`, which would refresh
  // `bindMatrixInverse` and hide exactly what this test is about.
  body.updateWorldMatrix(true, false)
  const centre = new Vector3().setFromMatrixPosition(body.matrixWorld)
  assert.ok(Math.abs(centre.x - 2) < 0.01 && Math.abs(centre.z + 3.25) < 0.01,
    `the mesh is where the host puts it (${centre.toArray()})`)

  const raycaster = new Raycaster()
  raycaster.set(centre.clone().add(new Vector3(0, 0, 2)), new Vector3(0, 0, -1))
  const hits = raycaster.intersectObject(host, true)
  assert.ok(hits.length > 0, 'a click on the copy finds the copy')
  assert.ok(hits.some((hit) => hit.object === body), 'and it is the model the ray finds, not a box around it')
})

test('W1 (c): a boundingBox set BEFORE the attach is recomputed correctly after it', async () => {
  const h = harness({ wrongBounds: true })
  const host = await h.place()
  const body = firstUnder(host, (o) => o.isSkinnedMesh)
  assert.equal(body.boundingBox, null, 'the wrong box is dropped, not kept')
  const { byCachedBounds, precise } = boxesFor(host)
  assertBoxClose(byCachedBounds, precise, 1e-4, 'the box recomputed after the attach')
})

test('W1 (d): a mesh without a skeleton keeps its geometry’s own bounds', async () => {
  const h = harness({ staticMesh: true })
  const host = await h.place()
  const floor = firstUnder(host, (o) => o.isMesh && !o.isSkinnedMesh)
  assert.ok(floor, 'the instance carries the static mesh')
  assert.equal(floor.boundingBox, undefined, 'a plain mesh gains no cached box')
  assert.equal(floor.geometry, h.template.staticGeometry, 'the clone shares the geometry')
  assert.ok(floor.geometry.boundingBox, 'and its geometry keeps its own box')
  assertBoxClose(floor.geometry.boundingBox,
    new Box3(new Vector3(-1.5, -0.1, -1.5), new Vector3(1.5, 0.1, 1.5)), 1e-6,
    'the static geometry’s own box')
})

test('W1 (e): the re-host path (detachView / attachView) gives the same result', async () => {
  const h = harness()
  await h.place()
  h.bridge.detachView()
  const group = h.rebuildView()
  h.bridge.attachView({}, group)

  const host = h.hostFor('Chair')
  assert.equal(host.children.length, 1, 'the same instance is re-hosted, not rebuilt')
  const body = firstUnder(host, (o) => o.isSkinnedMesh)
  assert.equal(body.boundingBox, null, 'the re-host drops the box again')
  const { byCachedBounds, precise } = boxesFor(host)
  assertBoxClose(byCachedBounds, precise, 1e-4, 'the re-hosted instance’s box')
})
