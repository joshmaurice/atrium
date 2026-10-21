// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * model-parse.js — turning fetched bytes into a template, under the decoded
 * limits (Phase 3 step 3a: Z3 as amended by A3 steps 4–6, A5 and A8).
 *
 * Everything here is reachable from Node: the preflight and image-header checks
 * are pure functions over measured numbers (P5 — no DOM, no image decoding),
 * the GLB reader is byte arithmetic, and the template cache is bookkeeping.
 * Only `parseTemplate` touches `GLTFLoader`.
 *
 * The order that matters: every check runs on the JSON and the image bytes
 * BEFORE `GLTFLoader` sees anything, so a refused model is never uploaded to
 * the GPU, and the parsed result is measured again afterwards (Z3).
 */

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { LoadingManager } from 'three'

/** A5's preflight limits and L8's texture numbers. */
export const MODEL_PARSE_LIMITS = Object.freeze({
  maxNodes: 10_000,
  maxVertices: 500_000,
  maxAccessorBytes: 64 * 1024 * 1024,
  maxTextureSide: 4096,
  // W6 (round 5) — decision L20: the world texture budget is 512 MiB, not 256.
  // For scale (w × h × 4 × 4⁄3): about six typical 2048-px PBR models (four 2k
  // textures each), or about twenty-four of the 1k-texture library items.
  worldTextureBytes: 512 * 1024 * 1024,
})

/** A5/A8/A13 — the reasons this module adds, with their plain text. */
export const PARSE_REASONS = Object.freeze({
  'too-many-nodes':        'the model has too many objects',
  'too-many-vertices':     'the model has too many vertices',
  'too-much-data':         'the model’s data is larger than the limit',
  'unsupported-image':     'the model uses an image format Atrium does not load',
  'texture-too-large':     'the model has a texture larger than 4096 px',
  'world-texture-budget':  'this world has loaded its limit of textures',
})

export function parseReasonText(reason) {
  return PARSE_REASONS[reason] ?? 'the model could not be used'
}

// ---------------------------------------------------------------------------
// Image headers (A5): format and dimensions from the bytes themselves
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function matches(bytes, signature, at = 0) {
  if (bytes.length < at + signature.length) return false
  return signature.every((b, i) => bytes[at + i] === b)
}

function u16be(bytes, at) { return (bytes[at] << 8) | bytes[at + 1] }
function u32be(bytes, at) {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0
}

/**
 * The format and pixel size of `bytes`, read from its header — PNG, JPEG or
 * WebP only (A5). Returns null when the header cannot be read.
 *
 * @param {Uint8Array} bytes
 * @returns {{format: 'png'|'jpeg'|'webp', width: number, height: number, hasAlpha: boolean}|null}
 */
export function imageHeader(bytes) {
  if (!bytes) return null

  if (matches(bytes, PNG_SIGNATURE)) {
    // IHDR is the first chunk: 8 signature + 4 length + 4 type, then 13 bytes of
    // fields. M5 — every offset read below is checked first: the width and
    // height end at byte 24 and the colour type is byte 25, so a truncated
    // header is null (unsupported-image) rather than a 0 × 0 image.
    if (bytes.length < 26) return null
    if (bytes[8] !== 0 || bytes[9] !== 0 || bytes[10] !== 0 || bytes[11] !== 13) return null
    if (String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') return null
    const colorType = bytes[25]
    const hasAlpha = colorType === 4 || colorType === 6
    return { format: 'png', width: u32be(bytes, 16), height: u32be(bytes, 20), hasAlpha }
  }

  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2
    // M5 — walk the segments with a length check on every hop, and require the
    // frame's own fields to be inside the bytes before reading them.
    while (at + 4 <= bytes.length) {
      if (bytes[at] !== 0xff) { at += 1; continue }
      const marker = bytes[at + 1]
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue }
      const length = u16be(bytes, at + 2)
      // SOF0–SOF15, minus the non-frame markers in that range.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        if (length < 8 || at + 9 > bytes.length) return null
        return { format: 'jpeg', height: u16be(bytes, at + 5), width: u16be(bytes, at + 7), hasAlpha: false }
      }
      if (length < 2 || at + 2 + length > bytes.length) return null
      at += 2 + length
    }
    return null
  }

  if (bytes.length >= 16 && matches(bytes, [0x52, 0x49, 0x46, 0x46]) && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') {
    const kind = String.fromCharCode(...bytes.subarray(12, 16))
    if (kind === 'VP8 ') {
      // M5 — the frame header's own fields: 14 bytes of VP8 header, then the
      // 16-bit width and height at 26 and 28.
      if (bytes.length < 30) return null
      return { format: 'webp', width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff, hasAlpha: false }
    }
    if (kind === 'VP8L') {
      if (bytes.length < 25) return null
      const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24)
      return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, hasAlpha: true }
    }
    if (kind === 'VP8X') {
      // M5 — the alpha flag is byte 20 and the 24-bit sizes end at byte 29.
      if (bytes.length < 30) return null
      const hasAlpha = (bytes[20] & 0x10) !== 0
      const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16))
      const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16))
      return { format: 'webp', width, height, hasAlpha }
    }
    return null
  }

  return null
}

