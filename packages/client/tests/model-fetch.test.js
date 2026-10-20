// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// model-fetch.test.js — models-by-url step 3 (Z2 as amended by A2/A3/A4/A13).
//
// A stub `fetch` serves every model: no network, no files. Each stub records
// the URL, the options and whether the body was cancelled, so the request
// policy (A2), the mid-stream abort (Z2) and the deduplication (A3) are all
// observable.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  fetchModel, createWorldLedger, createJobDeadline, redirectProblem, sniffFormat, unsupportedExtension,
  listDependencies, sha256Hex, MODEL_LIMITS, FETCH_OPTIONS, FETCH_REASONS,
} from '../src/model-fetch.js'

const UTF8 = new TextEncoder()
const bytes = (s) => UTF8.encode(s)
const GLB = Uint8Array.from([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0])
const glbBytes = (extra = 8) => {
  const out = new Uint8Array(GLB.length + extra)
  out.set(GLB, 0); return out
}
const hash = (b) => createHash('sha256').update(Buffer.from(b)).digest('hex')

/** A response whose body is served in `chunk`-sized pieces; records cancels. */
function response(body, {
  status = 200, redirected = false, url = '', contentType = 'application/octet-stream', chunk = 0,
} = {}) {
  const record = { cancelled: false }
  const stream = new ReadableStream({
    start(controller) {
      const data = body instanceof Uint8Array ? body : bytes(body)
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
    headers: new Headers({ 'content-type': contentType }),
    body: stream,
    record,
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

const GLTF_JSON = (extra = {}) => JSON.stringify({ asset: { version: '2.0' }, ...extra })

// ---------------------------------------------------------------------------
// A2 — the request policy, on every request
// ---------------------------------------------------------------------------

test('A2: every request carries the exact policy, dependencies included', async () => {
  const gltfUrl = 'https://cdn.example.com/a/chair.gltf'
  const depUrl = 'https://cdn.example.com/a/buffers/chair.bin'
  const fetchFn = stubFetch({
    [gltfUrl]: response(GLTF_JSON({ buffers: [{ uri: 'buffers/chair.bin', byteLength: 4 }] })),
    [depUrl]: response(glbBytes(4)),
  })
  const result = await fetchModel({ url: gltfUrl, fetchFn })
  assert.equal(result.ok, true, result.message)
  assert.equal(fetchFn.calls.length, 2, 'the file and its dependency')
  for (const call of fetchFn.calls) {
    assert.equal(call.options.method, FETCH_OPTIONS.method)
    assert.equal(call.options.mode, 'cors')
    assert.equal(call.options.credentials, 'omit', 'no cookies or HTTP auth, ever')
    assert.equal(call.options.referrerPolicy, 'no-referrer')
    assert.equal(call.options.redirect, 'follow')
    assert.ok(call.options.signal, 'every request is cancellable')
  }
})

// ---------------------------------------------------------------------------
// Z2 — the model byte budget
// ---------------------------------------------------------------------------

test('Z2: crossing the cap mid-stream cancels the request and reports too-large', async () => {
  const url = 'https://h/big.glb'
  let observed = null
  const fetchFn = stubFetch({
    [url]: () => {
      const data = new Uint8Array(64)
      const stream = new ReadableStream({
        start(controller) {
          for (let i = 0; i < 4; i++) controller.enqueue(data)
          controller.close()
        },
        cancel() { observed = 'cancelled' },
      })
      return { ok: true, status: 200, redirected: false, url, headers: new Headers(), body: stream }
    },
  })
  const result = await fetchModel({ url, fetchFn, limits: { ...MODEL_LIMITS, modelBytes: 100, timeoutMs: 1000 } })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'too-large')
  assert.equal(observed, 'cancelled', 'the request was aborted, not read to the end')
})

test('Z2: a lying Content-Length is not trusted — it is only used to refuse early', async () => {
  const early = 'https://h/claims-huge.glb'
  const late = 'https://h/claims-small.glb'
  const fetchFn = stubFetch({
    // Claims 30 MiB, serves 8 bytes: refused before the body is read.
    [early]: () => {
      const data = glbBytes()
      const stream = new ReadableStream({
        start(controller) { controller.enqueue(data); controller.close() },
        cancel() { fetchFn.cancelled = true },
      })
      return {
        ok: true, status: 200, redirected: false, url: early,
        headers: new Headers({ 'content-length': String(30 * 1024 * 1024) }), body: stream,
      }
    },
    // Claims 8 bytes, serves 4 KiB: the running total still refuses it.
    [late]: () => {
      const data = new Uint8Array(4096)
      data.set(GLB, 0)
      return { ...response(data, { chunk: 512 }), headers: new Headers({ 'content-length': '8' }) }
    },
  })
  const limits = { ...MODEL_LIMITS, modelBytes: 1000, timeoutMs: 1000 }
  const first = await fetchModel({ url: early, fetchFn, limits })
  assert.equal(first.reason, 'too-large')
  assert.equal(fetchFn.cancelled, true, 'the over-large body is never read')
  const second = await fetchModel({ url: late, fetchFn, limits })
  assert.equal(second.reason, 'too-large')
})

test('Z2: a multi-file .gltf whose images push the total past the cap is refused', async () => {
  const gltfUrl = 'https://h/m.gltf'
  const binUrl = 'https://h/m.bin'
  const imgUrl = 'https://h/m.png'
  const fetchFn = stubFetch({
    [gltfUrl]: response(GLTF_JSON({
      buffers: [{ uri: 'm.bin' }],
      images: [{ uri: 'm.png' }],
    })),
    [binUrl]: response(new Uint8Array(600)),
    [imgUrl]: response(new Uint8Array(600)),
  })
  const result = await fetchModel({
    url: gltfUrl, fetchFn,
    limits: { ...MODEL_LIMITS, modelBytes: 1000, timeoutMs: 1000 },
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'too-large', result.message)
})

// ---------------------------------------------------------------------------
// Z2 — timeout, abort, status
// ---------------------------------------------------------------------------

test('Z2: the 30 s timer covers the whole job', async () => {
  const url = 'https://h/slow.glb'
  const fetchFn = async (target, options) => new Promise((_, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')))
  })
  const started = Date.now()
  const result = await fetchModel({ url, fetchFn, limits: { ...MODEL_LIMITS, timeoutMs: 40 } })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'timeout')
  assert.ok(Date.now() - started < 2000)
})

test('Z2: an aborted signal resolves quietly, with reason aborted', async () => {
  const url = 'https://h/m.glb'
  const controller = new AbortController()
  const fetchFn = async (target, options) => new Promise((_, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')))
  })
  const promise = fetchModel({ url, fetchFn, signal: controller.signal })
  controller.abort()
  const result = await promise
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'aborted')
  assert.equal(FETCH_REASONS.aborted, result.message, 'no warning text')
})

test('Z2: a non-2xx status is an http refusal carrying the status', async () => {
  const url = 'https://h/missing.glb'
  const fetchFn = stubFetch({ [url]: response('nope', { status: 404 }) })
  const result = await fetchModel({ url, fetchFn })
  assert.equal(result.reason, 'http')
  assert.match(result.message, /404/)
})

test('Z2/A1: a root-relative URL with no usable world base is no-base and fetches nothing', async () => {
  const fetchFn = stubFetch({})
  const result = await fetchModel({ url: '/m.glb', fetchFn, worldBaseUrl: null })
  assert.equal(result.reason, 'no-base')
  assert.equal(fetchFn.calls.length, 0)
})

test('Z2/A1: a root-relative URL resolves against the world origin', async () => {
  const fetchFn = stubFetch({
    'https://world.example/assets/m.glb': response(glbBytes()),
  })
  const result = await fetchModel({ url: '/assets/m.glb', fetchFn, worldBaseUrl: 'https://world.example/worlds/josh/room' })
  assert.equal(result.ok, true, result.message)
  assert.equal(fetchFn.calls[0].url, 'https://world.example/assets/m.glb')
})

// ---------------------------------------------------------------------------
// Z2 — format sniffing, unsupported extensions, hashing
// ---------------------------------------------------------------------------

test('Z2: the format comes from the content, not the extension', async () => {
  const fetchFn = stubFetch({
    'https://h/looks-like-json.glb': response(glbBytes()),
    'https://h/looks-like-binary.gltf': response(GLTF_JSON()),
  })
  const asGlb = await fetchModel({ url: 'https://h/looks-like-json.glb', fetchFn })
  assert.equal(asGlb.kind, 'glb')
  const asGltf = await fetchModel({ url: 'https://h/looks-like-binary.gltf', fetchFn })
  assert.equal(asGltf.kind, 'gltf')
})

test('Z2: neither a glb nor JSON is a parse refusal', async () => {
  const fetchFn = stubFetch({ 'https://h/m.glb': response('not a model at all') })
  const result = await fetchModel({ url: 'https://h/m.glb', fetchFn })
  assert.equal(result.reason, 'parse')
})

test('Z2/L7: Draco, meshopt and KTX2 are refused before parsing', async () => {
  for (const [extension, words] of [
    ['KHR_draco_mesh_compression', /Draco/],
    ['EXT_meshopt_compression', /meshopt/],
    ['KHR_texture_basisu', /KTX2/],
  ]) {
    const url = `https://h/${extension}.gltf`
    const fetchFn = stubFetch({ [url]: response(GLTF_JSON({ extensionsRequired: [extension] })) })
    const result = await fetchModel({ url, fetchFn })
    assert.equal(result.ok, false, extension)
    assert.equal(result.reason, 'unsupported')
    assert.match(result.message, words)
    assert.equal(fetchFn.calls.length, 1, 'nothing was fetched for it')
  }
  assert.equal(unsupportedExtension({ extensionsUsed: ['KHR_materials_unlit'] }), null)
})

test('Z2: a pinned glb matches, and a mismatch is refused', async () => {
  const body = glbBytes()
  const url = 'https://h/m.glb'
  const fetchFn = stubFetch({ [url]: () => response(body) })
  const good = await fetchModel({ url, sha256: hash(body), fetchFn })
  assert.equal(good.ok, true, good.message)
  const bad = await fetchModel({ url, sha256: 'a'.repeat(64), fetchFn })
  assert.equal(bad.reason, 'hash-mismatch')
})

test('Z2/A12: pinning a .gltf with external files is refused; a self-contained .gltf is not', async () => {
  const withFiles = 'https://h/external.gltf'
  const fetchFn = stubFetch({
    [withFiles]: response(GLTF_JSON({ buffers: [{ uri: 'm.bin' }] })),
  })
  const refused = await fetchModel({ url: withFiles, sha256: 'a'.repeat(64), fetchFn })
  assert.equal(refused.reason, 'pin-needs-glb')
  assert.equal(fetchFn.calls.length, 1, 'no dependency is fetched once the pin is refused')

  const selfContained = 'https://h/embedded.gltf'
  const body = bytes(GLTF_JSON({ buffers: [{ uri: 'data:application/octet-stream;base64,AAAA' }] }))
  const fetchFn2 = stubFetch({ [selfContained]: response(body) })
  const ok = await fetchModel({ url: selfContained, sha256: hash(body), fetchFn: fetchFn2 })
  assert.equal(ok.ok, true, ok.message)
})

test('sniffFormat and sha256Hex', async () => {
  assert.equal(sniffFormat(GLB), 'glb')
  assert.equal(sniffFormat(bytes('  {"asset":{}}')), 'gltf')
  assert.equal(sniffFormat(bytes('nope')), null)
  assert.equal(await sha256Hex(bytes('')), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
})

// ---------------------------------------------------------------------------
// A2/L17 — redirects
// ---------------------------------------------------------------------------

test('A2/L17: an allowed https hop is followed, an off-scheme one is refused', async () => {
  const url = 'https://h/m.glb'
  const fetchFn = stubFetch({
    [url]: () => response(glbBytes(), { redirected: true, url: 'https://cdn.example.com/m.glb' }),
  })
  const ok = await fetchModel({ url, fetchFn })
  assert.equal(ok.ok, true, ok.message)

  const bad = stubFetch({
    [url]: () => response(glbBytes(), { redirected: true, url: 'http://evil.example/m.glb' }),
  })
  const refused = await fetchModel({ url, fetchFn: bad })
  assert.equal(refused.reason, 'redirect')
})

test('A2/L17: a root-relative spec may not be redirected off the world origin', async () => {
  assert.equal(redirectProblem('https://world.example/m.glb', true, 'https://world.example/w'), null)
  assert.equal(redirectProblem('https://elsewhere.example/m.glb', true, 'https://world.example/w'), 'redirect')
  assert.equal(redirectProblem('https://elsewhere.example/m.glb', false, 'https://world.example/w'), null)
  assert.equal(redirectProblem('http://elsewhere.example/m.glb', false, null), 'redirect')
})

// ---------------------------------------------------------------------------
// A3 — a .gltf's dependencies
// ---------------------------------------------------------------------------

test('A3: a dependency URI with dots resolves against the file, and duplicates are fetched once', async () => {
  const gltfUrl = 'https://cdn.example.com/models/chair.gltf'
  const image = 'https://cdn.example.com/models/images/a.png'
  const fetchFn = stubFetch({
    [gltfUrl]: response(GLTF_JSON({
      buffers: [{ uri: 'textures/../images/a.png' }],
      images: [{ uri: 'textures/../images/a.png' }, { uri: 'images/a.png' }],
    })),
    [image]: response(new Uint8Array(4)),
  })
  const result = await fetchModel({ url: gltfUrl, fetchFn })
  assert.equal(result.ok, true, result.message)
  assert.equal(fetchFn.calls.length, 2, 'the file, then the one distinct dependency')
  assert.equal(result.dependencies.size, 1)
  assert.ok(result.dependencies.has('textures/../images/a.png'))
  assert.equal(result.dependencies.get('textures/../images/a.png').url, image)
})

test('A3: an http: dependency, and an off-host one on a root-relative model, are bad-dependency', async () => {
  const absolut = 'https://cdn.example.com/m.gltf'
  const fetchFn = stubFetch({ [absolut]: response(GLTF_JSON({ buffers: [{ uri: 'http://h/m.bin' }] })) })
  const refused = await fetchModel({ url: absolut, fetchFn })
  assert.equal(refused.reason, 'bad-dependency')
  assert.equal(fetchFn.calls.length, 1, 'the dependency is never requested')

  const relative = '/assets/m.gltf'
  const fetchFn2 = stubFetch({ 'https://world.example/assets/m.gltf': response(GLTF_JSON({ images: [{ uri: 'https://elsewhere.example/i.png' }] })) })
  const refused2 = await fetchModel({ url: relative, fetchFn: fetchFn2, worldBaseUrl: 'https://world.example/w' })
  assert.equal(refused2.reason, 'bad-dependency')
})

test('A3: data: URIs are left alone and never fetched', async () => {
  const url = 'https://h/m.gltf'
  const fetchFn = stubFetch({
    [url]: response(GLTF_JSON({ buffers: [{ uri: 'data:application/octet-stream;base64,AAAA' }], images: [{ uri: 'data:image/png;base64,AAAA' }] })),
  })
  const result = await fetchModel({ url, fetchFn })
  assert.equal(result.ok, true, result.message)
  assert.equal(result.dependencies.size, 0)
  assert.equal(fetchFn.calls.length, 1)
})

test('listDependencies keeps the raw JSON and the resolved URL apart', () => {
  const listed = listDependencies({ buffers: [{ uri: 'a.bin' }], images: [{ uri: 'a.bin' }] }, 'https://h/m/m.gltf')
  assert.equal(listed.ok, true)
  assert.equal(listed.dependencies.length, 1)
  assert.deepEqual(listed.dependencies[0], { uri: 'a.bin', url: 'https://h/m/a.bin', isData: false })
})

// ---------------------------------------------------------------------------
// A4 — the world transfer ledger
// ---------------------------------------------------------------------------

test('A4: the ledger is charged as chunks arrive and never refunds a failure', async () => {
  const ledger = createWorldLedger({ worldBytes: 100 })
  const url = 'https://h/m.glb'
  const fetchFn = stubFetch({ [url]: response(glbBytes(200), { chunk: 64 }) })
  const result = await fetchModel({ url, fetchFn, ledger, limits: { ...MODEL_LIMITS, timeoutMs: 1000 } })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'world-download-budget')
  assert.ok(ledger.charged > 100, 'the bytes are charged, not refunded')
})

test('A4/A10: the download that crosses the ledger is aborted mid-stream and later ones never start', async () => {
  const ledger = createWorldLedger({ worldBytes: 150 })
  const first = 'https://h/first.glb'
  const second = 'https://h/second.glb'
  let cancellations = 0
  const fetchFn = stubFetch({
    [first]: () => {
      const stream = new ReadableStream({
        start(controller) { for (let i = 0; i < 8; i++) controller.enqueue(new Uint8Array(40)) ; controller.close() },
        cancel() { cancellations += 1 },
      })
      return { ok: true, status: 200, redirected: false, url: first, headers: new Headers(), body: stream }
    },
    [second]: () => {
      const stream = new ReadableStream({
        start(controller) { controller.enqueue(glbBytes()); controller.close() },
        cancel() { cancellations += 1 },
      })
      return { ok: true, status: 200, redirected: false, url: second, headers: new Headers(), body: stream }
    },
  })
  const limits = { ...MODEL_LIMITS, timeoutMs: 1000 }
  const a = await fetchModel({ url: first, fetchFn, ledger, limits })
  assert.equal(a.reason, 'world-download-budget')
  assert.ok(cancellations >= 1, 'the crossing download was aborted, not completed')
  assert.ok(ledger.over, 'the world is over its limit')
  // A queued or later model fails world-download-budget without a request.
  const callsBefore = fetchFn.calls.length
  const b = await fetchModel({ url: second, fetchFn, ledger, limits })
  assert.equal(b.reason, 'world-download-budget')
  assert.equal(fetchFn.calls.length, callsBefore, 'later models never start')
})

test('A4: two models share one ledger, and the total is what crosses', async () => {
  const ledger = createWorldLedger({ worldBytes: 150 })
  const a = 'https://h/a.glb'
  const b = 'https://h/b.glb'
  const fetchFn = stubFetch({
    [a]: () => response(glbBytes(90), { chunk: 90 }),
    [b]: () => response(glbBytes(90), { chunk: 30 }),
  })
  const limits = { ...MODEL_LIMITS, timeoutMs: 1000 }
  assert.equal((await fetchModel({ url: a, fetchFn, ledger, limits })).ok, true)
  const second = await fetchModel({ url: b, fetchFn, ledger, limits })
  assert.equal(second.reason, 'world-download-budget')
  assert.ok(ledger.charged > 150)
})

// ---------------------------------------------------------------------------
// M2 (round 6) — a redirected .gltf resolves its dependencies against its FINAL
// url
//
// Round 5 checked `response.url` after a redirect and then dropped it:
// `readBody` answered `{ ok, bytes }` with no url, so `first.url` was always
// undefined and `effectiveUrl` fell back to the PRE-redirect URL. A model
// redirected into a subdirectory then asked for `textures/d.png` beside the
// redirect source instead of beside the file that actually arrived.
// ---------------------------------------------------------------------------

test('M2: a root-relative .gltf redirected on the same origin resolves dependencies against the final url', async () => {
  const spec = '/models/a.gltf'
  const asked = 'https://world.example/models/a.gltf'
  const final = 'https://world.example/lib/chair/model.gltf'
  const fetchFn = stubFetch({
    [asked]: () => response(GLTF_JSON({ buffers: [{ uri: 'textures/d.png', byteLength: 4 }] }), { redirected: true, url: final }),
    'https://world.example/lib/chair/textures/d.png': () => response(glbBytes(4)),
  })
  const result = await fetchModel({ url: spec, fetchFn, worldBaseUrl: 'https://world.example/index.html' })
  assert.equal(result.ok, true, result.message)
  assert.equal(result.effectiveUrl, final, 'the final url is what the caller gets back')
  assert.deepEqual(fetchFn.calls.map((c) => c.url), [asked, 'https://world.example/lib/chair/textures/d.png'],
    'the dependency resolves against the redirect target, not the redirect source')
  assert.deepEqual([...result.dependencies.keys()], ['textures/d.png'])
})

test('M2: an absolute https redirect across origins does the same', async () => {
  const asked = 'https://cdn.example.com/a.gltf'
  const final = 'https://other.example/lib/chair/model.gltf'
  const fetchFn = stubFetch({
    [asked]: () => response(GLTF_JSON({ buffers: [{ uri: 'textures/d.png', byteLength: 4 }] }), { redirected: true, url: final }),
    'https://other.example/lib/chair/textures/d.png': () => response(glbBytes(4)),
  })
  const result = await fetchModel({ url: asked, fetchFn })
  assert.equal(result.ok, true, result.message)
  assert.equal(result.effectiveUrl, final)
  assert.deepEqual(fetchFn.calls.map((c) => c.url), [asked, 'https://other.example/lib/chair/textures/d.png'])
})

test('M2: an unredirected response still reports the url it was asked for', async () => {
  const url = 'https://cdn.example.com/m.glb'
  const fetchFn = stubFetch({ [url]: () => response(glbBytes(), { url }) })
  const result = await fetchModel({ url, fetchFn })
  assert.equal(result.ok, true)
  assert.equal(result.effectiveUrl, url)
})

// ---------------------------------------------------------------------------
// M3 (round 6) — ONE deadline per job
//
// Round 5's fetcher ran its own 30 s timer and stopped it when `fetchModel`
// returned; `parseTemplate` then started a second 30 s of its own, so one model
// could spend about 60 s of its own work. The deadline is set at the job's
// first request, passes into the fetch, the preflight and the parse, and counts
// WORK: waiting for earlier models' admission (W5) or for the parse queue is
// excluded.
// ---------------------------------------------------------------------------

test('M3: a deadline set at the first request spends what is left of it', async () => {
  let clock = 0
  const deadline = createJobDeadline({ timeoutMs: 1, now: () => clock })
  const fetchFn = stubFetch({ 'https://h/m.glb': () => response(glbBytes()) })
  deadline.start()
  clock += 5
  const result = await fetchModel({ url: 'https://h/m.glb', fetchFn, deadline })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'timeout')
  assert.equal(fetchFn.calls.length, 0, 'a job past its deadline makes no request')
})

test('M3: the fetcher’s own timer is the deadline’s remaining time', async () => {
  let clock = 0
  const deadline = createJobDeadline({ timeoutMs: 40, now: () => clock })
  deadline.start()
  clock += 30                       // a stage already used 30 of the 40 ms
  const started = Date.now()
  const fetchFn = (url, options) => new Promise((_, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')))
  })
  const result = await fetchModel({ url: 'https://h/m.glb', fetchFn, deadline })
  const took = Date.now() - started
  assert.equal(result.reason, 'timeout', result.message)
  assert.ok(took < 500, `the remaining 10 ms is the budget, not a fresh 30 s (took ${took} ms)`)
})

test('M3: a deadline counts work, not waiting', () => {
  let clock = 0
  const deadline = createJobDeadline({ timeoutMs: 30_000, now: () => clock })
  deadline.start()
  clock += 20_000                   // the fetch
  deadline.pause()
  clock += 20_000                   // waiting in the admission/parse queue
  deadline.resume()
  assert.equal(deadline.elapsedMs, 20_000, 'the wait is not counted')
  assert.equal(deadline.expired(), false)
  clock += 20_000
  assert.equal(deadline.expired(), true, 'its own work is')
  assert.equal(deadline.remainingMs(), 0)
})

test('M3: a deadline that was never started is never expired', () => {
  const deadline = createJobDeadline({ timeoutMs: 1, now: () => 1_000_000 })
  assert.equal(deadline.started, false)
  assert.equal(deadline.expired(), false)
  assert.equal(deadline.remainingMs(), 1)
})

// ---------------------------------------------------------------------------
// S2 and S5 (round 6) — the fetcher's two should-fixes
// ---------------------------------------------------------------------------

test('S2: a dependency carrying credentials is refused by A1 itself', async () => {
  const url = 'https://cdn.example.com/chair.gltf'
  const fetchFn = stubFetch({
    [url]: () => response(GLTF_JSON({ buffers: [{ uri: 'https://user:pw@cdn.example.com/m.bin', byteLength: 4 }] })),
  })
  const result = await fetchModel({ url, fetchFn })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'bad-dependency')
  assert.equal(fetchFn.calls.length, 1, 'only the model was asked for')

  // A root-relative model's dependency is A1-checked as well as same-origin.
  const relativeFetch = stubFetch({
    'https://world.example/chair.gltf': () => response(GLTF_JSON({ buffers: [{ uri: 'https://user:pw@world.example/m.bin', byteLength: 4 }] })),
  })
  const relative = await fetchModel({ url: '/chair.gltf', worldBaseUrl: 'https://world.example/index.html', fetchFn: relativeFetch })
  assert.equal(relative.reason, 'bad-dependency')
})

