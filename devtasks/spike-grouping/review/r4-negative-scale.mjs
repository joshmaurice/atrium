// r4 — a local scale with a negative component, which GR8's moveValue produces
// for a move into or out of a mirrored group (f1: "local scale -1,0.5,2"), met
// by the Edit panel's own transform path (edit-gesture.js sanitizeTransform,
// L93-107: "scale stays positive", MIN_SCALE 0.01).
//   node r4-negative-scale.mjs /path/to/atrium
import path from 'node:path'
const repo = path.resolve(process.argv[2])
const { createEditTracker, sanitizeTransform, MIN_SCALE } = await import(`${repo}/apps/client/src/edit-gesture.js`)
const out = (k, v) => console.log(k.padEnd(74), v)
const moved = { translation: [6, 0.25, 4], rotation: [0, 0, 0.3826834323650898, 0.9238795325112867], scale: [-1, 0.5, 2] }  // GR7's `to` for the move
const node = { name: 'crate', ...structuredClone(moved) }
let seq = 0; const wire = []
const tracker = createEditTracker({
  read: (n, f) => n[f], writeLocal: (n, f, v) => { n[f] = v },
  writeSend: (n, f, v) => { n[f] = v; wire.push(v); return ++seq },
})
out('edit-gesture MIN_SCALE', MIN_SCALE)
out('sanitizeTransform(scale, [-1, 0.5, 2])', JSON.stringify(sanitizeTransform('scale', moved.scale)))
// the owner types 0.6 in the panel's scale-y field: the panel commits the whole vector
const s = tracker.commit(node, 'scale', [-1, 0.6, 2])
out('panel commit of scale [-1, 0.6, 2]: sent', JSON.stringify(wire[0]))
tracker.accepted(s)
// Undo of that Scale entry sends its `from` through the same commit (record: false)
const u = tracker.commit(node, 'scale', moved.scale, { record: false }); tracker.accepted(u)
out('Undo of the Scale entry sends `from` [-1, 0.5, 2]: sent / node holds', `${JSON.stringify(wire[1])} / ${JSON.stringify(node.scale)}`)
const exact = ['translation', 'rotation', 'scale'].every((f) => node[f].length === moved[f].length && node[f].every((x, i) => x === moved[f][i]))
out('GR7: the older Move to entry\'s check "its vectors equal to\'s exactly"', exact ? 'passes' : 'FAILS → “changed elsewhere”, the entry is dropped')
// a move into a group scaled 150 gives a local scale under the panel's minimum too
out('sanitizeTransform(scale, [1/150, 1/150, 1/150])', JSON.stringify(sanitizeTransform('scale', [1 / 150, 1 / 150, 1 / 150])))
