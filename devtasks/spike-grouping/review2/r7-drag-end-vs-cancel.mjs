// r7 — outside review of PREBRIEF-grouping.md Rev 1.2 (95d7a096), GR8: "On
// som:reparent a handle drag or open gesture on that node ends (endHandleDrag,
// the tracker's cancel)". endHandleDrag() ends the drag through the gesture's
// end() (app.js L2267–2277, L2322–2325: "its final send (the move is kept)").
// The real tracker (edit-gesture.js at 172b816d) and a real SOMDocument
// (space.gltf): what each of the two ways sends after the reparent.
//   node r7-drag-end-vs-cancel.mjs /path/to/atrium
import path from 'node:path'
const repo = path.resolve(process.argv[2])
const { createEditTracker } = await import(`${repo}/apps/client/src/edit-gesture.js`)
const { worldMatrix } = await import(`${repo}/packages/som/src/world-matrix.js`)
const { NodeIO } = await import(`${repo}/packages/som/node_modules/@gltf-transform/core/dist/index.modern.js`)
const { SOMDocument } = await import(`${repo}/packages/som/src/SOMDocument.js`)
const out = (k, v) => console.log(k.padEnd(72), v)
const wpos = (n) => worldMatrix(n).slice(12, 15).map((x) => +x.toFixed(4))

async function run(how) {
  const som = new SOMDocument(await new NodeIO().read(`${repo}/tests/fixtures/space.gltf`))
  const crate = som.getNodeByName('crate-01'), lamp = som.getNodeByName('lamp-01')
  let clock = 0, seq = 0; const wire = []
  const tracker = createEditTracker({
    now: () => clock,
    read: (n, f) => n[f],
    writeLocal: (n, f, v) => { n[f] = v },
    writeSend: (n, f, v) => { n[f] = v; wire.push({ seq: ++seq, at: clock, field: f, value: v }); return seq },
  })
  // A handle drag along x. The tracker sends at most once per 100 ms.
  const g = tracker.begin(crate)
  clock = 100; g.update({ translation: [1.10, 0.25, 0] })          // sent (seq 1)
  tracker.accepted(1)                                               // answered: nothing is in flight
  clock = 140; g.update({ translation: [1.13, 0.25, 0] })          // inside the 100 ms: local only, not sent
  // Another tab's Move to (crate-01 into lamp-01) arrives. GR6 applies it with
  // the mover's exact local values (the world placement it saw: x = 1.10).
  crate._node.setTranslation([1.10 - 3, 0.25, 0]); lamp._node.addChild(crate._node)
  const sentBefore = wire.length
  // GR8: the drag on that node ends.
  if (how === 'end') g.end(); else g.cancel()
  const after = wire.slice(sentBefore)
  out(`gesture.${how}() after the reparent: sent`, after.length ? JSON.stringify(after.map((w) => [w.field, w.value])) : 'nothing')
  if (after.length) { tracker.accepted(after[0].seq) }
  out('  crate-01 then: parent / local / world', `${crate.parent.name} / ${JSON.stringify(crate.translation)} / ${JSON.stringify(wpos(crate))}`)
}
console.log('The crate was dragged from x = 1 to x = 1.13; the other tab moved it into lamp-01 (at x = 3).')
await run('end')      // what endHandleDrag() does
await run('cancel')   // "the tracker's cancel"
