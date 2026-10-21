// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// model-shared-transfers.test.js — Z3/L4a: one transfer limiter per page, and
// dependency transfers shared between the jobs that want them while they are in
// flight. A stub `fetch` records every request, the ledger, and each job's own
// byte count, so "one request, charged to each budget, once to the ledger" is
// observable rather than argued.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchModel, createWorldLedger, createJobDeadline, createSharedTasks, createTransferLimiter,
  MODEL_LIMITS,
} from '../src/model-fetch.js'

const UTF8 = new TextEncoder()
const bytes = (s) => UTF8.encode(s)
const GLB = Uint8Array.from([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0])
const glbBytes = (extra = 8) => {
  const out = new Uint8Array(GLB.length + extra)
  out.set(GLB, 0)
  return out
}

/** A response whose body is served in `chunk`-sized pieces; records cancels. */
function response(body, { status = 200, redirected = false, url = '', chunk = 0 } = {}) {
  const data = body instanceof Uint8Array ? body : bytes(body)
  const record = { cancelled: false }
  const stream = new ReadableStream({
    start(controller) {
      const size = chunk > 0 ? chunk : data.length || 1
      for (let at = 0; at < data.length; at += size) controller.enqueue(data.subarray(at, at + size))
      controller.close()
    },
    cancel() { record.cancelled = true },
  })
  return { ok: status >= 200 && status < 300, status, redirected, url, headers: new Headers(), body: stream, record }
}

const GLTF_JSON = (extra = {}) => JSON.stringify({ asset: { version: '2.0' }, ...extra })

const settle = () => new Promise((resolve) => setImmediate(resolve))

/** A fetch stub from a table, with the calls recorded in order. */
function stubFetch(table) {
  const calls = []
  const fn = async (url, options) => {
    calls.push({ url, options })
    const entry = table[url]
    if (entry === undefined) throw new Error(`unexpected request: ${url}`)
    return typeof entry === 'function' ? entry(url, options) : entry
  }
  fn.calls = calls
  return fn
}

test('Z3/L4a: one slot per HTTP request — the file and every dependency', async () => {
  const limiter = createTransferLimiter({ concurrent: 1 })
  let peak = 0
  const fetchFn = stubFetch({
    'https://h/m.gltf': () => response(GLTF_JSON({ images: [{ uri: 'a.png' }, { uri: 'b.png' }] }), { url: 'https://h/m.gltf' }),
    'https://h/a.png': () => response(new Uint8Array(4)),
    'https://h/b.png': () => response(new Uint8Array(4)),
  })
  const result = await fetchModel({
    url: 'https://h/m.gltf',
    fetchFn: async (url, options) => {
      // The slot is held from before the request: what is active HERE is this
      // request plus any other the limiter let through.
      peak = Math.max(peak, limiter.active)
      return fetchFn(url, options)
    },
    limiter,
    limits: { ...MODEL_LIMITS, timeoutMs: 1000 },
  })
  assert.equal(result.ok, true, result.message)
  assert.equal(fetchFn.calls.length, 3, 'the file and its two dependencies')
  assert.equal(limiter.active, 0, 'every slot was given back')
  assert.equal(limiter.queued, 0)
  assert.equal(peak, 1, 'one request at a time under a one-slot limiter')
})

