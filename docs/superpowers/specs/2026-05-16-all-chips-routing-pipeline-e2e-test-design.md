# All-Chips Routing + Non-Skippable Pipeline E2E Test — Design

**Date:** 2026-05-16
**Status:** Approved (pending implementation plan)
**Author:** Curtis Muir (with Claude Code)

---

## 1. Goal

Prove that **every built-in agent chip** in
[`banking_api_ui/src/components/BankingChips.jsx`](../../../banking_api_ui/src/components/BankingChips.jsx)
(the 6 `HEURISTIC_CHIPS` + the ~24 `LLM_CHIPS`) behaves correctly under three
intent-routing conditions, AND that whenever a chip resolves to a banking tool
the request traverses the **full non-skippable pipeline** with the token chain
updated.

The hard rule under test: a chip request **cannot skip** RFC 8693 token
exchange, the MCP gateway, or the PingOne Authorize decision. A result returned
without a corresponding 4-stage trail is a test failure.

## 2. Background — the real chip flow

A chip click is a **two-hop** sequence (traced from source):

```
Chip click (BankingChips.jsx -> onChipClick(chip.message))
  -> POST /api/banking-agent/nl   { message, provider }      [ROUTING: heuristic vs helix]
        -> geminiNlIntent.parseNaturalLanguage()
             - heuristic ALWAYS runs first (safety net)
             - if ff_heuristic_enabled && heuristic.kind != 'none'  -> source=heuristic
             - else selected provider (helix) -> source=helix
             - helix non-JSON/refusal -> one retry -> else fall through
             - LLM-only mode, no LLM answer -> fall back to heuristic
  -> dispatchNlResult() resolves result.banking.action
  -> runAction() -> callMcpTool(tool, params)
  -> POST /api/mcp/tool   { tool, params, flowTraceId }       [PIPELINE]
        requireSession (401 if no req.session.user)
        -> resolveMcpAccessTokenWithEvents(req, tool)         RFC 8693 exchange
        -> MCP gateway (:3005) routing leg
        -> mcpToolAuthorizationService.evaluateMcpFirstToolGate  PingOne Authorize (sole gate)
        -> MCP tool executes
        -> response { result, tokenEvents }                   token chain updated
```

Routing and the pipeline only meet on this NL message path, so the test's
subject is the **NL message path** (not raw `/api/mcp/tool` in isolation).

Key source references:
- Routing decision: `banking_api_server/services/geminiNlIntent.js:237-377`
- Heuristic parser: `banking_api_server/services/nlIntentParser.js:195-336`
- Pipeline entry: `banking_api_server/server.js:1224-1425` (`POST /api/mcp/tool`)
- Token exchange: `banking_api_server/services/agentMcpTokenService.js`
- Authorize gate: `banking_api_server/services/mcpToolAuthorizationService.js:73-197`
- Session gate: `banking_api_server/middleware/auth.js` (`requireSession` -> 401 `unauthenticated`)
- User token storage: `req.session.oauthTokens.accessToken`
  (`banking_api_server/services/mcpWebSocketClient.js:76-89`)

## 3. The three routing conditions

| # | Condition | Config | Expectation |
|---|-----------|--------|-------------|
| 1 | Heuristics-only | `ff_heuristic_enabled=true`, no LLM | All 6 heuristic chips resolve + full pipeline. ~24 LLM chips degrade to the heuristic hint message (pass, NOT fail). |
| 2 | Helix-only | real Helix, `ff_heuristic_enabled=false` | Every chip (heuristic + LLM) routes via Helix and resolves + full pipeline. |
| 3 | Helix-fails -> Heuristic fallback | real Helix made unreachable (dead `helix_base_url`) | Heuristic chips still execute end-to-end via fallback; no canned "I didn't catch that" when a heuristic match exists. |

Per-chip expected behavior MUST be encoded so condition 1 does not false-fail
on the LLM-only chips.

## 4. Skip-proof — dual session, no production change

Two existing, real observability surfaces, two sessions:

