// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// grouping GR1 — SOMDocument.reparentNode: one way to move a node to another
// parent, atomic, with the local placement given. Real glTF-Transform
// Documents and real SOMDocuments; no mocks.

import { test }   from 'node:test'
import assert     from 'node:assert/strict'
import { Document, NodeIO } from '@gltf-transform/core'
import { SOMDocument } from '../src/SOMDocument.js'

/** Scene -> G (turned 90° about y, scaled 2) -> A ; Scene -> C ; Scene -> H -> K -> L */
function makeDoc() {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  doc.getRoot().setDefaultScene(scene)
  const g = doc.createNode('G').setTranslation([10, 0, 0]).setRotation([0, Math.SQRT1_2, 0, Math.SQRT1_2]).setScale([2, 2, 2])
  const a = doc.createNode('A').setTranslation([1, 0, 0])
  const c = doc.createNode('C').setTranslation([0, 0, 5])
  const h = doc.createNode('H'), k = doc.createNode('K'), l = doc.createNode('L')
  g.addChild(a); h.addChild(k); k.addChild(l)
  scene.addChild(g); scene.addChild(c); scene.addChild(h)
  return doc
}

const place = (t = [1, 2, 3], r = [0, 0, 0, 1], s = [1, 1, 1]) => ({ translation: t, rotation: r, scale: s })
const kids = (n) => n.children.map((c) => c.name)
const sceneKids = (som) => som.scene.children.map((c) => c.name)

test('GR1: a move into a group, with the vectors exactly as given', () => {
  const som = new SOMDocument(makeDoc())
  const C = som.getNodeByName('C'), G = som.getNodeByName('G')
  const t = [0.1 + 0.2, -2.5, 1e-9], r = [0, 0.6, 0, 0.8], s = [-1, 0.5, 2]
  const out = som.reparentNode(C, G, place(t, r, s))
  assert.deepEqual(out, { ok: true, code: null, message: null })
  assert.ok(C.parent === G, 'C is under G')
  assert.deepEqual(kids(G), ['A', 'C'], 'appended after A')
  assert.deepEqual(sceneKids(som), ['G', 'H'], 'no longer at the top level')
  assert.deepEqual([...C.translation], t, 'translation bitwise')
  assert.deepEqual([...C.rotation], r, 'rotation bitwise')
  assert.deepEqual([...C.scale], s, 'scale bitwise')
})

test('GR1: a move to the top level (parent null)', () => {
  const som = new SOMDocument(makeDoc())
  const A = som.getNodeByName('A'), G = som.getNodeByName('G')
  const out = som.reparentNode(A, null, place([7, 0, 0]))
  assert.equal(out.ok, true)
  assert.equal(A.parent, null)
  assert.deepEqual(kids(G), [])
  assert.deepEqual(sceneKids(som), ['G', 'C', 'H', 'A'])
  assert.deepEqual([...A.translation], [7, 0, 0])
})

test('GR1: a move between groups', () => {
  const som = new SOMDocument(makeDoc())
  const A = som.getNodeByName('A'), G = som.getNodeByName('G'), K = som.getNodeByName('K')
  assert.equal(som.reparentNode(A, K, place()).ok, true)
  assert.ok(A.parent === K)
  assert.deepEqual(kids(G), [])
  assert.deepEqual(kids(K), ['L', 'A'])
})

test('GR1: a cycle is refused (self, child, grandchild) and nothing changes', () => {
  for (const [node, parent] of [['H', 'H'], ['H', 'K'], ['H', 'L']]) {
    const som = new SOMDocument(makeDoc())
    const N = som.getNodeByName(node), P = som.getNodeByName(parent)
    const before = [...N.translation]
    const out = som.reparentNode(N, P, place([9, 9, 9]))
    assert.deepEqual(out, { ok: false, code: 'INVALID_VALUE', message: 'a node can’t go inside itself' }, `${node} into ${parent}`)
    assert.equal(N.parent, null, `${node} still at the top level`)
    assert.deepEqual(sceneKids(som), ['G', 'C', 'H'], 'the scene unchanged')
    assert.deepEqual([...N.translation], before, 'the vectors unchanged')
  }
})

test('GR1: "already there" is refused, at the top level and in a group', () => {
  const som = new SOMDocument(makeDoc())
  const C = som.getNodeByName('C'), A = som.getNodeByName('A'), G = som.getNodeByName('G')
  assert.deepEqual(som.reparentNode(C, null, place([9, 9, 9])), { ok: false, code: 'INVALID_VALUE', message: 'already there' })
  assert.deepEqual(som.reparentNode(A, G, place([9, 9, 9])), { ok: false, code: 'INVALID_VALUE', message: 'already there' })
  assert.deepEqual([...C.translation], [0, 0, 5])
  assert.deepEqual([...A.translation], [1, 0, 0])
})

test('GR1: a node or parent that is not live in this document is refused', () => {
  const som = new SOMDocument(makeDoc())
  const other = new SOMDocument(makeDoc())
  const C = som.getNodeByName('C')
  assert.equal(som.reparentNode(other.getNodeByName('C'), null, place()).code, 'NODE_NOT_FOUND')
  assert.equal(som.reparentNode(C, other.getNodeByName('G'), place()).code, 'NODE_NOT_FOUND')
  assert.equal(som.reparentNode(null, null, place()).code, 'NODE_NOT_FOUND')
  assert.equal(C.parent, null)
})

test('GR1: no SOM mutation event fires (the SOMNode setters would fire four)', () => {
  const som = new SOMDocument(makeDoc())
  const C = som.getNodeByName('C'), G = som.getNodeByName('G')
  const seen = []
  for (const n of [C, G]) n.addEventListener('mutation', (e) => seen.push(e))
  som.scene.addEventListener?.('mutation', (e) => seen.push(e))
  assert.equal(som.reparentNode(C, G, place([0, 1, 0])).ok, true)
  assert.equal(som.reparentNode(C, null, place([0, 2, 0])).ok, true)
  assert.equal(seen.length, 0, `mutation events: ${seen.map((e) => JSON.stringify(e.detail ?? e)).join('; ')}`)
})

test('GR1: the node list keeps its order, and the saved file reads back with the new tree', async () => {
  const doc = makeDoc()
  const som = new SOMDocument(doc)
  const order = () => doc.getRoot().listNodes().map((n) => n.getName()).join(',')
  const before = order()
  assert.equal(som.reparentNode(som.getNodeByName('C'), som.getNodeByName('G'), place()).ok, true)
  assert.equal(order(), before, 'root.listNodes() order unchanged (saved indices stable)')
  const io = new NodeIO()
  const back = await io.readJSON(await io.writeJSON(doc))
  const G = back.getRoot().listNodes().find((n) => n.getName() === 'G')
  assert.deepEqual(G.listChildren().map((n) => n.getName()), ['A', 'C'])
  assert.deepEqual(back.getRoot().listScenes()[0].listChildren().map((n) => n.getName()), ['G', 'H'])
})

test('GR1: reparentProblem runs the checks without applying', () => {
  const som = new SOMDocument(makeDoc())
  const H = som.getNodeByName('H'), L = som.getNodeByName('L'), C = som.getNodeByName('C')
  assert.equal(som.reparentProblem(H, L).message, 'a node can’t go inside itself')
  assert.equal(som.reparentProblem(C, null).message, 'already there')
  assert.equal(som.reparentProblem(C, H), null)
  assert.equal(C.parent, null, 'nothing applied')
})
