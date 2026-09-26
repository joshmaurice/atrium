# Pre-brief: Phase 2 Step 5 — The Commons

Status: **Decisions resolved in review (2026-09-19). Human sign-off: CONFIRMED**

Review trail: proposals drafted by Claude; reviewed by ChatGPT; §4B below reflects the
resolved set, with the two changes noted there (#3 and #5).

Input for the brief-writing step (GLM), then critique (Nemotron). This is not the
task brief. It records what is already decided, what was verified in the code,
what is proposed, and what is still open, so the brief author does not have to
originate those decisions or re-derive the code facts.

**Authority order (highest first):**
1. `devtasks/ADDENDUM-user-accounts-phase2.md` §6 (and §1, §2, §4 where they touch the commons).
2. §4A of this document (restated addendum decisions plus verified prod facts).
3. §4B of this document (resolved decisions — binding once the sign-off line above reads CONFIRMED).

If anything here conflicts with the addendum, the addendum wins; flag the conflict.

Code facts below were verified against `main` at `de26d8bee66b556368c54ac72125c8c08ff3fb8a`
(the released Step 4 SHA). Line numbers are approximate; re-locate by symbol.

---

## 1. Goal

Make the commons a normal, operator-owned, DB-backed, autosaved world that is
pinned in memory and mounted at the bare root path `/`. Today it is the one
world exempt from every Phase 2 rule: file-backed, ownerless, unsaved, and open
to mutation by anyone. Step 5 removes those exemptions. It does not add editing
UI (that is Step 6).

## 2. Verified facts about the current code

**Boot and hosting**
- `packages/server/src/index.js` calls `registry.registerWorld('default', resolvedWorldPath)`
  with no owner (`ownerUserId = null`), loading from `WORLD_PATH`. It then sets
  `defaultHostRef.current`. The `world.baseUrl` value parsed from a `.atrium.json`
  config is never passed to `registerWorld` (dead value, as far as we can tell).
- `world-registry.js`: `resolveWorldId` maps `/`, `''` and `/apps/client` to
  `{ kind: 'default' }`, which does `hosts.get('default')`. The `/apps/client`
  alias exists only because the client derives its WebSocket path from
  `location.pathname` (`apps/client/src/wsUrl.js`).
- Teardown exemption is by string: `scheduleTeardown` and `performTeardown` both
  return early when `worldId === 'default'`.
- All other worlds are keyed by their `worlds.id` UUID. `/home/<uid>/home`,
  `/public/<user>/<slug>` and `/ws/<id>` all do `hosts.get(row.id)` and lazily
  create a host under that UUID if absent.

**Mutation gate and saving**
- `session.js`: the mutation gate returns `true` for everyone when
  `worldOwnerUserId === null` (comment: "backward compat"). Otherwise it requires
  `session.userId === worldOwnerUserId`. Applies to `send`/setField, `add`
  (non-avatar) and `remove`.
- `onSaveableMutation` is only invoked when `worldOwnerUserId !== null`.
- `autosave.js`: `markDirty` returns early for `worldId === 'default'` and for a
  null owner. `doSave` returns early for a null owner, and otherwise calls
  `worldStore.updateWorld(db, worldId, host.ownerUserId, { document })`, i.e. it
  treats the **host key as the `worlds.id`**. A `NOT_FOUND` result makes it stop
  tracking that world.
- `flushAndTeardown(worldId, host)` only flushes (with one retry) — it does not
  close the host. The registry calls it only from `performTeardown`, which never
  runs for `'default'`. So today nothing flushes the commons when the last
  session leaves.
- `serialize()` excludes avatar nodes (caller-supplied) and nodes ingested from
  external refs, so `extras.atrium.source` strings persist as references, not
  inlined content.

**HTTP layer**
- `http-routes.js` `PUT /api/worlds/:id` serializes the live host found via
  `getWorldHost(worldId)` (keyed by row UUID), then `updateWorld(db, worldId, userId, …)`.
  If no live host has that key, it skips the document and only applies metadata.
- `defaultHostRef` is still used for `getLiveWorld()` and `getLiveAvatarNodeNames()`
  (legacy Phase 1 paths). Not fully audited — the brief author must read them.
- `POST /api/worlds` and `PUT` reject the reserved slug `home`; `PUT` refuses to
  change the slug of a world whose slug is `home`. **`DELETE /api/worlds/:id` has
  no reserved-slug or pinned-world guard.** The client world browser shows a
  Delete button for every row.
- `worlds` has `UNIQUE (owner_user_id, slug)` and, since Step 4,
  `CHECK (visibility IN ('private','public'))`. No schema change appears
  necessary for Step 5 (confirm).

**DB-loaded worlds**
- `createWorldFromDocument` resolves relative `extras.atrium.source` refs against
  a hardcoded `file:///`, and reads the document with an empty resource map
  (external `.bin` / image URIs would not load).

**Prod facts (checked by the human on 2026-09-19)**
- Service `atrium.service`, `WorkingDirectory=/srv/atrium/packages/server`,
  `Environment=WORLD_PATH=/srv/atrium/tests/fixtures/space.gltf`. A DB drop-in
  exists at `/etc/systemd/system/atrium.service.d/db.conf`.
- That file has 5 nodes, **no** `extras.atrium.source` refs, no
  `extras.atrium.background`, and no non-data buffer or image URIs. The
  external-reference and external-buffer concerns therefore do not apply to the
  current seed.

## 3. What the addendum already settles (§6)

- Keep the commons. Owned by the operator's real account; same owner-only rule
  as every other world; no admin/privilege system.
- Seed: migrate what is live under `WORLD_PATH` in prod into this world's row.
- Lifecycle exception: loaded eagerly at boot, never torn down.
- Routing: bare root path, through the existing registry/upgrade seam.
- Anonymous visitors can enter; they may view and move their own avatar; they may
  not mutate canonical world state.

## 4A. Restated from verified facts

- The seed source is a test fixture. After seeding, the DB row is the source of
  truth; `WORLD_PATH` means only "seed file used when the commons row is missing."

## 4B. Decisions (resolved in review)

1. **Host key = row UUID; `'default'` becomes a registry pointer.** Register the
   commons under its `worlds.id`, and have the registry keep a `rootWorldId` that
   `/`, `/apps/client`, `getDefaultHost()` and the teardown exemption resolve
   through. Rationale, all from §2: (a) keeping the key `'default'` makes
   autosave call `updateWorld(db, 'default', …)` → `NOT_FOUND` → silently stops
   saving; (b) `PUT /api/worlds/:id` would not find the live host; (c)
   `/public/<operator>/<slug>` and `/ws/<uuid>` would lazily create a **second,
   independent live copy** of the commons under the UUID, and both copies would
   autosave to the same row. Retain `defaultHostRef` pointing at the same host.
2. **Operator identity by server config.** Env var
   `ATRIUM_COMMONS_OWNER` = username, optional `ATRIUM_COMMONS_SLUG` (default
   `commons`), set through a systemd drop-in beside `db.conf`. No hardcoded
   username, UUID, or URL in shared code.
3. **Missing operator at boot must not block startup — via an explicit mutation
   policy, not by redefining null-owner.** Give hosts an explicit
   `mutationPolicy` with values `owner` (default whenever an owner is set),
   `read-only`, and `open` (the legacy meaning of `ownerUserId === null`, kept only so
   existing tests and non-production construction still behave as before). A degraded
   commons boot uses `ownerUserId: null` with `mutationPolicy: 'read-only'`: file-backed,
   readable by anyone, all mutation denied, loud log. Requirements:
   - The policy is plumbed from `createWorldHost` into the session handlers, and the gate
     checks `read-only` **before** the existing null-owner shortcut.
   - The production boot path in `index.js` always passes an explicit policy; it can
     never end up `open`. A test must assert this.
   - Autosave/`onSaveableMutation` behavior for read-only hosts is "no saves" (nothing
     can change; there is no row).
4. **Idempotent seeding.** Insert only when no row exists for
   `(operator, slug)`; single transaction; never overwrite an existing row.
   Guard: if the seed file contains any `extras.atrium.source` refs or non-data
   buffer/image URIs, fail loudly rather than seed a world that will not
   round-trip. Whenever a seed actually happens, log it at warn level with the
   operator username and the new row id, so an unintended re-seed is visible.
5. **Default slug `commons`, visibility `public`. Do not reserve the slug
   globally.** Special treatment is keyed only on `rootWorldId`, never on the slug;
   uniqueness stays the existing `(owner_user_id, slug)`. Any user may name an ordinary
   world `commons`. The one residual hazard is first-boot adoption: seeding looks up
   `(operator, slug)`, so a pre-existing world of the operator's with that slug would be
   adopted as the commons. That is covered by the pre-deploy check in §10, not by a
   namespace rule. (Reserve the slug only if GLM/Nemotron find a concrete ambiguity this
   check does not cover.)
6. **Protect the row.** Identify it by comparing the row id to the registry's
   `rootWorldId` (no schema change). Reject `DELETE`, slug change, and any
   visibility change away from `public` for that row. Reason: deleting it while
   live drops autosave silently, and the next boot would re-seed from the fixture,
   discarding the operator's edits with no error.
7. **Flush-when-empty without teardown.** When the last session leaves the
   commons, flush immediately (addendum §4 disconnect-flush) but keep the host
   resident. Today's teardown path is the only flush trigger, so this needs an
   explicit path.
8. **No schema migration expected.** Rollback to the Step 4 SHA would then see the
   commons as one more public world of the operator. The brief must confirm this
   or state the migration.

## 5. Open questions for the brief author / critic

Resolved in review: null-owner semantics (see §4B-3: explicit `mutationPolicy`);
guarded-Delete UX (a clean error message is enough); `/ws/<id>` (leave it, but
the single-host test in §8 is mandatory); Q5 operator change (accepted limitation,
documented in §10; no schema change in Step 5).

- **Q2.** Audit `getLiveWorld()` / `getLiveAvatarNodeNames()` (`defaultHostRef`)
  in `http-routes.js`: which routes still depend on them, and are they correct
  once the commons is owned and keyed by UUID?
- **Q3.** Inventory which existing tests construct a session server with a null owner
  and rely on open mutation. They should map to `mutationPolicy: 'open'` with no
  behavior change; any that need edits change in the same commit as the code.

## 6. Invariants (a later feature will load worlds from other servers)

Step 5 must not add assumptions that "the current server is the permanent server."

- `/` means "the commons of the server this connection targets." No client, shared
  or protocol code may hold a fixed commons URL, UUID, slug, or origin.
- Identity is server-local: user ids, usernames, ownership, and host keys are
  meaningful only within one server. Nothing in Step 5 should treat them as global.
- Do not bake the server's own absolute URLs into the seeded document or into
  saved documents.
- Do not extend the `/apps/client` alias or add new page-path coupling.
- Do not change how the client builds WebSocket or home-world URLs (recorded
  separately; see §8).

## 7. Points that are easy to get subtly wrong

1. **One host per world.** Reaching the commons via `/`, `/apps/client`,
   `/public/<operator>/commons` and `/ws/<uuid>` must always hit the same host.
2. **Autosave must target the row.** It must save under the row UUID, exclude
   avatars, and stop only on a genuine `NOT_FOUND`.
3. **Pinned ≠ never flushed.** Never tearing down must not skip the
   last-session flush.
4. **Seed race and re-seed.** Two boots or a restart must not re-seed or
   overwrite; a missing row is the only trigger.
5. **Do not re-open the open-mutation hole** through the missing-operator path or a
   test-only default: no production boot path may result in `mutationPolicy: 'open'`.
6. **Identity comes from the server-side cookie**, never from the client-supplied
   display name. A client that claims the operator's name must gain nothing.

## 8. Test expectations

Per `TEMPLATE-task-brief.md`, include disagreement-case tests, not only happy paths:

- Anonymous client on `/` sends `add`, `remove`, and `setField`: each returns
  `PERMISSION_DENIED`, and world state is unchanged.
- Authenticated non-operator: same.
- Client supplies the operator's username as its display name: still denied.
- Operator mutation succeeds and autosaves; the row's `document` changes; avatars
  are absent from it.
- Restart after an operator edit: the edit persists and the seed does not re-run.
- Missing operator at boot: server starts, commons is readable, all mutation is
  denied (`read-only` policy), including for an authenticated user.
- The production boot path never yields `mutationPolicy: 'open'`, in any
  configuration.
- `/`, `/public/<operator>/commons`, and `/ws/<uuid>` resolve to one host; a
  change made through one is visible through another; only one host exists.
- Last session leaves: the commons is flushed to the DB and stays resident.
- `DELETE`, slug change, and visibility→private on the commons row are refused.
- A non-operator user can still create and keep an ordinary world named `commons`.
- Seed file with an external ref or external buffer: boot/seed fails loudly.

Live verification: this touches the connect path and root routing, so a live
two-client smoke test in dev is required before merge (anonymous tab + operator tab).

## 9. Out of scope

- Step 6 (teleporters) and any editing UI for the commons.
- Cross-server world loading, Origin-check changes, and the client's home-world
  URL construction. (Known issue for that work: `autoConnectToHomeWorld` builds
  the home-world URL from the `wsUrl` field's origin, but the user id comes from
  the account server.)
- Removing `/ws/<id>`.
- Any admin/privilege system; any public-worlds directory.
- Changing the client's static fallback world (reloaded from the "World URL"
  field on disconnect).

## 10. Human prerequisites before DEV/PROD

**Known limitation (accepted for Step 5): changing the operator.** The commons is
found each boot by (operator username → user id, slug); there is no stored marker
for "this row is the commons." Changing `ATRIUM_COMMONS_OWNER` to a different
existing account therefore seeds a new commons from the fixture; the old commons
remains an ordinary public world of the previous owner, and visitors at `/` see
fixture content until it is migrated. No data is lost. Treat an operator change as a
manual migration: inspect and migrate the existing commons first, then change the
configuration. Adding a persisted server-level marker (e.g. a `commons_world_id`
setting) is deliberately deferred; it is a wider architectural decision than Step 5.
(An operator name that matches no account is not this case: it triggers the
`read-only` degraded boot in §4B-3.)

- The operator account must exist on the target server (dev and prod). Creating
  it and setting the env-var drop-in are human steps, not worker tasks.
- Verify the operator account has no existing world with slug `commons` on the
  target DB (otherwise first boot would adopt it as the commons). Other users'
  `commons` worlds are irrelevant.
- PROD DB backup before deploy (already part of the release path).
- Base: snapshot `origin/main` as `base_main_sha` at kickoff, per the main-drift
  policy in the 2026-09-17 passdown.