function u16le(bytes, at) { return bytes[at] | (bytes[at + 1] << 8) }

/**
 * L8/A5 — the texture memory a w × h image is estimated to need:
 * width × height × 4 bytes × 4⁄3 for the mip chain.
 */
export function estimateTextureBytes(width, height) {
  return Math.ceil((width * height * 4 * 4) / 3)
}

// ---------------------------------------------------------------------------
// The GLB container (A5: the checks run on "the GLB's JSON chunk" too)
// ---------------------------------------------------------------------------

/**
 * Split a `.glb` into its JSON chunk and its binary chunk.
 *
 * @param {Uint8Array} bytes
 * @returns {{json: object, bin: Uint8Array}|null}
 */
export function readGlb(bytes) {
  if (!bytes || bytes.length < 20) return null
  if (!(bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46)) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const total = view.getUint32(8, true)
  if (total > bytes.byteLength) return null
  let at = 12
  let json = null
  let bin = null
  while (at + 8 <= total) {
    const chunkLength = view.getUint32(at, true)
    const chunkType = view.getUint32(at + 4, true)
    const start = at + 8
    if (start + chunkLength > total) return null
    const chunk = bytes.subarray(start, start + chunkLength)
    if (chunkType === 0x4e4f534a) {
      try { json = JSON.parse(new TextDecoder().decode(chunk)) } catch { return null }
    } else if (chunkType === 0x004e4942) {
      bin = chunk
    }
    at = start + chunkLength
  }
  return json ? { json, bin } : null
}

/**
 * M1 (round 6) — the A3 rule for a `.glb`, applied to its JSON chunk BEFORE
 * anything is parsed. GLTFLoader follows a `.glb`'s `uri`s with its own loaders,
 * outside `fetchModel`, its budget and its preflight, so a `.glb` that names any
 * file it does not carry is refused here — before a loader is even constructed.
 *
 * A `.glb`'s buffers are its binary chunk (no `uri`) or `data:` URIs; its images
 * are buffer views or `data:` URIs. Anything else is `bad-dependency`.
 *
 * @param {object} json  the GLB's JSON chunk
 * @returns {{reason: string, message: string}|null}
 */
export function glbDependencyProblem(json) {
  for (const buffer of json?.buffers ?? []) {
    const uri = buffer?.uri
    if (uri === undefined || uri === null) continue
    if (typeof uri !== 'string' || !uri.startsWith('data:')) return dependencyProblem(uri)
  }
  for (const image of json?.images ?? []) {
    const uri = image?.uri
    if (typeof uri === 'string' && uri.startsWith('data:')) continue
    if (uri !== undefined && uri !== null) return dependencyProblem(uri)
    if (image?.bufferView === undefined) return dependencyProblem('')
  }
  return null
}

function dependencyProblem(uri) {
  const text = typeof uri === 'string' && uri.length > 0 ? uri : 'a file it does not carry'
  return { reason: 'bad-dependency', message: `the model asks for ${text}` }
}

