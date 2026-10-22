// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, mkdir, symlink, link, chmod, chown, stat, cp, appendFile, rm, readdir, truncate, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run } from '../build.mjs'
import { createFakePolyHaven } from './fake-polyhaven.mjs'

const SCRIPT = fileURLToPath(new URL('../install-library.sh', import.meta.url))
const isRoot = process.getuid?.() === 0
const opts = { skip: isRoot ? false : 'install-library.sh needs root: run npm test as root' }

let built = null
/** One real staging directory, built once and copied per test (root-owned, so tests pass --owner root). */
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
  const catalog = JSON.parse(await readFile(join(built, 'catalog.json'), 'utf8'))
  const rel = { glb: catalog.models[0].url.slice(16), sky: catalog.skies[0].url.slice(16), thumb: catalog.models[0].thumbnail.slice(16) }
  return { root, staging, target: join(root, 'library'), work, catalog, rel }
}

function install(s, { env = {}, cwd = '/', args = null, owner = 'root', staging = s.staging } = {}) {
  const r = spawnSync('bash', [SCRIPT, ...(args ?? ['--target', s.target, '--work', s.work, '--owner', owner, staging])], {
    cwd, env: { PATH: process.env.PATH, ...env }, encoding: 'utf8', timeout: 20_000,
  })
  return { code: r.status, out: r.stdout, err: r.stderr, signal: r.signal }
}

async function installedFiles(s) {
  const out = []
  for (const sub of ['models', 'skies', 'thumbs']) {
    try { for (const n of await readdir(join(s.target, sub))) out.push(`${sub}/${n}`) } catch {}
  }
  return out
}

async function editCatalog(s, fn) {
  const c = JSON.parse(await readFile(join(s.staging, 'catalog.json'), 'utf8'))
  fn(c)
  await writeFile(join(s.staging, 'catalog.json'), JSON.stringify(c, null, 2))
}

test('a fresh install: every file root-owned 0644, a canonical catalog kept, URLs listed', opts, async () => {
  const s = await stagingCopy()
  const r = install(s)
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /OK 4 files \(4 new, 0 already present\)/)
  for (const sub of ['', 'models', 'skies', 'thumbs']) {
    const st = await stat(join(s.target, sub))
    assert.equal(st.uid, 0); assert.equal(st.mode & 0o777, 0o755)
  }
  const st = await stat(join(s.target, s.rel.glb))
  assert.equal(st.uid, 0); assert.equal(st.mode & 0o777, 0o644)
  assert.ok(r.out.includes(`/assets/library/${s.rel.glb}`))
  const kept = /catalog: (\S+)/.exec(r.out)[1]
  assert.ok(kept.startsWith(s.work + '/catalog-'))
  assert.deepEqual(JSON.parse(await readFile(kept, 'utf8')), s.catalog, 'the kept catalog has the same content')
  assert.deepEqual((await installedFiles(s)).sort(), [s.rel.glb, s.rel.sky, s.rel.thumb, s.catalog.skies[0].thumbnail.slice(16)].sort())
})

test('a second run installs nothing and passes', opts, async () => {
  const s = await stagingCopy()
  assert.equal(install(s).code, 0)
  const r = install(s)
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /OK 4 files \(0 new, 4 already present\)/)
})

test('a destination present with different content stops the run before anything is installed', opts, async () => {
  const s = await stagingCopy()
  await mkdir(join(s.target, 'skies'), { recursive: true })
  for (const d of ['', 'models', 'skies', 'thumbs']) { await mkdir(join(s.target, d), { recursive: true }); await chmod(join(s.target, d), 0o755) }
  await writeFile(join(s.target, s.rel.sky), 'different', { mode: 0o644 })
  const r = install(s)
  assert.equal(r.code, 1)
  assert.match(r.err, /already exists with DIFFERENT content.*nothing was installed/)
  assert.deepEqual(await installedFiles(s), [s.rel.sky])
})

test('a refused staging installs nothing at all (review finding 3)', opts, async () => {
  const s = await stagingCopy()
  await appendFile(join(s.staging, s.rel.sky), 'x')
  const r = install(s)
  assert.equal(r.code, 1)
  assert.match(r.err, /sha256 differs from the catalog/)
  assert.deepEqual(await installedFiles(s), [])
})

