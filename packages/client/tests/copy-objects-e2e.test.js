// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// copy-objects — end to end (devtasks/PREBRIEF-copy-objects.md §5: "two
// worlds, end to end" and "the hostile case, two tabs", with its Redo
// version). Real AtriumClients against two real `attachSessionHandlers`
// servers on port 0 (two origins: 127.0.0.1 on two ports), the real
// `copy-paste.js`, the real Undo engine wired as app.js wires it, and the
// real behaviour runner in the host tab.
//
// Each socket's user comes from the URL's `?as=` (none: anonymous), so one
// client can visit world A anonymously and then teleport home to B as its
// owner, exactly as a page does.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { WebSocketServer } from 'ws'
import { AtriumClient } from '../src/AtriumClient.js'
import { createWorld } from '../../server/src/world.js'
import { attachSessionHandlers } from '../../server/src/session.js'
import { createPresence } from '../../server/src/presence.js'
import { createDb } from '../../server/src/db.js'
import { createBehaviorRunner } from '../../behaviors/src/runner.js'
import { templateGraph } from '../../behaviors/src/templates.js'
import { createEditUndo } from '../../../apps/client/src/edit-undo.js'
import { prepareRestore } from '../../../apps/client/src/edit-duplicate.js'
import { copyObject, preparePaste } from '../../../apps/client/src/copy-paste.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SPACE = resolve(__dirname, '../../../tests/fixtures/space.gltf')

const closers = []
after(async () => { for (const c of closers.reverse()) { try { await c() } catch { /* best effort */ } } })
const delay = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(pred, ms = 4000) {
  const end = Date.now() + ms
  while (Date.now() < end) { if (pred()) return true; await delay(10) }
  return false
}

const DOOR = 'd0000000-0000-4000-8000-000000000001'
const BUTTON = 'b0000000-0000-4000-8000-000000000002'
const SPIN = 'c0000000-0000-4000-8000-000000000003'
const LAMP = 'e0000000-0000-4000-8000-000000000004'
const EVIL = 'f0000000-0000-4000-8000-000000000005'
const pos3 = [0, 0, 0, 1, 0, 0, 0, 1, 0]
const cube = (name, objectId, extra = {}) => ({
  name, translation: [0, 0.5, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1],
  extras: { atrium: { objectId, ...extra } },
  mesh: { primitives: [{ attributes: { POSITION: pos3 } }] },
})

/** A world behind the real handler; the socket's user is the URL's `?as=`. */
async function startWorld({ worldId, ownerUserId, db = null }) {
  const world = await createWorld(SPACE)
  const http = createServer()
  const port = await new Promise((res) => http.listen(0, '127.0.0.1', () => res(http.address().port)))
  const wss = new WebSocketServer({ noServer: true })
  const { closeKeepalive } = attachSessionHandlers({
    wss, world, db, sessions: new Map(), presence: createPresence(), worldOwnerUserId: ownerUserId, worldId,
  })
  http.on('upgrade', (req, socket, head) => {
    const as = new URL(req.url, 'http://x').searchParams.get('as')
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, as || null))
  })
  closers.push(async () => { closeKeepalive(); wss.close(); http.close() })
  return { world, port, url: (path, as) => `ws://127.0.0.1:${port}${path}${as ? `?as=${as}` : ''}` }
}

function dbWith(users) {
  const db = createDb(join(mkdtempSync(join(tmpdir(), 'atrium-copy-e2e-')), 'test.db'))
  for (const [id, username] of users) {
    db.database.prepare('INSERT INTO users (id, username, display_name, created_at) VALUES (?, ?, ?, ?)')
      .run(id, username, username, new Date().toISOString())
  }
  closers.push(async () => db.database.close())
  return db
}

/** A tab: one AtriumClient, which `go` connects (and reconnects, for a teleport). */
function tab({ scriptRunner = false } = {}) {
  const client = new AtriumClient({ connectTimeout: 0 })
  closers.push(async () => client.disconnect?.())
  async function go(url) {
    let loaded = false
    const onLoaded = () => { loaded = true }
    client.on('world:loaded', onLoaded)
    const ready = new Promise((res) => client.once('session:ready', res))
    client.connect(url, { scriptRunner })
    await ready
    assert.ok(await waitFor(() => loaded), `the world at ${url} loads`)
    client.off('world:loaded', onLoaded)
  }
  return { client, go }
}

