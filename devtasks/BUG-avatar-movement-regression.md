# Bug: peer-routing merge broke avatar movement (AvatarController not updated)

**Severity:** Regression on `main` (commit `ec493aa`). Movement and view-sync
are broken in live multiplayer. Caught in the dev environment before reaching
production — production still runs the pre-merge commit and is unaffected.

**This is on a new branch, not a direct commit to `main`.** Branch from `main`,
name it `fix/avatar-local-node-lookup` (or similar), fix, test, push for
review. Do not merge to `main` yourself.

## Symptom (observed live, two-client test)

With the merged code (new client + new server), on connecting to a world:
- The local avatar **cannot move** (click-to-move registers pointer events but
  nothing happens).
- **No `view` messages are sent** by the client at all (confirmed in the
  browser WebSocket frame inspector — zero outgoing `view` frames on movement).
- Peers **appear** on join but **never animate** (their movements don't render).
- Presence works correctly (join/leave propagate; peer count updates).

Diagnosis was by isolation: rolling the dev checkout back to `6d48486` (the
commit just before the peer-routing work, camera commits included) **restores
movement**. Rolling forward to `ec493aa` breaks it. So the regression is
within the peer-routing commits `b4720e9..ec493aa`, not the pre-existing
camera work.

## Root cause

The peer-routing merge changed avatar node naming: the server now assigns each
avatar node the name `avatarNodeName` (e.g. `avatar-25b70429`), replacing the
old convention where the node's name **was** the `displayName` (e.g.
`User-25b7`).

`AtriumClient` was updated for this (peer map keyed on the new scheme). But
**`packages/client/src/AvatarController.js` was not touched by the merge** and
still resolves avatar nodes by `displayName`:

- Line ~89 — local node lookup:
  ```js
  const displayName = this._client.displayName
  const localNode   = som.getNodeByName(displayName)   // looks up "User-78e5"
  ```
  The node is now actually named `avatar-78e5ad7a`, so this lookup **fails**,
  `_localNode` is never set, the navigation/movement path has no node to drive,
  and `setView()` is therefore never called — hence zero `view` messages and no
  movement.

- Lines ~118-159 — peer resolution also keys on `displayName`
  (`extras.displayName`, `getNodeByName(displayName)`, `this._peers` keyed by
  displayName). This is now inconsistent with the actual node names and with
  `AtriumClient`'s new peer map, and is the likely reason peers appear but
  don't animate.

In short: the naming contract was changed in the server and `AtriumClient`,
but `AvatarController` — a separate consumer of the same convention — was left
resolving nodes by the old `displayName`. Incomplete refactor.

## What to fix

Reconcile `AvatarController` with the new naming scheme. The local avatar node
(and peer nodes) must be resolved by the **server-assigned `avatarNodeName`**,
not by `displayName`. Concretely:

1. **Local node lookup (line ~89):** resolve the local avatar node by the
   client's assigned `avatarNodeName` (the value `AtriumClient` receives in the
   `hello` response and stores as `_avatarNodeName`), not by `displayName`.
   Confirm `_avatarNodeName` is set on the client before `_onWorldLoaded` runs;
   if there's an ordering dependency (world loaded before hello assigns the
   name, or vice versa), handle it explicitly rather than relying on timing.

2. **Peer resolution (lines ~118-159):** peers must be tracked/resolved by
   their `nodeName` (available in the peer map / `join.avatar.nodeName`), with
   `displayName` used only for **display** (labels, logs). Do not key peer
   lookup or the `_peers` map on `displayName`.

3. **Camera node naming (line ~92):** the child camera node is named
   `${displayName}-camera`. If any lookup depends on that name, update it to
   derive from the node name instead. If it's only ever accessed via the object
   reference, leave it — but check.

Keep `displayName` for what it's for: human-readable labels. Use
`avatarNodeName`/`nodeName` for every SOM node lookup.

## Required test — the one that would have caught this

The existing tests passed because they exercised protocol handlers in
isolation and never ran the full "client resolves its own avatar node and
begins sending view updates" path with two real clients.

Add an integration test that:

1. Stands up a real server, connects a client, waits through the full
   hello → world-load → add sequence.
2. Asserts the client **successfully resolves its local avatar node** after
   connect (i.e. `AvatarController._localNode` is non-null and corresponds to
   the server-assigned `avatarNodeName`, not a `displayName`-named node).
3. Simulates local movement (`setView`) and asserts a `view` message is
   actually **sent** over the socket.
4. With a second connected client, asserts that client **receives** the
   `view` and that the moving peer resolves to a real node on the receiver.

At minimum, assert #2 and #3 — "after connect, the client can find its own
avatar node and sends a view on movement." That single assertion fails against
the current code and passes once the lookup uses `avatarNodeName`.

Per the standard adversarial/integration-testing expectation: a green unit
suite is not sufficient evidence that live multiplayer works. This test closes
the specific gap.

## Verify before pushing

After the fix, run the affected package tests per AGENTS.md (per-file for
server), and — importantly — confirm the fix **live** if possible, or at least
that the new integration test exercises the real path. The bug was invisible to
unit tests; the proof is the integration assertion going from red to green.

Report the branch name, commits, and test output (especially the new
integration test). Do not merge.
