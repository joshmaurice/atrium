You are an outside code reviewer for Atrium, an open-source multiplayer glTF
browser (Node.js + Three.js, ES modules, no build step, pnpm workspaces).
Review the IMPLEMENTATION of one round, `add-check`: a strict server check of
every `add` message (the one way clients put geometry into a shared world),
mirrored on the client. It closes a live defect on the public server. Your job
is to find what is wrong, missing or exploitable before it reaches production.
Read-only: don't push, don't open PRs, don't touch any deployed site.

Repository: https://github.com/joshmaurice/atrium (public)
Branch: workflow/add-check
Reviewed commit (the tip): 53764b767531044370cf91d5a5c47e2131b69090
Base: 25f6b08328b60cf44cf7a71c8f5f7ebef51805a9 (its code is identical to the
released 8fc82bb5; only devtasks/ differs)
The contract: devtasks/PREBRIEF-add-check.md (FINAL Rev 1.1), at the base.
Read §2.3 (the defect), §4 (A1–A10, the rules) and §5 (tests) first.

STEP 1 — GET THE CODE (please try this first)
  git clone https://github.com/joshmaurice/atrium && cd atrium
  git fetch origin workflow/add-check
  git checkout 53764b767531044370cf91d5a5c47e2131b69090
  git diff --stat 25f6b08328b60cf44cf7a71c8f5f7ebef51805a9 HEAD
Say at the top of your review whether the clone worked; if it failed, quote
the error and fall back to
  https://github.com/joshmaurice/atrium/compare/25f6b083...53764b76
and raw files at
  https://raw.githubusercontent.com/joshmaurice/atrium/53764b767531044370cf91d5a5c47e2131b69090/<path>
A source-only review is still valuable; label it as one.

STEP 2 — IF YOU HAVE A CLONE, RUN THINGS (Node 22, pnpm 10)
  pnpm install --frozen-lockfile --ignore-scripts
  (cd packages/protocol && node --test test/*.test.js)
  (cd packages/client && node --test tests/*.test.js)      # no --test-force-exit
  (cd apps/client && node --test tests/*.test.js)
  # server test files hang if batched: run each one alone, e.g.
  cd packages/server && for f in add-check add-node-vectors autosave value-rules avatar visitor-leak session commons model-extras; do timeout 180 node --test test/$f.test.js; done; cd ../..
  # the probes, from the repo root, on the tip AND on the base (git checkout the base, rerun, compare):
  node devtasks/spike-richer-add/p3-malformed.mjs          # calls world.addNode directly, below the handler: expect no change
  timeout 60 node devtasks/spike-richer-add/p4-avatar-dump.mjs
  timeout 120 node devtasks/spike-richer-add/p7-float32-extensions.mjs
  timeout 200 node devtasks/spike-richer-add/review-q/q2-empty-accessor-and-cost.mjs   # only its part (c) goes through the handler
Quote the counts and any output that disagrees with the contract. Most
valuable of all: write your own probe against the real
packages/server/src/session.js `attachSessionHandlers` (see p4 or p7 for a
harness: an HTTP server on port 0, a WebSocketServer, two WebSocket clients)
that tries to get a bad `add` past the check, or to make the check itself
expensive. Include its code and output.

CONTEXT
- The defect (§2.3): before this round the server never looked at an `add`'s
  mesh, translation, extensions or `format`. Any anonymous visitor's avatar
  `add` could stop newcomers joining (4-number POSITION), stall the whole
  process for seconds (20,000 one-triangle primitives in 938 KiB), make every
  join download megabytes (900 KB of avatar extras), store ±Infinity
  (1e39 overflows Float32), or have dropped fields forwarded to everyone. An
  owner's `add` with POSITION [] saved a world that could never load again.
- The fix: `checkAddNode` (packages/server/src/send-policy.js) and its client
  twin (packages/client/src/add-spec.js), pinned to each other by
  tests/fixtures/add-node-vectors.json; an avatar budget (A5); `translation`
  in K6; [0, 1] material ranges shared with `send` (A9); autosave reading
  back what it saves, and a WORLD_UNREADABLE error when a world can't be
  serialized or read (A10); Duplicate and Undo running the client copy (A7).
- The internal review (GLM) passed it with five non-blocking findings:
  (1) proof p2 can't fail as carded, because A8's schema and A3's 64-primitive
  cap also stop the 20,000-primitive avatar; an end-to-end A5 test was added
  instead; (2) a K6 unit test was added late; (3) a test hung in cleanup and
  was fixed; (4) two extra test-only commits; (5) `checkAddNode` returns null
  (accepts) for a non-object node, relying on the schema. Confirm or dispute
  each.
- Atrium has one real user (the operator). PROD is public. The released code
  everyone runs today is 8fc82bb5.

WHERE TO SPEND THE TIME, in order
1. Bypasses. Is every path into `world.addNode` / `SOMDocument.ingestNode`
   behind `checkAddNode`, for avatars and world adds alike? Look at the
   handler's order in session.js (K6, the avatar and V9 `try` blocks, the
   displayName overwrite, the broadcast), at re-adds (Redo, Undo restore),
   at `parent`, and at anything the schema (A8) and the checker disagree on.
   Can a value pass the checker and still reach `ingestNode` in a form it
   can't store (Float32, Uint16, empty or short arrays)?
2. Cost. Is every length and key set checked before per-element work? What
   is the worst-case time of `checkAddNode` itself on a message just under
   1 MiB (for example 64 primitives at the 65,535-vertex cap, or deep
   `extras`)? Is the 16 KiB extras measure (UTF-8 bytes of JSON.stringify)
   safe to compute on hostile input?
3. The two copies. Do the server and client rules match, line by line, and
   match §4 A2–A5 and A9? Do the vectors cover every reason code, each edge
   (exactly 1,024 vertices, 6,144 indices, 64 primitives, index 65,534 vs
   65,535, 256-character names), and the real avatar with its
   `extras.atrium.ephemeral` marker?
4. A10. Autosave's read-back: on failure, is the previous row really kept,
   is the dirty state kept so the next save retries, and is the log once per
   world? The join's WORLD_UNREADABLE: what does a client do after it, with
   the socket left open? `_onSomDump`'s catch: can it leave a half-built SOM?
   The app panel: right session, exact text?
5. A7. Duplicate and Undo still work for everything first-party, and refuse
   (with the reason) what the server would refuse; `MAX_INDEX` 65,534.
6. Tests. Does each new test fail on the base (the contract requires it),
   and does each proof (p1)–(p6) actually pin its rule? Any test that would
   pass with the rule removed?

OUTPUT (same shape as devtasks/REVIEW-scripting-4d-1-round-6-code.md)
- Verdict: APPROVE / APPROVE WITH NITS / CHANGES REQUESTED, naming the
  reviewed 40-character SHA.
- Findings, each with severity (must-fix / should-fix / nit), file:line at
  the reviewed commit, a concrete failure scenario, and how you know it:
  REPRODUCED (you ran it), CONFIRMED IN THE SOURCE (you read it), or
  INFERRED.
- What you ran: commands, per-package test counts, Node version.
- What you couldn't do, plainly. Never report something unrun as passing.
