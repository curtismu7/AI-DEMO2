---
name: pingone-mcp-install
description: 'Claude skill to install PingOne MCP for Cursor or VS Code (ask which IDE first) AND create PingOne Worker apps when asked. USE FOR: install pingone-mcp-server, ask Cursor or VS Code, set redirect callback URI, .vscode/mcp.json, ~/.cursor/mcp.json, create PingOne Worker app, Worker OAuth client, Management API worker client_credentials, PINGONE_WORKER_CLIENT_ID, PINGONE_AUTHORIZATION_CODE_CLIENT_ID, pingone MCP auth fails, net::ERR_FAILED, At least one scope must be granted, ACCESS_FAILED, brew install pingone-mcp-server. DO NOT USE FOR: calling PingOne tools after install (use pingone-mcp); banking data-plane MCP; generic user CRUD unrelated to MCP install (use pingone-api-calls).'
argument-hint: 'Install PingOne MCP (ask Cursor vs VS Code) and/or create a Worker app'
---

# Install PingOne MCP + create Worker apps (Claude skill)

This is a **Claude skill** stored at:

- Personal: `~/.claude/skills/pingone-mcp-install/SKILL.md`
- Repo: `.claude/skills/pingone-mcp-install/SKILL.md` (mirrored under `pingone/`, `claude-skills-bundle/`, `claudSkills/`)

## FIRST STEP — ask which IDE (required)

Before creating the MCP OAuth Worker, writing MCP config, or setting redirect URIs,
**ask the user** (do not assume):

> Are you installing PingOne MCP for **Cursor** or **VS Code**?

| Answer | Redirect callbacks to register on the Worker | MCP config file |
|---|---|---|
| **Cursor** | `http://127.0.0.1:7464/callback`, `http://localhost:7464/callback`, `cursor://anysphere.cursor-mcp/oauth/callback`, `https://www.cursor.com/agents/mcp/oauth/callback` (optional: `:7474` variants) | `~/.cursor/mcp.json` (`mcpServers.pingone`) |
| **VS Code** | **`http://127.0.0.1:7464/callback`** (exact; required by `pingone-mcp-server`). Optional: Redirect URI Pattern `http://127.0.0.1/*` in Console if another localhost port appears | `.vscode/mcp.json` (`servers.pingOne`) |
| **Both** | Union of Cursor + VS Code URIs above | Wire **both** config files to the same Worker client id |

If they already have a Worker client, **update its `redirectUris`** (read-modify-write PUT on the application — PingOne apps do not support PATCH) to match their IDE choice before auth.

Never invent which IDE they use. If they refuse to choose, stop and ask again.

## When to Use

- User asks to install / set up / fix PingOne MCP in an IDE
- User asks to **create a PingOne Worker app** / worker token / MCP OAuth Worker
- MCP shows Error / never opens auth / `net::ERR_FAILED` / scope grant errors / post-login 403

## When NOT to Use

- Using PingOne MCP tools after a healthy install — use `pingone-mcp`
- Banking / gateway MCP — different servers
- Unrelated Management API work — use `pingone-api-calls`

## Hard truths (do not skip)

1. **Hosted HTTP MCP is broken for IDE Connect today** — do not use `"url": "https://api.pingone.com/.../mcp"`. Use **stdio**.
2. **MCP OAuth client must be `type: WORKER`**, not `NATIVE_APP`.
3. **Grant `openid` + `profile` + `email`** on the OAuth Worker or authorize fails with `At least one scope must be granted`.
4. **Signed-in user needs admin roles** (Environment Admin; DaVinci Admin for DaVinci tools).
5. **Redirect URI must match the IDE** — wrong callbacks → `Invalid redirect URI` / auth never completes. Set them from the user's Cursor vs VS Code answer (§ FIRST STEP).
6. Two Worker variants:

| App | Grant types | Auth method | Used for |
|---|---|---|---|
| Management Worker (CC) | `CLIENT_CREDENTIALS` | `CLIENT_SECRET_BASIC` (demo) | BFF/scripts Management API |
| MCP OAuth Worker | `AUTHORIZATION_CODE` + `REFRESH_TOKEN` | `NONE` + PKCE S256 | IDE interactive MCP login |

## Prerequisites

- macOS with Homebrew
- `PINGONE_ENVIRONMENT_ID` + `PINGONE_REGION` (default `com`) when in this repo
- Privileged Management Worker CC to create apps (or user-provided actor). Never invent secrets.

---

## A. Create a PingOne Worker app (when the user asks)

**Always create when asked.** For MCP OAuth Workers, complete **FIRST STEP** (Cursor vs VS Code) first so redirects are correct.

### A0. Mint actor token

```bash
curl -sS -u "${PINGONE_WORKER_CLIENT_ID}:${PINGONE_WORKER_CLIENT_SECRET}" \
  -X POST "https://auth.pingone.${REGION:-com}/${PINGONE_ENVIRONMENT_ID}/as/token" \
  -d 'grant_type=client_credentials'
```

App names: letters, numbers, spaces, `_`, `-`, `.`, `/`, `'` only (no `+`).

