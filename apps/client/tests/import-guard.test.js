// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// Guard test: for every './...' module app.js imports from, verify that every
// identifier app.js actually uses from that module is listed in its import.
// Fails on missing-import bugs like the one fixed in R3 (codeToReason and
// formatDestination were used but not imported).

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const APP_JS_PATH = resolve(__dirname, '../src/app.js')
const SRC_DIR = resolve(__dirname, '../src')

// Parse a local-module import line: import { a, b } from './foo.js'
function parseImportLine(line) {
  const match = line.match(/import\s*\{\s*([^}]+)\s*\}\s+from\s+'\.\/([^']+)'/)
  if (!match) return null
  const names = match[1].split(',').map(s => s.trim())
  // Preserve the import specifier exactly as written — app.js uses .js suffix
  const modulePath = match[2]
  return { modulePath, names }
}

// All local-module imports from app.js
function getLocalImports(source) {
  const result = []
  for (const line of source.split('\n')) {
    const parsed = parseImportLine(line)
    if (parsed) result.push(parsed)
  }
  return result
}

// Exported names from a module source (export function/const/class)
function getExportNames(source) {
  const regex = /export\s+(?:async\s+)?(?:function|const|let|var|class)\s+(\w+)/g
  const names = []
  let m
  while ((m = regex.exec(source)) !== null) {
    names.push(m[1])
  }
  return names
}

// True if `name` appears as a standalone identifier anywhere in `lines`
// after the given import line offset. Excludes member access (X.name).
function isUsedAfterImport(lines, name, importLineIdx) {
  const re = new RegExp(`(?<!\\.)\\b${name}\\b`)
  for (let i = importLineIdx + 1; i < lines.length; i++) {
    if (re.test(lines[i])) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Build data
// ---------------------------------------------------------------------------

const appJsSource = readFileSync(APP_JS_PATH, 'utf-8')
const appJsLines = appJsSource.split('\n')
const imports = getLocalImports(appJsSource)

for (const imp of imports) {
  const fullPath = resolve(SRC_DIR, imp.modulePath)
  const moduleSource = readFileSync(fullPath, 'utf-8')
  const exportNames = getExportNames(moduleSource)

  // Find the import line index for this module
  const importLineIdx = appJsLines.findIndex(l => l.includes(`'./${imp.modulePath}'`))

  if (importLineIdx < 0) {
    assert.fail(`Import line for './${imp.modulePath}' not found in app.js`)
  }

  describe(`app.js imports from ./${imp.modulePath}`, () => {
    for (const exportName of exportNames) {
      test(`${exportName} is imported if used in app.js`, () => {
        const isUsed = isUsedAfterImport(appJsLines, exportName, importLineIdx)
        if (isUsed) {
          assert.ok(
            imp.names.includes(exportName),
            `"${exportName}" from ./${imp.modulePath} is referenced in app.js code but missing from import`
          )
        }
      })
    }
  })
}