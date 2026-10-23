// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// sky-picker.test.js — library-sky step 6 (Z4). The Sky picker's logic, with no
// DOM: the select's value, the extras a change writes, the rollback of a refused
// write, the one-write-at-a-time wait and the failure/Retry reporting.
//
// The last describe reads app.js as a file for the wiring that only exists in
// the page: the answer listeners, the world-boundary resets and the button.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createSkyPicker, skyValueFor, buildSkyExtras, restoreSkyExtras, backgroundOf,
  SKY_NONE, SKY_CUSTOM,
} from '../src/sky-picker.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const SKIES = [
  { id: 'Sky_01', name: 'Cloudy', url: '/assets/library/skies/Sky_01-aaaaaaaaaaaa.jpg' },
  { id: 'Sky_02', name: 'Sunset', url: '/assets/library/skies/Sky_02-bbbbbbbbbbbb.jpg' },
]
const CATALOG = { models: [], skies: SKIES }
const PAGE_ORIGIN = 'https://atrium.example'
const storedUrl = (path) => `${PAGE_ORIGIN}${path}`

function extras(texture, extra = {}) {
  return {
    atrium: {
      name: 'A world',
      description: 'A description',
      ...extra,
      background: { type: 'equirectangular', texture },
    },
    custom: { keep: true },
  }
}

function harness({ texture = '', canEdit = true, skies = SKIES, skyUpdate, skyRetry, pageOrigin = PAGE_ORIGIN, worldBaseUrl = 'https://atrium.example' } = {}) {
  const som = { extras: extras(texture) }
  const calls = {
    applyExtras: [], applyLocally: 0, update: [], retry: 0,
    renderSelect: [], setStatus: [], setRetryVisible: [],
  }
  const seqs = []
  const sky = {
    update: (background, baseUrl) => {
      calls.update.push({ background, baseUrl })
      return skyUpdate ? skyUpdate(background, baseUrl) : Promise.resolve({ ok: true })
    },
    retry: () => {
      calls.retry += 1
      return skyRetry ? skyRetry() : Promise.resolve({ ok: true })
    },
  }
  const picker = createSkyPicker({
    deps: {
      som: () => som,
      catalog: () => ({ ...CATALOG, skies }),
      canEdit: () => canEdit,
      worldBaseUrl: () => worldBaseUrl,
      pageOrigin: () => pageOrigin,
      storedUrl: (path) => storedUrl(path),
      applyExtras: (next) => { calls.applyExtras.push(next); som.extras = next; const seq = 100 + seqs.length; seqs.push(seq); return seq },
      applyLocally: (fn) => { calls.applyLocally += 1; fn() },
      sky,
      renderSelect: (state) => calls.renderSelect.push(state),
      setStatus: (text) => calls.setStatus.push(text),
      setRetryVisible: (visible) => calls.setRetryVisible.push(visible),
    },
  })
  const last = () => calls.renderSelect.at(-1)
  return { picker, som, calls, last }
}

/** Let the picker's routed promises settle. */
const settle = () => new Promise((resolve) => setImmediate(resolve))

// ===========================================================================
// The select's value
// ===========================================================================

