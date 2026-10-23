// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// load-background.test.js — library-sky step 3 (Z3). The sky controller.
//
// No browser and no network: `fetchImage` and `decode` are injected, so every
// generation, disposal, blob-URL revocation and reporting decision is driven
// from the test. The scene's two slots are the observable state.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  createSkyLoader, skyHeaderProblem, skyReasonText,
  SKY_MAX_SIDE, SKY_MAX_AREA, SKY_DECODE_TIMEOUT_MS,
  SKY_RETRYABLE_REASONS, isSkyRetryable,
} from '../src/load-background.js'
import { SKY_RETRYABLE_REASONS as SOURCE_RETRYABLE } from '@atrium/client/model-fetch'
import { imageHeader } from '../src/model-parse.js'

const A = 'https://cdn.example.com/a.jpg'
const B = 'https://cdn.example.com/b.jpg'

const tick = () => new Promise((resolve) => setImmediate(resolve))

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function texture(name) {
  return {
    name, disposed: 0, mapping: null, colorSpace: null,
    dispose() { this.disposed += 1 },
  }
}

// ── Real image headers, built byte by byte ──────────────────────────────────

function pngBytes(width, height) {
  const b = new Uint8Array(29)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  b.set([0, 0, 0, 13], 8)
  b.set([0x49, 0x48, 0x44, 0x52], 12)          // IHDR
  b[16] = width >> 24; b[17] = width >> 16; b[18] = width >> 8; b[19] = width
  b[20] = height >> 24; b[21] = height >> 16; b[22] = height >> 8; b[23] = height
  b[24] = 8                                     // bit depth
  b[25] = 2                                     // colour type (RGB)
  return b
}

function jpegBytes(width, height) {
  return Uint8Array.from([
    0xff, 0xd8,                                   // SOI
    0xff, 0xc0, 0x00, 0x08, 8,                    // SOF0, length 8, precision
    height >> 8, height & 0xff,
    width >> 8, width & 0xff,
  ])
}

function webpBytes(width, height) {
  const b = new Uint8Array(30)
  b.set([0x52, 0x49, 0x46, 0x46], 0)             // RIFF
  b.set([0x57, 0x45, 0x42, 0x50], 8)             // WEBP
  b.set([0x56, 0x50, 0x38, 0x20], 12)            // 'VP8 '
  b[26] = width & 0xff; b[27] = (width >> 8) & 0xff
  b[28] = height & 0xff; b[29] = (height >> 8) & 0xff
  return b
}

const GOOD_WEBP = webpBytes(3072, 1536)          // the fixture's shape

// ── The harness ────────────────────────────────────────────────────────────

/** A `fetchImage` whose every call is resolved by the test. */
function stubFetchImage() {
  const calls = []
  const fetchImage = ({ url, worldBaseUrl, signal }) => {
    const d = deferred()
    const call = { url, worldBaseUrl, signal, aborted: false, ...d }
    signal?.addEventListener?.('abort', () => { call.aborted = true }, { once: true })
    calls.push(call)
    return d.promise
  }
  fetchImage.calls = calls
  return fetchImage
}

function harness({ decodeTimeoutMs = SKY_DECODE_TIMEOUT_MS } = {}) {
  const scene = new THREE.Scene()
  const fetchImage = stubFetchImage()
  const decodes = []
  const created = []
  const revoked = []
  const logs = []
  const sky = createSkyLoader({
    scene,
    fetchImage,
    decodeTimeoutMs,
    // V2 — the injected log, so every reported failure is observable.
    log: (line) => logs.push(line),
    createObjectURL: (blob) => { const url = `blob:mock-${created.length}`; created.push({ url, blob }); return url },
    revokeObjectURL: (url) => { revoked.push(url) },
    decode: (blobUrl) => {
      const d = deferred()
      decodes.push({ blobUrl, ...d })
      return d.promise
    },
  })
  return { scene, sky, fetchImage, decodes, created, revoked, logs }
}

/** Resolve the nth fetch with a good image, then let the controller reach decode. */
async function arrive(h, index, bytes = GOOD_WEBP) {
  const call = h.fetchImage.calls[index]
  call.resolve({ ok: true, bytes, url: call.url })
  await tick()
}

/** A background object carrying `url`. */
const sky = (url) => ({ type: 'equirectangular', texture: url })

// ===========================================================================
// The header checks (L26)
// ===========================================================================

