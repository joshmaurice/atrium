// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// model-spec.test.js — models-by-url step 2 (Z1 client side, A1, A6, A12).
//
// The client's `parseModelSpec` / `validateModelHost` against the SAME shared
// vectors the server's tests read: no copy of the rules lives in the test.
// Also the root-relative resolution rule (A1): with no usable world base the
// reason is `no-base` and nothing is fetched; with a base, the result must stay
// on that base's origin.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseModelSpec, validateModelHost, modelUrlProblem, modelExtrasProblem,
  resolveModelUrl, isRootRelative, modelReasonText, skyUrlProblem, resolveSkyUrl,
} from '../src/model-spec.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const VECTORS = JSON.parse(readFileSync(resolve(__dirname, '../../../tests/fixtures/model-spec-vectors.json'), 'utf8'))

describe('parseModelSpec — the shared spec vectors (Z1)', () => {
  assert.ok(VECTORS.specs.length >= 60, 'the shared vectors are the adversarial set')
  for (const vector of VECTORS.specs) {
    test(vector.label, () => {
      const parsed = parseModelSpec(vector.extras)
      assert.equal(parsed.ok, vector.ok, parsed.ok ? 'accepted' : `${parsed.reason}: ${parsed.message}`)
      if (vector.ok) {
        if (parsed.spec) assert.equal(typeof parsed.spec.url, 'string')
      } else {
        assert.equal(parsed.reason, vector.reason, 'the shared reason code')
        assert.equal(parsed.message, modelReasonText(vector.reason), 'the plain text for that code')
      }
    })
  }
})

describe('parseModelSpec — the spec it returns', () => {
  test('a url-only model gives a spec with one key', () => {
    const parsed = parseModelSpec({ atrium: { model: { url: 'https://h/m.glb' } } })
    assert.deepEqual(parsed.spec, { url: 'https://h/m.glb' })
  })

  test('sha256 and bounds are carried, and bounds is copied', () => {
    const bounds = [1, 2, 3]
    const parsed = parseModelSpec({ atrium: { model: { url: '/m.glb', sha256: 'a'.repeat(64), bounds } } })
    assert.equal(parsed.spec.sha256, 'a'.repeat(64))
    assert.deepEqual(parsed.spec.bounds, bounds)
    assert.notEqual(parsed.spec.bounds, bounds, 'the spec does not alias the world document')
  })

  test('a value that is not a model is accepted with spec null', () => {
    for (const extras of [null, undefined, {}, { atrium: {} }, { displayName: 'x' }, 'x', 42]) {
      assert.deepEqual(parseModelSpec(extras), { ok: true, spec: null }, JSON.stringify(extras))
    }
  })
})

describe('validateModelHost — the shared node vectors (A6)', () => {
  assert.ok(VECTORS.nodes.length >= 10, 'the shared node vectors')
  for (const vector of VECTORS.nodes) {
    test(vector.label, () => {
      const decided = validateModelHost(vector.node)
      assert.equal(decided.ok, vector.ok, decided.ok ? 'accepted' : `${decided.reason}: ${decided.message}`)
      if (!vector.ok) assert.equal(decided.reason, vector.reason, 'the shared reason code')
    })
  }

  test('a node that is not an object is not a model host', () => {
    assert.deepEqual(validateModelHost(null), { ok: true, spec: null })
  })
})

describe('modelUrlProblem — A1 rule by rule', () => {
  test('the boundary characters: U+0020 refused, U+0021 allowed', () => {
    assert.equal(modelUrlProblem('https://h/a b'), 'url-chars')
    assert.equal(modelUrlProblem('https://h/a!b'), null)
  })

  test('a backslash is refused everywhere, including after the scheme', () => {
    assert.equal(modelUrlProblem('https://h\\evil/m.glb'), 'url-chars')
    assert.equal(modelUrlProblem('/\\evil.example/m.glb'), 'url-chars')
  })

  test('percent-encoded slashes and backslashes stay a path', () => {
    assert.equal(modelUrlProblem('/%2F%2Fevil.example/m.glb'), null)
    assert.equal(modelUrlProblem('/%5Cevil/m.glb'), null)
  })

  test('a protocol-relative URL is not a stored URL', () => {
    // The second slash makes it an authority, not a path — and the rule is
    // https:// or a SINGLE /.
    assert.equal(modelUrlProblem('//evil.example/m.glb'), 'url-scheme')
    assert.equal(modelUrlProblem('/..//evil.example/m.glb'), null,
      'a single-leading-slash path always stays on the base origin')
  })
})

