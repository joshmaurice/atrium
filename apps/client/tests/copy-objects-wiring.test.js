// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// copy-objects-wiring.test.js — copy-objects K4, K6 and K9: the wiring that
// only exists in the page (devtasks/PREBRIEF-copy-objects.md §5, "app.js's
// paste branch" and "Inspect").
//
// As app-wiring.test.js does, this file reads app.js and index.html as TEXT.
// Where a piece is a small function of its inputs (the Inspect gate, the
// paste answer's text) it is lifted out of app.js and RUN with stand-ins, so
// the test checks behaviour, not spelling. It tolerates whitespace and
// formatting, not a rewrite: a deliberate rewrite updates this test with it.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createEditModes } from '../src/edit-modes.js'
import { VISITOR_NOTE, VISIBILITY_NOTE, MODEL_HOST_NOTE } from '../src/copy-paste.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(__dirname, '../src/app.js'), 'utf-8')
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf-8')

/** `function name(…) { … }` in full, by brace counting. */
function functionText(name) {
  const at = source.search(new RegExp(`function ${name}\\s*\\(`))
  assert.ok(at >= 0, `app.js has a function ${name}()`)
  const paren = source.indexOf('(', at)
  let p = 0, close = paren
  for (; close < source.length; close++) {
    if (source[close] === '(') p += 1
    else if (source[close] === ')') { p -= 1; if (p === 0) break }
  }
  const open = source.indexOf('{', close)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(at, i + 1) }
  }
  return assert.fail(`${name}() has a balanced body`)
}
const body = (name) => { const t = functionText(name); return t.slice(t.indexOf('{', t.indexOf(')')) + 1, -1) }
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const flatten = (s) => stripComments(s).replace(/\s+/g, ' ')

/** The listener body registered with `<target>.addEventListener('click', …)` / `?.addEventListener`. */
function clickHandler(target) {
  const needle = new RegExp(`${target}\\??\\.addEventListener\\('click', (async )?\\(\\w*\\) => \\{`)
  const m = needle.exec(source)
  assert.ok(m, `app.js listens for ${target} clicks`)
  const open = m.index + m[0].length - 1
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(open + 1, i) }
  }
  return assert.fail('balanced')
}

// ---------------------------------------------------------------------------
// edit-modes.js — Inspect, exclusive with Edit
// ---------------------------------------------------------------------------

describe('K4 — edit-modes: Inspect', () => {
  const setup = (o = {}) => {
    const calls = []
    const modes = createEditModes({ setTriggerActive: (a) => calls.push(a), ...o })
    return { modes, active: () => calls.at(-1) }
  }

  test('exclusive with Edit, both ways', () => {
    const { modes } = setup()
    modes.setEdit(true); modes.setInspect(true)
    assert.equal(modes.inspect, true); assert.equal(modes.edit, false)
    modes.setEdit(true)
    assert.equal(modes.edit, true); assert.equal(modes.inspect, false)
  })

  test('triggers stay as outside Edit mode: walking onto a pad still teleports', () => {
    const { modes, active } = setup()
    modes.setInspect(true)
    assert.equal(active(), true)
    assert.equal(modes.triggerActive, true)
  })

  test('pointer lock is off while Inspect is on, and M is ignored; leaving restores it', () => {
    const { modes } = setup({ pointerLock: true })
    assert.equal(modes.usePointerLock, true)
    modes.setInspect(true)
    assert.equal(modes.usePointerLock, false)
    assert.equal(modes.togglePointerLock(), false, 'M ignored')
    modes.setInspect(false)
    assert.equal(modes.usePointerLock, true, 'the preference is kept')
  })

  test('reset leaves Inspect', () => {
    const { modes } = setup()
    modes.setInspect(true)
    modes.reset()
    assert.equal(modes.inspect, false)
  })
})

// ---------------------------------------------------------------------------
// The Inspect gate, run with stand-ins
// ---------------------------------------------------------------------------

