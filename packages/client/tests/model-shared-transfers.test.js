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

/**
 * A response that sends its headers and then STALLS: the body's reader never
 * resolves on its own. It errors when the request's signal aborts, as a real
 * `fetch` does, so the transfer's slot is given back (R1).
 */
function stallingResponse(signal, { url = '' } = {}) {
  const record = { aborted: false, cancelled: false }
  const stream = new ReadableStream({
    start(controller) {
      signal?.addEventListener?.('abort', () => {
        record.aborted = true
        try { controller.error(new Error('aborted')) } catch { /* already closed */ }
      }, { once: true })
    },
    cancel() { record.cancelled = true },
  })
  return { ok: true, status: 200, redirected: false, url, headers: new Headers(), body: stream, record }
}

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

// ── R1: a stalled dependency download ends its consumers, not the page ──────

test('R1 (t1): a .gltf whose dependency stalls ends `timeout`, and the transfer is aborted', { timeout: 5000 }, async () => {
  const shared = createSharedTasks()
  const limiter = createTransferLimiter({ concurrent: 4 })
  const deadline = createJobDeadline({ timeoutMs: 300 })
  let transferSignal = null
  let stalled = null
  const fetchFn = stubFetch({
    'https://h/m.gltf': () => response(GLTF_JSON({ images: [{ uri: 'a.png' }] }), { url: 'https://h/m.gltf' }),
    'https://h/a.png': (url, options) => {
      transferSignal = options.signal
      stalled = stallingResponse(options.signal, { url })
      return stalled
    },
  })

  const startedAt = Date.now()
  const result = await fetchModel({
    url: 'https://h/m.gltf', fetchFn, sharedTransfers: shared, limiter, deadline,
    limits: { ...MODEL_LIMITS, timeoutMs: 300 },
  })
  const took = Date.now() - startedAt

  assert.equal(result.ok, false, 'a stalled dependency no longer hangs forever')
  assert.equal(result.reason, 'timeout', JSON.stringify(result))
  assert.ok(took < 1000, `it ended on its own deadline (${took} ms)`)
  assert.equal(transferSignal?.aborted, true, 'the stalled transfer’s own controller was aborted')
  assert.equal(stalled?.record.aborted, true, 'the stalled reader was aborted')
  assert.equal(limiter.active, 0, 'the transfer gave its limiter slot back')
  assert.equal(shared.size, 0, 'the abandoned task left the map')
})

test('R1 (t2): four stalled dependencies release their slots, and a fifth model loads behind them', { timeout: 10_000 }, async () => {
  const shared = createSharedTasks()
  const limiter = createTransferLimiter({ concurrent: 4 })
  const names = ['a', 'b', 'c', 'd']
  const table = { 'https://h/fifth.glb': () => response(glbBytes()) }
  for (const name of names) {
    table[`https://h/${name}.gltf`] = () => response(GLTF_JSON({ images: [{ uri: `${name}.png` }] }), { url: `https://h/${name}.gltf` })
    table[`https://h/${name}.png`] = (url, options) => stallingResponse(options.signal, { url })
  }
  const fetchFn = stubFetch(table)
  const limits = { ...MODEL_LIMITS, timeoutMs: 300 }
  const options = { fetchFn, sharedTransfers: shared, limiter, limits }

  const four = names.map((name) => fetchModel({
    url: `https://h/${name}.gltf`, ...options, deadline: createJobDeadline({ timeoutMs: 300 }),
  }))
  for (let i = 0; i < 5; i++) await settle()
  assert.equal(limiter.active, 4, 'the four stalled transfers hold every slot')

  const fifth = fetchModel({
    url: 'https://h/fifth.glb', ...options, deadline: createJobDeadline({ timeoutMs: 5000 }),
  })
  await settle()
  assert.equal(fetchFn.calls.filter((call) => call.url === 'https://h/fifth.glb').length, 0,
    'the fifth model waits for a slot')

  const results = await Promise.all(four)
  for (const result of results) assert.equal(result.reason, 'timeout', JSON.stringify(result))
  assert.equal(limiter.active, 0, 'every slot was given back')

  const last = await fifth
  assert.equal(last.ok, true, last.message)
  assert.equal(fetchFn.calls.filter((call) => call.url === 'https://h/fifth.glb').length, 1)
  assert.equal(limiter.active, 0)
})

