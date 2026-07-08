---
name: pingone-mcp-install
description: 'Install and wire the PingOne admin MCP server for Cursor (and optionally Claude Code). USE FOR: install pingone-mcp-server, Cursor MCP pingone setup, pingone MCP auth fails, net::ERR_FAILED on api.pingone.com/.../mcp, At least one scope must be granted, ACCESS_FAILED actor not authorized after MCP login, Worker OAuth client for MCP, PINGONE_AUTHORIZATION_CODE_CLIENT_ID, ~/.cursor/mcp.json pingone entry, brew install pingone-mcp-server. DO NOT USE FOR: calling PingOne tools after install (use pingone-mcp); Management API worker CC tokens / roleAssignments (use pingone-api-calls); banking data-plane MCP (demo_mcp_server / banking-gateway).'
argument-hint: 'Install or repair PingOne MCP in Cursor'
---

# Install PingOne MCP (Cursor)

Installs the **local stdio** PingOne MCP binary and wires Cursor to a **Worker-type**
OAuth public client so browser login works and Management API calls are authorized
by the signed-in user's admin roles.

## When to Use

- User asks to install / set up / fix PingOne MCP in Cursor
- Cursor `pingone` MCP shows Error and never opens auth
- Logs show `net::ERR_FAILED` against `api.pingone.com/.../mcp`
- Auth opens but fails with `At least one scope must be granted`
- Auth succeeds but tools return `ACCESS_FAILED` / `actor is not authorized`

## When NOT to Use

- Using PingOne MCP tools after a healthy install — use `pingone-mcp`
- Minting Management API worker `client_credentials` tokens or assigning app roles — use `pingone-api-calls`
- Banking / gateway MCP (`banking-mcp`, `banking-gateway`) — different servers

## Hard truths (do not skip)

1. **Cursor hosted HTTP MCP is broken today** for this tenant:  
   `POST https://api.pingone.{region}/v1/environments/{envId}/mcp` returns  
   `401 {"message":"Unauthorized"}` with **no `WWW-Authenticate`**, so Cursor never
   starts OAuth (`net::ERR_FAILED`, `auth=unknown`). PingOne's remote MCP PDF also
   requires an internal feature flag. **Do not configure Cursor `pingone` as a `url` entry.**
2. **OAuth client must be `type: WORKER`**, not `NATIVE_APP` / `WEB_APP`.  
   A NATIVE_APP client can complete PKCE login, but the resulting user token gets
   **403 ACCESS_FAILED** on Management API even when the user holds Environment Admin.
3. **OAuth client must have at least one resource grant** (usually `openid` +
   `profile` + `email`). Zero grants → authorize error `At least one scope must be granted`.
4. **Signed-in user must hold admin roles** (Environment Admin for PingOne tools;
   DaVinci Admin for DaVinci tools). Roles gate tools; OIDC scopes do not.
5. Existing skill `pingone-mcp` covers **usage** of the hosted/BFF path — this skill
   covers **install/repair for Cursor stdio**.

## Prerequisites

- macOS with Homebrew
- Repo `demo_api_server/.env` with:
  - `PINGONE_ENVIRONMENT_ID`
  - `PINGONE_REGION` (default `com`)
  - `PINGONE_WORKER_CLIENT_ID` / `PINGONE_WORKER_CLIENT_SECRET` (Management worker CC)
- A PingOne user that can sign in interactively (e.g. `demoUser`) and will receive
  Environment Admin (+ DaVinci Admin if needed)

## Install checklist

### 1. Install the stdio binary

```bash
brew tap pingidentity/tap
brew install pingone-mcp-server
pingone-mcp-server -v
which pingone-mcp-server   # expect /opt/homebrew/bin/pingone-mcp-server
```

### 2. Create a Worker OAuth public client (PKCE)

Use the existing Management worker CC token (see `pingone-api-calls`).

Required app shape (PingOne Console or API):

| Field | Value |
|---|---|
| `type` | **`WORKER`** (not NATIVE_APP) |
| `protocol` | `OPENID_CONNECT` |
| `grantTypes` | `AUTHORIZATION_CODE`, `REFRESH_TOKEN` |
| `responseTypes` | `CODE` |
| `tokenEndpointAuthMethod` | `NONE` (public) |
| `pkceEnforcement` | `S256_REQUIRED` |
| `assignActorRoles` | `false` |
| `redirectUris` | see list below |
| `enabled` | `true` |

Redirect URIs (include all that apply):

```
http://127.0.0.1:7464/callback
http://localhost:7464/callback
http://127.0.0.1:7474/callback
http://localhost:7474/callback
cursor://anysphere.cursor-mcp/oauth/callback
https://www.cursor.com/agents/mcp/oauth/callback
```

API create body (replace name; use worker Bearer):

