// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import Ajv from 'ajv'

import helloClient from './schemas/hello.client.json' with { type: 'json' }
import helloServer from './schemas/hello.server.json' with { type: 'json' }
import ping from './schemas/ping.json' with { type: 'json' }
import pong from './schemas/pong.json' with { type: 'json' }
import tick from './schemas/tick.json' with { type: 'json' }
import errorMsg from './schemas/error.json' with { type: 'json' }
import send from './schemas/send.json' with { type: 'json' }
import set from './schemas/set.json' with { type: 'json' }
import addClient from './schemas/add.client.json' with { type: 'json' }
import addServer from './schemas/add.server.json' with { type: 'json' }
import removeClient from './schemas/remove.client.json' with { type: 'json' }
import removeServer from './schemas/remove.server.json' with { type: 'json' }
import join from './schemas/join.json' with { type: 'json' }
import leave from './schemas/leave.json' with { type: 'json' }
import viewClient from './schemas/view-client.json' with { type: 'json' }
import viewServer from './schemas/view-server.json' with { type: 'json' }
import somDump from './schemas/som-dump.server.json' with { type: 'json' }
import scriptHost from './schemas/script-host.server.json' with { type: 'json' }

const ajv = new Ajv({ strict: false })

const validators = {
  'hello:client': ajv.compile(helloClient),
  'hello:server': ajv.compile(helloServer),
  'ping':         ajv.compile(ping),
  'pong':         ajv.compile(pong),
  'tick':         ajv.compile(tick),
  'error':        ajv.compile(errorMsg),
  'send':         ajv.compile(send),
  'set':          ajv.compile(set),
  'add:client':   ajv.compile(addClient),
  'add:server':   ajv.compile(addServer),
  'remove:client': ajv.compile(removeClient),
  'remove:server': ajv.compile(removeServer),
  'join':         ajv.compile(join),
  'leave':        ajv.compile(leave),
  'view:client':  ajv.compile(viewClient),
  'view:server':  ajv.compile(viewServer),
  'som-dump':     ajv.compile(somDump),
  'script-host':  ajv.compile(scriptHost),
}

/**
 * Validate a SOP message.
 * @param {'client'|'server'} direction - who sent the message
 * @param {object} message - the parsed message object
 * @returns {{ valid: boolean, errors: array }}
 */
export function validate(direction, message) {
  if (!message || typeof message.type !== 'string') {
    return { valid: false, errors: [{ message: 'Message must have a type field' }] }
  }

  const directional = message.type === 'hello' || message.type === 'view' ||
    message.type === 'add' || message.type === 'remove'
  const key = directional ? `${message.type}:${direction}` : message.type

  const validator = validators[key]

  if (!validator) {
    return { valid: false, errors: [{ message: `Unknown message type: ${message.type}` }] }
  }

  const valid = validator(message)
  return { valid, errors: validator.errors ?? [] }
}

export const messageTypes = [
  'hello', 'ping', 'pong', 'tick', 'error',
  'send', 'set', 'add', 'remove', 'join', 'leave', 'view', 'script-host'
]

export { validators }