// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// behavior-clips.test.js — scripting-4b-2 round 5, V5.
//
// F4's `clipStatus`, from 4a's `modelAnimations.status(name)`. Round 4 answered
// `{ status: 'loaded' }` with no `clipIds` and said "the host's clip ids are not
// exposed to the page yet", so the form's picker was always a text box and the
// adapter's S7 clip check was inert. `status(name)` is `{ clips, state }`.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { clipsFor, CLIP_STATUS } from '../src/behavior-clips.js'

const modelNode = (name, { model = { url: 'a.glb' } } = {}) => ({
  name,
  extras: { atrium: (model ? { model } : {}) },
})

const world = (nodes, statuses = {}) => ({
  resolveObjectId: (id) => {
    const node = nodes.find((n) => n.name === id) ?? null
    return node ? { node } : { problem: 'not-found' }
  },
  modelAnimations: { status: (name) => statuses[name] },
})

test('V5 — no node gives `none`', () => {
  assert.deepEqual(clipsFor('missing', world([])), { status: CLIP_STATUS.none })
})

test('V5 — a node with no model on it gives `none`', () => {
  const w = world([modelNode('crate', { model: null })], { crate: { clips: ['Idle'], state: 'stopped' } })
  assert.deepEqual(clipsFor('crate', w), { status: CLIP_STATUS.none })
})

test('V5 — a 4a status of `loading` gives `loading`', () => {
  const w = world([modelNode('foz')], { foz: { clips: [], state: 'loading' } })
  assert.deepEqual(clipsFor('foz', w), { status: CLIP_STATUS.loading })
})

test('V5 — every other state gives `loaded` with 4a\'s clip ids', () => {
  for (const state of ['stopped', 'playing', 'ended', 'clip-missing']) {
    const w = world([modelNode('foz')], { foz: { clips: ['Idle', 'Walk'], state } })
    assert.deepEqual(clipsFor('foz', w), { status: CLIP_STATUS.loaded, clipIds: ['Idle', 'Walk'] }, state)
  }
})

test('V5 — `no-clips` is `loaded` with an EMPTY list (the picker keeps its text box)', () => {
  const w = world([modelNode('foz')], { foz: { clips: [], state: 'no-clips' } })
  assert.deepEqual(clipsFor('foz', w), { status: CLIP_STATUS.loaded, clipIds: [] })
})

test('V5 — a missing modelAnimations, or an unknown name, falls back to `none`', () => {
  assert.deepEqual(clipsFor('foz', { resolveObjectId: () => ({ node: modelNode('foz') }) }),
    { status: CLIP_STATUS.none })
  const w = world([modelNode('foz')], {})
  assert.deepEqual(clipsFor('foz', w), { status: CLIP_STATUS.none })
})
