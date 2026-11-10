// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// grouping GR8 — edit-group.js on real SOMDocuments (PREBRIEF-grouping.md
// FINAL Rev 2, §5 "edit-group.js"). Every plan on turned, scaled, mirrored and
// nested groups (selection-parts lesson 3); the exact path (r8); the Empty
// groups list (r9's cases); the Move to list and what it leaves out.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Document } from '../../../packages/som/node_modules/@gltf-transform/core/dist/index.modern.js'
import { SOMDocument, worldMatrix } from '@atrium/som'
import {
  moveValue, inverseAffine, groupPlan, ungroupPlan, groupName, isBareNode, bareNodes, bareNodesKey,
  moveTargets, moveProblem, regroupCounts, breadcrumbText,
} from '../src/edit-group.js'

const q = (axis, deg) => { const s = Math.sin(deg * Math.PI / 360), c = Math.cos(deg * Math.PI / 360); return [axis[0] * s, axis[1] * s, axis[2] * s, c] }
const near = (a, b, eps = 1e-9) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= eps)
const worldT = (n) => worldMatrix(n).slice(12, 15)
const bitwise = (a, b) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]))

/**
 * Scene: outer (turned 37° about y, scaled 1.5, at 4.5,0,-2.25)
 *          └ G (turned 90° about y, scaled 2, at 0.3,1.7,-0.9) └ A (rotated, scaled)
 *        cube (rotated 33° about y, scale 1,0.5,2) ; M (mirrored: scale -1,1,1) ; S (3,1,1) ; Big (scale 150)
 */
function makeWorld() {
  const doc = new Document()
  const scene = doc.createScene('Scene'); doc.getRoot().setDefaultScene(scene)
  const buf = doc.createBuffer()
  const pos = doc.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buf)
  const mesh = () => doc.createMesh().addPrimitive(doc.createPrimitive().setAttribute('POSITION', pos))
  const add = (name, parent, { t, r, s, m = false } = {}) => {
    const n = doc.createNode(name)
    if (t) n.setTranslation(t); if (r) n.setRotation(r); if (s) n.setScale(s); if (m) n.setMesh(mesh())
    ;(parent ?? scene).addChild(n); return n
  }
  const outer = add('outer', null, { t: [4.5, 0, -2.25], r: q([0, 1, 0], 37), s: [1.5, 1.5, 1.5] })
  const G = add('G', outer, { t: [0.3, 1.7, -0.9], r: q([0, 1, 0], 90), s: [2, 2, 2] })
  add('A', G, { t: [1, 0.5, 0], r: q([1, 0, 0], 30), s: [0.5, 1, 1], m: true })
  add('cube', null, { t: [1.37, 0.25, -2.61], r: q([0, 1, 0], 33), s: [1, 0.5, 2], m: true })
  add('M', null, { t: [-3, 0, 0], s: [-1, 1, 1] })
  add('S', null, { t: [0, 0, 6], s: [3, 1, 1] })
  add('Big', null, { t: [0, 5, 0], s: [150, 150, 150] })
  add('plain', null, { t: [2, 0, 2], m: true })
  return new SOMDocument(doc)
}

/** Apply a move value in the SOM, as the client's echo would. */
const apply = (som, node, parent, value) => { const r = som.reparentNode(node, parent, value); assert.equal(r.ok, true, r.message) }

test('inverseAffine is the inverse of a turned, scaled, translated matrix', () => {
  const som = makeWorld()
  const m = worldMatrix(som.getNodeByName('G'))
  const inv = inverseAffine(m)
  const id = [0, 1, 2, 3].map((c) => [0, 1, 2, 3].map((r) => [0, 1, 2, 3].reduce((s, k) => s + inv[k * 4 + r] * m[c * 4 + k], 0)))
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) assert.ok(Math.abs(id[c][r] - (c === r ? 1 : 0)) < 1e-12)
  assert.equal(inverseAffine([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), null, 'singular')
})

