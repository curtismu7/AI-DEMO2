# Differences vs Ping IDAI docs

Gap report: Super Banking demo vs [Securing AI agents with PingOne (delegation + least privilege)](https://developer.pingidentity.com/identity-for-ai/use-cases/idai-securing-agents-pingone.html).

Focus is what diverges — not a full feature inventory.

## Executive summary

We implement the same security story (NHI agent, `may_act`/`act`, token exchange, PingGateway in front of MCP) but with a BFF-centric multi-hop design.

**Literal gaps vs the page are closed** for Agreement Prompt (D1) and demo-mode purity (D6 via IDAI-faithful preset). Remaining rows are intentional product packaging, different TE custody shape, or ahead of the tutorial (Authorize, HITL/CIBA).

| Kind | Count |
|------|------:|
| Gaps vs doc | 0 |
| Different shape | 2 |
| Intentional | 2 |
| Ahead of doc | 2 |
| Closed | 2 |

---

## Difference register

| ID | Kind | Topic | Ping doc | Our app | Impact |
|----|------|-------|----------|---------|--------|
| D1 | Closed | Login-time Agent Consent (Agreement Prompt) | PingOne Agreement “Agent Consent” + authn policy Agent-Consent-Login with Agreement Prompt before delegated tokens. | Provisioned: Agreement + `Agent-Consent-Login` assigned to Super Banking User App (bootstrap + `scripts/ensureAgentConsentAgreement.js`). Copy mirrors AgentConsentModal; **HITL / CIBA / OTP kept** for high-risk tools. | Page-literal login ToS restored; runtime HITL remains stronger for transfers. |
| D2 | Intentional | PingOne AI Agents product registration | Register under Applications → AI Agents; CC + refresh + token exchange; agent + test scopes. | Demo AI Agent is a standard OIDC WEB_APP with AC + CC + TE. Documented as intentional (admin UX differs; OAuth capabilities match). Separate MCP Gateway actor for hop 2. | No action required for security parity; see `PINGONE_APP_CONFIG.md` §5. |
| D3 | Different | Who performs token exchange | Sample MCP agent process opens browser, then exchanges actor + subject tokens itself. | BFF is sole token custodian. Two-hop TE: BFF (user → mcpgateway) then PingGateway (→ mcpserver). LLM never holds user tokens. | Stricter custody than the tutorial sample; demos must use BFF/gateway path, not agent-local TE. |
| D4 | Intentional | `McpProtectionFilter` / JWKS validation shape | Single `mcp.json` route: `OAuth2ResourceServerFilter` + `McpProtectionFilter` + `McpValidationFilter` + `McpAuditFilter`. | Audit + Validation on all 7. `McpProtectionFilter` on all 4 introspection routes. JWKS variants keep educational `jwks-token-validation.groovy` but emit RFC 9728 `resource_metadata` on 401. | Introspection paths match tutorial filter chain; JWKS path is an intentional educational tradeoff. |
| D5 | Different | Resource / scope naming | Custom resources named `agent` + `test`; scopes `agent` / `test`; aud `https://ig.example.com:8443/mcp`. | `enduser` / `agentgateway` / `mcpgateway` / `mcpserver` audiences; `banking:*` and `gateway:mcp:invoke` scopes. | Same pattern (agent resource + backend resource + `may_act`→`act`); different names and multi-hop audiences. |
| D6 | Closed | Demo weakeners vs tutorial purity | Cloud PingOne + PingGateway only; no inject/simulate shortcuts. | **IDAI-faithful preset** (`IDAI_FAITHFUL_DEMO_MODE.md` / Quick Flags): Ping GW ON, simulated Authorize OFF, JWKS OFF. `ff_inject_may_act` removed from code. | Use the preset for doc-faithful demos; lean/real flags remain available for teaching. |
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

Login still hits PingOne Agreement Prompt (User App + Agent-Consent-Login) before the session/BFF path can mint delegated tokens.

---

## Detail: gaps, partials, and different shapes

### D1 · Closed — Login-time Agent Consent (Agreement Prompt)

- **Ping:** PingOne Agreement “Agent Consent” + authn policy Agent-Consent-Login with Agreement Prompt before delegated tokens.
- **Ours:** `_ensureAgentConsentAgreement` / `ensureAgentConsentLoginForApp` in `pingoneProvisionService.js`; bootstrap step `agent-consent`; CLI `demo_api_server/scripts/ensureAgentConsentAgreement.js`. Copy from `config/agentConsentAgreement.js` (AgentConsentModal). Does **not** replace Phase 170 HITL.
- **Evidence:** provision service; regression T4; live ensure script

### D2 · Intentional — PingOne AI Agents product registration (documented)

- **Ping:** Register under Applications → AI Agents; CC + refresh + token exchange; agent + test scopes.
- **Ours:** Demo AI Agent is a standard OIDC WEB_APP with AC + CC + TE. Separate MCP Gateway actor for hop 2.
- **Decision:** Keep WEB_APP. Product UI packaging differs; OAuth grants needed for TE are equivalent. Documented in `docs/PINGONE_APP_CONFIG.md` §5.
- **Evidence:** `AUTHORIZATION_RULES.md` §1; `PINGONE_APP_CONFIG.md` §5

### D3 · Different — Who performs token exchange

- **Ping:** Sample MCP agent process opens browser, then exchanges actor + subject tokens itself.
- **Ours:** BFF is sole token custodian. Two-hop TE: BFF (user → mcpgateway) then PingGateway (→ mcpserver). LLM never holds user tokens.
- **Impact:** Stricter custody than the tutorial sample; demos must use BFF/gateway path, not agent-local TE.
- **Evidence:** `AUTHORIZATION_RULES.md` §6; `rfc8693TokenExchangeService.js`; `olb-token-exchange.groovy`

### D4 · Intentional — McpProtectionFilter + JWKS educational path

- **Ping:** Single `mcp.json` route with full MCP filter chain.
- **Ours:** `McpAuditFilter` + `McpValidationFilter` on all MCP routes; `McpProtectionFilter` on introspection routes. JWKS variants keep educational script + RFC 9728 `resource_metadata` on 401.
- **Decision:** Keep the educational JWKS script. Native JWKS RS filter wrap remains optional.
- **Evidence:** #722; #723; `01-mcp-olb.json`; `jwks-token-validation.groovy`

### D5 · Different — Resource / scope naming

- **Ping:** `agent` / `test` resources and scopes.
- **Ours:** Multi-audience topology (`enduser`, `agentgateway`, `mcpgateway`, `mcpserver`) and banking scopes.
- **Impact:** Same delegation pattern; different names and hop count.
- **Evidence:** `AUTHORIZATION_RULES.md` §2–§6; `scope-topology.json`

### D6 · Closed — Demo weakeners

- **Ping:** Cloud PingOne + PingGateway only.
- **Ours:** Use **Apply IDAI-faithful preset** in Quick Flags (Ping GW + Real P1AZ + Introspect). See `IDAI_FAITHFUL_DEMO_MODE.md`.
- **Evidence:** `QuickFlagsPill.js` `IDAI_FAITHFUL_PRESET`; feature flags registry

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
| Login Agreement Prompt | Agent Consent + Agent-Consent-Login on User App (alongside HITL). |

---

## Recommended closes (if aiming for page parity)

1. ~~Wire `McpProtectionFilter` on apikey / invest / weather~~ — done (#722).
2. ~~JWKS routes: keep educational script; add RFC 9728 `resource_metadata` on 401s~~ — done (#723).
3. ~~PingOne Agreement + Agent-Consent-Login on User App~~ — done (provision + ensure script; keep HITL).
4. ~~IDAI-faithful demo mode~~ — docs + Quick Flags preset; see `IDAI_FAITHFUL_DEMO_MODE.md`.
5. ~~Document WEB_APP as intentional vs AI Agents product UI~~ — done (`PINGONE_APP_CONFIG.md` §5).

---

## Sources

- [Securing AI agents with PingOne](https://developer.pingidentity.com/identity-for-ai/use-cases/idai-securing-agents-pingone.html)
- `docs/AUTHORIZATION_RULES.md`
- `docs/PINGONE_APP_CONFIG.md`
- `docs/IDAI_FAITHFUL_DEMO_MODE.md`
- `docs/superpowers/plans/2026-07-22-mcp-protection-filter-gap.md`
- `ping-gateway/config/routes/*.json`
