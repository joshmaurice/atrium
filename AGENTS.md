# AGENTS.md

Agent context for working in the Atrium repository. Read this first — it
captures the stack, conventions, commands, and architecture notes that
otherwise live scattered across session logs.

## What Atrium Is

A glTF browser with multiplayer. Renders any `.gltf` file; with a world
server behind it, you're in a shared space. Built by Tony Parisi /
Metatron Studio as an attempt to follow *The Seven Rules of the Metaverse*.

Three layers:
- **Content** — standard glTF 2.0 (a world is a `space.gltf` with Atrium
  metadata in `extras.atrium`)
- **Protocol** — SOP (Scene Object Protocol), a lightweight WebSocket
  protocol for multiplayer world state (schemas in `@atrium/protocol`)
- **Runtime** — SOM (Scene Object Model), a DOM-inspired API over
  glTF-Transform; server owns the authoritative scene graph, clients
  mirror it into Three.js via DocumentView

## Stack & Conventions

- Node.js + glTF-Transform server, Three.js + DocumentView client
- **All ES modules, no TypeScript, no build step**
- Test runner: `node --test`
- Package manager: **pnpm workspaces** (monorepo: `packages/*`, `apps/*`, `tools/*`)
- SPDX license header in every `.js` file
- `@atrium/client` is renderer-neutral (no `window`, no `document`, no
  Three.js) — renderer glue lives in `@atrium/renderer-three`

## Commands

```bash
# install
pnpm install

# run a package's tests
pnpm --filter @atrium/protocol test
pnpm --filter @atrium/som test
pnpm --filter @atrium/server test     # see gotcha below
pnpm --filter @atrium/client test
pnpm --filter @atrium/renderer-three test
pnpm --filter @atrium/interaction test

# or all tests directly (no filter):
node --test packages/protocol/test/*.test.js packages/som/test/*.test.js packages/server/test/*.test.js

# start a world server
cd packages/server
WORLD_PATH=../../tests/fixtures/space.gltf node src/index.js
# or via manifest
WORLD_PATH=../../tests/fixtures/space-ext.atrium.json node src/index.js

# browser apps are static — no build step
open apps/client/index.html            # Atrium browser (enter .gltf URL / ws:// server)
open tools/som-inspector/index.html    # live SOM tree, property sheet, viewport edit
open tools/protocol-inspector/index.html
open apps/playground/index.html        # pointer-event test bench
```

**Gotchas:**
- Top-level `npm test` / `pnpm -r test` fails on missing gltf-extension
  test — ignore it; run per-package instead.
- Batched `pnpm --filter @atrium/server test` hangs because
  `session.test.js` doesn't tear down its WebSocket port between files.
  Run server test files individually.

## Test Ports Used

- 3001: `session.test.js` main server
- 3002: world-full sub-server (port + 1)
- 3003–3006: `session.test.js` integration tests
- 3007: `presence.test.js`
- 3008: `avatar.test.js`
- 3009–3013: `session.test.js` additional integration tests
- 3014: (unused — previously misattributed to http-integration.test.js which actually uses 3015)
- 3015: `http-integration.test.js`
- 3016: `rate-limit.test.js`
- 3017: `world-crud.test.js`

## Key Files

| File | Role |
|---|---|
| `packages/protocol/src/index.js` | Ajv validator, direction-aware for hello/view |
| `packages/protocol/src/schemas/` | SOP JSON Schemas (the contract) |
| `packages/server/src/session.js` | WebSocket session, presence, SOM mutations |
| `packages/server/src/world.js` | glTF-Transform wrapper, serialize(), ingestNode via SOM |
| `packages/som/src/SOMDocument.js` | SOM API; `ingestNode()` handles mesh primitives |
| `packages/som/src/SOMLight.js` | SOM camera/light support (newer; camera work in progress) |
| `packages/client/src/AtriumClient.js` | Connection, SOM sync, pointer dispatch, animation lifecycle |
| `packages/renderer-three/src/document-view.js` | Three.js bridge (DocumentView) |
| `packages/renderer-three/src/PointerInputBridge.js` | Renderer ↔ client pointer seam |
| `packages/interaction/src/selectionModel.js` | Selection policy (policy over mechanism) |
| `apps/client/src/app.js` | Browser UI shell |
| `tests/fixtures/generate-space.js` | Regenerate `space.gltf` (run from repo root) |

