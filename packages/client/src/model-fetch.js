// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * model-fetch.js — fetching a model and its dependencies under the limits
 * (Phase 3 step 3a, Z2 as amended by A2/A3/A4/A13). Renderer-neutral: no three,
 * no DOM. `fetch` is injectable, so the whole module is testable in Node.
 *
 * What this module owns:
 *   - A2's request policy, on EVERY request: credentials are never sent and
 *     the referring page is not sent; redirects are followed and the final URL
 *     is checked before the body is read;
 *   - A4's one world transfer ledger, charged as each chunk arrives;
 *   - the 25 MiB per-model budget (file plus dependencies) and the 30 s timer,
 *     which covers the whole job;
 *   - the format sniffed from content (the `glTF` magic), never the extension;
 *   - a `.gltf`'s buffers and images, resolved against the file's final URL,
 *     validated with A1, deduplicated by canonical href and fetched once each;
 *   - the refusal of Draco / meshopt / KTX2 before parsing (L7).
 *
 * The bytes go back to the caller; turning a `.gltf`'s URIs into `blob:` URLs
 * and revoking them is the parser's job (model-parse.js), because only a
 * browser can create object URLs.
 */

import { modelUrlProblem, resolveModelUrl, isRootRelative } from './model-spec.js'

/** L8's numbers, in bytes and milliseconds (A12: MB means MiB). */
export const MODEL_LIMITS = Object.freeze({
  modelBytes: 25 * 1024 * 1024,
  worldBytes: 150 * 1024 * 1024,
  timeoutMs: 30_000,
  concurrent: 4,
})

/** A2 — the exact request policy. Every request uses all six. */
export const FETCH_OPTIONS = Object.freeze({
  method: 'GET',
  mode: 'cors',
  credentials: 'omit',
  referrerPolicy: 'no-referrer',
  redirect: 'follow',
})

/** The compressed glTF extensions refused in 3a (L7). */
export const UNSUPPORTED_EXTENSIONS = Object.freeze({
  KHR_draco_mesh_compression: 'Draco compression',
  EXT_meshopt_compression: 'meshopt compression',
  KHR_texture_basisu: 'KTX2 textures',
})

/** The reason codes and their plain text (Z2, A13). */
export const FETCH_REASONS = Object.freeze({
  'bad-spec':              'the model URL is not valid',
  'no-base':               'this world has no address to resolve a /path against',
  'http':                  'the server refused the request',
  'network':               'the file could not be reached (offline, or the host does not allow this page to read it)',
  'too-large':             'the model is larger than the limit',
  'timeout':               'the model took too long to download',
  'hash-mismatch':         'the file does not match the pinned version',
  'pin-needs-glb':         'only a single-file .glb can be pinned',
  'unsupported':           'the model uses a feature Atrium does not load yet',
  'parse':                 'the file is not a glTF model',
  'redirect':              'the download was redirected somewhere it may not go',
  'bad-dependency':        'the model asks for a file on another host',
  'unexpected-request':    'the model asked for a file it did not declare',
  'aborted':               'the download was cancelled',
  'world-download-budget': 'this world has downloaded its limit of model data',
  'bad-hash':              'the pinned version could not be checked',
})

/** A refusal with its code; `aborted` is the quiet case (Z2). */
function failure(reason, detail) {
  const base = FETCH_REASONS[reason] ?? 'the model could not be loaded'
  return { ok: false, reason, message: detail ? `${base} (${detail})` : base }
}

/** Plain text for a reason code. */
export function fetchReasonText(reason, detail) {
  const base = FETCH_REASONS[reason] ?? 'the model could not be loaded'
  return detail ? `${base} (${detail})` : base
}

/**
 * A4 — one running total per world generation. Charged as each chunk arrives,
 * never refunded, including for downloads that later fail or are aborted.
 *
 * @param {{worldBytes?: number}} [opts]
 */
export function createWorldLedger({ worldBytes = MODEL_LIMITS.worldBytes } = {}) {
  let charged = 0
  const controllers = new Set()
  return {
    limit: worldBytes,
    get charged() { return charged },
    get over() { return charged > worldBytes },
    /**
     * Lend the ledger a request's controller, so crossing the limit aborts
     * every in-flight request. Returns the release.
     */
    registerController(controller) {
      controllers.add(controller)
      return () => controllers.delete(controller)
    },
    /** Charge `bytes`; true once the world is over its limit. */
    charge(bytes) {
      charged += bytes
      if (charged > worldBytes) {
        for (const controller of controllers) controller.abort('over-budget')
        controllers.clear()
      }
      return charged > worldBytes
    },
    reset() { charged = 0 },
  }
}

/** A sentinel reason for our own timer, told apart from an external abort. */
const TIMEOUT = Symbol('timeout')

