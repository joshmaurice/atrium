// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * model-animation-panel.js — the Edit panel's clip controls (Phase 3 step 4a, Z7).
 *
 * Pure logic only: which text, which control is enabled, and the exact value a
 * Play or a Stop writes. No DOM, no three.js — `app.js` owns the elements and
 * passes them in through `deps`, so a test drives the whole control with plain
 * values (the sky-picker pattern).
 *
 * ONE WRITE AT A TIME, PER NODE (L7): a write's wait belongs to its own seq AND
 * its own SOM node. If the owner selects another model while the answer is out,
 * the late answer re-enables nothing on the new selection and shows no error
 * against it — the new selection's controls were never disabled by the old
 * write, and the answer still lands on its own node through the SOM.
 */

/** Z5/Z2a — the node extras leaf these controls write. */
export const MODEL_ANIMATION_FIELD = 'extras.atrium.animation'

/** L7 — the value Play writes. The server stamps `startedAt` (Z2). */
export function playValue({ clip, loop = false } = {}) {
  return { clip, playing: true, loop: Boolean(loop), speed: 1, startedAt: 0 }
}

/** L7 — the value Stop writes: `null` means stopped (Z2). */
export function stopValue() {
  return null
}

/**
 * Z7 — the panel's whole visible state for a selected model node.
 *
 * @param {object} args
 * @param {{state: string, clips: string[]}} args.status  Z5's `status(name)`
 * @param {object|null} args.value    the stored `extras.atrium.animation` value
 * @param {string|null} args.clip     the clip the select shows
 * @param {boolean} args.loop         the Loop checkbox
 * @param {boolean} args.waiting      a write for THIS node is in flight
 * @returns {{state, clips, clip, loop, waiting, text, clipEnabled, loopEnabled,
 *            playEnabled, stopEnabled}}
 */
export function panelState({ status = null, value = null, clip = null, loop = false, waiting = false } = {}) {
  const clips = [...(status?.clips ?? [])]
  const state = status?.state ?? 'loading'
  const saved = value?.clip ?? null
  const chosen = clips.includes(clip) ? clip : (clips.includes(saved) ? saved : (clips[0] ?? null))
  const enabled = !waiting && clips.length > 0

  return {
    state,
    clips,
    clip: chosen,
    loop: Boolean(loop),
    waiting: Boolean(waiting),
    text: animationStatusText(state, saved),
    clipEnabled: enabled,
    loopEnabled: enabled,
    // L7 — Play is offered when stopped or ended, and Stop when playing or ended.
    playEnabled: enabled && (state === 'stopped' || state === 'ended'),
    stopEnabled: enabled && (state === 'playing' || state === 'ended'),
  }
}

/** Z7/L7 — the one place a status becomes a line of text, always as text. */
export function animationStatusText(state, savedClip = null) {
  switch (state) {
    case 'no-clips':     return 'No animations'
    case 'loading':      return 'Animations: loading'
    case 'clip-missing': return `Clip '${savedClip ?? ''}' not found in this model`
    case 'ended':        return 'Played'
    case 'playing':      return 'Playing'
    case 'stopped':      return 'Stopped'
    default:             return ''
  }
}

/**
 * Z7 — the controls themselves.
 *
 * @param {object} args
 * @param {object} [args.deps]
 * @param {() => object|null} [args.deps.selected]              the selected SOM node
 * @param {(name: string) => object} [args.deps.status]         Z5's `status(name)`
 * @param {(name: string, value: object|null) => number} [args.deps.write]
 *                                    `client.setModelAnimation`, returning the seq
 * @param {(panel: object|null) => void} [args.deps.render]     app.js writes the row
 * @param {(text: string) => void} [args.deps.showError]        the edit error line
 */
