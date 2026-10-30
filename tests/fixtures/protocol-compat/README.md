# Frozen `hello` schemas — the two server versions a 4c page may meet

scripting-4c AC4 (Rev 1.2 M1, 4b-2 P23). `tests/fixtures/protocol-compat/` holds
the `hello.client.json` of two SERVER versions, copied here **byte for byte**
from git so a test can prove the exact hello the client sends is one every
released server accepts.

| Fixture | Source | Blob (git) | sha256 |
|---|---|---|---|
| `hello.client.pre-4b-2.json` | `9e8b1e4^` (`617f80414aedaf87e43efb5e75cba1e6e57d97ea`) | `packages/protocol/src/schemas/hello.client.json` | `6734fda66c47fdd8b016612fe371b8e90a909f8e3e73a1f82733417974d3a339` |
| `hello.client.71b6e40b.json` | `71b6e40b` (`71b6e40b7d897048f3397ce108421c98e1901ce9`) | `packages/protocol/src/schemas/hello.client.json` | `6ca9a8566da13decd5fa8fdfd983f345490de3be5c37528ff6178a5311fa01c0` |

How they were made (read-only):

```
git show 9e8b1e4^:packages/protocol/src/schemas/hello.client.json > tests/fixtures/protocol-compat/hello.client.pre-4b-2.json
git show 71b6e40b:packages/protocol/src/schemas/hello.client.json   > tests/fixtures/protocol-compat/hello.client.71b6e40b.json
sha256sum tests/fixtures/protocol-compat/*.json
git show 9e8b1e4^:packages/protocol/src/schemas/hello.client.json | sha256sum   # the same 6734fda6…
git show 71b6e40b:packages/protocol/src/schemas/hello.client.json | sha256sum   # the same 6ca9a856…
```

Why (4b-2 P23, probe `p4`): `hello.client.json` closes `capabilities` with
`additionalProperties: false`, so a server refuses a capability it does not know.
Before 4b-2 the schema had **no `scriptRunner` key at all**; 4b-2 added it as
`const: 1`. Therefore:

| The client's `capabilities` | pre-4b-2 server | `71b6e40b` server (the released `ab02239b` code) |
|---|---|---|
| `{ tick }` (no `scriptRunner`) | accepted | accepted |
| `{ tick, scriptRunner: 1 }` (the 4b-2 client) | **refused** | accepted |
| `{ tick, scriptRunner: 2 }` (a 4c page on a cross-origin connection) | **refused** | **refused** |

So the 4c page advertises `scriptRunner` **only on a same-origin connection**
(where the server runs the same code as the page), and a cross-origin hello
carries **no `scriptRunner` key at all** — the one shape every released server
accepts. Nothing is lost: a cross-origin connection is always anonymous
(signin-sync I1), so it can never be the host.

The test that reads these fixtures is
`packages/client/tests/activate.test.js`; it compiles each fixture the way the
server compiles its schemas (Ajv, `strict: false`) and validates the EXACT hello
the real client puts on a raw port-0 socket.
