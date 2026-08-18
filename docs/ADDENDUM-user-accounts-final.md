# Addendum: Final Revisions to DESIGN-user-accounts.md

**Status:** Second-pass consensus (owner, Claude, ChatGPT). AGENTS.md is
approved as-is — no further changes. This addendum covers the design brief
only. All code claims below were verified against the current repo.
**Deliverable:** Fold these into `DESIGN-user-accounts.md`. No implementation
yet. Flag disagreements rather than silently complying.

---

## 1. Peer identity & routing — supersedes the "either join or add" text

Replace the unresolved either/or with the following design. Verified facts it
builds on: `add.json` already defines an optional `id` ("Session UUID —
identifies the sender when adding an avatar node"); the server already uses
`msg.id` as the avatar marker (`session.js:204`) but strips it from the
rebroadcast; `join.json` already has an `avatar` object (`displayName`,
`avatarURL`, position, rotation); and the server already sends the newcomer
one bootstrap `join` per existing peer at hello time (`session.js:146-155`).

**a. Server-assigned avatar node names.** The server assigns
`avatarNodeName` when the WebSocket session is established and returns it in
the `hello` server response (schema change: `hello.server`). The client
adopts the assigned name for its avatar descriptor. Naming scheme is up to
implementation (e.g. `avatar-<8 hex>` with retry-on-collision, or full UUID)
— the requirement is server-guaranteed uniqueness; length is aesthetic once
uniqueness is enforced by construction.

**b. Assignment is enforced, not advisory.** The server rejects an avatar
`add` whose `node.name` does not match the assigned name (consistent with
"invalid messages never touch world state"). Otherwise clients can still
claim arbitrary names and the assignment accomplishes nothing.

**c. Stamp `id` on rebroadcast — server's own value.** The outbound avatar
`add` broadcast carries `id: session.id`, stamped by the server. Never echo
the client-supplied `msg.id` — the server does not currently verify it
matches the session, and echoing it would allow sender impersonation.
(`add.json` already permits `id`, so this leg may need no schema change —
but it needs tests either way.)

**d. Enrich `join` with `avatar.nodeName`.** Schema change to `join.json`
(the `avatar` container already exists). Include it in the bootstrap joins
sent to a newcomer (server knows every established peer's node name at that
point) and in the newcomer-announcement join (server now knows the name at
hello time, before the avatar `add` even arrives).

**e. Client peer map.** Evolve `_peerSessions` into peer metadata:
`sessionId → { nodeName, displayName }`, populated from `join` and `add`.
Routing uses `nodeName` exclusively; UI uses `displayName`. A `view` for an
unknown session is dropped silently. A `view` for a known session whose node
is not yet in the SOM (mapping arrived before the `add`) is also skipped
without error.

**f. Display name transport.** Cosmetic names travel in
`join.avatar.displayName` (existing field) and `node.extras.displayName`.
No routing path may depend on deriving names from session IDs.

**g. Update the identity-model table.** `avatarNodeName` is *server-assigned*,
not "derived from sessionId by convention." Delete the `slice(0,4)`
convention from the design entirely (4 hex chars = 65,536 names; ~7%
collision probability at the default 100 concurrent users, and SOM keys
nodes by name, so a collision cross-wires avatars).

---

## 2. Phase-1 persistence semantics — define what "save" means

**a. Definition.** A Phase-1 saved world is a **personal, avatar-free
snapshot of the currently hosted live world**, loaded later as a static
client-side world. State this explicitly.

**b. Avatar exclusion.** `world.serialize()` currently filters only
externally-ingested reference nodes; avatars are included (verified). Add a
persistence-serialization option (e.g. `serialize({ excludeNodes })`) fed
from the server's own tracked `session.avatarNodeName` values — not from any
extras marker, matching the design's authority philosophy. som-dump
serialization continues to include avatars; persistence excludes them. These
are two modes of one serializer, not a behavior change to som-dump.

**c. Defer server-side loading explicitly.** Loading a persisted world into
a live multiplayer server runtime is Phase 2 work, and it is the actual
prerequisite for multiplayer home worlds. Name it in the Phase 2 section as
its own capability (server world-lifecycle work), rather than implying it
exists via "auto-load home world on login."

---

## 3. Terminology — de-collide "session"

Rename the auth table `auth_sessions` and refer to the cookie value as
`authSessionId`. Reserve `sessionId` exclusively for the live WebSocket
session identity. Sweep the document for the resolve-cookie wording so it
reads "resolves `authSessionId → userId`" at upgrade, distinct from the
WebSocket `sessionId`.

---

## 4. Phase-1 visibility — make it internally consistent

All Phase-1 persisted worlds are **private**. The `visibility` column exists
from day one with a fixed value; the public toggle, unauthenticated
`GET /api/worlds/:id`, and `/public/<user>/<slug>` addressing all arrive in
Phase 2 together. Remove "public worlds need no auth" from the Phase-1 load
flow. (Anonymous users continue to browse ordinary static glTF worlds as
today — that path is unaffected.)

---

## 5. CSRF — right-size it

No token-synchronizer machinery. Phase 1 specifies: validate `Origin` on
state-changing HTTP routes, keep CORS closed to foreign origins, retain
`SameSite=Lax`, and optionally require an Atrium-specific request header
(cross-origin pages cannot set custom headers without a CORS preflight that
will never be approved). `Origin` validation on the WebSocket upgrade stays
as already specified.

---

## 6. Implementation sequencing (record in the design)

When implementation begins, **land the peer-identity/routing refactor (item
1) first and alone**, under the existing anonymous flow. It is the only
piece that touches the live protocol, it is fully testable without any auth
or persistence code existing, and proving it out first de-risks everything
downstream. Auth + persistence follow as a second step.

---

## Schema-change inventory for item 1 (for planning)

| Change | Type |
|---|---|
| `hello.server` — add assigned `avatarNodeName` | Schema + server + client + tests |
| `join` — add `avatar.nodeName` | Schema + server + client + tests |
| Avatar `add` rebroadcast — stamp server-side `id` | Server behavior + client + tests (schema already permits `id`) |
| Avatar `add` — reject name ≠ assigned name | Server behavior + tests |

Per AGENTS.md rule 1, schemas, validators, and tests update atomically.