function gateHarness(state) {
  const calls = []
  const fn = new Function('state', 'calls', `
    const client = state.client
    const modes = state.modes
    const inspectToggleBtn = state.btn
    let avatarReady = state.avatarReady
    function setInspectMode(on) { calls.push(on); if (!on) modes.setInspect(false) }
    ${functionText('canEditNow').replace('avatarReady', 'state.avatarReady')}
    ${functionText('canInspectNow')}
    ${functionText('updateInspectControls')}
    return { canInspectNow, updateInspectControls }
  `)
  return { ...fn(state, calls), calls }
}

describe('K4 — Inspect is offered and left on canEditNow(), the same gate both ways', () => {
  test('an owner whose avatar isn\'t ready is offered Inspect; once ready, Inspect is left', () => {
    const modes = createEditModes({ setTriggerActive: () => {} })
    const state = { client: { canEdit: true, connected: true }, avatarReady: false, modes, btn: { style: {} } }
    const g = gateHarness(state)
    g.updateInspectControls()
    assert.equal(state.btn.style.display, '', 'offered while the avatar isn\'t ready')
    modes.setInspect(true)
    state.avatarReady = true
    g.updateInspectControls()
    assert.equal(state.btn.style.display, 'none', 'not offered once Edit is')
    assert.deepEqual(g.calls, [false], 'and left')
    assert.equal(modes.inspect, false)
  })

  test('a visitor is offered Inspect while connected; leaving the world leaves it', () => {
    const modes = createEditModes({ setTriggerActive: () => {} })
    const state = { client: { canEdit: false, connected: true }, avatarReady: true, modes, btn: { style: {} } }
    const g = gateHarness(state)
    assert.equal(g.canInspectNow(), true)
    modes.setInspect(true)
    state.client.connected = false
    g.updateInspectControls()
    assert.equal(state.btn.style.display, 'none')
    assert.equal(modes.inspect, false)
  })

  test('updateEditControls runs the Inspect gate; avatar-ready and the session end reach it', () => {
    assert.match(flatten(body('updateEditControls')), /updateInspectControls\(\)/)
    const end = flatten(body('endEditSession'))
    assert.match(end, /setInspectMode\(false\)/, 'leaving the world leaves Inspect')
    assert.match(end, /updateInspectControls\(\)/)
    assert.ok(!/clipboard = null/.test(end), 'the clipboard survives a teleport (CP-L2)')
    assert.match(flatten(source.slice(source.indexOf("avatar.on('avatar:local-ready'"), source.indexOf("avatar.on('avatar:peer-added'"))),
      /updateEditControls\(\)/)
  })

  test('the Inspect outline follows its object: updated before tickEditMode\'s Edit guard', () => {
    const tick = flatten(body('tickEditMode'))
    assert.ok(tick.indexOf('if (inspectOutline) inspectOutline.update()') >= 0, tick)
    assert.ok(tick.indexOf('if (inspectOutline) inspectOutline.update()') < tick.indexOf('if (!modes.edit) return'), tick)
  })

  test('the Enable question counts an ambiguous id as in the world; only not-found is not', () => {
    assert.match(flatten(source), /objectInWorld: \(id\) => \{ const found = client\.som\?\.resolveObjectId\?\.\(id\) return !!found && found\.problem !== 'not-found' \}/)
  })

  test('Edit turning on leaves Inspect; Inspect turning on exits pointer lock', () => {
    assert.match(flatten(body('setEditMode')), /if \(modes\.inspect\) setInspectMode\(false\)/)
    assert.match(flatten(body('setInspectMode')), /modes\.setInspect\(true\) if \(document\.pointerLockElement\) document\.exitPointerLock\(\)/)
  })
})

// ---------------------------------------------------------------------------
// The Inspect click and panel
// ---------------------------------------------------------------------------