/**
 * L3a — one task per key, shared by every requester, with a lifetime that
 * belongs to the requester SET rather than to whoever asked first.
 *
 * Round 6 built the one shared job from its first requester: that requester's
 * `controller` and `wanted()`. Removing the first node therefore aborted a
 * fetch every other node was still waiting for, and every other node ended
 * `loading`/`aborted` with no placeholder and no model until a world change.
 *
 * The contract:
 *   - `join(key, start, signal)` returns this requester's promise of the task's
 *     result; `start(taskSignal)` runs ONCE per key while the task is live.
 *   - a requester whose `signal` aborts gets `{ ok: false, reason: 'aborted' }`
 *     at once; the others are untouched;
 *   - a task is `live` while it has at least one requester and has not settled;
 *     when its LAST requester leaves it is `abandoned` at once — it leaves the
 *     map, its controller aborts, and nobody can join it again;
 *   - a join after that starts a NEW task with a new identity, even while the
 *     old one is still settling. An old task's settle removes only its own
 *     entry, never a newer task under the same key.
 */
export function createSharedTasks() {
  const tasks = new Map()
  const noop = () => {}

  /** One requester's promise, settled exactly once. */
  function request(task, key, signal) {
    const requester = { done: false, resolve: null }
    const promise = new Promise((resolve) => { requester.resolve = resolve })
    const finish = (result) => {
      if (requester.done) return
      requester.done = true
      task.requesters.delete(requester)
      signal?.removeEventListener?.('abort', onAbort)
      requester.resolve(result)
    }
    const onAbort = () => {
      finish({ ok: false, reason: 'aborted' })
      // The last requester left before the task settled: the task is abandoned
      // AT ONCE — it leaves the map and its controller aborts. The abort is
      // what stops the work the other requesters gave up on.
      if (task.requesters.size === 0 && !task.settled) {
        if (tasks.get(key) === task) tasks.delete(key)
        try { task.controller.abort('abandoned') } catch { /* already aborted */ }
      }
    }
    task.requesters.add(requester)
    if (signal) signal.addEventListener?.('abort', onAbort)
    task.result.then(finish, finish)
    return promise
  }

  return {
    /**
     * @param {string} key
     * @param {(signal: AbortSignal) => Promise<any>} start  runs once per key
     * @param {AbortSignal|null} [signal]  this requester's own signal
     */
    join(key, start, signal = null) {
      if (signal?.aborted) return Promise.resolve({ ok: false, reason: 'aborted' })
      let task = tasks.get(key)
      if (!task) {
        const controller = new AbortController()
        task = { key, controller, requesters: new Set(), settled: false }
        // The task is in the map BEFORE `start` runs, so a helper that hangs
        // per-task state off it — a shared transfer's consumer bag (R8) — can
        // reach the task from inside its own `start` and from a late joiner.
        tasks.set(key, task)
        task.result = (async () => {
          // Abandoned before the first microtask ran: never start the work.
          if (controller.signal.aborted) return { ok: false, reason: 'aborted' }
          try {
            return await start(controller.signal)
          } catch (error) {
            return { ok: false, reason: 'network', message: error?.message ?? 'the download failed' }
          }
        })()
        task.result.then(noop, noop).finally(() => {
          task.settled = true
          // Only THIS task's entry, never a newer task under the same key.
          if (tasks.get(key) === task) tasks.delete(key)
        })
      }
      return request(task, key, signal)
    },
    has: (key) => tasks.has(key),
    /** The live task for `key`, or null — for state hung off the task itself. */
    taskFor: (key) => tasks.get(key) ?? null,
    get size() { return tasks.size },
  }
}

/**
 * L4a — one transfer limiter per page: at most `concurrent` HTTP requests at a
 * time, across every model AND every Check. Round 6 capped JOBS, so four jobs
 * could hold eight transfers and a Check held none at all.
 *
 * Order: lowest `priority` first, then first-come. The job's priority is the
 * `som.allNodes` index of its earliest requester; a Check's is after every node.
 *
 * `acquire(signal, priority)` resolves to an idempotent `release`. A waiter
 * whose signal aborts (or whose job the world's ledger aborts) leaves the queue
 * and is handed a no-op release, so its caller can see the aborted signal and
 * stop; a caller that has already been granted a slot must hold the release in
 * a `try/finally` from the moment of the grant.
 */
export function createTransferLimiter({ concurrent = MODEL_LIMITS.concurrent } = {}) {
  let active = 0
  let order = 0
  const queue = []

  function pump() {
    while (active < concurrent && queue.length > 0) {
      const waiter = queue.shift()
      if (waiter.done) continue
      active += 1
      waiter.settle(grant(waiter))
    }
  }

  /** Hand a waiter its slot: an idempotent release, held once. */
  function grant(waiter) {
    waiter.done = true
    waiter.signal?.removeEventListener?.('abort', waiter.onAbort)
    let released = false
    return () => {
      if (released) return
      released = true
      active -= 1
      pump()
    }
  }

  return {
    get active() { return active },
    get queued() { return queue.length },
    get limit() { return concurrent },
    acquire(signal = null, priority = 0) {
      return new Promise((resolve) => {
        const waiter = {
          priority, order: ++order, signal, done: false, settle: resolve, onAbort: null,
        }
        waiter.onAbort = () => {
          if (waiter.done) return
          waiter.done = true
          const at = queue.indexOf(waiter)
          if (at >= 0) queue.splice(at, 1)
          // No slot was ever held: hand back a release that does nothing, so the
          // caller is not left waiting and no slot is created or lost.
          resolve(() => {})
        }
        if (signal?.aborted) { waiter.onAbort(); return }
        signal?.addEventListener?.('abort', waiter.onAbort)
        // Lowest priority first, then first-come (equal priorities keep arrival order).
        let at = queue.length
        while (at > 0) {
          const other = queue[at - 1]
          if (other.priority < waiter.priority || (other.priority === waiter.priority && other.order < waiter.order)) break
          at -= 1
        }
        queue.splice(at, 0, waiter)
        pump()
      })
    },
  }
}

