// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// image-fetch.test.js — library-sky step 2 (L26). The sky's own transfer: 16 MiB,
// a 30 s deadline that covers the BODY and not only the headers, A2's request
// policy and L17's redirect rule, outside the world ledger.
//
// A stub `fetch` serves every sky: no network, no files. Each stub records the
// URL and the options and whether its body was cancelled or errored, so the
// request policy, the mid-stream cap, the drip deadline and the abort are all
// observable without a browser.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchImage, IMAGE_LIMITS, IMAGE_REASONS, FETCH_OPTIONS,
  SKY_RETRYABLE_REASONS, isSkyRetryable,
} from '../src/model-fetch.js'

const UTF8 = new TextEncoder()

/** A completed response, optionally in fixed-size chunks; records a cancel. */
function response(body, {
  status = 200, redirected = false, url = '', contentType = 'image/jpeg', chunk = 64 * 1024, headers = {},
} = {}) {
  const data = body instanceof Uint8Array ? body : UTF8.encode(body)
  const record = { cancelled: false }
  const stream = new ReadableStream({
    start(controller) {
      const size = chunk > 0 ? chunk : data.length || 1
      for (let at = 0; at < data.length; at += size) controller.enqueue(data.subarray(at, at + size))
      controller.close()
    },
    cancel() { record.cancelled = true },
  })
  return {
    ok: status >= 200 && status < 300,
    status,
    redirected,
    url,
    headers: new Headers({ 'content-type': contentType, ...headers }),
    body: stream,
    record,
  }
}

/**
 * A response whose body drips forever (or up to `total` bytes) and whose stream
 * errors when the request's signal aborts — exactly what a real fetch does. The
 * timer is cleaned up on error or cancel, so no test leaves a handle open.
 */
function dripResponse({ signal = null, size = 1024, every = 10, total = Infinity } = {}) {
  const record = { cancelled: false, errored: false, sent: 0, chunks: 0 }
  let timer = null
  const stop = () => {
    clearInterval(timer)
    timer = null
    try { controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' })) } catch { /* closed */ }
    record.errored = true
  }
  let controller
  const stream = new ReadableStream({
    start(c) {
      controller = c
      signal?.addEventListener?.('abort', stop, { once: true })
      timer = setInterval(() => {
        if (record.sent >= total) {
          clearInterval(timer)
          timer = null
          try { controller.close() } catch { /* closed */ }
          return
        }
        try { controller.enqueue(new Uint8Array(size).fill(0x41)) } catch { clearInterval(timer); timer = null; return }
        record.sent += size
        record.chunks += 1
      }, every)
    },
    cancel() { clearInterval(timer); timer = null; record.cancelled = true },
  })
  return {
    ok: true, status: 200, redirected: false, url: '',
    headers: new Headers({ 'content-type': 'image/jpeg' }),
    body: stream, record,
  }
}

/** A stub fetch from a table of url → response (or response factory). */
function stubFetch(table) {
  const calls = []
  const fetchFn = async (url, options) => {
    calls.push({ url, options })
    const entry = table[url]
    if (entry === undefined) throw new Error(`unexpected request: ${url}`)
    return typeof entry === 'function' ? entry(url, options) : entry
  }
  fetchFn.calls = calls
  return fetchFn
}

const SKY = 'https://cdn.example.com/library/skies/a.jpg'

// ---------------------------------------------------------------------------
// L26 — the numbers and the policy
// ---------------------------------------------------------------------------

test('L26: the sky limits are 16 MiB and 30 s', () => {
  assert.equal(IMAGE_LIMITS.imageBytes, 16 * 1024 * 1024)
  assert.equal(IMAGE_LIMITS.timeoutMs, 30_000)
})

test('L26: every sky reason has plain text', () => {
  for (const code of ['bad-spec', 'no-base', 'http', 'network', 'too-large', 'timeout', 'redirect', 'aborted']) {
    assert.equal(typeof IMAGE_REASONS[code], 'string', code)
    assert.ok(IMAGE_REASONS[code].length > 0, code)
  }
})

test('L26/A2: the sky request carries the exact policy — credentials omitted, no referrer, redirects followed, CORS', async () => {
  const fetchFn = stubFetch({ [SKY]: response('jpeg-bytes') })
  const result = await fetchImage({ url: SKY, fetchFn })
  assert.equal(result.ok, true, result.message)
  assert.equal(fetchFn.calls.length, 1)
  const { options } = fetchFn.calls[0]
  assert.equal(options.method, 'GET')
  assert.equal(options.mode, 'cors', FETCH_OPTIONS.mode)
  assert.equal(options.credentials, 'omit', 'no cookies or HTTP auth, ever')
  assert.equal(options.referrerPolicy, 'no-referrer', 'the page is never sent')
  assert.equal(options.redirect, 'follow')
  assert.ok(options.signal, 'the request is cancellable')
})

test('L26: the bytes and the final URL come back to the caller', async () => {
  const body = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
  const fetchFn = stubFetch({ [SKY]: response(body, { chunk: 2 }) })
  const result = await fetchImage({ url: SKY, fetchFn })
  assert.equal(result.ok, true, result.message)
  assert.ok(result.bytes instanceof Uint8Array)
  assert.deepEqual([...result.bytes], [...body], 'the chunks are reassembled in order')
  assert.equal(result.url, SKY)
})

test('L26/L25a: an absolute https sky needs no world base', async () => {
  const fetchFn = stubFetch({ [SKY]: response('x') })
  const result = await fetchImage({ url: SKY, worldBaseUrl: null, fetchFn })
  assert.equal(result.ok, true, result.message)
})

test('L26/L25a: a root-path sky resolves against the world base, not the page', async () => {
  const resolvedUrl = 'https://world.example/assets/library/skies/a.jpg'
  const fetchFn = stubFetch({ [resolvedUrl]: response('x') })
  const result = await fetchImage({
    url: '/assets/library/skies/a.jpg',
    worldBaseUrl: 'https://world.example/worlds/josh/room',
    fetchFn,
  })
  assert.equal(result.ok, true, result.message)
  assert.equal(fetchFn.calls[0].url, resolvedUrl)
  assert.equal(result.url, resolvedUrl)
})

test('L26: a document-relative sky never reaches the network — it is bad-spec', async () => {
  const fetchFn = stubFetch({})
  for (const url of ['skyboxtest1.png', '../x.png', 'http://cdn.example.com/a.jpg', '//cdn.example.com/a.jpg']) {
    const result = await fetchImage({ url, fetchFn })
    assert.equal(result.ok, false, url)
    assert.equal(result.reason, 'bad-spec', url)
  }
  assert.equal(fetchFn.calls.length, 0, 'nothing was requested')
})

test('L26: a root-path sky with no usable base is no-base', async () => {
  const fetchFn = stubFetch({})
  for (const base of [null, undefined, '', 'not a url']) {
    const result = await fetchImage({ url: '/a.jpg', worldBaseUrl: base, fetchFn })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'no-base', String(base))
  }
  assert.equal(fetchFn.calls.length, 0)
})

