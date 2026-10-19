// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// edit-keys.test.js — the Edit-mode key map (edit-tweaks Z4, K3).
//
// Plain objects only: no DOM, no three.js (apps/client's test rule). `target`
// is the small { tagName, type } description app.js builds from e.target.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { editKeyAction, isTextEntryField } from '../src/edit-keys.js'

const CANVAS = { tagName: 'CANVAS' }

/** A key event, as app.js hands it to editKeyAction. */
function ev(overrides = {}) {
  return {
    key: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
    repeat: false, target: CANVAS,
    ...overrides,
  }
}

const ON = { editOn: true }

describe('edit-keys: Delete', () => {
  test('Delete → delete', () => {
    assert.deepEqual(editKeyAction(ev({ key: 'Delete' }), ON), { action: 'delete', run: true })
  })

  test('Backspace → delete (a Mac keyboard sends Backspace for its delete key)', () => {
    assert.deepEqual(editKeyAction(ev({ key: 'Backspace' }), ON), { action: 'delete', run: true })
  })

  test('Alt+Delete and Alt+Backspace → null', () => {
    assert.equal(editKeyAction(ev({ key: 'Delete', altKey: true }), ON), null)
    assert.equal(editKeyAction(ev({ key: 'Backspace', altKey: true }), ON), null)
  })

  test('Ctrl+Backspace, Cmd+Backspace and Ctrl+Delete → null (the browser keeps them)', () => {
    assert.equal(editKeyAction(ev({ key: 'Backspace', ctrlKey: true }), ON), null)
    assert.equal(editKeyAction(ev({ key: 'Backspace', metaKey: true }), ON), null)
    assert.equal(editKeyAction(ev({ key: 'Delete', ctrlKey: true }), ON), null)
  })

  test('Shift+Delete → delete (Shift is not a modifier these keys refuse)', () => {
    assert.deepEqual(editKeyAction(ev({ key: 'Delete', shiftKey: true }), ON), { action: 'delete', run: true })
  })

  test('a lower-case "delete" spelling is not a shortcut', () => {
    assert.equal(editKeyAction(ev({ key: 'delete' }), ON), null)
  })
})

describe('edit-keys: Duplicate', () => {
  test('Ctrl+D and Cmd+D → duplicate', () => {
    assert.deepEqual(editKeyAction(ev({ key: 'd', ctrlKey: true }), ON), { action: 'duplicate', run: true })
    assert.deepEqual(editKeyAction(ev({ key: 'd', metaKey: true }), ON), { action: 'duplicate', run: true })
  })

  test('an upper-case D works too (Shift is refused, not the letter)', () => {
    assert.deepEqual(editKeyAction(ev({ key: 'D', ctrlKey: true }), ON), { action: 'duplicate', run: true })
  })

  test('Ctrl+Shift+D, Cmd+Shift+D and Alt+D → null', () => {
    assert.equal(editKeyAction(ev({ key: 'd', ctrlKey: true, shiftKey: true }), ON), null)
    assert.equal(editKeyAction(ev({ key: 'D', metaKey: true, shiftKey: true }), ON), null)
    assert.equal(editKeyAction(ev({ key: 'd', ctrlKey: true, altKey: true }), ON), null)
    assert.equal(editKeyAction(ev({ key: 'd', altKey: true }), ON), null)
  })

  test('a plain d (the strafe key) is not a shortcut', () => {
    assert.equal(editKeyAction(ev({ key: 'd' }), ON), null)
  })
})

describe('edit-keys: Undo and Redo (the keys that existed before this round)', () => {
  test('Ctrl+Z / Cmd+Z → undo', () => {
    assert.deepEqual(editKeyAction(ev({ key: 'z', ctrlKey: true }), ON), { action: 'undo', run: true })
    assert.deepEqual(editKeyAction(ev({ key: 'Z', metaKey: true }), ON), { action: 'undo', run: true })
  })

  test('Ctrl+Shift+Z / Cmd+Shift+Z and Ctrl+Y / Cmd+Y → redo', () => {
    assert.deepEqual(editKeyAction(ev({ key: 'z', ctrlKey: true, shiftKey: true }), ON), { action: 'redo', run: true })
    assert.deepEqual(editKeyAction(ev({ key: 'Z', metaKey: true, shiftKey: true }), ON), { action: 'redo', run: true })
    assert.deepEqual(editKeyAction(ev({ key: 'y', ctrlKey: true }), ON), { action: 'redo', run: true })
    assert.deepEqual(editKeyAction(ev({ key: 'y', metaKey: true }), ON), { action: 'redo', run: true })
  })

  test('Alt+Z, Alt+Y and Shift+Y → null (Alt is refused, exactly as before)', () => {
    assert.equal(editKeyAction(ev({ key: 'z', ctrlKey: true, altKey: true }), ON), null)
    assert.equal(editKeyAction(ev({ key: 'y', ctrlKey: true, altKey: true }), ON), null)
    assert.equal(editKeyAction(ev({ key: 'y', shiftKey: true }), ON), null)
  })

  test('a plain z or y, and other letters, are not shortcuts', () => {
    assert.equal(editKeyAction(ev({ key: 'z' }), ON), null)
    assert.equal(editKeyAction(ev({ key: 'y' }), ON), null)
    assert.equal(editKeyAction(ev({ key: 'Escape' }), ON), null)
    assert.equal(editKeyAction(ev({ key: 'a', ctrlKey: true }), ON), null)
    assert.equal(editKeyAction(ev({}), ON), null)
  })
})

