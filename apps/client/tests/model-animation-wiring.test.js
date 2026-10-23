// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// model-animation-wiring.test.js — scripting-4a step 5 (Z6–Z7's wiring half).
//
// The panel's logic and the animation layer have their own tests. What is left
// is the wiring only the page has, so — as app-wiring.test.js and
// model-bridge-wiring.test.js do — this reads the files as TEXT and pins:
//
//   Z6  the frame-loop call, the `set`/`rename`/`clear` call sites, and the
//       bridge's three lifecycle callbacks;
//   Z7  the row's elements, the two separate buttons, and the import map.
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
const panel = readFileSync(resolve(__dirname, '../src/model-animation-panel.js'), 'utf-8')
const clientPkg = JSON.parse(readFileSync(resolve(__dirname, '../../../packages/client/package.json'), 'utf-8'))

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

/** The argument text of every `client.on('<event>', …)` call, in source order. */
function handlerArgs(event) {
  const needle = `client.on('${event}'`
  const out = []
  let at = source.indexOf(needle)
  while (at >= 0) {
    const open = at + 'client.on'.length
    let depth = 0
    let i = open
    for (; i < source.length; i++) {
      if (source[i] === '(') depth++
      else if (source[i] === ')') { depth--; if (depth === 0) break }
    }
    out.push(source.slice(open + 1, i))
    at = source.indexOf(needle, i)
  }
  assert.ok(out.length > 0, `app.js has a client.on('${event}') handler`)
  return out
}

/**
 * Every `client.on('<event>', …)` handler's BODY, in source order. A handler is
 * written either as `(…) => { … }` or as `(…) => expression`, and the arrow's
 * parameters may destructure an object — so the body starts at the first `{`
 * AFTER the `=>`, never at the first `{` in the call.
 */
function handlers(event) {
  return handlerArgs(event).map((args) => {
    const arrow = args.indexOf('=>')
    const brace = args.indexOf('{', arrow < 0 ? 0 : arrow)
    if (arrow < 0 || brace < 0) return args
    let depth = 0
    let i = brace
    for (; i < args.length; i++) {
      if (args[i] === '{') depth++
      else if (args[i] === '}') { depth--; if (depth === 0) break }
    }
    return args.slice(brace + 1, i)
  })
}

const anyHandler = (event, pattern) =>
  handlers(event).some((body) => pattern.test(body))

// ===========================================================================
// Z6 — the wiring
// ===========================================================================

