# Atrium Passdown — 2026-10-09 — New domain (ewwb.dev), PROD commons owner, Create-copies-commons finding

**Predecessor:** `devtasks/Atrium-Passdown-2026-10-03-step9-cleanup.md`.
This was an operations session, not a pipeline round. No code changed and
nothing was released. Code facts below were checked against `main` at
`fedafc0`.

**First instruction for the next session's Claude: clone the repo and read
`devtasks/` before advising.**

## 1. Status at handoff

| Item | State |
|---|---|
| PROD address | **`https://ewwb.dev`** (new). Old `5.78.232.73.sslip.io` still served. |
| DEV address | **`https://dev.ewwb.dev`** (new). Old `dev.5-78-232-73.sslip.io` still served. |
| Caddy | Both site blocks list old and new names; certificates issued. |
| PROD commons | Owner configured this session (was read-only before). See §3. |
| Code / release state | Unchanged this session. |
| Open finding | Create copies the live commons into new worlds (§4). Needs a decision and a pipeline round. |

**Still to do:**
- **Decide the fix direction for §4** and write the pre-brief.
- **Confirm sign-in on `ewwb.dev`.** World load, same-server teleport and
  cross-server teleport were confirmed; login was not reported either way.
- **Re-save teleporter pads that point at `5.78.232.73.sslip.io`** to
  `ewwb.dev` addresses (§2.4).
- **Update docs and agent instructions to the new names** (§2.5).
- **Record the PROD commons owner username** here or in the deploy notes;
  it was not captured in this session.
- **Check whether DEV has a commons owner set**
  (`systemctl cat atrium-dev | grep COMMONS`).

## 2. The outage and the domain change

### 2.1 What happened
On the morning of 2026-10-09, `https://5.78.232.73.sslip.io` stopped
loading from the operator's home network (T-Mobile home internet, both
computers). Firefox showed "SSL received a record that exceeded the maximum
permissible length"; Opera showed `ERR_SSL_PROTOCOL_ERROR`; curl and openssl
showed "wrong version number".

### 2.2 Diagnosis
The server was healthy. The hostname was being intercepted on the network
path, most likely by the ISP's or gateway's security filter. Which product
does the filtering was not identified.

Evidence:
- **On the server itself**, a TLS handshake for that hostname completed
  normally (`curl --resolve …:443:127.0.0.1`).
- **Over cellular**, the site loaded.
- **From the home network**, `dev.5-78-232-73.sslip.io` (same Caddy, same
  port) worked, and the dashed prod form `5-78-232-73.sslip.io` reached
  Caddy. Only the dotted name was answered with non-TLS data.
- **The Caddyfile edit the night before was not the cause.** It added a
  `handle /tools/som-inspector/*` block to PROD, and the site worked from
  home after that reload.

**Lesson:** hostnames containing a raw IP (sslip.io, nip.io) can land on
blocklists without warning. Anyone behind the same filter cannot reach the
old PROD name, and a redirect cannot help them because the connection is
intercepted before it reaches the server.

**Quick test for next time:** run the handshake locally on the server and
from a second network before touching any config.

### 2.3 The fix
- **Domain:** `ewwb.dev`, registered at Namecheap, BasicDNS.
- **DNS:** A records for `@` and `dev`, both to `5.78.232.73`.
- **Caddy:** new names added alongside the old ones.

```
5.78.232.73.sslip.io, ewwb.dev {
dev.5-78-232-73.sslip.io, dev.ewwb.dev {
```

Backup: `/etc/caddy/Caddyfile.bak-2026-10-09`.

- **No Atrium code change was needed.** `isOriginAllowed` in
  `packages/server/src/http-routes.js` compares the request's Origin with
  its own Host header, so any hostname Caddy serves is accepted.
- **`.dev` is HTTPS-only** (browsers enforce it). Fine with Caddy; plain
  `http://` test URLs against these names will not work in a browser.