describe('resolveModelUrl — A1, root-relative URLs', () => {
  test('an absolute https URL is returned as it is', () => {
    assert.deepEqual(resolveModelUrl('https://h/m.glb', 'https://world.example/w'), { ok: true, url: 'https://h/m.glb' })
    assert.deepEqual(resolveModelUrl('https://h/m.glb', null), { ok: true, url: 'https://h/m.glb' })
  })

  test('a root-relative URL resolves against the world base, not the page', () => {
    const r = resolveModelUrl('/assets/m.glb', 'https://world.example/worlds/josh/room')
    assert.equal(r.ok, true)
    assert.equal(r.url, 'https://world.example/assets/m.glb')
  })

  test('no usable world base is no-base, and nothing is fetched', () => {
    for (const base of [null, undefined, '', 'not a url']) {
      assert.deepEqual(resolveModelUrl('/m.glb', base), { ok: false, reason: 'no-base' }, String(base))
    }
  })

  test('isRootRelative', () => {
    assert.equal(isRootRelative('/m.glb'), true)
    assert.equal(isRootRelative('//h/m.glb'), false)
    assert.equal(isRootRelative('https://h/m.glb'), false)
  })
})

describe('modelExtrasProblem — the reason code alone', () => {
  test('null for a value that is not a model', () => {
    assert.equal(modelExtrasProblem({}), null)
    assert.equal(modelExtrasProblem(null), null)
  })

  test('the code for a bad value', () => {
    assert.equal(modelExtrasProblem({ atrium: { model: { url: 'http://h/m.glb' } } }), 'url-scheme')
  })
})

// ---------------------------------------------------------------------------
// library-sky Z3/Z5 — the sky URL rule, against the SAME shared vectors the
// server's test reads (tests/fixtures/sky-url-vectors.json). L25a.
// ---------------------------------------------------------------------------

const SKY_VECTORS = JSON.parse(readFileSync(resolve(__dirname, '../../../tests/fixtures/sky-url-vectors.json'), 'utf8'))

describe('skyUrlProblem — the shared sky-URL vectors (L25a)', () => {
  assert.ok(SKY_VECTORS.vectors.length >= 20, 'the shared vectors are the adversarial set')
  for (const vector of SKY_VECTORS.vectors) {
    test(vector.label, () => {
      const problem = skyUrlProblem(vector.value)
      assert.equal(problem === null, vector.ok, problem ?? 'accepted')
      if (!vector.ok) assert.equal(problem, vector.reason, 'the shared reason code')
    })
  }
})

describe('skyUrlProblem — the shape of the rule', () => {
  test('the empty string clears the sky and is legal', () => {
    assert.equal(skyUrlProblem(''), null)
  })

  test('a document-relative value is refused exactly like any other non-A1 value', () => {
    assert.equal(skyUrlProblem('skyboxtest1.png'), 'url-scheme')
    assert.equal(skyUrlProblem('../x.png'), 'url-scheme')
    assert.equal(skyUrlProblem('skyboxtest1.png'), skyUrlProblem('http://h/x.png'),
      'no legacy form survives (L25a)')
  })

  test('the cap is the model cap: 2048 characters', () => {
    const prefix = 'https://h/'
    assert.equal(skyUrlProblem(prefix + 'a'.repeat(2048 - prefix.length)), null)
    assert.equal(skyUrlProblem(prefix + 'a'.repeat(2049 - prefix.length)), 'url-length')
  })
})

describe('resolveSkyUrl — A1 resolution and refusals', () => {
  test('an absolute https URL is returned as it is', () => {
    assert.deepEqual(resolveSkyUrl('https://h/s.jpg', 'https://world.example/w'),
      { ok: true, url: 'https://h/s.jpg' })
    assert.deepEqual(resolveSkyUrl('https://h/s.jpg', null), { ok: true, url: 'https://h/s.jpg' })
  })

  test('a root path resolves against the world base, not the page', () => {
    assert.deepEqual(resolveSkyUrl('/assets/library/skies/a.jpg', 'https://world.example/worlds/josh/room'),
      { ok: true, url: 'https://world.example/assets/library/skies/a.jpg' })
  })

  test('a root path with no usable world base is no-base', () => {
    for (const base of [null, undefined, '', 'not a url']) {
      assert.deepEqual(resolveSkyUrl('/a.jpg', base), { ok: false, reason: 'no-base' }, String(base))
    }
  })

  test('a document-relative value is refused with a reason', () => {
    assert.deepEqual(resolveSkyUrl('skyboxtest1.png', 'https://world.example/w'),
      { ok: false, reason: 'url-scheme' })
    assert.deepEqual(resolveSkyUrl('../x.png', 'https://world.example/w'),
      { ok: false, reason: 'url-scheme' })
  })

  test('the empty string is refused as empty (the caller handles it before resolve)', () => {
    assert.deepEqual(resolveSkyUrl('', 'https://world.example/w'), { ok: false, reason: 'empty' })
  })

  test('every non-legal value is refused with its own reason code', () => {
    for (const vector of SKY_VECTORS.vectors) {
      if (vector.ok) continue
      assert.deepEqual(resolveSkyUrl(vector.value, 'https://world.example/w'),
        { ok: false, reason: vector.reason }, vector.label)
    }
  })
})
