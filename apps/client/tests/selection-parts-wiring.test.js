// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// selection-parts T13–T18 (PREBRIEF-selection-parts.md FINAL Rev 2) — the
// app.js wiring. The handle-press handlers are LIFTED from app.js and RUN (the
// subtree-add lesson: a test that runs a step the page never runs passes for
// the wrong reason), with the real edit-press.js and a stand-in control that
// behaves as TransformControls r163 does: its `dragging` setter fires
// `dragging-changed`, and `pointerUp` clears `dragging` and `axis`. The rest
// is read as text, as the other wiring tests read it.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHandlePress } from '../src/edit-press.js'
import { handleUpdate } from '../src/edit-gesture.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const code = readFileSync(resolve(__dirname, '../src/app.js'), 'utf-8')
  .split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')

/** `function <name>() { … }`'s text in app.js, braces matched. */
function functionText(name) {
  const at = code.search(new RegExp(`function ${name}\\s*\\(`))
  assert.ok(at >= 0, `app.js has a function ${name}()`)
  const open = code.indexOf('{', code.indexOf(')', at))
  let depth = 0
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++
    else if (code[i] === '}' && --depth === 0) return code.slice(at, i + 1)
  }
  throw new Error(`unbalanced ${name}`)
}

/** The text from `start` to the next line that is exactly `})`. */
function blockFrom(start) {
  const at = code.indexOf(start)
  assert.ok(at >= 0, `app.js has ${start}`)
  return code.slice(at, code.indexOf('\n})', at) + 3)
}

function vec(a) {
  return { v: [...a], fromArray(x) { this.v = [...x]; return this }, toArray() { return [...this.v] } }
}

/**
 * The page's handle-press handlers, lifted and bound to a small world: one
 * selected node (`translation` etc. as the SOM has them), its three.js object,
 * a stand-in control, a gesture spy and a hold spy.
 */
