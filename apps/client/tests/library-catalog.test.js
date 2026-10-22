// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// library-catalog.test.js — library-sky step 4 (Z1). The catalog module, with no
// DOM and no browser: `loadCatalog` is driven with a stub `fetch`, and the
// committed catalog is read from disk and put through the SAME rules.
//
// The last describe is the one that matters most: a bad upload must fail the
// suite, so every entry of apps/client/library/catalog.json is checked and the
// count of dropped entries must be zero.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  loadCatalog, parseCatalog, modelEntryProblem, skyEntryProblem, storedUrl, nameHash,
  defaultCatalogUrl, CATALOG_URL, CATALOG_MAX_BYTES, EMPTY_CATALOG,
  MODEL_URL_RE, SKY_URL_RE, THUMBNAIL_URL_RE, MODEL_ENTRY_KEYS, SKY_ENTRY_KEYS,
} from '../src/library-catalog.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const COMMITTED = resolve(__dirname, '../library/catalog.json')

const UTF8 = new TextEncoder()
const bytes = (text) => UTF8.encode(text)

const SHA = 'a'.repeat(52)          // 12 hex + 52 = the 64 of a sha256
const validModel = (over = {}) => ({
  id: 'ArmChair_01', name: 'Arm Chair', category: 'Seating',
  url: `/assets/library/models/ArmChair_01-${'1234567890ab'}.glb`,
  sha256: `1234567890ab${SHA}`,
  bounds: [0.8, 0.9, 0.8], bytes: 100, vertices: 10, textureBytes: 20,
  thumbnail: `/assets/library/thumbs/ArmChair_01-${'abcdef123456'}.webp`,
  thumbnailSha256: `abcdef123456${SHA}`,
  license: 'CC0-1.0', authors: ['Someone'], source: 'https://polyhaven.com/a/ArmChair_01',
  ...over,
})
const validSky = (over = {}) => ({
  id: 'autumn_field_puresky', name: 'Autumn Field',
  url: `/assets/library/skies/autumn_field_puresky-${'abcdef123456'}.jpg`,
  sha256: `abcdef123456${SHA}`,
  width: 4096, height: 2048, bytes: 100,
  thumbnail: `/assets/library/thumbs/autumn_field_puresky-${'abcdef123456'}.webp`,
  thumbnailSha256: `abcdef123456${SHA}`,
  license: 'CC0-1.0', authors: ['Someone'], source: 'https://polyhaven.com/a/autumn_field_puresky',
  ...over,
})
const catalogOf = (models = [], skies = [], over = {}) => ({
  version: 1,
  credit: 'Models and skies from Poly Haven (CC0)',
  creditUrl: 'https://polyhaven.com',
  models, skies, ...over,
})

/** A response from bytes (or an endless body); records a cancel. */
function responseFrom(body, { status = 200, chunk = 64 * 1024, headers = {}, endless = false } = {}) {
  const record = { cancelled: false }
  const data = body instanceof Uint8Array ? body : bytes(body ?? '')
  const stream = new ReadableStream({
    start(controller) {
      if (endless) return            // nothing is enqueued until pulled
      for (let at = 0; at < data.length; at += chunk) controller.enqueue(data.subarray(at, at + chunk))
      controller.close()
    },
    pull(controller) {
      if (!endless) return
      // A body that never ends: the reader must abort it at the cap.
      controller.enqueue(new Uint8Array(chunk).fill(0x20))
    },
    cancel() { record.cancelled = true },
  })
  return {
    ok: status >= 200 && status < 300, status, url: '',
    headers: new Headers({ 'content-type': 'application/json', ...headers }),
    body: stream, record,
  }
}

function stubFetch(table) {
  const calls = []
  const fetchFn = async (url, options) => {
    calls.push({ url, options })
    const entry = table[url] ?? table.default
    if (entry === undefined) throw new Error(`unexpected request: ${url}`)
    return typeof entry === 'function' ? entry(url, options) : entry
  }
  fetchFn.calls = calls
  return fetchFn
}

const json = (value) => responseFrom(JSON.stringify(value))

// ===========================================================================
// The catalog's own URL (brief-gate correction 2)
// ===========================================================================

