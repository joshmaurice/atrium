// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * library-grid.js — the Library grid (Phase 3 step 3b, Z2).
 *
 * The logic only: state, the tile enable rule, the descriptor a click builds and
 * the answer routing. No DOM — `app.js` builds the tiles through the injected
 * `renderTiles`, so a test drives the whole grid with plain values.
 *
 * A click adds AT ONCE (L27a): the same structural add as the Model form's Save,
 * named `firstFreeName(catalog name)`, marked `library: true` in the request so
 * `onStructureAnswer` can route its answer. The grid stays open after success,
 * so more than one item can be placed without reopening it.
 */

import { buildModelDescriptor } from './model-form.js'

/** Why a tile is not clickable right now, or null. */
export function tileBlockReason({ edit = false, blocked = false, waiting = false } = {}) {
  if (!edit) return 'Edit mode is off'
  if (blocked) return 'Waiting for the server…'
  if (waiting) return 'Waiting for the server…'
  return null
}

/** True while a tile may be clicked at all (Z2 + brief-gate correction 4). */
export function tileEnabled(state = {}) {
  return tileBlockReason(state) === null
}

/**
 * The generic error for a library add's answer, or null (Z2's routing).
 *
 * The grid's own status line carries a rejection it is still waiting on; when
 * the grid did NOT own the wait — it was closed, or another request is pending —
 * a rejection or an unknown answer is the app's generic error. An ACCEPTED
 * answer never reports anything, and a closed grid's accepted add selects
 * nothing.
 *
 * @param {boolean} owned    did `onAnswer` own this wait?
 * @param {'accepted'|'rejected'|'unknown'} status
 * @param {string} [message]
 * @returns {string|null}
 */
export function libraryAnswerError(owned, status, message) {
  if (owned) return null
  if (status === 'accepted') return null
  return `Couldn’t add: ${message ?? 'the world did not answer'}`
}

/**
 * The catalog's models grouped by category (Z2). The catalog's own order is kept
 * inside a group, and the groups appear in the order their first entry does.
 *
 * @param {Array<object>} models
 * @returns {Array<{category: string, entries: object[]}>}
 */
export function groupByCategory(models = []) {
  const groups = new Map()
  for (const entry of models) {
    const category = typeof entry?.category === 'string' && entry.category.length > 0 ? entry.category : 'Other'
    if (!groups.has(category)) groups.set(category, [])
    groups.get(category).push(entry)
  }
  return [...groups.entries()].map(([category, entries]) => ({ category, entries }))
}

/**
 * The Library grid.
 *
 * @param {object} args
 * @param {object} [args.gate]     `createFormGate()` — opening claim()s it
 * @param {string} [args.name]     this panel's name in the gate
 * @param {object} [args.deps]
 * @param {() => object} [args.deps.catalog]        the loaded catalog
 * @param {() => {edit: boolean, blocked: boolean}} [args.deps.canEdit]
 * @param {(text: string) => string} [args.deps.firstFreeName]
 * @param {(name: string) => boolean} [args.deps.isNameFree]
 * @param {() => {position: number[], rotation: number[]}} [args.deps.placement]
 * @param {(path: string) => string} [args.deps.storedUrl]
 * @param {(descriptor: object) => number} [args.deps.addNode]
 * @param {(seq: number, pending: object) => void} [args.deps.structureBegin]
 * @param {(seq: number, entry: object) => void} [args.deps.undoRegisterAdd]
 * @param {(name: string) => void} [args.deps.selectNode]
 * @param {() => void} [args.deps.refreshActions]
 * @param {(groups: Array<object>, opts: object) => void} [args.deps.renderTiles]
 * @param {(visible: boolean) => void} [args.deps.setVisible]  V1 — the panel's own visibility
 */
