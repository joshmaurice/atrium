# Pre-brief: stop server-side fetching of owner-supplied `extras.atrium.source` (security)

Status: **FINAL, Revision 1 (2026-10-12).** The operator confirmed decisions
S1–S5 (§3) on 2026-10-12. An outside review (ChatGPT) also recommended
approval. **Priority: before any Phase 3 work.** This affects PROD today.

**Revision history:**
- **Revision 0.** First draft.
- **Revision 1.** Applies an outside review of Revision 0 (ChatGPT,
  2026-10-12, verdict APPROVE):
  - a test in an owner-gated world, with the authenticated owner as the
    attacker (§6.1);
  - a JSON-aware PROD search, with ownerless worlds included (§7.1);
  - a separate post-deploy cleanup step (§7.3).

  It also updates for the 2026-10-09 passdown: new hostnames, and the PROD
  commons is now owned (§1).

**Inputs:**
- the 2026-10-12 review of `docs/DESIGN-phase3-placement-scripting.md`
  (finding 5), which led to this;
- `devtasks/Atrium-Passdown-2026-10-09-domain-ewwb-commons-owner.md`, the
  latest passdown: hostnames, the commons owner, and the `sqlite3` usage on
  the VPS;
- `devtasks/Atrium-Passdown-2026-10-03-step9-cleanup.md` §7 (recipes) and
  §5 (process lessons).

**Hostnames (since 2026-10-09):**
- PROD is `https://ewwb.dev` and DEV is `https://dev.ewwb.dev`.
- The old `sslip.io` names are still served.

This is input for the brief-writing step. It is not the brief itself.

**Code facts:**
- **Verified at:** `main` `1f6d6f5`. Its runtime code is identical to the
  released `b97984fd` (DEV = MAIN = PROD); the five commits since touch only
  `README.md`, `devtasks/` and `docs/`.
- **Line numbers:** approximate.
- **Implementation base:** a freshly fetched `origin/main` at kickoff,
  supplied from the host (Step 9 cleanup §7.2), never a SHA quoted here.

**Prototype:** Claude built and tested the whole fix in the chat sandbox
(§6.3). As in the Step 9 cleanup round, the prototype patch stays with the
operator as a reference for checking the brief and the implementation SHA.
It is not given to the agents.

## 1. The problem

`extras.atrium.source` on a node names a glTF file to load into that node
(an "external reference"). Both the server and the client resolve it when a
world loads.

**On the server, document worlds resolve it with a bare `fetch()`.**
`createWorldFromDocument` (`world.js` ~L234–260) fetches every
`extras.atrium.source` URL found in the stored world:
- no scheme, host or address checks, so internal addresses
  (`127.0.0.1`, LAN, cloud metadata) are allowed;
- no size limit or timeout, and the whole body is read into memory
  (`arrayBuffer()` / `text()`);
- the result is discarded if it doesn't parse as glTF, so this is a
  **blind** request: the attacker can't read the response.

**Any account holder can plant such a URL.** Document worlds are home worlds
and other DB-stored worlds, which are owner-editable. The owner can:
- `add` a node whose `extras.atrium.source` is set (`session.js` `add`
  ~L541: no check on extras beyond the teleporter destination length);
- or `send` it on an existing node via `extras`, `extras.atrium` or
  `extras.atrium.source` (`send` ~L458: same).

Autosave persists it. The next time the world loads (any visit after the 3 s
teardown), the PROD server fetches it.

**Verified 2026-10-12** (local server at `main`, sandbox): registered a
user, added a node with `source: http://127.0.0.1:9999/internal-target.glb`
in the home world, disconnected, waited for teardown, reconnected. A
listener on 9999 received `GET /internal-target.glb` with
`user-agent: node`, from the server and not from a browser.

**Impact on PROD:**
- **Request forgery:** any account can make the server send GET requests to
  arbitrary addresses, including ones only reachable from the VPS.
- **Denial of service:** a URL serving a very large or endless body is read
  into memory with no cap, which can exhaust the server's memory.

This has been present since document worlds were added (2026-09-14).

**Not affected:** file worlds (`createWorld`, ~L55–80). Their glTF comes from
an operator-controlled file (`WORLD_PATH`, the commons seed), and edits to
them are never saved. The commons seed already refuses files containing
`extras.atrium.source` (`commons.js` ~L19).

**The PROD commons is now a document world.** Since its owner was set on
2026-10-09, the PROD commons runs in owned mode from a `worlds` row, so S1
covers it like any other document world. Its owner is the operator, but the
same rule applies.

**Related:** `POST /api/worlds` (Create) copies the live commons document
into new worlds (2026-10-09 passdown §4). A `source` planted in the commons
would be copied too. S1 makes such copies inert on the server, and S2 stops
new ones being planted. The copying itself is a separate pending fix.

## 2. Verified facts

- **Server-side resolution in document worlds has no legitimate use today.**
  - Their base URL is `file:///` (~L232). Node's `fetch` doesn't support
    `file:`, so relative references always fail anyway.
  - No code path creates a document world containing `source`: home worlds
    come from a template without it, there's no world-import API, and the
    commons seed refuses it.
