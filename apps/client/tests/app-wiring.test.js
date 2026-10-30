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

// ===========================================================================
// E7 — every new object gets an id, through ONE helper (scripting-4b-1)
// ===========================================================================

describe('E7 — the add paths pass through withNewObjectId', () => {
  const code = () => stripComments(source)

  /** The body of `anchor.addEventListener('<event>', … => { … })`, by brace counting. */
  function listenerBody(anchor, event) {
    const at = source.indexOf(`${anchor}.addEventListener('${event}'`)
    assert.ok(at >= 0, `app.js registers ${anchor}'s ${event} listener`)
    const open = source.indexOf('{', at)
    let depth = 0
    for (let i = open; i < source.length; i++) {
      if (source[i] === '{') depth++
      else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(open + 1, i) }
    }
    return assert.fail(`${anchor}'s listener body is balanced`)
  }

  test('app.js imports the one helper', () => {
    assert.match(source, /import \{ withNewObjectId \} from '\.\/object-identity\.js'/)
  })

  test('the palette add stamps the built primitive descriptor', () => {
    const body = flatten(listenerBody('epPalette', 'click'))
    assert.match(body, /withNewObjectId\(buildPrimitiveDescriptor\(/)
    assert.match(body, /client\.addNode\(descriptor\)/, 'the stamped descriptor is what is sent')
  })

  test('the Model form, the teleporter form and the library all stamp their addNode deps', () => {
    const deps = code().match(/addNode: \(descriptor\) => client\.addNode\(withNewObjectId\(descriptor\)\)/g) ?? []
    assert.equal(deps.length, 3, `expected the three form deps, found ${deps.length}`)
  })

  test('there are exactly four call sites: the palette and the three deps', () => {
    const calls = code().match(/withNewObjectId\(/g) ?? []
    assert.equal(calls.length, 4, `expected four call sites, found ${calls.length}`)
  })

  test('the palette RETRY does not stamp: it reuses the recorded descriptor', () => {
    const body = flatten(functionBody('retryAdd'))
    assert.doesNotMatch(body, /withNewObjectId/)
    assert.match(body, /\{ \.\.\.request\.descriptor, name \}/, 'the first attempt’s descriptor, id included')
    assert.match(body, /client\.addNode\(descriptor\)/, 'the sent descriptor is the recorded one')
  })

  test('the structural re-add (Undo and redo) does not stamp', () => {
    const at = code().indexOf('client.addNode(request.descriptor)')
    assert.ok(at >= 0, 'the undo engine’s own re-add calls client.addNode directly')
    const before = code().slice(Math.max(0, at - 120), at)
    assert.doesNotMatch(before, /withNewObjectId/, 'the re-add is not wrapped')
  })

  test('Duplicate is not stamped in app.js: edit-duplicate.js owns that', () => {
    const body = flatten(listenerBody('epDuplicate', 'click'))
    assert.doesNotMatch(body, /withNewObjectId/)
    assert.match(body, /client\.addNode\(check\.descriptor\)/)
  })

  test('the palette retry predicate is exactly /already in use/ (S-B)', () => {
    // The id refusal is "objectId is already taken in this world", which this
    // predicate never matches — so a palette add refused for its id is NOT
    // retried. packages/server's E3 test pins the message itself.
    assert.match(code(), /\/already in use\/\.test\(message \?\? ''\)/)
  })
})

// ===========================================================================
// E8 — the Edit panel's host line (scripting-4b-1)
// ===========================================================================

describe('AC6 — the click branch, and the ONE connect path', () => {
  const clickSource = () => readFileSync(resolve(__dirname, '../src/activate-click.js'), 'utf-8')

  /** The body of the Nth `viewportEl.addEventListener('click', …)`, by braces. */
  function viewportClickBody(nth = 0) {
    let at = -1
    for (let i = 0; i <= nth; i++) at = source.indexOf("viewportEl.addEventListener('click'", at + 1)
    assert.ok(at >= 0, `app.js registers click listener #${nth}`)
    const open = source.indexOf('{', at)
    let depth = 0
    for (let i = open; i < source.length; i++) {
      if (source[i] === '{') depth++
      else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(open + 1, i) }
    }
    return assert.fail('the click listener’s body is balanced')
  }

  /** The behaviour branch: everything before the Edit-mode half of that listener. */
  const behaviorBranch = () => {
    const body = stripComments(viewportClickBody(0))
    const editAt = body.indexOf('if (e.target !== canvas) return', body.indexOf('if (!modes.edit)'))
    assert.ok(editAt > 0, 'the listener has its Edit-mode half after the behaviour half')
    return flatten(body.slice(0, editAt))
  }
  const editBranch = () => {
    const body = stripComments(viewportClickBody(0))
    const editAt = body.indexOf('if (e.target !== canvas) return', body.indexOf('if (!modes.edit)'))
    return flatten(body.slice(editAt))
  }

  test('the branch accepts a LOCKED click on the viewport, and aims from the centre', () => {
    const branch = behaviorBranch()
    assert.match(branch, /const locked = document\.pointerLockElement === viewportEl/,
      'the branch asks whether the viewport holds the lock')
    assert.match(branch, /if \(locked\) \{ if \(e\.target !== viewportEl\) return \} else if \(e\.target !== canvas\) \{ return \}/,
      'locked: the viewport target is accepted (today every locked click returned early); unlocked: only the canvas')
    assert.match(branch, /pickBehaviorTarget\(e, \{ locked \}\)/, 'and the aim is told whether it is locked')
  })

  test('the branch resolves the target through the ONE rule, and does nothing for scenery', () => {
    const branch = behaviorBranch()
    assert.match(branch, /const target = activateClickTarget\(hit\)/)
    assert.match(branch, /if \(!target\) return/, 'an ordinary click on scenery does nothing at all')
    assert.match(flatten(clickSource()), /export function activateClickTarget\(hitNode\) \{ return selectTargetFor\(hitNode\) \}/,
      'and that one rule IS selectTargetFor (AC2)')
  })
  test('the host runs it here; every other tab sends activate()', () => {
    const branch = behaviorBranch()
    const targetAt = branch.indexOf('const target = activateClickTarget(hit)')
    const callAt = branch.indexOf('performActivateClick({')
    assert.ok(targetAt > 0, 'the branch resolves the target through the ONE rule')
    assert.ok(callAt > targetAt, 'and hands it to performActivateClick (the tested decision)')
    assert.match(branch.slice(callAt), /isHost: client\.scriptHost\?\.active === true/,
      'the tab kind is read from the real client state, in ONE place')
    assert.match(branch.slice(callAt), /runner,/, 'the real runner is handed in')
    assert.match(branch.slice(callAt), /client,/, 'and the real client')
    assert.match(branch.slice(callAt), /notice: activateNotice/, 'and the notice element')
    const clickSource = flatten(readFileSync(resolve(__dirname, '../src/activate-click.js'), 'utf-8'))
    assert.match(clickSource, /if \(isHost\) \{ const outcome = runner\?\.select\(hit\)/,
      'performActivateClick runs the behaviour in the host’s tab')
    assert.match(clickSource, /if \(outcome === 'too-far' \|\| outcome === 'no-avatar'\) \{ notice\?\.show\(activateNoticeText\(\{ by: 'page', reason: outcome \}\)\) \}/,
      'and shows the page’s own notice for the two outcomes it can see')
    assert.match(clickSource, /const text = activateClickNotice\(\{ avatarNode, avatarPosition, targetPosition \}\) if \(text\) \{ notice\?\.show\(text\) return \{ action: 'notice', notice: text \} \}/,
      'a pre-check refusal shows the notice and sends NOTHING')
    assert.match(clickSource, /client\?\.activate\(resolved\.name\)/,
      'and only then does a non-host tab call activate()')
  })

  test('the EDIT-mode half is unchanged: a click selects, and never activates', () => {
    const branch = editBranch()
    assert.match(branch, /pickEditTarget\(e\)/)
    assert.match(branch, /selectForEdit\(node\)/)
    assert.match(branch, /if \(refused\) showEditError\(refused\)/)
    assert.doesNotMatch(branch, /activate/,
      'Edit mode still means selection: no activate, no notice, no lock handling')
    assert.doesNotMatch(branch, /behaviorAim|pickBehaviorTarget/)
  })

  test('pickBehaviorTarget aims through behaviorAim', () => {
    const body = flatten(functionBody('pickBehaviorTarget'))
    assert.match(body, /behaviorAim\(\{ locked, clientX: e\.clientX, clientY: e\.clientY, rect \}\)/)
    assert.doesNotMatch(body, /clientX - rect\.left/,
      'the NDC arithmetic lives in ONE place, the pure function')
    assert.match(clickSource(), /if \(locked\) return \{ x: 0, y: 0 \}/,
      'and locked aims at the screen centre, where #crosshair is')
  })

  test('#activate-notice is in the page, hidden, and has ONE owner', () => {
    assert.match(html, /id="activate-notice"/)
    assert.match(html, /id="activate-notice"[^>]*display:none/, 'it starts hidden')
    assert.match(flatten(source), /createActivateNotice\(\{ element: activateNoticeEl \}\)/)
    const writers = source.match(/activateNoticeEl\.(textContent|style)\s*=/g) ?? []
    assert.equal(writers.length, 0, 'app.js never writes it directly: createActivateNotice owns it')
  })

  test('the server’s refusal reaches the notice, and console-only codes do not', () => {
    const handler = handlers('activate:refused')[0]
    assert.ok(handler, 'app.js listens for activate:refused')
    assert.match(flatten(handler), /activateNoticeText\(\{ by: 'server', code \}\)/)
    assert.match(flatten(handler), /if \(text\) activateNotice\.show\(text\)/)
    assert.match(clickSource(), /RATE_LIMITED|NODE_NOT_FOUND|INVALID_FIELD|ACTIVATE_SERVER_NOTICE/,
      'and activate-click.js is where the code-to-text table lives')
  })

  test('connectNow passes scriptRunner: sameOriginAsAccount(…), and NOTHING else does', () => {
    const body = flatten(functionBody('connectNow'))
    assert.match(body, /const sid = client\.connect\(wsUrl, \{ \.\.\.connectOpts, scriptRunner: sameOriginAsAccount\(wsUrl, accountWsBase\), \}\)/)
    const code = stripComments(source)
    const mentions = code.match(/scriptRunner/g) ?? []
    assert.equal(mentions.length, 1, `exactly one scriptRunner in app.js's code, found ${mentions.length}`)
    const connects = code.match(/client\.connect\(/g) ?? []
    assert.equal(connects.length, 1, `exactly one client.connect() call site, found ${connects.length}`)
  })

  test('the Behaviour section’s other-tab line is 4c’s', () => {
    const form = readFileSync(resolve(__dirname, '../src/behavior-form.js'), 'utf-8')
    assert.match(form, /otherTab: 'Behaviours run in another tab; clicks here are sent to it'/)
  })
})

// ===========================================================================
// E8 — the Edit panel's host line (scripting-4b-1)
// ===========================================================================

describe('E8 — refreshHostStatus() and the host line', () => {
  test('the line exists in the page and has ONE writer', () => {
    assert.match(html, /id="ep-host-status"/)
    const writes = source.match(/epHostStatus\.textContent\s*=/g) ?? []
    assert.equal(writes.length, 1, `expected one writer of #ep-host-status, found ${writes.length}`)
  })

  test('refreshHostStatus() reads the three facts through the pure helper', () => {
    const body = flatten(functionBody('refreshHostStatus'))
    assert.match(body, /hostStatusText\(\{/)
    assert.match(body, /connected:\s*client\.connected === true/)
    assert.match(body, /canEdit:\s*client\.canEdit === true/)
    assert.match(body, /scriptHost:\s*client\.scriptHost/)
  })

  for (const [site, find] of [
    ['script-host:changed', () => handlers('script-host:changed').find((body) => body.includes('refreshHostStatus()'))],
    ['connecting',          () => handlers('connecting').find((body) => body.includes('refreshHostStatus()'))],
    ['disconnected',        () => handlers('disconnected').find((body) => body.includes('refreshHostStatus()'))],
  ]) {
    test(`${site} refreshes the line`, () => {
      const body = find()
      assert.ok(body, `${site}: the site was found`)
      assert.match(flatten(body), /refreshHostStatus\(\)/)
    })
  }

  test('Edit mode turning on refreshes the line', () => {
    const body = flatten(functionBody('setEditMode'))
    assert.match(body, /if \(on\) \{ if \(!canEditNow\(\) \|\| modes\.edit\) return refreshHostStatus\(\)/,
      'refreshed in the `on` branch, before the panel is shown')
  })
})

