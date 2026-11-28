# MCP 2026-07-28 ("stateless") handoff

Status as of 2026-11-17. Read this first, then `docs/MCP_2026_07_28_PHASE1.md` for the wire
details. It covers the gateway, the resource server and the BFF.

## Where things stand

| Piece | State |
|---|---|
| Gateway Phase 2 (stateless requests, `resultType`, requestState MRTR, `server/discover`) | Merged (#3623, #3624, #3626) |
| Stale comments and docs | Merged (#3633) |
| WebSocket test for MRTR requestState | Merged (#3636) |
| BFF HTTP client sends stateless requests, flag `mcp_modern_requests` | Merged (#3637) |
| Negotiate per gateway, default on, protocol version in the trace panel | Merged and deployed (#3638, live at `36b212e`) |
| BFF WebSocket client, stateless for gateway discovery | Merged and deployed (#3639, live at `c1c5eb2`) |
| Gateway cancels read-only calls on disconnect | Merged and deployed (#3640, live at `c1c5eb2`) |

Deploy with `scripts/deploy-live.sh --services=...` from the merged main checkout.

## Decisions the owner made (do not re-ask)

- **Flag on, negotiate per gateway.** `mcp_modern_requests` defaults to `true`. On means try
  stateless first and fall back; off means never. There is no third state.
- **WebSocket client: same negotiation.** Only gateway discovery opts in (`allowModern`).
- **Disconnect cancels read-only work only.** Money-moving and other write tools, and any tool
  the manifest does not list, run to completion. Decided 2026-11-17.

## How negotiation works

- The BFF sends a stateless request first: `params._meta` carries
  `io.modelcontextprotocol/protocolVersion` (2026-07-28), `/clientCapabilities` and
  `/clientInfo`; HTTP also sends `Mcp-Method` / `Mcp-Name`. No `initialize`, no session.
- It resends once in the 2025-11-25 shape when the answer is:
  - `rejected`: `-32022`, `-32020`, or `-32602` about `_meta`. Remembered per gateway base URL
    for 5 minutes (`NEGATIVE_TTL_MS`).
  - `input_required`: the gateway spoke Modern and wants a confirmation. The BFF's elicitation
    and HITL flows still use the old shape. Not remembered.
- Never stateless toward: PingGateway (speaks only 2025-06-18 and 2025-11-25), the Privilege
  door (`pinGatewayBase`), or a caller-supplied `sessionId`.
- Code: `demo_api_server/services/mcpModernRequest.js` (shared rules),
  `mcpGatewayClient.js` (HTTP), `mcpWebSocketClient.js` (WebSocket, `mcpRpcAttempt` plus the
  `mcpRpc` wrapper that does the resend after the pool slot is released).
- The trace panel shows the version per call: `mcpToolPipeline.js` emits an `mcp-protocol`
  event, `buildTraceSteps.js` renders it on the gateway step. No row on calls that throw before
  the client answers (a 403, for example); `mcpProtocol` is not attached to thrown errors.

## Disconnect cancellation (PR #3640)

`demo_mcp_gateway/src/disconnectCancel.ts` holds the rule. A call is cancellable when the method
is read-only (`tools/list`, `resources/*`, `prompts/*`, `completion/complete`), or when it is a
`tools/call` of a tool that `scope-topology.json` lists with only read scopes (`read` or
`*:read`) and no `challengeType`. Wired in:

- WebSocket: `ws.on('close')` in `src/index.ts`; the per-connection registry holds
  `{controller, cancelOnDisconnect}` per call.
- HTTP: the invest path (`res.on('close')`) and the two forwarded `tools/call` POSTs in
  `src/server/GatewayServer.ts` (axios `signal`). The `initialize` handshake POST is left alone.

An explicit `notifications/cancelled` still aborts whatever it names, including a money tool.
That is a different rule from disconnect and was left alone on purpose.

## What is and is not verified

Verified live on the stack (generation pinned around each run): flag on, the BFF sent
`(MCP 2026-07-28)` requests with 0 resends, and the real `/api/agent/invoke` response carried
`mcp-protocol` "MCP protocol — 2026-07-28 (stateless)". Flag off gave
`MCP protocol — 2025-11-25`, reason `flag-off`.

Also verified live after deploying #3639 and #3640 (2026-11-17, stack at `c1c5eb2`): the
`/api/mcp/traffic` log shows `RPC → tools/list (MCP 2026-07-28, stateless)` from the
WebSocket discovery path followed by a single `RPC ← tools/list OK` — no 2025-11-25
resend.

Still not verified live:

- The `input_required` resend and the old-gateway rejection resend (the live gateway never
  rejects; unit tests only).
- #3640 disconnect cancellation against a real mid-call disconnect (unit and integration
  tests only).
- The "MCP protocol" row rendered in the browser (unit test only).

## Open follow-ups, none started

- Show the protocol on denied or errored calls (attach `mcpProtocol` to thrown errors).
- If the gateway is ever scaled past 1 replica: set `GW_REQUEST_STATE_SECRET` and note it in the
  manifest. requestState is single-use per replica; the k8s gateway has `replicas: 1`.
- Decide whether `notifications/cancelled` should also spare money tools.
- The MCP Inspector and the direct MCP-server WebSocket path still use the handshake. The
  Inspector teaches it and the direct server rejects uninitialized requests with `-32600`.
- `~/air-work/` JSON copies on the Air are leftover and can be deleted.

## Gotchas that cost time

- **Config flags persist.** A flag put in `demo_api_server/.env` and restarted is copied into
  LMDB; deleting the line later leaves it on. Revert with `setConfig` (in
  `docker exec ai-demo-api-server node -e`, after `await cs.ensureInitialized()`), restart, and
  verify after `ensureInitialized()`. Prefer the UI toggle.
- **Pin the stack generation** around any live drive: `gen="$(npm run -s stack:generation)"` and
  `npm run -s stack:generation -- --check "$gen"`. A non-zero check voids the run.
- **`deploy-live.sh` refuses to race another deploy.** Wait for the other one, then re-run. Do
  not read its exit status through a pipe.
- **Pre-commit gate skips in worktrees.** Run `npm run topology:verify` in the main checkout
  before merging anything that touches scope topology or tool schemas.
- **Worktrees have no `node_modules`.** `npm ci` in `demo_api_server/` and `demo_mcp_gateway/`
  (run it here, not on the Air). A `node_modules` symlink to another worktree works for jest but
  must never be staged.
- **Jest in the gateway** swallows `console.log` and hides some failure messages; run with
  `--reporters=default`, and write to a file for a quick probe. Mutation checks must still
  compile, or ts-jest fails the suite and the mutant proves nothing.
- Stage files explicitly, never `git add -A`. Account is `curtismu7`; no AI attribution in
  commits or PR bodies.

## Where to look

- `docs/MCP_2026_07_28_PHASE1.md`: wire details and Phase 2 status.
- `demo_mcp_gateway/src/modernNegotiation.ts`, `serverDiscover.ts`, `requestState.ts`,
  `upstreamModern.ts`: gateway side.
- Tests: `demo_api_server/tests/mcpGatewayClient.modernRequest.test.js`,
  `mcpWebSocketClient.modernRequest.test.js`, `mcpToolPipeline.mcpProtocolEvent.test.js`;
  `demo_mcp_gateway/tests/wsRequestState.test.ts`, `wsDisconnectCancel.test.ts`,
  `disconnectCancel.test.ts`, `gateway-http-progress-cancellation.test.ts`.