| Stage | Asserted via | Session | Endpoint |
|-------|--------------|---------|----------|
| RFC 8693 token exchange (user->MCP, `act` actor) | `tokenEvents` + token-chain | Customer | `tokenEvents` from `POST /api/mcp/tool`; `GET /api/token-chain` |
| MCP tool executed | MCP tool-call trail | Customer | `GET /api/token-chain` (`mcpToolCallsChain`) |
| **Authorize PERMIT decision** | app-events `category=authorize` | **Admin** | `GET /api/admin/app-events` |
| **Gateway routing leg** | app-events `category=gateway_path` / `mcp` | **Admin** | `GET /api/admin/app-events` |
| Token chain updated | non-empty `tokenEvents`; new entries vs pre-call snapshot | Customer | `GET /api/token-chain` before/after diff |

- `GET /api/token-chain` (`banking_api_server/routes/tokenChain.js:8`) is gated
  only by `authenticateToken` and auto-scoped to `req.user.id` — the same
  endpoint the SPA Token Chain panel consumes. Customer-safe.
- `GET /api/admin/app-events` (`banking_api_server/routes/admin.js:1006`) needs
  `requireAdmin` + `requireScopes(['banking:admin'])`. The admin session is a
  **read-only corroborator** for the two stages a customer cannot see.
- Correlation is timestamp + `username` (stored per-event,
  `appEventService.js:94`). Per-chip windows are short and serialized, so this
  is sufficient. No shared client flowId is echoed back (`flowTraceId` is
  client-generated and not returned).

**No production code is changed.** All assertions read existing endpoints.

## 5. Deliverables

### A. Live E2E script — `scripts/test-all-chips-e2e.js`

Run against the running `./run-demo.sh` stack.

- Logs in **two** sessions: customer (drives chips) + admin (reads app-events).
- Parses chip list directly from `BankingChips.jsx` (`HEURISTIC_CHIPS` +
  `LLM_CHIPS`) — single source of truth, no hand-copied list to drift.
- Per chip: snapshot `/api/token-chain`, `POST /api/banking-agent/nl`, follow
  to `POST /api/mcp/tool`, re-snapshot, then assert the 4-stage trail
  (customer token-chain + admin app-events).
- **Real Helix** for conditions 2 & 3. Condition 3 sets `helix_base_url` to a
  dead URL via configStore, asserts real timeout -> heuristic fallback, and
  **restores it in a `finally`** even if assertions throw.
- Output: per-chip matrix
  `chip x {heuristic, helix, fallback} -> routed-by | tool | exchange✓ gateway✓ authorize✓ tokenchain✓`.

### B. CI integration suite — `banking_api_server/tests/routes/allChips.pipeline.integration.test.js`

supertest, deterministic, modeled on `tests/routes/hitlGateway.integration.test.js`.

- Covers only the two deterministic conditions:
  1. Heuristics-only (no network).
  2. No-user-token hard-fail: `POST /api/mcp/tool` with no session ->
     **401 `unauthenticated`**, and **zero** exchange/gateway/authorize events.
- Real BFF token-exchange + Authorize code runs; only the downstream MCP tool
  result is stubbed at the gateway boundary.
- **No Helix in CI** — real Helix is non-deterministic/network-bound and lives
  only in the live script.

## 6. Success criteria

- Live script: heuristic chips green in conditions 1 & 3; all chips green in
  condition 2; no-token -> 401 with empty pipeline trail; no chip ever shows a
  result without the full 4-stage trail.
- CI suite: deterministic pass under `npm test`, no network, no Helix.
- Zero production code changed; read-only via `/api/token-chain` +
  `/api/admin/app-events` + `tokenEvents`.
- UI build gate N/A (no `banking_api_ui` change).

## 7. Accepted risks

- Real Helix is non-deterministic / network-bound -> live script only, never CI.
- Customer<->admin event correlation is timestamp + username based (no shared
  flowId) -> acceptable because per-chip windows are short and serialized.
- Condition 3's configStore `helix_base_url` mutation **must** be restored in a
  `finally`, even on assertion failure, or the running stack is left
  misconfigured.

## 8. Out of scope

- Custom (user-defined) chips beyond one representative `llm` + one
  `heuristic` custom chip (covered by the live script's custom-chip case only;
  primary focus is built-in chips).
- Raw `/api/mcp/tool` testing in isolation (routing layer is the subject).
- Any change to production observability (e.g. adding Authorize/gateway events
  to `/api/token-chain`) — explicitly rejected in favor of dual-session.