describe('skyHeaderProblem — each format, each limit', () => {
  test('PNG, JPEG and WebP pass', () => {
    assert.equal(skyHeaderProblem(imageHeader(pngBytes(3072, 1536))), null)
    assert.equal(skyHeaderProblem(imageHeader(jpegBytes(4096, 2048))), null)
    assert.equal(skyHeaderProblem(imageHeader(webpBytes(2048, 1024))), null)
  })

  test('any other format is unsupported-image', () => {
    assert.equal(skyHeaderProblem(imageHeader(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))), 'unsupported-image')
    assert.equal(skyHeaderProblem(null), 'unsupported-image')
  })

  test('a truncated header is unsupported-image, never a 0 × 0 image', () => {
    const whole = pngBytes(64, 64)
    for (const length of [1, 8, 12, 20, 25]) {
      assert.equal(skyHeaderProblem(imageHeader(whole.subarray(0, length))), 'unsupported-image',
        `a ${length}-byte PNG header`)
    }
    assert.equal(skyHeaderProblem(imageHeader(jpegBytes(64, 64).subarray(0, 8))), 'unsupported-image')
    assert.equal(skyHeaderProblem(imageHeader(webpBytes(64, 64).subarray(0, 20))), 'unsupported-image')
  })

  test('a zero side is bad-size', () => {
    assert.equal(skyHeaderProblem(imageHeader(pngBytes(0, 512))), 'bad-size')
    assert.equal(skyHeaderProblem(imageHeader(pngBytes(512, 0))), 'bad-size')
  })

  test('a side over 4096 is too-large-dimensions', () => {
    assert.equal(skyHeaderProblem(imageHeader(pngBytes(4097, 1024))), 'too-large-dimensions')
    assert.equal(skyHeaderProblem(imageHeader(pngBytes(1024, 4097))), 'too-large-dimensions')
  })

  test('an area over 4096 × 2048 is refused even when both sides fit', () => {
    assert.equal(SKY_MAX_SIDE, 4096)
    assert.equal(SKY_MAX_AREA, 4096 * 2048)
    // 4096 × 2049 is over the area, with no side over the limit.
    assert.equal(skyHeaderProblem(imageHeader(pngBytes(4096, 2049))), 'too-large-dimensions')
    assert.equal(skyHeaderProblem(imageHeader(pngBytes(4096, 2048))), null, 'the exact area passes')
  })

  test('the fixture 3072 × 1536 passes (L26)', () => {
    assert.equal(skyHeaderProblem(imageHeader(webpBytes(3072, 1536))), null)
  })

  test('every sky reason has plain text', () => {
    for (const code of ['unsupported-image', 'bad-size', 'too-large-dimensions', 'decode', 'empty', 'failed']) {
      assert.equal(typeof skyReasonText(code), 'string', code)
      assert.ok(skyReasonText(code).length > 0, code)
    }
  })
})

// ===========================================================================
// What is a sky, and what is not
// ===========================================================================

describe('update — no sky', () => {
  test('a missing, empty or wrong-typed background clears, and fetches nothing', async () => {
    const h = harness()
    for (const bg of [undefined, null, {}, { texture: '' }, { texture: 42 }, { type: 'cubemap', texture: A }]) {
      const result = await h.sky.update(bg, null)
      assert.deepEqual(result, { ok: true }, JSON.stringify(bg))
    }
    assert.equal(h.fetchImage.calls.length, 0, 'no request for a world with no sky')
    assert.equal(h.scene.background, null)
    assert.equal(h.scene.environment, null)
  })

  test('clearing disposes the loaded texture', async () => {
    const h = harness()
    const p = h.sky.update(sky(A), null)
    await tick()
    await arrive(h, 0)
    h.decodes[0].resolve(texture('A'))
    await p
    const loadedTexture = h.sky.loaded.texture
    assert.equal(h.scene.background, loadedTexture)

    await h.sky.update({ texture: '' }, null)
    assert.equal(loadedTexture.disposed, 1, 'the texture is disposed on clear')
    assert.equal(h.scene.background, null)
    assert.equal(h.scene.environment, null)
    assert.equal(h.sky.loaded, null)
    assert.equal(h.sky.failedUrl, null)
  })

  test('a document-relative value is refused, with its reason, and nothing is fetched', async () => {
    const h = harness()
    const result = await h.sky.update({ type: 'equirectangular', texture: 'skyboxtest1.png' }, null)
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'url-scheme')
    assert.equal(h.fetchImage.calls.length, 0)
    assert.equal(h.scene.background, null)
  })

  test('a root path with no world base is refused no-base', async () => {
    const h = harness()
    const result = await h.sky.update({ texture: '/tests/fixtures/skyboxtest1.png' }, null)
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'no-base')
    assert.equal(h.fetchImage.calls.length, 0)
  })

  test('a root path resolves against the world base and loads', async () => {
    const h = harness()
    const base = 'https://world.example/worlds/josh/room'
    const p = h.sky.update({ texture: '/tests/fixtures/skyboxtest1.png' }, base)
    await tick()
    assert.equal(h.fetchImage.calls[0].url, 'https://world.example/tests/fixtures/skyboxtest1.png')
    await arrive(h, 0)
    h.decodes[0].resolve(texture('A'))
    assert.deepEqual(await p, { ok: true })
  })
})

