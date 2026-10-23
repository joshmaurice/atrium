// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// edit-key-wiring.test.js — the committed guard for the Edit-mode key wiring
// (edit-polish-2 Z6, L5; passdown 2026-10-19 §4.1; hardened in edit-polish-3 Z6,
// L6a).
//
// Today only throwaway browser checks catch a wrong order in app.js: the
// outside review found four app.js mutations passing all 506 tests, the 4.1 bug
// among them (the navigation listener reaching a key the Edit-mode listener was
// meant to consume). This test reads app.js as TEXT, the way
// import-guard.test.js does, and pins the rules a rewrite must keep:
//
//   1. there is exactly one Edit-mode key listener (the body calls
//      `editKeyAction(`) and exactly one navigation one (the body calls
//      `nav.onKeyDown(`);
//   2. neither passes a capture argument (Z6: read from the call's THIRD
//      argument — an options object after the handler counts too);
//   3. the Edit-mode listener is registered first;
//   4. in its body, `if (!result) return`, `e.preventDefault()`,
//      `e.stopImmediatePropagation()` and `if (!result.run) return` appear in
//      that order — both consume calls come before the run check;
//   5. a key the listener consumes but does not run never reaches navigation.
//
// Z6 closes the two blind spots of the first version: a capture flag AFTER the
// handler's body (`}, true)`) was never read, because the old guard only looked
// at the text between `'keydown',` and the body's `{`; and bodies were matched as
// raw text, so a consume call that existed only inside a comment still satisfied
// the order rule. Comments are now stripped by a small scanner that respects
// string, template and regex literals, and the capture flag is read from the
// call's exact third argument, splitting the list at TOP-LEVEL commas.
//
// It tolerates whitespace and formatting, not a rewrite: a deliberate rewrite
// updates this test with it. It cannot check the listener's behaviour after the
// run check (the disabled-button reason, nothing selected) — §5.1 covers those in
// the browser — and `if (false) e.stopImmediatePropagation()` remains a known,
// accepted limit of a text guard (polish-2 L5).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const APP_JS = resolve(__dirname, '../src/app.js')
const PASSOWN = 'passdown 2026-10-19 §4.1'
const Z6 = 'edit-polish-3 Z6, L6a'

/** Marks each rule's failure with the rule that broke. */
function broken(rule, why = PASSOWN) {
  return `${rule} (${why})`
}

// ===========================================================================
// The scanner (Z6) — comments out, literals kept
// ===========================================================================

/**
 * Copy `source` through the literal that starts at `at` (a quote or a backtick),
 * honouring backslash escapes, and return the index just after it. A template
 * literal's `${ … }` is copied as text: app.js never puts a comment or an
 * unbalanced quote inside one.
 */
function skipLiteral(source, at) {
  const quote = source[at]
  let i = at + 1
  while (i < source.length) {
    const ch = source[i]
    if (ch === '\\') { i += 2; continue }
    if (ch === quote) return i + 1
    i += 1
  }
  return i
}

/**
 * Z6 — strip `//` and `/* … *\/` comments from `source`, keeping string, template
 * and regex literals intact. It does not need to parse JavaScript: it needs to
 * tell a comment from a literal well enough for app.js, and its own tests pin
 * that.
 *
 * A `/` starts a REGEX only where one can appear — after `(`, `,`, `=` or the
 * keyword `return` — so a division (`a / b`) and a `//` inside a URL string are
 * both left alone.
 */
function stripComments(source) {
  let out = ''
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    const next = source[i + 1]
    if (ch === "'" || ch === '"' || ch === '`') {
      const end = skipLiteral(source, i)
      out += source.slice(i, end)
      i = end
      continue
    }
    if (ch === '/' && next === '/') {
      const end = source.indexOf('\n', i)
      i = end === -1 ? source.length : end
      continue
    }
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? source.length : end + 2
      continue
    }
    if (ch === '/' && startsRegex(out)) {
      const end = skipRegex(source, i)
      out += source.slice(i, end)
      i = end
      continue
    }
    out += ch
    i += 1
  }
  return out
}

