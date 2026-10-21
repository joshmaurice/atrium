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
import { Group, Object3D, BoxGeometry, MeshBasicMaterial } from 'three'
import { createModelBridge, MODEL_STATUS, MODEL_INSTANCE_LIMIT, HOST_FRAME_LIMIT, specTemplateKey } from '../src/model-bridge.js'
import { disposeInstance } from '../src/model-instances.js'
import { parseTemplate, createTextureBudget, estimateTextureBytes, parseReasonText, MODEL_PARSE_LIMITS } from '../src/model-parse.js'
import { createJobDeadline, fetchModel, createWorldLedger, createSharedTasks, createTransferLimiter, MODEL_LIMITS } from '@atrium/client/model-fetch'
import { imageGlb, multiImageGlb } from './glb-fixture.js'
import { validateModelHost } from '@atrium/client/model-spec'

/** A SOM node stand-in: identity, name, a glTF node object and model extras. */
function somNode(name, model = { url: 'https://h/m.glb' }, { mesh = null } = {}) {
  return { name, _node: { def: name }, mesh, extras: { atrium: { model } } }
}

function harness({ nextFrame = null, parseResult = null, fetchGate = null, textureBudget = null, modelBytes = null, parseLoader = null, disposeTemplate = null, redirectTo = null, fetchModel = null, newDeadline = null, parseHook = null, ledger = null, limiter = null, sharedTransfers = null } = {}) {
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
      fetchModel: fetchModel ?? (async ({ url, signal }) => {
        state.fetches += 1
        if (fetchGate && !signal.aborted) await fetchGate
        if (signal?.aborted) {
          state.aborts += 1
          return { ok: false, reason: 'aborted', message: 'cancelled' }
        }
        return {
          ok: true, kind: 'glb', bytes: modelBytes ?? new Uint8Array([1]), json: null,
          dependencies: new Map(), effectiveUrl: redirectTo ? redirectTo(url) : url, totalBytes: 1,
        }
      }),
      parseTemplate: parseHook ?? (async (args) => {
        state.parses += 1
        if (parseResult) return parseResult
        // `parseLoader` runs the REAL parseTemplate (and so the real preflight)
        // with a loader stand-in: no image decoding, no GLTFLoader (W1, round 3).
        if (parseLoader) return parseTemplate({ ...args, loader: parseLoader })
        args?.reserveTexture?.(0)
        return { ok: true, template: { scene: new Group(), animations: [], textureBytes: 0 }, textureBytes: 0 }
      }),
      ...(textureBudget ? { textureBudget } : {}),
      ...(newDeadline ? { newDeadline } : {}),
      ...(disposeTemplate ? { disposeTemplate } : {}),
      ...(ledger ? { ledger } : {}),
      ...(limiter ? { limiter } : {}),
      ...(sharedTransfers ? { sharedTransfers } : {}),
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

test('Z5/A6/S7: a node with no model gets nothing; a node the spec rejects shows bad-spec', async () => {
  const h = harness()
  h.state.nodes.push({ name: 'Plain', _node: { def: 'Plain' }, extras: {} })
  h.addNode(somNode('WithMesh', { url: 'https://h/m.glb' }, { mesh: { primitives: [] } }))
  await tick()
  assert.equal(h.bridge.status('Plain'), null, 'a node with no model is not a model host')
  // S7 (round 6) — A6's mesh rule is a spec rejection: until this round the node
  // was skipped exactly like `Plain`, and the owner saw nothing at all.
  const rejected = h.bridge.status('WithMesh')
  assert.equal(rejected.status, MODEL_STATUS.failed)
  assert.equal(rejected.reason, 'bad-spec')
  assert.equal(h.state.fetches, 0, 'nothing was fetched')
  assert.equal(h.childrenOf('WithMesh').length, 1, 'and the failed placeholder is in the scene')
  assert.equal(h.bridge.instanceCount, 1, 'only the rejected node has a record')
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

test('Z5/A10: two nodes with one URL added together fetch once and parse once (V4)', async () => {
  const h = harness()
  h.addNode(somNode('Chair'))
  h.addNode(somNode('Bench'))
  await tick()
  assert.equal(h.state.fetches, 1, 'one URL, one download — the second node awaits the in-flight load (V4)')
  assert.equal(h.state.parses, 1, 'but the template is parsed once')
  assert.equal(h.bridge.cache.size, 1)
})

// ── V4 (round 2): look up before fetching ───────────────────────────────────
//
// Round 1 called `fetchModel` first and consulted the template cache only
// afterwards, keyed on the fetched `effectiveUrl`. In a browser (V3 fixed) one
// model was downloaded again by every Duplicate, every Redo and every Save
// after a Check — each repeat charged to the world's ledger, which never
// refunds. These are the counting-stub tests from the revision's V4 list.

test('V4/A8: deleting the only instance and adding it again fetches nothing', async () => {
  const h = harness()
  h.addNode(somNode('Chair'))
  await tick()
  assert.equal(h.state.fetches, 1)
  h.removeNode('Chair')
  assert.equal(h.bridge.cache.size, 1, 'the idle template is kept (A8)')

  h.addNode(somNode('Chair'))                 // Redo
  await tick()
  assert.equal(h.state.fetches, 1, 'the cache answered: no second download')
  assert.equal(h.bridge.status('Chair').status, MODEL_STATUS.loaded)
  assert.equal(h.childrenOf('Chair').length, 1)
})

test('V4/A4: Duplicate — a second node with the same URL after the first loaded — fetches nothing', async () => {
  const h = harness()
  h.addNode(somNode('Chair'))
  await tick()
  assert.equal(h.state.fetches, 1)

  h.addNode(somNode('Chair copy'))            // the same spec, a second node
  await tick()
  assert.equal(h.state.fetches, 1, 'one URL, one download (A4)')
  assert.equal(h.state.parses, 1, 'and one parse')
  assert.equal(h.bridge.status('Chair copy').status, MODEL_STATUS.loaded)
})

test('V4/A8: a held Check’s template — seeded under the bridge’s own key — is used with no fetch', async () => {
  const h = harness()
  // What app.js's Check does: it downloads once itself and holds the parsed
  // template under `specTemplateKey(spec, worldBaseUrl)` — the key the bridge
  // looks up. Save then adds the node, and that node must not download again.
  const spec = { url: 'https://h/chair.glb', sha256: null }
  h.bridge.cache.set(specTemplateKey(spec, null), {
    scene: new Group(), animations: [], textureBytes: 0,
  })

  h.addNode(somNode('Chair', { url: 'https://h/chair.glb' }))
  await tick()
  assert.equal(h.state.fetches, 0, 'the held template answered: no download')
  assert.equal(h.bridge.status('Chair').status, MODEL_STATUS.loaded)
  assert.equal(h.childrenOf('Chair').length, 1)
})

test('V4/Z3: a pinned and an unpinned spec of one URL are two keys, so two fetches', async () => {
  const h = harness()
  h.addNode(somNode('Chair', { url: 'https://h/m.glb' }))
  h.addNode(somNode('ChairPinned', { url: 'https://h/m.glb', sha256: 'a'.repeat(64) }))
  await tick()
  assert.equal(h.state.fetches, 2, 'the pinned bytes were never downloaded here')
  assert.equal(h.bridge.cache.size, 2)
  assert.equal(h.bridge.status('ChairPinned').status, MODEL_STATUS.loaded)

  // The pinned node's twin, however, is the same key: no third download.
  h.addNode(somNode('ChairPinned copy', { url: 'https://h/m.glb', sha256: 'a'.repeat(64) }))
  await tick()
  assert.equal(h.state.fetches, 2)
})

test('V4/A9: after resetWorld the same URL is fetched again', async () => {
  const h = harness()
  h.addNode(somNode('Chair'))
  await tick()
  assert.equal(h.state.fetches, 1)

  h.bridge.resetWorld()
  assert.equal(h.bridge.cache.size, 0, 'the cache went with the world')
  h.bridge.reconcile()
  await tick()
  assert.equal(h.state.fetches, 2, 'the new world downloads it again')
  assert.equal(h.bridge.status('Chair').status, MODEL_STATUS.loaded)
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

// ── W1 (round 3): the world texture budget, at bridge level ─────────────────
//
// Round 2's `preflightFor` hid the preflight's byte count under `problem`, so
// `parseTemplate` reserved nothing and this budget was never charged: five
// textured 2048² models in one world stayed at `taken === 0`. Here the bridge
// runs the REAL `parseTemplate` (with a loader stand-in, no image decoding)
// against a counting budget, three times over.

/** A loader stand-in: no image decoding, no GLTFLoader (P5). */
const hostlessLoader = { parseAsync: async () => ({ scene: new Group(), animations: [] }) }

/** Let the fetch → parse → admit chain run to the end (microtasks only). */
async function settle() {
  for (let i = 0; i < 8; i++) await tick()
}

test('W1/A5/A10: the budget is charged once per template, and refuses the model that no longer fits', async () => {
  const per = estimateTextureBytes(2048, 2048)
  const budget = createTextureBudget({ bytes: per * 2 })
  const h = harness({
    textureBudget: budget,
    modelBytes: imageGlb({ width: 2048, height: 2048 }),
    parseLoader: hostlessLoader,
  })

  // The same URL placed twice: one download, one parse, ONE reservation.
  h.addNode(somNode('Twin A', { url: 'https://h/twin.glb' }))
  h.addNode(somNode('Twin B', { url: 'https://h/twin.glb' }))
  await settle()
  assert.equal(h.state.parses, 1, 'one parse for one URL')
  assert.equal(budget.taken, per, 'and one reservation for it')
  assert.equal(h.bridge.status('Twin A').status, MODEL_STATUS.loaded)

  // A second distinct model fits the budget sized for two.
  h.addNode(somNode('Second', { url: 'https://h/second.glb' }))
  await settle()
  assert.equal(h.bridge.status('Second').status, MODEL_STATUS.loaded)
  assert.equal(budget.taken, per * 2, 'two models, two reservations')

  // A third distinct model does not fit, and reserves nothing.
  h.addNode(somNode('Third', { url: 'https://h/third.glb' }))
  await settle()
  const status = h.bridge.status('Third')
  assert.equal(status.status, MODEL_STATUS.failed)
  assert.equal(status.reason, 'world-texture-budget')
  assert.equal(budget.taken, per * 2, 'a refused model leaves the budget untouched')

  // The two that fit are still charged, and still attached.
  assert.equal(h.childrenOf('Twin A').length, 1)
  assert.equal(h.childrenOf('Second').length, 1)
})

// ── W3 (round 4): the race, and the redirect alias ──────────────────────────
//
// Round 3's `templateFor` created an entry IDLE (`refs: 0`) inside the serialized
// parse and the load acquired it a microtask later, so the next model's
// `reserveTexture` → `evictIdleFor` could evict and dispose a template that was
// about to be — or already was — on screen; three.js re-uploads a disposed
// texture, so the GPU held ~320 MiB while the books said 234.7. A redirect's key
// was stored as a SECOND entry with the same `textureBytes`, so evicting both
// released the bytes twice and disposed one template twice.
//
// No image decoding (the loader stand-in), a counting budget, and a dispose
// recorder: what is checked is the bookkeeping.

/** A budget that records the highest `taken` it ever showed. */
function watchedBudget(inner) {
  const watch = { maxTaken: 0 }
  return {
    watch,
    budget: {
      get limit() { return inner.limit },
      get taken() { return inner.taken },
      get free() { return inner.free },
      fits: (n) => inner.fits(n),
      reserve: (n) => { const ok = inner.reserve(n); watch.maxTaken = Math.max(watch.maxTaken, inner.taken); return ok },
      release: (n) => { inner.release(n) },
      reset: () => inner.reset(),
    },
  }
}

/** A bridge whose fetches all carry one 2048² texture, with `textures` of room. */
function texturedHarness({ textures = 3, redirectTo = null } = {}) {
  const per = estimateTextureBytes(2048, 2048)
  const { budget, watch } = watchedBudget(createTextureBudget({ bytes: per * textures }))
  const disposed = []
  const h = harness({
    textureBudget: budget,
    modelBytes: imageGlb({ width: 2048, height: 2048 }),
    parseLoader: hostlessLoader,
    disposeTemplate: (template) => disposed.push(template),
    redirectTo,
  })
  return { h, budget, watch, disposed, per }
}

/** The W3 assertions: three charged, the fourth refused, nothing in use evicted. */
function assertThreeFitAndTheFourthIsRefused({ h, budget, watch, disposed, per }) {
  assert.equal(budget.taken, per * 3, 'three textured models are charged')
  assert.ok(watch.maxTaken <= budget.limit, '`taken` never exceeded the limit')
  assert.equal(watch.maxTaken, per * 3)
  assert.deepEqual(disposed, [], 'no entry with refs > 0 was ever disposed')
  for (const name of ['M1', 'M2', 'M3']) {
    assert.equal(h.bridge.status(name).status, MODEL_STATUS.loaded, `${name} loaded`)
    assert.equal(h.childrenOf(name).length, 1, `${name} is attached`)
  }
  const refused = h.bridge.status('M4')
  assert.equal(refused.status, MODEL_STATUS.failed)
  assert.equal(refused.reason, 'world-texture-budget', 'the fourth is refused the budget reason')
}

test('W3/A5: four distinct models requested back to back — the fourth is refused', async () => {
  const harnessed = texturedHarness({ textures: 3 })
  for (const name of ['M1', 'M2', 'M3', 'M4']) harnessed.h.addNode(somNode(name, { url: `https://h/${name}.glb` }))
  await settle()
  assertThreeFitAndTheFourthIsRefused(harnessed)
})

test('W3/A5: the fourth requested before the third continued past its parse — the same', async () => {
  const harnessed = texturedHarness({ textures: 3 })
  for (const name of ['M1', 'M2', 'M3']) harnessed.h.addNode(somNode(name, { url: `https://h/${name}.glb` }))
  await tick()   // the three parses are queued; no load has been handed its entry yet
  harnessed.h.addNode(somNode('M4', { url: 'https://h/M4.glb' }))   // the race
  await settle()
  assertThreeFitAndTheFourthIsRefused(harnessed)
})

test('W3: a redirect’s key is an alias of one entry — counted, evicted and disposed once', async () => {
  const { h, budget, disposed, per } = texturedHarness({ textures: 1, redirectTo: () => 'https://h/effective.glb' })
  h.addNode(somNode('M1', { url: 'https://h/alias.glb' }))
  await settle()

  const keys = h.bridge.cache.keys()
  assert.equal(h.bridge.cache.size, 1, 'one entry, however many keys it answers to')
  assert.equal(keys.length, 2, 'the spec URL’s key and the effective URL’s')
  assert.equal(h.bridge.cache.get(keys[0]), h.bridge.cache.get(keys[1]), 'both keys are the same entry')
  assert.equal(budget.taken, per, 'its bytes are counted once')

  h.removeNode('M1')                                             // the template goes idle
  const evicted = h.bridge.cache.evictIdleFor(per, budget, (template) => disposed.push(template))
  assert.equal(evicted.length, 1, 'one entry went')
  assert.equal(disposed.length, 1, 'and its template was disposed once')
  assert.equal(budget.taken, 0, 'and its bytes were released once')
  assert.equal(h.bridge.cache.size, 0)
})

// ── W4 (round 4): the form's Check, through the bridge ──────────────────────
//
// The owner's Check fetched and parsed on its own, outside the budget and
// outside the serialized parse, and seeded the cache with an entry that was
// never charged — `textureBudget.taken` stayed at 0.0 MiB through every
// Check-then-Save. These drive `loadTemplate` exactly as `app.js`'s Check does:
// load, hold, and give the reference back on Cancel or when the form closes.

test('W4/A5: a Check reserves the model’s estimate and holds the entry', async () => {
  const { h, budget, per } = texturedHarness({ textures: 3 })
  const loaded = await h.bridge.loadTemplate({ url: 'https://h/checked.glb' })
  assert.equal(loaded.ok, true, loaded.message)
  assert.equal(h.state.fetches, 1, 'the Check fetched it once')
  assert.equal(budget.taken, per, 'and charged the world’s budget')
  assert.equal(loaded.entry.refs, 1, 'and holds its reference')
  assert.equal(loaded.entry.idle, false)
  assert.equal(loaded.entry.textureBytes, per, 'the entry carries the measured bytes')
})

test('W4/A8: Check then Cancel leaves the template idle and still counted', async () => {
  const { h, budget, per } = texturedHarness({ textures: 3 })
  const loaded = await h.bridge.loadTemplate({ url: 'https://h/checked.glb' })
  h.bridge.releaseTemplate(loaded.key)                       // Cancel, a URL edit, a world change

  const entry = h.bridge.cache.get(loaded.key)
  assert.equal(entry.refs, 0, 'nothing holds it now')
  assert.equal(entry.idle, true)
  assert.equal(budget.taken, per, 'its bytes are still charged (A8: kept, not disposed, not refunded)')
  assert.equal(h.bridge.cache.size, 1)
})

test('W4/V4: Check then Save counts the template once, with no second download', async () => {
  const { h, budget, per } = texturedHarness({ textures: 3 })
  const loaded = await h.bridge.loadTemplate({ url: 'https://h/checked.glb' })
  assert.equal(budget.taken, per)

  h.addNode(somNode('Checked', { url: 'https://h/checked.glb' }))    // Save
  await settle()
  assert.equal(h.state.fetches, 1, 'the held template answered: Save downloaded nothing (V4)')
  assert.equal(h.state.parses, 1, 'and parsed nothing again')
  assert.equal(budget.taken, per, 'counted once, not twice')
  assert.equal(h.bridge.status('Checked').status, MODEL_STATUS.loaded)
  assert.equal(h.childrenOf('Checked').length, 1)

  h.bridge.releaseTemplate(loaded.key)                       // the form closes with the node saved
  assert.equal(budget.taken, per, 'the instance still holds it')
  assert.equal(h.bridge.cache.get(loaded.key).refs, 1)
})

test('W4/A5: a Check that does not fit is refused, and nothing is held', async () => {
  const { h, budget } = texturedHarness({ textures: 1 })
  h.addNode(somNode('M1', { url: 'https://h/M1.glb' }))      // one model fills the world
  await settle()
  const before = budget.taken
  assert.equal(before, budget.limit, 'the world is full')

  const loaded = await h.bridge.loadTemplate({ url: 'https://h/too-big.glb' })
  assert.equal(loaded.ok, false)
  assert.equal(loaded.reason, 'world-texture-budget')
  assert.equal(loaded.message, parseReasonText('world-texture-budget'), 'the form shows the plain text')
  assert.equal(budget.taken, before, 'nothing was reserved')
  assert.equal(h.bridge.cache.size, 1, 'and nothing was held')
})

// ── W5 (round 5): admission is `som.allNodes` order, not download order ─────
//
// A10: texture-budget admission happens in `som.allNodes` order — "a model is
// admitted only once every earlier model has been admitted or has failed
// (bounded by their own 30 s timeouts). So the same models win on every
// visitor's screen." Round 4 admitted in the order the downloads finished, so
// on a visitor's page (every model loading at once) the model refused was the
// one whose download lost the race, not the last in document order. These tests
// drive a fetch whose responses complete only when the test says so, the W1/W3
// loader stand-in (no image decoding) and a counting budget sized for three.

const W5_2K = imageGlb({ width: 2048, height: 2048 })
const W5_1K = imageGlb({ width: 1024, height: 1024 })
const PER_2K = estimateTextureBytes(2048, 2048)
const PER_1K = estimateTextureBytes(1024, 1024)
const modelUrl = (name) => `https://h/${name}.glb`

/**
 * A fetch whose every response waits for the test: `release(url)` lets that one
 * download finish. `fail` names the URLs that answer with a network failure.
 */
function orderedFetch({ bytesFor = () => W5_2K, fail = new Set() } = {}) {
  const gates = new Map()
  const calls = []
  const fetchModel = ({ url, signal }) => {
    calls.push(url)
    if (!gates.has(url)) {
      let open
      gates.set(url, { promise: new Promise((resolve) => { open = resolve }), release: () => open() })
    }
    return gates.get(url).promise.then(() => {
      if (signal?.aborted) return { ok: false, reason: 'aborted', message: 'cancelled' }
      if (fail.has(url)) return { ok: false, reason: 'network', message: 'the download failed' }
      const bytes = bytesFor(url)
      return { ok: true, kind: 'glb', bytes, json: null, dependencies: new Map(), effectiveUrl: url, totalBytes: bytes.length }
    })
  }
  return {
    fetchModel, calls,
    release(...urls) { for (const url of urls) gates.get(url)?.release() },
  }
}

/** A budget that records the order its successful reservations were taken in. */
function loggingBudget(inner, log) {
  return {
    get limit() { return inner.limit },
    get taken() { return inner.taken },
    get free() { return inner.free },
    fits: (n) => inner.fits(n),
    reserve: (n) => { const ok = inner.reserve(n); if (ok) log.push(n); return ok },
    release: (n) => inner.release(n),
    reset: () => inner.reset(),
  }
}

/** Let the fetch → parse → admit chain run until nothing is still loading. */
async function drain(h, ticks = 60) {
  for (let i = 0; i < ticks; i++) {
    if (![...h.bridge.instances.values()].some((r) => r.status === MODEL_STATUS.loading)) return
    await tick()
  }
}

test('W5/A10: downloads finish D, C, B, A — A, B and C are admitted and D is refused', async () => {
  const fetch = orderedFetch()
  const budget = createTextureBudget({ bytes: PER_2K * 3 })
  const h = harness({ textureBudget: budget, parseLoader: hostlessLoader, fetchModel: fetch.fetchModel })
  for (const name of ['A', 'B', 'C', 'D']) h.addNode(somNode(name, { url: modelUrl(name) }))
  assert.equal(fetch.calls.length, 4, 'all four transfers start together (A4)')

  fetch.release(modelUrl('D'), modelUrl('C'), modelUrl('B'), modelUrl('A'))   // reverse order
  await drain(h)

  for (const name of ['A', 'B', 'C']) {
    assert.equal(h.bridge.status(name).status, MODEL_STATUS.loaded, `${name} is admitted`)
  }
  const refused = h.bridge.status('D')
  assert.equal(refused.status, MODEL_STATUS.failed)
  assert.equal(refused.reason, 'world-texture-budget', 'D, the LAST in document order, is the one refused')
  assert.equal(budget.taken, PER_2K * 3, 'three reservations, in document order')
})

test('W5/A10: downloads finish A, B, C, D — the same three are admitted and D is refused', async () => {
  const fetch = orderedFetch()
  const budget = createTextureBudget({ bytes: PER_2K * 3 })
  const h = harness({ textureBudget: budget, parseLoader: hostlessLoader, fetchModel: fetch.fetchModel })
  for (const name of ['A', 'B', 'C', 'D']) h.addNode(somNode(name, { url: modelUrl(name) }))

  fetch.release(modelUrl('A'), modelUrl('B'), modelUrl('C'), modelUrl('D'))
  await drain(h)

  for (const name of ['A', 'B', 'C']) assert.equal(h.bridge.status(name).status, MODEL_STATUS.loaded, `${name} is admitted`)
  const refused = h.bridge.status('D')
  assert.equal(refused.status, MODEL_STATUS.failed)
  assert.equal(refused.reason, 'world-texture-budget', 'the same model wins on every page')
  assert.equal(budget.taken, PER_2K * 3)
})

test('W5: a failed download does not hold up the models behind it — A, C and D are admitted', async () => {
  const fetch = orderedFetch({ fail: new Set([modelUrl('B')]) })
  const budget = createTextureBudget({ bytes: PER_2K * 3 })
  const h = harness({ textureBudget: budget, parseLoader: hostlessLoader, fetchModel: fetch.fetchModel })
  for (const name of ['A', 'B', 'C', 'D']) h.addNode(somNode(name, { url: modelUrl(name) }))

  fetch.release(modelUrl('D'), modelUrl('C'), modelUrl('B'), modelUrl('A'))
  await drain(h)

  assert.equal(h.bridge.status('B').status, MODEL_STATUS.failed, 'B failed, and reserved nothing')
  for (const name of ['A', 'C', 'D']) assert.equal(h.bridge.status(name).status, MODEL_STATUS.loaded, `${name} is admitted`)
  assert.equal(budget.taken, PER_2K * 3, 'the three that fit are charged')
})

test('W5: removing a node releases whatever waits on it — C does not wait on B', async () => {
  const fetch = orderedFetch()
  const budget = createTextureBudget({ bytes: PER_2K * 3 })
  const h = harness({ textureBudget: budget, parseLoader: hostlessLoader, fetchModel: fetch.fetchModel })
  for (const name of ['A', 'B', 'C']) h.addNode(somNode(name, { url: modelUrl(name) }))

  fetch.release(modelUrl('C'))                  // C's bytes are here; its turn is not
  await settle()
  assert.equal(h.bridge.status('C').status, MODEL_STATUS.loading, 'C waits: A and B are ahead of it')

  h.removeNode('B')                             // B never downloads; it leaves the world
  await settle()
  assert.equal(h.bridge.status('C').status, MODEL_STATUS.loading, 'C still waits on A alone')

  fetch.release(modelUrl('A'))
  await drain(h)
  assert.equal(h.bridge.status('A').status, MODEL_STATUS.loaded)
  assert.equal(h.bridge.status('C').status, MODEL_STATUS.loaded, 'C was released by A, not held by B')
  assert.equal(h.bridge.status('B'), null, 'B is not in this world any more')
  assert.equal(budget.taken, PER_2K * 2)
})

test('W5: a fetch that throws settles its node, so the models behind it still get their turn', async () => {
  const fetch = orderedFetch()
  const throwing = ({ url, signal }) => (url.endsWith('/B.glb')
    ? Promise.resolve().then(() => { throw new Error('the socket died') })
    : fetch.fetchModel({ url, signal }))
  const budget = createTextureBudget({ bytes: PER_2K * 3 })
  const h = harness({ textureBudget: budget, parseLoader: hostlessLoader, fetchModel: throwing })
  for (const name of ['A', 'B', 'C']) h.addNode(somNode(name, { url: modelUrl(name) }))

  fetch.release(modelUrl('C'))                  // C's bytes are here; its turn is not
  await settle()
  assert.equal(h.bridge.status('C').status, MODEL_STATUS.loading, 'C waits its turn')

  fetch.release(modelUrl('A'))
  await drain(h)
  assert.equal(h.bridge.status('A').status, MODEL_STATUS.loaded)
  assert.equal(h.bridge.status('B').status, MODEL_STATUS.failed, 'B’s thrown fetch is a status, not a hang')
  assert.equal(h.bridge.status('C').status, MODEL_STATUS.loaded, 'C is admitted once A is done')
  assert.equal(budget.taken, PER_2K * 2)
})

test('W5: a model added live after the world loaded waits for the earlier ones', async () => {
  const fetch = orderedFetch()
  const budget = createTextureBudget({ bytes: PER_2K * 3 })
  const h = harness({ textureBudget: budget, parseLoader: hostlessLoader, fetchModel: fetch.fetchModel })
  h.addNode(somNode('A', { url: modelUrl('A') }))
  h.addNode(somNode('B', { url: modelUrl('B') }))
  await settle()

  h.addNode(somNode('C', { url: modelUrl('C') }))    // added live: after every existing node
  await settle()
  fetch.release(modelUrl('C'))                       // C's download wins the race
  await settle()
  assert.equal(h.bridge.status('C').status, MODEL_STATUS.loading, 'C waits for A and B')

  fetch.release(modelUrl('B'), modelUrl('A'))
  await drain(h)

  const loaded = h.statuses.filter((s) => s.status === MODEL_STATUS.loaded).map((s) => s.name)
  assert.deepEqual(loaded, ['A', 'B', 'C'], 'admission followed document order, not download order')
})

test('W5: a Check issued while nodes are loading reserves after them', async () => {
  const reserves = []
  const fetch = orderedFetch({ bytesFor: (url) => (url.endsWith('/check.glb') ? W5_1K : W5_2K) })
  const budget = loggingBudget(createTextureBudget({ bytes: PER_2K * 3 }), reserves)
  const h = harness({ textureBudget: budget, parseLoader: hostlessLoader, fetchModel: fetch.fetchModel })

  h.addNode(somNode('A', { url: modelUrl('A') }))
  h.addNode(somNode('B', { url: modelUrl('B') }))
  const checked = h.bridge.loadTemplate({ url: 'https://h/check.glb' })   // the form's Check
  fetch.release('https://h/check.glb')                                    // its download wins the race
  await settle()
  assert.deepEqual(reserves, [], 'the Check reserves nothing while A and B are loading')

  fetch.release(modelUrl('B'), modelUrl('A'))
  const got = await checked
  assert.equal(got.ok, true, got.message)
  assert.deepEqual(reserves, [PER_2K, PER_2K, PER_1K], 'A, then B, then the Check — in that order')
  assert.equal(got.entry.refs, 1, 'the Check holds what it reserved')
  assert.equal(budget.taken, PER_2K * 2 + PER_1K)
  h.bridge.releaseTemplate(got.key)
})

// ── W6 (round 5): the world texture budget is 512 MiB (decision L20) ────────
//
// Round 4's bookkeeping was right; the size was the operator's decision. The
// test reads the constant rather than a literal, so the limit moves with it —
// and a revert to 256 MiB fails here (only two such models would fit).
//
// The revision's scale line ("about six typical 2048-px PBR models, four 2k
// textures each") is a hair optimistic: `estimateTextureBytes` takes the
// ceiling per texture, so a four-2k-texture model is 85.33 MiB and six are
// 16 bytes over 512 MiB. Five fit whole; the sixth is refused. The boundary is
// asserted exactly, not rounded away.

test('W6/L20: the world budget reads the constant at 512 MiB — five 85.3 MiB models fit and the sixth is refused', async () => {
  const perModel = 4 * estimateTextureBytes(2048, 2048)
  const h = harness({ parseLoader: hostlessLoader, modelBytes: multiImageGlb({ count: 4 }) })

  assert.equal(h.bridge.textureBudget.limit, MODEL_PARSE_LIMITS.worldTextureBytes, 'the bridge budget is the constant')
  assert.equal(MODEL_PARSE_LIMITS.worldTextureBytes, 512 * 1024 * 1024, 'decision L20: 512 MiB, not 256')
  assert.equal(perModel, 89_478_488, 'a four-2k-texture model is 85.33 MiB')

  const names = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7']
  for (const name of names) h.addNode(somNode(name, { url: modelUrl(name) }))
  await drain(h, 200)

  for (const name of names.slice(0, 5)) {
    assert.equal(h.bridge.status(name).status, MODEL_STATUS.loaded, `${name} fits the 512 MiB budget`)
    assert.equal(h.childrenOf(name).length, 1, `${name} is attached`)
  }
  for (const name of names.slice(5)) {
    const refused = h.bridge.status(name)
    assert.equal(refused.status, MODEL_STATUS.failed, `${name} is refused`)
    assert.equal(refused.reason, 'world-texture-budget')
  }
  assert.equal(h.bridge.textureBudget.taken, perModel * 5, 'five reservations of ≈85.3 MiB')
})

// ---------------------------------------------------------------------------
// M3 (round 6) — ONE deadline per job
//
// Round 5's fetcher ran a 30 s timer that stopped when `fetchModel` returned,
// and `parseTemplate` started a second 30 s of its own: one model could spend
// about 60 s of its own work. The bridge now creates one deadline per job, at
// the job's first request, and passes it to both stages. Waiting for a turn
// (W5 admission, the serialized parse queue) does not count against it.
// ---------------------------------------------------------------------------

test('M3: a slow fetch plus a slow parse time out on the job\'s own deadline, not 30 s + 30 s', async () => {
  const seen = []
  const h = harness({
    newDeadline: () => createJobDeadline({ timeoutMs: 150 }),
    fetchModel: async ({ url, deadline }) => {
      seen.push(deadline)
      await new Promise((resolve) => setTimeout(resolve, 90))   // 90 of the job's 150 ms
      return {
        ok: true, kind: 'glb', bytes: imageGlb({ width: 64, height: 64 }), json: null,
        dependencies: new Map(), effectiveUrl: url, totalBytes: 1,
      }
    },
    parseLoader: { parseAsync: () => new Promise(() => {}) },   // never settles
  })
  h.addNode(somNode('M1'))
  const started = Date.now()
  await drain(h, 300)
  const took = Date.now() - started
  const status = h.bridge.status('M1')
  assert.equal(status.status, MODEL_STATUS.failed)
  assert.equal(status.reason, 'timeout')
  assert.equal(seen.length, 1, 'exactly one deadline per job')
  assert.ok(took < 1_000, `the job\'s own work is one deadline, not two (took ${took} ms)`)
})

test('M3: the job\'s clock stops while it waits for its turn, and starts again for the parse', async () => {
  const events = []
  const makeDeadline = () => {
    const deadline = {
      start() { events.push('start'); return deadline },
      pause() { events.push('pause'); return deadline },
      resume() { events.push('resume'); return deadline },
      expired() { return false },
      remainingMs() { return 30_000 },
    }
    return deadline
  }
  const h = harness({ newDeadline: makeDeadline })
  h.addNode(somNode('M1', { url: modelUrl('M1') }))
  h.addNode(somNode('M2', { url: modelUrl('M2') }))
  await drain(h)
  assert.equal(events.filter((e) => e === 'pause').length, 2, 'one pause per job, before it waits')
  assert.equal(events.filter((e) => e === 'resume').length, 2, 'one resume when its turn comes')
  assert.equal(h.bridge.status('M1').status, MODEL_STATUS.loaded)
  assert.equal(h.bridge.status('M2').status, MODEL_STATUS.loaded)
})

// ---------------------------------------------------------------------------
// M4 (round 6) — a parse that finishes after a world reset
//
// Round 5 kept ONE budget object and reset it in place, so a parse from the old
// world that finished later called `releaseTexture` on that same object and
// lowered the NEW world's total (the outside reviewer reproduced it: old
// reservation 64, new world 100, 36 after the late parse), and the old template
// was never disposed.
// ---------------------------------------------------------------------------

test('M4: after a world reset the old parse releases the OLD budget and its template is disposed once', async () => {
  const per = estimateTextureBytes(2048, 2048)
  const disposed = []
  const pending = []
  const gatedLoader = { parseAsync: () => new Promise((resolve) => pending.push(resolve)) }
  const templateA = { scene: new Group(), animations: [] }
  const templateB = { scene: new Group(), animations: [] }

  const h = harness({
    textureBudget: createTextureBudget({ bytes: per * 10 }),
    modelBytes: imageGlb({ width: 2048, height: 2048 }),
    parseLoader: gatedLoader,
    disposeTemplate: (template) => disposed.push(template),
  })

  h.addNode(somNode('Old', { url: 'https://h/old.glb' }))
  await settle()
  const oldBudget = h.bridge.textureBudget
  assert.equal(oldBudget.taken, per, 'the old world reserved the estimate before parsing')

  h.bridge.resetWorld()
  // A world change replaces the SOM too: the old node is gone from the document.
  h.removeNode('Old')
  const freshBudget = h.bridge.textureBudget
  assert.notEqual(freshBudget, oldBudget, 'the new generation has a budget OBJECT of its own')
  assert.equal(freshBudget.taken, 0, 'and starts at zero')

  h.addNode(somNode('New', { url: 'https://h/new.glb' }))
  await settle()

  // The OLD parse settles, in a world that no longer exists.
  pending[0](templateA)
  await settle()
  assert.equal(oldBudget.taken, 0, 'the old reservation went back to the OLD budget')
  assert.deepEqual(disposed, [templateA], 'the old template is disposed exactly once')

  // The new world loads its own model normally.
  assert.equal(pending.length, 2, 'the new parse ran once the queue reached it')
  pending[1](templateB)
  await settle()
  assert.equal(freshBudget.taken, per, 'the new world is charged its own model')
  assert.equal(h.bridge.status('New').status, MODEL_STATUS.loaded)
  assert.deepEqual(disposed, [templateA], 'and nothing else was disposed')
})

test('M4: a late parse releases the old budget, never the new world\'s', async () => {
  // The discriminating order: the new world reserves FIRST, and the old parse
  // settles afterwards. Round 5's single, in-place-reset budget object made that
  // late release subtract from the new world's total.
  const per = estimateTextureBytes(2048, 2048)
  const disposed = []
  const pending = []
  const gatedLoader = { parseAsync: () => new Promise((resolve) => pending.push(resolve)) }
  const templateA = { scene: { traverse: (fn) => fn({ geometry: { dispose: () => disposed.push('old') } }) } }
  const templateB = { scene: new Group(), animations: [] }

  const h = harness({
    textureBudget: createTextureBudget({ bytes: per * 10 }),
    modelBytes: imageGlb({ width: 2048, height: 2048 }),
    parseLoader: gatedLoader,
    // M3 — a deadline the gated parse runs past, so the job is `timeout` at once
    // and its release lands when the parse finally settles.
    newDeadline: () => createJobDeadline({ timeoutMs: 120 }),
  })

  h.addNode(somNode('Old', { url: 'https://h/old.glb' }))
  await settle()
  const oldBudget = h.bridge.textureBudget
  assert.equal(oldBudget.taken, per, 'the old world reserved it')
  await new Promise((resolve) => setTimeout(resolve, 200))    // the old parse runs past its deadline
  assert.equal(h.bridge.status('Old').reason, 'timeout')
  assert.equal(pending.length, 1, 'the old parse is still running')

  h.bridge.resetWorld()
  // A world change replaces the SOM too: the old node is gone from the document.
  h.removeNode('Old')
  const freshBudget = h.bridge.textureBudget
  h.addNode(somNode('New', { url: 'https://h/new.glb' }))
  await settle()
  assert.equal(pending.length, 2, 'the new world parses its own model')
  assert.equal(freshBudget.taken, per, 'the new world reserved its own model')

  // Now the old parse settles: dispose it once, and release against the OLD budget.
  pending[0](templateA)
  await settle()
  assert.deepEqual(disposed, ['old'], 'the old template is disposed exactly once')
  assert.equal(freshBudget.taken, per, 'the new world\'s total is unchanged')
  assert.equal(oldBudget.taken, 0, 'the old reservation went back to the old budget')

  pending[1](templateB)
  await settle()
  assert.equal(h.bridge.status('New').status, MODEL_STATUS.loaded, 'the new world still loads')
  assert.equal(freshBudget.taken, per)
})

// ---------------------------------------------------------------------------
// S7 (round 6) — an invalid model node shows its reason
//
// A6 says the bridge validates the whole node before anything is fetched. Round
// 5 answered a rejected spec by skipping the node exactly as it skips a node
// with no model at all, so a node declaring `{ url: 'http://x' }` simply
// disappeared.
// ---------------------------------------------------------------------------

test('S7: a node declaring a model the spec rejects gets the bad-spec placeholder', async () => {
  const h = harness()
  h.addNode(somNode('Bad', { url: 'http://x' }))
  await settle()

  const status = h.bridge.status('Bad')
  assert.equal(status.status, MODEL_STATUS.failed)
  assert.equal(status.reason, 'bad-spec')
  assert.equal(h.state.fetches, 0, 'nothing is fetched for a rejected spec')
  assert.equal(h.state.parses, 0)
  assert.equal(h.childrenOf('Bad').length, 1, 'the failed placeholder is under the host')

  // A node with NO model is still skipped, and gets no record at all.
  h.addNode({ name: 'Plain', _node: { def: 'Plain' }, mesh: null, extras: { atrium: {} } })
  await settle()
  assert.equal(h.bridge.status('Plain'), null, 'a node with no model is not a model host')
  assert.equal(h.childrenOf('Plain').length, 0)
})

test('S7: a rejected node does not hold up the model behind it in allNodes order', async () => {
  const h = harness()
  h.addNode(somNode('Bad', { url: 'not-a-url' }))
  h.addNode(somNode('Good', { url: 'https://h/good.glb' }))
  await settle()
  assert.equal(h.bridge.status('Bad').reason, 'bad-spec')
  assert.equal(h.bridge.status('Good').status, MODEL_STATUS.loaded,
    'the rejected node settles at once, so W5 admission is not blocked')
})

// ---------------------------------------------------------------------------
// L3a (this round) — a shared load belongs to its KEY, not to its first
// requester. Round 6 built the one job per key from the requester that asked
// first: that requester's controller and `wanted()`. Removing it therefore
// aborted a fetch every other requester was still waiting for, and every other
// node ended `loading`/`aborted` with no placeholder and no model until a world
// change. The invariant: while its node is in the SOM, every model node ends
// `loaded` or `failed` — never `loading`/`aborted`.
// ---------------------------------------------------------------------------

test('Z2/L3a: removing the FIRST of two requesters leaves the shared load alone', async () => {
  let release = null
  const gate = new Promise((resolve) => { release = resolve })
  const h = harness({ fetchGate: gate })
  h.addNode(somNode('Chair'))
  h.addNode(somNode('Bench'))
  await tick()
  assert.equal(h.state.fetches, 1, 'one URL, one task')

  h.removeNode('Chair')            // the requester that started the task leaves
  release()
  await settle()

  assert.equal(h.state.aborts, 0, 'the survivor’s fetch was never aborted')
  assert.equal(h.state.fetches, 1, 'and nothing was fetched a second time')
  assert.equal(h.bridge.status('Bench').status, MODEL_STATUS.loaded, 'B loads')
  assert.equal(h.childrenOf('Bench').length, 1)
})

test('Z2/L3a: the last requester leaving aborts the shared load, and no parse runs', async () => {
  let release = null
  const gate = new Promise((resolve) => { release = resolve })
  let taskSignal = null
  let fetches = 0
  const h = harness({
    fetchModel: async ({ url, signal }) => {
      fetches += 1
      taskSignal = signal
      await gate
      if (signal.aborted) return { ok: false, reason: 'aborted', message: 'cancelled' }
      return {
        ok: true, kind: 'glb', bytes: new Uint8Array([1]), json: null,
        dependencies: new Map(), effectiveUrl: url, totalBytes: 1,
      }
    },
  })
  h.addNode(somNode('Chair'))
  await tick()
  assert.equal(fetches, 1)
  assert.equal(taskSignal.aborted, false)

  h.removeNode('Chair')
  assert.equal(taskSignal.aborted, true, 'the shared task aborted AT ONCE')
  release()
  await settle()
  assert.equal(h.state.parses, 0, 'the abandoned job never parsed')
  assert.equal(h.bridge.cache.size, 0, 'and it left no template behind')
})

test('Z2/L3a: an earlier requester leaving frees a later node’s admission turn at once', async () => {
  let releaseA = null
  const gateA = new Promise((resolve) => { releaseA = resolve })
  const h = harness({
    fetchModel: async ({ url, signal }) => {
      if (url.includes('/a.glb')) {
        await gateA
        if (signal.aborted) return { ok: false, reason: 'aborted', message: 'cancelled' }
      }
      return {
        ok: true, kind: 'glb', bytes: new Uint8Array([1]), json: null,
        dependencies: new Map(), effectiveUrl: url, totalBytes: 1,
      }
    },
  })
  h.addNode(somNode('A', { url: 'https://h/a.glb' }))
  await tick()
  h.addNode(somNode('B', { url: 'https://h/b.glb' }))
  await settle()
  assert.equal(h.bridge.status('B').status, MODEL_STATUS.loading, 'B waits behind A’s turn')

  h.removeNode('A')
  await settle()
  assert.equal(h.bridge.status('B').status, MODEL_STATUS.loaded, 'the turn is recomputed at once')
  releaseA()
  await settle()
})

test('Z2/L3a: a Check and a node share one job; ending the Check leaves the node loading', async () => {
  let release = null
  const gate = new Promise((resolve) => { release = resolve })
  let taskSignal = null
  let fetches = 0
  const h = harness({
    fetchModel: async ({ url, signal }) => {
      fetches += 1
      taskSignal = signal
      await gate
      if (signal.aborted) return { ok: false, reason: 'aborted', message: 'cancelled' }
      return {
        ok: true, kind: 'glb', bytes: new Uint8Array([1]), json: null,
        dependencies: new Map(), effectiveUrl: url, totalBytes: 1,
      }
    },
  })
  const own = new AbortController()
  const check = h.bridge.loadTemplate({ url: 'https://h/m.glb', signal: own.signal })
  h.addNode(somNode('Chair', { url: 'https://h/m.glb' }))
  await tick()
  assert.equal(fetches, 1, 'the Check started the job and the node joined it')

  own.abort()                       // `endCheck`
  const checked = await check
  assert.deepEqual(checked, { ok: false, reason: 'aborted', message: 'the download was cancelled' })
  assert.equal(taskSignal.aborted, false, 'the node’s job is untouched')

  release()
  await settle()
  assert.equal(h.bridge.status('Chair').status, MODEL_STATUS.loaded, 'the node still loads')
  assert.equal(fetches, 1)
})

test('Z2/L3a: a parse that outlives every requester is disposed once, its reservation released once', async () => {
  let releaseParse = null
  const parseGate = new Promise((resolve) => { releaseParse = resolve })
  const disposed = []
  const h = harness({
    disposeTemplate: (template) => disposed.push(template),
    parseHook: async (args) => {
      args.reserveTexture?.(64)
      await parseGate
      return { ok: true, template: { scene: new Group(), animations: [], textureBytes: 64 }, textureBytes: 64 }
    },
  })
  h.addNode(somNode('Chair'))
  await settle()
  assert.equal(h.bridge.textureBudget.taken, 64, 'the parse reserved before it ran')

  h.removeNode('Chair')             // every requester is gone while the parse runs
  releaseParse()
  await settle()

  assert.equal(disposed.length, 1, 'the template the abandoned parse built is disposed once')
  assert.equal(h.bridge.textureBudget.taken, 0, 'and its reservation is given back once')
  assert.equal(h.bridge.cache.size, 0, 'no entry was left, so no reference was held')
})

test('Z2/L3a: a node deleted and re-added (Undo) while its parse waits still loads', async () => {
  let releaseFirst = null
  const firstGate = new Promise((resolve) => { releaseFirst = resolve })
  const h = harness({
    parseHook: async (args) => {
      if (args.json === null) await firstGate     // the first model’s parse is slow
      args.reserveTexture?.(0)
      return { ok: true, template: { scene: new Group(), animations: [], textureBytes: 0 }, textureBytes: 0 }
    },
  })
  h.addNode(somNode('First', { url: 'https://h/first.glb' }))
  await settle()
  h.addNode(somNode('Second', { url: 'https://h/second.glb' }))
  await settle()
  assert.equal(h.bridge.status('Second').status, MODEL_STATUS.loading, 'Second waits behind First')

  h.removeNode('Second')            // abandoned while its parse waits
  h.addNode(somNode('Second'))      // Undo: the same URL, a NEW task
  releaseFirst()
  await settle()

  assert.equal(h.bridge.status('Second').status, MODEL_STATUS.loaded,
    'the re-added node parses for itself instead of awaiting the abandoned parse')
  assert.equal(h.childrenOf('Second').length, 1)
})

test('Z2/L3a: over a random add/remove sequence every node ends loaded or failed', async () => {
  const h = harness()
  const names = ['A', 'B', 'C', 'D']
  let seed = 7
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }

  for (let step = 0; step < 30; step++) {
    const name = names[Math.floor(rand() * names.length)]
    const live = h.state.nodes.some((node) => node.name === name)
    if (live) h.removeNode(name)
    else h.addNode(somNode(name))
    await settle()
  }

  assert.ok(h.state.nodes.length > 0, 'the sequence left at least one node')
  for (const node of h.state.nodes) {
    const status = h.bridge.status(node.name)
    assert.ok(status, `${node.name} has a status`)
    assert.ok(
      status.status === MODEL_STATUS.loaded || status.status === MODEL_STATUS.failed,
      `${node.name} ended ${status.status}/${status.reason}`,
    )
  }
})

// ---------------------------------------------------------------------------
// Z4 (this round) — what is built is disposed. Round 6 dropped a record's
// wrapper and left the placeholder's geometry and material (and a skinned
// instance's cloned skeleton, whose bone texture only `skeleton.dispose()`
// frees) on the GPU for the life of the page.
// ---------------------------------------------------------------------------

/** Count the `dispose` events on a three object without changing its behaviour. */
function disposedOnce(object) {
  const counts = { n: 0 }
  object.addEventListener?.('dispose', () => { counts.n += 1 })
  return counts
}

test('Z4: the loading placeholder goes, disposed, when the model arrives', async () => {
  const h = harness()
  h.addNode(somNode('Chair'))
  const first = h.bridge.instances.get('Chair').placeholder
  const geometry = disposedOnce(first.box.geometry)
  const material = disposedOnce(first.box.material)

  await settle()
  assert.equal(geometry.n, 1, 'the placeholder’s geometry is disposed once')
  assert.equal(material.n, 1, 'and its material')
  assert.equal(h.childrenOf('Chair').length, 1, 'only the instance is under the host')
})

test('Z4: the placeholder goes, disposed, on a failure, on removal and on a world change', async () => {
  const h = harness({ parseResult: { ok: false, reason: 'parse', message: 'the file is not a glTF model' } })
  h.addNode(somNode('Failed'))
  const failed = h.bridge.instances.get('Failed').placeholder
  const failedGeometry = disposedOnce(failed.box.geometry)
  await settle()
  assert.equal(failedGeometry.n, 1, 'the loading placeholder went for the failed one')

  const shown = h.bridge.instances.get('Failed').placeholder
  const shownGeometry = disposedOnce(shown.box.geometry)
  const shownMaterial = disposedOnce(shown.box.material)
  h.removeNode('Failed')
  assert.equal(shownGeometry.n, 1, 'removing the node disposes the failed placeholder')
  assert.equal(shownMaterial.n, 1, 'and its material')

  h.addNode(somNode('Again'))
  const world = h.bridge.instances.get('Again').placeholder
  const worldGeometry = disposedOnce(world.box.geometry)
  const worldMaterial = disposedOnce(world.box.material)
  h.bridge.resetWorld()
  assert.equal(worldGeometry.n, 1, 'a world change disposes it too')
  assert.equal(worldMaterial.n, 1, 'and its material')
})

test('Z4: a spec change disposes the old instance and its skeleton', async () => {
  const h = harness()
  h.addNode(somNode('Chair', { url: 'https://h/a.glb' }))
  await settle()
  const instance = h.bridge.instances.get('Chair').instance
  const skeleton = { disposed: 0, dispose() { this.disposed += 1 } }
  instance.scene.add(Object.assign(new Object3D(), { skeleton }))
  const wrapper = instance.wrapper

  h.state.nodes[0].extras.atrium.model = { url: 'https://h/b.glb' }
  h.bridge.reconcile()
  await settle()

  assert.equal(skeleton.disposed, 1, 'the old instance’s skeleton was disposed')
  assert.equal(wrapper.parent, null, 'and its wrapper left the scene')
})

test('Z4: fifty add/remove cycles leave no placeholder geometry undisposed', async () => {
  const h = harness()
  for (let i = 0; i < 50; i++) {
    h.addNode(somNode('Chair'))
    const geometry = disposedOnce(h.bridge.instances.get('Chair').placeholder.box.geometry)
    h.removeNode('Chair')
    assert.equal(geometry.n, 1, `cycle ${i}: the placeholder geometry was disposed`)
  }
})

test('Z4: disposeInstance frees each distinct skeleton once and never the template’s resources', () => {
  const sharedGeometry = new BoxGeometry(1, 1, 1)
  const sharedMaterial = new MeshBasicMaterial()
  const geometry = disposedOnce(sharedGeometry)
  const material = disposedOnce(sharedMaterial)
  const shared = Object.assign(new Object3D(), { geometry: sharedGeometry, material: sharedMaterial })
  const one = { disposed: 0, dispose() { this.disposed += 1 } }
  const two = { disposed: 0, dispose() { this.disposed += 1 } }
  const scene = new Group()
  const first = Object.assign(new Object3D(), { skeleton: one, geometry: sharedGeometry })
  const second = Object.assign(new Object3D(), { skeleton: one, geometry: sharedGeometry })
  const third = Object.assign(new Object3D(), { skeleton: two })
  scene.add(first, second, third)
  const wrapper = new Object3D()
  wrapper.add(scene)
  const host = new Object3D()
  host.add(wrapper)
  const clips = [{ disposed: 0, dispose() { this.disposed += 1 } }]

  disposeInstance({ wrapper, scene, clips })

  assert.equal(one.disposed, 1, 'a skeleton shared by two meshes is disposed once') 
  assert.equal(two.disposed, 1, 'and every distinct skeleton is disposed')
  assert.equal(shared.disposed, undefined, 'the template object itself is never disposed')
  assert.equal(geometry.n, 0, 'the shared geometry is untouched')
  assert.equal(material.n, 0, 'nor the shared material')
  assert.equal(clips[0].disposed, 1, 'the retargeted clips are disposed')
  assert.equal(host.children.length, 0, 'the wrapper left its host')
})

// ── R1/R7: the bridge fails a node it still wants, and never parks it ────────

const glTfJson = (json) => new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' }, ...json }))
const GLB_BYTES = Uint8Array.from([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 1, 2, 3, 4])

/** A response whose body is served in `chunk`-sized pieces. */
function bodyResponse(body, url, { chunk = 0 } = {}) {
  const data = body instanceof Uint8Array ? body : new TextEncoder().encode(String(body))
  const stream = new ReadableStream({
    start(controller) {
      const size = chunk > 0 ? chunk : data.length || 1
      for (let at = 0; at < data.length; at += size) controller.enqueue(data.subarray(at, at + size))
      controller.close()
    },
  })
  return { ok: true, status: 200, redirected: false, url, headers: new Headers(), body: stream }
}

/** A response that sends its headers and then stalls until its signal aborts. */
function stalledResponse(url, signal) {
  const stream = new ReadableStream({
    start(controller) {
      signal?.addEventListener?.('abort', () => {
        try { controller.error(new Error('aborted')) } catch { /* already closed */ }
      }, { once: true })
    },
  })
  return { ok: true, status: 200, redirected: false, url, headers: new Headers(), body: stream }
}

/** A fetch stub for the REAL `fetchModel`, recording every call in order. */
function tableFetch(table) {
  const calls = []
  const fn = async (url, options) => {
    calls.push({ url, options })
    const entry = table[url]
    if (entry === undefined) throw new Error(`unexpected request: ${url}`)
    return typeof entry === 'function' ? entry(url, options) : entry
  }
  fn.calls = calls
  return fn
}

/** Poll with ticks until `check()` holds, or the budget runs out. */
async function until(check, ms = 5000) {
  const stop = Date.now() + ms
  while (Date.now() < stop) { if (check()) return true; await tick() }
  return check()
}

test('R1 (t5): a stalled dependency fails its own node as timeout, and the model after it still loads', { timeout: 15_000 }, async () => {
  const stub = tableFetch({
    'https://h/a.gltf': () => bodyResponse(glTfJson({ images: [{ uri: 'a.png' }] }), 'https://h/a.gltf'),
    // The dependency sends headers and never a byte of body.
    'https://h/a.png': (url, options) => stalledResponse(url, options.signal),
    'https://h/b.glb': () => bodyResponse(GLB_BYTES, 'https://h/b.glb'),
  })
  const h = harness({
    newDeadline: () => createJobDeadline({ timeoutMs: 300 }),
    fetchModel: (args) => fetchModel({ ...args, fetchFn: stub, limits: { ...MODEL_LIMITS, timeoutMs: 300 } }),
  })
  h.addNode(somNode('A', { url: 'https://h/a.gltf' }))
  h.addNode(somNode('B', { url: 'https://h/b.glb' }))

  await until(() => h.bridge.status('A').status === MODEL_STATUS.failed)
  const a = h.bridge.status('A')
  assert.equal(a.status, MODEL_STATUS.failed, `A ended ${JSON.stringify(a)}`)
  assert.equal(a.reason, 'timeout', `A ended ${JSON.stringify(a)}`)

  await until(() => h.bridge.status('B').status === MODEL_STATUS.loaded)
  const b = h.bridge.status('B')
  assert.equal(b.status, MODEL_STATUS.loaded, `the model after the stalled one ended ${JSON.stringify(b)}`)
})

test('R7 (t7): a dependency that crosses the world ledger fails its node as world-download-budget', { timeout: 5000 }, async () => {
  const ledger = createWorldLedger({ worldBytes: 1000 })
  const stub = tableFetch({
    'https://h/a.gltf': () => bodyResponse(glTfJson({ images: [{ uri: 'a.png' }] }), 'https://h/a.gltf'),
    'https://h/a.png': () => bodyResponse(new Uint8Array(4000), 'https://h/a.png', { chunk: 1000 }),
  })
  const h = harness({
    ledger,
    fetchModel: (args) => fetchModel({ ...args, fetchFn: stub, limits: { ...MODEL_LIMITS, timeoutMs: 5000 } }),
  })
  h.addNode(somNode('A', { url: 'https://h/a.gltf' }))

  await until(() => h.bridge.status('A').status !== MODEL_STATUS.loading)
  const a = h.bridge.status('A')
  assert.equal(a.status, MODEL_STATUS.failed, `A ended ${JSON.stringify(a)}`)
  assert.equal(a.reason, 'world-download-budget', `A ended ${JSON.stringify(a)}`)
  assert.ok(h.childrenOf('A').length > 0, 'the failed placeholder is shown')
  assert.ok(ledger.over, 'the world is over its budget')
})

test('R7 (t8): a task that reports `aborted` while its node is still wanted FAILS that node', async () => {
  const h = harness({ fetchModel: async () => ({ ok: false, reason: 'aborted', message: 'cancelled' }) })
  h.addNode(somNode('A'))
  await tick()
  const a = h.bridge.status('A')
  assert.equal(a.status, MODEL_STATUS.failed, `A ended ${JSON.stringify(a)}`)
  assert.notEqual(a.status, MODEL_STATUS.loading, 'the node is never parked loading/aborted')
  assert.ok(h.childrenOf('A').length > 0, 'the failed placeholder is shown')
})


