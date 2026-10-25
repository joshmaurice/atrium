// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// depth-recorder — §6.2 measurement. TEST CODE ONLY, loaded with
// `node --import` (see message-depth-measure.test.js), never imported by
// packages/server/src.
//
// packages/server/src carries ONLY G1 (the walk + the guard) and G2 (the
// try/catch): no test-mode branch, no environment flag, no hook. The
// measurement lives here instead, wrapping the server's inbound messages from
// the outside at the WebSocketServer connection boundary: every server-side
// connection gets one extra `message` listener (added before the session
// handlers are attached, so it sees each message first), and each parsed
// message's measured depth and type are appended to $ATRIUM_DEPTH_RECORD, one
// JSON line per message.
//
// The variable is unset outside the measurement and this file is not imported
// then, so nothing here runs in a normal server or a normal test run.

import { appendFileSync } from 'node:fs'
import { WebSocketServer } from 'ws'
import { messageDepth } from '../../src/message-depth.js'

const recordFile = process.env.ATRIUM_DEPTH_RECORD ?? null

function record(raw) {
  if (recordFile === null) return
  let msg
  try {
    msg = JSON.parse(raw)
  } catch {
    // Not JSON: the server's own parse refuses it, so it is not a message.
    return
  }
  const type = typeof msg?.type === 'string' ? JSON.stringify(msg.type) : 'null'
  const depth = messageDepth(msg)
  try {
    appendFileSync(recordFile, `{"type":${type},"depth":${depth}}\n`)
  } catch {
    // Measurement only: never let it disturb the server under test.
  }
}

const originalEmit = WebSocketServer.prototype.emit

WebSocketServer.prototype.emit = function (event, ...args) {
  const ws = args[0]
  if (event === 'connection' && ws && typeof ws.on === 'function' &&
      ws.listenerCount('message') === 0) {
    // Once per socket: a `connection` event that carries a socket already
    // wrapped (the server emits it, and a suite may re-emit it) must not add
    // a second listener, which would double every recorded count.
    ws.on('message', (raw) => record(raw))
  }
  return originalEmit.apply(this, [event, ...args])
}
