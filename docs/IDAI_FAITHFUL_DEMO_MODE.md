# IDAI-faithful demo mode

How to run Super Banking so it matches the security *shape* of Ping’s
[Securing AI agents with PingOne](https://developer.pingidentity.com/identity-for-ai/use-cases/idai-securing-agents-pingone.html)
page: real PingGateway as PEP, live PingOne Authorize, introspection (not local JWKS).

This is **operator guidance**, not a claim of page-literal parity. Known intentional
differences (BFF-held tokens, multi-hop TE, HITL/CIBA instead of login Agreement Prompt)
are listed in [`PING_IDAI_SECURING_AGENTS_DIFF.md`](./PING_IDAI_SECURING_AGENTS_DIFF.md)
when that doc is on your branch (PR #721).

## Flag recipe

| Flag | IDAI-faithful value | Quick Flags label | Why |
|------|---------------------|-------------------|-----|
| Use PingOne Agent Gateway | **ON** | Agent Gateway → PingOne GW | Ping doc uses PingGateway in front of MCP |
| Simulated Authorize | **OFF** | Authorize Engine → Real P1AZ | Live PingOne Authorize, not the in-process mock |
| Token Validation JWKS | **OFF** | Token Validation → Introspect | Doc path introspects; JWKS is educational (no revocation) |

Leave other Quick Flags alone unless your scenario needs them (CIBA, tracing, etc.).

## Fast path (UI)

1. Sign in.
2. Open the **Quick Flags** pill in the top nav (shows `Introspect` or `🔐 JWKS`).
3. Click **Apply IDAI-faithful preset**.
4. Confirm the green status line: PingOne GW + Real P1AZ + Introspect.
5. If any target flag is **pinned** by Docker/env, the preset skips it and shows ⚠️ — change the env / compose pin instead.

## Manual path

Same three toggles in Quick Flags or Admin → Feature Flags:

1. Agent Gateway = **PingOne GW**
2. Authorize Engine = **Real P1AZ**
3. Token Validation = **Introspect**

## Verify before the demo

- [ ] PingGateway container healthy; MCP calls hit IG (not Demo Agent Gateway).
- [ ] A tool call shows a real PingOne Authorize decision (decision id / live policy), not simulated-only education copy.
- [ ] No `X-Token-Validation: jwks` / `X-Token-Validation-Mode: jwks` on the happy path.
- [ ] Optional: no-token request to gateway returns `401` with `WWW-Authenticate` (introspect routes use `McpProtectionFilter`; JWKS educational routes add `resource_metadata` only).

## What this mode does *not* change

- Does **not** restore `may_act` / login Agreement Prompt (out of scope for this demo).
- Does **not** move token exchange into the agent process (BFF + gateway custody stays).
- Does **not** rename audiences to the tutorial’s `agent` / `test` scopes.

## Related

- Gap report: `docs/PING_IDAI_SECURING_AGENTS_DIFF.md` (when merged)
- MCP ProtectionFilter audit: `docs/superpowers/plans/2026-07-22-mcp-protection-filter-gap.md`
- Feature flag registry: `demo_api_server/routes/featureFlags.js` (`ff_mcp_gateway_pinggateway`, `ff_authorize_simulated`, `ff_mcp_gateway_jwks`)
