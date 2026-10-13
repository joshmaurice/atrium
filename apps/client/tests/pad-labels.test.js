// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// pad-labels.test.js — syncPadLabels keeps pad labels in step with the pads,
// including pads renamed away from the 'teleporter-' prefix (Phase 3 step 1a).
//
// LabelOverlay itself needs a DOM and three.js, which these node tests don't
// have, so the overlay here is a stand-in that copies LabelOverlay's map
// behaviour as it was at the base commit: addLabel overwrites an existing key
// WITHOUT removing the old element. `onScreen` counts every element ever added
// and not yet removed, so an orphaned label shows up as an extra element even
// though it is no longer in the map.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { syncPadLabels } from '../src/pad-labels.js'

function baseOverlay() {
  const map = new Map()
  const onScreen = new Set()
  let nextId = 0
  return {
    map,
    onScreen,
    addLabel(name, text) {
      const el = { id: nextId++, name, text }
      onScreen.add(el)
      map.set(name, el)              // overwrites; the old element stays on screen
    },
    removeLabel(name) {
      const el = map.get(name)
      if (!el) return
      onScreen.delete(el)
      map.delete(name)
    },
    clear() {
      for (const el of map.values()) onScreen.delete(el)
      map.clear()
    },
    removeLabelsByPrefix(prefix) {   // the base rebuildPads used this
      for (const name of [...map.keys()]) if (name.startsWith(prefix)) this.removeLabel(name)
    },
    texts() { return [...onScreen].map(el => el.text).sort() },
  }
}

const describePad = (pad) => ({
  text: `-> ${pad.destination}`,
  target: { name: pad.name, translation: pad.position },
  options: { heightOffset: 1.2, className: 'pad-label' },
})

const pad = (name, destination = '/') => ({ name, position: [0, 0, 0], destination })

describe('syncPadLabels', () => {
  test('a renamed pad\'s label is removed when the pad is deleted', () => {
    const labels = baseOverlay()
    let names = new Set()

    names = syncPadLabels(labels, names, [pad('teleporter-1')], describePad)
    names = syncPadLabels(labels, names, [pad('ep-pad')], describePad)    // renamed
    assert.deepEqual(labels.texts(), ['-> /'], 'one label after the rename')

    names = syncPadLabels(labels, names, [], describePad)                 // deleted
    assert.equal(labels.onScreen.size, 0, 'no label left on screen')
    assert.equal(names.size, 0)
  })

  test('rebuilding with an unchanged renamed pad never orphans its label', () => {
    const labels = baseOverlay()
    let names = new Set()

    for (let i = 0; i < 3; i++) {
      names = syncPadLabels(labels, names, [pad('ep-pad')], describePad)
    }
    assert.equal(labels.onScreen.size, 1, 'exactly one element for the pad')

    labels.clear()                                                        // world teardown
    assert.equal(labels.onScreen.size, 0, 'clear() removes everything; nothing orphaned survives it')
  })

  test('a label is replaced, not duplicated, when its text changes', () => {
    const labels = baseOverlay()
    let names = syncPadLabels(labels, new Set(), [pad('ep-pad', '/')], describePad)
    names = syncPadLabels(labels, names, [pad('ep-pad', '/worlds/a/b')], describePad)
    assert.deepEqual(labels.texts(), ['-> /worlds/a/b'])
  })

  test('labels that are not pad labels (peer avatars) are left alone', () => {
    const labels = baseOverlay()
    labels.addLabel('avatar-1234abcd', 'Bev')

    let names = syncPadLabels(labels, new Set(), [pad('teleporter-1'), pad('ep-pad')], describePad)
    names = syncPadLabels(labels, names, [], describePad)

    assert.deepEqual(labels.texts(), ['Bev'], 'only the peer label remains')
  })

  test('after a teardown, an empty name set starts clean', () => {
    const labels = baseOverlay()
    let names = syncPadLabels(labels, new Set(), [pad('ep-pad')], describePad)

    labels.clear()
    names = new Set()                                                     // as teardownWorld() does
    names = syncPadLabels(labels, names, [pad('teleporter-9')], describePad)

    assert.equal(labels.onScreen.size, 1)
    assert.deepEqual([...names], ['teleporter-9'])
  })

  test('returns the keys it added, in pad order', () => {
    const labels = baseOverlay()
    const names = syncPadLabels(labels, new Set(), [pad('a'), pad('b')], describePad)
    assert.deepEqual([...names], ['a', 'b'])
    assert.deepEqual(labels.map.get('a').text, '-> /')
  })
})
