# Feature & Demo Guide

> **Who this is for:** Solutions engineers, architects, and anyone giving a live demo.  
> **What it covers:** Every demoable capability, use-case walkthroughs, and a 20-minute pitch checklist.

---

## Elevator Pitch

This is a **multi-vertical AI-agent-security demo** that shows PingOne doing real identity work — not simulated. The default skin is **Super Banking**, but the same security pipeline drives several industry verticals (see below). Every time the AI agent takes a sensitive action — moving money, reading account data, accessing a record — a live RFC 8693 token exchange fires, PingOne issues a narrow-scoped MCP token, and the full delegation chain is visualised in the browser in real time.

It's the answer to *"Show me how PingOne secures an AI agent."*

### Verticals

The demo ships with these verticals (banking is the default skin):

- **Super Banking** (default)
- **Healthcare**
- **Retail**
- **Workforce**
- **Sporting-goods**
- **Admin-console** — a shared role overlay generic across all verticals, not an industry of its own

---

## Key Demo Scenarios

### UC-A — Standard Login (OAuth 2.0 / OIDC)
User visits the marketing page, clicks **Log In**, authenticates at PingOne, and lands on the dashboard with a live session. Under the hood: Auth Code + PKCE, `state` + `nonce` CSRF protection, ID token validation, refresh token rotation — all surfaced in the **Token Chain** panel.

**What to show:** Token Chain panel → expand the login event → see `access_token`, `id_token`, `refresh_token` scope and audience side by side.

---

### UC-B — Step-Up MFA on High-Value Transactions (deviceAuthentications API)
The AI agent attempts a transfer over the threshold (default **$500**). PingOne issues a deviceAuthentication challenge — users can authenticate via OTP, Push, or FIDO2/WebAuthn. The agent waits. The user completes MFA in the approval modal. The agent resumes automatically with an elevated token.

**What to show:** Ask the agent *"Transfer $600 from Checking to Savings"* → watch the deviceAuthentication challenge appear → select MFA method → authenticate → transaction completes.

**Supported MFA Methods:**
- Email OTP
- SMS OTP  
- Push Notifications
- FIDO2/WebAuthn (Biometrics/Passkeys)

> **Implementation Note:** Uses PingOne's deviceAuthentications API approach for optimal flexibility and user experience.

---

### UC-C — AI Banking Agent (MCP + NL routing)
The Banking Agent understands natural language. Ask it to check balances, transfer money, explain a transaction, or look up another user. Every banking tool call is routed through the MCP server.

**Demoable commands:**
- *"What's my checking balance?"*
- *"Transfer $50 from Savings to Checking"*
- *"Show me my last 5 transactions"*
- *"Find the account for user@example.com"*

**Natural-language routing pipeline** (`demo_api_server/services/geminiNlIntent.js` — note: the filename is legacy; **Gemini is not used**, the file is the generic NL-intent entry point):

The agent uses a **three-tier routing chain**, in this order on every prompt:

1. **Heuristic parser (zero latency, ALWAYS runs).** A pure in-process regex matcher (`nlIntentParser.js`) recognises well-known phrases like `accounts`, `balance`, `transactions`, `transfer $600 from checking to savings`, `show mortgage data`, `what's my biggest purchase`. Every chip in the agent UI is matched here. When the heuristic finds a match and the default `ff_heuristic_enabled=true` flag is set, the result short-circuits the LLM entirely — the user sees the tool result instantly with no LLM round-trip cost.
2. **LLM (Helix / Ping AI by default; configurable).** When the heuristic finds no match — or when the operator flips the "LLM only" toggle in the agent UI (`ff_heuristic_enabled=false`) — the prompt goes to a configured LLM. The default is the public **LLM2** Helix / Ping AI agent. Operators can switch to Anthropic Claude, OpenAI, or a local LM Studio model, or override the Helix tenant via `/setup` or `HELIX_*` env vars. The LLM is a JSON router: it returns a structured intent (`{"kind":"banking","banking":{"action":"transfer",…}}`) that is then dispatched to the matching tool.
3. **Heuristic safety net (fallback).** If the LLM is unreachable, mis-configured, or returns `kind:none`, the routing chain falls back to the heuristic's result — even if the heuristic produced `kind:none` itself. The agent UI never returns the canned "I didn't catch that" fallback when the heuristic recognised the input; it only surfaces that hint as a last-resort.

