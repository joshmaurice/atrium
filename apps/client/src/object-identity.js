// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * object-identity.js — E7 (scripting-4b-1). Pure: no DOM, no three.js, no fetch.
 *
 * Every NEW object gets a permanent `extras.atrium.objectId`. The descriptor
 * handed to `add` is the only place to put it, so one helper stamps it:
 *
 *   - the palette add, the Model form's, the teleporter form's and the library's
 *     `addNode` deps, and Duplicate all pass through here;
 *   - the palette RETRY and Undo's and redo's re-adds do NOT — they bring back
 *     the same object, so a behaviour that names it keeps working (E-L2).
 */

import { newObjectId } from '@atrium/client/object-id'

function isPlainObject(v) {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

/**
 * A COPY of `descriptor` whose `extras.atrium.objectId` is a new id, creating
 * `extras` and `atrium` if needed. Every other key is kept exactly as it is, and
 * the input is never mutated.
 *
 * @param {object} descriptor          a glTF node descriptor for `add`
 * @param {() => string} [newId]       the id source (defaults to `newObjectId`)
 * @returns {object}
 */
export function withNewObjectId(descriptor, newId = newObjectId) {
  const source = isPlainObject(descriptor) ? descriptor : {}
  const extras = { ...(isPlainObject(source.extras) ? source.extras : {}) }
  const atrium = { ...(isPlainObject(extras.atrium) ? extras.atrium : {}) }
  atrium.objectId = newId()
  extras.atrium = atrium
  return { ...source, extras }
}