test('a hard-linked file is refused before it is copied (finding 1)', opts, async () => {
  const s = await stagingCopy()
  await link(join(s.staging, s.rel.glb), join(s.root, 'second-name'))
  const r = install(s)
  assert.equal(r.code, 1)
  assert.match(r.err, /has 2 hard links/)
  assert.deepEqual(await installedFiles(s), [])
})

test('a huge sparse file is refused by its size, without reading it (finding 1)', opts, async () => {
  const s = await stagingCopy()
  await truncate(join(s.staging, s.rel.thumb), 4 * 1024 * 1024 * 1024)
  const started = Date.now()
  const r = install(s)
  assert.equal(r.code, 1)
  assert.match(r.err, /over its cap/)
  assert.ok(Date.now() - started < 5000)
})

test('a FIFO, or a symlink, in place of a named file is refused without hanging', opts, async () => {
  const s = await stagingCopy()
  await rm(join(s.staging, s.rel.thumb))
  assert.equal(spawnSync('mkfifo', [join(s.staging, s.rel.thumb)]).status, 0)
  let r = install(s)
  assert.equal(r.signal, null, 'did not time out')
  assert.equal(r.code, 1)
  assert.match(r.err, /not a regular file/)

  const t = await stagingCopy()
  await rename(join(t.staging, t.rel.glb), join(t.root, 'real.glb'))
  await symlink(join(t.root, 'real.glb'), join(t.staging, t.rel.glb))
  r = install(t)
  assert.equal(r.code, 1)
  assert.match(r.err, /not a regular file/)
})

test('unexpected entries anywhere in staging are refused, newline names included (finding 4)', opts, async () => {
  const cases = [
    async (s) => writeFile(join(s.staging, 'models', 'extra.glb'), 'x'),
    async (s) => mkdir(join(s.staging, 'other')),
    async (s) => writeFile(join(s.staging, '\n'), 'x'),
    async (s) => mkdir(join(s.staging, 'models\nthumbs')),
    async (s) => mkdir(join(s.staging, 'models', 'nested')),
    async (s) => symlink('/etc/passwd', join(s.staging, 'thumbs', 'evil.webp')),
  ]
  for (const [i, make] of cases.entries()) {
    const s = await stagingCopy()
    await make(s)
    const r = install(s)
    assert.equal(r.code, 1, `case ${i}`)
    assert.match(r.err, /unexpected|does not name/, `case ${i}`)
    assert.deepEqual(await installedFiles(s), [], `case ${i}`)
  }
})

test('the catalog is checked strictly (finding 5)', opts, async () => {
  const cases = [
    [(c) => { c.models[0].url = '/assets/library/models/../../x-0123456789ab.glb' }, /bad model path/],
    [(c) => { c.models[0].url = '/assets/library/%2e%2e/x.glb' }, /bad model path/],
    [(c) => { c.models[0].url = '/etc/passwd' }, /bad model path/],
    [(c) => { c.models[0].name = '<img src=x onerror=alert(1)>' }, /bad name/],
    [(c) => { c.models[0].extra = 1 }, /exactly the keys/],
    [(c) => { c.version = true }, /version must be the integer 1/],
    [(c) => { c.models[0].bounds = [1, 1, 5000] }, /bad bounds/],
    [(c) => { c.models[0].authors = ['<script>'] }, /bad authors/],
    [(c) => { c.models[0].source = 'https://evil.example/' }, /bad source/],
    [(c) => { c.models[0].license = 'proprietary' }, /CC0-1.0/],
    [(c) => { c.skies[0].width = 8192 }, /4096 x 2048/],
    [(c) => { c.credit = 'someone else' }, /credit/],
  ]
  for (const [fn, want] of cases) {
    const s = await stagingCopy()
    await editCatalog(s, fn)
    const r = install(s)
    assert.equal(r.code, 1, String(want))
    assert.match(r.err, want)
  }
  for (const [text, want] of [['"bytes": NaN', /NaN is not allowed/], ['"bytes": Infinity', /Infinity is not allowed/]]) {
    const s = await stagingCopy()
    const raw = (await readFile(join(s.staging, 'catalog.json'), 'utf8')).replace(/"bytes": \d+/, text)
    await writeFile(join(s.staging, 'catalog.json'), raw)
    const r = install(s)
    assert.equal(r.code, 1, text)
    assert.match(r.err, want)
  }
  const s = await stagingCopy()
  const raw = (await readFile(join(s.staging, 'catalog.json'), 'utf8')).replace('"version": 1,', '"version": 1, "version": 1,')
  await writeFile(join(s.staging, 'catalog.json'), raw)
  assert.match(install(s).err, /duplicate key/)
})

