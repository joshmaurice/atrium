// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

// gen-vectors-nan-vector.mjs — scripting-4c revision round 2, W5's test.
//
// Runs the REAL generator (`scripts/gen-vectors.mjs`) on the real fixture with
// ONE `NaN` distance vector added, the two vectors W5 removed from the fixture
// and replaced with direct tests. The generator's own round-trip check
// (`checkJsonRoundTrip`) must refuse to write and exit 1, naming the vector.
//
//   node scripts/gen-vectors-nan-vector.mjs [outPath]
//
// The output path is a parameter so this run can never touch the real fixture:
// with the guard in place nothing is written at all, and with the guard removed
// (proof (w5b)) it writes to the path given here, which the test points at a
// temporary file.
//
// It exits 0 only if the generator WRITES, so `exit 1` is the pass and the test
// reads it as such.

import { distanceVectors, main } from './gen-vectors.mjs'

const INJECTED = [
  ...distanceVectors,
  { name: 'a NaN (the vector W5 removed)', a: [0, 0, 0], b: [NaN, 0, 0], expected: false },
]

main({
  distanceVectors: INJECTED,
  ...(process.argv[2] ? { outPath: process.argv[2] } : {}),
})
