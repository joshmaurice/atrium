// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * model-form.js — the Model form's logic, with no DOM of its own (Phase 3
 * step 3a: Z7).
 *
 * `app.js` is wiring only: it hands this module the elements (real ones in the
 * page, fake ones in the tests), the client calls (`addNode`, `structure`,
 * `undo`), the placement and the name rules, and the panel refreshers. Every
 * decision — when Save is enabled, what a Check leaves behind, what the
 * descriptor holds, what a rejection does — lives here and is tested without a
 * browser.
 *
 * The save path is exactly the palette's (P8/Z7): a structural request through
 * `structure.begin('add', seq, { name, descriptor, model: true })`, recorded in
 * the undo engine by `undo.registerAdd(seq, { name, duplicate: false })`, and
 * answered through `onStructureAnswer`. The Model button has no `data-kind`:
 * the palette handler would throw on an unknown kind.
 */

import { modelUrlProblem, modelReasonText, MODEL_URL_MAX } from '@atrium/client/model-spec'

/** The default name when the URL has no file name of its own (Z7). */
export const DEFAULT_MODEL_NAME = 'Model'

/** How much of the URL the panel row shows (Z7: middle-truncated). */
export const URL_DISPLAY_CHARS = 44

/** The privacy note (L12) — kept here so both the page and its test use one copy. */
export const PRIVACY_NOTE = "Visitors' browsers download this file from its host, which sees their IP addresses."

/**
 * The name a URL suggests: its file name without the extension, `Model` if
 * there is none (Z7). The caller makes it free and cuts it to the name rules.
 */
export function modelNameFromUrl(url) {
  let path = String(url ?? '').split('?')[0].split('#')[0]
  const cut = path.lastIndexOf('/')
  if (cut >= 0) path = path.slice(cut + 1)
  const dot = path.lastIndexOf('.')
  if (dot > 0) path = path.slice(0, dot)
  const name = path.trim()
  return name || DEFAULT_MODEL_NAME
}

/** `abcdef…wxyz`, keeping both ends visible (Z7's panel row). */
export function middleTruncate(text, max = URL_DISPLAY_CHARS) {
  const value = String(text ?? '')
  if (value.length <= max) return value
  const front = Math.ceil((max - 1) / 2)
  const back = Math.floor((max - 1) / 2)
  return `${value.slice(0, front)}…${value.slice(value.length - back)}`
}

/** A successful Check's result, as the form holds it. */
export function checkResult({ vertices = 0, bytes = 0, bounds = null, sha256 = null, kind = 'glb' } = {}) {
  return { vertices, bytes, bounds, sha256, kind }
}

/** “Loaded: 12,400 vertices, 3.1 MB” (L9). */
export function checkSummary(result) {
  const vertices = Number(result?.vertices ?? 0).toLocaleString('en-US')
  const mb = (Number(result?.bytes ?? 0) / (1024 * 1024)).toFixed(1)
  return `Loaded: ${vertices} vertices, ${mb} MB`
}

/**
 * Z7 — the descriptor Save sends. Position and yaw come from the palette's
 * placement; the spec carries the URL, the measured `bounds` and, only when the
 * pin box was on for a checked `.glb`, the `sha256` of the bytes that loaded.
 */
export function buildModelDescriptor({ name, position, rotation, url, bounds, sha256 = null }) {
  const model = { url, bounds }
  if (sha256) model.sha256 = sha256
  return { name, translation: position, rotation, extras: { atrium: { model } } }
}

/**
 * The gate that keeps one form open at a time (Z7). Both forms register a
 * closer; claiming closes whichever form held the gate.
 */
export function createFormGate() {
  const closers = new Map()
  let current = null
  return {
    register(name, close) { closers.set(name, close) },
    claim(name) {
      if (current && current !== name) closers.get(current)?.()
      current = name
    },
    release(name) { if (current === name) current = null },
    get current() { return current },
    isOpen: (name) => current === name,
  }
}

