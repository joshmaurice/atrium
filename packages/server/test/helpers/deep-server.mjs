// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// deep-server.mjs — V9's server, in its OWN PROCESS. Not a test file.
//
// Why a child process: round 4's recursive `hasForbiddenKey` threw
// `RangeError: Maximum call stack size exceeded` on a behaviour nested 6,500
// deep, nothing caught it, and the process EXITED — every world on it dropped.
// A regression that kills the server must fail the test as the CHILD's exit,
// never as the test runner's, so the server that a deep `send` is aimed at runs
// here.
//
// Usage: node deep-server.mjs <world.gltf> [--throw-check]
//   --throw-check  make one of the checks `authorizeSend` runs throw, to prove
//                  the send path FAILS CLOSED instead of taking the process
//                  down (V9's "the value could not be checked").
//
// It prints `PORT <n>` on stdout once it is listening, then serves until it is
// killed.

import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { createWorld } from '../../src/world.js'
import { attachSessionHandlers } from '../../src/session.js'

const worldPath = process.argv[2]
const throwCheck = process.argv.includes('--throw-check')

const world = await createWorld(worldPath)

// `behaviorCountIn` (the 64-behaviour cap) is reached from inside
// `authorizeSend`, and it is imported by `session.js`, so it cannot be stubbed
// directly. The narrowest seam inside the check that the handler can reach is
// `som.objectIdInUse`, which only the set-once `objectId` leaf's check calls.
if (throwCheck) {
  // ONE-SHOT: the first check that reaches it throws, so the same send can be
  // retried as the "the process keeps working" assertion.
  let thrown = false
  world.som.objectIdInUse = (id) => {
    if (thrown) return false
    thrown = true
    throw new Error('the check blew up')
  }
}

const http = createServer()
const wss = new WebSocketServer({ noServer: true })
attachSessionHandlers({
  wss,
  world,
  sessions: new Map(),
  presence: { add() {}, remove() { return null }, list() { return [] }, setPosition() {} },
  worldOwnerUserId: 'user-a',
})
http.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, 'user-a'))
})

http.listen(0, '127.0.0.1', () => {
  process.stdout.write(`PORT ${http.address().port}\n`)
})

process.on('uncaughtException', (error) => {
  // The child reports its own death and exits non-zero, so a test can see it.
  process.stdout.write(`UNCAUGHT ${error?.message ?? error}\n`)
  process.exit(7)
})
