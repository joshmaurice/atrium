# Addendum: Final Cleanup Before User Accounts Implementation

**Status:** Architecture approved. Make these targeted cleanup edits to `DESIGN-user-accounts.md`, then proceed to implementation sequencing.  
**Scope:** Documentation/design cleanup only. Do **not** reopen the broader architecture unless one of these points conflicts with an implementation constraint you can identify.

---

## 1. Make the same-origin hosting model concrete

The design correctly assumes that the bundled Atrium web client and world server share an origin for Phase 1 cookie authentication, but it does not yet specify how that is achieved operationally.

Add an explicit deployment assumption choosing one of these equivalent shapes:

- the new Atrium HTTP server also serves `apps/client`, **or**
- a same-origin reverse proxy serves the client and proxies `/api/*` plus the WebSocket endpoint to the Atrium server.

The important requirement is that the browser sees the client, account API, and WebSocket endpoint as the same origin in Phase 1.

Also make the session cookie attributes explicit:

```text
HttpOnly; Secure; SameSite=Lax; Path=/
```

A `__Host-` cookie name may be used if convenient (for example, `__Host-atrium_auth_session`) provided the deployment satisfies the corresponding requirements.

---

## 2. Tighten avatar `add` and live-session identity integrity

The server-assigned `avatarNodeName` design is approved. Add these enforcement rules:

- If an avatar `add` contains `msg.id`, require it to equal the actual server-side `session.id`.
- Never trust or rebroadcast the client-supplied `msg.id`; continue stamping the server's own `session.id` on the outbound avatar `add`.
- Reject use of the session's assigned avatar node name in an `add` that is not the session's valid avatar add.
- At `hello`, reject a duplicate **currently live** `sessionId` rather than allowing two WebSocket connections to share one.

These are defensive integrity rules, not a change to the identity architecture.

---

## 3. Remove Phase-1 database and visibility ambiguity

### Database

Choose **SQLite for Phase 1**.

Postgres should be explicitly documented as future/adaptor work, not something the Phase-1 implementation needs to support in parallel.

Change wording such as:

```text
SQLite / Postgres
```

to something like:

```text
SQLite (Phase 1); Postgres adapter may be added later
```

### World visibility

Phase 1 says persisted account worlds are all private, while the current `POST /api/worlds` example still accepts `visibility`.

Make those agree.

Recommended Phase-1 API:

```text
POST /api/worlds
body: { slug, name }
```

The server sets:

```text
visibility = "private"
```

internally.

The `visibility` column may remain in the schema for forward compatibility. User-selectable public/private visibility begins in Phase 2.

---

## 4. Finish specifying `displayName`

The identity model correctly separates:

- `avatarNodeName` — routing/internal scene identity
- `displayName` — cosmetic user-visible identity

Specify the Phase-1 initialization rule:

```text
displayName = username
```

at registration.

Editable/custom display names can be deferred unless there is a reason to include editing in Phase 1.

Also make the server authoritative for the display name distributed to peers:

- `join.avatar.displayName` should come from server-known user/session state.
- The server should canonicalize or overwrite avatar `node.extras.displayName` rather than trusting an arbitrary client-supplied value.

Routing must never depend on `displayName`.

### Anonymous naming wording

The document currently says anonymous users appear as `Guest-xxxx` while calling that "matching current behaviour." Current Atrium behaviour is `User-xxxx`.

Either:

- keep `User-xxxx` in Phase 1, or
- intentionally change anonymous presentation to `Guest-xxxx` and describe it as a Phase-1 UX change rather than existing behaviour.

---

## 5. Update the password baseline

The current design says minimum password length is 8 characters.

For username + password as the sole authentication factor, update the Phase-1 baseline to:

- minimum password length: **15 characters**
- no composition/complexity rules
- check newly chosen passwords against a blocklist of common, expected, or known-compromised passwords
- continue using Argon2id (or scrypt) for password hashing

This preserves the "lowest viable ceremony" principle while bringing the password policy in line with the current NIST approach.

---

## 6. Fix two documentation inconsistencies

### Identity count

The Identity Model currently says:

> Four distinct identities

but lists five:

1. `userId`
2. `sessionId`
3. `avatarNodeName`
4. `authSessionId`
5. `displayName`

Change the text to **five distinct identities**.

### Auth-session table name

The security section still refers once to sweeping the `sessions` table.

Change that to:

```text
auth_sessions
```

to match the revised schema and terminology.

---

## Implementation decision after these edits

No further broad architecture pass is required unless one of the cleanup items above exposes a concrete conflict.

After updating the document, begin implementation with the already-approved first milestone:

### Step 1 — Peer identity and routing refactor, anonymous only

- server assigns and returns `avatarNodeName`
- server enforces the assigned avatar name
- server stamps its own `session.id` on avatar `add`
- `join` carries `avatar.nodeName`
- client uses explicit `sessionId → { nodeName, displayName }` peer metadata
- schemas, validators, and tests update atomically
- no authentication or persistence code in this first step

Once that works under the existing anonymous flow, proceed to Phase-1 authentication and persistence.

---

**Instruction to Hermes:** Apply these edits to `DESIGN-user-accounts.md`. If you disagree with any item because of a concrete codebase or deployment constraint, flag that disagreement explicitly rather than silently changing the intent.
