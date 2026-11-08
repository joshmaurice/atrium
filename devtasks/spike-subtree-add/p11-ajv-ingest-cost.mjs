// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// Run: node devtasks/spike-subtree-add/p11-ajv-ingest-cost.mjs <repo> <a copy with a recursive ingestNode prototype>
// p11 — the ChatGPT review of Rev 1.8, M1 and M2: Ajv on a recursive add schema
// (wide tree; dense tree), versus today's worst flat message; and the
// prototype recursive ingestNode on the dense tree.
import path from 'node:path'
import { createRequire } from 'node:module'
import fs from 'node:fs'
const repo = process.argv[2]
const req = createRequire(path.join(repo, 'packages/protocol/package.json'))
const Ajv = (await import(req.resolve('ajv'))).default
const ajv = new Ajv({ strict: false, allErrors: false })
const schema = JSON.parse(fs.readFileSync(path.join(repo, 'packages/protocol/src/schemas/add.client.json'), 'utf8'))
const node = schema.properties.node
node.properties.children = { type: 'array', minItems: 1, items: { $ref: '#/definitions/node' } }
schema.definitions = { node }
schema.properties.node = { $ref: '#/definitions/node' }
const v = ajv.compile(schema)
const prim = { attributes: { POSITION: Array(9).fill(0) } }
const wide = { type: 'add', seq: 1, node: { name: 'root', children: Array.from({ length: 60000 }, () => ({ name: 'x' })) } }
const dense = { type: 'add', seq: 1, node: { name: 'root', children: Array.from({ length: 255 }, (_, i) => ({ name: `p${i}`, mesh: { primitives: Array.from({ length: 64 }, () => structuredClone(prim)) } })) } }
// today's worst flat message: one node, one primitive, POSITION as long as 1 MiB allows
const flat = { type: 'add', seq: 1, node: { name: 'f', mesh: { primitives: [{ attributes: { POSITION: Array(3 * 65535).fill(0) } }] } } }
const time = (f, n = 5) => { f(); const t = process.hrtime.bigint(); for (let i = 0; i < n; i++) f(); return Number(process.hrtime.bigint() - t) / 1e6 / n }
for (const [k, m] of [['wide 60,000 nodes', wide], ['dense 16,320 prims', dense], ['today: flat 196,605 numbers', flat]]) {
  const bytes = Buffer.byteLength(JSON.stringify(m))
  const text = JSON.stringify(m)
  console.log(`${k}: ${bytes.toLocaleString()} bytes; JSON.parse ${time(() => JSON.parse(text)).toFixed(1)} ms; Ajv ${time(() => v(m)).toFixed(1)} ms (valid ${v(m)})`)
}
// ingest, with the prototype recursive ingestNode (the first check's scratch copy)
const { SOMDocument } = await import(path.join(process.argv[3], 'packages/som/src/index.js'))
const somReq = createRequire(path.join(process.argv[3], 'packages/som/package.json'))
const { Document } = await import(somReq.resolve('@gltf-transform/core'))
const one = () => { const d = new Document(); d.createScene(); const som = new SOMDocument(d); const t = process.hrtime.bigint(); som.ingestNode(dense.node); return Number(process.hrtime.bigint() - t) / 1e6 }
one(); const runs = [one(), one(), one()]
console.log(`prototype ingestNode of the dense tree: ${runs.map((x) => x.toFixed(0)).join(', ')} ms`)
// a budget's cost: ingest at 1,024 and 4,096 primitives (16 and 64 per member)
for (const total of [1024, 4096]) {
  const per = 64, members = total / per
  const t = { name: 'root', children: Array.from({ length: members }, (_, i) => ({ name: `b${i}`, mesh: { primitives: Array.from({ length: per }, () => structuredClone(prim)) } })) }
  const go = () => { const d = new Document(); d.createScene(); const som = new SOMDocument(d); const s = process.hrtime.bigint(); som.ingestNode(t); return Number(process.hrtime.bigint() - s) / 1e6 }
  go(); console.log(`ingest ${total} primitives: ${[go(), go(), go()].map((x) => x.toFixed(0)).join(', ')} ms`)
}
