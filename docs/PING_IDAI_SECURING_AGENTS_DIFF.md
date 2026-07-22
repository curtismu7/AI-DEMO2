# Differences vs Ping IDAI docs

Gap report: Super Banking demo (`main` @ `fd5c0b99`) vs [Securing AI agents with PingOne (delegation + least privilege)](https://developer.pingidentity.com/identity-for-ai/use-cases/idai-securing-agents-pingone.html).

Focus is what diverges — not a full feature inventory.

## Executive summary

We implement the same security story (NHI agent, `may_act`/`act`, token exchange, PingGateway in front of MCP) but with a BFF-centric multi-hop design.

**Largest remaining gaps vs the page:**

1. Demo flags that can simulate delegation / authorize (D6)

**Closed:** Login-time Agent Consent Agreement Prompt (D1) — provision via bootstrap or `node scripts/ensureAgentConsentAgreement.js`.

**Ahead of the doc:** PingOne Authorize on the gateway, and per-action HITL / CIBA / step-up.

| Kind | Count |
|------|------:|
| Gaps vs doc | 1 |
| Closed | 1 |
| Different shape | 2 |
| Intentional | 2 |
| Ahead of doc | 2 |

---

## Difference register

| ID | Kind | Topic | Ping doc | Our app | Impact |
|----|------|-------|----------|---------|--------|
| D1 | Closed | Login-time Agent Consent (Agreement Prompt) | PingOne Agreement “Agent Consent” + authn policy Agent-Consent-Login with Agreement Prompt before delegated tokens. | Provisioned: Agreement HTML from `AgentConsentModal` legacy copy (`config/agentConsentAgreement.js`); policy `Agent-Consent-Login` (LOGIN + AGREEMENT) assigned to User app; AGREEMENT also appended to any other assigned SOPs. HITL / CIBA / OTP unchanged. | Login-time ToS now matches IDAI; runtime HITL remains for high-risk actions. |
| D2 | Intentional | PingOne AI Agents product registration | Register under Applications → AI Agents; CC + refresh + token exchange; agent + test scopes. | Demo AI Agent is a standard OIDC WEB_APP (`d21c5124`) with AC + CC + TE. Documented as intentional (admin UX differs; OAuth capabilities match). Separate MCP Gateway actor (`3fc5ec99`) for hop 2. | No action required for security parity; see `PINGONE_APP_CONFIG.md` §5. |
| D3 | Different | Who performs token exchange | Sample MCP agent process opens browser, then exchanges actor + subject tokens itself. | BFF is sole token custodian. Two-hop TE: BFF (user → mcpgateway) then PingGateway (→ mcpserver). LLM never holds user tokens. | Stricter custody than the tutorial sample; demos must use BFF/gateway path, not agent-local TE. |
| D4 | Intentional | `McpProtectionFilter` / JWKS validation shape | Single `mcp.json` route: `OAuth2ResourceServerFilter` + `McpProtectionFilter` + `McpValidationFilter` + `McpAuditFilter`. | Audit + Validation on all 7. `McpProtectionFilter` on all 4 introspection routes (OLB, apikey, invest, weather — #722). JWKS variants keep educational `jwks-token-validation.groovy` (no native RS filter) but emit RFC 9728 `resource_metadata` on 401 (#723). | Introspection paths match tutorial filter chain; JWKS path is an intentional educational tradeoff (local verify, no revocation) with cosmetic RFC 9728 parity. Native JWKS `OAuth2ResourceServerFilter` wrap remains optional. |
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

### D1 · Closed — Login-time Agent Consent (Agreement Prompt)

- **Ping:** PingOne Agreement “Agent Consent” + authn policy Agent-Consent-Login with Agreement Prompt before delegated tokens.
- **Ours:** Agreement text from `demo_api_server/config/agentConsentAgreement.js` (mirrors `AgentConsentModal` “Allow AI Agent Access”). Provisioned in `pingoneProvisionService.ensureAgentConsentLoginForApp` (bootstrap step `agent-consent`) and `scripts/ensureAgentConsentAgreement.js`. HITL / CIBA / OTP remain for high-risk tools.
- **Impact:** Login-time ToS matches IDAI; runtime human approval unchanged.
- **Evidence:** `config/agentConsentAgreement.js`; `pingoneProvisionService.js`; regression T4

### D2 · Intentional — PingOne AI Agents product registration (documented)

- **Ping:** Register under Applications → AI Agents; CC + refresh + token exchange; agent + test scopes.
- **Ours:** Demo AI Agent is a standard OIDC WEB_APP (`d21c5124`) with AC + CC + TE. Separate MCP Gateway actor (`3fc5ec99`) for hop 2.
- **Decision:** Keep WEB_APP. Product UI packaging differs; OAuth grants needed for TE are equivalent. Documented in `docs/PINGONE_APP_CONFIG.md` §5.
- **Evidence:** `AUTHORIZATION_RULES.md` §1; `PINGONE_APP_CONFIG.md` §5

### D3 · Different — Who performs token exchange

- **Ping:** Sample MCP agent process opens browser, then exchanges actor + subject tokens itself.
- **Ours:** BFF is sole token custodian. Two-hop TE: BFF (user → mcpgateway) then PingGateway (→ mcpserver). LLM never holds user tokens.
- **Impact:** Stricter custody than the tutorial sample; demos must use BFF/gateway path, not agent-local TE.
- **Evidence:** `AUTHORIZATION_RULES.md` §6; `rfc8693TokenExchangeService.js`; `olb-token-exchange.groovy`

### D4 · Intentional — McpProtectionFilter + JWKS educational path

- **Ping:** Single `mcp.json` route with full MCP filter chain.
- **Ours:** `McpAuditFilter` + `McpValidationFilter` on all 7 MCP routes; `McpProtectionFilter` on all 4 introspection routes (OLB / apikey / invest / weather). JWKS variants keep `jwks-token-validation.groovy` (dual RS256/HS256, no revocation) and add RFC 9728 `resource_metadata` on 401 without wrapping native `OAuth2ResourceServerFilter`.
- **Decision:** Keep the educational JWKS script. Replacing it with a JWKS-capable native RS filter would unlock a full `McpProtectionFilter` wrap but loses the dual-alg teaching path and adds design work — leave optional.
- **Evidence:** #720 plan; #722; #723; `01-mcp-olb.json`; `jwks-token-validation.groovy`

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

1. ~~Wire `McpProtectionFilter` on apikey / invest / weather~~ — done (#722).
2. ~~JWKS routes: keep educational script; add RFC 9728 `resource_metadata` on 401s~~ — done (#723). Native `OAuth2ResourceServerFilter` + `McpProtectionFilter` wrap remains optional (not required for parity).
3. Optional: PingOne Agreement + Agent-Consent-Login on Demo AI Agent for tutorial-literal demos.
4. ~~IDAI-faithful demo mode~~ — docs + Quick Flags preset (#724); see `IDAI_FAITHFUL_DEMO_MODE.md`.
5. ~~Document WEB_APP as intentional vs AI Agents product UI~~ — done (`PINGONE_APP_CONFIG.md` §5). Re-register under AI Agents only if a demo needs that console on camera.

---

## Sources

- [Securing AI agents with PingOne](https://developer.pingidentity.com/identity-for-ai/use-cases/idai-securing-agents-pingone.html)
- `docs/AUTHORIZATION_RULES.md`
- `docs/PINGONE_APP_CONFIG.md`
- `docs/superpowers/plans/2026-07-22-mcp-protection-filter-gap.md`
- `ping-gateway/config/routes/*.json`
- Repo tip when written: `fd5c0b99`
