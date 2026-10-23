// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// server-clock — scripting-4a step 2, Z3: the server's clock in `AtriumClient`.
//
// Every measurement comes from a MONOTONIC local clock (`performance.now()`,
// injected here), never `Date.now()`, so a wall-clock change moves nothing. The
// offset maps it to the server's: `serverNow() = monoNow() + offset`. The
// estimate starts from `hello.serverTime`; five pings go at 200 ms intervals,
// then one every 30 s; each `pong` gives a sample; the client keeps a rolling
// window of the last 10, none older than 5 minutes, and uses the lowest-RTT
// sample in it. A discontinuity clears the window WITHOUT keeping its own sample
// and starts a fresh burst of five pings. No ping timer outlives its connection.
//
// A mock WebSocket injects every answer; a fake timer registry runs the pings on
// demand, so no real 30 s interval ever runs here.
//
// The fake SERVER timestamps each pong at the MIDPOINT of the measured round
// trip (`serverAt(sent + rtt/2)`), which is the model the formula
// `offset = serverTime − (sent + rtt/2)` assumes: with `skew = 0` every sample
// therefore lands on exactly `BASE_OFFSET`, and a non-zero `skew` is precisely
// the amount by which the server's clock and the client's monotonic clock
// disagree (a restart, a slept device).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AtriumClient, PING_BURST_COUNT, PING_BURST_INTERVAL_MS, PING_STEADY_INTERVAL_MS,
  CLOCK_WINDOW_SIZE, CLOCK_SAMPLE_MAX_AGE_MS, CLOCK_PING_MAX_AGE_MS, CLOCK_JUMP_MIN_MS,
} from '../src/AtriumClient.js'

const T0 = 5000
const SERVER0 = 1_000_000
/** What a sample with no skew gives: serverNow() must equal `serverAt(mono)`. */
const BASE_OFFSET = SERVER0 - T0

/** The server's clock when the client's monotonic clock reads `mono`. */
const serverAt = (mono) => SERVER0 + (mono - T0)

class MockWebSocket {
  constructor() {
    this.readyState = 1
    this.sent       = []
    this._handlers  = {}
  }
  on(event, fn) { (this._handlers[event] ??= []).push(fn); return this }
  send(data)    { this.sent.push(JSON.parse(data)) }
  close()       { this.readyState = 3 }
  _fire(event, ...args) { for (const fn of this._handlers[event] ?? []) fn(...args) }
  simulateMessage(msg) { this._fire('message', JSON.stringify(msg)) }
  simulateOpen() { this._fire('open') }
}

/**
 * A client on a fake monotonic clock, a fake timer registry and a mock socket.
 *
 * The registry is STRICT, like the platform: `clearTimeout` stops a timeout only
 * and `clearInterval` an interval only, so a timer cancelled with the wrong
 * canceller stays pending and the tests below see it.
 */
