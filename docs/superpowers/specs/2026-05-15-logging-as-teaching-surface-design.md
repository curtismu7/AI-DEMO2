# Logging as a Teaching Surface — Design

**Date:** 2026-05-15
**Status:** Approved in principle (brainstorming); pending written-spec review
**Author:** Curtis Muir (with Claude Code)

---

## 1. Context & Problem

BX Finance is an **educational demo**. Its entire purpose is to make the
OAuth 2.0 / OIDC / RFC 8693 token-exchange / MCP delegation story
**observable so people can learn it**. The UI Token Chain panel and the SSE
token stream to the front end already exist for exactly this reason.

A full-repo logging audit (2026-05-15, 3 parallel explore agents across all
10 services) found the logging system is **structurally immature and
inconsistent**, while *also* flagging extensive "CRITICAL token/PII leakage."

**The leakage findings are rejected.** They apply a production-bank threat
model. In this app, token/claim visibility is a *deliberate teaching feature*,
not a leak. Logs themselves are a teaching surface: a learner should be able
to read `/tmp/bank-*.log` and follow one request end-to-end with tokens and
claims fully visible.

The real problems are therefore **structural and pedagogical**, not security:

1. **No shared logging standard.** 3 services have real (3 *different*)
   loggers; 6 are raw `console.*` (~2,300 call sites total across the repo).
2. **No cross-service correlation.** A single request through
   agent → BFF → gateway → MCP → HITL cannot be traced; logs fragment across
   ~12 separate `/tmp/bank-*.log` files with no shared identifier.
3. **Redaction actively fights the teaching goal.** Python's
   `SensitiveDataFilter` and the BFF `mfaLogger` mask the very tokens/claims
   the demo exists to show. Python DEBUG token f-strings are half-masked by an
   `__str__` override — a bug *for a teaching tool*.
4. **Logs are event-spam, not narration.** Even where present, logs don't
   explain *what* delegation step is happening or *why*.
5. **No level consistency / rotation.** `LOG_LEVEL` honored in ~1 service;
   `/tmp/*.log` grows unbounded (acceptable per-session, but uncontrolled).

## 2. Objective

The logs serve **two co-equal purposes**:

1. **Teaching surface** — a legible, narrated, end-to-end traceable account
   of the OAuth/MCP delegation flow, with tokens/claims fully visible.
2. **Primary debugging instrument** — the logs are the tool of record for
   root-causing. A failure should be diagnosable from the logs alone
   (correlation id + operation + cause + timing + relevant state), without a
   fresh repro. `console.*` is the *exception*, not the default mechanism.

Both *without redacting, quieting, or minimizing anything visible today*.
Success criteria:

- A learner can `grep <correlation-id> /tmp/bank-*.log` and read the entire
  OAuth/MCP delegation flow as an ordered, narrated story; the same id
  appears in the UI Token Chain panel for that tool call.
- An engineer handed only the logs for a failed request can identify the
  failing hop, the operation, and the cause without re-running anything.

### `console.*` policy

`console.*` is reserved for cases where a structured logger genuinely cannot
run: pre-logger bootstrap, hard crash / `uncaughtException` handlers, and
build/CLI scripts. Everywhere else, the structured logger is the mechanism.
This **inverts today's state** (where ~2,300 raw `console.*` sites *are* the
logging) — so migration is repo-wide, not scope-limited.

### Non-goals (explicitly out of scope)

- No redaction of tokens, claims, JWTs, or PII that has teaching value.
- No "production-safe" mode / kill switch (decided: not wanted; single mode).
- No change to *what* is displayed in the UI Token Chain or SSE stream
  (only correlation metadata added to it).
- Repo-wide `console.*` migration is **prioritized**, not optional: ordering
  is (1) auth/OAuth/token-exchange/MCP-dispatch/consent paths, (2) request
  handlers & services, (3) remaining sites. Minimal-diff per file; no
  unrelated refactor while migrating. The end state is full migration, not a
  partial one.

## 3. Constraints (REGRESSION_PLAN / repo non-negotiables)

- **Token-custody transport rule still holds.** BFF remains sole token
  custodian; the browser never receives an `Authorization` header. The SSE /
  Token Chain stream is the *sanctioned* display path and is
  **regression-protected** — improve correlation into it, never break it.
- REGRESSION_PLAN §1 files in scope (`banking_api_server/middleware/auth.js`,
  `server.js`, `middleware/correlationId.js`, `banking_mcp_server`
  `TokenIntrospector.ts`): minimal diff; state what will not break before
  editing; §4 Bug Fix Log entry for the Python DEBUG f-string fix.
