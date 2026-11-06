// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// add-node-boundaries — add-check round 2 (REVISION-add-check-round-2.md, R4 and
// R5). The exact-boundary cases too large for the shared vectors file, and the
// lengths-first rule, each run through BOTH copies of the rule: the server's
// `checkAddNode` and the client's `add-spec.js`.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { checkAddNode as serverCheck } from '../src/send-policy.js'
import { checkAddNode as clientCheck } from '../../client/src/add-spec.js'

const COPIES = [['server', serverCheck], ['client', clientCheck]]

/** A flat POSITION of `n` vertices, every value finite. */
function positions(n) {
  const out = new Array(n * 3)
  for (let i = 0; i < n; i++) { out[i * 3] = i % 7; out[i * 3 + 1] = (i % 11) / 10; out[i * 3 + 2] = 0 }
  return out
}
/** `count` indices (a multiple of 3), each below `vertices`, ending at `last`. */
function indices(count, vertices, last = vertices - 1) {
  const out = new Array(count)
  for (let i = 0; i < count; i++) out[i] = i % vertices
  out[count - 1] = last
  return out
}
const mesh = (prim) => ({ primitives: [prim] })

/**
 * An array whose length is real but whose elements throw when read. A rule
 * that reads an element before every length and key set is checked fails.
 */
function untouchable(length) {
  const target = new Array(length).fill(0)
  return new Proxy(target, {
    get(t, p, r) {
      if (typeof p === 'string' && /^\d+$/.test(p)) throw new Error(`element ${p} was read`)
      if (p === Symbol.iterator) return function* () { throw new Error('the array was iterated') }
      return Reflect.get(t, p, r)
    },
  })
}

for (const [copy, check] of COPIES) {
  describe(`${copy}: exact boundaries (S3)`, () => {
    test('an avatar of exactly 1,024 vertices and 6,144 indices is accepted', () => {
      const node = { name: 'User-abcd', mesh: mesh({ attributes: { POSITION: positions(1024) }, indices: indices(6144, 1024) }) }
      assert.equal(check(node, { avatar: true }), null)
    })
    test('an avatar of 1,025 vertices is refused', () => {
      const node = { name: 'User-abcd', mesh: mesh({ attributes: { POSITION: positions(1025) }, indices: indices(6144, 1025) }) }
      assert.equal(check(node, { avatar: true }).code, 'avatar-vertices')
    })
    test('an avatar of 6,147 indices is refused', () => {
      const node = { name: 'User-abcd', mesh: mesh({ attributes: { POSITION: positions(1024) }, indices: indices(6147, 1024) }) }
      assert.equal(check(node, { avatar: true }).code, 'avatar-indices')
    })
    test('a world primitive of exactly 65,535 vertices with index 65,534 is accepted', () => {
      const node = { name: 'a', mesh: mesh({ attributes: { POSITION: positions(65535) }, indices: indices(3, 65535, 65534) }) }
      assert.equal(check(node), null)
    })
    test('a world primitive of 65,536 vertices is refused', () => {
      const node = { name: 'a', mesh: mesh({ attributes: { POSITION: positions(65536) }, indices: indices(3, 65536, 65534) }) }
      assert.equal(check(node).code, 'position-length')
    })
    test('an index of 65,535 is refused even with 65,535 vertices', () => {
      const node = { name: 'a', mesh: mesh({ attributes: { POSITION: positions(65535) }, indices: indices(3, 65535, 65535) }) }
      assert.equal(check(node).code, 'indices-value')
    })
  })

  describe(`${copy}: lengths and key sets before any element is read (S2)`, () => {
    const ok = { attributes: { POSITION: [0, 0, 0, 1, 0, 0, 0, 1, 0] } }
    test('a bad indices length is refused without reading POSITION or NORMAL', () => {
      const n = 3000
      const node = { name: 'a', mesh: mesh({ attributes: { POSITION: untouchable(n * 3), NORMAL: untouchable(n * 3) }, indices: [0, 1] }) }
      assert.equal(check(node).code, 'indices-length')
    })
    test('an avatar index budget is refused without reading POSITION', () => {
      const node = { name: 'User-abcd', mesh: mesh({ attributes: { POSITION: untouchable(300) }, indices: untouchable(6147) }) }
      assert.equal(check(node, { avatar: true }).code, 'avatar-indices')
    })
    test("a later primitive's bad key is refused without reading an earlier primitive's values", () => {
      const first = { attributes: { POSITION: untouchable(3000) }, indices: untouchable(30) }
      const node = { name: 'a', mesh: { primitives: [first, ok, { ...ok, bogus: 1 }] } }
      assert.equal(check(node).code, 'primitive-keys')
    })
    test("a later primitive's bad material is refused without reading an earlier primitive's values", () => {
      const first = { attributes: { POSITION: untouchable(2997) } }   // 999 vertices, unindexed: a valid shape
      const node = { name: 'a', mesh: { primitives: [first, { ...ok, material: { pbrMetallicRoughness: { metallicFactor: 7 } } }] } }
      assert.equal(check(node).code, 'material-value')
    })
  })
}

describe('the two copies agree on every generated case', () => {
  test('server and client return the same code', () => {
    const cases = [
      [{ name: 'a', mesh: mesh({ attributes: { POSITION: positions(65535) }, indices: indices(3, 65535, 65534) }) }, false],
      [{ name: 'a', mesh: mesh({ attributes: { POSITION: positions(65536) } }) }, false],
      [{ name: 'User-abcd', mesh: mesh({ attributes: { POSITION: positions(1024) }, indices: indices(6144, 1024) }) }, true],
      [{ name: 'User-abcd', mesh: mesh({ attributes: { POSITION: positions(1025) } }) }, true],
    ]
    for (const [node, avatar] of cases) {
      assert.equal(serverCheck(node, { avatar })?.code ?? null, clientCheck(node, { avatar })?.code ?? null)
    }
  })
})
