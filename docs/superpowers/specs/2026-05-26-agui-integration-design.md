# AG-UI / A2UI Integration Design

**Date:** 2026-05-26  
**Branch:** feat/ag-ui-core  
**Status:** Approved — ready for implementation planning

---

## 1. Goal

Integrate the AG-UI protocol into the banking demo agent stack so that:

- The LangChain agent emits typed, interoperable AG-UI events natively
- The React UI consumes them via a raw `@ag-ui/client` hook (no opinionated UI framework)
- Token chain lifecycle and HITL consent flow through the same AG-UI event stream as first-class custom events
- Any AG-UI-compatible frontend or middleware can connect to the agent without changes

---

## 2. Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Integration layer | Agent emits AG-UI natively; BFF enriches with custom events | Agent is the canonical source of truth; banking-specific events (token chain, HITL) stay server-side |
| Transport | HTTP POST + SSE | AG-UI canonical transport; Vercel-compatible; simpler than WebSocket; token injection becomes standard middleware |
| Frontend consumption | Raw `@ag-ui/client` SDK + custom hooks | Full rendering control; keeps banking design system intact; avoids CopilotKit UI dependency |
| Migration strategy | Incremental — five phases, dual-emit, feature flag | App stays working after every phase; each layer independently testable |
| Scope | All four layers: core events, state delta, token chain, HITL | Full AG-UI compliance from day one |

---

## 3. Architecture

### End-state stack

```
React UI
  └── useAgentRun()                        # @ag-ui/client EventSource
        └── POST /api/agent/run            # BFF route
              ├── RFC 8693 token exchange  # agentMcpTokenService.js
              ├── CUSTOM(token_chain_*)    # injected by aguiSseProxy.js
              └── SSE proxy → agent :8888/run
                    └── LangChain agent
                          ├── AGUIEventEmitter  (Python)
                          └── SSE transport     (Python)
```

### New route: `POST /api/agent/run`

Request body:
```json
{ "message": "Show my accounts", "session_id": "abc123" }
```

Response: `Content-Type: text/event-stream`

Each event is an AG-UI typed object serialised as:
```
data: {"type":"RUN_STARTED","runId":"run_xyz","threadId":"thread_abc"}\n\n
```

### HITL suspend/resume

Designed for cloud hosting (multiple BFF instances, serverless). The SSE stream and the consent POST may land on different instances — Redis pub/sub bridges them.

```
SSE stream open (instance A)
  → CUSTOM(hitl_consent_request) emitted
  → run state written to Redis: agui:run:<runId> = { status: 'suspended_hitl', ... } TTL 5min
  → SSE handler subscribes to Redis channel: agui:consent:<runId>
  → SSE keep-alive pings every 15s

User approves/denies (may hit instance B)
  → POST /api/agent/consent/:runId
  → BFF reads run state from Redis, validates status = 'suspended_hitl'
  → BFF publishes to Redis channel: agui:consent:<runId> = { approved: true }
  → BFF deletes run state from Redis

Instance A receives pub/sub message
  → SSE stream resumes
  → RUN_FINISHED closes stream
```

**Redis client:** Uses the existing Upstash REST client (`demo_api_server/services/upstashClient.js` or equivalent) — the same store used for sessions on Vercel. Locally, falls back to TCP Redis. The `agentRunStore` service abstracts this so routes don't know which backend is in use.

**Local fallback:** When Redis is unavailable (dev without Redis), `agentRunStore` falls back to an in-process `EventEmitter` — same interface, single-instance only. A warning is logged at startup.

---

## 4. Event catalogue

### Standard AG-UI events (emitted by Python agent)