test('Z3/L4a: two models sharing a dependency fetch it once; the ledger is charged once', async () => {
  const shared = createSharedTasks()
  const ledger = createWorldLedger({ worldBytes: 1_000_000 })
  const xJson = GLTF_JSON({ images: [{ uri: 'a.png' }] })
  const yJson = GLTF_JSON({ images: [{ uri: 'a.png' }] })
  const dep = new Uint8Array(1000)
  let depRequests = 0
  let releaseDep = null
  const depGate = new Promise((resolve) => { releaseDep = resolve })

  const fetchFn = stubFetch({
    'https://h/x.gltf': () => response(xJson, { url: 'https://h/x.gltf' }),
    'https://h/y.gltf': () => response(yJson, { url: 'https://h/y.gltf' }),
    'https://h/a.png': async () => {
      depRequests += 1
      await depGate
      return response(dep, { url: 'https://h/a.png' })
    },
  })

  const options = { fetchFn, ledger, sharedTransfers: shared, limits: { ...MODEL_LIMITS, timeoutMs: 1000 } }
  const both = Promise.all([
    fetchModel({ url: 'https://h/x.gltf', ...options }),
    fetchModel({ url: 'https://h/y.gltf', ...options }),
  ])
  await settle()
  releaseDep()
  const [x, y] = await both

  assert.equal(x.ok, true, x.message)
  assert.equal(y.ok, true, y.message)
  assert.equal(depRequests, 1, 'ONE transfer for the two jobs')
  assert.equal(x.dependencies.get('a.png').bytes.byteLength, 1000, 'x got its bytes')
  assert.equal(y.dependencies.get('a.png').bytes.byteLength, 1000, 'y got the same bytes')
  assert.equal(x.totalBytes, xJson.length + 1000, 'x’s own budget is charged')
  assert.equal(y.totalBytes, yJson.length + 1000, 'y’s own budget is charged')
  assert.equal(ledger.charged, xJson.length + yJson.length + 1000,
    'the shared dependency is charged to the world ONCE')
})

test('Z3/L4a: a consumer that goes over its own 25 MiB leaves; the other still loads', async () => {
  const shared = createSharedTasks()
  // X's file is padded so that the SHARED dependency takes it over its budget.
  const xJson = GLTF_JSON({ images: [{ uri: 'a.png' }], extras: { pad: 'x'.repeat(500) } })
  const yJson = GLTF_JSON({ images: [{ uri: 'a.png' }] })
  const limits = { ...MODEL_LIMITS, modelBytes: xJson.length + 400, timeoutMs: 1000 }
  const dep = new Uint8Array(800)
  let depRequests = 0

  const fetchFn = stubFetch({
    'https://h/x.gltf': () => response(xJson, { url: 'https://h/x.gltf', chunk: 100 }),
    'https://h/y.gltf': () => response(yJson, { url: 'https://h/y.gltf', chunk: 100 }),
    'https://h/a.png': () => { depRequests += 1; return response(dep, { url: 'https://h/a.png', chunk: 100 }) },
  })

  const options = { fetchFn, sharedTransfers: shared, limits }
  const [x, y] = await Promise.all([
    fetchModel({ url: 'https://h/x.gltf', ...options }),
    fetchModel({ url: 'https://h/y.gltf', ...options }),
  ])

  assert.equal(x.ok, false, 'the model that went over fails')
  assert.equal(x.reason, 'too-large')
  assert.equal(y.ok, true, y.message)
  assert.equal(y.dependencies.get('a.png').bytes.byteLength, 800)
  assert.equal(depRequests, 1, 'still ONE transfer')
})

test('Z3/L4a: one URL under two redirect policies is two transfers', async () => {
  const shared = createSharedTasks()
  // Both models name the same dependency URL. An ABSOLUTE model may follow any
  // `https` redirect; a ROOT-RELATIVE model must stay on the world's origin, so
  // their bytes are not interchangeable — and the key says so.
  const absJson = GLTF_JSON({ images: [{ uri: 'a.png' }] })
  const relJson = GLTF_JSON({ images: [{ uri: 'a.png' }] })
  let depRequests = 0
  const fetchFn = stubFetch({
    'https://world.example/abs.gltf': () => response(absJson, { url: 'https://world.example/abs.gltf' }),
    'https://world.example/rel.gltf': () => response(relJson, { url: 'https://world.example/rel.gltf' }),
    'https://world.example/a.png': () => {
      depRequests += 1
      return response(new Uint8Array(8), { url: 'https://cdn.other/a.png', redirected: true })
    },
  })

  const [abs, rel] = await Promise.all([
    fetchModel({ url: 'https://world.example/abs.gltf', fetchFn, sharedTransfers: shared, limits: { ...MODEL_LIMITS, timeoutMs: 1000 } }),
    fetchModel({
      url: '/rel.gltf', worldBaseUrl: 'https://world.example/index.html',
      fetchFn, sharedTransfers: shared, limits: { ...MODEL_LIMITS, timeoutMs: 1000 },
    }),
  ])

  assert.equal(abs.ok, true, abs.message)
  assert.equal(rel.ok, false)
  assert.equal(rel.reason, 'redirect', 'an off-origin hop is refused for the root-relative model')
  assert.equal(depRequests, 2, 'the two policies are two transfers')
})