/** Answer waiters for a client's structural and field writes. */
function answers(client) {
  const got = new Map()
  client.on('edit:accepted', ({ seq }) => got.set(seq, 'accepted'))
  client.on('edit:rejected', ({ seq, message }) => got.set(seq, `rejected: ${message}`))
  return async (seq) => {
    assert.ok(await waitFor(() => got.has(seq)), `seq ${seq} is answered`)
    return got.get(seq)
  }
}

/**
 * The real undo engine, wired to the client as app.js wires it (richer-add-lifecycle.test.js).
 * `recaptures`: also app.js's Y2 re-captures (subtree-add T4: on `som:add` once per
 * message, the root's event; on every `som:remove`) — the outside code review's N-2.
 */
function wireUndo(client, { recaptures = false } = {}) {
  const structuralBySeq = new Map()
  const messages = []
  const undo = createEditUndo({
    getNodeByName: (name) => client.som.getNodeByName(name),
    getObjectByName: (name) => client.som?.getObjectByName(name) ?? null,
    trees: () => client.serverAddFields >= 3,
    checkNewName: (name, node) => client.som.checkNewName(name, node),
    prepareRestore: (gltfNode, opts) => prepareRestore(gltfNode, opts),
    sendTransform: () => null,
    rename: () => null,
    structural: (req, direction) => {
      const seq = req.kind === 'delete' ? client.removeNode(req.name) : client.addNode(req.descriptor)
      structuralBySeq.set(seq, { undo: direction, name: req.name })
      return seq
    },
    message: (t) => messages.push(t),
  })
  const answer = (status) => ({ seq, message }) => {
    if (status === 'accepted') undo.onAccepted(seq)
    else undo.onRejected(seq, { message })
    const info = structuralBySeq.get(seq)
    if (info) undo.onStructureAnswer({ request: { seq, undo: info.undo, name: info.name }, status, removedMessage: null }, message)
  }
  client.on('edit:accepted', answer('accepted'))
  client.on('edit:rejected', answer('rejected'))
  if (recaptures) {
    client.on('som:add', ({ nodeName, root }) => { if (root === undefined || root === nodeName) undo.reCapture() })
    client.on('som:remove', () => undo.reCapture())
  }
  return {
    undo, messages,
    /** The palette's or Paste's add (app.js): send, then register from its answer. */
    add(descriptor) {
      const seq = client.addNode(descriptor)
      structuralBySeq.set(seq, { undo: undefined, name: descriptor.name })
      undo.registerAdd(seq, { name: descriptor.name, duplicate: false })
      return seq
    },
    /** The Delete click (app.js): capture, then remove, then register. */
    remove(name) {
      const node = client.som.getNodeByName(name)
      const cap = undo.capture(node)
      const seq = client.removeNode(name)
      structuralBySeq.set(seq, { undo: undefined, name })
      undo.registerDelete(seq, { node, name, descriptor: cap.ok ? cap.descriptor : null })
      return seq
    },
  }
}

const nameIn = (client) => (id) => {
  const name = client.som?.resolveObjectId?.(id)?.node?.name
  return typeof name === 'string' && name !== '' ? name : null
}

function copyFrom(client, name) {
  const node = client.som.getNodeByName(name)
  assert.ok(node, `${name} is in the world being visited`)
  const r = copyObject(node._node, { wsUrl: client.wsUrl, world: client.world }, { nameOf: nameIn(client) })
  assert.equal(r.ok, true, r.reason)
  return r.snapshot
}

function pasteInto(client, snapshot, i = 0) {
  const r = preparePaste(snapshot, {
    isFree: (n) => client.som.checkNewName(n).ok,
    position: [i * 2, 0, 3],
    destOrigin: AtriumClient.wsOriginToHttpOrigin(client.wsUrl),
    destWorldId: client.world?.id ?? null,
    confirm: () => true,
  })
  assert.equal(r.ok, true, r.reason)
  return r
}

/** The ids anywhere in a behaviour value. */
const idsIn = (b) => JSON.stringify(b)

// ---------------------------------------------------------------------------
// Two worlds, end to end
// ---------------------------------------------------------------------------