describe('skyValueFor (Z5 — by path)', () => {
  test('None for an empty texture', () => {
    assert.equal(skyValueFor('', SKIES), SKY_NONE)
    assert.equal(skyValueFor(undefined, SKIES), SKY_NONE)
    assert.equal(skyValueFor(null, SKIES), SKY_NONE)
  })

  test('the root path names the entry from either page origin', () => {
    for (const origin of ['https://atrium.example', 'https://other.example']) {
      assert.equal(skyValueFor(SKIES[0].url, SKIES, { pageOrigin: origin }), 'Sky_01')
      assert.equal(skyValueFor(SKIES[1].url, SKIES, { worldBaseUrl: 'https://atrium.example/', pageOrigin: origin }), 'Sky_02')
    }
  })

  test('the same path on another host names the entry too', () => {
    // The owner stored an absolute URL on origin A; the viewer's page is on B.
    assert.equal(skyValueFor('https://a.example/assets/library/skies/Sky_01-aaaaaaaaaaaa.jpg', SKIES,
      { worldBaseUrl: 'https://atrium.example', pageOrigin: 'https://b.example' }), 'Sky_01')
    // And the other way round.
    assert.equal(skyValueFor('https://b.example/assets/library/skies/Sky_02-bbbbbbbbbbbb.jpg', SKIES,
      { worldBaseUrl: 'https://atrium.example', pageOrigin: 'https://a.example' }), 'Sky_02')
  })

  test('a query, a fragment, another path or a near-miss name is Custom', () => {
    assert.equal(skyValueFor(`${SKIES[0].url}?v=2`, SKIES, { pageOrigin: PAGE_ORIGIN }), SKY_CUSTOM)
    assert.equal(skyValueFor(`${SKIES[0].url}#top`, SKIES, { pageOrigin: PAGE_ORIGIN }), SKY_CUSTOM)
    assert.equal(skyValueFor('https://elsewhere.example/x.jpg', SKIES, { pageOrigin: PAGE_ORIGIN }), SKY_CUSTOM)
    assert.equal(skyValueFor('/assets/library/skies/Unknown_01-cccccccccccc.jpg', SKIES, { pageOrigin: PAGE_ORIGIN }), SKY_CUSTOM)
    // A near miss: the id is right, the hash in the name is not.
    assert.equal(skyValueFor('/assets/library/skies/Sky_01-ffffffffffff.jpg', SKIES, { pageOrigin: PAGE_ORIGIN }), SKY_CUSTOM)
    // ...and neither is the extension.
    assert.equal(skyValueFor('/assets/library/skies/Sky_01-aaaaaaaaaaaa.png', SKIES, { pageOrigin: PAGE_ORIGIN }), SKY_CUSTOM)
  })

  test('V4: an empty ? or # is not a catalog path either', () => {
    // `new URL` gives an EMPTY search and hash for a lone `?`/`#`, so these used
    // to name the entry; the stored string is what decides now.
    assert.equal(skyValueFor(`${SKIES[0].url}?`, SKIES, { pageOrigin: PAGE_ORIGIN }), SKY_CUSTOM)
    assert.equal(skyValueFor(`${SKIES[0].url}#`, SKIES, { pageOrigin: PAGE_ORIGIN }), SKY_CUSTOM)
    assert.equal(skyValueFor(`${SKIES[1].url}?#`, SKIES, { worldBaseUrl: 'https://atrium.example' }), SKY_CUSTOM)
  })

  test('a texture that names no path at all is Custom, never a crash', () => {
    assert.equal(skyValueFor('skyboxtest1.png', SKIES), SKY_CUSTOM)
    assert.equal(skyValueFor('skyboxtest1.png', SKIES, { pageOrigin: '' }), SKY_CUSTOM)
  })
})

// ===========================================================================
// The extras a change writes
// ===========================================================================

describe('buildSkyExtras', () => {
  test('it changes only the two leaves', () => {
    const current = extras('https://old.example/1.jpg', { navigation: { mode: 'orbit' } })
    const next = buildSkyExtras(current, 'https://new.example/2.jpg')
    assert.deepEqual(next, {
      atrium: {
        name: 'A world',
        description: 'A description',
        navigation: { mode: 'orbit' },
        background: { type: 'equirectangular', texture: 'https://new.example/2.jpg' },
      },
      custom: { keep: true },
    })
    // Nothing else moved.
    assert.equal(next.atrium.name, current.atrium.name)
    assert.equal(next.atrium.navigation.mode, 'orbit')
    assert.deepEqual(next.custom, { keep: true })
  })

  test('the copy is deep: mutating it leaves the SOM value alone', () => {
    const current = extras('https://old.example/1.jpg')
    const next = buildSkyExtras(current, '')
    next.atrium.name = 'Changed'
    next.custom.keep = false
    assert.equal(current.atrium.name, 'A world')
    assert.equal(current.custom.keep, true)
  })

  test('the type is always equirectangular', () => {
    const next = buildSkyExtras(extras('https://old.example/1.jpg'), 'https://new.example/2.jpg')
    assert.equal(next.atrium.background.type, 'equirectangular')
  })

  test('None sends an empty texture', () => {
    assert.equal(buildSkyExtras(extras('https://old.example/1.jpg'), '').atrium.background.texture, '')
  })

  test('it tolerates missing atrium or background', () => {
    assert.deepEqual(buildSkyExtras({}, 'x'), { atrium: { background: { type: 'equirectangular', texture: 'x' } } })
  })
})

