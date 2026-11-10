// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// subtree-add T4, T5, T7 (devtasks/PREBRIEF-subtree-add.md FINAL Rev 2) — the
// app.js wiring, read as text (as the other wiring tests read it): the server
// level gates trees; the Undo engine gets the name-space lookup and the level;
// Duplicate names the parts against the world; a remote add re-captures once
// per message; a removal re-captures too and clears every removed member's
// wanted animation value; the Delete question is still asked, with its count,
// for a group that can't come back.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Document } from '../../../packages/som/node_modules/@gltf-transform/core/dist/index.modern.js'
import { SOMDocument, worldPosition } from '@atrium/som'
import { AtriumClient } from '@atrium/client'
import { isTeleporter, teleporterDestination } from '../src/teleporter-marker.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const code = readFileSync(resolve(__dirname, '../src/app.js'), 'utf-8')
  .split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')

/** The body of the first `client.on('<event>', …)` handler whose head matches `head`. */
function handler(event, head) {
  const start = code.search(new RegExp(`client\\.on\\('${event}', \\(${head}`))
  assert.ok(start >= 0, `a ${event} handler with ${head}`)
  const end = code.indexOf('\n})', start)
  return code.slice(start, end)
}

test('T7: treesAllowed is the server’s level, 3 or more', () => {
  assert.match(code, /function treesAllowed\(\) \{\s*return Number\.isInteger\(client\.serverAddFields\) && client\.serverAddFields >= 3\s*\}/)
})

test('T5: the Undo engine gets the name-space lookup and the level', () => {
  const start = code.indexOf('const undo = createEditUndo({')
  const block = code.slice(start, code.indexOf('\n})', start))
  assert.match(block, /getObjectByName: \(name\) => client\.som\?\.getObjectByName\(name\) \?\? null/)
  assert.match(block, /trees: treesAllowed,/)
})

test('T5: Duplicate names the parts against the world, at the server’s level; the hint checks the same rule', () => {
  // selection-parts T11 — with a part's offset and the part rules
  assert.match(code, /prepareDuplicate\(gltfNode, \{ name, isFree: isNameFree, trees: treesAllowed\(\), offset, \.\.\.partRules\(\) \}\)/)
  assert.match(code, /duplicateRuleProblem\(gltfNode, \{ trees: treesAllowed\(\), \.\.\.partRules\(\) \}\)/)
})

test('T4: a remote add re-captures a pending delete once per message (the root’s event)', () => {
  const body = handler('som:add', '\\{ nodeName, root \\}')
  assert.match(body, /if \(root === undefined \|\| root === nodeName\) undo\.reCapture\(\)/)
  assert.doesNotMatch(body.replace(/if \(root === undefined \|\| root === nodeName\) undo\.reCapture\(\)/, ''), /undo\.reCapture\(\)/, 'and nowhere else in it')
})

