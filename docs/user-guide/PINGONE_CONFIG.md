# PingOne Configuration — Source of Truth

> **This file is the authoritative record of the PingOne environment for this demo.**
> Keep it in sync whenever you change anything in PingOne or `.env`.
> Environment: `01d89b06-66d5-430e-9f28-65636843788b` · Region: `com`
> Auth base: `https://auth.pingone.com/01d89b06-66d5-430e-9f28-65636843788b`
> API base: `https://api.pingone.com/v1/environments/01d89b06-66d5-430e-9f28-65636843788b`
>
> **Related docs:**
> - [`docs/ENV_VARS.md`](ENV_VARS.md) — authoritative reference for every environment variable, naming conventions, legacy aliases, and startup validation
> - [`demo_api_server/.env.example`](../../demo_api_server/.env.example) — documentation mirror of the generated `.env`; same variable names as bootstrap output

---

## Applications

| Role | App Name | Client ID | Type | Token Auth | Grant Types |
|---|---|---|---|---|---|
| **Admin login** | Demo Admin App | `3937cbfd-8824-4f0d-adb2-178702fe9518` | WEB_APP | CLIENT_SECRET_POST | authorization_code, refresh_token, token_exchange |
| **User/customer login** | Demo User App | `b7d00976-405f-4c55-914a-a3ebe8f369d8` | WEB_APP | CLIENT_SECRET_POST | authorization_code, refresh_token |
| **AI Agent actor** | Demo AI Agent | `d21c5124-8ac5-43d1-81f2-31a7ec649b96` | WEB_APP | CLIENT_SECRET_POST | authorization_code, client_credentials, token_exchange |
| **MCP Gateway CC actor** | Demo MCP Gateway | `3fc5ec99-48dd-42d2-b5fd-ec34055769d2` | WEB_APP | CLIENT_SECRET_POST | client_credentials, token_exchange |
| **Legacy exchanger (unused)** | Demo MCP Exchanger | `d3f8fead-b81d-46f9-bba5-051e493cea0e` | WEB_APP | CLIENT_SECRET_POST | authorization_code, client_credentials, token_exchange |
| **Management API (worker)** | Demo Worker Token App | `15881ac7-4d83-4cbf-9ab0-4d7cda31fab8` | WORKER | CLIENT_SECRET_BASIC | client_credentials |
| **Agent service (worker)** | Demo Agent | `cf314c00-1fa8-470f-ab55-2ce58504e318` | WORKER | — | client_credentials |
| **PingOne MCP Server (dev tooling)** | PingOne MCP Server | _per-tenant — `PINGONE_MCP_OAUTH_CLIENT_ID`_ | NATIVE_APP | NONE (PKCE S256) | authorization_code, refresh_token |

### Redirect URIs

| App | Redirect URI |
|---|---|
| Demo Admin App | `https://api.ping.demo:4000/api/auth/oauth/callback` |
| Demo User App | `https://api.ping.demo:4000/api/auth/oauth/user/callback` |
| Demo AI Agent | `https://api.ping.demo:4000/api/auth/oauth/ai-agent-placeholder-callback` |
| Demo MCP Exchanger | `https://api.ping.demo:4000/api/auth/oauth/mcp-exchanger-placeholder-callback` |
| PingOne MCP Server | `http://localhost:7464/callback`, `http://127.0.0.1:7464/callback` (Claude Code), `cursor://anysphere.cursor-mcp/oauth/callback`, `https://www.cursor.com/agents/mcp/oauth/callback` (Cursor; provisioned by bootstrap, patched into `.mcp.json` / `.cursor/mcp.json` by `install.sh`) |

---

## Resource Servers

| Role | Resource Name | Resource ID | Audience (aud) |
|---|---|---|---|
| **User access token** | Demo API | `9b0f9ae4-463c-458e-9c5e-7e1dd8e6323d` | `enduser.ping.demo` |
| **Agent Gateway token** | Demo Agent Gateway | `ed88ddf3-065c-456b-a87b-4b44af85d33e` | `agentgateway.ping.demo` |
| **MCP Gateway token** | Demo MCP Gateway | `fb2d09cb-4f45-4c1a-abef-695fb0adfc86` | `mcpgateway.ping.demo` |
| **MCP Server token** | Demo MCP Server | `8fb4d1a8-3896-4a26-bf56-b678f2fcf15e` | `mcpserver.ping.demo` |
| _(legacy, unused)_ | Demo MCP Gateway Old | `824c0238-23a0-4737-af5f-175824595a38` | `mcpgateway-old.ping.demo` |

### Resource Scopes