function makeHarness() {
  let mono = T0
  let nextId = 1
  const pending = new Map()   // id -> { at, fn, ms|null }   (ms: null = a timeout)

  const timers = {
    setTimeout: (fn, ms) => {
      const id = nextId++
      pending.set(id, { at: mono + (ms ?? 0), fn, ms: null })
      return id
    },
    clearTimeout: (id) => { const e = pending.get(id); if (e && e.ms === null) pending.delete(id) },
    setInterval: (fn, ms) => {
      const id = nextId++
      pending.set(id, { at: mono + ms, fn, ms })
      return id
    },
    clearInterval: (id) => { const e = pending.get(id); if (e && e.ms !== null) pending.delete(id) },
  }

  const mocks = []
  const client = new AtriumClient({
    WebSocket: class { constructor() { const m = new MockWebSocket(); mocks.push(m); return m } },
    connectTimeout: 0,
    monoNow: () => mono,
    timers,
  })

  const clock = () => client._connectionRecord?.clock ?? null
  const nowMock = () => mocks.at(-1)
  const allPings = () => nowMock().sent.filter((m) => m.type === 'ping')

  /** Run every timer due at or before `t`, in time order, moving the clock. */
  function advanceTo(t) {
    for (;;) {
      let due = null
      for (const [id, e] of pending) {
        if (e.at > t) continue
        if (!due || e.at < due.e.at || (e.at === due.e.at && id < due.id)) due = { id, e }
      }
      if (!due) break
      mono = Math.max(mono, due.e.at)
      if (due.e.ms === null) pending.delete(due.id)
      else due.e.at = mono + due.e.ms
      due.e.fn()
    }
    if (t > mono) mono = t
  }

  return {
    client,
    get mock() { return nowMock() },
    get mocks() { return mocks },
    mono: () => mono,
    serverAt,
    advanceTo,
    advance: (ms) => advanceTo(mono + ms),
    /** Move the MONOTONIC clock alone, running no timer (a paused/suspended clock). */
    drift: (ms) => { mono += ms },

    handshake({ serverTime = SERVER0, id = 'clock-test' } = {}) {
      client.connect('ws://mock')
      nowMock().simulateOpen()
      nowMock().simulateMessage({ type: 'hello', id, serverTime, canEdit: true, canPlaceTeleporters: true })
      return nowMock()
    },
    pingCount: () => allPings().length,
    pings: () => allPings(),
    /** The monoNow() a given ping was sent at. */
    sentAt: (clientTime) => clock().sent.get(clientTime),
    /**
     * Answer a ping the way the fake server does: the pong's `serverTime` is the
     * server's clock at the round trip's midpoint, plus `skew`. The measured RTT
     * is whatever the monotonic clock has advanced since the ping was sent.
     */
    answer(clientTime, { skew = 0 } = {}) {
      const sent = clock().sent.get(clientTime)
      const rtt = Math.max(0, mono - sent)
      nowMock().simulateMessage({ type: 'pong', clientTime, serverTime: serverAt(sent + rtt / 2) + skew })
    },
    samples: () => clock()?.samples ?? [],
    offset: () => clock()?.offset ?? null,
    ready: () => clock()?.ready ?? false,
    record: () => client._connectionRecord,
    connectionTimers: () => clock()?.timers.size ?? 0,
    timeoutCount: () => [...pending.values()].filter((e) => e.ms === null).length,
    intervalCount: () => [...pending.values()].filter((e) => e.ms !== null).length,
  }
}

// ===========================================================================
// The estimate
// ===========================================================================

test('Z3: the estimate starts from hello.serverTime', () => {
  const h = makeHarness()
  h.handshake()
  assert.equal(h.client.serverNow(), SERVER0, 'serverNow() is the server’s clock at once')
  assert.equal(h.offset(), BASE_OFFSET, 'the offset maps the monotonic clock onto it')
  assert.equal(h.client.serverClockReady, false, 'and no pong has been answered yet')
})

test('Z3: serverNow() is monoNow() + offset, and follows the monotonic clock', () => {
  const h = makeHarness()
  h.handshake()
  h.drift(1234)
  assert.equal(h.client.serverNow(), SERVER0 + 1234)
})

test('Z3: five pings go at 200 ms intervals, then one every 30 s', () => {
  const h = makeHarness()
  h.handshake()
  assert.equal(h.pingCount(), 0, 'nothing is sent synchronously')

  h.advanceTo(T0)
  assert.equal(h.pingCount(), 1, 'the first ping goes at once')
  assert.deepEqual(h.pings().at(-1), { type: 'ping', clientTime: 1 })

  h.advanceTo(T0 + PING_BURST_INTERVAL_MS - 1)
  assert.equal(h.pingCount(), 1, 'not before its interval')
  h.advanceTo(T0 + PING_BURST_INTERVAL_MS)
  assert.equal(h.pingCount(), 2)

  h.advanceTo(T0 + PING_BURST_INTERVAL_MS * (PING_BURST_COUNT - 1))
  assert.equal(h.pingCount(), PING_BURST_COUNT, 'five in the burst, no more')
  assert.deepEqual(h.pings().map((p) => p.clientTime), [1, 2, 3, 4, 5],
    'each carries its own per-connection counter — never a shared time')
  assert.equal(h.intervalCount(), 1, 'and one steady interval is armed')

  h.advanceTo(T0 + PING_STEADY_INTERVAL_MS)
  assert.equal(h.pingCount(), PING_BURST_COUNT + 1, 'then one every 30 s')
  assert.deepEqual(h.pings().at(-1), { type: 'ping', clientTime: 6 })
})

