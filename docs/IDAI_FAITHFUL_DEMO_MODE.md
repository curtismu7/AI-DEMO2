# IDAI-faithful demo mode

How to run Super Banking so it matches the security *shape* of Ping’s
[Securing AI agents with PingOne](https://developer.pingidentity.com/identity-for-ai/use-cases/idai-securing-agents-pingone.html)
page: real PingGateway as PEP, live PingOne Authorize, introspection (not local JWKS).

This is **operator guidance**, not a claim of page-literal parity. Known intentional
differences (BFF-held tokens, multi-hop TE, WEB_APP vs AI Agents product UI) and closed
items (login Agreement Prompt, faithful preset) are listed in
[`PING_IDAI_SECURING_AGENTS_DIFF.md`](./PING_IDAI_SECURING_AGENTS_DIFF.md).

## Flag recipe

| Flag | IDAI-faithful value | Quick Flags label | Why |
|------|---------------------|-------------------|-----|
| Real PingOne Agent Gateway | **ON** (`true`) | Agent Gateway → Real PingOne | Ping doc uses PingGateway in front of MCP; `false` is mock outage fallback |
| Simulated Authorize | **OFF** | Authorize Engine → Real P1AZ | Live PingOne Authorize, not the in-process mock |
| Token Validation JWKS | **OFF** | Token Validation → Introspect | Doc path introspects; JWKS is educational (no revocation) |

Leave other Quick Flags alone unless your scenario needs them (CIBA, tracing, etc.).

## Fast path (UI)

1. Sign in.
2. Open the **Quick Flags** pill in the top nav (shows `Introspect` or `🔐 JWKS`).
3. Click **Apply IDAI-faithful preset**.
4. Confirm the green status line: Real PingOne GW + Real P1AZ + Introspect.
5. If any target flag is **pinned** by Docker/env, the preset skips it and shows ⚠️ — change the env / compose pin instead.

## Manual path

Same three toggles in Quick Flags or Admin → Feature Flags:

1. Agent Gateway = **Real PingOne**
2. Authorize Engine = **Real P1AZ**
3. Token Validation = **Introspect**

## Verify before the demo

- [ ] PingGateway container healthy; MCP calls hit IG (not the mock Demo Agent Gateway).
- [ ] A tool call shows a real PingOne Authorize decision (decision id / live policy), not simulated-only education copy.
- [ ] No `X-Token-Validation: jwks` / `X-Token-Validation-Mode: jwks` on the happy path.
- [ ] Optional: no-token request to gateway returns `401` with `WWW-Authenticate` (introspect routes use `McpProtectionFilter`; JWKS educational routes add `resource_metadata` only).

## Login Agreement (separate from this preset)

Login-time **Agent Consent** + **Agent-Consent-Login** is provisioned on the User App
(bootstrap step `agent-consent`, or
`cd demo_api_server && node scripts/ensureAgentConsentAgreement.js`). That is
independent of Quick Flags. Per-tool HITL / CIBA / OTP still apply for high-risk actions.

## What this mode does *not* change

- Does **not** move token exchange into the agent process (BFF + gateway custody stays).
- Does **not** rename audiences to the tutorial’s `agent` / `test` scopes.
- Does **not** re-register Demo AI Agent under PingOne **AI Agents** product UI — `WEB_APP` is intentional (`PINGONE_APP_CONFIG.md` §5).
- Does **not** remove in-app HITL / CIBA / step-up (Agreement is login ToS only).

## Related

- Gap report: `docs/PING_IDAI_SECURING_AGENTS_DIFF.md`
- MCP ProtectionFilter audit: `docs/superpowers/plans/2026-07-22-mcp-protection-filter-gap.md`
- Feature flag registry: `demo_api_server/routes/featureFlags.js` (`ff_mcp_gateway_pinggateway`, `ff_authorize_real`, `ff_mcp_gateway_jwks`)
- Agent client packaging: `docs/PINGONE_APP_CONFIG.md` §5