/**
 * M3 (round 6) — ONE deadline per job, set at its first request. The fetch, the
 * preflight and the parse all run against it, so a model's own work totals 30 s
 * (L8) rather than 30 s of download plus 30 s of parse.
 *
 * Time spent WAITING is excluded: `pause()` while a job waits for earlier
 * models' admission (W5) or for the serialized parse queue, `resume()` when the
 * stage it was waiting for starts. Those waits are bounded because each earlier
 * job has a deadline of its own.
 *
 * @param {{timeoutMs?: number, now?: () => number}} [opts]
 */
export function createJobDeadline({ timeoutMs = MODEL_LIMITS.timeoutMs, now = () => Date.now() } = {}) {
  let started = false
  let used = 0
  let runningSince = null
  const elapsedMs = () => used + (runningSince === null ? 0 : Math.max(0, now() - runningSince))
  return {
    get started() { return started },
    get timeoutMs() { return timeoutMs },
    get elapsedMs() { return elapsedMs() },
    /** The job's first request goes out: the clock runs from here. */
    start() { if (!started) { started = true; runningSince = now() } return this },
    /** The job is waiting: the clock stops. */
    pause() { if (runningSince !== null) { used = elapsedMs(); runningSince = null } return this },
    /** A stage is about to start: the clock runs again. */
    resume() { if (started && runningSince === null) { runningSince = now() } return this },
    remainingMs() { return Math.max(0, timeoutMs - elapsedMs()) },
    expired() { return started && timeoutMs - elapsedMs() <= 0 },
  }
}

/**
 * A2/L17 — the redirect rule. A followed redirect's final URL must pass A1's
 * absolute-`https` rule, and for a root-relative spec it must also stay on the
 * world's origin.
 *
 * @returns {string|null}  a reason code, or null when the hop is allowed
 */
export function redirectProblem(finalUrl, rootRelative, worldBaseUrl) {
  const problem = modelUrlProblem(finalUrl)
  if (problem || isRootRelative(finalUrl)) return 'redirect'
  if (rootRelative) {
    if (typeof worldBaseUrl !== 'string' || worldBaseUrl.length === 0) return 'redirect'
    try {
      if (new URL(finalUrl).origin !== new URL(worldBaseUrl).origin) return 'redirect'
    } catch {
      return 'redirect'
    }
  }
  return null
}

/**
 * A4/L4a — read a response's body in chunks, charging every budget in `budgets`
 * and the world ledger as they arrive. Content-Length is only used to refuse
 * early.
 *
 * `budgets` has ONE entry for a model's own transfer, and one per live consumer
 * for a SHARED transfer (Z3/L4a): every consumer's 25 MiB model budget is
 * charged per chunk as it arrives, so a consumer joining a transfer already
 * under way is charged for the bytes it missed, and a download only one model
 * wants stops at that model's 25 MiB plus one chunk — exactly as before.
 *
 * @param {(budget: object) => void} [onBudgetOver]  Z3 — a shared transfer names
 *   the consumer that went over and carries on for the others; without it (a
 *   model's own transfer) going over is `too-large` and the request is cancelled.
 */
async function readBody(response, { budgets, ledger, limits, signal, onBudgetOver = null, onChunk = null }) {
  // `budgets` may be a LIST (a model's own transfer) or a FUNCTION returning the
  // live list (a shared transfer's consumers, which change as they join).
  const live = () => (typeof budgets === 'function' ? budgets() : budgets)
  const declared = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(declared)) {
    const over = live().filter((budget) => budget.bytes + declared > limits.modelBytes)
    if (over.length > 0) {
      for (const budget of over) onBudgetOver?.(budget)
      if (!onBudgetOver) {
        try { await response.body?.cancel?.() } catch { /* ignore */ }
        return failure('too-large')
      }
    }
  }

  const reader = response.body?.getReader?.()
  const chunks = []
  let total = 0
  if (!reader) {
    // S5 (round 6) — the non-streaming path applies the limits too. Round 5
    // charged the budget and answered `ok` without checking the 25 MiB cap, the
    // world ledger or the abort signal, so a server that ignored the streaming
    // path could hand a visitor a body of any size.
    const buffer = await response.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    for (const budget of live()) budget.bytes += bytes.byteLength
    const worldOver = ledger ? ledger.charge(bytes.byteLength) : false
    onChunk?.(bytes.byteLength)
    if (signal?.aborted) return { aborted: true }
    const over = live().filter((budget) => budget.bytes > limits.modelBytes)
    if (over.length > 0) {
      for (const budget of over) onBudgetOver?.(budget)
      if (!onBudgetOver) return failure('too-large')
    }
    if (worldOver) return failure('world-download-budget')
    return { ok: true, bytes }
  }

  for (;;) {
    let step
    try {
      step = await reader.read()
    } catch {
      // A cancel from our own side (timeout, over-budget, world change) is
      // not a network fault; the caller names it.
      if (signal?.aborted) return { aborted: true }
      return failure('network')
    }
    if (step.done) break
    const chunk = step.value
    const length = chunk.byteLength ?? chunk.length ?? 0
    total += length
    for (const budget of live()) budget.bytes += length
    const worldOver = ledger ? ledger.charge(length) : false
    onChunk?.(length)
    // The model's budget is shared by the file and every dependency (Z2).
    const over = live().filter((budget) => budget.bytes > limits.modelBytes)
    if (over.length > 0) {
      for (const budget of over) onBudgetOver?.(budget)
      if (!onBudgetOver) {
        try { await reader.cancel() } catch { /* ignore */ }
        return failure('too-large')
      }
    }
    if (worldOver) {
      try { await reader.cancel() } catch { /* ignore */ }
      return failure('world-download-budget')
    }
    chunks.push(chunk)
  }

  const bytes = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    const view = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
    bytes.set(view, at)
    at += view.byteLength
  }
  return { ok: true, bytes }
}

