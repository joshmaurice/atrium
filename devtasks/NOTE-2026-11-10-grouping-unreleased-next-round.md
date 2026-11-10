# Note 2026-11-10: grouping is finished but NOT released; next, choose the next round with the operator

This note is for a new session that helps the operator **choose the next
round** (it is NOT decided yet), then writes its pre-brief, while the grouping
round waits for its release.

There is no shipped passdown for grouping yet. That gets written after PROD,
in the grouping session.

## Remind the operator: the grouping release is NOT done
**DEV acceptance has not been done**, and nothing is deployed. The deploy,
the DEV acceptance (steps 1–8), MAIN, PROD and the shipped passdown all
happen **in the grouping session**, not in yours:
https://claude.ai/code/session_01FmgBcrPRmmGxPjg5k2XkRC

That session holds the release package (`devtasks/RELEASE-grouping.md`). It
fills in the SHAs, checks DEV's actual SHA after the deploy, and fixes
anything the acceptance turns up.

- Tell the operator this in your first reply, and again whenever they
  mention being back at a laptop, deploying or testing.
- Don't run the release yourself, and don't give the host commands from
  your session.
- Before the deploy, the operator opens one DEV tab and leaves it alone:
  step 7 needs a tab from before the deploy.

## First instruction for the new session's Claude
1. **Get the repo.** Use `add_repo` on `joshmaurice/atrium` with access
   `push`, and clone to `/home/claude/atrium`.
2. **Read these, in order:**
   1. `devtasks/Atrium-Passdown-2026-11-08-selection-parts-shipped.md` (on
      `main`): the rules, lessons and conventions, which all still hold;
   2. this note (on `claude/grouping`);
   3. `devtasks/PREBRIEF-grouping.md` (FINAL Rev 2.0) and
      `devtasks/HANDOFF-grouping.md`.
3. **Branch:** once the round is chosen, work on a NEW branch named for it
   (`claude/<round>`), made from `origin/claude/grouping`. Every candidate
   touches the Edit panel that grouping changed.
   - **Never commit to `claude/grouping`**: its tip is the release
     candidate.
   - **Never commit to `main`.**
4. **Pre-brief only.** No implementation until grouping is `COMPLETE` on
   PROD and the operator says go. Its DEV acceptance may still change
   grouping's code, which the next round would build on.
5. **The operator is away from a laptop for now.** Ask decisions with
   AskUserQuestion, short and phone-friendly. Nothing that needs host
   commands or a mouse.
6. **Use `atrium-ops`** (read-only) for release state. Check
   `release_status`, and expect `COMPLETE` on `331e4aed` until grouping
   ships.

## Where things stand (2026-11-10, 08:35 PT)

**The grouping round, on `claude/grouping`:**
- **Commits:** nine, `de33cf8..8d4ff38`, plus later commits that change
  `devtasks/` only.
- **What it adds:** Group, Ungroup, Move to… and the Empty groups dropdown in
  the Edit panel.
  - The new `send` field `parent` lets the server reparent a node.
  - Stale tabs are refused at Connect.
  - Composite Undo entries.
- **Checks:**
  - the fresh-agent code check (HANDOFF §7);
  - the outside review by Fable 5.2 (APPROVE WITH NITS, HANDOFF §8);
  - all findings taken, and all suites and harness checks pass.
- **Release:** waits for the operator at a laptop. `devtasks/RELEASE-grouping.md`
  has the commands, the acceptance steps and the release notes.

**Releases:** DEV and PROD are on `331e4aed` (`selection-parts`).

## The next round: NOT decided; discuss it with the operator first
Earlier on 2026-11-10, the grouping session suggested **multi-select**, and
the operator agreed to it. Later, after asking about the alternatives, the
operator wanted to discuss the choice further, in a fresh session (this one).

**Start there:** lay out the candidates, look into anything the operator
asks, recommend one, and let them choose. Look things up in the code before
stating them: the grouping session's first answer about colour controls was
wrong.

**The candidates:**