// ===========================================================================
// The happy path
// ===========================================================================

describe('update — a successful sky', () => {
  test('both slots are set, from the one controller that owns them', async () => {
    const h = harness()
    const p = h.sky.update(sky(A), null)
    await tick()
    await arrive(h, 0)
    const tex = texture('A')
    h.decodes[0].resolve(tex)
    assert.deepEqual(await p, { ok: true })
    assert.equal(h.scene.background, tex)
    assert.equal(h.scene.environment, tex)
    assert.equal(tex.mapping, THREE.EquirectangularReflectionMapping)
    assert.equal(tex.colorSpace, THREE.SRGBColorSpace)
    assert.deepEqual(h.sky.loaded, { url: A, texture: tex })
    assert.equal(h.sky.failedUrl, null)
    assert.equal(h.sky.pending, null)
  })

  test('the blob URL is revoked on success', async () => {
    const h = harness()
    const p = h.sky.update(sky(A), null)
    await tick()
    await arrive(h, 0)
    h.decodes[0].resolve(texture('A'))
    await p
    assert.equal(h.created.length, 1)
    assert.deepEqual(h.revoked, [h.created[0].url], 'the blob URL is revoked when the decode settles')
  })

  test('a repeated world:loaded keeps its sky without a fetch (R1)', async () => {
    const h = harness()
    const p = h.sky.update(sky(A), null)
    await tick()
    await arrive(h, 0)
    const tex = texture('A')
    h.decodes[0].resolve(tex)
    await p

    // `world:loaded` used to clear both slots before loading; the repeat is what
    // must not lose the sky.
    h.scene.background = null
    h.scene.environment = null

    assert.deepEqual(await h.sky.update(sky(A), null), { ok: true })
    assert.equal(h.scene.background, tex, 'the sky is re-asserted')
    assert.equal(h.scene.environment, tex)
    assert.equal(h.fetchImage.calls.length, 1, 'no second fetch for an unchanged URL')
    assert.equal(h.decodes.length, 1, 'no second decode')
  })

  test('a new value disposes the old texture', async () => {
    const h = harness()
    const pA = h.sky.update(sky(A), null)
    await tick()
    await arrive(h, 0)
    const texA = texture('A')
    h.decodes[0].resolve(texA)
    await pA

    const pB = h.sky.update(sky(B), null)
    await tick()
    await arrive(h, 1)
    const texB = texture('B')
    h.decodes.at(-1).resolve(texB)
    await pB

    assert.equal(texA.disposed, 1, 'the previous texture is disposed on a change')
    assert.equal(h.scene.background, texB)
    assert.deepEqual(h.sky.loaded, { url: B, texture: texB })
  })
})

// ===========================================================================
// Failures
// ===========================================================================