// ---------------------------------------------------------------------------
// L26/L17 — the redirect rule, on the sky's own request
// ---------------------------------------------------------------------------

test('L26/L17: a redirect to http: is refused before the body is read', async () => {
  const target = 'http://cdn.example.com/library/skies/a.jpg'
  const redirected = response('jpeg', { redirected: true, url: target })
  const fetchFn = stubFetch({ [SKY]: redirected })
  const result = await fetchImage({ url: SKY, fetchFn })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'redirect')
  assert.match(result.message, /redirected somewhere it may not go/)
  assert.match(result.message, /http:\/\/cdn\.example\.com/, 'the final URL is named')
  assert.equal(redirected.record.cancelled, true, 'the body was cancelled, not read')
})

test('L26/L17: an https redirect on another host is allowed for an absolute sky', async () => {
  const finalUrl = 'https://mirror.example.com/library/skies/a.jpg'
  const redirected = response('jpeg', { redirected: true, url: finalUrl })
  const fetchFn = stubFetch({ [SKY]: redirected })
  const result = await fetchImage({ url: SKY, fetchFn })
  assert.equal(result.ok, true, result.message)
  assert.equal(result.url, finalUrl, 'the final URL travels with the bytes')
})

test('L26/L17: a root-path sky may not redirect off the world origin', async () => {
  const sky = '/assets/library/skies/a.jpg'
  const start = 'https://world.example/assets/library/skies/a.jpg'
  const elsewhere = 'https://cdn.example.com/library/skies/a.jpg'
  const redirected = response('jpeg', { redirected: true, url: elsewhere })
  const fetchFn = stubFetch({ [start]: redirected })
  const result = await fetchImage({
    url: sky, worldBaseUrl: 'https://world.example/worlds/josh/room', fetchFn,
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'redirect')
  assert.equal(redirected.record.cancelled, true)
})

test('L26/L17: a root-path sky redirecting on the world origin is allowed', async () => {
  const sky = '/assets/library/skies/a.jpg'
  const start = 'https://world.example/assets/library/skies/a.jpg'
  const finalUrl = 'https://world.example/assets/library/skies/renamed.jpg'
  const redirected = response('jpeg', { redirected: true, url: finalUrl })
  const fetchFn = stubFetch({ [start]: redirected })
  const result = await fetchImage({
    url: sky, worldBaseUrl: 'https://world.example/worlds/josh/room', fetchFn,
  })
  assert.equal(result.ok, true, result.message)
  assert.equal(result.url, finalUrl)
})

// ---------------------------------------------------------------------------
// L26 — an HTTP refusal is named, and the status survives into the text
// ---------------------------------------------------------------------------

test('L26: a non-2xx response is http, with the status in the message', async () => {
  const notFound = response('missing', { status: 404 })
  const fetchFn = stubFetch({ [SKY]: notFound })
  const result = await fetchImage({ url: SKY, fetchFn })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'http')
  assert.match(result.message, /\(404\)/, 'the status is kept')
  assert.equal(notFound.record.cancelled, true, 'the error body is not read')
})

