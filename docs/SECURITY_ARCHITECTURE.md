# Security & Token Architecture

Companion to [ARCHITECTURE.md](ARCHITECTURE.md) and [SERVICE_TOPOLOGY.md](SERVICE_TOPOLOGY.md). This document is the **security story**: how a user logs in, how an AI agent is delegated authority on the user's behalf, how each action is authorized, when a human must approve, and how scopes are enforced at every hop.

**Related (Logseq):** [[ARCHITECTURE]] · [[SERVICE_TOPOLOGY]]

The central claim the demo makes: **an AI agent should act *as* a user without ever *becoming* the user, and every action it takes should be independently authorizable and auditable.**

---

## 1. Trust boundaries

```
┌── untrusted ──┐  ┌──────── server-side (token custody) ───────┐  ┌─ external ─┐
   Browser/SPA       BFF        MCP Gateway      MCP servers         PingOne
   cookie only   ►   tokens  ►  authz+exchange ► introspect+scope ◄─ OAuth/Authorize
```

- **Browser ↔ BFF** — cookies only. No access/ID token ever reaches JavaScript (BFF pattern). Eliminates XSS token theft.
- **BFF ↔ internal services** — private network + shared internal secrets (`BFF_INTERNAL_SECRET`, `X-HITL-Internal-Secret`) and/or scoped bearer tokens.
- **System ↔ PingOne** — all token minting, introspection, and (optionally) policy decisions happen at PingOne; the mock `demo_authz_server` substitutes offline.

---

## 2. Step 1 — User login (Authorization Code + PKCE, BFF session)

Files: `demo_api_server/routes/oauth.js`, `middleware/auth.js`, `services/sessionCookies.js`, `pkceStateCookie.js`, `authStateCookie.js`.

```
SPA → BFF /api/auth/oauth/login
   BFF generates code_verifier + state + nonce (stored in session)
   → redirect to PingOne /authorize?...&code_challenge=S256(...)
PingOne → BFF /api/auth/oauth/callback?code&state
   BFF validates state, exchanges code+verifier for tokens
   tokens (access + id) stored in req.session — SERVER SIDE
   session fixation mitigated (new session id post-login)
   → browser receives cookies only
```

What the browser holds afterward: a session cookie (`connect.sid`, httpOnly/secure/sameSite) plus signed identity/PKCE helper cookies. **No token.** Tokens are refreshed server-side and revoked on logout.

The BFF distinguishes a **user** session from an **AI agent** identity by scope/audience, which drives whether the delegation chain (next section) is engaged.

---

## 3. Step 2 — Delegation to the agent (RFC 8693 token exchange)

This is the heart of the design. When an agent needs to call a tool, the BFF performs exactly **one** RFC 8693 token exchange.

### The exchange — user + agent → gateway-audience token (at the BFF)

Files: `demo_api_server/services/agentMcpTokenService.js`, `demo_api_server/services/rfc8693TokenExchangeService.js`. Agent identity: `demo_agent_service/src/agentIdentity.ts`.

```
POST {pingone}/token
  grant_type     = urn:ietf:params:oauth:grant-type:token-exchange
  subject_token  = <user access token>          (the user — aud=BFF)
  actor_token    = <agent client-credentials token>  (the agent)
  audience       = mcp-gateway resource uri
→ delegated token:  sub = user,  aud = mcp-gateway,  act = { sub: <agent client id> }
```

The result carries an **`act` claim** naming the agent. From here on, every component can see *"user X, acted for by agent Y."*

The agent obtains its actor token two ways:
- **Mode A (default):** `client_credentials` with `client_secret_basic` (`AGENT_CLIENT_ID` / `AGENT_CLIENT_SECRET`).
- **Mode B (PKI):** `private_key_jwt` (RS256, ~300s) when `USE_PKI_AGENT_CREDS=true`.

Actor tokens are cached (with a refresh margin) and a cold-start lock prevents a stampede of concurrent client-credentials grants.

### Gateway forwarding (not a second BFF exchange)

The MCP gateway forwards the BFF-issued token **unchanged** to the backend MCP server — it does not perform a second RFC 8693 exchange or re-audience the token. The gateway validates the inbound token and routes it downstream as-is (see `demo_mcp_gateway/src/auth/authorizeMcpRequest.ts` lines 435–438). `McpTokenExchangeClient.ts` may be present for gateway-internal use but is not a second leg of a BFF-designed exchange chain.

### `act` vs `may_act`

