---
name: pingone-mcp-install
description: 'Claude skill to install PingOne MCP for Cursor/Claude Code AND create PingOne Worker applications when asked. USE FOR: install pingone-mcp-server, create PingOne Worker app, create worker application, Worker OAuth client for MCP, Management API worker client_credentials app, PINGONE_WORKER_CLIENT_ID, PINGONE_AUTHORIZATION_CODE_CLIENT_ID, Cursor MCP pingone setup, pingone MCP auth fails, net::ERR_FAILED on api.pingone.com/.../mcp, At least one scope must be granted, ACCESS_FAILED actor not authorized, brew install pingone-mcp-server, ~/.cursor/mcp.json pingone. DO NOT USE FOR: calling PingOne tools after a healthy install (use pingone-mcp); banking data-plane MCP (demo_mcp_server / banking-gateway); generic user CRUD unrelated to MCP install (use pingone-api-calls).'
argument-hint: 'Install PingOne MCP and/or create a PingOne Worker app'
---

# Install PingOne MCP + create Worker apps (Claude skill)

This is a **Claude skill** (`~/.claude/skills/pingone-mcp-install/` and
`.claude/skills/pingone-mcp-install/` in-repo).

It does two jobs:

1. **Install / repair** the local stdio PingOne MCP server for Cursor (and Claude Code).
2. **Create a PingOne Worker application** when the user asks — either the interactive
   MCP OAuth Worker (auth code + PKCE) or a Management API `client_credentials` Worker
   (and assign roles). Do **not** refuse or only point at another skill when the user
   asks to create a Worker.

## When to Use

- User asks to install / set up / fix PingOne MCP in Cursor or Claude Code
- User asks to **create a PingOne Worker app** / worker token client / MCP OAuth Worker
- Cursor `pingone` MCP shows Error and never opens auth
- Logs show `net::ERR_FAILED` against `api.pingone.com/.../mcp`
- Auth opens but fails with `At least one scope must be granted`
- Auth succeeds but tools return `ACCESS_FAILED` / `actor is not authorized`

## When NOT to Use

- Using PingOne MCP tools after a healthy install — use `pingone-mcp`
- Banking / gateway MCP (`banking-mcp`, `banking-gateway`) — different servers
- Unrelated Management API work with no Worker/MCP install intent — use `pingone-api-calls`

## Hard truths (do not skip)

1. **Cursor hosted HTTP MCP is broken today** for this tenant:  
   `POST https://api.pingone.{region}/v1/environments/{envId}/mcp` returns  
   `401 {"message":"Unauthorized"}` with **no `WWW-Authenticate`**, so Cursor never
   starts OAuth (`net::ERR_FAILED`, `auth=unknown`). PingOne's remote MCP PDF also
   requires an internal feature flag. **Do not configure Cursor `pingone` as a `url` entry.**
2. **MCP OAuth client must be `type: WORKER`**, not `NATIVE_APP` / `WEB_APP`.  
   A NATIVE_APP client can complete PKCE login, but the resulting user token gets
   **403 ACCESS_FAILED** on Management API even when the user holds Environment Admin.
3. **OAuth client must have at least one resource grant** (usually `openid` +
   `profile` + `email`). Zero grants → authorize error `At least one scope must be granted`.
4. **Signed-in user must hold admin roles** (Environment Admin for PingOne tools;
   DaVinci Admin for DaVinci tools). Roles gate tools; OIDC scopes do not.
5. **Two different Worker apps** are common — do not conflate them:

| App | Grant types | Auth method | Used for |
|---|---|---|---|
| Management Worker (CC) | `CLIENT_CREDENTIALS` | `CLIENT_SECRET_BASIC` (demo "Super Banking Worker") | BFF/scripts Management API; bootstrap |
| MCP OAuth Worker | `AUTHORIZATION_CODE` + `REFRESH_TOKEN` | `NONE` + PKCE S256 | Cursor/Claude interactive MCP login |

## Prerequisites

