// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// p3 — what the server does today with malformed geometry in an owner's `add`.
// The session's add handler checks no geometry (session.js L1226–1420), so this
// drives the same steps it runs after its checks: the protocol validator, then
// world.addNode, then a save (serialize) and a reload (createWorldFromDocument),
// as autosave and the next boot would.
// Run from the repo root: node devtasks/spike-richer-add/p3-malformed.mjs
import path from 'node:path'
const { validate } = await import(path.resolve('packages/protocol/src/index.js'))
const { createWorld, createWorldFromDocument } = await import(path.resolve('packages/server/src/world.js'))

const tri = [0, 0, 0, 1, 0, 0, 0, 1, 0]
const mat = { pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1], metallicFactor: 0, roughnessFactor: 1 } }
const cases = {
  'ok (control)':              { attributes: { POSITION: tri }, indices: [0, 1, 2], material: mat },
  'POSITION length 4':         { attributes: { POSITION: [0, 0, 0, 1] }, indices: [0, 0, 0] },
  'index past the end (99)':   { attributes: { POSITION: tri }, indices: [0, 1, 99] },
  'index 70000 (Uint16 wrap)': { attributes: { POSITION: tri }, indices: [0, 1, 70000] },
  'POSITION strings':          { attributes: { POSITION: ['a', 'b', 'c', 1, 0, 0, 0, 1, 0] }, indices: [0, 1, 2] },
  'NORMAL count ≠ POSITION':   { attributes: { POSITION: tri, NORMAL: [0, 0, 1] }, indices: [0, 1, 2] },
  'baseColorFactor length 2':  { attributes: { POSITION: tri }, material: { pbrMetallicRoughness: { baseColorFactor: [1, 0] } } },
  'metallicFactor "x"':        { attributes: { POSITION: tri }, material: { pbrMetallicRoughness: { metallicFactor: 'x' } } },
  'TEXCOORD_0 (silently dropped?)': { attributes: { POSITION: tri, TEXCOORD_0: [0, 0, 1, 0, 0, 1] }, indices: [0, 1, 2] },
  'material.name + emissive (dropped?)': { attributes: { POSITION: tri }, material: { name: 'Red', emissiveFactor: [1, 0, 0], ...mat } },
}

for (const [label, prim] of Object.entries(cases)) {
  const msg = { type: 'add', seq: 1, node: { name: 'probe', mesh: { primitives: [prim] } } }
  const v = validate('client', msg)
  const valid = v === true || v?.valid === true || v?.ok === true
  const world = await createWorld(path.resolve('tests/fixtures/space.gltf'))
  let stage = 'addNode'
  try {
    const r = world.addNode(structuredClone(msg.node), null)
    if (!r.ok) { console.log(`${label}: schema ${valid ? 'pass' : 'FAIL'}; addNode refused ${r.code}`); continue }
    stage = 'serialize'
    const json = await world.serialize()
    const p = json.meshes.at(-1).primitives[0]
    const acc = (i) => json.accessors[i]
    const kept = `attrs ${Object.keys(p.attributes).join('+')}${p.material !== undefined ? `, material ${JSON.stringify(json.materials[p.material]).slice(0, 90)}` : ''}`
    stage = 'reload'
    const again = await createWorldFromDocument(json)
    const n = again.som.getNodeByName('probe')
    console.log(`${label}: schema ${valid ? 'pass' : 'FAIL'}; accepted; saved (${kept}; POSITION count ${acc(p.attributes.POSITION).count}${p.indices !== undefined ? `, index max ${acc(p.indices).max}` : ''}); reload ${n ? 'ok' : 'node missing'}`)
  } catch (e) {
    console.log(`${label}: schema ${valid ? 'pass' : 'FAIL'}; THROWS at ${stage}: ${e.message.slice(0, 110)}`)
  }
}
