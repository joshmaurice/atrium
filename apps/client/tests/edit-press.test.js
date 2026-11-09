// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// edit-press.test.js — selection-parts T17 (PREBRIEF-selection-parts.md §4;
// SP-L8 (a), SP-L11 (a)): a press on a move handle is a click until the
// pointer travels 4 px, and the second press of a double-click never drags.
// The events arrive as in Chromium: a capture-phase pointerdown (position),
// the handles' own pointerdown (grab), mousedown (the click count), pointer
// moves, each followed by the handles' change, then the release.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createHandlePress } from '../src/edit-press.js'
import { CLICK_SLOP_PX } from '../src/edit-selection.js'

function pressAt(p, { x = 100, y = 100, detail = 1 } = {}) {
  p.down({ x, y })
  p.grab()
  p.count(detail)
}

describe('T17: a short press on a handle', () => {
  test('no travel: every change is put back, and the release is a click', () => {
    const p = createHandlePress()
    pressAt(p)
    assert.equal(p.change(), 'put-back')
    assert.deepEqual(p.release(), { click: true, handle: true })
  })
  test('2 px of travel: still put back, still a click', () => {
    const p = createHandlePress()
    pressAt(p)
    p.move({ x: 101, y: 102 })
    assert.equal(p.change(), 'put-back')
    p.move({ x: 102, y: 100 })
    assert.equal(p.change(), 'put-back')
    assert.deepEqual(p.release(), { click: true, handle: true })
  })
  test(`the slop is ${CLICK_SLOP_PX} px: just under is put back, at it begins`, () => {
    const p = createHandlePress()
    pressAt(p)
    p.move({ x: 100 + CLICK_SLOP_PX - 0.01, y: 100 })
    assert.equal(p.change(), 'put-back')
    p.move({ x: 100 + CLICK_SLOP_PX, y: 100 })
    assert.equal(p.change(), 'begin')
  })
  test('one 30 px move (a fast drag): the first change begins, and the release is no click', () => {
    const p = createHandlePress()
    pressAt(p)
    p.move({ x: 130, y: 100 })
    assert.equal(p.change(), 'begin')
    p.begin()
    assert.equal(p.change(), 'drag')
    p.move({ x: 140, y: 100 })
    assert.equal(p.change(), 'drag')
    assert.deepEqual(p.release(), { click: false, handle: true })
  })
  test('a begin the app refused (a block) is asked again on the next change', () => {
    const p = createHandlePress()
    pressAt(p)
    p.move({ x: 130, y: 100 })
    assert.equal(p.change(), 'begin')        // the app is blocked: puts back, no begin()
    p.move({ x: 135, y: 100 })
    assert.equal(p.change(), 'begin')
    assert.deepEqual(p.release(), { click: true, handle: true })
  })
  test('the pointer is read from move(), never from the press', () => {
    const p = createHandlePress()
    pressAt(p, { x: 50, y: 50 })
    assert.equal(p.change(), 'put-back')     // no move yet: the press position
    p.move({ x: 50, y: 60 })
    assert.equal(p.change(), 'begin')
  })
})

describe('T17: the second press of a double-click (SP-L11)', () => {
  test('detail 2 and 6 px of travel: put back throughout, and a click', () => {
    const p = createHandlePress()
    pressAt(p, { detail: 2 })
    p.move({ x: 106, y: 100 })
    assert.equal(p.change(), 'put-back')
    p.move({ x: 140, y: 100 })
    assert.equal(p.change(), 'put-back')
    assert.deepEqual(p.release(), { click: true, handle: true, forced: true })
  })
  test('detail 3 too', () => {
    const p = createHandlePress()
    pressAt(p, { detail: 3 })
    p.move({ x: 160, y: 100 })
    assert.equal(p.change(), 'put-back')
  })
  test('a fresh press after it drags normally', () => {
    const p = createHandlePress()
    pressAt(p, { detail: 2 })
    p.release()
    pressAt(p, { detail: 1 })
    p.move({ x: 120, y: 100 })
    assert.equal(p.change(), 'begin')
  })
})

describe('T17/T18: reset mid-press (Escape, a removal, the session end)', () => {
  test('reset before travel: the release is no click (the press is spent)', () => {
    const p = createHandlePress()
    pressAt(p)
    p.reset()
    assert.deepEqual(p.release(), { click: false, handle: false })
  })
  test('reset mid-drag: the release is no click, and the next press starts afresh', () => {
    const p = createHandlePress()
    pressAt(p)
    p.move({ x: 130, y: 100 })
    p.change(); p.begin()
    p.reset()
    assert.deepEqual(p.release(), { click: false, handle: false })
    pressAt(p)
    assert.equal(p.change(), 'put-back')
  })
  test('a release with no press seen is no click', () => {
    const p = createHandlePress()
    assert.deepEqual(p.release(), { click: false, handle: false })
  })
  test('a change with no press seen behaves as before T17 (begins at once)', () => {
    const p = createHandlePress()
    assert.equal(p.change(), 'begin')
  })
  test('a press that never grabbed a handle is no handle press', () => {
    const p = createHandlePress()
    p.down({ x: 1, y: 1 }); p.count(1)
    assert.equal(p.grabbed(), false)
    assert.deepEqual(p.release(), { click: false, handle: false })
  })
})