describe('where the catalog lives', () => {
  test('the default URL resolves against the MODULE, not the page', () => {
    const resolved = defaultCatalogUrl('https://dev.ewwb.dev/apps/client/src/library-catalog.js')
    assert.equal(resolved.href, 'https://dev.ewwb.dev/apps/client/library/catalog.json')
  })

  test('CATALOG_URL is this module\'s own default', () => {
    assert.ok(CATALOG_URL.pathname.endsWith('/apps/client/library/catalog.json'), CATALOG_URL.pathname)
    assert.ok(!CATALOG_URL.pathname.endsWith('//library/catalog.json'), 'never the site root')
  })

  test('loadCatalog asks for that URL, same-origin and with credentials omitted', async () => {
    const fetchFn = stubFetch({ default: json(catalogOf([validModel()], [validSky()])) })
    const loaded = await loadCatalog(fetchFn)
    assert.equal(loaded.ok, true, loaded.message)
    assert.equal(fetchFn.calls.length, 1)
    assert.equal(fetchFn.calls[0].url, String(CATALOG_URL))
    assert.equal(fetchFn.calls[0].options.credentials, 'omit')
  })

  test('the URL is injectable', async () => {
    const fetchFn = stubFetch({ 'https://elsewhere.example/catalog.json': json(catalogOf([validModel()])) })
    const loaded = await loadCatalog(fetchFn, { url: 'https://elsewhere.example/catalog.json' })
    assert.equal(loaded.ok, true, loaded.message)
    assert.equal(fetchFn.calls[0].url, 'https://elsewhere.example/catalog.json')
  })
})

// ===========================================================================
// Reading, capping, parsing
// ===========================================================================

describe('loadCatalog — reading under the cap', () => {
  test('the cap is 256 KiB', () => {
    assert.equal(CATALOG_MAX_BYTES, 256 * 1024)
  })

  test('a body that never ends is aborted mid-stream', async () => {
    const body = responseFrom(null, { endless: true })
    const fetchFn = stubFetch({ default: body })
    const loaded = await loadCatalog(fetchFn)
    assert.equal(loaded.ok, false)
    assert.equal(loaded.reason, 'too-large')
    assert.equal(body.record.cancelled, true, 'the reader cancelled the endless body')
  })

  test('a declared Content-Length over the cap is refused without reading', async () => {
    const body = responseFrom(JSON.stringify(catalogOf()), {
      headers: { 'content-length': String(CATALOG_MAX_BYTES + 1) },
    })
    const fetchFn = stubFetch({ default: body })
    const loaded = await loadCatalog(fetchFn)
    assert.equal(loaded.ok, false)
    assert.equal(loaded.reason, 'too-large')
    assert.equal(body.record.cancelled, true)
  })

  test('a catalog just under the cap is read', async () => {
    const pad = 'x'.repeat(200 * 1024)
    const value = catalogOf([validModel({ name: pad })], [])
    assert.ok(JSON.stringify(value).length < CATALOG_MAX_BYTES)
    const loaded = await loadCatalog(stubFetch({ default: json(value) }))
    assert.equal(loaded.ok, true, loaded.message)
  })

  test('a wrong version fails the whole catalog', async () => {
    const loaded = await loadCatalog(stubFetch({ default: json(catalogOf([validModel()], [], { version: 2 })) }))
    assert.equal(loaded.ok, false)
    assert.equal(loaded.reason, 'version')
  })

  test('broken JSON fails, and the fallback catalog is empty', async () => {
    const loaded = await loadCatalog(stubFetch({ default: responseFrom('{ "version": 1, ') }))
    assert.equal(loaded.ok, false)
    assert.equal(loaded.reason, 'parse')
    assert.deepEqual(EMPTY_CATALOG.models, [], 'no models: the Library button is hidden')
    assert.deepEqual(EMPTY_CATALOG.skies, [], 'no skies: Sky offers None only')
  })

  test('a missing catalog fails without throwing', async () => {
    const loaded = await loadCatalog(stubFetch({}))
    assert.equal(loaded.ok, false)
    assert.equal(loaded.reason, 'network')
  })

  test('an HTTP error fails', async () => {
    const loaded = await loadCatalog(stubFetch({ default: responseFrom('nope', { status: 404 }) }))
    assert.equal(loaded.ok, false)
    assert.equal(loaded.reason, 'http')
    assert.match(loaded.message, /404/)
  })

  test('unknown TOP-LEVEL keys are ignored (the generator stamp)', () => {
    const parsed = parseCatalog(catalogOf([validModel()], [], { generator: 'atrium-library-build/1' }))
    assert.equal(parsed.ok, true)
    assert.equal(parsed.catalog.models.length, 1)
  })
})