test('moveValue keeps the world placement to 1e-9, into and out of a turned, scaled, nested group', () => {
  const som = makeWorld()
  const cube = som.getNodeByName('cube'), G = som.getNodeByName('G'), A = som.getNodeByName('A')
  const before = worldMatrix(cube)
  const into = moveValue(cube, G)
  assert.equal(into.ok, true, into.rule)
  assert.equal(into.exact, false, 'through the matrices')
  apply(som, cube, G, into.value)
  assert.ok(near(worldMatrix(cube), before), 'the cube stays where it was (into G)')
  const out = moveValue(cube, null)
  assert.equal(out.ok, true)
  apply(som, cube, null, out.value)
  assert.ok(near(worldMatrix(cube), before), 'and back at the top level')
  // a part out to the top level, two levels up
  const aBefore = worldMatrix(A)
  const up = moveValue(A, null)
  assert.equal(up.ok, true, up.rule)
  apply(som, A, null, up.value)
  assert.ok(near(worldMatrix(A), aBefore), 'A keeps its place at the top level')
})

test('moveValue refuses a computed scale that is mirrored, or under 0.01 (review S4, r4)', () => {
  const som = makeWorld()
  const cube = som.getNodeByName('cube')
  assert.deepEqual(moveValue(cube, som.getNodeByName('M')), { ok: false, rule: 'scale' }, 'into a mirrored group')
  assert.deepEqual(moveValue(cube, som.getNodeByName('Big')), { ok: false, rule: 'scale' }, 'into a group scaled 150')
})

test('moveValue refuses a shear in both directions', () => {
  const som = makeWorld()
  const cube = som.getNodeByName('cube'), S = som.getNodeByName('S')
  assert.deepEqual(moveValue(cube, S), { ok: false, rule: 'shear' }, 'a turned object into a 3,1,1 group')
  // a turned part inside the 3,1,1 group, out to the top level
  const doc = som._document
  const kid = doc.createNode('kid').setRotation(q([0, 0, 1], 45))
  S._node.addChild(kid)
  const som2 = new SOMDocument(doc)
  assert.deepEqual(moveValue(som2.getNodeByName('kid'), null), { ok: false, rule: 'shear' })
})

test('the exact path (r8): Group then Ungroup under a turned, scaled parent gives back the bitwise translation, rotation and scale', () => {
  const som = makeWorld()
  const G = som.getNodeByName('G')
  const doc = som._document
  doc.createNode('part'); const partG = doc.getRoot().listNodes().find((n) => n.getName() === 'part')
  partG.setTranslation([1.37, 0.25, -2.61]).setRotation(q([0, 1, 0], 33)).setScale([1, 0.5, 2])
  G._node.addChild(partG)
  const s2 = new SOMDocument(doc)
  const part = s2.getNodeByName('part'), G2 = s2.getNodeByName('G')
  const t0 = [...part.translation], r0 = [...part.rotation], sc0 = [...part.scale]
  const plan = groupPlan(part, { isFree: (n) => !s2.getNodeByName(n) })
  assert.equal(plan.ok, true)
  assert.equal(plan.descriptor.name, 'group-01')
  assert.deepEqual(plan.descriptor.translation, t0)
  assert.ok(plan.parent === G2, 'into the part’s own parent')
  const group = s2.ingestNode(plan.descriptor); G2.addChild(group)
  apply(s2, part, group, plan.objectValue)
  assert.ok(near(worldMatrix(part).slice(12, 15), worldT(G2) && worldMatrix(part).slice(12, 15)), 'sanity')
  const un = ungroupPlan(group)
  assert.equal(un.ok, true)
  assert.equal(un.parts.length, 1)
  const v = un.parts[0].value
  assert.ok(bitwise(v.translation, t0), `translation bitwise: ${JSON.stringify(v.translation)} vs ${JSON.stringify(t0)}`)
  assert.ok(bitwise(v.rotation, r0), 'rotation bitwise')
  assert.ok(bitwise(v.scale, sc0), 'scale bitwise')
  assert.equal(moveValue(part, G2).exact, true, 'the exact path was taken')
})

