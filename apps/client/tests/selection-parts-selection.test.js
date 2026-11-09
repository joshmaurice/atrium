// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// selection-parts T13 and T14 (PREBRIEF-selection-parts.md §4), pure:
// resolveEditSelection with the scoped policy (avatars first, external
// content handed to the policy as the leaf), pickEditSelection passing
// `current` and `drill` through, and the breadcrumb's items.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveEditSelection, pickEditSelection, DUPLICATE_NAME_MESSAGE,
  selectionPath, breadcrumbItems, BREADCRUMB_MAX_LEVELS, BREADCRUMB_NAME_MAX,
} from '../src/edit-selection.js'
import { resolveScopedSelection } from '../../../packages/interaction/src/selectionModel.js'
import { shownText } from '../src/copy-paste.js'

function n(name, { parent = null, mesh = null, extras = {} } = {}) {
  return { name, parent, mesh, extras }
}

const furniture = n('Furniture')
const bench = n('Bench-NE', { parent: furniture })
const seat = n('Bench-NE-Seat', { parent: bench, mesh: {} })
const leg = n('Bench-NE-LegLeft', { parent: bench, mesh: {} })
const me = n('User-aaaa', { mesh: {} })
const meChild = n('__cam', { parent: me })
// external content inside an ordinary group (Fable review / fresh check S7)
const g = n('G')
const ext = n('statue', { parent: g, extras: { atrium: { source: 'statue.gltf' } } })
const extInner = n('statue/Body', { parent: ext })
const extLeaf = n('statue/Body/Head', { parent: extInner, mesh: {} })
// top-level external content
const ext2 = n('fountain', { extras: { atrium: { source: 'f.gltf' } } })
const ext2Leaf = n('fountain/Bowl', { parent: ext2, mesh: {} })

const isExcluded = (node) => node === me
const opts = (o = {}) => ({ isExcluded, resolveRoot: resolveScopedSelection, ...o })

describe('T13: resolveEditSelection with the scoped policy', () => {
  test('a click selects the top-level object; a drill goes one deeper', () => {
    assert.equal(resolveEditSelection(seat, opts()), furniture)
    assert.equal(resolveEditSelection(seat, opts({ current: furniture, drill: true })), bench)
    assert.equal(resolveEditSelection(seat, opts({ current: bench, drill: true })), seat)
    assert.equal(resolveEditSelection(leg, opts({ current: seat })), leg)
  })
  test('avatars select nothing, whatever the gesture', () => {
    assert.equal(resolveEditSelection(me, opts()), null)
    assert.equal(resolveEditSelection(meChild, opts({ descend: true })), null)
    assert.equal(resolveEditSelection(meChild, opts({ current: me, drill: true })), null)
  })
  test('external content is the leaf: Alt and drilling stop at its container', () => {
    assert.equal(resolveEditSelection(ext2Leaf, opts()), ext2)
    assert.equal(resolveEditSelection(ext2Leaf, opts({ descend: true })), ext2)
    assert.equal(resolveEditSelection(ext2Leaf, opts({ current: ext2, drill: true })), ext2)
  })
  test('external content inside an ordinary group: a click selects the group, a drill the container', () => {
    assert.equal(resolveEditSelection(extLeaf, opts()), g)
    assert.equal(resolveEditSelection(extLeaf, opts({ current: g })), g)
    assert.equal(resolveEditSelection(extLeaf, opts({ current: g, drill: true })), ext)
    assert.equal(resolveEditSelection(extLeaf, opts({ current: ext, drill: true })), ext)
    assert.equal(resolveEditSelection(extLeaf, opts({ descend: true })), ext)
  })
})

describe('T13: pickEditSelection passes current and drill through', () => {
  test('current and drill reach the policy', () => {
    assert.deepEqual(pickEditSelection([seat], opts({ current: furniture, drill: true })), { node: bench, refused: null })
    assert.deepEqual(pickEditSelection([seat], opts({ current: furniture })), { node: furniture, refused: null })
  })
  test('a duplicated name is still refused, for the hit and for the result', () => {
    const r1 = pickEditSelection([{ duplicateName: 'x' }], opts())
    assert.deepEqual(r1, { node: null, refused: DUPLICATE_NAME_MESSAGE })
    const r2 = pickEditSelection([seat], opts({ current: furniture, drill: true, isDuplicatedName: (name) => name === 'Bench-NE' }))
    assert.deepEqual(r2, { node: null, refused: DUPLICATE_NAME_MESSAGE })
  })
})

describe('T14: the breadcrumb', () => {
  test('selectionPath lists the ancestors from the top-level one down, then the node', () => {
    assert.deepEqual(selectionPath(seat), [furniture, bench, seat])
    assert.deepEqual(selectionPath(furniture), [furniture])
    assert.deepEqual(selectionPath(null), [])
  })
  test('a top-level selection has no items (the row is hidden)', () => {
    assert.deepEqual(breadcrumbItems([furniture], { show: shownText }), [])
  })
  test('ancestors are crumbs, the selection is the current item', () => {
    const items = breadcrumbItems(selectionPath(seat), { show: shownText })
    assert.deepEqual(items.map((i) => [i.kind, i.text]), [
      ['crumb', 'Furniture'], ['crumb', 'Bench-NE'], ['current', 'Bench-NE-Seat'],
    ])
    assert.equal(items[0].node, furniture)
    assert.equal(items[2].node, seat)
  })
  test(`over ${BREADCRUMB_MAX_LEVELS} levels: the top, an ellipsis, and the last ${BREADCRUMB_MAX_LEVELS - 1}`, () => {
    const chain = []
    let parent = null
    for (let i = 0; i < 12; i++) { const node = n(`L${i}`, { parent }); chain.push(node); parent = node }
    const items = breadcrumbItems(chain, { show: shownText })
    assert.deepEqual(items.map((i) => i.text), ['L0', '…', 'L6', 'L7', 'L8', 'L9', 'L10', 'L11'])
    assert.equal(items[1].kind, 'ellipsis')
    assert.equal(items[1].node, null)
    const seven = chain.slice(0, 7)
    assert.deepEqual(breadcrumbItems(seven, { show: shownText }).map((i) => i.text), ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6'])
  })
  test(`a long name is cut to ${BREADCRUMB_NAME_MAX}; its title is whole, both escaped`, () => {
    const long = n('x'.repeat(300), { parent: furniture })
    const [, current] = breadcrumbItems([furniture, long], { show: shownText })
    assert.equal(current.text.length, BREADCRUMB_NAME_MAX)
    assert.ok(current.text.endsWith('…'))
    assert.equal(current.title, 'x'.repeat(300))
    const bidi = n('ab‮cd', { parent: furniture })
    const [, b] = breadcrumbItems([furniture, bidi], { show: shownText })
    assert.equal(b.text.includes('‮'), false)
    assert.equal(b.title.includes('‮'), false)
  })
})
