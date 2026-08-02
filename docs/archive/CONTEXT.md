# Super Banking — Project Glossary

Canonical terminology for the Super Banking demo. Use these terms exactly as defined when writing skills, docs, ADRs, code comments, or PR descriptions. If a term needs disambiguation, this file is the source of truth.

**Architectural truths** — system-wide invariants whose naive reading is wrong (gateway routes but owns no tools; Authorization makes the access decision, not the gateway; the heuristic always runs even in "LLM only" mode) — live in [docs/ARCHITECTURE-TRUTHS.md](docs/ARCHITECTURE-TRUTHS.md). Read that before reasoning about gateway routing, the authorization decision boundary, or the agent's heuristic/LLM precedence.

**Architectural decisions** live in [docs/adr/](docs/adr/). Read those when a piece of code looks surprising — there may already be a recorded reason. Current ADRs:
- [ADR-0001](docs/adr/0001-banking-resource-server-colocated-in-bff.md) — banking_resource_server is co-located in the BFF, not a separate service
- [ADR-0002](docs/adr/0002-mcp-resource-server-skips-token-introspection.md) — banking_mcp_resource_server skips token introspection (read-only acceptable risk)
- [ADR-0003](docs/adr/0003-pingauthorize-is-sole-bff-tool-gate.md) — PingAuthorize is the sole authoritative MCP tool gate in the BFF; no local scope-policy decision (R1)
- [ADR-0004](docs/adr/0004-bff-mcp-tool-invocation-pipeline-seam.md) — the BFF [[MCP tool-invocation pipeline]] is one deep module returning an outcome; the route only renders

---

## Roles & services

### BFF

The **banking_api_server** on port 3001. The **sole token custodian** in the system — the only service that holds PingOne access/refresh tokens. Everything outbound that needs a token flows through here.

**Not to be confused with**: the "banking resource server" referenced in gateway env vars (`BANKING_RESOURCE_SERVER_BASE_URL`, `BANKING_RESOURCE_SERVER_RESOURCE_URI`) and in Phase 266 paths. That is **the same BFF Express process wearing a different OAuth audience hat** — specifically `routes/resourceServer.js` + `routes/resourceServerCC.js`, called by the gateway with a token re-exchanged to audience `banking-resource-server.ping.demo`. There is no separate `banking_resource_server` codebase.

### gateway

Always means **`banking_mcp_gateway`** (port 3005), never `banking_mcp_server`. The gateway is the RFC 9728 protected resource that sits in front of the MCP servers and does introspection + RFC 8693 re-exchange + PingAuthorize + HITL escalation.

When you mean the tool registry, say **"MCP server"** or `banking_mcp_server`. Don't say "MCP gateway" loosely.

### agent

There is **one canonical agent**, plus one deliberately-separate cross-stack exhibit. Always qualify which:

- **The canonical agent** — the LangGraph reasoning service `banking_agent_service` on port 3006, **driven by the BFF**. The BFF (`banking_api_server`) keeps token custody, owns conversation state, and runs the HITL gates and the tool loop; port 3006 only does the reasoning. The old "in-process BFF LangGraph agent" is no longer a distinct thing — it **is** this BFF↔:3006 orchestrator.
- **`langchain_agent`** — Python LangChain + local Ollama service on 8888 / 8889 (chat WS) / 8890 (health/inspector). A deliberately-separate **cross-stack exhibit**: same delegated-OAuth security model as the canonical agent, different runtime.
- **Middle / Float / Bottom** — UI **placements** (dock positions) of the one canonical agent in the SPA. Not three agents — one agent rendered three ways.

In prose, prefer the explicit name. In skill descriptions, never write bare "agent."

### agent1

A **sample / placeholder identity**, not a real agent name. Appears in OAuth examples and skill prose to mean "the agent client app" for token examples. Don't treat as a deployed thing.

---

## Concepts

### consent

Always means **HITL consent** in this project — Human-in-the-Loop approval for transactions or tool calls that exceed a threshold or carry risk. State machine in `transactionConsentChallenge` (BFF) + `banking_hitl_service` (standalone challenges service) + `AgentConsentModal` (SPA UI shell).

**Not** OAuth scope consent. If you mean PingOne authorization-server scope consent (the "approve scopes" screen during a login flow), say **"OAuth scope grant"** or **"scope consent"** explicitly — never bare "consent."

The legacy `AgentConsentModal` posts to `/api/auth/oauth/user/consent` (a confusing name kept for backwards compat); even there, the *modal* is part of the HITL UX, not OAuth consent.

### token custody

The hard rule: **only the BFF holds tokens**. The SPA never holds, never receives, never sees an access/refresh token. The SPA carries only the `connect.sid` session cookie. All PingOne, MCP, and downstream calls are made from the BFF using tokens it resolves from session state.

Violations break the project's security posture and would require explicit ADR override.

### MCP tool-invocation pipeline

The single deep module behind `POST /api/mcp/tool` in `banking_api_server` —
`runMcpToolPipeline`. It owns the BFF agent's full tool-call sequence (RFC 8693
token resolution → the sole authoritative Authorize gate → RFC 7662 session
introspection → remote MCP call + gateway audit-trail merge, plus the three
local-fallback hatches). It is the BFF direct path of ARCHITECTURE-TRUTHS T-7
(the agent that does **not** route through the gateway). The pipeline is pure
orchestration: it returns a discriminated `Outcome` and never touches Express;
the route shell renders the outcome and owns the SSE `flowTrace` lifecycle.

