// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, mkdir, symlink, chmod, stat, cp, appendFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run } from '../build.mjs'
import { createFakePolyHaven } from './fake-polyhaven.mjs'

const SCRIPT = fileURLToPath(new URL('../install-library.sh', import.meta.url))
const isRoot = process.getuid?.() === 0
const opts = { skip: isRoot ? false : 'install-library.sh needs root' }

let built = null
/** One real staging directory, built once and copied per test. */
async function stagingCopy() {
  if (!built) {
    const dir = await mkdtemp(join(tmpdir(), 'libinst-src-'))
    const items = join(dir, 'items.json')
    await writeFile(items, JSON.stringify({ models: [{ id: 'Box_01', name: 'Box', category: 'Misc' }], skies: [{ id: 'Sky_01', name: 'Sky' }] }))
    const fake = await createFakePolyHaven({ models: ['Box_01'], skies: ['Sky_01'] })
    built = join(dir, 'stage')
    assert.equal(await run(['--out', built, items], { fetchFn: fake.fetchFn, log: () => {} }), 0)
  }
  const root = await mkdtemp(join(tmpdir(), 'libinst-'))
  const staging = join(root, 'staging')
  await cp(built, staging, { recursive: true })
  const work = join(root, 'work')
  await mkdir(work, { mode: 0o700 })
  return { root, staging, target: join(root, 'library'), work, catalog: JSON.parse(await readFile(join(built, 'catalog.json'), 'utf8')) }
}

function install(s, { env = {}, cwd = '/', args = null } = {}) {
  const r = spawnSync('bash', [SCRIPT, ...(args ?? ['--target', s.target, '--work', s.work, s.staging])], {
    cwd, env: { PATH: process.env.PATH, ...env }, encoding: 'utf8',
  })
  return { code: r.status, out: r.stdout, err: r.stderr }
}

test('a fresh install: every file root-owned 0644, the catalog kept, URLs listed', opts, async () => {
  const s = await stagingCopy()
  const r = install(s)
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /OK 4 files \(4 new, 0 already present\)/)
  for (const sub of ['', 'models', 'skies', 'thumbs']) {
    const st = await stat(join(s.target, sub))
    assert.equal(st.uid, 0); assert.equal(st.mode & 0o777, 0o755)
  }
  const glb = s.catalog.models[0].url.slice(16)
  const st = await stat(join(s.target, glb))
  assert.equal(st.uid, 0); assert.equal(st.mode & 0o777, 0o644)
  assert.match(r.out, new RegExp(`/assets/library/${glb.replace('.', '\\.')}`))
  const kept = /catalog: (\S+)/.exec(r.out)[1]
  assert.ok(kept.startsWith(s.work + '/catalog-'))
  assert.equal(await readFile(kept, 'utf8'), await readFile(join(s.staging, 'catalog.json'), 'utf8'))
})

test('a second run installs nothing and passes', opts, async () => {
  const s = await stagingCopy()
  assert.equal(install(s).code, 0)
  const r = install(s)
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /OK 4 files \(0 new, 4 already present\)/)
})

test('a destination already present with different content STOPS with an error', opts, async () => {
  const s = await stagingCopy()
  assert.equal(install(s).code, 0)
  await appendFile(join(s.target, s.catalog.models[0].url.slice(16)), 'changed')
  const r = install(s)
  assert.equal(r.code, 1)
  assert.match(r.err, /already exists with DIFFERENT content/)
})

test('a symlink in staging is refused', opts, async () => {
  const s = await stagingCopy()
  await symlink('/etc/passwd', join(s.staging, 'thumbs', 'evil.webp'))
  const r = install(s)
  assert.equal(r.code, 1)
  assert.match(r.err, /not a file or directory: thumbs\/evil\.webp/)
})

test('a file the catalog does not name, or an unexpected directory, is refused', opts, async () => {
  const s = await stagingCopy()
  await writeFile(join(s.staging, 'models', 'extra.glb'), 'x')
  let r = install(s)
  assert.equal(r.code, 1)
  assert.match(r.err, /files the catalog does not name: models\/extra\.glb/)
  const t = await stagingCopy()
  await mkdir(join(t.staging, 'other'))
  r = install(t)
  assert.equal(r.code, 1)
  assert.match(r.err, /unexpected directory in staging: other/)
})

