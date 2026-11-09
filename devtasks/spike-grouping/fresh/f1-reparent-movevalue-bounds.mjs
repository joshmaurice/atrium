// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// f1 — fresh check of PREBRIEF-grouping.md Rev 0.1: GR1 (a reparentNode
// prototype on the real SOMDocument), the move value (moveValue via
// part-transform.js) on a turned+scaled+nested group, a mirror and a shear,
// GR-L6's Group plan, and GR4's bounds count. Run from the repo root:
//   node devtasks/spike-grouping/fresh/f1-reparent-movevalue-bounds.mjs
import { createRequire } from 'node:module'
import path from 'node:path'
import { SOMDocument } from '../../../packages/som/src/index.js'
import { worldMatrix, localMatrix } from '../../../packages/som/src/world-matrix.js'
import { multiply, inverse3, linear, apply3, decomposeTRS, partWorldTRS, SHEAR_TOLERANCE } from '../../../apps/client/src/part-transform.js'
import { SUBTREE_DEPTH_MAX, SUBTREE_NODES_MAX } from '../../../packages/server/src/send-policy.js'

const reqS = createRequire(path.resolve('packages/som/package.json'))
const { Document } = await import(reqS.resolve('@gltf-transform/core'))
const out = (k, v) => console.log(k.padEnd(60), v)
const r6 = (a) => a.map((x) => +x.toFixed(6))
const maxDiff = (a, b) => Math.max(...a.map((x, i) => Math.abs(x - b[i])))

// ── GR1 prototype ─────────────────────────────────────────────────────────
function reparentNode(som, node, parent, { translation, rotation, scale }) {
  if (!node || som.getNodeByName(node.name) !== node) return { ok: false, code: 'NODE_NOT_FOUND' }
  if (parent) {
    for (let a = parent; a; a = a.parent) if (a === node) return { ok: false, code: 'INVALID_VALUE', message: 'a node can’t go inside itself' }
  }
  if ((node.parent ?? null) === (parent ?? null)) return { ok: false, code: 'INVALID_VALUE', message: 'already there' }
  node.translation = translation; node.rotation = rotation; node.scale = scale
  ;(parent ?? som.scene).addChild(node)
  return { ok: true }
}

// The affine inverse of a column-major 4x4 (part-transform.js has only inverse3)
function inverseAffine(m) {
  const li = inverse3(linear(m)); if (!li) return null
  const t = apply3(li, [m[12], m[13], m[14]]).map((x) => -x)
  return [li[0], li[1], li[2], 0, li[3], li[4], li[5], 0, li[6], li[7], li[8], 0, t[0], t[1], t[2], 1]
}
// moveValue as GR8 words it: inverse(world(newParent)) × world(node), decomposed,
// with partWorldTRS's shear refusal (it multiplies parentWorld × local, so pass
// inverse(world(P)) as "parentWorld" and world(node) decomposed... simpler: decompose
// and check the round trip ourselves, with partWorldTRS's tolerance).
function moveValue(node, newParent) {
  const pInv = newParent ? inverseAffine(worldMatrix(newParent)) : [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]
  if (!pInv) return { ok: false, rule: 'transform' }
  const m = multiply(pInv, worldMatrix(node))
  const d = decomposeTRS(m)
  const back = localMatrix(d)
  for (let col = 0; col < 3; col++) {
    const len = Math.hypot(m[col * 4], m[col * 4 + 1], m[col * 4 + 2])
    for (let row = 0; row < 3; row++) if (!(Math.abs(back[col * 4 + row] - m[col * 4 + row]) <= SHEAR_TOLERANCE * Math.max(1e-9, len))) return { ok: false, rule: 'shear' }
  }
  return { ok: true, value: d }
}

