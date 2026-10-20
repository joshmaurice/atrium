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
 *
 * W5 (round 5) makes that last clause true for a page where every model loads at
 * once (a visitor): the fetches still run in parallel, but a model node's parse
 * does not reserve texture bytes until every model node before it in the current
 * `som.allNodes` order has been admitted, has failed or has been dropped. Round
 * 4 admitted in the order the downloads finished, so the model refused was the
 * one whose download lost the race rather than the last in document order.
 */

import { MODEL_LIMITS, createWorldLedger, sha256Hex } from '@atrium/client/model-fetch'
import { validateModelHost as defaultValidateModelHost, resolveModelUrl } from '@atrium/client/model-spec'
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
 * @param {object} deps.hooks                           the tested seams
 * @param {(args: object) => Promise<object>} deps.hooks.fetchModel  the limited fetcher (required)
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

  // V3 (round 2) — the fetcher is required. Round 1 fell back to a stub that
  // always answered `network: "no fetcher was configured"`, so app.js's bridge
  // — created without `hooks.fetchModel` — left every placed model an amber
  // placeholder and told the Edit panel "no fetcher was configured", silently.
  // A missing fetcher is a wiring bug; it must be loud, and it must be found
  // before the first node instead of at the first load.
  if (typeof hooks.fetchModel !== 'function') {
    throw new TypeError('createModelBridge needs deps.hooks.fetchModel (there is no default fetcher)')
  }

  const fetchModel = hooks.fetchModel
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
  const loads = new Map()          // template key → the fetch+parse in flight (V4)
  const queue = []
  let running = 0
  const controllers = new Set()

  // W5 (round 5) — admission is ordered by `som.allNodes`, not by the order the
  // downloads happen to finish. A model node's reservation (the start of its
  // serialized parse) waits until every model node before it in the current
  // `som.allNodes` order has been admitted, has failed or has been dropped.
  // Fetches stay parallel; only the turn at which a parse may reserve is ordered.
  const admissionWaiters = new Set()

  /** A5 — one parse at a time per page, in the order the loads arrived. */
  let parseChain = Promise.resolve()
  function serialize(fn) {
    const next = parseChain.then(fn, fn)
    parseChain = next.then(noop, noop)
    return next
  }

  // ── W5: admission in document order ─────────────────────────────────────

  /** A node has reached a terminal state: admitted, failed, or dropped. */
  function settle(record) {
    if (!record || record.settled) return
    record.settled = true
    notifyAdmission()
  }

  /** Wake every parse waiting for a turn. */
  function notifyAdmission() {
    for (const wake of admissionWaiters) wake()
    admissionWaiters.clear()
  }

  function admissionChanged() {
    return new Promise((resolve) => admissionWaiters.add(resolve))
  }

  /**
   * The model nodes before `record` in the CURRENT `som.allNodes` order that
   * have not settled yet. A node added live is after every existing node, and a
   * node the SOM no longer lists is not a predecessor at all.
   */
  function earlierPending(record) {
    const order = som()?.allNodes
    if (!order) return []
    const mine = order.indexOf(record.node)
    if (mine < 0) return []
    const pending = []
    for (let i = 0; i < mine; i++) {
      const other = instances.get(order[i].name)
      if (other && other !== record && !other.settled) pending.push(other)
    }
    return pending
  }

  /** W5 — wait for the earlier model nodes to be admitted, failed or dropped. */
  async function waitForEarlier(record, wanted) {
    while (wanted() && earlierPending(record).length > 0) await admissionChanged()
    return wanted()
  }

  /**
   * W5 — a Check (`loadTemplate`) is not a node: it goes after every model node
   * that is loading. The snapshot is the set loading when the Check's turn came.
   */
  async function waitForLoading(wanted) {
    const pending = [...instances.values()].filter((r) => !r.settled)
    while (wanted() && pending.some((r) => !r.settled)) await admissionChanged()
    return wanted()
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
    loads.clear()
    ledger.reset()
    for (const record of instances.values()) { settle(record); removeWrapper(record) }
    instances.clear()
    textureBudget.reset()
    cache.clear((template) => dispose(template))
    notifyAdmission()
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

  /**
   * V4 — the key a node's template lives under: its spec URL resolved against
   * the world's base (A1/A13) plus the pinned hash, never the URL the response
   * came back with. `app.js`'s held Check uses `specTemplateKey` too, so Save
   * finds the template Check downloaded.
   */
  function keyFor(record) {
    return specTemplateKey(record.spec, record.worldBaseUrl)
  }

  /** The whole job for one node: look up, fetch, parse, admit, attach (A3/A4/A5/A8/A9). */
  async function load(record) {
    const controller = new AbortController()
    controllers.add(controller)
    try {
      // V4 — the cache and the in-flight loads are consulted BEFORE the fetch,
      // under the key the spec determines. Round 1 fetched first and keyed the
      // cache on the fetched `effectiveUrl` only afterwards, so a Duplicate, a
      // Redo or a Save after a held Check downloaded the same bytes again — a
      // repeat charged to the world's ledger, which never refunds.
      const key = keyFor(record)
      const cached = cache.get(key)
      if (cached) {
        if (!stillWanted(record)) return drop(record)
        return useEntry(record, key, cached)
      }

      let job = loads.get(key)
      if (!job) {
        job = fetchAndParse(record, key, controller, () => stillWanted(record))
        loads.set(key, job)
        job.then(noop, noop).finally(() => { if (loads.get(key) === job) loads.delete(key) })
      }

      const got = await job
      if (got.reason === 'aborted') return drop(record)
      if (!got.ok) return fail(record, got.reason, got.message)
      if (!stillWanted(record)) return drop(record)

      return useEntry(record, key, got.entry, got.createdFor === record)
    } finally {
      controllers.delete(controller)
    }
  }

  /**
   * W4 — the bridge's ONE entry point for loading a template by URL: the cache
   * and the in-flight lookup, the fetch, the serialized parse with its texture
   * reservation, and the entry handed back ACQUIRED. The caller holds that
   * reference and gives it back with `releaseTemplate`.
   *
   * `app.js`'s Check uses this and nothing else. Round 3's Check fetched and
   * parsed on its own — outside the budget and outside the parse queue — and
   * then put the result in the cache with its `textureBytes`, so the owner's
   * page kept `textureBudget.taken` at 0.0 MiB through every Check-then-Save.
   *
   * @param {{url: string, sha256?: string|null}} args
   * @returns {Promise<{ok: true, key: string, entry: object, fetched: object|null}
   *                   | {ok: false, reason: string, message: string}>}
   */
  async function loadTemplate({ url, sha256 = null } = {}) {
    const token = { spec: { url, sha256 }, worldBaseUrl: deps.worldBaseUrl?.() ?? null, key: null }
    const key = specTemplateKey(token.spec, token.worldBaseUrl)
    const generation = worldGeneration
    const wanted = () => generation === worldGeneration

    const cached = cache.get(key)
    if (cached) {
      const held = cache.acquire(key) ?? cached
      await settleHash(held)
      return { ok: true, key, entry: held, fetched: null }
    }

    const controller = new AbortController()
    controllers.add(controller)
    try {
      let job = loads.get(key)
      if (!job) {
        job = fetchAndParse(token, key, controller, wanted)
        loads.set(key, job)
        job.then(noop, noop).finally(() => { if (loads.get(key) === job) loads.delete(key) })
      }

      const got = await job
      if (got.reason === 'aborted') return { ok: false, reason: 'aborted', message: 'the download was cancelled' }
      if (!got.ok) return { ok: false, reason: got.reason, message: got.message }

      // W3 — an entry created for this very check is already held by it.
      const entry = got.createdFor === token ? got.entry : (cache.acquire(key) ?? got.entry)
      await settleHash(entry)
      return { ok: true, key, entry, fetched: got.fetched ?? null }
    } finally {
      controllers.delete(controller)
    }
  }

  /** W4 — the held Check ends: the entry goes idle and is kept (A8). */
  function releaseTemplate(key) {
    return cache.release(key)
  }

  /**
   * V4/W3 — one fetch and one parse per template key, for a model load or for
   * the form's Check. Every node that asks while the job is in flight awaits the
   * same promise, so two nodes with one URL download once (and parse once,
   * through `templateFor`'s own map). `token` is `{ spec, worldBaseUrl, key }`;
   * `wanted()` answers whether the requester still wants the result.
   */
  function fetchAndParse(token, key, controller, wanted) {
    const { spec } = token
    return (async () => {
      const fetched = await fetchModel({
        url: spec.url, sha256: spec.sha256 ?? null, signal: controller.signal,
        worldBaseUrl: token.worldBaseUrl, ledger,
      })
      if (fetched.reason === 'aborted') return { ok: false, reason: 'aborted', message: 'cancelled' }
      if (!fetched.ok) return { ok: false, reason: fetched.reason, message: fetched.message }

      const got = await templateFor(key, token, fetched, wanted)
      if (!got.ok) return got

      // V4/W3 — when a redirect changed the URL the bytes came from, the
      // effective URL's key is an ALIAS of the one entry (one template, one byte
      // count, one dispose), not a second entry that would be evicted — and
      // disposed — on its own.
      const effective = templateKey(fetched.effectiveUrl ?? spec.url, spec.sha256 ?? null)
      if (effective !== key) cache.alias(effective, key)

      return { ok: true, entry: got.entry, createdFor: got.createdFor, fetched }
    })()
  }

  /** Everything after the entry exists: acquire it, build an instance, attach. */
  function useEntry(record, key, entry, adopted = false) {
    record.key = key
    // W3 — an entry created for THIS load is already acquired by it (see
    // `templateFor`), so the load adopts that reference instead of taking a
    // second one. Every other caller acquires.
    if (!adopted) cache.acquire(key)
    const held = cache.get(key) ?? entry
    const built = makeInstance(held.template)
    if (!stillWanted(record)) { cache.release(key); return drop(record) }
    record.wrapper?.parent?.remove(record.wrapper)
    record.wrapper = built.wrapper
    record.clips = built.clips
    record.droppedTracks = built.droppedTracks
    setStatus(record, MODEL_STATUS.loaded, null, built.droppedTracks
      ? `${built.droppedTracks} animation tracks couldn't be bound` : null)
    settle(record)
    attachOrWait(record)
  }

  /**
   * Z3/A8/A10 — the template for `key`, parsed once: two nodes with one URL
   * share one parse, and the texture reservation is taken before the parse
   * (A5), in `allNodes` order. W3: the entry is created ACQUIRED by the load
   * that parsed it, and that load is named in the answer (`createdFor`).
   */
  function templateFor(key, token, fetched, wanted) {
    const existing = cache.get(key)
    if (existing) return Promise.resolve({ ok: true, entry: existing })

    const inFlight = parses.get(key)
    if (inFlight) return inFlight

    const promise = (async () => {
      // W5 (round 5) — the reservation waits its turn: every model node before
      // this one in the current `som.allNodes` order must have been admitted,
      // failed or dropped first, so the same models win on every visitor's
      // screen. The fetch already ran in parallel; only the parse is ordered.
      // A Check (`token` has no node) goes after every model node loading.
      const allowed = token.node
        ? await waitForEarlier(token, wanted)
        : await waitForLoading(wanted)
      if (!allowed) return { ok: false, reason: 'aborted', message: 'cancelled' }

      return serialize(async () => {
        const again = cache.get(key)
        if (again) return { ok: true, entry: again }
        if (!wanted()) return { ok: false, reason: 'aborted', message: 'cancelled' }

        const parsed = await parse({
          kind: fetched.kind, bytes: fetched.bytes, json: fetched.json,
          dependencies: fetched.dependencies ?? new Map(),
          reserveTexture, releaseTexture,
        })
        if (!parsed.ok) return { ok: false, reason: parsed.reason, message: parsed.message }

        const textureBytes = parsed.textureBytes ?? 0
        // W3 — the world may have moved on while the parse ran (a world change, the
        // node removed, the form closed): give the reservation back rather than
        // charging a world that no longer wants the template.
        if (!wanted()) {
          releaseTexture?.(textureBytes)
          return { ok: false, reason: 'aborted', message: 'cancelled' }
        }

        // W3 — the entry is created already acquired by the load that parsed it
        // (`refs: 1`, not idle) INSIDE the serialized parse. Round 3 created it
        // idle and the load acquired it a microtask later, so the next model's
        // `reserveTexture` → `evictIdleFor` could dispose a template that was
        // about to be, or already was, on screen.
        const entry = cache.set(key, { ...parsed.template, textureBytes }, { acquired: true })
        // V4/W4 — what the form's Check reads back off a held entry: the kind, the
        // bytes it came from, and (a .glb's) hash, the one Save pins with. The
        // digest runs OFF the model-load critical path — a placed model must not
        // wait a thread-pool turn for it — and `loadTemplate` awaits it for the
        // Check, which is the only caller that reports a hash.
        entry.kind = fetched.kind
        entry.totalBytes = fetched.totalBytes ?? 0
        entry.bytesSha256 = null
        if (fetched.kind === 'glb' && fetched.bytes) {
          entry.bytesSha256Promise = sha256Hex(fetched.bytes)
            .then((hex) => { entry.bytesSha256 = hex; return hex })
            .catch(() => null)
        }
        token.key = key
        return { ok: true, entry, createdFor: token }
      })
    })()
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
    settle(record)
  }

  function fail(record, reason, message) {
    removeWrapper(record)
    if (record.key) { cache.release(record.key); record.key = null }
    setStatus(record, MODEL_STATUS.failed, reason, message)
    showPlaceholder(record)
    settle(record)
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
        settled: false,
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
    settle(record)
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
    /** W4 — the one load entry point and the pair that gives the reference back. */
    loadTemplate,
    releaseTemplate,
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

/**
 * W4 — the bytes' hash a Check reports (`entry.bytesSha256`), awaited only where
 * it is used: the digest is started when the entry is created and settled here,
 * off the model-load path (see `templateFor`).
 */
async function settleHash(entry) {
  if (entry?.bytesSha256Promise) {
    try { entry.bytesSha256 = await entry.bytesSha256Promise } catch { entry.bytesSha256 = null }
  }
  return entry?.bytesSha256 ?? null
}

/** The key an instance's spec is compared by (A9's "spec unchanged"). */
export function specKey(spec) {
  return `${spec.url}\u0000${spec.sha256 ?? ''}\u0000${(spec.bounds ?? []).join(',')}`
}

/**
 * V4 (round 2) — the key a stored spec's template lives under: the spec URL
 * resolved against the world's base (A1/A13) plus the pinned hash — never the
 * URL a redirect ended at. The bridge keys its cache, its in-flight loads and
 * the instance's `record.key` by this, and `app.js`'s held Check seeds its
 * template under the same key, so Save costs no fetch.
 *
 * @param {{url: string, sha256?: string|null}} spec
 * @param {string|null} [worldBaseUrl]
 * @returns {string}
 */
export function specTemplateKey(spec, worldBaseUrl = null) {
  const url = spec?.url
  const resolved = resolveModelUrl(url, worldBaseUrl)
  return templateKey(resolved.ok ? resolved.url : url, spec?.sha256 ?? null)
}
