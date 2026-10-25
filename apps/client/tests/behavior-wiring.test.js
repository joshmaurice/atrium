// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// behavior-wiring.test.js — scripting-4b-2 steps 5 and 6: the wiring that only
// exists in the page. As app-wiring.test.js does, it reads app.js and index.html
// as TEXT and pins the pieces no fake element can reach. It tolerates
// whitespace and formatting, not a rewrite.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(__dirname, '../src/app.js'), 'utf-8')
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf-8')

describe('scripting-4b-2 — the Behaviour section is wired', () => {
  test('the runner is created, tracked in the frame loop, and torn down with the world', () => {
    assert.match(source, /runner = createBehaviorRunner\(\{/)
    assert.match(source, /runner\?\.tick\(\)/)
    assert.match(source, /runner\?\.select\(/)
    assert.match(source, /runner\?\.setGesture\(/)
  })

  test('V13 — the Behaviour section is NOT one of the gate\'s forms, and Edit off closes it', () => {
    // It is still built with the panel's gate for `register`-only bookkeeping,
    // but it must never CLAIM it: claiming closed the library grid after every
    // placement (§1.4).
    assert.match(source, /behaviorForm = createBehaviorForm\(\{[\s\S]{0,600}?gate: modelGate/)
    assert.doesNotMatch(source, /behaviorForm\?\.open\([\s\S]{0,80}gate\.claim/, 'no claim at open')
    assert.match(source, /modelGate\.closeCurrent\(\)[\s\S]{0,600}?behaviorForm\?\.close\(\)/,
      'Edit off closes the Behaviour section explicitly')
  })

  test('the answers route to the form', () => {
    for (const kind of ['edit:accepted', 'edit:rejected', 'edit:unknown']) {
      assert.match(source, new RegExp(`behaviorForm\\?\\.onAnswer\\('${kind}'`), `${kind} reaches the form`)
    }
  })

  test('the form resets on connecting, disconnected and a new world', () => {
    const resets = source.match(/behaviorForm\?\.reset\(\)/g) ?? []
    assert.ok(resets.length >= 3, `three resets: ${resets.length}`)
  })

  test('refreshBehaviorRow renders on selection and on som:set of the leaf', () => {
    assert.match(source, /function refreshBehaviorRow\(\)/)
    assert.match(source, /refreshEditPanel\(\)[\s\S]{0,400}?refreshBehaviorRow\(\)/)
    assert.match(source, /path === 'extras\.atrium\.behavior'[\s\S]{0,120}?refreshBehaviorRow\(\)/)
  })

  test('select comes from the VIEWPORT click, never from a SOM click', () => {
    // The sibling branch: `!modes.edit`, `e.target !== canvas`, `isSelectClick`.
    assert.match(source, /if \(!modes\.edit\) \{[\s\S]{0,400}?isSelectClick\(down[\s\S]{0,200}?runner\?\.select\(pickBehaviorTarget\(e\)\)/)
    assert.doesNotMatch(source, /dispatchPointerEvent\([^)]*\)[\s\S]{0,40}runner\?\.select/)
  })

  test('the drag rule is set from the handle drag and from a form write', () => {
    assert.match(source, /activeGesture = editTracker\.begin\(selected\)[\s\S]{0,200}?runner\?\.setGesture\(selected\.name\)/)
    assert.match(source, /writeSend: \(node, field, value\) => \{[\s\S]{0,200}?runner\?\.setGesture\(node\.name\)/)
    assert.match(source, /onTransformsSettled[\s\S]{0,200}?runner\?\.setGesture\(null\)/)
  })

  test('F6 — the Visible checkbox writes through the same tracker', () => {
    assert.match(source, /epVisible[\s\S]{0,400}?editTracker\.commit\(selected, 'visible'/)
    assert.match(source, /applyVisibility\(docView, client\.som\)/)
    assert.match(source, /setNodeVisible\(docView, node, node\.visible !== false\)/)
  })
})

describe('scripting-4b-2 — the page carries the section\'s elements', () => {
  const ids = [
    'ep-behavior-row', 'ep-behavior-template', 'ep-behavior-params', 'ep-behavior-actions',
    'ep-behavior-enabled', 'ep-behavior-save', 'ep-behavior-remove',
    'ep-behavior-status', 'ep-behavior-note', 'ep-behavior-log', 'ep-behavior-log-lines',
    'ep-behavior-hint',
    'ep-visible',
  ]
  for (const id of ids) {
    test(`#${id} is in index.html`, () => {
      assert.match(html, new RegExp(`id="${id}"`))
    })
  }
})

// ── T1 (r3): the one help element, wired ─────────────────────────────────

describe('scripting-4b-2 r3 (T1) — #ep-behavior-hint is the section\'s one help element', () => {
  test('it sits inside the Behaviour section, between the params and the actions', () => {
    const row = html.indexOf('id="ep-behavior-row"')
    const params = html.indexOf('id="ep-behavior-params"')
    const hint = html.indexOf('id="ep-behavior-hint"')
    const actions = html.indexOf('id="ep-behavior-actions"')
    for (const [what, at] of [['row', row], ['params', params], ['hint', hint], ['actions', actions]]) {
      assert.notEqual(at, -1, `#ep-behavior-${what} is in index.html`)
    }
    assert.ok(row < params && params < hint && hint < actions,
      `order: row ${row} < params ${params} < hint ${hint} < actions ${actions}`)
  })

  test('app.js passes it to createBehaviorForm as the form\'s hint element', () => {
    // Whole-line `//` comments are dropped first: a COMMENTED-OUT wire passes
    // nothing, so the guard must not accept one.
    const code = source.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')
    assert.match(code, /const epBehaviorHint\s*=\s*document\.getElementById\('ep-behavior-hint'\)/)
    assert.match(code, /createBehaviorForm\(\{[\s\S]{0,600}?hint: epBehaviorHint/)
  })
})

describe('scripting-4b-2 r5 (V1, V2, V12) — the page obeys the DOM\'s own rules', () => {
  const SRC_FILES = readdirSync(resolve(__dirname, '../src')).filter((f) => f.endsWith('.js'))
  /** Code only: a mention of the bug inside a comment is not the bug. */
  const code = (text) => text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')

  test('V1/V12 — no apps/client/src file assigns a getter-only DOM property', () => {
    // `dataset`, `style`, `classList`, `children` and `parentNode` are
    // getter-only in the browser: `el.dataset = { … }` throws `TypeError`.
    // §1.2 item 1 was exactly this line, in behavior-form.js.
    for (const file of SRC_FILES) {
      const text = code(readFileSync(resolve(__dirname, '../src', file), 'utf-8'))
      for (const prop of ['dataset', 'style', 'classList', 'children', 'parentNode']) {
        const pattern = new RegExp(`\\.${prop}\\s*=[^=]`)
        const line = text.split('\n').findIndex((l) => pattern.test(l))
        assert.equal(line, -1, `${file}: assigns .${prop} at line ${line + 1}`)
      }
    }
  })

  test('V1 — the form writes a field\'s data attribute as a property, never the map itself', () => {
    const form = code(readFileSync(resolve(__dirname, '../src/behavior-form.js'), 'utf-8'))
    assert.match(form, /dataset\.field\s*=/, 'the data attribute is set on the live map')
    assert.doesNotMatch(form, /\.dataset\s*=\s*\{/, 'and never by assigning the map')
  })

  test('V2 — the Enabled listener is `click`, and no code reads its `.checked`', () => {
    const form = code(readFileSync(resolve(__dirname, '../src/behavior-form.js'), 'utf-8'))
    assert.match(form, /elements\.enabled\.addEventListener\('click'/)
    assert.doesNotMatch(form, /elements\.enabled\.checked/)
  })

  test('V2 — the three action buttons are type="button" so a form never submits', () => {
    for (const id of ['ep-behavior-enabled', 'ep-behavior-save', 'ep-behavior-remove']) {
      assert.match(html, new RegExp(`<button type="button" id="${id}"`), `#${id}`)
    }
  })
})