// ===========================================================================
// The path patterns — exact strings, never a prefix and never URL parsing
// ===========================================================================

describe('entry paths and names', () => {
  test('the three patterns are the exact per-kind ones', () => {
    assert.ok(MODEL_URL_RE.test('/assets/library/models/ArmChair_01-1234567890ab.glb'))
    assert.ok(SKY_URL_RE.test('/assets/library/skies/autumn_field_puresky-1234567890ab.jpg'))
    assert.ok(THUMBNAIL_URL_RE.test('/assets/library/thumbs/ArmChair_01-1234567890ab.webp'))
  })

  for (const [label, url] of [
    ['a dot-segment', '/assets/library/models/../x.glb'],
    ['an encoded dot-segment', '/assets/library/%2e%2e/x.glb'],
    ['an encoded slash', '/assets/library/models/%2F%2Fevil.example/x.glb'],
    ['a query', '/assets/library/models/ArmChair_01-1234567890ab.glb?v=2'],
    ['a fragment', '/assets/library/models/ArmChair_01-1234567890ab.glb#x'],
    ['a double slash', '/assets/library//models/ArmChair_01-1234567890ab.glb'],
    ['a prefix that is not the directory', '/assets/library/models-extra/ArmChair_01-1234567890ab.glb'],
    ['a wrong extension', '/assets/library/models/ArmChair_01-1234567890ab.gltf'],
    ['an uppercase hex suffix', '/assets/library/models/ArmChair_01-1234567890AB.glb'],
    ['an id with a slash', '/assets/library/models/a/b-1234567890ab.glb'],
    ['an absolute URL', 'https://cdn.example.com/assets/library/models/x-1234567890ab.glb'],
    ['a sky path in models', '/assets/library/skies/ArmChair_01-1234567890ab.jpg'],
  ]) {
    test(`a model url with ${label} is refused`, () => {
      assert.equal(modelEntryProblem(validModel({ url })), 'url', url)
    })
  }

  test('a model path in skies is refused', () => {
    assert.equal(skyEntryProblem(validSky({ url: validModel().url })), 'url')
  })

  test('a name whose 12 hex do not match sha256 is refused', () => {
    assert.equal(modelEntryProblem(validModel({ sha256: `ffffffffffff${SHA}` })), 'hash-tie')
    assert.equal(skyEntryProblem(validSky({ sha256: `ffffffffffff${SHA}` })), 'hash-tie')
  })

  test('a thumbnail whose 12 hex do not match its own hash is refused', () => {
    assert.equal(modelEntryProblem(validModel({ thumbnailSha256: `ffffffffffff${SHA}` })), 'thumbnail-hash-tie')
    assert.equal(skyEntryProblem(validSky({ thumbnailSha256: `ffffffffffff${SHA}` })), 'thumbnail-hash-tie')
  })

  test('a model thumbnail may not be a sky path', () => {
    assert.equal(modelEntryProblem(validModel({ thumbnail: validSky().url })), 'thumbnail')
  })

  test('nameHash reads exactly the 12 hex before the extension', () => {
    assert.equal(nameHash('/assets/library/models/ArmChair_01-1234567890ab.glb'), '1234567890ab')
    assert.equal(nameHash('/assets/library/thumbs/x-abcdef123456.webp'), 'abcdef123456')
    assert.equal(nameHash('/assets/library/models/x-1234567890ab.png'), null, 'the wrong extension')
    assert.equal(nameHash(42), null)
  })
})

// ===========================================================================
// The value rules, one at a time
// ===========================================================================