describe('update — failures', () => {
  test('a refused fetch leaves NO sky and reports the reason', async () => {
    const h = harness()
    const p = h.sky.update(sky(A), null)
    await tick()
    h.fetchImage.calls[0].resolve({ ok: false, reason: 'network', message: 'offline' })
    const result = await p
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'network')
    assert.equal(h.scene.background, null)
    assert.equal(h.scene.environment, null)
    assert.equal(h.sky.loaded, null)
    assert.equal(h.sky.failedUrl, A)
  })

  test('a world whose sky fails shows no sky, never the previous one', async () => {
    const h = harness()
    const pA = h.sky.update(sky(A), null)
    await tick()
    await arrive(h, 0)
    const texA = texture('A')
    h.decodes[0].resolve(texA)
    await pA
    assert.equal(h.scene.background, texA)

    const pB = h.sky.update(sky(B), null)
    await tick()
    h.fetchImage.calls[1].resolve({ ok: false, reason: 'http', message: 'the server refused the request (404)' })
    await pB
    assert.equal(h.scene.background, null, 'the old sky is not kept')
    assert.equal(h.scene.environment, null)
    assert.equal(texA.disposed, 1)
  })

  test('an oversize image is refused by its header, and no blob is made', async () => {
    const h = harness()
    const p = h.sky.update(sky(A), null)
    await tick()
    await arrive(h, 0, webpBytes(4096, 4096))     // 16.7 Mpx, over 4096 × 2048
    const result = await p
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'too-large-dimensions')
    assert.equal(h.created.length, 0, 'the bytes never reach the decoder')
    assert.equal(h.scene.background, null)
    assert.equal(h.sky.failedUrl, A)
  })

  test('a decode that fails reports decode, and the blob URL is revoked', async () => {
    const h = harness()
    const p = h.sky.update(sky(A), null)
    await tick()
    await arrive(h, 0)
    h.decodes[0].reject(new Error('bad image'))
    const result = await p
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'decode')
    assert.deepEqual(h.revoked, [h.created[0].url])
    assert.equal(h.scene.background, null)
  })

  test('a decode past its bound fails with decode, and its late texture is disposed', async () => {
    const h = harness({ decodeTimeoutMs: 20 })
    const p = h.sky.update(sky(A), null)
    await tick()
    await arrive(h, 0)
    const result = await p
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'decode', 'a decode that never settles ends at its bound')
    assert.deepEqual(h.revoked, [h.created[0].url], 'the blob URL is revoked on every outcome')

    const late = texture('late')
    h.decodes[0].resolve(late)
    await tick()
    assert.equal(late.disposed, 1, 'a decode that settles after the bound is disposed then')
    assert.equal(h.scene.background, null)
  })
})

// ===========================================================================
// The newest value wins (R1, R4, re-review 2)
// ===========================================================================

