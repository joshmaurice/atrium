// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// model-transfer.test.js — the two shared primitives of models-by-url:
// createSharedTasks (L3a) and createTransferLimiter (L4a).
//
// Both are exercised without a network: `start` is a deferred the test settles
// by hand, so "the last requester left" and "the task is still live" are exact,
// observable states rather than timing guesses.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSharedTasks, createTransferLimiter, MODEL_LIMITS } from '../src/model-fetch.js'

/** A promise whose settle the test controls. */
function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

/** Let queued microtasks run. */
const settle = () => new Promise((resolve) => setImmediate(resolve))

test('sharedTasks: two requesters of one key run start once and share the result', async () => {
  const shared = createSharedTasks()
  const gate = deferred()
  let starts = 0
  const start = (signal) => { starts += 1; assert.ok(signal, 'start gets the task signal'); return gate.promise }

  const a = shared.join('u1', start, null)
  const b = shared.join('u1', start, null)
  assert.equal(starts, 1, 'start runs once for the key')
  assert.equal(shared.size, 1)

  gate.resolve({ ok: true, url: 'u1' })
  const [ra, rb] = await Promise.all([a, b])
  assert.deepEqual(ra, { ok: true, url: 'u1' })
  assert.deepEqual(rb, { ok: true, url: 'u1' })
  await settle()
  assert.equal(shared.has('u1'), false, 'the settled task leaves the map')
})

test('sharedTasks: a requester whose signal aborts resolves aborted; the others are untouched', async () => {
  const shared = createSharedTasks()
  const gate = deferred()
  let taskSignal = null
  const start = (signal) => { taskSignal = signal; return gate.promise }

  const keep = shared.join('u2', start, null)
  const own = new AbortController()
  const drop = shared.join('u2', start, own.signal)
  own.abort()
  assert.deepEqual(await drop, { ok: false, reason: 'aborted' })
  assert.equal(taskSignal.aborted, false, 'the others are still waiting')
  assert.equal(shared.has('u2'), true)

  gate.resolve({ ok: true, url: 'u2' })
  assert.deepEqual(await keep, { ok: true, url: 'u2' })
  await settle()
  assert.equal(shared.has('u2'), false)
})

test('sharedTasks: the last requester leaving aborts the task; the map entry goes at once', async () => {
  const shared = createSharedTasks()
  const gate = deferred()
  let taskSignal = null
  const start = (signal) => { taskSignal = signal; return gate.promise }

  const own = new AbortController()
  const drop = shared.join('u3', start, own.signal)
  own.abort()
  assert.deepEqual(await drop, { ok: false, reason: 'aborted' })
  assert.equal(taskSignal.aborted, true, 'the abandoned task signal aborted')
  assert.equal(shared.has('u3'), false, 'abandoned at once, not at settle')

  // A join after abandonment starts a NEW task with a new identity.
  const fresh = deferred()
  let secondSignal = null
  const second = shared.join('u3', (signal) => { secondSignal = signal; return fresh.promise }, null)
  assert.notEqual(secondSignal, taskSignal, 'a new task signal')
  assert.equal(shared.has('u3'), true)
  fresh.resolve({ ok: true, url: 'u3-new' })
  assert.deepEqual(await second, { ok: true, url: 'u3-new' })

  // The old task's late settle must not remove the new one's entry.
  const third = deferred()
  const revived = shared.join('u3', () => third.promise, null)
  gate.resolve({ ok: false, reason: 'aborted' })
  await settle()
  assert.equal(shared.has('u3'), true, "the old task's settle did not remove the newer entry")
  third.resolve({ ok: true, url: 'u3-third' })
  assert.deepEqual(await revived, { ok: true, url: 'u3-third' })
  await settle()
  assert.equal(shared.has('u3'), false)
})

test('sharedTasks: distinct keys are distinct tasks', async () => {
  const shared = createSharedTasks()
  let starts = 0
  const start = () => { starts += 1; return Promise.resolve({ ok: true }) }
  const both = await Promise.all([shared.join('a', start), shared.join('b', start)])
  assert.equal(starts, 2)
  assert.deepEqual(both, [{ ok: true }, { ok: true }])
})

