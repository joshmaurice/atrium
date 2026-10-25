// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// strict-element.mjs — V12 (scripting-4b-2 round 5): ONE element stand-in,
// shared by the form and panel tests that build elements.
//
// The round-4 fake was more lenient than a real page in exactly the places
// §1.2's items 1, 2 and 4 hid in:
//  - `dataset` was a plain writable property, so `field.dataset = { … }` —
//    which throws `TypeError` on a real `DOMStringMap` — passed silently and
//    the form's render never failed in a test;
//  - `style` and `classList` were writable too, while in the DOM they are
//    getter-only (`el.style.display = …` is fine; `el.style = …` is not);
//  - a `<button>` carried `checked` and fired `change`, neither of which a
//    button does — so the form's `change`/`.checked` listener on Enabled
//    looked as though it worked.
//
// The rules here, which the round-5 wiring guard mirrors over `apps/client/src`:
//  - `dataset`, `style` and `classList` are GETTER-ONLY, so assigning any of
//    them throws `TypeError` (test modules run in strict mode);
//  - the objects they return are live, as in the DOM;
//  - `checked` exists only on an `<input>` whose `type` is `checkbox` or
//    `radio`;
//  - `change` dispatches only on those inputs, and a `<button>` dispatches
//    `click` (and nothing else).

const CHECKABLE = new Set(['checkbox', 'radio'])

/** True for an `<input type="checkbox">` / `<input type="radio">`. */
export function isCheckable(node) {
  return node?.tagName === 'input' && CHECKABLE.has(node.type)
}

function getterOnly(node, name, value) {
  Object.defineProperty(node, name, {
    get: () => value,
    enumerable: true,
    configurable: true,
    // No setter: assigning the property itself throws in strict mode, exactly
    // as `element.dataset = …` does in Chromium.
  })
}

/**
 * A strict element stand-in.
 * @param {string} [tag]
 */
export function el(tag = 'div') {
  const listeners = {}
  const style = {}
  const dataset = {}
  const classes = new Set()
  const node = {
    tagName: tag,
    children: [],
    value: '',
    disabled: false,
    selected: false,
    type: '',
    title: '',
    _text: '',
    _checked: false,
    appendChild(child) {
      node.children.push(child)
      node.firstChild = node.children[0] ?? null
      return child
    },
    removeChild(child) {
      node.children = node.children.filter((c) => c !== child)
      node.firstChild = node.children[0] ?? null
      return child
    },
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn) },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn) },
    /**
     * V12 — `change` reaches a listener only on a checkbox or radio input; a
     * `<button>` dispatches `click` only. A disabled control fires nothing, as
     * in the browser. Everything else passes through, as the old fake did.
     */
    dispatch(type, event) {
      if (node.disabled) return
      if (type === 'change' && !isCheckable(node)) return
      for (const fn of listeners[type] ?? []) fn(event ?? { target: node })
    },
    /** How many listeners of a type are registered (the guards read this). */
    listenerCount(type) { return (listeners[type] ?? []).length },
  }

  getterOnly(node, 'style', style)
  getterOnly(node, 'dataset', dataset)
  getterOnly(node, 'classList', {
    add: (...names) => names.forEach((n) => classes.add(n)),
    remove: (...names) => names.forEach((n) => classes.delete(n)),
    contains: (n) => classes.has(n),
    toggle: (n) => (classes.has(n) ? (classes.delete(n), false) : (classes.add(n), true)),
  })
  Object.defineProperty(node, 'textContent', {
    get: () => node._text,
    set: (value) => { node._text = String(value ?? '') },
    enumerable: true,
    configurable: true,
  })
  // V12 — `checked` exists only on a checkbox or radio input.
  Object.defineProperty(node, 'checked', {
    get() {
      if (!isCheckable(node)) throw new TypeError('checked is only on a checkbox or radio input')
      return node._checked
    },
    set(value) {
      if (!isCheckable(node)) throw new TypeError('checked is only on a checkbox or radio input')
      node._checked = Boolean(value)
    },
    enumerable: true,
    configurable: true,
  })
  return node
}

/** The element set every Behaviour-section test builds. */
export function elementsFor() {
  return {
    row: el(), select: el('select'), params: el(), actions: el(),
    enabled: el('button'), save: el('button'), remove: el('button'),
    status: el(), note: el(), hint: el(), logLines: el(), log: el(),
  }
}