describe('K4 — the Inspect click and panel', () => {
  const click = flatten(clickHandler('viewportEl'))
  const inspectBranch = click.slice(click.indexOf('if (modes.inspect)'), click.indexOf('if (!modes.edit)'))

  test('an Inspect click picks with includeHidden: false, so a hidden object isn\'t picked', () => {
    assert.ok(inspectBranch.length > 0, 'the Inspect branch comes first')
    assert.match(inspectBranch, /pickEditTarget\(e, \{ includeHidden: false \}\)/)
    assert.match(flatten(functionText('pickEditTarget')), /visibleHits\(raycaster\.intersectObjects\(sceneGroup\.children, true\), \{ includeHidden \}\)/)
    assert.match(flatten(functionText('pickEditTarget')), /\{ includeHidden = true \} = \{\}/, 'Edit mode keeps picking hidden objects (F-L8)')
  })

  test('an Inspect click never sends activate: its branch returns before the activate path', () => {
    assert.match(inspectBranch, /inspectSelect\(node\)/)
    assert.match(inspectBranch, /return \}\s*$/)
    assert.ok(!/performActivateClick|activateClickTarget|pickBehaviorTarget/.test(inspectBranch))
  })

  test('Copy\'s refusal reason is Duplicate\'s, the credit skipped', () => {
    // subtree-add T6/T7 — at the server's level, so a group's reason is its own
    assert.match(flatten(body('copyHint')), /duplicateRuleProblem\(gltfNode, \{ credit: false, trees: treesAllowed\(\) \}\)\?\.reason \?\? null/)
    assert.match(flatten(body('renderInspectPanel')), /const reason = copyHint\(node\) ipCopy\.disabled = !!reason/)
  })

  test('the panel\'s text is set with textContent, never as HTML', () => {
    const panel = stripComments(body('renderInspectPanel'))
    for (const id of ['ipName', 'ipCredit', 'ipBehavior', 'ipReason']) {
      assert.match(panel, new RegExp(`${id}\\.textContent = `), `${id} by textContent`)
    }
    assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(panel))
    assert.ok(!/innerHTML/.test(stripComments(clickHandler('ipCopy'))))
  })

  test('Copy reads the live connection, never the File box base', () => {
    const copy = flatten(body('copyNode'))
    assert.match(copy, /copyObject\(gltfNode, \{ wsUrl: client\.wsUrl, world: client\.world \}, \{ nameOf: objectNameHere, trees: treesAllowed\(\) \}\)/)
    assert.ok(!/worldBaseUrl/.test(copy))
  })

  test('post-review: the Edit panel shows the selected object\'s credit, as claimed, by textContent', () => {
    const row = flatten(body('refreshCreditRow'))
    assert.match(row, /const lines = selected \? creditLines\(selected\.extras\?\.atrium\) : \[\]/)
    assert.match(row, /epCreditRow\.style\.display = lines\.length > 0 \? '' : 'none' epCredit\.textContent = lines\.join\('\\n'\)/)
    assert.ok(!/innerHTML/.test(row))
    assert.match(flatten(body('refreshEditPanel')), /refreshNameField\(\) refreshCreditRow\(\)/, 'refreshed with the selection')
    for (const id of ['ep-credit-row', 'ep-credit']) {
      assert.match(html, new RegExp(`id="${id}"`)); assert.match(source, new RegExp(`getElementById\\('${id}'\\)`))
    }
  })

  test('index.html has the toggle, the panel and its notes (K9)', () => {
    for (const id of ['inspect-toggle-btn', 'inspect-panel', 'ip-empty', 'ip-fields', 'ip-name', 'ip-credit', 'ip-behavior', 'ip-copy', 'ip-reason', 'ip-status', 'ep-copy', 'ep-paste', 'ep-paste-notes']) {
      assert.match(html, new RegExp(`id="${id}"`), `#${id}`)
      assert.match(source, new RegExp(`getElementById\\('${id}'\\)`), `app.js reads #${id}`)
    }
    assert.ok(html.includes(VISITOR_NOTE), 'C2\'s note in the Inspect panel')
    assert.ok(html.includes(MODEL_HOST_NOTE), 'the models-by-url host note in the Inspect panel')
    assert.ok(html.includes(VISIBILITY_NOTE), 'the note beside the Public/Private toggles')
    assert.match(flatten(source), /toggleLabel\.title = VISIBILITY_NOTE/)
  })
})

// ---------------------------------------------------------------------------
// K6 — the paste branch
// ---------------------------------------------------------------------------