describe('update — supersession', () => {
  test('a stale decode that succeeds is disposed and changes no slot', async () => {
    const h = harness()
    const pA = h.sky.update(sky(A), null)
    await tick()
    await arrive(h, 0)                     // A is decoding
    const pB = h.sky.update(sky(B), null)  // B supersedes A
    await tick()

    const stale = texture('A')
    h.decodes[0].resolve(stale)
    await tick()
    assert.equal(stale.disposed, 1, 'a superseded decode is disposed when it settles')
    assert.equal(h.scene.background, null, 'and it changes no slot')
    assert.equal(h.created.length, 1, 'only A made a blob URL so far')
    assert.deepEqual(h.revoked, [h.created[0].url], 'its blob URL was revoked')

    await arrive(h, 1)
    const texB = texture('B')
    h.decodes.at(-1).resolve(texB)
    assert.deepEqual(await pB, { ok: true })
    assert.equal(h.scene.background, texB)
    assert.deepEqual(await pA, { ok: false, reason: 'superseded' })
  })

  test('a stale failure does not clear a newer sky (R4)', async () => {
    const h = harness()
    const pA = h.sky.update(sky(A), null)   // A is fetching
    await tick()
    const pB = h.sky.update(sky(B), null)   // B cancels A
    await tick()
    assert.equal(h.fetchImage.calls[0].aborted, true, "A's request was aborted")

    await arrive(h, 1)
    const texB = texture('B')
    h.decodes.at(-1).resolve(texB)
    assert.deepEqual(await pB, { ok: true })
    assert.equal(h.scene.background, texB)

    // A settles late, and fails.
    h.fetchImage.calls[0].resolve({ ok: false, reason: 'network', message: 'late failure' })
    assert.deepEqual(await pA, { ok: false, reason: 'superseded' })
    assert.equal(h.scene.background, texB, 'a stale failure changes nothing')
    assert.equal(h.sky.loaded.url, B)
    assert.equal(h.sky.failedUrl, null)
  })

  test('A loaded → B pending → A again: A stays shown, B is cancelled and its late texture disposed', async () => {
    const h = harness()
    const pA = h.sky.update(sky(A), null)
    await tick()
    await arrive(h, 0)
    const texA = texture('A')
    h.decodes[0].resolve(texA)
    await pA

    const pB = h.sky.update(sky(B), null)   // B starts fetching
    await tick()
    assert.equal(h.fetchImage.calls.length, 2)
    await arrive(h, 1)                      // B is decoding when A is chosen again

    assert.deepEqual(await h.sky.update(sky(A), null), { ok: true })
    assert.equal(h.scene.background, texA, 'A stays shown')
    assert.equal(texA.disposed, 0)
    assert.equal(h.fetchImage.calls.length, 2, 're-asserting A starts no new fetch')

    // B's decode completes late: its texture is disposed and A stays shown.
    const staleB = texture('B')
    h.decodes.at(-1).resolve(staleB)
    await tick()
    assert.equal(staleB.disposed, 1, "B's late texture is disposed")
    assert.equal(h.scene.background, texA, 'A is still shown')
    assert.deepEqual(await pB, { ok: false, reason: 'superseded' })
  })

  test('B pending, then the previously failed URL is chosen: B is cancelled', async () => {
    const h = harness()
    const pFail = h.sky.update(sky(A), null)
    await tick()
    h.fetchImage.calls[0].resolve({ ok: false, reason: 'network', message: 'nope' })
    await pFail
    assert.equal(h.sky.failedUrl, A)

    const pB = h.sky.update(sky(B), null)
    await tick()
    assert.equal(h.fetchImage.calls.length, 2)

    const again = await h.sky.update(sky(A), null)
    assert.equal(again.ok, false, 'the failed URL is still not fetched')
    assert.equal(h.fetchImage.calls[1].aborted, true, 'B was cancelled by the newer value')
    assert.equal(h.fetchImage.calls.length, 2, 'and A is not refetched')

    h.fetchImage.calls[1].resolve({ ok: true, bytes: GOOD_WEBP, url: B })
    assert.deepEqual(await pB, { ok: false, reason: 'superseded' })
  })

  test("a failed URL is not refetched on a rename, and retry() of the same URL succeeds (R7)", async () => {
    const h = harness()
    const p = h.sky.update(sky(A), null)
    await tick()
    h.fetchImage.calls[0].resolve({ ok: false, reason: 'network', message: 'nope' })
    await p
    assert.equal(h.sky.failedUrl, A)

    // A rename: `som:set` of __document__ with the same background.
    await h.sky.update(sky(A), null)
    assert.equal(h.fetchImage.calls.length, 1, 'the failed URL is not refetched on a rename')

    const retried = h.sky.retry()
    await tick()
    assert.equal(h.fetchImage.calls.length, 2, 'retry() tries it again')
    await arrive(h, 1)
    const tex = texture('A again')
    h.decodes.at(-1).resolve(tex)
    assert.deepEqual(await retried, { ok: true })
    assert.equal(h.scene.background, tex)
    assert.equal(h.sky.failedUrl, null)
  })
})

// ===========================================================================
// World boundaries (R1, re-review 3)
// ===========================================================================

