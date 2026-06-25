# PingOne Application Review

**Environment:** Brand New 4-4-2026 (`01d89b06-66d5-430e-9f28-65636843788b`) — SANDBOX
**Reviewed:** 2026-06-14 · **Apps renamed:** 2026-06-14

---

## App Inventory and Role Mapping

Every client in this environment, what it does, and which env var the code uses to reach it.
All apps renamed to `Demo AI App - <Role>` standard on 2026-06-14.

| PingOne Name | Client ID | Type | Env Var | Used By | Role |
| --- | --- | --- | --- | --- | --- |
| Demo AI App - User Login | `83572007` | WEB_APP | `PINGONE_USER_CLIENT_ID` | BFF login flow | End-user OIDC login. authorization_code + PKCE + refresh_token. |
| Demo AI App - Admin Login | `8a711944` | WEB_APP | `PINGONE_ADMIN_CLIENT_ID` | BFF admin login | Admin OIDC login. authorization_code + PKCE + refresh_token. |
| Demo AI App - AI Agent Actor | `71e878ea` | WEB_APP | `PINGONE_AI_AGENT_ACTOR_CLIENT_ID` | `agentMcpTokenService` | Two-Exchange Step 1 actor. Gets CC token (aud=agentgateway.ping.demo), used as `actor_token` in Exchange #1. |
| Demo AI App - Token Exchanger | `f4dd707d` | WEB_APP | `PINGONE_TOKEN_EXCHANGER_CLIENT_ID` | `agentMcpTokenService` | Two-Exchange Step 2 actor + single-exchange actor. Gets CC token (aud=mcpgateway.ping.demo), used as `actor_token` in Exchange #2. |
| Demo AI App - MCP Gateway | `6586d3de` | WEB_APP | `PINGONE_MCP_GATEWAY_CLIENT_ID` | MCP gateway process | MCP gateway client identity. Client credentials + token_exchange. |
| Demo AI App - MCP Server Client | `c76a9868` | WEB_APP | *(not in .env)* | MCP server process | MCP server client identity. Client credentials only. |
| Demo AI App - Introspection Worker | `89ad8921` | WORKER | `PINGONE_WORKER_CLIENT_ID` | `tokenIntrospectionService` | RFC 7662 token introspection. Only WORKER authorised to introspect tokens issued by other clients. Uses CLIENT_SECRET_BASIC. |
| PingOne MCP Server | `44e907ff` | NATIVE_APP | *(dev tooling)* | Claude Code → hosted PingOne MCP server | PKCE-only native app; OAuth client AI assistants use to reach the hosted PingOne MCP server. Not a demo runtime component. |

**Naming convention:** `Demo AI App - <Role>` for all demo apps. Workers use a descriptive role suffix (e.g. `Introspection Worker`) rather than `App`.

---

## Consolidation Analysis

**Can Demo AI Agent and Demo MCP Exchanger be merged (single actor for all exchanges)?**

No. They serve different hops in the two-exchange chain and target different audiences:

- `Demo AI Agent` (Step 1) → CC token `aud=agentgateway.ping.demo`, used as `actor_token` in Exchange #1 (user token → intermediate token)
- `Demo MCP Exchanger` (Step 2) → CC token `aud=mcpgateway.ping.demo`, used as `actor_token` in Exchange #2 (intermediate token → final MCP token)

Merging collapses the delegation chain, removes the `act.act.sub` nesting that proves the two-hop path, and makes the demo less instructive.

**Can Demo MCP Exchanger and Demo MCP Gateway be merged?**

No. They are different entities:

- `Demo MCP Exchanger` is a *client* that performs the exchange (holds CC + token_exchange grants)
- `Demo MCP Gateway` is the *gateway process identity* — it holds grants to the MCP Server resource so it can call downstream tools

Merging them means the same client that mints the token also receives and validates it, removing the separation of concerns the gateway enforces.

**What about Demo Agent (WORKER, `f93d8ae5`)?**

This WORKER is currently not used in any exchange flow. The env var `AGENT_CLIENT_ID` maps to `pingone_ai_agent_client_id` in configStore as its lowest-priority alias, but `PINGONE_AI_AGENT_ACTOR_CLIENT_ID=71e878ea` is set explicitly and takes priority. `Demo Agent` should either be:

- **Removed** if the intent was always to use `Demo AI Agent` as the actor, or
- **Kept and documented** as a reserved WORKER identity for future management API use

The `.env` entry `AGENT_CLIENT_ID=f93d8ae5` is stale — it resolves to `Demo Agent WORKER` only when `PINGONE_AI_AGENT_ACTOR_CLIENT_ID` is unset, which should never be the case after provisioning.

**`Demo MCP Server` name collision** — the app (`c76a9868`) and the resource server both share the name "Demo MCP Server". This causes confusion in logs, the admin UI, and scope topology. Rename the app to `Demo MCP Server App`.

**`Getting Started Application`** — PingOne default app, not provisioned by bootstrap. Disable/hide from portal.

---

## Issues Per App