### A1. Variant — MCP OAuth Worker (after IDE choice)

Build `redirectUris` from the user's answer:

**VS Code only:**
```json
["http://127.0.0.1:7464/callback"]
```

**Cursor only:**
```json
[
  "http://127.0.0.1:7464/callback",
  "http://localhost:7464/callback",
  "http://127.0.0.1:7474/callback",
  "http://localhost:7474/callback",
  "cursor://anysphere.cursor-mcp/oauth/callback",
  "https://www.cursor.com/agents/mcp/oauth/callback"
]
```

**Both:** use the Cursor list (superset; includes the VS Code-required `127.0.0.1:7464` URI).

```http
POST /v1/environments/{envId}/applications
Authorization: Bearer {actorAccessToken}
Content-Type: application/json

{
  "name": "PingOne MCP Server IDE",
  "description": "Stdio MCP OAuth Worker for the chosen IDE. type WORKER required.",
  "enabled": true,
  "type": "WORKER",
  "protocol": "OPENID_CONNECT",
  "grantTypes": ["AUTHORIZATION_CODE", "REFRESH_TOKEN"],
  "responseTypes": ["CODE"],
  "tokenEndpointAuthMethod": "NONE",
  "pkceEnforcement": "S256_REQUIRED",
  "assignActorRoles": false,
  "redirectUris": [ "<FROM_IDE_CHOICE_ABOVE>" ]
}
```

Grant openid scopes:

```http
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

Save `{newAppId}` as `PINGONE_AUTHORIZATION_CODE_CLIENT_ID`.

**Updating an existing app's redirects:** GET application → merge new `redirectUris` → strip read-only fields → PUT full body (no PATCH).

### A2. Variant — Management API Worker (client_credentials)

No IDE redirect choice needed (no browser login).

```http
POST /v1/environments/{envId}/applications
{
  "name": "Super Banking Worker Data DaVinci",
  "description": "Management API worker. client_credentials.",
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
POST /v1/environments/{envId}/applications/{newAppId}/roleAssignments
{
  "role":  { "id": "{roleId}" },
  "scope": { "id": "{envId}", "type": "ENVIRONMENT" }
}
```

Mint with `client_credentials`; `scope` is `null`. Return id/secret/roles/token. Optional `/tmp` file mode `0600`.

### A3. After create

- Confirm `type` is `WORKER` and `redirectUris` match the IDE answer
- MCP OAuth Worker → § B config for that IDE only (or both)
- CC Worker → return credentials; update `.env` only if asked

---

## B. Install PingOne MCP

### B1. Binary

```bash
brew tap pingidentity/tap
brew install pingone-mcp-server
pingone-mcp-server -v
```

### B2. MCP OAuth Worker + redirects

Ask IDE if not known → create/update Worker (§ A1) with the matching callbacks.

### B3. User admin roles

Environment Admin (+ Identity Data Admin; DaVinci Admin if needed) on the interactive user.

### B4. Wire config for the chosen IDE only

Shared env:

```json
{
  "PINGONE_MCP_ENVIRONMENT_ID": "<PINGONE_ENVIRONMENT_ID>",
  "PINGONE_AUTHORIZATION_CODE_CLIENT_ID": "<MCP_OAUTH_WORKER_CLIENT_ID>",
  "PINGONE_ROOT_DOMAIN": "pingone.com"
}
```

#### If Cursor

`~/.cursor/mcp.json`:

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

Remove project `.cursor/mcp.json` hosted `"url": "https://api.pingone.com/.../mcp"` entries.

#### If VS Code

`.vscode/mcp.json`:

```json
{
  "servers": {
    "pingOne": {
      "type": "stdio",
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

Requires Copilot MCP support; restart VS Code after changes.

#### If Both

Write **both** files above; one Worker client id; redirects = Cursor list (includes VS Code URI).

### B5. Auth

```bash
pingone-mcp-server logout
security delete-generic-password -s pingone_mcp_server 2>/dev/null || true
```

- Cursor: Settings → MCP → Connect `pingone`
- VS Code: reload → start `pingOne` → browser login on `127.0.0.1:7464`

Verify `list_applications` without 403.

## Failure table

| Symptom | Cause | Fix |
|---|---|---|
| `Invalid redirect URI` | Callbacks don't match IDE / binary | Ask IDE again; set redirects per FIRST STEP |
| `net::ERR_FAILED` on hosted `/mcp` | Remote URL entry | Switch to stdio |
| `At least one scope must be granted` | No openid grant | Grant openid/profile/email |
| Auth OK, 403 ACCESS_FAILED | NATIVE_APP or no user roles | Create **WORKER** client; grant Environment Admin |
| VS Code missing server | Wrong JSON shape | `.vscode/mcp.json` + `"servers"."pingOne"` |
| Agent assumed wrong IDE | Skipped FIRST STEP | Stop and ask Cursor vs VS Code |

## Related

- [pingone-mcp](../pingone-mcp/SKILL.md) — usage after install
- [pingone-api-calls](../pingone-api-calls/SKILL.md) — Management API / roleAssignments
- Upstream: https://github.com/pingidentity/pingone-mcp-server
