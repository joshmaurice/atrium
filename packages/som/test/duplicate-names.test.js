// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// duplicate-names — Phase 3 server-cleanup, §7.1 K5(a) and K5(b) at the SOM
// level: the name setter renames only the node it belongs to (E7/L6(a)), and
// one node per name, first-registered, with take-over when it goes.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Document } from '@gltf-transform/core'
import { SOMDocument } from '../src/SOMDocument.js'

const VEC3 = (doc, buf, array) =>
  doc.createAccessor().setType('VEC3').setArray(new Float32Array(array)).setBuffer(buf)

/** A scene holding two nodes both named 'Dup', each with its own mesh. */
function twoDups() {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  const buf = doc.createBuffer()
  for (const name of ['Dup', 'Dup']) {
    scene.addChild(doc.createNode(name).setMesh(doc.createMesh(`${name}-mesh`)
      .addPrimitive(doc.createPrimitive().setAttribute('POSITION', VEC3(doc, buf, [0, 0, 0])))))
  }
  const som = new SOMDocument(doc)
  const [first, second] = som.allNodes.filter(n => n.name === 'Dup')
  return { doc, som, first, second }
}

// ===========================================================================
// K5(b) — first-registered wins in both maps
// ===========================================================================

test('K5(b): two nodes named Dup load with the first in both maps, in every lookup', () => {
  const { som, first, second } = twoDups()
  assert.notEqual(first, second)
  assert.equal(som.getNodeByName('Dup'), first, 'the node map keeps the first')
  assert.equal(som.getObjectByName('Dup'), first, 'the global namespace keeps the first')
  assert.equal(som.allNodes.filter(n => n.name === 'Dup').length, 2,
    'both nodes are still in the document')
})

test('K5(b): the freed name passes to the next node in document order', () => {
  const { som, first, second } = twoDups()
  som.removeSubtree(first)
  assert.equal(som.getNodeByName('Dup'), second, 'the second took the name over')
  assert.equal(som.getObjectByName('Dup'), second)
  assert.equal(second.name, 'Dup', 'the second node is untouched')
})

// ===========================================================================
// K5(a) — the setter renames only its own node (E7, L6(a)'s som half)
// ===========================================================================

test('K5(a): without divergence the setter renames the node it belongs to', () => {
  const { som, first, second } = twoDups()
  first.name = 'Dup-1'
  assert.equal(first.name, 'Dup-1', 'the first node was renamed')
  assert.equal(second.name, 'Dup', 'the second node is untouched')
  assert.equal(som.getNodeByName('Dup'), second, 'and it took the name over')
  assert.equal(som.getNodeByName('Dup-1'), first)
})

test('K5(a): with the two maps diverged on purpose, the setter throws and renames nothing', () => {
  const { som, first, second } = twoDups()

  // Inject the divergence a diverged client can present: the global namespace
  // names one node, the node map another. The setter must hand itself to
  // renameNode as the target, so the wrong node is never renamed.
  som._nodesByName.set('Dup', second)
  assert.equal(som.getObjectByName('Dup'), first)
  assert.equal(som.getNodeByName('Dup'), second)

  assert.throws(() => { first.name = 'Renamed' }, (err) => {
    assert.equal(err.code, 'INVALID_VALUE')
    assert.match(err.message, /rename target is not the named node|INVALID_VALUE/)
    return true
  }, 'the setter refuses rather than renaming the wrong node')

  assert.equal(first.name, 'Dup', 'the node the setter belongs to is untouched')
  assert.equal(second.name, 'Dup', 'the node the naive lookup would have renamed is untouched')
  assert.equal(som.getNodeByName('Renamed'), null, 'nothing took the new name')
})