> Scopes are **plain** (no `banking:*` prefix). The lists below mirror `scope-topology.json`.

**Demo API** (`enduser.ping.demo`):
`read`, `write`, `transfer`, `accounts:read`, `transactions:read`, `mortgage:read`, `largepurchase:read`, `records:read`, `gear:read`, `expense:read`, `ai:agent:read`, `ai_agent`, `admin:read`, `admin:write`, `admin:delete`, `users:read`, `users:manage`

**Demo Agent Gateway** (`agentgateway.ping.demo`):
`agent:invoke`

**Demo MCP Gateway** (`mcpgateway.ping.demo`):
`mcp:invoke`, `read`, `write`, `transfer`, `mortgage:read`, `largepurchase:read`, `records:read`, `gear:read`, `expense:read`

**Demo MCP Server** (`mcpserver.ping.demo`):
`mcp:invoke`, `read`, `write`, `mortgage:read`, `largepurchase:read`, `records:read`, `gear:read`, `expense:read`, `ai:agent:read`, `admin:read`, `admin:write`, `admin:delete`, `users:read`, `users:manage`

---

## Token Attribute Mappings (may_act / act)

The `may_act` claim on a user token prospectively authorises the RFC 8693 token exchange. It must be emitted as a **JSON object** in the JWT.

**How it is configured (two parts):**

1. **On the USER record** — set a custom JSON user attribute named `mayAct` whose value is the JSON object `{"sub":"<AGENT_CLIENT_ID>"}` (for this demo, `{"sub":"d21c5124-8ac5-43d1-81f2-31a7ec649b96"}`). The attribute schema type must be **JSON**, not STRING, so it projects as a real object.
2. **On the RESOURCE** — set the `may_act` resource attribute to the SpEL expression `${user.mayAct}`. This reads the user's `mayAct` attribute and emits it as a JSON object in the token.

> **Do NOT** use a SpEL map literal like `#{'sub': '...'}` as the resource attribute value. PingOne emits `#{...}` **literally** into the token (the recurring token bug), producing `"may_act": "#{'sub':'...'}"` which fails `may_act.sub` lookups during exchange. Always use `${user.mayAct}` on the resource, with the per-user value living on the user record.
>
> Evidence: `demo_api_server/services/pingoneProvisionService.js` (`MAY_ACT_USER_SPEL = '${user.mayAct}'`) and `docs/SECURITY_ARCHITECTURE.md` §3.

### Demo API resource (`enduser.ping.demo`) — user access token

| Attribute | Value (SpEL) | Notes |
|---|---|---|
| `sub` | `${user.id}` | Standard — user's PingOne UUID |
| `may_act` | `${user.mayAct}` | Projects the user's `mayAct` JSON attribute — authorises Exchange #1 |
| `is_delegate` | `${user.isDelegate}` | Delegation flag |

### Demo MCP Server resource (`mcpserver.ping.demo`) — MCP access token

| Attribute | Value (SpEL) | Notes |
|---|---|---|
| `sub` | `${user.id}` | Standard — user's PingOne UUID |
| `may_act` | `${user.mayAct}` | Projects the user's `mayAct` JSON attribute — authorises downstream re-exchange |
| `act` | `${(#root.context.requestData.actorToken != null and #root.context.requestData.subjectToken.may_act != null and #root.context.requestData.subjectToken.may_act.sub == #root.context.requestData.actorToken.client_id) ? #root.context.requestData.subjectToken.may_act : null}` | Native `act` (see below) — emits `{sub:<actor>}` when the actor matches `may_act.sub`, else `null` |

> **Critical:** the user-record `mayAct.sub` MUST equal `PINGONE_AI_AGENT_CLIENT_ID` (`d21c5124...`).
> The old value was `d3f8fead` (Demo MCP Exchanger) — **wrong, do not revert**.
> The user attribute value MUST be a JSON object `{"sub":"..."}` (schema type JSON, not STRING), and the resource attribute MUST be `${user.mayAct}`.

### `act` claim — minted by PingOne, with a header fallback

> The downstream `act` claim (actor identity) **is** minted into the exchanged token by a PingOne resource attribute — a null-safe `${(#root…)}` SpEL on the audience resource (deployed on `mcpgateway`, `mcpserver`, and `agentgateway`; emission verified live 2026-06-19 on `mcpgateway` + `agentgateway`). See `docs/ACT_CLAIM_VERIFICATION.md` for the exact expression.
> The BFF also bridges the actor via the `X-Act-Client-Id` HTTP header (and `X-May-Act-Sub` for per-user `may_act`). This is a **deliberate fallback, not redundant**: the gateway prefers a native token `act` and falls back to the header on hops/flows where native `act` isn't guaranteed (no-actor exchanges, Exchange-#2, platform-connector mode); `X-May-Act-Sub` also feeds the `ENFORCE_MAY_ACT` decision gate.
> Evidence: `demo_mcp_gateway/src/index.ts` (prefers token `act`, reads `x-act-client-id` as fallback).

