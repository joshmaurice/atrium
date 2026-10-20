// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * edit-modes.js — one place that knows which editing mode is on (Phase 3 step
 * 1b-1, B1 and E6). Pure: no DOM.
 *
 * Edit is the only editing mode (edit-polish-2, L6). Teleporters are added,
 * moved and deleted in it: the teleporter placement mode was retired with the
 * toolbar's Place Teleporter, and the teleporter delete mode in the
 * edit-tweaks round (K4, Z6). So the trigger's activity is derived from the
 * one mode, every time it changes:
 *
 *   triggerActive = !editMode
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
  let pointerLockPref = pointerLock

  const sync = () => setTriggerActive(!edit)

  return {
    get edit()      { return edit },
    get triggerActive() { return !edit },

    /** The effective pointer-lock setting: the preference, unless editing. */
    get usePointerLock() { return pointerLockPref && !edit },

    /** Turn Edit mode on or off. */
    setEdit(on) {
      edit = !!on
      sync()
    },

    /** The M key. Ignored (returns false) while Edit mode is on. */
    togglePointerLock() {
      if (edit) return false
      pointerLockPref = !pointerLockPref
      return true
    },

    /** Connection lifecycle: Edit mode off. The pointer preference is kept. */
    reset() {
      edit = false
      sync()
    },
  }
}