- Emoji rule: only `⚠️ ✅ ❌` anywhere, including log strings.
- UI build (`cd banking_api_ui && npm run build`) must exit 0 after any
  `banking_api_ui` edit.
- No emoji/marketing-page edits; minimal-diff discipline throughout.

## 4. Architecture

### 4.1 Logger standard

**Node/TS (9 services): pino as core engine only, wrapped in a
teaching-narration API.**

- pino provides levels, transport, and bounded rotation **only**.
- A thin canonical wrapper module (`teachLogger`) is copied per service
  (repo's existing "each service self-contained" style — no new workspace
  tooling). The wrapper exposes both a narration API (teaching) and a
  structured-diagnostic API (debugging), e.g.:
  - `log.step(n, total, '[TEACH] RFC 8693 exchange requested', { ... })`
    — teaching narration
  - `log.info` / `log.warn` / `log.error` — structured; `error` MUST capture
    the error cause/stack, the `operation`, and relevant state, never just a
    message string
  - Every line auto-carries `correlation_id`, `service`, `operation` so a
    failure is diagnosable from logs alone
  - **No redaction config.** Custom serializers *expand* token/claim and
    error objects rather than censor or truncate them.
- Field/event names mirror the Python `SecureLogger` contract
  (`correlation_id`, `session_id`, `user_id`, `operation`, `trace_id`) so
  cross-service and cross-language traces line up.
- `LOG_LEVEL` env honored everywhere; teaching-friendly default (`debug` in
  dev profile, `info` otherwise) — verbose in service of clarity.
- pino-pretty for human-readable dev output; consistent `[Service]` prefixes.

**Python (`langchain_agent`): keep `SecureLogger`, disable
`SensitiveDataFilter`.**

- Retain its structure (JSON, `trace_id`/`span_id`, event taxonomy) — it is
  the reference design.
- Turn **off** `SensitiveDataFilter` so tokens/claims/emails render fully,
  consistent with every Node service.
- Fix `mcp_tool_provider.py:613,614,620,982`: the DEBUG token f-strings are
  half-masked by the `AccessToken.__str__` override. For a teaching tool the
  correct behavior is to print the **real** token clearly. (§4 Bug Fix Log
  entry — this is a teaching-correctness bug fix.)
- Align its correlation field name to the shared `correlation_id` contract so
  one id spans Python + Node.

### 4.2 Cross-service correlation (headline feature)

- A single `X-Correlation-ID` is minted at the first hop (UI→BFF, or agent
  entry for agent-initiated flows) and propagated through **every** service
  and into RFC 8693 token-exchange call logs.
- BFF already has `middleware/correlationId.js` — **extend, don't replace**.
  Thread the id into `teachLogger` via async-local-storage so every line in a
  request carries it automatically.
- Gateway's `GwAuditTrail` (currently emitted only as the `X-Gw-Audit-Trail`
  response header) is **also written to the gateway log** under the same id.
- The same id is injected into the **SSE token-chain events** sent to the UI,
  so the on-screen Token Chain panel and the server logs share one trace
  identifier — UI and logs tell the *same* story for a given tool call.

### 4.3 Narration layer — the AI-architecture curriculum

The logs must let a reader **learn how this AI architecture works** by
reading them. At each teaching-critical moment, emit a consistent, greppable
narrated marker describing *what* and *why*, ordered as steps. The following
events are **required teaching events** — each MUST be narrated with full
detail (no summarizing away the substance that makes it educational):

The curriculum below is **derived from the actual code** (full audit, 3
parallel explorations, 2026-05-15), organized as the learner's journey
through one agent-driven tool call. Each is a **required teaching event**,
narrated with full detail (decoded JWTs, full request/response bodies, full
tool args/results — never truncated or redacted). Exact file:line anchors
are in **Appendix A**.

**Stage 1 — Agent reasoning & tool selection** (LLM drives the machinery):
- agent receives user intent / utterance
- system prompt + tool schemas presented to the LLM (what the model can see)
- LLM selects tool + emits tool-call arguments (full args, why this tool)
- heuristic shortcut vs LLM path (email-detection direct execution — teaches
  when the system bypasses the model and why)
- multi-step loop: tool result fed back to LLM → next tool or final answer
- conversation memory / session-context update (user identification changes
  which tools are safe)

**Stage 2 — Agent identity & actor token** (the agent proves who *it* is):
- agent acquires actor token via client_credentials (scope `ai_agent`)
- private_key_jwt / PKI fallback path (client_assertion vs Basic auth)
- in-flight promise dedup (why N parallel startup calls collapse to one)