describe('entry values', () => {
  test('the key sets are exact', () => {
    assert.equal(MODEL_ENTRY_KEYS.length, 14)
    assert.equal(SKY_ENTRY_KEYS.length, 12)
    assert.equal(modelEntryProblem(validModel()), null)
    assert.equal(skyEntryProblem(validSky()), null)

    const extra = validModel({ extra: 1 })
    assert.equal(modelEntryProblem(extra), 'entry-keys')
    const missing = { ...validModel() }
    delete missing.category
    assert.equal(modelEntryProblem(missing), 'entry-keys')
    const extraSky = validSky({ category: 'X' })
    assert.equal(skyEntryProblem(extraSky), 'entry-keys')
  })

  test('models need A12 bounds', () => {
    assert.equal(modelEntryProblem(validModel({ bounds: [1, 2] })), 'bounds')
    assert.equal(modelEntryProblem(validModel({ bounds: [0, 1, 1] })), 'bounds')
    assert.equal(modelEntryProblem(validModel({ bounds: [1, 2, 'x'] })), 'bounds')
    assert.equal(modelEntryProblem(validModel({ bounds: [1, 2, 1001] })), 'bounds')
  })

  test('skies need L26 dimensions', () => {
    assert.equal(skyEntryProblem(validSky({ width: 4097 })), 'size')
    assert.equal(skyEntryProblem(validSky({ height: 4097 })), 'size')
    assert.equal(skyEntryProblem(validSky({ width: 4096, height: 2049 })), 'size', 'over the area')
    assert.equal(skyEntryProblem(validSky({ width: 0, height: 2048 })), 'size')
    assert.equal(skyEntryProblem(validSky({ width: 4096.5, height: 2048 })), 'size', 'a non-integer side')
    assert.equal(skyEntryProblem(validSky({ width: 4096, height: 2048 })), null, 'the exact area passes')
  })

  test('sha256 must be 64 lowercase hex', () => {
    assert.equal(modelEntryProblem(validModel({ sha256: 'ABC' })), 'sha256')
    assert.equal(modelEntryProblem(validModel({ sha256: 'A'.repeat(64) })), 'sha256')
    assert.equal(skyEntryProblem(validSky({ thumbnailSha256: 'x'.repeat(64) })), 'thumbnail-sha256')
  })

  test('counts and strings', () => {
    assert.equal(modelEntryProblem(validModel({ bytes: -1 })), 'bytes')
    assert.equal(modelEntryProblem(validModel({ vertices: 'many' })), 'bytes')
    assert.equal(modelEntryProblem(validModel({ authors: [] })), 'authors')
    assert.equal(modelEntryProblem(validModel({ authors: ['ok', 2] })), 'authors')
    assert.equal(modelEntryProblem(validModel({ license: '' })), 'license')
    assert.equal(skyEntryProblem(validSky({ source: 42 })), 'license')
    assert.equal(skyEntryProblem(validSky({ name: '' })), 'name')
  })

  test('an entry that is not an object is refused', () => {
    assert.equal(modelEntryProblem(null), 'entry-type')
    assert.equal(modelEntryProblem([]), 'entry-type')
    assert.equal(skyEntryProblem('x'), 'entry-type')
  })
})

// ===========================================================================
// Dropping: one bad entry, not the catalog
// ===========================================================================

describe('parseCatalog — dropping', () => {
  test('each invalid entry is dropped alone, and reported', () => {
    const warnings = []
    const parsed = parseCatalog(
      catalogOf([validModel(), validModel({ id: 'Bad', url: '/assets/library/models/../x.glb' }), validModel({ id: 'Fine' })],
        [validSky(), validSky({ id: 'BadSky', width: 0 })]),
      { warn: (message) => warnings.push(message) },
    )
    assert.equal(parsed.ok, true)
    assert.deepEqual(parsed.catalog.models.map((m) => m.id), ['ArmChair_01', 'Fine'])
    assert.deepEqual(parsed.catalog.skies.map((s) => s.id), ['autumn_field_puresky'])
    assert.deepEqual(parsed.dropped, { models: 1, skies: 1 })
    assert.equal(warnings.length, 2)
    assert.match(warnings[0], /Bad/)
    assert.match(warnings[1], /BadSky/)
  })

  test('a duplicate id is dropped', () => {
    const parsed = parseCatalog(catalogOf([validModel(), validModel()], [validSky(), validSky()]), { warn() {} })
    assert.equal(parsed.catalog.models.length, 1)
    assert.equal(parsed.catalog.skies.length, 1)
    assert.deepEqual(parsed.dropped, { models: 1, skies: 1 })
  })

  test('the validated entries are copies, not the parsed document', () => {
    const jsonValue = catalogOf([validModel()], [validSky()])
    const parsed = parseCatalog(jsonValue)
    assert.notEqual(parsed.catalog.models, jsonValue.models)
    assert.notEqual(parsed.catalog.models[0], jsonValue.models[0])
    assert.notEqual(parsed.catalog.models[0].bounds, jsonValue.models[0].bounds)
    assert.deepEqual(parsed.catalog.models[0].bounds, jsonValue.models[0].bounds)
    assert.equal(Object.isFrozen(parsed.catalog.models[0]), true)
  })

  test('a non-object, or a models/skies that is not a list, fails the catalog', () => {
    assert.equal(parseCatalog(null).ok, false)
    assert.equal(parseCatalog([]).ok, false)
    assert.equal(parseCatalog(catalogOf('x', [])).ok, false)
    assert.equal(parseCatalog(catalogOf([], 'x')).ok, false)
  })

  test('the credit is kept, and a missing one becomes null', () => {
    const parsed = parseCatalog(catalogOf([validModel()], [], { credit: undefined, creditUrl: undefined }))
    assert.equal(parsed.catalog.credit, null)
    assert.equal(parsed.catalog.creditUrl, null)
  })
})