test('Z3: every pong of one burst lands, each with its own send time', () => {
  const h = makeHarness()
  h.handshake()
  h.advanceTo(T0 + PING_BURST_INTERVAL_MS * (PING_BURST_COUNT - 1))
  assert.equal(h.pingCount(), PING_BURST_COUNT, 'all five are out')
  for (const ping of h.pings()) assert.notEqual(h.sentAt(ping.clientTime), undefined)

  for (const ping of h.pings()) h.answer(ping.clientTime)

  assert.equal(h.samples().length, PING_BURST_COUNT,
    'all five landed — one shared clientTime key would have kept only one')
  assert.equal(h.client.serverClockReady, true, 'ready after the first pong')
  assert.equal(h.offset(), BASE_OFFSET, 'and the estimate is the window’s')
  assert.equal(h.client.serverNow(), h.serverAt(h.mono()), 'so serverNow() is the server’s clock')
})

test('Z3: the lowest-RTT sample in the window wins, not the newest', () => {
  const h = makeHarness()
  h.handshake()
  h.advanceTo(T0 + 800)               // the burst is out: sent at 0, 200, 400, 600, 800
  const [slow, fast] = h.pings()      // slow: sent at T0 (rtt 800); fast: sent at T0+200

  h.answer(fast.clientTime, { skew: 0 })          // rtt 600, offset BASE
  assert.equal(h.offset(), BASE_OFFSET)
  h.answer(slow.clientTime, { skew: 100 })        // rtt 800, offset BASE + 100

  assert.equal(h.samples().length, 2)
  assert.equal(h.samples()[0].rtt, 600)
  assert.equal(h.samples()[1].rtt, 800)
  assert.equal(h.offset(), BASE_OFFSET, 'the FAST sample decides, though the slow one arrived last')
  assert.equal(h.samples()[1].offset, BASE_OFFSET + 100, 'the slow sample really did measure something else')
})

test('Z3: a best sample older than 5 minutes is dropped, and the estimate is replaced', () => {
  const h = makeHarness()
  h.handshake()
  h.advanceTo(T0)
  h.answer(1)                                   // rtt 0: the perfect sample
  assert.equal(h.offset(), BASE_OFFSET)
  assert.equal(h.samples().length, 1)

  h.advanceTo(T0 + CLOCK_SAMPLE_MAX_AGE_MS + 60_000)
  const freshTime = h.pings().at(-1).clientTime
  h.advanceTo(h.sentAt(freshTime) + 900)        // a slow answer: rtt 900
  h.answer(freshTime, { skew: 200 })

  assert.equal(h.samples().length, 1, 'the stale sample is gone, not merely outranked')
  assert.equal(h.samples()[0].rtt, 900)
  assert.equal(h.offset(), BASE_OFFSET + 200, 'and the fresh (worse) sample is the estimate now')
})

test(`Z3: the window keeps the last ${CLOCK_WINDOW_SIZE} samples`, () => {
  const h = makeHarness()
  h.handshake()
  for (let i = 1; i <= CLOCK_WINDOW_SIZE + 2; i++) {
    h.advanceTo(T0 + PING_STEADY_INTERVAL_MS * i)
    const ping = h.pings().at(-1)
    h.advanceTo(h.sentAt(ping.clientTime))      // rtt 0
    h.answer(ping.clientTime)
  }
  assert.equal(h.samples().length, CLOCK_WINDOW_SIZE, 'the window is capped')
  assert.equal(h.offset(), BASE_OFFSET, 'and every sample in it agrees')
})

// ===========================================================================
// Discontinuities
// ===========================================================================

test('Z3: a discontinuity (a server-time jump) clears the window, keeps no sample, and bursts five pings', () => {
  const h = makeHarness()
  h.handshake()
  h.advanceTo(T0 + PING_BURST_INTERVAL_MS * (PING_BURST_COUNT - 1))   // let the whole burst go
  assert.equal(h.timeoutCount(), 0, 'the burst has fired; only the interval is left')
  h.answer(1)                                   // rtt 800, offset BASE
  assert.equal(h.samples().length, 1)

  h.advanceTo(T0 + PING_STEADY_INTERVAL_MS)
  const ping = h.pings().at(-1)
  assert.equal(h.sentAt(ping.clientTime), h.mono(), 'answered at once: a small RTT')

  const before = h.pingCount()
  h.answer(ping.clientTime, { skew: 60_000 })   // the server restarted

  assert.equal(h.samples().length, 0, 'the window was cleared')
  assert.equal(h.offset(), null, 'and the stale estimate with it')
  assert.equal(h.timeoutCount(), PING_BURST_COUNT, 'a burst of five pings is armed')

  h.advanceTo(h.mono() + PING_BURST_INTERVAL_MS * (PING_BURST_COUNT - 1))
  assert.equal(h.pingCount() - before, PING_BURST_COUNT, 'and all five go out')
})

