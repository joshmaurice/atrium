// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// model-bridge-wiring.test.js — V3 of models-by-url round 2, app.js's side.
//
// The bridge has no default fetcher (it throws without one, see
// packages/renderer-three/tests/model-bridge.test.js). Round 1's app.js built it
// without `hooks.fetchModel`, so every placed model stayed an amber placeholder
// in every browser while all the Node suites passed — the bridge's own suite
// injects its own fetcher. This reads app.js as a file (no browser, no DOM) and
// checks that the object it hands `createModelBridge` carries the real fetcher.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const APP_JS = resolve(__dirname, '../src/app.js')
const source = readFileSync(APP_JS, 'utf-8')

/** The text between the parentheses of the nth `createModelBridge(` call. */
function callArgs(text, callee) {
  const calls = []
  let index = text.indexOf(`${callee}(`)
  while (index >= 0) {
    const start = index + callee.length + 1
    let depth = 1
    let i = start
    while (i < text.length && depth > 0) {
      const ch = text[i]
      if (ch === '(') depth += 1
      else if (ch === ')') depth -= 1
      i += 1
    }
    calls.push(text.slice(start, i - 1))
    index = text.indexOf(`${callee}(`, i)
  }
  return calls
}

const calls = callArgs(source, 'createModelBridge')

test('V3: app.js creates exactly one model bridge', () => {
  assert.equal(calls.length, 1, 'one createModelBridge call')
})

test('V3: the bridge app.js builds is given the real fetcher', () => {
  const deps = calls[0]
  assert.match(deps, /\bhooks\s*:\s*\{/, 'the deps carry a hooks object')
  const hooks = deps.slice(deps.indexOf('hooks'))
  assert.match(hooks, /\bfetchModel\s*:\s*\([^)]*\)\s*=>/, 'hooks.fetchModel is a function')
  assert.match(hooks, /=>\s*fetchModel\s*\(/, 'and it calls the imported fetcher')
  assert.match(source, /import\s*\{[^}]*\bfetchModel\b[^}]*\}\s*from\s*'@atrium\/client\/model-fetch'/,
    'fetchModel comes from @atrium/client/model-fetch')
})