### Demo AI App - User Login (`83572007`) — WEB_APP ✓

**Role:** End-user OIDC login. Authorization code + PKCE.

**Grants:** Demo API (`enduser.ping.demo`): `ai:agent:read`, `read`, `gear:read`, `largepurchase:read`, `mortgage:read`, `records:read`, `expense:read`, `write`, `transfer`

**Issues:**

- `write` and `transfer` are high-privilege on a user consent screen. Consider splitting `write` into narrower scopes.
- Config: PKCE S256_REQUIRED ✓, CLIENT_SECRET_POST (BFF holds secret server-side) ✓, REFRESH_TOKEN ✓

---

### Demo AI App - Admin Login (`8a711944`) — WEB_APP

**Role:** Admin OIDC login.

**Grants:** Demo MCP Server: `mcp:invoke` + Demo API: 17 scopes (full catalogue including all user and admin scopes)

**Issues:**

- `TOKEN_EXCHANGE` grant — admin web app does not perform token exchange. The BFF uses the MCP Exchanger for that. **Remove this grant.**
- 17 scopes on Demo API with no differentiation — admin should only receive admin-scoped grants (`admin:read`, `admin:write`, `admin:delete`, `users:read`, `users:manage`). **Trim to admin scopes only.**
- `ai_agent` scope (no colon, legacy) is a duplicate of `ai:agent:read`. **Remove legacy scope.**

---

### Demo AI App - AI Agent Actor (`71e878ea`) — WEB_APP ✓

**Role:** Two-Exchange Step 1 actor. Gets CC token scoped to `agentgateway.ping.demo`.

**Grants:** Demo Agent Gateway: `agent:invoke` ✓ · Demo API: `ai:agent:read`, `read`, `mortgage:read`, `write`, `transfer`

**Issues:**

- `AUTHORIZATION_CODE` grant — machine actor, never does browser login. **Remove.**
- Placeholder redirect URI — confirms AUTHORIZATION_CODE is unused. **Remove.**
- `write` and `transfer` on Demo API are broader than an AI agent needs. Consider trimming to `ai:agent:read` + `mortgage:read`.
- Must stay `WEB_APP` — WORKER apps cannot hold resource grants; removing token_exchange capability would break the exchange chain.

---

### Demo AI App - Token Exchanger (`f4dd707d`) — WEB_APP ✓

**Role:** Two-Exchange Step 2 actor + single-exchange actor. Gets CC token scoped to `mcpgateway.ping.demo`.

**Grants:** Demo MCP Gateway: 9 scopes (all) · Demo Agent Gateway: `agent:invoke` · Demo MCP Server: 6 admin scopes

**Issues:**

- Grant to **Demo MCP Server** directly (`mcpserver.ping.demo`) — breaks the hop boundary. The exchanger should only mint gateway-audience tokens; the gateway does the second exchange to `mcpserver`. **Remove Demo MCP Server grant.**
- `AUTHORIZATION_CODE` grant + placeholder redirect URI — never used. **Remove.**
- All 9 MCP Gateway scopes granted — no PingOne-level cap. Narrow to the scopes the demo actually exercises.

---

### Demo AI App - MCP Gateway (`6586d3de`) — WEB_APP ✓

**Role:** MCP gateway process identity. Receives exchanged tokens, re-exchanges to `mcpserver.ping.demo`.

**Grants:** Demo MCP Server: `read`, `mortgage:read`, `write`, `mcp:invoke`

**Issues:**

- `write` on Demo MCP Server — the gateway's own machine identity should not carry write rights unconditionally. Write operations should come via user-delegated scopes only. **Remove `write`.**

---

### Demo AI App - MCP Server Client (`c76a9868`) — WEB_APP ✓

**Role:** MCP server process client identity. Client credentials only.

**Grants:** None. Clean.

---

### ~~Demo Agent Worker (`f93d8ae5`)~~ — DELETED 2026-06-14

Was unused — `AGENT_CLIENT_ID` maps to `pingone_ai_agent_client_id` as the lowest-priority fallback, but `PINGONE_AI_AGENT_ACTOR_CLIENT_ID=71e878ea` always resolves first. No grants were configured; the app served no purpose.

**Action:** Remove the stale `AGENT_CLIENT_ID` entry from `.env`.

---

### Demo AI App - Introspection Worker (`89ad8921`) — WORKER ✓

**Role:** RFC 7662 token introspection. Only client authorised to introspect across clients in this environment.

**Config:** CLIENT_SECRET_BASIC ✓, no grants (correct) ✓

**Issues:** None. Previously named `worker token` (renamed 2026-06-14). `GW_INTROSPECTION_CLIENT_ID` corrected to point to this Worker in the same session.

---

## Leave Unchanged

| App | Reason |
| --- | --- |
| `PingOne MCP Server` (`44e907ff`) | NATIVE_APP PKCE — OAuth client for the hosted PingOne MCP server, correct config, not a demo runtime app |
| `Getting Started Application` (`f2f4276e`) | PingOne default — disable/hide from portal |
| `PingOneAgent_agent` / `PingOneDaVinciAgent_agent` | Helix-managed WORKERs — do not touch |
| `PingOne Helix Connection` | System WORKER — do not touch |
| `PingOne DaVinci Connection` | System WORKER — do not touch |
| `PingID Desktop Gen2` | System NATIVE_APP — do not touch |

