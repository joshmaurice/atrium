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
import { createModelBridge, MODEL_STATUS, MODEL_INSTANCE_LIMIT, HOST_FRAME_LIMIT, specTemplateKey } from '../src/model-bridge.js'
import { parseTemplate, createTextureBudget, estimateTextureBytes, parseReasonText } from '../src/model-parse.js'
import { imageGlb } from './glb-fixture.js'
import { validateModelHost } from '@atrium/client/model-spec'

/** A SOM node stand-in: identity, name, a glTF node object and model extras. */
function somNode(name, model = { url: 'https://h/m.glb' }, { mesh = null } = {}) {
  return { name, _node: { def: name }, mesh, extras: { atrium: { model } } }
}

function harness({ nextFrame = null, parseResult = null, fetchGate = null, textureBudget = null, modelBytes = null, parseLoader = null, disposeTemplate = null, redirectTo = null } = {}) {
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
          ok: true, kind: 'glb', bytes: modelBytes ?? new Uint8Array([1]), json: null,
          dependencies: new Map(), effectiveUrl: redirectTo ? redirectTo(url) : url, totalBytes: 1,
        }
      },
      parseTemplate: async (args) => {
        state.parses += 1
        if (parseResult) return parseResult
        // `parseLoader` runs the REAL parseTemplate (and so the real preflight)
        // with a loader stand-in: no image decoding, no GLTFLoader (W1, round 3).
        if (parseLoader) return parseTemplate({ ...args, loader: parseLoader })
        args?.reserveTexture?.(0)
        return { ok: true, template: { scene: new Group(), animations: [], textureBytes: 0 }, textureBytes: 0 }
      },
      ...(textureBudget ? { textureBudget } : {}),
      ...(disposeTemplate ? { disposeTemplate } : {}),
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
