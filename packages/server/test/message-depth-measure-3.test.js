// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// message-depth-measure — §6.2: the deepest legitimate message, one of four
// files (selection-parts P0). It runs the list its own file name names; see
// helpers/depth-measure.mjs for why, and what is excluded.

import { test } from 'node:test'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listFor, measureFiles } from './helpers/depth-measure.mjs'

const NAME = basename(fileURLToPath(import.meta.url))

test(`§6.2 (${NAME}): the deepest legitimate message its suites send is 32 or less`, () => {
  measureFiles(listFor(NAME), { label: NAME })
})