export function createLibraryGrid({ gate = null, name = 'library', deps = {} } = {}) {
  const state = {
    open: false,
    waiting: null,       // the seq of the one library add in flight
    pendingName: null,
    status: null,
    statusKind: null,    // 'error' | null
  }

  function render() {
    const catalog = deps.catalog?.() ?? { models: [] }
    const { edit = false, blocked = false } = deps.canEdit?.() ?? {}
    const enabled = tileEnabled({ edit, blocked, waiting: state.waiting !== null })
    deps.renderTiles?.(groupByCategory(catalog.models ?? []), {
      enabled,
      reason: tileBlockReason({ edit, blocked, waiting: state.waiting !== null }),
      credit: catalog.credit ?? null,
      creditUrl: catalog.creditUrl ?? null,
      onPick: pick,
    })
  }

  /** Where the grid's own status line gets its text. */
  function setStatus(text, kind = null) {
    state.status = text
    state.statusKind = kind
    deps.setStatus?.(text, kind)
  }

  /** Z2/L27a — a tile click: add at once, named and pinned from the catalog. */
  function pick(id) {
    if (!state.open) return null
    if (state.waiting !== null) return null
    const { edit = false, blocked = false } = deps.canEdit?.() ?? {}
    if (!edit || blocked) return null

    const catalog = deps.catalog?.() ?? { models: [] }
    const entry = (catalog.models ?? []).find((model) => model.id === id)
    if (!entry) return null

    const name = deps.firstFreeName?.(entry.name) ?? entry.name
    if (deps.isNameFree && !deps.isNameFree(name)) {
      setStatus('No free name for a new model', 'error')
      render()
      return null
    }

    const { position, rotation } = deps.placement?.() ?? { position: [0, 0, 0], rotation: [0, 0, 0] }
    const descriptor = buildModelDescriptor({
      name, position, rotation,
      url: deps.storedUrl?.(entry.url) ?? entry.url,
      bounds: entry.bounds,
      sha256: entry.sha256,
    })

    let seq
    try {
      seq = deps.addNode?.(descriptor)
    } catch (error) {
      setStatus(`Couldn’t add: ${error?.message ?? error}`, 'error')
      render()
      return null
    }
    // The answer cannot arrive before this returns (one thread).
    deps.structureBegin?.(seq, { name, descriptor, library: true })
    deps.undoRegisterAdd?.(seq, { name, duplicate: false })
    state.waiting = seq
    state.pendingName = name
    setStatus(null)
    render()
    deps.refreshActions?.()
    return { seq, name, descriptor }
  }

  /**
   * The answer to a library add. Returns whether the grid still owned that wait:
   * app.js routes a rejection from a CLOSED grid to the generic error, and never
   * selects the node for a closed one (Z2).
   *
   * @param {number} seq
   * @param {'accepted'|'rejected'|'unknown'} status
   * @param {string} [message]
   * @returns {boolean}
   */
  function onAnswer(seq, status, message) {
    if (!state.open || state.waiting !== seq) return false
    state.waiting = null
    if (status === 'accepted') {
      setStatus(null)
      render()
      deps.refreshActions?.()
      deps.selectNode?.(state.pendingName)
      return true
    }
    setStatus(status === 'rejected'
      ? (message || 'the item was refused')
      : 'the world did not answer', 'error')
    render()
    deps.refreshActions?.()
    return true
  }

  function open() {
    state.open = true
    state.waiting = null
    state.pendingName = null
    setStatus(null)
    // V1 (round 2) — the panel's visibility follows its state, EVERY time, so the
    // grid can never be logically open and still `display:none` (the round-1
    // bug: `open()` changed state and re-rendered but never showed the element).
    deps.setVisible?.(true)
    gate?.claim(name)
    render()
    deps.refreshActions?.()
    return true
  }

  /**
   * Cancel, Escape, another form, Edit off and a reconnect all close it. Closing
   * only ends the grid's wait: the structural answer still reaches the undo
   * engine, so the add stays undoable (Z2).
   */
  function close() {
    state.open = false
    state.waiting = null
    state.pendingName = null
    setStatus(null)
    // V1 — and hidden with it, every time.
    deps.setVisible?.(false)
    gate?.release(name)
    render()
    deps.refreshActions?.()
  }

  function isOpen() { return state.open }

  /** A world boundary. It closes the panel (and so hides it) exactly once. */
  function reset() { close() }

  /** The palette re-reads its enable rule here; the grid does the same. */
  function refresh() { render() }

  return {
    open, close, isOpen, reset, render, refresh, pick, onAnswer, setStatus,
    get waiting() { return state.waiting },
    get status() { return state.status },
    get statusKind() { return state.statusKind },
    get seq() { return state.waiting },
  }
}
