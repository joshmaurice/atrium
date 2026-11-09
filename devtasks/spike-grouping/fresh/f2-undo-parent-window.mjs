// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// f2 — fresh check of PREBRIEF-grouping.md Rev 0.1 §4 GR7 against the REAL
// Undo engine (apps/client/src/edit-undo.js at 172b816) and a real SOMDocument
// (space.gltf). Another tab's parent change (applied as GR6 would apply it,
// world placement kept) lands while THIS tab's delete, or an Undo's removal, is
// pending; app.js re-captures on that som:set (reCapture). Where does the
// later re-add put the object? Run from the repo root:
//   node devtasks/spike-grouping/fresh/f2-undo-parent-window.mjs
import { fileURLToPath } from 'node:url'
import { createEditUndo } from '../../../apps/client/src/edit-undo.js'
import { prepareRestore, prepareDuplicate } from '../../../apps/client/src/edit-duplicate.js'
import { worldMatrix } from '../../../packages/som/src/world-matrix.js'

const { NodeIO } = await import('../../../packages/som/node_modules/@gltf-transform/core/dist/index.modern.js')
const { SOMDocument } = await import('../../../packages/som/src/SOMDocument.js')
const fixture = (name) => fileURLToPath(new URL(`../../../tests/fixtures/${name}`, import.meta.url))
const out = (k, v) => console.log(k.padEnd(66), v)
const wpos = (n) => worldMatrix(n).slice(12, 15).map((x) => +x.toFixed(4))

async function setup() {
  const som = new SOMDocument(await new NodeIO().read(fixture('space.gltf')))
  let seq = 0
  const info = new Map(), sent = [], messages = []
  const undo = createEditUndo({
    getNodeByName: (n) => som.getNodeByName(n),
    getObjectByName: (n) => som.getObjectByName(n),
    checkNewName: (n, node) => som.checkNewName(n, node),
    prepareRestore,
    trees: () => true,
    sendTransform: () => null,
    rename: () => null,
    structural: (req, dir) => { const s = ++seq; info.set(s, { req, dir }); sent.push({ seq: s, req }); return s },
    message: (t) => messages.push(t),
  })
  // another tab's move, as GR6 applies it: world kept, then the page's som:set → reCapture
  function remoteMove(node, parent) {
    const w = worldMatrix(node), p = worldMatrix(parent)
    // parent here is unrotated, unscaled (lamp-01 at 3,0,0): local = world - parent
    node.translation = [w[12] - p[12], w[13] - p[13], w[14] - p[14]]
    parent.addChild(node)
    undo.reCapture()
  }
  function serverAnswers(s) {
    const { req, dir } = info.get(s)
    if (req.kind === 'delete') som.getNodeByName(req.name).dispose()
    else {
      const node = som.ingestNode(req.descriptor)
      ;(req.parent ? som.getNodeByName(req.parent) : som.scene).addChild(node)
    }
    undo.onStructureAnswer({ request: { seq: s, undo: dir, name: req.name }, status: 'accepted', removedMessage: null })
  }
  return { som, undo, sent, messages, remoteMove, serverAnswers, next: () => ++seq, info }
}

// A. A click Delete pending; another tab moves the crate into lamp-01 meanwhile.
{
  const { som, undo, sent, remoteMove, serverAnswers, next } = await setup()
  const crate = som.getNodeByName('crate-01'), lamp = som.getNodeByName('lamp-01')
  const w0 = wpos(crate)
  const cap = undo.capture(crate)
  const s = next()
  undo.registerDelete(s, { node: crate, name: 'crate-01', descriptor: cap.descriptor })
  remoteMove(crate, lamp)                                   // the other tab's Move to, before our delete reaches the server
  const w1 = wpos(crate)
  crate.dispose()                                           // the server removes it (now under lamp-01)
  undo.onStructureAnswer({ request: { seq: s, name: 'crate-01' }, status: 'accepted', removedMessage: null })
  undo.run('undo')
  const add = sent.at(-1)
  out('A. delete pending + remote move: world before delete', JSON.stringify(w1))
  out('   Undo re-add: parent sent / translation sent', `${JSON.stringify(add.req.parent)} / ${JSON.stringify(add.req.descriptor.translation)}`)
  serverAnswers(add.seq)
  out('   restored crate world position (was ' + JSON.stringify(w1) + ')', JSON.stringify(wpos(som.getNodeByName('crate-01'))))
  void w0
}

// B. R4: Undo of a Duplicate (a removal) pending; another tab moves the copy into lamp-01; then Redo.
{
  const { som, undo, sent, remoteMove, serverAnswers, next, info } = await setup()
  const crate = som.getNodeByName('crate-01'), lamp = som.getNodeByName('lamp-01')
  const r = prepareDuplicate(crate._node, { name: 'crate-02', isFree: (n) => som.checkNewName(n).ok, trees: true })
  const s = next(); info.set(s, { req: { kind: 'add', name: 'crate-02', descriptor: r.descriptor, parent: null }, dir: undefined })
  undo.registerAdd(s, { name: 'crate-02', duplicate: true, expectParent: null })
  const copy = som.ingestNode(r.descriptor); som.scene.addChild(copy)
  undo.onStructureAnswer({ request: { seq: s, name: 'crate-02' }, status: 'accepted', removedMessage: null })
  undo.run('undo')                                          // sends the remove, opens the R4 window
  const rem = sent.at(-1)
  remoteMove(som.getNodeByName('crate-02'), lamp)           // another tab moves the copy meanwhile
  const w1 = wpos(som.getNodeByName('crate-02'))
  serverAnswers(rem.seq)
  undo.run('redo')
  const add = sent.at(-1)
  out('B. undo-of-Duplicate pending + remote move: world before removal', JSON.stringify(w1))
  out('   Redo re-add: parent sent / translation sent', `${JSON.stringify(add.req.parent)} / ${JSON.stringify(add.req.descriptor.translation)}`)
  serverAnswers(add.seq)
  out('   re-added copy world position (was ' + JSON.stringify(w1) + ')', JSON.stringify(wpos(som.getNodeByName('crate-02'))))
}

// C. checkEntry of a remove ignores the parent: an older Add entry passes after
//    another tab moved the node into an identity-placed group (locals unchanged).
{
  const { som, undo, sent, next, info } = await setup()
  const crate = som.getNodeByName('crate-01')
  const r = prepareDuplicate(crate._node, { name: 'crate-02', isFree: (n) => som.checkNewName(n).ok, trees: true })
  const s = next(); info.set(s, { req: { kind: 'add', name: 'crate-02', descriptor: r.descriptor, parent: null }, dir: undefined })
  undo.registerAdd(s, { name: 'crate-02', duplicate: true, expectParent: null })
  const copy = som.ingestNode(r.descriptor); som.scene.addChild(copy)
  undo.onStructureAnswer({ request: { seq: s, name: 'crate-02' }, status: 'accepted', removedMessage: null })
  const g = som.ingestNode({ name: 'group-at-origin' }); som.scene.addChild(g); g.addChild(som.ingestNode({ name: 'other' }))
  g.addChild(copy)                                          // another tab: Move to an identity group, locals unchanged
  const ok = undo.run('undo')
  out('C. older Add entry, node now inside another group: Undo accepted?', `${ok} (sent: ${sent.at(-1)?.req.kind} ${sent.at(-1)?.req.name})`)
}