describe('K6 — app.js\'s paste branch', () => {
  const pasteAnswerError = new Function(`${functionText('pasteAnswerError')}; return pasteAnswerError`)()

  test('refused: "Couldn’t paste: <the server\'s text>"', () => {
    assert.equal(pasteAnswerError('rejected', 'name "Crate" already in use'), 'Couldn’t paste: name "Crate" already in use')
  })
  test('unknown: "Couldn’t paste: the world did not answer"', () => {
    assert.equal(pasteAnswerError('unknown'), 'Couldn’t paste: the world did not answer')
  })
  test('accepted: no error', () => {
    assert.equal(pasteAnswerError('accepted'), null)
  })

  test('the branch: one retry with the next copyName for "already in use", the error, or the selection; and it returns', () => {
    const answer = flatten(body('onStructureAnswer'))
    const at = answer.indexOf('if (request.paste)')
    assert.ok(at > 0 && at < answer.indexOf('if (request.library)'), 'its own branch, before the forms\' and the generic ones')
    const branch = answer.slice(at, answer.indexOf('if (request.library)'))
    assert.match(branch, /status === 'rejected' && !request\.retried && modes\.edit && \/already in use\/\.test\(message \?\? ''\)/)
    // subtree-add T6: the root's name is kept when still free (a part's name was taken)
    assert.match(branch, /const name = isNameFree\(request\.name\) \? request\.name : copyName\(request\.baseName, isNameFree\) if \(name && retryPaste\(request, name\)\)/)
    assert.match(branch, /const error = pasteAnswerError\(status, message\) if \(error\) showEditError\(error\) else if \(modes\.edit\) selectAdded\(request\.name\)/)
    assert.match(branch, /refreshEditActions\(\) return \}\s*$/)
    const retry = flatten(body('retryPaste'))
    // subtree-add T6 (S4) — the names only, re-chosen for every member
    assert.match(retry, /const descriptor = renamePaste\(request\.descriptor, \{ rootName: name, originals: request\.originals \?\? \[request\.baseName\], isFree: isNameFree \}\) if \(!descriptor\) return false/)
    assert.match(retry, /structure\.begin\('add', seq, \{ name, descriptor, paste: true, baseName: request\.baseName, originals: request\.originals, retried: true \}\)/, 'never retried twice')
    assert.match(retry, /if \(begun\) undo\.registerAdd\(seq, \{ name, duplicate: false \}\)/)
  })

  test('the Paste click: Edit mode only, a copy of the clipboard prepared, the connection\'s origin, an add with Undo', () => {
    const paste = flatten(clickHandler('epPaste'))
    assert.match(paste, /if \(!modes\.edit \|\| !clipboard \|\| editDispatchBlocked\(\)\) return/)
    assert.match(paste, /preparePaste\(clipboard, \{/)
    assert.match(paste, /destOrigin: AtriumClient\.wsOriginToHttpOrigin\(client\.wsUrl\)/)
    assert.match(paste, /destWorldId: client\.world\?\.id \?\? null/)
    assert.match(paste, /destAddFields: client\.serverAddFields/, 'subtree-add T7: the server’s level')
    assert.match(paste, /const originals = treeMembers\(clipboard\.descriptor\)\.map\(\(d\) => d\.name\) structure\.begin\('add', seq, \{ name, descriptor: prepared\.descriptor, paste: true, baseName: clipboard\.descriptor\.name, originals \}\)/)
    assert.match(paste, /undo\.registerAdd\(seq, \{ name, duplicate: false \}\)/)
    assert.ok(!/clipboard = /.test(paste), 'a paste never replaces the clipboard')
    assert.ok(!/worldBaseUrl/.test(paste))
  })

  test('Paste is offered in Edit mode only; Copy in both', () => {
    const actions = flatten(body('refreshEditActions'))
    assert.match(actions, /epPaste\.disabled = blocked \|\| !modes\.edit \|\| !clipboard/)
    const copy = flatten(clickHandler('epCopy'))
    assert.match(copy, /if \(!modes\.edit \|\| !selected\) return/)
    assert.match(flatten(clickHandler('ipCopy')), /if \(!modes\.inspect \|\| !inspected\) return/)
  })
})
