// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import * as THREE from 'three'
import { resolveSkyUrl, modelReasonText } from '@atrium/client/model-spec'
import { fetchImage as defaultFetchImage } from '@atrium/client/model-fetch'
import { imageHeader } from './model-parse.js'

/**
 * load-background.js — the sky controller (Phase 3 step 3b, Z3, L25a/L26).
 *
 * ONE controller per scene, and it ALONE writes `scene.background` and
 * `scene.environment`. Before this round the free `loadBackground` wrote them and
 * every caller cleared them first (`app.js` L639–641, the SOM Inspector's
 * L217–218); both halves are gone, because a controller that owns the slots can
 * re-assert them and cannot be raced by a caller.
 *
 * The rule (R4): only the CURRENT generation may touch the scene's slots,
 * `loaded`, `failedUrl`, or report a result. Every superseded or cancelled
 * generation, whenever it settles, disposes any texture it made, revokes its
 * blob URL, and changes nothing else.
 *
 * State:
 *   generation  a counter; every new request and every cancellation bumps it
 *   loaded      `{ url, texture }` currently in the scene, or null
 *   pending     `{ generation, url, controller }` in flight, or null
 *   failedUrl   the URL whose load failed most recently, or null
 *
 * `loaded` and `failedUrl` are never both set: a failure clears `loaded`.
 */

/** L26 — a decode that has not settled in this long is abandoned. */
export const SKY_DECODE_TIMEOUT_MS = 10_000

/** L26 — a sky's largest side, and its largest area. */
export const SKY_MAX_SIDE = 4096
export const SKY_MAX_AREA = 4096 * 2048

/** The sky's own reason text; the URL codes come from the shared model rules. */
export const SKY_REASONS = Object.freeze({
  'unsupported-image':   'the sky is not a PNG, JPEG or WebP image',
  'bad-size':            'the sky has no usable size',
  'too-large-dimensions': `the sky is larger than ${SKY_MAX_SIDE} × ${SKY_MAX_AREA / SKY_MAX_SIDE}`,
  'decode':              'the sky could not be decoded',
  'empty':               'this world has no sky',
  'failed':              'the sky could not be loaded',
})

/** The plain text for a sky reason code. */
export function skyReasonText(reason) {
  return SKY_REASONS[reason] ?? modelReasonText(reason)
}

/** The default decode: a `blob:` URL through the same TextureLoader as before. */
export function decodeWithTextureLoader(blobUrl) {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(blobUrl, resolve, undefined, reject)
  })
}

/** The header checks (L26): PNG/JPEG/WebP only, sides 1–4096, area ≤ 4096×2048. */
export function skyHeaderProblem(header) {
  if (!header) return 'unsupported-image'
  if (header.format !== 'png' && header.format !== 'jpeg' && header.format !== 'webp') return 'unsupported-image'
  const { width, height } = header
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return 'bad-size'
  if (width > SKY_MAX_SIDE || height > SKY_MAX_SIDE) return 'too-large-dimensions'
  if (width * height > SKY_MAX_AREA) return 'too-large-dimensions'
  return null
}

/** The MIME type a header's format maps to, for the blob the decoder reads. */
function mimeFor(format) {
  if (format === 'png') return 'image/png'
  if (format === 'webp') return 'image/webp'
  return 'image/jpeg'
}

/**
 * A decode bounded at `ms`. On the bound it answers `{ timedOut: true, promise }`
 * and the CALLER attaches the late disposal: a decode that settles after the
 * bound is disposed when it settles, never left to leak.
 */
function settleWithBound(promise, ms) {
  return new Promise((resolve) => {
    let done = false
    const timer = setTimeout(() => {
      if (done) return
      done = true
      resolve({ timedOut: true, promise })
    }, ms)
    promise.then(
      (texture) => { if (done) return; done = true; clearTimeout(timer); resolve({ texture }) },
      (error)   => { if (done) return; done = true; clearTimeout(timer); resolve({ error }) },
    )
  })
}

