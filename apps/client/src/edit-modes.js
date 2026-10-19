// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * edit-modes.js — one place that knows which editing mode is on (Phase 3 step
 * 1b-1, B1 and E6). Pure: no DOM.
 *
 * Before this, each teleporter handler switched the teleport trigger on or off
 * itself, and exitTeleporterMode()/resetTeleporterUi() switched it on
 * unconditionally. With Edit mode added, leaving a teleporter mode while Edit
 * mode was on would have turned triggers back on mid-edit. Here the trigger's
 * activity is derived from the modes, every time any of them changes:
 *
 *   triggerActive = !editMode && !placementMode
 *
 * Placement is the only teleporter mode: the teleporter delete mode was retired
 * in the edit-tweaks round (K4, Z6) — Edit mode deletes pads, and Undo brings
 * them back.
 *
 * The avatar-ready gate (trigger.setReady) is separate and unchanged.
 *
 * Pointer lock: entering Edit mode suspends the M-key preference (clicks must
 * land where the pointer is), M is ignored while editing, and leaving Edit mode
 * restores the preference.
 *
 * @param {object} opts
 * @param {(active: boolean) => void} opts.setTriggerActive  trigger.setActive
 * @param {boolean} [opts.pointerLock=false]  initial M-key preference
 */
export function createEditModes({ setTriggerActive, pointerLock = false }) {
  let edit = false
  let teleporter = null          // null | 'placement'
  let pointerLockPref = pointerLock

  const sync = () => setTriggerActive(!edit && teleporter === null)

  return {
    get edit()      { return edit },
    get placement() { return teleporter === 'placement' },
    get triggerActive() { return !edit && teleporter === null },

    /** The effective pointer-lock setting: the preference, unless editing. */
    get usePointerLock() { return pointerLockPref && !edit },

    /** Turn Edit mode on or off. Turning it on closes any teleporter mode. */
    setEdit(on) {
      edit = !!on
      if (edit) teleporter = null
      sync()
    },

    /**
     * Enter the teleporter placement mode ('placement') or leave it (null).
     * Any other value — including the retired 'delete' (K4, Z6) — is refused
     * (returns false) and changes nothing. Entering a mode is also refused
     * while Edit mode is on.
     */
    setTeleporterMode(mode) {
      if (mode !== null && mode !== 'placement') return false
      if (mode !== null && edit) return false
      teleporter = mode
      sync()
      return true
    },

    /** The M key. Ignored (returns false) while Edit mode is on. */
    togglePointerLock() {
      if (edit) return false
      pointerLockPref = !pointerLockPref
      return true
    },

    /** Connection lifecycle: every mode off. The pointer preference is kept. */
    reset() {
      edit = false
      teleporter = null
      sync()
    },
  }
}
