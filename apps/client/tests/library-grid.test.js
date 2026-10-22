// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// library-grid.test.js — library-sky step 5 (Z2). The Library grid's logic, with
// no DOM and no three.js: tiles, the descriptor a click builds, the tile rule and
// the answer routing are all plain values.
//
// The last describe reads app.js as a file (the way model-bridge-wiring.test.js
// does) for the three wirings that only exist in the page: the answer branch's
// position, the Escape close, and the world-boundary closes.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createLibraryGrid, groupByCategory, tileEnabled, tileBlockReason, libraryAnswerError,
} from '../src/library-grid.js'
import { createFormGate } from '../src/model-form.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const MODELS = [
  { id: 'ArmChair_01', name: 'Arm Chair', category: 'Seating', url: '/assets/library/models/ArmChair_01-b066909de731.glb', sha256: 'b'.repeat(64), bounds: [0.8484, 1.0651, 0.7658] },
  { id: 'Sofa_01', name: 'Sofa', category: 'Seating', url: '/assets/library/models/Sofa_01-c'.repeat(1) + '.glb', sha256: 'c'.repeat(64), bounds: [1, 1, 1] },
  { id: 'WoodenTable_02', name: 'Wooden Table', category: 'Tables', url: '/assets/library/models/WoodenTable_02-d.glb', sha256: 'd'.repeat(64), bounds: [2, 2, 2] },
]
const CATALOG = {
  models: MODELS, skies: [],
  credit: 'Models and skies from Poly Haven (CC0)', creditUrl: 'https://polyhaven.com',
}

function harness(over = {}) {
  const calls = { renderTiles: [], addNode: [], begin: [], register: [], select: [], refresh: 0, status: [] }
  const gate = createFormGate()
  const grid = createLibraryGrid({
    gate,
    name: 'library',
    deps: {
      catalog: () => CATALOG,
      canEdit: () => ({ edit: true, blocked: false }),
      firstFreeName: (text) => text,
      isNameFree: () => true,
      placement: () => ({ position: [1, 0, 2], rotation: [0, 0, 0, 1] }),
      storedUrl: (path) => `https://page.example${path}`,
      addNode: (descriptor) => { calls.addNode.push(descriptor); return 42 },
      structureBegin: (seq, pending) => calls.begin.push({ seq, pending }),
      undoRegisterAdd: (seq, entry) => calls.register.push({ seq, entry }),
      selectNode: (name) => calls.select.push(name),
      refreshActions: () => { calls.refresh += 1 },
      renderTiles: (groups, opts) => calls.renderTiles.push({ groups, opts }),
      setStatus: (text, kind) => calls.status.push({ text, kind }),
      ...over.deps,
    },
  })
  const last = () => calls.renderTiles.at(-1)
  return { grid, gate, calls, last }
}

// ===========================================================================
// The tile rule (Z2 + brief-gate correction 4)
// ===========================================================================

describe('the tile rule', () => {
  test('a tile is enabled only while !blocked && modes.edit AND no add in flight', () => {
    assert.equal(tileEnabled({ edit: true, blocked: false, waiting: false }), true)
    assert.equal(tileEnabled({ edit: true, blocked: true, waiting: false }), false, 'structurally blocked')
    assert.equal(tileEnabled({ edit: false, blocked: false, waiting: false }), false, 'Edit off')
    assert.equal(tileEnabled({ edit: true, blocked: false, waiting: true }), false, 'a library add is in flight')
    assert.equal(tileEnabled({ edit: false, blocked: true, waiting: true }), false)
    assert.equal(tileBlockReason({ edit: true, blocked: false, waiting: false }), null)
    for (const state of [{ edit: true, blocked: true }, { edit: true, waiting: true }, { edit: false }]) {
      assert.equal(typeof tileBlockReason(state), 'string')
    }
  })

  test('opening renders the tiles enabled', () => {
    const h = harness()
    h.grid.open()
    assert.equal(h.last().opts.enabled, true)
    assert.equal(h.last().opts.reason, null)
    assert.equal(h.last().opts.credit, CATALOG.credit)
    assert.equal(h.last().opts.creditUrl, CATALOG.creditUrl)
  })

  test('a structural block disables every tile, re-read on refresh', () => {
    let blocked = false
    const h = harness({ deps: { canEdit: () => ({ edit: true, blocked }) } })
    h.grid.open()
    assert.equal(h.last().opts.enabled, true)
    blocked = true
    h.grid.refresh()
    assert.equal(h.last().opts.enabled, false)
    assert.equal(typeof h.last().opts.reason, 'string')
  })

  test('Edit off disables every tile', () => {
    const h = harness({ deps: { canEdit: () => ({ edit: false, blocked: false }) } })
    h.grid.open()
    assert.equal(h.last().opts.enabled, false)
  })

  test('the tiles are grouped by category, in the catalog\'s order', () => {
    const h = harness()
    h.grid.open()
    const groups = h.last().groups
    assert.deepEqual(groups.map((g) => g.category), ['Seating', 'Tables'])
    assert.deepEqual(groups[0].entries.map((e) => e.id), ['ArmChair_01', 'Sofa_01'])
    assert.deepEqual(groups[1].entries.map((e) => e.id), ['WoodenTable_02'])
  })

  test('groupByCategory keeps the catalog order and names an unknown category', () => {
    const groups = groupByCategory([{ id: 'a', category: 'B' }, { id: 'b' }, { id: 'c', category: 'B' }])
    assert.deepEqual(groups.map((g) => g.category), ['B', 'Other'])
    assert.deepEqual(groups[0].entries.map((e) => e.id), ['a', 'c'])
  })
})