describe('edit-keys: auto-repeat (Rev 1.1 — consumed, not run)', () => {
  test('a repeated Delete and Backspace are recognised with run: false', () => {
    assert.deepEqual(editKeyAction(ev({ key: 'Delete', repeat: true }), ON), { action: 'delete', run: false })
    assert.deepEqual(editKeyAction(ev({ key: 'Backspace', repeat: true }), ON), { action: 'delete', run: false })
  })

  test('a repeated Ctrl+D and Cmd+D are recognised with run: false', () => {
    assert.deepEqual(editKeyAction(ev({ key: 'd', ctrlKey: true, repeat: true }), ON), { action: 'duplicate', run: false })
    assert.deepEqual(editKeyAction(ev({ key: 'd', metaKey: true, repeat: true }), ON), { action: 'duplicate', run: false })
  })

  test('a repeat is NEVER null — the caller must still consume the event', () => {
    for (const e of [
      ev({ key: 'Delete', repeat: true }),
      ev({ key: 'Backspace', repeat: true }),
      ev({ key: 'd', ctrlKey: true, repeat: true }),
      ev({ key: 'd', metaKey: true, repeat: true }),
    ]) {
      assert.notEqual(editKeyAction(e, ON), null)
    }
  })

  test('a repeated undo or redo still runs (its old behaviour)', () => {
    assert.deepEqual(editKeyAction(ev({ key: 'z', ctrlKey: true, repeat: true }), ON), { action: 'undo', run: true })
    assert.deepEqual(editKeyAction(ev({ key: 'y', metaKey: true, repeat: true }), ON), { action: 'redo', run: true })
  })
})

describe('edit-keys: focus and Edit mode', () => {
  const EVERY_KEY = [
    { key: 'Delete' }, { key: 'Backspace' },
    { key: 'd', ctrlKey: true }, { key: 'd', metaKey: true },
    { key: 'z', ctrlKey: true }, { key: 'z', metaKey: true, shiftKey: true }, { key: 'y', ctrlKey: true },
  ]

  test('Edit mode off → null for every key', () => {
    for (const k of EVERY_KEY) {
      assert.equal(editKeyAction(ev(k), { editOn: false }), null, `${k.key} with Edit off`)
    }
    assert.equal(editKeyAction(ev({ key: 'Unidentified' }), { editOn: false }), null)
  })

  test('a text-entry target → null for every key (the field keeps its keys)', () => {
    for (const target of [{ tagName: 'INPUT', type: 'text' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' }]) {
      for (const k of EVERY_KEY) {
        assert.equal(editKeyAction(ev({ ...k, target }), ON), null, `${k.key} in ${target.tagName}`)
      }
    }
  })

  test('an input with no type counts as text entry', () => {
    assert.equal(editKeyAction(ev({ key: 'Delete', target: { tagName: 'INPUT' } }), ON), null)
  })

  test('checkbox, radio and button targets do NOT swallow the keys (R9)', () => {
    for (const type of ['checkbox', 'radio', 'button']) {
      const target = { tagName: 'INPUT', type }
      assert.deepEqual(editKeyAction(ev({ key: 'Delete', target }), ON), { action: 'delete', run: true }, type)
      assert.deepEqual(editKeyAction(ev({ key: 'z', ctrlKey: true, target }), ON), { action: 'undo', run: true }, type)
    }
  })

  test('no target at all is not a text-entry field', () => {
    assert.deepEqual(editKeyAction(ev({ key: 'Delete', target: undefined }), ON), { action: 'delete', run: true })
  })
})

describe('edit-keys: isTextEntryField', () => {
  test('textarea and select are fields', () => {
    assert.equal(isTextEntryField({ tagName: 'TEXTAREA' }), true)
    assert.equal(isTextEntryField({ tagName: 'select' }), true)
  })

  test('input depends on its type; anything else is not a field', () => {
    assert.equal(isTextEntryField({ tagName: 'INPUT', type: 'text' }), true)
    assert.equal(isTextEntryField({ tagName: 'INPUT', type: 'search' }), true)
    assert.equal(isTextEntryField({ tagName: 'INPUT', type: 'checkbox' }), false)
    assert.equal(isTextEntryField({ tagName: 'INPUT', type: 'radio' }), false)
    assert.equal(isTextEntryField({ tagName: 'INPUT', type: 'button' }), false)
    assert.equal(isTextEntryField({ tagName: 'BUTTON' }), false)
    assert.equal(isTextEntryField({ tagName: 'CANVAS' }), false)
    assert.equal(isTextEntryField({}), false)
    assert.equal(isTextEntryField(undefined), false)
  })
})