test('Z3: a discontinuity (a slept device whose monotonic clock paused) is detected too', () => {
  const h = makeHarness()
  h.handshake()
  h.advanceTo(T0 + PING_BURST_INTERVAL_MS * (PING_BURST_COUNT - 1))
  h.answer(1)
  assert.equal(h.samples().length, 1)

  h.advance(300)                                // the device is awake for 300 ms
  const ping = h.pings().at(-1)
  h.advanceTo(h.sentAt(ping.clientTime) + 300)  // a 300 ms RTT …
  h.answer(ping.clientTime, { skew: 60_000 })   // … while the server’s clock moved 60 s on

  assert.equal(h.samples().length, 0, 'detected: the window is cleared')
  assert.equal(h.offset(), null)
  assert.equal(h.timeoutCount(), PING_BURST_COUNT, 'and a fresh burst of five is armed')
})

test('Z3: a normal pause (the monotonic clock and the server advance together) is NOT a discontinuity', () => {
  const h = makeHarness()
  h.handshake()
  h.advanceTo(T0 + PING_BURST_INTERVAL_MS * (PING_BURST_COUNT - 1))
  h.answer(1)
  assert.equal(h.samples().length, 1)

  h.advance(60_000)                             // a minute passes on BOTH clocks
  const ping = h.pings().at(-1)
  h.advanceTo(h.sentAt(ping.clientTime))
  h.answer(ping.clientTime)

  assert.equal(h.samples().length, 2, 'the sample is kept')
  assert.equal(h.offset(), BASE_OFFSET, 'and the estimate is unchanged')
})

test('Z3: a wall-clock (Date.now) change moves nothing', () => {
  const h = makeHarness()
  h.handshake()
  h.advanceTo(T0)
  h.answer(1)
  const before = h.client.serverNow()
  const estimate = h.offset()
  const realNow = Date.now
  try {
    let wall = 1_700_000_000_000
    Date.now = () => wall
    wall += 60 * 60 * 1000                      // an hour, as if the device’s clock were wrong
    assert.equal(h.client.serverNow(), before, 'serverNow() did not move')
    assert.equal(h.offset(), estimate, 'nor did the estimate')
    h.advanceTo(T0 + PING_STEADY_INTERVAL_MS)
    const ping = h.pings().at(-1)
    h.advanceTo(h.sentAt(ping.clientTime))
    h.answer(ping.clientTime)
    assert.equal(h.offset(), estimate, 'and a sample taken with a wrong wall clock is still right')
  } finally {
    Date.now = realNow
  }
})

// ===========================================================================
// Ignored answers
// ===========================================================================

test('Z3: a pong this connection never asked for is ignored', () => {
  const h = makeHarness()
  h.handshake()
  h.advanceTo(T0)
  assert.equal(h.samples().length, 0)

  h.mock.simulateMessage({ type: 'pong', clientTime: 4242, serverTime: SERVER0 })
  assert.equal(h.samples().length, 0, 'an unknown clientTime changes nothing')
  assert.equal(h.client.serverClockReady, false, 'and does not make the clock ready')

  h.answer(1)
  assert.equal(h.samples().length, 1, 'the connection’s own answer still lands')
})

test(`Z3: a pong whose ping is more than ${CLOCK_PING_MAX_AGE_MS} ms old is ignored`, () => {
  const h = makeHarness()
  h.handshake()
  h.advanceTo(T0)
  h.drift(CLOCK_PING_MAX_AGE_MS + 1)
  h.answer(1)
  assert.equal(h.samples().length, 0, 'too old to say anything about the server’s clock')
  assert.equal(h.client.serverClockReady, false)

  const ping = (h.advanceTo(h.mono() + PING_STEADY_INTERVAL_MS), h.pings().at(-1))
  h.advanceTo(h.sentAt(ping.clientTime))
  h.answer(ping.clientTime)
  assert.equal(h.samples().length, 1, 'a fresh ping answers what the stale one could not')
})

