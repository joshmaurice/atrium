# Task: Peer-identity / routing refactor (Phase 1, step 1)

## Context

This is the first implementation task for the user-accounts work. It is being
done **first and alone**, before any auth or persistence code, because it is
the only change that touches the live SOP protocol and it is fully testable
under the existing anonymous flow. Landing it cleanly de-risks everything
downstream.

The full specification is in `docs/ADDENDUM-user-accounts-final.md`, **item 1
("Peer identity & routing")**. Read that item in full before starting. Also
read the relevant parts of `docs/DESIGN-user-accounts.md` (the Identity Model
and Peer Routing Fix sections) and the identity notes in `AGENTS.md`. This
brief does not restate the spec — item 1 is authoritative. If anything in this
brief appears to conflict with the addendum, the addendum wins; flag the
conflict rather than guessing.

## What to build

Implement item 1 in full: replace the current name-reconstruction convention
(`'User-' + msg.id.slice(0, 4)`) with server-assigned avatar node names and an
explicit `sessionId → { nodeName, displayName }` peer map on the client.

The changes are itemized in the **schema-change inventory** at the bottom of
the addendum — that inventory is the authoritative checklist; implement every
row it lists, not a fixed number from this brief. As of this writing the rows
are:

1. `hello.server` — server assigns and returns `avatarNodeName`
2. `join` — carry `avatar.nodeName`
3. Avatar `add` rebroadcast — server stamps its own `id` (never echo the
   client-supplied value)
4. Avatar `add` — server rejects a `node.name` that doesn't match the
   assigned name
5. `hello` — server rejects a duplicate **currently live** `sessionId` rather
   than allowing two WebSocket connections to share one

If the inventory in the addendum differs from this list, the addendum is
correct — implement what it says.

Treat each inventory row as a separate, self-contained commit.

## How to work

- **Create a branch first.** Do not commit to `main`. Name it something like
  `feature/peer-routing`. All work for this task lives on that branch.

- **One commit per inventory row.** Four focused commits, not one large one.
  Each commit should be independently reviewable and should leave the test
  suite green. This keeps the diffs small enough to review closely.

- **Per AGENTS.md rule 1: schema, validator, and tests move together in the
  same commit.** A commit that changes a message shape without updating its
  JSON Schema and the associated tests is incomplete. Do not split those
  across commits.

- **Tests run against real implementations** (real WebSocket server, real Ajv
  schemas), per the repo's existing convention — no mocks standing in for the
  real thing. Add or update tests to cover: server-assigned name is returned
  in `hello`; `join` carries the node name for both the newcomer-announcement
  and the bootstrap joins about existing peers; the rebroadcast `add` carries
  the server's `id`, not the client's; an `add` with a mismatched name is
  rejected; and a `view` for an unknown session is dropped without crashing.

- **After each commit, run the affected package tests and confirm green**
  before moving to the next. Use the per-package test commands from AGENTS.md
  (not the top-level runner, which has the known gltf-extension failure). Note
  the server-test-hang gotcha in AGENTS.md and run server test files
  individually if needed.

- **Push the branch** to `origin` (the repo is `joshmaurice/atrium`) when the
  four commits are done, so it can be reviewed before any merge to `main`.
  Do not merge to `main` yourself.

## Two points that are easy to get subtly wrong

These are the spots the design review flagged; give them extra care.

1. **The server stamps its own `id` on the rebroadcast `add`.** Do not echo
   `msg.id` from the client. The server does not currently verify that value
   matches the session, so echoing it would let a client impersonate another
   sender. Use the server's known `session.id`.

2. **Ownership/authority stays server-side.** This task doesn't touch
   persistence, but keep the principle in view: node names are assigned and
   enforced by the server, not accepted on trust from the client. The
   name-rejection row is what makes the name-assignment row meaningful —
   without it, clients can still claim arbitrary names. Likewise: if an avatar
   `add` carries `msg.id`, require it to equal the actual `session.id` rather
   than trusting it, and the duplicate-live-`sessionId` rejection at `hello`
   is a live-session integrity rule in the same spirit — two connections must
   not share one session identity.

## Out of scope

No auth, no database, no cookies, no HTTP routes, no persistence. This is
purely the live-protocol identity/routing change under the existing anonymous
flow. If you find yourself needing any of those, stop — something has drifted
from the spec.

## When done

Report: the branch name, the four commit messages, and the test output showing
each affected package green. Do not merge. The diff will be reviewed before
anything reaches `main`.