test('a staging tree not owned by the build account, or under a non-root directory, is refused', opts, async () => {
  const s = await stagingCopy()
  let r = install(s, { owner: 'nobody' })
  assert.equal(r.code, 1)
  assert.match(r.err, /not owned by nobody/)
  const t = await stagingCopy()
  const parent = join(t.root, 'userdir')
  await mkdir(parent)
  await rename(t.staging, join(parent, 'staging'))
  await chown(parent, 65534, 65534)
  r = install(t, { staging: join(parent, 'staging') })
  assert.equal(r.code, 1)
  assert.match(r.err, /is not owned by root/)
})

test('a staging symlink is refused, with or without a trailing slash (finding 2)', opts, async () => {
  const s = await stagingCopy()
  const linkPath = join(s.root, 'staging-link')
  await symlink(s.staging, linkPath)
  for (const p of [linkPath, linkPath + '/', linkPath + '//']) {
    const r = install(s, { staging: p })
    assert.equal(r.code, 1, p)
    assert.match(r.err, /symlink/, p)
  }
  assert.deepEqual(await installedFiles(s), [])
})

test('relative paths and . or .. components are refused', opts, async () => {
  const s = await stagingCopy()
  let r = install(s, { args: ['--target', 'library', '--work', s.work, '--owner', 'root', s.staging] })
  assert.equal(r.code, 1); assert.match(r.err, /must be absolute/)
  r = install(s, { args: ['--target', `${s.root}/../x`, '--work', s.work, '--owner', 'root', s.staging] })
  assert.equal(r.code, 1); assert.match(r.err, /no empty, \. or \.\./)
})

test('a hostile PATH and working directory change nothing', opts, async () => {
  const s = await stagingCopy()
  const evil = join(s.root, 'evil')
  await mkdir(evil)
  for (const tool of ['sha256sum', 'install', 'cp', 'find', 'python3', 'id']) {
    await writeFile(join(evil, tool), '#!/bin/sh\necho evil\nexit 0\n', { mode: 0o755 })
  }
  const r = install(s, { env: { PATH: `${evil}:${process.env.PATH}`, PYTHONPATH: evil, PYTHONSTARTUP: join(evil, 'x') }, cwd: s.staging })
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
  assert.match(r.err, /symlink/)
})

test('it refuses to run as anyone but root', opts, async () => {
  const s = await stagingCopy()
  if (spawnSync('setpriv', ['--version']).status !== 0) return
  await chmod(s.root, 0o755)
  const copy = join(s.root, 'install-library.sh')   // readable wherever this checkout lives
  await cp(SCRIPT, copy)
  await chmod(copy, 0o644)
  const r = spawnSync('setpriv', ['--reuid=65534', '--regid=65534', '--clear-groups', 'bash', copy, '--target', s.target, '--work', s.work, s.staging], { encoding: 'utf8' })
  assert.equal(r.status, 1, r.stderr)
  assert.match(r.stderr, /must run as root/)
})

test('it leaves no private copy behind, after success or refusal', opts, async () => {
  const s = await stagingCopy()
  assert.equal(install(s).code, 0)
  await appendFile(join(s.staging, s.rel.sky), 'x')
  assert.equal(install(s).code, 1)
  assert.deepEqual((await readdir(s.work)).filter((n) => n.startsWith('stage.')), [])
  await rm(s.root, { recursive: true, force: true })
})