test('T5 (M3): a removal re-captures too; T4 (N1): every removed member’s wanted animation value is cleared', () => {
  const body = handler('som:remove', '\\{ nodeName: goneName, removed \\}')
  assert.match(body, /undo\.reCapture\(\)/)
  assert.match(body, /for \(const name of Array\.isArray\(removed\) && removed\.length > 0 \? removed : \(goneName \? \[goneName\] : \[\]\)\) \{\s*modelAnimations\?\.set\(name, null\)/)
})

test('T6 (the fresh-agent code check\u2019s S-2): the Inspect name, both Copy notes and the Paste note summarise a group after its name', () => {
  assert.match(code, /ipName\.textContent = `\$\{node\.name\}\$\{partsText\(parts\)\}`/)
  assert.match(code, /`Copied “\$\{inspected\.name\}”\$\{partsText\(descriptorPartsSummary\(result\.snapshot\.descriptor\)\)\}\. Paste it in a world you can edit\.`/)
  assert.match(code, /epPasteNotes\.textContent = `Copied “\$\{selected\.name\}”\$\{partsText\(descriptorPartsSummary\(result\.snapshot\.descriptor\)\)\}\.`/)
  assert.match(code, /const pastedLine = prepared\.parts\.parts > 0 \? \[`Pasted “\$\{name\}”\$\{partsText\(prepared\.parts\)\}\.`\] : \[\]\s*epPasteNotes\.textContent = \[\.\.\.pastedLine, \.\.\.prepared\.notes\]\.join\('\\n'\)/)
})

test('SA-L4 (a): Delete asks only when it can’t be undone (the capture fails, or, since grouping GR-L5 (a), its re-add would pass a GR4 bound), and then with the count', () => {
  const start = code.indexOf("epDelete.addEventListener('click'")
  const body = code.slice(start, code.indexOf('\n})', start))
  assert.match(body, /const capture = undo\.capture\(node\)\s*const tooLarge = capture\.ok && groupingAllowed\(\) && !!deleteUndoProblem\(node\)\s*if \(!capture\.ok \|\| tooLarge\) \{\s*const n = countDescendants\(node\)/)
})

// ---------------------------------------------------------------------------
// T4, run (proof (p3)'s apps/client half): the pad handler and derivePads,
// lifted from app.js and run on a real AtriumClient receiving a tree
// ---------------------------------------------------------------------------

/** `function <name>() { … }`'s text in app.js, braces matched. */
function functionText(name) {
  const at = code.search(new RegExp(`function ${name}\\s*\\(`))
  assert.ok(at >= 0, `app.js has a function ${name}()`)
  const open = code.indexOf('{', code.indexOf(')', at))
  let depth = 0
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++
    else if (code[i] === '}' && --depth === 0) return code.slice(at, i + 1)
  }
  throw new Error(`unbalanced ${name}`)
}

class MockWebSocket {
  constructor() { this.readyState = 1; this.sent = []; this._handlers = {} }
  on(event, fn) { (this._handlers[event] ??= []).push(fn); return this }
  send(data) { this.sent.push(JSON.parse(data)) }
  close() { this.readyState = 3 }
  simulateMessage(msg) { for (const fn of this._handlers.message ?? []) fn(JSON.stringify(msg)) }
}

test('T4, run: a pad that arrives as a PART of a remote tree is in derivePads\u2019 result after app.js\u2019s som:add handler, at its world position', () => {
  const mocks = []
  const client = new AtriumClient({
    WebSocket: class { constructor() { const m = new MockWebSocket(); mocks.push(m); return m } },
    connectTimeout: 0,
  })
  client.connect('ws://mock', {})
  const doc = new Document()
  doc.createScene('Scene').addChild(doc.createNode('Crate'))
  Object.assign(client, { _sessionId: 'session-aabbccdd', _displayName: 'User-sess', _connected: true, _worldReady: true, _som: new SOMDocument(doc) })
  client._attachMutationListeners()

  const derivePads = new Function('client', 'isTeleporter', 'worldPosition', 'teleporterDestination',
    `${functionText('derivePads')}; return derivePads`)(client, isTeleporter, worldPosition, teleporterDestination)
  const built = []
  const rebuildPads = () => built.push(derivePads())
  const reCaptures = []
  const undo = { reCapture: () => reCaptures.push(1) }
  new Function('client', 'isTeleporter', 'rebuildPads', 'undo', `${handler('som:add', '\\{ nodeName, root \\}')}\n})`)(client, isTeleporter, rebuildPads, undo)

  const TRI = [0, 0, 0, 1, 0, 0, 0, 1, 0]
  const kiosk = {
    name: 'kiosk', translation: [10, 0, 0],
    children: [{ name: 'kiosk-pad', translation: [0, 0, 2], extras: { atrium: { teleporter: { destination: '/worlds/bob/yard' } } },
      mesh: { primitives: [{ attributes: { POSITION: TRI } }] } }],
  }
  mocks[0].simulateMessage({ type: 'add', seq: 7, node: kiosk, session: 'session-other000' })
  assert.ok(client.som.getNodeByName('kiosk-pad'), 'the tree arrived')
  assert.ok(built.length >= 1, 'the handler rebuilt the pads for the part')
  const pad = built.at(-1).find((p) => p.name === 'kiosk-pad')
  assert.ok(pad, `the pad part is a pad: ${JSON.stringify(built.at(-1))}`)
  assert.deepEqual([...pad.position], [10, 0, 2], 'at its world position (under the moved root)')
  assert.equal(pad.destination, '/worlds/bob/yard')
  assert.equal(reCaptures.length, 1, 'and the pending delete re-captured once, for the message')
})

// ---------------------------------------------------------------------------
// The outside code review's S-1: a part that arrives HIDDEN in a live add is
// hidden in the view too. `applyVisibility` runs only at view creation and
// `setNodeVisible` only on a `som:set`, so before this every present tab drew
// (and could click) a pasted, duplicated or restored hidden part until a reload.
// The page's handler, lifted as text, on a real AtriumClient and DocumentView.
// ---------------------------------------------------------------------------

test('S-1, run: a hidden part of a remote tree is hidden in the view after app.js’s som:add handler, with no visibility pass; its visible siblings stay drawn', async () => {
  const { DocumentView } = await import('../../../packages/renderer-three/node_modules/@gltf-transform/view/dist/index.js')
  const { setNodeVisible } = await import('../../../packages/renderer-three/src/visibility.js')
  const HEADLESS = { imageProvider: { initTexture() {}, getTexture: async () => null, clear() {}, dispose() {}, setKTX2Loader() { return this } } }
  const mocks = []
  const client = new AtriumClient({
    WebSocket: class { constructor() { const m = new MockWebSocket(); mocks.push(m); return m } },
    connectTimeout: 0,
  })
  client.connect('ws://mock', {})
  const doc = new Document()
  const scene = doc.createScene('Scene')
  scene.addChild(doc.createNode('Crate'))
  Object.assign(client, { _sessionId: 'session-aabbccdd', _displayName: 'User-sess', _connected: true, _worldReady: true, _som: new SOMDocument(doc) })
  client._attachMutationListeners()
  const docView = new DocumentView(doc, HEADLESS)
  const sceneGroup = docView.view(scene)
  const frames = []
  new Function('client', 'setNodeVisible', 'requestAnimationFrame', 'docView', 'VIEW_FRAME_LIMIT',
    `${handler('som:add', '\\{ nodeName: addedName \\} = \\{\\}')}\n})`)(client, setNodeVisible, (fn) => frames.push(fn), docView, 10)

  const TRI = [0, 0, 0, 1, 0, 0, 0, 1, 0]
  const lamp = {
    name: 'lamp',
    children: [
      { name: 'shade', mesh: { primitives: [{ attributes: { POSITION: TRI } }] } },
      { name: 'stand', extras: { __atrium_visible: false }, mesh: { primitives: [{ attributes: { POSITION: TRI } }] } },
    ],
  }
  mocks[0].simulateMessage({ type: 'add', seq: 7, node: lamp, session: 'session-other000' })
  const view = (name) => { let found = null; sceneGroup.traverse((o) => { if (!found && o.name === name) found = o }); return found }
  assert.equal(client.som.getNodeByName('stand').visible, false, 'the SOM says hidden')
  assert.ok(view('stand'), 'the view built the part')
  assert.equal(view('stand').visible, false, 'and the view hides it')
  assert.equal(view('shade').visible, true)
  assert.equal(view('lamp').visible, true)
  assert.equal(frames.length, 0, 'no retry when the view object is already there')
})

test('S-1: the hidden part’s view object may come a frame late: the handler retries, at most VIEW_FRAME_LIMIT frames, and stops if the node went', () => {
  const body = handler('som:add', '\\{ nodeName: addedName \\} = \\{\\}')
  const node = { name: 'stand', visible: false }
  let som = { getNodeByName: (n) => (n === 'stand' ? node : null) }
  const client = { on: (_e, fn) => { client.fn = fn }, get som() { return som } }
  let built = 0
  const appear = 3
  const calls = []
  const setNodeVisible = (_dv, n, v) => { calls.push(v); return built >= appear ? 1 : 0 }
  const frames = []
  new Function('client', 'setNodeVisible', 'requestAnimationFrame', 'docView', 'VIEW_FRAME_LIMIT', `${body}\n})`)(client, setNodeVisible, (fn) => frames.push(fn), {}, 10)
  client.fn({ nodeName: 'stand' })
  while (frames.length) { built++; frames.shift()() }
  assert.deepEqual(calls, [false, false, false, false], 'the add, then three frames until the object exists')
  calls.length = 0
  built = -100
  client.fn({ nodeName: 'stand' })
  while (frames.length) frames.shift()()
  assert.equal(calls.length, 11, 'the add and ten frames, then it gives up')
  calls.length = 0
  client.fn({ nodeName: 'stand' })
  som = { getNodeByName: () => null }
  while (frames.length) frames.shift()()
  assert.equal(calls.length, 1, 'the node went: no retry touches it')
  calls.length = 0
  som = { getNodeByName: () => ({ name: 'shade', visible: true }) }
  client.fn({ nodeName: 'shade' })
  assert.equal(calls.length, 0, 'a visible node: nothing to do (the view draws it already)')
})
