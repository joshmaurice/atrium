# Pre-brief #9 Compliance Table — worldload-address-sync revision

Decision #9: "Connection lifecycle: only the current connection may act, and
starting a connection is an explicit event."

| # | Consumer / Producer | Required Action | File:Line |
|---|---|---|---|
| 1 | AtriumClient.connect() | Bump worldGen, cancel view flush timer | packages/client/src/AtriumClient.js:244–247 |
| 2 | AtriumClient.connect() | Close previous socket, mark its record stale | packages/client/src/AtriumClient.js:252–261 |
| 3 | AtriumClient.connect() | Reset per-connection state (peerSessions, connected, wsUrl, viewState, pointerState) before new record | packages/client/src/AtriumClient.js:264–268 |
| 4 | AtriumClient.connect() | Create new sessionId; set sessionId, displayName, avatarNodeName, avatarDescriptor | packages/client/src/AtriumClient.js:271–281 |
| 5 | AtriumClient.connect() | Derive worldBaseUrl from wsUrl origin (or preserve explicit base) | packages/client/src/AtriumClient.js:283–294 |
| 6 | AtriumClient.connect() | Emit `connecting { sessionId, url, previousSessionId }` **before** creating the socket | packages/client/src/AtriumClient.js:298–299 |
| 7 | AtriumClient.connect() | Create connection record (sessionId, url, worldBaseUrl, ws, stale, closing, peerSessions, gen) | packages/client/src/AtriumClient.js:302–312 |
| 8 | AtriumClient (socket open) | `if (record.stale) return` | packages/client/src/AtriumClient.js:346 |
| 9 | AtriumClient (message dispatch) | `if (record.stale \|\| record.closing) return` | packages/client/src/AtriumClient.js:358 |
| 10 | AtriumClient (onClose) | `if (record.stale \|\| record.closing) return` | packages/client/src/AtriumClient.js:382–383 |
| 11 | AtriumClient (onError) | `if (record.stale \|\| record.closing) return` | packages/client/src/AtriumClient.js:393 |
| 12 | AtriumClient (all msg-type handlers) | `if (record.stale \|\| record.closing) return` | packages/client/src/AtriumClient.js:524,549,582,607,634,652,685,698 |
| 13 | AtriumClient (sync WS throw) | Schedule async error + disconnected, guarded by `if (record.stale) return` | packages/client/src/AtriumClient.js:323–338 |
| 14 | AtriumClient.disconnect() | Mark record stale+closing, close socket, clear `_connectionRecord` | packages/client/src/AtriumClient.js:425–444 |
| 15 | AtriumClient.disconnect() | Emit `disconnected { sessionId, url, reason }` **asynchronously** (setTimeout) | packages/client/src/AtriumClient.js:448–450 |
| 16 | AvatarController._onConnecting() | Reset localNode, cameraNode, peers, lastSentView (same as _onDisconnected) | packages/client/src/AvatarController.js:130–136 |
| 17 | apps/client connecting handler | Call teardownWorld() then setConnectionState('connecting') | apps/client/src/app.js:478–481 |
| 18 | apps/client teardownWorld() | labels.clear(), firstPerson=false, updateHud(), updateHintText() | apps/client/src/app.js:469–476 |
| 19 | tools/som-inspector connecting handler | Call resetPanels() then setConnectionState('connecting') | tools/som-inspector/src/app.js:273–276 |
| 20 | tools/som-inspector resetPanels() | propSheet.clear(), worldInfo.clear(), animationsPanel.clear(), updateStatusBar('') | tools/som-inspector/src/app.js:262–268 |

Every `disconnected` handler (AvatarController, apps/client, tools/som-inspector) also
resets the same state — this is unchanged from the original design; it fires only for
genuine disconnects (never during replacement, because `connecting` arrives first and
the stale record suppresses the old connection's `disconnected`).