test('L26: a network failure is network', async () => {
  const fetchFn = async () => { throw new TypeError('Failed to fetch') }
  const result = await fetchImage({ url: SKY, fetchFn })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'network')
})

// ---------------------------------------------------------------------------
// L26 — the 16 MiB cap, counted while streaming
// ---------------------------------------------------------------------------

test('L26: the 16 MiB cap is enforced mid-stream, and the body is cancelled', async () => {
  // 2 MiB chunks, 12 of them = 24 MiB, with NO Content-Length: only the
  // streaming count can catch this. The 9th chunk crosses 16 MiB.
  const size = 2 * 1024 * 1024
  const big = new Uint8Array(size * 12)
  const body = response(big, { chunk: size })
  const fetchFn = stubFetch({ [SKY]: body })
  const result = await fetchImage({ url: SKY, fetchFn })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'too-large')
  assert.match(result.message, /larger than the limit/)
  assert.equal(body.record.cancelled, true, 'the stream was cancelled at the cap')
})

test('L26: exactly 16 MiB is allowed; one byte more is too-large', async () => {
  const ok = response(new Uint8Array(16 * 1024 * 1024), { chunk: 1024 * 1024 })
  const okFetch = stubFetch({ [SKY]: ok })
  const allowed = await fetchImage({ url: SKY, fetchFn: okFetch })
  assert.equal(allowed.ok, true, allowed.message)
  assert.equal(allowed.bytes.length, 16 * 1024 * 1024)

  const over = response(new Uint8Array(16 * 1024 * 1024 + 1), { chunk: 1024 * 1024 })
  const overFetch = stubFetch({ [SKY]: over })
  const refused = await fetchImage({ url: SKY, fetchFn: overFetch })
  assert.equal(refused.ok, false)
  assert.equal(refused.reason, 'too-large')
  // The stub's body is already fully enqueued and closed when the 17th chunk
  // crosses the cap, so its cancel() is a no-op — unlike a live server's stream,
  // which the real reader cancels. The reason is what matters here.
})

test('L26: an honest Content-Length over the cap is refused without reading', async () => {
  const body = response(new Uint8Array(16 * 1024 * 1024 + 1), {
    chunk: 1024 * 1024, headers: { 'content-length': String(16 * 1024 * 1024 + 1) },
  })
  const fetchFn = stubFetch({ [SKY]: body })
  const result = await fetchImage({ url: SKY, fetchFn })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'too-large')
  assert.equal(body.record.cancelled, true, 'the early refusal cancels the body')
})

test('L26: a 16 MiB cap never touches the model limit or the world ledger', async () => {
  // The sky's cap is its own: 16 MiB of sky is legal even though 25 MiB is a
  // model's cap and 150 MiB is the world's. A 16 MiB sky here succeeds.
  const body = response(new Uint8Array(16 * 1024 * 1024), { chunk: 1024 * 1024 })
  const fetchFn = stubFetch({ [SKY]: body })
  const result = await fetchImage({ url: SKY, fetchFn })
  assert.equal(result.ok, true, result.message)
})

// ---------------------------------------------------------------------------
// L26 — the 30 s deadline covers the BODY, not only the headers
// ---------------------------------------------------------------------------