test('R1 (t3): S1 — a job with 1 s left ends `timeout` on a shared transfer another job waits out', { timeout: 10_000 }, async () => {
  const shared = createSharedTasks()
  const json = GLTF_JSON({ images: [{ uri: 'a.png' }] })
  let depRequests = 0
  let releaseDep = null
  const gate = new Promise((resolve) => { releaseDep = resolve })
  const fetchFn = stubFetch({
    'https://h/y.gltf': () => response(json, { url: 'https://h/y.gltf' }),
    'https://h/x.gltf': () => response(json, { url: 'https://h/x.gltf' }),
    // The transfer takes 3 s: longer than Y's 1 s, well inside X's 30 s.
    'https://h/a.png': async (url) => { depRequests += 1; await gate; return response(new Uint8Array(8), { url }) },
  })

  const yPromise = fetchModel({
    url: 'https://h/y.gltf', fetchFn, sharedTransfers: shared,
    deadline: createJobDeadline({ timeoutMs: 1000 }), limits: { ...MODEL_LIMITS, timeoutMs: 1000 },
  })
  const releaseAt = setTimeout(releaseDep, 3000)
  await settle()
  const xPromise = fetchModel({
    url: 'https://h/x.gltf', fetchFn, sharedTransfers: shared,
    deadline: createJobDeadline({ timeoutMs: 30_000 }), limits: { ...MODEL_LIMITS, timeoutMs: 30_000 },
  })

  const y = await yPromise
  assert.equal(y.ok, false)
  assert.equal(y.reason, 'timeout', JSON.stringify(y))

  const x = await xPromise
  clearTimeout(releaseAt)
  assert.equal(x.ok, true, x.message)
  assert.equal(x.dependencies.get('a.png').bytes.byteLength, 8, 'X still got the bytes')
  assert.equal(depRequests, 1, 'ONE transfer for the two jobs')
})

test('R1 (t4): a consumer is not charged the wait for a shared transfer’s slot', { timeout: 5000 }, async () => {
  let clock = 0
  const deadline = createJobDeadline({ timeoutMs: 30_000, now: () => clock })
  const limiter = createTransferLimiter({ concurrent: 1 })
  const json = GLTF_JSON({ images: [{ uri: 'a.png' }] })
  let filler = null
  const fetchFn = stubFetch({
    'https://h/m.gltf': async (url) => {
      // The model's own file holds the only slot, and hands it to a filler of
      // ours when it finishes: the dependency transfer then has nowhere to run.
      filler = limiter.acquire(null, 0)
      return response(json, { url })
    },
    'https://h/a.png': () => response(new Uint8Array(4), { url: 'https://h/a.png' }),
  })

  const promise = fetchModel({
    url: 'https://h/m.gltf', fetchFn, deadline, limiter, sharedTransfers: createSharedTasks(),
    limits: { ...MODEL_LIMITS, timeoutMs: 30_000 },
  })
  for (let i = 0; i < 5; i++) await settle()
  assert.equal(limiter.queued, 1, 'the shared transfer is queued for a slot')

  clock += 20_000                    // 20 s of queue wait, longer than the deadline
  const releaseFiller = await filler
  releaseFiller()

  const result = await promise
  assert.equal(result.ok, true, result.message)
  assert.ok(deadline.elapsedMs < 1000, `the 20 s queue wait was not charged (elapsed ${deadline.elapsedMs} ms)`)
})