// ===========================================================================
// The rollback
// ===========================================================================

describe('restoreSkyExtras', () => {
  test('it puts back only the two leaves, on a copy of the CURRENT extras', () => {
    const current = extras('https://new.example/2.jpg', { description: 'Changed elsewhere' })
    const restored = restoreSkyExtras(current, { type: 'equirectangular', texture: 'https://old.example/1.jpg' })
    assert.deepEqual(restored, {
      atrium: {
        name: 'A world',
        description: 'Changed elsewhere',        // another session's change stays
        background: { type: 'equirectangular', texture: 'https://old.example/1.jpg' },
      },
      custom: { keep: true },
    })
  })

  test('a leaf that was not there is removed again, and an empty background goes', () => {
    const restored = restoreSkyExtras({ atrium: { background: { type: 'equirectangular', texture: 'x' } } }, { type: undefined, texture: undefined })
    assert.deepEqual(restored, { atrium: {} })
  })

  test('nothing to restore returns null', () => {
    assert.equal(restoreSkyExtras(extras('x'), null), null)
  })
})

// ===========================================================================
// A change
// ===========================================================================

describe('change', () => {
  test('it sends a copy of the current extras differing only in the two leaves', () => {
    const h = harness({ texture: '' })
    const before = JSON.parse(JSON.stringify(h.som.extras))
    h.picker.change('Sky_01')
    const seq = h.picker.waiting
    assert.equal(seq, 100)
    assert.equal(h.calls.applyExtras.length, 1)
    const sent = h.calls.applyExtras[0]
    assert.deepEqual(sent.atrium.background, { type: 'equirectangular', texture: storedUrl(SKIES[0].url) })
    // Everything except the two leaves is identical to what was there.
    const stripped = JSON.parse(JSON.stringify(sent))
    delete stripped.atrium.background
    const was = JSON.parse(JSON.stringify(before))
    delete was.atrium.background
    assert.deepEqual(stripped, was)
  })

  test('it updates the sky locally with the new background', () => {
    const h = harness()
    h.picker.change('Sky_02')
    assert.equal(h.calls.update.length, 1)
    assert.equal(h.calls.update[0].background.texture, storedUrl(SKIES[1].url))
    assert.equal(h.calls.update[0].baseUrl, 'https://atrium.example')
  })

  test('the select is disabled while the write waits, and a second change does nothing', () => {
    const h = harness()
    h.picker.change('Sky_01')
    assert.equal(h.picker.waiting, 100)
    assert.equal(h.last().enabled, false, 'the select is disabled while waiting')
    assert.equal(h.picker.change('Sky_02'), null, 'one write at a time')
    assert.equal(h.calls.applyExtras.length, 1)
  })

  test('None sends an empty texture and clears the sky', () => {
    const h = harness({ texture: storedUrl(SKIES[0].url) })
    h.picker.change(SKY_NONE)
    assert.equal(h.calls.applyExtras[0].atrium.background.texture, '')
    assert.equal(h.calls.update[0].background.texture, '')
  })

  test('a non-editor or a closed world changes nothing', () => {
    const h = harness({ canEdit: false })
    assert.equal(h.picker.change('Sky_01'), null)
    assert.equal(h.calls.applyExtras.length, 0)
  })

  test('Z5 — an unchanged pick sends NOTHING, from another origin too', () => {
    // The world's SOM holds the catalog PATH (origin A stored it); this viewer's
    // page is on origin B. The picker names it (by path), and re-choosing what the
    // select already shows must not rewrite the world's sky from B.
    const h = harness({ texture: SKIES[0].url, pageOrigin: 'https://b.example', worldBaseUrl: 'https://atrium.example' })
    assert.equal(h.picker.value, 'Sky_01', 'the picker names the catalog sky from origin B')
    assert.equal(h.picker.change('Sky_01'), null, 'an unchanged pick is refused by the picker itself')
    assert.equal(h.calls.applyExtras.length, 0, 'zero applyExtras calls: nothing is sent')
    assert.equal(h.calls.update.length, 0, 'and the controller is not asked to load anything')
    assert.equal(h.picker.waiting, null)
    // ...and a real change still sends.
    assert.ok(h.picker.change(SKY_NONE), 'None is not the current value, so this one sends')
    assert.equal(h.calls.applyExtras.length, 1)
  })

  test('Z5 — an unchanged pick while a write waits changes nothing', () => {
    const h = harness({ texture: storedUrl(SKIES[0].url) })
    assert.ok(h.picker.change(SKY_NONE), 'a real change sends')
    assert.equal(h.picker.change(SKY_NONE), null, 'the same value is refused the second time')
    assert.equal(h.calls.applyExtras.length, 1)
  })

  test('an unknown sky id changes nothing', () => {
    const h = harness()
    assert.equal(h.picker.change('NoSuchSky'), null)
    assert.equal(h.calls.applyExtras.length, 0)
  })
})