/** The bytes of every image a GLB's JSON names in a buffer view. */
export function glbImages(json, bin) {
  const out = []
  for (const [index, image] of (json?.images ?? []).entries()) {
    let bytes = null
    if (image.bufferView !== undefined && bin) {
      const viewDef = json.bufferViews?.[image.bufferView]
      if (viewDef) {
        const start = viewDef.byteOffset ?? 0
        bytes = bin.subarray(start, start + viewDef.byteLength)
      }
    }
    // W2/M5 — a `data:` image is measured too, and an image whose bytes are not
    // here is still REPORTED (with `bytes: null`) rather than dropped: every
    // declared image must pass, or the model is refused.
    if (bytes === null && typeof image.uri === 'string' && image.uri.startsWith('data:')) bytes = dataUriBytes(image.uri)
    out.push({ index, mimeType: image.mimeType ?? null, bytes })
  }
  return out
}

/**
 * W2 (round 3) — the bytes a `data:` URI carries. Only the `;base64,` form is
 * decoded (A5: "the model's data"); any other payload — a percent-encoded or
 * plain-text one — is an image Atrium does not load, so this answers `null`
 * and the preflight refuses the image `unsupported-image`.
 *
 * @param {string} uri
 * @returns {Uint8Array|null}
 */
function dataUriBytes(uri) {
  const comma = uri.indexOf(',')
  if (comma === -1) return null
  if (!uri.slice(5, comma).toLowerCase().split(';').includes('base64')) return null
  try {
    const binary = atob(uri.slice(comma + 1))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

/**
 * W2 — the bytes a `.gltf` image's buffer view covers, taken from its buffer's
 * bytes the way the GLB branch takes them from the binary chunk: the buffer is
 * either a `data:` URI's decoded payload or one of A3's fetched dependencies.
 * `null` when the buffer's bytes are not here.
 */
function gltfBufferViewBytes(json, index, dependencies) {
  const view = json?.bufferViews?.[index]
  if (!view) return null
  const buffer = json?.buffers?.[view.buffer ?? 0]
  if (typeof buffer?.uri !== 'string') return null
  const source = buffer.uri.startsWith('data:')
    ? dataUriBytes(buffer.uri)
    : dependencies.get(buffer.uri)?.bytes ?? null
  if (!source) return null
  const start = view.byteOffset ?? 0
  return source.subarray(start, start + view.byteLength)
}

/**
 * W2 (round 3) — the image bytes a `.gltf` names, for the A5 preflight: a
 * `data:` URI's decoded payload, a buffer view's slice of its buffer, or the
 * fetched bytes of an image URI. A `data:` URI that cannot be decoded is
 * passed on as `{ bytes: null }`, which `imageHeader` answers `null` for and
 * `preflightProblem` therefore refuses `unsupported-image`.
 *
 * @param {object} json
 * @param {Map<string, {bytes: Uint8Array}>} dependencies
 * @returns {Array<{bytes: Uint8Array|null}>}
 */
function gltfImages(json, dependencies) {
  const out = []
  for (const image of json?.images ?? []) {
    if (typeof image?.uri === 'string') {
      if (image.uri.startsWith('data:')) { out.push({ bytes: dataUriBytes(image.uri) }); continue }
      // M5 — a declared image whose bytes are not here is reported with null
      // bytes, so the preflight refuses the model instead of skipping the image.
      out.push({ bytes: dependencies.get(image.uri)?.bytes ?? null })
      continue
    }
    out.push({ bytes: image?.bufferView === undefined ? null : gltfBufferViewBytes(json, image.bufferView, dependencies) })
  }
  return out
}

// ---------------------------------------------------------------------------
// A5 — the preflight, pure over the JSON and the image bytes
// ---------------------------------------------------------------------------

const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
const TYPE_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }

/** Σ over accessors of count × element bytes, sparse accessors at full count. */
export function accessorByteTotal(json) {
  let total = 0
  for (const accessor of json?.accessors ?? []) {
    if (accessor.bufferView === undefined && !accessor.sparse) continue
    const component = COMPONENT_BYTES[accessor.componentType]
    const count = TYPE_COMPONENTS[accessor.type]
    if (!component || !count) continue
    total += (accessor.count ?? 0) * component * count
  }
  return total
}

/** Σ `POSITION` accessor `count` over every primitive. */
export function positionVertexTotal(json) {
  let total = 0
  for (const mesh of json?.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const index = primitive.attributes?.POSITION
      if (index === undefined) continue
      total += json.accessors?.[index]?.count ?? 0
    }
  }
  return total
}