| Event | Trigger |
|---|---|
| `RUN_STARTED` | Agent turn begins |
| `TEXT_MESSAGE_START` | LLM begins generating |
| `TEXT_MESSAGE_CONTENT` | Each LLM token delta (`on_chat_model_stream`) |
| `TEXT_MESSAGE_END` | LLM generation complete |
| `TOOL_CALL_START` | `on_tool_start` callback |
| `TOOL_CALL_END` | `on_tool_end` callback |
| `STATE_DELTA` | After tool result — structured agent state patch |
| `RUN_FINISHED` | Turn complete (or error/cancel) |
| `ERROR` | Unrecoverable agent error |

### Custom events (injected by BFF)

| Event name | Payload | Trigger |
|---|---|---|
| `token_chain_bearer_obtained` | `{ sub, exp }` | User bearer token resolved from session |
| `token_chain_exchange_started` | `{ client_id, audience }` | RFC 8693 exchange begins |
| `token_chain_mcp_token_obtained` | `{ act, exp }` | MCP token received |
| `token_chain_act_valid` | `{ act.sub }` | `act` claim present and valid |
| `token_chain_act_absent` | `{}` | `act` claim missing from MCP token |
| `token_chain_error` | `{ code, message }` | Exchange failed |
| `hitl_consent_request` | `{ runId, tool, params, threshold }` | HITL gate triggered |
| `hitl_timeout` | `{ runId }` | Consent not received within timeout |
| `auth_challenge` | `{ reason }` | Token expired mid-run |

All custom events use the AG-UI `CUSTOM` event type:
```json
{ "type": "CUSTOM", "name": "token_chain_mcp_token_obtained", "value": { ... } }
```

---

## 5. Components

### LangChain agent — `langchain_agent/`

| File | Status | Purpose |
|---|---|---|
| `src/agui/emitter.py` | New | `AGUIEventEmitter` — wraps LangChain callbacks, emits typed AG-UI events |
| `src/agui/event_types.py` | New | AG-UI event dataclasses |
| `src/agui/sse_transport.py` | New | Serialises events as SSE `data:` lines; keep-alive ping |
| `src/websocket_handler.py` | Modified | Dual-emit (existing WS + new AG-UI SSE) during migration, gated by `agui_enabled` flag |
| `src/config/settings.py` | Modified | Add `agui_enabled: bool`; `/run` SSE endpoint added to existing uvicorn HTTP server on port 8888 (no new port) |

### BFF — `demo_api_server/`

| File | Status | Purpose |
|---|---|---|
| `routes/agentRunRoute.js` | New | `POST /api/agent/run` — auth, RFC 8693 exchange, SSE proxy |
| `routes/agentConsentRoute.js` | New | `POST /api/agent/consent/:runId` — HITL resume |
| `services/aguiSseProxy.js` | New | Pipes agent SSE to browser; injects CUSTOM events inline |
| `services/agentRunStore.js` | New | Redis-backed run registry (`agui:run:<runId>`) + pub/sub consent signalling (`agui:consent:<runId>`); falls back to in-process EventEmitter locally |
| `services/agentMcpTokenService.js` | Modified | Emit token chain events as CUSTOM AG-UI objects |
| `server.js` | Modified | Mount new routes; retain `/ws/langchain` during migration |

### React UI — `demo_api_ui/src/`

| File | Status | Purpose |
|---|---|---|
| `hooks/useAgentRun.js` | New | Opens SSE via `@ag-ui/client`, dispatches events, exposes `sendMessage()` |
| `hooks/useAgentState.js` | New | State slices: `messages`, `toolCalls`, `agentState`, `tokenChain`, `hitlPending` |
| `hooks/useHitlConsent.js` | New | Handles `hitl_consent_request` CUSTOM event → modal → POST consent |
| `components/BankingAgent.js` | Modified | Swap WS data source for `useAgentRun()`; rendering logic unchanged |
| `context/TokenChainContext.js` | Modified | Read token chain from CUSTOM AG-UI events instead of `/api/mcp/tool` response |
| `services/langchainWebSocket.js` | Deleted (Phase 5) | Replaced by `useAgentRun` SSE client |

---

## 6. Migration phases