// ===========================================================================
// The answers
// ===========================================================================

describe('the answers', () => {
  test('accepted re-enables the select and clears the status', () => {
    const h = harness()
    h.picker.change('Sky_01')
    const seq = h.picker.waiting
    assert.equal(h.picker.onAccepted(seq), true)
    assert.equal(h.picker.waiting, null)
    assert.equal(h.picker.status, null)
    assert.equal(h.last().enabled, true)
  })

  test('rejected restores only the two leaves, WITHOUT sending (R2)', () => {
    const h = harness({ texture: storedUrl(SKIES[0].url) })
    h.picker.change('Sky_02')
    const seq = h.picker.waiting
    assert.equal(h.calls.applyExtras.length, 1, 'the forward write sent once')

    assert.equal(h.picker.onRejected(seq, 'the sky was refused'), true)
    assert.equal(h.calls.applyExtras.length, 1, 'the rollback is NOT sent')
    assert.equal(h.calls.applyLocally, 1, 'it is applied locally')
    assert.equal(backgroundOf(h.som.extras).texture, storedUrl(SKIES[0].url), 'the previous sky is back')
    assert.equal(h.calls.update.length, 2, 'and the scene is updated locally')
    assert.equal(h.picker.status, 'the sky was refused')
  })

  test('rejected keeps a description another session changed meanwhile (R2)', () => {
    const h = harness({ texture: storedUrl(SKIES[0].url) })
    h.picker.change('Sky_02')
    const seq = h.picker.waiting
    // Another session changed the description while our write was in flight.
    h.som.extras.atrium.description = 'Changed elsewhere'
    h.picker.onRejected(seq, 'refused')
    assert.equal(h.som.extras.atrium.description, 'Changed elsewhere', 'the other field is kept')
    assert.equal(backgroundOf(h.som.extras).texture, storedUrl(SKIES[0].url), 'the two leaves are put back')
  })

  test('rejected after another session\'s background change keeps that change (R2)', () => {
    const h = harness({ texture: storedUrl(SKIES[0].url) })
    h.picker.change('Sky_02')
    const seq = h.picker.waiting
    // Another session set a third sky before our rejection arrived.
    const third = storedUrl('/assets/library/skies/Sky_03-cccccccccccc.jpg')
    h.som.extras.atrium.background.texture = third
    assert.equal(h.picker.onRejected(seq, 'refused'), true)
    assert.equal(backgroundOf(h.som.extras).texture, third, 'the newer value is left alone')
  })

  test('unknown just ends the wait: the reconnect\'s som-dump is the truth', () => {
    const h = harness()
    h.picker.change('Sky_01')
    const seq = h.picker.waiting
    assert.equal(h.picker.onUnknown(seq), true)
    assert.equal(h.picker.waiting, null)
    assert.equal(h.calls.applyLocally, 0)
  })

  test('an answer for another seq is ignored', () => {
    const h = harness()
    h.picker.change('Sky_01')
    const seq = h.picker.waiting
    assert.equal(h.picker.onAccepted(seq + 1), false)
    assert.equal(h.picker.waiting, seq)
  })
})

// ===========================================================================
// The failure and Retry
// ===========================================================================

