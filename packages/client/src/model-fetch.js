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
 * Read a response's body in chunks, charging the model budget and the world
 * ledger as they arrive. Content-Length is only used to refuse early.
 */
async function readBody(response, { budget, ledger, limits, signal }) {
  const declared = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(declared) && budget.bytes + declared > limits.modelBytes) {
    try { await response.body?.cancel?.() } catch { /* ignore */ }
    return failure('too-large')
  }

  const reader = response.body?.getReader?.()
  const chunks = []
  let total = 0
  if (!reader) {
    const buffer = await response.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    budget.bytes += bytes.byteLength
    ledger?.charge(bytes.byteLength)
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
    budget.bytes += length
    const worldOver = ledger ? ledger.charge(length) : false
    // The model's budget is shared by the file and every dependency (Z2).
    if (budget.bytes > limits.modelBytes) {
      try { await reader.cancel() } catch { /* ignore */ }
      return failure('too-large')
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
async function fetchOne(target, { fetchFn, signal, budget, ledger, limits, rootRelative, worldBaseUrl }) {
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

  const body = await readBody(response, { budget, ledger, limits, signal })
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
  const seen = new Set()
  for (const uri of uris) {
    if (uri.startsWith('data:')) { out.push({ uri, url: uri, isData: true }); continue }
    let resolved
    try { resolved = new URL(uri, effectiveUrl).href } catch { return failure('bad-dependency', uri) }
    if (rootRelative) {
      let origin = null
      try { origin = new URL(worldBaseUrl).origin } catch { return failure('bad-dependency', uri) }
      if (new URL(resolved).origin !== origin) return failure('bad-dependency', uri)
    } else if (modelUrlProblem(resolved) !== null) {
      return failure('bad-dependency', uri)
    }
    if (seen.has(resolved)) continue
    seen.add(resolved)
    out.push({ uri, url: resolved, isData: false })
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
} = {}) {
  const problem = modelUrlProblem(url)
  if (problem) return failure('bad-spec', problem)

  const rootRelative = isRootRelative(url)
  const resolved = resolveModelUrl(url, worldBaseUrl)
  if (!resolved.ok) return failure(resolved.reason)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(TIMEOUT), limits.timeoutMs)
  const onExternalAbort = () => controller.abort('external')
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer)
      return failure('aborted')
    }
    signal.addEventListener('abort', onExternalAbort)
  }

  const release = ledger?.registerController?.(controller) ?? null
  const done = () => {
    clearTimeout(timer)
    release?.()
    signal?.removeEventListener?.('abort', onExternalAbort)
  }

  if (ledger?.over) {
    done()
    return failure('world-download-budget')
  }

  const budget = { bytes: 0 }
  try {
    const first = await fetchOne(resolved.url, {
      fetchFn, signal: controller.signal, budget, ledger, limits, rootRelative, worldBaseUrl,
    })
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

    const dependencies = new Map()
    for (const dependency of listed.dependencies) {
      if (dependency.isData) continue
      const fetched = await fetchOne(dependency.url, {
        fetchFn, signal: controller.signal, budget, ledger, limits, rootRelative, worldBaseUrl,
      })
      if (fetched.aborted) return abortOrTimeout(controller, signal)
      if (!fetched.ok) return fetched
      dependencies.set(dependency.uri, { url: dependency.url, bytes: fetched.bytes })
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
 * Name an abort: a world change or a removed node is quiet (`aborted`), our own
 * 30 s timer is `timeout`, and the world's ledger is `world-download-budget`.
 */
function abortOrTimeout(controller, externalSignal) {
  if (externalSignal?.aborted) return failure('aborted')
  const reason = controller.signal.reason
  if (reason === 'over-budget') return failure('world-download-budget')
  return failure('timeout')
}
