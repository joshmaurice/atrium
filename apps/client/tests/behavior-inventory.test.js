// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// behavior-inventory.test.js — scripting-4b-2 round 3 (T1), the inventory guard.
//
// The round-2 review found the class of bug this file exists for: the form
// COMPUTED the `select-light` help sentence, tested it, and rendered it
// NOWHERE — `elements.hint` defaulted to null in app.js and no such element
// was in index.html. So: every user-facing string the spec, C2 and the two
// revisions name for the Behaviour section and the host line must have a
// RENDERED HOME — an element whose id is in index.html AND that app.js hands
// to the code that writes it. A string with no home fails this guard, by name.
//
// Two kinds of writer:
//   - `form`: `behavior-form.js` writes the string into the element app.js
//     passes it as (checked behaviourally — the form is driven through every
//     template and every status and the element's received text is recorded);
//   - `app.js`: app.js itself writes it, through a call the row names.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createBehaviorForm, CUSTOM_LABEL, NONE_LABEL, UNDO_NOTE, HINT_TEXT, HINT_LIGHT_ON,
  HINT_ONE_CLICK, HINT_CLIP_END, NO_LIGHTS, BEHAVIOR_STATUS,
} from '../src/behavior-form.js'
import { TEMPLATE_IDS, TEMPLATE_LABELS } from '@atrium/behaviors/templates'
import { HOST_THIS_TAB, hostStatusText } from '../src/host-status.js'
// V12 (round 5) — ONE strict element fake, shared with behavior-form.test.js.
import { el } from './strict-element.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const appSource = readFileSync(resolve(__dirname, '../src/app.js'), 'utf-8')
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf-8')

/**
 * app.js with its whole-line `//` comments dropped. A guard that read the raw
 * text would be satisfied by a COMMENTED-OUT wire — and a commented-out wire
 * passes nothing. (Only lines that START with `//` are dropped, so a `//`
 * inside a string literal, e.g. a URL, is untouched.)
 */
const appCode = appSource.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')

const OWN = '11111111-1111-4111-8111-111111111111'
const TGT = '22222222-2222-4222-8222-222222222222'
const OTHER = '33333333-3333-4333-8333-333333333333'

// ── app.js's wiring, read as text ─────────────────────────────────────────

/** The `elements: { … }` block app.js hands to `createBehaviorForm`. */
const FORM_BLOCK = appCode.match(/createBehaviorForm\(\{([\s\S]*?)\n\}\)/)?.[1] ?? ''

/**
 * `id → { name, key }` for every `const name = document.getElementById('id')`
 * in app.js; `key` is the `elements` key that name is handed to inside the
 * form's block, or null when the form is not the writer.
 */
function wiring() {
  const map = new Map()
  for (const m of appCode.matchAll(/const (\w+)\s*=\s*document\.getElementById\('([^']+)'\)/g)) {
    const [, name, id] = m
    map.set(id, { name, key: FORM_BLOCK.match(new RegExp(`(\\w+):\\s*${name}\\b`))?.[1] ?? null })
  }
  return map
}

// ── a tiny element stand-in, and the form driven over every case ──────────

// V12 (round 5) — the ONE strict element fake, shared with
// behavior-form.test.js: `dataset`, `style` and `classList` are getter-only,
// `checked`/`change` exist only on a checkbox or radio input, and a button
// dispatches `click` only.

function makeNode({ name, id = null, model = null, light = null } = {}) {
  return {
    name,
    light,
    extras: { atrium: { ...(id ? { objectId: id } : {}), ...(model ? { model } : {}) } },
  }
}

/**
 * Drive the form through every template, "Custom graph", "None", and every
 * status, twice (a world with a light and a world without), and return
 * `element id → Set of every text that reached it`.
 *
 * The elements are the ones app.js actually wires, keyed the way app.js keys
 * them, so a string the form computes but no wired element receives is simply
 * absent from the result — which is exactly what the guard needs to see.
 */
function driven() {
  const seen = new Map()
  const elements = {}
  const keyToId = new Map()
  for (const [id, { key }] of wiring()) {
    if (!key) continue
    elements[key] = el(key === 'select' ? 'select' : 'div')
    keyToId.set(key, id)
  }
  const capture = () => {
    for (const [key, node] of Object.entries(elements)) {
      const id = keyToId.get(key)
      if (!node) continue          // the form defaults an unwired element to null
      if (!seen.has(id)) seen.set(id, new Set())
      const set = seen.get(id)
      if (node.textContent) set.add(node.textContent)
      for (const child of node.children ?? []) if (child.textContent) set.add(child.textContent)
    }
  }

  const withLight = [
    makeNode({ name: 'crate', id: OWN }),
    makeNode({ name: 'foz', id: TGT, model: { url: 'a.glb' } }),
    makeNode({ name: 'Sun', id: OTHER, light: { intensity: 2 } }),
  ]
  const noLight = [
    makeNode({ name: 'crate', id: OWN }),
    makeNode({ name: 'foz', id: TGT, model: { url: 'a.glb' } }),
  ]
  const statuses = [
    {}, { state: 'running' }, { state: 'idle' }, { state: 'saving' },
    { state: 'other-tab' }, { state: 'disabled', reason: 'behavior-kind' },
  ]

  for (const nodes of [withLight, noLight]) {
    for (const status of statuses) {
      let current = nodes[0]
      let seq = 0
      const deps = {
        selected: () => current,
        nodes: () => nodes,
        status: () => status,
        write: { setObjectId: () => ++seq, sendField: () => ++seq },
        newObjectId: () => '99999999-9999-4999-8999-999999999999',
        createElement: (tag) => el(tag),
        showError: () => {}, clearError: () => {}, logLines: () => [],
      }
      const form = createBehaviorForm({ elements, deps })
      form.open(nodes[0])
      capture()
      for (const id of TEMPLATE_IDS) { form.onTemplateChange(id); capture() }
      form.onTemplateChange(CUSTOM_LABEL); capture()
      form.onTemplateChange(NONE_LABEL); capture()

      // "Save cancelled" (M4) needs a sequence the form has moved on from:
      // save, change the selection, then let the answer arrive.
      form.open(nodes[0])
      form.onTemplateChange('select-visibility')
      form.save()
      current = nodes[1]
      form.open(nodes[1])
      form.onAnswer('edit:accepted', { seq })
      capture()
    }
  }
  return seen
}

