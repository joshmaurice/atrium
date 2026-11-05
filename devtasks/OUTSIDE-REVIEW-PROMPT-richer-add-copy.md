You are an outside reviewer for Atrium, an open-source multiplayer glTF browser
(Node.js + Three.js, ES modules, no build step, pnpm workspaces). Review the
DESIGN PRE-BRIEF for its next three rounds: a strict check of every `add`
message, a "richer add" that carries more of a mesh, and copying objects
between worlds. Nothing is implemented yet. Your job is to find what is wrong,
missing or risky before it is. Read-only: don't push, don't open PRs, don't
touch any deployed site.

Repository: https://github.com/joshmaurice/atrium (public)
Review commit: 923bd444305be4067fc589f99c77276a35dbf6c0
Document: devtasks/PREBRIEF-richer-add-copy.md (DRAFT Rev 0.1)
Its line numbers refer to code at f42b5fe, which is identical to 923bd444
except under devtasks/. The released code (PROD) is 84542c73, also identical
outside devtasks/.

STEP 1 — GET THE CODE (please try this first)
  git clone https://github.com/joshmaurice/atrium && cd atrium
  git checkout 923bd444305be4067fc589f99c77276a35dbf6c0
Before anything else, say in your review whether the clone worked. If it
failed, quote the error (earlier reviews sometimes failed on DNS for
github.com). Then fall back to reading files at the pinned commit through:
  https://raw.githubusercontent.com/joshmaurice/atrium/923bd444305be4067fc589f99c77276a35dbf6c0/<path>
  (or https://github.com/joshmaurice/atrium/blob/923bd444305be4067fc589f99c77276a35dbf6c0/<path>)
Don't stop because cloning failed. A source-only review is still valuable;
just label it as one.

STEP 2 — IF YOU HAVE A CLONE, RUN THINGS (Node 22, pnpm 10)
  pnpm install
  (cd packages/protocol && node --test test/*.test.js)
  (cd packages/som && node --test test/*.test.js)
  (cd apps/client && node --test tests/edit-duplicate.test.js tests/edit-undo.test.js)
  # server test files hang if batched, so run each one separately:
  cd packages/server && for f in avatar edit-plumbing; do timeout 180 node --test test/$f.test.js; done; cd ../..
  # the pre-brief's own probes (§2.9), from the repo root:
  node devtasks/spike-richer-add/p1-fixtures.mjs tests/fixtures/*.gltf devtasks/harness/group.gltf
  node devtasks/spike-richer-add/p2-losses.mjs tests/fixtures/{atrium,crate,lamp,space,space-lights,space-cameras,space-anim}.gltf
  node devtasks/spike-richer-add/p3-malformed.mjs
  timeout 60 node devtasks/spike-richer-add/p4-avatar-dump.mjs
  node devtasks/spike-richer-add/p5-shared-material.mjs
Quote the test counts, and the actual output of anything that disagrees with
the document. Most valuable of all: write your own small probe (in
devtasks/spike-richer-add/ style, against the real packages/server/src/session.js
`attachSessionHandlers`, packages/server/src/world.js and
packages/som/src/SOMDocument.js) that tries to break a claim the design relies
on. Include its code and output.

CONTEXT
- The live defect (§2.3): the server checks no geometry or material in an
  `add`, avatar adds from anonymous visitors included. One malformed POSITION
  makes the next join's world serialization throw, so newcomers can't join
  while that visitor stays. p4 reproduces it on the released code. Round 1
  (`add-check`, §4) is the proposed fix.
- Duplicate and Undo's restore are built on `add`, under a lossless rule
  ("D5", edit-duplicate.js): anything an `add` would silently drop makes the
  object refused instead. The richer add widens what's carried; RA-L2 (c) and
  RA-L3 (a) propose two stated exceptions (accessor/buffer labels dropped;
  material sharing not kept).
- Atrium has one real user so far (the operator). PROD is public.
- The decisions (§3, RA-L1–RA-L6, CP-L1–CP-L7) are open, each with a
  recommendation. Say where you'd choose differently, and why.

WHERE TO SPEND THE TIME, in order
1. §2.3 and §4 (add-check). Is A2–A6 complete? Specifically:
   - every field `SOMDocument.ingestNode` reads, and every way it can throw
     or store something `serialize()` can't write, against A2/A3;
   - every first-party sender of `add` (palette, teleporter pads, the avatar,
     Duplicate, Undo's restore, the library and models-by-URL placement, and
     anything in tools/), each checked against A2/A3: would any be refused?
   - other paths that put a malformed mesh or material into the world
     document: `send` on material fields (send-policy.js L57–68, L1407 on),
     the world loaders (createWorld, createWorldFromDocument, the healers),
     a PUT of a whole world. Is `add` really the only hole?
   - what a malformed broadcast `add` does to clients already present (not
     probed, §2.3);
   - whether A4's placement (after K6, before the first world change, fail
     closed) is right in session.js L1226–1420.
2. RA-L4 (avatars refuse the richer fields) and RA-L5 (bounds): are the
   numbers sane against the 1 MiB message cap and Uint16 indices? Anything
   unbounded left?
3. RA-L2 (c) and RA-L3 (a), the two D5 exceptions: what could a user lose
   that matters? Is a stated exception better than a refusal here?
4. §5's richer-add sketch: anything in `buildDescriptor`, `prepareRestore` or
   the client SOM mirror that the sketch misses. Rendering: will
   @gltf-transform/view render emissive, BLEND, double-sided and COLOR_0 on
   an ingested primitive without other changes?
5. The copy step (CP-L1–CP-L7, §6): the security of client-claimed credit
   (CP-L3/L4), pasted behaviours (CP-L5: dropping grants to other objects),
   model URLs made absolute against the source server (CP-L6; consider
   checkModelHost and what a hostile source world could make a paster's
   client fetch), and Inspect mode exposing behaviour graphs to visitors.
6. The order and split (RA-L1, RA-L6): would you ship add-check alone first?

OUTPUT (same shape as devtasks/REVIEW-scripting-4d-rev0.md)
- Verdict: APPROVE / APPROVE WITH NITS / CHANGES REQUESTED.
- Findings, each with severity (must-fix / should-fix / nit), file:line at
  the reviewed commit, a concrete failure scenario, and how you know it:
  REPRODUCED (you ran it), CONFIRMED IN THE SOURCE (you read it), or
  INFERRED. Nothing is "verified" until a fix exists and was run.
- What you ran: commands, per-package test counts, Node version.
- What you couldn't do, plainly. Never report something unrun as passing.
