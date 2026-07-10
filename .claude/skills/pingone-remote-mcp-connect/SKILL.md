---
name: pingone-remote-mcp-connect
description: >-
  Connects IDE MCP clients (Claude Code, Cursor, VS Code, GitHub Copilot) to the
  PingOne hosted Remote MCP Server at api.pingone.com/v1/environments/{envId}/mcp.
  Use when the user asks to connect PingOne MCP, set up port 7474 OAuth callback,
  configure a Worker app for MCP client auth, or troubleshoot missing PingOne MCP tools.
---

# Connect to the PingOne Remote MCP Server

PingOne's **hosted admin-plane MCP** endpoint:

```text
https://api.pingone.com/v1/environments/{envId}/mcp
```

Replace `{envId}` with `PINGONE_ENVIRONMENT_ID` from `demo_api_server/.env`.
Use region `com` unless your tenant is elsewhere (`api.pingone.{region}`).

This skill covers **interactive OAuth client setup** (Authorization Code + PKCE on
port **7474**). For BFF/script access via worker `client_credentials`, see
[pingone-mcp](../pingone-mcp/SKILL.md).

## Prerequisites

1. **Feature flag** — Remote MCP requires PingOne-side enablement. If unavailable,
   contact Amit Ben-Chanoch, Nathan Langton, or Saparja Dey (Ping Identity).
2. **Admin identity** — Authenticate with a user that has roles matching the tools
   you need (see Roles below).
3. **No local MCP conflicts** — Disable any existing local **PingOne** or **DaVinci**
   MCP servers in the same workspace before enabling the remote server.

## Step 1 — Create the OAuth Worker app (PingOne console)

In [PingOne admin console](https://admin.pingone.com/), select the environment where
your administrator identity lives.

1. **Applications** → **Applications** → **+ Add Application** → **Worker**
2. **Name:** e.g. `PingOne MCP Server` (description optional)
3. Enable the application (toggle top-right)
4. **Configuration** tab → **Edit**:
   - **Grant Types:** Authorization Code, Refresh Token
   - **Response Type:** Code
   - **PKCE Enforcement:** S256_REQUIRED
   - **Redirect URIs:**
     - Claude Code / default: `http://127.0.0.1:7474/callback`
     - VS Code (pattern): `http://127.0.0.1/*`
   - **Token Endpoint Authentication Method:** None (Public Client)
5. **Save**, then copy **Client ID**

This app is a **public OAuth client** for IDE login — not the same as the BFF's
`client_credentials` worker used by `mcpPingOneHttpAdapter.js`.

## Step 2 — Connect the MCP client

### Claude Code

Replace `{clientId}` and `{envId}`, then run:

```bash
claude mcp add --transport http \
  --client-id {clientId} \
  --callback-port 7474 \
  pingone \
  "https://api.pingone.com/v1/environments/{envId}/mcp"
```

Authorize when prompted (`/mcp` in an interactive session if needed).

### Cursor

1. Copy `.cursor/mcp.json.example` → `.cursor/mcp.json` (gitignored)
2. Set the `pingone` entry:

```json
"pingone": {
  "url": "https://api.pingone.com/v1/environments/<PINGONE_ENVIRONMENT_ID>/mcp",
  "auth": {
    "CLIENT_ID": "<worker-oauth-client-id-from-step-1>"
  }
}
```

3. **Cursor Settings** → **MCP** → **Connect** on the `pingone` server
4. Or run `npm run patch:cursor-mcp` if the repo provides env-driven patching

Redirect/callback for Cursor OAuth uses the IDE's MCP OAuth flow (not port 7474
unless the client is configured that way). If auth fails, verify redirect URIs
match what Cursor requests (add the URI shown in the error to the Worker app).

### VS Code / GitHub Copilot

Use the same Worker app and MCP URL. Configure the editor's MCP extension per its
remote HTTP + OAuth docs; use redirect pattern `http://127.0.0.1/*` on the Worker
app when the extension uses dynamic localhost ports.

(Copilot-specific steps were not in the source doc — extend [reference.md](reference.md)
when PingOne publishes them.)

## Roles and tool visibility

Tools exposed by the Remote MCP Server depend on the **authenticated user's admin roles**:

| Need | Role |
|------|------|
| PingOne admin tools | **Environment Admin** |
| DaVinci tools | **DaVinci Admin** |

After changing a user's admin roles, **disconnect and reconnect** the MCP client so
`tools/list` reflects the new role set.

## Troubleshooting

Check in this order — app type first (2026-07-10 outage: roles and tokens were
re-checked repeatedly while the app type was the actual root cause):

| Symptom | Check |
|---------|--------|
| ~6 tools only + every call denied `dir:read:user` | **App type must be WORKER.** A NATIVE_APP (or WEB_APP) token carries only self-service scopes (p1:read:user, devices, sessions) no matter what admin roles the user has. Type is immutable — delete the app and recreate as Worker. `npm run smoke:pingone-mcp` validates this. |
| Role/app fix applied but same denial persists | Stale cached token: `/mcp reconnect` silently reuses the Keychain token (keyed by server URL). Terminal `claude` → `/mcp` → server → **Clear authentication** → Authenticate. |
| Re-auth "succeeds" but no login form appeared | Silent SSO hijack: the browser holds another user's PingOne session in the same env (e.g. the banking demo's `demoUser`, no admin roles). Use an incognito window or "sign in as a different user"; a credential prompt is the success signal. |
| MCP server missing / 404 | Feature flag enabled for your tenant? |
| Few tools (~not 73) after the above | User roles (table above); Clear authentication + re-auth after role change |
| Auth redirect error | Redirect URI on Worker app matches client (7464/7474 vs `127.0.0.1/*`) |
| Duplicate/conflicting tools | Disable local PingOne/DaVinci MCP entries |
| BFF smoke works but IDE fails | IDE uses interactive OAuth app; BFF uses `client_credentials` worker |

To confirm which identity/client an OAuth login actually used, query the audit
API with a worker token (`GET /environments/{envId}/activities?filter=recordedat
gt "<iso8601>"`) — if no login-flow events appear, no real re-auth happened.

## Related

- Operational MCP usage (MCP-first rule, tool naming, BFF adapter): [pingone-mcp](../pingone-mcp/SKILL.md)
- Source onboarding doc (verbatim): [reference.md](reference.md)
- Repo templates: `.cursor/mcp.json.example`, `.air/mcp.json.example`
- Health: `npm run smoke:pingone-mcp` (BFF worker token — not IDE OAuth)