function world() {
  const doc = new Document(); const s = doc.createScene('s'); doc.getRoot().setDefaultScene(s)
  const b = doc.createBuffer()
  const pos = doc.createAccessor().setType('VEC3').setArray(new Float32Array([0,0,0,1,0,0,0,1,0])).setBuffer(b)
  const mesh = () => doc.createMesh().addPrimitive(doc.createPrimitive().setAttribute('POSITION', pos))
  const q = (axis, deg) => { const h = deg * Math.PI / 360, s_ = Math.sin(h); return [axis[0]*s_, axis[1]*s_, axis[2]*s_, Math.cos(h)] }
  // outer: turned 90° about y, scaled 2, translated; inner: nested, turned 30° about x, at (0,1,0)
  const outer = doc.createNode('outer').setTranslation([10, 0, 0]).setRotation(q([0,1,0], 90)).setScale([2, 2, 2])
  const inner = doc.createNode('inner').setTranslation([0, 1, 0]).setRotation(q([1,0,0], 30))
  const anchor = doc.createNode('anchor').setMesh(mesh())
  outer.addChild(inner); inner.addChild(anchor)
  const mirror = doc.createNode('mirror').setTranslation([-5, 0, 0]).setScale([-1, 1, 1]).addChild(doc.createNode('m-kid').setMesh(mesh()))
  const squash = doc.createNode('squash').setScale([3, 1, 1]).setTranslation([0, 0, -8]).addChild(doc.createNode('s-kid').setMesh(mesh()))
  const crate = doc.createNode('crate').setMesh(mesh()).setTranslation([1, 0.25, 4]).setRotation(q([0, 0, 1], 45)).setScale([1, 0.5, 2])
  for (const n of [outer, mirror, squash, crate]) s.addChild(n)
  return new SOMDocument(doc)
}

// 1. GR1: the cycle, already-there, and events fired
{
  const som = world()
  const outer = som.getNodeByName('outer'), inner = som.getNodeByName('inner'), anchor = som.getNodeByName('anchor'), crate = som.getNodeByName('crate')
  out('GR1 outer into inner (child)', JSON.stringify(reparentNode(som, outer, inner, { translation: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1] })))
  out('GR1 outer into anchor (grandchild)', JSON.stringify(reparentNode(som, outer, anchor, { translation: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1] })))
  out('GR1 crate to top (already there)', JSON.stringify(reparentNode(som, crate, null, { translation: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1] })))
  const events = []
  crate.addEventListener('mutation', (e) => events.push(e.detail.property ?? 'childList'))
  inner.addEventListener('mutation', (e) => events.push('inner:' + (e.detail.property ?? 'childList')))
  reparentNode(som, crate, inner, { translation: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1] })
  out('GR1 via SOMNode setters: mutation events fired', events.join(','))
}

// 2. moveValue: world kept, into a turned+scaled+nested group and back
for (const [label, target] of [['into inner (turned 90y, x2, nested 30x)', 'inner'], ['into mirror (scale -1 x)', 'mirror'], ['into squash (scale 3,1,1)', 'squash']]) {
  const som = world()
  const crate = som.getNodeByName('crate'), P = som.getNodeByName(target)
  const w0 = worldMatrix(crate)
  const mv = moveValue(crate, P)
  if (!mv.ok) { out(`moveValue ${label}`, `refused: ${mv.rule}`); continue }
  const before = { translation: [...crate.translation], rotation: [...crate.rotation], scale: [...crate.scale] }
  reparentNode(som, crate, P, mv.value)
  out(`moveValue ${label}: world kept (max |Δ|)`, maxDiff(w0, worldMatrix(crate)).toExponential(2) + `  local scale ${r6(mv.value.scale)}`)
  // Undo with the exact old values
  reparentNode(som, crate, null, before)
  const exact = ['translation', 'rotation', 'scale'].every((f) => crate[f].every((x, i) => x === before[f][i]))
  out(`  undo with exact old values: bitwise equal / world |Δ|`, `${exact} / ${maxDiff(w0, worldMatrix(crate)).toExponential(2)}`)
  // A second "Move to top level" by maths instead (what option (b) would give)
  reparentNode(som, crate, P, mv.value)
  const mv2 = moveValue(crate, null)
  const same = mv2.ok && ['translation', 'rotation', 'scale'].every((f) => mv2.value[f].every((x, i) => x === before[f][i]))
  out(`  move back by maths (not exact values): bitwise equal to the original`, String(same))
}