test('Z3: a jump threshold of 250 ms holds a small disagreement', () => {
  const h = makeHarness()
  h.handshake()
  h.advanceTo(T0 + PING_BURST_INTERVAL_MS * (PING_BURST_COUNT - 1))
  h.answer(1)                                   // rtt 800, offset BASE
  assert.equal(h.samples().length, 1)

  h.advanceTo(T0 + PING_STEADY_INTERVAL_MS)
  const ping = h.pings().at(-1)
  h.advanceTo(h.sentAt(ping.clientTime))        // rtt 0
  h.answer(ping.clientTime, { skew: CLOCK_JUMP_MIN_MS - 50 })
  assert.equal(h.samples().length, 2, 'a disagreement below the threshold is just a sample')
  assert.equal(h.offset(), BASE_OFFSET + CLOCK_JUMP_MIN_MS - 50, 'and the fresher, faster sample wins')
})

// ===========================================================================
// Timers belong to their connection
// ===========================================================================

test('Z3: a disconnect leaves no timer running', () => {
  const h = makeHarness()
  h.handshake()
  const record = h.record()
  assert.equal(h.connectionTimers(), PING_BURST_COUNT + 1, 'five timeouts and the interval')
  assert.equal(h.timeoutCount(), PING_BURST_COUNT)
  assert.equal(h.intervalCount(), 1)

  h.client.disconnect()
  assert.equal(h.connectionTimers(), 0, 'the record’s own set is empty')
  assert.equal(h.timeoutCount(), 0, 'every timeout was really cancelled')
  assert.equal(h.intervalCount(), 0, 'and the interval with the canceller that matches its kind')

  const before = h.pingCount()
  h.advance(PING_STEADY_INTERVAL_MS * 2)
  assert.equal(h.pingCount(), before, 'nothing pings after the disconnect')
})

test('Z3: a superseded connection leaves no timer running', () => {
  const h = makeHarness()
  h.handshake()
  const first = h.record()
  assert.equal(first.clock.timers.size > 0, true)

  h.client.connect('ws://mock-2')
  assert.equal(first.clock.timers.size, 0, 'the outgoing connection’s timers are cancelled')
  assert.equal(h.intervalCount(), 0)
  assert.equal(h.timeoutCount(), 0)
})

test('Z3: a new hello cancels the previous burst rather than adding to it', () => {
  const h = makeHarness()
  h.handshake()
  assert.equal(h.connectionTimers(), PING_BURST_COUNT + 1)
  h.mock.simulateMessage({ type: 'hello', id: 'clock-test', serverTime: SERVER0 })
  assert.equal(h.connectionTimers(), PING_BURST_COUNT + 1,
    'five fresh timeouts and one interval — not ten and two')
  assert.equal(h.timeoutCount(), PING_BURST_COUNT)
  assert.equal(h.intervalCount(), 1)
  assert.equal(h.pingCount(), 0, 'the counter starts again')
  h.advanceTo(h.mono())
  assert.deepEqual(h.pings().at(-1), { type: 'ping', clientTime: 1 })
})

test('Z3: a connect timeout leaves no timer running', () => {
  // No clock can exist before `hello` — that is where one starts — so this pins
  // the invariant on the branch that ends a connection which never opened: the
  // record is dropped and nothing of it is left in the timer registry.
  const fake = new Map()
  let id = 0
  const client = new AtriumClient({
    WebSocket: class { constructor() { return new MockWebSocket() } },
    connectTimeout: 50,
    monoNow: () => 0,
    timers: {
      setTimeout: (fn, ms) => { const i = ++id; fake.set(i, { fn }); return i },
      clearTimeout: (i) => fake.delete(i),
      setInterval: (fn, ms) => { const i = ++id; fake.set(i, { fn }); return i },
      clearInterval: (i) => fake.delete(i),
    },
  })
  const disconnected = []
  client.on('disconnected', (e) => disconnected.push(e.reason))
  client.connect('ws://never-opens')
  const record = client._connectionRecord
  // The impossible-but-defensive case: a clock on a connection that never said
  // hello.
  record.clock = { pingCounter: 0, sent: new Map(), samples: [], offset: null, ready: false, timers: new Set() }
  client._burstPings(record)
  assert.equal(record.clock.timers.size, PING_BURST_COUNT)

  return new Promise((resolve) => {
    setTimeout(() => {
      assert.deepEqual(disconnected, ['timeout'], 'the connect timeout fired')
      assert.equal(client._connectionRecord, null, 'the record is dropped')
      assert.equal(record.clock.timers.size, 0, 'and its timers are cancelled with it')
      resolve()
    }, 120)
  })
})
