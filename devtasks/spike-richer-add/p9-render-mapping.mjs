// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// p9 — the richer material fields and COLOR_0 through @gltf-transform/view's DocumentView, headless
// (a stub image provider; no WebGL, no DOM). PREBRIEF-richer-add.md §2.6. Run from the repo root:
// node devtasks/spike-richer-add/p9-render-mapping.mjs
import { createRequire } from 'node:module'
import path from 'node:path'
const req = createRequire(path.resolve('packages/renderer-three/package.json'))
const reqS = createRequire(path.resolve('packages/som/package.json')); const { Document } = await import(reqS.resolve('@gltf-transform/core'))
const { DocumentView } = await import(req.resolve('@gltf-transform/view'))
const doc = new Document(); const b = doc.createBuffer(); const s = doc.createScene()
const tri = new Float32Array([0,0,0,1,0,0,0,1,0])
const pos = doc.createAccessor().setType('VEC3').setArray(tri).setBuffer(b)
const col = doc.createAccessor().setType('VEC4').setArray(new Float32Array([1,0,0,1, 0,1,0,1, 0,0,1,1])).setBuffer(b)
const mat = doc.createMaterial('m').setEmissiveFactor([1,0.5,0]).setAlphaMode('BLEND').setDoubleSided(true)
const prim = doc.createPrimitive().setAttribute('POSITION', pos).setAttribute('COLOR_0', col).setMaterial(mat)
s.addChild(doc.createNode('n').setMesh(doc.createMesh().addPrimitive(prim)))
const view = new DocumentView(doc, { imageProvider: { initTexture() {}, getTexture: async () => null, clear() {}, dispose() {}, setKTX2Loader() { return this } } })
const group = view.view(s)
group.traverse((o) => { if (o.isMesh) console.log(o.material.type, 'vertexColors', o.material.vertexColors, 'transparent', o.material.transparent, 'side', o.material.side, 'emissive', o.material.emissive.toArray(), 'color attr itemSize', o.geometry.getAttribute('color')?.itemSize) })
