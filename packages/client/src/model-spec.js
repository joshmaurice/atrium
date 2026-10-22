// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * model-spec.js — the model spec rule set (Phase 3 step 3a, Z1 as amended by
 * A1/A6/A12). Pure and renderer-neutral: no DOM, no three.js, no fetch.
 *
 * `extras.atrium.model` is a plain object with exactly the keys `url`
 * (required), `sha256` and `bounds` (optional). The URL rule (A1) is exact and
 * shared with the server's `checkModelExtras`; the two implementations are
 * pinned to each other by `tests/fixtures/model-spec-vectors.json`, which both
 * read, so neither can drift.
 *
 * `parseModelSpec(extras)` reads an extras value; `validateModelHost(node)`
 * reads a whole `add` descriptor and adds the "no mesh" rule (A6). The bridge
 * calls the latter before any fetch or attach.
 */

/** The URL cap (A1 rule 1, L5). */
export const MODEL_URL_MAX = 2048

/** Bounds are three numbers, each inside this range (A12). */
export const BOUNDS_MIN = 0.001
export const BOUNDS_MAX = 1000

/** The exact key set of the model object (L4, "strict"). */
export const MODEL_KEYS = Object.freeze(['url', 'sha256', 'bounds'])

/**
 * The reason codes and their plain text. The codes are the contract the shared
 * vectors pin; the server names the same codes (send-policy.js).
 */
export const MODEL_REASONS = Object.freeze({
  'not-object':     'extras.atrium must be an object',
  'model-type':     'extras.atrium.model must be an object',
  'keys':           'extras.atrium.model must have exactly the keys url, sha256 and bounds, with url required',
  'url-type':       'url must be a string',
  'url-length':     `url must be 1 to ${MODEL_URL_MAX} characters`,
  'url-chars':      'url may not contain spaces, control characters or backslashes',
  'url-scheme':     'url must start with https:// or with a single /',
  'url-parse':      'url is not a valid https URL',
  'url-host':       'url must name a host',
  'url-credentials': 'url may not carry a username or password',
  'url-relative':   'url must stay on the same host',
  'sha256':         'sha256 must be 64 lowercase hex characters',
  'bounds':         `bounds must be three numbers from ${BOUNDS_MIN} to ${BOUNDS_MAX}`,
  'mesh':           'a node with extras.atrium.model cannot have a mesh',
})

/** The plain text for a reason code. */
export function modelReasonText(reason) {
  return MODEL_REASONS[reason] ?? 'the model value is invalid'
}

const SHA256_RE = /^[0-9a-f]{64}$/