function page({ blocked = false } = {}) {
  const env = {
    selected: { name: 'lamp-01', translation: [3, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    selectedObj: { position: vec([3, 0, 0]), quaternion: vec([0, 0, 0, 1]), scale: vec([1, 1, 1]) },
    activeGesture: null,
    pressDown: null,
    pendingRename: null,
    modes: { edit: true },
    handlePress: createHandlePress(),
    handleUpdate,
    gestures: [],
    holds: [],
    blocked,
  }
  env.editTracker = {
    begin(node) {
      const g = { node, updates: [], ended: false, update(v) { this.updates.push(v) }, end() { this.ended = true } }
      env.gestures.push(g)
      return g
    },
  }
  env.hold = { hold: (n) => env.holds.push(n), clear: () => env.holds.push('clear') }
  env.editDispatchBlocked = () => env.blocked
  env.refreshEditActions = () => {}
  env.refreshEditVectors = () => {}
  env.refreshSpawnNote = () => {}
  const names = ['onHandleDragging', 'onHandleChange', 'endHandleDrag', 'putBackHandle', 'syncGizmoEnabled']
  const api = new Function('env', `with (env) { ${names.map(functionText).join('\n')}\n return { ${names.join(', ')} } }`)(env)
  Object.assign(env, api)
  // the stand-in control: dragging fires dragging-changed, as defineProperty does in r163
  let dragging = false
  env.gizmo = {
    mode: 'translate',
    axis: null,
    enabled: true,
    get dragging() { return dragging },
    set dragging(v) { if (v !== dragging) { dragging = v; env.onHandleDragging(v) } },
    pointerUp({ button } = {}) { if (button !== 0) return; this.dragging = false; this.axis = null },
  }
  return env
}

/** The DOM's order: capture pointerdown, the control's pointerdown, mousedown. */
function press(env, { x = 100, y = 100, detail = 1 } = {}) {
  env.handlePress.down({ x, y })
  env.gizmo.axis = 'Y'
  env.gizmo.dragging = true
  env.pressDown = { x, y, onHandle: env.gizmo.dragging }
  env.handlePress.count(detail)
}
/** A pointer move: the capture listener, then the control moves the object and reports it. */
function move(env, { x, y, to }) {
  env.handlePress.move({ x, y })
  env.selectedObj.position.fromArray(to)
  env.onHandleChange()
}
function release(env) {
  env.gizmo.pointerUp({ button: 0 })
}

describe('T17, run: a press on a handle', () => {
  test('2 px of jitter: no gesture, nothing held, the object put back, and the click selects', () => {
    const env = page()
    press(env)
    move(env, { x: 101, y: 98, to: [3, 0.0995, 0] })
    assert.deepEqual(env.selectedObj.position.toArray(), [3, 0, 0], 'put back to the SOM node')
    release(env)
    assert.equal(env.gestures.length, 0, 'no gesture began: no Move is sent or recorded')
    assert.deepEqual(env.holds, [], 'the drag rule was not held')
    assert.equal(env.pressDown.onHandle, false, 'the click that follows is a select click')
    assert.equal(env.pressDown.fromHandle, true)
  })
  test('a real drag: the gesture begins at the first change past 4 px and ends at the release', () => {
    const env = page()
    press(env)
    move(env, { x: 101, y: 100, to: [3, 0.01, 0] })
    move(env, { x: 110, y: 100, to: [3, 0.3, 0] })
    assert.equal(env.gestures.length, 1)
    assert.deepEqual(env.gestures[0].updates.at(-1), { translation: [3, 0.3, 0] })
    assert.deepEqual(env.holds, [env.selected])
    release(env)
    assert.equal(env.gestures[0].ended, true)
    assert.equal(env.activeGesture, null)
    assert.equal(env.pressDown.onHandle, true, 'a drag is never a click')
  })
  test('a fast drag that arrives as one 30 px move begins at once (the pointer read from pointermove)', () => {
    const env = page()
    press(env)
    move(env, { x: 130, y: 100, to: [3, 0.9, 0] })
    assert.equal(env.gestures.length, 1)
    assert.deepEqual(env.gestures[0].updates[0], { translation: [3, 0.9, 0] })
  })
  test('SP-L11: a double-click’s second press never drags, and is a click whatever it travels', () => {
    const env = page()
    press(env, { detail: 2 })
    move(env, { x: 106, y: 100, to: [3, 0.0118, 0] })
    move(env, { x: 140, y: 100, to: [3, 1.2, 0] })
    assert.equal(env.gestures.length, 0)
    assert.deepEqual(env.selectedObj.position.toArray(), [3, 0, 0])
    release(env)
    assert.equal(env.pressDown.forced, true)
    assert.equal(env.pressDown.onHandle, false)
  })
  test('a block: no gesture begins past 4 px, and the change is put back (N-3)', () => {
    const env = page({ blocked: true })
    press(env)
    move(env, { x: 120, y: 100, to: [3, 0.5, 0] })
    assert.equal(env.gestures.length, 0)
    assert.deepEqual(env.selectedObj.position.toArray(), [3, 0, 0])
  })
  test('another tab’s move during the press: the put-back follows the live node (S-2)', () => {
    const env = page()
    press(env)
    env.selected.translation = [1, 0.25, -2]
    move(env, { x: 102, y: 100, to: [3, 0.05, 0] })
    assert.deepEqual(env.selectedObj.position.toArray(), [1, 0.25, -2])
  })
})

describe('T18, run: the drag ends before the handles change', () => {
  test('endHandleDrag mid-drag ends the gesture with its final send, and spends the press', () => {
    const env = page()
    press(env)
    move(env, { x: 120, y: 100, to: [3, 0.5, 0] })
    env.endHandleDrag()
    assert.equal(env.gizmo.dragging, false, 'the control is no longer dragging')
    assert.equal(env.gestures[0].ended, true, 'the move is kept (SP-L9 (a))')
    assert.equal(env.activeGesture, null)
    assert.equal(env.pressDown.onHandle, true, 'the real release that follows selects nothing')
  })
  test('endHandleDrag before any travel: nothing sent, the object put back, and no click follows', () => {
    const env = page()
    press(env)
    move(env, { x: 101, y: 100, to: [3, 0.02, 0] })
    env.endHandleDrag()
    assert.equal(env.gestures.length, 0)
    assert.deepEqual(env.selectedObj.position.toArray(), [3, 0, 0])
    assert.equal(env.pressDown.onHandle, true)
  })
  test('SP-L12: syncGizmoEnabled turning the control off mid-drag ends the drag first, so it isn’t stranded', () => {
    const env = page()
    press(env)
    move(env, { x: 120, y: 100, to: [3, 0.5, 0] })
    env.selectedObj = null                // the selection went (Escape, a removal)
    env.syncGizmoEnabled()
    assert.equal(env.gizmo.enabled, false)
    assert.equal(env.gizmo.dragging, false, 'not stranded: the next press can start')
    assert.equal(env.gestures[0].ended, true)
  })
  test('selectForEdit ends the drag before anything else', () => {
    const body = functionText('selectForEdit')
    assert.match(body, /if \(node === selected\) return\s*endHandleDrag\(\)/)
    assert.ok(body.indexOf('endHandleDrag()') < body.indexOf('selected = node'))
  })
})

describe('T13 and SP-L10: the click', () => {
  const click = blockFrom("viewportEl.addEventListener('click'")
  test('Edit and Inspect pass their own selection, and drill on a click count of 2 or more', () => {
    assert.match(click, /pickEditTarget\(e, \{ current: selected \}\)/)
    assert.match(click, /pickEditTarget\(e, \{ includeHidden: false, current: inspected \}\)/)
    assert.match(functionText('pickEditTarget'), /resolveRoot: resolveScopedSelection,\s*descend: e\.altKey,\s*current,\s*drill: e\.detail >= 2,/)
  })
  test('a double-click’s second press on a handle counts as a click whatever it travelled', () => {
    assert.match(click, /const forced = down\?\.forced === true && !down\.onHandle\s*if \(!forced && !isSelectClick\(down, \{ x: e\.clientX, y: e\.clientY \}, \{ gestureEnded: !!down\?\.onHandle \}\)\) return/)
  })
  test('SP-L10: a click from a handle changes the selection only within the selected object’s top-level object', () => {
    assert.match(click, /if \(down\?\.fromHandle && selected && !\(node && topLevelAncestor\(node\) === topLevelAncestor\(selected\)\)\) return\s*selectForEdit\(node\)/)
  })
  test('the press, its moves and its click count are recorded in the capture phase', () => {
    assert.match(code, /viewportEl\.addEventListener\('pointerdown', \(e\) => handlePress\.down\(\{ x: e\.clientX, y: e\.clientY \}\), true\)/)
    assert.match(code, /viewportEl\.addEventListener\('pointermove', \(e\) => handlePress\.move\(\{ x: e\.clientX, y: e\.clientY \}\), true\)/)
    assert.match(blockFrom("viewportEl.addEventListener('mousedown'"), /handlePress\.count\(e\.detail\)/)
  })
})

describe('T14 and T15: the breadcrumb, Escape, Inspect', () => {
  test('the breadcrumb is rebuilt only when the path changes, with textContent and shownText', () => {
    const body = functionText('renderPath')
    assert.match(body, /if \(last && last\.path\.length === path\.length &&\s*last\.path\.every\(\(n, i\) => n === path\[i\]\) && last\.names\.every\(\(x, i\) => x === names\[i\]\)\) return/)
    assert.match(body, /breadcrumbItems\(path, \{ show: shownText \}\)/)
    assert.match(body, /el\.textContent = item\.text/)
    assert.doesNotMatch(body, /innerHTML/)
    assert.match(body, /setAttribute\('aria-current', 'location'\)/)
    assert.match(body, /sep\.setAttribute\('aria-hidden', 'true'\)/)
  })
  test('both panels render it', () => {
    assert.match(functionText('refreshEditPanel'), /renderPath\(epPath, selected\)/)
    assert.match(functionText('renderInspectPanel'), /renderPath\(ipPath, node\)/)
  })
  test('a crumb re-checks identity and the duplicate-name rule, and gives focus back to the canvas', () => {
    const body = functionText('wireCrumbs')
    assert.match(body, /if \(!node \|\| client\.som\?\.getNodeByName\(node\.name\) !== node\)/)
    assert.match(body, /if \(isDuplicatedName\(node\.name\)\) \{ refuse\(DUPLICATE_NAME_MESSAGE\); return \}/)
    assert.match(body, /canvas\.focus\?\.\(\)/)
  })
  test('Escape goes up a level in Edit and in Inspect; a duplicated parent deselects with the message', () => {
    const esc = functionText('escapeTarget')
    assert.match(esc, /if \(!parent\) return \{ node: null, refused: null \}/)
    assert.match(esc, /if \(isDuplicatedName\(parent\.name\)\) return \{ node: null, refused: DUPLICATE_NAME_MESSAGE \}/)
    const listener = code.slice(code.indexOf("if (e.key === 'Escape') {"), code.indexOf('// ── The Teleporter button'))
    assert.match(listener, /if \(selected\) \{\s*const up = escapeTarget\(selected\)\s*selectForEdit\(up\.node\)/)
    assert.match(listener, /else \{\s*setEditMode\(false\)\s*\}/)
    assert.match(listener, /if \(modes\.inspect && inspected && !e\.target\.closest\?\.\('input, textarea, select'\)\) \{\s*const up = escapeTarget\(inspected\)\s*inspectSelect\(up\.node\)/)
  })
  test('Inspect follows a removed part by identity, and re-renders on a rename', () => {
    assert.match(code, /client\.on\('som:remove', \(\) => \{\s*if \(inspected && client\.som\?\.getNodeByName\(inspected\.name\) !== inspected\) inspectSelect\(null\)/)
    assert.match(code, /client\.on\('som:rename', \(\) => \{\s*if \(inspected\) renderInspectPanel\(\)/)
  })
  test('the hint line names the double-click and Escape going up', () => {
    assert.match(code, /Edit mode · Click to select · Double-click goes into a group · Alt-click selects a part · Esc goes up/)
  })
})