test('two worlds: a visitor copies in A, teleports home to B, pastes; B\'s next joiner sees the credited copy; Undo removes it', async () => {
  const A = await startWorld({ worldId: 'world-a', ownerUserId: 'user-alice', db: dbWith([['user-alice', 'alice']]) })
  const B = await startWorld({ worldId: 'world-b', ownerUserId: 'user-bob' })

  // Alice furnishes A.
  const alice = tab()
  await alice.go(A.url('/worlds/alice/garden', 'user-alice'))
  const aliceAnswer = answers(alice.client)
  for (const node of [
    cube('Front door', DOOR),
    cube('Button', BUTTON, { behavior: templateGraph('select-visibility', { target: DOOR, action: 'hide' }, { ownId: BUTTON }) }),
    cube('Spinner', SPIN, { behavior: templateGraph('select-visibility', { target: SPIN, action: 'hide' }, { ownId: SPIN }) }),
    { name: 'Pad', translation: [3, 0, 0], extras: { atrium: { objectId: LAMP, teleporter: { destination: '/worlds/alice/garden' } } },
      mesh: { primitives: [{ attributes: { POSITION: pos3 } }] } },
    { name: 'Statue', translation: [5, 0, 0], extras: { atrium: { objectId: EVIL, model: { url: 'https://models.example/statue.glb' } } } },
  ]) {
    assert.equal(await aliceAnswer(alice.client.addNode(node)), 'accepted', node.name)
  }

  // Bob visits A anonymously and copies.
  const bob = tab()
  await bob.go(A.url('/worlds/alice/garden'))
  assert.equal(bob.client.canEdit, false, 'a visitor')
  assert.deepEqual(bob.client.world, { id: 'world-a', owner: { id: 'user-alice', name: 'alice' } })
  const clips = ['Button', 'Spinner', 'Pad', 'Statue'].map((n) => copyFrom(bob.client, n))
  assert.deepEqual(clips[0].names, { [DOOR]: 'Front door' })

  // Bob teleports home (a new connection, no reload) and pastes each.
  await bob.go(B.url('/worlds/bob/yard', 'user-bob'))
  assert.equal(bob.client.canEdit, true, 'the owner of B')
  const bobUndo = wireUndo(bob.client)
  const bobAnswer = answers(bob.client)
  const pasted = []
  for (const [i, clip] of clips.entries()) {
    const r = pasteInto(bob.client, clip, i)
    assert.equal(await bobAnswer(bobUndo.add(r.descriptor)), 'accepted', r.descriptor.name)
    pasted.push(r)
  }
  assert.ok(await waitFor(() => bobUndo.undo.undoCount === 4), 'four adds recorded')

  // B's next joiner.
  const joiner = tab()
  await joiner.go(B.url('/worlds/bob/yard'))
  const seen = (name) => joiner.client.som.getNodeByName(name)?.extras?.atrium
  const serverA = `http://127.0.0.1:${A.port}`
  const credit = (a) => ({ origin: a.origin, copiedFrom: { ...a.copiedFrom, refs: undefined } })
  for (const name of ['Button', 'Spinner', 'Pad', 'Statue']) {
    const a = seen(name)
    assert.ok(a, `${name} is in B`)
    assert.deepEqual(credit(a), {
      origin: { server: serverA, world: 'world-a', creator: 'user-alice', creatorName: 'alice', at: clips[0].date },
      copiedFrom: { server: serverA, world: 'world-a', address: '/worlds/alice/garden', at: clips[0].date, refs: undefined },
    }, `${name}: K2's credit`)
    assert.ok(![DOOR, BUTTON, SPIN, LAMP, EVIL].includes(a.objectId), `${name}: a new objectId`)
  }
  const button = seen('Button')
  assert.equal(button.behavior.enabled, false, 'the button arrives disabled')
  assert.equal(button.behavior.nodeMap[0], button.objectId, 'remapped to itself')
  assert.ok(!idsIn(button.behavior).includes(DOOR), 'its reference to A\'s door is gone')
  assert.equal(button.copiedFrom.refs.length, 1)
  assert.deepEqual({ was: button.copiedFrom.refs[0].was, name: button.copiedFrom.refs[0].name }, { was: DOOR, name: 'Front door' })
  assert.equal(button.behavior.nodeMap[1], button.copiedFrom.refs[0].id, 'the fresh id is the recorded one')
  const spinner = seen('Spinner')
  assert.equal(spinner.behavior.enabled, false)
  assert.deepEqual(spinner.behavior.nodeMap, [spinner.objectId], 'a self-only behaviour: remapped, nothing replaced')
  assert.equal(Object.hasOwn(spinner.copiedFrom, 'refs'), false)
  assert.deepEqual(seen('Pad').teleporter, { destination: `ws://127.0.0.1:${A.port}/worlds/alice/garden` }, 'the pad still leads to A')
  assert.equal(seen('Statue').model.url, 'https://models.example/statue.glb')

  // Undo removes the last paste.
  bobUndo.undo.run('undo')
  assert.ok(await waitFor(() => B.world.som.getNodeByName('Statue') === null), 'Undo removed it on the server')
  assert.ok(await waitFor(() => joiner.client.som.getNodeByName('Statue') === null), 'and for the joiner')
})