const SEEN = driven()

// ── the inventory ─────────────────────────────────────────────────────────

/**
 * Every user-facing string the spec (F4, F6, F8, F9, E8), C2 and the two
 * revisions name for the Behaviour section and the host line, with the
 * element id it must land in and who writes it there.
 *
 * `writer: 'form'` rows are checked behaviourally against `SEEN`;
 * `writer: 'app.js'` rows name the call in app.js that writes them.
 */
const INVENTORY = [
  // F9 — the picker: "None", the five display names, "Custom graph".
  { string: NONE_LABEL, element: 'ep-behavior-template', writer: 'app.js', call: /epBehaviorTemplate\.appendChild\(option\(NONE_LABEL, NONE_LABEL\)\)/ },
  ...TEMPLATE_IDS.map((id) => ({
    string: TEMPLATE_LABELS[id],
    element: 'ep-behavior-template',
    writer: 'app.js',
    call: /epBehaviorTemplate\.appendChild\(option\(id, TEMPLATE_LABELS\[id\]\)\)/,
  })),
  { string: CUSTOM_LABEL, element: 'ep-behavior-template', writer: 'app.js', call: /epBehaviorTemplate\.appendChild\(option\(CUSTOM_LABEL, CUSTOM_LABEL\)\)/ },

  // F9 — the status line.
  { string: BEHAVIOR_STATUS.running, element: 'ep-behavior-status', writer: 'form' },
  { string: 'Disabled: ', element: 'ep-behavior-status', writer: 'form' },
  { string: BEHAVIOR_STATUS.idle, element: 'ep-behavior-status', writer: 'form' },
  { string: BEHAVIOR_STATUS.otherTab, element: 'ep-behavior-status', writer: 'form' },
  { string: BEHAVIOR_STATUS.saving, element: 'ep-behavior-status', writer: 'form' },
  { string: BEHAVIOR_STATUS.cancelled, element: 'ep-behavior-status', writer: 'form' },

  // F9 — the D4 sentence, once, under the status line.
  { string: UNDO_NOTE, element: 'ep-behavior-note', writer: 'form' },

  // F8, F4, R1 (C2) — the help lines, and the picker's no-lights sentence.
  { string: HINT_TEXT, element: 'ep-behavior-hint', writer: 'form' },
  { string: HINT_LIGHT_ON, element: 'ep-behavior-hint', writer: 'form' },
  { string: HINT_ONE_CLICK, element: 'ep-behavior-hint', writer: 'form' },
  { string: HINT_CLIP_END, element: 'ep-behavior-hint', writer: 'form' },
  { string: NO_LIGHTS, element: 'ep-behavior-hint', writer: 'form' },

  // E8 — the host line.
  { string: HOST_THIS_TAB, element: 'ep-host-status', writer: 'app.js', call: /epHostStatus\.textContent = hostStatusText\(/ },
]

describe('scripting-4b-2 r3 (T1) — every named string has a rendered home', () => {
  for (const row of INVENTORY) {
    test(`"${row.string}" → #${row.element}`, () => {
      // 1. The element exists in the page.
      assert.ok(html.includes(`id="${row.element}"`), `#${row.element} is not in index.html`)

      // 2. app.js binds it, and the writer is handed it.
      const bound = wiring().get(row.element)
      assert.ok(bound, `app.js does not bind #${row.element}`)
      if (row.writer === 'form') {
        assert.ok(bound.key, `app.js does not pass #${row.element} to createBehaviorForm`)
        assert.match(FORM_BLOCK, new RegExp(`${bound.key}:\\s*${bound.name}\\b`), `elements.${bound.key}`)
        // 3. The form writes it there — observed, not asserted from source.
        const texts = SEEN.get(row.element) ?? new Set()
        assert.ok(
          [...texts].some((t) => t.includes(row.string)),
          `the form never writes "${row.string}" into #${row.element}; it wrote: ${[...texts].join(' | ')}`,
        )
      } else {
        // 3. app.js writes it there, through the named call (comments don't count).
        assert.match(appCode, row.call, `app.js has no writer for "${row.string}" into #${row.element}`)
      }
    })
  }
})

describe('scripting-4b-2 r3 (T1) — the inventory covers what the contract names', () => {
  const strings = INVENTORY.map((r) => r.string)

  test('the five display names and "Custom graph" are in it', () => {
    for (const id of TEMPLATE_IDS) assert.ok(strings.includes(TEMPLATE_LABELS[id]), id)
    assert.ok(strings.includes(CUSTOM_LABEL))
  })

  test('the host line is the one host-status.js produces for the host', () => {
    assert.equal(hostStatusText({ connected: true, canEdit: true, scriptHost: { active: true } }), HOST_THIS_TAB)
    assert.ok(strings.includes(HOST_THIS_TAB))
  })

  test('nothing in the inventory is empty, and every element is a real page id', () => {
    for (const row of INVENTORY) {
      assert.ok(row.string.length > 0, `${row.element} has an empty string`)
      assert.ok(html.includes(`id="${row.element}"`), `#${row.element}`)
    }
  })
})
