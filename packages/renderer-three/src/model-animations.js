// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * model-animations.js — playing a placed model's own clips (Phase 3 step 4a, Z5).
 *
 * A model's clips are already built and retargeted to its instance by identity
 * (A7, `model-instances.js`) and nothing plays them: the models-by-url round kept
 * them at the rest pose on purpose, because autoplay would be per viewer and
 * unsynced. This layer plays them from the SYNCED state in
 * `extras.atrium.animation`, so every session shows the same frame.
 *
 * Three things matter here, and each is a rule in the brief:
 *
 *   - **The mixer belongs to the INSTANCE, never to the node name.** A record is
 *     keyed by name, and a name is reused when a node is removed and another is
 *     added under it, so everything here holds the instance OBJECT. An event for
 *     an instance that is not the current one for its name is ignored.
 *   - **The time is SET from the clock every frame**, then `mixer.update(0)`.
 *     Nothing accumulates: a background tab, a slow frame and a late joiner all
 *     show the frame the world's state asks for.
 *   - **Stop is `action.stop()` alone.** The mixer restores each binding's saved
 *     original value, which is the loaded rest pose. `reset()` + `update(0)`
 *     would show the clip's frame 0 instead (P12).
 *
 * `AnimationMixer` is used directly, NOT the world's `AnimationBridge`: that
 * bridge belongs to the world file's own animations and stops a finished clip in
 * every client, which is exactly the flaw 4a avoids (L6, §9.5).
 */

import { AnimationMixer, LoopOnce } from 'three'
import { clipIds, clipTime, isPlaying } from '@atrium/client/animation-spec'

/** Z5 — the states `status(name)` reports to the Edit panel. */
export const ANIMATION_STATE = Object.freeze({
  loading:      'loading',
  stopped:      'stopped',
  playing:      'playing',
  ended:        'ended',
  clipMissing:  'clip-missing',
  noClips:      'no-clips',
})

/** A deep comparison of two stored animation values (Z5's idempotent `set`). */
function sameValue(a, b) {
  if (a === b) return true
  if (a == null || b == null) return false
  if (typeof a !== 'object' || typeof b !== 'object') return false
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) if (a[key] !== b[key]) return false
  return true
}

/**
 * Z5 — the model-animation layer.
 *
 * @param {object} args
 * @param {object} [args.bridge]  the model bridge; its three lifecycle callbacks are
 *                                wired to this layer's `onInstance*` methods
 * @param {() => number} [args.now]  the SERVER's clock (`() => client.serverNow()`)
 * @returns {object}  `set`, `rename`, `clear`, `update`, `status`, the three
 *                    `onInstance*` callbacks, and the `mixerFor`/`actionFor` seams
 */