// ---------------------------------------------------------------------------
// The hostile case, two tabs (ChatGPT review of Rev 1.2, M1's required test)
// ---------------------------------------------------------------------------

/**
 * Hostile world A: Mallory publishes a button whose template is aimed at the
 * id of an object in B (ids are visible to every visitor of B). Tab 1 copies
 * it while visiting A, then goes home to B as its owner and the script host.
 */
async function hostileSetup(targetId) {
  const A = await startWorld({ worldId: 'world-mal', ownerUserId: 'user-mal' })
  const B = await startWorld({ worldId: 'world-b', ownerUserId: 'user-bob' })
  const mal = tab()
  await mal.go(A.url('/worlds/mal/trap', 'user-mal'))
  const malAnswer = answers(mal.client)
  const hostile = cube('Free button', EVIL, {
    behavior: templateGraph('select-visibility', { target: targetId, action: 'hide' }, { ownId: EVIL }),
  })
  assert.equal(await malAnswer(mal.client.addNode(hostile)), 'accepted', 'A\'s server accepts a target it doesn\'t have')

  const tab1 = tab({ scriptRunner: true })
  // The host tab's own avatar stands at the origin, within the 10 m click rule
  // of everything pasted (AC-L3 (a)): without one, every select stops at
  // 'no-avatar' and the test below would prove nothing.
  const me = { name: 'me', translation: [0, 0, 0] }
  const runner = createBehaviorRunner({ client: tab1.client, position: (n) => n?.translation, localAvatar: () => me })
  closers.push(async () => runner.dispose?.())
  await tab1.go(A.url('/worlds/mal/trap'))
  const clip = copyFrom(tab1.client, 'Free button')
  return { A, B, tab1, runner, clip }
}

/** Tab 1 enables the pasted template (a template never asks) and clicks it; the target must not change. */
async function enableAndClick({ B, tab1, runner, name, targetName }) {
  const answer = answers(tab1.client)
  const value = tab1.client.som.getNodeByName(name).extras.atrium.behavior
  assert.equal(await answer(tab1.client.sendField(name, 'extras.atrium.behavior', { ...value, enabled: true })), 'accepted', 'enabled')
  assert.ok(await waitFor(() => tab1.client.som.getNodeByName(name).extras.atrium.behavior.enabled === true))
  assert.ok(await waitFor(() => runner.engines.has(name)), 'the runner looked at it')
  const record = runner.engines.get(name)
  assert.equal(record.engine, null, `the pasted behaviour doesn't run (${record.reason})`)
  assert.match(record.reason, /^target-not-found: 1$/, 'its reference reaches nothing')
  assert.equal(runner.select(tab1.client.som.getNodeByName(name)), 'not-running', 'the click reaches no engine')
  for (let i = 0; i < 5; i++) { runner.tick(); await delay(30) }
  await delay(150)
  assert.equal(B.world.som.getNodeByName(targetName).visible, true, `${targetName} was not written`)
  const stored = B.world.som.getNodeByName(name).extras.atrium.behavior
  for (const field of [stored.nodeMap, stored.targets, stored.template.params.target]) {
    assert.ok(!JSON.stringify(field).includes(targetName === 'Door' ? DOOR : LAMP), 'the target\'s id is in no grant')
  }
}

