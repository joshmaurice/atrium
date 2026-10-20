// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// edit-key-wiring.test.js — the committed guard for the Edit-mode key wiring
// (edit-polish-2 Z6, L5; passdown 2026-10-19 §4.1).
//
// Today only throwaway browser checks catch a wrong order in app.js: the
// outside review found four app.js mutations passing all 506 tests, the 4.1 bug
// among them (the navigation listener reaching a key the Edit-mode listener was
// meant to consume). This test reads app.js as TEXT, the way
// import-guard.test.js does, and pins the four rules a rewrite must keep:
//
//   1. there is exactly one Edit-mode key listener (the body calls
//      `editKeyAction(`) and exactly one navigation one (the body calls
//      `nav.onKeyDown(`);
//   2. neither passes a capture argument;
//   3. the Edit-mode listener is registered first;
//   4. in its body, `if (!result) return`, `e.preventDefault()`,
//      `e.stopImmediatePropagation()` and `if (!result.run) return` appear in
//      that order — both consume calls come before the run check.
//
// It tolerates whitespace and formatting, not a rewrite: a deliberate rewrite
// updates this test with it. It cannot check the listener's behaviour after the
// run check (the disabled-button reason, nothing selected); §5.1 still covers
// those in the browser.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const APP_JS = resolve(__dirname, '../src/app.js')
const PASSOWN = 'passdown 2026-10-19 §4.1'

/** Marks each rule's failure with the rule that broke. */
function broken(rule) {
  return `${rule} (${PASSOWN})`
}

const REGISTRATION = "document.addEventListener('keydown',"

/**
 * Every `document.addEventListener('keydown', …)` in `source`, with the text
 * between the event name and the handler's body (its parameter list) and the
 * handler's body itself, matched by brace counting so nested blocks survive.
 */
function keydownListeners(source) {
  const listeners = []
  let at = source.indexOf(REGISTRATION)
  while (at !== -1) {
    const open = source.indexOf('{', at)
    assert.ok(open > at, broken('a keydown listener registers a handler'))
    let depth = 0
    let end = -1
    for (let i = open; i < source.length; i++) {
      if (source[i] === '{') depth++
      else if (source[i] === '}') {
        depth--
        if (depth === 0) { end = i; break }
      }
    }
    assert.ok(end > open, broken('a keydown listener has a balanced body'))
    listeners.push({
      at,
      line: source.slice(0, at).split('\n').length,
      args: source.slice(at + REGISTRATION.length, open),
      body: source.slice(open + 1, end),
    })
    at = source.indexOf(REGISTRATION, end)
  }
  return listeners
}

/** Whitespace-collapsed body, so formatting differences don't matter. */
const flatten = (text) => text.replace(/\s+/g, ' ')

/** The snippets, each found after the last one — that is the order rule. */
function findInOrder(body, snippets) {
  let from = 0
  for (const snippet of snippets) {
    const at = body.indexOf(snippet, from)
    if (at < 0) return { ok: false, missing: snippet }
    from = at + snippet.length
  }
  return { ok: true }
}

const source = readFileSync(APP_JS, 'utf-8')
const listeners = keydownListeners(source)

const withEditKeys = listeners.filter((l) => l.body.includes('editKeyAction('))
const withNavigation = listeners.filter((l) => l.body.includes('nav.onKeyDown('))
const withEscape = listeners.filter((l) => l.body.includes("e.key === 'Escape'"))

describe('app.js — the Edit-mode key wiring (Z6)', () => {
  test('the three document keydown listeners are the ones we know', () => {
    assert.equal(listeners.length, 3,
      broken(`app.js registers ${listeners.length} document keydown listeners, not 3 (Escape, Edit mode, navigation)`))
    assert.deepEqual(listeners.map((l) => l.line).slice().sort((a, b) => a - b), listeners.map((l) => l.line),
      broken('the keydown listeners are out of source order'))
  })

  test('the Edit-mode listener is the one that calls editKeyAction(), exactly once', () => {
    assert.equal(withEditKeys.length, 1,
      broken(`found ${withEditKeys.length} keydown listeners calling editKeyAction( — there must be exactly one`))
  })

  test('the navigation listener is the one that calls nav.onKeyDown(), exactly once', () => {
    assert.equal(withNavigation.length, 1,
      broken(`found ${withNavigation.length} keydown listeners calling nav.onKeyDown( — there must be exactly one`))
  })

  test('neither the Edit-mode listener nor the navigation one passes a capture argument', () => {
    for (const [name, l] of [['Edit mode', withEditKeys[0]], ['navigation', withNavigation[0]]]) {
      assert.ok(l, broken(`the ${name} listener is missing, so its capture argument cannot be checked`))
      assert.ok(!/\btrue\b|\bcapture\b/.test(l.args),
        broken(`the ${name} listener at app.js:${l.line} passes a capture argument`))
    }
  })

  test('the Edit-mode listener is registered BEFORE the navigation listener', () => {
    assert.ok(withEditKeys[0] && withNavigation[0],
      broken('one of the two listeners is missing, so their order cannot be checked'))
    assert.ok(withEditKeys[0].at < withNavigation[0].at,
      broken(`the navigation listener (app.js:${withNavigation[0].line}) is registered before the Edit-mode one ` +
        `(app.js:${withEditKeys[0].line}); the Edit-mode listener must come first so it can consume its keys`))
  })

  test('the Escape listener is registered before both', () => {
    assert.equal(withEscape.length, 1, broken("there must be exactly one listener handling e.key === 'Escape'"))
    assert.ok(withEscape[0].at < withEditKeys[0].at && withEscape[0].at < withNavigation[0].at,
      broken('the Escape listener must stay registered before the Edit-mode and navigation listeners'))
  })

  test('both consume calls come before the run check, in this order', () => {
    const body = flatten(withEditKeys[0].body)
    const result = findInOrder(body, [
      'if (!result) return',
      'e.preventDefault()',
      'e.stopImmediatePropagation()',
      'if (!result.run) return',
    ])
    assert.ok(result.ok,
      broken(`the Edit-mode listener's body is missing « ${result.missing} », or it is out of order: ` +
        'it must read `if (!result) return`, `e.preventDefault()`, `e.stopImmediatePropagation()` and ' +
        '`if (!result.run) return`, in that order'))
  })

  test('every recognised key is consumed whether or not it runs', () => {
    // The two consume calls must precede the run check: the reason the guard
    // exists is Ctrl/Cmd+D reaching navigation (KeyD strafes) or opening the
    // bookmark dialog when the Edit-mode listener runs second.
    const body = flatten(withEditKeys[0].body)
    const runCheck = body.indexOf('if (!result.run) return')
    assert.ok(runCheck >= 0, broken('the Edit-mode listener has no run check'))
    for (const call of ['e.preventDefault()', 'e.stopImmediatePropagation()']) {
      const at = body.indexOf(call)
      assert.ok(at >= 0, broken(`the Edit-mode listener does not call ${call.replace('e.', '')}`))
      assert.ok(at < runCheck,
        broken(`${call} runs after the run check, so a taken-but-not-run key reaches navigation`))
    }
  })
})