// 2b. A shear: a part rotated inside the squashed group, moved to the top level
{
  const som = world()
  const kid = som.getNodeByName('s-kid'); kid.rotation = [0, 0, Math.sin(Math.PI / 8), Math.cos(Math.PI / 8)]
  out('moveValue s-kid (rotated in a 3,1,1 group) to top level', JSON.stringify(moveValue(kid, null).ok ? 'ok' : moveValue(kid, null)))
  // the same node moved into a group with the SAME squash: no shear
  out('moveValue a rotated node INTO a 3,1,1 group (crate rot 45z)', JSON.stringify((() => { const s2 = world(); const r = moveValue(s2.getNodeByName('crate'), s2.getNodeByName('squash')); return r.ok ? 'ok' : r })()))
}

// 2c. A mirrored part moved to the top level: decomposed with negative x scale
{
  const som = world()
  const kid = som.getNodeByName('m-kid'); kid.rotation = [0, Math.sin(Math.PI / 8), 0, Math.cos(Math.PI / 8)]
  const w0 = worldMatrix(kid); const mv = moveValue(kid, null)
  reparentNode(som, kid, null, mv.value)
  out('mirror kid to top: value scale / world |Δ|', `${r6(mv.value.scale)} / ${maxDiff(w0, worldMatrix(kid)).toExponential(2)}`)
}

// 3. GR-L6 Group plan: group at the object's local translation, object at 0
{
  const som = world()
  const anchor = som.getNodeByName('anchor'); anchor.translation = [0.3, -0.2, 1.7]; anchor.rotation = [0, 0, Math.sin(0.3), Math.cos(0.3)]; anchor.scale = [1, 2, 3]
  const w0 = worldMatrix(anchor)
  const g = som.ingestNode({ name: 'group-01', translation: [...anchor.translation] })
  som.getNodeByName('inner').addChild(g)
  reparentNode(som, anchor, g, { translation: [0, 0, 0], rotation: [...anchor.rotation], scale: [...anchor.scale] })
  out('Group plan in a nested turned group: world |Δ| (bitwise equal?)', `${maxDiff(w0, worldMatrix(anchor)).toExponential(2)} (${w0.every((x, i) => x === worldMatrix(anchor)[i])})`)
}

// 4. GR4's count: "generations below the root", counted as subtreeCountProblem does
{
  // a chain root→c1→…→c8 is 8 generations below the root: accepted by SA-L2
  function chain(som, prefix, depth) {
    const top = som.ingestNode({ name: `${prefix}0` }); som.scene.addChild(top)
    let cur = top
    for (let i = 1; i <= depth; i++) { const n = som.ingestNode({ name: `${prefix}${i}` }); cur.addChild(n); cur = n }
    return { top, leaf: cur }
  }
  function treeBounds(root) {
    let members = 0, maxGen = 0
    const st = [[root, 0]]
    while (st.length) { const [n, g] = st.pop(); members++; maxGen = Math.max(maxGen, g); for (const c of n.children) st.push([c, g + 1]) }
    return { members, maxGen, over: members > SUBTREE_NODES_MAX || maxGen > SUBTREE_DEPTH_MAX }
  }
  const doc = new Document(); const s = doc.createScene('s'); doc.getRoot().setDefaultScene(s)
  const som = new SOMDocument(doc)
  const a = chain(som, 'a', 4)     // a0..a4
  const b = chain(som, 'b', 4)     // b0..b4: a 4-deep tree, moved under a4 → b4 at generation 9
  const before = treeBounds(a.top)
  reparentNode(som, b.top, a.leaf, { translation: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1] })
  out('GR4: a0 (4 deep) after b0 (4 deep) goes under a4', JSON.stringify({ before, after: treeBounds(a.top) }))
  // within one tree: moving b-chain from a4 to a3 doesn't add members
  const t1 = treeBounds(a.top)
  reparentNode(som, b.top, som.getNodeByName('a3'), { translation: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1] })
  const t2 = treeBounds(a.top)
  out('GR4: within the same top-level tree, members before/after (a "plus" count would add 5)', `${t1.members} / ${t2.members}`)
}
