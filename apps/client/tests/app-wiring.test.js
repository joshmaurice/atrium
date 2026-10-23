// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// app-wiring.test.js — edit-polish-3: the wiring that only exists in the page.
//
// The form logic and the pure helpers have their own tests (teleporter-form,
// model-form, sky-picker, teleport-trigger, load-background). What is left is the
// app.js wiring no fake element can reach, so — as library-grid.test.js and
// edit-key-wiring.test.js do — this file reads app.js as TEXT and pins:
//
//   Z1  one HUD writer, called on load and on a document rename;
//   Z2  Edit off closes the gate and discards the Model form's draft, and the two
//       form branches never fall through to `selectAdded`;
//   Z3  the destination branch hands the answer to the form and returns;
//   Z7  the spawn note is refreshed from every site the contract lists.
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

/** The body of `function name(…) { … }`, by brace counting. */
function functionBody(name) {
  const at = source.search(new RegExp(`function ${name}\\s*\\(`))
  assert.ok(at >= 0, `app.js has a function ${name}() — the guard cannot check what is not there`)
  // Skip the parameter list first: a destructured parameter is a `{ … }` of its
  // own (V1's `fillTeleporterWorlds(options, { loading, … })`), so the body's `{`
  // is the first one AFTER the parameters close, not the first one after the name.
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

/** Every `client.on('<event>', …)` handler's body, in source order. */
function handlers(event) {
  const needle = `client.on('${event}'`
  const bodies = []
  let at = source.indexOf(needle)
  while (at !== -1) {
    const arrow = source.indexOf('=>', at)
    assert.ok(arrow > at, `app.js's ${needle} handler is an arrow function`)
    const open = source.indexOf('{', arrow)
    let depth = 0
    for (let i = open; i < source.length; i++) {
      if (source[i] === '{') depth++
      else if (source[i] === '}') {
        depth--
        if (depth === 0) { bodies.push(source.slice(open + 1, i)); break }
      }
    }
    at = source.indexOf(needle, at + 1)
  }
  assert.ok(bodies.length > 0, `app.js registers a ${event} handler`)
  return bodies
}

/** Whitespace-collapsed text, so formatting differences do not matter. */
const flatten = (text) => text.replace(/\s+/g, ' ')

/** Comments removed, so a comment that names a symbol is not mistaken for code. */
const stripComments = (text) => text.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

// ===========================================================================
// Z1 — the HUD's world name (S2)
// ===========================================================================

describe('Z1 — the HUD world line has ONE writer, and a rename reaches it', () => {
  test('hudWorldEl.textContent is written in exactly one place, and it is showWorldName', () => {
    const writers = source.match(/hudWorldEl\.textContent\s*=/g) ?? []
    assert.equal(writers.length, 1, `expected exactly one writer of hudWorldEl.textContent, found ${writers.length}`)
    assert.match(functionBody('showWorldName'), /hudWorldEl\.textContent\s*=/, 'the writer is showWorldName()')
  })

  test('showWorldName keeps today’s text rule', () => {
    const body = flatten(functionBody('showWorldName'))
    assert.match(body, /hudWorldEl\.textContent = name \? `World: \$\{name\}` : ''/,
      'the HUD text is unchanged: `World: <name>`, or nothing')
  })

  test('the world:loaded handler calls it with the event’s name', () => {
    const loaded = handlers('world:loaded').find((body) => body.includes('showWorldName('))
    assert.ok(loaded, 'the world:loaded handler writes the line through showWorldName(name)')
    assert.match(flatten(loaded), /showWorldName\(name\)/)
  })

  test('the som:set __document__ branch calls it BEFORE its return', () => {
    const handler = stripComments(handlers('som:set').find((body) => body.includes("nodeName === '__document__'")))
    assert.ok(handler, "the som:set handler has the __document__ branch")
    const branch = handler.indexOf("if (nodeName === '__document__')")
    const call = handler.indexOf('showWorldName(', branch)
    const ret = handler.indexOf('return', branch)
    assert.ok(call > branch, 'the branch calls showWorldName()')
    assert.ok(ret > call, 'and the call comes before the branch returns (a rename updates the HUD without a reconnect)')
  })

  test('a rename is not logged (only a load is)', () => {
    const handler = stripComments(handlers('som:set').find((body) => body.includes("nodeName === '__document__'")))
    const branch = handler.slice(handler.indexOf("if (nodeName === '__document__')"), handler.indexOf('return'))
    assert.ok(!/console\.log/.test(branch), 'the document branch writes no console line')
  })
})

// ===========================================================================
// Z2 — Edit off closes the panel's forms (S1), and a not-owned add selects nothing
// ===========================================================================

describe('Z2 — Edit off closes whichever form holds the gate, and discards the draft', () => {
  test('the off branch calls modelGate.closeCurrent() THEN modelForm.reset()', () => {
    const body = stripComments(functionBody('setEditMode'))
    const off = body.indexOf('} else {')
    assert.ok(off > 0, 'setEditMode has its off branch')
    const closeCurrent = body.indexOf('modelGate.closeCurrent()', off)
    const reset = body.indexOf('modelForm?.reset()', off)
    assert.ok(closeCurrent > off, 'the off branch closes the gate')
    assert.ok(reset > closeCurrent, 'and resets the Model form AFTER it')
    assert.ok(!/closeTeleporterForm/.test(body),
      'the direct closeTeleporterForm() call is REPLACED by the gate, not kept beside it')
    assert.ok(!/modelForm\.close\(\)|libraryGrid\.close\(\)/.test(body.slice(off, reset)),
      'and no separate form/grid closes were added: the gate already knows which one is open')
  })

  test('the gate closes before the panel is hidden', () => {
    const body = flatten(functionBody('setEditMode'))
    assert.ok(body.indexOf('modelGate.closeCurrent()') < body.indexOf("editPanel.style.display = 'none'"),
      'the forms go before the panel hides')
  })

  test('the gate has all three closers, and closeCurrent() empties it', () => {
    for (const name of ['teleporter', 'model', 'library']) {
      assert.ok(source.includes(`modelGate.register('${name}'`), `the ${name} form registers its closer`)
    }
    // closeCurrent() itself lives in model-form.js, with the Model form's tests.
    const modelFormSource = readFileSync(resolve(__dirname, '../src/model-form.js'), 'utf-8')
    const closeCurrent = stripComments(modelFormSource.slice(modelFormSource.indexOf('closeCurrent()')))
    assert.match(closeCurrent, /current = null/, 'closeCurrent() empties the gate')
  })

  test('the teleporter and model branches return without selectAdded for a not-owned answer', () => {
    const answer = stripComments(functionBody('onStructureAnswer'))
    const tele = answer.indexOf('if (request.teleporter)')
    const model = answer.indexOf('if (request.model)')
    const generic = answer.indexOf("if (removedMessage === 'show')", model)
    assert.ok(tele > 0 && model > tele && generic > model, 'the two branches come before the generic ones')

    const teleBranch = answer.slice(tele, model)
    const modelBranch = answer.slice(model, generic)
    for (const [name, branch] of [['teleporter', teleBranch], ['model', modelBranch]]) {
      assert.match(branch, /return/, `the ${name} branch returns`)
      assert.ok(!/selectAdded\(/.test(branch),
        `the ${name} branch never selects through selectAdded — an accepted add the form no longer owns selects NOTHING (Z2)`)
      // The not-owned rule itself must RETURN: without it, an unmatched answer
      // falls through to the generic branches below (proof (b4)).
      const orphan = branch.lastIndexOf('orphanAddError(')
      assert.ok(orphan >= 0, `the ${name} branch routes a not-owned answer through orphanAddError()`)
      assert.match(branch.slice(orphan), /\breturn\b/,
        `the ${name} branch RETURNS after the not-owned rule, so a not-owned accepted add cannot fall through to selectAdded`)
    }
    // The generic branch keeps the palette's and Duplicate's selection (J6).
    assert.match(flatten(answer.slice(generic)), /selectAdded\(request\.name\)/)
  })

  test('V5: the owned Model answer shows no generic edit error', () => {
    const answer = stripComments(functionBody('onStructureAnswer'))
    const model = answer.indexOf('if (request.model)')
    const generic = answer.indexOf("if (removedMessage === 'show')", model)
    const branch = answer.slice(model, generic)
    const owned = branch.indexOf('if (modelForm?.onAnswer(')
    assert.ok(owned >= 0, 'the Model branch has its owned path')
    const refresh = branch.indexOf('refreshEditActions()', owned)
    assert.ok(refresh > owned, 'the owned path refreshes the panel')
    assert.ok(!/showEditError\(/.test(branch.slice(owned, refresh)),
      'an owned answer shows no generic edit error: its form handles it completely (V5/Z2)')
    // ...and an answer the form does NOT own keeps the generic error (Z2).
    assert.match(branch.slice(refresh), /orphanAddError\(/,
      'the not-owned path still reports the generic error')
  })

  test('both branches use the one not-owned error rule, which reports nothing for an acceptance', () => {
    const answer = stripComments(functionBody('onStructureAnswer'))
    assert.match(answer, /orphanAddError\(status, message\)/)
    assert.match(flatten(functionBody('orphanAddError')), /if \(status === 'accepted'\) return null/)
  })
})

// ===========================================================================
// Z3 — the destination form's branch, and its listeners
// ===========================================================================

describe('Z3 — app.js is wiring only for the destination form', () => {
  test('the branch hands the answer to the form and returns', () => {
    const answer = stripComments(functionBody('onStructureAnswer'))
    const tele = answer.indexOf('if (request.teleporter)')
    const branch = answer.slice(tele, answer.indexOf('if (request.model)', tele))
    assert.match(branch, /teleporterForm\?\.onAnswer\(seq, status, message\)/)
    assert.match(branch, /refreshEditActions\(\)/)
  })

  test('the four listeners, the wait and the fields are the module’s, not app.js’s', () => {
    for (const gone of ['formWaitSeq', 'pendingPosition', 'closeTeleporterForm', 'openTeleporterForm']) {
      assert.ok(!new RegExp(`\\b${gone}\\b`).test(source.replace(/\/\/[^\n]*/g, '')),
        `${gone} is gone from app.js's code (it lives in teleporter-form.js now)`)
    }
    for (const element of ['tpWorldSelect', 'tpDestInput', 'tpSaveBtn', 'tpFormCancel']) {
      const listeners = source.match(new RegExp(`${element}\\?\\.addEventListener`, 'g')) ?? []
      assert.equal(listeners.length, 0, `app.js adds no listener to ${element}: the form's wire() owns all four`)
    }
  })

  test('app.js keeps the two DOM adapters, the placement and the gate registration', () => {
    assert.match(source, /function listTeleporterWorlds\(\)/, 'the world-list adapter is here')
    assert.match(source, /function fillTeleporterWorlds\(/, 'the select adapter is here')
    assert.match(source, /modelGate\.register\('teleporter', \(\) => teleporterForm\.close\(\)\)/)
    const click = source.slice(source.indexOf("epTeleporter.addEventListener('click'"))
    assert.match(click, /palettePlacement\(origin, forward\.toArray\(\)\)/, 'the palette placement is still read here')
    assert.match(click, /teleporterForm\?\.open\(\[position\[0\], 0, position\[2\]\]\)/, 'and handed to the form')
  })

  test('V1: the select adapter re-selects the value the form passes it', () => {
    const body = stripComments(functionBody('fillTeleporterWorlds'))
    assert.match(body, /selected/, 'the adapter reads a `selected` value')
    assert.match(body, /tpWorldSelect\.value\s*=\s*selected/, 'and assigns it back after the fill')
    // The form is the one that reads the value on screen and passes it on.
    const formSource = readFileSync(resolve(__dirname, '../src/teleporter-form.js'), 'utf-8')
    assert.match(formSource, /fillWorlds\?\.\([^)]*selected/,
      'the form hands the adapter the value the select showed (V1)')
  })

  test('Escape and the world boundaries close it through the module', () => {
    assert.match(source, /if \(teleporterForm\?\.waitSeq != null\) return/, 'Escape is ignored while saving')
    assert.match(source, /if \(teleporterForm\?\.isOpen\(\)\) \{/, 'Escape closes it')
    const resets = source.match(/teleporterForm\?\.reset\(\)/g) ?? []
    assert.ok(resets.length >= 2, `expected the connecting and disconnected resets, found ${resets.length}`)
  })

  test('#ep-spawn-note exists, hidden, inside the selection fields', () => {
    assert.match(html, /id="ep-spawn-note"/, 'the element is in the page (the DEV acceptance marker)')
    assert.match(html, /id="ep-spawn-note"[^>]*display:none/, 'and it starts hidden')
  })
})

// ===========================================================================
// Z7 — the spawn note is refreshed from every site the contract lists
// ===========================================================================

describe('Z7 — refreshSpawnNote() is called from every listed site', () => {
  const sites = [
    ['the selection change', () => functionBody('selectForEdit')],
    ['a handle change (live during a drag)', () => functionBody('onHandleChange')],
    ['a numeric transform commit', () => functionBody('commitVectorField')],
    ['the som:set handler for the selection and its descendants', () => {
      const handler = handlers('som:set').find((body) => body.includes('isUnder(node, selected)'))
      assert.ok(handler, 'the som:set handler guards on the selection or a node under it')
      return handler
    }],
    ['som:add under the selection', () => handlers('som:add').find((body) => body.includes('refreshSpawnNote()'))],
    ['som:remove under the selection', () => handlers('som:remove').find((body) => body.includes('refreshSpawnNote()'))],
  ]

  for (const [name, find] of sites) {
    test(`${name} refreshes it`, () => {
      const body = find()
      assert.ok(body, `${name}: the site was found`)
      assert.match(body, /refreshSpawnNote\(\)/)
    })
  }

  test('an undo or a redo of a transform refreshes it', () => {
    const handler = handlers('edit:accepted').find((body) => body.includes('undo.onAccepted(seq)'))
    assert.ok(handler, 'the edit:accepted handler routes the undo engine’s answers')
    assert.match(handler, /refreshSpawnNote\(\)/)
  })

  test('the note is written in ONE function, from the pad’s own world position', () => {
    const body = flatten(functionBody('refreshSpawnNote'))
    assert.match(body, /padNearSpawn\(selected, worldPosition\)/, 'the pad’s own world position decides (Z7/review 3)')
    assert.match(body, /epSpawnNote\.textContent = near \? SPAWN_NOTE : ''/)
    assert.match(body, /epSpawnNote\.style\.display = near \? '' : 'none'/)
    const writes = source.match(/epSpawnNote\.style\.display\s*=/g) ?? []
    assert.equal(writes.length, 1, `expected one writer of the note's visibility, found ${writes.length}`)
  })

  test('the note’s text is the contract’s wording', () => {
    assert.match(source, /Near the spawn point: arriving visitors may land on this pad \(it won\\?'t fire until they step off\)/)
  })
})
