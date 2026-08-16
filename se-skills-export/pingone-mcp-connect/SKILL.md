---
name: pingone-mcp-connect
description: >-
  Connect an IDE MCP client (Claude Code, Cursor, VS Code, GitHub Copilot) to
  PingOne's MCP server, and create the PingOne Worker OAuth app(s) it needs.
  Use when the user asks to install/set up/fix PingOne MCP in an IDE, wants a
  PingOne Worker app / MCP OAuth client created, or hits net::ERR_FAILED,
  "At least one scope must be granted", ACCESS_FAILED, a 403 after auth, or
  only a handful of tools showing up instead of the full set.
---

# Connect an IDE to PingOne MCP

PingOne exposes an MCP server two ways. Pick one before doing anything else:

| Path | Transport | Best for |
|---|---|---|
| **A — local binary (stdio)** | `pingone-mcp-server` run locally via Homebrew | Most reliable across IDEs at time of writing — no browser-redirect/session edge cases |
| **B — hosted Remote MCP** | HTTP, `https://api.pingone.com/v1/environments/{envId}/mcp` | No local install; depends on your tenant having the feature enabled and your IDE's HTTP-MCP OAuth support being solid |

Source material for this skill saw the two paths disagree on reliability at
different points — hosted HTTP is the one to verify live with a `tools/list`
call before relying on it for a demo. If it misbehaves, fall back to Path A.

## FIRST STEP — ask which IDE (required, both paths)

Before creating any Worker app or writing MCP config, **ask the user**:

> Are you connecting **Cursor**, **VS Code**, or **Claude Code**?

Never assume. Redirect URIs and config file locations differ per IDE — get
this wrong and auth fails in a way that looks unrelated (`Invalid redirect
URI`, or a silent redirect loop).

## Prerequisites (both paths)

- The signed-in user needs admin roles on the target PingOne environment:
  **Environment Admin** for PingOne admin tools, **DaVinci Admin** for
  DaVinci tools. Tools you don't have a role for simply won't appear.
- A Worker OAuth app is not the same thing as a Management API
  `client_credentials` worker your backend might already use for scripts —
  build a separate one for interactive IDE login (Auth Code + PKCE).

---

## Path A — local binary (stdio)

### A1. Install

```bash
brew tap pingidentity/tap
brew install pingone-mcp-server
pingone-mcp-server -v
```

### A2. Create the MCP OAuth Worker app

**App type must be `WORKER`**, not `NATIVE_APP` — a NATIVE_APP token only
carries self-service scopes no matter what admin roles the signed-in user
has, and app type is immutable (delete and recreate to fix it).

Redirect URIs by IDE (register all that apply; add both if supporting two
IDEs from one Worker):

| IDE | Redirect URIs |
|---|---|
| **VS Code** | `http://127.0.0.1:7464/callback` (exact — required by the binary) |
| **Cursor** | `http://127.0.0.1:7464/callback`, `http://localhost:7464/callback`, `cursor://anysphere.cursor-mcp/oauth/callback`, `https://www.cursor.com/agents/mcp/oauth/callback` |

```http
POST /v1/environments/{envId}/applications
Authorization: Bearer {actorAccessToken}
Content-Type: application/json

{
  "name": "PingOne MCP Server IDE",
  "enabled": true,
  "type": "WORKER",
  "protocol": "OPENID_CONNECT",
  "grantTypes": ["AUTHORIZATION_CODE", "REFRESH_TOKEN"],
  "responseTypes": ["CODE"],
  "tokenEndpointAuthMethod": "NONE",
  "pkceEnforcement": "S256_REQUIRED",
  "assignActorRoles": false,
  "redirectUris": ["<FROM TABLE ABOVE>"]
}
```

Then grant `openid` + `profile` + `email` scopes on the app — skipping this
is the #1 cause of `At least one scope must be granted`:

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

Updating an existing app's redirects: PingOne apps have no PATCH — GET the
app, merge in the new `redirectUris`, strip read-only fields, PUT the full
body back.

### A3. Wire the IDE config

