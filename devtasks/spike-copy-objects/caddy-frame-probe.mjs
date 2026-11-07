// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// copy-objects: the operator's question before DEV (passdown 11-06 evening §4).
// Does anything between the browser and Atrium's Node process cap a WebSocket
// frame? Connects as an anonymous visitor, says hello, then sends ONE junk
// message of 1.2 MiB (an unknown type: the server refuses it, nothing is
// stored), preceded by a small one as a control. Usage:
//   node devtasks/spike-copy-objects/caddy-frame-probe.mjs wss://dev.ewwb.dev/apps/client
import { createRequire } from 'node:module'
import path from 'node:path'
const WebSocket = createRequire(path.resolve('packages/server/package.json'))('ws')
const url = process.argv[2]
const ws = new WebSocket(url)
const got = []
let closed = null
ws.on('message', (m) => { try { got.push(JSON.parse(m)) } catch {} })
ws.on('close', (code) => { closed = code })
ws.on('error', (e) => console.log('socket error:', e.message))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (f, ms) => { const end = Date.now() + ms; while (Date.now() < end && !f()) await wait(20); return f() }
await new Promise((r) => ws.once('open', r))
ws.send(JSON.stringify({ type: 'hello', id: 'frame-probe-' + Date.now(), capabilities: { tick: { interval: 5000 } } }))
if (!await until(() => got.some((m) => m.type === 'hello'), 5000)) { console.log('no hello reply; stopping'); process.exit(1) }
const errors = () => got.filter((m) => m.type === 'error').length
ws.send(JSON.stringify({ type: 'frame-probe', pad: 'x'.repeat(1000) }))
const control = await until(() => errors() >= 1, 5000)
console.log(`control (1 KB junk): ${control ? 'the server answered' : 'no answer'}`)
const big = JSON.stringify({ type: 'frame-probe', pad: 'x'.repeat(1.2 * 1048576) })
ws.send(big)
const answered = await until(() => errors() >= 2 || closed !== null, 10000)
await wait(300)
console.log(`big (${(Buffer.byteLength(big) / 1048576).toFixed(2)} MiB junk): ${errors() >= 2 ? 'the server answered' : 'no answer'}; socket ${closed === null ? 'still open' : `closed with ${closed}`}`)
console.log(errors() >= 2
  ? 'VERDICT: the frame reached Atrium. Nothing in front of it caps frames at 1.2 MiB.'
  : closed !== null ? 'VERDICT: something closed the socket before Atrium answered (a cap in front of it, or Atrium\'s own).'
  : answered ? '' : 'VERDICT: no answer and no close in 10 s: inconclusive, tell Claude.')
ws.close(); process.exit(0)
