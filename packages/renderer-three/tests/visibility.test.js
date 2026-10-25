// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// visibility.test.js — scripting-4b-2 step 5, F6. Plain three.js objects and a
// stub DocumentView: no renderer, no WebGL, no DOM.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'

import {
  hasInvisibleAncestor, visibleHits, firstVisibleHit, setNodeVisible, applyVisibility, listViewObjects,
} from '../src/visibility.js'
import { PointerInputBridge } from '../src/PointerInputBridge.js'

/** A fake `docView` in DocumentView's shape: `listViews(source)` → objects. */
function fakeDocView(map) {
  return { listViews: (source) => map.get(source) ?? [] }
}

describe('F6 — the hit filter takes the NEXT visible hit (S10)', () => {
  test('a hidden object in front of a visible one returns the visible one', () => {
    const hidden = new THREE.Mesh()
    hidden.visible = false
    const visible = new THREE.Mesh()
    const hits = [{ object: hidden, distance: 1 }, { object: visible, distance: 2 }]
    assert.equal(firstVisibleHit(hits).object, visible)
  })

  test('an object under a hidden PARENT is hidden too', () => {
    const parent = new THREE.Object3D()
    parent.visible = false
    const child = new THREE.Mesh()
    parent.add(child)
    assert.equal(hasInvisibleAncestor(child), true)
    assert.equal(firstVisibleHit([{ object: child }]), null)
  })

  test('includeHidden returns the first hit as it is (Edit mode, F-L8)', () => {
    const hidden = new THREE.Mesh()
    hidden.visible = false
    const visible = new THREE.Mesh()
    const hits = [{ object: hidden }, { object: visible }]
    assert.equal(firstVisibleHit(hits, { includeHidden: true }).object, hidden)
  })

  test('no hits at all is null, not a throw', () => {
    assert.equal(firstVisibleHit([]), null)
    assert.equal(firstVisibleHit(undefined), null)
  })

  test('visibleHits returns the whole filtered list, in order', () => {
    const hidden = new THREE.Mesh(); hidden.visible = false
    const a = new THREE.Mesh()
    const b = new THREE.Mesh()
    const hits = [{ object: hidden }, { object: a }, { object: b }]
    assert.deepEqual(visibleHits(hits).map((h) => h.object), [a, b])
    assert.deepEqual(visibleHits(hits, { includeHidden: true }).map((h) => h.object), [hidden, a, b])
    assert.deepEqual(visibleHits(undefined), [])
  })
})

describe('F6 — the node\'s view object is the ONE visibility path', () => {
  test('setNodeVisible writes Object3D.visible on the node\'s view object', () => {
    const node = { _node: { getName: () => 'crate' }, visible: false }
    const object = new THREE.Mesh()
    const docView = fakeDocView(new Map([[node._node, [object]]]))
    assert.equal(setNodeVisible(docView, node, false), 1)
    assert.equal(object.visible, false)
    assert.equal(setNodeVisible(docView, node, true), 1)
    assert.equal(object.visible, true)
  })

  test('a placed model\'s wrapper, as the host object\'s child, inherits the state', () => {
    const node = { _node: {}, visible: false }
    const hostObject = new THREE.Mesh()
    const wrapper = new THREE.Object3D()          // model-bridge's wrapper
    hostObject.add(wrapper)
    const docView = fakeDocView(new Map([[node._node, [hostObject]]]))
    setNodeVisible(docView, node, false)
    assert.equal(wrapper.visible, true, 'the bridge never touches the wrapper')
    assert.equal(hasInvisibleAncestor(wrapper), true, 'three inherits the host\'s state')
  })

  test('applyVisibility seeds every node from the SOM at view creation', () => {
    const shown = { _node: {}, visible: true }
    const hidden = { _node: {}, visible: false }
    const a = new THREE.Mesh()
    const b = new THREE.Mesh()
    const docView = fakeDocView(new Map([[shown._node, [a]], [hidden._node, [b]]]))
    assert.equal(applyVisibility(docView, { nodes: [shown, hidden] }), 2)
    assert.equal(a.visible, true)
    assert.equal(b.visible, false)
  })

  test('a node with no view object yet is a no-op, not a throw', () => {
    assert.deepEqual(listViewObjects(fakeDocView(new Map()), {}), [])
    assert.equal(setNodeVisible({}, {}, false), 0)
    assert.equal(applyVisibility(null, { nodes: [{ visible: false }] }), 0)
  })
})

describe('F6 — the pointer bridge filters, and Edit mode can still reach a hidden object', () => {
  const stubCanvas = () => ({
    addEventListener() {}, removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
  })

  function bridge(hits) {
    const client = { som: { getNodeByName: () => null } }
    const instance = new PointerInputBridge({
      client, canvas: stubCanvas(), camera: new THREE.PerspectiveCamera(), sceneRoot: new THREE.Scene(),
      resolveSOMNode: (object) => object.userData.node ?? null,
    })
    instance._raycaster = { setFromCamera() {}, ray: { origin: new THREE.Vector3(), direction: new THREE.Vector3() }, intersectObject: () => hits }
    return instance
  }

  test('outside Edit mode the bridge skips a hidden hit and takes the next visible one', () => {
    const hidden = new THREE.Mesh(); hidden.visible = false; hidden.userData.node = { name: 'hidden' }
    const visible = new THREE.Mesh(); visible.userData.node = { name: 'visible' }
    const resolved = bridge([{ object: hidden }, { object: visible }])._hitTest({ clientX: 1, clientY: 1 })
    assert.equal(resolved.node.name, 'visible')
  })

  test('with includeHidden the bridge takes the hidden hit', () => {
    const hidden = new THREE.Mesh(); hidden.visible = false; hidden.userData.node = { name: 'hidden' }
    const visible = new THREE.Mesh(); visible.userData.node = { name: 'visible' }
    const resolved = bridge([{ object: hidden }, { object: visible }])._hitTest({ clientX: 1, clientY: 1 }, { includeHidden: true })
    assert.equal(resolved.node.name, 'hidden')
  })

  test('every hit hidden is null, not the hidden hit', () => {
    const hidden = new THREE.Mesh(); hidden.visible = false; hidden.userData.node = { name: 'hidden' }
    assert.equal(bridge([{ object: hidden }])._hitTest({ clientX: 1, clientY: 1 }), null)
  })
})
