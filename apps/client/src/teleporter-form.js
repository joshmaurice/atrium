// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * teleporter-form.js — the destination (teleporter) form's logic, with no DOM of
 * its own (edit-polish-3 Z3, L2a).
 *
 * This is the last Edit-panel form whose logic still lived inside `app.js`. It is
 * shaped exactly like `createModelForm` (`model-form.js`): `app.js` hands it the
 * elements (real ones in the page, fake ones in the tests), the client calls
 * (`addNode`, `structure`, `undo`), the placement's position, the destination
 * rules and the panel refreshers. Every decision — when Save is enabled, which
 * message a bad destination shows, what a rejection does, whose world list is
 * whose — lives here and is tested without a browser.
 *
 * The save path is the palette's: a structural request through
 * `structure.begin('add', seq, { name, descriptor, teleporter: true })`, recorded
 * in the undo engine by `undo.registerAdd(seq, { name, duplicate: false })`, and
 * answered through `onStructureAnswer` → `onAnswer`. The form selects its own
 * accepted pad and never falls through to the app's generic `selectAdded` branch
 * (Z2): that branch is only for palette and Duplicate adds now.
 *
 * Two of today's bugs are fixed here:
 *   - a rejected Save's error stayed on screen while the retry said "Saving…"
 *     (`save()` hides the old error when it dispatches, as the Model form's does);
 *   - a world list that arrived late could be added to a newer list (the list
 *     belongs to the opening that asked for it).
 *
 * The module imports nothing from three.js or the DOM: `buildDescriptor` stays a
 * dependency because it comes from renderer-three, which this package's tests
 * cannot import, and everything the select shows is written by the injected
 * `fillWorlds`.
 */

/**
 * The destination form.
 *
 * @param {object} args
 * @param {object} args.elements  `{ form, worldSelect, destInput, spawnWarn, error, save, cancel }`
 * @param {object} [args.deps]
 * @param {() => (Promise<Array<{value: string, label: string}>>|null)} [args.deps.listWorlds]
 *   the worlds to offer, or `null` when this world is on another server (manual
 *   entry only). It must answer `null` SYNCHRONOUSLY for that case.
 * @param {(options: Array<object>, opts: {loading?: boolean, manualOnly?: boolean}) => void} [args.deps.fillWorlds]
 *   the DOM adapter that writes the select
 * @param {(dest: string) => boolean} [args.deps.isValidDestination]
 * @param {(dest: string) => (string|null)} [args.deps.resolveDestination]
 * @param {() => (string|null)} [args.deps.teleporterName]   a free name, or null
 * @param {(args: {name: string, position: number[], destination: string}) => object} [args.deps.buildDescriptor]
 * @param {(descriptor: object) => number} [args.deps.addNode]
 * @param {(seq: number, pending: object) => void} [args.deps.structureBegin]
 * @param {(seq: number, entry: object) => void} [args.deps.undoRegisterAdd]
 * @param {() => void} [args.deps.refreshActions]
 * @param {() => boolean} [args.deps.dispatchAllowed]  Edit is on and nothing blocks
 * @param {(position: number[]) => boolean} [args.deps.nearSpawn]
 * @param {() => void} [args.deps.clearEditError]
 * @param {(name: string) => void} [args.deps.selectNode]  select an accepted pad
 * @param {object} [args.gate]     `createFormGate()`'s object
 * @param {string} [args.name]     this form's name in the gate
 */
export function createTeleporterForm({ elements = {}, deps = {}, gate = null, name = 'teleporter' } = {}) {
  const state = {
    open: false,
    position: null,     // the palette's ground point for the next Save
    waiting: null,      // the seq of the add this form sent, while it says "Saving…"
    pendingName: null,  // the name that add used, so an acceptance selects it
    saveEnabled: false, // the select/input rule decides; the wait overrides it
    warn: false,        // near the spawn point
    error: null,
    // Z3 — the world list belongs to the opening that asked for it: every fresh
    // opening (and every close) bumps this, and a list that answers for an older
    // opening is dropped. Today's bug: close + reopen before the first
    // `/api/worlds` answer arrived added the first answer's worlds to the second
    // list, so every world appeared twice.
    opening: 0,
  }

  const show = (element, visible) => { if (element) element.style.display = visible ? '' : 'none' }
  const text = (element, value) => { if (element) element.textContent = value ?? '' }
  const destText = () => elements.destInput?.value ?? ''
  const selectText = () => elements.worldSelect?.value ?? ''
  const chosenDest = () => selectText() || destText().trim()

  /** Everything the elements show is decided here, once. */
  function render() {
    show(elements.form, state.open)
    show(elements.error, Boolean(state.error))
    text(elements.error, state.error ?? '')
    show(elements.spawnWarn, state.warn)
    if (elements.save) {
      elements.save.disabled = !state.open || state.waiting !== null || !state.saveEnabled
      elements.save.textContent = state.waiting !== null ? 'Saving...' : 'Save'
    }
    if (elements.cancel) elements.cancel.disabled = state.waiting !== null
  }

  function setError(message) {
    state.error = message ?? null
    render()
  }

  /** The spawn warning for a position, re-read every time the form opens. */
  function setWarn(position) {
    state.warn = Boolean(position) && Boolean(deps.nearSpawn?.(position))
  }

  /**
   * Z3 — the world list's answer, for the opening that asked for it. An answer
   * that arrives after a close, or after a newer fresh opening, is dropped.
   *
   * V1 (round 2) — a list that arrives while the owner has already chosen a
   * destination must not erase that choice. The value on screen now is read
   * BEFORE the fill and handed to the adapter, which re-selects it when the
   * list it just wrote still offers it ("The commons", `/`, included); the
   * select is left on the placeholder otherwise. Save is then re-derived from
   * what is ACTUALLY chosen — a world in the select or a non-blank destination
   * box — so a list that dropped the choice leaves Save off unless the input
   * has text.
   */
  function fillIfCurrent(opening, options) {
    if (!state.open || opening !== state.opening) return false
    const previous = selectText()
    deps.fillWorlds?.(options ?? [], { selected: previous })
    state.saveEnabled = Boolean(selectText()) || Boolean(destText().trim())
    render()
    return true
  }

  /**
   * Z3 — the fresh opening, synchronously: the fields are emptied, the list is
   * put into its loading (or manual-only) state, the error is hidden and Save is
   * off — ALL before the world list's answer can land. An opening while the form
   * is already open keeps what was typed and the list, and only re-reads the
   * position and the spawn warning.
   *
   * @param {number[]} [position]  the palette's ground point for this Save
   */
  function open(position) {
    // Refused while it waits on its own Save (the Teleporter button does nothing).
    if (state.waiting !== null) return false
    if (position) state.position = position
    gate?.claim(name)
    const fresh = !state.open
    state.open = true

    if (fresh) {
      const opening = ++state.opening
      elements.destInput.value = ''
      elements.worldSelect.value = ''
      state.error = null
      state.saveEnabled = false
      // The adapter answers `null` in the same turn for a world on another
      // server; only then is the select manual-only. Either way the select is in
      // its own state before any answer arrives.
      const worlds = deps.listWorlds?.() ?? null
      if (worlds === null || typeof worlds?.then !== 'function') {
        deps.fillWorlds?.([], { manualOnly: true })
      } else {
        deps.fillWorlds?.([], { loading: true })
        Promise.resolve(worlds)
          .then((options) => fillIfCurrent(opening, options))
          .catch(() => {})
      }
    }

    setWarn(state.position)
    render()
    deps.refreshActions?.()
    return true
  }

  /**
   * Z3 — Save. Refused unless Edit mode is on and nothing blocks, and unless no
   * write is already waiting; validates in today's order with today's messages;
   * then sends the pad and hides the OLD error (today's first bug: a rejection's
   * error stayed on screen while the retry said "Saving…").
   */
  function save() {
    if (!deps.dispatchAllowed?.()) return null
    if (state.waiting !== null) return null

    const dest = chosenDest()
    if (!dest) {
      setError('Select a world or enter a destination')
      return null
    }
    // R4: validate the destination's format before resolving it.
    if (!deps.isValidDestination?.(dest)) {
      setError('Invalid destination — enter a path (e.g. /worlds/user/slug) or ws(s) URL')
      return null
    }
    if (!deps.resolveDestination?.(dest)) {
      setError('Invalid destination — enter a path (e.g. /worlds/user/slug) or ws(s) URL')
      return null
    }
    // L4 — the pad's name, `Teleporter`, `Teleporter 2`… like the palette's Cube.
    const padName = deps.teleporterName?.() ?? null
    if (!padName) {
      setError('No free name for a new teleporter')
      return null
    }

    let descriptor, seq
    try {
      descriptor = deps.buildDescriptor?.({ name: padName, position: state.position, destination: dest.trim() })
      seq = deps.addNode?.(descriptor)
    } catch (error) {
      // A throw from addNode shows its message and re-enables Save.
      setError(`Failed to place teleporter: ${error?.message ?? error}`)
      return null
    }

    // The answer cannot arrive before this returns (one thread).
    deps.structureBegin?.(seq, { name: padName, descriptor, teleporter: true })
    // Y7 — recorded from its answer, whatever the Edit mode then.
    deps.undoRegisterAdd?.(seq, { name: padName, duplicate: false })
    state.waiting = seq
    state.pendingName = padName
    // Z3 — the old error goes as the write dispatches, and only then.
    state.error = null
    deps.clearEditError?.()
    render()
    deps.refreshActions?.()
    return { seq, name: padName, descriptor }
  }

  /**
   * `onStructureAnswer` for this form's own request (Z3). It returns `true` for
   * every answer it was waiting on and handles it completely:
   * accepted — closes the form and selects the new pad; rejected — shows the
   * message and enables Save again, keeping what was typed; unknown — "The world
   * did not answer; try again". Any other seq returns `false` and changes
   * nothing, and app.js then follows Z2's owned/not-owned rules.
   *
   * @returns {boolean}
   */
  function onAnswer(seq, status, message) {
    if (state.waiting !== seq) return false
    const sentName = state.pendingName
    if (status === 'accepted') {
      close()
      deps.selectNode?.(sentName)
      return true
    }
    state.waiting = null
    state.pendingName = null
    setError(status === 'rejected'
      ? (message || 'Failed to place teleporter')
      : 'The world did not answer; try again')
    deps.refreshActions?.()
    return true
  }

  /**
   * Z3 — Cancel, Escape, another form, Edit off and a reconnect all close it.
   * Closing while saving forgets the form's WAIT only: the answer is still
   * recorded by undo (Y7), and an accepted one selects nothing (Z2). The world
   * list of this opening dies with it.
   */
  function close() {
    state.open = false
    state.waiting = null
    state.pendingName = null
    state.position = null
    state.warn = false
    state.error = null
    state.saveEnabled = false
    state.opening += 1
    gate?.release(name)
    render()
    deps.refreshActions?.()
  }

  function isOpen() { return state.open }

  /**
   * A world boundary. The destination form already starts empty on its next
   * fresh opening, so this is `close()`: it forgets the wait and nothing else.
   */
  function reset() { close() }

  /**
   * Z3 — this module owns ALL FOUR of its listeners; `app.js` adds none to these
   * elements (review 4). The enable rules are today's exactly: a chosen world
   * enables Save, the destination box enables Save when it is non-blank and
   * disables it when it is blank, and either input hides the last error.
   */
  function wire() {
    elements.worldSelect?.addEventListener('change', () => {
      if (selectText()) {
        state.saveEnabled = true
        state.error = null
      }
      render()
    })
    elements.destInput?.addEventListener('input', () => {
      state.saveEnabled = Boolean(destText().trim())
      state.error = null
      render()
    })
    elements.save?.addEventListener('click', () => { save() })
    elements.cancel?.addEventListener('click', () => close())
    return api
  }

  const api = {
    wire, open, close, isOpen, reset, render, save, onAnswer,
    get state() { return state },
    get waitSeq() { return state.waiting },
    get position() { return state.position },
    get error() { return state.error },
  }

  render()
  return api
}