test('sharedTasks: a signal already aborted never starts the work', async () => {
  const shared = createSharedTasks()
  const own = new AbortController()
  own.abort()
  let starts = 0
  assert.deepEqual(await shared.join('u4', () => { starts += 1 }, own.signal), { ok: false, reason: 'aborted' })
  await settle()
  assert.equal(starts, 0)
  assert.equal(shared.has('u4'), false)
})

test('sharedTasks: a rejecting start settles every requester as a failure', async () => {
  const shared = createSharedTasks()
  const gate = deferred()
  const a = shared.join('u5', () => gate.promise)
  const b = shared.join('u5', () => gate.promise)
  gate.reject(new Error('socket closed'))
  assert.deepEqual(await a, { ok: false, reason: 'network', message: 'socket closed' })
  assert.deepEqual(await b, { ok: false, reason: 'network', message: 'socket closed' })
})

test('limiter: caps the number of active transfers and wakes waiters in arrival order', async () => {
  const limiter = createTransferLimiter({ concurrent: 2 })
  const grants = []
  const signals = [new AbortController(), new AbortController(), new AbortController()]
  const held = signals.map((c) => limiter.acquire(c.signal).then((release) => { grants.push(release); return release }))

  await settle()
  assert.equal(limiter.active, 2)
  assert.equal(limiter.queued, 1)

  grants[0]()  // release the first: the third waiter is woken
  await settle()
  assert.equal(limiter.active, 2)
  assert.equal(limiter.queued, 0)
  grants[1]()
  grants[2]()
  await settle()
  assert.equal(limiter.active, 0)
  await Promise.all(held)
})

test('limiter: lowest priority first, then first-come among equals', async () => {
  const limiter = createTransferLimiter({ concurrent: 1 })
  const order = []
  const first = limiter.acquire(null, 0).then((r) => { order.push('held-0'); return r })
  const later = limiter.acquire(null, 5).then((r) => { order.push('prio-5'); return r })
  const sooner = limiter.acquire(null, 1).then((r) => { order.push('prio-1'); return r })
  await settle()
  assert.deepEqual(order, ['held-0'])

  ;(await first)()
  await settle()
  assert.deepEqual(order, ['held-0', 'prio-1'], 'the lower priority goes first')

  ;(await sooner)()
  await settle()
  assert.deepEqual(order, ['held-0', 'prio-1', 'prio-5'])
  ;(await later)()
  await settle()
  assert.equal(limiter.active, 0)
})

test('limiter: release is idempotent and does not leak a slot', async () => {
  const limiter = createTransferLimiter({ concurrent: 1 })
  const release = await limiter.acquire(null)
  assert.equal(limiter.active, 1)
  release()
  release()
  release()
  assert.equal(limiter.active, 0, 'three calls release one slot, once')
  const second = await limiter.acquire(null)
  assert.equal(limiter.active, 1)
  second()
  assert.equal(limiter.active, 0)
})

test('limiter: a waiter whose signal aborts leaves the queue and holds no slot', async () => {
  const limiter = createTransferLimiter({ concurrent: 1 })
  const keep = await limiter.acquire(null)
  const own = new AbortController()
  const dropped = limiter.acquire(own.signal)
  const next = new AbortController()
  const after = limiter.acquire(next.signal)
  await settle()
  assert.equal(limiter.queued, 2)

  own.abort()
  const noop = await dropped
  assert.equal(typeof noop, 'function')
  noop()                       // a no-op release must not free the held slot
  assert.equal(limiter.active, 1, 'the held slot is still held')
  assert.equal(limiter.queued, 1, 'the aborted waiter left the queue')

  keep()
  await settle()
  assert.equal(limiter.active, 1, 'the next waiter was woken into the freed slot')
  assert.equal(limiter.queued, 0)
  ;(await after)()
  assert.equal(limiter.active, 0)
})

test('limiter: an already-aborted signal never takes a slot', async () => {
  const limiter = createTransferLimiter({ concurrent: 1 })
  const own = new AbortController()
  own.abort()
  const release = await limiter.acquire(own.signal)
  release()
  assert.equal(limiter.active, 0)
  assert.equal(limiter.queued, 0)
})

test('limiter: its default concurrency is the model limit', async () => {
  const limiter = createTransferLimiter()
  assert.equal(limiter.limit, MODEL_LIMITS.concurrent)
})
