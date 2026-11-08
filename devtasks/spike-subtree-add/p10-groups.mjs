// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// p10 — the shape of every top-level node WITH CHILDREN in the given glTF files:
// what a subtree `add` would have to carry. For each group: descendants, depth,
// which descendants a per-node Duplicate rule would refuse (the `children` and
// `parent` rules set aside), what each descendant carries (mesh, extras.atrium
// keys, hidden marker, objectId, camera/light/skin, animation), whether every
// name in the subtree is unique in the file, and the UTF-8 size of a one-message
// subtree descriptor (richer-add's buildDescriptor per node, nested).
// Run from the repo root:
//   node devtasks/spike-subtree-add/p10-groups.mjs tests/fixtures/*.gltf devtasks/harness/group.gltf
import { createRequire } from 'node:module'
import path from 'node:path'
const req = createRequire(path.resolve('packages/som/package.json'))
const { NodeIO } = await import(req.resolve('@gltf-transform/core'))
const { ALL_EXTENSIONS } = await import(req.resolve('@gltf-transform/extensions'))
const { duplicateRuleProblem, buildDescriptor, addMessageBytes } =
  await import(path.resolve('apps/client/src/edit-duplicate.js'))

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)

function depthOf(node) {
  const kids = node.listChildren()
  return kids.length === 0 ? 0 : 1 + Math.max(...kids.map(depthOf))
}
function walk(node, out = [], level = 0) {
  out.push({ node, level })
  for (const c of node.listChildren()) walk(c, out, level + 1)
  return out
}
// The per-node rule: duplicateRuleProblem with the structural rules set aside.
// It is asked of a node as it stands, so `children` and `parent` fire first; we
// re-ask on a view of the node that hides both.
function perNodeProblem(node) {
  const view = Object.create(node)
  view.listChildren = () => []
  view.listParents = () => node.listParents().filter((p) => p.propertyType !== 'Node')
  return duplicateRuleProblem(view)
}
function subtreeDescriptor(node) {
  const d = buildDescriptor(node, node.getName(), 0)
  const kids = node.listChildren()
  if (kids.length > 0) d.children = kids.map(subtreeDescriptor)
  return d
}

let groups = 0, descendantsTotal = 0, maxDepth = 0, maxBytes = 0, restorable = 0
for (const file of process.argv.slice(2)) {
  let doc
  try { doc = await io.read(file) } catch (e) { console.log(`${file}: unreadable (${e.message.slice(0, 60)})`); continue }
  const root = doc.getRoot()
  const scene = root.getDefaultScene() ?? root.listScenes()[0]
  const roots = scene ? scene.listChildren() : []
  const nameCount = new Map()
  for (const n of root.listNodes()) nameCount.set(n.getName(), (nameCount.get(n.getName()) ?? 0) + 1)
  const animated = new Set()
  for (const a of root.listAnimations()) for (const ch of a.listChannels()) { const t = ch.getTargetNode(); if (t) animated.add(t) }
  const withKids = roots.filter((n) => n.listChildren().length > 0)
  if (withKids.length === 0) { console.log(`${path.basename(file)}: no top-level node has children`); continue }
  console.log(`\n${path.basename(file)} — ${withKids.length} of ${roots.length} top-level nodes have children`)
  for (const g of withKids) {
    groups += 1
    const all = walk(g)
    const desc = all.length - 1
    const depth = depthOf(g)
    descendantsTotal += desc; maxDepth = Math.max(maxDepth, depth)
    const problems = []
    let meshes = 0, hidden = 0, ids = 0, attached = 0, anim = 0, dupNames = 0, empty = 0
    const atriumKeys = new Set()
    for (const { node, level } of all) {
      if (node.getMesh()) meshes += 1
      const ex = node.getExtras() ?? {}
      if (Object.hasOwn(ex, '__atrium_visible')) hidden += 1
      const at = ex.atrium
      if (at && typeof at === 'object') {
        for (const k of Object.keys(at)) atriumKeys.add(k)
        if (Object.hasOwn(at, 'objectId')) ids += 1
      }
      if (node.getCamera() || node.getSkin() || node.getExtension('KHR_lights_punctual')) attached += 1
      if (animated.has(node)) anim += 1
      if ((nameCount.get(node.getName()) ?? 0) > 1) dupNames += 1
      if (node.getName() === '') empty += 1
      const p = perNodeProblem(node)
      if (p) problems.push(`${'  '.repeat(level)}${node.getName() || '(unnamed)'}: ${p.rule} — ${p.reason}`)
    }
    let bytes = null
    if (problems.length === 0) {
      try { bytes = addMessageBytes(subtreeDescriptor(g)); maxBytes = Math.max(maxBytes, bytes); restorable += 1 } catch (e) { bytes = `error: ${e.message}` }
    }
    console.log(`  ${g.getName() || '(unnamed)'}: ${desc} descendants, depth ${depth}, ${meshes}/${all.length} nodes with a mesh` +
      `, atrium keys [${[...atriumKeys].join(', ')}], objectIds ${ids}, hidden ${hidden}, camera/light/skin ${attached}, animated ${anim}` +
      `, duplicate names ${dupNames}, empty names ${empty}` +
      (bytes === null ? '' : `, one-message subtree ${typeof bytes === 'number' ? bytes.toLocaleString('en-US') + ' bytes' : bytes}`))
    for (const line of problems) console.log(`      ${line}`)
  }
}
console.log(`\nTotal: ${groups} groups, ${descendantsTotal} descendants, max depth ${maxDepth}; ${restorable} groups every node of which passes the per-node rule, largest ${maxBytes.toLocaleString('en-US')} bytes`)