test('R7 (t6): crossing the world ledger names `world-download-budget`, for the crossing job and a bystander', { timeout: 5000 }, async () => {
  const shared = createSharedTasks()
  const ledger = createWorldLedger({ worldBytes: 1000 })
  let releaseB = null
  const bGate = new Promise((resolve) => { releaseB = resolve })
  const fetchFn = stubFetch({
    'https://h/a.gltf': () => response(GLTF_JSON({ images: [{ uri: 'a.png' }] }), { url: 'https://h/a.gltf' }),
    'https://h/b.gltf': () => response(GLTF_JSON({ images: [{ uri: 'b.png' }] }), { url: 'https://h/b.gltf' }),
    'https://h/a.png': () => response(new Uint8Array(4000), { url: 'https://h/a.png', chunk: 1000 }),
    'https://h/b.png': async (url) => { await bGate; return response(new Uint8Array(4), { url }) },
  })
  const options = { fetchFn, ledger, sharedTransfers: shared, limits: { ...MODEL_LIMITS, timeoutMs: 5000 } }

  // A's dependency crosses the 1 KiB ledger; B is waiting on its own dependency.
  const [a, b] = await Promise.all([
    fetchModel({ url: 'https://h/a.gltf', ...options }),
    fetchModel({ url: 'https://h/b.gltf', ...options }),
  ])

  assert.equal(a.ok, false, 'the job whose transfer crossed the ledger fails')
  assert.equal(a.reason, 'world-download-budget', JSON.stringify(a))
  assert.equal(b.ok, false, 'the bystander waiting on its own dependency fails the same way')
  assert.equal(b.reason, 'world-download-budget', JSON.stringify(b))
  assert.ok(ledger.over, 'the world is over its budget')
  releaseB()
  await settle()
})

test('R8 (t9): a model joining a queued shared download is charged this transfer’s bytes, not an earlier one’s', { timeout: 30_000 }, async () => {
  const MiB = 1024 * 1024
  const shared = createSharedTasks()
  // X's transfer queues on ITS limiter, so Y joins it before it runs.
  const limiter = createTransferLimiter({ concurrent: 1 })
  const texture = new Uint8Array(14 * MiB)
  const json = GLTF_JSON({ images: [{ uri: 'tex.png' }] })
  let texRequests = 0
  const fetchFn = stubFetch({
    'https://h/p.gltf': () => response(json, { url: 'https://h/p.gltf' }),
    'https://h/x.gltf': () => response(json, { url: 'https://h/x.gltf' }),
    'https://h/y.gltf': () => response(json, { url: 'https://h/y.gltf' }),
    'https://h/tex.png': (url) => { texRequests += 1; return response(texture, { url, chunk: MiB }) },
  })
  const limits = { ...MODEL_LIMITS, modelBytes: 25 * MiB, timeoutMs: 20_000 }

  // 1. P downloads the 14 MiB texture on its own: that download ends with the
  //    key's bytes at 14 MiB.
  const p = await fetchModel({ url: 'https://h/p.gltf', fetchFn, sharedTransfers: shared, limiter, limits })
  assert.equal(p.ok, true, p.message)
  assert.equal(p.totalBytes, json.length + 14 * MiB)

  // 2. The one slot is busy, so X's NEW transfer for the same texture queues.
  const held = await limiter.acquire(null, 0)
  const xPromise = fetchModel({ url: 'https://h/x.gltf', fetchFn, sharedTransfers: shared, limiter, limits })
  for (let i = 0; i < 5; i++) await settle()

  // 3. Y joins the queued transfer: it must not be charged P's 14 MiB.
  const yPromise = fetchModel({ url: 'https://h/y.gltf', fetchFn, sharedTransfers: shared, limiter, limits })
  for (let i = 0; i < 5; i++) await settle()
  held()

  const [x, y] = await Promise.all([xPromise, yPromise])
  assert.equal(x.ok, true, x.message)
  assert.equal(y.ok, true, `Y was refused ${JSON.stringify(y)}`)
  assert.equal(texRequests, 2, 'P’s own download, then this task’s ONE transfer')
  assert.equal(y.totalBytes, json.length + 14 * MiB, 'Y is charged the texture exactly once')
  assert.equal(x.totalBytes, json.length + 14 * MiB)
})

