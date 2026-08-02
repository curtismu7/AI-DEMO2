# Server Capabilities Report

A plain-English description of what each server in this project does, what it accepts, what it produces, and how it fits into the overall system.

---

## demo_mcp_gateway
**Role: Token-enforcing routing sidecar for AI agents**

Sits between AI agents and all downstream MCP servers. Every tool call from an agent passes through here first. It validates the agent's inbound bearer token (expected audience: `MCP_GW_RESOURCE_URI`) by calling either PingOne or the mock authz server. Before forwarding, it asks the authorization service whether this specific operation is permitted — accounting for the agent's delegated identity (`act` claim) and the requested scope. For sensitive operations (large transfers, high-risk writes), it creates a challenge in the HITL service and blocks the call until a human approves or denies it. Once cleared, it proxies the call to whichever downstream MCP server owns that tool. Also publishes RFC 9728 metadata at `/.well-known/oauth-protected-resource` so clients can discover its auth requirements.

**Takes in:** Agent WebSocket connections with bearer tokens, JSON-RPC tool-call messages  
**Gives back:** Tool results from downstream servers, HITL challenge status, auth errors  
**Calls:** demo_authz_server (policy decision), demo_hitl_service (approval flow), demo_mcp_server, demo_mcp_resource_server, demo_api_resource_server

---

## demo_mcp_server
**Role: Banking operations MCP server**

Exposes the core banking toolset to the MCP ecosystem. Registered tools split into two tiers:

- **Read-only:** `get_my_accounts`, `get_account_balance`, `get_my_transactions`, `sequential_think`
- **Write/restricted:** `get_sensitive_account_details`, `create_deposit`, `create_withdrawal`, `create_transfer`, `query_user_by_email`

Each call arrives with a token representing both the agent and the end user. The server checks the token's scopes, validates the `act` claim for delegation, and calls demo_api_server to actually execute the banking operation. For write operations it may escalate back to the gateway to trigger HITL approval.

**Takes in:** MCP tool-call requests from the gateway with user-bearing tokens  
**Gives back:** Account balances, transaction history, transfer confirmations, error details  
**Calls:** demo_api_server (banking BFF) for data and mutations

---

## demo_mcp_resource_server
**Role: Investment vertical MCP server**

Lightweight counterpart to demo_mcp_server covering investment accounts. Validates inbound tokens against the `mcp-resource-server.ping.demo` audience, then filters the available toolset based on the token's scopes before executing.

**Tools available:** `get_investment_accounts`, `get_investment_balance`, `get_investment_portfolio`, `place_investment_order`

**Takes in:** MCP requests from the gateway with scoped bearer tokens  
**Gives back:** Portfolio data, account balances, order confirmations  
**Calls:** demo_api_server's investment endpoints

---

## demo_api_server
**Role: Central BFF and banking data API**

The single backend that both the human UI and AI agents ultimately depend on. Handles every user-facing operation — OAuth login/callback/logout, session management, account and transaction CRUD, admin dashboards, activity logs — and also exposes the agent-specific routes that the MCP servers call to actually move money. Integrates with PingOne for authentication, token introspection, CIBA consent, and MFA.

**Key endpoint groups:**
- `/api/auth/*` — OAuth flow, CIBA, MFA, session status
- `/api/accounts/*`, `/api/transactions/*` — banking data and mutations
- `/api/admin/*` — stats, activity feed, bootstrap data
- `/api/mcp/*` — exchange mode config, gateway config, decision polling
- `/api/agent/*` — delegation info, agent identity, agent authorization
- `/api/tokens/*` — session token preview and validation

**Takes in:** Requests from the React UI (cookies), from MCP servers (bearer tokens), admin API calls  
**Gives back:** Banking data, session state, OAuth redirects, authorization context  
**Calls:** PingOne for identity and token introspection

---

## demo_authz_server
**Role: Mock PingOne Authorize (drop-in authorization policy engine)**

Mirrors the PingOne Authorize API so the MCP gateway can get policy decisions without hitting the real cloud service. Evaluates whether a given combination of token, scopes, and `act` claim should be permitted. Rules are editable at runtime via a `/rules` API so demo scenarios can be adjusted on the fly.

**Endpoints:**
- `POST /as/introspect` — validates a JWT, returns active/inactive + claims
- `POST /governance/pap/alpha/policy/:workerId/decision` — returns `PERMIT`, `DENY`, or `INDETERMINATE`
- `GET|PUT /rules`, `POST /rules/reset` — live rule editor for demo tuning

**Takes in:** Token strings and authorization context from the gateway  
**Gives back:** Policy decisions (permit/deny), token claims  
**Must stay in sync with:** Real PingOne Authorize — any change to decision params or response shape in the gateway must be mirrored here

---

## demo_hitl_service
**Role: Human-in-the-Loop approval workflow engine**

Manages the approval lifecycle for sensitive AI operations. The gateway creates a challenge here when a tool call exceeds a risk threshold. The challenge sits in a pending state until a human (via the dashboard UI) approves or denies. The gateway polls until it gets a decision, then either proceeds or returns a denial to the agent.

**Lifecycle:**
1. Gateway → `POST /challenges` (creates challenge)
2. Dashboard → `GET /challenges` (lists pending)
3. Human → `POST /challenges/:id/respond` (approve or deny)
4. Gateway → `GET /challenges/:id` (poll for final status)

