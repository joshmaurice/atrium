# Review Memo: Revisions to AGENTS.md and DESIGN-user-accounts.md

**Status:** Consensus review — revise the documents; do not implement yet.
**Reviewers:** Repo owner, Claude, ChatGPT (both reviews verified against the
current codebase: `AtriumClient.js`, `session.js`, `world.js`, `index.js`,
`hello.client.json`, `DESIGN-user-objects.md`).
**Deliverable:** Revised `AGENTS.md` and `DESIGN-user-accounts.md` only.
Return the drafts for a second-pass architecture review before any code is
written.

---

## Part 1 — AGENTS.md (minor revisions; document is otherwise good)

1. **Date the Status section.** Retitle it "Status as of YYYY-MM-DD" and add a
   line instructing agents to verify against recent commits before relying on
   it. Stable architectural facts and transient repo status age at different
   rates; make the distinction visible.

2. **Fix the avatar node-name detail.** The file currently says the shortId is
   used as avatar `node.name`. The actual behavior in `AtriumClient.js` is:
   `displayName = 'User-' + shortId` and `_avatarNodeName = _displayName`.
   The node name is the *display name*, not the bare shortId. Correct this.

3. **Add an explicit agent rule:** *"Do not change SOP message structure
   without updating its JSON Schema in `@atrium/protocol` and the associated
   tests."* The validator maps message types directly to Ajv schemas
   (including direction-specific forms for `hello` and `view`); this rule is
   implicit in the codebase and should be explicit in the doc.

4. **Document the identity coupling as a known constraint.** `_onView()` and
   `_onJoin()` resolve peer avatar nodes by *recomputing* the node name from
   the session ID (`'User-' + msg.id.slice(0, 4)`). Multiplayer peer routing
   therefore structurally depends on sessionId → displayName → node name
   being derivable. Note in AGENTS.md that this coupling exists and that any
   feature introducing custom display names or multiple sessions per user
   must break it deliberately (see Part 2, item 2).

---

## Part 2 — DESIGN-user-accounts.md (substantive revision required)

### 1. Add an Identity Model section

Define four distinct identities and their lifetimes:

| Identity | Nature |
|---|---|
| `userId` | Stable UUID, server-generated, lives in the database |
| `sessionId` | New UUID per WebSocket connection (existing behavior) |
| `avatarNodeName` | Unique per *session* in the SOM; must NOT be assumed equal to displayName |
| `displayName` | Mutable, cosmetic, user-chosen for accounts; `User-xxxx` / `Guest-xxxx` for anonymous |

Explicitly address: one user with multiple simultaneous sessions (two tabs,
two devices) — node names must not collide; display names may repeat but node
names may not.

### 2. Fix peer view/presence routing

Replace the name-reconstruction convention with an explicit
`sessionId → avatarNodeName` mapping established once at presence time.
`view` messages continue to carry only the sessionId. Evolve the client's
`_peerSessions` into proper peer metadata holding this mapping.

Specify where the mapping is established — either enrich the `join`
broadcast to carry the avatar node name, or have the client build it from the
`add` message (which then must carry the sessionId). Specify the race
behavior: a `view` arriving for a session with no known mapping is dropped
silently (no crash, no name guessing). This is a required protocol/schema
change; update `@atrium/protocol` schemas and tests accordingly.

### 3. Replace JWT/localStorage with an opaque server-side session cookie

Remove JWT and localStorage from the design entirely. Phase 1 auth:

- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`,
  `GET /api/auth/me`
- On successful login: generate a cryptographically random session ID, store
  `sessionId → userId` (with expiry) in a `sessions` table, and set
  `atrium_session=<id>; HttpOnly; Secure; SameSite=Lax`
- The browser sends the cookie automatically, including on the WebSocket
  upgrade request. The server resolves cookie → userId at upgrade time and
  attaches `userId` (or null for anonymous) to the server-side session.
- **No tokens appear in any SOP message.** The `hello` schema does not change
  for auth purposes. Logout = delete the session row.

Document as an explicit Phase 1 assumption: *the bundled web client and the
world server share an origin; cookie-based sessions depend on this.*
Cross-origin / independently-hosted-client / federated auth is out of scope
and would require bearer credentials or an OAuth-like scheme — a recorded
future problem, not an accident.

### 4. Move world CRUD to HTTP; SOP stays a live-session protocol

Replace `save_world` / `load_world` / `list_worlds` / `delete_world` SOP
messages with:

```
GET    /api/worlds          (list own worlds)
POST   /api/worlds          (create)
GET    /api/worlds/:id      (fetch — returns glTF)
PUT    /api/worlds/:id      (update metadata / trigger save)
DELETE /api/worlds/:id
```

Rationale (record it in the design): a world is a glTF resource loadable by
URL. `GET /api/worlds/:id` returning glTF means a saved *public* world is an
ordinary glTF URL, loadable by the existing static path — persistence extends
the browser model instead of creating a second proprietary loading mechanism.
(Private worlds require auth, so "any viewer" applies to public worlds only.)
It also keeps multi-megabyte world documents off the ordered WebSocket that
carries 20 Hz view traffic.

Include the server refactor as explicit scope: `createSessionServer()`
currently constructs its own bare `WebSocketServer({ port })`. Restructure to
an HTTP server that serves `/api/*` and handles the WebSocket upgrade on the
same port.

### 5. Saves are server-authoritative

"Save this world" means: client sends a save request → server serializes its
own authoritative SOM (the machinery already exists in `world.serialize()`)
→ server persists the result. The design must not accept a client-uploaded
world document as a normal save; that would create a second authority path.
Client-supplied glTF upload is a separate, later "import" operation with its
own validation story.

### 6. Define the persisted format precisely

Persisted worlds are **self-contained glTF JSON with buffers embedded as
base64 data URIs** — matching what `world.serialize()` already produces.
State this explicitly instead of the current unspecified `gltf_json`. GLB and
externally-stored resources are future options, not Phase 1.

### 7. State the ownership rule prominently

The database is the authoritative source for permissions.
`extras.atrium.owner` in serialized glTF is exported provenance metadata only
— it never grants permissions, because any client can edit JSON. The server
decides authorization from authenticated state, then serializes ownership
into the glTF as portable information. This rule also pre-answers open
question #5 (authority) in `DESIGN-user-objects.md` at the infrastructure
level while the full `ATRIUM_user_object` extension remains deferred.

### 8. Add a Security Baseline section

Not user-facing ceremony; server responsibilities:

- Password hashing: Argon2id (or scrypt)
- Minimum password length (no complexity rules); username
  normalization + uniqueness
- Rate limiting on register/login; generic login-failure messages
- Registration bot resistance on the public endpoint (per-IP throttle and/or
  honeypot field) from day one
- HTTPS/WSS in deployment
- **Validate the `Origin` header on the WebSocket upgrade** (cookie auth
  otherwise lets any website open an authenticated socket from a visitor's
  browser)
- **CSRF protection on state-changing HTTP routes** (HttpOnly stops cookie
  theft, not cross-site *use*; SameSite=Lax helps but is not sufficient alone
  for POST/PUT/DELETE)
- Session expiry column + periodic sweep of the `sessions` table
- Database backups; note that the server now holds credentials/PII for
  strangers on a public endpoint
- (JWT signing-key management is no longer needed — deleted with JWT)

### 9. Rename and future-proof the schema

```
users        (id, username, password_hash, display_name, created_at)
sessions     (id, user_id, created_at, expires_at)
worlds       (id, owner_user_id, slug, name, document,
              visibility, created_at, updated_at)
preferences  (user_id, key, value)
```

`worlds` replaces `saved_worlds` — don't bake "saved copy" into the object's
identity. `visibility` + `slug` open the path to `/public/<user>/<slug>`
style addressing later without remodeling persistence.

### 10. Restage the phases

- **Phase 1:** identity model, register/login/logout, cookie sessions,
  session→user binding at WS upgrade, server-authoritative world persistence
  over HTTP, peer-routing fix.
- **Phase 2:** home world (auto-create default, auto-load on login),
  server-side debounced auto-save after mutations with disconnect-save as a
  final flush (disconnect-only is not a reliability guarantee).
- **Phase 3:** remembered-guest identity with migration to accounts,
  user-object ownership/provenance, preferences UI.

Keep the existing decision to defer `ATRIUM_user_object` implementation —
that deferral is correct; its open questions (subtree instancing, script
sandboxing, property vocabulary) should not be solved simultaneously with
auth and persistence.

---

## Out of scope for this revision

No implementation. No schema files, no migrations, no code. Revise the two
documents, flag anything in this memo you disagree with rather than silently
complying, and return the drafts for second-pass review.
