# Task: <TITLE> (Phase <N>, step <M>)

> Reusable template. Copy this file to `devtasks/TASK-<name>.md`, fill the
> `<...>` placeholders, delete guidance lines in blockquotes, and hand to the
> implementing agent. The standard discipline and the adversarial-testing
> clause are pre-filled — keep them.

## Context

> One paragraph: what this task is, where it sits in the plan, and why it's
> being done now / in this order. If it depends on earlier work being merged,
> say so.

The authoritative specification is in `<docs/DESIGN-....md>`, section
`<...>`. Read it in full before starting. Also read `AGENTS.md` for stack,
conventions, and known gotchas. This brief does not restate the spec — the
design doc is authoritative. **If anything here conflicts with the design doc,
the design doc wins; flag the conflict rather than guessing.**

## What to build

> Describe the change at the level of intent, then point at the authoritative
> checklist. Prefer referencing an itemized list in the design doc over
> re-listing here, so this brief can't drift from the spec.

Implement `<...>`. The individual changes are itemized in `<the inventory /
checklist location in the design doc>` — that list is the authoritative
checklist; implement every item it lists, not a fixed number from this brief.
If the list in the design doc differs from any summary here, the design doc is
correct.

## How to work

- **Create a branch first.** Do not commit to `main`. Name it
  `feature/<name>`. All work for this task lives on that branch.

- **One commit per checklist item.** Focused, independently reviewable
  commits — not one large one. Each commit should leave the test suite green.

- **Per AGENTS.md: schema, validator, and tests move together in the same
  commit.** A commit that changes a message/data shape without updating its
  schema and the associated tests is incomplete. Do not split those across
  commits.

- **Tests run against real implementations** (real server, real schemas, real
  documents), per the repo convention — no mocks standing in for the real
  thing.

- **After each commit, run the affected package tests and confirm green**
  before moving on. Use the per-package test commands from AGENTS.md, not the
  top-level runner (known gltf-extension failure). Mind the server-test-hang
  gotcha and run server test files individually if needed.

- **Push the branch** to `origin` (`joshmaurice/atrium`) when done, for review
  before any merge to `main`. **Do not merge to `main` yourself.**

## Authority boundaries — test the disagreement case, not just the happy path

> This section is standard and applies to every task. Keep it verbatim. Its
> purpose is to close a recurring blind spot: happy-path tests that only cover
> the case where client and server already agree, leaving the real invariant —
> "the server decides, the client is not trusted" — untested. Code can pass a
> full green suite while silently violating that invariant, because the
> invariant only bites when inputs disagree.

For any code in this task that enforces server authority — anywhere the server
assigns, validates, rejects, or overrides a value the client also supplies —
the tests **must** include at least one case where the client sends a value
that **conflicts** with what the server expects, and assert the server's value
wins.

A happy-path test (client sends the value the server would have assigned
anyway) does **not** satisfy this — it passes whether or not the check works,
because the two values are identical. The proving test is the one where they
differ. For each authority boundary, write a test that:

1. Puts the server in its authoritative state (it has assigned/decided the value).
2. Has the client send a **different** value for the same thing.
3. Asserts the server **rejects** (with the specific error code) or
   **overrides** with its own value — whichever the design specifies.
4. Asserts the server's authoritative state is **unchanged** by the attempt.

**Before considering the task done**, for every line where the server reads a
client-supplied value, ask: *"What happens if the client lied here?"* If a
test doesn't cover it, that test is missing. "It can't happen because the
client is well-behaved" is not an answer — server authority means not
depending on the client being well-behaved.

If this task has **no** authority boundary (pure client-side work, a
mechanical refactor with no trust decision), **say so explicitly in your
report** rather than omitting this section silently — so the absence is a
recorded decision, not an oversight.

## Points that are easy to get subtly wrong

> Task-specific. List the spots the design review flagged for this particular
> task — the places where a plausible-looking implementation is subtly wrong.
> If none, delete this section.

1. `<...>`

## Out of scope

> Name what this task must NOT touch, so scope creep is visible. E.g. "No auth,
> no persistence — purely the live-protocol change." If the agent finds itself
> needing something out of scope, it should stop: something has drifted.

`<...>`

## Live verification (protocol-touching work only)

> Keep this section for any task that changes the live protocol, the
> connect/hello/add sequence, avatar/node handling, movement, or anything
> exercised only when real clients talk to a real server. Delete it for pure
> mechanical refactors with no runtime multiplayer surface.

A green unit suite is **not** sufficient evidence that this works. The
regression this project has already hit (avatar movement broke while every
unit test passed, because the tests exercised handlers in isolation and never
ran the full "client resolves its own avatar node and starts sending view
updates" path) must not recur.

Therefore, for protocol-touching work, "done" requires either:

- an **integration test** that stands up a real server, connects one or more
  real clients through the full connect sequence, and asserts the actual
  end-to-end behavior (not just that a handler returns the right value in
  isolation); and/or
- a note in the report that the change needs a **live two-client smoke-test in
  the dev environment** before merge — the reviewer will run it (two browser
  tabs, confirm avatars move and see each other) as a merge gate.

State explicitly in the report which of these covers the change, and what the
untested residual risk is. Do not claim the task is verified on unit tests
alone if it touches live multiplayer behavior.

## When done

Report: the branch name, the commit messages (one per checklist item), and the
test output showing each affected package green — **including the
disagreement/authority tests**, which should fail against the pre-change code
and pass after. For protocol-touching work, also report how the live
verification above is satisfied. Do not merge; the diff will be reviewed, and
protocol-touching changes will be live-smoke-tested in dev, before anything
reaches `main`.