test('an already-mirrored part can be grouped and ungrouped: a scale kept bitwise is never refused (second review N2)', () => {
  const som = makeWorld()
  const M = som.getNodeByName('M')
  const plan = groupPlan(M, { isFree: () => true })
  assert.deepEqual(plan.objectValue.scale, [-1, 1, 1])
  const group = som.ingestNode(plan.descriptor); som.scene.addChild(group)
  apply(som, M, group, plan.objectValue)
  const un = ungroupPlan(group)
  assert.equal(un.ok, true, un.rule)
  assert.ok(bitwise(un.parts[0].value.scale, [-1, 1, 1]))
  assert.ok(bitwise(un.parts[0].value.translation, [-3, 0, 0]))
})

test('the Group plan in a nested turned group keeps the world placement bitwise (f1)', () => {
  const som = makeWorld()
  const A = som.getNodeByName('A')
  const before = worldMatrix(A)
  const plan = groupPlan(A, { isFree: () => true })
  const group = som.ingestNode(plan.descriptor); plan.parent.addChild(group)
  apply(som, A, group, plan.objectValue)
  assert.ok(bitwise(worldMatrix(A), before), 'identical, not just near')
})

test('groupName takes the next free group-NN', () => {
  const taken = new Set(['group-01', 'group-02'])
  assert.equal(groupName((n) => !taken.has(n)), 'group-03')
  assert.equal(groupName(() => true), 'group-01')
})

test('isBareNode: bare, emptied, or bare with a behaviour, a light, a camera or a teleporter; not a mesh, a model or a group', () => {
  const som = makeWorld()
  const doc = som._document
  const mk = (name, extras) => { const n = doc.createNode(name); if (extras) n.setExtras(extras); doc.getRoot().getDefaultScene().addChild(n); return n }
  mk('bare'); mk('beh', { atrium: { behavior: { enabled: true } } }); mk('tp', { atrium: { teleporter: { destination: '#' } } })
  mk('modelled', { atrium: { model: { url: 'x.glb' } } })
  mk('cam').setCamera(doc.createCamera('lens').setType('perspective'))
  const s2 = new SOMDocument(doc)
  for (const n of ['bare', 'beh', 'tp', 'cam']) assert.equal(isBareNode(s2.getNodeByName(n)), true, n)
  for (const n of ['cube', 'modelled', 'G', 'outer']) assert.equal(isBareNode(s2.getNodeByName(n)), false, n)
  // a group emptied by a move
  const G = s2.getNodeByName('G'), A = s2.getNodeByName('A')
  apply(s2, A, null, moveValue(A, null).value)
  assert.equal(isBareNode(G), true, 'G emptied')
})

test('bareNodes: sorted with nested breadcrumbs; no avatar or its camera child, no source container or what is under it, nothing unaddressable (r9)', () => {
  const som = makeWorld()
  const doc = som._document
  const scene = doc.getRoot().getDefaultScene()
  const mk = (name, parent, extras) => { const n = doc.createNode(name); if (extras) n.setExtras(extras); (parent ?? scene).addChild(n); return n }
  mk('zeta'); const holder = mk('holder'); holder.setMesh(doc.createMesh()); mk('inner', holder)
  const av = mk('avatar-1'); mk('avatar-1-camera', av)
  const cont = mk('container', null, { atrium: { source: 'a.gltf' } }); mk('loaded', cont)
  mk('zeta')                                               // a second "zeta": shadowed, not addressable
  const s2 = new SOMDocument(doc)
  const list = bareNodes(s2, { isExcluded: (n) => n.name === 'avatar-1' })
  const labels = list.map((e) => e.label)
  // Big, M and S have no mesh: bare too
  assert.deepEqual(labels, ['Big', 'M', 'S', 'holder › inner', 'zeta'], JSON.stringify(labels))
  assert.ok(list[4].node === s2.getNodeByName('zeta'), 'the addressable zeta')
  assert.equal(bareNodesKey(list), 'Big\nM\nS\nholder › inner\nzeta')
  assert.equal(breadcrumbText(s2.getNodeByName('A')), 'outer › G › A')
})

