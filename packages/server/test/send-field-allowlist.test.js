// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// send-field-allowlist — Phase 3 step 0c security hardening.
//
// The new `send` field allowlist is default-deny: it resolves the target,
// classifies the RESOLVED object by its class, and allows only the exact
// operations that class permits (pre-brief §3 A1–A5, decisions D1–D5).
//
// This file covers:
//   * the pure policy helper (A1–A4) on real SOM objects;
//   * real WebSocket traffic in an open world, an owner world and a read-only
//     world, over BOTH world types (createWorld file worlds and
//     createWorldFromDocument document worlds);
//   * the exact messages the inspector panels and the AtriumClient listeners
//     emit (built through the real SOM + AtriumClient, not hand-made look-alikes).
//
// Every server is created on port 0 and closed in after(); every socket is
// closed in finally.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import WebSocket, { WebSocketServer } from 'ws'
import { createWorld, createWorldFromDocument } from '../src/world.js'
import { createSessionServer, attachSessionHandlers } from '../src/session.js'
import { authorizeSend, resolveSendTarget, liveAvatarNames } from '../src/send-policy.js'
import { AtriumClient } from '../../client/src/AtriumClient.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE = (name) => resolve(__dirname, '../../../tests/fixtures/', name)
const SPACE       = FIXTURE('space.gltf')
const SPACE_CAM   = FIXTURE('space-cameras.gltf')
const SPACE_LIGHT = FIXTURE('space-lights.gltf')
const SPACE_ANIM  = FIXTURE('space-anim.gltf')

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

const closers = []
after(async () => {
  for (const close of closers.reverse()) {
    try { await close() } catch { /* best effort */ }
  }
})

const delay = (ms) => new Promise(r => setTimeout(r, ms))

function listen(http) {
  return new Promise((res, rej) => {
    http.once('error', rej)
    http.listen(0, '127.0.0.1', () => res(http.address().port))
  })
}

// ---------------------------------------------------------------------------
// WebSocket helpers
// ---------------------------------------------------------------------------

function waitForOpen(ws) {
  return new Promise((res, rej) => {
    if (ws.readyState === WebSocket.OPEN) return res()
    ws.once('open', res)
    ws.once('error', rej)
  })
}

function waitForClose(ws) {
  return new Promise((res) => {
    if (ws.readyState === WebSocket.CLOSED) return res()
    ws.once('close', res)
  })
}

function collect(ws) {
  const messages = []
  ws.on('message', (raw) => {
    try { messages.push(JSON.parse(raw)) } catch { /* ignore */ }
  })
  return messages
}

async function waitFor(messages, pred, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = messages.find(pred)
    if (found) return found
    await delay(10)
  }
  return null
}

const isType = (type) => (m) => m.type === type

