// r8 — outside review of PREBRIEF-grouping.md Rev 1.2 (95d7a096), GR8's
// "exact when the frames allow it" (review N2): for a group made by Group,
// are the linear parts of the two parents' world matrices exactly equal, and
// does "only the translation is computed" give back the translation that
// other tabs' entries expect? Real worldMatrix (packages/som) and f1's
// inverseAffine, on a parent turned, scaled, translated and nested two deep.
//   node r8-exact-when-frames-allow.mjs /path/to/atrium
import path from 'node:path'
import { createRequire } from 'node:module'
const repo = path.resolve(process.argv[2])
const { SOMDocument } = await import(`${repo}/packages/som/src/index.js`)
const { worldMatrix } = await import(`${repo}/packages/som/src/world-matrix.js`)
const req = createRequire(`${repo}/packages/som/package.json`)
const { Document } = await import(req.resolve('@gltf-transform/core'))
const out = (k, v) => console.log(k.padEnd(76), v)

function inverseAffine(m) {            // column-major 4×4, affine (f1's)
  const a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10]
  const det = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e)
  const r = [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det, 0,
             (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det, 0,
             (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det, 0, 0, 0, 0, 1]
  const tx = m[12], ty = m[13], tz = m[14]
  r[12] = -(r[0] * tx + r[4] * ty + r[8] * tz); r[13] = -(r[1] * tx + r[5] * ty + r[9] * tz); r[14] = -(r[2] * tx + r[6] * ty + r[10] * tz)
  return r
}
const apply = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]]
const linear = (m) => [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])
const q = (ax, deg) => { const s = Math.sin(deg * Math.PI / 360), c = Math.cos(deg * Math.PI / 360); return [ax[0] * s, ax[1] * s, ax[2] * s, c] }

function scene(nested) {
  const doc = new Document(); const s = doc.createScene('s'); doc.getRoot().setDefaultScene(s)
  let parent = null
  if (nested) {
    const outer = doc.createNode('outer').setTranslation([4.5, 0, -2.25]).setRotation(q([0, 1, 0], 37)).setScale([1.5, 1.5, 1.5]); s.addChild(outer)
    parent = doc.createNode('P').setTranslation([0.3, 1.7, -0.9]).setRotation(q([0.6, 0, 0.8], 71)).setScale([2, 2, 2]); outer.addChild(parent)
  }
  const cube = doc.createNode('cube').setTranslation([1.37, 0.25, -2.61]).setRotation(q([0, 1, 0], 33)).setScale([1, 0.5, 2])
  ;(parent ?? s).addChild(cube)
  return { doc, som: new SOMDocument(doc) }
}

for (const nested of [false, true]) {
  console.log(nested ? '\n── the cube is a part of P (turned 71°, scaled 2) inside “outer” (turned 37°, scaled 1.5)' : '── the cube is at the top level')
  const { doc, som } = scene(nested)
  const cube = som.getNodeByName('cube'), P = nested ? som.getNodeByName('P') : null
  const t0 = [...cube.translation]
  // Group, as GR-L6 (a): the group at the cube's local translation, no rotation, scale 1; the cube at 0.
  const G = som.ingestNode({ name: 'group-01', translation: t0 }); (P ?? som.scene).addChild(G)
  cube._node.setTranslation([0, 0, 0]); G._node.addChild(cube._node)
  if (cube.parent !== G || (G.parent ?? null) !== P) throw new Error('the probe\'s own Group did not apply')
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  const wG = worldMatrix(G), wP = P ? worldMatrix(P) : I
  out('linear parts of world(group-01) and world(its parent) exactly equal', String(same(linear(wG), linear(wP))))
  // Ungroup, by GR8's rule: rotation and scale kept bitwise, "only the translation is computed":
  const computed = apply(inverseAffine(wP), worldMatrix(cube).slice(12, 15))
  out('the translation before the Group (what another tab\'s entry holds)', JSON.stringify(t0))
  out('the translation computed for the Ungroup: inverse(world(parent)) × world', JSON.stringify(computed))
  out('  bitwise equal', String(same(computed, t0)))
  const added = [G.translation[0] + cube.translation[0], G.translation[1] + cube.translation[1], G.translation[2] + cube.translation[2]]
  out('the group\'s translation + the part\'s (no matrix)', `${JSON.stringify(added)}  bitwise equal: ${same(added, t0)}`)
}