- macOS with Homebrew (for `pingone-mcp-server`)
- `PINGONE_ENVIRONMENT_ID` + `PINGONE_REGION` (default `com`) from `demo_api_server/.env`
- To **create** apps via API: an existing Management Worker CC credential with enough
  roles to create applications and roleAssignments (typically Environment Admin +
  Identity Data Admin). If missing and the user asks for a Worker, create one only
  after they provide a privileged actor token / Console path — never invent secrets.

---

## A. Create a PingOne Worker app (when the user asks)

**Always do this when the user asks to create a Worker / worker token / MCP Worker.**
Pick the variant from their intent (default = MCP OAuth Worker if installing MCP;
CC Management Worker if they need `PINGONE_WORKER_CLIENT_*` / API automation).

### A0. Mint actor token (existing Management Worker CC)

```bash
# client_secret_basic — required for the demo Management Worker (ARCHITECTURE T-9)
curl -sS -u "${PINGONE_WORKER_CLIENT_ID}:${PINGONE_WORKER_CLIENT_SECRET}" \
  -X POST "https://auth.pingone.${REGION:-com}/${PINGONE_ENVIRONMENT_ID}/as/token" \
  -d 'grant_type=client_credentials'
```

Use `access_token` as `Authorization: Bearer` below. Name fields: letters, numbers,
spaces, `_`, `-`, `.`, `/`, `'` only (no `+`).

### A1. Variant — MCP OAuth Worker (interactive login for Cursor MCP)

```http
POST /v1/environments/{envId}/applications
Authorization: Bearer {actorAccessToken}
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

Then grant openid scopes (required):

```http
GET /v1/environments/{envId}/resources
GET /v1/environments/{envId}/resources/{openidResourceId}/scopes
POST /v1/environments/{envId}/applications/{newAppId}/grants
{
  "resource": { "id": "{openidResourceId}" },
  "scopes": [
    { "id": "{openidScopeId}" },
    { "id": "{profileScopeId}" },
    { "id": "{emailScopeId}" }
  ]
}
```

Wire `PINGONE_AUTHORIZATION_CODE_CLIENT_ID` / Cursor `env` to `{newAppId}`.
No client secret is used (public + PKCE).

### A2. Variant — Management API Worker (client_credentials)

When the user asks for a **worker token** / Management Worker / `PINGONE_WORKER_CLIENT_*`:

```http
POST /v1/environments/{envId}/applications
Authorization: Bearer {actorAccessToken}
Content-Type: application/json

{
  "name": "Super Banking Worker Data DaVinci",
  "description": "Management API worker. client_credentials. Roles gate access, not OAuth scopes.",
  "enabled": true,
  "type": "WORKER",
  "protocol": "OPENID_CONNECT",
  "grantTypes": ["CLIENT_CREDENTIALS"],
  "tokenEndpointAuthMethod": "CLIENT_SECRET_BASIC",
  "assignActorRoles": false
}
```

```http
GET /v1/environments/{envId}/applications/{newAppId}/secret
```

Assign roles (ENVIRONMENT-scoped) — at minimum what the user requested
(e.g. Identity Data Admin + DaVinci Admin):

```http
GET /v1/roles
GET /v1/environments/{envId}/applications/{newAppId}/roleAssignments
POST /v1/environments/{envId}/applications/{newAppId}/roleAssignments
{
  "role":  { "id": "{roleId}" },
  "scope": { "id": "{envId}", "type": "ENVIRONMENT" }
}
```

Mint token:

```bash
curl -sS -u "${NEW_APP_ID}:${NEW_SECRET}" \
  -X POST "https://auth.pingone.${REGION}/${ENV_ID}/as/token" \
  -d 'grant_type=client_credentials'
