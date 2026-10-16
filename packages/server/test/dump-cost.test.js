// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// dump-cost — Phase 3 server-cleanup, L3's cost note (review #9): the time and
// peak heap for 20 consecutive dumps of space-ext.gltf and of the largest
// fixture, against the same numbers at the base. Not a gate; the numbers go in
// the handoff so a later round can decide whether a cached dump is needed.
//
// Heavy file, kept on its own (operator requirement 1). Real worlds, no mocks.
// The measured numbers are printed to stdout so the handoff can quote them.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { statSync } from 'node:fs'
import { createWorld } from '../src/world.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES = resolve(__dirname, '../../../tests/fixtures')

/** The largest glTF fixture in the repo (the one a save/dump costs most on). */
function largestFixture() {
  const names = [
    'atrium.gltf', 'space-anim-autoplay.gltf', 'space-anim.gltf',
    'space.gltf', 'space-lights.gltf', 'space-cameras.gltf', 'space-ext.gltf',
  ]
  let best = null
  for (const name of names) {
    const path = resolve(FIXTURES, name)
    const size = statSync(path).size
    if (!best || size > best.size) best = { name, path, size }
  }
  return best
}

function peakHeapSample() {
  global.gc?.()
  return process.memoryUsage().heapUsed
}

/**
 * 20 consecutive dumps of a world, timing each and tracking the peak heap the
 * dumps leave behind. The world is created once, as a newcomer's som-dump sees
 * it; each iteration dumps and throws the result away.
 */
async function measureDumps(world, iterations = 20) {
  const times = []
  const heap0 = process.memoryUsage().heapUsed
  let peak = heap0

  for (let i = 0; i < iterations; i += 1) {
    const start = process.hrtime.bigint()
    const json = await world.serialize()
    const end = process.hrtime.bigint()
    times.push(Number(end - start) / 1e6)
    assert.ok(json && typeof json === 'object', 'the dump returns a document')
    const used = process.memoryUsage().heapUsed
    if (used > peak) peak = used
  }

  const sorted = [...times].sort((a, b) => a - b)
  return {
    iterations,
    totalMs: times.reduce((a, b) => a + b, 0),
    meanMs: times.reduce((a, b) => a + b, 0) / times.length,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    medianMs: sorted[Math.floor(sorted.length / 2)],
    heapBeforeMb: heap0 / 1048576,
    peakHeapMb: peak / 1048576,
    peakDeltaMb: (peak - heap0) / 1048576,
  }
}

const report = (label, size, m) => {
  process.stdout.write(
    `\nL3 cost — ${label} (${size} bytes): 20 dumps, ` +
    `total ${m.totalMs.toFixed(1)} ms, mean ${m.meanMs.toFixed(2)} ms, ` +
    `median ${m.medianMs.toFixed(2)} ms, min ${m.minMs.toFixed(2)} ms, ` +
    `max ${m.maxMs.toFixed(2)} ms; ` +
    `heap before ${m.heapBeforeMb.toFixed(1)} MB, peak ${m.peakHeapMb.toFixed(1)} MB ` +
    `(delta ${m.peakDeltaMb.toFixed(1)} MB)\n`)
}

test('L3 cost: 20 consecutive dumps of space-ext.gltf (with external content)', async () => {
  const path = resolve(FIXTURES, 'space-ext.gltf')
  const world = await createWorld(path)
  await world.resolveExternalReferences()
  const size = statSync(path).size
  const m = await measureDumps(world)
  report('space-ext.gltf', size, m)
  assert.equal(m.iterations, 20)
  assert.ok(m.totalMs > 0)
})

test('L3 cost: 20 consecutive dumps of the largest fixture', async () => {
  const { name, path, size } = largestFixture()
  const world = await createWorld(path)
  const m = await measureDumps(world)
  report(`largest fixture ${name}`, size, m)
  assert.equal(m.iterations, 20)
  assert.ok(m.totalMs > 0)
})