describe('resetWorld and dispose', () => {
  test('resetWorld while a sky loads: the next world issues a new request and the old one is aborted', async () => {
    const h = harness()
    const pA = h.sky.update(sky(A), null)
    await tick()
    assert.equal(h.fetchImage.calls.length, 1)

    h.sky.resetWorld()                       // a static .gltf loads in a new world
    assert.equal(h.fetchImage.calls[0].aborted, true)
    assert.equal(h.scene.background, null)
    assert.equal(h.sky.loaded, null)
    assert.equal(h.sky.failedUrl, null)

    const pAgain = h.sky.update(sky(A), null)  // the same URL, the next world
    await tick()
    assert.equal(h.fetchImage.calls.length, 2, 'a new world never reuses the old request')
    await arrive(h, 1)
    const tex = texture('A')
    h.decodes.at(-1).resolve(tex)
    assert.deepEqual(await pAgain, { ok: true })
    assert.equal(h.scene.background, tex)

    // The first world's request settles late: nothing changes.
    h.fetchImage.calls[0].resolve({ ok: true, bytes: GOOD_WEBP, url: A })
    assert.deepEqual(await pA, { ok: false, reason: 'superseded' })
    assert.equal(h.decodes.length, 1, 'the old generation never reached a decode')
    assert.equal(h.scene.background, tex)
  })

  test('a sky that failed in the first world is fetched again in the second', async () => {
    const h = harness()
    const pFail = h.sky.update(sky(A), null)
    await tick()
    h.fetchImage.calls[0].resolve({ ok: false, reason: 'network', message: 'nope' })
    await pFail
    assert.equal(h.sky.failedUrl, A)

    h.sky.resetWorld()
    assert.equal(h.sky.failedUrl, null, 'a world change forgets the failure')

    const pAgain = h.sky.update(sky(A), null)
    await tick()
    assert.equal(h.fetchImage.calls.length, 2, 'and fetches it again')
    await arrive(h, 1)
    const tex = texture('A')
    h.decodes.at(-1).resolve(tex)
    assert.deepEqual(await pAgain, { ok: true })
  })

  test('resetWorld disposes the loaded texture and nulls both slots', async () => {
    const h = harness()
    const p = h.sky.update(sky(A), null)
    await tick()
    await arrive(h, 0)
    const tex = texture('A')
    h.decodes[0].resolve(tex)
    await p

    h.sky.resetWorld()
    assert.equal(tex.disposed, 1)
    assert.equal(h.scene.background, null)
    assert.equal(h.scene.environment, null)
    assert.equal(h.sky.loaded, null)
    assert.equal(h.sky.pending, null)
    assert.equal(h.sky.failedUrl, null)
  })

  test('dispose() is a world reset, and later calls do nothing', async () => {
    const h = harness()
    const p = h.sky.update(sky(A), null)
    await tick()
    await arrive(h, 0)
    const tex = texture('A')
    h.decodes[0].resolve(tex)
    await p

    h.sky.dispose()
    assert.equal(tex.disposed, 1)
    assert.equal(h.scene.background, null)
    assert.equal(h.sky.disposed, true)

    const callsBefore = h.fetchImage.calls.length
    h.sky.dispose()
    const after = await h.sky.update(sky(B), null)
    assert.equal(after.ok, false)
    assert.equal(after.reason, 'disposed')
    assert.equal(h.fetchImage.calls.length, callsBefore, 'a disposed loader fetches nothing')
  })

  test('the loader alone writes the slots — nothing else may race them', async () => {
    const h = harness()
    const p = h.sky.update(sky(A), null)
    await tick()
    await arrive(h, 0)
    const tex = texture('A')
    h.decodes[0].resolve(tex)
    await p
    // Whatever a caller did to the slots, the controller re-asserts its own.
    h.scene.background = 'something else'
    h.scene.environment = null
    await h.sky.update(sky(A), null)
    assert.equal(h.scene.background, tex)
    assert.equal(h.scene.environment, tex)
  })

  test('resetWorld while a decode is pending revokes the blob URL and disposes the late texture', async () => {
    const h = harness()
    const p = h.sky.update(sky(A), null)
    await tick()
    await arrive(h, 0)                        // the decode is in flight
    assert.equal(h.created.length, 1)
    assert.deepEqual(h.revoked, [], 'the blob URL lives until the decode settles')

    h.sky.resetWorld()                        // a world change mid-decode
    assert.equal(h.scene.background, null)

    const late = texture('A')
    h.decodes[0].resolve(late)
    await tick()
    assert.deepEqual(h.revoked, [h.created[0].url], 'the blob URL is revoked when it settles')
    assert.equal(late.disposed, 1, 'and the texture it made is disposed')
    assert.equal(h.scene.background, null, 'no slot is touched')
    assert.deepEqual(await p, { ok: false, reason: 'superseded' })
  })
})

// ===========================================================================
// The failure log (V2, round 2)
// ===========================================================================