async function connect(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`)
  const messages = collect(ws)
  await waitForOpen(ws)
  return { ws, messages }
}

async function hello(ws, messages, id) {
  ws.send(JSON.stringify({
    type: 'hello',
    id,
    capabilities: { tick: { interval: 5000 } },
  }))
  const reply = await waitFor(messages, isType('hello'))
  assert.ok(reply, 'hello reply should arrive')
  return reply
}

// ---------------------------------------------------------------------------
// Servers
// ---------------------------------------------------------------------------

// Open (no-owner) world through createSessionServer.
async function startOpenWorld(gltfPath) {
  const world = await createWorld(gltfPath)
  const http = createServer()
  const port = await listen(http)
  const server = createSessionServer({ httpServer: http, maxUsers: 10, world })
  closers.push(() => server.close())
  return { world, port }
}

// Handler-level world: choose the world owner, the connecting userId and the
// mutation policy. `connectAs` defaults to the owner; pass a different id to
// simulate a non-owner session.
async function startHandlerWorld({ world, ownerUserId = null, connectAs = null, mutationPolicy, onSaveableMutation = null }) {
  const http = createServer()
  const port = await listen(http)
  const wss = new WebSocketServer({ noServer: true })
  const sessions = new Map()
  const presence = { add() {}, remove() { return null }, list() { return [] }, setPosition() {} }
  const socketUserId = connectAs ?? ownerUserId

  const { closeKeepalive } = attachSessionHandlers({
    wss,
    world,
    sessions,
    presence,
    worldOwnerUserId: ownerUserId,
    mutationPolicy,
    onSaveableMutation,
  })

  http.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, socketUserId)
    })
  })

  closers.push(async () => {
    closeKeepalive()
    wss.close()
    http.close()
  })

  return { world, port, sessions }
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

// Document worlds: inline any external buffer so createWorldFromDocument (which
// is handed `resources: {}`) can resolve the geometry.
async function loadDocumentJson(gltfPath) {
  const json = JSON.parse(await readFile(gltfPath, 'utf8'))
  for (const buffer of json.buffers ?? []) {
    if (buffer.uri && !buffer.uri.startsWith('data:')) {
      const bin = await readFile(resolve(dirname(gltfPath), buffer.uri))
      buffer.uri = 'data:application/octet-stream;base64,' + bin.toString('base64')
    }
  }
  return json
}

// Rename a glTF camera/light so its bare registration name differs from its
// host node's name (SOMDocument registers both keys).
async function documentWithAliasedAssets() {
  const json = await loadDocumentJson(SPACE_CAM)
  json.cameras[0].name = 'MainCameraLens'
  return json
}

async function documentWithAliasedLight() {
  const lights = await loadDocumentJson(SPACE_LIGHT)
  lights.extensions.KHR_lights_punctual.lights[0].name = 'AliasGlow'
  return lights
}

function cloneExtras(world) {
  return JSON.parse(JSON.stringify(world.som.extras ?? {}))
}

function setLeaf(obj, path, value) {
  const segments = path.split('.')
  let target = obj
  for (let i = 0; i < segments.length - 1; i++) {
    if (target[segments[i]] == null) target[segments[i]] = {}
    target = target[segments[i]]
  }
  target[segments[segments.length - 1]] = value
  return obj
}

function getLeaf(obj, path) {
  const segments = path.split('.')
  let value = obj
  for (const segment of segments) {
    if (value == null) return undefined
    value = value[segment]
  }
  return value
}

const lastSetFor = (messages, nodeName, field) =>
  messages.filter(m => m.type === 'set' && m.node === nodeName && m.field === field).pop() ?? null

// ===========================================================================
// Pure policy — A1: resolve the target, classify by class, not by name
// ===========================================================================

test('policy A1: resolveSendTarget resolves every addressable class and nothing else', async () => {
  const world = await createWorld(SPACE_CAM)
  const som = world.som

  assert.equal(resolveSendTarget(som, 'crate-01')?.constructor?.name, 'SOMNode')
  assert.equal(resolveSendTarget(som, '__document__')?.constructor?.name, 'SOMDocument')
  assert.equal(resolveSendTarget(som, 'MainCamera.camera')?.constructor?.name, 'SOMCamera')
  assert.equal(resolveSendTarget(som, 'no-such-node'), null)
  assert.equal(resolveSendTarget(som, ''), null)
  assert.equal(resolveSendTarget(som, undefined), null)
  assert.equal(resolveSendTarget(null, 'crate-01'), null)
})

test('policy A1: an unknown target is NODE_NOT_FOUND, never PERMISSION_DENIED', async () => {
  const world = await createWorld(SPACE)
  const decision = authorizeSend({
    target: resolveSendTarget(world.som, 'ghost'),
    nodeName: 'ghost',
    field: 'translation',
    value: [0, 0, 0],
  })
  assert.equal(decision.ok, false)
  assert.equal(decision.code, 'NODE_NOT_FOUND')
})

test('policy A1/A2: a node allows only its four fields and the teleporter leaf', async () => {
  const world = await createWorld(SPACE)
  const som = world.som
  const node = resolveSendTarget(som, 'crate-01')

  const decide = (field, value) => authorizeSend({ target: node, nodeName: 'crate-01', field, value })

  assert.equal(decide('translation', [1, 2, 3]).ok, true)
  assert.equal(decide('rotation', [0, 0, 0, 1]).ok, true)
  assert.equal(decide('scale', [1, 1, 1]).ok, true)
  assert.equal(decide('visible', false).ok, true)
  assert.equal(decide('extras.atrium.teleporter.destination', '#').ok, true)

  for (const field of ['extras', 'extras.atrium', 'parent', 'children', 'mesh',
                       'mesh.name', 'mesh.weights', 'mesh.extras', 'skin', 'extensions', 'intensity']) {
    const d = decide(field, field === 'extras' || field === 'extras.atrium' ? { a: 1 } : 'x')
    assert.equal(d.ok, false, `field "${field}" must be refused`)
    assert.equal(d.code, 'PERMISSION_DENIED', `field "${field}" must be PERMISSION_DENIED`)
  }

  // A8/A9: `name` is now allowed on a node — but only with a string value.
  // The D3 rules themselves are enforced by the server's rename branch.
  assert.equal(decide('name', 'Box').ok, true, 'a rename is allowed on a node')
  assert.equal(decide('name', 42).code, 'INVALID_VALUE', 'a non-string name is INVALID_VALUE')
})

test('policy A1: cameras, lights and animations are refused outside their own field sets', async () => {
  const cameraWorld = await createWorld(SPACE_CAM)
  const lightWorld  = await createWorld(SPACE_LIGHT)
  const animWorld   = await createWorld(SPACE_ANIM)

  const camera = resolveSendTarget(cameraWorld.som, 'MainCamera.camera')
  const light  = resolveSendTarget(lightWorld.som, 'Sun.light')
  const anim   = resolveSendTarget(animWorld.som, 'CrateRotate')

  assert.equal(camera?.constructor?.name, 'SOMCamera')
  assert.equal(light?.constructor?.name, 'SOMLight')
  assert.equal(anim?.constructor?.name, 'SOMAnimation')

  const cam = (field, value) => authorizeSend({ target: camera, nodeName: 'MainCamera.camera', field, value })
  const lit = (field, value) => authorizeSend({ target: light, nodeName: 'Sun.light', field, value })
  const anm = (field, value) => authorizeSend({ target: anim, nodeName: 'CrateRotate', field, value })

  for (const field of ['type', 'yfov', 'aspectRatio', 'znear', 'zfar', 'xmag', 'ymag']) {
    const value = field === 'type' ? 'perspective' : 1
    assert.equal(cam(field, value).ok, true, `camera ${field} must be allowed`)
  }
  assert.equal(cam('translation', [0, 0, 0]).code, 'PERMISSION_DENIED')
  assert.equal(cam('extras', {}).code, 'PERMISSION_DENIED')
  assert.equal(cam('name', 'x').code, 'PERMISSION_DENIED')

  assert.equal(lit('intensity', 2).ok, true)
  assert.equal(lit('color', [1, 1, 1]).ok, true)
  assert.equal(lit('type', 'spot').ok, true)
  assert.equal(lit('range', null).ok, true)
  assert.equal(lit('translation', [0, 0, 0]).code, 'PERMISSION_DENIED')

  assert.equal(anm('playback', { playing: true }).ok, true)
  assert.equal(anm('translation', [0, 0, 0]).code, 'PERMISSION_DENIED')
})

test('policy A1: a camera is refused when addressed by its bare glTF name', async () => {
  const world = await createWorldFromDocument(await documentWithAliasedAssets())
  const qualified = resolveSendTarget(world.som, 'MainCamera.camera')
  const bare      = resolveSendTarget(world.som, 'MainCameraLens')

  assert.equal(qualified?.constructor?.name, 'SOMCamera')
  assert.equal(bare?.constructor?.name, 'SOMCamera', 'bare glTF name resolves to the same camera')

  assert.equal(authorizeSend({
    target: qualified, nodeName: 'MainCamera.camera', field: 'yfov', value: 1,
  }).ok, true)

  const refused = authorizeSend({ target: bare, nodeName: 'MainCameraLens', field: 'yfov', value: 1 })
  assert.equal(refused.ok, false)
  assert.equal(refused.code, 'PERMISSION_DENIED')
})

test('policy A1: the material chain is validated step by step', async () => {
  const world = await createWorld(SPACE)
  const som = world.som
  const crate = resolveSendTarget(som, 'crate-01')
  const lamp  = resolveSendTarget(som, 'lamp-01')   // no mesh

  const decide = (node, field, value) => authorizeSend({ target: node, nodeName: node.name, field, value })
  const M = 'mesh.primitives[0].material'

  assert.equal(decide(crate, `${M}.baseColorFactor`, [1, 0, 0, 1]).ok, true)
  assert.equal(decide(crate, `${M}.metallicFactor`, 0.5).ok, true)
  assert.equal(decide(crate, `${M}.roughnessFactor`, 0.5).ok, true)
  assert.equal(decide(crate, `${M}.emissiveFactor`, [0, 0, 0]).ok, true)
  assert.equal(decide(crate, `${M}.alphaMode`, 'BLEND').ok, true)
  assert.equal(decide(crate, `${M}.alphaCutoff`, 0.5).ok, true)
  assert.equal(decide(crate, `${M}.doubleSided`, true).ok, true)

  // Index out of range.
  assert.equal(decide(crate, 'mesh.primitives[7].material.baseColorFactor', [1, 0, 0, 1]).code, 'INVALID_FIELD')
  // Missing link — node with no mesh.
  assert.equal(decide(lamp, `${M}.baseColorFactor`, [1, 0, 0, 1]).code, 'INVALID_FIELD')
  // Nothing beyond the material property.
  assert.equal(decide(crate, `${M}.extras`, {}).code, 'PERMISSION_DENIED')
  assert.equal(decide(crate, `${M}._material.name`, 'x').code, 'PERMISSION_DENIED')
  assert.equal(decide(crate, `${M}.baseColorTexture`, {}).code, 'PERMISSION_DENIED')
  // Not a material property at all.
  assert.equal(decide(crate, `${M}.nope`, 1).code, 'PERMISSION_DENIED')
})

// ===========================================================================
// Pure policy — A2: canonical spelling only
// ===========================================================================

test('policy A2: non-canonical spellings are refused even when parsePath reads them', async () => {
  const world = await createWorld(SPACE)
  const node = resolveSendTarget(world.som, 'crate-01')

  const nonCanonical = [
    '.translation',
    'translation.',
    '..translation',
    'translation..',
    'mesh..primitives[0].material.baseColorFactor',
    'mesh.primitives[00].material.baseColorFactor',
    'mesh.primitives[0].material.baseColorFactor.',
    'extras[x]',
    '',
    'translation[0]',
    'extras.atrium.teleporter.destination.length',
    'translation[0].x',
  ]
  for (const field of nonCanonical) {
    const decision = authorizeSend({ target: node, nodeName: 'crate-01', field, value: [1, 2, 3] })
    assert.equal(decision.ok, false, `"${field}" must be refused`)
    assert.equal(decision.code, 'PERMISSION_DENIED', `"${field}" must be PERMISSION_DENIED`)
  }
})

// ===========================================================================
// Pure policy — A4: value checks (type / length / enum / finite only)
// ===========================================================================

test('policy A4: bad values on allowed fields are INVALID_VALUE', async () => {
  const world = await createWorld(SPACE_CAM)
  const som = world.som
  const crate  = resolveSendTarget(som, 'crate-01')
  const camera = resolveSendTarget(som, 'MainCamera.camera')
  const M = 'mesh.primitives[0].material'

  const node = (field, value) => authorizeSend({ target: crate, nodeName: 'crate-01', field, value })
  const cam  = (field, value) => authorizeSend({ target: camera, nodeName: 'MainCamera.camera', field, value })

  assert.equal(node('translation', [1, 2]).code, 'INVALID_VALUE')
  assert.equal(node('translation', [1, 2, 'x']).code, 'INVALID_VALUE')
  assert.equal(node('translation', 'nope').code, 'INVALID_VALUE')
  assert.equal(node('rotation', [1, 2, 3]).code, 'INVALID_VALUE')
  assert.equal(node('visible', 'yes').code, 'INVALID_VALUE')
  assert.equal(node('visible', null).code, 'INVALID_VALUE')
  assert.equal(node('scale', [1, 1, null]).code, 'INVALID_VALUE')

  assert.equal(node(`${M}.baseColorFactor`, [1, 0, 0]).code, 'INVALID_VALUE')
  assert.equal(node(`${M}.emissiveFactor`, [1, 0]).code, 'INVALID_VALUE')
  assert.equal(node(`${M}.alphaMode`, 'SOLID').code, 'INVALID_VALUE')
  assert.equal(node(`${M}.doubleSided`, 1).code, 'INVALID_VALUE')
  assert.equal(node(`${M}.metallicFactor`, 'x').code, 'INVALID_VALUE')

  assert.equal(cam('type', 'isometric').code, 'INVALID_VALUE')
  assert.equal(cam('yfov', '1.0').code, 'INVALID_VALUE')
  assert.equal(cam('aspectRatio', null).code, 'INVALID_VALUE')
})

test('policy A4: the teleporter destination is capped at 2048 characters', async () => {
  const world = await createWorld(SPACE)
  const node = resolveSendTarget(world.som, 'crate-01')

  const ok  = authorizeSend({ target: node, nodeName: 'crate-01', field: 'extras.atrium.teleporter.destination', value: 'a'.repeat(2048) })
  const bad = authorizeSend({ target: node, nodeName: 'crate-01', field: 'extras.atrium.teleporter.destination', value: 'a'.repeat(2049) })

  assert.equal(ok.ok, true)
  assert.equal(bad.ok, false)
  assert.equal(bad.code, 'INVALID_VALUE')
  assert.ok(bad.message.includes('2048'), 'the message should name the limit')
})

test('policy A4: playback accepts exactly the SOMAnimation getter key set', async () => {
  const world = await createWorld(SPACE_ANIM)
  const anim = resolveSendTarget(world.som, 'CrateRotate')

  const decide = (value) => authorizeSend({ target: anim, nodeName: 'CrateRotate', field: 'playback', value })

  assert.equal(decide({
    playing: true, paused: false, loop: true, autoStart: false,
    timeScale: 1.5, startTime: 0, startWallClock: Date.now(), pauseTime: null,
  }).ok, true)
  assert.equal(decide({}).ok, true)
  assert.equal(decide({ playing: true, duration: 3 }).code, 'INVALID_VALUE')
  assert.equal(decide({ playing: 'yes' }).code, 'INVALID_VALUE')
  assert.equal(decide({ timeScale: 'fast' }).code, 'INVALID_VALUE')
  assert.equal(decide({ pauseTime: 'x' }).code, 'INVALID_VALUE')
  assert.equal(decide('playing').code, 'INVALID_VALUE')
  assert.equal(decide([1, 2]).code, 'INVALID_VALUE')
})

// ===========================================================================
// Pure policy — A3: World Info authorizes changes, not the container
// ===========================================================================

const WORLD_INFO_PATHS = [
  'atrium.name',
  'atrium.description',
  'atrium.author',
  'atrium.background.type',
  'atrium.background.texture',
  'atrium.navigation.speed.default',
  'atrium.navigation.speed.min',
  'atrium.navigation.speed.max',
  'atrium.navigation.terrainFollowing',
  'atrium.navigation.collision.enabled',
  'atrium.navigation.updateRate.positionInterval',
  'atrium.navigation.updateRate.maxViewRate',
]

test('policy A3: each World Info leaf may change on its own', async () => {
  const world = await createWorld(SPACE)
  const doc = resolveSendTarget(world.som, '__document__')
  const current = world.som.extras

  const values = {
    'atrium.name': 'Renamed',
    'atrium.description': 'New description',
    'atrium.author': 'Someone',
    'atrium.background.type': 'cubemap',
    'atrium.background.texture': 'sky.png',
    'atrium.navigation.speed.default': 2,
    'atrium.navigation.speed.min': 0.25,
    'atrium.navigation.speed.max': 9,
    'atrium.navigation.terrainFollowing': false,
    'atrium.navigation.collision.enabled': true,
    'atrium.navigation.updateRate.positionInterval': 500,
    'atrium.navigation.updateRate.maxViewRate': 30,
  }

  for (const path of WORLD_INFO_PATHS) {
    const proposed = setLeaf(cloneExtras(world), path, values[path])
    const decision = authorizeSend({
      target: doc, nodeName: '__document__', field: 'extras', value: proposed, currentExtras: current,
    })
    assert.equal(decision.ok, true, `World Info leaf "${path}" must be allowed (got ${decision.code})`)
  }
})

test('policy A3: any change outside the World Info list refuses the whole message', async () => {
  const world = await createWorld(SPACE)
  const doc = resolveSendTarget(world.som, '__document__')
  const current = world.som.extras

  const decide = (value) => authorizeSend({
    target: doc, nodeName: '__document__', field: 'extras', value, currentExtras: current,
  })

  // extras.atrium.source
  assert.equal(decide(setLeaf(cloneExtras(world), 'atrium.source', 'https://evil.example.com/x.glb')).code, 'PERMISSION_DENIED')
  // navigation.mode is read-only in the panel
  assert.equal(decide(setLeaf(cloneExtras(world), 'atrium.navigation.mode', ['WALK'])).code, 'PERMISSION_DENIED')
  // an unrelated root key
  assert.equal(decide(setLeaf(cloneExtras(world), 'evil', 'x')).code, 'PERMISSION_DENIED')
  // a key added inside atrium that is not a leaf
  assert.equal(decide(setLeaf(cloneExtras(world), 'atrium.weird', { deep: 1 })).code, 'PERMISSION_DENIED')
  // one authorized change plus one unauthorized change still refuses everything
  const mixed = setLeaf(setLeaf(cloneExtras(world), 'atrium.name', 'ok'), 'evil', 1)
  assert.equal(decide(mixed).code, 'PERMISSION_DENIED')
  // not a plain object
  assert.equal(decide('nope').code, 'PERMISSION_DENIED')
  assert.equal(decide(null).code, 'PERMISSION_DENIED')
  assert.equal(decide([1, 2, 3]).code, 'PERMISSION_DENIED')
  // arrays where objects are expected
  assert.equal(decide(setLeaf(cloneExtras(world), 'atrium.background', [1, 2])).code, 'PERMISSION_DENIED')
  // the document accepts nothing except extras
  assert.equal(authorizeSend({ target: doc, nodeName: '__document__', field: 'translation', value: [0, 0, 0] }).code, 'PERMISSION_DENIED')
  assert.equal(authorizeSend({ target: doc, nodeName: '__document__', field: 'extras.atrium', value: {} }).code, 'PERMISSION_DENIED')
})

test('policy A3: __proto__, depth and size limits are enforced', async () => {
  const world = await createWorld(SPACE)
  const doc = resolveSendTarget(world.som, '__document__')
  const current = world.som.extras

  const decide = (value) => authorizeSend({
    target: doc, nodeName: '__document__', field: 'extras', value, currentExtras: current,
  })

  // Reserved keys at any depth.
  const nested = cloneExtras(world)
  nested.atrium.name = 'ok'
  nested.__proto__ = { polluted: true }
  assert.equal(decide(nested).code, 'PERMISSION_DENIED')

  const deepNested = cloneExtras(world)
  deepNested.atrium.name = 'ok'
  deepNested.atrium.background = { type: 'cubemap' }
  deepNested.atrium.background.constructor = { polluted: true }
  assert.equal(decide(deepNested).code, 'PERMISSION_DENIED')

  // Deeper than 8 levels.
  let deep = { leaf: 1 }
  for (let i = 0; i < 9; i++) deep = { nested: deep }
  assert.equal(decide(deep).code, 'PERMISSION_DENIED')

  // Larger than 64 KiB serialized.
  const big = setLeaf(cloneExtras(world), 'atrium.description', 'x'.repeat(70 * 1024))
  assert.equal(decide(big).code, 'PERMISSION_DENIED')
})

test('policy A3: unchanged unknown keys pass through untouched', async () => {
  const world = await createWorld(SPACE)
  world.som.extras = { ...world.som.extras, atrium: { ...world.som.extras.atrium }, customMeta: { keep: true } }
  const doc = resolveSendTarget(world.som, '__document__')

  const proposed = setLeaf(cloneExtras(world), 'atrium.name', 'Renamed')
  const decision = authorizeSend({
    target: doc, nodeName: '__document__', field: 'extras', value: proposed, currentExtras: world.som.extras,
  })
  assert.equal(decision.ok, true)
  assert.equal(getLeaf(proposed, 'customMeta.keep'), true)
})

test('policy A3: an authorized leaf with a bad value is INVALID_VALUE, not PERMISSION_DENIED', async () => {
  const world = await createWorld(SPACE)
  const doc = resolveSendTarget(world.som, '__document__')
  const current = world.som.extras

  const decide = (path, value) => authorizeSend({
    target: doc, nodeName: '__document__', field: 'extras',
    value: setLeaf(cloneExtras(world), path, value), currentExtras: current,
  })

  assert.equal(decide('atrium.name', 42).code, 'INVALID_VALUE')
  assert.equal(decide('atrium.background.type', 'sphere').code, 'INVALID_VALUE')
  assert.equal(decide('atrium.navigation.terrainFollowing', 'yes').code, 'INVALID_VALUE')
  assert.equal(decide('atrium.navigation.updateRate.maxViewRate', null).code, 'INVALID_VALUE')
  // A deletion of an authorized leaf is a type change → INVALID_VALUE.
  const withoutName = cloneExtras(world)
  delete withoutName.atrium.name
  assert.equal(authorizeSend({
    target: doc, nodeName: '__document__', field: 'extras', value: withoutName, currentExtras: current,
  }).code, 'INVALID_VALUE')
})

// ===========================================================================
// Pure policy — live avatars
// ===========================================================================

test('policy A1: liveAvatarNames reads the sessions map, never a name prefix', () => {
  // §7.3 change (L11/K9): a session is a live avatar only after an accepted
  // avatar `add` recorded `session.avatarNode`; the name alone is not enough.
  const names = liveAvatarNames([
    { avatarNode: { name: 'avatar-12345678' }, avatarNodeName: 'avatar-12345678' },
    { avatarNode: { name: 'avatar-abcdef01' }, avatarNodeName: 'avatar-abcdef01' },
    { avatarNode: null, avatarNodeName: 'avatar-deadbeef' },
    {},
  ])
  assert.deepEqual([...names].sort(), ['avatar-12345678', 'avatar-abcdef01'])
  assert.equal(names.has('avatar-deadbeef'), false,
    'a session with a reserved name but no accepted avatar is not a live avatar')
})

test('policy A1: every send to a live avatar node is refused', async () => {
  const world = await createWorld(SPACE)
  const node = resolveSendTarget(world.som, 'crate-01')
  const avatarNames = new Set(['crate-01'])

  for (const [field, value] of [['translation', [1, 2, 3]], ['visible', false], ['extras.atrium.teleporter.destination', '#']]) {
    const decision = authorizeSend({ target: node, nodeName: 'crate-01', field, value, avatarNames })
    assert.equal(decision.ok, false)
    assert.equal(decision.code, 'PERMISSION_DENIED')
  }
})

// ===========================================================================
// WebSocket traffic — helpers
// ===========================================================================

function sendMessage(ws, message) {
  ws.send(JSON.stringify({ type: 'send', ...message }))
}

// Send a `send` and require the given refusal code: the error must echo the
// request seq, nothing may be broadcast, and the world must not change.
async function expectRefusal(ws, messages, message, expectedCode) {
  const setsBefore = messages.filter(m => m.type === 'set').length
  sendMessage(ws, message)
  const err = await waitFor(messages, m => m.type === 'error' && m.seq === message.seq)
  assert.ok(err, `expected an error for seq ${message.seq} (node "${message.node}", field "${message.field}")`)
  assert.equal(err.code, expectedCode,
    `node "${message.node}" field "${message.field}" should be ${expectedCode}, got ${err.code}`)
  await delay(60)
  const setsAfter = messages.filter(m => m.type === 'set').length
  assert.equal(setsAfter, setsBefore, `refused send must not broadcast (node "${message.node}", field "${message.field}")`)
  return err
}

async function expectAccepted(ws, messages, message, expectedField = message.field) {
  const matches = () => messages.filter(m => m.type === 'set' && m.node === message.node && m.field === expectedField)
  const before = matches().length
  sendMessage(ws, message)
  const deadline = Date.now() + 2000
  while (matches().length === before && Date.now() < deadline) await delay(10)
  const set = matches()[before] ?? null
  assert.ok(set, `expected a NEW set broadcast for node "${message.node}" field "${expectedField}"`)
  const err = messages.find(m => m.type === 'error' && m.seq === message.seq)
  assert.equal(err, undefined, `an accepted send must not error: ${err && err.code}`)
  return set
}

// A document world whose mesh-crate carries a SECOND primitive (both sharing
// mat-crate) so the material chain can be exercised at index 1 and shared-
// material propagation can be observed.
async function documentWithSharedMeshMaterial() {
  const json = await loadDocumentJson(SPACE)
  json.meshes[1].primitives.push({ ...json.meshes[1].primitives[0] })
  json.meshes[0].primitives[0].material = 1     // ground-plane now shares mat-crate
  return json
}

// ===========================================================================
// Open world (file world) — allowed node writes
// ===========================================================================

test('open world: node transform and visibility writes are accepted, stored and broadcast', async () => {
  const { world, port } = await startOpenWorld(SPACE)
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'allow-node')

    let seq = 1
    for (const [field, value] of [
      ['translation', [1, 2, 3]],
      ['rotation', [0.5, 0.5, 0.5, 0.5]],
      ['scale', [2, 2, 2]],
      ['visible', false],
    ]) {
      const set = await expectAccepted(ws, messages, { seq: seq++, node: 'crate-01', field, value })
      assert.deepEqual(set.value, value, `${field} broadcast should echo the value`)
    }

    const node = world.getNode('crate-01')
    assert.deepEqual([...node.translation], [1, 2, 3])
    assert.deepEqual([...node.rotation], [0.5, 0.5, 0.5, 0.5])
    assert.deepEqual([...node.scale], [2, 2, 2])
    assert.equal(node.visible, false, 'visible must be stored')
  } finally {
    ws.close()
    await waitForClose(ws)
  }
})

test('open world: every allowed material property is accepted through the node chain', async () => {
  const world = await createWorldFromDocument(await documentWithSharedMeshMaterial())
  const http = createServer()
  const port = await listen(http)
  const server = createSessionServer({ httpServer: http, maxUsers: 10, world })
  closers.push(() => server.close())

  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'allow-material')

    const M0 = 'mesh.primitives[0].material'
    const cases = [
      [`${M0}.baseColorFactor`, [0.25, 0.5, 0.75, 1]],
      [`${M0}.metallicFactor`, 0.3],
      [`${M0}.roughnessFactor`, 0.7],
      [`${M0}.emissiveFactor`, [0.01, 0.02, 0.03]],
      [`${M0}.alphaMode`, 'BLEND'],
      [`${M0}.alphaCutoff`, 0.4],
      [`${M0}.doubleSided`, true],
    ]

    let seq = 1
    for (const [field, value] of cases) {
      await expectAccepted(ws, messages, { seq: seq++, node: 'crate-01', field, value })
    }

    // A second, in-range primitive index is still allowed.
    await expectAccepted(ws, messages, {
      seq: seq++, node: 'crate-01', field: 'mesh.primitives[1].material.metallicFactor', value: 0.9,
    })

    const material = world.som.getObjectByName('crate-01').mesh.primitives[0].material
    assert.deepEqual([...material.baseColorFactor], [0.25, 0.5, 0.75, 1])
    assert.equal(material.roughnessFactor, 0.7)
    assert.deepEqual([...material.emissiveFactor], [0.01, 0.02, 0.03])
    assert.equal(material.alphaMode, 'BLEND')
    assert.equal(material.alphaCutoff, 0.4)
    assert.equal(material.doubleSided, true)

    // Both primitives share one material instance, so the index-1 write is
    // visible from index 0 as well — and an in-range index is still allowed.
    assert.equal(world.som.getObjectByName('crate-01').mesh.primitives[1].material, material)
    assert.equal(material.metallicFactor, 0.9, 'a shared material carries the index-1 write back to index 0')
  } finally {
    ws.close()
    await waitForClose(ws)
  }
})

test('open world: a shared material edit is visible from every node that uses it (D5)', async () => {
  const world = await createWorldFromDocument(await documentWithSharedMeshMaterial())
  const http = createServer()
  const port = await listen(http)
  const server = createSessionServer({ httpServer: http, maxUsers: 10, world })
  closers.push(() => server.close())

  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'shared-material')

    const crateMaterial  = world.som.getObjectByName('crate-01').mesh.primitives[0].material
    const groundMaterial = world.som.getObjectByName('ground-plane').mesh.primitives[0].material
    assert.equal(crateMaterial, groundMaterial, 'fixture must share one material instance')

    await expectAccepted(ws, messages, {
      seq: 1, node: 'crate-01', field: 'mesh.primitives[0].material.emissiveFactor', value: [1, 0, 0],
    })

    const groundAfter = world.som.getObjectByName('ground-plane').mesh.primitives[0].material
    assert.deepEqual([...groundAfter.emissiveFactor], [1, 0, 0],
      'editing through one node must affect every node sharing the material')
  } finally {
    ws.close()
    await waitForClose(ws)
  }
})

test('open world: the teleporter destination leaf accepts 2048 chars and refuses 2049', async () => {
  const { world, port } = await startOpenWorld(SPACE)
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'teleporter-leaf')

    ws.send(JSON.stringify({
      type: 'add', seq: 1,
      node: { name: 'tp-leaf-node', translation: [0, 0, 0], extras: { atrium: { teleporter: { destination: '/' } } } },
    }))
    const added = await waitFor(messages, m => m.type === 'add' && m.node?.name === 'tp-leaf-node')
    assert.ok(added, 'the teleporter node must be added')

    const okDest = 'a'.repeat(2048)
    const set = await expectAccepted(ws, messages, {
      seq: 2, node: 'tp-leaf-node', field: 'extras.atrium.teleporter.destination', value: okDest,
    })
    assert.equal(set.value, okDest)
    assert.equal(world.getNode('tp-leaf-node').extras.atrium.teleporter.destination, okDest)

    await expectRefusal(ws, messages, {
      seq: 3, node: 'tp-leaf-node', field: 'extras.atrium.teleporter.destination', value: 'a'.repeat(2049),
    }, 'INVALID_VALUE')
    assert.equal(world.getNode('tp-leaf-node').extras.atrium.teleporter.destination, okDest,
      'the refused write must leave the stored value alone')
  } finally {
    ws.close()
    await waitForClose(ws)
  }
})

// ===========================================================================
// Open world — refusals
// ===========================================================================

test('open world: paths that leave the named target are refused', async () => {
  const { world, port } = await startOpenWorld(SPACE)
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'refuse-traversal')

    const before = {
      parentTranslation: [...world.getNode('lamp-01').translation],
      childTranslation:  [...world.getNode('lamp-stand').translation],
    }

    const cases = [
      ['lamp-stand', 'parent.translation', [9, 9, 9]],
      ['lamp-stand', 'parent.extras', { flower: 1 }],
      ['lamp-01', 'children[0].translation', [9, 9, 9]],
      ['crate-01', 'scene.extras', { flower: 1 }],
      ['crate-01', 'mesh._mesh.name', 'x'],
      ['crate-01', 'mesh.primitives[0].material._material.name', 'x'],
      ['crate-01', 'constructor.name', 'x'],
      ['crate-01', '__proto__.polluted', true],
    ]

    let seq = 1
    for (const [node, field, value] of cases) {
      await expectRefusal(ws, messages, { seq: seq++, node, field, value }, 'PERMISSION_DENIED')
    }

    assert.deepEqual([...world.getNode('lamp-01').translation], before.parentTranslation)
    assert.deepEqual([...world.getNode('lamp-stand').translation], before.childTranslation)
    assert.equal({}.polluted, undefined, 'no prototype pollution may occur')
  } finally {
    ws.close()
    await waitForClose(ws)
  }
})

test('open world: non-canonical spellings are refused', async () => {
  const { port } = await startOpenWorld(SPACE)
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'refuse-noncanonical')

    const cases = [
      ['.translation', [1, 2, 3]],
      ['translation.', [1, 2, 3]],
      ['..translation', [1, 2, 3]],
      ['mesh..primitives[0].material.baseColorFactor', [1, 0, 0, 1]],
      ['mesh.primitives[00].material.baseColorFactor', [1, 0, 0, 1]],
      ['extras[x]', { flower: 1 }],
      ['', [1, 2, 3]],
      ['translation[0]', 1],
      ['extras.atrium.teleporter.destination.length', 1],
    ]

    let seq = 1
    for (const [field, value] of cases) {
      if (field === '') {
        // The wire-level protocol validator rejects an empty field before the
        // send handler runs (the pure policy test covers the allowlist itself).
        sendMessage(ws, { seq: seq++, node: 'crate-01', field, value })
        const err = await waitFor(messages, m => m.type === 'error' && m.seq === seq - 1)
        assert.ok(err, 'an empty field must be refused')
        assert.ok(['UNKNOWN_MESSAGE', 'PERMISSION_DENIED'].includes(err.code), `unexpected code ${err.code}`)
        continue
      }
      await expectRefusal(ws, messages, { seq: seq++, node: 'crate-01', field, value }, 'PERMISSION_DENIED')
    }
  } finally {
    ws.close()
    await waitForClose(ws)
  }
})

test('open world: whole extras replacement on a node and wrong target types are refused', async () => {
  const { world, port } = await startOpenWorld(SPACE)
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'refuse-extra-and-type')
    assert.deepEqual(world.getNode('crate-01').extras, {}, 'fixture node starts without extras')

    let seq = 1
    for (const [field, value, code] of [
      ['extras', { flower: 1 }, 'PERMISSION_DENIED'],
      ['extras.atrium', { flower: 1 }, 'PERMISSION_DENIED'],
      ['intensity', 5, 'PERMISSION_DENIED'],
      ['yfov', 1, 'PERMISSION_DENIED'],
      ['mesh.primitives[0].material.extras', {}, 'PERMISSION_DENIED'],
      ['mesh.primitives[5].material.baseColorFactor', [1, 0, 0, 1], 'INVALID_FIELD'],
      ['mesh.primitives[0].material.nope', 1, 'PERMISSION_DENIED'],
    ]) {
      await expectRefusal(ws, messages, { seq: seq++, node: 'crate-01', field, value }, code)
    }

    // A node with no mesh at all cannot be edited through the material chain.
    await expectRefusal(ws, messages, {
      seq: seq++, node: 'lamp-01', field: 'mesh.primitives[0].material.baseColorFactor', value: [1, 0, 0, 1],
    }, 'INVALID_FIELD')

    // The document is not a node.
    await expectRefusal(ws, messages, {
      seq: seq++, node: '__document__', field: 'translation', value: [0, 0, 0],
    }, 'PERMISSION_DENIED')

    // D3 refuses a new name ending in ".light" over the wire, so build the node
    // through the SOM directly and keep the classification check: a node that
    // merely LOOKS like a light alias is classified by its class.
    world.som.createNode({ name: 'X.light', translation: [0, 0, 0] })
    await expectRefusal(ws, messages, { seq: seq++, node: 'X.light', field: 'color', value: [1, 1, 1] }, 'PERMISSION_DENIED')

    // A8 — a rename is now accepted (it used to be PERMISSION_DENIED). Done
    // last, because the rows above address the node by its old name.
    const renamed = await expectAccepted(ws, messages, { seq: seq++, node: 'crate-01', field: 'name', value: 'renamed' })
    assert.equal(renamed.requestSeq, seq - 1, 'the set broadcast echoes the request seq')
    assert.equal(renamed.session, 'refuse-extra-and-type', 'the set broadcast names the requester')
    assert.equal(world.getNode('crate-01'), null, 'the old name no longer resolves')
    assert.equal(world.getNode('renamed').name, 'renamed', 'the node was renamed')

    assert.deepEqual(world.getNode('renamed').extras, {}, 'no extras may have been written')
  } finally {
    ws.close()
    await waitForClose(ws)
  }
})

test('open world: bad values on allowed fields are INVALID_VALUE', async () => {
  const { world, port } = await startOpenWorld(SPACE)
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'refuse-bad-values')
    const M = 'mesh.primitives[0].material'
    const before = [...world.getNode('crate-01').translation]

    let seq = 1
    for (const [field, value] of [
      ['translation', [1, 2]],
      ['translation', [1, 2, 'x']],
      ['translation', 'nope'],
      ['rotation', [1, 2, 3]],
      ['visible', 'yes'],
      ['visible', null],
      ['scale', [1, 1, null]],
      [`${M}.baseColorFactor`, [1, 0, 0]],
      [`${M}.emissiveFactor`, [1, 0]],
      [`${M}.alphaMode`, 'SOLID'],
      [`${M}.doubleSided`, 1],
      [`${M}.metallicFactor`, 'x'],
    ]) {
      await expectRefusal(ws, messages, { seq: seq++, node: 'crate-01', field, value }, 'INVALID_VALUE')
    }

    assert.deepEqual([...world.getNode('crate-01').translation], before,
      'no bad value may have been written')
  } finally {
    ws.close()
    await waitForClose(ws)
  }
})

test('open world: an unknown target is still NODE_NOT_FOUND', async () => {
  const { port } = await startOpenWorld(SPACE)
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'unknown-target')
    ws.send(JSON.stringify({ type: 'send', seq: 77, node: 'ghost', field: 'translation', value: [0, 0, 0] }))
    const err = await waitFor(messages, m => m.type === 'error' && m.seq === 77)
    assert.ok(err, 'an error should arrive')
    assert.equal(err.code, 'NODE_NOT_FOUND')
  } finally {
    ws.close()
    await waitForClose(ws)
  }
})

// ===========================================================================
// Open world (file world) — cameras, lights, animations
// ===========================================================================

test('open world: camera writes are allowed through the qualified alias only', async () => {
  const { world, port } = await startOpenWorld(SPACE_CAM)
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'allow-camera')

    let seq = 1
    for (const [field, value] of [
      ['yfov', 1.0],
      ['znear', 0.2],
      ['type', 'perspective'],
      ['aspectRatio', 1.5],
    ]) {
      await expectAccepted(ws, messages, { seq: seq++, node: 'MainCamera.camera', field, value })
    }

    const camera = world.som.getObjectByName('MainCamera.camera')
    assert.equal(camera.yfov, 1.0)
    assert.equal(camera.znear, 0.2)
    assert.equal(camera.type, 'perspective')
    assert.equal(camera.aspectRatio, 1.5)

    // A node field on a camera, and a camera field on a node, are both refused.
    await expectRefusal(ws, messages, { seq: seq++, node: 'MainCamera.camera', field: 'translation', value: [0, 0, 0] }, 'PERMISSION_DENIED')
    await expectRefusal(ws, messages, { seq: seq++, node: 'MainCamera', field: 'yfov', value: 1 }, 'PERMISSION_DENIED')
    await expectRefusal(ws, messages, { seq: seq++, node: 'MainCamera.camera', field: 'type', value: 'isometric' }, 'INVALID_VALUE')
    await expectRefusal(ws, messages, { seq: seq++, node: 'MainCamera.camera', field: 'yfov', value: 'one' }, 'INVALID_VALUE')
  } finally {
    ws.close()
    await waitForClose(ws)
  }
})

test('document world: a camera addressed by its bare glTF name is refused', async () => {
  const world = await createWorldFromDocument(await documentWithAliasedAssets())
  const http = createServer()
  const port = await listen(http)
  const server = createSessionServer({ httpServer: http, maxUsers: 10, world })
  closers.push(() => server.close())

  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'bare-camera-name')

    await expectAccepted(ws, messages, { seq: 1, node: 'MainCamera.camera', field: 'yfov', value: 1.1 })
    await expectRefusal(ws, messages, { seq: 2, node: 'MainCameraLens', field: 'yfov', value: 1.2 }, 'PERMISSION_DENIED')
    assert.equal(world.som.getObjectByName('MainCamera.camera').yfov, 1.1)
  } finally {
    ws.close()
    await waitForClose(ws)
  }
})

test('open world: light writes are allowed through the qualified alias only', async () => {
  const { world, port } = await startOpenWorld(SPACE_LIGHT)
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'allow-light')

    let seq = 1
    await expectAccepted(ws, messages, { seq: seq++, node: 'Sun.light', field: 'intensity', value: 7 })
    await expectAccepted(ws, messages, { seq: seq++, node: 'Sun.light', field: 'color', value: [0.2, 0.4, 0.8] })
    await expectAccepted(ws, messages, { seq: seq++, node: 'LampGlow.light', field: 'range', value: null })
    await expectAccepted(ws, messages, { seq: seq++, node: 'Sun.light', field: 'type', value: 'spot' })

    const sun = world.som.getObjectByName('Sun.light')
    assert.equal(sun.intensity, 7)
    assert.deepEqual([...sun.color], [0.2, 0.4, 0.8])
    assert.equal(world.som.getObjectByName('LampGlow.light').range, null)

    // node + light field, and light + node field
    await expectRefusal(ws, messages, { seq: seq++, node: 'Sun', field: 'intensity', value: 1 }, 'PERMISSION_DENIED')
    await expectRefusal(ws, messages, { seq: seq++, node: 'Sun.light', field: 'translation', value: [0, 0, 0] }, 'PERMISSION_DENIED')
    await expectRefusal(ws, messages, { seq: seq++, node: 'Sun.light', field: 'type', value: 'soft' }, 'INVALID_VALUE')
    await expectRefusal(ws, messages, { seq: seq++, node: 'Sun.light', field: 'range', value: 'five' }, 'INVALID_VALUE')
    await expectRefusal(ws, messages, { seq: seq++, node: 'Sun.light', field: 'color', value: [1, 1] }, 'INVALID_VALUE')
  } finally {
    ws.close()
    await waitForClose(ws)
  }
})

test('document world: a light addressed by its bare alias is refused', async () => {
  const world = await createWorldFromDocument(await documentWithAliasedLight())
  const http = createServer()
  const port = await listen(http)
  const server = createSessionServer({ httpServer: http, maxUsers: 10, world })
  closers.push(() => server.close())

  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'bare-light-name')
    await expectAccepted(ws, messages, { seq: 1, node: 'Sun.light', field: 'intensity', value: 4 })
    await expectRefusal(ws, messages, { seq: 2, node: 'AliasGlow', field: 'intensity', value: 5 }, 'PERMISSION_DENIED')
    assert.equal(world.som.getObjectByName('Sun.light').intensity, 4)
  } finally {
    ws.close()
    await waitForClose(ws)
  }
})

test('open world: animation playback is allowed, and only playback', async () => {
  const { world, port } = await startOpenWorld(SPACE_ANIM)
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'allow-animation')

    const playback = {
      playing: true, paused: false, loop: true, autoStart: false,
      timeScale: 1.25, startTime: 0, startWallClock: 1700000000000, pauseTime: null,
    }
    await expectAccepted(ws, messages, { seq: 1, node: 'CrateRotate', field: 'playback', value: playback })

    const stored = world.som.getObjectByName('CrateRotate').playback
    assert.equal(stored.playing, true)
    assert.equal(stored.loop, true)
    assert.equal(stored.timeScale, 1.25)

    await expectRefusal(ws, messages, { seq: 2, node: 'CrateRotate', field: 'playback', value: { playing: true, duration: 3 } }, 'INVALID_VALUE')
    await expectRefusal(ws, messages, { seq: 3, node: 'CrateRotate', field: 'playback', value: { playing: 'yes' } }, 'INVALID_VALUE')
    await expectRefusal(ws, messages, { seq: 4, node: 'CrateRotate', field: 'duration', value: 5 }, 'PERMISSION_DENIED')
    await expectRefusal(ws, messages, { seq: 5, node: 'CrateRotate', field: 'name', value: 'x' }, 'PERMISSION_DENIED')
  } finally {
    ws.close()
    await waitForClose(ws)
  }
})

// ===========================================================================
// Document world — World Info
// ===========================================================================

async function startOpenDocumentWorld(json) {
  const world = await createWorldFromDocument(json)
  const http = createServer()
  const port = await listen(http)
  const server = createSessionServer({ httpServer: http, maxUsers: 10, world })
  closers.push(() => server.close())
  return { world, port }
}

test('document world: every World Info leaf may be changed through __document__/extras', async () => {
  const { world, port } = await startOpenDocumentWorld(await loadDocumentJson(SPACE))
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'world-info-allowed')

    const values = {
      'atrium.name': 'Renamed World',
      'atrium.description': 'A new description',
      'atrium.author': 'Project Atrium',
      'atrium.background.type': 'cubemap',
      'atrium.background.texture': 'sky.png',
      'atrium.navigation.speed.default': 2.5,
      'atrium.navigation.speed.min': 0.25,
      'atrium.navigation.speed.max': 9,
      'atrium.navigation.terrainFollowing': false,
      'atrium.navigation.collision.enabled': true,
      'atrium.navigation.updateRate.positionInterval': 500,
      'atrium.navigation.updateRate.maxViewRate': 30,
    }

    let seq = 1
    for (const path of WORLD_INFO_PATHS) {
      const proposed = setLeaf(cloneExtras(world), path, values[path])
      const set = await expectAccepted(ws, messages, {
        seq: seq++, node: '__document__', field: 'extras', value: proposed,
      })
      assert.deepEqual(set.value, proposed, 'the broadcast echoes the value as received')
      assert.deepEqual(getLeaf(world.som.extras, path), values[path], `${path} must be stored`)
    }

    // The whole set of keys this task does not know about is still intact.
    assert.equal(getLeaf(world.som.extras, 'atrium.navigation.mode.length'), 4)
  } finally {
    ws.close()
    await waitForClose(ws)
  }
})

test('document world: creating a missing intermediate object counts as its leaf', async () => {
  const { world, port } = await startOpenDocumentWorld(await loadDocumentJson(SPACE))
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'world-info-new-object')
    assert.equal(world.som.extras.atrium.background, undefined, 'the fixture has no background')

    const proposed = setLeaf(cloneExtras(world), 'atrium.background.type', 'equirectangular')
    await expectAccepted(ws, messages, { seq: 1, node: '__document__', field: 'extras', value: proposed })
    assert.equal(world.som.extras.atrium.background.type, 'equirectangular')
  } finally {
    ws.close()
    await waitForClose(ws)
  }
})

test('document world: an unknown root key survives a World Info edit', async () => {
  const { world, port } = await startOpenDocumentWorld(await loadDocumentJson(SPACE))
  world.som.extras = { ...world.som.extras, customMeta: { keep: true, nested: { deep: 1 } } }

  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'world-info-unknown-key')

    const proposed = setLeaf(cloneExtras(world), 'atrium.name', 'Renamed')
    await expectAccepted(ws, messages, { seq: 1, node: '__document__', field: 'extras', value: proposed })

    assert.equal(world.som.extras.atrium.name, 'Renamed')
    assert.deepEqual(world.som.extras.customMeta, { keep: true, nested: { deep: 1 } },
      'keys this task does not know about must pass through untouched')
  } finally {
    ws.close()
    await waitForClose(ws)
  }
})

test('document world: World Info changes outside the list are refused', async () => {
  const { world, port } = await startOpenDocumentWorld(await loadDocumentJson(SPACE))
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'world-info-refused')

    const before = JSON.stringify(world.som.extras)
    let seq = 1

    // Adding/changing/deleting extras.atrium.source (S2 catches it first).
    await expectRefusal(ws, messages, {
      seq: seq++, node: '__document__', field: 'extras',
      value: setLeaf(cloneExtras(world), 'atrium.source', 'https://evil.example.com/x.glb'),
    }, 'PERMISSION_DENIED')

    const removal = cloneExtras(world)
    delete removal.atrium.name
    await expectRefusal(ws, messages, { seq: seq++, node: '__document__', field: 'extras', value: removal }, 'INVALID_VALUE')

    // An unrelated root key.
    await expectRefusal(ws, messages, {
      seq: seq++, node: '__document__', field: 'extras',
      value: setLeaf(cloneExtras(world), 'evil', 'x'),
    }, 'PERMISSION_DENIED')

    // navigation.mode is read-only in the panel.
    await expectRefusal(ws, messages, {
      seq: seq++, node: '__document__', field: 'extras',
      value: setLeaf(cloneExtras(world), 'atrium.navigation.mode', ['WALK']),
    }, 'PERMISSION_DENIED')

    // A nested __proto__ (an own property, as JSON.parse produces).
    const protoPayload = JSON.parse(`{"atrium":${JSON.stringify(cloneExtras(world).atrium)},"__proto__":{"polluted":true}}`)
    await expectRefusal(ws, messages, {
      seq: seq++, node: '__document__', field: 'extras', value: protoPayload,
    }, 'PERMISSION_DENIED')

    // Deeper than 8 levels.
    let deep = { leaf: 1 }
    for (let i = 0; i < 10; i++) deep = { nested: deep }
    await expectRefusal(ws, messages, { seq: seq++, node: '__document__', field: 'extras', value: deep }, 'PERMISSION_DENIED')

    // Larger than 64 KiB serialized.
    await expectRefusal(ws, messages, {
      seq: seq++, node: '__document__', field: 'extras',
      value: setLeaf(cloneExtras(world), 'atrium.description', 'x'.repeat(70 * 1024)),
    }, 'PERMISSION_DENIED')

    // Not a plain object.
    await expectRefusal(ws, messages, { seq: seq++, node: '__document__', field: 'extras', value: 'nope' }, 'PERMISSION_DENIED')
    await expectRefusal(ws, messages, { seq: seq++, node: '__document__', field: 'extras', value: [1, 2] }, 'PERMISSION_DENIED')

    // An authorized leaf with a bad value.
    await expectRefusal(ws, messages, {
      seq: seq++, node: '__document__', field: 'extras',
      value: setLeaf(cloneExtras(world), 'atrium.name', 42),
    }, 'INVALID_VALUE')

    // extras is the only document field.
    await expectRefusal(ws, messages, { seq: seq++, node: '__document__', field: 'extras.atrium', value: {} }, 'PERMISSION_DENIED')

    assert.equal(JSON.stringify(world.som.extras), before, 'the document extras must be untouched')
    assert.equal({}.polluted, undefined, 'no prototype pollution may occur')
  } finally {
    ws.close()
    await waitForClose(ws)
  }
})

test('document world: the last writer wins and the broadcast echoes the value as received', async () => {
  const { world, port } = await startOpenDocumentWorld(await loadDocumentJson(SPACE))
  const a = await connect(port)
  const b = await connect(port)
  try {
    await hello(a.ws, a.messages, 'writer-aaa-1')
    await hello(b.ws, b.messages, 'writer-bbb-2')
    await waitFor(b.messages, isType('join'))

    const first  = setLeaf(cloneExtras(world), 'atrium.name', 'First')
    await expectAccepted(a.ws, a.messages, { seq: 1, node: '__document__', field: 'extras', value: first })
    assert.equal(world.som.extras.atrium.name, 'First')

    const second = setLeaf(cloneExtras(world), 'atrium.name', 'Second')
    await expectAccepted(b.ws, b.messages, { seq: 1, node: '__document__', field: 'extras', value: second })

    assert.equal(world.som.extras.atrium.name, 'Second', 'last writer wins — no server-side merge')
    const echo = b.messages.filter(m => m.type === 'set' && m.node === '__document__').pop()
    assert.deepEqual(echo.value, second, 'the broadcast echoes the value as received')
  } finally {
    a.ws.close()
    b.ws.close()
    await Promise.all([waitForClose(a.ws), waitForClose(b.ws)])
  }
})

// ===========================================================================
// Replay: the exact messages the inspector panels and AtriumClient emit
// ===========================================================================

function attachCapturingClient(som) {
  const client = new AtriumClient({})
  client._som = som
  client._connected = true
  client._avatarNodeName = null
  const captured = []
  client._wsSend = (message) => { captured.push(message) }
  client._attachMutationListeners()
  return { client, captured }
}

// Build the wire messages by performing the very same SOM mutations the
// inspector panels and the client SOM APIs perform, with the real
// AtriumClient listeners turning them into `send` messages.
async function clientMessagesFor(gltfPath, mutate) {
  const world = await createWorld(gltfPath)
  const { captured } = attachCapturingClient(world.som)
  mutate(world.som)
  return captured
}

async function replayAll(gltfPath, mutate) {
  const sent = await clientMessagesFor(gltfPath, mutate)
  assert.ok(sent.length > 0, 'the client must have produced at least one message')
  for (const message of sent) {
    assert.equal(message.type, 'send')
    assert.equal(typeof message.field, 'string')
  }

  const { port } = await startOpenWorld(gltfPath)
  const { ws, messages: received } = await connect(port)
  try {
    await hello(ws, received, 'replay')
    let seq = 1000
    for (const message of sent) {
      await expectAccepted(ws, received, {
        seq: seq++, node: message.node, field: message.field, value: message.value,
      })
    }
  } finally {
    ws.close()
    await waitForClose(ws)
  }
  return sent
}

test('replay: PropertySheet node and material edits are accepted verbatim', async () => {
  const messages = await replayAll(SPACE, (som) => {
    const node = som.getNodeByName('crate-01')
    node.translation = [4, 0, 2]                       // transform row
    node.visible = false                                // visibility checkbox
    const material = node.mesh.primitives[0].material
    material.baseColorFactor = [0.1, 0.2, 0.3, 1]      // colour picker
    material.alphaMode = 'BLEND'                        // alpha-mode dropdown
  })

  const fields = messages.map(m => `${m.node}|${m.field}`)
  assert.ok(fields.includes('crate-01|translation'), `missing transform write: ${fields}`)
  assert.ok(fields.includes('crate-01|visible'))
  assert.ok(fields.includes('crate-01|mesh.primitives[0].material.baseColorFactor'))
  assert.ok(fields.includes('crate-01|mesh.primitives[0].material.alphaMode'))
})

test('replay: WorldInfoPanel setExtrasAtrium writes are accepted verbatim', async () => {
  const messages = await clientMessagesFor(SPACE, (som) => {
    som.setExtrasAtrium('name', 'Replayed World')      // Name text field
    som.setExtrasAtrium('background.type', 'cubemap')  // Background type dropdown
  })
  assert.ok(messages.every(m => m.node === '__document__' && m.field === 'extras'),
    'the document listener must address __document__ / extras')

  const { port } = await startOpenWorld(SPACE)
  const { ws, messages: received } = await connect(port)
  try {
    await hello(ws, received, 'replay-world-info')
    await expectAccepted(ws, received, { seq: 1, node: '__document__', field: 'extras', value: messages[messages.length - 1].value })
  } finally {
    ws.close()
    await waitForClose(ws)
  }
})

test('replay: AnimationsPanel playback writes are accepted verbatim', async () => {
  const messages = await replayAll(SPACE_ANIM, (som) => {
    som.getObjectByName('CrateRotate').playback = {
      playing: true, paused: false, loop: true, autoStart: false,
      timeScale: 1, startTime: 0, startWallClock: 1700000001000, pauseTime: null,
    }
  })
  assert.deepEqual(messages.map(m => `${m.node}|${m.field}`), ['CrateRotate|playback'])
})

test('replay: camera and light API writes are accepted verbatim', async () => {
  const cameraMessages = await replayAll(SPACE_CAM, (som) => {
    som.getObjectByName('MainCamera.camera').yfov = 0.9        // PropertySheet camera row
    som.getObjectByName('MainCamera.camera').aspectRatio = 1.6 // client SOM camera API
  })
  assert.deepEqual(cameraMessages.map(m => `${m.node}|${m.field}`),
    ['MainCamera.camera|yfov', 'MainCamera.camera|aspectRatio'])

  const lightMessages = await replayAll(SPACE_LIGHT, (som) => {
    som.getObjectByName('Sun.light').intensity = 3.5
    som.getObjectByName('LampGlow.light').range = null
  })
  assert.deepEqual(lightMessages.map(m => `${m.node}|${m.field}`),
    ['Sun.light|intensity', 'LampGlow.light|range'])
})

// ===========================================================================
// Owner world — save notifications, live avatars, the gate
// ===========================================================================

test('owner world: an accepted send notifies autosave; a refused one does not', async () => {
  const world = await createWorld(SPACE)
  let saves = 0
  const { port } = await startHandlerWorld({
    world, ownerUserId: 'owner-001', onSaveableMutation: () => { saves++ },
  })

  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'saveable')

    await expectAccepted(ws, messages, { seq: 1, node: 'crate-01', field: 'translation', value: [3, 3, 3] })
    await delay(50)
    assert.equal(saves, 1, 'an accepted mutation must notify autosave')

    await expectRefusal(ws, messages, { seq: 2, node: 'crate-01', field: 'extras', value: { flower: 1 } }, 'PERMISSION_DENIED')
    await expectRefusal(ws, messages, { seq: 3, node: 'crate-01', field: 'parent.translation', value: [1, 1, 1] }, 'PERMISSION_DENIED')
    await delay(50)
    assert.equal(saves, 1, 'a refused mutation must not notify autosave')
  } finally {
    ws.close()
    await waitForClose(ws)
  }
})

test('owner world: sends to a live avatar are refused for the owner too', async () => {
  const world = await createWorld(SPACE)
  const { port } = await startHandlerWorld({ world, ownerUserId: 'owner-001' })

  const a = await connect(port)
  const b = await connect(port)
  try {
    const helloA = await hello(a.ws, a.messages, 'owner-aaaa-1')
    const helloB = await hello(b.ws, b.messages, 'owner-bbbb-2')
    const avatarA = helloA.avatarNodeName
    const avatarB = helloB.avatarNodeName

    // Bring both avatar nodes into the world so the target really resolves.
    // An avatar add is not echoed to its own sender, so wait on the world.
    a.ws.send(JSON.stringify({ type: 'add', seq: 1, id: helloA.id, node: { name: avatarA, translation: [0, 1, 0] } }))
    b.ws.send(JSON.stringify({ type: 'add', seq: 1, id: helloB.id, node: { name: avatarB, translation: [0, 2, 0] } }))
    let waited = 0
    while ((world.getNode(avatarA) === null || world.getNode(avatarB) === null) && waited < 2000) {
      await delay(20)
      waited += 20
    }
    assert.ok(world.getNode(avatarA) !== null, 'avatar A must exist')
    assert.ok(world.getNode(avatarB) !== null, 'avatar B must exist')

    // The owner (session A) writes to its own avatar and to B's avatar.
    await expectRefusal(a.ws, a.messages, { seq: 10, node: avatarA, field: 'translation', value: [9, 9, 9] }, 'PERMISSION_DENIED')
    await expectRefusal(a.ws, a.messages, { seq: 11, node: avatarB, field: 'translation', value: [9, 9, 9] }, 'PERMISSION_DENIED')
    await expectRefusal(a.ws, a.messages, { seq: 12, node: avatarA, field: 'extras', value: { displayName: 'Hack' } }, 'PERMISSION_DENIED')

    assert.deepEqual([...world.getNode(avatarA).translation], [0, 1, 0], 'the avatar must not move')
    assert.deepEqual([...world.getNode(avatarB).translation], [0, 2, 0], "the other avatar must not move")

    // A normal node is still writable by the owner.
    await expectAccepted(a.ws, a.messages, { seq: 13, node: 'crate-01', field: 'visible', value: false })
  } finally {
    a.ws.close()
    b.ws.close()
    await Promise.all([waitForClose(a.ws), waitForClose(b.ws)])
  }
})

test('owner world: a non-owner session is refused by the mutation gate', async () => {
  const world = await createWorld(SPACE)
  const { port } = await startHandlerWorld({ world, ownerUserId: 'owner-001', connectAs: 'intruder-002' })

  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'non-owner')

    await expectRefusal(ws, messages, { seq: 1, node: 'crate-01', field: 'translation', value: [1, 1, 1] }, 'PERMISSION_DENIED')
    await expectRefusal(ws, messages, { seq: 2, node: 'crate-01', field: 'extras', value: { flower: 1 } }, 'PERMISSION_DENIED')
    await expectRefusal(ws, messages, { seq: 3, node: '__document__', field: 'extras', value: cloneExtras(world) }, 'PERMISSION_DENIED')
  } finally {
    ws.close()
    await waitForClose(ws)
  }
})

test('read-only world: every send is refused by the existing gate', async () => {
  const world = await createWorld(SPACE)
  const { port } = await startHandlerWorld({
    world, ownerUserId: 'owner-001', mutationPolicy: 'read-only',
  })

  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'read-only')
    const before = [...world.getNode('crate-01').translation]

    await expectRefusal(ws, messages, { seq: 1, node: 'crate-01', field: 'translation', value: [1, 1, 1] }, 'PERMISSION_DENIED')
    await expectRefusal(ws, messages, { seq: 2, node: 'crate-01', field: 'extras', value: { flower: 1 } }, 'PERMISSION_DENIED')
    await expectRefusal(ws, messages, { seq: 3, node: '__document__', field: 'extras', value: cloneExtras(world) }, 'PERMISSION_DENIED')

    assert.deepEqual([...world.getNode('crate-01').translation], before)
  } finally {
    ws.close()
    await waitForClose(ws)
  }
})

