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
 *
 * Round 2 (V3): EVERY controller call this picker makes has its result routed to
 * `onSkyResult` — one place, inside the picker — so no call site (here or in
 * app.js) can drop it. `retry()` never clears the failure itself; the result
 * decides. And Retry is offered only for a failure a retry can fix (V3.4):
 * a rule refusal shows its reason with no button.
 */

import { isSkyRetryable } from '@atrium/client/model-fetch'

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
 * Z5 (edit-polish-3, L4a) — a catalog sky is recognised BY PATH. The stored
 * texture is resolved against the world's base (or, with no base, the page's
 * origin) and matched against an entry's own `url`: no query, no fragment, and
 * the pathnames equal. Round 1 compared the stored texture as a STRING with the
 * URL `storedUrl()` computes for THIS viewer, so a world on origin A whose owner
 * stored the root path showed "Custom" on a page served from origin B, and an
 * owner on B's absolute URL showed "Custom" on A — the sky itself was right, only
 * the label was wrong.
 *
 * The match is a PATH HEURISTIC, not a content check (review 7, nit): catalog
 * file names carry the first 12 hex digits of the file's sha256
 * (`<id>-<sha12>.<ext>`), which makes it strong, but a host that is not the
 * library's can serve other bytes at that same path and be labelled wrongly. The
 * sky that is shown is unaffected.
 */
export function skyValueFor(texture, skies, { worldBaseUrl = null, pageOrigin = '' } = {}) {
  if (typeof texture !== 'string' || texture === '') return SKY_NONE
  const stored = storedPath(texture, worldBaseUrl ?? pageOrigin)
  if (stored === null) return SKY_CUSTOM
  for (const entry of skies ?? []) {
    if (stored === entry.url) return entry.id
  }
  return SKY_CUSTOM
}

/**
 * Z5 — the path a stored texture names, or null when it cannot name one: it must
 * resolve against `base`, and carry no query and no fragment. `entry.url` is a
 * root path, so a stored URL that rounds to that path matches it whatever host
 * is serving the bytes.
 */
function storedPath(texture, base) {
  let url
  try { url = new URL(texture, base || undefined) } catch { return null }
  if (url.search || url.hash) return null
  return url.pathname
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
    // V3.4 — Retry is offered only for a failure a retry can fix. A refusal by
    // rule (any resolveSkyUrl code, a type this client does not render) shows its
    // reason with NO button: retrying it can never help.
    deps.setRetryVisible?.(Boolean(state.failure) && edit && isSkyRetryable(state.failure.reason))
  }

  /**
   * V3.1 — THE one place a controller result reaches the report. Every call this
   * picker makes to the controller (`change`, `onRejected`'s local update,
   * `retry`) goes through here, so no call site can drop a result. The promise is
   * returned too, so a caller (app.js, a test) can await the same answer.
   *
   * @param {Promise<object>|object|undefined} result
   * @returns {Promise<object>}
   */
  function route(result) {
    if (!result || typeof result.then !== 'function') {
      onSkyResult(result)
      return Promise.resolve(result)
    }
    return Promise.resolve(result).then(
      (value) => { onSkyResult(value); return value },
      (error) => {
        // A controller that throws is a failure like any other.
        const failure = { ok: false, reason: 'network', message: String(error?.message ?? error) }
        onSkyResult(failure)
        return failure
      },
    )
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
    // Z5 — an UNCHANGED pick sends nothing, and does so BEFORE any URL is
    // computed. One id can now stand for several stored URLs (a catalog sky
    // stored as a root path in one world and as an absolute URL in another), so
    // re-choosing the option the select already shows would rewrite the world's
    // sky from another origin. Browsers fire no `change` for the shown option,
    // which is what hid this; the picker itself refuses it.
    if (value === valueForSom()) return null
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
    // V3.1 — the result is routed here (one place) and the promise is returned,
    // so no call site can drop it. The server's echo of the owner's own send
    // resolves the pending edit but emits no som:set, so the sky is updated
    // locally too.
    return route(deps.sky?.update?.(next.atrium.background, deps.worldBaseUrl?.() ?? null))
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
        // V3.1 — the rollback's own controller call is routed like every other.
        route(deps.sky?.update?.(backgroundOf(restored), deps.worldBaseUrl?.() ?? null))
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

  /**
   * Z4 — the Retry button: the controller tries the world's current sky again.
   *
   * V3.2 — it does NOT clear the failure itself. The result decides: a success
   * clears it (`onSkyResult`), a failure shows the new reason and keeps Retry.
   * V3.1 — its promise is routed (and returned) like `change()`'s.
   */
  function retry() {
    if (!deps.sky?.retry) return null
    return route(deps.sky.retry())
  }

  return {
    sync, refresh, reset, change, onAccepted, onRejected, onUnknown, onSkyResult, retry, render,
    get waiting() { return state.waiting },
    get status() { return state.status },
    get failure() { return state.failure },
    get value() { return valueForSom() },
  }
}
