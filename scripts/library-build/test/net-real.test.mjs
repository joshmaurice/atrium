// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * The fetcher over a real socket with Node's own fetch (undici), not
 * hand-built Responses: a body that drips past the timeout, and a gzip bomb.
 * The allowed host is mapped to a local server; everything else is real.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { gzipSync } from 'node:zlib'
import { createFetcher } from '../lib/net.mjs'

async function withServer(handler, fn) {
  const server = createServer(handler)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address()
  const fetchFn = (url, init) => fetch(url.replace('https://dl.polyhaven.org', `http://127.0.0.1:${port}`), init)
  try { return await fn(fetchFn) } finally { server.closeAllConnections(); await new Promise((r) => server.close(r)) }
}

test('the timeout covers a body that keeps dripping', async () => {
  await withServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/octet-stream' })
    const t = setInterval(() => res.write('x'), 50)
    res.on('close', () => clearInterval(t))
  }, async (fetchFn) => {
    const started = Date.now()
    await assert.rejects(createFetcher({ fetchFn, timeoutMs: 500 }).get('https://dl.polyhaven.org/slow', { cap: 1 << 20 }), /timed out|network error/)
    assert.ok(Date.now() - started < 3000)
  })
})

test('a gzip bomb is stopped at the cap on inflated bytes', async () => {
  const bomb = gzipSync(Buffer.alloc(256 * 1024 * 1024))
  await withServer((req, res) => {
    res.writeHead(200, { 'content-encoding': 'gzip', 'content-length': String(bomb.length) })
    res.end(bomb)
  }, async (fetchFn) => {
    await assert.rejects(createFetcher({ fetchFn }).get('https://dl.polyhaven.org/bomb', { cap: 4 << 20 }), /larger than/)
  })
})

test('a real redirect is not followed by fetch itself', async () => {
  let hits = 0
  await withServer((req, res) => {
    hits++
    res.writeHead(302, { location: 'http://127.0.0.1:1/elsewhere' }); res.end()
  }, async (fetchFn) => {
    await assert.rejects(createFetcher({ fetchFn }).get('https://dl.polyhaven.org/r', { cap: 10 }), /not https/)
    assert.equal(hits, 1)
  })
})