- **Server-side resolution only adds nodes for serving.** Ingested external
  nodes are excluded from the `som-dump` and from saves (`externalNodeNames`).
  Clients resolve references themselves (`AtriumClient.resolveExternalReferences`,
  ~L1044) on world load. So nothing a visitor sees depends on the server's
  fetch.
- **`send` field paths** are parsed with `parsePath` (`@atrium/som`), which
  splits on `.` and numeric `[n]`. `som.setPath` writes into the live
  `extras` object in place, so `extras.atrium.source` can be set directly
  whenever the node already has `extras.atrium`.
- **Error codes:** `PERMISSION_DENIED` is already used for the avatar
  display-name guard, which runs before the mutation gate and applies to
  everyone, owner included (`send` ~L465–487). Errors carry the request
  `seq`.

## 3. Decisions (all confirmed by the operator, 2026-10-12)

- **S1. Document worlds never fetch on the server.**
  `createWorldFromDocument`'s `resolveExternalReferences` makes no network
  request. If any node has `extras.atrium.source`, it logs one warning with
  the count. `externalNodeNames` stays empty. The document-world
  `_loadExternalRef`, `_registerExternal` and `worldBaseUrl` are removed.
  **File worlds are unchanged.**
- **S2. No client may set `extras.atrium.source`.** Not the owner, not an
  avatar, in any world (including an `open` one):
  - **`add`:** refuse if `node.extras.atrium` has an own property `source`,
    whatever its value (including `null`). Place the check after the
    `msg.id` checks and before the mutation gate, so it covers avatar adds.
  - **`send`:** refuse if the parsed path would write it:
    - `extras` with a value whose `atrium` has an own `source`;
    - `extras.atrium` with a value that has an own `source`;
    - any path starting `extras.atrium.source`.

    Place the check after the avatar display-name guard and before the
    mutation gate.
  - **Error:** `PERMISSION_DENIED`, with the request `seq`, and the message
    `extras.atrium.source cannot be set by clients`. Nothing is applied,
    broadcast or saved.
- **S3. The guard functions are exported pure functions** in `session.js`
  (the prototype calls them `addSetsAtriumSource(node)` and
  `sendSetsAtriumSource(field, value)`), so they can be unit-tested.
- **S4. The code change doesn't rewrite stored worlds.** S1 means the server
  never fetches stored references. Visitors' browsers still resolve them
  client-side, which is the same exposure as any image on a web page. After
  this fix no new ones can be added.
  - Cleaning up is an operator step, kept separate so it doesn't delay the
    fix: find them before the release (§7.1), and remove suspicious ones
    after it (§7.3).
- **S5. No protocol, schema or client change.** `PERMISSION_DENIED` is
  already in the error enum.

## 4. Out of scope

- **Client-side rules for `source`** (allowed schemes, size limits,
  addresses). After this fix, `source` is reserved for operator file worlds.
  Phase 3's model references use a separate, client-only field,
  `extras.atrium.model`, with its own rules (`docs/DESIGN-phase3-placement-scripting.md`
  §4.3). This fix is what keeps the two apart.
- **Size limits and timeouts for file-world fetches.** They're
  operator-controlled, so a follow-up at most.
- **Removing the server-side external-reference feature for file worlds.**
- **Any change to `commons.js`.**

## 5. Open questions for the brief author / critic

1. **Should file worlds also refuse non-`file:` URLs?** The proposal is no:
   they're operator-controlled, and `space-ext.gltf` uses relative file
   references. Record it as a follow-up.
2. **Should the S1 warning name the nodes?** The proposal is count only, to
   keep owner-chosen strings out of the server log.

## 6. Test expectations

**Adversarial standard (this task is an authority boundary).** Every way of
writing the field is tried, by the owner and by an avatar, and every refusal
is checked for having no effect.

### 6.1 New file `packages/server/test/source-ref-guard.test.js` (port 0)

- **Pure guards** (S3):
  - `add` detection: `source` set, `source: null`, a teleporter-only
    `atrium`, `source` outside `atrium`, no extras;
  - `send` detection for every path and value shape in S2, plus negatives:
    a teleporter destination, `extras.displayName`, `translation`.
- **Session server, open (no-owner) world**, so only the guard can refuse:
  - `add` with `source` → `PERMISSION_DENIED`, `seq` echoed, and the node
    doesn't exist afterwards;
  - avatar `add` with `source` (correct `id` and `avatarNodeName`) →
    `PERMISSION_DENIED`;
  - `send` to `extras`, `extras.atrium` and `extras.atrium.source` →
    `PERMISSION_DENIED`, and the node's `extras.atrium.source` is still
    undefined afterwards;
  - **controls:** `add` and `send` without `source` are still accepted.
- **Owner-gated document world, authenticated owner** (the reported path):
  - **Setup:** a document world under `attachSessionHandlers` with
    `worldOwnerUserId`, and connections emitted with the owner's user id.
  - **Assert the session really is the owner:** `hello.canPlaceTeleporters`
    is true, and a plain `add` is accepted.
  - **Then assert the attack fails:**
    - an `add` with `source` → `PERMISSION_DENIED`, `seq` echoed, no node;
    - a `send` of `extras.atrium.source` onto a node that already has
      `extras.atrium` → `PERMISSION_DENIED`, and nothing is set;
    - `world.serialize()` contains no `"source"`.