---

## Scope Model Issues (Cross-Cutting)

1. **`ai_agent` vs `ai:agent:read`** — two scopes for the same concept. `ai_agent` (legacy, no colon) only on Demo Admin App grant. Remove from resource and grant once `ai:agent:read` is confirmed canonical.

2. **`write` is too broad** — single scope covers all mutations. Splits into domain write scopes (`transactions:write`, `profile:write`) in a future iteration.

3. **`admin:*` scopes on a user-facing resource** — Demo API (`enduser.ping.demo`) hosts both user and admin scopes. A user-login token could accidentally carry admin scopes. Admin operations should be a separate resource or guarded by an audience claim.

---

## Introspection Note

`tokenIntrospectionService.js` uses `PINGONE_WORKER_CLIENT_ID` (`89ad8921`) with `CLIENT_SECRET_BASIC`. This is correct — it is the only app in this environment authorised to introspect tokens issued by other clients (RFC 7662).

**Manual .env fix required:** `GW_INTROSPECTION_CLIENT_ID` and `GW_INTROSPECTION_CLIENT_SECRET` currently point to `f4dd707d` (Demo MCP Exchanger). Update to Worker credentials:

```env
GW_INTROSPECTION_CLIENT_ID=89ad8921-2e90-4b58-93bd-9ec72bd33ad5
GW_INTROSPECTION_CLIENT_SECRET=<PINGONE_WORKER_CLIENT_SECRET value>
PINGONE_INTROSPECTION_AUTH_METHOD=basic
```

---

## Startup Configuration Check (to implement)

### Problem

`tokenIntrospectionService.validateToken()` has a missing-credentials guard that throws `INTROSPECTION_NOT_CONFIGURED`, which `agentMcpTokenService` treats as "skipped" so no false-positive banner fires. This is a safe fallback — but missing credentials should never happen in a running environment. Silently skipping introspection means tokens are never validated for revocation, and the demo teaches the wrong security lesson. We need to fail loudly at startup, not silently at runtime.

Calling PingOne on every introspection request to discover credentials is too expensive (adds a PingOne RTT to every agent call). The right place is **once at server startup**.

### Proposed: PingOne readiness check at startup

Add a startup check in `demo_api_server` (e.g. called from `server.js` before the Express app begins accepting requests) that:

1. **Validates critical env vars are present** — `PINGONE_WORKER_CLIENT_ID`, `PINGONE_WORKER_CLIENT_SECRET`, `PINGONE_ENVIRONMENT_ID`, `PINGONE_INTROSPECTION_AUTH_METHOD`.
2. **Calls PingOne to verify the Worker client exists and can authenticate** — attempt a `client_credentials` token request using the Worker credentials.
3. **Verifies the Worker app is of type WORKER** — call `GET /v1/environments/{envId}/applications/{workerId}` and assert `type === WORKER`.
4. **Logs a fatal startup warning (not a crash)** — server still starts so the UI is reachable for diagnosis, but the admin panel shows a `PingOne configuration error` banner and every introspection call logs at ERROR level.

### Checks matrix

| Check | Env var | PingOne API call | Fail behaviour |
| --- | --- | --- | --- |
| Worker client ID present | `PINGONE_WORKER_CLIENT_ID` | — | Fatal warn at startup |
| Worker client secret present | `PINGONE_WORKER_CLIENT_SECRET` | — | Fatal warn at startup |
| Worker credentials authenticate | — | POST `/as/token` (client_credentials) | Fatal warn, mark introspection unavailable |
| Worker app type is WORKER | — | GET `/v1/environments/{env}/applications/{id}` | Fatal warn, mark introspection misconfigured |
| Introspection endpoint reachable | — | POST `/as/introspect` with a dummy token | Log warn if 5xx/timeout; 4xx is expected and OK |
| User client ID present | `PINGONE_USER_CLIENT_ID` | — | Warn (non-fatal) |
| MCP Exchanger client ID present | `PINGONE_TOKEN_EXCHANGER_CLIENT_ID` | — | Warn (non-fatal) |

### Files to create/modify

| File | Change |
| --- | --- |
| `demo_api_server/services/pingoneStartupCheck.js` | New — runs checks, exposes `getStartupCheckResults()` and `isIntrospectionAvailable()` |
| `demo_api_server/server.js` | Call `runStartupChecks()` after env load, before `app.listen()` |
| `demo_api_server/services/tokenIntrospectionService.js` | Read `isIntrospectionAvailable()` flag; throw descriptively if false |
| `demo_api_server/routes/health.js` | Expose startup check results in `/api/health` response |
| `demo_api_ui/src/components/Configuration/UnifiedConfigurationPage.tsx` | Surface PingOne health status from `/api/health` |