/**
 * The Model form (Z7).
 *
 * @param {object} args
 * @param {object} args.elements  `{ form, url, privacy, check, status, pinRow, pin, error, save, cancel }`
 * @param {object} [args.deps]
 * @param {(args: {url: string, worldBaseUrl: string|null}) => Promise<object>} [args.deps.checkModel]
 * @param {() => string|null} [args.deps.worldBaseUrl]
 * @param {() => {position: number[], rotation: number[]}} [args.deps.placement]
 * @param {(text: string) => boolean} [args.deps.isNameFree]
 * @param {(text: string) => string} [args.deps.firstFreeName]
 * @param {(descriptor: object) => number} [args.deps.addNode]
 * @param {(seq: number, pending: object) => void} [args.deps.structureBegin]
 * @param {(seq: number, entry: object) => void} [args.deps.undoRegisterAdd]
 * @param {() => void} [args.deps.refreshActions]
 * @param {(name: string) => void} [args.deps.selectNode]
 * @param {object} [args.gate]     `createFormGate()`'s object
 * @param {string} [args.name]     this form's name in the gate
 */
export function createModelForm({ elements, deps = {}, gate = null, name = 'model' } = {}) {
  const state = {
    open: false,
    url: '',
    checking: false,
    result: null,      // a successful Check
    problem: null,     // `{ reason, message }` from a refused Check
    saving: false,
    waitSeq: null,
    error: null,
    pinned: false,
  }

  const show = (element, visible) => { if (element) element.style.display = visible ? '' : 'none' }
  const text = (element, value) => { if (element) element.textContent = value ?? '' }

  function problemText(problem) {
    if (!problem) return ''
    return problem.message || problem.reason || 'the model could not be loaded'
  }

  /** Everything the elements show is decided here, once. */
  function render() {
    show(elements.form, state.open)
    if (elements.privacy) text(elements.privacy, PRIVACY_NOTE)
    show(elements.error, Boolean(state.error))
    text(elements.error, state.error ?? '')

    const status = state.checking ? 'Checking…'
      : state.error ? state.error
        : state.result ? checkSummary(state.result)
          : state.problem ? problemText(state.problem)
            : ''
    show(elements.status, Boolean(status))
    text(elements.status, status)

    // The pin box shows only after a `.glb` has checked out (L9/Z7).
    const canPin = Boolean(state.result) && state.result.kind === 'glb'
    show(elements.pinRow, canPin)
    if (elements.pin) {
      elements.pin.checked = canPin ? state.pinned : false
      elements.pin.disabled = !canPin
    }

    if (elements.check) elements.check.disabled = !state.open || state.checking || state.saving
    if (elements.save) {
      elements.save.disabled = !canSave()
      elements.save.textContent = state.saving ? 'Saving...' : 'Save'
    }
    if (elements.cancel) elements.cancel.disabled = Boolean(state.saving)
    if (elements.url) elements.url.disabled = Boolean(state.saving)
  }

  function canSave() {
    return state.open && Boolean(state.result) && !state.checking && !state.saving
  }

  /** The spec Check holds: what Save stores and what the cache is seeded with. */
  function specForSave() {
    if (!state.result) return null
    return {
      url: state.url,
      bounds: state.result.bounds,
      sha256: state.pinned && state.result.kind === 'glb' ? state.result.sha256 : null,
    }
  }

  function onUrlInput(value) {
    state.url = value ?? ''
    // Editing the URL clears the result and disables Save (Z7).
    state.result = null
    state.problem = null
    state.error = null
    state.pinned = false
    // A8 — the held template ends with the result it was measured on.
    deps.onDropResult?.()
    render()
  }

  function urlProblem() {
    const url = state.url.trim()
    if (!url) return { reason: 'bad-spec', message: 'Enter a model URL' }
    const problem = modelUrlProblem(url)
    // V5 — the raw code (`url-scheme`, `url-chars`) used to be shown in
    // `#model-status`; the owner reads the same plain text the rest of the
    // model rules use.
    if (problem) return { reason: 'bad-spec', message: modelReasonText(problem) }
    if (url.length > MODEL_URL_MAX) return { reason: 'bad-spec', message: modelReasonText('url-length') }
    return null
  }

  /** Z7/L9 — Check runs the client's spec rules first, then the real loader. */
  async function check() {
    if (!state.open || state.checking || state.saving) return
    const problem = urlProblem()
    state.result = null
    state.pinned = false
    if (problem) {
      state.problem = problem
      state.error = problem.message
      render()
      return false
    }

    state.problem = null
    state.error = null
    state.checking = true
    render()
    try {
      const result = await deps.checkModel?.({
        url: state.url.trim(),
        worldBaseUrl: deps.worldBaseUrl?.() ?? null,
      })
      if (result?.ok) {
        state.result = checkResult(result)
      } else {
        state.problem = { reason: result?.reason ?? 'network', message: result?.message ?? null }
      }
    } catch (error) {
      state.problem = { reason: 'network', message: error?.message ?? null }
    } finally {
      state.checking = false
      render()
    }
    return Boolean(state.result)
  }

  /** Z7 — Save adds the node through the structural path, exactly as a pad does. */
  function save() {
    if (!canSave()) return null
    const spec = specForSave()
    const suggested = modelNameFromUrl(spec.url)
    const named = deps.firstFreeName?.(suggested) ?? suggested
    if (deps.isNameFree && !deps.isNameFree(named)) {
      state.error = 'No free name for a new model'
      render()
      return null
    }
    const { position, rotation } = deps.placement?.() ?? { position: [0, 0, 0], rotation: [0, 0, 0] }
    const descriptor = buildModelDescriptor({
      name: named, position, rotation, url: spec.url, bounds: spec.bounds, sha256: spec.sha256,
    })

    let seq
    try {
      seq = deps.addNode?.(descriptor)
    } catch (error) {
      state.error = `Failed to add model: ${error?.message ?? error}`
      state.saving = false
      render()
      return null
    }
    // The answer can't arrive before this returns (one thread).
    deps.structureBegin?.(seq, { name: named, descriptor, model: true })
    deps.undoRegisterAdd?.(seq, { name: named, duplicate: false })
    state.saving = true
    state.waitSeq = seq
    state.error = null
    state.pendingName = named
    render()
    deps.refreshActions?.()
    return { seq, name: named, descriptor }
  }

  /** `onStructureAnswer` for this form's own request (Z7). */
  function onAnswer(seq, status, message) {
    if (state.waitSeq !== seq) return false
    if (status === 'accepted') {
      const name = state.pendingName
      close()
      deps.selectNode?.(name)
      return true
    }
    if (status === 'rejected') {
      // A rejection waiting on this form shows in it. A taken name gets no
      // automatic retry (as for pads).
      state.error = message || 'the model was refused'
    } else {
      state.error = 'The world did not answer; try again'
    }
    state.saving = false
    state.waitSeq = null
    render()
    deps.refreshActions?.()
    return true
  }

  function open() {
    state.open = true
    state.error = null
    state.saving = false
    state.waitSeq = null
    gate?.claim(name)
    render()
    deps.refreshActions?.()
    return true
  }

  /** Closing while saving forgets the form's wait only: undo still records it. */
  function close() {
    state.open = false
    state.saving = false
    state.waitSeq = null
    state.error = null
    // A8 — the Check's held template and its hash end with the form.
    state.result = null
    state.problem = null
    state.pinned = false
    // A8 — the Check's held template ends with the form.
    deps.onDropResult?.()
    gate?.release(name)
    render()
    deps.refreshActions?.()
  }

  function isOpen() { return state.open }

  /** The `world:loaded`/reconnect path: a closed form, nothing half-typed kept. */
  function reset() {
    state.url = ''
    state.result = null
    state.problem = null
    state.error = null
    state.pinned = false
    state.checking = false
    close()
  }

  function wire() {
    elements.url?.addEventListener('input', () => onUrlInput(elements.url.value))
    elements.check?.addEventListener('click', () => { check() })
    elements.save?.addEventListener('click', () => { save() })
    elements.cancel?.addEventListener('click', () => close())
    elements.pin?.addEventListener('change', () => {
      state.pinned = Boolean(elements.pin.checked)
      render()
    })
    return api
  }

  const api = {
    wire, open, close, isOpen, reset, render,
    check, save, onAnswer, onUrlInput, canSave, specForSave,
    get state() { return state },
    get seq() { return state.waitSeq },
  }

  render()
  return api
}