test('hostile, two tabs: tab 2 deletes the door, tab 1 pastes a button aimed at it, tab 2 undoes; enabled, it can\'t write the door', async () => {
  const { B, tab1, runner, clip } = await hostileSetup(DOOR)
  // B's door, placed by its owner earlier.
  const setup = tab()
  await setup.go(B.url('/worlds/bob/yard', 'user-bob'))
  assert.equal(await answers(setup.client)(setup.client.addNode(cube('Door', DOOR))), 'accepted')
  setup.client.disconnect()

  await tab1.go(B.url('/worlds/bob/yard', 'user-bob'))
  assert.ok(await waitFor(() => tab1.client.scriptHost?.active === true), 'tab 1 is the script host')
  const tab2 = tab()
  await tab2.go(B.url('/worlds/bob/yard', 'user-bob'))
  const undo2 = wireUndo(tab2.client)

  // Tab 2 deletes the door.
  undo2.remove('Door')
  assert.ok(await waitFor(() => undo2.undo.undoCount === 1), 'the delete is recorded in tab 2')
  assert.ok(await waitFor(() => tab1.client.som.getNodeByName('Door') === null), 'tab 1 sees it gone')

  // Tab 1 pastes: nothing in tab 1 knows the door's id now.
  const undo1 = wireUndo(tab1.client)
  const r = pasteInto(tab1.client, clip)
  assert.equal(await answers(tab1.client)(undo1.add(r.descriptor)), 'accepted')

  // Tab 2 presses Undo: the door is back under its old id.
  undo2.undo.run('undo')
  assert.ok(await waitFor(() => B.world.som.getNodeByName('Door')?.extras?.atrium?.objectId === DOOR), 'the door is back, its id with it')
  assert.ok(await waitFor(() => tab1.client.som.getNodeByName('Door') !== null))

  await enableAndClick({ B, tab1, runner, name: r.descriptor.name, targetName: 'Door' })
})

test('hostile, the Redo version: tab 2 adds a lamp and undoes, tab 1 pastes a button aimed at it, tab 2 redoes; enabled, it can\'t write the lamp', async () => {
  const { B, tab1, runner, clip } = await hostileSetup(LAMP)
  await tab1.go(B.url('/worlds/bob/yard', 'user-bob'))
  assert.ok(await waitFor(() => tab1.client.scriptHost?.active === true))
  const tab2 = tab()
  await tab2.go(B.url('/worlds/bob/yard', 'user-bob'))
  const undo2 = wireUndo(tab2.client)

  assert.equal(await answers(tab2.client)(undo2.add(cube('Lamp', LAMP))), 'accepted')
  assert.ok(await waitFor(() => undo2.undo.undoCount === 1))
  undo2.undo.run('undo')
  assert.ok(await waitFor(() => B.world.som.getNodeByName('Lamp') === null && undo2.undo.redoCount === 1), 'undone; Redo available')

  const undo1 = wireUndo(tab1.client)
  const r = pasteInto(tab1.client, clip)
  assert.equal(await answers(tab1.client)(undo1.add(r.descriptor)), 'accepted')

  undo2.undo.run('redo')
  assert.ok(await waitFor(() => B.world.som.getNodeByName('Lamp')?.extras?.atrium?.objectId === LAMP), 'Redo brings the lamp back under its id')
  assert.ok(await waitFor(() => tab1.client.som.getNodeByName('Lamp') !== null))

  await enableAndClick({ B, tab1, runner, name: r.descriptor.name, targetName: 'Lamp' })
})

test('in one tab a Paste after Undo clears Redo, so the one-tab Redo sequence can\'t bring the id back', async () => {
  const { tab1, clip, B } = await hostileSetup(LAMP)
  await tab1.go(B.url('/worlds/bob/yard', 'user-bob'))
  const undo1 = wireUndo(tab1.client)
  const answer = answers(tab1.client)
  assert.equal(await answer(undo1.add(cube('Lamp', LAMP))), 'accepted')
  assert.ok(await waitFor(() => undo1.undo.undoCount === 1))
  undo1.undo.run('undo')
  assert.ok(await waitFor(() => undo1.undo.redoCount === 1))
  const r = pasteInto(tab1.client, clip)
  assert.equal(await answer(undo1.add(r.descriptor)), 'accepted')
  assert.ok(await waitFor(() => undo1.undo.undoCount === 1 && undo1.undo.redoCount === 0), 'the paste is recorded and Redo is gone')
  assert.ok(!JSON.stringify(B.world.som.getNodeByName(r.descriptor.name).extras.atrium.behavior).includes(LAMP))
})

