// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * edit-modes.js — one place that knows which editing mode is on (Phase 3 step
 * 1b-1, B1 and E6). Pure: no DOM.
 *
 * Edit is the only editing mode (edit-polish-2, L6). Teleporters are added,
 * moved and deleted in it: the placement mode was retired with the toolbar's
 * Place Teleporter (Z4), and the delete mode in the earlier edit-tweaks round
 * (K4, Z6). So the trigger's activity is derived from the
 * one mode, every time it changes:
 *
 *   triggerActive = !editMode
 *
 * The avatar-ready gate (trigger.setReady) is separate and unchanged.
 *
 * copy-objects K4 — Inspect, the read-only mode for anyone who can't edit.
 * It is EXCLUSIVE with Edit (turning one on turns the other off). It changes
 * clicks only: walking onto a pad still teleports, so the trigger stays as
 * outside Edit mode. It suspends pointer lock as Edit does, so the picker's
 * clientX/Y is the real pointer.
 *
 * Pointer lock: entering Edit or Inspect mode suspends the M-key preference
 * (clicks must land where the pointer is), M is ignored while either is on,
 * and leaving restores the preference.
 *
 * @param {object} opts
 * @param {(active: boolean) => void} opts.setTriggerActive  trigger.setActive
 * @param {boolean} [opts.pointerLock=false]  initial M-key preference
 */
export function createEditModes({ setTriggerActive, pointerLock = false }) {
  let edit = false
  let inspect = false
  let pointerLockPref = pointerLock

  const sync = () => setTriggerActive(!edit)

  return {
    get edit()      { return edit },
    get inspect()   { return inspect },
    get triggerActive() { return !edit },

    /** The effective pointer-lock setting: the preference, unless editing or inspecting. */
    get usePointerLock() { return pointerLockPref && !edit && !inspect },

    /** Turn Edit mode on or off. On turns Inspect off. */
    setEdit(on) {
      edit = !!on
      if (edit) inspect = false
      sync()
    },

    /** K4 — turn Inspect mode on or off. On turns Edit off. */
    setInspect(on) {
      inspect = !!on
      if (inspect) edit = false
      sync()
    },

    /** The M key. Ignored (returns false) while Edit or Inspect mode is on. */
    togglePointerLock() {
      if (edit || inspect) return false
      pointerLockPref = !pointerLockPref
      return true
    },

    /** Connection lifecycle: Edit and Inspect off. The pointer preference is kept. */
    reset() {
      edit = false
      inspect = false
      sync()
    },
  }
}