/**
 * Create the sky controller for one scene (Z3).
 *
 * @param {object} args
 * @param {THREE.Scene} args.scene
 * @param {Function} args.fetchImage   `fetchImage` from @atrium/client/model-fetch
 * @param {(blobUrl: string) => Promise<object>} [args.decode]   default: TextureLoader
 * @param {(blob: Blob) => string} [args.createObjectURL]
 * @param {(url: string) => void} [args.revokeObjectURL]
 * @param {number} [args.decodeTimeoutMs]
 */
export function createSkyLoader({
  scene,
  fetchImage = defaultFetchImage,
  decode = decodeWithTextureLoader,
  createObjectURL = (blob) => URL.createObjectURL(blob),
  revokeObjectURL = (url) => URL.revokeObjectURL(url),
  decodeTimeoutMs = SKY_DECODE_TIMEOUT_MS,
} = {}) {
  let generation = 0
  let loaded = null
  let pending = null
  let failedUrl = null
  let last = null            // { bg, worldBaseUrl } — what retry() re-runs
  let disposed = false

  const isCurrent = (gen) => gen === generation

  /** The ONE place the scene's two slots are written. */
  function setSlots(texture) {
    scene.background = texture
    scene.environment = texture
  }

  function disposeTexture(texture) {
    try { texture?.dispose?.() } catch { /* a texture that refuses to dispose is not fatal */ }
  }

  /** Cancel the request in flight: its generation is finished at once. */
  function cancelPending() {
    if (!pending) return
    const cancelled = pending
    pending = null
    generation += 1
    try { cancelled.controller.abort('superseded') } catch { /* already aborted */ }
  }

  /** No sky: cancel, dispose, null both slots, forget the failure. */
  function clearAll() {
    cancelPending()
    if (loaded) { disposeTexture(loaded.texture); loaded = null }
    setSlots(null)
    failedUrl = null
  }

  /** A failure of the CURRENT generation: no sky is shown, never the old one. */
  function failCurrent(gen, url, reason, message) {
    if (pending && pending.generation === gen) pending = null
    if (loaded) { disposeTexture(loaded.texture); loaded = null }
    setSlots(null)
    failedUrl = url
    return { ok: false, reason, message: message ?? skyReasonText(reason) }
  }

  /**
   * Z3 — the one entry point. Called from `world:loaded`, from `som:set` of
   * `__document__`, and by the picker.
   *
   * @param {{type?: string, texture?: string}|null|undefined} bg
   * @param {string|null} [worldBaseUrl]
   * @returns {Promise<{ok: true} | {ok: false, reason: string, message?: string}>}
   *   the promise for THIS generation; `superseded` says a newer value won.
   */
  async function update(bg, worldBaseUrl = null) {
    if (disposed) return { ok: false, reason: 'disposed' }
    last = { bg, worldBaseUrl }

    const object = bg && typeof bg === 'object' ? bg : null
    const texture = object?.texture
    const type = object?.type

    // 1. no sky: '', missing, or a type this client does not render.
    const typeOk = type === undefined || type === null || type === 'equirectangular'
    if (typeof texture !== 'string' || texture === '' || !typeOk) {
      clearAll()
      return { ok: true }
    }

    // 2. resolve — an A1 value resolves as a model does; anything else is refused.
    const resolved = resolveSkyUrl(texture, worldBaseUrl)
    if (!resolved.ok) {
      clearAll()
      return { ok: false, reason: resolved.reason, message: skyReasonText(resolved.reason) }
    }
    const url = resolved.url

    // 3. THE NEWEST VALUE WINS: a differing pending request is cancelled BEFORE
    //    the shortcuts below, so A loaded → B pending → A chosen again leaves A
    //    shown, and B's late texture is disposed by the stale rule.
    if (pending && pending.url !== url) cancelPending()

    // 4. already on its way.
    if (pending && pending.url === url) return { ok: true }

    // 5. an unchanged URL is re-asserted, never refetched: `world:loaded` clears
    //    both slots first and repeats on the same SOM when an external reference
    //    loads, and this is what keeps its sky (R1).
    if (loaded && loaded.url === url) {
      setSlots(loaded.texture)
      return { ok: true }
    }

    // 6. a failed URL is not refetched on every World Info change (P1's rename
    //    problem): only retry() or a new world tries it again.
    if (failedUrl === url) return { ok: false, reason: 'failed', message: skyReasonText('failed') }

    // 7. a new generation.
    cancelPending()
    const gen = ++generation
    const controller = new AbortController()
    pending = { generation: gen, url, controller }

    try {
      const fetched = await fetchImage({ url, worldBaseUrl, signal: controller.signal })
      if (!isCurrent(gen)) return { ok: false, reason: 'superseded' }
      if (!fetched.ok) return failCurrent(gen, url, fetched.reason, fetched.message)

      const header = imageHeader(fetched.bytes)
      const headerProblem = skyHeaderProblem(header)
      if (headerProblem) return failCurrent(gen, url, headerProblem)

      const blobUrl = createObjectURL(new Blob([fetched.bytes], { type: mimeFor(header.format) }))
      const decoded = await settleWithBound(decode(blobUrl), decodeTimeoutMs)
      revokeObjectURL(blobUrl)

      // A decode that settles after its bound is disposed when it settles.
      if (decoded.timedOut) decoded.promise.then((texture) => disposeTexture(texture), () => {})

      if (!isCurrent(gen)) {
        disposeTexture(decoded.texture)
        return { ok: false, reason: 'superseded' }
      }
      if (!decoded.texture) return failCurrent(gen, url, 'decode')

      const texture = decoded.texture
      texture.mapping = THREE.EquirectangularReflectionMapping
      texture.colorSpace = THREE.SRGBColorSpace
      if (loaded) disposeTexture(loaded.texture)
      setSlots(texture)
      loaded = { url, texture }
      failedUrl = null
      pending = null
      return { ok: true }
    } catch (error) {
      if (!isCurrent(gen)) return { ok: false, reason: 'superseded' }
      return failCurrent(gen, url, 'network', error?.message ?? null)
    }
  }

  /** Z4's Retry: forget the failure and try the same values once more. */
  function retry() {
    failedUrl = null
    if (!last) return Promise.resolve({ ok: false, reason: 'empty', message: skyReasonText('empty') })
    return update(last.bg, last.worldBaseUrl)
  }

  /**
   * A world boundary: `beginNewWorld()` in app.js (which runs before every
   * `loadWorld`/`loadWorldFromData`, including static loads with no server), and
   * `connecting`/`disconnected`, beside `modelBridge.resetWorld()`. A world
   * change therefore never reuses a pending request from the previous world,
   * even for the same URL (R1).
   */
  function resetWorld() {
    cancelPending()
    if (loaded) { disposeTexture(loaded.texture); loaded = null }
    setSlots(null)
    failedUrl = null
    last = null
  }

  /** As resetWorld(), and later calls do nothing. */
  function dispose() {
    if (disposed) return
    resetWorld()
    disposed = true
  }

  return {
    update,
    retry,
    resetWorld,
    dispose,
    skyHeaderProblem,
    get disposed() { return disposed },
    get loaded() { return loaded },
    get pending() { return pending },
    get failedUrl() { return failedUrl },
    get last() { return last },
  }
}

/**
 * Deprecated for one release (Z3): the free function is a thin wrapper over one
 * throwaway controller, kept only so a caller that has not moved yet still
 * loads a sky. Its own state is per call, so a repeated call refetches — use
 * `createSkyLoader` instead.
 */
export function loadBackground(threeScene, bg, baseUrl) {
  const loader = createSkyLoader({ scene: threeScene })
  return loader.update(bg, baseUrl)
}
