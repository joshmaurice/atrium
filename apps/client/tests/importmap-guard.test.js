// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// importmap-guard.test.js — V1 of models-by-url round 2.
//
// `packages/client/package.json` exports `@atrium/client/model-spec` and
// `@atrium/client/model-fetch`, so Node resolves them; a browser resolves a
// bare specifier only through the page's import map. In round 1 all three pages
// were missing both entries, so every page that imports `app.js` — and, through
// `renderer-three/src/index.js`'s re-export of the model bridge, every page that
// imports `@atrium/renderer-three` — died in the console with
// `Failed to resolve module specifier "@atrium/client/model-fetch"`, while every
// Node suite passed. This test is the guard that would have caught it.
//
// It reads files only (no browser). For each page it parses the
// `<script type="importmap">`, starts at the page's module entry points,
// follows the static import graph (relative specifiers, plus any bare specifier
// the page's own map resolves to a repo path) and asserts that every bare
// specifier met on the way is a key of that page's map, exactly or as a
// trailing-`/` prefix.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../../..')

/** The three pages that serve the app, the inspector and the playground. */
const PAGES = [
  resolve(REPO_ROOT, 'apps/client/index.html'),
  resolve(REPO_ROOT, 'tools/som-inspector/index.html'),
  resolve(REPO_ROOT, 'apps/playground/index.html'),
]

/** `import ... from 'x'`, `export ... from 'x'` — one statement per match. */
const FROM_RE = /\b(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g

/** `import 'x'` — a side-effect import has no `from`. */
const SIDE_EFFECT_RE = /(?:^|[\s;{}()])import\s*['"]([^'"]+)['"]/g

/** All `<script ...>` tags of a page. */
function scriptTags(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
}

/** The page's import map, as `{ imports }`, or null when it has none. */
function importMapOf(html) {
  for (const [, attrs, body] of scriptTags(html)) {
    if (/\btype\s*=\s*["']importmap["']/i.test(attrs)) return JSON.parse(body)
  }
  return null
}

/** The page's module entry points, as absolute paths. */
function entryPointsOf(pagePath, html) {
  const entries = []
  for (const [, attrs] of scriptTags(html)) {
    if (!/\btype\s*=\s*["']module["']/i.test(attrs)) continue
    const src = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i)
    if (src) entries.push(resolve(dirname(pagePath), src[1]))
  }
  return entries
}

/** Every static import specifier in a module's source, in source order. */
function specifiersOf(source) {
  const found = []
  for (const re of [FROM_RE, SIDE_EFFECT_RE]) {
    re.lastIndex = 0
    let match
    while ((match = re.exec(source)) !== null) found.push(match[1])
  }
  return found
}

/** True for a specifier that names a file inside this repo (`./`, `../` or `/`). */
function isRelativeSpecifier(specifier) {
  return specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/')
}

/** True for a URL the page's map sends outside the repo (or a scheme Node owns). */
function isExternalSpecifier(specifier) {
  return /^[a-z][a-z0-9+.-]*:/i.test(specifier)
}

/**
 * The import-map key `specifier` resolves through: an exact key, or a key
 * ending in `/` that is a prefix (the spec's trailing-slash rule). Null when
 * the page's map has no entry for it — the failure this test exists for.
 */
function mapKeyFor(imports, specifier) {
  if (Object.hasOwn(imports, specifier)) return specifier
  let best = null
  for (const key of Object.keys(imports)) {
    if (!key.endsWith('/')) continue
    if (specifier.startsWith(key) && (best === null || key.length > best.length)) best = key
  }
  return best
}

/** The prefix rule strips the key before appending the target. */
function mappedTarget(imports, key, specifier) {
  const target = imports[key]
  return `${target}${specifier.slice(key.length)}`
}

/**
 * Walk the static import graph from the entry points. Returns
 * `{ modules, bare }` — the repo files reached, and every bare specifier met
 * with the module that named it.
 */
function walkGraph(pagePath, entryPoints, imports) {
  const modules = new Set()
  const bare = new Map()
  const queue = [...entryPoints]

  const note = (specifier, from) => {
    if (!bare.has(specifier)) bare.set(specifier, from)
  }

  while (queue.length > 0) {
    const file = queue.shift()
    if (modules.has(file)) continue
    modules.add(file)
    assert.ok(existsSync(file), `${relative(REPO_ROOT, file)}: imported by a page but missing`)

    const source = readFileSync(file, 'utf-8')
    for (const specifier of specifiersOf(source)) {
      if (isExternalSpecifier(specifier)) continue
      if (isRelativeSpecifier(specifier)) {
        const target = specifier.startsWith('/')
          ? resolve(REPO_ROOT, `.${specifier}`)
          : resolve(dirname(file), specifier)
        if (isFile(target)) queue.push(target)
        continue
      }
      // A bare specifier: the map must have an entry for it, or a browser
      // cannot resolve it. No entry is exactly the round-1 defect.
      const key = mapKeyFor(imports, specifier)
      note(specifier, file)
      if (!key) continue
      const target = mappedTarget(imports, key, specifier)
      if (isExternalSpecifier(target)) continue
      queue.push(resolve(dirname(pagePath), target))
    }
  }
  return { modules, bare }
}

function isFile(path) {
  return existsSync(path) && statSync(path).isFile()
}

for (const pagePath of PAGES) {
  const label = relative(REPO_ROOT, pagePath)
  describe(`import map — ${label}`, () => {
    const html = readFileSync(pagePath, 'utf-8')
    const map = importMapOf(html)
    const imports = map?.imports ?? {}
    const entries = entryPointsOf(pagePath, html)

    test('the page has an import map and at least one module entry point', () => {
      assert.ok(map, `${label} has no <script type="importmap">`)
      assert.ok(Object.keys(imports).length > 0, `${label}'s import map is empty`)
      assert.ok(entries.length > 0, `${label} has no <script type="module" src="…">`)
    })

    test('every bare specifier in the page’s static import graph is mapped', () => {
      const { modules, bare } = walkGraph(pagePath, entries, imports)
      assert.ok(modules.size > 1, `${label}: the graph from the entry points is empty`)
      const missing = [...bare.entries()]
        .filter(([specifier]) => !mapKeyFor(imports, specifier))
        .map(([specifier, from]) => `${specifier}  (from ${relative(REPO_ROOT, from)})`)
      assert.deepEqual(missing, [],
        `${label}'s import map is missing: ${missing.join(', ')}`)
    })

    // V1's own subject: the two model modules the round-1 pages lacked.
    for (const specifier of ['@atrium/client/model-spec', '@atrium/client/model-fetch']) {
      test(`${specifier} is a key of the map`, () => {
        assert.ok(mapKeyFor(imports, specifier),
          `${label}'s import map has no entry for ${specifier}`)
      })
    }
  })
}