**LLM providers:** Helix / Ping AI (default), Anthropic Claude, OpenAI, LM Studio (local) — plus the always-on heuristics.

**Agent mode picker (7 modes, `agentModeResolver.js`):** `heuristics`, `helix_google`, `heuristics_helix` (default), `lmstudio`, `heuristics_lmstudio`, `chatgpt`, `claude`.

This three-tier contract was introduced 2026-05-11 to guarantee chip clicks work regardless of LLM availability. See [REGRESSION_PLAN.md §4](../../REGRESSION_PLAN.md#4-bug-fix-log-reverse-chronological) "NL parser: heuristic is a deterministic safety net" for the do-not-break rules.

**Agent layouts:** Float, left-dock, right-dock, bottom-dock — all resizable.

---

### UC-D — RFC 8693 Token Exchange (MCP Tool Delegation)
Every time the agent calls a banking tool, the BFF exchanges the user's session token for a narrow-scoped MCP token. PingOne does the exchange — the browser never sees a token.

**Two delegation paths:**

| Path | How it works | Token has |
|------|-------------|-----------|
| **1-Exchange** | User token → MCP token | `sub=user`, `aud=mcpserver.ping.demo` |
| **2-Exchange** | User token + Agent actor token → MCP token | `sub=user`, `aud=mcpserver.ping.demo`, `act={sub:agent_client_id}` |

The **Token Chain** panel visualises every step live — subject token in, exchanged token out, scope narrowing shown as badge diff.

---

### UC-E — Family Delegation (`may_act` / `act` claim)
A parent account can delegate access to a child/spouse. The delegated user's token carries `may_act: { client_id: <bff> }` injected by PingOne. The BFF uses this as authorisation to perform the token exchange on their behalf. The `act` claim in the resulting MCP token records the full delegation chain per RFC 8693 §4.1.

**What to show:** Log in as the delegated user → initiate a transfer → Agent Flow Diagram shows the `act` claim chain.

---

### UC-F — Sensitive Data Access (PingOne Authorize)
Certain agent actions (e.g., viewing full account numbers or accessing regulated data) require an explicit PingOne Authorize (PAZ) policy decision. The BFF calls the PAZ evaluation endpoint before executing the tool. Access is denied without a matching policy decision — surfaced as a 403 in the Agent Flow Diagram.

**What to show:** Admin → Config → enable PingOne Authorize → trigger a sensitive query → watch the PAZ gate fire in the flow diagram.

---

### UC-G — Self-Service PingOne Setup (Management API)
First-time setup provisions the entire PingOne environment automatically: creates OIDC applications, resource servers, and scopes via the PingOne Management API using a worker token. No manual console clicks required.

**What to show:** Admin → Setup Wizard → enter env ID + worker credentials → watch apps and scopes provision in real time.

---

### UC-H — Admin / Ops Console (Token Debug + OAuth Log)
The admin dashboard exposes:
- **Token Chain Visualiser** — live token events per action with RFC citations
- **Agent Flow Diagram** — per-step authorisation breakdown with pass/fail status
- **Verbose OAuth Log** — every HTTP call the BFF makes to PingOne
- **MCP Inspector** — tools/list via live WebSocket, connection status
- **API Viewer** — raw request/response for every banking operation
- **Config Panel** — all feature flags, PingOne settings, exchange modes, Vercel env vars

---

## Feature Matrix

| Feature | Description | Where to Demo |
|---------|-------------|---------------|
| **Auth Code + PKCE** | Full RFC 7636 + nonce; state CSRF protection | Login flow → Token Chain |
| **Pushed Authorization Requests (PAR)** | RFC 9126 — login via PAR endpoint | Admin → Config → `use_par=true` |
| **Token Introspection** | RFC 7662 — inspect any token live | Admin → Token Inspect tab |
| **Token Revocation** | RFC 7009 — access + refresh revoked on logout | Logout → OAuth log |
| **RFC 8693 Token Exchange (1-exchange)** | Narrow-scope user→MCP delegation | Agent tool call → Token Chain |
| **RFC 8693 Token Exchange (2-exchange)** | Agent actor + `act` claim chain | `ff_two_exchange_delegation=true` |
| **`may_act` / `act` claims** | RFC 8693 §4.1 — delegation proof in token | 2-exchange path → JWT viewer |
| **MFA Step-Up** | Backchannel/step-up MFA for high-value actions — **separate gate** from HITL consent (default >$500) | Transfer >$500 |
| **Email OTP Step-Up** | Fallback step-up via PingOne MFA email | `STEP_UP_METHOD=email` |
| **FIDO2 / TOTP Step-Up** | Hardware key / TOTP via PingOne MFA | Config → step-up method |
| **PingOne Authorize Gate** | Fine-grained policy enforcement per tool | Config → PAZ settings |
| **RFC 9728 Protected Resource Metadata** | `/.well-known/oauth-protected-resource` discovery endpoint | Direct URL |
| **RFC 8707 Resource Indicators** | `audience` parameter in token exchange | All exchanges |
| **HITL Transaction Consent** | Consent gate before execution — HTTP 428 + `consentChallengeId` (default >$250); approve, then retry with receipt | Transfer >$250 |
| **Family/Account Delegation** | `may_act` scoped delegation between users | UC-E |
| **Sensitive Data ACR Gate** | Step-up triggered by ACR policy | UC-F |
| **BFF Token Custodian** | Tokens never touch the browser | Inspect browser cookies |
| **Token Chain Visualiser** | Live token event log with RFC citations | Every agent action |
| **Agent Flow Diagram** | Per-step auth breakdown with pass/fail | Agent sidebar |
| **MCP WebSocket Tool Server** | TypeScript MCP server with auth challenge gating | MCP Inspector tab |
| **NL → structured tool call** | Natural language routed to a banking/vertical tool | Agent chat |
| **Multi-provider LLM switching** | Helix/Ping AI · Anthropic Claude · OpenAI · LM Studio (+ heuristics) | Admin → Config → LLM |
| **7-mode agent picker** | heuristics, helix_google, heuristics_helix (default), lmstudio, heuristics_lmstudio, chatgpt, claude | Agent mode selector |
| **Multi-vertical mode** | Banking (default), healthcare, retail, workforce, sporting-goods, + admin overlay | Config → vertical |
| **Agent layouts** | Float, left-dock, right-dock, bottom-dock | Layout switcher |
| **Floating resizable windows** | Agent panel, token chain, API viewer all draggable | Drag any panel header |
| **API Viewer** | Raw request/response for every banking op | Action Hub → API |
| **MCP Inspector** | Live tools/list + WebSocket health | Admin → MCP tab |
| **MCP Tools List Modal** | Searchable pop-out window for all available banking tools | Banking Agent → "MCP Tools" chip |
| **Verbose OAuth Log** | Every BFF→PingOne HTTP call | Admin → OAuth Log |
| **Self-service provisioning** | Management API setup wizard | Admin → Setup Wizard |
| **Self-service user creation** | Create PingOne users with `mayAct` attribute | Admin → Users |
| **Demo data reset** | One-click accounts/transactions reset | Admin → Demo Data |
| **Postman collections** | Pre-configured API collections <!-- TODO: verify count --> | `docs/user-guide/POSTMAN-GUIDE.md` |
| **Architecture diagrams** | Auth Code, CIBA, token exchange, C4, token anatomy draw.io | `docs/` |
| **In-app education panels** | RFC explainers, landscape panels, AI maturity model <!-- TODO: verify count --> | Every feature has a panel |
| **Vercel-ready deployment** | Redis session store, env var config, Upstash support | `docs/user-guide/deployment.md` |
| **Docker / Kubernetes** | `docker-compose.yml` + `k8s/` manifests | Available today |

---

## Architecture in 30 Seconds

```
Browser (React SPA)
  ↕ session cookie only — tokens never here
BFF (Express — demo_api_server)
  ↕ PingOne auth flows   ↕ RFC 8693 exchange per MCP call
PingOne (auth.pingone.com)
  ↕ narrow MCP token issued
MCP Server (TypeScript WebSocket — demo_mcp_server)
  ↕ tool execution with auth challenge gating
Agent runtimes (concurrent: langchain / openai / mastra / pydantic + Helix/Claude/OpenAI/LM Studio)
```

Three OAuth apps in PingOne: Admin OIDC · User OIDC · Agent Actor (worker)

Full technical detail: [`docs/ARCHITECTURE_WALKTHROUGH.md`](../ARCHITECTURE_WALKTHROUGH.md) · C4 diagram: `docs/`

---

## What Makes This Different

| Claim | Why it's true |
|-------|--------------|
| **Token exchange is real, not mocked** | Every agent tool call fires a live `POST /token` with `grant_type=token-exchange` to PingOne — visible in the OAuth log |
| **Token Chain shows the live delegation chain** | Not a diagram — it's the actual token events from the current session, with RFC citations and scope diff |
| **Agent Flow Diagram shows per-step auth** | See exactly which step passed or failed and why, in real time |
| **In-context education panels** | Every feature has an RFC explainer panel that opens next to the running demo — no context switching <!-- TODO: verify count --> |
| **Multi-vertical out of the box** | Banking, healthcare, retail, workforce, and sporting-goods variants with one config toggle |
| **Self-provisioning** | New environments set up in minutes with the setup wizard — not hours of manual console work |
| **Honest about complexity** | Feature flags surface advanced flows; defaults work without PingOne setup for basic demos |

---

## 20-Minute Demo Checklist

For a tight presales demo, cover these five things in order:

1. **Login (2 min)** — Log in via PingOne. Open Token Chain → show `access_token`, `id_token`, scopes. *"The browser never sees a token — only a session cookie."*

2. **AI Agent + Token Exchange (5 min)** — Ask *"What's my balance?"* → Token Chain shows the exchange request + narrow MCP token. *"PingOne just issued a token scoped only to the MCP server — on demand, per call."*

3. **High-Value Transfer + Step-Up (5 min)** — Ask *"Transfer $600 to Savings."* → CIBA challenge fires → email OTP → transaction completes. *"The AI agent couldn't move that money without the user approving on a second channel."*

4. **Agent Flow Diagram (3 min)** — Click the flow diagram icon. Walk through each step — PKCE login, exchange, PAZ gate, MCP tool call, result. *"Every hop is authorised. The agent can't skip any step."*

5. **Education Panel (2 min)** — Click the RFC 8693 panel. Show the spec text next to the live token. *"This isn't a demo of what PingOne could do — every RFC reference here is live right now."*

6. **Config depth (3 min)** — Show Admin → Config: toggle 2-exchange, change LLM provider, enable PAR, switch vertical. *"One config file — no code changes."*

---

## Deployment Options

| Option | Session store | Setup |
|--------|--------------|-------|
| **Local dev** | LMDB / in-memory | `npm start` in each package |
| **Vercel** | Upstash Redis (required) | `docs/user-guide/deployment.md` |
| **Docker / K8s** | Redis | Available today — `docker-compose.yml` + `k8s/` |

---

## Related Documents

| Document | Purpose |
|----------|---------|
| [`docs/RFC-STANDARDS.md`](../RFC-STANDARDS.md) | Full RFC compliance matrix + per-RFC implementation detail |
| [`docs/ARCHITECTURE_WALKTHROUGH.md`](../ARCHITECTURE_WALKTHROUGH.md) | Deep technical walkthrough of all three auth flows |
| [`docs/SETUP.md`](SETUP.md) | Local + PingOne setup guide |
| [`docs/user-guide/deployment.md`](deployment.md) | Deployment guide (Vercel, Docker, Kubernetes) |
| [`docs/PINGONE_MAY_ACT_ONE_TOKEN_EXCHANGE.md`](../PINGONE_MAY_ACT_ONE_TOKEN_EXCHANGE.md) | PingOne setup for 1-exchange path |
| [`docs/PINGONE_MAY_ACT_TWO_TOKEN_EXCHANGES.md`](../PINGONE_MAY_ACT_TWO_TOKEN_EXCHANGES.md) | PingOne setup for 2-exchange path |
| [`docs/POSTMAN-GUIDE.md`](POSTMAN-GUIDE.md) | Postman collection guide |