```http
POST /v1/environments/{envId}/applications
Authorization: Bearer {workerAccessToken}
Content-Type: application/json

{
  "name": "PingOne MCP Server Cursor",
  "description": "Cursor stdio MCP OAuth client. Must be WORKER so user admin roles authorize Management API.",
  "enabled": true,
  "type": "WORKER",
  "protocol": "OPENID_CONNECT",
  "grantTypes": ["AUTHORIZATION_CODE", "REFRESH_TOKEN"],
  "responseTypes": ["CODE"],
  "tokenEndpointAuthMethod": "NONE",
  "pkceEnforcement": "S256_REQUIRED",
  "assignActorRoles": false,
  "redirectUris": [
    "http://127.0.0.1:7464/callback",
    "http://localhost:7464/callback",
    "http://127.0.0.1:7474/callback",
    "http://localhost:7474/callback",
    "cursor://anysphere.cursor-mcp/oauth/callback",
    "https://www.cursor.com/agents/mcp/oauth/callback"
  ]
}
```

Save the returned application `id` — that is the OAuth **client_id**.

### 3. Grant openid scopes to the new client

```http
GET /v1/environments/{envId}/resources          # find resource name=openid
GET /v1/environments/{envId}/resources/{openidId}/scopes
POST /v1/environments/{envId}/applications/{clientId}/grants
{
  "resource": { "id": "{openidResourceId}" },
  "scopes": [
    { "id": "{openidScopeId}" },
    { "id": "{profileScopeId}" },
    { "id": "{emailScopeId}" }
  ]
}
```

### 4. Ensure the interactive user has admin roles

For the user who will click Connect (e.g. `demoUser`):

- Environment Admin (ENVIRONMENT-scoped to this env)
- Identity Data Admin (recommended)
- DaVinci Admin (only if DaVinci tools are needed)

Use `pingone-api-calls` user role assignment
(`POST /users/{userId}/roleAssignments`) or Console → Identities → user → Roles.

### 5. Wire Cursor MCP config (stdio only)

**User-level** `~/.cursor/mcp.json` (preferred for Cursor auth):

```json
{
  "mcpServers": {
    "pingone": {
      "command": "pingone-mcp-server",
      "args": ["run"],
      "env": {
        "PINGONE_MCP_ENVIRONMENT_ID": "<PINGONE_ENVIRONMENT_ID>",
        "PINGONE_AUTHORIZATION_CODE_CLIENT_ID": "<WORKER_OAUTH_CLIENT_ID>",
        "PINGONE_ROOT_DOMAIN": "pingone.com"
      }
    }
  }
}
```

**Project-level** `.cursor/mcp.json`:

- **Remove** any `pingone` entry with `"url": "https://api.pingone.com/.../mcp"` —
  it will keep failing with `net::ERR_FAILED`.
- Do **not** run `npm run patch:cursor-mcp` if that rewrites `pingone` back to hosted HTTP
  unless/until PingOne enables remote MCP + proper OAuth challenges for this env.
- Keep other project servers (`codegraph`, `github`, `banking-*`) as-is.

### 6. Clear stale sessions and authenticate

```bash
pingone-mcp-server logout
security delete-generic-password -s pingone_mcp_server 2>/dev/null || true
```

In Cursor: Settings → MCP → enable **user** `pingone` → reload → Connect / trigger a tool.
Complete browser login as the admin-roled user (`demoUser`).

Verify with `list_applications` / `list_environments` (or `mcp_auth` then a list tool).
Healthy result: applications list returns without 403.

## Failure table

| Symptom | Cause | Fix |
|---|---|---|
| `net::ERR_FAILED` on `api.pingone.com/.../mcp` | Hosted HTTP MCP; no OAuth challenge | Use stdio config; delete `url` pingone entry |
| `At least one scope must be granted` | OAuth app has zero resource grants | Grant `openid`/`profile`/`email` |
| Auth OK, tools `ACCESS_FAILED` / 403 | OAuth app is `NATIVE_APP` (or user has no roles) | Recreate client as **`WORKER`**; grant user Environment Admin |
| Empty / tiny tool list | User missing admin roles | Assign Environment Admin (+ DaVinci Admin) |
| Browser never opens | Stale session / wrong client id in env | `logout`, delete keychain item, fix `PINGONE_AUTHORIZATION_CODE_CLIENT_ID` |
| Duplicate `pingone` servers (user + project) | Both configs define pingone | Keep **one** stdio entry (user); remove project hosted |

## Do not confuse with

| Thing | Purpose |
|---|---|
| `pingone-mcp` skill | How to **use** PingOne MCP / MCP-first rules |
| `PINGONE_WORKER_CLIENT_*` | Management API **client_credentials** worker (BFF/scripts) |
| `PINGONE_AUTHORIZATION_CODE_CLIENT_ID` | Interactive **OAuth** client for stdio MCP login |
| Hosted `.../mcp` URL | BFF/`smoke:pingone-mcp` worker Bearer path — **not** Cursor Connect |
| `demo_mcp_server` / banking-gateway | Data-plane banking tools |

## Related

- [pingone-mcp](../pingone-mcp/SKILL.md) — usage after install
- [pingone-api-calls](../pingone-api-calls/SKILL.md) — create Worker apps, grants, user roleAssignments
- Official PDF in repo worktrees: `Connect to the PingOne Remote MCP Server.pdf` (Worker + PKCE; remote needs feature flag)