/**
 * A5 — every check that runs after all bytes are in and before `GLTFLoader`.
 *
 * @param {object} json          the .gltf JSON, or a .glb's JSON chunk
 * @param {Array<{bytes: Uint8Array}>} [images]  the image bytes, in any order
 * @param {object} [limits]
 * @returns {{reason: string, message: string, bytes?: number}|null}
 */
export function preflightProblem(json, images = [], limits = MODEL_PARSE_LIMITS) {
  if ((json?.nodes?.length ?? 0) > limits.maxNodes) return problem('too-many-nodes')
  if (positionVertexTotal(json) > limits.maxVertices) return problem('too-many-vertices')
  if (accessorByteTotal(json) > limits.maxAccessorBytes) return problem('too-much-data')

  let textureBytes = 0
  for (const image of images) {
    const header = imageHeader(image.bytes)
    if (!header) return problem('unsupported-image')
    // M5 — a zero width or height is not a usable image, whatever its header
    // said it was.
    if (header.width <= 0 || header.height <= 0) return problem('unsupported-image')
    if (header.width > limits.maxTextureSide || header.height > limits.maxTextureSide) {
      return problem('texture-too-large', `${header.width}×${header.height}`)
    }
    textureBytes += estimateTextureBytes(header.width, header.height)
  }
  return { reason: null, message: null, textureBytes }
}

function problem(reason, detail) {
  const base = PARSE_REASONS[reason]
  return { reason, message: detail ? `${base} (${detail})` : base }
}

/**
 * A5 — the world's texture budget. A reservation is taken before parsing and
 * released if the model fails; it is replaced by the measured figures after.
 */
export function createTextureBudget({ bytes = MODEL_PARSE_LIMITS.worldTextureBytes } = {}) {
  let taken = 0
  return {
    limit: bytes,
    get taken() { return taken },
    get free() { return bytes - taken },
    fits(n) { return taken + n <= bytes },
    /** Reserve `n`; false when it does not fit. */
    reserve(n) { if (!this.fits(n)) return false; taken += n; return true },
    /** Release a reservation (`n` back), or a template (its measured size). */
    release(n) { taken = Math.max(0, taken - n) },
    reset() { taken = 0 },
  }
}

// ---------------------------------------------------------------------------
// A3 steps 4–6 — the rewritten .gltf, its blob URLs and the URL modifier
// ---------------------------------------------------------------------------

/**
 * A3 step 4 / Z1 — rewrite every declared buffer and image URI to the `blob:` URL
 * of its fetched bytes. The blob URLs are keyed by the dependency's CANONICAL
 * url, so two spellings of one file (`./a.png`, `a.png`) share ONE blob URL.
 * `data:` URIs are left alone (their bytes are already in the counted file).
 *
 * @param {object} json
 * @param {Map<string, {url: string, bytes: Uint8Array}>} dependencies  by original URI
 * @param {{createObjectURL: (blob: Blob) => string, revokeObjectURL: (url: string) => void}} urls
 * @returns {{json: object, blobUrls: Map<string, string>}}
 */
export function rewriteGltfJson(json, dependencies, urls) {
  const rewritten = JSON.parse(JSON.stringify(json))
  const blobUrls = new Map()
  const swap = (entry) => {
    if (typeof entry?.uri !== 'string') return
    if (entry.uri.startsWith('data:')) return
    const dependency = dependencies.get(entry.uri)
    if (!dependency) return
    // Z1 — the key is the dependency's canonical url, so aliases of one file
    // share a single blob URL (and a single revoke).
    const key = dependency.url ?? entry.uri
    let blobUrl = blobUrls.get(key)
    if (!blobUrl) {
      blobUrl = urls.createObjectURL(new Blob([dependency.bytes]))
      blobUrls.set(key, blobUrl)
    }
    entry.uri = blobUrl
  }
  for (const entry of rewritten.buffers ?? []) swap(entry)
  for (const entry of rewritten.images ?? []) swap(entry)
  return { json: rewritten, blobUrls }
}

