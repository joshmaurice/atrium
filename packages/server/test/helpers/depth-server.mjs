// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// depth-server — the child-process Atrium server for message-depth.test.js.
//
// A hostile message that got through the guard would exit this process (an
// unhandled rejection from the async listener, or a stack overflow), so the
// test runs the server here and watches THIS child, not the test runner.
//
// It prints `DEPTH_SERVER_PORT <port>` on stdout once it is listening (port 0,
// assigned by the OS), and answers GET /__nodes with the world's node names so
// the test can check that a refused message changed no world state.
//
// Environment:
//   DEPTH_SERVER_OWNER        worldOwnerUserId ('' = null: an open world)
//   DEPTH_SERVER_SOCKET_USER  the upgrade userId for every connection ('' = null)
//   DEPTH_SERVER_THROW        'addNode' → world.addNode throws (case (g))

import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { WebSocketServer } from 'ws'
import { createWorld } from '../../src/world.js'
import { attachSessionHandlers } from '../../src/session.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SPACE = resolve(__dirname, '../../../../tests/fixtures/space.gltf')

const owner = process.env.DEPTH_SERVER_OWNER || null
const socketUser = process.env.DEPTH_SERVER_SOCKET_USER || null
const throwPath = process.env.DEPTH_SERVER_THROW || ''

const world = await createWorld(SPACE)

if (throwPath === 'addNode') {
  // Case (g): a handler path that throws, after the guard, so the fail-closed
  // boundary is what the test exercises.
  world.addNode = () => { throw new Error('stub addNode failure') }
}

const http = createServer((req, res) => {
  if (req.url === '/__nodes') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(world.listNodeNames()))
    return
  }
  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('not found')
})

const wss = new WebSocketServer({ noServer: true })
const sessions = new Map()
const presence = { add() {}, remove() { return null }, list() { return [] }, setPosition() {} }

attachSessionHandlers({ wss, world, sessions, presence, worldOwnerUserId: owner })

http.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req, socketUser)
  })
})

http.listen(0, '127.0.0.1', () => {
  console.log(`DEPTH_SERVER_PORT ${http.address().port}`)
})