describe('the failure and Retry (Z4)', () => {
  test('a current failure shows its reason and makes Retry visible', () => {
    const h = harness()
    h.picker.onSkyResult({ ok: false, reason: 'network', message: 'the network went away' })
    assert.deepEqual(h.picker.failure, { reason: 'network', message: 'the network went away' })
    assert.equal(h.calls.setRetryVisible.at(-1), true)
    assert.equal(h.calls.setStatus.at(-1), 'the network went away')
  })

  test('a failure without a message shows its reason', () => {
    const h = harness()
    h.picker.onSkyResult({ ok: false, reason: 'http' })
    assert.equal(h.calls.setStatus.at(-1), 'http')
  })

  test('a superseded or disposed failure is ignored', () => {
    const h = harness()
    for (const reason of ['superseded', 'disposed']) {
      h.picker.onSkyResult({ ok: false, reason })
      assert.equal(h.picker.failure, null, reason)
      assert.equal(h.calls.setRetryVisible.length, 0, `${reason}: nothing was rendered`)
      assert.equal(h.calls.setStatus.length, 0, reason)
    }
  })

  test('a success clears the failure and the Retry button', () => {
    const h = harness()
    h.picker.onSkyResult({ ok: false, reason: 'network', message: 'x' })
    h.picker.onSkyResult({ ok: true })
    assert.equal(h.picker.failure, null)
    assert.equal(h.calls.setRetryVisible.at(-1), false)
    assert.equal(h.calls.setStatus.at(-1), null)
  })

  test('Retry does NOT clear the failure itself (V3.2): the result decides', () => {
    const h = harness()
    h.picker.onSkyResult({ ok: false, reason: 'network', message: 'x' })
    const promise = h.picker.retry()
    assert.equal(h.calls.retry, 1)
    assert.equal(typeof promise.then, 'function', 'V3.1 — retry() returns the promise')
    assert.deepEqual(h.picker.failure, { reason: 'network', message: 'x' },
      'the failure stays until the retry answers')
    assert.equal(h.calls.setRetryVisible.at(-1), true, 'and Retry stays visible')
  })

  test('a world change clears the failure and the wait', () => {
    const h = harness()
    h.picker.onSkyResult({ ok: false, reason: 'network' })
    h.picker.change('Sky_01')
    h.picker.reset()
    assert.equal(h.picker.failure, null)
    assert.equal(h.picker.waiting, null)
    assert.equal(h.calls.setRetryVisible.at(-1), false)
  })

  test('a visitor sees no Retry button (not in Edit mode)', () => {
    const h = harness({ canEdit: false })
    h.picker.onSkyResult({ ok: false, reason: 'network', message: 'x' })
    assert.equal(h.calls.setRetryVisible.at(-1), false, 'the Retry button stays hidden')
    assert.equal(h.last().enabled, false, 'and the select is disabled')
  })
})

// ===========================================================================
// V3 (round 2) — every current failure is shown, and Retry only when it can help
// ===========================================================================

