# Differences vs Ping IDAI docs

Gap report: Super Banking demo (`main` @ `fd5c0b99`) vs [Securing AI agents with PingOne (delegation + least privilege)](https://developer.pingidentity.com/identity-for-ai/use-cases/idai-securing-agents-pingone.html).

Focus is what diverges — not a full feature inventory.

## Executive summary

We implement the same security story (NHI agent, `may_act`/`act`, token exchange, PingGateway in front of MCP) but with a BFF-centric multi-hop design.

**Largest literal gaps vs the page:**

1. No PingOne Agreement Prompt at login
2. `McpProtectionFilter` only on the OLB primary route (1 of 7)
3. Demo flags that can simulate delegation / authorize

**Ahead of the doc:** PingOne Authorize on the gateway, and per-action HITL / CIBA / step-up.

| Kind | Count |
|------|------:|
| Gaps vs doc | 2 |
| Different shape | 2 |
| Partial match | 2 |
| Ahead of doc | 2 |

---

## Difference register

| ID | Kind | Topic | Ping doc | Our app | Impact |
|----|------|-------|----------|---------|--------|
| D1 | Gap | Login-time Agent Consent (Agreement Prompt) | PingOne Agreement “Agent Consent” + authn policy Agent-Consent-Login with Agreement Prompt before delegated tokens. | Login-time agent consent gate removed. Consent is `may_act` user attribute + Authorize agent UI, plus per-tool HITL / CIBA / OTP. | Page-literal HITL-at-sign-on is missing; runtime HITL is stronger for high-risk tools but not the same control. |
| D2 | Partial | PingOne AI Agents product registration | Register under Applications → AI Agents; CC + refresh + token exchange; agent + test scopes. | Demo AI Agent is a standard OIDC WEB_APP (`d21c5124`) with AC + CC + TE. Separate MCP Gateway actor (`3fc5ec99`) for hop 2. | Same OAuth capabilities; different admin UX / product packaging. |
| D3 | Different | Who performs token exchange | Sample MCP agent process opens browser, then exchanges actor + subject tokens itself. | BFF is sole token custodian. Two-hop TE: BFF (user → mcpgateway) then PingGateway (→ mcpserver). LLM never holds user tokens. | Stricter custody than the tutorial sample; demos must use BFF/gateway path, not agent-local TE. |
| D4 | Partial | `McpProtectionFilter` coverage vs tutorial route | Single `mcp.json` route: `OAuth2ResourceServerFilter` + `McpProtectionFilter` + `McpValidationFilter` + `McpAuditFilter`. | Audit + Validation on all 7 MCP routes. `McpProtectionFilter` only on `01-mcp-olb` (1 of 7). Invest/weather/apikey use bare RS filter; JWKS routes use custom script. | Primary OLB path matches doc; other routes miss RFC 9728 `resource_metadata` wrapping. Documented in #720 plan. |
| D5 | Different | Resource / scope naming | Custom resources named `agent` + `test`; scopes `agent` / `test`; aud `https://ig.example.com:8443/mcp`. | `enduser` / `agentgateway` / `mcpgateway` / `mcpserver` audiences; `banking:*` and `gateway:mcp:invoke` scopes. | Same pattern (agent resource + backend resource + `may_act`→`act`); different names and multi-hop audiences. |
| D6 | Gap | Demo weakeners vs tutorial purity | Cloud PingOne + PingGateway only; no inject/simulate shortcuts. | `ff_inject_may_act`, `ff_authorize_simulated`, Demo Agent Gateway can bypass or fake pieces of the IDAI path. | Lean/real flags (PingGateway + live P1AZ) are required for doc-faithful demos. |
| D7 | Exceeds | Fine-grained authz (doc “What’s next”) | Suggests adding PingOne Authorize with contextual signals after the basic TE+IG path. | Already on gateway: `p1az-decision.groovy`, RAR attrs, intent-token binding, live policy console, optional group deny. | Ahead of the tutorial; not a deficit. |
| D8 | Exceeds | Per-action HITL / CIBA / step-up | Consent mainly via Agreement Prompt at agent login. | 428 HITL, OTP/passkey step-up, CIBA OOB popup for sensitive tools/transfers. | Richer runtime human approval than the tutorial. |

---

## Flow shape (why TE looks different)

### Ping tutorial

```
Sample agent → browser login + Agreement → agent TE → PingGateway /mcp → MCP
```

### Our demo

```
User in banking UI → BFF holds T1 → TE#1 (mcpgateway) → PingGateway (protect / P1AZ / TE#2) → MCP
```

---

## Detail: gaps, partials, and different shapes

### D1 · Gap — Login-time Agent Consent (Agreement Prompt)

- **Ping:** PingOne Agreement “Agent Consent” + authn policy Agent-Consent-Login with Agreement Prompt before delegated tokens.
- **Ours:** Login-time agent consent gate removed. Consent is `may_act` user attribute + Authorize agent UI, plus per-tool HITL / CIBA / OTP.
- **Impact:** Page-literal HITL-at-sign-on is missing; runtime HITL is stronger for high-risk tools but not the same control.
- **Evidence:** REGRESSION archive (consent gate removed); HITL consent flows; `/delegation`

### D2 · Partial — PingOne AI Agents product registration

- **Ping:** Register under Applications → AI Agents; CC + refresh + token exchange; agent + test scopes.
- **Ours:** Demo AI Agent is a standard OIDC WEB_APP (`d21c5124`) with AC + CC + TE. Separate MCP Gateway actor (`3fc5ec99`) for hop 2.
- **Impact:** Same OAuth capabilities; different admin UX / product packaging.
- **Evidence:** `docs/AUTHORIZATION_RULES.md` §1

### D3 · Different — Who performs token exchange

- **Ping:** Sample MCP agent process opens browser, then exchanges actor + subject tokens itself.
- **Ours:** BFF is sole token custodian. Two-hop TE: BFF (user → mcpgateway) then PingGateway (→ mcpserver). LLM never holds user tokens.
- **Impact:** Stricter custody than the tutorial sample; demos must use BFF/gateway path, not agent-local TE.
- **Evidence:** `AUTHORIZATION_RULES.md` §6; `rfc8693TokenExchangeService.js`; `olb-token-exchange.groovy`

### D4 · Partial — McpProtectionFilter coverage

- **Ping:** Single `mcp.json` route with full MCP filter chain.
- **Ours:** `McpAuditFilter` + `McpValidationFilter` on all 7 MCP routes; `McpProtectionFilter` only on `01-mcp-olb`.
- **Impact:** Primary OLB path matches doc; other routes miss RFC 9728 wrapping.
- **Evidence:** `docs/superpowers/plans/2026-07-22-mcp-protection-filter-gap.md`; `01-mcp-olb.json`

### D5 · Different — Resource / scope naming

- **Ping:** `agent` / `test` resources and scopes.
- **Ours:** Multi-audience topology (`enduser`, `agentgateway`, `mcpgateway`, `mcpserver`) and banking scopes.
- **Impact:** Same delegation pattern; different names and hop count.
- **Evidence:** `AUTHORIZATION_RULES.md` §2–§6; `scope-topology.json`

### D6 · Gap — Demo weakeners

- **Ping:** Cloud PingOne + PingGateway only.
- **Ours:** `ff_inject_may_act`, `ff_authorize_simulated`, Demo Agent Gateway can bypass or fake pieces of the IDAI path.
- **Impact:** Lean/real flags required for doc-faithful demos.
- **Evidence:** `AUTHORIZATION_RULES.md` feature flags; Quick Flags

### D7 · Exceeds — Fine-grained authz

- Doc “What’s next” is already implemented (P1AZ on gateway, RAR, intent binding, live policy console).

### D8 · Exceeds — Per-action HITL / CIBA / step-up

- Richer runtime human approval than Agreement Prompt alone.

---

## Still aligned (not differences)

| Capability | Note |
|------------|------|
| Banking chatbot on behalf of user | Embedded AI agent in Super Banking UI; PingOne tokens; MCP tools behind Agent Gateway. |
| `may_act` → `act` chain of delegation | SpEL `may_act` on Demo API / MCP resources pointing at Demo AI Agent; exchanged tokens carry `act.sub`; `requireDelegation` enforces `act`. |
| RFC 8693 token exchange | Implemented (two-hop). Actor + subject → downscoped audience tokens. |
| PingGateway streaming + MCP audit/validation | `admin.json` `streamingEnabled: true`; `McpAuditFilter` + `McpValidationFilter` on all MCP routes. |
| Least-privilege tool access | Scopes + MCP first-tool gate + intent binding (stronger than tutorial’s single `test` scope). |

---

## Recommended closes (if aiming for page parity)

1. Wire `McpProtectionFilter` on apikey / invest / weather routes (mechanical; see #720 plan).
2. Decide JWKS routes: native `OAuth2ResourceServerFilter` vs keep educational JWKS script.
3. Optional: PingOne Agreement + Agent-Consent-Login on Demo AI Agent for tutorial-literal demos.
4. Demo mode: document that `ff_inject_may_act` / simulated authorize / Demo Agent Gateway are off for IDAI-faithful runs.
5. Optional: register agent via PingOne AI Agents UI (or document WEB_APP as intentional).

---

## Sources

- [Securing AI agents with PingOne](https://developer.pingidentity.com/identity-for-ai/use-cases/idai-securing-agents-pingone.html)
- `docs/AUTHORIZATION_RULES.md`
- `docs/PINGONE_APP_CONFIG.md`
- `docs/superpowers/plans/2026-07-22-mcp-protection-filter-gap.md`
- `ping-gateway/config/routes/*.json`
- Repo tip when written: `fd5c0b99`