### Phase 1 — Agent emits AG-UI (dual-emit)
- Add `AGUIEventEmitter`, `event_types.py`, `sse_transport.py`
- Gate with `agui_enabled` setting (default off)
- Agent still sends existing WS frames in parallel
- Verify AG-UI events are correct with curl test harness
- **No BFF or UI changes**

### Phase 2 — BFF SSE endpoint + token chain
- Add `agentRunRoute.js`, `aguiSseProxy.js`, `agentRunStore.js`
- RFC 8693 exchange runs at request time; token chain CUSTOM events injected
- `POST /api/agent/run` → SSE stream verifiable with curl
- Old `/ws/langchain` stays live

### Phase 3 — React `useAgentRun` hook + feature flag
- Add `useAgentRun.js`, `useAgentState.js`
- Wire into `BankingAgent.js` behind `ff_agui_enabled` configStore flag (default off)
- `TokenChainContext` reads from CUSTOM events when flag is on
- Both paths live simultaneously; toggle via `/config`

### Phase 4 — HITL via AG-UI
- Add `agentConsentRoute.js`, `useHitlConsent.js`
- Agent run suspends on HITL gate; SSE keep-alive every 15s
- Consent POST resumes run; timeout (5 min configurable) emits `hitl_timeout` + closes stream
- Reuse existing consent modal UI — data source only changes

### Phase 5 — Cutover + cleanup
- Flip `ff_agui_enabled` to default-on in configStore
- Verify against REGRESSION_PLAN checklist: login → agent → tool call → token chain → HITL
- Delete `langchainWebSocket.js` and `/ws/langchain` BFF proxy
- Remove dual-emit from Python agent; remove `agui_enabled` flag

---

## 7. Error handling

| Scenario | Handling |
|---|---|
| SSE connection drop mid-run | `useAgentRun` retries with exponential backoff (max 3); shows "Connection lost — reconnecting…" |
| Agent `ERROR` event | Mapped to error message in chat thread; BFF emits `RUN_FINISHED` after to close stream cleanly |
| RFC 8693 exchange failure | BFF emits `CUSTOM(token_chain_error)` then `ERROR` + `RUN_FINISHED`; UI shows "Unable to obtain agent token" |
| HITL timeout (5 min) | Redis TTL expires on `agui:run:<runId>`; SSE handler detects missing key on next keepalive, emits `CUSTOM(hitl_timeout)` + `RUN_FINISHED`; consent modal shows timeout notice |
| Token expiry mid-run | Detected at run start by BFF; emits `CUSTOM(auth_challenge)`; UI shows "Session expired — please log in again" |
| MCP tool failure | Agent emits `TOOL_CALL_END` with error payload; agent LLM decides recovery; no special BFF handling |

---

## 8. Testing

- **Phase 1:** curl the agent's `/run` SSE endpoint directly; assert correct event sequence for a tool call turn
- **Phase 2:** curl `POST /api/agent/run` through BFF; assert CUSTOM token chain events appear in stream before `RUN_STARTED`
- **Phase 3:** Jest unit tests for `useAgentRun` and `useAgentState` with a mock EventSource
- **Phase 4:** Jest unit test for `useHitlConsent`; integration test for suspend/resume via `agentRunStore`
- **Phase 5:** Full regression checklist from `REGRESSION_PLAN.md` before removing old WS path

---

## 9. Success criteria

- [ ] A single agent turn produces a correctly-ordered AG-UI event sequence (verifiable with curl)
- [ ] Token Chain panel in UI reads events from AG-UI CUSTOM stream (not `/api/mcp/tool` response)
- [ ] HITL consent gate suspends the SSE stream and resumes on approval
- [ ] All existing banking flows pass the REGRESSION_PLAN pre-deploy checklist after cutover
- [ ] `langchainWebSocket.js` and `/ws/langchain` are deleted in Phase 5
- [ ] No tokens exposed to browser at any point (token custody rule preserved)