test('Z3/L4a: the job’s clock stops while it waits for a limiter slot', async () => {
  let clock = 0
  const deadline = createJobDeadline({ timeoutMs: 15_000, now: () => clock })
  const limiter = createTransferLimiter({ concurrent: 1 })
  const held = await limiter.acquire(null, 0)
  const fetchFn = stubFetch({ 'https://h/m.glb': () => response(glbBytes()) })

  const promise = fetchModel({ url: 'https://h/m.glb', fetchFn, deadline, limiter, limits: { ...MODEL_LIMITS, timeoutMs: 15_000 } })
  await settle()
  assert.equal(fetchFn.calls.length, 0, 'the job is queued for its slot')

  clock += 20_000                  // 20 s of queue wait, longer than the deadline
  held()
  const result = await promise

  assert.equal(result.ok, true, 'the queue wait is not the job’s own time')
  assert.equal(fetchFn.calls.length, 1)
})

test('Z3/L4a: the timer is re-armed per transfer, so a dependency gets the rest of the deadline', async () => {
  let clock = 0
  const deadline = createJobDeadline({ timeoutMs: 5000, now: () => clock })
  const fetchFn = stubFetch({
    'https://h/m.gltf': () => response(GLTF_JSON({ images: [{ uri: 'a.png' }] }), { url: 'https://h/m.gltf' }),
    'https://h/a.png': () => { clock += 3000; return response(new Uint8Array(4)) },
  })
  const result = await fetchModel({
    url: 'https://h/m.gltf',
    fetchFn: async (url, options) => {
      const got = await fetchFn(url, options)
      clock += 1000                // the job spends 1 s of its own work per transfer
      return got
    },
    deadline,
    limits: { ...MODEL_LIMITS, timeoutMs: 5000 },
  })
  assert.equal(result.ok, true, result.message)
})

test('Z3/L4a: a dependency transfer is aborted when its last consumer leaves', async () => {
  const shared = createSharedTasks()
  const dep = 'https://h/a.png'
  let releaseDep = null
  const depGate = new Promise((resolve) => { releaseDep = resolve })
  let cancelled = false
  let depSignal = null
  const json = GLTF_JSON({ images: [{ uri: 'a.png' }] })
  const fetchFn = stubFetch({
    'https://h/m.gltf': () => response(json, { url: 'https://h/m.gltf' }),
    [dep]: (url, options) => {
      depSignal = options.signal
      const body = new ReadableStream({
        async start(controller) { await depGate; controller.enqueue(new Uint8Array(4)); controller.close() },
        cancel() { cancelled = true },
      })
      return { ok: true, status: 200, redirected: false, url: dep, headers: new Headers(), body }
    },
  })
  const own = new AbortController()
  const promise = fetchModel({
    url: 'https://h/m.gltf', fetchFn, signal: own.signal, sharedTransfers: shared,
    limits: { ...MODEL_LIMITS, timeoutMs: 1000 },
  })
  await settle()
  assert.ok(depSignal, 'the shared transfer started its own request')
  own.abort()
  const result = await promise
  assert.equal(result.reason, 'aborted')
  assert.equal(shared.size, 0, 'the transfer left the map with its last consumer')
  assert.equal(depSignal.aborted, true, 'and the shared transfer’s own controller was aborted')
  releaseDep()
  await settle()
})