export function createAnimationControls({ deps = {} } = {}) {
  /** seq -> the SOM node the write was sent for (one write at a time, per node). */
  const inFlight = new Map()
  /** The owner's choice for the selected node: the select and the Loop box. */
  const choice = { node: null, clip: null, loop: false }

  const selected = () => deps.selected?.() ?? null

  function specOf(node) {
    return node?.extras?.atrium?.model ?? null
  }

  function statusOf(node) {
    return deps.status?.(node?.name) ?? { clips: [], state: 'loading' }
  }

  /** The wait is THIS node's, never the panel's: see the module header. */
  function waitingFor(node) {
    for (const target of inFlight.values()) if (target === node) return true
    return false
  }

  /** Re-read the choice when the selection changes, or when the SOM moves under it. */
  function syncChoice(node, status, value) {
    if (choice.node !== node) {
      choice.node = node
      choice.clip = value?.clip ?? status.clips[0] ?? null
      choice.loop = value?.loop === true
    }
    // While PLAYING, the stored value is the truth; while stopped, what the owner
    // picked is (L7: the choice is only remembered until Play).
    if (value && value.playing === true) {
      choice.clip = status.clips.includes(value.clip) ? value.clip : choice.clip
      choice.loop = value.loop === true
    }
  }

  function render() {
    const node = selected()
    const spec = specOf(node)
    if (!node || !spec) {
      choice.node = null
      deps.render?.(null)
      return
    }
    const status = statusOf(node)
    const value = node.extras?.atrium?.animation ?? null
    syncChoice(node, status, value)
    deps.render?.(panelState({
      status,
      value,
      clip: choice.clip,
      loop: choice.loop,
      waiting: waitingFor(node),
    }))
  }

  /** Z7 — the one place a write starts. Returns the seq, or null. */
  function write(node, value) {
    if (!node || waitingFor(node)) return null
    let seq
    try {
      seq = deps.write?.(node.name, value)
    } catch (error) {
      deps.showError?.(`Couldn’t play: ${error?.message ?? error}`)
      return null
    }
    if (typeof seq !== 'number') return null
    inFlight.set(seq, node)
    render()
    return seq
  }

  /** The select: while playing this is a new playing value (the server re-stamps). */
  function change(clip) {
    const node = selected()
    if (!node) return null
    choice.node = node
    choice.clip = clip
    const value = node.extras?.atrium?.animation ?? null
    if (value && value.playing === true) return write(node, playValue({ clip, loop: choice.loop }))
    render()
    return null
  }

  /** The Loop box: the same rule as the select. */
  function setLoop(loop) {
    const node = selected()
    if (!node) return null
    choice.node = node
    choice.loop = Boolean(loop)
    const value = node.extras?.atrium?.animation ?? null
    if (value && value.playing === true) return write(node, playValue({ clip: choice.clip, loop: choice.loop }))
    render()
    return null
  }

  /** Play restarts the chosen clip; the server stamps `startedAt`. */
  function play() {
    const node = selected()
    if (!node) return null
    if (!choice.clip) return null
    return write(node, playValue({ clip: choice.clip, loop: choice.loop }))
  }

  /** Stop returns the model to its rest pose. */
  function stop() {
    const node = selected()
    if (!node) return null
    return write(node, stopValue())
  }

  /** A world change: every wait and the remembered choice go with it. */
  function reset() {
    inFlight.clear()
    choice.node = null
    choice.clip = null
    choice.loop = false
    render()
  }

  /** Z6/Z7 — refresh the row after a SOM change or a selection change. */
  function refresh() { render() }

  return {
    refresh,
    reset,
    change,
    setLoop,
    play,
    stop,
    /** The three answers. A seq this control does not own is ignored (L7). */
    onAccepted(seq) {
      if (!inFlight.has(seq)) return false
      inFlight.delete(seq)
      render()
      return true
    },
    onRejected(seq, message) {
      const node = inFlight.get(seq)
      if (!node) return false
      inFlight.delete(seq)
      // The reason goes to the edit error line, and ONLY when the node it was
      // sent for is still the selection.
      if (node === selected()) deps.showError?.(message || 'the animation was refused')
      render()
      return true
    },
    onUnknown(seq) {
      if (!inFlight.has(seq)) return false
      inFlight.delete(seq)
      render()
      return true
    },
    get waiting() { return inFlight.size },
    get choice() { return { ...choice } },
  }
}
