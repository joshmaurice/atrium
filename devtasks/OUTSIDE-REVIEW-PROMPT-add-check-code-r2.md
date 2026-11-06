You are an outside code reviewer for Atrium, an open-source multiplayer glTF
browser (Node.js + Three.js, ES modules, no build step, pnpm workspaces).
Review ROUND 2 of one round, `add-check`: a small revision that fixes what an
earlier outside review of round 1 found. Your job is to check that each fix is
right and complete, and that it breaks nothing. Read-only: don't push, don't
open PRs, don't touch any deployed site.

Repository: https://github.com/joshmaurice/atrium (public)
Branch: claude/add-check-r2
Reviewed commit (the tip): 302654c8bb990ef6a7674a693754d1cd9ec8f49d
Round 1's reviewed tip (this revision's parent): 53764b767531044370cf91d5a5c47e2131b69090
The revision: devtasks/REVISION-add-check-round-2.md on main (read §1 first).
The contract: devtasks/PREBRIEF-add-check.md (FINAL Rev 1.1) at 25f6b08328b60cf44cf7a71c8f5f7ebef51805a9.
The earlier review: devtasks/REVIEW-add-check-code-r1-chatgpt.md on main.

STEP 1 — GET THE CODE (please try this first)
  git clone https://github.com/joshmaurice/atrium && cd atrium
  git fetch origin claude/add-check-r2
  git checkout 302654c8bb990ef6a7674a693754d1cd9ec8f49d
  git diff --stat 53764b767531044370cf91d5a5c47e2131b69090 HEAD
Say at the top of your review whether the clone worked; if it failed, quote
the error and fall back to
  https://github.com/joshmaurice/atrium/compare/53764b76...302654c8
and raw files at
  https://raw.githubusercontent.com/joshmaurice/atrium/302654c8bb990ef6a7674a693754d1cd9ec8f49d/<path>
A source-only review is still valuable; label it as one. The diff is small
(two source files of the rule, autosave.js, three test files, one fixture).

STEP 2 — IF YOU HAVE A CLONE, RUN THINGS (Node 22, pnpm 10)
  pnpm install --frozen-lockfile        # autosave's tests need better-sqlite3's native build
  cd packages/server
  for f in add-node-vectors add-node-boundaries autosave add-check value-rules avatar visitor-leak; do timeout 180 node --test test/$f.test.js; done
  cd ../client && node --test tests/add-spec.test.js && cd ../..
Then check out 53764b76 and rerun add-node-vectors, add-node-boundaries,
autosave and add-spec: the revision says the new tests fail there (§3). Quote
both runs.

WHAT EACH FIX CLAIMS, AND WHAT TO TRY
1. R1, `__proto__` (send-policy.js and add-spec.js, `worldExtrasProblem`): the
   non-Atrium extras are copied into `Object.create(null)` before measuring.
   Try to get more than 16 KiB of extras past it any other way: other special
   keys, getters, `toJSON`, nested `__proto__`, a value `JSON.stringify` can't
   measure. Is `extras.atrium` still left to its own checks?
2. R2, autosave (packages/server/src/autosave.js): a generation counter, a save
   asked for mid-save runs after it, and the flushes wait for a save in
   flight. Look hard at the promise chain in `doSave`: can it loop, deadlock,
   leave `saving` stuck, run two saves at once, or drop a save after
   `stop()` deletes the world mid-save? Does a read-back failure still keep
   the previous row and log once? Does `flushAndTeardown` still finish when a
   save keeps failing? Are the two new tests deterministic, and would they
   pass with the fix removed?
3. R3, fail closed: the checker now refuses a non-object node (`node-type`),
   non-object extras (`extras-type`), and null `mesh`, `material`, `indices`,
   `extensions`. Does any first-party sender (the avatar via
   AtriumClient.connect, the palette, pads, Duplicate's `buildDescriptor`,
   Undo's restore) ever send one of those as null? Any first-party refusal is a
   must-fix.
4. R4, lengths first: every primitive's shape (keys, lengths, avatar budget,
   material) before any primitive's values. Is anything still read per element
   before a length or key check? Are the two copies still identical?
5. R5, boundaries: do the new vectors and add-node-boundaries.test.js pin each
   edge from both sides?

OUTPUT (same shape as devtasks/REVIEW-add-check-code-r1-chatgpt.md)
- Verdict: APPROVE / APPROVE WITH NITS / CHANGES REQUESTED, naming the
  reviewed 40-character SHA.
- Findings, each with severity (must-fix / should-fix / nit), file:line at
  the reviewed commit, a concrete failure scenario, and how you know it:
  REPRODUCED (you ran it), CONFIRMED IN THE SOURCE (you read it), or
  INFERRED.
- For each earlier finding (M1, M2, S1, S2, S3, N1): fixed, partly fixed or not.
- What you ran: commands, per-file test counts, Node version.
- What you couldn't do, plainly. Never report something unrun as passing.
