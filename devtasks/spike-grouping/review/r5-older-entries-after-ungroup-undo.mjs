// r5 — older entries that point at a GROUP, after that group is ungrouped and
// the Ungroup is undone (GR7: "Undo re-adds the group, then after acceptance
// moves each part back"). The real Undo engine (edit-undo.js at 172b816d) on
// space.gltf. The re-added group is a NEW SOM node. Today the only code that
// points a handle at a re-added node is completeAccepted's re-add branch
// (L795-816), for the entry's own `handle`; GR7 doesn't say the composite
// entries do it for the group. This shows what an older entry does without it.
//   node r5-older-entries-after-ungroup-undo.mjs /path/to/atrium
import path from 'node:path'
const repo = path.resolve(process.argv[2])
const { createEditUndo } = await import(`${repo}/apps/client/src/edit-undo.js`)
const { prepareRestore } = await import(`${repo}/apps/client/src/edit-duplicate.js`)
const { NodeIO } = await import(`${repo}/packages/som/node_modules/@gltf-transform/core/dist/index.modern.js`)
const { SOMDocument } = await import(`${repo}/packages/som/src/SOMDocument.js`)
const out = (k, v) => console.log(k.padEnd(76), v)

const som = new SOMDocument(await new NodeIO().read(`${repo}/tests/fixtures/space.gltf`))
let seq = 0; const sent = [], messages = []
const undo = createEditUndo({
  getNodeByName: (n) => som.getNodeByName(n), getObjectByName: (n) => som.getObjectByName(n),
  checkNewName: (n, node) => som.checkNewName(n, node), prepareRestore, trees: () => true,
  sendTransform: () => null, rename: () => null,
  structural: (req) => { sent.push(req); return ++seq },
  message: (t) => messages.push(t),
})
const lamp = som.getNodeByName('lamp-01'), shade = som.getNodeByName('lamp-shade'), stand = som.getNodeByName('lamp-stand')

// 1. The owner deletes a part of lamp-01 (an ordinary, recorded Delete).
const cap = undo.capture(shade)
const s = ++seq
undo.registerDelete(s, { node: shade, name: 'lamp-shade', descriptor: cap.descriptor })
shade.dispose()
undo.onStructureAnswer({ request: { seq: s, name: 'lamp-shade' }, status: 'accepted', removedMessage: null })
out('1. Delete “lamp-shade” (a part of lamp-01): undo stack', JSON.stringify(undo.undoLabels))

// 2. Ungroup lamp-01, then Undo of the Ungroup, applied to the SOM as GR7 says:
//    the part to the top level, the group removed; then the group re-added (a
//    new node) and the part moved back with its exact old values.
const groupDescriptor = { name: 'lamp-01', translation: [...lamp.translation] }
const old = { translation: [...stand.translation], rotation: [...stand.rotation], scale: [...stand.scale] }
som.scene._scene.addChild(stand._node); lamp.dispose()
const lamp2 = som.ingestNode(groupDescriptor); som.scene.addChild(lamp2)
stand._node.setTranslation(old.translation).setRotation(old.rotation).setScale(old.scale); lamp2._node.addChild(stand._node)
out('2. Ungroup + its Undo: lamp-01 is back, holding', lamp2.children.map((c) => c.name).join(', '))
out('   the node of the name “lamp-01” is the one the Delete entry remembers', String(som.getNodeByName('lamp-01') === lamp))

// 3. The next Undo is the older Delete of the part.
const ran = undo.run('undo')
out('3. Undo of the Delete: ran / sent', `${ran} / ${JSON.stringify(sent.at(-1) ?? null)}`)
out('   the panel\'s message', JSON.stringify(messages.at(-1)))
out('   undo stack afterwards (the entry is dropped)', JSON.stringify(undo.undoLabels))