**Stage 3 — User auth & session** (the human's credentials):
- PKCE verifier/challenge generated; verifier sent at code exchange
- state + nonce minted; validated at callback (CSRF / replay defense)
- authorization-code → token exchange
- id_token nonce validated; JWKS fetch + RS256 signature verification
- session established; serverless cookie-fallback restore

**Stage 4 — Delegation: RFC 8693 token exchange** (the heart of the demo):
- subject token (user) + actor token (agent) sent — request in full
- exchanged delegated token returned — response in full, decoded
- **claims delta**: `aud: old→new, scope: old→new, sub:…, act: added` with
  the *why* (narrowing / audience restriction / delegation reason)
- `may_act` requested on subject token (authorizes the agent to act)
- scope narrowing = intersection of requested ∩ user scopes

**Stage 5 — Resource-server enforcement** (zero-trust at each hop):
- MCP `initialize` handshake / capability + protocol-version negotiation
- lifecycle guard (reject tools/* before `notifications/initialized`)
- `tools/list` filtered to the scopes the token actually holds (least priv)
- RFC 7662 introspection at the resource server (active? scopes? exp?)
- `aud` validated against the server's own resource URI
- `may_act.client_id` must equal the BFF client_id (delegation proof)
- `act` claim audited (delegated token → actor/subject logged)
- per-tool scope check at `tools/call` → granted / `-32005` insufficient
- gateway anti-bypass (D-05): reject tokens whose `aud` is an upstream MCP
  URI (client tried to skip the gateway hop)

**Stage 6 — Gateway credential disposition** (protocol negotiation):
- `routeTool()` picks backend target + disposition
- credential swap A: OAuth bearer → API key (key masked, never leaves GW)
- credential swap B: OAuth + id_token forwarded (dual_token)
- credential swap C: RFC 8693 exchange → backend-scoped token (oauth_bearer)
- bounded token-exchange cache (eviction at capacity — memory safety)

**Stage 7 — Human-in-the-loop** (when policy says "ask a human"):
- Authorize decision PERMIT / DENY / INDETERMINATE
- INDETERMINATE → HITL challenge issued (`-32002`, challengeId, reason)
- challenge verified + replay-bound to user+agent+tool
- CIBA backchannel: pending notification, blocking poll, retry on approval

**Stage 8 — Every API call, request AND response**, at every hop
(BFF→PingOne, agent→gateway, gateway→MCP, MCP→BFF data API): full method,
URL, headers, body in and out.

**Stage 9 — Visualization correlation** (logs ↔ UI tell the same story):
- SSE token-event emitted to the browser (mid-flight, before HTTP response)
- SSE `mcp-result` custom event → MCP Results tab
- HTTP response merges SSE + body token events
- Token Chain panel renders the 5-step RFC 8693 chain with decoded claims
- the on-screen chain and the logs share the same `correlation_id`

These augment, never replace, existing logs. "Full" means full — this is the
educational payload and per the token-visibility decision is **never**
truncated or redacted.

## 5. Data Flow (correlation, including SSE)

```
UI (cookie) ──▶ BFF: mint/echo X-Correlation-ID
  └─ teachLogger {correlation_id} via ALS
  └─ agentMcpTokenService RFC 8693 exchange → log {correlation_id}
  └─ SSE token-chain event → carries correlation_id  ──▶ UI Token Chain panel
  └─ WS ──▶ gateway: read header
        └─ teachLogger {correlation_id} + GwAuditTrail written to log
        └─ ──▶ mcp-server: read header → Logger/AuditLogger {correlation_id}
        └─ ──▶ hitl-service: read header → teachLogger {correlation_id}
Agent-initiated path: langchain_agent trace_id == correlation_id
                      (shared header contract, filter disabled)
```

Result: `grep <id> /tmp/bank-*.log` → ordered narrated story across all
services; same `<id>` visible in the UI Token Chain panel.

## 6. Error Handling

- Correlation middleware must **fail open**: a missing/malformed
  `X-Correlation-ID` generates a fresh one; it never blocks a request.
- `teachLogger` must never throw into request flow; logging failure degrades
  to `console.*` fallback (preserves current behavior on transport error).
- Disabling Python `SensitiveDataFilter` must not change log *structure*
  (event taxonomy, JSON shape) — only unmask values.
- Bounded rotation must preserve the **current session's** history (size cap
  large enough to keep a full demo run; no aggressive retention that deletes
  learnable history mid-session).

## 7. Testing

- **Visibility regression (inverse of normal):** assert tokens/claims/JWTs
  **still appear** in formatted log output after the refactor. This is the
  primary safety net — the risk here is *accidental redaction*, not leakage.
- **Correlation E2E:** one tool call → assert the same `correlation_id`
  string appears in BFF, gateway, mcp-server, hitl logs **and** in an SSE
  token-chain event captured by a UI test.
- **BFF two-tier pattern** (per CLAUDE.md) for any `correlationId.js` /
  `auth.js` change: regression (mocked configStore) + integration (real .env).
- **Level toggle:** `LOG_LEVEL` env verified to change verbosity per service.
- **Debuggability check:** for a representative induced failure (e.g. token
  exchange rejected), assert the logs alone contain failing hop, operation,
  correlation id, and error cause/stack — no repro needed to diagnose.
- **`console.*` policy check:** a lint/grep gate enumerates remaining
  `console.*` sites; each must fall in an allowed category (bootstrap, crash
  handler, build/CLI script) or be migrated.
- **UI build exit 0** after any `banking_api_ui` edit; targeted `npm test`
  for touched BFF logic.

## 8. Phasing (security-first ordering preserved, redefined as
correctness-first)

- **Phase 1 — Standardize & un-redact.** Introduce `teachLogger` (pino core,
  structured-diagnostic + narration API) per Node/TS service, migrating the
  priority-1 paths (auth/OAuth/token-exchange/MCP-dispatch/consent) off
  `console.*`; disable Python `SensitiveDataFilter`; fix Python DEBUG
  f-string masking bug (§4 entry). No correlation yet. Visibility +
  debuggability regression tests added.
- **Phase 2 — Correlation (headline).** `X-Correlation-ID` minted +
  propagated all hops + into RFC 8693 logs + into SSE token-chain events;
  gateway `GwAuditTrail` written to log. Correlation E2E test.
- **Phase 3 — Full migration + narration.** Complete priority-2/3
  `console.*` migration repo-wide (only allowed-category sites remain); add
  `[TEACH] step k/N` markers at the delegation teaching moments; enable the
  `console.*` policy lint/grep gate.

Each phase independently shippable and verifiable.

## 9. Open Questions

None blocking. (Logger choice, Python filter handling, redaction policy, SSE
scope, and plan ambition all resolved during brainstorming.)

---

## Appendix A — Teaching-moment code anchors

Where each narrated marker is placed. From the 2026-05-15 full-repo audit
(3 parallel explorations). The implementation plan attaches `log.step(...)`
at these sites. ~`file:line` — verify exact lines at implementation time.

### Stage 1 — Agent reasoning & tool selection
- `langchain_agent/src/agent/langchain_mcp_agent.py:106-200` — system prompt + tool schemas built per session
- `langchain_agent/src/agent/mcp_tool_provider.py:82-206` — dynamic tool schemas from MCP metadata
- `langchain_agent/src/agent/langchain_mcp_agent.py:202-239` — agent executor lazily created per session
- `langchain_agent/src/agent/langchain_mcp_agent.py:998-1011` — LLM invoked with prompt+tools+history
- `langchain_agent/src/agent/tracing_callback.py:128-150` — LLM emits tool_calls
- `langchain_agent/src/agent/mcp_tool_provider.py:468-504` — tool result fed back to LLM
- `langchain_agent/src/agent/langchain_mcp_agent.py:394-405,437-475,501-527` — email-heuristic direct execution (bypasses LLM)
- `langchain_agent/src/agent/conversation_memory.py:88-123,240-255` — session memory + user-identified context
- `banking_agent_service/src/reasoningGraph.ts:13-46` — Node reasoning step (Ollama/Helix); `:22-27` reasoning-unavailable → heuristic floor

### Stage 2 — Agent identity & actor token
- `banking_agent_service/src/agentIdentity.ts:44-73` — client_credentials actor token (scope ai_agent), in-flight dedup
- `banking_agent_service/src/agentIdentity.ts:75-125` — private_key_jwt / PKI fallback
- `banking_api_server/services/agentCCTokenService.js:54-78,100-120` — BFF client_credentials + caching
- `langchain_agent/src/agent/mcp_tool_provider.py:322-335` — agent token request inside tool run

### Stage 3 — User auth & session
- `banking_api_server/services/oauthService.js:106-118,164-167` — PKCE verifier/challenge; verifier at exchange
- `banking_api_server/services/pkceStateCookie.js:33-105` — HMAC PKCE cookie (serverless)
- `banking_api_server/routes/oauth.js:65,78,82-84,185-198` — state+nonce mint + callback validation
- `banking_api_server/routes/oauthUser.js:525-535` — id_token nonce validation
- `banking_api_server/services/oauthService.js:155-227` — authorization_code → token exchange
- `banking_api_server/services/jwksService.js:31-59` + `middleware/auth.js:499-528` — JWKS fetch + RS256 verify
- `banking_api_server/routes/oauth.js:144-150` + `services/authStateCookie.js:75-218` — session save + cookie-fallback restore

### Stage 4 — RFC 8693 delegation
- `banking_api_server/services/rfc8693TokenExchangeService.js:74-122` — subject+actor request, act validation (request+response in full here)
- `banking_api_server/routes/agentDelegation.js:94-107` — scope narrowing (requested ∩ user)
- `banking_api_server/services/subjectTokenService.js:76-79` — may_act requested
- `banking_api_server/services/agentMcpTokenService.js:56-60,149-170,407-414` — scope sufficiency + token-event objects (claims-delta source)
- `banking_api_server/middleware/auth.js:975-1017` — requireDelegation (act claim required)

### Stage 5 — Resource-server enforcement
- `banking_mcp_server/src/server/MCPMessageHandler.ts:147-202` — initialize / capability negotiation
- `banking_mcp_server/src/server/MCPMessageHandler.ts:494-519` — lifecycle guard
- `banking_mcp_server/src/server/MCPMessageHandler.ts:207-241` + `tools/toolScopeMap.ts:11-62` — scoped tools/list (least priv)
- `banking_mcp_server/src/auth/TokenIntrospector.ts:30-66,90-122,166-185` — RFC 7662 introspection, aud, may_act, act audit
- `banking_mcp_server/src/server/MCPMessageHandler.ts:315-351` — per-tool scope check (-32005 vs -32001)
- `banking_mcp_gateway/src/auth/GatewayTokenPolicy.ts:25-76` — sub/act.sub invariants + D-05 anti-bypass
- `banking_mcp_gateway/src/auth/authorizeMcpRequestCore.ts:70-114` — transport-agnostic introspection+policy pipeline
- `banking_mcp_invest/src/server/tokenValidator.ts:20-42` — local decode-validate variant (no introspection)

### Stage 6 — Gateway credential disposition
- `banking_mcp_gateway/src/router.ts:24-112` — routeTool → target + disposition
- `banking_mcp_gateway/src/credentialSwap.ts:59-109` — swap A (api_key) / B (dual_token) / C (oauth_bearer)
- `banking_mcp_gateway/src/tokenExchange.ts:37-76` — RFC 8693 exchange + bounded cache (HI-06)
- `banking_mcp_gateway/src/proxy.ts:32-113` — JSON-RPC proxy handshake to upstream; `:43-45` bearer in WS upgrade

### Stage 7 — Human-in-the-loop
- `banking_mcp_gateway/src/middleware/authorizeMcpRequest.ts:162-198` — Authorize evaluate (PERMIT/DENY/INDETERMINATE)
- `banking_mcp_gateway/src/index.ts:459-513` — HITL challenge issue (-32002) + verify (replay-bound)
- `banking_mcp_server/src/server/MCPMessageHandler.ts:354-403` — CIBA initiation; `:371-394` pending notify + blocking poll

### Stage 8 — API request/response at each hop
- BFF→PingOne: token/introspection/refresh/revoke service call sites (oauthService.js, tokenIntrospectionService.js, tokenRefresh.js, rfc8693TokenExchangeService.js)
- agent→gateway / gateway→MCP / MCP→BFF: `proxy.ts:32-113`, `credentialSwap.ts`, MCP `BankingAPIClient` call sites

### Stage 9 — Visualization correlation
- `banking_api_ui/src/services/bankingAgentService.js:77-151,128-143,268-299` — SSE open, token-event append, mcp-result custom event, merge
- `banking_api_ui/src/context/TokenChainContext.js:23-112,193-215` — token-event state + SSE listener
- `banking_api_ui/src/components/education/TokenChainPanel.js:11-104,155-200` — 5-step chain + decoded claims render
- `banking_api_ui/src/components/BankingAgent.js:78-88` — credentialPath stamping (Phase 266 H2 audit list)

> Note: `TokenIntrospector.ts`, `auth.js`, `oauth*.js`, `agentMcpTokenService.js`
> are REGRESSION_PLAN §1 files — narration markers are *additive* log lines;
> state what will not break, minimal diff, no logic change.
