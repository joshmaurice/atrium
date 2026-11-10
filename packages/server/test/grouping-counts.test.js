// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// grouping GR4 (second review S3) — `treeCounts` and its helpers have two
// copies: the server's (`send-policy.js`, which refuses) and the client's
// (`packages/client/src/add-spec.js`, which the panel asks first with). This
// file holds them to the same answers on the same live trees, as
// add-node-vectors does for `checkAddNode`. Real SOMDocuments; no mocks.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Document } from '@gltf-transform/core'
import { SOMDocument } from '../../som/src/SOMDocument.js'
import * as server from '../src/send-policy.js'
import * as client from '../../client/src/add-spec.js'

const NAMES = ['topLevelOf', 'generationBelow', 'treeCounts', 'moveCounts', 'treeBoundsProblem', 'TREE_BOUNDS_MESSAGE']

test('GR4: both copies export the same names', () => {
  for (const n of NAMES) {
    assert.equal(typeof server[n], typeof client[n], n)
    assert.ok(server[n] !== undefined, `the server exports ${n}`)
  }
  assert.equal(client.TREE_BOUNDS_MESSAGE, server.TREE_BOUNDS_MESSAGE)
  assert.equal(client.SUBTREE_NODES_MAX, server.SUBTREE_NODES_MAX)
  assert.equal(client.SUBTREE_DEPTH_MAX, server.SUBTREE_DEPTH_MAX)
  assert.equal(client.SUBTREE_PRIMITIVES_MAX, server.SUBTREE_PRIMITIVES_MAX)
})

/** A world of several shapes: a wide group, a deep chain, a primitive-heavy group, a container. */
function world() {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  doc.getRoot().setDefaultScene(scene)
  const buf = doc.createBuffer()
  const pos = doc.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buf)
  const mesh = (k) => { const m = doc.createMesh(); for (let i = 0; i < k; i++) m.addPrimitive(doc.createPrimitive().setAttribute('POSITION', pos)); return m }
  const node = (name, parent, k = 0) => { const n = doc.createNode(name); if (k) n.setMesh(mesh(k)); (parent ?? scene).addChild(n); return n }
  const wide = node('wide'); for (let i = 0; i < 300; i++) node(`wide-${i}`, wide)
  let link = node('deep-0'); for (let g = 1; g <= 9; g++) link = node(`deep-${g}`, link)
  const heavy = node('heavy'); for (let i = 0; i < 17; i++) node(`heavy-${i}`, heavy, 64)
  const box = node('box'); const c = node('container', box); c.setExtras({ atrium: { source: 'https://example.com/a.gltf' } })
  for (let i = 0; i < 400; i++) node(`loaded-${i}`, c, 2)
  node('single', null, 1)
  const g = node('g'); node('g-a', g); node('g-b', node('g-mid', g))
  return new SOMDocument(doc)
}

test('GR4: treeCounts, generationBelow and topLevelOf agree on every node of the world', () => {
  const som = world()
  let compared = 0
  for (const n of som.nodes) {
    assert.deepEqual(client.treeCounts(n), server.treeCounts(n), `treeCounts(${n.name})`)
    assert.ok(client.topLevelOf(n) === server.topLevelOf(n), `topLevelOf(${n.name})`)
    assert.equal(client.generationBelow(client.topLevelOf(n), n), server.generationBelow(server.topLevelOf(n), n), `generationBelow(${n.name})`)
    compared += 1
  }
  assert.equal(compared, 736, 'every named node of the world')
  // and the expected values for the shapes
  assert.deepEqual(server.treeCounts(som.getNodeByName('wide')), { nodes: 301, depth: 1, primitives: 0 })
  assert.deepEqual(server.treeCounts(som.getNodeByName('deep-0')), { nodes: 10, depth: 9, primitives: 0 })
  assert.deepEqual(server.treeCounts(som.getNodeByName('heavy')), { nodes: 18, depth: 1, primitives: 1088 })
  assert.deepEqual(server.treeCounts(som.getNodeByName('box')), { nodes: 2, depth: 1, primitives: 0 }, 'nothing under the container counts')
})

test('GR4: moveCounts and treeBoundsProblem agree for every (node, parent) pair of a sample', () => {
  const som = world()
  const sample = ['wide', 'wide-0', 'wide-299', 'deep-0', 'deep-5', 'deep-9', 'heavy', 'heavy-3', 'box', 'container', 'single', 'g', 'g-a', 'g-mid', 'g-b']
    .map((n) => som.getNodeByName(n))
  let pairs = 0
  for (const node of sample) {
    for (const parent of [null, ...sample]) {
      if (parent && (parent === node || som.reparentProblem(node, parent))) continue
      const a = client.moveCounts(node, parent), b = server.moveCounts(node, parent)
      assert.deepEqual(a, b, `moveCounts(${node.name} → ${parent?.name ?? 'top'})`)
      assert.equal(client.treeBoundsProblem(a), server.treeBoundsProblem(b), `treeBoundsProblem(${node.name} → ${parent?.name ?? 'top'})`)
      pairs += 1
    }
  }
  assert.ok(pairs > 150, `compared ${pairs} moves`)
  // the rule's cases, through the client's copy
  const n = (x) => som.getNodeByName(x)
  assert.equal(client.treeBoundsProblem(client.moveCounts(n('single'), n('g'))), null, 'a small group grows')
  assert.equal(client.treeBoundsProblem(client.moveCounts(n('single'), n('wide'))), null, 'a tree already over may grow')
  assert.equal(client.treeBoundsProblem(client.moveCounts(n('g'), n('deep-7'))), null, 'the deep chain is already over the depth bound, so it may grow')
  assert.equal(client.treeBoundsProblem(client.moveCounts(n('heavy'), n('g'))), 'primitives', 'g would hold 1,088 primitives')
  assert.equal(client.treeBoundsProblem(client.moveCounts(n('deep-3'), n('g-b'))), 'depth', 'deep-3 (6 below it) under generation 2 reaches 9')
  assert.equal(client.treeBoundsProblem(client.moveCounts(n('heavy-0'), n('g'))), null, '64 primitives')
  assert.equal(client.moveCounts(n('single'), null), null, 'the top level is never counted')
})