**Takes in:** Challenge creation requests from the gateway, approval decisions from the UI  
**Gives back:** Challenge IDs, current status, final decisions

---

## demo_api_resource_server
**Role: API-key-gated vertical record service**

Minimal service that demonstrates the "gateway swaps bearer token for an API key" pattern. Instead of accepting OAuth tokens, it validates a per-service API key passed in `X-API-Key`. Each vertical path (`/mortgage`, `/retail`, `/healthcare`, `/gear`, `/expense`) returns a set of demo records. Uses timing-safe key comparison.

**Takes in:** `GET /{vertical}` with `X-API-Key` header  
**Gives back:** Vertical-specific demo records (mortgages, health records, orders, etc.) or 401/404  
**Purpose:** Shows that a backend service doesn't need to understand OAuth — the gateway handles the credential swap

---

## demo_agent_service
**Role: Internal AI reasoning microservice**

Runs LangChain-powered reasoning loops on behalf of the BFF. It never holds a user token directly — the BFF looks up the stored token from the session and passes it back to the gateway for actual tool execution. Access is controlled by a shared internal secret (`x-internal-gateway-secret`), never exposed to clients. Supports Helix, LM Studio, or OpenAI as the LLM backend.

**Takes in:** `POST /api/agent/reason` with reasoning prompts and tool context (internal only)  
**Gives back:** Multi-step reasoning outputs, tool selection decisions  
**Calls:** MCP gateway for tool execution (using the user's token, which the BFF passes through)

---

## demo_api_ui
**Role: React dashboard for human users and admins**

The user-facing web application. Human banking customers use it to log in (via PingOne OAuth), view accounts, review transactions, and initiate transfers. Admins use it to inspect activity logs, manage MCP configuration, edit authz rules, and respond to HITL approval challenges. Also visualizes the live token chain (agent token → user token → exchange) so demos can show the OAuth delegation model clearly.

**What it shows:**
- Account balances, transaction history, transfer flows
- Active agent sessions and their tool calls
- HITL challenge queue with approve/deny buttons
- Admin: user management, activity log, MCP/authz config
- Token inspector showing raw JWT claims and exchange chain

---

## langchain_agent
**Role: Full Python AI agent with OAuth and MCP**

Standalone Python agent built on LangChain. Has its own OAuth client, handles both client-credentials (agent identity) and authorization-code (user identity) flows against PingOne. Connects to MCP servers via WebSocket and streams reasoning + tool results to a browser chat UI in real time. The most complete standalone agent demo — shows the full OAuth + MCP stack from a Python perspective.

**Takes in:** Browser WebSocket chat messages, OAuth callbacks from PingOne  
**Gives back:** Chat responses, token-authenticated tool calls to MCP servers  
**Runs on:** Port 8890 (configurable), optional LangSmith trace UI on 8090

---

## mastra_agent
**Role: Mastra framework agent runtime**

`POST /run` HTTP service wrapping the Mastra agent framework. Accepts a prompt and context, executes with tool support using OpenAI or Anthropic as the LLM backend, and returns results. Pluggable into the same demo architecture as the other agent runtimes.

---

## openai_agent
**Role: OpenAI Agents SDK runtime**

FastAPI service wrapping OpenAI's native agents API. Same `POST /run` interface as the other agent services. Demonstrates how the demo's backend can swap in different agent SDKs without changing the surrounding infrastructure.

---

## pydantic_agent
**Role: Pydantic AI agent runtime**

FastAPI service wrapping Pydantic AI. Same `POST /run` contract. Rounds out the four-way agent framework comparison (LangChain / Mastra / OpenAI / Pydantic).

---

## jwt-verifier-mcp-server
**Role: JWT inspection and debugging tool via MCP**

MCP server that exposes JWT analysis as tools. Any agent or developer connected to it can decode a raw JWT, verify its signature against a JWKS endpoint, validate its claims, fetch and inspect a key set, or explain what a key's fields mean. Primarily a diagnostic and teaching tool for debugging OAuth token chains.

**Tools:** `jwt_decode`, `jwt_verify_signature`, `jwt_validate_claims`, `jwt_fetch_jwks`, `jwt_inspect_key`

---

## ping-gateway
**Role: PingGateway configuration (production gateway alternative)**

Configuration and deployment scripts for PingGateway, the real PingOne product. Configured to do the same job as demo_mcp_gateway — receive inbound MCP requests, validate tokens against PingOne introspection, perform RFC 8693 token exchange, and forward to backend MCP servers. Exists alongside the Node.js gateway as a "what this looks like in production" comparison.

---

## System Map

```
Browser (demo_api_ui)
    └── demo_api_server  ←──────────── OAuth / session / banking data
            └── demo_agent_service     ← internal reasoning (no user token custody)
                    ↓
AI Agents (langchain / mastra / openai / pydantic)
    └── demo_mcp_gateway  ← token validation + policy enforcement + HITL gating
            ├── demo_authz_server      ← PERMIT/DENY decisions
            ├── demo_hitl_service      ← human approval challenges
            ├── demo_mcp_server        ← banking tools  → demo_api_server
            ├── demo_mcp_resource_server        ← investment tools → demo_api_server
            └── demo_api_resource_server  ← API-key-gated vertical records

jwt-verifier-mcp-server  ← standalone debug/teaching tool (connects separately)
ping-gateway             ← production-grade equivalent of demo_mcp_gateway
```