test('moveTargets: groups and bare nodes, sorted; Top level for a part; exclusions; shears counted', () => {
  const som = makeWorld()
  const doc = som._document
  const scene = doc.getRoot().getDefaultScene()
  const mk = (name, parent, extras) => { const n = doc.createNode(name); if (extras) n.setExtras(extras); (parent ?? scene).addChild(n); return n }
  mk('empty-1')
  const modelled = mk('modelled', null, { atrium: { model: { url: 'x.glb' } } }); mk('mkid', modelled)
  const hidden = mk('hidden', null, { __atrium_visible: false }); mk('hkid', hidden)
  const scripted = mk('scripted', null, { atrium: { behavior: { enabled: false } } }); mk('skid', scripted)
  const av = mk('avatar-9'); mk('avatar-9-cam', av)
  const big = mk('big'); for (let i = 0; i < 255; i++) mk(`big-${i}`, big)   // 256: one more would pass the bound
  mk('skew-kid', som.getNodeByName('S')._node)             // S (3,1,1) is now a group: a turned cube would shear
  const s2 = new SOMDocument(doc)
  const cube = s2.getNodeByName('cube')
  const r = moveTargets(cube, s2, { isExcluded: (n) => n.name === 'avatar-9' })
  const labels = r.targets.map((t) => t.label)
  assert.ok(labels.includes('empty-1'), 'a bare node is a target')
  assert.ok(labels.includes('outer') && labels.includes('outer › G'), 'groups, nested ones with their breadcrumb')
  for (const left of ['modelled', 'hidden', 'scripted', 'avatar-9', 'big', 'S', 'cube']) assert.equal(labels.includes(left), false, `${left} left out`)
  assert.equal(r.topLevel, null, 'cube is at the top level already')
  assert.ok(r.skipped >= 1, 'S counted as skipped for a shear')
  assert.deepEqual(labels, [...labels].sort(), 'sorted')
  // a part: its own group and its descendants are left out; Top level is offered
  const A = s2.getNodeByName('A')
  const ra = moveTargets(A, s2)
  assert.equal(ra.targets.some((t) => t.node === s2.getNodeByName('G')), false, 'not its current parent')
  assert.ok(ra.topLevel, 'Top level for a part')
  const G = s2.getNodeByName('G')
  assert.equal(moveTargets(s2.getNodeByName('outer'), s2).targets.some((t) => t.node === G), false, 'not a descendant')
  assert.equal(moveProblem(s2.getNodeByName('hkid'), null, s2).rule, 'hidden', 'out of a hidden group')
  assert.equal(moveProblem(s2.getNodeByName('skid'), null, s2).rule, 'behavior', 'out of a scripted group')
})

test('regroupCounts: an Ungroup’s Undo at the top level and under a parent', () => {
  const som = makeWorld()
  const A = som.getNodeByName('A'), cube = som.getNodeByName('cube')
  assert.deepEqual(regroupCounts(null, [A, cube]), { before: { nodes: 1, depth: 0, primitives: 0 }, after: { nodes: 3, depth: 1, primitives: 2 } })
  const outer = som.getNodeByName('outer')
  const rc = regroupCounts(outer, [som.getNodeByName('G')])
  assert.deepEqual(rc.before, { nodes: 3, depth: 2, primitives: 1 })
  assert.deepEqual(rc.after, { nodes: 4, depth: 3, primitives: 1 })
})