// ---------------------------------------------------------------------------
// The fresh-agent check's finding 1: the hostile world on the SAME server
// ---------------------------------------------------------------------------

/** One HTTP server, two worlds routed by path (as the registry does): one origin. */
async function startTwoWorldsOneServer() {
  const http = createServer()
  const port = await new Promise((res) => http.listen(0, '127.0.0.1', () => res(http.address().port)))
  const hosts = {}
  for (const [prefix, worldId, ownerUserId] of [['/worlds/mal/', 'world-mal', 'user-mal'], ['/worlds/bob/', 'world-b', 'user-bob']]) {
    const world = await createWorld(SPACE)
    const wss = new WebSocketServer({ noServer: true })
    const { closeKeepalive } = attachSessionHandlers({
      wss, world, sessions: new Map(), presence: createPresence(), worldOwnerUserId: ownerUserId, worldId,
    })
    hosts[prefix] = { world, wss }
    closers.push(async () => { closeKeepalive(); wss.close() })
  }
  http.on('upgrade', (req, socket, head) => {
    const u = new URL(req.url, 'http://x')
    const host = Object.entries(hosts).find(([prefix]) => u.pathname.startsWith(prefix))?.[1]
    if (!host) { socket.destroy(); return }
    host.wss.handleUpgrade(req, socket, head, (ws) => host.wss.emit('connection', ws, req, u.searchParams.get('as') || null))
  })
  closers.push(async () => http.close())
  const url = (path, as) => `ws://127.0.0.1:${port}${path}${as ? `?as=${as}` : ''}`
  return { A: { world: hosts['/worlds/mal/'].world, url }, B: { world: hosts['/worlds/bob/'].world, url } }
}

test('hostile, one server: a world beside yours on the same origin is another world; the pasted button can\'t write your door', async () => {
  const { A, B } = await startTwoWorldsOneServer()
  const setup = tab()
  await setup.go(B.url('/worlds/bob/yard', 'user-bob'))
  assert.equal(await answers(setup.client)(setup.client.addNode(cube('Door', DOOR))), 'accepted')
  setup.client.disconnect()

  const mal = tab()
  await mal.go(A.url('/worlds/mal/trap', 'user-mal'))
  const hostile = cube('Free button', EVIL, {
    behavior: templateGraph('select-visibility', { target: DOOR, action: 'hide' }, { ownId: EVIL }),
  })
  assert.equal(await answers(mal.client)(mal.client.addNode(hostile)), 'accepted')

  const tab1 = tab({ scriptRunner: true })
  const me = { name: 'me', translation: [0, 0, 0] }
  const runner = createBehaviorRunner({ client: tab1.client, position: (n) => n?.translation, localAvatar: () => me })
  closers.push(async () => runner.dispose?.())
  await tab1.go(A.url('/worlds/mal/trap'))
  const clip = copyFrom(tab1.client, 'Free button')
  await tab1.go(B.url('/worlds/bob/yard', 'user-bob'))
  assert.ok(await waitFor(() => tab1.client.scriptHost?.active === true))
  assert.equal(clip.source.origin, AtriumClient.wsOriginToHttpOrigin(tab1.client.wsUrl), 'one origin')
  assert.notEqual(clip.source.world.id, tab1.client.world.id, 'two worlds')

  const r = pasteInto(tab1.client, clip)
  assert.equal(r.sameWorld, false)
  assert.equal(await answers(tab1.client)(wireUndo(tab1.client).add(r.descriptor)), 'accepted')
  await enableAndClick({ B, tab1, runner, name: r.descriptor.name, targetName: 'Door' })
})

// ---------------------------------------------------------------------------
// subtree-add T6 (devtasks/PREBRIEF-subtree-add.md §5): a group, two worlds
// ---------------------------------------------------------------------------

