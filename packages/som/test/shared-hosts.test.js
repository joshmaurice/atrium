// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// shared-hosts — Phase 3 server-cleanup, H12/L2: a camera and a light each
// shared by two host nodes. Remove one host, then the other; check the SOM
// lists, both aliases, the bare names, the maps and the serialized document at
// every step. Real glTF-Transform Documents and real SOMDocuments; no mocks.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Document, NodeIO } from '@gltf-transform/core'
import { KHRLightsPunctual } from '@gltf-transform/extensions'
import { SOMDocument } from '../src/SOMDocument.js'

// ---------------------------------------------------------------------------
// Fixture: one camera and one light, each hosted by nodes A and B.
// ---------------------------------------------------------------------------

function sharedHostsDoc() {
  const doc = new Document()
  const ext = doc.createExtension(KHRLightsPunctual)
  const scene = doc.createScene('Scene')

  const cam = doc.createCamera('SharedCam').setType('perspective')
    .setYFov(0.8).setZNear(0.1).setZFar(100)
  const light = ext.createLight('SharedLight').setType('directional').setIntensity(2)

  const a = doc.createNode('A').setCamera(cam).setExtension('KHR_lights_punctual', light)
  const b = doc.createNode('B').setCamera(cam).setExtension('KHR_lights_punctual', light)
  scene.addChild(a)
  scene.addChild(b)

  return { doc, cam, light }
}

async function serialize(doc) {
  const io = new NodeIO().registerExtensions([KHRLightsPunctual])
  const { json } = await io.writeJSON(doc)
  return json
}