/** Is a `/` here the start of a regex literal? Only after `(`, `,`, `=` or `return`. */
function startsRegex(before) {
  const trimmed = before.replace(/\s+$/, '')
  if (trimmed === '') return true
  return /[([,=]$/.test(trimmed) || /\breturn$/.test(trimmed)
}

/** Copy a regex literal (`/…/flags`) and return the index just after it. */
function skipRegex(source, at) {
  let i = at + 1
  let inClass = false
  while (i < source.length) {
    const ch = source[i]
    if (ch === '\\') { i += 2; continue }
    if (ch === '[') inClass = true
    else if (ch === ']') inClass = false
    else if (ch === '/' && !inClass) {
      i += 1
      while (i < source.length && /[a-z]/i.test(source[i])) i += 1
      return i
    } else if (ch === '\n') return i
    i += 1
  }
  return i
}

/**
 * Z6 — the arguments of the call whose `(` is at `open`, split at TOP-LEVEL
 * commas, and the index of the call's closing `)`. It matches (), [] and {}
 * nesting and skips strings, template literals, regexes and comments, so an
 * object literal, a nested call or a string with a comma in it does not split an
 * argument in two.
 *
 * @returns {{ args: string[], end: number }}
 */
function splitArguments(source, open) {
  const args = []
  let depth = 0
  let start = open + 1
  let i = open
  while (i < source.length) {
    const ch = source[i]
    if (ch === "'" || ch === '"' || ch === '`') { i = skipLiteral(source, i); continue }
    if (ch === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i)
      i = end === -1 ? source.length : end
      continue
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? source.length : end + 2
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') { depth += 1; i += 1; continue }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1
      if (depth === 0 && ch === ')') {
        args.push(source.slice(start, i))
        return { args: args.map((arg) => arg.trim()), end: i }
      }
      i += 1
      continue
    }
    if (ch === ',' && depth === 1) {
      args.push(source.slice(start, i))
      start = i + 1
    }
    i += 1
  }
  return { args: args.map((arg) => arg.trim()), end: source.length }
}

// ===========================================================================
// The listeners
// ===========================================================================

const REGISTRATION = "document.addEventListener('keydown'"

/** The body of a handler function's text, by brace counting from its `=>`. */
function handlerBody(handlerText) {
  const arrow = handlerText.indexOf('=>')
  assert.ok(arrow >= 0, broken('a keydown listener registers a handler function'))
  const open = handlerText.indexOf('{', arrow)
  assert.ok(open >= 0, broken('a keydown listener registers a handler with a body'))
  let depth = 0
  for (let i = open; i < handlerText.length; i++) {
    if (handlerText[i] === '{') depth += 1
    else if (handlerText[i] === '}') {
      depth -= 1
      if (depth === 0) return handlerText.slice(open + 1, i)
    }
  }
  return assert.fail(broken('a keydown listener has a balanced body'))
}

/**
 * Every `document.addEventListener('keydown', …)` in `source`: its line, the
 * call's full argument list and the handler's body.
 */
function keydownListeners(source) {
  const listeners = []
  let at = source.indexOf(REGISTRATION)
  while (at !== -1) {
    const open = source.indexOf('(', at)
    assert.ok(open > at, broken('a keydown listener registers a handler'))
    const { args, end } = splitArguments(source, open)
    assert.equal(args[0], "'keydown'", broken('the first argument is the keydown event name'))
    assert.ok(args.length >= 2, broken('a keydown listener passes a handler'))
    listeners.push({
      at,
      line: source.slice(0, at).split('\n').length,
      args,
      options: args.length > 2 ? args[2] : null,
      handler: args[1],
      body: handlerBody(args[1]),
    })
    at = source.indexOf(REGISTRATION, end)
  }
  return listeners
}

/**
 * Z6 — what the listener's THIRD argument says about capture: `true`, `false`, or
 * `'unknown'` for anything this guard cannot read (a variable, a call). The
 * handler's body is never searched for `true` or `capture`: only the argument
 * decides.
 */
function captureFlag(options) {
  if (options === null || options === undefined || options === '') return false
  const text = options.trim()
  if (text === 'true') return true
  if (text === 'false') return false
  if (text.startsWith('{') || text.startsWith('[')) {
    const match = text.match(/(?:^|[,{\s])capture\s*:\s*([^,}\]]*)/)
    if (!match) return false                       // no capture property: not capturing
    return match[1].trim() !== 'false'
  }
  return 'unknown'
}