/**
 * A3 step 5 — a `LoadingManager` URL modifier that passes ONLY the `blob:` URLs
 * this load created and `data:` URLs. Anything else is recorded as an
 * `unexpected-request` and answered with an empty blob URL, so nothing reaches
 * the network.
 *
 * @returns {{modifier: (url: string) => string, violations: string[], emptyBlobUrl: string}}
 */
export function createUrlModifier(blobUrls, urls) {
  const allowed = new Set(blobUrls.values())
  const violations = []
  const emptyBlobUrl = urls.createObjectURL(new Blob([]))
  // M1 (round 6) — pass `data:` and `blob:` URLs only. `blob:` URLs are
  // page-local, and GLTFLoader creates them itself for a `.glb`'s buffer-view
  // images, so the prefix is the rule; `allowed` names this load's own rewrites.
  const modifier = (url) => {
    if (typeof url === 'string' && (allowed.has(url) || url.startsWith('data:') || url.startsWith('blob:'))) return url
    violations.push(url)
    return emptyBlobUrl
  }
  return { modifier, violations, emptyBlobUrl }
}

/** A3 step 6 — revoke every blob URL this load created. */
export function revokeBlobs(blobUrls, urls) {
  for (const url of blobUrls.values()) {
    try { urls.revokeObjectURL(url) } catch { /* best effort */ }
  }
}

/**
 * The browser's object-URL pair, or a stand-in so the pure parts are testable
 * in Node (where `URL.createObjectURL` does not exist).
 */
export function objectUrlApi(overrides = {}) {
  return {
    createObjectURL: overrides.createObjectURL
      ?? globalThis.URL?.createObjectURL?.bind(globalThis.URL)
      ?? ((blob) => `blob:atrium/${objectUrlCounter++}`),
    revokeObjectURL: overrides.revokeObjectURL ?? globalThis.URL?.revokeObjectURL?.bind(globalThis.URL) ?? (() => {}),
  }
}
let objectUrlCounter = 0

// ---------------------------------------------------------------------------
// Z3/A8 — the template cache
// ---------------------------------------------------------------------------

/** The cache key: the resolved URL plus the pinned hash, if any (Z3). */
export function templateKey(resolvedUrl, sha256 = null) {
  return `${resolvedUrl}\u0000${sha256 ?? ''}`
}

/**
 * Z3/A8 — templates, keyed on (resolved URL, sha256). A template whose last
 * instance goes away becomes IDLE: it is not disposed, still counts against the
 * world texture budget, and is evicted least-recently-used first when a new
 * model would not otherwise fit.
 *
 * W3 (round 4):
 *   - an entry created for a load is created ALREADY ACQUIRED by that load
 *     (`set(key, template, { acquired: true })` → `refs: 1`, not idle), inside
 *     the serialized parse, so an eviction that runs before that load hands the
 *     entry to its instance cannot take it;
 *   - `evictIdleFor` walks every entry and skips any with `refs > 0`: a template
 *     a load or an instance still holds is never evicted and never disposed;
 *   - a redirect's second key is an ALIAS of the same entry (`alias`): one
 *     entry, one byte count, one dispose.
 */