test('an author name the kept catalog could not carry is refused before anything is installed (re-review N1)', opts, async () => {
  for (const author of ['\\ud800', 'a\\u202eb', 'a\\u0085b', 'a\\u2028b']) {
    const s = await stagingCopy()
    const raw = (await readFile(join(s.staging, 'catalog.json'), 'utf8')).replace('"Test Author"', `"Test ${author} Author"`)
    await writeFile(join(s.staging, 'catalog.json'), raw)
    const r = install(s)
    assert.equal(r.code, 1, author)
    assert.match(r.err, /bad authors/, author)
    assert.doesNotMatch(r.err, /Traceback/, author)
    assert.deepEqual(await installedFiles(s), [], author)
  }
})

test('a present destination with the right bytes but the wrong mode stops the run before anything is installed (N2)', opts, async () => {
  const s = await stagingCopy()
  for (const d of ['', 'models', 'skies', 'thumbs']) { await mkdir(join(s.target, d), { recursive: true }); await chmod(join(s.target, d), 0o755) }
  await cp(join(s.staging, s.rel.sky), join(s.target, s.rel.sky))
  await chmod(join(s.target, s.rel.sky), 0o666)
  const r = install(s)
  assert.equal(r.code, 1)
  assert.match(r.err, /not a root:root 0644 file with one link; nothing was installed/)
  assert.deepEqual(await installedFiles(s), [s.rel.sky])
})

test('a catalog whose bytes differ from the file is refused (N3)', opts, async () => {
  const s = await stagingCopy()
  await editCatalog(s, (c) => { c.models[0].bytes = 1 })
  const r = install(s)
  assert.equal(r.code, 1)
  assert.match(r.err, /the catalog says 1 bytes/)
  assert.deepEqual(await installedFiles(s), [])
})

test('a leftover temporary file from an interrupted run is refused, not overwritten', opts, async () => {
  const s = await stagingCopy()
  for (const d of ['', 'models', 'skies', 'thumbs']) { await mkdir(join(s.target, d), { recursive: true }); await chmod(join(s.target, d), 0o755) }
  const name = s.rel.glb.split('/')[1]
  await writeFile(join(s.target, 'models', '.tmp-' + name), 'partial')
  const r = install(s)
  assert.equal(r.code, 1)
  assert.match(r.err, /a leftover .*\.tmp-/)
  assert.deepEqual(await installedFiles(s), ['models/.tmp-' + name], 'only the planted leftover; nothing installed')
  assert.equal(await readFile(join(s.target, 'models', '.tmp-' + name), 'utf8'), 'partial')
})

test('owner checks with a staging tree owned by the build account (here: nobody)', opts, async () => {
  const s = await stagingCopy()
  assert.equal(spawnSync('chown', ['-R', '65534:65534', s.staging]).status, 0)
  let r = install(s, { owner: 'nobody' })
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /OK 4 files/)

  const t = await stagingCopy()
  assert.equal(spawnSync('chown', ['-R', '65534:65534', t.staging]).status, 0)
  await chown(join(t.staging, t.rel.thumb), 0, 0)
  r = install(t, { owner: 'nobody' })
  assert.equal(r.code, 1)
  assert.match(r.err, /not owned by nobody: thumbs\//)

  const u = await stagingCopy()
  assert.equal(spawnSync('chown', ['-R', '65534:65534', u.staging]).status, 0)
  await chown(join(u.staging, 'skies'), 0, 0)
  r = install(u, { owner: 'nobody' })
  assert.equal(r.code, 1)
  assert.match(r.err, /staging skies\/ is not owned by nobody/)
  assert.deepEqual(await installedFiles(u), [])
})

test('an ancestor writable by others is refused unless it has the sticky bit (N5)', opts, async () => {
  const s = await stagingCopy()
  await chmod(s.root, 0o777)
  let r = install(s)
  assert.equal(r.code, 1)
  assert.match(r.err, /writable by group or others without the sticky bit/)
  await chmod(s.root, 0o1777)
  r = install(s)
  assert.equal(r.code, 0, r.err)
})