test('subtree-add: a visitor copies a lamp with parts in A, pastes it in B; the joiner sees every part credited, the shared material shared, the hidden part hidden; one Undo removes the group', async () => {
  const A = await startWorld({ worldId: 'world-a', ownerUserId: 'user-alice', db: dbWith([['user-alice', 'alice']]) })
  const B = await startWorld({ worldId: 'world-b', ownerUserId: 'user-bob' })
  const ROOT = 'a1000000-0000-4000-8000-000000000011'
  const SHADE = 'a1000000-0000-4000-8000-000000000012'
  const STAND = 'a1000000-0000-4000-8000-000000000013'
  const brass = { name: 'Brass', pbrMetallicRoughness: { baseColorFactor: [1, 0.8, 0.2, 1] } }
  const lamp = {
    name: 'Lamp', translation: [2, 0, 2],
    extras: { atrium: { objectId: ROOT } },
    children: [
      { name: 'Shade', translation: [0, 1.6, 0],
        extras: { atrium: { objectId: SHADE, behavior: templateGraph('select-visibility', { target: STAND, action: 'toggle' }, { ownId: SHADE }) } },
        mesh: { primitives: [{ attributes: { POSITION: pos3 }, material: brass }] } },
      { name: 'Stand', extras: { __atrium_visible: false, atrium: { objectId: STAND, behavior: templateGraph('select-visibility', { target: DOOR, action: 'hide' }, { ownId: STAND }) } },
        mesh: { primitives: [{ attributes: { POSITION: pos3 }, material: { ref: 0 } }] } },
    ],
  }
  const alice = tab()
  await alice.go(A.url('/worlds/alice/garden', 'user-alice'))
  assert.equal(alice.client.serverAddFields, 4, 'the hello says level 4 (grouping GR5)')
  const aliceAnswer = answers(alice.client)
  assert.equal(await aliceAnswer(alice.client.addNode(cube('Front door', DOOR))), 'accepted')
  assert.equal(await aliceAnswer(alice.client.addNode(lamp)), 'accepted', 'the tree, in one add')

  // Bob visits A and copies the lamp (its server is level 3: trees allowed).
  const bob = tab()
  await bob.go(A.url('/worlds/alice/garden'))
  const node = bob.client.som.getNodeByName('Lamp')
  const c = copyObject(node._node, { wsUrl: bob.client.wsUrl, world: bob.client.world }, { nameOf: nameIn(bob.client), trees: bob.client.serverAddFields >= 3 })
  assert.equal(c.ok, true, c.reason)
  assert.deepEqual(c.snapshot.names, { [DOOR]: 'Front door' }, 'only the foreign id is named')

  // Home to B; paste.
  await bob.go(B.url('/worlds/bob/yard', 'user-bob'))
  const bobUndo = wireUndo(bob.client)
  const r = preparePaste(c.snapshot, {
    isFree: (n) => bob.client.som.checkNewName(n).ok, position: [0, 0, 3],
    destOrigin: AtriumClient.wsOriginToHttpOrigin(bob.client.wsUrl), destWorldId: bob.client.world.id,
    destAddFields: bob.client.serverAddFields, confirm: () => true,
  })
  assert.equal(r.ok, true, r.reason)
  assert.equal(await answers(bob.client)(bobUndo.add(r.descriptor)), 'accepted')
  assert.ok(await waitFor(() => bobUndo.undo.undoCount === 1), 'one entry for the group')

  // B's next joiner.
  const joiner = tab()
  await joiner.go(B.url('/worlds/bob/yard'))
  const som = joiner.client.som
  const serverA = `http://127.0.0.1:${A.port}`
  const parts = ['Lamp', 'Shade', 'Stand'].map((n) => som.getNodeByName(n))
  assert.ok(parts.every(Boolean), 'every part is in B')
  assert.deepEqual(parts[0]._node.listChildren().map((k) => k.getName()), ['Shade', 'Stand'], 'the parts are the lamp\u2019s children')
  for (const p of parts) {
    const a = p.extras.atrium
    assert.equal(a.copiedFrom.server, serverA, `${p.name}: copiedFrom`)
    assert.equal(a.origin.creatorName, 'alice', `${p.name}: origin`)
    assert.ok(![ROOT, SHADE, STAND, DOOR].includes(a.objectId), `${p.name}: a new objectId`)
  }
  const shade = som.getNodeByName('Shade').extras.atrium
  const stand = som.getNodeByName('Stand').extras.atrium
  assert.equal(shade.behavior.enabled, false)
  assert.equal(shade.behavior.template.params.target, stand.objectId, 'the shade still aims at the stand: its copy')
  assert.equal(Object.hasOwn(shade.copiedFrom, 'refs'), false)
  assert.ok(!idsIn(stand.behavior).includes(DOOR), 'the stand’s reference to A’s door is gone')
  assert.deepEqual({ was: stand.copiedFrom.refs[0].was, name: stand.copiedFrom.refs[0].name }, { was: DOOR, name: 'Front door' })
  const mat = (n) => som.getNodeByName(n)._node.getMesh().listPrimitives()[0].getMaterial()
  assert.ok(mat('Shade') === mat('Stand'), 'one material, shared, as in A') // `ok`: a failing `equal` would inspect the document graph
  assert.equal(mat('Stand').getName(), 'Brass')
  assert.equal(som.getNodeByName('Stand').visible, false, 'the hidden part stays hidden')
  assert.notEqual(som.getNodeByName('Lamp').visible, false, 'the root is visible')

  // One Undo removes the group, everywhere.
  bobUndo.undo.run('undo')
  assert.ok(await waitFor(() => ['Lamp', 'Shade', 'Stand'].every((n) => B.world.som.getNodeByName(n) === null)), 'Undo removed the group on the server')
  assert.ok(await waitFor(() => ['Lamp', 'Shade', 'Stand'].every((n) => som.getNodeByName(n) === null)), 'and for the joiner')
})