**Not** the gateway's routing/disposition path (that is Phase 266, a different
codebase). **Not** an authorization decision — the Authorize gate inside it
stays the sole authoritative gate per ADR-0003 / T-2; the pipeline only
orchestrates the call. Seam rules and the do-not-break verification order:
[ADR-0004](docs/adr/0004-bff-mcp-tool-invocation-pipeline-seam.md).

### Phase 266

The credential-disposition work in the MCP gateway. Three named dispositions:
- **api_key** — gateway swaps user bearer for a shared X-API-Key (used by `banking_api_resource_server`)
- **dual_token** — gateway exchanges + posts `id_token` as an assertion in the JSON-RPC body
- **bankingdata** — gateway exchanges + bearer-calls `banking_resource_server`

OLB tools (`get_my_accounts`, `create_transfer`) **do not** use Phase 266 paths; they go via WebSocket to `banking_mcp_server` unchanged.

### Phase 170

Transfer consent enforcement. Adds the **428 Precondition Required** response when a write transaction lacks a `consentChallengeId`. The SPA must present a consent modal, complete OTP, and resubmit with the challenge ID. See [hitl-consent](.claude/skills/hitl-consent/SKILL.md).

### Phase 269

Encrypted vault for secrets. `VAULT_PATH` + `VAULT_PASSWORD` env vars; password is **deleted from process memory** after startup (T-269-06). Vault loader applies an allowlist regex when copying entries to `process.env` — prevents `LD_PRELOAD`-style injection if vault is compromised.

---

## Acronyms

### OLB

**Online Banking**. The "OLB tools" are the customer-facing banking operations: `get_my_accounts`, `get_account_balance`, `create_transfer`, `create_deposit`, `create_withdrawal`, etc. Lives in `banking_mcp_server` on port 8080. The gateway routes to `mcp-olb` (alias for the OLB MCP server) at `MCP_OLB_WS_URL`.

Investment tools (`get_investment_*`) are a **separate domain** in `banking_mcp_resource_server` on 8081 — not OLB.

### MCP

Model Context Protocol. JSON-RPC 2.0 over WebSocket (and optionally Streamable HTTP `POST /mcp`). Tool-list / tool-call / initialize handshake.

MCP servers in this project:
- **`banking_mcp_server`** — OLB tools (also known as **`mcp-olb`** in gateway env vars and routing tables)
- **`banking_mcp_resource_server`** — investment tools
- **`user_management`** — in-process server inside `langchain_agent`
- **PingOne MCP Server** — PingIdentity's **hosted HTTP MCP server** (`https://api.pingone.{region}/v1/environments/{envId}/mcp`) exposing PingOne + DaVinci admin tools. The BFF reaches it via `mcpPingOneHttpAdapter.js` with a worker `client_credentials` token; Claude Code reaches it directly (configured in `.mcp.json`). The old local `pingone-mcp-server` stdio binary was removed.

### HITL

Human-in-the-Loop. See [[consent]].

### PAZ

A 60-second sensitive-data consent token granted by `POST /api/accounts/sensitive-consent`, required to reveal account numbers and other sensitive fields. Distinct from HITL transfer consent. Lives in `banking_api_server/services/sensitiveDataService.js`.

### CIBA

Client-Initiated Backchannel Authentication. PingOne flow used by:
- `banking_hitl_service`'s `ciba` notifier mode (PingOne backchannel push for approval)
- BFF for step-up auth on high-risk operations

Mechanics: [oauth-pingone](.claude/skills/oauth-pingone/SKILL.md).

---

## Port conventions

External (`api.ping.demo` HTTPS via mkcert):
- **3001** — BFF (`banking_api_server`)
- **4000** — SPA (`banking_api_ui`)

Loopback only:
- **3005** — MCP gateway (`banking_mcp_gateway`)
- **3006** — Node agent service (`banking_agent_service`)
- **3009** — HITL service (`banking_hitl_service`)
- **8080** — MCP OLB (`banking_mcp_server`)
- **8081** — MCP Invest (`banking_mcp_resource_server`)
- **8082** — Mortgage demo backend (`banking_api_resource_server`)
- **8888** — Stale port in CLAUDE.md; the LangChain agent actually uses 8889 + 8890
- **8889** — LangChain agent chat WS (`langchain_agent`)
- **8890** — LangChain agent health + inspector

---

## Skill naming

Per-service skills live under [.claude/skills/banking-*](.claude/skills/) and [.claude/skills/langchain-agent/](.claude/skills/langchain-agent/). Per-domain skills (oauth-pingone, bff-sessions, hitl-consent, pingone-api-calls, mcp-server, regression-guard, typescript-banking) cover cross-cutting concerns. Per-service skills are scoped to **non-overlapping topics only** — they cross-reference the per-domain skills for shared concerns rather than duplicating.

When in doubt: "where does the file live" → per-service skill; "how does the concept work" → per-domain skill.