/** Lights the KHR_lights_punctual extension still lists (attached or not). */
function extensionLights(root) {
  const out = []
  for (const extension of root.listExtensionsUsed()) {
    if (extension.extensionName !== 'KHR_lights_punctual') continue
    if (typeof extension.listProperties !== 'function') continue
    for (const p of extension.listProperties()) {
      if (p.propertyType === 'Light') out.push(p)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Load: two hosts, one shared camera, one shared light
// ---------------------------------------------------------------------------

test('H12: a camera and a light shared by two hosts register per host on load', () => {
  const { doc } = sharedHostsDoc()
  const som = new SOMDocument(doc)

  assert.equal(som.cameras.length, 2, 'one camera entry per host node')
  assert.equal(som.lights.length, 2, 'one light entry per host node')
  // The shared camera's wrapper is ONE object for both hosts.
  assert.equal(som.getObjectByName('A.camera'), som.getObjectByName('B.camera'))
  // Its qualified name and host name the last host that uses it (the
  // node-walk sets them per host, so the last one registered wins).
  assert.equal(som.cameras[0].qualifiedName, 'B.camera')
  assert.equal(som.cameras[0]._hostNode.name, 'B')
  // Lights get one wrapper per host (they are not shared objects), both
  // wrapping the same glTF light.
  const a = som.getObjectByName('A')
  const b = som.getObjectByName('B')
  assert.notEqual(a.light, b.light, 'each host has its own light wrapper')
  assert.equal(a.light._light, b.light._light, 'both wrap the same glTF light')
})

// ---------------------------------------------------------------------------
// Remove the first host
// ---------------------------------------------------------------------------

test('H12: after the first host goes, the shared camera and light live on under the survivor', async () => {
  const { doc, cam, light } = sharedHostsDoc()
  const som = new SOMDocument(doc)
  const a = som.getObjectByName('A')
  const b = som.getObjectByName('B')

  som.removeSubtree(a)

  // SOM lists: one entry per host, so exactly one is left for each.
  assert.equal(som.cameras.length, 1, 'one camera entry left (B)')
  assert.equal(som.lights.length, 1, 'one light entry left (B)')

  // Aliases: A's are gone, B's resolve; the shared camera moved to B.
  assert.equal(som.getObjectByName('A.camera'), null, "A's camera alias is gone")
  assert.equal(som.getObjectByName('A.light'), null, "A's light alias is gone")
  assert.equal(som.getObjectByName('B.camera'), som.cameras[0], "B.camera resolves")
  assert.equal(som.getObjectByName('B.light'), som.lights[0], "B.light resolves")
  assert.equal(som.cameras[0].qualifiedName, 'B.camera',
    "the shared camera's qualified name moves to the surviving host")
  assert.equal(som.cameras[0]._hostNode, b, 'and so does its host node')

  // Bare names: both still resolve (a light's bare name moves to the survivor).
  assert.equal(som.getObjectByName('SharedCam'), som.cameras[0], 'the bare camera name survives')
  assert.equal(som.getObjectByName('SharedLight'), som.lights[0],
    'the bare light name moves to the surviving host')

  // Maps.
  assert.equal(som._cameraMap.get(cam), som.cameras[0], '_cameraMap still holds it')
  assert.equal(som._lightMap.get(light), som.lights[0], '_lightMap moved to the survivor')

  // The glTF properties themselves are NOT disposed: B still uses them.
  assert.equal(doc.getRoot().listCameras().length, 1, 'the glTF camera survives')
  assert.equal(extensionLights(doc.getRoot()).length, 1, 'the glTF light survives')
  assert.equal(som.getNodeByName('A'), null)
  assert.equal(som.getNodeByName('B'), b)

  const json = await serialize(doc)
  assert.equal((json.cameras ?? []).length, 1, 'the serialized document writes the camera')
  assert.equal(json.extensions?.KHR_lights_punctual?.lights?.length, 1,
    'and the light')
  assert.equal((json.nodes ?? []).length, 1, 'only B is written')
})

// ---------------------------------------------------------------------------
// Remove both hosts
// ---------------------------------------------------------------------------

test('H12: after the last host goes, nothing is left anywhere', async () => {
  const { doc, cam, light } = sharedHostsDoc()
  const som = new SOMDocument(doc)

  som.removeSubtree(som.getObjectByName('A'))
  som.removeSubtree(som.getObjectByName('B'))

  assert.equal(som.cameras.length, 0, 'no camera entry left')
  assert.equal(som.lights.length, 0, 'no light entry left')
  for (const name of ['A.camera', 'B.camera', 'A.light', 'B.light', 'SharedCam', 'SharedLight']) {
    assert.equal(som.getObjectByName(name), null, `"${name}" is gone`)
  }
  assert.equal(som._cameraMap.get(cam), undefined, '_cameraMap is clean')
  assert.equal(som._lightMap.get(light), undefined, '_lightMap is clean')

  // L1 disposed the unreferenced glTF camera and light.
  assert.equal(doc.getRoot().listCameras().length, 0, 'the glTF camera went')
  assert.equal(extensionLights(doc.getRoot()).length, 0, 'the glTF light went')

  const json = await serialize(doc)
  assert.deepEqual(json.cameras ?? [], [], 'no camera in the output')
  assert.equal(json.extensions?.KHR_lights_punctual?.lights?.length ?? 0, 0,
    'no light in the output')
})

// ---------------------------------------------------------------------------
// Order: remove the host the qualified name names, then the survivor
// ---------------------------------------------------------------------------

test('H12: removing the qualified-name host first leaves the other addressable', () => {
  const { doc } = sharedHostsDoc()
  const som = new SOMDocument(doc)

  // The shared camera's qualified name names B (the last host registered).
  assert.equal(som.cameras[0].qualifiedName, 'B.camera')

  som.removeSubtree(som.getObjectByName('B'))

  assert.equal(som.cameras[0].qualifiedName, 'A.camera',
    'the qualified name follows the surviving host')
  assert.equal(som.getObjectByName('A.camera'), som.cameras[0])
  // A change through the surviving alias reaches the shared wrapper.
  som.setPath(som.cameras[0], 'yfov', 1.2)
  assert.equal(som.cameras[0].yfov, 1.2)

  som.removeSubtree(som.getObjectByName('A'))
  assert.equal(som.cameras.length, 0)
  assert.equal(som.getObjectByName('A.camera'), null)
})

// ---------------------------------------------------------------------------
// A camera hosted by one node only — unchanged 1a behaviour
// ---------------------------------------------------------------------------

test('H12: a single-host camera and light are cleaned up completely', () => {
  const doc = new Document()
  const ext = doc.createExtension(KHRLightsPunctual)
  const scene = doc.createScene('Scene')
  const cam = doc.createCamera('Cam').setType('perspective')
  const light = ext.createLight('Lamp').setType('point')
  scene.addChild(doc.createNode('Solo').setCamera(cam).setExtension('KHR_lights_punctual', light))
  scene.addChild(doc.createNode('Other'))

  const som = new SOMDocument(doc)
  assert.equal(som.cameras.length, 1)
  assert.equal(som.lights.length, 1)

  som.removeSubtree(som.getObjectByName('Solo'))

  assert.equal(som.cameras.length, 0)
  assert.equal(som.lights.length, 0)
  assert.equal(som.getObjectByName('Cam'), null)
  assert.equal(som.getObjectByName('Lamp'), null)
  assert.equal(doc.getRoot().listCameras().length, 0)
  assert.equal(extensionLights(doc.getRoot()).length, 0)
})

// ---------------------------------------------------------------------------
// A host that keeps its camera but whose light is shared onward
// ---------------------------------------------------------------------------

test('H12: a light shared onward keeps its bare name on the survivor after two removals', () => {
  const { doc, light } = sharedHostsDoc()
  const som = new SOMDocument(doc)
  const bLight = som.getObjectByName('B').light

  som.removeSubtree(som.getObjectByName('A'))
  assert.equal(som._lightMap.get(light), bLight, 'the map follows the survivor')
  assert.equal(som.getObjectByName('SharedLight'), bLight, 'and so does the bare name')
})