- **Document world** (S1): a document world with a node whose `source`
  points at a port-0 canary HTTP server. After `resolveExternalReferences()`
  and a 300 ms wait, the canary has **zero** requests,
  `externalNodeNames.size === 0`, and the container node still loads.
- **Control, file world:** `createWorld(space-ext.gltf)` still resolves its
  references (`externalNodeNames.size > 0`).
- **Cleanup:** every server and canary is closed in `after`, and every
  socket in `finally`. Report the skipped count and expect 0 (Step 9
  cleanup §5.2).

### 6.2 Existing suites

All server files, each run on its own, must pass and exit on their own.
`packages/client` (140) and `apps/client` (191) must pass, with 0 skipped.

### 6.3 Proofs of failure (run each; each must fail the named tests and exit on its own)

| Proof | Break | Expected failures (prototype result) |
|---|---|---|
| (a) | `world.js` restored to `origin/main` | the document-world test (canary hit); exits in ~1 s |
| (b) | the `add` guard call disabled | `add` with `source`, avatar `add` with `source`, and the owner-world test; ~2 s |
| (c) | the `send` guard call disabled | all three `send` path tests and the owner-world test; ~1 s |
| (d) | the direct-path case (`extras.atrium.source…`) dropped from the `send` guard | the pure `send` test and the direct-path `send` test; ~1 s |

**Prototype results** (sandbox, Node 22.22.0):
- the new file: 12 pass, 0 skipped, about 1 s (11 in Revision 0, plus the
  owner-world test);
- all 18 server files pass and exit on their own (`world-visibility` about
  60 s);
- `packages/client`: 140 pass, 0 skipped, 48 s;
- each proof failed exactly the tests listed;
- **end to end:** the original attack is refused at `add`, and a `source`
  planted directly into the stored document produced no request on reload,
  only the S1 warning.

## 7. Operator checks (outside the pipeline)

S1 and S2 remove the server exposure. Cleaning up references already stored
is a separate step (§7.3), and it doesn't hold up the release.

### 7.1 Before the release: find stored references (read-only)

```
sudo sqlite3 -readonly -column -header /var/lib/atrium/atrium.db \
  "SELECT w.id, COALESCE(u.username,'(no owner)') AS owner, w.slug, j.fullkey, j.value
   FROM worlds w LEFT JOIN users u ON u.id = w.owner_user_id, json_tree(w.document) AS j
   WHERE j.fullkey LIKE '\$.nodes[%].extras.atrium.source';"
```

- **The query reads the stored JSON**, so it matches only a node's
  `extras.atrium.source` and not the word "source" elsewhere. The `LEFT
  JOIN` keeps worlds that have no owner.
- **Tested** on a local database holding a planted reference: it found it,
  and ignored decoy `source` keys elsewhere in a document.
- **Each match is a candidate to inspect.** Look at the URL before deciding
  what it is.
- **Requirements:** SQLite's JSON functions. They're built in from 3.38 and
  enabled in most distribution builds before that. If the query errors on
  `json_tree`, report the `sqlite3 --version` output.
- **DEV:** the same with `/var/lib/atrium-dev/atrium.db`.

### 7.2 Before the release: past server-side fetches

```
sudo journalctl -u atrium --since 2026-09-14 | grep -E "External ref loaded|Failed to load external ref"
```

Each line names a URL the server fetched or tried to fetch. File worlds log
these too at boot, so ignore any that match the configured world file's own
references. **DEV:** `-u atrium-dev`.

### 7.3 After the release: remove stored references

For each match from §7.1 that should go, with nobody in that world. Stopping
the service is simplest, because a loaded world would save its in-memory
copy back over the edit.

```
sudo systemctl stop atrium
sudo sqlite3 /var/lib/atrium/atrium.db ".backup '/var/lib/atrium/atrium.db.bak-$(date +%F)-source'"
sudo sqlite3 /var/lib/atrium/atrium.db \
  "UPDATE worlds SET document = json_remove(document, '<fullkey from 7.1>') WHERE id = '<id from 7.1>';"
sudo systemctl start atrium
```

- **This removes only the `source` key.** The node stays.
- **Tested locally:** after the removal, the §7.1 query returns nothing,
  and the world still loads.
- **Then re-run §7.1** and expect no rows.

### 7.4 DEV acceptance after the deploy (`https://dev.ewwb.dev`)
- the normal health check;
- sign in to the DEV client, go to your own home world, open the browser's
  developer console and run:
  ```
  atriumClient.addNode({ name: 'source-guard-check', extras: { atrium: { source: 'https://example.com/x.glb' } } })
  ```
  - **Pass:** the console shows
    `[app] client error: … PERMISSION_DENIED: extras.atrium.source cannot be set by clients`,
    and no node appears.
  - `app.js` exposes `window.atriumClient` (~L355) and logs server errors
    (~L705).
  - **Don't run this on PROD before the fix ships:** there it would succeed
    and plant the URL.
