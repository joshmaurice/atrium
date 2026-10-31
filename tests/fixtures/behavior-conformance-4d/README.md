# The 4d conformance fixtures

Independently written graphs with expected results, for Phase 3 step 4d
(`devtasks/PREBRIEF-scripting-4d.md`, G-L11 and G8). **Written by Claude
before the kickoff; the round may not edit them.** A fixture the code can't
pass is a finding for the handoff, not a fixture to change.

Each `NN-name.json` is one fixture. The expectations were typed by hand from
the contract (`fixtures-gen.mjs` in `devtasks/spike-4d/` writes these files),
and checked against today's adapter by `devtasks/spike-4d/fixtures-check.mjs`
before they landed (see "Status" below).

## Fields
| Field | Meaning |
|---|---|
| `id`, `description` | what the fixture proves, in one paragraph |
| `contract` | the pre-brief sections it pins |
| `requires4d` | reasons it can't pass on the adapter as shipped (empty when it can) |
| `nodeMap` | the behaviour's `nodeMap` (fake ids in the E1 form); index 0 is the own node |
| `world.initial` | starting field values, by `nodeMap` index: `{ "0": { "translation": [...] } }` |
| `world.lights` | `nodeMap` indices that host a light (absent: none) |
| `clock` | `startMs` and `stepMs` of the injected clock |
| `ticks` | how many ticks to run |
| `events` | `{ "beforeTick": k, "select": i }`: call the engine's `select(i)` before tick `k` |
| `tolerance` | numeric tolerance (default `1e-9`) |
| `graph` | the `KHR_interactivity` graph, exactly as it would be stored |
| `expect.writes` | the accepted writes, in order: `{ tick, index, field, value }` |
| `expect.refused` | the writes refused at the boundary (G4), in order, same shape |
| `expect.disposed` | `false`, or the reason the engine ended disposed (`"over-budget"`, …) |
| `expect.unsupported` | when present, `graphReport`'s unsupported declarations: `{ op, extension }` |

## The harness rules
Run each fixture through **the real adapter** with a fake world and the
injected clock and timers (G3):
1. **The world** holds one value per `(index, field)`, starting from
   `world.initial`. Every index in `nodeMap` is the own node or a descendant,
   so authority never refuses. `field` is `translation`, `rotation`,
   `scale`, `visible`, `intensity` or `color`.
2. **Reads see the host's own accepted writes** (G-L6's overlay): a `get`
   returns the latest accepted write to that `(index, field)`, else the
   initial value.
3. **Every write passes G4's value check** (the server's value rules, P23):
   accepted writes are applied and recorded in `writes`; refused ones are
   recorded in `refused` and change nothing.
4. **The clock:** for step `k = 1 … ticks`, `now = startMs + (k − 1) × stepMs`.
   Before tick `k`: fire every injected timer due at or before `now`, in
   order of due time (ties in scheduling order); then apply `events` for
   `k`; then run one tick. A write is recorded with the `k` of the tick it
   happened in.
5. **A delay** scheduled at time `t` with duration `d` seconds is due at
   `t + 1000 × d` ms. Its `done` runs in the tick its timer fires before.
6. **Values:** numbers compare within `tolerance`. A non-finite number is
   written as the string `"NaN"`, `"Infinity"` or `"-Infinity"`. `visible`
   is a boolean, the others arrays.
7. **The run stops** when the ticks are done, or the engine is disposed.

## Status at the commit that added them
`node devtasks/spike-4d/fixtures-check.mjs`, against today's adapter, with
the identity gate, the clock and the timers emulated as G3 specifies:
- **18 pass**; **3 differ, as `requires4d` says**: `07` (the pending-delay
  cap), and `18` and `21` (P26: the shipped adapter sends every node pointer
  to the last `nodeMap` index).
- With `FIXED_POINTERS=1` (P26's fix emulated): **20 pass**; only `07`
  differs.

## The list
| # | Proves |
|---|---|
| 01 | `onStart` and a variable |
| 02 | `onTick` and a variable counter |
| 03 | `onTick`'s `timeSinceStart` on the injected clock |
| 04 | a delay's `done`, on the tick its timer fires before |
| 05 | `cancelDelay` by `lastDelay` |
| 06 | a stale `lastDelay` cancels nothing (Rev 0 review M4) |
| 07 | the 17th pending delay takes `err` (G7) |
| 08 | `pointer/interpolate`, linear, and its `done` |
| 09 | an interpolation replaced on the same pointer; the first `done` never runs |
| 10 | an `event/send` → `event/receive` loop, one lap per tick |
| 11 | an unsupported core op is inert, and the rest of the flow runs |
| 12 | an allowlisted op name with an extension is not executable (Rev 0 review M1) |
| 13 | a `NaN` write is refused at the boundary (Rev 0 review S1) |
| 14 | a non-unit rotation and a zero scale are refused by the server's rules (Rev 1 review M2) |
| 15 | quaternion multiplication stays a unit quaternion (Rev 1 review N2) |
| 16 | `flow/throttle` on the injected clock |
| 17 | `flow/doN` |
| 18 | `{ref}` node pointers, and `err` for a ref outside `nodeMap` |
| 19 | `event/onSelect` through `select(0)` |
| 20 | a runaway tick disposed `over-budget` |
| 21 | each `nodeMap` index reaches its own node (P26) |