Shared env values: `PINGONE_MCP_ENVIRONMENT_ID`, `PINGONE_AUTHORIZATION_CODE_CLIENT_ID`
(the Worker app's client id), `PINGONE_ROOT_DOMAIN` (usually `pingone.com`).

**Cursor** — `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "pingone": {
      "command": "pingone-mcp-server",
      "args": ["run"],
      "env": {
        "PINGONE_MCP_ENVIRONMENT_ID": "<env-id>",
        "PINGONE_AUTHORIZATION_CODE_CLIENT_ID": "<worker-client-id>",
        "PINGONE_ROOT_DOMAIN": "pingone.com"
      }
    }
  }
}
```

Remove any pre-existing hosted-HTTP `"url": "https://api.pingone.com/.../mcp"`
entry for `pingone` — it conflicts.

**VS Code** — `.vscode/mcp.json`:

```json
{
  "servers": {
    "pingOne": {
      "type": "stdio",
      "command": "pingone-mcp-server",
      "args": ["run"],
      "env": {
        "PINGONE_MCP_ENVIRONMENT_ID": "<env-id>",
        "PINGONE_AUTHORIZATION_CODE_CLIENT_ID": "<worker-client-id>",
        "PINGONE_ROOT_DOMAIN": "pingone.com"
      }
    }
  }
}
```

Requires MCP-capable Copilot/VS Code; restart after changes.

### A4. Authenticate

```bash
pingone-mcp-server logout
security delete-generic-password -s pingone_mcp_server 2>/dev/null || true
```

Then connect from the IDE (Cursor: Settings → MCP → Connect `pingone`;
VS Code: reload → start `pingOne`, completes a browser login on
`127.0.0.1:7464`). Verify with a `list_applications` call — no 403.

---

## Path B — hosted Remote MCP (HTTP)

Endpoint: `https://api.pingone.com/v1/environments/{envId}/mcp` (swap region
if your tenant isn't `com`: `api.pingone.{region}`).

### B1. Prerequisites specific to this path

- Remote MCP requires the feature enabled on your tenant — if it's missing
  entirely, that's the first thing to check with your PingOne contact, not a
  client misconfiguration.
- Disable any local PingOne/DaVinci MCP server entries in the same
  workspace first, or you'll get duplicate/conflicting tools.

### B2. Create the OAuth Worker app (console)

Applications → **+ Add Application** → **Worker** → enable it →
Configuration:

- Grant Types: Authorization Code, Refresh Token
- Response Type: Code
- PKCE Enforcement: S256_REQUIRED
- Redirect URIs: `http://127.0.0.1:7474/callback` (default port for most
  IDEs' hosted-MCP OAuth), or `http://127.0.0.1/*` if the IDE uses dynamic
  localhost ports
- Token Endpoint Authentication Method: None (public client)

Save, copy the Client ID.

### B3. Connect the client

**Claude Code:**

```bash
claude mcp add --transport http \
  --client-id {clientId} \
  --callback-port 7474 \
  pingone \
  "https://api.pingone.com/v1/environments/{envId}/mcp"
```

Authorize when prompted (`/mcp` in an interactive session if it doesn't
trigger automatically).

**Cursor / VS Code / Copilot:** point the editor's remote-HTTP MCP config at
the same URL and Worker client id; use the redirect pattern that matches
whatever callback the extension actually requests (check the auth-error
message for the exact URI it wanted, then add that to the Worker app).

### B4. Roles and tool visibility

Tool count depends on the authenticated user's admin roles — **Environment
Admin** for PingOne tools, **DaVinci Admin** for DaVinci tools. After
changing a user's roles, disconnect and reconnect the client (or "clear
authentication" and re-auth) so `tools/list` reflects the change — a
same-session reconnect can silently reuse a cached token.

---

## Failure table (both paths)

| Symptom | Cause | Fix |
|---|---|---|
| `Invalid redirect URI` | Callback doesn't match what the IDE/binary actually requests | Re-confirm which IDE, register the exact URI from the error |
| Only self-service scopes / ~6 tools no matter the role | App type is `NATIVE_APP`/`WEB_APP`, not `WORKER` | Delete and recreate as `WORKER` — type is immutable |
| `net::ERR_FAILED` on a hosted `/mcp` URL | Trying hosted HTTP where only stdio is reliable, or vice versa | Switch path (A ↔ B) |
| `At least one scope must be granted` | No `openid` grant on the Worker | Grant `openid` + `profile` + `email` |
| Auth "succeeds" but no login form appeared | Browser silently reused another user's PingOne session in that env | Use an incognito window / "sign in as a different user" — a credential prompt is the success signal |
| Role change applied but same denial persists | Stale cached token, reused by server-URL key | Clear authentication for that server, then re-authenticate |
| Few tools after a role fix | Client didn't actually re-fetch `tools/list` | Full disconnect/reconnect, not just retry |

To confirm which identity/client an OAuth login actually used, query the
audit API with a separate `client_credentials` worker token
(`GET /environments/{envId}/activities?filter=recordedat gt "<iso8601>"`) —
if no login-flow event appears, no real re-auth happened, whatever the UI
claimed.
