// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// model-bridge.test.js — models-by-url step 6 (Z5, Z6, A6, A8, A9, A10).
//
// The bridge with stub views, a stub fetcher and a stub parser: no network, no
// DOM, no GLTFLoader. What is checked is the contract — where a wrapper ends
// up, when it is re-attached without a second fetch, what a world change
// drops, and the `no-host` outcome after ten frames.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Group, Object3D } from 'three'
import { createModelBridge, MODEL_STATUS, MODEL_INSTANCE_LIMIT, HOST_FRAME_LIMIT } from '../src/model-bridge.js'
import { validateModelHost } from '@atrium/client/model-spec'

/** A SOM node stand-in: identity, name, a glTF node object and model extras. */
function somNode(name, model = { url: 'https://h/m.glb' }, { mesh = null } = {}) {
  return { name, _node: { def: name }, mesh, extras: { atrium: { model } } }
}

function harness({ nextFrame = null, parseResult = null, fetchGate = null } = {}) {
  const state = { nodes: [], hosts: new Map(), sceneGroup: new Group(), fetches: 0, parses: 0, aborts: 0 }
  const statuses = []

  const som = () => ({
    allNodes: state.nodes,
    nodes: state.nodes,
    getNodeByName: (name) => state.nodes.find((n) => n.name === name) ?? null,
  })

  // The app's shape: `(node) => docView.listViews(node._node)`.
  const listViews = (node) => {
    const object = state.hosts.get(node.name)
    return object ? [object] : []
  }

  const bridge = createModelBridge({
    som,
    listViews,
    nextFrame: (fn) => { if (nextFrame) nextFrame(fn); else fn() },
    onStatus: (node, status) => statuses.push({ name: node.name, ...status }),
    hooks: {
      validateModelHost,
      fetchModel: async ({ url, signal }) => {
        state.fetches += 1
        if (fetchGate && !signal.aborted) await fetchGate
        if (signal?.aborted) {
          state.aborts += 1
          return { ok: false, reason: 'aborted', message: 'cancelled' }
        }
        return {
          ok: true, kind: 'glb', bytes: new Uint8Array([1]), json: null,
          dependencies: new Map(), effectiveUrl: url, totalBytes: 1,
        }
      },
      parseTemplate: async (args) => {
        state.parses += 1
        if (parseResult) return parseResult
        args?.reserveTexture?.(0)
        return { ok: true, template: { scene: new Group(), animations: [], textureBytes: 0 }, textureBytes: 0 }
      },
    },
  })
  bridge.attachView({}, state.sceneGroup)

  const objectFor = (name) => {
    const object = new Object3D()
    object.name = name
    state.sceneGroup.add(object)
    state.hosts.set(name, object)
    return object
  }

  return {
    state, statuses, bridge,
    /** Add a SOM node and its view host (or none, for the `no-host` case). */
    addNode(node, { withHost = true } = {}) {
      state.nodes.push(node)
      if (withHost) objectFor(node.name)
      bridge.reconcile()
      return node
    },
    removeNode(name) {
      const index = state.nodes.findIndex((n) => n.name === name)
      const node = state.nodes[index]
      state.nodes.splice(index, 1)
      state.hosts.get(name)?.removeFromParent()
      bridge.reconcile()
      return node
    },
    /** A rebuilt view: new sceneGroup, new hosts, the same SOM (A9). */
    rebuildView() {
      const previous = state.hosts
      const nextGroup = new Group()
      const nextHosts = new Map()
      for (const node of state.nodes) {
        const object = new Object3D()
        object.name = node.name
        nextGroup.add(object)
        nextHosts.set(node.name, object)
      }
      state.sceneGroup = nextGroup
      state.hosts = nextHosts
      return { group: nextGroup, previous }
    },
    /** What the app does on `world:loaded`: detach, then attach the new view. */
    attachView(view = null) {
      bridge.detachView()
      if (view) state.sceneGroup = view
      bridge.attachView({}, state.sceneGroup)
    },
    hostFor(name) { return state.hosts.get(name) ?? null },
    childrenOf(name) { return state.hosts.get(name)?.children ?? [] },
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

// V3 (round 2) — app.js created the bridge without `hooks.fetchModel` and the
// module fell back to a stub that always answered `network: "no fetcher was
// configured"`: every placed model stayed an amber placeholder, in every
// browser, while this suite passed (it injects its own fetcher in `harness`).
test('V3: a bridge with no hooks.fetchModel throws, and no default fetcher exists', () => {
  const deps = { som: () => null, listViews: () => [] }
  assert.throws(() => createModelBridge(deps), /fetchModel/, 'no hooks at all')
  assert.throws(() => createModelBridge({ ...deps, hooks: {} }), /fetchModel/, 'empty hooks')
  assert.throws(() => createModelBridge({ ...deps, hooks: { fetchModel: null } }), /fetchModel/, 'a null fetcher')
  assert.throws(() => createModelBridge({ ...deps, hooks: { parseTemplate: async () => ({ ok: true }) } }), /fetchModel/,
    'a parse hook is not a fetcher')
  const ok = createModelBridge({ ...deps, hooks: { fetchModel: async () => ({ ok: false, reason: 'x' }) } })
  assert.ok(ok, 'a bridge with a fetcher is built')
})

test('Z5: a model node gets a wrapper under its host, and a loaded status', async () => {
  const h = harness()
  h.addNode(somNode('Chair'))
  assert.equal(h.bridge.status('Chair').status, MODEL_STATUS.loading, 'loading while it fetches')
  await tick()
  assert.equal(h.bridge.status('Chair').status, MODEL_STATUS.loaded)
  const children = h.childrenOf('Chair')
  assert.equal(children.length, 1, 'one wrapper under the host')
  assert.equal(children[0].userData.atriumModel, true)
  assert.ok(!children[0].isGroup, 'the wrapper is a plain Object3D (P3)')
})

test('Z5: a node without a model spec gets nothing; a mesh-carrying model node is skipped (A6)', async () => {
  const h = harness()
  h.state.nodes.push({ name: 'Plain', _node: { def: 'Plain' }, extras: {} })
  h.addNode(somNode('WithMesh', { url: 'https://h/m.glb' }, { mesh: { primitives: [] } }))
  await tick()
  assert.equal(h.bridge.instanceCount, 0, 'neither is a model host')
})

test('Z5: DocumentView’s own wrapper is re-attached after a rebuild, with no second fetch', async () => {
  const h = harness()
  h.addNode(somNode('Chair'))
  await tick()
  assert.equal(h.state.fetches, 1)

  h.attachView()
  const { group } = h.rebuildView()
  h.attachView(group)

  assert.equal(h.state.fetches, 1, 'the cache is used: no new fetch')
  const children = h.childrenOf('Chair')
  assert.equal(children.length, 1, 'the wrapper is in the new view')
  assert.equal(children[0].parent, h.hostFor('Chair'))
})

test('A9: resetWorld aborts a request in flight and nothing is ever attached', async () => {
  let release = null
  const gate = new Promise((resolve) => { release = resolve })
  const h = harness({ fetchGate: gate })
  h.addNode(somNode('Chair'))
  await tick()
  assert.equal(h.bridge.status('Chair').status, MODEL_STATUS.loading)

  h.bridge.resetWorld()
  release()
  await tick()

  assert.equal(h.state.aborts, 1, 'the in-flight request was aborted, not left to finish')
  assert.equal(h.bridge.status('Chair'), null, 'the node is not in this world any more')
  assert.equal(h.bridge.instanceCount, 0, 'the instance and its template are gone')
  assert.equal(h.childrenOf('Chair').length, 0, 'nothing attached in the new world')
  assert.equal(h.bridge.cache.size, 0, 'the cache went with the world')
})

test('A9: a result that arrives after the node is gone is dropped', async () => {
  let release = null
  const gate = new Promise((resolve) => { release = resolve })
  const h = harness({ fetchGate: gate })
  const node = h.addNode(somNode('Chair'))
  await tick()
  h.state.nodes.length = 0          // the node left the SOM
  release()
  await tick()
  assert.equal(h.childrenOf('Chair').length, 0, 'nothing attaches for a node that is gone')
  assert.equal(node.name, 'Chair')
})

test('A9: no host after ten frames is failed/no-host, never stuck in loading', async () => {
  const queued = []
  const h = harness({ nextFrame: (fn) => queued.push(fn) })
  h.addNode(somNode('Chair'), { withHost: false })
  await tick()
  assert.equal(h.bridge.status('Chair').status, MODEL_STATUS.loaded, 'the model itself loaded')
  for (let i = 0; i < HOST_FRAME_LIMIT; i++) {
    const frame = queued.shift()
    assert.ok(frame, `frame ${i}`)
    frame()
  }
  queued.shift()?.()
  const status = h.bridge.status('Chair')
  assert.equal(status.status, MODEL_STATUS.failed)
  assert.equal(status.reason, 'no-host')
})

test('Z6: the placeholder is present while loading and gone once the model attaches', async () => {
  let release = null
  const gate = new Promise((resolve) => { release = resolve })
  const h = harness({ fetchGate: gate })
  h.addNode(somNode('Chair'))
  const wrapper = h.childrenOf('Chair')[0]
  assert.ok(wrapper, 'a placeholder is there before the bytes arrive')
  const box = wrapper.children[0]
  assert.equal(box.isMesh, true)
  assert.equal(box.material.wireframe, true)

  release()
  await tick()
  const after = h.childrenOf('Chair')[0]
  assert.notEqual(after, wrapper, 'the placeholder was replaced by the model')
  assert.equal(h.childrenOf('Chair').length, 1, 'and the placeholder did not linger')
})

test('Z6/L11: a failure shows the placeholder with its reason', async () => {
  const h = harness({ parseResult: { ok: false, reason: 'too-many-vertices', message: 'the model has too many vertices' } })
  h.addNode(somNode('Chair'))
  await tick()
  const status = h.bridge.status('Chair')
  assert.equal(status.status, MODEL_STATUS.failed)
  assert.equal(status.reason, 'too-many-vertices')
  const children = h.childrenOf('Chair')
  assert.equal(children.length, 1, 'one placeholder, not two')
  assert.equal(children[0].children[0].material.color.getHex(), 0xd97706, 'amber after a failure')
})

test('Z5/A8: removing a node removes its wrapper and idles its template', async () => {
  const h = harness()
  h.addNode(somNode('Chair'))
  await tick()
  assert.equal(h.bridge.cache.size, 1)
  h.removeNode('Chair')
  assert.equal(h.childrenOf('Chair').length, 0)
  assert.equal(h.bridge.cache.size, 1, 'the idle template is kept (A8)')
  assert.equal(h.bridge.cache.get(h.bridge.cache.keys()[0]).refs, 0)
})

test('Z5/A10: two nodes with one URL fetch twice and parse once', async () => {
  const h = harness()
  h.addNode(somNode('Chair'))
  h.addNode(somNode('Bench'))
  await tick()
  assert.equal(h.state.fetches, 2, 'each node asks for its URL')
  assert.equal(h.state.parses, 1, 'but the template is parsed once')
  assert.equal(h.bridge.cache.size, 1)
})

test('A10: the instance limit counts model nodes in allNodes order', () => {
  const h = harness()
  const total = MODEL_INSTANCE_LIMIT + 5
  for (let i = 0; i < total; i++) h.state.nodes.push(somNode(`Model${i}`))
  h.bridge.reconcile()
  assert.equal(h.bridge.instanceCount, MODEL_INSTANCE_LIMIT, 'the same nodes win on every screen')
  assert.ok(h.bridge.instances.has('Model0'), 'the first in document order is admitted')
  assert.ok(!h.bridge.instances.has(`Model${total - 1}`), 'the last is not')
})

test('Z5: every status change raises exactly one event', async () => {
  const h = harness()
  h.addNode(somNode('Chair'))
  await tick()
  assert.deepEqual(h.statuses.map((s) => s.status), [MODEL_STATUS.loading, MODEL_STATUS.loaded])
})

test('A9: a fetch that finishes after a view rebuild attaches only in the new view', async () => {
  let release = null
  const gate = new Promise((resolve) => { release = resolve })
  const h = harness({ fetchGate: gate })
  h.addNode(somNode('Chair'))
  await tick()                                    // the request is in flight
  assert.equal(h.bridge.status('Chair').status, MODEL_STATUS.loading)

  const before = h.hostFor('Chair')
  const { group } = h.rebuildView()               // an external ref's world:loaded
  h.attachView(group)

  release()
  await tick()

  assert.equal(h.state.fetches, 1, 'the same fetch was reused')
  assert.equal(h.childrenOf('Chair').length, 1, 'the wrapper is in the new view')
  assert.equal(h.childrenOf('Chair')[0].parent, h.hostFor('Chair'))
  assert.equal(before.children.length, 0, 'and never in the pre-rebuild view')
})

test('A9/A8: removing one of two instances keeps the other’s instance and template', async () => {
  const h = harness()
  h.addNode(somNode('Chair', { url: 'https://h/chair.glb' }))
  h.addNode(somNode('Bench', { url: 'https://h/bench.glb' }))
  await tick()
  assert.equal(h.bridge.cache.size, 2)

  h.removeNode('Chair')

  assert.equal(h.childrenOf('Chair').length, 0)
  assert.equal(h.childrenOf('Bench').length, 1, 'the other instance is still attached')
  assert.equal(h.bridge.cache.size, 2, 'both templates are still there')
  assert.ok([...h.bridge.cache.keys()].some((key) => key.startsWith('https://h/bench.glb')))
})
