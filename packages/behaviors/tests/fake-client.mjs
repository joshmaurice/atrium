// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// fake-client.mjs — F5's client port and SOM, in memory. Not a test file.

import { OWN, TGT } from './fake-world.mjs'

export const OWN2 = OWN
export const TGT2 = TGT
export const THIRD = '33333333-3333-4333-8333-333333333333'

let counter = 0
const nextId = () => `${String(++counter).padStart(8, '0')}-0000-4000-8000-000000000000`

/**
 * A node in the fake SOM. `atrium` is the node's `extras.atrium`.
 */
export function makeNode({ name, id = null, behavior, ephemeral = false, parent = null, light = null } = {}) {
  const node = {
    name,
    parent,
    translation: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    visible: true,
    light,
    extras: { atrium: { ...(id ? { objectId: id } : {}), ...(behavior === undefined ? {} : { behavior }), ...(ephemeral ? { ephemeral: true } : {}) } },
  }
  return node
}

/** The client port: events, role flags, and the two tracked send calls. */
export function makeFakeClient({ nodes = [] } = {}) {
  const listeners = new Map()
  const sent = []
  const animations = []
  const som = {
    nodes,
    getNodeByName: (name) => nodes.find((n) => n.name === name) ?? null,
    resolveObjectId: (id) => {
      const hits = nodes.filter((n) => n.extras?.atrium?.objectId === id)
      if (hits.length === 0) return { problem: 'not-found' }
      if (hits.length > 1) return { problem: 'ambiguous' }
      return { node: hits[0], objectId: id, name: hits[0].name }
    },
  }
  const client = {
    som,
    scriptHost: { active: false, hostGen: null },
    canEdit: false,
    sent,
    animations,
    on(type, fn) { (listeners.get(type) ?? listeners.set(type, []).get(type)).push(fn) },
    off(type, fn) { const list = listeners.get(type) ?? []; const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1) },
    emit(type, payload) { for (const fn of [...(listeners.get(type) ?? [])]) fn(payload) },
    sendField(name, field, value) { sent.push({ call: 'sendField', name, field, value }); return sent.length },
    setModelAnimation(name, value) { animations.push({ name, value }); return animations.length },
  }
  return client
}

export { nextId }