- **`act`** — *who is acting now* (the agent). Embedded by PingOne policy during the BFF token exchange.
- **`may_act`** — *who is permitted to act* for a principal. Lives on the user/principal record in PingOne and is expressed via a SPEL-style expression (`${user.mayAct}`). It is the policy precondition that allows the exchange to succeed.

> Implementation note (from project memory): `may_act` belongs on the **user** record, and `#{...}` SpEL is emitted literally in resource attributes — a known PingOne SpEL limitation (not an intentional design choice). Use `${user.mayAct}` for the user-attribute form.

---

## 4. Step 3 — Authorization (PERMIT / DENY / STEP-UP / HITL)

Every agent tool call is run past a policy decision. Two implementations exist behind one interface:

| Implementation | File | Used when |
|---|---|---|
| **PingOne Authorize** (live) | `demo_api_server/services/pingOneAuthorizeService.js`, gateway `pingAuthorizeGuard.ts` + `PingOneAuthorizeClient.ts` | production / connected |
| **Simulated Authorize** (education) | `demo_api_server/services/simulatedAuthorizeService.js` | `ff_authorize_real = false` |

The `ff_authorize_real` feature flag (admin-toggleable) swaps the live policy engine for a deterministic local one so the demo runs offline and the decision logic is inspectable. The mock `demo_authz_server` (:9001) provides the same for the gateway's introspection + decision endpoints — and **must stay in parity** with the real PingOne request/response shape (see the `authz-server-parity` skill).

### Decisions

| Decision | Effect |
|---|---|
| **PERMIT** | Proceed (to token exchange / resource). |
| **DENY** | Block immediately (403). |
| **STEP_UP** | Require additional MFA before proceeding. |
| **HITL / INDETERMINATE** | Require human approval — raise a challenge (see §5). The BFF's pre-gateway gate (`evaluateMcpFirstToolGate`) returns **HTTP 428**; the gateway's runtime enforcement returns **HTTP 403** `{error:'hitl_required', hitl:true, challengeId}` (HTTP path) or JSON-RPC **`-32002`** (WebSocket path). |

### Obligation classification

File: `demo_api_server/services/authorizeObligations.js`. Two rules keep behavior sane:

1. **Most-specific-first:** `HITL_CONSENT` is classified as *consent*, not generic *hitl*; `STEP_UP`/`STEPUP` → step-up; `HUMAN_APPROVAL` → hitl.
2. **Highest-gate-wins:** at most one gate fires per request — `stepUp > consent > hitl` — so a single call is never double-gated.

### Simulated policy (defaults)

- **DENY** if amount > deny threshold (default ~$2000).
- **STEP_UP** if amount ≥ step-up threshold (default ~$500) on write tools.
- **HITL consent** if the transaction type is in the consent list (default: `transfer`).
- Otherwise **PERMIT**.

Thresholds and type lists are configurable via the config store / env (`SIMULATED_AUTHORIZE_DENY_AMOUNT`, `…_STEPUP_AMOUNT`, `…_CONFIRM_AMOUNT`, `…_CONSENT_TYPES`, `…_STEPUP_TYPES`, plus `SIMULATED_MCP_DENY_TOOLS` / `…_HITL_TOOLS`).

---

## 5. Step 4 — Human-in-the-loop consent

Files: `demo_hitl_service/src/index.js` + `routes/challenges.js` + `store/challengeStore.js`; clients `demo_mcp_gateway/src/hitlClient.ts` and `demo_api_server/services/hitlServiceClient.js`.

```
Gateway gets HITL obligation
  → POST /challenges            {tool, userId, agentId, context}
                                 ← {challengeId, status: pending, expiresAt}
  → caller gets 428 + challengeId
Human approves in UI
  → POST /challenges/:id/respond  (approve | deny)
Agent/BFF retries with the challenge id
Gateway verifies receipt:
  status == approved  AND  not expired  AND  userId+agentId+tool match
  → proceed   (else re-challenge or DENY)
```

**Anti-replay binding:** a receipt is only valid for the exact `userId + agentId + tool` tuple that requested it, and an **expired-but-approved** receipt is never honored. Challenges have a short TTL (≈5 min). HITL endpoints are protected by an internal secret.

The same machinery backs interactive transaction consent (e.g. the agent consent modal): a transfer over the confirm threshold returns a consent challenge, the user confirms (optionally with OTP), and only a verified, single-use receipt unlocks execution.

---