// ===========================================================================
// The stored URL (L22a)
// ===========================================================================

describe('storedUrl', () => {
  const path = '/assets/library/models/ArmChair_01-1234567890ab.glb'

  test('the path as it is when the world shares the page\'s origin', () => {
    const page = 'https://dev.ewwb.dev'
    assert.equal(storedUrl(path, 'https://dev.ewwb.dev/worlds/josh/room', page), path)
  })

  test('the absolute URL on the page\'s origin when the world is elsewhere', () => {
    const page = 'https://dev.ewwb.dev'
    assert.equal(storedUrl(path, 'https://elsewhere.example/worlds/x/y', page),
      'https://dev.ewwb.dev/assets/library/models/ArmChair_01-1234567890ab.glb')
  })

  test('a world with no usable base counts as elsewhere', () => {
    const page = 'https://dev.ewwb.dev'
    for (const base of [null, undefined, '', 'not a url']) {
      assert.equal(storedUrl(path, base, page), `https://dev.ewwb.dev${path}`, String(base))
    }
  })

  test('a path that is not a catalog path is still just a path', () => {
    assert.equal(storedUrl('/x.glb', 'https://a.example/w', 'https://a.example'), '/x.glb')
    assert.equal(storedUrl('/x.glb', 'https://b.example/w', 'https://a.example'), 'https://a.example/x.glb')
  })
})

// ===========================================================================
// THE COMMITTED CATALOG — a bad upload fails this suite
// ===========================================================================

describe('the committed catalog (apps/client/library/catalog.json)', () => {
  const text = readFileSync(COMMITTED, 'utf8')
  const parsed = parseCatalog(JSON.parse(text), { warn: (m) => { throw new Error(`the committed catalog was dropped: ${m}`) } })

  test('it parses and is this version', () => {
    assert.equal(parsed.ok, true)
    assert.equal(parsed.catalog.version, 1)
  })

  test('every entry passes the rules, and NONE is dropped', () => {
    assert.deepEqual(parsed.dropped, { models: 0, skies: 0 },
      'an entry that fails the rules is a coverage failure, not a silent drop')
    for (const entry of parsed.catalog.models) {
      assert.equal(modelEntryProblem(entry), null, entry.id)
    }
    for (const entry of parsed.catalog.skies) {
      assert.equal(skyEntryProblem(entry), null, entry.id)
    }
  })

  test('it carries the 34 models and 6 skies of Appendix A (L28)', () => {
    assert.equal(parsed.catalog.models.length, 34)
    assert.equal(parsed.catalog.skies.length, 6)
  })

  test('the six categories, including Misc', () => {
    const categories = [...new Set(parsed.catalog.models.map((entry) => entry.category))].sort()
    assert.deepEqual(categories, ['Lighting', 'Misc', 'Plants', 'Seating', 'Storage', 'Tables'])
  })

  test('the credit line names Poly Haven (the grid shows it)', () => {
    assert.match(parsed.catalog.credit ?? '', /Poly Haven/)
    assert.equal(parsed.catalog.creditUrl, 'https://polyhaven.com')
  })

  test('every url and thumbnail is an /assets/library/ path', () => {
    for (const entry of [...parsed.catalog.models, ...parsed.catalog.skies]) {
      assert.ok(entry.url.startsWith('/assets/library/'), entry.url)
      assert.ok(entry.thumbnail.startsWith('/assets/library/thumbs/'), entry.thumbnail)
    }
  })

  test('the six skies are the ones Appendix A names', () => {
    const ids = parsed.catalog.skies.map((entry) => entry.id).sort()
    assert.deepEqual(ids, [
      'autumn_field_puresky', 'belfast_sunset_puresky', 'drakensberg_solitary_mountain_puresky',
      'evening_road_01_puresky', 'farm_field_puresky', 'kloofendal_48d_partly_cloudy_puresky',
    ])
  })
})