describe('the failure log (V2)', () => {
  test('a current failure is logged once, with its reason code and its URL', async () => {
    const h = harness()
    const p = h.sky.update(sky(A), null)
    await tick()
    h.fetchImage.calls[0].resolve({ ok: false, reason: 'http', message: 'the server refused the request (404)' })
    assert.deepEqual(await p, { ok: false, reason: 'http', message: 'the server refused the request (404)' })
    assert.deepEqual(h.logs, [`[sky] the server refused the request (404) (http) — ${A}`])
  })

  test('a failure with no message of its own logs the reason text', async () => {
    const h = harness()
    const p = h.sky.update(sky(A), null)
    await tick()
    h.fetchImage.calls[0].resolve({ ok: false, reason: 'timeout' })
    await p
    assert.deepEqual(h.logs, [`[sky] ${skyReasonText('timeout')} (timeout) — ${A}`])
  })

  test('a refusal by rule is logged too, with the refused VALUE', async () => {
    const h = harness()
    const value = 'skyboxtest1.png'
    const result = await h.sky.update({ type: 'equirectangular', texture: value }, null)
    assert.equal(result.ok, false)
    assert.equal(h.fetchImage.calls.length, 0, 'nothing is fetched for a refused value')
    assert.deepEqual(h.logs, [`[sky] ${skyReasonText(result.reason)} (${result.reason}) — ${value}`])
  })

  test('a superseded result is not logged', async () => {
    const h = harness()
    const pA = h.sky.update(sky(A), null)
    await tick()
    const pB = h.sky.update(sky(B), null)
    await tick()
    h.fetchImage.calls[0].resolve({ ok: false, reason: 'network', message: 'late' })
    assert.deepEqual(await pA, { ok: false, reason: 'superseded' })
    assert.deepEqual(h.logs, [], 'a stale failure writes nothing')
    h.fetchImage.calls[1].resolve({ ok: true, bytes: GOOD_WEBP, url: B })
    await tick()
    h.decodes[0].resolve(texture('B'))
    assert.deepEqual(await pB, { ok: true })
  })

  test('a success is not logged', async () => {
    const h = harness()
    const p = h.sky.update(sky(A), null)
    await tick()
    await arrive(h, 0)
    h.decodes[0].resolve(texture('A'))
    assert.deepEqual(await p, { ok: true })
    assert.deepEqual(h.logs, [])
  })

  test('the failedUrl shortcut re-reports the failure once, and never again', async () => {
    const h = harness()
    const p = h.sky.update(sky(A), null)
    await tick()
    h.fetchImage.calls[0].resolve({ ok: false, reason: 'http', message: 'gone (500)' })
    await p
    assert.equal(h.logs.length, 1, 'the failure itself is logged')

    // A rename: the shortcut answers, and reports the failure one more time.
    await h.sky.update(sky(A), null)
    assert.equal(h.fetchImage.calls.length, 1, 'and it is not refetched')
    assert.equal(h.logs.length, 2, 'the first shortcut hit re-reports it')

    // Every later rename is silent.
    await h.sky.update(sky(A), null)
    await h.sky.update(sky(A), null)
    assert.equal(h.logs.length, 2, 'the second and later hits are silent')
  })

  test('a viewer who is not the owner logs the same line (no owner branch)', async () => {
    // The loader has no notion of ownership or Edit mode: the line is written
    // for every caller. Its only switch is the injected `log` itself.
    const h = harness()
    const p = h.sky.update(sky(A), null)
    await tick()
    h.fetchImage.calls[0].resolve({ ok: false, reason: 'network' })
    await p
    assert.equal(h.logs.length, 1)
  })
})

// ===========================================================================
// Z4 (edit-polish-3, L3a) — a refused value reaches the log once
// ===========================================================================