export function createTemplateCache() {
  const entries = new Map()   // key → entry (aliases share the entry object)
  const all = new Set()       // the distinct entries, for `size` and the clear
  let clock = 0

  const entryFor = (key) => entries.get(key) ?? null

  /** Least recently used first, one row per entry however many keys it has. */
  const byRecency = () => [...all].sort((a, b) => a.usedAt - b.usedAt)

  /** Take an entry out of the cache under every key it answers to. */
  const drop = (entry) => {
    for (const key of entry.keys) entries.delete(key)
    all.delete(entry)
  }

  return {
    get size() { return all.size },
    has: (key) => entries.has(key),
    get: (key) => entryFor(key),

    /**
     * Store a template; returns the entry. `{ acquired: true }` is W3's rule for
     * an entry created for a load that is still parsing it.
     */
    set(key, template, { acquired = false } = {}) {
      const existing = entryFor(key)
      if (existing) {
        existing.template = template
        existing.usedAt = ++clock
        return existing
      }
      const entry = {
        key, keys: [key], template,
        refs: acquired ? 1 : 0, idle: !acquired,
        usedAt: ++clock, textureBytes: template.textureBytes ?? 0,
      }
      entries.set(key, entry)
      all.add(entry)
      return entry
    },

    /**
     * W3 — make `aliasKey` another name for the entry at `key`. One entry, one
     * byte count, one dispose. Returns the shared entry, or `null` when there is
     * nothing at `key` or `aliasKey` is already taken.
     */
    alias(aliasKey, key) {
      const entry = entryFor(key)
      if (!entry) return null
      const taken = entryFor(aliasKey)
      if (taken) return taken === entry ? entry : null
      entries.set(aliasKey, entry)
      entry.keys.push(aliasKey)
      return entry
    },

    /** One more instance of `key`. */
    acquire(key) {
      const entry = entryFor(key)
      if (!entry) return null
      entry.refs += 1
      entry.idle = false
      entry.usedAt = ++clock
      return entry
    },

    /** One fewer instance; the template goes idle at zero, and is kept. */
    release(key) {
      const entry = entryFor(key)
      if (!entry) return null
      entry.refs = Math.max(0, entry.refs - 1)
      if (entry.refs === 0) entry.idle = true
      entry.usedAt = ++clock
      return entry
    },

    /** Entries nothing holds any more, least recently used first. */
    idleEntries() {
      return byRecency().filter((e) => e.refs === 0)
    },

    /**
     * A8/W3 — evict templates, least-recently-used first, until `n` bytes fit.
     * Every entry is a candidate (`idleEntries` is what the caller may look at),
     * and the `refs > 0` guard is what actually protects one that is in use: it
     * is skipped and never disposed, whatever its `idle` flag says.
     */
    evictIdleFor(n, budget, dispose) {
      const evicted = []
      for (const entry of byRecency()) {
        if (budget.fits(n)) break
        if (entry.refs > 0) continue
        budget.release(entry.textureBytes)
        drop(entry)
        dispose?.(entry.template)
        evicted.push(entry.key)
      }
      return evicted
    },

    /** Drop and dispose everything (the world changed, A9). */
    clear(dispose) {
      for (const entry of all) dispose?.(entry.template)
      entries.clear()
      all.clear()
    },

    /** Drop one entry, under all of its keys (the form's held Check ended, Z7/A8). */
    delete(key) {
      const entry = entries.get(key)
      if (!entry) return null
      drop(entry)
      return entry
    },

    keys: () => [...entries.keys()],
  }
}

// ---------------------------------------------------------------------------
// Z3 — parse and measure
// ---------------------------------------------------------------------------

const POSITION = 'position'   // three's BufferGeometry attribute name for glTF POSITION

/** M3 — the plain text for a parse that ran past its job's deadline. */
const PARSE_TIMEOUT_MESSAGE = 'the model took too long'

/** Z3 — vertex count over a parsed scene, skinned meshes included. */
export function countVertices(root) {
  let vertices = 0
  root.traverse((object) => {
    const geometry = object.geometry
    if (!geometry) return
    const position = geometry.getAttribute?.(POSITION)
    if (position) vertices += position.count
  })
  return vertices
}

/** Z3 — dispose a template's geometries, materials and textures. */
export function disposeTemplate(template) {
  const disposed = new Set()
  template?.scene?.traverse?.((object) => {
    const geometry = object.geometry
    if (geometry && !disposed.has(geometry)) { disposed.add(geometry); geometry.dispose?.() }
    const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : []
    for (const material of materials) {
      if (disposed.has(material)) continue
      disposed.add(material)
      for (const key of Object.keys(material)) {
        const value = material[key]
        if (value && value.isTexture && !disposed.has(value)) { disposed.add(value); value.dispose?.() }
      }
      material.dispose?.()
    }
  })
}

/** The `Box3` size of a scene at rest, rounded up to a millimetre (Z7). */
export function measureBounds(scene, Box3, Vector3) {
  const box = new Box3().setFromObject(scene)
  const size = new Vector3()
  box.getSize(size)
  const round = (n) => Math.min(1000, Math.max(0.001, Math.ceil(Math.abs(n) * 1000) / 1000))
  return [round(size.x), round(size.y), round(size.z)]
}

