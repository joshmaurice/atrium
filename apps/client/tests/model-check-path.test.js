// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// model-check-path.test.js — W4 of models-by-url round 4, app.js's side.
//
// On the owner's page `textureBudget.taken` stayed at 0.0 MiB through all five
// Check-then-Save cycles: the Check path fetched and parsed on its own, without
// `reserveTexture`, outside the bridge's serialized parse, and then put the
// result in the cache with its `textureBytes`, so Save adopted an entry that had
// never been charged. `releaseHeldCheck` then released bytes that were never
// reserved, which `release` clamps at 0.
//
// This reads app.js as a file (no browser, no DOM) and checks the shape of the
// Check path: it goes through the bridge's one load entry point, and it neither
// fetches nor parses anything by itself. The behaviour of that entry point is
// covered by packages/renderer-three/tests/model-bridge.test.js (W4 block).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const APP_JS = resolve(__dirname, '../src/app.js')
const source = readFileSync(APP_JS, 'utf-8')

/** The body of `[async] function NAME(...) { ... }`, its braces matched. */
function functionBody(text, name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(text)
  if (!match) return null
  const open = text.indexOf('{', text.indexOf(')', match.index))
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1
    else if (text[i] === '}') {
      depth -= 1
      if (depth === 0) return text.slice(open + 1, i)
    }
  }
  return null
}

/** Remove `//` comments, so a note about the old shape is not read as the shape. */
function withoutComments(code) {
  return code.split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n')
}

const checkBody = withoutComments(functionBody(source, 'checkModelNow') ?? '')
const releaseBody = withoutComments(functionBody(source, 'releaseHeldCheck') ?? '')
const holdBody = withoutComments(functionBody(source, 'holdCheckedTemplate') ?? '')

test('W4: the Check path exists and goes through the bridge’s load entry point', () => {
  assert.ok(checkBody, 'checkModelNow is in app.js')
  assert.match(checkBody, /await\s+modelBridge\.loadTemplate\(/, 'Check awaits modelBridge.loadTemplate')
  assert.match(checkBody, /\bholdCheckedTemplate\(/, 'and holds what it loaded')
})

test('W4: the Check path no longer fetches or parses on its own', () => {
  assert.doesNotMatch(checkBody, /\bparseTemplate\s*\(/, 'no parseTemplate call in the Check path')
  assert.doesNotMatch(checkBody, /\bfetchModel\s*\(/, 'no fetchModel call in the Check path')
  assert.doesNotMatch(checkBody, /\bsha256Hex\s*\(/, 'no hashing of its own: the bridge holds the bytes')
  assert.doesNotMatch(checkBody, /\btextureBudget\b/, 'and no budget of its own')
  assert.doesNotMatch(source, /import\s*\{[^}]*\bparseTemplate\b[^}]*\}\s*from\s*'@atrium\/renderer-three'/,
    'app.js imports no parseTemplate from @atrium/renderer-three')
})

test('W4: the Check reserves through the bridge, and Cancel gives the reference back', () => {
  assert.match(releaseBody, /modelBridge\.releaseTemplate\(/, 'releaseHeldCheck gives the reference back')
  assert.doesNotMatch(releaseBody, /\btextureBudget\b/, 'it does not hand bytes back by hand')
  assert.doesNotMatch(releaseBody, /cache\.delete\(/, 'and it does not delete the entry (A8: it is kept)')
  assert.match(holdBody, /modelBridge\.cache\.alias\(/, 'the pinned key is an alias of the held entry, not a second one')
  assert.doesNotMatch(holdBody, /\btextureBudget\b/, 'nothing in the held Check charges the budget twice')
})

// S3 (round 6) — the Check's generation, app.js's side.
//
// The outside reviewer's sequence left the page holding a template for a URL the
// form had moved off: the late result called `holdCheckedTemplate` again, after
// `releaseHeldCheck` had already given the reference back.

const releaseBodyS3 = withoutComments(functionBody(source, 'releaseHeldCheck') ?? '')
const endBodyS3 = withoutComments(functionBody(source, 'endCheck') ?? '')

test('S3: a Check that lands after the form moved on gives its reference back', () => {
  assert.ok(endBodyS3, 'endCheck is in app.js')
  assert.match(endBodyS3, /checkGeneration\s*\+=\s*1/, 'ending a check moves the generation on')
  assert.match(endBodyS3, /releaseHeldCheck\(/, 'and releases what it held')
  assert.match(checkBody, /checkGeneration/, 'the Check path reads the generation it belongs to')
  assert.match(checkBody, /releaseTemplate\(loaded\.key\)/, 'and gives a stale entry straight back to the cache')
  assert.match(checkBody, /if \(generation !== checkGeneration\)/, 'the guard is on the generation, not on the URL text')
  assert.match(source, /onDropResult: \(\) => endCheck\(\)/, 'the form ends the check on a URL edit and on a close')
  assert.doesNotMatch(releaseBodyS3, /checkGeneration/, 'releasing a held entry does not move the generation')
})
