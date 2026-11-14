// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// dom-write.js — small-fixes R4: write a DOM property only when it changes.
//
// The Edit panel's refresh runs on every `som:set`, and a behaviour that turns
// an object sends one a frame. Writing every button's `disabled` and `title`
// each time, with the same values, rewrote the whole panel about 35 times a
// second (the operator saw "Move to" flicker). With this, a refresh whose
// answer is unchanged touches nothing.

/**
 * Set `element[property]` to `value` unless it already holds it. A dotted
 * property (`'style.display'`) reaches one level in.
 *
 * @param {object|null|undefined} element
 * @param {string} property  e.g. 'disabled', 'title', 'textContent', 'style.display'
 * @param {*} value
 * @returns {boolean} true when it wrote
 */
export function setIfChanged(element, property, value) {
  if (!element) return false
  let target = element
  let key = property
  const dot = property.indexOf('.')
  if (dot > 0) {
    target = element[property.slice(0, dot)]
    key = property.slice(dot + 1)
    if (!target) return false
  }
  // Compare as the DOM will store it: a string property keeps String(value)
  // (`title = null` stores "null"), and `textContent = null` stores ''.
  let next = value
  if (key === 'textContent' && value == null) next = ''
  else if (typeof target[key] === 'string' && typeof value !== 'string') next = String(value)
  if (target[key] === next) return false
  target[key] = value
  return true
}