// ── R5: the §5 Z3 tests that were never written ─────────────────────────────

test('R5 (S4): a waiter aborted in the tick its slot is granted leaks nothing', async () => {
  const limiter = createTransferLimiter({ concurrent: 1 })
  const held = await limiter.acquire(null, 0)
  const own = new AbortController()
  const waiting = limiter.acquire(own.signal, 0)
  const next = limiter.acquire(null, 0)

  held()
  const release = await waiting
  assert.equal(limiter.active, 1, 'the granted waiter holds the slot')
  own.abort()                                   // aborted in the tick of the grant
  await settle()
  assert.equal(limiter.active, 1, 'the abort after the grant does not lose the slot')

  release()                                     // the caller’s try/finally
  const releaseNext = await next
  assert.equal(limiter.active, 1, 'the next waiter starts')
  releaseNext()
  assert.equal(limiter.active, 0)
})

test('R5 (M3): a consumer that goes over its budget on its own second file leaves mid-transfer', { timeout: 10_000 }, async () => {
  const MiB = 1024 * 1024
  const shared = createSharedTasks()
  const limits = { ...MODEL_LIMITS, modelBytes: 25 * MiB, timeoutMs: 5000 }
  const xJson = GLTF_JSON({ buffers: [{ uri: 'shared.bin' }], images: [{ uri: 'x2.bin' }] })
  const yJson = GLTF_JSON({ buffers: [{ uri: 'shared.bin' }] })
  const counts = { shared: 0, x2: 0 }
  const fetchFn = stubFetch({
    'https://h/x.gltf': () => response(xJson, { url: 'https://h/x.gltf' }),
    'https://h/y.gltf': () => response(yJson, { url: 'https://h/y.gltf' }),
    'https://h/shared.bin': (url) => { counts.shared += 1; return response(new Uint8Array(20 * MiB), { url, chunk: MiB }) },
    'https://h/x2.bin': (url) => { counts.x2 += 1; return response(new Uint8Array(20 * MiB), { url, chunk: MiB }) },
  })

  const [x, y] = await Promise.all([
    fetchModel({ url: 'https://h/x.gltf', fetchFn, sharedTransfers: shared, limits }),
    fetchModel({ url: 'https://h/y.gltf', fetchFn, sharedTransfers: shared, limits }),
  ])

  assert.equal(x.ok, false, 'X goes over its own 25 MiB and leaves')
  assert.equal(x.reason, 'too-large')
  assert.equal(y.ok, true, y.message)
  assert.equal(y.totalBytes, yJson.length + 20 * MiB, 'Y’s budget is the shared file once')
  assert.equal(counts.shared, 1, 'the shared 20 MiB file is ONE transfer')
  assert.equal(counts.x2, 1)
})

test('R5: a job whose own clock is past its 30 s ends `timeout`', { timeout: 5000 }, async () => {
  let clock = 0
  const deadline = createJobDeadline({ timeoutMs: 30_000, now: () => clock })
  // This job’s own work has used 31 s by the time its dependency starts, so the
  // dependency is timed out at once rather than getting a fresh 30 s.
  const fetchFn = stubFetch({
    'https://h/m.gltf': () => {
      clock += 31_000
      return response(GLTF_JSON({ images: [{ uri: 'a.png' }] }), { url: 'https://h/m.gltf' })
    },
    'https://h/a.png': (url, options) => stallingResponse(options.signal, { url }),
  })
  const result = await fetchModel({
    url: 'https://h/m.gltf', fetchFn, deadline, limits: { ...MODEL_LIMITS, timeoutMs: 30_000 },
  })
  assert.equal(result.ok, false, 'the job overran its deadline')
  assert.equal(result.reason, 'timeout', JSON.stringify(result))
})