## Architecture Notes

### Session identity
- Client generates `sessionId = crypto.randomUUID()` on load
- `shortId = sessionId.slice(0, 4)`
- `displayName = 'User-' + shortId` — this IS the avatar `node.name` (the
  client sets `_avatarNodeName = displayName`, not bare shortId)
- `node.extras.displayName` stores the display name for UI display
- Avatar geometry: CapsuleGeometry(0.3, 0.8, 4, 8), blue material
- Server tracks `session.avatarNodeName = msg.node.name` on `add`

### Connect sequence
1. Client sends `hello` with `id: sessionId`
2. Server → `hello` response (echoes `id: sessionId`)
3. Server → `som-dump` (full glTF with all current avatar nodes)
4. Server → `join` broadcasts (presence)
5. Client sends `add` with full avatar node descriptor
6. Server adds to SOM, `broadcastExcept` `add` to others
7. Client starts sending `view` with `position`, `look`, `move`, `velocity`

### Disconnect sequence
1. Server removes avatar SOM node by `session.avatarNodeName`
2. Server `broadcast` `remove { id: departedId }`
3. Server `broadcast` `leave { id: departedId }` (presence)

### SOM node lookup
- `som.getNodeByName(name)` — looks up by node.name (= displayName for avatars; e.g. `User-3f2a`)
- `som.ingestNode(descriptor)` — handles mesh geometry in node descriptors

### Protocol message direction
- `hello`, `view` — direction-specific validators (`hello:client`, `view:server`)
- `som-dump` — server only, non-directional validator key `'som-dump'`
- All others — single schema regardless of direction

### NavigationInfo
In `extras.atrium.world.navigation` (was bare string `"WALK"`):
```json
{
  "mode": ["WALK", "FLY", "ORBIT", "TELEPORT"],
  "terrainFollowing": true,
  "speed": { "default": 1.4, "min": 0.5, "max": 5.0 },
  "collision": { "enabled": false },
  "updateRate": { "positionInterval": 1000, "maxViewRate": 20 }
}
```

## Documentation Conventions

- `docs/` holds design briefs (`DESIGN-*.md`) and project status notes
- `claude-sessions/` holds session logs and Claude working memory — the
  build history. When you make significant changes, consider adding a
  session log entry there following the existing naming pattern.
- Design-first approach: significant features get a design brief before
  implementation (see `docs/DESIGN-*.md`).
- No throwaway code: tests run against real implementations (actual
  glTF-Transform Document, actual WebSocket server, actual schemas).

## Agent Rules

1. **Do not change SOP message structure** without updating its JSON Schema in
   `@atrium/protocol` and the associated tests. The validator maps message types
   directly to Ajv schemas (including direction-specific forms for `hello` and
   `view`); this coupling must be updated atomically.

2. **Identity coupling is a known constraint.** `AtriumClient._onView()` and
   `_onJoin()` resolve peer avatar nodes by *recomputing* the node name from the
   session ID (`'User-' + msg.id.slice(0, 4)`). Peer routing structurally
   depends on `sessionId → displayName → node name` being derivable. Any feature
   introducing custom display names or multiple sessions per user must
   deliberately break this coupling (see `docs/DESIGN-user-accounts.md`).

## Status as of 2026-08-15

*This snapshot reflects the repo at this date. Verify against recent commits
before relying on it for planning.*

Complete: protocol schemas, server lifecycle/presence/world, SOM + events,
SOMAnimation, AtriumClient, external refs, browser app, playground,
SOM Inspector, renderer-three bridge, interaction selection model.
In progress: SOMCamera work (activeCamera, camera behavior "not behaving
as expected" as of last commits — fixes pending review).
Upcoming: pointer event bubbling, drag-UX polish, ATRIUM_interactivity,
ATRIUM_world extension formalization, user objects, physics, persistence.