/**
 * Z3 — parse fetched bytes with a real `GLTFLoader`.
 *
 * @param {object} args
 * @param {'glb'|'gltf'} args.kind
 * @param {Uint8Array} args.bytes            the file's own bytes
 * @param {object|null} [args.json]          the .gltf JSON, for the rewrite
 * @param {Map} [args.dependencies]
 * @param {object} [args.urls]               the object-URL pair
 * @param {number} [args.timeoutMs]
 * @returns {Promise<{ok: true, template: object} | {ok: false, reason: string, message: string}>}
 */
export async function parseTemplate({
  kind, bytes, json = null, dependencies = new Map(),
  urls = objectUrlApi(), timeoutMs = 30_000, loader = null,
  reserveTexture = null, releaseTexture = null, deadline = null,
} = {}) {
  // M3 (round 6) — each stage checks the job's deadline before it starts. A
  // parse past its deadline cannot be stopped, so the job is `timeout` at once
  // and the late result is disposed when it settles (below).
  if (deadline?.expired()) return { ok: false, reason: 'timeout', message: PARSE_TIMEOUT_MESSAGE }

  const preflight = preflightFor(kind, bytes, json, dependencies)
  if (preflight.problem?.reason) return { ok: false, ...preflight.problem }

  // A5 — the reservation is taken BEFORE parsing and released if the model
  // fails. The caller owns the budget, so it owns both halves of the pair.
  const textureBytes = preflight.textureBytes ?? 0
  let reserved = false
  if (reserveTexture && textureBytes > 0) {
    if (!reserveTexture(textureBytes)) {
      return { ok: false, reason: 'world-texture-budget', message: PARSE_REASONS['world-texture-budget'] }
    }
    reserved = true
  }
  const releaseReservation = () => { if (reserved) { reserved = false; releaseTexture?.(textureBytes) } }
  const stop = (result) => {
    if (!result.ok) releaseReservation()
    return result
  }

  let blobUrls = new Map()
  let payload = bytes
  if (kind === 'gltf') {
    const rewritten = rewriteGltfJson(json, dependencies, urls)
    blobUrls = rewritten.blobUrls
    // A3 step 5: every declared URI must now be one of this load's blob URLs
    // or a data: URI. Anything else is a request the model did not declare.
    const unmapped = declaredUris(rewritten.json).find((uri) => !isMappedUri(uri, blobUrls))
    if (unmapped !== undefined) {
      revokeBlobs(blobUrls, urls)
      return stop({ ok: false, reason: 'unexpected-request', message: `the model asked for ${unmapped}` })
    }
    // GLTFLoader.parse takes a JSON string for a .gltf and an ArrayBuffer for a
    // .glb; a bare Uint8Array is neither (three's own rule).
    payload = JSON.stringify(rewritten.json)
  }

  // M1 (round 6) — the URL modifier is installed for EVERY parse, `.glb`
  // included. Round 5 installed it only for a `.gltf`, and GLTFLoader follows a
  // `.glb`'s JSON `uri`s with its own loaders: a hostile public world made every
  // visitor's browser request any URL, with a Referer, outside `fetchModel`, its
  // budget and its preflight. A `.glb` has no rewritten URIs, so only `data:`
  // and GLTFLoader's own page-local `blob:` URLs pass.
  const modifier = createUrlModifier(blobUrls, urls)
  const manager = new LoadingManager()
  manager.setURLModifier(modifier.modifier)

  const gltfLoader = loader ?? new GLTFLoader()
  gltfLoader.manager = manager

  try {
    const data = typeof payload === 'string' ? payload : bufferOf(payload)
    // M3 — the parse gets whatever is LEFT of the job's 30 s, not a fresh 30 s.
    const parseMs = deadline ? deadline.remainingMs() : timeoutMs
    if (deadline && parseMs <= 0) return stop({ ok: false, reason: 'timeout', message: PARSE_TIMEOUT_MESSAGE })

    const parsePromise = gltfLoader.parseAsync(data, '')
    let gltf
    try {
      gltf = await withTimeout(parsePromise, parseMs)
    } catch (error) {
      if (modifier.violations.length > 0) {
        return stop({ ok: false, reason: 'unexpected-request', message: `the model asked for ${modifier.violations[0]}` })
      }
      if (error?.atriumTimeout) {
        // M3/M4 — a parse past its deadline cannot be stopped: the job is
        // `timeout` at once, and when the parse settles its template is
        // disposed and its reservation given back, against the budget of the
        // generation it started in (the caller's `releaseTexture`).
        settleLate(parsePromise, releaseReservation, disposeTemplate)
        return { ok: false, reason: 'timeout', message: PARSE_TIMEOUT_MESSAGE }
      }
      return stop({ ok: false, reason: 'parse', message: error?.message ?? 'the model could not be parsed' })
    }
    if (modifier.violations.length > 0) {
      return stop({ ok: false, reason: 'unexpected-request', message: `the model asked for ${modifier.violations[0]}` })
    }
    return { ok: true, template: gltf, textureBytes }
  } finally {
    revokeBlobs(blobUrls, urls)
  }
}

