// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFetcher, FetchRefused, USER_AGENT } from '../lib/net.mjs'
import { endlessBody, md5 } from './fake-polyhaven.mjs'

const A = 'https://dl.polyhaven.org/file/a.bin'
const B = 'https://cdn.polyhaven.com/b.bin'

function fake(routes) {
  const calls = []
  const fetchFn = async (url, init) => {
    calls.push({ url, init })
    const r = routes[url]
    if (!r) return new Response('nf', { status: 404 })
    return typeof r === 'function' ? r(calls.filter((c) => c.url === url).length) : r()
  }
  return { fetchFn, calls }
}

test('a plain download: manual redirects, user agent, bytes back', async () => {
  const body = Buffer.from('hello')
  const f = fake({ [A]: () => new Response(body) })
  const got = await createFetcher({ fetchFn: f.fetchFn }).get(A, { cap: 100, size: 5, md5: md5(body) })
  assert.equal(got.toString(), 'hello')
  assert.equal(f.calls[0].init.redirect, 'manual')
  assert.equal(f.calls[0].init.headers['user-agent'], USER_AGENT)
})

test('a redirect to another allowed host is followed', async () => {
  const f = fake({
    [A]: () => new Response(null, { status: 302, headers: { location: B } }),
    [B]: () => new Response('ok'),
  })
  assert.equal((await createFetcher({ fetchFn: f.fetchFn }).get(A, { cap: 10 })).toString(), 'ok')
})

test('a redirect to a host not on the list, or to http:, is refused before it is requested', async () => {
  for (const location of ['https://evil.example/x', 'http://dl.polyhaven.org/x', 'https://127.0.0.1/x', 'file:///etc/passwd']) {
    const f = fake({ [A]: () => new Response(null, { status: 301, headers: { location } }) })
    await assert.rejects(createFetcher({ fetchFn: f.fetchFn }).get(A, { cap: 10 }), FetchRefused, location)
    assert.equal(f.calls.length, 1, `nothing requested after ${location}`)
  }
})

test('more than three redirects are refused', async () => {
  const f = fake({ [A]: () => new Response(null, { status: 302, headers: { location: A } }) })
  await assert.rejects(createFetcher({ fetchFn: f.fetchFn }).get(A, { cap: 10 }), /too many redirects/)
  assert.equal(f.calls.length, 4)
})

test('a body larger than the cap is aborted while streaming, whatever was claimed', async () => {
  const f = fake({ [A]: () => new Response(endlessBody()) })
  await assert.rejects(createFetcher({ fetchFn: f.fetchFn }).get(A, { cap: 1024 * 1024 }), /larger than/)
})

test('a declared content-length over the cap is refused before reading', async () => {
  const f = fake({ [A]: () => new Response(endlessBody(), { headers: { 'content-length': String(10 * 1024 * 1024) } }) })
  await assert.rejects(createFetcher({ fetchFn: f.fetchFn }).get(A, { cap: 1024 }), /declared/)
})

test('a body larger (or smaller) than its claimed size is refused', async () => {
  const f = fake({ [A]: () => new Response(Buffer.alloc(200)) })
  await assert.rejects(createFetcher({ fetchFn: f.fetchFn }).get(A, { cap: 1000, size: 100 }), /differs from the claimed/)
  await assert.rejects(createFetcher({ fetchFn: f.fetchFn }).get(A, { cap: 1000, size: 300 }), /differs from the claimed/)
})

test('a claimed size over the cap is refused without a request', async () => {
  const f = fake({ [A]: () => new Response('x') })
  await assert.rejects(createFetcher({ fetchFn: f.fetchFn }).get(A, { cap: 10, size: 11 }), /over the cap/)
  assert.equal(f.calls.length, 0)
})

test('an md5 mismatch is refused', async () => {
  const f = fake({ [A]: () => new Response('hello') })
  await assert.rejects(createFetcher({ fetchFn: f.fetchFn }).get(A, { cap: 10, md5: md5(Buffer.from('other')) }), /md5/)
})

test('a 5xx is retried once; twice fails', async () => {
  const flaky = fake({ [A]: (n) => (n === 1 ? new Response('down', { status: 503 }) : new Response('ok')) })
  assert.equal((await createFetcher({ fetchFn: flaky.fetchFn }).get(A, { cap: 10 })).toString(), 'ok')
  const down = fake({ [A]: () => new Response('down', { status: 502 }) })
  await assert.rejects(createFetcher({ fetchFn: down.fetchFn }).get(A, { cap: 10 }), /502 twice/)
  assert.equal(down.calls.length, 2)
})

test('a 404 is refused without a retry', async () => {
  const f = fake({})
  await assert.rejects(createFetcher({ fetchFn: f.fetchFn }).get(A, { cap: 10 }), /HTTP 404/)
  assert.equal(f.calls.length, 1)
})

test('a request that hangs times out', async () => {
  const fetchFn = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)))
  await assert.rejects(createFetcher({ fetchFn, timeoutMs: 50 }).get(A, { cap: 10 }), /timed out/)
})

test('the starting URL itself must pass the host rule', async () => {
  const f = fake({})
  await assert.rejects(createFetcher({ fetchFn: f.fetchFn }).get('https://example.com/x', { cap: 10 }), /host not allowed/)
  assert.equal(f.calls.length, 0)
})