function isPlainObject(v) {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

/**
 * A1 — is `url` a valid stored model URL? Returns a reason code, or null.
 *
 * A stored url is valid only if it is a string of 1–2048 characters with no
 * character below U+0021, no U+007F and no backslash, and either
 *   - starts with `https://` (lowercase), parses, has the `https:` protocol, a
 *     non-empty hostname and no username or password; or
 *   - starts with a single `/` and resolves against an arbitrary base without
 *     leaving that base's origin.
 *
 * @param {*} url
 * @returns {string|null}  reason code, or null when the URL is valid
 */
export function modelUrlProblem(url) {
  if (typeof url !== 'string') return 'url-type'
  if (url.length < 1 || url.length > MODEL_URL_MAX) return 'url-length'
  for (const ch of url) {
    const code = ch.codePointAt(0)
    if (code < 0x21 || code === 0x7f) return 'url-chars'
  }
  if (url.includes('\\')) return 'url-chars'

  if (url.startsWith('https://')) {
    let parsed
    try { parsed = new URL(url) } catch { return 'url-parse' }
    if (parsed.protocol !== 'https:') return 'url-scheme'
    if (!parsed.hostname) return 'url-host'
    if (parsed.username || parsed.password) return 'url-credentials'
    return null
  }

  if (url[0] === '/' && url[1] !== '/') {
    let parsed
    try { parsed = new URL(url, RELATIVE_BASE) } catch { return 'url-relative' }
    return parsed.origin === RELATIVE_BASE_ORIGIN ? null : 'url-relative'
  }

  return 'url-scheme'
}

/** The base a root-relative URL is measured against; never fetched (A1). */
export const RELATIVE_BASE = 'https://atrium.invalid'
export const RELATIVE_BASE_ORIGIN = 'https://atrium.invalid'

/** True for a URL that only means something against the world's own origin. */
export function isRootRelative(url) {
  return typeof url === 'string' && url[0] === '/' && url[1] !== '/'
}

/**
 * A1 — resolve a root-relative URL against the world's base and require the
 * result to stay on that base's origin. Returns `{ ok:true, url }` or
 * `{ ok:false, reason }` (`no-base` when there is no usable base, A13).
 *
 * A root-relative URL is never resolved against the page's own origin.
 *
 * @param {string} url
 * @param {string|null|undefined} worldBaseUrl
 * @returns {{ok: true, url: string} | {ok: false, reason: string}}
 */
export function resolveModelUrl(url, worldBaseUrl) {
  if (!isRootRelative(url)) return { ok: true, url }
  if (typeof worldBaseUrl !== 'string' || worldBaseUrl.length === 0) {
    return { ok: false, reason: 'no-base' }
  }
  let base, resolved
  try {
    base = new URL(worldBaseUrl)
    resolved = new URL(url, base)
  } catch {
    return { ok: false, reason: 'no-base' }
  }
  if (resolved.origin !== base.origin) return { ok: false, reason: 'no-base' }
  return { ok: true, url: resolved.href }
}

/**
 * L25a — the sky URL rule (library-sky, Z3/Z5).
 *
 * `extras.atrium.background.texture` is a legal new value only when it is a
 * valid A1 URL (an absolute `https://` URL or a single-slash root path, with no
 * control characters, backslashes or credentials) or `''`, which clears the
 * sky. There are no legacy forms: a document-relative value is refused exactly
 * like any other non-A1 value, because no live world has a sky.
 *
 * The reason codes are A1's, shared with the server's mirror in
 * `packages/server/src/send-policy.js` and pinned by
 * `tests/fixtures/sky-url-vectors.json`, which both read.
 *
 * @param {*} texture
 * @returns {string|null}  a reason code, or null when the value is legal
 */
export function skyUrlProblem(texture) {
  if (typeof texture !== 'string') return 'url-type'
  if (texture === '') return null
  return modelUrlProblem(texture)
}

/**
 * L25a — resolve a legal sky value against the world's base, exactly as a
 * model URL resolves (A1/A13). A value that is not a legal new sky is refused
 * with its reason; `''` is refused with `empty` because it means "no sky" and
 * is handled by the caller before any resolve (Z3 step 1).
 *
 * @param {string} texture
 * @param {string|null|undefined} worldBaseUrl
 * @returns {{ok: true, url: string} | {ok: false, reason: string}}
 */
export function resolveSkyUrl(texture, worldBaseUrl) {
  const problem = skyUrlProblem(texture)
  if (problem) return { ok: false, reason: problem }
  if (texture === '') return { ok: false, reason: 'empty' }
  return resolveModelUrl(texture, worldBaseUrl)
}

/** The sha256 rule: 64 lowercase hex characters (Z1). */
export function modelSha256Problem(value) {
  return typeof value === 'string' && SHA256_RE.test(value) ? null : 'sha256'
}

/** The bounds rule: exactly three finite numbers in [0.001, 1000] (A12). */
export function modelBoundsProblem(value) {
  if (!Array.isArray(value) || value.length !== 3) return 'bounds'
  for (const n of value) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return 'bounds'
    if (n < BOUNDS_MIN || n > BOUNDS_MAX) return 'bounds'
  }
  return null
}

/**
 * Z1 — the value-level rule for `extras`. A value that carries no
 * `extras.atrium.model` is not a model and is accepted with `spec: null`.
 *
 * @param {*} extras
 * @returns {{ok: true, spec: object|null} | {ok: false, reason: string, message: string}}
 */
export function parseModelSpec(extras) {
  if (extras == null || typeof extras !== 'object' || Array.isArray(extras)) {
    return { ok: true, spec: null }
  }
  const atrium = extras.atrium
  if (atrium === undefined) return { ok: true, spec: null }
  if (!isPlainObject(atrium)) return invalid('not-object')

  const model = atrium.model
  if (model === undefined) return { ok: true, spec: null }
  if (!isPlainObject(model)) return invalid('model-type')

  const keys = Object.keys(model)
  if (keys.some((k) => !MODEL_KEYS.includes(k))) return invalid('keys')
  if (!Object.hasOwn(model, 'url')) return invalid('keys')

  const urlProblem = modelUrlProblem(model.url)
  if (urlProblem) return invalid(urlProblem)
  if (model.sha256 !== undefined) {
    const problem = modelSha256Problem(model.sha256)
    if (problem) return invalid(problem)
  }
  if (model.bounds !== undefined) {
    const problem = modelBoundsProblem(model.bounds)
    if (problem) return invalid(problem)
  }

  const spec = { url: model.url }
  if (model.sha256 !== undefined) spec.sha256 = model.sha256
  if (model.bounds !== undefined) spec.bounds = [...model.bounds]
  return { ok: true, spec }
}

/**
 * A6 — the node-level rule: the value rule, plus "a node carrying
 * `extras.atrium.model` has no `mesh`".
 *
 * @param {*} node  a whole `add` descriptor
 * @returns {{ok: true, spec: object|null} | {ok: false, reason: string, message: string}}
 */
export function validateModelHost(node) {
  if (node == null || typeof node !== 'object') return { ok: true, spec: null }
  const parsed = parseModelSpec(node.extras)
  if (!parsed.ok) return parsed
  if (parsed.spec && node.mesh != null) return invalid('mesh')
  return parsed
}

/** The reason code for an extras value, or null when it is fine. */
export function modelExtrasProblem(extras) {
  const parsed = parseModelSpec(extras)
  return parsed.ok ? null : parsed.reason
}

function invalid(reason) {
  return { ok: false, reason, message: MODEL_REASONS[reason] }
}
