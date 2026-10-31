// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// object-name.test.js — scripting-4d-1 round 4, R18 (F5).
//
// Against a REAL SOMDocument (AGENTS.md: real implementations, no throwaway
// fakes): a named node with an objectId resolves to its name; an unknown id,
// two nodes sharing an id (`ambiguous`), an unaddressable node and a missing
// SOM all give the id back; and the Q3 Enable prompt names objects through
// this helper end to end. Proof (r18): removing the `?.node` read in
// object-name.js makes the resolution tests fail.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Document } from '../../../packages/som/node_modules/@gltf-transform/core/dist/index.modern.js'
import { SOMDocument } from '../../../packages/som/src/SOMDocument.js'
import { objectNameOf } from '../src/object-name.js'
import { enablePromptText } from '../src/graph-import.js'

const OWN = '11111111-1111-4111-8111-111111111111'
const TGT = '22222222-2222-4222-8222-222222222222'
const GONE = '44444444-4444-4444-8444-444444444444'

const withId = (id) => ({ atrium: { objectId: id } })

/** A real SOMDocument, with nodes the tests name. */
function somOf() {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  scene.addChild(doc.createNode('Quad').setExtras(withId(TGT)))
  scene.addChild(doc.createNode('Mute'))                              // no objectId
  scene.addChild(doc.createNode('Twin').setExtras(withId(OWN)))
  scene.addChild(doc.createNode('Twin').setExtras(withId(OWN)))       // `ambiguous`
  return new SOMDocument(doc)
}

// ---------------------------------------------------------------------------
// The helper's cases, over a real SOM
// ---------------------------------------------------------------------------

test('R18 — a node with an objectId and a name gives the name', () => {
  const som = somOf()
  assert.equal(objectNameOf(som, TGT), 'Quad')
})

test('R18 — an unknown id gives the id', () => {
  const som = somOf()
  assert.deepEqual(som.resolveObjectId(GONE), { problem: 'not-found' })
  assert.equal(objectNameOf(som, GONE), GONE)
})

test('R18 — two nodes sharing an id (ambiguous) give the id', () => {
  const som = somOf()
  assert.deepEqual(som.resolveObjectId(OWN), { problem: 'ambiguous' })
  assert.equal(objectNameOf(som, OWN), OWN)
})

test('R18 — an id that resolves to nothing gives the id', () => {
  const som = somOf()
  assert.equal(som.resolveObjectId('not-an-id-at-all').problem, 'not-found')
  assert.equal(objectNameOf(som, 'not-an-id-at-all'), 'not-an-id-at-all')
})

test('R18 — an unaddressable node gives the id', () => {
  // A node whose name no longer addresses it: another node took its name
  // first, so the name maps return the OTHER node.
  const doc = new Document()
  const scene = doc.createScene('Scene')
  scene.addChild(doc.createNode('Twin'))                              // holds the name
  scene.addChild(doc.createNode('Twin').setExtras(withId(TGT)))       // shadowed
  const som = new SOMDocument(doc)
  assert.deepEqual(som.resolveObjectId(TGT), { problem: 'unaddressable' })
  assert.equal(objectNameOf(som, TGT), TGT)
})

test('R18 — degenerate soms and ids fall back to the id', () => {
  assert.equal(objectNameOf(null, TGT), TGT)
  assert.equal(objectNameOf(undefined, TGT), TGT)
  assert.equal(objectNameOf({}, TGT), TGT)
  assert.equal(objectNameOf(somOf(), ''), '')
  assert.equal(objectNameOf(somOf(), undefined), undefined)
})

// ---------------------------------------------------------------------------
// The Q3 Enable prompt, end to end through the real helper
// ---------------------------------------------------------------------------

test('R18 — the Q3 Enable prompt names the target through objectNameOf', () => {
  const som = somOf()
  const leaf = {
    kind: 'graph',
    origin: 'local',
    enabled: false,
    nodeMap: [OWN, TGT],
    targets: [TGT],
    graph: { types: [], declarations: [], nodes: [] },
  }
  assert.equal(
    enablePromptText(leaf, { nameOf: (id) => objectNameOf(som, id) }),
    'This graph runs again whenever you reconnect or your host tab changes, '
    + 'and it may overwrite what visitors changed. '
    + 'It can also change: Quad. Enable it?'
  )
})

test('R18 — a target that does not resolve leaves the raw id in the prompt', () => {
  const som = somOf()
  const leaf = { targets: [GONE], nodeMap: [OWN, GONE], graph: {} }
  assert.match(
    enablePromptText(leaf, { nameOf: (id) => objectNameOf(som, id) }),
    new RegExp(`It can also change: ${GONE}\\.`)
  )
})