describe('a rule refusal is logged once per refused value (Z4)', () => {
  const VALUE = 'skyboxtest1.png'

  test('the same refused value three times logs once', async () => {
    const h = harness()
    for (let i = 0; i < 3; i++) {
      const result = await h.sky.update(sky(VALUE), null)
      assert.equal(result.ok, false, `call ${i}: a refusal still answers with a failure`)
    }
    assert.equal(h.logs.length, 1, `expected one log line for three refusals of the same value, got ${h.logs.length}`)
    assert.match(h.logs[0], new RegExp(`^\\[sky\\] .+ \\([a-z-]+\\) — ${VALUE}$`))
  })

  test('a different refused value logs again, and each one only once', async () => {
    const h = harness()
    await h.sky.update(sky(VALUE), null)
    await h.sky.update(sky('other-name.png'), null)
    await h.sky.update(sky('other-name.png'), null)
    await h.sky.update(sky(VALUE), null)
    assert.equal(h.logs.length, 3, `expected three log lines (A, B, A again), got ${h.logs.length}`)
    assert.match(h.logs[0], new RegExp(`${VALUE}$`))
    assert.match(h.logs[1], /other-name\.png$/)
    assert.match(h.logs[2], new RegExp(`${VALUE}$`))
  })

  test('an accepted value clears the record: the same value logs again after one', async () => {
    const h = harness()
    await h.sky.update(sky(VALUE), null)
    assert.equal(h.logs.length, 1)
    // '' / no sky is an ACCEPTED value: it forgets the failure, as it always has.
    const ok = await h.sky.update(null, null)
    assert.deepEqual(ok, { ok: true })
    await h.sky.update(sky(VALUE), null)
    assert.equal(h.logs.length, 2, 'the value is logged again after an accepted value')
  })

  test('retry() clears the record for a refused value', async () => {
    const h = harness()
    await h.sky.update(sky(VALUE), null)
    assert.equal(h.logs.length, 1)
    const retried = await h.sky.retry()
    assert.equal(retried.ok, false, 'the retry refuses again')
    assert.equal(h.logs.length, 2, 'retry() forgets the refusal, so it is reported again')
  })

  test('resetWorld() clears the record for a refused value', async () => {
    const h = harness()
    await h.sky.update(sky(VALUE), null)
    assert.equal(h.logs.length, 1)
    h.sky.resetWorld()
    await h.sky.update(sky(VALUE), null)
    assert.equal(h.logs.length, 2, 'a new world ends the quiet spell')
  })

  test('a refusal still clears the slots and returns the reason every time', async () => {
    const h = harness()
    const first = await h.sky.update(sky(VALUE), null)
    const second = await h.sky.update(sky(VALUE), null)
    assert.deepEqual(second, first, 'the second answer is the same refusal, not a cached success')
    assert.equal(second.ok, false)
    assert.equal(typeof second.reason, 'string')
    assert.equal(typeof second.message, 'string')
    assert.equal(h.scene.background, null, 'no slot is written by a refusal')
    assert.equal(h.scene.environment, null)
    assert.equal(h.fetchImage.calls.length, 0, 'nothing is fetched for a refused value')
  })
})

// ===========================================================================
// The original reason survives a repeat (V3.3, round 2)
// ===========================================================================

describe('the original failure is remembered (V3.3)', () => {
  test('a repeated update with the same value returns the ORIGINAL reason and message', async () => {
    const h = harness()
    const p = h.sky.update(sky(A), null)
    await tick()
    h.fetchImage.calls[0].resolve({ ok: false, reason: 'http', message: 'the server refused the request (404)' })
    await p

    const again = await h.sky.update(sky(A), null)
    assert.deepEqual(again, { ok: false, reason: 'http', message: 'the server refused the request (404)' },
      'a rename keeps the specific reason, never a generic one')
    assert.deepEqual(h.sky.failed, { url: A, reason: 'http', message: 'the server refused the request (404)' })
  })

  test('after a retry that fails again, the NEW reason is the one remembered', async () => {
    const h = harness()
    const p = h.sky.update(sky(A), null)
    await tick()
    h.fetchImage.calls[0].resolve({ ok: false, reason: 'timeout' })
    await p

    const retried = h.sky.retry()
    await tick()
    assert.equal(h.fetchImage.calls.length, 2, 'retry() refetches the same value')
    h.fetchImage.calls[1].resolve({ ok: false, reason: 'http', message: 'the server refused the request (503)' })
    assert.deepEqual(await retried, { ok: false, reason: 'http', message: 'the server refused the request (503)' })
    assert.deepEqual(await h.sky.update(sky(A), null),
      { ok: false, reason: 'http', message: 'the server refused the request (503)' })
  })
})

// ===========================================================================
// The retryable set (V3.4, round 2) — exported here for the picker to read
// ===========================================================================

describe('SKY_RETRYABLE_REASONS (V3.4)', () => {
  test('a transfer, deadline, decode or image-header failure is retryable', () => {
    for (const reason of ['network', 'http', 'timeout', 'too-large', 'decode',
      'unsupported-image', 'bad-size', 'too-large-dimensions']) {
      assert.equal(isSkyRetryable(reason), true, reason)
    }
  })

  test('a refusal by rule is NOT retryable', () => {
    for (const reason of ['url-type', 'url-length', 'url-chars', 'url-scheme', 'url-parse',
      'url-host', 'url-credentials', 'url-relative', 'no-base', 'empty', 'bad-spec',
      'redirect', 'superseded', 'disposed']) {
      assert.equal(isSkyRetryable(reason), false, reason)
    }
  })

  test('the controller and the picker read the SAME list', () => {
    // Re-exported from load-background.js (and from the package index), so the
    // picker never keeps a second copy of it.
    assert.equal(SKY_RETRYABLE_REASONS, SOURCE_RETRYABLE)
  })
})