describe('the result is routed, and Retry only when it can help (V3)', () => {
  test('change() to a failing sky shows the reason and Retry, FROM THE PROMISE', async () => {
    const h = harness({
      skyUpdate: () => Promise.resolve({ ok: false, reason: 'network', message: 'the network went away' }),
    })
    const result = await h.picker.change('Sky_01')
    assert.deepEqual(result, { ok: false, reason: 'network', message: 'the network went away' })
    assert.deepEqual(h.picker.failure, { reason: 'network', message: 'the network went away' })
    assert.equal(h.calls.setStatus.at(-1), 'the network went away')
    assert.equal(h.calls.setRetryVisible.at(-1), true)
  })

  test('a change that succeeds clears any earlier failure', async () => {
    const h = harness({ skyUpdate: () => Promise.resolve({ ok: true }) })
    h.picker.onSkyResult({ ok: false, reason: 'network', message: 'x' })
    await h.picker.change('Sky_01')
    assert.equal(h.picker.failure, null)
    assert.equal(h.calls.setRetryVisible.at(-1), false)
  })

  test('a controller that throws is a failure like any other', async () => {
    const h = harness({ skyUpdate: () => Promise.reject(new Error('boom')) })
    await h.picker.change('Sky_01')
    assert.equal(h.picker.failure.reason, 'network')
    assert.match(h.picker.failure.message, /boom/)
  })

  test('a Retry that fails again keeps the reason and Retry, with the NEW reason', async () => {
    const h = harness({
      skyUpdate: () => Promise.resolve({ ok: false, reason: 'network', message: 'the first try' }),
      skyRetry: () => Promise.resolve({ ok: false, reason: 'timeout', message: 'the sky took too long to download' }),
    })
    await h.picker.change('Sky_01')
    assert.deepEqual(h.picker.failure, { reason: 'network', message: 'the first try' })

    const again = await h.picker.retry()
    assert.equal(h.calls.retry, 1, 'the controller is retried once')
    assert.deepEqual(again, { ok: false, reason: 'timeout', message: 'the sky took too long to download' })
    assert.deepEqual(h.picker.failure, { reason: 'timeout', message: 'the sky took too long to download' })
    assert.equal(h.calls.setStatus.at(-1), 'the sky took too long to download')
    assert.equal(h.calls.setRetryVisible.at(-1), true, 'and Retry stays')
  })

  test('a Retry that succeeds clears both the reason and the button', async () => {
    const h = harness({
      skyUpdate: () => Promise.resolve({ ok: false, reason: 'network', message: 'x' }),
      skyRetry: () => Promise.resolve({ ok: true }),
    })
    await h.picker.change('Sky_01')
    assert.equal(h.calls.setRetryVisible.at(-1), true)

    await h.picker.retry()
    assert.equal(h.picker.failure, null)
    assert.equal(h.calls.setRetryVisible.at(-1), false)
    assert.equal(h.calls.setStatus.at(-1), null)
  })

  test('a rule refusal shows its reason with NO Retry (V3.4)', async () => {
    const message = 'url must start with https:// or with a single /'
    const h = harness({ skyUpdate: () => Promise.resolve({ ok: false, reason: 'url-scheme', message }) })
    await h.picker.change('Sky_01')
    assert.deepEqual(h.picker.failure, { reason: 'url-scheme', message })
    assert.equal(h.calls.setStatus.at(-1), message, 'the reason is shown')
    assert.equal(h.calls.setRetryVisible.at(-1), false, 'but there is no button to press')
  })

  test('Retry is never offered for ANY refusal by rule', async () => {
    for (const reason of ['url-type', 'url-length', 'url-chars', 'url-scheme', 'url-parse',
      'url-host', 'url-credentials', 'url-relative', 'no-base', 'empty']) {
      const h = harness({ skyUpdate: () => Promise.resolve({ ok: false, reason, message: reason }) })
      await h.picker.change('Sky_01')
      assert.equal(h.calls.setRetryVisible.at(-1), false, `${reason} must show no Retry`)
    }
  })

  test('Retry IS offered for every retryable failure', async () => {
    for (const reason of ['network', 'http', 'timeout', 'too-large', 'decode',
      'unsupported-image', 'bad-size', 'too-large-dimensions']) {
      const h = harness({ skyUpdate: () => Promise.resolve({ ok: false, reason, message: reason }) })
      await h.picker.change('Sky_01')
      assert.equal(h.calls.setRetryVisible.at(-1), true, `${reason} must offer Retry`)
    }
  })

  test('onRejected\'s own controller call is routed too (V3.1)', async () => {
    let call = 0
    const h = harness({
      texture: storedUrl(SKIES[0].url),
      skyUpdate: () => {
        call += 1
        return Promise.resolve(call === 1
          ? { ok: true }
          : { ok: false, reason: 'http', message: 'the server refused the request (500)' })
      },
    })
    h.picker.change('Sky_02')
    const seq = h.picker.waiting
    h.picker.onRejected(seq, 'the sky was refused')
    await settle()
    assert.deepEqual(h.picker.failure, { reason: 'http', message: 'the server refused the request (500)' },
      'the rollback update\'s result reaches the report')
    assert.equal(h.calls.setRetryVisible.at(-1), true)
  })

  test('a superseded failure is still ignored, and Retry stays hidden for it', async () => {
    const h = harness()
    for (const reason of ['superseded', 'disposed']) {
      h.picker.onSkyResult({ ok: false, reason })
      assert.equal(h.picker.failure, null, reason)
    }
    assert.equal(h.calls.setRetryVisible.length, 0)
  })
})

// ===========================================================================
// The Custom entry
// ===========================================================================

