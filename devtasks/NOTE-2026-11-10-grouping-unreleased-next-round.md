# Note 2026-11-10: grouping is finished but NOT released; next, the multi-select pre-brief

This note is for a new session that starts the next round's **pre-brief**
while the grouping round waits for its release.

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
3. **Branch:** work on a NEW branch, `claude/multi-select`, made from
   `origin/claude/grouping` (the design builds on grouping's controls).
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

## The next round: chosen as the pre-brief to write
The operator agreed (2026-11-10) to write the **multi-select** pre-brief now
and build it once grouping ships. It is the first candidate in the selection
passdown's §5: several objects selected at once (Shift-click), with the
breadcrumb showing their common ancestor.

The natural payoff is **Group of several objects at once**. GR-L1 deferred
multi-select to its own round.

**Questions the pre-brief will need**, as a starting list, not decisions:
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

Probes go in `devtasks/spike-multi-select/`.
