// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// g1 — facts for PREBRIEF-grouping.md §2: what a parent change does today, on the
// real modules at 172b816. Run from the repo root:
//   node devtasks/spike-grouping/g1-reparent-facts.mjs
import { createRequire } from 'node:module'
import path from 'node:path'
import { SOMDocument } from '../../packages/som/src/index.js'
import { authorizeSend } from '../../packages/server/src/send-policy.js'
import { worldMatrix } from '../../packages/som/src/world-matrix.js'

const reqS = createRequire(path.resolve('packages/som/package.json'))
const { Document } = await import(reqS.resolve('@gltf-transform/core'))
const reqR = createRequire(path.resolve('packages/renderer-three/package.json'))
const { DocumentView } = await import(reqR.resolve('@gltf-transform/view'))

function world() {
  const doc = new Document(); const s = doc.createScene('s'); doc.getRoot().setDefaultScene(s)
  const b = doc.createBuffer()
  const pos = doc.createAccessor().setType('VEC3').setArray(new Float32Array([0,0,0,1,0,0,0,1,0])).setBuffer(b)
  const mesh = () => doc.createMesh().addPrimitive(doc.createPrimitive().setAttribute('POSITION', pos))
  const g = doc.createNode('G').setTranslation([10, 0, 0]).setRotation([0, Math.SQRT1_2, 0, Math.SQRT1_2]).setScale([2, 2, 2])
  const a = doc.createNode('A').setMesh(mesh()).setTranslation([1, 0, 0])
  const c = doc.createNode('C').setMesh(mesh()).setTranslation([0, 0, 5])
  g.addChild(a); s.addChild(g); s.addChild(c)
  return { doc, s, g, a, c }
}

const out = (k, v) => console.log(k.padEnd(44), v)

// 1. The server's allowlist today
{
  const { doc } = world(); const som = new SOMDocument(doc)
  const C = som.getNodeByName('C')
  for (const value of ['G', null, { parent: 'G' }]) {
    const d = authorizeSend({ target: C, nodeName: 'C', field: 'parent', value })
    out(`authorizeSend parent=${JSON.stringify(value)}`, `${d.ok} ${d.code} ${d.message}`)
  }
}

// 2. glTF-Transform addChild: detaches from the old node parent and the scene
{
  const { doc, s, g, c } = world()
  g.addChild(c)
  out('scene children after G.addChild(C)', s.listChildren().map(n => n.getName()).join(','))
  out('C parent', c.getParentNode()?.getName())
  s.addChild(c)
  out('back to scene: C parent / scene kids', `${c.getParentNode()?.getName() ?? null} / ${s.listChildren().map(n => n.getName()).join(',')}`)
  // cycle: no guard in the library
  const { g: g2, a: a2 } = world()
  let msg = 'no throw'
  try { a2.addChild(g2) } catch (e) { msg = 'throws: ' + e.message }
  out('A.addChild(G) (G is A\'s parent)', `${msg}; G parent=${g2.getParentNode()?.getName()} A parent=${a2.getParentNode()?.getName()}`)
}

// 3. An older client receiving `set` field 'parent' (AtriumClient._onSet's non-name branch)
{
  const { doc } = world(); const som = new SOMDocument(doc)
  const C = som.getNodeByName('C')
  for (const v of ['G', null]) {
    let r = 'no throw'
    try { som.setPath(C, 'parent', v) } catch (e) { r = 'throws: ' + e.constructor.name + ': ' + e.message }
    out(`som.setPath(C, 'parent', ${JSON.stringify(v)})`, `${r}; parent now ${C.parent?.name ?? null}`)
  }
}

// 4. A plain reparent keeps LOCAL, so the world placement jumps
{
  const { doc } = world(); const som = new SOMDocument(doc)
  const C = som.getNodeByName('C'), G = som.getNodeByName('G')
  const before = worldMatrix(C).slice(12, 15)
  G.addChild(C)
  const after = worldMatrix(C).slice(12, 15)
  out('C world translation before / after G.addChild', `${before.map(n => +n.toFixed(3))} / ${after.map(n => +n.toFixed(3))}`)
}

// 5. DocumentView follows a reparent (headless, stub image provider)
{
  const { doc, s, g, c } = world()
  const view = new DocumentView(doc, { imageProvider: { initTexture() {}, getTexture: async () => null, clear() {}, dispose() {}, setKTX2Loader() { return this } } })
  const root = view.view(s)
  const objC = root.children.find(o => o.name === 'C')
  g.addChild(c)
  const objG = root.children.find(o => o.name === 'G')
  out('view: C under G after reparent', `${objG.children.some(o => o.name === 'C')} (scene has C: ${root.children.some(o => o.name === 'C')}; same Object3D: ${objG.children.find(o => o.name === 'C') === objC})`)
  s.addChild(c)
  out('view: C back at scene', `${root.children.some(o => o.name === 'C')} (G has C: ${objG.children.some(o => o.name === 'C')}; same Object3D: ${root.children.find(o => o.name === 'C') === objC})`)
  // an empty node (a new group) and a move into it
  const e = doc.createNode('E'); s.addChild(e); e.addChild(c)
  const objE = root.children.find(o => o.name === 'E')
  out('view: C under a new empty E', `${objE?.children.some(o => o.name === 'C')}`)
}
