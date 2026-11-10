// r3 — a transform send already in flight when another tab's move of the same
// node is applied first. The real gesture tracker (edit-gesture.js at 172b816d)
// and a real SOMDocument (space.gltf); the remote move is applied as GR6 says
// (reparent with the mover's exact local values, then the transform som:sets
// that app.js L1060-1063 hands to remoteSet). f3 covered a drag that CONTINUES
// after the reparent; this is a send made BEFORE it (one panel-field commit).
//   node r3-inflight-transform.mjs /path/to/atrium
import path from 'node:path'
const repo = path.resolve(process.argv[2])
const { createEditTracker, TRANSFORM_FIELDS } = await import(`${repo}/apps/client/src/edit-gesture.js`)
const { worldMatrix } = await import(`${repo}/packages/som/src/world-matrix.js`)
const { NodeIO } = await import(`${repo}/packages/som/node_modules/@gltf-transform/core/dist/index.modern.js`)
const { SOMDocument } = await import(`${repo}/packages/som/src/SOMDocument.js`)
const out = (k, v) => console.log(k.padEnd(74), v)
const wpos = (n) => worldMatrix(n).slice(12, 15).map((x) => +x.toFixed(4))

const som = new SOMDocument(await new NodeIO().read(`${repo}/tests/fixtures/space.gltf`))
const crate = som.getNodeByName('crate-01'), lamp = som.getNodeByName('lamp-01')
let seq = 0; const wire = []
const tracker = createEditTracker({
  read: (n, f) => n[f],
  writeLocal: (n, f, v) => { n[f] = v },
  writeSend: (n, f, v) => { n[f] = v; wire.push({ seq: ++seq, field: f, value: v }); return seq },
})
out('crate-01 world / lamp-01 world', `${JSON.stringify(wpos(crate))} / ${JSON.stringify(wpos(lamp))}`)

// Tab A: the owner types a new x in the panel (0.5 m along x). Sent, unanswered.
const s = tracker.commit(crate, 'translation', [crate.translation[0] + 0.5, crate.translation[1], crate.translation[2]])
out('tab A commits translation (in flight)', `${JSON.stringify(wire[0].value)} seq ${s}`)

// Tab B's Move to (crate-01 into lamp-01) reached the server FIRST. Its value was
// computed from the world placement B saw (before A's commit): local = world − lamp.
const L = { translation: [1 - 3, 0.25, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }
crate._node.setTranslation(L.translation).setRotation(L.rotation).setScale(L.scale); lamp._node.addChild(crate._node)   // GR1 in tab A
for (const f of TRANSFORM_FIELDS) tracker.remoteSet(crate, f, [...crate[f]])                                              // GR6's som:sets
out('tab A after B\'s move arrives: parent / local / world', `${crate.parent.name} / ${JSON.stringify(crate.translation)} / ${JSON.stringify(wpos(crate))}`)

// The server then applies A's send (a legal vec3) to the node where it now is,
// and answers. The tracker takes the accepted value as the server's (L500).
tracker.accepted(s)
out('tab A after its own send is accepted: local / world', `${JSON.stringify(crate.translation)} / ${JSON.stringify(wpos(crate))}`)
out('the server and every other tab hold the same', 'crate-01 in lamp-01 at ' + JSON.stringify(wire[0].value))
out('where the owner meant it (0.5 m along x from [1, 0.25, 0])', '[1.5, 0.25, 0]')
