// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// edit-outline-and-clip-row.test.js — scripting-4a round 3, W2 and W3's guards.
//
// apps/client tests cannot import three.js or touch the DOM, so — as
// app-wiring.test.js and model-animation-wiring.test.js do — this reads app.js
// and index.html as TEXT. It pins the two round-3 changes that are pure wiring:
//
//   W2  `attachSelected` makes the selected object's own transforms current
//       BEFORE it builds the `BoxHelper`, so an outline on a node selected
//       before its first render (Duplicate, Undo) is measured from fresh ones;
//   W3  the clip controls are two rows — the label and the select, then Loop,
//       Play and Stop in `#ep-anim-actions` — the select can shrink
//       (`min-width: 0`), and `renderAnimationRow` shows and hides both rows and
//       puts the chosen id on the select's `title`.
//
// It tolerates whitespace and formatting, not a rewrite: a deliberate rewrite
// updates this test with it.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(__dirname, '../src/app.js'), 'utf-8')
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf-8')

/** The body of `function name(…) { … }`, by brace counting after the parameters. */
function functionBody(name) {
  const at = source.search(new RegExp(`function ${name}\\s*\\(`))
  assert.ok(at >= 0, `app.js has a function ${name}()`)
  const paren = source.indexOf('(', at)
  let pdepth = 0
  let close = paren
  for (; close < source.length; close++) {
    if (source[close] === '(') pdepth += 1
    else if (source[close] === ')') { pdepth -= 1; if (pdepth === 0) break }
  }
  const open = source.indexOf('{', close)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(open + 1, i)
    }
  }
  return assert.fail(`app.js's ${name}() has a balanced body`)
}

/** The markup of the element carrying `id`, from its `<` to its own `</div>`. */
function elementById(id) {
  const at = html.indexOf(`id="${id}"`)
  assert.ok(at >= 0, `index.html has #${id}`)
  const open = html.lastIndexOf('<', at)
  const close = html.indexOf('</div>', at)
  assert.ok(close > open, `index.html's #${id} is a closed element`)
  return html.slice(open, close)
}

/** The declaration block of a CSS selector, from its `{` to its `}`. */
function rule(selector) {
  const at = html.indexOf(`${selector} {`)
  assert.ok(at >= 0, `index.html has a rule for ${selector}`)
  const open = html.indexOf('{', at)
  const close = html.indexOf('}', open)
  return html.slice(open + 1, close)
}

// ===========================================================================
// W2 — the selection outline is built from fresh transforms
// ===========================================================================

describe('W2 — attachSelected refreshes before it measures', () => {
  test('the selected object’s own transforms are made current BEFORE the BoxHelper', () => {
    const body = functionBody('attachSelected')
    const worldMatrix = body.search(/selectedObj\.updateWorldMatrix\(\s*true\s*,\s*false\s*\)/)
    const matrixWorld = body.search(/selectedObj\.updateMatrixWorld\(\s*true\s*\)/)
    const boxHelper = body.search(/new THREE\.BoxHelper\(/)
    assert.ok(worldMatrix >= 0, 'the host chain above the object is made current')
    assert.ok(matrixWorld >= 0, 'and every descendant — bones and bindMatrixInverse included')
    assert.ok(boxHelper >= 0, 'and the outline is still built here')
    assert.ok(worldMatrix < boxHelper,
      'the ancestors come first: the outline must not be measured from stale matrices')
    assert.ok(matrixWorld < boxHelper,
      'and neither must the descendants (W1/W2 fail after a page reload without this)')
    assert.ok(worldMatrix < matrixWorld,
      'in that order: the host chain, then the object’s own subtree')
  })

  test('the outline is still added to the scene, and still disposed first', () => {
    const body = functionBody('attachSelected')
    assert.match(body, /threeScene\.add\(outline\)/)
    assert.match(body, /outline\.geometry\.dispose\(\)/)
  })
})

// ===========================================================================
// W3 — the clip controls always fit the panel
// ===========================================================================

describe('W3 — the clip controls fit the panel', () => {
  test('#ep-anim-actions exists and carries Loop, Play and Stop', () => {
    const actions = elementById('ep-anim-actions')
    assert.ok(actions.includes('id="ep-anim-loop-label"'), 'the Loop label')
    assert.ok(actions.includes('id="ep-anim-loop"'), 'the Loop box')
    assert.ok(actions.includes('id="ep-anim-play"'), 'Play')
    assert.ok(actions.includes('id="ep-anim-stop"'), 'Stop')
    assert.equal(html.includes('id="ep-anim-actions"'), true)
  })

  test('#ep-anim-row holds the label and the select, and no button', () => {
    const row = elementById('ep-anim-row')
    assert.ok(row.includes('id="ep-anim-clip"'), 'the clip select keeps the row')
    assert.ok(/>\s*Animation\s*</.test(row), 'with its label')
    assert.ok(!/<button/.test(row),
      'no control can widen the row: a 300-character clip id would push it past the panel')
  })

  test('the select takes the rest of its row and can shrink', () => {
    const select = rule('#edit-panel #ep-anim-row select')
    assert.match(select, /min-width:\s*0/,
      'min-width: 0 is what lets a flex item go below its content’s width')
    assert.match(select, /flex:\s*1\s+1\s+auto/)
    assert.match(select, /max-width:\s*100%/)
  })

  test('app.js reads the actions row', () => {
    assert.match(source, /const\s+epAnimActions\s*=\s*document\.getElementById\('ep-anim-actions'\)/)
  })

  test('renderAnimationRow shows and hides both rows together', () => {
    const body = functionBody('renderAnimationRow')
    assert.match(body, /epAnimActions[\s\S]{0,40}?\.style\.display\s*=\s*'none'/,
      'hidden with the row when there is no panel')
    assert.match(body, /epAnimActions[\s\S]{0,40}?\.style\.display\s*=\s*''/,
      'and shown with it when there is one')
    assert.match(body, /epAnimRow\.style\.display\s*=\s*'none'/)
    assert.match(body, /epAnimRow\.style\.display\s*=\s*''/)
  })

  test('renderAnimationRow puts the chosen id on the select’s title', () => {
    const body = functionBody('renderAnimationRow')
    assert.match(body, /epAnimClip\.title\s*=/,
      'the clipped select still shows the chosen id in full')
  })
})
