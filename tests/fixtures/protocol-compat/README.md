# Frozen `hello` schemas — the two server versions a 4c page may meet

scripting-4c AC4 (Rev 1.2 M1, 4b-2 P23). `tests/fixtures/protocol-compat/` holds
the `hello.client.json` of two SERVER versions, copied here **byte for byte**
from git so a test can prove the exact hello the client sends is one every
released server accepts.

| Fixture | Source | Blob (git) | sha256 |
|---|---|---|---|
| `hello.client.pre-4b-2.json` | `9e8b1e4^` (`617f80414aedaf87e43efb5e75cba1e6e57d97ea`) | `packages/protocol/src/schemas/hello.client.json` | `6734fda66c47fdd8b016612fe371b8e90a909f8e3e73a1f82733417974d3a339` |
| `hello.client.71b6e40b.json` | `71b6e40b` (`71b6e40b7d897048f3397ce108421c98e1901ce9`) | `packages/protocol/src/schemas/hello.client.json` | `6ca9a8566da13decd5fa8fdfd983f345490de3be5c37528ff6178a5311fa01c0` |
| `hello.client.14ab0076.json` | `14ab0076` (`14ab00768b692634d8b767c44eb22285d2a93045`) | `packages/protocol/src/schemas/hello.client.json` | `828caa45cb99570f92929412b6d52ce56da6377147840dc9f0b031415ececf59` |

`hello.client.14ab0076.json` is the **4c** release (the code on DEV, MAIN and
PROD when 4d-1 ships, scripting-4d G5): its `scriptRunner` is `enum: [1, 2]`.
A 4d page advertises `3`, so a same-origin 4d hello is refused by that server —
which is exactly why a 4d page still carries `scriptRunner` **only** on a
same-origin connection and sends no key cross-origin. The fixture proves the
cross-origin 4d hello is one the 4c server accepts.

How they were made (read-only):

```
git show 9e8b1e4^:packages/protocol/src/schemas/hello.client.json > tests/fixtures/protocol-compat/hello.client.pre-4b-2.json
git show 71b6e40b:packages/protocol/src/schemas/hello.client.json   > tests/fixtures/protocol-compat/hello.client.71b6e40b.json
git show 14ab0076:packages/protocol/src/schemas/hello.client.json   > tests/fixtures/protocol-compat/hello.client.14ab0076.json
sha256sum tests/fixtures/protocol-compat/*.json
git show 9e8b1e4^:packages/protocol/src/schemas/hello.client.json | sha256sum   # the same 6734fda6…
git show 71b6e40b:packages/protocol/src/schemas/hello.client.json | sha256sum   # the same 6ca9a856…
git show 14ab0076:packages/protocol/src/schemas/hello.client.json | sha256sum   # the same 828caa45…
```

Why (4b-2 P23, probe `p4`): `hello.client.json` closes `capabilities` with
`additionalProperties: false`, so a server refuses a capability it does not know.
Before 4b-2 the schema had **no `scriptRunner` key at all**; 4b-2 added it as
`const: 1`. Therefore:

| The client's `capabilities` | pre-4b-2 server | `71b6e40b` server | `14ab0076` server (4c) |
|---|---|---|---|
| `{ tick }` (no `scriptRunner`) | accepted | accepted | accepted |
| `{ tick, scriptRunner: 1 }` (the 4b-2 client) | **refused** | accepted | accepted |
| `{ tick, scriptRunner: 2 }` (a 4c page on a cross-origin connection) | **refused** | **refused** | accepted |
| `{ tick, scriptRunner: 3 }` (a 4d page, same-origin only) | **refused** | **refused** | **refused** |

So a page advertises `scriptRunner` **only on a same-origin connection** (where
the server runs the same code as the page), and a cross-origin hello carries
**no `scriptRunner` key at all** — the one shape every released server accepts.
Nothing is lost: a cross-origin connection is always anonymous (signin-sync I1),
so it can never be the host.

The test that reads these fixtures is
`packages/client/tests/activate.test.js` and
`packages/client/tests/script-runner-4d.test.js`; they compile each fixture the
way the server compiles its schemas (Ajv, `strict: false`) and validate the
EXACT hello the real client puts on a raw port-0 socket.