/**
 * One request under A2, L17 and A4.
 *
 * @returns {Promise<{ok: true, bytes: Uint8Array, url: string} | {ok: false, reason: string, message: string}>}
 */
async function fetchOne(target, {
  fetchFn, signal, budgets, ledger, limits, rootRelative, worldBaseUrl, onBudgetOver = null, onChunk = null,
}) {
  let response
  try {
    response = await fetchFn(target, { ...FETCH_OPTIONS, signal })
  } catch {
    if (signal.aborted) return { aborted: true }
    return failure('network')
  }

  if (signal.aborted) {
    try { await response.body?.cancel?.() } catch { /* ignore */ }
    return { aborted: true }
  }

  // L17 — the redirect is checked before the body is read.
  const finalUrl = typeof response.url === 'string' && response.url.length > 0 ? response.url : target
  if (response.redirected) {
    const problem = redirectProblem(finalUrl, rootRelative, worldBaseUrl)
    if (problem) {
      try { await response.body?.cancel?.() } catch { /* ignore */ }
      return failure(problem, finalUrl)
    }
  }

  if (!response.ok) {
    try { await response.body?.cancel?.() } catch { /* ignore */ }
    return failure('http', String(response.status))
  }

  const body = await readBody(response, { budgets, ledger, limits, signal, onBudgetOver, onChunk })
  if (!body.ok) return body
  // M2 (round 6) — the validated FINAL url travels with the bytes. Round 5
  // checked `response.url` after a redirect and then dropped it: `readBody`
  // answered `{ ok, bytes }`, so `first.url` was always undefined and
  // `effectiveUrl` fell back to the pre-redirect URL — a redirected `.gltf`
  // resolved its dependencies against the wrong address.
  return { ...body, url: finalUrl }
}

/** The glTF magic, from content — never the extension (Z2). */
export function sniffFormat(bytes) {
  if (bytes.length >= 4 && bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46) {
    return 'glb'
  }
  let head = ''
  try { head = new TextDecoder().decode(bytes.subarray(0, 64)) } catch { return null }
  return head.trimStart().startsWith('{') ? 'gltf' : null
}

/** The compressed extension a glTF JSON names, or null (L7). */
export function unsupportedExtension(json) {
  const named = [...(json?.extensionsRequired ?? []), ...(json?.extensionsUsed ?? [])]
  for (const name of named) {
    if (UNSUPPORTED_EXTENSIONS[name]) return UNSUPPORTED_EXTENSIONS[name]
  }
  return null
}

