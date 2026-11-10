// r1 — outside review of PREBRIEF-grouping.md Rev 1.0 (34917de8): GR4's rule
// ("over its bound after AND larger than before") against GR-L5 (a)'s promise
// that a move out of an oversized seed group "is never refused, and neither is
// its Undo", and against §1's different wording ("past a count it is not
// already past"). Real SOMDocument, real SUBTREE_* bounds; reparentNode and
// treeCounts are prototypes of GR1 and GR4 as written.
//   node r1-gr4-undo.mjs /path/to/atrium
import path from 'node:path'
import { createRequire } from 'node:module'
const repo = path.resolve(process.argv[2])
const { SOMDocument } = await import(`${repo}/packages/som/src/index.js`)
const { SUBTREE_DEPTH_MAX, SUBTREE_NODES_MAX, SUBTREE_PRIMITIVES_MAX } = await import(`${repo}/packages/server/src/send-policy.js`)
const req = createRequire(`${repo}/packages/som/package.json`)
const { Document } = await import(req.resolve('@gltf-transform/core'))
const out = (k, v) => console.log(k.padEnd(78), v)
const I = { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }

function reparentNode(som, node, parent, v) {             // GR1
  for (let a = parent; a; a = a.parent) if (a === node) return { ok: false, message: 'a node can’t go inside itself' }
  if ((node.parent ?? null) === (parent ?? null)) return { ok: false, message: 'already there' }
  node._node.setTranslation(v.translation).setRotation(v.rotation).setScale(v.scale)
  ;(parent ?? som.scene)._node?.addChild?.(node._node) ?? (parent ? parent._node : som.scene._scene).addChild(node._node)
  return { ok: true }
}
function treeCounts(root) {                                // GR4
  let nodes = 0, depth = 0, prims = 0
  const st = [[root, 0]]
  while (st.length) { const [n, g] = st.pop(); nodes++; depth = Math.max(depth, g); prims += n._node.getMesh()?.listPrimitives().length ?? 0; for (const c of n.children) st.push([c, g + 1]) }
  return { nodes, depth, prims }
}
const top = (n) => { while (n.parent) n = n.parent; return n }
const BOUND = { nodes: SUBTREE_NODES_MAX, depth: SUBTREE_DEPTH_MAX, prims: SUBTREE_PRIMITIVES_MAX }
// rule 'gr4': over after AND larger than before.  rule 's1': past a count it was not already past.
function refuses(rule, before, after) {
  for (const k of ['nodes', 'depth', 'prims']) {
    if (rule === 'gr4' && after[k] > BOUND[k] && after[k] > before[k]) return k
    if (rule === 's1' && after[k] > BOUND[k] && !(before[k] > BOUND[k])) return k
  }
  return null
}
// the server's move, with GR4: counts of the destination's top-level tree before and after
function serverMove(som, rule, node, parent, v = I) {
  if (parent) {
    const t = top(parent)
    const before = treeCounts(t)
    const old = node.parent, oldV = { translation: [...node.translation], rotation: [...node.rotation], scale: [...node.scale] }
    const r = reparentNode(som, node, parent, v); if (!r.ok) return r
    const why = refuses(rule, before, treeCounts(t))
    if (why) { reparentNode(som, node, old, oldV); return { ok: false, message: `the group would be too large to copy (${why})` } }
    return { ok: true }
  }
  return reparentNode(som, node, null, v)                  // to the top level: skipped
}
function serverAdd(som, rule, name, parent) {              // GR4 on a parented add
  const n = som.ingestNode({ name })
  if (!parent) { som.scene.addChild(n); return { ok: true } }
  const t = top(parent), before = treeCounts(t)
  parent.addChild(n)
  const why = refuses(rule, before, treeCounts(t))
  if (why) { n.dispose(); return { ok: false, message: `the group would be too large to copy (${why})` } }
  return { ok: true }
}
function world(parts) {                                    // a top-level seed group "G" with `parts` children
  const doc = new Document(); const s = doc.createScene('s'); doc.getRoot().setDefaultScene(s)
  const g = doc.createNode('G'); s.addChild(g)
  for (let i = 0; i < parts; i++) g.addChild(doc.createNode(`p${i}`))
  return new SOMDocument(doc)
}
out('bounds (nodes, generations, primitives)', JSON.stringify(BOUND))

for (const rule of ['gr4', 's1']) {
  console.log(`\n── rule "${rule}" ${rule === 'gr4' ? '(GR-L5 (a) and GR4: over after AND larger than before)' : '(§1: past a count it is not already past)'}`)
  { // a. Move to the top level out of an oversized seed group, then its Undo
    const som = world(299); const G = som.getNodeByName('G'), p = som.getNodeByName('p0')
    out('a. 300-node seed group: move p0 to the top level', JSON.stringify(serverMove(som, rule, p, null)))
    out('   its Undo (p0 back into G, exact old values)', JSON.stringify(serverMove(som, rule, p, G)))
  }
  { // a2. the group is just over the bound; the move out brings it to the bound
    const som = world(256); const G = som.getNodeByName('G'), p = som.getNodeByName('p0')
    out('a2. 257-node seed group: move p0 to the top level', JSON.stringify(serverMove(som, rule, p, null)))
    out('   its Undo', JSON.stringify(serverMove(som, rule, p, G)))
  }
  { // b. Ungroup an oversized seed group, then Undo (re-add G, move each part back)
    const som = world(299); const G = som.getNodeByName('G'); const parts = [...G.children]
    const outOk = parts.filter((p) => serverMove(som, rule, p, null).ok).length
    G.dispose()
    serverAdd(som, rule, 'G', null); const G2 = som.getNodeByName('G')
    const back = parts.map((p) => serverMove(som, rule, p, G2))
    out(`b. Ungroup a 300-node seed group: moves out accepted`, `${outOk} of ${parts.length}`)
    out('   its Undo: moves back accepted / refused', `${back.filter((r) => r.ok).length} / ${back.filter((r) => !r.ok).length}  → G holds ${G2.children.length} parts, ${som.scene.children.length - 1} left at the top level`)
  }
  { // c. Delete a part of an oversized seed group, then Undo (a parented add)
    const som = world(299); const G = som.getNodeByName('G')
    som.getNodeByName('p0').dispose()
    out('c. 300-node seed group: Delete p0, then Undo (re-add under G)', JSON.stringify(serverAdd(som, rule, 'p0', G)))
  }
  { // d. depth: a part moved out of a 9-generation seed tree, then Undo
    const doc = new Document(); const s = doc.createScene('s'); doc.getRoot().setDefaultScene(s)
    let cur = doc.createNode('d0'); s.addChild(cur)
    for (let i = 1; i <= 9; i++) { const n = doc.createNode(`d${i}`); cur.addChild(n); cur = n }
    const som = new SOMDocument(doc); const leaf = som.getNodeByName('d9'), d8 = som.getNodeByName('d8')
    out('d. 9-generation seed tree: move the deepest part to the top level', JSON.stringify(serverMove(som, rule, leaf, null)))
    out('   its Undo', JSON.stringify(serverMove(som, rule, leaf, d8)))
  }
}