test('S2: listDependencies validates every non-data dependency with A1', () => {
  const json = {
    buffers: [{ uri: 'https://user:pw@h/m.bin' }],
    images: [{ uri: 'data:image/png;base64,AAAA' }],
  }
  const result = listDependencies(json, 'https://h/chair.gltf')
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'bad-dependency')
  assert.deepEqual(listDependencies({ images: [{ uri: 'data:image/png;base64,AAAA' }] }, 'https://h/c.gltf').dependencies,
    [{ uri: 'data:image/png;base64,AAAA', url: 'data:image/png;base64,AAAA', isData: true }])
})

/** A response with NO readable stream: only `arrayBuffer()`, as a stub server sends. */
function bufferResponse(body, { status = 200, url = 'https://h/m.glb' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    redirected: false,
    url,
    headers: new Headers(),
    body: null,
    arrayBuffer: async () => (body instanceof Uint8Array ? body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) : bytes(body).buffer),
  }
}

test('S5: the non-streaming body path applies the 25 MiB cap', async () => {
  const url = 'https://h/big.glb'
  const fetchFn = stubFetch({ [url]: () => bufferResponse(new Uint8Array(MODEL_LIMITS.modelBytes + 1)) })
  const result = await fetchModel({ url, fetchFn })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'too-large')
})

test('S5: the non-streaming body path charges the world ledger and can cross it', async () => {
  const url = 'https://h/m.glb'
  const ledger = createWorldLedger({ worldBytes: 4 })
  const fetchFn = stubFetch({ [url]: () => bufferResponse(new Uint8Array(8)) })
  const result = await fetchModel({ url, fetchFn, ledger })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'world-download-budget')
  assert.equal(ledger.charged, 8, 'the bytes are still charged (A4 never refunds)')
})

test('S5: a non-streaming body that fits is still fine', async () => {
  const url = 'https://h/m.glb'
  const fetchFn = stubFetch({ [url]: () => bufferResponse(glbBytes(4)) })
  const ledger = createWorldLedger({ worldBytes: 1_000 })
  const result = await fetchModel({ url, fetchFn, ledger })
  assert.equal(result.ok, true, result.message)
  assert.equal(result.bytes.length, 12)
  assert.equal(ledger.charged, 12)
})
