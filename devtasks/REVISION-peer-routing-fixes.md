# Revision: fixes for feature/peer-routing (before merge)

**Status:** The branch is architecturally correct and all four commits are in
good shape — schemas, server-stamped `id`, duplicate-session guard, and the
client peer-map migration are right. Do **not** start over. These are targeted
fixes to the existing branch, committed on top of the existing four commits
(or amended into them if you prefer a clean history). Push to the same
`feature/peer-routing` branch. Do not merge to `main`.

Line numbers below are as of commit `216455d` on the branch; if they've
shifted, match on the code, not the number.

---

## Must fix

### 1. Delete the line that clobbers the server-assigned avatar name

`packages/server/src/session.js`, line 252:

```js
if (msg.id) session.avatarNodeName = msg.node.name
```

**Delete this line.** The server already assigns `session.avatarNodeName =
'avatar-' + sessionId.slice(0,8)` at `hello`, and that value is authoritative.
This line overwrites it with whatever name the client sent in the avatar
`add` — handing naming authority back to the client, which is exactly what
this whole task exists to prevent. It appears harmless today only because the
name-match check three lines up guarantees the two values are already equal.
The moment a client is allowed a custom name (the accounts work coming next),
this line silently re-introduces client-controlled naming. The server's
assigned name must never be reassigned from client input.

### 2. Resolve the reject-vs-rewrite redundancy

`packages/server/src/session.js`. There are currently **two** mechanisms
enforcing the avatar name, and they overlap:

- The rejection at line ~242: rejects an `add` whose `node.name` doesn't
  match `session.avatarNodeName`.
- The rewrite at line ~254: `const broadcastNode = (msg.id && ...) ? { ...msg.node, name: <assigned name> } : msg.node` — forces the assigned name onto the rebroadcast.

If the rejection stands, `msg.node.name` is already guaranteed to equal the
assigned name by the time the rewrite runs, so the rewrite overwrites a value
with itself — dead code. Pick one strategy:

- **Recommended:** keep the rejection (it gives the client a clear
  `PERMISSION_DENIED` error), and **drop the rewrite** — broadcast `msg.node`
  directly, since it's already validated to carry the correct name.
- Alternative: keep the rewrite (server force-corrects silently) and drop the
  rejection. Weaker, because the client never learns it sent a bad name.

Don't keep both. Two mechanisms for one invariant means a future edit to one
silently breaks the contract the other was enforcing.

---

## Should fix

### 3. `_onRemove` fallback reconstructs a name that can't match

`packages/client/src/AtriumClient.js`, ~line 458:

```js
const nodeName = isPeerRemove
  ? (peerMeta ? peerMeta.nodeName : `User-${msg.id.slice(0, 4)}`)
  : msg.node
```

If `peerMeta` is missing, the fallback reconstructs an old-style `User-xxxx`
name — but the server now assigns `avatar-xxxx` names, so the reconstructed
name will **not** match the actual SOM node, the removal silently no-ops, and
a ghost avatar is left behind. On a remove, the peer should already be in the
map; a miss is an error condition, not something to paper over with a guess.
Either drop the fallback and log a warning on a map-miss, or handle the miss
explicitly — but don't reconstruct a name that structurally cannot match.

### 4. Retire the remaining old-derivation fallbacks

`packages/client/src/AtriumClient.js`, ~lines 419 and 483 (and 458 per above):
the surviving `?? \`User-${msg.id.slice(0, 4)}\`` fallbacks. Now that `join`
always carries `avatar.nodeName`, these only fire on malformed input — and
when they fire, they fail *silently back to the old broken behavior*, which
hides regressions. Replace the silent fallback with a logged warning (and, if
appropriate, skipping the operation) so that a missing `avatar.nodeName`
surfaces as a visible problem rather than a quiet revert. Do not leave the
old derivation as an invisible safety net.

(Note: line ~220 in `connect()`, `const shortId = sessionId.slice(0, 4)` for
the client's *own* initial `_displayName`, is fine to keep — that's the
client naming itself pre-hello, not deriving a peer's name. See item 5.)

---

## Verify (and add the missing test)

### 5. Prove the server-assigned name wins over the client's

This is the test the current suite is missing, and its absence is why bugs 1
and 2 passed green. Every existing test exercises the happy path where the
client and server names already agree, so the clobber writes the same value
and the reject/rewrite see matching names. **Add a test where they
disagree:**

- Client connects, receives `hello` with a server-assigned `avatarNodeName`.
- Client sends an avatar `add` whose `node.name` is something *different* from
  the assigned name (simulating a client that ignored or predates the
  assignment).
- Assert the server **rejects** it with `PERMISSION_DENIED` (per the strategy
  chosen in fix 2), and that `session.avatarNodeName` is **unchanged** (still
  the server-assigned value) — this locks in fix 1.
- Separately assert that when the client sends the *correct* assigned name,
  the rebroadcast `add` carries that name and `id: session.id`.

Also confirm (by test or by tracing the connect sequence) that the client
cannot send its avatar `add` before `_onServerHello` has run and corrected
`_avatarNodeName`/the descriptor. The normal sequence (hello → hello-response
→ add) should guarantee this, but a test asserting the `add` descriptor
carries the *server-assigned* name (not the client's pre-hello `User-xxxx`)
would make the guarantee explicit rather than incidental.

---

## When done

Re-run the affected package tests (protocol, server, client) per the AGENTS.md
per-package commands and confirm green — including the new disagreement test,
which should fail against the current code and pass after fixes 1 and 2. Push
to `feature/peer-routing`. Report the new/amended commits and the test output,
especially the new disagreement test. Do not merge.