## 6. Step 5 — Enforcement at the resource (defense in depth)

The MCP servers do **not** trust the gateway blindly. Each independently:

- **Validates the token** — RFC 7662 introspection against PingOne (`demo_mcp_server`'s `BankingAuthenticationManager`), or local JWT/JWKS validation; the BFF supports both modes via `VALIDATION_MODE` (`introspection` default, or `jwt`). Introspection results are cached with a TTL.
- **Checks the audience** — the token `aud` must match that server's resource URI (e.g. `demo_mcp_resource_server` rejects tokens not audienced for it).
- **Enforces scopes** — the tool's required scopes must be a subset of the token's scopes.

The gateway forwards the BFF-issued token (already audienced to the gateway) to the backend. Each backend independently validates the audience claim, so a token issued for the gateway cannot be replayed directly against a different backend resource URI.

---

## 7. Scopes

Scopes are intentionally **plain** — `read`, `write`, `admin` — never domain-prefixed (no `banking:*`). Sources: `demo_api_server/config/scopes.js`, `scope-topology.json`, `demo_authz_server/scopeTopology.js`.

| Scope | Meaning |
|---|---|
| `read` | Read accounts / transactions / data |
| `write` | Mutating ops (transfer, deposit, withdraw) |
| `admin` | Administrative operations |
| `ai_agent` / agent scopes | Marks the AI agent identity / invocation permission |
| vertical reads (e.g. `mortgage:read`, `records:read`) | Vertical-specific resource reads |

**Enforcement points (layered):**

| Layer | What it checks |
|---|---|
| BFF (HTTP routes) | route → required-scope map |
| MCP Gateway | inbound `aud` + Authorize policy + tool→scope |
| MCP servers | introspection + `aud` + tool required-scopes |
| PingOne Authorize | dynamic, context-aware policy (amount, type, act) |

Coarse scopes (`read`/`write`) gate *access*; the fine-grained decision (this amount, this type, this actor, needs a human?) is made by **Authorize**, not by scopes alone. That separation is deliberate — it keeps token scopes stable while letting policy evolve.

---

## 8. The chain, end to end

```
User  ──login (PKCE)──►  BFF holds tokens (cookie to browser)
                          │
   Exchange (RFC 8693): subject=user, actor=agent, aud=gateway
                          │   → token carries act={agent}
                          ▼
                     MCP Gateway
                          │  introspect inbound (RFC 7662) + aud check
                          │  Authorize → PERMIT / DENY / STEP_UP / HITL
                          │     └─ HITL → 403/−32002 → human approves → verified receipt
                          │  forward original BFF-issued token unchanged
                          ▼
                     MCP server  ── introspect + aud + scope ──►  execute
```

Three independent checks (gateway authorize, gateway introspection, resource introspection+scope), one human gate when policy demands it, and an `act` claim that makes the agent's involvement auditable at every hop. That is the security model the demo exists to show.

---

## 9. Security Showcase — live attacks and the controls that stop them

The Security Showcase is a chip panel embedded in the agent UI (tabs: **Defenses / AI Reasoning / Attacks**). It is enabled in all five verticals (banking, healthcare, retail, sporting-goods, workforce). Six attacks are demonstrated live, each paired with the control that defeats it.

| # | Attack | ID | Defense |
| --- | --- | --- | --- |
| 1 | **Prompt injection** | `atk_prompt_injection` | Poisoned transaction text tries to redirect the agent. Stopped by the HITL consent gate + PingOne Authorize policy, which evaluate the **request** (tool + context), not the LLM's interpretation of the text. |
| 2 | **Indirect injection** | `atk_indirect_injection` | Malicious text hidden in account metadata. Same defense — the policy gate evaluates the action, not agent intent. |
| 3 | **Wrong audience** | `atk_wrong_aud` | A token minted for the BFF is fired directly at the gateway. Rejected at decision point D-05 because each hop validates that the `aud` was issued specifically for it. |
| 4 | **Scope escalation** | `atk_scope_escalation` | Attempt to call an admin-only tool with a user token. Refused `insufficient_scope` at **both** the gateway and the MCP server (dual enforcement). RFC 8693 exchange can only narrow scope, never add it. |
| 5 | **Confused deputy** | `atk_confused_deputy` | Forged actor chain (`rogue act.sub`). Fails the PingOne Authorize `HasValidActorChain` rule — delegation is bound to the registered AI Agent identity, not a `may_act` allowlist. |
| 6 | **HITL receipt-binding replay** | `atk_hitl_replay` | An approval receipt for one tool is replayed on a different tool. Each receipt is single-use and bound to the exact `userId + agentId + tool` tuple; replay triggers a fresh HTTP 428 challenge and is never honored. |

The Defense-tab chips also exercise: MFA step-up via OTP, MFA step-up via passkey (FIDO2/WebAuthn), HITL consent with a bound single-use receipt, a cross-vertical hard-DENY, and `insufficient_scope`.

---

## 10. Live Policy Console — inspecting Authorize decisions

The Live Policy Console (`/pingone-authorize`) is the primary inspection surface for PingOne Authorize in this demo. It renders the live policy tree (POLICY_SET → POLICY → RULE), a recent-decisions table, and an Evaluate tab with presets (Transaction / MCP First Tool / Custom) plus full request/response JSON. It is open to any authenticated user (previously admin-only) and warms the Authorize connection on boot and page load, eliminating the transient "Demo Authorize" badge after a restart. Use it to observe in real time which rule fired, what obligation it attached, and what context values drove the decision.

---

## 11. AI Control Plane — agent kill-switch and governance

The AI Control Plane (`/ai-control-plane`) provides cross-platform agent governance. Stopping an agent revokes its identity at PingOne, so its access dies everywhere at once — every connected platform — with no per-service call required. The kill is logged to the audit trail and broadcast over SSE. Governance scenarios demonstrated include group-deny, unauthorized-tool alert, and a Compliance Report view with CSV/JSON export.

---

## 12. Extended trust boundaries

### agent_token_service — Copilot Studio broker

`agent_token_service` (Node/TS, port 8097) is a standalone PingOne agent-token broker for Microsoft Copilot Studio. Its security posture:

- **Caller auth:** static `x-api-key` (no OAuth on the inbound edge).
- **Mints:** a PingOne `client_credentials` token for a dedicated `AI_AGENT` app (scope `agent:invoke`, audience `agentgateway.ping.demo`).
- **Secret custody:** the PingOne `client_secret` and API key are held server-side only; in Copilot Studio mode, user-token custody is platform-side.
- The service is not in docker-compose and must be run separately.

### PingGateway real→mock Authorize failover

PingGateway (Ping Identity IG, host port 3036) is the alternative MCP gateway selected by `ff_mcp_gateway_pinggateway` (default true). It performs its own RFC 8693 single-resource exchange and sends `UserId` + `McpResourceUri` in the `McpToolCall` Authorize params. It supports a live-switchable real→mock Authorize failover via the `X-Authz-Simulated` request header, letting a demo operator fall back to the simulated AS without restarting. The `authorize_mode` env/configStore key (`pingone` | `simulated` | `pingone-with-fallback`) is the engine selector used by both gateway paths; the Docker default is strict `pingone`.

---

## 13. Key files

| Concern | File |
|---|---|
| OAuth login + PKCE | `demo_api_server/routes/oauth.js`, `middleware/auth.js` |
| BFF session cookies | `demo_api_server/services/sessionCookies.js`, `pkceStateCookie.js`, `authStateCookie.js` |
| Introspection (BFF) | `demo_api_server/services/tokenIntrospectionService.js` |
| RFC 8693 exchange (BFF executor) | `demo_api_server/services/agentMcpTokenService.js` |
| RFC 8693 exchange (token logic) | `demo_api_server/services/rfc8693TokenExchangeService.js` |
| Agent actor token | `demo_agent_service/src/agentIdentity.ts` |
| Gateway token forwarding | `demo_mcp_gateway/src/auth/authorizeMcpRequest.ts` |
| Authorize (live / sim) | `demo_api_server/services/pingOneAuthorizeService.js`, `simulatedAuthorizeService.js` |
| Obligation classifier | `demo_api_server/services/authorizeObligations.js` |
| Gateway authorize guard | `demo_mcp_gateway/src/pingAuthorizeGuard.ts`, `auth/PingOneAuthorizeClient.ts` |
| HITL service / clients | `demo_hitl_service/src/`, `demo_mcp_gateway/src/hitlClient.ts`, `demo_api_server/services/hitlServiceClient.js` |
| MCP server auth | `demo_mcp_server/src/auth/BankingAuthenticationManager.ts` |
| Scopes | `demo_api_server/config/scopes.js`, `scope-topology.json` |
| Mock authz server | `demo_authz_server/index.js`, `scopeTopology.js` |