// ===========================================================================
// A click
// ===========================================================================

describe('a tile click (L27a)', () => {
  test('it builds the exact descriptor: the free name, the stored URL, the catalog bounds and the pinned hash', () => {
    const h = harness()
    h.grid.open()
    const result = h.grid.pick('ArmChair_01')
    assert.equal(result.seq, 42)
    assert.equal(result.name, 'Arm Chair')
    assert.deepEqual(h.calls.addNode, [{
      name: 'Arm Chair',
      translation: [1, 0, 2],
      rotation: [0, 0, 0, 1],
      extras: { atrium: { model: {
        url: 'https://page.example/assets/library/models/ArmChair_01-b066909de731.glb',
        bounds: [0.8484, 1.0651, 0.7658],
        sha256: 'b'.repeat(64),
      } } },
    }])
  })

  test('the free name comes from the catalog name, through firstFreeName', () => {
    const taken = new Set(['Arm Chair', 'Arm Chair 2'])
    const h = harness({ deps: {
      isNameFree: (name) => !taken.has(name),
      firstFreeName: (text) => { for (let n = 1; n < 10; n++) { const c = n === 1 ? text : `${text} ${n}`; if (!taken.has(c)) return c } return null },
    } })
    h.grid.open()
    assert.equal(h.grid.pick('ArmChair_01').name, 'Arm Chair 3')
  })

  test('the structural add is marked library, and the undo engine records it', () => {
    const h = harness()
    h.grid.open()
    h.grid.pick('ArmChair_01')
    assert.equal(h.calls.begin.length, 1)
    assert.equal(h.calls.begin[0].seq, 42)
    assert.equal(h.calls.begin[0].pending.library, true, 'the request is marked for the answer branch')
    assert.equal(h.calls.begin[0].pending.name, 'Arm Chair')
    assert.deepEqual(h.calls.register, [{ seq: 42, entry: { name: 'Arm Chair', duplicate: false } }])
  })

  test('while the add is in flight the tiles are disabled and a second click does nothing', () => {
    const h = harness()
    h.grid.open()
    h.grid.pick('ArmChair_01')
    assert.equal(h.grid.waiting, 42)
    assert.equal(h.last().opts.enabled, false, 'the tiles are disabled while waiting')
    assert.equal(h.grid.pick('Sofa_01'), null, 'one library add at a time')
    assert.equal(h.calls.addNode.length, 1)
  })

  test('a closed grid adds nothing', () => {
    const h = harness()
    assert.equal(h.grid.pick('ArmChair_01'), null)
    assert.equal(h.calls.addNode.length, 0)
  })

  test('a structurally blocked or Edit-off grid adds nothing', () => {
    for (const canEdit of [{ edit: true, blocked: true }, { edit: false, blocked: false }]) {
      const h = harness({ deps: { canEdit: () => canEdit } })
      h.grid.open()
      assert.equal(h.grid.pick('ArmChair_01'), null, JSON.stringify(canEdit))
      assert.equal(h.calls.addNode.length, 0)
    }
  })

  test('an unknown id adds nothing', () => {
    const h = harness()
    h.grid.open()
    assert.equal(h.grid.pick('NoSuchThing'), null)
    assert.equal(h.calls.addNode.length, 0)
  })

  test('a taken name that no free candidate can fix reports in the status line', () => {
    const h = harness({ deps: { isNameFree: () => false, firstFreeName: () => 'Arm Chair' } })
    h.grid.open()
    assert.equal(h.grid.pick('ArmChair_01'), null)
    assert.equal(h.calls.addNode.length, 0)
    assert.match(h.grid.status, /No free name/)
    assert.equal(h.grid.statusKind, 'error')
  })

  test('a throwing addNode reports in the status line, and sends nothing else', () => {
    const h = harness({ deps: { addNode: () => { throw new Error('no socket') } } })
    h.grid.open()
    assert.equal(h.grid.pick('ArmChair_01'), null)
    assert.equal(h.calls.begin.length, 0)
    assert.match(h.grid.status, /no socket/)
  })

  test('the grid stays open after a successful pick (L27a)', () => {
    const h = harness()
    h.grid.open()
    h.grid.pick('ArmChair_01')
    assert.equal(h.grid.isOpen(), true)
  })
})

