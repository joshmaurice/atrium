// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { includeKeyProblem, includeMapProblem, itemIdProblem, remoteUrlProblem } from '../lib/keys.mjs'

const entry = (name) => ({ url: `https://dl.polyhaven.org/file/${name}`, size: 1, md5: '0'.repeat(32) })

test('include keys: ordinary relative paths pass', () => {
  for (const k of ['ArmChair_01.bin', 'textures/Armchair_01_diff_1k.jpg', 'a/b/c-d.e_f.png']) {
    assert.equal(includeKeyProblem(k), null, k)
  }
})

test('include keys: every escape and odd form is refused', () => {
  const cases = {
    '../x': 'dot segment', 'a/../x': 'dot segment', './x': 'dot segment', '/abs': 'absolute',
    '/etc/passwd': 'absolute', 'a//b': 'empty segment', 'a/': 'empty segment', 'a\\b': 'backslash',
    '%2e%2e/x': 'percent', 'a%2Fb': 'percent', 'a b': 'bad characters', 'a:b': 'bad characters',
    '': 'bad length', ['x'.repeat(600)]: 'bad length',
  }
  for (const [k, why] of Object.entries(cases)) assert.equal(includeKeyProblem(k), why, k)
  assert.equal(includeKeyProblem(null), 'not a string')
})

test('include map: a key duplicated in another case is refused', () => {
  assert.match(includeMapProblem({ 'textures/A.jpg': entry('a'), 'textures/a.jpg': entry('b') }), /duplicate/)
  assert.equal(includeMapProblem({ 'textures/A.jpg': entry('a'), 'textures/B.jpg': entry('b') }), null)
})

test('include map: each entry is checked (url host, size, md5)', () => {
  assert.match(includeMapProblem({ 'a.bin': { ...entry('a'), url: 'https://evil.example/a.bin' } }), /host not allowed/)
  assert.match(includeMapProblem({ 'a.bin': { ...entry('a'), size: -1 } }), /bad size/)
  assert.match(includeMapProblem({ 'a.bin': { ...entry('a'), md5: 'nothex' } }), /bad md5/)
  assert.match(includeMapProblem({ '../a.bin': entry('a') }), /dot segment/)
  assert.match(includeMapProblem([]), /not an object/)
})

test('remote URLs: https to the three Poly Haven hosts only', () => {
  assert.equal(remoteUrlProblem('https://api.polyhaven.com/info/x'), null)
  assert.equal(remoteUrlProblem('https://dl.polyhaven.org/file/x'), null)
  assert.equal(remoteUrlProblem('https://cdn.polyhaven.com/x.png?width=256'), null)
  assert.match(remoteUrlProblem('http://dl.polyhaven.org/x'), /not https/)
  assert.match(remoteUrlProblem('https://dl.polyhaven.org.evil.example/x'), /host not allowed/)
  assert.match(remoteUrlProblem('https://127.0.0.1/x'), /host not allowed/)
  assert.match(remoteUrlProblem('https://169.254.169.254/latest'), /host not allowed/)
  assert.match(remoteUrlProblem('https://user:pw@dl.polyhaven.org/x'), /credentials/)
  assert.match(remoteUrlProblem('https://dl.polyhaven.org:8443/x'), /port/)
  assert.match(remoteUrlProblem('file:///etc/passwd'), /not https/)
  assert.match(remoteUrlProblem(42), /not a string/)
})

test('item ids', () => {
  assert.equal(itemIdProblem('ArmChair_01'), null)
  for (const bad of ['', '../x', 'a b', 'a-b', 'x'.repeat(65), null]) assert.notEqual(itemIdProblem(bad), null, String(bad))
})