/** The rule-2 failure for a listener, or null (Z6 — the exact third argument). */
function captureProblem(listener) {
  const flag = captureFlag(listener.options)
  if (flag === true) return 'passes a capture argument'
  if (flag === 'unknown') return `passes options this guard cannot read — "unknown options" (${listener.options})`
  return null
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

/**
 * Z6 — the four rules of the Edit-mode listener's body, as one answer, so a
 * crafted source in the tests below can be run through the SAME code the real
 * app.js is.
 */
function bodyProblems(listener) {
  const body = flatten(listener.body)
  const order = findInOrder(body, [
    'if (!result) return',
    'e.preventDefault()',
    'e.stopImmediatePropagation()',
    'if (!result.run) return',
  ])
  if (!order.ok) {
    return `the Edit-mode listener's body is missing « ${order.missing} », or it is out of order: ` +
      'it must read `if (!result) return`, `e.preventDefault()`, `e.stopImmediatePropagation()` and ' +
      '`if (!result.run) return`, in that order'
  }
  return null
}

// ===========================================================================
// The scanner's and the splitter's own tests (Z6)
// ===========================================================================

describe('Z6 — the comment scanner', () => {
  test('a // line comment is stripped, everywhere it appears in a line', () => {
    assert.equal(stripComments('const a = 1 // gone\nconst b = 2'), 'const a = 1 \nconst b = 2')
    assert.equal(stripComments('f() // one\n// two\n'), 'f() \n\n')
  })

  test('a /* */ block comment is stripped', () => {
    assert.equal(stripComments('const a = /* gone */ 1'), 'const a =  1')
    assert.equal(stripComments('/* whole line */\nconst b = 2'), '\nconst b = 2')
  })

  test('a // inside a string or a URL is KEPT', () => {
    assert.equal(stripComments("const a = 'https://x/y' // gone"), "const a = 'https://x/y' ")
    assert.equal(stripComments('const a = "a // b"'), 'const a = "a // b"')
    assert.equal(stripComments("const a = 'it \\'s // fine'"), "const a = 'it \\'s // fine'")
  })

  test('a template literal is KEPT, comment or not', () => {
    assert.equal(stripComments('const a = `x // y` // gone'), 'const a = `x // y` ')
    assert.equal(stripComments('const a = `[sky] ${n} // not a comment`'), 'const a = `[sky] ${n} // not a comment`')
  })

  test('a regex literal is KEPT where a regex can appear', () => {
    assert.equal(stripComments('if (/a\\/\\/b/.test(s)) f()'), 'if (/a\\/\\/b/.test(s)) f()')
    assert.equal(stripComments('const re = /\\/\\*/'), 'const re = /\\/\\*/')
    // ...and a division is not a regex, so a following // IS a comment.
    assert.equal(stripComments('const r = a / b // gone'), 'const r = a / b ')
  })

  test('a comment that names a symbol is not code', () => {
    assert.equal(stripComments('// e.stopImmediatePropagation()\ne.preventDefault()'), '\ne.preventDefault()')
    assert.equal(stripComments('f(/* true */)'), 'f()')
  })
})

describe('Z6 — the top-level argument splitter', () => {
  const argsOf = (text) => splitArguments(text, text.indexOf('(')).args

  test('a plain three-argument call', () => {
    assert.deepEqual(argsOf("addEventListener('keydown', (e) => { f() })"),
      ["'keydown'", '(e) => { f() }'])
  })

  test('nested parentheses and calls do not split an argument', () => {
    assert.deepEqual(argsOf("addEventListener('keydown', (e) => { f(a, b) }, { capture: true })"),
      ["'keydown'", '(e) => { f(a, b) }', '{ capture: true }'])
  })

  test('an object literal and an array do not split one either', () => {
    assert.deepEqual(argsOf("addEventListener('keydown', handler, { once: true, capture: false })"),
      ["'keydown'", 'handler', '{ once: true, capture: false }'])
    assert.deepEqual(argsOf("addEventListener('keydown', handler, [1, 2])"),
      ["'keydown'", 'handler', '[1, 2]'])
  })

  test('a string with a comma in it is one argument', () => {
    assert.deepEqual(argsOf("addEventListener('keydown', handler, { on: 'a,b' })"),
      ["'keydown'", 'handler', "{ on: 'a,b' }"])
    assert.deepEqual(argsOf("addEventListener('keydown', handler, `a,b`)"),
      ["'keydown'", 'handler', '`a,b`'])
  })

  test('a comment inside the argument list is skipped', () => {
    assert.deepEqual(argsOf("addEventListener('keydown', (e) => { f() } /* why */, true)"),
      ["'keydown'", '(e) => { f() } /* why */', 'true'].map((s) => s.trim()))
  })
})

// ===========================================================================
// The guard against crafted sources (Z6)
// ===========================================================================

/** A miniature app.js with the three listeners, the Edit-mode one configurable. */
function crafted({ escape = "document.addEventListener('keydown', (e) => { if (e.key === 'Escape') return })",
  edit = EDIT_LISTENER, nav = "document.addEventListener('keydown', (e) => { nav.onKeyDown(e.code) })" } = {}) {
  return stripComments([escape, edit, nav].join('\n'))
}

// The shape the real app.js uses, with the two consume calls in order.
const EDIT_LISTENER = `document.addEventListener('keydown', (e) => {
  const result = editKeyAction(keyEventFor(e), { editOn: modes.edit })
  if (!result) return
  e.preventDefault()
  e.stopImmediatePropagation()
  if (!result.run) return
  undo.run(result.action)
})`

const editOf = (source) => keydownListeners(source).find((l) => l.body.includes('editKeyAction('))

describe('Z6 — a capture flag is read from the exact third argument', () => {
  test('the real app.js passes no capture flag (the two listeners at all)', () => {
    for (const listener of keydownListeners(readFileSync(APP_JS, 'utf-8').replace(/\/\/[^\n]*/g, ''))) {
      assert.equal(captureFlag(listener.options), false,
        broken(`the listener at app.js:${listener.line} ${captureProblem(listener) ?? 'is fine'}`))
    }
  })

  test('a capture flag AFTER the handler’s body fails the rule', () => {
    const source = crafted({ edit: `${EDIT_LISTENER.slice(0, -1)}, true)` })
    const listener = editOf(source)
    assert.equal(captureFlag(listener.options), true)
    assert.match(captureProblem(listener), /passes a capture argument/)
  })

  test('an options object after the body fails the rule too', () => {
    const source = crafted({ edit: `${EDIT_LISTENER.slice(0, -1)}, { capture: true })` })
    assert.equal(captureFlag(editOf(source).options), true)
  })

  test('an options object with capture: false, or with no capture at all, passes', () => {
    for (const options of ['{ capture: false }', '{ passive: true }', '{ once: true, capture: false }']) {
      const source = crafted({ edit: `${EDIT_LISTENER.slice(0, -1)}, ${options})` })
      const listener = editOf(source)
      assert.equal(captureFlag(listener.options), false, `${options} is not capturing`)
      assert.equal(captureProblem(listener), null)
    }
  })

  test('a third argument that is a variable or a call is "unknown options"', () => {
    for (const options of ['opts', 'optionsFor(x)', 'true && x']) {
      const source = crafted({ edit: `${EDIT_LISTENER.slice(0, -1)}, ${options})` })
      const listener = editOf(source)
      assert.equal(captureFlag(listener.options), 'unknown')
      assert.match(captureProblem(listener), /unknown options/)
    }
  })

  test('a body that contains true, or a variable named capture, is NOT the rule', () => {
    const source = crafted({
      edit: EDIT_LISTENER.replace('undo.run(result.action)',
        'const capture = true; if (capture && result.action) undo.run(result.action)'),
    })
    const listener = editOf(source)
    assert.equal(listener.options, null, 'no third argument at all')
    assert.equal(captureFlag(listener.options), false)
    assert.equal(captureProblem(listener), null)
    assert.equal(bodyProblems(listener), null, 'and the body rules still pass')
  })
})

describe('Z6 — a consume call that exists only in a comment does not count', () => {
  test('the order rule fails when stopImmediatePropagation() is commented out', () => {
    const source = crafted({ edit: EDIT_LISTENER.replace('e.stopImmediatePropagation()', '// e.stopImmediatePropagation()') })
    const listener = editOf(source)
    assert.match(bodyProblems(listener) ?? '', /stopImmediatePropagation/)
  })

  test('a live copy elsewhere in a comment-only body still fails the ORDER rule', () => {
    // The consume call is live but AFTER the run check, and a commented copy sits
    // where the rule wants it: the stripped body must fail.
    const source = crafted({
      edit: `document.addEventListener('keydown', (e) => {
        const result = editKeyAction(keyEventFor(e), { editOn: modes.edit })
        if (!result) return
        e.preventDefault()
        // e.stopImmediatePropagation()
        if (!result.run) return
        e.stopImmediatePropagation()
      })`,
    })
    assert.match(bodyProblems(editOf(source)) ?? '', /stopImmediatePropagation/)
  })

  test('a block comment hides a consume call the same way', () => {
    const source = crafted({ edit: `document.addEventListener('keydown', (e) => {
      const result = editKeyAction(keyEventFor(e), { editOn: modes.edit })
      if (!result) return
      e.preventDefault()
      /* e.stopImmediatePropagation() */
      if (!result.run) return
      undo.run(result.action)
    })` })
    assert.match(bodyProblems(editOf(source)) ?? '', /stopImmediatePropagation/)
  })

  test('the crafted passing source passes every rule', () => {
    const listener = editOf(crafted())
    assert.equal(bodyProblems(listener), null)
    assert.equal(captureProblem(listener), null)
  })
})

// ===========================================================================
// The real app.js
// ===========================================================================

const source = stripComments(readFileSync(APP_JS, 'utf-8'))
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
      assert.equal(captureProblem(l), null,
        broken(`the ${name} listener at app.js:${l.line} ${captureProblem(l)}`))
    }
  })

  test('the capture rule reads the THIRD argument, and never the handler’s body', () => {
    // The rule's own tests (above) prove it; here the real listeners have no third
    // argument at all, so their options are null and only the argument can matter.
    for (const l of listeners) {
      assert.equal(l.options, null, `app.js:${l.line} passes only the event name and a handler`)
    }
    assert.equal(captureFlag(null), false)
    assert.equal(captureFlag(undefined), false)
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
    const problem = bodyProblems(withEditKeys[0])
    assert.equal(problem, null, broken(problem ?? ''))
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