test('subtree-add T5 (the outside code review’s N-2): a part removed in another tab while this tab’s Delete of its group is in flight; one Undo brings back what the server removed', async (t) => {
  const A = await startWorld({ worldId: 'world-a', ownerUserId: 'user-alice', db: dbWith([['user-alice', 'alice']]) })
  const TRI = pos3
  const lamp = { name: 'Lamp', children: [
    { name: 'Shade', mesh: { primitives: [{ attributes: { POSITION: TRI } }] } },
    { name: 'Stand', mesh: { primitives: [{ attributes: { POSITION: TRI } }] } },
  ] }
  const a = tab()
  await a.go(A.url('/worlds/alice/garden', 'user-alice'))
  const b = tab()
  await b.go(A.url('/worlds/alice/garden', 'user-alice'))
  assert.equal(await answers(a.client)(a.client.addNode(lamp)), 'accepted')
  assert.ok(await waitFor(() => b.client.som.getNodeByName('Shade')), 'B sees the lamp')
  const aUndo = wireUndo(a.client, { recaptures: true })

  // One synchronous block: B's remove is written first, and A's capture is
  // taken before A can hear of it.
  const bSeq = b.client.removeNode('Shade')
  const aSeq = aUndo.remove('Lamp')
  const [bAnswer, aAnswer] = await Promise.all([answers(b.client)(bSeq), answers(a.client)(aSeq)])
  assert.equal(aAnswer, 'accepted')
  assert.ok(await waitFor(() => aUndo.undo.undoCount === 1), 'A’s Delete is recorded')
  t.diagnostic(`B's remove of the part: ${bAnswer} (accepted = it reached the server first, the case this test is for)`)

  aUndo.undo.run('undo')
  assert.ok(await waitFor(() => A.world.som.getNodeByName('Lamp') && b.client.som.getNodeByName('Lamp')), 'Undo brought the lamp back, on the server and in B')
  const expected = bAnswer === 'accepted' ? ['Stand'] : ['Shade', 'Stand']
  const kids = (som) => som.getNodeByName('Lamp')._node.listChildren().map((k) => k.getName())
  assert.deepEqual(kids(A.world.som), expected, 'the group as the server held it when A’s Delete removed it')
  assert.ok(await waitFor(() => JSON.stringify(kids(b.client.som)) === JSON.stringify(expected)), 'and B sees the same')
  if (bAnswer === 'accepted') assert.equal(A.world.som.getNodeByName('Shade'), null, 'the part B removed stays removed')
})