---

## .env ↔ PingOne Mapping

Every `.env` variable and what it maps to in PingOne:

```
PINGONE_ENVIRONMENT_ID=01d89b06-66d5-430e-9f28-65636843788b

# Admin login app
PINGONE_ADMIN_CLIENT_ID=3937cbfd-8824-4f0d-adb2-178702fe9518        # Demo Admin App
PINGONE_ADMIN_REDIRECT_URI=https://api.ping.demo:4000/api/auth/oauth/callback

# User/customer login app
PINGONE_USER_CLIENT_ID=b7d00976-405f-4c55-914a-a3ebe8f369d8          # Demo User App
PINGONE_USER_REDIRECT_URI=https://api.ping.demo:4000/api/auth/oauth/user/callback

# RFC 8693 actor app (Exchange #1: user token → gateway-scoped token)
PINGONE_AI_AGENT_CLIENT_ID=d21c5124-8ac5-43d1-81f2-31a7ec649b96      # Demo AI Agent
# also aliased as:
AGENT_CLIENT_ID=cf314c00-1fa8-470f-ab55-2ce58504e318                 # Demo Agent (worker)

# MCP Gateway CC client (Exchange #2 actor at gateway side)
MCP_GW_CLIENT_ID=3fc5ec99-48dd-42d2-b5fd-ec34055769d2                # Demo MCP Gateway app
MCP_GW_TOKEN_ENDPOINT_AUTH_METHOD=post

# Management / worker (PingOne API calls only — not user-facing)
PINGONE_WORKER_CLIENT_ID=15881ac7-4d83-4cbf-9ab0-4d7cda31fab8        # Demo Worker Token App

# Audience (aud) values — must match resource server audience strings
ENDUSER_AUDIENCE=enduser.ping.demo                                    # Demo API resource
PINGONE_RESOURCE_AGENT_GATEWAY_URI=agentgateway.ping.demo            # Demo Agent Gateway resource
AI_AGENT_INTERMEDIATE_AUDIENCE=agentgateway.ping.demo                # same
PINGONE_RESOURCE_MCP_GATEWAY_URI=mcpgateway.ping.demo                # Demo MCP Gateway resource
MCP_GW_RESOURCE_URI=mcpgateway.ping.demo                             # same (gateway reads this)
MCP_RESOURCE_URI=mcpgateway.ping.demo                                # BFF alias
PINGONE_RESOURCE_TWO_EXCHANGE_URI=mcpserver.ping.demo                # Demo MCP Server resource
MCP_SERVER_RESOURCE_URI=mcpserver.ping.demo                          # same

# Service URLs (scheme is part of the value)
MCP_SERVER_URL=wss://api.ping.demo:3005                               # BFF→gateway WebSocket (gateway is TLS-only; ws:// → "socket hang up")
```

---

## RFC 8693 Token Exchange Chain

```
User login (Demo User App b7d00976)
  └─ issues T1: aud=enduser.ping.demo, may_act.sub=d21c5124 (AI Agent)

Exchange #1 — BFF performs:
  subject_token = T1 (user access token)
  actor_token   = AI Agent CC token (Demo AI Agent d21c5124, aud=agentgateway.ping.demo)
  audience      = mcpgateway.ping.demo
  └─ issues T2: aud=mcpgateway.ping.demo, act.sub=d21c5124, sub=<user>

Gateway re-exchange (Exchange #2):
  subject_token = T2
  actor_token   = MCP Gateway CC token (Demo MCP Gateway 3fc5ec99)
  audience      = mcpserver.ping.demo
  └─ issues T3: aud=mcpserver.ping.demo, act.sub=3fc5ec99, sub=<user>
```

---

## How to Fix PingOne with the Management API

Obtain a token (worker client uses CLIENT_SECRET_BASIC):

```bash
MGT_TOKEN=$(curl -s -X POST "https://auth.pingone.com/01d89b06-66d5-430e-9f28-65636843788b/as/token" \
  -u "15881ac7-4d83-4cbf-9ab0-4d7cda31fab8:<worker_secret>" \
  -d "grant_type=client_credentials" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])")
```