### 1. Multi-select
The grouping session recommended it.
- **What it is:** several objects selected at once (Shift-click), with the
  breadcrumb showing their common ancestor. It's the selection passdown's
  §5 first candidate.
- **Payoff:** Group of several objects at once. GR-L1 deferred multi-select
  to its own round.
- **Cost:** it builds directly on grouping's controls and Undo engine. So
  build it only after grouping ships: DEV acceptance may change that code.

### 2. Materials in the Edit panel
The operator's interest, 2026-11-10.
- **Today:** the Edit panel has no colour or material control. A material
  changes only through the SOM Inspector's property sheet or a script's
  `send` to a material path. Behaviours don't write materials.
- **Since subtree-add (SA-L3 (b)):** copying a group can make a shared
  material. A recolour of one sharer then changes all of them, live, for
  everyone, with no warning.
- **The passdown's candidate** was only the warning: "shared with N other
  parts" (subtree-add pre-brief §8). That's thin while the panel has no
  material control.
- **A fuller round:**
  - a colour control, maybe metallic and roughness;
  - the sharing notice beside it;
  - "make this one unique", to recolour one object only. That needs a way
    to give a primitive its own material, and the authority question for
    material identity: RA-L3 (c), 4d-1 passdown §5.1.
- **Cost:** it touches less of grouping's code than multi-select, but still
  `app.js` and `index.html`.

### 3. The texture limit
The operator hit it: adding a model said "this world has loaded its limit of
textures".
- **Where it is:** `packages/renderer-three/src/model-parse.js` L26–40, L369:
  - 512 MiB of decoded texture memory per world, in the page;
  - a 4,096 px texture side limit.
- **A suspicion, unconfirmed:** from a quick read of `model-bridge.js`, the
  budget is only given back when a parse fails or the world changes. Deleting
  a model may not return its share until a reload.
- **If confirmed,** that's a bug fix that could stand alone, or join a round.
- Investigate before saying more.

### 4. The rest of the selection passdown's §5 list, and its follow-ups
Grouping's own follow-ups are in HANDOFF §8. One is caching the Ungroup
button's check, which only matters for big worlds.

**Once chosen:** the pre-brief, on the round's branch. Build only after
grouping is on PROD, unless the operator decides otherwise. Option 3, a fix,
might be the one exception: weigh it with the operator.

The natural payoff is **Group of several objects at once**. GR-L1 deferred
multi-select to its own round.

**If multi-select is chosen,** the questions its pre-brief will need, as a
starting list, not decisions:
- **Selection:**
  - how Shift-click adds and removes;
  - what the selection's level is when the objects sit at different levels
    (the `selection-parts` rules);
  - the outline;
  - the breadcrumb (their common ancestor);
  - Escape.
- **The Edit panel with several selected:**
  - which fields show (Name can't);
  - the handles: one gizmo at a pivot? moving them all as one Undo entry?
  - which actions apply: Delete, Duplicate and Copy of several; **Group of
    several** (where the group goes: the common parent? what if their parents
    differ?); Move to of several; Ungroup of several groups.
- **Undo:** one entry per action across several nodes. Grouping's composite
  runner (`edit-undo.js` `startComposite`, phases) is the base. Partial
  outcomes follow GR-L7 (a).
- **Grouping's rules applied to several objects:** GR4's bounds (the counts
  of all the objects together), GR-L9 (visibility), GR-L10 (behaviours), the
  model rule (review N-1), and the ask-first questions.
- **Other tabs:** another tab deletes, moves or regroups one of the selected
  objects.
- **The wire:** is a batch message needed, or are several `send`s enough?
  (Grouping sends one `parent` per node.)
- **Touch:** is there a Shift on a phone? The SP-L11 notes on touch.

**The process, as for every round** (selection passdown §4):
1. a pre-brief;
2. a fresh-agent check;
3. an outside review (Fable, given a SHA-pinned prompt);
4. the operator's decisions;
5. FINAL.

Probes go in `devtasks/spike-<round>/`.
