// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * model-bridge.js — the scene's model instances, kept matching the SOM
 * (Phase 3 step 3a: Z5 and Z6 as amended by A6, A8, A9, A10 and A11).
 *
 * Two lifetimes (A9):
 *   - the WORLD generation: `resetWorld()` aborts every request and parse,
 *     drops the transfer ledger and disposes every template and instance. The
 *     app calls it on the client's `connecting` and `disconnected` events and
 *     immediately before `loadWorld`/`loadWorldFromData`; it does not wait for
 *     a new `client.som`.
 *   - the VIEW generation: `attachView(docView, sceneGroup)` after
 *     `stage.setSceneGroup`, `detachView()` before `initDocumentView`. A view
 *     change keeps the cache, so an external ref's `world:loaded` (which
 *     rebuilds DocumentView on the SAME SOM) re-attaches without a fetch.
 *
 * Every attach re-checks, at the moment of attaching: the world generation it
 * started in, that the SOM node is still in `client.som` by identity, that the
 * node's spec key is unchanged, and the current view. A host is only taken from
 * `listViews(node)` (in the app: `docView.listViews(node._node)`), keeping an
 * object whose ancestor chain reaches the current `sceneGroup`; a host captured
 * before an `await` is never used. No host after 10 frames is `no-host`, never
 * stuck in `loading`.
 *
 * Ordering (A10) is `som.allNodes` order, never `som.nodes`: the instance limit
 * counts model nodes in that order and texture-budget admission happens in that
 * order too, because one parse runs at a time per page (A5) and each load takes
 * its turn in `allNodes` order.
 */

import { MODEL_LIMITS, createWorldLedger } from '@atrium/client/model-fetch'
import { validateModelHost as defaultValidateModelHost } from '@atrium/client/model-spec'
import { templateKey, createTemplateCache, createTextureBudget, disposeTemplate, parseTemplate } from './model-parse.js'
import { buildInstance, buildPlaceholder, PLACEHOLDER_COLOURS } from './model-instances.js'

/** L8 — the most model nodes one world renders (A10: in `som.allNodes` order). */
export const MODEL_INSTANCE_LIMIT = 256

/** A9 — how many frames to wait for a new node's DocumentView object. */
export const HOST_FRAME_LIMIT = 10

/** Z5 — the statuses the Edit panel reads. */
export const MODEL_STATUS = Object.freeze({ loading: 'loading', loaded: 'loaded', failed: 'failed' })

const noop = () => {}

/**
 * @param {object} deps
 * @param {(node: object) => object[]} deps.listViews   the DocumentView objects for a SOM node
 * @param {() => object|null} deps.som                  the client's SOM
 * @param {() => string|null} [deps.worldBaseUrl]       the address root-relative URLs resolve against
 * @param {(fn: Function) => void} [deps.nextFrame]     requestAnimationFrame or a stub
 * @param {object} [deps.hooks]                         the tested seams (fetch/parse/…)
 * @param {(node: object, status: object) => void} [deps.onStatus]  one event per change
 */