// ===========================================================================
// The answers (Z2)
// ===========================================================================

describe('onAnswer', () => {
  test('an open grid that owns the wait: accepted selects the node and clears the status', () => {
    const h = harness()
    h.grid.open()
    h.grid.pick('ArmChair_01')
    assert.equal(h.grid.onAnswer(42, 'accepted'), true)
    assert.deepEqual(h.calls.select, ['Arm Chair'])
    assert.equal(h.grid.status, null)
    assert.equal(h.grid.waiting, null)
    assert.equal(h.last().opts.enabled, true, 'the tiles are enabled again')
  })

  test('an open grid that owns the wait: a rejection shows in the GRID, not the generic error', () => {
    const h = harness()
    h.grid.open()
    h.grid.pick('ArmChair_01')
    assert.equal(h.grid.onAnswer(42, 'rejected', 'the name is already in use'), true)
    assert.equal(h.grid.status, 'the name is already in use')
    assert.equal(h.grid.statusKind, 'error')
    assert.deepEqual(h.calls.select, [], 'nothing is selected')
    assert.equal(libraryAnswerError(true, 'rejected', 'x'), null, 'and no generic error is shown')
  })

  test('an open grid that owns the wait: unknown says the world did not answer', () => {
    const h = harness()
    h.grid.open()
    h.grid.pick('ArmChair_01')
    assert.equal(h.grid.onAnswer(42, 'unknown'), true)
    assert.match(h.grid.status, /did not answer/)
    assert.equal(libraryAnswerError(true, 'unknown'), null)
  })

  test('a closed grid owns nothing: accepted selects NOTHING, and undo still has it', () => {
    const h = harness()
    h.grid.open()
    h.grid.pick('ArmChair_01')
    h.grid.close()
    assert.equal(h.grid.onAnswer(42, 'accepted'), false, 'the grid did not own this wait')
    assert.deepEqual(h.calls.select, [], 'a closed grid selects nothing')
    assert.equal(h.calls.register.length, 1, 'the undo registration stands')
    assert.equal(h.calls.begin.length, 1)
  })

  test('a closed grid owns nothing: rejected or unknown is the generic error', () => {
    const h = harness()
    h.grid.open()
    h.grid.pick('ArmChair_01')
    h.grid.close()
    assert.equal(h.grid.onAnswer(42, 'rejected', 'nope'), false)
    assert.match(libraryAnswerError(false, 'rejected', 'nope'), /Couldn’t add: nope/)
    assert.equal(h.grid.onAnswer(42, 'unknown'), false)
    assert.match(libraryAnswerError(false, 'unknown'), /did not answer/)
    assert.equal(libraryAnswerError(false, 'accepted'), null, 'an accepted closed add reports nothing')
  })

  test('a grid waiting on another seq owns nothing', () => {
    const h = harness()
    h.grid.open()
    h.grid.pick('ArmChair_01')
    assert.equal(h.grid.onAnswer(99, 'accepted'), false)
    assert.equal(h.grid.waiting, 42, 'the real wait is untouched')
  })
})