describe('the Custom entry', () => {
  test('it is shown for a texture that is not a catalog sky', () => {
    const h = harness({ texture: 'https://elsewhere.example/x.jpg' })
    h.picker.sync()
    assert.equal(h.last().value, SKY_CUSTOM)
    assert.equal(h.last().custom, true)
  })

  test('it is not shown for None or a catalog sky', () => {
    const none = harness({ texture: '' })
    none.picker.sync()
    assert.equal(none.last().value, SKY_NONE)
    assert.equal(none.last().custom, false)

    const catalog = harness({ texture: storedUrl(SKIES[0].url) })
    catalog.picker.sync()
    assert.equal(catalog.last().value, 'Sky_01')
    assert.equal(catalog.last().custom, false)
  })

  test('the options are the catalog skies, in order', () => {
    const h = harness()
    h.picker.sync()
    assert.deepEqual(h.last().options.map((o) => o.id), ['Sky_01', 'Sky_02'])
    assert.deepEqual(h.last().options.map((o) => o.name), ['Cloudy', 'Sunset'])
  })

  test('sync follows the SOM: another session\'s change shows up', () => {
    const h = harness({ texture: storedUrl(SKIES[0].url) })
    h.picker.sync()
    assert.equal(h.last().value, 'Sky_01')
    h.som.extras.atrium.background.texture = storedUrl(SKIES[1].url)
    h.picker.sync()
    assert.equal(h.last().value, 'Sky_02')
  })
})

// ===========================================================================
// The app.js wiring that only exists in the page
// ===========================================================================

describe('app.js wiring (read as a file)', () => {
  const source = readFileSync(resolve(__dirname, '../src/app.js'), 'utf-8')

  test('the picker is created and its results are routed', () => {
    assert.match(source, /skyPicker = createSkyPicker\(/)
    assert.match(source, /\.then\(\(result\) => skyPicker\?\.onSkyResult\(result\)\)/)
  })

  test('V3.1: app.js\'s Retry handler routes the promise — it cannot be dropped', () => {
    // app.js must call retry() (round 1 called `sky.update` from change() and
    // threw the answer away, so a failed sky left no reason and no Retry).
    assert.match(source, /epSkyRetry\?\.addEventListener\('click',\s*\(\)\s*=>[^\n]*skyPicker\.retry\(\)\)/)
    // And what it returns is routed, in the picker's one place: `retry()` and
    // `change()` both hand the controller's promise to `route()`.
    const picker = readFileSync(resolve(__dirname, '../src/sky-picker.js'), 'utf-8')
    assert.match(picker, /return route\(deps\.sky\.retry\(\)\)/,
      'retry() routes the controller promise to onSkyResult')
    assert.match(picker, /return route\(deps\.sky\?\.update\?\.\(/,
      'change() routes the controller promise to onSkyResult')
    assert.match(picker, /function route\(result\) \{/, 'and there is exactly one router')
    assert.equal((picker.match(/function route\(/g) ?? []).length, 1)
  })

  test('world:loaded and som:set __document__ sync the picker', () => {
    assert.match(source, /skyPicker\?\.sync\(\)/)
  })

  test('the three edit answers reach the picker', () => {
    assert.match(source, /skyPicker\?\.onAccepted\(seq\)/)
    assert.match(source, /skyPicker\?\.onRejected\(seq, message \|\| code\)/)
    assert.match(source, /skyPicker\?\.onUnknown\(seq\)/)
  })

  test('the picker resets at the world boundaries and refreshes with the palette', () => {
    const resets = source.match(/skyPicker\?\.reset\(\)/g) ?? []
    assert.ok(resets.length >= 3, `expected the three world-boundary resets, found ${resets.length}`)
    assert.match(source, /skyPicker\?\.refresh\(\)/)
  })

  test('the select and Retry button are wired', () => {
    assert.match(source, /epSky\?\.addEventListener\('change'/)
    assert.match(source, /epSkyRetry\?\.addEventListener\('click'/)
  })

  test('beginNewWorld resets the sky controller, beside the bridge (Z3)', () => {
    const at = source.indexOf('function beginNewWorld()')
    assert.ok(at > 0, 'beginNewWorld exists')
    const body = source.slice(at, at + 400)
    assert.match(body, /sky\.resetWorld\(\)/, 'a static .gltf load resets the sky too')
    assert.match(body, /modelBridge\.resetWorld\(\)/)
  })
})