Set the `may_act` resource attribute (value is the SpEL projection of the user attribute):
```bash
curl -X PUT "https://api.pingone.com/v1/environments/01d89b06-66d5-430e-9f28-65636843788b/resources/<RES_ID>/attributes/<ATTR_ID>" \
  -H "Authorization: Bearer $MGT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"may_act","value":"${user.mayAct}"}'
```

Set the per-user `mayAct` JSON attribute (this holds the actual actor `sub`):
```bash
curl -X PATCH "https://api.pingone.com/v1/environments/01d89b06-66d5-430e-9f28-65636843788b/users/<USER_ID>" \
  -H "Authorization: Bearer $MGT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"mayAct":{"sub":"d21c5124-8ac5-43d1-81f2-31a7ec649b96"}}'
```

List attributes for a resource:
```bash
curl "https://api.pingone.com/v1/environments/01d89b06-66d5-430e-9f28-65636843788b/resources/<RES_ID>/attributes" \
  -H "Authorization: Bearer $MGT_TOKEN"
```

---

## Persistence Model — How Values Survive Restarts

```
demo_api_server/.env   ← WRITTEN by bootstrap; seeded into LMDB immediately after
        ↓
  configStore._seedFromEnv()   ← runs at bootstrap + every server cold-start
        ↓
  data/persistent/lmdb/ (LMDB/AES-256-GCM)
        ← AUTHORITATIVE at runtime: survives .env loss
        ← runtime overrides via /config admin UI also stored here
        ← LMDB wins over .env when a value is explicitly saved there
```

**Rule:** Bootstrap writes `.env` then immediately mirrors all values into LMDB.
Every subsequent server startup seeds LMDB with any env value that isn't already there — so LMDB is always a complete, encrypted-at-rest backup.
Runtime overrides (set via `/config` UI) take precedence over both.
If `config.db` is lost, re-run `npm run pingone:bootstrap` to regenerate both files.

**Never read `process.env` directly in route handlers** — always use `configStore.getEffective(key)`.
This ensures the LMDB override layer (runtime config UI changes) is respected.

Key alias notes:
- `getEffective('user_client_id')` and `getEffective('PINGONE_USER_CLIENT_ID')` both resolve to `PINGONE_USER_CLIENT_ID` env var
- `pingone_resource_mcp_server_uri` resolves via `PINGONE_RESOURCE_MCP_SERVER_URI` → `MCP_SERVER_RESOURCE_URI` → `MCP_RESOURCE_URI` (in that priority order — `MCP_SERVER_RESOURCE_URI` wins over `MCP_RESOURCE_URI`)

## configStore Keys (BFF runtime SoT)

| configStore key | .env var | Value |
|---|---|---|
| `PINGONE_ENVIRONMENT_ID` | `PINGONE_ENVIRONMENT_ID` | `01d89b06-66d5-430e-9f28-65636843788b` |
| `PINGONE_REGION` | `PINGONE_REGION` | `com` |
| `PINGONE_USER_CLIENT_ID` | `PINGONE_USER_CLIENT_ID` | `b7d00976-405f-4c55-914a-a3ebe8f369d8` |
| `PINGONE_ADMIN_CLIENT_ID` | `PINGONE_ADMIN_CLIENT_ID` | `3937cbfd-8824-4f0d-adb2-178702fe9518` |
| `PINGONE_AI_AGENT_CLIENT_ID` | `PINGONE_AI_AGENT_CLIENT_ID` | `d21c5124-8ac5-43d1-81f2-31a7ec649b96` |
| `mcp_gw_client_id` | `MCP_GW_CLIENT_ID` | `3fc5ec99-48dd-42d2-b5fd-ec34055769d2` |
| `enduser_audience` | `ENDUSER_AUDIENCE` | `enduser.ping.demo` |
| `PINGONE_RESOURCE_AGENT_GATEWAY_URI` | `PINGONE_RESOURCE_AGENT_GATEWAY_URI` | `agentgateway.ping.demo` |
| `PINGONE_RESOURCE_MCP_GATEWAY_URI` | `PINGONE_RESOURCE_MCP_GATEWAY_URI` | `mcpgateway.ping.demo` |
| `mcp_gw_resource_uri` | `MCP_GW_RESOURCE_URI` | `mcpgateway.ping.demo` |
| `PINGONE_RESOURCE_TWO_EXCHANGE_URI` | `PINGONE_RESOURCE_TWO_EXCHANGE_URI` | `mcpserver.ping.demo` |
| `mcp_gateway_http_url` | `MCP_GATEWAY_HTTP_URL` | `https://api.ping.demo:3005` |
| `mcp_server_url` | `MCP_SERVER_URL` | `ws://localhost:3005` |
