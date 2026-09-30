// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import * as THREE from 'three'

const LABEL_HEIGHT_OFFSET = 2.2   // meters above somNode.translation (capsule is ~2m tall)

export class LabelOverlay {
  constructor(container, camera) {
    this._container  = container
    // Accept a getter function so callers can pass () => stage.camera for a live read
    this._getCamera  = typeof camera === 'function' ? camera : () => camera
    /** @type {Map<string, { div: HTMLDivElement, somNode: object, heightOffset: number }>} */
    this._labels     = new Map()
  }

  /**
   * Add a label for a SOM node.
   * @param {string} nodeName
   * @param {string} text — display text (textContent, never innerHTML)
   * @param {object} somNode
   * @param {object} [opts]
   * @param {number} [opts.heightOffset=2.2] — vertical offset in meters
   * @param {string} [opts.className] — optional CSS class for styling
   */
  addLabel(nodeName, text, somNode, { heightOffset = LABEL_HEIGHT_OFFSET, className } = {}) {
    const div = document.createElement('div')
    div.textContent = text
    Object.assign(div.style, {
      position:      'absolute',
      pointerEvents: 'none',
      transform:     'translate(-50%, -100%)',
      color:         '#fff',
      fontSize:      '12px',
      fontFamily:    "'Cascadia Code', 'Fira Code', monospace",
      background:    'rgba(0,0,0,0.6)',
      borderRadius:  '8px',
      padding:       '2px 8px',
      whiteSpace:    'nowrap',
    })
    if (className) {
      div.className = className
    }
    this._container.appendChild(div)
    this._labels.set(nodeName, { div, somNode, heightOffset })
  }

  removeLabel(nodeName) {
    const entry = this._labels.get(nodeName)
    if (!entry) return
    entry.div.remove()
    this._labels.delete(nodeName)
  }

  update() {
    const w = this._container.clientWidth
    const h = this._container.clientHeight
    for (const { div, somNode, heightOffset } of this._labels.values()) {
      const t   = somNode.translation ?? [0, 0, 0]
      const pos = new THREE.Vector3(t[0], t[1] + heightOffset, t[2])
      pos.project(this._getCamera())

      if (pos.z > 1) {
        div.style.display = 'none'
        continue
      }

      const x = ( pos.x * 0.5 + 0.5) * w
      const y = (-pos.y * 0.5 + 0.5) * h
      div.style.display = 'block'
      div.style.left    = x + 'px'
      div.style.top     = y + 'px'
    }
  }

  clear() {
    for (const { div } of this._labels.values()) div.remove()
    this._labels.clear()
  }

  /**
   * Remove all labels whose nodeName starts with a given prefix.
   * @param {string} prefix
   */
  removeLabelsByPrefix(prefix) {
    for (const [nodeName] of this._labels) {
      if (nodeName.startsWith(prefix)) {
        this.removeLabel(nodeName)
      }
    }
  }
}
