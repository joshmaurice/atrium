// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// g3 — node order and the saved form after a reparent (PREBRIEF-grouping.md §2). Run from the repo root.
import { createRequire } from 'node:module'; import path from 'node:path'
const reqS = createRequire(path.resolve('packages/som/package.json'))
const { Document, NodeIO } = await import(reqS.resolve('@gltf-transform/core'))
const doc = new Document(); const s = doc.createScene('s'); doc.getRoot().setDefaultScene(s)
const g = doc.createNode('G'), a = doc.createNode('A'), c = doc.createNode('C'), z = doc.createNode('Z')
g.addChild(a); s.addChild(g); s.addChild(c); s.addChild(z)
const before = doc.getRoot().listNodes().map(n => n.getName()).join(',')
g.addChild(c)
const after = doc.getRoot().listNodes().map(n => n.getName()).join(',')
const io = new NodeIO(); const json = await io.writeJSON(doc)
console.log('root order before/after:', before, '/', after)
console.log('written nodes:', json.json.nodes.map((n, i) => i + ':' + n.name + (n.children ? '[' + n.children + ']' : '')).join(' '), 'scene', JSON.stringify(json.json.scenes[0].nodes))
const back = await io.readJSON(json)
console.log('read back: G children', back.getRoot().listNodes().find(n => n.getName() === 'G').listChildren().map(n => n.getName()).join(','))