// ===========================================================================
// The form gate
// ===========================================================================

describe('the form gate', () => {
  test('opening the grid closes the Model form, and opening the Model form closes the grid', () => {
    const gate = createFormGate()
    const closed = []
    let modelOpen = false
    const grid = createLibraryGrid({ gate, name: 'library', deps: { catalog: () => CATALOG } })
    gate.register('library', () => { closed.push('library'); grid.close() })
    gate.register('model', () => { closed.push('model'); modelOpen = false })
    const openModelForm = () => { gate.claim('model'); modelOpen = true }

    grid.open()
    assert.equal(gate.current, 'library')
    assert.deepEqual(closed, [], 'nothing was open before it')

    openModelForm()
    assert.equal(grid.isOpen(), false, 'opening the Model form closes the grid')
    assert.deepEqual(closed, ['library'])

    grid.open()
    assert.equal(gate.current, 'library')
    assert.equal(modelOpen, false, 'opening the grid closes the Model form')
    assert.deepEqual(closed, ['library', 'model'])
  })

  test('closing the grid releases the gate', () => {
    const gate = createFormGate()
    const grid = createLibraryGrid({ gate, name: 'library', deps: { catalog: () => CATALOG } })
    grid.open()
    grid.close()
    assert.equal(gate.current, null)
    assert.equal(grid.isOpen(), false)
    assert.equal(grid.waiting, null)
  })

  test('reset() closes it (the reconnect path)', () => {
    const h = harness()
    h.grid.open()
    h.grid.pick('ArmChair_01')
    h.grid.reset()
    assert.equal(h.grid.isOpen(), false)
    assert.equal(h.grid.waiting, null)
    assert.equal(h.grid.status, null)
  })
})

// ===========================================================================
// The app.js wiring that only exists in the page
// ===========================================================================

describe('app.js wiring (read as a file)', () => {
  const source = readFileSync(resolve(__dirname, '../src/app.js'), 'utf-8')

  test('the request.library branch runs BEFORE the generic branches', () => {
    const library = source.indexOf('if (request.library)')
    const teleporter = source.indexOf('if (request.teleporter)')
    const generic = source.indexOf("if (removedMessage === 'show')", library)
    assert.ok(library > 0, 'the branch exists')
    assert.ok(teleporter > library, 'it comes before the teleporter branch')
    assert.ok(generic > library, 'it comes before the generic branches')
    assert.match(source.slice(library, teleporter), /return/, 'and it returns')
  })

  test('the branch routes through the grid and the shared error rule', () => {
    assert.match(source, /libraryGrid\?\.onAnswer\(seq, status, message\)/)
    assert.match(source, /libraryAnswerError\(owned, status, message\)/)
  })

  test('Escape closes the grid before the forms', () => {
    const escape = source.indexOf("e.key === 'Escape'")
    const gridClose = source.indexOf('if (libraryGrid?.isOpen())', escape)
    const modelClose = source.indexOf('if (modelForm.isOpen())', escape)
    assert.ok(gridClose > escape, 'the grid is closed on Escape')
    assert.ok(modelClose > gridClose, 'before the Model form')
  })

  test('the grid closes at every world boundary: Edit off, connecting, disconnected, beginNewWorld', () => {
    const closes = source.match(/libraryGrid[^\n]*close\(\)/g) ?? []
    assert.ok(closes.length >= 4, `expected the four world-boundary closes, found ${closes.length}`)
  })

  test('the Library button is hidden while the catalog has no models', () => {
    assert.match(source, /epLibrary\.style\.display = hasLibraryModels \? '' : 'none'/)
    assert.match(source, /libraryCatalog = EMPTY_CATALOG/)
  })

  test('the button joins the palette enable rule and opens the panel', () => {
    assert.match(source, /\[\.\.\.epPaletteBtns, epTeleporter, epModel, epLibrary\]/)
    assert.match(source, /epLibrary\?\.addEventListener\('click'/)
  })

  test('the grid re-reads the tile rule wherever the palette refreshes its buttons', () => {
    assert.match(source, /libraryGrid\?\.refresh\(\)/)
  })

  test('the catalog is loaded once, at startup', () => {
    assert.match(source, /loadCatalog\(\)\.then\(/)
  })
})