```

`scope` in the token response is `null` — that is expected. Return **client id,
secret, roles assigned, and a fresh access token** to the user. Optionally write
them to `/tmp/...json` mode `0600`; do **not** commit secrets.

Privilege rule: the actor can only grant roles it already holds. After granting
roles, mint a **new** CC token (clear any in-process cache).

Full role-assignment detail: [pingone-api-calls](../pingone-api-calls/SKILL.md)
§ Assigning roles to a Worker application.

### A3. After creating either Worker

- Confirm `type` is `WORKER` via `GET /applications/{id}`
- For MCP OAuth Worker: update `~/.cursor/mcp.json` (section B) and re-auth
- For CC Worker: give the user id/secret/token; update `.env` only if they ask

---

## B. Install PingOne MCP (Cursor stdio)

### B1. Install the stdio binary

```bash
brew tap pingidentity/tap
brew install pingone-mcp-server
pingone-mcp-server -v
which pingone-mcp-server   # expect /opt/homebrew/bin/pingone-mcp-server
```

### B2. Ensure MCP OAuth Worker exists

If `PINGONE_AUTHORIZATION_CODE_CLIENT_ID` is missing, wrong type (`NATIVE_APP`),
or user asks for a new one → run **§ A1** (create Worker OAuth client + openid grants).

### B3. Ensure the interactive user has admin roles

For the user who will click Connect (e.g. `demoUser`):

- Environment Admin (ENVIRONMENT-scoped)
- Identity Data Admin (recommended)
- DaVinci Admin (if DaVinci tools needed)

```http
POST /v1/environments/{envId}/users/{userId}/roleAssignments
{
  "role":  { "id": "{roleId}" },
  "scope": { "id": "{envId}", "type": "ENVIRONMENT" }
}
```

### B4. Wire Cursor MCP config (stdio only)

**User-level** `~/.cursor/mcp.json` (preferred):

```json
{
  "mcpServers": {
    "pingone": {
      "command": "pingone-mcp-server",
      "args": ["run"],
      "env": {
        "PINGONE_MCP_ENVIRONMENT_ID": "<PINGONE_ENVIRONMENT_ID>",
        "PINGONE_AUTHORIZATION_CODE_CLIENT_ID": "<MCP_OAUTH_WORKER_CLIENT_ID>",
        "PINGONE_ROOT_DOMAIN": "pingone.com"
      }
    }
  }
}
```

**Project-level** `.cursor/mcp.json`:

- **Remove** any `pingone` entry with `"url": "https://api.pingone.com/.../mcp"`
- Do **not** run `npm run patch:cursor-mcp` if it rewrites `pingone` back to hosted HTTP
- Keep other project servers (`codegraph`, `github`, `banking-*`) as-is

### B5. Clear stale sessions and authenticate

```bash
pingone-mcp-server logout
security delete-generic-password -s pingone_mcp_server 2>/dev/null || true
```

Cursor → Settings → MCP → enable **user** `pingone` → reload → Connect.
Sign in as the admin-roled user. Verify with `list_applications` (no 403).

## Failure table

| Symptom | Cause | Fix |
|---|---|---|
| `net::ERR_FAILED` on `api.pingone.com/.../mcp` | Hosted HTTP MCP; no OAuth challenge | Use stdio; delete `url` pingone entry |
| `At least one scope must be granted` | OAuth app has zero resource grants | Grant `openid`/`profile`/`email` |
| Auth OK, tools `ACCESS_FAILED` / 403 | OAuth app is `NATIVE_APP` (or user has no roles) | **Create** Worker OAuth client (§ A1); grant user Environment Admin |
| Empty / tiny tool list | User missing admin roles | Assign Environment Admin (+ DaVinci Admin) |
| CC token mint rejected | Worker has zero role assignments | Assign at least one app role (§ A2) |
| Browser never opens | Stale session / wrong client id | `logout`, delete keychain item, fix client id |
| Duplicate `pingone` servers | User + project both define pingone | Keep one stdio entry (user); remove project hosted |

## Do not confuse with

| Thing | Purpose |
|---|---|
| `pingone-mcp` skill | How to **use** PingOne MCP after install |
| Management Worker CC (`PINGONE_WORKER_CLIENT_*`) | API automation — create via § A2 when asked |
| MCP OAuth Worker (`PINGONE_AUTHORIZATION_CODE_CLIENT_ID`) | Interactive MCP login — create via § A1 when asked |
| Hosted `.../mcp` URL | BFF/smoke worker Bearer — **not** Cursor Connect |

## Related

- [pingone-mcp](../pingone-mcp/SKILL.md) — usage after install
- [pingone-api-calls](../pingone-api-calls/SKILL.md) — deeper Management API / roleAssignment patterns
- Official PDF: `Connect to the PingOne Remote MCP Server.pdf` (Worker + PKCE; remote needs feature flag)
