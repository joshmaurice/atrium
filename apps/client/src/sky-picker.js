// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * sky-picker.js — the Sky picker (Phase 3 step 3b, Z4).
 *
 * A "World" row with one select: None, the catalog's skies, and a disabled
 * "Custom" entry shown only while the world's texture is not a catalog sky (the
 * SOM Inspector remains the way to set an arbitrary URL). The logic only —
 * `app.js` builds the options and the status line through the injected ports, so
 * a test drives the whole picker with plain values.
 *
 * ONE WRITE AT A TIME (R2): while a sky write waits for its answer the select is
 * disabled, and the next change cannot start. The write carries the whole extras
 * object (the protocol has no leaf-level document send yet), but it is built from
 * a DEEP COPY of the current `som.extras`, so nothing else is changed — and a
 * rejected write is rolled back for the two background leaves only, through
 * `applyLocally`, and is NEVER sent.
 */

/** The select's value for "no sky". */
export const SKY_NONE = ''
/** The select's value for a texture that is not a catalog sky. */
export const SKY_CUSTOM = '__custom__'

/** The two leaves this picker owns, relative to the root extras object. */
export const BACKGROUND_LEAVES = Object.freeze(['atrium.background.type', 'atrium.background.texture'])

/** A deep copy of a JSON-ish extras object. */
function deepCopy(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

/**
 * The select's value for a stored texture: None, a catalog sky's id, or Custom.
 *
 * The SOM stores the URL the write STORED (L22a), so each sky's stored URL is
 * computed the same way before the comparison.
 */
export function skyValueFor(texture, skies, { worldBaseUrl = null, pageOrigin = '', storedUrl = (path) => path } = {}) {
  if (typeof texture !== 'string' || texture === '') return SKY_NONE
  for (const entry of skies ?? []) {
    if (storedUrl(entry.url, worldBaseUrl, pageOrigin) === texture) return entry.id
  }
  return SKY_CUSTOM
}

/**
 * Z4 — the extras a sky write sends: a deep copy of the CURRENT extras with only
 * `atrium.background.type` ('equirectangular') and `.texture` changed. Every
 * other field is exactly as it now is.
 *
 * @param {object} currentExtras
 * @param {string} texture   the stored URL, or '' for None
 */
export function buildSkyExtras(currentExtras, texture) {
  const next = deepCopy(currentExtras ?? {})
  if (next.atrium == null || typeof next.atrium !== 'object') next.atrium = {}
  if (next.atrium.background == null || typeof next.atrium.background !== 'object') next.atrium.background = {}
  next.atrium.background.type = 'equirectangular'
  next.atrium.background.texture = texture
  return next
}

/**
 * Z4 — the rollback of a refused write: the two leaves put back on a copy of the
 * CURRENT extras, with every other field as it now is. Returns the extras to
 * assign locally, or null when there is nothing to put back.
 */
export function restoreSkyExtras(currentExtras, previous) {
  if (!previous) return null
  const restored = deepCopy(currentExtras ?? {})
  if (restored.atrium == null || typeof restored.atrium !== 'object') restored.atrium = {}
  const background = (restored.atrium.background != null && typeof restored.atrium.background === 'object')
    ? restored.atrium.background
    : (restored.atrium.background = {})
  for (const leaf of ['type', 'texture']) {
    const value = previous[leaf]
    if (value === undefined) delete background[leaf]
    else background[leaf] = value
  }
  if (Object.keys(background).length === 0) delete restored.atrium.background
  return restored
}

/** The background object of an extras value, or null. */
export function backgroundOf(extras) {
  const background = extras?.atrium?.background
  return background != null && typeof background === 'object' ? background : null
}

/**
 * The Sky picker.
 *
 * @param {object} args
 * @param {object} [args.deps]
 * @param {() => object|null} [args.deps.som]
 * @param {() => object} [args.deps.catalog]
 * @param {() => boolean} [args.deps.canEdit]
 * @param {() => string|null} [args.deps.worldBaseUrl]
 * @param {() => string} [args.deps.pageOrigin]
 * @param {(path: string, worldBaseUrl: string|null, pageOrigin: string) => string} [args.deps.storedUrl]
 * @param {(extras: object) => number} [args.deps.applyExtras]  assigns som.extras (which sends)
 * @param {(fn: Function) => void} [args.deps.applyLocally]     a SOM change that does NOT send
 * @param {{update: Function, retry: Function}} [args.deps.sky]
 * @param {(state: object) => void} [args.deps.renderSelect]
 * @param {(text: string|null) => void} [args.deps.setStatus]
 * @param {(visible: boolean) => void} [args.deps.setRetryVisible]
 */
export function createSkyPicker({ deps = {} } = {}) {
  const state = {
    waiting: null,        // the seq of the one sky write in flight
    pending: null,        // { type, texture } this write sent
    previous: null,       // the two leaves' values before it
    status: null,         // a refusal, shown under the select
    failure: null,        // { reason, message } the controller reported
  }

  const storedUrlFor = (path) => deps.storedUrl?.(path, deps.worldBaseUrl?.() ?? null, deps.pageOrigin?.() ?? '')
  const skies = () => deps.catalog?.()?.skies ?? []
  const currentTexture = () => backgroundOf(deps.som?.()?.extras)?.texture
  const currentBackground = () => backgroundOf(deps.som?.()?.extras)

  /** The select's value for what the SOM holds right now. */
  function valueForSom() {
    return skyValueFor(currentTexture(), skies(), {
      worldBaseUrl: deps.worldBaseUrl?.() ?? null,
      pageOrigin: deps.pageOrigin?.() ?? '',
      storedUrl: (path, base, origin) => deps.storedUrl?.(path, base, origin) ?? path,
    })
  }

  function render() {
    const value = valueForSom()
    const edit = deps.canEdit?.() ?? false
    deps.renderSelect?.({
      value,
      options: skies().map((entry) => ({ id: entry.id, name: entry.name })),
      custom: value === SKY_CUSTOM,
      enabled: edit && state.waiting === null,
    })
    deps.setStatus?.(state.status ?? state.failure?.message ?? state.failure?.reason ?? null)
    deps.setRetryVisible?.(Boolean(state.failure) && edit)
  }

  /** world:loaded, som:set of __document__, and after every answer. */
  function sync() { render() }

  /** The enable rule, re-read wherever the palette refreshes its buttons. */
  function refresh() { render() }

  /** A world change: the failure and any wait go with it. */
  function reset() {
    state.waiting = null
    state.pending = null
    state.previous = null
    state.status = null
    state.failure = null
    render()
  }

  /** Z4 — the select's change: one write, from a copy of the CURRENT extras. */
  function change(value) {
    if (state.waiting !== null) return null
    if (!deps.canEdit?.()) return null
    const som = deps.som?.()
    if (!som) return null

    const current = som.extras ?? {}
    const background = backgroundOf(current)
    const sky = value === SKY_NONE || value === SKY_CUSTOM
      ? null
      : skies().find((entry) => entry.id === value)
    if (value !== SKY_NONE && value !== SKY_CUSTOM && !sky) return null

    const texture = sky ? storedUrlFor(sky.url) : ''
    const next = buildSkyExtras(current, texture)

    let seq
    try {
      seq = deps.applyExtras?.(next)
    } catch (error) {
      state.status = `Couldn’t set the sky: ${error?.message ?? error}`
      render()
      return null
    }

    state.waiting = seq
    state.pending = { type: next.atrium.background.type, texture: next.atrium.background.texture }
    state.previous = { type: background?.type, texture: background?.texture }
    state.status = null
    state.failure = null
    render()
    // The server's echo of the owner's own send resolves the pending edit but
    // emits no som:set, so the sky is updated locally too.
    deps.sky?.update?.(next.atrium.background, deps.worldBaseUrl?.() ?? null)
    return seq
  }

  /** edit:accepted for this write: the select comes back. */
  function onAccepted(seq) {
    if (state.waiting !== seq) return false
    state.waiting = null
    state.pending = null
    state.previous = null
    state.status = null
    render()
    return true
  }

  /**
   * edit:rejected for this write (R2). The client does not roll the SOM back, so
   * the picker does — for the two leaves only, WITHOUT sending. When another
   * session's background change has already arrived, that change is the newer
   * value and is left alone.
   */
  function onRejected(seq, message) {
    if (state.waiting !== seq) return false
    state.waiting = null

    const som = deps.som?.()
    const background = backgroundOf(som?.extras)
    const stillOurs = Boolean(state.pending) &&
      background?.type === state.pending.type &&
      background?.texture === state.pending.texture

    if (stillOurs) {
      const restored = restoreSkyExtras(som?.extras ?? {}, state.previous)
      if (restored) {
        deps.applyLocally?.(() => { som.extras = restored })
        deps.sky?.update?.(backgroundOf(restored), deps.worldBaseUrl?.() ?? null)
      }
    }

    state.status = message || 'the sky was refused'
    state.pending = null
    state.previous = null
    render()
    return true
  }

  /** edit:unknown: the connection went; the reconnect's som-dump is the truth. */
  function onUnknown(seq) {
    if (state.waiting !== seq) return false
    state.waiting = null
    state.pending = null
    state.previous = null
    render()
    return true
  }

  /**
   * Z4 — the sky controller's report. Only a CURRENT failure is shown: the
   * controller never reports a superseded generation's failure, and a success
   * clears both the failure and the Retry button.
   */
  function onSkyResult(result) {
    if (!result) return
    if (result.ok) {
      state.failure = null
      render()
      return
    }
    if (result.reason === 'superseded' || result.reason === 'disposed') return
    state.failure = { reason: result.reason ?? 'failed', message: result.message ?? null }
    render()
  }

  /** Z4 — the Retry button: the controller tries the world's current sky again. */
  function retry() {
    state.failure = null
    render()
    return deps.sky?.retry?.()
  }

  return {
    sync, refresh, reset, change, onAccepted, onRejected, onUnknown, onSkyResult, retry, render,
    get waiting() { return state.waiting },
    get status() { return state.status },
    get failure() { return state.failure },
    get value() { return valueForSom() },
  }
}