/** The lower-case hex sha256 of `bytes`. */
export async function sha256Hex(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * A3 — every `buffers[].uri` and `images[].uri` a `.gltf` names, deduplicated
 * by canonical href, each resolved against the file's final URL and validated
 * with A1 (or, for a root-relative model, against the world's origin).
 *
 * @returns {{ok: true, dependencies: Array<{uri: string, url: string, isData: boolean}>}
 *          | {ok: false, reason: string, message: string}}
 */
export function listDependencies(json, effectiveUrl, { rootRelative = false, worldBaseUrl = null } = {}) {
  const uris = []
  for (const entry of json?.buffers ?? []) if (typeof entry?.uri === 'string') uris.push(entry.uri)
  for (const entry of json?.images ?? []) if (typeof entry?.uri === 'string') uris.push(entry.uri)

  const out = []
  // Z1 — the distinct canonical URL is the identity: each is returned ONCE,
  // carrying every original URI that resolved to it (`uris`). Round 6 dropped
  // the second URI, so `./a.png` and `a.png` in one .gltf fetched the file once
  // and the parser then refused the model `unsupported-image`.
  const byUrl = new Map()
  for (const uri of uris) {
    if (uri.startsWith('data:')) {
      const already = byUrl.get(uri)
      if (already) { if (!already.uris.includes(uri)) already.uris.push(uri); continue }
      const entry = { uri, url: uri, isData: true, uris: [uri] }
      byUrl.set(uri, entry)
      out.push(entry)
      continue
    }
    let resolved
    try { resolved = new URL(uri, effectiveUrl).href } catch { return failure('bad-dependency', uri) }
    // S2 (round 6) — A1 itself validates every resolved dependency, not only a
    // root-relative model's origin rule. Round 5 checked a root-relative model's
    // dependencies for the same origin and an absolute model's with A1, so an
    // absolute model's `user:pw@host/dep.bin` slipped through.
    if (modelUrlProblem(resolved) !== null) return failure('bad-dependency', uri)
    if (rootRelative) {
      let origin = null
      try { origin = new URL(worldBaseUrl).origin } catch { return failure('bad-dependency', uri) }
      if (new URL(resolved).origin !== origin) return failure('bad-dependency', uri)
    }
    const already = byUrl.get(resolved)
    if (already) { if (!already.uris.includes(uri)) already.uris.push(uri); continue }
    const entry = { uri, url: resolved, isData: false, uris: [uri] }
    byUrl.set(resolved, entry)
    out.push(entry)
  }
  return { ok: true, dependencies: out }
}

/**
 * Z2 — fetch a model and everything a `.gltf` pulls in, under the limits.
 *
 * @param {object} args
 * @param {string} args.url                 the stored spec URL
 * @param {string|null} [args.sha256]       the pinned hash, if any
 * @param {AbortSignal|null} [args.signal]  external cancellation
 * @param {typeof fetch} [args.fetchFn]
 * @param {string|null} [args.worldBaseUrl]
 * @param {object|null} [args.ledger]
 * @param {object} [args.limits]
 * @param {object|null} [args.deadline]     M3 — the JOB's deadline, shared with
 *   the preflight and the parse; this call starts it at its first request
 * @returns {Promise<object>} `{ ok: true, kind, bytes, json, dependencies, effectiveUrl, totalBytes }`
 *   or `{ ok: false, reason, message }`; `aborted` is the quiet refusal.
 */
export async function fetchModel({
  url,
  sha256 = null,
  signal = null,
  fetchFn = globalThis.fetch,
  worldBaseUrl = null,
  ledger = null,
  limits = MODEL_LIMITS,
  deadline = null,
  limiter = null,
  priority = 0,
  sharedTransfers = null,
} = {}) {
  const problem = modelUrlProblem(url)
  if (problem) return failure('bad-spec', problem)

  const rootRelative = isRootRelative(url)
  const resolved = resolveModelUrl(url, worldBaseUrl)
  if (!resolved.ok) return failure(resolved.reason)

  const controller = new AbortController()
  // M3 (round 6) — the job's own deadline, set at its first request: the fetch,
  // the preflight and the parse share it. Round 5's 30 s stopped when this
  // returned, so a model could take about 60 s of its own work.
  if (deadline) {
    deadline.start()
    if (deadline.expired()) return failure('timeout')
  }
  const onExternalAbort = () => controller.abort('external')
  if (signal) {
    if (signal.aborted) return failure('aborted')
    signal.addEventListener('abort', onExternalAbort)
  }

  const release = ledger?.registerController?.(controller) ?? null
  const done = () => {
    release?.()
    signal?.removeEventListener?.('abort', onExternalAbort)
  }

  if (ledger?.over) {
    done()
    return failure('world-download-budget')
  }

  const budget = { bytes: 0 }
  // Z3/L4a — the timer is RE-ARMED per transfer (with whatever is left of the
  // job's deadline) rather than set once for the whole call.
  let timer = null
  const armTimer = () => {
    clearTimeout(timer)
    timer = setTimeout(() => controller.abort(TIMEOUT), deadline ? deadline.remainingMs() : limits.timeoutMs)
  }
  // R9 — Z3 says a job's priority is its EARLIEST requester's `som.allNodes`
  // index WHEN IT ASKS, so the bridge passes a function and it is asked at each
  // acquire. A plain number stays accepted, for the existing callers.
  const priorityNow = () => (typeof priority === 'function' ? priority() : priority)

  try {
    /**
     * L4a — one HTTP request on this job's account: its slot is held from before
     * `fetchFn` until the body is read or cancelled, and the job's clock stops
     * while the job waits for that slot (waiting is not the job's own work).
     */
    const request = async (target, requestSignal = controller.signal, budgets = [budget], onBudgetOver = null) => {
      let slot = null
      if (limiter) {
        deadline?.pause()
        slot = await limiter.acquire(requestSignal, priorityNow())
        deadline?.resume()
        if (requestSignal.aborted) {
          slot()
          return abortOrTimeout(controller, signal)
        }
      }
      armTimer()
      try {
        return await fetchOne(target, {
          fetchFn, signal: requestSignal, budgets, ledger, limits, rootRelative, worldBaseUrl, onBudgetOver,
        })
      } finally {
        clearTimeout(timer)
        timer = null
        slot?.()
      }
    }

    const first = await request(resolved.url)
    if (first.aborted) return abortOrTimeout(controller, signal)
    if (!first.ok) return first

    const kind = sniffFormat(first.bytes)
    if (!kind) return failure('parse')

    if (kind === 'glb') {
      if (sha256 && (await sha256Hex(first.bytes)) !== sha256) return failure('hash-mismatch')
      return {
        ok: true, kind, bytes: first.bytes, json: null, dependencies: new Map(),
        effectiveUrl: first.url ?? resolved.url, totalBytes: budget.bytes,
      }
    }

    let json
    try { json = JSON.parse(new TextDecoder().decode(first.bytes)) } catch { return failure('parse') }
    const unsupported = unsupportedExtension(json)
    if (unsupported) return failure('unsupported', unsupported)

    const listed = listDependencies(json, first.url ?? resolved.url, { rootRelative, worldBaseUrl })
    if (!listed.ok) return listed

    // A12 — pinning is about the detected format: a .gltf with external files
    // cannot be pinned, whatever the URL's suffix said.
    const external = listed.dependencies.filter((d) => !d.isData)
    if (sha256 && external.length > 0) return failure('pin-needs-glb')
    if (sha256 && (await sha256Hex(first.bytes)) !== sha256) return failure('hash-mismatch')

    /**
     * L4a — the transfer one shared-dependency task performs. Its own controller
     * is registered with the world's ledger (the chunk that crosses the 150 MiB
     * cap aborts every in-flight transfer), it holds ONE limiter slot, and it
     * has NO timer of its own: each consumer's own deadline ends that consumer's
     * wait (R1), and the task is aborted when its last consumer leaves.
     *
     * Its bag belongs to the TASK (R8), not to the URL: the bytes of an earlier
     * transfer under the same key say nothing about this one.
     */
    const runTransfer = async (taskSignal, target, bag) => {
      const transfer = new AbortController()
      const onAbandon = () => transfer.abort('abandoned')
      taskSignal.addEventListener('abort', onAbandon, { once: true })
      const unregister = ledger?.registerController?.(transfer) ?? null
      let slot = null
      try {
        if (limiter) slot = await limiter.acquire(transfer.signal, priorityNow())
        // R1 — the transfer has its slot (or needs none): every consumer's clock
        // runs again from here, and each arms a timer of its own.
        bag.received = 0
        bag.grantSlot()
        if (transfer.signal.aborted) return abortedTransfer(transfer)
        const got = await fetchOne(target, {
          fetchFn,
          signal: transfer.signal,
          // Every LIVE consumer's budget is charged ·per chunk·, so a consumer
          // that joined the transfer under way is charged the rest as it comes.
          budgets: () => [...bag.consumers].map((consumer) => consumer.budget),
          ledger,
          limits,
          rootRelative,
          worldBaseUrl,
          onChunk: (length) => { bag.received += length },
          onBudgetOver: (overBudget) => {
            for (const consumer of bag.consumers) {
              if (consumer.budget !== overBudget || consumer.over) continue
              consumer.over = true
              consumer.settle(failure('too-large'))
              consumer.abort()          // leaves the transfer; the others carry on
            }
          },
        })
        if (got.aborted) return abortedTransfer(transfer)
        return got
      } finally {
        unregister?.()
        slot?.()
        taskSignal.removeEventListener?.('abort', onAbandon)
      }
    }

    /** L4a — this job's share of a dependency transfer, joined or started. */
    const depend = async (target) => {
      // The key is the canonical URL AND the redirect policy: an absolute model
      // may follow any `https` redirect, a root-relative one must stay on the
      // world's origin, so their bytes are not interchangeable.
      const key = `${target}\u0000${rootRelative ? worldPolicy(worldBaseUrl) : 'absolute'}`
      const consumer = {
        budget, over: false, done: false, settle: null, result: null, timer: null,
        abort: () => controller.abort('too-large'),
      }
      consumer.result = new Promise((resolve) => { consumer.settle = resolve })
      // R8 — the bag is the TASK's: `bagForTask` is reached through the task the
      // helper just made (or the live one this consumer is joining).
      const joined = sharedTransfers.join(
        key,
        (taskSignal) => runTransfer(taskSignal, target, bagForTask(sharedTransfers.taskFor(key))),
        controller.signal,
      )
      const task = sharedTransfers.taskFor(key)
      if (!task) return abortOrTimeout(controller, signal)
      const bag = bagForTask(task)
      bag.consumers.add(consumer)
      // R1 — a consumer's clock stops while it waits for the transfer's slot: the
      // wait is the transfer's, not this job's, and every consumer waits for the
      // same slot (`bag.grantSlot` resolves when the transfer has it).
      deadline?.pause()
      ;(async () => {
        await bag.slotGranted
        if (consumer.done || controller.signal.aborted) return
        deadline?.resume()
        // R1 — this consumer's OWN deadline ends its wait on the shared
        // transfer: at zero it aborts its own controller with the TIMEOUT
        // reason, so `depend` answers `timeout` (R7's mapping) and the consumer
        // leaves while the transfer goes on for the others.
        consumer.timer = setTimeout(
          () => controller.abort(TIMEOUT),
          deadline ? deadline.remainingMs() : limits.timeoutMs,
        )
      })()
      try {
        // A consumer joining a transfer already under way is charged the bytes
        // it missed AT ONCE — the bytes of THIS task's transfer, never those of
        // an earlier download under the same URL (R8).
        budget.bytes += bag.received
        if (budget.bytes > limits.modelBytes) {
          consumer.over = true
          return failure('too-large')
        }
        const got = await Promise.race([joined, consumer.result])
        if (consumer.over) return failure('too-large')
        // R7 — an abort is named by THIS consumer's own controller: the join's
        // bare `{ ok: false, reason: 'aborted' }` would travel to the bridge as
        // "nobody wants this" and park a wanted node for good.
        if (controller.signal.aborted || got.reason === 'aborted') return abortOrTimeout(controller, signal)
        return got
      } finally {
        consumer.done = true
        clearTimeout(consumer.timer)
        consumer.timer = null
        deadline?.resume()
        bag.consumers.delete(consumer)
      }
    }

    const dependencies = new Map()
    for (const dependency of listed.dependencies) {
      if (dependency.isData) continue
      // L4a — a dependency transfer is shared with every other job that wants
      // those bytes while it is in flight (A4 amendment: in flight ONLY).
      const fetched = sharedTransfers
        ? await depend(dependency.url)
        : await request(dependency.url)
      if (fetched.aborted) return abortOrTimeout(controller, signal)
      if (!fetched.ok) return fetched
      // Z1 — every original URI that resolved to this canonical URL gets an
      // entry, all pointing at the ONE `{ url, bytes }` object, so the parser
      // finds bytes for each declared image.
      const entry = { url: dependency.url, bytes: fetched.bytes }
      for (const uri of dependency.uris ?? [dependency.uri]) dependencies.set(uri, entry)
    }

    return {
      ok: true, kind, bytes: first.bytes, json, dependencies,
      effectiveUrl: first.url ?? resolved.url, totalBytes: budget.bytes,
    }
  } finally {
    done()
  }
}

/**
 * Z3/L4a — per shared-transfer TASK, the consumers whose budgets the transfer
 * charges as each chunk arrives. R8: the bag's `received` is the bytes of the
 * task's OWN transfer, so a model that joins a transfer queued under a URL an
 * earlier model already downloaded is never charged those earlier bytes.
 *
 * The bag also carries `slotGranted`/`grantSlot`: the one promise every consumer
 * of the task waits on, resolved when the transfer takes its limiter slot. That
 * is what lets EACH consumer pause its own clock for the same wait (R1).
 */
const TASK_BAGS = new WeakMap()

function bagForTask(task) {
  let bag = TASK_BAGS.get(task)
  if (!bag) {
    let grantSlot = null
    const slotGranted = new Promise((resolve) => { grantSlot = resolve })
    bag = { consumers: new Set(), received: 0, started: false, slotGranted, grantSlot }
    TASK_BAGS.set(task, bag)
  }
  return bag
}

/**
 * R10 — the redirect-policy half of a shared transfer's key: an absolute model
 * may follow any `https` redirect, a root-relative one must stay on the world's
 * ORIGIN. The origin, not a literal, so two worlds never share a key.
 */
function worldPolicy(worldBaseUrl) {
  try { return new URL(worldBaseUrl).origin } catch { return 'world' }
}

/** R7 — why an aborted shared transfer ended, named for the consumer. */
function abortedTransfer(transfer) {
  if (transfer.signal.reason === 'over-budget') return failure('world-download-budget')
  return { ok: false, reason: 'aborted', message: 'cancelled' }
}

/**
 * Name an abort: a world change or a removed node is quiet (`aborted`), our own
 * 30 s timer is `timeout`, and the world's ledger is `world-download-budget`.
 */
function abortOrTimeout(controller, externalSignal) {
  if (externalSignal?.aborted) return failure('aborted')
  const reason = controller.signal.reason
  if (reason === 'over-budget') return failure('world-download-budget')
  return failure('timeout')
}

// ---------------------------------------------------------------------------
// L26 — the sky's own transfer. A sky image is NOT a model and NOT a world
// download: it has its own 16 MiB cap and its own 30 s deadline, and it is
// charged to neither the model's 25 MiB nor the world's 150 MiB ledger. It
// still uses A2's request policy and L17's redirect rule, because those are
// about the request, not the budget.
// ---------------------------------------------------------------------------

/** L26's numbers, in bytes and milliseconds. */
export const IMAGE_LIMITS = Object.freeze({
  imageBytes: 16 * 1024 * 1024,
  timeoutMs: 30_000,
})

/** The sky's reason codes and their plain text (L26). */
export const IMAGE_REASONS = Object.freeze({
  'bad-spec': 'the sky URL is not valid',
  'no-base':  'this world has no address to resolve a /path against',
  'http':     'the server refused the request',
  'network':  'the sky could not be reached (offline, or the host does not allow this page to read it)',
  'too-large': 'the sky is larger than the limit',
  'timeout':  'the sky took too long to download',
  'redirect': 'the download was redirected somewhere it may not go',
  'aborted':  'the download was cancelled',
})

/** A sky refusal with its code; `aborted` is the quiet case. */
function imageFailure(reason, detail) {
  const base = IMAGE_REASONS[reason] ?? 'the sky could not be loaded'
  return { ok: false, reason, message: detail ? `${base} (${detail})` : base }
}

/**
 * V3.4 (library-sky round 2) — the sky failure reasons a Retry button can
 * actually fix: a transfer that failed (`network`, an `http` status, the 30 s
 * `timeout`, the 16 MiB `too-large` cap), a `decode` that failed, or an image
 * header that is unreadable or too large (`unsupported-image`, `bad-size`,
 * `too-large-dimensions`).
 *
 * Everything else is a REFUSAL BY RULE, which a Retry can never fix and for
 * which the picker shows the reason with NO button: any `resolveSkyUrl` code
 * (`url-type`, `url-length`, `url-chars`, `url-scheme`, `url-parse`,
 * `url-host`, `url-credentials`, `url-relative`, `no-base`, `empty`),
 * `fetchImage`'s own `bad-spec` and `redirect`, and a background `type` this
 * client does not render.
 *
 * It lives beside `IMAGE_REASONS` because `load-background.js` — which does the
 * classifying — imports `three`, and `apps/client/src/sky-picker.js` (with its
 * tests) must not. `load-background.js` re-exports it, so the picker and the
 * controller's own tests read ONE list.
 */
export const SKY_RETRYABLE_REASONS = Object.freeze([
  'network',              // the transfer failed
  'http',                 // the server refused the request
  'timeout',              // the transfer outlived its deadline
  'too-large',            // the transfer outgrew its byte cap
  'decode',               // three could not decode the bytes
  'unsupported-image',    // the image header is not PNG, JPEG or WebP
  'bad-size',             // the image header carries no usable size
  'too-large-dimensions', // the image is bigger than 4096 × 2048
])

/** True when a sky's failure is one a Retry can help with (V3.4). */
export function isSkyRetryable(reason) {
  return SKY_RETRYABLE_REASONS.includes(reason)
}

/**
 * L26 — name a sky abort: a caller's cancellation is quiet (`aborted`), our own
 * 30 s timer is `timeout`. A sky transfer has no world ledger, so there is no
 * `world-download-budget` case to name.
 */
function imageAbortOrTimeout(controller, externalSignal) {
  if (externalSignal?.aborted) return imageFailure('aborted')
  const reason = controller.signal.reason
  if (reason === 'external') return imageFailure('aborted')
  return imageFailure('timeout')
}

/**
 * L26 — fetch one sky image under its own limits. Renderer-neutral: the bytes go
 * back to the caller, and the caller checks the header (`imageHeader`) and hands
 * them to three. The deadline is ONE timer for the whole transfer, so a server
 * that drips a body slowly cannot stretch the 30 s past its end.
 *
 * A sky URL follows A1 like a model URL: `https://` or a single-slash root path,
 * resolved against the world's base (L25a). A document-relative value never
 * reaches this function — the sky URL rule refuses it first — and a redirect's
 * final URL is checked before the body is read.
 *
 * @param {object} args
 * @param {string} args.url                 the stored sky URL
 * @param {string|null} [args.worldBaseUrl]
 * @param {AbortSignal|null} [args.signal]  external cancellation
 * @param {typeof fetch} [args.fetchFn]
 * @param {{imageBytes?: number, timeoutMs?: number}} [args.limits]
 * @returns {Promise<{ok: true, bytes: Uint8Array, url: string} | {ok: false, reason: string, message: string}>}
 */
export async function fetchImage({
  url,
  worldBaseUrl = null,
  signal = null,
  fetchFn = globalThis.fetch,
  limits = IMAGE_LIMITS,
} = {}) {
  const imageBytes = limits?.imageBytes ?? IMAGE_LIMITS.imageBytes
  const timeoutMs = limits?.timeoutMs ?? IMAGE_LIMITS.timeoutMs

  const problem = modelUrlProblem(url)
  if (problem) return imageFailure('bad-spec', problem)

  const rootRelative = isRootRelative(url)
  const resolved = resolveModelUrl(url, worldBaseUrl)
  if (!resolved.ok) return imageFailure(resolved.reason)

  const controller = new AbortController()
  const onExternalAbort = () => controller.abort('external')
  if (signal) {
    if (signal.aborted) return imageFailure('aborted')
    signal.addEventListener('abort', onExternalAbort)
  }

  // L26 — ONE timer for the whole transfer: the request, the redirect check and
  // every chunk. Re-arming it per chunk would let a dripping body run forever.
  const timer = setTimeout(() => controller.abort(TIMEOUT), timeoutMs)
  const budget = { bytes: 0 }
  try {
    const got = await fetchOne(resolved.url, {
      fetchFn,
      signal: controller.signal,
      budgets: [budget],
      // A sky is outside the world's ledger: a 16 MiB sky must never eat a
      // model's 150 MiB world allowance, and vice versa.
      ledger: null,
      limits: { modelBytes: imageBytes },
      rootRelative,
      worldBaseUrl,
    })
    if (got.aborted) return imageAbortOrTimeout(controller, signal)
    if (!got.ok) {
      // The transfer's message carries its detail in parentheses (`(404)`).
      const detail = typeof got.message === 'string' ? got.message.match(/\(([^)]*)\)$/)?.[1] : undefined
      return imageFailure(got.reason, detail)
    }
    return { ok: true, bytes: got.bytes, url: got.url ?? resolved.url }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener?.('abort', onExternalAbort)
  }
}
