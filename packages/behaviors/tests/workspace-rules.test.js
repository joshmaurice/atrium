// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// workspace-rules.test.js — scripting-4b-2 round 4, U1.
//
// The DEV deploy refuses this tree before it installs anything: the host's
// `config.WORKSPACE_ALLOWED` is `("packages/*", "tools/*", "apps/*")`, and its
// `workspace.package_dirs` treats every other glob in `pnpm-workspace.yaml` as
// a `WorkspaceRefused`; it also lists every direct entry of `packages/`,
// `apps/` and `tools/` and checks the name. Round 1 vendored the engine and
// gl-matrix in a nested `vendor/` glob under `packages/` (F-L11) without
// checking either rule, so `ensure-node-modules` refused right after the
// deploy's checkout and `atrium-deploy` rolled DEV back.
//
// This test mirrors those two host rules so a future round cannot add a
// package-directory shape the deploy refuses without this test failing first:
//   * `config.WORKSPACE_ALLOWED` — the workspace globs, exactly;
//   * `workspace.package_dirs` — every entry directly under `packages/`,
//     `apps/` and `tools/` is a directory whose name matches `^[a-z0-9][a-z0-9-]*$`
//     and is not `node_modules`. A directory without a `package.json` is
//     allowed: the host skips it (`tools/som-inspector` is one).

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../../..')

/** The host's `config.WORKSPACE_ALLOWED`, verbatim. */
const ALLOWED_GLOBS = new Set(['packages/*', 'tools/*', 'apps/*'])

/** The host's `workspace.NAME_RE` (on a glob's single path component). */
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/

/** The three directories the host lists the direct entries of. */
const LISTED_DIRS = ['packages', 'apps', 'tools']

/** The globs of `pnpm-workspace.yaml`'s `packages:` list, in order. */
function workspaceGlobs() {
  const text = readFileSync(resolve(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf-8')
  const globs = []
  let inPackages = false
  for (const line of text.split('\n')) {
    if (/^packages\s*:/.test(line)) {
      inPackages = true
      continue
    }
    if (!inPackages) continue
    // A non-blank, non-list line at column 0 ends the `packages:` list.
    if (/^\S/.test(line) && line.trim() !== '') break
    const match = /^\s*-\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line)
    if (match) globs.push(match[1])
  }
  return globs
}

describe('U1 — the workspace obeys the host’s rules', () => {
  test('pnpm-workspace.yaml names only packages/*, tools/* and apps/*', () => {
    const globs = workspaceGlobs()
    assert.ok(globs.length > 0, 'pnpm-workspace.yaml has no `packages:` globs')
    for (const glob of globs) {
      assert.ok(
        ALLOWED_GLOBS.has(glob),
        `pnpm-workspace.yaml names a glob the host refuses (config.WORKSPACE_ALLOWED): ${glob}`,
      )
    }
  })

  for (const dir of LISTED_DIRS) {
    test(`${dir}/ holds only workspace-package directories`, () => {
      const entries = readdirSync(resolve(REPO_ROOT, dir), { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        assert.ok(
          entry.isDirectory(),
          `${dir}/${entry.name} is not a directory (the host lists every direct entry)`,
        )
        assert.notEqual(
          entry.name,
          'node_modules',
          `${dir}/node_modules is not allowed (the host lists every direct entry)`,
        )
        assert.match(
          entry.name,
          NAME_RE,
          `${dir}/${entry.name} does not match the host’s ^[a-z0-9][a-z0-9-]*$ (workspace.package_dirs)`,
        )
      }
    })
  }
})