export function createModelAnimations({ bridge = null, now = () => Date.now() } = {}) {
  /** The wanted value per model node name. `null` = stopped. */
  const wanted = new Map()
  /** One entry per live INSTANCE object (never per name). */
  const entries = new Map()
  /** The current instance per node name, so a late event for an old one is ignored. */
  const current = new Map()

  const serverNow = () => (typeof now === 'function' ? now() : now)

  // ── entries ──────────────────────────────────────────────────────────────

  function makeEntry(name, node, instance) {
    return {
      name,
      node,
      instance,
      root: instance?.scene ?? null,
      mixer: new AnimationMixer(instance.scene),
      clips: instance.clips ?? [],
      clipIndices: instance.clipIndices ?? [],
      // The FILE's animation names, in file order: every id exists even when no
      // clip was built for it (P13), so a drop is `clip-missing` and never a
      // shifted index.
      ids: clipIds(instance.animationNames ?? []),
      action: null,
      actionClipId: null,
      actionStartedAt: null,
      stopped: true,
    }
  }

  /** Z5 — the retained clip an L8 id names, or null when it was dropped. */
  function resolveClip(entry, clipId) {
    const at = entry.ids.findIndex((candidate) => candidate.id === clipId)
    if (at < 0) return null
    const fileIndex = entry.ids[at].index
    const position = entry.clipIndices.indexOf(fileIndex)
    if (position < 0) return null
    return { id: clipId, index: fileIndex, clip: entry.clips[position] }
  }

  /** The entry for `name`, when its instance is still the current one. */
  function entryForName(name) {
    const instance = current.get(name)
    if (!instance) return null
    const entry = entries.get(instance)
    return entry && entry.name === name ? entry : null
  }

  /**
   * Z5 — Stop: `action.stop()` ALONE. The mixer restores each binding's saved
   * original value (the loaded rest pose) as the action deactivates. Nothing is
   * done when there is nothing to stop, or when the action is already stopped —
   * "already stopped" is what makes a repeated `update()` free.
   */
  function stopEntry(entry) {
    if (!entry.action || entry.stopped) return
    entry.action.stop()
    entry.stopped = true
  }

  /**
   * Z5 — put the instance's action on `resolved`. The action is kept when it
   * already targets the same clip at the same `startedAt` (a value that changed
   * only its `loop`/`speed` re-reads them, which `update` does anyway); anything
   * else re-targets, and so restarts.
   */
  function targetAction(entry, value, resolved) {
    if (entry.action &&
        entry.actionClipId === resolved.id &&
        entry.actionStartedAt === value.startedAt) return
    if (entry.action) {
      entry.action.stop()
      entry.action = null
      entry.stopped = true
    }
    const action = entry.mixer.clipAction(resolved.clip)
    // Every action is LoopOnce with clamping: the mixer's own looping and its
    // `finished` event are never relied on — the clock decides, every frame.
    action.setLoop(LoopOnce, 1)
    action.clampWhenFinished = true
    action.play()
    entry.action = action
    entry.actionClipId = resolved.id
    entry.actionStartedAt = value.startedAt
    entry.stopped = false
  }

  /** One frame of one entry: the stop, or the clip's time and `mixer.update(0)`. */
  function stepEntry(entry) {
    const value = wanted.get(entry.name) ?? null
    if (!isPlaying(value)) {
      stopEntry(entry)
      return false
    }
    const resolved = resolveClip(entry, value.clip)
    if (!resolved) {
      stopEntry(entry)
      return false
    }
    targetAction(entry, value, resolved)
    const { time } = clipTime({
      value,
      duration: entry.action.getClip().duration,
      nowServer: serverNow(),
    })
    entry.action.time = time
    entry.mixer.update(0)
    return true
  }

  // ── the API ──────────────────────────────────────────────────────────────

  /**
   * Z5 — the wanted value for a model node. A deep-equal value changes NOTHING:
   * no new action, no mixer change, no restart (review 7).
   *
   * @param {string} name
   * @param {object|null} value  the stored value, or `null` for stopped
   */
  function set(name, value) {
    if (typeof name !== 'string' || name.length === 0) return
    const next = value == null ? null : value
    if (wanted.has(name) && sameValue(wanted.get(name), next)) return
    wanted.set(name, next)
    const entry = entryForName(name)
    // A value that arrives before the instance exists is applied the moment
    // `onInstanceCreated` makes one; a value for a live instance is applied now.
    if (entry) stepEntry(entry)
  }

  /** Z6 — a rename moves the node's wanted value and re-points its entry. */
  function rename(from, to) {
    if (typeof to !== 'string' || to.length === 0 || from === to) return
    const value = wanted.get(from) ?? null
    wanted.delete(from)
    wanted.set(to, value)

    const instance = current.get(from)
    if (instance) {
      current.delete(from)
      current.set(to, instance)
      const entry = entries.get(instance)
      if (entry) entry.name = to
      const live = entryForName(to)
      if (live) stepEntry(live)
    }
  }

  /** Z6 — forget everything (a world change, a disconnect, a reset). */
  function clear() {
    for (const entry of entries.values()) stopEntry(entry)
    entries.clear()
    current.clear()
    wanted.clear()
  }

  /**
   * Z5 — one frame, called by the app's frame loop before `stage.tick(dt)`.
   * Only an entry that is playing and has a live instance costs anything.
   */
  function update() {
    for (const entry of entries.values()) stepEntry(entry)
  }

  /**
   * Z5 — what the Edit panel shows for a model node: its L8 clip ids and one of
   * `loading` | `stopped` | `playing` | `ended` | `clip-missing` | `no-clips`.
   */
  function status(name) {
    const entry = entryForName(name)
    if (!entry) return { clips: [], state: ANIMATION_STATE.loading }
    const clips = entry.ids.map((candidate) => candidate.id)
    if (clips.length === 0) return { clips, state: ANIMATION_STATE.noClips }

    const value = wanted.get(entry.name) ?? null
    if (!isPlaying(value)) return { clips, state: ANIMATION_STATE.stopped }
    const resolved = resolveClip(entry, value.clip)
    if (!resolved) return { clips, state: ANIMATION_STATE.clipMissing }

    const { ended } = clipTime({
      value,
      duration: resolved.clip.duration,
      nowServer: serverNow(),
    })
    return { clips, state: ended ? ANIMATION_STATE.ended : ANIMATION_STATE.playing }
  }

  // ── the bridge's three lifecycle events (Z5) ─────────────────────────────

  /** Z5.1 — a NEW instance: a mixer of its own, with the wanted value applied at once. */
  function onInstanceCreated({ name, node, instance } = {}) {
    if (!instance) return
    const previous = current.get(name)
    if (previous && previous !== instance) {
      const stale = entries.get(previous)
      if (stale) { stopEntry(stale); entries.delete(previous) }
    }
    current.set(name, instance)
    const entry = makeEntry(name, node ?? null, instance)
    entries.set(instance, entry)
    stepEntry(entry)
  }

  /**
   * Z5.2 — a view's detach/attach: the SAME instance is re-hosted, so nothing is
   * disposed or restarted. The mixer and its action stay; the next `update()`
   * sets the time as usual. An event for an instance that is not the current one
   * for that name is ignored.
   */
  function onInstanceRehosted({ name, instance } = {}) {
    if (!instance) return
    if (current.get(name) !== instance) return
    if (!entries.has(instance)) return
  }

  /**
   * Z5.3 — the instance is about to be disposed: the action stops and the
   * mixer's bindings are uncached, so the clips and skeletons the bridge frees
   * next are not still referenced by a mixer.
   */
  function onInstanceDisposing({ name, instance } = {}) {
    if (!instance) return
    const entry = entries.get(instance)
    if (entry) {
      stopEntry(entry)
      entry.mixer.uncacheRoot(entry.root ?? instance.scene)
      entry.action = null
      entries.delete(instance)
    }
    if (current.get(name) === instance) current.delete(name)
  }

  /** Z5 — a diagnostic seam: the live mixer for a model node, if it has one. */
  function mixerFor(name) {
    return entryForName(name)?.mixer ?? null
  }

  /** Z5 — a diagnostic seam: the node's current action, if it has one. */
  function actionFor(name) {
    return entryForName(name)?.action ?? null
  }

  return {
    set,
    rename,
    clear,
    update,
    status,
    onInstanceCreated,
    onInstanceRehosted,
    onInstanceDisposing,
    mixerFor,
    actionFor,
    get wanted() { return wanted },
    get size() { return entries.size },
  }
}
