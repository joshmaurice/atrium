Reviewed commit: 98f916c64550ccda3a99d163aa227c33e37ed190 — reviewer: Claude Fable 5.2 — Rev 2: the listed tests, the proofs and three probes were RUN (Rev 1 was source-only)

<!-- Kept on the branch by the implementing session (Opus 5.5), copied from the
reviewing session's chat (claude.ai chat 556fe6eb). Its probe,
probe-s1-n1-s2.mjs, was delivered to the operator and is not reproduced here.
Disposition: devtasks/HANDOFF-grouping.md §8. -->

# Outside code review: `grouping` (de33cf8..98f916c), Rev 2

## Verdict

**APPROVE WITH NITS.** No must-fix.
- One should-fix: S-1, now reproduced on the real Undo engine and the
  server's own check.
- S-2 is measured, and drops to a nit at today's world sizes.
- N-1 is reproduced.
- N-2 to N-6 are unchanged from Rev 1 and still unrun.

## What I ran (Node v22.23.4, pnpm 10.28.0, fresh clone at the pinned SHA)

| Command (STEP 2) | Result |
|---|---|
| `pnpm install --frozen-lockfile --ignore-scripts`, then the `better-sqlite3` install | ok |
| `node --test packages/som/test/reparent.test.js` | 9/9 pass |
| `packages/server`: `timeout 180 node --test test/grouping.test.js` | 27/27 pass |
| `packages/server`: `timeout 180 node --test test/grouping-counts.test.js` | 4/4 pass |
| `node --test packages/client/tests/grouping-move.test.js` | 6/6 pass |
| `apps/client`: the four files (edit-group, undo, wiring, model-form) | 92/92 pass |
| `python3 devtasks/harness/checks/grouping/proofs.py` | all 30 proofs (0–29) turned a test red; exit 0 in 40 s; `git status` clean afterwards |

## Should-fix

### S-1. A Move to inside one tree can have an Undo that GR4 refuses, with no ask-first — REPRODUCED
- **Where:** `apps/client/src/edit-group.js` L344–349 (`moveUndoProblem`). It
  returns `null` for any move inside one top-level tree. That holds for nodes
  and primitives, but not for depth.
- **Probe:**
  - space.gltf, with a chain `crate-01 › n1 › … › n9`, so depth 9;
  - the real `createEditUndo`, with the test file's harness;
  - the server's exported `parentChangeProblem`.

  ```
  tree depth now: 9
  client moveUndoProblem(n9 -> n3) [null = no ask-first]: null
  server parentChangeProblem(n9 -> n3): null
  moved; parent = n3  depth = 8  undoCount = 1
  server parentChangeProblem(n9 -> n8) (what Undo would send):
    { code: 'INVALID_VALUE', message: 'the group would be too large to copy (depth)' }
  undo.run -> false | requests sent by Undo: 0 | parent = n3 | undoCount = 0 redoCount = 0
  message: Can’t undo: “n9” the group would be too large to copy.
  ```
- **Reading:**
  - The move is accepted and recorded with no question.
  - Its Undo is refused before sending, and the entry is dropped.
  - GR-L5 (a) says such an action asks first.
  - The engine itself behaves correctly: nothing is sent, and nothing is
    left in flight. Only the ask-first is missing.
- **Size:** narrow. It needs a tree already over the depth bound, which only
  seed content can be.
- **Fix:** in the same-tree case, use
  `treeBoundsProblem({ before: moveCounts(node, target).after, after: treeCounts(oldTop) })`.

## Nits

### N-0 (was S-2). The Empty groups scan and the Ungroup plan run on every `som:set` in Edit mode
- **The call path** is CONFIRMED IN THE SOURCE: `app.js` L3893, then
  `refreshEditActions`, `refreshGroupActions` and `refreshEmptyGroups`.
- **The cost** is now MEASURED, per call:

  | World | nodes | `bareNodes` | `ungroupPlan` of the widest group (plain / rotated) |
  |---|---|---|---|
  | space.gltf | 5 | 0.002 ms | 0.009 / 0.029 ms |
  | atrium.gltf | 56 | 0.035 ms | 0.024 / 0.099 ms (9 parts) |
  | synthetic, 8 groups of 250 | 2005 | 3.3 ms | 0.39 / 0.96 ms (249 parts) |

- **Reading:**
  - Negligible in today's worlds.
  - About 4 ms per `som:set` at 2,000 nodes, which a running behaviour would
    multiply.
  - It still isn't what GR8 says ("never on every `som:set`"). The small fix
    from Rev 1 is worth doing, but it isn't urgent.

### N-1. A part of a model-carrying node can leave but not come back — REPRODUCED
With `lamp-01` given `extras.atrium.model`:

```
server: move out -> null
server: move back -> { code: 'INVALID_VALUE', message: 'a node may not be moved into a model' }
undo.run -> true | requests sent: 1 | parent = null | undoCount 0 redoCount 0
message: Undo stopped: “lamp-shade” changed elsewhere (INVALID_VALUE: a node may not be moved into a model).
```

The Undo is sent, refused and dropped. `checkComposite` has no model rule,
and nothing asks first.

### N-2 to N-6 — as in Rev 1, not run
These are CONFIRMED IN THE SOURCE or INFERRED:
- **N-2:** the group is removed with a newcomer inside.
- **N-3:** a behaviour's transform write makes the entry "changed elsewhere".
- **N-4:** a half-sent phase counts as sent.
- **N-5:** `Number('')` is 0 in the two select handlers.
- **N-6:** an unsent moves phase gives a message with no names.

## What I did not run
- The Playwright harness checks (`smoke.py`, `c1.py`–`c6.py`).
- Probes for N-2 to N-6, two-tab races, or a live server on port 0.
- The new tests against `172b816d` (whether each fails on the released code).
- The rest of the repo's suites outside STEP 2.

The probe is one file, `probe-s1-n1-s2.mjs`: the Undo test's harness (lines
1–126), plus the three blocks above. Nothing was committed or pushed, and the
clone's tree is clean.