test('a catalog path that escapes, by any spelling, is refused', opts, async () => {
  for (const bad of ['/assets/library/models/../../x-0123456789ab.glb', '/assets/library/%2e%2e/x.glb', '/etc/passwd', '/assets/library/models/x-0123456789ab.glb/../../y']) {
    const s = await stagingCopy()
    const c = structuredClone(s.catalog)
    c.models[0].url = bad
    await writeFile(join(s.staging, 'catalog.json'), JSON.stringify(c))
    const r = install(s)
    assert.equal(r.code, 1, bad)
    assert.match(r.err, /bad model path/, bad)
  }
})

test('a staged file whose bytes differ from the catalog is refused', opts, async () => {
  const s = await stagingCopy()
  await appendFile(join(s.staging, s.catalog.skies[0].url.slice(16)), 'x')
  const r = install(s)
  assert.equal(r.code, 1)
  assert.match(r.err, /sha256 differs from the catalog/)
})

test('a hostile PATH and working directory change nothing', opts, async () => {
  const s = await stagingCopy()
  const evil = join(s.root, 'evil')
  await mkdir(evil)
  for (const tool of ['sha256sum', 'install', 'cp', 'find', 'python3']) {
    await writeFile(join(evil, tool), '#!/bin/sh\necho evil\nexit 0\n', { mode: 0o755 })
  }
  const r = install(s, { env: { PATH: `${evil}:${process.env.PATH}` }, cwd: s.staging })
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /OK 4 files/)
  assert.doesNotMatch(r.out + r.err, /evil/)
})

test('a library tree that is not root 0755, or is a symlink, is refused', opts, async () => {
  const s = await stagingCopy()
  await mkdir(s.target, { mode: 0o777 })
  await chmod(s.target, 0o777)
  let r = install(s)
  assert.equal(r.code, 1)
  assert.match(r.err, /must be root:root mode 755/)
  const t = await stagingCopy()
  await symlink(t.root, t.target)
  r = install(t)
  assert.equal(r.code, 1)
  assert.match(r.err, /is a symlink/)
})

test('a staging directory that is a symlink, or relative paths, are refused', opts, async () => {
  const s = await stagingCopy()
  const link = join(s.root, 'staging-link')
  await symlink(s.staging, link)
  let r = install(s, { args: ['--target', s.target, '--work', s.work, link] })
  assert.equal(r.code, 1)
  assert.match(r.err, /is a symlink/)
  r = install(s, { args: ['--target', 'library', '--work', s.work, s.staging] })
  assert.equal(r.code, 1)
  assert.match(r.err, /must be absolute/)
  r = install(s, { args: ['--target', `${s.root}/../x`, '--work', s.work, s.staging] })
  assert.equal(r.code, 1)
  assert.match(r.err, /no \. or \.\./)
})

test('it refuses to run as anyone but root', opts, async () => {
  const s = await stagingCopy()
  const probe = spawnSync('setpriv', ['--version'])
  if (probe.status !== 0) return
  await chmod(s.root, 0o755)
  // A copy nobody can read, wherever this checkout lives.
  const copy = join(s.root, 'install-library.sh')
  await cp(SCRIPT, copy)
  await chmod(copy, 0o644)
  const r = spawnSync('setpriv', ['--reuid=65534', '--regid=65534', '--clear-groups', 'bash', copy, '--target', s.target, '--work', s.work, s.staging], { encoding: 'utf8' })
  assert.equal(r.status, 1, r.stderr)
  assert.match(r.stderr, /must run as root/)
})

test('it leaves no private copy behind', opts, async () => {
  const s = await stagingCopy()
  assert.equal(install(s).code, 0)
  const left = spawnSync('find', [s.work, '-name', 'stage.*'], { encoding: 'utf8' }).stdout.trim()
  assert.equal(left, '')
  await rm(s.root, { recursive: true, force: true })
})