### 2.4 Consequences
- **Login cookies are per hostname.** Accounts are unchanged, but users sign
  in once more under the new name.
- **Stored addresses are not migrated.** Teleporter destinations and any
  saved `wss://5.78.232.73.sslip.io/...` addresses still point at the old
  name. They work except from networks that block it.
- **Keep the old names in Caddy** so existing links and pads keep working.

### 2.5 Docs to update
- `README.md` has one sslip.io reference; `AGENTS.md` has none.
- Deploy notes and earlier passdowns use the sslip.io names throughout.
  Leave the history, but the pipeline agents' instructions (SOUL.md, skills,
  card templates) should use `ewwb.dev` / `dev.ewwb.dev` from now on.
- `apps/client/tests/wsUrl.test.js` uses an sslip.io name as test data. No
  change needed.

## 3. PROD commons owner

Until this session PROD had no `ATRIUM_COMMONS_OWNER`, so the commons
booted degraded: read-only, served from the world file, no database row.

Set this session through a systemd drop-in:

```
/etc/systemd/system/atrium.service.d/commons.conf
[Service]
Environment=ATRIUM_COMMONS_OWNER=<username>
```

followed by `systemctl daemon-reload` and `systemctl restart atrium`.
The operator then placed a teleporter in the commons, which shows the
owned mode took effect. The boot log lines were not pasted into the session.

Facts from `packages/server/src/commons.js`:
- **Username lookup is case-insensitive.**
- **First owned boot seeds a `worlds` row** (slug `commons`, public) from
  the world file. Later boots adopt that row and do not re-seed.
- **Changing the owner later is a manual migration.** A different username
  seeds a fresh commons and leaves the old one as that user's ordinary
  public world (Step 5 pre-brief §10).
- **A username matching no account** gives the degraded read-only boot,
  with a loud `[commons] DEGRADED READ-ONLY BOOT` log line.

DB backup taken before the change, if the suggested step was followed:
`/var/lib/atrium/atrium.db.bak-2026-10-09`.

## 4. Finding: Create copies the live commons

**Observed on PROD:** after a teleporter was placed in the commons, worlds
made with the Create button contained that teleporter.

**Cause (verified):** `POST /api/worlds` in
`packages/server/src/http-routes.js` (around line 597) builds the new
world's initial document from `getLiveWorld().serialize({ excludeNodes })`.
The live world is the commons, and only avatar nodes are excluded. Every
commons edit therefore becomes part of the starting content of worlds
created afterwards.

**Why it surfaced now:** the PROD commons was read-only until §3, so it
never changed.

**Not affected:**
- **Home worlds:** seeded from `DEFAULT_HOME_DOCUMENT` in `home-world.js`
  (skybox and ground plane).
- **Existing worlds:** the copy is taken once, at creation.

**Options for the pre-brief (operator decision pending):**
- **A. Exclude teleporter nodes when copying.** Small change. New worlds
  still inherit every other commons edit.
- **B. Stop copying the commons; start from a fixed template,** as home
  worlds do. Recommended in session: it fully separates the two.

The code comment gives the original reason for copying: a created world
should be valid glTF from the moment it exists. A fixed template satisfies
that too.

**Workaround until it ships:** the world's owner deletes the inherited pad.

## 5. Useful commands from this session

List accounts (read-only, safe while the server runs):

```
sqlite3 -readonly -column -header /var/lib/atrium/atrium.db \
  "SELECT username, display_name, created_at FROM users ORDER BY created_at;"
```

DEV uses `/var/lib/atrium-dev/atrium.db`. Times are UTC.

Check whether a hostname is blocked on the current network (run from the
affected machine):

```
openssl s_client -connect 5.78.232.73:443 -servername <hostname> </dev/null 2>&1 | head -5
```

- "wrong version number": intercepted before reaching Caddy.
- "tlsv1 alert internal error": reached Caddy, which has no certificate for
  that name.
- A certificate chain: working.
