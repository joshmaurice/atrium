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

import { MODEL_LIMITS, createWorldLedger, sha256Hex, createJobDeadline, createSharedTasks, createTransferLimiter } from '@atrium/client/model-fetch'
import { validateModelHost as defaultValidateModelHost, resolveModelUrl } from '@atrium/client/model-spec'
import { templateKey, createTemplateCache, createTextureBudget, disposeTemplate, parseTemplate } from './model-parse.js'
import { buildInstance, buildPlaceholder, disposeInstance, PLACEHOLDER_COLOURS } from './model-instances.js'

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
  const cache = hooks.cache ?? createTemplateCache()
  // M3 (round 6) — one deadline per job. The seam exists so a test can drive a
  // controlled clock (the deadline counts WORK, not waiting).
  const newDeadline = hooks.newDeadline ?? (() => createJobDeadline())
  // M4 (round 6) — each world GENERATION has its own texture-budget object, and
  // every reservation and release captures the budget of the generation it
  // started in. Round 5 reset one object in place, so a parse from the old world
  // that finished later released its bytes against the NEW world's total (the
  // outside reviewer reproduced it: old reservation 64, new world 100, 36 after
  // the late parse) and never disposed its template.
  let textureBudget = hooks.textureBudget ?? createTextureBudget()

  let worldGeneration = 1
  let viewGeneration = 1
  let currentView = null
  const instances = new Map()      // node name → instance record
  // L3a (this round) — ONE task per template key, shared by its REQUESTER SET
  // through `createSharedTasks`. Round 6 built the one shared job from its first
  // requester (that requester's `controller` and `wanted()`), so removing the
  // first node aborted a fetch every other node was still waiting for: the
  // others ended `loading`/`aborted` with no placeholder and no model until a
  // world change. A new world generation gets a new helper; the old generation's
  // tasks are abandoned by their requesters' aborts and cannot be joined again.
  let loads = createSharedTasks()
  // L4a — ONE transfer limiter per PAGE: it outlives world changes (only the
  // signals it queued for change), and it counts HTTP TRANSFERS, not jobs: a
  // Check waits for a slot exactly as a model does, and a model waiting to be
  // admitted or parsed holds none.
  const limiter = hooks.limiter ?? createTransferLimiter({ concurrent: MODEL_LIMITS.concurrent })
  // L4a — the in-flight dependency transfers, shared across the world's jobs. A
  // world generation gets a new one, as its `loads` does.
  let sharedTransfers = hooks.sharedTransfers ?? createSharedTasks()
  // L3a — which MODEL records are waiting on each key's task. W5's admission
  // turn is measured from the EARLIEST remaining requester here, and a join or a
  // leave wakes every admission waiter so the turn is recomputed.
  const waiting = new Map()        // template key → Set<record>
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

  // ── L3a: the job's admission turn ────────────────────────────────────────

  /** A model record joined the job for `key`: membership changed, so re-evaluate. */
  function joinWaiting(key, record) {
    let set = waiting.get(key)
    if (!set) { set = new Set(); waiting.set(key, set) }
    set.add(record)
    notifyAdmission()
  }

  /** A requester left the job for `key` (settled, dropped, removed, aborted). */
  function leaveWaiting(key, record) {
    const set = waiting.get(key)
    if (!set) return
    if (!set.delete(record)) return
    if (set.size === 0) waiting.delete(key)
    notifyAdmission()
  }

  /**
   * L3a — does ANY remaining requester still want the job's result? A model
   * record wants it while its node is in the SOM with an unchanged spec (A9); a
   * Check (a token with no `node`) wants it until its own signal aborts. This is
   * what stops a node that left the SOM — with or without a reconcile — from
   * holding the job's turn and its temporary status forever.
   */
  function anyRequesterWants(key) {
    const set = waiting.get(key)
    if (!set || set.size === 0) return false
    for (const requester of set) {
      if (!requester.node) return true
      if (stillWanted(requester)) return true
    }
    return false
  }

  /**
   * The EARLIEST remaining requester of `key` in the current `som.allNodes`
   * order — the node whose turn the job's one parse takes. `null` when only
   * Checks (or no requester at all) remain: then the job waits for the nodes
   * loading at that moment instead.
   */
  function earliestRequester(key) {
    const set = waiting.get(key)
    if (!set || set.size === 0) return null
    const order = som()?.allNodes
    if (!order) return null
    let earliest = null
    let earliestAt = Infinity
    for (const record of set) {
      const at = order.indexOf(record.node)
      if (at < 0) continue
      if (at < earliestAt) { earliestAt = at; earliest = record }
    }
    return earliest
  }

  /**
   * W5 (as amended by L3a) — the job's turn at reserving texture bytes. The turn
   * belongs to the job, measured from its earliest REMAINING requester, and is
   * re-evaluated on every membership change: a job that becomes Check-only takes
   * `waitForLoading`'s snapshot at that moment (bounded by what is loading then)
   * and never keeps a departed node's turn.
   */
  async function waitForJobTurn(key, wanted) {
    let snapshot = null
    for (;;) {
      if (!wanted()) return false
      const earliest = earliestRequester(key)
      if (earliest) {
        snapshot = null
        if (earlierPending(earliest).length === 0) return true
      } else {
        // Check-only: the set loading when the job's turn became the Checks'.
        if (!snapshot) snapshot = [...instances.values()].filter((record) => !record.settled)
        if (!snapshot.some((record) => !record.settled)) return true
      }
      await admissionChanged()
    }
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

  /**
   * Z4 — a record holds at most ONE visual, a placeholder or an instance, and
   * this is the one place that takes it away: detached AND disposed. Round 6
   * dropped the wrapper and left the geometry, the material and (for a skinned
   * model) the cloned skeleton's bone texture on the GPU for the life of the
   * page.
   *
   * A placeholder's geometry and material belong to it alone, so both are
   * disposed. An instance goes through `disposeInstance`, which frees its own
   * skeleton and clips and NEVER touches the template's geometries, materials or
   * textures (A9) — those are shared with every other instance.
   *
   * NOT called from `detachView`: a view change KEEPS the wrappers so they can be
   * re-attached without a fetch (A9).
   */
  function clearVisual(record) {
    if (!record) return
    if (record.placeholder) {
      const placeholder = record.placeholder
      placeholder.wrapper?.parent?.remove(placeholder.wrapper)
      placeholder.box?.geometry?.dispose?.()
      placeholder.box?.material?.dispose?.()
      record.placeholder = null
    }
    if (record.instance) {
      disposeInstance(record.instance, { removeFromHost: true })
      record.instance = null
      record.clips = []
    }
    if (record.wrapper) detachWrapper(record)
    record.wrapper = null
  }

  // ── the world (A9) ─────────────────────────────────────────────────────

  /** Abort everything, drop the ledger, dispose every template and instance. */
  function resetWorld() {
    worldGeneration += 1
    // L3a — every requester's OWN controller aborts: each join resolves
    // `aborted`, and the shared task's controller aborts when its LAST requester
    // leaves, so no fetch outlives the world that asked for it.
    for (const record of instances.values()) record.controller?.abort('world-change')
    for (const controller of controllers) controller.abort('world-change')
    controllers.clear()
    waiting.clear()
    // A new generation gets new helpers: no later join can reach an old task,
    // and no transfer of the old world can be joined by the new one.
    loads = createSharedTasks()
    sharedTransfers = createSharedTasks()
    ledger.reset()
    for (const record of instances.values()) { settle(record); clearVisual(record) }
    instances.clear()
    // M4 — the new generation gets a budget OBJECT of its own, so a reservation
    // taken by the old world (and released by a parse that finishes late) can
    // never lower this one's total.
    textureBudget = createTextureBudget({ bytes: textureBudget.limit })
    cache.clear((template) => dispose(template))
    notifyAdmission()
  }

  /**
   * L4a — the bridge no longer caps JOBS. Round 6 ran four loads at a time and
   * let a Check run outside that cap, so four jobs could hold eight HTTP
   * transfers while a Check held none at all. There is ONE transfer limiter per
   * page now; every load starts here, in `som.allNodes` order, so its first
   * transfer queues in that order (A10).
   */
  function start(record) {
    load(record).catch(() => {})
  }

  /**
   * L4a — the priority a job's transfers queue with: the `som.allNodes` index of
   * its EARLIEST requester when it asks. A Check's is after every model node.
   */
  function jobPriority(key) {
    const set = waiting.get(key)
    const order = som()?.allNodes
    let best = null
    if (set && order) {
      for (const requester of set) {
        if (!requester.node) continue
        const at = order.indexOf(requester.node)
        if (at >= 0 && (best === null || at < best)) best = at
      }
    }
    if (best !== null) return best
    return (order?.length ?? 0) + 1
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
    // L3a — each record has its OWN controller. Removing this node, a spec change
    // and a world change abort THIS requester and no one else; the shared task is
    // aborted only when its last requester leaves.
    const controller = new AbortController()
    record.controller = controller
    controllers.add(controller)
    const key = keyFor(record)
    try {
      // V4 — the cache and the in-flight loads are consulted BEFORE the fetch,
      // under the key the spec determines. Round 1 fetched first and keyed the
      // cache on the fetched `effectiveUrl` only afterwards, so a Duplicate, a
      // Redo or a Save after a held Check downloaded the same bytes again — a
      // repeat charged to the world's ledger, which never refunds.
      const cached = cache.get(key)
      if (cached) {
        if (!stillWanted(record)) return drop(record)
        return useEntry(record, key, cached)
      }

      const token = { spec: record.spec, worldBaseUrl: record.worldBaseUrl, key: null }
      joinWaiting(key, record)
      const got = await loads.join(key, (taskSignal) => fetchAndParse(key, taskSignal, token), controller.signal)
      if (got.reason === 'aborted') return drop(record)
      if (!got.ok) return fail(record, got.reason, got.message)
      if (!stillWanted(record)) return drop(record)

      return useEntry(record, key, got.entry, got)
    } catch (error) {
      // W5 — every node must end in a status: a later node's turn waits on this
      // one, so a thrown fetch or parse has to settle it, not leave it loading.
      fail(record, 'network', error?.message ?? 'the model could not be loaded')
      return undefined
    } finally {
      leaveWaiting(key, record)
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
  async function loadTemplate({ url, sha256 = null, signal = null } = {}) {
    const token = { spec: { url, sha256 }, worldBaseUrl: deps.worldBaseUrl?.() ?? null, key: null }
    const key = specTemplateKey(token.spec, token.worldBaseUrl)

    const cached = cache.get(key)
    if (cached) {
      const held = cache.acquire(key) ?? cached
      await settleHash(held)
      return { ok: true, key, entry: held, fetched: null }
    }

    // Z2/Z5 — the Check's OWN controller: a world change aborts it, and so does
    // the caller's own signal (`app.js`'s `endCheck`). The join's signal is this
    // controller, never the shared task's: ending one Check leaves the nodes'
    // task and every other requester alone.
    const controller = new AbortController()
    controllers.add(controller)
    const onExternalAbort = () => controller.abort('external')
    if (signal) {
      if (signal.aborted) controller.abort('external')
      else signal.addEventListener?.('abort', onExternalAbort)
    }
    try {
      // L3a — the Check is a requester of the job too: it joins the set before
      // the task starts, so `wanted()` is answered by the whole set.
      joinWaiting(key, token)
      const got = await loads.join(key, (taskSignal) => fetchAndParse(key, taskSignal, token), controller.signal)
      if (got.reason === 'aborted') return { ok: false, reason: 'aborted', message: 'the download was cancelled' }
      if (!got.ok) return { ok: false, reason: got.reason, message: got.message }

      // W3/L3a — the entry the job's own parse created is handed to its FIRST
      // remaining requester; everyone else acquires a reference of their own.
      const entry = takeReference(key, got) ?? got.entry
      await settleHash(entry)
      return { ok: true, key, entry, fetched: got.fetched ?? null }
    } finally {
      leaveWaiting(key, token)
      signal?.removeEventListener?.('abort', onExternalAbort)
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
  function fetchAndParse(key, taskSignal, token) {
    const { spec } = token
    // M3 (round 6) — ONE deadline per job, set at its first request. Round 5's
    // fetcher timer stopped when `fetchModel` returned and `parseTemplate`
    // started a second 30 s, so one model could spend about 60 s of its own
    // work; a job past its deadline is `timeout`, and a parse that outlives it
    // is disposed when it settles.
    const deadline = newDeadline()
    // L3a — the job's own state. The deadline, the entry it creates and the one
    // reference that entry carries all belong to the TASK, not to any requester.
    const job = { key, created: false, handedOver: false, released: false, generation: worldGeneration }
    // `wanted()` asks about the requester SET: `taskSignal` aborts when the last
    // requester leaves, `job.generation` names the world that asked, and the set
    // itself is consulted so a requester that stopped wanting the result (its
    // node left the SOM) no longer holds the job's turn.
    const wanted = () => !taskSignal.aborted && job.generation === worldGeneration && anyRequesterWants(key)
    // The parse's one reference belongs to the job until a requester takes it; a
    // job abandoned first gives it back exactly once (the guard does that).
    taskSignal.addEventListener('abort', () => releaseJobReference(job))
    return (async () => {
      const fetched = await fetchModel({
        url: spec.url, sha256: spec.sha256 ?? null, signal: taskSignal,
        worldBaseUrl: token.worldBaseUrl, ledger, deadline,
        // L4a — one limiter per page (loads and Checks alike) and the world's one
        // set of shared dependency transfers.
        limiter, priority: jobPriority(key), sharedTransfers,
      })
      if (fetched.reason === 'aborted') return { ok: false, reason: 'aborted', message: 'cancelled' }
      if (!fetched.ok) return { ok: false, reason: fetched.reason, message: fetched.message }

      const got = await parseForJob(key, job, token, fetched, wanted, deadline)
      if (!got.ok) return got

      // V4/W3 — when a redirect changed the URL the bytes came from, the
      // effective URL's key is an ALIAS of the one entry (one template, one byte
      // count, one dispose), not a second entry that would be evicted — and
      // disposed — on its own.
      const effective = templateKey(fetched.effectiveUrl ?? spec.url, spec.sha256 ?? null)
      if (effective !== key) cache.alias(effective, key)

      return { ok: true, entry: got.entry, created: got.created, job, fetched }
    })()
  }

  /** L3a — the one reference a parse created goes back exactly once. */
  function releaseJobReference(job) {
    if (!job.created || job.handedOver || job.released) return
    job.released = true
    cache.release(job.key)
  }

  /**
   * L3a — take this requester's reference to the entry. The entry the job's OWN
   * parse created (`acquired: true`, W3) is handed to its FIRST remaining
   * requester and never to a second one; every other requester acquires its own.
   * A task that found the entry already in the cache has nothing to hand over.
   */
  function takeReference(key, got) {
    if (got.created && got.job && !got.job.handedOver) {
      got.job.handedOver = true
      return got.entry
    }
    return cache.acquire(key)
  }

  /** Everything after the entry exists: acquire it, build an instance, attach. */
  function useEntry(record, key, entry, got = null) {
    record.key = key
    // W3/L3a — the ONE reference the job's own parse created is adopted by its
    // first remaining requester (see `takeReference`); every other caller
    // acquires a reference of its own.
    takeReference(key, got ?? {})
    const held = cache.get(key) ?? entry
    const built = makeInstance(held.template)
    if (!stillWanted(record)) {
      // Give the reference back, and forget it: `drop` must not release the same
      // reference a second time (round 6's latent double release).
      cache.release(key)
      record.key = null
      return drop(record)
    }
    // Z4 — the placeholder (or a previous instance) is detached AND disposed
    // before the new one goes in.
    clearVisual(record)
    record.instance = built
    record.wrapper = built.wrapper
    record.clips = built.clips
    record.droppedTracks = built.droppedTracks
    setStatus(record, MODEL_STATUS.loaded, null, built.droppedTracks
      ? `${built.droppedTracks} animation tracks couldn't be bound` : null)
    settle(record)
    attachOrWait(record)
  }

  /**
   * Z3/A8/A10 — the template for `key`, parsed once per TASK: every requester of
   * the key's task shares this one parse, and the texture reservation is taken
   * before the parse (A5), at the turn of the job's earliest remaining requester.
   * W3/L3a: the entry is created ACQUIRED by the job that parsed it, and the job
   * hands that one reference to its first remaining requester.
   *
   * There is no per-key `parses` map any more (L3a): one task per key makes it
   * redundant, and a map would hand a NEW task the abandoned task's parse — the
   * re-added node would then end `loading`/`aborted`, which the invariant below
   * forbids.
   */
  function parseForJob(key, job, token, fetched, wanted, deadline = null) {
    const existing = cache.get(key)
    if (existing) return Promise.resolve({ ok: true, entry: existing, created: false })

    return (async () => {
      // W5 (round 5) — the reservation waits its turn: every model node before
      // the job's EARLIEST remaining requester in the current `som.allNodes`
      // order must have been admitted, failed or dropped first, so the same
      // models win on every visitor's screen. The fetch already ran in parallel;
      // only the parse is ordered. A job with no node requester left (Checks
      // only) goes after every model node loading at that moment.
      //
      // M3 — waiting does not count against the job's deadline: the clock stops
      // for the admission wait and for the serialized parse queue, and starts
      // again when the turn comes. Those waits are bounded because each earlier
      // job has a deadline of its own.
      deadline?.pause()
      const allowed = await waitForJobTurn(key, wanted)
      if (!allowed) return { ok: false, reason: 'aborted', message: 'cancelled' }

      return serialize(async () => {
        deadline?.resume()
        // M4 — the budget of THIS generation, captured before the parse starts.
        const budget = textureBudget
        const again = cache.get(key)
        if (again) return { ok: true, entry: again, created: false }
        if (!wanted()) return { ok: false, reason: 'aborted', message: 'cancelled' }

        const parsed = await parse({
          kind: fetched.kind, bytes: fetched.bytes, json: fetched.json,
          dependencies: fetched.dependencies ?? new Map(),
          // M4 — the reservation pair names the budget of THIS generation: a
          // release from a parse that outlives a world change is a no-op for the
          // new world rather than a subtraction from it.
          reserveTexture: (bytes) => reserveInto(budget, bytes),
          releaseTexture: (bytes) => budget.release(bytes),
          deadline,
        })
        if (!parsed.ok) return { ok: false, reason: parsed.reason, message: parsed.message }

        const textureBytes = parsed.textureBytes ?? 0
        // W3 — the world may have moved on while the parse ran (a world change, the
        // node removed, the form closed, the job abandoned): give the reservation
        // back rather than charging a world that no longer wants the template, and
        // M4 — dispose the template the old world's parse made, exactly once.
        if (!wanted()) {
          dispose(parsed.template)
          budget.release(textureBytes)
          return { ok: false, reason: 'aborted', message: 'cancelled' }
        }

        // W3 — the entry is created already acquired by the job that parsed it
        // (`refs: 1`, not idle) INSIDE the serialized parse. Round 3 created it
        // idle and the load acquired it a microtask later, so the next model's
        // `reserveTexture` → `evictIdleFor` could dispose a template that was
        // about to be, or already was, on screen.
        const entry = cache.set(key, { ...parsed.template, textureBytes }, { acquired: true })
        job.created = true
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
        return { ok: true, entry, created: true }
      })
    })()
  }

  /** A5/A8/M4 — reserve from `budget` (the generation the caller named), evicting
 *  that budget's idle templates least-recently-used first. */
  function reserveInto(budget, bytes) {
    if (!budget.fits(bytes)) cache.evictIdleFor(bytes, budget, dispose)
    return budget.reserve(bytes)
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
    clearVisual(record)
    if (record.key) { cache.release(record.key); record.key = null }
    setStatus(record, MODEL_STATUS.loading, 'aborted', null)
    settle(record)
  }

  function fail(record, reason, message) {
    clearVisual(record)
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
    const built = makePlaceholder(record.spec?.bounds ?? null)
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
      const validated = validateHost ? validateHost(node) : null
      // Z5 — a node that carries no model is not a model node: it is skipped.
      if (!validated) continue
      if (validated.ok && !validated.spec) continue
      // S7 (round 6) — a node that DOES declare a model the spec rejects used to
      // be skipped exactly like a node with no model: the node kept its mesh and
      // the owner saw nothing at all. It gets a failed placeholder with
      // `bad-spec` instead, and nothing is fetched (A6).
      const spec = validated.ok ? validated.spec : null
      const key = spec ? specKey(spec) : BAD_SPEC_KEY
      live.add(node.name)
      const existing = instances.get(node.name)
      if (existing && existing.specKey === key) { admitted += 1; continue }
      if (existing) removeInstance(node.name)
      if (admitted >= MODEL_INSTANCE_LIMIT) continue
      admitted += 1
      const record = {
        node, spec, specKey: key, status: null, reason: null, message: null,
        wrapper: null, placeholder: null, instance: null, clips: [], droppedTracks: 0, key: null,
        worldGeneration, viewGeneration: null, attachedGeneration: null,
        worldBaseUrl: deps.worldBaseUrl?.() ?? null,
        // L3a — this node's OWN requester controller, made when its load starts.
        controller: null,
        settled: false,
      }
      instances.set(node.name, record)
      if (validated.ok) {
        setStatus(record, MODEL_STATUS.loading)
        showPlaceholder(record)
        start(record)
      } else {
        // A bad spec never loads: it is terminal at once, so it cannot hold up
        // the model nodes behind it in `allNodes` order (W5).
        setStatus(record, MODEL_STATUS.failed, 'bad-spec', validated.message)
        showPlaceholder(record)
        settle(record)
      }
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
    // Z4 — the visual goes with the record: detached and disposed.
    clearVisual(record)
    // L3a — this requester leaves the job: its own controller aborts, so its join
    // resolves `aborted` at once. The other requesters of the same key are
    // untouched, and the shared task is aborted only when the LAST one leaves.
    record.controller?.abort('removed')
    if (record.key) { cache.release(record.key); record.key = null }
    instances.delete(name)
    settle(record)
  }

  /** Z5 — a status change for one node, for the panel. */
  function status(name) {
    const record = instances.get(name)
    return record ? statusOf(record) : null
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
    /** L4a — the page's ONE transfer limiter, and the world's shared transfers. */
    limiter,
    get sharedTransfers() { return sharedTransfers; },
    /** M4 — the CURRENT generation's budget (a new object after a world change). */
    get textureBudget() { return textureBudget },
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

/** S7 — the key a node whose model spec was REJECTED is remembered under. */
const BAD_SPEC_KEY = '\u0000bad-spec'

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
