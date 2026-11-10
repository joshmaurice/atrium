// r2 — what an UNRELOADED tab (the released AtriumClient at 172b816d, which is
// this commit's client) holds after another tab's Ungroup, and after a Move to
// that empties a group (GR-L8 (a)). The messages are the ones GR3/GR6 broadcast:
// a `set` with field "parent", then the group's `remove`.
//   node r2-stale-tab-loses-parts.mjs /path/to/atrium
import path from 'node:path'
import { createRequire } from 'node:module'
const repo = path.resolve(process.argv[2])
const { AtriumClient } = await import(`${repo}/packages/client/src/AtriumClient.js`)
const { SOMDocument } = await import(`${repo}/packages/som/src/index.js`)
const req = createRequire(`${repo}/packages/som/package.json`)
const { Document } = await import(req.resolve('@gltf-transform/core'))
const out = (k, v) => console.log(k.padEnd(70), v)

function tab() {
  const doc = new Document(); const s = doc.createScene('s'); doc.getRoot().setDefaultScene(s)
  const g = doc.createNode('group-01').setTranslation([2, 0, 0]); s.addChild(g)
  g.addChild(doc.createNode('cube-a')); g.addChild(doc.createNode('cube-b').setTranslation([1, 0, 0]))
  const client = new AtriumClient({ debug: false })
  client._som = new SOMDocument(doc)
  client._sessionId = 'this-tab'
  const record = { stale: false, closing: false, pendingEdits: new Map(), peerSessions: new Map() }
  const events = []
  for (const e of ['som:set', 'som:remove', 'som:desync']) client.on(e, (d) => events.push(`${e} ${d.nodeName ?? d.node ?? ''}${d.path ? '.' + d.path : ''}`))
  const feed = (msg) => { try { client._onSet(msg, record); return 'applied' } catch (err) { return `threw ${err.constructor.name}: ${err.message.slice(0, 48)}…` } }
  return { client, record, events, feed }
}
const names = (c) => c._som.nodes.map((n) => `${n.name}${n.parent ? ` (in ${n.parent.name})` : ''}`).join(', ')
const set = (node, parent, translation) => ({ type: 'set', node, field: 'parent', value: { parent, translation, rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, session: 'other-tab', requestSeq: 1 })

{ // Ungroup in another tab: each part to the top level, then the group removed
  const { client, record, events, feed } = tab()
  out('before', names(client))
  out('set cube-a.parent = null', feed(set('cube-a', null, [2, 0, 0])))
  out('set cube-b.parent = null', feed(set('cube-b', null, [3, 0, 0])))
  client._onRemove({ type: 'remove', node: 'group-01' }, record)
  out('after the Ungroup (the server holds cube-a, cube-b)', names(client) || '(no nodes)')
  out('events the page saw', events.join(' | '))
}
{ // Move to: the last part out of a group, which GR-L8 (a) then deletes
  const { client, record, feed } = tab()
  client._som.getNodeByName('cube-b').dispose()             // the group holds one part
  out('\nbefore', names(client))
  out('set cube-a.parent = null', feed(set('cube-a', null, [2, 0, 0])))
  client._onRemove({ type: 'remove', node: 'group-01' }, record)
  out('after Move to + GR-L8 (a) (the server holds cube-a)', names(client) || '(no nodes)')
}
