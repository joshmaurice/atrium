// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * edit-keys.js — which Edit-mode shortcut a key event is, and whether it may
 * run (edit-tweaks K3, Z4). Pure: plain objects in, a decision out. No DOM and
 * no three.js, so it is testable in Node.
 *
 * Recognising a shortcut is SEPARATE from running it. Delete, Backspace and
 * Ctrl/Cmd+D auto-repeat is still recognised — the caller must consume the
 * event (preventDefault + stopImmediatePropagation) either way — but carries
 * `run: false`, so holding the key makes one change, no movement and no
 * browser bookmark dialog. Returning null for a repeat would let `KeyD`
 * through to the canvas navigation listener, which ignores modifiers.
 *
 * The map, per K3:
 *   Delete / Backspace, no Ctrl, Cmd or Alt           → delete
 *   Ctrl+D / Cmd+D, no Shift, no Alt                  → duplicate
 *   Ctrl/Cmd+Z                                        → undo
 *   Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y                   → redo
 * Anything else (Alt anywhere, Shift+D, an unmodified letter, Edit mode off)
 * is null: the key stays the browser's, exactly as before.
 */

/** Input elements that are NOT text-entry: they must not swallow the keys. */
const NON_TEXT_INPUT_TYPES = Object.freeze(['checkbox', 'radio', 'button'])

/**
 * Is this element (or this small description of one) a text-entry field? A
 * `textarea` or `select` is; an `input` is unless its type is checkbox, radio
 * or button — the undo keys' rule (W9/R9). A small description
 * (`{ tagName, type }`) keeps this pure: the caller reads it off the event's
 * target, and tests need no DOM.
 *
 * @param {{ tagName?: string, type?: string }} [target]
 * @returns {boolean}
 */
export function isTextEntryField(target) {
  const tag = String(target?.tagName ?? '').toUpperCase()
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag !== 'INPUT') return false
  const type = String(target?.type ?? 'text').toLowerCase()
  return !NON_TEXT_INPUT_TYPES.includes(type)
}

/**
 * The action a key event asks for in Edit mode.
 *
 * @param {object} e — the event, or its plain equivalent:
 *   `{ key, ctrlKey, metaKey, shiftKey, altKey, repeat, target }`, where
 *   `target` is the `{ tagName, type }` description of `e.target` (or of the
 *   field it sits inside).
 * @param {object} opts
 * @param {boolean} opts.editOn — Edit mode is on
 * @returns {{ action: 'undo'|'redo'|'delete'|'duplicate', run: boolean } | null}
 *   null when the key is not an Edit-mode shortcut; otherwise the action and
 *   whether it may run (`false` for a repeated delete or duplicate).
 */
export function editKeyAction(e, { editOn = false } = {}) {
  if (!editOn) return null
  if (isTextEntryField(e?.target)) return null

  const key    = e?.key ?? ''
  const lower  = key.toLowerCase()
  const accel  = !!e?.ctrlKey || !!e?.metaKey
  const shift  = !!e?.shiftKey
  const alt    = !!e?.altKey
  const repeat = !!e?.repeat

  // Delete and Duplicate auto-repeat: recognised, consumed, not run.
  if ((key === 'Delete' || key === 'Backspace') && !accel && !alt) {
    return { action: 'delete', run: !repeat }
  }
  if (accel && !alt && !shift && lower === 'd') {
    return { action: 'duplicate', run: !repeat }
  }
  // Undo and redo keep their old behaviour: each repeat runs.
  if (accel && !alt) {
    if (lower === 'z' && !shift) return { action: 'undo', run: true }
    if (lower === 'y' || (lower === 'z' && shift)) return { action: 'redo', run: true }
  }
  return null
}