/** Every URI a rewritten .gltf JSON declares (A3 step 5). */
function declaredUris(json) {
  const out = []
  for (const entry of json?.buffers ?? []) if (typeof entry?.uri === 'string') out.push(entry.uri)
  for (const entry of json?.images ?? []) if (typeof entry?.uri === 'string') out.push(entry.uri)
  return out
}

/** True for a `data:` URI or one of the blob URLs this load created. */
function isMappedUri(uri, blobUrls) {
  if (uri.startsWith('data:')) return true
  for (const blobUrl of blobUrls.values()) if (blobUrl === uri) return true
  return false
}

/** Run A5's preflight, taking the images from wherever this format keeps them. */
function preflightFor(kind, bytes, json, dependencies) {
  if (kind === 'glb') {
    const glb = readGlb(bytes)
    if (!glb) return { problem: { reason: 'parse', message: 'the file is not a GLB' } }
    // M1 — a `.glb` that names a file it does not carry is refused here, before
    // any loader is built (see `glbDependencyProblem`).
    const dependency = glbDependencyProblem(glb.json)
    if (dependency) return { problem: dependency }
    const images = glbImages(glb.json, glb.bin)
    return outcomeOf(preflightProblem(glb.json, images))
  }
  if (!json) return { problem: { reason: 'parse', message: 'the .gltf JSON is missing' } }
  // A3/A5: a .gltf's images are its `data:` URIs, the buffer views of its
  // buffers (W2), or A3's fetched bytes — all of them checked.
  return outcomeOf(preflightProblem(json, gltfImages(json, dependencies)))
}

/**
 * W1 (round 3) — a passed preflight's byte count travels BESIDE `problem`,
 * never inside it. `preflightProblem` answers `{ reason: null, message: null,
 * textureBytes }` when it passes, and `parseTemplate` reads
 * `preflight.textureBytes`; wrapping the outcome as `{ problem }` put the
 * number at `preflight.problem.textureBytes`, which nothing reads, so the
 * world texture budget was never charged (the refusals were unaffected: they
 * carry a `reason`, which `parseTemplate` does read).
 */
function outcomeOf(outcome) {
  if (outcome.reason) return { problem: outcome }
  return { problem: null, textureBytes: outcome.textureBytes }
}

function bufferOf(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error('the model took too long to parse')
      error.atriumTimeout = true
      reject(error)
    }, ms)
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) },
    )
  })
}

/**
 * M3/M4 (round 6) — a parse that outlived its deadline settles LATER: dispose
 * what it built exactly once, and give its reservation back exactly once. Both
 * closures belong to the caller and name the generation the parse started in,
 * so a release after a world change cannot touch the new world's budget.
 */
function settleLate(parsePromise, releaseReservation, dispose) {
  const finish = (gltf) => {
    try { if (gltf) dispose(gltf) } catch { /* best effort */ }
    try { releaseReservation() } catch { /* best effort */ }
  }
  Promise.resolve(parsePromise).then(finish, () => finish(null))
}