export function createModelBridge(deps = {}) {
  const {
    listViews = () => [],
    som = () => null,
    nextFrame = (fn) => fn(),
    onStatus = noop,
    hooks = {},
  } = deps

  const fetchModel = hooks.fetchModel ?? defaultFetchModel()
  const parse = hooks.parseTemplate ?? parseTemplate
  const makeInstance = hooks.buildInstance ?? buildInstance
  const makePlaceholder = hooks.buildPlaceholder ?? buildPlaceholder
  const dispose = hooks.disposeTemplate ?? disposeTemplate
  // A6 — the bridge validates the whole node (the spec and the no-mesh rule)
  // before anything is fetched.
  const validateHost = hooks.validateModelHost ?? defaultValidateModelHost

  const ledger = hooks.ledger ?? createWorldLedger({ worldBytes: MODEL_LIMITS.worldBytes })
  const textureBudget = hooks.textureBudget ?? createTextureBudget()
  const cache = hooks.cache ?? createTemplateCache()

  let worldGeneration = 1
  let viewGeneration = 1
  let currentView = null
  const instances = new Map()      // node name → instance record
  const parses = new Map()         // template key → the parse in flight
  const queue = []
  let running = 0
  const controllers = new Set()

  /** A5 — one parse at a time per page, in the order the loads arrived. */
  let parseChain = Promise.resolve()
  function serialize(fn) {
    const next = parseChain.then(fn, fn)
    parseChain = next.then(noop, noop)
    return next
  }

  const statusOf = (record) => ({ status: record.status, reason: record.reason, message: record.message })

  function setStatus(record, status, reason = null, message = null) {
    if (record.status === status && record.reason === reason) return
    record.status = status
    record.reason = reason
    record.message = message
    onStatus(record.node, statusOf(record))
  }

  // ── the view (A9) ───────────────────────────────────────────────────────

  /** Attach the current view. Re-attaches every live instance to the new one. */
  function attachView(docView, sceneGroup) {
    currentView = { docView, sceneGroup, generation: ++viewGeneration }
    for (const record of instances.values()) attach(record)
    reconcile()
  }

  /** Detach every wrapper from its host before the view is rebuilt (A9). */
  function detachView() {
    viewGeneration += 1
    for (const record of instances.values()) detachWrapper(record)
    currentView = null
  }

  /** Take the wrapper out of the scene but keep it: a view change re-attaches it. */
  function detachWrapper(record) {
    if (record.wrapper?.parent) record.wrapper.parent.remove(record.wrapper)
    record.viewGeneration = null
  }

  function removeWrapper(record) {
    detachWrapper(record)
    record.wrapper = null
    record.attachedGeneration = null
  }

  // ── the world (A9) ─────────────────────────────────────────────────────

  /** Abort everything, drop the ledger, dispose every template and instance. */
  function resetWorld() {
    worldGeneration += 1
    for (const controller of controllers) controller.abort('world-change')
    controllers.clear()
    queue.length = 0
    parses.clear()
    ledger.reset()
    for (const record of instances.values()) removeWrapper(record)
    instances.clear()
    textureBudget.reset()
    cache.clear((template) => dispose(template))
  }

  /** Z5 — fetches queue at L8's concurrency; the order is A10's. */
  function enqueue(record) {
    queue.push(record)
    pump()
  }

  function pump() {
    while (running < MODEL_LIMITS.concurrent && queue.length > 0) {
      const record = queue.shift()
      if (record.worldGeneration !== worldGeneration) continue
      running += 1
      load(record)
        .catch(() => {})
        .finally(() => { running -= 1; pump() })
    }
  }

  /** The whole job for one node: fetch, parse, admit, attach (A3/A4/A5/A9). */
  async function load(record) {
    const controller = new AbortController()
    controllers.add(controller)
    const { spec } = record
    try {
      const fetched = await fetchModel({
        url: spec.url, sha256: spec.sha256 ?? null, signal: controller.signal,
        worldBaseUrl: record.worldBaseUrl, ledger,
      })
      if (fetched.reason === 'aborted') return drop(record)
      if (!fetched.ok) return fail(record, fetched.reason, fetched.message)
      if (!stillWanted(record)) return drop(record)

      const key = templateKey(fetched.effectiveUrl ?? spec.url, spec.sha256 ?? null)
      const got = await templateFor(key, record, fetched)
      if (got.reason === 'aborted' || !got.ok) return fail(record, got.reason, got.message)
      if (!stillWanted(record)) return drop(record)

      record.key = key
      cache.acquire(key)
      const entry = cache.get(key)
      const built = makeInstance(entry.template)
      if (!stillWanted(record)) { cache.release(key); return drop(record) }
      record.wrapper?.parent?.remove(record.wrapper)
      record.wrapper = built.wrapper
      record.clips = built.clips
      record.droppedTracks = built.droppedTracks
      setStatus(record, MODEL_STATUS.loaded, null, built.droppedTracks
        ? `${built.droppedTracks} animation tracks couldn't be bound` : null)
      attachOrWait(record)
    } finally {
      controllers.delete(controller)
    }
  }

  /**
   * Z3/A8/A10 — the template for `key`, parsed once: two nodes with one URL
   * share one parse, and the texture reservation is taken before the parse
   * (A5), in `allNodes` order.
   */
  function templateFor(key, record, fetched) {
    const existing = cache.get(key)
    if (existing) return Promise.resolve({ ok: true, entry: existing })

    const inFlight = parses.get(key)
    if (inFlight) return inFlight

    const promise = serialize(async () => {
      const again = cache.get(key)
      if (again) return { ok: true, entry: again }
      if (!stillWanted(record)) return { ok: false, reason: 'aborted', message: 'cancelled' }

      const parsed = await parse({
        kind: fetched.kind, bytes: fetched.bytes, json: fetched.json,
        dependencies: fetched.dependencies ?? new Map(),
        reserveTexture, releaseTexture,
      })
      if (!parsed.ok) return { ok: false, reason: parsed.reason, message: parsed.message }

      const textureBytes = parsed.textureBytes ?? 0
      return { ok: true, entry: cache.set(key, { ...parsed.template, textureBytes }) }
    })
    parses.set(key, promise)
    promise.then(noop, noop).finally(() => { if (parses.get(key) === promise) parses.delete(key) })
    return promise
  }

  /** A5/A8 — reserve, evicting idle templates least-recently-used first. */
  function reserveTexture(bytes) {
    if (!textureBudget.fits(bytes)) cache.evictIdleFor(bytes, textureBudget, dispose)
    return textureBudget.reserve(bytes)
  }

  function releaseTexture(bytes) {
    textureBudget.release(bytes)
  }

  /** A9 — is this result still the one the world and the SOM want? */
  function stillWanted(record) {
    if (record.worldGeneration !== worldGeneration) return false
    if (instances.get(record.node.name) !== record) return false
    if (specKey(record.spec) !== record.specKey) return false
    const document = som()
    if (!document?.getNodeByName) return false
    return document.getNodeByName(record.node.name) === record.node
  }

  function drop(record) {
    removeWrapper(record)
    if (record.key) { cache.release(record.key); record.key = null }
    setStatus(record, MODEL_STATUS.loading, 'aborted', null)
  }

  function fail(record, reason, message) {
    removeWrapper(record)
    if (record.key) { cache.release(record.key); record.key = null }
    setStatus(record, MODEL_STATUS.failed, reason, message)
    showPlaceholder(record)
  }

  // ── attaching (A9) ─────────────────────────────────────────────────────

  /** Everything is re-checked HERE, at the moment of attaching. */
  function attach(record) {
    if (!currentView) return false
    if (record.worldGeneration !== worldGeneration) return false
    if (record.viewGeneration === currentView.generation && record.wrapper?.parent) return true
    const node = record.node
    if (som()?.getNodeByName?.(node.name) !== node) return false

    const host = hostFromViews(node)
    if (!host) return false

    if (record.wrapper?.parent) record.wrapper.parent.remove(record.wrapper)
    record.attachedGeneration = currentView.generation
    record.viewGeneration = currentView.generation
    host.add(record.wrapper)
    return true
  }

  /**
   * A9 — wait for the host, at most HOST_FRAME_LIMIT frames, then `no-host`.
   * The node's DocumentView object can appear a frame after its `som:add` (P3).
   */
  function attachOrWait(record, frames = 0) {
    if (attach(record)) return
    if (record.worldGeneration !== worldGeneration) return
    if (frames >= HOST_FRAME_LIMIT) {
      if (record.status === MODEL_STATUS.loaded) fail(record, 'no-host', 'the object never appeared in the view')
      return
    }
    nextFrame(() => attachOrWait(record, frames + 1))
  }

  /** Z5/A9 — the host comes from the view, by identity, and must reach the sceneGroup. */
  function hostFromViews(node) {
    if (!currentView) return null
    const views = listViews(node) ?? []
    for (const object of views) {
      if (object && reaches(object, currentView.sceneGroup)) return object
    }
    return null
  }

  function reaches(object, ancestor) {
    let current = object
    while (current) {
      if (current === ancestor) return true
      current = current.parent
    }
    return false
  }

  /** Z6 — the placeholder, present while loading and after a failure. */
  function showPlaceholder(record) {
    if (!currentView) return
    const built = makePlaceholder(record.spec.bounds ?? null)
    record.placeholder = built
    record.wrapper = built.wrapper
    const failed = record.status === MODEL_STATUS.failed
    built.box?.material?.color?.setHex?.(failed ? PLACEHOLDER_COLOURS.failed : PLACEHOLDER_COLOURS.loading)
    const host = hostFromViews(record.node)
    if (host) host.add(record.wrapper)
    record.attachedGeneration = currentView.generation
  }

  // ── reconciling (Z5) ───────────────────────────────────────────────────

  /**
   * Make the scene match the SOM. Order is `som.allNodes`, never `som.nodes`
   * (A10), and texture-budget admission happens in that order too.
   */
  function reconcile() {
    const document = som()
    if (!document) return { added: 0, removed: 0 }

    const live = new Set()
    let admitted = 0
    for (const node of document.allNodes ?? []) {
      const spec = specFor(node)
      if (!spec) continue
      live.add(node.name)
      const existing = instances.get(node.name)
      if (existing && existing.specKey === specKey(spec)) { admitted += 1; continue }
      if (existing) removeInstance(node.name)
      if (admitted >= MODEL_INSTANCE_LIMIT) continue
      admitted += 1
      const record = {
        node, spec, specKey: specKey(spec), status: null, reason: null, message: null,
        wrapper: null, placeholder: null, clips: [], droppedTracks: 0, key: null,
        worldGeneration, viewGeneration: null, attachedGeneration: null,
        worldBaseUrl: deps.worldBaseUrl?.() ?? null,
      }
      instances.set(node.name, record)
      setStatus(record, MODEL_STATUS.loading)
      showPlaceholder(record)
      enqueue(record)
    }

    const removed = []
    for (const name of [...instances.keys()]) {
      if (!live.has(name)) { removeInstance(name); removed.push(name) }
    }
    return { added: instances.size, removed: removed.length }
  }

  function removeInstance(name) {
    const record = instances.get(name)
    if (!record) return
    removeWrapper(record)
    if (record.key) { cache.release(record.key); record.key = null }
    instances.delete(name)
  }

  /** Z5 — a status change for one node, for the panel. */
  function status(name) {
    const record = instances.get(name)
    return record ? statusOf(record) : null
  }

  function specFor(node) {
    const parsed = validateHost ? validateHost(node) : null
    if (!parsed?.ok || !parsed.spec) return null
    return parsed.spec
  }

  return {
    attachView,
    detachView,
    resetWorld,
    reconcile,
    status,
    /** The cache and its budget, for tests and for the form's Check (Z7). */
    cache,
    ledger,
    textureBudget,
    get instanceCount() { return instances.size },
    get instances() { return instances },
    get viewGeneration() { return viewGeneration },
    get worldGeneration() { return worldGeneration },
  }
}

/** The key an instance's spec is compared by (A9's "spec unchanged"). */
export function specKey(spec) {
  return `${spec.url}\u0000${spec.sha256 ?? ''}\u0000${(spec.bounds ?? []).join(',')}`
}

function defaultFetchModel() {
  return async () => ({ ok: false, reason: 'network', message: 'no fetcher was configured' })
}