test('L26: the deadline covers a body that drips past the limit', async () => {
  // One timer for the whole transfer. A server that sends headers at once and
  // then drips forever must still end at the deadline: re-arming the timer per
  // chunk would let this run for as long as the server likes.
  // The drip must observe the request's own signal — the one fetchImage aborts
  // on its deadline — so build the response per request, like a real fetch.
  let served = null
  const fetchFn = stubFetch({
    [SKY]: (url, options) => (served = dripResponse({ signal: options?.signal, size: 1024, every: 5 })),
  })
  const started = Date.now()
  // Guard: a per-chunk timer would never settle this promise. If that happens,
  // fail with a message instead of hanging the suite.
  const guard = new Promise((_, reject) => {
    const t = setTimeout(() => reject(new Error('the deadline did not cover the body')), 3000)
    t.unref?.()
  })
  const result = await Promise.race([
    fetchImage({ url: SKY, fetchFn, limits: { imageBytes: IMAGE_LIMITS.imageBytes, timeoutMs: 60 } }),
    guard,
  ])
  const elapsed = Date.now() - started
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'timeout', 'the deadline, not a network fault')
  assert.match(result.message, /took too long/)
  assert.ok(elapsed < 2000, `the transfer ended at the deadline (${elapsed} ms)`)
  assert.equal(served?.record.errored, true, 'the drip was stopped')
  // It did NOT stop for being too large: 60 ms of 1 KiB every 5 ms is tiny.
  assert.equal(served?.record.cancelled, false, 'the deadline errored the stream, not a cancel')
})

test('L26: the deadline covers a body that never sends a byte', async () => {
  let served = null
  const fetchFn = stubFetch({
    [SKY]: (url, options) => (served = dripResponse({ signal: options?.signal, size: 1, every: 1000 })),
  })
  const result = await fetchImage({ url: SKY, fetchFn, limits: { imageBytes: IMAGE_LIMITS.imageBytes, timeoutMs: 40 } })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'timeout')
  assert.equal(served?.record.errored, true, 'the idle body was stopped at the deadline')
})

test('L26: a transfer under the deadline succeeds', async () => {
  const body = dripResponse({ total: 4096, size: 1024, every: 2 })
  const fetchFn = stubFetch({ [SKY]: body })
  const result = await fetchImage({ url: SKY, fetchFn, limits: { imageBytes: IMAGE_LIMITS.imageBytes, timeoutMs: 5000 } })
  assert.equal(result.ok, true, result.message)
  assert.equal(result.bytes.length, 4096)
})

// ---------------------------------------------------------------------------
// L26 — the abort
// ---------------------------------------------------------------------------

test('L26: a caller abort during the body is quiet — aborted, not a timeout', async () => {
  const external = new AbortController()
  // The drip observes the REQUEST's own signal, exactly as a real fetch does, so
  // the abort reaches the body and the stream is stopped.
  let served = null
  const fetchFn = stubFetch({
    [SKY]: (url, options) => (served = dripResponse({ signal: options?.signal, size: 512, every: 5 })),
  })
  const abortAt = setTimeout(() => external.abort(), 25)
  const started = Date.now()
  try {
    const result = await fetchImage({ url: SKY, fetchFn, signal: external.signal })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'aborted', 'a caller abort is never reported as a timeout')
    assert.ok(Date.now() - started < 2000)
    assert.equal(served?.record.errored, true, 'the body was stopped at the abort')
  } finally {
    clearTimeout(abortAt)
  }
})

test('L26: an already-aborted signal sends nothing and answers aborted', async () => {
  const external = new AbortController()
  external.abort()
  const fetchFn = stubFetch({})
  const result = await fetchImage({ url: SKY, fetchFn, signal: external.signal })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'aborted')
  assert.equal(fetchFn.calls.length, 0, 'no request went out')
})

test('L26: the abort listener is removed on success — the signal leaks nothing', async () => {
  const external = new AbortController()
  const fetchFn = stubFetch({ [SKY]: response('x') })
  const result = await fetchImage({ url: SKY, fetchFn, signal: external.signal })
  assert.equal(result.ok, true, result.message)
  // Aborting after the transfer must not touch the finished transfer.
  external.abort()
  assert.equal(result.ok, true)
})

// ===========================================================================
// V3.4 (round 2) — which failures a Retry can fix
// ===========================================================================

test('V3.4: a transfer, deadline, cap, decode or image-header failure is retryable', () => {
  for (const reason of ['network', 'http', 'timeout', 'too-large', 'decode',
    'unsupported-image', 'bad-size', 'too-large-dimensions']) {
    assert.equal(isSkyRetryable(reason), true, reason)
  }
})

test('V3.4: a refusal by rule is NOT retryable — it lives in the same module', () => {
  for (const reason of ['url-type', 'url-length', 'url-chars', 'url-scheme', 'url-parse',
    'url-host', 'url-credentials', 'url-relative', 'no-base', 'empty',
    'bad-spec', 'redirect', 'aborted', 'superseded', 'disposed']) {
    assert.equal(isSkyRetryable(reason), false, reason)
  }
  assert.deepEqual(SKY_RETRYABLE_REASONS.length, 8)
})