describe('Z6 — the frame loop', () => {
  test('modelAnimations.update() runs immediately before stage.tick(dt)', () => {
    const body = functionBody('tick')
    const updateAt = body.search(/modelAnimations\??\.update\(\)/)
    const tickAt = body.search(/stage\.tick\(/)
    assert.ok(updateAt >= 0, 'the frame loop advances the model animations')
    assert.ok(tickAt >= 0, 'and still ticks the stage')
    assert.ok(updateAt < tickAt, 'the update goes FIRST: the frame drawn is the world’s frame')
    assert.equal(body.slice(updateAt, tickAt).includes('modelAnimations'), true)
  })
})

describe('Z6 — the call sites that hand the state over', () => {
  test('world:loaded syncs every model node', () => {
    assert.ok(anyHandler('world:loaded', /syncModelAnimations\(\)/),
      'the world load hands the saved state over')
    const body = functionBody('syncModelAnimations')
    assert.match(body, /modelAnimations\.set\(/, 'and it goes through the layer’s set()')
    assert.match(body, /extras\?\.atrium\?\.model/, 'only model nodes')
  })

  test('som:set with the animation leaf sets it', () => {
    assert.ok(anyHandler('som:set', /path === MODEL_ANIMATION_FIELD/),
      'the animation leaf is recognised in the som:set handler')
    assert.ok(anyHandler('som:set', /modelAnimations\??\.set\(nodeName,/),
      'and the layer takes the value the SOM now holds')
  })

  test('som:add sets the new model node’s value', () => {
    assert.ok(anyHandler('som:add', /modelAnimations\??\.set\(nodeName,/))
  })

  test('som:remove drops it', () => {
    assert.ok(anyHandler('som:remove', /modelAnimations\??\.set\([A-Za-z]+, null\)/),
      'a removed node’s wanted value goes with it')
  })

  test('som:rename moves the entry', () => {
    assert.ok(anyHandler('som:rename', /modelAnimations\??\.rename\(from, to\)/))
  })

  test('every world reset clears the layer, beside modelBridge.resetWorld()', () => {
    // Code only: a comment may name the call without making it.
    const codeLines = source.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    const resets = codeLines.filter((line) => line.includes('modelBridge.resetWorld()')).length
    const clears = codeLines.filter((line) => /modelAnimations\??\.clear\(\)/.test(line)).length
    assert.ok(resets >= 3, 'the bridge is reset from connecting, disconnected and beginNewWorld')
    assert.equal(clears, resets, 'and the animation layer is cleared at every one of them')
    for (const body of [handlers('connecting')[0], handlers('disconnected')[0], functionBody('beginNewWorld')]) {
      assert.match(body, /modelBridge\.resetWorld\(\)/)
      assert.match(body, /modelAnimations\??\.clear\(\)/)
    }
  })

  test('every Sky-picker reset resets the clip controls beside it (L7)', () => {
    const codeLines = source.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    const skyResets = codeLines.filter((line) => /skyPicker\??\.reset\(\)/.test(line)).length
    const animResets = codeLines.filter((line) => /animationControls\??\.reset\(\)/.test(line)).length
    assert.ok(skyResets >= 3)
    assert.equal(animResets, skyResets, 'the wait and the remembered choice go with the world')
    for (const body of [handlers('connecting')[0], handlers('disconnected')[0], functionBody('beginNewWorld')]) {
      assert.match(body, /animationControls\??\.reset\(\)/)
    }
  })

  test('the bridge is given the three lifecycle callbacks', () => {
    for (const name of ['onInstanceCreated', 'onInstanceRehosted', 'onInstanceDisposing']) {
      assert.match(source, new RegExp(`${name}\\s*:\\s*\\(event\\)\\s*=>\\s*modelAnimations\\??\\.${name}\\(event\\)`),
        `${name} is wired to the layer`)
    }
  })

  test('the layer is built with the bridge and the SERVER’s clock', () => {
    assert.match(source, /createModelAnimations\(\{[\s\S]{0,120}?bridge: modelBridge/)
    assert.match(source, /now:\s*\(\)\s*=>\s*client\.serverNow\(\)/, 'not Date.now(): the server’s clock (Z3)')
    assert.match(source, /import\s*\{[^}]*\bcreateModelAnimations\b[^}]*\}\s*from\s*'@atrium\/renderer-three'/)
  })
})

// ===========================================================================
// Z7 — the panel wiring
// ===========================================================================

describe('Z7 — the panel wiring', () => {
  test('the row and its controls exist in index.html', () => {
    for (const id of ['ep-anim-row', 'ep-anim-clip', 'ep-anim-loop', 'ep-anim-play', 'ep-anim-stop', 'ep-anim-status']) {
      assert.ok(html.includes(`id="${id}"`), `index.html has #${id}`)
    }
  })

  test('Play and Stop are two separate buttons', () => {
    assert.match(html, /<button[^>]*id="ep-anim-play"[^>]*>/, 'a Play button')
    assert.match(html, /<button[^>]*id="ep-anim-stop"[^>]*>/, 'and a Stop button of its own')
    assert.match(html, /<select[^>]*id="ep-anim-clip"/, 'a clip select')
    assert.match(html, /<input[^>]*type="checkbox"[^>]*id="ep-anim-loop"/, 'and a Loop checkbox')
  })

  test('the row is re-rendered from refreshModelRow, the row’s one place', () => {
    assert.match(functionBody('refreshModelRow'), /animationControls\??\.refresh\(\)/)
  })

  test('every control’s DOM event goes into the controls', () => {
    assert.ok(source.includes("epAnimClip?.addEventListener('change'"), 'the select')
    assert.ok(source.includes("epAnimLoop?.addEventListener('change'"), 'the Loop box')
    assert.ok(source.includes("epAnimPlay?.addEventListener('click'"), 'Play')
    assert.ok(source.includes("epAnimStop?.addEventListener('click'"), 'Stop')
  })

  test('the three answers reach the controls, so their wait belongs to them (L7)', () => {
    assert.ok(anyHandler('edit:accepted', /animationControls\??\.onAccepted\(seq\)/))
    assert.ok(anyHandler('edit:rejected', /animationControls\??\.onRejected\(seq,/))
    assert.ok(anyHandler('edit:unknown', /animationControls\??\.onUnknown\(seq\)/))
  })

  test('a rejection goes to the edit error line', () => {
    assert.match(source, /showError:\s*\(text\)\s*=>\s*showEditError\(text\)/)
    assert.match(panel, /deps\.showError\?\.\(message/)
  })

  test('the controls write through client.setModelAnimation', () => {
    assert.match(source, /write:\s*\(name, value\)\s*=>\s*client\.setModelAnimation\(name, value\)/)
  })

  test('the row’s text is written with textContent, never as markup', () => {
    const body = functionBody('renderAnimationRow')
    assert.match(body, /epAnimStatus\.textContent\s*=/)
    assert.match(body, /option\.textContent\s*=\s*id/, 'a clip id is text, not HTML')
    assert.ok(!/innerHTML/.test(body), 'nothing in the row is written as markup')
  })
})

// ===========================================================================
// The import map and the package export (the round-1 failure of 3a)
// ===========================================================================

describe('the import map and the package export', () => {
  test('packages/client exports ./animation-spec', () => {
    assert.equal(clientPkg.exports['./animation-spec'], './src/animation-spec.js')
  })

  test('apps/client’s import map has the entry', () => {
    assert.ok(html.includes('"@atrium/client/animation-spec"'),
      'the page that imports app.js needs it — round 1 of 3a failed on exactly this')
  })

  test('the panel module imports nothing from three.js or the DOM', () => {
    assert.ok(!/from\s*'three'/.test(panel), 'no three.js')
    assert.ok(!/from\s*'@atrium\/renderer-three'/.test(panel), 'and nothing that reaches it')
    assert.ok(!/\bdocument\./.test(panel), 'and no DOM')
  })
})
