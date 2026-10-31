// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// behavior-wiring.test.js — scripting-4b-2 steps 5 and 6: the wiring that only
// exists in the page. As app-wiring.test.js does, it reads app.js and index.html
// as TEXT and pins the pieces no fake element can reach. It tolerates
// whitespace and formatting, not a rewrite.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(__dirname, '../src/app.js'), 'utf-8')
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf-8')

describe('scripting-4b-2 — the Behaviour section is wired', () => {
  test('the runner is created, tracked in the frame loop, and torn down with the world', () => {
    assert.match(source, /runner = createBehaviorRunner\(\{/)
    assert.match(source, /runner\?\.tick\(\)/)
    // scripting-4c AC6 — the click path hands the runner to `performActivateClick`,
    // which is where `runner?.select(hit)` is called now (the branch is wiring).
    assert.match(source, /performActivateClick\(\{[\s\S]{0,400}?runner,/)
    assert.match(source, /runner\?\.setGesture\(/)
  })

  test('V13 — the Behaviour section is NOT one of the gate\'s forms, and Edit off closes it', () => {
    // It is still built with the panel's gate for `register`-only bookkeeping,
    // but it must never CLAIM it: claiming closed the library grid after every
    // placement (§1.4).
    assert.match(source, /behaviorForm = createBehaviorForm\(\{[\s\S]{0,600}?gate: modelGate/)
    assert.doesNotMatch(source, /behaviorForm\?\.open\([\s\S]{0,80}gate\.claim/, 'no claim at open')
    assert.match(source, /modelGate\.closeCurrent\(\)[\s\S]{0,600}?behaviorForm\?\.close\(\)/,
      'Edit off closes the Behaviour section explicitly')
  })

  test('the answers route to the form', () => {
    for (const kind of ['edit:accepted', 'edit:rejected', 'edit:unknown']) {
      assert.match(source, new RegExp(`behaviorForm\\?\\.onAnswer\\('${kind}'`), `${kind} reaches the form`)
    }
  })

  test('the form resets on connecting, disconnected and a new world', () => {
    const resets = source.match(/behaviorForm\?\.reset\(\)/g) ?? []
    assert.ok(resets.length >= 3, `three resets: ${resets.length}`)
  })

  test('W2/W3 — refreshBehaviorRow re-opens on a closed form and re-reads on som:set', () => {
    assert.match(source, /function refreshBehaviorRow\(\{ reread = false \} = \{\}\)/)
    assert.match(source, /refreshEditPanel\(\)[\s\S]{0,400}?refreshBehaviorRow\(\)/)
    assert.match(source, /path === 'extras\.atrium\.behavior'[\s\S]{0,200}?refreshBehaviorRow\(\{ reread: true \}\)/)
    // W2 — the Edit-off path clears the cached node beside the close.
    assert.match(source, /behaviorForm\?\.close\(\)[\s\S]{0,300}?lastBehaviorNode = null/)
    // W2 — and the decision is the tested helper, never an inline condition.
    assert.match(source, /behaviorRowAction\(\{[\s\S]{0,200}?open: behaviorForm\.openState/)
  })

  test('W1 — a LOCAL write of `visible` redraws in the owner\'s own tab', () => {
    // The tracker's `writeLocal` is the ONE local-write seam: the Visible
    // checkbox's commit, Undo and Redo of it, and a rejection's revert all go
    // through it, and none of them raises a `som:set` in this tab (the own echo
    // only resolves the pending edit). The hook therefore lives here, and it
    // runs BEFORE any echo can arrive.
    assert.match(source, /writeLocal: \(node, field, value\) => \{[\s\S]{0,700}?if \(field === 'visible' && docView\) setNodeVisible\(docView, node, node\.visible !== false\)/)
    // The server-side paths (another session's broadcast, an applied echo) still
    // run through the one `som:set` handler, unchanged: once per change.
    assert.match(source, /client\.on\('som:set', \(\{ nodeName, path \} = \{\}\) => \{[\s\S]{0,200}?if \(path !== 'visible'\) return[\s\S]{0,200}?setNodeVisible\(docView, node, node\.visible !== false\)/)
  })

  test('select comes from the VIEWPORT click, never from a SOM click', () => {
    // The sibling branch: `!modes.edit`, `e.target !== canvas`, `isSelectClick`.
    // scripting-4c AC6 — the branch resolves the hit through `activateClickTarget`
    // and hands it, with the runner, to `performActivateClick`. The tests for
    // that call itself are `apps/client/tests/activate-click.test.js`, and
    // `app-wiring.test.js` pins the branch’s call and its order.
    assert.match(source, /if \(!modes\.edit\) \{[\s\S]{0,2600}?isSelectClick\(down[\s\S]{0,900}?performActivateClick\(\{[\s\S]{0,400}?runner,/)
    assert.match(source, /activateClickTarget\(hit\)/, '4c: the target comes from the one shared rule')
    assert.doesNotMatch(source, /dispatchPointerEvent\([^)]*\)[\s\S]{0,40}runner\?\.select/)
  })

  test('the drag rule is set from the handle drag and from a form write', () => {
    assert.match(source, /activeGesture = editTracker\.begin\(selected\)[\s\S]{0,200}?runner\?\.setGesture\(selected\.name\)/)
    assert.match(source, /writeSend: \(node, field, value\) => \{[\s\S]{0,200}?runner\?\.setGesture\(node\.name\)/)
    assert.match(source, /onTransformsSettled[\s\S]{0,200}?runner\?\.setGesture\(null\)/)
  })

  test('F6 — the Visible checkbox writes through the same tracker', () => {
    assert.match(source, /epVisible[\s\S]{0,400}?editTracker\.commit\(selected, 'visible'/)
    assert.match(source, /applyVisibility\(docView, client\.som\)/)
    assert.match(source, /setNodeVisible\(docView, node, node\.visible !== false\)/)
  })
})

describe('scripting-4b-2 — the page carries the section\'s elements', () => {
  const ids = [
    'ep-behavior-row', 'ep-behavior-template', 'ep-behavior-params', 'ep-behavior-actions',
    'ep-behavior-enabled', 'ep-behavior-save', 'ep-behavior-remove',
    'ep-behavior-status', 'ep-behavior-note', 'ep-behavior-log', 'ep-behavior-log-lines',
    'ep-behavior-hint',
    'ep-visible',
  ]
  for (const id of ids) {
    test(`#${id} is in index.html`, () => {
      assert.match(html, new RegExp(`id="${id}"`))
    })
  }
})

// ── T1 (r3): the one help element, wired ─────────────────────────────────

describe('scripting-4b-2 r3 (T1) — #ep-behavior-hint is the section\'s one help element', () => {
  test('it sits inside the Behaviour section, between the params and the actions', () => {
    const row = html.indexOf('id="ep-behavior-row"')
    const params = html.indexOf('id="ep-behavior-params"')
    const hint = html.indexOf('id="ep-behavior-hint"')
    const actions = html.indexOf('id="ep-behavior-actions"')
    for (const [what, at] of [['row', row], ['params', params], ['hint', hint], ['actions', actions]]) {
      assert.notEqual(at, -1, `#ep-behavior-${what} is in index.html`)
    }
    assert.ok(row < params && params < hint && hint < actions,
      `order: row ${row} < params ${params} < hint ${hint} < actions ${actions}`)
  })

  test('app.js passes it to createBehaviorForm as the form\'s hint element', () => {
    // Whole-line `//` comments are dropped first: a COMMENTED-OUT wire passes
    // nothing, so the guard must not accept one.
    const code = source.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')
    assert.match(code, /const epBehaviorHint\s*=\s*document\.getElementById\('ep-behavior-hint'\)/)
    assert.match(code, /createBehaviorForm\(\{[\s\S]{0,600}?hint: epBehaviorHint/)
  })
})

describe('scripting-4b-2 r5 (V1, V2, V12) — the page obeys the DOM\'s own rules', () => {
  const SRC_FILES = readdirSync(resolve(__dirname, '../src')).filter((f) => f.endsWith('.js'))
  /** Code only: a mention of the bug inside a comment is not the bug. */
  const code = (text) => text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')

  test('V1/V12 — no apps/client/src file assigns a getter-only DOM property', () => {
    // `dataset`, `style`, `classList`, `children` and `parentNode` are
    // getter-only in the browser: `el.dataset = { … }` throws `TypeError`.
    // §1.2 item 1 was exactly this line, in behavior-form.js.
    for (const file of SRC_FILES) {
      const text = code(readFileSync(resolve(__dirname, '../src', file), 'utf-8'))
      for (const prop of ['dataset', 'style', 'classList', 'children', 'parentNode']) {
        const pattern = new RegExp(`\\.${prop}\\s*=[^=]`)
        const line = text.split('\n').findIndex((l) => pattern.test(l))
        assert.equal(line, -1, `${file}: assigns .${prop} at line ${line + 1}`)
      }
    }
  })

  test('V1 — the form writes a field\'s data attribute as a property, never the map itself', () => {
    const form = code(readFileSync(resolve(__dirname, '../src/behavior-form.js'), 'utf-8'))
    assert.match(form, /dataset\.field\s*=/, 'the data attribute is set on the live map')
    assert.doesNotMatch(form, /\.dataset\s*=\s*\{/, 'and never by assigning the map')
  })

  test('V2 — the Enabled listener is `click`, and no code reads its `.checked`', () => {
    const form = code(readFileSync(resolve(__dirname, '../src/behavior-form.js'), 'utf-8'))
    assert.match(form, /elements\.enabled\.addEventListener\('click'/)
    assert.doesNotMatch(form, /elements\.enabled\.checked/)
  })

  test('V2 — the three action buttons are type="button" so a form never submits', () => {
    for (const id of ['ep-behavior-enabled', 'ep-behavior-save', 'ep-behavior-remove']) {
      assert.match(html, new RegExp(`<button type="button" id="${id}"`), `#${id}`)
    }
  })
})

describe('scripting-4b-2 r5 (V5, V6) — the clip ids and the own capsule', () => {
  test('V5 — app.js feeds the form the SAME clip ids the adapter checks', () => {
    const code = source.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')
    // X6 (round 7) — one source, reached by NODE for the form and by id for the
    // adapter's S7 check.
    assert.match(code, /import \{ clipsFor, clipsForNode \} from '\.\/behavior-clips\.js'/)
    assert.match(code, /clipStatus: \(node\) => clipStatusForNode\(node\)/,
      'the form\'s picker reads the one source, by NODE')
    assert.match(code, /function clipStatusForNode\(node\) \{\s*return clipsForNode\(node, \{ modelAnimations \}\)/,
      'and that IS clipsForNode')
    assert.match(code, /clips: clipStatusFor/, 'the runner (the adapter\'s clip check) still reads by id')
    assert.doesNotMatch(code, /clipIds: \(objectId\)/, 'the id-only form dep is gone')
    assert.doesNotMatch(code, /clip ids are not exposed/, 'round 4\'s excuse is gone')
  })

  test('X2 (r7) — modelAnimations\' onChange tells the form, and only the form decides', () => {
    const code = source.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')
    assert.match(code, /onChange: \(name\) => \{[\s\S]{0,400}?behaviorForm\?\.onClipStatusChange\(name\)/,
      'the clip status change reaches the form')
  })

  test('V6 — the V key and the disconnect reset both show/hide the capsule through `setNodeVisible`', () => {
    assert.match(source,
      /avatar\.localNode\.visible = (false|true)[\s\S]{0,400}?if \(docView\) setNodeVisible\(docView, avatar\.localNode, !firstPerson\)/,
      'the V handler')
    assert.match(source,
      /function teardownWorld\(\)[\s\S]{0,400}?setNodeVisible\(docView, avatar\??\.localNode, true\)/,
      'the reset on disconnect')
  })
})

// ── 4d-1 (G6): the importer's panel is wired ─────────────────────────────

describe('scripting-4d-1 (G6) — the importer\'s panel', () => {
  /** Code only: a mention of a bug inside a comment is not the bug. */
  const strip = (text) => text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')
  const code = strip(source)
  const readSrc = (file) => strip(readFileSync(resolve(__dirname, '../src', file), 'utf-8'))

  test('the panel is created, wired, and handed the page\'s own write seam', () => {
    assert.match(code, /import \{ createGraphImportPanel \} from '\.\/graph-import-panel\.js'/)
    assert.match(code, /importPanel = createGraphImportPanel\(\{/)
    assert.match(code, /importPanel\.wire\(\)/)
    // The SAME seam F9's Behaviour form uses: the node gets its objectId first.
    assert.match(code, /setObjectId: \(name, id\) => client\.setObjectId\(name, id\)/)
    assert.match(code, /sendField: \(name, field, value\) => client\.sendField\(name, field, value\)/)
    assert.match(code, /newObjectId,/)
    // R16 — the grants line names objects through the SAME `nameOf` the form
    // hands the Q3 confirmation.
    assert.match(code, /importPanel = createGraphImportPanel\(\{[\s\S]{0,1200}?nodeName: \(id\) => \(client\.som\?\.resolveObjectId\?\.\(id\)\?\.name \?\? id\)/)
  })

  test('the answers route to the panel, and it closes with the section', () => {
    for (const kind of ['edit:accepted', 'edit:rejected', 'edit:unknown']) {
      assert.match(code, new RegExp(`importPanel\\?\\.onAnswer\\('${kind}'`), `${kind} reaches the panel`)
    }
    // Edit off closes it with the Behaviour section.
    assert.match(code, /behaviorForm\?\.close\(\)[\s\S]{0,600}?importPanel\?\.close\(\)/)
    // And a world change does too.
    assert.match(code, /behaviorForm\?\.reset\(\)[\s\S]{0,200}?importPanel\?\.close\(\)/)
    // A selection change closes it: it is bound to the object it was opened for.
    assert.match(code, /const action = behaviorRowAction\(\{[\s\S]{0,300}?\}\)[\s\S]{0,300}?if \(action === 'open'\) importPanel\?\.close\(\)/)
  })

  test('the panel\'s elements are in index.html, the button beside the template list', () => {
    const ids = [
      'ep-import-open', 'ep-import-panel', 'ep-import-file', 'ep-import-file-name',
      'ep-import-graph', 'ep-import-mapping', 'ep-import-report', 'ep-import-grants',
      'ep-import-notes', 'ep-import-status', 'ep-import-save', 'ep-import-close',
    ]
    for (const id of ids) assert.match(html, new RegExp(`id="${id}"`), `#${id}`)
    assert.match(html, /<button type="button" id="ep-import-open"[^>]*>Import a graph…<\/button>/)
    const row = html.indexOf('id="ep-behavior-row"')
    const open = html.indexOf('id="ep-import-open"')
    const panel = html.indexOf('id="ep-import-panel"')
    const params = html.indexOf('id="ep-behavior-params"')
    assert.ok(row !== -1 && row < open && open < panel && panel < params,
      `the button is in the row, the panel below it: ${row} < ${open} < ${panel} < ${params}`)
    // And app.js finds them.
    for (const id of ids) {
      assert.match(source, new RegExp(`getElementById\\('${id}'\\)`), `app.js reads #${id}`)
    }
  })

  test('the form renders the runner\'s lines and the G6 notes', () => {
    const form = readSrc('behavior-form.js')
    assert.match(form, /renderList\(elements\.lines, reported\.lines\)/)
    assert.match(form, /renderList\(elements\.notes, reported\.notes\)/)
    assert.match(form, /shouldPromptEnable\(state\.saved\)/)
    assert.match(form, /enablePromptText\(state\.saved, \{ nameOf: deps\.nodeName \}\)/)
    assert.match(source, /lines: epBehaviorLines, notes: epBehaviorNotes,/)
  })

  test('G6 — nothing from a graph or a file is written as HTML', () => {
    for (const file of ['graph-import.js', 'graph-import-panel.js', 'behavior-form.js']) {
      const text = readSrc(file)
      assert.doesNotMatch(text, /innerHTML/, `${file} writes no HTML`)
      assert.doesNotMatch(text, /insertAdjacentHTML|outerHTML|document\.write|\.innerText\s*=/, `${file}`)
    }
    // The log view (behavior-form.js) builds created nodes and sets textContent,
    // exactly as the panel's rows do.
    const form = readSrc('behavior-form.js')
    assert.match(form, /row\.textContent = line/)
    assert.match(form, /row\.textContent = value/)
    // The panel's rows too.
    const panel = readSrc('graph-import-panel.js')
    assert.match(panel, /label\.textContent = `\$\{file\} \(\$\{row\.kind\}\)`/)
    assert.match(panel, /text\(elements\.status, state\.problem/)
  })
})
