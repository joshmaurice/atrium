// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// subtree-add T4, T5, T7 (devtasks/PREBRIEF-subtree-add.md FINAL Rev 2) — the
// app.js wiring, read as text (as the other wiring tests read it): the server
// level gates trees; the Undo engine gets the name-space lookup and the level;
// Duplicate names the parts against the world; a remote add re-captures once
// per message; a removal re-captures too and clears every removed member's
// wanted animation value; the Delete question is still asked, with its count,
// for a group that can't come back.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const code = readFileSync(resolve(__dirname, '../src/app.js'), 'utf-8')
  .split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')

/** The body of the first `client.on('<event>', …)` handler whose head matches `head`. */
function handler(event, head) {
  const start = code.search(new RegExp(`client\\.on\\('${event}', \\(${head}`))
  assert.ok(start >= 0, `a ${event} handler with ${head}`)
  const end = code.indexOf('\n})', start)
  return code.slice(start, end)
}

test('T7: treesAllowed is the server’s level, 3 or more', () => {
  assert.match(code, /function treesAllowed\(\) \{\s*return Number\.isInteger\(client\.serverAddFields\) && client\.serverAddFields >= 3\s*\}/)
})

test('T5: the Undo engine gets the name-space lookup and the level', () => {
  const start = code.indexOf('const undo = createEditUndo({')
  const block = code.slice(start, code.indexOf('\n})', start))
  assert.match(block, /getObjectByName: \(name\) => client\.som\?\.getObjectByName\(name\) \?\? null/)
  assert.match(block, /trees: treesAllowed,/)
})

test('T5: Duplicate names the parts against the world, at the server’s level; the hint checks the same rule', () => {
  assert.match(code, /prepareDuplicate\(gltfNode, \{ name, isFree: isNameFree, trees: treesAllowed\(\) \}\)/)
  assert.match(code, /duplicateRuleProblem\(gltfNode, \{ trees: treesAllowed\(\) \}\)/)
})

test('T4: a remote add re-captures a pending delete once per message (the root’s event)', () => {
  const body = handler('som:add', '\\{ nodeName, root \\}')
  assert.match(body, /if \(root === undefined \|\| root === nodeName\) undo\.reCapture\(\)/)
  assert.doesNotMatch(body.replace(/if \(root === undefined \|\| root === nodeName\) undo\.reCapture\(\)/, ''), /undo\.reCapture\(\)/, 'and nowhere else in it')
})

test('T5 (M3): a removal re-captures too; T4 (N1): every removed member’s wanted animation value is cleared', () => {
  const body = handler('som:remove', '\\{ nodeName: goneName, removed \\}')
  assert.match(body, /undo\.reCapture\(\)/)
  assert.match(body, /for \(const name of Array\.isArray\(removed\) && removed\.length > 0 \? removed : \(goneName \? \[goneName\] : \[\]\)\) \{\s*modelAnimations\?\.set\(name, null\)/)
})

test('SA-L4 (a): Delete asks only when the capture fails, and then with the count', () => {
  const start = code.indexOf("epDelete.addEventListener('click'")
  const body = code.slice(start, code.indexOf('\n})', start))
  assert.match(body, /const capture = undo\.capture\(node\)\s*if \(!capture\.ok\) \{\s*const n = countDescendants\(node\)/)
})
